import test from "node:test";
import assert from "node:assert/strict";
import { chmod, link, mkdir, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createErasureJournal } from "../server/data/erasure-journal.mjs";
import { captureOperationalState, readOperationalQuarantine, restoreOperationalQuarantine, assertNoOperationalRestore,
  operationalStateHash, OperationalCheckpointError, OPERATIONAL_RESTORE_MARKER } from "../server/backup/operational-checkpoint.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const key = Buffer.alloc(32, 19), sourceBinding = { database: "synthetic_quarantine_source", rootFingerprint: "a".repeat(64) };
const targetBinding = { database: "synthetic_quarantine_target", rootFingerprint: "b".repeat(64) };
const now = 1792436400000, clientId = "c".repeat(32), allow = async () => {};
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const read = (directory, overrides = {}) => withErasureDirectory(directory,
  scope => readOperationalQuarantine(scope, { key, sourceBinding, targetBinding, ...overrides }));

async function fixture(t, empty = false) {
  const root = await erasureDirectory(t), source = path.join(root, "source"), target = path.join(root, "quarantine");
  for (const directory of [source, target]) await mkdir(directory, { mode: 0o700 });
  if (!empty) {
    const journal = createErasureJournal({ directory: source, key, binding: sourceBinding, clientId }, { withDirectory: withErasureDirectory });
    try {
      let revision = 0;
      for (const [index, phase] of ["requested", "prepared", "files_erased", "completed"].entries()) {
        revision = (await journal.save({ version: 1, clientId, binding: sourceBinding, phase, cursor: null,
          startedAt: now, updatedAt: now + index }, revision, allow)).revision;
      }
    } finally { journal.close(); }
  }
  const state = await withErasureDirectory(source, scope => captureOperationalState(scope, { key, binding: sourceBinding }));
  await withErasureDirectory(target, scope => restoreOperationalQuarantine(scope, { backup: state, current: state, targetBinding,
    key, expectedCurrentSha256: operationalStateHash(state), assertCurrent: allow }));
  const markerPath = path.join(target, OPERATIONAL_RESTORE_MARKER), markerBytes = await readFile(markerPath), marker = JSON.parse(markerBytes);
  return { source, target, state, markerPath, markerBytes, marker };
}

