import { MAX_VIDEO_BYTES, videoStoredBytes } from "../video/storage.mjs";

export class BackupCryptoStoreError extends Error {
  constructor() { super("Private backup data could not be read."); this.name = "BackupCryptoStoreError"; this.code = "BACKUP_DATABASE"; }
}
const fail = () => { throw new BackupCryptoStoreError(); };
const PURPOSES = ["mfa", "mail", "reset", "messages", "crm", "tasks", "broadcast", "announcements", "media", "notifications", "notificationJobs"];
function bytes(value, length) { if (!Buffer.isBuffer(value) || value.length !== length) fail(); return Buffer.from(value); }
function nullableBytes(value, length) { return value === null ? null : bytes(value, length); }
function text(value, maximum) { if (typeof value !== "string" || value.length < 1 || value.length > maximum) fail(); return value; }
function integer(value, maximum) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1 || number > maximum) fail(); return number; }
function announcementDate(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}000$/.test(value)) fail();
  const result = Date.parse(`${value.slice(0, 23).replace(" ", "T")}Z`);
  if (!Number.isSafeInteger(result) || result < 0 || result > 253402300799999
    || new Date(result).toISOString() !== `${value.slice(0, 23).replace(" ", "T")}Z`) fail();
  return result;
}
function announcementRevision(value) {
  if (!["string", "number", "bigint"].includes(typeof value) || typeof value === "number" && !Number.isSafeInteger(value)) fail();
  const result = String(value);
  if (!/^[1-9][0-9]{0,19}$/.test(result) || BigInt(result) > 18446744073709551615n) fail();
  return result;
}

const statements = {
  preferences: { id: "p.user_id", from: "profile_preferences p JOIN users u ON u.id = p.user_id", columns: "p.user_id AS id, p.version, p.selection_encrypted AS encrypted, u.role AS owner_role" },
  mfa: { id: "m.user_id", from: "admin_mfa m", columns: "m.user_id AS id, m.secret_encrypted AS encrypted" },
  mail: { id: "o.id", from: `mail_outbox o
    LEFT JOIN email_verifications v ON v.id = o.verification_id
    LEFT JOIN users u ON u.id = o.recipient_user_id`,
  columns: "o.id, o.payload_encrypted AS encrypted, o.recipient_user_id, v.user_id AS challenge_user_id, v.token_hash, u.email AS recipient_email" },
  reset: { id: "o.id", from: `password_reset_outbox o
    LEFT JOIN client_password_resets r ON r.id = o.reset_id
    LEFT JOIN users u ON u.id = o.recipient_user_id`,
  columns: "o.id, o.payload_encrypted AS encrypted, o.recipient_user_id, r.user_id AS challenge_user_id, r.token_hash, r.email_hash, u.email AS recipient_email" },
  messages: { id: "m.id", from: `messages m
    LEFT JOIN conversations c ON c.id = m.conversation_id
    LEFT JOIN message_media mm ON mm.message_id = m.id AND mm.conversation_id = m.conversation_id
    LEFT JOIN media_assets a ON a.id = mm.media_id`,
  columns: `m.id, m.conversation_id, m.sender_id, m.sender_role, m.body_encrypted AS encrypted, m.body_fingerprint,
    m.deleted_at, c.admin_id, c.client_id, mm.media_id, a.owner_id AS media_owner_id` },
  crm: { id: null, from: "crm_profiles p", columns: "p.admin_id, p.conversation_id, p.notes_encrypted AS encrypted, p.notes_revision, p.version" },
  tasks: { id: "t.id", from: `crm_tasks t
    LEFT JOIN users u ON u.id = t.admin_id
    LEFT JOIN conversations c ON c.id = t.conversation_id`,
  columns: `t.id, t.admin_id, t.admin_role, t.conversation_id, t.title_encrypted AS encrypted, t.due_at, t.done,
    t.version, t.request_fingerprint, t.created_at, t.updated_at, u.role AS user_role, c.admin_id AS conversation_admin_id` },
  broadcast: { id: "b.id", from: "broadcast_campaigns b", columns: "b.id, b.admin_id, b.payload_encrypted AS encrypted, b.request_fingerprint, b.media_id, b.allow_repeat_media" },
  announcements: { id: "a.id", from: `announcements a
    LEFT JOIN users u ON u.id = a.admin_id
    LEFT JOIN broadcast_campaigns b ON b.id = a.campaign_id`,
  columns: `a.id, a.admin_id, a.admin_role, a.revision, a.body_encrypted AS encrypted,
    a.starts_at, a.expires_at, a.send_private_message, a.campaign_id, a.removed_at, a.created_at, a.updated_at,
    u.role AS user_role, b.admin_id AS campaign_admin_id` },
  // Unregistered candidates have no media_assets row. Their recovery belongs
  // to the storage journal; this reader never treats them as missing photos.
  media: { id: "a.id", from: `media_assets a
    LEFT JOIN media_storage_objects o ON o.storage_key = a.storage_key`,
  columns: `a.id, a.owner_id, a.storage_key, a.content_digest, a.full_bytes, a.thumbnail_bytes,
    o.state AS journal_state, o.asset_id AS journal_asset_id, o.owner_id AS journal_owner_id`, where: "a.deleted_at IS NULL" },
  notifications: { id: "p.id", from: `push_subscriptions p
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN sessions s ON s.id = p.session_id`,
  columns: `p.id, p.user_id, p.role, p.session_id, p.credential_version, p.generation, p.endpoint_digest,
    p.subscription_encrypted AS encrypted, u.role AS user_role, s.user_id AS session_user_id` },
  notificationJobs: { id: "o.id", from: `push_outbox o
    LEFT JOIN push_subscriptions p ON p.id = o.subscription_id
    LEFT JOIN messages m ON m.id = o.message_id
    LEFT JOIN conversations c ON c.id = m.conversation_id`,
  columns: `o.id, o.subscription_generation, p.generation, p.user_id, p.role, m.sender_id, m.sender_role,
    c.admin_id, c.client_id` },
};

