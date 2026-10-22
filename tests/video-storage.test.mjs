import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import filesystem from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, rm, readdir, readFile, writeFile, chmod, stat, statfs, symlink, link, unlink, rename, truncate } from "node:fs/promises";
import { createVideoStorage, VideoStorageError, VIDEO_BLOCK_BYTES, MAX_VIDEO_BYTES, videoStoredBytes } from "../server/video/storage.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = path.resolve(repo, "../audit");
const procAvailable = process.platform === "linux" && await statfs("/proc/self/fd", { bigint: true }).then((stats) => stats.type === 0x9fa0n, () => false);
const ids = () => ({ assetId: randomBytes(16), storageKey: randomBytes(32) });
const target = (root, storageKey) => path.join(root, `${storageKey.toString("hex")}.video.enc`);
const source = async function* (bytes) { yield bytes; };
const collect = async (stream) => { const pieces = []; for await (const piece of stream) pieces.push(piece); return Buffer.concat(pieces); };
const unavailable = (value) => assert.rejects(value, (error) => error instanceof VideoStorageError && error.code === "VIDEO_UNAVAILABLE" && error.cause === undefined && !error.message.includes(base));
async function fixture(t, pathMode = "strict") {
  await mkdir(base, { recursive: true, mode: 0o700 }); const root = await mkdtemp(path.join(base, "video-storage-"));
  t.after(() => rm(root, { recursive: true, force: true })); const key = randomBytes(32);
  return { root, key, storage: await createVideoStorage({ root, key, pathMode }) };
}
async function store(storage, bytes, identity = ids()) { const result = await storage.put({ ...identity, bytes: bytes.length, source: source(bytes) }); return { ...identity, result }; }
async function intercept(t, name, replacement, action) {
  const original = filesystem[name]; const mocked = t.mock.method(filesystem, name, (...args) => replacement(original, ...args)); syncBuiltinESMExports();
  try { return await action(); } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
}

test("video envelope byte accounting is bounded and exact at block boundaries", () => {
  assert.equal(videoStoredBytes(1), 65); assert.equal(videoStoredBytes(VIDEO_BLOCK_BYTES), VIDEO_BLOCK_BYTES + 64);
  assert.equal(videoStoredBytes(VIDEO_BLOCK_BYTES + 1), VIDEO_BLOCK_BYTES + 1 + 80);
  assert.equal(videoStoredBytes(MAX_VIDEO_BYTES), MAX_VIDEO_BYTES + 48 + 400 * 16);
  for (const bytes of [0, -1, 0.5, NaN, Infinity, "1", MAX_VIDEO_BYTES + 1]) assert.throws(() => videoStoredBytes(bytes), { code: "VIDEO_INPUT" });
});

test("generated multi-block upload uses private ciphertext, digest and exact partial reads", async (t) => {
  const { root, storage } = await fixture(t); const identity = ids();
  const count = VIDEO_BLOCK_BYTES * 3 + 19; const expected = createHash("sha256");
  async function* generated() { for (let offset = 0; offset < count; offset += 16381) { const block = Buffer.alloc(Math.min(16381, count - offset), offset % 251); expected.update(block); yield block; } }
  const result = await storage.put({ ...identity, bytes: count, source: generated() });
  assert.deepEqual(result, { bytes: count, storedBytes: videoStoredBytes(count), digest: expected.digest() });
  const file = target(root, identity.storageKey), encrypted = await readFile(file);
  assert.equal(encrypted.length, videoStoredBytes(count)); assert.equal((await stat(file)).mode & 0o777, 0o600); assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(root), [path.basename(file)]);
  const full = await storage.open(identity); assert.equal(full.bytes, count); const plaintext = await collect(full.stream());
  assert.equal(plaintext.length, count); assert.deepEqual(createHash("sha256").update(plaintext).digest(), result.digest);
  assert.ok(!encrypted.includes(plaintext.subarray(0, 300)));
  for (const [start, end] of [[0, 0], [VIDEO_BLOCK_BYTES - 2, VIDEO_BLOCK_BYTES + 5], [count - 13, count - 1], [200, 800]]) {
    const reader = await storage.open(identity); assert.deepEqual(await collect(reader.stream({ start, end })), plaintext.subarray(start, end + 1)); await reader.close();
  }
});

