import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { createMediaCapacityStore } from "../server/media/capacity-store.mjs";
import { createConfiguredServer } from "../server/index.mjs";
import { checkMessagingSchema } from "../scripts/start-private-messaging.mjs";
import { newToken, tokenDigest, csrfToken } from "../server/auth/crypto.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";

const primary = "https://jessiemessage.com", recipe = "https://recette.jessiemessage.com";
const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1", id = () => randomBytes(16);
const date = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");

function request(port, origin, path, { method = "GET", body, cookie, csrf, extra = {} } = {}) {
  return new Promise((resolveRequest, reject) => {
    const wire = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ host: "127.0.0.1", port, path, method, agent: false,
      headers: { Host: new URL(origin).host, ...(cookie ? { Cookie: cookie } : {}),
        ...(method === "POST" ? { Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1" } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}), ...extra } }, response => {
      const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("error", reject);
      response.once("end", () => resolveRequest({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString(),
        json() { return JSON.parse(this.text); } }));
    }); req.once("error", reject); req.end(wire);
  });
}
const cookieValue = (result, prefix) => result.headers["set-cookie"]?.find(value => value.startsWith(`${prefix}=`))?.split(";", 1)[0];

test("the real dual-origin runtime shares schema thirty, source sessions, encrypted notifications and invitation policy (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 120000,
}, async t => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  const migrations = await loadMigrations(); assert.equal(migrations.length, 30);
  const allowed = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let bootstrapPool, runtime, mediaRoot;
  async function closeRuntime() {
    if (!runtime) return;
    runtime.server.closeAllConnections();
    await new Promise(resolveRequest => runtime.server.close(() => resolveRequest()));
    await runtime.mailWorker?.close(); await runtime.diagnostics?.close(); await runtime.pool?.end();
    runtime = null;
  }
  // Deliberately differ from wall time: both entries must use the runtime clock.
  const now = Date.UTC(2024, 0, 1), raw = { admin: newToken(), client: newToken() }, users = { admin: id(), client: id() };
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every(table => allowed.includes(table.name)), "unrelated tables forbid cleanup");
    for (const name of allowed) await connection.query(`DROP TABLE IF EXISTS ${name}`);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations });
    const parent = resolve("../audit"); await mkdir(parent, { recursive: true, mode: 0o700 });
    mediaRoot = await mkdtemp(`${parent}/device-transition-runtime-`); await chmod(mediaRoot, 0o700);
    const mediaKey = Buffer.alloc(32, 24), capacity = { ownerBytes: 1048576, totalBytes: 2097152 };
    const storage = await createMediaStorage({ root: mediaRoot, key: mediaKey });
    bootstrapPool = await createRuntimePool(process.env);
    await createMediaCapacityStore({ pool: bootstrapPool, capacity: { ...capacity, rootFingerprint: await storage.fingerprint() } }).initialize({ now, offline: true });
    await bootstrapPool.end(); bootstrapPool = null;
    for (const role of ["admin", "client"]) {
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at, access_approved_at, created_at, updated_at)
        VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?)`,
      [users[role], role, `Synthetic ${role}`, `device-transition-${role}@example.invalid`, role === "client" ? date(now) : null,
        role === "client" ? date(now) : null, date(now), date(now)]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic-secret', 1, 1, ?)", [users[role], date(now)]);
      else {
        await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [users[role], date(now)]);
        await consumeSyntheticInvitation(connection, users[role], now);
      }
      const sessionId = id();
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        [sessionId, users[role], tokenDigest(raw[role]), date(now), date(now + 86400000)]);
      if (role === "admin") await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [sessionId, date(now), date(now)]);
      else await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", [sessionId, date(now)]);
    }
    const conversationId = id();
    await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [conversationId, users.client, users.admin, date(now)]);
    const vapid = createECDH("prime256v1"); vapid.setPrivateKey(Buffer.alloc(32, 7));
    const env = { ...process.env, JESSIEMESSAGE_SITE_ORIGIN: primary,
      ...Object.fromEntries(["AUTH", "ACCESS", "CHAT", "MAIL_DELIVERY", "MEDIA", "NOTIFICATIONS"].map(name => [`JESSIEMESSAGE_ENABLE_${name}`, "1"])),
      ...Object.fromEntries(["CRM", "CLIENT_RECOVERY", "BROADCAST"].map(name => [`JESSIEMESSAGE_ENABLE_${name}`, "0"])),
      ...Object.fromEntries(["MFA", "MAIL", "MESSAGE", "NOTIFICATIONS"].map((name, index) => [`JESSIEMESSAGE_${name}_KEY`, Buffer.alloc(32, index + 20).toString("base64url")])),
      JESSIEMESSAGE_MEDIA_KEY: mediaKey.toString("base64url"), JESSIEMESSAGE_MEDIA_ROOT: mediaRoot,
      JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES: String(capacity.ownerBytes), JESSIEMESSAGE_MEDIA_TOTAL_BYTES: String(capacity.totalBytes), JESSIEMESSAGE_MEDIA_MIN_FREE_BYTES: "0",
      JESSIEMESSAGE_SMTP_HOST: "smtp.synthetic.invalid", JESSIEMESSAGE_SMTP_PORT: "587", JESSIEMESSAGE_SMTP_USER: "synthetic-user", JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-password",
      JESSIEMESSAGE_VAPID_PUBLIC_KEY: vapid.getPublicKey().toString("base64url"), JESSIEMESSAGE_VAPID_PRIVATE_KEY: vapid.getPrivateKey().toString("base64url"),
      JESSIEMESSAGE_VAPID_SUBJECT: "mailto:contact@jessiemessage.com" };
    runtime = await createConfiguredServer(env, { requestOrigin: primary, deviceTransition: true, clock: () => now });
    // Exercise the real configuration without sending SMTP or Push externally.
    // stop() also prevents the one listening callback from starting producers.
    await runtime.mailWorker.stop();
    // Node itself registers setupConnectionsTracking on every HTTP server.
    // Compare actual callback references with a neutral server so only the
    // application's producer-start callback is counted, regardless of native listeners.
    const nativeListening = new Set(createHttpServer().listeners("listening"));
    const producerStarts = runtime.server.listeners("listening").filter(callback => !nativeListening.has(callback));
    assert.equal(producerStarts.length, 1);
    await new Promise(resolveRequest => runtime.server.listen(0, "127.0.0.1", resolveRequest));
    assert.ok(producerStarts.every(callback => !runtime.server.listeners("listening").includes(callback)), "the one producer callback is consumed on the first listen");
    const port = runtime.server.address().port;
    const cookie = role => `${role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${raw[role]}`;

    await t.test("both source roles and both authorities reach the same current SQL sessions without changing cookies or account gates", async () => {
      for (const origin of [primary, recipe]) {
        const entry = await request(port, origin, "/api/entry", { cookie: `${cookie("admin")}; ${cookie("client")}` });
        assert.equal(entry.status, 200);
        assert.deepEqual(entry.json().administrator, { state: "connected", href: "/admin/messages" });
        assert.deepEqual(entry.json().client, { state: "active", href: "/messages" });
        for (const role of ["admin", "client"]) {
          const response = await request(port, origin, role === "admin" ? "/api/auth/session" : "/api/access/session", { cookie: cookie(role) });
          assert.equal(response.status, 200); assert.equal(response.json().user.id, users[role].toString("hex"));
          assert.match(response.headers["set-cookie"][0], /Secure; HttpOnly; SameSite=Strict/);
        }
        const sw = await request(port, origin, "/sw.js"); assert.equal(sw.status, 200); assert.equal(sw.headers["service-worker-allowed"], "/");
      }
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS n FROM sessions"))[0].n), 2);
    });

    await t.test("each invitation uses its actual handler origin while cross-origin normal writes remain denied", async () => {
      for (const origin of [primary, recipe]) {
        const response = await request(port, origin, "/api/admin/invitations", { method: "POST", body: { lifetimeHours: 24, accessDays: 30 }, cookie: cookie("admin"), csrf: csrfToken(raw.admin) });
        assert.equal(response.status, 201); assert.ok(response.json().url.startsWith(`${origin}/access#invitation=`));
        const wrong = await request(port, origin, "/api/admin/invitations", { method: "POST", body: { lifetimeHours: 24, accessDays: 30 }, cookie: cookie("admin"), csrf: csrfToken(raw.admin), extra: { Origin: origin === primary ? recipe : primary } });
        assert.equal(wrong.status, 403);
      }
      assert.equal((await request(port, "https://www.jessiemessage.com", "/api/auth/session", { cookie: cookie("admin") })).status, 421);
    });

    await t.test("one bridge carries either role into the primary host and keeps its source session usable", async () => {
      for (const role of ["admin", "client"]) {
        const api = `/api/device-transition/${role}`;
        const begin = await request(port, primary, `${api}/begin`, { method: "POST", body: { notification: null } });
        assert.equal(begin.status, 200); const nonce = cookieValue(begin, `__Host-jessie_transition_${role}`); assert.ok(nonce);
        const authorize = await request(port, recipe, `${api}/authorize`, { method: "POST", cookie: cookie(role), csrf: csrfToken(raw[role]), body: { challenge: begin.json().challenge } });
        assert.equal(authorize.status, 200); assert.ok(authorize.json().ticket);
        const complete = await request(port, primary, `${api}/complete`, { method: "POST", cookie: nonce, body: { ticket: authorize.json().ticket } });
        assert.equal(complete.status, 200); assert.equal(complete.json().keptExisting, false);
        const destinationCookie = cookieValue(complete, role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client");
        assert.equal(destinationCookie, cookie(role));
        const path = role === "admin" ? "/api/auth/session" : "/api/access/session";
        assert.equal((await request(port, primary, path, { cookie: destinationCookie })).status, 200);
        assert.equal((await request(port, recipe, path, { cookie: cookie(role) })).status, 200);
        const replay = await request(port, primary, `${api}/complete`, { method: "POST", cookie: nonce, body: { ticket: authorize.json().ticket } }); assert.equal(replay.status, 400);
      }
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL"))[0].n), 2);
    });

    await t.test("legacy subscription and primary message share one encrypted outbox without producer duplication", async () => {
      const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
      const subscription = { endpoint: `https://fcm.googleapis.com/wp/synthetic-${id().toString("hex")}`, expirationTime: null,
        keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
      const saved = await request(port, recipe, "/api/notifications/client/subscription", { method: "POST", cookie: cookie("client"), csrf: csrfToken(raw.client), body: { subscription, language: "fr" } });
      assert.equal(saved.status, 200);
      const message = await request(port, primary, `/api/chat/admin/conversations/${conversationId.toString("hex")}/messages`, { method: "POST", cookie: cookie("admin"), csrf: csrfToken(raw.admin),
        body: { clientMessageId: id().toString("hex"), body: "Synthetic device transition message" } });
      assert.equal(message.status, 201);
      const rows = await connection.query("SELECT status, attempts FROM push_outbox"); assert.equal(rows.length, 1); assert.equal(rows[0].status, "pending"); assert.equal(Number(rows[0].attempts), 0);
      const stored = (await connection.query("SELECT subscription_encrypted FROM push_subscriptions"))[0]; assert.ok(!stored.subscription_encrypted.includes(subscription.endpoint));
      const current = await request(port, primary, "/api/notifications/client/status", { method: "POST", cookie: cookie("client"), csrf: csrfToken(raw.client), body: { endpoint: subscription.endpoint } });
      assert.equal(current.status, 200); assert.equal(current.json().subscriptionId, saved.json().subscriptionId);
    });

    await t.test("the existing deployed profile offers no recovery routes on either authority", async () => {
      for (const origin of [primary, recipe]) for (const path of ["/recover", "/api/access/recovery/capabilities"]) {
        assert.equal((await request(port, origin, path)).status, 404);
      }
    });

    await closeRuntime();
    const recoveryEnv = { ...env, JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "1" };
    const credentials = async () => ({
      versions: await connection.query("SELECT user_id, credential_version FROM client_auth_state ORDER BY user_id"),
      sessions: await connection.query("SELECT id, user_id, token_hash, revoked_at FROM sessions ORDER BY id"),
      passwords: await connection.query("SELECT id, password_hash FROM users ORDER BY id"),
    });
    const credentialsBefore = await credentials();

    await t.test("recovery schema preflight reads both physical tables without starting services or changing credentials", async () => {
      await checkMessagingSchema(recoveryEnv);
      for (const table of ["client_password_resets", "password_reset_outbox"]) {
        await connection.query(`RENAME TABLE ${table} TO migration_probe`);
        try { await assert.rejects(checkMessagingSchema(recoveryEnv), { code: "PRIVATE_MESSAGING_SCHEMA" }); }
        finally { await connection.query(`RENAME TABLE migration_probe TO ${table}`); }
      }
      await checkMessagingSchema(recoveryEnv);
      assert.deepEqual(await credentials(), credentialsBefore);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS n FROM client_password_resets"))[0].n), 0);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS n FROM password_reset_outbox"))[0].n), 0);
    });

    runtime = await createConfiguredServer(recoveryEnv, { requestOrigin: primary, deviceTransition: true, recovery: true, clock: () => now });
    // Full store/service/transport factories have run; delivery is then stopped
    // before listening so this disposable rehearsal never sends SMTP or Push.
    await runtime.mailWorker.stop();
    assert.equal(runtime.server.listeners("listening").filter(callback => !nativeListening.has(callback)).length, 1);
    assert.deepEqual(await credentials(), credentialsBefore, "feature activation alone cannot revoke sessions or change passwords");
    await new Promise(resolveRequest => runtime.server.listen(0, "127.0.0.1", resolveRequest));
    const recoveryPort = runtime.server.address().port;

    await t.test("recovery is available only at the primary authority while both ordinary sessions remain connected", async () => {
      for (const path of ["/recover", "/recover.js", "/recover-model.js", "/recover.css", "/api/access/recovery/capabilities"]) {
        const active = await request(recoveryPort, primary, path), legacy = await request(recoveryPort, recipe, path);
        assert.equal(active.status, 200); assert.equal(active.headers["cache-control"], "no-store");
        assert.equal(legacy.status, 404);
      }
      for (const origin of [primary, recipe]) {
        for (const role of ["admin", "client"]) {
          assert.equal((await request(recoveryPort, origin, role === "admin" ? "/api/auth/session" : "/api/access/session", { cookie: cookie(role) })).status, 200);
        }
        const readiness = await request(recoveryPort, origin, "/api/admin/readiness", { cookie: cookie("admin") });
        assert.equal(readiness.status, 200); assert.equal(readiness.json().features.passwordRecovery, origin === primary);
        assert.equal(readiness.json().features.clientFiles, false); assert.equal(readiness.json().features.broadcasts, false);
        assert.deepEqual(readiness.json().operations.workers.map(worker => worker.name).sort(), ["notifications", "recovery", "verification"]);
      }
      assert.deepEqual(await credentials(), credentialsBefore);
    });

    await t.test("requests queue only eligible client mail and never change either role's passwords, versions or sessions", async () => {
      const path = "/api/access/recovery/request", email = "device-transition-client@example.invalid";
      const rejected = await request(recoveryPort, primary, path, { method: "POST", body: { email }, extra: { Origin: recipe } });
      assert.equal(rejected.status, 403);
      const legacy = await request(recoveryPort, recipe, path, { method: "POST", body: { email } });
      assert.equal(legacy.status, 405);
      for (const candidate of ["device-transition-admin@example.invalid", "unknown@example.invalid", email]) {
        const response = await request(recoveryPort, primary, path, { method: "POST", body: { email: candidate }, cookie: `${cookie("admin")}; ${cookie("client")}` });
        assert.equal(response.status, 202); assert.deepEqual(response.json(), { status: "accepted" });
        assert.equal(response.headers["set-cookie"], undefined);
      }
      assert.deepEqual(await credentials(), credentialsBefore);
      const resets = await connection.query("SELECT user_id, credential_version, created_at, expires_at, consumed_at, revoked_at FROM client_password_resets");
      assert.equal(resets.length, 1); assert.deepEqual(resets[0].user_id, users.client);
      assert.equal(Number(resets[0].credential_version), 1); assert.equal(resets[0].consumed_at, null); assert.equal(resets[0].revoked_at, null);
      const storedTime = value => value instanceof Date ? value.getTime() : Date.parse(`${value.replace(" ", "T")}Z`);
      assert.equal(storedTime(resets[0].created_at), now); assert.equal(storedTime(resets[0].expires_at), now + 1800000);
      const jobs = await connection.query("SELECT recipient_user_id, payload_encrypted, status, attempts FROM password_reset_outbox");
      assert.equal(jobs.length, 1); assert.deepEqual(jobs[0].recipient_user_id, users.client);
      assert.equal(jobs[0].status, "pending"); assert.equal(Number(jobs[0].attempts), 0);
      assert.ok(!jobs[0].payload_encrypted.includes(email));
    });

    await closeRuntime();
    runtime = await createConfiguredServer(env, { requestOrigin: primary, deviceTransition: true, clock: () => now });
    await runtime.mailWorker.stop();
    await new Promise(resolveRequest => runtime.server.listen(0, "127.0.0.1", resolveRequest));
    await t.test("disabling recovery leaves queued data intact and preserves both authority sessions", async () => {
      const rollbackPort = runtime.server.address().port;
      for (const origin of [primary, recipe]) {
        assert.equal((await request(rollbackPort, origin, "/api/access/recovery/capabilities")).status, 404);
        for (const role of ["admin", "client"]) {
          assert.equal((await request(rollbackPort, origin, role === "admin" ? "/api/auth/session" : "/api/access/session", { cookie: cookie(role) })).status, 200);
        }
      }
      assert.deepEqual(await credentials(), credentialsBefore);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS n FROM client_password_resets"))[0].n), 1);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS n FROM password_reset_outbox WHERE status = 'pending'"))[0].n), 1);
    });
  } finally {
    await closeRuntime();
    await bootstrapPool?.end(); await reset(); await connection.end();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  }
});
