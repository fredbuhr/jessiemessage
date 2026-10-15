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
import { createResetStore } from "../server/reset/store.mjs";
import { createResetMailStore } from "../server/reset/mail-store.mjs";
import { createResetService } from "../server/reset/service.mjs";
import { createResetHandler } from "../server/reset/http.mjs";
import { openResetPayload, sealResetPayload } from "../server/reset/mail-crypto.mjs";
import { openVerificationPayload, sealVerificationPayload } from "../server/mail/crypto.mjs";
import { runMailBatch } from "../server/mail/worker.mjs";
import { createAppServer } from "../server/index.mjs";
import { createRecoveryCodes, hashPassword, makeTotpSecret, newToken, recoveryCodeDigest,
  sealTotpSecret, tokenDigest, totpCode, verifyPassword } from "../server/auth/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const hex = (value) => value.toString("hex");

test("real HTTP client recovery, encrypted mail, single use and unchanged access gates (synthetic disposable database only)", {
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
    const accessStore = createAccessStore(pool);
    const chatStore = createChatStore(pool);
    const resetStore = createResetStore(pool);
    const resetMailStore = createResetMailStore(pool);
    for (const store of [authStore, accessStore, chatStore, resetStore, resetMailStore]) assert.equal(await store.assertSchema(), true);
    let now = Date.now();
    const clock = () => now;
    const totpKey = randomBytes(32);
    const mailKey = randomBytes(32);
    const origin = "https://example.invalid";
    const admin = { id: randomBytes(16), email: "reset-flow-admin@example.invalid", secret: makeTotpSecret() };
    const adminPassword = "Synthetic recovery administrator password 2026!";
    const originalPassword = "  Synthetic original client password 2026!  ";
    const newPassword = "  Synthetic changed client password 2026!  ";
    const alternatePassword = "Synthetic racing client password 2026!";
    await authStore.initializeAdmin({ id: admin.id, email: admin.email, pseudonym: "Synthetic recovery administrator",
      passwordHash: await hashPassword(adminPassword), secretEncrypted: sealTotpSecret(admin.secret, totpKey, admin.id),
      recoveryDigests: createRecoveryCodes().map(recoveryCodeDigest), now });
    const originalHash = await hashPassword(originalPassword);
    const clients = Object.fromEntries(["active", "pending", "expired", "unverified", "suspended", "revoked", "deleted", "revokeLater", "emailLater"].map((kind) =>
      [kind, { id: randomBytes(16), conversationId: randomBytes(16), email: `reset-flow-${kind.toLowerCase()}@example.invalid`, kind }]));
    // Email/majority/approval stamps below are independent synthetic SQL fixtures,
    // never an age assurance endpoint, invitation bypass, or real account.
    for (const client of Object.values(clients)) {
      const active = ["active", "expired", "revokeLater", "emailLater"].includes(client.kind);
      const status = active ? "active" : ["suspended", "revoked", "deleted"].includes(client.kind) ? client.kind : "pending";
      const verified = client.kind !== "unverified";
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash,
        email_verified_at, age_assured_at, access_approved_at, access_expires_at, created_at, updated_at)
        VALUES (?, 'client', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [client.id, status, `Synthetic recovery ${client.kind}`,
        client.email, originalHash, verified ? sqlDate(now - 120000) : null, active ? sqlDate(now - 120000) : null,
        active ? sqlDate(now - 120000) : null, client.kind === "expired" ? sqlDate(now - 60000) : null, sqlDate(now - 120000), sqlDate(now - 120000)]);
      await connection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [client.id, sqlDate(now - 120000)]);
      if (active) await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)",
        [client.conversationId, client.id, admin.id, sqlDate(now - 120000)]);
    }
    const authService = await createAuthService({ store: authStore, totpKey, clock });
    const accessService = await createAccessService({ store: accessStore, authStore, authService, totpKey, mailKey, origin, clock });
    const chatService = await createChatService({ store: chatStore, authStore, authService, accessService, key: randomBytes(32), clock });
    const resetService = await createResetService({ store: resetStore, authStore, mailKey, clock });
    server = createAppServer({ authHandler: createAuthHandler(authService, { origin }), accessHandler: createAccessHandler(accessService, { origin }),
      chatHandler: createChatHandler(chatService, { origin }), resetHandler: createResetHandler(resetService, { origin }) });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, { method = "GET", body, headers = {} } = {}) {
      const response = await fetch(`${base}${path}`, { method, redirect: "manual",
        headers: { ...(method === "POST" ? { Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1" } : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const content = await response.text();
      let value;
      try { value = JSON.parse(content); } catch { value = content; }
      return { status: response.status, headers: response.headers, body: value };
    }
    const requestPath = "/api/access/recovery/request";
    const resetPath = "/api/access/recovery/reset";
    const issue = (client) => request(requestPath, { method: "POST", body: { email: client.email } });
    const complete = (token, password = newPassword, headers = {}) => request(resetPath, { method: "POST", body: { token, password }, headers });
    const inbox = [];
    const transport = { async sendPasswordReset(payload) { inbox.push({ email: payload.email, token: payload.token }); return true; },
      async sendVerification() { assert.fail("password recovery must never select the verification delivery method"); } };
    const deliver = () => runMailBatch({ store: resetMailStore, transport, key: mailKey, clock, purpose: "password-reset" });
    const tokenFor = (client) => inbox.findLast((mail) => mail.email === client.email)?.token;
    const count = async (table) => Number((await connection.query(`SELECT COUNT(*) AS count FROM ${table}`))[0].count);
    const userRow = async (client) => (await connection.query("SELECT password_hash, updated_at FROM users WHERE id = ?", [client.id]))[0];
    async function unchangedFields(client) {
      const user = (await connection.query(`SELECT u.id, u.role, u.status, u.pseudonym, u.email, u.email_verified_at, u.age_assured_at,
        u.access_approved_at, u.access_expires_at, u.created_at, a.age_declared_at FROM users u JOIN client_auth_state a ON a.user_id = u.id WHERE u.id = ?`, [client.id]))[0];
      const conversations = await connection.query("SELECT id, client_id, admin_id, created_at, closed_at FROM conversations WHERE client_id = ? ORDER BY id", [client.id]);
      return JSON.stringify({ user, conversations: [...conversations] });
    }
    async function login(client, password = originalPassword) {
      const result = await request("/api/access/login", { method: "POST", body: { email: client.email, password } });
      assert.equal(result.status, 200);
      return { cookie: result.headers.get("set-cookie").split(";")[0], csrf: result.body.csrf, access: result.body.access };
    }
    let adminSession;
    let firstSession;
    let secondSession;
    let pendingSession;
    let expiredSession;
    const adminHeaders = () => ({ Cookie: adminSession.cookie, "X-CSRF-Token": adminSession.csrf });
    async function nextNetworkWindow() {
      // Sixteen minutes opens a new 15-minute network budget while preserving
      // the separate administrator session's 30-minute idle deadline.
      now += 16 * 60000;
      assert.equal((await request("/api/auth/session", { headers: adminHeaders() })).status, 200);
    }

    await t.test("real client and MFA logins precede recovery while public GET pages never consume a token", async () => {
      const authenticated = await request("/api/auth/login", { method: "POST", body: { email: admin.email, password: adminPassword, factor: totpCode(admin.secret, { now }) } });
      assert.equal(authenticated.status, 200);
      adminSession = { cookie: authenticated.headers.get("set-cookie").split(";")[0], csrf: authenticated.body.csrf };
      firstSession = await login(clients.active);
      secondSession = await login(clients.active);
      pendingSession = await login(clients.pending);
      expiredSession = await login(clients.expired);
      assert.equal(firstSession.access.state, "active");
      assert.equal(pendingSession.access.state, "pending");
      assert.equal(expiredSession.access.state, "expired");
      assert.equal((await request("/api/chat/client/conversation", { headers: { Cookie: firstSession.cookie } })).status, 200);
      const before = await count("client_password_resets");
      assert.equal((await request("/recover")).status, 200);
      assert.equal((await request("/recover", { method: "HEAD" })).status, 200);
      for (const asset of ["/recover.js", "/recover-model.js", "/recover.css"]) assert.equal((await request(asset)).status, 200);
      const capability = await request("/api/access/recovery/capabilities");
      assert.equal(capability.status, 200);
      assert.deepEqual(capability.body, { enabled: true, password: { minLength: 14, maxLength: 128 } });
      assert.equal(await count("client_password_resets"), before);
      assert.equal((await userRow(clients.active)).password_hash, originalHash);
    });

    await t.test("known, unknown and ineligible mailboxes receive the same accepted HTTP response without account disclosure", async () => {
      const before = await count("client_password_resets");
      const addresses = ["unknown-reset-flow@example.invalid", "invalid-synthetic-address", admin.email, clients.unverified.email, clients.suspended.email, clients.revoked.email, clients.deleted.email];
      for (const email of addresses) {
        const result = await request(requestPath, { method: "POST", body: { email } });
        assert.equal(result.status, 202);
        assert.deepEqual(result.body, { status: "accepted" });
        assert.equal(result.headers.get("set-cookie"), null);
        assert.match(result.headers.get("cache-control"), /no-store/);
      }
      assert.equal(await count("client_password_resets"), before);
      assert.equal(await count("password_reset_outbox"), 0);
      for (const client of [clients.active, clients.pending, clients.expired]) {
        const result = await issue(client);
        assert.equal(result.status, 202);
        assert.deepEqual(result.body, { status: "accepted" });
      }
      assert.equal(await count("client_password_resets"), before + 3);
      assert.equal((await request("/api/access/session", { headers: { Cookie: firstSession.cookie } })).status, 200, "requesting a link must not revoke a session");
    });

    await t.test("the actual mail worker delivers only decrypted reset-purpose envelopes and SQL stores only token digests", async () => {
      const queued = await connection.query("SELECT id, payload_encrypted, status FROM password_reset_outbox");
      assert.equal(queued.length, 3);
      for (const job of queued) {
        assert.equal(job.status, "pending");
        assert.match(job.payload_encrypted, /^v1\./);
        for (const client of [clients.active, clients.pending, clients.expired]) assert.equal(job.payload_encrypted.includes(client.email), false);
        assert.throws(() => openVerificationPayload(job.payload_encrypted, mailKey, job.id), { code: "PAYLOAD_INVALID" });
      }
      assert.deepEqual(await deliver(), { sent: 3, failed: 0 });
      assert.equal(inbox.length, 3);
      for (const mail of inbox) {
        assert.match(mail.token, /^[A-Za-z0-9_-]{43}$/);
        const row = (await connection.query("SELECT token_hash FROM client_password_resets WHERE token_hash = ?", [tokenDigest(mail.token)]))[0];
        assert.ok(row.token_hash.equals(tokenDigest(mail.token)));
      }
      const jobId = randomBytes(16);
      const value = { email: clients.active.email, token: tokenFor(clients.active) };
      assert.throws(() => openResetPayload(sealVerificationPayload(value, mailKey, jobId), mailKey, jobId), { code: "PAYLOAD_INVALID" });
      assert.throws(() => openVerificationPayload(sealResetPayload(value, mailKey, jobId), mailKey, jobId), { code: "PAYLOAD_INVALID" });
      assert.equal((await request("/api/access/verify-email", { method: "POST", body: { token: tokenFor(clients.active) } })).status, 401);
    });

    await t.test("forged requests, weak passwords, another token purpose and tampered links leave credentials and gates unchanged", async () => {
      const before = await unchangedFields(clients.active);
      const token = tokenFor(clients.active);
      assert.equal((await complete(token, newPassword, { Origin: "https://other.invalid" })).status, 403);
      assert.equal((await complete(token, "too short")).status, 400);
      assert.equal((await request(resetPath, { method: "POST", body: { token, password: newPassword, status: "active" } })).status, 400);
      assert.equal((await request(`${resetPath}?token=forbidden-query`, { method: "POST", body: { token, password: newPassword } })).status, 400);
      const verificationToken = newToken();
      await connection.query(`INSERT INTO email_verifications (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
        [randomBytes(16), clients.unverified.id, tokenDigest(verificationToken), sqlDate(now), sqlDate(now + 3600000)]);
      assert.equal((await complete(verificationToken)).status, 401);
      const tampered = `${token[0] === "A" ? "B" : "A"}${token.slice(1)}`;
      assert.equal((await complete(tampered)).status, 401);
      assert.equal(await unchangedFields(clients.active), before);
      assert.equal((await userRow(clients.active)).password_hash, originalHash);
      assert.equal((await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ?", [clients.active.id]))[0].credential_version, 1);
      assert.equal((await request("/api/access/session", { headers: { Cookie: firstSession.cookie } })).status, 200);
    });

    await t.test("successful recovery replaces the real password once, revokes every old client session and preserves administrator access", async () => {
      const client = clients.active;
      const before = await unchangedFields(client);
      const sessionCount = await count("sessions");
      const futureSession = { id: randomBytes(16), token: newToken() };
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        [futureSession.id, client.id, tokenDigest(futureSession.token), sqlDate(now + 60000), sqlDate(now + 3600000)]);
      await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)",
        [futureSession.id, sqlDate(now + 60000)]);
      const completed = await complete(tokenFor(client), newPassword, { Cookie: `${firstSession.cookie}; ${adminSession.cookie}` });
      assert.equal(completed.status, 200);
      assert.deepEqual(completed.body, { status: "password_changed" });
      assert.match(completed.headers.get("set-cookie"), /^__Host-jessie_client=; Path=\/; Max-Age=0; Secure; HttpOnly; SameSite=Strict$/);
      assert.equal(completed.headers.get("set-cookie").includes("__Host-jessie_session"), false);
      assert.equal(await count("sessions"), sessionCount + 1, "password reset must not create a session");
      assert.equal(await unchangedFields(client), before);
      const user = await userRow(client);
      assert.notEqual(user.password_hash, originalHash);
      assert.equal(await verifyPassword(newPassword, user.password_hash), true);
      assert.equal(await verifyPassword(newPassword.trim(), user.password_hash), false, "password whitespace remains exact");
      assert.equal((await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ?", [client.id]))[0].credential_version, 2);
      const sessions = await connection.query("SELECT revoked_at, created_at FROM sessions WHERE user_id = ?", [client.id]);
      assert.equal(sessions.length, 3);
      assert.ok(sessions.every((session) => session.revoked_at !== null && session.revoked_at >= session.created_at));
      for (const session of [firstSession, secondSession]) {
        assert.equal((await request("/api/access/session", { headers: { Cookie: session.cookie } })).status, 401);
        assert.equal((await request("/api/chat/client/conversation", { headers: { Cookie: session.cookie } })).status, 401);
      }
      assert.equal((await request("/api/auth/session", { headers: adminHeaders() })).status, 200);
      assert.equal((await complete(tokenFor(client))).status, 401);
      const staleLogin = await accessStore.completeClientLogin({ userId: client.id, expectedPasswordHash: originalHash, expectedVersion: 1, now,
        session: { id: randomBytes(16), tokenHash: tokenDigest(newToken()), expiresAt: now + 3600000 } });
      assert.equal(staleLogin, false, "a pre-reset password verification cannot commit a stale login");
      assert.equal((await request("/api/access/login", { method: "POST", body: { email: client.email, password: originalPassword } })).status, 401);
      const updated = await login(client, newPassword);
      assert.equal(updated.access.state, "active");
      assert.equal((await request("/api/chat/client/conversation", { headers: { Cookie: updated.cookie } })).status, 200);
    });

    await t.test("racing HTTP completions have one winner and leave a verified pending client pending", async () => {
      const client = clients.pending;
      const before = await unchangedFields(client);
      const results = await Promise.all([complete(tokenFor(client), newPassword), complete(tokenFor(client), alternatePassword)]);
      assert.deepEqual(results.map((result) => result.status).sort(), [200, 401]);
      const winner = results[0].status === 200 ? newPassword : alternatePassword;
      assert.equal(await unchangedFields(client), before);
      assert.equal((await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ?", [client.id]))[0].credential_version, 2);
      assert.equal((await request("/api/access/session", { headers: { Cookie: pendingSession.cookie } })).status, 401);
      const updated = await login(client, winner);
      assert.equal(updated.access.state, "pending");
      assert.equal(updated.access.ageAssured, false);
      assert.equal(updated.access.approved, false);
      assert.equal((await request("/api/chat/client/conversation", { headers: { Cookie: updated.cookie } })).status, 403);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM conversations WHERE client_id = ?", [client.id]))[0].count), 0);
    });

    await t.test("an expired active client can recover a password without extending or reopening access", async () => {
      const client = clients.expired;
      const before = await unchangedFields(client);
      assert.equal((await complete(tokenFor(client))).status, 200);
      assert.equal(await unchangedFields(client), before);
      assert.equal((await request("/api/access/session", { headers: { Cookie: expiredSession.cookie } })).status, 401);
      const updated = await login(client, newPassword);
      assert.equal(updated.access.state, "expired");
      assert.equal((await request("/api/chat/client/conversation", { headers: { Cookie: updated.cookie } })).status, 403);
    });

    let latestToken;
    await t.test("a newer request invalidates an older delivered link without changing the password or existing sessions", async () => {
      await nextNetworkWindow();
      const client = clients.active;
      const before = await unchangedFields(client);
      const current = await login(client, newPassword);
      const passwordBefore = (await userRow(client)).password_hash;
      assert.equal((await issue(client)).status, 202);
      assert.deepEqual(await deliver(), { sent: 1, failed: 0 });
      const oldToken = tokenFor(client);
      assert.equal((await issue(client)).status, 202);
      assert.equal((await complete(oldToken)).status, 401);
      assert.deepEqual(await deliver(), { sent: 1, failed: 0 });
      latestToken = tokenFor(client);
      assert.notEqual(latestToken, oldToken);
      assert.equal((await userRow(client)).password_hash, passwordBefore);
      assert.equal(await unchangedFields(client), before);
      assert.equal((await request("/api/access/session", { headers: { Cookie: current.cookie } })).status, 200);
      const row = (await connection.query("SELECT consumed_at, revoked_at FROM client_password_resets WHERE token_hash = ?", [tokenDigest(oldToken)]))[0];
      assert.equal(row.consumed_at, null);
      assert.notEqual(row.revoked_at, null);
    });

    await t.test("opening a fragment link does not consume it and the exact thirty-minute deadline rejects completion", async () => {
      const client = clients.active;
      const before = await userRow(client);
      assert.equal((await request(`/recover#reset=${latestToken}`)).status, 200);
      const untouched = (await connection.query("SELECT consumed_at, revoked_at FROM client_password_resets WHERE token_hash = ?", [tokenDigest(latestToken)]))[0];
      assert.equal(untouched.consumed_at, null);
      assert.equal(untouched.revoked_at, null);
      await nextNetworkWindow();
      now += 14 * 60000;
      assert.equal((await request("/api/auth/session", { headers: adminHeaders() })).status, 200);
      const expired = await complete(latestToken);
      assert.equal(expired.status, 401);
      assert.deepEqual(expired.body, { error: "invalid_reset_link" });
      assert.deepEqual(await userRow(client), before);
    });

    await t.test("revocation before delivery cancels a queued job and forbids recovery without reopening a client", async () => {
      const client = clients.revokeLater;
      assert.equal((await issue(client)).status, 202);
      const job = (await connection.query("SELECT id, payload_encrypted FROM password_reset_outbox WHERE recipient_user_id = ?", [client.id]))[0];
      const payload = openResetPayload(job.payload_encrypted, mailKey, job.id);
      const before = await userRow(client);
      const revoke = await request(`/api/admin/clients/${hex(client.id)}/revoke`, { method: "POST", headers: adminHeaders(), body: {} });
      assert.equal(revoke.status, 200);
      const gatesAfterRevocation = await unchangedFields(client);
      const mailCount = inbox.length;
      assert.deepEqual(await deliver(), { sent: 0, failed: 0 });
      assert.equal(inbox.length, mailCount);
      assert.equal((await complete(payload.token)).status, 401);
      assert.equal((await userRow(client)).password_hash, before.password_hash);
      assert.equal(await unchangedFields(client), gatesAfterRevocation);
      assert.equal((await connection.query("SELECT status FROM password_reset_outbox WHERE id = ?", [job.id]))[0].status, "cancelled");
    });

    await t.test("changing the canonical email snapshot rejects an already delivered link without changing any remaining fields", async () => {
      const client = clients.emailLater;
      assert.equal((await issue(client)).status, 202);
      assert.deepEqual(await deliver(), { sent: 1, failed: 0 });
      const token = tokenFor(client);
      // There is no email-change API: this SQL fixture tests snapshot binding only.
      await connection.query("UPDATE users SET email = ? WHERE id = ?", ["reset-flow-new-address@example.invalid", client.id]);
      const before = await unchangedFields(client);
      const credentials = await userRow(client);
      assert.equal((await complete(token)).status, 401);
      assert.equal(await unchangedFields(client), before);
      assert.deepEqual(await userRow(client), credentials);
      assert.equal((await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ?", [client.id]))[0].credential_version, 1);
      assert.equal((await request("/api/auth/session", { headers: adminHeaders() })).status, 200);
    });
  } finally {
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    try { if (pool) await pool.end(); }
    finally { try { await cleanup(); } finally { await connection.end(); } }
  }
});
