import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import factory from "../node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs";
import { inspectImageInput } from "../public/image-preparation.js";
import { decodeHeicPixels, shrinkHeicPlane, limitHeicDecoder } from "../public/heic-decoder-worker.js";

// A generated colour pattern, never a customer original. The pinned native
// decoder must process actual HEVC bytes; mock planes alone cannot prove that.
const heic = Buffer.from(await readFile(new URL("fixtures/photo-1140.heic.b64", import.meta.url), "utf8"), "base64");
const failure = expected => error => error?.code === expected;
function dimensions(width, height) {
  const bytes = Buffer.from(heic), start = bytes.indexOf("ispe");
  assert.ok(start > 0); bytes.writeUInt32BE(width, start + 8); bytes.writeUInt32BE(height, start + 12);
  return bytes;
}
function mockLib({ context = { $$: { ptr: 11 } }, parseCode = 0, itemCount = 1, handle = 22,
  width = 64, height = 48, decoded, decodeError, version = "1.23.5", nativeSetter = true } = {}) {
  const calls = [];
  const record = (name, result) => (...args) => { calls.push([name, ...args]); return result; };
  const lib = {
    heif_get_version: () => version,
    _heif_context_set_maximum_image_size_limit: nativeSetter ? record("context.limit") : undefined,
    heif_error_code: { heif_error_Ok: 0 }, heif_colorspace: { heif_colorspace_RGB: 1 },
    heif_chroma: { heif_chroma_interleaved_RGBA: 10 }, heif_channel: { heif_channel_interleaved: 2 },
    heif_context_alloc: record("context.alloc", context),
    heif_context_read_from_memory: record("context.read", { code: parseCode }),
    heif_context_get_number_of_items: record("context.items", itemCount),
    heif_js_context_get_primary_image_handle: record("handle.get", handle),
    heif_image_handle_get_width: record("handle.width", width),
    heif_image_handle_get_height: record("handle.height", height),
    heif_js_decode_image2: async (...args) => {
      calls.push(["image.decode", ...args]); if (decodeError) throw decodeError;
      return decoded ?? { image: 33, channels: [{ id: 2, width, height, stride: width * 4, data: new Uint8Array(width * height * 4) }] };
    },
    heif_image_release: record("image.release"),
    heif_image_handle_release: record("handle.release"),
    heif_context_free: record("context.free"),
  };
  return { lib, calls, names: () => calls.map(call => call[0]) };
}

test("the pinned local HEVC decoder applies its native 64MP limit before reading, decodes the real HEIC and releases all native resources", async () => {
  assert.deepEqual(inspectImageInput(heic), { width: 64, height: 48, type: "image/heic", orientation: 1 });
  const lib = await factory({ print() {}, printErr() {} }), calls = [];
  assert.equal(lib.heif_get_version(), "1.23.5");
  const instrumented = Object.create(lib);
  instrumented._heif_context_set_maximum_image_size_limit = (pointer, maximumWidth) => {
    assert.ok(Number.isSafeInteger(pointer) && pointer > 0); assert.equal(maximumWidth, 8000);
    calls.push("context.limit"); lib._heif_context_set_maximum_image_size_limit(pointer, maximumWidth);
  };
  for (const name of ["heif_context_read_from_memory", "heif_js_decode_image2", "heif_image_release", "heif_image_handle_release", "heif_context_free"]) {
    instrumented[name] = (...args) => { calls.push(name); return lib[name](...args); };
  }
  const result = await decodeHeicPixels(heic, instrumented);
  assert.deepEqual([result.width, result.height, result.pixels.length], [64, 48, 64 * 48 * 4]);
  assert.ok(result.pixels.some((value, index) => index % 4 !== 3 && value > 100));
  assert.ok(result.pixels.every((value, index) => index % 4 !== 3 || value === 255));
  assert.deepEqual(calls, ["context.limit", "heif_context_read_from_memory", "heif_js_decode_image2", "heif_image_release", "heif_image_handle_release", "heif_context_free"]);
});

