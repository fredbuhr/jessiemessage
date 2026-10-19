import test from "node:test";
import assert from "node:assert/strict";
import { chmod, link, lstat, mkdir, readFile, readdir, rename, statfs, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createWitnessEnrollment, WITNESS_ENROLLMENT_FILE, WITNESS_ENROLLMENT_ORIGIN } from "../server/backup/witness-enrollment.mjs";
import { registryHash } from "../server/backup/registry-snapshot.mjs";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const registryId = "b".repeat(64), contractSha256 = "f".repeat(64), attemptId = "d".repeat(32);
const contract = { version: 1, origin: "https://jessiemessage.com", contractId: "a".repeat(64), createdAt: 1792407600000,
  binding: { database: "synthetic_enrollment", rootFingerprint: "c".repeat(64) }, sourceIdentity: { dev: "1", ino: "2" }, registryId,
  destination: { destinationId: "a".repeat(32), pairedAt: 1792407500000, pairingFingerprint: "e".repeat(64) },
  initialSnapshotSha256: registryHash({ version: 1, registryId, files: [] }) };
const request = (attempt = attemptId) => ({ version: 1, destinationId: contract.destination.destinationId, attemptId: attempt });
async function fixture(t, { native = false } = {}) {
  const root = await erasureDirectory(t), directory = path.join(root, "enrollment"); await mkdir(directory, { mode: 0o700 });
  const events = [], suppliedKey = Buffer.alloc(32, 7), stateFile = path.join(directory, WITNESS_ENROLLMENT_FILE), originFile = path.join(directory, WITNESS_ENROLLMENT_ORIGIN);
  let stopped = false, original = true, failResume = false, failCleanup = false, failSync = false;
  const withDirectory = async (selected, work) => {
    const result = await (native ? withPrivateDirectory : withErasureDirectory)(selected, async scope => work({ ...scope,
      async assertReady() { return await scope.assertReady() ?? lstat(selected, { bigint: true }); },
      async sync() { await scope.sync(); if (failSync) throw new Error("Synthetic private sync cause"); } }));
    if (failCleanup) throw new Error("Synthetic private descriptor cleanup cause"); return result;
  };
  const options = { directory, contract, contractSha256, key: suppliedKey,
    async assertOriginal() { events.push("source"); if (!original) throw new Error("Synthetic private capability/configuration/source drift"); },
    async withMaintenance(work) {
      events.push("stop"); stopped = true;
      try { const result = await work(async () => { events.push("quiescent"); assert.equal(stopped, true); });
        events.push("resume"); stopped = false; if (failResume) throw new Error("Synthetic private resume cause"); return result;
      } finally { stopped = false; }
    },
  };
  const make = changes => createWitnessEnrollment({ ...options, ...changes }, { withDirectory });
  const enrollment = make(); t.after(() => enrollment.close());
  return { root, directory, events, suppliedKey, stateFile, originFile, options, make, enrollment,
    setOriginal(value) { original = value; }, setFailResume(value) { failResume = value; },
    setFailCleanup(value) { failCleanup = value; }, setFailSync(value) { failSync = value; } };
}

test("first-use enrollment is canonical, authenticated and spent durably before its only initializing packet", async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.enrollment.initialize(), { ready: true, spent: false });
  assert.deepEqual((await readdir(f.directory)).sort(), [WITNESS_ENROLLMENT_FILE, WITNESS_ENROLLMENT_ORIGIN].sort());
  for (const filename of [f.stateFile, f.originFile]) {
    const bytes = await readFile(filename, "utf8"); assert.equal(bytes, `${JSON.stringify(JSON.parse(bytes))}\n`);
    assert.equal(bytes.includes(f.suppliedKey.toString("base64url")), false);
  }
  const packet = await f.enrollment.reserve(request());
  assert.deepEqual(packet, { version: 1, initialize: true, destinationId: contract.destination.destinationId, attemptId,
    contractSha256, contractId: contract.contractId, registryId, initialSnapshotSha256: contract.initialSnapshotSha256 });
  const state = JSON.parse(await readFile(f.stateFile, "utf8")); assert.equal(state.phase, "spent"); assert.equal(state.attemptId, attemptId);
  assert.equal(f.events.at(-1), "source"); assert.equal(f.events.includes("stop"), true); assert.equal(f.events.includes("resume"), true);
  assert.deepEqual(await f.enrollment.check(), { ready: false, spent: true });
  const same = await f.enrollment.reserve(request()); assert.equal(same.initialize, false);
  const reopened = f.make(); t.after(() => reopened.close()); assert.equal((await reopened.reserve(request())).initialize, false);
  const before = await readFile(f.stateFile);
  await assert.rejects(reopened.reserve(request("9".repeat(32))), { code: "WITNESS_ENROLLMENT_RECOVERY_REQUIRED" });
  assert.deepEqual(await readFile(f.stateFile), before);
  await assert.rejects(f.enrollment.initialize(), { code: "WITNESS_ENROLLMENT_RECOVERY_REQUIRED" });
});

