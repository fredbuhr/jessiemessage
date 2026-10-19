import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { erasureDirectory } from "./erasure-files.mjs";
import { withPrivateDirectory } from "../../server/files/private-directory.mjs";
import { saveCopyState, readCopyState } from "../../server/backup/copy-files.mjs";
import { createWitnessOriginOperations } from "../../server/backup/witness-origin-operator.mjs";

export async function withWitnessDirectory(directory, work) {
  const first = await lstat(directory, { bigint: true });
  const scope = { path: directory, file: name => path.join(directory, name),
    async assertReady() { const current = await lstat(directory, { bigint: true });
      assert.equal(current.dev, first.dev); assert.equal(current.ino, first.ino); assert.equal(current.mode & 0o7777n, 0o700n); return current; },
    async sync() { const file = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY); try { await file.sync(); } finally { await file.close(); } },
  };
  const result = await work(scope); await scope.assertReady(); return result;
}
export async function witnessOriginFixture(t, { native = false, signal, source: customSource } = {}) {
  const root = await erasureDirectory(t), keys = [], environment = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd", PORT: "3000" };
  const dirs = Object.fromEntries(["operator", "operations", "private", "runtime", "media"].map(name => [name, path.join(root, name)]));
  for (const directory of Object.values(dirs)) await mkdir(directory, { mode: 0o700 });
  await mkdir(path.join(dirs.operator, "contract"), { mode: 0o700 });
  const withDirectory = native ? withPrivateDirectory : withWitnessDirectory;
  let now = 1792410000000, version = "f".repeat(64), keyByte = 7;
  const options = { command: "plan-witness", runtimeDirectory: dirs.runtime, runtimeHead: "1".repeat(40), runtimeTree: "2".repeat(40),
    privateDirectory: dirs.private, operationsDirectory: dirs.operations, privatePathMode: "linux-dirfd", witnessOperatorDirectory: dirs.operator,
    witnessDestination: "a".repeat(32) };
  const binding = { database: "synthetic_origin", rootFingerprint: "b".repeat(64) };
  const copy = { version: 1, revision: 0, destinations: [{ id: options.witnessDestination, label: "Synthetic computer", kind: "computer", enabled: true,
    pairHash: null, pairExpiresAt: null, tokenHash: "c".repeat(64), pairedAt: now - 1000, lastSeenAt: null, locationId: null, lastReceipt: null }] };
  await saveCopyState(dirs.operations, copy, 0, { withDirectory });
  const source = customSource ?? (async () => {});
  const withOrigin = async (_options, _settings, work) => {
    const key = Buffer.alloc(32, keyByte), before = version; keys.push(key);
    try { return await work({ key, binding, mediaRoot: dirs.media, configurationFingerprint: version,
      async assertReady() { assert.equal(version, before, "Synthetic configuration changed"); }, async checkCapacity() {} }); }
    finally { key.fill(0); }
  };
  const make = changes => createWitnessOriginOperations({ ...options, ...changes }, { environment, signal }, { withDirectory, source, withOrigin, clock: () => now });
  return { root, dirs, options, binding, withDirectory, source, keys, make, planner: make(),
    bind: report => make({ command: "prepare-witness", witnessDestination: undefined, witnessPlanSha256: report.planSha256 }),
    setNow(value) { now = value; }, setConfiguration(value) { version = value; }, setKeyByte(value) { keyByte = value; },
    async updatePc(work) { const state = await readCopyState(dirs.operations, { withDirectory }); work(state.destinations[0]);
      await saveCopyState(dirs.operations, state, state.revision, { withDirectory }); },
  };
}
