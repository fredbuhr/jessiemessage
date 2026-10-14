import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";

export const AUTH_HEADERS = Object.freeze({
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cache-Control": "no-store",
});

const COOKIE_NAME = "__Host-jessie_session";
const MAX_BODY_BYTES = 4096;
const MAX_SESSION_SECONDS = 8 * 60 * 60;
const publicRoot = new URL("../../public/", import.meta.url);
const routeMethods = new Map([
  ["/api/auth/login", ["POST"]],
  ["/api/auth/session", ["GET"]],
  ["/api/auth/logout", ["POST"]],
  ["/api/auth/logout-all", ["POST"]],
  ["/admin/login", ["GET", "HEAD"]],
  ["/admin", ["GET", "HEAD"]],
  ["/admin-login.js", ["GET", "HEAD"]],
  ["/admin-login.css", ["GET", "HEAD"]],
]);
const publicFiles = new Map([
  ["/admin/login", ["admin-login.html", "text/html; charset=utf-8"]],
  ["/admin", ["admin-login.html", "text/html; charset=utf-8"]],
  ["/admin-login.js", ["admin-login.js", "text/javascript; charset=utf-8"]],
  ["/admin-login.css", ["admin-login.css", "text/css; charset=utf-8"]],
]);

function httpError(status, code) {
  return Object.assign(new Error(code), { httpStatus: status, publicCode: code });
}

