import { createSessionClock, sessionIsValid, adminSessionExpiry, clientSessionExpiry, CLIENT_SESSION_SECONDS, SESSION_TOUCH_MILLISECONDS } from "../auth/session-policy.mjs";
import { manuallyAdmittedClient, invitationConsumptionProjection } from "../access/admission.mjs";
import { timingSafeEqual } from "node:crypto";
import { loadMigrations, migrationStatus } from "../db/migrations.mjs";

export class ChatStoreError extends Error {
  constructor(code, message = "Private conversation persistence could not be completed.") {
    super(message);
    this.name = "ChatStoreError";
    this.code = code;
  }
}

const fail = (code) => { throw new ChatStoreError(code); };
const input = () => fail("CHAT_STORE_INPUT");
const state = () => fail("CHAT_DATABASE_STATE");
const bytes = (value, length) => { if (!Buffer.isBuffer(value) || value.length !== length) input(); return value; };
const instant = (value) => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) input(); return value; };
const sqlDate = (value) => new Date(instant(value)).toISOString().replace("T", " ").replace("Z", "000");
const timestamp = (value) => {
  if (value instanceof Date) { const result = value.getTime(); if (Number.isSafeInteger(result) && result >= 0) return result; }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) state();
  const result = Date.parse(`${value.replace(" ", "T")}Z`);
  if (!Number.isSafeInteger(result) || result < 0) state();
  return result;
};
const dateOrNull = (value) => value === null ? null : timestamp(value);
const sequence = (value) => {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n || BigInt(value).toString() !== value) input();
  return value;
};
const storedSequence = (value) => { try { return sequence(String(value)); } catch { state(); } };
const limitValue = (value, max = 100) => { if (!Number.isInteger(value) || value < 1 || value > max) input(); return value; };
const version = (value) => { const result = Number(value); if (!Number.isInteger(result) || result < 1 || result > 4294967295) state(); return result; };
const roleValue = (role) => { if (!["admin", "client"].includes(role)) input(); return role; };
const activeAdmin = (user) => Boolean(user && user.role === "admin" && user.status === "active");
const activeClient = (user, now) => manuallyAdmittedClient(user, now, timestamp);
const messageProjection = `m.id, m.conversation_id, m.sequence_no, m.sender_id, m.sender_role, m.client_message_id,
  m.body_encrypted, m.body_fingerprint, m.created_at, m.deleted_at, mm.media_id AS linked_media_id,
  ma.deleted_at AS media_deleted_at, ma.owner_id AS media_owner_id, ma.width AS media_width, ma.height AS media_height,
  ma.thumbnail_width AS media_thumbnail_width, ma.thumbnail_height AS media_thumbnail_height,
  ma.full_bytes AS media_full_bytes, ma.thumbnail_bytes AS media_thumbnail_bytes`;
const messageJoins = `LEFT JOIN message_media mm ON mm.conversation_id = m.conversation_id AND mm.message_id = m.id
  LEFT JOIN media_assets ma ON ma.id = mm.media_id`;
const rawMessage = (row, actorId) => ({ id: row.id, conversationId: row.conversation_id, sequence: storedSequence(row.sequence_no),
  senderId: row.sender_id, senderRole: row.sender_role, clientMessageId: row.client_message_id,
  bodyEncrypted: row.body_encrypted, bodyFingerprint: row.body_fingerprint, createdAt: timestamp(row.created_at),
  deletedAt: dateOrNull(row.deleted_at), isMine: row.sender_id.equals(actorId),
  media: row.deleted_at === null && row.linked_media_id && row.media_deleted_at === null && row.media_owner_id?.equals(row.sender_id) ? {
    id: row.linked_media_id, width: Number(row.media_width), height: Number(row.media_height),
    thumbnailWidth: Number(row.media_thumbnail_width), thumbnailHeight: Number(row.media_thumbnail_height),
    fullBytes: Number(row.media_full_bytes), thumbnailBytes: Number(row.media_thumbnail_bytes),
  } : null });

