import { randomBytes, timingSafeEqual } from "node:crypto";
import { loadMigrations, migrationStatus } from "../db/migrations.mjs";
import { invitationConsumptionProjection, manuallyAdmittedClient } from "../access/admission.mjs";
import { createSessionClock } from "../auth/session-policy.mjs";
import { ChatStoreError, normalizedCheckTree, authoredMigrationCheck } from "../chat/store.mjs";
import { NotificationCryptoError, endpointDigest, openSubscription, sealSubscription } from "./crypto.mjs";
import { NotificationValidationError, validateLocale, validateSubscription } from "./validation.mjs";

export class NotificationStoreError extends Error {
  constructor(code = "NOTIFICATIONS_UNAVAILABLE") { super("Notification settings are unavailable."); this.name = "NotificationStoreError"; this.code = code; }
}
const fail = (code) => { throw new NotificationStoreError(code); };
const notificationFailure = (error) => error instanceof NotificationStoreError
  || error instanceof NotificationCryptoError || error instanceof NotificationValidationError;
const bytes = (value, size = 16) => { if (!Buffer.isBuffer(value) || value.length !== size) fail("NOTIFICATIONS_STORE_INPUT"); return value; };
const instant = (value) => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) fail("NOTIFICATIONS_STORE_INPUT"); return value; };
const sqlDate = (value) => new Date(instant(value)).toISOString().replace("T", " ").replace("Z", "000");
const timestamp = (value) => {
  if (value instanceof Date) return instant(value.getTime());
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) fail();
  return instant(Date.parse(value.replace(" ", "T") + "Z"));
};
const sqlInstant = (value) => {
  const millis = timestamp(value);
  if (value instanceof Date) return sqlDate(millis);
  const [date, fraction = ""] = value.split(".");
  const canonical = `${date}.${fraction.padEnd(6, "0")}`;
  if (sqlDate(millis).slice(0, 19) !== date) fail();
  return canonical;
};
const notFuture = (value, now) => sqlInstant(value) <= sqlDate(now);
const stillFuture = (value, now) => sqlInstant(value) > sqlDate(now);
const version = (value) => { const result = Number(value); if (!Number.isInteger(result) || result < 1 || result > 4294967295) fail(); return result; };
const enabled = (value) => { if (![0, 1, 0n, 1n].includes(value)) fail(); return Number(value) === 1; };
const roleValue = (role) => { if (!["admin", "client"].includes(role)) fail("NOTIFICATIONS_STORE_INPUT"); };
const dto = (row) => ({ id: bytes(row.id).toString("hex"), enabled: enabled(row.enabled), createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at) });
const subscriptionColumns = "id, user_id, role, session_id, credential_version, generation, endpoint_digest, subscription_encrypted, locale, enabled, created_at, updated_at";
const jobColumns = "id, message_id, subscription_id, subscription_generation, status, attempts, available_at, created_at, expires_at, lease_token, lease_until, finished_at";
const terminal = new Set(["accepted", "skipped", "failed"]);
const schema = {
  push_subscriptions: {
    id: ["varbinary", false, 16], user_id: ["varbinary", false, 16], role: ["varchar", false, 8],
    session_id: ["varbinary", false, 16], credential_version: ["int", false], generation: ["int", false],
    endpoint_digest: ["varbinary", false, 32], subscription_encrypted: ["varchar", false, 4096],
    locale: ["varchar", false, 2], enabled: ["tinyint", false], created_at: ["datetime", false], updated_at: ["datetime", false],
  },
  push_outbox: {
    id: ["varbinary", false, 16], message_id: ["varbinary", false, 16], subscription_id: ["varbinary", false, 16],
    subscription_generation: ["int", false], status: ["varchar", false, 8], attempts: ["smallint", false],
    available_at: ["datetime", false], created_at: ["datetime", false], expires_at: ["datetime", false],
    lease_token: ["varbinary", true, 16], lease_until: ["datetime", true], finished_at: ["datetime", true],
  },
};
const foreignKeys = [
  ["push_subscriptions", "push_subscriptions_user_fk", "users", ["user_id", "role"], ["id", "role"]],
  ["push_subscriptions", "push_subscriptions_session_fk", "sessions", ["session_id"], ["id"]],
  ["push_outbox", "push_outbox_message_fk", "messages", ["message_id"], ["id"]],
  ["push_outbox", "push_outbox_subscription_fk", "push_subscriptions", ["subscription_id"], ["id"]],
];

