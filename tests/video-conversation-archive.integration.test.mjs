// Real candidate HTTP/SQL/GCM archive qualification on a disposable database.
// The independent ZIP reader below imports no archive implementation code.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
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
import { createCrmHandler } from "../server/crm/http.mjs";
import { createStreamingConversationExporter } from "../server/chat/streaming-conversation-export.mjs";
import { createVideoStore } from "../server/video/store.mjs";
import { createVideoMessageStore } from "../server/video/message-store.mjs";
import { createVideoService } from "../server/video/service.mjs";
import { createVideoStorage, VIDEO_BLOCK_BYTES } from "../server/video/storage.mjs";
import { loadVideoMigrations } from "../server/video/migrations.mjs";
import { seedLegacyClientVideoAsset, seedLegacyClientVideoMessage } from "./helpers/legacy-video-seed.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import { mp4Source } from "./helpers/video-transport-fixture.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1", origin = "https://example.invalid";
const id = () => randomBytes(16), key = () => randomBytes(32), hex = (value) => value.toString("hex");
const sql = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
async function streamHash(source) {
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of source) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest("hex") };
}
const hashFile = (filename) => streamHash(createReadStream(filename, { highWaterMark: 65536 }));
async function* source(bytes, fill) {
  let offset = 0;
  for await (const chunk of mp4Source(bytes)) { chunk.fill(fill, Math.max(0, 32 - offset)); offset += chunk.length; yield chunk; }
}
async function exact(handle, bytes, position) {
  const buffer = Buffer.alloc(bytes); let filled = 0;
  while (filled < bytes) {
    const { bytesRead } = await handle.read(buffer, filled, bytes - filled, position + filled);
    assert.ok(bytesRead > 0, "ZIP metadata must be complete"); filled += bytesRead;
  }
  return buffer;
}
function crcUpdate(value, chunk) {
  // Deliberately independent, bit-at-a-time reference implementation.
  let crc = value >>> 0;
  for (const byte of chunk) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
}
async function readZip(filename) {
  const handle = await open(filename, "r");
  try {
    const size = (await handle.stat()).size; assert.ok(size >= 22);
    const end = await exact(handle, 22, size - 22);
    assert.equal(end.readUInt32LE(0), 0x06054b50, "a valid ZIP has its final central-directory footer");
    assert.equal(end.readUInt16LE(4), 0); assert.equal(end.readUInt16LE(6), 0); assert.equal(end.readUInt16LE(20), 0);
    const count = end.readUInt16LE(10), centralBytes = end.readUInt32LE(12), centralOffset = end.readUInt32LE(16);
    assert.equal(end.readUInt16LE(8), count); assert.ok(count >= 3 && count < 100);
    assert.equal(centralOffset + centralBytes + 22, size);
    const entries = new Map(); let position = centralOffset;
    for (let index = 0; index < count; index++) {
      const central = await exact(handle, 46, position);
      assert.equal(central.readUInt32LE(0), 0x02014b50); assert.equal(central.readUInt16LE(10), 0, "native archive uses STORED entries");
      const flags = central.readUInt16LE(8), crc = central.readUInt32LE(16), compressed = central.readUInt32LE(20), bytes = central.readUInt32LE(24);
      const nameBytes = central.readUInt16LE(28), extraBytes = central.readUInt16LE(30), commentBytes = central.readUInt16LE(32), offset = central.readUInt32LE(42);
      assert.equal(flags, 0x0808); assert.equal(compressed, bytes); assert.equal(extraBytes, 0); assert.equal(commentBytes, 0);
      const name = (await exact(handle, nameBytes, position + 46)).toString("utf8");
      assert.match(name, /^(?:conversation\.json|Conversation\.html|LIRE-MOI\.txt|videos\/[a-f0-9]{32}\.mp4)$/);
      assert.equal(entries.has(name), false); assert.ok(offset < centralOffset);
      const local = await exact(handle, 30, offset);
      assert.equal(local.readUInt32LE(0), 0x04034b50); assert.equal(local.readUInt16LE(6), flags); assert.equal(local.readUInt16LE(8), 0);
      assert.equal(local.readUInt16LE(26), nameBytes); assert.equal(local.readUInt16LE(28), 0);
      assert.equal((await exact(handle, nameBytes, offset + 30)).toString("utf8"), name);
      const start = offset + 30 + nameBytes, descriptorAt = start + bytes;
      assert.ok(descriptorAt + 16 <= centralOffset);
      const descriptor = await exact(handle, 16, descriptorAt);
      assert.equal(descriptor.readUInt32LE(0), 0x08074b50); assert.equal(descriptor.readUInt32LE(4), crc);
      assert.equal(descriptor.readUInt32LE(8), bytes); assert.equal(descriptor.readUInt32LE(12), bytes);
      const hash = createHash("sha256"), text = [], isVideo = name.endsWith(".mp4"); let actual = 0, checked = 0xffffffff;
      if (!isVideo) assert.ok(bytes <= 1024 * 1024, "text metadata remains bounded independently of video size");
      if (bytes > 0) for await (const chunk of createReadStream(filename, { start, end: start + bytes - 1, highWaterMark: 65536 })) {
        hash.update(chunk); checked = crcUpdate(checked, chunk); actual += chunk.length;
        if (!isVideo) text.push(chunk);
      }
      assert.equal(actual, bytes); assert.equal((checked ^ 0xffffffff) >>> 0, crc, "independent CRC32 agrees with central directory");
      entries.set(name, { bytes, sha256: hash.digest("hex"), ...(isVideo ? {} : { text: Buffer.concat(text).toString("utf8") }) });
      position += 46 + nameBytes + extraBytes + commentBytes;
    }
    assert.equal(position, centralOffset + centralBytes); return entries;
  } finally { await handle.close(); }
}

