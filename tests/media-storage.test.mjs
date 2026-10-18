import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile, readdir, chmod, stat, symlink, unlink, mkdir, rename, link, truncate } from "node:fs/promises";
import { createMediaStorage, MediaStorageError } from "../server/media/storage.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.resolve(repo, "../audit");
const input = () => ({ assetId: randomBytes(16), storageKey: randomBytes(32), full: Buffer.from("private-secret-normalized-full-jpeg-bytes"), thumbnail: Buffer.from("private-secret-normalized-thumbnail-jpeg-bytes") });
const filename = (root, storageKey, variant) => path.join(root, `${storageKey.toString("hex")}.${variant}.enc`);
const unavailable = (promise) => assert.rejects(promise, (error) => error instanceof MediaStorageError && error.code === "MEDIA_UNAVAILABLE"
  && error.cause === undefined && !error.message.includes(base) && !error.message.includes("secret"));
async function fixture(t) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "media-storage-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const key = randomBytes(32);
  return { root, key, storage: await createMediaStorage({ root, key }) };
}
async function collect(iterator) { const entries = []; for await (const entry of iterator) entries.push(entry); return entries; }

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

test("storage fingerprints bind the private root identity and key without exposing a path", async (t) => {
  const { root, key, storage } = await fixture(t), first = await storage.fingerprint();
  assert.ok(Buffer.isBuffer(first)); assert.equal(first.length, 32);
  assert.deepEqual(await storage.fingerprint(), first);
  assert.deepEqual(await (await createMediaStorage({ root, key })).fingerprint(), first);
  assert.notDeepEqual(await (await createMediaStorage({ root, key: randomBytes(32) })).fingerprint(), first);
  const other = await fixture(t);
  assert.notDeepEqual(await (await createMediaStorage({ root: other.root, key })).fingerprint(), first);
  first.fill(0); assert.notDeepEqual(await storage.fingerprint(), first);
});

test("available storage space is a nonnegative bigint and inventory APIs refuse private-root drift", async (t) => {
  const { root, storage } = await fixture(t), free = await storage.availableSpace();
  assert.deepEqual(Object.keys(free), ["availableBytes"]); assert.equal(typeof free.availableBytes, "bigint"); assert.ok(free.availableBytes >= 0n);
  await chmod(root, 0o750);
  await unavailable(storage.fingerprint()); await unavailable(storage.availableSpace()); await unavailable(collect(storage.scanEntries()));
  await unavailable(storage.inspectEntry({ storageKey: randomBytes(32), variant: "full" }));
  await chmod(root, 0o700);
  const previous = `${root}-previous`; t.after(() => rm(previous, { recursive: true, force: true }));
  await rename(root, previous); await mkdir(root, { mode: 0o700 });
  await unavailable(storage.fingerprint()); await unavailable(storage.availableSpace()); await unavailable(collect(storage.scanEntries()));
  await unavailable(storage.inspectEntry({ storageKey: randomBytes(32), variant: "thumb" }));
});

test("bounded inventory recognizes published and staging envelopes without changing files or exposing unknown names", async (t) => {
  const { root, storage } = await fixture(t), asset = input(); await storage.put(asset);
  const staging = `.${asset.storageKey.toString("hex")}.full.${randomBytes(16).toString("hex")}.tmp`;
  await writeFile(path.join(root, staging), await readFile(filename(root, asset.storageKey, "full")), { mode: 0o600 });
  const unknownName = "private-original-name-never-disclosed.jpg";
  await writeFile(path.join(root, unknownName), "private-secret-unknown", { mode: 0o600 });
  await mkdir(path.join(root, "private-subdirectory"), { mode: 0o700 });
  await writeFile(path.join(root, "private-subdirectory", "not-traversed"), "private-secret-nested", { mode: 0o600 });
  const before = (await readdir(root)).sort(), entries = await collect(storage.scanEntries());
  assert.equal(entries.length, 5);
  assert.equal(entries.filter((entry) => entry.kind === "published").length, 2);
  assert.equal(entries.filter((entry) => entry.kind === "staging").length, 1);
  assert.equal(entries.filter((entry) => entry.kind === "unknown").length, 2);
  for (const entry of entries) {
    assert.equal(typeof entry.encryptedBytes, "bigint"); assert.ok(Number.isSafeInteger(entry.mtimeMs));
    assert.equal(Object.hasOwn(entry, "name"), false); assert.equal(Object.hasOwn(entry, "path"), false);
    if (entry.kind === "unknown") {
      assert.equal(entry.status, "unsafe"); assert.equal(Object.hasOwn(entry, "storageKey"), false); assert.equal(Object.hasOwn(entry, "variant"), false);
    } else { assert.equal(entry.status, "structural_ok"); assert.deepEqual(entry.storageKey, asset.storageKey); }
  }
  assert.deepEqual((await readdir(root)).sort(), before);
  assert.deepEqual(await storage.get({ ...asset, variant: "full" }), asset.full);
});

