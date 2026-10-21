import { createHash, timingSafeEqual } from "node:crypto";
import { canonicalEmail } from "../auth/config.mjs";
import { openTotpSecret, tokenDigest } from "../auth/crypto.mjs";
import { openVerificationPayload } from "../mail/crypto.mjs";
import { openResetPayload } from "../reset/mail-crypto.mjs";
import { decryptMessageBody, messageFingerprint, validateMessageBody } from "../chat/crypto.mjs";
import { openNotes } from "../crm/crypto.mjs";
import { openPayload, campaignFingerprint, createAudienceDigest, verifyRecipientProof } from "../broadcast/crypto.mjs";
import { openSubscription, endpointDigest } from "../notifications/crypto.mjs";
import { openAnnouncement } from "../announcements/crypto.mjs";
import { openTask } from "../tasks/crypto.mjs";
import { createBackupCryptoStore } from "./crypto-store.mjs";

const PURPOSES = ["mfa", "mail", "reset", "messages", "crm", "tasks", "broadcast", "announcements", "media"];
const NOTIFICATION_PURPOSES = ["notifications", "notificationJobs"];
const KEY_NAMES = ["totpKey", "mailKey", "messageKey", "mediaKey", "crmKey"];
const TEXT_PURPOSES = ["mfa", "mail", "messages"];
const TEXT_INACTIVE_TABLES = [
  ["reset", ["client_password_resets", "password_reset_outbox"]],
  ["crm", ["crm_profiles", "crm_labels", "crm_memberships"]],
  ["tasks", ["crm_tasks"]],
  ["broadcast", ["broadcast_preferences", "broadcast_campaigns", "broadcast_recipients"]],
  ["announcements", ["announcements"]],
  ["media", ["media_assets", "message_media", "media_storage_state", "media_storage_objects"]],
  ["notifications", ["push_subscriptions", "push_outbox"]],
];
class VerificationStop extends Error { constructor(code) { super("Private backup verification stopped."); this.code = code; } }
class RowFailure extends Error { constructor(code = "verification_failed") { super("Private backup data failed verification."); this.code = code; } }
const stop = (code) => { throw new VerificationStop(code); };
const invalid = () => { throw new RowFailure("invalid_metadata"); };
function bytes(value, length) { if (!Buffer.isBuffer(value) || value.length !== length) invalid(); return value; }
function equal(left, right) { return timingSafeEqual(bytes(left, 32), bytes(right, 32)); }
function text(value, maximum, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) invalid();
}
function integer(value, maximum) { if (!Number.isSafeInteger(value) || value < 1 || value > maximum) invalid(); return value; }

/** Authenticate restored data without exposing plaintext, starting workers or
 * changing rows. The caller supplies storage created with keys.mediaKey and
 * separately verifies the pre-backup key canaries, schema and SQL snapshot. */
export async function verifyBackupData({ store, storage, keys, signal, limits = {} } = {}) {
  return verifyData({ store, storage, keys, signal, limits });
}

/** Verify an offline text-profile SQL copy using only the real MFA/mail/message
 * keys. The caller owns the pool and separately proves schema/copy consistency.
 * No HTTP, transport, worker, file or SQL mutation is created here. Unlike the
 * full verifier, this profile refuses even inactive/deleted media metadata and
 * non-content rows in disabled domains. Empty domains cannot certify a key. */
export async function verifyTextBackupData({ pool, keys, signal, limits = {} } = {}) {
  return verifyData({ pool, keys, signal, limits }, "text");
}

/** The private photo profile uses four real keys and the existing media reader;
 * populated reset, CRM and broadcast tables remain incompatible. */
export async function verifyPhotoBackupData({ pool, storage, keys, signal, limits = {} } = {}) {
  return verifyData({ pool, storage, keys, signal, limits }, "photos");
}

/** Offline notification profiles authenticate every subscription and delivery
 * binding. They never create a transport, claim a job or refresh a session. */
export async function verifyPhotoNotificationBackupData({ pool, storage, keys, signal, limits = {} } = {}) {
  return verifyData({ pool, storage, keys, signal, limits }, "photos-notify");
}
/** Recovery reuses the mail key with the reset payload's distinct authenticated
 * purpose. CRM and broadcast remain disabled, and older notification profiles
 * still reject every populated reset table. */
