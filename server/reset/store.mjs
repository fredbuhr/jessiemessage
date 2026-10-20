import { createHash } from "node:crypto";
import { canonicalEmail } from "../auth/config.mjs";
import { createSessionClock } from "../auth/session-policy.mjs";
import { loadMigrations, migrationStatus, MigrationError } from "../db/migrations.mjs";

export class ResetStoreError extends Error {
  constructor(code = "RESET_DATABASE_OPERATION") {
    super("Client password recovery persistence could not be completed.");
    this.name = "ResetStoreError";
    this.code = code;
  }
}

const fail = (code) => { throw new ResetStoreError(code); };
const input = () => fail("RESET_STORE_INPUT"), state = () => fail("RESET_DATABASE_STATE");
const bytes = (value, length = 16) => { if (!Buffer.isBuffer(value) || value.length !== length) input(); return value; };
const instant = (value) => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) input(); return value; };
const version = (value) => { if (!Number.isSafeInteger(value) || value < 1 || value > 4294967295) input(); return value; };
const storedVersion = (value) => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1 || result > 4294967295) state(); return result; };
const sqlDate = (value) => new Date(instant(value)).toISOString().replace("T", " ").replace("Z", "000");
const timestamp = (value) => {
  if (value instanceof Date && Number.isSafeInteger(value.getTime()) && value.getTime() >= 0) return value.getTime();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) state();
  const result = Date.parse(`${value.replace(" ", "T")}Z`); if (!Number.isSafeInteger(result) || result < 0) state(); return result;
};
const emailDigest = (email) => createHash("sha256").update(email, "utf8").digest();
const canonical = (email) => { try { const result = canonicalEmail(email); return result === email ? result : null; } catch { return null; } };
const password = (value) => { if (typeof value !== "string" || value.length < 1 || value.length > 255 || /[^\x20-\x7e]/.test(value)) input(); };

async function run(pool, operation, transaction = false) {
  let connection, begun = false;
  try {
    connection = await pool.getConnection();
    if (transaction) { await connection.beginTransaction(); begun = true; }
    const result = await operation(connection);
    if (begun) await connection.commit();
    return result;
  } catch (error) {
    if (begun) { try { await connection.rollback(); } catch {} }
    if (error instanceof ResetStoreError) throw error;
    if (error instanceof MigrationError) state();
    fail("RESET_DATABASE_OPERATION");
  } finally { if (connection) { try { connection.release(); } catch {} } }
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
  client_password_resets: { id: ["varbinary", false, 16], user_id: ["varbinary", false, 16], token_hash: ["varbinary", false, 32], credential_version: ["int", false], email_hash: ["varbinary", false, 32], created_at: ["datetime", false], expires_at: ["datetime", false], consumed_at: ["datetime", true], revoked_at: ["datetime", true] },
  password_reset_outbox: { id: ["varbinary", false, 16], reset_id: ["varbinary", false, 16], recipient_user_id: ["varbinary", false, 16], payload_encrypted: ["varchar", false, 1024, "ascii_bin"], status: ["varchar", false, 16, "ascii_bin"], attempts: ["smallint", false], available_at: ["datetime", false], expires_at: ["datetime", false], created_at: ["datetime", false], lease_token: ["varbinary", true, 16], lease_until: ["datetime", true], sent_at: ["datetime", true], last_error: ["varchar", true, 32, "ascii_bin"] },
};
const indexes = {
  client_password_resets: { PRIMARY: [0, "id"], client_password_resets_token_hash: [0, "token_hash"], client_password_resets_id_user: [0, "id", "user_id"], client_password_resets_user: [1, "user_id", "created_at"], client_password_resets_expiry: [1, "expires_at"] },
  password_reset_outbox: { PRIMARY: [0, "id"], password_reset_outbox_ready: [1, "status", "available_at"], password_reset_outbox_lease: [1, "lease_until"], password_reset_outbox_expiry: [1, "expires_at"], password_reset_outbox_sent: [1, "sent_at"], password_reset_outbox_reset: [1, "reset_id", "recipient_user_id"] },
};
const foreignKeys = [
  ["client_password_resets", "client_password_reset_user_fk", "client_auth_state", ["user_id"], ["user_id"]],
  ["password_reset_outbox", "password_reset_outbox_reset_fk", "client_password_resets", ["reset_id", "recipient_user_id"], ["id", "user_id"]],
];

