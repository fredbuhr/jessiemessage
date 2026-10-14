import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile, readdir, chmod, stat, symlink, unlink, mkdir, rename, link, truncate } from "node:fs/promises";
import { createMediaStorage, MediaStorageError } from "../server/media/storage.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.resolve(repo, "../audit");
const input = () => ({ assetId: randomBytes(16), storageKey: randomBytes(32), full: Buffer.from("private-secret-normalized-full-jpeg-bytes"), thumbnail: Buffer.from("private-secret-normalized-thumbnail-jpeg-bytes") });
const filename = (root, storageKey, variant) => path.join(root, `${storageKey.toString("hex")}.${variant}.enc`);
const unavailable = (promise) => assert.rejects(promise, (error) => error instanceof MediaStorageError && error.code === "MEDIA_UNAVAILABLE"
  && error.cause === undefined && !error.message.includes(base) && !error.message.includes("secret"));
async function fixture(t) {
  const root = await mkdtemp(path.join(base, "media-storage-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = randomBytes(32);
  return { root, key, storage: await createMediaStorage({ root, key }) };
}

test("private storage publishes only encrypted owner-private files and round-trips both variants", async (t) => {
  const { root, storage } = await fixture(t); const asset = input();
  await storage.put(asset); await storage.assertReady();
  assert.deepEqual((await readdir(root)).sort(), [filename(root, asset.storageKey, "full"), filename(root, asset.storageKey, "thumb")].map((p) => path.basename(p)).sort());
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  for (const [variant, plaintext] of [["full", asset.full], ["thumb", asset.thumbnail]]) {
    const file = filename(root, asset.storageKey, variant);
    assert.equal((await stat(file)).mode & 0o777, 0o600); assert.equal((await stat(file)).nlink, 1);
    const ciphertext = await readFile(file);
    assert.ok(!ciphertext.includes(plaintext)); assert.ok(!ciphertext.includes(Buffer.from("private-secret")));
    assert.deepEqual(await storage.get({ ...asset, variant }), plaintext);
  }
});

test("independent random nonces prevent equal normalized photos revealing equal ciphertext", async (t) => {
  const { root, storage } = await fixture(t); const first = input(); const second = { ...first, assetId: randomBytes(16), storageKey: randomBytes(32) };
  await storage.put(first); await storage.put(second);
  assert.notDeepEqual(await readFile(filename(root, first.storageKey, "full")), await readFile(filename(root, second.storageKey, "full")));
});

test("file authentication binds the key, asset identity and full/thumb variant", async (t) => {
  const { root, storage } = await fixture(t); const asset = input(); await storage.put(asset);
  await unavailable(storage.get({ ...asset, assetId: randomBytes(16), variant: "full" }));
  const wrongKey = await createMediaStorage({ root, key: randomBytes(32) }); await unavailable(wrongKey.get({ ...asset, variant: "full" }));
  const fullEnvelope = await readFile(filename(root, asset.storageKey, "full"));
  await writeFile(filename(root, asset.storageKey, "thumb"), fullEnvelope);
  await unavailable(storage.get({ ...asset, variant: "thumb" }));
});

test("tampering, truncation and unsupported envelope versions fail without decoder or path details", async (t) => {
  const { root, storage } = await fixture(t);
  for (const change of [(bytes) => { bytes[20] ^= 1; return bytes; }, (bytes) => bytes.subarray(0, -1), (bytes) => { bytes[0] = 0; return bytes; }, (bytes) => { bytes[bytes.length - 1] ^= 1; return bytes; }]) {
    const asset = input(); await storage.put(asset); const target = filename(root, asset.storageKey, "full");
    await writeFile(target, change(await readFile(target)));
    await unavailable(storage.get({ ...asset, variant: "full" }));
  }
});

test("exclusive publication never overwrites an existing asset or leaves plaintext staging files", async (t) => {
  const { root, storage } = await fixture(t); const asset = input(); await storage.put(asset);
  const previous = await readFile(filename(root, asset.storageKey, "full"));
  await unavailable(storage.put({ ...asset, full: Buffer.from("different-secret-full") }));
  assert.deepEqual(await readFile(filename(root, asset.storageKey, "full")), previous);
  assert.equal((await readdir(root)).length, 2); assert.deepEqual(await storage.get({ ...asset, variant: "thumb" }), asset.thumbnail);
});

test("partial publication failure cleans only this call's new files and preserves a conflicting destination", async (t) => {
  const { root, storage } = await fixture(t); const asset = input();
  const existing = Buffer.from("already-stored-encrypted-sentinel"); const target = filename(root, asset.storageKey, "thumb");
  await writeFile(target, existing, { mode: 0o600, flag: "wx" });
  await unavailable(storage.put(asset));
  assert.deepEqual(await readFile(target), existing);
  assert.deepEqual(await readdir(root), [path.basename(target)]);
});

test("concurrent writers for one storage key produce one complete winning asset", async (t) => {
  const { storage } = await fixture(t); const first = input(); const second = { ...first, full: Buffer.from("second-private-secret-full"), thumbnail: Buffer.from("second-private-secret-thumb") };
  const results = await Promise.allSettled([storage.put(first), storage.put(second)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const winner = results[0].status === "fulfilled" ? first : second;
  assert.deepEqual(await storage.get({ ...winner, variant: "full" }), winner.full);
  assert.deepEqual(await storage.get({ ...winner, variant: "thumb" }), winner.thumbnail);
});

test("storage requires an existing canonical absolute private root outside the checkout", async (t) => {
  const { root, key } = await fixture(t);
  for (const candidate of ["relative", `${root}/`, `${root}/../${path.basename(root)}`, "/", path.join(repo, "public/private"), path.dirname(repo), `${root}\0secret`]) {
    await assert.rejects(createMediaStorage({ root: candidate, key }), (error) => error.code === "MEDIA_INPUT");
  }
  await unavailable(createMediaStorage({ root: path.join(root, "not-created"), key }));
  await chmod(root, 0o755); await unavailable(createMediaStorage({ root, key })); await chmod(root, 0o700);
  for (const invalidKey of [null, "secret", Buffer.alloc(31), Buffer.alloc(33)]) {
    await assert.rejects(createMediaStorage({ root, key: invalidKey }), (error) => error.code === "MEDIA_INPUT");
  }
});

test("symlink roots and ancestors are refused rather than followed", async (t) => {
  const { root, key } = await fixture(t); const nested = path.join(root, "nested"); await mkdir(nested, { mode: 0o700 });
  const alias = path.join(root, "alias"); await symlink(nested, alias);
  await unavailable(createMediaStorage({ root: alias, key }));
  await mkdir(path.join(nested, "child"), { mode: 0o700 });
  await unavailable(createMediaStorage({ root: path.join(alias, "child"), key }));
});

test("a writable non-sticky ancestor cannot redirect the private storage root", async (t) => {
  const { root, key } = await fixture(t); const writable = path.join(root, "writable");
  await mkdir(writable, { mode: 0o700 }); await chmod(writable, 0o777);
  const nested = path.join(writable, "private"); await mkdir(nested, { mode: 0o700 });
  await unavailable(createMediaStorage({ root: nested, key }));
  await chmod(writable, 0o1777);
  const storage = await createMediaStorage({ root: nested, key }); await storage.assertReady();
});

test("runtime root replacement and permission drift close the storage instead of changing its location", async (t) => {
  const { root, storage } = await fixture(t); const asset = input(); await storage.put(asset);
  await chmod(root, 0o750); await unavailable(storage.get({ ...asset, variant: "full" })); await chmod(root, 0o700);
  const previous = `${root}-previous`; t.after(() => rm(previous, { recursive: true, force: true }));
  await rename(root, previous); await mkdir(root, { mode: 0o700 });
  await unavailable(storage.assertReady()); await unavailable(storage.put(input())); await unavailable(storage.remove(asset));
  assert.deepEqual(await readdir(root), []);
});

test("symlinks, hard links and public file modes are rejected by reads and removal", async (t) => {
  const { root, storage } = await fixture(t); const asset = input(); await storage.put(asset); const target = filename(root, asset.storageKey, "full");
  await chmod(target, 0o644); await unavailable(storage.get({ ...asset, variant: "full" })); await chmod(target, 0o600);
  const alias = path.join(root, "unrelated-hard-link"); await link(target, alias);
  await unavailable(storage.get({ ...asset, variant: "full" })); await unavailable(storage.remove(asset)); await unlink(alias);
  await unlink(target); await symlink(filename(root, asset.storageKey, "thumb"), target);
  await unavailable(storage.get({ ...asset, variant: "full" })); await unavailable(storage.remove(asset));
  assert.equal((await readdir(root)).length, 2);
});

test("bounded regular-file reads reject oversized envelopes before allocating their contents", async (t) => {
  const { root, storage } = await fixture(t); const asset = input(); await storage.put(asset);
  await truncate(filename(root, asset.storageKey, "full"), 10 * 1024 * 1024 + 41);
  await unavailable(storage.get({ ...asset, variant: "full" }));
  await truncate(filename(root, asset.storageKey, "thumb"), 512 * 1024 + 41);
  await unavailable(storage.get({ ...asset, variant: "thumb" }));
});

test("asset removal is idempotent and never scans or deletes unrelated files", async (t) => {
  const { root, storage } = await fixture(t); const asset = input(); await storage.put(asset);
  const sentinel = path.join(root, "unknown-private-encrypted-orphan.enc"); await writeFile(sentinel, "leave-me", { mode: 0o600 });
  await storage.remove(asset); await storage.remove(asset);
  assert.deepEqual(await readdir(root), [path.basename(sentinel)]); assert.equal(await readFile(sentinel, "utf8"), "leave-me");
  await unavailable(storage.get({ ...asset, variant: "full" }));
});

test("storage APIs accept only fixed-length opaque Buffer identifiers and bounded variants", async (t) => {
  const { storage } = await fixture(t); const asset = input();
  for (const invalidAsset of [{ ...asset, assetId: "../secret" }, { ...asset, storageKey: Buffer.alloc(31) }, { ...asset, full: Buffer.alloc(0) }, { ...asset, thumbnail: Buffer.alloc(512 * 1024 + 1) }]) {
    await assert.rejects(storage.put(invalidAsset), (error) => error.code === "MEDIA_INPUT");
  }
  await assert.rejects(storage.get({ ...asset, variant: "../../private" }), (error) => error.code === "MEDIA_INPUT");
  await assert.rejects(storage.remove({ storageKey: "../secret" }), (error) => error.code === "MEDIA_INPUT");
});
