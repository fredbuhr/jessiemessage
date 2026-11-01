import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { inspectImageInput, prepareImageUpload, ImagePreparationError, MAX_UPLOAD_BYTES, MAX_SOURCE_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_PIXELS, MAX_SOURCE_IMAGE_SIDE, MAX_HEIC_IMAGE_PIXELS, TARGET_UPLOAD_BYTES } from "../public/image-preparation.js";

const source = await readFile(new URL("../public/image-preparation.js", import.meta.url), "utf8");
const solid = (width, height, format = "jpeg") => sharp({ create: { width, height, channels: 4,
  background: { r: 195, g: 37, b: 112, alpha: 0.3 } } })[format]().toBuffer();
const code = (expected) => (error) => error?.code === expected && error.message === "Image preparation failed.";
const heic = Buffer.from(await readFile(new URL("fixtures/photo-1140.heic.b64", import.meta.url), "utf8"), "base64");
const acceptanceFixtures = JSON.parse(await readFile(new URL("fixtures/photo-acceptance-formats.json", import.meta.url), "utf8")).fixtures;
function jpegDimensions(jpeg, width, height) {
  const bytes = Buffer.from(jpeg);
  let cursor = 2;
  while (cursor < bytes.length) {
    const marker = bytes[cursor + 1];
    if ([0xc0, 0xc2].includes(marker)) {
      bytes.writeUInt16BE(height, cursor + 5); bytes.writeUInt16BE(width, cursor + 7); return bytes;
    }
    cursor += 2 + bytes.readUInt16BE(cursor + 2);
  }
  assert.fail("synthetic JPEG has a frame header");
}

test("a real twenty-megapixel phone JPEG below ten MiB passes the bounded header inspection", async () => {
  const bytes = await solid(5000, 4000);
  assert.ok(bytes.length < MAX_UPLOAD_BYTES);
  assert.deepEqual(inspectImageInput(bytes), { width: 5000, height: 4000, type: "image/jpeg", orientation: 1 });
  for (const format of ["png", "webp", "avif"]) {
    const small = inspectImageInput(await solid(300, 200, format));
    assert.equal(small.width, 300); assert.equal(small.height, 200); assert.equal(small.type, `image/${format}`);
  }
  assert.deepEqual(inspectImageInput(heic), { width: 64, height: 48, type: "image/heic", orientation: 1 });
});

test("EXIF orientation is read for JPEG, PNG and WebP without exposing or copying source metadata", async () => {
  for (const format of ["jpeg", "png", "webp"]) {
    const bytes = await sharp({ create: { width: 80, height: 40, channels: 3, background: "red" } })
      .withMetadata({ orientation: 6 }).withExif({ IFD0: { Artist: "private-source-metadata" } })[format]().toBuffer();
    assert.equal(inspectImageInput(bytes).orientation, 6, format);
  }
});

test("software header inspection retains its pixel, byte and animation guards independently of native preparation", async () => {
  const ordinary = await solid(10, 10, "png");
  for (const [width, height] of [[MAX_SOURCE_IMAGE_SIDE + 1, 1], [16001, 16000]]) {
    // Patch a valid PNG header: the client must refuse without decoding pixels.
    const bytes = Buffer.from(ordinary); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
    assert.throws(() => inspectImageInput(bytes), code("media_dimensions"));
  }
  assert.throws(() => inspectImageInput(Buffer.alloc(MAX_SOURCE_IMAGE_BYTES + 1)), code("image_source_too_large"));
  assert.throws(() => inspectImageInput(Buffer.from("\0\0\0\x18ftypheic")), code("media_format"));
  for (const bytes of [Buffer.from("GIF89a"), Buffer.from("<svg/>"), ordinary.subarray(0, 32)]) {
    assert.throws(() => inspectImageInput(bytes), code("media_format"));
  }
  const control = Buffer.alloc(20); control.writeUInt32BE(8); control.write("acTL", 4);
  assert.throws(() => inspectImageInput(Buffer.concat([ordinary.subarray(0, 33), control, ordinary.subarray(33)])), code("media_format"));
  const raw = Buffer.alloc(4 * 8 * 3, 120); raw.fill(220, raw.length / 2);
  const animated = await sharp(raw, { raw: { width: 4, height: 8, channels: 3, pageHeight: 4 } }).webp({ loop: 0, delay: [50, 50] }).toBuffer();
  assert.throws(() => inspectImageInput(animated), code("media_format"));
});

test("software container inspection rejects conflicting JPEG frames, duplicate PNG headers and WebP dimensions", async () => {
  const jpeg = await solid(32, 16);
  let cursor = 2, frame;
  while (cursor < jpeg.length) {
    const marker = jpeg[cursor + 1];
    if ([0xc0, 0xc2].includes(marker)) { frame = jpeg.subarray(cursor, cursor + 2 + jpeg.readUInt16BE(cursor + 2)); break; }
    cursor += 2 + jpeg.readUInt16BE(cursor + 2);
  }
  assert.ok(frame);
  assert.throws(() => inspectImageInput(Buffer.concat([jpeg.subarray(0, cursor), frame, jpeg.subarray(cursor)])), code("media_format"));
  const png = await solid(32, 16, "png");
  assert.throws(() => inspectImageInput(Buffer.concat([png.subarray(0, 33), png.subarray(8, 33), png.subarray(33)])), code("media_format"));
  const webp = await solid(32, 16, "webp");
  assert.equal(webp.toString("ascii", 12, 16), "VP8X");
  const mismatch = Buffer.from(webp); mismatch[24] += 1;
  assert.throws(() => inspectImageInput(mismatch), code("media_format"));
});

