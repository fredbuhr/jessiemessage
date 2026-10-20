import { DATA_POLICY } from "./policy.mjs";
import { readDeletionFacts } from "./deletion-store.mjs";

const MAX_DATE = 253402300799999;
const MAX_SEQUENCE = 18446744073709551615n;
const INVENTORY_LIMIT = 10000;
export class DataStoreError extends Error {
  constructor() { super("Private client data is unavailable."); this.name = "DataStoreError"; this.code = "DATA_STORE_UNAVAILABLE"; }
}
const fail = () => { throw new DataStoreError(); };
const instant = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
const bytes = (value, size) => { if (!Buffer.isBuffer(value) || value.length !== size) fail(); return Buffer.from(value); };
function text(value, maximum, empty = false) {
  if (typeof value !== "string" || value.length > maximum || !value.isWellFormed() || !empty && value.length < 1) fail();
  return value;
}
function date(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value)) fail();
  const iso = `${value.slice(0, 23).replace(" ", "T")}Z`, parsed = Date.parse(iso);
  if (!instant(parsed) || new Date(parsed).toISOString() !== iso) fail();
  return value;
}
function sequence(value) {
  const result = typeof value === "bigint" ? String(value) : typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof result !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(result) || BigInt(result) > MAX_SEQUENCE) fail();
  return result;
}
function integer(value, maximum) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 1 || result > maximum) fail(); return result; }
function array(value, maximum) { if (!Array.isArray(value) || value.length > maximum) fail(); return value; }
function pageInput(options, kind) {
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((name) => ![kind, "limit"].includes(name))) fail();
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail();
  return { limit, after: kind === "afterSequence" ? sequence(options.afterSequence ?? "0") : options.afterId == null ? null : bytes(options.afterId, 16) };
}
const mediaProjection = `a.id AS asset_id, a.owner_id AS asset_owner_id, a.owner_role AS asset_owner_role,
  a.storage_key, a.content_digest, a.width, a.height, a.full_bytes, a.deleted_at AS asset_deleted_at,
  a.created_at AS asset_created_at, o.state AS journal_state, o.asset_id AS journal_asset_id, o.owner_id AS journal_owner_id`;
function media(row, nowSql) {
  const record = { id: bytes(row.asset_id, 16), ownerId: bytes(row.asset_owner_id, 16), ownerRole: row.asset_owner_role,
    storageKey: bytes(row.storage_key, 32), digest: bytes(row.content_digest, 32), width: integer(row.width, 2048), height: integer(row.height, 2048),
    fullBytes: integer(row.full_bytes, 10485760), deletedAt: date(row.asset_deleted_at, true), journalState: row.journal_state,
    journalAssetId: bytes(row.journal_asset_id, 16), journalOwnerId: bytes(row.journal_owner_id, 16) };
  if (!["admin", "client"].includes(record.ownerRole) || record.deletedAt !== null || date(row.asset_created_at) > nowSql
    || record.journalState !== "registered" || !record.journalAssetId.equals(record.id) || !record.journalOwnerId.equals(record.ownerId)) fail();
  return record;
}