const schemaColumns = {
  messages: { id: ["varbinary", false, 16], conversation_id: ["varbinary", false, 16], sequence_no: ["bigint", false], sender_id: ["varbinary", false, 16], sender_role: ["varchar", false, 8], client_message_id: ["varbinary", false, 16], body_encrypted: ["varchar", true, 22000], body_fingerprint: ["varbinary", false, 32], created_at: ["datetime", false], deleted_at: ["datetime", true] },
  chat_receipts: { conversation_id: ["varbinary", false, 16], user_id: ["varbinary", false, 16], last_read_sequence: ["bigint", false], updated_at: ["datetime", false] },
  chat_events: { conversation_id: ["varbinary", false, 16], event_sequence: ["bigint", false], message_id: ["varbinary", false, 16], kind: ["varchar", false, 8], occurred_at: ["datetime", false] },
  conversations: { id: ["varbinary", false, 16], client_id: ["varbinary", false, 16], client_role: ["varchar", false, 8], admin_id: ["varbinary", false, 16], admin_role: ["varchar", false, 8], created_at: ["datetime", false], closed_at: ["datetime", true] },
  users: { id: ["varbinary", false, 16], role: ["varchar", false, 8], status: ["varchar", false, 16], pseudonym: ["varchar", false, 64], email_verified_at: ["datetime", true], age_assured_at: ["datetime", true], access_approved_at: ["datetime", true], access_expires_at: ["datetime", true] },
  sessions: { id: ["varbinary", false, 16], user_id: ["varbinary", false, 16], token_hash: ["varbinary", false, 32], created_at: ["datetime", false], expires_at: ["datetime", false], revoked_at: ["datetime", true] },
  admin_mfa: { user_id: ["varbinary", false, 16], version: ["int", false], enabled_at: ["datetime", true] },
  auth_session_state: { session_id: ["varbinary", false, 16], last_seen_at: ["datetime", false], mfa_verified_at: ["datetime", false], mfa_version: ["int", false] },
  client_auth_state: { user_id: ["varbinary", false, 16], credential_version: ["int", false] },
  client_session_state: { session_id: ["varbinary", false, 16], last_seen_at: ["datetime", false], credential_version: ["int", false] },
};
const schemaKeys = {
  messages: { PRIMARY: ["id"], messages_conversation_sequence: ["conversation_id", "sequence_no"], messages_idempotency: ["conversation_id", "sender_id", "client_message_id"], messages_conversation_id: ["conversation_id", "id"] },
  chat_receipts: { PRIMARY: ["conversation_id", "user_id"] }, chat_events: { PRIMARY: ["conversation_id", "event_sequence"] },
  conversations: { PRIMARY: ["id"], conversations_client: ["client_id"] }, users: { PRIMARY: ["id"], users_id_role: ["id", "role"] },
  sessions: { PRIMARY: ["id"], sessions_token_hash: ["token_hash"] }, admin_mfa: { PRIMARY: ["user_id"] }, auth_session_state: { PRIMARY: ["session_id"] },
  client_auth_state: { PRIMARY: ["user_id"] }, client_session_state: { PRIMARY: ["session_id"] },
};
const schemaForeignKeys = [
  ["messages", "messages_conversation_fk", "conversations", ["conversation_id"], ["id"]],
  ["messages", "messages_sender_fk", "users", ["sender_id", "sender_role"], ["id", "role"]],
  ["chat_receipts", "chat_receipts_conversation_fk", "conversations", ["conversation_id"], ["id"]],
  ["chat_receipts", "chat_receipts_user_fk", "users", ["user_id"], ["id"]],
  ["chat_events", "chat_events_message_fk", "messages", ["conversation_id", "message_id"], ["conversation_id", "id"]],
  ["conversations", "conversations_client_fk", "users", ["client_id", "client_role"], ["id", "role"]],
  ["conversations", "conversations_admin_fk", "users", ["admin_id", "admin_role"], ["id", "role"]],
  ["sessions", "sessions_user", "users", ["user_id"], ["id"]],
  ["auth_session_state", "auth_session_parent_fk", "sessions", ["session_id"], ["id"]],
  ["client_session_state", "client_session_parent_fk", "sessions", ["session_id"], ["id"]],
  ["admin_mfa", "admin_mfa_user_fk", "users", ["user_id", "role"], ["id", "role"]],
  ["client_auth_state", "client_auth_user_fk", "users", ["user_id", "role"], ["id", "role"]],
];
const schemaChecks = {
  messages: ["messages_id_size", "messages_conversation_size", "messages_sender_size", "messages_client_id_size", "messages_fingerprint_size", "messages_sequence", "messages_sender_role", "messages_body_state"],
  chat_receipts: ["chat_receipts_conversation_size", "chat_receipts_user_size"],
  chat_events: ["chat_events_conversation_size", "chat_events_message_size", "chat_events_sequence", "chat_events_kind"],
  conversations: ["conversations_id_size", "conversations_client_role", "conversations_admin_role", "conversations_distinct_people", "conversations_lifetime"],
};

// Compare the small, deliberately restricted CHECK grammar used by these
// immutable migrations. MariaDB removes redundant parentheses/backticks and
// changes keyword casing, so string comparison would reject an intact schema.
// Parsing AND/OR precedence preserves meaningful parentheses and rejects a
// same-name weaker clause, including CHECK (1).
function checkTree(expression) {
  const tokens = [];
  const pattern = /\s+|`([a-z_][a-z0-9_]*)`|'(?:''|[^'])*'|>=|<=|<>|!=|[=<>(),]|[0-9]+|[a-z_][a-z0-9_]*/iy;
  let offset = 0;
  while (offset < expression.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(expression);
    if (!match) state();
    offset = pattern.lastIndex;
    if (!/^\s+$/.test(match[0])) tokens.push(match[1] ?? (match[0].startsWith("'") ? match[0] : match[0].toLowerCase()));
  }
  let position = 0;
  const take = (expected) => { if (tokens[position++] !== expected) state(); };
  function operand() {
    const token = tokens[position++];
    if (!token || !/^(?:[a-z_][a-z0-9_]*|[0-9]+|'(?:''|[^'])*')$/i.test(token)) state();
    if (tokens[position] === "(") {
      position++;
      if (!["octet_length", "char_length"].includes(token)) state();
      const argument = operand();
      take(")");
      return ["call", token, argument];
    }
    return ["value", token];
  }
  function predicate() {
    if (tokens[position] === "(") { position++; const result = or(); take(")"); return result; }
    const left = operand(), operator = tokens[position++];
    if (["=", "<>", "!=", ">", "<", ">=", "<="].includes(operator)) return [operator === "!=" ? "<>" : operator, left, operand()];
    if (operator === "is") {
      const negative = tokens[position] === "not";
      if (negative) position++;
      take("null");
      return [negative ? "is-not-null" : "is-null", left];
    }
    if (operator === "between") { const low = operand(); take("and"); return ["between", left, low, operand()]; }
    if (operator === "in") {
      take("("); const values = [operand()];
      while (tokens[position] === ",") { position++; values.push(operand()); }
      take(")"); return ["in", left, ...values];
    }
    state();
  }
  const combine = (name, children) => children.length === 1 ? children[0] : [name, ...children.flatMap((child) => child[0] === name ? child.slice(1) : [child])];
  function and() { const children = [predicate()]; while (tokens[position] === "and") { position++; children.push(predicate()); } return combine("and", children); }
  function or() { const children = [and()]; while (tokens[position] === "or") { position++; children.push(and()); } return combine("or", children); }
  const result = or();
  if (position !== tokens.length) state();
  return JSON.stringify(result);
}
function authoredCheck(sql, name) {
  const match = new RegExp(`CONSTRAINT\\s+${name}\\s+CHECK\\s*\\(`, "i").exec(sql);
  if (!match) state();
  const start = match.index + match[0].length;
  let depth = 1;
  for (let position = start; position < sql.length; position++) {
    if (sql[position] === "(") depth++;
    if (sql[position] === ")" && --depth === 0) return sql.slice(start, position);
  }
  state();
}
// New private stores reuse the same restricted migration-CHECK comparison.
export { checkTree as normalizedCheckTree, authoredCheck as authoredMigrationCheck };

