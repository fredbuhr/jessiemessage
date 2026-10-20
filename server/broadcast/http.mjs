import { readFile } from "node:fs/promises";
import { checkMutation, clearCookie, hasSessionCookie, httpError, isToken, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";
import { validateCampaign, validateId, validatePreview } from "./validation.mjs";

const publicRoot = new URL("../../public/", import.meta.url);
const COOKIES = Object.freeze({ admin: "__Host-jessie_session" });
const MAX_DATE = 253402300799999;
const STATES = Object.freeze(["pending", "sending", "delivered", "skipped", "cancelled", "failed"]);
const REASONS = Object.freeze(["access_inactive", "opted_out", "conversation_unavailable", "media_unavailable", "repeat_media", "expired", "administrator_invalid", "processing_failed", "cancelled"]);
const files = new Map([
  ["/admin/broadcasts", ["broadcast.html", "text/html; charset=utf-8", "admin"]],
  ["/broadcast.js", ["broadcast.js", "text/javascript; charset=utf-8", "admin"]],
  ["/broadcast-model.js", ["broadcast-model.js", "text/javascript; charset=utf-8", "admin"]],
  ["/broadcast.css", ["broadcast.css", "text/css; charset=utf-8", "admin"]],
]);
const invalid = () => httpError(400, "invalid_request");
const unavailable = () => httpError(503, "broadcast_unavailable");
const unauthorized = () => Object.assign(new Error("BROADCAST_UNAUTHORIZED"), { code: "BROADCAST_UNAUTHORIZED" });
const id = (value) => typeof value === "string" && value.length === 32 && /^[a-f0-9]{32}$/.test(value);
const date = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
const nullableDate = (value) => value === null || date(value);
const pseudonym = (value) => typeof value === "string" && value.length <= 64 && value.isWellFormed();
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 100;

function checked(validate, value) {
  try { return validate(value); } catch { throw unavailable(); }
}

function safeActor(value, role) {
  if (!value?.user || value.user.role !== role) throw unauthorized();
  if (!id(value.user.id) || !pseudonym(value.user.pseudonym) || !date(value.expiresAt) || !isToken(value.csrf)) throw unavailable();
  return { user: { id: value.user.id, role, pseudonym: value.user.pseudonym }, csrf: value.csrf, expiresAt: value.expiresAt };
}

function shape(body, keys) {
  if (Object.keys(body).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(body, key))) throw invalid();
  return body;
}

function query(url, paginated = false) {
  const result = { afterId: null, limit: 20 };
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (!paginated || !["afterId", "limit"].includes(key) || seen.has(key)) throw invalid();
    seen.add(key);
    if (key === "afterId") { validateId(value); result.afterId = value; }
    else {
      if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(value)) throw invalid();
      result.limit = Number(value);
    }
  }
  return result;
}

function routeFor(pathname) {
  if (files.has(pathname)) return { kind: "asset", role: files.get(pathname)[2], methods: ["GET", "HEAD"] };
  if (pathname === "/api/broadcast/admin/session") return { kind: "session", role: "admin", methods: ["GET"] };
  if (pathname === "/api/broadcast/admin/preview") return { kind: "preview", role: "admin", methods: ["POST"] };
  if (pathname === "/api/broadcast/admin/activity") return { kind: "activity", role: "admin", methods: ["GET"] };
  if (pathname === "/api/broadcast/admin/campaigns") return { kind: "campaigns", role: "admin", methods: ["GET", "POST"] };
  const match = /^\/api\/broadcast\/admin\/campaigns\/([a-f0-9]{32})(\/cancel)?$/.exec(pathname);
  return match ? { kind: match[2] ? "cancel" : "campaign", role: "admin", campaignId: match[1], methods: match[2] ? ["POST"] : ["GET"] } : null;
}

