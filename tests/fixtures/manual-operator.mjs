import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, request } from "node:http";
import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { databaseOptions, connectDatabase } from "../../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables, loadMigrations } from "../../server/db/migrations.mjs";
import { createRuntimePool } from "../../server/db/runtime.mjs";
import { createMediaStorage } from "../../server/media/storage.mjs";
import { createErasureStore } from "../../server/data/erasure-store.mjs";
import { createErasureJournal, readErasureJournalBatch } from "../../server/data/erasure-journal.mjs";
import { createApplicationInspectionPool, APPLICATION_COVERAGE } from "../../server/backup/application-scope.mjs";
import { backupIdentity, createBackupManifest, manifestHash, writeManifest } from "../../server/backup/manifest.mjs";
import { captureBackupSnapshot, createBackupSnapshotStore, assertBackupSnapshot } from "../../server/backup/snapshot.mjs";
import { operationalStateHash, captureOperationalState, restoreOperationalQuarantine, writeOperationalCheckpoint } from "../../server/backup/operational-checkpoint.mjs";
import { writeCheckpointReceipt } from "../../server/backup/checkpoint-receipt.mjs";
import { createManagedRuntime } from "../../server/backup/managed-runtime.mjs";
import { createConfiguredLocalClosures } from "../../server/backup/local-closure-parent.mjs";
import { loadRuntimeBroadcastEnvironment } from "../../server/config/runtime-broadcast.mjs";
import { writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration, writeRuntimeMessagingConfiguration,
  writeRuntimeMediaConfiguration, writeRuntimeNotificationsConfiguration, writeRuntimeCrmConfiguration } from "../../server/config/runtime-database-file.mjs";
import { withPrivateDirectory } from "../../server/files/private-directory.mjs";
import { dumpCloneSql } from "../../scripts/verify-text-clone.mjs";
import { importNativeSql, validateApplicationSql, readApplicationSql } from "../../scripts/import-application-checkpoint.mjs";
import { saveCopyState } from "../../server/backup/copy-files.mjs";
import { bundle, PRIMARY, names } from "./crm-private.mjs";
import { erasureDirectory } from "./erasure-files.mjs";
import { consumeSyntheticInvitation } from "./manual-admission.mjs";

