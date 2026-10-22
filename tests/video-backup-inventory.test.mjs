import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import filesystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { randomBytes, createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, readFile, writeFile, readdir, copyFile, chmod, link, symlink, rename, statfs } from "node:fs/promises";
import { createVideoStorage, VIDEO_BLOCK_BYTES, videoStoredBytes } from "../server/video/storage.mjs";
import { inspectVideoBackupInventory, assertVideoBackupInventory } from "../server/backup/video-inventory.mjs";

const base = path.resolve(import.meta.dirname, "../../audit");
const procAvailable = process.platform === "linux" && await statfs("/proc/self/fd", { bigint: true }).then(stats => stats.type === 0x9fa0n, () => false);
const date = "2026-10-22 00:00:00.000000";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function fixture(t, pathMode = "strict") {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "video-backup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = randomBytes(32), storage = await createVideoStorage({ root, key, pathMode });
  const video = { capacity: { ownerBytes: 10 * 1024 * 1024, totalBytes: 100 * 1024 * 1024, heldBytes: 0,
    rootFingerprint: (await storage.fingerprint()).toString("hex"), initializedAt: date }, assets: [] };
  async function add({ bytes = VIDEO_BLOCK_BYTES * 2 + 19, state = "committed", file = state === "committed" } = {}) {
    const id = randomBytes(16), storageKey = randomBytes(32), content = randomBytes(bytes);
    const row = { id: id.toString("hex"), owner_id: "1".repeat(32), owner_role: "admin", storage_key: storageKey.toString("hex"), reserve_token_hash: "2".repeat(64),
      content_digest: state === "reserved" ? null : hash(content), bytes, stored_bytes: videoStoredBytes(bytes), mime: "video/mp4", state,
      created_at: date, updated_at: date, released_at: state === "released" ? date : null };
    if (file) await storage.put({ assetId: id, storageKey, bytes, source: (async function* () { for (let start = 0; start < bytes; start += 16381) yield content.subarray(start, start + 16381); })() });
    video.assets.push(row); video.assets.sort((a, b) => a.id.localeCompare(b.id));
    if (state !== "released") video.capacity.heldBytes += row.stored_bytes;
    return { row, content, id, storageKey, filename: path.join(root, `${row.storage_key}.video.enc`) };
  }
  return { root, key, storage, video, add };
}
const codes = report => report.issues.map(issue => issue.code);

for (const pathMode of ["strict", "linux-dirfd"]) test(`video inventory authenticates every block and preserves source bytes (${pathMode})`, {
  skip: pathMode === "linux-dirfd" && !procAvailable ? "Real procfs descriptor paths are unavailable in this sandbox" : false,
}, async t => {
  const f = await fixture(t, pathMode), item = await f.add(), before = await readFile(item.filename);
  const entry = await f.storage.inspectEntry({ storageKey: item.storageKey });
  assert.equal(entry.exists, true); assert.equal(entry.kind, "published"); assert.equal(entry.status, "structural_ok");
  assert.equal(entry.encryptedBytes, BigInt(item.row.stored_bytes));
  const report = await assertVideoBackupInventory({ video: f.video, storage: f.storage });
  assert.equal(report.integrity, "authenticated"); assert.equal(report.complete, true); assert.equal(report.healthy, true);
  assert.equal(report.counts.authenticated, 1); assert.equal(report.counts.files, 1); assert.deepEqual(report.issues, []);
  assert.equal(report.bytes.declared, String(item.row.stored_bytes)); assert.equal(report.bytes.observedEncrypted, String(item.row.stored_bytes));
  assert.deepEqual(await readFile(item.filename), before); assert.equal(hash(item.content), item.row.content_digest);
  assert.equal(JSON.stringify(report).includes(item.content.toString("base64")), false);
  assert.deepEqual(await f.storage.inspectEntry({ storageKey: randomBytes(32) }), { exists: false });
});

