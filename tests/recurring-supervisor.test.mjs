import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { parseRecurringArguments, recurringCheckpointDue, createRecurringSupervisor, recurringPreflight, checkpointProcess } from "../server/backup/recurring-supervisor.mjs";
import { main } from "../scripts/start-recurring-private-messaging.mjs";
import { runManagedClosures } from "../server/backup/managed-closures.mjs";

const NOW = Date.UTC(2026, 9, 18, 12);
const configuration = { version: 1, enabled: true, recipientSha256: "a".repeat(64), hourUtc: 5, minuteUtc: 15 };
const environment = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd", PORT: "3000" };
const args = command => [command, "--runtime-directory", "/srv/app-reviewed", "--runtime-head", "a".repeat(40), "--runtime-tree", "b".repeat(40),
  "--private-directory", "/srv/private-runtime", "--operations-directory", "/srv/private-backups", "--private-path-mode", "linux-dirfd"];
const options = parseRecurringArguments(args("start"));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(overrides = {}) {
  const events = [], reports = [], notices = [];
  let lastAttemptAt = null, lastSuccessAt = null, onUnexpectedExit;
  const runtime = { async start() { events.push("start"); return { ready: true }; },
    async stop() { events.push("stop"); return { exitCode: 0, signal: null }; }, async destroy() { events.push("destroy"); } };
  const dependencies = { environment, clock: () => NOW, readConfiguration: async () => ({ ...configuration }),
    history: async () => ({ records: reports, lastAttemptAt, lastSuccessAt }),
    lock: async (_directory, operation) => { events.push("lock"); return operation(); },
    append: async (_directory, report) => { events.push(`record:${report.status}`); reports.push(report);
      lastAttemptAt = report.startedAt; if (report.status === "succeeded") lastSuccessAt = report.finishedAt; },
    preflight: async () => { events.push("preflight"); return { ...configuration }; }, source: async () => { events.push("source"); },
    checkpoint: async (_command, _options, destination) => { events.push("capture"); assert.match(destination, /^\/srv\/private-backups\/capture-\d+-[a-f0-9]{16}$/); return { saved: true }; },
    encrypt: async value => { events.push("encrypt"); assert.equal(value.recipientSha256, configuration.recipientSha256); return { encrypted: true }; },
    makeRuntime: value => { onUnexpectedExit = value.onUnexpectedExit; return runtime; }, emit: value => notices.push(value),
    schedule: () => ({ timer: true }), unschedule() {}, ...overrides };
  const supervisor = createRecurringSupervisor(options, dependencies);
  return { supervisor, events, reports, notices, runtime, unexpected: () => onUnexpectedExit() };
}

test("fixed arguments require reviewed runtime identities and separate private roots", () => {
  assert.equal(parseRecurringArguments(args("check")).command, "check");
  for (const value of [[], [...args("start"), "--shell", "secret"], args("start").map(x => x === "--runtime-head" ? "--arbitrary" : x),
    args("start").map(x => x === "/srv/private-backups" ? "/srv/private-runtime/nested" : x),
    args("start").map(x => x === "/srv/private-backups" ? "/srv/app-reviewed/backups" : x),
    args("start").map(x => x === "a".repeat(40) ? "short" : x)]) assert.throws(() => parseRecurringArguments(value), { code: "RECURRING_SUPERVISOR_USAGE" });
});

test("concurrent starts cannot create a second application or timer", async () => {
  const entered = deferred(), release = deferred(); let scheduled = 0;
  const f = fixture({ source: async () => { entered.resolve(); await release.promise; },
    readConfiguration: async () => ({ ...configuration, enabled: false }), schedule: () => { scheduled++; return {}; } });
  const first = f.supervisor.start(); await entered.promise;
  await assert.rejects(f.supervisor.start(), { code: "RECURRING_SUPERVISOR_RUNTIME" });
  release.resolve(); await first; await f.supervisor.tick(); await Promise.resolve();
  assert.equal(scheduled, 1); assert.equal(f.events.filter(x => x === "start").length, 1); await f.supervisor.close();
});

test("daily schedule catches the first installation but does not retry a recorded failed attempt", () => {
  assert.equal(recurringCheckpointDue(NOW, configuration, { lastAttemptAt: null }), true);
  assert.equal(recurringCheckpointDue(NOW, configuration, { lastAttemptAt: NOW }), false);
  assert.equal(recurringCheckpointDue(NOW + 86400000, configuration, { lastAttemptAt: NOW }), true);
  assert.equal(recurringCheckpointDue(NOW, { ...configuration, enabled: false }, { lastAttemptAt: null }), false);
  assert.throws(() => recurringCheckpointDue(NOW, configuration, { lastAttemptAt: NOW + 1 }));
});

