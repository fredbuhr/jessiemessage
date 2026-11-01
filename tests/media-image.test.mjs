import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { createImageNormalizer, imageFormat, MAX_IMAGE_INPUT_BYTES, MAX_PREPARATION_INPUT_BYTES, MAX_PREPARATION_OUTPUT_BYTES, MediaImageError, normalizeImage } from "../server/media/image.mjs";

const solid = (width = 32, height = 16, format = "png") => sharp({
  create: { width, height, channels: 3, background: { r: 192, g: 37, b: 97 } },
})[format]().toBuffer();
const rejectsCode = (promise, code) => assert.rejects(promise, (error) => error instanceof MediaImageError && error.code === code
  && error.cause === undefined && !error.message.includes("secret"));

test("image normalization accepts synthetic JPEG, PNG and WebP and produces stripped JPEG variants", async () => {
  for (const format of ["jpeg", "png", "webp"]) {
    const source = await solid(120, 60, format);
    const unchanged = Buffer.from(source);
    const result = await normalizeImage(source);
    assert.deepEqual(source, unchanged);
    assert.equal(result.width, 120); assert.equal(result.height, 60);
    assert.equal(result.thumbnailWidth, 120); assert.equal(result.thumbnailHeight, 60);
    assert.equal(imageFormat(result.full), "jpeg"); assert.equal(imageFormat(result.thumbnail), "jpeg");
    assert.deepEqual(result.digest, createHash("sha256").update(result.full).digest());
    for (const bytes of [result.full, result.thumbnail]) {
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.format, "jpeg");
      for (const privateMetadata of ["exif", "icc", "iptc", "xmp", "orientation"]) assert.equal(metadata[privateMetadata], undefined);
    }
  }
});

test("normalization uses EXIF orientation and removes source identity and profile metadata", async () => {
  const source = await sharp({ create: { width: 40, height: 20, channels: 3, background: "red" } })
    .withMetadata({ orientation: 6 }).withExif({ IFD0: { Artist: "private-secret-person", Copyright: "secret-test" } })
    .jpeg().toBuffer();
  const sourceMetadata = await sharp(source).metadata();
  assert.ok(sourceMetadata.exif); assert.equal(sourceMetadata.orientation, 6);
  const result = await normalizeImage(source);
  assert.equal(result.width, 20); assert.equal(result.height, 40);
  assert.ok(!result.full.includes(Buffer.from("private-secret-person")));
  assert.ok(!result.thumbnail.includes(Buffer.from("secret-test")));
  assert.equal((await sharp(result.full).metadata()).orientation, undefined);
});

test("normalization flattens transparency to the approved ivory background", async () => {
  const source = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const result = await normalizeImage(source);
  const { data, info } = await sharp(result.full).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 3);
  for (const [actual, expected] of [[data[0], 245], [data[1], 238], [data[2], 242]]) assert.ok(Math.abs(actual - expected) <= 3);
});

test("full image and thumbnail obey independent maximum dimensions without enlargement", async () => {
  const result = await normalizeImage(await solid(3000, 1500));
  assert.deepEqual([result.width, result.height], [2048, 1024]);
  assert.deepEqual([result.thumbnailWidth, result.thumbnailHeight], [480, 240]);
  assert.ok(result.full.length <= MAX_IMAGE_INPUT_BYTES); assert.ok(result.thumbnail.length <= 512 * 1024);
  const tiny = await normalizeImage(await solid(1, 1));
  assert.deepEqual([tiny.width, tiny.height, tiny.thumbnailWidth, tiny.thumbnailHeight], [1, 1, 1, 1]);
});

test("raw input rejects arbitrary strings, paths, SVG, GIF, empty and oversized buffers before spawning", async () => {
  let spawned = 0;
  const normalize = createImageNormalizer({ forkProcess() { spawned += 1; throw new Error("unexpected"); } });
  for (const input of [null, "/tmp/private-secret.jpg", new Uint8Array([1]), Buffer.alloc(0), Buffer.alloc(MAX_IMAGE_INPUT_BYTES + 1)]) {
    await rejectsCode(normalize(input), "MEDIA_INPUT");
  }
  for (const input of [Buffer.from("<svg><text>secret</text></svg>"), Buffer.from("GIF89a"), Buffer.from("%PDF-private-secret")]) {
    await rejectsCode(normalize(input), "MEDIA_FORMAT");
  }
  assert.equal(spawned, 0);
});