async function nativeDecodeOutcome(bytes, lib, maximumWidth) {
  const context = lib.heif_context_alloc(); let handle, decoded;
  try {
    limitHeicDecoder(context, lib, maximumWidth);
    const parsed = lib.heif_context_read_from_memory(context, bytes);
    assert.equal(parsed.code, lib.heif_error_code.heif_error_Ok);
    handle = lib.heif_js_context_get_primary_image_handle(context); assert.equal(handle.code, undefined);
    decoded = await lib.heif_js_decode_image2(handle, lib.heif_colorspace.heif_colorspace_RGB, lib.heif_chroma.heif_chroma_interleaved_RGBA);
    return { width: lib.heif_image_handle_get_width(handle), height: lib.heif_image_handle_get_height(handle),
      code: decoded.code?.value ?? 0, subcode: decoded.subcode?.value ?? 0 };
  } finally {
    if (decoded?.image) lib.heif_image_release(decoded.image);
    if (handle && !handle.code) lib.heif_image_handle_release(handle);
    lib.heif_context_free(context);
  }
}

test("the real codec setter limits pixel area: 54 squared rejects a 64 by 48 HEIC while 56 squared admits it", async () => {
  const lib = await factory({ print() {}, printErr() {} });
  assert.deepEqual(await nativeDecodeOutcome(heic, lib, 54), { width: 64, height: 48, code: 6, subcode: 1000 });
  assert.deepEqual(await nativeDecodeOutcome(heic, lib, 56), { width: 64, height: 48, code: 0, subcode: 0 });
});

test("a forged tiny ispe and primary handle cannot bypass the codec limit on the larger coded HEVC frame", async () => {
  const bytes = dimensions(1, 1), lib = await factory({ print() {}, printErr() {} });
  assert.deepEqual(inspectImageInput(bytes), { width: 1, height: 1, type: "image/heic", orientation: 1 });
  // The generous control reaches the later consistency error. The one-pixel
  // native budget must instead reject the 64x48 coded frame at its size guard.
  assert.deepEqual(await nativeDecodeOutcome(bytes, lib, 8000), { width: 1, height: 1, code: 2, subcode: 129 });
  const instrumented = Object.create(lib), calls = []; let nativeFailure;
  instrumented._heif_context_set_maximum_image_size_limit = (pointer, maximumWidth) => {
    assert.equal(maximumWidth, 8000); calls.push("limit");
    lib._heif_context_set_maximum_image_size_limit(pointer, 1);
  };
  instrumented.heif_context_read_from_memory = (...args) => { calls.push("read"); return lib.heif_context_read_from_memory(...args); };
  instrumented.heif_js_decode_image2 = async (...args) => {
    const decoded = await lib.heif_js_decode_image2(...args);
    nativeFailure = [decoded.code?.value, decoded.subcode?.value]; return decoded;
  };
  for (const name of ["heif_image_release", "heif_image_handle_release", "heif_context_free"]) {
    instrumented[name] = (...args) => { calls.push(name); return lib[name](...args); };
  }
  await assert.rejects(decodeHeicPixels(bytes, instrumented), failure("media_heic"));
  assert.deepEqual(nativeFailure, [6, 1000]);
  assert.deepEqual(calls, ["limit", "read", "heif_image_handle_release", "heif_context_free"]);
});

test("the pinned Embind adapter refuses changed versions, missing setters and invalid opaque pointers before native parsing", async () => {
  for (const options of [
    { version: "1.23.6" }, { version: null }, { nativeSetter: false }, { context: {} },
    ...[0, -1, 1.5, NaN, Infinity, 0x100000000].map(ptr => ({ context: { $$: { ptr } } })),
  ]) {
    const mock = mockLib(options);
    await assert.rejects(decodeHeicPixels(heic, mock.lib), failure("media_heic"));
    assert.deepEqual(mock.names(), ["context.alloc", "context.free"]);
  }
  for (const width of [0, -1, 1.5, NaN, Infinity, 8001]) {
    const mock = mockLib();
    assert.throws(() => limitHeicDecoder({ $$: { ptr: 11 } }, mock.lib, width), failure("media_heic"));
    assert.deepEqual(mock.names(), []);
  }
});

