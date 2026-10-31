import { ChatStoreError, normalizedCheckTree, authoredMigrationCheck } from "../chat/store.mjs";
import { loadVideoMigrations } from "./migrations.mjs";

export class VideoMessageStoreError extends ChatStoreError {
  constructor(code) { super(code, "Private video message persistence could not be completed."); this.name = "VideoMessageStoreError"; }
}
const fail = (code) => { throw new VideoMessageStoreError(code); };
const input = () => fail("VIDEO_INPUT");
const state = () => fail("VIDEO_DATABASE_STATE");
const sized = (value, size) => Buffer.isBuffer(value) && value.length === size;
const bytes = (value, size) => { if (!sized(value, size)) input(); return value; };
const instant = (value) => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) input(); return value; };
const sqlDate = (value) => new Date(instant(value)).toISOString().replace("T", " ").replace("Z", "000");
const sequence = (value) => { if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(value)
  || BigInt(value) > 18446744073709551615n) input(); return value; };
const storedSequence = (value) => { try { return sequence(String(value)); } catch { state(); } };
function timestamp(value) {
  if (value instanceof Date) { const millis = value.getTime(); instant(millis); return { text: sqlDate(millis), millis }; }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) state();
  const [seconds, fraction = ""] = value.split("."), text = seconds + "." + fraction.padEnd(6, "0");
  const iso = text.slice(0, 23).replace(" ", "T") + "Z", millis = Date.parse(iso);
  if (!Number.isSafeInteger(millis) || millis < 0 || millis > 253402300799999 || new Date(millis).toISOString() !== iso) state();
  return { text, millis };
}
const projection = `mv.message_id, mv.conversation_id, mv.video_id, mv.created_at AS linked_at,
  m.conversation_id AS message_conversation_id, m.sender_id, m.sender_role, m.sequence_no,
  m.created_at AS message_created_at, m.deleted_at, mm.media_id AS photo_id`;
const joins = `JOIN messages m ON m.id = mv.message_id
  LEFT JOIN message_media mm ON mm.message_id = mv.message_id`;
const definitions = { message_id: ["varbinary", 16], conversation_id: ["varbinary", 16], video_id: ["varbinary", 16], created_at: ["datetime"] };
const indexes = { PRIMARY: [0, "message_id"], message_video_message: [1, "conversation_id", "message_id"], message_video_asset: [1, "video_id", "message_id"] };
const foreignKeys = [
  ["message_video_message_fk", "messages", ["conversation_id", "message_id"], ["conversation_id", "id"]],
  ["message_video_asset_fk", "video_assets", ["video_id"], ["id"]],
];
const checks = ["message_video_message_size", "message_video_conversation_size", "message_video_asset_size"];

/** Production video composition. Authorization, reads and appends stay inside
 * the ordinary chat transaction; catalog batches grant no separate authority. */
