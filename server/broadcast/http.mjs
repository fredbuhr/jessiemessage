import { readFile } from "node:fs/promises";
import { AUTH_HEADERS, checkMutation, httpError, isToken, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";
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
  ["/i18n-broadcast.js", ["i18n-broadcast.js", "text/javascript; charset=utf-8", "admin"]],
  ["/broadcast.css", ["broadcast.css", "text/css; charset=utf-8", "admin"]],
]);
const invalid = () => httpError(400, "invalid_request");
const unavailable = () => httpError(503, "broadcast_unavailable");
const unauthorized = () => Object.assign(new Error("BROADCAST_UNAUTHORIZED"), { code: "BROADCAST_UNAUTHORIZED" });
const id = (value) => typeof value === "string" && value.length === 32 && /^[a-f0-9]{32}$/.test(value);
const date = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
const nullableDate = (value) => value === null || date(value);
const pseudonym = (value) => typeof value === "string" && value.length <= 64 && value.isWellFormed();
const safeCount = (value) => Number.isSafeInteger(value) && value >= 0;
const count = (value) => safeCount(value) && value <= 100;

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

function query(url, paginated = false, defaultLimit = 20) {
  const result = { afterId: null, limit: defaultLimit };
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
  const match = /^\/api\/broadcast\/admin\/campaigns\/([a-f0-9]{32})(?:\/(cancel|summary|recipients))?$/.exec(pathname);
  return match ? { kind: match[2] ?? "campaign", role: "admin", campaignId: match[1], methods: match[2] === "cancel" ? ["POST"] : ["GET"] } : null;
}

function safePreview(value, requested) {
  if (requested.audience) return safeAudiencePreview(value, requested);
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
      || requested.mediaId === null && !requested.videoId && recipient.repeatMedia) throw unavailable();
    eligibleCount += Number(recipient.eligible); repeatCount += Number(recipient.repeatMedia);
    return { conversationId: recipient.conversationId, client: { id: recipient.client.id, pseudonym: recipient.client.pseudonym },
      eligible: recipient.eligible, reason: recipient.reason, repeatMedia: recipient.repeatMedia };
  });
  if (expected.size || value.eligibleCount !== eligibleCount || value.repeatCount !== repeatCount) throw unavailable();
  return { recipients, eligibleCount, repeatCount };
}

