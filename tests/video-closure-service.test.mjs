import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createClosureService } from "../server/data/closure-service.mjs";
import { createErasureJournal, erasureJournalBindings, readErasureJournalBatch } from "../server/data/erasure-journal.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const key = Buffer.alloc(32, 7), clientId = "a".repeat(32), at = 1792350000000;
const legacyBinding = { database: "synthetic_video_closure_service", rootFingerprint: "b".repeat(64) };
const binding = { ...legacyBinding, videoRootFingerprint: "c".repeat(64) };
const payload = { confirmation: "FERMER", expectedPseudonym: "Synthetic client" }, allow = async () => {};
const record = (target, phase = "requested", revision = 1) => ({ version: Object.hasOwn(target, "videoRootFingerprint") ? 2 : 1,
  clientId, binding: target, phase, cursor: null, startedAt: at, updatedAt: at + revision - 1 });
async function fixture(t, { selectedBinding = binding, gone = true } = {}) {
  const directory = await erasureDirectory(t), internal = { withDirectory: withErasureDirectory };
  let targets = 0, leases = 0, inspected = 0;
  const journalFor = (id, target = selectedBinding) => createErasureJournal({ directory, key, binding: target, clientId: id }, internal);
  const service = createClosureService({ directory, key, clock: () => at,
    store: { binding: selectedBinding, async withLease(id, work) { assert.equal(id, clientId); leases++; return work({ async inspect(now) { assert.equal(now, at); inspected++; } }); } },
    target: async id => { targets++; assert.equal(id, clientId); if (gone) throw Object.assign(new Error("Synthetic identity absent"), { code: "ERASURE_TARGET" });
      return { id, pseudonym: payload.expectedPseudonym, status: "active" }; },
  }, { journalFor, batch: options => readErasureJournalBatch({ directory, key, ...erasureJournalBindings(selectedBinding), ...options }, internal) });
  t.after(() => service.close());
  async function seed(target, lastPhase = "completed") {
    const journal = journalFor(clientId, target), phases = ["requested", "prepared", "files_erased", "completed"];
    try { for (const [index, phase] of phases.entries()) {
      await journal.save(record(target, phase, index + 1), index, allow); if (phase === lastPhase) break;
    } } finally { journal.close(); }
  }
  const bytes = async () => Promise.all((await readdir(directory)).sort().map(async name => ({ name, content: await readFile(path.join(directory, name)) })));
  return { directory, service, seed, bytes, journalFor, counts: () => ({ targets, leases, inspected }) };
}

test("a completed historical v1 closure stays listable and idempotent without a SQL account or new video receipt", async t => {
  const f = await fixture(t); await f.seed(legacyBinding); const original = await f.bytes();
  const list = await f.service.list(); assert.equal(list.version, 1); assert.equal(list.jobs.length, 1);
  assert.equal(list.jobs[0].clientId, clientId); assert.equal(list.jobs[0].phase, "completed");
  const preview = await f.service.preview(clientId); assert.equal(preview.client, null); assert.equal(preview.closure.phase, "completed");
  assert.deepEqual(Object.keys(preview), ["version", "client", "closure"]);
  let proofs = 0;
  const accepted = await f.service.request(clientId, payload, async () => { proofs++; });
  assert.equal(accepted.accepted, true); assert.equal(accepted.closure.phase, "completed"); assert.equal(proofs, 1);
  assert.deepEqual(f.counts(), { targets: 0, leases: 0, inspected: 0 }); assert.deepEqual(await f.bytes(), original);
  const legacy = f.journalFor(clientId, legacyBinding), current = f.journalFor(clientId);
  try { assert.equal((await legacy.read()).record.version, 1); assert.equal((await current.read()).record, null); }
  finally { legacy.close(); current.close(); }
});

test("a historical completion still requires a fresh authorization before request acceptance", async t => {
  const f = await fixture(t); await f.seed(legacyBinding); const before = await f.bytes();
  await assert.rejects(f.service.request(clientId, payload, async () => { throw new Error("Synthetic authorization revoked"); }), /authorization revoked/);
  assert.deepEqual(await f.bytes(), before); assert.deepEqual(f.counts(), { targets: 0, leases: 0, inspected: 0 });
});

test("incomplete historical work blocks new video preview and requests without rewriting the legacy receipt", async t => {
  for (const phase of ["requested", "prepared", "files_erased"]) {
    const f = await fixture(t); await f.seed(legacyBinding, phase); const original = await f.bytes();
    await assert.rejects(f.service.preview(clientId), { code: "ERASURE_LEGACY_PENDING" });
    await assert.rejects(f.service.request(clientId, payload, allow), { code: "ERASURE_LEGACY_PENDING" });
    assert.deepEqual(f.counts(), { targets: 0, leases: 0, inspected: 0 }); assert.deepEqual(await f.bytes(), original);
  }
});

test("a new video intent remains v2 and repeats only the existing request", async t => {
  const f = await fixture(t, { gone: false });
  const accepted = await f.service.request(clientId, payload, allow); assert.equal(accepted.closure.phase, "requested");
  assert.deepEqual(f.counts(), { targets: 2, leases: 1, inspected: 1 });
  const original = await f.bytes(); assert.equal(original.length, 1); assert.equal(JSON.parse(original[0].content).version, 2);
  const journal = f.journalFor(clientId);
  try { assert.deepEqual((await journal.read()).record, record(binding)); } finally { journal.close(); }
  await f.service.request(clientId, payload, allow);
  assert.deepEqual(f.counts(), { targets: 2, leases: 1, inspected: 1 }); assert.deepEqual(await f.bytes(), original);
});

test("an unrelated old root cannot stand in for a completed historical closure", async t => {
  const f = await fixture(t, { selectedBinding: { ...binding, rootFingerprint: "d".repeat(64) } });
  await f.seed(legacyBinding); const original = await f.bytes();
  await assert.rejects(f.service.preview(clientId), { code: "ERASURE_TARGET" });
  await assert.rejects(f.service.request(clientId, payload, allow), { code: "ERASURE_TARGET" });
  await assert.rejects(f.service.list());
  assert.deepEqual(await f.bytes(), original); assert.equal(f.counts().leases, 0);
});
