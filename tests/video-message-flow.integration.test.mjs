// Explicit synthetic HTTP composition only: normal runtime/video activation stays dormant.
import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { newToken, tokenDigest, csrfToken } from "../server/auth/crypto.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createAuthService } from "../server/auth/service.mjs";
import { createAccessStore } from "../server/access/store.mjs";
import { createAccessService } from "../server/access/service.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createChatService } from "../server/chat/service.mjs";
import { createChatHandler } from "../server/chat/http.mjs";
import { encryptMessageBody, videoMessageFingerprint } from "../server/chat/crypto.mjs";
import { createNotificationsStore, enqueueNotification } from "../server/notifications/store.mjs";
import { createVideoStore } from "../server/video/store.mjs";
import { createVideoMessageStore } from "../server/video/message-store.mjs";
import { loadVideoMigrations } from "../server/video/migrations.mjs";
import { createVideoService } from "../server/video/service.mjs";
import { createVideoHandler } from "../server/video/http.mjs";
import { createVideoStorage, VIDEO_BLOCK_BYTES, videoStoredBytes } from "../server/video/storage.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import { collectVideo, mp4Source } from "./helpers/video-transport-fixture.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16), key = () => randomBytes(32), hex = (value) => value.toString("hex");
const sql = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const code = (expected) => (error) => error.code === expected && error.cause === undefined;
const origin = "https://example.invalid";
function subscription() {
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  return { endpoint: "https://fcm.googleapis.com/wp/synthetic-video-" + hex(id()), expirationTime: null,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
}

test("real HTTP/SQL video messages are atomic, idempotent, private and visible only through live deliveries", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 180000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require an isolated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "integration tests require separately provisioned DML-only runtime credentials");
  assert.notEqual(process.env.JESSIEMESSAGE_RUNTIME_DB_USER, options.user);
  const base = await loadMigrations(), candidates = await loadVideoMigrations();
  assert.equal(base.length, 33); assert.equal(candidates.length, 36); assert.deepEqual(candidates.slice(0, 33), base);
  const allowed = [...createdMigrationTables(candidates).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool, server, root;
  const now = Date.UTC(2026, 9, 21, 12), clock = () => now, created = sql(now - 1000);
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((row) => allowed.includes(row.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowed) await connection.query("DROP TABLE IF EXISTS " + table);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations: base });
    pool = await createRuntimePool(process.env);
    const authStore = createAuthStore(pool, { clock }), accessStore = createAccessStore(pool, { clock });
    assert.equal(await createChatStore(pool, { clock }).assertSchema(), true, "qualify unchanged schema 33 before candidates");
    assert.equal(await authStore.assertSchema(), true); assert.equal(await accessStore.assertSchema(), true);
    await applyMigrations(connection, { database: options.database, migrations: candidates });
    assert.equal((await loadMigrations()).length, 33, "candidate tests do not promote the ordinary migration loader");
    const audit = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(audit, { recursive: true, mode: 0o700 });
    root = await mkdtemp(path.join(audit, "video-message-native-"));
    const videoKey = key(), messageKey = key(), notificationKey = key(), totpKey = key();
    const nativeStorage = await createVideoStorage({ root, key: videoKey }); let storageOpens = 0, storagePuts = 0;
    const storage = { ...nativeStorage, async put(value) { storagePuts++; return nativeStorage.put(value); },
      async open(value) { storageOpens++; return nativeStorage.open(value); } };
    const capacity = { ownerBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, rootFingerprint: key() };
    const authService = await createAuthService({ store: authStore, totpKey, clock });
    const accessService = await createAccessService({ store: accessStore, authStore, authService, totpKey, mailKey: key(), origin, clock });
    async function stack(selectedPool = pool, notify = enqueueNotification) {
      let messages;
      const chat = createChatStore(selectedPool, { clock, enqueueNotification: notify,
        decorateMessages: (...args) => messages.decorateMessages(...args) });
      const catalog = createVideoStore({ pool: selectedPool, chatStore: chat, capacity });
      messages = createVideoMessageStore({ pool: selectedPool, chatStore: chat, videoStore: catalog });
      const chatService = await createChatService({ store: chat, videoMessages: messages, authStore, authService, accessService, key: messageKey, clock });
      const videoService = await createVideoService({ store: catalog, messages, storage, chatService, authStore, key: videoKey, minimumFreeBytes: 0, clock });
      return { chat, catalog, messages, chatService, videoService,
        handlers: [createChatHandler(chatService, { origin }), createVideoHandler(videoService, { origin })] };
    }
    let active = await stack(); const normal = active;
    assert.equal(await normal.catalog.assertSchema(), true); assert.equal(await normal.messages.assertSchema(), true);
    assert.equal((await normal.catalog.initialize({ now, offline: true })).heldBytes, 0);
    const notifications = createNotificationsStore({ pool, chatStore: normal.chat, key: notificationKey, clock });
    // The ordinary configured server never imports these candidate routes. This
    // disposable server explicitly composes the real handlers for qualification.
    server = createServer(async (request, response) => {
      try {
        for (const handler of active.handlers) if (await handler(request, response)) return;
        response.writeHead(404); response.end();
      } catch {
        if (response.headersSent) response.destroy();
        else { response.writeHead(500); response.end(); }
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = "http://127.0.0.1:" + server.address().port;
    async function request(route, { owner, method = "GET", body, binary, headers = {} } = {}) {
      const response = await fetch(url + route, { method, redirect: "manual", headers: {
        ...(owner ? { Cookie: owner.cookie, "X-CSRF-Token": owner.csrf } : {}),
        ...(method === "POST" ? { Origin: origin, "Content-Type": binary ? "video/mp4" : "application/json", "X-Jessie-Request": "1" } : {}), ...headers,
      }, ...(binary !== undefined ? { body: binary } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const bytes = Buffer.from(await response.arrayBuffer()); let value = null;
      if (bytes.length && response.headers.get("content-type")?.includes("application/json")) value = JSON.parse(bytes.toString("utf8"));
      return { status: response.status, headers: response.headers, bytes, body: value };
    }
    async function user(role) {
      const owner = { id: id(), role, sessionId: id(), token: newToken() }; owner.tokenHash = tokenDigest(owner.token); owner.csrf = csrfToken(owner.token);
      owner.cookie = (role === "admin" ? "__Host-jessie_session=" : "__Host-jessie_client=") + owner.token;
      await connection.query("INSERT INTO users (id,role,status,pseudonym,email,password_hash,email_verified_at,age_assured_at,access_approved_at,created_at,updated_at) VALUES (?,?,'active',?,?,'synthetic-not-a-password',?,NULL,?,?,?)",
        [owner.id, role, "Synthetic video " + role, hex(owner.id) + "@example.invalid", role === "client" ? created : null, role === "client" ? created : null, created, created]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id,secret_encrypted,version,last_totp_step,enabled_at) VALUES (?,'synthetic',1,1,?)", [owner.id, created]);
      else {
        await connection.query("INSERT INTO client_auth_state (user_id,credential_version,age_declared_at) VALUES (?,1,?)", [owner.id, created]);
        await consumeSyntheticInvitation(connection, owner.id, now - 1000);
      }
      await connection.query("INSERT INTO sessions (id,user_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)", [owner.sessionId, owner.id, owner.tokenHash, created, sql(now + 8 * 3600000)]);
      await connection.query(role === "admin"
        ? "INSERT INTO auth_session_state (session_id,last_seen_at,mfa_verified_at,mfa_version) VALUES (?,?,?,1)"
        : "INSERT INTO client_session_state (session_id,last_seen_at,credential_version) VALUES (?,?,1)",
      role === "admin" ? [owner.sessionId, created, created] : [owner.sessionId, created]);
      return owner;
    }
    async function pair(admin = null) {
      const f = { admin: admin ?? await user("admin"), client: await user("client"), conversationId: id() };
      f.cid = hex(f.conversationId);
      await connection.query("INSERT INTO conversations (id,admin_id,client_id,created_at) VALUES (?,?,?,?)", [f.conversationId, f.admin.id, f.client.id, created]);
      return f;
    }
    const videoPath = (role, suffix) => "/api/video/" + role + "/" + suffix;
    const sendPath = (f, owner = f.admin) => videoPath(owner.role, "conversations/" + f.cid + "/messages");
    const historyPath = (f, owner = f.client, suffix = "messages") => "/api/chat/" + owner.role + "/conversations/" + f.cid + "/" + suffix;
    const galleryPath = (f, owner = f.client, query = "") => videoPath(owner.role, "conversations/" + f.cid + "/gallery" + query);
    const deliveryPath = (f, mid, owner = f.client) => videoPath(owner.role, "conversations/" + f.cid + "/messages/" + mid + "/content");
    const ownedPath = (asset, owner) => videoPath(owner.role, "assets/" + asset.id + "/content");
    const input = (asset, caption = "Synthetic private caption <script>literal</script> 🎥") => ({ clientMessageId: hex(id()), videoId: asset.id, caption });
    const send = (f, owner, body) => request(sendPath(f, owner), { owner, method: "POST", body });
    const actor = (owner) => ({ role: owner.role, tokenHash: owner.tokenHash, now });
    async function upload(owner, bytes = VIDEO_BLOCK_BYTES * 2 + 57) {
      const response = await request(videoPath(owner.role, "assets"), { owner, method: "POST", binary: await collectVideo(mp4Source(bytes)) });
      assert.equal(response.status, 201); assert.deepEqual(Object.keys(response.body).sort(), ["bytes", "id", "mime"]); assert.equal(response.body.bytes, bytes);
      return response.body;
    }
    const counts = async (f) => ({
      messages: Number((await connection.query("SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?", [f.conversationId]))[0].n),
      links: Number((await connection.query("SELECT COUNT(*) AS n FROM message_video WHERE conversation_id=?", [f.conversationId]))[0].n),
      events: Number((await connection.query("SELECT COUNT(*) AS n FROM chat_events WHERE conversation_id=?", [f.conversationId]))[0].n),
      jobs: Number((await connection.query("SELECT COUNT(*) AS n FROM push_outbox p JOIN messages m ON m.id=p.message_id WHERE m.conversation_id=?", [f.conversationId]))[0].n),
    });
    const jobs = (mid) => connection.query("SELECT p.id,p.message_id,p.subscription_id,s.user_id,p.status FROM push_outbox p JOIN push_subscriptions s ON s.id=p.subscription_id WHERE p.message_id=? ORDER BY p.id", [Buffer.from(mid, "hex")]);
    async function subscribe(owner, count = 1) {
      const devices = [];
      for (let n = 0; n < count; n++) devices.push(await notifications.subscribe({ ...actor(owner), subscription: subscription(), locale: "fr" }));
      return devices;
    }
    function dto(value, asset, f, mid, owner) {
      assert.deepEqual(value, { id: asset.id, bytes: asset.bytes, mime: "video/mp4", contentUrl: deliveryPath(f, mid, owner) });
      for (const name of ["storageKey", "digest", "ownerId", "reserveTokenHash", "pendingBytes"]) assert.equal(Object.hasOwn(value, name), false);
    }
    function privateResponse(response) {
      assert.match(response.headers.get("cache-control"), /no-store/); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin"); assert.equal(response.headers.get("access-control-allow-origin"), null);
    }

    await t.test("real HTTP captions, concurrent exact retries, history, events and recipient-device notifications agree", async () => {
      const f = await pair(), asset = await upload(f.admin), first = input(asset);
      const recipientDevices = await subscribe(f.client, 2); await subscribe(f.admin);
      const files = await readdir(root), held = (await normal.catalog.status()).heldBytes, puts = storagePuts;
      const responses = await Promise.all([send(f, f.admin, first), send(f, f.admin, first)]);
      assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
      const message = responses[0].body.message;
      assert.equal(message.id, responses[1].body.message.id); assert.equal(message.sequence, "1"); assert.equal(message.body, first.caption);
      dto(message.video, asset, f, message.id, f.admin);
      assert.deepEqual(await counts(f), { messages: 1, links: 1, events: 1, jobs: 2 });
      const pending = await jobs(message.id); assert.equal(pending.length, 2);
      assert.ok(pending.every((j) => j.user_id.equals(f.client.id)));
      assert.deepEqual(pending.map((j) => hex(j.subscription_id)).sort(), recipientDevices.map((d) => d.id).sort());
      const row = (await connection.query("SELECT body_encrypted,body_fingerprint FROM messages WHERE id=?", [Buffer.from(message.id, "hex")]))[0];
      assert.match(row.body_encrypted, /^v1\./); assert.equal(row.body_fingerprint.length, 32);
      assert.equal(row.body_encrypted.includes(first.caption), false); assert.equal(row.body_encrypted.includes(asset.id), false);
      const received = await request(historyPath(f), { owner: f.client }); assert.equal(received.status, 200);
      assert.equal(received.body.messages[0].body, first.caption); assert.equal(received.body.messages[0].sender, "peer");
      assert.equal(received.body.messages[0].clientMessageId, null); dto(received.body.messages[0].video, asset, f, message.id, f.client);
      const events = await request(historyPath(f, f.client, "events?after=0"), { owner: f.client });
      assert.equal(events.status, 200); assert.equal(events.body.events.length, 1); assert.equal(events.body.events[0].kind, "message");
      dto(events.body.events[0].message.video, asset, f, message.id, f.client);
      assert.equal((await send(f, f.admin, first)).body.duplicate, true);
      assert.deepEqual((await jobs(message.id)).map((j) => hex(j.id)), pending.map((j) => hex(j.id)));
      for (const changed of [{ ...first, caption: "Changed caption" }, { ...first, videoId: hex(id()) }]) assert.equal((await send(f, f.admin, changed)).status, 409);
      assert.equal((await request(historyPath(f, f.admin), { owner: f.admin, method: "POST", body: { clientMessageId: first.clientMessageId, body: first.caption } })).status, 409);
      await assert.rejects(normal.chatService.sendImage("admin", f.admin.token, f.cid, { clientMessageId: first.clientMessageId, mediaId: hex(id()), caption: first.caption }), code("CHAT_CONFLICT"));
      assert.deepEqual(await counts(f), { messages: 1, links: 1, events: 1, jobs: 2 });
      assert.deepEqual(await readdir(root), files); assert.equal(storagePuts, puts); assert.equal((await normal.catalog.status()).heldBytes, held);
      const metadata = (await connection.query("SELECT storage_key,content_digest FROM video_assets WHERE id=?", [Buffer.from(asset.id, "hex")]))[0];
      const ciphertext = await readFile(path.join(root, hex(metadata.storage_key) + ".video.enc"));
      assert.equal(ciphertext.length, videoStoredBytes(asset.bytes)); assert.ok(!ciphertext.includes(Buffer.alloc(256, 0x5a)));
      assert.ok(!JSON.stringify(received.body).includes(hex(metadata.storage_key))); assert.ok(!JSON.stringify(received.body).includes(hex(metadata.content_digest)));
    });

    await t.test("delivery GET/HEAD use live SQL authorization, private headers and authenticated Range bytes", async () => {
      const f = await pair(), other = await pair(f.admin), stranger = await pair(), asset = await upload(f.admin);
      const sent = await send(f, f.admin, input(asset, "")); assert.equal(sent.status, 201); assert.equal(sent.body.message.body, "");
      const mid = sent.body.message.id, route = deliveryPath(f, mid);
      const full = await request(route, { owner: f.client }); assert.equal(full.status, 200);
      assert.deepEqual(full.bytes, await collectVideo(mp4Source(asset.bytes))); privateResponse(full);
      const range = await request(route, { owner: f.client, headers: { Range: "bytes=" + (VIDEO_BLOCK_BYTES - 3) + "-" + (VIDEO_BLOCK_BYTES + 12) } });
      assert.equal(range.status, 206); assert.deepEqual(range.bytes, Buffer.alloc(16, 0x5a)); privateResponse(range);
      assert.equal(range.headers.get("content-range"), "bytes " + (VIDEO_BLOCK_BYTES - 3) + "-" + (VIDEO_BLOCK_BYTES + 12) + "/" + asset.bytes);
      assert.equal(range.headers.get("content-type"), "video/mp4"); assert.equal(range.headers.get("content-length"), "16");
      const suffix = await request(route, { owner: f.client, headers: { Range: "bytes=-17" } }); assert.equal(suffix.status, 206); assert.deepEqual(suffix.bytes, Buffer.alloc(17, 0x5a));
      const head = await request(route, { owner: f.client, method: "HEAD", headers: { Range: "bytes=0-9" } });
      assert.equal(head.status, 200); assert.equal(head.bytes.length, 0); assert.equal(head.headers.get("content-length"), String(asset.bytes)); privateResponse(head);
      assert.equal((await request(route, { owner: f.client, headers: { Range: "bytes=" + asset.bytes + "-" } })).status, 416);
      const opens = storageOpens;
      for (const [target, owner] of [[ownedPath(asset, f.client), f.client], [route, other.client], [deliveryPath(f, mid, stranger.admin), stranger.admin],
        [deliveryPath(other, mid, f.admin), f.admin]]) assert.equal((await request(target, { owner })).status, 404);
      assert.equal(storageOpens, opens, "unauthorized lookups never open the encrypted object");
      assert.equal((await send(f, f.client, input(asset, "Recipient cannot reuse the original"))).status, 403);
      assert.equal((await request(galleryPath(f), { owner: other.client })).status, 404);
      assert.equal((await request(ownedPath(asset, f.admin), { owner: f.admin, method: "HEAD" })).status, 200);
    });

    await t.test("HTTP mutations enforce real origin, CSRF, strict shape and committed-owner eligibility", async () => {
      const f = await pair(), asset = await upload(f.admin), value = input(asset);
      for (const headers of [{ Origin: "https://other.invalid" }, { "X-CSRF-Token": newToken() }]) assert.equal((await request(sendPath(f), { owner: f.admin, method: "POST", body: value, headers })).status, 403);
      for (const body of [{ ...value, senderId: hex(f.admin.id) }, { ...value, caption: "x".repeat(1001) }, { ...value, caption: "\u200b" }]) assert.equal((await send(f, f.admin, body)).status, 400);
      const pending = { id: id(), storageKey: key(), bytes: 65537, storedBytes: videoStoredBytes(65537), mime: "video/mp4" };
      await normal.catalog.reserve({ ...actor(f.admin), asset: pending });
      assert.equal((await send(f, f.admin, { ...value, videoId: hex(pending.id) })).status, 404);
      await normal.catalog.release({ ...actor(f.admin), assetId: pending.id, storageKey: pending.storageKey });
      assert.equal((await send(f, f.admin, { ...value, videoId: hex(pending.id) })).status, 404);
      assert.deepEqual(await counts(f), { messages: 0, links: 0, events: 0, jobs: 0 });
      const beforeFiles = await readdir(root), beforePuts = storagePuts;
      const refused = await request(videoPath("client", "assets"), { owner: f.client, method: "POST", binary: await collectVideo(mp4Source(65537)) });
      assert.equal(refused.status, 403); assert.equal(refused.body.error, "video_admin_only");
      for (const headers of [{ "Content-Type": "video/mp4" }, { "Content-Type": "image/jpeg" }]) {
        const forged = await request(videoPath("client", "assets"), { owner: f.client, method: "POST", binary: await collectVideo(mp4Source(65537)), headers });
        assert.ok([403, 415].includes(forged.status));
      }
      assert.equal((await send(f, f.client, input(asset, "Recipient cannot resend a saved video"))).status, 403);
      assert.deepEqual(await counts(f), { messages: 0, links: 0, events: 0, jobs: 0 });
      assert.deepEqual(await readdir(root), beforeFiles); assert.equal(storagePuts, beforePuts);
    });

    await t.test("link, event and real notification failures roll back the complete publication without discarding the original", async () => {
      const f = await pair(), asset = await upload(f.admin); await subscribe(f.client, 2);
      const held = (await normal.catalog.status()).heldBytes, files = await readdir(root);
      for (const table of ["message_video", "chat_events"]) {
        await connection.query("CREATE TRIGGER synthetic_fail_video_publish BEFORE INSERT ON " + table + " FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic video failure'");
        try { assert.equal((await send(f, f.admin, input(asset))).status, 503); }
        finally { await connection.query("DROP TRIGGER synthetic_fail_video_publish"); }
        assert.deepEqual(await counts(f), { messages: 0, links: 0, events: 0, jobs: 0 });
      }
      active = await stack(pool, async (...args) => { await enqueueNotification(...args); throw new Error("synthetic notification interruption after inserts"); });
      try { assert.equal((await send(f, f.admin, input(asset))).status, 503); }
      finally { active = normal; }
      assert.deepEqual(await counts(f), { messages: 0, links: 0, events: 0, jobs: 0 });
      assert.equal((await normal.catalog.status()).heldBytes, held); assert.deepEqual(await readdir(root), files);
      assert.equal((await send(f, f.admin, input(asset))).body.message.sequence, "1");
      assert.deepEqual(await counts(f), { messages: 1, links: 1, events: 1, jobs: 2 });
    });

    await t.test("a lost acknowledgement after the native publication COMMIT survives reconstruction without duplicate jobs", async () => {
      const f = await pair(), asset = await upload(f.admin), value = input(asset); await subscribe(f.client, 2);
      let losses = 0;
      const interruptedPool = { async getConnection() {
        const native = await pool.getConnection(); let publication = false;
        return new Proxy(native, { get(target, name) {
          if (name === "query") return async (...args) => { const result = await target.query(...args); if (/INSERT\s+INTO\s+message_video\b/i.test(args[0])) publication = true; return result; };
          if (name === "commit") return async () => { await target.commit(); if (publication && losses === 0) { losses++; throw new Error("synthetic acknowledgement lost after actual video message commit"); } };
          const property = target[name]; return typeof property === "function" ? property.bind(target) : property;
        } });
      } };
      const held = (await normal.catalog.status()).heldBytes, files = await readdir(root);
      active = await stack(interruptedPool);
      try { assert.equal((await send(f, f.admin, value)).status, 503); }
      finally { active = await stack(); }
      assert.equal(losses, 1); assert.deepEqual(await counts(f), { messages: 1, links: 1, events: 1, jobs: 2 });
      const row = (await connection.query("SELECT id,sequence_no FROM messages WHERE conversation_id=?", [f.conversationId]))[0], before = await jobs(hex(row.id));
      const retry = await send(f, f.admin, value); assert.equal(retry.status, 200); assert.equal(retry.body.duplicate, true); assert.equal(retry.body.message.id, hex(row.id));
      dto(retry.body.message.video, asset, f, hex(row.id), f.admin);
      assert.deepEqual((await jobs(hex(row.id))).map((j) => hex(j.id)), before.map((j) => hex(j.id)));
      assert.deepEqual(await counts(f), { messages: 1, links: 1, events: 1, jobs: 2 });
      assert.equal((await active.catalog.status()).heldBytes, held); assert.deepEqual(await readdir(root), files); active = normal;
    });

    await t.test("the native composite link refuses another conversation and schema inspection refuses weakened foreign keys", async () => {
      const f = await pair(), other = await pair(f.admin), asset = await upload(f.admin);
      const text = await request(historyPath(f, f.admin), { owner: f.admin, method: "POST", body: { clientMessageId: hex(id()), body: "Synthetic text without attachment" } }); assert.equal(text.status, 201);
      await assert.rejects(connection.query("INSERT INTO message_video (message_id,conversation_id,video_id,created_at) VALUES (?,?,?,?)",
        [Buffer.from(text.body.message.id, "hex"), other.conversationId, Buffer.from(asset.id, "hex"), sql(now)]));
      assert.deepEqual(await counts(f), { messages: 1, links: 0, events: 1, jobs: 0 }); assert.equal(await normal.messages.assertSchema(), true);
      await connection.query("ALTER TABLE message_video DROP FOREIGN KEY message_video_asset_fk");
      try { await assert.rejects(normal.messages.assertSchema(), code("VIDEO_DATABASE_STATE")); }
      finally { await connection.query("ALTER TABLE message_video ADD CONSTRAINT message_video_asset_fk FOREIGN KEY (video_id) REFERENCES video_assets(id) ON UPDATE RESTRICT ON DELETE RESTRICT"); }
      assert.equal(await normal.messages.assertSchema(), true);
    });

    await t.test("video galleries are scoped keyset pages and preserve full unsigned sequence values", async () => {
      const f = await pair(), asset = await upload(f.admin), mids = [];
      mids.push((await send(f, f.admin, input(asset, "First"))).body.message.id);
      assert.equal((await request(historyPath(f, f.admin), { owner: f.admin, method: "POST", body: { clientMessageId: hex(id()), body: "Text is outside the video gallery" } })).status, 201);
      mids.push((await send(f, f.admin, input(asset, "Third"))).body.message.id); mids.push((await send(f, f.admin, input(asset, "Fourth"))).body.message.id);
      const latest = await request(galleryPath(f, f.client, "?limit=2"), { owner: f.client }); assert.equal(latest.status, 200);
      assert.deepEqual(latest.body.items.map((v) => v.sequence), ["4", "3"]); assert.equal(latest.body.nextBefore, "3"); assert.equal(latest.body.hasMore, true);
      assert.deepEqual(latest.body.items.map((v) => v.messageId), [mids[2], mids[1]]);
      for (const item of latest.body.items) { assert.equal(item.sender, "peer"); dto(item.video, asset, f, item.messageId, f.client); }
      const older = await request(galleryPath(f, f.client, "?before=3&limit=2"), { owner: f.client });
      assert.deepEqual(older.body.items.map((v) => v.sequence), ["1"]); assert.equal(older.body.hasMore, false); assert.equal(older.body.nextBefore, null);
      for (const query of ["?before=01", "?before=-1", "?before=18446744073709551616", "?limit=0", "?limit=101"]) assert.equal((await request(galleryPath(f, f.client, query), { owner: f.client })).status, 400);
      const large = await pair(f.admin), first = await send(large, f.admin, input(asset)); assert.equal(first.status, 201);
      await connection.query("UPDATE messages SET sequence_no=9007199254740993 WHERE id=?", [Buffer.from(first.body.message.id, "hex")]);
      const second = await send(large, f.admin, input(asset)); assert.equal(second.body.message.sequence, "9007199254740994");
      const page = await request(galleryPath(large, large.client, "?limit=1"), { owner: large.client }); assert.equal(page.body.nextBefore, "9007199254740994");
      const tail = await request(galleryPath(large, large.client, "?limit=1&before=" + page.body.nextBefore), { owner: large.client });
      assert.equal(tail.body.items[0].sequence, "9007199254740993"); assert.equal(tail.body.hasMore, false);
    });

    await t.test("persisted revocation, expiration and blocking deny viewing and retries while assigned administrator history survives", async () => {
      const admin = await user("admin"), asset = await upload(admin);
      for (const mutation of ["session", "expiry", "account"]) {
        const f = await pair(admin), value = input(asset), sent = await send(f, admin, value); assert.equal(sent.status, 201);
        const route = deliveryPath(f, sent.body.message.id);
        assert.equal((await request(route, { owner: f.client, method: "HEAD" })).status, 200);
        if (mutation === "session") await connection.query("UPDATE sessions SET revoked_at=? WHERE id=?", [sql(now), f.client.sessionId]);
        if (mutation === "expiry") await connection.query("UPDATE users SET access_expires_at=? WHERE id=?", [sql(now), f.client.id]);
        if (mutation === "account") await connection.query("UPDATE users SET status='revoked' WHERE id=?", [f.client.id]);
        const expected = mutation === "expiry" ? 403 : 401;
        for (const method of ["GET", "HEAD"]) assert.equal((await request(route, { owner: f.client, method, headers: { Range: "bytes=32-47" } })).status, expected, mutation);
        assert.equal((await request(galleryPath(f), { owner: f.client })).status, expected);
        assert.equal((await send(f, f.client, input(asset))).status, expected);
        assert.equal((await request(deliveryPath(f, sent.body.message.id, admin), { owner: admin, method: "HEAD" })).status, 200);
        if (mutation !== "session") assert.equal((await send(f, admin, value)).status, 403, "an exact retry still revalidates the recipient's current access");
      }
    });

    await t.test("a revocation committed during a native send lock wait prevents every publication row", async () => {
      const f = await pair(), asset = await upload(f.admin), messageId = id(), clientMessageId = id();
      const binding = { messageId, conversationId: f.conversationId, senderId: f.admin.id };
      const body = JSON.stringify({ videoId: asset.id, caption: "Synthetic lock-wait caption" });
      let observed;
      const candidateRead = new Promise((resolve) => { observed = resolve; });
      const observedPool = { async getConnection() {
        const native = await pool.getConnection();
        return new Proxy(native, { get(target, name) {
          if (name === "query") return async (...args) => {
            const result = await target.query(...args);
            if (args[0] === "SELECT id, admin_id, client_id FROM conversations WHERE id = ?") observed();
            return result;
          };
          const property = target[name]; return typeof property === "function" ? property.bind(target) : property;
        } });
      } };
      const waiting = await stack(observedPool); let pending;
      await connection.beginTransaction();
      try {
        await connection.query("SELECT id FROM users WHERE id=? FOR UPDATE", [f.client.id]);
        pending = waiting.messages.sendMessage({ ...actor(f.admin), conversationId: f.conversationId, message: {
          id: messageId, clientMessageId, videoId: Buffer.from(asset.id, "hex"),
          bodyEncrypted: encryptMessageBody(body, messageKey, binding), bodyFingerprint: videoMessageFingerprint(body, messageKey, binding),
        } });
        const rejected = assert.rejects(pending, code("CHAT_FORBIDDEN"));
        await candidateRead;
        await connection.query("UPDATE users SET status='revoked' WHERE id=?", [f.client.id]);
        await connection.query("UPDATE sessions SET revoked_at=? WHERE id=?", [sql(now), f.client.sessionId]);
        await connection.commit(); await rejected;
      } finally { try { await connection.rollback(); } catch {} if (pending) await pending.catch(() => {}); }
      assert.deepEqual(await counts(f), { messages: 0, links: 0, events: 0, jobs: 0 });
    });

    await t.test("tombstones revoke delivery bytes and old event payloads without resurrecting content or removing another live delivery", async () => {
      const f = await pair(), other = await pair(f.admin), asset = await upload(f.admin), value = input(asset);
      await subscribe(f.client, 2);
      const first = await send(f, f.admin, value), second = await send(other, f.admin, input(asset, "Independent caption"));
      assert.equal(first.status, 201); assert.equal(second.status, 201);
      const mid = first.body.message.id, secondMid = second.body.message.id, beforeJobs = await jobs(mid);
      const held = (await normal.catalog.status()).heldBytes, files = await readdir(root);
      const deletion = historyPath(f, f.admin, "messages/" + mid + "/delete");
      assert.equal((await request(historyPath(f, f.client, "messages/" + mid + "/delete"), { owner: f.client, method: "POST", body: {} })).status, 404);
      for (let n = 0; n < 2; n++) {
        const removed = await request(deletion, { owner: f.admin, method: "POST", body: {} }); assert.equal(removed.status, 200);
        assert.equal(removed.body.message.body, null); assert.equal(Object.hasOwn(removed.body.message, "video"), false);
      }
      const row = (await connection.query("SELECT body_encrypted,deleted_at,body_fingerprint FROM messages WHERE id=?", [Buffer.from(mid, "hex")]))[0];
      assert.equal(row.body_encrypted, null); assert.ok(row.deleted_at); assert.equal(row.body_fingerprint.length, 32);
      const history = await request(historyPath(f), { owner: f.client }); assert.equal(history.body.messages[0].body, null); assert.equal(Object.hasOwn(history.body.messages[0], "video"), false);
      const events = await request(historyPath(f, f.client, "events?after=0"), { owner: f.client });
      assert.deepEqual(events.body.events.map((e) => e.kind), ["message", "delete"]);
      assert.ok(events.body.events.every((e) => e.message.body === null && !Object.hasOwn(e.message, "video")));
      const retry = await send(f, f.admin, value); assert.equal(retry.status, 200); assert.equal(retry.body.duplicate, true);
      assert.equal(retry.body.message.body, null); assert.equal(Object.hasOwn(retry.body.message, "video"), false);
      assert.equal((await send(f, f.admin, { ...value, caption: "Cannot change a tombstone" })).status, 409);
      assert.deepEqual(await counts(f), { messages: 1, links: 1, events: 2, jobs: 2 });
      for (const method of ["GET", "HEAD"]) assert.equal((await request(deliveryPath(f, mid), { owner: f.client, method })).status, 404);
      assert.equal((await request(galleryPath(f), { owner: f.client })).body.items.length, 0);
      const surviving = await request(deliveryPath(other, secondMid), { owner: other.client, headers: { Range: "bytes=-16" } });
      assert.equal(surviving.status, 206); assert.deepEqual(surviving.bytes, Buffer.alloc(16, 0x5a));
      assert.equal((await request(galleryPath(other), { owner: other.client })).body.items[0].messageId, secondMid);
      const claimed = await notifications.claimDue({ now, limit: 20 });
      assert.ok(claimed.every((j) => !beforeJobs.some((old) => old.id.equals(j.jobId))));
      assert.ok((await jobs(mid)).every((j) => j.status === "skipped"));
      assert.deepEqual((await jobs(mid)).map((j) => hex(j.id)), beforeJobs.map((j) => hex(j.id)));
      assert.equal((await normal.catalog.status()).heldBytes, held); assert.deepEqual(await readdir(root), files);
    });
  } finally {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    await pool?.end();
    try { await reset(); } finally { await connection.end(); if (root) await rm(root, { recursive: true, force: true }); }
  }
});
