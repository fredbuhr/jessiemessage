import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createErasureJournal } from "../server/data/erasure-journal.mjs";
import { captureOperationalState, writeOperationalCheckpoint, OPERATIONAL_RESTORE_MARKER } from "../server/backup/operational-checkpoint.mjs";
import { parseArguments, run, main } from "../scripts/restore-private-operations.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const key = Buffer.alloc(32, 7), binding = { database: "synthetic_source", rootFingerprint: "b".repeat(64) };
const inheritedEnv = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" }, now = 1792350000000;
async function fixture(t) {
  const root = await erasureDirectory(t), config = path.join(root, "config"), current = path.join(root, "operations"), sourceMedia = path.join(root, "source-media"), media = path.join(root, "copy-media"), destination = path.join(root, "quarantine");
  const checkpoint = path.join(current, "capture-1234567890000-abcdef0123456789");
  for (const directory of [config, current, checkpoint, sourceMedia, media]) await mkdir(directory, { mode: 0o700 });
  const clientId = "a".repeat(32), journal = createErasureJournal({ directory: current, key, binding, clientId }, { withDirectory: withErasureDirectory });
  try { await journal.save({ version: 1, clientId, binding, phase: "requested", cursor: null, startedAt: now, updatedAt: now }, 0, async () => {}); }
  finally { journal.close(); }
  const state = await withErasureDirectory(current, scope => captureOperationalState(scope, { key, binding }));
  const receipt = { version: 10, profile: "messaging-photos-notify-recovery-crm-broadcast-application", createdAt: now,
    manifest: { sha256: "d".repeat(64) }, sql: { sha256: "e".repeat(64) }, media: { files: [], bytes: 0 } };
  receipt.operations = await withErasureDirectory(checkpoint, scope => writeOperationalCheckpoint(scope, state, receipt, key));
  const loaded = [];
  const dependencies = { inheritedEnv, execArgv: [], scopeOperation: withErasureDirectory,
    loadEnvironment: async () => { const env = { JESSIEMESSAGE_DB_NAME: binding.database, JESSIEMESSAGE_MEDIA_ROOT: sourceMedia,
      JESSIEMESSAGE_CRM_KEY: key.toString("base64url"), JESSIEMESSAGE_MEDIA_KEY: Buffer.alloc(32, 6).toString("base64url") }; loaded.push(env); return env; },
    makeStorage: async ({ root }) => ({ root }), readReceipt: async () => structuredClone(receipt),
    identity: async ({ databaseName, rootPath }) => ({ database: databaseName, path: rootPath, rootFingerprint: databaseName === binding.database ? binding.rootFingerprint : "c".repeat(64) }),
    assertIdentity: (source, target) => { assert.notEqual(source.database, target.database); assert.notEqual(source.path, target.path); },
  };
  const args = command => [command, "--private-directory", config, "--operations-directory", current, "--checkpoint-directory", checkpoint,
    "--destination-private-directory", destination, "--database", "synthetic_clone", "--media-root", media];
  return { root, config, current, checkpoint, destination, media, args, dependencies, receipt, loaded };
}
test("operational restore checks read-only, confirms a current hash, and publishes an isolated blocked quarantine", async t => {
  const f = await fixture(t), before = await readdir(f.current);
  const check = await run(parseArguments(f.args("check")), f.dependencies);
  assert.equal(check.sqlRestored, false); assert.equal(check.externalRegistryContinuityVerified, false);
  assert.equal(check.reconciliationRequired, true); assert.equal(check.pendingReceipts, 1);
  await assert.rejects(lstat(f.destination), { code: "ENOENT" }); assert.deepEqual(await readdir(f.current), before);
  let output = "";
  const report = await main([...f.args("restore"), "--confirm-current-sha256", check.currentSha256], { ...f.dependencies, outputStream: { write(value) { output += value; } } });
  assert.equal(report.status, "operational_quarantine_restored"); assert.equal(report.restored, true); assert.equal(report.started, false);
  const marker = JSON.parse(await readFile(path.join(f.destination, OPERATIONAL_RESTORE_MARKER))); assert.deepEqual(marker.sourceBinding, binding);
  assert.deepEqual(await readdir(f.current), before); assert.doesNotMatch(output, /synthetic_source|config|[a]{32}|base64|KEY/);
  for (const env of f.loaded) assert.equal(env.JESSIEMESSAGE_CRM_KEY, "");
});
test("a changed current registry invalidates the check hash before any recovery files are created", async t => {
  const f = await fixture(t), check = await run(parseArguments(f.args("check")), f.dependencies);
  const clientId = "f".repeat(32), journal = createErasureJournal({ directory: f.current, key, binding, clientId }, { withDirectory: withErasureDirectory });
  try { await journal.save({ version: 1, clientId, binding, phase: "requested", cursor: null, startedAt: now, updatedAt: now }, 0, async () => {}); }
  finally { journal.close(); }
  await assert.rejects(run(parseArguments([...f.args("restore"), "--confirm-current-sha256", check.currentSha256]), f.dependencies), { code: "OPERATIONS_CHANGED" });
  await assert.rejects(lstat(f.destination), { code: "ENOENT" });
});
test("source aliases, legacy receipts, an existing destination and a replaced target root refuse quarantine publication", async t => {
  for (const mode of ["source", "legacy", "existing", "identity"]) {
    const f = await fixture(t), selected = parseArguments(f.args("check"));
    if (mode === "source") selected.database = binding.database;
    if (mode === "legacy") delete f.receipt.operations;
    if (mode === "existing") { await mkdir(f.destination, { mode: 0o700 }); await writeFile(path.join(f.destination, "preserve"), "synthetic", { mode: 0o600 }); }
    if (mode === "identity") f.dependencies.assertIdentity = () => { throw new Error("Synthetic target alias"); };
    await assert.rejects(run(selected, f.dependencies));
    if (mode === "existing") assert.equal(await readFile(path.join(f.destination, "preserve"), "utf8"), "synthetic");
    else await assert.rejects(lstat(f.destination), { code: "ENOENT" });
  }
});
test("the recovery interface rejects missing confirmation, ambiguous directories, unknown flags, ambient overrides and getters", async t => {
  const f = await fixture(t);
  for (const args of [f.args("restore"), [...f.args("check"), "--offline"], [...f.args("check"), "--confirm-current-sha256", "a".repeat(64)],
    f.args("check").map(value => value === f.destination ? f.current : value), f.args("check").map(value => value === f.config ? "/" : value)])
    assert.throws(() => parseArguments(args), { code: "OPERATIONS_USAGE" });
  let invoked = false; const selected = parseArguments(f.args("check"));
  Object.defineProperty(selected, "database", { get() { invoked = true; return binding.database; } });
  await assert.rejects(run(selected, f.dependencies), { code: "OPERATIONS_USAGE" }); assert.equal(invoked, false);
  await assert.rejects(run(parseArguments(f.args("check")), { ...f.dependencies, inheritedEnv: { ...inheritedEnv, NODE_OPTIONS: "--inspect" } }));
});
