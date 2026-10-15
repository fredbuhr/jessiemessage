import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { randomBytes } from "node:crypto";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rename, rm, statfs, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BackupManifestError, createBackupManifest, manifestHash, readManifest, verifyBackupManifest, writeManifest } from "../server/backup/manifest.mjs";

const supported = process.platform === "linux" && await statfs("/proc/self/fd", { bigint: true }).then((value) => value.type === 0x9fa0n, () => false);
const options = { pathMode: "linux-dirfd" };
const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../audit");
const unavailable = (error) => error instanceof BackupManifestError && error.code === "BACKUP_MANIFEST_UNAVAILABLE"
  && error.message === "Private backup manifest operation failed." && error.cause === undefined && !Object.hasOwn(error, "path");
async function fixture(t) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "backup-manifest-dirfd-")), parent = path.join(root, "private");
  await mkdir(parent, { mode: 0o700 });
  t.after(() => rm(root, { recursive: true, force: true }));
  const keys = Object.fromEntries(["totpKey", "mailKey", "messageKey", "mediaKey", "crmKey"].map((name) => [name, randomBytes(32)]));
  const manifest = createBackupManifest({ keys, now: 1750000000000, snapshot: { rows: [], version: 1 },
    identity: { databaseTag: "1".repeat(64), rootPathTag: "2".repeat(64), rootPhysicalTag: "3".repeat(64), rootFingerprint: "4".repeat(64), rootAncestors: ["5".repeat(64)] } });
  return { root, parent, filename: path.join(parent, "backup.manifest.json"), manifest, keys };
}
async function hookOpen(callback, operation) {
  const original = fs.promises.open;
  fs.promises.open = async (...args) => callback(original, args);
  syncBuiltinESMExports();
  try { return await operation(); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
}

test("dirfd manifests preserve canonical authenticated bytes, private modes and exclusive publication", { skip: !supported }, async (t) => {
  const f = await fixture(t);
  await writeManifest(f.filename, f.manifest, options);
  assert.deepEqual(await readManifest(f.filename, options), f.manifest);
  assert.deepEqual(verifyBackupManifest({ manifest: await readManifest(f.filename, options), keys: f.keys }).snapshot, { rows: [], version: 1 });
  assert.equal(manifestHash(await readManifest(f.filename, options)), manifestHash(f.manifest));
  const original = await readFile(f.filename), metadata = await lstat(f.filename);
  assert.equal(metadata.mode & 0o7777, 0o600); assert.equal(metadata.nlink, 1);
  await assert.rejects(writeManifest(f.filename, f.manifest, options), unavailable);
  assert.deepEqual(await readFile(f.filename), original);
});

test("dirfd manifest writes stay in the anchored parent when its pathname is replaced immediately before open", { skip: !supported }, async (t) => {
  const f = await fixture(t), previous = f.parent + "-original";
  let replaced = false;
  await hookOpen(async (original, args) => {
    if (!replaced && String(args[0]).startsWith("/proc/self/fd/") && path.basename(String(args[0])) === path.basename(f.filename)) {
      replaced = true; await rename(f.parent, previous); await mkdir(f.parent, { mode: 0o700 });
      await writeFile(f.filename, "foreign-file-keep", { mode: 0o600 });
    }
    return original(...args);
  }, () => writeManifest(f.filename, f.manifest, options));
  assert.equal(replaced, true);
  assert.equal(await readFile(f.filename, "utf8"), "foreign-file-keep");
  assert.deepEqual(await readManifest(path.join(previous, path.basename(f.filename)), options), f.manifest);
});

test("dirfd manifest reads use their anchored parent after a rename and ignore replacement bytes", { skip: !supported }, async (t) => {
  const f = await fixture(t), previous = f.parent + "-original";
  await writeManifest(f.filename, f.manifest, options); let replaced = false;
  const result = await hookOpen(async (original, args) => {
    if (!replaced && String(args[0]).startsWith("/proc/self/fd/") && path.basename(String(args[0])) === path.basename(f.filename)) {
      replaced = true; await rename(f.parent, previous); await mkdir(f.parent, { mode: 0o700 });
      await writeFile(f.filename, "foreign-invalid-json", { mode: 0o600 });
    }
    return original(...args);
  }, () => readManifest(f.filename, options));
  assert.equal(replaced, true); assert.deepEqual(result, f.manifest);
  assert.equal(await readFile(f.filename, "utf8"), "foreign-invalid-json");
});

test("dirfd manifests reject symlinks, hard links, unsafe parents and an invalid mode without overwriting foreign files", { skip: !supported }, async (t) => {
  const f = await fixture(t), target = path.join(f.root, "foreign");
  await writeFile(target, "foreign-keep", { mode: 0o600 }); await symlink(target, f.filename);
  await assert.rejects(writeManifest(f.filename, f.manifest, options), unavailable); await assert.rejects(readManifest(f.filename, options), unavailable);
  await unlink(f.filename); await link(target, f.filename);
  await assert.rejects(readManifest(f.filename, options), unavailable); await assert.rejects(writeManifest(f.filename, f.manifest, options), unavailable);
  await unlink(f.filename); assert.equal(await readFile(target, "utf8"), "foreign-keep");
  const alias = path.join(f.root, "alias"); await symlink(f.parent, alias);
  await assert.rejects(writeManifest(path.join(alias, "new.json"), f.manifest, options), unavailable);
  await chmod(f.parent, 0o750); await assert.rejects(writeManifest(f.filename, f.manifest, options), unavailable); await chmod(f.parent, 0o700);
  await assert.rejects(writeManifest(f.filename, f.manifest, { pathMode: "fallback" }), unavailable);
  await assert.rejects(lstat(f.filename), { code: "ENOENT" });
});

test("concurrent dirfd manifest publication has one winner and closes every directory and file descriptor", { skip: !supported }, async (t) => {
  const f = await fixture(t); let opened = 0, closed = 0;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle); opened += 1;
    handle.close = async () => { await close(); closed += 1; }; return handle;
  }, async () => {
    const results = await Promise.allSettled([writeManifest(f.filename, f.manifest, options), writeManifest(f.filename, f.manifest, options)]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected" && unavailable(result.reason)).length, 1);
    assert.deepEqual(await readManifest(f.filename, options), f.manifest);
  });
  assert.ok(opened > 3); assert.equal(closed, opened);
});

test("dirfd manifest failures close all anchored ancestors and expose only the public error", { skip: !supported }, async (t) => {
  const f = await fixture(t); let opened = 0, closed = 0, injected = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle); opened += 1;
    handle.close = async () => { await close(); closed += 1; };
    if (String(args[0]).endsWith("/backup.manifest.json")) handle.sync = async () => { injected = true; throw new Error("private-secret-sync-failure"); };
    return handle;
  }, () => assert.rejects(writeManifest(f.filename, f.manifest, options), unavailable));
  assert.equal(injected, true); assert.equal(closed, opened);
});


test("an invalid anchored basename closes its directory chain before returning the masked error", { skip: !supported }, async (t) => {
  const f = await fixture(t); let opened = 0, closed = 0;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle); opened += 1;
    handle.close = async () => { await close(); closed += 1; }; return handle;
  }, async () => {
    for (const name of ["private\nmanifest.json", "private\\manifest.json"]) {
      await assert.rejects(writeManifest(path.join(f.parent, name), f.manifest, options), unavailable);
      await assert.rejects(readManifest(path.join(f.parent, name), options), unavailable);
    }
  });
  assert.ok(opened > 0); assert.equal(closed, opened);
});