function safePreview(value, requested) {
  if (!value || !Array.isArray(value.recipients) || value.recipients.length !== requested.conversationIds.length
    || !count(value.eligibleCount) || !count(value.repeatCount)) throw unavailable();
  const expected = new Set(requested.conversationIds.map((value) => value.toString("hex")));
  let eligibleCount = 0, repeatCount = 0;
  const recipients = value.recipients.map((recipient) => {
    if (!recipient || !id(recipient.conversationId) || !expected.delete(recipient.conversationId)
      || !recipient.client || !id(recipient.client.id) || !pseudonym(recipient.client.pseudonym)
      || typeof recipient.eligible !== "boolean" || typeof recipient.repeatMedia !== "boolean"
      || ![null, "access_inactive", "conversation_unavailable"].includes(recipient.reason)
      || recipient.eligible !== (recipient.reason === null)
      || requested.mediaId === null && recipient.repeatMedia) throw unavailable();
    eligibleCount += Number(recipient.eligible); repeatCount += Number(recipient.repeatMedia);
    return { conversationId: recipient.conversationId, client: { id: recipient.client.id, pseudonym: recipient.client.pseudonym },
      eligible: recipient.eligible, reason: recipient.reason, repeatMedia: recipient.repeatMedia };
  });
  if (expected.size || value.eligibleCount !== eligibleCount || value.repeatCount !== repeatCount) throw unavailable();
  return { recipients, eligibleCount, repeatCount };
}

function safeCampaign(value, { detail = false, campaignId = null } = {}) {
  if (!value || !id(value.id) || campaignId !== null && value.id !== campaignId || !id(value.clientCampaignId)
    || !["queued", "running", "completed", "cancelled", "paused"].includes(value.status)
    || !date(value.createdAt) || !date(value.updatedAt) || value.updatedAt < value.createdAt
    || !date(value.expiresAt) || value.expiresAt <= value.createdAt || !value.counts
    || !count(value.counts.total) || value.counts.total < 1 || !STATES.every((state) => count(value.counts[state]))
    || STATES.reduce((sum, state) => sum + value.counts[state], 0) !== value.counts.total
    || ["completed", "cancelled", "paused"].includes(value.status) && (value.counts.pending || value.counts.sending)) throw unavailable();
  checked(validateCampaign, { clientCampaignId: value.clientCampaignId, title: value.title, body: value.body,
    mediaId: value.mediaId, allowRepeatMedia: value.allowRepeatMedia, conversationIds: [value.id] });
  const result = { id: value.id, clientCampaignId: value.clientCampaignId, title: value.title, body: value.body,
    mediaId: value.mediaId, allowRepeatMedia: value.allowRepeatMedia, status: value.status,
    createdAt: value.createdAt, updatedAt: value.updatedAt, expiresAt: value.expiresAt,
    counts: Object.fromEntries(["total", ...STATES].map((state) => [state, value.counts[state]])) };
  if (!detail) return result;
  if (!Array.isArray(value.recipients) || value.recipients.length !== value.counts.total) throw unavailable();
  const seen = new Set(), counts = Object.fromEntries(STATES.map((state) => [state, 0]));
  result.recipients = value.recipients.map((recipient) => {
    if (!recipient || !id(recipient.conversationId) || seen.has(recipient.conversationId) || !recipient.client
      || !id(recipient.client.id) || !pseudonym(recipient.client.pseudonym) || !STATES.includes(recipient.state)
      || ![null, ...REASONS].includes(recipient.reason) || !(recipient.messageId === null || id(recipient.messageId))
      || !nullableDate(recipient.deliveredAt)) throw unavailable();
    if (["pending", "sending"].includes(recipient.state) && recipient.reason !== null
      || recipient.state === "delivered" && (recipient.reason !== null || recipient.messageId === null || recipient.deliveredAt === null)
      || recipient.state !== "delivered" && (recipient.messageId !== null || recipient.deliveredAt !== null)
      || ["skipped", "cancelled", "failed"].includes(recipient.state) && recipient.reason === null
      || recipient.state === "failed" && recipient.reason !== "processing_failed"
      || recipient.state === "cancelled" && !["cancelled", "administrator_invalid"].includes(recipient.reason)) throw unavailable();
    seen.add(recipient.conversationId); counts[recipient.state] += 1;
    return { conversationId: recipient.conversationId, client: { id: recipient.client.id, pseudonym: recipient.client.pseudonym },
      state: recipient.state, reason: recipient.reason, messageId: recipient.messageId, deliveredAt: recipient.deliveredAt };
  });
  if (STATES.some((state) => counts[state] !== value.counts[state])) throw unavailable();
  return result;
}

