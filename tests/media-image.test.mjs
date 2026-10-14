import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { createImageNormalizer, imageFormat, MAX_IMAGE_INPUT_BYTES, MediaImageError, normalizeImage } from "../server/media/image.mjs";

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

test("source dimension and decoded-pixel bounds reject otherwise valid raster files", async () => {
  await rejectsCode(normalizeImage(await solid(8193, 1)), "MEDIA_FORMAT");
  await rejectsCode(normalizeImage(await solid(4001, 4000)), "MEDIA_FORMAT");
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

function fakeHarness() {
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
    setTimer(callback, delay) { assert.equal(delay, 10_000); const timer = { callback, cleared: false, unref() {} }; timers.push(timer); return timer; },
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