/** One read-only SQL snapshot. No service, authentication mutation or file operation is started. */
export async function withClientData(input = {}, callback) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail();
  const { pool, clientId, now } = input;
  if (typeof pool?.getConnection !== "function" || typeof callback !== "function" || !instant(now)) fail();
  const target = bytes(clientId, 16), nowSql = new Date(now).toISOString().replace("T", " ").replace("Z", "000");
  let connection, begun = false, active = false, busy = false;
  const pending = new Set();
  try {
    connection = await pool.getConnection();
    await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    // A lost acknowledgement can leave START effective on the server. Attempt
    // rollback on that path before releasing the dedicated connection too.
    begun = true;
    await connection.query("START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT");
    const accounts = array(await connection.query(`SELECT u.id, u.role, u.pseudonym, u.email, u.status, u.created_at, u.updated_at,
      u.email_verified_at, ca.age_declared_at, u.age_assured_at, u.access_approved_at, u.access_expires_at
      FROM users u LEFT JOIN client_auth_state ca ON ca.user_id = u.id WHERE u.id = ? AND u.role = 'client' LIMIT 2`, [target]), 2);
    if (accounts.length !== 1) fail();
    const row = accounts[0];
    if (!bytes(row.id, 16).equals(target) || row.role !== "client" || !["pending", "active", "suspended", "revoked", "deleted"].includes(row.status)) fail();
    const account = Object.freeze({ id: Buffer.from(target), role: "client", pseudonym: text(row.pseudonym, 64), email: text(row.email, 254), status: row.status,
      createdAt: date(row.created_at), updatedAt: date(row.updated_at), emailVerifiedAt: date(row.email_verified_at, true),
      ageDeclaredAt: date(row.age_declared_at, true), ageAssuredAt: date(row.age_assured_at, true), accessApprovedAt: date(row.access_approved_at, true),
      accessExpiresAt: date(row.access_expires_at, true) });
    if (account.createdAt > nowSql || account.updatedAt < account.createdAt) fail();
    const conversations = array(await connection.query(`SELECT c.id, c.client_id, c.admin_id, peer.pseudonym AS peer_name,
      c.created_at, c.closed_at, COALESCE(own.last_read_sequence, 0) AS last_read_sequence
      FROM conversations c JOIN users peer ON peer.id = c.admin_id AND peer.role = 'admin'
      LEFT JOIN chat_receipts own ON own.conversation_id = c.id AND own.user_id = c.client_id
      WHERE c.client_id = ? LIMIT 2`, [target]), 2);
    if (conversations.length > 1) fail();
    let context = null, conversation = null;
    if (conversations.length) {
      const value = conversations[0];
      context = { id: bytes(value.id, 16), clientId: bytes(value.client_id, 16), adminId: bytes(value.admin_id, 16) };
      if (!context.clientId.equals(target) || context.adminId.equals(target)) fail();
      conversation = Object.freeze({ id: Buffer.from(context.id), clientId: Buffer.from(context.clientId), adminId: Buffer.from(context.adminId),
        peerName: text(value.peer_name, 64), createdAt: date(value.created_at), closedAt: date(value.closed_at, true),
        // Keep the established client export shape without reading Jessie’s private receipt.
        lastReadSequence: sequence(value.last_read_sequence), peerReadSequence: "0" });
      if (conversation.createdAt > nowSql || conversation.closedAt !== null && conversation.closedAt < conversation.createdAt) fail();
    }
    const preferences = array(await connection.query("SELECT enabled, updated_at FROM broadcast_preferences WHERE user_id = ? LIMIT 2", [target]), 2);
    if (preferences.length > 1 || preferences.some((value) => ![0, 1, 0n, 1n].includes(value.enabled))) fail();
    const preference = Object.freeze(preferences.length ? { enabled: Number(preferences[0].enabled) === 1, updatedAt: date(preferences[0].updated_at) }
      : { enabled: false, updatedAt: null });
    function run(operation) {
      if (!active || busy) return Promise.reject(new DataStoreError());
      busy = true;
      const work = Promise.resolve().then(() => { if (!active) fail(); return operation(); })
        .then((value) => { if (!active) fail(); return value; }).catch(() => fail())
        .finally(() => { busy = false; pending.delete(work); });
      pending.add(work);
      // A callback that forgets to await a read must not produce an unhandled rejection.
      void work.catch(() => {});
      return work;
    }
    const inventorySources = {
      users: ["users WHERE id = ? AND role = 'client'", [target]],
      invitations: ["invitations WHERE consumed_by_id = ?", [target]],
      sessions: ["sessions WHERE user_id = ?", [target]],
      conversations: ["conversations WHERE client_id = ?", [target]],
      client_auth_state: ["client_auth_state WHERE user_id = ?", [target]],
      email_verifications: ["email_verifications WHERE user_id = ?", [target]],
      client_session_state: ["client_session_state cs JOIN sessions s ON s.id = cs.session_id WHERE s.user_id = ?", [target]],
      mail_outbox: ["mail_outbox WHERE recipient_user_id = ?", [target]],
      media_assets: ["media_assets WHERE owner_id = ? AND owner_role = 'client'", [target]],
      client_password_resets: ["client_password_resets WHERE user_id = ?", [target]],
      password_reset_outbox: ["password_reset_outbox WHERE recipient_user_id = ?", [target]],
      broadcast_preferences: ["broadcast_preferences WHERE user_id = ?", [target]],
      media_storage_objects: ["media_storage_objects WHERE owner_id = ? AND owner_role = 'client'", [target]],
      push_subscriptions: ["push_subscriptions WHERE user_id = ? AND role = 'client'", [target]],
      push_outbox: [`push_outbox o JOIN push_subscriptions p ON p.id = o.subscription_id JOIN messages m ON m.id = o.message_id
        WHERE (p.user_id = ? AND p.role = 'client')${context ? " OR m.conversation_id = ?" : ""}`, [target, ...(context ? [context.id] : [])]],
      ...(context ? Object.fromEntries(["messages", "chat_receipts", "chat_events", "message_media", "crm_profiles", "crm_memberships"]
        .map((table) => [table, [`${table} WHERE conversation_id = ?`, [context.id]]])) : {}),
      ...(context ? { broadcast_recipients: ["broadcast_recipients WHERE client_id = ? AND conversation_id = ?", [target, context.id]] } : {}),
    };
    const reader = Object.freeze({ account, conversation, preference,
      deletionFacts: () => run(() => readDeletionFacts({ connection, clientId: target, conversation: context, nowSql })),
      inventory: () => run(async () => {
        const result = [];
        for (const entry of DATA_POLICY) {
          const source = inventorySources[entry.table];
          if (entry.scope !== "subject") { result.push({ table: entry.table, scope: entry.scope, count: null, truncated: false }); continue; }
          if (!source) { result.push({ table: entry.table, scope: entry.scope, count: 0, truncated: false }); continue; }
          const counts = array(await connection.query(`SELECT 1 AS present FROM ${source[0]} LIMIT 10001`, source[1]), INVENTORY_LIMIT + 1);
          if (counts.some((value) => !value || Object.keys(value).length !== 1 || value.present !== 1)) fail();
          result.push({ table: entry.table, scope: entry.scope, count: Math.min(counts.length, INVENTORY_LIMIT), truncated: counts.length > INVENTORY_LIMIT });
        }
        return result;
      }),
      messages: (options = {}) => run(async () => {
        const { limit, after } = pageInput(options, "afterSequence");
        if (context === null) return { rows: [], hasMore: false, nextCursor: null };
        const values = array(await connection.query(`SELECT m.id, m.conversation_id, m.sender_id, m.sender_role, m.sequence_no,
          m.body_encrypted, m.body_fingerprint, m.created_at, m.deleted_at, mm.media_id AS linked_media_id, ${mediaProjection}
          FROM messages m LEFT JOIN message_media mm ON mm.conversation_id = m.conversation_id AND mm.message_id = m.id
          LEFT JOIN media_assets a ON a.id = mm.media_id LEFT JOIN media_storage_objects o ON o.storage_key = a.storage_key
          WHERE m.conversation_id = ? AND m.sequence_no > ? ORDER BY m.sequence_no ASC LIMIT ?`, [context.id, after, limit + 1]), limit + 1);
        let previous = BigInt(after);
        const selected = values.slice(0, limit).map((value) => {
          const result = { id: bytes(value.id, 16), conversationId: bytes(value.conversation_id, 16), senderId: bytes(value.sender_id, 16), senderRole: value.sender_role,
            sequence: sequence(value.sequence_no), encrypted: value.body_encrypted, fingerprint: bytes(value.body_fingerprint, 32),
            createdAt: date(value.created_at), deletedAt: date(value.deleted_at, true), media: null };
          if (!result.conversationId.equals(context.id) || !["admin", "client"].includes(result.senderRole)
            || !result.senderId.equals(result.senderRole === "client" ? context.clientId : context.adminId)
            || BigInt(result.sequence) <= previous || result.createdAt > nowSql) fail();
          previous = BigInt(result.sequence);
          if (result.deletedAt !== null) { if (result.encrypted !== null || result.deletedAt < result.createdAt) fail(); }
          else {
            result.encrypted = text(result.encrypted, 22000);
            if (value.linked_media_id !== null) {
              const linked = bytes(value.linked_media_id, 16);
              result.media = media(value, nowSql);
              if (!linked.equals(result.media.id) || !result.media.ownerId.equals(result.senderId) || result.media.ownerRole !== result.senderRole) fail();
            } else if (value.asset_id !== null) fail();
          }
          return result;
        });
        const hasMore = values.length > limit;
        return { rows: selected, hasMore, nextCursor: hasMore ? selected.at(-1).sequence : null };
      }),
      ownMedia: (options = {}) => run(async () => {
        const { limit, after } = pageInput(options, "afterId");
        const values = array(await connection.query(`SELECT ${mediaProjection} FROM media_assets a
          LEFT JOIN media_storage_objects o ON o.storage_key = a.storage_key
          WHERE a.owner_id = ? AND a.owner_role = 'client' AND a.deleted_at IS NULL AND a.created_at <= ?
          ${after === null ? "" : "AND a.id > ?"} ORDER BY a.id ASC LIMIT ?`, [target, nowSql, ...(after === null ? [] : [after]), limit + 1]), limit + 1);
        let previous = after;
        const selected = values.slice(0, limit).map((value) => {
          const result = media(value, nowSql);
          if (!result.ownerId.equals(target) || result.ownerRole !== "client" || previous !== null && Buffer.compare(result.id, previous) <= 0) fail();
          previous = result.id;
          return result;
        });
        const hasMore = values.length > limit;
        return { rows: selected, hasMore, nextCursor: hasMore ? Buffer.from(selected.at(-1).id) : null };
      }),
    });
    active = true;
    let result, unfinished = false;
    try { result = await callback(reader); }
    finally { unfinished = pending.size > 0; active = false; await Promise.allSettled([...pending]); }
    if (unfinished) fail();
    await connection.commit(); begun = false;
    return result;
  } catch {
    active = false;
    await Promise.allSettled([...pending]);
    if (begun) { try { await connection.rollback(); } catch {} }
    fail();
  } finally {
    if (connection) { try { connection.release(); } catch { fail(); } }
  }
}