test("structure-only video inspection cannot certify a corrupted GCM tag or substituted plaintext digest", async t => {
  const f = await fixture(t), item = await f.add();
  const changed = await readFile(item.filename); changed[48 + VIDEO_BLOCK_BYTES + 16 + 3] ^= 1; await writeFile(item.filename, changed);
  assert.equal((await f.storage.inspectEntry({ storageKey: item.storageKey })).status, "structural_ok");
  const structural = await inspectVideoBackupInventory({ video: f.video, storage: f.storage, authenticate: false });
  assert.equal(structural.integrity, "structure_only"); assert.equal(structural.healthy, true); assert.equal(structural.counts.authenticated, 0);
  const authenticated = await inspectVideoBackupInventory({ video: f.video, storage: f.storage });
  assert.equal(authenticated.healthy, false); assert.ok(codes(authenticated).includes("authentication_failed"));
  await assert.rejects(assertVideoBackupInventory({ video: f.video, storage: f.storage }), { code: "BACKUP_VIDEO_INVENTORY" });
  await rm(item.filename); await f.storage.put({ assetId: item.id, storageKey: item.storageKey, bytes: item.content.length, source: (async function* () { yield item.content; })() });
  item.row.content_digest = "a".repeat(64);
  const mismatch = await inspectVideoBackupInventory({ video: f.video, storage: f.storage });
  assert.equal(mismatch.healthy, false); assert.ok(codes(mismatch).includes("content_digest_mismatch"));
});

test("offline video backup retains recoverable pending allocations and demands durable released-file absence", async t => {
  for (const state of ["reserved", "cleanup_pending"]) for (const file of [false, true]) {
    const f = await fixture(t); await f.add({ bytes: 130, state, file });
    const report = await assertVideoBackupInventory({ video: f.video, storage: f.storage });
    assert.equal(report.healthy, true); assert.equal(report.counts[state === "reserved" ? "reserved" : "cleanupPending"], 1);
    assert.equal(report.counts.authenticated, file ? 1 : 0);
  }
  const f = await fixture(t); await f.add({ bytes: 130, state: "released", file: true });
  const invalid = await inspectVideoBackupInventory({ video: f.video, storage: f.storage });
  assert.equal(invalid.healthy, false); assert.ok(codes(invalid).includes("released_file_present"));
  const absent = await fixture(t); await absent.add({ state: "released", file: false });
  const report = await assertVideoBackupInventory({ video: absent.video, storage: absent.storage });
  assert.equal(report.counts.released, 1); assert.equal(report.counts.files, 0); assert.equal(report.bytes.declared, "0");
});

test("missing committed video and unknown, orphan or interrupted staging entries are reported without deleting anything", async t => {
  for (const kind of ["missing", "unknown", "orphan", "staging"]) {
    const f = await fixture(t), item = await f.add({ bytes: 300 });
    if (kind === "missing") await rm(item.filename);
    if (kind === "unknown") await writeFile(path.join(f.root, "unrecognized"), "opaque synthetic", { mode: 0o600 });
    if (kind === "orphan") { const unrelated = randomBytes(32); await writeFile(path.join(f.root, `${unrelated.toString("hex")}.video.enc`), await readFile(item.filename), { mode: 0o600 }); }
    if (kind === "staging") await writeFile(path.join(f.root, `.${item.row.storage_key}.video.${"3".repeat(32)}.tmp`), "incomplete", { mode: 0o600 });
    const before = (await readdir(f.root)).sort(), report = await inspectVideoBackupInventory({ video: f.video, storage: f.storage });
    assert.equal(report.healthy, false); assert.ok(codes(report).includes({ missing: "missing_committed", unknown: "unknown_file", orphan: "orphan_file", staging: "staging_file" }[kind]));
    assert.deepEqual((await readdir(f.root)).sort(), before);
  }
});

test("video scans never follow symlinks, hardlinks, unsafe modes or directory entries", async t => {
  for (const kind of ["symlink", "hardlink", "mode", "directory"]) {
    const f = await fixture(t), item = await f.add({ bytes: 90 });
    if (kind === "symlink") { await rename(item.filename, `${item.filename}.retained`); await symlink(`${item.filename}.retained`, item.filename); }
    if (kind === "hardlink") await link(item.filename, `${item.filename}.retained`);
    if (kind === "mode") await chmod(item.filename, 0o644);
    if (kind === "directory") { await rm(item.filename); await mkdir(item.filename, { mode: 0o700 }); }
    assert.equal((await f.storage.inspectEntry({ storageKey: item.storageKey })).status, "unsafe");
    const report = await inspectVideoBackupInventory({ video: f.video, storage: f.storage });
    assert.equal(report.healthy, false); assert.ok(codes(report).includes("unsafe"));
  }
});