function harness({ outputSizes = [1000], decodeError, contextAvailable = true, decode, onDecoded,
  nativeFallback = false, noBitmap = false, nativeSize = [5000, 4000], onNativeLoaded,
  workerResult, workerError, onWorkerPosted, fastTimers = false, pendingBitmap = false, fileReader,
  pendingEncode = false, encodeError } = {}) {
  const calls = [], canvases = [], bitmaps = [], nativeImages = [], urls = [], revokedUrls = [], workers = [];
  const encoders = []; let encodingReady;
  const encodingStarted = new Promise(resolve => { encodingReady = resolve; });
  let bitmapReady, continueBitmap;
  const bitmapStarted = new Promise(resolve => { bitmapReady = resolve; });
  const bitmapGate = new Promise(resolve => { continueBitmap = resolve; });
  class PhotoWorker {
    constructor(url, options) { this.url = url; this.options = options; workers.push(this); }
    postMessage(message, transfers) {
      this.message = message; this.transfers = transfers; onWorkerPosted?.();
      Promise.resolve().then(() => {
        if (workerError) this.onerror?.(workerError);
        else if (workerResult !== undefined) this.onmessage?.({ data: workerResult });
      });
    }
    terminate() { this.terminated = true; }
  }
  class NativeImage {
    constructor() { this.naturalWidth = nativeSize[0]; this.naturalHeight = nativeSize[1]; nativeImages.push(this); }
    set src(value) { this.source = value; if (value) Promise.resolve().then(() => { onNativeLoaded?.(); this.onload?.(); }); }
    get src() { return this.source; }
  }
  const context = vm.createContext({ Blob, ArrayBuffer, Uint8Array, Uint8ClampedArray, DataView, Set, Error, Number, Math, DOMException,
    ImageData: class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } },
    setTimeout: fastTimers ? (callback) => setTimeout(callback, 5) : setTimeout, clearTimeout,
    FileReader: fileReader,
    Worker: workerResult !== undefined || workerError || onWorkerPosted || fastTimers ? PhotoWorker : undefined,
    Image: nativeFallback ? NativeImage : undefined,
    URL: nativeFallback ? { createObjectURL(file) { urls.push(file); return `blob:synthetic-${urls.length}`; }, revokeObjectURL(url) { revokedUrls.push(url); } } : undefined,
    createImageBitmap: noBitmap ? undefined : async (file, options) => {
      calls.push({ kind: "decode", file, options });
      bitmapReady(); if (pendingBitmap) await bitmapGate;
      if (decodeError) throw decodeError;
      const bitmap = decode ?? { width: options.resizeWidth ?? nativeSize[0], height: options.resizeHeight ?? nativeSize[1] };
      bitmap.close = () => { bitmap.closed = true; }; bitmaps.push(bitmap); onDecoded?.(); return bitmap;
    },
    document: { createElement(kind) {
      assert.equal(kind, "canvas");
      const canvas = { width: 0, height: 0, getContext(type, options) {
        calls.push({ kind: "context", type, options });
        return contextAvailable ? {
          drawImage(bitmap, x, y, width, height) { calls.push({ kind: "draw", bitmap, x, y, width, height }); },
          putImageData(image, x, y) { calls.push({ kind: "pixels", width: image.width, height: image.height, pixels: [...image.data], x, y }); },
        } : null;
      }, toBlob(done, type, quality) {
        const size = outputSizes.length > 1 ? outputSizes.shift() : outputSizes[0];
        calls.push({ kind: "encode", type, quality, width: this.width, height: this.height });
        if (encodeError) throw encodeError;
        const finish = () => done(new Blob([new Uint8Array(size)], { type }));
        encoders.push(finish); encodingReady();
        if (!pendingEncode) finish();
      } };
      canvases.push(canvas); return canvas;
    } },
  });
  vm.runInContext(source.replace(/export /g, "") + "\nglobalThis.prepare = prepareImageUpload;", context);
  return { prepare: context.prepare, calls, canvases, bitmaps, nativeImages, urls, revokedUrls, workers,
    bitmapStarted, continueBitmap, encodingStarted, encoders };
}

