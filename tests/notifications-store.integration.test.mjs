import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createNotificationsStore, enqueueNotification } from "../server/notifications/store.mjs";
import { endpointDigest, openSubscription } from "../server/notifications/crypto.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import { createConfiguredServer } from "../server/index.mjs";
import { newToken, tokenDigest, csrfToken } from "../server/auth/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1", now = Date.UTC(2026, 9, 17, 12);
const id = () => randomBytes(16), digest = () => randomBytes(32), key = digest();
const date = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const errorCode = (expected) => (error) => error.code === expected && error.cause === undefined;
const payload = (extra = {}) => ({ id: id(), clientMessageId: id(), bodyEncrypted: "v1.synthetic-not-private-content", bodyFingerprint: digest(), ...extra });
function subscription(endpoint) {
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  return { endpoint: endpoint ?? `https://fcm.googleapis.com/wp/synthetic-${id().toString("hex")}`, expirationTime: null,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
}

test("real MariaDB private notification transactions (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 120000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  const migrations = await loadMigrations(), allowed = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase();
  let pool, sequence = 0;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowed.includes(table.name)));
    for (const name of allowed) await connection.query(`DROP TABLE IF EXISTS ${name}`);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const chat = createChatStore(pool, { enqueueNotification });
    const store = createNotificationsStore({ pool, chatStore: chat, key });
    async function session(user, at = now) {
      const value = { ...user, sessionId: id(), tokenHash: digest() };
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        [value.sessionId, value.id, value.tokenHash, date(at), date(at + 8 * 3600000)]);
      if (value.role === "admin") await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [value.sessionId, date(at), date(at)]);
      else await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", [value.sessionId, date(at)]);
      return value;
    }
    async function user(role) {
      const value = { id: id(), role };
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at,
        access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?)`,
      [value.id, role, `Synthetic notifications ${sequence}`, `notification-${sequence++}@example.invalid`,
        role === "client" ? date(now) : null, role === "client" ? date(now) : null, date(now), date(now)]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic-secret', 1, 1, ?)", [value.id, date(now)]);
      else {
        await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [value.id, date(now)]);
        await consumeSyntheticInvitation(connection, value.id, now);
      }
      return session(value);
    }
    async function pair() {
      await connection.query("DELETE FROM push_outbox");
      const fixture = { admin: await user("admin"), client: await user("client"), conversationId: id() };
      await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [fixture.conversationId, fixture.client.id, fixture.admin.id, date(now)]);
      return fixture;
    }
    const actor = (fixture, role = "client", extra = {}) => ({ role, tokenHash: fixture[role].tokenHash, now, ...extra });
    const chatRequest = (fixture, role = "admin", extra = {}) => ({ ...actor(fixture, role), conversationId: fixture.conversationId, ...extra });
    const subscribe = (fixture, role = "client", value = subscription(), extra = {}) => store.subscribe({ ...actor(fixture, role), subscription: value, locale: "fr", ...extra });
    const send = (fixture, role = "admin", message = payload(), extra = {}) => chat.sendMessage({ ...chatRequest(fixture, role, extra), message });
    const outbox = () => connection.query("SELECT * FROM push_outbox ORDER BY id");
    const claim = async (at = now) => (await store.claimDue({ now: at, limit: 5 }))[0];

    await t.test("schema inspection rejects dirty history, type, index, CHECK and FK drift", async () => {
      assert.equal(await store.assertSchema(), true);
      await connection.query("UPDATE schema_migrations SET state = 'failed', finished_at = NULL WHERE version = 30");
      await assert.rejects(store.assertSchema());
      await connection.query("UPDATE schema_migrations SET state = 'applied', finished_at = CURRENT_TIMESTAMP(6) WHERE version = 30");
      await connection.query("ALTER TABLE push_subscriptions MODIFY generation INT NOT NULL");
      await assert.rejects(store.assertSchema());
      await connection.query("ALTER TABLE push_subscriptions MODIFY generation INT UNSIGNED NOT NULL");
      await connection.query("ALTER TABLE push_outbox DROP INDEX push_outbox_ready");
      await assert.rejects(store.assertSchema());
      await connection.query("ALTER TABLE push_outbox ADD KEY push_outbox_ready (status, available_at, id)");
      await connection.query("ALTER TABLE push_subscriptions DROP CONSTRAINT push_subscriptions_enabled");
      await connection.query("ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_enabled CHECK (1)");
      await assert.rejects(store.assertSchema());
      await connection.query("ALTER TABLE push_subscriptions DROP CONSTRAINT push_subscriptions_enabled");
      await connection.query("ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_enabled CHECK (enabled IN (0, 1))");
      await connection.query("ALTER TABLE push_subscriptions DROP FOREIGN KEY push_subscriptions_session_fk");
      await assert.rejects(store.assertSchema());
      await connection.query("ALTER TABLE push_subscriptions ADD CONSTRAINT push_subscriptions_session_fk FOREIGN KEY (session_id) REFERENCES sessions(id) ON UPDATE RESTRICT ON DELETE RESTRICT");
      assert.equal(await store.assertSchema(), true);
    });

    await t.test("account isolation, encrypted subscription and idempotent registration", async () => {
      const fixture = await pair(), value = subscription(), first = await subscribe(fixture, "client", value);
      const second = await subscribe(fixture, "client", value);
      assert.equal(first.id, second.id);
      const row = (await connection.query("SELECT * FROM push_subscriptions WHERE id = ?", [Buffer.from(first.id, "hex")]))[0];
      assert.equal(Number(row.generation), 1);
      assert.ok(!row.subscription_encrypted.includes(value.endpoint));
      assert.deepEqual(openSubscription(row.subscription_encrypted, key, { subscriptionId: row.id, userId: row.user_id, generation: 1 }), value);
      await assert.rejects(subscribe(fixture, "admin", value), errorCode("NOTIFICATIONS_CONFLICT"));
      assert.equal((await store.status({ ...actor(fixture, "admin"), endpointDigest: endpointDigest(value.endpoint, key) })).currentId, null);
      assert.equal(await store.disable({ ...actor(fixture, "admin"), id: row.id }), false);
      const own = await store.status({ ...actor(fixture), endpointDigest: endpointDigest(value.endpoint, key) });
      assert.equal(own.currentId, first.id);
      assert.ok(own.subscriptions.every((item) => Object.keys(item).join(",") === "id,enabled,createdAt,updatedAt"));
    });

    await t.test("opaque notification references require their recipient and current conversation access, including after a fresh login", async () => {
      for (const role of ["admin", "client"]) {
        const outsider = await pair(), fixture = await pair();
        await subscribe(fixture, role);
        const sent = await send(fixture, role === "admin" ? "client" : "admin");
        const notificationId = (await outbox())[0].id;
        const expected = { conversationId: fixture.conversationId.toString("hex"), messageId: sent.message.id.toString("hex"), sequence: "1" };
        assert.deepEqual(await store.open({ ...actor(fixture, role), notificationId }), expected);
        await assert.rejects(store.open({ ...actor(outsider, role), notificationId }), errorCode("NOTIFICATIONS_NOT_FOUND"));
        await assert.rejects(store.open({ ...actor(fixture, role), notificationId: id() }), errorCode("NOTIFICATIONS_NOT_FOUND"));
        const renewed = await session(fixture[role]);
        await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [date(now), fixture[role].sessionId]);
        assert.deepEqual(await store.open({ role, tokenHash: renewed.tokenHash, now, notificationId }), expected);
        await assert.rejects(store.open({ ...actor(fixture, role), notificationId }), errorCode("CHAT_UNAUTHORIZED"));
        await connection.query("UPDATE messages SET deleted_at = ?, body_encrypted = NULL WHERE id = ?", [date(now), sent.message.id]);
        assert.deepEqual(await store.open({ role, tokenHash: renewed.tokenHash, now, notificationId }), expected, "a deleted message opens its authorized tombstone without content");
      }
    });

    await t.test("one job per recipient device and no new job on duplicate text or photo send", async () => {
      const fixture = await pair(); await subscribe(fixture); await subscribe(fixture); await subscribe(fixture, "admin");
      const message = payload(); await send(fixture, "admin", message);
      assert.equal((await send(fixture, "admin", message)).duplicate, true);
      assert.equal((await outbox()).length, 2);
      const assetId = id(), fingerprint = digest();
      await connection.query(`INSERT INTO media_assets (id, owner_id, owner_role, storage_key, content_digest, active_digest,
        width, height, thumbnail_width, thumbnail_height, full_bytes, thumbnail_bytes, created_at)
        VALUES (?, ?, 'admin', ?, ?, ?, 1200, 800, 480, 320, 42000, 7000, ?)`,
      [assetId, fixture.admin.id, digest(), fingerprint, fingerprint, date(now)]);
      const photo = payload({ mediaId: assetId }); await send(fixture, "admin", photo); await send(fixture, "admin", photo);
      assert.equal((await outbox()).length, 4);
      const owners = await connection.query("SELECT p.user_id FROM push_outbox o JOIN push_subscriptions p ON p.id = o.subscription_id");
      assert.ok(owners.every((row) => row.user_id.equals(fixture.client.id)), "sender devices must not receive their own send");
    });

    await t.test("an outbox failure rolls back message, event and notification jobs together", async () => {
      const fixture = await pair(); await subscribe(fixture);
      const failing = createChatStore(pool, { enqueueNotification: async (...args) => { await enqueueNotification(...args); throw new Error("synthetic commit path interruption"); } });
      await assert.rejects(failing.sendMessage({ ...chatRequest(fixture), message: payload() }));
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?", [fixture.conversationId]))[0].n), 0);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS n FROM chat_events WHERE conversation_id = ?", [fixture.conversationId]))[0].n), 0);
      assert.equal((await outbox()).length, 0);
    });

    await t.test("normal client session expiry does not stop push or renew the session", async () => {
      const fixture = await pair(); await subscribe(fixture); await send(fixture);
      await connection.query("UPDATE sessions SET expires_at = ? WHERE id = ?", [date(now + 8 * 3600000), fixture.client.sessionId]);
      const job = await claim(now + 9 * 3600000);
      assert.ok(job);
      assert.ok(await store.prepareDelivery({ ...job, now: now + 9 * 3600000 }));
      const row = (await connection.query("SELECT expires_at FROM sessions WHERE id = ?", [fixture.client.sessionId]))[0];
      assert.equal(row.expires_at, date(now + 8 * 3600000));
      await assert.rejects(chat.getClientConversation({ tokenHash: fixture.client.tokenHash, now: now + 9 * 3600000 }), errorCode("CHAT_UNAUTHORIZED"));
    });

    await t.test("logout and changed credential epochs make queued notifications ineligible", async () => {
      for (const mutation of ["revoke", "credential", "access", "read", "delete"]) {
        const fixture = await pair(); await subscribe(fixture); const sent = await send(fixture);
        if (mutation === "revoke") await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [date(now), fixture.client.sessionId]);
        if (mutation === "credential") await connection.query("UPDATE client_auth_state SET credential_version = 2 WHERE user_id = ?", [fixture.client.id]);
        if (mutation === "access") await connection.query("UPDATE users SET status = 'revoked' WHERE id = ?", [fixture.client.id]);
        if (mutation === "read") await chat.markRead({ ...chatRequest(fixture, "client"), through: sent.message.sequence });
        if (mutation === "delete") await chat.deleteMessage({ ...chatRequest(fixture), messageId: sent.message.id });
        assert.deepEqual(await store.claimDue({ now }), [], mutation);
        assert.equal((await outbox())[0].status, "skipped");
      }
    });

    await t.test("revocation after claim is rechecked, and status offers reattachment after login", async () => {
      const fixture = await pair(), value = subscription(); await subscribe(fixture, "client", value); await send(fixture);
      const job = await claim();
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [date(now), fixture.client.sessionId]);
      fixture.client = await session(fixture.client);
      assert.equal((await store.status({ ...actor(fixture), endpointDigest: endpointDigest(value.endpoint, key) })).currentId, null);
      assert.equal(await store.prepareDelivery({ ...job, now }), null);
      await subscribe(fixture, "client", value);
      assert.equal(Number((await connection.query("SELECT generation FROM push_subscriptions WHERE user_id = ?", [fixture.client.id]))[0].generation), 2);
    });

    await t.test("revoking one device leaves another independently connected device eligible", async () => {
      const fixture = await pair(), firstValue = subscription(), secondValue = subscription();
      await subscribe(fixture, "client", firstValue);
      const otherDevice = { ...fixture, client: await session(fixture.client) };
      await subscribe(otherDevice, "client", secondValue);
      await send(fixture);
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [date(now), fixture.client.sessionId]);
      const jobs = await store.claimDue({ now }); assert.equal(jobs.length, 1);
      const delivery = await store.prepareDelivery({ ...jobs[0], now });
      assert.equal(delivery.subscription.endpoint, secondValue.endpoint);
      assert.equal((await outbox()).filter((row) => row.status === "skipped").length, 1);
    });

    await t.test("administrator MFA epoch changes block old push even after its session proof is updated", async () => {
      const fixture = await pair(), value = subscription(); await subscribe(fixture, "admin", value); await send(fixture, "client");
      await connection.query("UPDATE admin_mfa SET version = 2 WHERE user_id = ?", [fixture.admin.id]);
      await connection.query("UPDATE auth_session_state SET mfa_version = 2 WHERE session_id = ?", [fixture.admin.sessionId]);
      assert.deepEqual(await store.claimDue({ now }), []);
      assert.equal((await store.status({ ...actor(fixture, "admin"), endpointDigest: endpointDigest(value.endpoint, key) })).currentId, null);
    });

    await t.test("a new subscription generation cannot receive an older job", async () => {
      const fixture = await pair(), value = subscription(), item = await subscribe(fixture, "client", value);
      await send(fixture); const job = await claim();
      await store.disable({ ...actor(fixture), id: Buffer.from(item.id, "hex") });
      await subscribe(fixture, "client", value);
      assert.equal(await store.prepareDelivery({ ...job, now }), null);
      assert.equal((await outbox())[0].status, "skipped");
    });

    await t.test("leases are exclusive, stale acknowledgements fail, and unstarted release restores its attempt", async () => {
      const fixture = await pair(); await subscribe(fixture); await send(fixture);
      const [left, right] = await Promise.all([store.claimDue({ now, limit: 1 }), store.claimDue({ now, limit: 1 })]);
      assert.equal(left.length + right.length, 1);
      const original = [...left, ...right][0];
      assert.equal(await store.settleDelivery({ ...original, now, result: { status: "release", nextAttemptAt: now } }), true);
      assert.equal(Number((await outbox())[0].attempts), 0);
      const claimed = await claim(); assert.equal(claimed.attempts, 1);
      const recovered = await claim(now + 90000); assert.equal(recovered.attempts, 2);
      assert.equal(await store.settleDelivery({ ...claimed, now: now + 90000, result: { status: "accepted" } }), false);
      assert.equal(await store.settleDelivery({ ...recovered, now: now + 90000, result: { status: "accepted" } }), true);
    });

    await t.test("retry reaches six attempts and never silently resets its delivery budget", async () => {
      const fixture = await pair(); await subscribe(fixture); await send(fixture);
      for (let index = 0; index < 6; index += 1) {
        const at = now + index * 1000, job = await claim(at);
        assert.equal(job.attempts, index + 1);
        await store.settleDelivery({ ...job, now: at, result: { status: "retry", nextAttemptAt: at + 1000 } });
      }
      const row = (await outbox())[0]; assert.equal(row.status, "failed"); assert.equal(Number(row.attempts), 6);
      assert.deepEqual(await store.claimDue({ now: now + 7000 }), []);
    });

    await t.test("gone subscriptions are disabled and future SQL microseconds are not treated as current", async () => {
      const fixture = await pair(), item = await subscribe(fixture); await send(fixture);
      const job = await claim(); await store.settleDelivery({ ...job, now, result: { status: "invalid_subscription" } });
      assert.equal(Number((await connection.query("SELECT enabled FROM push_subscriptions WHERE id = ?", [Buffer.from(item.id, "hex")]))[0].enabled), 0);
      await subscribe(fixture); await send(fixture);
      await connection.query("UPDATE push_subscriptions SET updated_at = ? WHERE user_id = ? AND enabled = 1", [date(now).slice(0, -1) + "1", fixture.client.id]);
      assert.deepEqual(await store.claimDue({ now }), []);
      assert.ok((await outbox()).every((row) => row.status === "skipped"));
    });

    await t.test("active subscription ceiling and cleanup are bounded without deleting pending jobs", async () => {
      const fixture = await pair();
      for (let index = 0; index < 16; index += 1) await subscribe(fixture);
      await assert.rejects(subscribe(fixture), errorCode("NOTIFICATIONS_LIMIT"));
      await send(fixture);
      const jobs = await store.claimDue({ now, limit: 2 });
      for (const job of jobs) await store.settleDelivery({ ...job, now, result: { status: "accepted" } });
      const old = now - 32 * 86400000;
      await connection.query("UPDATE push_outbox SET created_at = ?, available_at = ?, expires_at = ?, finished_at = ? WHERE status = 'accepted'", [date(old), date(old), date(old + 86400000), date(old + 1000)]);
      assert.deepEqual(await store.cleanup({ now, limit: 1 }), { removed: 1 });
      assert.equal((await outbox()).filter((row) => row.status === "pending").length, 14);
      assert.deepEqual(await store.cleanup({ now }), { removed: 1 });
      assert.equal((await outbox()).length, 14);
    });

    await t.test("expired browser subscriptions do not permanently fill all device slots", async () => {
      const fixture = await pair();
      for (let index = 0; index < 16; index += 1) await subscribe(fixture, "client", { ...subscription(), expirationTime: now + 1 });
      const item = await subscribe(fixture, "client", subscription(), { now: now + 2 });
      assert.equal(item.enabled, true);
      const rows = await connection.query("SELECT enabled FROM push_subscriptions WHERE user_id = ?", [fixture.client.id]);
      assert.equal(rows.filter((row) => Number(row.enabled) === 1).length, 1);
      assert.equal(rows.length, 17);
    });

    await t.test("the configured HTTP runtime uses schema thirty with notifications enabled or disabled and no external delivery", { timeout: 15000 }, async () => {
      assert.equal(migrations.length, 30);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM schema_migrations WHERE state = 'applied'"))[0].count), 30);
      const fixture = await pair(), raw = { admin: newToken(), client: newToken() };
      for (const role of ["admin", "client"]) {
        fixture[role].tokenHash = tokenDigest(raw[role]);
        await connection.query("UPDATE sessions SET token_hash = ? WHERE id = ?", [fixture[role].tokenHash, fixture[role].sessionId]);
      }
      const vapid = createECDH("prime256v1"); vapid.setPrivateKey(Buffer.alloc(32, 7));
      const origin = "https://synthetic-notifications.jessiemessage.com";
      const environment = {
        ...process.env,
        ...Object.fromEntries(["AUTH", "ACCESS", "CHAT", "MAIL_DELIVERY"].map(name => [`JESSIEMESSAGE_ENABLE_${name}`, "1"])),
        ...Object.fromEntries(["MEDIA", "CRM", "CLIENT_RECOVERY", "BROADCAST"].map(name => [`JESSIEMESSAGE_ENABLE_${name}`, "0"])),
        JESSIEMESSAGE_SITE_ORIGIN: origin,
        ...Object.fromEntries(["MFA", "MAIL", "MESSAGE", "NOTIFICATIONS"].map((name, index) => [`JESSIEMESSAGE_${name}_KEY`, Buffer.alloc(32, index + 20).toString("base64url")])),
        JESSIEMESSAGE_SMTP_HOST: "smtp.synthetic.invalid", JESSIEMESSAGE_SMTP_PORT: "587",
        JESSIEMESSAGE_SMTP_USER: "synthetic-notifications-user", JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-notifications-password",
        JESSIEMESSAGE_VAPID_PUBLIC_KEY: vapid.getPublicKey().toString("base64url"),
        JESSIEMESSAGE_VAPID_PRIVATE_KEY: vapid.getPrivateKey().toString("base64url"),
        JESSIEMESSAGE_VAPID_SUBJECT: "mailto:contact@jessiemessage.com",
      };
      const ownHeaders = (role = "client") => ({ Cookie: `${role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${raw[role]}` });
      const mutationHeaders = (role = "client") => ({ ...ownHeaders(role), Origin: origin,
        "Content-Type": "application/json", "X-CSRF-Token": csrfToken(raw[role]) });
      const privateFields = body => assert.doesNotMatch(JSON.stringify(body), /endpoint|p256dh|ciphertext|privateKey|smtp|tokenHash/);
      for (const enabled of [false, true]) {
        const configured = await createConfiguredServer({ ...environment, JESSIEMESSAGE_ENABLE_NOTIFICATIONS: enabled ? "1" : "0" }, { clock: () => now });
        try {
          // The real index skips its listening callback after stop(). Therefore
          // neither SMTP nor push delivery can start, even with pending rows.
          await configured.mailWorker.stop();
          await new Promise((resolve) => configured.server.listen(0, "127.0.0.1", resolve));
          const base = `http://127.0.0.1:${configured.server.address().port}`;
          const api = "/api/notifications/client";
          const post = (path, body, role = "client", extra = {}) => fetch(`${base}${path}`, { method: "POST",
            headers: { ...mutationHeaders(role), ...extra }, body: JSON.stringify(body) });
          const anonymous = await fetch(`${base}${api}/capabilities`);
          assert.equal(anonymous.status, enabled ? 401 : 404); await anonymous.arrayBuffer();
          const worker = await fetch(`${base}/sw.js`);
          assert.equal(worker.status, enabled ? 200 : 404); assert.equal(worker.headers.get("cache-control"), "no-store");
          if (enabled) assert.equal(worker.headers.get("service-worker-allowed"), "/");
          await worker.arrayBuffer();
          const capabilities = await fetch(`${base}${api}/capabilities`, { headers: ownHeaders() });
          assert.equal(capabilities.status, enabled ? 200 : 404);
          if (enabled) {
            const body = await capabilities.json(); assert.equal(body.enabled, true);
            assert.equal(body.vapidPublicKey, environment.JESSIEMESSAGE_VAPID_PUBLIC_KEY); assert.deepEqual(body.subscriptions, []); privateFields(body);
          } else await capabilities.arrayBuffer();
          const value = subscription();
          const body = { subscription: value, language: "fr" };
          if (enabled) {
            const badCsrf = await post(`${api}/subscription`, body, "client", { "X-CSRF-Token": "A".repeat(43) });
            assert.equal(badCsrf.status, 403); assert.deepEqual(await badCsrf.json(), { error: "csrf_failed" });
          }
          const registered = await post(`${api}/subscription`, body);
          assert.equal(registered.status, enabled ? 200 : 405);
          let saved;
          if (enabled) {
            saved = await registered.json(); assert.equal(saved.enabled, true); assert.match(saved.subscriptionId, /^[a-f0-9]{32}$/); privateFields(saved);
            const status = await post(`${api}/status`, { endpoint: value.endpoint });
            assert.equal(status.status, 200); assert.deepEqual(await status.json(), saved);
            const conflict = await post("/api/notifications/admin/subscription", body, "admin");
            assert.equal(conflict.status, 409); assert.deepEqual(await conflict.json(), { error: "subscription_conflict" });
          } else await registered.arrayBuffer();
          const message = await post(`/api/chat/admin/conversations/${fixture.conversationId.toString("hex")}/messages`,
            { clientMessageId: id().toString("hex"), body: "Fictional configured runtime message" }, "admin");
          assert.equal(message.status, 201); assert.equal((await message.json()).duplicate, false);
          const jobs = await outbox(); assert.equal(jobs.length, enabled ? 1 : 0);
          if (enabled) {
            assert.equal(jobs[0].status, "pending"); assert.equal(Number(jobs[0].attempts), 0);
            const disabled = await post(`${api}/disable`, { id: saved.subscriptionId });
            assert.equal(disabled.status, 200); assert.deepEqual(await disabled.json(), { enabled: false });
            const status = await post(`${api}/status`, { endpoint: value.endpoint });
            assert.deepEqual(await status.json(), { enabled: false, subscriptionId: null });
          }
        } finally {
          configured.server.closeAllConnections();
          await new Promise((resolve, reject) => configured.server.close(error => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve()));
          await configured.mailWorker.close();
          await configured.diagnostics.close();
          await configured.pool.end();
        }
      }
    });
  } finally { await pool?.end(); await reset(); await connection.end(); }
});
