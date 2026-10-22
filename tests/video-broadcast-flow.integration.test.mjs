// Candidate SQL36 only. This fixture never promotes normal SQL33 or activates production.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { newToken, tokenDigest, csrfToken } from "../server/auth/crypto.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createAuthService } from "../server/auth/service.mjs";
import { createAccessStore } from "../server/access/store.mjs";
import { createAccessService } from "../server/access/service.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createChatService } from "../server/chat/service.mjs";
import { createChatHandler } from "../server/chat/http.mjs";
import { createVideoStore } from "../server/video/store.mjs";
import { createVideoMessageStore } from "../server/video/message-store.mjs";
import { loadVideoMigrations } from "../server/video/migrations.mjs";
import { createVideoService } from "../server/video/service.mjs";
import { createVideoHandler } from "../server/video/http.mjs";
import { createVideoStorage } from "../server/video/storage.mjs";
import { createBroadcastStore } from "../server/broadcast/store.mjs";
import { createBroadcastService } from "../server/broadcast/service.mjs";
import { createBroadcastWorker } from "../server/broadcast/worker.mjs";
import { createBroadcastHandler } from "../server/broadcast/http.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import { collectVideo, mp4Source } from "./helpers/video-transport-fixture.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1", id = () => randomBytes(16), key = () => randomBytes(32), hex = value => value.toString("hex");
const sql = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000"), origin = "https://example.invalid";

