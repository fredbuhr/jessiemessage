import { readFile } from "node:fs/promises";
import { checkMutation, clearCookie, httpError, isToken, readJson, reply, safeSession, sameText, sessionCookie, sessionToken } from "../auth/http.mjs";
import { decodeAccessCursor, validateAccessPage } from "./pagination.mjs";

const CLIENT_COOKIE = "__Host-jessie_client";
const publicRoot = new URL("../../public/", import.meta.url);
const files = new Map([
  ["/access", ["access.html", "text/html; charset=utf-8"]],
  ["/access.js", ["access.js", "text/javascript; charset=utf-8"]],
  ["/access.css", ["access.css", "text/css; charset=utf-8"]],
]);
const routes = new Map([
  ["/api/admin/access", ["GET"]], ["/api/admin/invitations", ["GET", "POST"]], ["/api/admin/clients", ["GET"]],
  ["/api/access/invitation", ["POST"]], ["/api/access/register", ["POST"]], ["/api/access/verify-email", ["POST"]],
  ["/api/access/resend-verification", ["POST"]], ["/api/access/login", ["POST"]], ["/api/access/session", ["GET"]],
  ["/api/access/logout", ["POST"]], ["/api/access/logout-all", ["POST"]],
]);
const preAuth = new Set(["/api/access/invitation", "/api/access/register", "/api/access/verify-email", "/api/access/resend-verification", "/api/access/login"]);
const idPattern = /^[a-f0-9]{32}$/i;
const date = (value) => (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)));
const nullableDate = (value) => value === null || date(value);
const accessDays = (value) => value === null || Number.isInteger(value) && value >= 1 && value <= 3650;
const millisecondDate = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
const unavailable = () => httpError(503, "authentication_unavailable");

function pageQuery(url, kind) {
  const options = { cursor: null, limit: 50 }, seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (!["cursor", "limit"].includes(key) || seen.has(key)) throw httpError(400, "invalid_request");
    seen.add(key);
    if (key === "cursor") {
      if (!value) throw httpError(400, "invalid_request");
      options.cursor = value;
    } else {
      if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(value)) throw httpError(400, "invalid_request");
      options.limit = Number(value);
    }
  }
  validateAccessPage(kind, options);
  return options;
}

