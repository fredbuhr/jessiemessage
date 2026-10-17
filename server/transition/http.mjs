import { readFile } from "node:fs/promises";
import { AUTH_HEADERS, checkMutation, clearCookie, httpError, reply, sessionCookie, sessionToken } from "../auth/http.mjs";
import { createRequestOriginGuard } from "../http/request-origin.mjs";
import { createRequestAdmission } from "../http/admission.mjs";
import { createDeviceTransitionService, DEVICE_TRANSITION_MILLISECONDS, LEGACY_DEVICE_ORIGIN, PRIMARY_DEVICE_ORIGIN } from "./service.mjs";

const nonceCookieName = (role) => `__Host-jessie_transition_${role}`;
const files = new Map([["/device-transition.js", ["device-transition.js", "text/javascript; charset=utf-8"]],
  ["/device-transition.css", ["device-transition.css", "text/css; charset=utf-8"]]]);
const root = new URL("../../public/", import.meta.url);

// Each endpoint accepts exactly one closed JSON field, including at the wire level.
function readBody(request, field) {
  if (request.headers["content-encoding"] !== undefined) throw httpError(415, "json_required");
  const length = request.headers["content-length"];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > 4096)) throw httpError(413, "request_too_large");
  return new Promise((resolve, reject) => {
    const chunks = []; let count = 0, done = false;
    const finish = (error, value) => {
      if (done) return; done = true; clearTimeout(timer);
      request.off("data", data); request.off("end", end); request.off("error", failed); request.off("aborted", aborted);
      if (error && !request.complete) request.once("error", () => {});
      if (error) reject(error); else resolve(value);
    };
    const data = (chunk) => { count += chunk.length; if (count > 4096) finish(httpError(413, "request_too_large")); else chunks.push(chunk); };
    const failed = () => finish(httpError(400, "invalid_request"));
    const aborted = () => finish(httpError(400, "invalid_request"));
    const end = () => {
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        // Only a single string or null is needed. This also rejects duplicate keys
        // that JSON.parse would otherwise silently accept.
        const pattern = new RegExp(`^\\s*\\{\\s*"${field}"\\s*:\\s*(?:null|"(?:[^"\\\\\\u0000-\\u001f]|\\\\(?:["\\\\/bfnrt]|u[0-9a-fA-F]{4}))*")\\s*\\}\\s*$`);
        if (!pattern.test(text)) throw new Error();
        finish(null, JSON.parse(text));
      } catch { finish(httpError(400, "invalid_request")); }
    };
    const timer = setTimeout(() => finish(httpError(408, "request_timeout")), 5000); timer.unref();
    request.on("data", data); request.once("end", end); request.once("error", failed); request.once("aborted", aborted);
  });
}

export function createDeviceTransitionHandler(options = {}) {
  const { clock = Date.now, legacyOrigin = LEGACY_DEVICE_ORIGIN, primaryOrigin = PRIMARY_DEVICE_ORIGIN } = options;
  const service = createDeviceTransitionService(options), legacyAllowed = createRequestOriginGuard(legacyOrigin), primaryAllowed = createRequestOriginGuard(primaryOrigin);
  // The integrated server already admits every API before dispatching handlers.
  // A standalone handler retains its own bounded admission by default.
  const admission = options.admission === undefined ? createRequestAdmission({ clock }) : options.admission;
  if (admission !== null && typeof admission?.enter !== "function") throw new TypeError("A device transition request admission is required.");
  return async function deviceTransitionHandler(request, response) {
    const method = request.method ?? "GET";
    let url;
    try { url = new URL(request.url, "http://localhost"); } catch { return false; }
    // A normal sign-in expresses a newer account choice. Cancel the destination's
    // pending handoff before its authentication handler can await password work.
    const loginRole = url.pathname === "/api/auth/login" ? "admin" : url.pathname === "/api/access/login" ? "client" : null;
    if (loginRole && method === "POST" && primaryAllowed(request) && request.headers.origin === primaryOrigin
      && request.headers["x-jessie-request"] === "1" && [undefined, "same-origin", "none"].includes(request.headers["sec-fetch-site"])) {
      service.cancel(loginRole, sessionToken(request, nonceCookieName(loginRole)));
    }
    const api = /^\/api\/device-transition\/(admin|client)\/(begin|authorize|complete)$/.exec(url.pathname);
    const page = /^\/connect-device\/(admin|client)$/.test(url.pathname);
    const file = page ? ["device-transition.html", "text/html; charset=utf-8"] : files.get(url.pathname);
    if (!api && !file) return false;
    let done;
    try {
      const isPrimary = primaryAllowed(request), isLegacy = legacyAllowed(request);
      if (!isPrimary && !isLegacy) throw httpError(421, "misdirected_request");
      if (request.url.includes("?") || request.url.includes("#")) throw httpError(400, "invalid_request");
      const allowed = api ? "POST" : "GET, HEAD";
      if (api ? method !== "POST" : !["GET", "HEAD"].includes(method)) {
        reply(response, method, 405, { error: "method_not_allowed" }, { Allow: allowed }); request.resume(); return true;
      }
      if (file) {
        let body = await readFile(new URL(file[0], root));
        if (page) body = Buffer.from(body.toString("utf8").replace("__DEVICE_LEGACY_ORIGIN__", legacyOrigin).replace("__DEVICE_PRIMARY_ORIGIN__", primaryOrigin));
        response.writeHead(200, { ...AUTH_HEADERS, "Content-Type": file[1] }); response.end(method === "HEAD" ? undefined : body); return true;
      }
      const [, role, action] = api;
      if (action === "authorize" ? !isLegacy : !isPrimary) throw httpError(421, "misdirected_request");
      checkMutation(request, isPrimary ? primaryOrigin : legacyOrigin, url.pathname, true);
      done = admission?.enter(request, response);
      const body = await readBody(request, action === "begin" ? "notification" : action === "authorize" ? "challenge" : "ticket");
      const cookieName = role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client";
      const nonceCookie = nonceCookieName(role);
      if (action === "begin") {
        const result = service.begin(role, body, sessionToken(request, nonceCookie));
        reply(response, method, 200, { challenge: result.challenge }, { "Set-Cookie": `${nonceCookie}=${result.nonce}; Path=/; Max-Age=${DEVICE_TRANSITION_MILLISECONDS / 1000}; Secure; HttpOnly; SameSite=Strict` });
      } else if (action === "authorize") {
        reply(response, method, 200, await service.authorize(role, sessionToken(request, cookieName), request.headers["x-csrf-token"], body));
      } else {
        const result = await service.complete(role, sessionToken(request, nonceCookie), sessionToken(request, cookieName), body);
        reply(response, method, 200, { destination: result.destination, keptExisting: result.keptExisting }, { "Set-Cookie": [
          ...(result.keptExisting ? [] : [sessionCookie(result.token, result.expiresAt, cookieName, { role, now: clock() })]), clearCookie(nonceCookie),
        ] });
      }
    } catch (error) {
      const status = Number.isInteger(error?.httpStatus) ? error.httpStatus : ["REQUEST_RATE_LIMIT", "REQUEST_BUSY"].includes(error?.code) ? 429 : 503;
      const code = Number.isInteger(error?.httpStatus) ? error.publicCode : status === 429 ? "try_again_later" : "transition_unavailable";
      const login = ["authorize", "complete"].includes(api?.[2]) && status === 401 && typeof error?.loginDestination === "string" ? error.loginDestination : null;
      reply(response, method, status, { error: code, ...(login ? { login } : {}) }, status === 429 ? { "Retry-After": "5" } : {}); request.resume();
    } finally { done?.(); }
    return true;
  };
}
