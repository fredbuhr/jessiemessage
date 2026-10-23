import { loadStoreMigrations } from "../db/store-migrations.mjs";
import { ChatStoreError } from "../chat/store.mjs";
import { migrationStatus } from "../db/migrations.mjs";
import { heldMediaObjects, lockMediaCapacity, ownerMediaBytes, pendingMediaBytes, validateMediaCapacity } from "./capacity-store.mjs";
import { BACKUP_MEDIA_MAX_BYTES, BACKUP_MEDIA_MAX_OBJECTS } from "./backup-limits.mjs";
import { BackupMediaAdmissionError, fitsBackupMediaAdmission, lockBackupMediaAdmission } from "./backup-admission.mjs";

// Chat transactions preserve this subclass while rolling back every callback
// failure. No database exception, file key or message content escapes here.
export class MediaStoreError extends ChatStoreError {
  constructor(code) { super(code, "Private media persistence could not be completed."); this.name = "MediaStoreError"; }
}
const fail = (code) => { throw new MediaStoreError(code); };
const input = () => fail("MEDIA_INPUT");
const state = () => fail("MEDIA_DATABASE_STATE");
const bytes = (value, length) => { if (!Buffer.isBuffer(value) || value.length !== length) input(); return value; };
const integer = (value, max) => { if (!Number.isInteger(value) || value < 1 || value > max) input(); return value; };
const instant = (value) => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) input(); return value; };
const sqlDate = (value) => new Date(instant(value)).toISOString().replace("T", " ").replace("Z", "000");
const timestamp = (value) => {
  if (value instanceof Date) { const result = value.getTime(); if (Number.isSafeInteger(result) && result >= 0) return result; }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) state();
  const result = Date.parse(`${value.replace(" ", "T")}Z`); if (!Number.isSafeInteger(result) || result < 0) state(); return result;
};
const sequence = (value) => { if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(value)
  || BigInt(value) > 18446744073709551615n || BigInt(value).toString() !== value) input(); return value; };
const storedSequence = (value) => { try { return sequence(String(value)); } catch { state(); } };
const assetProjection = `a.id, a.owner_id, a.storage_key, a.content_digest, a.width, a.height,
  a.thumbnail_width, a.thumbnail_height, a.full_bytes, a.thumbnail_bytes, a.created_at, a.deleted_at`;
const rawAsset = (row, sharedHere = false) => ({ id: row.id, ownerId: row.owner_id, storageKey: row.storage_key,
  digest: row.content_digest, width: Number(row.width), height: Number(row.height), thumbnailWidth: Number(row.thumbnail_width),
  thumbnailHeight: Number(row.thumbnail_height), fullBytes: Number(row.full_bytes), thumbnailBytes: Number(row.thumbnail_bytes),
  createdAt: timestamp(row.created_at), deletedAt: row.deleted_at === null ? null : timestamp(row.deleted_at), sharedHere });
