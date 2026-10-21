import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDataWriter, DataWriterError } from "../server/data/writer.mjs";

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../audit");
const name = `media/${"a".repeat(32)}.mp4`, block = 262144;
const unavailable = (error) => error instanceof DataWriterError && error.code === "DATA_OUTPUT_UNAVAILABLE"
  && error.message === "Private data output is unavailable." && error.cause === undefined && !Object.hasOwn(error, "path");
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const source = async function* (...chunks) { yield* chunks; };
const absent = (file) => assert.rejects(lstat(file), { code: "ENOENT" });
async function fixture(t, extra = {}) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "video-data-writer-"));
  const parent = path.join(root, "exports"), protectedRoot = path.join(root, "source");
  await mkdir(parent, { mode: 0o700 }); await mkdir(protectedRoot, { mode: 0o700 });
  const options = { output: path.join(parent, "new-export"), protectedRoots: [protectedRoot], pathMode: "strict", video: true, ...extra };
  const writers = [];
  t.after(async () => { for (const writer of writers) await writer.close().catch(() => {}); await rm(root, { recursive: true, force: true }); });
  return { root, options, async writer(overrides = {}) { const writer = await createDataWriter({ ...options, ...overrides }); writers.push(writer); return writer; } };
}
async function incomplete(f, writer) {
  await assert.rejects(writer.finalize({}), unavailable); await writer.close();
  await absent(path.join(f.options.output, "COMPLETE.json"));
}
async function hookVideoOpen(callback, operation) {
  const original = fs.promises.open;
  fs.promises.open = async (...args) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith("/" + path.basename(name))) await callback(handle);
    return handle;
  };
  syncBuiltinESMExports();
  try { return await operation(); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
}

test("video output is explicit and preserves the historical writer and completion shape", async (t) => {
  for (const option of [undefined, false]) {
    const f = await fixture(t), writer = await f.writer({ video: option });
    assert.equal(Object.hasOwn(writer, "video"), false);
    await writer.json("account.json", { retained: "Été" });
    await writer.finalize({ mediaFiles: 0, videoFiles: 7, videoBytes: 9, videoLibraryItems: 3 });
    const manifest = JSON.parse(await readFile(path.join(f.options.output, "COMPLETE.json"), "utf8"));
    assert.deepEqual(Object.keys(manifest), ["format", "version", "status", "counts", "entries"]);
    assert.equal(manifest.version, 1); assert.deepEqual(manifest.counts, { mediaFiles: 0 });
    assert.equal(await readFile(path.join(f.options.output, "account.json"), "utf8"), '{"retained":"Été"}\n');
  }
  for (const option of [null, 0, 1, "true", {}, []]) {
    const f = await fixture(t);
    await assert.rejects(f.writer({ video: option }), unavailable); await absent(f.options.output);
  }
});

test("video and JPEG files share private output, exact incremental hashes and version two totals", async (t) => {
  const f = await fixture(t), writer = await f.writer(), chunks = [Buffer.alloc(block, 0x5a), Buffer.alloc(block, 0x6b), Buffer.alloc(57, 0x7c)];
  const photo = Buffer.from([0xff, 0xd8, 0xff, 1, 0xff, 0xd9]), photoName = `media/${"b".repeat(32)}.jpg`;
  await writer.media(photoName, photo); await writer.video(name, source(...chunks), { bytes: block * 2 + 57 });
  await absent(path.join(f.options.output, "COMPLETE.json"));
  const counts = { mediaFiles: 2, mediaBytes: photo.length + block * 2 + 57, libraryItems: 1, videoFiles: 1, videoBytes: block * 2 + 57, videoLibraryItems: 1 };
  await writer.finalize(counts); await writer.close();
  const manifest = JSON.parse(await readFile(path.join(f.options.output, "COMPLETE.json"), "utf8"));
  assert.equal(manifest.format, "jessiemessage-private-export"); assert.equal(manifest.version, 2); assert.deepEqual(manifest.counts, counts);
  assert.deepEqual(manifest.entries.map((entry) => entry.name), [name, photoName]);
  const copied = await readFile(path.join(f.options.output, name)); assert.deepEqual(copied, Buffer.concat(chunks));
  assert.equal(manifest.entries[0].sha256, createHash("sha256").update(copied).digest("hex")); assert.equal(manifest.entries[0].bytes, copied.length);
  assert.equal((await lstat(path.join(f.options.output, name))).mode & 0o7777, 0o600);
  assert.equal((await lstat(path.join(f.options.output, "media"))).mode & 0o7777, 0o700);
  assert.equal((await lstat(f.options.output)).mode & 0o7777, 0o700);
});

