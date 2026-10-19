import test from "node:test";
import assert from "node:assert/strict";
import { createPeriodicBackupMonitor } from "../server/backup/periodic-monitor.mjs";
import { evaluateCheckpointFreshness, validateBackupFreshnessReport, CHECKPOINT_MAXIMUM_AGE } from "../server/backup/freshness.mjs";
import { main as supervise } from "../scripts/start-recurring-private-messaging.mjs";
import { createBackupAlertWorker } from "../server/backup/alert-worker.mjs";
import { emptyBackupAlertState } from "../server/backup/alert-state.mjs";

const NOW = Date.UTC(2026, 9, 18, 12);
const marker = "private-address-SQL-key-must-never-appear";
const config = { version: 1, recipientSha256: "a".repeat(64), hourUtc: 5, minuteUtc: 15, enabled: true };
const flush = () => new Promise(resolve => queueMicrotask(resolve));
function report(kind = "current", now = NOW) {
  const at = kind === "stale" ? now - CHECKPOINT_MAXIMUM_AGE - 1000 : now - 2000;
  const begin = { version: 1, type: "recurring_checkpoint", status: "running", phase: "preflight", code: "OK", startedAt: at, finishedAt: null, runtimeResumed: false };
  const done = { ...begin, status: "succeeded", phase: "finished", finishedAt: at + 1000, runtimeResumed: true };
  const records = kind === "waiting" ? [begin] : kind === "missing" ? [] : [begin, done];
  const result = evaluateCheckpointFreshness({ configuration: { ...config, enabled: kind !== "disabled" }, now,
    history: { records, lastAttemptAt: records.length ? at : null, lastSuccessAt: records.length && kind !== "waiting" ? at + 1000 : null } });
  return { report: result, exitCode: result.status === "current" ? 0 : 1 };
}
function fixture(overrides = {}) {
  let now = NOW, kind = "current", calls = 0, timerId = 0;
  const emitted = [], timers = new Map();
  const monitor = createPeriodicBackupMonitor({ operationsDirectory: "/srv/private-backups" }, {
    clock: () => now, emit: value => emitted.push(value),
    inspect: async (directory, { signal }) => { assert.equal(directory, "/srv/private-backups"); assert.equal(signal.aborted, false); calls++; return report(kind, now); },
    schedule: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, unschedule: id => timers.delete(id), ...overrides,
  });
  return { monitor, emitted, timers, calls: () => calls, setNow: value => { now = value; }, now: () => now,
    async start() { monitor.start(); const value = await monitor.tick(); await flush(); return value; },
    async pass(selected = kind) { kind = selected; now += 60000; const value = await monitor.tick(); await flush(); return value; },
    fire(delay) { const selected = [...timers].find(([, value]) => value.delay === delay); assert.ok(selected); timers.delete(selected[0]); selected[1].callback(); },
  };
}

test("periodic sampling starts once, reports fixed metadata and arms the next minute", async () => {
  const f = fixture();
  assert.equal(await f.monitor.tick(), null);
  const first = await f.start(); f.monitor.start();
  assert.equal(f.calls(), 1); assert.equal(first.state, "current");
  assert.equal(first.notificationStatus, "not_sent"); assert.equal(first.copyStatus, "not_checked");
  assert.equal(first.decryptionStatus, "not_checked"); assert.equal(Object.isFrozen(first), true);
  assert.equal([...f.timers.values()].filter(x => x.delay === 60000).length, 1);
  for (const forbidden of ["recipientSha256", "operationsDirectory", "records", "report"]) assert.equal(Object.hasOwn(first, forbidden), false);
  await f.monitor.close(); assert.equal(f.timers.size, 0);
});

test("an advancing clock produces an observation accepted by the real alert worker without SMTP", async () => {
  let now = NOW;
  const f = fixture({ clock: () => now++ });
  const alerts = createBackupAlertWorker({ operationsDirectory: "/synthetic/operations", privateDirectory: "/synthetic/private" }, {
    clock: () => now++, read: async () => emptyBackupAlertState(),
    save: async () => assert.fail("No queue transition for a current backup"),
    makeDelivery: () => assert.fail("No SMTP for a current backup"),
  });
  try {
    const snapshot = await f.start();
    const accepted = await alerts.observe(snapshot);
    assert.equal(accepted.event, "observed"); assert.equal(accepted.code, "OK"); assert.equal(accepted.pending, 0);
    assert.equal(snapshot.ageMilliseconds, snapshot.checkedAt - snapshot.lastSuccessAt);
  } finally { await f.monitor.close(); await alerts.close(); }
});

