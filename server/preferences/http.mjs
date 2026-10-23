import { checkMutation, httpError, isToken, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";
import { ownerId, validatePreferencesSave, validatePreferencesView, MAX_PREFERENCES_BODY_BYTES } from "./validation.mjs";
const cookies = { admin: "__Host-jessie_session", client: "__Host-jessie_client" };
function publicError(error) {
  if (Number.isInteger(error?.httpStatus) && [400, 401, 403, 408, 413, 415].includes(error.httpStatus)) return { status: error.httpStatus, code: error.publicCode };
  if (["PREFERENCES_UNAUTHORIZED", "AUTH_INVALID", "CHAT_UNAUTHORIZED"].includes(error?.code)) return { status: 401, code: "authentication_required" };
  if (error?.code === "PREFERENCES_FORBIDDEN") return { status: 403, code: "request_rejected" };
  if (error?.code === "PREFERENCES_NOT_FOUND") return { status: 404, code: "not_found" };
  if (error?.code === "PREFERENCES_INPUT") return { status: 400, code: "invalid_request" };
  if (error?.code === "PREFERENCES_CONFLICT") return { status: 409, code: "preferences_changed" };
  if (error?.code === "PREFERENCES_CATALOGUE_CHANGED") return { status: 409, code: "preferences_catalogue_changed" };
  if (error?.code === "PREFERENCES_RATE_LIMIT") return { status: 429, code: "try_again_later", retry: Math.max(1, Math.min(60, Math.ceil(Number(error.retryAfter) || 5))) };
  return { status: 503, code: "preferences_unavailable" };
}
export function createPreferencesHandler(service, { origin }) {
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.origin !== origin || ["actor", "read", "save", "peer"].some(name => typeof service?.[name] !== "function")) throw new TypeError("A private preferences service is required.");
  return async (request, response) => {
    let url; try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const route = /^\/api\/profile\/(admin|client)(?:\/conversations\/([a-f0-9]{32}))?\/preferences$/.exec(url.pathname);
    if (!route) return false;
    const role = route[1], conversationId = route[2] ?? null, method = request.method ?? "GET", allowed = conversationId === null ? ["GET", "POST"] : ["GET"];
    if (!allowed.includes(method)) { reply(response, method, 405, { error: "method_not_allowed" }, { Allow: allowed.join(", "), Connection: "close" }); request.resume(); return true; }
    try {
      if ([...url.searchParams].length) throw httpError(400, "invalid_request");
      if (conversationId !== null && role !== "admin") throw httpError(403, "request_rejected");
      if (method === "POST") checkMutation(request, origin, url.pathname, false);
      const token = sessionToken(request, cookies[role]); if (!token) throw httpError(401, "authentication_required");
      const principal = await service.actor(role, token);
      if (principal?.user?.role !== role || !isToken(principal.csrf)) throw httpError(401, "authentication_required");
      ownerId(principal.user.id);
      if (method === "POST" && !sameText(request.headers["x-csrf-token"], principal.csrf)) throw httpError(403, "csrf_failed");
      const value = method === "POST" ? await service.save(role, token, validatePreferencesSave(await readJson(request, { maxBytes: MAX_PREFERENCES_BODY_BYTES })))
        : conversationId === null ? await service.read(role, token) : await service.peer(role, token, conversationId);
      let view; try { view = validatePreferencesView(value); } catch { throw httpError(503, "preferences_unavailable"); }
      if (!response.destroyed && !response.writableEnded) reply(response, method, 200, view);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const mapped = publicError(error), headers = mapped.retry ? { "Retry-After": String(mapped.retry) } : {};
        if (method === "POST" || [400, 408, 413].includes(mapped.status)) { headers.Connection = "close"; request.resume(); }
        reply(response, method, mapped.status, { error: mapped.code }, headers);
      }
    }
    return true;
  };
}
