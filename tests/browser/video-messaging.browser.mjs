// Chrome-only UI qualification with a synthetic decodable MP4. The separate
// video rehearsal exercises the real authenticated HTTPS/SQL/storage chain.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname } from "node:path";
import { startWebDriver, tabUntil, waitUntil } from "./webdriver.mjs";

const id = number => number.toString(16).padStart(32, "0");
const conversationId = id(10), initialMessageId = id(20), videoId = id(30);
const mp4 = Buffer.from(await readFile(new URL("../fixtures/video-decodable.mp4.base64", import.meta.url), "utf8"), "base64");
const csrf = Buffer.alloc(32, 1).toString("base64url");
const publicFiles = new Set(["chat.html", "chat.js", "photo-batch.js", "photo-upload.js", "chat-model.js", "chat-drafts.js", "chat.css", "session-clock.js", "notification-link.js", "password-fields.js", "password-fields.css", "preferences.css", "i18n.js", "i18n-chat.js", "i18n-tools.js", "i18n.css", "help-link.js", "notifications.js", "notifications.css", "emoji-catalog.js", "emoji.css", "quick-replies.js", "image-preparation.js", "profile.css", "manifest.webmanifest", "favicon.ico", "apple-touch-icon.png", "brand/brand.css", "brand/icon-32.png", "brand/icon-128.png", "brand/icon-192.png"]);
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
let server, driver, origin, fixture;
function metadata(messageId) { return { id: videoId, bytes: mp4.length, mime: "video/mp4", contentUrl: `/api/video/${fixture.role}/conversations/${conversationId}/messages/${messageId}/content` }; }
function reset(role = "admin") {
  fixture = { role, signedIn: true, uploads: [], commands: [], ranges: [], deletes: [], errors: [], readThrough: "0", deniedCreations: 0, ownedDeleted: false, uncertainSend: true, now: Date.now() - 10000, messages: [] };
  fixture.messages.push({ id: initialMessageId, sequence: "1", sender: "peer", body: "Synthetic private video", createdAt: Date.now() - 9000, deletedAt: null, clientMessageId: null, video: metadata(initialMessageId) });
}
function conversation() { return { id: conversationId, peerName: "Synthetic peer", createdAt: fixture.now, closedAt: null, lastActivityAt: fixture.now,
  latestSequence: String(fixture.messages.length), latestEventSequence: "1", lastReadSequence: fixture.readThrough, peerReadSequence: "0", unreadCount: 0, canSend: true }; }
