import { createClientConversationExportHandler } from "./client-export-http.mjs";
import { CLIENT_ADMISSION_POLICY } from "../access/admission.mjs";
import { readFile } from "node:fs/promises";
import { checkMutation, clearCookie, hasSessionCookie, httpError, isToken, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";
import { validateMessageBody } from "./crypto.mjs";
import { safePeerAvatar } from "./profile-avatar.mjs";

const publicRoot = new URL("../../public/", import.meta.url);
const cookies = Object.freeze({ admin: "__Host-jessie_session", client: "__Host-jessie_client" });
const files = new Map([
  ["/chat.js", ["chat.js", "text/javascript; charset=utf-8"]],
  ["/chat-model.js", ["chat-model.js", "text/javascript; charset=utf-8"]],
  ["/quick-replies.js", ["quick-replies.js", "text/javascript; charset=utf-8"]],
  ["/chat.css", ["chat.css", "text/css; charset=utf-8"]],
]);
const ID = /^[a-f0-9]{32}$/;
const SEQUENCE = /^(?:0|[1-9][0-9]{0,19})$/;
const MAX_SEQUENCE = 18446744073709551615n;
const unavailable = () => httpError(503, "messaging_unavailable");
const invalid = () => httpError(400, "invalid_request");

function id(value) { return typeof value === "string" && value.length === 32 && ID.test(value); }
function sequence(value, positive = false) {
  return typeof value === "string" && SEQUENCE.test(value) && BigInt(value).toString() === value
    && BigInt(value) <= MAX_SEQUENCE && (!positive || value !== "0");
}
function date(value) { return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000; }
function nullableDate(value) { return value === null || date(value); }
function text(value, max = 64) { return typeof value === "string" && value.length <= max && value.isWellFormed(); }

function safeActor(value, role) {
  const user = value?.user;
  if (!user || !id(user.id) || user.role !== role || !text(user.pseudonym)
    || !date(value.expiresAt) || !isToken(value.csrf)) throw unavailable();
  // The service enforces current access prerequisites. An explicit inactive
  // access state from any alternate service implementation also fails closed.
  if (role === "client" && (!value.access || value.access.state !== "active" || value.access.admissionPolicy !== CLIENT_ADMISSION_POLICY
    || ["emailVerified", "invitationConsumed", "approved"].some((key) => value.access[key] !== true))) {
    throw httpError(403, "request_rejected");
  }
  return { user: { id: user.id, role, pseudonym: user.pseudonym }, csrf: value.csrf, expiresAt: value.expiresAt };
}

function safeConversation(value, role, expectedId = null) {
  if (!value || !id(value.id) || expectedId !== null && value.id !== expectedId || !text(value.peerName) || !date(value.createdAt)
    || !nullableDate(value.closedAt) || !date(value.lastActivityAt)
    || !["latestSequence", "latestEventSequence", "lastReadSequence", "peerReadSequence"].every((key) => sequence(value[key]))
    || !Number.isSafeInteger(value.unreadCount) || value.unreadCount < 0 || typeof value.canSend !== "boolean"
    || value.closedAt !== null && (value.closedAt < value.createdAt || value.canSend)
    || value.lastActivityAt < value.createdAt
    || BigInt(value.lastReadSequence) > BigInt(value.latestSequence)
    || BigInt(value.peerReadSequence) > BigInt(value.latestSequence)) throw unavailable();
  let client = null;
  if (role === "admin") {
    if (!value.client || !id(value.client.id) || !text(value.client.pseudonym)) throw unavailable();
    client = { id: value.client.id, pseudonym: value.client.pseudonym };
  } else if (value.client !== null) throw unavailable();
  let avatar;
  try { avatar = safePeerAvatar(value.peerAvatar, role, value.id); } catch { throw unavailable(); }
  return {
    ...(avatar ? { peerAvatar: avatar } : {}),
    id: value.id, client, peerName: value.peerName, createdAt: value.createdAt, closedAt: value.closedAt,
    lastActivityAt: value.lastActivityAt, latestSequence: value.latestSequence, latestEventSequence: value.latestEventSequence,
    lastReadSequence: value.lastReadSequence, peerReadSequence: role === "admin" ? value.peerReadSequence : "0", unreadCount: value.unreadCount, canSend: value.canSend,
  };
}

/** Validate media metadata and rebuild the only URLs this role may consume. */
export function safeMedia(value, { role, conversationId = null, messageId = null } = {}) {
  const integer = (field, maximum) => Number.isSafeInteger(value?.[field]) && value[field] >= 1 && value[field] <= maximum;
  if (!["admin", "client"].includes(role) || !value || !id(value.id)
    || !integer("width", 2048) || !integer("height", 2048)
    || !integer("thumbnailWidth", 480) || !integer("thumbnailHeight", 480)
    || !integer("bytes", 10485760) || !integer("thumbnailBytes", 524288)
    || !date(value.createdAt) || typeof value.sharedHere !== "boolean"
    || (conversationId === null) !== (messageId === null)
    || conversationId !== null && (!id(conversationId) || !id(messageId) || value.sharedHere !== true)) throw unavailable();
  const base = conversationId === null ? `/api/media/${role}/assets/${value.id}`
    : `/api/media/${role}/conversations/${conversationId}/messages/${messageId}`;
  if (value.fullUrl !== `${base}/full` || value.thumbnailUrl !== `${base}/thumb`) throw unavailable();
  return { id: value.id, width: value.width, height: value.height,
    thumbnailWidth: value.thumbnailWidth, thumbnailHeight: value.thumbnailHeight,
    bytes: value.bytes, thumbnailBytes: value.thumbnailBytes, createdAt: value.createdAt,
    sharedHere: value.sharedHere, fullUrl: `${base}/full`, thumbnailUrl: `${base}/thumb` };
}

export function safeVideo(value, { role, conversationId, messageId } = {}) {
  if (!value || !id(value.id) || !["admin", "client"].includes(role) || !id(conversationId) || !id(messageId)
    || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > 104857600 || value.mime !== "video/mp4") throw unavailable();
  const contentUrl = `/api/video/${role}/conversations/${conversationId}/messages/${messageId}/content`;
  if (value.contentUrl !== contentUrl) throw unavailable();
  return { id: value.id, bytes: value.bytes, mime: "video/mp4", contentUrl };
}

export function safeMessage(value, context = {}) {
  if (!value || !id(value.id) || !sequence(value.sequence, true) || !["me", "peer"].includes(value.sender)
    || !date(value.createdAt) || !nullableDate(value.deletedAt)
    || !(value.clientMessageId === null || id(value.clientMessageId))
    || value.sender === "peer" && value.clientMessageId !== null
    || value.deletedAt !== null && (value.deletedAt < value.createdAt || value.body !== null)) throw unavailable();
  let media, video;
  if (value.deletedAt === null) {
    if (value.media !== undefined && value.video !== undefined) throw unavailable();
    if (value.video !== undefined) {
      video = safeVideo(value.video, { ...context, messageId: value.id });
      if (typeof value.body !== "string" || value.body.length > 1000) throw unavailable();
      if (value.body !== "") { try { validateMessageBody(value.body); } catch { throw unavailable(); } }
    } else if (value.media !== undefined) {
      media = safeMedia(value.media, { ...context, messageId: value.id });
      if (typeof value.body !== "string" || value.body.length > 1000) throw unavailable();
      if (value.body !== "") { try { validateMessageBody(value.body); } catch { throw unavailable(); } }
    } else { try { validateMessageBody(value.body); } catch { throw unavailable(); } }
  } else if (value.media !== undefined && value.media !== null || value.deletedAt !== null && value.video !== undefined && value.video !== null) throw unavailable();
  return { id: value.id, sequence: value.sequence, sender: value.sender, body: value.body,
    createdAt: value.createdAt, deletedAt: value.deletedAt, clientMessageId: value.clientMessageId,
    ...(media ? { media } : {}), ...(video ? { video } : {}) };
}

function shape(body, keys) {
  if (Object.keys(body).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(body, key))) throw invalid();
  return body;
}

