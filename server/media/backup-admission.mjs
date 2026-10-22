import { BACKUP_MEDIA_MAX_BYTES, BACKUP_MEDIA_MAX_RECORDS } from "./backup-limits.mjs";

export class BackupMediaAdmissionError extends Error {
  constructor(reason = "state") {
    super("Private media admission could not be established.");
    this.name = "BackupMediaAdmissionError"; this.reason = reason;
  }
}
const invalid = () => { throw new BackupMediaAdmissionError(); };
function count(value) {
  if (!["number", "bigint", "string"].includes(typeof value)
    || typeof value === "string" && !/^(?:0|[1-9][0-9]*)$/.test(value)) invalid();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || Object.is(number, -0)) invalid();
  return number;
}

// Both upload families take these locks in the same order. The video profile
// keeps its existing singleton; the SQL33 profile never queries a video table.
// Count all allocations, including released/uncertain ones: the manifest keeps
// that history, and one photo allocation may later add its media_assets row.
export async function lockBackupMediaAdmission(connection, { video = false } = {}) {
  if (typeof connection?.query !== "function" || typeof video !== "boolean") invalid();
  const videos = video ? await connection.query("SELECT held_bytes FROM video_storage_state WHERE id = 1 FOR UPDATE") : [];
  if (!Array.isArray(videos) || videos.length > 1) invalid();
  if (video && videos.length !== 1) throw new BackupMediaAdmissionError("unavailable");
  const photos = await connection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1 FOR UPDATE");
  if (!Array.isArray(photos) || photos.length > 1) invalid();
  const photoObjects = count((await connection.query("SELECT COUNT(*) AS value FROM media_storage_objects"))[0]?.value);
  const photoAssets = count((await connection.query("SELECT COUNT(*) AS value FROM media_assets"))[0]?.value);
  // A standalone dormant-video qualification may have no photo catalogue yet.
  // Existing photo allocations without their capacity authority are invalid.
  if (!photos.length && photoObjects !== 0 || photoAssets > photoObjects) invalid();
  const videoObjects = video ? count((await connection.query("SELECT COUNT(*) AS value FROM video_assets"))[0]?.value) : 0;
  const heldBytes = (photos.length ? count(photos[0].held_bytes) : 0) + (video ? count(videos[0].held_bytes) : 0);
  const records = photoObjects * 2 + videoObjects;
  if (!Number.isSafeInteger(heldBytes) || !Number.isSafeInteger(records)) invalid();
  return Object.freeze({ heldBytes, records });
}

export function fitsBackupMediaAdmission(snapshot, bytes, records) {
  if (!snapshot || !Number.isSafeInteger(bytes) || bytes < 1 || !Number.isSafeInteger(records) || records < 1) invalid();
  const heldBytes = count(snapshot.heldBytes), heldRecords = count(snapshot.records);
  return heldBytes <= BACKUP_MEDIA_MAX_BYTES - bytes && heldRecords <= BACKUP_MEDIA_MAX_RECORDS - records;
}