test("magic alone cannot make corrupt or truncated bytes a supported image", async () => {
  for (const input of [Buffer.from([255, 216, 255]), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("RIFFxxxxWEBPsecret")]) {
    await rejectsCode(normalizeImage(input), "MEDIA_FORMAT");
  }
  const jpeg = await solid(128, 128, "jpeg");
  await rejectsCode(normalizeImage(jpeg.subarray(0, Math.floor(jpeg.length / 2))), "MEDIA_FORMAT");
});

test("a truncated JPEG with readable metadata remains a file-format error", async () => {
  const jpeg = await solid(1000, 1000, "jpeg");
  const truncated = jpeg.subarray(0, jpeg.length - 2);
  const metadata = await sharp(truncated).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.deepEqual([metadata.width, metadata.height], [1000, 1000]);
  await rejectsCode(normalizeImage(truncated), "MEDIA_FORMAT");
});

test("source dimension and decoded-pixel bounds reject otherwise valid raster files", async () => {
  await rejectsCode(normalizeImage(await solid(8193, 1)), "MEDIA_DIMENSIONS");
  await rejectsCode(normalizeImage(await solid(4001, 4000)), "MEDIA_DIMENSIONS");
  const allowed = await normalizeImage(await solid(8192, 1));
  assert.equal(allowed.width, 2048); assert.equal(allowed.height, 1);
});

test("APNG animation chunks are rejected even when a decoder would return only the first frame", async () => {
  const png = await solid();
  const animationControl = Buffer.alloc(20);
  animationControl.writeUInt32BE(8); animationControl.write("acTL", 4, "ascii");
  animationControl.writeUInt32BE(2, 8); // Two frames; CRC is intentionally irrelevant to the deny rule.
  const animated = Buffer.concat([png.subarray(0, 33), animationControl, png.subarray(33)]);
  await rejectsCode(normalizeImage(animated), "MEDIA_FORMAT");
});

test("actual animated WebP is rejected rather than retaining its first frame", async () => {
  const raw = Buffer.alloc(4 * 8 * 3, 120);
  raw.fill(220, raw.length / 2);
  const animated = await sharp(raw, { raw: { width: 4, height: 8, channels: 3, pageHeight: 4 } }).webp({ loop: 0, delay: [50, 50] }).toBuffer();
  assert.equal((await sharp(animated, { animated: true }).metadata()).pages, 2);
  await rejectsCode(normalizeImage(animated), "MEDIA_FORMAT");
});

function fakeHarness({ preparation = false } = {}) {
  const children = []; const timers = [];
  const normalize = createImageNormalizer({
    forkProcess(url, args, options) {
      assert.equal(url.pathname.endsWith("/image-worker.mjs"), true);
      assert.deepEqual(args, []); assert.deepEqual(options.execArgv, ["--max-old-space-size=96"]);
      assert.deepEqual(options.stdio, ["ignore", "ignore", "ignore", "ipc"]);
      assert.equal(options.serialization, "advanced"); assert.equal(options.env.NODE_OPTIONS, undefined);
      const child = new EventEmitter(); child.pid = children.length + 1;
      child.send = (request, callback) => { child.request = request; callback(null); };
      child.kill = (signal) => { child.killed = signal; return true; };
      children.push(child); return child;
    },
    setTimer(callback, delay) { assert.equal(delay, preparation ? 30_000 : 10_000); const timer = { callback, cleared: false, unref() {} }; timers.push(timer); return timer; },
    clearTimer(timer) { timer.cleared = true; },
  });
  return { normalize, children, timers };
}

test("decoder budget allows one active and two queued jobs, rejects overload and reserves the slot until exit", async () => {
  const source = await solid(); const h = fakeHarness();
  const jobs = [h.normalize(source), h.normalize(source), h.normalize(source)];
  await rejectsCode(h.normalize(source), "MEDIA_BUSY"); assert.equal(h.children.length, 1);
  h.children[0].emit("message", { ok: false, code: "MEDIA_FORMAT", error: "private-secret-decoder" });
  assert.equal(h.children[0].killed, "SIGKILL"); assert.equal(h.children.length, 1);
  h.children[0].emit("exit", null, "SIGKILL"); assert.equal(h.children.length, 2);
  assert.ok(h.children[0].request.bytes.every((byte) => byte === 0));
  for (let index = 1; index < 3; index += 1) h.children[index].emit("exit", 1);
  for (const job of jobs) await assert.rejects(job, MediaImageError);
  assert.ok(h.timers.every((timer) => timer.cleared)); assert.deepEqual(source, await solid());
});