test("single-entry inspection reports absent files and exact encrypted sizes without decoding images", async (t) => {
  const { storage } = await fixture(t), asset = input();
  assert.deepEqual(await storage.inspectEntry({ storageKey: asset.storageKey, variant: "full" }), { exists: false });
  await storage.put(asset);
  for (const [variant, plaintext] of [["full", asset.full], ["thumb", asset.thumbnail]]) {
    const result = await storage.inspectEntry({ storageKey: asset.storageKey, variant });
    assert.equal(result.exists, true); assert.equal(result.kind, "published"); assert.deepEqual(result.storageKey, asset.storageKey);
    assert.equal(result.variant, variant); assert.equal(result.status, "structural_ok"); assert.equal(result.encryptedBytes, BigInt(plaintext.length + 40));
  }
});

test("structural inspection rejects malformed or oversized envelopes with only bounded header work", async (t) => {
  const { root, storage } = await fixture(t);
  const cases = [
    ["full", (bytes) => { bytes[0] = 0; return bytes; }],
    ["full", (bytes) => { bytes.writeUInt32BE(0, 20); return bytes; }],
    ["full", (bytes) => { bytes.writeUInt32BE(bytes.readUInt32BE(20) + 1, 20); return bytes; }],
    ["full", (bytes) => bytes.subarray(0, 23)],
  ];
  for (const [variant, change] of cases) {
    const asset = input(); await storage.put(asset); const target = filename(root, asset.storageKey, variant);
    await writeFile(target, change(await readFile(target)));
    assert.equal((await storage.inspectEntry({ storageKey: asset.storageKey, variant })).status, "invalid_envelope");
  }
  for (const [variant, size] of [["full", 10 * 1024 * 1024 + 41], ["thumb", 512 * 1024 + 41]]) {
    const asset = input(); await storage.put(asset); await truncate(filename(root, asset.storageKey, variant), size);
    assert.equal((await storage.inspectEntry({ storageKey: asset.storageKey, variant })).status, "invalid_envelope");
  }
});

test("a structurally plausible envelope does not claim GCM authentication of ciphertext or tag", async (t) => {
  const { root, storage } = await fixture(t);
  for (const offset of [24, -1]) {
    const asset = input(); await storage.put(asset); const target = filename(root, asset.storageKey, "full"), bytes = await readFile(target);
    bytes[offset < 0 ? bytes.length + offset : offset] ^= 1; await writeFile(target, bytes);
    assert.equal((await storage.inspectEntry({ storageKey: asset.storageKey, variant: "full" })).status, "structural_ok");
    await unavailable(storage.get({ ...asset, variant: "full" }));
  }
});

test("inventory refuses symlinks, hard links, public modes and directories without following their targets", async (t) => {
  const { root, storage } = await fixture(t);
  const linked = input(); await storage.put(linked); const linkedPath = filename(root, linked.storageKey, "full");
  await link(linkedPath, path.join(root, "unknown-hard-link"));
  assert.equal((await storage.inspectEntry({ storageKey: linked.storageKey, variant: "full" })).status, "unsafe");
  const publicAsset = input(); await storage.put(publicAsset); await chmod(filename(root, publicAsset.storageKey, "full"), 0o644);
  assert.equal((await storage.inspectEntry({ storageKey: publicAsset.storageKey, variant: "full" })).status, "unsafe");
  const alias = input(), target = path.join(root, "private-secret-sentinel");
  await writeFile(target, "leave-private-secret-unchanged", { mode: 0o600 }); await symlink(target, filename(root, alias.storageKey, "full"));
  assert.equal((await storage.inspectEntry({ storageKey: alias.storageKey, variant: "full" })).status, "unsafe");
  const directoryKey = randomBytes(32); await mkdir(filename(root, directoryKey, "thumb"), { mode: 0o700 });
  assert.equal((await storage.inspectEntry({ storageKey: directoryKey, variant: "thumb" })).status, "unsafe");
  const entries = await collect(storage.scanEntries());
  assert.equal(entries.filter((entry) => entry.kind === "published" && entry.status === "unsafe").length, 4);
  assert.equal(await readFile(target, "utf8"), "leave-private-secret-unchanged");
});

