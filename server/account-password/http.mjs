import { peerAddress } from "../http/peer-address.mjs";
import { checkMutation, httpError, isToken, readJson, reply, safeSession, sameText, sessionCookie, sessionToken } from "../auth/http.mjs";

import { safeClientSession } from "../access/http.mjs";

const cookies = { admin: "__Host-jessie_session", client: "__Host-jessie_client" };
function mapped(error) {
  if (error?.code === "PASSWORD_AUTH_INVALID") return [401, "authentication_required"];
  if (error?.code === "PASSWORD_CURRENT_INVALID") return [403, "current_password_invalid"];
  if (error?.code === "PASSWORD_INVALID") return [400, "invalid_password"];
  if (error?.code === "PASSWORD_MISMATCH") return [400, "password_mismatch"];
  if (error?.code === "PASSWORD_INPUT") return [400, "invalid_request"];
  if (["PASSWORD_RATE_LIMIT", "AUTH_BUSY"].includes(error?.code)) return [429, "try_again_later", Math.max(1, Math.min(900, Math.ceil(Number(error.retryAfter) || 60)))];
  if ([400, 403, 408, 413, 415].includes(error?.httpStatus)
    && ["invalid_request", "request_rejected", "csrf_failed", "request_timeout", "request_too_large", "json_required"].includes(error?.publicCode)) return [error.httpStatus, error.publicCode];
  return [503, "password_unavailable"];
}
export function createPasswordHandler(service, { origin, clock = Date.now }) {
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.origin !== origin || typeof service?.actor !== "function" || typeof service?.change !== "function" || typeof clock !== "function") throw new TypeError("Password service and canonical HTTPS origin required");
  return async (request, response) => {
    let url; try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const current = /^\/api\/account\/(admin|client)\/password$/.exec(url.pathname); if (!current) return false;
    const method = request.method ?? "GET", role = current[1];
    if (method !== "POST") { reply(response, method, 405, { error: "method_not_allowed" }, { Allow: "POST" }); return true; }
    try {
      checkMutation(request, origin, url.pathname, false);
      if (url.search) throw httpError(400, "invalid_request");
      const token = sessionToken(request, cookies[role]), actor = token ? await service.actor(role, token) : null;
      if (!actor || actor.user?.role !== role || !isToken(actor.csrf)) throw Object.assign(new Error("Session required"), { code: "PASSWORD_AUTH_INVALID" });
      const principal = role === "admin" ? safeSession(actor) : safeClientSession(actor);
      if (!sameText(request.headers["x-csrf-token"], principal.csrf)) throw httpError(403, "csrf_failed");
      const body = await readJson(request, { maxBytes: 4096 });
      const result = await service.change(role, token, body, { peerAddress: peerAddress(request) ?? "unknown" });
      if (result?.status !== "password_changed" || result.user?.role !== role || result.user?.id !== principal.user.id
        || !isToken(result.csrf) || !isToken(result.token) || !Number.isSafeInteger(result.expiresAt)) throw httpError(503, "password_unavailable");
      const safe = role === "admin" ? safeSession(result) : safeClientSession(result);
      reply(response, method, 200, { status: "password_changed", ...safe }, { "Set-Cookie": sessionCookie(result.token, result.expiresAt, cookies[role], { role, now: clock() }) });
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const [status, code, retry] = mapped(error);
        reply(response, method, status, { error: code }, retry ? { "Retry-After": String(retry) } : {});
      }
      request.resume();
    }
    return true;
  };
}
