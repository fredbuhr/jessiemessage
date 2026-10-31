import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { tokenDigest } from "../auth/crypto.mjs";
import { normalizeImage } from "./image.mjs";
import { mediaDTO } from "./dto.mjs";

export class MediaError extends Error {
  constructor(code, retryAfter) {
    super("Private media could not be processed."); this.name = "MediaError"; this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}
const fail = (code) => { throw new MediaError(code); };
const id = (value) => {
  if (typeof value !== "string" || value.length !== 32 || !/^[a-f0-9]{32}$/.test(value)) fail("MEDIA_INPUT");
  return Buffer.from(value, "hex");
};
const cursor = (value) => {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n || BigInt(value).toString() !== value) fail("MEDIA_INPUT");
  return value;
};
const pageSize = (value) => { if (!Number.isInteger(value) || value < 1 || value > 100) fail("MEDIA_INPUT"); return value; };
const allowed = new Set(["MEDIA_INPUT", "MEDIA_FORMAT", "MEDIA_DIMENSIONS", "MEDIA_BUSY", "MEDIA_NOT_FOUND", "MEDIA_IN_USE", "MEDIA_RATE_LIMIT", "MEDIA_STORAGE_LIMIT", "MEDIA_CAPACITY_UNAVAILABLE", "CHAT_UNAUTHORIZED", "CHAT_FORBIDDEN", "CHAT_NOT_FOUND", "CHAT_CONFLICT", "CHAT_INPUT", "CHAT_RATE_LIMIT", "AUTH_RATE_LIMIT", "AUTH_BUSY", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"]);
const MAX_ACTIVE_UPLOADS = 3;
// Covers the fixed 60s body deadline plus a small hand-off margin. Processing
// retains its existing place until completion; no additional uploads are admitted.
const ADMISSION_MILLISECONDS = 65_000;
// Process-wide fairness follows the authenticated account, never its cookie.
let activeUploads = 0;
const uploadingAccounts = new Set();
function reserveUpload(userId) {
  if (activeUploads >= MAX_ACTIVE_UPLOADS || uploadingAccounts.has(userId)) throw new MediaError("MEDIA_BUSY", 5);
  activeUploads += 1; uploadingAccounts.add(userId); let released = false;
  return () => { if (!released) { released = true; activeUploads -= 1; uploadingAccounts.delete(userId); } };
}

export async function createMediaService({ store, chatService, authStore, storage, key, minimumFreeBytes = 536870912, clock = Date.now }) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || typeof clock !== "function"
    || !Number.isSafeInteger(minimumFreeBytes) || minimumFreeBytes < 0) throw new MediaError("MEDIA_CONFIG");
  for (const method of ["reserveAsset", "cancelAssetReservation", "registerAsset", "releaseStorageObject", "listAssets", "getOwnedAsset", "getMessageAsset", "deleteAsset", "gallery"]) if (typeof store?.[method] !== "function") throw new MediaError("MEDIA_CONFIG");
  for (const method of ["put", "get", "remove", "availableSpace"]) if (typeof storage?.[method] !== "function") throw new MediaError("MEDIA_CONFIG");
  if (typeof chatService?.actor !== "function" || typeof chatService?.sendImage !== "function" || typeof authStore?.consumeRateLimit !== "function") throw new MediaError("MEDIA_CONFIG");
  key = Buffer.from(key);
  const admissions = new WeakMap();
  function currentTime() {
    const now = clock(); if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999) fail("MEDIA_UNAVAILABLE"); return now;
  }
  async function guarded(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof MediaError) throw error;
      if (error?.code === "AUTH_INVALID") fail("CHAT_UNAUTHORIZED");
      if (allowed.has(error?.code)) throw new MediaError(error.code, error.retryAfter);
      fail("MEDIA_UNAVAILABLE");
    }
  }
  async function context(role, raw) {
    if (!["admin", "client"].includes(role)) fail("MEDIA_INPUT");
    let digest; try { digest = tokenDigest(raw); } catch { fail("CHAT_UNAUTHORIZED"); }
    const actor = await chatService.actor(role, raw);
    if (!actor || actor.user?.role !== role) fail("CHAT_UNAUTHORIZED");
    try { id(actor.user.id); } catch { fail("MEDIA_UNAVAILABLE"); }
    const now = currentTime();
    return { actor, request: { role, tokenHash: digest, now } };
  }
  async function consumeBudget(userId, kind, now) {
    // Reject an exhausted account before spending the shared allowance.
    const budgets = kind === "upload" ? [["user-upload", userId, 60], ["global-upload", "all", 240]]
      : ["library", "gallery"].includes(kind) ? [[`user-${kind}`, userId, 60], ["global-read", "all", 300]]
      : [[`user-${kind}`, userId, kind === "full" ? 20 : kind === "thumb" ? 120 : 30]];
    for (const [name, identity, ceiling] of budgets) {
      const bucket = createHmac("sha256", key).update("jessiemessage:media-rate:v1:").update(name).update("\0").update(identity).digest();
      const result = await authStore.consumeRateLimit(bucket, { now, windowSeconds: 60, limit: ceiling });
      if (!result || typeof result.allowed !== "boolean") fail("MEDIA_UNAVAILABLE");
      if (!result.allowed) throw new MediaError("MEDIA_RATE_LIMIT", result.retryAfter);
    }
  }
  function closeAdmission(record) {
    if (record.state === "closed") return;
    record.state = "closed"; clearTimeout(record.timer); record.release();
  }
  async function admitUpload(role, raw) {
    const { actor, request } = await context(role, raw);
    const release = reserveUpload(actor.user.id);
    try {
      // Incomplete/aborted bodies pay these persistent budgets as soon as
      // admitted. Do not release this reservation while SQL is outstanding.
      await consumeBudget(actor.user.id, "upload", request.now);
      const ticket = Object.freeze(Object.create(null));
      const record = { role, tokenHash: request.tokenHash, userId: actor.user.id, expiresAt: currentTime() + ADMISSION_MILLISECONDS,
        state: "waiting", release, timer: null };
      record.timer = setTimeout(() => { if (record.state === "waiting") closeAdmission(record); }, ADMISSION_MILLISECONDS);
      record.timer.unref(); admissions.set(ticket, record); return ticket;
    } catch (error) { release(); throw error; }
  }
  function releaseUpload(ticket) {
    const record = admissions.get(ticket);
    // A caller can abandon body collection, but cannot free an in-progress
    // authorization, decoder, filesystem or registration operation early.
    if (record?.state === "waiting") closeAdmission(record);
  }
  const variantValue = (variant) => { if (!["full", "thumb"].includes(variant)) fail("MEDIA_INPUT"); return variant; };
  async function content(row, variant) {
    const bytes = await storage.get({ assetId: row.id, storageKey: row.storageKey, variant });
    const expected = variant === "full" ? row.fullBytes : row.thumbnailBytes;
    if (!Buffer.isBuffer(bytes) || bytes.length !== expected) fail("MEDIA_UNAVAILABLE");
    return { bytes, mime: "image/jpeg" };
  }
  function uploadResult(result, role, ownerId, proposed = null) {
    const row = result?.asset;
    if (!result || typeof result.duplicate !== "boolean" || !Buffer.isBuffer(row?.id) || row.id.length !== 16
      || !Buffer.isBuffer(row.storageKey) || row.storageKey.length !== 32
      || !Buffer.isBuffer(row.ownerId) || row.ownerId.length !== 16 || row.ownerId.toString("hex") !== ownerId
      || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || row.createdAt > 253402300799999 || row.deletedAt !== null
      || !Number.isInteger(row.width) || row.width < 1 || row.width > 2048 || !Number.isInteger(row.height) || row.height < 1 || row.height > 2048
      || !Number.isInteger(row.thumbnailWidth) || row.thumbnailWidth < 1 || row.thumbnailWidth > 480
      || !Number.isInteger(row.thumbnailHeight) || row.thumbnailHeight < 1 || row.thumbnailHeight > 480
      || !Number.isSafeInteger(row.fullBytes) || row.fullBytes < 1 || row.fullBytes > 10485760
      || !Number.isSafeInteger(row.thumbnailBytes) || row.thumbnailBytes < 1 || row.thumbnailBytes > 524288) fail("MEDIA_UNAVAILABLE");
    if (proposed !== null) {
      const sameId = row.id.equals(proposed.id), sameKey = row.storageKey.equals(proposed.storageKey);
      if (result.duplicate ? sameId || sameKey : !sameId || !sameKey) fail("MEDIA_UNAVAILABLE");
    }
    return { asset: mediaDTO(row, role), duplicate: result.duplicate };
  }
  function reservation(result, asset) {
    const value = result?.reservation, bytes = asset.fullBytes + asset.thumbnailBytes + 80;
    if (!result || result.duplicate !== false || !value || !Buffer.isBuffer(value.id) || value.id.length !== 16 || !value.id.equals(asset.id)
      || !Buffer.isBuffer(value.storageKey) || value.storageKey.length !== 32 || !value.storageKey.equals(asset.storageKey)
      || !Number.isSafeInteger(value.bytes) || value.bytes !== bytes
      || !Number.isSafeInteger(value.pendingBytes) || value.pendingBytes < bytes) fail("MEDIA_UNAVAILABLE");
    return value;
  }
  async function releaseObject(request, objectId, storageKey) {
    const result = await store.releaseStorageObject({ ...request, now: currentTime(), objectId, storageKey });
    if (result?.released !== true) fail("MEDIA_UNAVAILABLE");
  }
  return Object.freeze({
    actor: (role, raw) => guarded(() => chatService.actor(role, raw)),
    admitUpload: (role, raw) => guarded(() => admitUpload(role, raw)),
    releaseUpload,
    upload: (role, raw, bytes, ticket) => guarded(async () => {
      if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 10485760) { if (ticket !== undefined) releaseUpload(ticket); fail("MEDIA_INPUT"); }
      if (ticket === undefined) ticket = await admitUpload(role, raw);
      const record = admissions.get(ticket);
      if (!record || record.state !== "waiting") fail("MEDIA_INPUT");
      record.state = "processing"; clearTimeout(record.timer);
      try {
        let digest; try { digest = tokenDigest(raw); } catch { fail("CHAT_UNAUTHORIZED"); }
        if (record.role !== role || !timingSafeEqual(record.tokenHash, digest)) fail("MEDIA_INPUT");
        if (currentTime() >= record.expiresAt) fail("MEDIA_INPUT");
        const { actor, request } = await context(role, raw);
        if (actor.user.id !== record.userId) fail("CHAT_UNAUTHORIZED");
        const image = await normalizeImage(bytes);
        const assetId = randomBytes(16), storageKey = randomBytes(32);
        const asset = { id: assetId, storageKey, digest: image.digest,
          width: image.width, height: image.height, thumbnailWidth: image.thumbnailWidth, thumbnailHeight: image.thumbnailHeight,
          fullBytes: image.full.length, thumbnailBytes: image.thumbnail.length };
        // Reserve durable capacity before the first possible filesystem write.
        // Unknown acknowledgements keep their reservation and never start put.
        const reserved = await store.reserveAsset({ ...request, now: currentTime(), asset });
        if (reserved?.duplicate === true) return uploadResult(reserved, role, actor.user.id);
        const capacity = reservation(reserved, asset);
        try {
          const space = await storage.availableSpace();
          if (!space || typeof space.availableBytes !== "bigint" || space.availableBytes < 0n) fail("MEDIA_CAPACITY_UNAVAILABLE");
          if (space.availableBytes < BigInt(capacity.pendingBytes) + BigInt(minimumFreeBytes)) fail("MEDIA_STORAGE_LIMIT");
        } catch (error) {
          // The reservation was positively acknowledged and put has never
          // started. Only this exact allocation can be cancelled. A failed or
          // lost cancellation acknowledgement is not retried automatically.
          await (async () => {
            const cancelled = await store.cancelAssetReservation({ ...request, now: currentTime(), objectId: assetId, storageKey });
            if (cancelled?.released !== true) fail("MEDIA_UNAVAILABLE");
          })().catch(() => {});
          throw error;
        }
        await storage.put({ assetId, storageKey, full: image.full, thumbnail: image.thumbnail });
        // A failed commit acknowledgement is ambiguous. Preserve encrypted
        // files; SQL still rechecks the current actor before metadata writes.
        const result = await store.registerAsset({ ...request, now: currentTime(), asset });
        const response = uploadResult(result, role, actor.user.id, asset);
        if (result.duplicate && !result.asset.id.equals(assetId)) {
          // Only a positive duplicate acknowledgement permits cleanup. Keep
          // the charge until durable unlink and release both acknowledge it.
          await (async () => { await storage.remove({ storageKey }); await releaseObject(request, assetId, storageKey); })().catch(() => {});
        }
        return response;
      } finally { closeAdmission(record); }
    }),
    listAssets: (role, raw, { conversationId = null, afterId = null, limit = 50 } = {}) => guarded(async () => {
      pageSize(limit); const conversation = conversationId === null ? null : id(conversationId), after = afterId === null ? null : id(afterId);
      const { actor, request } = await context(role, raw);
      await consumeBudget(actor.user.id, "library", request.now);
      const result = await store.listAssets({ ...request, now: currentTime(), conversationId: conversation, afterId: after, limit });
      return { assets: result.assets.map((row) => mediaDTO(row, role)), nextCursor: result.nextCursor?.toString("hex") ?? null, hasMore: result.hasMore };
    }),
    asset: (role, raw, assetId, variant) => guarded(async () => {
      variantValue(variant); const target = id(assetId); const { actor, request } = await context(role, raw);
      await consumeBudget(actor.user.id, variant, request.now);
      return content(await store.getOwnedAsset({ ...request, now: currentTime(), assetId: target }), variant);
    }),
    messageAsset: (role, raw, conversationId, messageId, variant) => guarded(async () => {
      variantValue(variant); const conversation = id(conversationId), message = id(messageId);
      const { actor, request } = await context(role, raw);
      await consumeBudget(actor.user.id, variant, request.now);
      return content(await store.getMessageAsset({ ...request, now: currentTime(), conversationId: conversation, messageId: message }), variant);
    }),
    // Internal aggregate download: the conversation exporter owns the total
    // byte/time/concurrency budget. Keep the ordinary per-photo display quota
    // available for browsing; retain the same role and message ACL.
    exportMessageAsset: (raw, conversationId, messageId) => guarded(async () => {
      const conversation = id(conversationId), message = id(messageId), { request } = await context("admin", raw);
      return content(await store.getMessageAsset({ ...request, now: currentTime(), conversationId: conversation, messageId: message }), "full");
    }),
    exportClientMessageAsset: (raw, conversationId, messageId) => guarded(async () => {
      const conversation = id(conversationId), message = id(messageId), { request } = await context("client", raw);
      return content(await store.getMessageAsset({ ...request, now: currentTime(), conversationId: conversation, messageId: message }), "full");
    }),
    gallery: (role, raw, conversationId, { before = null, after = null, from = null, until = null, limit = 50 } = {}) => guarded(async () => {
      if (before !== null) cursor(before); pageSize(limit);
      if (after !== null) { cursor(after); if (before !== null || limit !== 1) fail("MEDIA_INPUT"); }
      if ([from, until].some(value => value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999)) || from !== null && until !== null && from >= until) fail("MEDIA_INPUT");
      const conversation = id(conversationId); const { actor, request } = await context(role, raw);
      await consumeBudget(actor.user.id, "gallery", request.now);
      const result = await store.gallery({ ...request, now: currentTime(), conversationId: conversation, before, limit, ...(after === null ? {} : { after }), ...(from === null ? {} : { from }), ...(until === null ? {} : { until }) });
      return { items: result.items.map((item) => ({ messageId: item.messageId.toString("hex"), sequence: item.sequence,
        sender: item.senderId.equals(id(actor.user.id)) ? "me" : "peer", createdAt: item.createdAt,
        media: mediaDTO({ ...item.asset, createdAt: item.createdAt, sharedHere: true }, role, { conversationId, messageId: item.messageId.toString("hex") }) })), nextBefore: result.nextBefore, hasMore: result.hasMore };
    }),
    removeAsset: (role, raw, assetId) => guarded(async () => {
      const target = id(assetId); const { actor, request } = await context(role, raw);
      await consumeBudget(actor.user.id, "delete", request.now);
      const row = await store.deleteAsset({ ...request, now: currentTime(), assetId: target });
      if (!Buffer.isBuffer(row?.id) || row.id.length !== 16 || !row.id.equals(target)
        || !Buffer.isBuffer(row.storageKey) || row.storageKey.length !== 32) fail("MEDIA_UNAVAILABLE");
      // The metadata deletion prevents new sends/reads before unlinking. A
      // retry can finish cleanup if filesystem availability interrupted it.
      await storage.remove({ storageKey: row.storageKey });
      await releaseObject(request, row.id, row.storageKey);
      return { deleted: true };
    }),
    send: (role, raw, conversationId, input) => guarded(() => chatService.sendImage(role, raw, conversationId, input)),
  });
}
