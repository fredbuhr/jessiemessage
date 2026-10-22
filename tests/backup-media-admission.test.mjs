import test from "node:test";
import assert from "node:assert/strict";
import { BackupMediaAdmissionError, fitsBackupMediaAdmission, lockBackupMediaAdmission } from "../server/media/backup-admission.mjs";
import { BACKUP_MEDIA_MAX_BYTES, BACKUP_MEDIA_MAX_RECORDS } from "../server/media/backup-limits.mjs";
import { videoStoredBytes } from "../server/video/storage.mjs";

function fixture({ photoBytes = 0, videoBytes = 0, photos = 0, assets = photos, videos = 0, photoState = true, videoState = true } = {}) {
  const queries = [];
  return { queries, connection: { async query(sql) {
    queries.push(sql);
    if (sql === "SELECT held_bytes FROM video_storage_state WHERE id = 1 FOR UPDATE") return videoState ? [{ held_bytes: videoBytes }] : [];
    if (sql === "SELECT held_bytes FROM media_storage_state WHERE id = 1 FOR UPDATE") return photoState ? [{ held_bytes: photoBytes }] : [];
    if (sql === "SELECT COUNT(*) AS value FROM media_storage_objects") return [{ value: photos }];
    if (sql === "SELECT COUNT(*) AS value FROM media_assets") return [{ value: assets }];
    if (sql === "SELECT COUNT(*) AS value FROM video_assets") return [{ value: videos }];
    assert.fail(`Unexpected admission query: ${sql}`);
  } } };
}

test("SQL33 photo admission keeps its byte envelope and never queries video tables", async () => {
  const f = fixture({ photoBytes: 512, photos: 2, assets: 1 });
  const result = await lockBackupMediaAdmission(f.connection);
  assert.deepEqual(result, { heldBytes: 512, records: 4 });
  assert.ok(f.queries[0].endsWith("FROM media_storage_state WHERE id = 1 FOR UPDATE"));
  assert.ok(f.queries.every(sql => !sql.includes("video_")));
  assert.equal(fitsBackupMediaAdmission(result, BACKUP_MEDIA_MAX_BYTES - 512, 2), true);
  assert.equal(fitsBackupMediaAdmission(result, BACKUP_MEDIA_MAX_BYTES - 511, 2), false);
});

test("video and photo allocations share the archive envelope with video-before-photo lock order", async () => {
  const f = fixture({ photoBytes: BACKUP_MEDIA_MAX_BYTES - 200, videoBytes: 100, photos: 2, videos: 1 });
  const result = await lockBackupMediaAdmission(f.connection, { video: true });
  assert.deepEqual(result, { heldBytes: BACKUP_MEDIA_MAX_BYTES - 100, records: 5 });
  assert.match(f.queries[0], /video_storage_state.*FOR UPDATE$/);
  assert.match(f.queries[1], /media_storage_state.*FOR UPDATE$/);
  assert.equal(fitsBackupMediaAdmission(result, 100, 1), true);
  assert.equal(fitsBackupMediaAdmission(result, 101, 1), false);
  assert.equal(fitsBackupMediaAdmission(result, 101, 2), false);
});

test("eleven 100MiB videos cannot reproduce the previous accepted-but-unbackable state", async () => {
  const mib = 1024 * 1024, stored = videoStoredBytes(100 * mib);
  // The two owners remain individually below the persisted 1GiB owner quota,
  // and the persisted global 10GiB quota is intentionally unchanged.
  let held = 0, accepted = 0;
  for (let index = 0; index < 11; index++) {
    const f = fixture({ videoBytes: held, videos: accepted });
    const snapshot = await lockBackupMediaAdmission(f.connection, { video: true });
    if (fitsBackupMediaAdmission(snapshot, stored, 1)) { held += stored; accepted++; }
  }
  assert.equal(accepted, 10);
  assert.ok(held <= BACKUP_MEDIA_MAX_BYTES);
  assert.ok(held + stored > BACKUP_MEDIA_MAX_BYTES);
});

test("record reservations include future photo metadata and retained allocation history", async () => {
  const f = fixture({ photos: 49999, assets: 0, videos: 1 });
  const snapshot = await lockBackupMediaAdmission(f.connection, { video: true });
  assert.equal(snapshot.records, BACKUP_MEDIA_MAX_RECORDS - 1);
  assert.equal(fitsBackupMediaAdmission(snapshot, 1, 1), true);
  assert.equal(fitsBackupMediaAdmission(snapshot, 1, 2), false);
  assert.equal(fitsBackupMediaAdmission({ heldBytes: 0, records: BACKUP_MEDIA_MAX_RECORDS }, 1, 1), false);
});

test("an existing over-budget catalogue remains observable without resetting capacity or history", async () => {
  const f = fixture({ photoBytes: BACKUP_MEDIA_MAX_BYTES, videoBytes: 1, photos: 50000, videos: 1 });
  const snapshot = await lockBackupMediaAdmission(f.connection, { video: true });
  assert.equal(snapshot.heldBytes, BACKUP_MEDIA_MAX_BYTES + 1);
  assert.equal(snapshot.records, BACKUP_MEDIA_MAX_RECORDS + 1);
  assert.equal(fitsBackupMediaAdmission(snapshot, 1, 1), false);
  assert.ok(f.queries.every(sql => sql.startsWith("SELECT ")));
});

test("missing or malformed capacity authority fails closed without accepting a reservation", async () => {
  await assert.rejects(lockBackupMediaAdmission(fixture({ videoState: false }).connection, { video: true }), error => error.reason === "unavailable");
  assert.deepEqual(await lockBackupMediaAdmission(fixture({ photoState: false }).connection, { video: true }), { heldBytes: 0, records: 0 });
  for (const changes of [{ photoBytes: -1 }, { videoBytes: "invalid" }, { photos: "" }, { photos: Number.MAX_SAFE_INTEGER },
    { photoState: false, photos: 1 }, { photos: 0, assets: 1 }]) {
    await assert.rejects(lockBackupMediaAdmission(fixture(changes).connection, { video: true }), BackupMediaAdmissionError);
  }
  for (const [bytes, records] of [[0, 1], [1, 0], [NaN, 1], [1, 0.5]]) {
    assert.throws(() => fitsBackupMediaAdmission({ heldBytes: 0, records: 0 }, bytes, records), BackupMediaAdmissionError);
  }
});
