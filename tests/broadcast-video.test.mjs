import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { validatePreview, validateCampaign, validatePayload } from "../server/broadcast/validation.mjs";
import { sealPayload, openPayload, campaignFingerprint, createAudienceDigest, recipientProof } from "../server/broadcast/crypto.mjs";
import { issuePreviewToken, readPreviewToken, audienceSelectorHash } from "../server/broadcast/audience.mjs";
import { createBroadcastService } from "../server/broadcast/service.mjs";
import { createBroadcastStore } from "../server/broadcast/store.mjs";
import { createBroadcastWorker } from "../server/broadcast/worker.mjs";
import { decryptMessageBody, videoMessageFingerprint, messageFingerprint } from "../server/chat/crypto.mjs";
import { newToken } from "../server/auth/crypto.mjs";
import { verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData, verifyPhotoNotificationRecoveryCrmBroadcastBackupData } from "../server/backup/verify.mjs";
import * as model from "../public/broadcast-model.js";

const id = value => Buffer.alloc(16, value), hex = value => value.toString("hex"), now = Date.UTC(2026, 9, 22);
const adminId = id(1), clientId = id(2), conversationId = id(3), videoId = id(4), campaignId = id(5);
const audience = { mode: "selected", conversationIds: [hex(conversationId)] };
const digest = () => createAudienceDigest().update(conversationId, clientId).digest();
const payload = (changes = {}) => ({ version: 3, title: "Vidéo privée", body: "", mediaId: null, videoId: hex(videoId), allowRepeatMedia: false,
  audience: { mode: "selected", count: 1, digest: digest(), selectorHash: audienceSelectorHash(audience) }, ...changes });
const binding = { adminId, campaignId }, code = expected => error => error.code === expected;

function job(key) {
  const value = { campaignId, adminId, clientId, conversationId, videoId, mediaId: null, allowRepeatMedia: false,
    mfaVersion: 1, messageId: id(6), leaseToken: id(7) };
  value.clientMessageId = recipientProof(key, value);
  value.payloadEncrypted = sealPayload(payload(), key, binding, { video: true }); return value;
}

test("video payloads require the explicit capability and reject mixed or ambiguous media shapes", () => {
  const preview = { audience, mediaId: null, videoId: hex(videoId) };
  const campaign = { clientCampaignId: hex(id(9)), title: "Vidéo", body: "", ...preview, allowRepeatMedia: false, previewToken: "opaque" };
  for (const [validate, value] of [[validatePreview, preview], [validateCampaign, campaign], [validatePayload, payload()]]) {
    assert.throws(() => validate(value), code("BROADCAST_INPUT"));
    assert.ok(validate(value, { video: true }));
    assert.throws(() => validate({ ...value, mediaId: hex(id(8)) }, { video: true }), code("BROADCAST_INPUT"));
    assert.throws(() => validate({ ...value, videoId: null }, { video: true }), code("BROADCAST_INPUT"));
  }
  assert.throws(() => validateCampaign({ ...campaign, body: "x".repeat(1001) }, { video: true }), code("BROADCAST_INPUT"));
  let executed = false;
  assert.throws(() => validatePayload({ ...payload(), get version() { executed = true; return 3; } }, { video: true }), code("BROADCAST_INPUT"));
  assert.equal(executed, false);
});

test("video encryption and fingerprints have independent namespaces and bind the complete typed asset", () => {
  const key = randomBytes(32), encrypted = sealPayload(payload(), key, binding, { video: true });
  assert.match(encrypted, /^v3\./); assert.equal(encrypted.includes(hex(videoId)), false);
  assert.deepEqual(openPayload(encrypted, key, binding, { video: true }), payload());
  assert.throws(() => openPayload(encrypted, key, binding), code("BROADCAST_CRYPTO"));
  for (const value of [encrypted.replace(/^v3/, "v2"), encrypted.slice(0, -1) + (encrypted.endsWith("A") ? "B" : "A")]) {
    assert.throws(() => openPayload(value, key, binding, { video: true }), code("BROADCAST_CRYPTO"));
  }
  assert.throws(() => openPayload(encrypted, key, { ...binding, adminId: id(9) }, { video: true }), code("BROADCAST_CRYPTO"));
  assert.notDeepEqual(campaignFingerprint(payload(), key, binding, { video: true }), campaignFingerprint(payload({ videoId: hex(id(9)) }), key, binding, { video: true }));
});

