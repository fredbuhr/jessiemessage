import { createHash } from "node:crypto";
import { loadMigrations, migrationStatus } from "../db/migrations.mjs";

export class AuthStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuthStoreError";
    this.code = code;
  }
}

const invalid = () => { throw new AuthStoreError("AUTH_STORE_INPUT", "Invalid authentication persistence input."); };
const bytes = (value, size) => { if (!Buffer.isBuffer(value) || value.length !== size) invalid(); return value; };
const instant = (value) => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) invalid(); return value; };
const sqlDate = (value) => new Date(instant(value)).toISOString().replace("T", " ").replace("Z", "000");
const fromSqlDate = (value) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) {
    throw new AuthStoreError("AUTH_DATABASE_STATE", "Authentication database timestamps are invalid.");
  }
  const result = Date.parse(`${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(result)) throw new AuthStoreError("AUTH_DATABASE_STATE", "Authentication database timestamps are invalid.");
  return result;
};

// Runtime startup checks read-only metadata as well as access. A manually rebuilt
// table must not silently remove uniqueness or change security-critical column types.
const schemaColumns = {
  users: { id: ["varbinary", false, 16], role: ["varchar", false, 8], status: ["varchar", false, 16], pseudonym: ["varchar", false, 64], email: ["varchar", false, 254], password_hash: ["varchar", true, 255] },
  sessions: { id: ["varbinary", false, 16], user_id: ["varbinary", false, 16], token_hash: ["varbinary", false, 32], created_at: ["datetime", false], expires_at: ["datetime", false], revoked_at: ["datetime", true] },
  admin_mfa: { user_id: ["varbinary", false, 16], role: ["varchar", false, 8], secret_encrypted: ["varchar", false, 512], version: ["int", false], last_totp_step: ["bigint", false], enabled_at: ["datetime", true] },
  admin_recovery_codes: { user_id: ["varbinary", false, 16], code_hash: ["varbinary", false, 32], mfa_version: ["int", false], created_at: ["datetime", false], consumed_at: ["datetime", true] },
  auth_session_state: { session_id: ["varbinary", false, 16], last_seen_at: ["datetime", false], mfa_verified_at: ["datetime", false], mfa_version: ["int", false] },
  auth_rate_limits: { bucket_hash: ["varbinary", false, 32], window_started_at: ["datetime", false], attempts: ["int", false] },
};
const schemaKeys = {
  users: { PRIMARY: ["id"], users_email: ["email"], users_id_role: ["id", "role"] },
  sessions: { PRIMARY: ["id"], sessions_token_hash: ["token_hash"] },
  admin_mfa: { PRIMARY: ["user_id"] },
  admin_recovery_codes: { PRIMARY: ["user_id", "code_hash"] },
  auth_session_state: { PRIMARY: ["session_id"] },
  auth_rate_limits: { PRIMARY: ["bucket_hash"] },
};
const schemaStateError = () => { throw new AuthStoreError("AUTH_DATABASE_STATE", "Authentication requires the applied, intact database schema."); };

export function createAuthStore(pool) {
  let nextRatePruneAt = 0;
  async function withConnection(operation, transaction = false) {
    let connection;
    let started = false;
    try {
      connection = await pool.getConnection();
      if (transaction) { await connection.beginTransaction(); started = true; }
      const result = await operation(connection);
      if (started) await connection.commit();
      return result;
    } catch (error) {
      if (started) { try { await connection.rollback(); } catch {} }
      if (error instanceof AuthStoreError) throw error;
      throw new AuthStoreError("AUTH_DATABASE_OPERATION", "Authentication database operation failed.");
    } finally {
      // Releasing an already committed connection must not overwrite a successful
      // bootstrap result (and make the CLI discard its only private setup file).
      if (connection) { try { connection.release(); } catch {} }
    }
  }

  return {
    async assertSchema() {
      return withConnection(async (connection) => {
        const projections = [
          "SELECT id, role, status, pseudonym, email, password_hash FROM users WHERE 1 = 0",
          "SELECT id, user_id, token_hash, created_at, expires_at, revoked_at FROM sessions WHERE 1 = 0",
          "SELECT user_id, role, secret_encrypted, version, last_totp_step, enabled_at FROM admin_mfa WHERE 1 = 0",
          "SELECT user_id, code_hash, mfa_version, created_at, consumed_at FROM admin_recovery_codes WHERE 1 = 0",
          "SELECT session_id, last_seen_at, mfa_verified_at, mfa_version FROM auth_session_state WHERE 1 = 0",
          "SELECT bucket_hash, window_started_at, attempts FROM auth_rate_limits WHERE 1 = 0",
        ];
        for (const projection of projections) await connection.query(projection);
        const database = (await connection.query("SELECT DATABASE() AS name"))[0].name;
        const status = await migrationStatus(connection, { database, migrations: await loadMigrations() });
        if (status.some((migration) => migration.state !== "applied")) schemaStateError();
        const columns = await connection.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName,
          DATA_TYPE AS dataType, IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS length,
          DATETIME_PRECISION AS precisionValue FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`, [database]);
        for (const [table, definitions] of Object.entries(schemaColumns)) {
          for (const [name, [type, nullable, length]] of Object.entries(definitions)) {
            const column = columns.find((item) => item.tableName === table && item.columnName === name);
            if (!column || column.dataType !== type || (column.nullable === "YES") !== nullable
              || (length !== undefined && Number(column.length) !== length)
              || (type === "datetime" && Number(column.precisionValue) !== 6)) schemaStateError();
          }
        }
        const keys = await connection.query(`SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName,
          COLUMN_NAME AS columnName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS positionValue
          FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?`, [database]);
        for (const [table, definitions] of Object.entries(schemaKeys)) {
          for (const [name, expected] of Object.entries(definitions)) {
            const actual = keys.filter((item) => item.tableName === table && item.indexName === name)
              .sort((left, right) => Number(left.positionValue) - Number(right.positionValue));
            if (actual.length !== expected.length || actual.some((item, index) => Number(item.nonUnique) !== 0 || item.columnName !== expected[index])) schemaStateError();
          }
        }
        return true;
      });
    },

    async getLoginRecord(email) {
      if (typeof email !== "string" || !email.length || email.length > 254) invalid();
      return withConnection(async (connection) => {
        const rows = await connection.query("SELECT id, role, status, password_hash FROM users WHERE email = ? LIMIT 1", [email]);
        const user = rows[0];
        return user ? { id: user.id, role: user.role, status: user.status, passwordHash: user.password_hash } : null;
      });
    },

    async consumeRateLimit(bucketHash, { now, windowSeconds, limit }) {
      bytes(bucketHash, 32); instant(now);
      if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86400
        || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000000) invalid();
      return withConnection(async (connection) => {
        // The upsert holds the exclusive row lock before reading the count. This avoids
        // a shared-to-exclusive lock upgrade when simultaneous requests hit one bucket.
        await connection.query(`INSERT INTO auth_rate_limits (bucket_hash, window_started_at, attempts)
          VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE
          attempts = CASE WHEN window_started_at <= DATE_SUB(?, INTERVAL ? SECOND)
            THEN 1 ELSE LEAST(attempts + 1, 4294967295) END,
          window_started_at = CASE WHEN window_started_at <= DATE_SUB(?, INTERVAL ? SECOND)
            THEN ? ELSE window_started_at END`, [bucketHash, sqlDate(now), sqlDate(now), windowSeconds, sqlDate(now), windowSeconds, sqlDate(now)]);
        const row = (await connection.query("SELECT window_started_at, attempts FROM auth_rate_limits WHERE bucket_hash = ? FOR UPDATE", [bucketHash]))[0];
        const started = fromSqlDate(row.window_started_at);
        const attempts = Number(row.attempts);
        if (now >= nextRatePruneAt && now >= 86400000) {
          nextRatePruneAt = now + 300000;
          await connection.query("DELETE FROM auth_rate_limits WHERE window_started_at < ? LIMIT 2000", [sqlDate(now - 86400000)]);
        }
        return { allowed: attempts <= limit, retryAfter: Math.max(1, Math.ceil((started + windowSeconds * 1000 - now) / 1000)) };
      }, true);
    },

    async completeAdminLogin({ userId, expectedPasswordHash, now, factorCheck, session }) {
      bytes(userId, 16); instant(now); bytes(session?.id, 16); bytes(session?.tokenHash, 32); instant(session?.expiresAt);
      if (typeof expectedPasswordHash !== "string" || typeof factorCheck !== "function" || session.expiresAt <= now) invalid();
      return withConnection(async (connection) => {
        const user = (await connection.query("SELECT role, status, password_hash FROM users WHERE id = ? FOR UPDATE", [userId]))[0];
        if (!user || user.role !== "admin" || user.status !== "active" || user.password_hash !== expectedPasswordHash) return false;
        const mfa = (await connection.query("SELECT secret_encrypted, version, last_totp_step, enabled_at FROM admin_mfa WHERE user_id = ? FOR UPDATE", [userId]))[0];
        if (!mfa) return false;
        const version = Number(mfa.version);
        const lastStep = Number(mfa.last_totp_step);
        const factor = factorCheck({ secretEncrypted: mfa.secret_encrypted, version, lastStep, enabled: mfa.enabled_at !== null });
        if (!factor || (Object.hasOwn(factor, "step") && Object.hasOwn(factor, "recoveryDigest"))) return false;
        if (Number.isSafeInteger(factor.step) && factor.step > lastStep) {
          await connection.query("UPDATE admin_mfa SET last_totp_step = ?, enabled_at = COALESCE(enabled_at, ?) WHERE user_id = ?", [factor.step, sqlDate(now), userId]);
        } else if (Buffer.isBuffer(factor.recoveryDigest) && factor.recoveryDigest.length === 32 && mfa.enabled_at !== null) {
          const recovery = (await connection.query("SELECT mfa_version, consumed_at FROM admin_recovery_codes WHERE user_id = ? AND code_hash = ? FOR UPDATE", [userId, factor.recoveryDigest]))[0];
          if (!recovery || Number(recovery.mfa_version) !== version || recovery.consumed_at !== null) return false;
          await connection.query("UPDATE admin_recovery_codes SET consumed_at = ? WHERE user_id = ? AND code_hash = ?", [sqlDate(now), userId, factor.recoveryDigest]);
        } else return false;
        await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [session.id, userId, session.tokenHash, sqlDate(now), sqlDate(session.expiresAt)]);
        await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, ?)", [session.id, sqlDate(now), sqlDate(now), version]);
        return true;
      }, true);
    },

    async getSession(tokenHash, { now, idleSeconds }) {
      bytes(tokenHash, 32); instant(now);
      if (!Number.isSafeInteger(idleSeconds) || idleSeconds < 1 || idleSeconds > 86400) invalid();
      return withConnection(async (connection) => {
        const row = (await connection.query(`SELECT s.id, s.user_id, s.expires_at, s.revoked_at,
          u.role, u.status, u.pseudonym, a.last_seen_at, a.mfa_version, m.version, m.enabled_at
          FROM sessions s JOIN users u ON u.id = s.user_id
          JOIN auth_session_state a ON a.session_id = s.id JOIN admin_mfa m ON m.user_id = u.id
          WHERE s.token_hash = ? FOR UPDATE`, [tokenHash]))[0];
        if (!row || row.role !== "admin" || row.status !== "active" || row.revoked_at !== null
          || row.enabled_at === null || Number(row.mfa_version) !== Number(row.version)) return null;
        const expiresAt = fromSqlDate(row.expires_at);
        const lastSeen = fromSqlDate(row.last_seen_at);
        if (now >= expiresAt || now >= lastSeen + idleSeconds * 1000 || now < lastSeen) return null;
        if (now - lastSeen >= 60000) await connection.query("UPDATE auth_session_state SET last_seen_at = ? WHERE session_id = ?", [sqlDate(now), row.id]);
        return { id: row.id, userId: row.user_id, role: row.role, pseudonym: row.pseudonym, expiresAt, mfaVersion: Number(row.mfa_version) };
      }, true);
    },

    async revokeSession(tokenHash, { now }) {
      bytes(tokenHash, 32); instant(now);
      return withConnection((connection) => connection.query("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL AND created_at <= ?", [sqlDate(now), tokenHash, sqlDate(now)]).then(() => undefined));
    },

    async revokeAllSessions(userId, { now }) {
      bytes(userId, 16); instant(now);
      return withConnection((connection) => connection.query("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND created_at <= ?", [sqlDate(now), userId, sqlDate(now)]).then(() => undefined));
    },

    async initializeAdmin({ id, email, pseudonym, passwordHash, secretEncrypted, recoveryDigests, now }) {
      bytes(id, 16); instant(now);
      if (typeof email !== "string" || !email.length || email.length > 254 || typeof pseudonym !== "string" || !pseudonym.trim() || pseudonym.length > 64
        || typeof passwordHash !== "string" || !passwordHash.length || passwordHash.length > 255
        || typeof secretEncrypted !== "string" || !secretEncrypted.length || secretEncrypted.length > 512
        || !Array.isArray(recoveryDigests) || recoveryDigests.length !== 8) invalid();
      for (const digest of recoveryDigests) bytes(digest, 32);
      return withConnection(async (connection) => {
        const database = (await connection.query("SELECT DATABASE() AS name"))[0].name;
        const lockName = `jessiemessage:bootstrap:${createHash("sha256").update(database).digest("hex").slice(0, 32)}`;
        const lock = (await connection.query("SELECT GET_LOCK(?, 5) AS acquired", [lockName]))[0].acquired;
        if (Number(lock) !== 1) throw new AuthStoreError("AUTH_BOOTSTRAP_BUSY", "Administrator initialization is already in progress.");
        let begun = false;
        let commitAttempted = false;
        try {
          await connection.beginTransaction();
          begun = true;
          const admins = await connection.query("SELECT id FROM users WHERE role = 'admin' FOR UPDATE");
          if (admins.length) throw new AuthStoreError("AUTH_ADMIN_EXISTS", "An administrator already exists; initialization is first-creation only.");
          await connection.query("INSERT INTO users (id, role, status, pseudonym, email, password_hash, created_at, updated_at) VALUES (?, 'admin', 'active', ?, ?, ?, ?, ?)", [id, pseudonym, email, passwordHash, sqlDate(now), sqlDate(now)]);
          await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step) VALUES (?, ?, 1, -1)", [id, secretEncrypted]);
          for (const digest of recoveryDigests) await connection.query("INSERT INTO admin_recovery_codes (user_id, code_hash, mfa_version, created_at) VALUES (?, ?, 1, ?)", [id, digest, sqlDate(now)]);
          commitAttempted = true;
          await connection.commit();
          return { id };
        } catch (error) {
          if (begun) { try { await connection.rollback(); } catch {} }
          if (commitAttempted) {
            const uncertain = new AuthStoreError("AUTH_BOOTSTRAP_UNCERTAIN", "Administrator initialization outcome requires private database inspection; preserve the setup file.");
            uncertain.preserveSetupFile = true;
            throw uncertain;
          }
          throw error;
        } finally {
          try { await connection.query("SELECT RELEASE_LOCK(?)", [lockName]); } catch {}
        }
      });
    },
  };
}