function shape(body, keys) {
  if (Object.keys(body).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(body, key))) throw httpError(400, "invalid_request");
  return body;
}
function credentials(body) {
  if (typeof body.email !== "string" || !body.email.length || body.email.length > 254
    || typeof body.password !== "string" || !body.password.length || body.password.length > 128 || Buffer.byteLength(body.password) > 512) throw httpError(400, "invalid_request");
  return { email: body.email, password: body.password };
}
export function safeClientSession(session) {
  const { user, access } = session ?? {};
  if (!user || typeof user.id !== "string" || !idPattern.test(user.id) || user.role !== "client" || typeof user.pseudonym !== "string" || user.pseudonym.length > 64
    || !Number.isFinite(session.expiresAt) || !isToken(session.csrf) || !access || !["pending", "active", "expired"].includes(access.state)
    || ["emailVerified", "ageAssured", "approved"].some((key) => typeof access[key] !== "boolean") || !nullableDate(access.expiresAt)
    || access.state === "active" && (!access.emailVerified || !access.ageAssured || !access.approved)) throw httpError(503, "authentication_unavailable");
  return { user: { id: user.id, role: "client", pseudonym: user.pseudonym }, csrf: session.csrf, expiresAt: session.expiresAt,
    access: { state: access.state, emailVerified: access.emailVerified, ageAssured: access.ageAssured, approved: access.approved, expiresAt: access.expiresAt } };
}
function safeInvitation(value, created = false, origin) {
  if (!value || typeof value.id !== "string" || !idPattern.test(value.id) || !date(value.expiresAt) || !accessDays(value.accessDays)) throw httpError(503, "authentication_unavailable");
  const result = { id: value.id, expiresAt: value.expiresAt, accessDays: value.accessDays };
  if (created) {
    const prefix = `${origin}/access#invitation=`;
    if (typeof value.url !== "string" || !value.url.startsWith(prefix) || !isToken(value.url.slice(prefix.length))) throw httpError(503, "authentication_unavailable");
    result.url = value.url;
  } else {
    if (!millisecondDate(value.createdAt) || !["pending", "used", "expired", "revoked"].includes(value.state)
      || !(value.consumedById === null || typeof value.consumedById === "string" && idPattern.test(value.consumedById))) throw httpError(503, "authentication_unavailable");
    Object.assign(result, { createdAt: value.createdAt, state: value.state, consumedById: value.consumedById });
  }
  return result;
}
function safeClient(value) {
  if (!value || typeof value.id !== "string" || !idPattern.test(value.id) || typeof value.pseudonym !== "string" || value.pseudonym.length > 64
    || typeof value.email !== "string" || value.email.length > 254 || !["pending", "active", "suspended", "revoked", "deleted"].includes(value.status)
    || ["emailVerified", "ageAssured", "approved"].some((key) => typeof value[key] !== "boolean") || !nullableDate(value.accessExpiresAt)
    || !millisecondDate(value.createdAt)) throw httpError(503, "authentication_unavailable");
  return { id: value.id, pseudonym: value.pseudonym, email: value.email, status: value.status, emailVerified: value.emailVerified, ageAssured: value.ageAssured, approved: value.approved, accessExpiresAt: value.accessExpiresAt, createdAt: value.createdAt };
}
function safePage(value, kind, options, origin) {
  if (!value || !Array.isArray(value[kind]) || value[kind].length > options.limit || typeof value.hasMore !== "boolean"
    || value.hasMore !== (value.nextCursor !== null) || value.hasMore && value[kind].length !== options.limit) throw unavailable();
  const incoming = options.cursor === null ? null : decodeAccessCursor(kind, options.cursor);
  const incomingTime = incoming === null ? Infinity : Date.parse(`${incoming.createdAt.replace(" ", "T")}Z`);
  const seen = new Set(); let previous = Infinity;
  const rows = value[kind].map((row) => {
    const safe = kind === "clients" ? safeClient(row) : safeInvitation(row, false, origin);
    const id = safe.id.toLowerCase();
    if (seen.has(id) || safe.createdAt > previous || safe.createdAt > incomingTime || incoming?.id === id) throw unavailable();
    seen.add(id); previous = safe.createdAt;
    return safe;
  });
  if (value.nextCursor !== null) {
    let position;
    try { position = decodeAccessCursor(kind, value.nextCursor); } catch { throw unavailable(); }
    const last = rows.at(-1);
    if (!last || position.id !== last.id || Date.parse(`${position.createdAt.replace(" ", "T")}Z`) !== last.createdAt
      || incoming && (position.createdAt > incoming.createdAt || position.createdAt === incoming.createdAt && position.id >= incoming.id)) throw unavailable();
  }
  return { [kind]: rows, nextCursor: value.nextCursor, hasMore: value.hasMore };
}
function errorResponse(error) {
  if (Number.isInteger(error?.httpStatus)) return { status: error.httpStatus, code: error.publicCode };
  if (error?.code === "AUTH_INVALID") return { status: 401, code: "invalid_credentials" };
  if (error?.code === "ACCESS_FORBIDDEN") return { status: 403, code: "request_rejected" };
  if (error?.code === "ACCESS_PREREQUISITES") return { status: 409, code: "verification_required" };
  if (error?.code === "ACCESS_CONFLICT") return { status: 409, code: "access_changed" };
  if (error?.code === "ACCESS_INPUT") return { status: 400, code: "invalid_request" };
  if (error?.code === "ACCESS_REGISTRATION_FAILED") return { status: 400, code: "registration_failed" };
  if (["AUTH_RATE_LIMIT", "AUTH_BUSY"].includes(error?.code)) {
    const retry = Number(error.retryAfter);
    return { status: 429, code: "try_again_later", retry: Number.isFinite(retry) ? Math.max(1, Math.min(3600, Math.ceil(retry))) : 60 };
  }
  return { status: 503, code: "authentication_unavailable" };
}

