import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, lstat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createErasureJournal, verifyErasureJournalEnvelope } from "../server/data/erasure-journal.mjs";
import { captureOperationalState, writeOperationalCheckpoint, assertNoOperationalRestore, OPERATIONAL_RESTORE_MARKER } from "../server/backup/operational-checkpoint.mjs";
import { parseArguments, run, main } from "../scripts/restore-private-operations.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";
import { registryWitnessFixture } from "./fixtures/registry-witness.mjs";
import { createPrivacyFiles } from "../server/privacy/files.mjs";
import { DECISIONS } from "../server/privacy/draft.mjs";

const key = Buffer.alloc(32, 7), binding = { database: "synthetic_source", rootFingerprint: "b".repeat(64) };
const inheritedEnv = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" }, now = 1792350000000;
const contractSha256 = "f".repeat(64), allow = async () => {};
async function fixture(t, { privacy = false } = {}) {
  const root = await erasureDirectory(t), config = path.join(root, "config"), current = path.join(root, "operations"), sourceMedia = path.join(root, "source-media"), media = path.join(root, "copy-media"), destination = path.join(root, "quarantine"), operator = path.join(root, "operator");
  const checkpoint = path.join(current, "capture-1234567890000-abcdef0123456789");
  for (const directory of [config, current, checkpoint, sourceMedia, media, operator]) await mkdir(directory, { mode: 0o700 });
  const clientId = "a".repeat(32), journal = createErasureJournal({ directory: current, key, binding, clientId }, { withDirectory: withErasureDirectory });
  try { await journal.save({ version: 1, clientId, binding, phase: "requested", cursor: null, startedAt: now, updatedAt: now }, 0, async () => {}); }
  finally { journal.close(); }
  if (privacy) {
    const files = createPrivacyFiles(current, key, { withDirectory: withErasureDirectory });
    try { await files.save({ updatedAt: now, draft: { answers: Object.fromEntries(DECISIONS.map(id => [id, ""])),
      notice: { fr: "Préparation synthétique", en: "Synthetic preparation" } } }, 0, allow); }
    finally { files.close(); }
  }
  const state = await withErasureDirectory(current, scope => captureOperationalState(scope, { key, binding }));
  const receipt = { version: 10, profile: "messaging-photos-notify-recovery-crm-broadcast-application", createdAt: now,
    manifest: { sha256: "d".repeat(64) }, sql: { sha256: "e".repeat(64) }, media: { files: [], bytes: 0 } };
  receipt.operations = await withErasureDirectory(checkpoint, scope => writeOperationalCheckpoint(scope, state, receipt, key));
  const loaded = [], requests = [], identityState = { targetFingerprint: "c".repeat(64) }, remote = await registryWitnessFixture(t, { key, binding, sourceDirectory: current });
  await remote.gate.verify(allow);
  const dependencies = { inheritedEnv, execArgv: [], scopeOperation: withErasureDirectory,
    loadEnvironment: async () => { const env = { JESSIEMESSAGE_DB_NAME: binding.database, JESSIEMESSAGE_MEDIA_ROOT: sourceMedia,
      JESSIEMESSAGE_CRM_KEY: key.toString("base64url"), JESSIEMESSAGE_MEDIA_KEY: Buffer.alloc(32, 6).toString("base64url") }; loaded.push(env); return env; },
    makeStorage: async ({ root }) => ({ root }), readReceipt: async () => structuredClone(receipt),
    identity: async ({ databaseName, rootPath }) => ({ database: databaseName, path: rootPath, rootFingerprint: databaseName === binding.database ? binding.rootFingerprint : identityState.targetFingerprint }),
    assertIdentity: (source, target) => { assert.notEqual(source.database, target.database); assert.notEqual(source.path, target.path); },
    exchangeRecovery: async value => {
      assert.equal(value.directory, path.join(operator, "control")); assert.equal(value.contractSha256, contractSha256);
      assert.deepEqual(value.binding, binding); assert.equal(value.request.snapshot, null);
      requests.push(value.request); return remote.witness.exchange(value.request);
    },
  };
  const args = command => [command, "--private-directory", config, "--operations-directory", current, "--checkpoint-directory", checkpoint,
    "--destination-private-directory", destination, "--database", "synthetic_clone", "--media-root", media,
    "--witness-operator-directory", operator, "--witness-contract-sha256", contractSha256];
  const advance = async (phase, { publish = true, preserveLocal = false } = {}) => {
    const name = state.files.find(file => file.name.startsWith("erasure-")).name;
    const original = preserveLocal ? await readFile(path.join(current, name)) : null;
    const writer = createErasureJournal({ directory: current, key, binding, clientId }, { withDirectory: withErasureDirectory });
    try { const previous = await writer.read(); await writer.save({ ...previous.record, phase, updatedAt: previous.record.updatedAt + 1 }, previous.revision, allow); }
    finally { writer.close(); }
    if (publish) await remote.gate.verify(allow);
    if (original) await writeFile(path.join(current, name), original, { mode: 0o600 });
  };
  return { root, config, current, checkpoint, destination, media, operator, args, dependencies, receipt, loaded, remote, requests, state, advance, identityState };
}
test("operational restore checks read-only, confirms a current hash, and publishes an isolated blocked quarantine", async t => {
  const f = await fixture(t), before = await readdir(f.current);
  const check = await run(parseArguments(f.args("check")), f.dependencies);
  assert.equal(check.sqlRestored, false); assert.equal(check.externalRegistryContinuityVerified, true);
  assert.equal(check.reconciliationRequired, true); assert.equal(check.pendingReceipts, 1);
  await assert.rejects(lstat(f.destination), { code: "ENOENT" }); assert.deepEqual(await readdir(f.current), before);
  let output = "";
  const report = await main([...f.args("restore"), "--confirm-plan-sha256", check.planSha256], { ...f.dependencies, outputStream: { write(value) { output += value; } } });
  assert.equal(report.status, "operational_quarantine_restored"); assert.equal(report.restored, true); assert.equal(report.started, false);
  const marker = JSON.parse(await readFile(path.join(f.destination, OPERATIONAL_RESTORE_MARKER))); assert.deepEqual(marker.sourceBinding, binding);
  assert.deepEqual(marker.targetBinding, { database: "synthetic_clone", rootFingerprint: "c".repeat(64) });
  assert.deepEqual(await readdir(f.current), before); assert.doesNotMatch(output, /synthetic_source|config|[a]{32}|base64|KEY/);
  assert.ok(f.requests.length >= 5); assert.equal(new Set(f.requests.map(request => request.challenge)).size, f.requests.length);
  for (const env of f.loaded) assert.equal(env.JESSIEMESSAGE_CRM_KEY, "");
});
test("a changed current registry invalidates the check hash before any recovery files are created", async t => {
  const f = await fixture(t), check = await run(parseArguments(f.args("check")), f.dependencies);
  const clientId = "f".repeat(32), journal = createErasureJournal({ directory: f.current, key, binding, clientId }, { withDirectory: withErasureDirectory });
  try { await journal.save({ version: 1, clientId, binding, phase: "requested", cursor: null, startedAt: now, updatedAt: now }, 0, async () => {}); }
  finally { journal.close(); }
  await f.remote.gate.verify(allow);
  await assert.rejects(run(parseArguments([...f.args("restore"), "--confirm-plan-sha256", check.planSha256]), f.dependencies), { code: "OPERATIONS_CHANGED" });
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
  for (const args of [f.args("restore"), [...f.args("check"), "--offline"], [...f.args("check"), "--confirm-plan-sha256", "a".repeat(64)],
    [...f.args("restore"), "--confirm-current-sha256", "a".repeat(64)], f.args("check").slice(0, -4),
    f.args("check").map(value => value === f.operator ? f.current : value),
    f.args("check").map(value => value === f.destination ? f.current : value), f.args("check").map(value => value === f.config ? "/" : value)])
    assert.throws(() => parseArguments(args), { code: "OPERATIONS_USAGE" });
  let invoked = false; const selected = parseArguments(f.args("check"));
  Object.defineProperty(selected, "database", { get() { invoked = true; return binding.database; } });
  await assert.rejects(run(selected, f.dependencies), { code: "OPERATIONS_USAGE" }); assert.equal(invoked, false);
  await assert.rejects(run(parseArguments(f.args("check")), { ...f.dependencies, inheritedEnv: { ...inheritedEnv, NODE_OPTIONS: "--inspect" } }));
});

