import test from "node:test";
import assert from "node:assert/strict";
import { chmod, link, lstat, mkdir, readFile, readdir, statfs, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { createErasureJournal, verifyErasureJournalEnvelope } from "../server/data/erasure-journal.mjs";
import { createPrivacyFiles } from "../server/privacy/files.mjs";
import { DECISIONS } from "../server/privacy/draft.mjs";
import { captureOperationalState, operationalStateHash, writeOperationalCheckpoint, readOperationalCheckpoint,
  planOperationalRestore, restoreOperationalQuarantine, assertNoOperationalRestore, OPERATIONAL_CHECKPOINT, OPERATIONAL_RESTORE_MARKER } from "../server/backup/operational-checkpoint.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const key = Buffer.alloc(32, 7), binding = { database: "synthetic_private_database", rootFingerprint: "b".repeat(64) };
const targetBinding = { database: "synthetic_isolated_clone", rootFingerprint: "c".repeat(64) };
const now = 1792350000000, clientId = "a".repeat(32), allow = async () => {};
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const record = id => ({ version: 1, clientId: id, binding, phase: "requested", cursor: null, startedAt: now, updatedAt: now });
const prepared = () => ({ updatedAt: now, draft: { answers: Object.fromEntries(DECISIONS.map(id => [id, ""])),
  notice: { fr: "Préparation privée synthétique", en: "Synthetic private preparation" } } });
const receipt = () => ({ version: 10, profile: "messaging-photos-notify-recovery-crm-broadcast-application", createdAt: now,
  manifest: { sha256: "d".repeat(64) }, sql: { sha256: "e".repeat(64) }, media: { files: [], bytes: 0 } });
const capture = directory => withErasureDirectory(directory, scope => captureOperationalState(scope, { key, binding }));
const journalFor = (directory, id = clientId) => createErasureJournal({ directory, key, binding, clientId: id }, { withDirectory: withErasureDirectory });
async function populate(directory, completed = false, id = clientId) {
  const journal = journalFor(directory, id); let revision = 0, value = record(id);
  try {
    revision = (await journal.save(value, revision, allow)).revision;
    if (completed) for (const phase of ["prepared", "files_erased", "completed"]) {
      value = { ...value, phase, updatedAt: value.updatedAt + 1 }; revision = (await journal.save(value, revision, allow)).revision;
    }
  } finally { journal.close(); }
}
async function fixture(t) {
  const directory = await erasureDirectory(t), source = path.join(directory, "source"), checkpoint = path.join(directory, "checkpoint"), target = path.join(directory, "quarantine");
  for (const name of [source, checkpoint, target]) await mkdir(name, { mode: 0o700 });
  return { directory, source, checkpoint, target };
}
async function capsule(f, value) {
  const selected = receipt();
  selected.operations = await withErasureDirectory(f.checkpoint, scope => writeOperationalCheckpoint(scope, value, selected, key)); return selected;
}

test("an encrypted operational capsule preserves exact privacy and erasure bytes without identities in its envelope", async t => {
  const f = await fixture(t); await populate(f.source, true);
  const privacy = createPrivacyFiles(f.source, key, { withDirectory: withErasureDirectory });
  try { await privacy.save(prepared(), 0, allow); } finally { privacy.close(); }
  await writeFile(path.join(f.source, "backup-copy-state.json"), "pairing material excluded", { mode: 0o600 });
  const state = await capture(f.source), selected = await capsule(f, state);
  assert.equal(state.files.length, 2);
  const bytes = await readFile(path.join(f.checkpoint, OPERATIONAL_CHECKPOINT));
  assert.equal(hash(bytes), selected.operations.sha256);
  for (const secret of [clientId, binding.database, binding.rootFingerprint, "privacy-preparation", "completed", "pairing material"]) assert.equal(bytes.includes(secret), false);
  const restored = await withErasureDirectory(f.checkpoint, scope => readOperationalCheckpoint(scope, selected, key));
  assert.deepEqual(restored, state); assert.equal((await lstat(path.join(f.checkpoint, OPERATIONAL_CHECKPOINT))).mode & 0o7777, 0o600);
  assert.equal(key.equals(Buffer.alloc(32, 7)), true);
});
test("an empty registry is captured explicitly without claiming independent continuity", async t => {
  const f = await fixture(t), state = await capture(f.source), selected = await capsule(f, state);
  assert.deepEqual((await withErasureDirectory(f.checkpoint, scope => readOperationalCheckpoint(scope, selected, key))).files, []);
  const plan = planOperationalRestore({ backup: state, current: state, targetBinding, key });
  assert.equal(plan.externalContinuityVerified, false); assert.equal(plan.reconciliationRequired, true);
});
test("capsules authenticate SQL, raw manifest, media inventory, receipt date and profile before returning private data", async t => {
  const f = await fixture(t); await populate(f.source); const selected = await capsule(f, await capture(f.source));
  for (const change of [v => v.sql.sha256 = "1".repeat(64), v => v.manifest.sha256 = "2".repeat(64), v => v.media.bytes++,
    v => v.createdAt++, v => v.profile += "-other", v => v.version = 9]) {
    const altered = structuredClone(selected); change(altered);
    await assert.rejects(withErasureDirectory(f.checkpoint, scope => readOperationalCheckpoint(scope, altered, key)));
  }
  await assert.rejects(withErasureDirectory(f.checkpoint, scope => readOperationalCheckpoint(scope, selected, Buffer.alloc(32, 8))));
  const original = await readFile(path.join(f.checkpoint, OPERATIONAL_CHECKPOINT)), parsed = JSON.parse(original);
  parsed.tag = Buffer.alloc(16).toString("base64url"); const changed = Buffer.from(JSON.stringify(parsed) + "\n");
  await writeFile(path.join(f.checkpoint, OPERATIONAL_CHECKPOINT), changed);
  await assert.rejects(withErasureDirectory(f.checkpoint, scope => readOperationalCheckpoint(scope, { ...selected,
    operations: { ...selected.operations, bytes: changed.length, sha256: hash(changed) } }, key)));
});
test("journal byte verification preserves its original binding and rejects foreign names and noncanonical encodings", async t => {
  const f = await fixture(t); await populate(f.source);
  const state = await capture(f.source), file = state.files[0], content = Buffer.from(file.content, "base64url");
  assert.equal(verifyErasureJournalEnvelope({ key, binding, filename: file.name, content }).record.clientId, clientId);
  for (const change of [{ binding: targetBinding }, { filename: `erasure-${"f".repeat(64)}.json` }, { content: Buffer.from(content.toString().replace('"version":1', '"version":1,"version":1')) }])
    assert.throws(() => verifyErasureJournalEnvelope({ key, binding, filename: file.name, content, ...change }));
});
test("unsafe files, stale writer locks, malformed names and a restoration marker prevent capture", async t => {
  for (const mode of ["mode", "symlink", "hardlink", "lock", "name", "marker", "corrupt"]) {
    const f = await fixture(t); await populate(f.source); const name = path.join(f.source, (await readdir(f.source))[0]);
    if (mode === "mode") await chmod(name, 0o644);
    if (mode === "symlink") { const bytes = await readFile(name); await unlink(name); await writeFile(path.join(f.source, "foreign"), bytes, { mode: 0o600 }); await symlink("foreign", name); }
    if (mode === "hardlink") await link(name, path.join(f.source, "foreign"));
    if (mode === "lock") await writeFile(name.replace(/\.json$/, ".lock"), "", { mode: 0o600 });
    if (mode === "name") await writeFile(path.join(f.source, "erasure-invalid.json"), "{}", { mode: 0o600 });
    if (mode === "marker") await writeFile(path.join(f.source, OPERATIONAL_RESTORE_MARKER), "{}", { mode: 0o600 });
    if (mode === "corrupt") await writeFile(name, "{}", { mode: 0o600 });
    await assert.rejects(capture(f.source));
  }
});
test("capture rejects an acknowledged publication between its first inventory and final byte comparison", async t => {
  const f = await fixture(t); await populate(f.source); let calls = 0;
  await assert.rejects(withErasureDirectory(f.source, scope => captureOperationalState({ ...scope, async assertReady() {
    await scope.assertReady(); if (++calls === 4) { const journal = journalFor(f.source); try { await journal.save({ ...record(clientId), phase: "prepared", updatedAt: now + 1 }, 1, allow); } finally { journal.close(); } }
  } }, { key, binding })), { code: "OPERATIONS_CHANGED" });
});
test("a current completed receipt and additional newer closures survive an older SQL capture", async t => {
  const f = await fixture(t); await populate(f.source); const backup = await capture(f.source);
  const journal = journalFor(f.source);
  try { let revision = 1; for (const [index, phase] of ["prepared", "files_erased", "completed"].entries()) await journal.save({ ...record(clientId), phase, updatedAt: now + index + 1 }, revision++, allow); }
  finally { journal.close(); }
  await populate(f.source, true, "d".repeat(32)); const current = await capture(f.source);
  const plan = planOperationalRestore({ backup, current, targetBinding, key });
  assert.equal(plan.completedReceipts, 2); assert.equal(plan.pendingReceipts, 0); assert.equal(plan.bindingChanged, true);
  assert.deepEqual(plan.state.files, current.files); assert.equal(plan.state.binding.database, binding.database);
  assert.equal(plan.externalContinuityVerified, false);
});
test("a lost, older or differently bound current registry cannot authorize restoration", async t => {
  const f = await fixture(t); const empty = await capture(f.source); await populate(f.source, true); const complete = await capture(f.source);
  for (const current of [empty, null, { ...empty, binding: targetBinding }]) assert.throws(() => planOperationalRestore({ backup: complete, current, targetBinding, key }));
  assert.throws(() => planOperationalRestore({ backup: complete, current: empty, targetBinding, key }), { code: "OPERATIONS_REGISTRY_ROLLBACK" });
});
test("two independently encrypted states at the same revision are a conflict, never a silent last-writer choice", async t => {
  const f = await fixture(t), second = path.join(f.directory, "second"); await mkdir(second, { mode: 0o700 });
  await populate(f.source); await populate(second);
  const backup = await capture(f.source), current = await capture(second);
  assert.throws(() => planOperationalRestore({ backup, current, targetBinding, key }), { code: "OPERATIONS_REGISTRY_ROLLBACK" });
});
test("privacy restoration selects the higher authenticated revision and keeps absent current preparation recoverable", async t => {
  const f = await fixture(t), privacy = createPrivacyFiles(f.source, key, { withDirectory: withErasureDirectory });
  try {
    await privacy.save(prepared(), 0, allow); const backup = await capture(f.source);
    await privacy.save({ ...prepared(), updatedAt: now + 1 }, 1, allow); const current = await capture(f.source);
    assert.deepEqual(planOperationalRestore({ backup, current, targetBinding, key }).state.files, current.files);
    assert.deepEqual(planOperationalRestore({ backup: current, current: backup, targetBinding, key }).state.files, current.files);
    assert.deepEqual(planOperationalRestore({ backup, current: { ...backup, files: [] }, targetBinding, key }).state.files, backup.files);
  } finally { privacy.close(); }
});
test("quarantine publishes its startup-blocking marker before exact original encrypted files and never starts SQL or HTTP", async t => {
  const f = await fixture(t); await populate(f.source, true); const current = await capture(f.source); let proofs = 0;
  const result = await withErasureDirectory(f.target, scope => restoreOperationalQuarantine(scope, { backup: current, current, targetBinding, key,
    expectedCurrentSha256: operationalStateHash(current), assertCurrent: async expected => { proofs++; assert.equal(expected, operationalStateHash(current)); } }));
  assert.equal(result.started, false); assert.equal(result.reconciliationRequired, true); assert.equal(result.externalContinuityVerified, false); assert.equal(proofs, 2);
  for (const file of current.files) assert.equal((await readFile(path.join(f.target, file.name))).toString("base64url"), file.content);
  await assert.rejects(withErasureDirectory(f.target, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
  const marker = JSON.parse(await readFile(path.join(f.target, OPERATIONAL_RESTORE_MARKER)));
  assert.deepEqual(marker.sourceBinding, binding); assert.deepEqual(marker.targetBinding, targetBinding);
  await assert.rejects(withErasureDirectory(f.target, scope => restoreOperationalQuarantine(scope, { backup: current, current, targetBinding, key,
    expectedCurrentSha256: operationalStateHash(current), assertCurrent: allow })), { code: "OPERATIONS_NOT_EMPTY" });
});
test("stale confirmation, lost current proof and cancellation retain a blocking marker once copying has begun", async t => {
  for (const mode of ["stale", "before", "after", "abort"]) {
    const f = await fixture(t); await populate(f.source); const current = await capture(f.source), controller = new AbortController(); let calls = 0;
    await assert.rejects(withErasureDirectory(f.target, scope => restoreOperationalQuarantine(scope, { backup: current, current, targetBinding, key,
      expectedCurrentSha256: mode === "stale" ? "0".repeat(64) : operationalStateHash(current), signal: controller.signal,
      assertCurrent: async () => { calls++; if (mode === "before" || mode === "after" && calls === 2) throw new Error("Private source changed"); if (mode === "abort" && calls === 2) controller.abort(); } })));
    assert.equal((await readdir(f.target)).includes(OPERATIONAL_RESTORE_MARKER), ["after", "abort"].includes(mode));
    if (["after", "abort"].includes(mode)) await assert.rejects(withErasureDirectory(f.target, assertNoOperationalRestore));
  }
});
test("an absent marker is read-only; every present marker including a symlink blocks startup", async t => {
  const f = await fixture(t); await withErasureDirectory(f.target, assertNoOperationalRestore); assert.deepEqual(await readdir(f.target), []);
  await symlink("missing", path.join(f.target, OPERATIONAL_RESTORE_MARKER));
  await assert.rejects(withErasureDirectory(f.target, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
});
let procfs = false; try { procfs = (await statfs("/proc/self/fd", { bigint: true })).type === 0x9fa0n; } catch {}
test("native Linux descriptor anchoring captures, seals, rereads and quarantines operational files", { skip: !procfs }, async t => {
  const f = await fixture(t); await populate(f.source, true);
  const current = await withPrivateDirectory(f.source, scope => captureOperationalState(scope, { key, binding })), selected = receipt();
  selected.operations = await withPrivateDirectory(f.checkpoint, scope => writeOperationalCheckpoint(scope, current, selected, key));
  assert.deepEqual(await withPrivateDirectory(f.checkpoint, scope => readOperationalCheckpoint(scope, selected, key)), current);
  await withPrivateDirectory(f.target, scope => restoreOperationalQuarantine(scope, { backup: current, current, targetBinding, key,
    expectedCurrentSha256: operationalStateHash(current), assertCurrent: async expected => assert.equal(operationalStateHash(await capture(f.source)), expected) }));
  await assert.rejects(withPrivateDirectory(f.target, assertNoOperationalRestore));
});
test("Linux CI must exercise native operational checkpoint anchoring", { skip: !["true", "1"].includes(process.env.CI) }, () => assert.equal(procfs, true));

const videoBinding = { ...binding, videoRootFingerprint: "d".repeat(64) };
const videoTargetBinding = { ...targetBinding, videoRootFingerprint: "e".repeat(64) };
const videoReceipt = () => ({ ...receipt(), version: 12, profile: "messaging-photos-notify-recovery-crm-broadcast-video-application", video: { files: [], bytes: 0 } });
async function populateVideo(directory, id = "f".repeat(32), completed = false) {
  const journal = createErasureJournal({ directory, key, binding: videoBinding, clientId: id }, { withDirectory: withErasureDirectory });
  let value = { version: 2, clientId: id, binding: videoBinding, phase: "requested", cursor: null, startedAt: now, updatedAt: now }, revision = 0;
  try {
    revision = (await journal.save(value, revision, allow)).revision;
    if (completed) for (const phase of ["prepared", "files_erased", "completed"]) {
      value = { ...value, phase, updatedAt: value.updatedAt + 1 }; revision = (await journal.save(value, revision, allow)).revision;
    }
  } finally { journal.close(); }
}
const videoCapture = directory => withErasureDirectory(directory, scope => captureOperationalState(scope, { key, binding: videoBinding }));
test("video operational scope preserves and authenticates original v1 and v2 receipts in one explicit capsule", async t => {
  const f = await fixture(t); await populate(f.source, true); await populateVideo(f.source);
  const original = Object.fromEntries(await Promise.all((await readdir(f.source)).map(async name => [name, await readFile(path.join(f.source, name))])));
  const state = await videoCapture(f.source);
  assert.deepEqual(Object.keys(state), ["version", "binding", "legacyBinding", "files"]);
  assert.equal(state.version, 2); assert.deepEqual(state.binding, videoBinding); assert.deepEqual(state.legacyBinding, binding);
  assert.deepEqual(new Set(state.files.map(file => JSON.parse(Buffer.from(file.content, "base64url")).version)), new Set([1, 2]));
  for (const file of state.files) assert.deepEqual(Buffer.from(file.content, "base64url"), original[file.name]);
  const selected = videoReceipt(); selected.operations = await withErasureDirectory(f.checkpoint, scope => writeOperationalCheckpoint(scope, state, selected, key));
  assert.equal(JSON.parse(await readFile(path.join(f.checkpoint, OPERATIONAL_CHECKPOINT))).version, 2);
  assert.deepEqual(await withErasureDirectory(f.checkpoint, scope => readOperationalCheckpoint(scope, selected, key)), state);
  for (const [name, content] of Object.entries(original)) assert.deepEqual(await readFile(path.join(f.source, name)), content);
});
test("video capsule AAD binds the video inventory and cannot be read as a legacy capsule", async t => {
  const f = await fixture(t); await populate(f.source, true); await populateVideo(f.source);
  const state = await videoCapture(f.source), selected = videoReceipt();
  selected.operations = await withErasureDirectory(f.checkpoint, scope => writeOperationalCheckpoint(scope, state, selected, key));
  for (const change of [value => value.video.bytes++, value => value.video.files.push({ name: "a".repeat(64) + ".video.enc", bytes: 1, sha256: "b".repeat(64) }), value => value.version = 10]) {
    const altered = structuredClone(selected); change(altered);
    await assert.rejects(withErasureDirectory(f.checkpoint, scope => readOperationalCheckpoint(scope, altered, key)));
  }
  const legacyDestination = path.join(f.directory, "legacy-destination"); await mkdir(legacyDestination, { mode: 0o700 });
  await assert.rejects(withErasureDirectory(legacyDestination, scope => writeOperationalCheckpoint(scope, state, receipt(), key)), { code: "OPERATIONS_INPUT" });
  assert.deepEqual(await readdir(legacyDestination), []);
});
test("mixed operational scope rejects an omitted or substituted legacy binding and any video downgrade", async t => {
  const f = await fixture(t); await populate(f.source, true); await populateVideo(f.source, "f".repeat(32), true);
  const state = await videoCapture(f.source);
  for (const changed of [{ ...state, legacyBinding: targetBinding }, { version: 2, binding: videoBinding, files: state.files },
    { version: 1, binding: videoBinding, files: state.files }, { ...state, binding: { ...videoBinding, videoRootFingerprint: "0".repeat(64) } }])
    assert.throws(() => planOperationalRestore({ backup: state, current: changed, targetBinding: videoTargetBinding, key }));
  assert.throws(() => planOperationalRestore({ backup: state, current: state, targetBinding, key }), { code: "OPERATIONS_BINDING_CHANGED" });
  await assert.rejects(withErasureDirectory(f.source, scope => captureOperationalState(scope, { key, binding })), "legacy-only scope must not accept a video envelope");
});
test("video quarantine retains both original scopes with a v2 blocking marker and rejects photo-only reopening", async t => {
  const f = await fixture(t); await populate(f.source, true); await populateVideo(f.source, "f".repeat(32), true);
  const state = await videoCapture(f.source), expected = operationalStateHash(state);
  const result = await withErasureDirectory(f.target, scope => restoreOperationalQuarantine(scope, { backup: state, current: state,
    targetBinding: videoTargetBinding, key, expectedCurrentSha256: expected, assertCurrent: async actual => assert.equal(actual, expected) }));
  assert.equal(result.started, false); assert.equal(result.completedReceipts, 2);
  const marker = JSON.parse(await readFile(path.join(f.target, OPERATIONAL_RESTORE_MARKER)));
  assert.equal(marker.version, 2); assert.deepEqual(marker.sourceBinding, videoBinding); assert.deepEqual(marker.targetBinding, videoTargetBinding);
  for (const file of state.files) assert.equal((await readFile(path.join(f.target, file.name))).toString("base64url"), file.content);
  const { readOperationalQuarantine } = await import("../server/backup/operational-checkpoint.mjs");
  const restored = await withErasureDirectory(f.target, scope => readOperationalQuarantine(scope, { key, sourceBinding: videoBinding, targetBinding: videoTargetBinding }));
  assert.deepEqual(restored.state, state);
  await assert.rejects(withErasureDirectory(f.target, scope => readOperationalQuarantine(scope, { key, sourceBinding: binding, targetBinding })));
});
