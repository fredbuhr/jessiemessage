import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createChatStore, ChatStoreError } from "../server/chat/store.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16);
const digest = () => randomBytes(32);
const now = Date.UTC(2026, 9, 14, 12);
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const cipher = () => `v1.synthetic-encrypted-fixture-${randomBytes(32).toString("base64url")}`;
const errorCode = (expected) => (error) => error instanceof ChatStoreError && error.code === expected && error.cause === undefined;

test("real MariaDB private text chat persistence (synthetic disposable database only)", {
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
  let pool;
  let fixtureSequence = 0;
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

    async function user(role) {
      const result = { id: id(), sessionId: id(), tokenHash: digest(), role, pseudonym: `Synthetic ${role} ${fixtureSequence++}` };
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at,
        age_assured_at, access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?, ?)`,
      [result.id, role, result.pseudonym, `chat-${fixtureSequence}@example.invalid`,
        role === "client" ? sqlDate(now) : null, role === "client" ? sqlDate(now) : null,
        role === "client" ? sqlDate(now) : null, sqlDate(now), sqlDate(now)]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic-encrypted-secret', 1, 1, ?)", [result.id, sqlDate(now)]);
      else await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [result.id, sqlDate(now)]);
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [result.sessionId, result.id, result.tokenHash, sqlDate(now), sqlDate(now + 8 * 3600000)]);
      if (role === "admin") await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [result.sessionId, sqlDate(now), sqlDate(now)]);
      else await connection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", [result.sessionId, sqlDate(now)]);
      return result;
    }
    async function pair(admin = null) {
      const result = { admin: admin ?? await user("admin"), client: await user("client"), conversationId: id() };
      await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [result.conversationId, result.client.id, result.admin.id, sqlDate(now)]);
      return result;
    }
    const request = (fixture, role = "client", extra = {}) => ({ role, tokenHash: fixture[role].tokenHash, conversationId: fixture.conversationId, now, ...extra });
    const payload = (extra = {}) => ({ id: id(), clientMessageId: id(), bodyEncrypted: cipher(), bodyFingerprint: digest(), ...extra });
    const send = (fixture, role = "client", message = payload(), extra = {}) => store.sendMessage({ ...request(fixture, role, extra), message });
    const read = (fixture, role = "client", extra = {}) => store.readMessages(request(fixture, role, extra));
    const counts = async (fixture) => ({
      messages: Number((await connection.query("SELECT COUNT(*) AS value FROM messages WHERE conversation_id = ?", [fixture.conversationId]))[0].value),
      events: Number((await connection.query("SELECT COUNT(*) AS value FROM chat_events WHERE conversation_id = ?", [fixture.conversationId]))[0].value),
    });

    await t.test("read-only schema checks reject dirty history, unsigned/type drift, lost uniqueness and missing CHECK/FK enforcement", async () => {
      assert.equal(await store.assertSchema(), true);
      await connection.query("UPDATE schema_migrations SET state = 'failed', finished_at = NULL WHERE version = 27");
      try { await assert.rejects(store.assertSchema(), errorCode("CHAT_DATABASE_STATE")); }
      finally { await connection.query("UPDATE schema_migrations SET state = 'applied', finished_at = CURRENT_TIMESTAMP(6) WHERE version = 27"); }
      await connection.query("ALTER TABLE chat_receipts MODIFY last_read_sequence BIGINT NOT NULL DEFAULT 0");
      try { await assert.rejects(store.assertSchema(), errorCode("CHAT_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE chat_receipts MODIFY last_read_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0"); }
      await connection.query("ALTER TABLE messages DROP INDEX messages_idempotency");
      try { await assert.rejects(store.assertSchema(), errorCode("CHAT_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE messages ADD UNIQUE KEY messages_idempotency (conversation_id, sender_id, client_message_id)"); }
      await connection.query("ALTER TABLE chat_events DROP CONSTRAINT chat_events_kind");
      try { await assert.rejects(store.assertSchema(), errorCode("CHAT_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE chat_events ADD CONSTRAINT chat_events_kind CHECK (kind IN ('message', 'delete'))"); }
      await connection.query("ALTER TABLE chat_events DROP CONSTRAINT chat_events_kind");
      await connection.query("ALTER TABLE chat_events ADD CONSTRAINT chat_events_kind CHECK (1)");
      try { await assert.rejects(store.assertSchema(), errorCode("CHAT_DATABASE_STATE")); }
      finally {
        await connection.query("ALTER TABLE chat_events DROP CONSTRAINT chat_events_kind");
        await connection.query("ALTER TABLE chat_events ADD CONSTRAINT chat_events_kind CHECK (kind IN ('message', 'delete'))");
      }
      await connection.query("ALTER TABLE chat_events DROP FOREIGN KEY chat_events_message_fk");
      try { await assert.rejects(store.assertSchema(), errorCode("CHAT_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE chat_events ADD CONSTRAINT chat_events_message_fk FOREIGN KEY (conversation_id, message_id) REFERENCES messages (conversation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT"); }
      assert.equal(await store.assertSchema(), true);
    });

    await t.test("direct store calls isolate clients and assigned administrators without exposing mailbox, credentials or encrypted previews", async () => {
      const a = await pair(), b = await pair(a.admin), other = await pair();
      const sent = await send(a, "admin");
      assert.equal((await read(a)).messages[0].id.toString("hex"), sent.message.id.toString("hex"));
      await assert.rejects(store.readMessages({ ...request(b), conversationId: a.conversationId }), errorCode("CHAT_NOT_FOUND"));
      await assert.rejects(store.readEvents({ ...request(other, "admin"), conversationId: a.conversationId }), errorCode("CHAT_NOT_FOUND"));
      await assert.rejects(store.markRead({ ...request(b), conversationId: a.conversationId, through: "1" }), errorCode("CHAT_NOT_FOUND"));
      await assert.rejects(store.sendMessage({ ...request(b), conversationId: a.conversationId, message: payload() }), errorCode("CHAT_NOT_FOUND"));
      await assert.rejects(store.deleteMessage({ ...request(b), conversationId: a.conversationId, messageId: sent.message.id }), errorCode("CHAT_NOT_FOUND"));
      await assert.rejects(read(a, "client", { conversationId: id() }), errorCode("CHAT_NOT_FOUND"));
      const mine = await store.getClientConversation({ tokenHash: a.client.tokenHash, now });
      assert.ok(mine.id.equals(a.conversationId)); assert.equal(mine.peerPseudonym, a.admin.pseudonym);
      const listed = await store.listConversations({ tokenHash: a.admin.tokenHash, now });
      assert.equal(listed.conversations.length, 2);
      for (const item of [...listed.conversations, mine]) {
        for (const property of ["email", "passwordHash", "tokenHash", "bodyEncrypted", "secretEncrypted", "preview"]) assert.equal(Object.hasOwn(item, property), false);
      }
      assert.equal((await store.listConversations({ tokenHash: other.admin.tokenHash, now })).conversations.length, 1);
    });

    await t.test("client access rechecks all live gates and deadlines and an active confirmed creator on each call", async () => {
      const fixture = await pair(); await send(fixture);
      for (const status of ["pending", "suspended", "revoked", "deleted"]) {
        await connection.query("UPDATE users SET status = ? WHERE id = ?", [status, fixture.client.id]);
        await assert.rejects(read(fixture), errorCode("CHAT_FORBIDDEN"));
      }
      await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [fixture.client.id]);
      for (const column of ["email_verified_at", "age_assured_at", "access_approved_at"]) {
        await connection.query(`UPDATE users SET ${column} = ? WHERE id = ?`, [sqlDate(now + 1000), fixture.client.id]);
        try { await assert.rejects(read(fixture), errorCode("CHAT_FORBIDDEN")); }
        finally { await connection.query(`UPDATE users SET ${column} = ? WHERE id = ?`, [sqlDate(now), fixture.client.id]); }
      }
      await connection.query("UPDATE users SET access_expires_at = ? WHERE id = ?", [sqlDate(now + 1000), fixture.client.id]);
      await assert.rejects(read(fixture, "client", { now: now + 1000 }), errorCode("CHAT_FORBIDDEN"));
      assert.equal((await read(fixture, "admin", { now: now + 1000 })).messages.length, 1, "assigned administrator may inspect expired history");
      await connection.query("UPDATE users SET access_expires_at = NULL WHERE id = ?", [fixture.client.id]);
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [fixture.admin.id]);
      try { await assert.rejects(read(fixture), errorCode("CHAT_FORBIDDEN")); }
      finally { await connection.query("UPDATE users SET status = 'active' WHERE id = ?", [fixture.admin.id]); }
      await connection.query("UPDATE admin_mfa SET enabled_at = NULL, last_totp_step = -1 WHERE user_id = ?", [fixture.admin.id]);
      try { await assert.rejects(read(fixture), errorCode("CHAT_FORBIDDEN")); }
      finally { await connection.query("UPDATE admin_mfa SET enabled_at = ?, last_totp_step = 1 WHERE user_id = ?", [sqlDate(now), fixture.admin.id]); }
      assert.equal((await read(fixture)).messages.length, 1);
    });

    await t.test("revocation, absolute/idle expiry, clock reversal, credential generation and MFA proof are enforced inside the transaction", async () => {
      const fixture = await pair();
      await assert.rejects(read(fixture, "client", { tokenHash: digest() }), errorCode("CHAT_UNAUTHORIZED"));
      await assert.rejects(read(fixture, "client", { now: now + 1800000 }), errorCode("CHAT_UNAUTHORIZED"));
      // Keep the creator's enrollment valid at this earlier instant so this
      // assertion reaches the actor session's future-created/last-seen check.
      await connection.query("UPDATE admin_mfa SET enabled_at = ? WHERE user_id = ?", [sqlDate(now - 1000), fixture.admin.id]);
      try { await assert.rejects(read(fixture, "client", { now: now - 1 }), errorCode("CHAT_UNAUTHORIZED")); }
      finally { await connection.query("UPDATE admin_mfa SET enabled_at = ? WHERE user_id = ?", [sqlDate(now), fixture.admin.id]); }
      await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [sqlDate(now), fixture.client.sessionId]);
      try { await assert.rejects(read(fixture), errorCode("CHAT_UNAUTHORIZED")); }
      finally { await connection.query("UPDATE sessions SET revoked_at = NULL WHERE id = ?", [fixture.client.sessionId]); }
      await connection.query("UPDATE sessions SET expires_at = ? WHERE id = ?", [sqlDate(now + 1000), fixture.client.sessionId]);
      try { await assert.rejects(read(fixture, "client", { now: now + 1000 }), errorCode("CHAT_UNAUTHORIZED")); }
      finally { await connection.query("UPDATE sessions SET expires_at = ? WHERE id = ?", [sqlDate(now + 8 * 3600000), fixture.client.sessionId]); }
      await connection.query("UPDATE client_auth_state SET credential_version = 2 WHERE user_id = ?", [fixture.client.id]);
      try { await assert.rejects(read(fixture), errorCode("CHAT_UNAUTHORIZED")); }
      finally { await connection.query("UPDATE client_auth_state SET credential_version = 1 WHERE user_id = ?", [fixture.client.id]); }
      await connection.query("UPDATE admin_mfa SET version = 2 WHERE user_id = ?", [fixture.admin.id]);
      try { await assert.rejects(read(fixture, "admin"), errorCode("CHAT_UNAUTHORIZED")); }
      finally { await connection.query("UPDATE admin_mfa SET version = 1 WHERE user_id = ?", [fixture.admin.id]); }
      await connection.query("UPDATE admin_mfa SET enabled_at = ? WHERE user_id = ?", [sqlDate(now + 1000), fixture.admin.id]);
      try { await assert.rejects(read(fixture, "admin", { now: now + 1000 }), errorCode("CHAT_UNAUTHORIZED")); }
      finally { await connection.query("UPDATE admin_mfa SET enabled_at = ? WHERE user_id = ?", [sqlDate(now), fixture.admin.id]); }
      assert.equal((await read(fixture)).messages.length, 0);
    });

    await t.test("last activity is touched no more than once a minute for each real actor session", async () => {
      const fixture = await pair();
      for (const role of ["client", "admin"]) {
        const table = role === "client" ? "client_session_state" : "auth_session_state";
        await read(fixture, role, { now: now + 59000 });
        assert.equal((await connection.query(`SELECT last_seen_at FROM ${table} WHERE session_id = ?`, [fixture[role].sessionId]))[0].last_seen_at, sqlDate(now));
        await read(fixture, role, { now: now + 60000 });
        assert.equal((await connection.query(`SELECT last_seen_at FROM ${table} WHERE session_id = ?`, [fixture[role].sessionId]))[0].last_seen_at, sqlDate(now + 60000));
      }
    });

    await t.test("simultaneous retries create one durable message and event while a changed body under the same key conflicts", async () => {
      const fixture = await pair(), message = payload();
      const results = await Promise.all([send(fixture, "client", message), send(fixture, "client", { ...message, id: id(), bodyEncrypted: cipher() })]);
      assert.equal(results.filter((item) => item.duplicate).length, 1);
      assert.ok(results[0].message.id.equals(results[1].message.id));
      assert.deepEqual(await counts(fixture), { messages: 1, events: 1 });
      await assert.rejects(send(fixture, "client", { ...message, id: id(), bodyFingerprint: digest() }), errorCode("CHAT_CONFLICT"));
      assert.deepEqual(await counts(fixture), { messages: 1, events: 1 });
      const competingKey = id(), left = payload({ clientMessageId: competingKey }), right = payload({ clientMessageId: competingKey });
      const competing = await Promise.allSettled([send(fixture, "client", left), send(fixture, "client", right)]);
      assert.equal(competing.filter((item) => item.status === "fulfilled").length, 1);
      assert.equal(competing.find((item) => item.status === "rejected").reason.code, "CHAT_CONFLICT");
      assert.deepEqual(await counts(fixture), { messages: 2, events: 2 });
    });

    await t.test("concurrent distinct sends allocate private conversation sequences after the lock and a failed insert leaves no gap or orphan event", async () => {
      const fixture = await pair();
      const [a, b] = await Promise.all([send(fixture), send(fixture, "admin")]);
      assert.deepEqual([a.message.sequence, b.message.sequence].sort(), ["1", "2"]);
      await assert.rejects(send(fixture, "admin", payload({ id: a.message.id })), errorCode("CHAT_DATABASE_OPERATION"));
      assert.deepEqual(await counts(fixture), { messages: 2, events: 2 });
      assert.equal((await send(fixture)).message.sequence, "3");
      const unrelated = await pair();
      assert.equal((await send(unrelated)).message.sequence, "1", "sequences never expose unrelated conversation activity");
      assert.deepEqual((await store.readEvents(request(fixture))).events.map((item) => item.sequence), ["1", "2", "3"]);
    });

    await t.test("message and event inserts roll back together on an event failure", async () => {
      const fixture = await pair();
      await connection.query("CREATE TRIGGER synthetic_fail_chat_event BEFORE INSERT ON chat_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic event failure'");
      try { await assert.rejects(send(fixture), errorCode("CHAT_DATABASE_OPERATION")); }
      finally { await connection.query("DROP TRIGGER synthetic_fail_chat_event"); }
      assert.deepEqual(await counts(fixture), { messages: 0, events: 0 });
      assert.equal((await send(fixture)).message.sequence, "1");
    });

    await t.test("read receipts advance monotonically only to messages in the conversation, excluding own and deleted messages from unread counts", async () => {
      const fixture = await pair();
      const own = await send(fixture), incoming = await send(fixture, "admin"), later = await send(fixture, "admin");
      assert.equal((await read(fixture)).conversation.unreadCount, 2);
      assert.equal((await read(fixture, "admin")).conversation.unreadCount, 1);
      assert.deepEqual(await store.markRead({ ...request(fixture), through: incoming.message.sequence }), { lastReadSequence: "2" });
      assert.deepEqual(await store.markRead({ ...request(fixture), through: "1" }), { lastReadSequence: "2" });
      assert.deepEqual(await store.markRead({ ...request(fixture), through: "0" }), { lastReadSequence: "2" });
      assert.equal((await read(fixture)).conversation.unreadCount, 1);
      assert.equal((await read(fixture, "admin")).conversation.peerReadSequence, "2");
      await assert.rejects(store.markRead({ ...request(fixture), through: "99" }), errorCode("CHAT_NOT_FOUND"));
      await store.deleteMessage({ ...request(fixture, "admin"), messageId: later.message.id });
      assert.equal((await read(fixture)).conversation.unreadCount, 0);
      assert.equal((await read(fixture, "admin")).conversation.unreadCount, 1);
      assert.equal((await read(fixture)).messages.find((item) => item.id.equals(own.message.id)).isMine, true);
    });

    await t.test("only authors delete; repeated deletion and send retry return the same tombstone without restoring ciphertext", async () => {
      const fixture = await pair(), message = payload(), sent = await send(fixture, "client", message);
      await assert.rejects(store.deleteMessage({ ...request(fixture, "admin"), messageId: sent.message.id }), errorCode("CHAT_NOT_FOUND"));
      const deleted = await store.deleteMessage({ ...request(fixture), messageId: sent.message.id });
      assert.equal(deleted.bodyEncrypted, null); assert.equal(deleted.deletedAt, now);
      assert.ok(deleted.bodyFingerprint.equals(message.bodyFingerprint));
      const results = await Promise.all([store.deleteMessage({ ...request(fixture), messageId: sent.message.id }), store.deleteMessage({ ...request(fixture), messageId: sent.message.id })]);
      assert.ok(results.every((item) => item.bodyEncrypted === null));
      const retry = await send(fixture, "client", { ...message, id: id(), bodyEncrypted: cipher() });
      assert.equal(retry.duplicate, true); assert.equal(retry.message.bodyEncrypted, null);
      assert.deepEqual(await counts(fixture), { messages: 1, events: 2 });
      const events = (await store.readEvents(request(fixture))).events;
      assert.deepEqual(events.map((item) => item.kind), ["message", "delete"]);
      assert.ok(events.every((item) => item.message.bodyEncrypted === null), "historical creation events join the current tombstone");
    });

    await t.test("failed deletion event rolls back ciphertext clearing and leaves the original message intact", async () => {
      const fixture = await pair(), sent = await send(fixture);
      await connection.query("CREATE TRIGGER synthetic_fail_chat_event BEFORE INSERT ON chat_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic event failure'");
      try { await assert.rejects(store.deleteMessage({ ...request(fixture), messageId: sent.message.id }), errorCode("CHAT_DATABASE_OPERATION")); }
      finally { await connection.query("DROP TRIGGER synthetic_fail_chat_event"); }
      const original = (await read(fixture)).messages[0];
      assert.equal(original.deletedAt, null); assert.equal(original.bodyEncrypted, sent.message.bodyEncrypted);
      assert.deepEqual(await counts(fixture), { messages: 1, events: 1 });
    });

    await t.test("message and event cursors are bounded, ordered and independent; old deletions remain observable", async () => {
      const fixture = await pair(), messages = [];
      for (let index = 0; index < 5; index++) messages.push((await send(fixture)).message);
      const newest = await read(fixture, "client", { limit: 3 });
      assert.deepEqual(newest.messages.map((item) => item.sequence), ["3", "4", "5"]);
      assert.equal(newest.hasMoreBefore, true); assert.equal(newest.hasMoreAfter, false); assert.equal(newest.nextBefore, "3"); assert.equal(newest.eventCursor, "5");
      const older = await read(fixture, "client", { before: newest.nextBefore, limit: 3 });
      assert.deepEqual(older.messages.map((item) => item.sequence), ["1", "2"]); assert.equal(older.hasMoreBefore, false); assert.equal(older.hasMoreAfter, true);
      const after = await read(fixture, "client", { after: "2", limit: 2 });
      assert.deepEqual(after.messages.map((item) => item.sequence), ["3", "4"]); assert.equal(after.nextAfter, "4");
      assert.equal((await read(fixture, "client", { after: "99" })).messages.length, 0);
      await store.deleteMessage({ ...request(fixture), messageId: messages[0].id });
      const deletion = await store.readEvents({ ...request(fixture), after: newest.eventCursor });
      assert.equal(deletion.events.length, 1); assert.equal(deletion.events[0].sequence, "6"); assert.equal(deletion.events[0].message.sequence, "1"); assert.equal(deletion.events[0].message.bodyEncrypted, null);
      const events = await store.readEvents({ ...request(fixture), limit: 2 });
      assert.equal(events.hasMore, true); assert.equal(events.nextCursor, "2");
      const next = await store.readEvents({ ...request(fixture), after: events.nextCursor, limit: 2 });
      assert.deepEqual(next.events.map((item) => item.sequence), ["3", "4"]);
      for (const cursor of ["01", "-1", "1.0", "18446744073709551616", "x", 1]) await assert.rejects(read(fixture, "client", { after: cursor }), errorCode("CHAT_STORE_INPUT"));
      await assert.rejects(read(fixture, "client", { before: "3", after: "1" }), errorCode("CHAT_STORE_INPUT"));
      await assert.rejects(read(fixture, "client", { limit: 101 }), errorCode("CHAT_STORE_INPUT"));
    });

    await t.test("closed conversations retain history for active clients; inactive recipients block sends but allow assigned administrator history and own deletion", async () => {
      const fixture = await pair(), sent = await send(fixture, "admin");
      await connection.query("UPDATE conversations SET closed_at = ? WHERE id = ?", [sqlDate(now), fixture.conversationId]);
      assert.equal((await read(fixture)).conversation.canSend, false);
      await assert.rejects(send(fixture), errorCode("CHAT_FORBIDDEN"));
      await assert.rejects(send(fixture, "admin"), errorCode("CHAT_FORBIDDEN"));
      for (const status of ["suspended", "revoked", "deleted"]) {
        await connection.query("UPDATE users SET status = ? WHERE id = ?", [status, fixture.client.id]);
        assert.equal((await read(fixture, "admin")).messages.length, 1);
        await assert.rejects(read(fixture), errorCode("CHAT_FORBIDDEN"));
        await assert.rejects(send(fixture, "admin"), errorCode("CHAT_FORBIDDEN"));
      }
      assert.equal((await store.deleteMessage({ ...request(fixture, "admin"), messageId: sent.message.id })).bodyEncrypted, null);
    });

    await t.test("authorization rechecks conversation assignment after waiting on participant locks", async () => {
      const fixture = await pair(), replacement = await user("admin");
      let observed;
      const candidateRead = new Promise((resolve) => { observed = resolve; });
      const observedStore = createChatStore({ getConnection: async () => {
        const runtimeConnection = await pool.getConnection();
        return { ...runtimeConnection, query: async (...arguments_) => {
          const result = await runtimeConnection.query(...arguments_);
          if (arguments_[0] === "SELECT id, admin_id, client_id FROM conversations WHERE id = ?") observed();
          return result;
        } };
      } });
      await connection.beginTransaction();
      let pending;
      try {
        await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [fixture.admin.id]);
        pending = observedStore.readMessages(request(fixture, "admin"));
        const rejection = assert.rejects(pending, errorCode("CHAT_NOT_FOUND"));
        await candidateRead;
        await connection.query("UPDATE conversations SET admin_id = ? WHERE id = ?", [replacement.id, fixture.conversationId]);
        await connection.commit();
        await rejection;
      } finally { try { await connection.rollback(); } catch {} if (pending) await pending.catch(() => {}); }
    });

    await t.test("client revocation committed while a send waits is observed before any message is persisted", async () => {
      const fixture = await pair();
      let observed;
      const candidateRead = new Promise((resolve) => { observed = resolve; });
      const observedStore = createChatStore({ getConnection: async () => {
        const runtimeConnection = await pool.getConnection();
        return { ...runtimeConnection, query: async (...arguments_) => {
          const result = await runtimeConnection.query(...arguments_);
          if (arguments_[0] === "SELECT id, admin_id, client_id FROM conversations WHERE id = ?") observed();
          return result;
        } };
      } });
      await connection.beginTransaction();
      let pending;
      try {
        await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [fixture.admin.id]);
        pending = observedStore.sendMessage({ ...request(fixture), message: payload() });
        const rejection = assert.rejects(pending, errorCode("CHAT_UNAUTHORIZED"));
        await candidateRead;
        await connection.query("UPDATE users SET status = 'revoked' WHERE id = ?", [fixture.client.id]);
        await connection.query("UPDATE sessions SET revoked_at = ? WHERE user_id = ?", [sqlDate(now), fixture.client.id]);
        await connection.commit();
        await rejection;
      } finally { try { await connection.rollback(); } catch {} if (pending) await pending.catch(() => {}); }
      assert.deepEqual(await counts(fixture), { messages: 0, events: 0 });
    });

    await t.test("administrator conversation pagination is stable and restricted to assignment", async () => {
      const first = await pair(), second = await pair(first.admin), third = await pair(first.admin), other = await pair();
      const collected = [], expected = [first, second, third].map((item) => item.conversationId.toString("hex")).sort();
      let afterId = null;
      do {
        const page = await store.listConversations({ tokenHash: first.admin.tokenHash, now, afterId, limit: 1 });
        collected.push(...page.conversations.map((item) => item.id.toString("hex")));
        afterId = page.nextCursor;
        assert.equal(page.hasMore, afterId !== null);
      } while (afterId);
      assert.deepEqual(collected, expected); assert.equal(collected.includes(other.conversationId.toString("hex")), false);
      await connection.query("UPDATE users SET status = 'suspended' WHERE id = ?", [second.client.id]);
      await connection.query("UPDATE users SET access_expires_at = ? WHERE id = ?", [sqlDate(now + 1000), third.client.id]);
      const current = await store.listConversations({ tokenHash: first.admin.tokenHash, now: now + 1000 });
      assert.equal(current.conversations.find((item) => item.id.equals(first.conversationId)).canSend, true);
      assert.equal(current.conversations.find((item) => item.id.equals(second.conversationId)).canSend, false);
      assert.equal(current.conversations.find((item) => item.id.equals(third.conversationId)).canSend, false);
    });

    await t.test("optimized administrator listing still rechecks assignment after waiting for a current client", async () => {
      const fixture = await pair(), replacement = await user("admin");
      let observed;
      const candidateRead = new Promise((resolve) => { observed = resolve; });
      const observedStore = createChatStore({ getConnection: async () => {
        const runtimeConnection = await pool.getConnection();
        return { ...runtimeConnection, query: async (...arguments_) => {
          const result = await runtimeConnection.query(...arguments_);
          if (arguments_[0].startsWith("SELECT id, client_id FROM conversations WHERE admin_id")) observed();
          return result;
        } };
      } });
      await connection.beginTransaction();
      let pending;
      try {
        await connection.query("SELECT id FROM users WHERE id = ? FOR UPDATE", [fixture.client.id]);
        pending = observedStore.listConversations({ tokenHash: fixture.admin.tokenHash, now });
        const rejection = assert.rejects(pending, errorCode("CHAT_NOT_FOUND"));
        await candidateRead;
        await connection.query("UPDATE conversations SET admin_id = ? WHERE id = ?", [replacement.id, fixture.conversationId]);
        await connection.commit();
        await rejection;
      } finally { try { await connection.rollback(); } catch {} if (pending) await pending.catch(() => {}); }
    });

    await t.test("SQL constraints preserve message and tombstone shape, sender role, sequence and event conversation binding", async () => {
      const fixture = await pair(), other = await pair(), sent = await send(fixture);
      for (const [column, value] of [["id", Buffer.alloc(1)], ["sender_id", Buffer.alloc(1)], ["client_message_id", Buffer.alloc(1)], ["body_fingerprint", Buffer.alloc(31)], ["sequence_no", "0"], ["sender_role", "nobody"], ["body_encrypted", null]]) {
        await assert.rejects(connection.query(`UPDATE messages SET ${column} = ? WHERE id = ?`, [value, sent.message.id]));
      }
      await assert.rejects(connection.query("UPDATE messages SET deleted_at = ? WHERE id = ?", [sqlDate(now), sent.message.id]));
      await assert.rejects(connection.query("INSERT INTO chat_events (conversation_id, event_sequence, message_id, kind, occurred_at) VALUES (?, 1, ?, 'message', ?)", [other.conversationId, sent.message.id, sqlDate(now)]));
      await assert.rejects(connection.query("UPDATE chat_events SET kind = 'unknown' WHERE conversation_id = ?", [fixture.conversationId]));
      await assert.rejects(connection.query("UPDATE chat_events SET event_sequence = 0 WHERE conversation_id = ?", [fixture.conversationId]));
      await assert.rejects(store.sendMessage({ ...request(fixture), message: payload({ bodyEncrypted: "\n" }) }), errorCode("CHAT_STORE_INPUT"));
      const unavailable = createChatStore({ getConnection: async () => { throw new Error("synthetic SQL credential/body leakage sentinel"); } });
      await assert.rejects(unavailable.readMessages(request(fixture)), (error) => errorCode("CHAT_DATABASE_OPERATION")(error) && !error.message.includes("sentinel"));
    });
  } finally {
    try { if (pool) await pool.end(); }
    finally { try { await reset(); } finally { await connection.end(); } }
  }
});
