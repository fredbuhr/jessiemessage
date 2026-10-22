import { CLIENT_ADMISSION_POLICY } from "../access/admission.mjs";
import { AUTH_HEADERS, checkMutation, httpError, isToken, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";
import { safeMessage, safeVideo } from "../chat/http.mjs";
import { validateMessageBody } from "../chat/crypto.mjs";

const MAX_BYTES = 104857600;
const MAX_CHUNK = 262144;
const COOKIES = { admin: "__Host-jessie_session", client: "__Host-jessie_client" };
const LIMITS = { upload: 2, read: 4 };
const active = { upload: 0, read: 0 };
const invalid = () => httpError(400, "invalid_request");
const unavailable = () => httpError(503, "video_unavailable");
const identifier = (value) => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const sequence = (value, positive = false) => typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/.test(value)
  && BigInt(value) <= 18446744073709551615n && (!positive || value !== "0");
const date = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;

function routeFor(pathname) {
  let match = /^\/api\/video\/(admin|client)\/assets(?:\/([a-f0-9]{32})\/content)?$/.exec(pathname);
  if (match) return { role: match[1], assetId: match[2], kind: match[2] ? "owned" : "assets", methods: match[2] ? ["GET", "HEAD"] : ["GET", "POST"] };
  match = /^\/api\/video\/(admin|client)\/assets\/([a-f0-9]{32})\/delete$/.exec(pathname);
  if (match) return { role: match[1], assetId: match[2], kind: "delete", methods: ["POST"] };
  match = /^\/api\/video\/(admin|client)\/conversations\/([a-f0-9]{32})\/(messages|gallery)$/.exec(pathname);
  if (match) return { role: match[1], conversationId: match[2], kind: match[3] === "messages" ? "send" : "gallery", methods: match[3] === "messages" ? ["POST"] : ["GET"] };
  match = /^\/api\/video\/(admin|client)\/conversations\/([a-f0-9]{32})\/messages\/([a-f0-9]{32})\/content$/.exec(pathname);
  return match ? { role: match[1], conversationId: match[2], messageId: match[3], kind: "delivery", methods: ["GET", "HEAD"] } : null;
}

function query(url, gallery) {
  if (!gallery) { if ([...url.searchParams].length) throw invalid(); return null; }
  const values = Object.create(null);
  for (const [name, value] of url.searchParams) {
    if (!["before", "limit"].includes(name) || Object.hasOwn(values, name)) throw invalid();
    values[name] = value;
  }
  if (values.before !== undefined && !sequence(values.before)
    || values.limit !== undefined && !/^(?:[1-9][0-9]?|100)$/.test(values.limit)) throw invalid();
  return { before: values.before ?? null, limit: values.limit === undefined ? 50 : Number(values.limit) };
}
function libraryQuery(url) {
  const values = Object.create(null);
  for (const [name, value] of url.searchParams) {
    if (!["afterId", "limit"].includes(name) || Object.hasOwn(values, name)) throw invalid();
    values[name] = value;
  }
  if (values.afterId !== undefined && !identifier(values.afterId)
    || values.limit !== undefined && !/^(?:[1-9][0-9]?|100)$/.test(values.limit)) throw invalid();
  return { afterId: values.afterId ?? null, limit: values.limit === undefined ? 20 : Number(values.limit) };
}

function safeActor(actor, role) {
  if (!actor?.user || !identifier(actor.user.id) || actor.user.role !== role
    || typeof actor.user.pseudonym !== "string" || actor.user.pseudonym.length > 64 || !actor.user.pseudonym.isWellFormed()
    || !Number.isSafeInteger(actor.expiresAt) || actor.expiresAt < 0 || actor.expiresAt > 8640000000000000 || !isToken(actor.csrf)) throw unavailable();
  if (role === "client" && (!actor.access || actor.access.state !== "active" || actor.access.admissionPolicy !== CLIENT_ADMISSION_POLICY
    || ["emailVerified", "invitationConsumed", "approved"].some((name) => actor.access[name] !== true))) throw httpError(403, "request_rejected");
  return actor;
}

function uploadHeaders(request, origin) {
  if (request.headers.origin !== origin || request.headers["sec-fetch-site"] !== undefined
    && !["same-origin", "none"].includes(request.headers["sec-fetch-site"])) throw httpError(403, "request_rejected");
  if (request.headers["content-type"] !== "video/mp4" || request.headers["content-encoding"] !== undefined
    && request.headers["content-encoding"] !== "identity") throw httpError(415, "video_format");
  const length = request.headers["content-length"];
  if (length === undefined) throw httpError(411, "length_required");
  if (typeof length !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(length) || !Number.isSafeInteger(Number(length))) throw invalid();
  const bytes = Number(length);
  if (bytes > MAX_BYTES) throw httpError(413, "request_too_large");
  if (bytes < 1 || request.headers["transfer-encoding"] !== undefined) throw invalid();
  return bytes;
}

function byteRange(header, bytes) {
  if (header === undefined) return { start: 0, end: bytes - 1, partial: false };
  if (typeof header !== "string") return null;
  const unit = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=/.exec(header);
  // RFC9110§14.2 requires an unknown range unit to be ignored.
  if (unit && unit[1].toLowerCase() !== "bytes") return { start: 0, end: bytes - 1, partial: false };
  if (header.length > 128) return null;
  const match = /^bytes=([0-9]*)-([0-9]*)$/i.exec(header);
  if (!match || !match[1] && !match[2]) return null;
  const integer = (value) => value === "" ? null : /^\d{1,16}$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : NaN;
  const first = integer(match[1]), last = integer(match[2]);
  if (Number.isNaN(first) || Number.isNaN(last)) return null;
  if (first === null) return last > 0 ? { start: Math.max(0, bytes - last), end: bytes - 1, partial: true } : null;
  if (first >= bytes || last !== null && last < first) return null;
  return { start: first, end: last === null ? bytes - 1 : Math.min(bytes - 1, last), partial: true };
}

function mappedError(error) {
  if ([400, 403, 408, 411, 413, 415, 503].includes(error?.httpStatus)
    && ["invalid_request", "request_rejected", "csrf_failed", "request_timeout", "length_required", "request_too_large", "json_required", "video_format", "video_unavailable"].includes(error.publicCode)) {
    return { status: error.httpStatus, code: error.publicCode };
  }
  if (["CHAT_UNAUTHORIZED", "AUTH_INVALID", "VIDEO_UNAUTHORIZED"].includes(error?.code)) return { status: 401, code: "authentication_required" };
  if (["VIDEO_READ_ONLY", "CHAT_READ_ONLY"].includes(error?.code) || error?.httpStatus === 403 && error.publicCode === "feature_read_only") return { status: 403, code: "feature_read_only" };
  if (["CHAT_FORBIDDEN", "ACCESS_FORBIDDEN", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"].includes(error?.code)) return { status: 403, code: "request_rejected" };
  if (["VIDEO_NOT_FOUND", "MEDIA_NOT_FOUND", "CHAT_NOT_FOUND"].includes(error?.code)) return { status: 404, code: "not_found" };
  if (["VIDEO_INPUT", "MEDIA_INPUT", "CHAT_INPUT"].includes(error?.code)) return { status: 400, code: "invalid_request" };
  if (error?.code === "CHAT_CONFLICT") return { status: 409, code: "message_conflict" };
  if (error?.code === "VIDEO_IN_USE") return { status: 409, code: "video_in_use" };
  if (error?.code === "VIDEO_FORMAT") return { status: 415, code: "video_format" };
  if (["VIDEO_STORAGE_LIMIT", "MEDIA_STORAGE_LIMIT"].includes(error?.code)) return { status: 507, code: "storage_limit" };
  if (["VIDEO_BUSY", "VIDEO_RATE_LIMIT", "CHAT_RATE_LIMIT", "AUTH_RATE_LIMIT", "AUTH_BUSY"].includes(error?.code)) return { status: 429, code: "try_again_later", retry: 5 };
  return { status: 503, code: "video_unavailable" };
}

function reserve(kind, response) {
  if (active[kind] >= LIMITS[kind]) throw Object.assign(new Error("Private video is busy."), { code: "VIDEO_BUSY" });
  active[kind] += 1;
  let settled = false, finished = response.writableFinished || response.destroyed, released = false;
  const release = () => {
    if (released || !settled || !finished) return;
    released = true; active[kind] -= 1;
    response.off("finish", onFinished); response.off("close", onFinished);
  };
  const onFinished = () => { finished = true; release(); };
  response.once("finish", onFinished); response.once("close", onFinished);
  return () => { settled = true; release(); };
}

function transfer(request, response, timeout, inactivity) {
  const controller = new AbortController();
  const stop = (error = invalid()) => { if (!controller.signal.aborted) controller.abort(error); };
  const onRequestAborted = () => stop();
  const onRequestError = () => stop();
  const onResponseClosed = () => { if (!response.writableFinished) stop(); };
  const onResponseError = () => stop();
  const onTimeout = () => { stop(httpError(408, "request_timeout")); response.destroy(); };
  const timer = setTimeout(() => {
    stop(httpError(408, "request_timeout"));
    if (inactivity) response.destroy();
  }, timeout);
  timer.unref();
  request.once("aborted", onRequestAborted); request.on("error", onRequestError);
  response.once("close", onResponseClosed); response.once("error", onResponseError);
  if (inactivity) response.setTimeout(inactivity, onTimeout);
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer);
      request.off("aborted", onRequestAborted); request.off("error", onRequestError);
      response.off("close", onResponseClosed); response.off("error", onResponseError); response.off("timeout", onTimeout);
      if (response.socket && !response.socket.destroyed) response.setTimeout(0);
      // A request can emit its transport error after the handler settled.
      if (!request.complete) request.once("error", () => {});
    },
  };
}

