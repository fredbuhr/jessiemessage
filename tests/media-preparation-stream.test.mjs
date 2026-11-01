import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { createImagePreparer, prepareImageStream, MAX_PREPARATION_INPUT_BYTES, MediaImageError } from "../server/media/image.mjs";

const code = expected => error => error instanceof MediaImageError && error.code === expected && error.cause === undefined;
const jpeg = Buffer.from([255, 216, 255, 217]);
const result = () => ({ full: jpeg, thumbnail: jpeg, width: 1, height: 1, thumbnailWidth: 1, thumbnailHeight: 1,
  digest: createHash("sha256").update(jpeg).digest() });
function harness({ writable = true, spawnError = false } = {}) {
  const children = [], timers = [];
  const prepare = createImagePreparer({
    forkProcess(url, args, options) {
      assert.ok(url.pathname.endsWith("/image-worker.mjs")); assert.deepEqual(args, []);
      assert.deepEqual(options.stdio, ["pipe", "ignore", "ignore", "ipc"]);
      assert.deepEqual(options.execArgv, ["--max-old-space-size=96"]); assert.equal(options.env.NODE_OPTIONS, undefined);
      if (spawnError) throw new Error("private-secret-spawn");
      const child = new EventEmitter(); child.pid = children.length + 1; child.stdin = new EventEmitter();
      child.chunks = []; child.stdin.write = chunk => { child.chunks.push(chunk); return writable; };
      child.stdin.end = () => { child.inputEnded = true; }; child.stdin.destroy = () => { child.inputDestroyed = true; };
      child.send = (request, callback) => { child.request = request; callback(null); };
      child.kill = signal => { child.killed = signal; return true; }; children.push(child); return child;
    },
    setTimer(callback, delay) { const timer = { callback, delay, cleared: false, unref() {} }; timers.push(timer); return timer; },
    clearTimer(timer) { if (timer) timer.cleared = true; },
  });
  const source = () => {
    const stream = new EventEmitter(); stream.pauses = 0; stream.resumes = 0;
    stream.pause = () => { stream.pauses++; }; stream.resume = () => { stream.resumes++; }; return stream;
  };
  return { prepare, children, timers, source };
}

test("original streaming uses stdin without an IPC copy, applies backpressure and separates body and decode deadlines", async () => {
  const h = harness({ writable: false }), source = h.source();
  const pending = h.prepare(source, { declaredBytes: jpeg.length }), child = h.children[0];
  assert.deepEqual(child.request, { preparation: true, stream: true, declaredBytes: jpeg.length, hint: null });
  assert.equal(h.timers[0].delay, 120000);
  source.emit("data", jpeg); assert.equal(child.chunks[0], jpeg, "the original chunk is passed directly to write");
  assert.equal(source.pauses, 1); child.stdin.emit("drain"); assert.equal(source.resumes, 1);
  source.emit("end"); assert.equal(child.inputEnded, true); assert.equal(h.timers[0].cleared, true);
  assert.equal(h.timers[1].delay, 30000); assert.equal(source.listenerCount("data"), 0);
  child.emit("message", { ok: true, result: result() }); assert.equal(child.killed, "SIGKILL");
  await assert.rejects(h.prepare(h.source()), code("MEDIA_BUSY"));
  child.emit("exit", 0); assert.deepEqual((await pending).full, jpeg);
  assert.ok(h.timers.every(timer => timer.cleared));
});

