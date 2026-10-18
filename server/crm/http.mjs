import { readFile } from "node:fs/promises";
import { canonicalEmail } from "../auth/config.mjs";
import { checkMutation, clearCookie, httpError, isToken, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";
import { validateId, validateLabelIds, validateLabelName, validateNickname, validateNotes, validateReminder, validateSearch, validateVersion } from "./validation.mjs";
import { ConversationExportError } from "../chat/conversation-export.mjs";

const publicRoot = new URL("../../public/", import.meta.url);
const COOKIE = "__Host-jessie_session";
const MAX_SEQUENCE = 18446744073709551615n;
const MAX_DATE = 253402300799999;
const STATES = Object.freeze(["active", "pending", "expired", "revoked", "suspended", "deleted"]);
const files = new Map([
  ["/crm.js", ["crm.js", "text/javascript; charset=utf-8"]],
  ["/crm-model.js", ["crm-model.js", "text/javascript; charset=utf-8"]],
  ["/crm.css", ["crm.css", "text/css; charset=utf-8"]],
  ["/private-archive.js", ["private-archive.js", "text/javascript; charset=utf-8"]],
]);
const unavailable = () => httpError(503, "crm_unavailable");
const invalid = () => httpError(400, "invalid_request");
const id = (value) => typeof value === "string" && value.length === 32 && /^[a-f0-9]{32}$/.test(value);
const date = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
const nullableDate = (value) => value === null || date(value);
const text = (value, maximum = 64) => typeof value === "string" && value.length <= maximum && value.isWellFormed();
const sequence = (value) => typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/.test(value)
  && BigInt(value).toString() === value && BigInt(value) <= MAX_SEQUENCE;

function safeActor(value) {
  if (!value?.user || value.user.role !== "admin") throw Object.assign(new Error("CRM_UNAUTHORIZED"), { code: "CRM_UNAUTHORIZED" });
  if (!id(value.user.id) || !text(value.user.pseudonym) || !date(value.expiresAt) || !isToken(value.csrf)) throw unavailable();
  return { id: value.user.id, csrf: value.csrf };
}

function shape(body, keys) {
  if (Object.keys(body).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(body, key))) throw invalid();
  return body;
}

function query(url, allowed, defaultLimit) {
  const result = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(result, key)) throw invalid();
    result[key] = value;
  }
  if (defaultLimit !== undefined) {
    if (result.limit !== undefined && (!/^(?:[1-9][0-9]?|100)$/.test(result.limit)
      || String(Number(result.limit)) !== result.limit)) throw invalid();
    result.limit = result.limit === undefined ? defaultLimit : Number(result.limit);
  }
  return result;
}

function routeFor(pathname) {
  if (files.has(pathname)) return { kind: "asset", methods: ["GET", "HEAD"] };
  if (pathname === "/api/admin/crm/capabilities") return { kind: "capabilities", methods: ["GET"] };
  if (pathname === "/api/admin/crm/labels") return { kind: "labels", methods: ["GET", "POST"] };
  if (pathname === "/api/admin/crm/contacts") return { kind: "contacts", methods: ["GET"] };
  let match = /^\/api\/admin\/crm\/labels\/([a-f0-9]{32})\/(rename|delete)$/.exec(pathname);
  if (match) return { kind: match[2], labelId: match[1], methods: ["POST"] };
  match = /^\/api\/admin\/crm\/conversations\/([a-f0-9]{32})\/export$/.exec(pathname);
  if (match) return { kind: "export", conversationId: match[1], methods: ["POST"] };
  match = /^\/api\/admin\/crm\/conversations\/([a-f0-9]{32})$/.exec(pathname);
  return match ? { kind: "profile", conversationId: match[1], methods: ["GET", "POST"] } : null;
}

function checked(validate, value, options) {
  try { return validate(value, options); } catch { throw unavailable(); }
}

