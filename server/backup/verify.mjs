import { createHash, timingSafeEqual } from "node:crypto";
import { canonicalEmail } from "../auth/config.mjs";
import { openTotpSecret, tokenDigest } from "../auth/crypto.mjs";
import { openVerificationPayload } from "../mail/crypto.mjs";
import { openResetPayload } from "../reset/mail-crypto.mjs";
import { decryptMessageBody, messageFingerprint, validateMessageBody } from "../chat/crypto.mjs";
import { openNotes } from "../crm/crypto.mjs";
import { openPayload, campaignFingerprint } from "../broadcast/crypto.mjs";

const PURPOSES = ["mfa", "mail", "reset", "messages", "crm", "broadcast", "media"];
const KEY_NAMES = ["totpKey", "mailKey", "messageKey", "mediaKey", "crmKey"];
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
  const report = { complete: true, healthy: false,
    counts: { rows: 0, mfa: 0, mail: 0, reset: 0, messages: 0, crm: 0, broadcast: 0, broadcastRecipients: 0, media: 0, mediaFiles: 0 }, issues: [] };
  let secrets, currentPurpose = "verification", maxIssues = 100;
  function issue(purpose, code) {
    if (report.issues.length >= maxIssues) stop("issue_limit");
    report.issues.push({ purpose, code });
  }
  const checkSignal = () => { if (signal?.aborted) stop("aborted"); };
  try {
    if (typeof store?.page !== "function" || typeof storage?.get !== "function" || !keys || typeof keys !== "object" || Array.isArray(keys)
      || Object.keys(keys).length !== KEY_NAMES.length || KEY_NAMES.some((name) => !Buffer.isBuffer(keys[name]) || keys[name].length !== 32)
      || !limits || typeof limits !== "object" || Array.isArray(limits) || Object.keys(limits).some((name) => !["maxRows", "maxIssues"].includes(name))) stop("invalid_configuration");
    const maxRows = limits.maxRows ?? 100000;
    maxIssues = limits.maxIssues ?? 100;
    if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 100000 || !Number.isSafeInteger(maxIssues) || maxIssues < 1 || maxIssues > 100) {
      maxIssues = 100; stop("invalid_configuration");
    }
    secrets = Object.fromEntries(KEY_NAMES.map((name) => [name, Buffer.from(keys[name])]));
    for (let first = 0; first < KEY_NAMES.length; first++) for (let second = first + 1; second < KEY_NAMES.length; second++) {
      if (secrets[KEY_NAMES[first]].equals(secrets[KEY_NAMES[second]])) stop("invalid_configuration");
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
      if (purpose === "broadcast") {
        const binding = { campaignId: row.id, adminId: bytes(row.adminId, 16) };
        text(row.encrypted, 32000);
        const payload = openPayload(row.encrypted, secrets.messageKey, binding);
        if (!equal(campaignFingerprint(payload, secrets.messageKey, binding), row.fingerprint)
          || typeof row.allowRepeatMedia !== "boolean" || payload.allowRepeatMedia !== row.allowRepeatMedia
          || !(row.mediaId === null || Buffer.isBuffer(row.mediaId) && row.mediaId.length === 16)
          || payload.mediaId !== (row.mediaId?.toString("hex") ?? null)) throw new RowFailure("binding_mismatch");
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
    for (const purpose of PURPOSES) {
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