test("video preview proof cannot be replayed with another asset, media type or selector", () => {
  const key = randomBytes(32), value = { adminId: hex(adminId), selectorHash: audienceSelectorHash(audience), mediaId: null, videoId: hex(videoId),
    count: 1, digest: digest(), repeatCount: 1, issuedAt: now };
  const token = issuePreviewToken(key, value, { video: true });
  assert.match(token, /^v2\./);
  assert.equal(readPreviewToken(token, key, value, { now, video: true }).repeatCount, 1);
  for (const change of [{ videoId: hex(id(9)) }, { mediaId: hex(id(9)) }, { selectorHash: "f".repeat(64) }]) {
    assert.throws(() => readPreviewToken(token, key, { ...value, ...change }, { now, video: true }), code("BROADCAST_CONFLICT"));
  }
  assert.throws(() => readPreviewToken(token, key, value, { now }), code("BROADCAST_CONFLICT"));
});

test("service video confirmation produces a compact authenticated queue command with SQL photo reference null", async () => {
  const key = randomBytes(32), token = newToken(), commands = [], session = { user: { id: hex(adminId), role: "admin", pseudonym: "Jess" }, csrf: newToken(), expiresAt: now + 10000 };
  const store = { preview() {}, create() {}, activity() {}, list() {}, get() {}, cancel() {},
    async previewAudience(options) { commands.push(options); return { totalCount: 1, eligibleCount: 1, excludedCount: 0, repeatCount: 1, digest: digest(),
      recipients: [{ conversationId, client: { id: clientId, pseudonym: "Client" }, eligible: true, reason: null, repeatMedia: true }] }; },
    async createAudience(options) { commands.push(options); return { duplicate: false, campaign: { ...options.campaign, status: "queued", createdAt: now,
      updatedAt: now, expiresAt: now + 10000, counts: { total: 1, pending: 1, sending: 0, delivered: 0, skipped: 0, cancelled: 0, failed: 0 } } }; } };
  const options = { store, key, authService: { session: async () => session }, authStore: { consumeRateLimit: async () => ({ allowed: true }) }, clock: () => now, largeAudiencesEnabled: true };
  const service = await createBroadcastService({ ...options, videoEnabled: true });
  const input = { audience, mediaId: null, videoId: hex(videoId) }, preview = await service.preview(token, input);
  assert.equal(preview.repeatCount, 1); assert.ok(commands[0].videoId.equals(videoId));
  const result = await service.create(token, { ...input, clientCampaignId: hex(id(9)), title: "Vidéo privée", body: "", allowRepeatMedia: true, previewToken: preview.previewToken });
  const command = commands.at(-1).campaign;
  assert.equal(command.mediaId, null); assert.ok(command.videoId.equals(videoId));
  const opened = openPayload(command.payloadEncrypted, key, { campaignId: command.id, adminId }, { video: true });
  assert.equal(opened.version, 3); assert.equal(opened.videoId, hex(videoId)); assert.equal(opened.audience.count, 1);
  assert.equal(result.campaign.formatVersion, 3); assert.equal(result.campaign.videoId, hex(videoId));
  const disabled = await createBroadcastService(options);
  await assert.rejects(disabled.preview(token, input), code("BROADCAST_INPUT"));
});

test("worker emits an ordinary typed video body with the video fingerprint and no broadcast metadata", async () => {
  for (const enabled of [false, true]) {
    const key = randomBytes(32), value = job(key), commands = [], queue = [value];
    const store = { claim: async () => queue.shift(), deliver: async (_job, options) => { commands.push(options); return { delivered: true }; },
      defer: async () => true, fail: async () => true };
    const worker = createBroadcastWorker({ store, key, videoEnabled: enabled, authStore: { consumeRateLimit: async () => ({ allowed: true }) }, clock: () => now });
    assert.deepEqual(await worker.runOnce(), { delivered: Number(enabled), failed: Number(!enabled), deferred: 0 });
    if (!enabled) { assert.equal(commands.length, 0); continue; }
    const message = commands[0].message, context = { messageId: value.messageId, conversationId, senderId: adminId };
    const body = decryptMessageBody(message.bodyEncrypted, key, context);
    assert.deepEqual(JSON.parse(body), { videoId: hex(videoId), caption: "" });
    assert.ok(message.videoId.equals(videoId)); assert.equal(message.mediaId, undefined);
    assert.deepEqual(message.bodyFingerprint, videoMessageFingerprint(body, key, context));
    assert.notDeepEqual(message.bodyFingerprint, messageFingerprint(body, key, context));
    assert.equal(body.includes("audience"), false); assert.equal(body.includes("Vidéo privée"), false);
    await worker.stop();
  }
});