test("real HTTP conversation ZIP streams isolate video deliveries and authenticate GCM before a valid ZIP footer", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 180000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  assert.notEqual(process.env.JESSIEMESSAGE_RUNTIME_DB_USER, options.user);
  const base = await loadMigrations(), candidates = await loadVideoMigrations();
  assert.equal(base.length, 33); assert.equal(candidates.length, 36); assert.deepEqual(candidates.slice(0, 33), base);
  const allowed = [...createdMigrationTables(candidates).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool, server, directory, handlers = [];
  let now = Date.UTC(2026, 9, 21, 12), beforeVideoOpen = null;
  const clock = () => now, created = sql(now - 1000);
  async function reset() {
    const actual = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(actual.every((row) => allowed.includes(row.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowed) await connection.query("DROP TABLE IF EXISTS " + table);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations: base });
    pool = await createRuntimePool(process.env);
    const authStore = createAuthStore(pool, { clock }), accessStore = createAccessStore(pool, { clock });
    assert.equal(await createChatStore(pool, { clock }).assertSchema(), true);
    assert.equal(await authStore.assertSchema(), true); assert.equal(await accessStore.assertSchema(), true);
    await applyMigrations(connection, { database: options.database, migrations: candidates });
    assert.equal((await loadMigrations()).length, 33);
    const audit = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(audit, { recursive: true, mode: 0o700 });
    directory = await mkdtemp(path.join(audit, "video-archive-native-"));
    const root = path.join(directory, "source-video"); await mkdir(root, { mode: 0o700 });
    const videoKey = key(), storage = await createVideoStorage({ root, key: videoKey }), messageKey = key(), totpKey = key();
    const capacity = { ownerBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, rootFingerprint: key() };
    let messages;
    const chat = createChatStore(pool, { clock, decorateMessages: (...args) => messages.decorateMessages(...args) });
    const catalog = createVideoStore({ pool, chatStore: chat, capacity });
    messages = createVideoMessageStore({ pool, chatStore: chat, videoStore: catalog });
    await messages.assertSchema(); await catalog.initialize({ now, offline: true });
    const authService = await createAuthService({ store: authStore, totpKey, clock });
    const accessService = await createAccessService({ store: accessStore, authStore, authService, totpKey, mailKey: key(), origin, clock });
    const chatService = await createChatService({ store: chat, videoMessages: messages, authStore, authService, accessService, key: messageKey, clock });
    const videoService = await createVideoService({ store: catalog, messages, storage, chatService, authStore, key: videoKey, minimumFreeBytes: 0, clock });
    async function user(role, label) {
      const owner = { id: id(), role, sessionId: id(), token: newToken(), pseudonym: "Synthetic " + label, email: label + "@example.invalid" };
      owner.tokenHash = tokenDigest(owner.token); owner.csrf = csrfToken(owner.token);
      owner.cookie = (role === "admin" ? "__Host-jessie_session=" : "__Host-jessie_client=") + owner.token;
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at,
        age_assured_at, access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, NULL, ?, ?, ?)`,
      [owner.id, role, owner.pseudonym, owner.email, role === "client" ? created : null, role === "client" ? created : null, created, created]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic', 1, 1, ?)", [owner.id, created]);
      else {
        await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [owner.id, created]);
        await consumeSyntheticInvitation(connection, owner.id, now - 1000);
      }
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        [owner.sessionId, owner.id, owner.tokenHash, created, sql(now + 8 * 3600000)]);
      await connection.query(role === "admin"
        ? "INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)"
        : "INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)",
      role === "admin" ? [owner.sessionId, created, created] : [owner.sessionId, created]); return owner;
    }
    const admin = await user("admin", "archive-peer"), first = await user("client", "archive-first"), second = await user("client", "archive-second");
    const firstConversation = id(), secondConversation = id(), clients = new Map([[hex(firstConversation), first], [hex(secondConversation), second]]);
    await connection.query("INSERT INTO conversations (id, admin_id, client_id, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      [firstConversation, admin.id, first.id, created, secondConversation, admin.id, second.id, created]);
    const opens = [];
    const makeExporter = (role) => createStreamingConversationExporter({ role, clock,
      history: (token, cid, options) => chatService.messages(role, token, cid, options), photo: null,
      video: async (token, cid, mid, options) => {
        opens.push({ role, cid, mid });
        if (beforeVideoOpen) { const operation = beforeVideoOpen; beforeVideoOpen = null; await operation({ role, cid, mid }); }
        return videoService.openExportMessage(role, token, cid, mid, options);
      },
    });
    // Only profile presentation is synthetic; actor, conversation and attachment
    // authorization always go through the real SQL-backed services.
    const crmService = Object.fromEntries(["listLabels", "createLabel", "renameLabel", "deleteLabel", "saveProfile", "contacts"].map((name) => [name, async () => { throw new Error("Unexpected synthetic CRM operation"); }]));
    Object.assign(crmService, { actor: (token) => chatService.actor("admin", token), async profile(token, cid) {
      await chatService.messages("admin", token, cid, { limit: 1 });
      const client = clients.get(cid); assert.ok(client);
      return { conversationId: cid, client: { id: hex(client.id), pseudonym: client.pseudonym, email: client.email, status: "active" },
        access: { state: "active", expiresAt: null }, nickname: "", notes: "", reminderAt: null, labels: [], version: "0", updatedAt: null };
    } });
    handlers = [createChatHandler(chatService, { origin, clientConversationExporter: makeExporter("client") }),
      createCrmHandler(crmService, { origin, conversationExporter: makeExporter("admin") })];
    server = createServer(async (request, response) => {
      try {
        for (const handler of handlers) if (await handler(request, response)) return;
        response.writeHead(404); response.end();
      } catch { if (response.headersSent) response.destroy(); else { response.writeHead(500); response.end(); } }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = "http://127.0.0.1:" + server.address().port;
    const route = (owner, conversationId) => owner.role === "admin" ? "/api/admin/crm/conversations/" + hex(conversationId) + "/export"
      : "/api/chat/client/conversations/" + hex(conversationId) + "/export";
    let downloadNumber = 0;
    async function download(owner, conversationId, { headers = {}, body = { includePhotos: false, includeVideos: true }, method = "POST", suffix = "" } = {}) {
      const filename = path.join(directory, "download-" + (++downloadNumber) + ".zip");
      const response = await fetch(baseUrl + route(owner, conversationId) + suffix, { method, redirect: "manual", headers: {
        Cookie: owner.cookie, Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1", "X-CSRF-Token": owner.csrf, ...headers,
      }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
      const handle = await open(filename, "wx", 0o600); let complete = false, received = 0;
      const iterator = response.body[Symbol.asyncIterator]();
      try {
        for (;;) {
          let next;
          try { next = await iterator.next(); }
          catch (error) { assert.ok(error instanceof Error); break; }
          if (next.done) { complete = true; break; }
          const chunk = next.value;
          let position = 0;
          while (position < chunk.length) {
            const { bytesWritten } = await handle.write(chunk, position, chunk.length - position, null); assert.ok(bytesWritten > 0); position += bytesWritten;
          }
          received += chunk.length;
        }
      } finally {
        try { if (!complete) await iterator.return().catch(() => {}); }
        finally { try { await handle.sync(); } finally { await handle.close(); } }
      }
      return { response, filename, complete, received };
    }
    async function upload(owner, fill) {
      const bytes = VIDEO_BLOCK_BYTES * 2 + 57, expected = await streamHash(source(bytes, fill));
      if (owner.role === "client") {
        const legacy = await seedLegacyClientVideoAsset({ connection, storage, owner, now, bytes, source: source(bytes, fill) });
        return { id: hex(legacy.id), bytes, mime: "video/mp4", storageKey: legacy.storageKey, expected };
      }
      const ticket = await videoService.admitUpload(owner.role, owner.token, { bytes, mime: "video/mp4" });
      const asset = await videoService.upload(owner.role, owner.token, ticket, source(bytes, fill));
      const row = (await connection.query("SELECT storage_key FROM video_assets WHERE id = ?", [Buffer.from(asset.id, "hex")]))[0];
      return { ...asset, storageKey: row.storage_key, expected };
    }
    async function send(owner, conversationId, asset, caption) {
      if (owner.role === "client") return (await seedLegacyClientVideoMessage({ chatStore: chat, owner, conversationId, asset: { ...asset, id: Buffer.from(asset.id, "hex") }, caption, key: messageKey, now })).message;
      return (await chatService.sendVideo(owner.role, owner.token, hex(conversationId), { clientMessageId: hex(id()), videoId: asset.id, caption })).message;
    }
    const shared = await upload(admin, 0x51), adminUndelivered = await upload(admin, 0x52), deletedAsset = await upload(admin, 0x53);
    const ownFirst = await upload(first, 0x61), libraryFirst = await upload(first, 0x62), ownSecond = await upload(second, 0x71);
    const sharedDelivery = await send(admin, firstConversation, shared, "Shared first caption 🎥");
    await send(first, firstConversation, ownFirst, "Own first caption"); await send(first, firstConversation, ownFirst, "Same original, second caption");
    const tombstone = await send(admin, firstConversation, deletedAsset, "Removed caption must never escape");
    await chatService.delete("admin", admin.token, hex(firstConversation), tombstone.id);
    await send(admin, secondConversation, shared, "Shared second-client caption"); await send(second, secondConversation, ownSecond, "Private second video caption");
    async function businessState() {
      const hash = createHash("sha256");
      for (const table of ["messages", "message_video", "chat_events", "video_assets", "video_storage_state"]) {
        const rows = await connection.query("SELECT * FROM " + table);
        const serialized = rows.map((row) => JSON.stringify(Object.fromEntries(Object.keys(row).sort().map((name) => [name, row[name]])),
          (_name, value) => typeof value === "bigint" ? value.toString() : value)).sort();
        hash.update(table).update(JSON.stringify(serialized));
      }
      const files = [];
      for (const name of (await readdir(root)).sort()) files.push({ name, ...(await hashFile(path.join(root, name))) });
      return { sql: hash.digest("hex"), files, held: String((await connection.query("SELECT held_bytes FROM video_storage_state WHERE id = 1"))[0].held_bytes) };
    }
    const unchanged = await businessState();
    async function valid(result, assets) {
      assert.equal(result.response.status, 200); assert.equal(result.complete, true);
      assert.equal(result.response.headers.get("content-type"), "application/zip");
      assert.equal(result.response.headers.get("content-length"), String(result.received));
      assert.match(result.response.headers.get("cache-control"), /no-store/); assert.equal(result.response.headers.get("set-cookie"), null);
      const entries = await readZip(result.filename), expected = new Map(assets.map((asset) => ["videos/" + asset.id + ".mp4", asset.expected]));
      assert.deepEqual([...entries.keys()].filter((name) => name.endsWith(".mp4")).sort(), [...expected.keys()].sort());
      for (const [name, digest] of expected) assert.deepEqual(entries.get(name), digest);
      const document = JSON.parse(entries.get("conversation.json").text);
      assert.equal(document.format, "jessiemessage-conversation"); assert.equal(document.version, 2); assert.equal(document.includeVideos, true);
      assert.equal(document.includePhotos, false);
      for (const message of document.messages) if (message.video) assert.equal(Object.hasOwn(message.video, "sha256"), false);
      const text = [entries.get("conversation.json").text, entries.get("Conversation.html").text, entries.get("LIRE-MOI.txt").text].join("\n");
      assert.match(entries.get("Conversation.html").text, /<video controls/);
      return { entries, document, text };
    }
    async function truncated(result) {
      assert.equal(result.response.status, 200); assert.equal(result.complete, false); assert.ok(result.received > 0);
      assert.ok(result.received < Number(result.response.headers.get("content-length")));
      await assert.rejects(readZip(result.filename));
    }

    await t.test("client HTTP ZIP deduplicates delivered originals, preserves captions and tombstones, and excludes every private library", async () => {
      const before = opens.length, result = await download(first, firstConversation), content = await valid(result, [shared, ownFirst]);
      assert.equal(opens.length - before, 2);
      assert.deepEqual(content.document.messages.map((row) => row.body), ["Shared first caption 🎥", "Own first caption", "Same original, second caption", ""]);
      assert.equal(content.document.messages[1].video.file, content.document.messages[2].video.file);
      assert.equal(content.document.messages[0].video.file, "videos/" + shared.id + ".mp4");
      assert.ok(content.document.messages[3].deletedAt); assert.equal(content.document.messages[3].video, undefined);
      for (const asset of [libraryFirst, ownSecond, adminUndelivered, deletedAsset]) assert.equal(content.text.includes(asset.id), false);
      assert.equal(content.text.includes("Shared second-client caption"), false); assert.equal(content.text.includes("Removed caption must never escape"), false);
      for (const asset of [shared, ownFirst]) assert.equal(content.text.includes(hex(asset.storageKey)), false);
      assert.deepEqual(await businessState(), unchanged);
    });
    await t.test("administrator and second-client HTTP archives use real authorization and the same conversation-only boundary", async () => {
      now += 31000;
      const adminContent = await valid(await download(admin, firstConversation), [shared, ownFirst]);
      assert.deepEqual(adminContent.document.messages.map((row) => row.sender), ["me", "peer", "peer", "me"]);
      const secondContent = await valid(await download(second, secondConversation), [shared, ownSecond]);
      assert.deepEqual(secondContent.document.messages.map((row) => row.body), ["Shared second-client caption", "Private second video caption"]);
      assert.equal(secondContent.text.includes(ownFirst.id), false); assert.equal(secondContent.text.includes(libraryFirst.id), false);
      assert.deepEqual(await businessState(), unchanged);
    });
    await t.test("cookies, Origin, CSRF, exact opt-in shape and conversation ownership fail before any video read", async () => {
      const before = opens.length;
      for (const [owner, cid, options, status] of [
        [first, firstConversation, { headers: { Cookie: "" } }, 401],
        [first, firstConversation, { headers: { Cookie: admin.cookie } }, 401],
        [first, firstConversation, { headers: { Origin: "https://foreign.invalid" } }, 403],
        [first, firstConversation, { headers: { "X-CSRF-Token": newToken() } }, 403],
        [first, secondConversation, {}, 404],
        [first, firstConversation, { suffix: "?client=" + hex(second.id) }, 400],
        [first, firstConversation, { body: { includePhotos: false, includeVideos: "true" } }, 400],
        [first, firstConversation, { body: { includePhotos: false, includeVideos: true, clientId: hex(second.id) } }, 400],
        [admin, firstConversation, { headers: { "X-CSRF-Token": newToken() } }, 403],
        [admin, id(), {}, 404],
        [first, firstConversation, { method: "GET" }, 405],
      ]) {
        const result = await download(owner, cid, options); assert.equal(result.response.status, status);
        assert.equal(result.response.headers.get("content-disposition"), null); assert.equal(result.response.headers.get("set-cookie"), null);
      }
      assert.equal(opens.length, before); assert.deepEqual(await businessState(), unchanged);
    });
    await t.test("an unauthentic second GCM block truncates HTTP and never produces a valid ZIP footer", async () => {
      now += 31000;
      const filename = path.join(root, hex(shared.storageKey) + ".video.enc"), offset = 48 + VIDEO_BLOCK_BYTES + 16 + 7;
      let handle = await open(filename, "r+"); const original = Buffer.alloc(1);
      try {
        assert.equal((await handle.read(original, 0, 1, offset)).bytesRead, 1);
        assert.equal((await handle.write(Buffer.from([original[0] ^ 0x80]), 0, 1, offset)).bytesWritten, 1); await handle.sync(); await handle.close(); handle = null;
        const corrupted = await businessState();
        await truncated(await download(first, firstConversation));
        assert.deepEqual(await businessState(), corrupted, "archive failure must not repair files, change links or refund capacity");
      } finally {
        if (!handle) handle = await open(filename, "r+");
        try { await handle.write(original, 0, 1, offset); await handle.sync(); } finally { await handle.close(); }
      }
      assert.deepEqual(await businessState(), unchanged);
    });
    await t.test("deletion and revocation after preparation are rechecked before the first video read", async () => {
      now += 31000; let afterDeletion;
      beforeVideoOpen = async ({ role, cid, mid }) => {
        assert.equal(role, "client"); assert.equal(cid, hex(firstConversation)); assert.equal(mid, sharedDelivery.id);
        await chatService.delete("admin", admin.token, cid, mid); afterDeletion = await businessState();
      };
      await truncated(await download(first, firstConversation)); assert.ok(afterDeletion); assert.equal(beforeVideoOpen, null);
      assert.deepEqual(await businessState(), afterDeletion); assert.deepEqual(afterDeletion.files, unchanged.files); assert.equal(afterDeletion.held, unchanged.held);
      await assert.rejects(videoService.openMessage("client", first.token, hex(firstConversation), sharedDelivery.id), (error) => error.code === "VIDEO_NOT_FOUND");
      now += 31000; let afterRevocation;
      beforeVideoOpen = async ({ role, cid }) => {
        assert.equal(role, "client"); assert.equal(cid, hex(secondConversation));
        await connection.query("UPDATE sessions SET revoked_at = ? WHERE id = ?", [sql(now), second.sessionId]); afterRevocation = await businessState();
      };
      await truncated(await download(second, secondConversation)); assert.ok(afterRevocation); assert.equal(beforeVideoOpen, null);
      assert.deepEqual(await businessState(), afterRevocation); assert.deepEqual(afterRevocation.files, unchanged.files); assert.equal(afterRevocation.held, unchanged.held);
      const denied = await download(second, secondConversation); assert.equal(denied.response.status, 401); assert.equal(denied.response.headers.get("content-disposition"), null);
      await assert.rejects(videoService.open("client", first.token, shared.id), (error) => error.code === "VIDEO_NOT_FOUND");
      assert.deepEqual(await businessState(), afterRevocation);
    });
    assert.equal((await loadMigrations()).length, 33);
  } finally {
    for (const handler of handlers) handler.close?.();
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    await pool?.end();
    try { await reset(); } finally { await connection.end(); if (directory) await rm(directory, { recursive: true, force: true }); }
  }
});
