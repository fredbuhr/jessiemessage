import test from "node:test";
import assert from "node:assert/strict";
import filesystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createMediaStorage, MediaStorageError } from "../server/media/storage.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.resolve(repo, "../audit");
const procAvailable = process.platform === "linux" && await filesystem.statfs("/proc/self/fd", { bigint: true })
  .then((stats) => stats.type === 0x9fa0n, () => false);
const linux = { skip: procAvailable ? false : "Linux procfs /proc/self/fd is unavailable in this runtime; CI Linux executes these real-filesystem tests." };
const input = () => ({ assetId: randomBytes(16), storageKey: randomBytes(32), full: Buffer.from("dirfd-private-full-image"), thumbnail: Buffer.from("dirfd-private-thumbnail-image") });
const filename = (root, storageKey, variant) => path.join(root, `${storageKey.toString("hex")}.${variant}.enc`);
const unavailable = (promise) => assert.rejects(promise, (error) => error instanceof MediaStorageError
  && error.code === "MEDIA_UNAVAILABLE" && error.cause === undefined && !error.message.includes(base));
async function collect(iterator) { const result = []; for await (const item of iterator) result.push(item); return result; }

async function fixture(t) {
  await filesystem.mkdir(base, { recursive: true, mode: 0o700 });
  const parent = await filesystem.mkdtemp(path.join(base, "media-dirfd-"));
  const root = path.join(parent, "private");
  const moved = `${parent}-moved`;
  await filesystem.mkdir(root, { mode: 0o700 });
  t.after(async () => { await filesystem.rm(parent, { recursive: true, force: true }); await filesystem.rm(moved, { recursive: true, force: true }); });
  const key = randomBytes(32);
  const storage = await createMediaStorage({ root, key, pathMode: "linux-dirfd" });
  return { parent, root, moved, key, storage };
}

async function replaceParent({ parent, root, moved }) {
  await filesystem.rename(parent, moved);
  await filesystem.mkdir(parent, { mode: 0o700 });
  await filesystem.mkdir(root, { mode: 0o700 });
}

// Built-in ESM bindings are refreshed only inside this test process. The hook
// changes the parent at a precise syscall boundary, after the directory is open.
async function intercept(t, name, before, action) {
  const original = filesystem[name];
  const mocked = t.mock.method(filesystem, name, async (...args) => { await before(...args); return original(...args); });
  syncBuiltinESMExports();
  try { return await action(); }
  finally { mocked.mock.restore(); syncBuiltinESMExports(); }
}

test("media path mode accepts only explicit supported values", async () => {
  for (const pathMode of ["", "dirfd", true, null, {}]) {
    await assert.rejects(createMediaStorage({ root: path.join(base, "not-opened"), key: randomBytes(32), pathMode }),
      (error) => error instanceof MediaStorageError && error.code === "MEDIA_INPUT");
  }
});

test("Linux dirfd media keeps owner-private GCM envelopes, identities and inspection behavior", linux, async (t) => {
  const { root, key, storage } = await fixture(t), asset = input();
  const strict = await createMediaStorage({ root, key });
  assert.deepEqual(await storage.fingerprint(), await strict.fingerprint());
  assert.deepEqual(await storage.rootIdentity(), await strict.rootIdentity());
  await storage.put(asset);
  assert.equal((await filesystem.stat(root)).mode & 0o777, 0o700);
  for (const [variant, plaintext] of [["full", asset.full], ["thumb", asset.thumbnail]]) {
    const target = filename(root, asset.storageKey, variant);
    assert.equal((await filesystem.stat(target)).mode & 0o777, 0o600);
    assert.equal((await filesystem.stat(target)).nlink, 1);
    const encrypted = await filesystem.readFile(target);
    assert.ok(!encrypted.includes(plaintext));
    assert.deepEqual(await storage.get({ ...asset, variant }), plaintext);
    assert.equal((await storage.inspectEntry({ storageKey: asset.storageKey, variant })).status, "structural_ok");
    encrypted[encrypted.length - 1] ^= 1;
    await filesystem.writeFile(target, encrypted);
    await unavailable(storage.get({ ...asset, variant }));
  }
  assert.equal((await collect(storage.scanEntries())).length, 2);
  assert.equal(typeof (await storage.availableSpace()).availableBytes, "bigint");
  await storage.remove(asset); await storage.remove(asset);
  assert.deepEqual(await filesystem.readdir(root), []);
});