export function createChatStore(pool, { clock, enqueueNotification } = {}) {
  if (enqueueNotification !== undefined && typeof enqueueNotification !== "function") input();
  const sessionNow = createSessionClock(clock);
  async function run(operation, transaction = true) {
    let connection;
    let begun = false;
    try {
      connection = await pool.getConnection();
      if (transaction) {
        // Discovery reads must not freeze a REPEATABLE READ snapshot before a
        // competing writer releases the conversation lock. This applies only to
        // the next transaction; it does not change pooled session defaults.
        await connection.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
        await connection.beginTransaction(); begun = true;
      }
      const result = await operation(connection);
      if (begun) await connection.commit();
      return result;
    } catch (error) {
      if (begun) { try { await connection.rollback(); } catch {} }
      if (error instanceof ChatStoreError) throw error;
      fail("CHAT_DATABASE_OPERATION");
    } finally { if (connection) { try { connection.release(); } catch {} } }
  }

  async function lockUser(connection, userId) {
    return (await connection.query(`SELECT id, role, status, pseudonym, email_verified_at, age_assured_at,
      access_approved_at, access_expires_at, ${invitationConsumptionProjection()} FROM users WHERE id = ? FOR UPDATE`, [userId]))[0];
  }
  async function lockMfa(connection, admin, now) {
    if (!activeAdmin(admin)) fail("CHAT_FORBIDDEN");
    const mfa = (await connection.query("SELECT version, enabled_at FROM admin_mfa WHERE user_id = ? FOR UPDATE", [admin.id]))[0];
    if (!mfa || mfa.enabled_at === null || timestamp(mfa.enabled_at) > sessionNow(now)) fail("CHAT_FORBIDDEN");
    return mfa;
  }
  async function lockClientAuth(connection, client) {
    if (!client || client.role !== "client") fail("CHAT_NOT_FOUND");
    const auth = (await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ? FOR UPDATE", [client.id]))[0];
    if (!auth) fail("CHAT_FORBIDDEN");
    return auth;
  }
  async function actorSession(connection, tokenHash, actor, role, proof, now) {
    const projection = role === "admin" ? "a.mfa_verified_at, a.mfa_version" : "a.credential_version";
    const table = role === "admin" ? "auth_session_state" : "client_session_state";
    const row = (await connection.query(`SELECT s.id, s.user_id, s.created_at, s.expires_at, s.revoked_at,
      a.last_seen_at, ${projection} FROM sessions s JOIN ${table} a ON a.session_id = s.id
      WHERE s.token_hash = ? AND s.user_id = ? FOR UPDATE`, [tokenHash, actor.id]))[0];
    if (!row || row.revoked_at !== null || actor.role !== role) fail("CHAT_UNAUTHORIZED");
    now = sessionNow(now);
    const createdAt = timestamp(row.created_at), lastSeenAt = timestamp(row.last_seen_at);
    if (!sessionIsValid({ role, createdAt, lastSeenAt, expiresAt: timestamp(row.expires_at), now })) fail("CHAT_UNAUTHORIZED");
    if (role === "admin") {
      const verified = timestamp(row.mfa_verified_at), enrolled = timestamp(proof.enabled_at);
      if (version(row.mfa_version) !== version(proof.version) || verified < createdAt || verified < enrolled || verified > lastSeenAt) fail("CHAT_UNAUTHORIZED");
    } else if (version(row.credential_version) !== version(proof.credential_version)) fail("CHAT_UNAUTHORIZED");
    let expiresAt = timestamp(row.expires_at);
    if (now - lastSeenAt >= SESSION_TOUCH_MILLISECONDS || role === "client" && expiresAt - now < CLIENT_SESSION_SECONDS * 1000 - SESSION_TOUCH_MILLISECONDS) {
      await connection.query(`UPDATE ${table} SET last_seen_at = ? WHERE session_id = ?`, [sqlDate(now), row.id]);
      expiresAt = Math.max(expiresAt, role === "admin" ? adminSessionExpiry(now) : clientSessionExpiry(now));
      await connection.query("UPDATE sessions SET expires_at = ? WHERE id = ?", [sqlDate(expiresAt), row.id]);
    }
    return { ...row, expires_at: new Date(expiresAt), now };
  }
  async function candidateActor(connection, tokenHash) {
    const row = (await connection.query("SELECT user_id FROM sessions WHERE token_hash = ? LIMIT 1", [tokenHash]))[0];
    if (!row) fail("CHAT_UNAUTHORIZED");
    return row.user_id;
  }
  async function authorize(connection, { role, tokenHash, conversationId, now, send = false }) {
    const actorId = await candidateActor(connection, tokenHash);
    const candidate = (await connection.query("SELECT id, admin_id, client_id FROM conversations WHERE id = ?", [conversationId]))[0];
    if (!candidate || !candidate[role === "admin" ? "admin_id" : "client_id"].equals(actorId)) fail("CHAT_NOT_FOUND");
    // All chat requests lock the administrator before the client, then proofs,
    // actor session, and conversation. Authorization is repeated under those
    // locks; neither HTTP claims nor the initial candidate grants access.
    const admin = await lockUser(connection, candidate.admin_id);
    const client = await lockUser(connection, candidate.client_id);
    const mfa = await lockMfa(connection, admin, now);
    const auth = await lockClientAuth(connection, client);
    const actor = role === "admin" ? admin : client;
    const conversation = (await connection.query("SELECT id, admin_id, client_id, created_at, closed_at FROM conversations WHERE id = ? FOR UPDATE", [conversationId]))[0];
    if (!conversation || !conversation.admin_id.equals(admin.id) || !conversation.client_id.equals(client.id)
      || !conversation[role === "admin" ? "admin_id" : "client_id"].equals(actor.id)) fail("CHAT_NOT_FOUND");
    now = (await actorSession(connection, tokenHash, actor, role, role === "admin" ? mfa : auth, now)).now;
    if (role === "client" && !activeClient(client, now)) fail("CHAT_FORBIDDEN");
    if (timestamp(conversation.created_at) > now) fail("CHAT_FORBIDDEN");
    if (send && (!activeClient(client, now) || conversation.closed_at !== null)) fail("CHAT_FORBIDDEN");
    return { actor, admin, client, conversation, now };
  }
  async function summary(connection, context) {
    const { conversation, actor, admin, client, now } = context;
    const peer = actor.role === "admin" ? client : admin;
    const row = (await connection.query(`SELECT
      COALESCE((SELECT MAX(sequence_no) FROM messages WHERE conversation_id = ?), 0) AS latestSequence,
      COALESCE((SELECT MAX(event_sequence) FROM chat_events WHERE conversation_id = ?), 0) AS latestEventSequence,
      (SELECT MAX(occurred_at) FROM chat_events WHERE conversation_id = ?) AS lastActivityAt,
      COALESCE((SELECT last_read_sequence FROM chat_receipts WHERE conversation_id = ? AND user_id = ?), 0) AS lastReadSequence,
      COALESCE((SELECT last_read_sequence FROM chat_receipts WHERE conversation_id = ? AND user_id = ?), 0) AS peerReadSequence,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = ? AND sender_id <> ? AND deleted_at IS NULL
        AND sequence_no > COALESCE((SELECT last_read_sequence FROM chat_receipts WHERE conversation_id = ? AND user_id = ?), 0)) AS unreadCount`,
    [conversation.id, conversation.id, conversation.id, conversation.id, actor.id, conversation.id, peer.id, conversation.id, actor.id, conversation.id, actor.id]))[0];
    const unreadCount = Number(row.unreadCount);
    if (!Number.isSafeInteger(unreadCount) || unreadCount < 0) state();
    // A peer avatar is visible only through this already authorized private
    // conversation. Profile changes never create message/activity events.
    const peerAvatar = (await connection.query(`SELECT p.version FROM user_profiles p JOIN media_assets a ON a.id = p.avatar_media_id
      WHERE p.user_id = ? AND a.owner_id = ? AND a.owner_role = ? AND a.deleted_at IS NULL
        AND p.created_at <= ? AND p.updated_at <= ? AND a.created_at <= ?
        AND a.width <= 512 AND a.height <= 512 AND a.full_bytes <= 262144 AND a.thumbnail_bytes <= 131072`,
    [peer.id, peer.id, peer.role, sqlDate(now), sqlDate(now), sqlDate(now)]))[0];
    let peerAvatarVersion;
    if (peerAvatar) {
      peerAvatarVersion = storedSequence(peerAvatar.version);
      if (peerAvatarVersion === "0" || BigInt(peerAvatarVersion) > 4294967295n) state();
    }
    return { id: conversation.id, clientId: client.id, clientPseudonym: client.pseudonym, peerPseudonym: peer.pseudonym,
      createdAt: timestamp(conversation.created_at), closedAt: dateOrNull(conversation.closed_at), lastActivityAt: dateOrNull(row.lastActivityAt),
      latestSequence: storedSequence(row.latestSequence), latestEventSequence: storedSequence(row.latestEventSequence),
      lastReadSequence: storedSequence(row.lastReadSequence), peerReadSequence: actor.role === "admin" ? storedSequence(row.peerReadSequence) : "0", unreadCount,
      ...(peerAvatarVersion === undefined ? {} : { peerAvatarVersion }),
      canSend: conversation.closed_at === null && activeClient(client, now) };
  }
  async function nextEvent(connection, conversationId) {
    const previous = storedSequence((await connection.query("SELECT COALESCE(MAX(event_sequence), 0) AS value FROM chat_events WHERE conversation_id = ?", [conversationId]))[0].value);
    if (previous === "18446744073709551615") state();
    return String(BigInt(previous) + 1n);
  }
  function validateMessage(message) {
    bytes(message?.id, 16); bytes(message?.clientMessageId, 16); bytes(message?.bodyFingerprint, 32);
    const mediaId = message.mediaId ?? null; if (mediaId !== null) bytes(mediaId, 16);
    if (typeof message.bodyEncrypted !== "string" || message.bodyEncrypted.length < 1 || message.bodyEncrypted.length > 22000 || !/^[\x20-\x7e]+$/.test(message.bodyEncrypted)) input();
    return mediaId;
  }
  async function appendMessage(connection, context, message) {
    const mediaId = validateMessage(message);
    const { actor, conversation, now } = context;
    const conversationId = conversation.id, role = actor.role;
    const previous = (await connection.query(`SELECT ${messageProjection} FROM messages m ${messageJoins} WHERE m.conversation_id = ? AND m.sender_id = ? AND m.client_message_id = ? FOR UPDATE`, [conversationId, actor.id, message.clientMessageId]))[0];
    if (previous) {
      if (!timingSafeEqual(previous.body_fingerprint, message.bodyFingerprint)
        || (mediaId === null ? previous.linked_media_id !== null : !previous.linked_media_id?.equals(mediaId))) fail("CHAT_CONFLICT");
      return { message: rawMessage(previous, actor.id), duplicate: true };
    }
    if (mediaId !== null) {
      const asset = (await connection.query("SELECT id, owner_id, owner_role, created_at, deleted_at FROM media_assets WHERE id = ? FOR UPDATE", [mediaId]))[0];
      if (!asset || !asset.owner_id.equals(actor.id) || asset.owner_role !== role || asset.deleted_at !== null) fail("CHAT_NOT_FOUND");
      if (timestamp(asset.created_at) > now) fail("CHAT_FORBIDDEN");
    }
    const lastSequence = storedSequence((await connection.query("SELECT COALESCE(MAX(sequence_no), 0) AS value FROM messages WHERE conversation_id = ?", [conversationId]))[0].value);
    if (lastSequence === "18446744073709551615") state();
    const nextSequence = String(BigInt(lastSequence) + 1n);
    const eventSequence = await nextEvent(connection, conversationId);
    await connection.query(`INSERT INTO messages (id, conversation_id, sequence_no, sender_id, sender_role,
      client_message_id, body_encrypted, body_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [message.id, conversationId, nextSequence, actor.id, role, message.clientMessageId, message.bodyEncrypted, message.bodyFingerprint, sqlDate(now)]);
    if (mediaId !== null) await connection.query("INSERT INTO message_media (message_id, conversation_id, media_id, created_at) VALUES (?, ?, ?, ?)", [message.id, conversationId, mediaId, sqlDate(now)]);
    await connection.query("INSERT INTO chat_events (conversation_id, event_sequence, message_id, kind, occurred_at) VALUES (?, ?, ?, 'message', ?)", [conversationId, eventSequence, message.id, sqlDate(now)]);
    if (enqueueNotification) await enqueueNotification(connection, context, message);
    const row = (await connection.query(`SELECT ${messageProjection} FROM messages m ${messageJoins} WHERE m.conversation_id = ? AND m.id = ?`, [conversationId, message.id]))[0];
    return { message: rawMessage(row, actor.id), duplicate: false };
  }
  function validateRequest(request) { roleValue(request.role); bytes(request.tokenHash, 32); bytes(request.conversationId, 16); instant(request.now); }

  return Object.freeze({
    // These callbacks are trusted server code. They reuse the complete live
    // SQL authorization and transaction rather than accepting a claimed user.
    async withActor({ role, tokenHash, now }, operation) {
      roleValue(role); bytes(tokenHash, 32); instant(now); if (typeof operation !== "function") input();
      return run(async (connection) => {
        const actorId = await candidateActor(connection, tokenHash);
        if (role === "client") {
          const candidate = (await connection.query("SELECT id FROM conversations WHERE client_id = ? LIMIT 1", [actorId]))[0];
          if (!candidate) fail("CHAT_FORBIDDEN");
          return operation(connection, await authorize(connection, { role, tokenHash, conversationId: candidate.id, now }));
        }
        const admin = await lockUser(connection, actorId);
        const mfa = await lockMfa(connection, admin, now);
        now = (await actorSession(connection, tokenHash, admin, role, mfa, now)).now;
        return operation(connection, { actor: admin, admin, now, mfaVersion: version(mfa.version) });
      });
    },

    async withPreferenceActor({ tokenHash, now }, operation) {
      bytes(tokenHash, 32); instant(now); if (typeof operation !== "function") input();
      return run(async (connection) => {
        const actorId = await candidateActor(connection, tokenHash);
        const client = await lockUser(connection, actorId);
        now = sessionNow(now);
        if (!client || client.role !== "client" || !["pending", "active"].includes(client.status)
          || client.email_verified_at === null || timestamp(client.email_verified_at) > now) fail("CHAT_UNAUTHORIZED");
        const auth = (await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ? FOR UPDATE", [client.id]))[0];
        if (!auth) fail("CHAT_UNAUTHORIZED");
        const session = await actorSession(connection, tokenHash, client, "client", auth, now);
        now = session.now;
        return operation(connection, { actor: client, client, session, expiresAt: timestamp(session.expires_at), now });
      });
    },

    async withBroadcastDelivery({ adminId, mfaVersion, conversationId, now }, operation) {
      bytes(adminId, 16); bytes(conversationId, 16); instant(now);
      if (!Number.isInteger(mfaVersion) || mfaVersion < 1 || mfaVersion > 4294967295 || typeof operation !== "function") input();
      return run(async (connection) => {
        // The durable approval contains no session. Its current account and MFA
        // epoch are checked under the same lock order as an ordinary send.
        const admin = await lockUser(connection, adminId);
        const candidate = (await connection.query("SELECT id, admin_id, client_id FROM conversations WHERE id = ?", [conversationId]))[0];
        const client = candidate ? await lockUser(connection, candidate.client_id) : null;
        const mfa = (await connection.query("SELECT version, enabled_at FROM admin_mfa WHERE user_id = ? FOR UPDATE", [adminId]))[0];
        const auth = client?.role === "client" ? (await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ? FOR UPDATE", [client.id]))[0] : null;
        if (auth) version(auth.credential_version);
        const conversation = (await connection.query("SELECT id, admin_id, client_id, created_at, closed_at FROM conversations WHERE id = ? FOR UPDATE", [conversationId]))[0] ?? null;
        now = sessionNow(now);
        const administratorValid = activeAdmin(admin) && mfa && mfa.enabled_at !== null
          && timestamp(mfa.enabled_at) <= now && version(mfa.version) === mfaVersion;
        const recipientValid = Boolean(candidate && conversation && client && auth
          && conversation.admin_id.equals(adminId) && candidate.admin_id.equals(adminId)
          && conversation.client_id.equals(client.id) && candidate.client_id.equals(client.id)
          && timestamp(conversation.created_at) <= now && conversation.closed_at === null && activeClient(client, now));
        const canSend = Boolean(administratorValid && recipientValid);
        const context = Object.freeze({ actor: admin ?? null, admin: admin ?? null, client: client ?? null, conversation, now,
          canSend, reason: !administratorValid ? "administrator_invalid" : !recipientValid ? "recipient_unavailable" : null });
        let open = true, used = false;
        const append = async (message) => {
          if (!open || used || !canSend) fail("CHAT_FORBIDDEN");
          used = true;
          return appendMessage(connection, context, message);
        };
        try { return await operation(connection, context, append); }
        finally { open = false; }
      });
    },

    async withConversation(request, operation) {
      validateRequest(request); if (typeof operation !== "function" || (request.send !== undefined && typeof request.send !== "boolean")) input();
      return run(async (connection) => operation(connection, await authorize(connection, request)));
    },

    async assertSchema() {
      return run(async (connection) => {
        const database = (await connection.query("SELECT DATABASE() AS name"))[0].name;
        const enforcement = (await connection.query("SELECT @@SESSION.foreign_key_checks AS foreignKeys, @@SESSION.check_constraint_checks AS checkConstraints"))[0];
        if (Number(enforcement.foreignKeys) !== 1 || Number(enforcement.checkConstraints) !== 1) state();
        const migrations = await loadMigrations();
        const history = await migrationStatus(connection, { database, migrations });
        if (history.length < 15 || history.some((item) => item.state !== "applied")) state();
        const tables = await connection.query("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
        const columns = await connection.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, DATA_TYPE AS dataType,
          IS_NULLABLE AS nullable, CHARACTER_MAXIMUM_LENGTH AS length, DATETIME_PRECISION AS precisionValue,
          COLUMN_TYPE AS columnType, COLLATION_NAME AS collationName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?`, [database]);
        for (const [table, definitions] of Object.entries(schemaColumns)) {
          if (!tables.some((item) => item.name === table && item.engine === "InnoDB")) state();
          for (const [name, [type, nullable, length]] of Object.entries(definitions)) {
            const column = columns.find((item) => item.tableName === table && item.columnName === name);
            if (!column || column.dataType !== type || (column.nullable === "YES") !== nullable
              || (length !== undefined && Number(column.length) !== length) || (type === "datetime" && Number(column.precisionValue) !== 6)
              || ((type === "bigint" || type === "int") && !column.columnType.includes("unsigned"))
              || (["role", "status", "sender_role", "client_role", "admin_role", "kind", "body_encrypted"].includes(name) && column.collationName !== "ascii_bin")) state();
          }
        }
        const keys = await connection.query(`SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, COLUMN_NAME AS columnName,
          NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS positionValue, SUB_PART AS prefixLength FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ?`, [database]);
        for (const [table, definitions] of Object.entries(schemaKeys)) for (const [name, expected] of Object.entries(definitions)) {
          const actual = keys.filter((item) => item.tableName === table && item.indexName === name).sort((a, b) => Number(a.positionValue) - Number(b.positionValue));
          if (actual.length !== expected.length || actual.some((item, index) => Number(item.nonUnique) !== 0 || item.columnName !== expected[index] || item.prefixLength !== null)) state();
        }
        const foreignKeys = await connection.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, COLUMN_NAME AS columnName,
          REFERENCED_TABLE_SCHEMA AS parentSchema, REFERENCED_TABLE_NAME AS parentTable, REFERENCED_COLUMN_NAME AS parentColumn, ORDINAL_POSITION AS positionValue
          FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`, [database]);
        const references = await connection.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, UPDATE_RULE AS updateRule,
          DELETE_RULE AS deleteRule FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?`, [database]);
        for (const [table, name, parent, children, parents] of schemaForeignKeys) {
          const actual = foreignKeys.filter((item) => item.tableName === table && item.name === name).sort((a, b) => Number(a.positionValue) - Number(b.positionValue));
          if (actual.length !== children.length || actual.some((item, index) => item.parentSchema !== database || item.parentTable !== parent || item.columnName !== children[index] || item.parentColumn !== parents[index])
            || !references.some((item) => item.tableName === table && item.name === name && item.updateRule === "RESTRICT" && item.deleteRule === "RESTRICT")) state();
        }
        const constraints = await connection.query("SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, CONSTRAINT_TYPE AS type FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?", [database]);
        const clauses = await connection.query("SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS name, CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?", [database]);
        for (const [table, names] of Object.entries(schemaChecks)) for (const name of names) {
          if (!constraints.some((item) => item.tableName === table && item.name === name && item.type === "CHECK")) state();
          const clause = clauses.find((item) => item.tableName === table && item.name === name);
          const migration = migrations.find((item) => new RegExp(`^CREATE\\s+TABLE\\s+${table}\\s*\\(`, "i").test(item.sql.trim()));
          if (!clause || !migration || checkTree(clause.clause) !== checkTree(authoredCheck(migration.sql, name))) state();
        }
        for (const [table, definitions] of Object.entries(schemaColumns)) await connection.query(`SELECT ${Object.keys(definitions).join(", ")} FROM ${table} WHERE 1 = 0`);
        return true;
      }, false);
    },

    async listConversations({ tokenHash, now, afterId = null, limit = 50 }) {
      bytes(tokenHash, 32); instant(now); limitValue(limit); if (afterId !== null) bytes(afterId, 16);
      return run(async (connection) => {
        const actorId = await candidateActor(connection, tokenHash);
        const admin = await lockUser(connection, actorId);
        const mfa = await lockMfa(connection, admin, now);
        const actorProof = await actorSession(connection, tokenHash, admin, "admin", mfa, now);
        now = actorProof.now;
        const rows = await connection.query(`SELECT id, client_id FROM conversations WHERE admin_id = ? ${afterId === null ? "" : "AND id > ?"} ORDER BY id ASC LIMIT ?`, afterId === null ? [admin.id, limit + 1] : [admin.id, afterId, limit + 1]);
        const hasMore = rows.length > limit;
        const selected = rows.slice(0, limit);
        const conversations = [];
        for (const row of selected) {
          // The administrator account, MFA proof and actor session remain
          // exclusively locked for this transaction. Repeating those lookups
          // per row cannot improve authorization. Read and lock each current
          // client/proof and recheck conversation binding before its summary.
          const client = await lockUser(connection, row.client_id);
          await lockClientAuth(connection, client);
          const conversation = (await connection.query("SELECT id, admin_id, client_id, created_at, closed_at FROM conversations WHERE id = ? FOR UPDATE", [row.id]))[0];
          if (!conversation || !conversation.admin_id.equals(admin.id) || !conversation.client_id.equals(client.id)) fail("CHAT_NOT_FOUND");
          now = sessionNow(now);
          if (now >= timestamp(actorProof.expires_at)) fail("CHAT_UNAUTHORIZED");
          if (timestamp(conversation.created_at) > now) fail("CHAT_FORBIDDEN");
          conversations.push(await summary(connection, { actor: admin, admin, client, conversation, now }));
        }
        return { conversations, nextCursor: hasMore ? selected.at(-1).id : null, hasMore };
      });
    },

    async getClientConversation({ tokenHash, now }) {
      bytes(tokenHash, 32); instant(now);
      return run(async (connection) => {
        const actorId = await candidateActor(connection, tokenHash);
        const candidate = (await connection.query("SELECT id FROM conversations WHERE client_id = ? LIMIT 1", [actorId]))[0];
        if (candidate) return summary(connection, await authorize(connection, { role: "client", tokenHash, conversationId: candidate.id, now }));
        const client = await lockUser(connection, actorId);
        const auth = await lockClientAuth(connection, client);
        now = (await actorSession(connection, tokenHash, client, "client", auth, now)).now;
        if (!activeClient(client, now)) fail("CHAT_FORBIDDEN");
        return null;
      });
    },

    async readMessages({ role, tokenHash, conversationId, now, before = null, after = null, limit = 50 }) {
      validateRequest({ role, tokenHash, conversationId, now }); limitValue(limit);
      if (before !== null) sequence(before); if (after !== null) sequence(after); if (before !== null && after !== null) input();
      return run(async (connection) => {
        const context = await authorize(connection, { role, tokenHash, conversationId, now });
        const direction = after !== null ? "ASC" : "DESC";
        const comparison = before !== null ? "AND m.sequence_no < ?" : after !== null ? "AND m.sequence_no > ?" : "";
        const parameters = [conversationId, ...(before !== null ? [before] : after !== null ? [after] : []), limit + 1];
        let rows = await connection.query(`SELECT ${messageProjection} FROM messages m ${messageJoins} WHERE m.conversation_id = ? ${comparison} ORDER BY m.sequence_no ${direction} LIMIT ?`, parameters);
        rows = rows.slice(0, limit); if (direction === "DESC") rows.reverse();
        let hasMoreBefore = false, hasMoreAfter = false;
        if (rows.length) {
          hasMoreBefore = (await connection.query("SELECT 1 FROM messages WHERE conversation_id = ? AND sequence_no < ? LIMIT 1", [conversationId, String(rows[0].sequence_no)])).length > 0;
          hasMoreAfter = (await connection.query("SELECT 1 FROM messages WHERE conversation_id = ? AND sequence_no > ? LIMIT 1", [conversationId, String(rows.at(-1).sequence_no)])).length > 0;
        }
        const conversation = await summary(connection, context);
        return { conversation, messages: rows.map((row) => rawMessage(row, context.actor.id)), hasMoreBefore, hasMoreAfter,
          nextBefore: hasMoreBefore ? storedSequence(rows[0].sequence_no) : null, nextAfter: hasMoreAfter ? storedSequence(rows.at(-1).sequence_no) : null,
          eventCursor: conversation.latestEventSequence };
      });
    },

    async readEvents({ role, tokenHash, conversationId, now, after = "0", limit = 100 }) {
      validateRequest({ role, tokenHash, conversationId, now }); sequence(after); limitValue(limit);
      return run(async (connection) => {
        const context = await authorize(connection, { role, tokenHash, conversationId, now });
        const rows = await connection.query(`SELECT e.event_sequence, e.kind, e.occurred_at, ${messageProjection}
          FROM chat_events e JOIN messages m ON m.conversation_id = e.conversation_id AND m.id = e.message_id ${messageJoins}
          WHERE e.conversation_id = ? AND e.event_sequence > ? ORDER BY e.event_sequence ASC LIMIT ?`, [conversationId, after, limit + 1]);
        const selected = rows.slice(0, limit);
        return { conversation: await summary(connection, context), events: selected.map((row) => ({ sequence: storedSequence(row.event_sequence),
          kind: row.kind, occurredAt: timestamp(row.occurred_at), message: rawMessage(row, context.actor.id) })),
          nextCursor: selected.length ? storedSequence(selected.at(-1).event_sequence) : after, hasMore: rows.length > limit };
      });
    },

    async sendMessage({ role, tokenHash, conversationId, now, message }) {
      validateRequest({ role, tokenHash, conversationId, now }); validateMessage(message);
      return run(async (connection) => {
        const context = await authorize(connection, { role, tokenHash, conversationId, now, send: true });
        return appendMessage(connection, context, message);
      });
    },

    async markRead({ role, tokenHash, conversationId, now, through }) {
      validateRequest({ role, tokenHash, conversationId, now }); sequence(through);
      return run(async (connection) => {
        const context = await authorize(connection, { role, tokenHash, conversationId, now });
        if (through !== "0" && !(await connection.query("SELECT id FROM messages WHERE conversation_id = ? AND sequence_no = ? FOR UPDATE", [conversationId, through])).length) fail("CHAT_NOT_FOUND");
        await connection.query(`INSERT INTO chat_receipts (conversation_id, user_id, last_read_sequence, updated_at) VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE last_read_sequence = GREATEST(last_read_sequence, VALUES(last_read_sequence)), updated_at = VALUES(updated_at)`, [conversationId, context.actor.id, through, sqlDate(context.now)]);
        const row = (await connection.query("SELECT last_read_sequence FROM chat_receipts WHERE conversation_id = ? AND user_id = ?", [conversationId, context.actor.id]))[0];
        return { lastReadSequence: storedSequence(row.last_read_sequence) };
      });
    },

    async deleteMessage({ role, tokenHash, conversationId, messageId, now }) {
      validateRequest({ role, tokenHash, conversationId, now }); bytes(messageId, 16);
      return run(async (connection) => {
        const context = await authorize(connection, { role, tokenHash, conversationId, now });
        now = context.now;
        const row = (await connection.query(`SELECT ${messageProjection} FROM messages m ${messageJoins} WHERE m.conversation_id = ? AND m.id = ? FOR UPDATE`, [conversationId, messageId]))[0];
        if (!row || !row.sender_id.equals(context.actor.id)) fail("CHAT_NOT_FOUND");
        if (row.deleted_at !== null) return rawMessage(row, context.actor.id);
        if (timestamp(row.created_at) > now) fail("CHAT_FORBIDDEN");
        const eventSequence = await nextEvent(connection, conversationId);
        await connection.query("UPDATE messages SET body_encrypted = NULL, deleted_at = ? WHERE conversation_id = ? AND id = ?", [sqlDate(now), conversationId, messageId]);
        await connection.query("INSERT INTO chat_events (conversation_id, event_sequence, message_id, kind, occurred_at) VALUES (?, ?, ?, 'delete', ?)", [conversationId, eventSequence, messageId, sqlDate(now)]);
        return rawMessage({ ...row, body_encrypted: null, deleted_at: sqlDate(now) }, context.actor.id);
      });
    },
  });
}
