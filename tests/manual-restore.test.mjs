import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { reconcileManualRestore } from "../server/backup/manual-restore.mjs";
import { erasureDirectory } from "./fixtures/erasure-files.mjs";

async function fixture(t) {
  const root = await erasureDirectory(t), directories = Object.fromEntries(["checkpointDirectory", "quarantineDirectory", "journalDirectory", "progressDirectory", "media"].map(name => [name, path.join(root, name)]));
  for (const directory of Object.values(directories)) { await mkdir(directory, { mode: 0o700 }); await writeFile(path.join(directory, "sentinel"), "preserved", { mode: 0o600 }); }
  let calls = 0;
  const blocked = async () => { calls++; throw new Error("Invalid manual input reached an execution capability"); };
  const { media, ...selected } = directories;
  const input = { ...selected, recentRegistry: { version: 1, binding: { database: "synthetic_manual_source", rootFingerprint: "a".repeat(64) }, files: [] },
    expectedRegistrySha256: "b".repeat(64), readRecentRegistry: blocked, assertReady: blocked,
    target: { database: "synthetic_manual_target", rootPath: media, pool: { getConnection: blocked }, inspectionPool: { getConnection: blocked } },
    maintenance: { withQuiescedProducers: blocked } };
  const unchanged = async () => { assert.equal(calls, 0); for (const directory of Object.values(directories)) { assert.deepEqual(await readdir(directory), ["sentinel"]); assert.equal(await readFile(path.join(directory, "sentinel"), "utf8"), "preserved"); } };
  return { input, unchanged };
}
for (const field of ["recentRegistry", "expectedRegistrySha256", "readRecentRegistry", "maintenance"]) {
  test(`manual restoration requires explicit ${field} before accessing a target`, async t => {
    const f = await fixture(t); delete f.input[field]; await assert.rejects(reconcileManualRestore(f.input), { code: "MANUAL_RESTORE_INPUT" }); await f.unchanged();
  });
}
for (const name of ["checkpointDirectory", "quarantineDirectory", "journalDirectory"]) {
  test(`manual progress cannot alias ${name}`, async t => {
    const f = await fixture(t); f.input.progressDirectory = f.input[name]; await assert.rejects(reconcileManualRestore(f.input), { code: "MANUAL_RESTORE_DIRECTORY" }); await f.unchanged();
  });
}
test("a target journal cannot be hidden inside the imported media or its source quarantine", async t => {
  for (const directory of ["media", "quarantineDirectory"]) {
    const f = await fixture(t); f.input.journalDirectory = path.join(directory === "media" ? f.input.target.rootPath : f.input[directory], "journal-child");
    await assert.rejects(reconcileManualRestore(f.input), { code: "MANUAL_RESTORE_DIRECTORY" }); await f.unchanged();
  }
});