/** Explicitly enabled by the parent server; no route provides age assurance. */
export function createAccessHandler(service, { origin }) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin) throw new TypeError("A canonical HTTPS site origin is required");
  for (const method of ["adminSession", "inspectInvitation", "createInvitation", "listInvitations", "revokeInvitation", "register", "verifyEmail", "resendVerification", "login", "session", "logout", "logoutAll", "listClients", "approveClient", "revokeClient", "renewClient"]) {
    if (typeof service?.[method] !== "function") throw new TypeError("An access service is required");
  }
  return async (request, response) => {
    let requestUrl, pathname;
    try { requestUrl = new URL(request.url ?? "/", "http://localhost"); pathname = requestUrl.pathname; } catch { return false; }
    const member = /^\/api\/admin\/(invitations|clients)\/([a-fA-F0-9]{32})\/(revoke|approve|renew)$/.exec(pathname);
    if (member && (member[1] === "invitations" && member[3] !== "revoke")) return false;
    const allowed = files.has(pathname) ? ["GET", "HEAD"] : routes.get(pathname) ?? (member ? ["POST"] : null);
    if (!allowed) return false;
    const method = request.method ?? "GET";
    if (!allowed.includes(method)) { reply(response, method, 405, { error: "method_not_allowed" }, { Allow: allowed.join(", ") }); return true; }
    try {
      if (method === "POST") checkMutation(request, origin, pathname, preAuth.has(pathname));
      let page;
      if (method === "GET" && pathname.startsWith("/api/")) {
        if (["/api/admin/clients", "/api/admin/invitations"].includes(pathname)) page = pageQuery(requestUrl, pathname.endsWith("clients") ? "clients" : "invitations");
        else if (requestUrl.searchParams.size) throw httpError(400, "invalid_request");
      }
      if (files.has(pathname)) {
        const [name, type] = files.get(pathname);
        reply(response, method, 200, await readFile(new URL(name, publicRoot)), { "Content-Type": type });
        return true;
      }
      let adminToken;
      if (pathname.startsWith("/api/admin/")) {
        adminToken = sessionToken(request);
        const session = adminToken ? await service.adminSession(adminToken) : null;
        if (!session) throw httpError(401, "authentication_required");
        const data = safeSession(session);
        if (method === "POST" && !sameText(request.headers["x-csrf-token"], data.csrf)) throw httpError(403, "request_rejected");
      }
      const peerAddress = request.socket.remoteAddress ?? "unknown";
      if (pathname === "/api/admin/access") reply(response, method, 200, { capabilities: { emailDelivery: "configured", ageAssurance: "pending" } });
      else if (pathname === "/api/admin/invitations" && method === "GET") {
        reply(response, method, 200, safePage(await service.listInvitations(adminToken, page), "invitations", page, origin));
      } else if (pathname === "/api/admin/invitations") {
        const body = shape(await readJson(request), ["lifetimeHours", "accessDays"]);
        if (!Number.isInteger(body.lifetimeHours) || body.lifetimeHours < 1 || body.lifetimeHours > 720 || !accessDays(body.accessDays)) throw httpError(400, "invalid_request");
        reply(response, method, 201, safeInvitation(await service.createInvitation(adminToken, body), true, origin));
      } else if (pathname === "/api/admin/clients") {
        reply(response, method, 200, safePage(await service.listClients(adminToken, page), "clients", page, origin));
      } else if (member?.[3] === "renew") {
        const body = shape(await readJson(request), ["accessDays", "expectedExpiresAt"]);
        if (!Number.isInteger(body.accessDays) || body.accessDays < 1 || body.accessDays > 3650 || !millisecondDate(body.expectedExpiresAt)) throw httpError(400, "invalid_request");
        const target = member[2].toLowerCase();
        const renewed = await service.renewClient(adminToken, target, body);
        if (renewed === null) reply(response, method, 404, { error: "not_found" });
        else {
          if (!renewed || renewed.id !== target || !millisecondDate(renewed.accessExpiresAt)
            || renewed.accessExpiresAt <= Date.now() || renewed.accessExpiresAt <= body.expectedExpiresAt) throw unavailable();
          reply(response, method, 200, { status: "renewed", client: { id: renewed.id, accessExpiresAt: renewed.accessExpiresAt } });
        }
      } else if (member) {
        shape(await readJson(request), []);
        const action = member[1] === "invitations" ? "revokeInvitation" : member[3] === "approve" ? "approveClient" : "revokeClient";
        const changed = await service[action](adminToken, member[2].toLowerCase());
        reply(response, method, changed ? 200 : 404, changed ? { status: member[3] === "approve" ? "approved" : "revoked" } : { error: "not_found" });
      } else if (pathname === "/api/access/invitation") {
        const body = shape(await readJson(request), ["token"]);
        if (!isToken(body.token)) throw httpError(400, "invalid_request");
        const invitation = await service.inspectInvitation({ token: body.token, peerAddress });
        if (!invitation) throw httpError(401, "invalid_credentials");
        if (!date(invitation.expiresAt) || !accessDays(invitation.accessDays)) throw httpError(503, "authentication_unavailable");
        reply(response, method, 200, { expiresAt: invitation.expiresAt, accessDays: invitation.accessDays });
      } else if (pathname === "/api/access/register") {
        const body = shape(await readJson(request), ["invitationToken", "email", "pseudonym", "password", "ageDeclared"]);
        const login = credentials(body);
        if (!isToken(body.invitationToken) || typeof body.pseudonym !== "string" || !body.pseudonym.trim() || body.pseudonym.length > 64 || body.password.length < 14 || body.ageDeclared !== true) throw httpError(400, "invalid_request");
        const result = await service.register({ ...login, pseudonym: body.pseudonym, invitationToken: body.invitationToken, ageDeclared: true, peerAddress });
        if (result?.status !== "verification_pending") throw httpError(503, "authentication_unavailable");
        reply(response, method, 202, { status: "verification_pending" });
      } else if (pathname === "/api/access/verify-email") {
        const body = shape(await readJson(request), ["token"]);
        if (!isToken(body.token)) throw httpError(400, "invalid_request");
        const result = await service.verifyEmail({ token: body.token, peerAddress });
        if (result?.status !== "email_verified") throw httpError(503, "authentication_unavailable");
        reply(response, method, 200, { status: "email_verified" });
      } else if (pathname === "/api/access/resend-verification") {
        const body = credentials(shape(await readJson(request), ["email", "password"]));
        const result = await service.resendVerification({ ...body, peerAddress });
        if (result?.status !== "accepted") throw httpError(503, "authentication_unavailable");
        reply(response, method, 202, { status: "accepted" });
      } else if (pathname === "/api/access/login") {
        const body = credentials(shape(await readJson(request), ["email", "password"]));
        const session = await service.login({ ...body, peerAddress });
        const data = safeClientSession(session);
        reply(response, method, 200, data, { "Set-Cookie": sessionCookie(session.token, data.expiresAt, CLIENT_COOKIE) });
      } else {
        const token = sessionToken(request, CLIENT_COOKIE);
        const session = token ? await service.session(token) : null;
        if (!session) { reply(response, method, 401, { error: "authentication_required" }, { "Set-Cookie": clearCookie(CLIENT_COOKIE) }); return true; }
        const data = safeClientSession(session);
        if (pathname === "/api/access/session") reply(response, method, 200, data);
        else {
          if (!sameText(request.headers["x-csrf-token"], data.csrf)) throw httpError(403, "request_rejected");
          shape(await readJson(request), []);
          await service[pathname === "/api/access/logout-all" ? "logoutAll" : "logout"](token);
          reply(response, method, 200, { status: "signed_out" }, { "Set-Cookie": clearCookie(CLIENT_COOKIE) });
        }
      }
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const { status, code, retry } = errorResponse(error);
        const headers = retry ? { "Retry-After": String(retry) } : {};
        if ([400, 408, 413].includes(status)) { headers.Connection = "close"; request.resume(); }
        reply(response, method, status, { error: code }, headers);
      }
    }
    return true;
  };
}
