import { createHmac, randomBytes } from "node:crypto";
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
const allowed = new Set(["MEDIA_INPUT", "MEDIA_FORMAT", "MEDIA_BUSY", "MEDIA_NOT_FOUND", "MEDIA_IN_USE", "MEDIA_RATE_LIMIT", "CHAT_UNAUTHORIZED", "CHAT_FORBIDDEN", "CHAT_NOT_FOUND", "CHAT_CONFLICT", "CHAT_INPUT", "CHAT_RATE_LIMIT", "AUTH_RATE_LIMIT", "AUTH_BUSY", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"]);

export async function createMediaService({ store, chatService, authStore, storage, key, clock = Date.now }) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || typeof clock !== "function") throw new MediaError("MEDIA_CONFIG");
  for (const method of ["registerAsset", "listAssets", "getOwnedAsset", "getMessageAsset", "deleteAsset", "gallery"]) if (typeof store?.[method] !== "function") throw new MediaError("MEDIA_CONFIG");
  for (const method of ["put", "get", "remove"]) if (typeof storage?.[method] !== "function") throw new MediaError("MEDIA_CONFIG");
  if (typeof chatService?.actor !== "function" || typeof chatService?.sendImage !== "function" || typeof authStore?.consumeRateLimit !== "function") throw new MediaError("MEDIA_CONFIG");
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
    const now = clock(); if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999) fail("MEDIA_UNAVAILABLE");
    return { actor, request: { role, tokenHash: digest, now } };
  }
  async function limit(userId, kind, now) {
    const budgets = kind === "upload" ? [["global-upload", "all", 30], ["user-upload", userId, 10]]
      : [[`user-${kind}`, userId, kind === "full" ? 20 : kind === "thumb" ? 120 : 30]];
    for (const [name, identity, ceiling] of budgets) {
      const bucket = createHmac("sha256", key).update("jessiemessage:media-rate:v1:").update(name).update("\0").update(identity).digest();
      const result = await authStore.consumeRateLimit(bucket, { now, windowSeconds: 60, limit: ceiling });
      if (!result.allowed) throw new MediaError("MEDIA_RATE_LIMIT", result.retryAfter);
    }
  }
  const variantValue = (variant) => { if (!["full", "thumb"].includes(variant)) fail("MEDIA_INPUT"); return variant; };
  async function content(row, variant) {
    const bytes = await storage.get({ assetId: row.id, storageKey: row.storageKey, variant });
    const expected = variant === "full" ? row.fullBytes : row.thumbnailBytes;
    if (!Buffer.isBuffer(bytes) || bytes.length !== expected) fail("MEDIA_UNAVAILABLE");
    return { bytes, mime: "image/jpeg" };
  }
  return Object.freeze({
    actor: (role, raw) => guarded(() => chatService.actor(role, raw)),
    upload: (role, raw, bytes) => guarded(async () => {
      if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 10485760) fail("MEDIA_INPUT");
      const { actor, request } = await context(role, raw);
      await limit(actor.user.id, "upload", request.now);
      const image = await normalizeImage(bytes);
      const assetId = randomBytes(16), storageKey = randomBytes(32);
      await storage.put({ assetId, storageKey, full: image.full, thumbnail: image.thumbnail });
      // A failed commit acknowledgement is ambiguous. Preserve encrypted files
      // rather than removing a blob whose metadata may already be committed.
      const result = await store.registerAsset({ ...request, asset: { id: assetId, storageKey, digest: image.digest,
        width: image.width, height: image.height, thumbnailWidth: image.thumbnailWidth, thumbnailHeight: image.thumbnailHeight,
        fullBytes: image.full.length, thumbnailBytes: image.thumbnail.length } });
      if (result.duplicate && !result.asset.id.equals(assetId)) await storage.remove({ storageKey }).catch(() => {});
      return { asset: mediaDTO(result.asset, role), duplicate: result.duplicate };
    }),
    listAssets: (role, raw, { conversationId = null, afterId = null, limit = 50 } = {}) => guarded(async () => {
      pageSize(limit); const { request } = await context(role, raw);
      const result = await store.listAssets({ ...request, conversationId: conversationId === null ? null : id(conversationId), afterId: afterId === null ? null : id(afterId), limit });
      return { assets: result.assets.map((row) => mediaDTO(row, role)), nextCursor: result.nextCursor?.toString("hex") ?? null, hasMore: result.hasMore };
    }),
    asset: (role, raw, assetId, variant) => guarded(async () => {
      variantValue(variant); const target = id(assetId); const { actor, request } = await context(role, raw);
      await limit(actor.user.id, variant, request.now);
      return content(await store.getOwnedAsset({ ...request, assetId: target }), variant);
    }),
    messageAsset: (role, raw, conversationId, messageId, variant) => guarded(async () => {
      variantValue(variant); const conversation = id(conversationId), message = id(messageId);
      const { actor, request } = await context(role, raw);
      await limit(actor.user.id, variant, request.now);
      return content(await store.getMessageAsset({ ...request, conversationId: conversation, messageId: message }), variant);
    }),
    gallery: (role, raw, conversationId, { before = null, limit = 50 } = {}) => guarded(async () => {
      if (before !== null) cursor(before); pageSize(limit);
      const conversation = id(conversationId); const { actor, request } = await context(role, raw);
      const result = await store.gallery({ ...request, conversationId: conversation, before, limit });
      return { items: result.items.map((item) => ({ messageId: item.messageId.toString("hex"), sequence: item.sequence,
        sender: item.senderId.equals(id(actor.user.id)) ? "me" : "peer", createdAt: item.createdAt,
        media: mediaDTO({ ...item.asset, createdAt: item.createdAt, sharedHere: true }, role, { conversationId, messageId: item.messageId.toString("hex") }) })), nextBefore: result.nextBefore, hasMore: result.hasMore };
    }),
    removeAsset: (role, raw, assetId) => guarded(async () => {
      const target = id(assetId); const { actor, request } = await context(role, raw);
      await limit(actor.user.id, "delete", request.now);
      const row = await store.deleteAsset({ ...request, assetId: target });
      // The metadata deletion prevents new sends/reads before unlinking. A
      // retry can finish cleanup if filesystem availability interrupted it.
      await storage.remove({ storageKey: row.storageKey });
      return { deleted: true };
    }),
    send: (role, raw, conversationId, input) => guarded(() => chatService.sendImage(role, raw, conversationId, input)),
  });
}