function query(url, allowed, defaultLimit) {
  const values = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(values, key)) throw invalid();
    values[key] = value;
  }
  if (defaultLimit !== undefined) {
    const limit = values.limit;
    if (limit !== undefined && (!/^(?:[1-9][0-9]?|100)$/.test(limit) || String(Number(limit)) !== limit)) throw invalid();
    values.limit = limit === undefined ? defaultLimit : Number(limit);
  }
  return values;
}

function matchedRoute(pathname) {
  if (files.has(pathname)) return { kind: "asset", methods: ["GET", "HEAD"] };
  if (pathname === "/messages" || pathname === "/admin/messages") {
    return { kind: "page", role: pathname === "/messages" ? "client" : "admin", methods: ["GET", "HEAD"] };
  }
  const capability = /^\/api\/chat\/(admin|client)\/capabilities$/.exec(pathname);
  if (capability) return { kind: "capabilities", role: capability[1], methods: ["GET"] };
  if (pathname === "/api/chat/admin/conversations") return { kind: "list", role: "admin", methods: ["GET"] };
  if (pathname === "/api/chat/client/conversation") return { kind: "conversation", role: "client", methods: ["GET"] };
  const match = /^\/api\/chat\/(admin|client)\/conversations\/([a-f0-9]{32})\/(messages|events|read)(?:\/([a-f0-9]{32})\/delete)?$/.exec(pathname);
  if (!match || match[4] && match[3] !== "messages") return null;
  return { kind: match[4] ? "delete" : match[3], role: match[1], conversationId: match[2], messageId: match[4],
    methods: match[4] || match[3] === "read" ? ["POST"] : match[3] === "messages" ? ["GET", "POST"] : ["GET"] };
}

