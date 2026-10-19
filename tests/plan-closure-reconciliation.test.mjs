import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createMediaStorage } from "../server/media/storage.mjs";
import { backupIdentity } from "../server/backup/manifest.mjs";
import { createErasureJournal } from "../server/data/erasure-journal.mjs";
import { captureOperationalState, writeOperationalCheckpoint, restoreOperationalQuarantine, operationalStateHash,
  assertNoOperationalRestore } from "../server/backup/operational-checkpoint.mjs";
import { parseArguments, run, main } from "../scripts/plan-closure-reconciliation.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";
import { registryWitnessFixture } from "./fixtures/registry-witness.mjs";

const key = Buffer.alloc(32, 7), mediaKey = Buffer.alloc(32, 6), allow = async () => {};
const inheritedEnv = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" }, contractSha256 = "f".repeat(64);
async function fixture(t) {
  const root = await erasureDirectory(t), dirs = Object.fromEntries(["config", "operations", "checkpoint", "sourceMedia", "media", "quarantine", "operator"]
    .map(name => [name, path.join(root, name)]));
  for (const directory of Object.values(dirs)) await mkdir(directory, { mode: 0o700 });
  const source = await createMediaStorage({ root: dirs.sourceMedia, key: mediaKey, pathMode: "strict" });
  const target = await createMediaStorage({ root: dirs.media, key: mediaKey, pathMode: "strict" });
  const sourceIdentity = await backupIdentity({ databaseName: "synthetic_source", rootPath: dirs.sourceMedia, storage: source, mediaKey });
  const targetIdentity = await backupIdentity({ databaseName: "synthetic_clone", rootPath: dirs.media, storage: target, mediaKey });
  const binding = { database: "synthetic_source", rootFingerprint: sourceIdentity.rootFingerprint };
  const targetBinding = { database: "synthetic_clone", rootFingerprint: targetIdentity.rootFingerprint };
  const clientId = "a".repeat(32), writer = createErasureJournal({ directory: dirs.operations, key, binding, clientId }, { withDirectory: withErasureDirectory });
  let revision = 0, record = { version: 1, clientId, binding, phase: "requested", cursor: null, startedAt: 1792350000000, updatedAt: 1792350000000 };
  const remote = await registryWitnessFixture(t, { key, binding, sourceDirectory: dirs.operations });
  t.after(() => writer.close());
  const advance = async phase => {
    record = { ...record, phase, updatedAt: record.updatedAt + (revision ? 1 : 0) };
    revision = (await writer.save(record, revision, allow)).revision; await remote.gate.verify(allow);
  };
  await advance("requested");
  const backup = await withErasureDirectory(dirs.operations, scope => captureOperationalState(scope, { key, binding }));
  const receipt = { version: 10, profile: "messaging-photos-notify-recovery-crm-broadcast-application", createdAt: record.startedAt,
    manifest: { sha256: "d".repeat(64) }, sql: { sha256: "e".repeat(64) }, media: { files: [], bytes: 0 } };
  receipt.operations = await withErasureDirectory(dirs.checkpoint, scope => writeOperationalCheckpoint(scope, backup, receipt, key));
  await withErasureDirectory(dirs.quarantine, scope => restoreOperationalQuarantine(scope, { backup, current: backup, targetBinding, key,
    expectedCurrentSha256: operationalStateHash(backup), assertCurrent: allow }));
  const requests = [], loaded = [];
  const dependencies = { inheritedEnv, execArgv: [], scopeOperation: withErasureDirectory,
    // Native procfs anchors are mandatory in the separate real-CLI CI test.
    makeStorage: options => createMediaStorage({ ...options, pathMode: "strict" }),
    loadEnvironment: async () => {
      const env = { JESSIEMESSAGE_DB_NAME: binding.database, JESSIEMESSAGE_MEDIA_ROOT: dirs.sourceMedia,
        JESSIEMESSAGE_CRM_KEY: key.toString("base64url"), JESSIEMESSAGE_MEDIA_KEY: mediaKey.toString("base64url") };
      loaded.push(env); return env;
    }, readReceipt: async () => structuredClone(receipt), exchangeRecovery: async value => {
      assert.equal(value.directory, path.join(dirs.operator, "control")); assert.equal(value.contractSha256, contractSha256);
      assert.deepEqual(value.binding, binding); assert.equal(value.request.snapshot, null);
      requests.push(value.request); return remote.witness.exchange(value.request);
    } };
  const args = ["check", "--private-directory", dirs.config, "--operations-directory", dirs.operations, "--checkpoint-directory", dirs.checkpoint,
    "--quarantine-private-directory", dirs.quarantine, "--database", targetBinding.database, "--media-root", dirs.media,
    "--witness-operator-directory", dirs.operator, "--witness-contract-sha256", contractSha256];
  const bytes = async directory => Object.fromEntries(await Promise.all((await readdir(directory)).sort().map(async name => [name, (await readFile(path.join(directory, name))).toString("base64url")])));
  return { dirs, binding, args, dependencies, remote, requests, loaded, advance, receipt, bytes };
}

