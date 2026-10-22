import { assertErasureSchema } from "../data/erasure-schema.mjs";
import { erasureId, failErasure } from "../data/erasure-state.mjs";
import { loadVideoMigrations } from "./migrations.mjs";
import { MAX_VIDEO_BYTES, videoStoredBytes } from "./storage.mjs";

const sized = (value, length) => Buffer.isBuffer(value) && value.length === length;
const bytes = (value, length = 16) => { if (!sized(value, length)) failErasure("ERASURE_BINDINGS"); return value; };
const count = value => {
  if (!["number", "string", "bigint"].includes(typeof value)
    || typeof value === "string" && !/^(?:0|[1-9][0-9]*)$/.test(value)) failErasure("ERASURE_CAPACITY");
  const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) failErasure("ERASURE_CAPACITY"); return number;
};
const COLUMNS = "id, owner_id, owner_role, storage_key, content_digest, bytes, stored_bytes, mime, state, created_at, updated_at, released_at";
function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) failErasure("ERASURE_STATE");
  const [seconds, fraction = ""] = value.split("."), canonical = seconds + "." + fraction.padEnd(6, "0");
  const iso = canonical.slice(0, 23).replace(" ", "T") + "Z", now = Date.parse(iso);
  if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999 || new Date(now).toISOString() !== iso) failErasure("ERASURE_STATE");
  return canonical;
}

/** A transaction-local extension. No hook opens its own transaction or grants
 * session authority; the existing closure lease and producer drain own it. */