test("Linux dirfd media rejects an ancestor replaced between public operations", linux, async (t) => {
  const fixtureValue = await fixture(t), { root, storage } = fixtureValue, asset = input();
  await storage.put(asset);
  await replaceParent(fixtureValue);
  const replacement = Buffer.from("replacement-must-never-be-opened-or-removed");
  await filesystem.writeFile(filename(root, asset.storageKey, "full"), replacement, { mode: 0o600 });
  await unavailable(storage.assertReady()); await unavailable(storage.fingerprint());
  await unavailable(storage.rootIdentity()); await unavailable(storage.availableSpace());
  await unavailable(storage.get({ ...asset, variant: "full" }));
  await unavailable(storage.put(input())); await unavailable(storage.remove(asset));
  await unavailable(storage.inspectEntry({ storageKey: asset.storageKey, variant: "full" }));
  await unavailable(collect(storage.scanEntries()));
  assert.deepEqual(await filesystem.readFile(filename(root, asset.storageKey, "full")), replacement);
  assert.equal((await filesystem.readdir(root)).length, 1);
});

test("Linux dirfd publication and cleanup remain anchored when an ancestor changes before link", linux, async (t) => {
  const fixtureValue = await fixture(t), { root, moved, storage } = fixtureValue, asset = input();
  let replaced = false;
  await intercept(t, "link", async (source, destination) => {
    assert.match(source, /^\/proc\/self\/fd\/\d+\/\.[a-f0-9]+\.(?:full|thumb)\.[a-f0-9]+\.tmp$/);
    assert.match(destination, /^\/proc\/self\/fd\/\d+\/[a-f0-9]+\.(?:full|thumb)\.enc$/);
    if (!replaced) { replaced = true; await replaceParent(fixtureValue); }
  }, async () => { await storage.put(asset); });
  assert.equal(replaced, true);
  assert.deepEqual(await filesystem.readdir(root), []);
  const anchoredRoot = path.join(moved, "private");
  assert.equal((await filesystem.readdir(anchoredRoot)).length, 2);
  for (const variant of ["full", "thumb"]) {
    const target = filename(anchoredRoot, asset.storageKey, variant);
    assert.equal((await filesystem.stat(target)).mode & 0o777, 0o600);
    assert.ok(!(await filesystem.readFile(target)).includes(asset.full));
  }
  await unavailable(storage.assertReady());
});

test("Linux dirfd failed publication cleans only anchored files after parent replacement", linux, async (t) => {
  const fixtureValue = await fixture(t), { root, moved, storage } = fixtureValue, asset = input();
  const sentinel = Buffer.from("existing-encrypted-thumb-sentinel");
  await filesystem.writeFile(filename(root, asset.storageKey, "thumb"), sentinel, { mode: 0o600 });
  let replaced = false;
  await intercept(t, "link", async () => {
    if (!replaced) { replaced = true; await replaceParent(fixtureValue); }
  }, async () => { await unavailable(storage.put(asset)); });
  assert.equal(replaced, true);
  assert.deepEqual(await filesystem.readdir(root), []);
  const anchoredRoot = path.join(moved, "private");
  assert.deepEqual(await filesystem.readdir(anchoredRoot), [path.basename(filename(root, asset.storageKey, "thumb"))]);
  assert.deepEqual(await filesystem.readFile(filename(anchoredRoot, asset.storageKey, "thumb")), sentinel);
});

test("Linux dirfd removal cannot unlink replacement files during a parent rename", linux, async (t) => {
  const fixtureValue = await fixture(t), { root, moved, storage } = fixtureValue, asset = input();
  await storage.put(asset);
  let replaced = false;
  await intercept(t, "unlink", async (target) => {
    assert.match(target, /^\/proc\/self\/fd\/\d+\/[a-f0-9]+\.(?:full|thumb)\.enc$/);
    if (!replaced) {
      replaced = true; await replaceParent(fixtureValue);
      for (const variant of ["full", "thumb"]) await filesystem.writeFile(filename(root, asset.storageKey, variant), "replacement-sentinel", { mode: 0o600 });
    }
  }, async () => { await storage.remove(asset); });
  assert.equal(replaced, true);
  assert.deepEqual(await filesystem.readdir(path.join(moved, "private")), []);
  for (const variant of ["full", "thumb"]) assert.equal(await filesystem.readFile(filename(root, asset.storageKey, variant), "utf8"), "replacement-sentinel");
});

