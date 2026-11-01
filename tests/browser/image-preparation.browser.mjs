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
  const [worker, core, codec, heicText] = await Promise.all([
    readFile(new URL("../../public/heic-decoder-worker.js", import.meta.url)),
    readFile(new URL("../../public/heic-decoder-core.js", import.meta.url)),
    readFile(new URL("../../node_modules/heic-to/src/lib/libheif-without-unsafe-eval.js", import.meta.url)),
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
    } else if (request.url === "/heic-decoder-core.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(core);
    } else if (request.url === "/heic-codec-1.23.7.mjs") {
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
    { path: "/phone.jpg", fallback: false, mime: "video/mp4" },
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
      })().then(done, (error) => done({ failureCode: error.code || error.name }));
    `, fixture);
    assert.equal(result.failureCode, undefined, path);
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
      assert.deepEqual(decoderRequests, ["/heic-decoder-worker.js", "/heic-codec-1.23.7.mjs"]);
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

test("real HEIC uses document encoding without worker canvas while legacy callers keep the Blob contract", { timeout: 90000 }, async (t) => {
  const driver = await startWebDriver(); t.after(() => driver.close());
  const [helper, worker, core, codec, heicText, rotatedText] = await Promise.all([
    readFile(new URL("../../public/image-preparation.js", import.meta.url)),
    readFile(new URL("../../public/heic-decoder-worker.js", import.meta.url)),
    readFile(new URL("../../public/heic-decoder-core.js", import.meta.url)),
    readFile(new URL("../../node_modules/heic-to/src/lib/libheif-without-unsafe-eval.js", import.meta.url)),
    readFile(new URL("../fixtures/photo-1140.heic.b64", import.meta.url), "utf8"),
    readFile(new URL("../fixtures/photo-1150-rotated.heic.b64", import.meta.url), "utf8"),
  ]);
  const heic = Buffer.from(heicText, "base64"), rotated = Buffer.from(rotatedText, "base64"), decoderRequests = [];
  const modes = {
    available: "",
    missing: "globalThis.OffscreenCanvas = undefined;\n",
    no2d: "OffscreenCanvas.prototype.getContext = () => null;\n",
    noEncoder: "OffscreenCanvas.prototype.convertToBlob = undefined;\n",
  };
  let mode = "available";
  const server = createServer((request, response) => {
    if (request.url === "/image-preparation.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(helper); }
    else if (request.url === "/heic-decoder-worker.js") {
      decoderRequests.push([request.url, mode]);
      response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'" });
      response.end(Buffer.concat([Buffer.from(modes[mode]), worker]));
    } else if (request.url === "/heic-decoder-core.js") {
      response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(core);
    } else if (request.url === "/heic-codec-1.23.7.mjs") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(codec); }
    else if (request.url === "/photo-rotated.heic") { response.writeHead(200, { "Content-Type": "image/heic" }); response.end(rotated); }
    else if (request.url === "/photo.heic") { response.writeHead(200, { "Content-Type": "image/heic" }); response.end(heic); }
    else if (request.url === "/") { response.writeHead(200, { ...AUTH_HEADERS, "Content-Type": "text/html" }); response.end("<!doctype html><title>Local HEIC worker compatibility</title>"); }
    else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const browser = await driver.browser({ origin: `http://127.0.0.1:${server.address().port}` });
  await browser.navigate("/");
  for (const fixture of [{ mode: "available", legacy: true }, { mode: "missing" }, { mode: "no2d" },
    { mode: "noEncoder" }, { mode: "missing", rotated: true }, { mode: "missing", legacy: true, error: "media_heic" }]) {
    mode = fixture.mode;
    const result = await browser.executeAsync(`
      const done = arguments[arguments.length - 1], { legacy, rotated } = arguments[0];
      (async () => {
        const original = await (await fetch(rotated ? '/photo-rotated.heic' : '/photo.heic')).blob();
        const savedBitmap = globalThis.createImageBitmap, savedImage = globalThis.Image, create = document.createElement;
        const pixels = [], draws = [], violations = [];
        const violation = event => violations.push(event.violatedDirective);
        addEventListener('securitypolicyviolation', violation);
        document.createElement = function (...args) {
          const element = create.apply(this, args);
          if (args[0] === 'canvas') {
            const get = element.getContext;
            element.getContext = function (...args) {
              const context = get.apply(this, args), put = context?.putImageData, draw = context?.drawImage;
              if (put) context.putImageData = function (image, ...args) { pixels.push([image.width, image.height, image.data.byteLength]); return put.call(this, image, ...args); };
              if (draw) context.drawImage = function (...args) { draws.push([element.width, element.height]); return draw.apply(this, args); };
              return context;
            };
          }
          return element;
        };
        globalThis.createImageBitmap = async () => { throw new DOMException('Synthetic native HEIC unavailable', 'InvalidStateError'); };
        globalThis.Image = undefined;
        try {
          let output;
          if (legacy) {
            const bytes = await original.arrayBuffer();
            output = await new Promise((resolve, reject) => {
              const worker = new Worker('/heic-decoder-worker.js', { type: 'module' });
              worker.onerror = () => { worker.terminate(); reject(new Error('worker_error')); };
              worker.onmessage = ({ data }) => {
                worker.terminate();
                if (data.ok !== true) reject(Object.assign(new Error('worker_error'), { code: data.code }));
                else if (!(data.blob instanceof Blob) || data.pixels !== undefined) reject(new Error('legacy_contract'));
                else resolve(data.blob);
              };
              worker.postMessage({ bytes }, [bytes]);
            });
          } else {
            const { prepareImageUpload } = await import('/image-preparation.js');
            output = await prepareImageUpload(original);
          }
          removeEventListener('securitypolicyviolation', violation);
          const documentWasmBlocked = await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])).then(() => false, () => true);
          return { type: output.type, bytes: Array.from(new Uint8Array(await output.arrayBuffer())), pixels, draws, violations, documentWasmBlocked };
        } finally {
          globalThis.createImageBitmap = savedBitmap; globalThis.Image = savedImage; document.createElement = create;
          removeEventListener('securitypolicyviolation', violation);
        }
      })().then(done, error => done({ failureCode: error.code || error.message }));
    `, fixture);
    if (fixture.error) { assert.equal(result.failureCode, fixture.error); continue; }
    assert.equal(result.failureCode, undefined, fixture.mode);
    assert.equal(result.type, "image/jpeg"); assert.equal(result.documentWasmBlocked, true);
    assert.deepEqual(result.violations, []);
    const expected = fixture.rotated ? [48, 64] : [64, 48];
    assert.deepEqual(result.pixels, fixture.legacy ? [] : [[...expected, 64 * 48 * 4]]);
    assert.ok(result.draws.every(([width, height]) => width <= 2048 && height <= 2048));
    const bytes = Buffer.from(result.bytes), metadata = await sharp(bytes).metadata();
    assert.ok(bytes.length > 0 && bytes.length <= 2 * 1024 * 1024);
    assert.deepEqual([metadata.width, metadata.height], expected);
    for (const field of ["exif", "iptc", "xmp", "orientation"]) assert.equal(metadata[field], undefined);
    assert.ok((await sharp(bytes).removeAlpha().raw().toBuffer()).some(value => value > 100), "real HEVC colour survives the transferred-plane canvas copy");
    const accepted = await normalizeImage(bytes);
    assert.deepEqual([accepted.width, accepted.height], expected);
  }
  assert.deepEqual(decoderRequests.map(request => request[1]), ["available", "missing", "no2d", "noEncoder", "missing", "missing"]);
});