function deliveryFixture({ unavailable = false, repeat = false } = {}) {
  const key = randomBytes(32), value = job(key), queries = [], events = [], date = value => new Date(value);
  const campaign = { id: campaignId, admin_id: adminId, media_id: null, mfa_version: 1, status: "running", created_at: date(now), expires_at: date(now + 10000),
    payload_encrypted: value.payloadEncrypted, request_fingerprint: campaignFingerprint(payload(), key, binding, { video: true }), allow_repeat_media: 0 };
  const recipient = { conversation_id: conversationId, client_id: clientId, created_at: date(now), available_at: date(now), state: "sending", lease_token: value.leaseToken,
    lease_until: date(now + 10000), proposed_message_id: value.messageId, client_message_id: value.clientMessageId };
  const connection = { async query(sql, parameters) { queries.push({ sql, parameters });
    if (sql.startsWith("SELECT * FROM broadcast_campaigns")) return [campaign];
    if (sql.startsWith("SELECT * FROM broadcast_recipients")) return [recipient];
    if (sql.startsWith("SELECT 1 FROM message_video")) return repeat ? [{}] : [];
    if (sql.startsWith("SELECT COUNT(*)")) return [{ value: 0 }];
    if (sql.startsWith("SELECT 1 FROM broadcast_recipients")) return [];
    if (sql.startsWith("UPDATE")) return { affectedRows: 1 };
    throw new Error("Unexpected query " + sql);
  } };
  const context = { now, actor: { id: adminId, role: "admin" }, reason: null, canSend: true, client: { id: clientId, role: "client", status: "active", invitation_consumed_at: date(now),
    email_verified_at: date(now), access_approved_at: date(now), access_expires_at: null }, conversation: { id: conversationId, admin_id: adminId, client_id: clientId, created_at: date(now), closed_at: null } };
  const chatStore = { withActor() {}, async withBroadcastDelivery(request, operation) { return operation(connection, context, async prepared => {
    events.push({ kind: "append", prepared }); return { message: { id: value.messageId }, duplicate: false };
  }); } };
  const videoStore = { async getCommittedAsset(actual, options) { assert.equal(actual, connection); assert.ok(options.assetId.equals(videoId)); assert.ok(options.ownerId.equals(adminId));
    assert.equal(options.ownerRole, "admin"); events.push({ kind: "owner" });
    if (unavailable) throw Object.assign(new Error("Private catalogue row missing"), { code: "VIDEO_NOT_FOUND" }); return { id: videoId };
  } };
  const videoMessageStore = { async appendBroadcastVideo(actual, current, append, message) { assert.equal(actual, connection); assert.equal(current.actor.role, "admin");
    events.push({ kind: "video" }); return append(message);
  } };
  const store = createBroadcastStore({ getConnection() { assert.fail("Delivery must use the current chat transaction"); } }, { key, chatStore, videoEnabled: true, videoStore, videoMessageStore, clock: () => now });
  return { value, campaign, store, queries, events, deliver: () => store.deliver(value, { now, message: { id: value.messageId, clientMessageId: value.clientMessageId, videoId } }) };
}

test("video delivery validates ownership within the existing transaction and uses the typed ordinary append", async () => {
  const f = deliveryFixture(); assert.deepEqual(await f.deliver(), { delivered: true, duplicate: false });
  assert.deepEqual(f.events.map(event => event.kind), ["owner", "video", "append"]);
  assert.ok(f.events.at(-1).prepared.videoId.equals(videoId));
  assert.equal(f.queries.some(({ sql }) => sql.includes("message_media")), false);
  assert.equal(f.queries.some(({ sql }) => sql.includes("state = 'delivered'")), true);
});

test("missing source video and previous delivery become sanitized terminal skips before append", async () => {
  for (const options of [{ unavailable: true }, { repeat: true }]) {
    const f = deliveryFixture(options); assert.deepEqual(await f.deliver(), { delivered: false });
    assert.equal(f.events.some(event => event.kind === "append"), false);
    const terminal = f.queries.find(({ sql }) => sql.startsWith("UPDATE broadcast_recipients SET state = 'skipped'"));
    assert.ok(terminal); assert.ok(terminal.parameters.includes(options.unavailable ? "media_unavailable" : "repeat_media"));
  }
});

