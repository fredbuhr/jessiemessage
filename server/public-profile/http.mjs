import { checkMutation, httpError, isToken, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";
import { MAX_PUBLIC_PROFILE_BYTES, validatePublicProfileInput } from "./validation.mjs";

function publicError(error) {
  if (Number.isInteger(error?.httpStatus) && [400, 401, 403, 408, 413, 415].includes(error.httpStatus)) return { status: error.httpStatus, code: error.publicCode };
  if (["PUBLIC_PROFILE_UNAUTHORIZED", "AUTH_INVALID", "CHAT_UNAUTHORIZED"].includes(error?.code)) return { status: 401, code: "authentication_required" };
  if (error?.code === "PUBLIC_PROFILE_FORBIDDEN") return { status: 403, code: "request_rejected" };
  if (error?.code === "PUBLIC_PROFILE_NOT_FOUND") return { status: 404, code: "not_found" };
  if (error?.code === "PUBLIC_PROFILE_INPUT") return { status: 400, code: "invalid_request" };
  if (error?.code === "PUBLIC_PROFILE_CONFLICT") return { status: 409, code: "public_profile_changed" };
  if (["PUBLIC_PROFILE_RATE_LIMIT", "PUBLIC_PROFILE_BUSY"].includes(error?.code)) return { status: 429, code: "try_again_later", retry: Math.max(1, Math.min(60, Math.ceil(Number(error.retryAfter) || 5))) };
  return { status: 503, code: "public_profile_unavailable" };
}
function dto(value, publicRead) {
  if (!value || typeof value !== "object" || typeof value.displayName !== "string" || typeof value.bio !== "string" || typeof value.catalogueVersion !== "string" || !Array.isArray(value.selectedIds)) throw httpError(503, "public_profile_unavailable");
  const base = { displayName: value.displayName, bio: value.bio, catalogueVersion: value.catalogueVersion, selectedIds: [...value.selectedIds] };
  // Revalidate the full shape rather than returning service-owned extra fields.
  const checked = validatePublicProfileInput({ expectedVersion: "0", published: publicRead ? true : value.published, ...base });
  if (publicRead) return { displayName: checked.displayName, bio: checked.bio, catalogueVersion: checked.catalogueVersion, selectedIds: checked.selectedIds };
  if (typeof value.version !== "string" || !/^(?:0|[1-9][0-9]{0,9})$/.test(value.version) || Number(value.version) > 4294967295) throw httpError(503, "public_profile_unavailable");
  return { version: value.version, published: checked.published, ...base, selectedIds: checked.selectedIds };
}
export function createPublicProfileHandler(service, { origin }) {
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.origin !== origin || ["actor", "read", "save", "publicView"].some(name => typeof service?.[name] !== "function")) throw new TypeError("A public-profile service is required.");
  return async (request, response) => {
    let url; try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const publicRead = url.pathname === "/api/public/jessie", admin = url.pathname === "/api/profile/admin/publication";
    if (!publicRead && !admin) return false;
    const method = request.method ?? "GET", methods = publicRead ? ["GET", "HEAD"] : ["GET", "POST"];
    if (!methods.includes(method)) { reply(response, method, 405, { error: "method_not_allowed" }, { Allow: methods.join(", "), Connection: "close" }); request.resume(); return true; }
    try {
      if ([...url.searchParams].length) throw httpError(400, "invalid_request");
      let value;
      if (publicRead) value = await service.publicView();
      else {
        if (method === "POST") checkMutation(request, origin, url.pathname, false);
        const token = sessionToken(request, "__Host-jessie_session"); if (!token) throw httpError(401, "authentication_required");
        const principal = await service.actor(token);
        if (principal?.user?.role !== "admin" || !isToken(principal.csrf)) throw httpError(401, "authentication_required");
        if (method === "POST" && !sameText(request.headers["x-csrf-token"], principal.csrf)) throw httpError(403, "csrf_failed");
        value = method === "POST" ? await service.save(token, validatePublicProfileInput(await readJson(request, { maxBytes: MAX_PUBLIC_PROFILE_BYTES }))) : await service.read(token);
      }
      let view; try { view = dto(value, publicRead); } catch { throw httpError(503, "public_profile_unavailable"); }
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