test("preparation sizes a phone JPEG before decoding and releases its bitmap/canvas", async () => {
  const file = new Blob([await solid(5000, 4000)], { type: "image/jpeg" });
  const f = harness(); const prepared = await f.prepare(file);
  const decode = f.calls.find((call) => call.kind === "decode");
  assert.deepEqual({ ...decode.options }, { imageOrientation: "from-image", resizeWidth: 2048, resizeHeight: 1638, resizeQuality: "high" });
  const encode = f.calls.find((call) => call.kind === "encode");
  assert.equal(encode.type, "image/jpeg"); assert.equal(encode.quality, 0.88);
  assert.equal(prepared.size, 1000); assert.equal(prepared.type, "image/jpeg");
  assert.ok(f.bitmaps.every((bitmap) => bitmap.closed));
  assert.ok(f.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
});

test("transparent PNG/WebP keep alpha, use PNG and reduce further if the output exceeds the mobile transfer target", async () => {
  for (const format of ["png", "webp"]) {
    const f = harness({ outputSizes: [TARGET_UPLOAD_BYTES + 1, 1000] });
    const prepared = await f.prepare(new Blob([await solid(3000, 1500, format)], { type: `image/${format}` }));
    assert.equal(prepared.type, "image/png");
    assert.equal(f.calls.find((call) => call.kind === "context").options.alpha, true);
    assert.deepEqual(f.calls.filter((call) => call.kind === "encode").map(({ width, height }) => [width, height]), [[2048, 1024], [1536, 768]]);
  }
});

test("unavailable canvas, bad bytes, oversized output and cancellation fail safely", async () => {
  const file = new Blob([await solid(30, 20)], { type: "image/jpeg" });
  const noCanvas = harness({ contextAvailable: false });
  await assert.rejects(noCanvas.prepare(file), code("media_unavailable"));
  assert.ok(noCanvas.bitmaps.every((bitmap) => bitmap.closed));
  await assert.rejects(harness({ decodeError: new Error("private decoder filename") }).prepare(file), code("media_format"));
  await assert.rejects(harness({ decodeError: new Error("unsupported native HEIC") }).prepare(new Blob([heic], { type: "image/heic" })), code("media_heic"));
  const tooLarge = harness({ outputSizes: [TARGET_UPLOAD_BYTES + 1] });
  await assert.rejects(tooLarge.prepare(file), code("request_too_large"));
  assert.equal(tooLarge.calls.filter((call) => call.kind === "encode").length, 5);
  assert.ok(tooLarge.bitmaps.every((bitmap) => bitmap.closed));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareImageUpload(file, { signal: controller.signal }), (error) => error.name === "AbortError");
  const whileDecoding = new AbortController(); const interrupted = harness({ onDecoded() { whileDecoding.abort(); } });
  await assert.rejects(interrupted.prepare(file, { signal: whileDecoding.signal }), (error) => error.name === "AbortError");
  assert.ok(interrupted.bitmaps.every((bitmap) => bitmap.closed));
  assert.equal(interrupted.canvases.length, 0);
  await assert.rejects(prepareImageUpload(null), (error) => error instanceof ImagePreparationError && error.code === "media_format");
});

test("abort and deadline during canvas encoding release resources without waiting for a late callback", { timeout: 5000 }, async () => {
  const input = new Blob([await solid(32, 16)], { type: "image/jpeg" });
  for (const timeout of [false, true]) {
    const controller = new AbortController(), f = harness({ pendingEncode: true, fastTimers: timeout });
    const pending = f.prepare(input, { signal: controller.signal });
    await f.encodingStarted;
    if (!timeout) controller.abort();
    await assert.rejects(pending, timeout ? code("media_unavailable") : error => error.name === "AbortError");
    assert.ok(f.bitmaps.every(bitmap => bitmap.closed));
    assert.ok(f.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
    const oldEncodes = f.calls.filter(call => call.kind === "encode").length;
    f.encoders[0](); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.filter(call => call.kind === "encode").length, oldEncodes, "late output never starts another encoding attempt");
    const replacement = f.prepare(input);
    while (f.encoders.length < 2) await new Promise(resolve => setImmediate(resolve));
    f.encoders[1]();
    assert.equal((await replacement).type, "image/jpeg", "a replacement photo does not wait for the abandoned encoder");
  }
});

