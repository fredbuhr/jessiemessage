import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createAuthStore, AuthStoreError } from "../server/auth/store.mjs";
import { createAuthService } from "../server/auth/service.mjs";
import { createAuthHandler } from "../server/auth/http.mjs";
import { createAppServer } from "../server/index.mjs";
import { hashPassword, makeTotpSecret, sealTotpSecret, createRecoveryCodes, recoveryCodeDigest, totpCode } from "../server/auth/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16);
const digest = () => randomBytes(32);
const now = Date.UTC(2026, 9, 14, 12);
const passwordHash = "synthetic-password-hash-not-a-real-credential";
const allowedTables = ["auth_session_state", "admin_recovery_codes", "admin_mfa", "auth_rate_limits", "conversations", "sessions", "invitations", "users", "migration_probe", "schema_migrations"];

test("real MariaDB administrator authentication persistence (synthetic disposable database only)", { skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 120000 }, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "integration tests require separately provisioned runtime DML credentials");
  const connection = await connectDatabase();
  let pool;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset();
    pool = await createRuntimePool(process.env);
    const store = createAuthStore(pool);
    await assert.rejects(store.assertSchema(), (error) => error.code === "AUTH_DATABASE_OPERATION" && error.cause === undefined);
    await applyMigrations(connection, { database: options.database, migrations: await loadMigrations() });
    assert.equal(await store.assertSchema(), true);

    await t.test("read-only startup checks reject dirty history, nullable state drift and missing uniqueness", async () => {
      await connection.query("UPDATE schema_migrations SET state = 'failed', finished_at = NULL WHERE version = 8");
      try { await assert.rejects(store.assertSchema(), (error) => error.code === "AUTH_DATABASE_STATE"); }
      finally { await connection.query("UPDATE schema_migrations SET state = 'applied', finished_at = CURRENT_TIMESTAMP(6) WHERE version = 8"); }
      await connection.query("ALTER TABLE auth_session_state MODIFY last_seen_at DATETIME(6) NULL");
      try { await assert.rejects(store.assertSchema(), (error) => error.code === "AUTH_DATABASE_STATE"); }
      finally { await connection.query("ALTER TABLE auth_session_state MODIFY last_seen_at DATETIME(6) NOT NULL"); }
      await connection.query("ALTER TABLE sessions DROP INDEX sessions_token_hash");
      try { await assert.rejects(store.assertSchema(), (error) => error.code === "AUTH_DATABASE_STATE"); }
      finally { await connection.query("ALTER TABLE sessions ADD UNIQUE KEY sessions_token_hash (token_hash)"); }
      assert.equal(await store.assertSchema(), true);
    });
    const first = { id: id(), email: "first-admin@example.invalid", pseudonym: "Synthetic admin", passwordHash, secretEncrypted: "synthetic-encrypted-secret", recoveryDigests: Array.from({ length: 8 }, digest), now };
    const second = { ...first, id: id(), email: "second-admin@example.invalid", recoveryDigests: Array.from({ length: 8 }, digest) };
    let admin;

    await t.test("failed initialization rolls back every row; simultaneous initializations create one administrator", async () => {
      await assert.rejects(store.initializeAdmin({ ...first, recoveryDigests: Array(8).fill(first.recoveryDigests[0]) }), (error) => error instanceof AuthStoreError && error.code === "AUTH_DATABASE_OPERATION");
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM users"))[0].count, 0n);
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM admin_mfa"))[0].count, 0n);
      const results = await Promise.allSettled([store.initializeAdmin(first), store.initializeAdmin(second)]);
      assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(results.find((item) => item.status === "rejected").reason.code, "AUTH_ADMIN_EXISTS");
      admin = results[0].status === "fulfilled" ? first : second;
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'"))[0].count, 1n);
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM admin_recovery_codes"))[0].count, 8n);
      const user = await store.getLoginRecord(admin.email);
      assert.deepEqual(user, { id: admin.id, role: "admin", status: "active", passwordHash });
      assert.equal(await store.getLoginRecord("missing@example.invalid"), null);
      await assert.rejects(store.initializeAdmin(first), (error) => error.code === "AUTH_ADMIN_EXISTS");
    });

    let step = 1000;
    async function login(factor = { step: step++ }, extra = {}) {
      const session = { id: id(), tokenHash: digest(), expiresAt: now + 8 * 3600000, ...extra };
      const accepted = await store.completeAdminLogin({ userId: admin.id, expectedPasswordHash: passwordHash, now, factorCheck: () => factor, session });
      return { accepted, session };
    }
    let firstSession;
    await t.test("only a fresh OTP enrolls MFA; simultaneous OTP replay and stale password are refused", async () => {
      assert.equal((await login({ recoveryDigest: admin.recoveryDigests[0] })).accepted, false);
      const concurrentStep = step++;
      const results = await Promise.all([login({ step: concurrentStep }), login({ step: concurrentStep })]);
      assert.equal(results.filter((result) => result.accepted).length, 1);
      firstSession = results.find((result) => result.accepted).session;
      const mfa = (await connection.query("SELECT enabled_at, last_totp_step FROM admin_mfa WHERE user_id = ?", [admin.id]))[0];
      assert.ok(mfa.enabled_at);
      assert.equal(Number(mfa.last_totp_step), concurrentStep);
      assert.equal((await login({ step: concurrentStep })).accepted, false);
      assert.equal(await store.completeAdminLogin({ userId: admin.id, expectedPasswordHash: "stale-hash", now, factorCheck: () => ({ step: step++ }), session: { id: id(), tokenHash: digest(), expiresAt: now + 10000 } }), false);
    });

    await t.test("a failed session insert rolls back OTP advancement; recovery codes are single-use under concurrency", async () => {
      const rollbackStep = step++;
      await assert.rejects(login({ step: rollbackStep }, { id: firstSession.id }), (error) => error.code === "AUTH_DATABASE_OPERATION");
      assert.equal((await login({ step: rollbackStep })).accepted, true);
      const results = await Promise.all([login({ recoveryDigest: admin.recoveryDigests[0] }), login({ recoveryDigest: admin.recoveryDigests[0] })]);
      assert.equal(results.filter((result) => result.accepted).length, 1);
      assert.equal((await login({ recoveryDigest: admin.recoveryDigests[0] })).accepted, false);
    });

    await t.test("session lookup enforces idle and absolute expiry and limits last-seen writes", async () => {
      const { session } = await login();
      const lookup = (at, idleSeconds = 1800) => store.getSession(session.tokenHash, { now: at, idleSeconds });
      const initial = await lookup(now);
      assert.deepEqual(initial, { id: session.id, userId: admin.id, role: "admin", pseudonym: admin.pseudonym, expiresAt: session.expiresAt, mfaVersion: 1 });
      assert.ok(await lookup(now + 59000));
      let state = (await connection.query("SELECT last_seen_at FROM auth_session_state WHERE session_id = ?", [session.id]))[0];
      assert.match(state.last_seen_at, /^2026-10-14 12:00:00/);
      assert.ok(await lookup(now + 60000));
      state = (await connection.query("SELECT last_seen_at FROM auth_session_state WHERE session_id = ?", [session.id]))[0];
      assert.match(state.last_seen_at, /^2026-10-14 12:01:00/);
      assert.equal(await lookup(now + 1860000), null);
      assert.equal(await lookup(session.expiresAt, 86400), null);
      assert.equal(await store.getSession(digest(), { now, idleSeconds: 1800 }), null);
    });

    await t.test("revocation, account suspension and MFA version changes immediately deny existing sessions", async () => {
      const a = (await login()).session;
      const b = (await login()).session;
      assert.ok(await store.getSession(a.tokenHash, { now, idleSeconds: 1800 }));
      await store.revokeSession(a.tokenHash, { now });
      assert.equal(await store.getSession(a.tokenHash, { now, idleSeconds: 1800 }), null);
      assert.ok(await store.getSession(b.tokenHash, { now, idleSeconds: 1800 }));
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [admin.id]);
      assert.equal(await store.getSession(b.tokenHash, { now, idleSeconds: 1800 }), null);
      assert.equal((await login()).accepted, false);
      await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [admin.id]);
      await store.revokeAllSessions(admin.id, { now });
      assert.equal(await store.getSession(b.tokenHash, { now, idleSeconds: 1800 }), null);
      const c = (await login()).session;
      await connection.query("UPDATE admin_mfa SET version = 2 WHERE user_id = ?", [admin.id]);
      assert.equal(await store.getSession(c.tokenHash, { now, idleSeconds: 1800 }), null);
      assert.equal((await login({ recoveryDigest: admin.recoveryDigests[1] })).accepted, false);
      await connection.query("UPDATE admin_recovery_codes SET mfa_version = 2 WHERE user_id = ? AND code_hash = ?", [admin.id, admin.recoveryDigests[1]]);
      assert.equal((await login({ recoveryDigest: admin.recoveryDigests[1] })).accepted, true);
    });

    await t.test("persistent fixed-window rate limits count once per attempt, survive store recreation and serialize concurrency", async () => {
      const key = digest();
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const result = await store.consumeRateLimit(key, { now, windowSeconds: 900, limit: 3 });
        assert.equal(result.allowed, attempt <= 3);
        assert.equal(result.retryAfter, 900);
      }
      assert.equal((await createAuthStore(pool).consumeRateLimit(key, { now: now + 1000, windowSeconds: 900, limit: 3 })).allowed, false);
      assert.equal((await store.consumeRateLimit(key, { now: now + 900000, windowSeconds: 900, limit: 3 })).allowed, true);
      const parallelKey = digest();
      const results = await Promise.all(Array.from({ length: 6 }, () => store.consumeRateLimit(parallelKey, { now, windowSeconds: 60, limit: 3 })));
      assert.equal(results.filter((result) => result.allowed).length, 3);
      assert.equal(Number((await connection.query("SELECT attempts FROM auth_rate_limits WHERE bucket_hash = ?", [parallelKey]))[0].attempts), 6);
    });

    await t.test("bounded limiter pruning removes only windows older than 24 hours and preserves current denials", async () => {
      const expired = digest();
      const current = digest();
      await connection.query("INSERT INTO auth_rate_limits (bucket_hash, window_started_at, attempts) VALUES (?, '2026-10-12 12:00:00', 3)", [expired]);
      await connection.query("INSERT INTO auth_rate_limits (bucket_hash, window_started_at, attempts) VALUES (?, '2026-10-14 12:00:00', 3)", [current]);
      const result = await createAuthStore(pool).consumeRateLimit(current, { now, windowSeconds: 900, limit: 3 });
      assert.equal(result.allowed, false);
      assert.equal((await connection.query("SELECT bucket_hash FROM auth_rate_limits WHERE bucket_hash = ?", [expired])).length, 0);
      assert.equal(Number((await connection.query("SELECT attempts FROM auth_rate_limits WHERE bucket_hash = ?", [current]))[0].attempts), 4);
    });

    await t.test("MFA, recovery, state and limiter database constraints reject malformed or foreign records", async () => {
      const clientId = id();
      await connection.query("INSERT INTO users (id, role, pseudonym, email) VALUES (?, 'client', 'Synthetic client', 'constraint-client@example.invalid')", [clientId]);
      await assert.rejects(connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted) VALUES (?, 'test')", [clientId]));
      await assert.rejects(connection.query("UPDATE admin_mfa SET version = 0 WHERE user_id = ?", [admin.id]));
      await assert.rejects(connection.query("UPDATE admin_mfa SET last_totp_step = -2 WHERE user_id = ?", [admin.id]));
      await assert.rejects(connection.query("INSERT INTO admin_recovery_codes (user_id, code_hash, mfa_version, created_at) VALUES (?, ?, 1, '2026-01-01')", [admin.id, Buffer.alloc(1)]));
      await assert.rejects(connection.query("UPDATE admin_recovery_codes SET consumed_at = '2025-01-01' WHERE user_id = ?", [admin.id]));
      await assert.rejects(connection.query("UPDATE auth_session_state SET mfa_version = 0 WHERE session_id = ?", [firstSession.id]));
      await assert.rejects(connection.query("UPDATE auth_session_state SET last_seen_at = '2025-01-01' WHERE session_id = ?", [firstSession.id]));
      await assert.rejects(connection.query("INSERT INTO auth_rate_limits (bucket_hash, window_started_at, attempts) VALUES (?, '2026-01-01', 1)", [Buffer.alloc(1)]));
    });

    await t.test("runtime account has DML access without schema-changing privileges", async () => {
      const runtime = await pool.getConnection();
      try {
        await assert.rejects(runtime.query("CREATE TABLE auth_forbidden_probe (id INT) ENGINE=InnoDB"));
        await assert.rejects(runtime.query("ALTER TABLE users ADD COLUMN auth_forbidden_probe INT"));
        await assert.rejects(runtime.query("DROP TABLE auth_rate_limits"));
      } finally { runtime.release(); }
    });

    await t.test("runtime pool caps outstanding acquisitions and releases waiting connections", async () => {
      const leases = await Promise.all(Array.from({ length: 4 }, () => pool.getConnection()));
      let waitingLeases = [];
      try {
        const waiting = Array.from({ length: 4 }, () => pool.getConnection());
        await assert.rejects(pool.getConnection(), (error) => error.code === "AUTH_DATABASE_BUSY");
        for (const lease of leases) lease.release();
        waitingLeases = await Promise.all(waiting);
        assert.equal(waitingLeases.length, 4);
      } finally {
        for (const lease of [...leases, ...waitingLeases]) lease.release();
      }
    });

    await t.test("real HTTP, password hashing, encrypted TOTP and MariaDB authenticate, revoke and reject replay together", async () => {
      await reset();
      await applyMigrations(connection, { database: options.database, migrations: await loadMigrations() });
      const e2eNow = Date.now();
      const key = randomBytes(32);
      const adminId = id();
      const secret = makeTotpSecret();
      const password = "Synthetic administrator password 2026!";
      await store.initializeAdmin({ id: adminId, email: "e2e-admin@example.invalid", pseudonym: "Synthetic HTTP admin",
        passwordHash: await hashPassword(password), secretEncrypted: sealTotpSecret(secret, key, adminId),
        recoveryDigests: createRecoveryCodes().map(recoveryCodeDigest), now: e2eNow });
      const service = await createAuthService({ store, totpKey: key, clock: () => e2eNow });
      const origin = "https://example.invalid";
      const server = createAppServer({ authHandler: createAuthHandler(service, { origin }) });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      const headers = { Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1" };
      const payload = { email: "e2e-admin@example.invalid", password, factor: totpCode(secret, { now: e2eNow }) };
      try {
        assert.equal((await fetch(`${base}/api/auth/session`)).status, 401);
        assert.equal((await fetch(`${base}/api/auth/login`, { method: "POST", headers: { ...headers, Origin: "https://other.invalid" }, body: JSON.stringify(payload) })).status, 403);
        const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers, body: JSON.stringify(payload) });
        assert.equal(response.status, 200);
        const cookieHeader = response.headers.get("set-cookie");
        assert.match(cookieHeader, /^__Host-jessie_session=/);
        assert.match(cookieHeader, /; Secure; HttpOnly; SameSite=Strict$/);
        const cookie = cookieHeader.split(";")[0];
        const loggedIn = await response.json();
        assert.equal(loggedIn.user.role, "admin");
        assert.equal(loggedIn.user.pseudonym, "Synthetic HTTP admin");
        assert.equal(Object.hasOwn(loggedIn.user, "email"), false);
        const connected = await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } });
        assert.equal(connected.status, 200);
        assert.deepEqual(await connected.json(), loggedIn);
        assert.equal((await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { ...headers, Cookie: cookie, "X-CSRF-Token": "bad" }, body: "{}" })).status, 403);
        const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { ...headers, Cookie: cookie, "X-CSRF-Token": loggedIn.csrf }, body: "{}" });
        assert.equal(logout.status, 200);
        assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
        assert.equal((await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } })).status, 401);
        assert.equal((await fetch(`${base}/api/auth/login`, { method: "POST", headers, body: JSON.stringify(payload) })).status, 401);
        assert.equal((await connection.query("SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NOT NULL"))[0].count, 1n);
      } finally {
        await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
      }
    });

    await t.test("an ambiguous commit preserves setup material and never silently reinitializes the committed administrator", async () => {
      await reset();
      await applyMigrations(connection, { database: options.database, migrations: await loadMigrations() });
      const uncertainStore = createAuthStore({ async getConnection() {
        const borrowed = await pool.getConnection();
        return { ...borrowed, async commit() { await borrowed.commit(); throw new Error("synthetic loss of commit acknowledgement"); } };
      } });
      const fixture = { ...first, id: id(), email: "commit-acknowledgement@example.invalid", recoveryDigests: Array.from({ length: 8 }, digest) };
      await assert.rejects(uncertainStore.initializeAdmin(fixture), (error) => error.code === "AUTH_BOOTSTRAP_UNCERTAIN" && error.preserveSetupFile === true && error.cause === undefined);
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM users WHERE id = ?", [fixture.id]))[0].count, 1n);
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM admin_recovery_codes WHERE user_id = ?", [fixture.id]))[0].count, 8n);
      await assert.rejects(store.initializeAdmin(fixture), (error) => error.code === "AUTH_ADMIN_EXISTS");
    });
  } finally {
    try { if (pool) await pool.end(); } finally { try { await reset(); } finally { await connection.end(); } }
  }
});