test("absent state is never created by check/reserve and a lost initialized state never permits another initialization", async t => {
  const f = await fixture(t);
  await assert.rejects(f.enrollment.check(), { code: "WITNESS_ENROLLMENT_MISSING" });
  await assert.rejects(f.enrollment.reserve(request()), { code: "WITNESS_ENROLLMENT_MISSING" });
  assert.deepEqual(await readdir(f.directory), []);
  await f.enrollment.initialize(); await unlink(f.stateFile);
  for (const enrollment of [f.enrollment, f.make()]) {
    t.after(() => enrollment.close());
    await assert.rejects(enrollment.check(), { code: "WITNESS_ENROLLMENT_MISSING" });
    await assert.rejects(enrollment.reserve(request()), { code: "WITNESS_ENROLLMENT_MISSING" });
    await assert.rejects(enrollment.initialize(), { code: "WITNESS_ENROLLMENT_RECOVERY_REQUIRED" });
  }
  assert.deepEqual(await readdir(f.directory), [WITNESS_ENROLLMENT_ORIGIN]);
});

test("canonical state authentication, physical origin and private file invariants reject corruption without repair", async t => {
  for (const mode of ["state-mac", "origin-mac", "partial", "noncanonical", "mode", "symlink", "hardlink", "extra", "missing-origin", "directory-replacement"]) await t.test(mode, async step => {
    const f = await fixture(step); await f.enrollment.initialize();
    if (mode === "state-mac") { const value = JSON.parse(await readFile(f.stateFile)); value.phase = "spent"; value.revision = 2; value.attemptId = attemptId; await writeFile(f.stateFile, JSON.stringify(value) + "\n"); }
    if (mode === "origin-mac") { const value = JSON.parse(await readFile(f.originFile)); value.origin.contractSha256 = "8".repeat(64); await writeFile(f.originFile, JSON.stringify(value) + "\n"); }
    if (mode === "partial") await writeFile(f.stateFile, "");
    if (mode === "noncanonical") await writeFile(f.stateFile, (await readFile(f.stateFile, "utf8")).replace('"version":1', '"version":1,"version":1'));
    if (mode === "mode") await chmod(f.stateFile, 0o640);
    if (mode === "symlink") { await rename(f.stateFile, path.join(f.root, "outside")); await symlink(path.join(f.root, "outside"), f.stateFile); }
    if (mode === "hardlink") await link(f.stateFile, path.join(f.root, "outside"));
    if (mode === "extra") await writeFile(path.join(f.directory, "uncertain.pending"), "", { mode: 0o600 });
    if (mode === "missing-origin") await unlink(f.originFile);
    if (mode === "directory-replacement") {
      const saved = await Promise.all([readFile(f.stateFile), readFile(f.originFile)]); await rename(f.directory, f.directory + "-original");
      await mkdir(f.directory, { mode: 0o700 }); await writeFile(f.stateFile, saved[0], { mode: 0o600 }); await writeFile(f.originFile, saved[1], { mode: 0o600 });
    }
    const before = await readdir(f.directory);
    for (const enrollment of [f.enrollment, f.make()]) { step.after(() => enrollment.close()); await assert.rejects(enrollment.check()); await assert.rejects(enrollment.reserve(request())); }
    assert.deepEqual(await readdir(f.directory), before);
  });
});

test("changed original contract, capability/configuration and key never spend the current authorization", async t => {
  const f = await fixture(t); await f.enrollment.initialize(); const before = await readFile(f.stateFile);
  f.setOriginal(false);
  await assert.rejects(f.enrollment.check(), { code: "WITNESS_ENROLLMENT_CHANGED" });
  await assert.rejects(f.enrollment.reserve(request()), { code: "WITNESS_ENROLLMENT_CHANGED" });
  assert.deepEqual(await readFile(f.stateFile), before); f.setOriginal(true);
  for (const changes of [{ contractSha256: "9".repeat(64) }, { key: Buffer.alloc(32, 8) },
    { contract: { ...contract, destination: { ...contract.destination, pairingFingerprint: "9".repeat(64) } } }]) {
    const changed = f.make(changes); t.after(() => changed.close()); await assert.rejects(changed.check()); await assert.rejects(changed.reserve(request()));
    assert.deepEqual(await readFile(f.stateFile), before);
  }
});

test("missing, repeated or failed quiescence proof cannot initialize or spend enrollment", async t => {
  for (const mode of ["skipped", "missing", "failed", "repeated"]) await t.test(mode, async step => {
    const f = await fixture(step);
    const enrollment = f.make({ async withMaintenance(work) {
      if (mode === "skipped") return { ready: true, spent: false };
      if (mode === "missing") return work();
      if (mode === "failed") return work(async () => { throw new Error("Synthetic process still running"); });
      await work(async () => {}); return work(async () => {});
    } }); step.after(() => enrollment.close());
    await assert.rejects(enrollment.initialize());
    if (mode !== "repeated") assert.deepEqual(await readdir(f.directory), []);
    await assert.rejects(enrollment.initialize(), { code: "WITNESS_ENROLLMENT_RECOVERY_REQUIRED" });
  });
});

