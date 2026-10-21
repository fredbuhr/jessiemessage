import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createMailStore } from "../server/mail/store.mjs";
import { sealVerificationPayload } from "../server/mail/crypto.mjs";
import { runMailBatch } from "../server/mail/worker.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16);
const now = Date.UTC(2026, 9, 14, 12);
const date = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const allowedTables = ["announcements", "user_profiles", "push_outbox", "push_subscriptions", "media_storage_objects", "media_storage_state", "broadcast_recipients", "broadcast_campaigns", "broadcast_preferences", "password_reset_outbox", "client_password_resets", "crm_memberships", "crm_labels", "crm_profiles", "message_media", "media_assets", "chat_events", "chat_receipts", "messages", "mail_outbox", "email_verifications", "client_session_state", "client_auth_state",
  "auth_session_state", "admin_recovery_codes", "admin_mfa", "auth_rate_limits", "conversations",
  "sessions", "invitations", "users", "migration_probe", "schema_migrations"];

test("real MariaDB encrypted verification mail persistence (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 120000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "integration tests require separately provisioned runtime DML credentials");
  const connection = await connectDatabase();
  let pool;
  const key = randomBytes(32);
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  async function clearFixtures() {
    for (const table of ["mail_outbox", "email_verifications", "client_auth_state", "users"]) await connection.query(`DELETE FROM ${table}`);
  }
  async function fixture({ createdAt = now, expiresAt = now + 86400000 } = {}) {
    const userId = id(), verificationId = id(), jobId = id(), token = newToken();
    const email = `synthetic-${userId.toString("hex")}@example.invalid`;
    await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, created_at, updated_at)
      VALUES (?, 'client', 'pending', 'Synthetic recipient', ?, ?, ?)`, [userId, email, date(createdAt), date(createdAt)]);
    await connection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [userId, date(createdAt)]);
    await connection.query(`INSERT INTO email_verifications (id, user_id, token_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)`, [verificationId, userId, tokenDigest(token), date(createdAt), date(expiresAt)]);
    const payloadEncrypted = sealVerificationPayload({ email, token }, key, jobId);
    await connection.query(`INSERT INTO mail_outbox (id, verification_id, recipient_user_id, payload_encrypted,
      available_at, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [jobId, verificationId, userId, payloadEncrypted, date(createdAt), date(expiresAt), date(createdAt)]);
    return { userId, verificationId, jobId, token, email, payloadEncrypted };
  }
  try {
    await reset();
    await applyMigrations(connection, { database: options.database, migrations: await loadMigrations() });
    pool = await createRuntimePool(process.env);
    const store = createMailStore(pool);
    assert.equal(await store.assertSchema(), true);

    await t.test("concurrent workers claim a job once and its lease guards acknowledged completion", async () => {
      await clearFixtures();
      const expected = await fixture();
      const claims = await Promise.all([store.claim({ now }), store.claim({ now })]);
      assert.equal(claims.filter(Boolean).length, 1);
      const job = claims.find(Boolean);
      assert.deepEqual(job.id, expected.jobId);
      assert.deepEqual(job.verificationId, expected.verificationId);
      assert.deepEqual(job.userId, expected.userId);
      assert.equal(job.recipientEmail, expected.email);
      assert.equal(job.attempts, 1);
      assert.equal(job.payloadEncrypted, expected.payloadEncrypted);
      assert.equal(await store.markSent(job.id, id(), { now: now + 1 }), false);
      assert.equal(await store.markSent(job.id, job.leaseToken, { now: now + 1 }), true);
      assert.equal(await store.markSent(job.id, job.leaseToken, { now: now + 2 }), false);
      const row = (await connection.query("SELECT status, attempts, lease_token, lease_until, sent_at FROM mail_outbox WHERE id = ?", [job.id]))[0];
      assert.equal(row.status, "sent"); assert.equal(Number(row.attempts), 1);
      assert.equal(row.lease_token, null); assert.equal(row.lease_until, null); assert.ok(row.sent_at);
      assert.equal(await store.claim({ now: now + 3 }), null);
    });

    await t.test("a crashed worker's expired lease is reclaimed and its stale acknowledgment cannot overwrite the new owner", async () => {
      await clearFixtures(); await fixture();
      const first = await store.claim({ now, leaseMilliseconds: 1000 });
      assert.equal(await store.claim({ now: now + 999 }), null);
      const second = await store.claim({ now: now + 1000, leaseMilliseconds: 1000 });
      assert.deepEqual(second.id, first.id);
      assert.notDeepEqual(second.leaseToken, first.leaseToken);
      assert.equal(second.attempts, 2);
      assert.equal(await store.markSent(first.id, first.leaseToken, { now: now + 1001 }), false);
      assert.equal(await store.markFailed(first.id, first.leaseToken, { now: now + 1001, code: "MAIL_DELIVERY_FAILED" }), false);
      assert.equal(await store.markSent(second.id, second.leaseToken, { now: now + 1001 }), true);
    });

    await t.test("an unstarted eighth reservation is returned once and remains claimable for a real eighth SMTP attempt", async () => {
      await clearFixtures(); const value = await fixture();
      await connection.query("UPDATE mail_outbox SET attempts = 7 WHERE id = ?", [value.jobId]);
      const first = await store.claim({ now }); assert.equal(first.attempts, 8);
      assert.equal(await store.releaseClaim(first.id, id(), { now: now + 1 }), false);
      const releases = await Promise.all([store.releaseClaim(first.id, first.leaseToken, { now: now + 1 }), store.releaseClaim(first.id, first.leaseToken, { now: now + 1 })]);
      assert.equal(releases.filter(Boolean).length, 1);
      const row = (await connection.query("SELECT status, attempts, lease_token, lease_until, sent_at, last_error FROM mail_outbox WHERE id = ?", [first.id]))[0];
      assert.equal(row.status, "pending"); assert.equal(Number(row.attempts), 7); assert.equal(row.lease_token, null); assert.equal(row.lease_until, null);
      assert.equal(row.sent_at, null); assert.equal(row.last_error, null);
      assert.equal(await store.markSent(first.id, first.leaseToken, { now: now + 1 }), false);
      const second = await store.claim({ now: now + 2 }); assert.deepEqual(second.id, first.id); assert.equal(second.attempts, 8); assert.notDeepEqual(second.leaseToken, first.leaseToken);
      assert.equal(await store.releaseClaim(first.id, first.leaseToken, { now: now + 3 }), false);
      assert.equal(await store.markSent(second.id, second.leaseToken, { now: now + 3 }), true);
      assert.equal(await store.releaseClaim(second.id, second.leaseToken, { now: now + 4 }), false);
      assert.equal(Number((await connection.query("SELECT attempts FROM mail_outbox WHERE id = ?", [second.id]))[0].attempts), 8);
    });

    await t.test("release cannot refund an expired or replaced lease, cancel a fresh owner or revive a terminal job", async () => {
      await clearFixtures(); await fixture({ expiresAt: now + 1000 });
      const expired = await store.claim({ now }); assert.equal(await store.releaseClaim(expired.id, expired.leaseToken, { now: now + 1000 }), false);
      assert.equal(await store.claim({ now: now + 1000 }), null);
      assert.equal(await store.releaseClaim(expired.id, expired.leaseToken, { now: now + 1001 }), false);
      await clearFixtures(); await fixture();
      const first = await store.claim({ now, leaseMilliseconds: 1000 }), second = await store.claim({ now: now + 1000 });
      assert.equal(await store.releaseClaim(first.id, first.leaseToken, { now: now + 1001 }), false);
      const row = (await connection.query("SELECT status, attempts, lease_token FROM mail_outbox WHERE id = ?", [second.id]))[0];
      assert.equal(row.status, "sending"); assert.equal(Number(row.attempts), 2); assert.deepEqual(row.lease_token, second.leaseToken);
      assert.equal(await store.releaseClaim(second.id, second.leaseToken, { now: now + 1001 }), true);
      assert.equal((await store.claim({ now: now + 1002 })).attempts, 2);
    });

    await t.test("expired, revoked, consumed, verified and inactive recipients are cancelled before any claim", async () => {
      for (const reason of ["expired", "revoked", "consumed", "verified", "inactive"]) {
        await clearFixtures();
        const value = await fixture(reason === "expired" ? { expiresAt: now + 1 } : {});
        if (reason === "revoked") await connection.query("UPDATE email_verifications SET revoked_at = ? WHERE id = ?", [date(now + 1), value.verificationId]);
        if (reason === "consumed") await connection.query("UPDATE email_verifications SET consumed_at = ? WHERE id = ?", [date(now + 1), value.verificationId]);
        if (reason === "verified") await connection.query("UPDATE users SET email_verified_at = ? WHERE id = ?", [date(now + 1), value.userId]);
        if (reason === "inactive") await connection.query("UPDATE users SET status = 'revoked' WHERE id = ?", [value.userId]);
        assert.equal(await store.claim({ now: now + 10 }), null, reason);
        const row = (await connection.query("SELECT status, attempts, lease_token, lease_until, sent_at FROM mail_outbox WHERE id = ?", [value.jobId]))[0];
        assert.equal(row.status, "cancelled", reason); assert.equal(Number(row.attempts), 0);
        assert.equal(row.lease_token, null); assert.equal(row.lease_until, null); assert.equal(row.sent_at, null);
      }
    });

    await t.test("retry scheduling survives a fresh store and stops after eight bounded attempts", async () => {
      await clearFixtures(); await fixture();
      let at = now;
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        const current = createMailStore(pool);
        const job = await current.claim({ now: at });
        assert.ok(job, `attempt ${attempt}`);
        assert.equal(job.attempts, attempt);
        assert.equal(await current.markFailed(job.id, job.leaseToken, { now: at + 1, code: "MAIL_DELIVERY_FAILED" }), true);
        const row = (await connection.query("SELECT status, attempts, last_error, lease_token, lease_until FROM mail_outbox WHERE id = ?", [job.id]))[0];
        assert.equal(row.status, attempt === 8 ? "failed" : "pending");
        assert.equal(row.last_error, "MAIL_DELIVERY_FAILED");
        assert.equal(row.lease_token, null); assert.equal(row.lease_until, null);
        if (attempt < 8) {
          assert.equal(await current.claim({ now: at + 2 }), null);
          at += Math.min(3600, 30 * 2 ** (attempt - 1)) * 1000 + 1;
        }
      }
      assert.equal(await store.claim({ now: at + 3600001 }), null);
    });

    await t.test("a lease ending at token expiry cannot record a late success or be retried", async () => {
      await clearFixtures(); await fixture({ expiresAt: now + 1000 });
      const job = await store.claim({ now });
      assert.equal(await store.markSent(job.id, job.leaseToken, { now: now + 1000 }), false);
      assert.equal(await store.claim({ now: now + 1000 }), null);
      assert.equal((await connection.query("SELECT status FROM mail_outbox WHERE id = ?", [job.id]))[0].status, "cancelled");
    });

    await t.test("the composite foreign key cannot queue a verification to another user's address", async () => {
      await clearFixtures();
      const first = await fixture(), second = await fixture();
      await assert.rejects(connection.query(`INSERT INTO mail_outbox (id, verification_id, recipient_user_id,
        payload_encrypted, available_at, expires_at, created_at) VALUES (?, ?, ?, 'synthetic-encrypted-payload', ?, ?, ?)`,
      [id(), first.verificationId, second.userId, date(now), date(now + 10000), date(now)]));
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM mail_outbox"))[0].count, 2n);
    });

    await t.test("the worker checks the current recipient against encrypted mail and permanently rejects stale payloads", async () => {
      await clearFixtures();
      const value = await fixture();
      await connection.query("UPDATE users SET email = 'changed-recipient@example.invalid' WHERE id = ?", [value.userId]);
      const result = await runMailBatch({ store, key, clock: () => now, batchSize: 1,
        transport: { async sendVerification() { assert.fail("stale recipient must not be sent"); } } });
      assert.deepEqual(result, { sent: 0, failed: 1 });
      const row = (await connection.query("SELECT status, last_error FROM mail_outbox WHERE id = ?", [value.jobId]))[0];
      assert.equal(row.status, "failed"); assert.equal(row.last_error, "PAYLOAD_INVALID");
    });

    await t.test("encrypted queue delivery with an injected SMTP transport persists acceptance without real email", async () => {
      await clearFixtures();
      const value = await fixture(), sent = [];
      assert.deepEqual(await runMailBatch({ store, key, clock: () => now, transport: {
        async sendVerification(payload) { sent.push(payload); return true; },
      } }), { sent: 1, failed: 0 });
      assert.deepEqual(sent, [{ email: value.email, token: value.token, jobId: value.jobId }]);
      assert.equal((await connection.query("SELECT status FROM mail_outbox WHERE id = ?", [value.jobId]))[0].status, "sent");
    });

    await t.test("bounded cleanup removes only expired retention and preserves recent queued data", async () => {
      await clearFixtures();
      const old = await fixture({ createdAt: now - 10 * 86400000, expiresAt: now - 9 * 86400000 });
      const recent = await fixture();
      const pruningStore = createMailStore(pool);
      assert.equal(await pruningStore.prune({ now }), 1);
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM mail_outbox WHERE id = ?", [old.jobId]))[0].count, 0n);
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM mail_outbox WHERE id = ?", [recent.jobId]))[0].count, 1n);
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM email_verifications"))[0].count, 2n);
      const secondOld = await fixture({ createdAt: now - 10 * 86400000, expiresAt: now - 9 * 86400000 });
      assert.equal(await pruningStore.prune({ now: now + 299999 }), 0);
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM mail_outbox WHERE id = ?", [secondOld.jobId]))[0].count, 1n);
      assert.equal(await pruningStore.prune({ now: now + 300000 }), 1);
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM mail_outbox WHERE id = ?", [recent.jobId]))[0].count, 1n);
    });

    await t.test("schema readiness rejects nullable ciphertext drift before worker startup", async () => {
      await connection.query("ALTER TABLE mail_outbox MODIFY payload_encrypted VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NULL");
      try { await assert.rejects(store.assertSchema(), { code: "MAIL_DATABASE_STATE" }); }
      finally { await connection.query("ALTER TABLE mail_outbox MODIFY payload_encrypted VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NOT NULL"); }
      assert.equal(await store.assertSchema(), true);
    });
  } finally {
    try { if (pool) await pool.end(); } finally { try { await reset(); } finally { await connection.end(); } }
  }
});
