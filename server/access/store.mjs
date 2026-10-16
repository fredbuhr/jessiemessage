import { createSessionClock, sessionIsValid, adminSessionExpiry, SESSION_TOUCH_MILLISECONDS } from "../auth/session-policy.mjs";
import { randomBytes } from "node:crypto";
import { loadMigrations, migrationStatus } from "../db/migrations.mjs";
import { encodeAccessCursor, validateAccessPage } from "./pagination.mjs";
import { CLIENT_ADMISSION_POLICY, hasConsumedInvitation, invitationConsumptionProjection } from "./admission.mjs";

export class AuthAccessStoreError extends Error {
  constructor(code, message = "Client access persistence operation failed.") {
    super(message);
    this.name = "AuthAccessStoreError";
    this.code = code;
  }
}

const invalid = () => { throw new AuthAccessStoreError("ACCESS_STORE_INPUT", "Invalid client access persistence input."); };
const stateError = () => { throw new AuthAccessStoreError("ACCESS_DATABASE_STATE", "Client access requires the applied, intact database schema."); };
const bytes = (value, size) => { if (!Buffer.isBuffer(value) || value.length !== size) invalid(); return value; };
const instant = (value) => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) invalid(); return value; };
const versionNumber = (value) => { if (!Number.isSafeInteger(value) || value < 1 || value > 4294967295) invalid(); return value; };
const storedVersion = (value) => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > 4294967295) stateError();
  return result;
};
const text = (value, limit) => { if (typeof value !== "string" || !value.length || value.length > limit) invalid(); return value; };
const sqlDate = (value) => new Date(instant(value)).toISOString().replace("T", " ").replace("Z", "000");
const fromSqlDate = (value) => {
  if (value instanceof Date) { const result = value.getTime(); if (Number.isFinite(result)) return result; }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) stateError();
  const result = Date.parse(`${value.replace(" ", "T")}Z`);
  if (!Number.isFinite(result)) stateError();
  return result;
};
const optionalDate = (value) => value === null ? null : fromSqlDate(value);
const accessDaysValue = (value) => {
  if (value !== null && (!Number.isSafeInteger(value) || value < 1 || value > 3650)) invalid();
  return value;
};
const validateVerification = (verification, mail, now) => {
  bytes(verification?.id, 16); bytes(verification?.tokenHash, 32); instant(verification?.expiresAt);
  bytes(mail?.id, 16); text(mail?.payloadEncrypted, 1024);
  if (verification.expiresAt <= now || !/^[\x20-\x7e]+$/.test(mail.payloadEncrypted)) invalid();
};

const schemaColumns = {
  client_auth_state: { user_id: ["varbinary", false, 16], role: ["varchar", false, 8], credential_version: ["int", false], age_declared_at: ["datetime", false] },
  email_verifications: { id: ["varbinary", false, 16], user_id: ["varbinary", false, 16], token_hash: ["varbinary", false, 32], created_at: ["datetime", false], expires_at: ["datetime", false], consumed_at: ["datetime", true], revoked_at: ["datetime", true] },
  client_session_state: { session_id: ["varbinary", false, 16], last_seen_at: ["datetime", false], credential_version: ["int", false] },
  mail_outbox: { id: ["varbinary", false, 16], verification_id: ["varbinary", false, 16], recipient_user_id: ["varbinary", false, 16], payload_encrypted: ["varchar", false, 1024], status: ["varchar", false, 16], available_at: ["datetime", false], expires_at: ["datetime", false], created_at: ["datetime", false] },
};
const schemaKeys = {
  client_auth_state: { PRIMARY: ["user_id"] },
  email_verifications: { PRIMARY: ["id"], email_verifications_token_hash: ["token_hash"], email_verifications_id_user: ["id", "user_id"] },
  client_session_state: { PRIMARY: ["session_id"] },
  mail_outbox: { PRIMARY: ["id"] },
};
const schemaChecks = {
  client_auth_state: ["client_auth_user_size", "client_auth_role", "client_auth_version"],
  email_verifications: ["email_verification_id_size", "email_verification_user_size", "email_verification_token_size", "email_verification_lifetime", "email_verification_consumption", "email_verification_revocation", "email_verification_terminal"],
  client_session_state: ["client_session_id_size", "client_session_version"],
};

