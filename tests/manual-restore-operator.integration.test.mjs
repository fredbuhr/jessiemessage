import test from "node:test";
import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { reconcileManualRestore, publishManualRestore } from "../server/backup/manual-restore.mjs";
import { assertNoOperationalRestore } from "../server/backup/operational-checkpoint.mjs";
import { acquireRecurringLock } from "../server/backup/recurring-checkpoint-files.mjs";
import { resumeManagedLocalClosureRuntime } from "../server/backup/managed-closures.mjs";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createApplicationInspectionPool } from "../server/backup/application-scope.mjs";
import { run as runOperator } from "../scripts/manual-restore.mjs";
import { manualOperatorFixture, localRequest, fileHashes } from "./fixtures/manual-operator.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";

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

test("the real operator CLI allocates an empty target, imports, copies media and settings, persists phases and opens the owned IPC service", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with explicit loopback disposable databases and native MariaDB clients.", timeout: 240000,
}, async t => {
  const f = await manualOperatorFixture(t), operator = await f.resetTargetForOperator(), reports = [];
  let finish, published, capturesAllowed = false, resumes = 0, service;
  const finished = new Promise(done => { finish = done; }), publication = new Promise(done => { published = done; });
  const outputStream = { write(line) { const value = JSON.parse(line); reports.push(value); if (value.status === "manual_restore_published") published(value); } };
  const signal = new AbortController().signal;
  const dependencies = { environment: f.environment, signal, outputStream };
  const internal = { loadContext: async () => operator.context, connect: operator.connect, inspect: operator.inspect, readSecret: operator.readSecret,
    async resumeCheckpoint(selection, options) { resumes++; return operator.nativeResume(selection, options); },
    createPool: createRuntimePool, createInspectionPool: createApplicationInspectionPool,
    makeService() {
      assert.equal(service, undefined);
      service = { state: f.runtime.state, async start() { return f.runtime.start(); },
        async stop() { const result = await f.runtime.stop(); finish({ failed: false }); return result; },
        allowCaptures() { capturesAllowed = true; }, async finished() { return finished; }, async close() { await f.runtime.stop(); } };
      return service;
    } };
  const selected = { operatorDirectory: operator.operatorDirectory };
  const restored = await runOperator({ ...selected, command: "restore" }, dependencies, internal);
  assert.equal(resumes, 1); assert.equal(restored.status, "manual_restore_reconciled_quarantined"); assert.equal(restored.started, false);
  assert.equal(f.children.length, 0); await f.assertRestored(); await f.assertSourceUnchanged();
  const readState = async () => JSON.parse(await readFile(path.join(operator.operatorDirectory, "manual-restore-state.json"), "utf8"));
  const reconciledState = await readState(); assert.equal(reconciledState.phase, "reconciled"); assert.equal(reconciledState.planSha256, restored.planSha256);
  for (const name of ["recurring-backup.json", "backup-copy-state.json"]) assert.deepEqual(
    JSON.parse(await readFile(path.join(f.dirs["target-journal"], name), "utf8")), JSON.parse(await readFile(path.join(f.dirs["source-journal"], name), "utf8")));
  assert.deepEqual(await readFile(path.join(f.dirs["target-journal"], "recipient-public.asc")), await readFile(path.join(f.dirs["source-journal"], "recipient-public.asc")));
  const quarantine = await fileHashes(f.dirs.quarantine);
  const opening = runOperator({ ...selected, command: "open", expectedPlanSha256: restored.planSha256 }, dependencies, internal);
  try {
    const report = await Promise.race([publication, opening.then(() => assert.fail("The service ended before publication"))]);
    assert.equal(report.ready, true); assert.equal(capturesAllowed, true); assert.equal((await readState()).phase, "opened");
    assert.equal(resumes, 1, "opening never imports a reconciled database again"); assert.equal(f.children.length, 1);
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