test("video delivery refuses a substituted encrypted asset or queue type", async () => {
  const f = deliveryFixture(); f.value.videoId = id(9); await assert.rejects(f.deliver()); assert.deepEqual(f.events, []);
});

test("manual video backup authenticates pending v3 references and queue proofs while old profiles reject them", async () => {
  const keys = Object.fromEntries(["totpKey", "mailKey", "messageKey", "mediaKey", "crmKey", "notificationKey", "videoKey"].map(name => [name, randomBytes(32)]));
  const value = job(keys.messageKey), row = { id: campaignId, admin_id: adminId, encrypted: value.payloadEncrypted,
    request_fingerprint: campaignFingerprint(payload(), keys.messageKey, binding, { video: true }), media_id: null, allow_repeat_media: 0 };
  let altered = false, pages = 0;
  const pool = { async getConnection() { return { async query(sql, parameters) {
    assert.match(sql, /^SELECT\s/); assert.doesNotMatch(sql, /\b(?:UPDATE|INSERT|DELETE)\b/);
    if (sql.includes("FROM broadcast_campaigns")) return [row];
    if (sql.includes("FROM broadcast_recipients")) { pages++; return [{ conversation_id: conversationId, client_id: clientId, proposed_message_id: value.messageId,
      client_message_id: altered ? id(9) : value.clientMessageId, actual_client: clientId, actual_admin: adminId }]; }
    return [];
  }, release() {} }; } };
  const options = { pool, keys, storage: { get() { assert.fail("No photo"); } }, videoStorage: { open() { assert.fail("No committed video; pending reference is authenticated independently"); } } };
  const report = await verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData(options);
  assert.equal(report.healthy, true); assert.equal(report.counts.broadcastRecipients, 1); assert.equal(pages, 1);
  altered = true; const corrupt = await verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData(options); assert.equal(corrupt.healthy, false);
  const { videoKey, ...oldKeys } = keys;
  const legacy = await verifyPhotoNotificationRecoveryCrmBroadcastBackupData({ ...options, keys: oldKeys }); assert.equal(legacy.healthy, false);
});

test("UI video draft binds preview, repeat confirmation, immutable retries and capability", () => {
  const state = model.createBroadcastState(); state.visible = true;
  const ticket = model.broadcastTicket(state);
  assert.equal(model.acceptBroadcastSession(state, ticket, { user: { id: hex(adminId), role: "admin", pseudonym: "Jess" }, csrf: newToken(), expiresAt: now + 10000,
    mediaEnabled: true, largeAudiencesEnabled: true, videoEnabled: true }, now), true);
  assert.equal(model.updateComposition(state, { title: "Vidéo", body: "", videoId: hex(videoId) }), true);
  model.updateAudience(state, { mode: "all" }); const first = model.previewTicket(state);
  const preview = { recipients: [{ conversationId: hex(conversationId), client: { id: hex(clientId), pseudonym: "Client" }, eligible: true, reason: null, repeatMedia: true }],
    totalCount: 1, eligibleCount: 1, excludedCount: 0, repeatCount: 1, previewToken: "v2.opaque.signature" };
  assert.equal(model.acceptPreview(state, first, preview), true); state.acknowledged = true;
  assert.equal(model.canConfirmBroadcast(state, now), false);
  model.updateComposition(state, { allowRepeatMedia: true }); state.acknowledged = true;
  const command = model.prepareCampaign(state, hex(id(9)), now); assert.equal(command.videoId, hex(videoId)); assert.equal(command.mediaId, null);
  model.rejectCampaign(state, model.broadcastTicket(state)); assert.equal(model.retryCampaign(state), command);
  assert.throws(() => model.parseCampaign({ formatVersion: 3, videoId: hex(videoId) }));
  model.clearBroadcast(state, { visible: true }); assert.equal(state.draft.videoId, undefined);
  assert.equal(model.updateComposition(state, { videoId: hex(videoId) }), false);
});

