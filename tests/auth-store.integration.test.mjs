import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { ADMIN_SESSION_SECONDS } from "../server/auth/session-policy.mjs";
import { createAuthStore, AuthStoreError } from "../server/auth/store.mjs";
import { createAccessStore } from "../server/access/store.mjs";
import { createAuthService } from "../server/auth/service.mjs";
import { createAuthHandler } from "../server/auth/http.mjs";
import { createAppServer } from "../server/index.mjs";
import { hashPassword, makeTotpSecret, sealTotpSecret, createRecoveryCodes, recoveryCodeDigest, totpCode } from "../server/auth/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16);
const digest = () => randomBytes(32);
const now = Date.UTC(2026, 9, 14, 12);
const passwordHash = "synthetic-password-hash-not-a-real-credential";
const allowedTables = ["push_outbox", "push_subscriptions", "media_storage_objects", "media_storage_state", "broadcast_recipients", "broadcast_campaigns", "broadcast_preferences", "password_reset_outbox", "client_password_resets", "crm_memberships", "crm_labels", "crm_profiles", "message_media", "media_assets", "chat_events", "chat_receipts", "messages", "mail_outbox", "client_session_state", "email_verifications", "client_auth_state", "auth_session_state", "admin_recovery_codes", "admin_mfa", "auth_rate_limits", "conversations", "sessions", "invitations", "users", "migration_probe", "schema_migrations"];