test("malicious container dimensions and structures are refused before allocating a decoder context", async () => {
  const invalidFlags = Buffer.from(heic); invalidFlags[invalidFlags.indexOf("ipma") + 7] = 2;
  const invalidBox = Buffer.from(heic); invalidBox.writeUInt32BE(invalidBox.length + 1, 0);
  const free = Buffer.from([0, 0, 0, 8, 102, 114, 101, 101]);
  for (const [bytes, expected] of [
    [dimensions(8001, 8000), "media_dimensions"],
    [dimensions(20000, 10000), "media_dimensions"],
    [dimensions(32769, 1), "media_dimensions"],
    [invalidFlags, "media_format"], [invalidBox, "media_format"],
    [Buffer.concat([heic, ...Array(4097).fill(free)]), "media_format"],
    [Buffer.from("not an HEIC image"), "media_format"],
  ]) {
    const mock = mockLib();
    await assert.rejects(decodeHeicPixels(bytes, mock.lib), failure(expected));
    assert.deepEqual(mock.names(), [], "no decoder/native allocation follows rejected container metadata");
  }
});

test("the decoder primary image dimensions and item count are bounded before allocating decoded pixels", async () => {
  for (const options of [{ width: 8001, height: 8000 }, { width: 32769, height: 1 },
    { width: 0, height: 48 }, { itemCount: 1025 }]) {
    const mock = mockLib(options);
    await assert.rejects(decodeHeicPixels(heic, mock.lib), failure(options.itemCount ? "media_heic" : "media_dimensions"));
    assert.equal(mock.names().includes("image.decode"), false);
    assert.equal(mock.names().at(-1), "context.free");
    if (!options.itemCount) assert.equal(mock.names().at(-2), "handle.release");
  }
});

test("every native allocation is released on parse, handle, decode and malformed plane failures", async () => {
  for (const [options, expected, releases] of [
    [{ context: 0 }, "media_heic", []],
    [{ parseCode: 4 }, "media_heic", ["context.free"]],
    [{ handle: { code: 4 } }, "media_heic", ["context.free"]],
    [{ decoded: { code: 4, image: 33 } }, "media_heic", ["image.release", "handle.release", "context.free"]],
    [{ decoded: { image: 33, channels: [] } }, "media_dimensions", ["image.release", "handle.release", "context.free"]],
    [{ decoded: { image: 33, channels: [{ id: 2, width: 64, height: 48, stride: 256, data: new Uint8Array(10) }] } },
      "media_dimensions", ["image.release", "handle.release", "context.free"]],
  ]) {
    const mock = mockLib(options);
    await assert.rejects(decodeHeicPixels(heic, mock.lib), failure(expected));
    assert.deepEqual(mock.names().filter(name => name.endsWith("release") || name.endsWith("free")), releases);
  }
  const mock = mockLib({ decodeError: new Error("synthetic decoder failure") });
  await assert.rejects(decodeHeicPixels(heic, mock.lib), /synthetic decoder failure/);
  assert.deepEqual(mock.names().slice(-2), ["handle.release", "context.free"]);
});

test("the native RGBA plane is sampled directly into a bounded opaque output without a second full-size allocation", () => {
  const width = 4096, height = 16, stride = width * 4 + 8, data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    data.set([60, 120, 200, 255], y * stride + x * 4);
  }
  const result = shrinkHeicPlane({ width, height, stride, data });
  assert.deepEqual([result.width, result.height], [2048, 8]);
  assert.equal(result.pixels.byteLength, 2048 * 8 * 4);
  assert.notEqual(result.pixels.buffer, data.buffer);
  assert.deepEqual([...result.pixels.slice(0, 4)], [60, 120, 200, 255]);
  assert.deepEqual([...shrinkHeicPlane({ width: 1, height: 1, stride: 4, data: new Uint8Array([0, 0, 0, 0]) }).pixels], [245, 238, 242, 255]);
  for (const bad of [
    { width: 1, height: 1, stride: 3, data },
    { width: 1, height: 2, stride: 8, data: new Uint8Array(8) },
    { width: 1, height: 1, stride: 4, data: new Uint16Array(4) },
    { width: 32769, height: 1, stride: 32769 * 4, data },
  ]) assert.throws(() => shrinkHeicPlane(bad), failure("media_dimensions"));
});
