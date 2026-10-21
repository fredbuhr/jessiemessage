import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { tokenDigest } from "../auth/crypto.mjs";
import { campaignFingerprint, openPayload, sealPayload, recipientProof, verifyRecipientProof } from "./crypto.mjs";
import { validateCampaign, validateId, validatePreview } from "./validation.mjs";
import { audienceSelectorHash, issuePreviewToken, readPreviewToken } from "./audience.mjs";

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
export async function createBroadcastService({ store, authService, authStore, key, mediaEnabled = false, largeAudiencesEnabled = false, clock = Date.now }) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || typeof clock !== "function" || typeof mediaEnabled !== "boolean" || typeof largeAudiencesEnabled !== "boolean"
    || typeof authService?.session !== "function" || typeof authStore?.consumeRateLimit !== "function"
    || ["preview", "create", "activity", "list", "get", "cancel"].some((method) => typeof store?.[method] !== "function")) fail("BROADCAST_CONFIG");
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
    if (role !== "admin") fail("BROADCAST_UNAUTHORIZED");
    try { tokenDigest(token); } catch { fail("BROADCAST_UNAUTHORIZED"); }
    const session = await authService.session(token);
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
    return { session, request: { tokenHash: tokenDigest(token), now: date(clock()) } };
  }
  function imageEnabled(mediaId) { if (mediaId !== null && !mediaEnabled) fail("BROADCAST_MEDIA"); }
  function recipientDTO(recipient, payload, binding) {
    if (!recipient || !recipient.client || !states.includes(recipient.state)
      || recipient.reason !== null && !reasons.includes(recipient.reason)) fail("BROADCAST_UNAVAILABLE");
    const conversationId = storedId(recipient.conversationId), clientId = storedId(recipient.client.id);
    if (payload.version === 2) {
      if (!verifyRecipientProof(key, { ...binding, conversationId: recipient.conversationId, clientId: recipient.client.id,
        messageId: recipient.proposedMessageId }, recipient.clientMessageId)) fail("BROADCAST_UNAVAILABLE");
    } else if (!payload.conversationIds.includes(conversationId)) fail("BROADCAST_UNAVAILABLE");
    const messageId = recipient.messageId === null ? null : storedId(recipient.messageId);
    const deliveredAt = recipient.deliveredAt === null ? null : date(recipient.deliveredAt);
    if (payload.version === 2 && messageId !== null && messageId !== storedId(recipient.proposedMessageId)
      || (recipient.state === "delivered") !== (messageId !== null && deliveredAt !== null)
      || recipient.state !== "delivered" && (messageId !== null || deliveredAt !== null)
      || ["pending", "sending", "delivered"].includes(recipient.state) && recipient.reason !== null
      || ["skipped", "cancelled", "failed"].includes(recipient.state) && recipient.reason === null
      || recipient.state === "failed" && recipient.reason !== "processing_failed"
      || recipient.state === "cancelled" && !["cancelled", "administrator_invalid"].includes(recipient.reason)) fail("BROADCAST_UNAVAILABLE");
    return { conversationId, client: { id: clientId, pseudonym: text(recipient.client.pseudonym) },
      state: recipient.state, reason: recipient.reason, messageId, deliveredAt };
  }
  function recipientPageDTO(row, payload, binding, { afterId = null, limit = 50 } = {}, total) {
    if (!row || !Array.isArray(row.recipients) || row.recipients.length > limit || typeof row.hasMore !== "boolean") fail("BROADCAST_UNAVAILABLE");
    let previous = afterId;
    const recipients = row.recipients.map((value) => {
      const dto = recipientDTO(value, payload, binding);
      if (previous !== null && dto.conversationId <= previous) fail("BROADCAST_UNAVAILABLE"); previous = dto.conversationId; return dto;
    });
    const nextCursor = row.nextCursor === null ? null : storedId(row.nextCursor);
    if (row.hasMore && (!recipients.length || nextCursor !== previous) || !row.hasMore && nextCursor !== null
      || afterId === null && (recipients.length !== Math.min(limit, total) || row.hasMore !== (total > limit))) fail("BROADCAST_UNAVAILABLE");
    return { recipients, hasMore: row.hasMore, nextCursor };
  }
  function campaignDTO(row, session, detail = false, expectedFingerprint = null, expectedPayload = null) {
    if (!row || !statuses.includes(row.status) || typeof row.allowRepeatMedia !== "boolean") fail("BROADCAST_UNAVAILABLE");
    const id = storedId(row.id), clientCampaignId = storedId(row.clientCampaignId);
    const binding = { campaignId: row.id, adminId: Buffer.from(session.user.id, "hex") };
    const payload = openPayload(row.payloadEncrypted, key, binding);
    if (expectedFingerprint !== null && !timingSafeEqual(expectedFingerprint,
      campaignFingerprint(payload, key, { adminId: binding.adminId }))) fail("BROADCAST_UNAVAILABLE");
    if (expectedPayload !== null && JSON.stringify(payload) !== JSON.stringify(expectedPayload)) fail("BROADCAST_UNAVAILABLE");
    const mediaId = row.mediaId === null ? null : storedId(row.mediaId);
    if (payload.mediaId !== mediaId || payload.allowRepeatMedia !== row.allowRepeatMedia) fail("BROADCAST_UNAVAILABLE");
    const createdAt = date(row.createdAt), updatedAt = date(row.updatedAt), expiresAt = date(row.expiresAt);
    if (updatedAt < createdAt || expiresAt <= createdAt || !row.counts) fail("BROADCAST_UNAVAILABLE");
    const counts = {};
    for (const name of ["total", ...states]) {
      if (!Number.isSafeInteger(row.counts[name]) || row.counts[name] < 0) fail("BROADCAST_UNAVAILABLE");
      counts[name] = row.counts[name];
    }
    const total = payload.version === 2 ? payload.audience.count : payload.conversationIds.length;
    if (counts.total !== total || states.reduce((sum, state) => sum + counts[state], 0) !== counts.total
      || ["completed", "cancelled", "paused"].includes(row.status) && (counts.pending || counts.sending)) fail("BROADCAST_UNAVAILABLE");
    const dto = { id, clientCampaignId, title: payload.title, body: payload.body, mediaId, allowRepeatMedia: payload.allowRepeatMedia,
      status: row.status, createdAt, updatedAt, expiresAt, counts };
    if (payload.version === 2) { dto.formatVersion = 2; dto.audienceMode = payload.audience.mode; }
    if (detail) {
      if (payload.version === 2) Object.assign(dto, recipientPageDTO(row, payload, binding, {}, counts.total));
      else {
        if (!Array.isArray(row.recipients) || row.recipients.length !== counts.total) fail("BROADCAST_UNAVAILABLE");
        const seen = new Set();
        dto.recipients = row.recipients.map((value) => { const recipient = recipientDTO(value, payload, binding);
          if (seen.has(recipient.conversationId)) fail("BROADCAST_UNAVAILABLE"); seen.add(recipient.conversationId); return recipient; });
        for (const state of states) if (dto.recipients.filter((recipient) => recipient.state === state).length !== counts[state]) fail("BROADCAST_UNAVAILABLE");
      }
    }
    return dto;
  }
  function audiencePreviewDTO(row, parsed, session) {
    const count = (value) => Number.isSafeInteger(value) && value >= 0;
    if (!row || ![row.totalCount, row.eligibleCount, row.excludedCount, row.repeatCount].every(count)
      || row.totalCount !== row.eligibleCount + row.excludedCount || row.repeatCount > row.eligibleCount
      || !/^[a-f0-9]{64}$/.test(row.digest) || !Array.isArray(row.recipients) || row.recipients.length !== Math.min(50, row.totalCount)
      || parsed.mediaId === null && row.repeatCount !== 0
      || parsed.audience.mode === "selected" && row.totalCount !== parsed.audience.conversationIds.length) fail("BROADCAST_UNAVAILABLE");
    let previous = null, eligible = 0, repeat = 0;
    const recipients = row.recipients.map((recipient, index) => {
      const conversationId = storedId(recipient.conversationId);
      if (previous !== null && conversationId <= previous || !recipient.client || typeof recipient.eligible !== "boolean"
        || typeof recipient.repeatMedia !== "boolean" || ![null, "access_inactive", "conversation_unavailable"].includes(recipient.reason)
        || recipient.eligible !== (recipient.reason === null) || parsed.mediaId === null && recipient.repeatMedia
        || parsed.audience.mode === "selected" && conversationId !== parsed.audience.conversationIds[index]) fail("BROADCAST_UNAVAILABLE");
      previous = conversationId; eligible += Number(recipient.eligible); repeat += Number(recipient.eligible && recipient.repeatMedia);
      return { conversationId, client: { id: storedId(recipient.client.id), pseudonym: text(recipient.client.pseudonym) },
        eligible: recipient.eligible, reason: recipient.reason, repeatMedia: recipient.repeatMedia };
    });
    if (eligible > row.eligibleCount || recipients.length - eligible > row.excludedCount || repeat > row.repeatCount
      || row.totalCount <= 50 && (eligible !== row.eligibleCount || repeat !== row.repeatCount)) fail("BROADCAST_UNAVAILABLE");
    const previewToken = issuePreviewToken(key, { adminId: session.user.id, selectorHash: audienceSelectorHash(parsed.audience),
      mediaId: parsed.mediaId?.toString("hex") ?? null, count: row.eligibleCount, digest: row.digest, repeatCount: row.repeatCount, issuedAt: date(clock()) });
    return { recipients, totalCount: row.totalCount, eligibleCount: row.eligibleCount, excludedCount: row.excludedCount, repeatCount: row.repeatCount, previewToken };
  }
  return Object.freeze({
    largeAudiencesEnabled,
    actor: (role, token) => guarded(() => actor(role, token)),
    preview: (token, input) => guarded(async () => {
      const parsed = validatePreview(input); imageEnabled(parsed.mediaId);
      if (parsed.audience && !largeAudiencesEnabled) fail("BROADCAST_INPUT");
      const { session, request } = await context("admin", token);
      if (parsed.audience) {
        if (typeof store.previewAudience !== "function") fail("BROADCAST_UNAVAILABLE");
        return audiencePreviewDTO(await store.previewAudience({ ...request, ...parsed }), parsed, session);
      }
      const row = await store.preview({ ...request, ...parsed });
      if (!row || !Array.isArray(row.recipients) || row.recipients.length !== parsed.conversationIds.length) fail("BROADCAST_UNAVAILABLE");
      const expected = new Set(parsed.conversationIds.map((id) => id.toString("hex"))), seen = new Set();
      const recipients = row.recipients.map((recipient) => {
        const conversationId = storedId(recipient.conversationId);
        if (!expected.has(conversationId) || seen.has(conversationId) || !recipient.client || typeof recipient.eligible !== "boolean"
          || typeof recipient.repeatMedia !== "boolean" || ![null, "access_inactive", "conversation_unavailable"].includes(recipient.reason)
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
      if (parsed.audience && !largeAudiencesEnabled) fail("BROADCAST_INPUT");
      const { session, request } = await context("admin", token, true);
      const id = randomBytes(16), adminId = Buffer.from(session.user.id, "hex");
      if (parsed.audience) {
        if (typeof store.createAudience !== "function") fail("BROADCAST_UNAVAILABLE");
        const binding = { adminId: session.user.id, selectorHash: audienceSelectorHash(parsed.audience), mediaId: parsed.mediaId?.toString("hex") ?? null };
        const snapshot = readPreviewToken(parsed.previewToken, key, binding, { now: request.now, fresh: false });
        if (snapshot.count < 1) fail("BROADCAST_RECIPIENTS");
        const payload = { version: 2, title: parsed.title, body: parsed.body, mediaId: binding.mediaId, allowRepeatMedia: parsed.allowRepeatMedia,
          audience: { mode: parsed.audience.mode, count: snapshot.count, digest: snapshot.digest, selectorHash: binding.selectorHash } };
        const requestFingerprint = campaignFingerprint(payload, key, { adminId });
        const result = await store.createAudience({ ...request, audience: parsed.audience, snapshot,
          verifyPreview: (now) => readPreviewToken(parsed.previewToken, key, binding, { now }),
          campaign: { id, clientCampaignId: parsed.clientCampaignId, requestFingerprint,
            payloadEncrypted: sealPayload(payload, key, { campaignId: id, adminId }), mediaId: parsed.mediaId,
            allowRepeatMedia: parsed.allowRepeatMedia, recipientProof: (binding) => recipientProof(key, binding) } });
        if (!result || typeof result.duplicate !== "boolean") fail("BROADCAST_UNAVAILABLE");
        const campaign = campaignDTO(result.campaign, session, false, requestFingerprint, payload);
        if (campaign.clientCampaignId !== input.clientCampaignId) fail("BROADCAST_UNAVAILABLE");
        return { campaign, duplicate: result.duplicate };
      }
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
    activity: (token) => guarded(async () => {
      const { session, request } = await context("admin", token);
      const result = await store.activity(request);
      if (!result || !Array.isArray(result.campaigns) || result.campaigns.length > 30) fail("BROADCAST_UNAVAILABLE");
      const seen = new Set(); let previous = null, active = 0;
      const campaigns = result.campaigns.map((row) => {
        const dto = campaignDTO(row, session);
        if (seen.has(dto.id) || previous && (dto.createdAt > previous.createdAt || dto.createdAt === previous.createdAt && dto.id >= previous.id)) fail("BROADCAST_UNAVAILABLE");
        seen.add(dto.id); previous = dto;
        if (["queued", "running"].includes(dto.status)) active += 1;
        return dto;
      });
      if (active > 10 || campaigns.length - active > 20) fail("BROADCAST_UNAVAILABLE");
      return { campaigns };
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
    summary: (token, id) => guarded(async () => {
      const campaignId = validateId(id), { session, request } = await context("admin", token);
      if (typeof store.summary !== "function") fail("BROADCAST_UNAVAILABLE");
      const result = campaignDTO(await store.summary({ ...request, campaignId }), session);
      if (result.id !== id) fail("BROADCAST_UNAVAILABLE"); return result;
    }),
    recipients: (token, id, input = {}) => guarded(async () => {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((name) => !["afterId", "limit"].includes(name))) fail("BROADCAST_INPUT");
      const { afterId = null, limit = 50 } = input, after = afterId === null ? null : validateId(afterId), campaignId = validateId(id);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail("BROADCAST_INPUT");
      const { session, request } = await context("admin", token);
      if (typeof store.recipients !== "function") fail("BROADCAST_UNAVAILABLE");
      const result = await store.recipients({ ...request, campaignId, afterId: after, limit });
      const campaign = campaignDTO(result?.campaign, session);
      if (campaign.id !== id) fail("BROADCAST_UNAVAILABLE");
      const binding = { campaignId, adminId: Buffer.from(session.user.id, "hex") };
      const payload = openPayload(result.campaign.payloadEncrypted, key, binding);
      return { campaignId: id, ...recipientPageDTO(result, payload, binding, { afterId, limit }, campaign.counts.total) };
    }),
    cancel: (token, id) => guarded(async () => {
      const campaignId = validateId(id), { session, request } = await context("admin", token, true);
      const result = campaignDTO(await store.cancel({ ...request, campaignId }), session);
      if (result.id !== id) fail("BROADCAST_UNAVAILABLE"); return result;
    }),
  });
}
