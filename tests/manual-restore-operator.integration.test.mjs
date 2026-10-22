import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { lstat, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { reconcileManualRestore, publishManualRestore } from "../server/backup/manual-restore.mjs";
import { assertNoOperationalRestore, readOperationalCheckpoint } from "../server/backup/operational-checkpoint.mjs";
import { acquireRecurringLock } from "../server/backup/recurring-checkpoint-files.mjs";
import { resumeManagedLocalClosureRuntime } from "../server/backup/managed-closures.mjs";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createApplicationInspectionPool } from "../server/backup/application-scope.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { run as runOperator } from "../scripts/manual-restore.mjs";
import { manualOperatorFixture, localRequest, fileHashes } from "./fixtures/manual-operator.mjs";
import { managedClosureFixture } from "./fixtures/managed-closure-runtime.mjs";
import { bundle, PRIMARY } from "./fixtures/crm-private.mjs";
import { databaseOptions } from "../server/db/connection.mjs";
import { writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration, writeRuntimeMessagingConfiguration,
  writeRuntimeMediaConfiguration, writeRuntimeNotificationsConfiguration, writeRuntimeCrmConfiguration } from "../server/config/runtime-database-file.mjs";
import { loadRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { createConfiguredLocalClosures } from "../server/backup/local-closure-parent.mjs";
import { checkpointProcess, createRecurringSupervisor, recurringPreflight } from "../server/backup/recurring-supervisor.mjs";
import { createManualBackupRequests } from "../server/backup/manual-backup-files.mjs";
import { createManualBackupService } from "../server/backup/manual-backup-service.mjs";
import { createManualBackupHandler } from "../server/backup/manual-backup-http.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";

test("an administrator request drains a real child, captures SQL33 and photos, encrypts with real GPG, resumes and downloads its pinned ciphertext", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with disposable loopback MariaDB, native clients, procfs and GPG.", timeout: 240000,
}, async t => {
  const f = await manualOperatorFixture(t), db = databaseOptions(), root = path.dirname(f.dirs.checkpoint);
  const privateDirectory = path.join(root, "manual-source-private"), operationsDirectory = path.join(root, "manual-operations"),
    runtimeDirectory = path.join(root, "manual-runtime"), home = path.join(root, "manual-synthetic-gpg");
  for (const directory of [privateDirectory, operationsDirectory, runtimeDirectory, home]) await mkdir(directory, { mode: 0o700 });
  const records = bundle(f.dirs["source-media"]);
  assert.match(process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_USER ?? "", /^jessiemessage_shared_test(?:_[a-z0-9]+)*$/);
  records.database = { ...records.database, host: db.host, port: String(db.port), database: db.database,
    user: process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_USER, password: process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_PASSWORD, privilegeProfile: "infomaniak-shared" };
  records.media = { ...records.media, ownerBytes: "1048576", totalBytes: "104857600", minimumFreeBytes: "0" };
  const writers = [writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration, writeRuntimeMessagingConfiguration,
    writeRuntimeMediaConfiguration, writeRuntimeNotificationsConfiguration, writeRuntimeCrmConfiguration];
  for (const [index, value] of Object.values(records).entries()) await writers[index](privateDirectory, value, PRIMARY);
  const synthetic = await managedClosureFixture(t, runtimeDirectory), port = new URL(synthetic.origin).port;
  const environment = { ...f.environment, PORT: port }, options = { command: "start", runtimeDirectory: root, runtimeHead: "1".repeat(40), runtimeTree: "2".repeat(40),
    privateDirectory, operationsDirectory, privatePathMode: "linux-dirfd" };
  const owner = await createConfiguredLocalClosures(options, { environment }, { loadEnvironment: async (directory, parameters) =>
    ({ ...await loadRuntimeBroadcastEnvironment(directory, parameters), JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1" }) });
  const gpgEnvironment = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
  const gpgArgs = ["--no-options", "--batch", "--no-tty", "--pinentry-mode", "loopback", "--homedir", home];
  let supervisor, handler, server;
  try {
    execFileSync("/usr/bin/gpg", [...gpgArgs, "--passphrase", "", "--quick-generate-key", "Manual backup synthetic fixture only", "rsa3072", "encr", "0"],
      { env: gpgEnvironment, timeout: 30000, stdio: "pipe" });
    const recipient = execFileSync("/usr/bin/gpg", [...gpgArgs, "--armor", "--export"], { env: gpgEnvironment, timeout: 5000, maxBuffer: 65536 });
    await writeFile(path.join(operationsDirectory, "recipient-public.asc"), recipient, { mode: 0o600, flag: "wx" });
    await writeFile(path.join(operationsDirectory, "recurring-backup.json"), `${JSON.stringify({ version: 1, enabled: true,
      recipientSha256: createHash("sha256").update(recipient).digest("hex"), hourUtc: 5, minuteUtc: 15 })}\n`, { mode: 0o600, flag: "wx" });
    // Only CI's disposable loopback transport differs. The actual checkpoint
    // child still loads six private files, inspects SQL, dumps twice, verifies
    // crypto/media, creates tar, and emits the production closed result.
    const driver = path.join(root, "manual-real-checkpoint-ci.mjs"), url = name => new URL(`../${name}`, import.meta.url).href;
    await writeFile(driver, `
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { run } from ${JSON.stringify(url("scripts/private-checkpoint-child.mjs"))};
import { main, inspectApplicationCheckpointIdentity } from ${JSON.stringify(url("scripts/private-checkpoint.mjs"))};
import { main as prepare } from ${JSON.stringify(url("scripts/backup.mjs"))};
import { dumpCloneSql } from ${JSON.stringify(url("scripts/verify-text-clone.mjs"))};
const local=env=>({...env,JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL:'1'});
const sqlClient=(executable,args,options)=>{assert.equal(executable,'/usr/bin/mariadb-dump');
 return spawn(executable,[args[0],'--skip-ssl',...args.slice(1).filter(value=>!value.startsWith('--ssl-ca=')&&value!=='--ssl-verify-server-cert')],options);};
await run(process.argv.slice(2),{loadMain:async()=>(args,settings)=>main(args,{...settings,
 inspectApplicationIdentity:(env,parameters)=>inspectApplicationCheckpointIdentity(local(env),parameters),
 prepare:(args,env,parameters)=>prepare(args,local(env),parameters),
 dump:(scope,target,config,password,parameters)=>dumpCloneSql(scope,target,config,password,{...parameters,spawnClient:sqlClient}),
})});
`, { mode: 0o600, flag: "wx" });
    const checkpoint = (command, selected, destination, settings) => checkpointProcess(command, selected, destination, settings, {
      spawnClient(executable, args, parameters) { return spawn(executable, [driver, ...args.slice(1)], parameters); },
    });
    const requests = createManualBackupRequests({ operationsDirectory }), notices = [];
    supervisor = createRecurringSupervisor(options, { environment, manualBackups: true, manualRequests: requests,
      closureOperations: owner.operations, resumeClosures: resumeManagedLocalClosureRuntime, source: async () => {}, checkpoint,
      preflight: (selected, settings) => recurringPreflight(selected, { ...settings, source: async () => {}, checkpoint }),
      makeRuntime: () => synthetic.runtime, schedule: () => null, unschedule() {}, emit: value => notices.push(value) });
    await supervisor.start(); await supervisor.tick();
    assert.equal(synthetic.children.length, 1, "enabled historical configuration never triggers an automatic capture");
    assert.equal(await requests.status(), null);
    const token = "A".repeat(43), csrf = "B".repeat(43), adminId = "a".repeat(32), requestId = "b".repeat(32);
    handler = createManualBackupHandler(createManualBackupService(operationsDirectory), { origin: "https://jessiemessage.com",
      actor: async value => value === token ? { user: { id: adminId, role: "admin", pseudonym: "Synthetic operator" }, csrf, expiresAt: Date.now() + 3600000 } : null });
    server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`, headers = { Cookie: `__Host-jessie_session=${token}` };
    const post = await fetch(`${origin}/api/admin/backups/captures`, { method: "POST", headers: { ...headers, Origin: "https://jessiemessage.com",
      "X-CSRF-Token": csrf, "Content-Type": "application/json" }, body: JSON.stringify({ requestId }) });
    assert.equal(post.status, 202); assert.equal((await post.json()).request.status, "queued");
    assert.equal(JSON.parse(await readFile(path.join(operationsDirectory, "manual-backup-request.json"), "utf8")).current.requestId, requestId);
    const report = await supervisor.tick(); assert.equal(report?.status, "succeeded", JSON.stringify(notices)); assert.equal(report.runtimeResumed, true);
    const completed = await requests.status(); assert.equal(completed.status, "complete"); assert.ok(completed.captureId);
    assert.equal(synthetic.children.length, 2); assert.equal(synthetic.children[0].exitCode, 0); assert.equal(synthetic.children[0].signalCode, null);
    assert.equal(synthetic.runtime.state().status, "running");
    const capture = path.join(operationsDirectory, completed.captureId), receipt = JSON.parse(await readFile(path.join(capture, "receipt.json"), "utf8"));
    assert.deepEqual(receipt.schema, { tables: 33, migrations: 33 }); assert.equal(receipt.media.files.length, 4);
    assert.equal(receipt.operations.file, "operations.enc.json");
    const operational = await withPrivateDirectory(capture, scope => readOperationalCheckpoint(scope, receipt, f.keys.crmKey));
    assert.deepEqual(operational.files, [], "manual intents are excluded from the authenticated restoration capsule");
    const plaintext = await readFile(path.join(capture, "checkpoint.tar.gz"));
    const recovered = execFileSync("/usr/bin/gpg", [...gpgArgs, "--decrypt", path.join(capture, "checkpoint.tar.gz.gpg")],
      { env: gpgEnvironment, timeout: 10000, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
    assert.deepEqual(recovered, plaintext);
    const tar = gunzipSync(plaintext); assert.equal(tar.includes(Buffer.from("manual-backup-request.json")), false,
      "the operational capsule does not restore or replay manual demands");
    const summary = await (await fetch(`${origin}/api/admin/backups`, { headers })).json();
    assert.equal(summary.request.status, "complete"); assert.equal(summary.latestArchive.id, completed.captureId); assert.equal(summary.archiveCount, 1);
    const download = await fetch(`${origin}/api/admin/backups/archives/${completed.captureId}`, { headers });
    assert.equal(download.status, 200); assert.equal(download.headers.get("x-backup-sha256"), summary.latestArchive.sha256);
    const bytes = Buffer.from(await download.arrayBuffer());
    assert.deepEqual(bytes, await readFile(path.join(capture, "checkpoint.tar.gz.gpg")));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), summary.latestArchive.sha256);
    await requests.request({ requestId }); await supervisor.tick(); assert.equal(synthetic.children.length, 2, "a lost acknowledgement cannot repeat the native capture");
    const resumed = await (await fetch(`${synthetic.origin}/api/ready`)).json(); assert.deepEqual(resumed, { status: "ready" });
  } finally {
    handler?.close(); server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve));
    try { await supervisor?.close(); } finally { await owner.close(); }
    try { execFileSync("/usr/bin/gpgconf", ["--homedir", home, "--kill", "gpg-agent"], { env: gpgEnvironment, timeout: 3000, stdio: "ignore" }); } catch {}
  }
});

test("manual operator imports a real native archive, publishes the actual IPC application and verifies drain and ordinary restart on an isolated target", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with two explicit loopback disposable databases and native MariaDB clients.", timeout: 240000,
}, async t => {
  const f = await manualOperatorFixture(t), { input, runtime, makeOperations } = f;
  const marker = path.join(input.journalDirectory, "operational-restore.json");
  const reconciled = await reconcileManualRestore(input);
  assert.equal(reconciled.status, "manual_restore_reconciled_quarantined"); assert.equal(reconciled.started, false);
  assert.equal(f.children.length, 0, "the old archive is never started before reconciliation");
  await f.assertRestored(); await f.assertSourceUnchanged();
  const hold = await readFile(marker), journals = await fileHashes(input.journalDirectory);

  await t.test("an incorrect operator confirmation cannot open or release either quarantine", async () => {
    await assert.rejects(publishManualRestore(input, { expectedPlanSha256: "0".repeat(64), runtime, makeOperations }), { code: "MANUAL_RESTORE_PLAN_CHANGED" });
    assert.equal(f.children.length, 0); assert.deepEqual(await readFile(marker), hold);
    await f.assertSourceUnchanged();
  });

  await t.test("a lost ready acknowledgement stops the actual child and restores the exact new target hold", async () => {
    const uncertain = { state: runtime.state, stop: runtime.stop, async start() {
      await runtime.start(); assert.equal(runtime.state().status, "running"); throw new Error("Synthetic lost publication acknowledgement after real IPC/readiness");
    } };
    await assert.rejects(publishManualRestore(input, { expectedPlanSha256: reconciled.planSha256, runtime: uncertain, makeOperations }), { code: "MANUAL_RESTORE_UNAVAILABLE" });
    assert.equal(f.children.length, 1); assert.equal(f.children[0].exitCode, 0); assert.equal(f.children[0].signalCode, null);
    assert.equal(runtime.state().status, "stopped"); await assert.rejects(localRequest(f.port, "/api/ready"));
    assert.deepEqual(await readFile(marker), hold); assert.deepEqual(await fileHashes(input.journalDirectory), journals);
    await f.assertRestored(); await f.assertSourceUnchanged();
  });

  await t.test("a receipt disappearing after actual startup refuses publication and drains before restoring quarantine", async () => {
    const filename = Object.keys(journals).find(name => /^erasure-/.test(name)), fullPath = path.join(input.journalDirectory, filename), bytes = await readFile(fullPath);
    const uncertain = { state: runtime.state, stop: runtime.stop, async start() { await runtime.start(); await unlink(fullPath); } };
    try {
      await assert.rejects(publishManualRestore(input, { expectedPlanSha256: reconciled.planSha256, runtime: uncertain, makeOperations }), { code: "MANUAL_RESTORE_PROGRESS" });
      assert.equal(runtime.state().status, "stopped"); assert.equal(f.children.at(-1).exitCode, 0);
      assert.deepEqual(await readFile(marker), hold); await assert.rejects(localRequest(f.port, "/api/ready"));
    } finally { await writeFile(fullPath, bytes, { mode: 0o600, flag: "wx" }); }
    await f.assertRestored(); await f.assertSourceUnchanged();
  });

  await t.test("explicit publication requires real IPC and HTTP ready, then removes only the newly created target hold", async () => {
    const published = await publishManualRestore(input, { expectedPlanSha256: reconciled.planSha256, runtime, makeOperations });
    assert.equal(published.status, "manual_restore_published"); assert.equal(published.started, true); assert.equal(published.ready, true);
    assert.equal(published.quarantineRetained, true); assert.equal(published.targetJournalQuarantined, false);
    assert.equal(published.externalRegistryContinuityVerified, false); assert.equal(published.completeDatabase, false);
    assert.equal(runtime.state().status, "running"); assert.equal(f.children.length, 3);
    assert.deepEqual(await localRequest(f.port, "/api/ready"), { status: 200, body: '{"status":"ready"}' });
    assert.equal((await localRequest(f.port, "/api/entry")).status, 200);
    assert.equal((await localRequest(f.port, "/api/admin/closures")).status, 401);
    await withPrivateDirectory(input.journalDirectory, assertNoOperationalRestore);
    await assert.rejects(withPrivateDirectory(input.quarantineDirectory, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
    const { "operational-restore.json": _hold, ...receipts } = journals;
    assert.deepEqual(await fileHashes(input.journalDirectory), receipts);
    await f.assertRestored(); await f.assertSourceUnchanged();
  });

  await t.test("SIGTERM drains the actual child and a normal local owner rechecks receipts before restarting it", async () => {
    assert.deepEqual(await runtime.stop(), { exitCode: 0, signal: null });
    assert.equal(f.children[2].exitCode, 0); assert.equal(f.children[2].signalCode, null);
    assert.equal(runtime.state().status, "stopped"); await assert.rejects(localRequest(f.port, "/api/ready"));
    const observed = (await readFile(f.events, "utf8")).trim().split("\n");
    assert.equal(observed.filter(line => line === "started").length, 3);
    assert.equal(observed.filter(line => line === "draining").length, 3);
    for (const line of observed.filter(line => line.startsWith("{"))) assert.deepEqual(JSON.parse(line), { timedOut: false, forced: false, failed: false });
    const owner = await makeOperations();
    try {
      assert.equal(await owner.operations.hasPending(), false);
      await acquireRecurringLock(input.journalDirectory, async lease => {
        await resumeManagedLocalClosureRuntime({ runtime, operations: owner.operations, assertReady: lease.assertReady });
      });
    } finally { await owner.close(); }
    assert.equal(f.children.length, 4); assert.equal(runtime.state().status, "running");
    assert.deepEqual(await localRequest(f.port, "/api/ready"), { status: 200, body: '{"status":"ready"}' });
    await f.assertRestored(); await f.assertSourceUnchanged();
    assert.deepEqual(await runtime.stop(), { exitCode: 0, signal: null });
  });
});

test("the operator CLI resumes interrupted media using native SQL once, then copies only missing files and opens the owned IPC service", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with explicit loopback disposable databases and native MariaDB clients.", timeout: 240000,
}, async t => {
  const f = await manualOperatorFixture(t), operator = await f.resetTargetForOperator(), reports = [];
  let finish, published, manualRequestsAllowed = false, resumes = 0, imports = 0, service, retained, mediaVerified = false;
  const finished = new Promise(done => { finish = done; }), publication = new Promise(done => { published = done; });
  const outputStream = { write(line) { const value = JSON.parse(line); reports.push(value); if (value.status === "manual_restore_published") published(value); } };
  const signal = new AbortController().signal;
  const dependencies = { environment: f.environment, signal, outputStream };
  const mediaNames = (await readdir(path.join(f.dirs.checkpoint, "media"))).sort(), first = mediaNames[0], created = [];
  const fileState = stats => Object.fromEntries(["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"].map(key => [key, stats[key]]));
  const internal = { loadContext: async () => operator.context, connect: operator.connect, inspect: operator.inspect, readSecret: operator.readSecret,
    async resumeCheckpoint(selection, options) { resumes++; const result = await operator.nativeResume(selection, options); if (result.imported) imports++; return result; },
    async makeStorage(options) {
      if (!mediaVerified) { assert.deepEqual(fileState(await lstat(path.join(f.dirs["target-media"], first), { bigint: true })), retained); mediaVerified = true; }
      return createMediaStorage(options);
    },
    createPool: createRuntimePool, createInspectionPool: createApplicationInspectionPool,
    makeService() {
      assert.equal(service, undefined);
      service = { state: f.runtime.state, async start() { return f.runtime.start(); },
        async stop() { const result = await f.runtime.stop(); finish({ failed: false }); return result; },
        allowManualBackups() { manualRequestsAllowed = true; }, async finished() { return finished; }, async close() { await f.runtime.stop(); } };
      return service;
    } };
  const selected = { operatorDirectory: operator.operatorDirectory };
  const readState = async () => JSON.parse(await readFile(path.join(operator.operatorDirectory, "manual-restore-state.json"), "utf8"));
  const originalOpen = fs.promises.open, cancellation = new AbortController(); let interrupted = false;
  fs.promises.open = async (...args) => {
    const handle = await originalOpen(...args), name = path.basename(String(args[0]));
    if ((args[1] & fs.constants.O_CREAT) && mediaNames.includes(name)) {
      created.push(name);
      if (!interrupted) {
        assert.equal(name, first); interrupted = true;
        const sync = handle.sync.bind(handle);
        handle.sync = async () => { await sync(); cancellation.abort(); };
      }
    }
    return handle;
  };
  syncBuiltinESMExports();
  let restored;
  try {
    await assert.rejects(runOperator({ ...selected, command: "restore" }, { ...dependencies, signal: cancellation.signal }, internal), { code: "MANUAL_OPERATOR_UNAVAILABLE" });
    assert.equal(interrupted, true); assert.equal((await readState()).phase, "allocated"); assert.equal(imports, 1); assert.equal(resumes, 1);
    assert.equal(f.children.length, 0); assert.deepEqual(await readdir(f.dirs.quarantine), []);
    assert.deepEqual(await readdir(f.dirs["target-media"]), [first]);
    assert.deepEqual(await readFile(path.join(f.dirs["target-media"], first)), await readFile(path.join(f.dirs.checkpoint, "media", first)));
    retained = fileState(await lstat(path.join(f.dirs["target-media"], first), { bigint: true }));
    await f.assertSourceUnchanged();
    restored = await runOperator({ ...selected, command: "restore" }, dependencies, internal);
  } finally { fs.promises.open = originalOpen; syncBuiltinESMExports(); }
  assert.deepEqual(created, mediaNames, "the complete first file is retained, and only absent names are created on resume");
  assert.equal(resumes, 2); assert.equal(imports, 1, "the second CLI pass verifies the actual SQL snapshot instead of importing again");
  assert.equal(restored.status, "manual_restore_reconciled_quarantined"); assert.equal(restored.started, false);
  assert.equal(f.children.length, 0); await f.assertRestored(); await f.assertSourceUnchanged();
  const reconciledState = await readState(); assert.equal(reconciledState.phase, "reconciled"); assert.equal(reconciledState.planSha256, restored.planSha256);
  for (const name of ["recurring-backup.json", "backup-copy-state.json"]) assert.deepEqual(
    JSON.parse(await readFile(path.join(f.dirs["target-journal"], name), "utf8")), JSON.parse(await readFile(path.join(f.dirs["source-journal"], name), "utf8")));
  assert.deepEqual(await readFile(path.join(f.dirs["target-journal"], "recipient-public.asc")), await readFile(path.join(f.dirs["source-journal"], "recipient-public.asc")));
  const quarantine = await fileHashes(f.dirs.quarantine);
  const opening = runOperator({ ...selected, command: "open", expectedPlanSha256: restored.planSha256 }, dependencies, internal);
  try {
    const report = await Promise.race([publication, opening.then(() => assert.fail("The service ended before publication"))]);
    assert.equal(report.ready, true); assert.equal(manualRequestsAllowed, true); assert.equal((await readState()).phase, "opened");
    assert.equal(resumes, 2, "opening never imports a reconciled database again"); assert.equal(imports, 1); assert.equal(f.children.length, 1);
    assert.deepEqual(await localRequest(f.port, "/api/ready"), { status: 200, body: '{"status":"ready"}' });
    await f.assertRestored(); await f.assertSourceUnchanged(); assert.deepEqual(await fileHashes(f.dirs.quarantine), quarantine);
    assert.deepEqual(await service.stop(), { exitCode: 0, signal: null });
    assert.equal((await opening).status, "manual_restore_published");
    assert.equal(f.children[0].exitCode, 0); assert.equal(f.children[0].signalCode, null);
    assert.equal((await readState()).phase, "opened");
    await assert.rejects(runOperator({ ...selected, command: "open", expectedPlanSha256: restored.planSha256 }, dependencies, internal), { code: "MANUAL_OPERATOR_ALREADY_OPENED_OR_UNCERTAIN" });
    assert.equal(f.children.length, 1); assert.equal(reports.filter(value => value.status === "manual_restore_published").length, 1);
  } finally { await service?.stop(); await opening.catch(() => {}); }
});