function safePage(value, options) {
  if (!value || !Array.isArray(value.campaigns) || value.campaigns.length > options.limit
    || typeof value.hasMore !== "boolean" || !(value.nextCursor === null || id(value.nextCursor))) throw unavailable();
  let previous = options.afterId;
  const campaigns = value.campaigns.map((campaign) => {
    const safe = safeCampaign(campaign);
    if (previous !== null && safe.id <= previous) throw unavailable();
    previous = safe.id;
    return safe;
  });
  if (value.hasMore && (!campaigns.length || value.nextCursor !== previous)
    || value.nextCursor !== null && (!campaigns.length || value.nextCursor !== previous)) throw unavailable();
  return { campaigns, nextCursor: value.nextCursor, hasMore: value.hasMore };
}

function safeActivity(value) {
  if (!value || !Array.isArray(value.campaigns) || value.campaigns.length > 30) throw unavailable();
  const seen = new Set(); let previous = null, active = 0;
  const campaigns = value.campaigns.map((row) => {
    const campaign = safeCampaign(row);
    if (seen.has(campaign.id) || previous && (campaign.createdAt > previous.createdAt || campaign.createdAt === previous.createdAt && campaign.id >= previous.id)) throw unavailable();
    seen.add(campaign.id); previous = campaign;
    if (["queued", "running"].includes(campaign.status)) active += 1;
    return campaign;
  });
  if (active > 10 || campaigns.length - active > 20) throw unavailable();
  return { campaigns };
}

function mappedError(error) {
  const publicErrors = new Map([[400, "invalid_request"], [408, "request_timeout"], [413, "request_too_large"],
    [415, "json_required"], [503, "broadcast_unavailable"]]);
  if (publicErrors.has(error?.httpStatus) && publicErrors.get(error.httpStatus) === error.publicCode
    || error?.httpStatus === 403 && ["csrf_failed", "request_rejected"].includes(error.publicCode)) return { status: error.httpStatus, code: error.publicCode };
  if (["BROADCAST_UNAUTHORIZED", "CHAT_UNAUTHORIZED", "AUTH_INVALID"].includes(error?.code)) return { status: 401, code: "authentication_required" };
  if (["CHAT_FORBIDDEN", "BROADCAST_FORBIDDEN"].includes(error?.code)) return { status: 403, code: "request_rejected" };
  if (["BROADCAST_NOT_FOUND", "CHAT_NOT_FOUND"].includes(error?.code)) return { status: 404, code: "not_found" };
  if (["BROADCAST_INPUT", "CHAT_INPUT"].includes(error?.code)) return { status: 400, code: "invalid_request" };
  const conflicts = { BROADCAST_CONFLICT: "record_changed", BROADCAST_LIMIT: "limit_reached", BROADCAST_RECIPIENTS: "recipients_unavailable",
    BROADCAST_REPEAT: "repeat_confirmation_required", BROADCAST_MEDIA: "media_unavailable" };
  if (Object.hasOwn(conflicts, error?.code ?? "")) return { status: 409, code: conflicts[error.code] };
  if (["BROADCAST_RATE_LIMIT", "AUTH_RATE_LIMIT", "AUTH_BUSY"].includes(error?.code)) {
    const raw = error.retryAfter;
    const retry = typeof raw === "number" || typeof raw === "string" && raw.length <= 32 ? Number(raw) : NaN;
    return { status: 429, code: "try_again_later", retry: Number.isFinite(retry) ? Math.max(1, Math.min(3600, Math.ceil(retry))) : 60 };
  }
  return { status: 503, code: "broadcast_unavailable" };
}