test("one temporary failure clears silently while three failures open one incident", async () => {
  const f = fixture(); await f.start();
  assert.equal((await f.pass("missing")).state, "suspect");
  assert.equal((await f.pass("current")).event, "sample");
  await f.pass("stale"); await f.pass("stale");
  assert.equal((await f.pass("stale")).event, "incident");
  assert.equal((await f.pass("stale")).event, "sample");
  assert.equal(f.emitted.filter(x => x.event === "incident").length, 1);
  await f.monitor.close();
});

test("a successful new observation emits one recovery; a running capture cannot close an incident", async () => {
  const f = fixture(); await f.start();
  for (let i = 0; i < 3; i++) await f.pass("disabled");
  const waiting = await f.pass("waiting");
  assert.equal(waiting.activeIncident, true); assert.equal(waiting.state, "incident");
  const recovered = await f.pass("current");
  assert.equal(recovered.event, "recovered"); assert.equal(recovered.consecutiveFailures, 0);
  assert.equal(recovered.activeIncident, false); assert.equal((await f.pass()).event, "sample");
  assert.equal(f.emitted.filter(x => x.event === "recovered").length, 1);
  await f.monitor.close();
});

test("an in-progress capture breaks an unconfirmed failure streak without claiming recovery", async () => {
  const f = fixture(); await f.start(); await f.pass("missing"); await f.pass("missing");
  const waiting = await f.pass("waiting"); assert.equal(waiting.state, "waiting"); assert.equal(waiting.consecutiveFailures, 0);
  assert.equal((await f.pass("missing")).state, "suspect");
  await f.monitor.close();
});

