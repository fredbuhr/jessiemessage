import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, lstat, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { withClientData } from "../server/data/store.mjs";
import { DELETION_FACT_NAMES } from "../server/data/deletion-store.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const id = () => randomBytes(16);
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const hash = (value) => createHash("sha256").update(value).digest("hex");

test("offline deletion facts and operator plan inspect real reference graphs without SQL or filesystem mutation (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 120000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "separately provisioned runtime DML credentials are required");
  const migrations = await loadMigrations(); assert.equal(migrations.length, 33);
  const allowedTables = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool;
  async function cleanup() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  async function databaseHash() {
    const digest = createHash("sha256");
    for (const table of allowedTables.filter((name) => name !== "migration_probe")) {
      const rows = await connection.query(`SELECT * FROM ${table}`);
      digest.update(table).update(JSON.stringify(rows.map((row) => JSON.stringify(row, (_key, value) => typeof value === "bigint" ? value.toString() : value)).sort()));
    }
    return digest.digest("hex");
  }
  try {
    await cleanup(); await applyMigrations(connection, { database: options.database, migrations }); pool = await createRuntimePool(process.env);
    const now = Date.parse("2026-10-15T08:00:00Z"), created = sqlDate(now - 60000), expiry = sqlDate(now + 600000);
    const admin = id(), first = id(), second = id(), noConversation = id(), firstConv = id(), secondConv = id();
    for (const [userId, role, name] of [[admin, "admin", "administrator"], [first, "client", "first"], [second, "client", "second"], [noConversation, "client", "unassigned"]]) {
      await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'synthetic-private-password-hash', ?, ?)`, [userId, role, role === "admin" ? "active" : "pending", `Private ${name}`, `${name}-secret@example.invalid`, created, created]);
      if (role === "client") await connection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [userId, created]);
    }
    await connection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)",
      [firstConv, first, admin, created, secondConv, second, admin, created]);
    async function session(owner, { expired = false, revoked = false } = {}) {
      const sessionId = id();
      await connection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)",
        [sessionId, owner, randomBytes(32), created, expired ? sqlDate(now - 1) : expiry, revoked ? created : null]);
      return sessionId;
    }
    const firstSession = await session(first); await session(first, { expired: true }); await session(first, { revoked: true }); await session(second);
    async function mail(owner, table, state) {
      const challenge = id();
      if (table === "mail_outbox") await connection.query("INSERT INTO email_verifications (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [challenge, owner, randomBytes(32), created, expiry]);
      else await connection.query("INSERT INTO client_password_resets (id, user_id, token_hash, credential_version, email_hash, created_at, expires_at) VALUES (?, ?, ?, 1, ?, ?, ?)",
        [challenge, owner, randomBytes(32), randomBytes(32), created, expiry]);
      const field = table === "mail_outbox" ? "verification_id" : "reset_id";
      await connection.query(`INSERT INTO ${table} (id, ${field}, recipient_user_id, payload_encrypted, status, attempts, available_at, expires_at, created_at, lease_token, lease_until)
        VALUES (?, ?, ?, 'private-payload-never-read', ?, ?, ?, ?, ?, ?, ?)`,
      [id(), challenge, owner, state, state === "sending" ? 1 : 0, created, expiry, created,
        state === "sending" ? id() : null, state === "sending" ? sqlDate(now + 120000) : null]);
    }
    for (const table of ["mail_outbox", "password_reset_outbox"]) {
      await mail(first, table, "pending"); await mail(first, table, "sending"); await mail(second, table, "pending");
    }
    async function asset(owner, role, state) {
      const assetId = id(), storageKey = randomBytes(32), digest = randomBytes(32);
      if (state !== "reserved") await connection.query(`INSERT INTO media_assets (id, owner_id, owner_role, storage_key, content_digest, active_digest,
        width, height, thumbnail_width, thumbnail_height, full_bytes, thumbnail_bytes, created_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, 100, 80, 50, 40, 400, 100, ?, ?)`,
      [assetId, owner, role, storageKey, digest, ["cleanup_pending", "released"].includes(state) ? null : digest, created,
        ["cleanup_pending", "released"].includes(state) ? created : null]);
      await connection.query(`INSERT INTO media_storage_objects (id, owner_id, owner_role, storage_key, content_digest,
        full_bytes, thumbnail_bytes, stored_bytes, state, asset_id, created_at, updated_at, released_at)
        VALUES (?, ?, ?, ?, ?, 400, 100, 580, ?, ?, ?, ?, ?)`,
      [assetId, owner, role, storageKey, digest, state, state === "reserved" ? null : assetId, created, created, state === "released" ? created : null]);
      return assetId;
    }
    const shared = await asset(admin, "admin", "registered"), owned = await asset(first, "client", "registered");
    await asset(first, "client", "reserved"); await asset(first, "client", "cleanup_pending"); await asset(first, "client", "released");
    await asset(second, "client", "registered");
    await connection.query(`INSERT INTO media_storage_state (id, owner_bytes, total_bytes, root_fingerprint, held_bytes, initialized_at)
      VALUES (1, 1048576, 2097152, ?, 2900, ?)`, [randomBytes(32), created]);
    async function message(conv, sender, role, sequence, linked = null, deleted = false) {
      const messageId = id();
      await connection.query(`INSERT INTO messages (id, conversation_id, sequence_no, sender_id, sender_role, client_message_id,
        body_encrypted, body_fingerprint, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [messageId, conv, String(sequence), sender, role, id(), deleted ? null : "private-ciphertext-never-read", randomBytes(32), created, deleted ? created : null]);
      if (linked !== null) await connection.query("INSERT INTO message_media (message_id, conversation_id, media_id, created_at) VALUES (?, ?, ?, ?)", [messageId, conv, linked, created]);
      return messageId;
    }
    await message(firstConv, admin, "admin", 1, shared); await message(firstConv, admin, "admin", 2, shared, true);
    await message(secondConv, admin, "admin", 1, shared);
    async function campaign(linked = null) {
      const campaignId = id();
      await connection.query(`INSERT INTO broadcast_campaigns (id, admin_id, client_campaign_id, mfa_version, payload_encrypted,
        request_fingerprint, media_id, created_at, updated_at, expires_at) VALUES (?, ?, ?, 1, 'private-audience-never-read', ?, ?, ?, ?, ?)`,
      [campaignId, admin, id(), randomBytes(32), linked, created, created, expiry]); return campaignId;
    }
    async function recipient(campaignId, conv, client, state) {
      await connection.query(`INSERT INTO broadcast_recipients (campaign_id, conversation_id, client_id, proposed_message_id, client_message_id,
        state, available_at, created_at, lease_token, lease_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [campaignId, conv, client, id(), id(), state, created, created, state === "sending" ? id() : null, state === "sending" ? sqlDate(now + 120000) : null]);
    }
    const pendingCampaign = await campaign(shared); await recipient(pendingCampaign, firstConv, first, "pending");
    await recipient(pendingCampaign, secondConv, second, "pending"); await recipient(await campaign(), firstConv, first, "sending");
    const facts = (target = first) => withClientData({ pool, clientId: target, now }, (reader) => reader.deletionFacts());
    const counts = (values) => Object.fromEntries(values.map((value) => [value.name, value.count]));
    await t.test("normal shared-peer photos and tombstones remain distinct from owned storage and in-flight leases", async () => {
      const before = await databaseHash(), result = await facts();
      assert.deepEqual(result.map((value) => value.name), DELETION_FACT_NAMES); assert.ok(result.every((value) => value.truncated === false));
      assert.deepEqual(counts(result), { activeSessions: 1, verificationPending: 1, verificationSending: 1, recoveryPending: 1, recoverySending: 1,
        broadcastPending: 1, broadcastSending: 1, mediaReserved: 1, mediaRegistered: 1, mediaCleanupPending: 1, mediaReleased: 1,
        ownedMediaOutsideConversationLinks: 0, ownedMediaCampaignLinks: 0, sharedPeerMediaLinks: 2,
        foreignMessageBindings: 0, foreignReceiptBindings: 0, foreignBroadcastBindings: 0, foreignAdministratorSessionState: 0, foreignMediaJournalBindings: 0,
        notificationSubscriptionsEnabled: 0, pushPending: 0, pushSending: 0, foreignPushBindings: 0, foreignProfileBindings: 0, foreignTaskBindings: 0 });
      assert.doesNotMatch(JSON.stringify(result), /example\.invalid|private-|ciphertext|payload|token|storage_key/);
      assert.equal(await databaseHash(), before);
    });
    await t.test("schema-valid cross-client references and administrator state are flagged without broadening client scope", async () => {
      await message(secondConv, admin, "admin", 2, owned); await message(secondConv, first, "client", 3); await message(firstConv, second, "client", 3);
      await connection.query("INSERT INTO chat_receipts (conversation_id, user_id, last_read_sequence, updated_at) VALUES (?, ?, 0, ?), (?, ?, 0, ?)",
        [secondConv, first, created, firstConv, second, created]);
      await recipient(await campaign(owned), secondConv, first, "pending"); await recipient(await campaign(), firstConv, second, "pending");
      await connection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [firstSession, created, created]);
      const before = await databaseHash(), result = counts(await facts());
      assert.equal(result.ownedMediaOutsideConversationLinks, 1); assert.equal(result.ownedMediaCampaignLinks, 1);
      assert.equal(result.foreignMessageBindings, 2); assert.equal(result.foreignReceiptBindings, 2); assert.equal(result.foreignBroadcastBindings, 2);
      assert.equal(result.foreignAdministratorSessionState, 1); assert.equal(result.foreignMediaJournalBindings, 0);
      assert.equal(result.broadcastPending, 1); assert.equal(result.mediaRegistered, 1);
      assert.equal(await databaseHash(), before);
    });
    await t.test("another client's avatar reference is flagged without reading that client's profile contents", async () => {
      await connection.query(`INSERT INTO user_profiles (user_id, avatar_media_id, version, created_at, updated_at)
        VALUES (?, ?, 1, ?, ?)`, [second, owned, created, created]);
      try {
        const before = await databaseHash();
        assert.equal(counts(await facts()).foreignProfileBindings, 1);
        assert.equal(await databaseHash(), before);
      } finally { await connection.query("DELETE FROM user_profiles WHERE user_id = ?", [second]); }
    });
    await t.test("media reference checks identify a wrong owner and storage binding without reading encrypted files", async () => {
      await connection.query("UPDATE media_storage_objects SET owner_id = ? WHERE id = ?", [second, owned]);
      try { assert.equal(counts(await facts()).foreignMediaJournalBindings, 2); }
      finally { await connection.query("UPDATE media_storage_objects SET owner_id = ? WHERE id = ?", [first, owned]); }
      const original = (await connection.query("SELECT storage_key FROM media_storage_objects WHERE id = ?", [owned]))[0].storage_key;
      await connection.query("UPDATE media_storage_objects SET storage_key = ? WHERE id = ?", [randomBytes(32), owned]);
      try { assert.equal(counts(await facts()).foreignMediaJournalBindings, 2); }
      finally { await connection.query("UPDATE media_storage_objects SET storage_key = ? WHERE id = ?", [original, owned]); }
      const reserved = (await connection.query("SELECT id, storage_key FROM media_storage_objects WHERE owner_id = ? AND state = 'reserved'", [first]))[0];
      const peerKey = (await connection.query("SELECT storage_key FROM media_storage_objects WHERE id = ?", [shared]))[0].storage_key;
      // An unfinished owned proposal can also collide with a foreign asset's
      // storage handle while having no explicit asset_id reference at all.
      await connection.query("UPDATE media_storage_objects SET storage_key = ? WHERE id = ?", [randomBytes(32), shared]);
      try {
        await connection.query("UPDATE media_storage_objects SET storage_key = ? WHERE id = ?", [peerKey, reserved.id]);
        assert.equal(counts(await facts()).foreignMediaJournalBindings, 1);
      } finally {
        await connection.query("UPDATE media_storage_objects SET storage_key = ? WHERE id = ?", [reserved.storage_key, reserved.id]);
        await connection.query("UPDATE media_storage_objects SET storage_key = ? WHERE id = ?", [peerKey, shared]);
      }
    });
    await t.test("a retained client with no conversation treats every existing sender/receipt/recipient edge as foreign", async () => {
      await message(secondConv, noConversation, "client", 4);
      await connection.query("INSERT INTO chat_receipts (conversation_id, user_id, last_read_sequence, updated_at) VALUES (?, ?, 0, ?)", [secondConv, noConversation, created]);
      await recipient(await campaign(), secondConv, noConversation, "pending");
      const result = counts(await facts(noConversation));
      assert.equal(result.broadcastPending, 0); assert.equal(result.sharedPeerMediaLinks, 0);
      assert.equal(result.foreignMessageBindings, 1); assert.equal(result.foreignReceiptBindings, 1); assert.equal(result.foreignBroadcastBindings, 1);
    });
    await t.test("facts remain in one database-enforced read-only snapshot and saturate active-session counts", async () => {
      let denied = false;
      const checkedPool = { async getConnection() {
        const runtime = await pool.getConnection();
        return { ...runtime, async query(sql, parameters) {
          const result = await runtime.query(sql, parameters);
          if (sql === "START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT") {
            await assert.rejects(runtime.query("DELETE FROM sessions WHERE user_id = ?", [first])); denied = true;
          }
          return result;
        } };
      } };
      await withClientData({ pool: checkedPool, clientId: first, now }, (reader) => reader.deletionFacts()); assert.equal(denied, true);
      for (let offset = 0; offset < 10000; offset += 200) {
        const values = Array.from({ length: Math.min(200, 10000 - offset) }, () => [id(), first, randomBytes(32), created, expiry]);
        await connection.query(`INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ${values.map(() => "(?, ?, ?, ?, ?)").join(", ")}`, values.flat());
      }
      assert.deepEqual((await facts()).find((value) => value.name === "activeSessions"), { name: "activeSessions", count: 10000, truncated: true });
      assert.equal((await facts(second)).find((value) => value.name === "activeSessions").count, 1);
    });
    await t.test("real keyless CLI plan finalizes private metadata files and leaves the complete source graph and media directory unchanged", async () => {
      const { main } = await import("../scripts/data-export.mjs");
      const temporaryBase = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../audit");
      await mkdir(temporaryBase, { recursive: true, mode: 0o700 });
      const temporary = await mkdtemp(path.join(temporaryBase, "data-deletion-cli-"));
      const mediaRoot = path.join(temporary, "source-media"), parent = path.join(temporary, "exports"), output = path.join(parent, "plan");
      await mkdir(mediaRoot, { mode: 0o700 }); await mkdir(parent, { mode: 0o700 });
      const sourceFile = path.join(mediaRoot, "synthetic-ciphertext.enc"); await writeFile(sourceFile, randomBytes(512), { mode: 0o600 });
      try {
        const before = await databaseHash(), beforeFiles = await readdir(mediaRoot), beforeFileHash = hash(await readFile(sourceFile));
        const stdout = []; let poolClosures = 0;
        const result = await main(["plan", "--offline", "--database", options.database, "--client", first.toString("hex"), "--confirm-client", first.toString("hex"), "--output", output],
          { ...process.env, JESSIEMESSAGE_MEDIA_ROOT: mediaRoot, JESSIEMESSAGE_MESSAGE_KEY: undefined, JESSIEMESSAGE_MEDIA_KEY: undefined },
          { clock: () => now, createPool: async () => ({ getConnection: (...args) => pool.getConnection(...args), async end() { poolClosures++; } }),
            makeStorage() { assert.fail("deletion planning never opens media storage"); }, exportContent() { assert.fail("deletion planning never decrypts or exports content"); },
            outputStream: { write(value) { stdout.push(value); } } });
        assert.deepEqual(Object.keys(result).sort(), ["command", "status", "inventoryCategories", "observations", "affectedCategories", "blockers"].sort());
        assert.equal(result.command, "plan"); assert.equal(result.status, "complete"); assert.equal(result.inventoryCategories, 32); assert.equal(result.observations, 25);
        assert.ok(result.blockers > 0); assert.equal(poolClosures, 1); assert.deepEqual(stdout, [JSON.stringify(result) + "\n"]);
        assert.doesNotMatch(stdout.join(""), /example\.invalid|private-|ciphertext|payload|password|token|\/workspace|[a-f0-9]{32}/);
        const manifest = JSON.parse(await readFile(path.join(output, "COMPLETE.json"), "utf8"));
        assert.equal(manifest.status, "complete"); assert.equal(manifest.entries.length, 1); assert.equal(manifest.entries[0].name, "deletion-plan.json");
        assert.equal((await lstat(output)).mode & 0o7777, 0o700); assert.equal((await lstat(path.join(output, "COMPLETE.json"))).mode & 0o7777, 0o600);
        for (const entry of manifest.entries) {
          const filename = path.join(output, entry.name), value = await readFile(filename);
          assert.equal(value.length, entry.bytes); assert.equal(hash(value), entry.sha256); assert.equal((await lstat(filename)).mode & 0o7777, 0o600);
          assert.doesNotMatch(value.toString("utf8"), /example\.invalid|private-ciphertext|private-payload|private-audience|synthetic-private-password|\/workspace/);
        }
        assert.equal(await databaseHash(), before); assert.deepEqual(await readdir(mediaRoot), beforeFiles); assert.equal(hash(await readFile(sourceFile)), beforeFileHash);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    });
  } finally {
    try { await pool?.end(); }
    finally { try { await cleanup(); } finally { await connection.end(); } }
  }
});