test("worker timeout kills native work and releases the decoder budget on exit", async () => {
  const source = await solid(); const h = fakeHarness();
  const first = h.normalize(source); const second = h.normalize(source);
  h.timers[0].callback(); assert.equal(h.children[0].killed, "SIGKILL"); assert.equal(h.children.length, 1);
  h.children[0].emit("exit", null, "SIGKILL"); await rejectsCode(first, "MEDIA_UNAVAILABLE");
  assert.equal(h.children.length, 2); h.children[1].emit("exit", 1); await rejectsCode(second, "MEDIA_UNAVAILABLE");
});

test("spawn failure, IPC failure and malformed worker results are sanitized and never poison the queue", async () => {
  const source = await solid(); let calls = 0;
  const normalize = createImageNormalizer({ forkProcess() { calls += 1; throw new Error("private-secret-path"); } });
  await rejectsCode(normalize(source), "MEDIA_UNAVAILABLE"); await rejectsCode(normalize(source), "MEDIA_UNAVAILABLE"); assert.equal(calls, 2);
  const h = fakeHarness(); const first = h.normalize(source); const second = h.normalize(source);
  h.children[0].emit("error", new Error("private-secret-path")); h.children[0].emit("exit", 1);
  await rejectsCode(first, "MEDIA_UNAVAILABLE");
  h.children[1].emit("message", { ok: true, result: { full: Buffer.from("secret") } }); h.children[1].emit("exit", 0);
  await rejectsCode(second, "MEDIA_UNAVAILABLE");
});

test("real worker overload returns a retry hint and all accepted subprocess jobs finish", async () => {
  const source = await solid();
  const jobs = [normalizeImage(source), normalizeImage(source), normalizeImage(source)];
  await assert.rejects(normalizeImage(source), (error) => error.code === "MEDIA_BUSY" && error.retryAfter === 5);
  const results = await Promise.all(jobs);
  assert.equal(results.length, 3); assert.ok(results.every((result) => result.width === 32));
  assert.equal((await normalizeImage(source)).height, 16);
});

test("original preparation adds TIFF and GIF without changing asset formats", async () => {
  for (const format of ["tiff", "gif"]) {
    const source = await solid(90, 60, format);
    await rejectsCode(normalizeImage(source), "MEDIA_FORMAT");
    const result = await normalizeImage(source, { preparation: true });
    assert.deepEqual([result.width, result.height], [90, 60]);
    assert.equal(imageFormat(result.full), "jpeg");
    assert.ok(result.full.length <= MAX_PREPARATION_OUTPUT_BYTES);
    const metadata = await sharp(result.full).metadata();
    for (const name of ["exif", "icc", "iptc", "xmp", "orientation"]) assert.equal(metadata[name], undefined);
  }
});

test("original preparation selects the first GIF frame and WebP frame", async () => {
  const raw = Buffer.alloc(16 * 32 * 3);
  for (let index = 0; index < raw.length; index += 3) raw[index + (index < raw.length / 2 ? 0 : 2)] = 255;
  for (const format of ["gif", "webp"]) {
    const source = await sharp(raw, { raw: { width: 16, height: 32, channels: 3, pageHeight: 16 } })[format]({ loop: 0, delay: [50, 50] }).toBuffer();
    assert.equal((await sharp(source, { animated: true }).metadata()).pages, 2);
    const prepared = await normalizeImage(source, { preparation: true });
    assert.deepEqual([prepared.width, prepared.height], [16, 16]);
    const { data } = await sharp(prepared.full).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[0] > 240 && data[2] < 15, `${format}: the red first frame is selected`);
  }
});

