import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { runManagedClosures } from "../server/backup/managed-closures.mjs";
import { acquireRecurringLock } from "../server/backup/recurring-checkpoint-files.mjs";
import { createClosureOperations, verifyClosureStartup } from "../server/data/closure-operations.mjs";
import { AccountErasureError } from "../server/data/erasure-state.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";
import { managedClosureFixture } from "./fixtures/managed-closure-runtime.mjs";
import { registryWitnessFixture } from "./fixtures/registry-witness.mjs";

const clientId = "2".repeat(32), binding = { database: "jessiemessage_test_closure", rootFingerprint: "a".repeat(64) };
const portableLock = (directory, work, options) => acquireRecurringLock(directory, work, options, { withDirectory: withErasureDirectory });
function modeled(overrides = {}) {
  const events = []; let status = "running";
  const runtime = { state: () => ({ status }), async stop() { events.push("stop"); status = "stopped"; return { exitCode: 0, signal: null }; },
    async start() { events.push("start"); status = "running"; }, ...overrides };
  const operations = { async preflight(guard) { await guard(); events.push("preflight"); }, async run(guard) { await guard(); events.push("erase"); return { completedReceipts: 1 }; } };
  const lock = async (_directory, work) => { events.push("lock"); const result = await work({ async assertReady() {} }); events.push("unlock"); return result; };
  return { runtime, operations, events, lock };
}

test("actual managed child drains pending HTTP, producer, transports and pool before erasure, then resumes", { timeout: 15000 }, async t => {
  const directory = await erasureDirectory(t), f = await managedClosureFixture(t, directory);
  try {
  await f.runtime.start();
  const response = await fetch(f.origin + "/hold"), body = response.text();
  let erased = false;
  const operations = { async preflight(guard) { await guard(); }, async run(guard) {
    await guard(); assert.equal(f.children[0].exitCode, 0); assert.equal(await body, "starteddone");
    const lines = (await readFile(f.marker, "utf8")).trim().split("\n");
    assert.ok(lines.includes("request-finished")); assert.ok(lines.includes("producer-stopped")); assert.ok(lines.includes("transport-closed")); assert.equal(lines.at(-1), "pool-closed");
    await assert.rejects(fetch(f.origin + "/api/ready"));
    assert.ok((await readdir(directory)).includes("recurring-backup.lock"));
    erased = true; return { completedReceipts: 1 };
  } };
  assert.deepEqual(await runManagedClosures({ runtime: f.runtime, operations, directory, source: async () => {} }, { lock: portableLock }), { completedReceipts: 1 });
  assert.equal(erased, true); assert.equal(f.children.length, 2); assert.equal(f.runtime.state().status, "running");
  assert.equal((await readdir(directory)).includes("recurring-backup.lock"), false);
  } finally { await f.runtime.destroy(); }
});

test("closure exclusion is the capture lock; an existing holder prevents stopping the application", async t => {
  const directory = await erasureDirectory(t), f = modeled();
  await portableLock(directory, async lease => {
    await lease.assertReady();
    await assert.rejects(runManagedClosures({ runtime: f.runtime, operations: f.operations, directory, source: async () => {} }, { lock: portableLock }), { code: "RECURRING_FILES_LOCKED" });
    assert.deepEqual(f.events, []);
  });
});

test("successful maintenance orders preflight, actual stop, erasure and restart under one exclusion", async () => {
  const f = modeled();
  await runManagedClosures({ runtime: f.runtime, operations: f.operations, directory: "/synthetic", source: async () => {} }, { lock: f.lock });
  assert.deepEqual(f.events, ["lock", "preflight", "stop", "erase", "start", "unlock"]);
});

test("forced or nonzero exit never authorizes erasure or restart", async () => {
  for (const stop of [async () => { throw new Error("Synthetic forced exit"); }, async () => ({ exitCode: 1, signal: null }), async () => ({ exitCode: 0, signal: "SIGKILL" })]) {
    const f = modeled({ stop });
    await assert.rejects(runManagedClosures({ runtime: f.runtime, operations: f.operations, directory: "/synthetic", source: async () => {} }, { lock: f.lock }));
    assert.equal(f.events.includes("erase"), false); assert.equal(f.events.includes("start"), false);
  }
});

