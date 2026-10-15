import { readFile } from "node:fs/promises";
import { canonicalEmail } from "../auth/config.mjs";
import { checkMutation, clearCookie, httpError, isToken, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";
import { SITE_CONTACT_EMAIL } from "../site.mjs";

const COOKIE = "__Host-jessie_session";
const MAX_DATE = 253402300799999;
const publicRoot = new URL("../../public/", import.meta.url);
const FEATURE_KEYS = Object.freeze(["clientAccess", "chat", "photos", "clientFiles", "passwordRecovery", "broadcasts"]);
const files = new Map([
  ["/admin/readiness", ["readiness.html", "text/html; charset=utf-8"]],
  ["/readiness.js", ["readiness.js", "text/javascript; charset=utf-8"]],
  ["/readiness-model.js", ["readiness-model.js", "text/javascript; charset=utf-8"]],
  ["/readiness.css", ["readiness.css", "text/css; charset=utf-8"]],
]);
const routes = new Map([
  ...[...files.keys()].map((path) => [path, ["GET", "HEAD"]]),
  ["/api/admin/readiness", ["GET"]],
  ["/api/admin/readiness/smtp", ["POST"]],
]);
const unavailable = () => httpError(503, "readiness_unavailable");
const validDate = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
const unauthorized = () => Object.assign(new Error("READINESS_UNAUTHORIZED"), { code: "READINESS_UNAUTHORIZED" });

function safeActor(value) {
  if (!value?.user || value.user.role !== "admin") throw unauthorized();
  if (typeof value.user.id !== "string" || value.user.id.length !== 32 || !/^[a-f0-9]{32}$/.test(value.user.id)
    || typeof value.user.pseudonym !== "string" || value.user.pseudonym.length > 64 || !value.user.pseudonym.isWellFormed()
    || !validDate(value.expiresAt) || !isToken(value.csrf)) throw unavailable();
  return { csrf: value.csrf };
}

function safeEmail(value) {
  try { if (canonicalEmail(value) !== value) throw unavailable(); } catch { throw unavailable(); }
  return value;
}

function safeSummary(value) {
  if (!value || value.contactEmail !== SITE_CONTACT_EMAIL || !value.mail || typeof value.mail.configured !== "boolean"
    || !value.features || !value.checks || value.checks.ageAssurance !== "pending"
    || value.checks.smtpDelivery !== "not_checked" || value.checks.deviceAcceptance !== "pending") throw unavailable();
  const sender = safeEmail(value.mail.sender), replyTo = safeEmail(value.mail.replyTo);
  if (sender !== replyTo || !value.mail.configured && sender !== SITE_CONTACT_EMAIL) throw unavailable();
  const features = {};
  for (const key of FEATURE_KEYS) {
    if (typeof value.features[key] !== "boolean") throw unavailable();
    features[key] = value.features[key];
  }
  return { contactEmail: SITE_CONTACT_EMAIL, mail: { configured: value.mail.configured, sender, replyTo }, features,
    checks: { ageAssurance: "pending", smtpDelivery: "not_checked", deviceAcceptance: "pending" } };
}

function safeProof(value) {
  if (!value || value.status !== "verified" || !validDate(value.checkedAt)
    || value.scope !== "smtp_authentication" || value.delivery !== "not_checked") throw unavailable();
  return { status: "verified", checkedAt: value.checkedAt, scope: "smtp_authentication", delivery: "not_checked" };
}

function mappedError(error) {
  const publicErrors = new Map([[400, "invalid_request"], [408, "request_timeout"], [413, "request_too_large"],
    [415, "json_required"], [503, "readiness_unavailable"]]);
  if (publicErrors.has(error?.httpStatus) && publicErrors.get(error.httpStatus) === error.publicCode || error?.httpStatus === 403
    && ["csrf_failed", "request_rejected"].includes(error.publicCode)) return { status: error.httpStatus, code: error.publicCode };
  if (["READINESS_UNAUTHORIZED", "AUTH_INVALID"].includes(error?.code)) return { status: 401, code: "authentication_required" };
  if (error?.code === "READINESS_MAIL_DISABLED") return { status: 409, code: "mail_delivery_disabled" };
  if (error?.code === "READINESS_SMTP_FAILED") return { status: 502, code: "smtp_check_failed" };
  if (error?.code === "READINESS_BUSY") return { status: 429, code: "try_again_later", retry: 5 };
  if (["READINESS_RATE_LIMIT", "AUTH_RATE_LIMIT", "AUTH_BUSY"].includes(error?.code)) {
    const raw = error.retryAfter;
    const retry = typeof raw === "number" || typeof raw === "string" && raw.length <= 32 ? Number(raw) : NaN;
    return { status: 429, code: "try_again_later", retry: Number.isFinite(retry) ? Math.max(1, Math.min(3600, Math.ceil(retry))) : 60 };
  }
  return { status: 503, code: "readiness_unavailable" };
}

/** Registration requires enabled authentication; every file and action requires a current administrator. */
export function createReadinessHandler(service, { origin }) {
  const configured = new URL(origin);
  if (configured.protocol !== "https:" || configured.origin !== origin) throw new TypeError("A canonical HTTPS site origin is required");
  for (const method of ["actor", "summary", "verifySmtp"]) {
    if (typeof service?.[method] !== "function") throw new TypeError("A private readiness service is required");
  }
  return async (request, response) => {
    let url;
    try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const allowed = routes.get(url.pathname);
    if (!allowed) return false;
    const method = request.method ?? "GET";
    if (!allowed.includes(method)) {
      const headers = { Allow: allowed.join(", ") };
      if (method === "POST") { headers.Connection = "close"; request.resume(); }
      reply(response, method, 405, { error: "method_not_allowed" }, headers);
      return true;
    }
    try {
      if (method === "POST") checkMutation(request, origin, url.pathname, false);
      const token = sessionToken(request, COOKIE);
      const actor = token ? await service.actor(token) : null;
      if (!actor) throw unauthorized();
      const current = safeActor(actor);
      if (method === "POST" && !sameText(request.headers["x-csrf-token"], current.csrf)) throw httpError(403, "csrf_failed");
      if ([...url.searchParams].length !== 0) throw httpError(400, "invalid_request");
      if (files.has(url.pathname)) {
        const [name, type] = files.get(url.pathname);
        reply(response, method, 200, await readFile(new URL(name, publicRoot)), { "Content-Type": type });
      } else if (method === "GET") {
        reply(response, method, 200, safeSummary(await service.summary(token)));
      } else {
        const body = await readJson(request);
        if (Object.keys(body).length !== 0) throw httpError(400, "invalid_request");
        reply(response, method, 200, safeProof(await service.verifySmtp(token)));
      }
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const { status, code, retry } = mappedError(error);
        const headers = retry ? { "Retry-After": String(retry) } : {};
        if (status === 401) headers["Set-Cookie"] = clearCookie(COOKIE);
        // An untrusted mutation is rejected before a JSON reader can consume its body.
        if (method === "POST" || [400, 408, 413].includes(status)) { headers.Connection = "close"; request.resume(); }
        reply(response, method, status, { error: code }, headers);
      }
    }
    return true;
  };
}