test("original preparation selects the first APNG frame and TIFF page", async () => {
  const fixtures = JSON.parse(await readFile(new URL("./fixtures/photo-acceptance-formats.json", import.meta.url), "utf8"));
  const apng = Buffer.from(fixtures.fixtures.find(value => value.name === "apng-two-frames").base64, "base64");
  await rejectsCode(normalizeImage(apng), "MEDIA_FORMAT");
  const first = await normalizeImage(apng, { preparation: true });
  assert.deepEqual([first.width, first.height], [32, 24]);
  const { data } = await sharp(first.full).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 200 && data[2] < 110, "the red APNG frame is selected");
  const raw = Buffer.alloc(16 * 32 * 3);
  for (let index = 0; index < raw.length; index += 3) raw[index + (index < raw.length / 2 ? 0 : 2)] = 255;
  const tiff = await sharp(raw, { raw: { width: 16, height: 32, channels: 3, pageHeight: 16 } }).tiff().toBuffer();
  assert.equal((await sharp(tiff).metadata()).pages, 2);
  const page = await normalizeImage(tiff, { preparation: true });
  assert.deepEqual([page.width, page.height], [16, 16]);
  const pixels = await sharp(page.full).raw().toBuffer();
  assert.ok(pixels[0] > 240 && pixels[2] < 15, "the red TIFF page is selected");
});

test("original preparation accepts large JPEGs and narrow panoramas within a 64 MP pixel budget", async () => {
  for (const [width, height] of [[8000, 6000], [32769, 1]]) {
    const source = await solid(width, height, "jpeg");
    await rejectsCode(normalizeImage(source), "MEDIA_DIMENSIONS");
    const prepared = await normalizeImage(source, { preparation: true });
    assert.equal(prepared.width, 2048); assert.ok(prepared.height >= 1 && prepared.height <= 2048);
  }
  await rejectsCode(normalizeImage(await solid(8001, 8000, "jpeg"), { preparation: true }), "MEDIA_DIMENSIONS");
});

test("original preparation repairs a missing JPEG end marker but rejects missing scan data", async () => {
  const source = await solid(1000, 1000, "jpeg");
  const missingMarker = source.subarray(0, -2);
  await rejectsCode(normalizeImage(missingMarker), "MEDIA_FORMAT");
  assert.equal((await normalizeImage(missingMarker, { preparation: true })).width, 1000);
  for (const cut of [10, 100]) await rejectsCode(normalizeImage(source.subarray(0, -cut), { preparation: true }), "MEDIA_FORMAT");
});

test("original byte and output budgets allow a large lossless input and bound its JPEG result", async () => {
  const pixels = Buffer.alloc(2048 * 2048 * 3); let value = 0x12345678;
  for (let index = 0; index < pixels.length; index++) { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; pixels[index] = value & 255; }
  const source = await sharp(pixels, { raw: { width: 2048, height: 2048, channels: 3 } }).png().toBuffer();
  assert.ok(source.length > MAX_IMAGE_INPUT_BYTES && source.length < MAX_PREPARATION_INPUT_BYTES);
  await rejectsCode(normalizeImage(source), "MEDIA_INPUT");
  const prepared = await normalizeImage(source, { preparation: true });
  assert.ok(prepared.full.length <= MAX_PREPARATION_OUTPUT_BYTES);
  assert.ok(prepared.width < 2048, "large encoded output is reduced before returning");
  let spawned = 0;
  const normalize = createImageNormalizer({ forkProcess() { spawned++; throw new Error("unexpected"); } });
  await rejectsCode(normalize(Buffer.alloc(MAX_PREPARATION_INPUT_BYTES + 1), { preparation: true }), "MEDIA_INPUT");
  for (const source of [Buffer.from("<svg/>"), Buffer.from("%PDF-secret"), Buffer.from("/tmp/private-secret")]) {
    await rejectsCode(normalize(source, { preparation: true }), "MEDIA_FORMAT");
  }
  assert.equal(spawned, 0);
});

test("original preparation deadline retains the decoder place until the child exits", async () => {
  const source = await solid(); const h = fakeHarness({ preparation: true });
  const first = h.normalize(source, { preparation: true });
  const second = h.normalize(source, { preparation: true });
  assert.equal(h.children[0].request.preparation, true);
  h.timers[0].callback(); assert.equal(h.children[0].killed, "SIGKILL");
  assert.equal(h.children.length, 1);
  h.children[0].emit("exit", null, "SIGKILL"); await rejectsCode(first, "MEDIA_UNAVAILABLE");
  assert.equal(h.children.length, 2);
  h.children[1].emit("exit", 1); await rejectsCode(second, "MEDIA_UNAVAILABLE");
});