test("one large input chunk remains supported without whole-video buffering in storage", async (t) => {
  const { storage } = await fixture(t); const content = Buffer.alloc(VIDEO_BLOCK_BYTES * 9 + 12, 0x65), identity = await store(storage, content);
  const reader = await storage.open(identity); let count = 0, blocks = 0;
  for await (const chunk of reader.stream()) { assert.ok(chunk.length <= VIDEO_BLOCK_BYTES); count += chunk.length; blocks += 1; }
  assert.equal(count, content.length); assert.equal(blocks, 10);
});

test("independent salts conceal matching files and key/asset/storage substitutions fail", async (t) => {
  const { root, storage } = await fixture(t); const content = Buffer.alloc(VIDEO_BLOCK_BYTES + 1, 0x5a), first = await store(storage, content), second = await store(storage, content);
  const a = await readFile(target(root, first.storageKey)), b = await readFile(target(root, second.storageKey)); assert.notDeepEqual(a, b);
  await unavailable(storage.open({ ...first, assetId: randomBytes(16) }));
  const wrong = await createVideoStorage({ root, key: randomBytes(32) }); await unavailable(wrong.open(first));
  await writeFile(target(root, second.storageKey), a); await unavailable(storage.open(second));
});

test("modified headers and truncated/extended envelopes fail before streaming", async (t) => {
  const { root, storage } = await fixture(t);
  for (const mutate of [(a) => { a[0] ^= 1; return a; }, (a) => { a[11] ^= 1; return a; }, (a) => { a[19] ^= 1; return a; }, (a) => { a[25] ^= 1; return a; }, (a) => { a[47] ^= 1; return a; }, (a) => a.subarray(0, -1), (a) => Buffer.concat([a, Buffer.from([0])])]) {
    const identity = await store(storage, Buffer.alloc(450, 0x5a)), file = target(root, identity.storageKey);
    await writeFile(file, mutate(await readFile(file))); await unavailable(storage.open(identity));
  }
});

test("corrupted ciphertext or tag yields no unauthenticated plaintext from that block", async (t) => {
  const { root, storage } = await fixture(t);
  for (const at of [48, 48 + VIDEO_BLOCK_BYTES, 48 + VIDEO_BLOCK_BYTES + 16 + 2]) {
    const identity = await store(storage, Buffer.alloc(VIDEO_BLOCK_BYTES * 2, 0x5a)), file = target(root, identity.storageKey), encrypted = await readFile(file);
    encrypted[at] ^= 1; await writeFile(file, encrypted); const reader = await storage.open(identity);
    const received = []; await unavailable((async () => { for await (const chunk of reader.stream()) received.push(chunk); })());
    assert.equal(Buffer.concat(received).length, at > 48 + VIDEO_BLOCK_BYTES ? VIDEO_BLOCK_BYTES : 0);
  }
});

test("reordered equal-size encrypted blocks cannot be read at the wrong index", async (t) => {
  const { root, storage } = await fixture(t), identity = await store(storage, Buffer.alloc(VIDEO_BLOCK_BYTES * 2, 0x31));
  const file = target(root, identity.storageKey), encrypted = await readFile(file), size = VIDEO_BLOCK_BYTES + 16;
  const changed = Buffer.concat([encrypted.subarray(0, 48), encrypted.subarray(48 + size, 48 + 2 * size), encrypted.subarray(48, 48 + size)]);
  await writeFile(file, changed); const reader = await storage.open(identity); await unavailable(collect(reader.stream({ start: 0, end: 8 })));
});

test("partial reads authenticate only required blocks while still checking whole-envelope shape", async (t) => {
  const { root, storage } = await fixture(t), identity = await store(storage, Buffer.alloc(VIDEO_BLOCK_BYTES * 3, 0x78));
  const file = target(root, identity.storageKey), encrypted = await readFile(file); encrypted[48] ^= 1; await writeFile(file, encrypted);
  const reader = await storage.open(identity); assert.deepEqual(await collect(reader.stream({ start: VIDEO_BLOCK_BYTES, end: VIDEO_BLOCK_BYTES + 8 })), Buffer.alloc(9, 0x78));
});

