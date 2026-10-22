import { execFileSync } from "node:child_process";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createAuthService } from "../server/auth/service.mjs";
import { createAuthHandler } from "../server/auth/http.mjs";
import { createAccessStore } from "../server/access/store.mjs";
import { createAccessService } from "../server/access/service.mjs";
import { createAccessHandler } from "../server/access/http.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createChatService } from "../server/chat/service.mjs";
import { createConversationExporter } from "../server/chat/conversation-export.mjs";
import { createChatHandler } from "../server/chat/http.mjs";
import { createAppServer } from "../server/index.mjs";
import { createRecoveryCodes, hashPassword, makeTotpSecret, recoveryCodeDigest, sealTotpSecret, tokenDigest, totpCode } from "../server/auth/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const key = () => randomBytes(16).toString("hex");
const cookieToken = (cookie) => cookie.slice(cookie.indexOf("=") + 1);

test("real HTTP private chat, ciphertext, receipts, deletion and live authorization (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 120000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "separately provisioned runtime DML credentials are required");
  const migrations = await loadMigrations();
  const allowedTables = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase();
  let pool;
  let server;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset();
    await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const authStore = createAuthStore(pool);
    const accessStore = createAccessStore(pool);
    const chatStore = createChatStore(pool);
    assert.equal(await authStore.assertSchema(), true);
    assert.equal(await accessStore.assertSchema(), true);
    assert.equal(await chatStore.assertSchema(), true);
    let now = Date.now();
    const clock = () => now;
    const totpKey = randomBytes(32);
    const mailKey = randomBytes(32);
    const messageKey = randomBytes(32);
    const origin = "https://example.invalid";
    const adminId = randomBytes(16);
    const adminEmail = "chat-flow-admin@example.invalid";
    const adminPassword = "Synthetic chat administrator password 2026!";
    const clientPassword = "Synthetic chat client password 2026!";
    const secret = makeTotpSecret();
    await authStore.initializeAdmin({ id: adminId, email: adminEmail, pseudonym: "Synthetic Jessie",
      passwordHash: await hashPassword(adminPassword), secretEncrypted: sealTotpSecret(secret, totpKey, adminId),
      recoveryDigests: createRecoveryCodes().map(recoveryCodeDigest), now });
    const clientHash = await hashPassword(clientPassword);
    const clients = ["a", "b"].map((suffix) => ({ id: randomBytes(16), conversationId: randomBytes(16),
      email: `chat-flow-client-${suffix}@example.invalid`, pseudonym: `Synthetic chat client ${suffix.toUpperCase()}` }));
    // Synthetic manually admitted clients exercise the invitation policy with no age stamp.
    // No real account or mail delivery is created by this suite.
    for (const client of clients) {
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash,
        email_verified_at, age_assured_at, access_approved_at, created_at, updated_at)
        VALUES (?, 'client', 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client.id, client.pseudonym, client.email, clientHash, sqlDate(now), null, sqlDate(now), sqlDate(now), sqlDate(now)]);
      await connection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [client.id, sqlDate(now)]);
      await consumeSyntheticInvitation(connection, client.id, now);
      await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)",
        [client.conversationId, client.id, adminId, sqlDate(now)]);
    }
    const [clientA, clientB] = clients;
    const conversationId = clientA.conversationId.toString("hex");
    const authService = await createAuthService({ store: authStore, totpKey, clock });
    const accessService = await createAccessService({ store: accessStore, authStore, authService, totpKey, mailKey, origin, clock });
    const chatService = await createChatService({ store: chatStore, authStore, authService, accessService, key: messageKey, clock });
    server = createAppServer({ authHandler: createAuthHandler(authService, { origin }),
      accessHandler: createAccessHandler(accessService, { origin }), chatHandler: createChatHandler(chatService, { origin, clientConversationExporter: createConversationExporter({ role: "client", history: (token, id, options) => chatService.messages("client", token, id, options), clock }) }) });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(path, { method = "GET", body, headers = {} } = {}) {
      const response = await fetch(`${base}${path}`, { method, redirect: "manual",
        headers: { ...(method === "POST" ? { Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1" } : {}), ...headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const text = await response.text();
      let value;
      try { value = JSON.parse(text); } catch { value = text; }
      return { status: response.status, headers: response.headers, body: value };
    }
    async function loginClient(client) {
      const result = await request("/api/access/login", { method: "POST", body: { email: client.email, password: clientPassword } });
      assert.equal(result.status, 200);
      assert.equal(result.body.user.id, client.id.toString("hex"));
      assert.equal(result.body.access.state, "active");
      return { cookie: result.headers.get("set-cookie").split(";")[0], csrf: result.body.csrf };
    }
    const headersFor = (session) => ({ Cookie: session.cookie, "X-CSRF-Token": session.csrf });
    const pathFor = (role, suffix = "messages", id = conversationId) => `/api/chat/${role}/conversations/${id}/${suffix}`;
    const count = async (table) => Number((await connection.query(`SELECT COUNT(*) AS count FROM ${table}`))[0].count);
    let admin;
    let a;
    let b;
    let firstMessage;
    let replyMessage;
    let thirdMessage;
    let fourthMessage;
    const firstRequest = { clientMessageId: key(), body: "  Synthetic private text <script>window.chatLeak=true</script> 💬\nExact whitespace stays.  " };

    await t.test("actual login sessions expose chat only to the matching role and authorized pages", async () => {
      assert.equal((await request("/messages")).status, 303);
      assert.equal((await request("/admin/messages")).headers.get("location"), "/admin/login");
      const login = await request("/api/auth/login", { method: "POST", body: { email: adminEmail, password: adminPassword, factor: totpCode(secret, { now }) } });
      assert.equal(login.status, 200);
      admin = { cookie: login.headers.get("set-cookie").split(";")[0], csrf: login.body.csrf };
      a = await loginClient(clientA);
      b = await loginClient(clientB);
      assert.equal((await request("/messages", { headers: headersFor(a) })).status, 200);
      assert.equal((await request("/admin/messages", { headers: headersFor(admin) })).status, 200);
      assert.deepEqual((await request("/api/chat/client/capabilities", { headers: headersFor(a) })).body, { enabled: true, conversationExport: { enabled: true, photos: false, maxBytes: 32 * 1024 * 1024 } });
      assert.deepEqual((await request("/api/chat/admin/capabilities", { headers: headersFor(admin) })).body, { enabled: true });
      assert.equal((await request("/api/chat/admin/conversations", { headers: { Cookie: `__Host-jessie_session=${cookieToken(a.cookie)}` } })).status, 401);
      assert.equal((await request("/api/chat/client/conversation", { headers: { Cookie: `__Host-jessie_client=${cookieToken(admin.cookie)}` } })).status, 401);
      const own = await request("/api/chat/client/conversation", { headers: headersFor(a) });
      assert.equal(own.status, 200);
      assert.equal(own.body.id, conversationId);
      assert.equal(own.body.client, null);
      assert.equal(own.body.peerName, "Synthetic Jessie");
      const inbox = await request("/api/chat/admin/conversations?limit=1", { headers: headersFor(admin) });
      assert.equal(inbox.status, 200);
      assert.equal(inbox.body.conversations.length, 1);
      assert.equal(inbox.body.hasMore, true);
      const next = await request(`/api/chat/admin/conversations?limit=1&afterId=${inbox.body.nextCursor}`, { headers: headersFor(admin) });
      assert.equal(next.status, 200);
      assert.equal(next.body.conversations.length, 1);
      assert.equal(next.body.hasMore, false);
      assert.notEqual(next.body.conversations[0].id, inbox.body.conversations[0].id);
      for (const email of [adminEmail, clientA.email, clientB.email]) assert.equal(JSON.stringify([own.body, inbox.body, next.body]).includes(email), false);
    });

    await t.test("a send persists ciphertext once and retries reconcile while changed text conflicts", async () => {
      assert.equal((await request(pathFor("client"), { method: "POST", headers: { Cookie: a.cookie }, body: firstRequest })).status, 403);
      assert.equal(await count("messages"), 0);
      const sent = await request(pathFor("client"), { method: "POST", headers: headersFor(a), body: firstRequest });
      assert.equal(sent.status, 201);
      assert.equal(sent.body.duplicate, false);
      firstMessage = sent.body.message;
      assert.equal(firstMessage.body, firstRequest.body);
      assert.equal(firstMessage.sender, "me");
      assert.equal(firstMessage.sequence, "1");
      assert.equal(firstMessage.clientMessageId, firstRequest.clientMessageId);
      const stored = (await connection.query("SELECT body_encrypted, body_fingerprint FROM messages WHERE id = ?", [Buffer.from(firstMessage.id, "hex")]))[0];
      assert.match(stored.body_encrypted, /^v1\./);
      assert.equal(stored.body_encrypted.includes(firstRequest.body), false);
      assert.equal(stored.body_encrypted.includes("Synthetic private text"), false);
      assert.equal(stored.body_fingerprint.length, 32);
      const duplicate = await request(pathFor("client"), { method: "POST", headers: headersFor(a), body: firstRequest });
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.body.duplicate, true);
      assert.deepEqual(duplicate.body.message, firstMessage);
      assert.equal((await request(pathFor("client"), { method: "POST", headers: headersFor(a), body: { ...firstRequest, body: "Synthetic different retry text" } })).status, 409);
      assert.equal(await count("messages"), 1);
      assert.equal(await count("chat_events"), 1);
      const received = await request(pathFor("admin"), { headers: headersFor(admin) });
      assert.equal(received.status, 200);
      assert.equal(received.body.messages[0].sender, "peer");
      assert.equal(received.body.messages[0].clientMessageId, null);
      assert.equal(received.body.messages[0].body, firstRequest.body);
      assert.equal(received.body.conversation.unreadCount, 1);
      assert.equal(JSON.stringify(received.body).includes(stored.body_encrypted), false);
      assert.equal(Object.hasOwn(received.body.messages[0], "bodyFingerprint"), false);
    });

    await t.test("another client cannot read, poll, send, acknowledge or delete this conversation", async () => {
      for (const suffix of ["messages", "events?after=0"]) {
        const denied = await request(pathFor("client", suffix), { headers: headersFor(b) });
        assert.equal(denied.status, 404);
        assert.equal(JSON.stringify(denied.body).includes(firstRequest.body), false);
      }
      for (const [suffix, body] of [["messages", { clientMessageId: key(), body: "Cross-client attempted text" }],
        ["read", { throughSequence: "1" }], [`messages/${firstMessage.id}/delete`, {}]]) {
        assert.equal((await request(pathFor("client", suffix), { method: "POST", headers: headersFor(b), body })).status, 404);
      }
      assert.equal(await count("messages"), 1);
      assert.equal(await count("chat_receipts"), 0);
      assert.equal(await count("chat_events"), 1);
      const own = await request("/api/chat/client/conversation", { headers: headersFor(b) });
      assert.equal(own.body.latestSequence, "0");
      assert.equal(own.body.unreadCount, 0);
      assert.equal(JSON.stringify(own.body).includes(clientA.id.toString("hex")), false);
    });

    await t.test("persisted replies and monotonic read acknowledgements belong to the actual reader", async () => {
      const sent = await request(pathFor("admin"), { method: "POST", headers: headersFor(admin), body: { clientMessageId: key(), body: "Synthetic administrator reply" } });
      assert.equal(sent.status, 201);
      replyMessage = sent.body.message;
      assert.equal(replyMessage.sequence, "2");
      const received = await request(pathFor("client"), { headers: headersFor(a) });
      assert.equal(received.body.messages[1].sender, "peer");
      assert.equal(received.body.messages[1].clientMessageId, null);
      assert.equal(received.body.conversation.unreadCount, 1);
      assert.equal((await request(pathFor("client", `messages/${replyMessage.id}/delete`), { method: "POST", headers: headersFor(a), body: {} })).status, 404);
      assert.equal((await request(pathFor("admin", `messages/${firstMessage.id}/delete`), { method: "POST", headers: headersFor(admin), body: {} })).status, 404);
      assert.deepEqual((await request(pathFor("client", "read"), { method: "POST", headers: headersFor(a), body: { throughSequence: "2" } })).body, { lastReadSequence: "2" });
      assert.deepEqual((await request(pathFor("client", "read"), { method: "POST", headers: headersFor(a), body: { throughSequence: "1" } })).body, { lastReadSequence: "2" });
      assert.equal((await request(pathFor("client", "read"), { method: "POST", headers: headersFor(a), body: { throughSequence: "99" } })).status, 404);
      const senderView = await request(pathFor("admin", "events?after=2"), { headers: headersFor(admin) });
      assert.equal(senderView.status, 200);
      assert.deepEqual(senderView.body.events, []);
      assert.equal(senderView.body.conversation.peerReadSequence, "2");
      assert.equal(senderView.body.conversation.lastReadSequence, "0");
      assert.equal(senderView.body.conversation.unreadCount, 1);
      const clientPaths = ["/api/chat/client/conversation", pathFor("client"), pathFor("client", "events?after=2")];
      const beforeAdminRead = [];
      for (const path of clientPaths) beforeAdminRead.push((await request(path, { headers: headersFor(a) })).body);
      assert.equal((await request(pathFor("admin", "read"), { method: "POST", headers: headersFor(admin), body: { throughSequence: "1" } })).status, 200);
      const adminRead = (await request(pathFor("admin"), { headers: headersFor(admin) })).body.conversation;
      assert.equal(adminRead.unreadCount, 0);
      assert.equal(adminRead.lastReadSequence, "1", "administrator read state remains available to its other devices");
      for (const [index, path] of clientPaths.entries()) {
        const response = await request(path, { headers: headersFor(a) });
        assert.equal(response.status, 200);
        assert.deepEqual(response.body, beforeAdminRead[index], "an administrator read changes no client-visible cursor, timestamp, receipt or event");
        const conversation = response.body.conversation ?? response.body;
        assert.equal(conversation.peerReadSequence, "0");
        assert.equal(conversation.lastReadSequence, "2");
      }
    });

    await t.test("client archive decrypts only its own conversation and leaves read acknowledgements unchanged", async () => {
      for (const session of [admin, b]) {
        const denied = await request(pathFor("client", "export"), { method: "POST", headers: headersFor(session), body: { includePhotos: false } });
        assert.equal(denied.status, session === admin ? 401 : 404);
      }
      const receipts = await connection.query("SELECT user_id, last_read_sequence, updated_at FROM chat_receipts WHERE conversation_id = ? ORDER BY user_id", [clientA.conversationId]);
      const response = await fetch(base + pathFor("client", "export"), { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1", ...headersFor(a) }, body: JSON.stringify({ includePhotos: false }) });
      assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "application/zip");
      const archive = Buffer.from(await response.arrayBuffer()); assert.equal(archive.readUInt32LE(), 0x04034b50);
      const exported = JSON.parse(execFileSync("python3", ["-c", "import io,sys,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.testzip() is None;print(z.read('conversation.json').decode())"], { input: archive, encoding: "utf8" }));
      assert.deepEqual(exported.messages.map(message => message.body), [firstMessage.body, replyMessage.body]);
      assert.deepEqual(exported.messages.map(message => message.sender), ["peer", "me"]);
      for (const marker of [clientA.email, clientB.email, adminEmail, "clientMessageId", "campaignId", "bodyEncrypted", "broadcast_preferences"]) assert.equal(archive.includes(Buffer.from(marker)), false);
      assert.deepEqual(await connection.query("SELECT user_id, last_read_sequence, updated_at FROM chat_receipts WHERE conversation_id = ? ORDER BY user_id", [clientA.conversationId]), receipts);
    });

    await t.test("concurrent identical retries create one row, sender-scoped keys and bounded cursor pages", async () => {
      const repeated = { clientMessageId: key(), body: "Synthetic concurrent retry text" };
      const sends = await Promise.all([request(pathFor("client"), { method: "POST", headers: headersFor(a), body: repeated }),
        request(pathFor("client"), { method: "POST", headers: headersFor(a), body: repeated })]);
      assert.deepEqual(sends.map((result) => result.status).sort(), [200, 201]);
      assert.equal(sends[0].body.message.id, sends[1].body.message.id);
      thirdMessage = sends[0].body.message;
      assert.equal(thirdMessage.sequence, "3");
      const otherSender = await request(pathFor("admin"), { method: "POST", headers: headersFor(admin), body: { ...repeated, body: "Synthetic same key used by administrator" } });
      assert.equal(otherSender.status, 201);
      fourthMessage = otherSender.body.message;
      assert.equal(fourthMessage.sequence, "4");
      assert.notEqual(fourthMessage.id, thirdMessage.id);
      assert.equal(await count("messages"), 4);
      assert.equal(await count("chat_events"), 4);
      const newest = await request(`${pathFor("client")}?limit=2`, { headers: headersFor(a) });
      assert.deepEqual(newest.body.messages.map((message) => message.sequence), ["3", "4"]);
      assert.equal(newest.body.hasMoreBefore, true);
      assert.equal(newest.body.hasMoreAfter, false);
      const older = await request(`${pathFor("client")}?before=${newest.body.nextBefore}&limit=2`, { headers: headersFor(a) });
      assert.deepEqual(older.body.messages.map((message) => message.sequence), ["1", "2"]);
      assert.equal(older.body.hasMoreBefore, false);
      const after = await request(`${pathFor("client")}?after=1&limit=1`, { headers: headersFor(a) });
      assert.deepEqual(after.body.messages.map((message) => message.sequence), ["2"]);
      assert.equal(after.body.hasMoreAfter, true);
      const event = await request(pathFor("client", "events?after=0&limit=1"), { headers: headersFor(a) });
      assert.equal(event.body.events.length, 1);
      assert.equal(event.body.nextCursor, "1");
      assert.equal(event.body.hasMore, true);
    });

    await t.test("author deletion clears ciphertext and reaches incremental readers without resurrecting retries", async () => {
      const removed = await request(pathFor("client", `messages/${firstMessage.id}/delete`), { method: "POST", headers: headersFor(a), body: {} });
      assert.equal(removed.status, 200);
      assert.equal(removed.body.message.body, null);
      assert.equal(removed.body.message.deletedAt, now);
      const stored = (await connection.query("SELECT body_encrypted, body_fingerprint, deleted_at FROM messages WHERE id = ?", [Buffer.from(firstMessage.id, "hex")]))[0];
      assert.equal(stored.body_encrypted, null);
      assert.equal(stored.body_fingerprint.length, 32);
      assert.notEqual(stored.deleted_at, null);
      const incremental = await request(pathFor("admin", "events?after=4"), { headers: headersFor(admin) });
      assert.equal(incremental.status, 200);
      assert.equal(incremental.body.events.length, 1);
      assert.equal(incremental.body.events[0].kind, "delete");
      assert.equal(incremental.body.events[0].sequence, "5");
      assert.equal(incremental.body.events[0].message.id, firstMessage.id);
      assert.equal(incremental.body.events[0].message.body, null);
      const replay = await request(pathFor("client"), { method: "POST", headers: headersFor(a), body: firstRequest });
      assert.equal(replay.status, 200);
      assert.equal(replay.body.duplicate, true);
      assert.equal(replay.body.message.id, firstMessage.id);
      assert.equal(replay.body.message.body, null);
      assert.equal((await request(pathFor("client", `messages/${firstMessage.id}/delete`), { method: "POST", headers: headersFor(a), body: {} })).status, 200);
      assert.equal(await count("chat_events"), 5);
      const catchup = await request(pathFor("admin", "events?after=0"), { headers: headersFor(admin) });
      assert.equal(catchup.body.events[0].message.body, null, "older message events expose only the current tombstone");
      assert.equal(JSON.stringify(catchup.body).includes(firstRequest.body), false);
    });

    await t.test("corrupted persisted ciphertext yields only a generic service error", async () => {
      const messageId = Buffer.from(replyMessage.id, "hex");
      const original = (await connection.query("SELECT body_encrypted FROM messages WHERE id = ?", [messageId]))[0].body_encrypted;
      const components = original.split(".");
      components[2] = `${components[2][0] === "A" ? "B" : "A"}${components[2].slice(1)}`;
      await connection.query("UPDATE messages SET body_encrypted = ? WHERE id = ?", [components.join("."), messageId]);
      try {
        const failed = await request(pathFor("client"), { headers: headersFor(a) });
        assert.equal(failed.status, 503);
        assert.deepEqual(failed.body, { error: "messaging_unavailable" });
        assert.equal(JSON.stringify(failed.body).includes(original), false);
        assert.equal(JSON.stringify(failed.body).includes(adminEmail), false);
      } finally {
        await connection.query("UPDATE messages SET body_encrypted = ? WHERE id = ?", [original, messageId]);
      }
      assert.equal((await request(pathFor("client"), { headers: headersFor(a) })).status, 200);
    });

    await t.test("missing consumed invitations and closed conversations prevent sends while assigned history survives", async () => {
      await connection.query("UPDATE invitations SET consumed_at = NULL, consumed_by_id = NULL WHERE consumed_by_id = ?", [clientA.id]);
      try {
        assert.equal((await request(pathFor("client"), { headers: headersFor(a) })).status, 401);
        assert.equal((await request(pathFor("admin"), { headers: headersFor(admin) })).body.conversation.canSend, false);
        assert.equal((await request(pathFor("admin"), { method: "POST", headers: headersFor(admin), body: { clientMessageId: key(), body: "Synthetic future-gated attempted send" } })).status, 403);
      } finally {
        await consumeSyntheticInvitation(connection, clientA.id, now);
      }
      await connection.query("UPDATE conversations SET closed_at = ? WHERE id = ?", [sqlDate(now), clientA.conversationId]);
      try {
        for (const [role, session] of [["client", a], ["admin", admin]]) {
          const history = await request(pathFor(role), { headers: headersFor(session) });
          assert.equal(history.status, 200);
          assert.equal(history.body.conversation.canSend, false);
          assert.equal((await request(pathFor(role), { method: "POST", headers: headersFor(session), body: { clientMessageId: key(), body: "Synthetic closed attempted send" } })).status, 403);
        }
      } finally {
        await connection.query("UPDATE conversations SET closed_at = NULL WHERE id = ?", [clientA.conversationId]);
      }
      assert.equal(await count("messages"), 4);
    });

    await t.test("session expiry is enforced at its exact boundary without affecting another live session", async () => {
      const temporary = await loginClient(clientB);
      const hash = tokenDigest(cookieToken(temporary.cookie));
      const boundary = now + 1;
      await connection.query("UPDATE sessions SET expires_at = ? WHERE token_hash = ?", [sqlDate(boundary), hash]);
      assert.equal((await request("/api/chat/client/conversation", { headers: headersFor(temporary) })).status, 200);
      // The successful request renewed this device. Reapply the persisted
      // boundary before testing an expiry that has not been renewed.
      await connection.query("UPDATE sessions SET expires_at = ? WHERE token_hash = ?", [sqlDate(boundary), hash]);
      now = boundary;
      const expired = await request("/api/chat/client/conversation", { headers: headersFor(temporary) });
      assert.equal(expired.status, 401);
      assert.equal(expired.headers.get("set-cookie"), null);
      assert.equal((await request("/api/chat/client/conversation", { headers: headersFor(b) })).status, 200);
    });

    await t.test("access expiration denies every client operation, keeps assigned administrator history and blocks new or repeated sends", async () => {
      const boundary = now + 60000;
      await connection.query("UPDATE users SET access_expires_at = ? WHERE id = ?", [sqlDate(boundary), clientA.id]);
      now = boundary - 1;
      assert.equal((await request(pathFor("client"), { headers: headersFor(a) })).status, 200);
      now = boundary;
      for (const suffix of ["messages", "events?after=0"]) assert.equal((await request(pathFor("client", suffix), { headers: headersFor(a) })).status, 403);
      for (const [suffix, body] of [["messages", firstRequest], ["read", { throughSequence: "4" }], [`messages/${thirdMessage.id}/delete`, {}]]) {
        assert.equal((await request(pathFor("client", suffix), { method: "POST", headers: headersFor(a), body })).status, 403);
      }
      assert.equal((await request("/messages", { headers: headersFor(a) })).headers.get("location"), "/access");
      const history = await request(pathFor("admin"), { headers: headersFor(admin) });
      assert.equal(history.status, 200);
      assert.equal(history.body.messages.length, 4);
      assert.equal(history.body.conversation.canSend, false);
      assert.equal((await request(pathFor("admin"), { method: "POST", headers: headersFor(admin), body: { clientMessageId: fourthMessage.clientMessageId, body: fourthMessage.body } })).status, 403);
      assert.equal((await request(pathFor("admin"), { method: "POST", headers: headersFor(admin), body: { clientMessageId: key(), body: "Synthetic expired recipient attempted send" } })).status, 403);
      assert.equal(await count("messages"), 4);
      assert.equal(await count("chat_events"), 5);
    });

    await t.test("administrator revocation immediately removes client chat authority and logout removes administrator authority", async () => {
      const bConversationId = clientB.conversationId.toString("hex");
      assert.equal((await request(`/api/admin/clients/${clientB.id.toString("hex")}/revoke`, { method: "POST", headers: headersFor(admin), body: {} })).status, 200);
      for (const suffix of ["messages", "events?after=0"]) {
        assert.equal((await request(pathFor("client", suffix, bConversationId), { headers: headersFor(b) })).status, 401);
      }
      const denied = await request(pathFor("client", "messages", bConversationId), { method: "POST", headers: headersFor(b), body: { clientMessageId: key(), body: "Synthetic revoked attempted send" } });
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get("set-cookie"), null);
      const history = await request(pathFor("admin", "messages", bConversationId), { headers: headersFor(admin) });
      assert.equal(history.status, 200);
      assert.equal(history.body.conversation.canSend, false);
      assert.equal((await request(pathFor("admin", "messages", bConversationId), { method: "POST", headers: headersFor(admin), body: { clientMessageId: key(), body: "Synthetic revoked recipient attempted send" } })).status, 403);
      assert.equal((await request("/api/auth/logout-all", { method: "POST", headers: headersFor(admin), body: {} })).status, 200);
      assert.equal((await request("/api/chat/admin/conversations", { headers: headersFor(admin) })).status, 401);
      assert.equal((await request(pathFor("admin"), { method: "POST", headers: headersFor(admin), body: { clientMessageId: key(), body: "Synthetic logged-out attempted send" } })).status, 401);
      assert.equal(await count("messages"), 4);
    });
  } finally {
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    try { if (pool) await pool.end(); }
    finally { try { await reset(); } finally { await connection.end(); } }
  }
});