test("video account erasure shrinks an authenticated compact campaign while preserving the owner's asset and peer proof", async () => {
  const { createErasureStore } = await import("../server/data/erasure-store.mjs");
  for (const corrupt of [false, true]) {
    const key = randomBytes(32), peerId = id(10), peerConversationId = id(11), created = new Date(now - 1000).toISOString().replace("T", " ").replace("Z", "000");
    const recipients = [[conversationId, clientId], [peerConversationId, peerId]].map(([conversation, client], n) => ({
      conversation_id: conversation, client_id: client, actual_client: client, actual_admin: adminId, proposed_message_id: id(20 + n), state: "pending",
    }));
    for (const recipient of recipients) recipient.client_message_id = recipientProof(key, { ...binding, conversationId: recipient.conversation_id,
      clientId: recipient.client_id, messageId: recipient.proposed_message_id });
    const audienceDigest = createAudienceDigest(); for (const recipient of recipients) audienceDigest.update(recipient.conversation_id, recipient.client_id);
    const original = payload({ audience: { ...payload().audience, count: 2, digest: audienceDigest.digest() } });
    const row = { id: campaignId, admin_id: adminId, media_id: null, allow_repeat_media: 0, status: "queued", updated_at: created,
      payload_encrypted: sealPayload(original, key, binding, { video: true }), request_fingerprint: campaignFingerprint(original, key, binding, { video: true }) };
    if (corrupt) recipients[0].client_message_id = id(99);
    const writes = [], capacity = { ownerBytes: 1024, totalBytes: 4096, rootFingerprint: randomBytes(32) }; let rolledBack = false;
    const connection = { async beginTransaction() {}, async commit() {}, async rollback() { rolledBack = true; }, release() {}, async query(sql, parameters = []) {
      if (sql.startsWith("SELECT DATABASE()")) return [{ name: "synthetic_video_erasure" }];
      if (sql.startsWith("SELECT GET_LOCK")) return [{ acquired: 1 }];
      if (sql.startsWith("SELECT RELEASE_LOCK")) return [{ released: 1 }];
      if (sql.startsWith("SELECT IS_USED_LOCK")) return [{ owned: 1 }];
      if (sql.startsWith("SELECT owner_bytes")) return [{ owner_bytes: 1024, total_bytes: 4096, root_fingerprint: capacity.rootFingerprint, held_bytes: 0 }];
      if (sql.startsWith("SELECT COALESCE(SUM")) return [{ value: 0 }];
      if (sql.startsWith("SELECT id, role, status")) return [{ id: clientId, role: "client", status: "active", created_at: created, updated_at: created }];
      if (sql.startsWith("SELECT id, client_id, admin_id")) return [{ id: conversationId, client_id: clientId, admin_id: adminId }];
      if (sql.startsWith("SELECT * FROM broadcast_campaigns")) return [row];
      if (sql.startsWith("SELECT r.*, c.client_id")) return recipients;
      if (/^(?:DELETE|UPDATE)\b/.test(sql)) {
        writes.push({ sql, parameters });
        if (sql.startsWith("DELETE FROM broadcast_recipients")) { recipients.splice(0, 1); return { affectedRows: 1 }; }
        if (sql.startsWith("UPDATE broadcast_campaigns")) { row.payload_encrypted = parameters[0]; row.request_fingerprint = parameters[1]; }
        return { affectedRows: 1 };
      }
      assert.match(sql, /^SELECT\s/); return [];
    } };
    const video = Object.fromEntries(["assertSchema", "snapshot", "inspect", "prepare", "next", "release", "finish", "verifyAbsent"].map(name => [name, async () => {}]));
    video.rootFingerprint = "a".repeat(64);
    const store = createErasureStore({ pool: { getConnection: async () => connection }, database: "synthetic_video_erasure", capacity, broadcastKey: key, video });
    const operation = () => store.withLease(hex(clientId), scope => scope.prepare(now));
    if (corrupt) { await assert.rejects(operation(), code("ERASURE_CAMPAIGN")); assert.deepEqual(writes, []); assert.equal(rolledBack, true); continue; }
    assert.deepEqual(await operation(), { prepared: true });
    const retained = openPayload(row.payload_encrypted, key, binding, { video: true });
    assert.equal(retained.videoId, hex(videoId)); assert.equal(retained.mediaId, null); assert.equal(retained.audience.count, 1);
    assert.equal(retained.audience.digest, createAudienceDigest().update(peerConversationId, peerId).digest());
    assert.deepEqual(row.request_fingerprint, campaignFingerprint(retained, key, binding, { video: true }));
    assert.equal(recipients.length, 1); assert.ok(recipients[0].client_id.equals(peerId));
    assert.equal(writes.some(({ sql }) => /(?:UPDATE|DELETE FROM) video_assets/.test(sql)), false);
    assert.equal(rolledBack, false);
  }
});
