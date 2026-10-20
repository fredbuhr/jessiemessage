import { CLIENT_ADMISSION_POLICY } from "../access/admission.mjs";
import { checkMutation, clearCookie, hasSessionCookie, httpError, isToken, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";
import { safeMedia, safeMessage } from "../chat/http.mjs";
import { validateMessageBody } from "../chat/crypto.mjs";

const MAX_UPLOAD_BYTES = 10485760;
const MAX_ACTIVE_BINARY_READS = 8;
let activeBinaryReads = 0;
const FORMATS = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
const COOKIES = Object.freeze({ admin: "__Host-jessie_session", client: "__Host-jessie_client" });
const MAX_SEQUENCE = 18446744073709551615n;
const unavailable = () => httpError(503, "media_unavailable");
const invalid = () => httpError(400, "invalid_request");
const id = (value) => typeof value === "string" && value.length === 32 && /^[a-f0-9]{32}$/.test(value);
const date = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
const sequence = (value, positive = false) => typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/.test(value)
  && BigInt(value).toString() === value && BigInt(value) <= MAX_SEQUENCE && (!positive || value !== "0");

function safeActor(value, role) {
  if (!value?.user || !id(value.user.id) || value.user.role !== role
    || typeof value.user.pseudonym !== "string" || value.user.pseudonym.length > 64 || !value.user.pseudonym.isWellFormed()
    || !date(value.expiresAt) || !isToken(value.csrf)) throw unavailable();
  if (role === "client" && (!value.access || value.access.state !== "active" || value.access.admissionPolicy !== CLIENT_ADMISSION_POLICY
    || ["emailVerified", "invitationConsumed", "approved"].some((key) => value.access[key] !== true))) throw httpError(403, "request_rejected");
  return { csrf: value.csrf };
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
    if (values.limit !== undefined && (!/^(?:[1-9][0-9]?|100)$/.test(values.limit) || String(Number(values.limit)) !== values.limit)) throw invalid();
    values.limit = values.limit === undefined ? defaultLimit : Number(values.limit);
  }
  return values;
}

function routeFor(pathname) {
  let match = /^\/api\/media\/(admin|client)\/(capabilities|assets)$/.exec(pathname);
  if (match) return { role: match[1], kind: match[2], methods: match[2] === "assets" ? ["GET", "POST"] : ["GET"] };
  match = /^\/api\/media\/(admin|client)\/assets\/([a-f0-9]{32})\/(delete|full|thumb)$/.exec(pathname);
  if (match) return { role: match[1], kind: match[3] === "delete" ? "delete" : "ownedBytes", assetId: match[2], variant: match[3], methods: match[3] === "delete" ? ["POST"] : ["GET", "HEAD"] };
  match = /^\/api\/media\/(admin|client)\/conversations\/([a-f0-9]{32})\/(gallery|messages)(?:\/([a-f0-9]{32})\/(full|thumb))?$/.exec(pathname);
  if (!match || match[3] === "gallery" && match[4]) return null;
  if (match[3] === "gallery") return { role: match[1], kind: "gallery", conversationId: match[2], methods: ["GET"] };
  return { role: match[1], kind: match[4] ? "deliveryBytes" : "send", conversationId: match[2], messageId: match[4], variant: match[5], methods: match[4] ? ["GET", "HEAD"] : ["POST"] };
}

function checkUploadHeaders(request, origin) {
  if (request.headers.origin !== origin) throw httpError(403, "request_rejected");
  const site = request.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") throw httpError(403, "request_rejected");
  if (!FORMATS.includes(request.headers["content-type"])) throw httpError(415, "media_format");
  if (request.headers["content-encoding"] !== undefined && request.headers["content-encoding"] !== "identity") throw httpError(415, "media_format");
}

