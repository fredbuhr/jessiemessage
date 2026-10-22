import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { tokenDigest } from "../auth/crypto.mjs";
import { validateMessageBody } from "../chat/crypto.mjs";
import { MAX_VIDEO_BYTES, VIDEO_BLOCK_BYTES, videoStoredBytes } from "./storage.mjs";
import { validateMp4Prefix } from "./mp4.mjs";

export class VideoError extends Error {
  constructor(code = "VIDEO_UNAVAILABLE", retryAfter) {
    super("Private video transport is unavailable."); this.name = "VideoError"; this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}
const fail = (code) => { throw new VideoError(code); };
const PREFIX_BYTES = 65536, ADMISSION_MS = 305000;
const permitted = new Set(["VIDEO_INPUT", "VIDEO_FORMAT", "VIDEO_BUSY", "VIDEO_NOT_FOUND", "VIDEO_IN_USE", "VIDEO_RATE_LIMIT", "VIDEO_STORAGE_LIMIT",
  "CHAT_UNAUTHORIZED", "CHAT_FORBIDDEN", "CHAT_NOT_FOUND", "CHAT_CONFLICT", "CHAT_INPUT", "CHAT_RATE_LIMIT",
  "ACCESS_FORBIDDEN", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES", "AUTH_RATE_LIMIT", "AUTH_BUSY"]);
let activeUploads = 0, activeReads = 0;
const uploadingOwners = new Set(), readingOwners = new Map();
const identifier = (value) => {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) fail("VIDEO_INPUT");
  return Buffer.from(value, "hex");
};
const sized = (value, bytes) => Buffer.isBuffer(value) && value.length === bytes;
const validBytes = (bytes) => Number.isSafeInteger(bytes) && bytes >= 1 && bytes <= MAX_VIDEO_BYTES;
const sequence = (value, positive = false) => typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/.test(value)
  && BigInt(value) <= 18446744073709551615n && (!positive || value !== "0");
function pageOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some((name) => !["before", "limit"].includes(name))) fail("VIDEO_INPUT");
  const { before = null, limit = 50 } = options;
  if (before !== null && !sequence(before) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("VIDEO_INPUT");
  return { before, limit };
}
function checkAbort(signal) { if (signal?.aborted) fail("VIDEO_INPUT"); }
async function guarded(operation) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof VideoError) throw error;
    if (error?.code === "AUTH_INVALID") fail("CHAT_UNAUTHORIZED");
    if (permitted.has(error?.code)) throw new VideoError(error.code, error.retryAfter);
    fail("VIDEO_UNAVAILABLE");
  }
}
function uploadSlot(owner) {
  if (activeUploads >= 2 || uploadingOwners.has(owner)) throw new VideoError("VIDEO_BUSY", 5);
  activeUploads++; uploadingOwners.add(owner); let released = false;
  return () => { if (!released) { released = true; activeUploads--; uploadingOwners.delete(owner); } };
}
function readSlot(owner) {
  const count = readingOwners.get(owner) ?? 0;
  if (activeReads >= 4 || count >= 2) throw new VideoError("VIDEO_BUSY", 5);
  activeReads++; readingOwners.set(owner, count + 1); let released = false;
  return () => {
    if (released) return;
    released = true; activeReads--;
    const remaining = readingOwners.get(owner) - 1;
    if (remaining) readingOwners.set(owner, remaining); else readingOwners.delete(owner);
  };
}