test("real MariaDB administrator authentication persistence (synthetic disposable database only)", { skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 120000 }, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "integration tests require separately provisioned runtime DML credentials");
  const migrations = await loadMigrations();
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
    await applyMigrations(connection, { database: options.database, migrations });
    assert.equal(await store.assertSchema(), true);

    await t.test("read-only startup checks reject dirty history, nullable state drift and missing uniqueness", async () => {
      await connection.query("UPDATE schema_migrations SET state = 'failed', finished_at = NULL WHERE version = ?", [migrations.at(-1).version]);
      try { await assert.rejects(store.assertSchema(), (error) => error.code === "AUTH_DATABASE_STATE"); }
      finally { await connection.query("UPDATE schema_migrations SET state = 'applied', finished_at = CURRENT_TIMESTAMP(6) WHERE version = ?", [migrations.at(-1).version]); }
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
      const session = { id: id(), tokenHash: digest(), expiresAt: now + ADMIN_SESSION_SECONDS * 1000, ...extra };
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

    await t.test("administrator lookup ignores idle, extends its lifetime and limits last-seen writes", async () => {
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
      assert.ok(await lookup(now + 1860000));
      const renewed = await lookup(now + 8 * 3600000, 86400);
      assert.equal(renewed.expiresAt, now + 8 * 3600000 + ADMIN_SESSION_SECONDS * 1000);
      assert.equal(await lookup(renewed.expiresAt), null);
      assert.equal(await store.getSession(digest(), { now, idleSeconds: 1800 }), null);
    });

    await t.test("administrator session reads and invitation mutations share a consistent lock order under concurrency", async () => {
      const { session } = await login();
      const access = createAccessStore(pool);
      const initialCount = Number((await connection.query("SELECT COUNT(*) AS count FROM invitations"))[0].count);
      // Four outstanding operations per wave stay within the real pool's cap.
      // Reads and mutations contend on the same administrator and session.
      for (let wave = 0; wave < 10; wave += 1) {
        const results = await Promise.all([
          store.getSession(session.tokenHash, { now, idleSeconds: 1800 }),
          access.createInvitation({ actorTokenHash: session.tokenHash, now, id: id(), tokenHash: digest(), expiresAt: now + 3600000, accessDays: 30 }),
          store.getSession(session.tokenHash, { now, idleSeconds: 1800 }),
          access.createInvitation({ actorTokenHash: session.tokenHash, now, id: id(), tokenHash: digest(), expiresAt: now + 3600000, accessDays: null }),
        ]);
        assert.ok(results.every(Boolean), "all valid concurrent reads and mutations must complete without database errors");
        assert.deepEqual(results[0].userId, admin.id);
        assert.deepEqual(results[2].userId, admin.id);
      }
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS count FROM invitations"))[0].count), initialCount + 20);
    });

    await t.test("administrator session timestamps cannot claim a future enrollment or verification before session creation", async () => {
      const { session } = await login();
      const lookup = () => store.getSession(session.tokenHash, { now, idleSeconds: 1800 });
      assert.ok(await lookup());
      await connection.query("UPDATE admin_mfa SET enabled_at = '2026-10-14 12:00:01' WHERE user_id = ?", [admin.id]);
      try { assert.equal(await lookup(), null); }
      finally { await connection.query("UPDATE admin_mfa SET enabled_at = '2026-10-14 12:00:00' WHERE user_id = ?", [admin.id]); }
      await connection.query("UPDATE auth_session_state SET mfa_verified_at = '2026-10-14 11:59:59' WHERE session_id = ?", [session.id]);
      try { assert.equal(await lookup(), null); }
      finally { await connection.query("UPDATE auth_session_state SET mfa_verified_at = '2026-10-14 12:00:00' WHERE session_id = ?", [session.id]); }
      await connection.query("UPDATE sessions SET created_at = '2026-10-14 12:00:01' WHERE id = ?", [session.id]);
      try { assert.equal(await lookup(), null); }
      finally { await connection.query("UPDATE sessions SET created_at = '2026-10-14 12:00:00' WHERE id = ?", [session.id]); }
      assert.ok(await lookup());
    });

    await t.test("device management is paginated, owner scoped and revokes one device without disturbing its siblings", async () => {
      const a = (await login()).session, b = (await login()).session;
      const otherAdmin = id(), otherSession = id(), otherHash = digest();
      await connection.query("INSERT INTO users (id, role, status, pseudonym, email, password_hash, created_at, updated_at) VALUES (?, 'admin', 'active', 'Other synthetic admin', 'other-device-admin@example.invalid', ?, ?, ?)", [otherAdmin, passwordHash, new Date(now), new Date(now)]);
      try {
        await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic', 1, 1, ?)", [otherAdmin, new Date(now)]);
        await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [otherSession, otherAdmin, otherHash, new Date(now), new Date(now + ADMIN_SESSION_SECONDS * 1000)]);
        await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [otherSession, new Date(now), new Date(now)]);
        const seen = new Set(); let afterId = null;
        do {
          const page = await store.listDevices(a.tokenHash, { now, afterId, limit: 2 });
          assert.ok(page.devices.length <= 2);
          for (const device of page.devices) {
            assert.equal(device.id.equals(otherSession), false);
            assert.equal(seen.has(device.id.toString("hex")), false);
            seen.add(device.id.toString("hex"));
            assert.deepEqual(Object.keys(device).sort(), ["createdAt", "current", "id", "lastSeenAt"]);
            assert.equal(device.current, device.id.equals(a.id));
          }
          afterId = page.nextCursor;
          assert.equal(page.hasMore, afterId !== null);
        } while (afterId !== null);
        assert.ok(seen.has(a.id.toString("hex"))); assert.ok(seen.has(b.id.toString("hex")));
        assert.deepEqual(await store.revokeDevice(a.tokenHash, otherSession, { now }), { found: false, current: false });
        assert.ok(await store.getSession(otherHash, { now, idleSeconds: 1800 }));
        assert.deepEqual(await store.revokeDevice(a.tokenHash, b.id, { now }), { found: true, current: false });
        assert.equal(await store.getSession(b.tokenHash, { now, idleSeconds: 1800 }), null);
        assert.ok(await store.getSession(a.tokenHash, { now, idleSeconds: 1800 }));
        assert.deepEqual(await store.revokeDevice(a.tokenHash, a.id, { now }), { found: true, current: true });
        assert.equal(await store.listDevices(a.tokenHash, { now }), null);
      } finally {
        await connection.query("DELETE FROM auth_session_state WHERE session_id = ?", [otherSession]);
        await connection.query("DELETE FROM sessions WHERE user_id = ?", [otherAdmin]);
        await connection.query("DELETE FROM admin_mfa WHERE user_id = ?", [otherAdmin]);
        await connection.query("DELETE FROM users WHERE id = ?", [otherAdmin]);
      }
    });

    await t.test("global sign-out waits for the account lock shared with simultaneous device operations", async () => {
      const a = (await login()).session, b = (await login()).session;
      let revoke, listing, removed, outcome;
      await connection.beginTransaction();
      try {
        await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [admin.id]);
        revoke = store.revokeAllSessions(admin.id, { now });
        listing = store.listDevices(b.tokenHash, { now });
        removed = store.revokeDevice(b.tokenHash, a.id, { now });
        outcome = await Promise.race([revoke.then(() => "finished"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 100))]);
      } finally { await connection.rollback(); }
      await Promise.all([revoke, listing, removed]);
      assert.equal(outcome, "waiting", "global revocation must not take any session lock while the account lock is unavailable");
      assert.equal(await store.getSession(a.tokenHash, { now, idleSeconds: 1800 }), null);
      assert.equal(await store.getSession(b.tokenHash, { now, idleSeconds: 1800 }), null);
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

    await t.test("a refused network preserves the shared quota for another network and across window rollover", async () => {
      const aggregate = digest(), blocked = digest(), other = digest();
      const consume = (network, at = now) => store.consumeRateLimit(aggregate, { now: at, windowSeconds: 60, limit: 3,
        network: { bucketHash: network, windowSeconds: 900, limit: 1 } });
      assert.equal((await consume(blocked)).allowed, true);
      const snapshot = await connection.query("SELECT bucket_hash, window_started_at, attempts FROM auth_rate_limits WHERE bucket_hash IN (?, ?) ORDER BY bucket_hash", [aggregate, blocked]);
      for (let index = 0; index < 8; index++) {
        const refused = await consume(blocked);
        assert.equal(refused.allowed, false); assert.equal(refused.retryAfter, 900);
      }
      assert.deepEqual(await connection.query("SELECT bucket_hash, window_started_at, attempts FROM auth_rate_limits WHERE bucket_hash IN (?, ?) ORDER BY bucket_hash", [aggregate, blocked]), snapshot);
      assert.equal((await consume(other)).allowed, true);
      const beforeRollover = await connection.query("SELECT window_started_at, attempts FROM auth_rate_limits WHERE bucket_hash = ?", [aggregate]);
      const refused = await consume(blocked, now + 60000);
      assert.equal(refused.allowed, false); assert.equal(refused.retryAfter, 840);
      assert.deepEqual(await connection.query("SELECT window_started_at, attempts FROM auth_rate_limits WHERE bucket_hash = ?", [aggregate]), beforeRollover);
      assert.equal((await consume(digest(), now + 60000)).allowed, true);
      assert.equal(Number((await connection.query("SELECT attempts FROM auth_rate_limits WHERE bucket_hash = ?", [aggregate]))[0].attempts), 1);
      assert.equal((await consume(blocked, now + 900000)).allowed, true);
    });

    await t.test("public quotas bound counter cardinality when addresses rotate after aggregate exhaustion", async () => {
      const aggregate = digest(), networks = Array.from({ length: 30 }, digest);
      for (let index = 0; index < networks.length; index++) {
        const result = await store.consumeRateLimit(aggregate, { now, windowSeconds: 60, limit: 3,
          network: { bucketHash: networks[index], windowSeconds: 900, limit: 2 } });
        assert.equal(result.allowed, index < 3);
      }
      const rows = await connection.query(`SELECT bucket_hash FROM auth_rate_limits WHERE bucket_hash IN (${networks.map(() => "?").join(",")})`, networks);
      assert.deepEqual(rows.map((row) => row.bucket_hash.toString("hex")).sort(), networks.slice(0, 3).map((hash) => hash.toString("hex")).sort());
      const untouchedAggregate = digest(), exhaustedNetwork = digest();
      await store.consumeRateLimit(exhaustedNetwork, { now, windowSeconds: 900, limit: 1 });
      const refused = await store.consumeRateLimit(untouchedAggregate, { now, windowSeconds: 60, limit: 3,
        network: { bucketHash: exhaustedNetwork, windowSeconds: 900, limit: 1 } });
      assert.equal(refused.allowed, false);
      assert.equal((await connection.query("SELECT bucket_hash FROM auth_rate_limits WHERE bucket_hash = ?", [untouchedAggregate])).length, 0);
      assert.equal(Number((await connection.query("SELECT attempts FROM auth_rate_limits WHERE bucket_hash = ?", [exhaustedNetwork]))[0].attempts), 1);
    });

    await t.test("concurrent public requests cannot overspend a network or create rows beyond the shared ceiling", async () => {
      const aggregate = digest(), network = digest(), another = digest();
      const consume = (hash, shared = aggregate, limit = 10) => createAuthStore(pool).consumeRateLimit(shared, { now, windowSeconds: 60, limit,
        network: { bucketHash: hash, windowSeconds: 900, limit: 3 } });
      const results = await Promise.all(Array.from({ length: 6 }, () => consume(network)));
      assert.equal(results.filter((result) => result.allowed).length, 3);
      assert.equal(Number((await connection.query("SELECT attempts FROM auth_rate_limits WHERE bucket_hash = ?", [aggregate]))[0].attempts), 3);
      assert.equal((await consume(another)).allowed, true);
      const second = digest(), rotating = Array.from({ length: 6 }, digest);
      const raced = await Promise.all(rotating.map((hash) => consume(hash, second, 3)));
      assert.equal(raced.filter((result) => result.allowed).length, 3);
      const rows = await connection.query(`SELECT bucket_hash FROM auth_rate_limits WHERE bucket_hash IN (${rotating.map(() => "?").join(",")})`, rotating);
      assert.equal(rows.length, 3);
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
