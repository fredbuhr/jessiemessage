import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createAuthService } from "../server/auth/service.mjs";
import { createAuthHandler } from "../server/auth/http.mjs";
import { createAccessStore } from "../server/access/store.mjs";
import { createAccessService } from "../server/access/service.mjs";
import { createAccessHandler } from "../server/access/http.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createChatService } from "../server/chat/service.mjs";
import { createChatHandler } from "../server/chat/http.mjs";
import { encryptMessageBody, messageFingerprint } from "../server/chat/crypto.mjs";
import { createBroadcastStore } from "../server/broadcast/store.mjs";
import { createBroadcastService } from "../server/broadcast/service.mjs";
import { createBroadcastHandler } from "../server/broadcast/http.mjs";
import { createBroadcastWorker } from "../server/broadcast/worker.mjs";
import { createAppServer } from "../server/index.mjs";
import { createRecoveryCodes, hashPassword, makeTotpSecret, recoveryCodeDigest, sealTotpSecret, totpCode } from "../server/auth/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const hex = (value) => value.toString("hex");
const newId = () => hex(randomBytes(16));

test("real HTTP targeted broadcasts retain individual consent and durable ordinary chat delivery (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 180000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "separately provisioned runtime DML credentials are required");
  const migrations = await loadMigrations();
  assert.equal(migrations.length, 25);
  const allowedTables = [...migrations.map((migration) => {
    const match = /^CREATE\s+TABLE\s+([a-z][a-z0-9_]*)\s*\(/i.exec(migration.sql.trim());
    assert.ok(match, "cleanup supports only explicit unqualified CREATE TABLE migrations");
    return match[1];
  }).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase();
  let pool;
  let server;
  let worker;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset();
    await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const authStore = createAuthStore(pool);
    const accessStore = createAccessStore(pool);
    const chatStore = createChatStore(pool);
    const broadcastStore = createBroadcastStore(pool, { chatStore, mediaEnabled: true });
    for (const store of [authStore, accessStore, chatStore, broadcastStore]) assert.equal(await store.assertSchema(), true);
    let now = Date.now();
    const clock = () => now;
    const totpKey = randomBytes(32);
    const messageKey = randomBytes(32);
    const origin = "https://example.invalid";
    const adminPassword = "Synthetic broadcast administrator password 2026!";
    const clientPassword = "Synthetic broadcast client password 2026!";
    const admin = { id: randomBytes(16), email: "broadcast-flow-admin@example.invalid", secret: makeTotpSecret() };
    const adminHash = await hashPassword(adminPassword);
    await authStore.initializeAdmin({ id: admin.id, email: admin.email, pseudonym: "Synthetic broadcast administrator",
      passwordHash: adminHash, secretEncrypted: sealTotpSecret(admin.secret, totpKey, admin.id),
      recoveryDigests: createRecoveryCodes().map(recoveryCodeDigest), now });
    // A second owner is an isolated ownership fixture, never another bootstrap or a real account.
    const otherAdminId = randomBytes(16);
    await connection.query("INSERT INTO users (id, role, status, pseudonym, email, password_hash, created_at, updated_at) VALUES (?, 'admin', 'active', ?, ?, ?, ?, ?)",
      [otherAdminId, "Synthetic other broadcast owner", "broadcast-flow-other-admin@example.invalid", adminHash, sqlDate(now), sqlDate(now)]);
    const clients = Object.fromEntries(["a", "b", "pending", "expired", "revokeLater", "expireLater", "foreign"].map((kind) => [kind, {
      id: randomBytes(16), conversationId: randomBytes(16), kind, email: `broadcast-flow-${kind.toLowerCase()}@example.invalid`,
      pseudonym: `Synthetic broadcast ${kind}`,
    }]));
    const clientHash = await hashPassword(clientPassword);
    // Independent synthetic email/majority/approval stamps exercise current gates.
    // No invitation, real client, email, age-proof endpoint, or production message is involved.
    for (const client of Object.values(clients)) {
      const active = client.kind !== "pending";
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash,
        email_verified_at, age_assured_at, access_approved_at, access_expires_at, created_at, updated_at)
        VALUES (?, 'client', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [client.id, active ? "active" : "pending", client.pseudonym,
        client.email, clientHash, sqlDate(now - 60000), active ? sqlDate(now - 60000) : null,
        active ? sqlDate(now - 60000) : null, client.kind === "expired" ? sqlDate(now - 1) : null, sqlDate(now - 60000), sqlDate(now - 60000)]);
      await connection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [client.id, sqlDate(now - 60000)]);
      await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)",
        [client.conversationId, client.id, client.kind === "foreign" ? otherAdminId : admin.id, sqlDate(now - 60000)]);
    }
    const authService = await createAuthService({ store: authStore, totpKey, clock });
    const accessService = await createAccessService({ store: accessStore, authStore, authService, totpKey, mailKey: randomBytes(32), origin, clock });
    const chatService = await createChatService({ store: chatStore, authStore, authService, accessService, key: messageKey, clock });
    const broadcastService = await createBroadcastService({ store: broadcastStore, authService, authStore, key: messageKey, mediaEnabled: true, clock });
    worker = createBroadcastWorker({ store: broadcastStore, authStore, key: messageKey, clock, batchSize: 5 });
    server = createAppServer({ authHandler: createAuthHandler(authService, { origin }), accessHandler: createAccessHandler(accessService, { origin }),
      chatHandler: createChatHandler(chatService, { origin }), broadcastHandler: createBroadcastHandler(broadcastService, { origin, mediaEnabled: true }) });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, { method = "GET", body, headers = {} } = {}) {
      const response = await fetch(`${base}${path}`, { method, redirect: "manual", headers: {
        ...(method === "POST" ? { Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1" } : {}), ...headers,
      }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const text = await response.text();
      let value;
      try { value = JSON.parse(text); } catch { value = text; }
      return { status: response.status, headers: response.headers, body: value };
    }
    const headersFor = (session) => ({ Cookie: session.cookie, "X-CSRF-Token": session.csrf });
    const adminPath = (suffix) => `/api/broadcast/admin/${suffix}`;
    const preferencePath = "/api/broadcast/client/preference";
    const messagesPath = (client, role = "client") => `/api/chat/${role}/conversations/${hex(client.conversationId)}/messages`;
    const campaignInput = (targets, overrides = {}) => ({ clientCampaignId: newId(), title: "Private synthetic campaign title",
      body: "Individual synthetic broadcast body — exact 💬 text.", mediaId: null, allowRepeatMedia: false,
      conversationIds: targets.map((client) => hex(client.conversationId)), ...overrides });
    const countMessages = async (client) => Number((await connection.query("SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?", [client.conversationId]))[0].count);
    let adminSession;
    const sessions = {};
    async function loginAdmin() {
      const result = await request("/api/auth/login", { method: "POST", body: { email: admin.email, password: adminPassword, factor: totpCode(admin.secret, { now }) } });
      assert.equal(result.status, 200);
      adminSession = { cookie: result.headers.get("set-cookie").split(";")[0], csrf: result.body.csrf };
    }
    async function create(input) {
      const result = await request(adminPath("campaigns"), { method: "POST", headers: headersFor(adminSession), body: input });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      assert.equal(result.body.duplicate, false);
      return result.body.campaign;
    }
    async function detail(campaign) {
      const result = await request(adminPath(`campaigns/${campaign.id}`), { headers: headersFor(adminSession) });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body;
    }
    async function preference(client, enabledValue, expectedVersion) {
      return request(preferencePath, { method: "POST", headers: headersFor(sessions[client.kind]), body: { enabled: enabledValue, expectedVersion } });
    }
    let firstCampaign;
    let firstInput;

    await t.test("real MFA and client logins preserve separate roles and opt-out defaults", async () => {
      await loginAdmin();
      for (const client of Object.values(clients).filter((value) => value.kind !== "foreign")) {
        const result = await request("/api/access/login", { method: "POST", body: { email: client.email, password: clientPassword } });
        assert.equal(result.status, 200);
        assert.equal(result.body.access.state, ["pending", "expired"].includes(client.kind) ? client.kind : "active");
        sessions[client.kind] = { cookie: result.headers.get("set-cookie").split(";")[0], csrf: result.body.csrf };
        const initial = await request(preferencePath, { headers: headersFor(sessions[client.kind]) });
        assert.equal(initial.status, 200);
        assert.deepEqual(initial.body, { enabled: false, version: "0", updatedAt: null });
      }
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM broadcast_preferences"))[0].count), 0, "preference reads must not create consent");
      assert.equal((await request(adminPath("session"), { headers: headersFor(adminSession) })).body.mediaEnabled, true);
      for (const headers of [{}, headersFor(sessions.a), { Cookie: `__Host-jessie_session=${sessions.a.cookie.split("=")[1]}` }]) {
        assert.equal((await request(adminPath("session"), { headers })).status, 401);
        assert.equal((await request(adminPath("campaigns"), { headers })).status, 401);
      }
      assert.equal((await request(preferencePath, { headers: headersFor(adminSession) })).status, 401);
    });

    await t.test("protected administrator sources and all mutations require the current role, origin and CSRF", async () => {
      for (const path of ["/broadcast.js", "/broadcast-model.js", "/broadcast.css"]) {
        assert.equal((await request(path)).status, 401, path);
        assert.equal((await request(path, { headers: headersFor(sessions.a) })).status, 401, path);
        assert.equal((await request(path, { headers: headersFor(adminSession) })).status, 200, path);
      }
      assert.equal((await request("/admin/broadcasts", { headers: headersFor(adminSession) })).status, 200);
      const previewBody = { conversationIds: [hex(clients.a.conversationId)], mediaId: null };
      assert.equal((await request(adminPath("preview"), { method: "POST", headers: { Cookie: adminSession.cookie }, body: previewBody })).status, 403);
      assert.equal((await request(adminPath("preview"), { method: "POST", headers: { ...headersFor(adminSession), Origin: "https://foreign.invalid" }, body: previewBody })).status, 403);
      assert.equal((await request(preferencePath, { method: "POST", headers: { Cookie: sessions.a.cookie }, body: { enabled: true, expectedVersion: "0" } })).status, 403);
      assert.equal((await request(preferencePath, { method: "POST", headers: headersFor(sessions.a), body: { enabled: true, expectedVersion: "0", clientId: hex(clients.b.id) } })).status, 400);
      const optedOut = await request(adminPath("preview"), { method: "POST", headers: headersFor(adminSession), body: previewBody });
      assert.equal(optedOut.status, 200);
      assert.equal(optedOut.body.eligibleCount, 0);
      assert.equal(optedOut.body.recipients[0].reason, "opted_out");
      assert.equal((await request(adminPath("campaigns"), { method: "POST", headers: headersFor(adminSession), body: campaignInput([clients.a]) })).status, 409);
    });

    await t.test("only the client can opt in, including limited accounts, with optimistic consent versions", async () => {
      for (const client of Object.values(clients).filter((value) => value.kind !== "foreign")) {
        const result = await preference(client, true, "0");
        assert.equal(result.status, 200, client.kind);
        assert.equal(result.body.enabled, true);
        assert.equal(result.body.version, "1");
        assert.equal(result.body.updatedAt, now);
      }
      assert.equal((await preference(clients.a, false, "0")).status, 409);
      assert.equal((await request(preferencePath, { headers: headersFor(sessions.a) })).body.enabled, true);
      for (const client of [clients.pending, clients.expired]) {
        assert.equal((await request("/api/chat/client/conversation", { headers: headersFor(sessions[client.kind]) })).status, 403);
      }
      const preview = await request(adminPath("preview"), { method: "POST", headers: headersFor(adminSession), body: {
        conversationIds: [clients.a, clients.pending, clients.expired].map((client) => hex(client.conversationId)), mediaId: null,
      } });
      assert.equal(preview.status, 200);
      assert.equal(preview.body.eligibleCount, 1);
      for (const client of [clients.pending, clients.expired]) assert.equal(preview.body.recipients.find((recipient) => recipient.conversationId === hex(client.conversationId)).reason, "access_inactive");
      for (const conversationIds of [[hex(clients.foreign.conversationId)], [newId()]]) {
        assert.equal((await request(adminPath("preview"), { method: "POST", headers: headersFor(adminSession), body: { conversationIds, mediaId: null } })).status, 404);
      }
    });

    await t.test("explicit confirmation queues an immutable encrypted audience and an identical retry returns the same campaign", async () => {
      firstInput = campaignInput([clients.a, clients.b]);
      firstCampaign = await create(firstInput);
      assert.equal(firstCampaign.status, "queued");
      assert.deepEqual(firstCampaign.counts, { total: 2, pending: 2, sending: 0, delivered: 0, skipped: 0, cancelled: 0, failed: 0 });
      assert.equal(firstCampaign.body, firstInput.body);
      assert.equal(firstCampaign.title, firstInput.title);
      assert.equal(await countMessages(clients.a), 0, "confirmation queues work without inserting a chat message early");
      const retry = await request(adminPath("campaigns"), { method: "POST", headers: headersFor(adminSession), body: { ...firstInput, conversationIds: [...firstInput.conversationIds].reverse() } });
      assert.equal(retry.status, 200);
      assert.equal(retry.body.duplicate, true);
      assert.equal(retry.body.campaign.id, firstCampaign.id);
      const conflicting = await request(adminPath("campaigns"), { method: "POST", headers: headersFor(adminSession), body: { ...firstInput, body: "Changed payload under the same caller id must conflict." } });
      assert.equal(conflicting.status, 409);
      const rows = await connection.query("SELECT payload_encrypted FROM broadcast_campaigns");
      assert.equal(rows.length, 1);
      assert.match(rows[0].payload_encrypted, /^v1\./);
      for (const marker of [firstInput.body, firstInput.title, ...firstInput.conversationIds]) assert.equal(rows[0].payload_encrypted.includes(marker), false);
      const listed = await request(adminPath("campaigns?limit=1"), { headers: headersFor(adminSession) });
      assert.equal(listed.status, 200);
      assert.equal(listed.body.campaigns.length, 1);
      assert.equal(listed.body.campaigns[0].id, firstCampaign.id);
      const inspected = await detail(firstCampaign);
      assert.deepEqual(inspected.recipients.map((recipient) => recipient.conversationId).sort(), firstInput.conversationIds.slice().sort());
    });

    await t.test("the worker creates separate ordinary chat messages without exposing the audience or campaign metadata", async () => {
      await worker.runOnce();
      await worker.runOnce();
      const delivered = await detail(firstCampaign);
      assert.equal(delivered.status, "completed");
      assert.equal(delivered.counts.delivered, 2);
      const ids = [];
      for (const client of [clients.a, clients.b]) {
        const received = await request(messagesPath(client), { headers: headersFor(sessions[client.kind]) });
        assert.equal(received.status, 200);
        assert.equal(received.body.messages.length, 1);
        const message = received.body.messages[0];
        ids.push(message.id);
        assert.equal(message.body, firstInput.body);
        assert.equal(message.sender, "peer");
        assert.equal(message.clientMessageId, null);
        assert.deepEqual(Object.keys(message).sort(), ["id", "sequence", "sender", "body", "createdAt", "deletedAt", "clientMessageId"].sort());
        const serialized = JSON.stringify(received.body);
        for (const secret of [firstCampaign.id, firstInput.clientCampaignId, firstInput.title, hex(clients[client.kind === "a" ? "b" : "a"].id)]) assert.equal(serialized.includes(secret), false);
        assert.match(received.headers.get("cache-control"), /no-store/);
      }
      assert.notEqual(ids[0], ids[1]);
      assert.equal(await countMessages(clients.a), 1);
      assert.equal(await countMessages(clients.b), 1);
      const retry = await request(adminPath("campaigns"), { method: "POST", headers: headersFor(adminSession), body: firstInput });
      assert.equal(retry.status, 200);
      await worker.runOnce();
      assert.equal(await countMessages(clients.a), 1);
      assert.equal(await countMessages(clients.b), 1);
    });

    await t.test("opt-out and revocation after confirmation prevent remaining deliveries while direct chat still works", async () => {
      const campaign = await create(campaignInput([clients.a, clients.revokeLater]));
      assert.equal((await preference(clients.a, false, "1")).status, 200);
      const revoked = await request(`/api/admin/clients/${hex(clients.revokeLater.id)}/revoke`, { method: "POST", headers: headersFor(adminSession), body: {} });
      assert.equal(revoked.status, 200);
      await worker.runOnce();
      const stopped = await detail(campaign);
      assert.equal(stopped.counts.delivered, 0);
      assert.equal(stopped.counts.skipped, 2);
      assert.equal(stopped.recipients.find((recipient) => recipient.conversationId === hex(clients.a.conversationId)).reason, "opted_out");
      assert.equal(stopped.recipients.find((recipient) => recipient.conversationId === hex(clients.revokeLater.conversationId)).state, "skipped");
      assert.equal(await countMessages(clients.a), 1);
      assert.equal(await countMessages(clients.revokeLater), 0);
      assert.equal((await request(preferencePath, { headers: headersFor(sessions.revokeLater) })).status, 401);
      const direct = await request(messagesPath(clients.a, "admin"), { method: "POST", headers: headersFor(adminSession), body: { clientMessageId: newId(), body: "A direct individual reply remains available after broadcast opt-out." } });
      assert.equal(direct.status, 201);
      assert.equal(await countMessages(clients.a), 2);
    });

    await t.test("access expiry is rechecked after confirmation before any chat insertion", async () => {
      const campaign = await create(campaignInput([clients.expireLater]));
      await connection.query("UPDATE users SET access_expires_at = ? WHERE id = ?", [sqlDate(now + 1000), clients.expireLater.id]);
      now += 1001;
      await worker.runOnce();
      const stopped = await detail(campaign);
      assert.equal(stopped.counts.skipped, 1);
      assert.equal(stopped.counts.delivered, 0);
      assert.equal(await countMessages(clients.expireLater), 0);
      assert.equal((await request(preferencePath, { headers: headersFor(sessions.expireLater) })).status, 200, "expired access still permits managing consent");
    });

    await t.test("cancellation wins over an already leased recipient and never inserts a delayed message", async () => {
      const campaign = await create(campaignInput([clients.b], { body: "Cancelled queued content must never be sent." }));
      const leased = await broadcastStore.claim({ now, leaseMilliseconds: 1000 });
      assert.ok(leased);
      assert.equal(hex(leased.campaignId), campaign.id);
      const before = await countMessages(clients.b);
      const cancelled = await request(adminPath(`campaigns/${campaign.id}/cancel`), { method: "POST", headers: headersFor(adminSession), body: {} });
      assert.equal(cancelled.status, 200);
      assert.equal(cancelled.body.status, "cancelled");
      assert.equal(cancelled.body.counts.cancelled, 1);
      const body = "A delayed worker still holds the cancelled job.";
      const binding = { messageId: leased.messageId, conversationId: leased.conversationId, senderId: leased.adminId };
      const message = { id: leased.messageId, clientMessageId: leased.clientMessageId,
        bodyEncrypted: encryptMessageBody(body, messageKey, binding), bodyFingerprint: messageFingerprint(body, messageKey, binding) };
      assert.deepEqual(await broadcastStore.deliver(leased, { now, message }), { delivered: false }, "a cancelled lease must stop before attempting a message append");
      now += 1001;
      await worker.runOnce();
      assert.equal(await countMessages(clients.b), before);
      const again = await request(adminPath(`campaigns/${campaign.id}/cancel`), { method: "POST", headers: headersFor(adminSession), body: {} });
      assert.equal(again.status, 200);
      assert.equal(again.body.counts.cancelled, 1);
    });

    await t.test("an expired lease reuses its original message identifiers and delivers exactly once after a restart", async () => {
      const input = campaignInput([clients.b], { body: "Durable synthetic resumed broadcast." });
      const campaign = await create(input);
      const abandoned = await broadcastStore.claim({ now, leaseMilliseconds: 1000 });
      assert.ok(abandoned);
      assert.equal(hex(abandoned.campaignId), campaign.id);
      now += 1001;
      const reclaimed = await broadcastStore.claim({ now, leaseMilliseconds: 1000 });
      assert.ok(reclaimed);
      assert.ok(reclaimed.messageId.equals(abandoned.messageId));
      assert.ok(reclaimed.clientMessageId.equals(abandoned.clientMessageId));
      assert.equal(reclaimed.leaseToken.equals(abandoned.leaseToken), false);
      assert.equal(await broadcastStore.defer(abandoned, { now, availableAt: now }), false, "an old lease cannot change the replacement worker's job");
      now += 1001;
      const before = await countMessages(clients.b);
      await worker.stop();
      worker = createBroadcastWorker({ store: broadcastStore, authStore, key: messageKey, clock, batchSize: 5 });
      await worker.runOnce();
      await worker.runOnce();
      const resumed = await detail(campaign);
      assert.equal(resumed.counts.delivered, 1);
      assert.equal(resumed.recipients[0].messageId, hex(abandoned.messageId));
      assert.equal(await countMessages(clients.b), before + 1);
      const received = await request(messagesPath(clients.b), { headers: headersFor(sessions.b) });
      assert.equal(received.body.messages.filter((message) => message.id === hex(abandoned.messageId)).length, 1);
      assert.equal(received.body.messages.find((message) => message.id === hex(abandoned.messageId)).body, input.body);
    });

    await t.test("an owned photo is shared as ordinary media and historical sharing requires an explicit repeat override", async () => {
      // Metadata-only synthetic asset fixture: existing media-flow tests cover normalization,
      // encrypted disk bytes and authorized binary delivery. This test covers queue/message binding.
      const assetId = randomBytes(16), digest = randomBytes(32);
      await connection.query(`INSERT INTO media_assets (id, owner_id, owner_role, storage_key, content_digest, active_digest,
        width, height, thumbnail_width, thumbnail_height, full_bytes, thumbnail_bytes, created_at)
        VALUES (?, ?, 'admin', ?, ?, ?, 160, 120, 160, 120, 1024, 512, ?)`,
      [assetId, admin.id, randomBytes(32), digest, digest, sqlDate(now)]);
      const input = campaignInput([clients.b], { mediaId: hex(assetId), body: "Synthetic individual photo caption." });
      const campaign = await create(input);
      await worker.runOnce();
      const delivered = await detail(campaign);
      assert.equal(delivered.counts.delivered, 1);
      const photoMessageId = delivered.recipients[0].messageId;
      const received = await request(messagesPath(clients.b), { headers: headersFor(sessions.b) });
      assert.equal(received.status, 200);
      const message = received.body.messages.find((value) => value.id === photoMessageId);
      assert.equal(message.body, input.body);
      assert.equal(message.media.id, hex(assetId));
      assert.equal(JSON.stringify(message).includes(campaign.id), false);
      const deletion = await request(`${messagesPath(clients.b, "admin")}/${photoMessageId}/delete`, { method: "POST", headers: headersFor(adminSession), body: {} });
      assert.equal(deletion.status, 200);
      const preview = await request(adminPath("preview"), { method: "POST", headers: headersFor(adminSession), body: { conversationIds: input.conversationIds, mediaId: input.mediaId } });
      assert.equal(preview.status, 200);
      assert.equal(preview.body.repeatCount, 1, "a tombstone preserves the historical sharing warning");
      assert.equal(preview.body.recipients[0].repeatMedia, true);
      assert.equal((await request(adminPath("campaigns"), { method: "POST", headers: headersFor(adminSession), body: { ...input, clientCampaignId: newId() } })).status, 409);
      const repeat = await create({ ...input, clientCampaignId: newId(), allowRepeatMedia: true });
      await worker.runOnce();
      assert.equal((await detail(repeat)).counts.delivered, 1);
      const reread = await request(messagesPath(clients.b), { headers: headersFor(sessions.b) });
      assert.equal(reread.body.messages.find((value) => value.id === photoMessageId).body, null, "a new confirmed share must not resurrect the old message");
    });

    await t.test("logout removes browser access while a previously confirmed durable campaign can finish", async () => {
      const input = campaignInput([clients.b], { body: "Confirmed before logout, delivered by durable approval." });
      const campaign = await create(input);
      const signedOut = await request("/api/auth/logout", { method: "POST", headers: headersFor(adminSession), body: {} });
      assert.equal(signedOut.status, 200);
      assert.equal((await request(adminPath("campaigns"), { headers: headersFor(adminSession) })).status, 401);
      await worker.runOnce();
      const received = await request(messagesPath(clients.b), { headers: headersFor(sessions.b) });
      assert.equal(received.status, 200);
      assert.equal(received.body.messages.filter((message) => message.body === input.body).length, 1);
      now += 30000;
      await loginAdmin();
      assert.equal((await detail(campaign)).counts.delivered, 1);
    });

    await t.test("a changed administrator MFA approval pauses queued delivery and invalidates the old browser session", async () => {
      const campaign = await create(campaignInput([clients.b], { body: "MFA-invalidated approval must never deliver." }));
      const before = await countMessages(clients.b);
      await connection.query("UPDATE admin_mfa SET version = version + 1 WHERE user_id = ?", [admin.id]);
      await worker.runOnce();
      assert.equal(await countMessages(clients.b), before);
      assert.equal((await request(adminPath("campaigns"), { headers: headersFor(adminSession) })).status, 401);
      now += 30000;
      await loginAdmin();
      const paused = await detail(campaign);
      assert.equal(paused.status, "paused");
      assert.equal(paused.counts.delivered, 0);
      assert.equal(paused.recipients[0].reason, "administrator_invalid");
      await worker.runOnce();
      assert.equal(await countMessages(clients.b), before);
    });
  } finally {
    if (worker) await worker.stop();
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    try { if (pool) await pool.end(); }
    finally { try { await reset(); } finally { await connection.end(); } }
  }
});