const videoMessages = { id: "m.id", from: `${statements.messages.from}
    LEFT JOIN message_video mv ON mv.message_id = m.id
    LEFT JOIN video_assets va ON va.id = mv.video_id`,
  columns: `${statements.messages.columns}, mv.video_id, mv.conversation_id AS video_conversation_id,
    va.owner_id AS video_owner_id, va.owner_role AS video_owner_role, va.state AS video_state,
    DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s.%f') AS message_created_at,
    DATE_FORMAT(mv.created_at, '%Y-%m-%d %H:%i:%s.%f') AS video_link_created_at,
    DATE_FORMAT(va.created_at, '%Y-%m-%d %H:%i:%s.%f') AS video_created_at` };
const videoAssets = { id: "a.id", from: "video_assets a LEFT JOIN users u ON u.id = a.owner_id",
  columns: "a.id, a.owner_id, a.owner_role, u.role AS user_role, a.storage_key, a.content_digest, a.bytes, a.stored_bytes, a.mime, a.state",
  where: "a.state = 'committed'" };
function videoDate(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value)) fail();
  const iso = value.slice(0, 23).replace(" ", "T") + "Z", instant = Date.parse(iso);
  if (!Number.isSafeInteger(instant) || instant < 0 || new Date(instant).toISOString() !== iso) fail();
  return value;
}
function normalize(purpose, row, video = false) {
  if (!row || typeof row !== "object") fail();
  if (purpose === "crm") {
    const adminId = bytes(row.admin_id, 16), conversationId = bytes(row.conversation_id, 16);
    const notesRevision = integer(row.notes_revision, 4294967295), version = integer(row.version, 4294967295);
    if (notesRevision > version) fail();
    return { id: Buffer.concat([adminId, conversationId]), adminId, conversationId,
      encrypted: row.encrypted === null ? null : text(row.encrypted, 44000), notesRevision: String(notesRevision), version: String(version) };
  }
  const result = { id: bytes(row.id, 16) };
  if (purpose === "preferences") {
    if (!["admin", "client"].includes(row.owner_role)) fail();
    return { ...result, version: String(integer(row.version, 4294967295)), encrypted: text(row.encrypted, 90000) };
  }
  if (purpose === "mfa") return { ...result, encrypted: text(row.encrypted, 190) };
  if (purpose === "mail" || purpose === "reset") return { ...result, encrypted: text(row.encrypted, 1024),
    recipientUserId: bytes(row.recipient_user_id, 16), challengeUserId: bytes(row.challenge_user_id, 16),
    tokenHash: bytes(row.token_hash, 32), recipientEmail: text(row.recipient_email, 254),
    ...(purpose === "reset" ? { emailHash: bytes(row.email_hash, 32) } : {}) };
  if (purpose === "messages") {
    if (!["admin", "client"].includes(row.sender_role) || !(row.deleted_at === null || typeof row.deleted_at === "string" && row.deleted_at.length <= 32)) fail();
    return { ...result, conversationId: bytes(row.conversation_id, 16), senderId: bytes(row.sender_id, 16), senderRole: row.sender_role,
      adminId: bytes(row.admin_id, 16), clientId: bytes(row.client_id, 16), encrypted: row.encrypted === null ? null : text(row.encrypted, 22000),
      fingerprint: bytes(row.body_fingerprint, 32), deleted: row.deleted_at !== null,
      mediaId: nullableBytes(row.media_id, 16), mediaOwnerId: nullableBytes(row.media_owner_id, 16),
      ...(video ? { videoId: nullableBytes(row.video_id, 16), videoConversationId: nullableBytes(row.video_conversation_id, 16),
        videoOwnerId: nullableBytes(row.video_owner_id, 16), videoOwnerRole: row.video_owner_role, videoState: row.video_state,
        createdAt: videoDate(row.message_created_at), videoLinkedAt: videoDate(row.video_link_created_at, true),
        videoCreatedAt: videoDate(row.video_created_at, true) } : {}) };
  }
  if (purpose === "broadcast") {
    if (![0, 1, 0n, 1n].includes(row.allow_repeat_media)) fail();
    return { ...result, adminId: bytes(row.admin_id, 16), encrypted: text(row.encrypted, 32000),
      fingerprint: bytes(row.request_fingerprint, 32), mediaId: nullableBytes(row.media_id, 16), allowRepeatMedia: Number(row.allow_repeat_media) === 1 };
  }
  if (purpose === "tasks") {
    if (![0, 1, 0n, 1n].includes(row.done)) fail();
    return { ...result, adminId: bytes(row.admin_id, 16), adminRole: row.admin_role, userRole: row.user_role,
      conversationId: bytes(row.conversation_id, 16), conversationAdminId: bytes(row.conversation_admin_id, 16),
      encrypted: text(row.encrypted, 4096), dueAt: announcementDate(row.due_at, true), done: Number(row.done) === 1,
      version: String(integer(row.version, 4294967295)), fingerprint: bytes(row.request_fingerprint, 32),
      createdAt: announcementDate(row.created_at), updatedAt: announcementDate(row.updated_at) };
  }
  if (purpose === "announcements") {
    if (![0, 1, 0n, 1n].includes(row.send_private_message)) fail();
    return { ...result, adminId: bytes(row.admin_id, 16), adminRole: row.admin_role, userRole: row.user_role,
      revision: announcementRevision(row.revision), encrypted: text(row.encrypted, 8192),
      startsAt: announcementDate(row.starts_at), expiresAt: announcementDate(row.expires_at),
      sendPrivateMessage: Number(row.send_private_message) === 1,
      campaignId: nullableBytes(row.campaign_id, 16), campaignAdminId: nullableBytes(row.campaign_admin_id, 16),
      removedAt: announcementDate(row.removed_at, true), createdAt: announcementDate(row.created_at), updatedAt: announcementDate(row.updated_at) };
  }
  if (purpose === "notifications") return { ...result, userId: bytes(row.user_id, 16), role: row.role, userRole: row.user_role,
    sessionId: bytes(row.session_id, 16), sessionUserId: bytes(row.session_user_id, 16),
    credentialVersion: integer(row.credential_version, 4294967295), generation: integer(row.generation, 4294967295),
    endpointDigest: bytes(row.endpoint_digest, 32), encrypted: text(row.encrypted, 4096) };
  if (purpose === "notificationJobs") return { ...result, userId: bytes(row.user_id, 16), role: row.role,
    subscriptionGeneration: integer(row.subscription_generation, 4294967295), generation: integer(row.generation, 4294967295),
    senderId: bytes(row.sender_id, 16), senderRole: row.sender_role, adminId: bytes(row.admin_id, 16), clientId: bytes(row.client_id, 16) };
  if (purpose === "videos") {
    const byteLength = integer(row.bytes, MAX_VIDEO_BYTES), storedBytes = integer(row.stored_bytes, videoStoredBytes(MAX_VIDEO_BYTES));
    if (!["admin", "client"].includes(row.owner_role) || row.user_role !== row.owner_role || row.state !== "committed"
      || row.mime !== "video/mp4" || storedBytes !== videoStoredBytes(byteLength)) fail();
    return { ...result, ownerId: bytes(row.owner_id, 16), ownerRole: row.owner_role,
      storageKey: bytes(row.storage_key, 32), digest: bytes(row.content_digest, 32), bytes: byteLength, storedBytes,
      mime: row.mime, state: row.state };
  }
  return { ...result, ownerId: bytes(row.owner_id, 16), storageKey: bytes(row.storage_key, 32), digest: bytes(row.content_digest, 32),
    fullBytes: integer(row.full_bytes, 10485760), thumbnailBytes: integer(row.thumbnail_bytes, 524288),
    journalState: row.journal_state, journalAssetId: nullableBytes(row.journal_asset_id, 16), journalOwnerId: nullableBytes(row.journal_owner_id, 16) };
}

