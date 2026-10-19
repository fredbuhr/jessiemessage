import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { replayClosureReconciliation } from "../server/backup/closure-reconciliation-replay.mjs";
import { erasureDirectory } from "./fixtures/erasure-files.mjs";

async function fixture(t) {
  const root = await erasureDirectory(t), directories = Object.fromEntries(["sourceOperations", "checkpoint", "quarantine", "progress", "sourceMedia"]
    .map(name => [name, path.join(root, name)]));
  const targetRoot = path.join(root, "targetMedia"), allDirectories = [...Object.values(directories), targetRoot];
  for (const directory of allDirectories) {
    await mkdir(directory, { mode: 0o700 });
    await writeFile(path.join(directory, "sentinel"), `preserved:${path.basename(directory)}`, { mode: 0o600 });
  }
  const calls = { lock: 0, maintenance: 0, source: 0, database: 0 };
  const connection = async () => { calls.database++; throw new Error("A rejected directory alias must not inspect SQL"); };
  const key = Buffer.alloc(32, 7), messageKey = Buffer.alloc(32, 8);
  const input = { planParameters: { key, assertReady: async () => { calls.source++; } }, expectedPlanSha256: "a".repeat(64), checkpointReceipt: {}, manifest: {},
    keys: { crmKey: key, mediaKey: Buffer.alloc(32, 9), messageKey },
    target: { pool: { getConnection: connection }, inspectionPool: { getConnection: connection }, rootPath: targetRoot, broadcastKey: messageKey },
    directories, maintenance: { async withQuiescedProducers() { calls.maintenance++; throw new Error("Alias reached exclusion"); } }, clock: () => 0 };
  const internal = { async lock() { calls.lock++; throw new Error("Alias reached progress lock"); } };
  const unchanged = async () => {
    assert.deepEqual(calls, { lock: 0, maintenance: 0, source: 0, database: 0 });
    for (const directory of allDirectories) {
      assert.deepEqual(await readdir(directory), ["sentinel"]);
      assert.equal(await readFile(path.join(directory, "sentinel"), "utf8"), `preserved:${path.basename(directory)}`);
    }
  };
  return { input, internal, unchanged };
}

for (const name of ["sourceOperations", "checkpoint", "quarantine", "sourceMedia"]) {
  test(`progress exactly equal to ${name} is rejected before any resource or write capability`, async t => {
    const f = await fixture(t);
    f.input.directories[name] = f.input.directories.progress;
    await assert.rejects(replayClosureReconciliation(f.input, f.internal), { code: "CLOSURE_REPLAY_INPUT" });
    await f.unchanged();
  });
}
test("progress exactly equal to target media is rejected before any resource or write capability", async t => {
  const f = await fixture(t); f.input.target.rootPath = f.input.directories.progress;
  await assert.rejects(replayClosureReconciliation(f.input, f.internal), { code: "CLOSURE_REPLAY_INPUT" });
  await f.unchanged();
});
for (const relationship of ["inside", "around"]) {
  test(`progress ${relationship} a protected directory is rejected before a lock or connection`, async t => {
    const f = await fixture(t);
    if (relationship === "inside") f.input.directories.progress = path.join(f.input.directories.sourceOperations, "progress-child");
    else f.input.directories.sourceOperations = path.join(f.input.directories.progress, "source-child");
    await assert.rejects(replayClosureReconciliation(f.input, f.internal), { code: "CLOSURE_REPLAY_INPUT" });
    await f.unchanged();
  });
}
