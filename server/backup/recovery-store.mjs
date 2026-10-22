export class BackupRecoveryStoreError extends Error {
  constructor(code) {
    super("Offline media recovery could not be completed.");
    this.name = "BackupRecoveryStoreError";
    this.code = code;
  }
}
const fail = (code) => { throw new BackupRecoveryStoreError(code); };
const input = () => fail("BACKUP_RECOVERY_INPUT");
const state = () => fail("BACKUP_RECOVERY_STATE");
const MAX_INSTANT = 253402300799999;
const candidateKeys = ["id", "owner_id", "owner_role", "storage_key", "content_digest", "full_bytes", "thumbnail_bytes", "stored_bytes", "asset_id", "created_at", "state"];
function shape(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) input();
}
function hexadecimal(value, size) {
  if (typeof value !== "string" || value.length !== size * 2 || /[^0-9a-f]/.test(value)) input();
  return Buffer.from(value, "hex");
}
function fingerprint(value) {
  if (!Buffer.isBuffer(value) || value.length !== 32) input();
  return Buffer.from(value);
}
function instant(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_INSTANT) input();
  return new Date(value).toISOString().replace("T", " ").replace("Z", "000");
}
function sqlDate(value, invalid = state) {
  if (typeof value !== "string" || value.length !== 26 || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value)) invalid();
  const milliseconds = value.slice(0, 23).replace(" ", "T") + "Z", time = Date.parse(milliseconds);
  if (!Number.isSafeInteger(time) || time < 0 || time > MAX_INSTANT || new Date(time).toISOString() !== milliseconds) invalid();
  return value;
}
function storedInteger(value) {
  if (!["number", "bigint", "string"].includes(typeof value)
    || typeof value === "string" && (!value.length || value.length > 16 || /[^0-9]/.test(value) || value.length > 1 && value[0] === "0")) state();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) state();
  return result;
}
function bounded(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) input();
  return value;
}
function candidateValue(value) {
  shape(value, candidateKeys);
  const result = { id: hexadecimal(value.id, 16), ownerId: hexadecimal(value.owner_id, 16), ownerRole: value.owner_role,
    storageKey: hexadecimal(value.storage_key, 32), digest: hexadecimal(value.content_digest, 32),
    fullBytes: bounded(value.full_bytes, 10485760), thumbnailBytes: bounded(value.thumbnail_bytes, 524288),
    storedBytes: bounded(value.stored_bytes, 11010128), assetId: value.asset_id === null ? null : hexadecimal(value.asset_id, 16),
    createdAt: sqlDate(value.created_at, input), state: value.state };
  if (!["admin", "client"].includes(result.ownerRole) || !["reserved", "cleanup_pending"].includes(result.state)
    || result.storedBytes !== result.fullBytes + result.thumbnailBytes + 80 || result.assetId !== null && !result.assetId.equals(result.id)
    || result.state === "reserved" && result.assetId !== null) input();
  return result;
}
function requestValue(value) {
  const targetDatabaseName = value?.targetDatabaseName;
  if (typeof targetDatabaseName !== "string" || !targetDatabaseName.length || targetDatabaseName.length > 64 || /[^a-zA-Z0-9_]/.test(targetDatabaseName)) input();
  return { sourceFingerprint: fingerprint(value.sourceFingerprint), targetDatabaseName, now: instant(value.now) };
}
const sameBytes = (actual, expected) => Buffer.isBuffer(actual) && actual.length === expected.length && actual.equals(expected);
const objectProjection = `id, owner_id, owner_role, storage_key, content_digest, full_bytes, thumbnail_bytes, stored_bytes,
  asset_id, state, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS created_at,
  DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s.%f') AS updated_at,
  DATE_FORMAT(released_at, '%Y-%m-%d %H:%i:%s.%f') AS released_at`;

/** Trusted offline recovery only. The caller verifies the signed snapshot and
 * private files; this adapter never infers erasure from SQL or elapsed time. */