test("short, overlong, non-buffer and thrown source bodies never publish and staging is cleaned", async (t) => {
  const { root, storage } = await fixture(t);
  for (const body of [source(Buffer.alloc(9)), source(Buffer.alloc(11)), (async function* () { yield "not-bytes"; })(), (async function* () { yield Buffer.alloc(5); throw new Error("private-details"); })()]) {
    await assert.rejects(storage.put({ ...ids(), bytes: 10, source: body }), (error) => error instanceof VideoStorageError && error.published === false && error.cleanupConfirmed === true && !error.message.includes("private-details"));
    assert.deepEqual(await readdir(root), []);
  }
});

test("aborting mid-upload cancels stalled reception and removes only that upload staging", async (t) => {
  const { root, storage } = await fixture(t), controller = new AbortController(); let waiting;
  const stalled = { [Symbol.asyncIterator]() { return { next() { waiting?.(); return new Promise(() => {}); }, return() { return Promise.resolve({ done: true }); } }; } };
  const ready = new Promise((resolve) => { waiting = resolve; });
  const pending = storage.put({ ...ids(), bytes: 10, source: stalled, signal: controller.signal }); await ready; controller.abort();
  await assert.rejects(pending, { code: "VIDEO_ABORTED" }); assert.deepEqual(await readdir(root), []);
});

test("exclusive atomic publication preserves a conflicting asset and concurrent writers have one winner", async (t) => {
  const { root, storage } = await fixture(t), identity = ids(), content = Buffer.alloc(31, 0x31); await store(storage, content, identity);
  const previous = await readFile(target(root, identity.storageKey));
  await unavailable(storage.put({ ...identity, bytes: 50, source: source(Buffer.alloc(50, 0x32)) })); assert.deepEqual(await readFile(target(root, identity.storageKey)), previous);
  const next = ids(), results = await Promise.allSettled([storage.put({ ...next, bytes: 31, source: source(content) }), storage.put({ ...next, bytes: 31, source: source(content) })]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1); assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal((await readdir(root)).length, 2);
});

test("stream is single-use, close is idempotent, consumer cancellation closes the reader", async (t) => {
  const { storage } = await fixture(t), identity = await store(storage, Buffer.alloc(VIDEO_BLOCK_BYTES * 2, 0x45));
  const reader = await storage.open(identity); for await (const chunk of reader.stream()) { assert.equal(chunk.length, VIDEO_BLOCK_BYTES); break; }
  await reader.close(); await reader.close(); assert.throws(() => reader.stream(), { code: "VIDEO_UNAVAILABLE" });
  const head = await storage.open(identity); await head.close(); assert.throws(() => head.stream(), { code: "VIDEO_UNAVAILABLE" });
  const aborted = await storage.open(identity), controller = new AbortController(); controller.abort(); await assert.rejects(collect(aborted.stream({ signal: controller.signal })), { code: "VIDEO_ABORTED" }); await aborted.close();
  const unopened = await storage.open(identity), stream = unopened.stream(); await stream.return(); assert.throws(() => unopened.stream(), { code: "VIDEO_UNAVAILABLE" });
});

test("put failures expose publication and durable cleanup independently", async (t) => {
  const { root, storage } = await fixture(t); const identity = ids();
  await intercept(t, "open", async (original, name, ...args) => {
    const handle = await original(name, ...args);
    if (name === root) handle.sync = async () => { throw new Error("private-sync-failure"); };
    return handle;
  }, async () => {
    await assert.rejects(storage.put({ ...identity, bytes: 10, source: source(Buffer.alloc(10)) }), (error) => error.published === true && error.cleanupConfirmed === false && error.message === "Private video storage is unavailable.");
  });
  const reader = await storage.open(identity); assert.deepEqual(await collect(reader.stream()), Buffer.alloc(10));
  const second = ids();
  await intercept(t, "unlink", async (original, name) => {
    if (String(name).endsWith(".tmp")) throw new Error("private-unlink-failure"); return original(name);
  }, async () => {
    await assert.rejects(storage.put({ ...second, bytes: 10, source: source(Buffer.alloc(9)) }), (error) => error.published === false && error.cleanupConfirmed === false);
  });
  assert.equal((await readdir(root)).filter((name) => name.endsWith(".tmp")).length, 1);
});