export function createAccessStore(pool, { clock } = {}) {
  const sessionNow = createSessionClock(clock);
  async function withConnection(operation, transaction = false) {
    let connection;
    let begun = false;
    try {
      connection = await pool.getConnection();
      if (transaction) { await connection.beginTransaction(); begun = true; }
      const result = await operation(connection);
      if (begun) await connection.commit();
      return result;
    } catch (error) {
      if (begun) { try { await connection.rollback(); } catch {} }
      if (error instanceof AuthAccessStoreError) throw error;
      throw new AuthAccessStoreError("ACCESS_DATABASE_OPERATION");
    } finally {
      if (connection) { try { connection.release(); } catch {} }
    }
  }

  // The HTTP principal is deliberately insufficient here. Every administrator
  // mutation rechecks the persisted account, MFA generation and session inside
  // the transaction that changes invitations or clients.
  async function administrator(connection, tokenHash, now) {
    const candidate = (await connection.query("SELECT user_id FROM sessions WHERE token_hash = ? LIMIT 1", [tokenHash]))[0];
    if (!candidate) return null;
    const user = (await connection.query("SELECT id, role, status FROM users WHERE id = ? FOR UPDATE", [candidate.user_id]))[0];
    if (!user || user.role !== "admin" || user.status !== "active") return null;
    const mfa = (await connection.query("SELECT version, enabled_at FROM admin_mfa WHERE user_id = ? FOR UPDATE", [user.id]))[0];
    if (!mfa || mfa.enabled_at === null) return null;
    const session = (await connection.query(`SELECT s.id, s.created_at, s.expires_at, s.revoked_at,
      a.last_seen_at, a.mfa_verified_at, a.mfa_version FROM sessions s
      JOIN auth_session_state a ON a.session_id = s.id
      WHERE s.token_hash = ? AND s.user_id = ? FOR UPDATE`, [tokenHash, user.id]))[0];
    if (!session || session.revoked_at !== null || storedVersion(session.mfa_version) !== storedVersion(mfa.version)) return null;
    now = sessionNow(now);
    const created = fromSqlDate(session.created_at);
    const seen = fromSqlDate(session.last_seen_at);
    const verified = fromSqlDate(session.mfa_verified_at);
    let expiresAt = fromSqlDate(session.expires_at);
    if (verified < created || verified < fromSqlDate(mfa.enabled_at) || verified > seen
      || !sessionIsValid({ role: "admin", createdAt: created, lastSeenAt: seen, expiresAt, now })) return null;
    if (now - seen >= SESSION_TOUCH_MILLISECONDS) {
      await connection.query("UPDATE auth_session_state SET last_seen_at = ? WHERE session_id = ?", [sqlDate(now), session.id]);
      expiresAt = Math.max(expiresAt, adminSessionExpiry(now));
      await connection.query("UPDATE sessions SET expires_at = ? WHERE id = ?", [sqlDate(expiresAt), session.id]);
    }
    return { ...user, now, expiresAt };
  }

  async function issuer(connection, userId, now) {
    const user = (await connection.query("SELECT role, status FROM users WHERE id = ? FOR UPDATE", [userId]))[0];
    if (!user || user.role !== "admin" || user.status !== "active") return false;
    const mfa = (await connection.query("SELECT enabled_at FROM admin_mfa WHERE user_id = ? FOR UPDATE", [userId]))[0];
    return Boolean(mfa && mfa.enabled_at !== null && fromSqlDate(mfa.enabled_at) <= sessionNow(now));
  }

  async function enqueue(connection, userId, verification, mail, now) {
    await connection.query(`INSERT INTO email_verifications
      (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [verification.id, userId, verification.tokenHash, sqlDate(now), sqlDate(verification.expiresAt)]);
    await connection.query(`INSERT INTO mail_outbox
      (id, verification_id, recipient_user_id, payload_encrypted, available_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [mail.id, verification.id, userId, mail.payloadEncrypted,
      sqlDate(now), sqlDate(verification.expiresAt), sqlDate(now)]);
  }

  async function cancelMail(connection, userId) {
    await connection.query(`UPDATE mail_outbox SET status = 'cancelled', lease_token = NULL, lease_until = NULL
      WHERE recipient_user_id = ? AND status IN ('pending', 'sending', 'failed')`, [userId]);
  }

  return {
    async assertSchema() {
      return withConnection(async (connection) => {
        const database = (await connection.query("SELECT DATABASE() AS name"))[0].name;
        const status = await migrationStatus(connection, { database, migrations: await loadMigrations() });
        if (status.some((item) => item.state !== "applied")) stateError();
        const tables = await connection.query("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
        const columns = await connection.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName,
          DATA_TYPE AS dataType, IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS length,
          DATETIME_PRECISION AS precisionValue, COLUMN_TYPE AS columnType
          FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`, [database]);
        for (const [table, definitions] of Object.entries(schemaColumns)) {
          if (!tables.some((item) => item.name === table && item.engine === "InnoDB")) stateError();
          for (const [name, [type, nullable, length]] of Object.entries(definitions)) {
            const column = columns.find((item) => item.tableName === table && item.columnName === name);
            if (!column || column.dataType !== type || (column.nullable === "YES") !== nullable
              || (length !== undefined && Number(column.length) !== length)
              || (type === "datetime" && Number(column.precisionValue) !== 6)
              || (name === "credential_version" && !column.columnType.includes("unsigned"))) stateError();
          }
        }
        const keys = await connection.query(`SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName,
          COLUMN_NAME AS columnName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS positionValue
          FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?`, [database]);
        for (const [table, definitions] of Object.entries(schemaKeys)) {
          for (const [name, expected] of Object.entries(definitions)) {
            const actual = keys.filter((item) => item.tableName === table && item.indexName === name)
              .sort((left, right) => Number(left.positionValue) - Number(right.positionValue));
            if (actual.length !== expected.length || actual.some((item, index) => Number(item.nonUnique) !== 0 || item.columnName !== expected[index])) stateError();
          }
        }
        const foreignKeys = await connection.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName,
          COLUMN_NAME AS columnName, REFERENCED_TABLE_NAME AS parentTable, REFERENCED_COLUMN_NAME AS parentColumn,
          ORDINAL_POSITION AS positionValue FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`, [database]);
        const expectedForeignKeys = [
          ["client_auth_state", "client_auth_user_fk", "users", ["user_id", "role"], ["id", "role"]],
          ["email_verifications", "email_verification_user_fk", "client_auth_state", ["user_id"], ["user_id"]],
          ["client_session_state", "client_session_parent_fk", "sessions", ["session_id"], ["id"]],
        ];
        for (const [table, name, parent, childColumns, parentColumns] of expectedForeignKeys) {
          const actual = foreignKeys.filter((item) => item.tableName === table && item.constraintName === name)
            .sort((left, right) => Number(left.positionValue) - Number(right.positionValue));
          if (actual.length !== childColumns.length || actual.some((item, index) => item.parentTable !== parent
            || item.columnName !== childColumns[index] || item.parentColumn !== parentColumns[index])) stateError();
        }
        const constraints = await connection.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName,
          CONSTRAINT_TYPE AS type FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?`, [database]);
        for (const [table, checks] of Object.entries(schemaChecks)) {
          for (const name of checks) {
            if (!constraints.some((item) => item.tableName === table && item.constraintName === name && item.type === "CHECK")) stateError();
          }
        }
        const admissionChecks = await connection.query(`SELECT CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'users' AND CONSTRAINT_NAME = 'users_active_client_gates'`, [database]);
        // Match only the four admission predicates, including their AND/OR
        // structure. MariaDB may remove redundant parentheses and quote names.
        const admission = admissionChecks[0]?.clause?.toLowerCase().replace(/[`\s]/g, "");
        const expectedAdmission = "role<>'client'orstatus<>'active'oremail_verified_atisnotnullandaccess_approved_atisnotnull";
        if (admissionChecks.length !== 1 || typeof admission !== "string") stateError();
        const atoms = ["role<>'client'", "status<>'active'", "email_verified_atisnotnull", "access_approved_atisnotnull"];
        let normalizedAdmission = admission;
        let previous;
        do {
          previous = normalizedAdmission;
          // These removals preserve the authored boolean structure; unlike
          // deleting every parenthesis, they cannot hide a changed grouping.
          for (const atom of [...atoms, `${atoms[2]}and${atoms[3]}`, `${atoms[0]}or${atoms[1]}`]) {
            normalizedAdmission = normalizedAdmission.replaceAll(`(${atom})`, atom);
          }
          if (normalizedAdmission === `(${expectedAdmission})`) normalizedAdmission = expectedAdmission;
        } while (normalizedAdmission !== previous);
        if (normalizedAdmission !== expectedAdmission) stateError();
        const references = await connection.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName,
          UPDATE_RULE AS updateRule, DELETE_RULE AS deleteRule FROM information_schema.REFERENTIAL_CONSTRAINTS
          WHERE CONSTRAINT_SCHEMA = ?`, [database]);
        for (const [table, name] of expectedForeignKeys) {
          if (!references.some((item) => item.tableName === table && item.constraintName === name
            && item.updateRule === "RESTRICT" && item.deleteRule === "RESTRICT")) stateError();
        }
        // Verify runtime read access too; metadata permission alone is insufficient.
        await connection.query("SELECT user_id, role, credential_version, age_declared_at FROM client_auth_state WHERE 1 = 0");
        await connection.query("SELECT id, user_id, token_hash, consumed_at, revoked_at FROM email_verifications WHERE 1 = 0");
        await connection.query("SELECT session_id, last_seen_at, credential_version FROM client_session_state WHERE 1 = 0");
        await connection.query("SELECT id, payload_encrypted, status FROM mail_outbox WHERE 1 = 0");
        return true;
      });
    },

    async inspectInvitation(tokenHash, { now }) {
      bytes(tokenHash, 32); instant(now);
      return withConnection(async (connection) => {
        const row = (await connection.query(`SELECT i.expires_at, i.access_days FROM invitations i
          JOIN users u ON u.id = i.created_by_id JOIN admin_mfa m ON m.user_id = u.id
          WHERE i.token_hash = ? AND i.consumed_at IS NULL AND i.revoked_at IS NULL
          AND i.created_at <= ? AND i.expires_at > ? AND u.role = 'admin' AND u.status = 'active'
          AND m.enabled_at IS NOT NULL AND m.enabled_at <= ? LIMIT 1`, [tokenHash, sqlDate(now), sqlDate(now), sqlDate(now)]))[0];
        return row ? { expiresAt: fromSqlDate(row.expires_at), accessDays: row.access_days === null ? null : Number(row.access_days) } : null;
      });
    },

    async createInvitation({ actorTokenHash, now, id, tokenHash, expiresAt, accessDays }) {
      bytes(actorTokenHash, 32); bytes(id, 16); bytes(tokenHash, 32); instant(now); instant(expiresAt); accessDaysValue(accessDays);
      if (expiresAt <= now) invalid();
      return withConnection(async (connection) => {
        const actor = await administrator(connection, actorTokenHash, now);
        if (!actor) return null;
        const lifetime = expiresAt - now;
        now = actor.now;
        expiresAt = instant(now + lifetime);
        await connection.query(`INSERT INTO invitations (id, token_hash, created_by_id, created_at, expires_at, access_days)
          VALUES (?, ?, ?, ?, ?, ?)`, [id, tokenHash, actor.id, sqlDate(now), sqlDate(expiresAt), accessDays]);
        return { id, expiresAt, accessDays };
      }, true);
    },

    async listInvitations(actorTokenHash, { now, cursor = null, limit = 50 }) {
      bytes(actorTokenHash, 32); instant(now);
      const page = validateAccessPage("invitations", { cursor, limit });
      return withConnection(async (connection) => {
        const actor = await administrator(connection, actorTokenHash, now);
        if (!actor) return null;
        now = actor.now;
        const rows = await connection.query(`SELECT id, created_at, expires_at, access_days, consumed_at,
          consumed_by_id, revoked_at, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS cursor_created_at
          FROM invitations ${page.position ? "WHERE created_at < ? OR (created_at = ? AND id < ?)" : ""}
          ORDER BY created_at DESC, id DESC LIMIT ?`, page.position
          ? [page.position.createdAt, page.position.createdAt, Buffer.from(page.position.id, "hex"), page.limit + 1] : [page.limit + 1]);
        const selected = rows.slice(0, page.limit), hasMore = rows.length > page.limit;
        const invitations = selected.map((row) => ({ id: row.id.toString("hex"), createdAt: fromSqlDate(row.created_at),
          expiresAt: fromSqlDate(row.expires_at), accessDays: row.access_days === null ? null : Number(row.access_days),
          state: row.consumed_at !== null ? "used" : row.revoked_at !== null ? "revoked" : now >= fromSqlDate(row.expires_at) ? "expired" : "pending",
          consumedById: row.consumed_by_id === null ? null : row.consumed_by_id.toString("hex") }));
        const last = selected.at(-1);
        return { invitations, nextCursor: hasMore ? encodeAccessCursor("invitations", { createdAt: last.cursor_created_at, id: last.id.toString("hex") }) : null, hasMore };
      }, true);
    },

    async revokeInvitation(actorTokenHash, id, { now }) {
      bytes(actorTokenHash, 32); bytes(id, 16); instant(now);
      return withConnection(async (connection) => {
        const actor = await administrator(connection, actorTokenHash, now);
        if (!actor) return false;
        now = actor.now;
        const result = await connection.query(`UPDATE invitations SET revoked_at = ? WHERE id = ?
          AND consumed_at IS NULL AND revoked_at IS NULL AND created_at <= ?`, [sqlDate(now), id, sqlDate(now)]);
        return Number(result.affectedRows) === 1;
      }, true);
    },

    async register({ invitationHash, user, verification, mail, now }) {
      bytes(invitationHash, 32); bytes(user?.id, 16); text(user?.email, 254); text(user?.pseudonym, 64); text(user?.passwordHash, 255); instant(now);
      if (!user.pseudonym.trim()) invalid();
      validateVerification(verification, mail, now);
      return withConnection(async (connection) => {
        // Lock the issuer before its invitation, matching administrator revocation.
        const candidate = (await connection.query("SELECT created_by_id FROM invitations WHERE token_hash = ? LIMIT 1", [invitationHash]))[0];
        if (!candidate || !await issuer(connection, candidate.created_by_id, now)) return false;
        const invitation = (await connection.query(`SELECT id, created_by_id, created_at, expires_at, consumed_at,
          revoked_at FROM invitations WHERE token_hash = ? FOR UPDATE`, [invitationHash]))[0];
        if (!invitation || !invitation.created_by_id.equals(candidate.created_by_id) || invitation.consumed_at !== null
          || invitation.revoked_at !== null || now < fromSqlDate(invitation.created_at) || now >= fromSqlDate(invitation.expires_at)) return false;
        try {
          await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, created_at, updated_at)
            VALUES (?, 'client', 'pending', ?, ?, ?, ?, ?)`, [user.id, user.pseudonym, user.email, user.passwordHash, sqlDate(now), sqlDate(now)]);
        } catch (error) {
          if (error?.code === "ER_DUP_ENTRY" || Number(error?.errno) === 1062) throw new AuthAccessStoreError("ACCESS_REGISTRATION_FAILED", "Registration could not be completed.");
          throw error;
        }
        await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [user.id, sqlDate(now)]);
        await connection.query("UPDATE invitations SET consumed_at = ?, consumed_by_id = ? WHERE id = ?", [sqlDate(now), user.id, invitation.id]);
        await enqueue(connection, user.id, verification, mail, now);
        return true;
      }, true);
    },

    async getClientLoginRecord(email) {
      text(email, 254);
      return withConnection(async (connection) => {
        const row = (await connection.query(`SELECT u.id, u.role, u.status, u.password_hash, u.email_verified_at,
          c.credential_version FROM users u JOIN client_auth_state c ON c.user_id = u.id WHERE u.email = ? LIMIT 1`, [email]))[0];
        return row ? { id: row.id, role: row.role, status: row.status, passwordHash: row.password_hash,
          emailVerified: row.email_verified_at !== null, credentialVersion: storedVersion(row.credential_version) } : null;
      });
    },

    async completeClientLogin({ userId, expectedPasswordHash, expectedVersion, now, session }) {
      bytes(userId, 16); text(expectedPasswordHash, 255); versionNumber(expectedVersion); instant(now);
      bytes(session?.id, 16); bytes(session?.tokenHash, 32); instant(session?.expiresAt);
      if (session.expiresAt <= now) invalid();
      const lifetime = session.expiresAt - now;
      return withConnection(async (connection) => {
        const user = (await connection.query("SELECT role, status, password_hash, email_verified_at FROM users WHERE id = ? FOR UPDATE", [userId]))[0];
        now = sessionNow(now);
        if (!user || user.role !== "client" || !["pending", "active"].includes(user.status)
          || user.email_verified_at === null || fromSqlDate(user.email_verified_at) > now || user.password_hash !== expectedPasswordHash) return false;
        const state = (await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ? FOR UPDATE", [userId]))[0];
        if (!state || storedVersion(state.credential_version) !== expectedVersion) return false;
        now = sessionNow(now);
        await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [session.id, userId, session.tokenHash, sqlDate(now), sqlDate(instant(now + lifetime))]);
        await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, ?)", [session.id, sqlDate(now), expectedVersion]);
        return true;
      }, true);
    },

    async getClientSession(tokenHash, { now, idleSeconds }) {
      bytes(tokenHash, 32); instant(now);
      if (!Number.isSafeInteger(idleSeconds) || idleSeconds < 1 || idleSeconds > 86400) invalid();
      return withConnection(async (connection) => {
        const candidate = (await connection.query("SELECT user_id FROM sessions WHERE token_hash = ? LIMIT 1", [tokenHash]))[0];
        if (!candidate) return null;
        const user = (await connection.query(`SELECT id, role, status, pseudonym, email_verified_at,
          age_assured_at, access_approved_at, access_expires_at, ${invitationConsumptionProjection()} FROM users WHERE id = ? FOR UPDATE`, [candidate.user_id]))[0];
        if (!user || user.role !== "client" || !["pending", "active"].includes(user.status)) return null;
        const auth = (await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ? FOR UPDATE", [user.id]))[0];
        if (!auth) return null;
        const row = (await connection.query(`SELECT s.id, s.created_at, s.expires_at, s.revoked_at, c.last_seen_at,
          c.credential_version FROM sessions s JOIN client_session_state c ON c.session_id = s.id
          WHERE s.token_hash = ? AND s.user_id = ? FOR UPDATE`, [tokenHash, user.id]))[0];
        if (!row || row.revoked_at !== null || storedVersion(row.credential_version) !== storedVersion(auth.credential_version)) return null;
        const createdAt = fromSqlDate(row.created_at);
        now = sessionNow(now);
        const lastSeen = fromSqlDate(row.last_seen_at);
        const expiresAt = fromSqlDate(row.expires_at);
        if (!sessionIsValid({ role: "client", createdAt, lastSeenAt: lastSeen, expiresAt, now, idleSeconds })) return null;
        const emailVerified = user.email_verified_at !== null && fromSqlDate(user.email_verified_at) <= now;
        const ageAssured = user.age_assured_at !== null && fromSqlDate(user.age_assured_at) <= now;
        const approved = user.access_approved_at !== null && fromSqlDate(user.access_approved_at) <= now;
        const invitationConsumed = hasConsumedInvitation(user, now, fromSqlDate);
        if (!emailVerified || !invitationConsumed || (user.status === "active" && (!approved
          || fromSqlDate(user.access_approved_at) < fromSqlDate(user.invitation_consumed_at)))) return null;
        const accessExpiresAt = optionalDate(user.access_expires_at);
        const accessState = user.status === "pending" ? "pending" : accessExpiresAt !== null && now >= accessExpiresAt ? "expired" : "active";
        if (now - lastSeen >= 60000) await connection.query("UPDATE client_session_state SET last_seen_at = ? WHERE session_id = ?", [sqlDate(now), row.id]);
        return { id: row.id, userId: user.id, role: "client", pseudonym: user.pseudonym, expiresAt,
          access: { state: accessState, admissionPolicy: CLIENT_ADMISSION_POLICY, invitationConsumed, emailVerified, ageAssured, approved, expiresAt: accessExpiresAt } };
      }, true);
    },

    async revokeClientSession(tokenHash, { now }) {
      bytes(tokenHash, 32); instant(now);
      return withConnection(async (connection) => {
        await connection.query(`UPDATE sessions s JOIN client_session_state c ON c.session_id = s.id
          SET s.revoked_at = ? WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.created_at <= ?`, [sqlDate(now), tokenHash, sqlDate(now)]);
      });
    },

    async revokeAllClientSessions(userId, { now }) {
      bytes(userId, 16); instant(now);
      return withConnection(async (connection) => {
        const user = (await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]))[0];
        if (!user) return;
        now = sessionNow(now);
        await connection.query(`UPDATE sessions s JOIN client_session_state c ON c.session_id = s.id
          SET s.revoked_at = ? WHERE s.user_id = ? AND s.revoked_at IS NULL AND s.created_at <= ?`, [sqlDate(now), userId, sqlDate(now)]);
      }, true);
    },

    async verifyEmail(tokenHash, { now }) {
      bytes(tokenHash, 32); instant(now);
      return withConnection(async (connection) => {
        const candidate = (await connection.query("SELECT user_id FROM email_verifications WHERE token_hash = ? LIMIT 1", [tokenHash]))[0];
        if (!candidate) return false;
        const user = (await connection.query("SELECT id, role, status, email_verified_at FROM users WHERE id = ? FOR UPDATE", [candidate.user_id]))[0];
        if (!user || user.role !== "client" || user.status !== "pending" || user.email_verified_at !== null) return false;
        const verification = (await connection.query(`SELECT id, user_id, created_at, expires_at, consumed_at,
          revoked_at FROM email_verifications WHERE token_hash = ? FOR UPDATE`, [tokenHash]))[0];
        if (!verification || !verification.user_id.equals(user.id) || verification.consumed_at !== null
          || verification.revoked_at !== null || now < fromSqlDate(verification.created_at) || now >= fromSqlDate(verification.expires_at)) return false;
        await connection.query("UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?", [sqlDate(now), sqlDate(now), user.id]);
        await connection.query("UPDATE email_verifications SET consumed_at = ? WHERE id = ?", [sqlDate(now), verification.id]);
        // Any older outstanding challenge is unusable once the mailbox is verified.
        await connection.query("UPDATE email_verifications SET revoked_at = ? WHERE user_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND created_at <= ?", [sqlDate(now), user.id, sqlDate(now)]);
        await cancelMail(connection, user.id);
        return true;
      }, true);
    },

    async reissueVerification({ userId, expectedPasswordHash, expectedVersion, verification, mail, now }) {
      bytes(userId, 16); text(expectedPasswordHash, 255); versionNumber(expectedVersion); instant(now);
      validateVerification(verification, mail, now);
      return withConnection(async (connection) => {
        const user = (await connection.query("SELECT role, status, password_hash, email_verified_at FROM users WHERE id = ? FOR UPDATE", [userId]))[0];
        if (!user || user.role !== "client" || user.status !== "pending" || user.email_verified_at !== null || user.password_hash !== expectedPasswordHash) return false;
        const state = (await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ? FOR UPDATE", [userId]))[0];
        if (!state || storedVersion(state.credential_version) !== expectedVersion) return false;
        await connection.query("UPDATE email_verifications SET revoked_at = ? WHERE user_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND created_at <= ?", [sqlDate(now), userId, sqlDate(now)]);
        await cancelMail(connection, userId);
        await enqueue(connection, userId, verification, mail, now);
        return true;
      }, true);
    },

    async listClients(actorTokenHash, { now, cursor = null, limit = 50 }) {
      bytes(actorTokenHash, 32); instant(now);
      const page = validateAccessPage("clients", { cursor, limit });
      return withConnection(async (connection) => {
        const actor = await administrator(connection, actorTokenHash, now);
        if (!actor) return null;
        now = actor.now;
        const rows = await connection.query(`SELECT id, pseudonym, email, status, email_verified_at, age_assured_at, created_at,
          access_approved_at, access_expires_at, ${invitationConsumptionProjection()}, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s.%f') AS cursor_created_at
          FROM users WHERE role = 'client' ${page.position ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
          ORDER BY created_at DESC, id DESC LIMIT ?`, page.position
          ? [page.position.createdAt, page.position.createdAt, Buffer.from(page.position.id, "hex"), page.limit + 1] : [page.limit + 1]);
        const selected = rows.slice(0, page.limit), hasMore = rows.length > page.limit;
        const clients = selected.map((row) => ({ id: row.id.toString("hex"), createdAt: fromSqlDate(row.created_at), pseudonym: row.pseudonym, email: row.email, status: row.status,
          emailVerified: row.email_verified_at !== null && fromSqlDate(row.email_verified_at) <= now,
          ageAssured: row.age_assured_at !== null && fromSqlDate(row.age_assured_at) <= now,
          admissionPolicy: CLIENT_ADMISSION_POLICY, invitationConsumed: hasConsumedInvitation(row, now, fromSqlDate),
          approved: row.access_approved_at !== null && fromSqlDate(row.access_approved_at) <= now,
          accessExpiresAt: optionalDate(row.access_expires_at) }));
        const last = selected.at(-1);
        return { clients, nextCursor: hasMore ? encodeAccessCursor("clients", { createdAt: last.cursor_created_at, id: last.id.toString("hex") }) : null, hasMore };
      }, true);
    },

    async renewClient(actorTokenHash, userId, { now, expectedExpiresAt, accessDays }) {
      bytes(actorTokenHash, 32); bytes(userId, 16); instant(now);
      if (!Number.isSafeInteger(expectedExpiresAt) || expectedExpiresAt < 0 || expectedExpiresAt > 253402300799999
        || !Number.isSafeInteger(accessDays) || accessDays < 1 || accessDays > 3650) throw new AuthAccessStoreError("ACCESS_INPUT");
      return withConnection(async (connection) => {
        // Keep administrator -> MFA -> session -> client ordering shared with
        // approval and revocation. The locked expiry is the mutation's CAS.
        const actor = await administrator(connection, actorTokenHash, now);
        if (!actor) throw new AuthAccessStoreError("ACCESS_FORBIDDEN");
        now = actor.now;
        const user = (await connection.query(`SELECT role, status, email_verified_at, age_assured_at,
          access_approved_at, access_expires_at, ${invitationConsumptionProjection()}, DATE_FORMAT(access_expires_at, '%Y-%m-%d %H:%i:%s.%f') AS exact_expiry
          FROM users WHERE id = ? FOR UPDATE`, [userId]))[0];
        now = sessionNow(now);
        if (now >= actor.expiresAt) throw new AuthAccessStoreError("ACCESS_FORBIDDEN");
        if (!user || user.role !== "client") return null;
        if (user.status !== "active" || user.email_verified_at === null || !hasConsumedInvitation(user, now, fromSqlDate) || user.access_approved_at === null
          || fromSqlDate(user.email_verified_at) > now || fromSqlDate(user.access_approved_at) > now
          || fromSqlDate(user.access_approved_at) < fromSqlDate(user.invitation_consumed_at)
          || user.access_expires_at === null) throw new AuthAccessStoreError("ACCESS_PREREQUISITES");
        const currentExpiry = fromSqlDate(user.access_expires_at);
        if (currentExpiry !== expectedExpiresAt || user.exact_expiry !== sqlDate(expectedExpiresAt)) throw new AuthAccessStoreError("ACCESS_CONFLICT");
        const accessExpiresAt = Math.max(now, currentExpiry) + accessDays * 86400000;
        if (!Number.isSafeInteger(accessExpiresAt) || accessExpiresAt > 253402300799999
          || accessExpiresAt > now + 3650 * 86400000) throw new AuthAccessStoreError("ACCESS_INPUT");
        // Do not rewrite the first approval, conversation owner, credential
        // generation or session rows: renewal extends this approved access only.
        await connection.query("UPDATE users SET access_expires_at = ?, updated_at = ? WHERE id = ?", [sqlDate(accessExpiresAt), sqlDate(now), userId]);
        return { id: userId.toString("hex"), accessExpiresAt };
      }, true);
    },

    async approveClient(actorTokenHash, userId, { now }) {
      bytes(actorTokenHash, 32); bytes(userId, 16); instant(now);
      return withConnection(async (connection) => {
        const actor = await administrator(connection, actorTokenHash, now);
        if (!actor) return false;
        now = actor.now;
        const user = (await connection.query("SELECT role, status, email_verified_at FROM users WHERE id = ? FOR UPDATE", [userId]))[0];
        now = sessionNow(now);
        if (!user || user.role !== "client" || user.status !== "pending" || user.email_verified_at === null
          || fromSqlDate(user.email_verified_at) > now) return false;
        const invitations = await connection.query("SELECT access_days, consumed_at FROM invitations WHERE consumed_by_id = ? AND consumed_at IS NOT NULL LIMIT 2 FOR UPDATE", [userId]);
        now = sessionNow(now);
        if (now >= actor.expiresAt) return false;
        if (invitations.length !== 1 || fromSqlDate(invitations[0].consumed_at) > now) return false;
        const accessDays = invitations[0].access_days === null ? null : Number(invitations[0].access_days);
        const expiresAt = accessDays === null ? null : instant(now + accessDaysValue(accessDays) * 86400000);
        await connection.query("UPDATE users SET status = 'active', access_approved_at = ?, access_expires_at = ?, updated_at = ? WHERE id = ?", [sqlDate(now), expiresAt === null ? null : sqlDate(expiresAt), sqlDate(now), userId]);
        await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [randomBytes(16), userId, actor.id, sqlDate(now)]);
        return true;
      }, true);
    },

    async revokeClient(actorTokenHash, userId, { now }) {
      bytes(actorTokenHash, 32); bytes(userId, 16); instant(now);
      return withConnection(async (connection) => {
        const actor = await administrator(connection, actorTokenHash, now);
        if (!actor) return false;
        now = actor.now;
        const user = (await connection.query("SELECT role, status FROM users WHERE id = ? FOR UPDATE", [userId]))[0];
        now = sessionNow(now);
        if (now >= actor.expiresAt) return false;
        if (!user || user.role !== "client" || !["pending", "active", "suspended"].includes(user.status)) return false;
        await connection.query("UPDATE users SET status = 'revoked', updated_at = ? WHERE id = ?", [sqlDate(now), userId]);
        await connection.query("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND created_at <= ?", [sqlDate(now), userId, sqlDate(now)]);
        await connection.query("UPDATE email_verifications SET revoked_at = ? WHERE user_id = ? AND consumed_at IS NULL AND revoked_at IS NULL AND created_at <= ?", [sqlDate(now), userId, sqlDate(now)]);
        await cancelMail(connection, userId);
        return true;
      }, true);
    },
  };
}