function matchesDeclaredFormat(bytes, type) {
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return type === "image/webp" && bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

/** The caller authenticates the role and CSRF before this attaches a body reader. */
export function readUpload(request) {
  if (request.aborted || request.destroyed) throw invalid();
  const declared = request.headers["content-length"];
  if (declared !== undefined) {
    if (typeof declared !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(declared) || !Number.isSafeInteger(Number(declared))) throw invalid();
    if (Number(declared) > MAX_UPLOAD_BYTES) throw httpError(413, "request_too_large");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0, done = false;
    let block = null, blockBytes = 0;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
      if (error && !request.complete) request.once("error", () => {});
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk) => {
      if (!Buffer.isBuffer(chunk)) { finish(invalid()); return; }
      bytes += chunk.length;
      if (bytes > MAX_UPLOAD_BYTES) finish(httpError(413, "request_too_large"));
      else {
        // Tiny transport chunks must not create millions of retained objects.
        // Fixed blocks keep both retained bytes and object count bounded.
        let offset = 0;
        while (offset < chunk.length) {
          if (block === null) block = Buffer.allocUnsafe(65536);
          const count = Math.min(block.length - blockBytes, chunk.length - offset);
          chunk.copy(block, blockBytes, offset, offset + count);
          blockBytes += count; offset += count;
          if (blockBytes === block.length) { chunks.push(block); block = null; blockBytes = 0; }
        }
      }
    };
    const onEnd = () => {
      if (bytes < 1 || declared !== undefined && bytes !== Number(declared)) finish(invalid());
      else { if (blockBytes) chunks.push(block.subarray(0, blockBytes)); finish(null, Buffer.concat(chunks, bytes)); }
    };
    const onError = () => finish(invalid());
    const onAborted = () => finish(invalid());
    // Keep a hard overall body budget, with enough time for a phone upload.
    // The account/global upload admission still bounds concurrent readers.
    const timer = setTimeout(() => finish(httpError(408, "request_timeout")), 30_000);
    timer.unref();
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
  });
}