// Inspect a fixed prefix, then return it to the streaming writer. Never collect
// the whole file, including when a source produces very small network chunks.
async function inspectSource(source, bytes, signal) {
  if (!source || typeof source[Symbol.asyncIterator] !== "function") fail("VIDEO_INPUT");
  const iterator = source[Symbol.asyncIterator](), prefix = Buffer.alloc(Math.min(bytes, PREFIX_BYTES));
  let used = 0, rest = null, returned = false;
  const close = async () => { if (!returned) { returned = true; prefix.fill(0); await iterator.return?.(); } };
  try {
    while (used < prefix.length) {
      checkAbort(signal);
      const next = await iterator.next(); checkAbort(signal);
      if (next.done || !Buffer.isBuffer(next.value) || next.value.length === 0) fail("VIDEO_INPUT");
      const amount = Math.min(prefix.length - used, next.value.length);
      next.value.copy(prefix, used, 0, amount); used += amount;
      if (amount < next.value.length) rest = next.value.subarray(amount);
    }
    validateMp4Prefix(prefix, bytes);
    return {
      close,
      async *[Symbol.asyncIterator]() {
        try {
          checkAbort(signal); yield prefix;
          if (rest) { checkAbort(signal); yield rest; rest = null; }
          while (true) {
            checkAbort(signal); const next = await iterator.next(); checkAbort(signal);
            if (next.done) break;
            yield next.value;
          }
        } finally { prefix.fill(0); await close(); }
      },
    };
  } catch (error) { prefix.fill(0); await close(); throw error; }
}

/**
 * Dormant transport foundation. A future production catalog MUST enforce live
 * actor/owner ACL and durable capacity in each transaction. No in-memory or SQL
 * production adapter is provided by this lot, and no route is registered.
 */
