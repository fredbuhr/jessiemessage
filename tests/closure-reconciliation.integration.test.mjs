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
import { createErasureJournal } from "../server/data/erasure-journal.mjs";
import { createBackupInspectionPool } from "../server/backup/inspection.mjs";
import { backupIdentity, createBackupManifest, manifestHash, writeManifest } from "../server/backup/manifest.mjs";
import { captureBackupSnapshot, createBackupSnapshotStore } from "../server/backup/snapshot.mjs";
import { planClosureReconciliation } from "../server/backup/closure-reconciliation.mjs";
import { assertNoOperationalRestore, operationalStateHash, readOperationalQuarantine, restoreOperationalQuarantine, writeOperationalCheckpoint } from "../server/backup/operational-checkpoint.mjs";
import { writeCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";
import { APPLICATION_COVERAGE } from "../server/backup/application-scope.mjs";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { registryWitnessFixture } from "./fixtures/registry-witness.mjs";
import { erasureDirectory } from "./fixtures/erasure-files.mjs";
import { consumeSyntheticInvitation } from "./fixtures/manual-admission.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const hex = value => value.toString("hex"), id = () => randomBytes(16);
const hash = value => createHash("sha256").update(value).digest("hex");
const sqlDate = at => new Date(at).toISOString().replace("T", " ").replace("Z", "000");
const files = async directory => Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async name => [name, hash(await readFile(path.join(directory, name)))])));
const cell = value => Buffer.isBuffer(value) ? { binary: hex(value) } : typeof value === "bigint" ? { integer: String(value) } : value;