/** Every route and source asset requires its own current role and cookie. */
export function createBroadcastHandler(service, { origin, mediaEnabled = false }) {
  const configured = new URL(origin);
  if (configured.protocol !== "https:" || configured.origin !== origin) throw new TypeError("A canonical HTTPS site origin is required");
  if (typeof mediaEnabled !== "boolean") throw new TypeError("A boolean media capability is required");
  for (const method of ["actor", "preview", "create", "activity", "list", "get", "cancel"]) {
    if (typeof service?.[method] !== "function") throw new TypeError("A private broadcast service is required");
  }
  return async (request, response) => {
    let url;
    try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const route = routeFor(url.pathname);
    if (!route) return false;
    const method = request.method ?? "GET";
    if (!route.methods.includes(method)) {
      const headers = { Allow: route.methods.join(", ") };
      if (method === "POST") { headers.Connection = "close"; request.resume(); }
      reply(response, method, 405, { error: "method_not_allowed" }, headers);
      return true;
    }
    try {
      if (method === "POST") checkMutation(request, origin, url.pathname, false);
      const token = sessionToken(request, COOKIES[route.role]);
      const actor = token ? await service.actor(route.role, token) : null;
      if (!actor) throw unauthorized();
      const current = safeActor(actor, route.role);
      if (method === "POST" && !sameText(request.headers["x-csrf-token"], current.csrf)) throw httpError(403, "csrf_failed");
      const options = query(url, route.kind === "campaigns" && method === "GET");
      if (route.kind === "asset") {
        const [name, type] = files.get(url.pathname);
        reply(response, method, 200, await readFile(new URL(name, publicRoot)), { "Content-Type": type });
      } else if (route.kind === "session") {
        reply(response, method, 200, { ...current, mediaEnabled });
      } else if (route.kind === "preview") {
        const body = await readJson(request, { maxBytes: 32768 }), requested = validatePreview(body);
        if (!mediaEnabled && requested.mediaId !== null) throw Object.assign(new Error("BROADCAST_MEDIA"), { code: "BROADCAST_MEDIA" });
        reply(response, method, 200, safePreview(await service.preview(token, body), requested));
      } else if (route.kind === "activity") {
        reply(response, method, 200, safeActivity(await service.activity(token)));
      } else if (route.kind === "campaigns" && method === "GET") {
        reply(response, method, 200, safePage(await service.list(token, options), options));
      } else if (route.kind === "campaigns") {
        const body = await readJson(request, { maxBytes: 32768 }), requested = validateCampaign(body);
        if (!mediaEnabled && requested.mediaId !== null) throw Object.assign(new Error("BROADCAST_MEDIA"), { code: "BROADCAST_MEDIA" });
        const result = await service.create(token, body);
        if (!result || typeof result.duplicate !== "boolean") throw unavailable();
        const campaign = safeCampaign(result.campaign);
        if (campaign.clientCampaignId !== body.clientCampaignId || campaign.title !== requested.title || campaign.body !== requested.body
          || campaign.mediaId !== body.mediaId || campaign.allowRepeatMedia !== body.allowRepeatMedia
          || campaign.counts.total !== requested.conversationIds.length) throw unavailable();
        reply(response, method, result.duplicate ? 200 : 201, { campaign, duplicate: result.duplicate });
      } else if (route.kind === "campaign") {
        reply(response, method, 200, safeCampaign(await service.get(token, route.campaignId), { detail: true, campaignId: route.campaignId }));
      } else {
        const body = await readJson(request, { maxBytes: 32768 });
        shape(body, []);
        const campaign = safeCampaign(await service.cancel(token, route.campaignId), { campaignId: route.campaignId });
        if (!["completed", "cancelled", "paused"].includes(campaign.status)) throw unavailable();
        reply(response, method, 200, campaign);
      }
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const { status, code, retry } = mappedError(error);
        const headers = retry ? { "Retry-After": String(retry) } : {};
        if (status === 401 && (method === "POST" || hasSessionCookie(request, COOKIES[route.role]))) headers["Set-Cookie"] = clearCookie(COOKIES[route.role]);
        if (method === "POST" || [400, 408, 413].includes(status)) { headers.Connection = "close"; request.resume(); }
        reply(response, method, status, { error: code }, headers);
      }
    }
    return true;
  };
}