export async function createVideoService({ store, chatService, authStore, storage, key, messages = null, minimumFreeBytes = 536870912, clock = Date.now } = {}) {
  if (!sized(key, 32) || typeof clock !== "function" || !Number.isSafeInteger(minimumFreeBytes) || minimumFreeBytes < 0) fail("VIDEO_CONFIG");
  for (const method of ["reserve", "commit", "getOwned", "release"]) if (typeof store?.[method] !== "function") fail("VIDEO_CONFIG");
  for (const method of ["put", "open", "availableSpace"]) if (typeof storage?.[method] !== "function") fail("VIDEO_CONFIG");
  if (typeof chatService?.actor !== "function" || typeof authStore?.consumeRateLimit !== "function") fail("VIDEO_CONFIG");
  if (messages !== null && (["getMessageAsset", "gallery"].some((name) => typeof messages?.[name] !== "function")
    || typeof chatService.sendVideo !== "function")) fail("VIDEO_CONFIG");
  key = Buffer.from(key);
  const tickets = new WeakMap();
  function now() { const value = clock(); if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) fail(); return value; }
  async function context(role, raw) {
    if (!["admin", "client"].includes(role)) fail("VIDEO_INPUT");
    let digest; try { digest = tokenDigest(raw); } catch { fail("CHAT_UNAUTHORIZED"); }
    const actor = await chatService.actor(role, raw), time = now();
    if (!actor || actor.user?.role !== role || typeof actor.user?.id !== "string" || !/^[a-f0-9]{32}$/.test(actor.user.id)
      || !Number.isSafeInteger(actor.expiresAt) || actor.expiresAt <= time) fail("CHAT_UNAUTHORIZED");
    return { actor, request: { role, tokenHash: digest, now: time } };
  }
  async function budget(owner, kind, time) {
    for (const [name, identity, limit] of [[`user-${kind}`, owner, kind === "upload" ? 5 : 120], [`global-${kind}`, "all", kind === "upload" ? 20 : 300]]) {
      const bucket = createHmac("sha256", key).update("jessiemessage:video-rate:v1:").update(name).update("\0").update(identity).digest();
      const result = await authStore.consumeRateLimit(bucket, { now: time, windowSeconds: 60, limit });
      if (!result || typeof result.allowed !== "boolean") fail();
      if (!result.allowed) throw new VideoError("VIDEO_RATE_LIMIT", result.retryAfter);
    }
  }
  function finish(record) {
    if (record.state === "closed") return;
    record.state = "closed"; clearTimeout(record.timer); record.releaseSlot();
  }
  async function refund(record) {
    const result = await store.release({ ...record.request, now: now(), assetId: record.asset.id, storageKey: record.asset.storageKey });
    if (result?.released !== true) fail();
  }
  async function releaseUpload(ticket) {
    const record = tickets.get(ticket);
    if (record?.state !== "waiting") return;
    record.state = "abandoning"; clearTimeout(record.timer);
    // No write has started in this state. Unknown release acknowledgements
    // retain their durable charge in the adapter, even after this slot ends.
    try { await refund(record); } finally { finish(record); }
  }
  function validateRow(row, owner, proposed) {
    if (!sized(row?.id, 16) || !sized(row.storageKey, 32) || !sized(row.ownerId, 16) || owner !== null && row.ownerId.toString("hex") !== owner
      || !sized(row.digest, 32) || !validBytes(row.bytes) || row.storedBytes !== videoStoredBytes(row.bytes)
      || row.mime !== "video/mp4" || row.deletedAt !== null
      || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || row.createdAt > now()) fail();
    if (proposed && (!row.id.equals(proposed.id) || !row.storageKey.equals(proposed.storageKey) || row.bytes !== proposed.bytes
      || !row.digest.equals(proposed.digest))) fail();
    return row;
  }
  function deliveryDTO(row, role, conversationId, messageId) {
    return { id: row.id.toString("hex"), bytes: row.bytes, mime: "video/mp4",
      contentUrl: `/api/video/${role}/conversations/${conversationId}/messages/${messageId}/content` };
  }
  async function openContent(role, raw, lookup, { signal, ownerOnly = true, expectedId = null } = {}) {
    const { actor, request } = await context(role, raw), releaseSlot = readSlot(actor.user.id);
    let handle;
    try {
      checkAbort(signal); await budget(actor.user.id, "read", request.now);
      // Delivery ACL belongs to the current conversation/message transaction.
      // Its owner is the sender and can differ from the authorized reader.
      const row = validateRow(await lookup({ ...request, now: now() }), ownerOnly ? actor.user.id : null);
      if (expectedId !== null && !row.id.equals(expectedId)) fail();
      checkAbort(signal); handle = await storage.open({ assetId: row.id, storageKey: row.storageKey });
      if (!handle || handle.bytes !== row.bytes || handle.storedBytes !== row.storedBytes || typeof handle.stream !== "function" || typeof handle.close !== "function") fail();
      let closing, closed = false, started = false;
      const close = () => {
        if (!closing) { closed = true; closing = (async () => { try { await handle.close(); } finally { releaseSlot(); } })(); }
        return closing;
      };
      return Object.freeze({ bytes: row.bytes, mime: "video/mp4", close,
        stream({ start = 0, end = row.bytes - 1, signal: streamSignal } = {}) {
          if (started || closed) fail("VIDEO_INPUT");
          started = true;
          const combined = signal && streamSignal ? AbortSignal.any([signal, streamSignal]) : signal ?? streamSignal;
          const iterator = (async function* () {
            try {
              checkAbort(combined);
              for await (const chunk of handle.stream({ start, end, signal: combined })) {
                checkAbort(combined);
                if (!Buffer.isBuffer(chunk) || chunk.length < 1 || chunk.length > VIDEO_BLOCK_BYTES) fail();
                yield chunk;
              }
            } catch (error) { await guarded(() => { throw error; }); }
            finally { await close(); }
          })();
          // AsyncGenerator.return() before next() does not execute finally.
          // Own descriptor cleanup even when the consumer never starts.
          return Object.freeze({
            next: (...args) => iterator.next(...args),
            async return(value) { try { return await iterator.return(value); } finally { await close(); } },
            async throw(error) { try { return await iterator.throw(error); } finally { await close(); } },
            [Symbol.asyncIterator]() { return this; },
          });
        },
      });
    } catch (error) { try { await handle?.close?.(); } finally { releaseSlot(); } throw error; }
  }
  return Object.freeze({
    actor: (role, raw) => guarded(async () => (await context(role, raw)).actor),
    admitUpload: (role, raw, { bytes, mime } = {}) => guarded(async () => {
      if (!validBytes(bytes) || mime !== "video/mp4") fail("VIDEO_INPUT");
      const { actor, request } = await context(role, raw), releaseSlot = uploadSlot(actor.user.id);
      try {
        await budget(actor.user.id, "upload", request.now);
        const asset = { id: randomBytes(16), storageKey: randomBytes(32), bytes, storedBytes: videoStoredBytes(bytes), mime };
        const result = await store.reserve({ ...request, now: now(), asset });
        const value = result?.reservation;
        if (!sized(value?.id, 16) || !value.id.equals(asset.id) || !sized(value.storageKey, 32) || !value.storageKey.equals(asset.storageKey)
          || !sized(value.ownerId, 16) || value.ownerId.toString("hex") !== actor.user.id || value.bytes !== bytes || value.storedBytes !== asset.storedBytes
          || !Number.isSafeInteger(value.pendingBytes) || value.pendingBytes < asset.storedBytes) fail();
        const ticket = Object.freeze(Object.create(null)), record = { state: "waiting", asset, request, owner: actor.user.id,
          pendingBytes: value.pendingBytes, expiresAt: now() + ADMISSION_MS, releaseSlot, timer: null };
        record.timer = setTimeout(() => { releaseUpload(ticket).catch(() => {}); }, ADMISSION_MS); record.timer.unref();
        tickets.set(ticket, record); return ticket;
      } catch (error) { releaseSlot(); throw error; }
    }),
    releaseUpload: (ticket) => guarded(() => releaseUpload(ticket)),
    upload: (role, raw, ticket, source, { signal } = {}) => guarded(async () => {
      const record = tickets.get(ticket);
      if (!record || record.state !== "waiting") fail("VIDEO_INPUT");
      let digest; try { digest = tokenDigest(raw); } catch { fail("CHAT_UNAUTHORIZED"); }
      if (role !== record.request.role || !timingSafeEqual(digest, record.request.tokenHash)) fail("VIDEO_INPUT");
      record.state = "processing"; clearTimeout(record.timer);
      let inspected, writeStarted = false, published = false;
      try {
        checkAbort(signal);
        if (now() >= record.expiresAt) fail("VIDEO_INPUT");
        const { actor } = await context(role, raw);
        if (actor.user.id !== record.owner) fail("CHAT_UNAUTHORIZED");
        const space = await storage.availableSpace();
        if (typeof space?.availableBytes !== "bigint" || space.availableBytes < 0n) fail();
        if (space.availableBytes < BigInt(record.pendingBytes) + BigInt(minimumFreeBytes)) fail("VIDEO_STORAGE_LIMIT");
        inspected = await inspectSource(source, record.asset.bytes, signal);
        checkAbort(signal); writeStarted = true;
        let saved;
        try { saved = await storage.put({ assetId: record.asset.id, storageKey: record.asset.storageKey, bytes: record.asset.bytes, source: inspected, signal }); }
        catch (error) {
          // Only an explicit, known storage failure before publication can
          // permit refund. An unknown adapter error is an ambiguous outcome.
          published = !(error?.published === false && error?.cleanupConfirmed === true);
          throw error;
        }
        published = true;
        if (!saved || saved.bytes !== record.asset.bytes || saved.storedBytes !== record.asset.storedBytes || !sized(saved.digest, 32)) fail();
        checkAbort(signal);
        const current = await context(role, raw);
        if (current.actor.user.id !== record.owner) fail("CHAT_UNAUTHORIZED");
        const asset = { ...record.asset, digest: saved.digest };
        const result = await store.commit({ ...current.request, now: now(), asset });
        const row = validateRow(result?.asset, record.owner, asset);
        return { id: row.id.toString("hex"), bytes: row.bytes, mime: "video/mp4" };
      } catch (error) {
        if (!writeStarted || !published) await refund(record).catch(() => {});
        throw error;
      } finally { try { await inspected?.close(); } finally { finish(record); } }
    }),
    open: (role, raw, assetId, { signal } = {}) => guarded(async () => {
      const target = identifier(assetId);
      return openContent(role, raw, (request) => store.getOwned({ ...request, assetId: target }), { signal, expectedId: target });
    }),
    remove: (role, raw, assetId) => guarded(async () => {
      const target = identifier(assetId), { actor, request } = await context(role, raw);
      if (["deleteAsset", "releaseDeletedStorage"].some((name) => typeof store[name] !== "function")
        || typeof storage.remove !== "function" || typeof storage.fingerprint !== "function"
        || typeof store.binding?.rootFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(store.binding.rootFingerprint)) fail("VIDEO_CONFIG");
      const binding = store.binding.rootFingerprint;
      const assertRoot = async () => {
        const fingerprint = await storage.fingerprint();
        if (!sized(fingerprint, 32) || fingerprint.toString("hex") !== binding) fail();
      };
      await budget(actor.user.id, "delete", request.now); await assertRoot();
      const row = await store.deleteAsset({ ...request, now: now(), assetId: target });
      if (!sized(row?.id, 16) || !row.id.equals(target) || !sized(row.ownerId, 16) || row.ownerId.toString("hex") !== actor.user.id
        || !sized(row.storageKey, 32) || !Number.isSafeInteger(row.deletedAt) || row.deletedAt < 0 || row.deletedAt > now()) fail();
      await assertRoot();
      const removed = await storage.remove({ storageKey: row.storageKey });
      if (removed?.removed !== true) fail();
      await assertRoot();
      const released = await store.releaseDeletedStorage({ ...request, now: now(), assetId: target, storageKey: row.storageKey });
      if (released?.released !== true) fail();
      return { deleted: true };
    }),
    ...(messages === null ? {} : {
      send: (role, raw, conversationId, input) => guarded(async () => {
        if (!["admin", "client"].includes(role)) fail("VIDEO_INPUT");
        identifier(conversationId);
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 3
          || !["clientMessageId", "videoId", "caption"].every((name) => Object.hasOwn(input, name))) fail("VIDEO_INPUT");
        identifier(input.clientMessageId); identifier(input.videoId);
        if (typeof input.caption !== "string" || input.caption.length > 1000) fail("VIDEO_INPUT");
        if (input.caption !== "") { try { validateMessageBody(input.caption); } catch { fail("VIDEO_INPUT"); } }
        return chatService.sendVideo(role, raw, conversationId, input);
      }),
      openMessage: (role, raw, conversationId, messageId, { signal } = {}) => guarded(async () => {
        const conversation = identifier(conversationId), message = identifier(messageId);
        return openContent(role, raw, (request) => messages.getMessageAsset({ ...request, conversationId: conversation, messageId: message }), { signal, ownerOnly: false });
      }),
      gallery: (role, raw, conversationId, options = {}) => guarded(async () => {
        const conversation = identifier(conversationId), { before, limit } = pageOptions(options), { actor, request } = await context(role, raw);
        await budget(actor.user.id, "gallery", request.now);
        const result = await messages.gallery({ ...request, now: now(), conversationId: conversation, before, limit });
        if (!result || !Array.isArray(result.items) || result.items.length > limit || typeof result.hasMore !== "boolean"
          || !(result.nextBefore === null || sequence(result.nextBefore, true))) fail();
        let previous = before === null ? 18446744073709551616n : BigInt(before);
        const items = result.items.map((item) => {
          if (!sized(item?.messageId, 16) || !sized(item.senderId, 16) || !sequence(item.sequence, true) || BigInt(item.sequence) >= previous
            || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0 || item.createdAt > now()) fail();
          previous = BigInt(item.sequence);
          const row = validateRow(item.asset, null);
          if (!row.ownerId.equals(item.senderId) || row.createdAt > item.createdAt) fail();
          const messageId = item.messageId.toString("hex");
          return { messageId, sequence: item.sequence, sender: item.senderId.toString("hex") === actor.user.id ? "me" : "peer",
            createdAt: item.createdAt, video: deliveryDTO(row, role, conversationId, messageId) };
        });
        if (result.hasMore ? !items.length || result.nextBefore !== items.at(-1).sequence : result.nextBefore !== null) fail();
        return { items, nextBefore: result.nextBefore, hasMore: result.hasMore };
      }),
    }),
  });
}