test("the real recovery command preserves completed remote receipts after loss of local journals and keeps source encryption", async t => {
  const f = await fixture(t, { privacy: true });
  for (const phase of ["prepared", "files_erased", "completed"]) await f.advance(phase);
  const laterId = "d".repeat(32), later = createErasureJournal({ directory: f.current, key, binding, clientId: laterId }, { withDirectory: withErasureDirectory });
  try {
    let revision = 0, record = { version: 1, clientId: laterId, binding, phase: "requested", cursor: null, startedAt: now + 10, updatedAt: now + 10 };
    for (const phase of ["requested", "prepared", "files_erased", "completed"]) {
      record = { ...record, phase, updatedAt: record.updatedAt + (revision > 0 ? 1 : 0) };
      revision = (await later.save(record, revision, allow)).revision; await f.remote.gate.verify(allow);
    }
  } finally { later.close(); }
  const expected = await f.remote.readCurrent();
  for (const file of expected.files) await unlink(path.join(f.current, file.name));
  let output = "";
  const check = await main(f.args("check"), { ...f.dependencies, outputStream: { write(value) { output += value; } } });
  assert.equal(check.completedReceipts, 2); assert.equal(check.files, 3); assert.equal(check.externalRegistryContinuityVerified, true);
  const report = await main([...f.args("restore"), "--confirm-plan-sha256", check.planSha256], { ...f.dependencies, outputStream: { write(value) { output += value; } } });
  assert.equal(report.started, false); assert.equal(report.sqlRestored, false); assert.equal(report.reconciliationRequired, true);
  for (const file of expected.files) if (file.name.startsWith("erasure-")) {
    const content = await readFile(path.join(f.destination, file.name));
    assert.equal(content.toString("base64url"), file.content);
    assert.equal(verifyErasureJournalEnvelope({ key, binding, filename: file.name, content }).record.phase, "completed");
    assert.throws(() => verifyErasureJournalEnvelope({ key, binding: { database: "synthetic_clone", rootFingerprint: "c".repeat(64) }, filename: file.name, content }));
  }
  assert.equal((await readFile(path.join(f.destination, "privacy-preparation.json"))).toString("base64url"), f.state.files.find(file => file.name === "privacy-preparation.json").content);
  await assert.rejects(withErasureDirectory(f.destination, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
  assert.deepEqual((await readdir(f.current)).filter(name => name.startsWith("erasure-")), []);
  assert.doesNotMatch(output, /synthetic_source|synthetic_clone|[a]{32}|Préparation|Synthetic preparation/);
});

test("a witness older than a local receipt or the encrypted checkpoint refuses recovery", async t => {
  for (const mode of ["local", "checkpoint"]) {
    const f = await fixture(t); await f.advance("prepared", { publish: false });
    const selected = parseArguments(f.args("check"));
    if (mode === "checkpoint") {
      const advanced = await f.remote.readCurrent(), second = path.join(f.current, "new-checkpoint"); await mkdir(second, { mode: 0o700 });
      f.receipt.operations = await withErasureDirectory(second, scope => writeOperationalCheckpoint(scope, advanced, f.receipt, key));
      selected.checkpointDirectory = second;
      for (const file of advanced.files) await unlink(path.join(f.current, file.name));
    }
    await assert.rejects(run(selected, f.dependencies), { code: "OPERATIONS_REGISTRY_ROLLBACK" });
    await assert.rejects(lstat(f.destination), { code: "ENOENT" });
  }
});

test("missing, replayed, corrupted, foreign or flag-only witness replies cannot authorize the real CLI", async t => {
  for (const mode of ["missing", "busy", "replay", "corrupt", "foreign", "boolean"]) {
    const f = await fixture(t), exchange = f.dependencies.exchangeRecovery;
    const old = mode === "replay" ? await exchange({ directory: path.join(f.operator, "control"), contractSha256, binding,
      request: { version: 1, registryId: f.remote.registryId, challenge: "1".repeat(64), snapshot: null } }) : null;
    f.dependencies.exchangeRecovery = async value => {
      if (mode === "missing") throw new Error("Synthetic private transport details");
      if (mode === "busy") throw Object.assign(new Error("Synthetic private busy details"), { code: "ERASURE_CONTINUITY_BUSY" });
      if (mode === "replay") return old;
      if (mode === "boolean") return { verified: true };
      const response = structuredClone(await exchange(value));
      if (mode === "foreign") response.registryId = "0".repeat(64);
      if (mode === "corrupt") response.snapshot.files[0].content = Buffer.from("{}\n").toString("base64url");
      return response;
    };
    await assert.rejects(main(f.args("check"), { ...f.dependencies, outputStream: { write() { assert.fail("No success output"); } } }));
    await assert.rejects(lstat(f.destination), { code: "ENOENT" });
  }
});

test("the confirmed plan binds the target database, media identity, destination, private preparation and witness contract", async t => {
  for (const mode of ["database", "media", "destination", "privacy", "contract"]) {
    const f = await fixture(t, { privacy: true }), check = await main(f.args("check"), { ...f.dependencies, outputStream: { write() {} } });
    const selected = parseArguments([...f.args("restore"), "--confirm-plan-sha256", check.planSha256]);
    if (mode === "database") selected.database = "synthetic_other_clone";
    if (mode === "media") { selected.mediaRoot = path.join(f.root, "other-media"); await mkdir(selected.mediaRoot, { mode: 0o700 }); }
    if (mode === "destination") selected.destination = path.join(f.root, "other-quarantine");
    if (mode === "privacy") {
      const files = createPrivacyFiles(f.current, key, { withDirectory: withErasureDirectory });
      try { const previous = await files.read(); await files.save({ ...previous.prepared, updatedAt: now + 1 }, previous.revision, allow); }
      finally { files.close(); }
    }
    if (mode === "contract") selected.witnessContractSha256 = "d".repeat(64);
    await assert.rejects(run(selected, f.dependencies));
    await assert.rejects(lstat(selected.destination), { code: "ENOENT" });
  }
});

test("remote, local, capsule and target drift or cancellation during publication retain the startup-blocking quarantine", async t => {
  for (const mode of ["remote", "local", "capsule", "target", "abort"]) {
    const f = await fixture(t), check = await main(f.args("check"), { ...f.dependencies, outputStream: { write() {} } });
    let changed = false; const cancellation = new AbortController();
    const originalScope = f.dependencies.scopeOperation;
    f.dependencies.scopeOperation = (directory, work) => originalScope(directory, async scope => {
      if (directory !== f.destination) return work(scope);
      return work({ ...scope, async assertReady() {
        await scope.assertReady();
        if (!changed && (await readdir(f.destination)).includes(OPERATIONAL_RESTORE_MARKER)) {
          changed = true;
          if (mode === "remote") await f.advance("prepared", { preserveLocal: true });
          if (mode === "local") await f.advance("prepared", { publish: false });
          if (mode === "capsule") f.receipt.createdAt++;
          if (mode === "target") f.identityState.targetFingerprint = "9".repeat(64);
          if (mode === "abort") cancellation.abort();
        }
      } });
    });
    await assert.rejects(main([...f.args("restore"), "--confirm-plan-sha256", check.planSha256], { ...f.dependencies, signal: cancellation.signal, outputStream: { write() { assert.fail("No success output"); } } }));
    assert.equal(changed, true);
    await assert.rejects(withErasureDirectory(f.destination, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
  }
});
