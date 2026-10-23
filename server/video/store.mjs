import { ChatStoreError } from "../chat/store.mjs";
import { migrationStatus } from "../db/migrations.mjs";
import { loadVideoMigrations } from "./migrations.mjs";
import { MAX_VIDEO_BYTES, videoStoredBytes } from "./storage.mjs";
import { BackupMediaAdmissionError, fitsBackupMediaAdmission, lockBackupMediaAdmission } from "../media/backup-admission.mjs";

export class VideoStoreError extends ChatStoreError {
  constructor(code) { super(code, "Private video persistence could not be completed."); this.name = "VideoStoreError"; }
}
const fail = (code) => { throw new VideoStoreError(code); };
const input = () => fail("VIDEO_INPUT");
const state = () => fail("VIDEO_DATABASE_STATE");
const sized = (value, size) => Buffer.isBuffer(value) && value.length === size;
const bytes = (value, size) => { if (!sized(value, size)) input(); return value; };
const instant = (value) => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) input(); return value; };
const sqlDate = (value) => new Date(instant(value)).toISOString().replace("T", " ").replace("Z", "000");
const count = (value) => {
  if (!["string", "number", "bigint"].includes(typeof value) || typeof value === "string" && !/^(?:0|[1-9][0-9]*)$/.test(value)) state();
  const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) state(); return result;
};
const requestRole = (value) => { if (!["admin", "client"].includes(value)) input(); return value; };
const COLUMNS = "id, owner_id, owner_role, storage_key, reserve_token_hash, content_digest, bytes, stored_bytes, mime, state, created_at, updated_at, released_at";

function timestamp(value) {
  if (value instanceof Date) {
    const millis = value.getTime();
    if (!Number.isSafeInteger(millis) || millis < 0 || millis > 253402300799999) state();
    return { text: sqlDate(millis), millis };
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) state();
  const [seconds, fraction = ""] = value.split("."), text = seconds + "." + fraction.padEnd(6, "0");
  const iso = text.slice(0, 23).replace(" ", "T") + "Z", millis = Date.parse(iso);
  if (!Number.isSafeInteger(millis) || millis < 0 || millis > 253402300799999 || new Date(millis).toISOString() !== iso) state();
  return { text, millis };
}