/** Bounded SELECT-only crypto reader. It never starts services or claims jobs. */
export function createBackupCryptoStore({ pool, video = false, experience = false } = {}) {
  if (typeof video !== "boolean" || typeof experience !== "boolean" || experience && !video || typeof pool?.getConnection !== "function") throw new TypeError("A private backup reader is required.");
  async function* recipientPages(campaignId) {
    let afterId = null;
    while (true) {
      let connection, rows;
      try {
        connection = await pool.getConnection();
        rows = await connection.query(`SELECT r.conversation_id, r.client_id, r.proposed_message_id, r.client_message_id,
          c.client_id AS actual_client, c.admin_id AS actual_admin FROM broadcast_recipients r
          JOIN conversations c ON c.id = r.conversation_id WHERE r.campaign_id = ?
          ${afterId === null ? "" : "AND r.conversation_id > ?"} ORDER BY r.conversation_id ASC LIMIT 100`,
        [campaignId, ...(afterId === null ? [] : [afterId])]);
        if (!Array.isArray(rows) || rows.length > 100) fail();
        rows = rows.map(row => ({ conversationId: bytes(row.conversation_id, 16), clientId: bytes(row.client_id, 16),
          messageId: bytes(row.proposed_message_id, 16), proof: bytes(row.client_message_id, 16),
          actualClientId: bytes(row.actual_client, 16), actualAdminId: bytes(row.actual_admin, 16) }));
        for (const row of rows) {
          if (afterId !== null && Buffer.compare(row.conversationId, afterId) <= 0) fail();
          afterId = row.conversationId;
        }
      } catch { fail(); }
      finally { try { connection?.release(); } catch {} }
      if (!rows.length) return;
      yield rows;
      if (rows.length < 100) return;
    }
  }
  return Object.freeze({
    async page(options = {}) {
      if (!options || typeof options !== "object" || Array.isArray(options)
        || Object.keys(options).some((name) => !["purpose", "afterId", "limit"].includes(name))) fail();
      const { purpose, afterId = null, limit = 50 } = options;
      if (!(PURPOSES.includes(purpose) || video && purpose === "videos" || experience && purpose === "preferences") || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail();
      const cursor = afterId === null ? null : bytes(afterId, purpose === "crm" ? 32 : 16);
      const statement = video && purpose === "messages" ? videoMessages : purpose === "videos" ? videoAssets : statements[purpose],
        predicates = statement.where ? [statement.where] : [], parameters = [];
      if (cursor !== null) {
        if (purpose === "crm") {
          predicates.push("(p.admin_id > ? OR (p.admin_id = ? AND p.conversation_id > ?))");
          parameters.push(cursor.subarray(0, 16), cursor.subarray(0, 16), cursor.subarray(16));
        } else { predicates.push(`${statement.id} > ?`); parameters.push(cursor); }
      }
      const order = purpose === "crm" ? "p.admin_id ASC, p.conversation_id ASC" : `${statement.id} ASC`;
      let connection;
      try {
        connection = await pool.getConnection();
        const rows = await connection.query(`SELECT ${statement.columns} FROM ${statement.from}
          ${predicates.length ? `WHERE ${predicates.join(" AND ")}` : ""} ORDER BY ${order} LIMIT ?`, [...parameters, limit + 1]);
        if (!Array.isArray(rows) || rows.length > limit + 1) fail();
        const selected = rows.slice(0, limit).map((row) => normalize(purpose, row, video));
        let previous = cursor;
        for (const row of selected) {
          if (previous !== null && Buffer.compare(row.id, previous) <= 0) fail();
          previous = row.id;
          if (purpose === "broadcast") {
            if (row.encrypted.startsWith("v2.") || video && row.encrypted.startsWith("v3.")) {
              const campaignId = Buffer.from(row.id);
              row.recipientPages = () => recipientPages(campaignId);
            } else {
              const recipients = await connection.query("SELECT conversation_id FROM broadcast_recipients WHERE campaign_id = ? ORDER BY conversation_id ASC LIMIT 101", [row.id]);
              if (!Array.isArray(recipients) || recipients.length > 100) fail();
              row.conversationIds = recipients.map((recipient) => bytes(recipient.conversation_id, 16));
            }
          }
        }
        const hasMore = rows.length > limit;
        return { rows: selected, hasMore, nextCursor: hasMore ? Buffer.from(selected.at(-1).id) : null };
      } catch { fail(); }
      finally { try { connection?.release(); } catch {} }
    },
  });
}
