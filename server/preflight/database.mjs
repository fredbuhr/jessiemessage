import { stat } from "node:fs/promises";
import { createRuntimePool, runtimeDatabaseOptions } from "../db/runtime.mjs";
import { inspectHistory, loadMigrations, validateMigrationPlan } from "../db/migrations.mjs";

export const DATABASE_CHECK_NAMES = Object.freeze([
  "config", "connection", "identity", "engine", "transport", "privileges", "history", "schema_reads", "cleanup",
]);

// These projections check table/column readability only. They intentionally do not
// replace the physical schema assertions performed by a configured server.
const projections = Object.freeze({
  users: "id, role, status, pseudonym, email, password_hash, email_verified_at, age_assured_at, access_approved_at, access_expires_at, created_at, updated_at",
  invitations: "id, token_hash, created_by_id, created_by_role, created_at, expires_at, access_days, consumed_at, consumed_by_id, consumed_by_role, revoked_at",
  sessions: "id, user_id, token_hash, created_at, expires_at, revoked_at",
  conversations: "id, client_id, client_role, admin_id, admin_role, created_at, closed_at",
  admin_mfa: "user_id, role, secret_encrypted, version, last_totp_step, enabled_at",
  admin_recovery_codes: "user_id, code_hash, mfa_version, created_at, consumed_at",
  auth_session_state: "session_id, last_seen_at, mfa_verified_at, mfa_version",
  auth_rate_limits: "bucket_hash, window_started_at, attempts",
  client_auth_state: "user_id, role, credential_version, age_declared_at",
  email_verifications: "id, user_id, token_hash, created_at, expires_at, consumed_at, revoked_at",
  client_session_state: "session_id, last_seen_at, credential_version",
  mail_outbox: "id, verification_id, recipient_user_id, payload_encrypted, status, attempts, available_at, expires_at, created_at, lease_token, lease_until, sent_at, last_error",
  messages: "id, conversation_id, sequence_no, sender_id, sender_role, client_message_id, body_encrypted, body_fingerprint, created_at, deleted_at",
  chat_receipts: "conversation_id, user_id, last_read_sequence, updated_at",
  chat_events: "conversation_id, event_sequence, message_id, kind, occurred_at",
  media_assets: "id, owner_id, owner_role, storage_key, content_digest, active_digest, mime, width, height, thumbnail_width, thumbnail_height, full_bytes, thumbnail_bytes, created_at, deleted_at",
  message_media: "message_id, conversation_id, media_id, created_at",
  crm_profiles: "admin_id, admin_role, conversation_id, nickname, notes_encrypted, reminder_at, version, notes_revision, created_at, updated_at",
  crm_labels: "id, owner_admin_id, owner_role, kind, name, normalized_name, version, created_at, updated_at",
  crm_memberships: "admin_id, conversation_id, label_id, created_at",
  client_password_resets: "id, user_id, token_hash, credential_version, email_hash, created_at, expires_at, consumed_at, revoked_at",
  password_reset_outbox: "id, reset_id, recipient_user_id, payload_encrypted, status, attempts, available_at, expires_at, created_at, lease_token, lease_until, sent_at, last_error",
  broadcast_preferences: "user_id, enabled, version, created_at, updated_at",
  broadcast_campaigns: "id, admin_id, admin_role, client_campaign_id, mfa_version, payload_encrypted, request_fingerprint, media_id, allow_repeat_media, status, created_at, updated_at, expires_at",
  broadcast_recipients: "campaign_id, conversation_id, client_id, proposed_message_id, client_message_id, delivered_message_id, state, reason, attempts, available_at, created_at, lease_token, lease_until, delivered_at",
  media_storage_state: "id, owner_bytes, total_bytes, root_fingerprint, held_bytes, initialized_at",
  media_storage_objects: "id, owner_id, owner_role, storage_key, content_digest, full_bytes, thumbnail_bytes, stored_bytes, state, asset_id, created_at, updated_at, released_at",
});
const tables = Object.keys(projections);
const dml = ["SELECT", "INSERT", "UPDATE", "DELETE"];
const maxGrants = 128;
const maxGrantLength = 16384;

const supportedEngine = (value) => {
  if (typeof value !== "string" || value.length > 256 || !/MariaDB/i.test(value)) return false;
  const version = /^(\d{1,3})\.(\d{1,3})\.\d{1,5}(?:[-+].*)?$/.exec(value);
  return Boolean(version && (Number(version[1]) > 10 || (Number(version[1]) === 10 && Number(version[2]) >= 11)));
};

function identifier(value) {
  const plain = value.startsWith("`") ? value.slice(1, -1).replaceAll("``", "`") : value;
  // MariaDB may print escaped database underscores. Unescaped underscores are
  // accepted for the existing deployment grants; this is not an exclusivity test.
  return /^[a-zA-Z0-9_\\]+$/.test(plain) && !/\\(?!_)/.test(plain) ? plain.replaceAll("\\_", "_") : null;
}

