// Real decoder/canvas tests with synthetic images and a loopback-only server.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import sharp from "sharp";
import { startWebDriver } from "./webdriver.mjs";
import { normalizeImage } from "../../server/media/image.mjs";

test("phone photo preparation really resizes twenty MP, preserves alpha and applies EXIF orientation", { timeout: 60000 }, async (t) => {
  const helper = await readFile(new URL("../../public/image-preparation.js", import.meta.url));
  const phone = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: "#c32570" } }).jpeg().toBuffer();
  const transparent = sharp({ create: { width: 3000, height: 1500, channels: 4, background: { r: 130, g: 50, b: 80, alpha: 0.3 } } });
  const portrait = Buffer.alloc(80 * 40 * 3);
  for (let y = 0; y < 40; y += 1) for (let x = 0; x < 80; x += 1) portrait[(y * 80 + x) * 3 + (x < 40 ? 0 : 2)] = 255;
  const oriented = await sharp(portrait, { raw: { width: 80, height: 40, channels: 3 } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const images = new Map([
    ["/phone.jpg", [phone, "image/jpeg"]], ["/alpha.png", [await transparent.clone().png().toBuffer(), "image/png"]],
    ["/alpha.webp", [await transparent.clone().webp({ lossless: true }).toBuffer(), "image/webp"]], ["/oriented.jpg", [oriented, "image/jpeg"]],
  ]);
  const server = createServer((request, response) => {
    const image = images.get(request.url);
    if (image) { response.writeHead(200, { "Content-Type": image[1] }); response.end(image[0]); }
    else if (request.url === "/image-preparation.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(helper); }
    else if (request.url === "/") { response.writeHead(200, { "Content-Type": "text/html" }); response.end("<!doctype html><title>Local synthetic image preparation</title>"); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const driver = await startWebDriver(); t.after(() => driver.close());
  const browser = await driver.browser({ origin: `http://127.0.0.1:${server.address().port}` });
  await browser.navigate("/");
  for (const path of images.keys()) {
    const result = await browser.executeAsync(`
      const done = arguments[arguments.length - 1], path = arguments[0];
      (async () => {
        const { prepareImageUpload } = await import('/image-preparation.js');
        const input = await (await fetch(path)).blob();
        const output = await prepareImageUpload(input);
        return { type: output.type, bytes: Array.from(new Uint8Array(await output.arrayBuffer())) };
      })().then(done, (error) => done({ error: error.code || error.name }));
    `, path);
    assert.equal(result.error, undefined, path);
    const bytes = Buffer.from(result.bytes); assert.ok(bytes.length < 10 * 1024 * 1024);
    const metadata = await sharp(bytes).metadata();
    for (const field of ["exif", "icc", "iptc", "xmp", "orientation"]) assert.equal(metadata[field], undefined, `${path}: ${field}`);
    if (path === "/phone.jpg") {
      assert.equal(result.type, "image/jpeg"); assert.deepEqual([metadata.width, metadata.height], [2048, 1638]);
      const accepted = await normalizeImage(bytes); assert.equal(accepted.width, 2048);
    } else if (path.startsWith("/alpha.")) {
      assert.equal(result.type, "image/png"); assert.equal(metadata.hasAlpha, true);
      assert.deepEqual([metadata.width, metadata.height], [2048, 1024]);
      const raw = await sharp(bytes).raw().toBuffer(); assert.ok(Math.abs(raw[3] - 77) <= 1, path);
    } else {
      assert.deepEqual([metadata.width, metadata.height], [40, 80]);
      const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      const top = (10 * 40 + 20) * info.channels, bottom = (60 * 40 + 20) * info.channels;
      assert.ok(data[top] > 220 && data[top + 2] < 30, "EXIF-rotated top remains red");
      assert.ok(data[bottom + 2] > 220 && data[bottom] < 30, "EXIF-rotated bottom remains blue");
    }
  }
});
