import { loadStoreMigrations } from "../db/store-migrations.mjs";
import { hasConsumedInvitation, invitationConsumptionProjection } from "../access/admission.mjs";
import { ChatStoreError } from "../chat/store.mjs";
import { migrationStatus } from "../db/migrations.mjs";

export class CrmStoreError extends ChatStoreError {
  constructor(code) { super(code, "Private contact persistence could not be completed."); this.name = "CrmStoreError"; }
}
const fail = (code) => { throw new CrmStoreError(code); };
const input = () => fail("CRM_INPUT"), state = () => fail("CRM_DATABASE_STATE");
const bytes = (value, length = 16) => { if (!Buffer.isBuffer(value) || value.length !== length) input(); return value; };
const instant = (value) => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) input(); return value; };
const sqlDate = (value) => new Date(instant(value)).toISOString().replace("T", " ").replace("Z", "000");
const timestamp = (value) => {
  if (value instanceof Date && Number.isSafeInteger(value.getTime()) && value.getTime() >= 0) return value.getTime();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) state();
  const result = Date.parse(`${value.replace(" ", "T")}Z`); if (!Number.isSafeInteger(result) || result < 0) state(); return result;
};
const nullableDate = (value) => value === null ? null : timestamp(value);
const versionValue = (value, allowZero = true) => {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,9})$/.test(value) || BigInt(value) > 4294967295n || BigInt(value).toString() !== value || (!allowZero && value === "0")) input();
  return value;
};
const storedVersion = (value) => { try { return versionValue(String(value), false); } catch { state(); } };
const sequence = (value) => { const result = String(value); if (!/^(?:0|[1-9][0-9]{0,19})$/.test(result) || BigInt(result) > 18446744073709551615n || BigInt(result).toString() !== result) state(); return result; };
const nextVersion = (value) => { if (value === "4294967295") fail("CRM_LIMIT"); return String(BigInt(value) + 1n); };
const limitValue = (value) => { if (!Number.isInteger(value) || value < 1 || value > 100) input(); };
const kindValue = (value) => { if (!["tag", "group"].includes(value)) input(); };
const textValue = (value, max, empty = false) => { if (typeof value !== "string" || !value.isWellFormed() || value.length > max || (!empty && !value.length)) input(); };
const requestValue = ({ tokenHash, now }) => { bytes(tokenHash, 32); instant(now); };
const placeholders = (values) => values.map(() => "?").join(", ");
const accessState = (client, now) => {
  if (!["pending", "active", "revoked", "suspended", "deleted"].includes(client.status)) state();
  if (client.status !== "active") return client.status;
  if (!hasConsumedInvitation(client, now, timestamp) || [client.email_verified_at, client.access_approved_at].some((value) => value === null || timestamp(value) > now)
    || timestamp(client.access_approved_at) < timestamp(client.invitation_consumed_at)) return "pending";
  return client.access_expires_at !== null && timestamp(client.access_expires_at) <= now ? "expired" : "active";
};
const accessDto = (client, now) => ({ state: accessState(client, now), expiresAt: nullableDate(client.access_expires_at) });
const rawLabel = (row) => {
  const memberCount = Number(row.member_count ?? 0); if (!Number.isSafeInteger(memberCount) || memberCount < 0) state();
  return { id: row.id, kind: row.kind, name: row.name, version: storedVersion(row.version),
    createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at), memberCount };
};
const labelProjection = "l.id, l.kind, l.name, l.normalized_name, l.version, l.created_at, l.updated_at";
const memberCountSql = `(SELECT COUNT(*) FROM crm_memberships mc JOIN conversations cc ON cc.id = mc.conversation_id
  WHERE mc.admin_id = l.owner_admin_id AND mc.label_id = l.id AND cc.admin_id = l.owner_admin_id)`;
