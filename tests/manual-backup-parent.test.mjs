import test from "node:test";
import assert from "node:assert/strict";
import { createRecurringSupervisor } from "../server/backup/recurring-supervisor.mjs";
import { createManualBackupRequests } from "../server/backup/manual-backup-files.mjs";
import { runManagedClosures, resumeManagedLocalClosureRuntime } from "../server/backup/managed-closures.mjs";

const NOW = Date.UTC(2026, 9, 22, 12), REQUEST = "a".repeat(32);
const environment = { PORT: "3000", JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" };
const options = { command: "start", runtimeDirectory: "/srv/reviewed-runtime", runtimeHead: "b".repeat(40), runtimeTree: "c".repeat(40),
  privateDirectory: "/srv/private-config", operationsDirectory: "/srv/private-backups", privatePathMode: "linux-dirfd" };
const configuration = { version: 1, enabled: false, recipientSha256: "d".repeat(64), hourUtc: 5, minuteUtc: 15 };
const forbidden = () => assert.fail("No automatic backup decision or operation is permitted");
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(t, overrides = {}) {
  const events = [], reports = [], notices = [];
  let durable = { version: 1, revision: 0, requestIds: [], current: null }, pending = false, status = "stopped", leaseHeld = false, startupChecks = 0;
  const requests = createManualBackupRequests({ operationsDirectory: options.operationsDirectory, clock: () => NOW }, {
    read: async () => structuredClone(durable), async save(value, revision) {
      assert.equal(revision, durable.revision); durable = structuredClone({ ...value, revision: revision + 1 });
    },
  });
  const lock = async (_directory, work) => {
    assert.equal(leaseHeld, false, "captures and closures have one shared exclusion");
    leaseHeld = true; events.push("lock");
    try { return await work({ async assertReady() { assert.equal(leaseHeld, true); } }); }
    finally { leaseHeld = false; events.push("unlock"); }
  };
  const runtime = { state: () => ({ status }), async start() {
    assert.equal(leaseHeld, true); events.push("start"); status = "running"; return { ready: true };
  }, async stop() { assert.equal(leaseHeld, true); events.push("stop"); status = "stopped"; return { exitCode: 0, signal: null }; },
  async destroy() { events.push("destroy"); status = "stopped"; } };
  const operations = { async hasPending() { return pending; }, async preflight(guard) { await guard(); events.push("closure-preflight"); },
    async run(guard) { await guard(); assert.equal(status, "stopped"); events.push("erase"); pending = false; return { completedReceipts: 1 }; },
    async verifyStartup(guard) { await guard(); startupChecks++; events.push("verify-startup");
      return { verified: true, completedReceipts: 0, scope: "local_application" }; },
  };
  const dependencies = { environment, clock: () => NOW, manualBackups: true, manualRequests: requests, closureOperations: operations,
    resumeClosures: resumeManagedLocalClosureRuntime, readConfiguration: forbidden, history: forbidden,
    source: async () => { events.push("source"); }, lock,
    preflight: async () => { assert.equal(leaseHeld, true); events.push("backup-preflight"); return { ...configuration }; },
    checkpoint: async (command, _options, destination) => {
      assert.equal(command, "capture-application"); assert.equal(leaseHeld, true); assert.equal(status, "stopped");
      assert.match(destination, /^\/srv\/private-backups\/capture-[1-9][0-9]*-[a-f0-9]{16}$/);
      events.push("capture"); return { saved: true };
    },
    encrypt: async value => { assert.equal(leaseHeld, true); assert.equal(status, "stopped");
      assert.equal(value.recipientSha256, configuration.recipientSha256); events.push("encrypt"); return { encrypted: true }; },
    append: async (_directory, report) => { assert.equal(leaseHeld, true); reports.push(report); events.push(`journal:${report.status}`); },
    runClosures: parameters => runManagedClosures(parameters, { lock }),
    makeRuntime: parameters => { assert.equal(parameters.accountClosures, true); return runtime; },
    emit: value => notices.push(value), schedule: () => ({ timer: true }), unschedule() {}, ...overrides,
  };
  const supervisor = createRecurringSupervisor(options, dependencies);
  t.after(() => supervisor.close());
  return { supervisor, requests, events, reports, notices, runtime, operations, lock,
    setPending(value) { pending = value; }, get startupChecks() { return startupChecks; },
    setStopped() { status = "stopped"; }, get leaseHeld() { return leaseHeld; } };
}

test("manual startup and repeated maintenance never inspect the backup schedule or capture without a request", async t => {
  const f = fixture(t, { preflight: forbidden, checkpoint: forbidden, encrypt: forbidden });
  await f.supervisor.start(); await f.supervisor.tick(); await f.supervisor.tick();
  assert.equal(await f.requests.status(), null); assert.equal(f.events.filter(value => value === "start").length, 1);
  assert.equal(f.events.includes("stop"), false); assert.deepEqual(f.reports, []); assert.equal(f.startupChecks, 1);
  assert.equal(f.notices.find(value => value.status === "started").backupMode, "manual");
});

test("an explicit request captures once despite a disabled legacy schedule and concurrent maintenance", async t => {
  const entered = deferred(), release = deferred();
  const f = fixture(t, { preflight: async () => { entered.resolve(); await release.promise; return { ...configuration }; } });
  await f.supervisor.start(); await f.supervisor.tick(); await f.requests.request({ requestId: REQUEST });
  const first = f.supervisor.tick(); await entered.promise;
  assert.equal(f.supervisor.tick(), first); assert.equal((await f.requests.status()).status, "running");
  release.resolve(); const result = await first;
  assert.equal(result.status, "succeeded"); assert.equal(result.runtimeResumed, true);
  const completed = await f.requests.status(); assert.equal(completed.status, "complete");
  assert.match(completed.captureId, new RegExp(`^capture-${NOW}-[a-f0-9]{16}$`));
  assert.equal(f.events.filter(value => value === "capture").length, 1); assert.equal(f.events.filter(value => value === "encrypt").length, 1);
  assert.equal(f.startupChecks, 2); assert.equal(f.events.filter(value => value === "start").length, 2);
  await f.supervisor.tick(); await f.requests.request({ requestId: REQUEST }); await f.supervisor.tick();
  assert.equal(f.events.filter(value => value === "capture").length, 1);
});

test("a confirmed local closure takes the shared lock before a queued manual capture", async t => {
  const f = fixture(t); await f.supervisor.start(); await f.supervisor.tick();
  await f.requests.request({ requestId: REQUEST }); f.setPending(true);
  await f.supervisor.tick(); assert.equal((await f.requests.status()).status, "queued");
  assert.equal(f.events.includes("erase"), true); assert.equal(f.events.includes("capture"), false);
  await f.supervisor.tick(); assert.equal((await f.requests.status()).status, "complete");
  assert.ok(f.events.indexOf("erase") < f.events.indexOf("capture"));
});

test("a request left running by a previous parent becomes interrupted and is never recaptured", async t => {
  const f = fixture(t, { preflight: forbidden, checkpoint: forbidden, encrypt: forbidden });
  await f.requests.request({ requestId: REQUEST }); await f.requests.claim(REQUEST);
  await f.supervisor.start(); await f.supervisor.tick(); await f.supervisor.tick();
  const result = await f.requests.status(); assert.equal(result.status, "failed"); assert.equal(result.code, "INTERRUPTED");
  assert.equal(result.captureId, null); assert.equal(f.events.includes("stop"), false); assert.deepEqual(f.reports, []);
});

test("a restored service cannot claim a queued request before its explicit publication gate opens", async t => {
  let published = false;
  const f = fixture(t, { allowManualRequests: () => published });
  await f.requests.request({ requestId: REQUEST });
  await f.supervisor.start(); await f.supervisor.tick(); await f.supervisor.tick();
  assert.equal((await f.requests.status()).status, "queued"); assert.equal(f.events.includes("backup-preflight"), false);
  assert.equal(f.events.includes("capture"), false); assert.equal(f.events.includes("stop"), false);
  published = true; await f.supervisor.tick();
  assert.equal((await f.requests.status()).status, "complete"); assert.equal(f.events.filter(value => value === "capture").length, 1);
});

test("failed recipient or capture preflight leaves messaging open and requires another explicit request", async t => {
  let checks = 0;
  const f = fixture(t, { preflight: async () => { checks++; throw new Error("Synthetic missing recipient"); }, checkpoint: forbidden, encrypt: forbidden });
  await f.supervisor.start(); await f.supervisor.tick(); await f.requests.request({ requestId: REQUEST });
  assert.equal(await f.supervisor.tick(), null);
  assert.equal((await f.requests.status()).code, "PREFLIGHT_FAILED"); assert.equal(f.runtime.state().status, "running");
  assert.equal(f.events.includes("stop"), false); await f.supervisor.tick(); await f.requests.request({ requestId: REQUEST }); await f.supervisor.tick();
  assert.equal(checks, 1); assert.equal((await f.requests.status()).captureId, null);
});

test("an unconfirmed runtime drain cannot capture, encrypt or reopen messaging", async t => {
  let starts = 0, stops = 0, status = "stopped";
  const f = fixture(t, { checkpoint: forbidden, encrypt: forbidden, makeRuntime: () => ({ state: () => ({ status }),
    async start() { starts++; status = "running"; return { ready: true }; },
    async stop() { stops++; status = "stopped"; return { exitCode: 1, signal: null }; }, async destroy() { status = "stopped"; } }) });
  await f.supervisor.start(); await f.supervisor.tick(); await f.requests.request({ requestId: REQUEST }); await f.supervisor.tick();
  assert.equal(stops, 1); assert.equal(starts, 1, "an uncertain drain must not be followed by a reopen");
  assert.equal((await f.requests.status()).status, "failed"); assert.equal((await f.requests.status()).captureId, null);
  assert.equal((await f.supervisor.finished).failed, true); assert.equal(status, "stopped");
});

test("a failed fresh local startup proof leaves the owner stopped and the request failed", async t => {
  const f = fixture(t); const verify = f.operations.verifyStartup;
  f.operations.verifyStartup = async guard => {
    if (f.startupChecks > 0) throw new Error("Synthetic uncertain closure state");
    return verify(guard);
  };
  await f.supervisor.start(); await f.supervisor.tick(); await f.requests.request({ requestId: REQUEST }); await f.supervisor.tick();
  assert.equal((await f.supervisor.finished).failed, true); assert.equal(f.runtime.state().status, "stopped");
  assert.equal(f.events.filter(value => value === "start").length, 1);
  assert.equal((await f.requests.status()).status, "failed"); assert.equal((await f.requests.status()).captureId, null);
});

test("a capture lock cleanup failure revokes an already reopened child and cannot publish a completed request", async t => {
  let f;
  f = fixture(t, { lock: async (directory, work) => {
    const result = await f.lock(directory, work);
    if (result?.type === "recurring_checkpoint") throw new Error("Synthetic changed exclusion during cleanup");
    return result;
  } });
  await f.supervisor.start(); await f.supervisor.tick(); await f.requests.request({ requestId: REQUEST });
  await f.supervisor.tick(); assert.equal((await f.supervisor.finished).failed, true);
  assert.equal(f.runtime.state().status, "stopped"); assert.equal(f.events.includes("destroy"), true);
  assert.equal((await f.requests.status()).status, "failed"); assert.equal((await f.requests.status()).captureId, null);
});