function safeAudiencePreview(value, requested) {
  if (!value || !Array.isArray(value.recipients) || ![value.totalCount, value.eligibleCount, value.excludedCount, value.repeatCount].every(safeCount)
    || value.totalCount !== value.eligibleCount + value.excludedCount || value.repeatCount > value.eligibleCount
    || value.recipients.length !== Math.min(50, value.totalCount) || typeof value.previewToken !== "string"
    || value.previewToken.length < 1 || value.previewToken.length > 4096 || /[^\x21-\x7e]/.test(value.previewToken)
    || requested.mediaId === null && !requested.videoId && value.repeatCount !== 0
    || requested.audience.mode === "selected" && value.totalCount !== requested.audience.conversationIds.length) throw unavailable();
  let previous = null, eligible = 0, repeat = 0;
  const recipients = value.recipients.map((recipient, index) => {
    if (!recipient || !id(recipient.conversationId) || previous !== null && recipient.conversationId <= previous
      || !recipient.client || !id(recipient.client.id) || !pseudonym(recipient.client.pseudonym)
      || typeof recipient.eligible !== "boolean" || typeof recipient.repeatMedia !== "boolean"
      || ![null, "access_inactive", "conversation_unavailable"].includes(recipient.reason)
      || recipient.eligible !== (recipient.reason === null) || requested.mediaId === null && !requested.videoId && recipient.repeatMedia
      || requested.audience.mode === "selected" && recipient.conversationId !== requested.audience.conversationIds[index]) throw unavailable();
    previous = recipient.conversationId; eligible += Number(recipient.eligible); repeat += Number(recipient.eligible && recipient.repeatMedia);
    return { conversationId: recipient.conversationId, client: { id: recipient.client.id, pseudonym: recipient.client.pseudonym },
      eligible: recipient.eligible, reason: recipient.reason, repeatMedia: recipient.repeatMedia };
  });
  if (eligible > value.eligibleCount || recipients.length - eligible > value.excludedCount || repeat > value.repeatCount
    || value.totalCount <= 50 && (eligible !== value.eligibleCount || repeat !== value.repeatCount)) throw unavailable();
  return { recipients, totalCount: value.totalCount, eligibleCount: value.eligibleCount, excludedCount: value.excludedCount,
    repeatCount: value.repeatCount, previewToken: value.previewToken };
}
function safeRecipient(recipient) {
  if (!recipient || !id(recipient.conversationId) || !recipient.client || !id(recipient.client.id) || !pseudonym(recipient.client.pseudonym)
    || !STATES.includes(recipient.state) || ![null, ...REASONS].includes(recipient.reason)
    || !(recipient.messageId === null || id(recipient.messageId)) || !nullableDate(recipient.deliveredAt)) throw unavailable();
  if (["pending", "sending"].includes(recipient.state) && recipient.reason !== null
    || recipient.state === "delivered" && (recipient.reason !== null || recipient.messageId === null || recipient.deliveredAt === null)
    || recipient.state !== "delivered" && (recipient.messageId !== null || recipient.deliveredAt !== null)
    || ["skipped", "cancelled", "failed"].includes(recipient.state) && recipient.reason === null
    || recipient.state === "failed" && recipient.reason !== "processing_failed"
    || recipient.state === "cancelled" && !["cancelled", "administrator_invalid"].includes(recipient.reason)) throw unavailable();
  return { conversationId: recipient.conversationId, client: { id: recipient.client.id, pseudonym: recipient.client.pseudonym },
    state: recipient.state, reason: recipient.reason, messageId: recipient.messageId, deliveredAt: recipient.deliveredAt };
}
function safeRecipientPage(value, options, campaignId) {
  if (!value || value.campaignId !== campaignId || !Array.isArray(value.recipients) || value.recipients.length > options.limit
    || typeof value.hasMore !== "boolean" || !(value.nextCursor === null || id(value.nextCursor))) throw unavailable();
  let previous = options.afterId;
  const recipients = value.recipients.map((row) => { const recipient = safeRecipient(row);
    if (previous !== null && recipient.conversationId <= previous) throw unavailable(); previous = recipient.conversationId; return recipient; });
  if (value.hasMore && (!recipients.length || value.nextCursor !== previous) || !value.hasMore && value.nextCursor !== null) throw unavailable();
  return { campaignId, recipients, hasMore: value.hasMore, nextCursor: value.nextCursor };
}

function safeCampaign(value, { detail = false, campaignId = null, video = false } = {}) {
  const typedVideo = video && value?.formatVersion === 3;
  const large = value?.formatVersion === 2 || typedVideo, validCount = large ? safeCount : count;
  if (!value || value.formatVersion !== undefined && value.formatVersion !== 2 && !typedVideo
    || large && !["all", "filtered", "selected"].includes(value.audienceMode) || !id(value.id) || campaignId !== null && value.id !== campaignId || !id(value.clientCampaignId)
    || !["queued", "running", "completed", "cancelled", "paused"].includes(value.status)
    || !date(value.createdAt) || !date(value.updatedAt) || value.updatedAt < value.createdAt
    || !date(value.expiresAt) || value.expiresAt <= value.createdAt || !value.counts
    || !validCount(value.counts.total) || value.counts.total < 1 || !STATES.every((state) => validCount(value.counts[state]))
    || STATES.reduce((sum, state) => sum + value.counts[state], 0) !== value.counts.total
    || ["completed", "cancelled", "paused"].includes(value.status) && (value.counts.pending || value.counts.sending)) throw unavailable();
  if (typedVideo) {
    if (value.mediaId !== null || !id(value.videoId)) throw unavailable();
    checked((input) => validateCampaign(input, { video: true }), { clientCampaignId: value.clientCampaignId, title: value.title, body: value.body, mediaId: null, videoId: value.videoId, allowRepeatMedia: value.allowRepeatMedia, audience: { mode: "all" }, previewToken: "checked" });
  } else {
    if (value.videoId !== undefined) throw unavailable();
    checked(validateCampaign, { clientCampaignId: value.clientCampaignId, title: value.title, body: value.body,
      mediaId: value.mediaId, allowRepeatMedia: value.allowRepeatMedia, conversationIds: [value.id] });
  }
  const result = { id: value.id, clientCampaignId: value.clientCampaignId, title: value.title, body: value.body,
    mediaId: value.mediaId, allowRepeatMedia: value.allowRepeatMedia, status: value.status,
    createdAt: value.createdAt, updatedAt: value.updatedAt, expiresAt: value.expiresAt,
    counts: Object.fromEntries(["total", ...STATES].map((state) => [state, value.counts[state]])) };
  if (large) { result.formatVersion = value.formatVersion; if (typedVideo) result.videoId = value.videoId; result.audienceMode = value.audienceMode; }
  if (!detail) return result;
  if (!Array.isArray(value.recipients)) throw unavailable();
  if (large) {
    const page = safeRecipientPage({ campaignId: value.id, recipients: value.recipients, hasMore: value.hasMore, nextCursor: value.nextCursor }, { afterId: null, limit: 50 }, value.id);
    if (page.recipients.length !== Math.min(50, value.counts.total) || page.hasMore !== (value.counts.total > 50)) throw unavailable();
    Object.assign(result, { recipients: page.recipients, hasMore: page.hasMore, nextCursor: page.nextCursor }); return result;
  }
  if (value.recipients.length !== value.counts.total) throw unavailable();
  const seen = new Set(), counts = Object.fromEntries(STATES.map((state) => [state, 0]));
  result.recipients = value.recipients.map((row) => {
    const recipient = safeRecipient(row); if (seen.has(recipient.conversationId)) throw unavailable();
    seen.add(recipient.conversationId); counts[recipient.state] += 1; return recipient;
  });
  if (STATES.some((state) => counts[state] !== value.counts[state])) throw unavailable();
  return result;
}