function checkSignal(signal) { if (signal.aborted) throw signal.reason ?? invalid(); }

async function readChunk(request, signal) {
  checkSignal(signal);
  if (request.readableEnded) return null;
  if (request.destroyed || request.aborted) throw invalid();
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      request.off("readable", onReadable); request.off("end", onEnd); request.off("error", onError); request.off("aborted", onError);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve(value);
    };
    const onReadable = () => {
      try { const chunk = request.read(65536); if (chunk !== null) finish(null, chunk); }
      catch { finish(invalid()); }
    };
    const onEnd = () => finish(null, null);
    const onError = () => finish(invalid());
    const onAbort = () => finish(signal.reason ?? invalid());
    request.on("readable", onReadable); request.once("end", onEnd); request.once("error", onError); request.once("aborted", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    onReadable();
    if (signal.aborted) onAbort();
  });
}

async function* uploadSource(request, bytes, signal) {
  let received = 0;
  while (true) {
    const chunk = await readChunk(request, signal);
    if (chunk === null) break;
    checkSignal(signal);
    if (!Buffer.isBuffer(chunk) || !chunk.length || chunk.length > 65536) throw invalid();
    received += chunk.length;
    if (received > bytes) throw invalid();
    yield chunk;
  }
  checkSignal(signal);
  if (received !== bytes) throw invalid();
}