const definitions = {
  media_assets: { id: ["varbinary", false, 16], owner_id: ["varbinary", false, 16], owner_role: ["varchar", false, 8],
    storage_key: ["varbinary", false, 32], content_digest: ["varbinary", false, 32], active_digest: ["varbinary", true, 32],
    mime: ["varchar", false, 16], width: ["smallint", false], height: ["smallint", false], thumbnail_width: ["smallint", false],
    thumbnail_height: ["smallint", false], full_bytes: ["int", false], thumbnail_bytes: ["int", false],
    created_at: ["datetime", false], deleted_at: ["datetime", true] },
  message_media: { message_id: ["varbinary", false, 16], conversation_id: ["varbinary", false, 16], media_id: ["varbinary", false, 16], created_at: ["datetime", false] },
  media_storage_state: { id: ["tinyint", false], owner_bytes: ["bigint", false], total_bytes: ["bigint", false], root_fingerprint: ["varbinary", false, 32], held_bytes: ["bigint", false], initialized_at: ["datetime", false] },
  media_storage_objects: { id: ["varbinary", false, 16], owner_id: ["varbinary", false, 16], owner_role: ["varchar", false, 8], storage_key: ["varbinary", false, 32], content_digest: ["varbinary", false, 32],
    full_bytes: ["int", false], thumbnail_bytes: ["int", false], stored_bytes: ["int", false], state: ["varchar", false, 16], asset_id: ["varbinary", true, 16], created_at: ["datetime", false], updated_at: ["datetime", false], released_at: ["datetime", true] },
};
const indexes = {
  media_assets: { PRIMARY: [0, "id"], media_assets_storage: [0, "storage_key"], media_assets_owner_digest: [0, "owner_id", "active_digest"], media_assets_owner_page: [1, "owner_id", "id"] },
  message_media: { PRIMARY: [0, "message_id"], message_media_message: [1, "conversation_id", "message_id"], message_media_asset: [1, "media_id", "message_id"] },
  media_storage_state: { PRIMARY: [0, "id"] },
  media_storage_objects: { PRIMARY: [0, "id"], media_storage_objects_key: [0, "storage_key"], media_storage_objects_asset: [0, "asset_id"], media_storage_objects_owner: [1, "owner_id", "state", "id"], media_storage_objects_state: [1, "state", "id"] },
};
const foreignKeys = [
  ["media_assets", "media_assets_owner_fk", "users", ["owner_id", "owner_role"], ["id", "role"]],
  ["message_media", "message_media_message_fk", "messages", ["conversation_id", "message_id"], ["conversation_id", "id"]],
  ["message_media", "message_media_asset_fk", "media_assets", ["media_id"], ["id"]],
  ["media_storage_objects", "media_storage_objects_owner_fk", "users", ["owner_id", "owner_role"], ["id", "role"]],
  ["media_storage_objects", "media_storage_objects_asset_fk", "media_assets", ["asset_id"], ["id"]],
];