function safeLabel(value) {
  if (!value || !id(value.id) || !["tag", "group"].includes(value.kind)
    || !text(value.name) || checked(validateLabelName, value.name).name !== value.name
    || !date(value.createdAt) || !date(value.updatedAt) || value.updatedAt < value.createdAt
    || !Number.isSafeInteger(value.memberCount) || value.memberCount < 0) throw unavailable();
  checked(validateVersion, value.version, { allowZero: false });
  return { id: value.id, kind: value.kind, name: value.name, version: value.version,
    createdAt: value.createdAt, updatedAt: value.updatedAt, memberCount: value.memberCount };
}

function safeLabels(values, maximum) {
  if (!Array.isArray(values) || values.length > maximum) throw unavailable();
  const seen = new Set();
  return values.map((value) => {
    const label = safeLabel(value);
    if (seen.has(label.id)) throw unavailable();
    seen.add(label.id);
    return label;
  });
}

function safeAccess(value) {
  if (!value || !STATES.includes(value.state) || !nullableDate(value.expiresAt)) throw unavailable();
  return { state: value.state, expiresAt: value.expiresAt };
}

function safeProfile(value, conversationId) {
  if (!value || value.conversationId !== conversationId || !id(value.conversationId)
    || !value.client || !id(value.client.id) || !text(value.client.pseudonym)
    || !["active", "pending", "revoked", "suspended", "deleted"].includes(value.client.status)
    || !text(value.client.email, 254) || !nullableDate(value.reminderAt) || !nullableDate(value.updatedAt)) throw unavailable();
  try { if (canonicalEmail(value.client.email) !== value.client.email) throw unavailable(); } catch { throw unavailable(); }
  if (checked(validateNickname, value.nickname) !== value.nickname) throw unavailable();
  checked(validateNotes, value.notes);
  checked(validateVersion, value.version);
  if (value.version === "0" && (value.updatedAt !== null || value.nickname !== "" || value.notes !== ""
    || value.reminderAt !== null || value.labels?.length !== 0) || value.version !== "0" && value.updatedAt === null) throw unavailable();
  return { conversationId: value.conversationId,
    client: { id: value.client.id, pseudonym: value.client.pseudonym, email: value.client.email, status: value.client.status },
    access: safeAccess(value.access), nickname: value.nickname, notes: value.notes,
    reminderAt: value.reminderAt, labels: safeLabels(value.labels, 32), version: value.version, updatedAt: value.updatedAt };
}

function safeContact(value) {
  if (!value || !id(value.id) || !value.client || !id(value.client.id) || !text(value.client.pseudonym)
    || !text(value.peerName) || !date(value.createdAt) || !nullableDate(value.closedAt) || !date(value.lastActivityAt)
    || value.lastActivityAt < value.createdAt || value.closedAt !== null && (value.closedAt < value.createdAt || value.canSend)
    || !["latestSequence", "latestEventSequence", "lastReadSequence", "peerReadSequence"].every((key) => sequence(value[key]))
    || BigInt(value.lastReadSequence) > BigInt(value.latestSequence) || BigInt(value.peerReadSequence) > BigInt(value.latestSequence)
    || !Number.isSafeInteger(value.unreadCount) || value.unreadCount < 0 || typeof value.canSend !== "boolean"
    || !value.crm || !nullableDate(value.crm.reminderAt)) throw unavailable();
  if (checked(validateNickname, value.crm.nickname) !== value.crm.nickname) throw unavailable();
  checked(validateVersion, value.crm.version);
  const access = safeAccess(value.access);
  const labels = safeLabels(value.crm.labels, 32);
  if (value.canSend && access.state !== "active" || value.crm.version === "0"
    && (value.crm.nickname !== "" || value.crm.reminderAt !== null || labels.length !== 0)) throw unavailable();
  return { id: value.id, client: { id: value.client.id, pseudonym: value.client.pseudonym }, peerName: value.peerName,
    createdAt: value.createdAt, closedAt: value.closedAt, lastActivityAt: value.lastActivityAt,
    latestSequence: value.latestSequence, latestEventSequence: value.latestEventSequence,
    lastReadSequence: value.lastReadSequence, peerReadSequence: value.peerReadSequence,
    unreadCount: value.unreadCount, canSend: value.canSend,
    crm: { nickname: value.crm.nickname, labels, reminderAt: value.crm.reminderAt, version: value.crm.version }, access };
}

