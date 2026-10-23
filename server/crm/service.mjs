import { createHmac, randomBytes } from "node:crypto";
import { tokenDigest } from "../auth/crypto.mjs";
import { peerAvatarDTO } from "../chat/profile-avatar.mjs";
import { canonicalEmail } from "../auth/config.mjs";
import { openNotes, sealNotes } from "./crypto.mjs";
import { validateId, validateLabelIds, validateLabelName, validateNickname, validateNotes, validateReminder, validateSearch, validateVersion } from "./validation.mjs";

export class CrmError extends Error {
  constructor(code, retryAfter) {
    super("Private client tools could not be completed."); this.name = "CrmError"; this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}
const fail = (code) => { throw new CrmError(code); };
const states = ["active", "pending", "expired", "revoked", "suspended", "deleted"];
const allowed = new Set(["CRM_INPUT", "CRM_NOT_FOUND", "CRM_CONFLICT", "CRM_NAME_CONFLICT", "CRM_LIMIT", "CRM_FORBIDDEN", "CHAT_UNAUTHORIZED", "CHAT_FORBIDDEN", "CHAT_NOT_FOUND", "AUTH_RATE_LIMIT", "AUTH_BUSY"]);
function shape(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((name) => !keys.includes(name))
    || keys.some((name) => !Object.hasOwn(value, name))) fail("CRM_INPUT");
}
function options(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((name) => !keys.includes(name))) fail("CRM_INPUT");
}
const boundedLimit = (value) => { if (!Number.isInteger(value) || value < 1 || value > 100) fail("CRM_INPUT"); return value; };
const kindValue = (value) => { if (!["tag", "group"].includes(value)) fail("CRM_INPUT"); return value; };
const storedId = (value) => { if (!Buffer.isBuffer(value) || value.length !== 16) fail("CRM_UNAVAILABLE"); return value.toString("hex"); };
const dateValue = (value) => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) fail("CRM_UNAVAILABLE"); return value; };
const nullableDate = (value) => value === null ? null : dateValue(value);
const storedText = (value, max = 64) => { if (typeof value !== "string" || value.length > max || !value.isWellFormed()) fail("CRM_UNAVAILABLE"); return value; };
const stored = (operation) => { try { return operation(); } catch { fail("CRM_UNAVAILABLE"); } };
const storedVersion = (value, allowZero = true) => stored(() => validateVersion(value, { allowZero }));
const storedSequence = (value) => {
  if (typeof value !== "string" || value.length > 20 || !/^(?:0|[1-9][0-9]*)$/.test(value)
    || BigInt(value).toString() !== value || BigInt(value) > 18446744073709551615n) fail("CRM_UNAVAILABLE"); return value;
};
function accessDTO(value) {
  if (!value || !states.includes(value.state)) fail("CRM_UNAVAILABLE");
  return { state: value.state, expiresAt: nullableDate(value.expiresAt) };
}
function labelDTO(row) {
  if (!row || !["tag", "group"].includes(row.kind) || stored(() => validateLabelName(row.name)).name !== row.name
    || !Number.isSafeInteger(row.memberCount) || row.memberCount < 0) fail("CRM_UNAVAILABLE");
  const createdAt = dateValue(row.createdAt), updatedAt = dateValue(row.updatedAt);
  if (updatedAt < createdAt) fail("CRM_UNAVAILABLE");
  return { id: storedId(row.id), kind: row.kind, name: row.name, version: storedVersion(row.version, false), createdAt, updatedAt, memberCount: row.memberCount };
}
function labelsDTO(rows, maximum) {
  if (!Array.isArray(rows) || rows.length > maximum) fail("CRM_UNAVAILABLE");
  const labels = rows.map(labelDTO); if (new Set(labels.map((item) => item.id)).size !== labels.length) fail("CRM_UNAVAILABLE"); return labels;
}
function contactDTO(row) {
  const avatar = peerAvatarDTO(row.peerAvatarVersion, "admin", storedId(row.id));
  const access = accessDTO(row.access), version = storedVersion(row.version);
  if (stored(() => validateNickname(row.nickname)) !== row.nickname || typeof row.canSend !== "boolean"
    || !Number.isSafeInteger(row.unreadCount) || row.unreadCount < 0 || row.canSend && access.state !== "active") fail("CRM_UNAVAILABLE");
  const createdAt = dateValue(row.createdAt), closedAt = nullableDate(row.closedAt), lastActivityAt = row.lastActivityAt === null ? createdAt : dateValue(row.lastActivityAt);
  const latestSequence = storedSequence(row.latestSequence), lastReadSequence = storedSequence(row.lastReadSequence), peerReadSequence = storedSequence(row.peerReadSequence);
  if (lastActivityAt < createdAt || closedAt !== null && (closedAt < createdAt || row.canSend)
    || BigInt(lastReadSequence) > BigInt(latestSequence) || BigInt(peerReadSequence) > BigInt(latestSequence)) fail("CRM_UNAVAILABLE");
  return { id: storedId(row.id), client: { id: storedId(row.clientId), pseudonym: storedText(row.clientPseudonym) }, peerName: storedText(row.peerPseudonym),
    ...(avatar ? { peerAvatar: avatar } : {}),
    createdAt, closedAt, lastActivityAt, latestSequence, latestEventSequence: storedSequence(row.latestEventSequence), lastReadSequence, peerReadSequence,
    unreadCount: row.unreadCount, canSend: row.canSend,
    crm: { nickname: row.nickname, labels: labelsDTO(row.labels, 32), reminderAt: nullableDate(row.reminderAt), version }, access };
}
function pageDTO(result, field, limit, afterId, rebuild) {
  if (!result || !Array.isArray(result[field]) || result[field].length > limit || typeof result.hasMore !== "boolean") fail("CRM_UNAVAILABLE");
  let previous = afterId;
  const rows = result[field].map((row) => { const safe = rebuild(row); if (previous !== null && safe.id <= previous) fail("CRM_UNAVAILABLE"); previous = safe.id; return safe; });
  const nextCursor = result.nextCursor === null ? null : storedId(result.nextCursor);
  if (nextCursor !== null && (!rows.length || nextCursor !== previous) || result.hasMore && (!rows.length || nextCursor !== previous)) fail("CRM_UNAVAILABLE");
  return { [field]: rows, nextCursor, hasMore: result.hasMore };
}

