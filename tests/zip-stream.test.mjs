import test from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createZipStream, ZipStreamError, MAX_ZIP_STREAM_BYTES, MAX_ZIP_STREAM_CHUNK_BYTES } from "../server/chat/zip-stream.mjs";

const name = (n, kind = "videos") => kind + "/" + n.toString(16).padStart(32, "0") + (kind === "photos" ? ".jpg" : ".mp4");
const unavailable = (error) => error instanceof ZipStreamError && error.code === "ZIP_STREAM_UNAVAILABLE"
  && error.cause === undefined && !/secret|SQL|private-path/.test(error.message);
const limited = (error) => error instanceof ZipStreamError && error.code === "ZIP_LIMIT";
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function collect(source) { const parts = []; for await (const chunk of source) parts.push(chunk); return Buffer.concat(parts); }
function entry(filename, value, events = []) {
  const original = Buffer.from(value), state = { opened: 0, closed: 0, chunks: [] };
  return { state, expected: original, input: { name: filename, bytes: original.length, async open({ signal }) {
    assert.ok(signal instanceof AbortSignal); assert.equal(signal.aborted, false);
    state.opened++; events.push("open:" + filename);
    return { source: (async function* () {
      for (let offset = 0; offset < original.length; offset += 3) { const chunk = Buffer.from(original.subarray(offset, offset + 3)); state.chunks.push(chunk); yield chunk; }
    })(), async close() { state.closed++; events.push("close:" + filename); } };
  } } };
}
async function inspect(t, archive) {
  const base = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "zip-stream-")); t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "archive.zip"); await writeFile(file, archive, { mode: 0o600 });
  const script = "import sys,zipfile,json,hashlib;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps([{'name':i.filename,'bytes':i.file_size,'crc':i.CRC,'method':i.compress_type,'flags':i.flag_bits,'extra':i.extra.hex(),'date':i.date_time,'sha256':hashlib.sha256(z.read(i)).hexdigest()} for i in z.infolist()]))";
  return JSON.parse((await promisify(execFile)("python3", ["-c", script, file], { maxBuffer: 1024 * 1024 })).stdout);
}

test("streaming ZIP32 is independently decoded with exact sizes, CRCs, descriptors and sequential source cleanup", async (t) => {
  const events = [], fixtures = [
    entry("conversation.json", Buffer.from('{"caption":"Vidéo 🎥"}\n'), events),
    entry("Conversation.html", Buffer.from("<p>Synthetic export</p>"), events),
    entry("LIRE-MOI.txt", Buffer.from("Extract everything.\n"), events),
    entry(name(1, "photos"), Buffer.from([255, 216, 255, 217]), events),
    entry(name(2), Buffer.from("123456789"), events),
  ];
  const zip = createZipStream(fixtures.map((f) => f.input)), archive = await collect(zip.stream());
  assert.equal(archive.length, zip.bytes);
  const decoded = await inspect(t, archive); assert.deepEqual(decoded.map((v) => v.name), fixtures.map((f) => f.input.name));
  for (let n = 0; n < fixtures.length; n++) {
    const f = fixtures[n], row = decoded[n];
    assert.equal(row.bytes, f.expected.length); assert.equal(row.crc, crc32(f.expected)); assert.equal(row.method, 0);
    assert.equal(row.flags, 0x808); assert.equal(row.extra, ""); assert.deepEqual(row.date, [1980, 1, 1, 0, 0, 0]);
    assert.equal(row.sha256, createHash("sha256").update(f.expected).digest("hex"));
    assert.equal(f.state.opened, 1); assert.equal(f.state.closed, 1); assert.ok(f.state.chunks.every((b) => b.every((v) => v === 0)));
  }
  assert.equal(decoded.at(-1).crc, 0xcbf43926, "known CRC-32 is incremental across three-byte chunks");
  assert.deepEqual(events, fixtures.flatMap((f) => ["open:" + f.input.name, "close:" + f.input.name]));
  let offset = 0;
  for (const f of fixtures) {
    assert.equal(archive.readUInt32LE(offset), 0x04034b50); assert.equal(archive.readUInt32LE(offset + 14), 0);
    const descriptor = offset + 30 + f.input.name.length + f.expected.length;
    assert.equal(archive.readUInt32LE(descriptor), 0x08074b50); assert.equal(archive.readUInt32LE(descriptor + 4), crc32(f.expected));
    assert.equal(archive.readUInt32LE(descriptor + 8), f.expected.length); offset = descriptor + 16;
  }
  assert.equal(archive.readUInt32LE(offset), 0x02014b50); assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054b50);
  await zip.close(); assert.ok(fixtures.every((f) => f.state.closed === 1));
});

