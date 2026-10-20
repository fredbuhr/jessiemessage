import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, request } from "node:http";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
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
import { createParentGateway } from "../server/backup/parent-gateway.mjs";
import { createRecurringSupervisor } from "../server/backup/recurring-supervisor.mjs";
import { createConfiguredWitnessObserver } from "../server/backup/witness-observer.mjs";
import { createRegistryWitness } from "../server/backup/registry-witness.mjs";
import { createErasureContinuity } from "../server/backup/registry-continuity.mjs";
import { createErasureJournal } from "../server/data/erasure-journal.mjs";
import { captureOperationalState, writeOperationalCheckpoint, assertNoOperationalRestore, OPERATIONAL_RESTORE_MARKER } from "../server/backup/operational-checkpoint.mjs";
import { writeCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";
import { APPLICATION_COVERAGE } from "../server/backup/application-scope.mjs";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { main as restoreOperations } from "../scripts/restore-private-operations.mjs";
import { WITNESS_ENROLLMENT_FILE, WITNESS_ENROLLMENT_ORIGIN } from "../server/backup/witness-enrollment.mjs";
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

function localRequest(port, resource, { method = "GET", headers = {}, body } = {}) {
  return new Promise((yes, no) => {
    const req = request({ host: "127.0.0.1", port, path: resource, method, agent: false,
      headers: { Host: "jessiemessage.com", "X-Forwarded-Proto": "https", ...(body === undefined ? {} : { "Content-Length": Buffer.byteLength(body) }), ...headers } }, res => {
      const chunks = []; res.on("data", part => chunks.push(part)); res.once("error", no);
      res.once("end", () => yes({ status: res.statusCode, body: Buffer.concat(chunks).toString(), ...(res.headers.allow ? { allow: res.headers.allow } : {}) }));
    }); req.once("error", no); req.setTimeout(25000, () => req.destroy(new Error("Synthetic local request timed out"))); req.end(body);
  });
}

async function freePort() {
  const probe = createServer(); await new Promise(done => probe.listen(0, "127.0.0.1", done));
  const port = probe.address().port; await new Promise(done => probe.close(done)); return port;
}
async function adjacentPorts() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const publicPort = await freePort(); if (publicPort >= 65535) continue;
    const probe = createServer();
    try {
      await new Promise((yes, no) => { probe.once("error", no); probe.listen(publicPort + 1, "127.0.0.1", yes); });
      await new Promise(done => probe.close(done)); return { publicPort, port: publicPort + 1 };
    } catch { if (probe.listening) await new Promise(done => probe.close(done)); }
  }
  assert.fail("No synthetic adjacent gateway ports available");
}
async function waitForEvent(filename, event) {
  const until = performance.now() + 5000;
  while (performance.now() < until) {
    if ((await readFile(filename, "utf8")).split("\n").includes(event)) return;
    await new Promise(done => setTimeout(done, 20));
  }
  assert.fail(`The real runtime did not emit the synthetic ${event} observation`);
}

function nativeCli(filename, args, environment, children, { longLived = false } = {}) {
  const child = fork(filename, args, { cwd: repository, env: environment, execArgv: [], silent: true });
  children.push(child); let stdout = "", stderr = "", timedOut = false;
  const deadline = longLived ? null : setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 45000);
  for (const [stream, receive] of [[child.stdout, value => { stdout += value; }], [child.stderr, value => { stderr += value; }]]) stream.on("data", bytes => {
    receive(bytes.toString()); if (stdout.length + stderr.length > 32768) child.kill("SIGKILL");
  });
  const finished = new Promise((yes, no) => {
    child.once("error", error => { clearTimeout(deadline); no(error); });
    child.once("close", (code, signal) => { clearTimeout(deadline); yes({ code, signal }); });
  });
  const reports = () => stdout.trim().split("\n").filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  return { child, finished, reports, diagnostic: () => `${timedOut ? "Synthetic native CLI exceeded its 45-second deadline.\n" : ""}${stderr}` };
}
async function stopNativeCli(process) {
  const kill = setTimeout(() => process.child.kill("SIGKILL"), 10000);
  try {
    if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill("SIGTERM");
    return await process.finished;
  } finally { clearTimeout(kill); }
}
async function waitForReport(process, predicate) {
  const until = performance.now() + 20000;
  while (performance.now() < until) {
    const report = process.reports().find(predicate); if (report) return report;
    if (process.child.exitCode !== null || process.child.signalCode !== null) assert.fail(`The native recovery parent exited before its ready report: ${process.diagnostic()}`);
    await new Promise(done => setTimeout(done, 20));
  }
  assert.fail("The native recovery parent did not report ready");
}