export async function createCrmService({ store, authService, authStore, key, clock = Date.now }) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || typeof clock !== "function"
    || typeof authService?.session !== "function" || typeof authStore?.consumeRateLimit !== "function"
    || ["listLabels", "createLabel", "renameLabel", "deleteLabel", "getProfile", "saveProfile", "listContacts"].some((method) => typeof store?.[method] !== "function")) fail("CRM_CONFIG");
  key = Buffer.from(key);
  async function guarded(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof CrmError) throw error;
      if (error?.code === "AUTH_INVALID" || error?.code === "CHAT_UNAUTHORIZED") fail("CRM_UNAUTHORIZED");
      if (allowed.has(error?.code)) throw new CrmError(error.code, error.retryAfter);
      fail("CRM_UNAVAILABLE");
    }
  }
  async function actor(token) {
    try { tokenDigest(token); } catch { fail("CRM_UNAUTHORIZED"); }
    const session = await authService.session(token);
    if (!session || session.user?.role !== "admin") fail("CRM_UNAUTHORIZED");
    stored(() => validateId(session.user.id)); storedText(session.user.pseudonym); dateValue(session.expiresAt);
    try { tokenDigest(session.csrf); } catch { fail("CRM_UNAVAILABLE"); }
    return { user: { id: session.user.id, role: "admin", pseudonym: session.user.pseudonym }, csrf: session.csrf, expiresAt: session.expiresAt };
  }
  async function context(token, mutation = false) {
    const session = await actor(token), now = dateValue(clock());
    const budgets = mutation ? [["user-write", session.user.id, 120]] : [["global-read", "all", 300], ["user-read", session.user.id, 180]];
    for (const [name, identity, limit] of budgets) {
      const bucket = createHmac("sha256", key).update("jessiemessage:crm-rate:v1:").update(name).update("\0").update(identity).digest();
      const result = await authStore.consumeRateLimit(bucket, { now, windowSeconds: 60, limit });
      if (!result || typeof result.allowed !== "boolean") fail("CRM_UNAVAILABLE");
      if (!result.allowed) throw new CrmError("CRM_RATE_LIMIT", result.retryAfter);
    }
    return { session, request: { tokenHash: tokenDigest(token), now: dateValue(clock()) } };
  }
  function profileDTO(row, session, conversationId) {
    if (!row || storedId(row.conversationId) !== conversationId || !row.client
      || !["active", "pending", "revoked", "suspended", "deleted"].includes(row.client.status)) fail("CRM_UNAVAILABLE");
    const version = storedVersion(row.version), notesRevision = storedVersion(row.notesRevision), labels = labelsDTO(row.labels, 32);
    if (stored(() => validateNickname(row.nickname)) !== row.nickname || stored(() => canonicalEmail(row.client.email)) !== row.client.email) fail("CRM_UNAVAILABLE");
    const reminderAt = nullableDate(row.reminderAt), updatedAt = nullableDate(row.updatedAt);
    let notes;
    if (version === "0") {
      if (notesRevision !== "0" || row.notesEncrypted !== null || row.nickname !== "" || reminderAt !== null || updatedAt !== null || labels.length) fail("CRM_UNAVAILABLE");
      notes = "";
    } else {
      if (notesRevision === "0" || BigInt(notesRevision) > BigInt(version) || updatedAt === null) fail("CRM_UNAVAILABLE");
      notes = openNotes(row.notesEncrypted, key, { adminId: validateId(session.user.id), conversationId: row.conversationId, version: notesRevision });
    }
    return { conversationId, client: { id: storedId(row.client.id), pseudonym: storedText(row.client.pseudonym), email: row.client.email, status: row.client.status },
      access: accessDTO(row.access), nickname: row.nickname, notes, reminderAt, labels, version, updatedAt };
  }
  return Object.freeze({
    replyEnabled: store.replyEnabled === true,
    actor: (token) => guarded(() => actor(token)),
    listLabels: (token, input = {}) => guarded(async () => {
      options(input, ["kind", "afterId", "limit"]);
      const { kind = null, afterId = null, limit = 100 } = input;
      if (kind !== null) kindValue(kind); boundedLimit(limit); const after = afterId === null ? null : validateId(afterId);
      const { request } = await context(token);
      return pageDTO(await store.listLabels({ ...request, kind, afterId: after, limit }), "labels", limit, afterId, labelDTO);
    }),
    createLabel: (token, input) => guarded(async () => {
      shape(input, ["kind", "name"]); const kind = kindValue(input.kind), name = validateLabelName(input.name), { request } = await context(token, true);
      const result = await store.createLabel({ ...request, label: { id: randomBytes(16), kind, ...name } });
      if (typeof result?.duplicate !== "boolean") fail("CRM_UNAVAILABLE");
      return { label: labelDTO(result.label), duplicate: result.duplicate };
    }),
    renameLabel: (token, id, input) => guarded(async () => {
      shape(input, ["name", "expectedVersion"]); const labelId = validateId(id), name = validateLabelName(input.name), expectedVersion = validateVersion(input.expectedVersion, { allowZero: false });
      const { request } = await context(token, true);
      const label = labelDTO(await store.renameLabel({ ...request, labelId, expectedVersion, ...name }));
      if (label.id !== id) fail("CRM_UNAVAILABLE"); return label;
    }),
    deleteLabel: (token, id, input) => guarded(async () => {
      shape(input, ["expectedVersion"]); const labelId = validateId(id), expectedVersion = validateVersion(input.expectedVersion, { allowZero: false });
      const { request } = await context(token, true), result = await store.deleteLabel({ ...request, labelId, expectedVersion });
      if (result?.deleted !== true) fail("CRM_UNAVAILABLE"); return { deleted: true };
    }),
    profile: (token, conversationId) => guarded(async () => {
      const id = validateId(conversationId), { session, request } = await context(token);
      return profileDTO(await store.getProfile({ ...request, conversationId: id }), session, conversationId);
    }),
    saveProfile: (token, conversationId, input) => guarded(async () => {
      shape(input, ["expectedVersion", "nickname", "notes", "reminderAt", "labelIds"]);
      const id = validateId(conversationId), expectedVersion = validateVersion(input.expectedVersion), nickname = validateNickname(input.nickname), notes = validateNotes(input.notes),
        reminderAt = validateReminder(input.reminderAt), labelIds = validateLabelIds(input.labelIds);
      if (expectedVersion === "4294967295") fail("CRM_LIMIT");
      const { session, request } = await context(token, true), nextVersion = String(BigInt(expectedVersion) + 1n);
      const notesEncrypted = sealNotes(notes, key, { adminId: validateId(session.user.id), conversationId: id, version: nextVersion });
      return profileDTO(await store.saveProfile({ ...request, conversationId: id, expectedVersion, nickname, notesEncrypted, reminderAt, labelIds }), session, conversationId);
    }),
    contacts: (token, input = {}) => guarded(async () => {
      options(input, ["q", "tagId", "groupId", "access", "unread", "reply", "reminder", "afterId", "limit"]);
      const { q = "", tagId = null, groupId = null, access = "all", unread = false, reply = false, reminder = "all", afterId = null, limit = 50 } = input;
      const search = validateSearch(q), tag = tagId === null ? null : validateId(tagId), group = groupId === null ? null : validateId(groupId), after = afterId === null ? null : validateId(afterId);
      if (!["all", ...states].includes(access) || typeof unread !== "boolean" || typeof reply !== "boolean" || reply && store.replyEnabled !== true || !["all", "due", "upcoming", "none"].includes(reminder)) fail("CRM_INPUT"); boundedLimit(limit);
      const { request } = await context(token);
      return pageDTO(await store.listContacts({ ...request, q: search, tagId: tag, groupId: group, access, unread, ...(reply ? { reply: true } : {}), reminder, afterId: after, limit }), "contacts", limit, afterId, contactDTO);
    }),
  });
}