// Compare semantic trees of the restricted migration CHECK grammar. MariaDB
// rewrites redundant parentheses; removing all parentheses would weaken AND/OR.
function checkTree(expression) {
  const tokens = [], pattern = /\s+|`([a-z_][a-z0-9_]*)`|'(?:''|[^'])*'|>=|<=|<>|!=|[=<>(),+]|[0-9]+|[a-z_][a-z0-9_]*/iy;
  let offset = 0;
  while (offset < expression.length) {
    pattern.lastIndex = offset; const match = pattern.exec(expression); if (!match) state(); offset = pattern.lastIndex;
    if (!/^\s+$/.test(match[0])) tokens.push(match[1] ?? (match[0].startsWith("'") ? match[0] : match[0].toLowerCase()));
  }
  let position = 0;
  const take = (expected) => { if (tokens[position++] !== expected) state(); };
  function primary() {
    const token = tokens[position++]; if (!token || !/^(?:[a-z_][a-z0-9_]*|[0-9]+|'(?:''|[^'])*')$/i.test(token)) state();
    if (tokens[position] === "(") {
      position++; if (!["octet_length", "char_length"].includes(token)) state(); const argument = operand(); take(")"); return ["call", token, argument];
    }
    return ["value", token];
  }
  function operand() {
    let result = primary();
    while (tokens[position] === "+") { position++; result = ["+", result, primary()]; }
    return result;
  }
  function predicate() {
    if (tokens[position] === "(") { position++; const result = or(); take(")"); return result; }
    const left = operand(), operator = tokens[position++];
    if (["=", "<>", "!=", ">", "<", ">=", "<="].includes(operator)) return [operator === "!=" ? "<>" : operator, left, operand()];
    if (operator === "is") { const negative = tokens[position] === "not"; if (negative) position++; take("null"); return [negative ? "is-not-null" : "is-null", left]; }
    if (operator === "between") { const low = operand(); take("and"); return ["between", left, low, operand()]; }
    if (operator === "in") { take("("); const values = [operand()]; while (tokens[position] === ",") { position++; values.push(operand()); } take(")"); return ["in", left, ...values]; }
    state();
  }
  const combine = (name, children) => children.length === 1 ? children[0] : [name, ...children.flatMap((child) => child[0] === name ? child.slice(1) : [child])];
  function and() { const children = [predicate()]; while (tokens[position] === "and") { position++; children.push(predicate()); } return combine("and", children); }
  function or() { const children = [and()]; while (tokens[position] === "or") { position++; children.push(and()); } return combine("or", children); }
  const result = or(); if (position !== tokens.length) state(); return JSON.stringify(result);
}
function authoredChecks(sql) {
  const pattern = /CONSTRAINT\s+([a-z_][a-z0-9_]*)\s+CHECK\s*\(/ig, result = [];
  let match;
  while ((match = pattern.exec(sql))) {
    const start = pattern.lastIndex; let depth = 1, position = start;
    for (; position < sql.length; position++) { if (sql[position] === "(") depth++; if (sql[position] === ")" && --depth === 0) break; }
    if (depth !== 0) state(); result.push([match[1], sql.slice(start, position)]); pattern.lastIndex = position + 1;
  }
  return result;
}

export function createMediaStore({ pool, chatStore, capacity = null, video = false }) {
  if (typeof video !== "boolean") input();
  if (!pool || typeof pool.getConnection !== "function" || !chatStore || typeof chatStore.withActor !== "function" || typeof chatStore.withConversation !== "function") input();
  capacity = capacity === null ? null : validateMediaCapacity(capacity);
  const withContext = (request, callback) => request.conversationId === null || request.conversationId === undefined
    ? chatStore.withActor(request, callback) : chatStore.withConversation(request, callback);
  async function owned(connection, context, assetId, allowDeleted = false) {
    const row = (await connection.query(`SELECT ${assetProjection} FROM media_assets a WHERE a.id = ? AND a.owner_id = ? FOR UPDATE`, [assetId, context.actor.id]))[0];
    if (!row || (!allowDeleted && row.deleted_at !== null) || timestamp(row.created_at) > context.now) fail("MEDIA_NOT_FOUND");
    return row;
  }
  function validateAsset(asset) {
    bytes(asset?.id, 16); bytes(asset?.storageKey, 32); bytes(asset?.digest, 32);
    integer(asset.width, 2048); integer(asset.height, 2048); integer(asset.thumbnailWidth, 480); integer(asset.thumbnailHeight, 480);
    integer(asset.fullBytes, 10485760); integer(asset.thumbnailBytes, 524288);
    if (asset.thumbnailWidth > asset.width || asset.thumbnailHeight > asset.height) input();
  }
  const allocation = async (connection, objectId) => (await connection.query("SELECT * FROM media_storage_objects WHERE id = ? FOR UPDATE", [objectId]))[0];
  function matches(row, context, asset) {
    return row && row.owner_id.equals(context.actor.id) && row.owner_role === context.actor.role
      && row.storage_key.equals(asset.storageKey) && row.content_digest.equals(asset.digest)
      && Number(row.full_bytes) === asset.fullBytes && Number(row.thumbnail_bytes) === asset.thumbnailBytes
      && Number(row.stored_bytes) === asset.fullBytes + asset.thumbnailBytes + 80;
  }

  return Object.freeze({
    async assertSchema(options = {}) {
      await chatStore.assertSchema(options); let connection;
      try {
        connection = await pool.getConnection();
        const database = (await connection.query("SELECT DATABASE() AS name"))[0].name;
        const enforcement = (await connection.query("SELECT @@SESSION.foreign_key_checks AS foreignKeys, @@SESSION.check_constraint_checks AS checkConstraints"))[0];
        if (Number(enforcement.foreignKeys) !== 1 || Number(enforcement.checkConstraints) !== 1) state();
        const migrations = await loadStoreMigrations(options), history = await migrationStatus(connection, { database, migrations });
        if (history.length < 27 || history.some((item) => item.state !== "applied")) state();
        const tables = await connection.query("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
        const columns = await connection.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType,
          IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS length, DATETIME_PRECISION AS precisionValue,
          COLUMN_TYPE AS columnType, COLLATION_NAME AS collationName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`, [database]);
        for (const [table, fields] of Object.entries(definitions)) {
          if (!tables.some((item) => item.name === table && item.engine === "InnoDB")) state();
          for (const [name, [type, nullable, length]] of Object.entries(fields)) {
            const column = columns.find((item) => item.tableName === table && item.columnName === name);
            if (!column || column.dataType !== type || (column.nullable === "YES") !== nullable
              || (length !== undefined && Number(column.length) !== length) || (type === "datetime" && Number(column.precisionValue) !== 6)
              || (["tinyint", "int", "smallint", "bigint"].includes(type) && !column.columnType.includes("unsigned"))
              || (type === "varchar" && column.collationName !== "ascii_bin")) state();
          }
        }
        const keys = await connection.query(`SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, COLUMN_NAME AS columnName,
          NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS positionValue, SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?`, [database]);
        for (const [table, fields] of Object.entries(indexes)) for (const [name, [nonUnique, ...expected]] of Object.entries(fields)) {
          const actual = keys.filter((item) => item.tableName === table && item.indexName === name).sort((a, b) => Number(a.positionValue) - Number(b.positionValue));
          if (actual.length !== expected.length || actual.some((item, index) => Number(item.nonUnique) !== nonUnique || item.columnName !== expected[index] || item.prefixLength !== null)) state();
        }
        const fk = await connection.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, COLUMN_NAME AS columnName,
          REFERENCED_TABLE_SCHEMA AS parentSchema, REFERENCED_TABLE_NAME AS parentTable, REFERENCED_COLUMN_NAME AS parentColumn, ORDINAL_POSITION AS positionValue
          FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`, [database]);
        const rules = await connection.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, UPDATE_RULE AS updateRule,
          DELETE_RULE AS deleteRule FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?`, [database]);
        for (const [table, name, parent, children, parents] of foreignKeys) {
          const actual = fk.filter((item) => item.tableName === table && item.name === name).sort((a, b) => Number(a.positionValue) - Number(b.positionValue));
          if (actual.length !== children.length || actual.some((item, index) => item.parentSchema !== database || item.parentTable !== parent || item.columnName !== children[index] || item.parentColumn !== parents[index])
            || !rules.some((item) => item.tableName === table && item.name === name && item.updateRule === "RESTRICT" && item.deleteRule === "RESTRICT")) state();
        }
        const checks = await connection.query("SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?", [database]);
        for (const table of Object.keys(definitions)) {
          const migration = migrations.find((item) => new RegExp(`^CREATE\\s+TABLE\\s+${table}\\s*\\(`, "i").test(item.sql.trim())); if (!migration) state();
          for (const [name, expression] of authoredChecks(migration.sql)) {
            const actual = checks.find((item) => item.tableName === table && item.name === name);
            if (!actual || checkTree(actual.clause) !== checkTree(expression)) state();
          }
          await connection.query(`SELECT ${Object.keys(definitions[table]).join(", ")} FROM ${table} WHERE 1 = 0`);
        }
        return true;
      } catch (error) { if (error instanceof ChatStoreError) throw error; fail("MEDIA_DATABASE_OPERATION"); }
      finally { if (connection) { try { connection.release(); } catch {} } }
    },

    async reserveAsset({ role, tokenHash, now, asset }) {
      validateAsset(asset);
      return chatStore.withActor({ role, tokenHash, now }, async (connection, context) => {
        if (capacity === null) fail("MEDIA_CAPACITY_UNAVAILABLE");
        let backup;
        try { backup = await lockBackupMediaAdmission(connection, { video }); }
        catch (error) {
          if (error instanceof BackupMediaAdmissionError) fail(error.reason === "unavailable" ? "MEDIA_CAPACITY_UNAVAILABLE" : "MEDIA_DATABASE_STATE");
          throw error;
        }
        const { heldBytes } = await lockMediaCapacity(connection, capacity);
        const existing = await allocation(connection, asset.id);
        if (existing && (!matches(existing, context, asset) || !["reserved", "registered"].includes(existing.state) || timestamp(existing.created_at) > now)) input();
        const pendingBytes = await pendingMediaBytes(connection);
        const ownerHeld = await ownerMediaBytes(connection, context.actor.id);
        const previous = (await connection.query(`SELECT ${assetProjection} FROM media_assets a WHERE a.owner_id = ? AND a.active_digest = ? FOR UPDATE`, [context.actor.id, asset.digest]))[0];
        if (previous) { if (timestamp(previous.created_at) > now) fail("MEDIA_NOT_FOUND"); return { asset: rawAsset(previous), duplicate: true }; }
        if (existing && existing.state !== "reserved") input();
        const storedBytes = asset.fullBytes + asset.thumbnailBytes + 80;
        if (!existing) {
          // Keep existing quota/root bindings and uncertain allocations intact.
          // Only new allocations spend the checkpoint's byte and file budgets.
          if (heldBytes > Math.min(capacity.totalBytes, BACKUP_MEDIA_MAX_BYTES) - storedBytes
            || ownerHeld > capacity.ownerBytes - storedBytes || await heldMediaObjects(connection) >= BACKUP_MEDIA_MAX_OBJECTS
            || !fitsBackupMediaAdmission(backup, storedBytes, 2)) fail("MEDIA_STORAGE_LIMIT");
          await connection.query(`INSERT INTO media_storage_objects
            (id, owner_id, owner_role, storage_key, content_digest, full_bytes, thumbnail_bytes, stored_bytes, state, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`, [asset.id, context.actor.id, role, asset.storageKey, asset.digest,
            asset.fullBytes, asset.thumbnailBytes, storedBytes, sqlDate(now), sqlDate(now)]);
          await connection.query("UPDATE media_storage_state SET held_bytes = held_bytes + ? WHERE id = 1", [storedBytes]);
        }
        return { duplicate: false, reservation: { id: asset.id, storageKey: asset.storageKey, bytes: storedBytes, pendingBytes: pendingBytes + (existing ? 0 : storedBytes) } };
      });
    },

    async cancelAssetReservation({ role, tokenHash, now, objectId, storageKey }) {
      bytes(objectId, 16); bytes(storageKey, 32);
      // Trusted upload cleanup only, before put has ever been called. Keep the
      // normal fresh actor proof and never admit a registered asset here.
      return chatStore.withActor({ role, tokenHash, now }, async (connection, context) => {
        now = context.now;
        const { heldBytes } = await lockMediaCapacity(connection, capacity);
        const object = await allocation(connection, objectId);
        if (!object || !object.owner_id.equals(context.actor.id) || object.owner_role !== role || !object.storage_key.equals(storageKey)) fail("MEDIA_NOT_FOUND");
        if (object.asset_id !== null || !["reserved", "released"].includes(object.state) || timestamp(object.updated_at) > now) input();
        const linked = await connection.query("SELECT 1 FROM media_assets WHERE id = ? OR storage_key = ? LIMIT 1 FOR UPDATE", [objectId, storageKey]);
        if (linked.length) input();
        if (object.state === "released") return { released: true };
        const storedBytes = Number(object.stored_bytes);
        if (!Number.isSafeInteger(storedBytes) || storedBytes < 1 || heldBytes < storedBytes) state();
        const at = sqlDate(now);
        await connection.query("UPDATE media_storage_objects SET state = 'released', updated_at = ?, released_at = ? WHERE id = ? AND state = 'reserved'", [at, at, objectId]);
        await connection.query("UPDATE media_storage_state SET held_bytes = held_bytes - ? WHERE id = 1", [storedBytes]);
        return { released: true };
      });
    },

    async registerAsset({ role, tokenHash, now, asset }) {
      validateAsset(asset);
      return chatStore.withActor({ role, tokenHash, now }, async (connection, context) => {
        await lockMediaCapacity(connection, capacity);
        const reserved = await allocation(connection, asset.id);
        if (!matches(reserved, context, asset) || reserved.state !== "reserved" || timestamp(reserved.created_at) > now) input();
        const previous = (await connection.query(`SELECT ${assetProjection} FROM media_assets a WHERE a.owner_id = ? AND a.active_digest = ? FOR UPDATE`, [context.actor.id, asset.digest]))[0];
        if (previous) {
          if (timestamp(previous.created_at) > now) fail("MEDIA_NOT_FOUND");
          await connection.query("UPDATE media_storage_objects SET state = 'cleanup_pending', updated_at = ? WHERE id = ?", [sqlDate(now), asset.id]);
          return { asset: rawAsset(previous), duplicate: true };
        }
        await connection.query(`INSERT INTO media_assets (id, owner_id, owner_role, storage_key, content_digest, active_digest,
          width, height, thumbnail_width, thumbnail_height, full_bytes, thumbnail_bytes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [asset.id, context.actor.id, role, asset.storageKey, asset.digest, asset.digest,
          asset.width, asset.height, asset.thumbnailWidth, asset.thumbnailHeight, asset.fullBytes, asset.thumbnailBytes, sqlDate(now)]);
        await connection.query("UPDATE media_storage_objects SET state = 'registered', asset_id = ?, updated_at = ? WHERE id = ?", [asset.id, sqlDate(now), asset.id]);
        const row = (await connection.query(`SELECT ${assetProjection} FROM media_assets a WHERE a.id = ?`, [asset.id]))[0];
        return { asset: rawAsset(row), duplicate: false };
      });
    },

    async listAssets({ role, tokenHash, now, conversationId = null, afterId = null, limit = 50 }) {
      integer(limit, 100); if (conversationId !== null) bytes(conversationId, 16); if (afterId !== null) bytes(afterId, 16);
      return withContext({ role, tokenHash, now, conversationId }, async (connection, context) => {
        const shared = conversationId === null ? "0" : `EXISTS (SELECT 1 FROM message_media mm JOIN messages m ON m.id = mm.message_id AND m.conversation_id = mm.conversation_id
          WHERE mm.media_id = a.id AND mm.conversation_id = ? AND m.deleted_at IS NULL)`;
        const rows = await connection.query(`SELECT ${assetProjection}, ${shared} AS shared_here FROM media_assets a
          WHERE a.owner_id = ? AND a.deleted_at IS NULL AND a.created_at <= ? ${afterId === null ? "" : "AND a.id > ?"} ORDER BY a.id ASC LIMIT ?`,
        [...(conversationId === null ? [] : [conversationId]), context.actor.id, sqlDate(now), ...(afterId === null ? [] : [afterId]), limit + 1]);
        const selected = rows.slice(0, limit), hasMore = rows.length > limit;
        return { assets: selected.map((row) => rawAsset(row, Boolean(Number(row.shared_here)))), nextCursor: hasMore ? selected.at(-1).id : null, hasMore };
      });
    },

    async getOwnedAsset({ role, tokenHash, now, assetId }) {
      bytes(assetId, 16);
      return chatStore.withActor({ role, tokenHash, now }, async (connection, context) => rawAsset(await owned(connection, context, assetId)));
    },

    async deleteAsset({ role, tokenHash, now, assetId }) {
      bytes(assetId, 16);
      return chatStore.withActor({ role, tokenHash, now }, async (connection, context) => {
        await lockMediaCapacity(connection, capacity);
        const object = await allocation(connection, assetId);
        const row = await owned(connection, context, assetId, true);
        if (!matches(object, context, rawAsset(row)) || !object.asset_id?.equals(row.id)) fail("MEDIA_DATABASE_STATE");
        if (row.deleted_at !== null) {
          if (!["cleanup_pending", "released"].includes(object.state)) fail("MEDIA_DATABASE_STATE");
          return rawAsset(row);
        }
        if (object.state !== "registered") fail("MEDIA_DATABASE_STATE");
        // The owner account lock serializes every owner send/delete. Avoid
        // locking arbitrary recipient conversations after the asset lock.
        const references = await connection.query(`SELECT 1 FROM message_media mm JOIN messages m
          ON m.id = mm.message_id AND m.conversation_id = mm.conversation_id WHERE mm.media_id = ? AND m.deleted_at IS NULL LIMIT 1`, [assetId]);
        if (references.length) fail("MEDIA_IN_USE");
        const avatars = await connection.query("SELECT 1 FROM user_profiles WHERE avatar_media_id = ? LIMIT 1", [assetId]);
        if (avatars.length) fail("MEDIA_IN_USE");
        await connection.query("UPDATE media_assets SET deleted_at = ?, active_digest = NULL WHERE id = ?", [sqlDate(now), assetId]);
        await connection.query("UPDATE media_storage_objects SET state = 'cleanup_pending', updated_at = ? WHERE id = ?", [sqlDate(now), object.id]);
        return rawAsset({ ...row, deleted_at: sqlDate(now) });
      });
    },

    async releaseStorageObject({ role, tokenHash, now, objectId, storageKey }) {
      bytes(objectId, 16); bytes(storageKey, 32);
      return chatStore.withActor({ role, tokenHash, now }, async (connection, context) => {
        const { heldBytes } = await lockMediaCapacity(connection, capacity);
        const object = await allocation(connection, objectId);
        if (!object || !object.owner_id.equals(context.actor.id) || object.owner_role !== role || !object.storage_key.equals(storageKey)) fail("MEDIA_NOT_FOUND");
        if (object.state === "released") return { released: true };
        if (object.state !== "cleanup_pending" || timestamp(object.updated_at) > now) input();
        const storedBytes = Number(object.stored_bytes);
        if (!Number.isSafeInteger(storedBytes) || storedBytes < 1 || heldBytes < storedBytes) state();
        await connection.query("UPDATE media_storage_objects SET state = 'released', updated_at = ?, released_at = ? WHERE id = ? AND state = 'cleanup_pending'", [sqlDate(now), sqlDate(now), objectId]);
        await connection.query("UPDATE media_storage_state SET held_bytes = held_bytes - ? WHERE id = 1", [storedBytes]);
        return { released: true };
      });
    },

    async getMessageAsset({ role, tokenHash, now, conversationId, messageId }) {
      bytes(messageId, 16);
      return chatStore.withConversation({ role, tokenHash, now, conversationId }, async (connection, context) => {
        const message = (await connection.query("SELECT id, sender_id, created_at, deleted_at FROM messages WHERE conversation_id = ? AND id = ? FOR UPDATE", [conversationId, messageId]))[0];
        if (!message || message.deleted_at !== null || timestamp(message.created_at) > now) fail("MEDIA_NOT_FOUND");
        const row = (await connection.query(`SELECT ${assetProjection} FROM message_media mm JOIN media_assets a ON a.id = mm.media_id
          WHERE mm.conversation_id = ? AND mm.message_id = ? FOR UPDATE`, [conversationId, messageId]))[0];
        if (!row || row.deleted_at !== null || !row.owner_id.equals(message.sender_id) || timestamp(row.created_at) > context.now) fail("MEDIA_NOT_FOUND");
        return rawAsset(row, true);
      });
    },

    async gallery({ role, tokenHash, now, conversationId, before = null, after = null, from = null, until = null, limit = 50 }) {
      integer(limit, 100); if (before !== null) sequence(before);
      if (after !== null) { sequence(after); if (before !== null || limit !== 1) input(); }
      if (from !== null) instant(from); if (until !== null) instant(until);
      if (from !== null && until !== null && from >= until) input();
      return chatStore.withConversation({ role, tokenHash, now, conversationId }, async (connection) => {
        const cursor = before ?? after;
        // Keep the cursor tuple at SQL's six-decimal precision. The public
        // cursor remains its sequence; converting this date through JS would
        // omit/repeat historical photos within the same millisecond.
        const pivot = cursor === null ? null : (await connection.query("SELECT id, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS cursor_created_at FROM messages WHERE conversation_id = ? AND sequence_no = ? AND created_at <= ?", [conversationId, cursor, sqlDate(now)]))[0];
        if (cursor !== null && !pivot) fail("MEDIA_NOT_FOUND");
        const sign = after === null ? "<" : ">";
        const rows = await connection.query(`SELECT ${assetProjection}, m.id AS delivered_message_id, m.sequence_no, m.sender_id,
          m.created_at AS delivered_at FROM messages m JOIN message_media mm ON mm.conversation_id = m.conversation_id AND mm.message_id = m.id
          JOIN media_assets a ON a.id = mm.media_id AND a.owner_id = m.sender_id WHERE m.conversation_id = ?
          AND m.deleted_at IS NULL AND a.deleted_at IS NULL AND m.created_at <= ? AND a.created_at <= ?
          ${pivot === null ? "" : `AND (m.created_at ${sign} ? OR (m.created_at = ? AND m.id ${sign} ?))`}
          ${from === null ? "" : "AND m.created_at >= ?"} ${until === null ? "" : "AND m.created_at < ?"}
          ORDER BY m.created_at ${after === null ? "DESC" : "ASC"}, m.id ${after === null ? "DESC" : "ASC"} LIMIT ?`, [conversationId, sqlDate(now), sqlDate(now), ...(pivot === null ? [] : [pivot.cursor_created_at, pivot.cursor_created_at, pivot.id]), ...(from === null ? [] : [sqlDate(from)]), ...(until === null ? [] : [sqlDate(until)]), after === null ? limit + 1 : 1]);
        const selected = rows.slice(0, limit), hasMore = after === null && rows.length > limit;
        return { items: selected.map((row) => ({ messageId: row.delivered_message_id, sequence: storedSequence(row.sequence_no), senderId: row.sender_id,
          createdAt: timestamp(row.delivered_at), asset: rawAsset(row, true) })), nextBefore: hasMore ? storedSequence(selected.at(-1).sequence_no) : null, hasMore };
      });
    },
  });
}