function safePage(result, field, options, rebuild) {
  if (!result || !Array.isArray(result[field]) || result[field].length > options.limit
    || typeof result.hasMore !== "boolean" || !(result.nextCursor === null || id(result.nextCursor))) throw unavailable();
  let previous = options.afterId;
  const values = result[field].map((value) => {
    const safe = rebuild(value);
    if (previous !== null && safe.id <= previous) throw unavailable();
    previous = safe.id;
    return safe;
  });
  if (result.hasMore && (!values.length || result.nextCursor !== previous)
    || result.nextCursor !== null && (!values.length || result.nextCursor !== previous)) throw unavailable();
  return { [field]: values, nextCursor: result.nextCursor, hasMore: result.hasMore };
}

function mappedError(error) {
  if (error instanceof ConversationExportError) {
    const states = { input: [400, "invalid_request"], limit: [413, "conversation_export_limit"], busy: [429, "conversation_export_busy"], changed: [409, "conversation_export_changed"], unauthorized: [401, "authentication_required"], cancelled: [503, "conversation_export_interrupted"] };
    const [status, code] = states[error.code] ?? [503, "conversation_export_unavailable"];
    return { status, code, ...(status === 429 ? { retry: 30 } : {}) };
  }
  if (Number.isInteger(error?.httpStatus) && [400, 403, 408, 413, 415, 503].includes(error.httpStatus)
    && ["invalid_request", "request_rejected", "csrf_failed", "request_timeout", "request_too_large", "json_required", "crm_unavailable"].includes(error.publicCode)) return { status: error.httpStatus, code: error.publicCode };
  if (["CRM_UNAUTHORIZED", "CHAT_UNAUTHORIZED", "AUTH_INVALID"].includes(error?.code)) return { status: 401, code: "authentication_required" };
  if (["CRM_FORBIDDEN", "CHAT_FORBIDDEN"].includes(error?.code)) return { status: 403, code: "request_rejected" };
  if (["CRM_NOT_FOUND", "CHAT_NOT_FOUND"].includes(error?.code)) return { status: 404, code: "not_found" };
  if (error?.code === "CRM_CONFLICT") return { status: 409, code: "record_changed" };
  if (error?.code === "CRM_NAME_CONFLICT") return { status: 409, code: "name_in_use" };
  if (error?.code === "CRM_LIMIT") return { status: 409, code: "limit_reached" };
  if (["CRM_INPUT", "CHAT_INPUT"].includes(error?.code)) return { status: 400, code: "invalid_request" };
  if (["CRM_RATE_LIMIT", "AUTH_RATE_LIMIT", "AUTH_BUSY"].includes(error?.code)) {
    const retry = Number(error.retryAfter);
    return { status: 429, code: "try_again_later", retry: Number.isFinite(retry) ? Math.max(1, Math.min(3600, Math.ceil(retry))) : 60 };
  }
  return { status: 503, code: "crm_unavailable" };
}

