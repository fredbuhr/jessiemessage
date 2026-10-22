import { readFile } from "node:fs/promises";
import { checkMutation, httpError, isToken, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";
import { taskGetView, taskListView, taskSaveView, taskSummaryView } from "./service.mjs";
import { id, instant, validateList, validateSave } from "./validation.mjs";

const root = new URL("../../public/", import.meta.url), cookie = "__Host-jessie_session";
const files = new Map([
  ["/admin/tasks", ["tasks.html", "text/html; charset=utf-8"]],
  ["/tasks.js", ["tasks.js", "text/javascript; charset=utf-8"]],
  ["/tasks-model.js", ["tasks-model.js", "text/javascript; charset=utf-8"]],
  ["/tasks.css", ["tasks.css", "text/css; charset=utf-8"]],
]);
function route(pathname) {
  if (files.has(pathname)) return { kind: pathname === "/admin/tasks" ? "page" : "asset", methods: ["GET", "HEAD"] };
  if (pathname === "/api/admin/crm/tasks/session") return { kind: "session", methods: ["GET"] };
  if (pathname === "/api/admin/crm/tasks/summary") return { kind: "summary", methods: ["GET"] };
  if (pathname === "/api/admin/crm/tasks") return { kind: "list", methods: ["GET"] };
  const match = /^\/api\/admin\/crm\/tasks\/([a-f0-9]{32})$/.exec(pathname);
  return match ? { kind: "task", taskId: match[1], methods: ["GET", "POST"] } : null;
}
function actorView(value) {
  if (!value?.user || value.user.role !== "admin") throw httpError(401, "authentication_required");
  try { id(value.user.id); instant(value.expiresAt); } catch { throw httpError(503, "tasks_unavailable"); }
  if (!isToken(value.csrf) || typeof value.user.pseudonym !== "string" || value.user.pseudonym.length > 64 || !value.user.pseudonym.isWellFormed()) throw httpError(503, "tasks_unavailable");
  return { user: { id: value.user.id, role: "admin", pseudonym: value.user.pseudonym }, csrf: value.csrf, expiresAt: value.expiresAt };
}
function query(url, list = false, page = false) {
  const value = Object.create(null), allowed = list ? ["filter", "conversationId", "afterId", "limit"] : page ? ["conversationId"] : [];
  for (const [name, item] of url.searchParams) {
    if (!allowed.includes(name) || Object.hasOwn(value, name)) throw httpError(400, "invalid_request");
    value[name] = item;
  }
  if (!list) {
    if (page && value.conversationId !== undefined) id(value.conversationId);
    return null;
  }
  if (value.limit !== undefined) {
    if (!/^(?:[1-9][0-9]?|100)$/.test(value.limit)) throw httpError(400, "invalid_request");
    value.limit = Number(value.limit);
  }
  return validateList(value);
}
function publicError(error) {
  const known = new Map([[400, "invalid_request"], [401, "authentication_required"], [408, "request_timeout"], [413, "request_too_large"], [415, "json_required"], [503, "tasks_unavailable"]]);
  if (known.get(error?.httpStatus) === error?.publicCode && known.has(error?.httpStatus)
    || error?.httpStatus === 403 && ["csrf_failed", "request_rejected"].includes(error.publicCode)) return { status: error.httpStatus, code: error.publicCode };
  if (["TASKS_UNAUTHORIZED", "CHAT_UNAUTHORIZED", "AUTH_INVALID"].includes(error?.code)) return { status: 401, code: "authentication_required" };
  if (["TASKS_FORBIDDEN", "CHAT_FORBIDDEN", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"].includes(error?.code)) return { status: 403, code: "request_rejected" };
  if (["TASKS_NOT_FOUND", "CHAT_NOT_FOUND"].includes(error?.code)) return { status: 404, code: "not_found" };
  if (error?.code === "TASKS_INPUT") return { status: 400, code: "invalid_request" };
  if (error?.code === "TASKS_CONFLICT") return { status: 409, code: "task_changed" };
  if (error?.code === "TASKS_LIMIT") return { status: 409, code: "limit_reached" };
  if (error?.code === "TASKS_RATE_LIMIT") return { status: 429, code: "try_again_later", retry: Math.max(1, Math.min(3600, Math.ceil(error.retryAfter) || 60)) };
  return { status: 503, code: "tasks_unavailable" };
}
export function createTasksHttpHandler(service, { origin = "https://jessiemessage.com", enabled = true } = {}) {
  const configured = new URL(origin);
  if (configured.protocol !== "https:" || configured.origin !== origin || typeof enabled !== "boolean") throw new TypeError("A canonical HTTPS site origin and boolean task switch are required.");
  if (!["actor", "list", "summary", "get", "save"].every(name => typeof service?.[name] === "function")) throw new TypeError("Task service is required.");
  return async (request, response) => {
    if (!enabled) return false;
    let url;
    try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const target = route(url.pathname); if (!target) return false;
    const method = request.method ?? "GET";
    if (!target.methods.includes(method)) {
      reply(response, method, 405, { error: "method_not_allowed" }, { Allow: target.methods.join(", "), Connection: "close" }); request.resume(); return true;
    }
    try {
      if (method === "POST") checkMutation(request, origin, url.pathname, false);
      const options = query(url, target.kind === "list", target.kind === "page"), token = sessionToken(request, cookie);
      if (!token) throw httpError(401, "authentication_required");
      const actor = actorView(await service.actor(token));
      if (method === "POST" && !sameText(request.headers["x-csrf-token"], actor.csrf)) throw httpError(403, "csrf_failed");
      if (target.kind === "page" || target.kind === "asset") {
        const [name, type] = files.get(url.pathname); reply(response, method, 200, await readFile(new URL(name, root)), { "Content-Type": type });
      } else if (target.kind === "session") reply(response, method, 200, actor);
      else if (target.kind === "summary") reply(response, method, 200, taskSummaryView(await service.summary(token)));
      else if (target.kind === "list") reply(response, method, 200, taskListView(await service.list(token, options), options));
      else if (method === "GET") reply(response, method, 200, taskGetView(await service.get(token, target.taskId), target.taskId));
      else {
        const input = validateSave(await readJson(request, { maxBytes: 8192 }));
        reply(response, method, 200, taskSaveView(await service.save(token, target.taskId, input), target.taskId, input));
      }
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const mapped = publicError(error), headers = mapped.retry ? { "Retry-After": String(mapped.retry) } : {};
        if (mapped.status === 401 && target.kind === "page") {
          reply(response, method, 303, Buffer.alloc(0), { ...headers, Location: "/admin/login?continue=%2Fadmin%2Ftasks", "Content-Type": "text/plain; charset=utf-8" }); return true;
        }
        if (method === "POST" || [400, 408, 413].includes(mapped.status)) { headers.Connection = "close"; request.resume(); }
        reply(response, method, mapped.status, { error: mapped.code }, headers);
      }
    }
    return true;
  };
}