test("Linux dirfd scan stays pinned across yields and closes its descriptors on return, abort and failure", linux, async (t) => {
  const fixtureValue = await fixture(t), { root, storage } = fixtureValue;
  await storage.put(input()); await storage.put(input());
  const baseline = (await filesystem.readdir("/proc/self/fd")).length;
  const early = storage.scanEntries(); await early.next();
  assert.ok((await filesystem.readdir("/proc/self/fd")).length > baseline);
  await early.return();
  assert.equal((await filesystem.readdir("/proc/self/fd")).length, baseline);
  const aborted = new AbortController(), iterator = storage.scanEntries({ signal: aborted.signal });
  await iterator.next(); aborted.abort(); await unavailable(iterator.next());
  assert.equal((await filesystem.readdir("/proc/self/fd")).length, baseline);
  await assert.rejects(collect(storage.scanEntries({ maxEntries: 1 })), (error) => error.code === "MEDIA_SCAN_LIMIT");
  assert.equal((await filesystem.readdir("/proc/self/fd")).length, baseline);
  const pinned = storage.scanEntries(), first = await pinned.next();
  await replaceParent(fixtureValue);
  await filesystem.writeFile(path.join(root, "replacement-private-name"), "never-scanned", { mode: 0o600 });
  const remaining = await collect(pinned);
  assert.equal(first.done, false); assert.equal(remaining.length, 3);
  assert.ok(remaining.every((entry) => entry.kind === "published"));
  assert.equal((await filesystem.readdir("/proc/self/fd")).length, baseline);
});

test("Linux dirfd media isolates concurrent public scopes and does not retain descriptors", linux, async (t) => {
  const { storage } = await fixture(t), baseline = (await filesystem.readdir("/proc/self/fd")).length;
  const assets = Array.from({ length: 8 }, input);
  await Promise.all(assets.map((asset) => storage.put(asset)));
  await Promise.all(assets.map(async (asset) => {
    assert.deepEqual(await storage.get({ ...asset, variant: "full" }), asset.full);
    assert.equal((await storage.inspectEntry({ storageKey: asset.storageKey, variant: "thumb" })).status, "structural_ok");
  }));
  const winner = input(), loser = { ...winner, full: Buffer.from("other-full"), thumbnail: Buffer.from("other-thumb") };
  const results = await Promise.allSettled([storage.put(winner), storage.put(loser)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const expected = results[0].status === "fulfilled" ? winner : loser;
  assert.deepEqual(await storage.get({ ...expected, variant: "full" }), expected.full);
  assert.deepEqual(await storage.get({ ...expected, variant: "thumb" }), expected.thumbnail);
  await Promise.all(assets.map((asset) => storage.remove(asset)));
  assert.equal((await collect(storage.scanEntries())).length, 2);
  assert.equal((await filesystem.readdir("/proc/self/fd")).length, baseline);
});

test("Linux dirfd media still rejects symlink roots, unsafe files and root permission drift", linux, async (t) => {
  const { parent, root, key, storage } = await fixture(t), asset = input();
  const alias = path.join(parent, "alias"); await filesystem.symlink(root, alias);
  await unavailable(createMediaStorage({ root: alias, key, pathMode: "linux-dirfd" }));
  await storage.put(asset);
  const target = filename(root, asset.storageKey, "full");
  await filesystem.chmod(target, 0o644); await unavailable(storage.get({ ...asset, variant: "full" }));
  await filesystem.chmod(target, 0o600);
  await filesystem.link(target, path.join(root, "unrelated-hardlink"));
  await unavailable(storage.get({ ...asset, variant: "full" })); await unavailable(storage.remove(asset));
  await filesystem.unlink(path.join(root, "unrelated-hardlink"));
  await filesystem.unlink(target); await filesystem.symlink(filename(root, asset.storageKey, "thumb"), target);
  await unavailable(storage.get({ ...asset, variant: "full" })); await unavailable(storage.remove(asset));
  await filesystem.chmod(root, 0o750);
  await unavailable(storage.assertReady()); await unavailable(storage.availableSpace()); await unavailable(collect(storage.scanEntries()));
  await filesystem.chmod(root, 0o700);
});
