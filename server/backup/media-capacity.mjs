import { BACKUP_MEDIA_MAX_BYTES, BACKUP_MEDIA_MAX_FILES, BACKUP_MEDIA_MAX_RECORDS } from "../media/backup-limits.mjs";
import { clearRuntimeMessagingSecrets } from "../config/runtime-messaging.mjs";
import { privateAuthenticationProcessOptions } from "../config/private-auth-environment.mjs";

export class BackupCapacityError extends Error {
  constructor(code = "BACKUP_CAPACITY_UNAVAILABLE") {
    super("The current media exceed the capacity of the backup format.");
    this.code = code;
  }
}
const count = value => {
  if (!["number", "bigint", "string"].includes(typeof value) || typeof value === "string" && !/^(?:0|[1-9][0-9]*)$/.test(value)) throw new BackupCapacityError();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || Object.is(result, -0)) throw new BackupCapacityError();
  return result;
};
const active = signal => { if (signal?.aborted) throw new BackupCapacityError(); };

/** Aggregate, read-only preflight. This is a format bound, never upload admission.
 * Capture retains its own exact file/snapshot checks after the runtime drains. */
export async function readManualBackupCapacity(pool, { video = false, signal } = {}) {
  if (typeof pool?.getConnection !== "function" || typeof video !== "boolean") throw new BackupCapacityError();
  let connection;
  try {
    active(signal); connection = await pool.getConnection(); active(signal);
    // One SELECT supplies one SQL snapshot and exposes no owner or media IDs.
    const row = (await connection.query(`SELECT
      (SELECT COALESCE(SUM(stored_bytes), 0) FROM media_storage_objects WHERE state <> 'released') AS photo_bytes,
      (SELECT COUNT(*) FROM media_storage_objects WHERE state <> 'released') AS photo_files,
      (SELECT COUNT(*) FROM media_storage_objects) + (SELECT COUNT(*) FROM media_assets) AS photo_records
      ${video ? `, (SELECT COALESCE(SUM(CASE WHEN state <> 'released' THEN stored_bytes ELSE 0 END), 0) FROM video_assets) AS video_bytes,
      (SELECT COUNT(*) FROM video_assets WHERE state <> 'released') AS video_files,
      (SELECT COUNT(*) FROM video_assets) AS video_records` : ""}`))[0];
    active(signal);
    const photoBytes = count(row?.photo_bytes), photoFiles = count(row?.photo_files) * 2, photoRecords = count(row?.photo_records);
    const videoBytes = video ? count(row?.video_bytes) : 0, videoFiles = video ? count(row?.video_files) : 0, videoRecords = video ? count(row?.video_records) : 0;
    const bytes = photoBytes + videoBytes, records = photoRecords + videoRecords;
    if (![photoFiles, bytes, records].every(Number.isSafeInteger)) throw new BackupCapacityError();
    return { withinFormat: bytes <= BACKUP_MEDIA_MAX_BYTES && records <= BACKUP_MEDIA_MAX_RECORDS
      && photoFiles <= BACKUP_MEDIA_MAX_FILES && videoFiles <= BACKUP_MEDIA_MAX_FILES };
  } catch (error) {
    if (error instanceof BackupCapacityError) throw error;
    throw new BackupCapacityError();
  } finally {
    if (connection) { try { await connection.release(); } catch { throw new BackupCapacityError(); } }
  }
}

export async function assertManualBackupCapacity(pool, options) {
  if ((await readManualBackupCapacity(pool, options)).withinFormat !== true) throw new BackupCapacityError("BACKUP_CAPACITY_LIMIT");
}

/** Parent-side recheck immediately before an explicit capture can stop Node.
 * It loads the existing selected configuration without writing it or any files. */
export async function checkConfiguredBackupCapacity(options, { environment = process.env, signal,
  loadEnvironment, createPool, execArgv = process.execArgv } = {}) {
  let env, pool;
  try {
    active(signal);
    const parameters = { ...privateAuthenticationProcessOptions(environment, execArgv), originProfile: "primary", recovery: true };
    loadEnvironment ??= options.video === true ? (await import("../config/runtime-video.mjs")).loadRuntimeVideoEnvironment
      : (await import("../config/runtime-broadcast.mjs")).loadRuntimeBroadcastEnvironment;
    createPool ??= (await import("../db/runtime.mjs")).createRuntimePool;
    env = await loadEnvironment(options.privateDirectory, parameters); active(signal);
    pool = await createPool(env);
    await assertManualBackupCapacity(pool, { video: options.video === true, signal });
  } catch (error) {
    if (error instanceof BackupCapacityError) throw error;
    throw new BackupCapacityError();
  } finally {
    clearRuntimeMessagingSecrets(env);
    try { await pool?.end(); } catch { throw new BackupCapacityError(); }
  }
}
