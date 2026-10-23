import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArguments, run, createRestoredService, ManualOperatorError } from "../scripts/manual-restore.mjs";
import { erasureDirectory } from "./fixtures/erasure-files.mjs";

let native = false;
try { native = (await statfs("/proc/self/fd", { bigint: true })).type === 0x9fa0n; } catch {}
const nativeOptions = { skip: !native && "Native procfs private directories required; mandatory in Linux CI" };
const planSha256 = "c".repeat(64), jobSha256 = "a".repeat(64);
const environment = { PORT: "3000", JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" };
const forbidden = () => assert.fail("A refused or read-only operation cannot reach this effect");
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function fixture(t, phase = "new", recordedJobSha256 = jobSha256) {
  const directory = await erasureDirectory(t), events = [], paths = { targetDirectory: path.join(directory, "target"),
    rootPath: path.join(directory, "target/media"), journalDirectory: path.join(directory, "target/operations"),
    progressDirectory: path.join(directory, "target/progress"), quarantineDirectory: path.join(directory, "target/quarantine") };
  const context = { jobSha256, paths, job: { runtimeDirectory: "/synthetic-reviewed-runtime", runtimeHead: "1".repeat(40), runtimeTree: "2".repeat(40),
    targetDatabase: "synthetic_restore_target", importUser: "synthetic_restore_operator", targetPrivateDirectory: "/synthetic-target-private" },
    sourceEnvironment: { JESSIEMESSAGE_DB_HOST: "db.synthetic.invalid", JESSIEMESSAGE_DB_PORT: "3306" }, targetEnvironment: {},
    importSelection: { database: "synthetic_restore_target", sqlSha256: "b".repeat(64) },
    async assertReady() { events.push("guard"); }, async close() { events.push("context-close"); } };
  const stateFile = path.join(directory, "manual-restore-state.json");
  if (phase !== "new") await writeFile(stateFile, `${JSON.stringify({ version: 1, revision: 4, jobSha256: recordedJobSha256,
    phase, planSha256: ["reconciled", "opening", "opened"].includes(phase) ? planSha256 : null })}\n`, { mode: 0o600, flag: "wx" });
  const internal = { async loadContext(selected) { assert.equal(selected, directory); events.push("context-open"); return context; },
    readSecret: forbidden, connect: forbidden, inspect: forbidden, resumeCheckpoint: forbidden,
    createPool: forbidden, createInspectionPool: forbidden, makeStorage: forbidden, reconcile: forbidden, publish: forbidden, makeService: forbidden };
  const invoke = (command, overrides = {}) => run({ command, operatorDirectory: directory, ...(command === "open" ? { expectedPlanSha256: planSha256 } : {}) },
    { environment, inputStream: {}, outputStream: { write() { events.push("output"); } } }, { ...internal, ...overrides });
  return { directory, stateFile, context, events, invoke };
}

test("manual operator arguments require one absolute job directory and explicit open confirmation", () => {
  for (const command of ["check", "restore"]) assert.deepEqual(parseArguments([command, "--operator-directory", "/private/operator"]), { command, operatorDirectory: "/private/operator" });
  assert.deepEqual(parseArguments(["open", "--operator-directory", "/private/operator", "--confirm-plan-sha256", planSha256]),
    { command: "open", operatorDirectory: "/private/operator", expectedPlanSha256: planSha256 });
  for (const args of [[], ["apply"], ["check", "--operator-directory", "/"], ["check", "--operator-directory", "relative"],
    ["check", "--operator-directory", "/private/../operator"], ["check", "--operator-directory", "/private/operator/"],
    ["check", "--operator-directory", "/private/operator\n"], ["check", "--operator-directory", "/private\\operator"],
    ["check", "--operator-directory", "/private/operator", "--confirm-plan-sha256", planSha256],
    ["restore", "--operator-directory", "/private/operator", "--password", "synthetic-secret"],
    ["open", "--operator-directory", "/private/operator"], ["open", "--operator-directory", "/private/operator", "--confirm-plan-sha256", "bad"],
    ["open", "--operator-directory", "/private/operator", "--confirm-plan-sha256", planSha256.toUpperCase()],
    ["check", "--operator-directory", { toString: () => "/private/operator" }],
  ]) assert.throws(() => parseArguments(args), { code: "MANUAL_OPERATOR_USAGE" });
});

test("an already cancelled operator never loads a job or reads a password", async () => {
  const cancellation = new AbortController(); cancellation.abort();
  await assert.rejects(run({ command: "check", operatorDirectory: "/private/operator" }, { signal: cancellation.signal },
    { loadContext: forbidden, readSecret: forbidden }), { code: "MANUAL_OPERATOR_ABORTED" });
});

test("manual check preserves files and uses no password, database, allocation or runtime", nativeOptions, async t => {
  const f = await fixture(t), before = await readdir(f.directory);
  const result = await f.invoke("check", { async resumeCheckpoint(selected, dependencies) {
    f.events.push("checkpoint-check"); assert.equal(selected.command, "check");
    assert.equal(selected.database, f.context.job.targetDatabase); assert.equal(Object.hasOwn(dependencies, "readSecret"), false);
    return { status: "application_resume_precheck_passed", databaseConnected: false };
  } });
  assert.deepEqual(result, { status: "manual_operator_precheck_passed", phase: "new", databaseConnected: false, imported: false, started: false });
  assert.deepEqual(await readdir(f.directory), before);
  assert.deepEqual(f.events, ["context-open", "checkpoint-check", "output", "context-close"]);
});

test("a nonempty SQL target is refused before allocation, import or mutation", nativeOptions, async t => {
  const f = await fixture(t), before = await readdir(f.directory); let passwords = 0, connections = 0, closed = 0;
  await assert.rejects(f.invoke("restore", {
    async readSecret() { passwords++; return "synthetic password with spaces"; },
    async connect(selected) { connections++; assert.equal(selected.JESSIEMESSAGE_DB_NAME, f.context.job.targetDatabase);
      assert.equal(selected.JESSIEMESSAGE_DB_USER, f.context.job.importUser); return { async end() { closed++; } }; },
    async inspect(_connection, database) { assert.equal(database, f.context.job.targetDatabase); return "complete"; },
  }), { code: "MANUAL_OPERATOR_TARGET_NOT_EMPTY" });
  assert.equal(passwords, 1); assert.equal(connections, 1); assert.equal(closed, 1);
  assert.deepEqual(await readdir(f.directory), before, "no target directory, state or lock remains");
  assert.equal(f.events.at(-1), "context-close");
});

test("opening and opened states cannot repeat import or launch another service", nativeOptions, async t => {
  for (const phase of ["opening", "opened"]) for (const command of ["restore", "open"]) {
    const f = await fixture(t, phase), before = await readFile(f.stateFile);
    await assert.rejects(f.invoke(command), { code: "MANUAL_OPERATOR_ALREADY_OPENED_OR_UNCERTAIN" });
    assert.deepEqual(await readFile(f.stateFile), before);
    assert.deepEqual(await readdir(f.directory), ["manual-restore-state.json"]);
    assert.deepEqual(f.events, ["context-open", "context-close"]);
  }
});

test("a changed job cannot reuse existing import or publication progress", nativeOptions, async t => {
  for (const command of ["check", "restore", "open"]) {
    const f = await fixture(t, "reconciled", "b".repeat(64)), before = await readFile(f.stateFile);
    await assert.rejects(f.invoke(command, command === "check" ? { async resumeCheckpoint(selected) { assert.equal(selected.command, "check"); } } : {}),
      { code: "MANUAL_OPERATOR_JOB_CHANGED" });
    assert.deepEqual(await readFile(f.stateFile), before); assert.deepEqual(await readdir(f.directory), ["manual-restore-state.json"]);
    assert.equal(f.events.at(-1), "context-close");
  }
});

test("open refuses a missing or different durable plan before constructing a runtime", nativeOptions, async t => {
  for (const phase of ["new", "allocated", "imported"]) {
    const f = await fixture(t, phase), before = await readdir(f.directory);
    await assert.rejects(f.invoke("open"), { code: "MANUAL_OPERATOR_PLAN_CONFIRMATION" });
    assert.deepEqual(await readdir(f.directory), before); assert.equal(f.events.at(-1), "context-close");
  }
});

test("restored service readiness waits for actual supervisor start; stop drains before aborting lifetime", async () => {
  const started = deferred(), lifetime = deferred(), events = [], context = { job: { runtimeDirectory: "/reviewed", runtimeHead: "1".repeat(40),
    runtimeTree: "2".repeat(40), targetPrivateDirectory: "/target-private" }, paths: { journalDirectory: "/target-operations" } };
  let received, runtimeState = "stopped", signal;
  const service = createRestoredService(context, { environment, outputStream: { write() {} } }, {
    async recurringMain(args, dependencies) {
      received = args; signal = dependencies.signal;
      signal.addEventListener("abort", () => { events.push("abort"); lifetime.resolve(); }, { once: true });
      const supervisor = dependencies.makeSupervisor({ command: "start" }, {});
      await supervisor.start(); await lifetime.promise; events.push("parent-finished");
    },
    makeSupervisor(_options, dependencies) {
      dependencies.makeRuntime({}); return { async start() { events.push("start-requested"); await started.promise; runtimeState = "running"; events.push("ready"); return { ready: true }; } };
    },
    makeRuntime() { return { state: () => ({ status: runtimeState }), async stop() { events.push("drain"); assert.equal(signal.aborted, false); runtimeState = "stopped"; return { exitCode: 0, signal: null }; } }; },
  });
  let ready = false;
  const opening = service.start().then(value => { ready = true; return value; });
  await Promise.resolve(); assert.equal(ready, false); assert.deepEqual(events, ["start-requested"]);
  started.resolve(); assert.deepEqual(await opening, { ready: true }); assert.equal(ready, true);
  assert.equal(received[0], "start-local-closures"); assert.ok(received.includes("/target-private"));
  assert.deepEqual(await service.stop(), { exitCode: 0, signal: null });
  assert.deepEqual(events, ["start-requested", "ready", "drain", "abort", "parent-finished"]);
  assert.deepEqual(service.state(), { status: "stopped" }); await service.close();
});

test("an authenticated experience restore forwards the existing opt-in without changing legacy service arguments", async () => {
  for (const experience of [false, true]) {
    let received;
    const context = { job: { version: 2, runtimeDirectory: "/reviewed", runtimeHead: "1".repeat(40), runtimeTree: "2".repeat(40),
      targetPrivateDirectory: "/target-private" }, paths: { journalDirectory: "/target-operations" }, ...(experience ? { experience: true } : {}) };
    const service = createRestoredService(context, { environment, outputStream: { write() {} } }, {
      async recurringMain(args, dependencies) { received = args; await dependencies.makeSupervisor({ command: "start" }, {}).start(); },
      makeSupervisor() { return { start: async () => ({ ready: true }) }; },
    });
    await service.start();
    assert.deepEqual(received.slice(-2), experience ? ["--experience", "1"] : ["--profile", "photos-notify-recovery-crm-broadcast-video"]);
    assert.equal(received.filter(value => value === "--experience").length, experience ? 1 : 0);
    await service.close();
  }
});

test("restored service rejects readiness when the actual supervisor fails to start", async () => {
  const failure = new ManualOperatorError("SERVICE"), events = [];
  const context = { job: { runtimeDirectory: "/reviewed", runtimeHead: "1".repeat(40), runtimeTree: "2".repeat(40), targetPrivateDirectory: "/target-private" }, paths: { journalDirectory: "/target-operations" } };
  const service = createRestoredService(context, { environment, outputStream: { write() {} } }, {
    async recurringMain(_args, dependencies) { await dependencies.makeSupervisor({ command: "start" }, {}).start(); },
    makeSupervisor() { return { async start() { events.push("failed-start"); throw failure; } }; },
  });
  await assert.rejects(service.start(), error => error === failure);
  await assert.rejects(service.close(), error => error === failure); assert.deepEqual(events, ["failed-start"]);
});

test("restored service preserves the manual parent composition without enabling any backup schedule", async () => {
  const lifetime = deferred(), context = { job: { runtimeDirectory: "/reviewed", runtimeHead: "1".repeat(40), runtimeTree: "2".repeat(40),
    targetPrivateDirectory: "/target-private" }, paths: { journalDirectory: "/target-operations" } };
  let manual, read, allowed;
  const service = createRestoredService(context, { environment, outputStream: { write() {} } }, {
    async recurringMain(_args, dependencies) {
      dependencies.signal.addEventListener("abort", () => lifetime.resolve(), { once: true });
      await dependencies.makeSupervisor({ command: "start" }, { manualBackups: true }).start(); await lifetime.promise;
    },
    makeSupervisor(_options, dependencies) {
      manual = dependencies.manualBackups; read = dependencies.readConfiguration; allowed = dependencies.allowManualRequests;
      dependencies.makeRuntime({}); return { async start() { return { ready: true }; } };
    },
    makeRuntime() { return { state: () => ({ status: "running" }), async stop() { return { exitCode: 0, signal: null }; } }; },
    readConfiguration: forbidden,
  });
  try {
    await service.start();
    assert.equal(manual, true); assert.equal(read, undefined);
    assert.equal(Object.hasOwn(service, "allowCaptures"), false);
    assert.equal(allowed(), false); service.allowManualBackups(); assert.equal(allowed(), true);
  } finally { await service.stop(); await service.close(); }
});

test("a video manual job starts the explicit candidate profile and keeps backup requests closed until publication", async () => {
  const lifetime = deferred(), context = { job: { version: 2, runtimeDirectory: "/reviewed", runtimeHead: "1".repeat(40), runtimeTree: "2".repeat(40),
    targetPrivateDirectory: "/target-private" }, paths: { journalDirectory: "/target-operations" } };
  let received, requestsAllowed;
  const service = createRestoredService(context, { environment, outputStream: { write() {} } }, {
    async recurringMain(args, dependencies) {
      received = args; dependencies.signal.addEventListener("abort", () => lifetime.resolve(), { once: true });
      await dependencies.makeSupervisor({ command: "start", video: true }, { manualBackups: true }).start(); await lifetime.promise;
    },
    makeSupervisor(options, dependencies) {
      assert.equal(options.video, true); assert.equal(dependencies.manualBackups, true);
      requestsAllowed = dependencies.allowManualRequests; dependencies.makeRuntime({}); return { async start() { return { ready: true }; } };
    },
    makeRuntime() { return { state: () => ({ status: "running" }), async stop() { return { exitCode: 0, signal: null }; } }; },
  });
  try {
    await service.start(); assert.equal(received[0], "start-local-closures");
    assert.deepEqual(received.slice(-2), ["--profile", "photos-notify-recovery-crm-broadcast-video"]);
    assert.equal(requestsAllowed(), false); service.allowManualBackups(); assert.equal(requestsAllowed(), true);
  } finally { await service.stop(); await service.close(); }
});

test("a nonzero restored-child drain cannot be reported as a clean stop", async () => {
  const lifetime = deferred(), context = { job: { runtimeDirectory: "/reviewed", runtimeHead: "1".repeat(40), runtimeTree: "2".repeat(40),
    targetPrivateDirectory: "/target-private" }, paths: { journalDirectory: "/target-operations" } };
  let signal;
  const service = createRestoredService(context, { environment, outputStream: { write() {} } }, {
    async recurringMain(_args, dependencies) {
      signal = dependencies.signal; signal.addEventListener("abort", () => lifetime.resolve(), { once: true });
      await dependencies.makeSupervisor({ command: "start" }, {}).start(); await lifetime.promise;
    },
    makeSupervisor(_options, dependencies) { dependencies.makeRuntime({}); return { async start() { return { ready: true }; } }; },
    makeRuntime() { return { state: () => ({ status: "stopped" }), async stop() { return { exitCode: 1, signal: null }; } }; },
  });
  await service.start(); await assert.rejects(service.stop(), { code: "MANUAL_OPERATOR_DRAIN" });
  assert.equal(signal.aborted, false, "only a proved zero exit permits the ordinary stop acknowledgement");
  await service.close(); assert.equal(signal.aborted, true);
});

test("Linux CI must execute private manual operator checks without skipping their filesystem boundary", { skip: !["true", "1"].includes(process.env.CI) }, () => assert.equal(native, true));
