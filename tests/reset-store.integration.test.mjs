import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createResetStore, ResetStoreError } from "../server/reset/store.mjs";
import { createResetMailStore } from "../server/reset/mail-store.mjs";
import { createAccessStore } from "../server/access/store.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16), digest = () => randomBytes(32);
const now = Date.UTC(2026, 9, 15, 12), lifetime = 1800000;
const date = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const errorCode = (expected) => (error) => error instanceof ResetStoreError && error.code === expected && error.cause === undefined;

test("real MariaDB single-use client password recovery and private leased mail (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 180000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "runtime DML credentials must be separately provisioned");
  const migrations = await loadMigrations(); assert.equal(migrations.length, 30);
  const ownedTables = createdMigrationTables(migrations).reverse();
  const allowedTables = [...ownedTables, "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  async function clear() { for (const table of ownedTables) await connection.query(`DELETE FROM ${table}`); }
  async function user({ role = "client", status = "active", verifiedAt = now, credentialVersion = 1,
    passwordHash = "synthetic-original-password-hash", accessExpiresAt = null, createdAt = now } = {}) {
    const value = { id: id(), role, status, credentialVersion, passwordHash, email: `reset-${id().toString("hex")}@example.invalid` };
    await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at,
      age_assured_at, access_approved_at, access_expires_at, created_at, updated_at)
      VALUES (?, ?, ?, 'Synthetic recovery client', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [value.id, role, status, value.email, passwordHash, verifiedAt === null ? null : date(verifiedAt),
      role === "client" ? date(createdAt) : null, role === "client" ? date(createdAt) : null,
      accessExpiresAt === null ? null : date(accessExpiresAt), date(createdAt), date(createdAt)]);
    if (role === "client") await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, ?, ?)", [value.id, credentialVersion, date(createdAt)]);
    return value;
  }
  function request(value, { at = now, expiresAt = at + lifetime, mailId = id(), resetId = id(), tokenHash = digest() } = {}) {
    return { email: value.email, now: at, reset: { id: resetId, tokenHash, expiresAt }, mail: { id: mailId, payloadEncrypted: "v1.synthetic-encrypted-reset-payload" } };
  }
  const inspect = (store, input, at = input.now) => store.inspectReset({ tokenHash: input.reset.tokenHash, now: at });
  const consume = (store, value, input, extra = {}) => store.consumeReset({ tokenHash: input.reset.tokenHash,
    expectedUserId: value.id, expectedVersion: value.credentialVersion, passwordHash: "synthetic-replacement-password-hash", now: input.now + 1, ...extra });
  async function session(value, { createdAt = now, credentialVersion = value.credentialVersion } = {}) {
    const result = { id: id(), tokenHash: digest() };
    await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [result.id, value.id, result.tokenHash, date(createdAt), date(createdAt + 8 * 3600000)]);
    await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, ?)", [result.id, date(createdAt), credentialVersion]);
    return result;
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const store = createResetStore(pool), mail = createResetMailStore(pool), access = createAccessStore(pool);

    await t.test("both stores verify all twenty-two migrations and reject dirty ledgers, column, CHECK, index and FK drift", async () => {
      assert.equal(await store.assertSchema(), true); assert.equal(await mail.assertSchema(), true);
      await connection.query("UPDATE schema_migrations SET state = 'failed', finished_at = NULL WHERE version = ?", [migrations.at(-1).version]);
      try { await assert.rejects(store.assertSchema(), errorCode("RESET_DATABASE_STATE")); }
      finally { await connection.query("UPDATE schema_migrations SET state = 'applied', finished_at = CURRENT_TIMESTAMP(6) WHERE version = ?", [migrations.at(-1).version]); }
      await connection.query("ALTER TABLE password_reset_outbox MODIFY payload_encrypted VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NULL");
      try { await assert.rejects(mail.assertSchema(), errorCode("RESET_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE password_reset_outbox MODIFY payload_encrypted VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NOT NULL"); }
      await connection.query("ALTER TABLE client_password_resets DROP INDEX client_password_resets_token_hash");
      try { await assert.rejects(store.assertSchema(), errorCode("RESET_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE client_password_resets ADD UNIQUE KEY client_password_resets_token_hash (token_hash)"); }
      await connection.query("ALTER TABLE client_password_resets DROP INDEX client_password_resets_token_hash");
      await connection.query("ALTER TABLE client_password_resets ADD UNIQUE KEY client_password_resets_token_hash (token_hash(16))");
      try { await assert.rejects(store.assertSchema(), errorCode("RESET_DATABASE_STATE")); }
      finally {
        await connection.query("ALTER TABLE client_password_resets DROP INDEX client_password_resets_token_hash");
        await connection.query("ALTER TABLE client_password_resets ADD UNIQUE KEY client_password_resets_token_hash (token_hash)");
      }
      await connection.query("ALTER TABLE client_password_resets DROP CONSTRAINT client_password_reset_lifetime");
      await connection.query("ALTER TABLE client_password_resets ADD CONSTRAINT client_password_reset_lifetime CHECK (expires_at > created_at)");
      try { await assert.rejects(store.assertSchema(), errorCode("RESET_DATABASE_STATE")); }
      finally {
        await connection.query("ALTER TABLE client_password_resets DROP CONSTRAINT client_password_reset_lifetime");
        await connection.query("ALTER TABLE client_password_resets ADD CONSTRAINT client_password_reset_lifetime CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL 30 MINUTE)");
      }
      await connection.query("ALTER TABLE password_reset_outbox DROP FOREIGN KEY password_reset_outbox_reset_fk");
      try { await assert.rejects(mail.assertSchema(), errorCode("RESET_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE password_reset_outbox ADD CONSTRAINT password_reset_outbox_reset_fk FOREIGN KEY (reset_id, recipient_user_id) REFERENCES client_password_resets (id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT"); }
      assert.equal(await store.assertSchema(), true);
    });

    await t.test("only verified pending or active clients qualify, including expired access", async () => {
      await clear();
      for (const fixture of [
        { status: "active", expected: true }, { status: "pending", expected: true },
        { status: "active", createdAt: now - 86400000, accessExpiresAt: now - 1, expected: true },
        { role: "admin", expected: false }, { status: "pending", verifiedAt: null, expected: false },
        { status: "pending", verifiedAt: now + 1, expected: false }, { status: "suspended", expected: false },
        { status: "revoked", expected: false }, { status: "deleted", expected: false },
        { status: "pending", passwordHash: null, expected: false }, { credentialVersion: 4294967295, expected: false },
      ]) {
        const value = await user(fixture), input = request(value);
        assert.equal(await store.requestReset(input), fixture.expected, JSON.stringify(fixture));
        assert.equal(Boolean(await inspect(store, input)), fixture.expected);
      }
      const unknown = request({ email: "unknown@example.invalid" }); assert.equal(await store.requestReset(unknown), false);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM client_password_resets"))[0].value), 3);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM password_reset_outbox"))[0].value), 3);
    });

    await t.test("request snapshots only digests and versions, keeps sessions/password and stores no plaintext identity", async () => {
      await clear(); const value = await user(), oldSession = await session(value), input = request(value);
      assert.equal(await store.requestReset(input), true);
      const row = (await connection.query("SELECT * FROM client_password_resets WHERE id = ?", [input.reset.id]))[0];
      assert.deepEqual(row.email_hash, createHash("sha256").update(value.email).digest());
      assert.deepEqual(row.token_hash, input.reset.tokenHash); assert.equal(Number(row.credential_version), 1);
      assert.deepEqual(Object.keys(row).sort(), ["id", "user_id", "token_hash", "credential_version", "email_hash", "created_at", "expires_at", "consumed_at", "revoked_at"].sort());
      const principal = await inspect(store, input); assert.deepEqual(principal, { userId: value.id, credentialVersion: 1 });
      assert.equal((await connection.query("SELECT password_hash FROM users WHERE id = ?", [value.id]))[0].password_hash, value.passwordHash);
      assert.equal((await connection.query("SELECT revoked_at FROM sessions WHERE id = ?", [oldSession.id]))[0].revoked_at, null);
      assert.equal((await connection.query("SELECT consumed_at FROM client_password_resets WHERE id = ?", [input.reset.id]))[0].consumed_at, null);
    });

    await t.test("reissue atomically revokes old and future links and cancels even leased jobs without revoking sessions", async () => {
      await clear(); const value = await user(), oldSession = await session(value), first = request(value);
      await store.requestReset(first); const claimed = await mail.claim({ now }); assert.ok(claimed);
      const futureId = id();
      await connection.query(`INSERT INTO client_password_resets (id, user_id, token_hash, credential_version, email_hash, created_at, expires_at)
        VALUES (?, ?, ?, 1, ?, ?, ?)`, [futureId, value.id, digest(), createHash("sha256").update(value.email).digest(), date(now + 1000), date(now + 2000)]);
      const second = request(value, { at: now + 1 }); assert.equal(await store.requestReset(second), true);
      assert.equal(await inspect(store, first, now + 2), null); assert.ok(await inspect(store, second, now + 2));
      assert.ok((await connection.query("SELECT revoked_at FROM client_password_resets WHERE id = ?", [futureId]))[0].revoked_at);
      assert.equal((await connection.query("SELECT status FROM password_reset_outbox WHERE id = ?", [first.mail.id]))[0].status, "cancelled");
      assert.equal(await mail.markSent(claimed.id, claimed.leaseToken, { now: now + 2 }), false);
      assert.equal((await connection.query("SELECT revoked_at FROM sessions WHERE id = ?", [oldSession.id]))[0].revoked_at, null);
    });

    await t.test("failed queue insertion rolls back token invalidation and cancellation of the previous mail", async () => {
      await clear(); const value = await user(), first = request(value); await store.requestReset(first);
      const retry = request(value, { at: now + 1, mailId: first.mail.id });
      await assert.rejects(store.requestReset(retry), errorCode("RESET_DATABASE_OPERATION"));
      assert.ok(await inspect(store, first, now + 2)); assert.equal(await inspect(store, retry, now + 2), null);
      assert.equal((await connection.query("SELECT status FROM password_reset_outbox WHERE id = ?", [first.mail.id]))[0].status, "pending");
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM client_password_resets"))[0].value), 1);
    });

    await t.test("concurrent requests leave exactly one live link and one queued job", async () => {
      await clear(); const value = await user(), first = request(value), second = request(value);
      assert.deepEqual(await Promise.all([store.requestReset(first), store.requestReset(second)]), [true, true]);
      assert.equal([await inspect(store, first), await inspect(store, second)].filter(Boolean).length, 1);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM password_reset_outbox WHERE status = 'pending'"))[0].value), 1);
    });

    await t.test("consumption changes only credentials and invalidates all sessions including future sessions", async () => {
      await clear(); const value = await user({ status: "pending" }), input = request(value);
      const currentSession = await session(value), futureSession = await session(value, { createdAt: now + 100000 });
      const before = (await connection.query("SELECT * FROM users WHERE id = ?", [value.id]))[0];
      const beforeAuth = (await connection.query("SELECT * FROM client_auth_state WHERE user_id = ?", [value.id]))[0];
      await store.requestReset(input); assert.equal(await consume(store, value, input), true);
      const after = (await connection.query("SELECT * FROM users WHERE id = ?", [value.id]))[0];
      for (const field of Object.keys(before).filter((name) => !["password_hash", "updated_at"].includes(name))) assert.deepEqual(after[field], before[field], field);
      assert.equal(after.password_hash, "synthetic-replacement-password-hash");
      const afterAuth = (await connection.query("SELECT * FROM client_auth_state WHERE user_id = ?", [value.id]))[0];
      assert.equal(Number(afterAuth.credential_version), 2); assert.deepEqual(afterAuth.age_declared_at, beforeAuth.age_declared_at);
      for (const fixture of [currentSession, futureSession]) assert.ok((await connection.query("SELECT revoked_at FROM sessions WHERE id = ?", [fixture.id]))[0].revoked_at);
      assert.equal((await connection.query("SELECT status FROM password_reset_outbox WHERE id = ?", [input.mail.id]))[0].status, "cancelled");
      const token = (await connection.query("SELECT consumed_at, revoked_at FROM client_password_resets WHERE id = ?", [input.reset.id]))[0]; assert.ok(token.consumed_at); assert.equal(token.revoked_at, null);
      assert.equal(await consume(store, value, input, { now: now + 2 }), false); assert.equal(await inspect(store, input, now + 2), null);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM sessions WHERE user_id = ?", [value.id]))[0].value), 2);
    });

    await t.test("two concurrent completions accept once and increment the credential generation once", async () => {
      await clear(); const value = await user(), input = request(value); await store.requestReset(input);
      const results = await Promise.all([consume(store, value, input, { passwordHash: "synthetic-tab-a" }), consume(store, value, input, { passwordHash: "synthetic-tab-b" })]);
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(Number((await connection.query("SELECT credential_version FROM client_auth_state WHERE user_id = ?", [value.id]))[0].credential_version), 2);
      assert.ok(["synthetic-tab-a", "synthetic-tab-b"].includes((await connection.query("SELECT password_hash FROM users WHERE id = ?", [value.id]))[0].password_hash));
    });

    await t.test("expiry, future creation, snapshot email/version, user identity and current status are checked again", async () => {
      for (const reason of ["expired", "future", "email", "version", "identity", "suspended", "revoked", "deleted", "unverified", "proof-future", "overflow"]) {
        await clear(); const value = await user(), input = request(value); await store.requestReset(input);
        let at = now + 1, extra = {};
        if (reason === "expired") at = now + lifetime;
        if (reason === "future") await connection.query("UPDATE client_password_resets SET created_at = ?, expires_at = ? WHERE id = ?", [date(now + 100), date(now + lifetime + 100), input.reset.id]);
        if (reason === "email") await connection.query("UPDATE users SET email = 'changed@example.invalid' WHERE id = ?", [value.id]);
        if (reason === "version") await connection.query("UPDATE client_auth_state SET credential_version = 2 WHERE user_id = ?", [value.id]);
        if (reason === "identity") extra.expectedUserId = id();
        if (["suspended", "revoked", "deleted"].includes(reason)) await connection.query("UPDATE users SET status = ? WHERE id = ?", [reason, value.id]);
        if (reason === "unverified") await connection.query("UPDATE users SET status = 'pending', email_verified_at = NULL WHERE id = ?", [value.id]);
        if (reason === "proof-future") await connection.query("UPDATE users SET email_verified_at = ? WHERE id = ?", [date(now + 100), value.id]);
        if (reason === "overflow") await connection.query("UPDATE client_auth_state SET credential_version = 4294967295 WHERE user_id = ?", [value.id]);
        assert.equal(await consume(store, value, input, { now: at, ...extra }), false, reason);
        if (reason !== "identity") assert.equal(await inspect(store, input, at), null, reason);
        assert.equal((await connection.query("SELECT password_hash FROM users WHERE id = ?", [value.id]))[0].password_hash, value.passwordHash, reason);
      }
    });

    await t.test("a login checked with the old password/version cannot survive a racing reset", async () => {
      await clear(); const value = await user(), input = request(value); await store.requestReset(input);
      const loginSession = { id: id(), tokenHash: digest(), expiresAt: now + 3600000 };
      const results = await Promise.all([
        consume(store, value, input),
        access.completeClientLogin({ userId: value.id, expectedPasswordHash: value.passwordHash, expectedVersion: 1, now: now + 1, session: loginSession }),
      ]);
      assert.equal(results[0], true);
      if (results[1]) assert.ok((await connection.query("SELECT revoked_at FROM sessions WHERE id = ?", [loginSession.id]))[0].revoked_at);
      assert.equal(await access.completeClientLogin({ userId: value.id, expectedPasswordHash: value.passwordHash, expectedVersion: 1,
        now: now + 2, session: { id: id(), tokenHash: digest(), expiresAt: now + 3600000 } }), false);
    });

    await t.test("database constraints enforce thirty-minute lifetime and bind every queued job to its own client", async () => {
      await clear(); const one = await user(), two = await user(), input = request(one); await store.requestReset(input);
      await assert.rejects(connection.query("UPDATE client_password_resets SET expires_at = ? WHERE id = ?", [date(now + lifetime + 1), input.reset.id]));
      await assert.rejects(connection.query(`INSERT INTO password_reset_outbox (id, reset_id, recipient_user_id, payload_encrypted, available_at, expires_at, created_at)
        VALUES (?, ?, ?, 'synthetic-encrypted-payload', ?, ?, ?)`, [id(), input.reset.id, two.id, date(now), date(now + lifetime), date(now)]));
      const admin = await user({ role: "admin" });
      await assert.rejects(connection.query(`INSERT INTO client_password_resets (id, user_id, token_hash, credential_version, email_hash, created_at, expires_at)
        VALUES (?, ?, ?, 1, ?, ?, ?)`, [id(), admin.id, digest(), digest(), date(now), date(now + lifetime)]));
    });

    await t.test("concurrent mail workers claim once and lease acknowledgments cannot be stolen or reused", async () => {
      await clear(); const value = await user(), input = request(value); await store.requestReset(input);
      const results = await Promise.all([mail.claim({ now }), mail.claim({ now })]); assert.equal(results.filter(Boolean).length, 1);
      const job = results.find(Boolean); assert.deepEqual(job.resetId, input.reset.id); assert.deepEqual(job.userId, value.id);
      assert.equal(job.recipientEmail, value.email); assert.equal(job.payloadEncrypted, input.mail.payloadEncrypted); assert.equal(job.attempts, 1);
      assert.equal(await mail.markSent(job.id, id(), { now: now + 1 }), false);
      assert.equal(await mail.markSent(job.id, job.leaseToken, { now: now + 1 }), true);
      assert.equal(await mail.markSent(job.id, job.leaseToken, { now: now + 2 }), false);
      assert.equal(await mail.claim({ now: now + 3 }), null);
      assert.equal((await connection.query("SELECT status FROM password_reset_outbox WHERE id = ?", [job.id]))[0].status, "sent");
    });

    await t.test("expired leases are reclaimed and the stale worker cannot acknowledge success or failure", async () => {
      await clear(); const value = await user(); await store.requestReset(request(value));
      const first = await mail.claim({ now, leaseMilliseconds: 1000 }); assert.equal(await mail.claim({ now: now + 999 }), null);
      const second = await mail.claim({ now: now + 1000, leaseMilliseconds: 1000 });
      assert.deepEqual(second.id, first.id); assert.notDeepEqual(second.leaseToken, first.leaseToken); assert.equal(second.attempts, 2);
      assert.equal(await mail.markSent(first.id, first.leaseToken, { now: now + 1001 }), false);
      assert.equal(await mail.markFailed(first.id, first.leaseToken, { now: now + 1001, code: "MAIL_DELIVERY_FAILED" }), false);
      assert.equal(await mail.markSent(second.id, second.leaseToken, { now: now + 1001 }), true);
    });

    await t.test("unstarted reset-mail claims return their attempt once, including eight-to-seven and a fresh eighth lease", async () => {
      await clear(); const value = await user(), input = request(value); await store.requestReset(input);
      await connection.query("UPDATE password_reset_outbox SET attempts = 7 WHERE id = ?", [input.mail.id]);
      const first = await mail.claim({ now }); assert.equal(first.attempts, 8);
      assert.equal(await mail.releaseClaim(first.id, id(), { now: now + 1 }), false);
      const releases = await Promise.all([mail.releaseClaim(first.id, first.leaseToken, { now: now + 1 }), mail.releaseClaim(first.id, first.leaseToken, { now: now + 1 })]);
      assert.equal(releases.filter(Boolean).length, 1);
      const row = (await connection.query("SELECT status, attempts, lease_token, lease_until, sent_at, last_error FROM password_reset_outbox WHERE id = ?", [first.id]))[0];
      assert.equal(row.status, "pending"); assert.equal(Number(row.attempts), 7); assert.equal(row.lease_token, null); assert.equal(row.lease_until, null);
      assert.equal(row.sent_at, null); assert.equal(row.last_error, null);
      assert.equal(await mail.markSent(first.id, first.leaseToken, { now: now + 1 }), false);
      const second = await mail.claim({ now: now + 2 }); assert.deepEqual(second.id, first.id); assert.equal(second.attempts, 8); assert.notDeepEqual(second.leaseToken, first.leaseToken);
      assert.equal(await mail.releaseClaim(first.id, first.leaseToken, { now: now + 3 }), false);
      assert.equal(await mail.markSent(second.id, second.leaseToken, { now: now + 3 }), true);
      assert.equal(await mail.releaseClaim(second.id, second.leaseToken, { now: now + 4 }), false);
      assert.equal(Number((await connection.query("SELECT attempts FROM password_reset_outbox WHERE id = ?", [second.id]))[0].attempts), 8);
    });

    await t.test("reset-mail release rejects expired, cancelled and superseded leases without changing the fresh reservation", async () => {
      await clear(); const value = await user(); await store.requestReset(request(value, { expiresAt: now + 1000 }));
      const expired = await mail.claim({ now }); assert.equal(await mail.releaseClaim(expired.id, expired.leaseToken, { now: now + 1000 }), false);
      assert.equal(await mail.claim({ now: now + 1000 }), null);
      assert.equal(await mail.releaseClaim(expired.id, expired.leaseToken, { now: now + 1001 }), false);
      await clear(); const current = await user(); await store.requestReset(request(current));
      const first = await mail.claim({ now, leaseMilliseconds: 1000 }), second = await mail.claim({ now: now + 1000 });
      assert.equal(await mail.releaseClaim(first.id, first.leaseToken, { now: now + 1001 }), false);
      const row = (await connection.query("SELECT status, attempts, lease_token FROM password_reset_outbox WHERE id = ?", [second.id]))[0];
      assert.equal(row.status, "sending"); assert.equal(Number(row.attempts), 2); assert.deepEqual(row.lease_token, second.leaseToken);
      assert.equal(await mail.releaseClaim(second.id, second.leaseToken, { now: now + 1001 }), true);
      assert.equal((await mail.claim({ now: now + 1002 })).attempts, 2);
    });

    await t.test("claim cancels every obsolete proof, account status, mailbox or credential snapshot before delivery", async () => {
      for (const reason of ["expired", "revoked-token", "consumed", "revoked-user", "suspended", "deleted", "email", "version", "unverified", "future-proof", "overflow"]) {
        await clear(); const value = await user(), input = request(value); await store.requestReset(input); let at = now + 1;
        if (reason === "expired") at = now + lifetime;
        if (reason === "revoked-token") await connection.query("UPDATE client_password_resets SET revoked_at = ? WHERE id = ?", [date(at), input.reset.id]);
        if (reason === "consumed") await connection.query("UPDATE client_password_resets SET consumed_at = ? WHERE id = ?", [date(at), input.reset.id]);
        if (reason === "revoked-user") await connection.query("UPDATE users SET status = 'revoked' WHERE id = ?", [value.id]);
        if (["suspended", "deleted"].includes(reason)) await connection.query("UPDATE users SET status = ? WHERE id = ?", [reason, value.id]);
        if (reason === "email") await connection.query("UPDATE users SET email = 'changed@example.invalid' WHERE id = ?", [value.id]);
        if (reason === "version") await connection.query("UPDATE client_auth_state SET credential_version = 2 WHERE user_id = ?", [value.id]);
        if (reason === "unverified") await connection.query("UPDATE users SET status = 'pending', email_verified_at = NULL WHERE id = ?", [value.id]);
        if (reason === "future-proof") await connection.query("UPDATE users SET email_verified_at = ? WHERE id = ?", [date(now + 100), value.id]);
        if (reason === "overflow") await connection.query("UPDATE client_auth_state SET credential_version = 4294967295 WHERE user_id = ?", [value.id]);
        assert.equal(await mail.claim({ now: at }), null, reason);
        const job = (await connection.query("SELECT status, attempts, lease_token, lease_until FROM password_reset_outbox WHERE id = ?", [input.mail.id]))[0];
        assert.equal(job.status, "cancelled", reason); assert.equal(Number(job.attempts), 0, reason); assert.equal(job.lease_token, null); assert.equal(job.lease_until, null);
      }
    });

    await t.test("mail retries persist across stores, stop at eight attempts and classify permanent failures safely", async () => {
      await clear(); const value = await user(), input = request(value); await store.requestReset(input);
      // An early lease failure gets the bounded 30-second first retry.
      const first = await mail.claim({ now }); assert.ok(first);
      assert.equal(await mail.markFailed(first.id, first.leaseToken, { now: now + 1, code: "MAIL_DELIVERY_FAILED" }), true);
      assert.equal(await mail.claim({ now: now + 30000 }), null);
      const second = await createResetMailStore(pool).claim({ now: now + 30001 }); assert.equal(second.attempts, 2);
      assert.equal(await mail.markFailed(second.id, second.leaseToken, { now: now + 30002, code: "PAYLOAD_INVALID", permanent: true }), true);
      const row = (await connection.query("SELECT status, last_error FROM password_reset_outbox WHERE id = ?", [input.mail.id]))[0];
      assert.equal(row.status, "failed"); assert.equal(row.last_error, "PAYLOAD_INVALID");
      const next = request(value, { at: now + 30003 }); await store.requestReset(next);
      await connection.query("UPDATE password_reset_outbox SET attempts = 7 WHERE id = ?", [next.mail.id]);
      const eighth = await mail.claim({ now: now + 30003 }); assert.equal(eighth.attempts, 8);
      await mail.markFailed(eighth.id, eighth.leaseToken, { now: now + 30004, code: "MAIL_DELIVERY_FAILED" });
      assert.equal((await connection.query("SELECT status FROM password_reset_outbox WHERE id = ?", [next.mail.id]))[0].status, "failed");
      assert.equal(await mail.claim({ now: now + 30005 }), null);
    });

    await t.test("token expiry caps a lease and makes an already accepted SMTP acknowledgment stale", async () => {
      await clear(); const value = await user(), input = request(value, { expiresAt: now + 1000 }); await store.requestReset(input);
      const job = await mail.claim({ now }); assert.ok(job);
      assert.equal(await mail.markSent(job.id, job.leaseToken, { now: now + 1000 }), false);
      assert.equal(await mail.markFailed(job.id, job.leaseToken, { now: now + 1000, code: "MAIL_DELIVERY_FAILED" }), false);
      assert.equal(await mail.claim({ now: now + 1000 }), null);
      assert.equal((await connection.query("SELECT status FROM password_reset_outbox WHERE id = ?", [job.id]))[0].status, "cancelled");
    });

    await t.test("retention cleanup is bounded and throttled and leaves recent jobs and their token records intact", async () => {
      await clear(); const value = await user({ createdAt: now - 10 * 86400000, verifiedAt: now - 10 * 86400000 });
      const old = request(value, { at: now - 10 * 86400000 }); await store.requestReset(old);
      const recent = request(value); await store.requestReset(recent); const fresh = createResetMailStore(pool);
      assert.equal(await fresh.prune({ now }), 1);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM password_reset_outbox WHERE id = ?", [recent.mail.id]))[0].value), 1);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM client_password_resets"))[0].value), 2);
      assert.equal(await fresh.prune({ now: now + 299999 }), 0);
      assert.equal(await fresh.prune({ now: now + 300000 }), 0);
    });

    await t.test("strict persistence inputs and SQL failures disclose only fixed error codes", async () => {
      const value = { email: "synthetic@example.invalid" };
      await assert.rejects(store.requestReset(request(value, { expiresAt: now + lifetime + 1 })), errorCode("RESET_STORE_INPUT"));
      await assert.rejects(store.requestReset({ ...request(value), email: "SYNTHETIC@example.invalid" }), errorCode("RESET_STORE_INPUT"));
      await assert.rejects(store.requestReset({ ...request(value), mail: { id: id(), payloadEncrypted: "synthetic\n" } }), errorCode("RESET_STORE_INPUT"));
      await assert.rejects(store.inspectReset({ tokenHash: Buffer.alloc(31), now }), errorCode("RESET_STORE_INPUT"));
      await assert.rejects(store.consumeReset({ tokenHash: digest(), expectedUserId: id(), expectedVersion: 0, passwordHash: "synthetic", now }), errorCode("RESET_STORE_INPUT"));
      await assert.rejects(store.consumeReset({ tokenHash: digest(), expectedUserId: id(), expectedVersion: 1, passwordHash: "synthetic\n", now }), errorCode("RESET_STORE_INPUT"));
      await assert.rejects(mail.claim({ now, leaseMilliseconds: 999 }), errorCode("RESET_STORE_INPUT"));
      await assert.rejects(mail.markFailed(id(), id(), { now, code: "private SQL details" }), errorCode("RESET_STORE_INPUT"));
      const broken = createResetStore({ async getConnection() { throw new Error("private-token-email-SQL"); } });
      await assert.rejects(broken.inspectReset({ tokenHash: digest(), now }), (error) => errorCode("RESET_DATABASE_OPERATION")(error) && !error.message.includes("private-token-email-SQL"));
    });
  } finally {
    try { if (pool) await pool.end(); } finally { try { await reset(); } finally { await connection.end(); } }
  }
});
