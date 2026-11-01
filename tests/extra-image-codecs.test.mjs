import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { decodeExtraImage, detectExtraImageFormat } from "../server/media/extra-image-codecs.mjs";

const source = JSON.parse(await readFile(new URL("./fixtures/photo-extra-codecs.json", import.meta.url), "utf8"));
const fixture = name => {
  const bytes = Buffer.from(source[name].base64, "base64");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), source[name].sha256); return bytes;
};
const heic = Buffer.from(await readFile(new URL("./fixtures/photo-1140.heic.b64", import.meta.url), "utf8"), "base64");
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>');
const rejected = code => error => { assert.equal(error.code, code); assert.equal(error.message, "Photo conversion failed."); return true; };
function bmp(width, height) {
  const stride = Math.ceil(width * 3 / 4) * 4, result = Buffer.alloc(54 + stride * height);
  result.write("BM"); result.writeUInt32LE(result.length, 2); result.writeUInt32LE(54, 10); result.writeUInt32LE(40, 14);
  result.writeInt32LE(width, 18); result.writeInt32LE(height, 22); result.writeUInt16LE(1, 26); result.writeUInt16LE(24, 28);
  for (let i = 54; i < result.length; i += 3) { result[i] = 40; if (i + 1 < result.length) result[i + 1] = 80; if (i + 2 < result.length) result[i + 2] = 180; }
  return result;
}
function ftyp(...brands) {
  const result = Buffer.alloc(16 + (brands.length - 1) * 4); result.writeUInt32BE(result.length); result.write("ftyp", 4); result.write(brands[0], 8);
  for (let i = 1; i < brands.length; i++) result.write(brands[i], 12 + i * 4); return result;
}
function rawOrientation(bytes, orientation) {
  const copy = Buffer.from(bytes), offset = copy.readUInt32LE(4), count = copy.readUInt16LE(offset), entries = [];
  for (let index = 0; index < count; index++) {
    const entry = Buffer.from(copy.subarray(offset + 2 + index * 12, offset + 14 + index * 12));
    if (entry.readUInt16LE(0) === 271) { // Replace optional camera Make with standard TIFF orientation.
      entry.writeUInt16LE(274, 0); entry.writeUInt16LE(3, 2); entry.writeUInt32LE(1, 4); entry.writeUInt32LE(orientation, 8);
    }
    entries.push(entry);
  }
  entries.sort((a, b) => a.readUInt16LE(0) - b.readUInt16LE(0));
  for (let index = 0; index < entries.length; index++) entries[index].copy(copy, offset + 2 + index * 12);
  return copy;
}

test("extra format detection keeps signatures primary and RAW hints restricted to compatible families", () => {
  assert.equal(detectExtraImageFormat(fixture("bmp")), "bmp"); assert.equal(detectExtraImageFormat(fixture("jxl")), "jxl");
  assert.equal(detectExtraImageFormat(fixture("avif")), "avif");
  assert.equal(detectExtraImageFormat(fixture("dng")), null); assert.equal(detectExtraImageFormat(fixture("dng"), { hint: "dng" }), "raw");
  const jpeg = Buffer.from([255, 216, 255, 224, 0, 16]);
  for (const hint of ["dng", "cr3", "nef", "raf", "../private.raw"]) assert.equal(detectExtraImageFormat(jpeg, { hint }), null);
  for (const [bytes, hint] of [[Buffer.from("IIRO"), "orf"], [Buffer.from("IIU\0"), "rw2"], [Buffer.from("FUJIFILMCCD-RAW "), "raf"], [ftyp("crx ", "isom"), "cr3"]]) {
    assert.equal(detectExtraImageFormat(bytes, { hint }), "raw");
  }
  for (const hint of ["dng", "cr3", "raf"]) assert.equal(detectExtraImageFormat(heic, { hint }), null);
  assert.equal(detectExtraImageFormat(ftyp("crx ", "heic"), { hint: "cr3" }), null);
  assert.equal(detectExtraImageFormat(ftyp("crx ", "avif"), { hint: "cr3" }), "avif");
  assert.equal(detectExtraImageFormat(ftyp("heic", "avif"), { hint: "cr3" }), null);
  const extended = Buffer.alloc(28); extended.writeUInt32BE(1); extended.write("ftyp", 4); extended.writeBigUInt64BE(28n, 8);
  extended.write("avif", 16); extended.write("mif1", 24);
  assert.equal(detectExtraImageFormat(extended), "avif", "extended-size ftyp remains a valid family hint");
  const disguised = ftyp("crx ", "isom"); disguised[8] |= 128;
  assert.equal(detectExtraImageFormat(disguised, { hint: "cr3" }), null, "high-bit bytes are not ASCII brand aliases");
  assert.equal(detectExtraImageFormat(svg, { hint: "dng" }), null);
});

test("forced BMP, JXL and LibRaw DNG produce actual reduced RGBA without mutating the source", async () => {
  for (const [name, format, hint, expected] of [["bmp", "bmp", null, [32, 24]], ["jxl", "jxl", null, [24, 32]], ["dng", "raw", "dng", [32, 24]]]) {
    const bytes = fixture(name), digest = createHash("sha256").update(bytes).digest("hex");
    const image = await decodeExtraImage(bytes, format, { hint, targetSide: 32 });
    assert.deepEqual([image.width, image.height], expected); assert.equal(image.channels, 4); assert.ok(Buffer.isBuffer(image.data));
    assert.equal(image.data.length, image.width * image.height * 4);
    assert.ok(image.data.some((value, index) => index % 4 !== 3 && value > 20), "native decoded colour pixels are present");
    assert.ok(image.data.every((value, index) => index % 4 !== 3 || value === 255), "synthetic rasters remain opaque");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), digest); image.data.fill(0);
  }
});

