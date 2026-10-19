import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { createErasureStore } from "../server/data/erasure-store.mjs";
import { createErasureJournal, readErasureJournalBatch } from "../server/data/erasure-journal.mjs";
import { createApplicationInspectionPool } from "../server/backup/application-scope.mjs";
import { backupIdentity, createBackupManifest, manifestHash, writeManifest } from "../server/backup/manifest.mjs";
import { captureBackupSnapshot, createBackupSnapshotStore } from "../server/backup/snapshot.mjs";
import { reconcileManualRestore } from "../server/backup/manual-restore.mjs";
import { assertNoOperationalRestore, operationalStateHash, captureOperationalState, restoreOperationalQuarantine, writeOperationalCheckpoint } from "../server/backup/operational-checkpoint.mjs";
import { writeCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";
import { APPLICATION_COVERAGE } from "../server/backup/application-scope.mjs";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { erasureDirectory } from "./fixtures/erasure-files.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const hex = value => value.toString("hex"), id = () => randomBytes(16);
const hash = value => createHash("sha256").update(value).digest("hex");
const sqlDate = at => new Date(at).toISOString().replace("T", " ").replace("Z", "000");
const files = async directory => Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async name => [name, hash(await readFile(path.join(directory, name)))])));
const cell = value => Buffer.isBuffer(value) ? { binary: hex(value) } : typeof value === "bigint" ? { integer: String(value) } : value;