for (const parentGateway of [false, true]) test(`witness maintenance drains and resumes the actual messaging runtime, SQL and media ${parentGateway ? "through the real parent gateway" : "directly"} without enabling closures (disposable MariaDB only)`, {
  skip: !enabled ? "Set JESSIEMESSAGE_DB_TEST=1 with loopback disposable credentials." : !supportedFiles ? "Requires Linux private directory anchors." : false,
  timeout: 240000,
}, async t => {
  const db = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(db.host));
  assert.match(db.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  assert.match(process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_USER ?? "", /^jessiemessage_shared_test(?:_[a-z0-9]+)*$/);
  assert.ok(process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_PASSWORD);
  const migrations = await loadMigrations(), allowed = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let runtime, bootstrapPool, gateway, pendingBody, supervisor, observer;
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
  const ports = parentGateway ? await adjacentPorts() : { port: await freePort() };
  const { port } = ports, publicPort = ports.publicPort ?? port;
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
  const driver = path.join(root, "actual-runtime-ci.mjs"), events = path.join(root, "runtime-observations.txt");
  await writeFile(events, "", { mode: 0o600, flag: "wx" });
  // This adapter changes only the disposable CI transport. Production private
  // loading intentionally has no plaintext/TLS override. The real six-file
  // loader, main, SQL inspection/schema checks, media decoder, start, workers,
  // HTTP readiness and drain are all executed; no synthetic listener is used.
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
    inspect: async input => {
      const result = await inspectDatabase({ ...input, env: local(input.env) });
      assert.deepEqual(result.checks.filter(check => check.status !== 'pass').map(check => check.name), ['transport']);
      return { ...result, valid: true, checks: result.checks.map(check => check.name === 'transport' ? { ...check, status: 'pass' } : check) };
    },
    checkSchema: env => checkMessagingSchema(local(env)),
    checkStorage: env => checkRuntimeMediaStorage(local(env)),
  }),
  start: async (env, options) => {
    const runtime = await start(local(env), options);
    runtime.server.on('request', incoming => { if (incoming.method === 'POST' && incoming.url === '/api/auth/login') void appendFile(${JSON.stringify(events)}, 'request\\n'); });
    process.on('SIGTERM', () => { void appendFile(${JSON.stringify(events)}, 'signal\\n'); });
    return runtime;
  },
}) });
`, { flag: "wx", mode: 0o600 });
  const children = [], recoveryProcesses = [];
  try {
    await clean(); await applyMigrations(connection, { database: db.database, migrations });
    const storage = await createMediaStorage({ root: dirs.media, key: Buffer.from(records.media.mediaKey, "base64url"), pathMode: "linux-dirfd" });
    const rootFingerprint = await storage.fingerprint();
    bootstrapPool = await createRuntimePool(await localEnv());
    await createMediaCapacityStore({ pool: bootstrapPool, capacity: { ownerBytes: Number(records.media.ownerBytes), totalBytes: Number(records.media.totalBytes), rootFingerprint } }).initialize({ now: Date.now(), offline: true });
    await bootstrapPool.end(); bootstrapPool = null;
    const destinationId = randomBytes(16).toString("hex"), pairedAt = Date.now() - 1000, copyToken = randomBytes(32).toString("base64url");
    await saveCopyState(dirs.operations, { version: 1, revision: 0, destinations: [{ id: destinationId, label: "Synthetic CI computer", kind: "computer", enabled: true,
      pairHash: null, pairExpiresAt: null, tokenHash: digest(copyToken), pairedAt, lastSeenAt: null, locationId: null, lastReceipt: null }] }, 0);
    const beforePairing = await readCopyState(dirs.operations), beforeSql = await sqlHash();
    const pins = await Promise.all(["scripts/start-private-messaging.mjs", "server/index.mjs"].map(async name => [name, digest(await readFile(path.join(repository, name)))]));
    const source = async () => { for (const [name, hash] of pins) assert.equal(digest(await readFile(path.join(repository, name))), hash); };
    const options = { command: "plan-witness", runtimeDirectory: repository, runtimeHead: "1".repeat(40), runtimeTree: "2".repeat(40), privateDirectory: dirs.private,
      operationsDirectory: dirs.operations, privatePathMode: "linux-dirfd", witnessOperatorDirectory: dirs.operator, witnessDestination: destinationId };
    const internal = { source, withOrigin: (selected, settings, work) => withConfiguredWitnessOrigin(selected, settings, work, { loadEnvironment: localEnv }) };
    const plan = await createWitnessOriginOperations(options, { environment }, internal).plan();
    const operations = createWitnessOriginOperations({ ...options, command: "prepare-witness", witnessDestination: undefined, witnessPlanSha256: plan.planSha256 }, { environment }, internal);
    runtime = createManagedRuntime({ runtimeDirectory: repository, privateDirectory: dirs.private, operationsDirectory: dirs.operations, port, parentGateway, environment }, {
      forkClient(_shim, args, settings) { const child = fork(driver, args, settings); children.push(child); return child; },
    });
    await runtime.start(); assert.equal(runtime.state().status, "running");
    const controlPath = "/__synthetic_witness_control";
    if (parentGateway) {
      const control = async (incoming, outgoing) => {
        if (incoming.url !== controlPath) return false;
        outgoing.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        outgoing.end('{"synthetic":"control-ready"}'); return true;
      };
      gateway = createParentGateway({ port: publicPort, childPort: port, control }); await gateway.start();
      // The child's managed authority rejects missing/invalid stamps. The
      // actual gateway must overwrite attacker-supplied input with its peer.
      assert.equal((await localRequest(port, "/api/ready")).status, 503);
      assert.equal((await localRequest(port, "/api/ready", { headers: { "X-Jessie-Parent-Peer": "invalid-peer" } })).status, 503);
      assert.deepEqual(await localRequest(publicPort, "/api/ready", { headers: { "X-Jessie-Parent-Peer": "invalid-peer" } }), { status: 200, body: '{"status":"ready"}' });
      assert.deepEqual(await localRequest(publicPort, controlPath), { status: 200, body: '{"synthetic":"control-ready"}' });
    }
    const entry = await localRequest(publicPort, "/api/entry"); assert.equal(entry.status, 200);
    assert.deepEqual(JSON.parse(entry.body), { status: "available", client: { state: "signed_out", href: "/connect-device/client" },
      administrator: { state: "signed_out", href: "/connect-device/admin" } });
    const publicEntry = await localRequest(publicPort, "/"); assert.equal(publicEntry.status, 200);
    const authentication = [];
    for (const [resource, method, expected] of [["/api/auth/session", "GET", 401], ["/api/auth/session", "POST", 405],
      ["/api/auth/login", "GET", 405], ["/api/access/session", "GET", 401]]) {
      const result = await localRequest(publicPort, resource, { method }); assert.equal(result.status, expected);
      if (expected === 405) assert.equal(result.allow, resource === "/api/auth/session" ? "GET" : "POST");
      authentication.push({ resource, method, result });
    }
    const first = children[0], progress = []; let observedRuntime = runtime;
    if (parentGateway) {
      let observedStop = false;
      observedRuntime = { start: runtime.start, state: runtime.state, async stop() {
        if (observedStop) return runtime.stop(); observedStop = true;
        // Open the real in-flight request only after maintenance prechecks so
        // its five-second body deadline cannot run during setup on a busy CI.
        let finishResponse, failResponse;
        const response = new Promise((yes, no) => { finishResponse = yes; failResponse = no; });
        void response.catch(() => {});
        pendingBody = request({ host: "127.0.0.1", port: publicPort, path: "/api/auth/login", method: "POST", agent: false,
          headers: { Host: "jessiemessage.com", Origin: "https://jessiemessage.com", "Content-Type": "application/json", "X-Jessie-Request": "1" } }, incoming => {
          incoming.resume(); incoming.on("error", failResponse); incoming.once("end", () => finishResponse(incoming.statusCode));
        });
        pendingBody.once("error", failResponse); pendingBody.write('{"');
        await waitForEvent(events, "request");
        const stopping = runtime.stop();
        await waitForEvent(events, "signal");
        assert.equal(runtime.state().status, "stopping"); assert.equal(first.exitCode, null);
        // This request traverses the real parent while the actual application
        // has begun draining its incomplete request and has not exited.
        assert.deepEqual(await localRequest(publicPort, controlPath), { status: 200, body: '{"synthetic":"control-ready"}' });
        pendingBody.end("invalid"); assert.equal(await response, 400); pendingBody = null;
        return stopping;
      } };
    }
    const result = await runManagedWitnessPreparation({ runtime: observedRuntime, operations, source, emit: value => progress.push(value) });
    assert.equal(result.prepared, true); assert.equal(result.runtimeResumed, true); assert.equal(result.closuresEnabled, false); assert.equal(result.externalWitnessConfirmed, false);
    assert.equal(first.exitCode, 0); assert.equal(first.signalCode, null); assert.equal(children.length, 2); assert.notEqual(children[1].pid, first.pid);
    assert.equal(runtime.state().status, "running");
    assert.deepEqual(await localRequest(publicPort, "/api/ready"), { status: 200, body: '{"status":"ready"}' });
    assert.deepEqual(await localRequest(publicPort, "/api/entry"), entry);
    assert.deepEqual(await localRequest(publicPort, "/"), publicEntry);
    for (const { resource, method, result } of authentication) assert.deepEqual(await localRequest(publicPort, resource, { method }), result);
    assert.equal((await localRequest(publicPort, "/api/admin/closures/clients/" + "a".repeat(32))).status, 401);
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
    if (parentGateway) {
      assert.equal((await localRequest(publicPort, "/api/ready")).status, 503);
      assert.deepEqual(await localRequest(publicPort, controlPath), { status: 200, body: '{"synthetic":"control-ready"}' });
      await gateway.close(); gateway = null; await runtime.destroy();

      // Compose the actual observer against the just-published original
      // contract. The only origin adapter is the same loopback SQL transport
      // used above; enrollment, continuity, HTTP, registry files and supervisor
      // maintenance use their real production implementations.
      const enrollmentDirectory = path.join(dirs.operator, "enrollment"); await mkdir(enrollmentDirectory, { mode: 0o700 });
      const observerOptions = { ...options, command: "start", witnessContractSha256: result.contractSha256 };
      const observations = [];
      observer = await createConfiguredWitnessObserver(observerOptions, { environment, emit: value => observations.push(value) }, internal);
      assert.equal((await observer.checkInitial()).status, "passed");
      await assert.rejects(observer.check(), { code: "WITNESS_ENROLLMENT_MISSING" });
      assert.deepEqual(await readdir(enrollmentDirectory), [], "read-only startup never creates a missing enrollment authority");
      assert.equal(await sqlHash(), beforeSql);
      // Gateway shutdown owns this observer even after the test clears its
      // cleanup variable before starting a separate recovery-only process.
      const controlledObserver = observer;
      const nativeControl = async (incoming, outgoing) => {
        if (incoming.url === controlPath) {
          outgoing.writeHead(200, { "Content-Type": "application/json" }); outgoing.end('{"synthetic":"control-ready"}'); return true;
        }
        return controlledObserver.handler(incoming, outgoing);
      };
      Object.defineProperty(nativeControl, "close", { value: controlledObserver.close });
      supervisor = createRecurringSupervisor(observerOptions, {
        environment: { ...environment, PORT: String(publicPort) }, source,
        witnessControl: nativeControl,
        makeRuntime(configuration) {
          assert.equal(configuration.port, port); assert.equal(configuration.parentGateway, true); assert.equal(configuration.accountClosures, false);
          runtime = createManagedRuntime(configuration, { forkClient(_shim, args, settings) {
            const child = fork(driver, args, settings); children.push(child); return child;
          } }); return runtime;
        },
      });
      observer.attachMaintenance(supervisor.withWitnessMaintenance, supervisor.failWitnessObservation);
      assert.deepEqual(await supervisor.start(), { ready: true });
      // Settle the genuine scheduler's read-only missing-configuration check
      // before requesting the exclusive observation maintenance capability.
      await supervisor.tick(); assert.equal(runtime.state().status, "running");
      const beforeInitialize = children.length;
      const authority = await observer.initialize();
      assert.equal(authority.prepared, true); assert.equal(authority.genesisReplayed, false); assert.equal(authority.closuresEnabled, false);
      assert.equal(children.length, beforeInitialize + 1, "authority publication drains and resumes the actual child");
      assert.equal((await observer.check()).status, "passed");
      const statePath = path.join(enrollmentDirectory, WITNESS_ENROLLMENT_FILE);
      assert.equal(JSON.parse(await readFile(statePath, "utf8")).phase, "ready");
      await observer.tick(); assert.equal(observer.state().state, "enrollment_required");
      assert.equal(children.length, beforeInitialize + 1, "an unspent authority requires no PC or further interruption");
      const nativeHeaders = { "X-Jessie-Backup": "1", Authorization: `Bearer ${copyToken}` };
      const attemptId = randomBytes(16).toString("hex"), enrollmentRequest = JSON.stringify({ version: 1, destinationId, attemptId });
      const beforeRejected = await readFile(statePath), beforeRejectedChildren = children.length;
      const rejected = await localRequest(publicPort, "/api/backup-copy/witness/enroll", { method: "POST", body: enrollmentRequest,
        headers: { ...nativeHeaders, Authorization: `Bearer ${randomBytes(32).toString("base64url")}`, "Content-Type": "application/json; charset=utf-8" } });
      assert.equal(rejected.status, 403); assert.deepEqual(JSON.parse(rejected.body), { error: "copy_authorization_rejected" });
      assert.deepEqual(await readFile(statePath), beforeRejected); assert.equal(children.length, beforeRejectedChildren);
      const enrolled = await localRequest(publicPort, "/api/backup-copy/witness/enroll", { method: "POST", body: enrollmentRequest,
        headers: { ...nativeHeaders, "Content-Type": "application/json; charset=utf-8" } });
      assert.equal(enrolled.status, 200); const packet = JSON.parse(enrolled.body);
      assert.deepEqual(packet, { version: 1, initialize: true, destinationId, attemptId, contractSha256: result.contractSha256,
        contractId: contract.contractId, registryId: contract.registryId, initialSnapshotSha256: contract.initialSnapshotSha256 });
      assert.equal(JSON.parse(await readFile(statePath, "utf8")).phase, "spent");
      assert.equal(children.length, beforeRejectedChildren + 1, "durable native reservation uses a real stopped/resumed runtime");
      assert.equal((await observer.check()).status, "passed");
      assert.deepEqual(await localRequest(publicPort, "/api/ready"), { status: 200, body: '{"status":"ready"}' });

      // This is a disposable protocol peer in a separate directory, not a
      // claim of off-host production continuity. It uses the real immutable
      // witness storage and answers every new random challenge through HTTP.
      const pcDirectory = path.join(root, "synthetic-pc-witness"); await mkdir(pcDirectory, { mode: 0o700 });
      const witness = createRegistryWitness({ directory: pcDirectory, registryId: packet.registryId });
      assert.equal((await witness.initializeEmpty()).revision, 1);
      const challenges = new Set();
      let lastPcResponse;
      async function respondToWitnessRequest({ provisioning = true, replay = false } = {}) {
        const poll = await localRequest(publicPort, "/api/backup-copy/witness/poll", { headers: nativeHeaders });
        assert.equal(poll.status, 200); const job = JSON.parse(poll.body);
        assert.equal(job.pending, true); assert.equal(job.provisioning, provisioning); assert.equal(job.destinationId, destinationId);
        assert.equal(job.request.registryId, packet.registryId); assert.equal(challenges.has(job.request.challenge), false); challenges.add(job.request.challenge);
        const response = replay ? lastPcResponse : await witness.exchange(job.request);
        assert.ok(response);
        const recorded = await localRequest(publicPort, "/api/backup-copy/witness/response", { method: "POST",
          headers: { ...nativeHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ version: 1, requestId: job.requestId, response }) });
        if (replay) { assert.equal(recorded.status, 503); return job; }
        lastPcResponse = response;
        assert.equal(recorded.status, 200); assert.deepEqual(JSON.parse(recorded.body), { version: 1, recorded: true });
        return job;
      }
      const beforeVerify = children.length, checking = observer.tick();
      await respondToWitnessRequest(); await respondToWitnessRequest(); await respondToWitnessRequest();
      assert.deepEqual(await checking, { verified: true, registrySha256: contract.initialSnapshotSha256, witnessRevision: 1, receipts: 0 });
      assert.equal(children.length, beforeVerify + 1, "first live read/publish verification has one actual maintenance restart");
      assert.equal(observer.state().state, "confirmed"); assert.equal(observer.state().externalWitnessConfirmed, true); assert.equal(observer.state().closuresEnabled, false);
      assert.equal(observations.at(-1).mode, "observe_only"); assert.equal(challenges.size, 3);
      const beforeRefresh = children.length, refresh = observer.tick(); await respondToWitnessRequest(); assert.equal(await refresh, null);
      assert.equal(challenges.size, 4); assert.equal(children.length, beforeRefresh, "a later fresh PC head read does not interrupt daily messages");
      assert.equal(observer.state().externalWitnessConfirmed, true);
      assert.deepEqual(await localRequest(publicPort, "/api/entry"), entry);
      assert.deepEqual(await localRequest(publicPort, "/api/ready"), { status: 200, body: '{"status":"ready"}' });
      assert.deepEqual(await readCopyState(dirs.operations), beforePairing);
      const beforePauseChildren = children.length, beforePauseAuthority = await readFile(statePath);
      const pausedCopy = structuredClone(beforePairing); pausedCopy.destinations[0].enabled = false;
      await saveCopyState(dirs.operations, pausedCopy, beforePairing.revision);
      assert.equal((await observer.check()).status, "passed", "pausing the original PC is an availability choice, not an original-source failure");
      const pausedEnrollment = await localRequest(publicPort, "/api/backup-copy/witness/enroll", { method: "POST", body: enrollmentRequest,
        headers: { ...nativeHeaders, "Content-Type": "application/json; charset=utf-8" } });
      assert.equal(pausedEnrollment.status, 403); assert.deepEqual(JSON.parse(pausedEnrollment.body), { error: "copy_authorization_rejected" });
      assert.deepEqual(await readFile(statePath), beforePauseAuthority, "a paused capability cannot consume or replace enrollment authority");
      assert.equal(children.length, beforePauseChildren); assert.equal(runtime.state().status, "running");
      assert.equal(supervisor.state().closed, false); assert.equal(challenges.size, 4, "the pause path performs no independent PC proof");
      assert.deepEqual(await localRequest(publicPort, "/api/ready"), { status: 200, body: '{"status":"ready"}' });
      const resumeCopy = await readCopyState(dirs.operations); resumeCopy.destinations[0].enabled = true;
      await saveCopyState(dirs.operations, resumeCopy, resumeCopy.revision);
      const resumedCopy = await readCopyState(dirs.operations);
      assert.equal(resumedCopy.revision, beforePairing.revision + 2); assert.deepEqual(resumedCopy.destinations, beforePairing.destinations);
      assert.equal((await observer.check()).status, "passed"); assert.equal(children.length, beforePauseChildren);
      assert.equal(await sqlHash(), beforeSql);
      assert.deepEqual(await Promise.all(names.map(name => readFile(path.join(dirs.private, name)))), initialPrivate);
      assert.equal(digest(await readFile(path.join(dirs.operator, "contract", WITNESS_GENESIS_FILE))), result.contractSha256);

      // The actual recovery CLI obtains fresh challenges through a real
      // Unix operator socket, the existing HTTP mailbox and durable PC peer.
      // Only the already-real six-file loader's disposable SQL transport and
      // the synthetic checkpoint receipt metadata are adapted in this test.
      t.diagnostic("C2 native recovery capsule: preparing");
      assert.equal(await observer.startRecoveryControl(), true);
      const checkpointDirectory = path.join(root, "old-checkpoint"), targetMedia = path.join(root, "recovery-media"),
        laterSource = path.join(root, "later-synthetic-receipts"), quarantine = path.join(root, "recovery-quarantine");
      for (const directory of [checkpointDirectory, targetMedia, laterSource]) await mkdir(directory, { mode: 0o700 });
      const crmKey = Buffer.from(records.crm.crmKey, "base64url"), recoveryBinding = contract.binding;
      const oldState = await withPrivateDirectory(dirs.operations, scope => captureOperationalState(scope, { key: crmKey, binding: recoveryBinding }));
      const rawManifest = Buffer.from('{"synthetic":"operational-recovery-capsule"}\n');
      await writeFile(path.join(checkpointDirectory, "manifest.json"), rawManifest, { mode: 0o600, flag: "wx" });
      const checkpointReceipt = { format: "jessiemessage-private-checkpoint", version: 10,
        profile: "messaging-photos-notify-recovery-crm-broadcast-application", coverage: { ...APPLICATION_COVERAGE }, createdAt: Date.now(),
        schema: { tables: 31, migrations: 31 }, manifest: { file: "manifest.json", sha256: digest(rawManifest) },
        sql: { file: "database.sql.gz", bytes: 1, sha256: "e".repeat(64), uncompressedBytes: 1, uncompressedSha256: "e".repeat(64) }, media: { files: [], bytes: 0 } };
      checkpointReceipt.operations = await withPrivateDirectory(checkpointDirectory, scope => writeOperationalCheckpoint(scope, oldState, checkpointReceipt, crmKey));
      await withPrivateDirectory(checkpointDirectory, scope => writeCheckpointReceipt(scope, checkpointReceipt));
      const laterGate = createErasureContinuity({ key: crmKey, binding: recoveryBinding,
        readCurrent: () => withPrivateDirectory(laterSource, scope => captureOperationalState(scope, { key: crmKey, binding: recoveryBinding })),
        exchange: request => witness.exchange(request) });
      const journal = createErasureJournal({ directory: laterSource, key: crmKey, binding: recoveryBinding, clientId: "a".repeat(32) });
      try {
        let revision = 0, record = { version: 1, clientId: "a".repeat(32), binding: recoveryBinding, phase: "requested", cursor: null, startedAt: Date.now(), updatedAt: Date.now() };
        record.updatedAt = record.startedAt;
        for (const phase of ["requested", "prepared", "files_erased", "completed"]) {
          record = { ...record, phase, updatedAt: record.updatedAt + (phase === "requested" ? 0 : 1) };
          revision = (await journal.save(record, revision, async () => {})).revision;
          await laterGate.verify(async () => {});
        }
      } finally { journal.close(); laterGate.close(); }
      const args = command => [command, "--private-directory", dirs.private, "--operations-directory", dirs.operations,
        "--checkpoint-directory", checkpointDirectory, "--destination-private-directory", quarantine,
        "--database", "synthetic_isolated_target", "--media-root", targetMedia,
        "--witness-operator-directory", dirs.operator, "--witness-contract-sha256", result.contractSha256];
      const dependencies = { inheritedEnv: environment, execArgv: [], loadEnvironment: localEnv, outputStream: { write() {} } };
      const beforeRecoveryChildren = children.length, beforeRecoveryChallenges = challenges.size;
      t.diagnostic("C2 native recovery capsule: check started");
      const [checkedRecovery] = await Promise.all([restoreOperations(args("check"), dependencies), respondToWitnessRequest()]);
      assert.equal(checkedRecovery.externalRegistryContinuityVerified, true); assert.equal(checkedRecovery.completedReceipts, 1);
      assert.equal(checkedRecovery.started, false); assert.equal(checkedRecovery.reconciliationRequired, true);
      t.diagnostic("C2 native recovery capsule: check passed; restore started");
      const [restoredRecovery] = await Promise.all([
        restoreOperations([...args("restore"), "--confirm-plan-sha256", checkedRecovery.planSha256], dependencies),
        (async () => { for (let index = 0; index < 4; index++) await respondToWitnessRequest(); })(),
      ]);
      assert.equal(restoredRecovery.restored, true); assert.equal(restoredRecovery.completedReceipts, 1);
      assert.equal(restoredRecovery.started, false); assert.equal(restoredRecovery.sqlRestored, false);
      t.diagnostic("C2 native recovery capsule: restore passed");
      assert.equal(challenges.size, beforeRecoveryChallenges + 5);
      assert.equal(children.length, beforeRecoveryChildren, "recovery reads never stop or restart the daily child");
      assert.deepEqual(JSON.parse(await readFile(path.join(quarantine, OPERATIONAL_RESTORE_MARKER))).sourceBinding, recoveryBinding);
      await assert.rejects(withPrivateDirectory(quarantine, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
      assert.equal((await readdir(quarantine)).filter(name => name.startsWith("erasure-")).length, 1);
      assert.equal((await withPrivateDirectory(dirs.operations, scope => captureOperationalState(scope, { key: crmKey, binding: recoveryBinding }))).files.length, 0);
      assert.equal(await sqlHash(), beforeSql);
      assert.deepEqual(await localRequest(publicPort, "/api/ready"), { status: 200, body: '{"status":"ready"}' });

      const originalAuthority = await readFile(statePath);
      await unlink(statePath); const beforeMissing = children.length;
      await assert.rejects(observer.check(), { code: "WITNESS_ENROLLMENT_MISSING" });
      assert.deepEqual(await readdir(enrollmentDirectory), [WITNESS_ENROLLMENT_ORIGIN]);
      assert.equal(children.length, beforeMissing, "missing authority is refused without silent initialization or runtime mutation");
      // Restore only this disposable fixture's exact prior authority, then
      // release the actual application parent before an explicit recovery
      // process takes the public port. No production preparation is replayed.
      await writeFile(statePath, originalAuthority, { mode: 0o600, flag: "wx" });
      await observer.close(); observer = null;
      await supervisor.close(); supervisor = null;
      assert.equal(runtime.state().status, "closed");
      const runtimeEventsBeforeRecovery = await readFile(events);
      const laterFile = (await readdir(laterSource)).find(name => /^erasure-[a-f0-9]{64}\.json$/.test(name));
      const completedBytes = await readFile(path.join(laterSource, laterFile));
      await writeFile(path.join(dirs.operations, laterFile), completedBytes, { mode: 0o600, flag: "wx" });
      const recoveryDriver = path.join(root, "actual-recovery-parent-ci.mjs");
      // Only the disposable database's plaintext transport is adapted. The
      // executable CLI/parser, source git pin, six-file loader, provenance,
      // spent authority, HTTP server, Unix RPC and PC mailbox are real.
      await writeFile(recoveryDriver, `
