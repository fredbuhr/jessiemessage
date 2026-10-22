import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, open, lstat, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyCheckpointVideo, verifyCheckpointVideo, resumeCheckpointVideo, VideoCheckpointFilesError } from "../server/backup/video-checkpoint-files.mjs";
import { copyCheckpointMedia } from "../server/backup/checkpoint-files.mjs";

async function fixture(t) {
  const base = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(base, "video-checkpoint-")); t.after(() => rm(root, { recursive: true, force: true }));
  async function scope(name) {
    const path = join(root, name); await mkdir(path, { mode: 0o700 }); const initial = await lstat(path, { bigint: true });
    return { path, file: name => join(path, name), async assertReady() {
      const current = await lstat(path, { bigint: true }); assert.equal(current.ino, initial.ino); assert.equal(current.dev, initial.dev); return current;
    }, async sync() { const file = await open(path, "r"); try { await file.sync(); } finally { await file.close(); } } };
  }
  return { source: await scope("source"), target: await scope("target") };
}
const name = id => `${String(id).padStart(64, "0")}.video.enc`;
const rejected = error => error instanceof VideoCheckpointFilesError && /^VIDEO_CHECKPOINT_FILES_[A-Z]+$/.test(error.code);

test("video checkpoint copies a ciphertext above the photo bound in bounded reads and the photo namespace stays closed", async t => {
  const f = await fixture(t), file = await open(f.source.file(name(1)), "wx", 0o600), chunk = Buffer.alloc(1024 * 1024, 71);
  try { for (let index = 0; index < 11; index++) await file.write(chunk); await file.sync(); } finally { await file.close(); }
  const inventory = await copyCheckpointVideo(f.source, f.target);
  assert.equal(inventory.bytes, 11 * chunk.length); assert.equal(inventory.files.length, 1);
  assert.deepEqual(await verifyCheckpointVideo(f.target, inventory), inventory);
  const original = await lstat(f.source.file(name(1))), copied = await lstat(f.target.file(name(1))); assert.notEqual(original.ino, copied.ino);
  await assert.rejects(copyCheckpointMedia(f.source, f.target));
});

test("video restore retains matching files and adds only absent ciphertext without overwriting a divergent copy", async t => {
  const f = await fixture(t); await writeFile(f.source.file(name(1)), "synthetic ciphertext one", { mode: 0o600 });
  await writeFile(f.source.file(name(2)), "synthetic ciphertext two", { mode: 0o600 });
  const inventory = await copyCheckpointVideo(f.source, f.target), before = await lstat(f.target.file(name(1)), { bigint: true });
  await unlink(f.target.file(name(2))); await resumeCheckpointVideo(f.source, f.target, inventory);
  assert.equal((await lstat(f.target.file(name(1)), { bigint: true })).ino, before.ino);
  await writeFile(f.target.file(name(2)), "synthetic changed bytes", { mode: 0o600 });
  await assert.rejects(resumeCheckpointVideo(f.source, f.target, inventory), rejected);
  assert.equal((await readFile(f.target.file(name(2)))).toString(), "synthetic changed bytes");
});

test("video copier refuses photo, staging and unknown entries and source/target aliases", async t => {
  for (const entry of [`${"1".repeat(64)}.full.enc`, `.${"1".repeat(64)}.video.${"2".repeat(32)}.tmp`, "unknown"]) {
    const f = await fixture(t); await writeFile(f.source.file(entry), "private synthetic bytes", { mode: 0o600 });
    await assert.rejects(copyCheckpointVideo(f.source, f.target), rejected);
  }
  const f = await fixture(t); await assert.rejects(copyCheckpointVideo(f.source, f.source), rejected);
});
