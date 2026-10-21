// Real MariaDB, disposable loopback schema and synthetic users only.
// The ordinary broadcast worker writes local messages/outbox rows; no network
// mail, push transport or production account is involved.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createChatService } from "../server/chat/service.mjs";
import { decryptMessageBody } from "../server/chat/crypto.mjs";
import { createBroadcastStore } from "../server/broadcast/store.mjs";
import { createBroadcastService } from "../server/broadcast/service.mjs";
import { createBroadcastWorker } from "../server/broadcast/worker.mjs";
import { enqueueNotification } from "../server/notifications/store.mjs";
import { createAnnouncementsStore } from "../server/announcements/store.mjs";
import { createAnnouncementsService } from "../server/announcements/service.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16), hex = value => value.toString("hex");
const sql = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const conflict = error => error?.code?.endsWith("_CONFLICT");

function interruptedCapturePool(pool) {
  return { async getConnection() {
    const connection = await pool.getConnection();
    return new Proxy(connection, { get(target, name) {
      if (name === "query") return async (statement, ...args) => {
        if (/INSERT\s+INTO\s+`?broadcast_recipients`?\b/iu.test(statement)) throw new Error("synthetic announcement capture interruption");
        return target.query(statement, ...args);
      };
      const value = target[name]; return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
}

test("real MariaDB announcements are private, atomic, scheduled, expiring and retryable with ordinary delivery", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 180000,
}, async t => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/u);
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  const migrations = await loadMigrations(); assert.equal(migrations.length, 33);
  const allowed = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool, worker;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every(row => allowed.includes(row.name)), "refuse cleanup of unrelated tables");
    for (const table of allowed) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    let now = Date.UTC(2026, 9, 21, 15); const clock = () => now, created = sql(now - 1000), key = randomBytes(32), actors = new Map();
    async function user(role) {
      const value = { id: id(), sessionId: id(), token: newToken(), role };
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at,
        age_assured_at, access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?, ?)`,
      [value.id, role, `Announcement ${role}`, `${hex(value.id)}@example.invalid`, created, created, created, created, created]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic', 1, 1, ?)", [value.id, created]);
      else { await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [value.id, created]); await consumeSyntheticInvitation(connection, value.id, now - 1000); }
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [value.sessionId, value.id, tokenDigest(value.token), created, sql(now + 8 * 3600000)]);
      await connection.query(role === "admin" ? "INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)"
        : "INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", role === "admin" ? [value.sessionId, created, created] : [value.sessionId, created]);
      actors.set(value.token, { user: { id: hex(value.id), role, pseudonym: `Announcement ${role}` }, csrf: newToken(), expiresAt: now + 8 * 3600000 });
      return value;
    }
    const admin = await user("admin"), other = await user("admin"), first = await user("client"), second = await user("client"), foreign = await user("client");
    for (const [owner, client] of [[admin, first], [admin, second], [other, foreign]]) {
      client.conversationId = id();
      await connection.query("INSERT INTO conversations (id, admin_id, client_id, created_at) VALUES (?, ?, ?, ?)", [client.conversationId, owner.id, client.id, created]);
    }
    // Three synthetic subscriptions exercise pending, leased and already
    // accepted alerts separately, without calling any external push provider.
    for (let index = 0; index < 3; index++) await connection.query(`INSERT INTO push_subscriptions (id, user_id, role, session_id, credential_version, generation,
      endpoint_digest, subscription_encrypted, locale, enabled, created_at, updated_at) VALUES (?, ?, 'client', ?, 1, 1, ?, 'synthetic-only-not-transmitted', 'fr', 1, ?, ?)`,
    [id(), first.id, first.sessionId, randomBytes(32), created, created]);
    const authService = { session: async raw => actors.get(raw) ?? null }, accessService = { requireActiveClient: async raw => actors.get(raw) ?? null };
    function components(selectedPool = pool) {
      const authStore = createAuthStore(selectedPool), chatStore = createChatStore(selectedPool, { clock, enqueueNotification });
      const broadcastStore = createBroadcastStore(selectedPool, { chatStore, clock });
      return { authStore, chatStore, broadcastStore };
    }
    async function serviceFor(selectedPool = pool) {
      const { authStore, chatStore, broadcastStore } = components(selectedPool);
      const chatService = await createChatService({ store: chatStore, authStore, authService, accessService, key, clock });
      const broadcastService = await createBroadcastService({ store: broadcastStore, authService, authStore, key, clock, largeAudiencesEnabled: true });
      const store = createAnnouncementsStore({ pool: selectedPool, chatStore, broadcastStore, key, clock });
      const service = await createAnnouncementsService({ store, broadcastService, chatService, authService, authStore, key, clock });
      return { store, service, broadcastStore, authStore };
    }
    const runtime = await serviceFor(), { service, store, broadcastStore, authStore } = runtime;
    const count = async table => Number((await connection.query(`SELECT COUNT(*) AS value FROM ${table}`))[0].value);
    const pushes = async campaignId => connection.query(`SELECT o.* FROM push_outbox o
      JOIN broadcast_recipients r ON r.delivered_message_id = o.message_id WHERE r.campaign_id = ? ORDER BY o.id`, [Buffer.from(campaignId, "hex")]);
    const revision = async owner => (await service.current("admin", owner.token)).revision;
    async function input(overrides = {}, owner = admin) {
      return { mutationId: hex(id()), expectedRevision: await revision(owner), body: "Je commence mon show bientôt 💋", startsAt: null,
        expiresAt: now + 600000, sendPrivateMessage: false, previewToken: null, ...overrides };
    }
    async function privateInput(overrides = {}) {
      const preview = await service.preview(admin.token, {}); assert.equal(preview.eligibleCount, 2);
      return input({ sendPrivateMessage: true, previewToken: preview.previewToken, ...overrides });
    }
    const freshWorker = () => createBroadcastWorker({ store: broadcastStore, authStore, key, clock });

    await t.test("schema, empty state and account isolation do not materialize an announcement", async () => {
      assert.equal(await store.assertSchema(), true);
      assert.deepEqual(await service.current("admin", admin.token), { serverTime: now, revision: "0", announcement: null });
      assert.equal((await service.current("client", first.token)).announcement, null);
      assert.equal(await count("announcements"), 0);
      await assert.rejects(service.current("admin", first.token));
      await assert.rejects(service.current("client", admin.token));
    });

    await t.test("the persisted banner appears only in its time window and never crosses the owner", async () => {
      const startsAt = now + 1000, expiresAt = now + 3000, request = await input({ startsAt, expiresAt });
      const result = await service.save(admin.token, request);
      assert.equal(result.duplicate, false); assert.equal(result.announcement.status, "scheduled");
      const raw = (await connection.query("SELECT body_encrypted FROM announcements WHERE admin_id = ?", [admin.id]))[0];
      assert.ok(raw.body_encrypted.length > 0); assert.ok(!raw.body_encrypted.includes(request.body));
      assert.equal((await service.current("client", first.token)).announcement, null);
      now = startsAt;
      const visible = (await service.current("client", first.token)).announcement;
      assert.equal(visible.body, request.body); assert.equal(visible.startsAt, startsAt); assert.equal(visible.expiresAt, expiresAt);
      assert.deepEqual(Object.keys(visible).sort(), ["body", "expiresAt", "id", "revision", "startsAt"]);
      assert.equal((await service.current("client", foreign.token)).announcement, null);
      now = expiresAt;
      const restarted = await serviceFor();
      assert.equal((await restarted.service.current("client", first.token)).announcement, null);
      assert.equal((await service.current("admin", admin.token)).announcement.status, "expired");
      const duplicate = await service.save(admin.token, request);
      assert.equal(duplicate.duplicate, true); assert.equal(duplicate.revision, result.revision);
      await assert.rejects(service.save(admin.token, { ...request, body: "Changed retry content" }), conflict);
      assert.equal(await count("broadcast_campaigns"), 0);
    });

    await t.test("simultaneous devices serialize one revision and stale requests cannot replace it", async () => {
      now += 1;
      const left = await input({ body: "Annonce du premier appareil" }), right = { ...left, mutationId: hex(id()), body: "Annonce du second appareil" };
      const results = await Promise.allSettled([service.save(admin.token, left), service.save(admin.token, right)]);
      assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
      assert.equal(results.filter(item => item.status === "rejected" && conflict(item.reason)).length, 1);
      await assert.rejects(service.save(admin.token, { ...left, mutationId: hex(id()) }), conflict);
      assert.equal(await count("announcements"), 1);
    });

    await t.test("a failed recipient insertion rolls back both announcement and optional campaign", async () => {
      const before = await service.current("admin", admin.token), campaigns = await count("broadcast_campaigns"), recipients = await count("broadcast_recipients");
      const attempted = await privateInput(), interrupted = await serviceFor(interruptedCapturePool(pool));
      await assert.rejects(interrupted.service.save(admin.token, attempted), error => !String(error.message).includes("synthetic announcement capture interruption"));
      assert.deepEqual(await service.current("admin", admin.token), before);
      assert.equal(await count("broadcast_campaigns"), campaigns); assert.equal(await count("broadcast_recipients"), recipients);
    });

    await t.test("a scheduled campaign resumes a lease exactly once and caps ordinary push expiry", async () => {
      const startsAt = now + 1000, expiresAt = startsAt + 60000, request = await privateInput({ startsAt, expiresAt });
      const saved = await service.save(admin.token, request), campaignId = Buffer.from(saved.announcement.campaignId, "hex");
      assert.equal((await service.save(admin.token, request)).duplicate, true);
      assert.equal(await count("broadcast_campaigns"), 1); assert.equal(await count("broadcast_recipients"), 2);
      assert.equal(await count("messages"), 0); assert.equal(await broadcastStore.claim({ now, leaseMilliseconds: 1000 }), null);
      const rows = await connection.query("SELECT available_at FROM broadcast_recipients WHERE campaign_id = ?", [campaignId]);
      assert.equal(rows.length, 2); assert.ok(rows.every(row => Date.parse(String(row.available_at).replace(" ", "T") + "Z") === startsAt));
      now = startsAt;
      const abandoned = await broadcastStore.claim({ now, leaseMilliseconds: 1000 }); assert.ok(abandoned);
      now += 1001; worker = freshWorker();
      const delivered = await worker.runOnce(); assert.equal(delivered.delivered, 2);
      await worker.stop(); worker = freshWorker(); await worker.runOnce();
      assert.equal(await count("messages"), 2); assert.equal(await count("chat_events"), 2); assert.equal(await count("push_outbox"), 3);
      for (const row of await connection.query("SELECT id, conversation_id, body_encrypted FROM messages")) {
        assert.equal(decryptMessageBody(row.body_encrypted, key, { messageId: row.id, conversationId: row.conversation_id, senderId: admin.id }), request.body);
      }
      const queued = (await connection.query("SELECT expires_at FROM push_outbox"))[0];
      assert.equal(Date.parse(String(queued.expires_at).replace(" ", "T") + "Z"), expiresAt);
    });

    await t.test("replacement rolls back alert cancellation on failure and removal skips untransferred alerts only", async () => {
      const old = await service.current("admin", admin.token), beforeMessages = await count("messages");
      const original = await pushes(old.announcement.campaignId); assert.equal(original.length, 3);
      await connection.query("UPDATE push_outbox SET status = 'sending', attempts = 1, lease_token = ?, lease_until = ? WHERE id = ?",
        [id(), sql(now + 90000), original[0].id]);
      await connection.query("UPDATE push_outbox SET status = 'accepted', attempts = 1, finished_at = ? WHERE id = ?", [sql(now), original[2].id]);
      const before = await pushes(old.announcement.campaignId);
      assert.deepEqual(before.map(row => row.status), ["sending", "pending", "accepted"]);
      const next = await privateInput({ startsAt: now + 5000, body: "Une nouvelle annonce distincte" });
      const interrupted = await serviceFor(interruptedCapturePool(pool));
      await assert.rejects(interrupted.service.save(admin.token, next));
      assert.deepEqual(await pushes(old.announcement.campaignId), before,
        "failed replacement restores statuses, leases and accepted receipts of the previous alert set");
      assert.equal((await service.current("admin", admin.token)).revision, old.revision);

      const replacement = await service.save(admin.token, next);
      assert.notEqual(replacement.announcement.campaignId, old.announcement.campaignId);
      const after = await pushes(old.announcement.campaignId);
      for (const row of after.slice(0, 2)) {
        assert.equal(row.status, "skipped"); assert.equal(row.lease_token, null); assert.equal(row.lease_until, null);
        assert.equal(Date.parse(row.finished_at.replace(" ", "T") + "Z"), now);
      }
      assert.deepEqual(after[2], before[2], "already accepted push receipts are never retracted or rewritten");
      assert.equal(await count("messages"), beforeMessages, "replacing the banner never deletes messages already handed to chat");
      now = next.startsAt; await worker.runOnce();
      const pending = await pushes(replacement.announcement.campaignId); assert.equal(pending.length, 3);
      await connection.query("UPDATE push_outbox SET status = 'sending', attempts = 1, lease_token = ?, lease_until = ? WHERE id = ?",
        [id(), sql(now + 90000), pending[0].id]);
      const messages = await count("messages"); assert.equal(messages, beforeMessages + 2);
      await service.remove(admin.token, { mutationId: hex(id()), expectedRevision: replacement.revision });
      const removed = await pushes(replacement.announcement.campaignId);
      assert.ok(removed.every(row => row.status === "skipped" && row.lease_token === null && row.lease_until === null && row.finished_at !== null));
      assert.deepEqual((await pushes(old.announcement.campaignId))[2], before[2]);
      assert.equal(await count("messages"), messages, "removing an announcement also preserves its already delivered messages");
      assert.equal((await service.current("client", first.token)).announcement, null);
    });

    await t.test("a restart after expiry sends no obsolete message or alert", async () => {
      await worker.stop(); worker = undefined;
      const request = await privateInput({ startsAt: now + 1000, expiresAt: now + 2000 });
      const saved = await service.save(admin.token, request), messages = await count("messages"), alerts = await count("push_outbox");
      now = request.expiresAt + 1; worker = freshWorker();
      await worker.runOnce();
      assert.equal(await count("messages"), messages); assert.equal(await count("push_outbox"), alerts);
      assert.equal((await service.current("client", first.token)).announcement, null);
      const states = await connection.query("SELECT state, reason FROM broadcast_recipients WHERE campaign_id = ?", [Buffer.from(saved.announcement.campaignId, "hex")]);
      assert.ok(states.every(row => row.state === "skipped" && row.reason === "expired"));
    });

    await t.test("replacement and removal stop pending delivery while preserving messages already sent", async () => {
      const request = await privateInput({ startsAt: now + 10000 });
      const pending = await service.save(admin.token, request), beforeMessages = await count("messages");
      const stale = await privateInput({ body: "This obsolete preview must not replace the current announcement" });
      await connection.query("UPDATE users SET status = 'revoked' WHERE id = ?", [second.id]);
      try { await assert.rejects(service.save(admin.token, stale), conflict); }
      finally { await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [second.id]); }
      assert.equal((await service.current("admin", admin.token)).revision, pending.revision);
      assert.equal((await connection.query("SELECT status FROM broadcast_campaigns WHERE id = ?", [Buffer.from(pending.announcement.campaignId, "hex")]))[0].status, "queued",
        "a refused replacement also rolls back cancellation of the previous pending campaign");
      const replacement = await service.save(admin.token, await input({ body: "Bandeau de remplacement sans envoi" }));
      const prior = (await connection.query("SELECT status FROM broadcast_campaigns WHERE id = ?", [Buffer.from(pending.announcement.campaignId, "hex")]))[0];
      assert.equal(prior.status, "cancelled");
      const removal = { mutationId: hex(id()), expectedRevision: replacement.revision };
      const removed = await service.remove(admin.token, removal); assert.equal(removed.announcement, null);
      assert.equal((await service.remove(admin.token, removal)).duplicate, true);
      assert.equal((await service.current("client", first.token)).announcement, null);
      assert.equal(await count("messages"), beforeMessages);
    });

    await t.test("access is revalidated and altered encrypted announcements are refused", async () => {
      await service.save(admin.token, await input());
      await service.save(other.token, await input({ body: "Annonce privée de l’autre administrateur" }, other));
      assert.equal((await service.current("client", foreign.token)).announcement.body, "Annonce privée de l’autre administrateur");
      await connection.query("UPDATE users SET access_expires_at = ? WHERE id = ?", [sql(now - 1), first.id]);
      try { await assert.rejects(service.current("client", first.token)); }
      finally { await connection.query("UPDATE users SET access_expires_at = NULL WHERE id = ?", [first.id]); }
      const original = (await connection.query("SELECT body_encrypted FROM announcements WHERE admin_id = ?", [admin.id]))[0].body_encrypted;
      await connection.query("UPDATE announcements SET body_encrypted = ? WHERE admin_id = ?", [original.slice(0, -1) + (original.endsWith("A") ? "B" : "A"), admin.id]);
      try { await assert.rejects(service.current("client", first.token)); }
      finally { await connection.query("UPDATE announcements SET body_encrypted = ? WHERE admin_id = ?", [original, admin.id]); }
      await connection.query("UPDATE conversations SET closed_at = ? WHERE id = ?", [sql(now), first.conversationId]);
      assert.equal((await service.current("client", first.token)).announcement, null);
      assert.equal((await service.current("client", second.token)).announcement.body, "Je commence mon show bientôt 💋");
    });
  } finally {
    await worker?.stop(); await pool?.end();
    try { await reset(); } finally { await connection.end(); }
  }
});