export async function assertResetSchema(pool) {
  if (!pool || typeof pool.getConnection !== "function") input();
  return run(pool, async (connection) => {
    const migrations = await loadMigrations(), database = (await connection.query("SELECT DATABASE() AS name"))[0].name;
    const status = await migrationStatus(connection, { database, migrations });
    if (migrations.length < 22 || status.some((item) => item.state !== "applied")) state();
    const enforcement = (await connection.query("SELECT @@SESSION.foreign_key_checks AS foreignKeys, @@SESSION.check_constraint_checks AS checkConstraints"))[0];
    if (Number(enforcement.foreignKeys) !== 1 || Number(enforcement.checkConstraints) !== 1) state();
    const tables = await connection.query("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
    const actualColumns = await connection.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType,
      IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS length, DATETIME_PRECISION AS precisionValue,
      COLUMN_TYPE AS columnType, COLLATION_NAME AS collationName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`, [database]);
    const actualIndexes = await connection.query(`SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, COLUMN_NAME AS columnName,
      NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS positionValue, SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?`, [database]);
    const actualKeys = await connection.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, COLUMN_NAME AS columnName,
      REFERENCED_TABLE_NAME AS parentTable, REFERENCED_COLUMN_NAME AS parentColumn, ORDINAL_POSITION AS positionValue
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
          || (["credential_version", "attempts"].includes(name) && !column.columnType.toLowerCase().includes("unsigned"))) state();
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
      if (actual.length !== children.length || actual.some((item, index) => item.parentTable !== parent || item.columnName !== children[index] || item.parentColumn !== parents[index])
        || !rules.some((item) => item.tableName === table && item.constraintName === name && item.updateRule === "RESTRICT" && item.deleteRule === "RESTRICT")) state();
    }
    await connection.query("SELECT id, user_id, token_hash, credential_version, email_hash, created_at, expires_at, consumed_at, revoked_at FROM client_password_resets WHERE 1 = 0");
    await connection.query(`SELECT id, reset_id, recipient_user_id, payload_encrypted, status, attempts, available_at, expires_at,
      created_at, lease_token, lease_until, sent_at, last_error FROM password_reset_outbox WHERE 1 = 0`);
    return true;
  });
}

const eligible = (user, auth, now) => {
  if (!user || user.role !== "client" || !["active", "pending"].includes(user.status) || !auth
    || user.email_verified_at === null || timestamp(user.email_verified_at) > now
    || typeof user.password_hash !== "string" || !user.password_hash.length || !canonical(user.email)) return false;
  return storedVersion(auth.credential_version) < 4294967295;
};
const liveReset = (reset, user, auth, now) => Boolean(reset && reset.user_id.equals(user.id)
  && reset.consumed_at === null && reset.revoked_at === null && timestamp(reset.created_at) <= now
  && now < timestamp(reset.expires_at) && timestamp(reset.expires_at) <= timestamp(reset.created_at) + 1800000
  && storedVersion(reset.credential_version) === storedVersion(auth.credential_version)
  && Buffer.isBuffer(reset.email_hash) && reset.email_hash.equals(emailDigest(user.email)));

export function createResetStore(pool, { clock } = {}) {
  if (!pool || typeof pool.getConnection !== "function") input();
  const currentTime = createSessionClock(clock);
  async function lockedContext(connection, tokenHash, now) {
    const candidate = (await connection.query("SELECT user_id FROM client_password_resets WHERE token_hash = ? LIMIT 1", [tokenHash]))[0];
    if (!candidate) return null;
    const user = (await connection.query("SELECT id, role, status, email, email_verified_at, password_hash FROM users WHERE id = ? FOR UPDATE", [candidate.user_id]))[0];
    if (!user) return null;
    const auth = (await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ? FOR UPDATE", [user.id]))[0];
    const reset = (await connection.query("SELECT * FROM client_password_resets WHERE token_hash = ? FOR UPDATE", [tokenHash]))[0];
    // The token lock may outlive its deadline. Share the post-lock instant with
    // the credential writes instead of reviving the caller's earlier instant.
    now = currentTime(now);
    return eligible(user, auth, now) && liveReset(reset, user, auth, now) ? { user, auth, reset, now } : null;
  }
  async function cancelMail(connection, userId) {
    await connection.query(`UPDATE password_reset_outbox SET status = 'cancelled', lease_token = NULL, lease_until = NULL, last_error = NULL
      WHERE recipient_user_id = ? AND status IN ('pending', 'sending', 'failed')`, [userId]);
  }
  return Object.freeze({
    assertSchema: () => assertResetSchema(pool),
    async requestReset({ email, now, reset, mail }) {
      if (!canonical(email)) input(); instant(now); bytes(reset?.id); bytes(reset?.tokenHash, 32); instant(reset?.expiresAt); bytes(mail?.id);
      if (reset.expiresAt <= now || reset.expiresAt - now > 1800000 || typeof mail?.payloadEncrypted !== "string"
        || mail.payloadEncrypted.length < 1 || mail.payloadEncrypted.length > 1024 || /[^\x20-\x7e]/.test(mail.payloadEncrypted)) input();
      return run(pool, async (connection) => {
        const user = (await connection.query("SELECT id, role, status, email, email_verified_at, password_hash FROM users WHERE email = ? FOR UPDATE", [email]))[0];
        if (!user) return false;
        const auth = (await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ? FOR UPDATE", [user.id]))[0];
        now = currentTime(now);
        if (!eligible(user, auth, now) || user.email !== email || reset.expiresAt <= now) return false;
        await connection.query(`UPDATE client_password_resets SET revoked_at = GREATEST(created_at, ?)
          WHERE user_id = ? AND consumed_at IS NULL AND revoked_at IS NULL`, [sqlDate(now), user.id]);
        await cancelMail(connection, user.id);
        await connection.query(`INSERT INTO client_password_resets (id, user_id, token_hash, credential_version, email_hash, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [reset.id, user.id, reset.tokenHash, storedVersion(auth.credential_version), emailDigest(user.email), sqlDate(now), sqlDate(reset.expiresAt)]);
        await connection.query(`INSERT INTO password_reset_outbox (id, reset_id, recipient_user_id, payload_encrypted, available_at, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [mail.id, reset.id, user.id, mail.payloadEncrypted, sqlDate(now), sqlDate(reset.expiresAt), sqlDate(now)]);
        return true;
      }, true);
    },
    async inspectReset({ tokenHash, now }) {
      bytes(tokenHash, 32); instant(now);
      return run(pool, async (connection) => {
        const context = await lockedContext(connection, tokenHash, now);
        return context ? { userId: context.user.id, credentialVersion: storedVersion(context.auth.credential_version) } : null;
      }, true);
    },
    async consumeReset({ tokenHash, expectedUserId, expectedVersion, passwordHash, now }) {
      bytes(tokenHash, 32); bytes(expectedUserId); version(expectedVersion); password(passwordHash); instant(now);
      return run(pool, async (connection) => {
        const context = await lockedContext(connection, tokenHash, now);
        if (!context || !context.user.id.equals(expectedUserId) || storedVersion(context.auth.credential_version) !== expectedVersion) return false;
        const { user, reset } = context;
        now = context.now;
        await connection.query("UPDATE users SET password_hash = ?, updated_at = GREATEST(updated_at, ?) WHERE id = ?", [passwordHash, sqlDate(now), user.id]);
        await connection.query("UPDATE client_auth_state SET credential_version = credential_version + 1 WHERE user_id = ?", [user.id]);
        await connection.query("UPDATE client_password_resets SET consumed_at = ? WHERE id = ?", [sqlDate(now), reset.id]);
        await connection.query(`UPDATE client_password_resets SET revoked_at = GREATEST(created_at, ?)
          WHERE user_id = ? AND id <> ? AND consumed_at IS NULL AND revoked_at IS NULL`, [sqlDate(now), user.id, reset.id]);
        // Include anomalous future-dated sessions while respecting their CHECK.
        await connection.query("UPDATE sessions SET revoked_at = GREATEST(created_at, ?) WHERE user_id = ? AND revoked_at IS NULL", [sqlDate(now), user.id]);
        await cancelMail(connection, user.id);
        return true;
      }, true);
    },
  });
}
