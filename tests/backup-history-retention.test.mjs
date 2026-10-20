import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createErasureJournal } from "../server/data/erasure-journal.mjs";
import { createPrivacyFiles } from "../server/privacy/files.mjs";
import { DECISIONS } from "../server/privacy/draft.mjs";
import { captureOperationalState, operationalStateHash, writeOperationalCheckpoint, readOperationalCheckpoint,
  planOperationalRestore } from "../server/backup/operational-checkpoint.mjs";
import { readCheckpointReceipt, writeCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";
import { APPLICATION_COVERAGE } from "../server/backup/application-scope.mjs";
import { appendCheckpointRecord, readCheckpointHistory } from "../server/backup/recurring-checkpoint-files.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const key = Buffer.alloc(32, 7), binding = { database: "synthetic_retention_source", rootFingerprint: "b".repeat(64) };
const targetBinding = { database: "synthetic_retention_clone", rootFingerprint: "c".repeat(64) };
const now = 1792350000000, internal = { withDirectory: withErasureDirectory }, allow = async () => {};
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const capture = directory => withErasureDirectory(directory, scope => captureOperationalState(scope, { key, binding }));

async function completed(directory, clientId, at) {
  const journal = createErasureJournal({ directory, key, binding, clientId }, internal);
  try {
    let revision = 0;
    for (const [offset, phase] of ["requested", "prepared", "files_erased", "completed"].entries()) {
      revision = (await journal.save({ version: 1, clientId, binding, phase, cursor: null,
        startedAt: at, updatedAt: at + offset }, revision, allow)).revision;
    }
  } finally { journal.close(); }
}

async function checkpoint(directory, state, startedAt, suffix) {
  const name = `capture-${startedAt}-${suffix.repeat(16)}`, destination = path.join(directory, name);
  await mkdir(destination, { mode: 0o700 });
  // These tiny SQL/manifest bytes are synthetic placeholders. This test checks
  // receipt/capsule preservation, never SQL validity, import or restoration.
  const manifest = Buffer.from('{"synthetic":"retention dry-run"}'), sql = Buffer.from("-- no SQL import in this test\n"), gzip = gzipSync(sql);
  await writeFile(path.join(destination, "manifest.json"), manifest, { mode: 0o600 });
  await writeFile(path.join(destination, "database.sql.gz"), gzip, { mode: 0o600 });
  const receipt = { format: "jessiemessage-private-checkpoint", version: 10,
    profile: "messaging-photos-notify-recovery-crm-broadcast-application",
    // Historical schema-30 capsules keep their original coverage after upgrade.
    coverage: { ...APPLICATION_COVERAGE, tables: 30 },
    createdAt: startedAt + 1, schema: { tables: 30, migrations: 30 },
    sql: { file: "database.sql.gz", bytes: gzip.length, sha256: hash(gzip), uncompressedBytes: sql.length, uncompressedSha256: hash(sql) },
    manifest: { file: "manifest.json", sha256: hash(manifest) }, media: { files: [], bytes: 0 } };
  await withErasureDirectory(destination, async scope => {
    receipt.operations = await writeOperationalCheckpoint(scope, state, receipt, key);
    await writeCheckpointReceipt(scope, receipt);
  });
  for (const status of ["running", "succeeded"]) await appendCheckpointRecord(directory, {
    version: 1, type: "recurring_checkpoint", status, phase: status === "running" ? "preflight" : "finished", code: "OK",
    startedAt, finishedAt: status === "running" ? null : startedAt + 2, runtimeResumed: status !== "running",
  }, {}, internal);
  return { name, destination, receipt };
}

test("history archival dry-run preserves source bytes and later closure coverage for every selected old capsule", async t => {
  const root = await erasureDirectory(t), operations = path.join(root, "operations"), archive = path.join(root, "archive");
  for (const directory of [operations, archive]) await mkdir(directory, { mode: 0o700 });
  const privacy = createPrivacyFiles(operations, key, internal);
  try { await privacy.save({ updatedAt: now, draft: { answers: Object.fromEntries(DECISIONS.map(id => [id, ""])),
    notice: { fr: "Préparation synthétique conservée", en: "Retained synthetic preparation" } } }, 0, allow); }
  finally { privacy.close(); }
  await completed(operations, "a".repeat(32), now);
  const old = await checkpoint(operations, await capture(operations), now + 10, "a");
  await completed(operations, "b".repeat(32), now + 20);
  const recent = await checkpoint(operations, await capture(operations), now + 30, "b");
  const before = await capture(operations), history = await readCheckpointHistory(operations, {}, internal);
  assert.equal(history.records.length, 4); assert.equal(history.lastSuccessAt, now + 32);
  const receiptNames = [];
  for (const name of await readdir(operations)) if (name.startsWith("checkpoint-")) {
    const record = JSON.parse(await readFile(path.join(operations, name), "utf8"));
    if (record.startedAt === now + 10) receiptNames.push(name);
  }
  assert.equal(receiptNames.length, 2);
  const selected = [old.name, ...receiptNames];
  assert.equal(selected.includes(recent.name), false);
  assert.ok(before.files.every(file => !selected.includes(file.name)));
  const originalFiles = Object.fromEntries(await Promise.all((await readdir(old.destination)).map(async name => [name, hash(await readFile(path.join(old.destination, name)))])));

  // Qualify copying the dry-run selection only. No removal, active-history
  // rotation, production archival command or purge is implemented here.
  for (const name of selected) await cp(path.join(operations, name), path.join(archive, name), { recursive: true, force: false, errorOnExist: true });
  assert.equal(operationalStateHash(await capture(operations)), operationalStateHash(before));
  assert.deepEqual(await readCheckpointHistory(operations, {}, internal), history);
  const archivedPath = path.join(archive, old.name);
  for (const [name, digest] of Object.entries(originalFiles)) {
    assert.equal(hash(await readFile(path.join(archivedPath, name))), digest);
    assert.equal(hash(await readFile(path.join(old.destination, name))), digest);
    const stats = await lstat(path.join(archivedPath, name));
    assert.equal(stats.mode & 0o7777, 0o600); assert.equal(stats.nlink, 1);
  }
  const oldState = await withErasureDirectory(archivedPath, async scope => {
    const receipt = await readCheckpointReceipt(scope);
    assert.deepEqual(receipt.schema, { tables: 30, migrations: 30 });
    assert.equal(receipt.coverage.tables, 30);
    return readOperationalCheckpoint(scope, receipt, key);
  });
  assert.equal(planOperationalRestore({ backup: oldState, current: before, targetBinding, key }).completedReceipts, 2);
  await completed(operations, "c".repeat(32), now + 40);
  const current = await capture(operations);
  for (const checkpointDirectory of [archivedPath, recent.destination]) {
    const backup = await withErasureDirectory(checkpointDirectory, async scope => {
      const receipt = await readCheckpointReceipt(scope);
      return readOperationalCheckpoint(scope, receipt, key);
    });
    const plan = planOperationalRestore({ backup, current, targetBinding, key });
    assert.equal(plan.completedReceipts, 3); assert.equal(plan.reconciliationRequired, true);
    assert.equal(plan.externalContinuityVerified, false);
    assert.deepEqual(plan.state.files, current.files);
  }
  // The old embedded registry alone cannot know closures occurring afterwards.
  assert.equal(planOperationalRestore({ backup: oldState, current: oldState, targetBinding, key }).completedReceipts, 1);
  assert.throws(() => planOperationalRestore({ backup: before, current: oldState, targetBinding, key }), { code: "OPERATIONS_REGISTRY_ROLLBACK" });
});