test("capacity/root substitutions and invalid catalogue fields refuse inventory", async t => {
  const f = await fixture(t); await f.add({ bytes: 100 });
  for (const change of [v => { v.capacity.rootFingerprint = "0".repeat(64); }, v => { v.capacity.heldBytes++; }, v => { v.assets.push({ ...v.assets[0] }); },
    v => { v.assets[0].released_at = date; }, v => { v.assets[0].owner_role = "foreign"; }, v => { v.assets[0].created_at = "2026-02-30 00:00:00.000000"; }]) {
    const video = structuredClone(f.video); change(video);
    const report = await inspectVideoBackupInventory({ video, storage: f.storage }); assert.equal(report.healthy, false);
  }
});

test("bounded video scan and inventory cancellation cannot report a complete backup", async t => {
  const f = await fixture(t); await f.add({ bytes: 100 }); await f.add({ bytes: 100 });
  await assert.rejects((async () => { for await (const _ of f.storage.scanEntries({ maxEntries: 1 })) {} })(), { code: "VIDEO_SCAN_LIMIT" });
  const limited = await inspectVideoBackupInventory({ video: f.video, storage: f.storage, limits: { maxEntries: 1 } });
  assert.equal(limited.complete, false); assert.equal(limited.healthy, false); assert.ok(codes(limited).includes("entry_limit"));
  const controller = new AbortController(); controller.abort();
  const aborted = await inspectVideoBackupInventory({ video: f.video, storage: f.storage, signal: controller.signal });
  assert.equal(aborted.complete, false); assert.ok(codes(aborted).includes("aborted"));
});

test("a changed video file between inspection and scan is refused rather than accepted from stale metadata", async t => {
  const f = await fixture(t), item = await f.add({ bytes: 100 });
  const storage = { ...f.storage, async *scanEntries(options) { await chmod(item.filename, 0o644); yield* f.storage.scanEntries(options); } };
  const report = await inspectVideoBackupInventory({ video: f.video, storage });
  assert.equal(report.complete, false); assert.equal(report.healthy, false); assert.ok(codes(report).includes("filesystem_drift"));
});

test("video scan retains the pinned original root and refuses a renamed/replaced directory", async t => {
  const f = await fixture(t); await f.add({ bytes: 100 }); const before = `${f.root}-old`; t.after(() => rm(before, { recursive: true, force: true }));
  const iterator = f.storage.scanEntries()[Symbol.asyncIterator](); assert.equal((await iterator.next()).done, false);
  await rename(f.root, before); await mkdir(f.root, { mode: 0o700 });
  await assert.rejects(iterator.next(), { code: "VIDEO_UNAVAILABLE" });
  assert.equal((await readdir(before)).length, 1); assert.deepEqual(await readdir(f.root), []);
});


test("returning a video scan early closes its directory and propagates a failed close", async t => {
  const f = await fixture(t); await f.add({ bytes: 100 });
  let closed = 0; const original = filesystem.opendir;
  const patched = t.mock.method(filesystem, "opendir", async (...args) => {
    const directory = await original(...args);
    return { read: (...values) => directory.read(...values), async close() { await directory.close(); closed++; throw new Error("synthetic-close-failure"); } };
  });
  syncBuiltinESMExports();
  try {
    const scan = f.storage.scanEntries()[Symbol.asyncIterator](); assert.equal((await scan.next()).done, false);
    await assert.rejects(scan.return(), { code: "VIDEO_UNAVAILABLE" }); assert.equal(closed, 1);
  } finally { patched.mock.restore(); syncBuiltinESMExports(); }
});


test("a separate copied root needs the explicit preverified clone fingerprint while the default remains source-bound", async t => {
  const source = await fixture(t), item = await source.add({ bytes: 100 }), target = await fixture(t);
  const storage = await createVideoStorage({ root: target.root, key: source.key });
  await copyFile(item.filename, path.join(target.root, path.basename(item.filename)));
  const before = await inspectVideoBackupInventory({ video: source.video, storage });
  assert.equal(before.healthy, false); assert.ok(codes(before).includes("capacity_binding_mismatch"));
  const expectedRootFingerprint = (await storage.fingerprint()).toString("hex");
  const verified = await assertVideoBackupInventory({ video: source.video, storage, expectedRootFingerprint });
  assert.equal(verified.healthy, true); assert.equal(verified.counts.authenticated, 1);
  const changed = await inspectVideoBackupInventory({ video: source.video, storage, expectedRootFingerprint: "0".repeat(64) });
  assert.equal(changed.healthy, false); assert.ok(codes(changed).includes("capacity_binding_mismatch"));
});