export function createVideoErasureExtension({ videoStore, videoStorage, capacity } = {}) {
  if (typeof videoStore?.assertSchema !== "function" || typeof videoStorage?.fingerprint !== "function"
    || !capacity || !Number.isSafeInteger(capacity.ownerBytes) || capacity.ownerBytes < 1
    || !Number.isSafeInteger(capacity.totalBytes) || capacity.totalBytes < capacity.ownerBytes
    || !sized(capacity.rootFingerprint, 32)) failErasure("ERASURE_INPUT");
  capacity = Object.freeze({ ownerBytes: capacity.ownerBytes, totalBytes: capacity.totalBytes,
    rootFingerprint: Buffer.from(capacity.rootFingerprint) });
  function target(value) { return bytes(value); }
  async function snapshot(connection) {
    const physical = await videoStorage.fingerprint();
    if (!sized(physical, 32) || !physical.equals(capacity.rootFingerprint)) failErasure("ERASURE_BINDING");
    const row = (await connection.query(`SELECT owner_bytes, total_bytes, root_fingerprint, held_bytes
      FROM video_storage_state WHERE id = 1 FOR UPDATE`))[0];
    if (!row || count(row.owner_bytes) !== capacity.ownerBytes || count(row.total_bytes) !== capacity.totalBytes
      || !sized(row.root_fingerprint, 32) || !row.root_fingerprint.equals(capacity.rootFingerprint)) failErasure("ERASURE_BINDING");
    const held = count(row.held_bytes), total = count((await connection.query(`SELECT COALESCE(SUM(stored_bytes), 0) AS value
      FROM video_assets WHERE state <> 'released' FOR UPDATE`))[0]?.value);
    if (held > capacity.totalBytes || held !== total) failErasure("ERASURE_CAPACITY");
    return held;
  }
  function owned(row, clientId, nowSql) {
    if (!row || !bytes(row.owner_id).equals(clientId) || row.owner_role !== "client"
      || !sized(row.storage_key, 32) || !sized(row.id, 16)
      || !["reserved", "committed", "cleanup_pending", "released"].includes(row.state)
      || row.mime !== "video/mp4" || row.content_digest !== null && !sized(row.content_digest, 32)) failErasure("ERASURE_BINDINGS");
    const size = count(row.bytes), stored = count(row.stored_bytes);
    if (size < 1 || size > MAX_VIDEO_BYTES || stored !== videoStoredBytes(size)) failErasure("ERASURE_CAPACITY");
    const created = date(row.created_at), updated = date(row.updated_at), released = row.released_at === null ? null : date(row.released_at);
    if (created > updated || updated > nowSql || row.state === "reserved" && row.content_digest !== null
      || row.state === "committed" && row.content_digest === null
      || row.state === "released" && (released === null || released < created || released > updated)
      || row.state !== "released" && released !== null) failErasure("ERASURE_STATE");
    return row;
  }
  async function inspect(connection, { clientId, conversation, nowSql }) {
    clientId = target(clientId); nowSql = date(nowSql);
    const rows = await connection.query(`SELECT ${COLUMNS} FROM video_assets WHERE owner_id = ? ORDER BY id LIMIT 10001 FOR UPDATE`, [clientId]);
    if (!Array.isArray(rows) || rows.length > 10000) failErasure("ERASURE_LIMIT");
    let ownerHeld = 0;
    for (const row of rows) { owned(row, clientId, nowSql); if (row.state !== "released") ownerHeld += count(row.stored_bytes); }
    if (!Number.isSafeInteger(ownerHeld) || ownerHeld > capacity.ownerBytes) failErasure("ERASURE_CAPACITY");
    const links = await connection.query(`SELECT mv.message_id, mv.conversation_id, mv.video_id,
      m.id AS message_id_actual, m.conversation_id AS message_conversation, m.sender_id, m.sender_role, m.deleted_at,
      c.id AS conversation_id_actual, c.client_id, c.admin_id, a.id AS asset_id, a.owner_id, a.owner_role, a.state AS asset_state,
      mm.media_id AS photo_id FROM message_video mv LEFT JOIN messages m ON m.id = mv.message_id
      LEFT JOIN conversations c ON c.id = mv.conversation_id LEFT JOIN video_assets a ON a.id = mv.video_id
      LEFT JOIN message_media mm ON mm.message_id = mv.message_id
      WHERE a.owner_id = ? OR m.sender_id = ?${conversation === null ? "" : " OR mv.conversation_id = ?"} LIMIT 10001 FOR UPDATE`,
    [clientId, clientId, ...(conversation === null ? [] : [bytes(conversation.id)])]);
    if (!Array.isArray(links) || links.length > 10000) failErasure("ERASURE_LIMIT");
    for (const row of links) {
      if (!bytes(row.message_id).equals(bytes(row.message_id_actual))
        || !bytes(row.conversation_id).equals(bytes(row.message_conversation))
        || !row.conversation_id.equals(bytes(row.conversation_id_actual)) || !bytes(row.video_id).equals(bytes(row.asset_id))
        || !["admin", "client"].includes(row.sender_role) || row.owner_role !== row.sender_role
        || !bytes(row.owner_id).equals(bytes(row.sender_id)) || row.photo_id !== null
        || !row.sender_id.equals(bytes(row.sender_role === "admin" ? row.admin_id : row.client_id))
        || row.deleted_at === null && row.asset_state !== "committed") failErasure("ERASURE_BINDINGS");
      if (row.owner_id.equals(clientId) && (conversation === null || !row.conversation_id.equals(conversation.id))
        || conversation !== null && row.conversation_id.equals(conversation.id)
          && (!bytes(row.client_id).equals(clientId) || !bytes(row.admin_id).equals(bytes(conversation.adminId))))
        failErasure("ERASURE_BINDINGS");
    }
  }
  return Object.freeze({
    rootFingerprint: capacity.rootFingerprint.toString("hex"),
    async assertSchema(connection, database) {
      // Reuse the lease connection, including with a one-connection pool.
      // The validator is read-only and producers are already stopped.
      await videoStore.assertSchema(connection);
      await assertErasureSchema(connection, database, { candidateMigrations: await loadVideoMigrations() });
    },
    snapshot,
    inspect,
    async prepare(connection, context) {
      await inspect(connection, context);
      if (context.conversation !== null)
        await connection.query("DELETE FROM message_video WHERE conversation_id = ?", [context.conversation.id]);
      await connection.query(`UPDATE video_assets SET state = 'cleanup_pending', updated_at = GREATEST(updated_at, ?)
        WHERE owner_id = ? AND owner_role = 'client' AND state <> 'released'`, [context.nowSql, context.clientId]);
    },
    async next(connection, { clientId, afterId, nowSql }) {
      if (afterId !== null) erasureId(afterId);
      const rows = await connection.query(`SELECT ${COLUMNS} FROM video_assets WHERE owner_id = ? AND owner_role = 'client'
        ${afterId === null ? "" : "AND id > ?"} ORDER BY id LIMIT 1 FOR UPDATE`,
      [target(clientId), ...(afterId === null ? [] : [Buffer.from(afterId, "hex")])]);
      if (!rows.length) return null;
      const row = owned(rows[0], clientId, nowSql);
      if (!["cleanup_pending", "released"].includes(row.state)) failErasure("ERASURE_STATE");
      return { id: row.id.toString("hex"), storageKey: Buffer.from(row.storage_key) };
    },
    async release(connection, { clientId, objectId, storageKey, nowSql }) {
      erasureId(objectId); bytes(storageKey, 32);
      const held = await snapshot(connection), row = owned((await connection.query(`SELECT ${COLUMNS}
        FROM video_assets WHERE id = ? FOR UPDATE`, [Buffer.from(objectId, "hex")]))[0], target(clientId), nowSql);
      if (!row.storage_key.equals(storageKey) || !["cleanup_pending", "released"].includes(row.state)) failErasure("ERASURE_BINDINGS");
      if (row.state !== "released") {
        const size = count(row.stored_bytes); if (size > held) failErasure("ERASURE_CAPACITY");
        await connection.query(`UPDATE video_assets SET state = 'released', updated_at = GREATEST(updated_at, ?),
          released_at = GREATEST(created_at, ?) WHERE id = ? AND state = 'cleanup_pending'`, [nowSql, nowSql, row.id]);
        await connection.query("UPDATE video_storage_state SET held_bytes = held_bytes - ? WHERE id = 1", [size]);
      }
      return { released: true };
    },
    async finish(connection, { clientId }) {
      clientId = target(clientId);
      if ((await connection.query("SELECT 1 AS present FROM video_assets WHERE owner_id = ? AND state <> 'released' LIMIT 1 FOR UPDATE", [clientId])).length)
        failErasure("ERASURE_RESIDUAL");
      if ((await connection.query(`SELECT 1 AS present FROM message_video mv JOIN video_assets a ON a.id = mv.video_id
        WHERE a.owner_id = ? LIMIT 1 FOR UPDATE`, [clientId])).length) failErasure("ERASURE_RESIDUAL");
      await connection.query("DELETE FROM video_assets WHERE owner_id = ? AND owner_role = 'client'", [clientId]);
    },
    async verifyAbsent(connection, { clientId }) {
      if ((await connection.query("SELECT 1 AS present FROM video_assets WHERE owner_id = ? LIMIT 1", [target(clientId)])).length)
        failErasure("ERASURE_RESIDUAL");
    },
  });
}
