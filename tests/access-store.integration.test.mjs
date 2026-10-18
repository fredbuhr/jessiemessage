import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { ADMIN_SESSION_SECONDS } from "../server/auth/session-policy.mjs";
import { createAccessStore, AuthAccessStoreError } from "../server/access/store.mjs";
import { decodeAccessCursor, encodeAccessCursor } from "../server/access/pagination.mjs";

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
  const ownedTables = createdMigrationTables(migrations).reverse();
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
    // Each subtest starts at its own synthetic instant. Administrator mutations
    // now update real activity, so a preceding future-dated scenario must not
    // make the shared fixture look corrupt when the next scenario rewinds.
    async function resetAdministratorClock() {
      await connection.query("UPDATE auth_session_state SET last_seen_at = ? WHERE session_id = ?", [sqlDate(now), admin.sessionId]);
      await connection.query("UPDATE sessions SET expires_at = ? WHERE id = ?", [sqlDate(now + 8 * 3600000), admin.sessionId]);
    }
    t.beforeEach(resetAdministratorClock);

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

    await t.test("read-only schema checks require the physical manual admission CHECK even with a clean ledger", async () => {
      const admissionMigration = migrations.find((migration) => migration.name === "0028_manual_client_admission.sql");
      assert.equal(admissionMigration?.version, 28, "restore the specific admission CHECK, independently of later migrations");
      for (const clause of ["1", "role <> 'client' OR status <> 'active' OR access_approved_at IS NOT NULL",
        "role <> 'client' OR status <> 'active' OR (email_verified_at IS NOT NULL AND age_assured_at IS NOT NULL AND access_approved_at IS NOT NULL)"]) {
        await connection.query(`ALTER TABLE users DROP CONSTRAINT users_active_client_gates,
          ADD CONSTRAINT users_active_client_gates CHECK (${clause})`);
        try { await assert.rejects(store.assertSchema(), (error) => error.code === "ACCESS_DATABASE_STATE"); }
        finally { await connection.query(admissionMigration.sql); }
      }
      assert.equal(await store.assertSchema(), true);
    });

    await t.test("administrator mutations recheck persisted session, status, MFA generation and absolute deadline", async () => {
      const payload = { actorTokenHash: digest(), now, id: id(), tokenHash: digest(), expiresAt: now + 3600000, accessDays: null };
      assert.equal(await store.createInvitation(payload), null);
      assert.equal(await store.listClients(digest(), { now }), null);
      const boundary = now + 1;
      await connection.query("UPDATE sessions SET expires_at = ? WHERE id = ?", [sqlDate(boundary), admin.sessionId]);
      assert.equal(await store.createInvitation({ ...payload, actorTokenHash: admin.tokenHash, now: boundary }), null);
      await connection.query("UPDATE sessions SET expires_at = ? WHERE id = ?", [sqlDate(now + 8 * 3600000), admin.sessionId]);
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
      assert.ok(listed.invitations.length);
      assert.ok(listed.invitations.every((item) => !Object.hasOwn(item, "tokenHash") && !Object.hasOwn(item, "token")));
    });

    await t.test("administrator access ignores idle and slides only the acting device while an expired grant stays expired", async () => {
      const device = { id: id(), tokenHash: digest() };
      const originalExpiry = now + 8 * 3600000;
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [device.id, admin.id, device.tokenHash, sqlDate(now), sqlDate(originalExpiry)]);
      await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [device.id, sqlDate(now), sqlDate(now)]);
      const at = now + 31 * 60000;
      const invite = { actorTokenHash: device.tokenHash, id: id(), tokenHash: digest(), now: at, expiresAt: at + 3600000, accessDays: 2 };
      assert.ok(await store.createInvitation(invite));
      const expiry = at + ADMIN_SESSION_SECONDS * 1000;
      const acting = (await connection.query("SELECT s.expires_at, a.last_seen_at FROM sessions s JOIN auth_session_state a ON a.session_id = s.id WHERE s.id = ?", [device.id]))[0];
      assert.equal(acting.expires_at, sqlDate(expiry));
      assert.equal(acting.last_seen_at, sqlDate(at));
      const other = (await connection.query("SELECT s.expires_at, a.last_seen_at FROM sessions s JOIN auth_session_state a ON a.session_id = s.id WHERE s.id = ?", [admin.sessionId]))[0];
      assert.deepEqual({ ...other }, { expires_at: sqlDate(originalExpiry), last_seen_at: sqlDate(now) });
      assert.equal(await store.listClients(device.tokenHash, { now: expiry }), null);
      assert.equal((await connection.query("SELECT expires_at FROM sessions WHERE id = ?", [device.id]))[0].expires_at, sqlDate(expiry));
    });

    await t.test("administrator mutation refreshes authority after waiting for another device request", async () => {
      let at = now, observed;
      const candidateRead = new Promise((resolve) => { observed = resolve; });
      const observedStore = createAccessStore({ getConnection: async () => {
        const runtimeConnection = await pool.getConnection();
        return { ...runtimeConnection, query: async (...arguments_) => {
          const result = await runtimeConnection.query(...arguments_);
          if (arguments_[0] === "SELECT user_id FROM sessions WHERE token_hash = ? LIMIT 1") observed();
          return result;
        } };
      } }, { clock: () => at });
      const invite = { actorTokenHash: admin.tokenHash, id: id(), tokenHash: digest(), now, expiresAt: now + 3600000, accessDays: 2 };
      await connection.beginTransaction();
      let pending;
      try {
        await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [admin.id]);
        pending = observedStore.createInvitation(invite);
        await candidateRead;
        at = now + 120000;
        await connection.query("UPDATE auth_session_state SET last_seen_at = ? WHERE session_id = ?", [sqlDate(at), admin.sessionId]);
        await connection.commit();
        const created = await pending;
        assert.ok(created, "a stale pre-lock request instant must not reject newer persisted activity");
        assert.equal(created.expiresAt, at + 3600000);
        assert.equal((await connection.query("SELECT created_at FROM invitations WHERE id = ?", [invite.id]))[0].created_at, sqlDate(at));
      } finally { try { await connection.rollback(); } catch {} if (pending) await pending.catch(() => {}); }
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

    await t.test("manual approval requires verified email and the consumed invitation, preserves absent age evidence and creates one conversation atomically", async () => {
      const fixture = await registered({}, { expiresAt: now + 1000, accessDays: 2 });
      assert.equal(await store.approveClient(admin.tokenHash, fixture.user.id, { now }), false, "the invitation alone does not verify email");
      await verify(fixture);
      const approvedAt = now + 300000;
      const results = await Promise.all([store.approveClient(admin.tokenHash, fixture.user.id, { now: approvedAt }), store.approveClient(admin.tokenHash, fixture.user.id, { now: approvedAt })]);
      assert.equal(results.filter(Boolean).length, 1);
      const user = (await connection.query("SELECT status, age_assured_at, access_approved_at, access_expires_at FROM users WHERE id = ?", [fixture.user.id]))[0];
      assert.equal(user.status, "active"); assert.equal(user.age_assured_at, null);
      assert.equal(user.access_approved_at, sqlDate(approvedAt));
      assert.equal(user.access_expires_at, sqlDate(approvedAt + 2 * 86400000));
      const conversations = await connection.query("SELECT admin_id FROM conversations WHERE client_id = ?", [fixture.user.id]);
      assert.equal(conversations.length, 1); assert.ok(conversations[0].admin_id.equals(admin.id));
      const session = { id: id(), tokenHash: digest(), expiresAt: approvedAt + 3 * 86400000 };
      assert.equal(await store.completeClientLogin({ userId: fixture.user.id, expectedPasswordHash: passwordHash, expectedVersion: 1, now: approvedAt, session }), true);
      assert.equal((await lookup(session, approvedAt)).access.state, "active");
      await connection.query("UPDATE client_session_state SET last_seen_at = ? WHERE session_id = ?", [sqlDate(approvedAt + 2 * 86400000), session.id]);
      assert.equal((await lookup(session, approvedAt + 2 * 86400000)).access.state, "expired");

      await resetAdministratorClock();
      const atomic = await registered(); await verify(atomic);
            await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [id(), atomic.user.id, admin.id, sqlDate(now)]);
      await assert.rejects(store.approveClient(admin.tokenHash, atomic.user.id, { now }), (error) => error.code === "ACCESS_DATABASE_OPERATION");
      const unchanged = (await connection.query("SELECT status, access_approved_at, access_expires_at FROM users WHERE id = ?", [atomic.user.id]))[0];
      assert.equal(unchanged.status, "pending"); assert.equal(unchanged.access_approved_at, null); assert.equal(unchanged.access_expires_at, null);
    });

    await t.test("approval refuses a future invitation consumption without changing the pending account", async () => {
      const fixture = await registered(); await verify(fixture);
      await connection.query("UPDATE invitations SET consumed_at = ? WHERE id = ?", [sqlDate(now + 1000), fixture.invite.id]);
      assert.equal(await store.approveClient(admin.tokenHash, fixture.user.id, { now }), false);
      const row = (await connection.query("SELECT status, access_approved_at, age_assured_at FROM users WHERE id = ?", [fixture.user.id]))[0];
      assert.equal(row.status, "pending"); assert.equal(row.access_approved_at, null); assert.equal(row.age_assured_at, null);
      assert.equal((await connection.query("SELECT id FROM conversations WHERE client_id = ?", [fixture.user.id])).length, 0);
    });

    await t.test("a manually altered active account without its consumed invitation cannot keep a session, renew or be approved", async () => {
      const fixture = await registered(); await verify(fixture);
      const { session } = await login(fixture);
      await connection.query("UPDATE invitations SET consumed_at = NULL, consumed_by_id = NULL WHERE id = ?", [fixture.invite.id]);
      assert.equal(await store.approveClient(admin.tokenHash, fixture.user.id, { now }), false);
      await connection.query("UPDATE users SET status = 'active', access_approved_at = ?, access_expires_at = ? WHERE id = ?", [sqlDate(now), sqlDate(now + 86400000), fixture.user.id]);
      assert.equal(await lookup(session), null);
      await assert.rejects(store.renewClient(admin.tokenHash, fixture.user.id, { now, expectedExpiresAt: now + 86400000, accessDays: 1 }), (error) => error.code === "ACCESS_PREREQUISITES");
      assert.equal((await connection.query("SELECT age_assured_at FROM users WHERE id = ?", [fixture.user.id]))[0].age_assured_at, null);
    });

    await t.test("unlimited access stays explicit; administrator lists expose only bounded review metadata", async () => {
      const fixture = await registered({}, { accessDays: null }); await verify(fixture);
      assert.equal(await store.approveClient(admin.tokenHash, fixture.user.id, { now }), true);
      const session = (await login(fixture)).session;
      assert.equal((await lookup(session)).access.expiresAt, null);
      const { clients } = await store.listClients(admin.tokenHash, { now });
      const metadata = clients.find((item) => item.id === fixture.user.id.toString("hex"));
      assert.deepEqual(metadata, { id: fixture.user.id.toString("hex"), createdAt: now, pseudonym: fixture.user.pseudonym, email: fixture.user.email,
        status: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: true, accessExpiresAt: null });
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

    async function renewable(expiresAt = now + 2 * 86400000) {
      const fixture = await registered(); await verify(fixture);
      const approvedAt = now - 3 * 86400000;
      await connection.query(`UPDATE users SET status = 'active', created_at = ?, email_verified_at = ?, age_assured_at = ?, access_approved_at = ?, access_expires_at = ?
        WHERE id = ?`, [sqlDate(approvedAt - 1000), sqlDate(approvedAt), null, sqlDate(approvedAt), sqlDate(expiresAt), fixture.user.id]);
      await connection.query("UPDATE invitations SET created_at = ?, consumed_at = ? WHERE id = ?", [sqlDate(approvedAt - 1000), sqlDate(approvedAt), fixture.invite.id]);
      const conversationId = id();
      await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [conversationId, fixture.user.id, admin.id, sqlDate(approvedAt)]);
      const { accepted, session } = await login(fixture); assert.equal(accepted, true);
      return { ...fixture, conversationId, session, expiresAt };
    }

    await t.test("renewal extends approved finite access once and preserves its first approval, owner, credentials and sessions", async () => {
      const fixture = await renewable();
      const protectedUser = async () => ({ ...(await connection.query(`SELECT id, role, status, pseudonym, email, password_hash,
        email_verified_at, age_assured_at, access_approved_at, created_at FROM users WHERE id = ?`, [fixture.user.id]))[0] });
      const protectedRows = async () => ({
        user: await protectedUser(),
        conversations: (await connection.query("SELECT * FROM conversations WHERE client_id = ?", [fixture.user.id])).map((row) => ({ ...row })),
        auth: (await connection.query("SELECT * FROM client_auth_state WHERE user_id = ?", [fixture.user.id])).map((row) => ({ ...row })),
        sessions: (await connection.query("SELECT * FROM sessions WHERE user_id = ? ORDER BY id", [fixture.user.id])).map((row) => ({ ...row })),
        sessionState: (await connection.query("SELECT c.* FROM client_session_state c JOIN sessions s ON s.id = c.session_id WHERE s.user_id = ? ORDER BY c.session_id", [fixture.user.id])).map((row) => ({ ...row })),
      });
      const before = await protectedRows();
      assert.deepEqual(await store.renewClient(admin.tokenHash, fixture.user.id, { now, expectedExpiresAt: fixture.expiresAt, accessDays: 7 }),
        { id: fixture.user.id.toString("hex"), accessExpiresAt: fixture.expiresAt + 7 * 86400000 });
      assert.deepEqual(await protectedRows(), before);
      assert.equal((await lookup(fixture.session)).access.expiresAt, fixture.expiresAt + 7 * 86400000);
      await assert.rejects(store.renewClient(admin.tokenHash, fixture.user.id, { now, expectedExpiresAt: fixture.expiresAt, accessDays: 7 }), (error) => error.code === "ACCESS_CONFLICT");
    });

    await t.test("expired approved access renews from now and concurrent identical snapshots produce one extension", async () => {
      const fixture = await renewable(now - 86400000);
      assert.equal((await lookup(fixture.session)).access.state, "expired");
      const results = await Promise.allSettled([1, 2].map(() => store.renewClient(admin.tokenHash, fixture.user.id,
        { now, expectedExpiresAt: fixture.expiresAt, accessDays: 3 })));
      const successes = results.filter((result) => result.status === "fulfilled"), failures = results.filter((result) => result.status === "rejected");
      assert.equal(successes.length, 1); assert.equal(failures.length, 1);
      assert.deepEqual(successes[0].value, { id: fixture.user.id.toString("hex"), accessExpiresAt: now + 3 * 86400000 });
      assert.equal(failures[0].reason.code, "ACCESS_CONFLICT");
      assert.equal((await lookup(fixture.session)).access.state, "active");
      assert.equal((await lookup(fixture.session)).access.expiresAt, now + 3 * 86400000);
    });

    await t.test("renewal refuses wrong accounts, nonactive statuses, future gates and unlimited access without altering them", async () => {
      const fixture = await renewable();
      const request = { now, expectedExpiresAt: fixture.expiresAt, accessDays: 1 };
      assert.equal(await store.renewClient(admin.tokenHash, id(), request), null);
      assert.equal(await store.renewClient(admin.tokenHash, admin.id, request), null);
      for (const status of ["pending", "suspended", "revoked", "deleted"]) {
        await connection.query("UPDATE users SET status = ? WHERE id = ?", [status, fixture.user.id]);
        await assert.rejects(store.renewClient(admin.tokenHash, fixture.user.id, request), (error) => error.code === "ACCESS_PREREQUISITES");
      }
      await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [fixture.user.id]);
      for (const column of ["email_verified_at", "access_approved_at"]) {
        const original = (await connection.query(`SELECT ${column} AS value FROM users WHERE id = ?`, [fixture.user.id]))[0].value;
        await connection.query(`UPDATE users SET ${column} = ? WHERE id = ?`, [sqlDate(now + 1000), fixture.user.id]);
        try { await assert.rejects(store.renewClient(admin.tokenHash, fixture.user.id, request), (error) => error.code === "ACCESS_PREREQUISITES"); }
        finally { await connection.query(`UPDATE users SET ${column} = ? WHERE id = ?`, [original, fixture.user.id]); }
      }
      await connection.query("UPDATE users SET access_expires_at = NULL WHERE id = ?", [fixture.user.id]);
      await assert.rejects(store.renewClient(admin.tokenHash, fixture.user.id, request), (error) => error.code === "ACCESS_PREREQUISITES");
      assert.equal((await connection.query("SELECT access_expires_at FROM users WHERE id = ?", [fixture.user.id]))[0].access_expires_at, null);
    });

    await t.test("renewal rechecks current administrator status, session expiry, revocation and MFA generation in its transaction", async () => {
      const fixture = await renewable(), request = { now, expectedExpiresAt: fixture.expiresAt, accessDays: 1 };
      for (const token of [digest(), fixture.session.tokenHash]) await assert.rejects(store.renewClient(token, fixture.user.id, request), (error) => error.code === "ACCESS_FORBIDDEN");
      const boundary = now + 1;
      await connection.query("UPDATE sessions SET expires_at = ? WHERE id = ?", [sqlDate(boundary), admin.sessionId]);
      try { await assert.rejects(store.renewClient(admin.tokenHash, fixture.user.id, { ...request, now: boundary }), (error) => error.code === "ACCESS_FORBIDDEN"); }
      finally { await connection.query("UPDATE sessions SET expires_at = ? WHERE id = ?", [sqlDate(now + 8 * 3600000), admin.sessionId]); }
      for (const [alter, restore, parameters] of [
        ["UPDATE sessions SET revoked_at = ? WHERE id = ?", "UPDATE sessions SET revoked_at = NULL WHERE id = ?", [sqlDate(now), admin.sessionId]],
        ["UPDATE admin_mfa SET version = 2 WHERE user_id = ?", "UPDATE admin_mfa SET version = 1 WHERE user_id = ?", [admin.id]],
        ["UPDATE users SET status = 'suspended' WHERE id = ?", "UPDATE users SET status = 'active' WHERE id = ?", [admin.id]],
        ["UPDATE admin_mfa SET enabled_at = ? WHERE user_id = ?", "UPDATE admin_mfa SET enabled_at = ? WHERE user_id = ?", [sqlDate(now + 1000), admin.id]],
      ]) {
        await connection.query(alter, parameters);
        try { await assert.rejects(store.renewClient(admin.tokenHash, fixture.user.id, request), (error) => error.code === "ACCESS_FORBIDDEN"); }
        finally { await connection.query(restore, restore.includes("enabled_at") ? [sqlDate(now), admin.id] : [parameters.at(-1)]); }
      }
      assert.equal((await connection.query("SELECT access_expires_at FROM users WHERE id = ?", [fixture.user.id]))[0].access_expires_at, sqlDate(fixture.expiresAt));
    });

    await t.test("renewal refuses an administrator grant that expires while the target account is locked", async () => {
      const fixture = await renewable();
      const boundary = now + 1000;
      await connection.query("UPDATE sessions SET expires_at = ? WHERE id = ?", [sqlDate(boundary), admin.sessionId]);
      let at = now, observed;
      const targetRequested = new Promise((resolve) => { observed = resolve; });
      const observedStore = createAccessStore({ getConnection: async () => {
        const runtimeConnection = await pool.getConnection();
        return { ...runtimeConnection, query: async (...arguments_) => {
          if (arguments_[0].startsWith("SELECT role, status, email_verified_at, age_assured_at,")) observed();
          return runtimeConnection.query(...arguments_);
        } };
      } }, { clock: () => at });
      await connection.beginTransaction();
      let pending;
      try {
        await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [fixture.user.id]);
        pending = observedStore.renewClient(admin.tokenHash, fixture.user.id, { now, expectedExpiresAt: fixture.expiresAt, accessDays: 1 });
        const rejected = assert.rejects(pending, (error) => error.code === "ACCESS_FORBIDDEN");
        await targetRequested;
        at = boundary;
        await connection.commit();
        await rejected;
        assert.equal((await connection.query("SELECT access_expires_at FROM users WHERE id = ?", [fixture.user.id]))[0].access_expires_at, sqlDate(fixture.expiresAt));
      } finally { try { await connection.rollback(); } catch {} if (pending) await pending.catch(() => {}); }
    });

    await t.test("renewal input, exact expiry snapshot and ten-year horizon fail without shortening access", async () => {
      const fixture = await renewable(), request = { now, expectedExpiresAt: fixture.expiresAt, accessDays: 1 };
      for (const patch of [{ accessDays: null }, { accessDays: 0 }, { accessDays: 3651 }, { accessDays: 1.5 }, { expectedExpiresAt: null }, { expectedExpiresAt: -1 }, { expectedExpiresAt: 1.1 }]) {
        await assert.rejects(store.renewClient(admin.tokenHash, fixture.user.id, { ...request, ...patch }), (error) => error.code === "ACCESS_INPUT");
      }
      await assert.rejects(store.renewClient(admin.tokenHash, fixture.user.id, { ...request, accessDays: 3650 }), (error) => error.code === "ACCESS_INPUT");
      await assert.rejects(store.renewClient(admin.tokenHash, fixture.user.id, { ...request, expectedExpiresAt: fixture.expiresAt + 1 }), (error) => error.code === "ACCESS_CONFLICT");
      const microExpiry = sqlDate(fixture.expiresAt).slice(0, -3) + "001";
      await connection.query("UPDATE users SET access_expires_at = ? WHERE id = ?", [microExpiry, fixture.user.id]);
      await assert.rejects(store.renewClient(admin.tokenHash, fixture.user.id, request), (error) => error.code === "ACCESS_CONFLICT");
      assert.equal((await connection.query("SELECT access_expires_at FROM users WHERE id = ?", [fixture.user.id]))[0].access_expires_at, microExpiry);
      const expired = await renewable(now - 1000);
      assert.deepEqual(await store.renewClient(admin.tokenHash, expired.user.id, { now, expectedExpiresAt: expired.expiresAt, accessDays: 3650 }),
        { id: expired.user.id.toString("hex"), accessExpiresAt: now + 3650 * 86400000 });
    });

    await t.test("concurrent client revocation and renewal leave revoked access and revoked sessions authoritative", async () => {
      const fixture = await renewable(), request = { now, expectedExpiresAt: fixture.expiresAt, accessDays: 1 };
      const outcomes = await Promise.allSettled([store.renewClient(admin.tokenHash, fixture.user.id, request), store.revokeClient(admin.tokenHash, fixture.user.id, { now })]);
      assert.equal(outcomes[1].status, "fulfilled"); assert.equal(outcomes[1].value, true);
      if (outcomes[0].status === "rejected") assert.equal(outcomes[0].reason.code, "ACCESS_PREREQUISITES");
      else assert.equal(outcomes[0].value.accessExpiresAt, fixture.expiresAt + 86400000);
      assert.equal((await connection.query("SELECT status FROM users WHERE id = ?", [fixture.user.id]))[0].status, "revoked");
      assert.equal(await lookup(fixture.session), null);
      await assert.rejects(store.renewClient(admin.tokenHash, fixture.user.id, request), (error) => error.code === "ACCESS_PREREQUISITES");
    });

    await t.test("administrator keyset pages pass 500 rows, preserve tied microseconds, survive cursor deletion and skip newer inserts", async () => {
      const otherAdmin = { id: id(), sessionId: id(), tokenHash: digest() };
      await connection.query("INSERT INTO users (id, role, status, pseudonym, email, created_at, updated_at) VALUES (?, 'admin', 'active', 'Other page administrator', ?, ?, ?)", [otherAdmin.id, `other-page-admin-${sequence++}@example.invalid`, sqlDate(now), sqlDate(now)]);
      await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic-encrypted-secret', 1, 1, ?)", [otherAdmin.id, sqlDate(now)]);
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [otherAdmin.sessionId, otherAdmin.id, otherAdmin.tokenHash, sqlDate(now), sqlDate(now + 8 * 3600000)]);
      await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [otherAdmin.sessionId, sqlDate(now), sqlDate(now)]);
      const otherInvitation = await invitation({ actorTokenHash: otherAdmin.tokenHash });
      const sharedClient = await renewable();
      await connection.query("UPDATE conversations SET admin_id = ? WHERE id = ?", [otherAdmin.id, sharedClient.conversationId]);
      assert.ok((await store.listInvitations(admin.tokenHash, { now, limit: 100 })).invitations.some((row) => row.id === otherInvitation.id.toString("hex")));
      assert.ok((await store.listClients(admin.tokenHash, { now, limit: 100 })).clients.some((row) => row.id === sharedClient.user.id.toString("hex")));
      assert.ok((await store.listClients(otherAdmin.tokenHash, { now, limit: 100 })).clients.some((row) => row.id === sharedClient.user.id.toString("hex")));
      const invitationRows = [], clientRows = [];
      for (let index = 0; index < 520; index++) {
        const createdAt = `2026-10-14 11:59:59.${String(123400 + Math.floor(index / 40)).padStart(6, "0")}`;
        invitationRows.push([id(), digest(), admin.id, createdAt, sqlDate(now + 3600000)]);
        clientRows.push([id(), `page-${sequence++}@example.invalid`, createdAt, createdAt]);
      }
      for (let start = 0; start < invitationRows.length; start += 80) {
        const invites = invitationRows.slice(start, start + 80), clients = clientRows.slice(start, start + 80);
        await connection.query(`INSERT INTO invitations (id, token_hash, created_by_id, created_at, expires_at)
          VALUES ${invites.map(() => "(?, ?, ?, ?, ?)").join(",")}`, invites.flat());
        await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, created_at, updated_at)
          VALUES ${clients.map(() => "(?, 'client', 'pending', 'Synthetic page client', ?, ?, ?)").join(",")}`, clients.flat());
      }
      for (const kind of ["invitations", "clients"]) {
        const table = kind === "clients" ? "users" : "invitations", where = kind === "clients" ? "WHERE role = 'client'" : "";
        const expected = (await connection.query(`SELECT id FROM ${table} ${where} ORDER BY created_at DESC, id DESC`)).map((row) => row.id.toString("hex"));
        assert.ok(expected.length > 500);
        const list = (cursor = null) => kind === "clients" ? store.listClients(admin.tokenHash, { now, cursor, limit: 73 }) : store.listInvitations(admin.tokenHash, { now, cursor, limit: 73 });
        let page = await list(), seen = page[kind].map((row) => row.id), previousCursor = null;
        assert.equal(page.hasMore, true); assert.equal(page[kind].length, 73);
        const position = decodeAccessCursor(kind, page.nextCursor);
        assert.match(position.createdAt, /\.\d{6}$/); assert.equal(position.id, seen.at(-1));
        // A cursor is a position, not a foreign key to a row that must survive.
        await connection.query(`DELETE FROM ${table} WHERE id = ?`, [Buffer.from(position.id, "hex")]);
        const newer = id();
        if (kind === "clients") await connection.query("INSERT INTO users (id, role, status, pseudonym, email, created_at, updated_at) VALUES (?, 'client', 'pending', 'New page client', ?, ?, ?)", [newer, `page-new-${sequence++}@example.invalid`, sqlDate(now + 1000), sqlDate(now + 1000)]);
        else await connection.query("INSERT INTO invitations (id, token_hash, created_by_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [newer, digest(), admin.id, sqlDate(now + 1000), sqlDate(now + 3600000)]);
        let pages = 1;
        while (page.hasMore) {
          assert.equal(typeof page.nextCursor, "string"); assert.notEqual(page.nextCursor, previousCursor); previousCursor = page.nextCursor;
          page = await list(page.nextCursor); pages++; assert.ok(pages < 20);
          assert.ok(page[kind].length <= 73); seen.push(...page[kind].map((row) => row.id));
        }
        assert.equal(page.nextCursor, null); assert.deepEqual(seen, expected); assert.equal(new Set(seen).size, seen.length);
        assert.ok(!seen.includes(newer.toString("hex")));
        const emptyCursor = encodeAccessCursor(kind, { createdAt: "1970-01-01 00:00:00.000000", id: "00000000000000000000000000000000" });
        assert.deepEqual(await list(emptyCursor), { [kind]: [], nextCursor: null, hasMore: false });
        const otherCursor = encodeAccessCursor(kind === "clients" ? "invitations" : "clients", position);
        await assert.rejects(list(otherCursor), (error) => error.code === "ACCESS_INPUT");
        for (const limit of [0, 101]) await assert.rejects(kind === "clients" ? store.listClients(admin.tokenHash, { now, limit }) : store.listInvitations(admin.tokenHash, { now, limit }), (error) => error.code === "ACCESS_INPUT");
      }
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