test("native closure reconciliation replays a source receipt into a distinct MariaDB/media clone and retains quarantine", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with two explicit loopback disposable databases.", timeout: 180000,
}, async t => {
  const options = databaseOptions(), targetDatabase = process.env.JESSIEMESSAGE_RESTORE_TEST_DATABASE;
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.match(targetDatabase, /^jessiemessage_test(?:_[a-z0-9]+)*$/); assert.notEqual(targetDatabase, options.database);
  const targetEnv = { ...process.env, JESSIEMESSAGE_DB_NAME: targetDatabase, JESSIEMESSAGE_MIGRATION_DATABASE: targetDatabase, JESSIEMESSAGE_APPLICATION_DATABASE: targetDatabase };
  const migrations = await loadMigrations(), tables = createdMigrationTables(migrations), allowed = [...tables, "schema_migrations", "migration_probe"];
  assert.equal(migrations.length, 33); assert.equal(tables.length, 32);
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
    sourceInspector = await createBackupInspectionPool(process.env); targetInspector = await createBackupInspectionPool(targetEnv);
    await sourceConnection.query("INSERT INTO media_storage_state (id, owner_bytes, total_bytes, root_fingerprint, held_bytes, initialized_at) VALUES (1, ?, ?, ?, 0, ?)", [limits.ownerBytes, limits.totalBytes, sourceFingerprint, created]);
    await insertUser(admin, "admin"); await insertUser(client, "client"); await insertUser(peer, "client");
    own.push(await insertAsset(client), await insertAsset(client)); peerAssets.push(await insertAsset(peer));
    const snapshot = await captureBackupSnapshot({ store: createBackupSnapshotStore({ pool: sourcePool, inspectionPool: sourceInspector, coverage: "application-tables" }) });
    const sourceIdentity = await backupIdentity({ databaseName: options.database, rootPath: sourceRoot, storage: sourceStorage, mediaKey: keys.mediaKey }),
      targetIdentity = await backupIdentity({ databaseName: targetDatabase, rootPath: targetRoot, storage: targetStorage, mediaKey: keys.mediaKey });
    const manifest = createBackupManifest({ snapshot, identity: sourceIdentity, keys, now, profile: "messaging-photos-notify-recovery-crm-broadcast-application" });
    assert.equal(manifest.version, 10);
    const witness = await registryWitnessFixture(t, { binding: sourceBinding, key: keys.crmKey, sourceDirectory: sourceJournal, withDirectory: withPrivateDirectory });
    const backup = await witness.readCurrent();
    await writeManifest(path.join(checkpointRoot, "manifest.json"), manifest, { pathMode: "linux-dirfd" });
    // SQL restoration is the exact INSERT/SELECT clone below, not an import in
    // this executor. The existing receipt nevertheless has real hashed files.
    const sql = Buffer.from("-- Synthetic capture already imported by fixture\n"), compressedSql = gzipSync(sql), mediaFiles = [];
    await writeFile(path.join(checkpointRoot, "database.sql.gz"), compressedSql, { mode: 0o600, flag: "wx" });
    for (const name of (await readdir(sourceRoot)).sort()) {
      const content = await readFile(path.join(sourceRoot, name));
      await copyFile(path.join(sourceRoot, name), path.join(checkpointMedia, name)); await chmod(path.join(checkpointMedia, name), 0o600);
      mediaFiles.push({ name, bytes: content.length, sha256: hash(content) });
    }
    const checkpointReceipt = { format: "jessiemessage-private-checkpoint", version: 10,
      profile: "messaging-photos-notify-recovery-crm-broadcast-application", coverage: { ...APPLICATION_COVERAGE }, createdAt: now,
      schema: { tables: 33, migrations: 33 }, sql: { file: "database.sql.gz", bytes: compressedSql.length, sha256: hash(compressedSql), uncompressedBytes: sql.length, uncompressedSha256: hash(sql) },
      manifest: { file: "manifest.json", sha256: manifestHash(manifest) }, media: { files: mediaFiles, bytes: mediaFiles.reduce((sum, file) => sum + file.bytes, 0) } };
    checkpointReceipt.operations = await withPrivateDirectory(checkpointRoot, scope => writeOperationalCheckpoint(scope, backup, checkpointReceipt, keys.crmKey));
    await withPrivateDirectory(checkpointRoot, scope => writeCheckpointReceipt(scope, checkpointReceipt));
    await withPrivateDirectory(quarantineRoot, scope => restoreOperationalQuarantine(scope, { backup, current: backup, targetBinding, key: keys.crmKey,
      expectedCurrentSha256: operationalStateHash(backup), assertCurrent: async expected => assert.equal(operationalStateHash(await witness.readCurrent()), expected) }));
    async function advance(uid, phase, cursor) {
      const journal = createErasureJournal({ directory: sourceJournal, key: keys.crmKey, binding: sourceBinding, clientId: hex(uid) });
      try {
        const current = await journal.read(), at = now + current.revision;
        await journal.save(current.record ? { ...current.record, phase, updatedAt: at, ...(cursor ? { cursor } : {}) }
          : { version: 1, clientId: hex(uid), binding: sourceBinding, phase, cursor: null, startedAt: at, updatedAt: at }, current.revision, async () => {});
      } finally { journal.close(); }
      await witness.gate.verify(async () => {});
    }
    for (const uid of [client, absentClient]) {
      await advance(uid, "requested"); await advance(uid, "prepared"); await advance(uid, "prepared", "f".repeat(32));
      if (uid === client) { await advance(uid, "files_erased"); await advance(uid, "completed"); }
    }
    const originalSql = await databaseHash(options.database), originalFiles = await files(sourceRoot), originalJournal = await files(sourceJournal), originalMarker = await files(quarantineRoot), originalManifest = JSON.stringify(manifest),
      originalReceipt = await readFile(path.join(checkpointRoot, "receipt.json")), originalCapsule = await readFile(path.join(checkpointRoot, "operations.enc.json"));
    let sequence = 0;
    async function parameters() {
      return { key: keys.crmKey, backup, local: await witness.readCurrent(), quarantine: await withPrivateDirectory(quarantineRoot, scope => readOperationalQuarantine(scope, { key: keys.crmKey, sourceBinding, targetBinding })),
        sourceIdentity, targetIdentity, checkpointReceiptSha256: operationalStateHash(checkpointReceipt), contextSha256: hash("synthetic-c5-context"),
        continuity: witness.gate, assertReady: async () => {
          assert.deepEqual(await files(quarantineRoot), originalMarker); assert.deepEqual(await files(sourceJournal), originalJournal);
        } };
    }
    async function fixture() {
      await clone(); const progressDirectory = path.join(directory, `progress-${++sequence}`); await mkdir(progressDirectory, { mode: 0o700 });
      const planParameters = await parameters(), planned = await planClosureReconciliation(planParameters);
      return { planParameters, expectedPlanSha256: planned.planSha256, checkpointReceipt, manifest, keys,
        target: { pool: targetPool, inspectionPool: targetInspector, storage: targetStorage, rootPath: targetRoot, broadcastKey: keys.messageKey },
        directories: { sourceOperations: sourceJournal, checkpoint: checkpointRoot, quarantine: quarantineRoot, progress: progressDirectory, sourceMedia: sourceRoot },
        maintenance: { async withQuiescedProducers(work) { return work(async () => {}); } }, clock, signal: undefined };
    }
    async function unchanged() {
      assert.equal(await databaseHash(options.database), originalSql); assert.deepEqual(await files(sourceRoot), originalFiles);
      assert.deepEqual(await files(sourceJournal), originalJournal); assert.deepEqual(await files(quarantineRoot), originalMarker); assert.equal(JSON.stringify(manifest), originalManifest);
      assert.deepEqual(await readFile(path.join(checkpointRoot, "receipt.json")), originalReceipt); assert.deepEqual(await readFile(path.join(checkpointRoot, "operations.enc.json")), originalCapsule);
      await assert.rejects(withPrivateDirectory(quarantineRoot, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
    }
    async function peerState(connection) {
      const result = [];
      for (const [table, column] of [["users", "id"], ["client_auth_state", "user_id"], ["invitations", "consumed_by_id"], ["media_assets", "owner_id"], ["media_storage_objects", "owner_id"]]) {
        const rows = await connection.query(`SELECT * FROM ${table} WHERE ${column} = ?`, [peer]);
        result.push([table, rows.map(row => JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(name => [name, cell(row[name])])))).sort()]);
      }
      return result;
    }
    const originalPeer = await peerState(sourceConnection);
    async function absentAndPeers() {
      const store = createErasureStore({ pool: targetPool, database: targetDatabase, capacity: { ...limits, rootFingerprint: targetFingerprint }, broadcastKey: keys.messageKey });
      for (const uid of [client, absentClient]) assert.deepEqual(await store.withLease(hex(uid), scope => scope.verifyAbsent(clock())), { absent: true });
      for (const uid of [admin, peer]) assert.equal(Number((await targetConnection.query("SELECT COUNT(*) AS n FROM users WHERE id = ?", [uid]))[0].n), 1);
      assert.deepEqual(await peerState(targetConnection), originalPeer, "all peer SQL rows remain unchanged");
      assert.equal(Number((await targetConnection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0].held_bytes), 580, "only the selected owner's media capacity is released");
      for (const asset of peerAssets) for (const variant of ["full", "thumb"]) assert.deepEqual(await targetStorage.get({ assetId: asset.id, storageKey: asset.storageKey, variant }), variant === "full" ? asset.full : asset.thumbnail);
      for (const asset of own) for (const variant of ["full", "thumb"]) assert.equal((await targetStorage.inspectEntry({ storageKey: asset.storageKey, variant })).exists, false);
    }
    // The implementation module is loaded only in the explicitly enabled SQL
    // suite, keeping the general unit job an honest skipped native wrapper.
    const { replayClosureReconciliation } = await import("../server/backup/closure-reconciliation-replay.mjs");
    await t.test("a completed high source cursor starts target work from the beginning; an absent identity is verified safely", async () => {
      const input = await fixture(), result = await replayClosureReconciliation(input);
      assert.equal(result.status, "closure_target_reconciled_quarantined"); assert.equal(result.reconciledReceipts, 2);
      assert.equal(result.targetAbsenceVerified, true); assert.equal(result.started, false); assert.equal(result.quarantineRetained, true);
      assert.equal(result.capacityRebound, true); assert.equal(result.reconciliationRequired, true); assert.equal(result.authorityTransferred, false);
      await absentAndPeers(); await unchanged();
      const repeated = await replayClosureReconciliation(input); assert.equal(repeated.targetAbsenceVerified, true); await unchanged();
      const progressFile = (await readdir(input.directories.progress)).find(name => /^erasure-[a-f0-9]{64}\.json$/.test(name));
      const progressBytes = await readFile(path.join(input.directories.progress, progressFile));
      await unlink(path.join(input.directories.progress, progressFile));
      await insertUser(client, "client", targetConnection);
      await assert.rejects(replayClosureReconciliation(input), { code: "CLOSURE_REPLAY_PROGRESS" });
      assert.equal(Number((await targetConnection.query("SELECT COUNT(*) AS n FROM users WHERE id = ?", [client]))[0].n), 1);
      await writeFile(path.join(input.directories.progress, progressFile), progressBytes, { mode: 0o600, flag: "wx" });
      await assert.rejects(replayClosureReconciliation(input), { code: "ERASURE_RESTORE_REPLAY_REQUIRED" });
      assert.equal(Number((await targetConnection.query("SELECT COUNT(*) AS n FROM users WHERE id = ?", [client]))[0].n), 1, "completed target progress never erases a resurrected identity again");
      await unchanged();
    });
    await t.test("the reconciliation probe keeps normal missing-client refusal and rejects a same-id administrator", async () => {
      await clone();
      await targetConnection.query("UPDATE media_storage_state SET root_fingerprint = ? WHERE id = 1", [targetFingerprint]);
      const store = createErasureStore({ pool: targetPool, database: targetDatabase, capacity: { ...limits, rootFingerprint: targetFingerprint }, broadcastKey: keys.messageKey });
      assert.deepEqual(await store.withLease(hex(absentClient), scope => scope.inspectReconciliation(clock())), { present: false, absent: true, clientId: hex(absentClient) });
      await assert.rejects(store.withLease(hex(absentClient), scope => scope.inspect(clock())), { code: "ERASURE_NOT_FOUND" });
      assert.deepEqual(await store.withLease(hex(client), scope => scope.inspectReconciliation(clock())), { present: true, clientId: hex(client) });
      await insertUser(absentClient, "admin", targetConnection);
      await assert.rejects(store.withLease(hex(absentClient), scope => scope.inspectReconciliation(clock())), { code: "ERASURE_TARGET" }); await unchanged();
    });
    await t.test("qualified executable inventory is mandatory before a SQL or file mutation", async () => {
      const input = await fixture(), beforeSql = await databaseHash(targetDatabase), beforeFiles = await files(targetRoot);
      let limitedGrantsRead = 0;
      const inspectionPool = { async getConnection() {
        const connection = await targetInspector.getConnection();
        return { ...connection, query: (sql, params) => {
          if (sql === "SHOW GRANTS") { limitedGrantsRead++; return Promise.resolve([{ grant: `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${targetDatabase}\`.* TO 'synthetic'@'%'` }]); }
          return connection.query(sql, params);
        } };
      } };
      await assert.rejects(replayClosureReconciliation({ ...input, target: { ...input.target, inspectionPool } }), { name: "BackupInspectionError", code: "BACKUP_INSPECTION_CONFIG" });
      assert.equal(limitedGrantsRead, 1, "the deliberately insufficient grant was inspected before refusal");
      assert.equal(await databaseHash(targetDatabase), beforeSql); assert.deepEqual(await files(targetRoot), beforeFiles); await unchanged();
      await targetConnection.query("CREATE TRIGGER synthetic_reconciliation_hidden BEFORE DELETE ON users FOR EACH ROW SET @synthetic_reconciliation_probe = 1");
      let triggersRead = 0;
      const triggerInspector = { async getConnection() {
        const connection = await targetInspector.getConnection();
        return { ...connection, query: (sql, params) => {
          if (sql.includes("COUNT(*) AS value FROM information_schema.TRIGGERS")) triggersRead++;
          return connection.query(sql, params);
        } };
      } };
      try {
        await assert.rejects(replayClosureReconciliation({ ...input, target: { ...input.target, inspectionPool: triggerInspector } }), { name: "BackupInspectionError", code: "BACKUP_INSPECTION_CONFIG" });
        assert.equal(triggersRead, 1, "the actual trigger inventory was read before refusal");
        assert.equal(await databaseHash(targetDatabase), beforeSql); assert.deepEqual(await files(targetRoot), beforeFiles);
      } finally { await targetConnection.query("DROP TRIGGER synthetic_reconciliation_hidden"); }
      await unchanged();
    });
    await t.test("an unexpected source-plan context fails confirmation before SQL mutation", async () => {
      const input = await fixture(), beforeSql = await databaseHash(targetDatabase), beforeFiles = await files(targetRoot);
      let sqlAcquisitions = 0;
      const inspectionPool = { async getConnection() { sqlAcquisitions++; return targetInspector.getConnection(); } };
      await assert.rejects(replayClosureReconciliation({ ...input, planParameters: { ...input.planParameters, contextSha256: hash("changed-source-context") },
        target: { ...input.target, inspectionPool } }), { name: "ClosureReplayError", code: "CLOSURE_REPLAY_CHANGED" });
      assert.equal(sqlAcquisitions, 0, "confirmation refuses the changed plan before SQL inspection begins");
      assert.equal(await databaseHash(targetDatabase), beforeSql); assert.deepEqual(await files(targetRoot), beforeFiles); await unchanged();
    });
    await t.test("a file unlink acknowledged with an error resumes without losing peer files or double credit", async () => {
      const input = await fixture(); let interrupted = false;
      const storage = { ...targetStorage, async remove(value) { await targetStorage.remove(value); if (!interrupted) { interrupted = true; throw new Error("Synthetic interruption after durable unlink"); } } };
      await assert.rejects(replayClosureReconciliation({ ...input, target: { ...input.target, storage } }), { name: "AccountErasureError", code: "ERASURE_UNAVAILABLE" }); assert.equal(interrupted, true);
      await replayClosureReconciliation(input); await absentAndPeers(); await unchanged();
    });
    await t.test("a lost finish commit acknowledgement resumes from target evidence and retains source authority", async () => {
      const input = await fixture(); let interrupted = false;
      const pool = { async getConnection() {
        const connection = await targetPool.getConnection(); let finishing = false;
        return { ...connection, async query(sql, params) { if (/DELETE FROM users WHERE id/.test(sql)) finishing = true; return connection.query(sql, params); },
          async commit() { await connection.commit(); if (finishing && !interrupted) { interrupted = true; throw new Error("Synthetic lost final commit acknowledgement"); } } };
      } };
      await assert.rejects(replayClosureReconciliation({ ...input, target: { ...input.target, pool } }), { name: "AccountErasureError", code: "ERASURE_UNAVAILABLE" }); assert.equal(interrupted, true);
      await replayClosureReconciliation(input); await absentAndPeers(); await unchanged();
    });
  } finally {
    await Promise.allSettled([sourcePool?.end(), targetPool?.end(), sourceInspector?.end(), targetInspector?.end()]);
    try { await reset(targetDatabase); await reset(options.database); } finally { await sourceConnection.end(); await targetConnection.end(); }
  }
});
