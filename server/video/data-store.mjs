import { DataStoreError } from "../data/store.mjs";
import { MAX_VIDEO_BYTES, videoStoredBytes } from "./storage.mjs";

const fail = () => { throw new DataStoreError(); };
const MAX_DATE = 253402300799999;
const bytes = (value, size) => {
  if (!Buffer.isBuffer(value) || value.length !== size) fail();
  return Buffer.from(value);
};
const instant = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value)) fail();
  const iso = value.slice(0, 23).replace(" ", "T") + "Z", parsed = Date.parse(iso);
  if (!instant(parsed) || new Date(parsed).toISOString() !== iso) fail();
  return value;
}
function integer(value, maximum) {
  if (!["number", "bigint", "string"].includes(typeof value)
    || typeof value === "string" && !/^[1-9][0-9]*$/.test(value)) fail();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) fail();
  return result;
}
function context(value) {
  if (!value || typeof value !== "object" || !instant(value.now)
    || date(value.nowSql) !== new Date(value.now).toISOString().replace("T", " ").replace("Z", "000")) fail();
  const result = { clientId: bytes(value.clientId, 16), now: value.now, nowSql: value.nowSql, conversation: null };
  if (value.conversation !== null) {
    const selected = value.conversation;
    if (!selected || typeof selected !== "object") fail();
    result.conversation = { id: bytes(selected.id, 16), clientId: bytes(selected.clientId, 16), adminId: bytes(selected.adminId, 16) };
    if (!result.conversation.clientId.equals(result.clientId) || result.conversation.adminId.equals(result.clientId)) fail();
  }
  return result;
}
const columns = "id, owner_id, owner_role, storage_key, content_digest, bytes, stored_bytes, mime, state, created_at, updated_at, released_at";
function asset(row, selected) {
  const result = { id: bytes(row?.id, 16), ownerId: bytes(row.owner_id, 16), ownerRole: row.owner_role,
    storageKey: bytes(row.storage_key, 32), digest: bytes(row.content_digest, 32),
    bytes: integer(row.bytes, MAX_VIDEO_BYTES), storedBytes: integer(row.stored_bytes, videoStoredBytes(MAX_VIDEO_BYTES)),
    mime: row.mime, state: row.state, deletedAt: null, createdAt: date(row.created_at) };
  const updatedAt = date(row.updated_at);
  if (!["admin", "client"].includes(result.ownerRole) || result.mime !== "video/mp4" || result.state !== "committed"
    || row.released_at !== null || result.storedBytes !== videoStoredBytes(result.bytes)
    || updatedAt < result.createdAt || updatedAt > selected.nowSql) fail();
  return result;
}
function page(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((name) => !["afterId", "limit"].includes(name))) fail();
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail();
  return { limit, after: options.afterId == null ? null : bytes(options.afterId, 16) };
}
function rows(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) fail();
  return value;
}

/** Opt-in operator export extension. The caller owns the read-only snapshot;
 * neither callback starts a transaction, acquires write locks or reads files. */
export function createVideoDataReader() {
  return Object.freeze({
    async decorateMessages(connection, rawContext, rawRows) {
      if (typeof connection?.query !== "function") fail();
      const selected = context(rawContext), source = rows(rawRows, 100);
      if (source.length === 0) return [];
      if (selected.conversation === null) fail();
      const messages = new Map();
      for (const row of source) {
        const id = bytes(row?.id, 16), conversationId = bytes(row.conversationId, 16), senderId = bytes(row.senderId, 16);
        const createdAt = date(row.createdAt), deletedAt = row.deletedAt === null ? null : date(row.deletedAt);
        if (!conversationId.equals(selected.conversation.id) || !["admin", "client"].includes(row.senderRole)
          || !senderId.equals(row.senderRole === "client" ? selected.clientId : selected.conversation.adminId)
          || createdAt > selected.nowSql || deletedAt !== null && (deletedAt < createdAt || deletedAt > selected.nowSql)
          || messages.has(id.toString("hex"))) fail();
        messages.set(id.toString("hex"), row);
      }
      const parameters = [...messages.values()].map((row) => row.id);
      const links = rows(await connection.query(
        "SELECT mv.message_id, mv.conversation_id, mv.video_id, mv.created_at, mm.media_id AS photo_id "
        + "FROM message_video mv LEFT JOIN message_media mm ON mm.message_id = mv.message_id "
        + "WHERE mv.message_id IN (" + parameters.map(() => "?").join(", ") + ")", parameters), source.length);
      const byMessage = new Map(), wanted = new Map();
      for (const row of links) {
        const messageId = bytes(row?.message_id, 16), videoId = bytes(row.video_id, 16), messageKey = messageId.toString("hex");
        const message = messages.get(messageKey);
        if (!message || byMessage.has(messageKey) || !bytes(row.conversation_id, 16).equals(message.conversationId)
          || date(row.created_at) !== message.createdAt || row.photo_id !== null || message.media !== null) fail();
        byMessage.set(messageKey, videoId);
        // A tombstone preserves no content access, even if its catalog row has
        // since disappeared or become invalid. Never fetch that row for it.
        if (message.deletedAt === null) wanted.set(videoId.toString("hex"), videoId);
      }
      const assets = new Map();
      if (wanted.size) {
        const parameters = [...wanted.values()];
        const values = rows(await connection.query("SELECT " + columns + " FROM video_assets WHERE id IN ("
          + parameters.map(() => "?").join(", ") + ")", parameters), wanted.size);
        for (const row of values) {
          const value = asset(row, selected), assetKey = value.id.toString("hex");
          if (!wanted.has(assetKey) || assets.has(assetKey)) fail();
          assets.set(assetKey, value);
        }
        if (assets.size !== wanted.size) fail();
      }
      return source.map((row) => {
        const linked = byMessage.get(row.id.toString("hex"));
        if (!linked || row.deletedAt !== null) return { ...row, video: null };
        const value = assets.get(linked.toString("hex"));
        if (!value.ownerId.equals(row.senderId) || value.ownerRole !== row.senderRole || value.createdAt > row.createdAt) fail();
        return { ...row, video: { ...value, id: Buffer.from(value.id), ownerId: Buffer.from(value.ownerId),
          storageKey: Buffer.from(value.storageKey), digest: Buffer.from(value.digest) } };
      });
    },
    async ownVideos(connection, rawContext, options = {}) {
      if (typeof connection?.query !== "function") fail();
      const selected = context(rawContext), { limit, after } = page(options);
      const values = rows(await connection.query("SELECT " + columns + " FROM video_assets WHERE owner_id = ? "
        + "AND owner_role = 'client' AND state = 'committed' AND created_at <= ? "
        + (after === null ? "" : "AND id > ? ") + "ORDER BY id ASC LIMIT ?",
      [selected.clientId, selected.nowSql, ...(after === null ? [] : [after]), limit + 1]), limit + 1);
      let previous = after;
      const parsed = values.map((row) => {
        const result = asset(row, selected);
        if (!result.ownerId.equals(selected.clientId) || result.ownerRole !== "client"
          || previous !== null && Buffer.compare(result.id, previous) <= 0) fail();
        previous = result.id; return result;
      });
      const chosen = parsed.slice(0, limit), hasMore = parsed.length > limit;
      return { rows: chosen, hasMore, nextCursor: hasMore ? Buffer.from(chosen.at(-1).id) : null };
    },
  });
}