// This callback is installed only when notifications are configured. Its SQL is
// deliberately inside the caller's message transaction, including photo sends.
export async function enqueueNotification(connection, context, message) {
  if (typeof connection?.query !== "function") fail("NOTIFICATIONS_STORE_INPUT");
  const { actor, admin, client, now } = context;
  roleValue(actor?.role); instant(now); bytes(message?.id);
  const recipientId = bytes(actor.role === "admin" ? client?.id : admin?.id);
  const subscriptions = await connection.query("SELECT id, generation FROM push_subscriptions WHERE user_id = ? AND enabled = 1 ORDER BY id LIMIT 17", [recipientId]);
  if (!Array.isArray(subscriptions) || subscriptions.length > 16) fail();
  for (const row of subscriptions) {
    await connection.query(`INSERT INTO push_outbox (id, message_id, subscription_id, subscription_generation,
      status, available_at, created_at, expires_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [randomBytes(16), message.id, bytes(row.id), version(row.generation), sqlDate(now), sqlDate(now), sqlDate(now + 86400000)]);
  }
}

export function createNotificationsStore({ pool, chatStore, key, clock } = {}) {
  if (typeof pool?.getConnection !== "function" || typeof chatStore?.withActor !== "function" || !Buffer.isBuffer(key) || key.length !== 32) fail("NOTIFICATIONS_STORE_INPUT");
  key = Buffer.from(key);
  const currentTime = createSessionClock(clock);
  async function run(operation) {
    let connection, begun = false;
    try {
      connection = await pool.getConnection();
      await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
      await connection.beginTransaction(); begun = true;
      const result = await operation(connection);
      await connection.commit(); return result;
    } catch (error) {
      if (begun) { try { await connection.rollback(); } catch {} }
      if (notificationFailure(error)) throw error;
      fail();
    } finally { if (connection) { try { await connection.release(); } catch { fail(); } } }
  }
  async function withActor(request, operation) {
    roleValue(request.role); bytes(request.tokenHash, 32); instant(request.now);
    let callbackFailure;
    try {
      return await chatStore.withActor(request, async (connection, context) => {
        try {
          const table = request.role === "admin" ? "auth_session_state" : "client_session_state";
          const column = request.role === "admin" ? "mfa_version" : "credential_version";
          const session = (await connection.query(`SELECT s.id, a.${column} AS credential_version FROM sessions s
            JOIN ${table} a ON a.session_id = s.id WHERE s.token_hash = ? AND s.user_id = ? FOR UPDATE`, [request.tokenHash, context.actor.id]))[0];
          if (!session) fail();
          return await operation(connection, { ...context, sessionId: bytes(session.id), credentialVersion: version(session.credential_version) });
        } catch (error) {
          // Chat owns rollback and sanitizes foreign callback exceptions. Retain
          // only our own typed domain failure, then rethrow it after that owner
          // has completed its failure path. Driver/code lookalikes stay opaque.
          if (notificationFailure(error)) callbackFailure = error;
          throw error;
        }
      });
    } catch (error) {
      if (callbackFailure) throw callbackFailure;
      if (notificationFailure(error) || error instanceof ChatStoreError) throw error;
      fail();
    }
  }
  async function finish(connection, job, status, now) {
    if (!terminal.has(status)) fail();
    await connection.query("UPDATE push_outbox SET status = ?, finished_at = ?, lease_token = NULL, lease_until = NULL WHERE id = ?", [status, sqlDate(now), job.id]);
  }
  async function lockUser(connection, id) {
    return (await connection.query(`SELECT id, role, status, email_verified_at, access_approved_at,
      access_expires_at, ${invitationConsumptionProjection()} FROM users WHERE id = ? FOR UPDATE`, [id]))[0];
  }
  // Discovery grants no authority. Lock in chat order: admin, client, proofs,
  // conversation, origin session, subscription, message, receipt, then job.
  // No network operation is allowed inside this callback's transaction.
  async function withJob(connection, jobId, fallback, operation) {
    const discovery = (await connection.query(`SELECT o.subscription_id, o.message_id, m.conversation_id, c.admin_id, c.client_id,
      p.user_id, p.session_id, p.role FROM push_outbox o JOIN push_subscriptions p ON p.id = o.subscription_id
      JOIN messages m ON m.id = o.message_id JOIN conversations c ON c.id = m.conversation_id WHERE o.id = ?`, [jobId]))[0];
    if (!discovery) return null;
    const admin = await lockUser(connection, discovery.admin_id), client = await lockUser(connection, discovery.client_id);
    const mfa = (await connection.query("SELECT version, enabled_at FROM admin_mfa WHERE user_id = ? FOR UPDATE", [discovery.admin_id]))[0];
    const auth = (await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ? FOR UPDATE", [discovery.client_id]))[0];
    const conversation = (await connection.query("SELECT id, admin_id, client_id, created_at, closed_at FROM conversations WHERE id = ? FOR UPDATE", [discovery.conversation_id]))[0];
    const role = discovery.role; roleValue(role);
    const stateTable = role === "admin" ? "auth_session_state" : "client_session_state";
    const proofColumn = role === "admin" ? "mfa_version" : "credential_version";
    const session = (await connection.query(`SELECT s.id, s.user_id, s.created_at, s.revoked_at, a.${proofColumn} AS credential_version
      ${role === "admin" ? ", a.mfa_verified_at" : ""} FROM sessions s JOIN ${stateTable} a ON a.session_id = s.id WHERE s.id = ? FOR UPDATE`, [discovery.session_id]))[0];
    const subscription = (await connection.query(`SELECT ${subscriptionColumns} FROM push_subscriptions WHERE id = ? FOR UPDATE`, [discovery.subscription_id]))[0];
    if (!subscription) fail();
    const message = (await connection.query("SELECT id, conversation_id, sender_id, sequence_no, created_at, deleted_at FROM messages WHERE id = ? FOR UPDATE", [discovery.message_id]))[0];
    const recipient = role === "admin" ? admin : client, sender = role === "admin" ? client : admin;
    const receipt = (await connection.query("SELECT last_read_sequence FROM chat_receipts WHERE conversation_id = ? AND user_id = ? FOR UPDATE", [discovery.conversation_id, subscription.user_id]))[0];
    const job = (await connection.query(`SELECT ${jobColumns} FROM push_outbox WHERE id = ? FOR UPDATE`, [jobId]))[0];
    if (!job) fail();
    const now = currentTime(fallback);
    const valid = Boolean(admin && admin.role === "admin" && admin.status === "active" && mfa && mfa.enabled_at !== null
      && notFuture(mfa.enabled_at, now) && client && manuallyAdmittedClient(client, now, timestamp) && auth
      && notFuture(client.email_verified_at, now) && notFuture(client.access_approved_at, now) && notFuture(client.invitation_consumed_at, now)
      && sqlInstant(client.access_approved_at) >= sqlInstant(client.invitation_consumed_at)
      && (client.access_expires_at === null || stillFuture(client.access_expires_at, now))
      && conversation && conversation.closed_at === null && notFuture(conversation.created_at, now)
      && conversation.admin_id.equals(admin.id) && conversation.client_id.equals(client.id)
      && recipient && subscription.user_id.equals(recipient.id) && subscription.role === role && subscription.session_id.equals(discovery.session_id)
      && enabled(subscription.enabled) && version(subscription.generation) === version(job.subscription_generation)
      && notFuture(subscription.created_at, now) && notFuture(subscription.updated_at, now)
      && session && session.user_id.equals(recipient.id) && session.revoked_at === null && notFuture(session.created_at, now)
      && version(session.credential_version) === version(subscription.credential_version)
      && version(subscription.credential_version) === version(role === "admin" ? mfa.version : auth.credential_version)
      && (role !== "admin" || sqlInstant(session.mfa_verified_at) >= sqlInstant(session.created_at)
        && sqlInstant(session.mfa_verified_at) >= sqlInstant(mfa.enabled_at) && notFuture(session.mfa_verified_at, now))
      && message && message.conversation_id.equals(conversation.id) && message.sender_id.equals(sender.id)
      && message.deleted_at === null && notFuture(message.created_at, now)
      && (!receipt || BigInt(receipt.last_read_sequence) < BigInt(message.sequence_no)));
    return operation({ job, subscription, now, eligible: valid });
  }
  function leaseMatches(job, leaseToken, now) {
    return job.status === "sending" && Buffer.isBuffer(job.lease_token) && job.lease_token.equals(leaseToken)
      && job.lease_until !== null && stillFuture(job.lease_until, now) && notFuture(job.created_at, now);
  }
  return Object.freeze({
    async assertSchema() {
      return run(async (connection) => {
        const database = (await connection.query("SELECT DATABASE() AS name"))[0]?.name;
        const migrations = await loadMigrations(), history = await migrationStatus(connection, { database, migrations });
        if (history.length !== migrations.length || history.length < 30 || history.some((item) => item.state !== "applied")) fail();
        const enforcement = (await connection.query("SELECT @@SESSION.foreign_key_checks AS fk, @@SESSION.check_constraint_checks AS ck"))[0];
        if (Number(enforcement?.fk) !== 1 || Number(enforcement?.ck) !== 1) fail();
        for (const [table, columns] of [["push_subscriptions", subscriptionColumns], ["push_outbox", jobColumns]]) {
          await connection.query(`SELECT ${columns} FROM ${table} WHERE 1 = 0`);
          const engine = (await connection.query("SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?", [database, table]))[0];
          if (engine?.engine !== "InnoDB") fail();
          const actualColumns = await connection.query(`SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable,
            CHARACTER_MAXIMUM_LENGTH AS length_value, DATETIME_PRECISION AS precision_value, COLUMN_TYPE AS definition,
            COLLATION_NAME AS collation_name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [database, table]);
          if (actualColumns.length !== Object.keys(schema[table]).length) fail();
          for (const [name, [type, nullable, length]] of Object.entries(schema[table])) {
            const column = actualColumns.find((item) => item.name === name);
            if (!column || column.type !== type || (column.nullable === "YES") !== nullable
              || length !== undefined && Number(column.length_value) !== length || type === "datetime" && Number(column.precision_value) !== 6
              || ["int", "tinyint", "smallint"].includes(type) && !column.definition.includes("unsigned")
              || type === "varchar" && column.collation_name !== "ascii_bin") fail();
          }
          const keys = await connection.query("SELECT INDEX_NAME AS name, COLUMN_NAME AS column_name, NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS position, SUB_PART AS prefix_length FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?", [database, table]);
          const expected = table === "push_subscriptions" ? { PRIMARY: ["id"], push_subscriptions_endpoint: ["endpoint_digest"] }
            : { PRIMARY: ["id"], push_outbox_delivery: ["message_id", "subscription_id"] };
          for (const [name, fields] of Object.entries(expected)) {
            const actual = keys.filter((row) => row.name === name).sort((a, b) => Number(a.position) - Number(b.position));
            if (actual.length !== fields.length || actual.some((row, index) => row.column_name !== fields[index] || Number(row.non_unique) !== 0 || row.prefix_length !== null)) fail();
          }
          const scheduling = table === "push_subscriptions" ? { push_subscriptions_owner: ["user_id", "enabled", "id"], push_subscriptions_session: ["session_id"] }
            : { push_outbox_ready: ["status", "available_at", "id"], push_outbox_lease: ["status", "lease_until"],
              push_outbox_subscription: ["subscription_id"], push_outbox_finished: ["status", "finished_at", "id"] };
          for (const [name, fields] of Object.entries(scheduling)) {
            const actual = keys.filter((row) => row.name === name).sort((a, b) => Number(a.position) - Number(b.position));
            if (actual.length !== fields.length || actual.some((row, index) => row.column_name !== fields[index] || Number(row.non_unique) !== 1 || row.prefix_length !== null)) fail();
          }
          const migration = migrations.find((item) => new RegExp(`^CREATE\\s+TABLE\\s+${table}\\s*\\(`, "i").test(item.sql.trim()));
          if (!migration) fail();
          const constraints = await connection.query("SELECT CONSTRAINT_NAME AS name, CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ?", [database, table]);
          for (const match of migration.sql.matchAll(/CONSTRAINT\s+([a-z_]+)\s+CHECK\s*\(/gi)) {
            const actual = constraints.find((item) => item.name === match[1]);
            if (!actual || normalizedCheckTree(actual.clause) !== normalizedCheckTree(authoredMigrationCheck(migration.sql, match[1]))) fail();
          }
        }
        const actualForeignKeys = await connection.query(`SELECT k.TABLE_NAME AS table_name, k.CONSTRAINT_NAME AS name,
          k.COLUMN_NAME AS child, k.REFERENCED_TABLE_NAME AS parent_table, k.REFERENCED_TABLE_SCHEMA AS parent_schema, k.REFERENCED_COLUMN_NAME AS parent_column,
          k.ORDINAL_POSITION AS position, r.UPDATE_RULE AS update_rule, r.DELETE_RULE AS delete_rule
          FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
          ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
          WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME IN ('push_subscriptions', 'push_outbox') AND k.REFERENCED_TABLE_NAME IS NOT NULL`, [database]);
        for (const [table, name, parent, children, parents] of foreignKeys) {
          const actual = actualForeignKeys.filter((item) => item.table_name === table && item.name === name).sort((a, b) => Number(a.position) - Number(b.position));
          if (actual.length !== children.length || actual.some((item, index) => item.child !== children[index] || item.parent_table !== parent
            || item.parent_schema !== database || item.parent_column !== parents[index] || item.update_rule !== "RESTRICT" || item.delete_rule !== "RESTRICT")) fail();
        }
        return true;
      });
    },
    open(request) {
      bytes(request.notificationId);
      return withActor(request, async (connection, context) => {
        const member = request.role === "admin" ? "admin_id" : "client_id";
        // The reference grants nothing: current session, recipient ownership,
        // role and conversation membership are independently required.
        const row = (await connection.query(`SELECT m.id AS message_id, m.conversation_id, m.sequence_no
          FROM push_outbox o JOIN push_subscriptions p ON p.id = o.subscription_id
          JOIN messages m ON m.id = o.message_id JOIN conversations c ON c.id = m.conversation_id
          WHERE o.id = ? AND p.user_id = ? AND p.role = ? AND c.${member} = ?
          AND m.created_at <= ? AND c.created_at <= ?`,
        [request.notificationId, context.actor.id, request.role, context.actor.id, sqlDate(context.now), sqlDate(context.now)]))[0];
        if (!row) fail("NOTIFICATIONS_NOT_FOUND");
        const sequence = String(row.sequence_no);
        if (!/^[1-9][0-9]{0,19}$/.test(sequence) || BigInt(sequence) > 18446744073709551615n) fail();
        return { conversationId: bytes(row.conversation_id).toString("hex"), messageId: bytes(row.message_id).toString("hex"), sequence };
      });
    },
    status(request) {
      if (request.endpointDigest !== undefined) bytes(request.endpointDigest, 32);
      return withActor(request, async (connection, context) => {
        const rows = await connection.query(`SELECT ${subscriptionColumns} FROM push_subscriptions WHERE user_id = ? ORDER BY enabled DESC, updated_at DESC, id LIMIT 64`, [context.actor.id]);
        const current = request.endpointDigest === undefined ? null : (await connection.query(`SELECT ${subscriptionColumns} FROM push_subscriptions WHERE endpoint_digest = ? AND user_id = ?`, [request.endpointDigest, context.actor.id]))[0] ?? null;
        if (current && !rows.some((row) => row.id.equals(current.id))) { if (rows.length === 64) rows.pop(); rows.push(current); }
        let currentEligible = false;
        if (current && enabled(current.enabled) && version(current.credential_version) === context.credentialVersion) {
          const table = request.role === "admin" ? "auth_session_state" : "client_session_state";
          const column = request.role === "admin" ? "mfa_version" : "credential_version";
          const session = (await connection.query(`SELECT s.user_id, s.created_at, s.revoked_at, a.${column} AS credential_version
            FROM sessions s JOIN ${table} a ON a.session_id = s.id WHERE s.id = ? FOR UPDATE`, [current.session_id]))[0];
          const value = openSubscription(current.subscription_encrypted, key, { subscriptionId: current.id, userId: current.user_id, generation: version(current.generation) });
          currentEligible = Boolean(session && session.user_id.equals(context.actor.id) && session.revoked_at === null
            && version(session.credential_version) === context.credentialVersion && notFuture(session.created_at, context.now)
            && notFuture(current.updated_at, context.now) && (value.expirationTime === null || value.expirationTime > context.now));
        }
        return { subscriptions: rows.map((row) => current?.id.equals(row.id) && !currentEligible ? { ...dto(row), enabled: false } : dto(row)),
          currentId: currentEligible ? current.id.toString("hex") : null };
      });
    },
    subscribe(request) {
      const subscription = validateSubscription(request.subscription), locale = validateLocale(request.locale ?? "fr");
      return withActor(request, async (connection, context) => {
        const now = context.now;
        if (subscription.expirationTime !== null && subscription.expirationTime <= now) fail("NOTIFICATIONS_STORE_INPUT");
        const digest = endpointDigest(subscription.endpoint, key);
        const previous = (await connection.query(`SELECT ${subscriptionColumns} FROM push_subscriptions WHERE endpoint_digest = ? FOR UPDATE`, [digest]))[0];
        if (previous && !previous.user_id.equals(context.actor.id)) fail("NOTIFICATIONS_CONFLICT");
        // Explicitly revoked sessions no longer occupy an active-device slot.
        await connection.query(`UPDATE push_subscriptions p JOIN sessions s ON s.id = p.session_id SET p.enabled = 0, p.updated_at = ?
          WHERE p.user_id = ? AND p.enabled = 1 AND (s.revoked_at IS NOT NULL OR p.credential_version <> ?)`, [sqlDate(now), context.actor.id, context.credentialVersion]);
        const candidates = await connection.query(`SELECT ${subscriptionColumns} FROM push_subscriptions WHERE user_id = ? AND enabled = 1 ORDER BY id LIMIT 17`, [context.actor.id]);
        if (candidates.length > 16) fail();
        const active = [];
        for (const row of candidates) {
          const value = openSubscription(row.subscription_encrypted, key, { subscriptionId: row.id, userId: row.user_id, generation: version(row.generation) });
          if (value.expirationTime !== null && value.expirationTime <= now) await connection.query("UPDATE push_subscriptions SET enabled = 0, updated_at = ? WHERE id = ?", [sqlDate(now), row.id]);
          else active.push(row);
        }
        const alreadyActive = active.some((row) => previous?.id.equals(row.id));
        if (!alreadyActive && active.length >= 16) fail("NOTIFICATIONS_LIMIT");
        if (previous) {
          if (!notFuture(previous.created_at, now) || !notFuture(previous.updated_at, now)) fail();
          const before = openSubscription(previous.subscription_encrypted, key, { subscriptionId: previous.id, userId: previous.user_id, generation: version(previous.generation) });
          const changed = !alreadyActive || !previous.session_id.equals(context.sessionId) || version(previous.credential_version) !== context.credentialVersion
            || previous.locale !== locale || JSON.stringify(before) !== JSON.stringify(subscription);
          const generation = changed ? version(previous.generation) + 1 : version(previous.generation);
          if (generation > 4294967295) fail();
          const encrypted = changed ? sealSubscription(subscription, key, { subscriptionId: previous.id, userId: context.actor.id, generation }) : previous.subscription_encrypted;
          await connection.query(`UPDATE push_subscriptions SET session_id = ?, credential_version = ?, generation = ?, subscription_encrypted = ?, locale = ?, enabled = 1, updated_at = ? WHERE id = ?`,
          [context.sessionId, context.credentialVersion, generation, encrypted, locale, sqlDate(now), previous.id]);
          return { ...dto(previous), enabled: true, updatedAt: now };
        }
        const id = randomBytes(16), generation = 1;
        const encrypted = sealSubscription(subscription, key, { subscriptionId: id, userId: context.actor.id, generation });
        try {
          await connection.query(`INSERT INTO push_subscriptions (${subscriptionColumns}) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 1, ?, ?)`,
          [id, context.actor.id, request.role, context.sessionId, context.credentialVersion, digest, encrypted, locale, sqlDate(now), sqlDate(now)]);
        } catch (error) {
          if (error?.code === "ER_DUP_ENTRY" || Number(error?.errno) === 1062) fail("NOTIFICATIONS_CONFLICT");
          throw error;
        }
        return { id: id.toString("hex"), enabled: true, createdAt: now, updatedAt: now };
      });
    },
    disable(request) {
      bytes(request.id);
      return withActor(request, async (connection, context) => {
        const row = (await connection.query("SELECT id, updated_at FROM push_subscriptions WHERE id = ? AND user_id = ? FOR UPDATE", [request.id, context.actor.id]))[0];
        if (!row) return false;
        if (!notFuture(row.updated_at, context.now)) fail();
        await connection.query("UPDATE push_subscriptions SET enabled = 0, updated_at = ? WHERE id = ?", [sqlDate(context.now), request.id]);
        return true;
      });
    },
    async claimDue({ now, limit = 5, leaseMs = 90000 } = {}) {
      instant(now);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(leaseMs) || leaseMs < 10000 || leaseMs > 300000) fail("NOTIFICATIONS_STORE_INPUT");
      const candidates = await run((connection) => connection.query(`SELECT id FROM push_outbox WHERE (status = 'pending' AND available_at <= ?)
        OR (status = 'sending' AND lease_until <= ?) ORDER BY available_at, id LIMIT ?`, [sqlDate(now), sqlDate(now), limit * 4]));
      const jobs = [];
      for (const candidate of candidates) {
        if (jobs.length >= limit) break;
        // Commit each claim before taking another account's locks. A batch must
        // not retain users from earlier conversations while waiting for others.
        await run((connection) => withJob(connection, candidate.id, now, async ({ job, now: current, eligible }) => {
            const ready = job.status === "pending" && notFuture(job.available_at, current)
              || job.status === "sending" && notFuture(job.lease_until, current);
            if (!ready) return;
            if (!notFuture(job.created_at, current)) fail();
            if (!eligible || !stillFuture(job.expires_at, current)) { await finish(connection, job, "skipped", current); return; }
            const attempts = Number(job.attempts);
            if (!Number.isInteger(attempts) || attempts < 0 || attempts > 6) fail();
            if (attempts >= 6) { await finish(connection, job, "failed", current); return; }
            const leaseToken = randomBytes(16);
            await connection.query("UPDATE push_outbox SET status = 'sending', attempts = attempts + 1, lease_token = ?, lease_until = ? WHERE id = ?", [leaseToken, sqlDate(current + leaseMs), job.id]);
            jobs.push({ jobId: Buffer.from(job.id), leaseToken, attempts: attempts + 1, expiresAt: timestamp(job.expires_at) });
        }));
      }
      return jobs;
    },
    prepareDelivery({ jobId, leaseToken, now } = {}) {
      bytes(jobId); bytes(leaseToken); instant(now);
      return run((connection) => withJob(connection, jobId, now, async ({ job, subscription, now: current, eligible }) => {
        if (!leaseMatches(job, leaseToken, current)) return null;
        if (!eligible || !stillFuture(job.expires_at, current)) { await finish(connection, job, "skipped", current); return null; }
        const value = openSubscription(subscription.subscription_encrypted, key, { subscriptionId: subscription.id, userId: subscription.user_id, generation: version(subscription.generation) });
        if (!timingSafeEqual(endpointDigest(value.endpoint, key), bytes(subscription.endpoint_digest, 32))) fail();
        if (value.expirationTime !== null && value.expirationTime <= current) {
          await connection.query("UPDATE push_subscriptions SET enabled = 0, updated_at = ? WHERE id = ?", [sqlDate(current), subscription.id]);
          await finish(connection, job, "skipped", current); return null;
        }
        return { subscription: value, role: subscription.role, locale: validateLocale(subscription.locale), expiresAt: timestamp(job.expires_at) };
      }));
    },
    settleDelivery({ jobId, leaseToken, now, result } = {}) {
      bytes(jobId); bytes(leaseToken); instant(now);
      if (!result || !["accepted", "invalid_subscription", "retry", "release", "failed"].includes(result.status)
        || Object.keys(result).some((name) => !["status", "nextAttemptAt"].includes(name))) fail("NOTIFICATIONS_STORE_INPUT");
      if (["retry", "release"].includes(result.status)) instant(result.nextAttemptAt);
      return run((connection) => withJob(connection, jobId, now, async ({ job, subscription, now: current }) => {
        if (!leaseMatches(job, leaseToken, current)) return false;
        if (result.status === "invalid_subscription") {
          if (version(subscription.generation) === version(job.subscription_generation)) await connection.query("UPDATE push_subscriptions SET enabled = 0, updated_at = ? WHERE id = ?", [sqlDate(current), subscription.id]);
          await finish(connection, job, "skipped", current);
        } else if (result.status === "release") {
          if (Number(job.attempts) < 1) fail("NOTIFICATIONS_STORE_INPUT");
          await connection.query("UPDATE push_outbox SET status = 'pending', attempts = attempts - 1, available_at = ?, lease_token = NULL, lease_until = NULL WHERE id = ?", [sqlDate(Math.max(current, result.nextAttemptAt)), job.id]);
        } else if (result.status === "retry") {
          if (Number(job.attempts) >= 6 || result.nextAttemptAt >= timestamp(job.expires_at)) await finish(connection, job, "failed", current);
          else {
            if (result.nextAttemptAt <= current) fail("NOTIFICATIONS_STORE_INPUT");
            await connection.query("UPDATE push_outbox SET status = 'pending', available_at = ?, lease_token = NULL, lease_until = NULL WHERE id = ?", [sqlDate(result.nextAttemptAt), job.id]);
          }
        } else await finish(connection, job, result.status, current);
        return true;
      }));
    },
    cleanup({ now, limit = 100 } = {}) {
      instant(now);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("NOTIFICATIONS_STORE_INPUT");
      return run(async (connection) => {
        const cutoff = Math.max(0, currentTime(now) - 30 * 86400000);
        let removed = 0;
        for (const status of terminal) {
          if (removed >= limit) break;
          const result = await connection.query("DELETE FROM push_outbox WHERE status = ? AND finished_at < ? ORDER BY finished_at, id LIMIT ?", [status, sqlDate(cutoff), limit - removed]);
          if (!Number.isSafeInteger(result.affectedRows) || result.affectedRows < 0 || result.affectedRows > limit - removed) fail();
          removed += result.affectedRows;
        }
        return { removed };
      });
    },
  });
}
