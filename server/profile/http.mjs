import { checkMutation, clearCookie, hasSessionCookie, httpError, isToken, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";
import { canonicalProfileName, isProfileId, isProfileVersion, ownAvatarUrl, MAX_AVATAR_THUMBNAIL_BYTES } from "./validation.mjs";

const COOKIES = { admin: "__Host-jessie_session", client: "__Host-jessie_client" };
const invalid = () => httpError(400, "invalid_request");
const unavailable = () => httpError(503, "profile_unavailable");
let activeReads = 0;
function authenticated(value, role) {
  if (!value || value.user?.role !== role || !isProfileId(value.user.id) || !isToken(value.csrf)) throw unavailable();
  if (role === "client" && (!value.access || value.access.state !== "active" || value.access.admissionPolicy !== "manual_invitation"
    || ["invitationConsumed", "emailVerified", "approved"].some(key => value.access[key] !== true))) throw httpError(403, "request_rejected");
  return value;
}
function profile(value, role) {
  if (!value || !isProfileVersion(value.version) || !(value.avatarId === null || isProfileId(value.avatarId)) || value.avatarId !== null && value.version === "0") throw unavailable();
  let pseudonym; try { pseudonym = canonicalProfileName(value.pseudonym); } catch { throw unavailable(); }
  if (pseudonym !== value.pseudonym) throw unavailable();
  return { pseudonym, version: value.version, avatarId: value.avatarId, avatarUrl: value.avatarId === null ? null : ownAvatarUrl(role, value.version) };
}
function route(pathname) {
  const match = /^\/api\/profile\/(admin|client)(?:\/(avatar)|\/conversations\/([a-f0-9]{32})\/(avatar))?$/.exec(pathname);
  return match ? { role: match[1], image: Boolean(match[2] || match[4]), conversationId: match[3] ?? null } : null;
}
function reserve(response) {
  if (activeReads >= 8) throw Object.assign(httpError(429, "try_again_later"), { retryAfter: 5 });
  activeReads++;
  let operation = false, ended = response.writableFinished || response.destroyed, released = false;
  const onTimeout = () => response.destroy();
  const release = () => {
    if (released || !operation || !ended) return;
    released = true; activeReads--;
    response.off("finish", finished); response.off("close", finished); response.off("timeout", onTimeout);
    if (response.socket && !response.socket.destroyed) response.setTimeout(0);
  };
  const finished = () => { ended = true; release(); };
  response.once("finish", finished); response.once("close", finished); response.setTimeout(15000, onTimeout);
  return () => { operation = true; release(); };
}
function errorReply(error) {
  if (Number.isInteger(error?.httpStatus) && [400, 403, 408, 413, 415, 429, 503].includes(error.httpStatus)
    && ["invalid_request", "request_rejected", "csrf_failed", "request_timeout", "request_too_large", "json_required", "try_again_later", "profile_unavailable"].includes(error.publicCode)) return { status: error.httpStatus, code: error.publicCode, retry: error.retryAfter };
  if (["AUTH_INVALID", "CHAT_UNAUTHORIZED"].includes(error?.code)) return { status: 401, code: "authentication_required" };
  if (["CHAT_FORBIDDEN", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"].includes(error?.code)) return { status: 403, code: "request_rejected" };
  if (["PROFILE_NOT_FOUND", "CHAT_NOT_FOUND"].includes(error?.code)) return { status: 404, code: "not_found" };
  if (error?.code === "PROFILE_CONFLICT") return { status: 409, code: "profile_changed" };
  if (error?.code === "PROFILE_AVATAR") return { status: 422, code: "avatar_invalid" };
  if (error?.code === "PROFILE_INPUT") return { status: 400, code: "invalid_request" };
  if (["AUTH_RATE_LIMIT", "AUTH_BUSY"].includes(error?.code)) return { status: 429, code: "try_again_later", retry: Math.max(1, Math.min(60, Math.ceil(Number(error.retryAfter) || 60))) };
  return { status: 503, code: "profile_unavailable" };
}

export function createProfileHandler(service, { origin }) {
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.origin !== origin) throw new TypeError("Canonical HTTPS origin required");
  if (!["actor", "profile", "save", "avatar", "peerAvatar"].every(name => typeof service?.[name] === "function")) throw new TypeError("Profile service required");
  return async (request, response) => {
    let url; try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const current = route(url.pathname); if (!current) return false;
    const method = request.method ?? "GET", methods = current.image ? ["GET", "HEAD"] : ["GET", "POST"];
    if (!methods.includes(method)) { reply(response, method, 405, { error: "method_not_allowed" }, { Allow: methods.join(", ") }); return true; }
    try {
      if (method === "POST") checkMutation(request, origin, url.pathname, false);
      const cookie = COOKIES[current.role], token = sessionToken(request, cookie), value = token ? await service.actor(current.role, token) : null;
      if (!value) throw Object.assign(new Error("No profile session"), { code: "CHAT_UNAUTHORIZED" });
      const principal = authenticated(value, current.role);
      if (method === "POST" && !sameText(request.headers["x-csrf-token"], principal.csrf)) throw httpError(403, "csrf_failed");
      if (current.image) {
        if ([...url.searchParams.keys()].length !== 1 || !isProfileVersion(url.searchParams.get("v"), false)) throw invalid();
        const completed = reserve(response);
        try {
          const result = current.conversationId === null ? await service.avatar(current.role, token, url.searchParams.get("v"))
            : await service.peerAvatar(current.role, token, current.conversationId, url.searchParams.get("v"));
          if (!result || result.mime !== "image/jpeg" || !Buffer.isBuffer(result.bytes) || result.bytes.length < 5 || result.bytes.length > MAX_AVATAR_THUMBNAIL_BYTES) throw unavailable();
          if (!response.destroyed && !response.writableEnded) reply(response, method, 200, result.bytes, { "Content-Type": "image/jpeg", "Content-Length": String(result.bytes.length), "Content-Disposition": 'inline; filename="avatar.jpg"', "Accept-Ranges": "none" });
        } finally { completed(); }
      } else {
        if ([...url.searchParams].length) throw invalid();
        let body;
        if (method === "POST") {
          body = await readJson(request);
          if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 3
            || !["expectedVersion", "pseudonym", "avatarId"].every(key => Object.hasOwn(body, key))
            || !isProfileVersion(body.expectedVersion) || !(body.avatarId === null || isProfileId(body.avatarId))) throw invalid();
          try { canonicalProfileName(body.pseudonym); } catch { throw invalid(); }
        }
        const result = method === "POST" ? await service.save(current.role, token, body) : await service.profile(current.role, token);
        reply(response, method, 200, profile(result, current.role));
      }
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const value = errorReply(error), headers = value.retry ? { "Retry-After": String(value.retry) } : {};
        if (value.status === 401 && (method === "POST" || hasSessionCookie(request, COOKIES[current.role]))) headers["Set-Cookie"] = clearCookie(COOKIES[current.role]);
        if (method === "POST") { headers.Connection = "close"; request.resume(); }
        reply(response, method, value.status, { error: value.code }, headers);
      }
    }
    return true;
  };
}
