export const DELETION_FACT_NAMES = Object.freeze([
  "activeSessions", "verificationPending", "verificationSending", "recoveryPending", "recoverySending",
  "broadcastPending", "broadcastSending", "mediaReserved", "mediaRegistered", "mediaCleanupPending", "mediaReleased",
  "ownedMediaOutsideConversationLinks", "ownedMediaCampaignLinks", "sharedPeerMediaLinks", "foreignMessageBindings",
  "foreignReceiptBindings", "foreignBroadcastBindings", "foreignAdministratorSessionState", "foreignMediaJournalBindings",
]);
const CAP = 10000;
const MAX_DATE = 253402300799999;
export class DeletionStoreError extends Error {
  constructor() { super("Private deletion facts are unavailable."); this.name = "DeletionStoreError"; this.code = "DATA_STORE_UNAVAILABLE"; }
}
const fail = () => { throw new DeletionStoreError(); };
const bytes = (value) => { if (!Buffer.isBuffer(value) || value.length !== 16) fail(); return Buffer.from(value); };
function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value)) fail();
  const iso = `${value.slice(0, 23).replace(" ", "T")}Z`, parsed = Date.parse(iso);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_DATE || new Date(parsed).toISOString() !== iso) fail();
  return value;
}

/** Metadata reference counts only. No claim, cancellation, deletion or file read. */
export async function readDeletionFacts(input = {}) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input) || typeof input.connection?.query !== "function") fail();
    const { connection } = input, target = bytes(input.clientId), nowSql = date(input.nowSql);
    let context = null;
    if (input.conversation !== null) {
      if (!input.conversation || typeof input.conversation !== "object") fail();
      context = { id: bytes(input.conversation.id), clientId: bytes(input.conversation.clientId), adminId: bytes(input.conversation.adminId) };
      if (!context.clientId.equals(target) || context.adminId.equals(target)) fail();
    }
    const none = ["FROM DUAL WHERE 1 = 0", []];
    const outbox = (table, state) => [`FROM ${table} WHERE recipient_user_id = ? AND status = '${state}'`, [target]];
    const broadcast = (state) => context === null ? none
      : [`FROM broadcast_recipients WHERE client_id = ? AND conversation_id = ? AND state = '${state}'`, [target, context.id]];
    const allocation = (state) => [`FROM media_storage_objects WHERE owner_id = ? AND owner_role = 'client' AND state = '${state}'`, [target]];
    const statements = {
      activeSessions: ["FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?", [target, nowSql]],
      verificationPending: outbox("mail_outbox", "pending"), verificationSending: outbox("mail_outbox", "sending"),
      recoveryPending: outbox("password_reset_outbox", "pending"), recoverySending: outbox("password_reset_outbox", "sending"),
      broadcastPending: broadcast("pending"), broadcastSending: broadcast("sending"),
      mediaReserved: allocation("reserved"), mediaRegistered: allocation("registered"),
      mediaCleanupPending: allocation("cleanup_pending"), mediaReleased: allocation("released"),
      ownedMediaOutsideConversationLinks: [`FROM message_media mm JOIN media_assets a ON a.id = mm.media_id
        WHERE a.owner_id = ? AND a.owner_role = 'client' ${context === null ? "" : "AND mm.conversation_id <> ?"}`, [target, ...(context === null ? [] : [context.id])]],
      ownedMediaCampaignLinks: [`FROM broadcast_campaigns b JOIN media_assets a ON a.id = b.media_id
        WHERE a.owner_id = ? AND a.owner_role = 'client'`, [target]],
      sharedPeerMediaLinks: context === null ? none : [`FROM message_media mm JOIN media_assets a ON a.id = mm.media_id
        WHERE mm.conversation_id = ? AND a.owner_id <> ? AND EXISTS
          (SELECT 1 FROM message_media other WHERE other.media_id = mm.media_id AND other.conversation_id <> ?)`, [context.id, target, context.id]],
      foreignMessageBindings: context === null ? ["FROM messages WHERE sender_id = ?", [target]]
        : [`FROM messages WHERE (sender_id = ? AND conversation_id <> ?) OR
          (conversation_id = ? AND NOT ((sender_id = ? AND sender_role = 'client') OR (sender_id = ? AND sender_role = 'admin')))`,
        [target, context.id, context.id, target, context.adminId]],
      foreignReceiptBindings: context === null ? ["FROM chat_receipts WHERE user_id = ?", [target]]
        : [`FROM chat_receipts WHERE (user_id = ? AND conversation_id <> ?) OR
          (conversation_id = ? AND user_id NOT IN (?, ?))`, [target, context.id, context.id, target, context.adminId]],
      foreignBroadcastBindings: context === null ? ["FROM broadcast_recipients WHERE client_id = ?", [target]]
        : [`FROM broadcast_recipients WHERE (client_id = ? AND conversation_id <> ?) OR (conversation_id = ? AND client_id <> ?)`,
        [target, context.id, context.id, target]],
      foreignAdministratorSessionState: ["FROM auth_session_state a JOIN sessions s ON s.id = a.session_id WHERE s.user_id = ?", [target]],
      // Units are failed reference checks, not distinct assets: one damaged
      // pair can fail both directions. Each UNION arm is independently capped.
      foreignMediaJournalBindings: [`FROM (
        (SELECT 1 AS anomaly FROM media_storage_objects o LEFT JOIN media_assets a ON a.id = o.asset_id
          LEFT JOIN media_assets keyed ON keyed.storage_key = o.storage_key
          WHERE (o.owner_id = ? OR a.owner_id = ?) AND (
            (o.asset_id IS NULL AND o.state = 'registered') OR
            (o.asset_id IS NOT NULL AND (a.id IS NULL OR a.id <> o.id OR a.owner_id <> o.owner_id OR a.owner_role <> o.owner_role
              OR a.storage_key <> o.storage_key OR (a.deleted_at IS NULL AND o.state <> 'registered')
              OR (a.deleted_at IS NOT NULL AND o.state NOT IN ('cleanup_pending', 'released')))) OR
            (o.owner_id = ? AND keyed.id IS NOT NULL AND (keyed.id <> o.id OR o.asset_id IS NULL OR keyed.id <> o.asset_id
              OR keyed.owner_id <> o.owner_id OR keyed.owner_role <> o.owner_role))) LIMIT 10001)
        UNION ALL
        (SELECT 1 AS anomaly FROM media_assets a LEFT JOIN media_storage_objects o ON o.storage_key = a.storage_key
          WHERE a.owner_id = ? AND (o.id IS NULL OR o.id <> a.id OR o.asset_id IS NULL OR o.asset_id <> a.id
            OR o.owner_id <> a.owner_id OR o.owner_role <> a.owner_role
            OR (a.deleted_at IS NULL AND o.state <> 'registered')
            OR (a.deleted_at IS NOT NULL AND o.state NOT IN ('cleanup_pending', 'released'))) LIMIT 10001)
        ) anomalies`, [target, target, target, target]],
    };
    const result = [];
    for (const name of DELETION_FACT_NAMES) {
      const [from, parameters] = statements[name];
      const values = await connection.query(`SELECT 1 AS present ${from} LIMIT 10001`, parameters);
      if (!Array.isArray(values) || values.length > CAP + 1
        || values.some((row) => !row || typeof row !== "object" || Object.keys(row).length !== 1 || row.present !== 1)) fail();
      result.push({ name, count: Math.min(values.length, CAP), truncated: values.length > CAP });
    }
    return result;
  } catch { fail(); }
}