export function createBackupRecoveryStore({ pool } = {}) {
  if (typeof pool?.getConnection !== "function") input();
  async function transaction(request, operation) {
    let connection, begun = false;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction(); begun = true;
      const database = (await connection.query("SELECT DATABASE() AS name"))[0];
      if (database?.name !== request.targetDatabaseName) state();
      const global = (await connection.query(`SELECT owner_bytes, total_bytes, root_fingerprint, held_bytes,
        DATE_FORMAT(initialized_at, '%Y-%m-%d %H:%i:%s.%f') AS initialized_at
        FROM media_storage_state WHERE id = 1 FOR UPDATE`))[0];
      if (!global || !Buffer.isBuffer(global.root_fingerprint) || global.root_fingerprint.length !== 32
        || sqlDate(global.initialized_at) > request.now) state();
      const heldBytes = storedInteger(global.held_bytes), ownerBytes = storedInteger(global.owner_bytes), totalBytes = storedInteger(global.total_bytes);
      if (ownerBytes < 1 || totalBytes < ownerBytes) state();
      const sum = storedInteger((await connection.query("SELECT COALESCE(SUM(stored_bytes), 0) AS value FROM media_storage_objects WHERE state <> 'released' FOR UPDATE"))[0]?.value);
      if (sum !== heldBytes) state();
      const result = await operation(connection, { global, heldBytes, ownerBytes, totalBytes });
      await connection.commit();
      return result;
    } catch (error) {
      if (begun) { try { await connection.rollback(); } catch {} }
      if (error instanceof BackupRecoveryStoreError) throw error;
      fail("BACKUP_RECOVERY_DATABASE");
    } finally { if (connection) { try { connection.release(); } catch {} } }
  }
  function sourceBinding(context, request) {
    if (!context.global.root_fingerprint.equals(request.sourceFingerprint)) state();
  }
  async function currentCandidate(connection, candidate, request) {
    const row = (await connection.query(`SELECT ${objectProjection} FROM media_storage_objects WHERE id = ? FOR UPDATE`, [candidate.id]))[0];
    if (!row || !sameBytes(row.id, candidate.id) || !sameBytes(row.owner_id, candidate.ownerId) || row.owner_role !== candidate.ownerRole
      || !sameBytes(row.storage_key, candidate.storageKey) || !sameBytes(row.content_digest, candidate.digest)
      || storedInteger(row.full_bytes) !== candidate.fullBytes || storedInteger(row.thumbnail_bytes) !== candidate.thumbnailBytes
      || storedInteger(row.stored_bytes) !== candidate.storedBytes || sqlDate(row.created_at) !== candidate.createdAt
      || (candidate.assetId === null ? row.asset_id !== null : !sameBytes(row.asset_id, candidate.assetId))
      || !["reserved", "cleanup_pending", "released"].includes(row.state)
      || candidate.state === "cleanup_pending" && row.state === "reserved") state();
    const updatedAt = sqlDate(row.updated_at);
    if (updatedAt < candidate.createdAt || updatedAt > request.now || candidate.createdAt > request.now
      || (row.state === "released" ? row.released_at === null || sqlDate(row.released_at) < candidate.createdAt || row.released_at > updatedAt : row.released_at !== null)) state();
    const assets = await connection.query(`SELECT id, owner_id, owner_role, storage_key, content_digest, full_bytes, thumbnail_bytes,
      active_digest, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS created_at,
      DATE_FORMAT(deleted_at, '%Y-%m-%d %H:%i:%s.%f') AS deleted_at FROM media_assets
      WHERE id = ? OR storage_key = ? ORDER BY id LIMIT 2 FOR UPDATE`, [candidate.assetId ?? candidate.id, candidate.storageKey]);
    if (candidate.assetId === null) { if (assets.length !== 0) state(); }
    else {
      const asset = assets[0];
      if (assets.length !== 1 || !sameBytes(asset.id, candidate.assetId) || !sameBytes(asset.owner_id, candidate.ownerId)
        || asset.owner_role !== candidate.ownerRole || !sameBytes(asset.storage_key, candidate.storageKey) || !sameBytes(asset.content_digest, candidate.digest)
        || storedInteger(asset.full_bytes) !== candidate.fullBytes || storedInteger(asset.thumbnail_bytes) !== candidate.thumbnailBytes
        || sqlDate(asset.created_at) < candidate.createdAt || asset.deleted_at === null || asset.active_digest !== null
        || sqlDate(asset.deleted_at) < asset.created_at || asset.deleted_at > request.now) state();
    }
    return row;
  }
  async function candidateOperation(options, release) {
    shape(options, ["candidate", "sourceFingerprint", "targetDatabaseName", "now"]);
    const request = requestValue(options), candidate = candidateValue(options.candidate);
    return transaction(request, async (connection, context) => {
      sourceBinding(context, request);
      const current = await currentCandidate(connection, candidate, request);
      if (release) {
        if (current.state === "released") return { released: true };
        if (current.state !== "cleanup_pending" || context.heldBytes < candidate.storedBytes) state();
        const changed = await connection.query(`UPDATE media_storage_objects SET state = 'released', updated_at = ?, released_at = ?
          WHERE id = ? AND storage_key = ? AND state = 'cleanup_pending'`, [request.now, request.now, candidate.id, candidate.storageKey]);
        if (Number(changed?.affectedRows) !== 1) state();
        const refunded = await connection.query(`UPDATE media_storage_state SET held_bytes = held_bytes - ?
          WHERE id = 1 AND root_fingerprint = ? AND held_bytes = ?`, [candidate.storedBytes, request.sourceFingerprint, context.heldBytes]);
        if (Number(refunded?.affectedRows) !== 1) state();
        return { released: true };
      }
      if (current.state === "reserved") {
        const changed = await connection.query(`UPDATE media_storage_objects SET state = 'cleanup_pending', updated_at = ?
          WHERE id = ? AND storage_key = ? AND state = 'reserved'`, [request.now, candidate.id, candidate.storageKey]);
        if (Number(changed?.affectedRows) !== 1) state();
      }
      return { closed: true, state: current.state === "released" ? "released" : "cleanup_pending" };
    });
  }
  return Object.freeze({
    closeCandidate: (options) => candidateOperation(options, false),
    releaseCandidate: (options) => candidateOperation(options, true),
    async rebind(options) {
      shape(options, ["sourceFingerprint", "targetFingerprint", "targetDatabaseName", "capacity", "expectedHeldBytes", "now"]);
      const request = requestValue(options), targetFingerprint = fingerprint(options.targetFingerprint);
      shape(options.capacity, ["ownerBytes", "totalBytes"]);
      const ownerBytes = bounded(options.capacity.ownerBytes, Number.MAX_SAFE_INTEGER), totalBytes = bounded(options.capacity.totalBytes, Number.MAX_SAFE_INTEGER);
      const expectedHeldBytes = options.expectedHeldBytes;
      if (totalBytes < ownerBytes || !Number.isSafeInteger(expectedHeldBytes) || expectedHeldBytes < 0) input();
      return transaction(request, async (connection, context) => {
        if (!context.global.root_fingerprint.equals(request.sourceFingerprint) && !context.global.root_fingerprint.equals(targetFingerprint)
          || context.ownerBytes !== ownerBytes || context.totalBytes !== totalBytes || context.heldBytes !== expectedHeldBytes) state();
        const pending = await connection.query("SELECT id FROM media_storage_objects WHERE state IN ('reserved', 'cleanup_pending') LIMIT 1 FOR UPDATE");
        if (pending.length) state();
        if (!context.global.root_fingerprint.equals(targetFingerprint)) {
          const changed = await connection.query(`UPDATE media_storage_state SET root_fingerprint = ?
            WHERE id = 1 AND root_fingerprint = ? AND held_bytes = ? AND owner_bytes = ? AND total_bytes = ?`,
          [targetFingerprint, request.sourceFingerprint, expectedHeldBytes, ownerBytes, totalBytes]);
          if (Number(changed?.affectedRows) !== 1) state();
        }
        return { rebound: true };
      });
    },
  });
}