test("a staging filename collision is preserved and is never mistaken for this call's file", async (t) => {
  const { root, storage } = await fixture(t); let collision;
  await intercept(t, "open", async (original, name, ...args) => {
    if (String(name).endsWith(".tmp")) { collision = name; await writeFile(name, "existing-private-sentinel", { mode: 0o600, flag: "wx" }); }
    return original(name, ...args);
  }, async () => {
    await assert.rejects(storage.put({ ...ids(), bytes: 1, source: source(Buffer.alloc(1)) }), (error) => error.published === false && error.cleanupConfirmed === true);
  });
  assert.equal(await readFile(collision, "utf8"), "existing-private-sentinel"); assert.deepEqual(await readdir(root), [path.basename(collision)]);
});

test("all opened file and directory descriptors close after successful, failed, HEAD and cancelled reads", async (t) => {
  const { storage } = await fixture(t); const handles = [];
  await intercept(t, "open", async (original, ...args) => { const handle = await original(...args); handles.push(handle); return handle; }, async () => {
    const identity = await store(storage, Buffer.alloc(VIDEO_BLOCK_BYTES + 1)); assert.ok(handles.every((handle) => handle.fd === -1));
    const head = await storage.open(identity); assert.equal(handles.filter((handle) => handle.fd !== -1).length, 2); await head.close(); assert.ok(handles.every((handle) => handle.fd === -1));
    const read = await storage.open(identity); const stream = read.stream(); await stream.next(); await stream.return(); assert.ok(handles.every((handle) => handle.fd === -1));
    const unstarted = await storage.open(identity); await unstarted.stream().return(); assert.ok(handles.every((handle) => handle.fd === -1));
    await assert.rejects(storage.put({ ...ids(), bytes: 10, source: source(Buffer.alloc(9)) })); assert.ok(handles.every((handle) => handle.fd === -1));
  });
});

test("range/identifier/source validation refuses noncanonical and unbounded inputs", async (t) => {
  const { storage } = await fixture(t), identity = await store(storage, Buffer.alloc(10));
  for (const options of [{ start: -1 }, { end: 10 }, { start: 2, end: 1 }, { start: 1.1 }, { start: "1" }, { signal: {} }, { extra: true }]) {
    const reader = await storage.open(identity); assert.throws(() => reader.stream(options), { code: "VIDEO_INPUT" }); await reader.close();
  }
  for (const options of [{ assetId: "../secret" }, { storageKey: Buffer.alloc(31) }, { bytes: MAX_VIDEO_BYTES + 1 }, { source: [] }, { signal: {} }]) await assert.rejects(storage.put({ ...ids(), bytes: 1, source: source(Buffer.alloc(1)), ...options }), { code: "VIDEO_INPUT" });
});

test("private roots reject checkout locations, aliases, unsafe modes and replaced identities", async (t) => {
  const { root, key, storage } = await fixture(t);
  for (const candidate of ["relative", `${root}/`, "/", path.join(repo, "private-video"), path.dirname(repo), `${root}\0bad`]) await assert.rejects(createVideoStorage({ root: candidate, key }), { code: "VIDEO_INPUT" });
  await chmod(root, 0o755); await unavailable(createVideoStorage({ root, key })); await chmod(root, 0o700);
  const alias = `${root}-alias`; await symlink(root, alias); t.after(() => unlink(alias)); await unavailable(createVideoStorage({ root: alias, key }));
  const moved = `${root}-moved`; t.after(() => rm(moved, { recursive: true, force: true })); await rename(root, moved); await mkdir(root, { mode: 0o700 });
  await unavailable(storage.availableSpace()); await unavailable(storage.fingerprint()); await unavailable(storage.remove(ids())); await unavailable(storage.put({ ...ids(), bytes: 1, source: source(Buffer.alloc(1)) })); assert.deepEqual(await readdir(root), []);
});

