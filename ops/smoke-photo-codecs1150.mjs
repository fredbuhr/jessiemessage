// Installation qualification only: synthetic bytes, disposable children,
// no application listener, database, filesystem media or network request.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import sharp from "sharp";
import { prepareImageStream, MAX_PREPARATION_OUTPUT_BYTES } from "../server/media/image.mjs";

assert.equal(process.version, "v24.22.1");
const fixture = JSON.parse(await readFile(new URL("../tests/fixtures/photo-extra-codecs.json", import.meta.url), "utf8"));
const samples = [];
for (const [name, hint] of [["bmp", null], ["jxl", null], ["dng", "dng"], ["avif", null]]) {
  const bytes = Buffer.from(fixture[name].base64, "base64");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), fixture[name].sha256);
  samples.push({ name, bytes, hint });
}
samples.push({ name: "heic", bytes: Buffer.from(await readFile(new URL("../tests/fixtures/photo-1150-rotated.heic.b64", import.meta.url), "utf8"), "base64"), hint: null });
samples.push({ name: "jpeg", bytes: await sharp({ create: { width: 32, height: 24, channels: 3, background: "#dd4488" } }).jpeg().toBuffer(), hint: null });
const passed = [];
for (const { name, bytes, hint } of samples) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  const result = await prepareImageStream(Readable.from([bytes]), { declaredBytes: bytes.length, hint });
  assert.ok(Buffer.isBuffer(result.full) && result.full.length <= MAX_PREPARATION_OUTPUT_BYTES);
  const metadata = await sharp(result.full).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.ok(metadata.width >= 1 && metadata.height >= 1 && Math.max(metadata.width, metadata.height) <= 2048);
  assert.equal(metadata.width, result.width); assert.equal(metadata.height, result.height);
  if (name === "heic") assert.deepEqual([metadata.width, metadata.height], [48, 64]);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), digest);
  result.full.fill(0); result.thumbnail.fill(0); bytes.fill(0);
  passed.push(name);
}
console.log(JSON.stringify({ status: "photo_codecs1150_synthetic_ok", nodeVersion: process.version,
  families: passed, cases: passed.length, noRuntime: true, noSql: true, noStoredMedia: true }));