test("uncertain engine, changed lease, changed source or cancellation keeps producers stopped", async () => {
  for (const failure of ["engine", "lease", "source", "abort"]) {
    const cancel = new AbortController(), f = modeled(); let changed = false;
    const original = f.runtime.stop; f.runtime.stop = async () => { const result = await original(); changed = true; if (failure === "abort") cancel.abort(); return result; };
    if (failure === "engine") f.operations.run = async () => { throw new Error("Synthetic lost SQL acknowledgement"); };
    const source = async () => { if (changed && failure === "source") throw new Error("Synthetic source changed"); };
    const lock = async (_directory, work) => work({ async assertReady() { if (changed && failure === "lease") throw new Error("Synthetic lease changed"); } });
    await assert.rejects(runManagedClosures({ runtime: f.runtime, operations: f.operations, directory: "/synthetic", source, signal: cancel.signal }, { lock }));
    assert.equal(f.runtime.state().status, "stopped"); assert.equal(f.events.includes("start"), false);
  }
});

test("missing verifiable lease and missing offline preconditions cannot authorize a process stop", async () => {
  const f = modeled();
  await assert.rejects(runManagedClosures({ runtime: f.runtime, operations: f.operations, directory: "/synthetic", source: async () => {} }, { lock: (_directory, work) => work({ token: "unproved" }) }), { code: "ERASURE_MAINTENANCE" });
  assert.equal(f.events.includes("stop"), false);
  for (const parameters of [{}, { inspectExecutableObjects: true, verifyRegistryContinuity: true }, { inspectExecutableObjects: async () => ({ verified: true }) }]) {
    assert.throws(() => createClosureOperations({ store: { binding }, storage: {}, journalFor() {}, batch() {}, ...parameters }));
  }
});

test("startup is read-only and rejects pending erasure before any receipt check or listener", async () => {
  for (const phase of ["requested", "prepared", "files_erased"]) {
    await assert.rejects(verifyClosureStartup({ store: { withLease: () => assert.fail("pending must block before SQL") }, batch: async () => ({ jobs: [{ clientId, phase }], nextCursor: null }) }), { code: "ERASURE_PENDING" });
  }
});

test("incomplete privileged inventory or an unavailable witness blocks before stopping producers", async t => {
  for (const missing of ["inventory", "registry"]) {
    const witness = await registryWitnessFixture(t, { key: Buffer.alloc(32, 7), binding });
    const continuity = missing === "registry" ? witness.makeGate({ exchange: async () => { throw new Error("Synthetic disconnected witness"); } }) : witness.gate;
    const f = modeled(), operations = createClosureOperations({ store: { binding }, storage: {}, journalFor() {}, batch() {},
      inspectExecutableObjects: async () => ({ verified: missing !== "inventory" }), continuity });
    await assert.rejects(runManagedClosures({ runtime: f.runtime, operations, directory: "/synthetic", source: async () => {} }, { lock: f.lock }), { code: missing === "inventory" ? "ERASURE_PREFLIGHT" : "ERASURE_CONTINUITY_UNAVAILABLE" });
    assert.equal(f.events.includes("stop"), false);
  }
});

test("completed receipts are checked even without a pending request, including after SQL restoration", async () => {
  let checked = 0, restored = false;
  const store = { async withLease(id, work) { assert.equal(id, clientId); return work({ async verifyAbsent() { checked++; if (restored) throw new AccountErasureError("ERASURE_RESTORE_REPLAY_REQUIRED"); } }); } };
  const batch = async () => ({ jobs: [{ clientId, phase: "completed" }], nextCursor: null });
  assert.deepEqual(await verifyClosureStartup({ store, batch }), { verified: true, completedReceipts: 1 }); assert.equal(checked, 1);
  restored = true; await assert.rejects(verifyClosureStartup({ store, batch }), { code: "ERASURE_RESTORE_REPLAY_REQUIRED" }); assert.equal(checked, 2);
});

test("invalid discovery pagination cannot create an unbounded startup loop", async () => {
  const cursor = "erasure-" + "a".repeat(64) + ".json";
  await assert.rejects(verifyClosureStartup({ store: {}, batch: async () => ({ jobs: [], nextCursor: cursor }) }), { code: "ERASURE_CHANGED" });
});