test("a named pipe with a published-looking filename cannot block inspection", { skip: process.platform === "win32", timeout: 3000 }, async (t) => {
  const { root, storage } = await fixture(t), storageKey = randomBytes(32);
  execFileSync("mkfifo", ["-m", "600", filename(root, storageKey, "full")], { timeout: 1000 });
  const entry = await storage.inspectEntry({ storageKey, variant: "full" });
  assert.equal(entry.exists, true); assert.equal(entry.status, "unsafe");
  assert.equal((await collect(storage.scanEntries()))[0].status, "unsafe");
});

test("inventory limits count every directory entry and never silently report a partial scan as complete", async (t) => {
  const { root, storage } = await fixture(t); await storage.put(input()); await storage.put(input());
  await writeFile(path.join(root, "unknown-private-entry"), "private", { mode: 0o600 });
  const seen = [];
  await assert.rejects(async () => { for await (const entry of storage.scanEntries({ maxEntries: 2 })) seen.push(entry); },
    (error) => error instanceof MediaStorageError && error.code === "MEDIA_SCAN_LIMIT" && error.cause === undefined && !error.message.includes(root));
  assert.equal(seen.length, 2);
  assert.equal((await collect(storage.scanEntries({ maxEntries: 5 }))).length, 5);
});

test("aborted scans and an early iterator return finish without reading further entries", async (t) => {
  const { storage } = await fixture(t); await storage.put(input()); await storage.put(input());
  const before = new AbortController(); before.abort(); await unavailable(collect(storage.scanEntries({ signal: before.signal })));
  const during = new AbortController(), seen = [];
  await unavailable((async () => { for await (const entry of storage.scanEntries({ signal: during.signal })) { seen.push(entry); during.abort(); } })());
  assert.equal(seen.length, 1);
  const iterator = storage.scanEntries(); assert.equal((await iterator.next()).done, false);
  assert.deepEqual(await iterator.return(), { value: undefined, done: true }); assert.equal((await iterator.next()).done, true);
  assert.equal((await collect(storage.scanEntries())).length, 4);
});

test("a scan rejects root permission or identity changes between yielded entries", async (t) => {
  const { root, storage } = await fixture(t); await storage.put(input());
  const permissions = storage.scanEntries(); await permissions.next(); await chmod(root, 0o750);
  await unavailable(permissions.next()); await chmod(root, 0o700);
  const replaced = storage.scanEntries(); await replaced.next();
  const previous = `${root}-previous`; t.after(() => rm(previous, { recursive: true, force: true }));
  await rename(root, previous); await mkdir(root, { mode: 0o700 });
  await unavailable(replaced.next()); assert.deepEqual(await readdir(root), []);
});

test("inventory and inspection reject malformed options without accepting arbitrary paths", async (t) => {
  const { storage } = await fixture(t);
  for (const options of [null, [], { maxEntries: 0 }, { maxEntries: 100001 }, { maxEntries: 1.5 }, { cursor: "private" }, { signal: true }]) {
    await assert.rejects(collect(storage.scanEntries(options)), (error) => error.code === "MEDIA_INPUT");
  }
  for (const options of [null, [], { storageKey: "../private", variant: "full" }, { storageKey: randomBytes(32), variant: "thumbnail" }, { storageKey: randomBytes(32), variant: "full", path: "/private" }]) {
    await assert.rejects(storage.inspectEntry(options), (error) => error.code === "MEDIA_INPUT");
  }
});
