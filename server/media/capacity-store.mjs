import { ChatStoreError } from "../chat/store.mjs";
import { loadMigrations, migrationStatus } from "../db/migrations.mjs";

export class MediaCapacityStoreError extends ChatStoreError {
  constructor(code) { super(code, "Private media capacity persistence could not be completed."); this.name = "MediaCapacityStoreError"; }
}
const fail = (code) => { throw new MediaCapacityStoreError(code); };
const count = (value) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) fail("MEDIA_DATABASE_STATE");
  return result;
};
const sqlDate = (now) => {
  if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999) fail("MEDIA_INPUT");
  return new Date(now).toISOString().replace("T", " ").replace("Z", "000");
};
export function validateMediaCapacity(capacity) {
  if (!capacity || !Number.isSafeInteger(capacity.ownerBytes) || capacity.ownerBytes < 1
    || !Number.isSafeInteger(capacity.totalBytes) || capacity.totalBytes < capacity.ownerBytes
    || !Buffer.isBuffer(capacity.rootFingerprint) || capacity.rootFingerprint.length !== 32) fail("MEDIA_INPUT");
  return Object.freeze({ ownerBytes: capacity.ownerBytes, totalBytes: capacity.totalBytes, rootFingerprint: Buffer.from(capacity.rootFingerprint) });
}
export async function lockMediaCapacity(connection, capacity) {
  if (!capacity) fail("MEDIA_CAPACITY_UNAVAILABLE");
  const row = (await connection.query("SELECT owner_bytes, total_bytes, root_fingerprint, held_bytes FROM media_storage_state WHERE id = 1 FOR UPDATE"))[0];
  if (!row || count(row.owner_bytes) !== capacity.ownerBytes || count(row.total_bytes) !== capacity.totalBytes
    || !Buffer.isBuffer(row.root_fingerprint) || !row.root_fingerprint.equals(capacity.rootFingerprint)) fail("MEDIA_CAPACITY_UNAVAILABLE");
  return { heldBytes: count(row.held_bytes) };
}
// FOR UPDATE is a current read even when chat authorization already opened an
// older repeatable-read snapshot. All writers first hold the singleton lock.
export async function pendingMediaBytes(connection) {
  return count((await connection.query("SELECT COALESCE(SUM(stored_bytes), 0) AS value FROM media_storage_objects WHERE state IN ('reserved', 'cleanup_pending') FOR UPDATE"))[0].value);
}
export async function ownerMediaBytes(connection, ownerId) {
  return count((await connection.query("SELECT COALESCE(SUM(stored_bytes), 0) AS value FROM media_storage_objects WHERE owner_id = ? AND state <> 'released' FOR UPDATE", [ownerId]))[0].value);
}