test("manual local restoration reconciles later closures on a distinct MariaDB/media clone without witness or exhaustive SQL inventory", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with two explicit loopback disposable databases.", timeout: 240000,
}, async t => {
  const options = databaseOptions(), targetDatabase = process.env.JESSIEMESSAGE_RESTORE_TEST_DATABASE;
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.match(targetDatabase, /^jessiemessage_test(?:_[a-z0-9]+)*$/); assert.notEqual(targetDatabase, options.database);
  const targetEnv = { ...process.env, JESSIEMESSAGE_DB_NAME: targetDatabase, JESSIEMESSAGE_MIGRATION_DATABASE: targetDatabase, JESSIEMESSAGE_APPLICATION_DATABASE: targetDatabase };
  const migrations = await loadMigrations(), tables = createdMigrationTables(migrations), allowed = [...tables, "schema_migrations", "migration_probe"];
  assert.equal(migrations.length, 30); assert.equal(tables.length, 29);
  const sourceConnection = await connectDatabase(), targetConnection = await connectDatabase(targetEnv);
  let sourcePool, targetPool, sourceInspector, targetInspector;
  const directory = await erasureDirectory(t), sourceRoot = path.join(directory, "source-media"), targetRoot = path.join(directory, "target-media"),
    sourceJournal = path.join(directory, "source-journal"), quarantineRoot = path.join(directory, "quarantine"), checkpointRoot = path.join(directory, "checkpoint"), checkpointMedia = path.join(checkpointRoot, "media");
  for (const root of [sourceRoot, targetRoot, sourceJournal, quarantineRoot, checkpointRoot, checkpointMedia]) await mkdir(root, { mode: 0o700 });
  const keys = Object.fromEntries(["totpKey", "mailKey", "messageKey", "mediaKey", "crmKey", "notificationKey"].map((name, i) => [name, Buffer.alloc(32, i + 1)]));
  const sourceStorage = await createMediaStorage({ root: sourceRoot, key: keys.mediaKey, pathMode: "linux-dirfd" }),
    targetStorage = await createMediaStorage({ root: targetRoot, key: keys.mediaKey, pathMode: "linux-dirfd" });
  const sourceFingerprint = await sourceStorage.fingerprint(), targetFingerprint = await targetStorage.fingerprint();
  const sourceBinding = { database: options.database, rootFingerprint: hex(sourceFingerprint) }, targetBinding = { database: targetDatabase, rootFingerprint: hex(targetFingerprint) };
  const limits = { ownerBytes: 1048576, totalBytes: 104857600 }, now = Date.parse("2026-10-19T19:00:00Z"), created = sqlDate(now - 60000), clock = () => now + 10000;
  const admin = id(), client = id(), peer = id(), absentClient = id(), own = [], peerAssets = [];
  const qualified = (database, table) => {
    assert.ok([options.database, targetDatabase].includes(database)); assert.ok(allowed.includes(table)); return `\`${database}\`.\`${table}\``;
  };
  async function reset(database) {
    const actual = await sourceConnection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
    assert.ok(actual.every(row => allowed.includes(row.name)), "Never clean an unrelated table");
    for (const table of [...tables].reverse().concat(["migration_probe", "schema_migrations"])) await sourceConnection.query(`DROP TABLE IF EXISTS ${qualified(database, table)}`);
  }
  async function databaseHash(database) {
    const digest = createHash("sha256");
    for (const table of [...tables, "schema_migrations"]) {
      const rows = await sourceConnection.query(`SELECT * FROM ${qualified(database, table)}`);
      digest.update(table).update(JSON.stringify(rows.map(row => JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(name => [name, cell(row[name])])))).sort()));
    }
    return digest.digest("hex");
  }
  async function insertUser(uid, role, connection = sourceConnection) {
    await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at, age_assured_at,
      access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-password-hash', ?, ?, ?, ?, ?)`,
    [uid, role, `Synthetic ${hex(uid)}`, `${hex(uid)}@example.invalid`, created, created, created, created, created]);
    if (role === "client") {
      await connection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [uid, created]);
      await consumeSyntheticInvitation(connection, uid, now - 60000);
    }
  }
  async function insertAsset(uid) {
    const assetId = id(), storageKey = randomBytes(32), full = randomBytes(400), thumbnail = randomBytes(100), digest = createHash("sha256").update(full).digest();
    await sourceStorage.put({ assetId, storageKey, full, thumbnail });
    await sourceConnection.query(`INSERT INTO media_assets (id, owner_id, owner_role, storage_key, content_digest, active_digest,
      width, height, thumbnail_width, thumbnail_height, full_bytes, thumbnail_bytes, created_at)
      VALUES (?, ?, 'client', ?, ?, ?, 100, 80, 50, 40, 400, 100, ?)`, [assetId, uid, storageKey, digest, digest, created]);
    await sourceConnection.query(`INSERT INTO media_storage_objects (id, owner_id, owner_role, storage_key, content_digest, full_bytes, thumbnail_bytes,
      stored_bytes, state, asset_id, created_at, updated_at) VALUES (?, ?, 'client', ?, ?, 400, 100, 580, 'registered', ?, ?, ?)`, [assetId, uid, storageKey, digest, assetId, created, created]);
    await sourceConnection.query("UPDATE media_storage_state SET held_bytes = held_bytes + 580 WHERE id = 1");
    return { id: assetId, storageKey, full, thumbnail };
  }
  async function clone() {
    await reset(targetDatabase); await applyMigrations(targetConnection, { database: targetDatabase, migrations });
    await targetConnection.beginTransaction();
    try {
      await targetConnection.query("DELETE FROM schema_migrations");
      for (const table of [...tables, "schema_migrations"]) await targetConnection.query(`INSERT INTO ${qualified(targetDatabase, table)} SELECT * FROM ${qualified(options.database, table)}`);
      await targetConnection.commit();
    } catch (error) { await targetConnection.rollback(); throw error; }
    for (const name of await readdir(targetRoot)) await unlink(path.join(targetRoot, name));
    for (const name of await readdir(sourceRoot)) { await copyFile(path.join(sourceRoot, name), path.join(targetRoot, name)); await chmod(path.join(targetRoot, name), 0o600); }
  }
  try {
    await reset(targetDatabase); await reset(options.database); await applyMigrations(sourceConnection, { database: options.database, migrations });
    sourcePool = await createRuntimePool(process.env); targetPool = await createRuntimePool(targetEnv);
    sourceInspector = await createApplicationInspectionPool(process.env); targetInspector = await createApplicationInspectionPool(targetEnv);
    await sourceConnection.query("INSERT INTO media_storage_state (id, owner_bytes, total_bytes, root_fingerprint, held_bytes, initialized_at) VALUES (1, ?, ?, ?, 0, ?)", [limits.ownerBytes, limits.totalBytes, sourceFingerprint, created]);
    await insertUser(admin, "admin"); await insertUser(client, "client"); await insertUser(peer, "client");
    own.push(await insertAsset(client), await insertAsset(client)); peerAssets.push(await insertAsset(peer));
    for (const [uid, at] of [[admin, now - 50000], [peer, now + 60000]]) await sourceConnection.query(
      "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [id(), uid, randomBytes(32), sqlDate(at), sqlDate(at + 3600000)]);
    const snapshot = await captureBackupSnapshot({ store: createBackupSnapshotStore({ pool: sourcePool, inspectionPool: sourceInspector, coverage: "application-tables" }) });
    const sourceIdentity = await backupIdentity({ databaseName: options.database, rootPath: sourceRoot, storage: sourceStorage, mediaKey: keys.mediaKey }),
      targetIdentity = await backupIdentity({ databaseName: targetDatabase, rootPath: targetRoot, storage: targetStorage, mediaKey: keys.mediaKey });
    const manifest = createBackupManifest({ snapshot, identity: sourceIdentity, keys, now, profile: "messaging-photos-notify-recovery-crm-broadcast-application" });
    assert.equal(manifest.version, 10);
    const readRecentRegistry = () => withPrivateDirectory(sourceJournal, scope => captureOperationalState(scope, { key: keys.crmKey, binding: sourceBinding }));
    const backup = await readRecentRegistry();
    await writeManifest(path.join(checkpointRoot, "manifest.json"), manifest, { pathMode: "linux-dirfd" });
    const sql = Buffer.from("-- Synthetic SQL already imported by the isolated fixture\n"), compressedSql = gzipSync(sql), mediaFiles = [];
    await writeFile(path.join(checkpointRoot, "database.sql.gz"), compressedSql, { mode: 0o600, flag: "wx" });
    for (const name of (await readdir(sourceRoot)).sort()) {
      const bytes = await readFile(path.join(sourceRoot, name)); await copyFile(path.join(sourceRoot, name), path.join(checkpointMedia, name)); await chmod(path.join(checkpointMedia, name), 0o600);
      mediaFiles.push({ name, bytes: bytes.length, sha256: hash(bytes) });
    }
    const receipt = { format: "jessiemessage-private-checkpoint", version: 10, profile: "messaging-photos-notify-recovery-crm-broadcast-application", coverage: { ...APPLICATION_COVERAGE }, createdAt: now,
      schema: { tables: 30, migrations: 30 }, sql: { file: "database.sql.gz", bytes: compressedSql.length, sha256: hash(compressedSql), uncompressedBytes: sql.length, uncompressedSha256: hash(sql) },
      manifest: { file: "manifest.json", sha256: manifestHash(manifest) }, media: { files: mediaFiles, bytes: mediaFiles.reduce((sum, file) => sum + file.bytes, 0) } };
    receipt.operations = await withPrivateDirectory(checkpointRoot, scope => writeOperationalCheckpoint(scope, backup, receipt, keys.crmKey));
    await withPrivateDirectory(checkpointRoot, scope => writeCheckpointReceipt(scope, receipt));
    await withPrivateDirectory(quarantineRoot, scope => restoreOperationalQuarantine(scope, { backup, current: backup, targetBinding, key: keys.crmKey,
      expectedCurrentSha256: operationalStateHash(backup), assertCurrent: async expected => assert.equal(operationalStateHash(await readRecentRegistry()), expected) }));
    async function advance(uid, phase, cursor) {
      const journal = createErasureJournal({ directory: sourceJournal, key: keys.crmKey, binding: sourceBinding, clientId: hex(uid) });
      try { const current = await journal.read(), at = now + current.revision;
        await journal.save(current.record ? { ...current.record, phase, updatedAt: at, ...(cursor ? { cursor } : {}) }
          : { version: 1, clientId: hex(uid), binding: sourceBinding, phase, cursor: null, startedAt: at, updatedAt: at }, current.revision, async () => {});
      } finally { journal.close(); }
    }
    for (const uid of [client, absentClient]) {
      await advance(uid, "requested"); await advance(uid, "prepared"); await advance(uid, "prepared", "f".repeat(32));
      if (uid === client) { await advance(uid, "files_erased"); await advance(uid, "completed"); }
    }
    const recentRegistry = await readRecentRegistry(), expectedRegistrySha256 = operationalStateHash(recentRegistry);
    const originalSql = await databaseHash(options.database), originalFiles = await files(sourceRoot), originalJournal = await files(sourceJournal), originalQuarantine = await files(quarantineRoot), originalCheckpoint = await Promise.all(["receipt.json", "manifest.json", "operations.enc.json", "database.sql.gz"].map(async name => [name, hash(await readFile(path.join(checkpointRoot, name)))]));
    let sequence = 0;
    async function fixture() {
      await clone(); const progressDirectory = path.join(directory, `manual-progress-${++sequence}`), journalDirectory = path.join(directory, `manual-journal-${sequence}`);
      for (const root of [progressDirectory, journalDirectory]) await mkdir(root, { mode: 0o700 });
      let maintained = false;
      return { checkpointDirectory: checkpointRoot, quarantineDirectory: quarantineRoot, journalDirectory, progressDirectory, recentRegistry, expectedRegistrySha256, readRecentRegistry, keys,
        target: { database: targetDatabase, rootPath: targetRoot, pool: targetPool, inspectionPool: targetInspector, storage: targetStorage },
        maintenance: { async withQuiescedProducers(work) { assert.equal(maintained, false); maintained = true; try { return await work(async () => assert.equal(maintained, true)); } finally { maintained = false; } } },
        assertReady: async () => { assert.equal(maintained, true); }, clock };
    }
    async function unchanged() {
      assert.equal(await databaseHash(options.database), originalSql); assert.deepEqual(await files(sourceRoot), originalFiles); assert.deepEqual(await files(sourceJournal), originalJournal);
      assert.deepEqual(await files(quarantineRoot), originalQuarantine); assert.equal(JSON.stringify(await readRecentRegistry()), JSON.stringify(recentRegistry));
      assert.deepEqual(await Promise.all(originalCheckpoint.map(async ([name]) => [name, hash(await readFile(path.join(checkpointRoot, name)))])), originalCheckpoint);
      await assert.rejects(withPrivateDirectory(quarantineRoot, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
    }
    async function finalState(input) {
      const store = createErasureStore({ pool: targetPool, database: targetDatabase, capacity: { ...limits, rootFingerprint: targetFingerprint }, broadcastKey: keys.messageKey });
      for (const uid of [client, absentClient]) assert.deepEqual(await store.withLease(hex(uid), scope => scope.verifyAbsent(clock())), { absent: true });
      for (const uid of [admin, peer]) assert.equal(Number((await targetConnection.query("SELECT COUNT(*) AS value FROM users WHERE id = ?", [uid]))[0].value), 1);
      assert.equal(Number((await targetConnection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0].held_bytes), 580);
      for (const asset of peerAssets) for (const variant of ["full", "thumb"]) assert.deepEqual(await targetStorage.get({ assetId: asset.id, storageKey: asset.storageKey, variant }), variant === "full" ? asset.full : asset.thumbnail);
      for (const asset of own) for (const variant of ["full", "thumb"]) assert.equal((await targetStorage.inspectEntry({ storageKey: asset.storageKey, variant })).exists, false);
      assert.equal(Number((await targetConnection.query("SELECT COUNT(*) AS value FROM sessions WHERE revoked_at IS NULL"))[0].value), 0);
      const sessions = await targetConnection.query("SELECT created_at, revoked_at FROM sessions"); assert.equal(sessions.length, 2); assert.ok(sessions.every(row => row.revoked_at >= row.created_at));
      const journals = await readErasureJournalBatch({ directory: input.journalDirectory, key: keys.crmKey, binding: targetBinding, limit: 100 });
      assert.equal(journals.jobs.length, 2); assert.ok(journals.jobs.every(job => job.phase === "completed"));
      await assert.rejects(withPrivateDirectory(input.journalDirectory, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" }); await unchanged();
    }
    await t.test("late completed and pending source receipts replay from the start, revoke sessions, preserve peers and retain both holds", async () => {
      const input = await fixture(), report = await reconcileManualRestore(input);
      assert.equal(report.status, "manual_restore_reconciled_quarantined"); assert.equal(report.reconciledReceipts, 2); assert.equal(report.sessionsRevoked, true);
      assert.equal(report.externalRegistryContinuityVerified, false); assert.equal(report.completeDatabase, false); assert.equal(report.manualReopenRequired, true); assert.equal(report.started, false);
      await finalState(input); const before = await files(input.journalDirectory); await reconcileManualRestore(input); assert.deepEqual(await files(input.journalDirectory), before); await finalState(input);
      const journalFile = (await readdir(input.journalDirectory)).find(name => /^erasure-/.test(name)); const journalBytes = await readFile(path.join(input.journalDirectory, journalFile));
      await unlink(path.join(input.journalDirectory, journalFile)); await assert.rejects(reconcileManualRestore(input), { code: "MANUAL_RESTORE_PROGRESS" });
      await writeFile(path.join(input.journalDirectory, journalFile), journalBytes, { mode: 0o600, flag: "wx" });
      await insertUser(client, "client", targetConnection); await assert.rejects(reconcileManualRestore(input), { code: "MANUAL_RESTORE_ACCOUNT_REAPPEARED" });
      assert.equal(Number((await targetConnection.query("SELECT COUNT(*) AS value FROM users WHERE id = ?", [client]))[0].value), 1); await unchanged();
    });
    await t.test("missing or changed operator registry never mutates the isolated clone", async () => {
      const input = await fixture(), sqlBefore = await databaseHash(targetDatabase), filesBefore = await files(targetRoot);
      await assert.rejects(reconcileManualRestore({ ...input, recentRegistry: null }), { code: "MANUAL_RESTORE_INPUT" });
      await assert.rejects(reconcileManualRestore({ ...input, readRecentRegistry: async () => backup }), { code: "MANUAL_RESTORE_REGISTRY_CHANGED" });
      assert.equal(await databaseHash(targetDatabase), sqlBefore); assert.deepEqual(await files(targetRoot), filesBefore); assert.deepEqual(await readdir(input.progressDirectory), []); await unchanged();
    });
    await t.test("an unavailable maintenance guard refuses SQL and target publication", async () => {
      const input = await fixture(), sqlBefore = await databaseHash(targetDatabase);
      await assert.rejects(reconcileManualRestore({ ...input, maintenance: { async withQuiescedProducers(work) { return work(async () => { throw new Error("Synthetic producer remains active"); }); } } }), { code: "MANUAL_RESTORE_UNAVAILABLE" });
      assert.equal(await databaseHash(targetDatabase), sqlBefore); assert.deepEqual(await readdir(input.journalDirectory), []); await unchanged();
    });
    await t.test("a committed target capacity rebind with lost acknowledgement resumes under the same prepared progress", async () => {
      const input = await fixture(); let interrupted = false;
      const pool = { async getConnection() { const connection = await targetPool.getConnection(); let rebinding = false;
        return { ...connection, async query(sql, params) { if (/UPDATE media_storage_state SET root_fingerprint/.test(sql)) rebinding = true; return connection.query(sql, params); },
          async commit() { await connection.commit(); if (rebinding && !interrupted) { interrupted = true; throw new Error("Synthetic lost rebind acknowledgement"); } } }; } };
      await assert.rejects(reconcileManualRestore({ ...input, target: { ...input.target, pool } }), { code: "MANUAL_RESTORE_UNAVAILABLE" }); assert.equal(interrupted, true);
      assert.deepEqual((await targetConnection.query("SELECT root_fingerprint FROM media_storage_state WHERE id = 1"))[0].root_fingerprint, targetFingerprint);
      const hold = await readFile(path.join(input.journalDirectory, "operational-restore.json"));
      await reconcileManualRestore(input); assert.deepEqual(await readFile(path.join(input.journalDirectory, "operational-restore.json")), hold); await finalState(input);
    });
    await t.test("registry drift after an unlink refuses further work and preserves the target hold for manual retry", async () => {
      const input = await fixture(); let changed = false;
      const storage = { ...targetStorage, async remove(value) { await targetStorage.remove(value); changed = true; } };
      await assert.rejects(reconcileManualRestore({ ...input, readRecentRegistry: async () => changed ? backup : recentRegistry, target: { ...input.target, storage } }), { code: "MANUAL_RESTORE_REGISTRY_CHANGED" });
      assert.equal(changed, true); const hold = await readFile(path.join(input.journalDirectory, "operational-restore.json"));
      await assert.rejects(withPrivateDirectory(input.journalDirectory, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
      await reconcileManualRestore(input); assert.deepEqual(await readFile(path.join(input.journalDirectory, "operational-restore.json")), hold); await finalState(input);
    });
    await t.test("an uncertain photo unlink resumes without replaying the source cursor or releasing peer capacity", async () => {
      const input = await fixture(); let interrupted = false;
      const storage = { ...targetStorage, async remove(value) { await targetStorage.remove(value); if (!interrupted) { interrupted = true; throw new Error("Synthetic acknowledgement lost after unlink"); } } };
      await assert.rejects(reconcileManualRestore({ ...input, target: { ...input.target, storage } }), { code: "MANUAL_RESTORE_UNAVAILABLE" }); assert.equal(interrupted, true);
      await reconcileManualRestore(input); await finalState(input);
    });
    await t.test("a lost finish acknowledgement resumes from target evidence without changing source envelopes", async () => {
      const input = await fixture(); let interrupted = false;
      const pool = { async getConnection() { const connection = await targetPool.getConnection(); let finishing = false;
        return { ...connection, async query(sql, params) { if (/DELETE FROM users WHERE id/.test(sql)) finishing = true; return connection.query(sql, params); },
          async commit() { await connection.commit(); if (finishing && !interrupted) { interrupted = true; throw new Error("Synthetic lost finish acknowledgement"); } } }; } };
      await assert.rejects(reconcileManualRestore({ ...input, target: { ...input.target, pool } }), { code: "MANUAL_RESTORE_UNAVAILABLE" }); assert.equal(interrupted, true);
      await reconcileManualRestore(input); await finalState(input);
    });
  } finally {
    await Promise.allSettled([sourcePool?.end(), targetPool?.end(), sourceInspector?.end(), targetInspector?.end()]);
    try { await reset(targetDatabase); await reset(options.database); } finally { await sourceConnection.end(); await targetConnection.end(); }
  }
});