test("quarantine inspection preserves original envelopes, hashes and the startup-blocking marker", async t => {
  for (const empty of [false, true]) {
    const f = await fixture(t, empty), before = await Promise.all((await readdir(f.target)).sort().map(async name => [name, await readFile(path.join(f.target, name))]));
    const result = await read(f.target);
    assert.deepEqual(result, { marker: f.marker, state: f.state, markerSha256: hash(f.markerBytes), stateSha256: operationalStateHash(f.state) });
    assert.deepEqual(result.state.binding, sourceBinding);
    assert.deepEqual(await Promise.all((await readdir(f.target)).sort().map(async name => [name, await readFile(path.join(f.target, name))])), before);
    await assert.rejects(withErasureDirectory(f.target, scope => captureOperationalState(scope, { key, binding: sourceBinding })), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
    await assert.rejects(withErasureDirectory(f.target, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
    assert.deepEqual(await withErasureDirectory(f.source, scope => captureOperationalState(scope, { key, binding: sourceBinding })), f.state);
  }
});

test("quarantine inspection requires an exact canonical v1 marker and both expected bindings", async t => {
  const mutations = [
    () => "{",
    value => JSON.stringify(value),
    value => JSON.stringify({ ...value, extra: true }) + "\n",
    value => JSON.stringify({ ...value, version: 2 }) + "\n",
    value => JSON.stringify({ ...value, status: "reconciled" }) + "\n",
    value => JSON.stringify({ ...value, backupSha256: "A".repeat(64) }) + "\n",
    value => JSON.stringify({ ...value, currentSha256: "0".repeat(63) }) + "\n",
    value => JSON.stringify({ ...value, mergedSha256: "0".repeat(64) }) + "\n",
    value => JSON.stringify({ ...value, sourceBinding: targetBinding }) + "\n",
    value => JSON.stringify({ ...value, targetBinding: sourceBinding }) + "\n",
    value => JSON.stringify({ ...value, sourceBinding: { ...sourceBinding, extra: true } }) + "\n",
    value => JSON.stringify(Object.fromEntries(Object.entries(value).reverse())) + "\n",
    value => JSON.stringify(value).replace('"version":1', '"version":1,"version":1') + "\n",
    value => { const copy = { ...value }; delete copy.currentSha256; return JSON.stringify(copy) + "\n"; },
  ];
  for (const mutate of mutations) {
    const f = await fixture(t); await writeFile(f.markerPath, mutate(f.marker));
    await assert.rejects(read(f.target), OperationalCheckpointError);
    await assert.rejects(withErasureDirectory(f.target, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
  }
  const f = await fixture(t);
  await assert.rejects(read(f.target, { sourceBinding: targetBinding }), { code: "OPERATIONS_BINDING_CHANGED" });
  await assert.rejects(read(f.target, { targetBinding: sourceBinding }), { code: "OPERATIONS_BINDING_CHANGED" });
});

test("missing, incomplete, corrupt and wrongly decrypted quarantines never produce a readable state", async t => {
  for (const mode of ["missing-marker", "missing-receipt", "corrupt-receipt", "wrong-key", "extra-receipt"]) {
    const f = await fixture(t), file = f.state.files[0];
    if (mode === "missing-marker") await unlink(f.markerPath);
    if (mode === "missing-receipt") await unlink(path.join(f.target, file.name));
    if (mode === "corrupt-receipt") await writeFile(path.join(f.target, file.name), "{}\n");
    if (mode === "extra-receipt") {
      const journal = createErasureJournal({ directory: f.target, key, binding: sourceBinding, clientId: "d".repeat(32) }, { withDirectory: withErasureDirectory });
      try { await journal.save({ version: 1, clientId: "d".repeat(32), binding: sourceBinding, phase: "requested", cursor: null, startedAt: now, updatedAt: now }, 0, allow); }
      finally { journal.close(); }
    }
    await assert.rejects(read(f.target, mode === "wrong-key" ? { key: Buffer.alloc(32, 20) } : {}), OperationalCheckpointError);
  }
});

test("unsafe marker paths and live writer locks cannot be inspected", async t => {
  for (const mode of ["mode", "symlink", "hardlink", "directory", "oversize", "lock"]) {
    const f = await fixture(t);
    if (mode === "mode") await chmod(f.markerPath, 0o640);
    if (mode === "symlink") { await unlink(f.markerPath); await writeFile(path.join(f.target, "marker-original"), f.markerBytes, { mode: 0o600 }); await symlink("marker-original", f.markerPath); }
    if (mode === "hardlink") await link(f.markerPath, path.join(f.target, "marker-original"));
    if (mode === "directory") { await unlink(f.markerPath); await mkdir(f.markerPath, { mode: 0o700 }); }
    if (mode === "oversize") await writeFile(f.markerPath, " ".repeat(4097));
    if (mode === "lock") await writeFile(path.join(f.target, f.state.files[0].name.replace(/\.json$/, ".lock")), "", { mode: 0o600 });
    await assert.rejects(read(f.target), OperationalCheckpointError);
  }
});

test("a marker changed after its first read is rejected on reread", async t => {
  const f = await fixture(t); let calls = 0;
  await assert.rejects(withErasureDirectory(f.target, scope => readOperationalQuarantine({ ...scope, async assertReady() {
    await scope.assertReady();
    if (++calls === 3) await writeFile(f.markerPath, JSON.stringify({ ...f.marker, backupSha256: "f".repeat(64) }) + "\n");
  } }, { key, sourceBinding, targetBinding })), { code: "OPERATIONS_CHANGED" });
  assert.ok(calls > 3);
  await assert.rejects(withErasureDirectory(f.target, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
});

test("inventory drift and cancellation refuse quarantine inspection while preserving its marker", async t => {
  const f = await fixture(t); let calls = 0;
  await assert.rejects(withErasureDirectory(f.target, scope => readOperationalQuarantine({ ...scope, async assertReady() {
    await scope.assertReady();
    if (++calls === 4) await unlink(path.join(f.target, f.state.files[0].name));
  } }, { key, sourceBinding, targetBinding })), OperationalCheckpointError);
  const cancellation = new AbortController(); cancellation.abort();
  await assert.rejects(read(f.target, { signal: cancellation.signal }), { code: "OPERATIONS_ABORTED" });
  await assert.rejects(withErasureDirectory(f.target, assertNoOperationalRestore), { code: "OPERATIONS_RECONCILIATION_REQUIRED" });
});