const contactProjection = `c.id, c.client_id, c.created_at, c.closed_at, u.pseudonym, u.status,
  u.email_verified_at, u.age_assured_at, u.access_approved_at, u.access_expires_at, ${invitationConsumptionProjection("u")},
  p.nickname, p.reminder_at, p.version,
  (SELECT up.version FROM user_profiles up JOIN media_assets av ON av.id = up.avatar_media_id
    WHERE up.user_id = u.id AND av.owner_id = u.id AND av.owner_role = u.role AND av.deleted_at IS NULL) AS peer_avatar_version,
  COALESCE((SELECT MAX(sequence_no) FROM messages WHERE conversation_id = c.id), 0) AS latest_sequence,
  COALESCE((SELECT MAX(event_sequence) FROM chat_events WHERE conversation_id = c.id), 0) AS latest_event_sequence,
  (SELECT MAX(occurred_at) FROM chat_events WHERE conversation_id = c.id) AS last_activity_at,
  COALESCE((SELECT last_read_sequence FROM chat_receipts WHERE conversation_id = c.id AND user_id = c.admin_id), 0) AS last_read_sequence,
  COALESCE((SELECT last_read_sequence FROM chat_receipts WHERE conversation_id = c.id AND user_id = c.client_id), 0) AS peer_read_sequence,
  (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> c.admin_id AND m.deleted_at IS NULL
    AND m.sequence_no > COALESCE((SELECT last_read_sequence FROM chat_receipts WHERE conversation_id = c.id AND user_id = c.admin_id), 0)) AS unread_count`;
const contactFrom = `FROM conversations c JOIN users u ON u.id = c.client_id AND u.role = 'client'
  JOIN client_auth_state ca ON ca.user_id = u.id LEFT JOIN crm_profiles p ON p.admin_id = c.admin_id AND p.conversation_id = c.id`;
const accessStateSql = `CASE WHEN u.status <> 'active' THEN u.status
  WHEN u.email_verified_at IS NULL OR u.email_verified_at > ? OR NOT EXISTS
    (SELECT 1 FROM invitations admission_invitation WHERE admission_invitation.consumed_by_id = u.id
      AND admission_invitation.consumed_at IS NOT NULL AND admission_invitation.consumed_at <= ?
      AND admission_invitation.consumed_at <= u.access_approved_at)
    OR u.access_approved_at IS NULL OR u.access_approved_at > ? THEN 'pending'
  WHEN u.access_expires_at IS NOT NULL AND u.access_expires_at <= ? THEN 'expired' ELSE 'active' END`;