function safePage(value, options, video = false) {
  if (!value || !Array.isArray(value.campaigns) || value.campaigns.length > options.limit
    || typeof value.hasMore !== "boolean" || !(value.nextCursor === null || id(value.nextCursor))) throw unavailable();
  let previous = options.afterId;
  const campaigns = value.campaigns.map((campaign) => {
    const safe = safeCampaign(campaign, { video });
    if (previous !== null && safe.id <= previous) throw unavailable();
    previous = safe.id;
    return safe;
  });
  if (value.hasMore && (!campaigns.length || value.nextCursor !== previous)
    || value.nextCursor !== null && (!campaigns.length || value.nextCursor !== previous)) throw unavailable();
  return { campaigns, nextCursor: value.nextCursor, hasMore: value.hasMore };
}

function safeActivity(value, video = false) {
  if (!value || !Array.isArray(value.campaigns) || value.campaigns.length > 30) throw unavailable();
  const seen = new Set(); let previous = null, active = 0;
  const campaigns = value.campaigns.map((row) => {
    const campaign = safeCampaign(row, { video });
    if (seen.has(campaign.id) || previous && (campaign.createdAt > previous.createdAt || campaign.createdAt === previous.createdAt && campaign.id >= previous.id)) throw unavailable();
    seen.add(campaign.id); previous = campaign;
    if (["queued", "running"].includes(campaign.status)) active += 1;
    return campaign;
  });
  if (active > 10 || campaigns.length - active > 20) throw unavailable();
  return { campaigns };
}