test("ZIP size and fixed-name validation reject unsafe metadata before opening anything", () => {
  let opened = 0; const valid = { name: name(1), bytes: 0, open() { opened++; } };
  const overhead = 22 + 92 + 2 * valid.name.length;
  assert.equal(createZipStream([{ ...valid, bytes: MAX_ZIP_STREAM_BYTES - overhead }]).bytes, MAX_ZIP_STREAM_BYTES);
  assert.throws(() => createZipStream([{ ...valid, bytes: MAX_ZIP_STREAM_BYTES - overhead + 1 }]), limited);
  assert.throws(() => createZipStream([valid], { maxBytes: overhead - 1 }), limited);
  assert.equal(createZipStream([valid], { maxBytes: overhead }).bytes, overhead);
  for (const filename of ["../conversation.json", "/conversation.json", "conversation.json\n", name(1) + "\0", "videos/" + "A".repeat(32) + ".mp4", "photos/x.jpg", "Conversation.htm", "videos/é.mp4"]) {
    assert.throws(() => createZipStream([{ ...valid, name: filename }]), unavailable);
  }
  assert.throws(() => createZipStream([valid, valid]), unavailable);
  for (const bytes of [-1, 1.5, NaN, Infinity, "1", 4294967296]) assert.throws(() => createZipStream([{ ...valid, bytes }]), unavailable);
  for (const maxBytes of [0, -1, 1.5, MAX_ZIP_STREAM_BYTES + 1]) assert.throws(() => createZipStream([valid], { maxBytes }), unavailable);
  assert.throws(() => createZipStream([valid], { signal: {} }), unavailable);
  assert.throws(() => createZipStream(new Array(1)), unavailable);
  assert.throws(() => createZipStream([valid], null), unavailable);
  assert.throws(() => createZipStream([valid]).stream(null), unavailable);
  assert.throws(() => createZipStream(Array(65536).fill(valid)), limited); assert.equal(opened, 0);
});

test("empty ZIP and zero-byte entries are valid ZIP32 archives", async (t) => {
  const empty = createZipStream([]), bytes = await collect(empty.stream());
  assert.equal(bytes.length, 22); assert.deepEqual(await inspect(t, bytes), []);
  const f = entry("LIRE-MOI.txt", Buffer.alloc(0)), zip = createZipStream([f.input]), archive = await collect(zip.stream());
  assert.equal(archive.length, zip.bytes); assert.equal((await inspect(t, archive))[0].crc, 0); assert.equal(f.state.closed, 1);
});

test("a lazy 100 MiB source advances with consumer demand and keeps no complete original", async () => {
  const size = 100 * 1024 * 1024; let generated = 0, closed = 0, previous = null;
  const zip = createZipStream([{ name: name(1), bytes: size, async open() {
    return { source: (async function* () {
      for (let offset = 0; offset < size; offset += MAX_ZIP_STREAM_CHUNK_BYTES) {
        if (previous) { assert.equal(previous[0], 0); assert.equal(previous.at(-1), 0); }
        previous = Buffer.alloc(Math.min(MAX_ZIP_STREAM_CHUNK_BYTES, size - offset), 0x6b); generated++; yield previous;
      }
    })(), async close() { closed++; } };
  } }]);
  const stream = zip.stream(); assert.equal(generated, 0);
  let observed = 0; const hash = createHash("sha256");
  const header = await stream.next(), filename = await stream.next(); observed += header.value.length + filename.value.length;
  assert.equal(generated, 0, "even the opener is deferred until the entry payload is requested");
  const first = await stream.next(), original = previous; hash.update(first.value); observed += first.value.length;
  assert.equal(generated, 1); assert.equal(original[0], 0x6b);
  const second = await stream.next(); hash.update(second.value); observed += second.value.length;
  assert.equal(generated, 2); assert.equal(original[0], 0); assert.equal(first.value[0], 0x6b, "transferred output is independent of wiped source");
  for (;;) { const next = await stream.next(); if (next.done) break; assert.ok(next.value.length <= MAX_ZIP_STREAM_CHUNK_BYTES); hash.update(next.value); observed += next.value.length; }
  assert.equal(observed, zip.bytes); assert.equal(generated, 400); assert.equal(closed, 1); assert.equal(previous[0], 0);
  assert.equal(hash.digest("hex").length, 64);
});

test("short, long, malformed or throwing sources close once and never emit a central directory or footer", async () => {
  for (const values of [[Buffer.from("ab")], [Buffer.from("abcd")], [Buffer.alloc(0)], [new Uint8Array(3)], [Buffer.alloc(MAX_ZIP_STREAM_CHUNK_BYTES + 1)], "throw"]) {
    let closed = 0; const chunks = [];
    const source = (async function* () { if (values === "throw") throw new Error("secret SQL private-path"); yield* values; })();
    const zip = createZipStream([{ name: name(1), bytes: 3, async open() { return { source, async close() { closed++; } }; } }]);
    await assert.rejects(async () => { for await (const chunk of zip.stream()) chunks.push(chunk); }, unavailable);
    assert.equal(closed, 1); const partial = Buffer.concat(chunks);
    assert.notEqual(partial.length >= 22 ? partial.readUInt32LE(partial.length - 22) : 0, 0x06054b50);
    assert.equal(partial.includes(Buffer.from([0x50, 0x4b, 0x01, 0x02])), false);
    for (const chunk of values === "throw" ? [] : values) if (Buffer.isBuffer(chunk)) assert.ok(chunk.every((v) => v === 0));
  }
});

