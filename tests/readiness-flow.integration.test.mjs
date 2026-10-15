import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createAuthService } from "../server/auth/service.mjs";
import { createAuthHandler } from "../server/auth/http.mjs";
import { createReadinessService } from "../server/readiness/service.mjs";
import { createReadinessHandler } from "../server/readiness/http.mjs";
import { mailConfiguration } from "../server/mail/config.mjs";
import { createAppServer } from "../server/index.mjs";
import { createRecoveryCodes, hashPassword, makeTotpSecret, newToken, recoveryCodeDigest,
  sealTotpSecret, tokenDigest, totpCode } from "../server/auth/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("administrator readiness with real SQL MFA, private HTTP and fake verification-only SMTP (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 120000,
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
  const waiting = [];
  async function cleanup() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await cleanup();
    await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const authStore = createAuthStore(pool);
    assert.equal(await authStore.assertSchema(), true);
    let now = Date.now();
    const clock = () => now;
    const key = randomBytes(32);
    const origin = "https://jessiemessage.com";
    const password = "Synthetic readiness administrator password 2026!";
    const admin = { id: randomBytes(16), email: "readiness-admin@example.invalid", secret: makeTotpSecret() };
    const passwordHash = await hashPassword(password);
    await authStore.initializeAdmin({ id: admin.id, email: admin.email, pseudonym: "Synthetic readiness administrator",
      passwordHash, secretEncrypted: sealTotpSecret(admin.secret, key, admin.id),
      recoveryDigests: createRecoveryCodes().map(recoveryCodeDigest), now });
    const client = { id: randomBytes(16), sessionId: randomBytes(16), token: newToken() };
    // Independent disposable SQL fixtures model a client cookie; they cannot
    // create an administrator MFA proof or imply a real age assurance check.
    await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, created_at, updated_at)
      VALUES (?, 'client', 'pending', 'Synthetic readiness client', 'readiness-client@example.invalid', ?, ?, ?)`,
    [client.id, passwordHash, sqlDate(now), sqlDate(now)]);
    await connection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [client.id, sqlDate(now)]);
    await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      [client.sessionId, client.id, tokenDigest(client.token), sqlDate(now), sqlDate(now + 8 * 3600000)]);
    await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)",
      [client.sessionId, sqlDate(now)]);
    const authService = await createAuthService({ store: authStore, totpKey: key, clock });
    const mailConfig = mailConfiguration({ JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1", JESSIEMESSAGE_SITE_ORIGIN: origin,
      JESSIEMESSAGE_MAIL_KEY: randomBytes(32).toString("base64url"), JESSIEMESSAGE_SMTP_HOST: "smtp-readiness-secret.example.invalid",
      JESSIEMESSAGE_SMTP_PORT: "587", JESSIEMESSAGE_SMTP_USER: "synthetic-private-smtp-user",
      JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-private-smtp-password" });
    const features = { clientAccess: true, chat: true, photos: false, clientFiles: true, passwordRecovery: true, broadcasts: true };
    const transports = [];
    let plan = {};
    let sendCalls = 0;
    const createTransport = (configuration) => {
      assert.equal(configuration.smtp.from, "contact@jessiemessage.com");
      const selected = plan;
      const record = { verifications: 0, closes: 0 };
      transports.push(record);
      return {
        async verify() {
          record.verifications += 1;
          selected.started?.resolve();
          if (selected.wait) await selected.wait.promise;
          if (selected.error) throw selected.error;
          return selected.result ?? true;
        },
        async sendMail() { sendCalls += 1; assert.fail("readiness must never send a message"); },
        async sendVerification() { sendCalls += 1; assert.fail("readiness must never enqueue or deliver mail"); },
        async sendPasswordReset() { sendCalls += 1; assert.fail("readiness must never deliver a recovery message"); },
        close() {
          record.closes += 1;
          if (selected.closeError) throw selected.closeError;
        },
      };
    };
    const makeService = (configuration = mailConfig) => createReadinessService({ authService, authStore,
      mailConfig: configuration, features, key, createTransport, clock });
    let activeReadiness = await makeService();
    const serviceProxy = Object.fromEntries(["actor", "summary", "verifySmtp"].map((name) => [name, (...args) => activeReadiness[name](...args)]));
    server = createAppServer({ authHandler: createAuthHandler(authService, { origin }),
      readinessHandler: createReadinessHandler(serviceProxy, { origin }) });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, { method = "GET", body, rawBody, headers = {} } = {}) {
      const response = await fetch(`${base}${path}`, { method, redirect: "manual",
        headers: { ...(method === "POST" ? { Origin: origin, "Content-Type": "application/json" } : {}), ...headers },
        ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const content = await response.text();
      let value;
      try { value = JSON.parse(content); } catch { value = content; }
      return { status: response.status, headers: response.headers, body: value };
    }
    let session;
    const adminHeaders = () => ({ Cookie: session.cookie, "X-CSRF-Token": session.csrf });
    const summary = (headers = adminHeaders()) => request("/api/admin/readiness", { headers });
    const verify = (headers = adminHeaders(), body = {}) => request("/api/admin/readiness/smtp", { method: "POST", headers, body });
    const countMail = async () => {
      const verification = Number((await connection.query("SELECT COUNT(*) AS count FROM mail_outbox"))[0].count);
      const recovery = Number((await connection.query("SELECT COUNT(*) AS count FROM password_reset_outbox"))[0].count);
      return { verification, recovery };
    };
    async function login() {
      const response = await request("/api/auth/login", { method: "POST", headers: { "X-Jessie-Request": "1" },
        body: { email: admin.email, password, factor: totpCode(admin.secret, { now }) } });
      assert.equal(response.status, 200);
      session = { cookie: response.headers.get("set-cookie").split(";")[0], csrf: response.body.csrf };
    }
    async function nextWindow() {
      // Keep the current administrator active inside its 30-minute idle limit,
      // while opening a fresh 15-minute SMTP quota window.
      now += 16 * 60000;
      assert.equal((await summary()).status, 200);
    }

    await t.test("MFA login precedes private assets and metadata-only readiness; ordinary and forged client cookies are denied", async () => {
      const privatePaths = ["/admin/readiness", "/readiness.js", "/readiness-model.js", "/readiness.css", "/api/admin/readiness"];
      for (const headers of [{}, { Cookie: `__Host-jessie_client=${client.token}` },
        { Cookie: `__Host-jessie_session=${client.token}` }, { Cookie: `__Host-jessie_session=${newToken()}` }]) {
        for (const path of privatePaths) {
          const denied = await request(path, { headers });
          assert.equal(denied.status, 401, path);
          assert.deepEqual(denied.body, { error: "authentication_required" });
          assert.match(denied.headers.get("set-cookie"), /^__Host-jessie_session=; /);
          assert.equal(denied.headers.get("set-cookie").includes("__Host-jessie_client"), false);
          assert.match(denied.headers.get("cache-control"), /no-store/);
        }
      }
      assert.equal((await verify({ Cookie: `__Host-jessie_session=${client.token}` })).status, 401);
      assert.equal(transports.length, 0);
      await login();
      for (const path of privatePaths.slice(0, -1)) {
        const response = await request(path, { headers: adminHeaders() });
        assert.equal(response.status, 200, path);
        assert.match(response.headers.get("cache-control"), /no-store/);
        assert.equal((await request(path, { method: "HEAD", headers: adminHeaders() })).status, 200);
      }
      const before = new Set((await connection.query("SELECT HEX(bucket_hash) AS hash FROM auth_rate_limits")).map((row) => row.hash));
      const response = await summary();
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { contactEmail: "contact@jessiemessage.com", mail: { configured: true,
        sender: "contact@jessiemessage.com", replyTo: "contact@jessiemessage.com" }, features,
      checks: { ageAssurance: "pending", smtpDelivery: "not_checked", deviceAcceptance: "pending" } });
      const wire = JSON.stringify(response.body);
      for (const secret of [mailConfig.smtp.host, mailConfig.smtp.user, mailConfig.smtp.password, admin.email, key.toString("base64url"), options.database]) {
        assert.equal(wire.includes(secret), false);
      }
      const added = (await connection.query("SELECT bucket_hash, HEX(bucket_hash) AS hash, attempts FROM auth_rate_limits")).filter((row) => !before.has(row.hash));
      assert.equal(added.length, 2, "global and administrator read budgets are persisted");
      for (const row of added) {
        assert.equal(row.bucket_hash.length, 32);
        assert.equal(row.bucket_hash.equals(tokenDigest(session.cookie.split("=")[1])), false);
        assert.equal(row.hash.toLowerCase().includes(admin.id.toString("hex")), false);
      }
      assert.equal(transports.length, 0, "a readiness inventory must not connect to SMTP");
      assert.deepEqual(await countMail(), { verification: 0, recovery: 0 });
    });

    await t.test("same-origin CSRF and empty action schema reject input before any SMTP transport is created", async () => {
      const before = transports.length;
      assert.equal((await verify({ Cookie: session.cookie })).status, 403);
      assert.equal((await verify({ ...adminHeaders(), Origin: "https://other.invalid" })).status, 403);
      assert.equal((await verify(adminHeaders(), { recipient: "someone@example.invalid" })).status, 400);
      assert.equal((await verify(adminHeaders(), { host: "attacker.invalid", password: "must never be accepted" })).status, 400);
      assert.equal((await request("/api/admin/readiness/smtp?target=ignored", { method: "POST", headers: adminHeaders(), body: {} })).status, 400);
      assert.equal((await request("/api/admin/readiness/smtp", { method: "POST", headers: { Cookie: session.cookie }, rawBody: "{" })).status, 403);
      assert.equal(transports.length, before);
    });

    await t.test("disabled mail gives a private configuration status and never constructs a verification transport", async () => {
      const before = transports.length;
      activeReadiness = await makeService({ enabled: false });
      try {
        const inventory = await summary();
        assert.equal(inventory.status, 200);
        assert.deepEqual(inventory.body.mail, { configured: false, sender: "contact@jessiemessage.com", replyTo: "contact@jessiemessage.com" });
        const result = await verify();
        assert.equal(result.status, 409);
        assert.deepEqual(result.body, { error: "mail_delivery_disabled" });
        assert.equal(transports.length, before);
      } finally { activeReadiness = await makeService(); }
    });

    await t.test("a successful SMTP authentication check closes its dedicated transport and does not promise message delivery", async () => {
      await nextWindow();
      const before = transports.length;
      const response = await verify();
      assert.equal(response.status, 200);
      assert.deepEqual(response.body, { status: "verified", checkedAt: now, scope: "smtp_authentication", delivery: "not_checked" });
      assert.equal(transports.length, before + 1);
      assert.deepEqual(transports.at(-1), { verifications: 1, closes: 1 });
      assert.equal((await summary()).body.checks.smtpDelivery, "not_checked");
      assert.equal(sendCalls, 0);
      assert.deepEqual(await countMail(), { verification: 0, recovery: 0 });
    });

    await t.test("SMTP failures expose a neutral error, always close and release the verifier for a fresh attempt", async () => {
      await nextWindow();
      plan = { error: new Error(`${mailConfig.smtp.host} ${mailConfig.smtp.user} ${mailConfig.smtp.password}`) };
      const failed = await verify();
      assert.equal(failed.status, 502);
      assert.deepEqual(failed.body, { error: "smtp_check_failed" });
      assert.deepEqual(transports.at(-1), { verifications: 1, closes: 1 });
      plan = { result: false };
      const refused = await verify();
      assert.equal(refused.status, 502);
      assert.deepEqual(refused.body, { error: "smtp_check_failed" });
      assert.deepEqual(transports.at(-1), { verifications: 1, closes: 1 });
      plan = {};
      assert.equal((await verify()).status, 200);
      assert.deepEqual(transports.at(-1), { verifications: 1, closes: 1 });
      assert.notEqual(transports.at(-1), transports.at(-2));
    });

    await t.test("concurrent checks share one busy slot and every completed check releases and closes that slot", async () => {
      await nextWindow();
      const started = deferred();
      const wait = deferred();
      waiting.push(wait);
      plan = { started, wait };
      const first = verify();
      await Promise.race([started.promise, first.then((result) => assert.fail(`verification ended before the fake SMTP adapter started (${result.status})`))]);
      const before = transports.length;
      try {
        const busy = await verify();
        assert.equal(busy.status, 429);
        assert.deepEqual(busy.body, { error: "try_again_later" });
        assert.equal(busy.headers.get("retry-after"), "5");
        assert.equal(transports.length, before, "a busy request cannot open a second SMTP connection");
      } finally { wait.resolve(); }
      assert.equal((await first).status, 200);
      assert.deepEqual(transports.at(-1), { verifications: 1, closes: 1 });
      plan = {};
      assert.equal((await verify()).status, 200);
    });

    await t.test("three checks consume the persistent administrator budget across service and store recreation", async () => {
      await nextWindow();
      plan = {};
      const before = transports.length;
      for (let index = 0; index < 3; index += 1) assert.equal((await verify()).status, 200);
      assert.equal(transports.length, before + 3);
      const denied = await verify();
      assert.equal(denied.status, 429);
      assert.deepEqual(denied.body, { error: "try_again_later" });
      assert.ok(Number(denied.headers.get("retry-after")) > 0);
      activeReadiness = await createReadinessService({ authService, authStore: createAuthStore(pool), mailConfig, features, key, createTransport, clock });
      assert.equal((await verify()).status, 429);
      assert.equal(transports.length, before + 3, "service recreation cannot reset the SQL quota");
      const rows = await connection.query("SELECT bucket_hash, attempts FROM auth_rate_limits");
      assert.ok(rows.some((row) => Number(row.attempts) >= 4));
      assert.ok(rows.every((row) => Buffer.isBuffer(row.bucket_hash) && row.bucket_hash.length === 32));
      assert.equal(sendCalls, 0);
    });

    await t.test("administrator revocation during a pending SMTP check prevents a stale proof and still closes the transport", async () => {
      await nextWindow();
      const started = deferred();
      const wait = deferred();
      waiting.push(wait);
      plan = { started, wait };
      const pending = verify();
      await Promise.race([started.promise, pending.then((result) => assert.fail(`verification ended before the fake SMTP adapter started (${result.status})`))]);
      try {
        const logout = await request("/api/auth/logout-all", { method: "POST", headers: adminHeaders(), body: {} });
        assert.equal(logout.status, 200);
      } finally { wait.resolve(); }
      const response = await pending;
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, { error: "authentication_required" });
      assert.match(response.headers.get("set-cookie"), /^__Host-jessie_session=; /);
      assert.deepEqual(transports.at(-1), { verifications: 1, closes: 1 });
      assert.equal((await summary()).status, 401);
      assert.equal((await verify()).status, 401);
      plan = {};
    });

    await t.test("a later MFA version change immediately denies existing administrator inventory and private assets", async () => {
      now += 30000;
      await login();
      assert.equal((await summary()).status, 200);
      await connection.query("UPDATE admin_mfa SET version = version + 1 WHERE user_id = ?", [admin.id]);
      const before = transports.length;
      for (const path of ["/api/admin/readiness", "/admin/readiness", "/readiness.js", "/readiness-model.js", "/readiness.css"]) {
        assert.equal((await request(path, { headers: adminHeaders() })).status, 401, path);
      }
      assert.equal((await verify()).status, 401);
      assert.equal(transports.length, before);
      assert.equal(sendCalls, 0);
      assert.deepEqual(await countMail(), { verification: 0, recovery: 0 });
    });
  } finally {
    for (const wait of waiting) wait.resolve();
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    try { if (pool) await pool.end(); }
    finally { try { await cleanup(); } finally { await connection.end(); } }
  }
});