const VIDEO_CANDIDATE_FIELDS = ["id", "owner_id", "owner_role", "storage_key", "reserve_token_hash", "content_digest", "bytes", "stored_bytes", "mime", "state", "created_at"];
function videoCandidateValue(value) {
  shape(value, VIDEO_CANDIDATE_FIELDS);
  const bytes = bounded(value.bytes, 104857600);
  const result = { id: hexadecimal(value.id, 16), ownerId: hexadecimal(value.owner_id, 16), ownerRole: value.owner_role,
    storageKey: hexadecimal(value.storage_key, 32), reserveToken: hexadecimal(value.reserve_token_hash, 32),
    digest: value.content_digest === null ? null : hexadecimal(value.content_digest, 32), bytes,
    storedBytes: bounded(value.stored_bytes, 104864048), mime: value.mime, state: value.state, createdAt: sqlDate(value.created_at, input) };
  if (!["admin", "client"].includes(result.ownerRole) || result.mime !== "video/mp4"
    || !["reserved", "cleanup_pending"].includes(result.state) || result.state === "reserved" && result.digest !== null
    || result.storedBytes !== 48 + bytes + 16 * Math.ceil(bytes / 262144)) input();
  return result;
}
const VIDEO_PROJECTION = `id, owner_id, owner_role, storage_key, reserve_token_hash, content_digest, bytes, stored_bytes, mime, state,
  DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS created_at,
  DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s.%f') AS updated_at,
  DATE_FORMAT(released_at, '%Y-%m-%d %H:%i:%s.%f') AS released_at`;