function mappedError(error) {
  if (Number.isInteger(error?.httpStatus) && [400, 403, 408, 413, 415, 503].includes(error.httpStatus)
    && ["invalid_request", "request_rejected", "csrf_failed", "request_timeout", "request_too_large", "json_required", "media_format", "media_unavailable", "messaging_unavailable"].includes(error.publicCode)) return { status: error.httpStatus, code: error.publicCode };
  if (["CHAT_UNAUTHORIZED", "AUTH_INVALID"].includes(error?.code)) return { status: 401, code: "authentication_required" };
  if (["CHAT_FORBIDDEN", "ACCESS_FORBIDDEN", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"].includes(error?.code)) return { status: 403, code: "request_rejected" };
  if (["CHAT_NOT_FOUND", "MEDIA_NOT_FOUND"].includes(error?.code)) return { status: 404, code: "not_found" };
  if (error?.code === "MEDIA_IN_USE") return { status: 409, code: "media_in_use" };
  if (error?.code === "CHAT_CONFLICT") return { status: 409, code: "message_conflict" };
  if (["CHAT_INPUT", "MEDIA_INPUT"].includes(error?.code)) return { status: 400, code: "invalid_request" };
  if (error?.code === "MEDIA_FORMAT") return { status: 415, code: "media_format" };
  if (error?.code === "MEDIA_DIMENSIONS") return { status: 422, code: "media_dimensions" };
  if (error?.code === "MEDIA_STORAGE_LIMIT") return { status: 507, code: "storage_limit" };
  if (["AUTH_RATE_LIMIT", "CHAT_RATE_LIMIT", "MEDIA_RATE_LIMIT", "AUTH_BUSY", "MEDIA_BUSY"].includes(error?.code)) {
    const retry = Number(error.retryAfter);
    return { status: 429, code: "try_again_later", retry: Number.isFinite(retry) ? Math.max(1, Math.min(3600, Math.ceil(retry))) : 60 };
  }
  return { status: 503, code: "media_unavailable" };
}

function bytesReply(response, method, result, variant) {
  const limit = variant === "thumb" ? 524288 : MAX_UPLOAD_BYTES;
  if (!result || !Buffer.isBuffer(result.bytes) || result.bytes.length < 1 || result.bytes.length > limit || result.mime !== "image/jpeg") throw unavailable();
  reply(response, method, 200, result.bytes, {
    "Content-Type": "image/jpeg", "Content-Length": String(result.bytes.length),
    "Content-Disposition": 'inline; filename="photo.jpg"', "Accept-Ranges": "none",
  });
}

function reserveBinaryRead(response) {
  if (activeBinaryReads >= MAX_ACTIVE_BINARY_READS) throw Object.assign(new Error("MEDIA_BUSY"), { code: "MEDIA_BUSY", retryAfter: 5 });
  activeBinaryReads += 1;
  let operationDone = false, responseDone = response.writableFinished || response.destroyed, released = false;
  const onTimeout = () => response.destroy();
  const releaseIfComplete = () => {
    // A closed socket does not cancel an outstanding filesystem operation.
    // Retain its slot until that operation has also settled.
    if (released || !operationDone || !responseDone) return;
    released = true;
    activeBinaryReads -= 1;
    response.off("finish", onResponseDone);
    response.off("close", onResponseDone);
    response.off("timeout", onTimeout);
    if (response.socket && !response.socket.destroyed) response.setTimeout(0);
  };
  const onResponseDone = () => { responseDone = true; releaseIfComplete(); };
  response.once("finish", onResponseDone);
  response.once("close", onResponseDone);
  response.setTimeout(15000, onTimeout);
  return () => { operationDone = true; releaseIfComplete(); };
}

/** Parent registration is the feature flag: no media route exists by default. */
export function createMediaHandler(service, { origin }) {
  const configured = new URL(origin);
  if (configured.protocol !== "https:" || configured.origin !== origin) throw new TypeError("A canonical HTTPS site origin is required");
  for (const method of ["actor", "admitUpload", "releaseUpload", "upload", "listAssets", "asset", "messageAsset", "gallery", "removeAsset", "send"]) {
    if (typeof service?.[method] !== "function") throw new TypeError("A media service is required");
  }
  return async (request, response) => {
    let url;
    try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const route = routeFor(url.pathname);
    if (!route) return false;
    const method = request.method ?? "GET";
    if (!route.methods.includes(method)) {
      reply(response, method, 405, { error: "method_not_allowed" }, { Allow: route.methods.join(", ") });
      return true;
    }
    try {
      const upload = route.kind === "assets" && method === "POST";
      if (method === "POST") {
        if (upload) checkUploadHeaders(request, origin);
        else checkMutation(request, origin, url.pathname, false);
      }
      const token = sessionToken(request, COOKIES[route.role]);
      const actor = token ? await service.actor(route.role, token) : null;
      if (!actor) {
        const headers = method === "POST" || hasSessionCookie(request, COOKIES[route.role]) ? { "Set-Cookie": clearCookie(COOKIES[route.role]) } : {};
        reply(response, method, 401, { error: "authentication_required" }, { ...headers, ...(method === "POST" ? { Connection: "close" } : {}) });
        if (method === "POST") request.resume();
        return true;
      }
      const authenticated = safeActor(actor, route.role);
      if (method === "POST" && !sameText(request.headers["x-csrf-token"], authenticated.csrf)) throw httpError(403, "csrf_failed");
      if (route.kind === "capabilities") {
        query(url, []);
        reply(response, method, 200, { enabled: true, maxUploadBytes: MAX_UPLOAD_BYTES, formats: [...FORMATS] });
      } else if (upload) {
        query(url, []);
        const admission = await service.admitUpload(route.role, token);
        if (!admission || typeof admission !== "object") throw unavailable();
        try {
          const bytes = await readUpload(request);
          if (!matchesDeclaredFormat(bytes, request.headers["content-type"])) throw httpError(415, "media_format");
          const result = await service.upload(route.role, token, bytes, admission);
          if (!result || typeof result.duplicate !== "boolean") throw unavailable();
          reply(response, method, result.duplicate ? 200 : 201, { asset: safeMedia(result.asset, { role: route.role }), duplicate: result.duplicate });
        } finally { service.releaseUpload(admission); }
      } else if (route.kind === "assets") {
        const options = query(url, ["conversationId", "afterId", "limit"], 50);
        const conversationId = options.conversationId ?? null, afterId = options.afterId ?? null;
        if (conversationId !== null && !id(conversationId) || afterId !== null && !id(afterId)) throw invalid();
        const result = await service.listAssets(route.role, token, { conversationId, afterId, limit: options.limit });
        if (!result || !Array.isArray(result.assets) || result.assets.length > options.limit || typeof result.hasMore !== "boolean"
          || !(result.nextCursor === null || id(result.nextCursor))) throw unavailable();
        reply(response, method, 200, { assets: result.assets.map((value) => safeMedia(value, { role: route.role })), nextCursor: result.nextCursor, hasMore: result.hasMore });
      } else if (route.kind === "ownedBytes" || route.kind === "deliveryBytes") {
        query(url, []);
        const completed = reserveBinaryRead(response);
        try {
          const result = route.kind === "ownedBytes" ? await service.asset(route.role, token, route.assetId, route.variant)
            : await service.messageAsset(route.role, token, route.conversationId, route.messageId, route.variant);
          if (!response.destroyed && !response.writableEnded) bytesReply(response, method, result, route.variant);
        } finally { completed(); }
      } else if (route.kind === "delete") {
        query(url, []);
        shape(await readJson(request), []);
        await service.removeAsset(route.role, token, route.assetId);
        reply(response, method, 200, { deleted: true });
      } else if (route.kind === "gallery") {
        const options = query(url, ["before", "limit"], 50);
        const before = options.before ?? null;
        if (before !== null && !sequence(before)) throw invalid();
        const result = await service.gallery(route.role, token, route.conversationId, { before, limit: options.limit });
        if (!result || !Array.isArray(result.items) || result.items.length > options.limit || typeof result.hasMore !== "boolean"
          || !(result.nextBefore === null || sequence(result.nextBefore))) throw unavailable();
        let previous = before === null ? MAX_SEQUENCE + 1n : BigInt(before);
        const items = result.items.map((value) => {
          if (!value || !id(value.messageId) || !sequence(value.sequence, true) || BigInt(value.sequence) >= previous
            || !["me", "peer"].includes(value.sender) || !date(value.createdAt)) throw unavailable();
          previous = BigInt(value.sequence);
          return { messageId: value.messageId, sequence: value.sequence, sender: value.sender, createdAt: value.createdAt,
            media: safeMedia(value.media, { role: route.role, conversationId: route.conversationId, messageId: value.messageId }) };
        });
        if (result.hasMore && (!items.length || result.nextBefore !== items.at(-1).sequence)
          || result.nextBefore !== null && result.nextBefore !== items.at(-1)?.sequence
          || !items.length && result.nextBefore !== null) throw unavailable();
        reply(response, method, 200, { items, nextBefore: result.nextBefore, hasMore: result.hasMore });
      } else {
        query(url, []);
        const body = shape(await readJson(request, { maxBytes: 8192 }), ["clientMessageId", "mediaId", "caption"]);
        if (!id(body.clientMessageId) || !id(body.mediaId) || typeof body.caption !== "string" || body.caption.length > 1000) throw invalid();
        if (body.caption !== "") validateMessageBody(body.caption);
        const result = await service.send(route.role, token, route.conversationId, body);
        if (!result || typeof result.duplicate !== "boolean") throw unavailable();
        reply(response, method, result.duplicate ? 200 : 201, { message: safeMessage(result.message, { role: route.role, conversationId: route.conversationId }), duplicate: result.duplicate });
      }
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const { status, code, retry } = mappedError(error);
        const headers = retry ? { "Retry-After": String(retry) } : {};
        if (status === 401 && (method === "POST" || hasSessionCookie(request, COOKIES[route.role]))) headers["Set-Cookie"] = clearCookie(COOKIES[route.role]);
        if (method === "POST" || [400, 408, 413].includes(status)) { headers.Connection = "close"; request.resume(); }
        reply(response, method, status, { error: code }, headers);
      }
    }
    return true;
  };
}
