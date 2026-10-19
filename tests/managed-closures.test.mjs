import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { runManagedClosures, resumeManagedClosureRuntime } from "../server/backup/managed-closures.mjs";
import { acquireRecurringLock } from "../server/backup/recurring-checkpoint-files.mjs";
import { createClosureOperations, verifyClosureStartup } from "../server/data/closure-operations.mjs";
import { AccountErasureError } from "../server/data/erasure-state.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";
import { managedClosureFixture } from "./fixtures/managed-closure-runtime.mjs";
import { registryWitnessFixture } from "./fixtures/registry-witness.mjs";
import { createErasureJournal, readErasureJournalBatch } from "../server/data/erasure-journal.mjs";

const clientId = "2".repeat(32), binding = { database: "jessiemessage_test_closure", rootFingerprint: "a".repeat(64) };
const portableLock = (directory, work, options) => acquireRecurringLock(directory, work, options, { withDirectory: withErasureDirectory });
const syntheticProof = () => ({ verified: true, completedReceipts: 1, registrySha256: "e".repeat(64), witnessRevision: 1 });
function modeled(overrides = {}) {
  const events = []; let status = "running";
  const runtime = { state: () => ({ status }), async stop() { events.push("stop"); status = "stopped"; return { exitCode: 0, signal: null }; },
    async start() { events.push("start"); status = "running"; }, ...overrides };
  const operations = { async verifyStartup(guard) { await guard(); events.push("startup-proof"); return syntheticProof(); },
    async preflight(guard) { await guard(); events.push("preflight"); }, async run(guard) { await guard(); events.push("erase"); return { completedReceipts: 1 }; } };
  const lock = async (_directory, work) => { events.push("lock"); const result = await work({ async assertReady() {} }); events.push("unlock"); return result; };
  return { runtime, operations, events, lock };
}

