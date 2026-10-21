import { readFile } from "node:fs/promises";
import { checkMutation, clearCookie, hasSessionCookie, httpError, isToken, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";
import { announcementView } from "./service.mjs";
import { fields, id, instant, validateRemove, validateSave } from "./validation.mjs";

const root = new URL("../../public/", import.meta.url);
const cookies = { admin: "__Host-jessie_session", client: "__Host-jessie_client" };
const files = new Map([
  ["/admin/announcements", ["announcements.html", "text/html; charset=utf-8", "admin"]],
  ["/announcements.js", ["announcements.js", "text/javascript; charset=utf-8", "admin"]],
  ["/announcements-model.js", ["announcements-model.js", "text/javascript; charset=utf-8", "admin"]],
  ["/announcements.css", ["announcements.css", "text/css; charset=utf-8", "admin"]],
  ["/announcement-banner.js", ["announcement-banner.js", "text/javascript; charset=utf-8", "client"]],
  ["/announcement-banner.css", ["announcement-banner.css", "text/css; charset=utf-8", "client"]],
]);
function route(path) {
  if (path === "/admin/announcements") return { kind: "page", role: "admin", methods: ["GET", "HEAD"] };
  if (files.has(path)) return { kind: "asset", role: files.get(path)[2], methods: ["GET", "HEAD"] };
  if (path === "/api/announcements/admin/session") return { kind: "session", role: "admin", methods: ["GET"] };
  if (path === "/api/announcements/admin/preview") return { kind: "preview", role: "admin", methods: ["POST"] };
  if (path === "/api/announcements/admin/current") return { kind: "current", role: "admin", methods: ["GET", "POST"] };
  if (path === "/api/announcements/admin/current/remove") return { kind: "remove", role: "admin", methods: ["POST"] };
  if (path === "/api/announcements/client/current") return { kind: "current", role: "client", methods: ["GET"] };
  return null;
}
function actorView(value, role) {
  if (!value?.user || value.user.role !== role) throw httpError(401, "unauthorized");
  try { id(value.user.id); instant(value.expiresAt); } catch { throw httpError(503, "announcements_unavailable"); }
  if (!isToken(value.csrf) || typeof value.user.pseudonym !== "string" || value.user.pseudonym.length > 64 || !value.user.pseudonym.isWellFormed()) throw httpError(503, "announcements_unavailable");
  return { user: { id: value.user.id, role, pseudonym: value.user.pseudonym }, csrf: value.csrf, expiresAt: value.expiresAt };
}
function publicError(error) {
  const known = new Map([[400, "invalid_request"], [401, "unauthorized"], [408, "request_timeout"], [413, "request_too_large"], [415, "json_required"], [503, "announcements_unavailable"]]);
  if (known.get(error?.httpStatus) === error?.publicCode && known.has(error?.httpStatus)
    || error?.httpStatus === 403 && ["csrf_failed", "request_rejected"].includes(error.publicCode)) return { status: error.httpStatus, code: error.publicCode };
  if (["ANNOUNCEMENTS_UNAUTHORIZED", "CHAT_UNAUTHORIZED", "AUTH_INVALID"].includes(error?.code)) return { status: 401, code: "unauthorized" };
  if (["ANNOUNCEMENTS_FORBIDDEN", "CHAT_FORBIDDEN", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"].includes(error?.code)) return { status: 403, code: "forbidden" };
  if (error?.code === "ANNOUNCEMENTS_INPUT") return { status: 400, code: "invalid_request" };
  if (error?.code === "ANNOUNCEMENTS_CONFLICT") return { status: 409, code: "conflict" };
  if (error?.code === "ANNOUNCEMENTS_RATE_LIMIT") return { status: 429, code: "rate_limit", retry: Math.max(1, Math.min(3600, Math.ceil(error.retryAfter) || 60)) };
  return { status: 503, code: "announcements_unavailable" };
}
function checkedView(value, role, mutation) {
  try { return announcementView(value, role, mutation); } catch { throw httpError(503, "announcements_unavailable"); }
}
export function createAnnouncementsHandler(service, { origin = "https://jessiemessage.com" } = {}) {
  const configured = new URL(origin);
  if (configured.protocol !== "https:" || configured.origin !== origin) throw new TypeError("A canonical HTTPS site origin is required.");
  if (!["actor", "current", "preview", "save", "remove"].every(name => typeof service?.[name] === "function")) throw new TypeError("Announcement service is required.");
  return async (request, response) => {
    let url;
    try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const target = route(url.pathname); if (!target) return false;
    const method = request.method ?? "GET";
    if (!target.methods.includes(method)) {
      reply(response, method, 405, { error: "method_not_allowed" }, { Allow: target.methods.join(", "), Connection: "close" }); request.resume(); return true;
    }
    try {
      if (method === "POST") checkMutation(request, origin, url.pathname, false);
      if ([...url.searchParams].length) throw httpError(400, "invalid_request");
      const token = sessionToken(request, cookies[target.role]);
      if (!token) throw httpError(401, "unauthorized");
      const actor = actorView(await service.actor(target.role, token), target.role);
      if (method === "POST" && !sameText(request.headers["x-csrf-token"], actor.csrf)) throw httpError(403, "csrf_failed");
      if (target.kind === "asset" || target.kind === "page") {
        const [name, type] = files.get(url.pathname); reply(response, method, 200, await readFile(new URL(name, root)), { "Content-Type": type });
      } else if (target.kind === "session") reply(response, method, 200, actor);
      else if (target.kind === "preview") {
        const input = await readJson(request, { maxBytes: 2048 }); fields(input, []);
        const value = await service.preview(token, input);
        try { fields(value, ["totalCount", "eligibleCount", "excludedCount", "previewToken"]); }
        catch { throw httpError(503, "announcements_unavailable"); }
        if (![value.totalCount, value.eligibleCount, value.excludedCount].every(n => Number.isSafeInteger(n) && n >= 0)
          || value.totalCount !== value.eligibleCount + value.excludedCount || typeof value.previewToken !== "string" || value.previewToken.length < 1 || value.previewToken.length > 4096) throw httpError(503, "announcements_unavailable");
        reply(response, method, 200, value);
      } else if (target.kind === "remove") {
        const input = validateRemove(await readJson(request, { maxBytes: 2048 }));
        reply(response, method, 200, checkedView(await service.remove(token, input), "admin", true));
      } else if (method === "POST") {
        const input = validateSave(await readJson(request, { maxBytes: 16384 }));
        reply(response, method, 200, checkedView(await service.save(token, input), "admin", true));
      } else reply(response, method, 200, checkedView(await service.current(target.role, token), target.role, false));
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const mapped = publicError(error), headers = mapped.retry ? { "Retry-After": String(mapped.retry) } : {};
        if (mapped.status === 401 && (method === "POST" || hasSessionCookie(request, cookies[target.role]))) headers["Set-Cookie"] = clearCookie(cookies[target.role]);
        if (mapped.status === 401 && target.kind === "page") {
          reply(response, method, 303, Buffer.alloc(0), { ...headers, Location: "/admin/login?continue=%2Fadmin%2Fannouncements", "Content-Type": "text/plain; charset=utf-8" }); return true;
        }
        if (method === "POST" || [400, 408, 413].includes(mapped.status)) { headers.Connection = "close"; request.resume(); }
        reply(response, method, mapped.status, { error: mapped.code }, headers);
      }
    }
    return true;
  };
}
