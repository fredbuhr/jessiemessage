import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createVideoLocalClosureOperations } from "../server/backup/local-closure-parent.mjs";
import { createErasureJournal, readErasureJournalBatch, erasureJournalBindings } from "../server/data/erasure-journal.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const key = Buffer.alloc(32, 7), legacyBinding = { database: "synthetic_video_local", rootFingerprint: "a".repeat(64) };
const binding = { ...legacyBinding, videoRootFingerprint: "b".repeat(64) }, at = 1792700000000;
const ids = ["1".repeat(32), "2".repeat(32)];
async function fixture(t) {
  const directory = await erasureDirectory(t), absent = [];
  let resurrected = null;
  const store = { binding, async withLease(id, work) { return work({ binding, async verifyAbsent() { absent.push(id); if (id === resurrected) throw Object.assign(new Error("Synthetic account reappeared"), { code: "ERASURE_RESIDUAL" }); } }); } };
  const batch = page => readErasureJournalBatch({ directory, key, ...erasureJournalBindings(binding), ...page }, { withDirectory: withErasureDirectory });
  const journalFor = id => createErasureJournal({ directory, key, binding, clientId: id }, { withDirectory: withErasureDirectory });
  const storage = { async fingerprint() { return Buffer.from(binding.rootFingerprint, "hex"); }, async videoFingerprint() { return Buffer.from(binding.videoRootFingerprint, "hex"); }, async remove() { assert.fail("Completed historical receipts cannot authorize unlink"); } };
  const operations = createVideoLocalClosureOperations({ store, storage, batch, journalFor, clock: () => at + 100,
    async inspectApplicationSchema() { return { verified: true }; } });
  async function receipt(scope, id, completed = true) {
    const journal = createErasureJournal({ directory, key, binding: scope, clientId: id }, { withDirectory: withErasureDirectory });
    let revision = 0, value = { version: scope.videoRootFingerprint ? 2 : 1, clientId: id, binding: scope, phase: "requested", cursor: null, startedAt: at, updatedAt: at };
    try {
      revision = (await journal.save(value, revision, async () => {})).revision;
      if (completed) for (const phase of ["prepared", "files_erased", "completed"]) { value = { ...value, phase, updatedAt: value.updatedAt + 1 }; revision = (await journal.save(value, revision, async () => {})).revision; }
    } finally { journal.close(); }
  }
  const files = async () => Object.fromEntries(await Promise.all((await readdir(directory)).map(async name => [name, (await readFile(path.join(directory, name))).toString("base64")]))) ;
  return { directory, operations, absent, receipt, files, resurrect(id) { resurrected = id; } };
}
test("video local startup authenticates completed legacy and video receipts and preserves their original bytes", async t => {
  const f = await fixture(t); await f.receipt(legacyBinding, ids[0]); await f.receipt(binding, ids[1]); const before = await f.files();
  assert.equal(await f.operations.hasPending(), false);
  assert.deepEqual(await f.operations.verifyStartup(async () => {}), { verified: true, completedReceipts: 2, scope: "local_application" });
  assert.deepEqual(await f.operations.run(async () => {}), { completedReceipts: 2 });
  assert.ok(f.absent.includes(ids[0])); assert.ok(f.absent.includes(ids[1])); assert.deepEqual(await f.files(), before);
});
test("pending legacy closure blocks video upgrade without creating or rewriting a current job", async t => {
  const f = await fixture(t); await f.receipt(legacyBinding, ids[0], false); const before = await f.files();
  for (const operation of [() => f.operations.hasPending(), () => f.operations.preflight(async () => {}), () => f.operations.run(async () => {}), () => f.operations.verifyStartup(async () => {})])
    await assert.rejects(operation(), { code: "ERASURE_LEGACY_PENDING" });
  assert.equal(f.absent.length, 0); assert.deepEqual(await f.files(), before);
});
test("a completed legacy receipt cannot reopen a resurrected account under the new video scope", async t => {
  const f = await fixture(t); await f.receipt(legacyBinding, ids[0]); const before = await f.files(); f.resurrect(ids[0]);
  await assert.rejects(f.operations.verifyStartup(async () => {}), { code: "ERASURE_RESIDUAL" });
  assert.deepEqual(await f.files(), before);
});
test("duplicate client identities in different scopes remain an explicit blocker", async t => {
  const f = await fixture(t); await f.receipt(legacyBinding, ids[0]); await f.receipt(binding, ids[0]); const before = await f.files();
  await assert.rejects(f.operations.verifyStartup(async () => {}), { code: "ERASURE_CHANGED" }); assert.deepEqual(await f.files(), before);
});