test("unsafe file permissions, hardlinks and symlinks fail closed for open and remove", async (t) => {
  const { root, storage } = await fixture(t), identity = await store(storage, Buffer.alloc(10)), file = target(root, identity.storageKey);
  await chmod(file, 0o644); await unavailable(storage.open(identity)); await unavailable(storage.remove(identity)); await chmod(file, 0o600);
  const alias = path.join(root, "other-link"); await link(file, alias); await unavailable(storage.open(identity)); await unavailable(storage.remove(identity)); await unlink(alias);
  await rename(file, alias); await symlink(alias, file); await unavailable(storage.open(identity)); await unavailable(storage.remove(identity)); assert.equal((await stat(alias)).size, videoStoredBytes(10));
});

test("oversized and modified-in-place files are rejected without returning changed plaintext", async (t) => {
  const { root, storage } = await fixture(t), identity = await store(storage, Buffer.alloc(VIDEO_BLOCK_BYTES * 2)), file = target(root, identity.storageKey);
  const reader = await storage.open(identity); await truncate(file, 100); await unavailable(collect(reader.stream()));
  await truncate(file, videoStoredBytes(MAX_VIDEO_BYTES) + 1); await unavailable(storage.open(identity));
});

test("remove is durable and idempotent, leaves unrelated files and reports bounded free space", async (t) => {
  const { root, storage } = await fixture(t), identity = await store(storage, Buffer.alloc(100)); const sentinel = path.join(root, "leave-me.enc"); await writeFile(sentinel, "sentinel", { mode: 0o600 });
  assert.deepEqual(await storage.remove(identity), { removed: true }); assert.deepEqual(await storage.remove(identity), { removed: true }); assert.deepEqual(await readdir(root), ["leave-me.enc"]);
  const free = await storage.availableSpace(); assert.equal(typeof free.availableBytes, "bigint"); assert.ok(free.availableBytes >= 0n);
});

test("video root fingerprints are stable, keyed, physical and returned independently", async (t) => {
  const { root, key, storage } = await fixture(t), other = await fixture(t);
  const fingerprint = await storage.fingerprint(); assert.equal(fingerprint.length, 32);
  assert.deepEqual(await (await createVideoStorage({ root, key })).fingerprint(), fingerprint);
  assert.notDeepEqual(await (await createVideoStorage({ root, key: randomBytes(32) })).fingerprint(), fingerprint);
  assert.notDeepEqual(await other.storage.fingerprint(), fingerprint);
  fingerprint.fill(0); assert.notDeepEqual(await storage.fingerprint(), fingerprint);
});

test("remove clears crashed encrypted staging for its key and preserves other keys and malformed names", async (t) => {
  const { root, storage } = await fixture(t), identity = await store(storage, Buffer.alloc(VIDEO_BLOCK_BYTES + 7));
  const encrypted = await readFile(target(root, identity.storageKey)), hex = identity.storageKey.toString("hex");
  const staging = [`.${hex}.video.${randomBytes(16).toString("hex")}.tmp`, `.${hex}.video.${randomBytes(16).toString("hex")}.tmp`];
  for (const name of staging) await writeFile(path.join(root, name), encrypted.subarray(0, 91), { mode: 0o600 });
  const untouched = [`.${randomBytes(32).toString("hex")}.video.${randomBytes(16).toString("hex")}.tmp`, `.${hex}.video.${"z".repeat(32)}.tmp`, `${hex}.video.backup`];
  for (const name of untouched) await writeFile(path.join(root, name), "unrelated-sentinel", { mode: 0o600 });
  assert.deepEqual(await storage.remove(identity), { removed: true });
  assert.deepEqual((await readdir(root)).sort(), untouched.sort());
  for (const name of untouched) assert.equal(await readFile(path.join(root, name), "utf8"), "unrelated-sentinel");
  assert.deepEqual(await storage.remove(identity), { removed: true });
});

test("remove recovers a publication interrupted between linking the final and unlinking staging", async (t) => {
  const { root, storage } = await fixture(t), identity = await store(storage, Buffer.alloc(100));
  const final = target(root, identity.storageKey), staging = path.join(root, `.${identity.storageKey.toString("hex")}.video.${randomBytes(16).toString("hex")}.tmp`);
  await link(final, staging); assert.equal((await stat(final)).nlink, 2);
  assert.deepEqual(await storage.remove(identity), { removed: true }); assert.deepEqual(await readdir(root), []);
});

