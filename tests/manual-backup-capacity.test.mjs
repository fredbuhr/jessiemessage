import test from "node:test";
import assert from "node:assert/strict";
import { readManualBackupCapacity, assertManualBackupCapacity, checkConfiguredBackupCapacity, BackupCapacityError } from "../server/backup/media-capacity.mjs";
import { BACKUP_MEDIA_MAX_BYTES, BACKUP_MEDIA_MAX_RECORDS } from "../server/media/backup-limits.mjs";

function fixture(change = {}) {
  const row = { photo_bytes: 100, photo_files: 1, photo_records: 2, video_bytes: 200, video_files: 1, video_records: 1, ...change };
  const calls = [];
  const pool = { async getConnection() { calls.push("connect"); return {
    async query(sql) { assert.match(sql, /^SELECT/); assert.doesNotMatch(sql, /FOR UPDATE|INSERT|UPDATE |DELETE|owner_id|storage_key/); calls.push(sql); return [row]; },
    async release() { calls.push("release"); },
  }; }, async end() { calls.push("end"); } };
  return { pool, calls };
}

test("backup format capacity is checked only by aggregate reads and includes lifetime metadata", async () => {
  const f = fixture(); assert.deepEqual(await readManualBackupCapacity(f.pool), { withinFormat: true });
  assert.equal(f.calls.length, 3); assert.equal(f.calls.at(-1), "release"); assert.doesNotMatch(f.calls[1], /video_assets/);
  assert.deepEqual(await readManualBackupCapacity(f.pool, { video: true }), { withinFormat: true });
  assert.match(f.calls[4], /video_assets/);
  for (const [row, expected] of [
    [{ photo_bytes: BACKUP_MEDIA_MAX_BYTES, video_bytes: 0 }, true],
    [{ photo_bytes: BACKUP_MEDIA_MAX_BYTES, video_bytes: 1 }, false],
    [{ photo_records: BACKUP_MEDIA_MAX_RECORDS, video_records: 0 }, true],
    [{ photo_records: BACKUP_MEDIA_MAX_RECORDS, video_records: 1 }, false],
    [{ photo_files: 50001 }, false], [{ video_files: 100001 }, false],
  ]) assert.equal((await readManualBackupCapacity(fixture(row).pool, { video: true })).withinFormat, expected);
});

test("only the explicit backup guard rejects oversize media; it returns no IDs, content or private configuration", async () => {
  const f = fixture({ photo_bytes: BACKUP_MEDIA_MAX_BYTES + 1 });
  assert.deepEqual(await readManualBackupCapacity(f.pool, { video: true }), { withinFormat: false });
  await assert.rejects(assertManualBackupCapacity(f.pool, { video: true }), error => error instanceof BackupCapacityError && error.code === "BACKUP_CAPACITY_LIMIT");
  for (const bad of [-1, "not a count", Number.MAX_SAFE_INTEGER + 1]) {
    const corrupt = fixture({ photo_bytes: bad });
    await assert.rejects(readManualBackupCapacity(corrupt.pool), error => error.code === "BACKUP_CAPACITY_UNAVAILABLE");
    assert.equal(corrupt.calls.at(-1), "release");
  }
});

test("parent backup preflight reads the selected configuration, closes SQL and clears its owned environment", async () => {
  for (const exceeds of [false, true]) {
    const f = fixture({ photo_bytes: exceeds ? BACKUP_MEDIA_MAX_BYTES + 1 : 100 }), env = { JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic private password" };
    const settings = { environment: { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd", PORT: "3000" }, execArgv: [],
      loadEnvironment: async (directory, options) => { assert.equal(directory, "/private/config"); assert.equal(options.originProfile, "primary"); return env; },
      createPool: async selected => { assert.equal(selected, env); return f.pool; } };
    const operation = checkConfiguredBackupCapacity({ privateDirectory: "/private/config", video: true }, settings);
    if (exceeds) await assert.rejects(operation, error => error.code === "BACKUP_CAPACITY_LIMIT"); else await operation;
    assert.equal(f.calls.at(-1), "end"); assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "");
  }
});