// Local to the two candidate tables: historical schema parsers retain their
// original restricted grammar. Preserve arithmetic and AND/OR precedence when
// MariaDB rewrites redundant parentheses or integer-division keyword casing.
function checkTree(expression) {
  const tokens = [], pattern = /\s+|`([a-z_][a-z0-9_]*)`|'(?:''|[^'])*'|>=|<=|<>|!=|[=<>(),+*\/-]|[0-9]+|[a-z_][a-z0-9_]*/iy;
  let offset = 0;
  while (offset < expression.length) {
    pattern.lastIndex = offset; const match = pattern.exec(expression); if (!match) state(); offset = pattern.lastIndex;
    if (!/^\s+$/.test(match[0])) tokens.push(match[1] ?? (match[0].startsWith("'") ? match[0] : match[0].toLowerCase()));
  }
  let position = 0;
  const take = (expected) => { if (tokens[position++] !== expected) state(); };
  function atom() {
    if (tokens[position] === "(") { position++; const value = add(); take(")"); return value; }
    const token = tokens[position++];
    if (!token || !/^(?:[a-z_][a-z0-9_]*|[0-9]+|'(?:''|[^'])*')$/.test(token)) state();
    if (tokens[position] === "(") {
      position++; if (!["octet_length", "char_length"].includes(token)) state(); const value = add(); take(")"); return ["call", token, value];
    }
    return ["value", token];
  }
  function multiply() {
    let value = atom();
    while (["*", "div", "/"].includes(tokens[position])) { const operator = tokens[position++]; value = [operator, value, atom()]; }
    return value;
  }
  function add() {
    let value = multiply();
    while (["+", "-"].includes(tokens[position])) { const operator = tokens[position++]; value = [operator, value, multiply()]; }
    return value;
  }
  function predicate() {
    if (tokens[position] === "(") {
      const start = position;
      try { position++; const value = or(); take(")"); return value; }
      catch { position = start; }
    }
    const left = add(), operator = tokens[position++];
    if (["=", "<>", "!=", ">", "<", ">=", "<="].includes(operator)) return [operator === "!=" ? "<>" : operator, left, add()];
    if (operator === "is") { const negative = tokens[position] === "not"; if (negative) position++; take("null"); return [negative ? "is-not-null" : "is-null", left]; }
    if (operator === "between") { const low = add(); take("and"); return ["between", left, low, add()]; }
    if (operator === "in") { take("("); const values = [add()]; while (tokens[position] === ",") { position++; values.push(add()); } take(")"); return ["in", left, ...values]; }
    state();
  }
  const combine = (name, children) => children.length === 1 ? children[0] : [name, ...children.flatMap((child) => child[0] === name ? child.slice(1) : [child])];
  function and() { const values = [predicate()]; while (tokens[position] === "and") { position++; values.push(predicate()); } return combine("and", values); }
  function or() { const values = [and()]; while (tokens[position] === "or") { position++; values.push(and()); } return combine("or", values); }
  const result = or(); if (position !== tokens.length) state(); return JSON.stringify(result);
}
function authoredChecks(sql) {
  const result = [], pattern = /CONSTRAINT\s+([a-z_][a-z0-9_]*)\s+CHECK\s*\(/ig;
  let match;
  while ((match = pattern.exec(sql))) {
    const start = pattern.lastIndex; let depth = 1, position = start;
    for (; position < sql.length; position++) { if (sql[position] === "(") depth++; if (sql[position] === ")" && --depth === 0) break; }
    if (depth !== 0) state(); result.push([match[1], sql.slice(start, position)]); pattern.lastIndex = position + 1;
  }
  return result;
}
const definitions = {
  video_storage_state: { id: ["tinyint", false], owner_bytes: ["bigint", false], total_bytes: ["bigint", false],
    root_fingerprint: ["varbinary", false, 32], held_bytes: ["bigint", false], initialized_at: ["datetime", false] },
  video_assets: { id: ["varbinary", false, 16], owner_id: ["varbinary", false, 16], owner_role: ["varchar", false, 8],
    storage_key: ["varbinary", false, 32], reserve_token_hash: ["varbinary", false, 32], content_digest: ["varbinary", true, 32],
    bytes: ["int", false], stored_bytes: ["int", false], mime: ["varchar", false, 16], state: ["varchar", false, 16],
    created_at: ["datetime", false], updated_at: ["datetime", false], released_at: ["datetime", true] },
};
const indexes = {
  video_storage_state: { PRIMARY: [0, "id"] },
  video_assets: { PRIMARY: [0, "id"], video_assets_storage: [0, "storage_key"],
    video_assets_owner_state: [1, "owner_id", "state", "id"], video_assets_state: [1, "state", "id"], video_assets_owner_fk: [1, "owner_id", "owner_role"] },
};

/** Candidate catalog only. No runtime uses this adapter before the complete
 * lot-7 lifecycle is qualified. Its video quota/root is independent of photos. */
export function createVideoStore({ pool, chatStore, capacity, experience = false } = {}) {
  if (typeof pool?.getConnection !== "function" || typeof chatStore?.withActor !== "function"
    || typeof experience !== "boolean" || !capacity || !Number.isSafeInteger(capacity.ownerBytes) || capacity.ownerBytes < 1
    || !Number.isSafeInteger(capacity.totalBytes) || capacity.totalBytes < capacity.ownerBytes || !sized(capacity.rootFingerprint, 32)) input();
  capacity = Object.freeze({ ownerBytes: capacity.ownerBytes, totalBytes: capacity.totalBytes, rootFingerprint: Buffer.from(capacity.rootFingerprint) });
  const publicStatus = (ready, heldBytes = 0, pendingBytes = 0) => ({ ready, heldBytes, pendingBytes,
    ownerBytes: capacity.ownerBytes, totalBytes: capacity.totalBytes, rootFingerprint: Buffer.from(capacity.rootFingerprint) });
  function request(value) { requestRole(value?.role); bytes(value.tokenHash, 32); instant(value.now); return value; }
  function asset(value, digest = false) {
    bytes(value?.id, 16); bytes(value.storageKey, 32);
    if (!Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_VIDEO_BYTES
      || value.storedBytes !== videoStoredBytes(value.bytes) || value.mime !== "video/mp4") input();
    if (digest) bytes(value.digest, 32);
    return value;
  }
  async function run(operation, transaction = true, borrowed = null) {
    let connection = borrowed, begun = false;
    try {
      if (connection === null) connection = await pool.getConnection();
      if (transaction) { await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED"); await connection.beginTransaction(); begun = true; }
      const result = await operation(connection);
      if (begun) await connection.commit();
      return result;
    } catch (error) {
      if (begun) { try { await connection.rollback(); } catch {} }
      if (error instanceof ChatStoreError) throw error;
      fail("VIDEO_DATABASE_OPERATION");
    } finally { if (connection && borrowed === null) { try { await connection.release(); } catch {} } }
  }
  async function lockCapacity(connection) {
    const row = (await connection.query("SELECT owner_bytes, total_bytes, root_fingerprint, held_bytes FROM video_storage_state WHERE id = 1 FOR UPDATE"))[0];
    if (!row || count(row.owner_bytes) !== capacity.ownerBytes || count(row.total_bytes) !== capacity.totalBytes
      || !sized(row.root_fingerprint, 32) || !row.root_fingerprint.equals(capacity.rootFingerprint)) fail("VIDEO_CAPACITY_UNAVAILABLE");
    const heldBytes = count(row.held_bytes); if (heldBytes > capacity.totalBytes) state(); return heldBytes;
  }
  async function snapshot(connection) {
    const heldBytes = await lockCapacity(connection);
    const totals = (await connection.query(`SELECT COALESCE(SUM(stored_bytes), 0) AS held,
      COALESCE(SUM(CASE WHEN state = 'reserved' THEN stored_bytes ELSE 0 END), 0) AS pending
      FROM video_assets WHERE state <> 'released' FOR UPDATE`))[0];
    const actual = count(totals.held), pendingBytes = count(totals.pending);
    if (actual !== heldBytes || pendingBytes > heldBytes) state();
    return publicStatus(true, heldBytes, pendingBytes);
  }
  async function allocation(connection, id) { return (await connection.query(`SELECT ${COLUMNS} FROM video_assets WHERE id = ? FOR UPDATE`, [id]))[0]; }
  function validateRow(row, now) {
    if (!row || !sized(row.id, 16) || !sized(row.owner_id, 16) || !["admin", "client"].includes(row.owner_role)
      || !sized(row.storage_key, 32) || !sized(row.reserve_token_hash, 32) || row.content_digest !== null && !sized(row.content_digest, 32)
      || !["reserved", "committed", "cleanup_pending", "released"].includes(row.state) || row.mime !== "video/mp4") state();
    const rawBytes = count(row.bytes), storedBytes = count(row.stored_bytes);
    if (rawBytes < 1 || rawBytes > MAX_VIDEO_BYTES || storedBytes !== videoStoredBytes(rawBytes)) state();
    const created = timestamp(row.created_at), updated = timestamp(row.updated_at), released = row.released_at === null ? null : timestamp(row.released_at);
    if (updated.text < created.text || updated.text > sqlDate(now)
      || row.state === "reserved" && (row.content_digest !== null || released !== null)
      || row.state === "committed" && (!sized(row.content_digest, 32) || released !== null)
      || row.state === "cleanup_pending" && released !== null
      || row.state === "released" && (released === null || released.text < created.text || released.text > updated.text)) state();
    return { id: row.id, ownerId: row.owner_id, storageKey: row.storage_key, digest: row.content_digest,
      bytes: rawBytes, storedBytes, mime: row.mime, createdAt: created.millis,
      deletedAt: released?.millis ?? (row.state === "cleanup_pending" ? updated.millis : null) };
  }
  function owns(row, context) { return row && sized(row.owner_id, 16) && row.owner_id.equals(context.actor.id) && row.owner_role === context.actor.role; }
  function bound(row, value, tokenHash) {
    return row.storage_key.equals(value.storageKey) && row.reserve_token_hash.equals(tokenHash)
      && count(row.bytes) === value.bytes && count(row.stored_bytes) === value.storedBytes && row.mime === value.mime;
  }

  async function checkSchema(connection) {
    const database = (await connection.query("SELECT DATABASE() AS name"))[0]?.name;
    const enforcement = (await connection.query("SELECT @@SESSION.foreign_key_checks AS foreignKeys, @@SESSION.check_constraint_checks AS checkConstraints"))[0];
    if (Number(enforcement?.foreignKeys) !== 1 || Number(enforcement?.checkConstraints) !== 1) state();
    const migrations = experience ? await (await import("../experience/migrations.mjs")).loadExperienceMigrations() : await loadVideoMigrations();
    const history = await migrationStatus(connection, { database, migrations });
    if (history.length !== migrations.length || history.some((item) => item.state !== "applied")) state();
    const tables = await connection.query("SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_COLLATION AS collationName FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
    const columns = await connection.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType,
      IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS length, DATETIME_PRECISION AS precisionValue,
      COLUMN_TYPE AS columnType, COLLATION_NAME AS collationName, COLUMN_DEFAULT AS defaultValue
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`, [database]);
    for (const [table, fields] of Object.entries(definitions)) {
      if (!tables.some((item) => item.name === table && item.engine === "InnoDB" && item.collationName === "utf8mb4_unicode_ci")) state();
      const actual = columns.filter((item) => item.tableName === table);
      if (actual.length !== Object.keys(fields).length) state();
      for (const [name, [type, nullable, length]] of Object.entries(fields)) {
        const column = actual.find((item) => item.columnName === name);
        if (!column || column.dataType !== type || (column.nullable === "YES") !== nullable
          || length !== undefined && Number(column.length) !== length || type === "datetime" && Number(column.precisionValue) !== 6
          || ["tinyint", "int", "bigint"].includes(type) && !/unsigned/i.test(column.columnType)
          || type === "varchar" && column.collationName !== "ascii_bin") state();
        if (table === "video_assets" && name === "mime" && !["video/mp4", "'video/mp4'"].includes(column.defaultValue)) state();
      }
    }
    const keys = await connection.query(`SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, COLUMN_NAME AS columnName,
      NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS positionValue, SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?`, [database]);
    for (const [table, expected] of Object.entries(indexes)) {
      const actual = keys.filter((item) => item.tableName === table);
      if (new Set(actual.map((item) => item.indexName)).size !== Object.keys(expected).length) state();
      for (const [name, [nonUnique, ...names]] of Object.entries(expected)) {
        const parts = actual.filter((item) => item.indexName === name).sort((a, b) => Number(a.positionValue) - Number(b.positionValue));
        if (parts.length !== names.length || parts.some((item, index) => item.columnName !== names[index] || Number(item.nonUnique) !== nonUnique || item.prefixLength !== null)) state();
      }
    }
    const foreign = await connection.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, COLUMN_NAME AS columnName,
      REFERENCED_TABLE_SCHEMA AS parentSchema, REFERENCED_TABLE_NAME AS parentTable, REFERENCED_COLUMN_NAME AS parentColumn,
      ORDINAL_POSITION AS positionValue FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`, [database]);
    const selected = foreign.filter((item) => Object.hasOwn(definitions, item.tableName)).sort((a, b) => Number(a.positionValue) - Number(b.positionValue));
    const rules = await connection.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, UPDATE_RULE AS updateRule,
      DELETE_RULE AS deleteRule FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?`, [database]);
    if (selected.length !== 2 || selected.some((item, index) => item.tableName !== "video_assets" || item.name !== "video_assets_owner_fk"
      || item.parentSchema !== database || item.parentTable !== "users" || item.columnName !== ["owner_id", "owner_role"][index]
      || item.parentColumn !== ["id", "role"][index])
      || !rules.some((item) => item.tableName === "video_assets" && item.name === "video_assets_owner_fk" && item.updateRule === "RESTRICT" && item.deleteRule === "RESTRICT")) state();
    const checks = await connection.query("SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?", [database]);
    for (const [table, fields] of Object.entries(definitions)) {
      const migration = migrations.find((item) => new RegExp(`^CREATE\\s+TABLE\\s+${table}\\s*\\(`, "i").test(item.sql.trim()));
      if (!migration) state(); const expected = authoredChecks(migration.sql), actual = checks.filter((item) => item.tableName === table);
      if (actual.length !== expected.length) state();
      for (const [name, clause] of expected) {
        const current = actual.find((item) => item.name === name);
        if (!current || checkTree(current.clause) !== checkTree(clause)) state();
      }
      await connection.query(`SELECT ${Object.keys(fields).join(", ")} FROM ${table} WHERE 1 = 0`);
    }
    return true;
  }

  return Object.freeze({
    binding: Object.freeze({ rootFingerprint: capacity.rootFingerprint.toString("hex") }),
    async assertSchema(connection = null) {
      if (connection !== null && typeof connection?.query !== "function") input();
      return run(checkSchema, false, connection);
    },
    async initialize({ now, offline } = {}) {
      instant(now); if (offline !== true) input();
      return run(async (connection) => {
        const existing = (await connection.query("SELECT id FROM video_storage_state WHERE id = 1 FOR UPDATE"))[0];
        if (existing) return snapshot(connection);
        if (count((await connection.query("SELECT COUNT(*) AS value FROM video_assets FOR UPDATE"))[0].value) !== 0) state();
        await connection.query("INSERT INTO video_storage_state (id, owner_bytes, total_bytes, root_fingerprint, held_bytes, initialized_at) VALUES (1, ?, ?, ?, 0, ?)",
          [capacity.ownerBytes, capacity.totalBytes, capacity.rootFingerprint, sqlDate(now)]);
        return snapshot(connection);
      });
    },
    async status() {
      return run(async (connection) => {
        if (!(await connection.query("SELECT id FROM video_storage_state WHERE id = 1 FOR UPDATE")).length) {
          if (count((await connection.query("SELECT COUNT(*) AS value FROM video_assets FOR UPDATE"))[0].value) !== 0) state();
          return publicStatus(false);
        }
        return snapshot(connection);
      });
    },
    async reserve(value) {
      request(value); const proposed = asset(value.asset);
      return chatStore.withActor(value, async (connection, context) => {
        if (context.actor.role !== "admin") fail("VIDEO_ADMIN_ONLY");
        let backup;
        try { backup = await lockBackupMediaAdmission(connection, { video: true }); }
        catch (error) {
          if (error instanceof BackupMediaAdmissionError) fail(error.reason === "unavailable" ? "VIDEO_CAPACITY_UNAVAILABLE" : "VIDEO_DATABASE_STATE");
          throw error;
        }
        const { heldBytes } = await snapshot(connection), existing = await allocation(connection, proposed.id);
        if (existing) {
          if (!owns(existing, context)) fail("VIDEO_NOT_FOUND"); validateRow(existing, context.now);
          if (existing.state !== "reserved" || !bound(existing, proposed, value.tokenHash)) input();
        } else {
          const ownerHeld = count((await connection.query("SELECT COALESCE(SUM(stored_bytes), 0) AS value FROM video_assets WHERE owner_id = ? AND state <> 'released' FOR UPDATE", [context.actor.id]))[0].value);
          if (heldBytes > capacity.totalBytes - proposed.storedBytes || ownerHeld > capacity.ownerBytes - proposed.storedBytes
            || !fitsBackupMediaAdmission(backup, proposed.storedBytes, 1)) fail("VIDEO_STORAGE_LIMIT");
          const at = sqlDate(context.now);
          await connection.query(`INSERT INTO video_assets (id, owner_id, owner_role, storage_key, reserve_token_hash,
            bytes, stored_bytes, mime, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`,
          [proposed.id, context.actor.id, context.actor.role, proposed.storageKey, value.tokenHash, proposed.bytes, proposed.storedBytes, proposed.mime, at, at]);
          await connection.query("UPDATE video_storage_state SET held_bytes = held_bytes + ? WHERE id = 1", [proposed.storedBytes]);
        }
        const pendingBytes = count((await connection.query("SELECT COALESCE(SUM(stored_bytes), 0) AS value FROM video_assets WHERE state = 'reserved' FOR UPDATE"))[0].value);
        if (pendingBytes < proposed.storedBytes) state();
        return { reservation: { id: proposed.id, ownerId: context.actor.id, storageKey: proposed.storageKey,
          bytes: proposed.bytes, storedBytes: proposed.storedBytes, pendingBytes } };
      });
    },
    async commit(value) {
      request(value); const proposed = asset(value.asset, true);
      return chatStore.withActor(value, async (connection, context) => {
        if (context.actor.role !== "admin") fail("VIDEO_ADMIN_ONLY");
        await snapshot(connection); const row = await allocation(connection, proposed.id);
        if (!owns(row, context)) fail("VIDEO_NOT_FOUND"); validateRow(row, context.now);
        if (!bound(row, proposed, value.tokenHash) || !["reserved", "committed"].includes(row.state)) input();
        if (row.state === "committed") {
          if (!row.content_digest.equals(proposed.digest)) input();
        } else {
          await connection.query("UPDATE video_assets SET state = 'committed', content_digest = ?, updated_at = ? WHERE id = ? AND state = 'reserved'", [proposed.digest, sqlDate(context.now), proposed.id]);
        }
        return { asset: validateRow(await allocation(connection, proposed.id), context.now) };
      });
    },
    async getOwned(value) {
      request(value); bytes(value.assetId, 16);
      return chatStore.withActor(value, async (connection, context) => {
        await lockCapacity(connection);
        const row = await allocation(connection, value.assetId);
        if (!owns(row, context)) fail("VIDEO_NOT_FOUND"); const result = validateRow(row, context.now);
        if (row.state !== "committed") fail("VIDEO_NOT_FOUND"); return result;
      });
    },
    async listOwned(value) {
      request(value);
      const afterId = value.afterId ?? null, limit = value.limit ?? 20;
      if (afterId !== null) bytes(afterId, 16);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) input();
      return chatStore.withActor(value, async (connection, context) => {
        await lockCapacity(connection);
        // Cleanup intents remain visible so a known owner can finish a
        // previously interrupted unlink. Reserved uploads are never exposed
        // to this operation while a producer may still publish their files.
        const rows = await connection.query(`SELECT ${COLUMNS} FROM video_assets
          WHERE owner_id = ? AND owner_role = ? AND state IN ('committed', 'cleanup_pending')
          ${afterId === null ? "" : "AND id > ?"} ORDER BY id ASC LIMIT ? FOR UPDATE`,
        [context.actor.id, context.actor.role, ...(afterId === null ? [] : [afterId]), limit + 1]);
        const selected = rows.slice(0, limit), hasMore = rows.length > limit;
        return { assets: selected.map(row => validateRow(row, context.now)),
          nextCursor: hasMore ? selected.at(-1).id : null, hasMore };
      });
    },
    // Trusted message adapter only, inside its currently authorized chat
    // transaction. This helper grants no session or conversation authority.
    async getCommittedAsset(connection, { assetId, ownerId, ownerRole, now } = {}) {
      if (typeof connection?.query !== "function") input();
      bytes(assetId, 16); bytes(ownerId, 16); requestRole(ownerRole); instant(now);
      await lockCapacity(connection);
      const row = await allocation(connection, assetId);
      if (!row || !sized(row.owner_id, 16) || !row.owner_id.equals(ownerId) || row.owner_role !== ownerRole) fail("VIDEO_NOT_FOUND");
      const result = validateRow(row, now);
      if (row.state !== "committed") fail("VIDEO_NOT_FOUND");
      return result;
    },
    async deleteAsset(value) {
      request(value); bytes(value.assetId, 16);
      return chatStore.withActor(value, async (connection, context) => {
        await snapshot(connection); const row = await allocation(connection, value.assetId);
        if (!owns(row, context)) fail("VIDEO_NOT_FOUND");
        const result = validateRow(row, context.now);
        // An admitted upload may still be publishing its reserved file. Only
        // the quiesced account-closure adapter can erase that state.
        if (row.state === "reserved" || !sized(row.content_digest, 32)) input();
        if (["cleanup_pending", "released"].includes(row.state)) return result;
        // The owner lock serializes sends with this transition. Lock no other
        // recipient conversation after the asset/capacity locks.
        const references = await connection.query(`SELECT 1 FROM message_video mv JOIN messages m
          ON m.id = mv.message_id AND m.conversation_id = mv.conversation_id
          WHERE mv.video_id = ? AND m.deleted_at IS NULL LIMIT 1`, [value.assetId]);
        if (references.length) fail("VIDEO_IN_USE");
        if (context.actor.role === "admin") {
          // The encrypted campaign payload is intentionally opaque here.
          // Conservatively retain all originals while this owner's queue is
          // active. Creation, cancellation and workers hold the same admin
          // account lock first; this current READ COMMITTED lookup adds no
          // campaign/recipient lock after the storage lock.
          const campaigns = await connection.query(`SELECT 1 FROM broadcast_campaigns FORCE INDEX (broadcast_campaigns_owner_page)
            WHERE admin_id = ? AND status IN ('queued', 'running') LIMIT 1`, [context.actor.id]);
          if (campaigns.length) fail("VIDEO_IN_USE");
        }
        const at = sqlDate(context.now);
        await connection.query("UPDATE video_assets SET state = 'cleanup_pending', updated_at = ? WHERE id = ? AND state = 'committed'", [at, value.assetId]);
        return validateRow({ ...row, state: "cleanup_pending", updated_at: at }, context.now);
      });
    },
    // Trusted lifecycle call: the service must positively confirm removal
    // from this bound storage root before requesting this state transition.
    async releaseDeletedStorage(value) {
      request(value); bytes(value.assetId, 16); bytes(value.storageKey, 32);
      return chatStore.withActor(value, async (connection, context) => {
        const { heldBytes } = await snapshot(connection), row = await allocation(connection, value.assetId);
        if (!owns(row, context) || !sized(row.storage_key, 32) || !row.storage_key.equals(value.storageKey)) fail("VIDEO_NOT_FOUND");
        validateRow(row, context.now);
        if (row.state === "released") return { released: true };
        if (row.state !== "cleanup_pending") input();
        const held = count(row.stored_bytes); if (heldBytes < held) state();
        const at = sqlDate(context.now);
        await connection.query("UPDATE video_assets SET state = 'released', updated_at = ?, released_at = ? WHERE id = ? AND state = 'cleanup_pending'", [at, at, value.assetId]);
        await connection.query("UPDATE video_storage_state SET held_bytes = held_bytes - ? WHERE id = 1", [held]);
        return { released: true };
      });
    },
    async release(value) {
      request(value); bytes(value.assetId, 16); bytes(value.storageKey, 32);
      // Trusted cleanup only: the caller has either never begun writing or has
      // positive published=false + cleanupConfirmed=true storage evidence. A
      // revoked/expired session must not prevent refunding that exact charge.
      // This is not a public operation and grants no read or commit authority.
      return run(async (connection) => {
        const { heldBytes } = await snapshot(connection), row = await allocation(connection, value.assetId);
        if (!row || row.owner_role !== value.role || !sized(row.reserve_token_hash, 32) || !row.reserve_token_hash.equals(value.tokenHash)
          || !sized(row.storage_key, 32) || !row.storage_key.equals(value.storageKey)) fail("VIDEO_NOT_FOUND");
        validateRow(row, value.now);
        if (row.state === "released") {
          if (row.content_digest !== null) input();
          return { released: true };
        }
        if (row.state !== "reserved") input();
        const held = count(row.stored_bytes); if (heldBytes < held) state();
        const at = sqlDate(value.now);
        await connection.query("UPDATE video_assets SET state = 'released', updated_at = ?, released_at = ? WHERE id = ? AND state = 'reserved'", [at, at, value.assetId]);
        await connection.query("UPDATE video_storage_state SET held_bytes = held_bytes - ? WHERE id = 1", [held]);
        return { released: true };
      });
    },
  });
}
