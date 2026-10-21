// Candidate-only operator export qualification. No runtime route, migration
// promotion, production data or hosted storage is involved.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { encryptMessageBody, videoMessageFingerprint } from "../server/chat/crypto.mjs";
import { withClientData } from "../server/data/store.mjs";
import { exportClientContent } from "../server/data/export.mjs";
import { createDataWriter } from "../server/data/writer.mjs";
import { createVideoStore } from "../server/video/store.mjs";
import { createVideoMessageStore } from "../server/video/message-store.mjs";
import { createVideoDataReader } from "../server/video/data-store.mjs";
import { loadVideoMigrations } from "../server/video/migrations.mjs";
import { createVideoStorage, VIDEO_BLOCK_BYTES, videoStoredBytes } from "../server/video/storage.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import { mp4Source } from "./helpers/video-transport-fixture.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16), key = () => randomBytes(32), hex = (value) => value.toString("hex");
const sql = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
async function streamHash(source) {
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of source) { hash.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: hash.digest("hex") };
}
const hashFile = (name) => streamHash(createReadStream(name, { highWaterMark: 65536 }));
const jsonFile = async (name) => JSON.parse(await readFile(name, "utf8"));
const jsonLines = async (name) => (await readFile(name, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
async function* source(bytes, fill) {
  let offset = 0;
  for await (const chunk of mp4Source(bytes)) {
    chunk.fill(fill, Math.max(0, 32 - offset)); offset += chunk.length; yield chunk;
  }
}

test("real read-only MariaDB client video exports stream authenticated files without changing SQL or source capacity", {
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
  const tables = createdMigrationTables(candidates), allowed = [...tables].reverse().concat(["migration_probe", "schema_migrations"]);
  const connection = await connectDatabase(); let pool, directory;
  const now = Date.UTC(2026, 9, 21, 12), clock = () => now, created = sql(now - 1000), messageKey = key();
  async function reset() {
    const actual = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(actual.every((row) => allowed.includes(row.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowed) await connection.query("DROP TABLE IF EXISTS " + table);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations: base });
    pool = await createRuntimePool(process.env);
    assert.equal(await createChatStore(pool, { clock }).assertSchema(), true, "qualify unchanged schema 33 before candidates");
    await applyMigrations(connection, { database: options.database, migrations: candidates });
    assert.equal((await loadMigrations()).length, 33, "export qualification does not promote candidates");
    const audit = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(audit, { recursive: true, mode: 0o700 });
    directory = await mkdtemp(path.join(audit, "video-data-native-"));
    const root = path.join(directory, "source-video"), exports = path.join(directory, "exports");
    await mkdir(root, { mode: 0o700 }); await mkdir(exports, { mode: 0o700 });
    const storage = await createVideoStorage({ root, key: key() });
    const capacity = { ownerBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, rootFingerprint: key() };
    let messages;
    const chat = createChatStore(pool, { clock, decorateMessages: (...args) => messages.decorateMessages(...args) });
    const catalog = createVideoStore({ pool, chatStore: chat, capacity });
    messages = createVideoMessageStore({ pool, chatStore: chat, videoStore: catalog });
    assert.equal(await messages.assertSchema(), true); await catalog.initialize({ now, offline: true });

    async function user(role, label) {
      const owner = { id: id(), role, sessionId: id(), token: newToken() }; owner.tokenHash = tokenDigest(owner.token);
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at,
        age_assured_at, access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?, ?)`,
      [owner.id, role, "Synthetic " + label, label + "@example.invalid", created, created, created, created, created]);
      if (role === "admin") await connection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, 'synthetic', 1, 1, ?)", [owner.id, created]);
      else {
        await connection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [owner.id, created]);
        await consumeSyntheticInvitation(connection, owner.id, now - 1000);
      }
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
        [owner.sessionId, owner.id, owner.tokenHash, created, sql(now + 3600000)]);
      await connection.query(role === "admin"
        ? "INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)"
        : "INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)",
      role === "admin" ? [owner.sessionId, created, created] : [owner.sessionId, created]);
      return owner;
    }
    const admin = await user("admin", "video-peer"), first = await user("client", "video-first"), second = await user("client", "video-second");
    const firstConversation = id(), secondConversation = id();
    await connection.query("INSERT INTO conversations (id, admin_id, client_id, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      [firstConversation, admin.id, first.id, created, secondConversation, admin.id, second.id, created]);
    const actor = (owner) => ({ role: owner.role, tokenHash: owner.tokenHash, now });
    async function upload(owner, fill) {
      const value = { id: id(), storageKey: key(), bytes: VIDEO_BLOCK_BYTES * 2 + 57, mime: "video/mp4" };
      value.storedBytes = videoStoredBytes(value.bytes);
      const expected = await streamHash(source(value.bytes, fill));
      await catalog.reserve({ ...actor(owner), asset: value });
      const saved = await storage.put({ assetId: value.id, storageKey: value.storageKey, bytes: value.bytes, source: source(value.bytes, fill) });
      assert.equal(hex(saved.digest), expected.sha256);
      await catalog.commit({ ...actor(owner), asset: { ...value, digest: saved.digest } });
      return { ...value, expected };
    }
    async function send(owner, conversationId, asset, caption) {
      const messageId = id(), binding = { messageId, conversationId, senderId: owner.id };
      const body = JSON.stringify({ videoId: hex(asset.id), caption });
      const result = await messages.sendMessage({ ...actor(owner), conversationId, message: {
        id: messageId, clientMessageId: id(), videoId: asset.id,
        bodyEncrypted: encryptMessageBody(body, messageKey, binding), bodyFingerprint: videoMessageFingerprint(body, messageKey, binding),
      } });
      assert.equal(result.duplicate, false); return result.message;
    }
    const shared = await upload(admin, 0x51), adminUndelivered = await upload(admin, 0x52), deletedDelivery = await upload(admin, 0x53);
    const ownFirst = await upload(first, 0x61), unusedFirst = await upload(first, 0x62), ownSecond = await upload(second, 0x71);
    await send(admin, firstConversation, shared, "Shared with the first client 🎥");
    await send(first, firstConversation, ownFirst, "First own caption");
    await send(first, firstConversation, ownFirst, "Same original, another caption");
    const removed = await send(admin, firstConversation, deletedDelivery, "Removed caption must not escape");
    await chat.deleteMessage({ ...actor(admin), conversationId: firstConversation, messageId: removed.id });
    await send(admin, secondConversation, shared, "Private second-client caption");
    await send(second, secondConversation, ownSecond, "Second own caption");
    // Retained client content is exportable by the operator after access expiry;
    // no new session or conversation permission is granted by this reader.
    await connection.query("UPDATE users SET access_expires_at = ? WHERE id = ?", [sql(now - 1), first.id]);

    async function sourceState() {
      const hash = createHash("sha256");
      for (const table of [...tables, "schema_migrations"].sort()) {
        const rows = await connection.query("SELECT * FROM " + table);
        const serialized = rows.map((row) => JSON.stringify(Object.fromEntries(Object.keys(row).sort().map((name) => [name, row[name]])),
          (_name, value) => typeof value === "bigint" ? value.toString() : value)).sort();
        hash.update(table).update(JSON.stringify(serialized));
      }
      const files = [];
      for (const name of (await readdir(root)).sort()) files.push({ name, ...(await hashFile(path.join(root, name))) });
      const held = (await connection.query("SELECT held_bytes FROM video_storage_state WHERE id = 1"))[0].held_bytes;
      return { sql: hash.digest("hex"), held: String(held), files };
    }
    const unchanged = await sourceState();
    const readVideo = createVideoDataReader();
    let exportNumber = 0;
    function observedPool({ loseCommitAck = false, denyWrite = false } = {}) {
      const observed = { commits: 0, lost: 0, readOnly: false, deniedWrite: false, queries: [] };
      return { observed, async getConnection() {
        const native = await pool.getConnection();
        return new Proxy(native, { get(target, name) {
          if (name === "query") return async (...args) => {
            observed.queries.push(args[0]);
            const result = await target.query(...args);
            if (args[0] === "START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT") {
              observed.readOnly = true;
              if (denyWrite) {
                await assert.rejects(target.query("UPDATE users SET pseudonym = 'forbidden video export write' WHERE id = ?", [first.id]));
                observed.deniedWrite = true;
              }
            }
            return result;
          };
          if (name === "commit") return async () => {
            await target.commit(); observed.commits++;
            if (loseCommitAck) { observed.lost++; throw new Error("synthetic read-only commit acknowledgement lost after actual COMMIT"); }
          };
          const value = target[name]; return typeof value === "function" ? value.bind(target) : value;
        } });
      } };
    }
    async function exportTo({ client = first, selectedPool = observedPool(), videoStorage = storage, signal } = {}) {
      const output = path.join(exports, "export-" + (++exportNumber));
      const writer = await createDataWriter({ output, protectedRoots: [root], video: true });
      try {
        const counts = await withClientData({ pool: selectedPool, clientId: client.id, now, video: readVideo },
          (reader) => exportClientContent({ reader, writer, clientId: client.id, now, messageKey, videoStorage, signal }));
        assert.equal(selectedPool.observed.commits, 1, "completion follows successful native read-only COMMIT");
        await writer.finalize(counts);
        return { output, counts, observed: selectedPool.observed };
      } catch (error) { error.syntheticOutput = output; throw error; }
      finally { await writer.close(); }
    }
    async function incomplete(operation) {
      let output;
      await assert.rejects(operation, (error) => {
        assert.ok(["DATA_EXPORT_UNAVAILABLE", "DATA_STORE_UNAVAILABLE"].includes(error.code));
        output = error.syntheticOutput; return true;
      });
      assert.ok(output); assert.equal((await readdir(output)).includes("COMPLETE.json"), false);
      return output;
    }
    async function checkExport(result, assets) {
      const complete = await jsonFile(path.join(result.output, "COMPLETE.json"));
      assert.equal(complete.format, "jessiemessage-private-export"); assert.equal(complete.version, 2); assert.equal(complete.status, "complete");
      assert.equal((await jsonFile(path.join(result.output, "account.json"))).version, 2);
      const expected = new Map(assets.map((asset) => ["media/" + hex(asset.id) + ".mp4", asset.expected]));
      const videos = complete.entries.filter((entry) => entry.name.endsWith(".mp4"));
      assert.deepEqual(videos.map((entry) => entry.name).sort(), [...expected.keys()].sort());
      for (const entry of complete.entries) {
        assert.deepEqual(await hashFile(path.join(result.output, entry.name)), { bytes: entry.bytes, sha256: entry.sha256 });
        if (expected.has(entry.name)) assert.deepEqual({ bytes: entry.bytes, sha256: entry.sha256 }, expected.get(entry.name));
      }
      assert.deepEqual((await readdir(path.join(result.output, "media"))).sort(), [...expected.keys()].map((name) => name.slice(6)).sort());
      for (const asset of assets) assert.equal((await stat(path.join(result.output, "media", hex(asset.id) + ".mp4"))).mode & 0o777, 0o600);
      assert.equal(result.counts.videoFiles, assets.length); assert.equal(result.counts.mediaFiles, assets.length);
      assert.equal(result.counts.videoBytes, assets.reduce((sum, asset) => sum + asset.bytes, 0));
      assert.equal(result.counts.mediaBytes, result.counts.videoBytes);
      return { complete, messages: await jsonLines(path.join(result.output, "messages.jsonl")), library: await jsonLines(path.join(result.output, "library.jsonl")) };
    }

    await t.test("candidate video reader shares the native read-only snapshot and never returns another client's library", async () => {
      const selectedPool = observedPool({ denyWrite: true }); let retained;
      await withClientData({ pool: selectedPool, clientId: first.id, now, video: readVideo }, async (reader) => {
        retained = reader;
        const rows = (await reader.messages()).rows;
        assert.equal(rows.length, 4); assert.ok(rows[0].video.id.equals(shared.id));
        assert.ok(rows[1].video.id.equals(ownFirst.id)); assert.ok(rows[2].video.id.equals(ownFirst.id));
        assert.equal(rows[3].video, null); assert.equal(rows[3].encrypted, null);
        const own = await reader.ownVideos();
        assert.deepEqual(own.rows.map((value) => hex(value.id)).sort(), [ownFirst, unusedFirst].map((value) => hex(value.id)).sort());
        assert.equal(own.hasMore, false); assert.equal(own.nextCursor, null);
      });
      assert.equal(selectedPool.observed.readOnly, true); assert.equal(selectedPool.observed.deniedWrite, true);
      assert.equal(selectedPool.observed.commits, 1);
      assert.ok(selectedPool.observed.queries.every((query) => !/\bFOR\s+UPDATE\b/i.test(query)));
      await assert.rejects(retained.ownVideos(), (error) => error.code === "DATA_STORE_UNAVAILABLE");
      assert.deepEqual(await sourceState(), unchanged);
    });
    await t.test("version two export deduplicates original streams, keeps captions and tombstones, and excludes foreign or undelivered originals", async () => {
      const result = await exportTo(), content = await checkExport(result, [shared, ownFirst, unusedFirst]);
      assert.equal(result.counts.messages, 4); assert.equal(result.counts.videoLibraryItems, 2); assert.equal(result.counts.libraryItems, 2);
      assert.deepEqual(content.messages.map((row) => row.body), ["Shared with the first client 🎥", "First own caption", "Same original, another caption", null]);
      assert.deepEqual(content.messages.map((row) => row.sender), ["peer", "me", "me", "peer"]);
      assert.equal(content.messages[1].video.file, content.messages[2].video.file);
      assert.deepEqual(content.messages[0].video, { file: "media/" + hex(shared.id) + ".mp4", type: "video/mp4", bytes: shared.bytes });
      assert.equal(content.messages[3].video, null); assert.ok(content.messages[3].deletedAt);
      assert.deepEqual(content.library.map((row) => row.file).sort(), [ownFirst, unusedFirst].map((asset) => "media/" + hex(asset.id) + ".mp4").sort());
      const metadata = JSON.stringify(content);
      for (const asset of [ownSecond, adminUndelivered, deletedDelivery]) assert.equal(metadata.includes(hex(asset.id)), false);
      assert.equal(metadata.includes("Private second-client caption"), false); assert.equal(metadata.includes("Removed caption must not escape"), false);
      for (const asset of [shared, ownFirst, unusedFirst]) assert.equal(metadata.includes(hex(asset.storageKey)), false);
      assert.deepEqual(await sourceState(), unchanged);
    });
    await t.test("the second client gets its own library and shared delivery without the first client's videos or captions", async () => {
      const result = await exportTo({ client: second }), content = await checkExport(result, [shared, ownSecond]);
      assert.equal(result.counts.messages, 2); assert.equal(result.counts.videoLibraryItems, 1); assert.equal(result.counts.libraryItems, 1);
      assert.deepEqual(content.messages.map((row) => row.body), ["Private second-client caption", "Second own caption"]);
      assert.deepEqual(content.library.map((row) => row.file), ["media/" + hex(ownSecond.id) + ".mp4"]);
      const metadata = JSON.stringify(content);
      for (const asset of [ownFirst, unusedFirst, adminUndelivered, deletedDelivery]) assert.equal(metadata.includes(hex(asset.id)), false);
      assert.equal(metadata.includes("First own caption"), false);
      assert.deepEqual(await sourceState(), unchanged);
    });
    await t.test("interrupted streams and an unauthentic second block leave no completion marker or source mutation", async () => {
      const controller = new AbortController(); let yielded = 0;
      const interrupted = { ...storage, async open(value) {
        const handle = await storage.open(value);
        return { ...handle, async *stream(options) {
          for await (const chunk of handle.stream(options)) { yielded++; yield chunk; controller.abort(); }
        } };
      } };
      await incomplete(() => exportTo({ videoStorage: interrupted, signal: controller.signal }));
      assert.equal(yielded, 1); assert.deepEqual(await sourceState(), unchanged);

      const filename = path.join(root, hex(shared.storageKey) + ".video.enc"), offset = 48 + VIDEO_BLOCK_BYTES + 16 + 7;
      const original = Buffer.alloc(1); let handle;
      try {
        handle = await open(filename, "r+"); assert.equal((await handle.read(original, 0, 1, offset)).bytesRead, 1);
        const changed = Buffer.from([original[0] ^ 0x80]); assert.equal((await handle.write(changed, 0, 1, offset)).bytesWritten, 1);
        await handle.sync(); await handle.close(); handle = null;
        const corrupted = await sourceState(); assert.notDeepEqual(corrupted.files, unchanged.files);
        await incomplete(() => exportTo()); assert.deepEqual(await sourceState(), corrupted, "export does not repair, erase or refund a corrupt source");
      } finally {
        if (!handle) handle = await open(filename, "r+");
        try { assert.equal((await handle.write(original, 0, 1, offset)).bytesWritten, 1); await handle.sync(); }
        finally { await handle.close(); }
      }
      assert.deepEqual(await sourceState(), unchanged);
    });
    await t.test("a lost acknowledgement after the real read-only COMMIT cannot publish COMPLETE and a fresh export still succeeds", async () => {
      const selectedPool = observedPool({ loseCommitAck: true });
      const output = await incomplete(() => exportTo({ selectedPool }));
      assert.equal(selectedPool.observed.commits, 1); assert.equal(selectedPool.observed.lost, 1);
      const files = await readdir(path.join(output, "media")); assert.equal(files.filter((name) => name.endsWith(".mp4")).length, 3);
      assert.deepEqual(await sourceState(), unchanged);
      await checkExport(await exportTo(), [shared, ownFirst, unusedFirst]);
      assert.deepEqual(await sourceState(), unchanged);
    });
  } finally {
    await pool?.end();
    try { await reset(); } finally { await connection.end(); if (directory) await rm(directory, { recursive: true, force: true }); }
  }
});
