import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createAuthService } from "../server/auth/service.mjs";
import { createAuthHandler } from "../server/auth/http.mjs";
import { createAccessStore } from "../server/access/store.mjs";
import { createAccessService } from "../server/access/service.mjs";
import { createAccessHandler } from "../server/access/http.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createChatService } from "../server/chat/service.mjs";
import { createChatHandler } from "../server/chat/http.mjs";
import { createMediaStore } from "../server/media/store.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { createMediaService } from "../server/media/service.mjs";
import { createMediaHandler } from "../server/media/http.mjs";
import { createAppServer } from "../server/index.mjs";
import { createRecoveryCodes, hashPassword, makeTotpSecret, recoveryCodeDigest, sealTotpSecret, totpCode } from "../server/auth/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const newKey = () => randomBytes(16).toString("hex");
const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function filesUnder(directory) {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    assert.equal(item.isSymbolicLink(), false, "synthetic encrypted storage must not introduce symlinks");
    const filename = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await filesUnder(filename));
    else files.push(filename);
  }
  return files.sort();
}

test("real HTTP private media uses normalized encrypted files and current delivery authorization (synthetic disposable fixtures only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 180000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a disposable test schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "separately provisioned runtime DML credentials are required");
  const migrations = await loadMigrations();
  assert.equal(migrations.length, 20);
  const allowedTables = [...migrations.map((migration) => {
    const match = /^CREATE\s+TABLE\s+([a-z][a-z0-9_]*)\s*\(/i.exec(migration.sql.trim());
    assert.ok(match, "cleanup supports only explicit unqualified CREATE TABLE migrations");
    return match[1];
  }).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase();
  let pool;
  let server;
  let storageRoot;
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
    const mediaStore = createMediaStore({ pool, chatStore });
    for (const store of [authStore, accessStore, chatStore, mediaStore]) assert.equal(await store.assertSchema(), true);
    const temporaryParent = path.join(path.dirname(repositoryRoot), "audit");
    await mkdir(temporaryParent, { recursive: true, mode: 0o700 });
    storageRoot = await mkdtemp(path.join(temporaryParent, "media-flow-"));
    await chmod(storageRoot, 0o700);
    const mediaKey = randomBytes(32);
    const storage = await createMediaStorage({ root: storageRoot, key: mediaKey });
    await storage.assertReady();
    let now = Date.now();
    const clock = () => now;
    const totpKey = randomBytes(32);
    const mailKey = randomBytes(32);
    const messageKey = randomBytes(32);
    const origin = "https://example.invalid";
    const adminId = randomBytes(16);
    const adminEmail = "media-flow-admin@example.invalid";
    const adminPassword = "Synthetic media administrator password 2026!";
    const clientPassword = "Synthetic media client password 2026!";
    const secret = makeTotpSecret();
    await authStore.initializeAdmin({ id: adminId, email: adminEmail, pseudonym: "Synthetic Jessie",
      passwordHash: await hashPassword(adminPassword), secretEncrypted: sealTotpSecret(secret, totpKey, adminId),
      recoveryDigests: createRecoveryCodes().map(recoveryCodeDigest), now });
    const clientHash = await hashPassword(clientPassword);
    const clients = ["a", "b"].map((suffix) => ({ id: randomBytes(16), conversationId: randomBytes(16),
      email: `media-flow-client-${suffix}@example.invalid`, pseudonym: `Synthetic media client ${suffix.toUpperCase()}` }));
    // Synthetic independently assured fixtures exercise authorization; this is not an age-proof API.
    // No invitation, mail delivery, private portrait or real account is created.
    for (const client of clients) {
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash,
        email_verified_at, age_assured_at, access_approved_at, created_at, updated_at)
        VALUES (?, 'client', 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [client.id, client.pseudonym, client.email, clientHash, ...Array(5).fill(sqlDate(now))]);
      await connection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [client.id, sqlDate(now)]);
      await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)",
        [client.conversationId, client.id, adminId, sqlDate(now)]);
    }
    const [clientA, clientB] = clients;
    const convA = clientA.conversationId.toString("hex");
    const convB = clientB.conversationId.toString("hex");
    const authService = await createAuthService({ store: authStore, totpKey, clock });
    const accessService = await createAccessService({ store: accessStore, authStore, authService, totpKey, mailKey, origin, clock });
    const chatService = await createChatService({ store: chatStore, authStore, authService, accessService, key: messageKey, clock });
    const mediaService = await createMediaService({ store: mediaStore, chatService, authStore, storage, key: mediaKey, clock });
    server = createAppServer({ authHandler: createAuthHandler(authService, { origin }),
      accessHandler: createAccessHandler(accessService, { origin }), chatHandler: createChatHandler(chatService, { origin }),
      mediaHandler: createMediaHandler(mediaService, { origin }) });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route, { method = "GET", body, binary, headers = {} } = {}) {
      const response = await fetch(`${base}${route}`, { method, redirect: "manual", headers: {
        ...(method === "POST" ? { Origin: origin, "Content-Type": binary ? "image/png" : "application/json", "X-Jessie-Request": "1" } : {}), ...headers,
      }, ...(binary !== undefined ? { body: binary } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const bytes = Buffer.from(await response.arrayBuffer());
      let value = bytes;
      if (!response.headers.get("content-type")?.startsWith("image/")) {
        const text = bytes.toString("utf8");
        try { value = JSON.parse(text); } catch { value = text; }
      }
      return { status: response.status, headers: response.headers, body: value, bytes };
    }
    const headersFor = (session) => ({ Cookie: session.cookie, "X-CSRF-Token": session.csrf });
    const mediaPath = (role, suffix) => `/api/media/${role}/${suffix}`;
    const imageSendPath = (role, conversationId = convA) => mediaPath(role, `conversations/${conversationId}/messages`);
    const chatPath = (role, suffix = "messages", conversationId = convA) => `/api/chat/${role}/conversations/${conversationId}/${suffix}`;
    const count = async (table) => Number((await connection.query(`SELECT COUNT(*) AS count FROM ${table}`))[0].count);
    const login = await request("/api/auth/login", { method: "POST", body: {
      email: adminEmail, password: adminPassword, factor: totpCode(secret, { now }),
    } });
    assert.equal(login.status, 200);
    const admin = { cookie: login.headers.get("set-cookie").split(";")[0], csrf: login.body.csrf };
    async function loginClient(client) {
      const response = await request("/api/access/login", { method: "POST", body: { email: client.email, password: clientPassword } });
      assert.equal(response.status, 200);
      assert.equal(response.body.access.state, "active");
      return { cookie: response.headers.get("set-cookie").split(";")[0], csrf: response.body.csrf };
    }
    const a = await loginClient(clientA);
    const b = await loginClient(clientB);
    const privateMarker = "SyntheticPrivateCameraMetadata2026";
    const sourceA = await sharp({ create: { width: 160, height: 120, channels: 4, background: { r: 190, g: 35, b: 75, alpha: 0.7 } } })
      .withExif({ IFD0: { Artist: privateMarker, ImageDescription: "Only synthetic fixture pixels" } }).png().toBuffer();
    assert.ok(Buffer.isBuffer((await sharp(sourceA).metadata()).exif), "the source fixture includes metadata that normalization must actually remove");
    const sourceB = await sharp({ create: { width: 96, height: 144, channels: 3, background: { r: 30, g: 90, b: 180 } } }).png().toBuffer();
    let assetA;
    let adminAsset;
    let firstMessage;
    let repeatedMessage;
    let adminMessage;
    let bMessage;
    let firstFiles;
    let normalizedA;
    const firstInput = { clientMessageId: newKey(), mediaId: null, caption: "Synthetic caption <script>window.mediaLeak=true</script> 📷" };

    await t.test("upload requires fresh CSRF, accepts only bounded still images and exposes authenticated capabilities", async () => {
      assert.equal((await request(mediaPath("client", "capabilities"))).status, 401);
      const capabilities = await request(mediaPath("client", "capabilities"), { headers: headersFor(a) });
      assert.equal(capabilities.status, 200);
      assert.deepEqual(capabilities.body, { enabled: true, maxUploadBytes: 10485760, formats: ["image/jpeg", "image/png", "image/webp"] });
      assert.equal((await request(mediaPath("client", "assets"), { method: "POST", binary: sourceA, headers: { Cookie: a.cookie } })).status, 403);
      assert.equal((await request(mediaPath("client", "assets"), { method: "POST", binary: sourceA,
        headers: { ...headersFor(a), "Content-Type": "text/plain" } })).status, 415);
      assert.equal((await request(mediaPath("client", "assets"), { method: "POST", binary: Buffer.from("not an image"), headers: headersFor(a) })).status, 415);
      const tooLarge = await new Promise((resolve, reject) => {
        const call = httpRequest(`${base}${mediaPath("client", "assets")}`, { method: "POST", headers: {
          ...headersFor(a), Origin: origin, "Content-Type": "image/png", "Content-Length": "10485761",
        } }, (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
        });
        call.setTimeout(5000, () => call.destroy(new Error("oversize header rejection timed out")));
        call.on("error", reject);
        call.end();
      });
      assert.equal(tooLarge.status, 413);
      assert.equal(await count("media_assets"), 0);
      assert.deepEqual(await filesUnder(storageRoot), []);
    });

    await t.test("normalization strips source metadata and stores only encrypted files while identical retries deduplicate", async () => {
      const uploaded = await request(mediaPath("client", "assets"), { method: "POST", binary: sourceA, headers: headersFor(a) });
      assert.equal(uploaded.status, 201);
      assert.equal(uploaded.body.duplicate, false);
      assetA = uploaded.body.asset;
      firstInput.mediaId = assetA.id;
      assert.equal(assetA.width, 160);
      assert.equal(assetA.height, 120);
      assert.equal(assetA.sharedHere, false);
      assert.equal(assetA.fullUrl, mediaPath("client", `assets/${assetA.id}/full`));
      assert.equal(assetA.thumbnailUrl, mediaPath("client", `assets/${assetA.id}/thumb`));
      const full = await request(assetA.fullUrl, { headers: headersFor(a) });
      assert.equal(full.status, 200);
      normalizedA = full.bytes;
      const metadata = await sharp(normalizedA).metadata();
      assert.equal(metadata.format, "jpeg");
      assert.equal(metadata.hasAlpha, false);
      assert.equal(metadata.exif, undefined);
      assert.equal(metadata.xmp, undefined);
      assert.equal(normalizedA.includes(Buffer.from(privateMarker)), false);
      assert.equal(normalizedA.equals(sourceA), false);
      firstFiles = await filesUnder(storageRoot);
      assert.equal(firstFiles.length, 2);
      for (const filename of firstFiles) {
        assert.equal((await lstat(filename)).mode & 0o777, 0o600);
        const encrypted = await readFile(filename);
        assert.equal(encrypted.includes(normalizedA), false);
        assert.equal(encrypted.includes(sourceA), false);
        assert.equal(encrypted.includes(Buffer.from(privateMarker)), false);
      }
      const row = (await connection.query("SELECT storage_key, content_digest FROM media_assets WHERE id = ?", [Buffer.from(assetA.id, "hex")]))[0];
      const publicJson = JSON.stringify(uploaded.body);
      for (const secretValue of [row.storage_key.toString("hex"), row.content_digest.toString("hex"), privateMarker, storageRoot, clientA.email]) {
        assert.equal(publicJson.includes(secretValue), false);
      }
      const duplicates = await Promise.all([1, 2].map(() => request(mediaPath("client", "assets"), {
        method: "POST", binary: sourceA, headers: headersFor(a),
      })));
      for (const duplicate of duplicates) {
        assert.equal(duplicate.status, 200);
        assert.equal(duplicate.body.duplicate, true);
        assert.equal(duplicate.body.asset.id, assetA.id);
      }
      assert.equal(await count("media_assets"), 1);
      assert.deepEqual(await filesUnder(storageRoot), firstFiles, "deduplicated proposed files are removed without unlinking the persisted asset");
    });

    await t.test("image sends persist once, reconcile concurrent retries and keep media bound to the exact sender and content", async () => {
      const responses = await Promise.all([1, 2].map(() => request(imageSendPath("client"), {
        method: "POST", headers: headersFor(a), body: firstInput,
      })));
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
      assert.equal(responses[0].body.message.id, responses[1].body.message.id);
      firstMessage = responses[0].body.message;
      assert.equal(firstMessage.sequence, "1");
      assert.equal(firstMessage.body, firstInput.caption);
      assert.equal(firstMessage.media.id, assetA.id);
      assert.equal(firstMessage.clientMessageId, firstInput.clientMessageId);
      const row = (await connection.query("SELECT body_encrypted FROM messages WHERE id = ?", [Buffer.from(firstMessage.id, "hex")]))[0];
      assert.equal(row.body_encrypted.includes(firstInput.caption), false);
      assert.equal(row.body_encrypted.includes(assetA.id), false);
      assert.equal((await request(imageSendPath("client"), { method: "POST", headers: headersFor(a),
        body: { ...firstInput, caption: "Changed retry caption" } })).status, 409);
      assert.equal((await request(chatPath("client"), { method: "POST", headers: headersFor(a),
        body: { clientMessageId: firstInput.clientMessageId, body: firstInput.caption } })).status, 409);
      const received = await request(chatPath("admin"), { headers: headersFor(admin) });
      assert.equal(received.status, 200);
      assert.equal(received.body.messages[0].sender, "peer");
      assert.equal(received.body.messages[0].clientMessageId, null);
      assert.equal(received.body.messages[0].media.fullUrl, mediaPath("admin", `conversations/${convA}/messages/${firstMessage.id}/full`));
      assert.equal(await count("messages"), 1);
      assert.equal(await count("message_media"), 1);
      assert.equal(await count("chat_events"), 1);
    });

    await t.test("delivery URLs authorize every GET and HEAD while another client cannot read or reuse the asset", async () => {
      assert.equal((await request(assetA.fullUrl, { headers: headersFor(b) })).status, 404);
      assert.equal((await request(mediaPath("admin", `assets/${assetA.id}/full`), { headers: headersFor(admin) })).status, 404);
      const deliveryUrl = mediaPath("admin", `conversations/${convA}/messages/${firstMessage.id}/full`);
      const delivery = await request(deliveryUrl, { headers: { ...headersFor(admin), Range: "bytes=0-9" } });
      assert.equal(delivery.status, 200);
      assert.equal(delivery.bytes.equals(normalizedA), true);
      assert.equal(delivery.headers.get("content-type"), "image/jpeg");
      assert.equal(delivery.headers.get("content-length"), String(normalizedA.length));
      assert.match(delivery.headers.get("content-disposition"), /inline;.*photo\.jpg/);
      assert.match(delivery.headers.get("cache-control"), /no-store/);
      assert.equal(delivery.headers.get("x-content-type-options"), "nosniff");
      assert.equal(delivery.headers.get("cross-origin-resource-policy"), "same-origin");
      assert.equal(delivery.headers.get("access-control-allow-origin"), null);
      const head = await request(deliveryUrl, { method: "HEAD", headers: headersFor(admin) });
      assert.equal(head.status, 200);
      assert.equal(head.bytes.length, 0);
      assert.equal(head.headers.get("content-length"), String(normalizedA.length));
      const thumb = await request(mediaPath("admin", `conversations/${convA}/messages/${firstMessage.id}/thumb`), { headers: headersFor(admin) });
      assert.equal(thumb.status, 200);
      assert.equal((await sharp(thumb.bytes).metadata()).format, "jpeg");
      for (const variant of ["full", "thumb"]) assert.equal((await request(mediaPath("client", `conversations/${convA}/messages/${firstMessage.id}/${variant}`), {
        headers: headersFor(b),
      })).status, 404);
      assert.equal((await request(imageSendPath("client", convB), { method: "POST", headers: headersFor(b), body: {
        clientMessageId: newKey(), mediaId: assetA.id, caption: "Foreign owner cannot resend by ID",
      } })).status, 404);
      assert.equal((await request(imageSendPath("admin"), { method: "POST", headers: headersFor(admin), body: {
        clientMessageId: newKey(), mediaId: assetA.id, caption: "Recipient cannot resend by ID",
      } })).status, 404);
      assert.equal((await request(mediaPath("client", `conversations/${convA}/gallery`), { headers: headersFor(b) })).status, 404);
      assert.equal((await request(mediaPath("client", "assets"), { headers: headersFor(b) })).body.assets.length, 0);
      assert.equal(await count("messages"), 1);
    });

    await t.test("an explicit resend supports an empty caption and gallery/library cursors stay scoped to delivered photos", async () => {
      const response = await request(imageSendPath("client"), { method: "POST", headers: headersFor(a),
        body: { clientMessageId: newKey(), mediaId: assetA.id, caption: "" } });
      assert.equal(response.status, 201);
      repeatedMessage = response.body.message;
      assert.equal(repeatedMessage.body, "");
      assert.equal(repeatedMessage.sequence, "2");
      assert.equal(repeatedMessage.media.id, assetA.id);
      const gallery = await request(mediaPath("admin", `conversations/${convA}/gallery?limit=1`), { headers: headersFor(admin) });
      assert.equal(gallery.status, 200);
      assert.equal(gallery.body.items.length, 1);
      assert.equal(gallery.body.items[0].messageId, repeatedMessage.id);
      assert.equal(gallery.body.items[0].sequence, "2");
      assert.equal(gallery.body.hasMore, true);
      const older = await request(mediaPath("admin", `conversations/${convA}/gallery?before=${gallery.body.nextBefore}&limit=1`), { headers: headersFor(admin) });
      assert.equal(older.body.items[0].messageId, firstMessage.id);
      assert.equal(older.body.hasMore, false);
      const library = await request(mediaPath("client", `assets?conversationId=${convA}`), { headers: headersFor(a) });
      assert.equal(library.body.assets.length, 1);
      assert.equal(library.body.assets[0].sharedHere, true);
      const otherConversation = await request(mediaPath("client", `assets?conversationId=${convB}`), { headers: headersFor(a) });
      assert.equal(otherConversation.status, 404);
      const uploaded = await request(mediaPath("admin", "assets"), { method: "POST", binary: sourceB, headers: headersFor(admin) });
      assert.equal(uploaded.status, 201);
      adminAsset = uploaded.body.asset;
      const reply = await request(imageSendPath("admin"), { method: "POST", headers: headersFor(admin),
        body: { clientMessageId: newKey(), mediaId: adminAsset.id, caption: "Synthetic administrator photo" } });
      assert.equal(reply.status, 201);
      adminMessage = reply.body.message;
      assert.equal(adminMessage.sequence, "3");
      assert.equal((await request(imageSendPath("client"), { method: "POST", headers: headersFor(a),
        body: { ...firstInput, mediaId: adminAsset.id } })).status, 409);
      assert.equal(await count("messages"), 3);
    });

    await t.test("tampered encrypted files fail generically without exposing storage paths, keys or source metadata", async () => {
      const filename = firstFiles.find((item) => /full/.test(path.basename(item)));
      assert.ok(filename, "the normalized full variant has a distinct encrypted file");
      const original = await readFile(filename);
      const corrupted = Buffer.from(original);
      corrupted[corrupted.length - 1] ^= 1;
      await writeFile(filename, corrupted, { mode: 0o600 });
      try {
        const failure = await request(assetA.fullUrl, { headers: headersFor(a) });
        assert.equal(failure.status, 503);
        assert.deepEqual(failure.body, { error: "media_unavailable" });
        const response = JSON.stringify(failure.body);
        for (const secretValue of [filename, storageRoot, privateMarker, mediaKey.toString("base64url")]) assert.equal(response.includes(secretValue), false);
      } finally {
        await writeFile(filename, original, { mode: 0o600 });
      }
      assert.equal((await request(assetA.fullUrl, { headers: headersFor(a) })).status, 200);
    });

    await t.test("message tombstones immediately revoke delivery URLs; only the last removed delivery permits owner file removal", async () => {
      const removeAsset = () => request(mediaPath("client", `assets/${assetA.id}/delete`), { method: "POST", headers: headersFor(a), body: {} });
      assert.equal((await removeAsset()).status, 409);
      assert.equal((await request(chatPath("admin", `messages/${firstMessage.id}/delete`), { method: "POST", headers: headersFor(admin), body: {} })).status, 404);
      const removed = await request(chatPath("client", `messages/${firstMessage.id}/delete`), { method: "POST", headers: headersFor(a), body: {} });
      assert.equal(removed.status, 200);
      assert.equal(removed.body.message.body, null);
      assert.equal(Object.hasOwn(removed.body.message, "media"), false);
      for (const method of ["GET", "HEAD"]) assert.equal((await request(mediaPath("admin", `conversations/${convA}/messages/${firstMessage.id}/full`), {
        method, headers: headersFor(admin),
      })).status, 404);
      const events = await request(chatPath("admin", "events?after=3"), { headers: headersFor(admin) });
      assert.equal(events.body.events.length, 1);
      assert.equal(events.body.events[0].kind, "delete");
      assert.equal(events.body.events[0].message.id, firstMessage.id);
      assert.equal(Object.hasOwn(events.body.events[0].message, "media"), false);
      const replay = await request(imageSendPath("client"), { method: "POST", headers: headersFor(a), body: firstInput });
      assert.equal(replay.status, 200);
      assert.equal(replay.body.duplicate, true);
      assert.equal(replay.body.message.body, null);
      assert.equal(Object.hasOwn(replay.body.message, "media"), false);
      assert.equal((await removeAsset()).status, 409, "another live delivery retains the shared file");
      assert.equal((await request(mediaPath("admin", `conversations/${convA}/messages/${repeatedMessage.id}/full`), { headers: headersFor(admin) })).status, 200);
      assert.deepEqual(await Promise.all(firstFiles.map(async (filename) => (await lstat(filename)).isFile())), [true, true]);
      assert.equal((await request(chatPath("client", `messages/${repeatedMessage.id}/delete`), { method: "POST", headers: headersFor(a), body: {} })).status, 200);
      assert.equal((await removeAsset()).status, 200);
      for (const filename of firstFiles) await assert.rejects(lstat(filename), { code: "ENOENT" });
      assert.equal((await request(assetA.fullUrl, { headers: headersFor(a) })).status, 404);
      const gallery = await request(mediaPath("admin", `conversations/${convA}/gallery`), { headers: headersFor(admin) });
      assert.deepEqual(gallery.body.items.map((item) => item.messageId), [adminMessage.id]);
      assert.equal((await request(mediaPath("client", "assets"), { headers: headersFor(a) })).body.assets.length, 0);
      assert.equal(await count("message_media"), 3, "historical delivery links remain while all deleted content is absent from reads");
    });

    await t.test("access expiration denies library, gallery, image GET/HEAD and uploads while the assigned administrator retains history", async () => {
      const boundary = now + 60000;
      await connection.query("UPDATE users SET access_expires_at = ? WHERE id = ?", [sqlDate(boundary), clientA.id]);
      const clientDelivery = mediaPath("client", `conversations/${convA}/messages/${adminMessage.id}/full`);
      now = boundary - 1;
      assert.equal((await request(clientDelivery, { headers: headersFor(a) })).status, 200);
      now = boundary;
      for (const route of [mediaPath("client", "assets"), mediaPath("client", `conversations/${convA}/gallery`), clientDelivery]) {
        assert.equal((await request(route, { headers: headersFor(a) })).status, 403);
      }
      assert.equal((await request(clientDelivery, { method: "HEAD", headers: headersFor(a) })).status, 403);
      assert.equal((await request(mediaPath("client", "assets"), { method: "POST", binary: sourceA, headers: headersFor(a) })).status, 403);
      assert.equal((await request(imageSendPath("client"), { method: "POST", headers: headersFor(a), body: firstInput })).status, 403);
      const adminGallery = await request(mediaPath("admin", `conversations/${convA}/gallery`), { headers: headersFor(admin) });
      assert.equal(adminGallery.status, 200);
      assert.equal(adminGallery.body.items[0].messageId, adminMessage.id);
      assert.equal((await request(adminGallery.body.items[0].media.fullUrl, { headers: headersFor(admin) })).status, 200);
      assert.equal((await request(imageSendPath("admin"), { method: "POST", headers: headersFor(admin), body: {
        clientMessageId: newKey(), mediaId: adminAsset.id, caption: "Expired recipient cannot receive another image",
      } })).status, 403);
      assert.equal(await count("messages"), 3);
    });

    await t.test("revocation removes all client media authority and administrator logout closes private image access", async () => {
      const uploaded = await request(mediaPath("client", "assets"), { method: "POST", binary: sourceB, headers: headersFor(b) });
      assert.equal(uploaded.status, 201);
      const ownB = uploaded.body.asset;
      assert.notEqual(ownB.id, adminAsset.id, "identical bytes belong to independent owner libraries");
      const sent = await request(imageSendPath("client", convB), { method: "POST", headers: headersFor(b), body: {
        clientMessageId: newKey(), mediaId: ownB.id, caption: "Synthetic second client photo",
      } });
      assert.equal(sent.status, 201);
      bMessage = sent.body.message;
      assert.equal((await request(`/api/admin/clients/${clientB.id.toString("hex")}/revoke`, { method: "POST", headers: headersFor(admin), body: {} })).status, 200);
      for (const route of [ownB.fullUrl, mediaPath("client", "assets"), mediaPath("client", `conversations/${convB}/gallery`),
        mediaPath("client", `conversations/${convB}/messages/${bMessage.id}/full`)]) {
        const denied = await request(route, { headers: headersFor(b) });
        assert.equal(denied.status, 401);
        assert.match(denied.headers.get("set-cookie"), /^__Host-jessie_client=; /);
      }
      const adminHistory = await request(mediaPath("admin", `conversations/${convB}/gallery`), { headers: headersFor(admin) });
      assert.equal(adminHistory.status, 200);
      assert.equal(adminHistory.body.items[0].messageId, bMessage.id);
      assert.equal((await request(adminHistory.body.items[0].media.thumbnailUrl, { headers: headersFor(admin) })).status, 200);
      assert.equal((await request(imageSendPath("admin", convB), { method: "POST", headers: headersFor(admin), body: {
        clientMessageId: newKey(), mediaId: adminAsset.id, caption: "Revoked recipient cannot receive another image",
      } })).status, 403);
      assert.equal((await request("/api/auth/logout-all", { method: "POST", headers: headersFor(admin), body: {} })).status, 200);
      assert.equal((await request(adminAsset.fullUrl, { headers: headersFor(admin) })).status, 401);
      assert.equal((await request(adminHistory.body.items[0].media.fullUrl, { method: "HEAD", headers: headersFor(admin) })).status, 401);
      assert.equal(await count("messages"), 4);
    });
  } finally {
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    try { if (pool) await pool.end(); }
    finally {
      try { await reset(); }
      finally {
        try { await connection.end(); }
        finally { if (storageRoot) await rm(storageRoot, { recursive: true, force: true }); }
      }
    }
  }
});
