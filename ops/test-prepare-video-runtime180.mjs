// Synthetic private files only. No SQL server, hostname resolution or runtime start.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, link, lstat, mkdir, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BASE_NAMES, BUNDLE_NAMES, DEFAULTS, computeBundleFingerprint, run } from "./prepare-video-runtime180.mjs";

const repository = process.env.JM180_TEST_REPOSITORY ?? resolve(dirname(fileURLToPath(import.meta.url)), "..");
const at = file => import(pathToFileURL(join(repository, file)).href);
const privateFixture = await at("tests/fixtures/crm-private.mjs");
const modules = await Promise.all(["server/config/runtime-database-file.mjs", "server/files/private-directory.mjs", "server/config/runtime-video.mjs",
  "server/config/runtime-video-storage.mjs", "server/config/runtime-messaging.mjs"].map(at));
const apis = Object.assign({}, ...modules), primary = { originProfile: "primary" };
const available = privateFixture.supportedFiles;
test("operator publication requires actual Linux anchored-file support", { skip: !process.env.CI && process.env.JM180_REQUIRE_NATIVE !== "1" }, () => {
  assert.equal(available, true, "native private-file tests must run before publication");
});
async function fixture(t) {
  const f = await privateFixture.fixture(t); await mkdir(f.records.media.mediaRoot, { mode: 0o700 });
  const options = { ...DEFAULTS, sourceCheckout: repository, sourceDirectory: f.directory,
    targetDirectory: join(f.root, "runtime-video-180"), videoRoot: join(f.root, "video-180") };
  // Keep noncanonical formatting so the six copies must preserve actual bytes.
  const name = join(f.directory, "runtime-crm.json");
  await writeFile(name, `  ${JSON.stringify(f.records.crm)}\n\n`, { mode: 0o600 });
  const before = new Map(await Promise.all(BASE_NAMES.map(async name => [name, await readFile(join(f.directory, name))])));
  return { ...f, options, before, dependencies: { assertSources: async () => {}, random: () => Buffer.alloc(32, 7) } };
}
const missing = path => assert.rejects(lstat(path), { code: "ENOENT" });
const rejected = error => /^VIDEO180_[A-Z_]+$/.test(error.code) && !error.message.includes("synthetic-only");
async function unchanged(f) { for (const [name, bytes] of f.before) assert.deepEqual(await readFile(join(f.directory, name)), bytes, name); }

test("aggregate fingerprint has an unambiguous fixed seven-file encoding", () => {
  const files = new Map(BUNDLE_NAMES.map((name, i) => [name, Buffer.from(`fixture-${i}\n`)]));
  const parts = [];
  for (const name of [...files.keys()].sort()) { const bytes = files.get(name); parts.push(Buffer.from(`${name}\0${bytes.length}\0`, "utf8"), bytes); }
  assert.equal(computeBundleFingerprint(files), createHash("sha256").update(Buffer.concat(parts)).digest("hex"));
  const reversed = new Map([...files].reverse()); assert.equal(computeBundleFingerprint(reversed), computeBundleFingerprint(files));
  const incomplete = new Map(files); incomplete.delete(BUNDLE_NAMES[0]); assert.throws(() => computeBundleFingerprint(incomplete), rejected);
  const changed = new Map(files); changed.set(BUNDLE_NAMES[0], Buffer.from("changed")); assert.notEqual(computeBundleFingerprint(changed), computeBundleFingerprint(files));
});

test("production path and source pins cannot be overridden without explicit internal test dependencies", async () => {
  await assert.rejects(run({ ...DEFAULTS, sourceCheckout: repository }), { code: "VIDEO180_SOURCE_PIN" });
  let loaded = false;
  await assert.rejects(run(DEFAULTS, { assertSources: async () => { throw Object.assign(new Error(), { code: "VIDEO180_SOURCE_PIN" }); },
    loadApis: async () => { loaded = true; } }), { code: "VIDEO180_SOURCE_PIN" });
  assert.equal(loaded, false);
});

test("real preparation preserves six exact files, creates only an independent key and empty0700 root, and reports one digest", { skip: !available }, async t => {
  const f = await fixture(t), generated = Buffer.alloc(32, 7);
  const report = await run(f.options, { ...f.dependencies, random: () => generated });
  assert.equal(report.status, "video180_runtime_prepared"); assert.equal(report.files, 7);
  assert.deepEqual(report.quotas, { ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "536870912" });
  for (const name of ["sqlConnected", "schemaInitialized", "runtimeStarted", "managerChanged", "checkpointChanged"]) assert.equal(report[name], false);
  assert.equal(report.existingConfigurationsByteExact, true); assert.equal(report.independentVideoKey, true);
  assert.equal(generated.every(byte => byte === 0), true);
  await unchanged(f); assert.deepEqual((await readdir(f.options.targetDirectory)).sort(), BUNDLE_NAMES);
  const files = new Map();
  for (const name of BUNDLE_NAMES) {
    const path = join(f.options.targetDirectory, name), stat = await lstat(path); files.set(name, await readFile(path));
    assert.equal(stat.mode & 0o7777, 0o600); assert.equal(stat.nlink, 1); assert.equal(stat.uid, process.getuid());
    if (f.before.has(name)) assert.deepEqual(files.get(name), f.before.get(name));
  }
  assert.equal(report.bundleFingerprintSha256, computeBundleFingerprint(files));
  const back = await apis.readRuntimeVideoBundle(f.options.targetDirectory, primary);
  assert.equal(back.video.videoKey, privateFixture.key(7)); assert.equal(back.video.videoRoot, f.options.videoRoot);
  assert.deepEqual(back.crm, f.records.crm); assert.deepEqual(await readdir(f.options.videoRoot), []);
  assert.equal((await lstat(f.options.videoRoot)).mode & 0o7777, 0o700); assert.equal((await lstat(f.options.targetDirectory)).mode & 0o7777, 0o700);
  const serialized = JSON.stringify(report); assert.equal(serialized.includes(privateFixture.key(7)), false); assert.equal(serialized.includes(f.records.database.password), false);
  assert.equal(Object.keys(report).filter(name => /sha256/i.test(name)).length, 1);
});

