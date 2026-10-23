import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { tokenDigest } from "../auth/crypto.mjs";
import { decryptMessageBody, encryptMessageBody, messageFingerprint, videoMessageFingerprint, validateMessageBody } from "./crypto.mjs";
import { mediaDTO } from "../media/dto.mjs";
import { peerAvatarDTO } from "./profile-avatar.mjs";

export class ChatError extends Error {
  constructor(code, retryAfter) {
    super("Private messaging could not be completed.");
    this.name = "ChatError";
    this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}
const fail = (code) => { throw new ChatError(code); };
const idBytes = (value) => {
  if (typeof value !== "string" || value.length !== 32 || !/^[a-f0-9]{32}$/.test(value)) fail("CHAT_INPUT");
  return Buffer.from(value, "hex");
};
const sequence = (value) => {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n || BigInt(value).toString() !== value) fail("CHAT_INPUT");
  return value;
};
const limitValue = (value) => { if (!Number.isInteger(value) || value < 1 || value > 100) fail("CHAT_INPUT"); return value; };
const allowedErrors = new Set(["CHAT_UNAUTHORIZED", "CHAT_FORBIDDEN", "CHAT_NOT_FOUND", "CHAT_CONFLICT", "CHAT_INPUT", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES", "AUTH_RATE_LIMIT", "CHAT_RATE_LIMIT", "AUTH_BUSY", "VIDEO_NOT_FOUND", "VIDEO_INPUT"]);

export async function createChatService({ store, authStore, authService, accessService, key, clock = Date.now, videoMessages, videoCreationEnabled = true }) {
  if (typeof videoCreationEnabled !== "boolean") throw new ChatError("CHAT_CONFIG");
  if (!Buffer.isBuffer(key) || key.length !== 32 || typeof clock !== "function") throw new ChatError("CHAT_CONFIG");
  if (videoMessages !== undefined && typeof videoMessages?.sendMessage !== "function") throw new ChatError("CHAT_CONFIG");
  for (const method of ["listConversations", "getClientConversation", "readMessages", "readEvents", "sendMessage", "markRead", "deleteMessage"]) {
    if (typeof store?.[method] !== "function") throw new ChatError("CHAT_CONFIG");
  }
  if (typeof authStore?.consumeRateLimit !== "function" || typeof authService?.session !== "function" || typeof accessService?.requireActiveClient !== "function") throw new ChatError("CHAT_CONFIG");
  async function guarded(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof ChatError) throw error;
      if (error?.code === "AUTH_INVALID") fail("CHAT_UNAUTHORIZED");
      if (allowedErrors.has(error?.code)) throw new ChatError(error.code, error.retryAfter);
      fail("CHAT_UNAVAILABLE");
    }
  }
  async function actor(role, token) {
    if (!["admin", "client"].includes(role)) fail("CHAT_INPUT");
    try { tokenDigest(token); } catch { fail("CHAT_UNAUTHORIZED"); }
    const session = await guarded(() => role === "admin" ? authService.session(token) : accessService.requireActiveClient(token));
    if (!session || session.user?.role !== role) fail("CHAT_UNAUTHORIZED");
    try { idBytes(session.user.id); } catch { fail("CHAT_UNAVAILABLE"); }
    return session;
  }
  const nowValue = () => {
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999) fail("CHAT_UNAVAILABLE");
    return now;
  };
  async function context(role, token, conversationId) {
    const conversation = idBytes(conversationId);
    const session = await actor(role, token);
    return { session, request: { role, tokenHash: tokenDigest(token), conversationId: conversation, now: nowValue() } };
  }
  function conversationDTO(row, role) {
    const avatar = peerAvatarDTO(row.peerAvatarVersion, role, row.id.toString("hex"));
    return { id: row.id.toString("hex"), client: role === "admin" ? { id: row.clientId.toString("hex"), pseudonym: row.clientPseudonym } : null,
      ...(avatar ? { peerAvatar: avatar } : {}),
      peerName: row.peerPseudonym, createdAt: row.createdAt, closedAt: row.closedAt, lastActivityAt: row.lastActivityAt ?? row.createdAt,
      latestSequence: row.latestSequence, latestEventSequence: row.latestEventSequence, lastReadSequence: row.lastReadSequence,
      // Keep the wire shape stable for existing clients, without publishing
      // the administrator's private read position on any client read path.
      peerReadSequence: role === "admin" ? row.peerReadSequence : "0", unreadCount: row.unreadCount, canSend: row.canSend };
  }
  function messageDTO(row, session) {
    const mine = row.senderId.equals(idBytes(session.user.id));
    let body = row.deletedAt === null ? decryptMessageBody(row.bodyEncrypted, key, {
      messageId: row.id, conversationId: row.conversationId, senderId: row.senderId,
    }) : null;
    let media, video;
    const binding = { messageId: row.id, conversationId: row.conversationId, senderId: row.senderId };
    if (row.media && row.video) fail("CHAT_UNAVAILABLE");
    if (row.deletedAt === null && row.video) {
      if (videoMessages === undefined || !Buffer.isBuffer(row.video.id) || row.video.id.length !== 16
        || !Number.isSafeInteger(row.video.bytes) || row.video.bytes < 1 || row.video.bytes > 104857600
        || row.video.mime !== "video/mp4" || !Buffer.isBuffer(row.bodyFingerprint) || row.bodyFingerprint.length !== 32
        || !timingSafeEqual(row.bodyFingerprint, videoMessageFingerprint(body, key, binding))) fail("CHAT_UNAVAILABLE");
      const payload = JSON.parse(body);
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 2
        || !Object.hasOwn(payload, "videoId") || !Object.hasOwn(payload, "caption")
        || payload.videoId !== row.video.id.toString("hex") || typeof payload.caption !== "string" || payload.caption.length > 1000) fail("CHAT_UNAVAILABLE");
      if (payload.caption !== "") { try { validateMessageBody(payload.caption); } catch { fail("CHAT_UNAVAILABLE"); } }
      body = payload.caption;
      const conversationId = row.conversationId.toString("hex"), messageId = row.id.toString("hex");
      video = { id: payload.videoId, bytes: row.video.bytes, mime: "video/mp4",
        contentUrl: `/api/video/${session.user.role}/conversations/${conversationId}/messages/${messageId}/content` };
    } else if (row.deletedAt === null && videoMessages !== undefined && !row.media) {
      // Missing links cannot make a typed video payload appear as plain JSON.
      if (!Buffer.isBuffer(row.bodyFingerprint) || row.bodyFingerprint.length !== 32
        || !timingSafeEqual(row.bodyFingerprint, messageFingerprint(body, key, binding))) fail("CHAT_UNAVAILABLE");
    }
    if (row.deletedAt === null && row.media) {
      const payload = JSON.parse(body);
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length !== 2
        || !Object.hasOwn(payload, "mediaId") || !Object.hasOwn(payload, "caption")
        || payload.mediaId !== row.media.id.toString("hex") || typeof payload.caption !== "string" || payload.caption.length > 1000) fail("CHAT_UNAVAILABLE");
      if (payload.caption !== "") { try { validateMessageBody(payload.caption); } catch { fail("CHAT_UNAVAILABLE"); } }
      body = payload.caption;
      media = mediaDTO({ ...row.media, createdAt: row.createdAt, sharedHere: true }, session.user.role, {
        conversationId: row.conversationId.toString("hex"), messageId: row.id.toString("hex"),
      });
    }
    return { id: row.id.toString("hex"), sequence: row.sequence, sender: mine ? "me" : "peer", body,
      ...(media ? { media } : {}),
      ...(video ? { video } : {}),
      createdAt: row.createdAt, deletedAt: row.deletedAt, clientMessageId: mine ? row.clientMessageId.toString("hex") : null };
  }
  async function mutationLimit(userId, kind, now) {
    // A personal refusal must not consume the shared allowance used by other
    // conversations and the broadcasts worker. Keep those persisted buckets.
    const budgets = kind === "send" ? [["user-send", userId, 30], ["global-send", "all", 300]] : [["user-update", userId, 120]];
    for (const [name, identity, limit] of budgets) {
      const bucket = createHmac("sha256", key).update("jessiemessage:chat-rate:v1:").update(name).update("\0").update(identity).digest();
      const result = await authStore.consumeRateLimit(bucket, { now, windowSeconds: 60, limit });
      if (!result.allowed) throw new ChatError("CHAT_RATE_LIMIT", result.retryAfter);
    }
  }
  async function readLimit(userId, now, role) {
    // Polling, history pages and event catch-up share one read allowance for
    // the authenticated account. Eight visible admin devices use about 192
    // reads/minute (events every 3s plus inbox/tail every 30s). A 480
    // allowance leaves room for histories and catch-up without removing the
    // persisted per-account ceiling. Hidden tabs do not poll. Session proofs
    // do not consume this budget. Client accounts keep their smaller ceiling.
    for (const [name, identity, limit] of [["user-read", userId, role === "admin" ? 480 : 120], ["global-read", "all", 2400]]) {
      const bucket = createHmac("sha256", key).update("jessiemessage:chat-rate:v1:").update(name).update("\0").update(identity).digest();
      const result = await authStore.consumeRateLimit(bucket, { now, windowSeconds: 60, limit });
      if (!result || typeof result.allowed !== "boolean") fail("CHAT_UNAVAILABLE");
      if (!result.allowed) throw new ChatError("CHAT_RATE_LIMIT", Number.isFinite(result.retryAfter)
        ? Math.max(1, Math.min(60, Math.ceil(result.retryAfter))) : 60);
    }
  }
  return Object.freeze({
    actor: (role, token) => guarded(() => actor(role, token)),
    listConversations: (token, { afterId = null, limit = 50 } = {}) => guarded(async () => {
      limitValue(limit); const after = afterId === null ? null : idBytes(afterId);
      const session = await actor("admin", token), now = nowValue();
      await readLimit(session.user.id, now, session.user.role);
      const result = await store.listConversations({ tokenHash: tokenDigest(token), now: nowValue(), afterId: after, limit });
      return { conversations: result.conversations.map((row) => conversationDTO(row, "admin")), nextCursor: result.nextCursor?.toString("hex") ?? null, hasMore: result.hasMore };
    }),
    clientConversation: (token) => guarded(async () => {
      const session = await actor("client", token), now = nowValue();
      await readLimit(session.user.id, now, session.user.role);
      const row = await store.getClientConversation({ tokenHash: tokenDigest(token), now: nowValue() });
      if (!row) fail("CHAT_NOT_FOUND");
      return conversationDTO(row, "client");
    }),
    messages: (role, token, conversationId, { before = null, after = null, limit = 50 } = {}) => guarded(async () => {
      if (before !== null) sequence(before); if (after !== null) sequence(after);
      if (before !== null && after !== null) fail("CHAT_INPUT"); limitValue(limit);
      const { session, request } = await context(role, token, conversationId);
      await readLimit(session.user.id, request.now, session.user.role);
      const result = await store.readMessages({ ...request, now: nowValue(), before, after, limit });
      return { conversation: conversationDTO(result.conversation, role), messages: result.messages.map((row) => messageDTO(row, session)),
        hasMoreBefore: result.hasMoreBefore, hasMoreAfter: result.hasMoreAfter, nextBefore: result.nextBefore, nextAfter: result.nextAfter, eventCursor: result.eventCursor };
    }),
    events: (role, token, conversationId, { after = "0", limit = 100 } = {}) => guarded(async () => {
      sequence(after); limitValue(limit);
      const { session, request } = await context(role, token, conversationId);
      await readLimit(session.user.id, request.now, session.user.role);
      const result = await store.readEvents({ ...request, now: nowValue(), after, limit });
      return { conversation: conversationDTO(result.conversation, role), events: result.events.map((event) => ({ sequence: event.sequence,
        kind: event.kind, occurredAt: event.occurredAt, message: messageDTO(event.message, session) })), nextCursor: result.nextCursor, hasMore: result.hasMore };
    }),
    send: (role, token, conversationId, input) => guarded(async () => {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((name) => !["clientMessageId", "body"].includes(name))) fail("CHAT_INPUT");
      const { clientMessageId, body } = input;
      validateMessageBody(body); const clientId = idBytes(clientMessageId);
      const { session, request } = await context(role, token, conversationId);
      await mutationLimit(session.user.id, "send", request.now);
      const id = randomBytes(16), senderId = idBytes(session.user.id);
      const binding = { messageId: id, conversationId: request.conversationId, senderId };
      const result = await store.sendMessage({ ...request, now: nowValue(), message: { id, clientMessageId: clientId,
        bodyEncrypted: encryptMessageBody(body, key, binding), bodyFingerprint: messageFingerprint(body, key, binding) } });
      return { message: messageDTO(result.message, session), duplicate: result.duplicate };
    }),
    sendImage: (role, token, conversationId, input) => guarded(async () => {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((name) => !["clientMessageId", "mediaId", "caption"].includes(name))) fail("CHAT_INPUT");
      const { clientMessageId, mediaId, caption } = input;
      const clientId = idBytes(clientMessageId), assetId = idBytes(mediaId);
      if (typeof caption !== "string" || caption.length > 1000) fail("CHAT_INPUT");
      if (caption !== "") validateMessageBody(caption);
      const { session, request } = await context(role, token, conversationId);
      await mutationLimit(session.user.id, "send", request.now);
      const messageId = randomBytes(16), senderId = idBytes(session.user.id);
      const body = JSON.stringify({ mediaId, caption });
      const binding = { messageId, conversationId: request.conversationId, senderId };
      const result = await store.sendMessage({ ...request, now: nowValue(), message: { id: messageId, clientMessageId: clientId, mediaId: assetId,
        bodyEncrypted: encryptMessageBody(body, key, binding), bodyFingerprint: messageFingerprint(body, key, binding) } });
      return { message: messageDTO(result.message, session), duplicate: result.duplicate };
    }),
    ...(videoMessages === undefined ? {} : {
      sendVideo: (role, token, conversationId, input) => guarded(async () => {
        if (!input || typeof input !== "object" || Array.isArray(input)
          || Object.keys(input).length !== 3 || !["clientMessageId", "videoId", "caption"].every((name) => Object.hasOwn(input, name))) fail("CHAT_INPUT");
        const { clientMessageId, videoId, caption } = input;
        const clientId = idBytes(clientMessageId), assetId = idBytes(videoId);
        if (typeof caption !== "string" || caption.length > 1000) fail("CHAT_INPUT");
        if (caption !== "") validateMessageBody(caption);
        const { session, request } = await context(role, token, conversationId);
        if (role !== "admin") fail("CHAT_FORBIDDEN");
        if (!videoCreationEnabled) fail("CHAT_READ_ONLY");
        await mutationLimit(session.user.id, "send", request.now);
        const messageId = randomBytes(16), senderId = idBytes(session.user.id);
        const body = JSON.stringify({ videoId, caption });
        const binding = { messageId, conversationId: request.conversationId, senderId };
        const result = await videoMessages.sendMessage({ ...request, now: nowValue(), message: {
          id: messageId, clientMessageId: clientId, videoId: assetId,
          bodyEncrypted: encryptMessageBody(body, key, binding), bodyFingerprint: videoMessageFingerprint(body, key, binding),
        } });
        return { message: messageDTO(result.message, session), duplicate: result.duplicate };
      }),
    }),
    markRead: (role, token, conversationId, input) => guarded(async () => {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((name) => name !== "throughSequence")) fail("CHAT_INPUT");
      const { throughSequence } = input;
      sequence(throughSequence);
      const { session, request } = await context(role, token, conversationId);
      await mutationLimit(session.user.id, "update", request.now);
      return store.markRead({ ...request, now: nowValue(), through: throughSequence });
    }),
    delete: (role, token, conversationId, messageId) => guarded(async () => {
      const message = idBytes(messageId);
      const { session, request } = await context(role, token, conversationId);
      await mutationLimit(session.user.id, "update", request.now);
      return messageDTO(await store.deleteMessage({ ...request, now: nowValue(), messageId: message }), session);
    }),
  });
}