export function createMediaCapacityStore({ pool, capacity }) {
  if (!pool || typeof pool.getConnection !== "function") fail("MEDIA_INPUT");
  capacity = validateMediaCapacity(capacity);
  async function run(operation, transaction = true) {
    let connection, begun = false;
    try {
      connection = await pool.getConnection();
      if (transaction) { await connection.beginTransaction(); begun = true; }
      const result = await operation(connection);
      if (begun) await connection.commit();
      return result;
    } catch (error) {
      if (begun) { try { await connection.rollback(); } catch {} }
      if (error instanceof ChatStoreError) throw error;
      fail("MEDIA_DATABASE_OPERATION");
    } finally { if (connection) { try { connection.release(); } catch {} } }
  }
  async function snapshot(connection) {
    const { heldBytes } = await lockMediaCapacity(connection, capacity);
    const pendingBytes = await pendingMediaBytes(connection);
    const actual = count((await connection.query("SELECT COALESCE(SUM(stored_bytes), 0) AS value FROM media_storage_objects WHERE state <> 'released' FOR UPDATE"))[0].value);
    if (actual !== heldBytes || pendingBytes > heldBytes) fail("MEDIA_DATABASE_STATE");
    return { ready: true, heldBytes, pendingBytes, ownerBytes: capacity.ownerBytes, totalBytes: capacity.totalBytes, rootFingerprint: Buffer.from(capacity.rootFingerprint) };
  }
  return Object.freeze({
    async assertSchema() {
      return run(async (connection) => {
        const database = (await connection.query("SELECT DATABASE() AS name"))[0].name;
        const migrations = await loadMigrations(), history = await migrationStatus(connection, { database, migrations });
        if (history.length < 27 || history.some((item) => item.state !== "applied")) fail("MEDIA_DATABASE_STATE");
        const enforcement = (await connection.query("SELECT @@SESSION.foreign_key_checks AS foreignKeys, @@SESSION.check_constraint_checks AS checkConstraints"))[0];
        if (Number(enforcement.foreignKeys) !== 1 || Number(enforcement.checkConstraints) !== 1) fail("MEDIA_DATABASE_STATE");
        await connection.query("SELECT id, owner_bytes, total_bytes, root_fingerprint, held_bytes, initialized_at FROM media_storage_state WHERE 1 = 0");
        await connection.query("SELECT id, owner_id, owner_role, storage_key, content_digest, full_bytes, thumbnail_bytes, stored_bytes, state, asset_id, created_at, updated_at, released_at FROM media_storage_objects WHERE 1 = 0");
        return true;
      }, false);
    },
    async status() {
      return run(async (connection) => {
        let rows;
        try { rows = await connection.query("SELECT id FROM media_storage_state WHERE id = 1 FOR UPDATE"); }
        catch (error) { if (Number(error?.errno) !== 1146 && error?.code !== "ER_NO_SUCH_TABLE") throw error; rows = []; }
        if (!rows.length) return { ready: false, heldBytes: 0, pendingBytes: 0, ownerBytes: capacity.ownerBytes, totalBytes: capacity.totalBytes, rootFingerprint: Buffer.from(capacity.rootFingerprint) };
        return snapshot(connection);
      });
    },
    async initialize({ now, offline } = {}) {
      sqlDate(now); if (offline !== true) fail("MEDIA_INPUT");
      return run(async (connection) => {
        const existing = (await connection.query("SELECT id FROM media_storage_state WHERE id = 1 FOR UPDATE"))[0];
        if (existing) return snapshot(connection);
        if (Number((await connection.query("SELECT COUNT(*) AS value FROM media_storage_objects"))[0].value) !== 0) fail("MEDIA_DATABASE_STATE");
        // Initialization is explicitly offline. Import every historical asset,
        // including tombstones, because SQL deletion never proved file erasure.
        let heldBytes = 0, imported = 0, afterId = null;
        while (true) {
          const assets = await connection.query(`SELECT id, owner_id, owner_role, storage_key, content_digest,
            full_bytes, thumbnail_bytes, created_at, deleted_at FROM media_assets ${afterId === null ? "" : "WHERE id > ?"}
            ORDER BY id LIMIT 100 FOR UPDATE`, afterId === null ? [] : [afterId]);
          if (imported + assets.length > 100000) fail("MEDIA_CAPACITY_UNAVAILABLE");
          for (const asset of assets) {
            const storedBytes = count(asset.full_bytes) + count(asset.thumbnail_bytes) + 80;
            heldBytes += storedBytes; if (!Number.isSafeInteger(heldBytes)) fail("MEDIA_DATABASE_STATE");
            await connection.query(`INSERT INTO media_storage_objects
              (id, owner_id, owner_role, storage_key, content_digest, full_bytes, thumbnail_bytes, stored_bytes, state, asset_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [asset.id, asset.owner_id, asset.owner_role, asset.storage_key, asset.content_digest,
              asset.full_bytes, asset.thumbnail_bytes, storedBytes, asset.deleted_at === null ? "registered" : "cleanup_pending", asset.id, asset.created_at, sqlDate(now)]);
          }
          imported += assets.length;
          if (assets.length < 100) break;
          afterId = assets.at(-1).id;
        }
        // Legacy usage can already exceed the configured ceilings. Import it
        // faithfully; subsequent reservations remain blocked until it fits.
        await connection.query("INSERT INTO media_storage_state (id, owner_bytes, total_bytes, root_fingerprint, held_bytes, initialized_at) VALUES (1, ?, ?, ?, ?, ?)",
          [capacity.ownerBytes, capacity.totalBytes, capacity.rootFingerprint, heldBytes, sqlDate(now)]);
        return snapshot(connection);
      });
    },
    async listObjects({ afterId = null, limit = 100 } = {}) {
      if (afterId !== null && (!Buffer.isBuffer(afterId) || afterId.length !== 16)
        || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("MEDIA_INPUT");
      return run(async (connection) => {
        const initialized = (await connection.query("SELECT id FROM media_storage_state WHERE id = 1 FOR UPDATE"))[0];
        // The offline inventory must also be able to inspect an uninitialized
        // journal. Nonempty rows remain visible and make initialization refuse.
        if (initialized) await lockMediaCapacity(connection, capacity);
        const rows = await connection.query(`SELECT id, owner_id, storage_key, state, asset_id, full_bytes, thumbnail_bytes, stored_bytes
          FROM media_storage_objects ${afterId === null ? "" : "WHERE id > ?"} ORDER BY id LIMIT ?`, [...(afterId === null ? [] : [afterId]), limit + 1]);
        const selected = rows.slice(0, limit), hasMore = rows.length > limit;
        return { objects: selected.map((row) => ({ id: row.id, storageKey: row.storage_key, ownerId: row.owner_id, state: row.state,
          assetId: row.asset_id, fullBytes: count(row.full_bytes), thumbnailBytes: count(row.thumbnail_bytes), storedBytes: count(row.stored_bytes) })),
        nextCursor: hasMore ? selected.at(-1).id : null, hasMore };
      });
    },
  });
}