test("interrupted initial publication remains blocked and uncertain post-spend cleanup never returns initialize true on retry", async t => {
  const incomplete = await fixture(t); incomplete.setFailSync(true);
  await assert.rejects(incomplete.enrollment.initialize()); incomplete.setFailSync(false);
  assert.deepEqual(await readdir(incomplete.directory), [WITNESS_ENROLLMENT_ORIGIN]);
  const reopened = incomplete.make(); t.after(() => reopened.close());
  await assert.rejects(reopened.initialize(), { code: "WITNESS_ENROLLMENT_RECOVERY_REQUIRED" });
  await assert.rejects(reopened.reserve(request()), { code: "WITNESS_ENROLLMENT_MISSING" });
  for (const mode of ["resume", "descriptor-cleanup", "sync"]) await t.test(mode, async step => {
    const f = await fixture(step); await f.enrollment.initialize();
    if (mode === "resume") f.setFailResume(true);
    if (mode === "descriptor-cleanup") f.setFailCleanup(true);
    if (mode === "sync") f.setFailSync(true);
    await assert.rejects(f.enrollment.reserve(request()), error => { assert.doesNotMatch(error.message, /Synthetic|private|cause/); return true; });
    f.setFailResume(false); f.setFailCleanup(false); f.setFailSync(false);
    assert.equal(JSON.parse(await readFile(f.stateFile)).phase, "spent");
    assert.equal((await f.enrollment.reserve(request())).initialize, false);
    await assert.rejects(f.enrollment.reserve(request("9".repeat(32))), { code: "WITNESS_ENROLLMENT_RECOVERY_REQUIRED" });
  });
});

test("enrollment owns a copied key, closed instances cannot work and malformed requests cannot consume state", async t => {
  const f = await fixture(t); f.suppliedKey.fill(0); await f.enrollment.initialize();
  for (const value of [{ ...request(), extra: true }, { ...request(), version: 2 }, { ...request(), attemptId: "bad" }, { ...request(), destinationId: "9".repeat(32) }]) {
    await assert.rejects(f.enrollment.reserve(value), { code: "WITNESS_ENROLLMENT_INPUT" });
  }
  assert.deepEqual(await f.enrollment.check(), { ready: true, spent: false });
  f.enrollment.close(); await assert.rejects(f.enrollment.check(), { code: "WITNESS_ENROLLMENT_CLOSED" });
  await assert.rejects(f.enrollment.reserve(request()), { code: "WITNESS_ENROLLMENT_CLOSED" });
});

test("original-source drift during runtime resume consumes the attempt without returning initialization authority", async t => {
  const f = await fixture(t); await f.enrollment.initialize();
  const drift = f.make({ async withMaintenance(work) {
    const result = await work(async () => {}); f.setOriginal(false); return result;
  } }); t.after(() => drift.close());
  await assert.rejects(drift.reserve(request()), { code: "WITNESS_ENROLLMENT_CHANGED" });
  assert.equal(JSON.parse(await readFile(f.stateFile)).phase, "spent"); f.setOriginal(true);
  assert.equal((await f.enrollment.reserve(request())).initialize, false);
});

test("enrollment storage cannot share the original operations directory's physical identity", async t => {
  const f = await fixture(t), stats = await lstat(f.directory, { bigint: true });
  const sameSource = f.make({ contract: { ...contract, sourceIdentity: { dev: String(stats.dev), ino: String(stats.ino) } } });
  t.after(() => sameSource.close());
  await assert.rejects(sameSource.initialize(), { code: "WITNESS_ENROLLMENT_UNSAFE" }); assert.deepEqual(await readdir(f.directory), []);
});

let unavailable;
if (process.platform !== "linux") unavailable = "Linux required";
else { try { if ((await statfs("/proc/self/fd", { bigint: true })).type !== 0x9fa0n) unavailable = "procfs unavailable"; } catch { unavailable = "procfs unavailable"; } }
test("Linux CI must exercise native witness enrollment anchors", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(unavailable, undefined));
test("native first-use enrollment uses private anchors and refuses to recreate a missing spent state", { skip: unavailable }, async t => {
  const f = await fixture(t, { native: true }); await f.enrollment.initialize();
  assert.equal((await f.enrollment.reserve(request())).initialize, true);
  assert.equal((await f.enrollment.reserve(request())).initialize, false);
  await unlink(f.stateFile); await assert.rejects(f.enrollment.reserve(request()), { code: "WITNESS_ENROLLMENT_MISSING" });
});