test("remove refuses a publication hardlink group with an additional unrelated link before changing files", async (t) => {
  const { root, storage } = await fixture(t), identity = await store(storage, Buffer.alloc(100));
  const final = target(root, identity.storageKey), staging = path.join(root, `.${identity.storageKey.toString("hex")}.video.${randomBytes(16).toString("hex")}.tmp`), external = path.join(root, "unrelated-link.enc");
  await link(final, staging); await link(final, external); const before = await readFile(final);
  await unavailable(storage.remove(identity));
  for (const name of [final, staging, external]) { assert.deepEqual(await readFile(name), before); assert.equal((await stat(name)).nlink, 3); }
});

test("unsafe crashed staging refuses cleanup before the valid final is removed", async (t) => {
  for (const kind of ["permissions", "symlink", "hardlink", "directory"]) await t.test(kind, async (t) => {
    const { root, storage } = await fixture(t), identity = await store(storage, Buffer.alloc(73));
    const final = target(root, identity.storageKey), before = await readFile(final);
    const staging = path.join(root, `.${identity.storageKey.toString("hex")}.video.${randomBytes(16).toString("hex")}.tmp`), sentinel = path.join(root, "unrelated-sentinel");
    await writeFile(sentinel, "must-remain", { mode: 0o600 });
    if (kind === "permissions") await writeFile(staging, before.subarray(0, 50), { mode: 0o644 });
    if (kind === "symlink") await symlink(sentinel, staging);
    if (kind === "hardlink") await link(sentinel, staging);
    if (kind === "directory") await mkdir(staging, { mode: 0o700 });
    await unavailable(storage.remove(identity)); assert.deepEqual(await readFile(final), before);
    assert.equal(await readFile(sentinel, "utf8"), "must-remain");
  });
});

test("a final name recreated after unlink is preserved and never reported as removed", async (t) => {
  const { root, storage } = await fixture(t), identity = await store(storage, Buffer.alloc(14)), final = target(root, identity.storageKey);
  await intercept(t, "unlink", async (original, name) => {
    await original(name); if (name === final) await writeFile(name, "replacement-sentinel", { mode: 0o600 });
  }, async () => { await unavailable(storage.remove(identity)); });
  assert.equal(await readFile(final, "utf8"), "replacement-sentinel");
});

test("a new matching staging name created during directory sync prevents a successful removal receipt", async (t) => {
  const { root, storage } = await fixture(t), identity = await store(storage, Buffer.alloc(14));
  const staging = path.join(root, `.${identity.storageKey.toString("hex")}.video.${randomBytes(16).toString("hex")}.tmp`);
  await intercept(t, "open", async (original, name, ...args) => {
    const handle = await original(name, ...args);
    if (name === root) { const sync = handle.sync.bind(handle); handle.sync = async () => { await sync(); await writeFile(staging, "new-staging", { mode: 0o600 }); }; }
    return handle;
  }, async () => { await unavailable(storage.remove(identity)); });
  assert.equal(await readFile(staging, "utf8"), "new-staging");
  assert.deepEqual(await storage.remove(identity), { removed: true }); assert.deepEqual(await readdir(root), []);
});

test("remove and fingerprint propagate descriptor-close failures instead of returning success", async (t) => {
  const { root, storage } = await fixture(t), identity = await store(storage, Buffer.alloc(14));
  const handles = [];
  await intercept(t, "open", async (original, name, ...args) => {
    const handle = await original(name, ...args); handles.push(handle);
    if (name === root) { const close = handle.close.bind(handle); handle.close = async () => { await close(); throw new Error("private-close-failed"); }; }
    return handle;
  }, async () => { await unavailable(storage.remove(identity)); await unavailable(storage.fingerprint()); });
  assert.ok(handles.every((handle) => handle.fd === -1)); assert.deepEqual(await readdir(root), []);
  assert.deepEqual(await storage.remove(identity), { removed: true }); assert.equal((await storage.fingerprint()).length, 32);
});

test("a file-close failure after unlink leaves removal unconfirmed until a durable retry", async (t) => {
  const { root, storage } = await fixture(t), identity = await store(storage, Buffer.alloc(14)), final = target(root, identity.storageKey);
  const handles = [];
  await intercept(t, "open", async (original, name, ...args) => {
    const handle = await original(name, ...args); handles.push(handle);
    if (name === final) { const close = handle.close.bind(handle); handle.close = async () => { await close(); throw new Error("private-file-close-failed"); }; }
    return handle;
  }, async () => { await unavailable(storage.remove(identity)); });
  assert.ok(handles.every((handle) => handle.fd === -1)); assert.deepEqual(await readdir(root), []);
  assert.deepEqual(await storage.remove(identity), { removed: true });
});

