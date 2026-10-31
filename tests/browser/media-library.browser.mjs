// Product media-library page with local synthetic APIs and generated images only.
// No real account, private media, messaging or production service is contacted.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { startWebDriver, waitUntil } from "./webdriver.mjs";
const id = value => value.toString(16).padStart(32, "0"), publicRoot = new URL("../../public/", import.meta.url);
const names = ["media-library-page.html", "media-library-page.js", "media-library-page.css", "media-library-model.js", "i18n-media-library.js", "image-preparation.js", "i18n.js", "i18n.css", "i18n-tools.js", "session-clock.js", "help-link.js", "admin-navigation.css", "brand/brand.css", "brand/icon-128.png", "favicon.ico", "manifest.webmanifest", "apple-touch-icon.png"];
const image = await sharp({ create: { width: 240, height: 160, channels: 3, background: { r: 145, g: 55, b: 100 } } }).jpeg().toBuffer();
const video = Buffer.from(await readFile(new URL("../fixtures/video-decodable.mp4.base64", import.meta.url), "utf8"), "base64");
let driver;
before(async () => { driver = await startWebDriver(); }, { timeout: 60000 });
after(async () => { await driver?.close(); });
async function fixture() {
  const files = new Map(await Promise.all(names.map(async name => ["/" + name, await readFile(new URL(name, publicRoot))])));
  const state = { owner: 1, requests: [], uploads: [], deletions: [], errors: [] };
  const photo = number => ({ id: id(number), width: 240, height: 160, thumbnailWidth: 240, thumbnailHeight: 160, bytes: image.length, thumbnailBytes: image.length, createdAt: 1793470438000 + number * 1000, sharedHere: false, fullUrl: `/api/media/admin/assets/${id(number)}/full`, thumbnailUrl: `/api/media/admin/assets/${id(number)}/thumb` });
  const photos = Array.from({ length: 45 }, (_, index) => photo(index + 1));
  const session = () => ({ user: { id: id(8000 + state.owner), role: "admin", pseudonym: "Synthetic Jessie" }, csrf: (state.owner === 1 ? "a" : "b").repeat(43), expiresAt: Date.now() + 3600000 });
  const server = createServer((request, response) => { void (async () => {
    const url = new URL(request.url, "http://localhost"); state.requests.push({ path: url.pathname + url.search, method: request.method });
    const json = (status, body) => { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(body)); };
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (url.pathname === "/fixture.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end("window.__libraryErrors=[];addEventListener('error',e=>__libraryErrors.push(String(e.message)));addEventListener('unhandledrejection',e=>__libraryErrors.push(String(e.reason?.message??e.reason)));addEventListener('securitypolicyviolation',e=>__libraryErrors.push('CSP:'+e.violatedDirective));"); return; }
    if (url.pathname === "/fixture/switch") { state.owner = 2; json(200, {}); return; }
    if (url.pathname === "/api/auth/session") { json(200, session()); return; }
    if (url.pathname === "/api/media/admin/capabilities") { json(200, { enabled: true, formats: ["image/jpeg", "image/png", "image/webp"], maxUploadBytes: 10485760 }); return; }
    if (url.pathname === "/api/chat/admin/capabilities") { json(200, { enabled: true, video: { enabled: true, maxBytes: 104857600, mime: "video/mp4" } }); return; }
    if (url.pathname === "/api/media/admin/assets" && request.method === "POST") {
      assert.equal(request.headers["content-type"], "image/jpeg"); assert.equal(request.headers["x-csrf-token"], session().csrf);
      const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = Buffer.concat(chunks); assert.deepEqual([...body.subarray(0, 3)], [255, 216, 255]);
      state.uploads.push({ bytes: body.length, type: request.headers["content-type"] }); json(201, { asset: photo(99), duplicate: false }); return;
    }
    if (url.pathname === "/api/media/admin/assets") {
      assert.equal(url.searchParams.get("limit"), "20"); const after = url.searchParams.get("afterId"), rows = state.owner === 1 ? photos.filter(row => !after || row.id > after) : [], page = rows.slice(0, 20), more = rows.length > 20;
      json(200, { assets: page, nextCursor: more ? page.at(-1).id : null, hasMore: more }); return;
    }
    if (/^\/api\/media\/admin\/assets\/[a-f0-9]{32}\/(thumb|full)$/.test(url.pathname)) {
      response.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": image.length }); response.end(image); return;
    }
    if (/^\/api\/(media|video)\/admin\/assets\/[a-f0-9]{32}\/delete$/.test(url.pathname) && request.method === "POST") {
      assert.equal(request.headers["x-csrf-token"], session().csrf); state.deletions.push(url.pathname); for await (const _chunk of request) { /* Drain synthetic body. */ }
      json(409, { error: url.pathname.startsWith("/api/video") ? "video_in_use" : "media_in_use" }); return;
    }
    if (url.pathname === "/api/video/admin/assets") { json(200, { assets: [{ id: id(80), createdAt: 1793470438000, bytes: video.length, mime: "video/mp4", cleanupPending: false, contentUrl: `/api/video/admin/assets/${id(80)}/content` }], nextCursor: null, hasMore: false }); return; }
    if (url.pathname === `/api/video/admin/assets/${id(80)}/content`) { response.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": video.length }); response.end(video); return; }
    if (url.pathname === "/admin/media") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(files.get("/media-library-page.html").toString().replace("<head>", '<head><script src="/fixture.js"></script>')); return; }
    if (files.has(url.pathname)) {
      const ext = url.pathname.split(".").at(-1); response.writeHead(200, { "Content-Type": ext === "js" ? "text/javascript" : ext === "css" ? "text/css" : ext === "png" ? "image/png" : ext === "html" ? "text/html" : "application/octet-stream" }); response.end(files.get(url.pathname)); return;
    }
    json(404, { error: "not_found" });
  })().catch(error => { state.errors.push(error.message); if (!response.headersSent) response.writeHead(500); response.end(); }); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { state, origin: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
async function open(source, width, language) {
  const page = await driver.browser({ origin: source.origin, width, height: 780 }); await page.navigate("/admin/media");
  await waitUntil(() => page.execute("return window.JessieI18n && !document.getElementById('library-content').hidden && document.querySelectorAll('#media-grid button').length===20"), "own media library ready");
  await page.execute("JessieI18n.setLanguage(arguments[0])", language);
  await waitUntil(() => page.execute("return document.querySelector('#media-grid img')?.naturalWidth>0"), "first real photo thumbnail decoded"); return page;
}
async function errors(page, source) { assert.deepEqual(await page.execute("return window.__libraryErrors"), []); assert.deepEqual(source.state.errors, []); }
test("Chrome media library FR320/EN1280: actual thumbnails, bounded pages, keyboard preview and protected deletion", { timeout: 120000 }, async () => {
  for (const [width, language] of [[320, "fr"], [1280, "en"]]) {
    const source = await fixture(); let page;
    try {
      page = await open(source, width, language);
      assert.equal(await page.execute("return document.documentElement.scrollWidth<=innerWidth && document.querySelectorAll('#media-grid button').length===20"), true);
      await page.execute("document.querySelector('#media-grid button').focus()"); await page.key("\uE007");
      await waitUntil(() => page.execute("return !document.getElementById('media-detail').hidden && document.querySelector('#media-preview img')?.naturalWidth>0"), "keyboard opens the selected photo");
      const preview = await page.execute("return document.querySelector('#media-preview img').src"); await page.click("#next-page");
      await waitUntil(() => page.execute("return document.querySelector('#media-grid button')?.dataset.mediaId===arguments[0] && !document.getElementById('next-page').disabled", id(21)), "library next page replaces rows");
      assert.equal(await page.execute("return document.querySelector('#media-preview img').src"), preview);
      await page.click("#delete-media"); assert.equal(source.state.deletions.length, 0); await page.click("#confirm-delete");
      await waitUntil(() => page.execute("return document.getElementById('preview-status').textContent===arguments[0]", language === "fr" ? "Ce média est utilisé par un message ou une diffusion et ne peut pas être supprimé ici." : "This media is used in a message or broadcast and cannot be deleted here."), "in-use media remains protected");
      assert.equal(source.state.deletions.length, 1); assert.equal(await page.execute("return document.querySelectorAll('#media-grid button').length"), 20);
      await page.execute("document.getElementById('library-title').scrollIntoView({block:'start'})");
      const directory = new URL("../../artifacts/homepage/", import.meta.url); await mkdir(directory, { recursive: true }); await writeFile(new URL(`media-library-1140-${language}-${width}.png`, directory), Buffer.from(await page.screenshot(), "base64"));
      await errors(page, source);
    } finally { await page?.close(); await source.close(); }
  }
});
test("Chrome media library: direct photo upload prepares a JPEG and never sends a message or campaign", { timeout: 60000 }, async () => {
  const source = await fixture(); let page;
  try {
    page = await open(source, 390, "fr");
    await page.executeAsync("const done=arguments[arguments.length-1],canvas=document.createElement('canvas');canvas.width=120;canvas.height=80;canvas.getContext('2d').fillRect(0,0,120,80);canvas.toBlob(blob=>{const data=new DataTransfer();data.items.add(new File([blob],'synthetic-added-photo.png',{type:'image/png'}));const input=document.getElementById('photo-file');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));done(true)},'image/png')");
    await waitUntil(() => source.state.uploads.length === 1 && page.execute("return document.getElementById('library-status').textContent==='Photo ajoutée à ta bibliothèque.' && document.querySelector('#media-preview img')?.naturalWidth>0 && !document.getElementById('photo-file').disabled"), "prepared upload shown in the selected preview");
    assert.equal(source.state.uploads[0].type, "image/jpeg"); assert.equal(source.state.requests.filter(row => row.method === "POST").length, 1);
    assert.equal(await page.execute("return document.querySelectorAll('#media-grid button').length"), 20); await errors(page, source);
  } finally { await page?.close(); await source.close(); }
});
test("Chrome media library: session change clears selected private media before another owner's list can appear", { timeout: 60000 }, async () => {
  const source = await fixture(); let page;
  try {
    page = await open(source, 390, "en"); await page.click("#media-grid button"); await waitUntil(() => page.execute("return document.querySelector('#media-preview img')?.naturalWidth>0"), "private preview ready");
    await page.executeAsync("const done=arguments[arguments.length-1];fetch('/fixture/switch').then(()=>done(true),()=>done(false))"); await page.click("#refresh-list");
    await waitUntil(() => page.execute("return document.getElementById('library-content').hidden && document.querySelectorAll('#media-grid button').length===0 && document.querySelectorAll('#media-preview img').length===0 && !document.getElementById('reload-session').hidden"), "old session private contents discarded");
    await page.click("#reload-session"); await waitUntil(() => page.execute("return !document.getElementById('library-content').hidden && document.querySelectorAll('#media-grid button').length===0"), "new owner empty own library"); await errors(page, source);
  } finally { await page?.close(); await source.close(); }
});