/** Feature registration and a current administrator session protect every route and asset. */
export function createCrmHandler(service, { origin, conversationExporter = null }) {
  const configured = new URL(origin);
  if (configured.protocol !== "https:" || configured.origin !== origin) throw new TypeError("A canonical HTTPS site origin is required");
  for (const method of ["actor", "listLabels", "createLabel", "renameLabel", "deleteLabel", "profile", "saveProfile", "contacts"]) {
    if (typeof service?.[method] !== "function") throw new TypeError("A private CRM service is required");
  }
  if (conversationExporter !== null && (typeof conversationExporter?.create !== "function" || typeof conversationExporter.photos !== "boolean"
    || !Number.isSafeInteger(conversationExporter.maxBytes) || conversationExporter.maxBytes < 22 || conversationExporter.maxBytes > 32 * 1024 * 1024)) throw new TypeError("A bounded conversation exporter is required.");
  const exports = new Set(); let closing = false;
  const handler = async (request, response) => {
    let url;
    try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const route = routeFor(url.pathname);
    if (!route || route.kind === "export" && conversationExporter === null) return false;
    const method = request.method ?? "GET";
    if (!route.methods.includes(method)) {
      reply(response, method, 405, { error: "method_not_allowed" }, { Allow: route.methods.join(", ") });
      return true;
    }
    try {
      if (method === "POST") checkMutation(request, origin, url.pathname, false);
      const token = sessionToken(request, COOKIE);
      const actor = token ? await service.actor(token) : null;
      if (!actor) throw Object.assign(new Error("CRM_UNAUTHORIZED"), { code: "CRM_UNAUTHORIZED" });
      const authenticated = safeActor(actor);
      if (method === "POST" && !sameText(request.headers["x-csrf-token"], authenticated.csrf)) throw httpError(403, "csrf_failed");
      if (route.kind === "asset") {
        query(url, []);
        const [name, type] = files.get(url.pathname);
        reply(response, method, 200, await readFile(new URL(name, publicRoot)), { "Content-Type": type });
      } else if (route.kind === "capabilities") {
        query(url, []);
        reply(response, method, 200, { enabled: true, limits: { labelsPerKind: 100, labelsPerClient: 32, noteCharacters: 8000 },
          ...(conversationExporter ? { conversationExport: { enabled: true, photos: conversationExporter.photos, maxBytes: conversationExporter.maxBytes } } : {}) });
      } else if (route.kind === "export") {
        query(url, []);
        const body = shape(await readJson(request, { maxBytes: 1024 }), ["includePhotos"]);
        if (typeof body.includePhotos !== "boolean" || body.includePhotos && !conversationExporter.photos) throw invalid();
        if (closing) throw unavailable();
        const profile = safeProfile(await service.profile(token, route.conversationId), route.conversationId);
        const controller = new AbortController(), abort = () => controller.abort(); let archive;
        const abortTransfer = () => { if (response.headersSent && !response.writableFinished) response.destroy(); };
        controller.signal.addEventListener("abort", abortTransfer);
        exports.add(controller); request.once("aborted", abort); response.once("close", abort);
        try {
          if (request.aborted || response.destroyed || closing) controller.abort();
          archive = await conversationExporter.create({ token, conversationId: route.conversationId, expectedClientId: profile.client.id, includePhotos: body.includePhotos, signal: controller.signal });
          if (!Buffer.isBuffer(archive) || archive.length < 22 || archive.length > conversationExporter.maxBytes || archive.readUInt32LE() !== 0x04034b50) throw unavailable();
          const current = safeActor(await service.actor(token));
          if (!sameText(current.id, authenticated.id) || !sameText(current.csrf, authenticated.csrf)) throw Object.assign(new Error("CRM_UNAUTHORIZED"), { code: "CRM_UNAUTHORIZED" });
          const finalProfile = safeProfile(await service.profile(token, route.conversationId), route.conversationId);
          if (finalProfile.client.id !== profile.client.id) throw new ConversationExportError("changed");
          if (controller.signal.aborted) throw new ConversationExportError("cancelled");
          await new Promise((resolve, reject) => {
            const done = () => { response.off("finish", done); response.off("close", done); resolve(); };
            response.once("finish", done); response.once("close", done);
            try { reply(response, method, 200, archive, { "Content-Type": "application/zip", "Content-Length": String(archive.length),
              "Content-Disposition": `attachment; filename="JessieMessage-conversation-${route.conversationId}.zip"` }); }
            catch (error) { response.off("finish", done); response.off("close", done); reject(error); }
          });
        } finally { archive?.fill?.(0); exports.delete(controller); controller.signal.removeEventListener("abort", abortTransfer); request.off("aborted", abort); response.off("close", abort); }
      } else if (route.kind === "labels" && method === "GET") {
        const parsed = query(url, ["kind", "afterId", "limit"], 100);
        const options = { kind: parsed.kind ?? null, afterId: parsed.afterId ?? null, limit: parsed.limit };
        if (options.kind !== null && !["tag", "group"].includes(options.kind)) throw invalid();
        if (options.afterId !== null) validateId(options.afterId);
        const result = safePage(await service.listLabels(token, options), "labels", options, safeLabel);
        if (options.kind !== null && result.labels.some((label) => label.kind !== options.kind)) throw unavailable();
        reply(response, method, 200, result);
      } else if (route.kind === "labels") {
        query(url, []);
        const body = shape(await readJson(request), ["kind", "name"]);
        if (!["tag", "group"].includes(body.kind)) throw invalid();
        validateLabelName(body.name);
        const result = await service.createLabel(token, body);
        if (!result || typeof result.duplicate !== "boolean") throw unavailable();
        const label = safeLabel(result.label);
        const expected = validateLabelName(body.name);
        if (label.kind !== body.kind || validateLabelName(label.name).normalizedName !== expected.normalizedName) throw unavailable();
        reply(response, method, result.duplicate ? 200 : 201, { label, duplicate: result.duplicate });
      } else if (route.kind === "rename") {
        query(url, []);
        const body = shape(await readJson(request), ["name", "expectedVersion"]);
        validateLabelName(body.name); validateVersion(body.expectedVersion, { allowZero: false });
        const label = safeLabel(await service.renameLabel(token, route.labelId, body));
        if (label.id !== route.labelId || label.name !== validateLabelName(body.name).name) throw unavailable();
        reply(response, method, 200, { label });
      } else if (route.kind === "delete") {
        query(url, []);
        const body = shape(await readJson(request), ["expectedVersion"]);
        validateVersion(body.expectedVersion, { allowZero: false });
        const result = await service.deleteLabel(token, route.labelId, body);
        if (result?.deleted !== true) throw unavailable();
        reply(response, method, 200, { deleted: true });
      } else if (route.kind === "contacts") {
        const parsed = query(url, ["q", "tagId", "groupId", "access", "unread", "reminder", "afterId", "limit"], 50);
        const options = { q: parsed.q ?? "", tagId: parsed.tagId ?? null, groupId: parsed.groupId ?? null,
          access: parsed.access ?? "all", unread: parsed.unread !== undefined, reminder: parsed.reminder ?? "all",
          afterId: parsed.afterId ?? null, limit: parsed.limit };
        if (parsed.unread !== undefined && parsed.unread !== "1" || !["all", ...STATES].includes(options.access)
          || !["all", "due", "upcoming", "none"].includes(options.reminder)) throw invalid();
        validateSearch(options.q);
        for (const field of ["tagId", "groupId", "afterId"]) if (options[field] !== null) validateId(options[field]);
        reply(response, method, 200, safePage(await service.contacts(token, options), "contacts", options, safeContact));
      } else if (method === "GET") {
        query(url, []);
        reply(response, method, 200, safeProfile(await service.profile(token, route.conversationId), route.conversationId));
      } else {
        query(url, []);
        const body = shape(await readJson(request, { maxBytes: 65536 }), ["expectedVersion", "nickname", "notes", "reminderAt", "labelIds"]);
        validateVersion(body.expectedVersion); validateNickname(body.nickname); validateNotes(body.notes);
        validateReminder(body.reminderAt); validateLabelIds(body.labelIds);
        reply(response, method, 200, safeProfile(await service.saveProfile(token, route.conversationId, body), route.conversationId));
      }
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const { status, code, retry } = mappedError(error);
        const headers = retry ? { "Retry-After": String(retry) } : {};
        // A long download can finish after another tab has logged in. Its old
        // request cookie must not erase the browser's newer session cookie.
        if (status === 401 && route.kind !== "export") headers["Set-Cookie"] = clearCookie(COOKIE);
        // Reject untrusted mutations before attaching any JSON body reader.
        if (method === "POST" || [400, 408, 413].includes(status)) { headers.Connection = "close"; request.resume(); }
        reply(response, method, status, { error: code }, headers);
      }
    }
    return true;
  };
  return Object.assign(handler, { close() { closing = true; for (const controller of exports) controller.abort(); } });
}
