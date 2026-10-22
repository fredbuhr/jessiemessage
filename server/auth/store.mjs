import { loadStoreMigrations } from "../db/store-migrations.mjs";
import { createHash } from "node:crypto";
import { createSessionClock, sessionIsValid, adminSessionExpiry, SESSION_TOUCH_MILLISECONDS } from "./session-policy.mjs";
import { migrationStatus } from "../db/migrations.mjs";

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

export function createAuthStore(pool, { clock } = {}) {
  const sessionNow = createSessionClock(clock);
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

  async function lockedAdminSession(connection, tokenHash, now) {
    // A nonlocking candidate lookup must not take a session lock before
    // the account. Login, recovery and administrator mutations all lock
    // users -> admin_mfa -> sessions; keep readers on that same order.
    const candidate = (await connection.query("SELECT user_id FROM sessions WHERE token_hash = ? LIMIT 1", [tokenHash]))[0];
    if (!candidate) return null;
    const user = (await connection.query("SELECT role, status, pseudonym FROM users WHERE id = ? FOR UPDATE", [candidate.user_id]))[0];
    if (!user || user.role !== "admin" || user.status !== "active") return null;
    const mfa = (await connection.query("SELECT version, enabled_at FROM admin_mfa WHERE user_id = ? FOR UPDATE", [candidate.user_id]))[0];
    if (!mfa || mfa.enabled_at === null) return null;
    const enrolledAt = fromSqlDate(mfa.enabled_at);
    const row = (await connection.query(`SELECT s.id, s.user_id, s.created_at, s.expires_at, s.revoked_at,
      a.last_seen_at, a.mfa_verified_at, a.mfa_version FROM sessions s
      JOIN auth_session_state a ON a.session_id = s.id
      WHERE s.token_hash = ? AND s.user_id = ? FOR UPDATE`, [tokenHash, candidate.user_id]))[0];
    if (!row || row.revoked_at !== null || Number(row.mfa_version) !== Number(mfa.version)) return null;
    now = sessionNow(now);
    const createdAt = fromSqlDate(row.created_at);
    let expiresAt = fromSqlDate(row.expires_at);
    const lastSeen = fromSqlDate(row.last_seen_at);
    const verifiedAt = fromSqlDate(row.mfa_verified_at);
    if (enrolledAt > now || verifiedAt < createdAt || verifiedAt < enrolledAt || verifiedAt > lastSeen
      || !sessionIsValid({ role: "admin", createdAt, lastSeenAt: lastSeen, expiresAt, now })) return null;
    const touch = now - lastSeen >= SESSION_TOUCH_MILLISECONDS || expiresAt < adminSessionExpiry(now) - SESSION_TOUCH_MILLISECONDS;
    if (touch) {
      expiresAt = Math.max(expiresAt, adminSessionExpiry(now));
      await connection.query("UPDATE auth_session_state SET last_seen_at = ? WHERE session_id = ?", [sqlDate(now), row.id]);
      await connection.query("UPDATE sessions SET expires_at = ? WHERE id = ?", [sqlDate(expiresAt), row.id]);
    }
    return { id: row.id, userId: row.user_id, role: user.role, pseudonym: user.pseudonym, expiresAt, createdAt, lastSeenAt: touch ? now : lastSeen, now, enrolledAt, mfaVersion: Number(row.mfa_version) };
  }

  return {
    async assertSchema(options = {}) {
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
        const status = await migrationStatus(connection, { database, migrations: await loadStoreMigrations(options) });
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

    async consumeRateLimit(bucketHash, { now, windowSeconds, limit, network }) {
      bytes(bucketHash, 32); instant(now);
      const validBudget = (seconds, maximum) => Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 86400
        && Number.isSafeInteger(maximum) && maximum >= 1 && maximum <= 1000000;
      if (!validBudget(windowSeconds, limit)) invalid();
      if (network !== undefined) {
        if (!network || typeof network !== "object" || Array.isArray(network)
          || Object.keys(network).sort().join(",") !== "bucketHash,limit,windowSeconds"
          || !validBudget(network.windowSeconds, network.limit)) invalid();
        bytes(network.bucketHash, 32);
        if (network.bucketHash.equals(bucketHash)) invalid();
      }
      return withConnection(async (connection) => {
        async function consume(hash, seconds, maximum) {
          // The upsert avoids shared-to-exclusive upgrades for concurrent callers.
          await connection.query(`INSERT INTO auth_rate_limits (bucket_hash, window_started_at, attempts)
          VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE
          attempts = CASE WHEN window_started_at <= DATE_SUB(?, INTERVAL ? SECOND)
            THEN 1 ELSE LEAST(attempts + 1, 4294967295) END,
          window_started_at = CASE WHEN window_started_at <= DATE_SUB(?, INTERVAL ? SECOND)
            THEN ? ELSE window_started_at END`, [hash, sqlDate(now), sqlDate(now), seconds, sqlDate(now), seconds, sqlDate(now)]);
          const row = (await connection.query("SELECT window_started_at, attempts FROM auth_rate_limits WHERE bucket_hash = ? FOR UPDATE", [hash]))[0];
          const started = fromSqlDate(row.window_started_at), attempts = Number(row.attempts);
          return { allowed: attempts <= maximum, retryAfter: Math.max(1, Math.ceil((started + seconds * 1000 - now) / 1000)) };
        }
        // Roll back both debits on a network refusal. Keeping this inside the
        // aggregate's transaction prevents concurrent refusals spending its budget;
        // refusing the aggregate before the network still bounds counter creation.
        if (network) await connection.query("SAVEPOINT public_rate_budget");
        let result = await consume(bucketHash, windowSeconds, limit);
        if (network && result.allowed) {
          result = await consume(network.bucketHash, network.windowSeconds, network.limit);
          if (!result.allowed) await connection.query("ROLLBACK TO SAVEPOINT public_rate_budget");
        }
        if (now >= nextRatePruneAt && now >= 86400000) {
          nextRatePruneAt = now + 300000;
          await connection.query("DELETE FROM auth_rate_limits WHERE window_started_at < ? LIMIT 2000", [sqlDate(now - 86400000)]);
        }
        return result;
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
        const lifetime = session.expiresAt - now;
        now = sessionNow(now);
        const expiresAt = instant(now + lifetime);
        const version = Number(mfa.version);
        const lastStep = Number(mfa.last_totp_step);
        const factor = factorCheck({ secretEncrypted: mfa.secret_encrypted, version, lastStep, enabled: mfa.enabled_at !== null }, now);
        if (!factor || (Object.hasOwn(factor, "step") && Object.hasOwn(factor, "recoveryDigest"))) return false;
        if (Number.isSafeInteger(factor.step) && factor.step > lastStep) {
          await connection.query("UPDATE admin_mfa SET last_totp_step = ?, enabled_at = COALESCE(enabled_at, ?) WHERE user_id = ?", [factor.step, sqlDate(now), userId]);
        } else if (Buffer.isBuffer(factor.recoveryDigest) && factor.recoveryDigest.length === 32 && mfa.enabled_at !== null) {
          const recovery = (await connection.query("SELECT mfa_version, consumed_at FROM admin_recovery_codes WHERE user_id = ? AND code_hash = ? FOR UPDATE", [userId, factor.recoveryDigest]))[0];
          if (!recovery || Number(recovery.mfa_version) !== version || recovery.consumed_at !== null) return false;
          await connection.query("UPDATE admin_recovery_codes SET consumed_at = ? WHERE user_id = ? AND code_hash = ?", [sqlDate(now), userId, factor.recoveryDigest]);
        } else return false;
        await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [session.id, userId, session.tokenHash, sqlDate(now), sqlDate(expiresAt)]);
        await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, ?)", [session.id, sqlDate(now), sqlDate(now), version]);
        return true;
      }, true);
    },

    async getSession(tokenHash, { now, idleSeconds }) {
      bytes(tokenHash, 32); instant(now);
      if (!Number.isSafeInteger(idleSeconds) || idleSeconds < 0 || idleSeconds > 86400) invalid();
      return withConnection(async (connection) => {
        const record = await lockedAdminSession(connection, tokenHash, now);
        if (!record) return null;
        const { id, userId, role, pseudonym, expiresAt, mfaVersion } = record;
        return { id, userId, role, pseudonym, expiresAt, mfaVersion };
      }, true);
    },

    async listDevices(tokenHash, { now, afterId = null, limit = 50 }) {
      bytes(tokenHash, 32); instant(now); if (afterId !== null) bytes(afterId, 16);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) invalid();
      return withConnection(async (connection) => {
        const actor = await lockedAdminSession(connection, tokenHash, now);
        if (!actor) return null;
        now = actor.now;
        const rows = await connection.query(`SELECT s.id, s.created_at, s.expires_at, a.last_seen_at, a.mfa_verified_at
          FROM sessions s JOIN auth_session_state a ON a.session_id = s.id
          WHERE s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND a.mfa_version = ?
          ${afterId === null ? "" : "AND s.id > ?"} ORDER BY s.id ASC LIMIT ? FOR UPDATE`,
        [actor.userId, sqlDate(now), actor.mfaVersion, ...(afterId === null ? [] : [afterId]), limit + 1]);
        now = sessionNow(now);
        if (now >= actor.expiresAt) return null;
        const selected = rows.slice(0, limit);
        const devices = selected.flatMap((row) => {
          const createdAt = fromSqlDate(row.created_at), lastSeenAt = fromSqlDate(row.last_seen_at), verifiedAt = fromSqlDate(row.mfa_verified_at);
          return verifiedAt >= createdAt && verifiedAt >= actor.enrolledAt && verifiedAt <= lastSeenAt
            && sessionIsValid({ role: "admin", createdAt, lastSeenAt, expiresAt: fromSqlDate(row.expires_at), now })
            ? [{ id: row.id, createdAt, lastSeenAt, current: row.id.equals(actor.id) }] : [];
        });
        return { devices, hasMore: rows.length > limit, nextCursor: rows.length > limit ? selected.at(-1).id : null };
      }, true);
    },

    async revokeDevice(tokenHash, deviceId, { now }) {
      bytes(tokenHash, 32); bytes(deviceId, 16); instant(now);
      return withConnection(async (connection) => {
        const actor = await lockedAdminSession(connection, tokenHash, now);
        if (!actor) return null;
        const target = (await connection.query(`SELECT s.id FROM sessions s JOIN auth_session_state a ON a.session_id = s.id
          WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL FOR UPDATE`, [deviceId, actor.userId]))[0];
        if (!target) return { found: false, current: false };
        now = sessionNow(actor.now);
        if (now >= actor.expiresAt) return null;
        await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL", [sqlDate(now), deviceId, actor.userId]);
        return { found: true, current: deviceId.equals(actor.id) };
      }, true);
    },

    async revokeSession(tokenHash, { now }) {
      bytes(tokenHash, 32); instant(now);
      return withConnection((connection) => connection.query("UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL AND created_at <= ?", [sqlDate(now), tokenHash, sqlDate(now)]).then(() => undefined));
    },

    async revokeAllSessions(userId, { now }) {
      bytes(userId, 16); instant(now);
      return withConnection(async (connection) => {
        // Device listing/revocation locks the account before individual sessions.
        // Keep this same order before an UPDATE that can visit several sessions.
        const user = (await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]))[0];
        if (!user) return;
        now = sessionNow(now);
        await connection.query("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND created_at <= ?", [sqlDate(now), userId, sqlDate(now)]);
      }, true);
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