import { main } from ${JSON.stringify(moduleUrl("scripts/start-recurring-private-messaging.mjs"))};
import { createConfiguredWitnessRecovery } from ${JSON.stringify(moduleUrl("server/backup/witness-recovery-parent.mjs"))};
import { withConfiguredWitnessOrigin } from ${JSON.stringify(moduleUrl("server/backup/witness-origin-context.mjs"))};
import { loadRuntimeBroadcastEnvironment } from ${JSON.stringify(moduleUrl("server/config/runtime-broadcast.mjs"))};
const cancellation = new AbortController();
const stop = () => cancellation.abort(); process.once('SIGTERM', stop); process.once('SIGINT', stop);
try {
  await main(process.argv.slice(2), { environment: process.env, execArgv: [], signal: cancellation.signal,
    makeWitnessRecovery: (options, settings) => createConfiguredWitnessRecovery(options, settings, {
      withOrigin: (selected, context, work) => withConfiguredWitnessOrigin(selected, context, work, {
        loadEnvironment: async (directory, configuration) => ({ ...await loadRuntimeBroadcastEnvironment(directory, configuration), JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: '1' }),
      }),
    }),
  });
} catch { process.stderr.write('SYNTHETIC_RECOVERY_CLI_REFUSED\\n'); process.exitCode = 1; }
finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
`, { mode: 0o600, flag: "wx" });
      const gitHead = execFileSync("/usr/bin/git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const gitTree = execFileSync("/usr/bin/git", ["-C", repository, "rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
      const recoveryEnvironment = { ...environment, PORT: String(publicPort) };
      const parentArgs = (command, operationsDirectory = dirs.operations) => [command,
        "--runtime-directory", repository, "--runtime-head", gitHead, "--runtime-tree", gitTree,
        "--private-directory", dirs.private, "--operations-directory", operationsDirectory, "--private-path-mode", "linux-dirfd",
        "--witness-operator-directory", dirs.operator, "--witness-contract-sha256", result.contractSha256];
      const restoreFilename = fileURLToPath(new URL("../scripts/restore-private-operations.mjs", import.meta.url));
      const beforeRecoveryPairing = await readFile(path.join(dirs.operations, "backup-copy-state.json"));
      const beforeRecoveryContract = await readFile(path.join(dirs.operator, "contract", WITNESS_GENESIS_FILE));
      const rejectedSource = path.join(root, "copied-untrusted-operations"); await mkdir(rejectedSource, { mode: 0o700 });
      await writeFile(path.join(rejectedSource, "backup-copy-state.json"), beforeRecoveryPairing, { mode: 0o600, flag: "wx" });
      await writeFile(path.join(rejectedSource, laterFile), completedBytes, { mode: 0o600, flag: "wx" });
      t.diagnostic("C3 native provenance refusal: started");
      const badProvenance = nativeCli(recoveryDriver, parentArgs("check-witness-recovery", rejectedSource), recoveryEnvironment, recoveryProcesses);
      assert.deepEqual(await badProvenance.finished, { code: 1, signal: null }); assert.deepEqual(badProvenance.reports(), []);
      assert.match(badProvenance.diagnostic(), /^SYNTHETIC_RECOVERY_CLI_REFUSED\n$/);
      t.diagnostic("C3 native provenance refusal: passed");

      for (const localState of ["nonempty", "lost"]) {
        if (localState === "lost") await unlink(path.join(dirs.operations, laterFile));
        t.diagnostic(`C3 ${localState}: precheck started`);
        const precheck = nativeCli(recoveryDriver, parentArgs("check-witness-recovery"), recoveryEnvironment, recoveryProcesses);
        assert.deepEqual(await precheck.finished, { code: 0, signal: null }, precheck.diagnostic());
        assert.deepEqual(precheck.reports(), [{ version: 1, type: "witness_recovery_precheck", status: "passed", mode: "recovery_only", started: false,
          closuresEnabled: false, externalWitnessConfirmed: false }]);
        t.diagnostic(`C3 ${localState}: precheck passed; parent starting`);
        const parent = nativeCli(recoveryDriver, parentArgs("start-witness-recovery"), recoveryEnvironment, recoveryProcesses, { longLived: true });
        let parentStarted = false;
        const target = path.join(root, `native-recovery-quarantine-${localState}`);
        const nativeArgs = command => args(command).map(value => value === quarantine ? target : value);
        const beforeNativeChallenges = challenges.size;
        try {
          const started = await waitForReport(parent, value => value.type === "witness_recovery_parent" && value.status === "started");
          parentStarted = true;
          assert.equal(started.mode, "recovery_only"); assert.equal(started.externalWitnessConfirmed, false); assert.equal(started.closuresEnabled, false);
          t.diagnostic(`C3 ${localState}: parent started`);
          for (const route of ["/", "/api/ready", "/api/entry", "/api/auth/login", "/api/admin/closures/clients/" + "a".repeat(32), "/api/backup-copy/witness/enroll"])
            assert.equal((await localRequest(publicPort, route)).status, 503, `recovery-only process must not serve ${route}`);
          t.diagnostic(`C3 ${localState}: native recovery check started`);
          const check = nativeCli(restoreFilename, nativeArgs("check"), recoveryEnvironment, recoveryProcesses);
          await Promise.all([
            check.finished.then(exited => assert.deepEqual(exited, { code: 0, signal: null }, check.diagnostic())),
            respondToWitnessRequest({ provisioning: false }),
          ]);
          const checked = check.reports()[0];
          assert.equal(checked.completedReceipts, 1); assert.equal(checked.externalRegistryContinuityVerified, true);
          assert.equal(checked.sqlRestored, false); assert.equal(checked.started, false); assert.equal(checked.reconciliationRequired, true);
          t.diagnostic(`C3 ${localState}: native recovery check passed; restore started`);
          const restoring = nativeCli(restoreFilename, [...nativeArgs("restore"), "--confirm-plan-sha256", checked.planSha256], recoveryEnvironment, recoveryProcesses);
          await Promise.all([
            restoring.finished.then(exited => assert.deepEqual(exited, { code: 0, signal: null }, restoring.diagnostic())),
            (async () => { for (let index = 0; index < 4; index++) await respondToWitnessRequest({ provisioning: false }); })(),
          ]);
          assert.equal(restoring.reports()[0].restored, true); assert.equal(challenges.size, beforeNativeChallenges + 5);
          t.diagnostic(`C3 ${localState}: restore passed`);
          assert.deepEqual(await readFile(path.join(target, laterFile)), completedBytes);
          await assert.rejects(withPrivateDirectory(target, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
          assert.equal((await readFile(`/proc/${parent.child.pid}/task/${parent.child.pid}/children`, "utf8")).trim(), "", "recovery-only parent has no application/producer child");
          assert.deepEqual(await readFile(events), runtimeEventsBeforeRecovery);
          assert.equal(await sqlHash(), beforeSql);
          assert.deepEqual(await readFile(statePath), originalAuthority);
          assert.deepEqual(await readFile(path.join(dirs.operations, "backup-copy-state.json")), beforeRecoveryPairing);
          assert.deepEqual(await readFile(path.join(dirs.operator, "contract", WITNESS_GENESIS_FILE)), beforeRecoveryContract);

          // C4 is a separate, read-only native process. A completed source
          // receipt becomes a replay-from-start requirement for this exact
          // quarantine; neither its phase nor cursor authorizes target SQL.
          t.diagnostic(`C4 ${localState}: native reconciliation planning started`);
          const planFilename = fileURLToPath(new URL("../scripts/plan-closure-reconciliation.mjs", import.meta.url));
          const planArgs = nativeArgs("check").map(value => value === "--destination-private-directory" ? "--quarantine-private-directory" : value);
          const beforePlanChallenges = challenges.size, beforePlanMarker = await readFile(path.join(target, OPERATIONAL_RESTORE_MARKER));
          const planning = nativeCli(planFilename, planArgs, recoveryEnvironment, recoveryProcesses);
          await Promise.all([
            planning.finished.then(exited => assert.deepEqual(exited, { code: 0, signal: null }, planning.diagnostic())),
            (async () => { for (let index = 0; index < 2; index++) await respondToWitnessRequest({ provisioning: false }); })(),
          ]);
          const planned = planning.reports()[0];
          assert.equal(planned.status, "closure_reconciliation_planned"); assert.match(planned.planSha256, /^[a-f0-9]{64}$/);
          assert.equal(planned.completedReceipts, 1); assert.equal(planned.replayFromStartReceipts, 1);
          assert.equal(planned.sqlMutationAuthorized, false); assert.equal(planned.targetSqlInspected, false);
          assert.equal(planned.targetAbsenceVerified, false); assert.equal(planned.targetMutated, false); assert.equal(planned.started, false);
          assert.equal(challenges.size, beforePlanChallenges + 2);
          assert.deepEqual(await readFile(path.join(target, OPERATIONAL_RESTORE_MARKER)), beforePlanMarker);
          assert.deepEqual(await readFile(path.join(target, laterFile)), completedBytes);
          await assert.rejects(withPrivateDirectory(target, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
          assert.equal(await sqlHash(), beforeSql); assert.deepEqual(await readFile(events), runtimeEventsBeforeRecovery);
          assert.deepEqual(await readFile(statePath), originalAuthority);
          assert.deepEqual(await readFile(path.join(dirs.operations, "backup-copy-state.json")), beforeRecoveryPairing);
          assert.deepEqual(await readFile(path.join(dirs.operator, "contract", WITNESS_GENESIS_FILE)), beforeRecoveryContract);
          t.diagnostic(`C4 ${localState}: native reconciliation planning passed`);

          const blockedTarget = path.join(root, `native-recovery-refused-${localState}`);
          const blockedArgs = nativeArgs("check").map(value => value === target ? blockedTarget : value);
          t.diagnostic(`C3 ${localState}: replay or offline refusal started`);
          const blocked = nativeCli(restoreFilename, blockedArgs, recoveryEnvironment, recoveryProcesses);
          if (localState === "nonempty") await respondToWitnessRequest({ provisioning: false, replay: true });
          else {
            const poll = await localRequest(publicPort, "/api/backup-copy/witness/poll", { headers: nativeHeaders });
            assert.equal(poll.status, 200); const job = JSON.parse(poll.body); assert.equal(job.pending, true);
            assert.equal(challenges.has(job.request.challenge), false); challenges.add(job.request.challenge);
          }
          assert.equal(blocked.child.exitCode, null, "neither a replay nor an offline peer becomes a fresh success");
          assert.deepEqual(await stopNativeCli(blocked), { code: 1, signal: null }); assert.deepEqual(blocked.reports(), []);
          await assert.rejects(readFile(path.join(blockedTarget, OPERATIONAL_RESTORE_MARKER)), { code: "ENOENT" });
          assert.equal(await sqlHash(), beforeSql);
          t.diagnostic(`C3 ${localState}: replay or offline refusal passed`);
        } finally {
          t.diagnostic(`C3 ${localState}: parent stopping`);
          const stopped = await stopNativeCli(parent);
          if (parentStarted) assert.deepEqual(stopped, { code: 0, signal: null }, parent.diagnostic());
          t.diagnostic(`C3 ${localState}: parent stopped`);
        }
      }
      assert.equal((await withPrivateDirectory(dirs.operations, scope => captureOperationalState(scope, { key: crmKey, binding: recoveryBinding }))).files.length, 0);
      assert.equal(await sqlHash(), beforeSql); crmKey.fill(0);
    }
  } catch (error) {
    const safe = value => typeof value === "string" && /^[A-Za-z_]{1,80}$/.test(value) ? value : "unknown";
    const frames = String(error?.stack ?? "").split("\n").map(line => line.match(/\/(?:tests|scripts)\/[A-Za-z0-9_./-]+:\d+:\d+/)?.[0]).filter(Boolean).slice(0, 3);
    process.stderr.write(`SYNTHETIC_WITNESS_INTEGRATION_FAILED ${safe(error?.name)} ${safe(error?.code)} ${frames.join(" ")}\n`);
    throw error;
  } finally {
    pendingBody?.destroy(); await observer?.close(); await supervisor?.close(); await gateway?.close();
    await runtime?.destroy(); for (const child of children) { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
    await Promise.all(recoveryProcesses.filter(child => child.exitCode === null && child.signalCode === null).map(child => new Promise(done => {
      child.once("close", done); child.kill("SIGKILL");
    })));
    await bootstrapPool?.end(); await clean(); await connection.end();
  }
});
