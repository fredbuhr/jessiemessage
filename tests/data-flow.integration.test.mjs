import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, lstat, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { withClientData, DataStoreError } from "../server/data/store.mjs";
import { DATA_POLICY } from "../server/data/policy.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { encryptMessageBody, messageFingerprint } from "../server/chat/crypto.mjs";
import { main as exportMain } from "../scripts/data-export.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16);
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const unavailable = (error) => error instanceof DataStoreError && error.code === "DATA_STORE_UNAVAILABLE";

test("offline client content reader isolates two real MariaDB clients in one read-only snapshot (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 120000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "separately provisioned runtime DML credentials are required");
  const migrations = await loadMigrations(); assert.equal(migrations.length, 33);
  const allowedTables = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  assert.deepEqual([...DATA_POLICY.map((entry) => entry.table)].sort(), allowedTables.filter((table) => !["schema_migrations", "migration_probe"].includes(table)).sort());
  const connection = await connectDatabase(); let pool;
  async function cleanup() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await cleanup(); await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const now = Date.parse("2026-10-15T08:00:00Z"), created = sqlDate(now - 3600000), deleted = sqlDate(now - 1800000);
    const admin = id(), first = id(), second = id(), firstConv = id(), secondConv = id();
    const shared = id(), unused = id(), tombstonedDeliveryAsset = id(), otherLibrary = id();
    async function user(userId, role, pseudonym, email, expiry) {
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash,
        email_verified_at, age_assured_at, access_approved_at, access_expires_at, created_at, updated_at)
        VALUES (?, ?, 'active', ?, ?, 'synthetic-password-hash-not-exported', ?, ?, ?, ?, ?, ?)`,
      [userId, role, pseudonym, email, created, created, created, expiry, created, created]);
      if (role === "client") await connection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [userId, created]);
    }
    await user(admin, "admin", "Synthetic peer", "admin-secret@example.invalid", null);
    await user(first, "client", "Synthetic first client", "first@example.invalid", sqlDate(now - 60000));
    await user(second, "client", "Synthetic second client", "second-secret@example.invalid", sqlDate(now + 3600000));
    await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      [firstConv, first, admin, created, secondConv, second, admin, created]);
    async function asset(assetId, owner, role) {
      const storageKey = randomBytes(32), digest = randomBytes(32);
      await connection.query(`INSERT INTO media_assets (id, owner_id, owner_role, storage_key, content_digest, active_digest,
        width, height, thumbnail_width, thumbnail_height, full_bytes, thumbnail_bytes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 100, 80, 50, 40, 400, 100, ?)`, [assetId, owner, role, storageKey, digest, digest, created]);
      await connection.query(`INSERT INTO media_storage_objects (id, owner_id, owner_role, storage_key, content_digest,
        full_bytes, thumbnail_bytes, stored_bytes, state, asset_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 400, 100, 580, 'registered', ?, ?, ?)`, [assetId, owner, role, storageKey, digest, assetId, created, created]);
    }
    await asset(shared, admin, "admin"); await asset(unused, first, "client");
    await asset(tombstonedDeliveryAsset, first, "client"); await asset(otherLibrary, second, "client");
    await connection.query(`INSERT INTO user_profiles (user_id, avatar_media_id, version, created_at, updated_at)
      VALUES (?, ?, 3, ?, ?), (?, ?, 7, ?, ?)`, [first, unused, created, created, second, otherLibrary, created, created]);
    await connection.query(`INSERT INTO media_storage_state (id, owner_bytes, total_bytes, root_fingerprint, held_bytes, initialized_at)
      VALUES (1, 1048576, 2097152, ?, 2320, ?)`, [randomBytes(32), created]);
    async function message(conv, sender, role, seq, mediaId = null, isDeleted = false) {
      const messageId = id();
      await connection.query(`INSERT INTO messages (id, conversation_id, sequence_no, sender_id, sender_role, client_message_id,
        body_encrypted, body_fingerprint, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [messageId, conv, String(seq), sender, role, id(), isDeleted ? null : "synthetic-ciphertext-only", randomBytes(32), created, isDeleted ? deleted : null]);
      if (mediaId !== null) await connection.query("INSERT INTO message_media (message_id, conversation_id, media_id, created_at) VALUES (?, ?, ?, ?)", [messageId, conv, mediaId, created]);
      return messageId;
    }
    const visibleSharedMessage = await message(firstConv, admin, "admin", 1, shared);
    await message(firstConv, admin, "admin", 2, shared, true);
    await message(firstConv, first, "client", 3);
    await message(firstConv, first, "client", 4, tombstonedDeliveryAsset, true);
    const otherMessage = await message(secondConv, admin, "admin", 1, shared);
    await message(secondConv, second, "client", 2);
    await connection.query("INSERT INTO chat_receipts (conversation_id, user_id, last_read_sequence, updated_at) VALUES (?, ?, 3, ?), (?, ?, 4, ?)",
      [firstConv, first, created, firstConv, admin, created]);
    await connection.query("INSERT INTO broadcast_preferences (user_id, enabled, version, created_at, updated_at) VALUES (?, 1, 1, ?, ?)", [first, created, created]);
    const label = id();
    await connection.query(`INSERT INTO crm_profiles (admin_id, conversation_id, nickname, notes_encrypted, version, notes_revision, created_at, updated_at)
      VALUES (?, ?, 'administrator-only-secret-nickname', 'administrator-only-secret-notes', 1, 1, ?, ?),
        (?, ?, 'other-client-private-name', 'other-client-private-notes', 1, 1, ?, ?)`,
    [admin, firstConv, created, created, admin, secondConv, created, created]);
    await connection.query(`INSERT INTO crm_labels (id, owner_admin_id, kind, name, normalized_name, version, created_at, updated_at)
      VALUES (?, ?, 'tag', 'private-label', 'private-label', 1, ?, ?)`, [label, admin, created, created]);
    await connection.query("INSERT INTO crm_memberships (admin_id, conversation_id, label_id, created_at) VALUES (?, ?, ?, ?)", [admin, firstConv, label, created]);

    await t.test("expired retained client receives only its conversation, delivered active media and own unused library", async () => {
      let retained;
      await withClientData({ pool, clientId: first, now }, async (reader) => {
        retained = reader;
        assert.equal(reader.account.email, "first@example.invalid"); assert.equal(reader.account.accessExpiresAt, sqlDate(now - 60000));
        assert.equal(reader.conversation.peerName, "Synthetic peer"); assert.equal(reader.conversation.lastReadSequence, "3");
        assert.equal(reader.conversation.peerReadSequence, "0"); assert.equal(reader.preference.enabled, true);
        assert.ok(reader.ownProfile.avatarMediaId.equals(unused)); assert.equal(reader.ownProfile.version, 3);
        assert.equal(Object.hasOwn(reader.account, "ownProfile"), false);
        const initial = await reader.messages({ limit: 2 });
        assert.equal(initial.hasMore, true); assert.equal(initial.nextCursor, "2");
        assert.ok(initial.rows[0].id.equals(visibleSharedMessage)); assert.ok(initial.rows[0].media.id.equals(shared));
        assert.equal(initial.rows[1].media, null); assert.equal(initial.rows[1].encrypted, null);
        const rest = await reader.messages({ afterSequence: initial.nextCursor, limit: 2 });
        assert.equal(rest.hasMore, false); assert.deepEqual(rest.rows.map((row) => row.sequence), ["3", "4"]);
        assert.equal(rest.rows[1].media, null); assert.equal(rest.rows[1].encrypted, null);
        assert.equal([...initial.rows, ...rest.rows].some((row) => row.id.equals(otherMessage)), false);
        const library = await reader.ownMedia();
        assert.deepEqual(library.rows.map((row) => row.id.toString("hex")).sort(), [unused, tombstonedDeliveryAsset].map((value) => value.toString("hex")).sort());
        assert.equal(library.rows.some((row) => row.id.equals(shared) || row.id.equals(otherLibrary)), false);
        const inventory = await reader.inventory();
        const category = (name) => inventory.find((row) => row.table === name);
        assert.equal(inventory.length, 32); assert.equal(category("messages").count, 4); assert.equal(category("media_assets").count, 2);
        assert.equal(category("user_profiles").count, 1);
        assert.equal(category("crm_profiles").count, 1); assert.equal(category("crm_memberships").count, 1);
        assert.equal(category("crm_labels").count, null); assert.equal(category("admin_mfa").count, null);
        assert.doesNotMatch(JSON.stringify({ account: reader.account, conversation: reader.conversation, preference: reader.preference, inventory }), /second-secret|admin-secret|password-hash|administrator-only|other-client-private|private-label/);
      });
      await assert.rejects(retained.messages(), unavailable);
      await assert.rejects(withClientData({ pool, clientId: admin, now }, () => assert.fail("administrator must not be a client target")), unavailable);
    });
    await t.test("client data snapshot is unchanged when the administrator records a new read receipt", async () => {
      await connection.query("DELETE FROM chat_receipts WHERE conversation_id = ? AND user_id = ?", [firstConv, admin]);
      const read = () => withClientData({ pool, clientId: first, now }, (reader) => reader.conversation);
      const before = await read();
      await connection.query("INSERT INTO chat_receipts (conversation_id, user_id, last_read_sequence, updated_at) VALUES (?, ?, 4, ?)", [firstConv, admin, created]);
      assert.deepEqual(await read(), before);
      assert.equal(before.lastReadSequence, "3");
      assert.equal(before.peerReadSequence, "0");
    });
    await t.test("one SQL snapshot excludes a concurrent new message while the following export sees it", async () => {
      let inserted;
      try {
        await withClientData({ pool, clientId: first, now }, async (reader) => {
          inserted = await message(firstConv, first, "client", 5);
          const rows = await reader.messages(); assert.equal(rows.rows.length, 4);
          assert.equal((await reader.inventory()).find((entry) => entry.table === "messages").count, 4);
        });
        await withClientData({ pool, clientId: first, now }, async (reader) => assert.equal((await reader.messages()).rows.length, 5));
      } finally { if (inserted) await connection.query("DELETE FROM messages WHERE id = ?", [inserted]); }
    });
    await t.test("foreign sender and inconsistent media journal binding fail closed without granting cross-client content", async () => {
      const bad = await message(firstConv, second, "client", 5);
      try { await assert.rejects(withClientData({ pool, clientId: first, now }, (reader) => reader.messages()), unavailable); }
      finally { await connection.query("DELETE FROM messages WHERE id = ?", [bad]); }
      await connection.query("UPDATE media_storage_objects SET owner_id = ? WHERE id = ?", [second, unused]);
      try { await assert.rejects(withClientData({ pool, clientId: first, now }, (reader) => reader.ownMedia()), unavailable); }
      finally { await connection.query("UPDATE media_storage_objects SET owner_id = ? WHERE id = ?", [first, unused]); }
    });
    await t.test("read-only transaction rejects a DML write even though the runtime account otherwise has DML privileges", async () => {
      let writeDenied = false;
      const observedPool = { async getConnection() {
        const runtime = await pool.getConnection();
        return { ...runtime, async query(sql, parameters) {
          const result = await runtime.query(sql, parameters);
          if (sql === "START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT") {
            await assert.rejects(runtime.query("UPDATE users SET pseudonym = 'forbidden write' WHERE id = ?", [first])); writeDenied = true;
          }
          return result;
        } };
      } };
      await withClientData({ pool: observedPool, clientId: first, now }, (reader) => assert.equal(reader.account.pseudonym, "Synthetic first client"));
      assert.equal(writeDenied, true);
    });
    await t.test("subject inventory counts saturate explicitly and do not count the other client's sessions", async () => {
      const expires = sqlDate(now + 3600000);
      for (let offset = 0; offset < 10001; offset += 200) {
        const values = Array.from({ length: Math.min(200, 10001 - offset) }, () => [id(), first, randomBytes(32), created, expires]);
        await connection.query(`INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ${values.map(() => "(?, ?, ?, ?, ?)").join(", ")}`, values.flat());
      }
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [id(), second, randomBytes(32), created, expires]);
      await withClientData({ pool, clientId: first, now }, async (reader) => {
        const sessions = (await reader.inventory()).find((entry) => entry.table === "sessions");
        assert.deepEqual(sessions, { table: "sessions", scope: "subject", count: 10000, truncated: true });
      });
      await withClientData({ pool, clientId: second, now }, async (reader) => {
        const sessions = (await reader.inventory()).find((entry) => entry.table === "sessions"); assert.equal(sessions.count, 1); assert.equal(sessions.truncated, false);
      });
    });
    await t.test("real offline CLI writes authenticated private client files and completion hashes without SQL or source-file mutation", async () => {
      const temporaryBase = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../audit");
      await mkdir(temporaryBase, { recursive: true, mode: 0o700 });
      const temporary = await mkdtemp(path.join(temporaryBase, "data-cli-flow-"));
      const mediaRoot = path.join(temporary, "source-media"), exportParent = path.join(temporary, "exports");
      await mkdir(mediaRoot, { mode: 0o700 }); await mkdir(exportParent, { mode: 0o700 });
      const messageKey = randomBytes(32), mediaKey = randomBytes(32), plaintexts = new Map();
      const hash = (value) => createHash("sha256").update(value).digest("hex");
      try {
        const storage = await createMediaStorage({ root: mediaRoot, key: mediaKey });
        // The selected client has three exportable images. The other client's
        // unrelated library and ciphertext remain deliberately unavailable.
        for (const [assetId, color] of [[shared, "#c05020"], [unused, "#208050"], [tombstonedDeliveryAsset, "#2050a0"]]) {
          const full = await sharp({ create: { width: 3, height: 2, channels: 3, background: color } }).jpeg().toBuffer();
          const source = (await connection.query("SELECT storage_key FROM media_assets WHERE id = ?", [assetId]))[0];
          const contentDigest = createHash("sha256").update(full).digest();
          await storage.put({ assetId, storageKey: source.storage_key, full, thumbnail: full });
          await connection.query(`UPDATE media_assets SET content_digest = ?, active_digest = ?, width = 3, height = 2,
            thumbnail_width = 3, thumbnail_height = 2, full_bytes = ?, thumbnail_bytes = ? WHERE id = ?`,
          [contentDigest, contentDigest, full.length, full.length, assetId]);
          await connection.query(`UPDATE media_storage_objects SET content_digest = ?, full_bytes = ?, thumbnail_bytes = ?, stored_bytes = ? WHERE id = ?`,
            [contentDigest, full.length, full.length, full.length * 2 + 80, assetId]);
          plaintexts.set(assetId.toString("hex"), Buffer.from(full)); full.fill(0);
        }
        await connection.query(`UPDATE media_storage_state SET root_fingerprint = ?, held_bytes =
          (SELECT SUM(stored_bytes) FROM media_storage_objects WHERE state <> 'released') WHERE id = 1`, [await storage.fingerprint()]);
        const textMessage = (await connection.query("SELECT id FROM messages WHERE conversation_id = ? AND sequence_no = 3", [firstConv]))[0].id;
        for (const [messageId, sender, body] of [
          [visibleSharedMessage, admin, JSON.stringify({ mediaId: shared.toString("hex"), caption: "Photo partagée autorisée" })],
          [textMessage, first, "Message privé du client : bonjour 👋"],
        ]) {
          const binding = { messageId, conversationId: firstConv, senderId: sender };
          await connection.query("UPDATE messages SET body_encrypted = ?, body_fingerprint = ? WHERE id = ?", [
            encryptMessageBody(body, messageKey, binding), messageFingerprint(body, messageKey, binding), messageId,
          ]);
        }
        await connection.query("UPDATE messages SET created_at = '2026-10-15 07:00:00.123456' WHERE id = ?", [visibleSharedMessage]);
        async function databaseHash() {
          const accumulator = createHash("sha256");
          for (const table of allowedTables.filter((name) => name !== "migration_probe")) {
            const rows = await connection.query(`SELECT * FROM ${table}`);
            const serialized = rows.map((row) => JSON.stringify(row, (_name, value) => typeof value === "bigint" ? value.toString() : value)).sort();
            accumulator.update(table).update(JSON.stringify(serialized));
          }
          return accumulator.digest("hex");
        }
        async function sourceFiles() {
          const files = [];
          for (const name of (await readdir(mediaRoot)).sort()) {
            const filename = path.join(mediaRoot, name), stat = await lstat(filename);
            assert.equal(stat.mode & 0o7777, 0o600); assert.equal(stat.isFile(), true);
            files.push([name, hash(await readFile(filename))]);
          }
          return files;
        }
        const beforeDatabase = await databaseHash(), beforeFiles = await sourceFiles();
        const environment = { ...process.env, JESSIEMESSAGE_MESSAGE_KEY: messageKey.toString("base64url"),
          JESSIEMESSAGE_MEDIA_KEY: mediaKey.toString("base64url"), JESSIEMESSAGE_MEDIA_ROOT: mediaRoot };
        const output = path.join(exportParent, "client-content");
        const argumentsFor = (command, destination) => [command, "--offline", "--database", options.database, "--client", first.toString("hex"),
          "--confirm-client", first.toString("hex"), "--output", destination];
        const stdout = []; let poolClosures = 0;
        const dependencies = { clock: () => now,
          createPool: async () => ({ getConnection: (...args) => pool.getConnection(...args), async end() { poolClosures++; } }),
          outputStream: { write(value) { stdout.push(value); } },
        };
        const result = await exportMain(argumentsFor("export", output), environment, dependencies);
        const mediaBytes = [...plaintexts.values()].reduce((total, value) => total + value.length, 0);
        assert.deepEqual(result, { command: "export", status: "complete", messages: 4, mediaFiles: 3, libraryItems: 2, mediaBytes, rows: 6 });
        assert.deepEqual(stdout, [JSON.stringify(result) + "\n"]); assert.equal(poolClosures, 1);
        assert.doesNotMatch(stdout.join(""), /example\.invalid|caption|bonjour|Photo|password|token|key|SELECT|\/workspace|[a-f0-9]{32}/);
        const completed = JSON.parse(await readFile(path.join(output, "COMPLETE.json"), "utf8"));
        assert.equal(completed.status, "complete"); assert.equal(completed.entries.length, 6);
        assert.deepEqual(completed.counts, { messages: 4, mediaFiles: 3, libraryItems: 2, mediaBytes, rows: 6 });
        for (const entry of completed.entries) {
          const filename = path.join(output, entry.name), contents = await readFile(filename);
          assert.equal(contents.length, entry.bytes); assert.equal(hash(contents), entry.sha256);
          assert.equal((await lstat(filename)).mode & 0o7777, 0o600);
        }
        assert.equal((await lstat(output)).mode & 0o7777, 0o700);
        assert.equal((await lstat(path.join(output, "media"))).mode & 0o7777, 0o700);
        const accountOutput = JSON.parse(await readFile(path.join(output, "account.json"), "utf8"));
        const messagesOutput = (await readFile(path.join(output, "messages.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
        const libraryOutput = (await readFile(path.join(output, "library.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
        assert.equal(accountOutput.user.email, "first@example.invalid");
        assert.equal(accountOutput.user.createdAt, "2026-10-15T07:00:00.000000Z");
        assert.deepEqual(accountOutput.ownProfile, { avatarMediaId: unused.toString("hex"), version: 3,
          createdAt: "2026-10-15T07:00:00.000000Z", updatedAt: "2026-10-15T07:00:00.000000Z" });
        assert.equal(JSON.stringify(accountOutput).includes(otherLibrary.toString("hex")), false);
        assert.equal(messagesOutput[0].createdAt, "2026-10-15T07:00:00.123456Z");
        assert.equal(messagesOutput[0].body, "Photo partagée autorisée");
        assert.equal(messagesOutput[0].media.file, `media/${shared.toString("hex")}.jpg`);
        assert.equal(messagesOutput[2].body, "Message privé du client : bonjour 👋");
        for (const position of [1, 3]) {
          assert.equal(messagesOutput[position].body, null); assert.equal(messagesOutput[position].media, null);
          assert.equal(messagesOutput[position].deletedAt, "2026-10-15T07:30:00.000000Z");
        }
        assert.deepEqual(libraryOutput.map((value) => value.file).sort(), [unused, tombstonedDeliveryAsset].map((value) => `media/${value.toString("hex")}.jpg`).sort());
        assert.deepEqual((await readdir(path.join(output, "media"))).sort(), [...plaintexts.keys()].map((value) => `${value}.jpg`).sort());
        for (const [assetId, expected] of plaintexts) assert.deepEqual(await readFile(path.join(output, "media", `${assetId}.jpg`)), expected);
        assert.doesNotMatch(JSON.stringify({ accountOutput, messagesOutput, libraryOutput }), /second-secret|admin-secret|password|fingerprint|encrypted|storageKey|digest|administrator-only|other-client-private|private-label/);
        const inventoryOutput = path.join(exportParent, "client-inventory"); stdout.length = 0;
        const inventoryResult = await exportMain(argumentsFor("inventory", inventoryOutput), environment, dependencies);
        assert.deepEqual(inventoryResult, { command: "inventory", status: "complete", inventoryCategories: 32 });
        assert.deepEqual(stdout, [JSON.stringify(inventoryResult) + "\n"]); assert.equal(poolClosures, 2);
        const inventory = JSON.parse(await readFile(path.join(inventoryOutput, "inventory.json"), "utf8"));
        assert.equal(inventory.categories.length, 32);
        assert.deepEqual(inventory.categories.find((value) => value.table === "sessions"), { table: "sessions", scope: "subject", count: 10000, truncated: true });
        assert.equal(JSON.parse(await readFile(path.join(inventoryOutput, "COMPLETE.json"), "utf8")).status, "complete");
        assert.equal(await databaseHash(), beforeDatabase, "CLI changes no application or migration row");
        assert.deepEqual(await sourceFiles(), beforeFiles, "CLI changes no source media file");
      } finally {
        messageKey.fill(0); mediaKey.fill(0); for (const full of plaintexts.values()) full.fill(0);
        await rm(temporary, { recursive: true, force: true });
      }
    });
    await t.test("notification inventories isolate devices and count incoming and outgoing delivery jobs without opening endpoints", async () => {
      const sessionFor = async owner => {
        const existing = (await connection.query("SELECT id FROM sessions WHERE user_id = ? LIMIT 1", [owner]))[0];
        if (existing) return existing.id;
        const sessionId = id(); await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [sessionId, owner, randomBytes(32), created, sqlDate(now + 3600000)]);
        return sessionId;
      };
      const firstSession = await sessionFor(first), secondSession = await sessionFor(second), adminSession = await sessionFor(admin);
      async function subscription(owner, role, sessionId) {
        const subscriptionId = id();
        await connection.query(`INSERT INTO push_subscriptions (id, user_id, role, session_id, credential_version, generation,
          endpoint_digest, subscription_encrypted, locale, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1, ?, 'private-endpoint-ciphertext-never-exported', 'fr', ?, ?)`,
        [subscriptionId, owner, role, sessionId, randomBytes(32), created, created]);
        return subscriptionId;
      }
      const firstDevice = await subscription(first, "client", firstSession), secondDevice = await subscription(second, "client", secondSession), adminDevice = await subscription(admin, "admin", adminSession);
      const outgoing = (await connection.query("SELECT id FROM messages WHERE conversation_id = ? AND sender_id = ? LIMIT 1", [firstConv, first]))[0].id;
      async function job(messageId, subscriptionId, status = "pending") {
        const jobId = id();
        await connection.query(`INSERT INTO push_outbox (id, message_id, subscription_id, subscription_generation, status, attempts,
          available_at, created_at, expires_at, lease_token, lease_until) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        [jobId, messageId, subscriptionId, status, status === "sending" ? 1 : 0, created, created, sqlDate(now + 3600000),
          status === "sending" ? id() : null, status === "sending" ? sqlDate(now + 120000) : null]);
        return jobId;
      }
      await job(visibleSharedMessage, firstDevice); await job(otherMessage, secondDevice); await job(outgoing, adminDevice, "sending");
      for (const [clientId, expectedJobs] of [[first, 2], [second, 1]]) {
        await withClientData({ pool, clientId, now }, async reader => {
          const inventory = await reader.inventory(), facts = await reader.deletionFacts(), count = name => facts.find(item => item.name === name).count;
          assert.equal(inventory.find(item => item.table === "push_subscriptions").count, 1);
          assert.equal(inventory.find(item => item.table === "push_outbox").count, expectedJobs);
          assert.equal(count("notificationSubscriptionsEnabled"), 1); assert.equal(count("pushPending"), 1);
          assert.equal(count("pushSending"), clientId === first ? 1 : 0); assert.equal(count("foreignPushBindings"), 0);
          assert.doesNotMatch(JSON.stringify({ inventory, facts }), /endpoint|ciphertext|subscriptionId|lease_token|p256dh|private-/);
        });
      }
      // A session FK alone does not bind the subscription to its owner. The
      // offline review must flag this schema-valid cross-account association.
      await connection.query("UPDATE push_subscriptions SET session_id = ? WHERE id = ?", [secondSession, firstDevice]);
      try {
        await withClientData({ pool, clientId: first, now }, async reader => {
          assert.equal((await reader.deletionFacts()).find(item => item.name === "foreignPushBindings").count, 1);
        });
      } finally { await connection.query("UPDATE push_subscriptions SET session_id = ? WHERE id = ?", [firstSession, firstDevice]); }
    });
  } finally {
    try { await pool?.end(); }
    finally { try { await cleanup(); } finally { await connection.end(); } }
  }
});
