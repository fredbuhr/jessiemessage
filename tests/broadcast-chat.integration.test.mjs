import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createChatStore, ChatStoreError } from "../server/chat/store.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16), digest = () => randomBytes(32);
const now = Date.UTC(2026, 9, 15, 12);
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const code = (expected) => (error) => error instanceof ChatStoreError && error.code === expected && error.cause === undefined;
const payload = (extra = {}) => ({ id: id(), clientMessageId: id(), bodyEncrypted: `v1.synthetic-${digest().toString("base64url")}`, bodyFingerprint: digest(), ...extra });

test("real MariaDB trusted broadcast/chat transactions (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 120000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "integration tests require separately provisioned runtime DML credentials");
  const migrations = await loadMigrations();
  const ownedTables = migrations.map((migration) => /^CREATE\s+TABLE\s+([a-z][a-z0-9_]*)\s*\(/i.exec(migration.sql.trim())[1]).reverse();
  const allowedTables = [...ownedTables, "migration_probe", "schema_migrations"];
  const connection = await connectDatabase();
  let pool, fixtureSequence = 0;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset();
    await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const store = createChatStore(pool);
    async function user(role = "client") {
      const item = { id: id(), sessionId: id(), tokenHash: digest(), role, pseudonym: `Synthetic ${role} ${fixtureSequence++}` };
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at,
        age_assured_at, access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?, ?)`,
      [item.id, role, item.pseudonym, `broadcast-chat-${fixtureSequence}@example.invalid`, role === "client" ? sqlDate(now) : null,
        role === "client" ? sqlDate(now) : null, role === "client" ? sqlDate(now) : null, sqlDate(now), sqlDate(now)]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic-encrypted-secret', 1, 1, ?)", [item.id, sqlDate(now)]);
      else await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [item.id, sqlDate(now)]);
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [item.sessionId, item.id, item.tokenHash, sqlDate(now), sqlDate(now + 8 * 3600000)]);
      if (role === "admin") await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [item.sessionId, sqlDate(now), sqlDate(now)]);
      else await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", [item.sessionId, sqlDate(now)]);
      return item;
    }
    async function pair() {
      const fixture = { admin: await user("admin"), client: await user(), conversationId: id() };
      await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [fixture.conversationId, fixture.client.id, fixture.admin.id, sqlDate(now)]);
      return fixture;
    }
    const delivery = (fixture, extra = {}) => ({ adminId: fixture.admin.id, mfaVersion: 1, conversationId: fixture.conversationId, now, ...extra });
    const preference = (client, extra = {}) => ({ tokenHash: client.tokenHash, now, ...extra });
    const chatRequest = (fixture, role = "client", extra = {}) => ({ role, tokenHash: fixture[role].tokenHash, conversationId: fixture.conversationId, now, ...extra });
    const counts = async (fixture) => ({
      messages: Number((await connection.query("SELECT COUNT(*) AS value FROM messages WHERE conversation_id = ?", [fixture.conversationId]))[0].value),
      events: Number((await connection.query("SELECT COUNT(*) AS value FROM chat_events WHERE conversation_id = ?", [fixture.conversationId]))[0].value),
    });
    async function asset(owner) {
      const mediaId = id(), contentDigest = digest();
      await connection.query(`INSERT INTO media_assets (id, owner_id, owner_role, storage_key, content_digest, active_digest,
        width, height, thumbnail_width, thumbnail_height, full_bytes, thumbnail_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1200, 800, 480, 320, 42000, 7000, ?)`,
      [mediaId, owner.id, owner.role, digest(), contentDigest, contentDigest, sqlDate(now)]);
      return mediaId;
    }

    await t.test("administrator actor exposes the current locked MFA epoch", async () => {
      const fixture = await pair();
      const snapshot = () => store.withActor({ role: "admin", tokenHash: fixture.admin.tokenHash, now }, (_connection, context) => context.mfaVersion);
      assert.equal(await snapshot(), 1);
      await connection.query("UPDATE admin_mfa SET version = 2 WHERE user_id = ?", [fixture.admin.id]);
      await assert.rejects(snapshot(), code("CHAT_UNAUTHORIZED"));
      await connection.query("UPDATE auth_session_state SET mfa_version = 2 WHERE session_id = ?", [fixture.admin.sessionId]);
      assert.equal(await snapshot(), 2);
    });

    await t.test("verified pending and expired clients can manage preferences without a conversation or chat gates", async () => {
      const client = await user();
      for (const status of ["pending", "active"]) {
        if (status === "pending") await connection.query("UPDATE users SET status = 'pending', age_assured_at = NULL, access_approved_at = NULL, access_expires_at = NULL WHERE id = ?", [client.id]);
        else await connection.query("UPDATE users SET status = 'active', age_assured_at = ?, access_approved_at = ?, access_expires_at = ? WHERE id = ?", [sqlDate(now + 1), sqlDate(now - 2000), sqlDate(now - 1), client.id]);
        const result = await store.withPreferenceActor(preference(client), (_connection, context) => ({ id: context.actor.id, client: context.client.id, expiresAt: context.expiresAt }));
        assert.ok(result.id.equals(client.id)); assert.ok(result.client.equals(client.id));
        assert.equal(result.expiresAt, now + 8 * 3600000);
      }
    });

    await t.test("preferences recheck client identity, verification, credential epoch and revoked sessions", async () => {
      const client = await user(), admin = await user("admin");
      const check = () => store.withPreferenceActor(preference(client), () => true);
      for (const status of ["suspended", "revoked", "deleted"]) {
        await connection.query("UPDATE users SET status = ? WHERE id = ?", [status, client.id]);
        await assert.rejects(check(), code("CHAT_UNAUTHORIZED"));
      }
      await connection.query("UPDATE users SET status = 'pending', email_verified_at = NULL WHERE id = ?", [client.id]);
      await assert.rejects(check(), code("CHAT_UNAUTHORIZED"));
      await connection.query("UPDATE users SET email_verified_at = ? WHERE id = ?", [sqlDate(now + 1), client.id]);
      await assert.rejects(check(), code("CHAT_UNAUTHORIZED"));
      await connection.query("UPDATE users SET status = 'active', email_verified_at = ? WHERE id = ?", [sqlDate(now), client.id]);
      await connection.query("UPDATE client_auth_state SET credential_version = 2 WHERE user_id = ?", [client.id]);
      await assert.rejects(check(), code("CHAT_UNAUTHORIZED"));
      await connection.query("UPDATE client_session_state SET credential_version = 2 WHERE session_id = ?", [client.sessionId]);
      assert.equal(await check(), true);
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [sqlDate(now), client.sessionId]);
      await assert.rejects(check(), code("CHAT_UNAUTHORIZED"));
      await assert.rejects(store.withPreferenceActor(preference(admin), () => true), code("CHAT_UNAUTHORIZED"));
      await assert.rejects(store.withPreferenceActor({ tokenHash: digest(), now }, () => true), code("CHAT_UNAUTHORIZED"));
      const missingProof = await user();
      await connection.query("DELETE FROM client_auth_state WHERE user_id = ?", [missingProof.id]);
      await assert.rejects(store.withPreferenceActor(preference(missingProof), () => true), code("CHAT_UNAUTHORIZED"));
    });

    await t.test("preferences enforce absolute and idle boundaries and reject future session state", async () => {
      const client = await user();
      await assert.rejects(store.withPreferenceActor(preference(client, { now: now + 1800000 }), () => true), code("CHAT_UNAUTHORIZED"));
      await connection.query("UPDATE sessions SET expires_at = ? WHERE id = ?", [sqlDate(now + 1), client.sessionId]);
      await assert.rejects(store.withPreferenceActor(preference(client, { now: now + 1 }), () => true), code("CHAT_UNAUTHORIZED"));
      await connection.query("UPDATE sessions SET expires_at = ? WHERE id = ?", [sqlDate(now + 8 * 3600000), client.sessionId]);
      await connection.query("UPDATE client_session_state SET last_seen_at = ? WHERE session_id = ?", [sqlDate(now + 1), client.sessionId]);
      await assert.rejects(store.withPreferenceActor(preference(client), () => true), code("CHAT_UNAUTHORIZED"));
    });

    await t.test("durable delivery needs no live administrator cookie and produces ordinary isolated chat rows", async () => {
      const fixture = await pair(), message = payload();
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [sqlDate(now), fixture.admin.sessionId]);
      const sent = await store.withBroadcastDelivery(delivery(fixture), (_connection, context, append) => {
        assert.equal(context.canSend, true); assert.equal(context.reason, null); return append(message);
      });
      assert.equal(sent.duplicate, false); assert.ok(sent.message.id.equals(message.id));
      const read = await store.readMessages(chatRequest(fixture));
      assert.equal(read.messages.length, 1); assert.equal(read.messages[0].senderRole, "admin");
      for (const property of ["campaignId", "recipients", "audience", "crm", "email"]) assert.equal(Object.hasOwn(read.messages[0], property), false);
    });

    await t.test("message, event and caller recipient finalization commit or roll back together", async () => {
      const fixture = await pair(), message = payload(), campaignId = id();
      await connection.query(`INSERT INTO broadcast_campaigns (id, admin_id, client_campaign_id, mfa_version, payload_encrypted,
        request_fingerprint, created_at, updated_at, expires_at) VALUES (?, ?, ?, 1, 'v1.synthetic', ?, ?, ?, ?)`,
      [campaignId, fixture.admin.id, id(), digest(), sqlDate(now), sqlDate(now), sqlDate(now + 86400000)]);
      await connection.query(`INSERT INTO broadcast_recipients (campaign_id, conversation_id, client_id, proposed_message_id,
        client_message_id, available_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [campaignId, fixture.conversationId, fixture.client.id, message.id, message.clientMessageId, sqlDate(now), sqlDate(now)]);
      const commit = (rollback) => store.withBroadcastDelivery(delivery(fixture), async (sql, _context, append) => {
        await sql.query("SELECT id FROM broadcast_campaigns WHERE id = ? FOR UPDATE", [campaignId]);
        await sql.query("SELECT state FROM broadcast_recipients WHERE campaign_id = ? AND conversation_id = ? FOR UPDATE", [campaignId, fixture.conversationId]);
        await append(message);
        await sql.query("UPDATE broadcast_recipients SET state = 'delivered', delivered_message_id = ?, delivered_at = ? WHERE campaign_id = ? AND conversation_id = ?", [message.id, sqlDate(now), campaignId, fixture.conversationId]);
        if (rollback) throw new ChatStoreError("CHAT_CONFLICT");
      });
      await assert.rejects(commit(true), code("CHAT_CONFLICT"));
      assert.deepEqual(await counts(fixture), { messages: 0, events: 0 });
      assert.equal((await connection.query("SELECT state FROM broadcast_recipients WHERE campaign_id = ?", [campaignId]))[0].state, "pending");
      await commit(false);
      assert.deepEqual(await counts(fixture), { messages: 1, events: 1 });
      const recipient = (await connection.query("SELECT state, delivered_message_id FROM broadcast_recipients WHERE campaign_id = ?", [campaignId]))[0];
      assert.equal(recipient.state, "delivered"); assert.ok(recipient.delivered_message_id.equals(message.id));
    });

    await t.test("retries share normal idempotency and never resurrect deleted messages", async () => {
      const fixture = await pair(), message = payload();
      const append = (value = message) => store.withBroadcastDelivery(delivery(fixture), (_sql, _context, send) => send(value));
      await append(); assert.equal((await append({ ...message, id: id() })).duplicate, true);
      await assert.rejects(append({ ...message, bodyFingerprint: digest() }), code("CHAT_CONFLICT"));
      await store.deleteMessage({ ...chatRequest(fixture, "admin"), messageId: message.id });
      const retried = await append();
      assert.equal(retried.duplicate, true); assert.equal(retried.message.deletedAt, now); assert.equal(retried.message.bodyEncrypted, null);
      assert.deepEqual(await counts(fixture), { messages: 1, events: 2 });
    });

    await t.test("append is a one-shot capability scoped to its transaction", async () => {
      const fixture = await pair(); let escaped;
      await store.withBroadcastDelivery(delivery(fixture), async (_sql, _context, append) => {
        escaped = append; await append(payload()); await assert.rejects(append(payload()), code("CHAT_FORBIDDEN"));
      });
      await assert.rejects(escaped(payload()), code("CHAT_FORBIDDEN"));
      assert.deepEqual(await counts(fixture), { messages: 1, events: 1 });
    });

    await t.test("every client gate, closure and reassignment is checked immediately under locks", async () => {
      const fixture = await pair();
      const denied = () => store.withBroadcastDelivery(delivery(fixture), async (_sql, context, append) => {
        assert.equal(context.canSend, false); assert.equal(context.reason, "recipient_unavailable");
        await assert.rejects(append(payload()), code("CHAT_FORBIDDEN"));
      });
      for (const status of ["pending", "suspended", "revoked", "deleted"]) {
        await connection.query("UPDATE users SET status = ? WHERE id = ?", [status, fixture.client.id]); await denied();
      }
      await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [fixture.client.id]);
      for (const field of ["email_verified_at", "age_assured_at", "access_approved_at"]) {
        await connection.query(`UPDATE users SET status = 'pending', ${field} = NULL WHERE id = ?`, [fixture.client.id]); await denied();
        await connection.query(`UPDATE users SET status = 'active', ${field} = ? WHERE id = ?`, [sqlDate(now + 1), fixture.client.id]); await denied();
        await connection.query(`UPDATE users SET ${field} = ? WHERE id = ?`, [sqlDate(now), fixture.client.id]);
      }
      await connection.query("UPDATE users SET access_approved_at = ?, access_expires_at = ? WHERE id = ?", [sqlDate(now - 1), sqlDate(now), fixture.client.id]); await denied();
      await connection.query("UPDATE users SET access_expires_at = NULL WHERE id = ?", [fixture.client.id]);
      await connection.query("UPDATE conversations SET closed_at = ? WHERE id = ?", [sqlDate(now), fixture.conversationId]); await denied();
      await connection.query("UPDATE conversations SET closed_at = NULL WHERE id = ?", [fixture.conversationId]);
      const otherAdmin = await user("admin");
      await connection.query("UPDATE conversations SET admin_id = ? WHERE id = ?", [otherAdmin.id, fixture.conversationId]); await denied();
      await store.withBroadcastDelivery(delivery(fixture, { conversationId: id() }), (_sql, context) => {
        assert.equal(context.canSend, false); assert.equal(context.conversation, null); assert.equal(context.reason, "recipient_unavailable");
      });
      await connection.query("UPDATE conversations SET admin_id = ? WHERE id = ?", [fixture.admin.id, fixture.conversationId]);
      await connection.query("DELETE FROM client_auth_state WHERE user_id = ?", [fixture.client.id]);
      await denied();
      assert.deepEqual(await counts(fixture), { messages: 0, events: 0 });
    });

    await t.test("administrator revocation or changed MFA allows terminal metadata but blocks append", async () => {
      const fixture = await pair(); let callbacks = 0;
      const denied = () => store.withBroadcastDelivery(delivery(fixture), async (_sql, context, append) => {
        callbacks++; assert.equal(context.canSend, false); assert.equal(context.reason, "administrator_invalid");
        await assert.rejects(append(payload()), code("CHAT_FORBIDDEN"));
      });
      for (const status of ["pending", "suspended", "revoked", "deleted"]) {
        await connection.query("UPDATE users SET status = ? WHERE id = ?", [status, fixture.admin.id]); await denied();
      }
      await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [fixture.admin.id]);
      await connection.query("UPDATE admin_mfa SET version = 2 WHERE user_id = ?", [fixture.admin.id]); await denied();
      assert.equal(await store.withBroadcastDelivery(delivery(fixture, { mfaVersion: 2 }), (_sql, context) => context.canSend), true);
      await connection.query("UPDATE admin_mfa SET version = 1, enabled_at = ? WHERE user_id = ?", [sqlDate(now + 1), fixture.admin.id]); await denied();
      await connection.query("DELETE FROM admin_mfa WHERE user_id = ?", [fixture.admin.id]); await denied();
      assert.equal(callbacks, 7); assert.deepEqual(await counts(fixture), { messages: 0, events: 0 });
    });

    await t.test("photo delivery reuses private owned media and atomically inserts its binding", async () => {
      const fixture = await pair(), ownMedia = await asset(fixture.admin), foreignMedia = await asset(fixture.client);
      const send = (mediaId) => store.withBroadcastDelivery(delivery(fixture), (_sql, _context, append) => append(payload({ mediaId })));
      await assert.rejects(send(foreignMedia), code("CHAT_NOT_FOUND"));
      const sent = await send(ownMedia); assert.ok(sent.message.media.id.equals(ownMedia));
      assert.equal(Number((await connection.query("SELECT COUNT(*) AS value FROM message_media WHERE conversation_id = ?", [fixture.conversationId]))[0].value), 1);
      await connection.query("UPDATE media_assets SET active_digest = NULL, deleted_at = ? WHERE id = ?", [sqlDate(now), ownMedia]);
      await assert.rejects(send(ownMedia), code("CHAT_NOT_FOUND"));
      assert.deepEqual(await counts(fixture), { messages: 1, events: 1 });
    });

    await t.test("manual sends and worker delivery serialize sequence allocation and observe blocked revocation", async () => {
      const fixture = await pair();
      const sent = await Promise.all([
        store.sendMessage({ ...chatRequest(fixture, "admin"), message: payload() }),
        store.withBroadcastDelivery(delivery(fixture), (_sql, _context, append) => append(payload())),
      ]);
      assert.deepEqual(sent.map((result) => result.message.sequence).sort(), ["1", "2"]);
      await connection.beginTransaction();
      await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [fixture.client.id]);
      const blocked = store.withBroadcastDelivery(delivery(fixture), (_sql, context) => context.canSend);
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [fixture.client.id]);
      await connection.commit();
      assert.equal(await blocked, false);
      assert.deepEqual(await counts(fixture), { messages: 2, events: 2 });
    });
  } finally {
    if (pool) await pool.end();
    try { await reset(); } finally { await connection.end(); }
  }
});