async function drain(response, signal) {
  checkSignal(signal);
  if (response.destroyed) throw invalid();
  await new Promise((resolve, reject) => {
    const clean = () => { response.off("drain", onDrain); response.off("error", onError); response.off("close", onError); signal.removeEventListener("abort", onAbort); };
    const onDrain = () => { clean(); resolve(); };
    const onError = () => { clean(); reject(invalid()); };
    const onAbort = () => { clean(); reject(signal.reason ?? invalid()); };
    response.once("drain", onDrain); response.once("error", onError); response.once("close", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function milliseconds(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError("A bounded video deadline is required.");
  return value;
}

/** Dormant transport: the caller must supply live authorization and durable admission. */
export function createVideoHandler(service, { origin, uploadTimeoutMs = 300000, readTimeoutMs = 30000, transferTimeoutMs = 300000, creationEnabled = service?.creationEnabled ?? true } = {}) {
  const configured = new URL(origin);
  if (configured.protocol !== "https:" || configured.origin !== origin || typeof creationEnabled !== "boolean") throw new TypeError("A canonical HTTPS origin and creation capability are required.");
  for (const name of ["actor", "admitUpload", "releaseUpload", "upload", "open"]) if (typeof service?.[name] !== "function") throw new TypeError("A private video service is required.");
  const additions = ["send", "openMessage", "gallery"], messaging = additions.every((name) => typeof service[name] === "function");
  if (!messaging && additions.some((name) => service[name] !== undefined)) throw new TypeError("A complete private video message service is required.");
  const managed = ["listOwned", "remove"].every(name => typeof service[name] === "function");
  if (!managed && ["listOwned", "remove"].some(name => service[name] !== undefined)) throw new TypeError("A complete private video library service is required.");
  milliseconds(uploadTimeoutMs, 300000); milliseconds(readTimeoutMs, 30000); milliseconds(transferTimeoutMs, 300000);
  return async (request, response) => {
    let url;
    try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const route = routeFor(url.pathname);
    if (!route || !messaging && ["send", "gallery", "delivery"].includes(route.kind) || !managed && route.kind === "delete") return false;
    const { role, assetId } = route, methods = !managed && route.kind === "assets" ? ["POST"] : route.methods;
    const method = request.method ?? "GET", upload = route.kind === "assets" && method === "POST", library = route.kind === "assets" && method === "GET", mutation = method === "POST";
    if (!methods.includes(method)) { reply(response, method, 405, { error: "method_not_allowed" }, { Allow: methods.join(", ") }); return true; }
    let release, operation, ticket, opened;
    try {
      const options = library ? libraryQuery(url) : query(url, route.kind === "gallery");
      const bytes = upload ? uploadHeaders(request, origin) : null;
      if (mutation && !upload) checkMutation(request, origin, url.pathname, false);
      const token = sessionToken(request, COOKIES[role]);
      const actor = token ? await service.actor(role, token) : null;
      if (!actor) throw Object.assign(new Error("Authentication required."), { code: "VIDEO_UNAUTHORIZED" });
      safeActor(actor, role);
      if (mutation && !sameText(request.headers["x-csrf-token"], actor.csrf)) throw httpError(403, "csrf_failed");
      if (mutation && !creationEnabled) throw httpError(403, "feature_read_only");
      if (library) {
        const result = await service.listOwned(role, token, options);
        if (!result || !Array.isArray(result.assets) || result.assets.length > options.limit || typeof result.hasMore !== "boolean"
          || !(result.nextCursor === null || identifier(result.nextCursor))) throw unavailable();
        let previous = options.afterId;
        const assets = result.assets.map(value => {
          if (!identifier(value?.id) || previous !== null && value.id <= previous || !Number.isSafeInteger(value.bytes)
            || value.bytes < 1 || value.bytes > MAX_BYTES || value.mime !== "video/mp4" || !date(value.createdAt)
            || typeof value.cleanupPending !== "boolean" || value.contentUrl !== (value.cleanupPending ? null : `/api/video/${role}/assets/${value.id}/content`)) throw unavailable();
          previous = value.id;
          return { id: value.id, bytes: value.bytes, mime: value.mime, createdAt: value.createdAt,
            cleanupPending: value.cleanupPending, contentUrl: value.contentUrl };
        });
        if (result.hasMore ? !assets.length || result.nextCursor !== assets.at(-1).id : result.nextCursor !== null) throw unavailable();
        reply(response, method, 200, { assets, nextCursor: result.nextCursor, hasMore: result.hasMore });
      } else if (route.kind === "delete") {
        if (Object.keys(await readJson(request)).length) throw invalid();
        const result = await service.remove(role, token, assetId);
        if (result?.deleted !== true) throw unavailable();
        reply(response, method, 200, { deleted: true });
      } else if (route.kind === "send") {
        const body = await readJson(request, { maxBytes: 8192 });
        if (Object.keys(body).length !== 3 || !["clientMessageId", "videoId", "caption"].every((name) => Object.hasOwn(body, name))
          || !identifier(body.clientMessageId) || !identifier(body.videoId) || typeof body.caption !== "string" || body.caption.length > 1000) throw invalid();
        if (body.caption !== "") validateMessageBody(body.caption);
        const result = await service.send(role, token, route.conversationId, body);
        if (!result || typeof result.duplicate !== "boolean") throw unavailable();
        const message = safeMessage(result.message, { role, conversationId: route.conversationId });
        if (message.deletedAt === null && (!message.video || message.video.id !== body.videoId)) throw unavailable();
        reply(response, method, result.duplicate ? 200 : 201, { message, duplicate: result.duplicate });
      } else if (route.kind === "gallery") {
        const result = await service.gallery(role, token, route.conversationId, options);
        if (!result || !Array.isArray(result.items) || result.items.length > options.limit || typeof result.hasMore !== "boolean"
          || !(result.nextBefore === null || sequence(result.nextBefore, true))) throw unavailable();
        let previous = options.before === null ? 18446744073709551616n : BigInt(options.before);
        const items = result.items.map((item) => {
          if (!item || !identifier(item.messageId) || !sequence(item.sequence, true) || BigInt(item.sequence) >= previous
            || !["me", "peer"].includes(item.sender) || !date(item.createdAt)) throw unavailable();
          previous = BigInt(item.sequence);
          return { messageId: item.messageId, sequence: item.sequence, sender: item.sender, createdAt: item.createdAt,
            video: safeVideo(item.video, { role, conversationId: route.conversationId, messageId: item.messageId }) };
        });
        if (result.hasMore ? !items.length || result.nextBefore !== items.at(-1).sequence : result.nextBefore !== null) throw unavailable();
        reply(response, method, 200, { items, nextBefore: result.nextBefore, hasMore: result.hasMore });
      } else {
        release = reserve(upload ? "upload" : "read", response);
        operation = transfer(request, response, upload ? uploadTimeoutMs : transferTimeoutMs, upload ? 0 : readTimeoutMs);
        if (upload) {
          ticket = await service.admitUpload(role, token, { bytes, mime: "video/mp4" });
          checkSignal(operation.signal);
          const result = await service.upload(role, token, ticket, uploadSource(request, bytes, operation.signal), { signal: operation.signal });
          checkSignal(operation.signal);
          if (!identifier(result?.id) || result.bytes !== bytes || result.mime !== "video/mp4" || !request.readableEnded) throw unavailable();
          reply(response, method, 201, { id: result.id, bytes: result.bytes, mime: result.mime });
        } else {
          opened = route.kind === "delivery"
            ? await service.openMessage(role, token, route.conversationId, route.messageId, { signal: operation.signal })
            : await service.open(role, token, assetId, { signal: operation.signal });
          checkSignal(operation.signal);
          if (!opened || !Number.isSafeInteger(opened.bytes) || opened.bytes < 1 || opened.bytes > MAX_BYTES
            || opened.mime !== "video/mp4" || typeof opened.stream !== "function" || typeof opened.close !== "function") throw unavailable();
          // Range is defined for GET only; HEAD describes the complete resource.
          const range = byteRange(method === "GET" && request.headers["if-range"] === undefined ? request.headers.range : undefined, opened.bytes);
          if (!range) {
            reply(response, method, 416, { error: "range_not_satisfiable" }, { "Content-Range": `bytes */${opened.bytes}`, "Accept-Ranges": "bytes" });
          } else {
            const length = range.end - range.start + 1;
            const headers = { ...AUTH_HEADERS, "Content-Type": "video/mp4", "Content-Length": String(length),
              "Content-Disposition": 'inline; filename="video.mp4"', "Accept-Ranges": "bytes",
              ...(range.partial ? { "Content-Range": `bytes ${range.start}-${range.end}/${opened.bytes}` } : {}) };
            response.writeHead(range.partial ? 206 : 200, headers);
            if (method === "HEAD") response.end();
            else {
              let sent = 0;
              for await (const chunk of opened.stream({ start: range.start, end: range.end, signal: operation.signal })) {
                checkSignal(operation.signal);
                if (!Buffer.isBuffer(chunk) || !chunk.length || chunk.length > MAX_CHUNK || sent + chunk.length > length) throw unavailable();
                sent += chunk.length;
                if (!response.write(chunk)) await drain(response, operation.signal);
              }
              checkSignal(operation.signal);
              if (sent !== length) throw unavailable();
              response.end();
            }
          }
        }
      }
    } catch (error) {
      if (response.headersSent || response.destroyed) response.destroy();
      else {
        // The service intentionally maps private storage/parser details. Keep
        // the transport's own deadline when cancellation crosses that boundary.
        const reason = operation?.signal.aborted ? operation.signal.reason : error;
        const { status, code, retry } = mappedError(reason);
        const headers = { ...(retry ? { "Retry-After": String(retry) } : {}) };
        if (mutation) { headers.Connection = "close"; if (!request.complete) request.once("error", () => {}); request.resume(); }
        reply(response, method, status, { error: code }, headers);
      }
    } finally {
      // Close/release can still be doing filesystem or SQL work after the socket closes.
      // Keep the process slot until those operations actually settle.
      try { if (opened && typeof opened.close === "function") await opened.close(); }
      catch { response.destroy(); }
      try { if (ticket !== undefined) await service.releaseUpload(ticket); }
      catch { response.destroy(); }
      operation?.close(); release?.();
    }
    return true;
  };
}
