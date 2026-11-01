export class SharedMediaCapacityError extends Error {
  constructor(reason = "state") {
    super("Private media capacity could not be established.");
    this.name = "SharedMediaCapacityError"; this.reason = reason;
  }
}
const invalid = () => { throw new SharedMediaCapacityError(); };
function count(value) {
  if (!["number", "bigint", "string"].includes(typeof value)
    || typeof value === "string" && !/^(?:0|[1-9][0-9]*)$/.test(value)) invalid();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || Object.is(number, -0)) invalid();
  return number;
}

// Every live upload locks the same authorities in video-before-photo order.
// The photo total is the shared application budget; a standalone dormant-video
// catalogue without photo authority uses its own configured total instead.
// Backup file/record bounds belong to manual backup eligibility, never uploads.
export async function lockSharedMediaCapacity(connection, { video = false } = {}) {
  if (typeof connection?.query !== "function" || typeof video !== "boolean") invalid();
  const videos = video ? await connection.query("SELECT held_bytes, total_bytes FROM video_storage_state WHERE id = 1 FOR UPDATE") : [];
  if (!Array.isArray(videos) || videos.length > 1) invalid();
  if (video && videos.length !== 1) throw new SharedMediaCapacityError("unavailable");
  const photos = await connection.query("SELECT held_bytes, total_bytes FROM media_storage_state WHERE id = 1 FOR UPDATE");
  if (!Array.isArray(photos) || photos.length > 1) invalid();
  if (!photos.length) {
    if (!video) throw new SharedMediaCapacityError("unavailable");
    const present = (await connection.query(`SELECT EXISTS (SELECT 1 FROM media_storage_objects LIMIT 1) AS objects,
      EXISTS (SELECT 1 FROM media_assets LIMIT 1) AS assets`))[0];
    if (!present || count(present.objects) !== 0 || count(present.assets) !== 0) invalid();
  }
  for (const row of [...photos, ...videos]) if (!row || count(row.total_bytes) < 1) invalid();
  const heldBytes = (photos.length ? count(photos[0].held_bytes) : 0) + (video ? count(videos[0].held_bytes) : 0);
  const totalBytes = count((photos[0] ?? videos[0]).total_bytes);
  if (!Number.isSafeInteger(heldBytes)) invalid();
  return Object.freeze({ heldBytes, totalBytes });
}
