import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createOperationsStore } from "../server/operations/store.mjs";
import { createConfiguredServer } from "../server/index.mjs";
import { createShutdown } from "../server/lifecycle.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const id = () => randomBytes(16);

test("configured neutral server exposes the installed entry without authentication, database or mail", async () => {
  const configured = await createConfiguredServer({});
  assert.equal(configured.pool, null);
  const shutdown = createShutdown(configured);
  try {
    await new Promise((resolve) => configured.server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${configured.server.address().port}`;
    const entry = await fetch(`${base}/api/entry`);
    assert.equal(entry.status, 200);
    assert.deepEqual(await entry.json(), { status: "unavailable", client: null, administrator: null });
    assert.match(entry.headers.get("cache-control"), /no-store/);
    const page = await fetch(`${base}/app`);
    assert.equal(page.status, 200); assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /<html\b/i); assert.match(page.headers.get("cache-control"), /no-store/);
    const manifest = await fetch(`${base}/manifest.webmanifest`);
    assert.equal(manifest.status, 200);
    const value = await manifest.json(); assert.equal(value.start_url, "/app"); assert.equal(value.id, "/");
    const health = await fetch(`${base}/api/health`); assert.equal(health.status, 200); await health.arrayBuffer();
    const ready = await fetch(`${base}/api/ready`); assert.equal(ready.status, 503); await ready.arrayBuffer();
  } finally {
    const result = await shutdown(); assert.equal(result.failed, false); assert.equal(result.timedOut, false);
  }
});

test("operational metadata samples real MariaDB queues with runtime DML rights and no queue mutation (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 120000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "separately provisioned runtime DML credentials are required");
  const migrations = await loadMigrations();
  assert.equal(migrations.length, 30);
  const allowedTables = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase();
  let pool;
  async function cleanup() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await cleanup();
    await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const store = createOperationsStore({ pool, verification: true, recovery: true, broadcasts: true });
    const now = Date.parse("2026-10-15T08:00:00.123Z"), created = sqlDate(now - 60000), expiry = sqlDate(now + 600000);

    await t.test("empty queues and disabled features return bounded explicit metadata", async () => {
      assert.deepEqual(await store.sample({ now }), { database: true, queues: ["verification", "recovery", "broadcasts"].map((name) => ({
        name, pending: { count: 0, truncated: false }, sending: { count: 0, truncated: false }, failed: { count: 0, truncated: false }, oldestDueAt: null,
      })) });
      assert.deepEqual(await createOperationsStore({ pool, verification: false }).sample({ now }), { database: true, queues: [] });
    });

    const client = id(), admin = id(), verification = id(), reset = id(), conversation = id();
    await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, created_at, updated_at)
      VALUES (?, 'client', 'pending', 'Synthetic operations client', 'operations-client@example.invalid', ?, ?),
        (?, 'admin', 'active', 'Synthetic operations administrator', 'operations-admin@example.invalid', ?, ?)`,
    [client, created, created, admin, created, created]);
    await connection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [client, created]);
    await connection.query("INSERT INTO email_verifications (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      [verification, client, randomBytes(32), created, expiry]);
    await connection.query(`INSERT INTO client_password_resets (id, user_id, token_hash, credential_version, email_hash, created_at, expires_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)`, [reset, client, randomBytes(32), randomBytes(32), created, expiry]);
    await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [conversation, client, admin, created]);

    const privateMarker = "synthetic-private-payload-operations-client@example.invalid";
    async function mail(table, state, count, available = sqlDate(now - 1000)) {
      assert.ok(["mail_outbox", "password_reset_outbox"].includes(table));
      const challengeField = table === "mail_outbox" ? "verification_id" : "reset_id";
      const challenge = table === "mail_outbox" ? verification : reset;
      for (let offset = 0; offset < count; offset += 200) {
        const size = Math.min(200, count - offset);
        const values = Array.from({ length: size }, () => [id(), challenge, client, privateMarker, state, available, expiry, created,
          state === "sending" ? id() : null, state === "sending" ? sqlDate(now + 120000) : null]);
        await connection.query(`INSERT INTO ${table} (id, ${challengeField}, recipient_user_id, payload_encrypted, status,
          available_at, expires_at, created_at, lease_token, lease_until) VALUES ${values.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`, values.flat());
      }
    }
    await mail("mail_outbox", "pending", 1001);
    await mail("mail_outbox", "sending", 2);
    await mail("mail_outbox", "failed", 3);
    await mail("password_reset_outbox", "pending", 1, "2026-10-15 08:00:00.123001");
    await mail("password_reset_outbox", "failed", 1);
    async function recipient(state) {
      const campaign = id();
      await connection.query(`INSERT INTO broadcast_campaigns (id, admin_id, client_campaign_id, mfa_version, payload_encrypted,
        request_fingerprint, created_at, updated_at, expires_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      [campaign, admin, id(), privateMarker, randomBytes(32), created, created, expiry]);
      await connection.query(`INSERT INTO broadcast_recipients (campaign_id, conversation_id, client_id, proposed_message_id,
        client_message_id, state, reason, available_at, created_at, lease_token, lease_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [campaign, conversation, client, id(), id(), state, state === "failed" ? "processing_failed" : null,
        sqlDate(now - 2000), created, state === "sending" ? id() : null, state === "sending" ? sqlDate(now + 120000) : null]);
    }
    await recipient("pending"); await recipient("pending"); await recipient("sending"); await recipient("failed");
    // Whole disposable rows are compared only in memory, never emitted as logs.
    async function snapshot() {
      return Promise.all(["mail_outbox", "password_reset_outbox", "broadcast_recipients", "broadcast_campaigns"].map(async (table) => {
        const key = table === "broadcast_recipients" ? "campaign_id, conversation_id" : "id";
        return connection.query(`SELECT * FROM ${table} ORDER BY ${key}`);
      }));
    }
    await t.test("capped queue counts and microsecond due metadata contain no private content and perform no mutation", async () => {
      const before = await snapshot();
      const result = await store.sample({ now });
      assert.deepEqual(result, { database: true, queues: [
        { name: "verification", pending: { count: 1000, truncated: true }, sending: { count: 2, truncated: false }, failed: { count: 3, truncated: false }, oldestDueAt: now - 1000 },
        { name: "recovery", pending: { count: 1, truncated: false }, sending: { count: 0, truncated: false }, failed: { count: 1, truncated: false }, oldestDueAt: null },
        { name: "broadcasts", pending: { count: 2, truncated: false }, sending: { count: 1, truncated: false }, failed: { count: 1, truncated: false }, oldestDueAt: now - 2000 },
      ] });
      assert.doesNotMatch(JSON.stringify(result), /example\.invalid|payload|token|user|campaign|password|secret|SELECT|lease/i);
      assert.deepEqual(await snapshot(), before);
      const after = await store.sample({ now: now + 1 });
      assert.equal(after.queues[1].oldestDueAt, now);
      assert.deepEqual(await snapshot(), before);
    });
    await t.test("runtime identity has no DDL privilege while metadata sampling remains available", async () => {
      const runtime = await pool.getConnection();
      try { await assert.rejects(runtime.query("CREATE TABLE migration_probe (value INT) ENGINE=InnoDB")); }
      finally { runtime.release(); }
      assert.equal((await store.sample({ now })).database, true);
    });
    await t.test("configured auth-only HTTP wires cached readiness and drains its monitor before closing the runtime pool once", async () => {
      const before = await snapshot();
      const configured = await createConfiguredServer({ ...process.env,
        JESSIEMESSAGE_ENABLE_AUTH: "1", JESSIEMESSAGE_SITE_ORIGIN: "https://jessiemessage.com",
        JESSIEMESSAGE_MFA_KEY: randomBytes(32).toString("base64url"),
        JESSIEMESSAGE_ENABLE_ACCESS: "0", JESSIEMESSAGE_ENABLE_CHAT: "0", JESSIEMESSAGE_ENABLE_MEDIA: "0",
        JESSIEMESSAGE_ENABLE_CRM: "0", JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "0", JESSIEMESSAGE_ENABLE_BROADCAST: "0",
        JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "0",
      });
      assert.equal(configured.mailWorker, null, "auth-only operation starts no SMTP or delivery worker");
      let poolClosures = 0;
      const shutdown = createShutdown({ ...configured, pool: { async end() {
        poolClosures++;
        return configured.pool.end();
      } } });
      try {
        await new Promise((resolve) => configured.server.listen(0, "127.0.0.1", resolve));
        const base = `http://127.0.0.1:${configured.server.address().port}`;
        const entry = await fetch(`${base}/api/entry`);
        assert.equal(entry.status, 200);
        assert.deepEqual(await entry.json(), { status: "available", client: null,
          administrator: { state: "signed_out", href: "/admin/login" } });
        assert.match(entry.headers.get("cache-control"), /no-store/);
        assert.equal(entry.headers.get("set-cookie"), null);
        const page = await fetch(`${base}/app`);
        assert.equal(page.status, 200); assert.match(page.headers.get("content-type"), /text\/html/);
        const entryHtml = await page.text(); assert.match(entryHtml, /<html\b/i);
        assert.doesNotMatch(entryHtml, /operations-client@example\.invalid|synthetic-private-payload/);
        assert.match(page.headers.get("cache-control"), /no-store/);
        const head = await fetch(`${base}/app`, { method: "HEAD" });
        assert.equal(head.status, 200); assert.equal(await head.text(), "");
        const manifest = await fetch(`${base}/manifest.webmanifest`);
        assert.equal(manifest.status, 200);
        const webmanifest = await manifest.json(); assert.equal(webmanifest.start_url, "/app"); assert.equal(webmanifest.id, "/");
        const health = await fetch(`${base}/api/health`);
        assert.equal(health.status, 200);
        assert.deepEqual(await health.json(), { status: "ok" });
        const ready = await fetch(`${base}/api/ready`);
        assert.equal(ready.status, 503, "disabled messaging remains unavailable even with live SQL");
        assert.deepEqual(await ready.json(), { status: "unavailable" });
        assert.match(ready.headers.get("cache-control"), /no-store/);
        for (const path of ["/admin/readiness", "/api/admin/readiness"]) {
          const denied = await fetch(`${base}${path}`, { redirect: "manual" });
          assert.equal(denied.status, 401, path);
          assert.deepEqual(await denied.json(), { error: "authentication_required" });
          assert.match(denied.headers.get("cache-control"), /no-store/);
        }
      } finally {
        const draining = shutdown();
        assert.equal(shutdown(), draining, "concurrent shutdown requests share the same drain");
        const result = await draining;
        assert.equal(result.failed, false);
        assert.equal(result.timedOut, false);
        assert.equal(poolClosures, 1);
        assert.equal(configured.server.listening, false);
      }
      assert.deepEqual(await snapshot(), before, "auth-only observation never claims or mutates queue fixtures");
    });
  } finally {
    try { await pool?.end(); }
    finally { try { await cleanup(); } finally { await connection.end(); } }
  }
});
