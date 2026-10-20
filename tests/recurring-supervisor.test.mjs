import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { parseRecurringArguments, recurringCheckpointDue, createRecurringSupervisor, recurringPreflight, checkpointProcess } from "../server/backup/recurring-supervisor.mjs";
import { main } from "../scripts/start-recurring-private-messaging.mjs";
import { runManagedClosures, resumeManagedLocalClosureRuntime } from "../server/backup/managed-closures.mjs";
import { witnessOriginFixture } from "./fixtures/witness-origin.mjs";
import { readdir } from "node:fs/promises";

const NOW = Date.UTC(2026, 9, 18, 12);
const configuration = { version: 1, enabled: true, recipientSha256: "a".repeat(64), hourUtc: 5, minuteUtc: 15 };
const environment = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd", PORT: "3000" };
const args = command => [command, "--runtime-directory", "/srv/app-reviewed", "--runtime-head", "a".repeat(40), "--runtime-tree", "b".repeat(40),
  "--private-directory", "/srv/private-runtime", "--operations-directory", "/srv/private-backups", "--private-path-mode", "linux-dirfd"];
const options = parseRecurringArguments(args("start"));
const witnessArgs = command => [...args(command), "--witness-operator-directory", "/srv/witness-origin",
  ...(command === "plan-witness" ? ["--witness-destination", "a".repeat(32)] : ["--witness-plan-sha256", "c".repeat(64)])];
const observerArgs = command => [...args(command), "--witness-operator-directory", "/srv/witness-origin", "--witness-contract-sha256", "d".repeat(64)];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const syntheticStartupProof = async guard => { await guard(); return { verified: true, completedReceipts: 0, registrySha256: "e".repeat(64), witnessRevision: 1 }; };