function mappedError(error) {
  // Only this module's bounded HTTP errors are intentionally public. Unexpected
  // database or service exceptions never disclose their message or properties.
  if (Number.isInteger(error?.httpStatus) && [400, 403, 408, 413, 415, 503].includes(error.httpStatus)
    && ["invalid_request", "request_rejected", "csrf_failed", "request_timeout", "request_too_large", "json_required", "messaging_unavailable"].includes(error.publicCode)) {
    return { status: error.httpStatus, code: error.publicCode };
  }
  if (["CHAT_UNAUTHORIZED", "AUTH_INVALID"].includes(error?.code)) return { status: 401, code: "authentication_required" };
  if (["CHAT_FORBIDDEN", "ACCESS_FORBIDDEN", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"].includes(error?.code)) return { status: 403, code: "request_rejected" };
  if (error?.code === "CHAT_NOT_FOUND") return { status: 404, code: "not_found" };
  if (error?.code === "CHAT_CONFLICT") return { status: 409, code: "message_conflict" };
  if (error?.code === "CHAT_INPUT") return { status: 400, code: "invalid_request" };
  if (["AUTH_RATE_LIMIT", "CHAT_RATE_LIMIT", "AUTH_BUSY"].includes(error?.code)) {
    const retry = Number(error.retryAfter);
    return { status: 429, code: "try_again_later", retry: Number.isFinite(retry) ? Math.max(1, Math.min(3600, Math.ceil(retry))) : 60 };
  }
  return { status: 503, code: "messaging_unavailable" };
}

/** Routes exist only when the parent has explicitly enabled the chat feature. */
export function createChatHandler(service, { origin, clientConversationExporter = null, profileEnabled = false, avatarsEnabled = false, announcementsEnabled = false, tasksEnabled = false }) {
  if (typeof profileEnabled !== "boolean" || typeof avatarsEnabled !== "boolean" || avatarsEnabled && !profileEnabled
    || typeof announcementsEnabled !== "boolean" || typeof tasksEnabled !== "boolean") throw new TypeError("Invalid chat capability");
  const configuredOrigin = new URL(origin);
  if (configuredOrigin.protocol !== "https:" || configuredOrigin.origin !== origin) throw new TypeError("A canonical HTTPS site origin is required");
  for (const method of ["actor", "listConversations", "clientConversation", "messages", "events", "send", "markRead", "delete"]) {
    if (typeof service?.[method] !== "function") throw new TypeError("A messaging service is required");
  }
  const clientExport = createClientConversationExportHandler({ actor: async token => { const value = await service.actor("client", token); return value ? safeActor(value, "client") : null; },
    conversation: async token => safeConversation(await service.clientConversation(token), "client") }, { origin, conversationExporter: clientConversationExporter });
  const handler = async (request, response) => {
    if (await clientExport(request, response)) return true;
    let url;
    try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const pathname = url.pathname;
    const route = matchedRoute(pathname);
    if (!route) return false;
    const method = request.method ?? "GET";
    if (!route.methods.includes(method)) {
      reply(response, method, 405, { error: "method_not_allowed" }, { Allow: route.methods.join(", ") });
      return true;
    }
    try {
      if (route.kind === "asset") {
        query(url, []);
        const [name, type] = files.get(pathname);
        reply(response, method, 200, await readFile(new URL(name, publicRoot)), { "Content-Type": type });
        return true;
      }
      if (method === "POST") checkMutation(request, origin, pathname, false);
      const token = sessionToken(request, cookies[route.role]);
      const actor = token ? await service.actor(route.role, token) : null;
      if (!actor) {
        const headers = method === "POST" || hasSessionCookie(request, cookies[route.role]) ? { "Set-Cookie": clearCookie(cookies[route.role]) } : {};
        if (route.kind === "page") reply(response, method, 303, "", { Location: route.role === "admin" ? "/admin/login" : "/access", ...headers });
        else reply(response, method, 401, { error: "authentication_required" }, headers);
        return true;
      }
      const authenticated = safeActor(actor, route.role);
      if (method === "POST" && !sameText(request.headers["x-csrf-token"], authenticated.csrf)) throw httpError(403, "csrf_failed");
      if (route.kind === "page") {
        query(url, []);
        reply(response, method, 200, await readFile(new URL("chat.html", publicRoot)), { "Content-Type": "text/html; charset=utf-8" });
      } else if (route.kind === "capabilities") {
        query(url, []);
        reply(response, method, 200, { enabled: true, ...(profileEnabled ? { profile: { enabled: true, avatars: avatarsEnabled } } : {}), ...(announcementsEnabled ? { announcements: { enabled: true } } : {}), ...(tasksEnabled && route.role === "admin" ? { tasks: { enabled: true } } : {}), ...(route.role === "client" && clientConversationExporter ? { conversationExport: { enabled: true, photos: clientConversationExporter.photos, maxBytes: clientConversationExporter.maxBytes, ...(clientConversationExporter.videos === true ? { videos: true } : {}) } } : {}) });
      } else if (route.kind === "list") {
        const options = query(url, ["afterId", "limit"], 50);
        const afterId = options.afterId ?? null;
        if (afterId !== null && !id(afterId)) throw invalid();
        const result = await service.listConversations(token, { afterId, limit: options.limit });
        if (!result || !Array.isArray(result.conversations) || result.conversations.length > options.limit
          || typeof result.hasMore !== "boolean" || !(result.nextCursor === null || id(result.nextCursor))) throw unavailable();
        const conversations = result.conversations.map((value) => safeConversation(value, route.role));
        reply(response, method, 200, { conversations, nextCursor: result.nextCursor, hasMore: result.hasMore });
      } else if (route.kind === "conversation") {
        query(url, []);
        reply(response, method, 200, safeConversation(await service.clientConversation(token), route.role));
      } else if (route.kind === "messages" && method === "GET") {
        const options = query(url, ["before", "after", "limit"], 50);
        const before = options.before ?? null, after = options.after ?? null;
        if (before !== null && !sequence(before) || after !== null && !sequence(after) || before !== null && after !== null) throw invalid();
        const result = await service.messages(route.role, token, route.conversationId, { before, after, limit: options.limit });
        if (!result || !Array.isArray(result.messages) || result.messages.length > options.limit
          || ["hasMoreBefore", "hasMoreAfter"].some((key) => typeof result[key] !== "boolean")
          || ["nextBefore", "nextAfter"].some((key) => !(result[key] === null || sequence(result[key])))
          || !sequence(result.eventCursor)) throw unavailable();
        reply(response, method, 200, { conversation: safeConversation(result.conversation, route.role, route.conversationId), messages: result.messages.map((value) => safeMessage(value, { role: route.role, conversationId: route.conversationId })),
          hasMoreBefore: result.hasMoreBefore, hasMoreAfter: result.hasMoreAfter, nextBefore: result.nextBefore, nextAfter: result.nextAfter, eventCursor: result.eventCursor });
      } else if (route.kind === "events") {
        const options = query(url, ["after", "limit"], 100);
        const after = options.after ?? "0";
        if (!sequence(after)) throw invalid();
        const result = await service.events(route.role, token, route.conversationId, { after, limit: options.limit });
        if (!result || !Array.isArray(result.events) || result.events.length > options.limit || !sequence(result.nextCursor)
          || typeof result.hasMore !== "boolean" || BigInt(result.nextCursor) < BigInt(after)) throw unavailable();
        let last = BigInt(after);
        const events = result.events.map((value) => {
          if (!value || !sequence(value.sequence, true) || BigInt(value.sequence) <= last
            || !["message", "delete"].includes(value.kind) || !date(value.occurredAt)) throw unavailable();
          last = BigInt(value.sequence);
          const message = safeMessage(value.message, { role: route.role, conversationId: route.conversationId });
          if (value.kind === "delete" && message.deletedAt === null) throw unavailable();
          return { sequence: value.sequence, kind: value.kind, occurredAt: value.occurredAt, message };
        });
        if (last !== BigInt(result.nextCursor)) throw unavailable();
        reply(response, method, 200, { conversation: safeConversation(result.conversation, route.role, route.conversationId), events, nextCursor: result.nextCursor, hasMore: result.hasMore });
      } else if (route.kind === "messages") {
        query(url, []);
        const body = shape(await readJson(request, { maxBytes: 32768 }), ["clientMessageId", "body"]);
        if (!id(body.clientMessageId)) throw invalid();
        validateMessageBody(body.body);
        const result = await service.send(route.role, token, route.conversationId, body);
        if (!result || typeof result.duplicate !== "boolean") throw unavailable();
        reply(response, method, result.duplicate ? 200 : 201, { message: safeMessage(result.message, { role: route.role, conversationId: route.conversationId }), duplicate: result.duplicate });
      } else if (route.kind === "read") {
        query(url, []);
        const body = shape(await readJson(request), ["throughSequence"]);
        if (!sequence(body.throughSequence)) throw invalid();
        const result = await service.markRead(route.role, token, route.conversationId, body);
        if (!result || !sequence(result.lastReadSequence)) throw unavailable();
        reply(response, method, 200, { lastReadSequence: result.lastReadSequence });
      } else {
        query(url, []);
        shape(await readJson(request), []);
        reply(response, method, 200, { message: safeMessage(await service.delete(route.role, token, route.conversationId, route.messageId), { role: route.role, conversationId: route.conversationId }) });
      }
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const { status, code, retry } = mappedError(error);
        const headers = retry ? { "Retry-After": String(retry) } : {};
        if (status === 401 && route.role && (method === "POST" || hasSessionCookie(request, cookies[route.role]))) headers["Set-Cookie"] = clearCookie(cookies[route.role]);
        if (route.kind === "page" && [401, 403].includes(status)) {
          reply(response, method, 303, "", { ...headers, Location: route.role === "admin" ? "/admin/login" : "/access" });
        } else {
          if ([400, 408, 413].includes(status)) { headers.Connection = "close"; request.resume(); }
          reply(response, method, status, { error: code }, headers);
        }
      }
    }
    return true;
  };
  return Object.assign(handler, { close: () => clientExport.close() });
}