test("a held file write bounds source consumption, serializes output and syncs video only after copying", async (t) => {
  const f = await fixture(t), writer = await f.writer(), entered = deferred(), release = deferred();
  let produced = 0, writes = 0, syncs = 0, reading = false;
  await hookVideoOpen(async (handle) => {
    const write = handle.write.bind(handle), sync = handle.sync.bind(handle);
    handle.write = async (...args) => { assert.equal(reading, false); reading = true; writes++; if (writes === 1) { entered.resolve(); await release.promise; } try { return await write(...args); } finally { reading = false; } };
    handle.sync = async () => { syncs++; return sync(); };
  }, async () => {
    const pending = writer.video(name, (async function* () { for (let i = 0; i < 3; i++) { produced++; yield Buffer.alloc(block, i); } })(), { bytes: block * 3 });
    const queued = writer.json("account.json", { after: "video" });
    try {
      await entered.promise;
      assert.equal(produced, 1); assert.equal(writes, 1); assert.equal(syncs, 0);
      assert.equal((await lstat(path.join(f.options.output, name))).size, 0); await absent(path.join(f.options.output, "account.json"));
    } finally { release.resolve(); }
    await pending; await queued;
    assert.equal(produced, 3); assert.equal(writes, 3); assert.equal(syncs, 1);
  });
  await writer.finalize({ videoFiles: 1 });
});

test("invalid names, declared sizes, sources and options fail before opening a video file", async (t) => {
  const invalid = [
    ["../outside", source(Buffer.alloc(1)), { bytes: 1 }], [name + "\n", source(Buffer.alloc(1)), { bytes: 1 }],
    [name.toUpperCase(), source(Buffer.alloc(1)), { bytes: 1 }], [name.replace(".mp4", ".jpg"), source(Buffer.alloc(1)), { bytes: 1 }],
    [name, source(Buffer.alloc(1)), {}], [name, source(Buffer.alloc(1)), { bytes: 0 }], [name, source(Buffer.alloc(1)), { bytes: 104857601 }],
    [name, source(Buffer.alloc(1)), { bytes: "1" }], [name, source(Buffer.alloc(1)), { bytes: 1.5 }],
    [name, [Buffer.alloc(1)], { bytes: 1 }], [name, source(Buffer.alloc(1)), { bytes: 1, signal: {} }],
    [name, source(Buffer.alloc(1)), { bytes: 1, extra: true }], [name, source(Buffer.alloc(1)), null],
  ];
  for (const [file, stream, options] of invalid) {
    const f = await fixture(t), writer = await f.writer();
    await assert.rejects(writer.video(file, stream, options), unavailable);
    assert.deepEqual(await readdir(f.options.output), []); await incomplete(f, writer);
  }
});

test("short, long, invalid and rejected sources cannot complete and release their iterator", async (t) => {
  for (const kind of ["short", "long", "empty", "oversized", "typed-array", "error"]) {
    const f = await fixture(t), writer = await f.writer(); let released = false;
    const stream = (async function* () {
      try {
        if (kind === "empty") yield Buffer.alloc(0);
        else if (kind === "oversized") yield Buffer.alloc(block + 1);
        else if (kind === "typed-array") yield new Uint8Array(1);
        else { yield Buffer.alloc(2); if (kind === "long") yield Buffer.alloc(2); if (kind === "error") throw new Error("synthetic private source failure"); }
      } finally { released = true; }
    })();
    await assert.rejects(writer.video(name, stream, { bytes: kind === "short" ? 3 : 2 }), unavailable);
    assert.equal(released, true); await incomplete(f, writer);
  }
});