test("a synchronous canvas encoder failure is unavailable and releases the bitmap and canvas", async () => {
  const f = harness({ encodeError: new Error("private encoder diagnostic") });
  await assert.rejects(f.prepare(new Blob([await solid(32, 16)], { type: "image/jpeg" })), code("media_unavailable"));
  assert.ok(f.bitmaps.every(bitmap => bitmap.closed));
  assert.ok(f.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
});

test("camera originals above fifty MiB and two hundred megapixels request native shrink before any bounded canvas allocation", async () => {
  const jpeg = await solid(5000, 4000);
  const original = new Blob([jpegDimensions(jpeg, 20000, 10000), new Uint8Array(51 * 1024 * 1024)], { type: "image/jpeg" });
  assert.ok(original.size > 50 * 1024 * 1024 && original.size < MAX_SOURCE_IMAGE_BYTES);
  assert.equal(MAX_SOURCE_IMAGE_PIXELS, 256_000_000);
  assert.equal(inspectImageInput(jpegDimensions(jpeg, 20000, 10000)).width, 20000);
  const f = harness();
  assert.equal((await f.prepare(original)).size, 1000);
  const options = f.calls.find(call => call.kind === "decode").options;
  assert.deepEqual([options.resizeWidth, options.resizeHeight], [2048, 1024]);
  assert.ok(f.calls.filter(call => ["draw", "encode"].includes(call.kind)).every(call => call.width <= 2048 && call.height <= 2048));
  class LargeNativeBlob extends Blob {
    get size() { return MAX_SOURCE_IMAGE_BYTES + 1; }
    arrayBuffer() { assert.fail("native preparation must not read the entire large original into JavaScript"); }
  }
  const large = new LargeNativeBlob([jpeg], { type: "image/jpeg" });
  assert.equal((await f.prepare(large)).type, "image/jpeg");
  assert.equal(f.calls.filter(call => call.kind === "decode").length, 2, "the native path is not gated by the software input byte budget");
});

test("missing, generic, legacy and incorrect picker MIME labels use the proven JPEG bytes for decoding", async () => {
  const bytes = await solid(40, 30);
  for (const type of ["", "application/octet-stream", "image/jpg", "image/pjpeg", "image/png", "image/heic", "text/plain", "video/mp4"]) {
    const f = harness();
    await f.prepare(new Blob([bytes], { type }));
    assert.equal(f.calls.find(call => call.kind === "decode").file.type, "image/jpeg");
  }
  const fake = harness({ decodeError: new Error("not a decoded image") });
  await assert.rejects(fake.prepare(new Blob(["not a photo"], { type: "image/jpeg" })), code("media_format"));
  assert.equal(fake.calls.filter(call => call.kind === "decode").length, 1, "the native decoder still has to prove that bytes form an image");
  assert.equal(fake.canvases.length, 0);
});

test("AVIF uses its byte-proven MIME and preserves alpha through the bounded PNG output", async () => {
  const f = harness();
  const result = await f.prepare(new Blob([await solid(300, 150, "avif")], { type: "application/octet-stream" }));
  assert.equal(f.calls.find(call => call.kind === "decode").file.type, "image/avif");
  assert.equal(f.calls.find(call => call.kind === "context").options.alpha, true);
  assert.equal(result.type, "image/png");
});

test("a real MP4 remains a decoding failure instead of being admitted as a photo", async () => {
  const bytes = Buffer.from(await readFile(new URL("fixtures/video-decodable.mp4.base64", import.meta.url), "utf8"), "base64");
  const f = harness({ decodeError: new DOMException("The source is not an image", "InvalidStateError") });
  await assert.rejects(f.prepare(new Blob([bytes], { type: "image/jpeg" })), code("media_format"));
  assert.equal(f.calls.filter(call => call.kind === "decode").length, 1);
  assert.equal(f.canvases.length, 0); assert.equal(f.workers.length, 0);
});

test("native decoding can normalize generated GIF, BMP, TIFF, APNG, AVIF sequences and redundant JPEG metadata", async () => {
  for (const fixture of acceptanceFixtures) {
    const bytes = Buffer.from(fixture.base64, "base64");
    const f = harness({ decode: { width: fixture.preparedWidth, height: fixture.preparedHeight } });
    let backendCalls = 0;
    const output = await f.prepare(new Blob([bytes], { type: "application/octet-stream" }), {
      convert() { backendCalls += 1; assert.fail("a natively decoded image needs no server conversion"); },
    });
    assert.equal(f.calls.filter(call => call.kind === "decode").length, 1, fixture.name);
    assert.equal(backendCalls, 0, fixture.name);
    assert.ok(["image/jpeg", "image/png"].includes(output.type)); assert.ok(output.size <= TARGET_UPLOAD_BYTES);
    assert.ok(f.calls.filter(call => call.kind === "draw").every(call => call.width <= 2048 && call.height <= 2048));
    assert.ok(f.bitmaps.every(bitmap => bitmap.closed));
    if (fixture.name === "jpeg-duplicate-exif") {
      const options = f.calls.find(call => call.kind === "decode").options;
      assert.deepEqual([options.resizeWidth, options.resizeHeight], [24, 32]);
    }
    if (fixture.name === "jpeg-panorama") {
      const options = f.calls.find(call => call.kind === "decode").options;
      assert.deepEqual([options.resizeWidth, options.resizeHeight], [2048, 1]);
    }
  }
});

test("a caller-provided converter receives the original and signal once after local decoder failure", async () => {
  const input = new Blob([Buffer.from(acceptanceFixtures.find(row => row.name === "tiff-lzw").base64, "base64")], { type: "image/tiff" });
  const jpeg = new Blob([await solid(32, 24)], { type: "image/jpeg" });
  const controller = new AbortController(), f = harness({ decodeError: new Error("native TIFF unavailable") });
  const calls = [];
  assert.equal(await f.prepare(input, { signal: controller.signal, convert(file, options) {
    calls.push({ file, signal: options.signal }); return jpeg;
  } }), jpeg);
  assert.deepEqual(calls, [{ file: input, signal: controller.signal }]);
  assert.equal(f.calls.filter(call => call.kind === "encode").length, 0);
});

test("native HEIF and AVIF decoding owns crop geometry instead of stretching to container extents", async () => {
  for (const [bytes, type] of [[heic, "image/heic"], [await solid(64, 48, "avif"), "image/avif"]]) {
    const f = harness({ decode: { width: 40, height: 20 } });
    await f.prepare(new Blob([bytes], { type }));
    assert.deepEqual({ ...f.calls.find(call => call.kind === "decode").options }, { imageOrientation: "from-image" });
    const encode = f.calls.find(call => call.kind === "encode");
    assert.deepEqual([encode.width, encode.height], [40, 20]);
  }
});

test("local encoding resources are released before the converter runs, and HTTP errors are preserved without retry", async () => {
  const input = new Blob([await solid(32, 24)], { type: "image/jpeg" });
  const denied = Object.assign(new Error("synthetic authorization refusal"), { status: 403, code: "forbidden" });
  const f = harness({ contextAvailable: false }); let calls = 0;
  await assert.rejects(f.prepare(input, { convert() {
    calls += 1;
    assert.ok(f.bitmaps.every(bitmap => bitmap.closed));
    assert.ok(f.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
    throw denied;
  } }), error => error === denied);
  assert.equal(calls, 1);
});

test("converter output must be a bounded JPEG with bounded decoded dimensions", async () => {
  const input = new Blob(["synthetic unsupported raster"], { type: "image/tiff" });
  const jpeg = await solid(32, 24), wide = await solid(2049, 1);
  for (const output of [null, {}, new Blob([jpeg], { type: "image/png" }), new Blob(["not JPEG"], { type: "image/jpeg" }),
    new Blob([new Uint8Array(TARGET_UPLOAD_BYTES + 1)], { type: "image/jpeg" }), new Blob([wide], { type: "image/jpeg" })]) {
    const f = harness({ decodeError: new Error("unavailable native decoder") }); let calls = 0;
    await assert.rejects(f.prepare(input, { convert() { calls += 1; return output; } }), code("media_unavailable"));
    assert.equal(calls, 1);
  }
});

test("conversion is abortable even when its callback ignores cancellation, and late results are ignored", { timeout: 5000 }, async () => {
  const input = new Blob(["unsupported raster"], { type: "image/tiff" });
  const jpeg = new Blob([await solid(32, 24)], { type: "image/jpeg" });
  let began, deliver, calls = 0;
  const started = new Promise(resolve => { began = resolve; });
  const f = harness({ decodeError: new Error("native unavailable") }), controller = new AbortController();
  const pending = f.prepare(input, { signal: controller.signal, convert() {
    calls += 1; began(); return new Promise(resolve => { deliver = resolve; });
  } });
  await started; controller.abort();
  await assert.rejects(pending, error => error.name === "AbortError");
  deliver(jpeg); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(f.canvases.length, 0);
  let forbiddenCalls = 0;
  await assert.rejects(f.prepare(input, { signal: controller.signal, convert() { forbiddenCalls += 1; return jpeg; } }), error => error.name === "AbortError");
  assert.equal(forbiddenCalls, 0);
});

test("a high-definition original never falls back to an unbounded full-resolution native image", async () => {
  const jpeg = jpegDimensions(await solid(32, 16), 20000, 10000);
  const f = harness({ noBitmap: true, nativeFallback: true, nativeSize: [20000, 10000] });
  await assert.rejects(f.prepare(new Blob([jpeg], { type: "image/jpeg" })), code("media_unavailable"));
  assert.equal(f.nativeImages.length, 0); assert.equal(f.canvases.length, 0); assert.equal(f.urls.length, 0);
});

test("advisory cloud reads can abort or time out without blocking native preparation; late bytes are cleared", async () => {
  const jpeg = await solid(32, 16);
  for (const timeout of [false, true]) {
    let began, deliver;
    const started = new Promise(resolve => { began = resolve; });
    class CloudBlob extends Blob {
      arrayBuffer() { began(); return new Promise(resolve => { deliver = resolve; }); }
    }
    const input = new CloudBlob([jpeg], { type: "image/jpeg" }), controller = new AbortController();
    const f = harness({ fastTimers: timeout });
    const pending = f.prepare(input, { signal: controller.signal });
    await started; if (!timeout) controller.abort();
    if (timeout) assert.equal((await pending).type, "image/png", "a hint timeout does not reject a natively readable image");
    else {
      await assert.rejects(pending, error => error.name === "AbortError");
      assert.equal(f.calls.length, 0); assert.equal(f.canvases.length, 0);
    }
    assert.equal((await f.prepare(new Blob([jpeg], { type: "image/jpeg" }))).type, "image/jpeg",
      "a replacement photo does not wait for the abandoned cloud read");
    const oldDecodeCount = f.calls.filter(call => call.kind === "decode").length;
    const late = Uint8Array.from(jpeg).buffer; deliver(late);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(new Uint8Array(late).every(value => value === 0), "late private bytes are discarded and cleared");
    assert.equal(f.calls.filter(call => call.kind === "decode").length, oldDecodeCount,
      "late bytes never reach a decoder or replace the next photo");
  }
});

test("FileReader is used when available and its native read is aborted on cancellation, timeout and read error", async () => {
  const jpeg = await solid(32, 16);
  for (const outcome of ["success", "abort", "timeout", "error"]) {
    const readers = []; let began;
    const started = new Promise(resolve => { began = resolve; });
    class PhoneReader {
      constructor() { readers.push(this); this.aborts = 0; }
      readAsArrayBuffer(file) {
        this.file = file; this.savedLoad = this.onload; began();
        if (outcome === "success") Blob.prototype.arrayBuffer.call(file).then(buffer => { this.result = buffer; this.onload?.(); });
        if (outcome === "error") Promise.resolve().then(() => this.onerror?.());
      }
      abort() { this.aborts += 1; this.onabort?.(); }
    }
    class PhoneBlob extends Blob { arrayBuffer() { assert.fail("native FileReader must own the cancellable phone read"); } }
    const controller = new AbortController(), f = harness({ fileReader: PhoneReader, fastTimers: outcome === "timeout" });
    const input = new PhoneBlob([jpeg], { type: "image/jpeg" });
    const pending = f.prepare(input, { signal: controller.signal });
    await started; if (outcome === "abort") controller.abort();
    if (outcome === "success") assert.equal((await pending).type, "image/jpeg");
    else if (outcome === "abort") await assert.rejects(pending, error => error.name === "AbortError");
    else assert.equal((await pending).type, "image/png", "unavailable hints leave native decoding available");
    const reader = readers[0]; assert.equal(readers.length, 1); assert.equal(reader.file, input);
    assert.equal(reader.aborts, outcome === "success" ? 0 : 1);
    for (const handler of ["onload", "onerror", "onabort"]) assert.equal(reader[handler], null, `${outcome}: ${handler} detached`);
    if (outcome !== "success") {
      const oldDecodeCount = f.calls.filter(call => call.kind === "decode").length;
      assert.equal(oldDecodeCount, outcome === "abort" ? 0 : 1);
      const late = Uint8Array.from(jpeg).buffer; reader.result = late; reader.savedLoad();
      assert.ok(new Uint8Array(late).every(value => value === 0));
      assert.equal(f.calls.filter(call => call.kind === "decode").length, oldDecodeCount);
    }
  }
});

test("abort and decoder deadlines settle promptly and close an ImageBitmap which arrives after cancellation", async () => {
  const input = new Blob([await solid(32, 16)], { type: "image/jpeg" });
  const controller = new AbortController();
  const aborted = harness({ pendingBitmap: true, nativeFallback: true });
  const result = aborted.prepare(input, { signal: controller.signal });
  await aborted.bitmapStarted; controller.abort();
  await assert.rejects(result, error => error.name === "AbortError");
  assert.equal(aborted.nativeImages.length, 0, "session cancellation never starts the fallback decoder");
  aborted.continueBitmap(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(aborted.bitmaps.length, 1); assert.equal(aborted.bitmaps[0].closed, true);
  assert.equal(aborted.canvases.length, 0);

  const timedOut = harness({ pendingBitmap: true, fastTimers: true });
  const late = timedOut.prepare(input); await timedOut.bitmapStarted;
  await assert.rejects(late, code("media_unavailable"));
  timedOut.continueBitmap(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(timedOut.bitmaps.length, 1); assert.equal(timedOut.bitmaps[0].closed, true);
  assert.equal(timedOut.canvases.length, 0);
});

test("HEIC fallback uses one fixed local disposable module worker and only returns a bounded JPEG", async () => {
  const output = new Blob([new Uint8Array(1000)], { type: "image/jpeg" });
  const f = harness({ decodeError: new Error("native HEIC not supported"), workerResult: { ok: true, blob: output } });
  assert.equal(await f.prepare(new Blob([heic], { type: "application/octet-stream" })), output);
  assert.equal(f.workers.length, 1);
  const worker = f.workers[0];
  assert.equal(worker.url, "/heic-decoder-worker.js");
  assert.deepEqual({ ...worker.options }, { type: "module", name: "JessieMessage photo" });
  assert.equal(worker.transfers[0], worker.message.bytes);
  assert.equal(worker.message.acceptPixels, true);
  assert.equal(worker.message.bytes.byteLength, heic.length);
  assert.equal(worker.terminated, true); assert.equal(f.canvases.length, 0);
  for (const blob of [new Blob(["x"], { type: "image/png" }), new Blob([], { type: "image/jpeg" }),
    new Blob([new Uint8Array(TARGET_UPLOAD_BYTES + 1)], { type: "image/jpeg" })]) {
    const invalid = harness({ noBitmap: true, workerResult: { ok: true, blob } });
    await assert.rejects(invalid.prepare(new Blob([heic])), code("media_unavailable"));
    assert.equal(invalid.workers[0].terminated, true);
  }
});

test("HEIC server-first conversion avoids the full original read and software worker allocation", async () => {
  class PhoneHEIC extends Blob {
    get size() { return 1024 * 1024; }
    arrayBuffer() { assert.fail("the complete HEIC original is not read for server-first conversion"); }
  }
  const input = new PhoneHEIC([heic], { type: "image/heic" });
  const output = new Blob([await solid(64, 48)], { type: "image/jpeg" });
  const controller = new AbortController(), f = harness({ noBitmap: true, workerResult: { ok: true, blob: output } });
  let calls = 0;
  assert.equal(await f.prepare(input, { signal: controller.signal, convert(file, { signal }) {
    calls += 1; assert.equal(file, input); assert.equal(signal, controller.signal);
    assert.equal(f.workers.length, 0); assert.equal(f.canvases.length, 0);
    return output;
  } }), output);
  assert.equal(calls, 1); assert.equal(f.workers.length, 0); assert.equal(f.canvases.length, 0);
});

test("HEIC server-first404 keeps local compatibility without a second conversion even when software fails", async () => {
  const input = new Blob([heic], { type: "image/heic" });
  const output = new Blob([await solid(64, 48)], { type: "image/jpeg" });
  for (const success of [true, false]) {
    const f = harness({ noBitmap: true, workerResult: success ? { ok: true, blob: output } : { ok: false, code: "media_heic" } });
    let calls = 0;
    const pending = f.prepare(input, { convert() {
      calls += 1; assert.equal(f.workers.length, 0);
      throw Object.assign(new Error("old preparation route"), { status: 404, code: "not_found" });
    } });
    if (success) assert.equal(await pending, output);
    else await assert.rejects(pending, code("media_heic"));
    assert.equal(calls, 1); assert.equal(f.workers.length, 1); assert.equal(f.workers[0].terminated, true);
  }
});

test("HEIC server-first failures preserve auth, resource and stale errors without starting software", async () => {
  const input = new Blob([heic], { type: "image/heic" });
  const errors = [401, 403, 422, 429, 503].map(status => Object.assign(new Error("synthetic HTTP refusal"), { status, code: "refused" }));
  errors.push(Object.assign(new Error("old owner"), { stale: true, status: 404 }));
  for (const error of errors) {
    const f = harness({ noBitmap: true, workerResult: { ok: false, code: "media_heic" } }); let calls = 0;
    await assert.rejects(f.prepare(input, { convert() { calls += 1; throw error; } }), failure => failure === error);
    assert.equal(calls, 1); assert.equal(f.workers.length, 0); assert.equal(f.canvases.length, 0);
  }
});

test("HEIC server-first conversion aborts without a software fallback or adoption of late output", async () => {
  const input = new Blob([heic], { type: "image/heic" }), controller = new AbortController();
  const output = new Blob([await solid(64, 48)], { type: "image/jpeg" });
  const f = harness({ noBitmap: true, workerResult: { ok: true, blob: output } });
  let begin, deliver, calls = 0; const started = new Promise(resolve => { begin = resolve; });
  const pending = f.prepare(input, { signal: controller.signal, convert() {
    calls += 1; begin(); return new Promise(resolve => { deliver = resolve; });
  } });
  await started; controller.abort();
  await assert.rejects(pending, error => error.name === "AbortError");
  deliver(output); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(f.workers.length, 0); assert.equal(f.canvases.length, 0);
});

test("a valid HEIC container reaches the native-guarded worker despite an advisory parser limit", async () => {
  const free = Buffer.from([0, 0, 0, 8, 102, 114, 101, 101]);
  const bytes = Buffer.concat([heic, ...Array(4097).fill(free)]);
  assert.throws(() => inspectImageInput(bytes), code("media_format"));
  const output = new Blob(["bounded-jpeg"], { type: "image/jpeg" });
  const f = harness({ noBitmap: true, workerResult: { ok: true, blob: output } });
  assert.equal(await f.prepare(new Blob([bytes])), output);
  assert.equal(f.workers.length, 1);
  assert.equal(f.workers[0].message.bytes.byteLength, bytes.length);
});

test("HEIC worker pixels are bounded and encoded with the document canvas when worker canvas is unavailable", async () => {
  const pixels = new Uint8ClampedArray([200, 40, 120, 255, 30, 80, 200, 255]);
  const f = harness({ noBitmap: true, workerResult: { ok: true, pixels: pixels.buffer, width: 2, height: 1 } });
  const output = await f.prepare(new Blob([heic], { type: "image/heic" }));
  assert.equal(output.type, "image/jpeg"); assert.equal(output.size, 1000);
  assert.deepEqual(f.calls.find(call => call.kind === "pixels"), { kind: "pixels", width: 2, height: 1,
    pixels: [200, 40, 120, 255, 30, 80, 200, 255], x: 0, y: 0 });
  assert.ok(pixels.every(value => value === 0), "the reduced transferred plane is cleared after its canvas copy");
  assert.equal(f.canvases.length, 2);
  assert.ok(f.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  assert.equal(f.workers[0].terminated, true);
});

test("malformed or oversized HEIC worker pixel messages never allocate a document canvas", async () => {
  const input = new Blob([heic], { type: "image/heic" });
  for (const result of [
    { pixels: new ArrayBuffer(4), width: 0, height: 1 },
    { pixels: new ArrayBuffer(4), width: 1, height: -1 },
    { pixels: new ArrayBuffer(4), width: 1.5, height: 1 },
    { pixels: new ArrayBuffer(4), width: 2049, height: 1 },
    { pixels: new ArrayBuffer(4), width: 1, height: 2049 },
    { pixels: new ArrayBuffer(3), width: 1, height: 1 },
    { pixels: new ArrayBuffer(8), width: 1, height: 1 },
    { pixels: new Uint8ClampedArray(4), width: 1, height: 1 },
    { pixels: { byteLength: 4 }, width: 1, height: 1 },
    { width: 1, height: 1 },
    { pixels: new ArrayBuffer(4), width: 1, height: 1, blob: new Blob(["x"], { type: "image/jpeg" }) },
  ]) {
    const f = harness({ noBitmap: true, workerResult: { ok: true, ...result } });
    await assert.rejects(f.prepare(input), code("media_unavailable"));
    assert.equal(f.canvases.length, 0); assert.equal(f.workers[0].terminated, true);
  }
});

test("HEIC document encoding can abort or time out and ignores a late callback after cleanup", { timeout: 5000 }, async () => {
  for (const timeout of [false, true]) {
    const controller = new AbortController(), pixels = new Uint8ClampedArray([200, 40, 120, 255]);
    const f = harness({ noBitmap: true, pendingEncode: true, fastTimers: timeout,
      workerResult: { ok: true, pixels: pixels.buffer, width: 1, height: 1 } });
    const pending = f.prepare(new Blob([heic]), { signal: controller.signal });
    await f.encodingStarted; if (!timeout) controller.abort();
    await assert.rejects(pending, timeout ? code("media_unavailable") : error => error.name === "AbortError");
    assert.ok(f.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
    assert.ok(pixels.every(value => value === 0));
    f.encoders[0](); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.filter(call => call.kind === "encode").length, 1);
  }
});

test("HEIC worker errors, timeout and abort release the worker and preserve safe error categories", async () => {
  const input = new Blob([heic], { type: "image/heic" });
  for (const [options, expected] of [
    [{ workerError: new Error("private source filename") }, "media_heic"],
    [{ workerResult: { ok: false, code: "media_dimensions" } }, "media_dimensions"],
    [{ workerResult: { ok: false, code: "private decoder diagnosis" } }, "media_heic"],
    [{ fastTimers: true }, "media_unavailable"],
  ]) {
    const f = harness({ noBitmap: true, ...options });
    await assert.rejects(f.prepare(input), code(expected)); assert.equal(f.workers[0].terminated, true);
  }
  const controller = new AbortController();
  const f = harness({ noBitmap: true, onWorkerPosted: () => controller.abort() });
  await assert.rejects(f.prepare(input, { signal: controller.signal }), error => error.name === "AbortError");
  assert.equal(f.workers[0].terminated, true);
  const oversized = Buffer.from(heic), ispe = oversized.indexOf("ispe");
  oversized.writeUInt32BE(8001, ispe + 8); oversized.writeUInt32BE(8000, ispe + 12);
  assert.ok(8001 * 8000 > MAX_HEIC_IMAGE_PIXELS);
  const blocked = harness({ noBitmap: true, workerResult: { ok: false, code: "media_dimensions" } });
  await assert.rejects(blocked.prepare(new Blob([oversized])), code("media_dimensions"));
  assert.equal(blocked.workers.length, 1, "libheif owns the actual primary/coded-size guard instead of a metadata-only gate");
});

test("HEIC software decodes stay serial while a queued cancellation does not wait for the active photo", async () => {
  const input = new Blob([heic], { type: "image/heic" });
  let activeReady;
  const activeStarted = new Promise(resolve => { activeReady = resolve; });
  const f = harness({ noBitmap: true, onWorkerPosted: activeReady });
  const activeController = new AbortController(), queuedController = new AbortController();
  const active = f.prepare(input, { signal: activeController.signal });
  const activeRejection = assert.rejects(active, error => error.name === "AbortError");
  await activeStarted;
  const queued = f.prepare(input, { signal: queuedController.signal });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.workers.length, 1, "the waiting photo never creates a second decoder");
  queuedController.abort();
  try {
    await assert.rejects(Promise.race([queued, new Promise((_, reject) => setTimeout(() => reject(new Error("queued abort was blocked by active decode")), 100))]),
      error => error.name === "AbortError");
    assert.equal(f.workers.length, 1); assert.notEqual(f.workers[0].terminated, true);
  } finally { activeController.abort(); await activeRejection; }
  const next = f.prepare(input);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.workers.length, 2, "cancelled queue turn is released after the original decoder finishes");
  f.workers[1].onmessage({ data: { ok: true, blob: new Blob(["x"], { type: "image/jpeg" }) } });
  assert.equal((await next).type, "image/jpeg"); assert.equal(f.workers[1].terminated, true);
});

test("phone decoder fallback handles absent ImageBitmap or rejected resize options and releases native image URLs", async () => {
  const file = new Blob([await solid(5000, 4000)], { type: "image/jpeg" });
  for (const options of [{ noBitmap: true }, { decodeError: new TypeError("unsupported bitmap options") }]) {
    const f = harness({ ...options, nativeFallback: true });
    const prepared = await f.prepare(file);
    assert.equal(prepared.size, 1000);
    const draw = f.calls.find(call => call.kind === "draw");
    assert.deepEqual([draw.width, draw.height], [2048, 1638]);
    assert.equal(f.nativeImages[0].src, "");
    assert.deepEqual(f.revokedUrls, ["blob:synthetic-1"]);
    assert.ok(f.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  }
  const controller = new AbortController();
  const interrupted = harness({ noBitmap: true, nativeFallback: true, onNativeLoaded: () => controller.abort() });
  await assert.rejects(interrupted.prepare(file, { signal: controller.signal }), error => error.name === "AbortError");
  assert.equal(interrupted.nativeImages[0].src, "");
  assert.deepEqual(interrupted.revokedUrls, ["blob:synthetic-1"]);
});