test("SQL36 video broadcasts protect queued originals, preserve private delivery and release unused terminal sources", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 180000,
}, async () => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  assert.notEqual(process.env.JESSIEMESSAGE_RUNTIME_DB_USER, options.user);
  const base = await loadMigrations(), migrations = await loadVideoMigrations();
  assert.equal(base.length, 33); assert.equal(migrations.length, 36);
  const allowed = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool, server, root;
  const now = Date.UTC(2026, 9, 22, 12), clock = () => now, created = sql(now - 1000);
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every(row => allowed.includes(row.name)), "refuse cleanup in a schema containing unrelated tables");
    for (const table of allowed) await connection.query("DROP TABLE IF EXISTS " + table);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations }); pool = await createRuntimePool(process.env);
    const audit = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(audit, { recursive: true, mode: 0o700 });
    root = await mkdtemp(path.join(audit, "video-broadcast-native-"));
    const videoKey = key(), messageKey = key(), totpKey = key(), storage = await createVideoStorage({ root, key: videoKey });
    const capacity = { ownerBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, rootFingerprint: await storage.fingerprint() };
    const authStore = createAuthStore(pool, { clock }), accessStore = createAccessStore(pool, { clock });
    const authService = await createAuthService({ store: authStore, totpKey, clock });
    const accessService = await createAccessService({ store: accessStore, authStore, authService, totpKey, mailKey: key(), origin, clock });
    let videoMessageStore;
    const chatStore = createChatStore(pool, { clock, decorateMessages: (...args) => videoMessageStore.decorateMessages(...args) });
    const videoStore = createVideoStore({ pool, chatStore, capacity });
    videoMessageStore = createVideoMessageStore({ pool, chatStore, videoStore });
    await videoMessageStore.assertSchema(); await videoStore.initialize({ now, offline: true });
    const chatService = await createChatService({ store: chatStore, videoMessages: videoMessageStore, authStore, authService, accessService, key: messageKey, clock });
    const videoService = await createVideoService({ store: videoStore, messages: videoMessageStore, storage, chatService, authStore, key: videoKey, minimumFreeBytes: 0, clock });
    const broadcastStore = createBroadcastStore(pool, { chatStore, key: messageKey, videoEnabled: true, videoStore, videoMessageStore, clock });
    await assert.rejects(broadcastStore.assertSchema(), error => error.code === "BROADCAST_DATABASE_STATE", "normal33 schema assertion stays strict on SQL36");
    await broadcastStore.assertSchema({ video: true });
    const service = await createBroadcastService({ store: broadcastStore, authStore, authService, key: messageKey, largeAudiencesEnabled: true, videoEnabled: true, clock });
    const worker = createBroadcastWorker({ store: broadcastStore, authStore, key: messageKey, videoEnabled: true, clock, batchSize: 5 });
    const handlers = [createChatHandler(chatService, { origin, videoEnabled: true }), createVideoHandler(videoService, { origin }), createBroadcastHandler(service, { origin, videoEnabled: true })];
    server = createServer(async (request, response) => {
      try { for (const handler of handlers) if (await handler(request, response)) return; response.writeHead(404); response.end(); }
      catch { if (response.headersSent) response.destroy(); else { response.writeHead(500); response.end(); } }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); const url = "http://127.0.0.1:" + server.address().port;
    async function request(route, { owner, body, binary } = {}) {
      const mutation = body !== undefined || binary !== undefined;
      const response = await fetch(url + route, { method: mutation ? "POST" : "GET", headers: {
        ...(owner ? { Cookie: owner.cookie, "X-CSRF-Token": owner.csrf } : {}),
        ...(mutation ? { Origin: origin, "Content-Type": binary ? "video/mp4" : "application/json", "X-Jessie-Request": "1" } : {}),
      }, ...(binary ? { body: binary } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const bytes = Buffer.from(await response.arrayBuffer());
      return { status: response.status, headers: response.headers, bytes, body: response.headers.get("content-type")?.includes("application/json") ? JSON.parse(bytes.toString("utf8")) : null };
    }
    async function user(role) {
      const owner = { id: id(), role, sessionId: id(), token: newToken() }; owner.tokenHash = tokenDigest(owner.token); owner.csrf = csrfToken(owner.token);
      owner.cookie = (role === "admin" ? "__Host-jessie_session=" : "__Host-jessie_client=") + owner.token;
      await connection.query("INSERT INTO users (id,role,status,pseudonym,email,password_hash,email_verified_at,age_assured_at,access_approved_at,created_at,updated_at) VALUES (?,?,'active',?,?,'synthetic-not-a-password',?,NULL,?,?,?)",
        [owner.id, role, "Synthetic broadcast " + role, hex(owner.id) + "@example.invalid", role === "client" ? created : null, role === "client" ? created : null, created, created]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id,secret_encrypted,version,last_totp_step,enabled_at) VALUES (?,'synthetic',1,1,?)", [owner.id, created]);
      else { await connection.query("INSERT INTO client_auth_state (user_id,credential_version,age_declared_at) VALUES (?,1,?)", [owner.id, created]); await consumeSyntheticInvitation(connection, owner.id, now - 1000); }
      await connection.query("INSERT INTO sessions (id,user_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)", [owner.sessionId, owner.id, owner.tokenHash, created, sql(now + 8 * 3600000)]);
      await connection.query(role === "admin" ? "INSERT INTO auth_session_state (session_id,last_seen_at,mfa_verified_at,mfa_version) VALUES (?,?,?,1)"
        : "INSERT INTO client_session_state (session_id,last_seen_at,credential_version) VALUES (?,?,1)", role === "admin" ? [owner.sessionId, created, created] : [owner.sessionId, created]);
      return owner;
    }
    const admin = await user("admin"), clients = [await user("client"), await user("client")];
    for (const client of clients) {
      client.conversationId = id(); client.cid = hex(client.conversationId);
      await connection.query("INSERT INTO conversations (id,admin_id,client_id,created_at) VALUES (?,?,?,?)", [client.conversationId, admin.id, client.id, created]);
    }
    const actor = { role: "admin", tokenHash: admin.tokenHash, now };
    async function upload(owner = admin) {
      const response = await request("/api/video/admin/assets", { owner, binary: await collectVideo(mp4Source(131109)) });
      assert.equal(response.status, 201); return response.body;
    }
    const route = "/api/broadcast/admin/", recipients = { mode: "selected", conversationIds: clients.map(client => client.cid).sort() };
    async function draft(asset, selected = recipients, allowRepeatMedia = false) {
      const preview = await request(route + "preview", { owner: admin, body: { audience: selected, mediaId: null, videoId: asset.id } });
      assert.equal(preview.status, 200);
      return { clientCampaignId: hex(id()), title: "Synthetic video broadcast", body: "Private video caption", mediaId: null, videoId: asset.id,
        allowRepeatMedia, audience: selected, previewToken: preview.body.previewToken };
    }
    const capability = await request(route + "session", { owner: admin }); assert.equal(capability.body.videoEnabled, true); assert.equal(capability.body.largeAudiencesEnabled, true);
    const source = await upload(), first = await draft(source);
    const confirmed = await request(route + "campaigns", { owner: admin, body: first }); assert.equal(confirmed.status, 201);
    assert.equal(confirmed.body.campaign.formatVersion, 3); assert.equal(confirmed.body.campaign.videoId, source.id);
    const duplicate = await request(route + "campaigns", { owner: admin, body: first }); assert.equal(duplicate.status, 200); assert.equal(duplicate.body.duplicate, true);
    assert.equal(duplicate.body.campaign.id, confirmed.body.campaign.id);
    const row = (await connection.query("SELECT payload_encrypted,media_id FROM broadcast_campaigns WHERE id=?", [Buffer.from(confirmed.body.campaign.id, "hex")]))[0];
    assert.equal(row.media_id, null); assert.match(row.payload_encrypted, /^v3\./); assert.equal(row.payload_encrypted.includes(source.id), false);
    assert.deepEqual(await worker.runOnce(), { delivered: 2, deferred: 0, failed: 0 });
    const delivered = [];
    for (const client of clients) {
      const history = await request("/api/chat/client/conversations/" + client.cid + "/messages", { owner: client }); assert.equal(history.status, 200);
      assert.equal(history.body.messages.length, 1); const message = history.body.messages[0]; delivered.push(message);
      assert.equal(message.body, first.body); assert.equal(message.video.id, source.id); assert.equal(message.media, undefined);
      assert.equal(message.sender, "peer"); assert.equal(JSON.stringify(message).includes("broadcast"), false);
      const content = await request(message.video.contentUrl, { owner: client }); assert.equal(content.status, 200); assert.equal(content.bytes.length, source.bytes);
    }
    assert.notEqual(delivered[0].id, delivered[1].id);
    const unrelated = await request(delivered[0].video.contentUrl, { owner: clients[1] }); assert.equal(unrelated.status, 404);
    assert.equal(Number((await connection.query("SELECT COUNT(*) AS n FROM message_media"))[0].n), 0);
    assert.equal(Number((await connection.query("SELECT COUNT(*) AS n FROM message_video WHERE video_id=?", [Buffer.from(source.id, "hex")]))[0].n), 2);
    await assert.rejects(videoStore.deleteAsset({ ...actor, assetId: Buffer.from(source.id, "hex") }), error => error.code === "VIDEO_IN_USE");
    const repeated = await draft(source), blocked = await request(route + "campaigns", { owner: admin, body: repeated }); assert.equal(blocked.status, 409); assert.equal(blocked.body.error, "repeat_confirmation_required");
    const repeatAllowed = await request(route + "campaigns", { owner: admin, body: { ...repeated, allowRepeatMedia: true } }); assert.equal(repeatAllowed.status, 201);
    assert.deepEqual(await worker.runOnce(), { delivered: 2, deferred: 0, failed: 0 });
    const beforeClaim = await upload(), pending = await draft(beforeClaim, { mode: "selected", conversationIds: [clients[0].cid] });
    const pendingCampaign = await request(route + "campaigns", { owner: admin, body: pending }); assert.equal(pendingCampaign.status, 201);
    const protectedQueued = await request(`/api/video/admin/assets/${beforeClaim.id}/delete`, { owner: admin, body: {} });
    assert.equal(protectedQueued.status, 409); assert.equal(protectedQueued.body.error, "video_in_use");
    assert.equal((await videoStore.getOwned({ ...actor, assetId: Buffer.from(beforeClaim.id, "hex") })).deletedAt, null);
    const cancelled = await request(route + "campaigns/" + pendingCampaign.body.campaign.id + "/cancel", { owner: admin, body: {} });
    assert.equal(cancelled.status, 200); assert.equal(cancelled.body.campaign.status, "cancelled");
    assert.equal((await request(`/api/video/admin/assets/${beforeClaim.id}/delete`, { owner: admin, body: {} })).status, 200);
    assert.deepEqual(await worker.runOnce(), { delivered: 0, deferred: 0, failed: 0 });
    const beforeDelivery = await upload(), waiting = await draft(beforeDelivery, { mode: "selected", conversationIds: [clients[0].cid] });
    const waitingCampaign = await request(route + "campaigns", { owner: admin, body: waiting }); assert.equal(waitingCampaign.status, 201);
    const claimed = await broadcastStore.claim({ now }); assert.ok(claimed.videoId.equals(Buffer.from(beforeDelivery.id, "hex")));
    await assert.rejects(videoStore.deleteAsset({ ...actor, assetId: claimed.videoId }), error => error.code === "VIDEO_IN_USE");
    const cancelledClaim = await request(route + "campaigns/" + waitingCampaign.body.campaign.id + "/cancel", { owner: admin, body: {} });
    assert.equal(cancelledClaim.status, 200); assert.equal(cancelledClaim.body.campaign.status, "cancelled");
    assert.equal((await request(`/api/video/admin/assets/${beforeDelivery.id}/delete`, { owner: admin, body: {} })).status, 200);
    const queue = [claimed], deliveryWorker = createBroadcastWorker({ store: { claim: async () => queue.shift() ?? null,
      deliver: (...args) => broadcastStore.deliver(...args), defer: (...args) => broadcastStore.defer(...args), fail: (...args) => broadcastStore.fail(...args) },
      authStore, key: messageKey, videoEnabled: true, clock });
    assert.deepEqual(await deliveryWorker.runOnce(), { delivered: 0, deferred: 0, failed: 0 }); await deliveryWorker.stop();
    const final = await request(route + "campaigns/" + waitingCampaign.body.campaign.id, { owner: admin });
    assert.equal(final.body.recipients[0].state, "cancelled"); assert.equal(final.body.recipients[0].reason, "cancelled");
    const failedSource = await upload(), failureDraft = await draft(failedSource, { mode: "selected", conversationIds: [clients[0].cid] });
    const failureCampaign = await request(route + "campaigns", { owner: admin, body: failureDraft }); assert.equal(failureCampaign.status, 201);
    const failing = await broadcastStore.claim({ now }); assert.ok(failing.videoId.equals(Buffer.from(failedSource.id, "hex")));
    // Start at the last permitted processing attempt; the real native fail
    // transition then settles the recipient and campaign without a message.
    await connection.query("UPDATE broadcast_recipients SET attempts = 7 WHERE campaign_id = ?", [failing.campaignId]);
    assert.equal(await broadcastStore.fail(failing, { now }), true);
    const failed = await request(route + "campaigns/" + failureCampaign.body.campaign.id, { owner: admin });
    assert.equal(failed.body.campaign.status, "completed"); assert.equal(failed.body.recipients[0].state, "failed");
    assert.equal((await request(`/api/video/admin/assets/${failedSource.id}/delete`, { owner: admin, body: {} })).status, 200);
    const stillShared = await request(delivered[1].video.contentUrl, { owner: clients[1] }); assert.equal(stillShared.status, 200);
    assert.equal((await loadMigrations()).length, 33); assert.equal((await connection.query("SELECT COUNT(*) AS n FROM schema_migrations"))[0].n.toString(), "36");
    await worker.stop();
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    try { await pool?.end(); } finally { try { await reset(); } finally { await connection.end(); if (root) await rm(root, { recursive: true, force: true }); } }
  }
});