test("aborting before opening or during an awaited write never advances into another chunk or completes", async (t) => {
  const before = await fixture(t), unused = await before.writer(), cancelled = new AbortController(); let produced = 0;
  cancelled.abort();
  await assert.rejects(unused.video(name, (async function* () { produced++; yield Buffer.alloc(1); })(), { bytes: 1, signal: cancelled.signal }), unavailable);
  assert.equal(produced, 0); assert.deepEqual(await readdir(before.options.output), []); await incomplete(before, unused);
  const f = await fixture(t), writer = await f.writer(), controller = new AbortController(), entered = deferred(), release = deferred(); let released = false;
  await hookVideoOpen(async (handle) => {
    const write = handle.write.bind(handle); handle.write = async (...args) => { entered.resolve(); await release.promise; return write(...args); };
  }, async () => {
    const pending = writer.video(name, (async function* () { try { produced++; yield Buffer.alloc(2); produced++; yield Buffer.alloc(2); } finally { released = true; } })(), { bytes: 4, signal: controller.signal });
    const rejected = assert.rejects(pending, unavailable);
    try { await entered.promise; controller.abort(new Error("synthetic private abort")); } finally { release.resolve(); }
    await rejected;
  });
  assert.equal(produced, 1); assert.equal(released, true); await incomplete(f, writer);
});

test("byte and file budgets reject video before source iteration and reserve room for completion", async (t) => {
  for (const extra of [{ maximumBytes: 6 }, { maximumFiles: 1 }]) {
    const f = await fixture(t), writer = await f.writer(extra); let produced = 0;
    await writer.json("account.json", {});
    await assert.rejects(writer.video(name, (async function* () { produced++; yield Buffer.alloc(4); })(), { bytes: 4 }), unavailable);
    assert.equal(produced, 0); await absent(path.join(f.options.output, name)); await incomplete(f, writer);
  }
  const f = await fixture(t), writer = await f.writer({ maximumBytes: 5 });
  await writer.video(name, source(Buffer.alloc(5)), { bytes: 5 });
  await incomplete(f, writer);
});

test("file write failure and same-inode corruption retain private partial output without completion", async (t) => {
  const f = await fixture(t), writer = await f.writer(); let released = false, closed = 0;
  await hookVideoOpen(async (handle) => {
    const close = handle.close.bind(handle); handle.close = async () => { closed++; return close(); };
    handle.write = async () => { throw new Error("synthetic private disk failure"); };
  }, () => assert.rejects(writer.video(name, (async function* () { try { yield Buffer.alloc(2); } finally { released = true; } })(), { bytes: 2 }), unavailable));
  assert.equal(released, true); assert.equal(closed, 1); await incomplete(f, writer);
  const changed = await fixture(t), copy = await changed.writer(); await copy.video(name, source(Buffer.from("original")), { bytes: 8 });
  await writeFile(path.join(changed.options.output, name), "tampered", { mode: 0o600 }); await incomplete(changed, copy);
});

test("replacing the media directory during a video stream cannot write into the replacement", async (t) => {
  const f = await fixture(t), writer = await f.writer(), directory = path.join(f.options.output, "media"), previous = directory + "-original";
  await assert.rejects(writer.video(name, (async function* () {
    yield Buffer.alloc(2); await rename(directory, previous); await mkdir(directory, { mode: 0o700 });
    await writeFile(path.join(directory, "foreign"), "keep", { mode: 0o600 }); yield Buffer.alloc(2);
  })(), { bytes: 4 }), unavailable);
  assert.deepEqual(await readdir(directory), ["foreign"]); assert.equal((await lstat(path.join(previous, path.basename(name)))).size, 2);
  await incomplete(f, writer);
});

const dirfd = process.platform === "linux" && await statfs("/proc/self/fd", { bigint: true }).then((value) => value.type === 0x9fa0n, () => false);
test("video copying retains the native dirfd identity and completion contract", { skip: !dirfd }, async (t) => {
  const f = await fixture(t, { pathMode: "linux-dirfd" }), writer = await f.writer();
  await writer.video(name, source(Buffer.alloc(block), Buffer.alloc(1, 0x7f)), { bytes: block + 1 });
  await writer.finalize({ mediaFiles: 1, mediaBytes: block + 1, videoFiles: 1, videoBytes: block + 1 });
  const manifest = JSON.parse(await readFile(path.join(f.options.output, "COMPLETE.json"), "utf8"));
  assert.equal(manifest.version, 2); assert.equal(manifest.entries[0].bytes, block + 1);
});
