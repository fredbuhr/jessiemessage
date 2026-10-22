import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createErasureJournal, erasureJournalBindings, readErasureJournalBatch,
  verifyScopedErasureJournalEnvelope } from "../server/data/erasure-journal.mjs";
import { createQuickRepliesFiles } from "../server/quick-replies/files.mjs";
import { assertRegistryAdvance, assertRegistryEnvelopeAdvance, authenticateRegistrySnapshot,
  registryEnvelope, registryIdentity, snapshotErasureRegistry, validateRegistrySnapshot } from "../server/backup/registry-snapshot.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const key = Buffer.alloc(32, 7), at = 1792350000000;
const legacyBinding = { database: "synthetic_mixed_registry", rootFingerprint: "b".repeat(64) };
const binding = { ...legacyBinding, videoRootFingerprint: "c".repeat(64) };
const scopes = { binding, legacyBinding }, internal = { withDirectory: withErasureDirectory }, allow = async () => {};
const record = (target, clientId, phase = "requested", revision = 1) => ({ version: Object.hasOwn(target, "videoRootFingerprint") ? 2 : 1,
  clientId, binding: target, phase, cursor: null, startedAt: at, updatedAt: at + revision - 1 });
async function fixture(t) {
  const directory = await erasureDirectory(t);
  const create = async (target, id, completed = false) => {
    const journal = createErasureJournal({ directory, key, binding: target, clientId: id }, internal); t.after(() => journal.close());
    const phases = completed ? ["requested", "prepared", "files_erased", "completed"] : ["requested"];
    for (const [index, phase] of phases.entries()) await journal.save(record(target, id, phase, index + 1), index, allow);
    return journal;
  };
  const legacy = await create(legacyBinding, "a".repeat(32), true), current = await create(binding, "d".repeat(32));
  async function files() { return Promise.all((await readdir(directory)).sort().map(async name => ({ name,
    content: (await readFile(path.join(directory, name))).toString("base64url") }))); }
  return { directory, legacy, current, files, async state() { return { version: 2, ...scopes, files: await files() }; } };
}

test("video journal scopes are explicit, canonical and never accept an unrelated historical root", () => {
  assert.deepEqual(erasureJournalBindings(legacyBinding), { binding: legacyBinding });
  assert.deepEqual(erasureJournalBindings(binding), scopes);
  assert.throws(() => erasureJournalBindings({ ...binding, videoRootFingerprint: binding.rootFingerprint }), { code: "ERASURE_INPUT" });
  let accessed = false;
  const getter = Object.defineProperty({ ...legacyBinding }, "videoRootFingerprint", { enumerable: true, get() { accessed = true; return binding.videoRootFingerprint; } });
  assert.throws(() => erasureJournalBindings(getter)); assert.equal(accessed, false);
});

test("mixed batch discovery authenticates original v1 and v2 receipts without rewriting either", async t => {
  const f = await fixture(t), before = await f.files();
  const first = await readErasureJournalBatch({ directory: f.directory, key, ...scopes, limit: 1 }, internal);
  const second = await readErasureJournalBatch({ directory: f.directory, key, ...scopes, limit: 1, afterName: first.nextCursor }, internal);
  const jobs = [...first.jobs, ...second.jobs].sort((a, b) => a.version - b.version);
  assert.equal(first.jobs.length, 1); assert.ok(first.nextCursor); assert.equal(second.nextCursor, null);
  assert.deepEqual(jobs, [
    { clientId: "a".repeat(32), phase: "completed", revision: 4, updatedAt: at + 3, version: 1, binding: legacyBinding },
    { clientId: "d".repeat(32), phase: "requested", revision: 1, updatedAt: at, version: 2, binding },
  ]);
  await assert.rejects(readErasureJournalBatch({ directory: f.directory, key, binding }, internal), { code: "ERASURE_INPUT" });
  await assert.rejects(readErasureJournalBatch({ directory: f.directory, key, binding: legacyBinding }, internal));
  await assert.rejects(readErasureJournalBatch({ directory: f.directory, key, binding,
    legacyBinding: { ...legacyBinding, database: "other_database" } }, internal), { code: "ERASURE_INPUT" });
  assert.deepEqual(await f.files(), before);
});

test("scoped envelope verification selects only the declared version and keeps legacy records photo-only", async t => {
  const f = await fixture(t), files = await f.files();
  for (const file of files) {
    const content = Buffer.from(file.content, "base64url"), version = JSON.parse(content).version;
    const verified = verifyScopedErasureJournalEnvelope({ key, ...scopes, filename: file.name, content });
    assert.equal(verified.record.version, version);
    assert.deepEqual(verified.record.binding, version === 1 ? legacyBinding : binding);
    assert.throws(() => verifyScopedErasureJournalEnvelope({ key: Buffer.alloc(32, 8), ...scopes, filename: file.name, content }));
    assert.throws(() => verifyScopedErasureJournalEnvelope({ key, binding: { ...binding, rootFingerprint: "e".repeat(64) },
      legacyBinding: { ...legacyBinding, rootFingerprint: "e".repeat(64) }, filename: file.name, content }));
    if (version === 1) assert.throws(() => verifyScopedErasureJournalEnvelope({ key, binding, filename: file.name, content }), { code: "ERASURE_INPUT" });
    else assert.throws(() => verifyScopedErasureJournalEnvelope({ key, binding: { ...binding, videoRootFingerprint: "e".repeat(64) }, legacyBinding,
      filename: file.name, content }));
    const altered = JSON.parse(content); altered.version = version === 1 ? 2 : 1;
    assert.throws(() => verifyScopedErasureJournalEnvelope({ key, ...scopes, filename: file.name, content: Buffer.from(JSON.stringify(altered) + "\n") }));
  }
  assert.deepEqual(await f.files(), files);
});