export async function verifyPhotoNotificationRecoveryBackupData({ pool, storage, keys, signal, limits = {} } = {}) {
  return verifyData({ pool, storage, keys, signal, limits }, "photos-notify-recovery");
}
/** The explicit CRM/recovery profile adds the notes key and authenticates both
 * encrypted domains. Broadcast tables must still be completely empty. */
export async function verifyPhotoNotificationRecoveryCrmBackupData({ pool, storage, keys, signal, limits = {} } = {}) {
  return verifyData({ pool, storage, keys, signal, limits }, "photos-notify-recovery-crm");
}
/** Campaign payloads and their complete recipient bindings use the existing
 * message key. No worker, transport, claim or delivery is created offline. */
export async function verifyPhotoNotificationRecoveryCrmBroadcastBackupData({ pool, storage, keys, signal, limits = {} } = {}) {
  return verifyData({ pool, storage, keys, signal, limits }, "photos-notify-recovery-crm-broadcast");
}
export async function verifyFullNotificationBackupData({ store, storage, keys, signal, limits = {} } = {}) {
  return verifyData({ store, storage, keys, signal, limits }, "full-notify");
}

async function verifyData({ store, storage, keys, signal, limits = {}, pool } = {}, profile = "full") {
  const broadcast = profile === "photos-notify-recovery-crm-broadcast";
  const textOnly = profile === "text", crm = broadcast || profile === "photos-notify-recovery-crm";
  const limited = crm || ["text", "photos", "photos-notify", "photos-notify-recovery"].includes(profile);
  const notifications = crm || ["photos-notify", "photos-notify-recovery", "full-notify"].includes(profile);
  const recovery = crm || profile === "photos-notify-recovery";
  const report = { complete: true, healthy: false,
    counts: { rows: 0, mfa: 0, mail: 0, reset: 0, messages: 0, crm: 0, tasks: 0, broadcast: 0, broadcastRecipients: 0, announcements: 0, media: 0, mediaFiles: 0, notifications: 0, notificationJobs: 0 }, issues: [] };
  let secrets, currentPurpose = "verification", maxIssues = 100;
  function issue(purpose, code) {
    if (report.issues.length >= maxIssues) stop("issue_limit");
    report.issues.push({ purpose, code });
  }
  const checkSignal = () => { if (signal?.aborted) stop("aborted"); };
  try {
    const keyNames = [...(textOnly ? KEY_NAMES.slice(0, 3) : limited && !crm ? KEY_NAMES.slice(0, 4) : KEY_NAMES), ...(notifications ? ["notificationKey"] : [])];
    if ((limited ? typeof pool?.getConnection !== "function" || !textOnly && typeof storage?.get !== "function"
      : typeof store?.page !== "function" || typeof storage?.get !== "function")
      || !keys || typeof keys !== "object" || Array.isArray(keys)
      || Object.keys(keys).length !== keyNames.length || keyNames.some((name) => !Buffer.isBuffer(keys[name]) || keys[name].length !== 32)
      || !limits || typeof limits !== "object" || Array.isArray(limits) || Object.keys(limits).some((name) => !["maxRows", "maxIssues"].includes(name))) stop("invalid_configuration");
    const maxRows = limits.maxRows ?? 100000;
    maxIssues = limits.maxIssues ?? 100;
    if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000 || !Number.isSafeInteger(maxIssues) || maxIssues < 1 || maxIssues > 100) {
      maxIssues = 100; stop("invalid_configuration");
    }
    secrets = Object.fromEntries(keyNames.map((name) => [name, Buffer.from(keys[name])]));
    for (let first = 0; first < keyNames.length; first++) for (let second = first + 1; second < keyNames.length; second++) {
      if (secrets[keyNames[first]].equals(secrets[keyNames[second]])) stop("invalid_configuration");
    }
    if (limited) {
      let connection;
      try {
        checkSignal(); connection = await pool.getConnection(); checkSignal();
        for (const [purpose, tables] of TEXT_INACTIVE_TABLES.filter(([purpose]) => (textOnly || purpose !== "media") && (!notifications || purpose !== "notifications") && (!recovery || purpose !== "reset") && (!crm || !["crm", "tasks"].includes(purpose)) && (!broadcast || !["broadcast", "announcements"].includes(purpose)))) for (const table of tables) {
          currentPurpose = purpose; checkSignal();
          // Fixed table allowlist, EXISTS stops at the first row. Checking the
          // underlying tables also catches deleted assets and empty CRM notes.
          const rows = await connection.query(`SELECT EXISTS (SELECT 1 FROM ${table} LIMIT 1) AS present`);
          checkSignal();
          if (!Array.isArray(rows) || rows.length !== 1 || ![0, 1, 0n, 1n].includes(rows[0]?.present)) stop("invalid_page");
          if (Number(rows[0].present) === 1) stop("inactive_domain_populated");
        }
      } finally { await connection?.release(); }
      store = createBackupCryptoStore({ pool });
    }
    const countRow = () => { if (++report.counts.rows > maxRows) { report.counts.rows--; stop("row_limit"); } };
    async function verifyRow(purpose, row) {
      if (!row || typeof row !== "object" || Array.isArray(row)) invalid();
      bytes(row.id, purpose === "crm" ? 32 : 16);
      if (purpose === "mfa") {
        text(row.encrypted, 190); openTotpSecret(row.encrypted, secrets.totpKey, row.id); return;
      }
      if (purpose === "mail" || purpose === "reset") {
        text(row.encrypted, 1024);
        if (!bytes(row.recipientUserId, 16).equals(bytes(row.challengeUserId, 16))) invalid();
        const payload = purpose === "mail" ? openVerificationPayload(row.encrypted, secrets.mailKey, row.id) : openResetPayload(row.encrypted, secrets.mailKey, row.id);
        if (!equal(tokenDigest(payload.token), row.tokenHash)) throw new RowFailure("binding_mismatch");
        if (canonicalEmail(row.recipientEmail) !== row.recipientEmail || payload.email !== row.recipientEmail) throw new RowFailure("binding_mismatch");
        if (purpose === "reset" && !equal(createHash("sha256").update(payload.email, "utf8").digest(), row.emailHash)) throw new RowFailure("binding_mismatch");
        return;
      }
      if (purpose === "messages") {
        const binding = { messageId: row.id, conversationId: bytes(row.conversationId, 16), senderId: bytes(row.senderId, 16) };
        if (!["admin", "client"].includes(row.senderRole) || typeof row.deleted !== "boolean"
          || !binding.senderId.equals(bytes(row.senderRole === "admin" ? row.adminId : row.clientId, 16))) invalid();
        bytes(row.fingerprint, 32);
        if (textOnly && (row.mediaId !== null || row.mediaOwnerId !== null)) throw new RowFailure("inactive_domain_populated");
        if (row.deleted) { if (row.encrypted !== null) invalid(); return; }
        text(row.encrypted, 22000);
        const body = decryptMessageBody(row.encrypted, secrets.messageKey, binding);
        if (!equal(messageFingerprint(body, secrets.messageKey, binding), row.fingerprint)) throw new RowFailure("binding_mismatch");
        if (row.mediaId !== null) {
          bytes(row.mediaId, 16);
          if (!bytes(row.mediaOwnerId, 16).equals(binding.senderId)) throw new RowFailure("binding_mismatch");
          let payload;
          try { payload = JSON.parse(body); } catch { throw new RowFailure("binding_mismatch"); }
          if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).sort().join(",") !== "caption,mediaId"
            || payload.mediaId !== row.mediaId.toString("hex") || typeof payload.caption !== "string" || payload.caption.length > 1000) throw new RowFailure("binding_mismatch");
          if (payload.caption !== "") validateMessageBody(payload.caption);
        } else if (row.mediaOwnerId !== null) invalid();
        return;
      }
      if (purpose === "crm") {
        const adminId = bytes(row.adminId, 16), conversationId = bytes(row.conversationId, 16);
        if (!row.id.equals(Buffer.concat([adminId, conversationId])) || typeof row.notesRevision !== "string" || typeof row.version !== "string"
          || !/^[1-9][0-9]{0,9}$/.test(row.notesRevision) || !/^[1-9][0-9]{0,9}$/.test(row.version)
          || BigInt(row.notesRevision) > BigInt(row.version) || BigInt(row.version) > 4294967295n) invalid();
        text(row.encrypted, 44000, true);
        openNotes(row.encrypted, secrets.crmKey, { adminId, conversationId, version: row.notesRevision }); return;
      }
      if (purpose === "tasks") {
        const adminId = bytes(row.adminId, 16), conversationId = bytes(row.conversationId, 16);
        if (row.adminRole !== "admin" || row.userRole !== "admin" || !adminId.equals(bytes(row.conversationAdminId, 16))
          || typeof row.done !== "boolean" || typeof row.version !== "string" || !/^[1-9][0-9]{0,9}$/.test(row.version)
          || BigInt(row.version) > 4294967295n
          || [row.createdAt, row.updatedAt, ...(row.dueAt === null ? [] : [row.dueAt])]
            .some(value => !Number.isSafeInteger(value) || value < 0 || value > 253402300799999)
          || row.updatedAt < row.createdAt) invalid();
        bytes(row.fingerprint, 32); text(row.encrypted, 4096);
        openTask(row.encrypted, secrets.crmKey, { adminId, conversationId, taskId: row.id, version: row.version, dueAt: row.dueAt, done: row.done });
        return;
      }
      if (purpose === "broadcast") {
        const binding = { campaignId: row.id, adminId: bytes(row.adminId, 16) };
        text(row.encrypted, 32000);
        const payload = openPayload(row.encrypted, secrets.messageKey, binding);
        if (!equal(campaignFingerprint(payload, secrets.messageKey, binding), row.fingerprint)
          || typeof row.allowRepeatMedia !== "boolean" || payload.allowRepeatMedia !== row.allowRepeatMedia
          || !(row.mediaId === null || Buffer.isBuffer(row.mediaId) && row.mediaId.length === 16)
          || payload.mediaId !== (row.mediaId?.toString("hex") ?? null)) throw new RowFailure("binding_mismatch");
        if (payload.version === 2) {
          if (typeof row.recipientPages !== "function") invalid();
          const digest = createAudienceDigest();
          for await (const page of row.recipientPages()) {
            checkSignal();
            if (!Array.isArray(page) || page.length < 1 || page.length > 100) invalid();
            for (const recipient of page) {
              checkSignal(); countRow(); report.counts.broadcastRecipients++;
              const conversationId = bytes(recipient?.conversationId, 16), clientId = bytes(recipient.clientId, 16);
              if (!clientId.equals(bytes(recipient.actualClientId, 16)) || !binding.adminId.equals(bytes(recipient.actualAdminId, 16))
                || !verifyRecipientProof(secrets.messageKey, { ...binding, conversationId, clientId, messageId: bytes(recipient.messageId, 16) }, recipient.proof))
                throw new RowFailure("binding_mismatch");
              digest.update(conversationId, clientId);
              if (digest.count > payload.audience.count) throw new RowFailure("binding_mismatch");
            }
          }
          if (digest.count !== payload.audience.count || digest.digest() !== payload.audience.digest) throw new RowFailure("binding_mismatch");
          return;
        }
        if (!Array.isArray(row.conversationIds) || row.conversationIds.length < 1 || row.conversationIds.length > 100) invalid();
        let previous = null;
        for (let index = 0; index < row.conversationIds.length; index++) {
          checkSignal(); countRow(); report.counts.broadcastRecipients++;
          const id = bytes(row.conversationIds[index], 16);
          if (previous !== null && Buffer.compare(previous, id) >= 0 || payload.conversationIds[index] !== id.toString("hex")) throw new RowFailure("binding_mismatch");
          previous = id;
        }
        if (payload.conversationIds.length !== row.conversationIds.length) throw new RowFailure("binding_mismatch");
        return;
      }
      if (NOTIFICATION_PURPOSES.includes(purpose)) {
        if (!notifications) throw new RowFailure("inactive_domain_populated");
        if (!["admin", "client"].includes(row.role)) invalid();
        bytes(row.userId, 16); integer(row.generation, 4294967295);
        if (purpose === "notifications") {
          if (row.userRole !== row.role || !row.userId.equals(bytes(row.sessionUserId, 16))) throw new RowFailure("binding_mismatch");
          bytes(row.sessionId, 16); integer(row.credentialVersion, 4294967295); text(row.encrypted, 4096);
          const subscription = openSubscription(row.encrypted, secrets.notificationKey, { subscriptionId: row.id, userId: row.userId, generation: row.generation });
          if (!equal(endpointDigest(subscription.endpoint, secrets.notificationKey), row.endpointDigest)) throw new RowFailure("binding_mismatch");
        } else {
          integer(row.subscriptionGeneration, 4294967295);
          if (row.subscriptionGeneration > row.generation || !["admin", "client"].includes(row.senderRole) || row.senderRole === row.role
            || !bytes(row.senderId, 16).equals(bytes(row.senderRole === "admin" ? row.adminId : row.clientId, 16))
            || !row.userId.equals(bytes(row.role === "admin" ? row.adminId : row.clientId, 16))) throw new RowFailure("binding_mismatch");
        }
        return;
      }
      if (purpose === "announcements") {
        const adminId = bytes(row.adminId, 16);
        if (row.adminRole !== "admin" || row.userRole !== "admin" || typeof row.sendPrivateMessage !== "boolean"
          || !/^[1-9][0-9]{0,19}$/.test(row.revision) || BigInt(row.revision) > 18446744073709551615n
          || [row.startsAt, row.expiresAt, row.createdAt, row.updatedAt, ...(row.removedAt === null ? [] : [row.removedAt])]
            .some(value => !Number.isSafeInteger(value) || value < 0 || value > 253402300799999)
          || row.expiresAt <= row.startsAt || row.updatedAt < row.createdAt || row.removedAt !== null && row.removedAt < row.createdAt) invalid();
        if (row.campaignId === null) { if (row.campaignAdminId !== null) throw new RowFailure("binding_mismatch"); }
        else {
          bytes(row.campaignId, 16);
          if (!row.sendPrivateMessage || !adminId.equals(bytes(row.campaignAdminId, 16))) throw new RowFailure("binding_mismatch");
        }
        text(row.encrypted, 8192);
        openAnnouncement(row.encrypted, secrets.messageKey, { adminId, id: row.id, revision: row.revision,
          startsAt: row.startsAt, expiresAt: row.expiresAt, sendPrivateMessage: row.sendPrivateMessage });
        return;
      }
      const assetId = row.id, storageKey = bytes(row.storageKey, 32);
      bytes(row.ownerId, 16); bytes(row.digest, 32);
      if (row.journalState !== "registered" || !bytes(row.journalAssetId, 16).equals(assetId) || !bytes(row.journalOwnerId, 16).equals(row.ownerId)) invalid();
      integer(row.fullBytes, 10485760); integer(row.thumbnailBytes, 524288);
      for (const variant of ["full", "thumb"]) {
        let plaintext;
        try {
          checkSignal();
          plaintext = await storage.get({ assetId, storageKey, variant });
          checkSignal();
          if (!Buffer.isBuffer(plaintext) || plaintext.length !== (variant === "full" ? row.fullBytes : row.thumbnailBytes)) throw new RowFailure("binding_mismatch");
          if (variant === "full" && !equal(createHash("sha256").update(plaintext).digest(), row.digest)) throw new RowFailure("binding_mismatch");
          report.counts.mediaFiles++;
        } finally { if (Buffer.isBuffer(plaintext)) plaintext.fill(0); }
      }
    }
    const purposes = textOnly ? TEXT_PURPOSES : limited ? [...TEXT_PURPOSES, ...(recovery ? ["reset"] : []), ...(crm ? ["crm", "tasks"] : []), ...(broadcast ? ["broadcast", "announcements"] : []), "media", ...(notifications ? NOTIFICATION_PURPOSES : [])] : [...PURPOSES, ...NOTIFICATION_PURPOSES];
    for (const purpose of purposes) {
      currentPurpose = purpose;
      let afterId = null;
      while (true) {
        checkSignal();
        const page = await store.page({ purpose, afterId, limit: 50 });
        checkSignal();
        if (!page || !Array.isArray(page.rows) || page.rows.length > 50 || typeof page.hasMore !== "boolean"
          || page.hasMore !== (page.nextCursor !== null) || page.hasMore && page.rows.length !== 50) stop("invalid_page");
        for (const row of page.rows) {
          checkSignal();
          const id = row?.id;
          if (!Buffer.isBuffer(id) || id.length !== (purpose === "crm" ? 32 : 16)
            || afterId !== null && Buffer.compare(id, afterId) <= 0) stop("invalid_page");
          afterId = Buffer.from(id);
          countRow(); report.counts[purpose]++;
          try { await verifyRow(purpose, row); }
          catch (error) {
            if (error instanceof VerificationStop) throw error;
            issue(purpose, error instanceof RowFailure ? error.code : "verification_failed");
          }
        }
        if (page.hasMore && (!Buffer.isBuffer(page.nextCursor) || !afterId || !page.nextCursor.equals(afterId))) stop("invalid_page");
        if (!page.hasMore) break;
      }
    }
    report.healthy = report.issues.length === 0;
  } catch (error) {
    report.complete = false; report.healthy = false;
    if (report.issues.length < maxIssues) report.issues.push({ purpose: currentPurpose, code: error instanceof VerificationStop ? error.code : "verification_unavailable" });
  } finally { if (secrets) for (const key of Object.values(secrets)) key.fill(0); }
  return report;
}