const repository = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const moduleUrl = name => new URL(`../../${name}`, import.meta.url).href;
const hash = value => createHash("sha256").update(value).digest("hex"), hex = value => value.toString("hex"), id = () => randomBytes(16);
const sqlDate = at => new Date(at).toISOString().replace("T", " ").replace("Z", "000");
export const fileHashes = async directory => Object.fromEntries(await Promise.all((await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort().map(async name => [name, hash(await readFile(path.join(directory, name)))])));

// Only CI's disposable loopback transport changes. The production clients still
// create private defaults files, use real argv/stdin, and await actual exit.
function localSqlClient(executable, args, options) {
  assert.ok(["/usr/bin/mariadb", "/usr/bin/mariadb-dump"].includes(executable));
  return spawn(executable, [args[0], "--skip-ssl", ...args.slice(1).filter(arg => !arg.startsWith("--ssl-ca=") && arg !== "--ssl-verify-server-cert")], options);
}
async function freePort() {
  const probe = createServer(); await new Promise(done => probe.listen(0, "127.0.0.1", done));
  const port = probe.address().port; await new Promise(done => probe.close(done)); return port;
}
export function localRequest(port, resource) {
  return new Promise((yes, no) => {
    const pending = request({ host: "127.0.0.1", port, path: resource, agent: false, setHost: false,
      headers: { Host: "jessiemessage.com", "X-Forwarded-Proto": "https", "X-Jessie-Parent-Peer": "127.0.0.1" } }, incoming => {
      const chunks = []; incoming.on("data", chunk => chunks.push(chunk)); incoming.once("error", no);
      incoming.once("end", () => yes({ status: incoming.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    }); pending.once("error", no); pending.setTimeout(5000, () => pending.destroy(new Error("Synthetic local HTTP timeout"))); pending.end();
  });
}

/** Real 31-table dump/import, six anchored runtime files and the actual IPC app.
 * Only explicit loopback disposable databases are ever cleaned or imported. */
export async function manualOperatorFixture(t) {
  const db = databaseOptions(), targetDatabase = process.env.JESSIEMESSAGE_RESTORE_TEST_DATABASE;
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(db.host));
  assert.match(db.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.match(targetDatabase, /^jessiemessage_test(?:_[a-z0-9]+)*$/); assert.notEqual(targetDatabase, db.database);
  assert.match(process.env.JESSIEMESSAGE_SHARED_RESTORE_DB_USER ?? "", /^jessiemessage_shared_restore_test(?:_[a-z0-9]+)*$/);
  assert.ok(process.env.JESSIEMESSAGE_SHARED_RESTORE_DB_PASSWORD);
  const targetEnv = { ...process.env, JESSIEMESSAGE_DB_NAME: targetDatabase, JESSIEMESSAGE_MIGRATION_DATABASE: targetDatabase, JESSIEMESSAGE_APPLICATION_DATABASE: targetDatabase };
  const migrations = await loadMigrations(), tables = createdMigrationTables(migrations), allTables = [...tables, "schema_migrations"], allowed = [...allTables, "migration_probe"];
  assert.equal(migrations.length, 31); assert.equal(tables.length, 30);
  const sourceConnection = await connectDatabase(), targetConnection = await connectDatabase(targetEnv);
  const root = await erasureDirectory(t), operatorDirectory = path.join(root, "operator"), targetDirectory = path.join(operatorDirectory, "target");
  await mkdir(operatorDirectory, { mode: 0o700 }); await mkdir(targetDirectory, { mode: 0o700 });
  const dirs = { ...Object.fromEntries(["source-media", "source-journal", "checkpoint", "target-private"].map(name => [name, path.join(root, name)])),
    "target-media": path.join(targetDirectory, "media"), "target-journal": path.join(targetDirectory, "operations"),
    quarantine: path.join(targetDirectory, "quarantine"), progress: path.join(targetDirectory, "progress") };
  for (const directory of Object.values(dirs)) await mkdir(directory, { mode: 0o700 });
  const checkpointMedia = path.join(dirs.checkpoint, "media"); await mkdir(checkpointMedia, { mode: 0o700 });
  const records = bundle(dirs["target-media"]), limits = { ownerBytes: 1048576, totalBytes: 104857600 };
  records.database = { ...records.database, host: db.host, port: String(db.port), database: targetDatabase,
    user: process.env.JESSIEMESSAGE_SHARED_RESTORE_DB_USER, password: process.env.JESSIEMESSAGE_SHARED_RESTORE_DB_PASSWORD, privilegeProfile: "infomaniak-shared" };
  records.media = { ...records.media, ownerBytes: String(limits.ownerBytes), totalBytes: String(limits.totalBytes), minimumFreeBytes: "0" };
  const writers = [writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration, writeRuntimeMessagingConfiguration, writeRuntimeMediaConfiguration, writeRuntimeNotificationsConfiguration, writeRuntimeCrmConfiguration];
  for (const [index, value] of Object.values(records).entries()) await writers[index](dirs["target-private"], value, PRIMARY);
  const keys = { totpKey: Buffer.from(records.authentication.mfaKey, "base64url"), mailKey: Buffer.from(records.messaging.mailKey, "base64url"),
    messageKey: Buffer.from(records.messaging.messageKey, "base64url"), mediaKey: Buffer.from(records.media.mediaKey, "base64url"),
    crmKey: Buffer.from(records.crm.crmKey, "base64url"), notificationKey: Buffer.from(records.notifications.notificationKey, "base64url") };
  const sourceStorage = await createMediaStorage({ root: dirs["source-media"], key: keys.mediaKey, pathMode: "linux-dirfd" }),
    targetStorage = await createMediaStorage({ root: dirs["target-media"], key: keys.mediaKey, pathMode: "linux-dirfd" });
  const sourceFingerprint = await sourceStorage.fingerprint(), targetFingerprint = await targetStorage.fingerprint();
  const sourceBinding = { database: db.database, rootFingerprint: hex(sourceFingerprint) }, targetBinding = { database: targetDatabase, rootFingerprint: hex(targetFingerprint) };
  const now = Date.now(), created = sqlDate(now - 60000), clock = () => now + 10000;
  const admin = id(), client = id(), peer = id(), assets = [];
  let sourcePool, targetPool, sourceInspector, targetInspector, runtime, maintained = false, operatorMode = false;
  const children = [], port = await freePort(), events = path.join(root, "runtime-events.txt"), driver = path.join(root, "actual-manual-runtime-ci.mjs");
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("JESSIEMESSAGE_")
    && !["NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_USE_SYSTEM_CA", "SSL_CERT_FILE", "SSL_CERT_DIR", "OPENSSL_CONF"].includes(name)));
  Object.assign(environment, { PORT: String(port), JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" });
  const runtimeOptions = { runtimeDirectory: repository, privateDirectory: dirs["target-private"], operationsDirectory: dirs["target-journal"], port, environment, parentGateway: true, accountClosures: true };
  const qualified = (database, table) => { assert.ok([db.database, targetDatabase].includes(database)); assert.ok(allowed.includes(table)); return `\`${database}\`.\`${table}\``; };
  async function reset(database) {
    const current = await sourceConnection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
    assert.ok(current.every(row => allowed.includes(row.name)), "Unrelated tables forbid disposable cleanup");
    for (const table of [...tables].reverse().concat(["migration_probe", "schema_migrations"])) await sourceConnection.query(`DROP TABLE IF EXISTS ${qualified(database, table)}`);
  }
  async function databaseHash(database) {
    const digest = createHash("sha256");
    for (const table of allTables) {
      const rows = await sourceConnection.query(`SELECT * FROM ${qualified(database, table)}`);
      digest.update(table).update(JSON.stringify(rows.map(row => JSON.stringify(row, (_key, value) => typeof value === "bigint" ? String(value) : value)).sort()));
    }
    return digest.digest("hex");
  }
  const localEnvironment = async () => ({ ...await loadRuntimeBroadcastEnvironment(dirs["target-private"], { ...PRIMARY, recovery: true, port: String(port) }), JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1" });
  const makeOperations = () => createConfiguredLocalClosures(runtimeOptions, { environment }, { loadEnvironment: localEnvironment });
  t.after(async () => {
    await runtime?.destroy(); for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await Promise.allSettled([sourcePool?.end(), targetPool?.end(), sourceInspector?.end(), targetInspector?.end()]);
    try { await reset(targetDatabase); await reset(db.database); } finally { await sourceConnection.end(); await targetConnection.end(); }
    for (const key of Object.values(keys)) key.fill(0);
  });
  await writeFile(events, "", { mode: 0o600, flag: "wx" });
  // Same CI-only loopback adaptation as witness-runtime: real file loader,
  // preflight (including grants), configured server, producers and shutdown.
  await writeFile(driver, `
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { run, parseArguments } from ${JSON.stringify(moduleUrl("scripts/private-messaging-child.mjs"))};
import { main, checkMessagingSchema } from ${JSON.stringify(moduleUrl("scripts/start-private-messaging.mjs"))};
import { start } from ${JSON.stringify(moduleUrl("server/index.mjs"))};
import { inspectDatabase } from ${JSON.stringify(moduleUrl("server/preflight/database.mjs"))};
import { checkRuntimeMediaStorage } from ${JSON.stringify(moduleUrl("server/config/runtime-media-storage.mjs"))};
const local = env => ({ ...env, JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: '1' });
await run(parseArguments(process.argv.slice(2)), { loadRuntime: async () => ({
 main: (args, dependencies) => main(args, { ...dependencies,
  inspect: async input => { const result = await inspectDatabase({ ...input, env: local(input.env) });
   assert.deepEqual(result.checks.filter(check => check.status !== 'pass').map(check => check.name), ['transport']);
   return { ...result, valid: true, checks: result.checks.map(check => check.name === 'transport' ? { ...check, status: 'pass' } : check) }; },
  checkSchema: env => checkMessagingSchema(local(env)), checkStorage: env => checkRuntimeMediaStorage(local(env)),
 }),
 start: async (env, options) => { const runtime = await start(local(env), options); await appendFile(${JSON.stringify(events)}, 'started\\n');
  return { ...runtime, async drain() { await appendFile(${JSON.stringify(events)}, 'draining\\n'); const result = await runtime.drain();
   await appendFile(${JSON.stringify(events)}, JSON.stringify(result)+'\\n'); return result; } }; },
}) });
`, { mode: 0o600, flag: "wx" });
  runtime = createManagedRuntime(runtimeOptions, { forkClient(_shim, args, settings) { const child = fork(driver, args, settings); children.push(child); return child; } });
  await reset(targetDatabase); await reset(db.database); await applyMigrations(sourceConnection, { database: db.database, migrations });
  sourcePool = await createRuntimePool(process.env); targetPool = await createRuntimePool(targetEnv);
  sourceInspector = await createApplicationInspectionPool(process.env); targetInspector = await createApplicationInspectionPool(targetEnv);
  await sourceConnection.query("INSERT INTO media_storage_state (id, owner_bytes, total_bytes, root_fingerprint, held_bytes, initialized_at) VALUES (1, ?, ?, ?, 0, ?)", [limits.ownerBytes, limits.totalBytes, sourceFingerprint, created]);
  for (const [uid, role] of [[admin, "admin"], [client, "client"], [peer, "client"]]) {
    await sourceConnection.query("INSERT INTO users (id, role, status, pseudonym, email, password_hash, email_verified_at, age_assured_at, access_approved_at, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, 'synthetic-password-hash', ?, ?, ?, ?, ?)",
      [uid, role, `Synthetic ${hex(uid)}`, `${hex(uid)}@example.invalid`, created, created, created, created, created]);
    if (role === "client") { await sourceConnection.query("INSERT INTO client_auth_state (user_id, age_declared_at) VALUES (?, ?)", [uid, created]); await consumeSyntheticInvitation(sourceConnection, uid, now - 60000); }
  }
  for (const uid of [client, peer]) {
    const assetId = id(), storageKey = randomBytes(32), full = randomBytes(400), thumbnail = randomBytes(100), digest = Buffer.from(hash(full), "hex");
    await sourceStorage.put({ assetId, storageKey, full, thumbnail });
    await sourceConnection.query("INSERT INTO media_assets (id, owner_id, owner_role, storage_key, content_digest, active_digest, width, height, thumbnail_width, thumbnail_height, full_bytes, thumbnail_bytes, created_at) VALUES (?, ?, 'client', ?, ?, ?, 100, 80, 50, 40, 400, 100, ?)", [assetId, uid, storageKey, digest, digest, created]);
    await sourceConnection.query("INSERT INTO media_storage_objects (id, owner_id, owner_role, storage_key, content_digest, full_bytes, thumbnail_bytes, stored_bytes, state, asset_id, created_at, updated_at) VALUES (?, ?, 'client', ?, ?, 400, 100, 580, 'registered', ?, ?, ?)", [assetId, uid, storageKey, digest, assetId, created, created]);
    await sourceConnection.query("UPDATE media_storage_state SET held_bytes = held_bytes + 580 WHERE id = 1"); assets.push({ assetId, storageKey, full, thumbnail });
  }
  await sourceConnection.query("INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", [id(), peer, randomBytes(32), created, sqlDate(now + 3600000)]);
  const snapshot = await captureBackupSnapshot({ store: createBackupSnapshotStore({ pool: sourcePool, inspectionPool: sourceInspector, coverage: "application-tables" }) });
  const sourceIdentity = await backupIdentity({ databaseName: db.database, rootPath: dirs["source-media"], storage: sourceStorage, mediaKey: keys.mediaKey });
  const manifest = createBackupManifest({ snapshot, identity: sourceIdentity, keys, now, profile: "messaging-photos-notify-recovery-crm-broadcast-application" });
  await writeManifest(path.join(dirs.checkpoint, "manifest.json"), manifest, { pathMode: "linux-dirfd" });
  const chunks = [];
  const dumped = await withPrivateDirectory(dirs.checkpoint, scope => dumpCloneSql(scope, { database: db.database, user: db.user }, { host: db.host, port: String(db.port) }, db.password,
    { tables: [...allTables].sort(), spawnClient: localSqlClient, onSqlChunk(bytes) { chunks.push(Buffer.from(bytes)); } }));
  const sql = Buffer.concat(chunks); assert.equal(hash(sql), dumped.sqlSha256); await validateApplicationSql(sql);
  const gzip = gzipSync(sql), mediaFiles = [];
  await writeFile(path.join(dirs.checkpoint, "database.sql.gz"), gzip, { mode: 0o600, flag: "wx" });
  for (const name of (await readdir(dirs["source-media"])).sort()) {
    const bytes = await readFile(path.join(dirs["source-media"], name));
    for (const destination of [checkpointMedia, dirs["target-media"]]) { await copyFile(path.join(dirs["source-media"], name), path.join(destination, name)); await chmod(path.join(destination, name), 0o600); }
    mediaFiles.push({ name, bytes: bytes.length, sha256: hash(bytes) });
  }
  const readRecentRegistry = () => withPrivateDirectory(dirs["source-journal"], scope => captureOperationalState(scope, { key: keys.crmKey, binding: sourceBinding }));
  const backup = await readRecentRegistry();
  const receipt = { format: "jessiemessage-private-checkpoint", version: 10, profile: "messaging-photos-notify-recovery-crm-broadcast-application", coverage: { ...APPLICATION_COVERAGE }, createdAt: now,
    schema: { tables: 31, migrations: 31 }, sql: { file: "database.sql.gz", bytes: gzip.length, sha256: hash(gzip), uncompressedBytes: sql.length, uncompressedSha256: hash(sql) },
    manifest: { file: "manifest.json", sha256: manifestHash(manifest) }, media: { files: mediaFiles, bytes: mediaFiles.reduce((sum, value) => sum + value.bytes, 0) } };
  receipt.operations = await withPrivateDirectory(dirs.checkpoint, scope => writeOperationalCheckpoint(scope, backup, receipt, keys.crmKey));
  await withPrivateDirectory(dirs.checkpoint, scope => writeCheckpointReceipt(scope, receipt));
  const empty = await targetConnection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [targetDatabase]); assert.equal(empty.length, 0);
  await withPrivateDirectory(dirs.checkpoint, scope => importNativeSql(scope, { database: targetDatabase, user: db.user }, { host: db.host, port: String(db.port) }, db.password, sql, { spawnClient: localSqlClient }));
  sql.fill(0); for (const chunk of chunks) chunk.fill(0);
  const imported = await captureBackupSnapshot({ store: createBackupSnapshotStore({ pool: targetPool, inspectionPool: targetInspector, coverage: "application-tables" }) });
  assertBackupSnapshot({ expected: snapshot, actual: imported, mode: "recovery", targetFingerprint: targetBinding.rootFingerprint });
  assert.equal(await databaseHash(targetDatabase), await databaseHash(db.database), "native import reproduces the entire original SQL application");
  await withPrivateDirectory(dirs.quarantine, scope => restoreOperationalQuarantine(scope, { backup, current: backup, targetBinding, key: keys.crmKey,
    expectedCurrentSha256: operationalStateHash(backup), assertCurrent: async expected => assert.equal(operationalStateHash(await readRecentRegistry()), expected) }));
  const journal = createErasureJournal({ directory: dirs["source-journal"], key: keys.crmKey, binding: sourceBinding, clientId: hex(client) });
  try { let current = await journal.read(); for (const phase of ["requested", "prepared", "files_erased", "completed"]) current = await journal.save(current.record ? { ...current.record, phase, updatedAt: now + current.revision }
    : { version: 1, clientId: hex(client), binding: sourceBinding, phase, cursor: null, startedAt: now, updatedAt: now }, current.revision, async () => {}); } finally { journal.close(); }
  const recentRegistry = await readRecentRegistry(), original = { sql: await databaseHash(db.database), media: await fileHashes(dirs["source-media"]), registry: await fileHashes(dirs["source-journal"]),
    quarantine: await fileHashes(dirs.quarantine), checkpoint: await fileHashes(dirs.checkpoint), checkpointMedia: await fileHashes(checkpointMedia), private: await Promise.all(names.map(name => readFile(path.join(dirs["target-private"], name)))) };
  const input = { checkpointDirectory: dirs.checkpoint, quarantineDirectory: dirs.quarantine, journalDirectory: dirs["target-journal"], progressDirectory: dirs.progress,
    recentRegistry, expectedRegistrySha256: operationalStateHash(recentRegistry), readRecentRegistry, keys, clock,
    target: { database: targetDatabase, rootPath: dirs["target-media"], pool: targetPool, inspectionPool: targetInspector, storage: targetStorage },
    maintenance: { async withQuiescedProducers(work) { assert.equal(maintained, false); assert.equal(runtime.state().status, "stopped"); maintained = true;
      try { return await work(async () => { assert.equal(maintained, true); assert.equal(runtime.state().status, "stopped"); }); } finally { maintained = false; } } },
    assertReady: async () => { assert.equal(maintained, true); } };
  return { input, runtime, makeOperations, dirs, port, children, events, keys, targetBinding, environment,
    async resetTargetForOperator() {
      assert.equal(runtime.state().status, "stopped"); assert.equal(children.length, 0);
      await reset(targetDatabase); await rm(targetDirectory, { recursive: true }); operatorMode = true;
      const recipient = Buffer.from("Synthetic CI public recipient, read-only copy fixture\n");
      await writeFile(path.join(dirs["source-journal"], "recurring-backup.json"), `${JSON.stringify({ version: 1, enabled: false, recipientSha256: hash(recipient), hourUtc: 5, minuteUtc: 15 })}\n`, { mode: 0o600, flag: "wx" });
      await writeFile(path.join(dirs["source-journal"], "recipient-public.asc"), recipient, { mode: 0o600, flag: "wx" });
      await saveCopyState(dirs["source-journal"], { version: 1, revision: 0, destinations: [] }, 0);
      original.registry = await fileHashes(dirs["source-journal"]);
      const paths = { targetDirectory, rootPath: dirs["target-media"], journalDirectory: dirs["target-journal"], progressDirectory: dirs.progress, quarantineDirectory: dirs.quarantine };
      const job = { version: 1, runtimeDirectory: repository, runtimeHead: "1".repeat(40), runtimeTree: "2".repeat(40),
        sourceOperationsDirectory: dirs["source-journal"], checkpointDirectory: dirs.checkpoint, targetPrivateDirectory: dirs["target-private"],
        targetDatabase, importUser: db.user, sqlSha256: receipt.sql.uncompressedSha256, registrySha256: input.expectedRegistrySha256 };
      const context = { job, jobSha256: hash(JSON.stringify(job)), paths, keys, recentRegistry, sourceBinding,
        sourceEnvironment: { ...process.env }, targetEnvironment: targetEnv, importSelection: { database: targetDatabase },
        async assertReady() { assert.equal(operationalStateHash(await readRecentRegistry()), input.expectedRegistrySha256); }, close() {} };
      return { operatorDirectory, context,
        async connect() { return connectDatabase(targetEnv); }, readSecret: async () => db.password,
        async inspect(connection, database) { assert.equal(database, targetDatabase); const selected = await connection.query("SELECT DATABASE() AS name"); assert.equal(selected[0].name, targetDatabase);
          const actual = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [targetDatabase]); return actual.length === 0 ? "empty" : "partial"; },
        async nativeResume(selection, dependencies) {
          assert.equal(selection.command, "resume"); assert.equal(selection.database, targetDatabase); assert.equal(await dependencies.readSecret(), db.password);
          const existing = await targetConnection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [targetDatabase]);
          assert.ok(existing.length === 0 || existing.length === allTables.length);
          if (existing.length === 0) await withPrivateDirectory(dirs.checkpoint, async scope => {
            const bytes = await readApplicationSql(scope, { backupBytes: receipt.sql.bytes, backupSha256: receipt.sql.sha256, sqlBytes: receipt.sql.uncompressedBytes, sqlSha256: receipt.sql.uncompressedSha256 });
            try { await importNativeSql(scope, { database: targetDatabase, user: db.user }, { host: db.host, port: String(db.port) }, db.password, bytes, { spawnClient: localSqlClient }); }
            finally { bytes.fill(0); }
          });
          const actual = await captureBackupSnapshot({ store: createBackupSnapshotStore({ pool: targetPool, inspectionPool: targetInspector, coverage: "application-tables" }) });
          const currentStorage = await createMediaStorage({ root: dirs["target-media"], key: keys.mediaKey, pathMode: "linux-dirfd" });
          assertBackupSnapshot({ expected: snapshot, actual, mode: "recovery", targetFingerprint: hex(await currentStorage.fingerprint()) });
          assert.equal(await databaseHash(targetDatabase), original.sql);
          return { imported: existing.length === 0, applicationSnapshotMatched: true, tables: 31, migrations: 31 };
        } };
    },
    async assertRestored() {
      const currentStorage = await createMediaStorage({ root: dirs["target-media"], key: keys.mediaKey, pathMode: "linux-dirfd" }), fingerprint = await currentStorage.fingerprint();
      const binding = { database: targetDatabase, rootFingerprint: hex(fingerprint) };
      const store = createErasureStore({ pool: targetPool, database: targetDatabase, capacity: { ...limits, rootFingerprint: fingerprint }, broadcastKey: keys.messageKey });
      await store.withLease(hex(client), scope => scope.verifyAbsent(clock()));
      for (const uid of [admin, peer]) assert.equal(Number((await targetConnection.query("SELECT COUNT(*) AS value FROM users WHERE id = ?", [uid]))[0].value), 1);
      assert.equal(Number((await targetConnection.query("SELECT held_bytes FROM media_storage_state WHERE id = 1"))[0].held_bytes), 580);
      assert.equal(Number((await targetConnection.query("SELECT COUNT(*) AS value FROM sessions WHERE revoked_at IS NULL"))[0].value), 0);
      for (const variant of ["full", "thumb"]) assert.equal((await currentStorage.inspectEntry({ storageKey: assets[0].storageKey, variant })).exists, false);
      assert.deepEqual(await currentStorage.get({ assetId: assets[1].assetId, storageKey: assets[1].storageKey, variant: "full" }), assets[1].full);
      const page = await readErasureJournalBatch({ directory: dirs["target-journal"], key: keys.crmKey, binding });
      assert.equal(page.jobs.length, 1); assert.equal(page.jobs[0].phase, "completed");
    },
    async assertSourceUnchanged() {
      assert.equal(await databaseHash(db.database), original.sql); assert.deepEqual(await fileHashes(dirs["source-media"]), original.media);
      assert.deepEqual(await fileHashes(dirs["source-journal"]), original.registry); if (!operatorMode) assert.deepEqual(await fileHashes(dirs.quarantine), original.quarantine);
      assert.deepEqual(await fileHashes(dirs.checkpoint), original.checkpoint); assert.deepEqual(await fileHashes(checkpointMedia), original.checkpointMedia);
      assert.deepEqual(await Promise.all(names.map(name => readFile(path.join(dirs["target-private"], name)))), original.private);
    } };
}
