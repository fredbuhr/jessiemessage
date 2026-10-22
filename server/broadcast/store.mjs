import { manuallyAdmittedClient, invitationConsumptionProjection } from "../access/admission.mjs";
import { createSessionClock } from "../auth/session-policy.mjs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { ChatStoreError } from "../chat/store.mjs";
import { migrationStatus, MigrationError } from "../db/migrations.mjs";
import { loadStoreMigrations } from "../db/store-migrations.mjs";
import { createAudienceDigest, openPayload, campaignFingerprint } from "./crypto.mjs";
import { validateAudience } from "./validation.mjs";

export class BroadcastStoreError extends ChatStoreError {
  constructor(code = "BROADCAST_DATABASE_OPERATION") {
    super(code, "Private broadcast persistence could not be completed.");
    this.name = "BroadcastStoreError";
  }
}
const fail = (code) => { throw new BroadcastStoreError(code); };
const input = () => fail("BROADCAST_INPUT"), state = () => fail("BROADCAST_DATABASE_STATE");
const bytes = (value, length = 16) => { if (!Buffer.isBuffer(value) || value.length !== length) input(); return value; };
const instant = (value) => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) input(); return value; };
const sqlDate = (value) => new Date(instant(value)).toISOString().replace("T", " ").replace("Z", "000");
const timestamp = (value) => {
  if (value instanceof Date && Number.isSafeInteger(value.getTime()) && value.getTime() >= 0) return value.getTime();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) state();
  const result = Date.parse(`${value.replace(" ", "T")}Z`); if (!Number.isSafeInteger(result) || result < 0) state(); return result;
};
const nullableDate = (value) => value === null ? null : timestamp(value);
const count = (value) => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) state(); return result; };
const uint32 = (value) => { if (!Number.isSafeInteger(value) || value < 1 || value > 4294967295) input(); return value; };
const activeClient = (user, now) => manuallyAdmittedClient(user, now, timestamp);
const live = (campaign) => ["queued", "running"].includes(campaign.status);
const placeholders = (values) => values.map(() => "?").join(", ");
const ids = (values) => {
  if (!Array.isArray(values) || values.length < 1 || values.length > 100) input();
  for (const value of values) bytes(value);
  if (new Set(values.map((value) => value.toString("hex"))).size !== values.length) input();
  return [...values].sort(Buffer.compare);
};
const request = (value) => { bytes(value.tokenHash, 32); instant(value.now); };
const storedCandidateId = (value) => { if (!Buffer.isBuffer(value) || value.length !== 16) state(); return value.toString("hex"); };
async function run(pool, operation) {
  let connection;
  try { connection = await pool.getConnection(); return await operation(connection); }
  catch (error) { if (error instanceof ChatStoreError) throw error; if (error instanceof MigrationError) state(); fail("BROADCAST_DATABASE_OPERATION"); }
  finally { if (connection) { try { connection.release(); } catch {} } }
}

