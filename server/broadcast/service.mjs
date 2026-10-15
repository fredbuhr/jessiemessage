import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { csrfToken, tokenDigest } from "../auth/crypto.mjs";
import { campaignFingerprint, openPayload, sealPayload } from "./crypto.mjs";
import { validateCampaign, validateId, validatePreview, validateVersion } from "./validation.mjs";

export class BroadcastError extends Error {
  constructor(code, retryAfter) {
    super("Private broadcasts could not be completed."); this.name = "BroadcastError"; this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}
const fail = (code) => { throw new BroadcastError(code); };
const states = ["pending", "sending", "delivered", "skipped", "cancelled", "failed"];
const statuses = ["queued", "running", "completed", "cancelled", "paused"];
const reasons = ["access_inactive", "opted_out", "conversation_unavailable", "media_unavailable", "repeat_media", "expired", "administrator_invalid", "processing_failed", "cancelled"];
const permitted = new Set(["BROADCAST_INPUT", "BROADCAST_UNAUTHORIZED", "BROADCAST_NOT_FOUND", "BROADCAST_CONFLICT", "BROADCAST_LIMIT", "BROADCAST_RECIPIENTS", "BROADCAST_REPEAT", "BROADCAST_MEDIA", "BROADCAST_RATE_LIMIT"]);
const storedId = (value) => { if (!Buffer.isBuffer(value) || value.length !== 16) fail("BROADCAST_UNAVAILABLE"); return value.toString("hex"); };
const date = (value) => { if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) fail("BROADCAST_UNAVAILABLE"); return value; };
const text = (value, max = 64) => { if (typeof value !== "string" || !value.isWellFormed() || value.length > max) fail("BROADCAST_UNAVAILABLE"); return value; };
const exact = (value, keys) => { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail("BROADCAST_INPUT"); };
function version(value) { try { return validateVersion(value); } catch { fail("BROADCAST_UNAVAILABLE"); } }
function preferenceDTO(row) {
  if (!row || typeof row.enabled !== "boolean") fail("BROADCAST_UNAVAILABLE");
  const current = version(row.version), updatedAt = row.updatedAt === null ? null : date(row.updatedAt);
  if (current === "0" && (row.enabled || updatedAt !== null) || current !== "0" && updatedAt === null) fail("BROADCAST_UNAVAILABLE");
  return { enabled: row.enabled, version: current, updatedAt };
}