async function startFixture() {
  const files = new Map(await Promise.all([...publicFiles].map(async name => ["/" + name, await readFile(new URL("../../public/" + name, import.meta.url))])));
  files.set("/video-fixture.js", Buffer.from('window.__videoErrors=[];window.__revoked=[];window.addEventListener("error",e=>__videoErrors.push(String(e.message)));window.addEventListener("unhandledrejection",e=>__videoErrors.push(String(e.reason?.message??e.reason)));window.addEventListener("securitypolicyviolation",e=>__videoErrors.push("CSP: "+e.violatedDirective));const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=u=>{__revoked.push(u);revoke(u)};'));
  files.set("/chat.html", Buffer.from(files.get("/chat.html").toString().replace("<head>", '<head><script src="/video-fixture.js"></script>')));
  server = createServer((request, response) => { void (async () => {
    const url = new URL(request.url, "http://localhost");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (status, value) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
    if (["/messages", "/admin/messages"].includes(url.pathname)) { response.writeHead(200, { "Content-Type": "text/html" }); response.end(files.get("/chat.html")); return; }
    if (files.has(url.pathname)) { response.writeHead(200, { "Content-Type": types[extname(url.pathname)] ?? "application/octet-stream" }); response.end(files.get(url.pathname)); return; }
    if (url.pathname === (fixture.role === "admin" ? "/api/auth/session" : "/api/access/session")) { json(fixture.signedIn ? 200 : 401, fixture.signedIn ? { user: { id: id(1), role: fixture.role, pseudonym: "Synthetic " + fixture.role }, csrf, expiresAt: Date.now() + 3600000, ...(fixture.role === "client" ? { access: { state: "active" } } : {}) } : { error: "authentication_required" }); return; }
    if (url.pathname === `/api/chat/${fixture.role}/capabilities`) { json(200, { enabled: true, video: { enabled: true, maxBytes: 104857600, mime: "video/mp4", ...(fixture.role === "client" ? { creationEnabled: false } : {}) } }); return; }
    if (url.pathname === `/api/media/${fixture.role}/capabilities`) { json(200, { enabled: true }); return; }
    if (url.pathname === "/api/chat/admin/conversations") { json(200, { conversations: [conversation()], nextCursor: null, hasMore: false }); return; }
    if (url.pathname === "/api/chat/client/conversation") { json(200, conversation()); return; }
    const chatPath = `/api/chat/${fixture.role}/conversations/${conversationId}`;
    if (url.pathname === chatPath + "/messages") { json(200, { conversation: conversation(), messages: fixture.messages, eventCursor: "1", hasMoreBefore: false, nextBefore: null }); return; }
    if (url.pathname === chatPath + "/events") { json(200, { conversation: conversation(), events: [], nextCursor: "1", hasMore: false }); return; }
    if (url.pathname === chatPath + "/read") {
      let body = ""; for await (const chunk of request) body += chunk;
      const command = JSON.parse(body); assert.deepEqual(Object.keys(command), ["throughSequence"]); assert.equal(command.throughSequence, "1");
      fixture.readThrough = command.throughSequence; json(200, { lastReadSequence: fixture.readThrough }); return;
    }
    if (fixture.role === "client" && request.method === "POST" && ["/api/video/client/assets", `/api/video/client/conversations/${conversationId}/messages`].includes(url.pathname)) {
      fixture.deniedCreations++; request.resume(); json(403, { error: "video_admin_only" }); return;
    }
    if (fixture.role === "admin" && url.pathname === "/api/video/admin/assets" && request.method === "POST") {
      assert.equal(request.headers["x-csrf-token"], csrf); assert.equal(request.headers["content-type"], "video/mp4");
      const chunks = []; for await (const chunk of request) chunks.push(chunk); const bytes = Buffer.concat(chunks);
      assert.equal(Number(request.headers["content-length"]), mp4.length); assert.deepEqual(bytes, mp4); fixture.uploads.push(bytes.length);
      json(201, { id: id(31), bytes: bytes.length, mime: "video/mp4" }); return;
    }
    if (url.pathname === `/api/video/${fixture.role}/assets` && request.method === "GET") {
      json(200, { assets: [videoId, ...(fixture.ownedDeleted ? [] : [id(32)])].map(assetId => ({ id: assetId, bytes: mp4.length,
        mime: "video/mp4", createdAt: fixture.now, cleanupPending: false, contentUrl: `/api/video/${fixture.role}/assets/${assetId}/content` })), nextCursor: null, hasMore: false }); return;
    }
    const remove = new RegExp(`^/api/video/${fixture.role}/assets/([a-f0-9]{32})/delete$`).exec(url.pathname);
    if (remove && request.method === "POST") {
      assert.equal(request.headers["x-csrf-token"], csrf); let body = ""; for await (const chunk of request) body += chunk;
      assert.deepEqual(JSON.parse(body), {}); fixture.deletes.push(remove[1]);
      if (remove[1] === videoId) json(409, { error: "video_in_use" });
      else { assert.equal(remove[1], id(32)); fixture.ownedDeleted = true; json(200, { deleted: true }); }
      return;
    }
    const videoPath = `/api/video/${fixture.role}/conversations/${conversationId}`;
    if (url.pathname === videoPath + "/messages" && request.method === "POST") {
      assert.equal(request.headers["x-csrf-token"], csrf); let body = ""; for await (const chunk of request) body += chunk;
      const command = JSON.parse(body); assert.deepEqual(Object.keys(command).sort(), ["caption", "clientMessageId", "replyThrough", "videoId"]);
      assert.equal(command.replyThrough, "1", "the administrator send carries its actual observed client boundary"); fixture.commands.push(command);
      let message = fixture.messages.find(item => item.clientMessageId === command.clientMessageId); const duplicate = Boolean(message);
      if (!message) { message = { id: id(21), sequence: "2", sender: "me", body: command.caption, createdAt: Date.now(), deletedAt: null, clientMessageId: command.clientMessageId, video: metadata(id(21)) }; fixture.messages.push(message); }
      // Persistence happened, while this response cannot confirm the send.
      if (fixture.uncertainSend) { fixture.uncertainSend = false; json(503, { error: "synthetic_response_unavailable" }); return; }
      json(duplicate ? 200 : 201, { message, duplicate }); return;
    }
    if (url.pathname === videoPath + "/gallery") { json(200, { items: [...fixture.messages].reverse().map(message => ({ messageId: message.id, sequence: message.sequence, sender: message.sender, createdAt: message.createdAt, video: message.video })), nextBefore: null, hasMore: false }); return; }
    if (new RegExp("^" + videoPath + "/messages/[a-f0-9]{32}/content$").test(url.pathname)
      || new RegExp(`^/api/video/${fixture.role}/assets/[a-f0-9]{32}/content$`).test(url.pathname)) {
      const range = request.headers.range ?? null; fixture.ranges.push(range); let start = 0, end = mp4.length - 1;
      if (range) { const match = /^bytes=(\d+)-(\d*)$/.exec(range); if (!match) { response.writeHead(416); response.end(); return; } start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; }
      if (start > end) { response.writeHead(416, { "Content-Range": "bytes */" + mp4.length }); response.end(); return; }
      response.writeHead(range ? 206 : 200, { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": end - start + 1, ...(range ? { "Content-Range": "bytes " + start + "-" + end + "/" + mp4.length } : {}) });
      response.end(request.method === "HEAD" ? undefined : mp4.subarray(start, end + 1)); return;
    }
    json(404, { error: "not_found" });
  })().catch(error => { fixture.errors.push({ name: String(error.name), message: String(error.message).slice(0, 600) }); if (!response.headersSent) response.writeHead(500); response.end(); }); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); origin = "http://127.0.0.1:" + server.address().port;
}
before(async () => { reset(); await startFixture(); driver = await startWebDriver(); });
after(async () => { await driver?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve()); });

for (const width of [320, 375, 1280]) for (const language of ["fr", "en"]) test("administrator video draft, native decoding, retry and gallery at " + width + "px in " + language, async () => {
  reset(); const page = await driver.browser({ origin, width });
  try {
    await page.navigate("/admin/messages");
    await waitUntil(() => page.execute("return !document.getElementById('workspace').hidden&&!!document.querySelector('#conversations [data-conversation-id]')"), "administrator inbox");
    await page.click("#conversations [data-conversation-id]");
    await waitUntil(() => page.execute("return !document.getElementById('workspace').hidden && !!document.querySelector('.video-message video')"), "visible video history");
    await page.execute("JessieI18n.setLanguage(arguments[0])", language);
    assert.equal(await page.execute("return document.getElementById('open-video-gallery').textContent"), language === "fr" ? "Vidéos" : "Videos");
    assert.equal(await page.execute("return document.querySelector('.video-message video').autoplay"), false);
    await waitUntil(() => page.execute("return !!document.querySelector('.video-message video')?.getAttribute('src')"), "current owner authorizes the native media URL");
    await page.execute("const v=document.querySelector('.video-message video');v.preload='auto';v.load()");
    await waitUntil(() => page.execute("const v=document.querySelector('.video-message video');return v.videoWidth===96&&v.videoHeight===64&&v.duration>1.5"), "real H264 decoding");
    await page.execute("document.querySelector('.video-message video').currentTime=1.2");
    await waitUntil(() => page.execute("return Math.abs(document.querySelector('.video-message video').currentTime-1.2)<.2"), "native seek");
    assert.equal(await page.executeAsync("const done=arguments[arguments.length-1],v=document.querySelector('.video-message video');v.muted=true;const timer=setTimeout(()=>done(false),5000);v.requestVideoFrameCallback(()=>{clearTimeout(timer);v.pause();done(true)});v.play().catch(()=>{})"), true, "Chrome actually presents a decoded video frame");
    await waitUntil(() => fixture.readThrough === "1", "native administrator view persisted its client-message read boundary");
    await page.click("#open-composer-tools"); await tabUntil(page, "#pick-video");
    assert.equal(await page.execute("return document.activeElement.textContent"), language === "fr" ? "Ajouter une vidéo" : "Add a video");
    await page.execute("const bytes=Uint8Array.from(atob(arguments[0]),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'synthetic.mp4',{type:'video/mp4'}));const input=document.getElementById('video-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));", mp4.toString("base64"));
    await page.click("#close-composer-tools");
    await waitUntil(() => page.execute("return !!document.querySelector('#video-preview video') && !document.getElementById('send').disabled"), "local decodable draft");
    assert.equal(fixture.uploads.length, 0); assert.equal(fixture.commands.length, 0);
    await page.type("#message-body", "Synthetic caption <plain text>");
    const metrics = await page.execute("return {overflow:document.documentElement.scrollWidth>innerWidth,buttons:['send','cancel-video'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {w:r.width,h:r.height}}),preview:document.querySelector('#video-preview video').src}");
    assert.equal(metrics.overflow, false); assert.ok(metrics.buttons.every(button => button.w >= 44 && button.h >= 44)); assert.match(metrics.preview, /^blob:/);
    await page.click("#send");
    await waitUntil(() => page.execute("return !document.getElementById('pending-controls').hidden"), "uncertain response exposes explicit retry");
    assert.equal(fixture.uploads.length, 1); await page.click("#retry-send");
    try { await waitUntil(() => page.execute("return document.getElementById('video-draft').hidden && document.querySelectorAll('.video-message video').length===2"), "acknowledged video"); }
    catch (error) { assert.deepEqual(fixture.errors, [], "the synthetic API must accept the production controller's exact request contract"); throw error; }
    assert.equal(fixture.uploads.length, 1); assert.equal(fixture.commands.length, 2); assert.deepEqual(fixture.commands[0], fixture.commands[1]);
    assert.equal(fixture.messages.length, 2); assert.ok(await page.execute("return document.getElementById('messages').textContent.includes('Synthetic caption <plain text>')"));
    assert.ok(fixture.ranges.some(range => typeof range === "string" && range.startsWith("bytes=")), "native media request uses Range");
    await page.click("#open-conversation-menu"); await tabUntil(page, "#open-video-gallery"); await page.key("\uE007");
    await waitUntil(() => page.execute("return document.getElementById('video-gallery').open && document.querySelectorAll('#video-grid video').length===2"), "private video gallery");
    await page.click("#video-gallery-library");
    await waitUntil(() => page.execute("return document.querySelectorAll('#video-grid article').length===2 && Array.from(document.querySelectorAll('#video-grid video')).every(v=>v.getAttribute('src')?.startsWith('/api/video/admin/assets/'))"), "owned video library");
    assert.equal(await page.execute("return document.getElementById('video-gallery-title').textContent"), language === "fr" ? "Mes vidéos" : "My videos");
    await page.click("#video-grid article:first-child button"); await page.click("#accept-delete");
    await waitUntil(() => page.execute("return document.getElementById('video-gallery-status').textContent.includes(arguments[0])", language === "fr" ? "diffusion est en cours" : "broadcast is in progress"), "live references or active broadcasts prevent deletion");
    assert.equal(await page.execute("return document.querySelectorAll('#video-grid article').length"), 2);
    await page.click("#video-grid article:last-child button"); await page.click("#accept-delete");
    await waitUntil(() => page.execute("return document.querySelectorAll('#video-grid article').length===1"), "unreferenced original removed");
    assert.deepEqual(fixture.deletes, [videoId, id(32)]); assert.equal(fixture.ownedDeleted, true);
    await page.key("\uE00C"); await waitUntil(() => page.execute("return !document.getElementById('video-gallery').open"), "Escape closes gallery");
    await page.execute("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))");
    assert.deepEqual(await page.execute("return Array.from(document.querySelectorAll('video')).map(v=>({src:v.getAttribute('src'),paused:v.paused}))"), [{ src: null, paused: true }, { src: null, paused: true }]);
    assert.ok(await page.execute("return __revoked.length>0")); assert.deepEqual(await page.execute("return __videoErrors"), []); assert.deepEqual(fixture.errors, []);
  } finally { await page.close(); }
});

for (const [width, language] of [[320, "fr"], [1280, "en"]]) test(`client video history stays playable but direct picker events cannot create a draft (${width}px ${language})`, async () => {
  reset("client"); const page = await driver.browser({ origin, width });
  try {
    await page.navigate("/messages");
    await waitUntil(() => page.execute("return !document.getElementById('workspace').hidden&&!!document.querySelector('.video-message video')?.getAttribute('src')"), "client received-video history");
    await page.execute("JessieI18n.setLanguage(arguments[0]);const video=document.querySelector('.video-message video');video.preload='auto';video.load()", language);
    await waitUntil(() => page.execute("const video=document.querySelector('.video-message video');return video.videoWidth===96&&video.videoHeight===64"), "client can still decode a received video");
    await page.click("#open-composer-tools");
    assert.equal(await page.execute("return document.getElementById('pick-video').hidden&&!document.getElementById('pick-image').hidden&&!document.getElementById('pick-image').disabled"), true);
    // Replace only the OS picker. Even a forced change event must hit the
    // client-role guard instead of creating an uploadable video draft.
    await page.execute("const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(arguments[0]),c=>c.charCodeAt(0))],'forced-synthetic.mp4',{type:'video/mp4'}));const input=document.getElementById('video-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));", mp4.toString("base64"));
    assert.equal(await page.execute("return document.getElementById('video-draft').hidden&&document.getElementById('video-file').value===''&&!document.querySelector('#video-preview video')&&document.getElementById('send').disabled"), true);
    assert.equal(await page.execute("return document.getElementById('chat-status').textContent"), language === "fr" ? "L’envoi de vidéos est réservé à Jessie. Tu peux envoyer des photos." : "Only Jessie can send videos. You can send photos.");
    await page.click("#close-composer-tools");
    assert.equal(fixture.uploads.length, 0); assert.equal(fixture.commands.length, 0); assert.equal(fixture.messages.length, 1);
    await page.click("#open-conversation-menu"); await tabUntil(page, "#open-video-gallery"); await page.key("\uE007");
    await waitUntil(() => page.execute("return document.getElementById('video-gallery').open&&document.querySelectorAll('#video-grid video').length===1"), "client retains its received-video gallery");
    await page.key("\uE00C");
    // Synthetic API refusals mirror the real HTTPS rehearsal's independently
    // exercised server guards; no client mutation is ever accepted here.
    const direct = await page.executeAsync(`const id=arguments[0],csrf=arguments[1],done=arguments[arguments.length-1];(async()=>{const statuses=[];
      for(const [path,type,body] of [['/api/video/client/assets','video/mp4',new Uint8Array(16)],['/api/video/client/conversations/'+id+'/messages','application/json',JSON.stringify({clientMessageId:'1'.repeat(32),videoId:'2'.repeat(32),caption:''})]]){
        const response=await fetch(path,{method:'POST',headers:{'Content-Type':type,'X-CSRF-Token':csrf},body});statuses.push({status:response.status,error:(await response.json()).error});}return statuses;})().then(done,()=>done([]));`, conversationId, csrf);
    assert.deepEqual(direct, [{ status: 403, error: "video_admin_only" }, { status: 403, error: "video_admin_only" }]);
    assert.equal(fixture.deniedCreations, 2); assert.deepEqual(fixture.uploads, []); assert.deepEqual(fixture.commands, []); assert.equal(fixture.messages.length, 1);
    assert.deepEqual(await page.execute("return __videoErrors"), []);
  } finally { await page.close(); }
});