export function createVideoMessageStore({ pool, chatStore, videoStore } = {}) {
  if (typeof pool?.getConnection !== "function" || typeof chatStore?.withConversation !== "function"
    || typeof chatStore?.withConversationAppend !== "function" || typeof videoStore?.getCommittedAsset !== "function"
    || typeof videoStore?.getCommittedAssets !== "function" || typeof videoStore?.assertSchema !== "function") input();
  function request(value) {
    if (!["admin", "client"].includes(value?.role)) input();
    bytes(value.tokenHash, 32); bytes(value.conversationId, 16); instant(value.now); return value;
  }
  function link(row, context) {
    if (!sized(row.message_id, 16) || !sized(row.conversation_id, 16) || !sized(row.video_id, 16)
      || !sized(row.message_conversation_id, 16) || !row.conversation_id.equals(context.conversation.id)
      || !row.message_conversation_id.equals(row.conversation_id) || !sized(row.sender_id, 16)
      || !["admin", "client"].includes(row.sender_role) || row.photo_id !== null) state();
    const participant = context.conversation[row.sender_role === "admin" ? "admin_id" : "client_id"];
    if (!sized(participant, 16) || !row.sender_id.equals(participant)) state();
    const created = timestamp(row.message_created_at), linked = timestamp(row.linked_at);
    if (created.text !== linked.text || created.text > sqlDate(context.now)) state();
    storedSequence(row.sequence_no);
    if (row.deleted_at !== null) {
      const deleted = timestamp(row.deleted_at);
      if (deleted.text < created.text || deleted.text > sqlDate(context.now)) state();
    }
    return created.millis;
  }
  async function committed(connection, context, row) {
    const createdAt = link(row, context);
    const asset = await videoStore.getCommittedAsset(connection, { assetId: row.video_id,
      ownerId: row.sender_id, ownerRole: row.sender_role, now: context.now });
    if (!sized(asset?.id, 16) || !asset.id.equals(row.video_id) || !sized(asset.ownerId, 16)
      || !asset.ownerId.equals(row.sender_id) || asset.deletedAt !== null || asset.createdAt > createdAt) state();
    return asset;
  }
  const assetKey = row => `${row.video_id.toString("hex")}:${row.sender_id.toString("hex")}:${row.sender_role}`;
  async function committedBatch(connection, context, rows) {
    const requested = new Map();
    for (const row of rows) {
      link(row, context);
      if (row.deleted_at === null) requested.set(assetKey(row), { assetId: row.video_id, ownerId: row.sender_id, ownerRole: row.sender_role });
    }
    if (requested.size === 0) return new Map();
    const values = await videoStore.getCommittedAssets(connection, { assets: [...requested.values()], now: context.now });
    if (!Array.isArray(values) || values.length !== requested.size) state();
    const originals = new Map();
    [...requested.keys()].forEach((key, index) => originals.set(key, values[index]));
    // A reused original never replaces validation of its individual delivery.
    for (const row of rows) {
      if (row.deleted_at !== null) continue;
      const asset = originals.get(assetKey(row)), createdAt = timestamp(row.message_created_at).millis;
      if (!sized(asset?.id, 16) || !asset.id.equals(row.video_id) || !sized(asset.ownerId, 16)
        || !asset.ownerId.equals(row.sender_id) || asset.deletedAt !== null || asset.createdAt > createdAt) state();
    }
    return originals;
  }
  async function decorateMessages(connection, context, rows) {
    if (typeof connection?.query !== "function" || !Array.isArray(rows) || rows.length > 100) input();
    if (rows.length === 0) return rows;
    const ids = new Map();
    for (const row of rows) {
      if (!sized(row?.id, 16) || !sized(row.conversationId, 16) || !row.conversationId.equals(context.conversation.id)) state();
      ids.set(row.id.toString("hex"), row.id);
    }
    // Event pages may repeat the same message. Only the SQL batch is deduped;
    // every original position survives in the result.
    const links = await connection.query(`SELECT ${projection} FROM message_video mv ${joins}
      WHERE mv.message_id IN (${[...ids].map(() => "?").join(", ")}) FOR UPDATE`, [...ids.values()]);
    const found = new Map();
    for (const row of links) {
      const createdAt = link(row, context), key = row.message_id.toString("hex");
      if (!ids.has(key) || found.has(key)) state();
      found.set(key, { row, createdAt });
    }
    const assets = await committedBatch(connection, context, links);
    const result = [];
    for (const raw of rows) {
      const key = raw.id.toString("hex"), selected = found.get(key);
      if (!selected) { if (raw.video) state(); result.push(raw); continue; }
      const { row, createdAt } = selected;
      if (!sized(raw.senderId, 16) || !raw.senderId.equals(row.sender_id) || raw.senderRole !== row.sender_role
        || raw.sequence !== storedSequence(row.sequence_no) || raw.createdAt !== createdAt || raw.media
        || (raw.deletedAt === null) !== (row.deleted_at === null)
        || raw.deletedAt !== null && raw.deletedAt !== timestamp(row.deleted_at).millis) state();
      if (raw.deletedAt !== null) { result.push(raw); continue; }
      const asset = assets.get(assetKey(row));
      result.push({ ...raw, video: { id: asset.id, bytes: asset.bytes, mime: asset.mime } });
    }
    return result;
  }

  async function appendBroadcastVideo(connection, context, append, message) {
    if (typeof connection?.query !== "function" || typeof append !== "function" || context?.actor?.role !== "admin") input();
    return appendVideo(connection, context, append, message);
  }
  async function appendVideo(connection, context, append, message) {
    if (context?.actor?.role !== "admin") fail("VIDEO_ADMIN_ONLY");
    bytes(message?.videoId, 16);
    if (message.mediaId !== undefined && message.mediaId !== null) input();
    const { videoId, ...ordinary } = message;
    const result = await append(ordinary);
    const existing = (await connection.query(`SELECT ${projection} FROM message_video mv ${joins}
      WHERE mv.message_id = ? FOR UPDATE`, [result.message.id]))[0];
    if (result.duplicate) {
      if (!existing || !sized(existing.video_id, 16) || !existing.video_id.equals(videoId) || existing.photo_id !== null) fail("CHAT_CONFLICT");
      link(existing, context);
      if (result.message.deletedAt !== null) return result;
    } else {
      if (existing || result.message.media || result.message.deletedAt !== null) state();
      const asset = await videoStore.getCommittedAsset(connection, { assetId: videoId,
        ownerId: context.actor.id, ownerRole: context.actor.role, now: context.now });
      if (asset.createdAt > result.message.createdAt) state();
      await connection.query("INSERT INTO message_video (message_id, conversation_id, video_id, created_at) VALUES (?, ?, ?, ?)",
        [result.message.id, context.conversation.id, videoId, sqlDate(result.message.createdAt)]);
    }
    return { ...result, message: (await decorateMessages(connection, context, [result.message]))[0] };
  }

  return Object.freeze({
    decorateMessages, appendBroadcastVideo,
    async sendMessage(value) {
      request(value); bytes(value.message?.videoId, 16);
      if (value.message.mediaId !== undefined && value.message.mediaId !== null) input();
      return chatStore.withConversationAppend(value, (connection, context, append) => appendVideo(connection, context, append, value.message));
    },
    async getMessageAsset(value) {
      request(value); bytes(value.messageId, 16);
      return chatStore.withConversation(value, async (connection, context) => {
        const row = (await connection.query(`SELECT ${projection} FROM message_video mv ${joins}
          WHERE mv.conversation_id = ? AND mv.message_id = ? FOR UPDATE`, [value.conversationId, value.messageId]))[0];
        if (!row || row.deleted_at !== null) fail("VIDEO_NOT_FOUND");
        return committed(connection, context, row);
      });
    },
    async gallery(value) {
      request(value); const { before = null, limit = 50 } = value;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) input(); if (before !== null) sequence(before);
      return chatStore.withConversation(value, async (connection, context) => {
        const rows = await connection.query(`SELECT ${projection} FROM message_video mv ${joins}
          WHERE mv.conversation_id = ? AND m.deleted_at IS NULL AND m.created_at <= ?
          ${before === null ? "" : "AND m.sequence_no < ?"} ORDER BY m.sequence_no DESC LIMIT ? FOR UPDATE`,
        [value.conversationId, sqlDate(context.now), ...(before === null ? [] : [before]), limit + 1]);
        const selected = rows.slice(0, limit), hasMore = rows.length > limit, items = [];
        const assets = await committedBatch(connection, context, selected);
        let previous = before === null ? 18446744073709551616n : BigInt(before);
        for (const row of selected) {
          const current = storedSequence(row.sequence_no); if (BigInt(current) >= previous || current === "0") state(); previous = BigInt(current);
          link(row, context);
          const asset = assets.get(assetKey(row));
          items.push({ messageId: row.message_id, sequence: current, senderId: row.sender_id,
            createdAt: timestamp(row.message_created_at).millis, asset });
        }
        return { items, nextBefore: hasMore ? items.at(-1).sequence : null, hasMore };
      });
    },
    async assertSchema() {
      await videoStore.assertSchema();
      let connection;
      try {
        connection = await pool.getConnection();
        const database = (await connection.query("SELECT DATABASE() AS name"))[0]?.name;
        const enforcement = (await connection.query("SELECT @@SESSION.foreign_key_checks AS foreignKeys, @@SESSION.check_constraint_checks AS checkConstraints"))[0];
        if (Number(enforcement?.foreignKeys) !== 1 || Number(enforcement?.checkConstraints) !== 1) state();
        const table = (await connection.query("SELECT ENGINE AS engine, TABLE_COLLATION AS collationName FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'message_video'", [database]))[0];
        if (table?.engine !== "InnoDB" || table.collationName !== "utf8mb4_unicode_ci") state();
        const columns = await connection.query(`SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, IS_NULLABLE AS nullable,
          CHARACTER_MAXIMUM_LENGTH AS length, DATETIME_PRECISION AS precisionValue FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'message_video'`, [database]);
        if (columns.length !== Object.keys(definitions).length) state();
        for (const [name, [type, length]] of Object.entries(definitions)) {
          const column = columns.find((item) => item.name === name);
          if (!column || column.dataType !== type || column.nullable !== "NO" || length !== undefined && Number(column.length) !== length
            || type === "datetime" && Number(column.precisionValue) !== 6) state();
        }
        const keys = await connection.query(`SELECT INDEX_NAME AS name, COLUMN_NAME AS columnName, NON_UNIQUE AS nonUnique,
          SEQ_IN_INDEX AS positionValue, SUB_PART AS prefixLength FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'message_video'`, [database]);
        if (new Set(keys.map((item) => item.name)).size !== Object.keys(indexes).length) state();
        for (const [name, [nonUnique, ...names]] of Object.entries(indexes)) {
          const parts = keys.filter((item) => item.name === name).sort((a, b) => Number(a.positionValue) - Number(b.positionValue));
          if (parts.length !== names.length || parts.some((part, index) => part.columnName !== names[index]
            || Number(part.nonUnique) !== nonUnique || part.prefixLength !== null)) state();
        }
        const foreign = await connection.query(`SELECT CONSTRAINT_NAME AS name, COLUMN_NAME AS columnName,
          REFERENCED_TABLE_SCHEMA AS parentSchema, REFERENCED_TABLE_NAME AS parentTable, REFERENCED_COLUMN_NAME AS parentColumn,
          ORDINAL_POSITION AS positionValue FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'message_video' AND REFERENCED_TABLE_NAME IS NOT NULL`, [database]);
        const rules = await connection.query(`SELECT CONSTRAINT_NAME AS name, UPDATE_RULE AS updateRule, DELETE_RULE AS deleteRule
          FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'message_video'`, [database]);
        if (foreign.length !== 3 || rules.length !== foreignKeys.length) state();
        for (const [name, parent, names, parents] of foreignKeys) {
          const parts = foreign.filter((item) => item.name === name).sort((a, b) => Number(a.positionValue) - Number(b.positionValue));
          if (parts.length !== names.length || parts.some((part, index) => part.parentSchema !== database || part.parentTable !== parent
            || part.columnName !== names[index] || part.parentColumn !== parents[index])
            || !rules.some((rule) => rule.name === name && rule.updateRule === "RESTRICT" && rule.deleteRule === "RESTRICT")) state();
        }
        const actual = await connection.query(`SELECT CONSTRAINT_NAME AS name, CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'message_video'`, [database]);
        const migration = (await loadVideoMigrations()).find((item) => item.version === 36);
        if (!migration || actual.length !== checks.length) state();
        for (const name of checks) {
          const check = actual.find((item) => item.name === name);
          if (!check || normalizedCheckTree(check.clause) !== normalizedCheckTree(authoredMigrationCheck(migration.sql, name))) state();
        }
        await connection.query("SELECT message_id, conversation_id, video_id, created_at FROM message_video WHERE 1 = 0");
        return true;
      } catch (error) {
        if (error instanceof ChatStoreError) throw error; fail("VIDEO_DATABASE_OPERATION");
      } finally { if (connection) { try { await connection.release(); } catch {} } }
    },
  });
}
