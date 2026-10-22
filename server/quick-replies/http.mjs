import { checkMutation, clearCookie, hasSessionCookie, httpError, isToken, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";
import { ownerId, quickRepliesView, validateSave, MAX_QUICK_REPLIES_BYTES } from "./validation.mjs";

const cookie = "__Host-jessie_session", route = "/api/admin/quick-replies";
function publicError(error) {
  if (Number.isInteger(error?.httpStatus) && [[400,"invalid_request"],[401,"authentication_required"],[403,"request_rejected"],[403,"csrf_failed"],[403,"feature_read_only"],[408,"request_timeout"],[413,"request_too_large"],[415,"json_required"],[503,"quick_replies_unavailable"]]
    .some(([status, code]) => error.httpStatus === status && error.publicCode === code)) return { status: error.httpStatus, code: error.publicCode };
  if (["QUICK_REPLIES_UNAUTHORIZED", "AUTH_INVALID", "CHAT_UNAUTHORIZED"].includes(error?.code)) return { status: 401, code: "authentication_required" };
  if (["QUICK_REPLIES_FORBIDDEN", "CHAT_FORBIDDEN"].includes(error?.code)) return { status: 403, code: "request_rejected" };
  if (error?.code === "QUICK_REPLIES_INPUT") return { status: 400, code: "invalid_request" };
  if (error?.code === "QUICK_REPLIES_CONFLICT") return { status: 409, code: "quick_replies_changed" };
  if (error?.code === "QUICK_REPLIES_READ_ONLY") return { status: 403, code: "feature_read_only" };
  if (["QUICK_REPLIES_RATE_LIMIT", "QUICK_REPLIES_BUSY"].includes(error?.code)) return { status: 429, code: "try_again_later", retry: Math.max(1, Math.min(60, Math.ceil(Number(error.retryAfter) || 5))) };
  return { status: 503, code: "quick_replies_unavailable" };
}
export function createQuickRepliesHandler(service, { origin, writable = service?.writable ?? true } = {}) {
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.origin !== origin || typeof writable !== "boolean" || ["actor", "read", "save", "close"].some(name => typeof service?.[name] !== "function")) throw new TypeError("A saved replies service and canonical HTTPS origin are required.");
  const handler = async (request, response) => {
    let url; try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    if (url.pathname !== route) return false;
    const method = request.method ?? "GET";
    if (!["GET", "POST"].includes(method)) { reply(response, method, 405, { error: "method_not_allowed" }, { Allow: "GET, POST", Connection: "close" }); request.resume(); return true; }
    try {
      if ([...url.searchParams].length) throw httpError(400, "invalid_request");
      if (method === "POST") checkMutation(request, origin, route, false);
      const token = sessionToken(request, cookie);
      if (!token) throw httpError(401, "authentication_required");
      const actor = await service.actor(token);
      if (!actor?.user || actor.user.role !== "admin") throw httpError(401, "authentication_required");
      try { ownerId(actor.user.id); if (!isToken(actor.csrf)) throw new Error(); } catch { throw httpError(503, "quick_replies_unavailable"); }
      if (method === "POST" && !sameText(request.headers["x-csrf-token"], actor.csrf)) throw httpError(403, "csrf_failed");
      if (method === "POST" && !writable) throw httpError(403, "feature_read_only");
      const value = method === "GET" ? await service.read(token) : await service.save(token, validateSave(await readJson(request, { maxBytes: MAX_QUICK_REPLIES_BYTES + 128 })));
      let view; try { view = quickRepliesView(value); } catch { throw httpError(503, "quick_replies_unavailable"); }
      if (!response.destroyed && !response.writableEnded) reply(response, method, 200, { ...view, ...(!writable ? { writable: false } : {}) });
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const mapped = publicError(error), headers = mapped.retry ? { "Retry-After": String(mapped.retry) } : {};
        if (mapped.status === 401 && (method === "POST" || hasSessionCookie(request, cookie))) headers["Set-Cookie"] = clearCookie(cookie);
        if (method === "POST" || [400, 408, 413].includes(mapped.status)) { headers.Connection = "close"; request.resume(); }
        reply(response, method, mapped.status, { error: mapped.code }, headers);
      }
    }
    return true;
  };
  handler.close = () => service.close();
  return handler;
}