test("original streaming counts chunked bytes to 128 MiB and holds its single place until failed-child exit", async () => {
  const h = harness(), source = h.source(); const pending = h.prepare(source), denied = assert.rejects(pending, code("MEDIA_TOO_LARGE"));
  const chunk = Buffer.alloc(1024 * 1024), child = h.children[0];
  for (let index = 0; index <= 128; index++) source.emit("data", chunk);
  assert.equal(child.chunks.length, 128); assert.equal(child.killed, "SIGKILL"); assert.equal(child.inputDestroyed, true);
  assert.equal(source.listenerCount("data"), 0); assert.doesNotThrow(() => source.emit("error", new Error("private-secret-late")));
  await assert.rejects(h.prepare(h.source()), code("MEDIA_BUSY"));
  child.emit("exit", null, "SIGKILL"); await denied;
  const next = h.prepare(h.source()); h.children[1].emit("exit", 1); await assert.rejects(next, code("MEDIA_UNAVAILABLE"));
});

test("original streaming rejects impossible declared sizes before spawning and detects empty, short and extra bodies", async () => {
  const h = harness();
  for (const declaredBytes of [-1, 1.5, "4", MAX_PREPARATION_INPUT_BYTES + 1]) await assert.rejects(h.prepare(h.source(), { declaredBytes }), code("MEDIA_INPUT"));
  for (const value of [null, {}, { ...h.source(), readableEnded: true }, Object.assign(h.source(), { destroyed: true }), Object.assign(h.source(), { aborted: true })]) await assert.rejects(h.prepare(value), code("MEDIA_INPUT"));
  assert.equal(h.children.length, 0);
  for (const [declaredBytes, bytes] of [[null, Buffer.alloc(0)], [5, jpeg], [3, jpeg]]) {
    const source = h.source(), pending = h.prepare(source, { declaredBytes });
    const denied = assert.rejects(pending, code("MEDIA_INPUT")), child = h.children.at(-1);
    if (bytes.length) source.emit("data", bytes); source.emit("end");
    assert.equal(child.killed, "SIGKILL"); child.emit("exit", 1); await denied;
  }
});

test("body timeout, decode timeout, cancellation and early child crash clean listeners without releasing native work early", async () => {
  for (const failure of ["body", "decode", "abort", "error", "close", "crash"]) {
    const h = harness(), source = h.source(), pending = h.prepare(source);
    const expected = failure === "body" ? "MEDIA_TIMEOUT" : ["decode", "crash"].includes(failure) ? "MEDIA_UNAVAILABLE" : "MEDIA_INPUT";
    const denied = assert.rejects(pending, code(expected)), child = h.children[0];
    if (failure === "decode") { source.emit("data", jpeg); source.emit("end"); h.timers[1].callback(); }
    else if (failure === "body") h.timers[0].callback();
    else if (failure !== "crash") source.emit(failure === "abort" ? "aborted" : failure, new Error("private-secret-transport"));
    if (failure !== "crash") await assert.rejects(h.prepare(h.source()), code("MEDIA_BUSY"));
    child.emit("exit", 1); await denied;
    assert.equal(source.listenerCount("data"), 0); assert.ok(h.timers.every(timer => timer.cleared));
  }
});

test("spawn and IPC failures and oversized worker output fail closed with sanitized errors", async () => {
  const failing = harness({ spawnError: true });
  await assert.rejects(failing.prepare(failing.source()), code("MEDIA_UNAVAILABLE"));
  await assert.rejects(failing.prepare(failing.source()), code("MEDIA_UNAVAILABLE"));
  for (const failure of ["stdin", "ipc", "output"]) {
    const h = harness(), source = h.source(), pending = h.prepare(source), denied = assert.rejects(pending, code("MEDIA_UNAVAILABLE"));
    const child = h.children[0];
    if (failure === "stdin") child.stdin.emit("error", new Error("private-secret-pipe"));
    else if (failure === "ipc") child.emit("error", new Error("private-secret-ipc"));
    else { source.emit("data", jpeg); source.emit("end"); child.emit("message", { ok: true, result: { ...result(), full: Buffer.alloc(2097153) } }); }
    assert.equal(child.killed, "SIGKILL"); child.emit("exit", 1); await denied;
  }
});