test("simultaneous ticks share the same pending reader", async () => {
  let release, calls = 0;
  const f = fixture({ inspect: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  f.monitor.start(); const first = f.monitor.tick(), second = f.monitor.tick();
  await flush(); assert.equal(calls, 1); assert.equal(first, second);
  release(report()); await first; await flush(); await f.monitor.close();
});

test("a stuck reader times out, cannot overlap or report a late success, and can subsequently recover", async () => {
  let release, calls = 0, signal;
  const f = fixture({ inspect: (_directory, options) => { calls++; signal = options.signal;
    return calls === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve(report("current", f.now())); } });
  f.monitor.start(); const pending = f.monitor.tick(); await flush();
  f.fire(15000); assert.equal((await pending).code, "MONITOR_TIMEOUT"); assert.equal(signal.aborted, true);
  await f.pass(); assert.equal((await f.pass()).event, "incident"); assert.equal(calls, 1);
  const count = f.emitted.length; release(report()); await flush(); await flush();
  assert.equal(f.emitted.length, count);
  assert.equal((await f.pass()).event, "recovered"); assert.equal(calls, 2);
  await f.monitor.close();
});

test("closing while reading aborts promptly and emits no late operational proof", async () => {
  let signal, release;
  const f = fixture({ inspect: (_directory, options) => { signal = options.signal; return new Promise(resolve => { release = resolve; }); } });
  f.monitor.start(); await flush();
  await f.monitor.close(); assert.equal(signal.aborted, true); assert.equal(f.timers.size, 0);
  release(report()); await flush(); await flush();
  assert.equal(f.emitted.length, 0); assert.equal(await f.monitor.tick(), null);
  f.monitor.start(); assert.equal(f.timers.size, 0);
});

test("closing before start allocates no reader or timer", async () => {
  const f = fixture(); await f.monitor.close(); f.monitor.start();
  assert.equal(await f.monitor.tick(), null); assert.equal(f.calls(), 0); assert.equal(f.timers.size, 0);
});

test("raw errors, inconsistent status and hostile getters are converted to fixed neutral codes", async () => {
  let invoked = 0;
  const bad = { ...report().report, secret: marker };
  const accessor = { report: report().report };
  Object.defineProperty(accessor, "exitCode", { get() { invoked++; throw new Error(marker); }, enumerable: true });
  for (const inspect of [async () => { throw new Error(marker); }, async () => ({ report: bad, exitCode: 0 }), async () => accessor,
    async () => ({ ...report(), exitCode: 1 }), async () => ({ report: { version: 1, type: "private_backup_freshness", status: "error", code: marker }, exitCode: 2 })]) {
    const f = fixture({ inspect }); const output = await f.start();
    assert.equal(output.state, "suspect"); assert.doesNotMatch(JSON.stringify(output), new RegExp(marker));
    await f.monitor.close();
  }
  assert.equal(invoked, 0);
});

test("future and stale observations and backwards clocks never certify a current backup", async () => {
  for (const offset of [1, -16001]) {
    const f = fixture({ inspect: async () => report("current", NOW + offset) });
    assert.equal((await f.start()).code, "MONITOR_INVALID_RESULT"); await f.monitor.close();
  }
  const f = fixture(); await f.start(); f.setNow(NOW - 1);
  assert.equal((await f.monitor.tick()).code, "MONITOR_CLOCK_INVALID");
  await f.monitor.close();
});

test("logging failures cannot interrupt sampling or turn into a recovery receipt", async () => {
  const f = fixture({ emit: () => { throw new Error(marker); } });
  assert.equal((await f.start()).state, "current"); assert.equal((await f.pass()).state, "current");
  await f.monitor.close();
});

test("closed freshness projection refuses contradictory codes, added fields and getters", () => {
  const good = report().report;
  assert.deepEqual(validateBackupFreshnessReport(good), good);
  for (const value of [{ ...good, code: "BACKUP_STALE", status: "attention" }, { ...good, code: "CAPTURE_RUNNING", status: "attention" },
    { ...good, copyStatus: "verified" }, { ...good, private: marker }, { ...good, ageMilliseconds: 0 }]) {
    assert.throws(() => validateBackupFreshnessReport(value), { code: "BACKUP_CHECK_INPUT" });
  }
});

const supervisorArgs = ["start", "--runtime-directory", "/srv/app-reviewed", "--runtime-head", "a".repeat(40), "--runtime-tree", "b".repeat(40),
  "--private-directory", "/srv/private-runtime", "--operations-directory", "/srv/private-backups", "--private-path-mode", "linux-dirfd"];
function processFixture(makeMonitor) {
  const events = [], output = [];
  const dependencies = { environment: { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd", PORT: "3000" }, execArgv: [],
    outputStream: { write: value => output.push(value) }, makeMonitor,
    makeSupervisor: () => ({ start: async () => events.push("application_started"), close: async () => events.push("application_closed"), finished: Promise.resolve({ failed: false }) }) };
  return { events, output, dependencies };
}

test("supervisor check mode cannot create a monitor or an application", async () => {
  const f = processFixture(() => assert.fail("must not monitor"));
  f.dependencies.makeSupervisor = () => assert.fail("must not supervise");
  f.dependencies.preflight = async () => config;
  await supervise(["check", ...supervisorArgs.slice(1)], f.dependencies);
  assert.equal(f.output.length, 1); assert.match(f.output[0], /backupStarted":false/);
});

test("monitor creation, startup and cleanup failures leave application supervision intact", async () => {
  for (const phase of ["create", "start", "close"]) {
    const f = processFixture(() => {
      if (phase === "create") throw new Error(marker);
      return { start() { if (phase === "start") throw new Error(marker); }, close: async () => { if (phase === "close") throw new Error(marker); } };
    });
    await supervise(supervisorArgs, f.dependencies);
    assert.deepEqual(f.events, ["application_started", "application_closed"]);
    assert.match(f.output.join(""), /MONITOR_UNAVAILABLE/); assert.doesNotMatch(f.output.join(""), new RegExp(marker));
  }
});

test("supervisor startup precedes monitoring and both close on an abort", async () => {
  const cancellation = new AbortController(), events = [];
  let finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const f = processFixture(() => ({ start: () => events.push("monitor_started"), close: async () => events.push("monitor_closed") }));
  f.dependencies.signal = cancellation.signal;
  f.dependencies.makeSupervisor = () => ({ start: async () => events.push("application_started"),
    close: async () => { events.push("application_closed"); finish({ failed: false }); }, finished });
  const operation = supervise(supervisorArgs, f.dependencies); await flush();
  cancellation.abort(); await operation;
  assert.equal(events[0], "application_started"); assert.equal(events[1], "monitor_started");
  assert.ok(events.includes("monitor_closed")); assert.ok(events.includes("application_closed"));
});