test("source close and iterator failures are sanitized and prevent success metadata", async () => {
  for (const mode of ["close", "next", "shape"]) {
    let closed = 0; const partial = [];
    const source = mode === "shape" ? {} : { [Symbol.asyncIterator]() { return { async next() { if (mode === "next") throw new Error("secret SQL"); return { done: true }; } }; } };
    const zip = createZipStream([{ name: name(1), bytes: 0, async open() { return { source, async close() { closed++; if (mode === "close") throw new Error("private-path"); } }; } }]);
    await assert.rejects(async () => { for await (const chunk of zip.stream()) partial.push(chunk); }, unavailable);
    assert.equal(closed, 1); assert.equal(Buffer.concat(partial).includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])), false);
  }
});

test("close and iterator return before the first pull never open a source; streams are single-use", async () => {
  const f = entry(name(1), Buffer.from("data")), zip = createZipStream([f.input]), stream = zip.stream();
  assert.throws(() => zip.stream(), unavailable); assert.deepEqual(await stream.return(), { value: undefined, done: true });
  await zip.close(); await zip.close(); assert.equal(f.state.opened, 0); assert.equal(f.state.closed, 0);
  assert.deepEqual(await stream.next(), { value: undefined, done: true }); assert.throws(() => zip.stream(), unavailable);
  const before = entry(name(2), Buffer.from("data")), other = createZipStream([before.input]); await other.close();
  assert.throws(() => other.stream(), unavailable); assert.equal(before.state.opened, 0);
});

test("consumer return and throw wipe only source chunks and close the active handle exactly once", async () => {
  for (const mode of ["return", "throw", "close"]) {
    const f = entry(name(1), Buffer.from("abcdef")), later = entry(name(2), Buffer.from("unopened")), zip = createZipStream([f.input, later.input]), stream = zip.stream();
    await stream.next(); await stream.next(); const data = await stream.next();
    assert.equal(data.value.toString(), "abc"); assert.equal(f.state.closed, 0);
    if (mode === "return") await stream.return();
    if (mode === "throw") await assert.rejects(stream.throw(new Error("secret SQL")), unavailable);
    if (mode === "close") { await zip.close(); await assert.rejects(stream.next(), unavailable); }
    assert.ok(f.state.chunks[0].every((v) => v === 0)); assert.equal(data.value.toString(), "abc");
    assert.equal(f.state.closed, 1); assert.equal(later.state.opened, 0); await zip.close(); assert.equal(f.state.closed, 1);
  }
});

test("constructor and stream cancellation signals close a paused source without another pull", async () => {
  for (const selected of ["constructor", "stream"]) {
    const controller = new AbortController(), f = entry(name(1), Buffer.from("abcdef"));
    const zip = createZipStream([f.input], selected === "constructor" ? { signal: controller.signal } : {});
    const stream = zip.stream(selected === "stream" ? { signal: controller.signal } : {});
    await stream.next(); await stream.next(); const data = await stream.next();
    controller.abort(); await zip.close();
    assert.equal(f.state.closed, 1); assert.ok(f.state.chunks[0].every((v) => v === 0)); assert.equal(data.value.toString(), "abc");
    await assert.rejects(stream.next(), unavailable);
  }
  const controller = new AbortController(); controller.abort();
  const f = entry(name(1), Buffer.from("data")), zip = createZipStream([f.input], { signal: controller.signal });
  await assert.rejects(collect(zip.stream()), unavailable); assert.equal(f.state.opened, 0);
});

test("return during a pending next releases I/O before waiting for the source iterator", { timeout: 3000 }, async () => {
  const entered = deferred(), reading = deferred(); let closed = 0, returned = 0;
  const zip = createZipStream([{ name: name(1), bytes: 3, async open() { return {
    source: { [Symbol.asyncIterator]() { return { next() { entered.resolve(); return reading.promise; }, async return() { returned++; return { done: true }; } }; } },
    async close() { closed++; reading.reject(new Error("secret read cancelled")); },
  }; } }]);
  const stream = zip.stream(); await stream.next(); await stream.next();
  const pending = stream.next(), rejected = assert.rejects(pending, unavailable); await entered.promise;
  await stream.return(); await rejected; assert.equal(closed, 1); assert.equal(returned, 1); await zip.close();
});

test("abort during lazy open still closes the handle that arrives after cancellation", { timeout: 3000 }, async () => {
  const controller = new AbortController(), entered = deferred(); let closed = 0;
  const zip = createZipStream([{ name: name(1), bytes: 0, async open({ signal }) {
    entered.resolve(); await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    return { source: (async function* () {})(), async close() { closed++; } };
  } }], { signal: controller.signal });
  const stream = zip.stream(); await stream.next(); await stream.next();
  const pending = stream.next(), rejected = assert.rejects(pending, unavailable); await entered.promise;
  controller.abort(); await zip.close(); await rejected; assert.equal(closed, 1);
});
