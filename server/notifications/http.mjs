import { CLIENT_ADMISSION_POLICY } from "../access/admission.mjs";
import { checkMutation, clearCookie, httpError, isToken, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";

const COOKIES = Object.freeze({ admin: "__Host-jessie_session", client: "__Host-jessie_client" });
const MAX_INSTANT = 253402300799999;
const id = (value) => typeof value === "string" && value.length === 32 && /^[a-f0-9]{32}$/.test(value);
const instant = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_INSTANT;
const invalid = () => httpError(400, "invalid_request");
const unavailable = () => httpError(503, "notifications_unavailable");
const PUBLIC_ERRORS = new Map([[400, new Set(["invalid_request"])], [403, new Set(["request_rejected", "csrf_failed"])],
  [408, new Set(["request_timeout"])], [413, new Set(["request_too_large"])], [415, new Set(["json_required"])],
  [503, new Set(["notifications_unavailable"])]]);

function shape(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) throw invalid();
  return value;
}
function safeActor(value, role) {
  if (!value?.user || !id(value.user.id) || value.user.role !== role || typeof value.user.pseudonym !== "string"
    || value.user.pseudonym.length > 64 || !value.user.pseudonym.isWellFormed() || !instant(value.expiresAt) || !isToken(value.csrf)) throw unavailable();
  if (role === "client" && (!value.access || value.access.state !== "active" || value.access.admissionPolicy !== CLIENT_ADMISSION_POLICY
    || ["emailVerified", "invitationConsumed", "approved"].some((field) => value.access[field] !== true))) throw httpError(403, "request_rejected");
  return { csrf: value.csrf };
}
function safeSubscription(value) {
  if (!value || !id(value.id) || typeof value.enabled !== "boolean" || !instant(value.createdAt) || !instant(value.updatedAt)
    || value.updatedAt < value.createdAt) throw unavailable();
  return { id: value.id, enabled: value.enabled, createdAt: value.createdAt, updatedAt: value.updatedAt };
}
function safeCapabilities(value) {
  if (value?.enabled !== true || typeof value.vapidPublicKey !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(value.vapidPublicKey)
    || !Array.isArray(value.subscriptions) || value.subscriptions.length > 64) throw unavailable();
  const publicBytes = Buffer.from(value.vapidPublicKey, "base64url");
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || publicBytes.toString("base64url") !== value.vapidPublicKey) throw unavailable();
  const subscriptions = value.subscriptions.map(safeSubscription);
  if (new Set(subscriptions.map((row) => row.id)).size !== subscriptions.length || subscriptions.filter((row) => row.enabled).length > 16) throw unavailable();
  return { enabled: true, vapidPublicKey: value.vapidPublicKey, subscriptions };
}
function safeStatus(value) {
  if (!value || typeof value.enabled !== "boolean" || !(value.subscriptionId === null || id(value.subscriptionId))
    || value.enabled !== (value.subscriptionId !== null)) throw unavailable();
  return { enabled: value.enabled, subscriptionId: value.subscriptionId };
}
function mappedError(error) {
  if (PUBLIC_ERRORS.get(error?.httpStatus)?.has(error.publicCode)) return { status: error.httpStatus, code: error.publicCode };
  if (["CHAT_UNAUTHORIZED", "AUTH_INVALID"].includes(error?.code)) return { status: 401, code: "authentication_required" };
  if (["CHAT_FORBIDDEN", "ACCESS_FORBIDDEN", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"].includes(error?.code)) return { status: 403, code: "request_rejected" };
  if (["NOTIFICATIONS_INPUT", "NOTIFICATIONS_STORE_INPUT"].includes(error?.code)) return { status: 400, code: "invalid_request" };
  if (error?.code === "NOTIFICATIONS_CONFLICT") return { status: 409, code: "subscription_conflict" };
  if (error?.code === "NOTIFICATIONS_LIMIT") return { status: 409, code: "subscription_limit" };
  if (error?.code === "NOTIFICATIONS_NOT_FOUND") return { status: 404, code: "not_found" };
  if (["NOTIFICATIONS_RATE_LIMIT", "AUTH_RATE_LIMIT", "CHAT_RATE_LIMIT", "AUTH_BUSY"].includes(error?.code)) {
    const retry = Number(error.retryAfter);
    return { status: 429, code: "try_again_later", retry: Number.isFinite(retry) ? Math.max(1, Math.min(3600, Math.ceil(retry))) : 60 };
  }
  return { status: 503, code: "notifications_unavailable" };
}

/** Registered only for an explicitly enabled, configured notification runtime. */
export function createNotificationsHttpHandler(service, { origin }) {
  const configured = new URL(origin);
  if (configured.protocol !== "https:" || configured.origin !== origin) throw new TypeError("A canonical HTTPS site origin is required");
  if (["actor", "capabilities", "status", "subscribe", "disable", "open"].some((method) => typeof service?.[method] !== "function")) throw new TypeError("A notification service is required");
  return async (request, response) => {
    let url;
    try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const route = /^\/api\/notifications\/(admin|client)\/(capabilities|status|subscription|disable|open)$/.exec(url.pathname);
    if (!route) return false;
    const role = route[1], kind = route[2], method = request.method ?? "GET", allowed = kind === "capabilities" ? "GET" : "POST";
    if (method !== allowed) {
      const headers = { Allow: allowed };
      if (!["GET", "HEAD"].includes(method)) { headers.Connection = "close"; request.resume(); }
      reply(response, method, 405, { error: "method_not_allowed" }, headers); return true;
    }
    try {
      // Reject cross-site bodies before reading a session or attaching a body
      // listener. Every mutation then requires a current role-specific CSRF.
      if (method === "POST") {
        checkMutation(request, origin, url.pathname);
        if (request.headers["content-encoding"] !== undefined && request.headers["content-encoding"] !== "identity") throw httpError(415, "json_required");
      }
      if (url.search) throw invalid();
      const token = sessionToken(request, COOKIES[role]);
      if (!token) throw Object.assign(new Error("Session required."), { code: "CHAT_UNAUTHORIZED" });
      const actor = safeActor(await service.actor(role, token), role);
      if (method === "POST" && (!isToken(request.headers["x-csrf-token"]) || !sameText(request.headers["x-csrf-token"], actor.csrf))) throw httpError(403, "csrf_failed");
      if (kind === "capabilities") reply(response, method, 200, safeCapabilities(await service.capabilities(role, token)));
      else {
        const body = await readJson(request, { maxBytes: 8192 });
        if (kind === "open") {
          shape(body, ["notification"]); if (!id(body.notification)) throw invalid();
          const result = await service.open(role, token, body);
          if (!result || !id(result.conversationId) || !id(result.messageId) || typeof result.sequence !== "string"
            || !/^[1-9][0-9]{0,19}$/.test(result.sequence) || BigInt(result.sequence) > 18446744073709551615n) throw unavailable();
          reply(response, method, 200, { conversationId: result.conversationId, messageId: result.messageId, sequence: result.sequence });
        } else if (kind === "status") {
          shape(body, ["endpoint"]);
          if (typeof body.endpoint !== "string" || body.endpoint.length < 1 || body.endpoint.length > 4096 || !body.endpoint.isWellFormed()) throw invalid();
          reply(response, method, 200, safeStatus(await service.status(role, token, body)));
        } else if (kind === "subscription") {
          shape(body, ["subscription", "language"]);
          if (!["fr", "en"].includes(body.language) || !body.subscription || typeof body.subscription !== "object" || Array.isArray(body.subscription)) throw invalid();
          const result = safeStatus(await service.subscribe(role, token, body));
          if (!result.enabled) throw unavailable();
          reply(response, method, 200, result);
        } else {
          shape(body, ["id"]); if (!id(body.id)) throw invalid();
          const result = await service.disable(role, token, body);
          if (result?.enabled !== false) throw unavailable();
          reply(response, method, 200, { enabled: false });
        }
      }
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const { status, code, retry } = mappedError(error);
        const headers = retry ? { "Retry-After": String(retry) } : {};
        if (status === 401) headers["Set-Cookie"] = clearCookie(COOKIES[role]);
        if (method === "POST") { headers.Connection = "close"; request.resume(); }
        reply(response, method, status, { error: code }, headers);
      }
    }
    return true;
  };
}
