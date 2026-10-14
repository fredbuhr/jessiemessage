import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createAccessStore, AuthAccessStoreError } from "../server/access/store.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16);
const digest = () => randomBytes(32);
const now = Date.UTC(2026, 9, 14, 12);
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const passwordHash = "synthetic-client-hash-not-a-real-credential";

test("real MariaDB invitation and restricted client access persistence (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 120000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "integration tests require separately provisioned runtime DML credentials");
  const migrations = await loadMigrations();
  // Derived only from validated application CREATE TABLE statements, with the
  // same unrelated-table refusal as the migration tests. Reverse order respects
  // foreign keys without temporarily disabling their enforcement.
  const ownedTables = migrations.map((migration) => /^CREATE\s+TABLE\s+([a-z][a-z0-9_]*)\s*\(/i.exec(migration.sql.trim())[1]).reverse();
  const allowedTables = [...ownedTables, "migration_probe", "schema_migrations"];
  const connection = await connectDatabase();
  let pool;
  let sequence = 0;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset();
    await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const store = createAccessStore(pool);
    const authStore = createAuthStore(pool);
    const admin = { id: id(), tokenHash: digest(), sessionId: id() };
    await connection.query("INSERT INTO users (id, role, status, pseudonym, email, password_hash, created_at, updated_at) VALUES (?, 'admin', 'active', 'Synthetic administrator', 'access-admin@example.invalid', 'synthetic-admin-hash', ?, ?)", [admin.id, sqlDate(now), sqlDate(now)]);
    await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic-encrypted-secret', 1, 1, ?)", [admin.id, sqlDate(now)]);
    await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [admin.sessionId, admin.id, admin.tokenHash, sqlDate(now), sqlDate(now + 8 * 3600000)]);
    await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [admin.sessionId, sqlDate(now), sqlDate(now)]);

    async function invitation(extra = {}) {
      const fixture = { actorTokenHash: admin.tokenHash, now, id: id(), tokenHash: digest(), expiresAt: now + 3600000, accessDays: 2, ...extra };
      assert.ok(await store.createInvitation(fixture));
      return fixture;
    }
    function registration(invite, extra = {}) {
      return { invitationHash: invite.tokenHash, now, user: { id: id(), email: `client-${sequence++}@example.invalid`, pseudonym: "Synthetic client", passwordHash },
        verification: { id: id(), tokenHash: digest(), expiresAt: now + 3600000 }, mail: { id: id(), payloadEncrypted: "synthetic-encrypted-mail" }, ...extra };
    }
    async function registered(extra = {}, inviteExtra = {}) {
      const invite = await invitation(inviteExtra);
      const fixture = registration(invite, extra);
      assert.equal(await store.register(fixture), true);
      return { ...fixture, invite };
    }
    async function verify(fixture, at = now) {
      assert.equal(await store.verifyEmail(fixture.verification.tokenHash, { now: at }), true);
    }
    async function login(fixture, extra = {}) {
      const session = { id: id(), tokenHash: digest(), expiresAt: now + 8 * 3600000, ...extra };
      const accepted = await store.completeClientLogin({ userId: fixture.user.id, expectedPasswordHash: fixture.user.passwordHash, expectedVersion: 1, now, session });
      return { accepted, session };
    }
    const lookup = (session, at = now, idleSeconds = 1800) => store.getClientSession(session.tokenHash, { now: at, idleSeconds });

    await t.test("read-only schema checks reject pending history, nullable credential state and lost token uniqueness", async () => {
      assert.equal(await store.assertSchema(), true);
      await connection.query("UPDATE schema_migrations SET state = 'failed', finished_at = NULL WHERE version = ?", [migrations.at(-1).version]);
      try { await assert.rejects(store.assertSchema(), (error) => error.code === "ACCESS_DATABASE_STATE"); }
      finally { await connection.query("UPDATE schema_migrations SET state = 'applied', finished_at = CURRENT_TIMESTAMP(6) WHERE version = ?", [migrations.at(-1).version]); }
      await connection.query("ALTER TABLE client_session_state MODIFY credential_version INT UNSIGNED NULL");
      try { await assert.rejects(store.assertSchema(), (error) => error.code === "ACCESS_DATABASE_STATE"); }
      finally { await connection.query("ALTER TABLE client_session_state MODIFY credential_version INT UNSIGNED NOT NULL"); }
      await connection.query("ALTER TABLE email_verifications DROP INDEX email_verifications_token_hash");
      try { await assert.rejects(store.assertSchema(), (error) => error.code === "ACCESS_DATABASE_STATE"); }
      finally { await connection.query("ALTER TABLE email_verifications ADD UNIQUE KEY email_verifications_token_hash (token_hash)"); }
      assert.equal(await store.assertSchema(), true);
    });

    await t.test("administrator mutations recheck persisted session, status, MFA generation and idle deadline", async () => {
      const payload = { actorTokenHash: digest(), now, id: id(), tokenHash: digest(), expiresAt: now + 3600000, accessDays: null };
      assert.equal(await store.createInvitation(payload), null);
      assert.equal(await store.listClients(digest(), { now }), null);
      assert.equal(await store.createInvitation({ ...payload, actorTokenHash: admin.tokenHash, now: now + 1800000 }), null);
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [sqlDate(now), admin.sessionId]);
      assert.equal(await store.createInvitation({ ...payload, actorTokenHash: admin.tokenHash }), null);
      await connection.query("UPDATE sessions SET revoked_at = NULL WHERE id = ?", [admin.sessionId]);
      await connection.query("UPDATE admin_mfa SET version = 2 WHERE user_id = ?", [admin.id]);
      assert.equal(await store.createInvitation({ ...payload, actorTokenHash: admin.tokenHash }), null);
      await connection.query("UPDATE admin_mfa SET version = 1 WHERE user_id = ?", [admin.id]);
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [admin.id]);
      assert.equal(await store.createInvitation({ ...payload, actorTokenHash: admin.tokenHash }), null);
      await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [admin.id]);
      assert.ok(await store.createInvitation({ ...payload, actorTokenHash: admin.tokenHash }));
      const listed = await store.listInvitations(admin.tokenHash, { now });
      assert.ok(listed.length);
      assert.ok(listed.every((item) => !Object.hasOwn(item, "tokenHash") && !Object.hasOwn(item, "token")));
    });

    await t.test("concurrent invitation use creates exactly one pending client and atomically enqueues its encrypted verification", async () => {
      const invite = await invitation();
      assert.deepEqual(await store.inspectInvitation(invite.tokenHash, { now }), { expiresAt: invite.expiresAt, accessDays: 2 });
      const one = registration(invite);
      const two = registration(invite);
      const results = await Promise.all([store.register(one), store.register(two)]);
      assert.equal(results.filter(Boolean).length, 1);
      const winner = results[0] ? one : two;
      const loser = results[0] ? two : one;
      assert.equal(await store.inspectInvitation(invite.tokenHash, { now }), null);
      assert.equal(await store.revokeInvitation(admin.tokenHash, invite.id, { now }), false);
      const row = (await connection.query("SELECT status, email_verified_at, age_assured_at, access_approved_at, access_expires_at FROM users WHERE id = ?", [winner.user.id]))[0];
      assert.deepEqual({ ...row }, { status: "pending", email_verified_at: null, age_assured_at: null, access_approved_at: null, access_expires_at: null });
      assert.equal((await connection.query("SELECT id FROM users WHERE id = ?", [loser.user.id])).length, 0);
      assert.match((await connection.query("SELECT age_declared_at FROM client_auth_state WHERE user_id = ?", [winner.user.id]))[0].age_declared_at, /^2026-10-14 12:00:00/);
      const queued = (await connection.query("SELECT verification_id, recipient_user_id, payload_encrypted, status FROM mail_outbox WHERE id = ?", [winner.mail.id]))[0];
      assert.ok(queued.verification_id.equals(winner.verification.id));
      assert.ok(queued.recipient_user_id.equals(winner.user.id));
      assert.equal(queued.payload_encrypted, "synthetic-encrypted-mail");
      assert.equal(queued.status, "pending");
      assert.equal((await login(winner)).accepted, false);
    });

    await t.test("expired, revoked and inactive-issuer invitations cannot register or leak inspection metadata", async () => {
      const expired = await invitation({ expiresAt: now + 1000 });
      assert.equal(await store.inspectInvitation(expired.tokenHash, { now: now + 1000 }), null);
      assert.equal(await store.register(registration(expired, { now: now + 1000 })), false);
      const revoked = await invitation();
      assert.equal(await store.revokeInvitation(admin.tokenHash, revoked.id, { now }), true);
      assert.equal(await store.revokeInvitation(admin.tokenHash, revoked.id, { now }), false);
      assert.equal(await store.inspectInvitation(revoked.tokenHash, { now }), null);
      assert.equal(await store.register(registration(revoked)), false);
      const inactive = await invitation();
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [admin.id]);
      try {
        assert.equal(await store.inspectInvitation(inactive.tokenHash, { now }), null);
        assert.equal(await store.register(registration(inactive)), false);
      } finally { await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [admin.id]); }
    });

    await t.test("duplicate mailbox and failed mail insert roll back client, invitation consumption and verification together", async () => {
      const original = await registered();
      const duplicateInvite = await invitation();
      const duplicate = registration(duplicateInvite);
      duplicate.user.email = original.user.email;
      await assert.rejects(store.register(duplicate), (error) => error instanceof AuthAccessStoreError && error.code === "ACCESS_REGISTRATION_FAILED" && error.cause === undefined);
      assert.ok(await store.inspectInvitation(duplicateInvite.tokenHash, { now }));
      assert.equal((await connection.query("SELECT id FROM users WHERE id = ?", [duplicate.user.id])).length, 0);
      assert.equal((await connection.query("SELECT id FROM mail_outbox WHERE id = ?", [duplicate.mail.id])).length, 0);
      const collision = registration(await invitation());
      collision.mail.id = original.mail.id;
      await assert.rejects(store.register(collision), (error) => error.code === "ACCESS_DATABASE_OPERATION" && error.cause === undefined);
      assert.ok(await store.inspectInvitation(collision.invitationHash, { now }));
      assert.equal((await connection.query("SELECT id FROM users WHERE id = ?", [collision.user.id])).length, 0);
      assert.equal((await connection.query("SELECT id FROM email_verifications WHERE id = ?", [collision.verification.id])).length, 0);
    });

    await t.test("verification is single-use under concurrency and grants neither age assurance nor approved access", async () => {
      const fixture = await registered();
      const results = await Promise.all([store.verifyEmail(fixture.verification.tokenHash, { now }), store.verifyEmail(fixture.verification.tokenHash, { now })]);
      assert.equal(results.filter(Boolean).length, 1);
      assert.equal(await store.verifyEmail(fixture.verification.tokenHash, { now }), false);
      const record = await store.getClientLoginRecord(fixture.user.email);
      assert.deepEqual(record, { id: fixture.user.id, role: "client", status: "pending", passwordHash, emailVerified: true, credentialVersion: 1 });
      assert.equal(await store.approveClient(admin.tokenHash, fixture.user.id, { now }), false);
      const { accepted, session } = await login(fixture);
      assert.equal(accepted, true);
      const connected = await lookup(session);
      assert.equal(connected.access.state, "pending");
      assert.equal(connected.access.emailVerified, true);
      assert.equal(connected.access.ageAssured, false);
      assert.equal(connected.access.approved, false);
      assert.equal(connected.access.expiresAt, null);
      assert.equal((await connection.query("SELECT status FROM mail_outbox WHERE id = ?", [fixture.mail.id]))[0].status, "cancelled");
      const row = (await connection.query("SELECT status, age_assured_at, access_approved_at FROM users WHERE id = ?", [fixture.user.id]))[0];
      assert.equal(row.status, "pending"); assert.equal(row.age_assured_at, null); assert.equal(row.access_approved_at, null);
    });

    await t.test("approval starts the independent access duration and creates one conversation atomically, with both gates required", async () => {
      const fixture = await registered({}, { expiresAt: now + 1000, accessDays: 2 });
      await connection.query("UPDATE users SET age_assured_at = ? WHERE id = ?", [sqlDate(now), fixture.user.id]);
      assert.equal(await store.approveClient(admin.tokenHash, fixture.user.id, { now }), false, "age alone is insufficient");
      await verify(fixture);
      const approvedAt = now + 300000;
      const results = await Promise.all([store.approveClient(admin.tokenHash, fixture.user.id, { now: approvedAt }), store.approveClient(admin.tokenHash, fixture.user.id, { now: approvedAt })]);
      assert.equal(results.filter(Boolean).length, 1);
      const user = (await connection.query("SELECT status, access_approved_at, access_expires_at FROM users WHERE id = ?", [fixture.user.id]))[0];
      assert.equal(user.status, "active");
      assert.equal(user.access_approved_at, sqlDate(approvedAt));
      assert.equal(user.access_expires_at, sqlDate(approvedAt + 2 * 86400000));
      const conversations = await connection.query("SELECT admin_id FROM conversations WHERE client_id = ?", [fixture.user.id]);
      assert.equal(conversations.length, 1); assert.ok(conversations[0].admin_id.equals(admin.id));
      const session = { id: id(), tokenHash: digest(), expiresAt: approvedAt + 3 * 86400000 };
      assert.equal(await store.completeClientLogin({ userId: fixture.user.id, expectedPasswordHash: passwordHash, expectedVersion: 1, now: approvedAt, session }), true);
      assert.equal((await lookup(session, approvedAt)).access.state, "active");
      await connection.query("UPDATE client_session_state SET last_seen_at = ? WHERE session_id = ?", [sqlDate(approvedAt + 2 * 86400000), session.id]);
      assert.equal((await lookup(session, approvedAt + 2 * 86400000)).access.state, "expired");

      const atomic = await registered(); await verify(atomic);
      await connection.query("UPDATE users SET age_assured_at = ? WHERE id = ?", [sqlDate(now), atomic.user.id]);
      await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [id(), atomic.user.id, admin.id, sqlDate(now)]);
      await assert.rejects(store.approveClient(admin.tokenHash, atomic.user.id, { now }), (error) => error.code === "ACCESS_DATABASE_OPERATION");
      const unchanged = (await connection.query("SELECT status, access_approved_at, access_expires_at FROM users WHERE id = ?", [atomic.user.id]))[0];
      assert.equal(unchanged.status, "pending"); assert.equal(unchanged.access_approved_at, null); assert.equal(unchanged.access_expires_at, null);
    });

    await t.test("unlimited access stays explicit; administrator lists expose only bounded review metadata", async () => {
      const fixture = await registered({}, { accessDays: null }); await verify(fixture);
      await connection.query("UPDATE users SET age_assured_at = ? WHERE id = ?", [sqlDate(now), fixture.user.id]);
      assert.equal(await store.approveClient(admin.tokenHash, fixture.user.id, { now }), true);
      const session = (await login(fixture)).session;
      assert.equal((await lookup(session)).access.expiresAt, null);
      const clients = await store.listClients(admin.tokenHash, { now });
      const metadata = clients.find((item) => item.id === fixture.user.id.toString("hex"));
      assert.deepEqual(metadata, { id: fixture.user.id.toString("hex"), pseudonym: fixture.user.pseudonym, email: fixture.user.email,
        status: "active", emailVerified: true, ageAssured: true, approved: true, accessExpiresAt: null });
      assert.ok(clients.every((item) => !Object.hasOwn(item, "passwordHash") && !Object.hasOwn(item, "tokenHash")));
      assert.equal(await store.listClients(session.tokenHash, { now }), null);
    });

    await t.test("client sessions are isolated, enforce idle/absolute expiry and deny suspension or credential changes immediately", async () => {
      const fixture = await registered(); await verify(fixture);
      const { accepted, session } = await login(fixture);
      assert.equal(accepted, true);
      assert.equal(await store.getClientSession(admin.tokenHash, { now, idleSeconds: 1800 }), null);
      assert.equal(await authStore.getSession(session.tokenHash, { now, idleSeconds: 1800 }), null);
      assert.equal(await lookup(session, now + 1800000), null);
      assert.equal(await lookup(session, session.expiresAt, 86400), null);
      assert.ok(await lookup(session, now + 59000));
      assert.equal((await connection.query("SELECT last_seen_at FROM client_session_state WHERE session_id = ?", [session.id]))[0].last_seen_at, sqlDate(now));
      assert.ok(await lookup(session, now + 60000));
      assert.equal((await connection.query("SELECT last_seen_at FROM client_session_state WHERE session_id = ?", [session.id]))[0].last_seen_at, sqlDate(now + 60000));
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [fixture.user.id]);
      assert.equal(await lookup(session, now + 60000), null);
      assert.equal((await login(fixture)).accepted, false);
      await connection.query("UPDATE users SET status = 'pending' WHERE id = ?", [fixture.user.id]);
      await connection.query("UPDATE client_auth_state SET credential_version = 2 WHERE user_id = ?", [fixture.user.id]);
      assert.equal(await lookup(session, now + 60000), null);
      assert.equal((await login(fixture)).accepted, false);
      assert.equal(await store.completeClientLogin({ userId: fixture.user.id, expectedPasswordHash: "stale", expectedVersion: 2, now, session: { id: id(), tokenHash: digest(), expiresAt: now + 10000 } }), false);
      await store.revokeClientSession(admin.tokenHash, { now });
      assert.equal((await connection.query("SELECT revoked_at FROM sessions WHERE id = ?", [admin.sessionId]))[0].revoked_at, null);
      const other = await registered(); await verify(other);
      const a = (await login(other)).session; const b = (await login(other)).session;
      const unrelated = await registered(); await verify(unrelated); const c = (await login(unrelated)).session;
      await store.revokeClientSession(a.tokenHash, { now });
      assert.equal(await lookup(a), null); assert.ok(await lookup(b));
      await store.revokeAllClientSessions(other.user.id, { now });
      assert.equal(await lookup(b), null); assert.ok(await lookup(c));
    });

    await t.test("verification resend atomically invalidates the old link, cancels old jobs and refuses stale credentials", async () => {
      const fixture = await registered();
      const verification = { id: id(), tokenHash: digest(), expiresAt: now + 3600000 };
      const mail = { id: id(), payloadEncrypted: "synthetic-reissued-encrypted-mail" };
      const payload = { userId: fixture.user.id, expectedPasswordHash: passwordHash, expectedVersion: 1, verification, mail, now };
      assert.equal(await store.reissueVerification({ ...payload, expectedPasswordHash: "stale" }), false);
      assert.equal(await store.reissueVerification({ ...payload, expectedVersion: 2 }), false);
      assert.equal(await store.reissueVerification(payload), true);
      assert.equal(await store.verifyEmail(fixture.verification.tokenHash, { now }), false);
      assert.equal((await connection.query("SELECT status FROM mail_outbox WHERE id = ?", [fixture.mail.id]))[0].status, "cancelled");
      assert.equal((await connection.query("SELECT status FROM mail_outbox WHERE id = ?", [mail.id]))[0].status, "pending");
      assert.equal(await store.verifyEmail(verification.tokenHash, { now }), true);
      assert.equal(await store.reissueVerification({ ...payload, verification: { ...verification, id: id(), tokenHash: digest() }, mail: { ...mail, id: id() } }), false);
      assert.equal((await connection.query("SELECT status FROM mail_outbox WHERE id = ?", [mail.id]))[0].status, "cancelled");
      const expired = await registered({ verification: { id: id(), tokenHash: digest(), expiresAt: now + 1000 } });
      assert.equal(await store.verifyEmail(expired.verification.tokenHash, { now: now + 1000 }), false);
    });

    await t.test("revoking clients cancels challenges and all sessions immediately while other clients remain isolated", async () => {
      const pending = await registered();
      assert.equal(await store.revokeClient(admin.tokenHash, pending.user.id, { now }), true);
      assert.equal(await store.verifyEmail(pending.verification.tokenHash, { now }), false);
      assert.equal((await connection.query("SELECT status FROM mail_outbox WHERE id = ?", [pending.mail.id]))[0].status, "cancelled");
      assert.equal(await store.revokeClient(admin.tokenHash, pending.user.id, { now }), false);
      const connected = await registered(); await verify(connected);
      const a = (await login(connected)).session; const b = (await login(connected)).session;
      assert.equal(await store.revokeClient(a.tokenHash, connected.user.id, { now }), false);
      assert.equal(await store.revokeClient(admin.tokenHash, admin.id, { now }), false);
      assert.equal(await store.revokeClient(admin.tokenHash, connected.user.id, { now }), true);
      assert.equal(await lookup(a), null); assert.equal(await lookup(b), null);
      assert.equal((await login(connected)).accepted, false);
    });

    await t.test("new database constraints reject role confusion, malformed tokens, invalid lifetimes and zero versions", async () => {
      await assert.rejects(connection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [admin.id, sqlDate(now)]));
      const fixture = await registered();
      await assert.rejects(connection.query("UPDATE client_auth_state SET credential_version = 0 WHERE user_id = ?", [fixture.user.id]));
      await assert.rejects(connection.query("UPDATE client_auth_state SET role = 'admin' WHERE user_id = ?", [fixture.user.id]));
      await assert.rejects(connection.query("UPDATE email_verifications SET token_hash = ? WHERE id = ?", [Buffer.alloc(1), fixture.verification.id]));
      await assert.rejects(connection.query("UPDATE email_verifications SET expires_at = created_at WHERE id = ?", [fixture.verification.id]));
      await assert.rejects(connection.query("UPDATE email_verifications SET consumed_at = ?, revoked_at = ? WHERE id = ?", [sqlDate(now), sqlDate(now), fixture.verification.id]));
      await verify(fixture);
      const session = (await login(fixture)).session;
      await assert.rejects(connection.query("UPDATE client_session_state SET credential_version = 0 WHERE session_id = ?", [session.id]));
      await assert.rejects(store.register({}), (error) => error.code === "ACCESS_STORE_INPUT" && error.cause === undefined);
    });
  } finally {
    try { if (pool) await pool.end(); } finally { try { await reset(); } finally { await connection.end(); } }
  }
});