// Compare the parsed semantics of the authored CHECK expressions. MariaDB adds
// redundant parentheses and backticks when returning CHECK_CLAUSE metadata.
function checkTree(expression) {
  const tokens = [], pattern = /\s+|`([a-z_][a-z0-9_]*)`|'(?:''|[^'])*'|>=|<=|<>|!=|[=<>(),+]|[0-9]+|[a-z_][a-z0-9_]*/iy;
  let offset = 0;
  while (offset < expression.length) {
    pattern.lastIndex = offset; const match = pattern.exec(expression); if (!match) state(); offset = pattern.lastIndex;
    if (!/^\s+$/.test(match[0])) tokens.push(match[1] ?? (match[0].startsWith("'") ? match[0] : match[0].toLowerCase()));
  }
  let position = 0;
  const take = (expected) => { if (tokens[position++] !== expected) state(); };
  function operand() {
    const token = tokens[position++]; if (!token || !/^(?:[a-z_][a-z0-9_]*|[0-9]+|'(?:''|[^'])*')$/i.test(token)) state();
    let result = ["value", token];
    if (tokens[position] === "(") { position++; if (!["octet_length", "char_length"].includes(token)) state(); const argument = operand(); take(")"); result = ["call", token, argument]; }
    if (tokens[position] === "+") { position++; take("interval"); const amount = tokens[position++]; if (!/^[0-9]+$/.test(amount ?? "")) state(); take("minute"); result = ["add-interval-minute", result, amount]; }
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
  const pattern = /CONSTRAINT\s+([a-z_][a-z0-9_]*)\s+CHECK\s*\(/ig, result = []; let match;
  while ((match = pattern.exec(sql))) {
    const start = pattern.lastIndex; let depth = 1, position = start;
    for (; position < sql.length; position++) { if (sql[position] === "(") depth++; if (sql[position] === ")" && --depth === 0) break; }
    if (depth !== 0) state(); result.push([match[1], sql.slice(start, position)]); pattern.lastIndex = position + 1;
  }
  return result;
}
const columns = {
  broadcast_preferences: {
    user_id: ["varbinary", false, 16],
    enabled: ["tinyint", false],
    version: ["bigint", false],
    created_at: ["datetime", false],
    updated_at: ["datetime", false],
  },
  broadcast_campaigns: {
    id: ["varbinary", false, 16],
    admin_id: ["varbinary", false, 16],
    admin_role: ["varchar", false, 8, "ascii_bin"],
    client_campaign_id: ["varbinary", false, 16],
    mfa_version: ["int", false],
    payload_encrypted: ["varchar", false, 32000, "ascii_bin"],
    request_fingerprint: ["varbinary", false, 32],
    media_id: ["varbinary", true, 16],
    allow_repeat_media: ["tinyint", false],
    status: ["varchar", false, 16, "ascii_bin"],
    created_at: ["datetime", false],
    updated_at: ["datetime", false],
    expires_at: ["datetime", false],
  },
  broadcast_recipients: {
    campaign_id: ["varbinary", false, 16],
    conversation_id: ["varbinary", false, 16],
    client_id: ["varbinary", false, 16],
    proposed_message_id: ["varbinary", false, 16],
    client_message_id: ["varbinary", false, 16],
    delivered_message_id: ["varbinary", true, 16],
    state: ["varchar", false, 16, "ascii_bin"],
    reason: ["varchar", true, 32, "ascii_bin"],
    attempts: ["smallint", false],
    available_at: ["datetime", false],
    created_at: ["datetime", false],
    lease_token: ["varbinary", true, 16],
    lease_until: ["datetime", true],
    delivered_at: ["datetime", true],
  },
};
const indexes = {
  broadcast_preferences: {
    PRIMARY: [0, "user_id"],
  },
  broadcast_campaigns: {
    PRIMARY: [0, "id"],
    broadcast_campaigns_idempotency: [0, "admin_id", "client_campaign_id"],
    broadcast_campaigns_owner_page: [1, "admin_id", "id"],
    broadcast_campaigns_ready: [1, "status", "created_at", "id"],
    broadcast_campaigns_media: [1, "media_id"],
  },
  broadcast_recipients: {
    PRIMARY: [0, "campaign_id", "conversation_id"],
    broadcast_recipients_message: [0, "proposed_message_id"],
    broadcast_recipients_client_message: [0, "client_message_id"],
    broadcast_recipients_ready: [1, "state", "available_at", "campaign_id"],
    broadcast_recipients_lease: [1, "state", "lease_until"],
    broadcast_recipients_client: [1, "client_id"],
    broadcast_recipients_delivered: [1, "conversation_id", "delivered_message_id"],
  },
};
const foreignKeys = [
  ["broadcast_preferences", "broadcast_preferences_user_fk", "client_auth_state", ["user_id"], ["user_id"]],
  ["broadcast_campaigns", "broadcast_campaigns_owner_fk", "users", ["admin_id", "admin_role"], ["id", "role"]],
  ["broadcast_campaigns", "broadcast_campaigns_media_fk", "media_assets", ["media_id"], ["id"]],
  ["broadcast_recipients", "broadcast_recipients_campaign_fk", "broadcast_campaigns", ["campaign_id"], ["id"]],
  ["broadcast_recipients", "broadcast_recipients_conversation_fk", "conversations", ["conversation_id"], ["id"]],
  ["broadcast_recipients", "broadcast_recipients_client_fk", "client_auth_state", ["client_id"], ["user_id"]],
  ["broadcast_recipients", "broadcast_recipients_delivered_fk", "messages", ["conversation_id", "delivered_message_id"], ["conversation_id", "id"]],
];

export async function assertBroadcastSchema(pool, options = {}) {
  if (!pool || typeof pool.getConnection !== "function") input();
  return run(pool, async (connection) => {
    const migrations = await loadStoreMigrations(options), database = (await connection.query("SELECT DATABASE() AS name"))[0].name;
    const status = await migrationStatus(connection, { database, migrations });
    if (migrations.length < 25 || status.some((item) => item.state !== "applied")) state();
    const enforcement = (await connection.query("SELECT @@SESSION.foreign_key_checks AS foreignKeys, @@SESSION.check_constraint_checks AS checkConstraints"))[0];
    if (Number(enforcement.foreignKeys) !== 1 || Number(enforcement.checkConstraints) !== 1) state();
    const tables = await connection.query("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
    const actualColumns = await connection.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType,
      IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS length, DATETIME_PRECISION AS precisionValue,
      COLUMN_TYPE AS columnType, COLLATION_NAME AS collationName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`, [database]);
    const actualIndexes = await connection.query(`SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, COLUMN_NAME AS columnName,
      NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS positionValue, SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?`, [database]);
    const actualKeys = await connection.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, COLUMN_NAME AS columnName,
      REFERENCED_TABLE_SCHEMA AS parentSchema, REFERENCED_TABLE_NAME AS parentTable, REFERENCED_COLUMN_NAME AS parentColumn, ORDINAL_POSITION AS positionValue
      FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`, [database]);
    const rules = await connection.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, UPDATE_RULE AS updateRule,
      DELETE_RULE AS deleteRule FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?`, [database]);
    const checks = await connection.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, CHECK_CLAUSE AS clause
      FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?`, [database]);
    for (const [table, definitions] of Object.entries(columns)) {
      if (!tables.some((item) => item.name === table && item.engine === "InnoDB")) state();
      for (const [name, [type, nullable, length, collation]] of Object.entries(definitions)) {
        const column = actualColumns.find((item) => item.tableName === table && item.columnName === name);
        if (!column || column.dataType !== type || (column.nullable === "YES") !== nullable
          || (length !== undefined && Number(column.length) !== length) || (collation && column.collationName !== collation)
          || (type === "datetime" && Number(column.precisionValue) !== 6)
          || (["int", "bigint", "smallint", "tinyint"].includes(type) && !column.columnType.toLowerCase().includes("unsigned"))) state();
      }
      for (const [name, [nonUnique, ...expected]] of Object.entries(indexes[table])) {
        const actual = actualIndexes.filter((item) => item.tableName === table && item.indexName === name).sort((a, b) => Number(a.positionValue) - Number(b.positionValue));
        if (actual.length !== expected.length || actual.some((item, index) => Number(item.nonUnique) !== nonUnique || item.columnName !== expected[index] || item.prefixLength !== null)) state();
      }
      const migration = migrations.find((item) => new RegExp(`^CREATE\\s+TABLE\\s+${table}\\s*\\(`, "i").test(item.sql.trim()));
      if (!migration) state();
      for (const [name, clause] of authoredChecks(migration.sql)) {
        const actual = checks.find((item) => item.tableName === table && item.constraintName === name);
        if (!actual || checkTree(actual.clause) !== checkTree(clause)) state();
      }
    }
    for (const [table, name, parent, children, parents] of foreignKeys) {
      const actual = actualKeys.filter((item) => item.tableName === table && item.constraintName === name).sort((a, b) => Number(a.positionValue) - Number(b.positionValue));
      if (actual.length !== children.length || actual.some((item, index) => item.parentSchema !== database || item.parentTable !== parent || item.columnName !== children[index] || item.parentColumn !== parents[index])
        || !rules.some((item) => item.tableName === table && item.constraintName === name && item.updateRule === "RESTRICT" && item.deleteRule === "RESTRICT")) state();
    }
    for (const [table, fields] of Object.entries(columns)) await connection.query(`SELECT ${Object.keys(fields).join(", ")} FROM ${table} WHERE 1 = 0`);
    return true;
  });
}

