import { createHash, timingSafeEqual } from "node:crypto";
import { canonicalEmail } from "../auth/config.mjs";
import { decryptMessageBody, messageFingerprint, videoMessageFingerprint, validateMessageBody } from "../chat/crypto.mjs";

export const DATA_EXPORT_DEFAULT_LIMITS = Object.freeze({ maxRows: 10000, maxTextBytes: 16 * 1024 * 1024, maxMediaBytes: 256 * 1024 * 1024 });
const MAX_DATE = 253402300799999;
const MAX_SEQUENCE = 18446744073709551615n;
const PAGE_SIZE = 100;
const VIDEO_BLOCK_BYTES = 262144, MAX_VIDEO_BYTES = 104857600;
const STATUSES = new Set(["pending", "active", "suspended", "revoked", "deleted"]);

export class DataExportError extends Error {
  constructor() {
    super("Private client content could not be exported.");
    this.name = "DataExportError";
    this.code = "DATA_EXPORT_UNAVAILABLE";
  }
}
const fail = () => { throw new DataExportError(); };
function object(value) { if (!value || typeof value !== "object" || Array.isArray(value)) fail(); return value; }
function bytes(value, length = 16) { if (!Buffer.isBuffer(value) || value.length !== length) fail(); return Buffer.from(value); }
function integer(value, minimum, maximum) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(); return value; }
function text(value, maximum) { if (typeof value !== "string" || !value.isWellFormed() || !value.trim().length || value.length > maximum) fail(); return value; }
function sequence(value, positive = false) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(value)
    || BigInt(value) > MAX_SEQUENCE || positive && value === "0") fail();
  return value;
}
function date(value, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== "string") fail();
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) fail();
  const iso = `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(3, "0").slice(0, 3)}Z`;
  const instant = Date.parse(iso);
  if (!Number.isSafeInteger(instant) || instant < 0 || instant > MAX_DATE || new Date(instant).toISOString() !== iso) fail();
  // Calendar validation uses JavaScript milliseconds; export ordering and
  // metadata retain the database's full microsecond precision.
  return `${match[1]}T${match[2]}.${(match[3] ?? "").padEnd(6, "0")}Z`;
}
function publicAccount(account, clientId) {
  object(account);
  if (!bytes(account.id).equals(clientId) || account.role !== "client" || !STATUSES.has(account.status)) fail();
  const email = canonicalEmail(account.email);
  if (email !== account.email) fail();
  const result = { status: account.status, pseudonym: text(account.pseudonym, 64), email,
    createdAt: date(account.createdAt), updatedAt: date(account.updatedAt),
    emailVerifiedAt: date(account.emailVerifiedAt, true), ageDeclaredAt: date(account.ageDeclaredAt, true),
    ageAssuredAt: date(account.ageAssuredAt, true), accessApprovedAt: date(account.accessApprovedAt, true),
    accessExpiresAt: date(account.accessExpiresAt, true) };
  if (result.updatedAt < result.createdAt || result.accessExpiresAt !== null
    && (result.accessApprovedAt === null || result.accessExpiresAt <= result.accessApprovedAt)) fail();
  return result;
}
function conversation(value, clientId) {
  if (value === null) return null;
  object(value);
  const id = bytes(value.id), actualClient = bytes(value.clientId), adminId = bytes(value.adminId);
  if (!actualClient.equals(clientId) || actualClient.equals(adminId)) fail();
  const output = { peerName: text(value.peerName, 64), createdAt: date(value.createdAt), closedAt: date(value.closedAt, true),
    // Client-content exports must not publish Jessie’s read state, including
    // when a caller supplies a reader with a previously populated peer cursor.
    lastReadSequence: sequence(value.lastReadSequence), peerReadSequence: "0" };
  if (output.closedAt !== null && output.closedAt < output.createdAt) fail();
  return { id, clientId: actualClient, adminId, output };
}
function preference(value) {
  object(value);
  if (typeof value.enabled !== "boolean") fail();
  const updatedAt = date(value.updatedAt, true);
  if (value.enabled && updatedAt === null) fail();
  return { enabled: value.enabled, updatedAt };
}
function ownProfile(value) {
  if (value === undefined) return { avatarMediaId: null, version: 0, createdAt: null, updatedAt: null };
  object(value);
  const version = integer(value.version, 0, 4294967295);
  const result = { avatarMediaId: value.avatarMediaId === null ? null : bytes(value.avatarMediaId).toString("hex"), version,
    createdAt: date(value.createdAt, true), updatedAt: date(value.updatedAt, true) };
  if (version === 0 ? result.avatarMediaId !== null || result.createdAt !== null || result.updatedAt !== null
    : result.createdAt === null || result.updatedAt === null || result.createdAt > result.updatedAt) fail();
  return result;
}
function mediaRecord(value, expectedOwnerId, expectedOwnerRole) {
  object(value);
  const result = { id: bytes(value.id), ownerId: bytes(value.ownerId), storageKey: bytes(value.storageKey, 32), digest: bytes(value.digest, 32),
    width: integer(value.width, 1, 2048), height: integer(value.height, 1, 2048), fullBytes: integer(value.fullBytes, 1, 10485760) };
  if (!result.ownerId.equals(expectedOwnerId) || value.ownerRole !== expectedOwnerRole || value.deletedAt !== null
    || value.journalState !== "registered" || !bytes(value.journalAssetId).equals(result.id)
    || !bytes(value.journalOwnerId).equals(result.ownerId)) fail();
  return result;
}
function videoRecord(value, expectedOwnerId, expectedOwnerRole, nowIso) {
  object(value);
  const result = { id: bytes(value.id), ownerId: bytes(value.ownerId), storageKey: bytes(value.storageKey, 32), digest: bytes(value.digest, 32),
    bytes: integer(value.bytes, 1, MAX_VIDEO_BYTES), storedBytes: integer(value.storedBytes, 1, 104864048), createdAt: date(value.createdAt) };
  if (!result.ownerId.equals(expectedOwnerId) || value.ownerRole !== expectedOwnerRole || value.deletedAt !== null
    || value.state !== "committed" || value.mime !== "video/mp4" || result.createdAt > nowIso
    || result.storedBytes !== 48 + result.bytes + 16 * Math.ceil(result.bytes / VIDEO_BLOCK_BYTES)) fail();
  return result;
}
function page(value) {
  object(value);
  if (!Array.isArray(value.rows) || value.rows.length > PAGE_SIZE || typeof value.hasMore !== "boolean"
    || value.hasMore !== (value.nextCursor !== null) || value.hasMore && value.rows.length !== PAGE_SIZE) fail();
  return value;
}