function reply(response, method, status, body, headers = {}) {
  response.writeHead(status, {
    ...AUTH_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(method === "HEAD" ? undefined : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function isToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value)
    && Buffer.from(value, "base64url").toString("base64url") === value;
}

function sessionToken(request) {
  const header = request.headers.cookie;
  if (typeof header !== "string" || header.length > 8192) return null;
  const entries = header.split(";").map((entry) => entry.trim()).filter((entry) => entry.startsWith(`${COOKIE_NAME}=`));
  if (entries.length !== 1) return null;
  const token = entries[0].slice(COOKIE_NAME.length + 1);
  return isToken(token) ? token : null;
}

function sameText(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length > 256 || right.length > 256) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionCookie(token, expiresAt) {
  if (!isToken(token) || !Number.isFinite(expiresAt)) throw httpError(503, "authentication_unavailable");
  const seconds = Math.min(MAX_SESSION_SECONDS, Math.floor((expiresAt - Date.now()) / 1000));
  if (seconds < 1) throw httpError(503, "authentication_unavailable");
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Strict`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}

function safeSession(session) {
  const user = session?.user;
  if (!user || typeof user.id !== "string" || !/^[a-f0-9]{32}$/i.test(user.id)
    || user.role !== "admin" || typeof user.pseudonym !== "string" || user.pseudonym.length > 64
    || !Number.isFinite(session.expiresAt) || !isToken(session.csrf)) {
    throw httpError(503, "authentication_unavailable");
  }
  return {
    user: { id: user.id, role: user.role, pseudonym: user.pseudonym },
    expiresAt: session.expiresAt,
    csrf: session.csrf,
  };
}

function checkMutation(request, origin, pathname) {
  if (request.headers.origin !== origin) throw httpError(403, "request_rejected");
  const site = request.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") throw httpError(403, "request_rejected");
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType)) {
    throw httpError(415, "json_required");
  }
  if (pathname === "/api/auth/login" && request.headers["x-jessie-request"] !== "1") throw httpError(403, "request_rejected");
}

function readJson(request) {
  const length = request.headers["content-length"];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw httpError(413, "request_too_large");
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
      // An aborted IncomingMessage can emit ECONNRESET after its aborted event.
      // Keep that late transport error from becoming an unhandled exception.
      if (error && !request.complete) request.once("error", () => {});
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) finish(httpError(413, "request_too_large"));
      else chunks.push(chunk);
    };
    const onEnd = () => {
      try {
        const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid JSON object");
        finish(null, body);
      } catch { finish(httpError(400, "invalid_request")); }
    };
    const onError = () => finish(httpError(400, "invalid_request"));
    const onAborted = () => finish(httpError(400, "invalid_request"));
    const timer = setTimeout(() => finish(httpError(408, "request_timeout")), 5000);
    timer.unref();
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
  });
}

function loginPayload(body) {
  if (Object.keys(body).some((key) => !["email", "password", "factor"].includes(key))
    || typeof body.email !== "string" || !body.email.length || body.email.length > 254
    || typeof body.password !== "string" || !body.password.length || body.password.length > 128 || Buffer.byteLength(body.password) > 512
    || typeof body.factor !== "string" || body.factor.length > 64
    || !(/^\d{6}$/.test(body.factor) || /^[a-fA-F0-9 -]+$/.test(body.factor) && body.factor.replace(/[ -]/g, "").length === 32)) {
    throw httpError(400, "invalid_request");
  }
  return { email: body.email, password: body.password, factor: body.factor };
}

function mappedError(error) {
  if (Number.isInteger(error?.httpStatus)) return { status: error.httpStatus, code: error.publicCode };
  if (error?.code === "AUTH_INVALID") return { status: 401, code: "invalid_credentials" };
  if (error?.code === "AUTH_RATE_LIMIT" || error?.code === "AUTH_BUSY") {
    const retry = Number(error.retryAfter);
    return { status: 429, code: "try_again_later", retry: Number.isFinite(retry) ? Math.max(1, Math.min(3600, Math.ceil(retry))) : 60 };
  }
  return { status: 503, code: "authentication_unavailable" };
}

/** The parent server enables this handler explicitly after validating runtime configuration. */
export function createAuthHandler(service, { origin }) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin) throw new TypeError("A canonical HTTPS site origin is required");
  for (const method of ["login", "session", "logout", "logoutAll"]) {
    if (typeof service?.[method] !== "function") throw new TypeError("An authentication service is required");
  }
  return async (request, response) => {
    let pathname;
    try { pathname = new URL(request.url ?? "/", "http://localhost").pathname; }
    catch { return false; }
    const allowed = routeMethods.get(pathname);
    if (!allowed) return false;
    const method = request.method ?? "GET";
    if (!allowed.includes(method)) {
      reply(response, method, 405, { error: "method_not_allowed" }, { Allow: allowed.join(", ") });
      return true;
    }
    try {
      if (method === "POST") checkMutation(request, origin, pathname);
      if (pathname === "/api/auth/login") {
        const body = loginPayload(await readJson(request));
        const session = await service.login({ ...body, peerAddress: request.socket.remoteAddress ?? "unknown" });
        const data = safeSession(session);
        reply(response, method, 200, data, { "Set-Cookie": sessionCookie(session.token, data.expiresAt) });
      } else if (pathname === "/api/auth/session" || pathname === "/api/auth/logout" || pathname === "/api/auth/logout-all" || pathname === "/admin") {
        const token = sessionToken(request);
        const session = token ? await service.session(token) : null;
        if (!session) {
          if (pathname === "/admin") reply(response, method, 303, "", { Location: "/admin/login", "Set-Cookie": clearCookie() });
          else reply(response, method, 401, { error: "authentication_required" }, { "Set-Cookie": clearCookie() });
          return true;
        }
        const data = safeSession(session);
        if (pathname === "/api/auth/session") reply(response, method, 200, data);
        else if (pathname === "/admin") {
          const [file, type] = publicFiles.get(pathname);
          reply(response, method, 200, await readFile(new URL(file, publicRoot)), { "Content-Type": type });
        } else {
          if (!sameText(request.headers["x-csrf-token"], data.csrf)) throw httpError(403, "request_rejected");
          const body = await readJson(request);
          if (Object.keys(body).length) throw httpError(400, "invalid_request");
          if (pathname === "/api/auth/logout-all") await service.logoutAll(token);
          else await service.logout(token);
          reply(response, method, 200, { status: "signed_out" }, { "Set-Cookie": clearCookie() });
        }
      } else {
        const [file, type] = publicFiles.get(pathname);
        reply(response, method, 200, await readFile(new URL(file, publicRoot)), { "Content-Type": type });
      }
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const { status, code, retry } = mappedError(error);
        const headers = retry ? { "Retry-After": String(retry) } : {};
        if ([400, 408, 413].includes(status)) {
          headers.Connection = "close";
          request.resume();
        }
        reply(response, method, status, { error: code }, headers);
      }
    }
    return true;
  };
}
