import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, request } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { createMediaCapacityStore } from "../server/media/capacity-store.mjs";
import { loadRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration, writeRuntimeMessagingConfiguration,
  writeRuntimeMediaConfiguration, writeRuntimeNotificationsConfiguration, writeRuntimeCrmConfiguration } from "../server/config/runtime-database-file.mjs";
import { createManagedRuntime } from "../server/backup/managed-runtime.mjs";
import { runManagedWitnessPreparation } from "../server/backup/managed-witness.mjs";
import { createWitnessOriginOperations } from "../server/backup/witness-origin-operator.mjs";
import { withConfiguredWitnessOrigin } from "../server/backup/witness-origin-context.mjs";
import { readWitnessGenesis, WITNESS_GENESIS_FILE } from "../server/backup/witness-genesis.mjs";
import { readCopyState, saveCopyState } from "../server/backup/copy-files.mjs";
import { bundle, names, PRIMARY, supportedFiles } from "./fixtures/crm-private.mjs";
import { erasureDirectory } from "./fixtures/erasure-files.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const repository = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const digest = value => createHash("sha256").update(value).digest("hex");
const moduleUrl = name => new URL(`../${name}`, import.meta.url).href;

function localRequest(port, resource) {
  return new Promise((yes, no) => {
    const req = request({ host: "127.0.0.1", port, path: resource, agent: false,
      headers: { Host: "jessiemessage.com", "X-Forwarded-Proto": "https" } }, res => {
      const chunks = []; res.on("data", part => chunks.push(part)); res.once("error", no);
      res.once("end", () => yes({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }); req.once("error", no); req.end();
  });
}

test("witness maintenance drains and resumes the actual messaging runtime, SQL and media without enabling closures (disposable MariaDB only)", {
  skip: !enabled ? "Set JESSIEMESSAGE_DB_TEST=1 with loopback disposable credentials." : !supportedFiles ? "Requires Linux private directory anchors." : false,
  timeout: 180000,
}, async t => {
  const db = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(db.host));
  assert.match(db.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.match(process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_USER ?? "", /^jessiemessage_shared_test(?:_[a-z0-9]+)*$/);
  assert.ok(process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_PASSWORD);
  const migrations = await loadMigrations(), allowed = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let runtime, bootstrapPool;
  async function clean() {
    const current = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [db.database]);
    assert.ok(current.every(row => allowed.includes(row.name)), "unrelated tables forbid disposable cleanup");
    for (const table of allowed) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  async function sqlHash() {
    const hash = createHash("sha256");
    for (const table of allowed.filter(name => name !== "migration_probe")) {
      const rows = await connection.query(`SELECT * FROM ${table}`);
      hash.update(table).update(JSON.stringify(rows.map(row => JSON.stringify(row, (_name, value) => typeof value === "bigint" ? value.toString() : value)).sort()));
    }
    return hash.digest("hex");
  }
  const root = await erasureDirectory(t), dirs = Object.fromEntries(["private", "media", "operations", "operator"].map(name => [name, path.join(root, name)]));
  for (const directory of Object.values(dirs)) await mkdir(directory, { mode: 0o700 });
  await mkdir(path.join(dirs.operator, "contract"), { mode: 0o700 });
  const probe = createServer(); await new Promise(done => probe.listen(0, "127.0.0.1", done));
  const port = probe.address().port; await new Promise(done => probe.close(done));
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("JESSIEMESSAGE_")
    && !["NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_USE_SYSTEM_CA", "SSL_CERT_FILE", "SSL_CERT_DIR", "OPENSSL_CONF"].includes(name)));
  Object.assign(environment, { PORT: String(port), JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" });
  const records = bundle(dirs.media);
  records.database = { ...records.database, host: db.host, port: String(db.port), database: db.database,
    user: process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_USER, password: process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_PASSWORD, privilegeProfile: "infomaniak-shared" };
  const writers = [writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration, writeRuntimeMessagingConfiguration,
    writeRuntimeMediaConfiguration, writeRuntimeNotificationsConfiguration, writeRuntimeCrmConfiguration];
  for (const [index, value] of Object.values(records).entries()) await writers[index](dirs.private, value, PRIMARY);
  const initialPrivate = await Promise.all(names.map(name => readFile(path.join(dirs.private, name))));
  const localEnv = async () => ({ ...await loadRuntimeBroadcastEnvironment(dirs.private, { ...PRIMARY, recovery: true, port: String(port) }), JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1" });
  const driver = path.join(root, "actual-runtime-ci.mjs");
  // This adapter changes only the disposable CI transport. Production private
  // loading intentionally has no plaintext/TLS override. The real six-file
  // loader, main, SQL inspection/schema checks, media decoder, start, workers,
  // HTTP readiness and drain are all executed; no synthetic listener is used.
  await writeFile(driver, `
import assert from 'node:assert/strict';
import { run, parseArguments } from ${JSON.stringify(moduleUrl("scripts/private-messaging-child.mjs"))};
import { main, checkMessagingSchema } from ${JSON.stringify(moduleUrl("scripts/start-private-messaging.mjs"))};
import { start } from ${JSON.stringify(moduleUrl("server/index.mjs"))};
import { inspectDatabase } from ${JSON.stringify(moduleUrl("server/preflight/database.mjs"))};
import { checkRuntimeMediaStorage } from ${JSON.stringify(moduleUrl("server/config/runtime-media-storage.mjs"))};
const local = env => ({ ...env, JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: '1' });
await run(parseArguments(process.argv.slice(2)), { loadRuntime: async () => ({
  main: (args, dependencies) => main(args, { ...dependencies,
    inspect: async input => {
      const result = await inspectDatabase({ ...input, env: local(input.env) });
      assert.deepEqual(result.checks.filter(check => check.status !== 'pass').map(check => check.name), ['transport']);
      return { ...result, valid: true, checks: result.checks.map(check => check.name === 'transport' ? { ...check, status: 'pass' } : check) };
    },
    checkSchema: env => checkMessagingSchema(local(env)),
    checkStorage: env => checkRuntimeMediaStorage(local(env)),
  }),
  start: (env, options) => start(local(env), options),
}) });
`, { flag: "wx", mode: 0o600 });
  const children = [];
  try {
    await clean(); await applyMigrations(connection, { database: db.database, migrations });
    const storage = await createMediaStorage({ root: dirs.media, key: Buffer.from(records.media.mediaKey, "base64url"), pathMode: "linux-dirfd" });
    const rootFingerprint = await storage.fingerprint();
    bootstrapPool = await createRuntimePool(await localEnv());
    await createMediaCapacityStore({ pool: bootstrapPool, capacity: { ownerBytes: Number(records.media.ownerBytes), totalBytes: Number(records.media.totalBytes), rootFingerprint } }).initialize({ now: Date.now(), offline: true });
    await bootstrapPool.end(); bootstrapPool = null;
    const destinationId = randomBytes(16).toString("hex"), pairedAt = Date.now() - 1000;
    await saveCopyState(dirs.operations, { version: 1, revision: 0, destinations: [{ id: destinationId, label: "Synthetic CI computer", kind: "computer", enabled: true,
      pairHash: null, pairExpiresAt: null, tokenHash: "c".repeat(64), pairedAt, lastSeenAt: null, locationId: null, lastReceipt: null }] }, 0);
    const beforePairing = await readCopyState(dirs.operations), beforeSql = await sqlHash();
    const pins = await Promise.all(["scripts/start-private-messaging.mjs", "server/index.mjs"].map(async name => [name, digest(await readFile(path.join(repository, name)))]));
    const source = async () => { for (const [name, hash] of pins) assert.equal(digest(await readFile(path.join(repository, name))), hash); };
    const options = { command: "plan-witness", runtimeDirectory: repository, runtimeHead: "1".repeat(40), runtimeTree: "2".repeat(40), privateDirectory: dirs.private,
      operationsDirectory: dirs.operations, privatePathMode: "linux-dirfd", witnessOperatorDirectory: dirs.operator, witnessDestination: destinationId };
    const internal = { source, withOrigin: (selected, settings, work) => withConfiguredWitnessOrigin(selected, settings, work, { loadEnvironment: localEnv }) };
    const plan = await createWitnessOriginOperations(options, { environment }, internal).plan();
    const operations = createWitnessOriginOperations({ ...options, command: "prepare-witness", witnessDestination: undefined, witnessPlanSha256: plan.planSha256 }, { environment }, internal);
    runtime = createManagedRuntime({ runtimeDirectory: repository, privateDirectory: dirs.private, operationsDirectory: dirs.operations, port, parentGateway: false, environment }, {
      forkClient(_shim, args, settings) { const child = fork(driver, args, settings); children.push(child); return child; },
    });
    await runtime.start(); assert.equal(runtime.state().status, "running");
    const entry = await localRequest(port, "/api/entry"); assert.equal(entry.status, 200);
    assert.deepEqual(JSON.parse(entry.body), { status: "available", client: { state: "signed_out", href: "/connect-device/client" },
      administrator: { state: "signed_out", href: "/connect-device/admin" } });
    const first = children[0], progress = [];
    const result = await runManagedWitnessPreparation({ runtime, operations, source, emit: value => progress.push(value) });
    assert.equal(result.prepared, true); assert.equal(result.runtimeResumed, true); assert.equal(result.closuresEnabled, false); assert.equal(result.externalWitnessConfirmed, false);
    assert.equal(first.exitCode, 0); assert.equal(first.signalCode, null); assert.equal(children.length, 2); assert.notEqual(children[1].pid, first.pid);
    assert.equal(runtime.state().status, "running");
    assert.deepEqual(await localRequest(port, "/api/ready"), { status: 200, body: '{"status":"ready"}' });
    assert.deepEqual(await localRequest(port, "/api/entry"), entry);
    assert.equal((await localRequest(port, "/api/admin/closures/clients/" + "a".repeat(32))).status, 401);
    const bytes = await readFile(path.join(dirs.operator, "contract", WITNESS_GENESIS_FILE)); assert.equal(digest(bytes), result.contractSha256);
    const contract = await readWitnessGenesis({ directory: path.join(dirs.operator, "contract"), operationsDirectory: dirs.operations,
      privateDirectory: dirs.private, runtimeDirectory: repository, key: Buffer.from(records.crm.crmKey, "base64url"),
      binding: { database: db.database, rootFingerprint: rootFingerprint.toString("hex") }, expectedContractSha256: result.contractSha256 });
    assert.equal(contract.destination.destinationId, destinationId);
    assert.deepEqual(await readCopyState(dirs.operations), beforePairing);
    // No authenticated lookup, queued delivery, subscription or expired row is
    // seeded: real workers have nothing to send/prune, and HTTP admission is
    // in memory. The sole initialized capacity row must remain unchanged.
    assert.equal(await sqlHash(), beforeSql);
    assert.deepEqual(await Promise.all(names.map(name => readFile(path.join(dirs.private, name)))), initialPrivate);
    assert.deepEqual(progress.filter(item => item.event === "passed").map(item => item.phase), ["precheck", "lease", "stop", "publication", "resume", "cleanup"]);
    const stopped = await runtime.stop(); assert.deepEqual(stopped, { exitCode: 0, signal: null });
    await assert.rejects(localRequest(port, "/api/ready"));
  } finally {
    await runtime?.destroy(); for (const child of children) { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
    await bootstrapPool?.end(); await clean(); await connection.end();
  }
});
