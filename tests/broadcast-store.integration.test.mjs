import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createChatStore, ChatStoreError } from "../server/chat/store.mjs";
import { createBroadcastStore, assertBroadcastSchema } from "../server/broadcast/store.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1", id = () => randomBytes(16), digest = () => randomBytes(32);
const now = Date.UTC(2026, 9, 15, 12), sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const code = (expected) => (error) => error instanceof ChatStoreError && error.code === expected && error.cause === undefined;

test("real MariaDB consent, immutable targeted campaigns and atomic private delivery (synthetic disposable schema only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 180000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "separate runtime DML credentials are required");
  const migrations = await loadMigrations(); assert.equal(migrations.length, 27);
  const ownedTables = migrations.map((migration) => {
    const match = /^CREATE\s+TABLE\s+([a-z][a-z0-9_]*)\s*\(/i.exec(migration.sql.trim());
    assert.ok(match, "cleanup only accepts reviewed single-table migrations"); return match[1];
  }).reverse();
  const allowedTables = [...ownedTables, "migration_probe", "schema_migrations"], connection = await connectDatabase();
  let pool, fixtureNumber = 0;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((row) => allowedTables.includes(row.name)), "refuse cleanup with unrelated tables present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const chat = createChatStore(pool), store = createBroadcastStore(pool, { chatStore: chat, mediaEnabled: true });
    async function user(role) {
      const value = { id: id(), sessionId: id(), tokenHash: digest(), role, pseudonym: `Synthetic ${role} ${fixtureNumber++}` };
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at, age_assured_at,
        access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?, ?)`,
      [value.id, role, value.pseudonym, `broadcast-${fixtureNumber}@example.invalid`, role === "client" ? sqlDate(now) : null,
        role === "client" ? sqlDate(now) : null, role === "client" ? sqlDate(now) : null, sqlDate(now), sqlDate(now)]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic-secret', 1, 1, ?)", [value.id, sqlDate(now)]);
      else await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [value.id, sqlDate(now)]);
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [value.sessionId, value.id, value.tokenHash, sqlDate(now), sqlDate(now + 8 * 3600000)]);
      if (role === "admin") await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [value.sessionId, sqlDate(now), sqlDate(now)]);
      else await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", [value.sessionId, sqlDate(now)]);
      return value;
    }
    async function pair(admin = null) {
      const fixture = { admin: admin ?? await user("admin"), client: await user("client"), conversationId: id() };
      await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [fixture.conversationId, fixture.client.id, fixture.admin.id, sqlDate(now)]);
      return fixture;
    }
    const actor = (fixture, extra = {}) => ({ tokenHash: fixture.admin.tokenHash, now, ...extra });
    const consent = (fixture, extra = {}) => store.savePreference({ tokenHash: fixture.client.tokenHash, now, enabled: true, expectedVersion: "0", ...extra });
    const campaign = (fixtures, extra = {}) => ({ id: id(), clientCampaignId: id(), payloadEncrypted: "v1.synthetic-encrypted-campaign", requestFingerprint: digest(),
      mediaId: null, allowRepeatMedia: false, recipients: fixtures.map((fixture) => ({ conversationId: fixture.conversationId, messageId: id(), clientMessageId: id() })), ...extra });
    const create = (fixture, value = campaign([fixture]), extra = {}) => store.create({ ...actor(fixture), campaign: value, ...extra });
    const get = (fixture, campaignId) => store.get({ ...actor(fixture), campaignId });
    const message = (job, extra = {}) => ({ id: job.messageId, clientMessageId: job.clientMessageId, bodyEncrypted: "v1.synthetic-encrypted-message", bodyFingerprint: digest(), ...(job.mediaId ? { mediaId: job.mediaId } : {}), ...extra });
    async function asset(owner) {
      const value = id(), hash = digest();
      await connection.query(`INSERT INTO media_assets (id, owner_id, owner_role, storage_key, content_digest, active_digest, width, height,
        thumbnail_width, thumbnail_height, full_bytes, thumbnail_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, 1000, 800, 400, 320, 12345, 1234, ?)`,
      [value, owner.id, owner.role, digest(), hash, hash, sqlDate(now)]); return value;
    }
    const assertMessages = async (conversationId, expected) => assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM messages WHERE conversation_id = ?", [conversationId]))[0].value), expected);
    const subtest = (name, fn) => t.test(name, async () => {
      await connection.query("UPDATE broadcast_recipients SET state = 'cancelled', reason = 'cancelled', lease_token = NULL, lease_until = NULL WHERE state IN ('pending', 'sending')");
      await connection.query("UPDATE broadcast_campaigns SET status = 'cancelled' WHERE status IN ('queued', 'running')");
      await fn();
    });

    await subtest("read-only schema verification rejects dirty ledgers, unsigned, index, CHECK and FK drift", async () => {
      assert.equal(await assertBroadcastSchema(pool), true);
      await connection.query("UPDATE schema_migrations SET state = 'failed', finished_at = NULL WHERE version = 27");
      try { await assert.rejects(store.assertSchema(), code("BROADCAST_DATABASE_STATE")); }
      finally { await connection.query("UPDATE schema_migrations SET state = 'applied', finished_at = CURRENT_TIMESTAMP(6) WHERE version = 27"); }
      await connection.query("ALTER TABLE broadcast_campaigns MODIFY mfa_version INT NOT NULL");
      try { await assert.rejects(store.assertSchema(), code("BROADCAST_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE broadcast_campaigns MODIFY mfa_version INT UNSIGNED NOT NULL"); }
      await connection.query("ALTER TABLE broadcast_campaigns DROP INDEX broadcast_campaigns_idempotency");
      try { await assert.rejects(store.assertSchema(), code("BROADCAST_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE broadcast_campaigns ADD UNIQUE KEY broadcast_campaigns_idempotency (admin_id, client_campaign_id)"); }
      await connection.query("ALTER TABLE broadcast_preferences DROP CONSTRAINT broadcast_preferences_enabled");
      await connection.query("ALTER TABLE broadcast_preferences ADD CONSTRAINT broadcast_preferences_enabled CHECK (1)");
      try { await assert.rejects(store.assertSchema(), code("BROADCAST_DATABASE_STATE")); }
      finally {
        await connection.query("ALTER TABLE broadcast_preferences DROP CONSTRAINT broadcast_preferences_enabled");
        await connection.query("ALTER TABLE broadcast_preferences ADD CONSTRAINT broadcast_preferences_enabled CHECK (enabled IN (0, 1))");
      }
      await connection.query("ALTER TABLE broadcast_recipients DROP FOREIGN KEY broadcast_recipients_delivered_fk");
      try { await assert.rejects(store.assertSchema(), code("BROADCAST_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE broadcast_recipients ADD CONSTRAINT broadcast_recipients_delivered_fk FOREIGN KEY (conversation_id, delivered_message_id) REFERENCES messages (conversation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT"); }
      assert.equal(await store.assertSchema(), true);
    });

    await subtest("preferences default off without insertion and only the current verified client can change them", async () => {
      const fixture = await pair();
      assert.deepEqual(await store.getPreference({ tokenHash: fixture.client.tokenHash, now }), { enabled: false, version: "0", updatedAt: null });
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM broadcast_preferences WHERE user_id = ?", [fixture.client.id]))[0].value), 0);
      assert.ok((await store.preferenceActor({ tokenHash: fixture.client.tokenHash, now })).id.equals(fixture.client.id));
      await assert.rejects(store.savePreference({ tokenHash: fixture.admin.tokenHash, now, enabled: true, expectedVersion: "0" }), code("CHAT_UNAUTHORIZED"));
      await connection.query("UPDATE users SET status = 'pending', age_assured_at = NULL, access_approved_at = ?, access_expires_at = ? WHERE id = ?", [sqlDate(now - 1000), sqlDate(now), fixture.client.id]);
      assert.deepEqual(await consent(fixture), { enabled: true, version: "1", updatedAt: now });
      await connection.query("UPDATE client_auth_state SET credential_version = 2 WHERE user_id = ?", [fixture.client.id]);
      await assert.rejects(store.getPreference({ tokenHash: fixture.client.tokenHash, now }), code("CHAT_UNAUTHORIZED"));
      await connection.query("UPDATE client_auth_state SET credential_version = 1 WHERE user_id = ?", [fixture.client.id]);
      await connection.query("UPDATE users SET email_verified_at = NULL WHERE id = ?", [fixture.client.id]);
      await assert.rejects(consent(fixture, { expectedVersion: "1" }), code("CHAT_UNAUTHORIZED"));
    });

    await subtest("concurrent preference saves and uint64 versions never overwrite a stale choice", async () => {
      const fixture = await pair();
      const attempts = await Promise.allSettled([consent(fixture), consent(fixture, { enabled: false })]);
      assert.equal(attempts.filter((row) => row.status === "fulfilled").length, 1);
      assert.equal(attempts.find((row) => row.status === "rejected").reason.code, "BROADCAST_CONFLICT");
      await connection.query("UPDATE broadcast_preferences SET version = 18446744073709551614 WHERE user_id = ?", [fixture.client.id]);
      assert.equal((await consent(fixture, { expectedVersion: "18446744073709551614" })).version, "18446744073709551615");
      await assert.rejects(consent(fixture, { expectedVersion: "18446744073709551615" }), code("BROADCAST_LIMIT"));
      await assert.rejects(consent(fixture, { expectedVersion: "01" }), code("BROADCAST_INPUT"));
    });

    await subtest("preview requires ownership and reports inactive, closed and opted-out recipients without creating jobs", async () => {
      const one = await pair(), two = await pair(one.admin), three = await pair(one.admin), foreign = await pair();
      await consent(one); await consent(two); await connection.query("UPDATE users SET status = 'pending', age_assured_at = NULL WHERE id = ?", [two.client.id]);
      let preview = await store.preview({ ...actor(one), conversationIds: [one.conversationId, two.conversationId, three.conversationId], mediaId: null });
      assert.equal(preview.eligibleCount, 1); assert.equal(preview.repeatCount, 0);
      assert.equal(preview.recipients.find((row) => row.conversationId.equals(two.conversationId)).reason, "access_inactive");
      assert.equal(preview.recipients.find((row) => row.conversationId.equals(three.conversationId)).reason, "opted_out");
      await connection.query("UPDATE conversations SET closed_at = ? WHERE id = ?", [sqlDate(now), one.conversationId]);
      preview = await store.preview({ ...actor(one), conversationIds: [one.conversationId] }); assert.equal(preview.recipients[0].reason, "conversation_unavailable");
      await assert.rejects(store.preview({ ...actor(one), conversationIds: [foreign.conversationId] }), code("BROADCAST_NOT_FOUND"));
      await assert.rejects(store.preview({ tokenHash: one.client.tokenHash, now, conversationIds: [one.conversationId] }), code("CHAT_FORBIDDEN"));
      await assertMessages(one.conversationId, 0);
    });

    await subtest("confirmation is all-or-nothing and retries reuse the original immutable target snapshot", async () => {
      const one = await pair(), two = await pair(one.admin), value = campaign([one, two]);
      await consent(one);
      await assert.rejects(create(one, value), code("BROADCAST_RECIPIENTS"));
      assert.equal((await store.list(actor(one))).campaigns.length, 0);
      await consent(two);
      const created = await create(one, value); assert.equal(created.duplicate, false); assert.equal(created.campaign.counts.total, 2);
      await consent(two, { enabled: false, expectedVersion: "1" });
      const retried = await create(one, { ...value, id: id(), recipients: value.recipients.map((row) => ({ ...row, messageId: id(), clientMessageId: id() })) });
      assert.equal(retried.duplicate, true); assert.ok(retried.campaign.id.equals(value.id));
      await assert.rejects(create(one, { ...value, requestFingerprint: digest() }), code("BROADCAST_CONFLICT"));
      const stored = await connection.query("SELECT proposed_message_id, client_message_id FROM broadcast_recipients WHERE campaign_id = ?", [value.id]);
      assert.ok(stored.every((row) => value.recipients.some((target) => target.messageId.equals(row.proposed_message_id) && target.clientMessageId.equals(row.client_message_id))));
      const foreign = await pair(); await assert.rejects(get(foreign, value.id), code("BROADCAST_NOT_FOUND"));
    });

    await subtest("at most ten live campaigns per owner and safe duplicate retries remain possible at that cap", async () => {
      const fixture = await pair(); await consent(fixture); const first = campaign([fixture]); await create(fixture, first);
      for (let index = 1; index < 10; index++) await create(fixture);
      await assert.rejects(create(fixture), code("BROADCAST_LIMIT")); assert.equal((await create(fixture, first)).duplicate, true);
      const page1 = await store.list({ ...actor(fixture), limit: 4 }), page2 = await store.list({ ...actor(fixture), limit: 4, afterId: page1.nextCursor });
      assert.equal(page1.hasMore, true); assert.equal(page2.campaigns.length, 4);
      assert.equal(new Set([...page1.campaigns, ...page2.campaigns].map((row) => row.id.toString("hex"))).size, 8);
    });

    await subtest("concurrent workers claim once and atomic delivery creates one ordinary message and event", async () => {
      const fixture = await pair(); await consent(fixture); const created = await create(fixture);
      const claimed = await Promise.all([store.claim({ now }), store.claim({ now })]), jobs = claimed.filter(Boolean); assert.equal(jobs.length, 1);
      const job = jobs[0], sent = await store.deliver(job, { now, message: message(job) }); assert.deepEqual(sent, { delivered: true, duplicate: false });
      assert.deepEqual(await store.deliver(job, { now, message: message(job) }), { delivered: false });
      const detail = await get(fixture, created.campaign.id); assert.equal(detail.status, "completed"); assert.equal(detail.counts.delivered, 1);
      assert.ok(detail.recipients[0].messageId.equals(job.messageId)); await assertMessages(fixture.conversationId, 1);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM chat_events WHERE conversation_id = ?", [fixture.conversationId]))[0].value), 1);
      const client = await chat.readMessages({ role: "client", tokenHash: fixture.client.tokenHash, now, conversationId: fixture.conversationId });
      assert.equal(client.messages[0].senderRole, "admin"); assert.equal(Object.hasOwn(client.messages[0], "campaignId"), false);
    });

    await subtest("crashed leases recover the same durable message IDs without spending failure attempts", async () => {
      const fixture = await pair(); await consent(fixture); await create(fixture);
      const first = await store.claim({ now, leaseMilliseconds: 1000 }); assert.equal(await store.claim({ now: now + 999 }), null);
      const second = await store.claim({ now: now + 1000, leaseMilliseconds: 1000 });
      assert.ok(second.messageId.equals(first.messageId)); assert.ok(second.clientMessageId.equals(first.clientMessageId)); assert.ok(!second.leaseToken.equals(first.leaseToken));
      assert.deepEqual(await store.deliver(first, { now: now + 1000, message: message(first) }), { delivered: false });
      assert.equal(Number((await connection.query("SELECT attempts FROM broadcast_recipients WHERE campaign_id = ?", [second.campaignId]))[0].attempts), 0);
      assert.equal((await store.deliver(second, { now: now + 1000, message: message(second) })).delivered, true);
    });

    await subtest("consent withdrawal between claim and insert prevents delivery", async () => {
      const fixture = await pair(); await consent(fixture); const created = await create(fixture), job = await store.claim({ now });
      await consent(fixture, { expectedVersion: "1", enabled: false });
      assert.deepEqual(await store.deliver(job, { now, message: message(job) }), { delivered: false });
      const detail = await get(fixture, created.campaign.id); assert.equal(detail.recipients[0].reason, "opted_out"); assert.equal(detail.counts.skipped, 1); await assertMessages(fixture.conversationId, 0);
    });

    await subtest("current client gates, assignment, closed conversation and seven-day expiry are rechecked", async () => {
      for (const mode of ["revoked", "expired", "closed", "reassigned", "campaign-expired"]) {
        const fixture = await pair(); await consent(fixture); const created = await create(fixture), job = await store.claim({ now });
        if (mode === "revoked") await connection.query("UPDATE users SET status = 'revoked' WHERE id = ?", [fixture.client.id]);
        if (mode === "expired") await connection.query("UPDATE users SET access_approved_at = ?, access_expires_at = ? WHERE id = ?", [sqlDate(now - 1000), sqlDate(now), fixture.client.id]);
        if (mode === "closed") await connection.query("UPDATE conversations SET closed_at = ? WHERE id = ?", [sqlDate(now), fixture.conversationId]);
        if (mode === "reassigned") { const other = await user("admin"); await connection.query("UPDATE conversations SET admin_id = ? WHERE id = ?", [other.id, fixture.conversationId]); }
        const delivered = await store.deliver(job, { now: mode === "campaign-expired" ? now + 7 * 86400000 : now, message: message(job) });
        assert.equal(delivered.delivered, false);
        if (mode === "campaign-expired") assert.equal(await store.claim({ now: now + 7 * 86400000 }), null);
        const detail = await get(fixture, created.campaign.id); assert.equal(detail.status, "completed");
        assert.equal(detail.recipients[0].reason, mode === "campaign-expired" ? "expired" : ["closed", "reassigned"].includes(mode) ? "conversation_unavailable" : "access_inactive");
        await assertMessages(fixture.conversationId, 0);
      }
    });

    await subtest("cancellation invalidates outstanding leases and preserves already delivered messages", async () => {
      const one = await pair(), two = await pair(one.admin); await consent(one); await consent(two);
      const created = await create(one, campaign([one, two])), first = await store.claim({ now });
      assert.equal((await store.deliver(first, { now, message: message(first) })).delivered, true);
      const second = await store.claim({ now }), cancelled = await store.cancel({ ...actor(one), campaignId: created.campaign.id });
      assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.counts.delivered, 1); assert.equal(cancelled.counts.cancelled, 1);
      assert.deepEqual(await store.deliver(second, { now, message: message(second) }), { delivered: false });
      assert.deepEqual(await store.cancel({ ...actor(one), campaignId: created.campaign.id }), cancelled);
    });

    await subtest("approval survives browser logout but administrator suspension or MFA rotation pauses every remaining target", async () => {
      const fixture = await pair(); await consent(fixture); await create(fixture);
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [sqlDate(now), fixture.admin.sessionId]);
      const job = await store.claim({ now }); assert.ok(job); assert.equal((await store.deliver(job, { now, message: message(job) })).delivered, true);
      for (const mode of ["mfa", "suspended"]) {
        const one = await pair(), two = await pair(one.admin); await consent(one); await consent(two); const created = await create(one, campaign([one, two]));
        if (mode === "mfa") await connection.query("UPDATE admin_mfa SET version = 2 WHERE user_id = ?", [one.admin.id]);
        else await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [one.admin.id]);
        assert.equal(await store.claim({ now }), null);
        const rows = await connection.query("SELECT state, reason FROM broadcast_recipients WHERE campaign_id = ?", [created.campaign.id]);
        assert.equal(rows.length, 2); assert.ok(rows.every((row) => row.state === "cancelled" && row.reason === "administrator_invalid"));
        assert.equal((await connection.query("SELECT status FROM broadcast_campaigns WHERE id = ?", [created.campaign.id]))[0].status, "paused");
        await assertMessages(one.conversationId, 0); await assertMessages(two.conversationId, 0);
      }
    });

    await subtest("media ownership, deletion, repeat acknowledgement and disabled media are enforced again at delivery", async () => {
      const fixture = await pair(); await consent(fixture); const mediaId = await asset(fixture.admin), foreign = await pair(), foreignMedia = await asset(foreign.admin);
      await assert.rejects(store.preview({ ...actor(fixture), conversationIds: [fixture.conversationId], mediaId: foreignMedia }), code("BROADCAST_MEDIA"));
      let created = await create(fixture, campaign([fixture], { mediaId })), job = await store.claim({ now });
      assert.equal((await store.deliver(job, { now, message: message(job) })).delivered, true);
      await chat.deleteMessage({ role: "admin", tokenHash: fixture.admin.tokenHash, now, conversationId: fixture.conversationId, messageId: job.messageId });
      const preview = await store.preview({ ...actor(fixture), conversationIds: [fixture.conversationId], mediaId }); assert.equal(preview.repeatCount, 1);
      await assert.rejects(create(fixture, campaign([fixture], { mediaId })), code("BROADCAST_REPEAT"));
      created = await create(fixture, campaign([fixture], { mediaId, allowRepeatMedia: true })); job = await store.claim({ now });
      const disabled = createBroadcastStore(pool, { chatStore: chat });
      await assert.rejects(disabled.preview({ ...actor(fixture), conversationIds: [fixture.conversationId], mediaId }), code("BROADCAST_MEDIA"));
      assert.equal((await disabled.deliver(job, { now, message: message(job) })).delivered, false);
      assert.equal((await get(fixture, created.campaign.id)).recipients[0].reason, "media_unavailable");
      created = await create(fixture, campaign([fixture], { mediaId, allowRepeatMedia: true })); job = await store.claim({ now });
      await connection.query("UPDATE media_assets SET deleted_at = ?, active_digest = NULL WHERE id = ?", [sqlDate(now), mediaId]);
      assert.equal((await store.deliver(job, { now, message: message(job) })).delivered, false);
      assert.equal((await get(fixture, created.campaign.id)).recipients[0].reason, "media_unavailable");
    });

    await subtest("manual photo sharing after preview requires repeat acknowledgement before the queued message can insert", async () => {
      const fixture = await pair(); await consent(fixture); const mediaId = await asset(fixture.admin), created = await create(fixture, campaign([fixture], { mediaId }));
      const job = await store.claim({ now });
      await chat.sendMessage({ role: "admin", tokenHash: fixture.admin.tokenHash, now, conversationId: fixture.conversationId,
        message: { id: id(), clientMessageId: id(), bodyEncrypted: "v1.synthetic-manual-photo", bodyFingerprint: digest(), mediaId } });
      assert.equal((await store.deliver(job, { now, message: message(job) })).delivered, false);
      assert.equal((await get(fixture, created.campaign.id)).recipients[0].reason, "repeat_media"); await assertMessages(fixture.conversationId, 1);
    });

    await subtest("rate deferral and crash recovery preserve failure budgets; eight processing failures stop safely", async () => {
      const fixture = await pair(); await consent(fixture); const created = await create(fixture);
      let job = await store.claim({ now }); assert.equal(await store.defer(job, { now, availableAt: now + 1000 }), true);
      assert.equal(await store.defer(job, { now, availableAt: now + 1000 }), false); assert.equal(await store.claim({ now: now + 999 }), null);
      assert.equal(Number((await connection.query("SELECT attempts FROM broadcast_recipients WHERE campaign_id = ?", [created.campaign.id]))[0].attempts), 0);
      let workTime = now + 1000;
      for (let attempt = 1; attempt <= 8; attempt++) {
        job = await store.claim({ now: workTime }); assert.ok(job); assert.equal(await store.fail(job, { now: workTime }), true);
        const row = (await connection.query("SELECT attempts, state, available_at FROM broadcast_recipients WHERE campaign_id = ?", [created.campaign.id]))[0];
        assert.equal(Number(row.attempts), attempt); assert.equal(row.state, attempt === 8 ? "failed" : "pending");
        workTime += Math.min(3600, 30 * 2 ** (attempt - 1)) * 1000;
      }
      const detail = await get(fixture, created.campaign.id); assert.equal(detail.status, "completed"); assert.equal(detail.counts.failed, 1); assert.equal(detail.recipients[0].reason, "processing_failed");
    });

    await subtest("live activity includes older active work and the newest campaigns regardless of random ID keysets", async () => {
      const fixture = await pair(); await consent(fixture);
      const oldActive = (await create(fixture, campaign([fixture], { id: Buffer.alloc(16, 254) }))).campaign;
      const recent = [];
      for (let index = 1; index <= 25; index++) {
        const campaignId = Buffer.alloc(16, 100 - index), workTime = now + index;
        const result = await create(fixture, campaign([fixture], { id: campaignId }), { now: workTime });
        await store.cancel({ ...actor(fixture), now: workTime, campaignId: result.campaign.id });
        recent.unshift(campaignId.toString("hex"));
      }
      const foreign = await pair(); await consent(foreign);
      const foreignCampaign = (await create(foreign, campaign([foreign]), { now: now + 100 })).campaign;
      const activity = await store.activity({ ...actor(fixture), now: now + 100 });
      assert.equal(activity.campaigns.length, 21);
      assert.deepEqual(activity.campaigns.slice(0, 20).map((row) => row.id.toString("hex")), recent.slice(0, 20));
      assert.equal(activity.campaigns.at(-1).id.equals(oldActive.id), true);
      assert.equal(activity.campaigns.some((row) => row.id.equals(foreignCampaign.id)), false);
      await store.cancel({ ...actor(fixture), now: now + 101, campaignId: oldActive.id });
      const after = await store.activity({ ...actor(fixture), now: now + 101 });
      assert.equal(after.campaigns.length, 20);
      assert.equal(after.campaigns.some((row) => row.id.equals(oldActive.id)), false);
      await assert.rejects(store.activity({ tokenHash: digest(), now: now + 101 }), code("CHAT_UNAUTHORIZED"));
    });

    await subtest("failure after message/event insertion rolls back the entire recipient delivery transaction", async () => {
      const fixture = await pair(); await consent(fixture); const created = await create(fixture), job = await store.claim({ now }), payload = message(job);
      // Scope the fault to this synthetic campaign; earlier subtests retain
      // delivered history that must continue to satisfy the temporary CHECK.
      const probeCampaignHex = created.campaign.id.toString("hex");
      assert.match(probeCampaignHex, /^[a-f0-9]{32}$/);
      await connection.query(`ALTER TABLE broadcast_recipients ADD CONSTRAINT broadcast_delivery_probe CHECK (campaign_id <> X'${probeCampaignHex}' OR state <> 'delivered')`);
      try { await assert.rejects(store.deliver(job, { now, message: payload }), code("CHAT_DATABASE_OPERATION")); }
      finally { await connection.query("ALTER TABLE broadcast_recipients DROP CONSTRAINT broadcast_delivery_probe"); }
      await assertMessages(fixture.conversationId, 0);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM chat_events WHERE conversation_id = ?", [fixture.conversationId]))[0].value), 0);
      assert.equal((await get(fixture, created.campaign.id)).recipients[0].state, "sending");
      assert.equal((await store.deliver(job, { now, message: payload })).delivered, true); await assertMessages(fixture.conversationId, 1);
    });
  } finally { if (pool) await pool.end(); try { await reset(); } finally { await connection.end(); } }
});
