// Real MariaDB, isolated synthetic schema only. No external message or push is sent.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { decryptMessageBody } from "../server/chat/crypto.mjs";
import { enqueueNotification } from "../server/notifications/store.mjs";
import { createBroadcastStore } from "../server/broadcast/store.mjs";
import { createBroadcastService } from "../server/broadcast/service.mjs";
import { createBroadcastWorker } from "../server/broadcast/worker.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const hex = value => value.toString("hex");
const sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const fixedId = (namespace, number) => { const value = Buffer.alloc(16); value[0] = namespace; value.writeUInt32BE(number, 12); return value; };
const digest = value => createHash("sha256").update(value).digest();

// The proxy injects one SQL failure inside the real capture transaction; it
// never changes a guard, statement result, transaction boundary or recipient.
function captureFailurePool(pool, state) {
  return { async getConnection() {
    const connection = await pool.getConnection();
    return new Proxy(connection, { get(target, name) {
      if (["query", "batch"].includes(name)) return async (sql, ...args) => {
        if (/INSERT\s+INTO\s+`?broadcast_recipients`?\b/iu.test(sql) && ++state.pages === 2) throw new Error("synthetic interrupted capture");
        return target[name](sql, ...args);
      };
      const value = target[name]; return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
}

// Observe the real returned page size without changing SQL or results. Schema
// metadata is intentionally excluded: only audience/runtime row reads matter.
function boundedReadPool(pool, observed) {
  return { async getConnection() {
    const connection = await pool.getConnection();
    return new Proxy(connection, { get(target, name) {
      if (name === "query") return async (sql, ...args) => {
        const result = await target.query(sql, ...args);
        if (/\bFROM\s+(?:conversations|broadcast_recipients|users|client_auth_state)\b/iu.test(sql) && Array.isArray(result)) {
          observed.reads += 1; observed.maxRows = Math.max(observed.maxRows, result.length);
        }
        return result;
      };
      const value = target[name]; return typeof value === "function" ? value.bind(target) : value;
    } });
  } };
}

// Keep these read-only statements identical to the three candidate reads in
// store.claim. Record the native optimizer choices rather than pinning a plan
// or elapsed-time threshold that varies between supported MariaDB versions.
async function diagnoseClaimPlans(connection, now, context) {
  const version = (await connection.query("SELECT VERSION() AS version"))[0].version;
  context.diagnostic(JSON.stringify({ qualification: "broadcast-scale", mariaDbVersion: version, audienceCount: 2500 }));
  const projection = "SELECT r.campaign_id, r.conversation_id, r.client_id, c.admin_id, c.mfa_version";
  const statements = [
    ["expiredLeases", `${projection}
          FROM broadcast_recipients r FORCE INDEX (broadcast_recipients_lease) JOIN broadcast_campaigns c ON c.id = r.campaign_id
          WHERE r.state = 'sending' AND r.lease_until <= ? AND c.status IN ('queued', 'running')
          ORDER BY r.lease_until, r.campaign_id, r.conversation_id LIMIT 16`],
    ["expiredPending", `${projection}
          FROM broadcast_campaigns c JOIN broadcast_recipients r ON r.campaign_id = c.id
          WHERE c.status IN ('queued', 'running') AND c.expires_at <= ? AND r.state = 'pending'
          ORDER BY c.expires_at, r.campaign_id, r.conversation_id LIMIT 16`],
    ["pending", `${projection}
          FROM broadcast_recipients r FORCE INDEX (broadcast_recipients_ready) JOIN broadcast_campaigns c ON c.id = r.campaign_id
          WHERE r.state = 'pending' AND r.available_at <= ? AND c.status IN ('queued', 'running')
          ORDER BY r.available_at, r.campaign_id, r.conversation_id LIMIT 16`],
  ];
  for (const [candidateRead, sql] of statements) {
    const plan = await connection.query(`EXPLAIN ${sql}`, [sqlDate(now)]);
    assert.ok(Array.isArray(plan) && plan.length > 0, "native EXPLAIN returned its join plan");
    context.diagnostic(JSON.stringify({ qualification: "broadcast-scale", candidateRead,
      plan: plan.map(row => ({ table: row.table, type: row.type, key: row.key, rows: Number(row.rows) })) }));
  }
}

test("real MariaDB: 2,500-client audience is bounded, atomic, retryable and resumes without duplicate messages", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 240000,
}, async t => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/u, "only disposable synthetic schemas may be reset");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "separate DML runtime credentials are required");
  const migrations = await loadMigrations(); assert.equal(migrations.length, 33);
  const allowed = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  let connection = await connectDatabase(), pool, worker;
  async function reconnectInspection() {
    // The independent DML pool can legitimately spend over 30 seconds draining
    // 2,500 messages. Its idle setup/inspection socket retains the product's
    // ordinary timeout; open a fresh one before inspecting or cleaning up.
    // No SQL statement or failed assertion is retried here.
    const previous = connection; connection = await connectDatabase();
    try { await previous.end(); } catch { /* Only disposal of the old idle socket may fail. */ }
  }
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every(row => allowed.includes(row.name)), "refuse cleanup of unrelated tables");
    for (const table of allowed) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    let now = Date.UTC(2026, 9, 21, 10); const clock = () => now, started = sqlDate(now - 60000);
    const key = randomBytes(32), admin = fixedId(1, 1), otherAdmin = fixedId(1, 2), token = newToken(), otherToken = newToken();
    const actors = new Map();
    for (const [index, owner, raw] of [[1, admin, token], [2, otherAdmin, otherToken]]) {
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, created_at, updated_at)
        VALUES (?, 'admin', 'active', ?, ?, 'synthetic-not-a-password', ?, ?)`, [owner, `Scale administrator ${index}`, `scale-admin-${index}@example.invalid`, started, started]);
      await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic-secret', 1, 1, ?)", [owner, started]);
      const sessionId = fixedId(2, index);
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [sessionId, owner, tokenDigest(raw), started, sqlDate(now + 8 * 3600000)]);
      await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [sessionId, started, started]);
      actors.set(raw, { user: { id: hex(owner), role: "admin", pseudonym: `Scale administrator ${index}` }, csrf: newToken(), expiresAt: now + 8 * 3600000 });
    }
    const clients = Array.from({ length: 2500 }, (_, index) => ({ id: fixedId(3, index + 1), conversationId: fixedId(4, index + 1) }));
    async function insertRows(table, columns, rows) {
      for (let offset = 0; offset < rows.length; offset += 100) {
        const page = rows.slice(offset, offset + 100);
        await connection.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${page.map(row => `(${row.map(() => "?").join(",")})`).join(",")}`, page.flat());
      }
    }
    await insertRows("users", ["id", "role", "status", "pseudonym", "email", "password_hash", "email_verified_at", "access_approved_at", "created_at", "updated_at"],
      clients.map((client, index) => [client.id, "client", "active", `Scale client ${String(index + 1).padStart(4, "0")}`, `scale-${index + 1}@example.invalid`, "synthetic-not-a-password", started, started, started, started]));
    await insertRows("client_auth_state", ["user_id", "credential_version", "age_declared_at"], clients.map(client => [client.id, 1, started]));
    await insertRows("invitations", ["id", "token_hash", "created_by_id", "created_at", "expires_at", "consumed_at", "consumed_by_id"],
      clients.map((client, index) => [fixedId(5, index + 1), digest(`synthetic-scale-invitation-${index}`), admin, started, sqlDate(now + 86400000), started, client.id]));
    await insertRows("conversations", ["id", "client_id", "admin_id", "created_at"], clients.map(client => [client.conversationId, client.id, admin, started]));
    const tag = fixedId(6, 1);
    await connection.query(`INSERT INTO crm_labels (id, owner_admin_id, kind, name, normalized_name, created_at, updated_at)
      VALUES (?, ?, 'tag', 'Scale sample', 'scale sample', ?, ?)`, [tag, admin, started, started]);
    await insertRows("crm_profiles", ["admin_id", "conversation_id", "version", "notes_revision", "created_at", "updated_at"], clients.slice(0, 175).map(client => [admin, client.conversationId, 1, 1, started, started]));
    await insertRows("crm_memberships", ["admin_id", "conversation_id", "label_id", "created_at"], clients.slice(0, 175).map(client => [admin, client.conversationId, tag, started]));
    // Two subscriptions exercise the real atomic outbox hook without contacting
    // a push provider. The remaining 2,498 clients have no subscription.
    for (const [index, client] of [clients[0], clients.at(-1)].entries()) {
      const sessionId = fixedId(7, index + 1);
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [sessionId, client.id, digest(`scale-client-session-${index}`), started, sqlDate(now + 8 * 3600000)]);
      await connection.query(`INSERT INTO push_subscriptions (id, user_id, role, session_id, credential_version, generation,
        endpoint_digest, subscription_encrypted, locale, enabled, created_at, updated_at) VALUES (?, ?, 'client', ?, 1, 1, ?, 'synthetic-only', 'fr', 1, ?, ?)`,
      [fixedId(8, index + 1), client.id, sessionId, digest(`scale-endpoint-${index}`), started, started]);
    }
    const observed = { reads: 0, maxRows: 0 }, measuredPool = boundedReadPool(pool, observed);
    const authStore = createAuthStore(pool), chatStore = createChatStore(measuredPool, { clock, enqueueNotification });
    const store = createBroadcastStore(measuredPool, { chatStore, clock });
    const authService = { session: async raw => actors.get(raw) ?? null };
    const serviceOptions = { store, authStore, authService, key, clock };
    const service = await createBroadcastService({ ...serviceOptions, largeAudiencesEnabled: true });
    const compat = await createBroadcastService(serviceOptions);
    assert.equal(await store.assertSchema(), true);
    const all = { mode: "all" };
    const input = (preview, overrides = {}) => ({ clientCampaignId: hex(randomBytes(16)), title: "Synthetic private scale campaign", body: "A private synthetic message, exactly once 💬", mediaId: null,
      allowRepeatMedia: false, audience: all, previewToken: preview.previewToken, ...overrides });
    const rowCount = async () => Number((await connection.query("SELECT COUNT(*) AS value FROM broadcast_campaigns"))[0].value);
    let preview, request, campaign;

    await t.test("preview counts 2,500 while returning at most 50, filters select 175, and compatibility mode rejects new creation", async () => {
      preview = await service.preview(token, { audience: all, mediaId: null });
      assert.equal(preview.totalCount, 2500); assert.equal(preview.eligibleCount, 2500); assert.equal(preview.excludedCount, 0); assert.equal(preview.repeatCount, 0);
      assert.equal(preview.recipients.length, 50); assert.equal(typeof preview.previewToken, "string");
      const filtered = await service.preview(token, { audience: { mode: "filtered", filters: { q: "", tagId: hex(tag), groupId: null, access: "all", unread: false, reminder: "all" } }, mediaId: null });
      assert.equal(filtered.eligibleCount, 175); assert.equal(filtered.recipients.length, 50);
      await assert.rejects(compat.preview(token, { audience: all, mediaId: null }));
      await assert.rejects(compat.create(token, input(preview)));
      assert.equal(await rowCount(), 0);
      assert.doesNotMatch(JSON.stringify(preview), /@example|password|payloadEncrypted|leaseToken|notes/iu);
    });

    await t.test("a changed audience after preview cannot silently create a narrower or broader campaign", async () => {
      const attempted = input(preview);
      await connection.query("UPDATE users SET status = 'revoked' WHERE id = ?", [clients[0].id]);
      try { await assert.rejects(service.create(token, attempted)); }
      finally { await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [clients[0].id]); }
      assert.equal(await rowCount(), 0);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM broadcast_recipients"))[0].value), 0);
    });

    await t.test("capture page two failure rolls back all rows and the same request can then commit", async context => {
      preview = await service.preview(token, { audience: all, mediaId: null }); request = input(preview);
      const failure = { pages: 0 }, failingPool = captureFailurePool(measuredPool, failure);
      const failingChat = createChatStore(failingPool, { clock, enqueueNotification });
      const failingStore = createBroadcastStore(failingPool, { chatStore: failingChat, clock });
      const failingService = await createBroadcastService({ ...serviceOptions, store: failingStore, largeAudiencesEnabled: true });
      await assert.rejects(failingService.create(token, request), error => !String(error.message).includes("synthetic interrupted capture"));
      assert.equal(failure.pages, 2, "the failure occurs after the first real recipient insert page");
      assert.equal(await rowCount(), 0);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM broadcast_recipients"))[0].value), 0);
      const createStarted = performance.now();
      const result = await service.create(token, request);
      context.diagnostic(JSON.stringify({ qualification: "broadcast-scale", operation: "capture", audienceCount: 2500, elapsedMs: Number((performance.now() - createStarted).toFixed(1)) }));
      assert.equal(result.duplicate, false); campaign = result.campaign;
      assert.equal(campaign.counts.total, 2500); assert.equal(campaign.counts.pending, 2500);
      const stored = (await connection.query("SELECT payload_encrypted FROM broadcast_campaigns WHERE id = ?", [Buffer.from(campaign.id, "hex")]))[0];
      assert.match(stored.payload_encrypted, /^v2\./u); assert.ok(stored.payload_encrypted.length <= 32000);
    });

    await t.test("a lost confirmation retry after token expiry returns the frozen campaign and compatibility can inspect it", async () => {
      now += 11 * 60000;
      await connection.query("UPDATE users SET status = 'revoked' WHERE id = ?", [clients[0].id]);
      try {
        const duplicate = await service.create(token, request); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.campaign.id, campaign.id); assert.equal(duplicate.campaign.counts.total, 2500);
      } finally { await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [clients[0].id]); }
      await assert.rejects(service.create(token, { ...request, body: "Different immutable content" }));
      const summary = await compat.summary(token, campaign.id); assert.equal(summary.counts.total, 2500);
      let cursor = null, seen = new Set(), pages = 0;
      do {
        const page = await compat.recipients(token, campaign.id, { afterId: cursor, limit: 50 });
        assert.equal(page.campaignId, campaign.id); assert.ok(page.recipients.length <= 50);
        assert.doesNotMatch(JSON.stringify(page), /@example|leaseToken|payloadEncrypted|proposedMessageId|recipientProof/iu);
        for (const recipient of page.recipients) { assert.ok(!seen.has(recipient.conversationId)); assert.ok(cursor === null || recipient.conversationId > cursor); seen.add(recipient.conversationId); }
        cursor = page.nextCursor; pages++;
        assert.ok(pages <= 50, "bounded keyset traversal must finish");
        if (!page.hasMore) { assert.equal(cursor, null); break; }
        assert.equal(cursor, page.recipients.at(-1).conversationId);
      } while (cursor !== null);
      assert.equal(pages, 50); assert.equal(seen.size, 2500);
      await assert.rejects(service.recipients(otherToken, campaign.id, { afterId: null, limit: 50 }));
      assert.equal(await rowCount(), 1);
    });

    await t.test("expired leases preserve identifiers, quotas defer without attempts, and a new worker drains exactly once", async context => {
      await diagnoseClaimPlans(connection, now, context);
      const drainStarted = performance.now();
      const abandoned = await store.claim({ now, leaseMilliseconds: 1000 }); assert.ok(abandoned);
      now += 1001;
      const reclaimed = await store.claim({ now, leaseMilliseconds: 1000 }); assert.ok(reclaimed);
      assert.deepEqual(reclaimed.messageId, abandoned.messageId); assert.deepEqual(reclaimed.clientMessageId, abandoned.clientMessageId);
      assert.notDeepEqual(reclaimed.leaseToken, abandoned.leaseToken);
      assert.equal(await store.defer(abandoned, { now, availableAt: now }), false);
      assert.equal(await store.defer(reclaimed, { now, availableAt: now }), true);
      worker = createBroadcastWorker({ store, authStore, key, clock, batchSize: 20 });
      let firstWindow = { delivered: 0, deferred: 0, failed: 0 };
      for (let batch = 0; batch < 7; batch++) {
        const result = await worker.runOnce();
        for (const key of Object.keys(firstWindow)) firstWindow[key] += result[key];
      }
      assert.deepEqual(firstWindow, { delivered: 120, deferred: 20, failed: 0 });
      assert.equal(Number((await connection.query("SELECT MAX(attempts) AS value FROM broadcast_recipients WHERE campaign_id = ?", [Buffer.from(campaign.id, "hex")]))[0].value), 0);
      await worker.stop(); worker = createBroadcastWorker({ store, authStore, key, clock, batchSize: 20 });
      let complete = false;
      for (let window = 0; window < 22; window++) {
        now += 61000;
        for (let batch = 0; batch < 6; batch++) await worker.runOnce();
        const summary = await service.summary(token, campaign.id);
        assert.equal(summary.counts.total, 2500); assert.equal(summary.counts.failed, 0); assert.equal(summary.counts.skipped, 0);
        if (summary.status === "completed") { assert.equal(summary.counts.delivered, 2500); complete = true; break; }
      }
      assert.equal(complete, true, "injected time allows the real 120/minute limiter to complete without sleeping");
      context.diagnostic(JSON.stringify({ qualification: "broadcast-scale", operation: "drain", audienceCount: 2500, elapsedMs: Number((performance.now() - drainStarted).toFixed(1)) }));
      await reconnectInspection();
      const totals = (await connection.query(`SELECT COUNT(*) AS total, COUNT(DISTINCT id) AS messageIds,
        COUNT(DISTINCT conversation_id) AS conversations, COUNT(DISTINCT client_message_id) AS clientIds FROM messages WHERE sender_id = ?`, [admin]))[0];
      for (const value of Object.values(totals)) assert.equal(Number(value), 2500);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM chat_events WHERE kind = 'message'"))[0].value), 2500);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM push_outbox"))[0].value), 2);
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM broadcast_preferences"))[0].value), 0, "no consent rows or client broadcast surface is recreated");
      const rows = await connection.query("SELECT id, conversation_id, body_encrypted FROM messages ORDER BY conversation_id LIMIT 2");
      for (const row of rows) {
        const text = decryptMessageBody(row.body_encrypted, key, { messageId: row.id, conversationId: row.conversation_id, senderId: admin });
        assert.equal(text, request.body); assert.ok(!text.includes(request.title)); assert.ok(!text.includes("audience"));
      }
      assert.equal(await store.claim({ now }), null);
      assert.ok(observed.reads > 100, "the real workload crossed many bounded SQL pages");
      assert.ok(observed.maxRows <= 100, `runtime audience reads never gather all 2,500 rows (${observed.maxRows})`);
    });
  } finally {
    await worker?.stop(); await pool?.end(); await reconnectInspection();
    try { await reset(); } finally { await connection.end(); }
  }
});