// Restricted semantic CHECK comparison; MariaDB rewrites redundant parentheses.
function checkTree(expression) {
  const tokens = [], pattern = /\s+|`([a-z_][a-z0-9_]*)`|'(?:''|[^'])*'|>=|<=|<>|!=|[=<>(),]|[0-9]+|[a-z_][a-z0-9_]*/iy;
  let offset = 0;
  while (offset < expression.length) {
    pattern.lastIndex = offset; const match = pattern.exec(expression); if (!match) state(); offset = pattern.lastIndex;
    if (!/^\s+$/.test(match[0])) tokens.push(match[1] ?? (match[0].startsWith("'") ? match[0] : match[0].toLowerCase()));
  }
  let position = 0;
  const take = (expected) => { if (tokens[position++] !== expected) state(); };
  function operand() {
    const token = tokens[position++]; if (!token || !/^(?:[a-z_][a-z0-9_]*|[0-9]+|'(?:''|[^'])*')$/i.test(token)) state();
    if (tokens[position] === "(") { position++; if (!["octet_length", "char_length"].includes(token)) state(); const argument = operand(); take(")"); return ["call", token, argument]; }
    return ["value", token];
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
const definitions = {
  crm_profiles: { admin_id: ["varbinary", false, 16], admin_role: ["varchar", false, 8, "ascii_bin"], conversation_id: ["varbinary", false, 16], nickname: ["varchar", false, 64, "utf8mb4_bin"], notes_encrypted: ["varchar", true, 44000, "ascii_bin"], reminder_at: ["datetime", true], version: ["int", false], notes_revision: ["int", false], created_at: ["datetime", false], updated_at: ["datetime", false] },
  crm_labels: { id: ["varbinary", false, 16], owner_admin_id: ["varbinary", false, 16], owner_role: ["varchar", false, 8, "ascii_bin"], kind: ["varchar", false, 8, "ascii_bin"], name: ["varchar", false, 64, "utf8mb4_bin"], normalized_name: ["varchar", false, 128, "utf8mb4_bin"], version: ["int", false], created_at: ["datetime", false], updated_at: ["datetime", false] },
  crm_memberships: { admin_id: ["varbinary", false, 16], conversation_id: ["varbinary", false, 16], label_id: ["varbinary", false, 16], created_at: ["datetime", false] },
};
const indexes = {
  crm_profiles: { PRIMARY: [0, "admin_id", "conversation_id"], crm_profiles_reminders: [1, "admin_id", "reminder_at", "conversation_id"] },
  crm_labels: { PRIMARY: [0, "id"], crm_labels_owner_id: [0, "owner_admin_id", "id"], crm_labels_owner_name: [0, "owner_admin_id", "kind", "normalized_name"], crm_labels_owner_page: [1, "owner_admin_id", "id"] },
  crm_memberships: { PRIMARY: [0, "admin_id", "conversation_id", "label_id"], crm_memberships_label: [1, "admin_id", "label_id", "conversation_id"] },
};
const foreignKeys = [
  ["crm_profiles", "crm_profiles_admin_fk", "users", ["admin_id", "admin_role"], ["id", "role"]],
  ["crm_profiles", "crm_profiles_conversation_fk", "conversations", ["conversation_id"], ["id"]],
  ["crm_labels", "crm_labels_owner_fk", "users", ["owner_admin_id", "owner_role"], ["id", "role"]],
  ["crm_memberships", "crm_memberships_profile_fk", "crm_profiles", ["admin_id", "conversation_id"], ["admin_id", "conversation_id"]],
  ["crm_memberships", "crm_memberships_label_fk", "crm_labels", ["admin_id", "label_id"], ["owner_admin_id", "id"]],
];

export function createCrmStore({ pool, chatStore }) {
  if (!pool || typeof pool.getConnection !== "function" || !chatStore || typeof chatStore.withActor !== "function" || typeof chatStore.withConversation !== "function") input();
  const withActor = (request, callback) => { requestValue(request); return chatStore.withActor({ ...request, role: "admin" }, callback); };
  const withConversation = (request, callback) => { requestValue(request); bytes(request.conversationId); return chatStore.withConversation({ ...request, role: "admin" }, callback); };
  async function ownedLabel(connection, adminId, labelId, kind = null) {
    const row = (await connection.query(`SELECT ${labelProjection}, ${memberCountSql} AS member_count FROM crm_labels l
      WHERE l.id = ? AND l.owner_admin_id = ? FOR UPDATE`, [labelId, adminId]))[0];
    if (!row || (kind !== null && row.kind !== kind)) fail("CRM_NOT_FOUND"); return row;
  }
  async function batchLabels(connection, adminId, conversationIds) {
    const result = new Map(conversationIds.map((id) => [id.toString("hex"), []])); if (!conversationIds.length) return result;
    const rows = await connection.query(`SELECT mb.conversation_id, ${labelProjection}, ${memberCountSql} AS member_count
      FROM crm_memberships mb JOIN crm_labels l ON l.id = mb.label_id AND l.owner_admin_id = mb.admin_id
      JOIN conversations c ON c.id = mb.conversation_id AND c.admin_id = mb.admin_id
      WHERE mb.admin_id = ? AND mb.conversation_id IN (${placeholders(conversationIds)}) ORDER BY l.id ASC`, [adminId, ...conversationIds]);
    for (const row of rows) result.get(row.conversation_id.toString("hex")).push(rawLabel(row)); return result;
  }
  async function profile(connection, context) {
    const { actor, client, conversation, now } = context;
    const row = (await connection.query("SELECT nickname, notes_encrypted, notes_revision, reminder_at, version, updated_at FROM crm_profiles WHERE admin_id = ? AND conversation_id = ? FOR UPDATE", [actor.id, conversation.id]))[0];
    const contact = (await connection.query("SELECT email FROM users WHERE id = ?", [client.id]))[0]; if (!contact) state();
    const labels = (await batchLabels(connection, actor.id, [conversation.id])).get(conversation.id.toString("hex"));
    return { conversationId: conversation.id, client: { id: client.id, pseudonym: client.pseudonym, email: contact.email, status: client.status },
      access: accessDto(client, now), nickname: row?.nickname ?? "", notesEncrypted: row?.notes_encrypted ?? null,
      notesRevision: row ? storedVersion(row.notes_revision) : "0", reminderAt: row ? nullableDate(row.reminder_at) : null,
      version: row ? storedVersion(row.version) : "0", updatedAt: row ? timestamp(row.updated_at) : null, labels };
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
        if (history.length < 20 || history.some((item) => item.state !== "applied")) state();
        const tables = await connection.query("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
        const columns = await connection.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType, IS_NULLABLE AS nullable,
          CHARACTER_MAXIMUM_LENGTH AS length, DATETIME_PRECISION AS precisionValue, COLUMN_TYPE AS columnType, COLLATION_NAME AS collationName
          FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`, [database]);
        for (const [table, fields] of Object.entries(definitions)) {
          if (!tables.some((item) => item.name === table && item.engine === "InnoDB")) state();
          for (const [name, [type, nullable, length, collation]] of Object.entries(fields)) {
            const column = columns.find((item) => item.tableName === table && item.columnName === name);
            if (!column || column.dataType !== type || (column.nullable === "YES") !== nullable || (length !== undefined && Number(column.length) !== length)
              || (type === "datetime" && Number(column.precisionValue) !== 6) || (type === "int" && !column.columnType.includes("unsigned"))
              || (collation !== undefined && column.collationName !== collation)) state();
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
            const actual = checks.find((item) => item.tableName === table && item.name === name); if (!actual || checkTree(actual.clause) !== checkTree(expression)) state();
          }
          await connection.query(`SELECT ${Object.keys(definitions[table]).join(", ")} FROM ${table} WHERE 1 = 0`);
        }
        return true;
      } catch (error) { if (error instanceof ChatStoreError) throw error; fail("CRM_DATABASE_OPERATION"); }
      finally { if (connection) { try { connection.release(); } catch {} } }
    },

    async listLabels({ tokenHash, now, kind = null, afterId = null, limit = 100 }) {
      if (kind !== null) kindValue(kind); if (afterId !== null) bytes(afterId); limitValue(limit);
      return withActor({ tokenHash, now }, async (connection, context) => {
        const rows = await connection.query(`SELECT ${labelProjection}, ${memberCountSql} AS member_count FROM crm_labels l
          WHERE l.owner_admin_id = ? ${kind === null ? "" : "AND l.kind = ?"} ${afterId === null ? "" : "AND l.id > ?"} ORDER BY l.id ASC LIMIT ?`,
        [context.actor.id, ...(kind === null ? [] : [kind]), ...(afterId === null ? [] : [afterId]), limit + 1]);
        const selected = rows.slice(0, limit), hasMore = rows.length > limit;
        return { labels: selected.map(rawLabel), nextCursor: hasMore ? selected.at(-1).id : null, hasMore };
      });
    },

    async createLabel({ tokenHash, now, label }) {
      bytes(label?.id); kindValue(label.kind); textValue(label.name, 64); textValue(label.normalizedName, 128);
      return withActor({ tokenHash, now }, async (connection, context) => {
        now = context.now;
        const previous = (await connection.query(`SELECT ${labelProjection}, ${memberCountSql} AS member_count FROM crm_labels l
          WHERE l.owner_admin_id = ? AND l.kind = ? AND l.normalized_name = ? FOR UPDATE`, [context.actor.id, label.kind, label.normalizedName]))[0];
        if (previous) return { label: rawLabel(previous), duplicate: true };
        const count = Number((await connection.query("SELECT COUNT(*) AS value FROM crm_labels WHERE owner_admin_id = ? AND kind = ?", [context.actor.id, label.kind]))[0].value);
        if (count >= 100) fail("CRM_LIMIT");
        await connection.query(`INSERT INTO crm_labels (id, owner_admin_id, kind, name, normalized_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [label.id, context.actor.id, label.kind, label.name, label.normalizedName, sqlDate(now), sqlDate(now)]);
        return { label: rawLabel(await ownedLabel(connection, context.actor.id, label.id)), duplicate: false };
      });
    },

    async renameLabel({ tokenHash, now, labelId, expectedVersion, name, normalizedName }) {
      bytes(labelId); versionValue(expectedVersion, false); textValue(name, 64); textValue(normalizedName, 128);
      return withActor({ tokenHash, now }, async (connection, context) => {
        now = context.now;
        const previous = await ownedLabel(connection, context.actor.id, labelId);
        if (storedVersion(previous.version) !== expectedVersion) fail("CRM_CONFLICT");
        const collision = await connection.query("SELECT id FROM crm_labels WHERE owner_admin_id = ? AND kind = ? AND normalized_name = ? AND id <> ? LIMIT 1", [context.actor.id, previous.kind, normalizedName, labelId]);
        if (collision.length) fail("CRM_NAME_CONFLICT");
        const next = nextVersion(expectedVersion);
        if (timestamp(previous.updated_at) > now) state();
        await connection.query("UPDATE crm_labels SET name = ?, normalized_name = ?, version = ?, updated_at = ? WHERE id = ? AND owner_admin_id = ?", [name, normalizedName, next, sqlDate(now), labelId, context.actor.id]);
        return rawLabel(await ownedLabel(connection, context.actor.id, labelId));
      });
    },

    async deleteLabel({ tokenHash, now, labelId, expectedVersion }) {
      bytes(labelId); versionValue(expectedVersion, false);
      return withActor({ tokenHash, now }, async (connection, context) => {
        // The owner lock may have waited behind a valid profile save. Compare
        // its dates with the live authorization time, not the request's start.
        now = context.now;
        const label = await ownedLabel(connection, context.actor.id, labelId);
        if (storedVersion(label.version) !== expectedVersion) fail("CRM_CONFLICT");
        // The owner account lock serializes all profile saves. Detect overflow
        // with a bounded result, then let the bulk UPDATE lock affected rows.
        // A popular label does not materialize every client profile in memory.
        const invalid = (await connection.query(`SELECT p.version, p.updated_at FROM crm_profiles p JOIN crm_memberships m
          ON m.admin_id = p.admin_id AND m.conversation_id = p.conversation_id WHERE m.admin_id = ? AND m.label_id = ?
          AND (p.version = 4294967295 OR p.updated_at > ?) LIMIT 1 FOR UPDATE`, [context.actor.id, labelId, sqlDate(now)]))[0];
        if (invalid) { nextVersion(storedVersion(invalid.version)); state(); }
        // Optimistic profile revisions change, but notes retain their original
        // encryption revision. No note decryption or re-encryption is needed.
        await connection.query(`UPDATE crm_profiles p JOIN crm_memberships m ON m.admin_id = p.admin_id AND m.conversation_id = p.conversation_id
          SET p.version = p.version + 1, p.updated_at = ? WHERE m.admin_id = ? AND m.label_id = ?`, [sqlDate(now), context.actor.id, labelId]);
        await connection.query("DELETE FROM crm_memberships WHERE admin_id = ? AND label_id = ?", [context.actor.id, labelId]);
        await connection.query("DELETE FROM crm_labels WHERE owner_admin_id = ? AND id = ?", [context.actor.id, labelId]);
        return { deleted: true };
      });
    },

    async getProfile(request) { return withConversation(request, profile); },

    async saveProfile({ tokenHash, now, conversationId, expectedVersion, nickname, notesEncrypted, reminderAt, labelIds }) {
      versionValue(expectedVersion); textValue(nickname, 64, true);
      if (notesEncrypted !== null && (typeof notesEncrypted !== "string" || notesEncrypted.length < 1 || notesEncrypted.length > 44000 || /[^\x20-\x7e]/.test(notesEncrypted))) input();
      if (reminderAt !== null) instant(reminderAt);
      if (!Array.isArray(labelIds) || labelIds.length > 32) input(); for (const labelId of labelIds) bytes(labelId);
      if (new Set(labelIds.map((value) => value.toString("hex"))).size !== labelIds.length) input();
      return withConversation({ tokenHash, now, conversationId }, async (connection, context) => {
        now = context.now;
        const previous = (await connection.query("SELECT version, updated_at FROM crm_profiles WHERE admin_id = ? AND conversation_id = ? FOR UPDATE", [context.actor.id, conversationId]))[0];
        if ((previous ? storedVersion(previous.version) : "0") !== expectedVersion) fail("CRM_CONFLICT");
        const next = nextVersion(expectedVersion); if (previous && timestamp(previous.updated_at) > now) state();
        // Resolve every membership under the current owner before writing any
        // profile field, so a missing/foreign label cannot partially save notes.
        if (labelIds.length) {
          const labels = await connection.query(`SELECT id FROM crm_labels WHERE owner_admin_id = ? AND id IN (${placeholders(labelIds)}) ORDER BY id FOR UPDATE`, [context.actor.id, ...labelIds]);
          if (labels.length !== labelIds.length) fail("CRM_NOT_FOUND");
        }
        if (!previous) await connection.query(`INSERT INTO crm_profiles (admin_id, conversation_id, nickname, notes_encrypted, reminder_at, version, notes_revision, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [context.actor.id, conversationId, nickname, notesEncrypted, reminderAt === null ? null : sqlDate(reminderAt), next, next, sqlDate(now), sqlDate(now)]);
        else await connection.query(`UPDATE crm_profiles SET nickname = ?, notes_encrypted = ?, reminder_at = ?, version = ?, notes_revision = ?, updated_at = ?
          WHERE admin_id = ? AND conversation_id = ?`, [nickname, notesEncrypted, reminderAt === null ? null : sqlDate(reminderAt), next, next, sqlDate(now), context.actor.id, conversationId]);
        await connection.query("DELETE FROM crm_memberships WHERE admin_id = ? AND conversation_id = ?", [context.actor.id, conversationId]);
        for (const labelId of labelIds) await connection.query("INSERT INTO crm_memberships (admin_id, conversation_id, label_id, created_at) VALUES (?, ?, ?, ?)", [context.actor.id, conversationId, labelId, sqlDate(now)]);
        return profile(connection, context);
      });
    },

    async listContacts({ tokenHash, now, q = "", tagId = null, groupId = null, access = "all", unread = false, reminder = "all", afterId = null, limit = 50 }) {
      textValue(q, 80, true); limitValue(limit); for (const value of [tagId, groupId, afterId]) if (value !== null) bytes(value);
      if (!["all", "active", "pending", "expired", "revoked", "suspended", "deleted"].includes(access) || typeof unread !== "boolean" || !["all", "due", "upcoming", "none"].includes(reminder)) input();
      return withActor({ tokenHash, now }, async (connection, context) => {
        now = context.now;
        const owner = context.actor.id, date = sqlDate(now), where = ["c.admin_id = ?", "c.created_at <= ?"], parameters = [owner, date];
        if (q) { where.push("(LOCATE(LOWER(?), LOWER(u.pseudonym)) > 0 OR LOCATE(LOWER(?), LOWER(COALESCE(p.nickname, ''))) > 0 OR LOCATE(LOWER(?), LOWER(u.email)) > 0)"); parameters.push(q, q, q); }
        for (const [labelId, kind] of [[tagId, "tag"], [groupId, "group"]]) if (labelId !== null) {
          await ownedLabel(connection, owner, labelId, kind);
          where.push("EXISTS (SELECT 1 FROM crm_memberships f WHERE f.admin_id = c.admin_id AND f.conversation_id = c.id AND f.label_id = ?)"); parameters.push(labelId);
        }
        if (access !== "all") { where.push(`(${accessStateSql}) = ?`); parameters.push(date, date, date, date, access); }
        if (unread) where.push(`EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> c.admin_id AND m.deleted_at IS NULL
          AND m.sequence_no > COALESCE((SELECT last_read_sequence FROM chat_receipts WHERE conversation_id = c.id AND user_id = c.admin_id), 0))`);
        if (reminder === "none") where.push("p.reminder_at IS NULL");
        if (reminder === "due" || reminder === "upcoming") { where.push(`p.reminder_at ${reminder === "due" ? "<=" : ">"} ?`); parameters.push(date); }
        if (afterId !== null) { where.push("c.id > ?"); parameters.push(afterId); }
        const sql = `SELECT ${contactProjection} ${contactFrom} WHERE ${where.join(" AND ")} ORDER BY c.id ASC LIMIT ?`;
        let rows = await connection.query(sql, [...parameters, limit + 1]);
        if (rows.length) {
          // The administrator account lock already serializes every supported
          // owner mutation. Batch locks make current client status, credentials
          // and assignment explicit without one authorization call per contact.
          const clientIds = rows.map((row) => row.client_id).sort(Buffer.compare), conversationIds = rows.map((row) => row.id).sort(Buffer.compare);
          await connection.query(`SELECT id FROM users WHERE id IN (${placeholders(clientIds)}) ORDER BY id FOR UPDATE`, clientIds);
          await connection.query(`SELECT user_id FROM client_auth_state WHERE user_id IN (${placeholders(clientIds)}) ORDER BY user_id FOR UPDATE`, clientIds);
          const bindings = await connection.query(`SELECT id, admin_id, client_id FROM conversations WHERE id IN (${placeholders(conversationIds)}) ORDER BY id FOR UPDATE`, conversationIds);
          if (bindings.length !== rows.length || bindings.some((row) => !row.admin_id.equals(owner) || !rows.some((initial) => initial.id.equals(row.id) && initial.client_id.equals(row.client_id)))) fail("CRM_NOT_FOUND");
          // READ COMMITTED under the core hook: repeat the filter after locks to
          // avoid returning a row whose live gates changed during discovery.
          rows = await connection.query(sql, [...parameters, limit + 1]);
          if (rows.some((row) => !conversationIds.some((value) => value.equals(row.id)))) fail("CRM_DATABASE_STATE");
        }
        const selected = rows.slice(0, limit), hasMore = rows.length > limit;
        const labels = await batchLabels(connection, owner, selected.map((row) => row.id));
        const contacts = selected.map((row) => {
          const unreadCount = Number(row.unread_count); if (!Number.isSafeInteger(unreadCount) || unreadCount < 0) state();
          const currentAccess = accessDto(row, now);
          return { id: row.id, clientId: row.client_id, clientPseudonym: row.pseudonym, peerPseudonym: row.pseudonym,
            ...(row.peer_avatar_version == null ? {} : { peerAvatarVersion: storedVersion(row.peer_avatar_version) }),
            createdAt: timestamp(row.created_at), closedAt: nullableDate(row.closed_at), lastActivityAt: nullableDate(row.last_activity_at),
            latestSequence: sequence(row.latest_sequence), latestEventSequence: sequence(row.latest_event_sequence), lastReadSequence: sequence(row.last_read_sequence),
            peerReadSequence: sequence(row.peer_read_sequence), unreadCount, canSend: currentAccess.state === "active" && row.closed_at === null,
            nickname: row.nickname ?? "", reminderAt: row.reminder_at === null ? null : timestamp(row.reminder_at), version: row.version === null ? "0" : storedVersion(row.version),
            access: currentAccess, labels: labels.get(row.id.toString("hex")) };
        });
        return { contacts, nextCursor: hasMore ? selected.at(-1).id : null, hasMore };
      });
    },
  });
}