function fixture(overrides = {}) {
  const events = [], reports = [], notices = [];
  let lastAttemptAt = null, lastSuccessAt = null, onUnexpectedExit, status = "stopped";
  const runtime = { state: () => ({ status }), async start() { events.push("start"); status = "running"; return { ready: true }; },
    async stop() { events.push("stop"); status = "stopped"; return { exitCode: 0, signal: null }; }, async destroy() { events.push("destroy"); status = "stopped"; } };
  const dependencies = { environment, clock: () => NOW, readConfiguration: async () => ({ ...configuration }),
    history: async () => ({ records: reports, lastAttemptAt, lastSuccessAt }),
    lock: async (_directory, operation) => { events.push("lock"); return operation({ async assertReady() {} }); },
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

test("initial witness commands require explicit private operator storage and the correct plan identity", () => {
  for (const command of ["plan-witness", "check-witness", "prepare-witness"]) assert.equal(parseRecurringArguments(witnessArgs(command)).command, command);
  for (const command of ["plan-witness", "check-witness", "prepare-witness"]) assert.throws(() => parseRecurringArguments(args(command)));
  for (const invalid of [[...args("start"), ...witnessArgs("check-witness").slice(13)],
    witnessArgs("plan-witness").map(x => x === "--witness-destination" ? "--witness-plan-sha256" : x),
    witnessArgs("check-witness").map(x => x === "/srv/witness-origin" ? "/srv/private-backups/witness" : x),
    [...witnessArgs("prepare-witness"), "--offline", "true"]]) assert.throws(() => parseRecurringArguments(invalid));
  assert.throws(() => createRecurringSupervisor(parseRecurringArguments(witnessArgs("prepare-witness")), { environment }), { code: "RECURRING_SUPERVISOR_CONFIGURATION" });
  assert.throws(() => createRecurringSupervisor(parseRecurringArguments(witnessArgs("check-witness")), { environment }), { code: "RECURRING_SUPERVISOR_CONFIGURATION" });
});

test("plan and check CLI commands never construct a supervisor, listener, backup, monitor or mail worker", async () => {
  for (const command of ["plan-witness", "check-witness"]) {
    let output = "", called = "";
    const operations = { async plan() { called = "plan"; return { type: "witness_origin_plan", started: false, prepared: false }; },
      async check() { called = "check"; return { type: "witness_origin_precheck", started: false, prepared: false }; } };
    const result = await main(witnessArgs(command), { environment, execArgv: [], makeWitnessOrigin: () => operations,
      makeSupervisor: () => assert.fail("No managed process during planning/check"), makeMonitor: () => assert.fail("No monitor"), makeAlerts: () => assert.fail("No alert transport"),
      outputStream: { write(value) { output += value; } } });
    assert.equal(called, command === "plan-witness" ? "plan" : "check"); assert.equal(result.started, false); assert.equal(JSON.parse(output).prepared, false);
  }
});

test("ordinary start composes daily backups, monitor and alerts without any witness or closure owner", async () => {
  const events = [], observed = [], monitorReport = { version: 1, type: "synthetic_backup_monitor", status: "current" };
  let output = "";
  const forbidden = () => assert.fail("Ordinary messaging must not construct a witness, recovery listener or socket");
  const result = await main(args("start"), { environment, execArgv: [],
    makeWitnessOrigin: forbidden, makeWitnessObserver: forbidden, makeWitnessRecovery: forbidden, makeRecoveryServer: forbidden,
    makeSupervisor(selected, dependencies) {
      events.push("supervisor:created"); assert.deepEqual(selected, options);
      assert.equal(Object.hasOwn(dependencies, "closureOperations"), false);
      assert.equal(Object.hasOwn(dependencies, "witnessControl"), false);
      assert.equal(Object.hasOwn(dependencies, "witnessOriginOperations"), false);
      assert.deepEqual(dependencies.environment, environment);
      return { async start() { events.push("supervisor:start"); }, finished: Promise.resolve({ failed: false }),
        async close() { events.push("supervisor:close"); } };
    },
    makeAlerts(selected) {
      events.push("alerts:created"); assert.deepEqual(selected, { operationsDirectory: options.operationsDirectory, privateDirectory: options.privateDirectory });
      return { async observe(report) { events.push("alerts:observe"); observed.push(report); }, async close() { events.push("alerts:close"); } };
    },
    makeMonitor(selected, dependencies) {
      events.push("monitor:created"); assert.deepEqual(selected, { operationsDirectory: options.operationsDirectory });
      return { async start() { events.push("monitor:start"); dependencies.emit(monitorReport); }, async close() { events.push("monitor:close"); } };
    }, outputStream: { write(value) { output += value; } } });
  assert.deepEqual(result, { version: 1, type: "recurring_supervisor", status: "stopped" });
  assert.deepEqual(events, ["supervisor:created", "supervisor:start", "alerts:created", "monitor:created", "monitor:start", "alerts:observe", "monitor:close", "supervisor:close", "alerts:close"]);
  assert.deepEqual(observed, [monitorReport]); assert.deepEqual(JSON.parse(output), monitorReport);
});

test("an observer cleanup failure still closes the monitor, supervisor and alert worker", async () => {
  const events = [], expected = new Error("synthetic observer cleanup failure");
  await assert.rejects(main(observerArgs("start-witness-observer"), { environment, execArgv: [], outputStream: { write() {} },
    makeWitnessObserver: async () => ({ handler: async () => true, async check() {}, attachMaintenance() {},
      async startRecoveryControl() {}, startObservation() {}, async close() { events.push("observer"); throw expected; } }),
    makeSupervisor: () => ({ async start() {}, async tick() {}, finished: Promise.resolve({ failed: false }),
      async close() { events.push("supervisor"); } }),
    makeMonitor: () => ({ async start() {}, async close() { events.push("monitor"); } }),
    makeAlerts: () => ({ async close() { events.push("alerts"); } }),
  }), error => error === expected);
  assert.deepEqual(events, ["observer", "monitor", "supervisor", "alerts"]);
});

test("observer CLI modes require the existing contract pin and independent private operator root", () => {
  for (const command of ["prepare-witness-enrollment", "check-witness-observer", "start-witness-observer"]) {
    const parsed = parseRecurringArguments(observerArgs(command));
    assert.equal(parsed.command, command); assert.equal(parsed.witnessContractSha256, "d".repeat(64));
    assert.throws(() => parseRecurringArguments(args(command)), { code: "RECURRING_SUPERVISOR_USAGE" });
    for (const invalid of [observerArgs(command).map(value => value === "d".repeat(64) ? "D".repeat(64) : value),
      observerArgs(command).map(value => value === "--witness-contract-sha256" ? "--witness-plan-sha256" : value),
      observerArgs(command).map(value => value === "--witness-contract-sha256" ? "--witness-destination" : value),
      ...["/srv/private-backups/witness", "/srv/private-runtime/witness", "/srv/app-reviewed/witness", "/srv"].map(directory =>
        observerArgs(command).map(value => value === "/srv/witness-origin" ? directory : value)),
      [...observerArgs(command), "--offline", "true"]]) {
      assert.throws(() => parseRecurringArguments(invalid), { code: "RECURRING_SUPERVISOR_USAGE" });
    }
  }
  assert.throws(() => parseRecurringArguments(observerArgs("start")), { code: "RECURRING_SUPERVISOR_USAGE" });
  assert.throws(() => parseRecurringArguments(observerArgs("prepare-witness")), { code: "RECURRING_SUPERVISOR_USAGE" });
});

test("observer check CLI reads the existing contract and always closes without a listener or background worker", async () => {
  for (const rejected of [false, true]) {
    const events = [], controller = new AbortController(); let output = "";
    const observer = { async check() { events.push("check"); if (rejected) throw Object.assign(new Error("Synthetic inaccessible contract"), { code: "WITNESS_OBSERVATION_UNAVAILABLE" });
      return { version: 1, type: "witness_observer_precheck", started: false, closuresEnabled: false }; }, async close() { events.push("close"); } };
    const result = main(observerArgs("check-witness-observer"), { environment, execArgv: [], signal: controller.signal,
      async makeWitnessObserver(options, settings) {
        events.push("construct"); assert.equal(options.command, "check-witness-observer"); assert.equal(options.witnessContractSha256, "d".repeat(64));
        assert.equal(settings.environment, environment); assert.equal(settings.signal, controller.signal); return observer;
      }, makeSupervisor: () => assert.fail("Read-only check cannot construct a supervisor"),
      makeWitnessOrigin: () => assert.fail("Existing contract cannot be prepared again"),
      makeMonitor: () => assert.fail("Read-only check cannot start a monitor"), makeAlerts: () => assert.fail("Read-only check cannot start alerts"),
      outputStream: { write(value) { output += value; } } });
    if (rejected) { await assert.rejects(result, { code: "WITNESS_OBSERVATION_UNAVAILABLE" }); assert.equal(output, ""); }
    else { assert.equal((await result).closuresEnabled, false); assert.equal(JSON.parse(output).started, false); }
    assert.deepEqual(events, ["construct", "check", "close"]);
  }
});

test("explicit enrollment CLI waits for the first capture tick, attaches parent maintenance and closes observer before parent", async () => {
  const events = [], entered = deferred(), release = deferred(); let output = "";
  const handler = async () => true, maintain = async () => {}, fail = () => {};
  const observer = { handler, async checkInitial() { events.push("check-initial"); }, async check() { assert.fail("Enrollment needs the initial check"); },
    attachMaintenance(work, failed) { events.push("attach"); assert.equal(work, maintain); assert.equal(failed, fail); },
    async initialize() { events.push("initialize"); return { version: 1, type: "witness_enrollment_prepared", closuresEnabled: false }; },
    async startRecoveryControl() { events.push("recovery-control"); }, startObservation() { events.push("observe"); }, async close() { events.push("observer-close"); } };
  const result = main(observerArgs("prepare-witness-enrollment"), { environment, execArgv: [],
    async makeWitnessObserver() { events.push("observer-construct"); return observer; },
    makeWitnessOrigin: () => assert.fail("Enrollment cannot recreate the original contract"),
    makeSupervisor(selected, dependencies) {
      events.push("supervisor-construct"); assert.equal(selected.command, "start"); assert.equal(dependencies.witnessControl, handler);
      assert.equal(Object.hasOwn(dependencies, "closureOperations"), false); assert.equal(Object.hasOwn(dependencies, "witnessOriginOperations"), false);
      return { withWitnessMaintenance: maintain, failWitnessObservation: fail,
        async start() { events.push("start"); }, async tick() { events.push("tick"); entered.resolve(); await release.promise; events.push("tick-finished"); },
        finished: Promise.resolve({ failed: false }), async close() { events.push("supervisor-close"); } };
    }, makeAlerts() { events.push("alerts"); return { async close() { events.push("alerts-close"); } }; },
    makeMonitor() { events.push("monitor"); return { async start() { events.push("monitor-start"); }, async close() { events.push("monitor-close"); } }; },
    outputStream: { write(value) { output += value; } } });
  await entered.promise;
  assert.deepEqual(events, ["observer-construct", "check-initial", "supervisor-construct", "attach", "start", "tick"]);
  release.resolve(); assert.equal((await result).status, "stopped");
  assert.deepEqual(events.slice(6), ["tick-finished", "initialize", "recovery-control", "observe", "alerts", "monitor", "monitor-start", "observer-close", "monitor-close", "supervisor-close", "alerts-close"]);
  assert.equal(JSON.parse(output).closuresEnabled, false);
});

test("ordinary observer start never enrolls again and keeps its channel attached to the normalized parent", async () => {
  const events = [], handler = async () => true;
  await main(observerArgs("start-witness-observer"), { environment, execArgv: [],
    async makeWitnessObserver() { return { handler, async check() { events.push("check"); }, async checkInitial() { assert.fail("No original enrollment on restart"); },
      async initialize() { assert.fail("Restart cannot initialize a witness"); }, attachMaintenance() { events.push("attach"); },
      async startRecoveryControl() { events.push("recovery-control"); }, startObservation() { events.push("observe"); }, async close() { events.push("observer-close"); } }; },
    makeSupervisor(selected, dependencies) { assert.equal(selected.command, "start"); assert.equal(dependencies.witnessControl, handler);
      return { withWitnessMaintenance() {}, failWitnessObservation() {}, async start() { events.push("start"); }, async tick() { events.push("tick"); },
        finished: Promise.resolve({ failed: false }), async close() { events.push("supervisor-close"); } }; },
    makeAlerts: () => ({ async close() {} }), makeMonitor: () => ({ async start() {}, async close() {} }), outputStream: { write() {} } });
  assert.deepEqual(events, ["check", "attach", "start", "tick", "recovery-control", "observe", "observer-close", "supervisor-close"]);
});

test("an observer failure before or during enrollment releases it and never starts unrelated workers", async () => {
  for (const stage of ["initial-check", "attach", "initialize"]) {
    const events = [], failure = Object.assign(new Error("Synthetic enrollment failure"), { code: "WITNESS_ENROLLMENT_UNAVAILABLE" });
    await assert.rejects(main(observerArgs("prepare-witness-enrollment"), { environment, execArgv: [],
      async makeWitnessObserver() { return { handler: async () => true,
        async checkInitial() { events.push("check"); if (stage === "initial-check") throw failure; },
        attachMaintenance() { events.push("attach"); if (stage === "attach") throw failure; },
        async initialize() { events.push("initialize"); throw failure; }, startObservation() { assert.fail("No observation after failed enrollment"); },
        async close() { events.push("observer-close"); } }; },
      makeSupervisor() { events.push("construct"); return { withWitnessMaintenance() {}, failWitnessObservation() {}, async start() { events.push("start"); },
        async tick() { events.push("tick"); }, finished: Promise.resolve({ failed: false }), async close() { events.push("supervisor-close"); } }; },
      makeMonitor: () => assert.fail("No monitor after failed enrollment"), makeAlerts: () => assert.fail("No alert worker after failed enrollment"), outputStream: { write() {} } }), failure);
    assert.equal(events.at(-1), stage === "initial-check" ? "observer-close" : "supervisor-close");
    if (stage !== "initial-check") assert.ok(events.indexOf("observer-close") < events.indexOf("supervisor-close"));
    else assert.equal(events.includes("construct"), false);
  }
});

test("aborting an observer CLI start closes its channel before the parent and cannot initialize", async () => {
  const events = [], controller = new AbortController();
  await main(observerArgs("prepare-witness-enrollment"), { environment, execArgv: [], signal: controller.signal,
    async makeWitnessObserver() { return { handler: async () => true, async checkInitial() {}, attachMaintenance() {},
      async initialize() { assert.fail("No initialization after cancellation"); }, startObservation() { assert.fail("No observation after cancellation"); },
      close() { events.push("observer-close"); } }; },
    makeSupervisor() { return { withWitnessMaintenance() {}, failWitnessObservation() {}, async start() { events.push("start"); controller.abort(); },
      async tick() { assert.fail("No capture tick after cancellation"); }, finished: Promise.resolve({ failed: false }), async close() { events.push("supervisor-close"); } }; },
    makeMonitor: () => assert.fail("No monitor after cancellation"), makeAlerts: () => assert.fail("No alerts after cancellation"), outputStream: { write() {} } });
  assert.equal(events[0], "start"); assert.equal(events[1], "observer-close"); assert.equal(events[2], "supervisor-close");
});

test("cancellation during the startup capture tick cannot initialize an observer or start background workers", async () => {
  const events = [], controller = new AbortController(), entered = deferred(), release = deferred();
  const operation = main(observerArgs("prepare-witness-enrollment"), { environment, execArgv: [], signal: controller.signal,
    async makeWitnessObserver() { return { handler: async () => true, async checkInitial() {}, attachMaintenance() {},
      async initialize() { assert.fail("No initialization after cancellation during startup tick"); },
      startObservation() { assert.fail("No observation after cancellation during startup tick"); },
      close() { events.push("observer-close"); } }; },
    makeSupervisor() { return { withWitnessMaintenance() {}, failWitnessObservation() {}, async start() { events.push("start"); },
      async tick() { events.push("tick"); entered.resolve(); await release.promise; events.push("tick-finished"); },
      finished: Promise.resolve({ failed: false }), async close() { events.push("supervisor-close"); } }; },
    makeMonitor: () => { events.push("monitor"); assert.fail("No monitor after cancellation during startup tick"); },
    makeAlerts: () => { events.push("alerts"); assert.fail("No alerts after cancellation during startup tick"); }, outputStream: { write() { events.push("output"); } } });
  await entered.promise; controller.abort();
  assert.deepEqual(events, ["start", "tick", "observer-close", "supervisor-close"]);
  release.resolve(); assert.equal((await operation).status, "stopped");
  assert.equal(events[4], "tick-finished");
  assert.ok(events.indexOf("observer-close") < events.indexOf("supervisor-close"));
  assert.equal(events.includes("monitor"), false); assert.equal(events.includes("alerts"), false); assert.equal(events.includes("output"), false);
});

test("supervisor prepares the actual planned contract once, with its normal application and no erasure capability", async t => {
  const f = await witnessOriginFixture(t), plan = await f.planner.plan(), events = [], notices = [];
  let status = "stopped", capability;
  const runtime = { state: () => ({ status }), async start() { events.push("start"); status = "running"; },
    async stop() { assert.ok((await readdir(f.dirs.operations)).includes("recurring-backup.lock")); events.push("stop"); status = "stopped"; return { exitCode: 0, signal: null }; },
    async destroy() { status = "stopped"; } };
  const supervisor = createRecurringSupervisor({ ...f.options, command: "prepare-witness" }, { environment, source: f.source,
    witnessOriginOperations: f.bind(plan), makeRuntime(value) { capability = value.accountClosures; return runtime; },
    readConfiguration: async () => ({ ...configuration, enabled: false }), schedule: () => null, unschedule() {}, emit: value => notices.push(value) });
  t.after(() => supervisor.close()); await supervisor.start(); await supervisor.tick(); await supervisor.tick();
  assert.equal(capability, false); assert.deepEqual(events, ["start", "stop", "start"]);
  assert.equal(notices.filter(x => x.type === "witness_origin_prepared").length, 1);
  assert.equal(notices.find(x => x.type === "witness_origin_prepared").externalWitnessConfirmed, false);
  for (const extra of [{ closureOperations: { hasPending() {}, preflight() {}, run() {} } }, { witnessControl: async () => true }]) {
    assert.throws(() => createRecurringSupervisor({ ...f.options, command: "prepare-witness" }, { environment, witnessOriginOperations: f.bind(plan), ...extra }));
  }
});

test("an unavailable original plan prevents the first listener and is never repaired by supervisor startup", async () => {
  let starts = 0;
  const supervisor = createRecurringSupervisor(parseRecurringArguments(witnessArgs("prepare-witness")), { environment, source: async () => {},
    witnessOriginOperations: { async check() { throw new Error("Synthetic private plan lost"); }, async prepare() { assert.fail("No initialization after loss"); } },
    makeRuntime: () => ({ async start() { starts++; }, async destroy() {} }), schedule: () => null, unschedule() {} });
  await assert.rejects(supervisor.start()); assert.equal(starts, 0); await supervisor.close();
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
  const events = [], operations = { verifyStartup: syntheticStartupProof, async hasPending() { return pending; }, async preflight(guard) { await guard(); },
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
  const operations = { verifyStartup: syntheticStartupProof, async hasPending() { return pending; }, async preflight(guard) { await guard(); },
    async run(guard) { await guard(); assert.equal(status, "stopped"); events.push("erase"); pending = false; return { completedReceipts: 1 }; } };
  const f = fixture({ closureOperations: operations, makeRuntime: () => runtime, readConfiguration: async () => ({ ...configuration, enabled: false }),
    runClosures: args => runManagedClosures(args, { lock: (_directory, work) => work({ async assertReady() {} }) }) });
  await f.supervisor.start(); await f.supervisor.tick(); assert.deepEqual(events, ["erase", "listen"]); await f.supervisor.close();
});

test("an explicit local owner uses a fresh local startup check on initial opening and capture reopening", async () => {
  let proofs = 0;
  const operations = { async hasPending() { return false; }, async preflight() {}, async run() { assert.fail("No pending closure"); },
    async verifyStartup(guard) { await guard(); proofs++; return { verified: true, completedReceipts: 1, scope: "local_application" }; } };
  const f = fixture({ closureOperations: operations, resumeClosures: resumeManagedLocalClosureRuntime });
  try {
    await f.supervisor.start(); const report = await f.supervisor.tick();
    assert.equal(report.status, "succeeded"); assert.equal(report.runtimeResumed, true);
    assert.equal(proofs, 2); assert.equal(f.events.filter(event => event === "start").length, 2);
  } finally { await f.supervisor.close(); }
  const strict = fixture({ closureOperations: operations });
  try { await assert.rejects(strict.supervisor.start(), { code: "ERASURE_MAINTENANCE" }); assert.equal(strict.events.includes("start"), false); }
  finally { await strict.supervisor.close(); }
});

test("the selected local opening gate reaches both startup and recurring pending-closure maintenance", async () => {
  let pending = true, runs = 0;
  const operations = { async hasPending() { return pending; }, async preflight(guard) { await guard(); },
    async run(guard) { await guard(); runs++; pending = false; return { completedReceipts: runs }; },
    async verifyStartup(guard) { await guard(); return { verified: true, completedReceipts: runs, scope: "local_application" }; } };
  const f = fixture({ closureOperations: operations, resumeClosures: resumeManagedLocalClosureRuntime,
    readConfiguration: async () => ({ ...configuration, enabled: false }),
    runClosures: parameters => {
      assert.equal(parameters.resumeClosures, resumeManagedLocalClosureRuntime);
      return runManagedClosures(parameters, { lock: (_directory, work) => work({ async assertReady() {} }) });
    } });
  try {
    await f.supervisor.start(); assert.equal(runs, 1); assert.equal(f.runtime.state().status, "running");
    await f.supervisor.tick(); pending = true; await f.supervisor.tick();
    assert.equal(runs, 2); assert.equal(f.runtime.state().status, "running");
    assert.equal(f.events.includes("capture"), false);
  } finally { await f.supervisor.close(); }
});

test("an owner with no pending intent cannot open its first listener without a fresh startup proof", async () => {
  let listened = false;
  const operations = { async hasPending() { return false; }, async preflight() {}, async run() {},
    async verifyStartup() { throw new Error("Synthetic absent witness, never a cached permission"); } };
  const f = fixture({ closureOperations: operations, makeRuntime: () => ({ state: () => ({ status: "stopped" }),
    async start() { listened = true; }, async stop() { return { exitCode: 0, signal: null }; }, async destroy() {} }),
    lock: (_directory, work) => work({ async assertReady() {} }),
    readConfiguration: async () => ({ ...configuration, enabled: false }) });
  try { await assert.rejects(f.supervisor.start()); assert.equal(listened, false); }
  finally { await f.supervisor.close(); }
});

test("every closure owner must implement the startup barrier before any runtime is constructed", () => {
  assert.throws(() => fixture({ closureOperations: { async hasPending() { return false; }, async preflight() {}, async run() {} },
    makeRuntime: () => assert.fail("A legacy owner cannot receive the closure capability") }), { code: "RECURRING_SUPERVISOR_CONFIGURATION" });
});

test("a closure owner verifies every capture reopen under the same exclusion, including after capture failure", async () => {
  for (const mode of ["success", "capture_failure", "proof_failure"]) {
    let held = false, proofs = 0;
    const operations = { async hasPending() { return false; }, async preflight() {}, async run() { assert.fail("No destructive work"); },
      async verifyStartup(guard) {
        assert.equal(held, true); await guard(); proofs++;
        if (mode === "proof_failure" && proofs === 2) throw new Error("Synthetic PC unavailable after capture");
        return syntheticStartupProof(guard);
      } };
    const f = fixture({ closureOperations: operations,
      lock: async (_directory, work) => {
        assert.equal(held, false); held = true;
        try { return await work({ async assertReady() { assert.equal(held, true); } }); }
        finally { held = false; }
      },
      ...(mode === "capture_failure" ? { checkpoint: async () => { throw new Error("Synthetic capture failed"); } } : {}) });
    try {
      await f.supervisor.start(); const report = await f.supervisor.tick();
      assert.equal(proofs, 2, "the initial proof is never reused after capture");
      assert.equal(report.runtimeResumed, mode !== "proof_failure");
      assert.equal(report.status, mode === "success" ? "succeeded" : "failed");
      assert.equal(f.events.filter(value => value === "start").length, mode === "proof_failure" ? 1 : 2);
      if (mode === "proof_failure") assert.deepEqual(await f.supervisor.finished, { failed: true });
    } finally { await f.supervisor.close(); }
  }
});

test("the first owner opening cannot bypass capture exclusion even when no intent is pending", async () => {
  const f = fixture({ closureOperations: { verifyStartup: () => assert.fail("No verification without the lease"),
    async hasPending() { return false; }, async preflight() {}, async run() {} },
    lock: async () => { throw new Error("Synthetic capture lock already held"); } });
  try { await assert.rejects(f.supervisor.start()); assert.equal(f.events.includes("start"), false); }
  finally { await f.supervisor.close(); }
});

test("a failed first-owner lock cleanup destroys the opened child and parent gateway", async () => {
  const gateway = [];
  const f = fixture({ witnessControl: async () => true,
    closureOperations: { verifyStartup: syntheticStartupProof, async hasPending() { return false; }, async preflight() {}, async run() {} },
    lock: async (_directory, work) => { await work({ async assertReady() {} }); throw new Error("Synthetic startup lock cleanup failed"); },
    makeGateway: () => ({ async start() { gateway.push("start"); }, async close() { gateway.push("close"); } }),
    readConfiguration: async () => ({ ...configuration, enabled: false }) });
  try {
    await assert.rejects(f.supervisor.start());
    assert.equal(f.events.filter(value => value === "start").length, 1);
    assert.equal(f.events.filter(value => value === "destroy").length, 1);
    assert.equal(f.runtime.state().status, "stopped"); assert.deepEqual(gateway, ["start", "close"]);
  } finally { await f.supervisor.close(); }
});

test("startup preserves its primary failure while a rejected destroy still closes the parent gateway", async () => {
  const expected = new Error("synthetic startup lease failure"), gateway = [];
  const f = fixture({ witnessControl: async () => true,
    closureOperations: { verifyStartup: syntheticStartupProof, async hasPending() { return false; }, async preflight() {}, async run() {} },
    lock: async (_directory, work) => { await work({ async assertReady() {} }); throw expected; },
    makeGateway: () => ({ async start() {}, async close() { gateway.push("close"); } }) });
  f.runtime.destroy = async () => { f.events.push("destroy"); throw new Error("synthetic drain failure"); };
  await assert.rejects(f.supervisor.start(), error => error === expected);
  assert.deepEqual(gateway, ["close"]);
  await assert.rejects(f.supervisor.close(), { code: "RECURRING_SUPERVISOR_RUNTIME" });
  assert.deepEqual(await f.supervisor.finished, { failed: true }); assert.deepEqual(gateway, ["close", "close"]);
});

test("capture lock rejection after owner stop ends the runtime; rejection before stop preserves it", async () => {
  for (const afterCallback of [false, true]) {
    let locks = 0;
    const f = fixture({ closureOperations: { verifyStartup: syntheticStartupProof,
      async hasPending() { return false; }, async preflight() {}, async run() {} },
      lock: async (_directory, work) => {
        locks++;
        if (locks === 2 && !afterCallback) throw new Error("Synthetic capture lock already held");
        const result = await work({ async assertReady() {} });
        if (locks === 2) throw new Error("Synthetic capture lock cleanup failed after reopen");
        return result;
      } });
    try {
      await f.supervisor.start(); assert.equal(await f.supervisor.tick(), null);
      if (afterCallback) {
        assert.equal(f.reports.at(-1).runtimeResumed, true, "the callback reopened before its lease failed cleanup");
        assert.deepEqual(await f.supervisor.finished, { failed: true });
        assert.equal(f.runtime.state().status, "stopped");
      } else {
        assert.equal(f.events.includes("stop"), false); assert.equal(f.runtime.state().status, "running");
      }
    } finally { await f.supervisor.close(); }
  }
});

test("corrupt intent discovery or uncertain erasure ends the supervisor instead of retrying or resuming", async () => {
  for (const phase of ["discovery", "erasure"]) {
    let pending = false;
    const operations = { verifyStartup: syntheticStartupProof, async hasPending() { if (pending && phase === "discovery") throw new Error("Synthetic private error"); return pending; }, async preflight() {}, async run() {} };
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
    const operations = { verifyStartup: syntheticStartupProof, async hasPending() { return pending; }, async preflight() {}, async run() { assert.fail("No implicit destructive retry in the capture cycle"); } };
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
  assert.deepEqual(f.notices, [{ version: 1, type: "recurring_supervisor", status: "started", backupStarted: false, nodeVersion: process.version }]);
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

for (const failing of ["timer", "runtime", "gateway"]) {
  test(`shutdown reports ${failing} cleanup failure and still attempts every following cleanup`, async () => {
    const cleanup = [];
    const f = fixture({ witnessControl: async () => true, readConfiguration: async () => ({ ...configuration, enabled: false }),
      unschedule() { cleanup.push("timer"); if (failing === "timer") throw new Error("synthetic timer cleanup"); },
      makeGateway: () => ({ async start() {}, async close() { cleanup.push("gateway"); if (failing === "gateway") throw new Error("synthetic gateway cleanup"); } }) });
    f.runtime.destroy = async () => { cleanup.push("runtime"); if (failing === "runtime") throw new Error("synthetic runtime cleanup"); };
    await f.supervisor.start(); await f.supervisor.tick();
    const closing = f.supervisor.close(); assert.equal(f.supervisor.close(), closing);
    await assert.rejects(closing, { code: "RECURRING_SUPERVISOR_RUNTIME" });
    assert.deepEqual(await f.supervisor.finished, { failed: true }); assert.deepEqual(cleanup, ["timer", "runtime", "gateway"]);
    await assert.rejects(f.supervisor.close(), { code: "RECURRING_SUPERVISOR_RUNTIME" });
  });
}

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

test("optional parent control listener precedes the stopped-child closure gate and survives captures", async () => {
  let stopped = true, childOptions;
  const events = [], control = async () => true;
  const runtime = { state: () => ({ status: stopped ? "stopped" : "running" }),
    async start() { stopped = false; events.push("child-start"); }, async stop() { stopped = true; events.push("child-stop"); return { exitCode: 0, signal: null }; },
    async destroy() { stopped = true; events.push("child-destroy"); } };
  const f = fixture({ witnessControl: control, makeRuntime(value) { childOptions = value; return runtime; },
    makeGateway(value) { assert.equal(value.port, 3000); assert.equal(value.childPort, 3001); assert.equal(value.control, control);
      return { async start() { events.push("gateway-start"); assert.equal(stopped, true); }, async close() { events.push("gateway-close"); assert.equal(stopped, true); } }; },
    closureOperations: { verifyStartup: syntheticStartupProof, async hasPending() { return stopped; }, async preflight() {}, async run() {} },
    runClosures: async () => { assert.deepEqual(events, ["gateway-start"]); assert.equal(stopped, true); events.push("initial-closure-gate"); await runtime.start(); },
    readConfiguration: async () => ({ ...configuration, enabled: false }) });
  await f.supervisor.start(); await f.supervisor.tick(); await f.supervisor.close();
  assert.equal(childOptions.port, 3001); assert.equal(childOptions.environment.PORT, "3001"); assert.equal(childOptions.parentGateway, true);
  assert.equal(environment.PORT, "3000"); assert.deepEqual(events, ["gateway-start", "initial-closure-gate", "child-start", "child-destroy", "gateway-close"]);
});