test("the read-only CLI plans original newer receipts with fresh challenges and retains every file and startup refusal", async t => {
  const f = await fixture(t);
  for (const phase of ["prepared", "files_erased", "completed"]) await f.advance(phase);
  const sourceBefore = await f.bytes(f.dirs.operations), targetBefore = await f.bytes(f.dirs.quarantine), checkpointBefore = await f.bytes(f.dirs.checkpoint);
  let output = "";
  const report = await main(f.args, { ...f.dependencies, outputStream: { write(value) { output += value; } } });
  assert.equal(report.status, "closure_reconciliation_planned"); assert.equal(report.completedReceipts, 1);
  assert.equal(report.replayFromStartReceipts, 1); assert.equal(report.reconciliationRequired, true);
  for (const flag of ["sqlMutationAuthorized", "targetAbsenceVerified", "targetSqlInspected", "targetMutated", "started"]) assert.equal(report[flag], false);
  assert.equal(report.quarantineRetained, true); assert.equal(f.requests.length, 2);
  assert.equal(new Set(f.requests.map(value => value.challenge)).size, 2);
  assert.deepEqual(await f.bytes(f.dirs.operations), sourceBefore); assert.deepEqual(await f.bytes(f.dirs.quarantine), targetBefore);
  assert.deepEqual(await f.bytes(f.dirs.checkpoint), checkpointBefore);
  await assert.rejects(withErasureDirectory(f.dirs.quarantine, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
  assert.doesNotMatch(output, /synthetic_source|synthetic_clone|[a]{32}|envelope|ciphertext|rootFingerprint/);
  assert.deepEqual(JSON.parse(output), report);
  for (const env of f.loaded) assert.equal(env.JESSIEMESSAGE_CRM_KEY, "");
});

test("a new process-level check acquires new challenges and a changed source phase changes its plan", async t => {
  const f = await fixture(t), initial = await run(parseArguments(f.args), f.dependencies);
  const same = await run(parseArguments(f.args), f.dependencies); assert.equal(initial.planSha256, same.planSha256);
  await f.advance("prepared");
  const advanced = await run(parseArguments(f.args), f.dependencies); assert.notEqual(initial.planSha256, advanced.planSha256);
  assert.equal(f.requests.length, 6); assert.equal(new Set(f.requests.map(value => value.challenge)).size, 6);
});

test("missing, replayed and flag-only PC replies emit no success and never change the quarantine", async t => {
  for (const mode of ["missing", "replay", "boolean"]) {
    const f = await fixture(t), before = await f.bytes(f.dirs.quarantine), exchange = f.dependencies.exchangeRecovery;
    let old;
    if (mode === "replay") { await run(parseArguments(f.args), { ...f.dependencies, exchangeRecovery: async value => { const reply = await exchange(value); old ??= reply; return reply; } }); }
    const failure = async () => { if (mode === "missing") throw new Error("Synthetic private transport details"); return mode === "boolean" ? { verified: true } : old; };
    await assert.rejects(main(f.args, { ...f.dependencies, exchangeRecovery: failure, outputStream: { write() { assert.fail("No success output"); } } }));
    assert.deepEqual(await f.bytes(f.dirs.quarantine), before);
  }
});

test("a replaced media root, changed capsule or marker during the fresh proof invalidates planning", async t => {
  for (const mode of ["root", "capsule", "marker"]) {
    const f = await fixture(t), exchange = f.dependencies.exchangeRecovery; let changed = false;
    f.dependencies.exchangeRecovery = async value => {
      const result = await exchange(value);
      if (!changed) {
        changed = true;
        if (mode === "root") { await rename(f.dirs.media, f.dirs.media + "-old"); await mkdir(f.dirs.media, { mode: 0o700 }); }
        else await writeFile(path.join(mode === "capsule" ? f.dirs.checkpoint : f.dirs.quarantine,
          mode === "capsule" ? "operations.enc.json" : "operational-restore.json"), "{}\n", { mode: 0o600 });
      }
      return result;
    };
    await assert.rejects(run(parseArguments(f.args), f.dependencies));
  }
});

test("planning rejects writes, confirmations, ambiguous paths, ambient overrides, aliases and getters", async t => {
  const f = await fixture(t);
  for (const args of [["apply", ...f.args.slice(1)], [...f.args, "--confirm-plan-sha256", "a".repeat(64)],
    f.args.map(value => value === "--quarantine-private-directory" ? "--destination-private-directory" : value),
    f.args.map(value => value === f.dirs.quarantine ? f.dirs.operations : value)]) assert.throws(() => parseArguments(args));
  const selected = parseArguments(f.args); let getter = false;
  Object.defineProperty(selected, "database", { get() { getter = true; return "synthetic_source"; } });
  await assert.rejects(run(selected, f.dependencies)); assert.equal(getter, false);
  await assert.rejects(run({ ...parseArguments(f.args), database: "SYNTHETIC_SOURCE" }, f.dependencies), { code: "OPERATIONS_SOURCE_TARGET" });
  await assert.rejects(run(parseArguments(f.args), { ...f.dependencies, inheritedEnv: { ...inheritedEnv, NODE_OPTIONS: "--inspect" } }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(run(parseArguments(f.args), { ...f.dependencies, signal: controller.signal }), { code: "OPERATIONS_ABORTED" });
  assert.equal(f.requests.length, 0);
});