test("real native preparation accepts raster variants and caller conversion automatically covers TIFF", { timeout: 120000 }, async t => {
  const driver = await startWebDriver(); t.after(() => driver.close());
  const helper = await readFile(new URL("../../public/image-preparation.js", import.meta.url));
  const fixtures = JSON.parse(await readFile(new URL("../fixtures/photo-acceptance-formats.json", import.meta.url), "utf8")).fixtures;
  const images = new Map(fixtures.map(fixture => [fixture.name, { ...fixture, bytes: Buffer.from(fixture.base64, "base64") }]));
  const video = Buffer.from(await readFile(new URL("../fixtures/video-decodable.mp4.base64", import.meta.url), "utf8"), "base64");
  const conversionRequests = [], unexpectedRequests = [];
  const server = createServer(async (request, response) => {
    if (request.url === "/image-preparation.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(helper); }
    else if (request.url === "/actual-video.mp4") { response.writeHead(200, { "Content-Type": "video/mp4" }); response.end(video); }
    else if (request.url.startsWith("/source/")) {
      const image = images.get(request.url.slice("/source/".length));
      if (!image) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "Content-Type": image.mime }); response.end(image.bytes);
    } else if (request.url === "/prepare/tiff-lzw" && request.method === "POST") {
      // This loopback fixture exercises the callback/binary contract only;
      // service authorization is covered by the separate authenticated route.
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const original = Buffer.concat(chunks);
      conversionRequests.push({ name: "tiff-lzw", bytes: original.length });
      if (!original.equals(images.get("tiff-lzw").bytes)) { response.writeHead(400); response.end(); return; }
      const jpeg = await sharp(original).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg().toBuffer();
      response.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "no-store" }); response.end(jpeg);
    } else if (request.url === "/") { response.writeHead(200, { ...AUTH_HEADERS, "Content-Type": "text/html" }); response.end("<!doctype html><title>Local raster acceptance</title>"); }
    else { unexpectedRequests.push(request.url); response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const browser = await driver.browser({ origin: `http://127.0.0.1:${server.address().port}` });
  await browser.navigate("/");
  for (const fixture of fixtures) await t.test(fixture.name, async () => {
    const result = await browser.executeAsync(`
      const done = arguments[arguments.length - 1], { name } = arguments[0];
      (async () => {
        const { prepareImageUpload } = await import('/image-preparation.js');
        const source = await (await fetch('/source/'+name)).blob();
        const input = new Blob([source], { type: 'application/octet-stream' });
        const controller = new AbortController(); let conversions = 0;
        const bitmap = globalThis.createImageBitmap, image = globalThis.Image;
        if (name === 'tiff-lzw') {
          globalThis.createImageBitmap = async () => { throw new DOMException('Synthetic TIFF unavailable', 'NotSupportedError'); };
          globalThis.Image = undefined;
        }
        try {
          const output = await prepareImageUpload(input, { signal: controller.signal,
            convert: async (file, { signal }) => {
              conversions += 1;
              if (signal !== controller.signal || file !== input) throw new Error('conversion_identity');
              const response = await fetch('/prepare/'+name, { method: 'POST', body: file, signal, headers: { 'Content-Type': file.type } });
              if (!response.ok) throw Object.assign(new Error('conversion_failed'), { code: 'conversion_'+response.status });
              return response.blob();
            }
          });
          return { type: output.type, bytes: Array.from(new Uint8Array(await output.arrayBuffer())), conversions };
        } finally { globalThis.createImageBitmap = bitmap; globalThis.Image = image; }
      })().then(done, error => done({ failureCode: error.code || error.name }));
    `, { name: fixture.name });
    assert.equal(result.failureCode, undefined, fixture.name);
    assert.ok(["image/jpeg", "image/png"].includes(result.type));
    const bytes = Buffer.from(result.bytes), metadata = await sharp(bytes).metadata();
    assert.ok(bytes.length <= 2 * 1024 * 1024);
    assert.deepEqual([metadata.width, metadata.height], [fixture.preparedWidth, fixture.preparedHeight]);
    assert.ok(metadata.width <= 2048 && metadata.height <= 2048);
    for (const field of ["exif", "iptc", "xmp", "orientation"]) assert.equal(metadata[field], undefined, fixture.name);
    if (fixture.sourcePages > 1) {
      const pixel = await sharp(bytes).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
      assert.ok(pixel[0] > 150 && pixel[2] < 150 && pixel[0] > pixel[2] + 50, "the first red frame is normalized, never the later blue frame");
    }
    if (fixture.name !== "tiff-lzw") assert.equal(result.conversions, 0, "native raster conversion needs no server callback");
    else assert.equal(result.conversions, 1, "an unavailable native TIFF decoder uses exactly one caller conversion");
  });
  await t.test("a real MP4 cannot be prepared as a photo", async () => {
    const result = await browser.executeAsync(`
      const done = arguments[arguments.length - 1];
      (async () => {
        const { prepareImageUpload } = await import('/image-preparation.js');
        const video = await (await fetch('/actual-video.mp4')).blob();
        try { await prepareImageUpload(video); return { accepted: true }; }
        catch (error) { return { accepted: false, failureCode: error.code }; }
      })().then(done, error => done({ failureCode: error.code || error.name }));
    `);
    assert.equal(result.accepted, false);
    assert.equal(result.failureCode, "media_format");
  });
  assert.equal(conversionRequests.length, 1);
  assert.deepEqual(unexpectedRequests.filter(value => value !== "/favicon.ico"), []);
});