test("confirmed closure takes priority over capture, with one drain shared by concurrent ticks", async () => {
  let pending = false, status = "stopped", capability = null;
  const events = [], operations = { async hasPending() { return pending; }, async preflight(guard) { await guard(); },
    async run(guard) { await guard(); events.push("erase"); pending = false; return { completedReceipts: 1 }; } };
  const runtime = { state: () => ({ status }), async start() { events.push("start"); status = "running"; },
    async stop() { events.push("stop"); status = "stopped"; return { exitCode: 0, signal: null }; }, async destroy() { status = "stopped"; } };
  const f = fixture({ closureOperations: operations, makeRuntime(value) { capability = value.accountClosures; return runtime; },
    runClosures: args => runManagedClosures(args, { lock: (_directory, work) => work({ async assertReady() {} }) }),
    readConfiguration: async () => ({ ...configuration, enabled: false }), checkpoint: () => assert.fail("No capture during closure") });
  await f.supervisor.start(); await f.supervisor.tick(); assert.equal(capability, true); pending = true;
  const first = f.supervisor.tick(); assert.equal(f.supervisor.tick(), first); await first;
  assert.deepEqual(events, ["start", "stop", "erase", "start"]);
  assert.equal(f.notices.some(value => value.type === "account_closures" && value.status === "completed"), true);
  await f.supervisor.close();
});

test("a queued closure is resolved before the first managed listener after supervisor restart", async () => {
  let pending = true, status = "stopped"; const events = [];
  const runtime = { state: () => ({ status }), async start() { if (status !== "running") events.push("listen"); status = "running"; },
    async stop() { status = "stopped"; return { exitCode: 0, signal: null }; }, async destroy() { status = "stopped"; } };
  const operations = { async hasPending() { return pending; }, async preflight(guard) { await guard(); },
    async run(guard) { await guard(); assert.equal(status, "stopped"); events.push("erase"); pending = false; return { completedReceipts: 1 }; } };
  const f = fixture({ closureOperations: operations, makeRuntime: () => runtime, readConfiguration: async () => ({ ...configuration, enabled: false }),
    runClosures: args => runManagedClosures(args, { lock: (_directory, work) => work({ async assertReady() {} }) }) });
  await f.supervisor.start(); await f.supervisor.tick(); assert.deepEqual(events, ["erase", "listen"]); await f.supervisor.close();
});

test("corrupt intent discovery or uncertain erasure ends the supervisor instead of retrying or resuming", async () => {
  for (const phase of ["discovery", "erasure"]) {
    let pending = false;
    const operations = { async hasPending() { if (pending && phase === "discovery") throw new Error("Synthetic private error"); return pending; }, async preflight() {}, async run() {} };
    const f = fixture({ closureOperations: operations, readConfiguration: async () => ({ ...configuration, enabled: false }),
      runClosures: async () => { throw new Error("Synthetic private error"); } });
    await f.supervisor.start(); await f.supervisor.tick(); pending = true; await f.supervisor.tick();
    assert.deepEqual(await f.supervisor.finished, { failed: true }); assert.equal(f.events.at(-1), "destroy");
    assert.equal(f.events.filter(value => value === "start").length, 1); assert.doesNotMatch(JSON.stringify(f.notices), /private error/);
  }
});

test("journal precedes stop; capture and encryption finish before a ready runtime marks success", async () => {
  const f = fixture();
  await f.supervisor.start(); const report = await f.supervisor.tick();
  assert.equal(report.status, "succeeded"); assert.equal(report.runtimeResumed, true);
  assert.deepEqual(f.events, ["source", "start", "lock", "preflight", "record:running", "stop", "capture", "encrypt", "source", "start", "record:succeeded"]);
  assert.equal(f.reports.length, 2); assert.equal(await f.supervisor.tick(), null);
  await f.supervisor.close(); assert.equal(f.events.at(-1), "destroy");
});

