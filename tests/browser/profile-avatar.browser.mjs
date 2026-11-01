// Real avatar decoding/cropping with synthetic photos and a loopback-only server.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import sharp from "sharp";
import { AUTH_HEADERS } from "../../server/auth/http.mjs";
import { startWebDriver, waitUntil } from "./webdriver.mjs";

async function avatarFixture() {
  const names = ["profile.js", "image-preparation.js", "i18n-profile.js", "password-change.js", "recover-model.js", "password-fields.js",
    "preferences.js", "preferences-model.js", "i18n-preferences.js", "profile-publication.js", "public-profile-model.js", "i18n-public-profile.js", "i18n.js"];
  const resources = new Map(await Promise.all(names.map(async name => [`/${name}`, await readFile(new URL(`../../public/${name}`, import.meta.url))])));
  resources.set("/heic-decoder-worker.js", await readFile(new URL("../../public/heic-decoder-worker.js", import.meta.url)));
  resources.set("/heic-codec-1.23.5.mjs", await readFile(new URL("../../node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs", import.meta.url)));
  const privateMarker = "synthetic-avatar-original-owner-1141";
  const source = sharp({ create: { width: 800, height: 400, channels: 4, background: { r: 170, g: 50, b: 90, alpha: 0.5 } } })
    .withExif({ IFD0: { Artist: privateMarker } });
  const formats = [["jpg", "image/jpeg", source.clone().jpeg()], ["png", "image/png", source.clone().png()],
    ["webp", "image/webp", source.clone().webp({ lossless: true })], ["avif", "image/avif", source.clone().avif({ lossless: true })]];
  const photos = new Map(await Promise.all(formats.map(async ([extension, type, encoded]) => [`/photo.${extension}`, [await encoded.toBuffer(), type]])));
  photos.set("/photo.heic", [Buffer.from(await readFile(new URL("../fixtures/photo-1140.heic.b64", import.meta.url), "utf8"), "base64"), "image/heic"]);
  const decoderRequests = [], failures = [];
  const workerPolicy = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
  const server = createServer((request, response) => {
    try {
      if (request.method !== "GET") { failures.push("unexpected mutation"); response.writeHead(405); response.end(); return; }
      if (request.url === "/") {
        response.writeHead(200, { ...AUTH_HEADERS, "Content-Type": "text/html" });
        response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic avatar fixture</title><script src="/i18n.js"></script>'); return;
      }
      if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); return; }
      const photo = photos.get(request.url);
      if (photo) { response.writeHead(200, { "Content-Type": photo[1], "Cache-Control": "no-store" }); response.end(photo[0]); return; }
      if (resources.has(request.url)) {
        if (request.url.startsWith("/heic-")) decoderRequests.push(request.url);
        response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store",
          ...(request.url === "/heic-decoder-worker.js" ? { "Content-Security-Policy": workerPolicy } : {}) });
        response.end(resources.get(request.url)); return;
      }
      failures.push(`unmapped fixture route ${request.url}`); response.writeHead(404); response.end();
    } catch { failures.push("fixture response failed"); response.destroy(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, privateMarker, photos, decoderRequests, failures,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

async function assertAvatar(result, label, marker) {
  assert.equal(result.error, undefined, `${label}: ${result.error}`);
  assert.equal(result.type, "image/jpeg", label); assert.ok(result.bytes.length > 0 && result.bytes.length <= 262144, label);
  assert.deepEqual(result.violations, [], `${label}: document and isolated worker CSP are enforced`);
  const bytes = Buffer.from(result.bytes), metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [256, 256], label);
  assert.equal(metadata.hasAlpha, false, label); assert.equal(bytes.includes(Buffer.from(marker)), false, label);
  for (const field of ["exif", "iptc", "xmp", "orientation"]) assert.equal(metadata[field], undefined, `${label}: ${field}`);
  assert.ok(result.draws.every(([width, height]) => width <= 2048 && height <= 2048), `${label}: canvases remain bounded`);
}

test("real Chrome prepares JPEG, PNG, WebP, AVIF and HEIC avatars as private 256px JPEGs", { timeout: 120000 }, async t => {
  const driver = await startWebDriver(); t.after(() => driver.close());
  const source = await avatarFixture(); t.after(() => source.close());
  const browser = await driver.browser({ origin: source.origin }); await browser.navigate("/");
  for (const path of source.photos.keys()) {
    await t.test(path, async () => {
      if (path !== "/photo.heic") assert.deepEqual(source.decoderRequests, [], "native formats do not load the HEVC dependency");
      const result = await browser.executeAsync(`
        const done = arguments[arguments.length - 1], path = arguments[0];
        (async () => {
          const { prepareProfileAvatar } = await import('/profile.js'), photo = await (await fetch(path)).blob();
          const create = document.createElement, draws = [], violations = [];
          const violation = event => violations.push(event.violatedDirective); addEventListener('securitypolicyviolation', violation);
          document.createElement = function (...args) {
            const element = create.apply(this, args);
            if (args[0] === 'canvas') {
              const get = element.getContext;
              element.getContext = function (...args) { const context = get.apply(this, args), draw = context?.drawImage;
                if (draw) context.drawImage = function (...args) { draws.push([element.width, element.height]); return draw.apply(this, args); }; return context; };
            }
            return element;
          };
          try { const blob = await prepareProfileAvatar(new File([photo], 'camera-original', { type: 'application/octet-stream' }));
            return { type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), draws, violations }; }
          finally { document.createElement = create; removeEventListener('securitypolicyviolation', violation); }
        })().then(done, error => done({ error: error.code || error.name }));
      `, path);
      await assertAvatar(result, path, source.privateMarker);
    });
  }
  assert.ok(source.decoderRequests.includes("/heic-decoder-worker.js"));
  assert.ok(source.decoderRequests.includes("/heic-codec-1.23.5.mjs")); assert.deepEqual(source.failures, []);
});

test("real Chrome avatar cropping falls back to Image when ImageBitmap is missing or rejects", { timeout: 90000 }, async t => {
  const driver = await startWebDriver(); t.after(() => driver.close());
  const source = await avatarFixture(); t.after(() => source.close());
  const browser = await driver.browser({ origin: source.origin }); await browser.navigate("/");
  for (const mode of ["missing", "rejecting"]) await t.test(mode, async () => {
    const result = await browser.executeAsync(`
      const done = arguments[arguments.length - 1], mode = arguments[0];
      (async () => {
        const { prepareProfileAvatar } = await import('/profile.js'), photo = await (await fetch('/photo.png')).blob();
        const bitmap = globalThis.createImageBitmap, createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL;
        const created = [], revoked = [], violations = [];
        const violation = event => violations.push(event.violatedDirective); addEventListener('securitypolicyviolation', violation);
        URL.createObjectURL = blob => { const url = createURL(blob); created.push(url); return url; };
        URL.revokeObjectURL = url => { revoked.push(url); return revokeURL(url); };
        globalThis.createImageBitmap = mode === 'missing' ? undefined : async () => { throw new DOMException('Synthetic unavailable bitmap', 'InvalidStateError'); };
        try { const blob = await prepareProfileAvatar(photo); return { type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
          created: created.length, revoked: revoked.length, allReleased: created.every(url => revoked.includes(url)), draws: [], violations }; }
        finally { globalThis.createImageBitmap = bitmap; URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL;
          removeEventListener('securitypolicyviolation', violation); }
      })().then(done, error => done({ error: error.code || error.name }));
    `, mode);
    await assertAvatar(result, mode, source.privateMarker);
    assert.ok(result.created >= 2, "both shared preparation and avatar crop use native Image fallback");
    assert.equal(result.created, result.revoked); assert.equal(result.allReleased, true);
  });
  assert.deepEqual(source.failures, []);
});

test("real Chrome avatar picker prepares AVIF and HEIC locally before an explicit profile save", { timeout: 90000 }, async t => {
  const driver = await startWebDriver(); t.after(() => driver.close());
  const source = await avatarFixture(); t.after(() => source.close());
  const browser = await driver.browser({ origin: source.origin, width: 320 }); await browser.navigate("/");
  const opened = await browser.executeAsync(`
    const done = arguments[arguments.length - 1];
    (async () => {
      const { createProfileUI } = await import('/profile.js'); window.__avatarWrites = [];
      window.__avatarUI = createProfileUI({ role: 'client', isCurrent: () => true,
        request: async (path, options) => { if (options.mutation) window.__avatarWrites.push(path);
          return { pseudonym: 'Synthetic avatar', version: '1', avatarId: null, avatarUrl: null }; },
        fetchBinary: async () => { throw Error('No saved avatar expected'); } });
      await window.__avatarUI.open(); return true;
    })().then(done, error => done({ error: error.name }));
  `);
  assert.equal(opened, true);
  assert.equal(await browser.execute("return document.querySelector('.profile-file').accept"), "image/*,.heic,.heif,.avif");
  for (const path of ["/photo.avif", "/photo.heic"]) await t.test(path, async () => {
    await browser.executeAsync(`
      const done = arguments[arguments.length - 1], path = arguments[0];
      (async () => {
        const blob = await (await fetch(path)).blob(), input = document.querySelector('.profile-file'), selected = new DataTransfer();
        document.querySelector('.profile-choose-avatar').click();
        selected.items.add(new File([blob], 'camera-original', { type: 'application/octet-stream' })); input.files = selected.files;
        input.dispatchEvent(new Event('change', { bubbles: true })); return true;
      })().then(done, error => done({ error: error.name }));
    `, path);
    await waitUntil(() => browser.execute("return document.querySelector('.profile-status').textContent==='Avatar prêt. Enregistre le profil pour l’appliquer.'"), "normalized avatar ready");
    await waitUntil(() => browser.execute("return document.querySelector('.profile-avatar-preview img').naturalWidth===256"), "prepared avatar preview decoded");
    assert.deepEqual(await browser.execute("return window.__avatarWrites"), []);
    assert.equal(await browser.execute("return document.querySelector('.profile-file').value"), "");
  });
  await browser.execute("window.__avatarUI.destroy()"); assert.deepEqual(source.failures, []);
});

test("real Chrome profile conversion uses the injected original once and crops its validated JPEG before save", { timeout: 90000 }, async t => {
  const driver = await startWebDriver(); t.after(() => driver.close());
  const source = await avatarFixture(); t.after(() => source.close());
  const browser = await driver.browser({ origin: source.origin }); await browser.navigate("/");
  assert.equal(await browser.executeAsync(`
    const done = arguments[arguments.length - 1];
    (async () => {
      const { createProfileUI } = await import('/profile.js'), normalized = await (await fetch('/photo.jpg')).blob();
      window.__conversionCalls = []; window.__avatarWrites = []; window.__avatarViolations = [];
      window.__avatarViolation = event => window.__avatarViolations.push(event.violatedDirective);
      addEventListener('securitypolicyviolation', window.__avatarViolation);
      window.__avatarCreateURL = URL.createObjectURL;
      URL.createObjectURL = blob => { window.__avatarPreparedBlob = blob; return window.__avatarCreateURL(blob); };
      window.__avatarUI = createProfileUI({ role: 'client', isCurrent: () => true,
        convertImage: async (original, { signal }) => {
          window.__conversionCalls.push({ sameOriginal: original === window.__avatarOriginal, signal }); return normalized;
        },
        request: async (path, options) => { if (options.mutation) window.__avatarWrites.push(path);
          return { pseudonym: 'Synthetic converted avatar', version: '1', avatarId: null, avatarUrl: null }; },
        fetchBinary: async () => { throw Error('No saved avatar expected'); } });
      await window.__avatarUI.open();
      const input = document.querySelector('.profile-file'), selected = new DataTransfer();
      document.querySelector('.profile-choose-avatar').click();
      selected.items.add(new File(['synthetic undecodable original'], 'opaque.tiff', { type: 'image/tiff' }));
      input.files = selected.files; window.__avatarOriginal = input.files[0];
      input.dispatchEvent(new Event('change', { bubbles: true })); return true;
    })().then(done, error => done({ error: error.code || error.name }));
  `), true);
  await waitUntil(() => browser.execute("return document.querySelector('.profile-status').textContent==='Avatar prêt. Enregistre le profil pour l’appliquer.'"), "converted profile avatar ready");
  await waitUntil(() => browser.execute("return document.querySelector('.profile-avatar-preview img').naturalWidth===256"), "converted profile avatar preview");
  const result = await browser.executeAsync(`
    const done = arguments[arguments.length - 1];
    (async () => { const blob = window.__avatarPreparedBlob;
      return { type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), draws: [], violations: window.__avatarViolations,
        calls: window.__conversionCalls.map(call => ({ sameOriginal: call.sameOriginal, aborted: call.signal.aborted })), writes: window.__avatarWrites };
    })().then(done, error => done({ error: error.code || error.name }));
  `);
  await assertAvatar(result, "injected avatar conversion", source.privateMarker);
  assert.deepEqual(result.calls, [{ sameOriginal: true, aborted: false }]); assert.deepEqual(result.writes, []);
  await browser.execute(`window.__avatarUI.destroy(); URL.createObjectURL = window.__avatarCreateURL;
    removeEventListener('securitypolicyviolation', window.__avatarViolation);`);
  assert.deepEqual(source.decoderRequests, []); assert.deepEqual(source.failures, []);
});