function runtimePrivileges(rows, database) {
  if (!Array.isArray(rows) || !rows.length || rows.length > maxGrants) return false;
  const rights = new Map([...tables, "schema_migrations"].map((table) => [table, new Set()]));
  let totalLength = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object" || Object.keys(row).length !== 1) return false;
    const statement = Object.values(row)[0];
    if (typeof statement !== "string" || statement.length > maxGrantLength
      || (totalLength += statement.length) > 131072 || /\b(?:GRANT|ADMIN)\s+OPTION\b/i.test(statement)) return false;
    const grant = /^GRANT\s+([A-Z ,]+)\s+ON\s+(`(?:``|[^`])+`|\*|[a-zA-Z0-9_\\]+)\.(`(?:``|[^`])+`|\*|[a-zA-Z0-9_]+)\s+TO\s+\S/i.exec(statement);
    if (!grant) return false; // Roles, PROXY, column grants and unknown forms fail closed.
    const privileges = grant[1].split(",").map((part) => part.trim().toUpperCase());
    if (!privileges.length || privileges.some((privilege) => !["USAGE", ...dml].includes(privilege))) return false;
    if (grant[2] === "*") {
      if (grant[3] !== "*" || privileges.some((privilege) => privilege !== "USAGE")) return false;
      continue;
    }
    const grantedDatabase = identifier(grant[2]);
    const grantedTable = grant[3] === "*" ? "*" : identifier(grant[3]);
    if (!grantedDatabase || !grantedTable) return false;
    if (grantedDatabase !== database) continue; // Other named DML scopes are permitted, never queried.
    for (const [table, granted] of rights) {
      if (grantedTable === "*" || grantedTable === table) for (const privilege of privileges) granted.add(privilege);
    }
  }
  return tables.every((table) => dml.every((privilege) => rights.get(table).has(privilege)))
    && rights.get("schema_migrations").has("SELECT");
}

function matchingHistory(plan, rows) {
  validateMigrationPlan(plan);
  if (plan.length !== tables.length || !Array.isArray(rows) || rows.length !== plan.length) return false;
  if (!plan.every((migration, index) => /^CREATE\s+TABLE\s+([a-z][a-z0-9_]*)\s*\(/i.exec(migration.sql.trim())?.[1] === tables[index])) return false;
  if (!rows.every((row) => row && Number.isSafeInteger(Number(row.version)) && Number(row.version) > 0
    && typeof row.name === "string" && row.name.length <= 128
    && typeof row.checksum === "string" && /^[0-9a-f]{64}$/.test(row.checksum)
    && row.state === "applied" && Number.isInteger(Number(row.attempts)) && Number(row.attempts) >= 1 && Number(row.attempts) <= 4294967295)) return false;
  return inspectHistory(plan, rows).every((migration) => migration.state === "applied");
}

// No Promise.race deadline: all actual driver work is drained before releasing
// the single connection and awaiting pool.end(), including on failure.
export async function inspectDatabase({ env = process.env, databaseName } = {}, {
  createPool = createRuntimePool, loadPlan = loadMigrations, signal,
} = {}) {
  const states = new Map(DATABASE_CHECK_NAMES.map((name) => [name, "not_checked"]));
  const result = () => ({
    valid: DATABASE_CHECK_NAMES.every((name) => states.get(name) === "pass"),
    checks: DATABASE_CHECK_NAMES.map((name) => ({ name, status: states.get(name) })),
  });
  let options;
  try {
    options = runtimeDatabaseOptions(env);
    if (typeof databaseName !== "string" || databaseName !== options.database) throw new Error();
    if (env.JESSIEMESSAGE_DB_TLS_CA_PATH) {
      const certificate = await stat(env.JESSIEMESSAGE_DB_TLS_CA_PATH);
      if (!certificate.isFile() || certificate.size > 1048576) throw new Error();
    }
    states.set("config", "pass");
  } catch {
    states.set("config", "fail");
    return result();
  }
  let pool, connection, transactionAttempted = false;
  const checkAbort = () => { if (signal?.aborted) throw new Error(); };
  const query = (command) => { checkAbort(); return connection.query(command); };
  const check = async (name, work) => {
    try { states.set(name, await work() ? "pass" : "fail"); }
    catch { states.set(name, "fail"); }
  };
  try {
    try {
      checkAbort();
      pool = await createPool(env);
      checkAbort();
      connection = await pool.getConnection();
      states.set("connection", "pass");
    } catch {
      states.set("connection", "fail");
    }
    if (connection) {
      let selected;
      await check("identity", async () => {
        selected = await query("SELECT DATABASE() AS database_name, VERSION() AS server_version");
        return Array.isArray(selected) && selected.length === 1 && selected[0]?.database_name === options.database;
      });
      if (states.get("identity") === "pass") {
        states.set("engine", supportedEngine(selected[0]?.server_version) ? "pass" : "fail");
        await check("transport", async () => {
          const rows = await query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
          return options.ssl !== false && Array.isArray(rows) && rows.length === 1
            && rows[0]?.Variable_name === "Ssl_cipher" && typeof rows[0]?.Value === "string"
            && rows[0].Value.length > 0 && rows[0].Value.length <= 256;
        });
        await check("privileges", async () => runtimePrivileges(await query("SHOW GRANTS FOR CURRENT_USER"), options.database));
        if (states.get("engine") === "pass") {
          try {
            await query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
            transactionAttempted = true;
            await query("START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT");
            await check("history", async () => matchingHistory(await loadPlan(), await query({
              sql: "SELECT version, name, checksum, state, attempts FROM schema_migrations ORDER BY version LIMIT 28", timeout: 2000,
            })));
            await check("schema_reads", async () => {
              for (const [table, columns] of Object.entries(projections)) {
                const rows = await query({ sql: `SELECT ${columns} FROM ${table} WHERE 1 = 0`, timeout: 2000 });
                if (!Array.isArray(rows) || rows.length !== 0) return false;
              }
              return true;
            });
          } catch {
            states.set("history", "fail");
            states.set("schema_reads", "fail");
          }
        }
      }
    }
  } finally {
    let clean = true;
    if (connection) {
      if (transactionAttempted) {
        try { await connection.rollback(); } catch { clean = false; }
      }
      try { await connection.release(); } catch { clean = false; }
    }
    if (pool) {
      try { await pool.end(); } catch { clean = false; }
      states.set("cleanup", clean ? "pass" : "fail");
    }
  }
  return result();
}
