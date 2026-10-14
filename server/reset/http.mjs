import { readFile } from "node:fs/promises";
import { checkMutation, clearCookie, httpError, isToken, readJson, reply } from "../auth/http.mjs";

const publicRoot = new URL("../../public/", import.meta.url);
const files = new Map([
  ["/recover", ["recover.html", "text/html; charset=utf-8"]],
  ["/recover.js", ["recover.js", "text/javascript; charset=utf-8"]],
  ["/recover-model.js", ["recover-model.js", "text/javascript; charset=utf-8"]],
  ["/recover.css", ["recover.css", "text/css; charset=utf-8"]],
]);
const routes = new Map([
  ["/api/access/recovery/capabilities", ["GET"]],
  ["/api/access/recovery/request", ["POST"]],
  ["/api/access/recovery/reset", ["POST"]],
]);
const publicErrors = new Map([
  [400, new Set(["invalid_request", "invalid_password"])],
  [403, new Set(["request_rejected"])],
  [408, new Set(["request_timeout"])],
  [413, new Set(["request_too_large"])],
  [415, new Set(["json_required"])],
]);

function shape(body, keys) {
  if (Object.keys(body).length !== keys.length || keys.some((key) => !Object.hasOwn(body, key))) {
    throw httpError(400, "invalid_request");
  }
  return body;
}

function requestBody(body) {
  shape(body, ["email"]);
  if (typeof body.email !== "string" || !body.email.length || body.email.length > 254
    || !body.email.isWellFormed() || Buffer.byteLength(body.email) > 1016) throw httpError(400, "invalid_request");
  return { email: body.email };
}

function resetBody(body) {
  shape(body, ["token", "password"]);
  if (typeof body.token !== "string" || body.token.length !== 43 || !isToken(body.token)) throw httpError(400, "invalid_request");
  if (typeof body.password !== "string" || body.password.length < 14 || body.password.length > 128
    || !body.password.isWellFormed() || Buffer.byteLength(body.password) > 512) throw httpError(400, "invalid_password");
  return { token: body.token, password: body.password };
}

function safeStatus(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.status !== expected) throw httpError(503, "recovery_unavailable");
  return { status: expected };
}

function mappedError(error) {
  if (publicErrors.get(error?.httpStatus)?.has(error.publicCode)) return { status: error.httpStatus, code: error.publicCode };
  if (error?.code === "RESET_INPUT") return { status: 400, code: "invalid_request" };
  if (error?.code === "RESET_INVALID") return { status: 401, code: "invalid_reset_link" };
  if (error?.code === "RESET_RATE_LIMIT" || error?.code === "AUTH_BUSY") {
    const retry = Number(error.retryAfter);
    return { status: 429, code: "try_again_later", retry: Number.isFinite(retry) ? Math.max(1, Math.min(3600, Math.ceil(retry))) : 60 };
  }
  return { status: 503, code: "recovery_unavailable" };
}

/** Only registered by the parent when client recovery is explicitly enabled. */
export function createResetHandler(service, { origin }) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin) throw new TypeError("A canonical HTTPS site origin is required");
  if (typeof service?.requestReset !== "function" || typeof service?.resetPassword !== "function") throw new TypeError("A client recovery service is required");
  return async (request, response) => {
    let url;
    try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const pathname = url.pathname;
    const allowed = files.has(pathname) ? ["GET", "HEAD"] : routes.get(pathname);
    if (!allowed) return false;
    const method = request.method ?? "GET";
    if (!allowed.includes(method)) {
      const headers = { Allow: allowed.join(", ") };
      if (method === "POST") { headers.Connection = "close"; request.resume(); }
      reply(response, method, 405, { error: "method_not_allowed" }, headers);
      return true;
    }
    try {
      if (method === "POST") checkMutation(request, origin, pathname, true);
      // Recovery secrets belong to a JSON body or an in-memory URL fragment.
      // No query field, repeated or otherwise, is accepted on these routes.
      if (url.search) throw httpError(400, "invalid_request");
      if (files.has(pathname)) {
        const [name, contentType] = files.get(pathname);
        reply(response, method, 200, await readFile(new URL(name, publicRoot)), { "Content-Type": contentType });
      } else if (pathname === "/api/access/recovery/capabilities") {
        reply(response, method, 200, { enabled: true, password: { minLength: 14, maxLength: 128 } });
      } else {
        const peerAddress = request.socket.remoteAddress ?? "unknown";
        const body = await readJson(request, { maxBytes: 4096 });
        if (pathname === "/api/access/recovery/request") {
          const result = await service.requestReset({ ...requestBody(body), peerAddress });
          reply(response, method, 202, safeStatus(result, "accepted"));
        } else {
          const result = await service.resetPassword({ ...resetBody(body), peerAddress });
          reply(response, method, 200, safeStatus(result, "password_changed"), { "Set-Cookie": clearCookie("__Host-jessie_client") });
        }
      }
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const { status, code, retry } = mappedError(error);
        const headers = retry ? { "Retry-After": String(retry) } : {};
        if (method === "POST") { headers.Connection = "close"; request.resume(); }
        reply(response, method, status, { error: code }, headers);
      }
    }
    return true;
  };
}