export function createBroadcastStore(pool, { chatStore, mediaEnabled = false, videoEnabled = false, videoCreationEnabled = true, key, videoStore, videoMessageStore, clock } = {}) {
  if (!pool || typeof pool.getConnection !== "function" || typeof mediaEnabled !== "boolean" || typeof videoEnabled !== "boolean" || typeof videoCreationEnabled !== "boolean" || videoEnabled && (!Buffer.isBuffer(key) || key.length !== 32 || typeof videoStore?.getCommittedAsset !== "function" || typeof videoMessageStore?.appendBroadcastVideo !== "function") || !chatStore
    || ["withActor", "withBroadcastDelivery"].some((name) => typeof chatStore[name] !== "function")) input();
  if (videoEnabled) key = Buffer.from(key);
  const readTime = createSessionClock(clock);
  const currentTime = (previous) => Math.max(instant(previous), readTime(previous));
  const withAdmin = (value, operation) => { request(value); return chatStore.withActor({ role: "admin", tokenHash: value.tokenHash, now: value.now }, operation); };
  async function campaignRow(connection, campaignId, adminId) {
    const row = (await connection.query("SELECT * FROM broadcast_campaigns WHERE id = ? AND admin_id = ? FOR UPDATE", [campaignId, adminId]))[0];
    if (!row) fail("BROADCAST_NOT_FOUND"); return row;
  }
  async function rawCampaign(connection, row) {
    const counts = { total: 0, pending: 0, sending: 0, delivered: 0, skipped: 0, cancelled: 0, failed: 0 };
    const grouped = await connection.query("SELECT state, COUNT(*) AS value FROM broadcast_recipients WHERE campaign_id = ? GROUP BY state", [row.id]);
    for (const item of grouped) { if (!Object.hasOwn(counts, item.state) || item.state === "total") state(); const value = count(item.value); counts[item.state] = value; counts.total += value; }
    if (!Number.isSafeInteger(counts.total) || counts.total < 1 || (!live(row) && counts.pending + counts.sending !== 0)) state();
    return { id: row.id, clientCampaignId: row.client_campaign_id, payloadEncrypted: row.payload_encrypted, mediaId: row.media_id,
      allowRepeatMedia: Number(row.allow_repeat_media) === 1, status: row.status, createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
      expiresAt: timestamp(row.expires_at), counts };
  }
  function campaignVideo(row) {
    if (!row.payload_encrypted?.startsWith("v3.")) return null;
    if (!videoEnabled || row.media_id !== null) state();
    const payload = openPayload(row.payload_encrypted, key, { campaignId: row.id, adminId: row.admin_id }, { video: true });
    if (payload.version !== 3 || payload.mediaId !== null || payload.allowRepeatMedia !== (Number(row.allow_repeat_media) === 1)
      || !Buffer.isBuffer(row.request_fingerprint) || !timingSafeEqual(campaignFingerprint(payload, key, { adminId: row.admin_id }, { video: true }), row.request_fingerprint)) state();
    return Buffer.from(payload.videoId, "hex");
  }
  async function media(connection, adminId, mediaId, now, videoId = null) {
    if (videoId !== null) {
      if (!videoEnabled || mediaId !== null) return false;
      bytes(videoId);
      try { const asset = await videoStore.getCommittedAsset(connection, { assetId: videoId, ownerId: adminId, ownerRole: "admin", now }); return Boolean(asset?.id?.equals(videoId)); }
      catch (error) { if (error?.code === "VIDEO_NOT_FOUND") return false; throw error; }
    }
    if (mediaId === null) return true;
    if (!mediaEnabled) return false;
    const row = (await connection.query("SELECT id, owner_id, owner_role, created_at, deleted_at FROM media_assets WHERE id = ? FOR UPDATE", [mediaId]))[0];
    return Boolean(row && row.owner_id.equals(adminId) && row.owner_role === "admin" && row.deleted_at === null && timestamp(row.created_at) <= now);
  }
  async function repeated(connection, conversationId, mediaId, ownMessageId = null, videoId = null) {
    if (videoId !== null) return (await connection.query(`SELECT 1 FROM message_video WHERE conversation_id = ? AND video_id = ?
      ${ownMessageId === null ? "" : "AND message_id <> ?"} LIMIT 1`, [conversationId, videoId, ...(ownMessageId === null ? [] : [ownMessageId])])).length > 0;
    if (mediaId === null) return false;
    return (await connection.query(`SELECT 1 FROM message_media WHERE conversation_id = ? AND media_id = ?
      ${ownMessageId === null ? "" : "AND message_id <> ?"} LIMIT 1`, [conversationId, mediaId, ...(ownMessageId === null ? [] : [ownMessageId])])).length > 0;
  }
  async function preview(connection, context, conversationIds, mediaId, videoId = null) {
    const { actor } = context; let now = context.now;
    const candidates = await connection.query(`SELECT id, client_id FROM conversations WHERE admin_id = ?
      AND id IN (${placeholders(conversationIds)}) ORDER BY id ASC`, [actor.id, ...conversationIds]);
    if (candidates.length !== conversationIds.length) fail("BROADCAST_NOT_FOUND");
    const clientIds = candidates.map((row) => row.client_id).sort(Buffer.compare);
    const clients = await connection.query(`SELECT id, role, status, pseudonym, email_verified_at, age_assured_at,
      access_approved_at, access_expires_at, ${invitationConsumptionProjection()} FROM users WHERE id IN (${placeholders(clientIds)}) ORDER BY id ASC FOR UPDATE`, clientIds);
    const byClient = new Map(clients.map((row) => [row.id.toString("hex"), row]));
    const auth = await connection.query(`SELECT user_id FROM client_auth_state WHERE user_id IN (${placeholders(clientIds)}) ORDER BY user_id ASC FOR UPDATE`, clientIds);
    const authIds = new Set(auth.map((row) => row.user_id.toString("hex")));
    const conversations = await connection.query(`SELECT id, client_id, admin_id, created_at, closed_at FROM conversations
      WHERE id IN (${placeholders(conversationIds)}) ORDER BY id ASC FOR UPDATE`, conversationIds);
    if (!(await media(connection, actor.id, mediaId, now, videoId))) fail("BROADCAST_MEDIA");
    const repeats = mediaId === null && videoId === null ? new Set() : new Set((await connection.query(`SELECT DISTINCT conversation_id FROM ${videoId === null ? "message_media" : "message_video"}
      WHERE ${videoId === null ? "media_id" : "video_id"} = ? AND conversation_id IN (${placeholders(conversationIds)})`, [videoId ?? mediaId, ...conversationIds])).map((row) => row.conversation_id.toString("hex")));
    now = currentTime(now);
    const recipients = [];
    for (const conversationId of conversationIds) {
      const conv = conversations.find((row) => row.id.equals(conversationId)), candidate = candidates.find((row) => row.id.equals(conversationId));
      if (!conv || !conv.admin_id.equals(actor.id) || !conv.client_id.equals(candidate.client_id)) fail("BROADCAST_NOT_FOUND");
      const client = byClient.get(conv.client_id.toString("hex")); if (!client || client.role !== "client") fail("BROADCAST_NOT_FOUND");
      let reason = null;
      if (conv.closed_at !== null || timestamp(conv.created_at) > now) reason = "conversation_unavailable";
      else if (!activeClient(client, now) || !authIds.has(client.id.toString("hex"))) reason = "access_inactive";
      recipients.push({ conversationId: conv.id, client: { id: client.id, pseudonym: client.pseudonym }, eligible: reason === null, reason,
        repeatMedia: repeats.has(conv.id.toString("hex")) });
    }
    return { recipients, eligibleCount: recipients.filter((row) => row.eligible).length, repeatCount: recipients.filter((row) => row.repeatMedia).length };
  }
  function scope(value) {
    try { return validateAudience(value); } catch { input(); }
  }
  const accessSql = `CASE WHEN u.status <> 'active' THEN u.status
    WHEN u.email_verified_at IS NULL OR u.email_verified_at > ? OR NOT EXISTS
      (SELECT 1 FROM invitations ai WHERE ai.consumed_by_id = u.id AND ai.consumed_at IS NOT NULL
        AND ai.consumed_at <= ? AND ai.consumed_at <= u.access_approved_at)
      OR u.access_approved_at IS NULL OR u.access_approved_at > ? THEN 'pending'
    WHEN u.access_expires_at IS NOT NULL AND u.access_expires_at <= ? THEN 'expired' ELSE 'active' END`;
  async function ownedScope(connection, actor, audience) {
    if (audience.mode !== "filtered") return;
    for (const [value, kind] of [[audience.filters.tagId, "tag"], [audience.filters.groupId, "group"]]) {
      if (value !== null && !(await connection.query("SELECT id FROM crm_labels WHERE id = ? AND owner_admin_id = ? AND kind = ? FOR UPDATE",
        [Buffer.from(value, "hex"), actor.id, kind])).length) fail("BROADCAST_NOT_FOUND");
    }
  }
  async function discoverAudience(connection, context, audience, afterId, restrict = null) {
    const date = sqlDate(context.now), where = ["c.admin_id = ?", "c.created_at <= ?"], parameters = [context.actor.id, date];
    if (audience.mode === "filtered") {
      const f = audience.filters;
      if (f.q) { where.push("(LOCATE(LOWER(?), LOWER(u.pseudonym)) > 0 OR LOCATE(LOWER(?), LOWER(COALESCE(p.nickname, ''))) > 0 OR LOCATE(LOWER(?), LOWER(u.email)) > 0)"); parameters.push(f.q, f.q, f.q); }
      for (const value of [f.tagId, f.groupId]) if (value !== null) {
        where.push("EXISTS (SELECT 1 FROM crm_memberships mb WHERE mb.admin_id = c.admin_id AND mb.conversation_id = c.id AND mb.label_id = ?)"); parameters.push(Buffer.from(value, "hex"));
      }
      if (f.access !== "all") { where.push(`(${accessSql}) = ?`); parameters.push(date, date, date, date, f.access); }
      if (f.unread) where.push(`EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> c.admin_id AND m.deleted_at IS NULL
        AND m.sequence_no > COALESCE((SELECT last_read_sequence FROM chat_receipts WHERE conversation_id = c.id AND user_id = c.admin_id), 0))`);
      if (f.reminder === "none") where.push("p.reminder_at IS NULL");
      else if (f.reminder !== "all") { where.push(`p.reminder_at ${f.reminder === "due" ? "<=" : ">"} ?`); parameters.push(date); }
    }
    if (afterId !== null) { where.push("c.id > ?"); parameters.push(afterId); }
    if (restrict !== null) { where.push(`c.id IN (${placeholders(restrict)})`); parameters.push(...restrict); }
    return connection.query(`SELECT c.id FROM conversations c JOIN users u ON u.id = c.client_id AND u.role = 'client'
      LEFT JOIN crm_profiles p ON p.admin_id = c.admin_id AND p.conversation_id = c.id
      WHERE ${where.join(" AND ")} ORDER BY c.id ASC LIMIT 100`, parameters);
  }
  async function walkAudience(connection, context, audience, mediaId, onPage, videoId = null) {
    await ownedScope(connection, context.actor, audience);
    let afterId = null, offset = 0, totalCount = 0, repeatCount = 0;
    const digest = createAudienceDigest(), sample = [];
    for (;;) {
      const selected = audience.mode === "selected"
        ? audience.conversationIds.slice(offset, offset + 100).map((value) => Buffer.from(value, "hex"))
        : (await discoverAudience(connection, context, audience, afterId)).map((row) => row.id);
      if (!selected.length) break;
      const page = await preview(connection, { ...context, now: currentTime(context.now) }, selected, mediaId, videoId);
      if (audience.mode !== "selected") {
        const checked = await discoverAudience(connection, context, audience, afterId, selected);
        if (checked.length !== selected.length || checked.some((row, index) => !row.id.equals(selected[index]))) fail("BROADCAST_CONFLICT");
      }
      totalCount += page.recipients.length; if (!Number.isSafeInteger(totalCount)) state();
      const eligible = [];
      for (const row of page.recipients) {
        if (sample.length < 50) sample.push(row);
        if (row.eligible) { digest.update(row.conversationId, row.client.id); repeatCount += Number(row.repeatMedia); eligible.push(row); }
      }
      if (onPage && eligible.length) await onPage(eligible);
      afterId = selected.at(-1); offset += selected.length;
      if (selected.length < 100) break;
    }
    if (totalCount === 0 && !(await media(connection, context.actor.id, mediaId, currentTime(context.now), videoId))) fail("BROADCAST_MEDIA");
    const eligibleCount = digest.count;
    return { recipients: sample, totalCount, eligibleCount, excludedCount: totalCount - eligibleCount, repeatCount, digest: digest.digest() };
  }
  function recipientRows(rows) {
    return rows.map((row) => ({ conversationId: row.conversation_id, client: { id: row.client_id, pseudonym: row.pseudonym },
      state: row.state, reason: row.reason, messageId: row.delivered_message_id, deliveredAt: nullableDate(row.delivered_at),
      proposedMessageId: row.proposed_message_id, clientMessageId: row.client_message_id }));
  }
  async function recipientPage(connection, campaignId, afterId, limit) {
    if (afterId !== null && !(await connection.query("SELECT conversation_id FROM broadcast_recipients WHERE campaign_id = ? AND conversation_id = ?", [campaignId, afterId])).length) fail("BROADCAST_NOT_FOUND");
    const rows = await connection.query(`SELECT r.conversation_id, r.client_id, u.pseudonym, r.state, r.reason, r.delivered_message_id,
      r.delivered_at, r.proposed_message_id, r.client_message_id FROM broadcast_recipients r JOIN users u ON u.id = r.client_id
      WHERE r.campaign_id = ? ${afterId === null ? "" : "AND r.conversation_id > ?"} ORDER BY r.conversation_id ASC LIMIT ?`,
      [campaignId, ...(afterId === null ? [] : [afterId]), limit + 1]);
    const selected = rows.slice(0, limit), hasMore = rows.length > limit;
    return { recipients: recipientRows(selected), hasMore, nextCursor: hasMore ? selected.at(-1).conversation_id : null };
  }
  async function settle(connection, campaignId, now) {
    const remaining = (await connection.query("SELECT 1 FROM broadcast_recipients WHERE campaign_id = ? AND state IN ('pending', 'sending') LIMIT 1", [campaignId])).length;
    await connection.query(`UPDATE broadcast_campaigns SET status = CASE WHEN ? = 0 THEN 'completed' ELSE status END,
      updated_at = GREATEST(updated_at, ?) WHERE id = ? AND status IN ('queued', 'running')`, [remaining, sqlDate(now), campaignId]);
  }
  async function terminal(connection, campaignId, conversationId, reason, now) {
    await connection.query(`UPDATE broadcast_recipients SET state = 'skipped', reason = ?, lease_token = NULL, lease_until = NULL
      WHERE campaign_id = ? AND conversation_id = ? AND state IN ('pending', 'sending')`, [reason, campaignId, conversationId]);
    await settle(connection, campaignId, now);
  }
  async function pause(connection, campaignId, now) {
    await connection.query(`UPDATE broadcast_recipients SET state = 'cancelled', reason = 'administrator_invalid', lease_token = NULL, lease_until = NULL
      WHERE campaign_id = ? AND state IN ('pending', 'sending')`, [campaignId]);
    await connection.query("UPDATE broadcast_campaigns SET status = 'paused', updated_at = GREATEST(updated_at, ?) WHERE id = ? AND status IN ('queued', 'running')", [sqlDate(now), campaignId]);
  }
  function jobInput(job) {
    if (!job || typeof job !== "object") input();
    for (const name of ["campaignId", "adminId", "conversationId", "clientId", "messageId", "clientMessageId", "leaseToken"]) bytes(job[name]);
    uint32(job.mfaVersion); if (job.mediaId !== null) bytes(job.mediaId);
    if (Object.hasOwn(job, "videoId")) { if (!videoEnabled) input(); bytes(job.videoId); if (job.mediaId !== null) input(); }
    if (typeof job.allowRepeatMedia !== "boolean" || typeof job.payloadEncrypted !== "string") input();
  }
  async function jobTime(connection, context, campaign, recipient, previous) {
    const now = currentTime(previous);
    if (timestamp(recipient.lease_until) <= now) return null;
    if (!context.canSend || !activeClient(context.client, now)) { await terminal(connection, campaign.id, recipient.conversation_id, "access_inactive", now); return null; }
    if (timestamp(campaign.expires_at) <= now) { await terminal(connection, campaign.id, recipient.conversation_id, "expired", now); return null; }
    return now;
  }
  // Every worker transaction starts with the same account/proof/conversation
  // locks as ordinary chat. Queue rows are never held while waiting for them.
  async function withJob(job, now, operation) {
    jobInput(job); instant(now);
    return chatStore.withBroadcastDelivery({ adminId: job.adminId, mfaVersion: job.mfaVersion, conversationId: job.conversationId, now },
      async (connection, context, append) => {
        const campaign = (await connection.query("SELECT * FROM broadcast_campaigns WHERE id = ? AND admin_id = ? FOR UPDATE", [job.campaignId, job.adminId]))[0];
        if (!campaign || !live(campaign) || Number(campaign.mfa_version) !== job.mfaVersion) return false;
        if (context.reason === "administrator_invalid") { await pause(connection, campaign.id, currentTime(context.now)); return false; }
        const compatible = context.client?.id.equals(job.clientId) && context.conversation?.id.equals(job.conversationId)
          && context.conversation.admin_id.equals(job.adminId) && context.conversation.client_id.equals(job.clientId);
        const recipient = (await connection.query("SELECT * FROM broadcast_recipients WHERE campaign_id = ? AND conversation_id = ? FOR UPDATE", [campaign.id, job.conversationId]))[0];
        now = currentTime(context.now);
        if (!recipient || recipient.state !== "sending" || !recipient.lease_token?.equals(job.leaseToken)
          || !recipient.client_id.equals(job.clientId)
          || !recipient.proposed_message_id.equals(job.messageId) || !recipient.client_message_id.equals(job.clientMessageId)) return false;
        if (!compatible || context.conversation.closed_at !== null || timestamp(context.conversation.created_at) > now) {
          await terminal(connection, campaign.id, job.conversationId, "conversation_unavailable", now); return false;
        }
        const refresh = () => jobTime(connection, context, campaign, recipient, now);
        now = await refresh(); if (now === null) return false;
        if (campaign.payload_encrypted !== job.payloadEncrypted || (Number(campaign.allow_repeat_media) === 1) !== job.allowRepeatMedia
          || (campaign.media_id === null ? job.mediaId !== null : !campaign.media_id.equals(job.mediaId))) state();
        const videoId = campaignVideo(campaign);
        if (videoId === null ? Object.hasOwn(job, "videoId") : !Buffer.isBuffer(job.videoId) || !videoId.equals(job.videoId)) state();
        return operation(connection, { ...context, now }, append, campaign, recipient, refresh);
      });
  }
  // Trusted server primitive: the caller owns the existing admin transaction.
  // Announcement creation uses it so the banner and queue cannot commit apart.
  async function createAudienceInTransaction(connection, context, { audience, campaign, snapshot, verifyPreview,
    availableAt = context.now, expiresAt = context.now + 7 * 86400000, allowVideoCreation = true }) {
    if (typeof allowVideoCreation !== "boolean") input();
    audience = scope(audience); bytes(campaign?.id); bytes(campaign?.clientCampaignId); bytes(campaign?.requestFingerprint, 32);
    if (campaign.mediaId !== null) bytes(campaign.mediaId);
    const videoId = campaign.videoId ?? null;
    if (videoId !== null) {
      if (!videoEnabled || campaign.mediaId !== null) input(); bytes(videoId);
      const authenticated = campaignVideo({ id: campaign.id, admin_id: context.actor?.id, media_id: campaign.mediaId,
        payload_encrypted: campaign.payloadEncrypted, request_fingerprint: campaign.requestFingerprint, allow_repeat_media: campaign.allowRepeatMedia ? 1 : 0 });
      if (!authenticated?.equals(videoId)) input();
    } else if (typeof campaign.payloadEncrypted === "string" && campaign.payloadEncrypted.startsWith("v3.")) input();
    if (typeof campaign.allowRepeatMedia !== "boolean" || typeof campaign.payloadEncrypted !== "string"
      || campaign.payloadEncrypted.length < 1 || campaign.payloadEncrypted.length > 32000 || /[^\x20-\x7e]/.test(campaign.payloadEncrypted)
      || typeof campaign.recipientProof !== "function" || typeof verifyPreview !== "function"
      || !snapshot || !Number.isSafeInteger(snapshot.count) || snapshot.count < 0 || !/^[a-f0-9]{64}$/.test(snapshot.digest)
      || !Number.isSafeInteger(snapshot.repeatCount) || snapshot.repeatCount < 0 || snapshot.repeatCount > snapshot.count) input();
    if (typeof connection?.query !== "function" || !context.actor || context.actor.role !== "admin") input();
    instant(availableAt); instant(expiresAt);
    if (availableAt < context.now || expiresAt <= availableAt || expiresAt > context.now + 7 * 86400000) input();
    const previous = (await connection.query("SELECT * FROM broadcast_campaigns WHERE admin_id = ? AND client_campaign_id = ? FOR UPDATE", [context.actor.id, campaign.clientCampaignId]))[0];
    if (previous) {
      if (!timingSafeEqual(previous.request_fingerprint, campaign.requestFingerprint)) fail("BROADCAST_CONFLICT");
      return { campaign: await rawCampaign(connection, previous), duplicate: true };
    }
    // A compatibility runtime may acknowledge the exact recorded request, but
    // never create a new video campaign. Existing workers use separate paths.
    if (videoId !== null && (!videoCreationEnabled || !allowVideoCreation)) fail("BROADCAST_READ_ONLY");
    try { verifyPreview(currentTime(context.now)); } catch { fail("BROADCAST_CONFLICT"); }
    if (snapshot.count < 1) fail("BROADCAST_RECIPIENTS");
    if (!campaign.allowRepeatMedia && snapshot.repeatCount > 0) fail("BROADCAST_REPEAT");
    const liveCount = count((await connection.query("SELECT COUNT(*) AS value FROM broadcast_campaigns WHERE admin_id = ? AND status IN ('queued', 'running')", [context.actor.id]))[0].value);
    if (liveCount >= 10) fail("BROADCAST_LIMIT");
    uint32(context.mfaVersion);
    await connection.query(`INSERT INTO broadcast_campaigns (id, admin_id, client_campaign_id, mfa_version, payload_encrypted,
      request_fingerprint, media_id, allow_repeat_media, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [campaign.id, context.actor.id, campaign.clientCampaignId, context.mfaVersion, campaign.payloadEncrypted, campaign.requestFingerprint,
        campaign.mediaId, campaign.allowRepeatMedia ? 1 : 0, sqlDate(context.now), sqlDate(context.now), sqlDate(expiresAt)]);
    const result = await walkAudience(connection, context, audience, campaign.mediaId, async (recipients) => {
      const values = [], parameters = [];
      for (const target of recipients) {
        const messageId = randomBytes(16), proof = campaign.recipientProof({ campaignId: campaign.id, adminId: context.actor.id,
          conversationId: target.conversationId, clientId: target.client.id, messageId }); bytes(proof);
        values.push("(?, ?, ?, ?, ?, ?, ?)"); parameters.push(campaign.id, target.conversationId, target.client.id, messageId, proof, sqlDate(availableAt), sqlDate(context.now));
      }
      await connection.query(`INSERT INTO broadcast_recipients (campaign_id, conversation_id, client_id, proposed_message_id, client_message_id,
        available_at, created_at) VALUES ${values.join(", ")}`, parameters);
    }, videoId);
    try { verifyPreview(currentTime(context.now)); } catch { fail("BROADCAST_CONFLICT"); }
    if (result.eligibleCount !== snapshot.count || result.digest !== snapshot.digest || result.repeatCount !== snapshot.repeatCount) fail("BROADCAST_CONFLICT");
    return { campaign: await rawCampaign(connection, await campaignRow(connection, campaign.id, context.actor.id)), duplicate: false };
  }
  async function cancelInTransaction(connection, context, campaignId, now = context.now) {
    bytes(campaignId); instant(now);
    const row = await campaignRow(connection, campaignId, context.actor.id);
    if (live(row)) {
      await connection.query(`UPDATE broadcast_recipients SET state = 'cancelled', reason = 'cancelled', lease_token = NULL, lease_until = NULL
        WHERE campaign_id = ? AND state IN ('pending', 'sending')`, [campaignId]);
      await connection.query("UPDATE broadcast_campaigns SET status = 'cancelled', updated_at = GREATEST(updated_at, ?) WHERE id = ?", [sqlDate(now), campaignId]);
    }
    return rawCampaign(connection, await campaignRow(connection, campaignId, context.actor.id));
  }
  return Object.freeze({
    assertSchema: (options) => assertBroadcastSchema(pool, options),
    async preview({ tokenHash, now, conversationIds, mediaId = null }) {
      const selected = ids(conversationIds); if (mediaId !== null) bytes(mediaId);
      return withAdmin({ tokenHash, now }, (connection, context) => preview(connection, context, selected, mediaId));
    },
    async create({ tokenHash, now, campaign }) {
      if (typeof campaign?.payloadEncrypted === "string" && campaign.payloadEncrypted.startsWith("v3.") || campaign?.videoId !== undefined) input();
      bytes(campaign?.id); bytes(campaign?.clientCampaignId); bytes(campaign?.requestFingerprint, 32);
      if (campaign.mediaId !== null) bytes(campaign.mediaId);
      if (typeof campaign.allowRepeatMedia !== "boolean" || typeof campaign.payloadEncrypted !== "string" || campaign.payloadEncrypted.length < 1
        || campaign.payloadEncrypted.length > 32000 || /[^\x20-\x7e]/.test(campaign.payloadEncrypted) || !Array.isArray(campaign.recipients)) input();
      const selected = ids(campaign.recipients.map((row) => row?.conversationId));
      for (const row of campaign.recipients) { bytes(row.messageId); bytes(row.clientMessageId); }
      if (new Set(campaign.recipients.map((row) => row.messageId.toString("hex"))).size !== selected.length
        || new Set(campaign.recipients.map((row) => row.clientMessageId.toString("hex"))).size !== selected.length) input();
      if (now + 7 * 86400000 > 253402300799999) input();
      return withAdmin({ tokenHash, now }, async (connection, context) => {
        const previous = (await connection.query("SELECT * FROM broadcast_campaigns WHERE admin_id = ? AND client_campaign_id = ? FOR UPDATE", [context.actor.id, campaign.clientCampaignId]))[0];
        if (previous) {
          if (!timingSafeEqual(previous.request_fingerprint, campaign.requestFingerprint)) fail("BROADCAST_CONFLICT");
          return { campaign: await rawCampaign(connection, previous), duplicate: true };
        }
        const liveCount = count((await connection.query("SELECT COUNT(*) AS value FROM broadcast_campaigns WHERE admin_id = ? AND status IN ('queued', 'running')", [context.actor.id]))[0].value);
        if (liveCount >= 10) fail("BROADCAST_LIMIT");
        const result = await preview(connection, context, selected, campaign.mediaId);
        if (result.eligibleCount !== selected.length) fail("BROADCAST_RECIPIENTS");
        if (!campaign.allowRepeatMedia && result.repeatCount > 0) fail("BROADCAST_REPEAT");
        uint32(context.mfaVersion);
        await connection.query(`INSERT INTO broadcast_campaigns (id, admin_id, client_campaign_id, mfa_version, payload_encrypted,
          request_fingerprint, media_id, allow_repeat_media, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [campaign.id, context.actor.id, campaign.clientCampaignId, context.mfaVersion, campaign.payloadEncrypted, campaign.requestFingerprint,
          campaign.mediaId, campaign.allowRepeatMedia ? 1 : 0, sqlDate(now), sqlDate(now), sqlDate(now + 7 * 86400000)]);
        for (const target of result.recipients) {
          const recipient = campaign.recipients.find((row) => row.conversationId.equals(target.conversationId));
          await connection.query(`INSERT INTO broadcast_recipients (campaign_id, conversation_id, client_id, proposed_message_id, client_message_id,
            available_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [campaign.id, target.conversationId, target.client.id,
            recipient.messageId, recipient.clientMessageId, sqlDate(now), sqlDate(now)]);
        }
        return { campaign: await rawCampaign(connection, await campaignRow(connection, campaign.id, context.actor.id)), duplicate: false };
      });
    },
    async previewAudience({ tokenHash, now, audience, mediaId = null, videoId = null }) {
      audience = scope(audience); if (mediaId !== null) bytes(mediaId);
      if (videoId !== null) { if (!videoEnabled || mediaId !== null) input(); bytes(videoId); }
      return withAdmin({ tokenHash, now }, (connection, context) => walkAudience(connection, context, audience, mediaId, undefined, videoId));
    },
    createAudienceInTransaction,
    cancelInTransaction,
    async createAudience({ tokenHash, now, ...value }) {
      return withAdmin({ tokenHash, now }, (connection, context) => createAudienceInTransaction(connection, context, value));
    },
    async summary({ tokenHash, now, campaignId }) {
      bytes(campaignId);
      return withAdmin({ tokenHash, now }, async (connection, context) => rawCampaign(connection, await campaignRow(connection, campaignId, context.actor.id)));
    },
    async recipients({ tokenHash, now, campaignId, afterId = null, limit = 50 }) {
      bytes(campaignId); if (afterId !== null) bytes(afterId); if (!Number.isInteger(limit) || limit < 1 || limit > 50) input();
      return withAdmin({ tokenHash, now }, async (connection, context) => {
        const campaign = await rawCampaign(connection, await campaignRow(connection, campaignId, context.actor.id));
        return { campaign, ...(await recipientPage(connection, campaignId, afterId, limit)) };
      });
    },
    async activity({ tokenHash, now }) {
      return withAdmin({ tokenHash, now }, async (connection, context) => {
        // ID keysets remain useful for archives, while random IDs cannot
        // discover recent work reliably. Keep this live view small and owned.
        const recentIds = await connection.query(`SELECT id, created_at FROM broadcast_campaigns WHERE admin_id = ?
          ORDER BY created_at DESC, id DESC LIMIT 20`, [context.actor.id]);
        // Sort only IDs/dates, never the potentially large encrypted payload.
        const recent = recentIds.length ? await connection.query(`SELECT * FROM broadcast_campaigns
          WHERE admin_id = ? AND id IN (${placeholders(recentIds)})`, [context.actor.id, ...recentIds.map((row) => row.id)]) : [];
        const active = await connection.query(`SELECT * FROM broadcast_campaigns WHERE admin_id = ?
          AND status IN ('queued', 'running') ORDER BY created_at DESC, id DESC LIMIT 11`, [context.actor.id]);
        if (active.length > 10) state();
        const rows = new Map([...recent, ...active].map((row) => [row.id.toString("hex"), row]));
        const ordered = [...rows.values()].sort((left, right) => timestamp(right.created_at) - timestamp(left.created_at) || Buffer.compare(right.id, left.id));
        const campaigns = [];
        for (const row of ordered) campaigns.push(await rawCampaign(connection, row));
        return { campaigns };
      });
    },
    async list({ tokenHash, now, afterId = null, limit = 20 }) {
      if (afterId !== null) bytes(afterId); if (!Number.isInteger(limit) || limit < 1 || limit > 50) input();
      return withAdmin({ tokenHash, now }, async (connection, context) => {
        const rows = await connection.query(`SELECT * FROM broadcast_campaigns WHERE admin_id = ? ${afterId === null ? "" : "AND id > ?"}
          ORDER BY id ASC LIMIT ?`, [context.actor.id, ...(afterId === null ? [] : [afterId]), limit + 1]);
        const selected = rows.slice(0, limit), campaigns = []; for (const row of selected) campaigns.push(await rawCampaign(connection, row));
        return { campaigns, nextCursor: rows.length > limit ? selected.at(-1).id : null, hasMore: rows.length > limit };
      });
    },
    async get({ tokenHash, now, campaignId }) {
      bytes(campaignId);
      return withAdmin({ tokenHash, now }, async (connection, context) => {
        const row = await campaignRow(connection, campaignId, context.actor.id), result = await rawCampaign(connection, row);
        if (row.payload_encrypted.startsWith("v2.") || videoEnabled && row.payload_encrypted.startsWith("v3.")) return { ...result, ...(await recipientPage(connection, campaignId, null, 50)) };
        const recipients = await connection.query(`SELECT r.conversation_id, r.client_id, u.pseudonym, r.state, r.reason, r.delivered_message_id, r.delivered_at
          FROM broadcast_recipients r JOIN users u ON u.id = r.client_id WHERE r.campaign_id = ? ORDER BY r.conversation_id ASC`, [campaignId]);
        return { ...result, recipients: recipientRows(recipients) };
      });
    },
    async cancel({ tokenHash, now, campaignId }) {
      bytes(campaignId);
      return withAdmin({ tokenHash, now }, (connection, context) => cancelInTransaction(connection, context, campaignId, now));
    },
    async claim({ now, leaseMilliseconds = 120000 }) {
      instant(now);
      if (!Number.isSafeInteger(leaseMilliseconds) || leaseMilliseconds < 1000 || leaseMilliseconds > 300000 || now + leaseMilliseconds > 253402300799999) input();
      const candidates = await run(pool, async (connection) => {
        const projection = "SELECT r.campaign_id, r.conversation_id, r.client_id, c.admin_id, c.mfa_version";
        const expiredLeases = await connection.query(`${projection}
          FROM broadcast_recipients r FORCE INDEX (broadcast_recipients_lease) JOIN broadcast_campaigns c ON c.id = r.campaign_id
          WHERE r.state = 'sending' AND r.lease_until <= ? AND c.status IN ('queued', 'running')
          ORDER BY r.lease_until, r.campaign_id, r.conversation_id LIMIT 16`, [sqlDate(now)]);
        const expiredPending = await connection.query(`${projection}
          FROM broadcast_campaigns c JOIN broadcast_recipients r ON r.campaign_id = c.id
          WHERE c.status IN ('queued', 'running') AND c.expires_at <= ? AND r.state = 'pending'
          ORDER BY c.expires_at, r.campaign_id, r.conversation_id LIMIT 16`, [sqlDate(now)]);
        const pending = await connection.query(`${projection}
          FROM broadcast_recipients r FORCE INDEX (broadcast_recipients_ready) JOIN broadcast_campaigns c ON c.id = r.campaign_id
          WHERE r.state = 'pending' AND r.available_at <= ? AND c.status IN ('queued', 'running')
          ORDER BY r.available_at, r.campaign_id, r.conversation_id LIMIT 16`, [sqlDate(now)]);
        const unique = new Map();
        for (const row of [...expiredLeases, ...expiredPending, ...pending]) {
          const identity = `${storedCandidateId(row.campaign_id)}:${storedCandidateId(row.conversation_id)}`;
          if (!unique.has(identity)) unique.set(identity, row);
        }
        return [...unique.values()].slice(0, 16);
      });
      for (const candidate of candidates) {
        const result = await chatStore.withBroadcastDelivery({ adminId: candidate.admin_id, mfaVersion: uint32(Number(candidate.mfa_version)), conversationId: candidate.conversation_id, now },
          async (connection, context) => {
            const campaign = (await connection.query("SELECT * FROM broadcast_campaigns WHERE id = ? AND admin_id = ? FOR UPDATE", [candidate.campaign_id, candidate.admin_id]))[0];
            if (!campaign || !live(campaign) || Number(campaign.mfa_version) !== Number(candidate.mfa_version)) return null;
            if (context.reason === "administrator_invalid") { await pause(connection, campaign.id, currentTime(context.now)); return null; }
            const compatible = context.client?.id.equals(candidate.client_id) && context.conversation?.id.equals(candidate.conversation_id)
              && context.conversation.admin_id.equals(candidate.admin_id) && context.conversation.client_id.equals(candidate.client_id);
            const recipient = (await connection.query("SELECT * FROM broadcast_recipients WHERE campaign_id = ? AND conversation_id = ? FOR UPDATE", [campaign.id, candidate.conversation_id]))[0];
            if (!recipient || !recipient.client_id.equals(candidate.client_id)) return null;
            now = currentTime(context.now);
            const expired = timestamp(campaign.expires_at) <= now;
            const ready = (recipient.state === "pending" && timestamp(recipient.available_at) <= now)
              || (recipient.state === "sending" && timestamp(recipient.lease_until) <= now) || (expired && ["pending", "sending"].includes(recipient.state));
            if (!ready) return null;
            const videoId = campaignVideo(campaign);
            let reason = null;
            if (!compatible || context.conversation.closed_at !== null || timestamp(context.conversation.created_at) > now) reason = "conversation_unavailable";
            else if (!context.canSend || !activeClient(context.client, now)) reason = "access_inactive";
            else if (expired) reason = "expired";
            else if (!(await media(connection, campaign.admin_id, campaign.media_id, now, videoId))) reason = "media_unavailable";
            else if (Number(campaign.allow_repeat_media) !== 1 && await repeated(connection, candidate.conversation_id, campaign.media_id, recipient.proposed_message_id, videoId)) reason = "repeat_media";
            // The media lock and repeat query can also wait. Keep every account,
            // conversation and queue lock held while checking the final time.
            now = currentTime(now);
            if (reason === null && !activeClient(context.client, now)) reason = "access_inactive";
            if (reason === null && timestamp(campaign.expires_at) <= now) reason = "expired";
            if (reason !== null) { await terminal(connection, campaign.id, candidate.conversation_id, reason, now); return null; }
            const leaseToken = randomBytes(16), leaseUntil = Math.min(now + leaseMilliseconds, timestamp(campaign.expires_at));
            await connection.query(`UPDATE broadcast_recipients SET state = 'sending', reason = NULL, lease_token = ?, lease_until = ?
              WHERE campaign_id = ? AND conversation_id = ?`, [leaseToken, sqlDate(leaseUntil), campaign.id, candidate.conversation_id]);
            await connection.query("UPDATE broadcast_campaigns SET status = 'running', updated_at = GREATEST(updated_at, ?) WHERE id = ?", [sqlDate(now), campaign.id]);
            return { campaignId: campaign.id, adminId: campaign.admin_id, mfaVersion: Number(campaign.mfa_version), conversationId: recipient.conversation_id,
              clientId: recipient.client_id, messageId: recipient.proposed_message_id, clientMessageId: recipient.client_message_id, mediaId: campaign.media_id,
              allowRepeatMedia: Number(campaign.allow_repeat_media) === 1, payloadEncrypted: campaign.payload_encrypted, leaseToken, ...(videoId === null ? {} : { videoId }) };
          });
        if (result) return result;
      }
      return null;
    },
    async deliver(job, { now, message }) {
      jobInput(job);
      if (!message || !Buffer.isBuffer(message.id) || !message.id.equals(job.messageId)
        || !Buffer.isBuffer(message.clientMessageId) || !message.clientMessageId.equals(job.clientMessageId)
        || (job.mediaId === null ? (message.mediaId ?? null) !== null : !Buffer.isBuffer(message.mediaId) || !message.mediaId.equals(job.mediaId))
        || (job.videoId === undefined ? message.videoId !== undefined : !Buffer.isBuffer(message.videoId) || !message.videoId.equals(job.videoId))) input();
      const expiredDuringDelivery = new BroadcastStoreError();
      let result;
      try { result = await withJob(job, now, async (connection, context, append, campaign, recipient, refresh) => {
        if (!(await media(connection, campaign.admin_id, campaign.media_id, context.now, job.videoId ?? null))) { await terminal(connection, campaign.id, job.conversationId, "media_unavailable", currentTime(context.now)); return false; }
        if (Number(campaign.allow_repeat_media) !== 1 && await repeated(connection, job.conversationId, campaign.media_id, recipient.proposed_message_id, job.videoId ?? null)) {
          await terminal(connection, campaign.id, job.conversationId, "repeat_media", currentTime(context.now)); return false;
        }
        // Re-read after every potentially waiting media query, immediately
        // before the ordinary append. Its owner/conversation locks are held.
        now = await refresh(); if (now === null) return false;
        const prepared = { ...message, notificationExpiresAt: timestamp(campaign.expires_at) };
        const sent = job.videoId === undefined ? await append(prepared) : await videoMessageStore.appendBroadcastVideo(connection, context, append, prepared);
        if (!sent.message.id.equals(recipient.proposed_message_id)) state();
        await connection.query(`UPDATE broadcast_recipients SET state = 'delivered', reason = NULL, delivered_message_id = ?, delivered_at = ?,
          lease_token = NULL, lease_until = NULL WHERE campaign_id = ? AND conversation_id = ?`, [sent.message.id, sqlDate(now), campaign.id, job.conversationId]);
        await settle(connection, campaign.id, now);
        // Any wait inside append or its following writes must roll back the
        // message, event and notification together, rather than commit late.
        const completedAt = currentTime(now);
        if (timestamp(recipient.lease_until) <= completedAt || timestamp(campaign.expires_at) <= completedAt
          || !activeClient(context.client, completedAt)) throw expiredDuringDelivery;
        return { delivered: true, duplicate: sent.duplicate };
      }); } catch (error) { if (error !== expiredDuringDelivery) throw error; return { delivered: false }; }
      return result || { delivered: false };
    },
    async defer(job, { now, availableAt }) {
      instant(availableAt); if (availableAt < now) input();
      return withJob(job, now, async (connection, context, _append, campaign) => {
        now = context.now;
        await connection.query(`UPDATE broadcast_recipients SET state = 'pending', reason = NULL, available_at = ?, lease_token = NULL, lease_until = NULL
          WHERE campaign_id = ? AND conversation_id = ?`, [sqlDate(Math.max(timestamp(campaign.created_at), availableAt)), campaign.id, job.conversationId]);
        await settle(connection, campaign.id, now); return true;
      });
    },
    async fail(job, { now }) {
      return withJob(job, now, async (connection, context, _append, campaign, recipient) => {
        now = context.now;
        const attempts = count(recipient.attempts) + 1; if (attempts > 8) state();
        const failed = attempts >= 8, availableAt = now + Math.min(3600, 30 * 2 ** (attempts - 1)) * 1000; instant(availableAt);
        await connection.query(`UPDATE broadcast_recipients SET state = ?, reason = ?, attempts = ?, available_at = ?, lease_token = NULL, lease_until = NULL
          WHERE campaign_id = ? AND conversation_id = ?`, [failed ? "failed" : "pending", failed ? "processing_failed" : null, attempts, sqlDate(availableAt), campaign.id, job.conversationId]);
        await settle(connection, campaign.id, now); return true;
      });
    },
  });
}