test("video snapshots authenticate both original receipt scopes and never downgrade a v2 envelope into snapshot1", async t => {
  const f = await fixture(t), state = await f.state(), before = await f.files();
  const snapshot = snapshotErasureRegistry(state, { key, binding });
  assert.equal(snapshot.version, 2); assert.equal(snapshot.files.length, 2);
  const checked = authenticateRegistrySnapshot(snapshot, { key, binding });
  assert.deepEqual([...checked.jobs.values()].map(job => job.record.version).sort(), [1, 2]);
  assert.deepEqual(validateRegistrySnapshot(snapshot), snapshot);
  for (const file of snapshot.files) assert.equal(registryEnvelope(file), JSON.parse(Buffer.from(file.content, "base64url")).revision);
  assert.throws(() => validateRegistrySnapshot({ ...snapshot, version: 1 }), { code: "ERASURE_CONTINUITY_INPUT" });
  assert.throws(() => authenticateRegistrySnapshot(snapshot, { key, binding: legacyBinding }), { code: "ERASURE_CONTINUITY_BINDING" });
  assert.throws(() => authenticateRegistrySnapshot(snapshot, { key, binding: { ...binding, videoRootFingerprint: "e".repeat(64) } }), { code: "ERASURE_CONTINUITY_BINDING" });
  assert.throws(() => snapshotErasureRegistry({ ...state, legacyBinding: { ...legacyBinding, rootFingerprint: "e".repeat(64) } }, { key, binding }), { code: "ERASURE_CONTINUITY_BINDING" });
  assert.deepEqual(await f.files(), before); assert.deepEqual(key, Buffer.alloc(32, 7));
});

test("registry identities keep the original v1 HMAC and separate explicit video scopes", () => {
  const original = createHmac("sha256", key).update("jessiemessage:erasure-witness:https://jessiemessage.com:v1:").update(JSON.stringify(legacyBinding)).digest("hex");
  assert.equal(registryIdentity(key, legacyBinding), original);
  assert.notEqual(registryIdentity(key, binding), original);
  assert.notEqual(registryIdentity(key, binding), registryIdentity(key, { ...binding, videoRootFingerprint: "e".repeat(64) }));
});

test("mixed snapshot advances retain each original scope, revision and byte identity", async t => {
  const f = await fixture(t), initial = snapshotErasureRegistry(await f.state(), { key, binding });
  await f.current.save(record(binding, "d".repeat(32), "prepared", 2), 1, allow);
  const advanced = snapshotErasureRegistry(await f.state(), { key, binding });
  assert.deepEqual(assertRegistryAdvance(initial, advanced, { key, binding }), advanced);
  const legacy = initial.files.find(file => JSON.parse(Buffer.from(file.content, "base64url")).version === 1);
  assert.deepEqual(advanced.files.find(file => file.name === legacy.name), legacy);
  assert.throws(() => assertRegistryEnvelopeAdvance(advanced, initial), { code: "ERASURE_CONTINUITY_ROLLBACK" });
  assert.throws(() => assertRegistryEnvelopeAdvance(initial, { ...advanced, files: advanced.files.filter(file => file.name !== legacy.name) }), { code: "ERASURE_CONTINUITY_ROLLBACK" });
  const changedVersion = structuredClone(advanced), current = changedVersion.files.find(file => file.name !== legacy.name), envelope = JSON.parse(Buffer.from(current.content, "base64url"));
  envelope.version = 1; current.content = Buffer.from(JSON.stringify(envelope) + "\n").toString("base64url");
  assert.throws(() => assertRegistryEnvelopeAdvance(initial, changedVersion), { code: "ERASURE_CONTINUITY_ROLLBACK" });
  const legacyOnly = snapshotErasureRegistry({ version: 1, binding: legacyBinding, files: [legacy] }, { key, binding: legacyBinding });
  assert.throws(() => assertRegistryEnvelopeAdvance(legacyOnly, initial), { code: "ERASURE_CONTINUITY_BINDING" });
});

test("personal catalogues are authenticated then excluded from the erasure witness snapshot", async t => {
  const f = await fixture(t), before = snapshotErasureRegistry(await f.state(), { key, binding }), ownerId = "9".repeat(32);
  const replies = createQuickRepliesFiles(f.directory, key, ownerId, internal);
  try { await replies.save([{ id: "1".repeat(32), title: "Admin only", body: "Private personal phrase", language: "en" }], 0, allow); }
  finally { replies.close(); }
  const state = await f.state(), files = await f.files();
  const snapshot = snapshotErasureRegistry(state, { key, binding });
  assert.deepEqual(snapshot, before); assert.equal(snapshot.files.length, 2);
  assert.equal(authenticateRegistrySnapshot(snapshot, { key, binding }).jobs.size, 2);
  assert.equal(snapshot.files.some(file => file.name.startsWith("quick-replies-")), false);
  assert.deepEqual(await f.files(), files);
  const settings = state.files.find(file => file.name.startsWith("quick-replies-"));
  for (const mode of ["tag", "owner", "encoding", "name"]) {
    const altered = structuredClone(state), file = altered.files.find(value => value.name === settings.name);
    if (mode === "tag") { const value = JSON.parse(Buffer.from(file.content, "base64url")); value.envelope.tag = Buffer.alloc(16).toString("base64url"); file.content = Buffer.from(JSON.stringify(value) + "\n").toString("base64url"); }
    if (mode === "owner") file.name = `quick-replies-${"8".repeat(32)}.json`;
    if (mode === "encoding") file.content += "=";
    if (mode === "name") file.name = "quick-replies-invalid.json";
    assert.throws(() => snapshotErasureRegistry(altered, { key, binding }), mode);
  }
});
