import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { createLocalClosureOperations } from "../server/data/closure-operations.mjs";
import { createErasureJournal, readErasureJournalBatch } from "../server/data/erasure-journal.mjs";
import { AccountErasureError } from "../server/data/erasure-state.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const clientId = "a".repeat(32), root = Buffer.alloc(32, 4);
const binding = { database: "jessiemessage_test_local_closure", rootFingerprint: root.toString("hex") };
async function fixture(t, phase = null) {
  const directory = await erasureDirectory(t), key = Buffer.alloc(32, 7), events = [];
  let exists = true, now = 1792350000000, lostFinishReply = false;
  const journalFor = id => createErasureJournal({ directory, key, binding, clientId: id }, { withDirectory: withErasureDirectory });
  const batch = page => readErasureJournalBatch({ directory, key, binding, ...page }, { withDirectory: withErasureDirectory });
  const scope = { binding,
    async inspect() { assert.fail("Only a previously recorded intent may be run"); },
    async prepare() { events.push("prepare"); return { prepared: true }; },
    async nextMedia() { return null; },
    async finish() { events.push("finish"); exists = false; if (lostFinishReply) { lostFinishReply = false; throw new Error("Synthetic lost SQL acknowledgement"); } return { completed: true }; },
    async verifyAbsent() { events.push("verify"); if (exists) throw new AccountErasureError("ERASURE_RESTORE_REPLAY_REQUIRED"); return { absent: true }; },
  };
  const parameters = { store: { binding, async withLease(id, work) { assert.equal(id, clientId); return work(scope); } },
    storage: { async fingerprint() { return root; }, async remove() { assert.fail("This fixture has no media"); } },
    journalFor, batch, clock: () => now++, inspectApplicationSchema: async () => ({ verified: true }) };
  if (phase !== null) {
    const journal = journalFor(clientId);
    try {
      for (const next of ["requested", "prepared", "files_erased", "completed"]) {
        const old = await journal.read(), at = now++;
        await journal.save(old.record ? { ...old.record, phase: next, updatedAt: at } : {
          version: 1, clientId, binding, phase: next, cursor: null, startedAt: at, updatedAt: at,
        }, old.revision, async () => {});
        if (next === phase) break;
      }
    } finally { journal.close(); }
    if (phase === "completed") exists = false;
  }
  return { directory, journalFor, batch, events, parameters, owner: overrides => createLocalClosureOperations({ ...parameters, ...overrides }),
    resurrect() { exists = true; }, loseFinishReply() { lostFinishReply = true; } };
}

test("local startup reports its actual application scope without a witness or fabricated fields", async t => {
  const f = await fixture(t), operations = f.owner();
  assert.equal(await operations.hasPending(), false);
  assert.deepEqual(await operations.verifyStartup(async () => {}), { verified: true, completedReceipts: 0, scope: "local_application" });
  assert.deepEqual(f.events, []); assert.deepEqual(await readdir(f.directory), []);
});

for (const phase of ["requested", "prepared", "files_erased"]) test(`local maintenance resumes ${phase} through the normal engine and leaves a checked receipt`, async t => {
  const f = await fixture(t, phase), operations = f.owner();
  assert.equal(await operations.hasPending(), true);
  await assert.rejects(operations.verifyStartup(async () => {}), { code: "ERASURE_PENDING" });
  assert.deepEqual(await operations.run(async () => {}), { completedReceipts: 1 });
  assert.equal(await operations.hasPending(), false);
  const before = await Promise.all((await readdir(f.directory)).map(name => readFile(path.join(f.directory, name))));
  assert.deepEqual(await operations.verifyStartup(async () => {}), { verified: true, completedReceipts: 1, scope: "local_application" });
  const after = await Promise.all((await readdir(f.directory)).map(name => readFile(path.join(f.directory, name))));
  assert.deepEqual(after, before, "startup does not rewrite the receipt");
  assert.equal((await f.batch({})).jobs[0].phase, "completed");
  assert.equal(f.events.filter(event => event === "prepare").length, phase === "requested" ? 1 : 0);
});

test("a lost final SQL acknowledgement resumes from the recorded files_erased phase", async t => {
  const f = await fixture(t, "requested"), operations = f.owner(); f.loseFinishReply();
  await assert.rejects(operations.run(async () => {}), { code: "ERASURE_UNAVAILABLE" });
  assert.equal((await f.batch({})).jobs[0].phase, "files_erased");
  await assert.rejects(operations.verifyStartup(async () => {}), { code: "ERASURE_PENDING" });
  assert.deepEqual(await operations.run(async () => {}), { completedReceipts: 1 });
  assert.equal(f.events.filter(event => event === "prepare").length, 1);
});

test("a restored completed account blocks startup and maintenance without restarting its deletion", async t => {
  const f = await fixture(t, "completed"), operations = f.owner(); f.resurrect();
  assert.equal(await operations.hasPending(), false);
  for (const method of ["verifyStartup", "run"]) await assert.rejects(operations[method](async () => {}), { code: "ERASURE_RESTORE_REPLAY_REQUIRED" });
  assert.deepEqual(f.events, ["verify", "verify"]);
  assert.equal((await f.batch({})).jobs[0].phase, "completed");
});

test("failed application inspection, cancelled maintenance and lost exclusion cannot mutate a recorded request", async t => {
  for (const mode of ["schema", "missing_schema", "cancelled", "guard"]) {
    const f = await fixture(t, "requested"), controller = new AbortController();
    const operations = f.owner(mode === "schema" ? { inspectApplicationSchema: async () => ({ verified: false }) }
      : mode === "missing_schema" ? { inspectApplicationSchema: async () => null } : {});
    if (mode === "cancelled") controller.abort();
    const guard = async () => { if (mode === "guard") throw new AccountErasureError("ERASURE_MAINTENANCE"); };
    await assert.rejects(operations.run(guard, { signal: controller.signal }), { code: {
      schema: "ERASURE_PREFLIGHT", missing_schema: "ERASURE_PREFLIGHT", cancelled: "ERASURE_ABORTED", guard: "ERASURE_MAINTENANCE",
    }[mode] });
    assert.deepEqual(f.events, []); assert.equal((await f.batch({})).jobs[0].phase, "requested");
  }
});

test("discovery cannot recreate an intent whose journal disappeared before the engine read", async t => {
  const f = await fixture(t, "requested"); let removed = false;
  const operations = f.owner({ batch: async page => {
    const result = await f.batch(page);
    if (!removed) { removed = true; for (const name of await readdir(f.directory)) await unlink(path.join(f.directory, name)); }
    return result;
  } });
  await assert.rejects(operations.run(async () => {}), { code: "ERASURE_CHANGED" });
  assert.deepEqual(f.events, []); assert.deepEqual(await readdir(f.directory), []);
});

test("startup rejects duplicate or drifted discovered receipts instead of authorizing an opening", async t => {
  for (const mode of ["duplicate", "revision", "phase", "updatedAt"]) {
    const f = await fixture(t, "completed"), actual = await f.batch({});
    const first = actual.jobs[0], jobs = mode === "duplicate" ? [first, first]
      : [{ ...first, [mode]: mode === "phase" ? "prepared" : first[mode] + 1 }];
    await assert.rejects(f.owner({ batch: async () => ({ jobs, nextCursor: null }) }).verifyStartup(async () => {}), { code: "ERASURE_CHANGED" });
    assert.deepEqual(f.events, []);
  }
});
