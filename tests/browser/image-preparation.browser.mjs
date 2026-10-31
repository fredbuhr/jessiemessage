// Real decoder/canvas tests with synthetic images and a loopback-only server.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { startWebDriver } from "./webdriver.mjs";
import { normalizeImage } from "../../server/media/image.mjs";
import { AUTH_HEADERS } from "../../server/auth/http.mjs";

test("phone preparation really shrinks large JPEG, AVIF and HEIC locally under the isolated worker CSP", { timeout: 180000 }, async (t) => {
  const driver = await startWebDriver(); t.after(() => driver.close());
  const helper = await readFile(new URL("../../public/image-preparation.js", import.meta.url));
  const [worker, codec, heicText] = await Promise.all([
    readFile(new URL("../../public/heic-decoder-worker.js", import.meta.url)),
    readFile(new URL("../../node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs", import.meta.url)),
    readFile(new URL("../fixtures/photo-1140.heic.b64", import.meta.url), "utf8"),
  ]);
  const heic = Buffer.from(heicText, "base64"), decoderRequests = [];
  const workerPolicy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
  const privateMarker = "private-original-camera-owner-527";
  const exif = { IFD0: { Artist: privateMarker, Copyright: privateMarker } };
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:description="${privateMarker}"/></rdf:RDF></x:xmpmeta>`;
  const phone = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: "#c32570" } })
    .withMetadata().withExif(exif).withXmp(xmp).jpeg().toBuffer();
  const largePhone = await sharp(randomBytes(5000 * 4000 * 3), { raw: { width: 5000, height: 4000, channels: 3 } })
    .withMetadata().withExif(exif).withXmp(xmp).jpeg({ quality: 95 }).toBuffer();
  assert.ok(largePhone.length > 10 * 1024 * 1024 && largePhone.length < 50 * 1024 * 1024,
    "real high-detail camera JPEG exceeds the old source cap while staying within the new one");
  const transparent = sharp({ create: { width: 3000, height: 1500, channels: 4, background: { r: 130, g: 50, b: 80, alpha: 0.3 } } })
    .withMetadata().withExif(exif).withXmp(xmp);
  const portrait = Buffer.alloc(80 * 40 * 3);
  for (let y = 0; y < 40; y += 1) for (let x = 0; x < 80; x += 1) portrait[(y * 80 + x) * 3 + (x < 40 ? 0 : 2)] = 255;
  const oriented = await sharp(portrait, { raw: { width: 80, height: 40, channels: 3 } })
    .withMetadata({ orientation: 6 }).withExif(exif).withXmp(xmp).jpeg().toBuffer();
  // A real, compressible 200 MP original verifies the native decoder's shrink
  // path. Its source canvas is never allocated at the original resolution.
  const highDefinition = await sharp({ create: { width: 20000, height: 10000, channels: 3, background: "#c32570" } })
    .withExif(exif).withXmp(xmp).jpeg().toBuffer();
  // Camera editors can leave large metadata/padding behind the JPEG stream.
  // Preserve real decodable pixels while exercising the expanded byte budget.
  const aboveFiftyMiB = Buffer.concat([phone, Buffer.alloc(51 * 1024 * 1024)]);
  const images = new Map([
    ["/phone.jpg", [phone, "image/jpeg"]], ["/large-phone.jpg", [largePhone, "image/jpeg"]], ["/alpha.png", [await transparent.clone().png().toBuffer(), "image/png"]],
    ["/alpha.webp", [await transparent.clone().webp({ lossless: true }).toBuffer(), "image/webp"]], ["/oriented.jpg", [oriented, "image/jpeg"]],
    ["/alpha.avif", [await transparent.clone().avif({ lossless: true }).toBuffer(), "image/avif"]],
    ["/high-definition.jpg", [highDefinition, "image/jpeg"]], ["/above-fifty.jpg", [aboveFiftyMiB, "image/jpeg"]],
    ["/phone.heic", [heic, "image/heic"]],
  ]);
  const server = createServer((request, response) => {
    const image = images.get(request.url);
    if (image) { response.writeHead(200, { "Content-Type": image[1] }); response.end(image[0]); }
    else if (request.url === "/image-preparation.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(helper); }
    else if (request.url === "/heic-decoder-worker.js") {
      decoderRequests.push(request.url); response.writeHead(200, { "Content-Type": "text/javascript", "Content-Security-Policy": workerPolicy }); response.end(worker);
    } else if (request.url === "/heic-codec-1.23.5.mjs") {
      decoderRequests.push(request.url); response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(codec);
    } else if (request.url === "/") { response.writeHead(200, { ...AUTH_HEADERS, "Content-Type": "text/html" }); response.end("<!doctype html><title>Local synthetic image preparation</title>"); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const browser = await driver.browser({ origin: `http://127.0.0.1:${server.address().port}` });
  await browser.navigate("/");
  assert.equal(await browser.executeAsync(`
    const done = arguments[arguments.length - 1];
    WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])).then(() => done(false), () => done(true));
  `), true, "the document itself keeps WebAssembly compilation disabled");
  const cases = [...images.keys()].filter(path => path !== "/phone.heic").map(path => ({ path, fallback: false }));
  cases.push({ path: "/oriented.jpg", fallback: true }, { path: "/alpha.webp", fallback: true },
    { path: "/phone.jpg", fallback: false, mime: "application/octet-stream" },
    { path: "/phone.jpg", fallback: false, mime: "image/heic" },
    { path: "/phone.heic", worker: true });
  for (const fixture of cases) {
    const { path } = fixture;
    if (!fixture.worker) {
      const original = await sharp(images.get(path)[0]).metadata();
      assert.ok(original.exif?.includes(Buffer.from(privateMarker)), `${path}: EXIF fixture includes private source identity`);
      assert.ok(original.xmp?.includes(Buffer.from(privateMarker)), `${path}: XMP fixture includes private source identity`);
      assert.deepEqual(decoderRequests, [], "the HEVC dependency is never requested for native photo formats");
    }
    const result = await browser.executeAsync(`
      const done = arguments[arguments.length - 1], { path, fallback, mime, worker } = arguments[0];
      (async () => {
        const { prepareImageUpload } = await import('/image-preparation.js');
        const original = await (await fetch(path)).blob();
        const input = mime === undefined ? original : new Blob([original], { type: mime });
        const saved = globalThis.createImageBitmap, savedImage = globalThis.Image, create = document.createElement;
        const draws = [], requests = [], violations = [];
        const violation = event => violations.push(event.violatedDirective);
        addEventListener('securitypolicyviolation', violation);
        document.createElement = function (...args) {
          const element = create.apply(this, args);
          if (args[0] === 'canvas') {
            const get = element.getContext;
            element.getContext = function (...args) {
              const context = get.apply(this, args), draw = context?.drawImage;
              if (draw) context.drawImage = function (...args) { draws.push([element.width, element.height]); return draw.apply(this, args); };
              return context;
            };
          }
          return element;
        };
        if (saved) globalThis.createImageBitmap = (...args) => { requests.push(args[1]); return saved(...args); };
        if (fallback) globalThis.createImageBitmap = undefined;
        if (worker) {
          globalThis.createImageBitmap = async () => { throw new DOMException('Synthetic native HEIC unavailable', 'InvalidStateError'); };
          globalThis.Image = undefined;
        }
        try {
          const output = await prepareImageUpload(input);
          return { type: output.type, bytes: Array.from(new Uint8Array(await output.arrayBuffer())), draws, requests, violations };
        } finally {
          globalThis.createImageBitmap = saved; globalThis.Image = savedImage; document.createElement = create;
          removeEventListener('securitypolicyviolation', violation);
        }
      })().then(done, (error) => done({ error: error.code || error.name }));
    `, fixture);
    assert.equal(result.error, undefined, path);
    assert.deepEqual(result.violations, [], `${path}: browser enforced both document and isolated worker policies`);
    assert.ok(result.draws.every(([width, height]) => width <= 2048 && height <= 2048), `${path}: no full-resolution canvas is allocated`);
    const bytes = Buffer.from(result.bytes); assert.ok(bytes.length <= 2 * 1024 * 1024);
    const metadata = await sharp(bytes).metadata();
    for (const field of ["exif", "iptc", "xmp", "orientation"]) assert.equal(metadata[field], undefined, `${path}: ${field}`);
    assert.equal(bytes.includes(Buffer.from(privateMarker)), false, `${path}: original private metadata is absent`);
    // Chrome can attach its standard sRGB ICC profile when encoding canvas.
    // A new colour profile is useful output metadata, not source identity.
    assert.equal(metadata.space, "srgb");
    if (["/phone.jpg", "/large-phone.jpg", "/high-definition.jpg", "/above-fifty.jpg"].includes(path)) {
      const height = path === "/high-definition.jpg" ? 1024 : 1638;
      assert.equal(result.type, "image/jpeg"); assert.deepEqual([metadata.width, metadata.height], [2048, height]);
      assert.deepEqual([result.requests[0].resizeWidth, result.requests[0].resizeHeight], [2048, height]);
      const accepted = await normalizeImage(bytes); assert.equal(accepted.width, 2048);
      const stored = await sharp(accepted.full).metadata();
      for (const field of ["exif", "icc", "iptc", "xmp", "orientation"]) assert.equal(stored[field], undefined, `stored phone image: ${field}`);
    } else if (path.startsWith("/alpha.")) {
      assert.equal(result.type, "image/png"); assert.equal(metadata.hasAlpha, true);
      assert.deepEqual([metadata.width, metadata.height], [2048, 1024]);
      const raw = await sharp(bytes).raw().toBuffer(); assert.ok(Math.abs(raw[3] - 77) <= 1, path);
    } else if (fixture.worker) {
      assert.equal(result.type, "image/jpeg"); assert.deepEqual([metadata.width, metadata.height], [64, 48]);
      assert.deepEqual(decoderRequests, ["/heic-decoder-worker.js", "/heic-codec-1.23.5.mjs"]);
      const accepted = await normalizeImage(bytes); assert.deepEqual([accepted.width, accepted.height], [64, 48]);
    } else {
      assert.deepEqual([metadata.width, metadata.height], [40, 80]);
      const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
      const top = (10 * 40 + 20) * info.channels, bottom = (60 * 40 + 20) * info.channels;
      assert.ok(data[top] > 220 && data[top + 2] < 30, "EXIF-rotated top remains red");
      assert.ok(data[bottom + 2] > 220 && data[bottom] < 30, "EXIF-rotated bottom remains blue");
    }
  }
});