/** Export retained client-visible content through one already selected offline
 * reader. This grants no login/access and never starts a service or writes SQL.
 * The caller publishes the private directory only after its read transaction
 * settles; this function never finalizes or labels a partial export complete. */
export async function exportClientContent(options = {}) {
  let key;
  try {
    object(options);
    const { reader, writer, storage = null, videoStorage = null, signal } = options;
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail();
    const active = () => { if (signal?.aborted) fail(); };
    active();
    const clientId = bytes(options.clientId);
    const now = integer(options.now, 0, MAX_DATE);
    key = bytes(options.messageKey, 32);
    object(reader); object(writer);
    for (const name of ["messages", "ownMedia"]) if (typeof reader[name] !== "function") fail();
    for (const name of ["empty", "json", "line", "media"]) if (typeof writer[name] !== "function") fail();
    if (storage !== null && typeof storage?.get !== "function") fail();
    const videos = videoStorage !== null;
    if (videos ? typeof videoStorage?.open !== "function" || typeof reader.ownVideos !== "function" || typeof writer.video !== "function"
      : reader.ownVideos !== undefined) fail();
    const supplied = options.limits ?? {};
    object(supplied);
    if (Object.keys(supplied).some((name) => !Object.hasOwn(DATA_EXPORT_DEFAULT_LIMITS, name))) fail();
    const limits = { ...DATA_EXPORT_DEFAULT_LIMITS, ...supplied };
    integer(limits.maxRows, 1, 100000); integer(limits.maxTextBytes, 1, 64 * 1024 * 1024); integer(limits.maxMediaBytes, 0, 1024 * 1024 * 1024);
    const user = publicAccount(reader.account, clientId), selected = conversation(reader.conversation, clientId);
    const nowIso = new Date(now).toISOString().replace("Z", "000Z");
    if (user.createdAt > nowIso || selected !== null && selected.output.createdAt > nowIso) fail();
    const broadcasts = preference(reader.preference), profile = ownProfile(reader.ownProfile);
    if (profile.updatedAt !== null && profile.updatedAt > nowIso) fail();
    const counts = { messages: 0, mediaFiles: 0, libraryItems: 0, mediaBytes: 0, rows: 0,
      ...(videos ? { videoFiles: 0, videoBytes: 0, videoLibraryItems: 0 } : {}) };
    const copiedMedia = new Map(), copiedVideos = new Map(), messageIds = new Set();
    let textBytes = 0;
    const rowBudget = () => { if (++counts.rows > limits.maxRows) fail(); };
    async function json(name, value, line = false) {
      active();
      const size = Buffer.byteLength(`${JSON.stringify(value)}\n`, "utf8");
      if (size > limits.maxTextBytes - textBytes) fail();
      await writer[line ? "line" : "json"](name, value); textBytes += size;
    }
    async function copyMedia(raw, ownerId, ownerRole) {
      active();
      const media = mediaRecord(raw, ownerId, ownerRole), hex = media.id.toString("hex");
      const identity = JSON.stringify([media.ownerId.toString("hex"), ownerRole, media.storageKey.toString("hex"), media.digest.toString("hex"), media.width, media.height, media.fullBytes]);
      const publicMedia = { file: `media/${hex}.jpg`, type: "image/jpeg", width: media.width, height: media.height };
      if (copiedMedia.has(hex)) { if (copiedMedia.get(hex) !== identity) fail(); return publicMedia; }
      if (!storage || media.fullBytes > limits.maxMediaBytes - counts.mediaBytes) fail();
      let plaintext;
      try {
        plaintext = await storage.get({ assetId: media.id, storageKey: media.storageKey, variant: "full" });
        active();
        if (!Buffer.isBuffer(plaintext) || plaintext.length !== media.fullBytes || plaintext.length < 5
          || plaintext[0] !== 0xff || plaintext[1] !== 0xd8 || plaintext[2] !== 0xff
          || plaintext[plaintext.length - 2] !== 0xff || plaintext[plaintext.length - 1] !== 0xd9
          || !timingSafeEqual(createHash("sha256").update(plaintext).digest(), media.digest)) fail();
        await writer.media(publicMedia.file, plaintext);
        active();
      } finally { if (Buffer.isBuffer(plaintext)) plaintext.fill(0); }
      copiedMedia.set(hex, identity); counts.mediaFiles += 1; counts.mediaBytes += media.fullBytes;
      return publicMedia;
    }
    async function copyVideo(raw, ownerId, ownerRole) {
      active();
      if (!videos) fail();
      const video = videoRecord(raw, ownerId, ownerRole, nowIso), hex = video.id.toString("hex");
      const identity = JSON.stringify([video.ownerId.toString("hex"), ownerRole, video.storageKey.toString("hex"), video.digest.toString("hex"),
        video.bytes, video.storedBytes, video.createdAt]);
      const publicVideo = { file: `media/${hex}.mp4`, type: "video/mp4", bytes: video.bytes };
      if (copiedVideos.has(hex)) { if (copiedVideos.get(hex) !== identity) fail(); return publicVideo; }
      if (video.bytes > limits.maxMediaBytes - counts.mediaBytes) fail();
      let handle, completed = false;
      try {
        handle = await videoStorage.open({ assetId: video.id, storageKey: video.storageKey }); active();
        if (!handle || handle.bytes !== video.bytes || handle.storedBytes !== video.storedBytes
          || typeof handle.stream !== "function" || typeof handle.close !== "function") fail();
        const source = (async function* () {
          let received = 0; const hash = createHash("sha256");
          active();
          for await (const chunk of handle.stream({ signal })) {
            try {
              active();
              if (!Buffer.isBuffer(chunk) || chunk.length < 1 || chunk.length > VIDEO_BLOCK_BYTES || chunk.length > video.bytes - received) fail();
              received += chunk.length; hash.update(chunk); yield chunk;
              active();
            } finally { if (Buffer.isBuffer(chunk)) chunk.fill(0); }
          }
          if (received !== video.bytes || !timingSafeEqual(hash.digest(), video.digest)) fail();
          completed = true;
        })();
        try { await writer.video(publicVideo.file, source, { bytes: video.bytes, signal }); }
        finally { await source.return(); }
        active(); if (!completed) fail();
      } finally { await handle?.close?.(); }
      copiedVideos.set(hex, identity); counts.mediaFiles += 1; counts.mediaBytes += video.bytes;
      counts.videoFiles += 1; counts.videoBytes += video.bytes;
      return publicVideo;
    }
    await writer.empty("messages.jsonl"); await writer.empty("library.jsonl");
    await json("account.json", { format: "jessiemessage-client-content", version: videos ? 2 : 1, generatedAt: new Date(now).toISOString(), user,
      conversation: selected?.output ?? null, preferences: { broadcasts }, ownProfile: profile });
    let afterSequence = "0";
    while (true) {
      active(); const current = page(await reader.messages({ afterSequence, limit: PAGE_SIZE })); active();
      for (const raw of current.rows) {
        rowBudget(); object(raw);
        const id = bytes(raw.id), conversationId = bytes(raw.conversationId), senderId = bytes(raw.senderId);
        const currentSequence = sequence(raw.sequence, true), createdAt = date(raw.createdAt), deletedAt = date(raw.deletedAt, true);
        const fingerprint = bytes(raw.fingerprint, 32), hex = id.toString("hex");
        if (!selected || !conversationId.equals(selected.id) || !["client", "admin"].includes(raw.senderRole)
          || !senderId.equals(raw.senderRole === "client" ? clientId : selected.adminId) || messageIds.has(hex)
          || BigInt(currentSequence) <= BigInt(afterSequence) || createdAt < selected.output.createdAt || createdAt > nowIso
          || deletedAt !== null && deletedAt < createdAt) fail();
        messageIds.add(hex); afterSequence = currentSequence;
        let body = null, media = null, video = null;
        const attachedVideo = raw.video !== undefined && raw.video !== null;
        if (deletedAt !== null) { if (raw.encrypted !== null || attachedVideo) fail(); }
        else {
          const binding = { messageId: id, conversationId, senderId };
          body = decryptMessageBody(raw.encrypted, key, binding);
          if (attachedVideo) {
            if (!videos || raw.media !== null || !timingSafeEqual(videoMessageFingerprint(body, key, binding), fingerprint)) fail();
            const payload = JSON.parse(body);
            if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 2
              || !Object.hasOwn(payload, "videoId") || !Object.hasOwn(payload, "caption")
              || payload.videoId !== bytes(raw.video.id).toString("hex") || typeof payload.caption !== "string" || payload.caption.length > 1000) fail();
            if (payload.caption !== "") validateMessageBody(payload.caption);
            if (JSON.stringify({ videoId: payload.videoId, caption: payload.caption }) !== body
              || date(raw.video.createdAt) > createdAt) fail();
            video = await copyVideo(raw.video, senderId, raw.senderRole); body = payload.caption;
          } else if (!timingSafeEqual(messageFingerprint(body, key, binding), fingerprint)) fail();
          if (raw.media !== null) {
            const payload = JSON.parse(body);
            if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 2
              || !Object.hasOwn(payload, "mediaId") || !Object.hasOwn(payload, "caption")
              || payload.mediaId !== bytes(raw.media.id).toString("hex") || typeof payload.caption !== "string" || payload.caption.length > 1000) fail();
            if (payload.caption !== "") validateMessageBody(payload.caption);
            if (JSON.stringify({ mediaId: payload.mediaId, caption: payload.caption }) !== body) fail();
            media = await copyMedia(raw.media, senderId, raw.senderRole); body = payload.caption;
          }
        }
        await json("messages.jsonl", { sequence: currentSequence, sender: raw.senderRole === "client" ? "me" : "peer", body, createdAt, deletedAt, media,
          ...(videos ? { video } : {}) }, true);
        counts.messages += 1;
      }
      if (current.hasMore && sequence(current.nextCursor, true) !== afterSequence) fail();
      if (!current.hasMore) break;
    }
    let afterId = null;
    while (true) {
      active(); const current = page(await reader.ownMedia({ afterId, limit: PAGE_SIZE })); active();
      for (const raw of current.rows) {
        rowBudget();
        const id = bytes(raw?.id);
        if (afterId !== null && Buffer.compare(id, afterId) <= 0) fail();
        afterId = id;
        const media = await copyMedia(raw, clientId, "client");
        await json("library.jsonl", media, true); counts.libraryItems += 1;
      }
      if (current.hasMore && !bytes(current.nextCursor).equals(afterId)) fail();
      if (!current.hasMore) break;
    }
    if (videos) {
      afterId = null;
      while (true) {
        active(); const current = page(await reader.ownVideos({ afterId, limit: PAGE_SIZE })); active();
        for (const raw of current.rows) {
          rowBudget(); const id = bytes(raw?.id);
          if (afterId !== null && Buffer.compare(id, afterId) <= 0) fail();
          afterId = id;
          const video = await copyVideo(raw, clientId, "client");
          await json("library.jsonl", video, true); counts.libraryItems += 1; counts.videoLibraryItems += 1;
        }
        if (current.hasMore && !bytes(current.nextCursor).equals(afterId)) fail();
        if (!current.hasMore) break;
      }
    }
    active();
    return counts;
  } catch { throw new DataExportError(); }
  finally { key?.fill(0); }
}
