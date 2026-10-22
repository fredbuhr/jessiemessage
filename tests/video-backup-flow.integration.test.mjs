import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadMigrations } from "../server/db/migrations.mjs";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { readOperationalCheckpoint } from "../server/backup/operational-checkpoint.mjs";
import { snapshotErasureRegistry, authenticateRegistrySnapshot } from "../server/backup/registry-snapshot.mjs";
import { assertBackupSnapshot } from "../server/backup/snapshot.mjs";
import { verifyCheckpointVideo } from "../server/backup/video-checkpoint-files.mjs";
import { videoBackupFixture, fileInventory, fileHash, VIDEO_BACKUP_PROFILE } from "./fixtures/video-backup-flow.mjs";
import { qualifyVideoManualRestore } from "./fixtures/video-backup-manual-restore.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const cloneKeys = keys => Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, Buffer.from(key)]));

test("native SQL36 video backup captures two encrypted roots, resumes a separate clone and preserves old closure receipts", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with two explicit disposable loopback databases, native SQL/tar clients and procfs.", timeout: 240000,
}, async t => {
  const f = await videoBackupFixture(t);
  await t.test("capture uses seven private keys, native SQL dumps and tar with exact photo/video inventories", async () => {
    const report = await f.capture();
    assert.equal(report.status, "application_checkpoint_saved"); assert.equal(report.profile, `messaging-${VIDEO_BACKUP_PROFILE}`);
    assert.equal(report.tables, 36); assert.equal(report.migrations, 36); assert.equal(report.operationsCovered, true);
    assert.equal(report.archiveListed, true); assert.equal(report.archiveContentsVerified, true);
    assert.equal((await loadMigrations()).length, 33, "candidate backup never promotes the normal migration plan");
    assert.equal(f.manifest.version, 11); assert.equal(f.receipt.version, 12); assert.deepEqual(f.receipt.schema, { tables: 36, migrations: 36 });
    assert.equal(f.payload.snapshot.version, 3); assert.equal(f.payload.snapshot.video.assets.length, 6);
    assert.equal(f.receipt.media.files.length, 4); assert.equal(f.receipt.video.files.length, 5);
    assert.equal(f.receipt.sql.uncompressedSha256.length, 64);
    const operations = await withPrivateDirectory(f.dirs.checkpoint, scope => readOperationalCheckpoint(scope, f.receipt, f.keys.crmKey));
    assert.equal(operations.version, 2); assert.equal(operations.files.length, 3);
    assert.equal(operations.files.find(file => file.name === f.quickReplies.filename).content, f.quickReplies.ciphertext.toString("base64url"));
    assert.deepEqual(operations.binding, f.binding); assert.deepEqual(operations.legacyBinding, f.legacyBinding);
    const registry = snapshotErasureRegistry(operations, { key: f.keys.crmKey, binding: f.binding });
    const { jobs } = authenticateRegistrySnapshot(registry, { key: f.keys.crmKey, binding: f.binding });
    assert.deepEqual([...jobs.values()].map(job => job.record.version).sort(), [1, 2]);
    assert.equal([...jobs.values()].every(job => job.record.phase === "completed"), true);
    const copied = await fileInventory(path.join(f.dirs.checkpoint, "video"));
    assert.deepEqual(copied, f.sourceBaseline.videos);
    await f.assertSourceUnchanged();
  });
  await t.test("real operator import/resume verifies an empty clone once, keeps an existing clone and resumes video files without replacement", async () => {
    const imported = await f.import();
    assert.equal(imported.status, "application_checkpoint_restored_verified"); assert.equal(imported.applicationSnapshotMatched, true);
    assert.equal(imported.httpStarted, false); assert.equal(imported.smtpStarted, false); assert.equal(imported.workersStarted, false);
    assert.equal(f.operator.imports, 1);
    const before = await f.snapshot(); assert.equal(before.version, 3); assert.equal(before.counts.tables, 36);
    const retained = await f.interruptVideoCopy(); assert.ok(retained);
    const retainedPath = path.join(f.dirs.targetVideo, retained.name), hash = fileHash(await readFile(retainedPath));
    assert.equal(retained.stat.mode & 0o7777n, 0o600n);
    await f.copy();
    const after = await lstat(retainedPath, { bigint: true });
    for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"]) assert.equal(after[key], retained.stat[key], `retained ${key}`);
    assert.equal(fileHash(await readFile(retainedPath)), hash);
    assert.deepEqual(await fileInventory(f.dirs.targetMedia), f.sourceBaseline.photos);
    assert.deepEqual(await fileInventory(f.dirs.targetVideo), f.sourceBaseline.videos);
    assert.equal(await f.databaseHash(f.targetDatabase), f.sourceBaseline.sql);
    const files = { photos: await fileInventory(f.dirs.targetMedia), videos: await fileInventory(f.dirs.targetVideo) },
      checkpointNames = (await readdir(f.dirs.checkpoint)).sort();
    const resumed = await f.resumeImport();
    assert.equal(resumed.status, "application_checkpoint_existing_clone_verified"); assert.equal(resumed.action, "verified_existing_clone");
    assert.equal(resumed.imported, false); assert.equal(resumed.importedThisRun, false); assert.equal(resumed.applicationSnapshotMatched, true);
    assert.equal(f.operator.imports, 1, "the existing clone is verified through the real wrapper, never imported again");
    assert.equal(f.operator.resumes, 2); assert.ok(f.operator.inspections.includes("empty")); assert.ok(f.operator.inspections.includes("application-schema"));
    assert.deepEqual(await fileInventory(f.dirs.targetMedia), files.photos); assert.deepEqual(await fileInventory(f.dirs.targetVideo), files.videos);
    assert.deepEqual((await readdir(f.dirs.checkpoint)).sort(), checkpointNames, "native import/dump defaults and temporary files are removed");
    await f.assertSourceUnchanged();
  });
  await t.test("a source photo root substitution and a corrupt checkpoint video fail before recovery or source mutation", async () => {
    const beforeSql = await f.databaseHash(f.targetDatabase), beforePhotos = await fileInventory(f.dirs.targetMedia), beforeVideos = await fileInventory(f.dirs.targetVideo);
    await assert.rejects(f.backup("restore", { configure() {
      const keys = cloneKeys(f.keys);
      return { databaseName: f.targetDatabase,
        media: { enabled: true, root: f.dirs.sourceMedia, key: keys.mediaKey, capacity: { ...f.limits }, minimumFreeBytes: 0 },
        video: { root: f.dirs.targetVideo, capacity: { ...f.limits }, minimumFreeBytes: 0n }, keys };
    } }), error => /^BACKUP_/.test(error.code));
    assert.equal(await f.databaseHash(f.targetDatabase), beforeSql);
    assert.deepEqual(await fileInventory(f.dirs.targetMedia), beforePhotos); assert.deepEqual(await fileInventory(f.dirs.targetVideo), beforeVideos);
    const name = f.receipt.video.files[0].name, file = path.join(f.dirs.checkpoint, "video", name), original = await readFile(file), changed = Buffer.from(original); changed[48] ^= 1;
    try {
      await writeFile(file, changed);
      await assert.rejects(withPrivateDirectory(path.join(f.dirs.checkpoint, "video"), scope => verifyCheckpointVideo(scope, f.receipt.video)), error => /^VIDEO_CHECKPOINT_FILES_/.test(error.code));
      await assert.rejects(f.copy(), error => /^VIDEO_CHECKPOINT_FILES_/.test(error.code));
    } finally { changed.fill(0); await writeFile(file, original); original.fill(0); }
    assert.equal(await f.databaseHash(f.targetDatabase), beforeSql);
    assert.deepEqual(await fileInventory(f.dirs.targetVideo), beforeVideos); await f.assertSourceUnchanged();
  });
  await t.test("guarded recovery releases pending videos once, rebinds both roots and retains shared administrator and peer content", async () => {
    const restored = await f.backup("restore"); assert.equal(restored.restored, true); assert.equal(restored.verified, true);
    assert.equal(restored.releasedCandidates, 0); assert.equal(restored.releasedVideoCandidates, 3);
    const current = await f.snapshot(), photoRoot = (await f.target.storage.fingerprint()).toString("hex"), videoRoot = (await f.target.videoStorage.fingerprint()).toString("hex");
    assert.notEqual(photoRoot, f.binding.rootFingerprint); assert.notEqual(videoRoot, f.binding.videoRootFingerprint);
    assert.equal(current.capacity.rootFingerprint, photoRoot); assert.equal(current.video.capacity.rootFingerprint, videoRoot);
    assertBackupSnapshot({ expected: f.payload.snapshot, actual: current, mode: "recovery", targetFingerprint: photoRoot, targetVideoFingerprint: videoRoot });
    for (const candidate of f.pending) assert.equal(current.video.assets.find(row => row.id === candidate.id.toString("hex")).state, "released");
    const active = [f.sharedVideo, ...f.clientVideos]; assert.equal((await readdir(f.dirs.targetVideo)).length, active.length);
    assert.equal(current.video.capacity.heldBytes, active.reduce((total, asset) => total + asset.storedBytes, 0));
    for (const asset of active) {
      const reader = await f.target.videoStorage.open({ assetId: asset.id, storageKey: asset.storageKey }), digest = createHash("sha256"); let bytes = 0;
      try { for await (const block of reader.stream()) { bytes += block.length; digest.update(block); block.fill(0); } }
      finally { await reader.close(); }
      assert.equal(bytes, asset.bytes); assert.equal(digest.digest("hex"), asset.digest.toString("hex"));
    }
    assert.equal(Number((await f.targetConnection.query("SELECT COUNT(*) AS count FROM message_video WHERE video_id = ?", [f.sharedVideo.id]))[0].count), 2);
    const photos = await fileInventory(f.dirs.targetMedia), videos = await fileInventory(f.dirs.targetVideo), database = await f.databaseHash(f.targetDatabase);
    const repeated = await f.backup("restore"); assert.equal(repeated.releasedVideoCandidates, 0);
    assert.equal(await f.databaseHash(f.targetDatabase), database); assert.deepEqual(await fileInventory(f.dirs.targetMedia), photos); assert.deepEqual(await fileInventory(f.dirs.targetVideo), videos);
    await f.assertSourceUnchanged();
  });
  await t.test("manual restoration respects a real later video closure and keeps mixed historical receipts", sub => f.measure("manual-reconcile-publish", () => qualifyVideoManualRestore(sub, f)));
  const metrics = f.reportMetrics();
  assert.equal(metrics.encryptedPhotoBytes, f.receipt.media.bytes); assert.equal(metrics.encryptedVideoBytes, f.receipt.video.bytes);
  for (const phase of ["capture", "operator-resume", "copy-two-roots", "backup-restore", "manual-reconcile-publish"]) assert.ok(metrics.measurements.some(value => value.phase === phase));
});
