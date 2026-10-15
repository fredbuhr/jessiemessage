export class BackupCryptoStoreError extends Error {
  constructor() { super("Private backup data could not be read."); this.name = "BackupCryptoStoreError"; this.code = "BACKUP_DATABASE"; }
}
const fail = () => { throw new BackupCryptoStoreError(); };
const PURPOSES = ["mfa", "mail", "reset", "messages", "crm", "broadcast", "media"];
function bytes(value, length) { if (!Buffer.isBuffer(value) || value.length !== length) fail(); return Buffer.from(value); }
function nullableBytes(value, length) { return value === null ? null : bytes(value, length); }
function text(value, maximum) { if (typeof value !== "string" || value.length < 1 || value.length > maximum) fail(); return value; }
function integer(value, maximum) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1 || number > maximum) fail(); return number; }

const statements = {
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
  broadcast: { id: "b.id", from: "broadcast_campaigns b", columns: "b.id, b.admin_id, b.payload_encrypted AS encrypted, b.request_fingerprint, b.media_id, b.allow_repeat_media" },
  // Unregistered candidates have no media_assets row. Their recovery belongs
  // to the storage journal; this reader never treats them as missing photos.
  media: { id: "a.id", from: `media_assets a
    LEFT JOIN media_storage_objects o ON o.storage_key = a.storage_key`,
  columns: `a.id, a.owner_id, a.storage_key, a.content_digest, a.full_bytes, a.thumbnail_bytes,
    o.state AS journal_state, o.asset_id AS journal_asset_id, o.owner_id AS journal_owner_id`, where: "a.deleted_at IS NULL" },
};

function normalize(purpose, row) {
  if (!row || typeof row !== "object") fail();
  if (purpose === "crm") {
    const adminId = bytes(row.admin_id, 16), conversationId = bytes(row.conversation_id, 16);
    const notesRevision = integer(row.notes_revision, 4294967295), version = integer(row.version, 4294967295);
    if (notesRevision > version) fail();
    return { id: Buffer.concat([adminId, conversationId]), adminId, conversationId,
      encrypted: row.encrypted === null ? null : text(row.encrypted, 44000), notesRevision: String(notesRevision), version: String(version) };
  }
  const result = { id: bytes(row.id, 16) };
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
      mediaId: nullableBytes(row.media_id, 16), mediaOwnerId: nullableBytes(row.media_owner_id, 16) };
  }
  if (purpose === "broadcast") {
    if (![0, 1, 0n, 1n].includes(row.allow_repeat_media)) fail();
    return { ...result, adminId: bytes(row.admin_id, 16), encrypted: text(row.encrypted, 32000),
      fingerprint: bytes(row.request_fingerprint, 32), mediaId: nullableBytes(row.media_id, 16), allowRepeatMedia: Number(row.allow_repeat_media) === 1 };
  }
  return { ...result, ownerId: bytes(row.owner_id, 16), storageKey: bytes(row.storage_key, 32), digest: bytes(row.content_digest, 32),
    fullBytes: integer(row.full_bytes, 10485760), thumbnailBytes: integer(row.thumbnail_bytes, 524288),
    journalState: row.journal_state, journalAssetId: nullableBytes(row.journal_asset_id, 16), journalOwnerId: nullableBytes(row.journal_owner_id, 16) };
}

/** Bounded SELECT-only crypto reader. It never starts services or claims jobs. */
export function createBackupCryptoStore({ pool } = {}) {
  if (typeof pool?.getConnection !== "function") throw new TypeError("A private backup reader is required.");
  return Object.freeze({
    async page(options = {}) {
      if (!options || typeof options !== "object" || Array.isArray(options)
        || Object.keys(options).some((name) => !["purpose", "afterId", "limit"].includes(name))) fail();
      const { purpose, afterId = null, limit = 50 } = options;
      if (!PURPOSES.includes(purpose) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail();
      const cursor = afterId === null ? null : bytes(afterId, purpose === "crm" ? 32 : 16);
      const statement = statements[purpose], predicates = statement.where ? [statement.where] : [], parameters = [];
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
        const selected = rows.slice(0, limit).map((row) => normalize(purpose, row));
        let previous = cursor;
        for (const row of selected) {
          if (previous !== null && Buffer.compare(row.id, previous) <= 0) fail();
          previous = row.id;
          if (purpose === "broadcast") {
            const recipients = await connection.query("SELECT conversation_id FROM broadcast_recipients WHERE campaign_id = ? ORDER BY conversation_id ASC LIMIT 101", [row.id]);
            if (!Array.isArray(recipients) || recipients.length > 100) fail();
            row.conversationIds = recipients.map((recipient) => bytes(recipient.conversation_id, 16));
          }
        }
        const hasMore = rows.length > limit;
        return { rows: selected, hasMore, nextCursor: hasMore ? Buffer.from(selected.at(-1).id) : null };
      } catch { fail(); }
      finally { try { connection?.release(); } catch {} }
    },
  });
}