/** The explicit video profile owns a second, independent capacity binding.
 * Only pending assets authenticated by the original snapshot may progress. */
export function createVideoBackupRecoveryStore({ pool } = {}) {
  if (typeof pool?.getConnection !== "function") input();
  async function transaction(request, operation) {
    let connection, begun = false;
    try {
      connection = await pool.getConnection(); await connection.beginTransaction(); begun = true;
      if ((await connection.query("SELECT DATABASE() AS name"))[0]?.name !== request.targetDatabaseName) state();
      const global = (await connection.query(`SELECT owner_bytes, total_bytes, root_fingerprint, held_bytes,
        DATE_FORMAT(initialized_at, '%Y-%m-%d %H:%i:%s.%f') AS initialized_at FROM video_storage_state WHERE id = 1 FOR UPDATE`))[0];
      if (!global || !Buffer.isBuffer(global.root_fingerprint) || global.root_fingerprint.length !== 32
        || sqlDate(global.initialized_at) > request.now) state();
      const heldBytes = storedInteger(global.held_bytes), ownerBytes = storedInteger(global.owner_bytes), totalBytes = storedInteger(global.total_bytes);
      if (ownerBytes < 1 || totalBytes < ownerBytes || heldBytes > totalBytes) state();
      const sum = storedInteger((await connection.query("SELECT COALESCE(SUM(stored_bytes), 0) AS value FROM video_assets WHERE state <> 'released' FOR UPDATE"))[0]?.value);
      if (sum !== heldBytes) state();
      const result = await operation(connection, { global, heldBytes, ownerBytes, totalBytes });
      await connection.commit(); return result;
    } catch (error) {
      if (begun) { try { await connection.rollback(); } catch {} }
      if (error instanceof BackupRecoveryStoreError) throw error;
      fail("BACKUP_RECOVERY_DATABASE");
    } finally { try { connection?.release(); } catch {} }
  }
  async function candidateOperation(value, release) {
    shape(value, ["candidate", "sourceFingerprint", "targetDatabaseName", "now"]);
    const request = requestValue(value), candidate = videoCandidateValue(value.candidate);
    return transaction(request, async (connection, context) => {
      if (!context.global.root_fingerprint.equals(request.sourceFingerprint)) state();
      const row = (await connection.query(`SELECT ${VIDEO_PROJECTION} FROM video_assets WHERE id = ? FOR UPDATE`, [candidate.id]))[0];
      if (!row || !sameBytes(row.id, candidate.id) || !sameBytes(row.owner_id, candidate.ownerId) || row.owner_role !== candidate.ownerRole
        || !sameBytes(row.storage_key, candidate.storageKey) || !sameBytes(row.reserve_token_hash, candidate.reserveToken)
        || (candidate.digest === null ? row.content_digest !== null : !sameBytes(row.content_digest, candidate.digest))
        || storedInteger(row.bytes) !== candidate.bytes || storedInteger(row.stored_bytes) !== candidate.storedBytes || row.mime !== candidate.mime
        || sqlDate(row.created_at) !== candidate.createdAt || !["reserved", "cleanup_pending", "released"].includes(row.state)
        || candidate.state === "cleanup_pending" && row.state === "reserved") state();
      const updated = sqlDate(row.updated_at), released = row.released_at === null ? null : sqlDate(row.released_at);
      if (updated < candidate.createdAt || updated > request.now || candidate.createdAt > request.now
        || row.state === "released" && (released === null || released < candidate.createdAt || released > updated)
        || row.state !== "released" && released !== null) state();
      const live = await connection.query(`SELECT mv.message_id FROM message_video mv JOIN messages m ON m.id = mv.message_id
        WHERE mv.video_id = ? AND m.deleted_at IS NULL LIMIT 1 FOR UPDATE`, [candidate.id]);
      if (live.length) state();
      if (release) {
        if (row.state === "released") return { released: true };
        if (row.state !== "cleanup_pending" || context.heldBytes < candidate.storedBytes) state();
        const changed = await connection.query(`UPDATE video_assets SET state = 'released', updated_at = ?, released_at = ?
          WHERE id = ? AND storage_key = ? AND state = 'cleanup_pending'`, [request.now, request.now, candidate.id, candidate.storageKey]);
        if (Number(changed?.affectedRows) !== 1) state();
        const refunded = await connection.query(`UPDATE video_storage_state SET held_bytes = held_bytes - ?
          WHERE id = 1 AND root_fingerprint = ? AND held_bytes = ?`, [candidate.storedBytes, request.sourceFingerprint, context.heldBytes]);
        if (Number(refunded?.affectedRows) !== 1) state();
        return { released: true };
      }
      if (row.state === "reserved") {
        const changed = await connection.query(`UPDATE video_assets SET state = 'cleanup_pending', updated_at = ?
          WHERE id = ? AND storage_key = ? AND state = 'reserved'`, [request.now, candidate.id, candidate.storageKey]);
        if (Number(changed?.affectedRows) !== 1) state();
      }
      return { closed: true, state: row.state === "released" ? "released" : "cleanup_pending" };
    });
  }
  return Object.freeze({
    closeCandidate: value => candidateOperation(value, false),
    releaseCandidate: value => candidateOperation(value, true),
    async rebind(value) {
      shape(value, ["sourceFingerprint", "targetFingerprint", "targetDatabaseName", "capacity", "expectedHeldBytes", "now"]);
      const request = requestValue(value), targetFingerprint = fingerprint(value.targetFingerprint);
      shape(value.capacity, ["ownerBytes", "totalBytes"]);
      const ownerBytes = bounded(value.capacity.ownerBytes, Number.MAX_SAFE_INTEGER), totalBytes = bounded(value.capacity.totalBytes, Number.MAX_SAFE_INTEGER);
      if (totalBytes < ownerBytes || !Number.isSafeInteger(value.expectedHeldBytes) || value.expectedHeldBytes < 0) input();
      return transaction(request, async (connection, context) => {
        if (!context.global.root_fingerprint.equals(request.sourceFingerprint) && !context.global.root_fingerprint.equals(targetFingerprint)
          || context.ownerBytes !== ownerBytes || context.totalBytes !== totalBytes || context.heldBytes !== value.expectedHeldBytes) state();
        if ((await connection.query("SELECT id FROM video_assets WHERE state IN ('reserved', 'cleanup_pending') LIMIT 1 FOR UPDATE")).length) state();
        if (!context.global.root_fingerprint.equals(targetFingerprint)) {
          const changed = await connection.query(`UPDATE video_storage_state SET root_fingerprint = ?
            WHERE id = 1 AND root_fingerprint = ? AND held_bytes = ? AND owner_bytes = ? AND total_bytes = ?`,
          [targetFingerprint, request.sourceFingerprint, value.expectedHeldBytes, ownerBytes, totalBytes]);
          if (Number(changed?.affectedRows) !== 1) state();
        }
        return { rebound: true };
      });
    },
  });
}