function mappedError(error) {
  if (error?.code === "BROADCAST_READ_ONLY") return { status: 403, code: "feature_read_only" };
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
export function createBroadcastHandler(service, { origin, mediaEnabled = false, videoEnabled = false, videoCreationEnabled = service?.videoCreationEnabled ?? true }) {
  const configured = new URL(origin);
  if (configured.protocol !== "https:" || configured.origin !== origin) throw new TypeError("A canonical HTTPS site origin is required");
  if (typeof mediaEnabled !== "boolean" || typeof videoEnabled !== "boolean" || typeof videoCreationEnabled !== "boolean") throw new TypeError("A boolean media capability is required");
  if (service?.largeAudiencesEnabled !== undefined && typeof service.largeAudiencesEnabled !== "boolean") throw new TypeError("A boolean audience capability is required");
  const largeAudiencesEnabled = service?.largeAudiencesEnabled === true;
  if (videoEnabled && (!largeAudiencesEnabled || service?.videoEnabled !== true)) throw new TypeError("A video broadcast capability is required");
  if (videoEnabled && !videoCreationEnabled && service?.videoCreationEnabled !== false) throw new TypeError("A read-only video broadcast service is required");
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
      const options = query(url, ["campaigns", "recipients"].includes(route.kind) && method === "GET", route.kind === "recipients" ? 50 : 20);
      if (route.kind === "asset") {
        const [name, type] = files.get(url.pathname);
        reply(response, method, 200, await readFile(new URL(name, publicRoot)), { "Content-Type": type, ...(videoEnabled && name === "broadcast.html" ? { "Content-Security-Policy": AUTH_HEADERS["Content-Security-Policy"] + "; media-src 'self' blob:" } : {}) });
      } else if (route.kind === "session") {
        reply(response, method, 200, { ...current, mediaEnabled, ...(videoEnabled ? { videoEnabled: true, ...(!videoCreationEnabled ? { videoCreationEnabled: false } : {}) } : {}), ...(largeAudiencesEnabled ? { largeAudiencesEnabled: true } : {}) });
      } else if (route.kind === "preview") {
        const body = await readJson(request, { maxBytes: largeAudiencesEnabled ? 1048576 : 32768 }), requested = validatePreview(body, { video: videoEnabled });
        if (requested.audience && !largeAudiencesEnabled) throw invalid();
        if (!mediaEnabled && requested.mediaId !== null) throw Object.assign(new Error("BROADCAST_MEDIA"), { code: "BROADCAST_MEDIA" });
        reply(response, method, 200, safePreview(await service.preview(token, body), requested));
      } else if (route.kind === "activity") {
        reply(response, method, 200, safeActivity(await service.activity(token), videoEnabled));
      } else if (route.kind === "campaigns" && method === "GET") {
        reply(response, method, 200, safePage(await service.list(token, options), options, videoEnabled));
      } else if (route.kind === "campaigns") {
        const body = await readJson(request, { maxBytes: largeAudiencesEnabled ? 1048576 : 32768 }), requested = validateCampaign(body, { video: videoEnabled });
        if (requested.audience && !largeAudiencesEnabled) throw invalid();
        if (!mediaEnabled && requested.mediaId !== null) throw Object.assign(new Error("BROADCAST_MEDIA"), { code: "BROADCAST_MEDIA" });
        const result = await service.create(token, body);
        if (!result || typeof result.duplicate !== "boolean") throw unavailable();
        const campaign = safeCampaign(result.campaign, { video: videoEnabled });
        if (campaign.clientCampaignId !== body.clientCampaignId || campaign.title !== requested.title || campaign.body !== requested.body
          || campaign.mediaId !== body.mediaId || campaign.videoId !== body.videoId || campaign.allowRepeatMedia !== body.allowRepeatMedia
          || requested.audience && (campaign.formatVersion !== (requested.videoId ? 3 : 2) || campaign.audienceMode !== requested.audience.mode)
          || !requested.audience && campaign.counts.total !== requested.conversationIds.length) throw unavailable();
        reply(response, method, result.duplicate ? 200 : 201, { campaign, duplicate: result.duplicate });
      } else if (route.kind === "summary") {
        if (typeof service.summary !== "function") throw unavailable();
        reply(response, method, 200, safeCampaign(await service.summary(token, route.campaignId), { campaignId: route.campaignId, video: videoEnabled }));
      } else if (route.kind === "recipients") {
        if (typeof service.recipients !== "function") throw unavailable();
        reply(response, method, 200, safeRecipientPage(await service.recipients(token, route.campaignId, options), options, route.campaignId));
      } else if (route.kind === "campaign") {
        reply(response, method, 200, safeCampaign(await service.get(token, route.campaignId), { detail: true, campaignId: route.campaignId, video: videoEnabled }));
      } else {
        const body = await readJson(request, { maxBytes: 32768 });
        shape(body, []);
        const campaign = safeCampaign(await service.cancel(token, route.campaignId), { campaignId: route.campaignId, video: videoEnabled });
        if (!["completed", "cancelled", "paused"].includes(campaign.status)) throw unavailable();
        reply(response, method, 200, campaign);
      }
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const { status, code, retry } = mappedError(error);
        const headers = retry ? { "Retry-After": String(retry) } : {};
        if (method === "POST" || [400, 408, 413].includes(status)) { headers.Connection = "close"; request.resume(); }
        reply(response, method, status, { error: code }, headers);
      }
    }
    return true;
  };
}