test("RAW hints are a fixed enum passed as configuration without a filename or original IPC bytes", async () => {
  const h = harness();
  for (const hint of ["DNG", "jpeg", "../dng", "/private/name.dng", "dng,raf", 1]) await assert.rejects(h.prepare(h.source(), { hint }), code("MEDIA_INPUT"));
  assert.equal(h.children.length, 0);
  const source = h.source(), pending = h.prepare(source, { declaredBytes: 4, hint: "dng" }), child = h.children[0];
  assert.deepEqual(child.request, { preparation: true, stream: true, declaredBytes: 4, hint: "dng" });
  source.emit("data", jpeg); source.emit("end"); child.emit("message", { ok: true, result: result() }); child.emit("exit", 0); await pending;
});

test("real stdin preparation accepts a 75 MiB synthetic original with known or chunked length and strips its source padding", async () => {
  const base = await sharp({ create: { width: 64, height: 48, channels: 3, background: "red" } }).jpeg().toBuffer();
  const length = 75 * 1024 * 1024, padding = Buffer.alloc(64 * 1024);
  for (const declaredBytes of [length, null]) {
    async function* input() { yield base; let remaining = length - base.length; while (remaining) { const count = Math.min(padding.length, remaining); yield padding.subarray(0, count); remaining -= count; } }
    const prepared = await prepareImageStream(Readable.from(input()), { declaredBytes });
    assert.deepEqual([prepared.width, prepared.height], [64, 48]);
    assert.ok(prepared.full.length < 1000); assert.equal((await sharp(prepared.full).metadata()).format, "jpeg");
  }
});

test("real stdin HEIC preparation uses the pinned safe decoder and retains rotation through JPEG normalization", async () => {
  for (const [fixture, expected] of [["photo-1140.heic.b64", [64, 48]], ["photo-1150-rotated.heic.b64", [48, 64]]]) {
    const source = Buffer.from(await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8"), "base64");
    const prepared = await prepareImageStream(Readable.from([source]), { declaredBytes: source.length });
    assert.deepEqual([prepared.width, prepared.height], expected); assert.ok(prepared.full.length <= 2097152);
    const metadata = await sharp(prepared.full).metadata(); assert.equal(metadata.format, "jpeg");
    for (const name of ["exif", "icc", "iptc", "xmp", "orientation"]) assert.equal(metadata[name], undefined);
    assert.ok((await sharp(prepared.full).stats()).channels.some(channel => channel.max > channel.min));
  }
});

test("real stdin BMP, JXL and hinted RAW preparation enter the common bounded JPEG pipeline", async () => {
  const fixtures = JSON.parse(await readFile(new URL("./fixtures/photo-extra-codecs.json", import.meta.url), "utf8"));
  for (const [name, hint, expected] of [["bmp", null, [32, 24]], ["jxl", null, [24, 32]], ["dng", "dng", [128, 96]]]) {
    const source = Buffer.from(fixtures[name].base64, "base64");
    const prepared = await prepareImageStream(Readable.from([source]), { declaredBytes: source.length, hint });
    assert.deepEqual([prepared.width, prepared.height], expected); assert.ok(prepared.full.length <= 2097152);
    const metadata = await sharp(prepared.full).metadata(); assert.equal(metadata.format, "jpeg");
    for (const field of ["exif", "icc", "iptc", "xmp", "orientation"]) assert.equal(metadata[field], undefined);
    assert.equal((await sharp(prepared.full).raw().toBuffer()).length, prepared.width * prepared.height * 3);
  }
  const tiff = await sharp({ create: { width: 30, height: 20, channels: 3, background: "red" } }).tiff().toBuffer();
  const fallback = await prepareImageStream(Readable.from([tiff]), { declaredBytes: tiff.length, hint: "dng" });
  assert.deepEqual([fallback.width, fallback.height], [30, 20]);
  const pixels = await sharp(fallback.full).raw().toBuffer(); assert.ok(pixels[0] > 240 && pixels[1] < 15);
});
