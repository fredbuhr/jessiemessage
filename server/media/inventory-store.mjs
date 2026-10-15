export class MediaInventoryStoreError extends Error {
  constructor() { super("Private media inventory is unavailable."); this.name = "MediaInventoryStoreError"; this.code = "MEDIA_INVENTORY_DATABASE"; }
}
const fail = () => { throw new MediaInventoryStoreError(); };
const buffer = (value, length) => { if (!Buffer.isBuffer(value) || value.length !== length) fail(); return Buffer.from(value); };
const number = (value, max) => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1 || result > max) fail(); return result; };
const asset = (row) => {
  if (!(row.deleted_at === null || typeof row.deleted_at === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(row.deleted_at))) fail();
  return { id: buffer(row.id, 16), ownerId: buffer(row.owner_id, 16), storageKey: buffer(row.storage_key, 32),
    fullBytes: number(row.full_bytes, 10485760), thumbnailBytes: number(row.thumbnail_bytes, 524288), deleted: row.deleted_at !== null };
};
const object = (row) => {
  if (!["reserved", "registered", "cleanup_pending", "released"].includes(row.state)) fail();
  const result = { id: buffer(row.id, 16), ownerId: buffer(row.owner_id, 16), storageKey: buffer(row.storage_key, 32), state: row.state,
    assetId: row.asset_id === null ? null : buffer(row.asset_id, 16), fullBytes: number(row.full_bytes, 10485760),
    thumbnailBytes: number(row.thumbnail_bytes, 524288), storedBytes: BigInt(row.stored_bytes) };
  if (result.storedBytes !== BigInt(result.fullBytes + result.thumbnailBytes + 80)) fail();
  return result;
};

/** SELECT-only adapter. A storage-key lookup never depends on message links. */
export function createMediaInventoryStore({ pool }) {
  if (typeof pool?.getConnection !== "function") throw new TypeError("A private runtime pool is required");
  async function read(operation) {
    let connection;
    try { connection = await pool.getConnection(); return await operation(connection); }
    catch { fail(); }
    finally { try { connection?.release(); } catch {} }
  }
  return Object.freeze({
    listAssets({ afterId = null, limit = 100 } = {}) {
      if (afterId !== null) buffer(afterId, 16);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail();
      return read(async (connection) => {
        const rows = await connection.query(`SELECT id, owner_id, storage_key, full_bytes, thumbnail_bytes, deleted_at
          FROM media_assets ${afterId === null ? "" : "WHERE id > ?"} ORDER BY id ASC LIMIT ?`, afterId === null ? [limit + 1] : [afterId, limit + 1]);
        if (!Array.isArray(rows) || rows.length > limit + 1) fail();
        const assets = rows.slice(0, limit).map(asset), hasMore = rows.length > limit;
        return { assets, hasMore, nextCursor: hasMore ? Buffer.from(assets.at(-1).id) : null };
      });
    },
    listObjects({ afterId = null, limit = 100 } = {}) {
      if (afterId !== null) buffer(afterId, 16);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail();
      return read(async (connection) => {
        const rows = await connection.query(`SELECT id, owner_id, storage_key, state, asset_id, full_bytes, thumbnail_bytes, stored_bytes
          FROM media_storage_objects ${afterId === null ? "" : "WHERE id > ?"} ORDER BY id ASC LIMIT ?`, afterId === null ? [limit + 1] : [afterId, limit + 1]);
        if (!Array.isArray(rows) || rows.length > limit + 1) fail();
        const objects = rows.slice(0, limit).map(object), hasMore = rows.length > limit;
        return { objects, hasMore, nextCursor: hasMore ? Buffer.from(objects.at(-1).id) : null };
      });
    },
    lookupStorageKey({ storageKey }) {
      buffer(storageKey, 32);
      return read(async (connection) => {
        const assets = await connection.query("SELECT id, owner_id, storage_key, full_bytes, thumbnail_bytes, deleted_at FROM media_assets WHERE storage_key = ? LIMIT 2", [storageKey]);
        const objects = await connection.query("SELECT id, owner_id, storage_key, state, asset_id, full_bytes, thumbnail_bytes, stored_bytes FROM media_storage_objects WHERE storage_key = ? LIMIT 2", [storageKey]);
        if (!Array.isArray(assets) || !Array.isArray(objects) || assets.length > 1 || objects.length > 1) fail();
        return { asset: assets.length ? asset(assets[0]) : null, object: objects.length ? object(objects[0]) : null };
      });
    },
  });
}