export async function createBroadcastService({ store, authService, authStore, key, mediaEnabled = false, clock = Date.now }) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || typeof clock !== "function" || typeof mediaEnabled !== "boolean"
    || typeof authService?.session !== "function" || typeof authStore?.consumeRateLimit !== "function"
    || ["preferenceActor", "getPreference", "savePreference", "preview", "create", "list", "get", "cancel"].some((method) => typeof store?.[method] !== "function")) fail("BROADCAST_CONFIG");
  key = Buffer.from(key);
  async function guarded(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof BroadcastError) throw error;
      if (["AUTH_INVALID", "CHAT_UNAUTHORIZED", "CHAT_FORBIDDEN"].includes(error?.code)) fail("BROADCAST_UNAUTHORIZED");
      if (permitted.has(error?.code)) throw new BroadcastError(error.code, error.retryAfter);
      if (["AUTH_RATE_LIMIT", "AUTH_BUSY"].includes(error?.code)) throw new BroadcastError("BROADCAST_RATE_LIMIT", error.retryAfter);
      fail("BROADCAST_UNAVAILABLE");
    }
  }
  async function actor(role, token) {
    if (!["admin", "client"].includes(role)) fail("BROADCAST_INPUT");
    let hash; try { hash = tokenDigest(token); } catch { fail("BROADCAST_UNAUTHORIZED"); }
    let session;
    if (role === "admin") session = await authService.session(token);
    else {
      const current = await store.preferenceActor({ tokenHash: hash, now: date(clock()) });
      if (!current) fail("BROADCAST_UNAUTHORIZED");
      session = { user: { id: storedId(current.id), pseudonym: current.pseudonym, role }, csrf: csrfToken(token), expiresAt: current.expiresAt };
    }
    if (!session || session.user?.role !== role) fail("BROADCAST_UNAUTHORIZED");
    try { validateId(session.user.id); tokenDigest(session.csrf); } catch { fail("BROADCAST_UNAVAILABLE"); }
    return { user: { id: session.user.id, role, pseudonym: text(session.user.pseudonym) }, csrf: session.csrf, expiresAt: date(session.expiresAt) };
  }
  async function context(role, token, mutation = false) {
    const session = await actor(role, token), now = date(clock());
    const budgets = mutation ? [["user-write", session.user.id, 30]] : [["global-read", "all", 300], ["user-read", session.user.id, 120]];
    for (const [name, identity, limit] of budgets) {
      const bucket = createHmac("sha256", key).update("jessiemessage:broadcast-rate:v1:").update(name).update("\0").update(identity).digest();
      const result = await authStore.consumeRateLimit(bucket, { now, windowSeconds: 60, limit });
      if (!result || typeof result.allowed !== "boolean") fail("BROADCAST_UNAVAILABLE");
      if (!result.allowed) throw new BroadcastError("BROADCAST_RATE_LIMIT", result.retryAfter);
    }
    return { session, request: { tokenHash: tokenDigest(token), now } };
  }
  function imageEnabled(mediaId) { if (mediaId !== null && !mediaEnabled) fail("BROADCAST_MEDIA"); }
  function campaignDTO(row, session, detail = false, expectedFingerprint = null) {
    if (!row || !statuses.includes(row.status) || typeof row.allowRepeatMedia !== "boolean") fail("BROADCAST_UNAVAILABLE");
    const id = storedId(row.id), clientCampaignId = storedId(row.clientCampaignId);
    const payload = openPayload(row.payloadEncrypted, key, { campaignId: row.id, adminId: Buffer.from(session.user.id, "hex") });
    if (expectedFingerprint !== null && !timingSafeEqual(expectedFingerprint,
      campaignFingerprint(payload, key, { adminId: Buffer.from(session.user.id, "hex") }))) fail("BROADCAST_UNAVAILABLE");
    const mediaId = row.mediaId === null ? null : storedId(row.mediaId);
    if (payload.mediaId !== mediaId || payload.allowRepeatMedia !== row.allowRepeatMedia) fail("BROADCAST_UNAVAILABLE");
    const createdAt = date(row.createdAt), updatedAt = date(row.updatedAt), expiresAt = date(row.expiresAt);
    if (updatedAt < createdAt || expiresAt <= createdAt || !row.counts) fail("BROADCAST_UNAVAILABLE");
    const counts = {};
    for (const name of ["total", ...states]) {
      if (!Number.isSafeInteger(row.counts[name]) || row.counts[name] < 0 || row.counts[name] > 100) fail("BROADCAST_UNAVAILABLE");
      counts[name] = row.counts[name];
    }
    if (counts.total !== payload.conversationIds.length || states.reduce((sum, state) => sum + counts[state], 0) !== counts.total) fail("BROADCAST_UNAVAILABLE");
    const dto = { id, clientCampaignId, title: payload.title, body: payload.body, mediaId, allowRepeatMedia: payload.allowRepeatMedia,
      status: row.status, createdAt, updatedAt, expiresAt, counts };
    if (detail) {
      if (!Array.isArray(row.recipients) || row.recipients.length !== counts.total) fail("BROADCAST_UNAVAILABLE");
      const seen = new Set();
      dto.recipients = row.recipients.map((recipient) => {
        const conversationId = storedId(recipient.conversationId);
        if (!payload.conversationIds.includes(conversationId) || seen.has(conversationId) || !recipient.client
          || !states.includes(recipient.state) || recipient.reason !== null && !reasons.includes(recipient.reason)) fail("BROADCAST_UNAVAILABLE");
        seen.add(conversationId);
        const messageId = recipient.messageId === null ? null : storedId(recipient.messageId);
        const deliveredAt = recipient.deliveredAt === null ? null : date(recipient.deliveredAt);
        if ((recipient.state === "delivered") !== (messageId !== null && deliveredAt !== null)
          || recipient.state !== "delivered" && (messageId !== null || deliveredAt !== null)) fail("BROADCAST_UNAVAILABLE");
        return { conversationId, client: { id: storedId(recipient.client.id), pseudonym: text(recipient.client.pseudonym) },
          state: recipient.state, reason: recipient.reason, messageId, deliveredAt };
      });
      for (const state of states) if (dto.recipients.filter((recipient) => recipient.state === state).length !== counts[state]) fail("BROADCAST_UNAVAILABLE");
    }
    return dto;
  }
  return Object.freeze({
    actor: (role, token) => guarded(() => actor(role, token)),
    preference: (token) => guarded(async () => {
      const { request } = await context("client", token);
      return preferenceDTO(await store.getPreference(request));
    }),
    savePreference: (token, input) => guarded(async () => {
      exact(input, ["enabled", "expectedVersion"]);
      if (typeof input.enabled !== "boolean") fail("BROADCAST_INPUT"); validateVersion(input.expectedVersion);
      const { request } = await context("client", token, true);
      return preferenceDTO(await store.savePreference({ ...request, enabled: input.enabled, expectedVersion: input.expectedVersion }));
    }),
    preview: (token, input) => guarded(async () => {
      const parsed = validatePreview(input); imageEnabled(parsed.mediaId);
      const { request } = await context("admin", token);
      const row = await store.preview({ ...request, ...parsed });
      if (!row || !Array.isArray(row.recipients) || row.recipients.length !== parsed.conversationIds.length) fail("BROADCAST_UNAVAILABLE");
      const expected = new Set(parsed.conversationIds.map((id) => id.toString("hex"))), seen = new Set();
      const recipients = row.recipients.map((recipient) => {
        const conversationId = storedId(recipient.conversationId);
        if (!expected.has(conversationId) || seen.has(conversationId) || !recipient.client || typeof recipient.eligible !== "boolean"
          || typeof recipient.repeatMedia !== "boolean" || ![null, "access_inactive", "opted_out", "conversation_unavailable"].includes(recipient.reason)
          || recipient.eligible !== (recipient.reason === null) || parsed.mediaId === null && recipient.repeatMedia) fail("BROADCAST_UNAVAILABLE");
        seen.add(conversationId);
        return { conversationId, client: { id: storedId(recipient.client.id), pseudonym: text(recipient.client.pseudonym) },
          eligible: recipient.eligible, reason: recipient.reason, repeatMedia: recipient.repeatMedia };
      });
      const eligibleCount = recipients.filter((item) => item.eligible).length, repeatCount = recipients.filter((item) => item.repeatMedia).length;
      if (row.eligibleCount !== eligibleCount || row.repeatCount !== repeatCount) fail("BROADCAST_UNAVAILABLE");
      return { recipients, eligibleCount, repeatCount };
    }),
    create: (token, input) => guarded(async () => {
      const parsed = validateCampaign(input); imageEnabled(parsed.mediaId);
      const { session, request } = await context("admin", token, true);
      const id = randomBytes(16), adminId = Buffer.from(session.user.id, "hex");
      const payload = { title: parsed.title, body: parsed.body, mediaId: parsed.mediaId?.toString("hex") ?? null,
        allowRepeatMedia: parsed.allowRepeatMedia, conversationIds: parsed.conversationIds.map((value) => value.toString("hex")) };
      const requestFingerprint = campaignFingerprint(payload, key, { adminId });
      const result = await store.create({ ...request, campaign: { id, clientCampaignId: parsed.clientCampaignId,
        payloadEncrypted: sealPayload(payload, key, { campaignId: id, adminId }), requestFingerprint,
        mediaId: parsed.mediaId, allowRepeatMedia: parsed.allowRepeatMedia,
        recipients: parsed.conversationIds.map((conversationId) => ({ conversationId, messageId: randomBytes(16), clientMessageId: randomBytes(16) })) } });
      if (!result || typeof result.duplicate !== "boolean") fail("BROADCAST_UNAVAILABLE");
      const campaign = campaignDTO(result.campaign, session, false, requestFingerprint);
      if (campaign.clientCampaignId !== input.clientCampaignId) fail("BROADCAST_UNAVAILABLE");
      return { campaign, duplicate: result.duplicate };
    }),
    list: (token, input = {}) => guarded(async () => {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((name) => !["afterId", "limit"].includes(name))) fail("BROADCAST_INPUT");
      const { afterId = null, limit = 20 } = input;
      const after = afterId === null ? null : validateId(afterId);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail("BROADCAST_INPUT");
      const { session, request } = await context("admin", token);
      const result = await store.list({ ...request, afterId: after, limit });
      if (!result || !Array.isArray(result.campaigns) || result.campaigns.length > limit || typeof result.hasMore !== "boolean") fail("BROADCAST_UNAVAILABLE");
      let previous = afterId;
      const campaigns = result.campaigns.map((row) => { const dto = campaignDTO(row, session); if (previous !== null && dto.id <= previous) fail("BROADCAST_UNAVAILABLE"); previous = dto.id; return dto; });
      const nextCursor = result.nextCursor === null ? null : storedId(result.nextCursor);
      if (nextCursor !== null && (!campaigns.length || nextCursor !== previous) || result.hasMore && nextCursor === null) fail("BROADCAST_UNAVAILABLE");
      return { campaigns, nextCursor, hasMore: result.hasMore };
    }),
    get: (token, id) => guarded(async () => {
      const campaignId = validateId(id), { session, request } = await context("admin", token);
      const result = campaignDTO(await store.get({ ...request, campaignId }), session, true);
      if (result.id !== id) fail("BROADCAST_UNAVAILABLE"); return result;
    }),
    cancel: (token, id) => guarded(async () => {
      const campaignId = validateId(id), { session, request } = await context("admin", token, true);
      const result = campaignDTO(await store.cancel({ ...request, campaignId }), session);
      if (result.id !== id) fail("BROADCAST_UNAVAILABLE"); return result;
    }),
  });
}