test("a closure published during capture preflight or HTTP drain keeps producers stopped before any reopen", async () => {
  for (const phase of ["preflight", "drain", "capture_failure"]) {
    let pending = false;
    const operations = { async hasPending() { return pending; }, async preflight() {}, async run() { assert.fail("No implicit destructive retry in the capture cycle"); } };
    const f = fixture({ closureOperations: operations,
      preflight: async () => { if (phase === "preflight") pending = true; return { ...configuration }; },
      ...(phase === "capture_failure" ? { checkpoint: async () => { pending = true; throw new Error("Synthetic capture failure"); } } : {}) });
    if (phase === "drain") f.runtime.stop = async () => { pending = true; f.events.push("stop"); return { exitCode: 0, signal: null }; };
    await f.supervisor.start(); const report = await f.supervisor.tick();
    assert.equal(report.runtimeResumed, false); assert.equal(report.status, "failed");
    assert.equal(f.events.filter(value => value === "start").length, 1);
    assert.deepEqual(await f.supervisor.finished, { failed: true });
    assert.equal(f.events.at(-1), "destroy"); await f.supervisor.close();
  }
});

test("missing or unsafe backup configuration leaves the application available and emits only a fixed code", async () => {
  const f = fixture({ readConfiguration: async () => { throw new Error("password=secret"); } });
  await f.supervisor.start(); await f.supervisor.tick(); await f.supervisor.tick();
  assert.deepEqual(f.events, ["source", "start"]); assert.equal(f.notices.filter(x => x.type === "recurring_backup_notice").length, 1);
  assert.doesNotMatch(JSON.stringify(f.notices), /password|secret/); await f.supervisor.close();
});

test("disabled configuration never reads history or stops the runtime", async () => {
  const f = fixture({ readConfiguration: async () => ({ ...configuration, enabled: false }), history: () => assert.fail("disabled history") });
  await f.supervisor.start(); assert.equal(await f.supervisor.tick(), null); assert.deepEqual(f.events, ["source", "start"]);
  await f.supervisor.close();
});

test("a failed initial journal keeps the untouched application running", async () => {
  const f = fixture({ append: async () => { throw new Error("disk full"); } });
  await f.supervisor.start(); const report = await f.supervisor.tick();
  assert.equal(report.code, "JOURNAL_FAILED");
  assert.equal(f.events.includes("stop"), false); assert.equal(f.events.includes("destroy"), false);
  assert.equal(f.supervisor.state().closed, false);
  await f.supervisor.close();
});

test("lock collision and failed preflight cannot interrupt the application", async () => {
  for (const overrides of [{ lock: async () => { throw Object.assign(new Error("private"), { code: "RECURRING_FILES_LOCKED" }); } },
    { preflight: async () => { throw new Error("private"); } }, { preflight: async () => ({ ...configuration, recipientSha256: "b".repeat(64) }) }]) {
    const f = fixture(overrides); await f.supervisor.start(); await f.supervisor.tick();
    assert.equal(f.events.includes("stop"), false); assert.equal(f.reports.length, 0); await f.supervisor.close();
  }
});

test("a concurrent tick shares the running attempt, with one capture and one stop", async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({ checkpoint: async () => { entered.resolve(); await release.promise; return { saved: true }; } });
  await f.supervisor.start(); await entered.promise;
  const first = f.supervisor.tick(), second = f.supervisor.tick(); assert.equal(first, second);
  release.resolve(); await first; assert.equal(f.events.filter(x => x === "stop").length, 1); assert.equal(f.reports.length, 2); await f.supervisor.close();
});

test("capture or encryption failure still resumes the same reviewed application", async () => {
  for (const step of ["checkpoint", "encrypt"]) {
    const f = fixture({ [step]: async () => { throw new Error("private-data"); } });
    await f.supervisor.start(); const report = await f.supervisor.tick();
    assert.equal(report.status, "failed"); assert.equal(report.runtimeResumed, true);
    assert.equal(f.events.filter(x => x === "start").length, 2); assert.doesNotMatch(JSON.stringify(f.notices), /private-data/); await f.supervisor.close();
  }
});

test("unexpected runtime exit produces a failed supervisor outcome for the hosting manager", async () => {
  const f = fixture({ readConfiguration: async () => ({ ...configuration, enabled: false }) });
  await f.supervisor.start(); await f.supervisor.tick(); f.unexpected();
  assert.deepEqual(await f.supervisor.finished, { failed: true }); assert.equal(f.events.at(-1), "destroy");
});

test("global shutdown during capture aborts the operation and never restarts an application", async () => {
  const entered = deferred();
  const f = fixture({ checkpoint: async (_command, _options, _destination, { signal }) => {
    entered.resolve(); await new Promise(done => { signal.addEventListener("abort", done, { once: true }); if (signal.aborted) done(); }); throw new Error("aborted");
  } });
  await f.supervisor.start(); await entered.promise; await f.supervisor.close();
  assert.equal(f.events.filter(x => x === "start").length, 1); assert.equal(f.reports.at(-1).code, "CANCELLED");
  assert.deepEqual(await f.supervisor.finished, { failed: false });
});

