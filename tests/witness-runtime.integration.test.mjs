import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
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
  const children = [];
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
      const nativeControl = async (incoming, outgoing) => {
        if (incoming.url === controlPath) {
          outgoing.writeHead(200, { "Content-Type": "application/json" }); outgoing.end('{"synthetic":"control-ready"}'); return true;
        }
        return observer.handler(incoming, outgoing);
      };
      Object.defineProperty(nativeControl, "close", { value: () => observer.close() });
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
      async function respondToWitnessRequest() {
        const poll = await localRequest(publicPort, "/api/backup-copy/witness/poll", { headers: nativeHeaders });
        assert.equal(poll.status, 200); const job = JSON.parse(poll.body);
        assert.equal(job.pending, true); assert.equal(job.provisioning, true); assert.equal(job.destinationId, destinationId);
        assert.equal(job.request.registryId, packet.registryId); assert.equal(challenges.has(job.request.challenge), false); challenges.add(job.request.challenge);
        const response = await witness.exchange(job.request);
        const recorded = await localRequest(publicPort, "/api/backup-copy/witness/response", { method: "POST",
          headers: { ...nativeHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ version: 1, requestId: job.requestId, response }) });
        assert.equal(recorded.status, 200); assert.deepEqual(JSON.parse(recorded.body), { version: 1, recorded: true });
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

      await unlink(statePath); const beforeMissing = children.length;
      await assert.rejects(observer.check(), { code: "WITNESS_ENROLLMENT_MISSING" });
      assert.deepEqual(await readdir(enrollmentDirectory), [WITNESS_ENROLLMENT_ORIGIN]);
      assert.equal(children.length, beforeMissing, "missing authority is refused without silent initialization or runtime mutation");
    }
  } finally {
    pendingBody?.destroy(); observer?.close(); await supervisor?.close(); await gateway?.close();
    await runtime?.destroy(); for (const child of children) { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
    await bootstrapPool?.end(); await clean(); await connection.end();
  }
});