test("actual managed child drains pending HTTP, producer, transports and pool before erasure, then resumes", { timeout: 15000 }, async t => {
  const directory = await erasureDirectory(t), f = await managedClosureFixture(t, directory);
  try {
  await f.runtime.start();
  const response = await fetch(f.origin + "/hold"), body = response.text();
  let erased = false;
  const operations = { async verifyStartup(guard) { await guard(); assert.equal(erased, true); return syntheticProof(); },
    async preflight(guard) { await guard(); }, async run(guard) {
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
  assert.deepEqual(f.events, ["lock", "preflight", "stop", "erase", "startup-proof", "start", "unlock"]);
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

async function witnessedStartup(t, { completed = false } = {}) {
  const key = Buffer.alloc(32, 7), f = await registryWitnessFixture(t, { key, binding });
  const journalFor = id => createErasureJournal({ directory: f.sourceDirectory, key, binding, clientId: id }, { withDirectory: withErasureDirectory });
  const advance = async (phase, id = clientId) => {
    const journal = journalFor(id);
    try {
      const old = await journal.read(), at = 1792350000000 + old.revision;
      await journal.save(old.record ? { ...old.record, phase, updatedAt: at } : {
        version: 1, clientId: id, binding, phase, cursor: null, startedAt: at, updatedAt: at,
      }, old.revision, async () => {});
      await f.gate.verify(async () => {});
    } finally { journal.close(); }
  };
  if (completed) for (const phase of ["requested", "prepared", "files_erased", "completed"]) await advance(phase);
  const restored = new Set(); let checks = 0;
  const store = { binding, async withLease(id, work) {
    return work({ async verifyAbsent() { checks++; if (restored.has(id)) throw new AccountErasureError("ERASURE_RESTORE_REPLAY_REQUIRED"); } });
  } };
  const batch = page => readErasureJournalBatch({ directory: f.sourceDirectory, key, binding, ...page }, { withDirectory: withErasureDirectory });
  const owner = (continuity = f.makeGate(), overrides = {}) => createClosureOperations({ store, storage: {}, journalFor, batch,
    inspectExecutableObjects: () => assert.fail("Read-only startup never performs erasure preflight"), continuity, ...overrides });
  return { ...f, owner, advance, batch, setAbsent(value, id = clientId) { if (value) restored.delete(id); else restored.add(id); }, checks: () => checks };
}

test("startup uses fresh challenges on every opening and checks the witnessed completed identity without erasing", async t => {
  const f = await witnessedStartup(t, { completed: true }), challenges = [];
  const continuity = f.makeGate({ exchange: async request => { challenges.push(request.challenge); return f.witness.exchange(request); } });
  const operations = f.owner(continuity), before = await f.readCurrent();
  assert.equal(await operations.hasPending(), false);
  for (let attempt = 0; attempt < 2; attempt++) {
    const proof = await operations.verifyStartup(async () => {});
    assert.equal(proof.verified, true); assert.equal(proof.completedReceipts, 1);
  }
  assert.equal(f.checks(), 2); assert.equal(new Set(challenges).size, challenges.length); assert.ok(challenges.length >= 12);
  assert.deepEqual(await f.readCurrent(), before);
  f.setAbsent(false);
  await assert.rejects(operations.verifyStartup(async () => {}), { code: "ERASURE_RESTORE_REPLAY_REQUIRED" });
  assert.deepEqual(await f.readCurrent(), before);
});

test("a fresh owner rejects a lost local journal, a borrowed empty discovery and an unfinished intent", async t => {
  for (const mode of ["lost", "empty_batch", "pending"]) {
    const f = await witnessedStartup(t, { completed: mode !== "pending" });
    if (mode === "pending") await f.advance("requested");
    if (mode === "lost") for (const file of (await f.readCurrent()).files) await unlink(path.join(f.sourceDirectory, file.name));
    const operations = f.owner(f.makeGate(), mode === "empty_batch" ? { batch: async () => ({ jobs: [], nextCursor: null }) } : {});
    assert.equal(await operations.hasPending(), mode === "pending");
    await assert.rejects(operations.verifyStartup(async () => {}), { code: {
      lost: "ERASURE_CONTINUITY_ROLLBACK", empty_batch: "ERASURE_CHANGED", pending: "ERASURE_PENDING",
    }[mode] });
    assert.equal(f.checks(), 0);
  }
});

test("duplicate completed identities cannot hide an unchecked restored account, within a page or across pages", async t => {
  for (const paginated of [false, true]) {
    const f = await witnessedStartup(t, { completed: true }), omitted = "3".repeat(32);
    for (const phase of ["requested", "prepared", "files_erased", "completed"]) await f.advance(phase, omitted);
    f.setAbsent(false, omitted);
    const actual = await f.batch({ limit: 100 }), first = actual.jobs.find(job => job.clientId === clientId);
    assert.equal(actual.jobs.length, 2);
    const cursor = (await f.readCurrent()).files[0].name;
    const operations = f.owner(f.makeGate(), { batch: async ({ afterName }) => paginated
      ? { jobs: [first], nextCursor: afterName === null ? cursor : null }
      : { jobs: [first, first], nextCursor: null } });
    await assert.rejects(operations.verifyStartup(async () => {}), { code: "ERASURE_CHANGED" });
    assert.equal(f.checks(), paginated ? 1 : 0);
    await assert.rejects(f.owner().verifyStartup(async () => {}), { code: "ERASURE_RESTORE_REPLAY_REQUIRED" });
  }
});

test("a previous success, a replayed response or an abort cannot authorize a later startup", async t => {
  for (const mode of ["absent", "replay", "abort"]) {
    const f = await witnessedStartup(t), cancellation = new AbortController(); let unavailable = false, previous;
    const continuity = f.makeGate({ exchange: async request => {
      if (unavailable) {
        if (mode === "absent") throw new Error("Synthetic PC off");
        if (mode === "replay") return previous;
        cancellation.abort();
      }
      previous = await f.witness.exchange(request); return previous;
    } });
    const operations = f.owner(continuity); await operations.verifyStartup(async () => {}); unavailable = true;
    await assert.rejects(operations.verifyStartup(async () => {}, { signal: cancellation.signal }), { code: {
      absent: "ERASURE_CONTINUITY_UNAVAILABLE", replay: "ERASURE_CONTINUITY_PROOF", abort: "ERASURE_CONTINUITY_ABORTED",
    }[mode] });
  }
});

test("startup checks require a stopped child and a qualified owner report; interrupted opens are stopped", async () => {
  for (const mode of ["missing", "running", "unqualified", "abort_proof", "abort_open", "failed_open", "changed_lease"]) {
    const f = modeled(), cancellation = new AbortController(); let afterProof = false;
    if (mode !== "running") await f.runtime.stop(); f.events.length = 0;
    const verify = f.operations.verifyStartup;
    f.operations.verifyStartup = async guard => {
      const result = await verify(guard); afterProof = true;
      if (mode === "abort_proof") cancellation.abort();
      return mode === "unqualified" ? { verified: true } : result;
    };
    if (mode === "missing") delete f.operations.verifyStartup;
    const start = f.runtime.start;
    f.runtime.start = async () => { await start(); if (mode === "abort_open") cancellation.abort(); if (mode === "failed_open") throw new Error("Synthetic lost start reply"); };
    await assert.rejects(resumeManagedClosureRuntime({ runtime: f.runtime, operations: f.operations, signal: cancellation.signal,
      assertReady: async () => { if (mode === "changed_lease" && afterProof) throw new Error("Synthetic exclusion changed"); } }));
    assert.equal(f.events.includes("start"), ["abort_open", "failed_open"].includes(mode));
    if (mode !== "running") assert.equal(f.runtime.state().status, "stopped");
  }
});

test("a failed final startup proof after erasure keeps the actual managed child stopped", { timeout: 15000 }, async t => {
  const directory = await erasureDirectory(t), f = await managedClosureFixture(t, directory);
  await f.runtime.start();
  let erased = 0;
  const operations = { async preflight(guard) { await guard(); }, async run(guard) { await guard(); erased++; return { completedReceipts: 1 }; },
    async verifyStartup(guard) { await guard(); throw new Error("Synthetic witness lost after engine return"); } };
  await assert.rejects(runManagedClosures({ runtime: f.runtime, operations, directory, source: async () => {} }, { lock: portableLock }));
  assert.equal(erased, 1); assert.equal(f.children.length, 1); assert.equal(f.runtime.state().status, "stopped");
  await assert.rejects(fetch(f.origin + "/api/ready"));
});

test("capture-lock cleanup failure after closure restart stops the actual reopened child", { timeout: 15000 }, async t => {
  const directory = await erasureDirectory(t), f = await managedClosureFixture(t, directory);
  await f.runtime.start();
  const operations = { async preflight(guard) { await guard(); }, async run(guard) { await guard(); return { completedReceipts: 1 }; },
    async verifyStartup(guard) { await guard(); return syntheticProof(); } };
  const lock = async (_directory, work) => {
    await portableLock(directory, work);
    throw new Error("Synthetic final lock descriptor check failed after callback completion");
  };
  await assert.rejects(runManagedClosures({ runtime: f.runtime, operations, directory, source: async () => {} }, { lock }));
  assert.equal(f.children.length, 2); assert.equal(f.runtime.state().status, "stopped");
  assert.equal(f.children[1].exitCode, 0); await assert.rejects(fetch(f.origin + "/api/ready"));
});
