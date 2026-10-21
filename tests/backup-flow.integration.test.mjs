import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, createHash, randomBytes } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createChatStore } from "../server/chat/store.mjs";
import { createAccessStore } from "../server/access/store.mjs";
import { createMediaStore } from "../server/media/store.mjs";
import { createCrmStore } from "../server/crm/store.mjs";
import { assertResetSchema } from "../server/reset/store.mjs";
import { assertBroadcastSchema } from "../server/broadcast/store.mjs";
import { assertErasureSchema } from "../server/data/erasure-schema.mjs";
import { createMediaCapacityStore } from "../server/media/capacity-store.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { normalizeImage } from "../server/media/image.mjs";
import { makeTotpSecret, sealTotpSecret, tokenDigest } from "../server/auth/crypto.mjs";
import { encryptMessageBody, messageFingerprint } from "../server/chat/crypto.mjs";
import { sealNotes, openNotes } from "../server/crm/crypto.mjs";
import { sealVerificationPayload } from "../server/mail/crypto.mjs";
import { sealResetPayload } from "../server/reset/mail-crypto.mjs";
import { sealPayload, campaignFingerprint } from "../server/broadcast/crypto.mjs";
import { sealSubscription, endpointDigest } from "../server/notifications/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sqlDate = (value) => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const id = () => randomBytes(16);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const backupError = (error) => typeof error?.code === "string" && error.code.startsWith("BACKUP_");

async function filesUnder(directory) {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    assert.equal(item.isSymbolicLink(), false, "synthetic backup fixtures never follow symlinks");
    assert.equal(item.isFile(), true, "synthetic media fixtures contain regular files only");
    const filename = path.join(directory, item.name), stat = await lstat(filename);
    assert.equal(stat.mode & 0o777, 0o600); assert.equal(stat.nlink, 1);
    entries.push([item.name, hash(await readFile(filename))]);
  }
  return entries.sort(([left], [right]) => left.localeCompare(right));
}
function cell(value) {
  if (Buffer.isBuffer(value)) return { binary: value.toString("hex") };
  if (typeof value === "bigint") return { bigint: String(value) };
  if (value instanceof Date) return value.toISOString();
  return value;
}

