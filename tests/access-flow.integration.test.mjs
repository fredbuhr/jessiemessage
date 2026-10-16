import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createAuthService } from "../server/auth/service.mjs";
import { createAuthHandler } from "../server/auth/http.mjs";
import { createAccessStore } from "../server/access/store.mjs";
import { createAccessService } from "../server/access/service.mjs";
import { createAccessHandler } from "../server/access/http.mjs";
import { createMailStore } from "../server/mail/store.mjs";
import { runMailBatch } from "../server/mail/worker.mjs";
import { createAppServer } from "../server/index.mjs";
import { createRecoveryCodes, hashPassword, makeTotpSecret, recoveryCodeDigest, sealTotpSecret, tokenDigest, totpCode } from "../server/auth/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const instant = (value) => Date.parse(`${value.replace(" ", "T")}Z`);
const tokenFromCookie = (cookie) => cookie.slice(cookie.indexOf("=") + 1);

test("real HTTP invitation, encrypted verification mail and gated client access (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 120000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "separately provisioned runtime DML credentials are required");
  const migrations = await loadMigrations();
  const allowedTables = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase();
  let pool;
  let server;
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
    const mailStore = createMailStore(pool);
    assert.equal(await authStore.assertSchema(), true);
    assert.equal(await accessStore.assertSchema(), true);
    assert.equal(await mailStore.assertSchema(), true);
    let now = Date.now();
    const clock = () => now;
    const totpKey = randomBytes(32);
    const mailKey = randomBytes(32);
    const origin = "https://example.invalid";
    const adminId = randomBytes(16);
    const adminEmail = "flow-admin@example.invalid";
    const adminPassword = "Synthetic invitation administrator password 2026!";
    const secret = makeTotpSecret();
    await authStore.initializeAdmin({ id: adminId, email: adminEmail, pseudonym: "Synthetic flow administrator",
      passwordHash: await hashPassword(adminPassword), secretEncrypted: sealTotpSecret(secret, totpKey, adminId),
      recoveryDigests: createRecoveryCodes().map(recoveryCodeDigest), now });
    const authService = await createAuthService({ store: authStore, totpKey, clock });
    const accessService = await createAccessService({ store: accessStore, authStore, authService, totpKey, mailKey, origin, clock });
    server = createAppServer({ authHandler: createAuthHandler(authService, { origin }), accessHandler: createAccessHandler(accessService, { origin }) });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const mutationHeaders = { Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1" };
    async function request(path, { method = "GET", body, headers = {} } = {}) {
      const response = await fetch(`${base}${path}`, { method, headers: { ...(method === "POST" ? mutationHeaders : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const text = await response.text();
      let value;
      try { value = JSON.parse(text); } catch { value = text; }
      return { status: response.status, headers: response.headers, body: value };
    }
    const inbox = [];
    const transport = { async sendVerification(payload) { inbox.push({ email: payload.email, token: payload.token }); return true; } };
    const deliver = () => runMailBatch({ store: mailStore, transport, key: mailKey, clock });
    const count = async (table) => Number((await connection.query(`SELECT COUNT(*) AS count FROM ${table}`))[0].count);
    let adminCookie;
    let adminCsrf;
    let firstInvitation;
    let firstClientId;
    let clientCookie;
    let clientCsrf;
    let renewedExpiry;
    const clientEmail = "first-flow-client@example.invalid";
    const clientPassword = "Synthetic first invited client password 2026!";
    const adminHeaders = () => ({ Cookie: adminCookie, "X-CSRF-Token": adminCsrf });
    const clientHeaders = () => ({ Cookie: clientCookie, "X-CSRF-Token": clientCsrf });

    await t.test("an administrator authenticates with the actual password and OTP before creating a fragment invitation", async () => {
      assert.equal((await request("/api/admin/invitations")).status, 401);
      const login = await request("/api/auth/login", { method: "POST", body: { email: adminEmail, password: adminPassword, factor: totpCode(secret, { now }) } });
      assert.equal(login.status, 200);
      adminCookie = login.headers.get("set-cookie").split(";")[0];
      adminCsrf = login.body.csrf;
      assert.equal(login.body.user.role, "admin");
      assert.equal((await request("/api/admin/invitations", { method: "POST", headers: { Cookie: adminCookie }, body: { lifetimeHours: 1, accessDays: 2 } })).status, 403);
      const created = await request("/api/admin/invitations", { method: "POST", headers: adminHeaders(), body: { lifetimeHours: 1, accessDays: 2 } });
      assert.equal(created.status, 201);
      firstInvitation = created.body;
      const invitationUrl = new URL(firstInvitation.url);
      assert.equal(invitationUrl.origin, origin);
      assert.equal(invitationUrl.pathname, "/access");
      assert.equal(invitationUrl.search, "");
      assert.match(invitationUrl.hash, /^#invitation=[A-Za-z0-9_-]{43}$/);
      const inspection = await request("/api/access/invitation", { method: "POST", body: { token: invitationUrl.hash.slice("#invitation=".length) } });
      assert.equal(inspection.status, 200);
      assert.deepEqual(Object.keys(inspection.body).sort(), ["accessDays", "expiresAt"]);
      assert.equal((await request("/api/admin/invitations", { headers: { Cookie: adminCookie } })).body.invitations.length, 1);
    });

    await t.test("registration consumes the invitation once, stores an encrypted mail job and grants no age assurance", async () => {
      const invitationToken = new URL(firstInvitation.url).hash.slice("#invitation=".length);
      const registration = { invitationToken, email: clientEmail, pseudonym: "Synthetic first client", password: clientPassword, ageDeclared: true };
      assert.equal((await request("/api/access/register", { method: "POST", headers: { Origin: "https://other.invalid" }, body: registration })).status, 403);
      assert.equal((await request("/api/access/register", { method: "POST", body: { ...registration, ageAssured: true } })).status, 400);
      const result = await request("/api/access/register", { method: "POST", body: registration });
      assert.equal(result.status, 202);
      assert.deepEqual(result.body, { status: "verification_pending" });
      assert.equal(result.headers.get("set-cookie"), null);
      const user = (await connection.query("SELECT id, status, email_verified_at, age_assured_at, access_approved_at, access_expires_at FROM users WHERE email = ?", [clientEmail]))[0];
      firstClientId = user.id.toString("hex");
      assert.equal(user.status, "pending");
      for (const field of ["email_verified_at", "age_assured_at", "access_approved_at", "access_expires_at"]) assert.equal(user[field], null);
      const mail = (await connection.query("SELECT payload_encrypted, status FROM mail_outbox"))[0];
      assert.match(mail.payload_encrypted, /^v1\./);
      assert.equal(mail.payload_encrypted.includes(clientEmail), false);
      assert.equal(mail.status, "pending");
      assert.equal(await count("email_verifications"), 1);
      assert.equal(await count("mail_outbox"), 1);
      assert.equal(await count("conversations"), 0);
      assert.equal((await request("/api/access/register", { method: "POST", body: { ...registration, email: "reused-flow-client@example.invalid" } })).status, 400);
      assert.equal(await count("users"), 2);
      assert.equal(await count("mail_outbox"), 1);
      assert.equal((await request("/api/access/login", { method: "POST", body: { email: clientEmail, password: clientPassword } })).status, 401);
    });

    await t.test("only the delivered single-use email token permits client login; pending access remains isolated from administration", async () => {
      assert.deepEqual(await deliver(), { sent: 1, failed: 0 });
      assert.equal(inbox.length, 1);
      assert.equal(inbox[0].email, clientEmail);
      assert.match(inbox[0].token, /^[A-Za-z0-9_-]{43}$/);
      const challenge = (await connection.query("SELECT token_hash FROM email_verifications"))[0];
      assert.ok(challenge.token_hash.equals(tokenDigest(inbox[0].token)));
      const verified = await request("/api/access/verify-email", { method: "POST", body: { token: inbox[0].token } });
      assert.equal(verified.status, 200);
      assert.deepEqual(verified.body, { status: "email_verified" });
      assert.equal((await request("/api/access/verify-email", { method: "POST", body: { token: inbox[0].token } })).status, 401);
      const login = await request("/api/access/login", { method: "POST", body: { email: clientEmail, password: clientPassword } });
      assert.equal(login.status, 200);
      assert.match(login.headers.get("set-cookie"), /^__Host-jessie_client=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; Secure; HttpOnly; SameSite=Strict$/);
      clientCookie = login.headers.get("set-cookie").split(";")[0];
      clientCsrf = login.body.csrf;
      assert.deepEqual(login.body.user, { id: firstClientId, role: "client", pseudonym: "Synthetic first client" });
      assert.deepEqual(login.body.access, { state: "pending", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: false, expiresAt: null });
      assert.equal(Object.hasOwn(login.body, "token"), false);
      assert.equal(Object.hasOwn(login.body.user, "email"), false);
      assert.equal((await request("/api/admin/clients", { headers: { Cookie: clientCookie } })).status, 401);
      const forgedAdminCookie = `__Host-jessie_session=${tokenFromCookie(clientCookie)}`;
      assert.equal((await request("/api/admin/clients", { headers: { Cookie: forgedAdminCookie } })).status, 401);
      assert.equal((await request("/api/auth/session", { headers: { Cookie: forgedAdminCookie } })).status, 401);
      assert.equal((await request("/api/access/session", { headers: { Cookie: `__Host-jessie_client=${tokenFromCookie(adminCookie)}` } })).status, 401);
      await assert.rejects(accessService.requireActiveClient(tokenFromCookie(clientCookie)));
      assert.equal((await request(`/api/admin/clients/${firstClientId}/approve`, { method: "POST", headers: { ...adminHeaders(), "X-CSRF-Token": clientCsrf }, body: {} })).status, 403);
      assert.equal((await connection.query("SELECT status FROM users WHERE id = ?", [Buffer.from(firstClientId, "hex")]))[0].status, "pending");
      assert.equal(await count("conversations"), 0);
    });

    await t.test("manual approval of the invited email-verified client opens exactly one conversation without inventing age evidence", async () => {
      now += 300000;
      const approved = await request(`/api/admin/clients/${firstClientId}/approve`, { method: "POST", headers: adminHeaders(), body: {} });
      assert.equal(approved.status, 200);
      const user = (await connection.query("SELECT status, age_assured_at, access_approved_at, access_expires_at FROM users WHERE id = ?", [Buffer.from(firstClientId, "hex")]))[0];
      assert.equal(user.status, "active"); assert.equal(user.age_assured_at, null);
      assert.equal(instant(user.access_approved_at), now);
      assert.equal(instant(user.access_expires_at), now + 2 * 86400000);
      assert.ok(instant(user.access_expires_at) > Number(firstInvitation.expiresAt));
      const conversations = await connection.query("SELECT client_id, admin_id FROM conversations");
      assert.equal(conversations.length, 1);
      assert.ok(conversations[0].client_id.equals(Buffer.from(firstClientId, "hex")));
      assert.ok(conversations[0].admin_id.equals(adminId));
      assert.notEqual((await request(`/api/admin/clients/${firstClientId}/approve`, { method: "POST", headers: adminHeaders(), body: {} })).status, 200);
      assert.equal(await count("conversations"), 1);
      const active = await request("/api/access/session", { headers: clientHeaders() });
      assert.equal(active.status, 200);
      assert.equal(active.body.access.state, "active");
      assert.equal(active.body.access.ageAssured, false);
      assert.equal(active.body.access.admissionPolicy, "manual_invitation");
      assert.equal(active.body.access.invitationConsumed, true);
      assert.equal(active.body.access.approved, true);
      const principal = await accessService.requireActiveClient(tokenFromCookie(clientCookie));
      assert.equal(principal.user.id, firstClientId);
    });

    let secondClientId;
    let secondToken;
    let secondCookie;
    const secondEmail = "second-flow-client@example.invalid";
    const secondPassword = "Synthetic second invited client password 2026!";
    await t.test("resending requires the correct password, hides unknown accounts and makes the older delivered token unusable", async () => {
      const invite = await request("/api/admin/invitations", { method: "POST", headers: adminHeaders(), body: { lifetimeHours: 1, accessDays: null } });
      assert.equal(invite.status, 201);
      const registration = await request("/api/access/register", { method: "POST", body: { invitationToken: new URL(invite.body.url).hash.slice("#invitation=".length), email: secondEmail, pseudonym: "Synthetic second client", password: secondPassword, ageDeclared: true } });
      assert.equal(registration.status, 202);
      secondClientId = (await connection.query("SELECT id FROM users WHERE email = ?", [secondEmail]))[0].id.toString("hex");
      assert.deepEqual(await deliver(), { sent: 1, failed: 0 });
      const staleToken = inbox.at(-1).token;
      const before = await count("mail_outbox");
      const unknown = await request("/api/access/resend-verification", { method: "POST", body: { email: "unknown-flow-client@example.invalid", password: secondPassword } });
      const wrong = await request("/api/access/resend-verification", { method: "POST", body: { email: secondEmail, password: "Synthetic incorrect client password 2026!" } });
      assert.equal(unknown.status, 202);
      assert.deepEqual(wrong.body, unknown.body);
      assert.equal(wrong.status, unknown.status);
      assert.equal(await count("mail_outbox"), before);
      const resend = await request("/api/access/resend-verification", { method: "POST", body: { email: secondEmail, password: secondPassword } });
      assert.equal(resend.status, 202);
      assert.deepEqual(resend.body, unknown.body);
      assert.equal(await count("mail_outbox"), before + 1);
      assert.equal((await request("/api/access/verify-email", { method: "POST", body: { token: staleToken } })).status, 401);
      assert.deepEqual(await deliver(), { sent: 1, failed: 0 });
      secondToken = inbox.at(-1).token;
      assert.notEqual(secondToken, staleToken);
      assert.equal((await request("/api/access/verify-email", { method: "POST", body: { token: secondToken } })).status, 200);
      const login = await request("/api/access/login", { method: "POST", body: { email: secondEmail, password: secondPassword } });
      assert.equal(login.status, 200);
      secondCookie = login.headers.get("set-cookie").split(";")[0];
      const second = await request("/api/access/session", { headers: { Cookie: secondCookie } });
      assert.equal(second.body.user.id, secondClientId);
      assert.equal(JSON.stringify(second.body).includes(firstClientId), false);
      assert.equal(JSON.stringify(second.body).includes(clientEmail), false);
      assert.equal(second.body.access.state, "pending");
      assert.equal((await request("/api/admin/clients", { headers: { Cookie: adminCookie } })).body.clients.length, 2);
    });

    await t.test("administrator pages preserve their collections and cursors across the actual HTTP and SQL boundary", async () => {
      const cursors = {};
      for (const kind of ["invitations", "clients"]) {
        const first = await request(`/api/admin/${kind}?limit=1`, { headers: adminHeaders() });
        assert.equal(first.status, 200);
        assert.deepEqual(Object.keys(first.body).sort(), [kind, "hasMore", "nextCursor"].sort());
        assert.equal(first.body[kind].length, 1); assert.equal(first.body.hasMore, true);
        assert.equal(typeof first.body.nextCursor, "string"); cursors[kind] = first.body.nextCursor;
        const second = await request(`/api/admin/${kind}?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`, { headers: adminHeaders() });
        assert.equal(second.status, 200);
        assert.equal(second.body[kind].length, 1); assert.equal(second.body.hasMore, false); assert.equal(second.body.nextCursor, null);
        const rows = [...first.body[kind], ...second.body[kind]];
        assert.equal(new Set(rows.map((row) => row.id)).size, 2);
        assert.ok(rows[0].createdAt >= rows[1].createdAt);
        if (kind === "clients") assert.deepEqual(new Set(rows.map((row) => row.id)), new Set([firstClientId, secondClientId]));
        assert.equal(JSON.stringify(first.body).includes("#invitation="), false);
        assert.equal((await request(`/api/admin/${kind}?limit=1`, { headers: clientHeaders() })).status, 401);
      }
      assert.equal((await request(`/api/admin/clients?cursor=${encodeURIComponent(cursors.invitations)}`, { headers: adminHeaders() })).status, 400);
      assert.equal((await request(`/api/admin/invitations?cursor=${encodeURIComponent(cursors.clients)}`, { headers: adminHeaders() })).status, 400);
      for (const query of ["limit=1&limit=2", "limit=101", "offset=1", "cursor="]) {
        assert.equal((await request(`/api/admin/clients?${query}`, { headers: adminHeaders() })).status, 400);
      }
    });

    await t.test("access expires at its exact boundary and the existing session cannot authorize protected client work", async () => {
      // Shorten this synthetic entitlement so the same live session spans the
      // boundary without bypassing the independently tested eight-hour limit.
      const boundary = now + 60000;
      await connection.query("UPDATE users SET access_expires_at = ? WHERE id = ?", [sqlDate(boundary), Buffer.from(firstClientId, "hex")]);
      now = boundary - 1;
      assert.equal((await request("/api/access/session", { headers: clientHeaders() })).body.access.state, "active");
      assert.ok(await accessService.requireActiveClient(tokenFromCookie(clientCookie)));
      now = boundary;
      const expired = await request("/api/access/session", { headers: clientHeaders() });
      assert.equal(expired.status, 200);
      assert.equal(expired.body.access.state, "expired");
      await assert.rejects(accessService.requireActiveClient(tokenFromCookie(clientCookie)));
    });

    await t.test("renewing expired approved access is atomic and preserves its conversation, credentials and existing sessions", async () => {
      const path = `/api/admin/clients/${firstClientId}/renew`;
      const body = { accessDays: 1, expectedExpiresAt: now };
      const userId = Buffer.from(firstClientId, "hex");
      const preserved = () => connection.query("SELECT email_verified_at, age_assured_at, access_approved_at, password_hash FROM users WHERE id = ?", [userId]);
      const sessions = () => connection.query("SELECT id, user_id, token_hash, created_at, expires_at, revoked_at FROM sessions WHERE user_id = ? ORDER BY id", [userId]);
      const conversations = () => connection.query("SELECT id, client_id, admin_id, created_at, closed_at FROM conversations WHERE client_id = ?", [userId]);
      const credentials = () => connection.query("SELECT credential_version, age_declared_at FROM client_auth_state WHERE user_id = ?", [userId]);
      const before = { user: await preserved(), sessions: await sessions(), conversations: await conversations(), credentials: await credentials() };
      assert.equal((await request(path, { method: "POST", body, headers: { ...adminHeaders(), "X-CSRF-Token": clientCsrf } })).status, 403);
      assert.equal((await request(path, { method: "POST", body, headers: clientHeaders() })).status, 401);
      const pending = await request(`/api/admin/clients/${secondClientId}/renew`, { method: "POST", body, headers: adminHeaders() });
      assert.equal(pending.status, 409); assert.deepEqual(pending.body, { error: "verification_required" });
      const attempts = await Promise.all([1, 2].map(() => request(path, { method: "POST", body, headers: adminHeaders() })));
      assert.deepEqual(attempts.map((result) => result.status).sort(), [200, 409]);
      const success = attempts.find((result) => result.status === 200), conflict = attempts.find((result) => result.status === 409);
      renewedExpiry = now + 86400000;
      assert.deepEqual(success.body, { status: "renewed", client: { id: firstClientId, accessExpiresAt: renewedExpiry } });
      assert.deepEqual(conflict.body, { error: "access_changed" });
      assert.equal(success.headers.get("set-cookie"), null);
      assert.equal(success.headers.get("cache-control"), "no-store");
      assert.deepEqual(await preserved(), before.user);
      assert.deepEqual(await sessions(), before.sessions);
      assert.deepEqual(await conversations(), before.conversations);
      assert.deepEqual(await credentials(), before.credentials);
      const current = await request("/api/access/session", { headers: clientHeaders() });
      assert.equal(current.status, 200); assert.equal(current.body.access.state, "active"); assert.equal(current.body.access.expiresAt, renewedExpiry);
      assert.ok(await accessService.requireActiveClient(tokenFromCookie(clientCookie)));
      assert.equal((await request(path, { method: "POST", body, headers: adminHeaders() })).status, 409);
      assert.equal(instant((await connection.query("SELECT access_expires_at FROM users WHERE id = ?", [userId]))[0].access_expires_at), renewedExpiry);
    });

    await t.test("renewing before expiry adds to the existing deadline and refuses an excessive horizon or a non-client target", async () => {
      const path = `/api/admin/clients/${firstClientId}/renew`;
      const result = await request(path, { method: "POST", headers: adminHeaders(), body: { accessDays: 1, expectedExpiresAt: renewedExpiry } });
      renewedExpiry += 86400000;
      assert.equal(result.status, 200); assert.deepEqual(result.body, { status: "renewed", client: { id: firstClientId, accessExpiresAt: renewedExpiry } });
      assert.equal((await request(path, { method: "POST", headers: adminHeaders(), body: { accessDays: 3650, expectedExpiresAt: renewedExpiry } })).status, 400);
      assert.equal((await request(`/api/admin/clients/${adminId.toString("hex")}/renew`, { method: "POST", headers: adminHeaders(), body: { accessDays: 1, expectedExpiresAt: renewedExpiry } })).status, 404);
      assert.equal(instant((await connection.query("SELECT access_expires_at FROM users WHERE id = ?", [Buffer.from(firstClientId, "hex")]))[0].access_expires_at), renewedExpiry);
    });

    await t.test("administrator revocation immediately rejects both client sessions and verification tokens", async () => {
      assert.equal((await request(`/api/admin/clients/${firstClientId}/revoke`, { method: "POST", headers: adminHeaders(), body: {} })).status, 200);
      assert.equal((await request("/api/access/session", { headers: clientHeaders() })).status, 401);
      await assert.rejects(accessService.requireActiveClient(tokenFromCookie(clientCookie)));
      assert.equal((await request(`/api/admin/clients/${secondClientId}/revoke`, { method: "POST", headers: adminHeaders(), body: {} })).status, 200);
      assert.equal((await request("/api/access/session", { headers: { Cookie: secondCookie } })).status, 401);
      assert.equal((await request("/api/access/verify-email", { method: "POST", body: { token: secondToken } })).status, 401);
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.role = 'client' AND s.revoked_at IS NULL"))[0].count, 0n);
      assert.deepEqual(await deliver(), { sent: 0, failed: 0 });
    });

    await t.test("renewal never reactivates a revoked account or its old client session", async () => {
      const result = await request(`/api/admin/clients/${firstClientId}/renew`, { method: "POST", headers: adminHeaders(), body: { accessDays: 1, expectedExpiresAt: renewedExpiry } });
      assert.equal(result.status, 409); assert.deepEqual(result.body, { error: "verification_required" });
      assert.equal((await request("/api/access/session", { headers: clientHeaders() })).status, 401);
      const user = (await connection.query("SELECT status, access_expires_at FROM users WHERE id = ?", [Buffer.from(firstClientId, "hex")]))[0];
      assert.equal(user.status, "revoked"); assert.equal(instant(user.access_expires_at), renewedExpiry);
      assert.equal(await count("conversations"), 1);
    });

    await t.test("revoking a client before email delivery cancels the private queued challenge without sending it", async () => {
      const invite = await request("/api/admin/invitations", { method: "POST", headers: adminHeaders(), body: { lifetimeHours: 1, accessDays: null } });
      assert.equal(invite.status, 201);
      const email = "revoked-before-delivery@example.invalid";
      assert.equal((await request("/api/access/register", { method: "POST", body: { invitationToken: new URL(invite.body.url).hash.slice("#invitation=".length),
        email, pseudonym: "Synthetic undelivered client", password: "Synthetic undelivered invited client password 2026!", ageDeclared: true } })).status, 202);
      const userId = (await connection.query("SELECT id FROM users WHERE email = ?", [email]))[0].id;
      assert.equal((await request(`/api/admin/clients/${userId.toString("hex")}/revoke`, { method: "POST", headers: adminHeaders(), body: {} })).status, 200);
      const verification = (await connection.query("SELECT consumed_at, revoked_at FROM email_verifications WHERE user_id = ?", [userId]))[0];
      assert.equal(verification.consumed_at, null);
      assert.notEqual(verification.revoked_at, null);
      assert.equal((await connection.query("SELECT status FROM mail_outbox WHERE recipient_user_id = ?", [userId]))[0].status, "cancelled");
      const deliveredCount = inbox.length;
      assert.deepEqual(await deliver(), { sent: 0, failed: 0 });
      assert.equal(inbox.length, deliveredCount);
    });
  } finally {
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    try { if (pool) await pool.end(); }
    finally { try { await reset(); } finally { await connection.end(); } }
  }
});