test("either pre-existing destination or symlink refuses preparation before randomness and preserves every entry", { skip: !available }, async t => {
  for (const kind of ["bundle", "video", "symlink"]) {
    const f = await fixture(t), destination = kind === "video" ? f.options.videoRoot : f.options.targetDirectory;
    if (kind === "symlink") await symlink(f.directory, destination); else await mkdir(destination, { mode: 0o700 });
    let generated = false;
    await assert.rejects(run(f.options, { ...f.dependencies, random() { generated = true; throw Error(); } }), { code: "VIDEO180_EXISTS" });
    assert.equal(generated, false); await unchanged(f); assert.ok(await lstat(destination));
    await missing(kind === "video" ? f.options.targetDirectory : f.options.videoRoot);
  }
});

test("root overlap, malformed quota and every existing private-key reuse fail before publication", { skip: !available }, async t => {
  for (const change of [f => ({ ...f.options, videoRoot: join(f.records.media.mediaRoot, "nested") }), f => ({ ...f.options, totalBytes: "65" })]) {
    const f = await fixture(t); await assert.rejects(run(change(f), f.dependencies), rejected);
    await missing(f.options.targetDirectory); await missing(f.options.videoRoot); await unchanged(f);
  }
  const source = privateFixture.bundle();
  for (const reused of [source.authentication.mfaKey, source.messaging.mailKey, source.messaging.messageKey, source.media.mediaKey,
    source.notifications.notificationKey, source.notifications.vapidPrivateKey, source.crm.crmKey]) {
    const f = await fixture(t), generated = Buffer.from(reused, "base64url");
    await assert.rejects(run(f.options, { ...f.dependencies, random: () => generated }), rejected);
    assert.equal(generated.every(byte => byte === 0), true); await missing(f.options.targetDirectory); await missing(f.options.videoRoot);
  }
});

test("unsafe source file modes, hardlinks and symlinks are refused before destination publication", { skip: !available }, async t => {
  for (const kind of ["mode", "hardlink", "symlink"]) {
    const f = await fixture(t), name = join(f.directory, "runtime-crm.json"), alias = join(f.root, "alias");
    if (kind === "mode") await chmod(name, 0o640);
    else if (kind === "hardlink") await link(name, alias);
    else { await writeFile(alias, f.before.get("runtime-crm.json"), { mode: 0o600 }); await unlink(name); await symlink(alias, name); }
    await assert.rejects(run(f.options, f.dependencies), rejected); await missing(f.options.targetDirectory); await missing(f.options.videoRoot);
  }
});

test("failed seventh-file publication preserves its ambiguous destinations and a retry refuses them", { skip: !available }, async t => {
  const f = await fixture(t), supplied = { ...f.dependencies, loadApis: async () => ({ ...apis, async writeRuntimeVideoConfiguration() { throw Error("synthetic publication failure"); } }) };
  await assert.rejects(run(f.options, supplied), error => rejected(error) && error.rootCreated && error.bundleCreated && error.publishedTargetsPreserved && error.noAutomaticRetry);
  assert.deepEqual((await readdir(f.options.targetDirectory)).sort(), BASE_NAMES); assert.deepEqual(await readdir(f.options.videoRoot), []); await unchanged(f);
  let generated = false; await assert.rejects(run(f.options, { ...f.dependencies, random() { generated = true; } }), { code: "VIDEO180_EXISTS" }); assert.equal(generated, false);
});

test("source byte drift after publication is detected without deleting candidate or source evidence", { skip: !available }, async t => {
  const f = await fixture(t), supplied = { ...f.dependencies, loadApis: async () => ({ ...apis, async writeRuntimeVideoConfiguration(...args) {
    const result = await apis.writeRuntimeVideoConfiguration(...args);
    await writeFile(join(f.directory, "runtime-crm.json"), `${JSON.stringify(f.records.crm)}\n`, { mode: 0o600 }); return result;
  } }) };
  await assert.rejects(run(f.options, supplied), { code: "VIDEO180_SOURCE_CHANGED" });
  assert.deepEqual((await readdir(f.options.targetDirectory)).sort(), BUNDLE_NAMES); assert.deepEqual(await readdir(f.options.videoRoot), []);
  assert.deepEqual(await readFile(join(f.options.targetDirectory, "runtime-crm.json")), f.before.get("runtime-crm.json"));
});