test("RAW prefers its embedded JPEG during native ping, then Sharp normalizes the preview", async () => {
  const bytes = fixture("dngThumbnail"), before = createHash("sha256").update(bytes).digest("hex");
  const preview = await decodeExtraImage(bytes, "raw", { hint: "dng" });
  assert.deepEqual([preview.width, preview.height, preview.channels], [64, 48, 4], "embedded preview is used instead of the 128x96 sensor raster");
  assert.ok(Math.abs(preview.data[0] - 170) < 4 && Math.abs(preview.data[1] - 50) < 4 && Math.abs(preview.data[2] - 110) < 4);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), before); preview.data.fill(0);
  const portrait = await decodeExtraImage(rawOrientation(bytes, 6), "raw", { hint: "dng", targetSide: 32 });
  assert.deepEqual([portrait.width, portrait.height, portrait.channels], [24, 32, 4], "native RAW orientation is applied once when JPEG has no orientation");
  portrait.data.fill(0);
});

test("AVIF uses the separate decoder without initializing Magick's older HEIF code", () => {
  const script = `import {readFile} from "node:fs/promises";
    import {decodeExtraImage} from "./server/media/extra-image-codecs.mjs";
    import {Magick} from "@imagemagick/magick-wasm";
    const cold=()=>{try{void Magick.delegates;return false;}catch{return true;}};
    const fixtures=JSON.parse(await readFile("tests/fixtures/photo-extra-codecs.json","utf8"));
    const bytes=Buffer.from(fixtures.avif.base64,"base64"),before=cold(),image=await decodeExtraImage(bytes,"avif");
    const small=await decodeExtraImage(bytes,"avif",{targetSide:32});
    let restricted;try{await decodeExtraImage(bytes,"avif",{maxPixels:100});}catch(error){restricted=error.code;}
    console.log(JSON.stringify({before,after:cold(),width:image.width,height:image.height,channels:image.channels,bytes:image.data.length,
      small:[small.width,small.height],restricted}));
    image.data.fill(0);small.data.fill(0);`;
  const result = spawnSync(process.execPath, ["--max-old-space-size=96", "--input-type=module", "--eval", script], {
    cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { before: true, after: true, width: 64, height: 48, channels: 4, bytes: 64 * 48 * 4,
    small: [32, 24], restricted: "MEDIA_DIMENSIONS" });
});

test("extra decode bounds dimensions before pixel decode, preserves panoramas and does not enlarge small photos", async () => {
  await assert.rejects(decodeExtraImage(fixture("bmp"), "bmp", { maxPixels: 100 }), rejected("MEDIA_DIMENSIONS"));
  await assert.rejects(decodeExtraImage(fixture("bmp"), "bmp", { maxSide: 16 }), rejected("MEDIA_DIMENSIONS"));
  await assert.rejects(decodeExtraImage(fixture("bmp"), "bmp", { targetSide: 2049 }), rejected("MEDIA_INPUT"));
  const wide = await decodeExtraImage(bmp(32769, 1), "bmp"); assert.deepEqual([wide.width, wide.height], [2048, 1]); wide.data.fill(0);
  const small = await decodeExtraImage(fixture("bmp"), "bmp"); assert.deepEqual([small.width, small.height], [32, 24]); small.data.fill(0);
});

test("wrong format, malformed raster and HEIF/SVG mislabeled RAW never reach a permissive Magick reader", async () => {
  for (const bytes of [heic, fixture("avif"), svg, Buffer.from("not a photo")]) {
    for (const format of ["bmp", "jxl", "raw"]) await assert.rejects(decodeExtraImage(bytes, format, { hint: "dng" }), rejected("MEDIA_FORMAT"));
  }
  await assert.rejects(decodeExtraImage(fixture("bmp"), "heic"), rejected("MEDIA_FORMAT"));
  await assert.rejects(decodeExtraImage(fixture("bmp"), "bmp", { hint: "../../outside.raw" }), rejected("MEDIA_INPUT"));
  const truncated = fixture("bmp").subarray(0, 26);
  await assert.rejects(decodeExtraImage(truncated, "bmp"), rejected("MEDIA_FORMAT"));
});

test("the installed Magick policy positively denies HEIC, AVIF and SVG for ping and read", async () => {
  const image = await decodeExtraImage(fixture("bmp"), "bmp"); image.data.fill(0);
  const { ImageMagick, MagickImageInfo, MagickReadSettings, MagickFormat } = await import("@imagemagick/magick-wasm");
  for (const [bytes, format] of [[heic, MagickFormat.Heic], [fixture("avif"), MagickFormat.Avif], [svg, MagickFormat.Svg]]) {
    const settings = new MagickReadSettings({ format, frameIndex: 0, frameCount: 1 });
    assert.throws(() => MagickImageInfo.create(bytes, settings), /NotAuthorized/);
    assert.throws(() => ImageMagick.read(bytes, settings, () => assert.fail("forbidden coder decoded")), /NotAuthorized/);
  }
  assert.throws(() => ImageMagick.read(fixture("bmp"), image => image.write(MagickFormat.Bmp, () => assert.fail("writer is not needed"))), /NotAuthorized/);
});

test("BMP containers with HEIC or SVG trailers are refused rather than automatically decoded as another format", async () => {
  const original = fixture("bmp");
  for (const trailer of [heic, svg]) {
    const polyglot = Buffer.concat([original, trailer]);
    assert.equal(detectExtraImageFormat(polyglot), "bmp");
    await assert.rejects(decodeExtraImage(polyglot, "bmp"), rejected("MEDIA_FORMAT"));
  }
});