test("retry of an already absent removal still requires a successful directory sync", async (t) => {
  const { root, storage } = await fixture(t), identity = await store(storage, Buffer.alloc(10)); await storage.remove(identity); let syncs = 0;
  await intercept(t, "open", async (original, name, ...args) => {
    const handle = await original(name, ...args); if (name === root) handle.sync = async () => { syncs += 1; throw new Error("private-sync-failed"); }; return handle;
  }, async () => { await unavailable(storage.remove(identity)); });
  assert.equal(syncs, 1); assert.deepEqual(await storage.remove(identity), { removed: true });
});

test("linux-dirfd mode keeps an open read pinned through a root rename and rejects replacement on new operations", { skip: procAvailable ? false : "Linux procfs /proc/self/fd is unavailable locally; CI Linux executes this filesystem case." }, async (t) => {
  const { root, storage } = await fixture(t, "linux-dirfd"), identity = await store(storage, Buffer.alloc(VIDEO_BLOCK_BYTES + 9, 0x64));
  const reader = await storage.open(identity), moved = `${root}-moved`; t.after(() => rm(moved, { recursive: true, force: true }));
  await rename(root, moved); await mkdir(root, { mode: 0o700 }); await writeFile(target(root, identity.storageKey), "sentinel", { mode: 0o600 });
  assert.deepEqual(await collect(reader.stream({ start: VIDEO_BLOCK_BYTES, end: VIDEO_BLOCK_BYTES + 8 })), Buffer.alloc(9, 0x64));
  await unavailable(storage.open(identity)); await unavailable(storage.remove(identity)); assert.equal(await readFile(target(root, identity.storageKey), "utf8"), "sentinel");
  await unavailable(storage.fingerprint());
});

test("linux-dirfd cleanup stays in the pinned root during an unlink-time root replacement", { skip: procAvailable ? false : "Linux procfs /proc/self/fd is unavailable locally; CI Linux executes this filesystem case." }, async (t) => {
  const { root, storage } = await fixture(t, "linux-dirfd"), identity = await store(storage, Buffer.alloc(43)), moved = `${root}-moved`;
  t.after(() => rm(moved, { recursive: true, force: true }));
  const staging = `.${identity.storageKey.toString("hex")}.video.${randomBytes(16).toString("hex")}.tmp`;
  await writeFile(path.join(root, staging), "crashed-staging", { mode: 0o600 }); let replaced = false;
  await intercept(t, "unlink", async (original, name) => {
    if (!replaced) { replaced = true; await rename(root, moved); await mkdir(root, { mode: 0o700 }); await writeFile(target(root, identity.storageKey), "replacement-sentinel", { mode: 0o600 }); }
    return original(name);
  }, async () => { assert.deepEqual(await storage.remove(identity), { removed: true }); });
  assert.deepEqual(await readdir(moved), []); assert.equal(await readFile(target(root, identity.storageKey), "utf8"), "replacement-sentinel");
  await unavailable(storage.fingerprint()); await unavailable(storage.remove(identity));
});

test("linux-dirfd upload publication stays in the pinned root if its path is replaced during reception", { skip: procAvailable ? false : "Linux procfs /proc/self/fd is unavailable locally; CI Linux executes this filesystem case." }, async (t) => {
  const { root, storage } = await fixture(t, "linux-dirfd"), identity = ids(), moved = `${root}-moved`; t.after(() => rm(moved, { recursive: true, force: true }));
  const body = (async function* () { await rename(root, moved); await mkdir(root, { mode: 0o700 }); yield Buffer.alloc(40, 0x51); })();
  assert.equal((await storage.put({ ...identity, bytes: 40, source: body })).bytes, 40); assert.deepEqual(await readdir(root), []);
  assert.deepEqual(await readdir(moved), [path.basename(target(moved, identity.storageKey))]); await unavailable(storage.availableSpace());
});
