import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createBackupAlertWorker } from "../server/backup/alert-worker.mjs";
import { emptyBackupAlertState, validateBackupAlert, validateBackupAlertState, backupMonitorAlertObservation } from "../server/backup/alert-state.mjs";
import { createPrivateBackupAlertDelivery, sendBoundedBackupAlert } from "../server/backup/alert-delivery.mjs";
import { backupAlertMessage } from "../server/mail/backup-alert-message.mjs";
import { createVerificationTransport } from "../server/mail/transport.mjs";
import { main as drill } from "../scripts/test-private-backup-alerts.mjs";
import { main as supervise } from "../scripts/start-recurring-private-messaging.mjs";

const NOW = Date.UTC(2026, 9, 18, 12), marker = "private-client-SQL-password-must-not-leak";
const id = () => randomBytes(16).toString("hex");
const alert = (overrides = {}) => { const value = id(); return { version: 1, id: value, incidentId: value, event: "incident",
  code: "BACKUP_STALE", observedAt: NOW, lastSuccessAt: NOW - 1000, synthetic: false, ...overrides }; };
function sample(state = "current", now = NOW) {
  return { version: 1, type: "private_backup_monitor", event: state === "incident" ? "incident" : "sample", checkedAt: now,
    state, code: state === "current" ? "OK" : state === "waiting" ? "CAPTURE_RUNNING" : "BACKUP_STALE",
    consecutiveFailures: state === "incident" ? 3 : state === "suspect" ? 1 : 0, activeIncident: state === "incident",
    lastSuccessAt: now - 1000, ageMilliseconds: 1000, copyStatus: "not_checked", decryptionStatus: "not_checked", notificationStatus: "not_sent" };
}
function fixture(overrides = {}) {
  let state = validateBackupAlertState(emptyBackupAlertState()), now = NOW, failed = false;
  const sent = [], reports = [], saved = [];
  const dependencies = {
    clock: () => now,
    read: async () => structuredClone(state),
    save: async (_dir, value, revision) => {
      assert.equal(revision, state.revision);
      state = validateBackupAlertState({ ...value, revision: revision + 1 }); saved.push(state); return state;
    },
    makeDelivery: async () => ({ send: async value => { sent.push(value); if (failed) throw new Error(marker); return true; }, close() {} }),
    emit: value => reports.push(value), ...overrides,
  };
  let worker = createBackupAlertWorker({ operationsDirectory: "/private/ops", privateDirectory: "/private/config" }, dependencies);
  return { sent, saved, reports, state: () => state, setState: value => { state = value; }, setFailed: value => { failed = value; },
    setNow: value => { now = value; }, restart: async () => { await worker.close(); worker = createBackupAlertWorker({ operationsDirectory: "/private/ops", privateDirectory: "/private/config" }, dependencies); },
    observe: (kind = "current") => worker.observe(sample(kind, now)), close: () => worker.close(),
    advance: () => { now += 60000; } };
}
test("healthy, suspect and running captures neither open SMTP nor write queue state", async () => {
  const f = fixture();
  for (const kind of ["current", "suspect", "waiting"]) await f.observe(kind);
  assert.equal(f.sent.length, 0); assert.equal(f.saved.length, 0); await f.close();
});
test("one incident and one recovery are acknowledged durably without repeats across restarts", async () => {
  const f = fixture();
  assert.equal((await f.observe("incident")).notificationStatus, "smtp_accepted");
  await f.observe("incident"); await f.restart(); await f.observe("incident");
  assert.equal(f.sent.length, 1); assert.equal(f.state().pending.length, 0); assert.ok(f.state().activeIncident);
  f.advance(); await f.observe("waiting"); assert.equal(f.sent.length, 1);
  await f.observe("current"); await f.restart(); await f.observe("current");
  assert.deepEqual(f.sent.map(x => x.event), ["incident", "recovered"]);
  assert.equal(f.sent[1].incidentId, f.sent[0].id); assert.equal(f.state().activeIncident, null);
  assert.equal(f.state().lastAcceptedId, f.sent[1].id); await f.close();
});
test("SMTP errors retain FIFO incident/recovery, stable IDs and persisted exponential retry delays", async () => {
  const f = fixture(); f.setFailed(true);
  assert.equal((await f.observe("incident")).code, "ALERT_SMTP_FAILED");
  assert.equal(f.state().pending.length, 1);
  await f.restart(); await f.observe("current");
  assert.equal(f.sent.length, 1); assert.equal(f.state().pending.length, 2);
  f.advance(); await f.observe(); assert.equal(f.sent.length, 2);
  f.advance(); await f.observe(); assert.equal(f.sent.length, 2);
  f.advance(); f.setFailed(false); await f.observe(); assert.equal(f.sent.length, 3);
  assert.equal(f.sent[0].id, f.sent[2].id); assert.equal(f.state().pending[0].event, "recovered");
  f.advance(); await f.observe(); assert.equal(f.sent[3].event, "recovered");
  assert.equal(f.state().pending.length, 0); await f.close();
});
test("an unacknowledged SMTP success is retried with the same Message-ID after restart", async () => {
  const f = fixture();
  // Model a restart after SMTP acceptance without a durable acknowledgement.
  const state = emptyBackupAlertState(), queued = alert();
  f.setState({ ...state, revision: 2, activeIncident: queued, pending: [queued], lastObservedAt: NOW,
    lastAttemptAt: NOW, consecutiveFailures: 1 });
  await f.restart(); f.advance(); await f.observe("incident");
  assert.equal(f.sent[0].id, queued.id); assert.equal(f.state().pending.length, 0);
  assert.equal(backupAlertMessage(f.sent[0]).messageId, backupAlertMessage(queued).messageId);
  await f.close();
});
test("failed queue persistence prevents an SMTP socket and does not disclose raw errors", async () => {
  const f = fixture({ save: async () => { throw new Error(marker); } });
  const result = await f.observe("incident");
  assert.equal(result.code, "ALERT_UNAVAILABLE"); assert.equal(f.sent.length, 0);
  assert.doesNotMatch(JSON.stringify(f.reports), new RegExp(marker)); await f.close();
});
test("a full queue preserves pending order and still drains when SMTP returns", async () => {
  const f = fixture();
  const pending = Array.from({ length: 32 }, () => alert());
  f.setState({ ...emptyBackupAlertState(), pending, lastObservedAt: NOW });
  assert.equal((await f.observe("incident")).notificationStatus, "smtp_accepted");
  assert.equal(f.reports[0].code, "ALERT_QUEUE_FULL");
  assert.equal(f.state().pending.length, 31); assert.equal(f.sent[0].id, pending[0].id);
  f.advance(); await f.observe("incident");
  assert.ok(f.state().activeIncident); assert.equal(f.state().pending.at(-1).id, f.state().activeIncident.id); await f.close();
});
test("invalid, future, getter-bearing and private-extended observations cannot reach the queue", () => {
  for (const value of [null, { ...sample(), address: marker }, { ...sample(), checkedAt: NOW + 1 },
    { ...sample(), checkedAt: NOW - 31000 }, { ...sample(), ageMilliseconds: 999 }, { ...sample(), activeIncident: true },
    Object.defineProperty(sample(), "code", { get() { assert.fail("getter must not run"); }, enumerable: true })]) {
    assert.throws(() => backupMonitorAlertObservation(value, NOW), { code: "ALERT_INPUT" });
  }
});
test("closed message templates enforce official recipient and explicit synthetic labeling", () => {
  const value = alert(), message = backupAlertMessage({ ...value, synthetic: true });
  assert.equal(message.to, "contact@jessiemessage.com"); assert.equal(message.from, message.to); assert.equal(message.replyTo, message.to);
  assert.deepEqual(message.envelope, { from: message.to, to: [message.to] });
  assert.match(message.subject, /^\[TEST\]/); assert.match(message.text, /EXERCICE SYNTHÉTIQUE/);
  assert.doesNotMatch(message.text, new RegExp(marker));
  for (const extra of ["to", "subject", "text", "html", "path", "attachment"]) assert.throws(() => backupAlertMessage({ ...value, [extra]: marker }), { code: "ALERT_INPUT" });
});
test("queue and alert validators reject sparse/accessor arrays, private extensions and impossible recovery", () => {
  const pending = [alert()]; Object.defineProperty(pending, 0, { get() { assert.fail("getter must not run"); } });
  for (const value of [{ ...emptyBackupAlertState(), pending }, { ...emptyBackupAlertState(), pending: Array(2) },
    { ...emptyBackupAlertState(), password: marker }, { ...emptyBackupAlertState(), lastAttemptAt: NOW }]) {
    assert.throws(() => validateBackupAlertState(value), { code: "ALERT_INPUT" });
  }
  assert.throws(() => validateBackupAlert({ ...alert(), event: "recovered", code: "OK" }), { code: "ALERT_INPUT" });
});
test("private delivery clears loaded secrets and never changes the application's mail configuration", async () => {
  const environment = { JESSIEMESSAGE_SMTP_PASSWORD: marker, JESSIEMESSAGE_MAIL_KEY: marker }, key = randomBytes(32);
  let closed = 0;
  const delivery = await createPrivateBackupAlertDelivery("/private/config", {
    load: async (_dir, options) => { assert.deepEqual(options, { originProfile: "primary" }); return environment; },
    configure: () => ({ enabled: true, origin: "https://jessiemessage.com", key }),
    makeTransport: async () => ({ sendBackupAlert: async () => true, close: () => { closed++; } }),
  });
  assert.equal(environment.JESSIEMESSAGE_SMTP_PASSWORD, ""); assert.equal(environment.JESSIEMESSAGE_MAIL_KEY, "");
  assert.ok(key.every(x => x === 0)); assert.equal(await delivery.send(alert()), true); await delivery.close(); assert.equal(closed, 1);
});
test("bounded delivery cancels stalled SMTP and ignores late acceptance", async () => {
  let accept, closed = 0;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const operation = sendBoundedBackupAlert(async () => ({ send: () => new Promise(resolve => { accept = resolve; }), close: () => { closed++; } }), alert(), { timeoutMilliseconds: 5 });
    await assert.rejects(operation, { code: "ALERT_TIMEOUT" });
    assert.equal(closed, 1); accept(true); await new Promise(resolve => setImmediate(resolve)); assert.equal(closed, 1);
  } finally { clearTimeout(keepAlive); }
});
test("aborting stalled delivery construction prevents any late socket send and closes its result", async () => {
  let construct, closed = 0, sent = 0;
  const cancellation = new AbortController();
  const operation = sendBoundedBackupAlert(() => new Promise(resolve => { construct = resolve; }), alert(), { signal: cancellation.signal });
  await new Promise(resolve => setImmediate(resolve)); cancellation.abort();
  await assert.rejects(operation, { code: "ALERT_UNAVAILABLE" });
  construct({ send() { sent++; return true; }, close() { closed++; } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(sent, 0); assert.equal(closed, 1);
});
test("worker shutdown cancels mail promptly, preserves pending work and emits no late receipt", async () => {
  let sent = false;
  const f = fixture({ makeDelivery: async () => ({ send() { sent = true; return new Promise(() => {}); }, close() {} }) });
  const work = f.observe("incident");
  while (!sent) await new Promise(resolve => setImmediate(resolve));
  await f.close(); assert.equal(await work, null); assert.equal(f.state().pending.length, 1); assert.equal(f.reports.length, 0);
});
test("SMTP adapter accepts only the official address on the primary origin and refuses partial delivery", async () => {
  const base = { enabled: true, origin: "https://jessiemessage.com", smtp: { host: "smtp.example.invalid", port: 587,
    user: "synthetic", password: "synthetic", from: "contact@jessiemessage.com", replyTo: "contact@jessiemessage.com" } };
  for (const result of [{ accepted: ["contact@jessiemessage.com"] }, { accepted: [] }, { accepted: [marker] },
    { accepted: ["contact@jessiemessage.com"], rejected: [marker] }, { accepted: ["contact@jessiemessage.com"], pending: [marker] }]) {
    const transport = await createVerificationTransport(base, { createTransport: options => {
      assert.equal(options.requireTLS, true); assert.equal(options.tls.rejectUnauthorized, true);
      assert.equal(options.logger, false); assert.equal(options.disableUrlAccess, true);
      return { sendMail: async value => { assert.equal(value.to, "contact@jessiemessage.com"); return result; }, close() {} };
    } });
    if (result.accepted.length === 1 && result.accepted[0] === "contact@jessiemessage.com" && !result.rejected && !result.pending) assert.equal(await transport.sendBackupAlert(alert()), true);
    else await assert.rejects(transport.sendBackupAlert(alert()), { code: "MAIL_DELIVERY_FAILED" });
    await transport.close();
  }
  const transport = await createVerificationTransport({ ...base, origin: "https://recette.jessiemessage.com" }, {
    createTransport: () => ({ sendMail() { assert.fail("must not send"); }, close() {} }),
  });
  await assert.rejects(transport.sendBackupAlert(alert()), { code: "PAYLOAD_INVALID" }); await transport.close();
});
const args = ["--private-directory", "/private/config", "--private-path-mode", "linux-dirfd"];
const env = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" };
test("configuration check sends nothing; explicit drill sends two synthetic fixed-purpose alerts", async () => {
  const sent = [], output = [];
  const dependencies = { environment: env, execArgv: [], clock: () => NOW, outputStream: { write: value => output.push(value) },
    makeDelivery: async () => ({ send: async value => { sent.push(value); return true; }, close() {} }) };
  await drill(["check", ...args], dependencies); assert.equal(sent.length, 0);
  await drill(["send-test", ...args], dependencies);
  assert.deepEqual(sent.map(x => x.event), ["incident", "recovered"]); assert.ok(sent.every(x => x.synthetic));
  assert.equal(sent[1].incidentId, sent[0].id); assert.ok(output.every(x => JSON.parse(x).inboxStatus === "not_checked"));
});
test("drill rejects extra recipients, ambiguous commands, relative paths and ambient credentials", async () => {
  for (const input of [["send", ...args], ["send-test", ...args, "--to", marker], ["send-test", ...args.map(x => x === "/private/config" ? "relative" : x)]]) {
    await assert.rejects(drill(input, { environment: env, execArgv: [], makeDelivery() { assert.fail("no transport"); } }), { code: "ALERT_INPUT" });
  }
  await assert.rejects(drill(["send-test", ...args], { environment: { ...env, JESSIEMESSAGE_SMTP_PASSWORD: marker }, execArgv: [] }), { code: "PRIVATE_AUTH_ENVIRONMENT" });
});
test("queue factory failures and broken console output do not stop application supervision or alert observation", async () => {
  const args = ["start", "--runtime-directory", "/srv/app", "--runtime-head", "a".repeat(40), "--runtime-tree", "b".repeat(40),
    "--private-directory", "/srv/config", "--operations-directory", "/srv/ops", "--private-path-mode", "linux-dirfd"];
  let observed = 0, stopped = 0;
  for (const fail of [false, true]) {
    await supervise(args, { environment: env, execArgv: [], outputStream: { write() { throw new Error(marker); } },
      makeSupervisor: () => ({ start: async () => {}, close: async () => { stopped++; }, finished: Promise.resolve({ failed: false }) }),
      makeAlerts: () => { if (fail) throw new Error(marker); return { observe: async () => { observed++; }, close: async () => {} }; },
      makeMonitor: (_options, { emit }) => ({ start: () => emit(sample()), close: async () => {} }),
    });
  }
  assert.equal(observed, 1); assert.equal(stopped, 2);
});
