import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { inspectImageInput, prepareImageUpload, ImagePreparationError, MAX_UPLOAD_BYTES, MAX_SOURCE_IMAGE_BYTES, TARGET_UPLOAD_BYTES } from "../public/image-preparation.js";

const source = await readFile(new URL("../public/image-preparation.js", import.meta.url), "utf8");
const solid = (width, height, format = "jpeg") => sharp({ create: { width, height, channels: 4,
  background: { r: 195, g: 37, b: 112, alpha: 0.3 } } })[format]().toBuffer();
const code = (expected) => (error) => error?.code === expected && error.message === "Image preparation failed.";

test("a real twenty-megapixel phone JPEG below ten MiB passes the bounded header inspection", async () => {
  const bytes = await solid(5000, 4000);
  assert.ok(bytes.length < MAX_UPLOAD_BYTES);
  assert.deepEqual(inspectImageInput(bytes), { width: 5000, height: 4000, type: "image/jpeg", orientation: 1 });
  for (const format of ["png", "webp"]) {
    const small = inspectImageInput(await solid(300, 200, format));
    assert.equal(small.width, 300); assert.equal(small.height, 200); assert.equal(small.type, `image/${format}`);
  }
});

test("EXIF orientation is read for JPEG, PNG and WebP without exposing or copying source metadata", async () => {
  for (const format of ["jpeg", "png", "webp"]) {
    const bytes = await sharp({ create: { width: 80, height: 40, channels: 3, background: "red" } })
      .withMetadata({ orientation: 6 }).withExif({ IFD0: { Artist: "private-source-metadata" } })[format]().toBuffer();
    assert.equal(inspectImageInput(bytes).orientation, 6, format);
  }
});

test("source pixel/side, compressed bytes and animation guards run before a browser decoder", async () => {
  const ordinary = await solid(10, 10, "png");
  for (const [width, height] of [[16385, 1], [8001, 8000]]) {
    // Patch a valid PNG header: the client must refuse without decoding pixels.
    const bytes = Buffer.from(ordinary); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
    assert.throws(() => inspectImageInput(bytes), code("media_dimensions"));
  }
  assert.throws(() => inspectImageInput(Buffer.alloc(MAX_SOURCE_IMAGE_BYTES + 1)), code("image_source_too_large"));
  assert.throws(() => inspectImageInput(Buffer.from("\0\0\0\x18ftypheic")), code("media_heic"));
  for (const bytes of [Buffer.from("GIF89a"), Buffer.from("<svg/>"), ordinary.subarray(0, 32)]) {
    assert.throws(() => inspectImageInput(bytes), code("media_format"));
  }
  const control = Buffer.alloc(20); control.writeUInt32BE(8); control.write("acTL", 4);
  assert.throws(() => inspectImageInput(Buffer.concat([ordinary.subarray(0, 33), control, ordinary.subarray(33)])), code("media_format"));
  const raw = Buffer.alloc(4 * 8 * 3, 120); raw.fill(220, raw.length / 2);
  const animated = await sharp(raw, { raw: { width: 4, height: 8, channels: 3, pageHeight: 4 } }).webp({ loop: 0, delay: [50, 50] }).toBuffer();
  assert.throws(() => inspectImageInput(animated), code("media_format"));
});

test("conflicting JPEG frames, duplicate PNG headers and WebP container/image dimensions are rejected before decoding", async () => {
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
  nativeFallback = false, noBitmap = false, nativeSize = [5000, 4000], onNativeLoaded } = {}) {
  const calls = [], canvases = [], bitmaps = [], nativeImages = [], urls = [], revokedUrls = [];
  class NativeImage {
    constructor() { this.naturalWidth = nativeSize[0]; this.naturalHeight = nativeSize[1]; nativeImages.push(this); }
    set src(value) { this.source = value; if (value) Promise.resolve().then(() => { onNativeLoaded?.(); this.onload?.(); }); }
    get src() { return this.source; }
  }
  const context = vm.createContext({ Blob, Uint8Array, DataView, Set, Error, Number, Math, DOMException, setTimeout, clearTimeout,
    Image: nativeFallback ? NativeImage : undefined,
    URL: nativeFallback ? { createObjectURL(file) { urls.push(file); return `blob:synthetic-${urls.length}`; }, revokeObjectURL(url) { revokedUrls.push(url); } } : undefined,
    createImageBitmap: noBitmap ? undefined : async (file, options) => {
      calls.push({ kind: "decode", file, options });
      if (decodeError) throw decodeError;
      const bitmap = decode ?? { width: options.resizeWidth, height: options.resizeHeight };
      bitmap.close = () => { bitmap.closed = true; }; bitmaps.push(bitmap); onDecoded?.(); return bitmap;
    },
    document: { createElement(kind) {
      assert.equal(kind, "canvas");
      const canvas = { width: 0, height: 0, getContext(type, options) {
        calls.push({ kind: "context", type, options });
        return contextAvailable ? { drawImage(bitmap, x, y, width, height) { calls.push({ kind: "draw", bitmap, x, y, width, height }); } } : null;
      }, toBlob(done, type, quality) {
        const size = outputSizes.length > 1 ? outputSizes.shift() : outputSizes[0];
        calls.push({ kind: "encode", type, quality, width: this.width, height: this.height });
        done(new Blob([new Uint8Array(size)], { type }));
      } };
      canvases.push(canvas); return canvas;
    } },
  });
  vm.runInContext(source.replace(/export /g, "") + "\nglobalThis.prepare = prepareImageUpload;", context);
  return { prepare: context.prepare, calls, canvases, bitmaps, nativeImages, urls, revokedUrls };
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

test("unavailable canvas, bad bytes, HEIC, oversized output and cancellation fail safely", async () => {
  const file = new Blob([await solid(30, 20)], { type: "image/jpeg" });
  const noCanvas = harness({ contextAvailable: false });
  await assert.rejects(noCanvas.prepare(file), code("media_unavailable"));
  assert.ok(noCanvas.bitmaps.every((bitmap) => bitmap.closed));
  await assert.rejects(harness({ decodeError: new Error("private decoder filename") }).prepare(file), code("media_format"));
  await assert.rejects(harness().prepare(new Blob([await solid(30, 20)], { type: "image/heic" })), code("media_heic"));
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

test("camera originals above the transport cap are inspected and prepared before transfer", async () => {
  const jpeg = await solid(5000, 4000);
  const original = new Blob([jpeg, new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type: "image/jpeg" });
  assert.ok(original.size > MAX_UPLOAD_BYTES && original.size < MAX_SOURCE_IMAGE_BYTES);
  const f = harness();
  assert.equal((await f.prepare(original)).size, 1000);
  assert.equal(f.calls.find(call => call.kind === "decode").options.resizeWidth, 2048);
  const overSourceLimit = new Blob([new Uint8Array(MAX_SOURCE_IMAGE_BYTES + 1)], { type: "image/jpeg" });
  await assert.rejects(f.prepare(overSourceLimit), code("image_source_too_large"));
  assert.equal(f.calls.filter(call => call.kind === "decode").length, 1, "oversized original never reaches decoder");
});

test("missing, generic and legacy MIME labels use the proven JPEG bytes for decoding", async () => {
  const bytes = await solid(40, 30);
  for (const type of ["", "application/octet-stream", "image/jpg", "image/pjpeg"]) {
    const f = harness();
    await f.prepare(new Blob([bytes], { type }));
    assert.equal(f.calls.find(call => call.kind === "decode").file.type, "image/jpeg");
  }
  await assert.rejects(harness().prepare(new Blob([bytes], { type: "image/png" })), code("media_format"));
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