test("preflight validates public recipient, source, free space and capture tools without starting anything", async () => {
  const events = [];
  const result = await recurringPreflight(options, { environment, destination: "/srv/private-backups/probe",
    readConfiguration: async () => { events.push("configuration"); return configuration; },
    source: async () => { events.push("source"); }, inspectRecipient: async () => { events.push("recipient"); },
    inspectSpace: async () => { events.push("space"); }, checkpoint: async command => { events.push(command); } });
  assert.deepEqual(events, ["configuration", "source", "recipient", "space", "check-application"]); assert.equal(result, configuration);
});

test("check command prints a safe result and cannot start a supervisor or capture", async () => {
  let output = "";
  const value = await main(args("check"), { environment, execArgv: [], preflight: async () => configuration,
    makeSupervisor: () => assert.fail("must not supervise"), outputStream: { write: value => { output += value; } } });
  assert.equal(value.started, false); assert.equal(value.backupStarted, false); assert.equal(JSON.parse(output).status, "passed");
  assert.doesNotMatch(output, /recipientSha256|runtimeDirectory/);
  await assert.rejects(main(args("check"), { environment: { ...environment, NODE_OPTIONS: "private" }, execArgv: [] }), { code: "RECURRING_SUPERVISOR_ENVIRONMENT" });
});

function processFixture(payload, exitCode = 0) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = signal => { queueMicrotask(() => child.emit("close", null, signal)); return true; };
  queueMicrotask(() => { child.stdout.emit("data", Buffer.from(payload)); child.emit("close", exitCode, null); });
  return child;
}

test("checkpoint subprocess accepts the precise application profile and discards all other output", async () => {
  const value = { status: "application_checkpoint_saved", profile: "messaging-photos-notify-recovery-crm-broadcast-application",
    tables: 30, migrations: 30, operationsCovered: true, archiveListed: true, archiveContentsVerified: true, archive: { sha256: "c".repeat(64) }, started: false, migrationPerformed: false };
  let called;
  const accepted = await checkpointProcess("capture-application", options, "/srv/private-backups/capture-test", { environment },
    { spawnClient: (_command, args, config) => { called = { args, config }; return processFixture(JSON.stringify(value)); } });
  assert.deepEqual(accepted, { saved: true, precheckPassed: false }); assert.ok(called.args.includes("--offline")); assert.equal(called.config.stdio[0], "ignore");
  assert.equal(called.config.stdio[3], "ipc"); assert.match(called.args[0], /private-checkpoint-child\.mjs$/);
  assert.equal(called.args[called.args.indexOf("--operations-directory") + 1], options.operationsDirectory);
  for (const payload of [JSON.stringify({ ...value, operationsCovered: false }), JSON.stringify({ ...value, profile: "old" }), "private error password=secret", "x".repeat(17000)]) {
    await assert.rejects(checkpointProcess("capture-application", options, "/srv/private-backups/capture-test", { environment },
      { spawnClient: () => processFixture(payload) }), error => error.code === "RECURRING_SUPERVISOR_CHECKPOINT" && !error.message.includes("secret"));
  }
});

test("capture timeout and cancellation wait for actual close, escalating an ignored SIGTERM", async () => {
  for (const mode of ["timeout", "abort"]) {
    const cancellation = new AbortController(), killed = [], closeAllowed = deferred();
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = signal => { killed.push(signal); if (signal === "SIGKILL") closeAllowed.resolve(); return true; };
    let settled = false;
    const running = checkpointProcess("capture-application", options, "/srv/private-backups/capture-test", { environment, signal: cancellation.signal },
      { spawnClient: () => child, timeoutMilliseconds: mode === "timeout" ? 10 : 1000, killMilliseconds: 10 });
    void running.then(() => { settled = true; }, () => { settled = true; });
    if (mode === "abort") cancellation.abort();
    await closeAllowed.promise;
    assert.equal(settled, false); assert.deepEqual(killed, ["SIGTERM", "SIGKILL"]);
    child.emit("close", null, "SIGKILL");
    await assert.rejects(running, { code: mode === "abort" ? "RECURRING_SUPERVISOR_ABORTED" : "RECURRING_SUPERVISOR_TIMEOUT" });
    assert.equal(settled, true);
  }
});