test("offline backup restores a separate real MariaDB schema and private encrypted root without changing its source (synthetic fixtures only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with two explicit loopback disposable databases.", timeout: 300000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "backup integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "backup source must be an explicit disposable schema");
  const restoreDatabase = process.env.JESSIEMESSAGE_RESTORE_TEST_DATABASE;
  assert.equal(typeof restoreDatabase, "string", "a second disposable schema must be explicitly configured");
  assert.match(restoreDatabase, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.notEqual(restoreDatabase, options.database, "the original schema must never become its own restore target");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  const targetEnv = { ...process.env, JESSIEMESSAGE_DB_NAME: restoreDatabase,
    JESSIEMESSAGE_MIGRATION_DATABASE: restoreDatabase, JESSIEMESSAGE_APPLICATION_DATABASE: restoreDatabase };
  const migrations = await loadMigrations(); assert.equal(migrations.length, 32);
  const tables = createdMigrationTables(migrations);
  assert.equal(tables.length, 31, "the admission ALTER adds a ledger entry, not a copied table");
  const allowedTables = [...tables, "schema_migrations", "migration_probe"];
  const qualified = (database, table) => {
    assert.ok([options.database, restoreDatabase].includes(database)); assert.ok(allowedTables.includes(table));
    return `\`${database}\`.\`${table}\``;
  };
  const sourceConnection = await connectDatabase(), targetConnection = await connectDatabase(targetEnv);
  let sourcePool, targetPool, temporaryRoot;
  let sourceRoot, targetRoot, manifestPath, originalDatabaseHash, originalFiles;
  const now = Date.now() - 10000, clock = () => now + 5000;
  const limits = { ownerBytes: 1048576, totalBytes: 2097152 };
  const keys = Object.fromEntries(["totpKey", "mailKey", "messageKey", "mediaKey", "crmKey"].map((name) => [name, randomBytes(32)]));
  async function reset(database) {
    const actual = await sourceConnection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
    assert.ok(actual.every((table) => allowedTables.includes(table.name)), "refuse cleanup when any unrelated table is present");
    for (const table of [...tables].reverse().concat(["migration_probe", "schema_migrations"])) await sourceConnection.query(`DROP TABLE IF EXISTS ${qualified(database, table)}`);
  }
  async function databaseHash(database) {
    const digest = createHash("sha256");
    for (const table of [...tables, "schema_migrations"]) {
      const rows = await sourceConnection.query(`SELECT * FROM ${qualified(database, table)}`);
      const canonical = rows.map((row) => JSON.stringify(Object.fromEntries(Object.keys(row).sort().map((name) => [name, cell(row[name])])))).sort();
      digest.update(table).update("\n").update(JSON.stringify(canonical)).update("\n");
    }
    return digest.digest("hex");
  }
  async function sourceUnchanged() {
    assert.equal(await databaseHash(options.database), originalDatabaseHash, "backup source SQL remains byte-for-byte equivalent");
    assert.deepEqual(await filesUnder(sourceRoot), originalFiles, "backup source ciphertext and filenames remain unchanged");
  }
  async function clone() {
    await reset(restoreDatabase); await applyMigrations(targetConnection, { database: restoreDatabase, migrations });
    await targetConnection.beginTransaction();
    try {
      await targetConnection.query(`DELETE FROM ${qualified(restoreDatabase, "schema_migrations")}`);
      for (const table of [...tables, "schema_migrations"]) await targetConnection.query(`INSERT INTO ${qualified(restoreDatabase, table)} SELECT * FROM ${qualified(options.database, table)}`);
      await targetConnection.commit();
    } catch (error) { await targetConnection.rollback(); throw error; }
    await rm(targetRoot, { recursive: true, force: true }); await mkdir(targetRoot, { mode: 0o700 });
    for (const [name] of originalFiles) { await copyFile(path.join(sourceRoot, name), path.join(targetRoot, name)); await chmod(path.join(targetRoot, name), 0o600); }
    assert.equal(await databaseHash(restoreDatabase), originalDatabaseHash, "the SQL clone includes the exact migration ledger timestamps");
    assert.deepEqual(await filesUnder(targetRoot), originalFiles, "copied encrypted files are independent regular 0600 files");
  }
  try {
    await reset(options.database); await reset(restoreDatabase);
    await applyMigrations(sourceConnection, { database: options.database, migrations });
    sourcePool = await createRuntimePool(process.env); targetPool = await createRuntimePool(targetEnv);
    const parent = path.join(path.dirname(repositoryRoot), "audit"); await mkdir(parent, { recursive: true, mode: 0o700 });
    temporaryRoot = await mkdtemp(path.join(parent, "backup-flow-")); await chmod(temporaryRoot, 0o700);
    sourceRoot = path.join(temporaryRoot, "source"); targetRoot = path.join(temporaryRoot, "restore"); manifestPath = path.join(temporaryRoot, "checkpoint.json");
    await mkdir(sourceRoot, { mode: 0o700 }); await mkdir(targetRoot, { mode: 0o700 });
    const sourceStorage = await createMediaStorage({ root: sourceRoot, key: keys.mediaKey });
    const sourceCapacity = { ...limits, rootFingerprint: await sourceStorage.fingerprint() };
    const sourceCapacityStore = createMediaCapacityStore({ pool: sourcePool, capacity: sourceCapacity });
    const chat = createChatStore(sourcePool), media = createMediaStore({ pool: sourcePool, chatStore: chat, capacity: sourceCapacity });
    await sourceCapacityStore.initialize({ now, offline: true });
    const admin = { id: id(), role: "admin", tokenHash: randomBytes(32), sessionId: id() };
    const client = { id: id(), role: "client", tokenHash: randomBytes(32), sessionId: id(), email: "backup-client@example.invalid" };
    const conversationId = id();
    for (const user of [admin, client]) {
      await sourceConnection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at,
        age_assured_at, access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?, ?)`,
      [user.id, user.role, `Synthetic backup ${user.role}`, user.email ?? "backup-admin@example.invalid",
        user.role === "client" ? sqlDate(now) : null, user.role === "client" ? sqlDate(now) : null, user.role === "client" ? sqlDate(now) : null, sqlDate(now), sqlDate(now)]);
      if (user.role === "admin") await sourceConnection.query("INSERT INTO admin_mfa (user_id, secret_encrypted, version, last_totp_step, enabled_at) VALUES (?, ?, 1, ?, ?)",
        [user.id, sealTotpSecret(makeTotpSecret(), keys.totpKey, user.id), Math.floor(now / 30000), sqlDate(now)]);
      else await sourceConnection.query("INSERT INTO client_auth_state (user_id, credential_version, age_declared_at) VALUES (?, 1, ?)", [user.id, sqlDate(now)]);
      if (user.role === "client") await consumeSyntheticInvitation(sourceConnection, user.id, now);
      await sourceConnection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [user.sessionId, user.id, user.tokenHash, sqlDate(now), sqlDate(now + 28800000)]);
      if (user.role === "admin") await sourceConnection.query("INSERT INTO auth_session_state (session_id, last_seen_at, mfa_verified_at, mfa_version) VALUES (?, ?, ?, 1)", [user.sessionId, sqlDate(now), sqlDate(now)]);
      else await sourceConnection.query("INSERT INTO client_session_state (session_id, last_seen_at, credential_version) VALUES (?, ?, 1)", [user.sessionId, sqlDate(now)]);
    }
    await sourceConnection.query("INSERT INTO conversations (id, client_id, admin_id, created_at) VALUES (?, ?, ?, ?)", [conversationId, client.id, admin.id, sqlDate(now)]);
    const actor = { role: "admin", tokenHash: admin.tokenHash, now };
    async function addAsset(color, state, partial = false) {
      const input = await sharp({ create: { width: 16, height: 12, channels: 3, background: color } }).png().toBuffer();
      const normalized = await normalizeImage(input);
      const asset = { id: id(), storageKey: randomBytes(32), digest: normalized.digest, width: normalized.width, height: normalized.height,
        thumbnailWidth: normalized.thumbnailWidth, thumbnailHeight: normalized.thumbnailHeight, fullBytes: normalized.full.length, thumbnailBytes: normalized.thumbnail.length };
      await media.reserveAsset({ ...actor, asset });
      await sourceStorage.put({ assetId: asset.id, storageKey: asset.storageKey, full: normalized.full, thumbnail: normalized.thumbnail });
      if (partial) await unlink(path.join(sourceRoot, `${asset.storageKey.toString("hex")}.thumb.enc`));
      if (state !== "reserved") await media.registerAsset({ ...actor, now: state === "cleanup_pending" ? now + 1000 : now, asset });
      if (state === "cleanup_pending") await media.deleteAsset({ ...actor, now: now + 2000, assetId: asset.id });
      return asset;
    }
    const active = await addAsset("#804060", "registered"), reserved = await addAsset("#406080", "reserved"),
      partial = await addAsset("#608040", "reserved", true), cleanup = await addAsset("#604080", "cleanup_pending");
    const messageId = id(), body = JSON.stringify({ mediaId: active.id.toString("hex"), caption: "Synthetic restored encrypted message" });
    await chat.sendMessage({ ...actor, conversationId, message: { id: messageId, clientMessageId: id(), mediaId: active.id,
      bodyEncrypted: encryptMessageBody(body, keys.messageKey, { conversationId, messageId, senderId: admin.id }),
      bodyFingerprint: messageFingerprint(body, keys.messageKey, { conversationId, senderId: admin.id }) } });
    await sourceConnection.query(`INSERT INTO crm_profiles (admin_id, conversation_id, nickname, notes_encrypted, version, notes_revision, created_at, updated_at)
      VALUES (?, ?, 'Synthetic restore record', ?, 1, 1, ?, ?)`, [admin.id, conversationId,
      sealNotes("Synthetic restored private note", keys.crmKey, { adminId: admin.id, conversationId, version: "1" }), sqlDate(now), sqlDate(now)]);
    const verificationId = id(), verificationJob = id(), verificationToken = randomBytes(32).toString("base64url");
    await sourceConnection.query("INSERT INTO email_verifications (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      [verificationId, client.id, tokenDigest(verificationToken), sqlDate(now), sqlDate(now + 3600000)]);
    await sourceConnection.query(`INSERT INTO mail_outbox (id, verification_id, recipient_user_id, payload_encrypted, available_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [verificationJob, verificationId, client.id,
      sealVerificationPayload({ email: client.email, token: verificationToken }, keys.mailKey, verificationJob), sqlDate(now), sqlDate(now + 3600000), sqlDate(now)]);
    const resetId = id(), resetJob = id(), resetToken = randomBytes(32).toString("base64url");
    await sourceConnection.query(`INSERT INTO client_password_resets (id, user_id, token_hash, credential_version, email_hash, created_at, expires_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)`, [resetId, client.id, tokenDigest(resetToken), createHash("sha256").update(client.email, "utf8").digest(), sqlDate(now), sqlDate(now + 1800000)]);
    await sourceConnection.query(`INSERT INTO password_reset_outbox (id, reset_id, recipient_user_id, payload_encrypted, available_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [resetJob, resetId, client.id,
      sealResetPayload({ email: client.email, token: resetToken }, keys.mailKey, resetJob), sqlDate(now), sqlDate(now + 1800000), sqlDate(now)]);
    const campaignId = id(), campaign = { title: "Synthetic restore campaign", body: "Synthetic future private delivery", mediaId: active.id.toString("hex"), allowRepeatMedia: false, conversationIds: [conversationId.toString("hex")] };
    await sourceConnection.query(`INSERT INTO broadcast_campaigns (id, admin_id, client_campaign_id, mfa_version, payload_encrypted, request_fingerprint, media_id,
      created_at, updated_at, expires_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`, [campaignId, admin.id, id(), sealPayload(campaign, keys.messageKey, { adminId: admin.id, campaignId }),
      campaignFingerprint(campaign, keys.messageKey, { adminId: admin.id }), active.id, sqlDate(now), sqlDate(now), sqlDate(now + 86400000)]);
    await sourceConnection.query(`INSERT INTO broadcast_recipients (campaign_id, conversation_id, client_id, proposed_message_id, client_message_id, available_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [campaignId, conversationId, client.id, id(), id(), sqlDate(now), sqlDate(now)]);
    originalDatabaseHash = await databaseHash(options.database); originalFiles = await filesUnder(sourceRoot);
    assert.equal(originalFiles.length, 7);
    const { main } = await import("../scripts/backup.mjs");
    const { createBackupRecoveryStore } = await import("../server/backup/recovery-store.mjs");
    const output = [];
    function dependencies(databaseName, root, extra = {}, changedKeys = {}) {
      return { configure: () => {
        const selected = Object.fromEntries(Object.entries({ ...keys, ...changedKeys }).map(([name, key]) => [name, Buffer.from(key)]));
        return { databaseName, media: { enabled: true, key: selected.mediaKey, root, capacity: { ...limits }, minimumFreeBytes: 0 }, keys: selected };
      }, createPool: createRuntimePool, outputStream: { write: (text) => output.push(text) }, clock, ...extra };
    }
    const run = (command, { env = targetEnv, root = targetRoot, databaseName = restoreDatabase, extra = {}, changedKeys = {}, file = manifestPath } = {}) =>
      main([command, "--offline", "--manifest", file], env, dependencies(databaseName, root, extra, changedKeys));
    async function targetStatus() {
      const storage = await createMediaStorage({ root: targetRoot, key: keys.mediaKey });
      return createMediaCapacityStore({ pool: targetPool, capacity: { ...limits, rootFingerprint: await storage.fingerprint() } }).status();
    }
    async function assertRestored() {
      const status = await targetStatus(); assert.equal(status.pendingBytes, 0);
      assert.equal(status.heldBytes, active.fullBytes + active.thumbnailBytes + 80);
      const rows = await targetConnection.query("SELECT id, state FROM media_storage_objects ORDER BY id");
      assert.equal(rows.find((row) => row.id.equals(active.id)).state, "registered");
      for (const candidate of [reserved, partial, cleanup]) assert.equal(rows.find((row) => row.id.equals(candidate.id)).state, "released");
      const filenames = await filesUnder(targetRoot); assert.equal(filenames.length, 2);
      assert.ok(filenames.every(([name]) => name.startsWith(active.storageKey.toString("hex"))));
      const targetStorage = await createMediaStorage({ root: targetRoot, key: keys.mediaKey });
      assert.ok((await targetStorage.get({ assetId: active.id, storageKey: active.storageKey, variant: "full" })).length > 0);
      assert.equal(Number((await targetConnection.query("SELECT COUNT(*) AS count FROM messages WHERE id = ?", [messageId]))[0].count), 1);
      assert.equal(Number((await targetConnection.query("SELECT COUNT(*) AS count FROM message_media WHERE message_id = ?", [messageId]))[0].count), 1);
      const campaignRow = (await targetConnection.query("SELECT status, media_id FROM broadcast_campaigns WHERE id = ?", [campaignId]))[0];
      assert.equal(campaignRow.status, "queued"); assert.deepEqual(campaignRow.media_id, active.id);
      assert.equal((await targetConnection.query("SELECT state FROM broadcast_recipients WHERE campaign_id = ?", [campaignId]))[0].state, "pending");
      await sourceUnchanged();
    }

    await t.test("separate exact-schema inspection does not inherit the application's Infomaniak six-rights guard", async () => {
      const { createBackupInspectionPool, assertBackupInspection } = await import("../server/backup/inspection.mjs");
      const env = { ...process.env, JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE: "infomaniak-shared-pattern" };
      const inspectionPool = await createBackupInspectionPool(env);
      const applicationPool = await createRuntimePool({ ...env,
        JESSIEMESSAGE_RUNTIME_DB_USER: env.JESSIEMESSAGE_BACKUP_SCHEMA_USER,
        JESSIEMESSAGE_RUNTIME_DB_PASSWORD: env.JESSIEMESSAGE_BACKUP_SCHEMA_PASSWORD,
      });
      let inspector;
      try {
        // ALL is deliberately incompatible with the application's profile.
        // Removing its guard applies only to the separate inspection pool.
        await assert.rejects(applicationPool.getConnection(), (error) => error?.code === "AUTH_DATABASE_CONNECTION");
        inspector = await inspectionPool.getConnection();
        assert.equal(await assertBackupInspection(inspector, options.database), true);
        for (const sql of ["UPDATE users SET status = status", "SELECT * FROM users FOR UPDATE", "SELECT 1 INTO OUTFILE '/tmp/synthetic-backup-probe'"])
          assert.throws(() => inspector.query(sql), (error) => error?.code === "BACKUP_INSPECTION_CONFIG");
        assert.equal(env.JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE, "infomaniak-shared-pattern");
        await sourceUnchanged();
      } finally {
        try { await inspector?.release(); }
        finally { await Promise.all([inspectionPool.end(), applicationPool.end()]); }
      }
    });

    await t.test("inspection diagnosis handles native driver metadata and retains the exact-schema gate", async () => {
      const { createBackupInspectionPool } = await import("../server/backup/inspection.mjs");
      const { diagnoseBackupInspection } = await import("../server/backup/inspection-diagnostics.mjs");
      const pool = await createBackupInspectionPool(process.env); let inspector;
      try {
        inspector = await pool.getConnection();
        const nativeRows = await inspector.query("SHOW GRANTS");
        assert.ok(Object.hasOwn(nativeRows, "meta"), "exercise the pinned MariaDB driver's native result shape");
        const diagnosis = await diagnoseBackupInspection(inspector, options.database);
        assert.deepEqual(diagnosis, { databaseMatched: true, scope: "exact", privilegeProfile: "schema_all",
          metadataVisibility: "complete", objectInventory: "absent", captureAllowed: true });
        assert.equal(Object.isFrozen(diagnosis), true);
        await sourceUnchanged();
      } finally { try { await inspector?.release(); } finally { await pool.end(); } }
    });

    await t.test("prepare binds real encrypted data and five keys without exporting secrets or changing the source", async () => {
      const { createBackupInspectionPool, assertBackupInspection } = await import("../server/backup/inspection.mjs");
      const { createBackupSnapshotStore, captureBackupSnapshot } = await import("../server/backup/snapshot.mjs");
      const inspectionPool = await createBackupInspectionPool(process.env);
      try {
        const inspector = await inspectionPool.getConnection();
        try {
          const grants = await inspector.query("SHOW GRANTS");
          // Synthetic disposable schemas only: emit scope, never account
          // authentication clauses, ciphertext, SQL parameters or raw errors.
          t.diagnostic(`inspection scopes: ${JSON.stringify(grants.flatMap((row) => Object.values(row).filter((value) => typeof value === "string" && value.startsWith("GRANT ALL PRIVILEGES ON ")).map((value) => value.split(" TO ")[0])))}`);
          await assertBackupInspection(inspector, options.database);
        } finally { inspector.release(); }
        t.diagnostic("inspection guards passed");
        const snapshot = await captureBackupSnapshot({ store: createBackupSnapshotStore({ pool: sourcePool, inspectionPool }) });
        assert.equal(snapshot.counts.tables, 32, "snapshot covers every application table and schema_migrations");
        assert.equal(Number((await sourceConnection.query("SELECT COUNT(*) AS count FROM schema_migrations"))[0].count), 32);
        t.diagnostic("source snapshot passed");
      } finally { await inspectionPool.end(); }
      const result = await run("prepare", { env: process.env, root: sourceRoot, databaseName: options.database });
      assert.equal(result.command, "prepare"); assert.equal(result.verified, true); assert.equal(result.restored, false);
      assert.match(result.manifestHash, /^[a-f0-9]{64}$/);
      assert.equal((await lstat(manifestPath)).mode & 0o777, 0o600);
      const text = await readFile(manifestPath, "utf8"); assert.ok(text.length > 0);
      for (const key of Object.values(keys)) assert.equal(text.includes(key.toString("base64url")), false);
      for (const secret of [client.email, body, "Synthetic restored private note", verificationToken, resetToken]) assert.equal(text.includes(secret), false);
      await sourceUnchanged();
    });

    await t.test("verification requires a separate schema and private root and accepts an exact SQL/filesystem clone read-only", async () => {
      await clone(); const before = await databaseHash(restoreDatabase), filesBefore = await filesUnder(targetRoot);
      await assert.rejects(targetStatus(), (error) => error.code === "MEDIA_CAPACITY_UNAVAILABLE");
      await assert.rejects(run("verify", { env: process.env, root: sourceRoot, databaseName: options.database }), backupError);
      await assert.rejects(run("restore", { env: process.env, root: targetRoot, databaseName: options.database }), backupError);
      await assert.rejects(run("restore", { root: sourceRoot }), backupError);
      const verified = await run("verify"); assert.equal(verified.verified, true); assert.equal(verified.restored, false);
      assert.equal(await databaseHash(restoreDatabase), before); assert.deepEqual(await filesUnder(targetRoot), filesBefore);
      await sourceUnchanged();
    });

    await t.test("offline restore clears only known pending objects, rebinds the clone and preserves active messages and campaigns", async () => {
      const restored = await run("restore"); assert.equal(restored.verified, true); assert.equal(restored.restored, true);
      assert.equal(restored.releasedCandidates, 3); await assertRestored();
      const before = await databaseHash(restoreDatabase), filesBefore = await filesUnder(targetRoot);
      assert.equal((await run("verify")).verified, true); assert.equal((await run("restore")).restored, true);
      assert.equal(await databaseHash(restoreDatabase), before, "a completed restore replay changes no SQL timestamps or counters");
      assert.deepEqual(await filesUnder(targetRoot), filesBefore); await sourceUnchanged();
    });

    await t.test("each wrong encryption key refuses verification before any clone or source mutation", async () => {
      await clone(); const before = await databaseHash(restoreDatabase), filesBefore = await filesUnder(targetRoot);
      for (const key of Object.keys(keys)) await assert.rejects(run("verify", { changedKeys: { [key]: randomBytes(32) } }), backupError);
      assert.equal(await databaseHash(restoreDatabase), before); assert.deepEqual(await filesUnder(targetRoot), filesBefore); await sourceUnchanged();
    });

    await t.test("a correctly signed checkpoint with a mismatched key canary is refused before opening a database", async () => {
      const { readManifest, createBackupManifest, writeManifest } = await import("../server/backup/manifest.mjs");
      const original = await readManifest(manifestPath), canaryPath = path.join(temporaryRoot, "wrong-canary.json");
      const manifest = createBackupManifest({ snapshot: original.payload.snapshot, identity: original.payload.identity,
        keys: { ...keys, totpKey: randomBytes(32) }, now: clock() });
      await writeManifest(canaryPath, manifest);
      const before = await databaseHash(restoreDatabase), filesBefore = await filesUnder(targetRoot);
      let opened = false;
      await assert.rejects(run("restore", { file: canaryPath, extra: { createPool: async (env) => {
        opened = true; return createRuntimePool(env);
      } } }), backupError);
      assert.equal(opened, false, "the valid media-key signature cannot conceal a wrong TOTP canary");
      assert.equal(await databaseHash(restoreDatabase), before); assert.deepEqual(await filesUnder(targetRoot), filesBefore); await sourceUnchanged();
    });

    await t.test("unrelated user or exact migration-ledger drift blocks cleanup of an otherwise readable clone", async () => {
      for (const changed of ["user", "ledger"]) {
        await clone();
        if (changed === "user") await targetConnection.query("UPDATE users SET pseudonym = 'Synthetic changed clone' WHERE id = ?", [client.id]);
        else await targetConnection.query("UPDATE schema_migrations SET finished_at = DATE_ADD(finished_at, INTERVAL 1 MICROSECOND) WHERE version = ?", [migrations.at(-1).version]);
        const before = await databaseHash(restoreDatabase), filesBefore = await filesUnder(targetRoot);
        await assert.rejects(run("restore"), backupError);
        assert.equal(await databaseHash(restoreDatabase), before); assert.deepEqual(await filesUnder(targetRoot), filesBefore); await sourceUnchanged();
      }
    });

    await t.test("lookalike foreign keys pointing at the source schema are refused by local validators before any cleanup", async subtest => {
      await clone();
      const targetChat = createChatStore(targetPool), access = createAccessStore(targetPool);
      const targetMedia = createMediaStore({ pool: targetPool, chatStore: targetChat });
      const crm = createCrmStore({ pool: targetPool, chatStore: targetChat });
      const before = await databaseHash(restoreDatabase), filesBefore = await filesUnder(targetRoot);
      const cases = [
        ["access", "email_verifications", "email_verification_user_fk", "user_id", "client_auth_state", "user_id", () => access.assertSchema(), "ACCESS_DATABASE_STATE"],
        ["chat", "chat_receipts", "chat_receipts_user_fk", "user_id", "users", "id", () => targetChat.assertSchema(), "CHAT_DATABASE_STATE"],
        ["media", "media_storage_objects", "media_storage_objects_owner_fk", "owner_id, owner_role", "users", "id, role", () => targetMedia.assertSchema(), "MEDIA_DATABASE_STATE"],
        ["crm", "crm_profiles", "crm_profiles_admin_fk", "admin_id, admin_role", "users", "id, role", () => crm.assertSchema(), "CRM_DATABASE_STATE"],
        ["reset", "client_password_resets", "client_password_reset_user_fk", "user_id", "client_auth_state", "user_id", () => assertResetSchema(targetPool), "RESET_DATABASE_STATE"],
        ["broadcast", "broadcast_campaigns", "broadcast_campaigns_owner_fk", "admin_id, admin_role", "users", "id, role", () => assertBroadcastSchema(targetPool), "BROADCAST_DATABASE_STATE"],
      ];
      for (const [label, table, constraint, children, parent, parents, check, code] of cases) {
        await subtest.test(`${label}: only the referenced schema changes`, async () => {
          assert.equal(await check(), true); await assertErasureSchema(targetConnection, restoreDatabase);
          const metadata = async () => (await targetConnection.query(`SELECT k.COLUMN_NAME AS child_column,
            k.REFERENCED_TABLE_SCHEMA AS parent_schema, k.REFERENCED_TABLE_NAME AS parent_table,
            k.REFERENCED_COLUMN_NAME AS parent_column, k.ORDINAL_POSITION AS position_value,
            r.UPDATE_RULE AS update_rule, r.DELETE_RULE AS delete_rule
            FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
              ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
            WHERE k.CONSTRAINT_SCHEMA = ? AND k.TABLE_NAME = ? AND k.CONSTRAINT_NAME = ? ORDER BY k.ORDINAL_POSITION`,
          [restoreDatabase, table, constraint])).map(row => ({ ...row }));
          const original = await metadata(); assert.ok(original.length > 0);
          assert.ok(original.every(row => row.parent_schema === restoreDatabase));
          const add = database => `ALTER TABLE ${qualified(restoreDatabase, table)} ADD CONSTRAINT \`${constraint}\`
            FOREIGN KEY (${children}) REFERENCES ${qualified(database, parent)} (${parents}) ON UPDATE RESTRICT ON DELETE RESTRICT`;
          const drop = `ALTER TABLE ${qualified(restoreDatabase, table)} DROP FOREIGN KEY \`${constraint}\``;
          await targetConnection.query(drop); let crossSchema = false;
          try {
            await targetConnection.query(add(options.database)); crossSchema = true;
            const changed = await metadata(); assert.ok(changed.every(row => row.parent_schema === options.database));
            assert.deepEqual(changed.map(row => ({ ...row, parent_schema: restoreDatabase })), original);
            await assert.rejects(check(), { code });
            await assert.rejects(assertErasureSchema(targetConnection, restoreDatabase), { code: "ERASURE_SCHEMA" });
            if (label === "media") await assert.rejects(run("restore"), backupError);
            assert.equal(await databaseHash(restoreDatabase), before); assert.deepEqual(await filesUnder(targetRoot), filesBefore);
            await sourceUnchanged();
          } finally {
            if (crossSchema) await targetConnection.query(drop);
            await targetConnection.query(add(restoreDatabase));
          }
          assert.deepEqual(await metadata(), original); assert.equal(await check(), true);
          await assertErasureSchema(targetConnection, restoreDatabase);
        });
      }
    });

    await t.test("an unexpected pre-existing SQL trigger blocks backup recovery before any candidate changes", async () => {
      await clone();
      await targetConnection.query(`CREATE TRIGGER synthetic_backup_preflight BEFORE UPDATE ON media_storage_state
        FOR EACH ROW SET NEW.held_bytes = NEW.held_bytes`);
      try {
        const before = await databaseHash(restoreDatabase), filesBefore = await filesUnder(targetRoot); let recoveryCreated = false;
        await assert.rejects(run("restore", { extra: { makeRecoveryStore: ({ pool }) => {
          recoveryCreated = true; return createBackupRecoveryStore({ pool });
        } } }), backupError);
        assert.equal(recoveryCreated, false);
        assert.equal(await databaseHash(restoreDatabase), before); assert.deepEqual(await filesUnder(targetRoot), filesBefore); await sourceUnchanged();
      } finally { await targetConnection.query("DROP TRIGGER synthetic_backup_preflight"); }
    });

    await t.test("unknown files and encrypted staging copies block restoration without deleting them", async () => {
      for (const kind of ["unknown", "staging"]) {
        await clone();
        const name = kind === "unknown" ? "synthetic-unknown.enc" : `.${active.storageKey.toString("hex")}.full.${id().toString("hex")}.tmp`;
        const filename = path.join(targetRoot, name); await copyFile(path.join(targetRoot, `${active.storageKey.toString("hex")}.full.enc`), filename); await chmod(filename, 0o600);
        const before = await databaseHash(restoreDatabase), filesBefore = await filesUnder(targetRoot);
        await assert.rejects(run("restore"), backupError);
        assert.equal(await databaseHash(restoreDatabase), before); assert.deepEqual(await filesUnder(targetRoot), filesBefore); await sourceUnchanged();
      }
    });

    await t.test("authenticated active-file corruption blocks verification before any pending cleanup", async () => {
      await clone(); const filename = path.join(targetRoot, `${active.storageKey.toString("hex")}.full.enc`);
      const corrupted = Buffer.from(await readFile(filename)); corrupted[corrupted.length - 1] ^= 1; await writeFile(filename, corrupted, { mode: 0o600 });
      const before = await databaseHash(restoreDatabase), filesBefore = await filesUnder(targetRoot);
      await assert.rejects(run("restore"), backupError);
      assert.equal(await databaseHash(restoreDatabase), before); assert.deepEqual(await filesUnder(targetRoot), filesBefore); await sourceUnchanged();
    });

    await t.test("a lost committed candidate-release acknowledgement retries safely without double credit", async () => {
      await clone(); let lost = false;
      await assert.rejects(run("restore", { extra: { makeRecoveryStore: ({ pool }) => {
        const store = createBackupRecoveryStore({ pool });
        return { ...store, async releaseCandidate(input) {
          const result = await store.releaseCandidate(input);
          if (!lost) { lost = true; throw new Error("synthetic_lost_release_acknowledgement"); }
          return result;
        } };
      } } }), backupError);
      assert.equal(lost, true); await sourceUnchanged();
      assert.equal((await run("restore")).restored, true); await assertRestored();
    });

    await t.test("a partial filesystem deletion retains its charge until a later offline retry completes cleanup", async () => {
      await clone(); let interrupted = false, affected;
      await assert.rejects(run("restore", { extra: { makeStorage: async (input) => {
        const storage = await createMediaStorage(input);
        return { ...storage, async remove({ storageKey }) {
          if (!interrupted) {
            interrupted = true; affected = storageKey;
            await unlink(path.join(targetRoot, `${storageKey.toString("hex")}.full.enc`)).catch((error) => { if (error.code !== "ENOENT") throw error; });
            throw new Error("synthetic_interrupted_physical_cleanup");
          }
          return storage.remove({ storageKey });
        } };
      } } }), backupError);
      assert.equal(interrupted, true);
      const held = (await targetConnection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0];
      assert.ok(Number(held.held_bytes) > active.fullBytes + active.thumbnailBytes + 80);
      assert.equal((await targetConnection.query("SELECT state FROM media_storage_objects WHERE storage_key = ?", [affected]))[0].state, "cleanup_pending");
      await sourceUnchanged(); assert.equal((await run("restore")).restored, true); await assertRestored();
    });

    await t.test("a failed final root rebind rolls back atomically and a fresh retry preserves the already completed cleanup", async () => {
      await clone();
      let triggerInstalled = false;
      try {
        await assert.rejects(run("restore", { extra: { makeRecoveryStore: ({ pool }) => {
          const store = createBackupRecoveryStore({ pool });
          return { ...store, async rebind(input) {
            // Install the fault only after the CLI's final clean-schema and
            // snapshot checks; this tests the real rebind transaction rollback.
            await targetConnection.query(`CREATE TRIGGER synthetic_backup_rebind BEFORE UPDATE ON media_storage_state FOR EACH ROW
              BEGIN IF NEW.root_fingerprint <> OLD.root_fingerprint THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic rebind failure'; END IF; END`);
            triggerInstalled = true; return store.rebind(input);
          } };
        } } }), backupError);
      } finally { if (triggerInstalled) await targetConnection.query("DROP TRIGGER synthetic_backup_rebind"); }
      assert.equal(triggerInstalled, true);
      await assert.rejects(targetStatus(), (error) => error.code === "MEDIA_CAPACITY_UNAVAILABLE");
      const binding = (await targetConnection.query("SELECT root_fingerprint, held_bytes FROM media_storage_state WHERE id = 1"))[0];
      assert.deepEqual(binding.root_fingerprint, sourceCapacity.rootFingerprint);
      assert.equal(Number(binding.held_bytes), active.fullBytes + active.thumbnailBytes + 80);
      await sourceUnchanged(); assert.equal((await run("restore")).restored, true); await assertRestored();
    });
    await t.test("photo-only profile prepares a four-key manifest on real SQL without a fictitious CRM key", async () => {
      for (const table of ["broadcast_recipients", "broadcast_campaigns", "broadcast_preferences", "crm_memberships", "crm_labels",
        "crm_profiles", "password_reset_outbox", "client_password_resets"]) await sourceConnection.query(`DELETE FROM ${qualified(options.database, table)}`);
      originalDatabaseHash = await databaseHash(options.database); originalFiles = await filesUnder(sourceRoot);
      const deps = dependencies(options.database, sourceRoot), configure = deps.configure;
      deps.configure = () => { const config = configure(); delete config.keys.crmKey; return config; };
      const file = path.join(temporaryRoot, "photos-checkpoint.json");
      const result = await main(["prepare", "--offline", "--manifest", file, "--profile", "photos"], process.env, deps);
      assert.equal(result.verified, true);
      const manifest = JSON.parse(await readFile(file, "utf8")); assert.equal(manifest.version, 2);
      assert.equal(manifest.profile, "messaging-photos");
      assert.deepEqual(Object.keys(manifest.payload.canaries).sort(), ["totpKey", "mailKey", "messageKey", "mediaKey"].sort());
      await sourceUnchanged();
    });

    await t.test("photo-only restore verifies copied images, rebinds only its clone and replays without extra credit", async () => {
      await clone();
      const deps = dependencies(restoreDatabase, targetRoot), configure = deps.configure;
      deps.configure = () => { const config = configure(); delete config.keys.crmKey; return config; };
      const args = command => [command, "--offline", "--manifest", path.join(temporaryRoot, "photos-checkpoint.json"), "--profile", "photos"];
      const before = await databaseHash(restoreDatabase), filesBefore = await filesUnder(targetRoot);
      assert.equal((await main(args("verify"), targetEnv, deps)).verified, true);
      assert.equal(await databaseHash(restoreDatabase), before); assert.deepEqual(await filesUnder(targetRoot), filesBefore);
      const restored = await main(args("restore"), targetEnv, deps); assert.equal(restored.restored, true); assert.equal(restored.releasedCandidates, 3);
      const capacity = await targetStatus(); assert.equal(capacity.pendingBytes, 0);
      assert.equal(capacity.heldBytes, active.fullBytes + active.thumbnailBytes + 80);
      assert.equal((await filesUnder(targetRoot)).length, 2);
      const completed = await databaseHash(restoreDatabase);
      assert.equal((await main(args("restore"), targetEnv, deps)).restored, true);
      assert.equal(await databaseHash(restoreDatabase), completed); await sourceUnchanged();
    });

    await t.test("application-table checkpoint uses runtime privileges, keeps explicit coverage and restores only its isolated clone", async () => {
      const { APPLICATION_COVERAGE, createApplicationInspectionPool } = await import("../server/backup/application-scope.mjs");
      const { createBackupSnapshotStore, captureBackupSnapshot } = await import("../server/backup/snapshot.mjs");
      const { createBackupInspectionPool } = await import("../server/backup/inspection.mjs");
      const appInspector = await createApplicationInspectionPool(process.env), strictInspector = await createBackupInspectionPool(process.env);
      try {
        const app = await captureBackupSnapshot({ store: createBackupSnapshotStore({ pool: sourcePool, inspectionPool: appInspector, coverage: "application-tables" }) });
        const strict = await captureBackupSnapshot({ store: createBackupSnapshotStore({ pool: sourcePool, inspectionPool: strictInspector }) });
        assert.equal(app.version, 2); assert.deepEqual(app.coverage, APPLICATION_COVERAGE);
        assert.equal(app.schemaDigest, strict.schemaDigest); assert.equal(app.coreDigest, strict.coreDigest); assert.deepEqual(app.counts, strict.counts);
        await sourceConnection.query("CREATE TRIGGER synthetic_application_scope BEFORE UPDATE ON media_storage_state FOR EACH ROW SET NEW.held_bytes = NEW.held_bytes");
        try {
          await assert.rejects(captureBackupSnapshot({ store: createBackupSnapshotStore({ pool: sourcePool, inspectionPool: strictInspector }) }), backupError);
          const scoped = await captureBackupSnapshot({ store: createBackupSnapshotStore({ pool: sourcePool, inspectionPool: appInspector, coverage: "application-tables" }) });
          assert.equal(scoped.coreDigest, app.coreDigest); assert.equal(scoped.coverage.executableInventory, "unproven");
          assert.equal(scoped.coverage.completeDatabase, false);
        } finally { await sourceConnection.query("DROP TRIGGER synthetic_application_scope"); }
      } finally { await Promise.all([appInspector.end(), strictInspector.end()]); }
      const notificationKey = randomBytes(32);
      const deps = (database, root) => {
        const selected = dependencies(database, root), configure = selected.configure;
        selected.configure = () => { const config = configure(); delete config.keys.crmKey; config.keys.notificationKey = notificationKey; return config; };
        return selected;
      };
      const file = path.join(temporaryRoot, "application-tables-checkpoint.json");
      const args = command => [command, "--offline", "--manifest", file, "--profile", "photos-notify-application"];
      assert.equal((await main(args("prepare"), process.env, deps(options.database, sourceRoot))).prepared, true);
      const manifest = JSON.parse(await readFile(file, "utf8"));
      assert.equal(manifest.version, 4); assert.equal(manifest.profile, "messaging-photos-notify-application");
      assert.deepEqual(manifest.payload.snapshot.coverage, APPLICATION_COVERAGE);
      await assert.rejects(main(["verify", "--offline", "--manifest", file, "--profile", "photos-notify"], targetEnv, deps(restoreDatabase, targetRoot)), backupError);
      await clone();
      const before = await databaseHash(restoreDatabase);
      assert.equal((await main(args("verify"), targetEnv, deps(restoreDatabase, targetRoot))).verified, true);
      assert.equal(await databaseHash(restoreDatabase), before);
      const restored = await main(args("restore"), targetEnv, deps(restoreDatabase, targetRoot));
      assert.equal(restored.restored, true); assert.equal(restored.releasedCandidates, 3);
      const capacity = await targetStatus(); assert.equal(capacity.pendingBytes, 0);
      assert.equal(capacity.heldBytes, active.fullBytes + active.thumbnailBytes + 80);
      const files = await filesUnder(targetRoot); assert.equal(files.length, 2);
      assert.ok(files.every(([name]) => name.startsWith(active.storageKey.toString("hex"))));
      const restoredStorage = await createMediaStorage({ root: targetRoot, key: keys.mediaKey });
      assert.ok((await restoredStorage.get({ assetId: active.id, storageKey: active.storageKey, variant: "full" })).length > 0);
      assert.equal(Number((await targetConnection.query("SELECT COUNT(*) AS count FROM messages WHERE id = ?", [messageId]))[0].count), 1);
      // Earlier photo fixtures deliberately removed CRM and broadcast rows.
      // Validate this profile's real state without expecting a deleted campaign.
      await sourceUnchanged();
    });

    await t.test("notification photo checkpoint restores encrypted subscriptions and pending jobs offline without changing delivery state", async () => {
      const notificationKey = randomBytes(32), subscriptionId = id(), jobId = id();
      const curve = createECDH("prime256v1"); curve.generateKeys();
      const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-offline-backup-only", expirationTime: null,
        keys: { p256dh: curve.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
      await sourceConnection.query(`INSERT INTO push_subscriptions (id, user_id, role, session_id, credential_version, generation,
        endpoint_digest, subscription_encrypted, locale, created_at, updated_at) VALUES (?, ?, 'client', ?, 1, 1, ?, ?, 'fr', ?, ?)`,
      [subscriptionId, client.id, client.sessionId, endpointDigest(subscription.endpoint, notificationKey),
        sealSubscription(subscription, notificationKey, { subscriptionId, userId: client.id, generation: 1 }), sqlDate(now), sqlDate(now)]);
      await sourceConnection.query(`INSERT INTO push_outbox (id, message_id, subscription_id, subscription_generation,
        available_at, created_at, expires_at) VALUES (?, ?, ?, 1, ?, ?, ?)`, [jobId, messageId, subscriptionId, sqlDate(now), sqlDate(now), sqlDate(now + 86400000)]);
      originalDatabaseHash = await databaseHash(options.database); originalFiles = await filesUnder(sourceRoot);
      const notificationDependencies = (database, root, key = notificationKey) => {
        const deps = dependencies(database, root), configure = deps.configure;
        deps.configure = () => { const config = configure(); delete config.keys.crmKey; config.keys.notificationKey = key; return config; };
        return deps;
      };
      const file = path.join(temporaryRoot, "photos-notify-checkpoint.json"), args = command => [command, "--offline", "--manifest", file, "--profile", "photos-notify"];
      assert.equal((await main(args("prepare"), process.env, notificationDependencies(options.database, sourceRoot))).prepared, true);
      const manifest = JSON.parse(await readFile(file, "utf8")); assert.equal(manifest.version, 3); assert.equal(manifest.profile, "messaging-photos-notify");
      assert.deepEqual(Object.keys(manifest.payload.canaries).sort(), ["totpKey", "mailKey", "messageKey", "mediaKey", "notificationKey"].sort());
      const legacy = dependencies(options.database, sourceRoot), configureLegacy = legacy.configure;
      legacy.configure = () => { const config = configureLegacy(); delete config.keys.crmKey; return config; };
      await assert.rejects(main(["prepare", "--offline", "--manifest", path.join(temporaryRoot, "must-not-omit-notifications.json"), "--profile", "photos"], process.env, legacy), backupError);
      await clone();
      const before = await databaseHash(restoreDatabase), filesBefore = await filesUnder(targetRoot);
      await assert.rejects(main(args("verify"), targetEnv, notificationDependencies(restoreDatabase, targetRoot, randomBytes(32))), backupError);
      assert.equal((await main(args("verify"), targetEnv, notificationDependencies(restoreDatabase, targetRoot))).verified, true);
      assert.equal(await databaseHash(restoreDatabase), before); assert.deepEqual(await filesUnder(targetRoot), filesBefore);
      assert.equal((await main(args("restore"), targetEnv, notificationDependencies(restoreDatabase, targetRoot))).restored, true);
      const job = (await targetConnection.query("SELECT status, attempts, lease_token, lease_until, finished_at FROM push_outbox WHERE id = ?", [jobId]))[0];
      assert.deepEqual({ ...job }, { status: "pending", attempts: 0, lease_token: null, lease_until: null, finished_at: null });
      assert.equal((await targetConnection.query("SELECT enabled FROM push_subscriptions WHERE id = ?", [subscriptionId]))[0].enabled, 1);
      const completed = await databaseHash(restoreDatabase);
      assert.equal((await main(args("restore"), targetEnv, notificationDependencies(restoreDatabase, targetRoot))).restored, true);
      assert.equal(await databaseHash(restoreDatabase), completed); await sourceUnchanged();
      for (const text of output) assert.equal(text.includes(notificationKey.toString("base64url")) || text.includes(subscription.endpoint), false);
    });

    for (const { crm: crmProfile, broadcast = false } of [{ crm: false }, { crm: true }, { crm: true, broadcast: true }]) await t.test(`${broadcast ? "broadcast, CRM and recovery" : crmProfile ? "CRM and recovery" : "recovery"} notification checkpoint captures populated SQL and restores its isolated application clone without sending mail or Push`, async () => {
      // This starts with real populated tables and authenticated ciphertext,
      // then copies SQL to the separately named disposable schema. No worker,
      // HTTP application, mail transport or Push transport is started.
      for (const table of ["push_outbox", "push_subscriptions"]) await sourceConnection.query(`DELETE FROM ${qualified(options.database, table)}`);
      if (broadcast) for (const table of ["broadcast_recipients", "broadcast_campaigns", "broadcast_preferences", "crm_memberships", "crm_labels", "crm_profiles"])
        await sourceConnection.query(`DELETE FROM ${qualified(options.database, table)}`);
      const broadcastId = id(), broadcastPayload = { title: "Synthetic full backup campaign", body: "Synthetic restored campaign only", mediaId: null,
        allowRepeatMedia: false, conversationIds: [conversationId.toString("hex")] };
      const broadcastEncrypted = sealPayload(broadcastPayload, keys.messageKey, { adminId: admin.id, campaignId: broadcastId });
      if (broadcast) {
        await sourceConnection.query("INSERT INTO broadcast_preferences (user_id, enabled, version, created_at, updated_at) VALUES (?, 1, 1, ?, ?)", [client.id, sqlDate(now), sqlDate(now)]);
        await sourceConnection.query(`INSERT INTO broadcast_campaigns (id, admin_id, client_campaign_id, mfa_version, payload_encrypted, request_fingerprint,
          created_at, updated_at, expires_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`, [broadcastId, admin.id, id(), broadcastEncrypted,
          campaignFingerprint(broadcastPayload, keys.messageKey, { adminId: admin.id }), sqlDate(now), sqlDate(now), sqlDate(now + 86400000)]);
        await sourceConnection.query(`INSERT INTO broadcast_recipients (campaign_id, conversation_id, client_id, proposed_message_id, client_message_id, available_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [broadcastId, conversationId, client.id, id(), id(), sqlDate(now), sqlDate(now)]);
      }
      const notificationKey = randomBytes(32), subscriptionId = id(), pushJobId = id(), recoveryId = id(), recoveryJobId = id();
      const recoveryToken = randomBytes(32).toString("base64url");
      const curve = createECDH("prime256v1"); curve.generateKeys();
      const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-recovery-isolated-clone", expirationTime: null,
        keys: { p256dh: curve.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
      const recoveryEncrypted = sealResetPayload({ email: client.email, token: recoveryToken }, keys.mailKey, recoveryJobId);
      const privateNotes = "Synthetic restored shared notes with reminder", labelId = id();
      const notesEncrypted = sealNotes(privateNotes, keys.crmKey, { adminId: admin.id, conversationId, version: "2" });
      if (crmProfile) {
        await sourceConnection.query(`INSERT INTO crm_profiles (admin_id, conversation_id, nickname, notes_encrypted, reminder_at, version, notes_revision, created_at, updated_at)
          VALUES (?, ?, 'Synthetic shared record', ?, ?, 3, 2, ?, ?)`, [admin.id, conversationId, notesEncrypted, sqlDate(now + 86400000), sqlDate(now), sqlDate(now)]);
        await sourceConnection.query(`INSERT INTO crm_labels (id, owner_admin_id, kind, name, normalized_name, created_at, updated_at)
          VALUES (?, ?, 'tag', 'Synthetic restore label', 'synthetic restore label', ?, ?)`, [labelId, admin.id, sqlDate(now), sqlDate(now)]);
        await sourceConnection.query(`INSERT INTO crm_memberships (admin_id, conversation_id, label_id, created_at) VALUES (?, ?, ?, ?)`, [admin.id, conversationId, labelId, sqlDate(now)]);
      }
      await sourceConnection.query(`INSERT INTO client_password_resets (id, user_id, token_hash, credential_version, email_hash, created_at, expires_at)
        VALUES (?, ?, ?, 1, ?, ?, ?)`, [recoveryId, client.id, tokenDigest(recoveryToken), createHash("sha256").update(client.email, "utf8").digest(), sqlDate(now), sqlDate(now + 1800000)]);
      await sourceConnection.query(`INSERT INTO password_reset_outbox (id, reset_id, recipient_user_id, payload_encrypted, available_at, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [recoveryJobId, recoveryId, client.id, recoveryEncrypted, sqlDate(now), sqlDate(now + 1800000), sqlDate(now)]);
      await sourceConnection.query(`INSERT INTO push_subscriptions (id, user_id, role, session_id, credential_version, generation,
        endpoint_digest, subscription_encrypted, locale, created_at, updated_at) VALUES (?, ?, 'client', ?, 1, 1, ?, ?, 'fr', ?, ?)`,
      [subscriptionId, client.id, client.sessionId, endpointDigest(subscription.endpoint, notificationKey),
        sealSubscription(subscription, notificationKey, { subscriptionId, userId: client.id, generation: 1 }), sqlDate(now), sqlDate(now)]);
      await sourceConnection.query(`INSERT INTO push_outbox (id, message_id, subscription_id, subscription_generation,
        available_at, created_at, expires_at) VALUES (?, ?, ?, 1, ?, ?, ?)`, [pushJobId, messageId, subscriptionId, sqlDate(now), sqlDate(now), sqlDate(now + 86400000)]);
      originalDatabaseHash = await databaseHash(options.database); originalFiles = await filesUnder(sourceRoot);
      const suppliedKeys = [];
      const deps = (database, root, changed = {}) => {
        const selected = dependencies(database, root, {}, changed), configure = selected.configure;
        selected.configure = () => {
          const config = configure(); if (!crmProfile) delete config.keys.crmKey; config.keys.notificationKey = Buffer.from(notificationKey);
          suppliedKeys.push({ keys: config.keys, before: Object.fromEntries(Object.entries(config.keys).map(([name, key]) => [name, Buffer.from(key)])) });
          return config;
        };
        return selected;
      };
      const profileName = `photos-notify-recovery${crmProfile ? "-crm" : ""}${broadcast ? "-broadcast" : ""}`;
      const file = path.join(temporaryRoot, `${profileName}-application-checkpoint.json`);
      const args = command => [command, "--offline", "--manifest", file, "--profile", `${profileName}-application`];
      await assert.rejects(main(["prepare", "--offline", "--manifest", path.join(temporaryRoot, "must-not-hide-recovery.json"), "--profile", "photos-notify"],
        process.env, deps(options.database, sourceRoot)), backupError);
      if (crmProfile) {
        const oldProfile = dependencies(options.database, sourceRoot), configure = oldProfile.configure;
        oldProfile.configure = () => { const value = configure(); delete value.keys.crmKey; value.keys.notificationKey = Buffer.from(notificationKey); return value; };
        await assert.rejects(main(["prepare", "--offline", "--manifest", path.join(temporaryRoot, "must-not-hide-crm.json"), "--profile", "photos-notify-recovery"], process.env, oldProfile), backupError);
      }
      const strictFile = path.join(temporaryRoot, `${profileName}-strict-checkpoint.json`);
      if (broadcast) await assert.rejects(main(["prepare", "--offline", "--manifest", path.join(temporaryRoot, "must-not-hide-campaigns.json"),
        "--profile", "photos-notify-recovery-crm"], process.env, deps(options.database, sourceRoot)), backupError);
      assert.equal((await main(["prepare", "--offline", "--manifest", strictFile, "--profile", profileName],
        process.env, deps(options.database, sourceRoot))).prepared, true);
      const strictManifest = JSON.parse(await readFile(strictFile, "utf8"));
      assert.equal(strictManifest.version, broadcast ? 9 : crmProfile ? 7 : 5); assert.equal(strictManifest.profile, `messaging-${profileName}`);
      assert.equal((await main(args("prepare"), process.env, deps(options.database, sourceRoot))).prepared, true);
      const manifest = JSON.parse(await readFile(file, "utf8"));
      assert.equal(manifest.version, broadcast ? 10 : crmProfile ? 8 : 6); assert.equal(manifest.profile, `messaging-${profileName}-application`);
      assert.equal(manifest.payload.snapshot.version, 2);
      assert.equal(manifest.payload.snapshot.coverage.scope, "application-tables");
      assert.equal(manifest.payload.snapshot.coverage.completeDatabase, false);
      assert.deepEqual(Object.keys(manifest.payload.canaries).sort(), ["totpKey", "mailKey", "messageKey", "mediaKey", "notificationKey", ...(crmProfile ? ["crmKey"] : [])].sort());
      await sourceUnchanged(); await clone();
      const before = await databaseHash(restoreDatabase), filesBefore = await filesUnder(targetRoot);
      await assert.rejects(main(args("verify"), targetEnv, deps(restoreDatabase, targetRoot, { mailKey: randomBytes(32) })), backupError);
      if (crmProfile) {
        await assert.rejects(main(args("restore"), targetEnv, deps(restoreDatabase, targetRoot, { crmKey: randomBytes(32) })), backupError);
        assert.equal(await databaseHash(restoreDatabase), before); assert.deepEqual(await filesUnder(targetRoot), filesBefore);
        const changed = sealNotes("Synthetic tampering", keys.crmKey, { adminId: admin.id, conversationId, version: "2" });
        await targetConnection.query("UPDATE crm_profiles SET notes_encrypted = ? WHERE admin_id = ? AND conversation_id = ?", [changed, admin.id, conversationId]);
        const changedHash = await databaseHash(restoreDatabase);
        await assert.rejects(main(args("restore"), targetEnv, deps(restoreDatabase, targetRoot)), backupError);
        assert.equal(await databaseHash(restoreDatabase), changedHash); assert.deepEqual(await filesUnder(targetRoot), filesBefore);
        await targetConnection.query("UPDATE crm_profiles SET notes_encrypted = ? WHERE admin_id = ? AND conversation_id = ?", [notesEncrypted, admin.id, conversationId]);
        assert.equal(await databaseHash(restoreDatabase), before);
      }
      assert.equal((await main(args("verify"), targetEnv, deps(restoreDatabase, targetRoot))).verified, true);
      assert.equal(await databaseHash(restoreDatabase), before); assert.deepEqual(await filesUnder(targetRoot), filesBefore);
      const restored = await main(args("restore"), targetEnv, deps(restoreDatabase, targetRoot));
      assert.equal(restored.restored, true); assert.equal(restored.releasedCandidates, 3);
      const reset = (await targetConnection.query("SELECT status, attempts, lease_token, lease_until, sent_at, payload_encrypted FROM password_reset_outbox WHERE id = ?", [recoveryJobId]))[0];
      assert.deepEqual({ ...reset }, { status: "pending", attempts: 0, lease_token: null, lease_until: null, sent_at: null, payload_encrypted: recoveryEncrypted });
      const challenge = (await targetConnection.query("SELECT user_id, token_hash, email_hash, credential_version, consumed_at FROM client_password_resets WHERE id = ?", [recoveryId]))[0];
      assert.deepEqual(challenge.user_id, client.id); assert.deepEqual(challenge.token_hash, tokenDigest(recoveryToken));
      assert.deepEqual(challenge.email_hash, createHash("sha256").update(client.email, "utf8").digest()); assert.equal(challenge.credential_version, 1); assert.equal(challenge.consumed_at, null);
      const push = (await targetConnection.query("SELECT status, attempts, lease_token, lease_until, finished_at FROM push_outbox WHERE id = ?", [pushJobId]))[0];
      assert.deepEqual({ ...push }, { status: "pending", attempts: 0, lease_token: null, lease_until: null, finished_at: null });
      assert.equal((await targetConnection.query("SELECT enabled FROM push_subscriptions WHERE id = ?", [subscriptionId]))[0].enabled, 1);
      assert.equal(Number((await targetConnection.query("SELECT COUNT(*) AS count FROM sessions WHERE id IN (?, ?)", [client.sessionId, admin.sessionId]))[0].count), 2);
      if (crmProfile) {
        const profile = (await targetConnection.query("SELECT nickname, notes_encrypted, reminder_at, version, notes_revision FROM crm_profiles WHERE admin_id = ? AND conversation_id = ?", [admin.id, conversationId]))[0];
        assert.equal(profile.nickname, "Synthetic shared record"); assert.equal(Number(profile.version), 3); assert.equal(Number(profile.notes_revision), 2);
        const reminder = profile.reminder_at instanceof Date ? profile.reminder_at.getTime() : Date.parse(`${profile.reminder_at.replace(" ", "T")}Z`);
        assert.equal(reminder, now + 86400000);
        assert.equal(profile.notes_encrypted, notesEncrypted); assert.equal(openNotes(profile.notes_encrypted, keys.crmKey, { adminId: admin.id, conversationId, version: "2" }), privateNotes);
        assert.equal(Number((await targetConnection.query("SELECT COUNT(*) AS n FROM crm_memberships WHERE admin_id = ? AND conversation_id = ? AND label_id = ?", [admin.id, conversationId, labelId]))[0].n), 1);
        assert.equal((await targetConnection.query("SELECT name FROM crm_labels WHERE id = ?", [labelId]))[0].name, "Synthetic restore label");
      }
      if (broadcast) {
        const campaign = (await targetConnection.query("SELECT payload_encrypted, status FROM broadcast_campaigns WHERE id = ?", [broadcastId]))[0];
        assert.equal(campaign.payload_encrypted, broadcastEncrypted); assert.equal(campaign.status, "queued");
        assert.equal(Number((await targetConnection.query("SELECT COUNT(*) AS n FROM broadcast_recipients WHERE campaign_id = ? AND state = 'pending'", [broadcastId]))[0].n), 1);
        assert.equal(Number((await targetConnection.query("SELECT enabled FROM broadcast_preferences WHERE user_id = ?", [client.id]))[0].enabled), 1);
      }
      const completed = await databaseHash(restoreDatabase);
      assert.equal((await main(args("restore"), targetEnv, deps(restoreDatabase, targetRoot))).restored, true);
      assert.equal(await databaseHash(restoreDatabase), completed); await sourceUnchanged();
      for (const supplied of suppliedKeys) assert.deepEqual(supplied.keys, supplied.before, "verification erases only its own key copies");
      for (const text of output) for (const privateValue of [recoveryToken, recoveryEncrypted, privateNotes, notesEncrypted, subscription.endpoint, notificationKey.toString("base64url")])
        assert.equal(text.includes(privateValue), false);
    });

    assert.ok(output.length > 0);
    for (const text of output) for (const key of Object.values(keys)) assert.equal(text.includes(key.toString("base64url")), false);
  } finally {
    try { if (sourcePool) await sourcePool.end(); if (targetPool) await targetPool.end(); }
    finally {
      try { await reset(restoreDatabase); await reset(options.database); }
      finally {
        try { await targetConnection.end(); await sourceConnection.end(); }
        finally { if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true }); }
      }
    }
  }
});
