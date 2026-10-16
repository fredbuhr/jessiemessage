// Real Chrome DOM/keyboard smoke tests. All accounts, messages and images below
// are fictional; this server has no database, cookies, mail or external API.
// Run with Chrome + ChromeDriver installed. Missing binaries are a test failure.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { startWebDriver, tabUntil, waitUntil } from "./webdriver.mjs";

const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
const id = (n) => n.toString(16).padStart(32, "0");
const conversationId = id(100);
const photoMessageId = id(203);
const peerName = "AlexFixture";
// Generated 2 x 2 solid-colour JPEG. No personal photograph is used.
const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlqKKKo9M//9k=", "base64");
let server, driver, baseUrl;
let fixture;

function resetFixture() {
  fixture = { deleteRequests: 0, now: Date.now() - 600000, latest: 3, events: [], eventRequests: 0, read: { client: "0", admin: "0" } };
}
function media(role) {
  const prefix = `/api/media/${role}/conversations/${conversationId}/messages/${photoMessageId}`;
  return { id: id(300), width: 2, height: 2, thumbnailWidth: 2, thumbnailHeight: 2, bytes: jpeg.length,
    thumbnailBytes: jpeg.length, createdAt: fixture.now + 3000, sharedHere: true,
    fullUrl: `${prefix}/full`, thumbnailUrl: `${prefix}/thumb` };
}
function message(sequence, role) {
  const number = Number(sequence);
  return { id: id(200 + number), sequence: String(number), sender: number === 2 ? "me" : "peer",
    body: number === 1 ? "Earlier fictional message" : number === 2 ? "Fictional message from me" : number === 3 ? "Fictional photo caption" : `Fictional incoming body ${number}`,
    createdAt: fixture.now + number * 1000, deletedAt: null, clientMessageId: null,
    ...(number === 3 ? { media: media(role) } : {}) };
}
function conversation(role) {
  return { id: conversationId, client: role === "admin" ? { id: id(2), pseudonym: peerName } : null,
    peerName: role === "admin" ? peerName : "Jessie", createdAt: fixture.now, closedAt: null,
    lastActivityAt: fixture.now + fixture.latest * 1000, latestSequence: String(fixture.latest),
    latestEventSequence: String(fixture.latest), lastReadSequence: fixture.read[role], peerReadSequence: "0", unreadCount: 0, canSend: true };
}
function receiveTwoMessages() {
  for (let count = 0; count < 2; count += 1) { fixture.latest += 1; fixture.events.push(fixture.latest); }
}

const bootstrap = `"use strict";
window.__browserErrors = [];
window.addEventListener("error", event => { window.__browserErrors.push(String(event.message).slice(0, 500)); });
window.addEventListener("unhandledrejection", event => { window.__browserErrors.push(String(event.reason?.message ?? event.reason).slice(0, 500)); });
window.addEventListener("securitypolicyviolation", event => { window.__browserErrors.push("CSP: " + event.violatedDirective); });
`;
const fileNames = ["notifications.js", "notifications.css", "chat.html", "chat.js", "chat-model.js", "session-clock.js", "image-preparation.js", "chat.css", "i18n.js", "i18n.css", "i18n-chat.js", "i18n-tools.js",
  "broadcast-preference.js", "manifest.webmanifest", "favicon.ico", "apple-touch-icon.png", "brand/brand.css",
  "brand/icon-16.png", "brand/icon-32.png", "brand/icon-48.png", "brand/icon-64.png", "brand/icon-128.png",
  "brand/icon-192.png", "brand/icon-512.png", "brand/icon-maskable-512.png"];
const contentTypes = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".ico": "image/x-icon" };

async function startFixtureServer() {
  const files = new Map(await Promise.all(fileNames.map(async (name) => [`/${name}`, await readFile(join(publicRoot, name))])));
  files.set("/browser-fixture.js", Buffer.from(bootstrap));
  const html = Buffer.from(files.get("/chat.html").toString().replace("<head>", '<head><script src="/browser-fixture.js"></script>'));
  server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, "http://localhost");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      const sendJson = (status, value) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
      if (request.method === "GET" && ["/messages", "/admin/messages"].includes(url.pathname)) {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(html); return;
      }
      if (request.method === "GET" && files.has(url.pathname)) {
        const extension = url.pathname.slice(url.pathname.lastIndexOf("."));
        response.writeHead(200, { "Content-Type": contentTypes[extension] ?? "application/octet-stream" }); response.end(files.get(url.pathname)); return;
      }
      const sessionRole = url.pathname === "/api/auth/session" ? "admin" : url.pathname === "/api/access/session" ? "client" : null;
      if (sessionRole && request.method === "GET") {
        sendJson(200, { user: { id: id(sessionRole === "admin" ? 1 : 2), role: sessionRole, pseudonym: sessionRole === "admin" ? "Jessie" : peerName },
          csrf: "A".repeat(43), expiresAt: Date.now() + 3600000, ...(sessionRole === "client" ? { access: { state: "active" } } : {}) }); return;
      }
      const match = /^\/api\/(chat|media)\/(admin|client)(\/.*)$/.exec(url.pathname);
      if (match) {
        const [, feature, role, suffix] = match;
        if (request.method === "GET" && suffix === "/capabilities") { sendJson(200, { enabled: true }); return; }
        if (feature === "chat" && request.method === "GET") {
          if (suffix === "/conversation") { sendJson(200, { id: conversationId }); return; }
          if (suffix === "/conversations") { sendJson(200, { conversations: [conversation(role)], nextCursor: null, hasMore: false }); return; }
          if (suffix === `/conversations/${conversationId}/messages`) {
            const older = url.searchParams.has("before");
            sendJson(200, { conversation: conversation(role), messages: (older ? [1] : [2, 3]).map((n) => message(n, role)),
              eventCursor: String(fixture.latest), hasMoreBefore: !older, nextBefore: older ? null : "2" }); return;
          }
          if (suffix === `/conversations/${conversationId}/events`) {
            fixture.eventRequests += 1;
            const after = Number(url.searchParams.get("after"));
            sendJson(200, { conversation: conversation(role), events: fixture.events.filter((n) => n > after).map((n) => ({ sequence: String(n), kind: "message", message: message(n, role) })),
              nextCursor: String(fixture.latest), hasMore: false }); return;
          }
        }
        if (feature === "chat" && request.method === "POST" && suffix === `/conversations/${conversationId}/messages/${id(202)}/delete`) {
          fixture.deleteRequests += 1;
          sendJson(200, { message: { ...message(2, role), body: null, deletedAt: Date.now() } }); return;
        }
        if (feature === "chat" && request.method === "POST" && suffix === `/conversations/${conversationId}/read`) {
          let body = "";
          for await (const chunk of request) { body += chunk; if (body.length > 1000) throw new Error("oversized_fixture_request"); }
          const parsed = JSON.parse(body); assert.match(parsed.throughSequence, /^\d+$/);
          fixture.read[role] = parsed.throughSequence;
          sendJson(200, { lastReadSequence: fixture.read[role] }); return;
        }
        if (feature === "media" && request.method === "GET") {
          if (suffix === `/conversations/${conversationId}/gallery`) {
            sendJson(200, { items: [{ messageId: photoMessageId, createdAt: fixture.now + 3000, media: media(role) }], nextBefore: null, hasMore: false }); return;
          }
          if (suffix === "/assets") { sendJson(200, { assets: [], nextCursor: null, hasMore: false }); return; }
          if ([`/conversations/${conversationId}/messages/${photoMessageId}/thumb`, `/conversations/${conversationId}/messages/${photoMessageId}/full`].includes(suffix)) {
            response.writeHead(200, { "Content-Type": "image/jpeg" }); response.end(jpeg); return;
          }
        }
      }
      // Optional CRM / broadcasts are deliberately disabled for these tests.
      sendJson(404, { error: "not_found" });
    })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
  });
  await new Promise((resolveReady, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveReady); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

const browser = (width = 1280) => driver.browser({ origin: baseUrl, width });
async function loaded(page, path) {
  await page.navigate(path);
  await waitUntil(() => page.execute("return !document.getElementById('workspace').hidden"), "private workspace bootstrap");
}
async function loadedPhoto(page) {
  await waitUntil(() => page.execute("const img = document.querySelector('#messages .photo-open img'); return !!img && img.complete && img.naturalWidth > 0"), "actual JPEG thumbnail decoding");
}
async function noJavascriptErrors(page) { assert.deepEqual(await page.execute("return window.__browserErrors"), [], "no JavaScript / promise / CSP errors"); }

before(async () => { resetFixture(); await startFixtureServer(); driver = await startWebDriver(); }, { timeout: 30000 });
after(async () => {
  try { await driver?.close(); }
  finally { if (server) { server.closeAllConnections(); await new Promise((resolveClosed) => server.close(resolveClosed)); } }
}, { timeout: 35000 });

test("Chrome desktop and 320px: actual Tab / Enter contact selection and return, French / English", { timeout: 60000 }, async () => {
  for (const width of [1280, 320]) {
    resetFixture(); const page = await browser(width);
    try {
      await loaded(page, "/admin/messages");
      await tabUntil(page, "[data-conversation-id]"); await page.key("\uE007");
      await loadedPhoto(page);
      assert.equal(await page.execute("return document.activeElement.id"), "message-scroll", "selecting a contact focuses the history, leaving the draft untouched");
      assert.equal(await page.execute("return document.getElementById('message-body').placeholder"), "Écris ton message…");
      assert.equal(await page.execute("return document.getElementById('peer-name').textContent"), peerName);
      assert.equal(await page.execute("return document.getElementById('message-announcement').textContent"), "", "loaded history is silent");
      await page.click("[data-jm-language]");
      assert.equal(await page.execute("return document.documentElement.lang"), "en");
      assert.equal(await page.execute("return document.getElementById('message-body').placeholder"), "Write your message…");
      assert.equal(await page.execute("return document.getElementById('peer-name').textContent"), peerName, "private names are never translated");
      await tabUntil(page, "#back-to-inbox"); await page.key("\uE007");
      assert.equal(await page.execute("return document.activeElement.dataset.conversationId"), conversationId, "return restores the contact recreated by the controller");
      assert.equal(await page.execute("return document.activeElement.querySelector('strong').textContent"), peerName);
      if (width === 320) assert.equal(await page.execute("return document.documentElement.scrollWidth <= window.innerWidth"), true, "no page overflow at 320px");
      await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome: aggregate new-message announcement, silent empty poll / older history, stable focused photo", { timeout: 45000 }, async () => {
  resetFixture(); const page = await browser();
  try {
    await loaded(page, "/messages"); await loadedPhoto(page);
    await page.click("[data-jm-language]");
    await tabUntil(page, "#messages .photo-open");
    await page.execute(`const region = document.getElementById('message-announcement');
      window.__probe = { article: document.querySelector('#messages [data-sequence="3"]'), photo: document.querySelector('#messages .photo-open'),
        image: document.querySelector('#messages .photo-open img'), remove: document.querySelector('#messages .delete-message'), mutations: 0 };
      window.__probe.observer = new MutationObserver(records => { window.__probe.mutations += records.length; });
      window.__probe.observer.observe(region, { childList: true, characterData: true, subtree: true });`);
    assert.equal(await page.execute("return document.getElementById('message-announcement').textContent"), "");
    receiveTwoMessages();
    await waitUntil(() => page.execute("return document.getElementById('message-announcement').textContent === '2 new messages received.'"), "two incoming messages are announced as a count", 15000);
    assert.equal(await page.execute(`return document.activeElement === window.__probe.photo
      && document.querySelector('#messages [data-sequence="3"]') === window.__probe.article
      && document.querySelector('#messages .photo-open') === window.__probe.photo
      && document.querySelector('#messages .photo-open img') === window.__probe.image
      && document.querySelector('#messages .delete-message') === window.__probe.remove`), true, "new messages preserve existing controls, decoded media and keyboard focus");
    const countAfterMessages = fixture.eventRequests;
    await page.execute("window.__probe.liveText = document.getElementById('message-announcement').firstChild; window.__probe.afterMessages = window.__probe.mutations");
    await waitUntil(() => fixture.eventRequests > countAfterMessages, "next real scheduled empty poll", 10000);
    // The subsequent same-origin session proof and DOM render must also settle.
    await delay(250);
    assert.equal(await page.execute(`const p = window.__probe; return p.mutations === p.afterMessages
      && document.getElementById('message-announcement').firstChild === p.liveText
      && document.activeElement === p.photo && document.querySelector('#messages .photo-open img') === p.image`), true, "an empty poll neither announces nor replaces the focused media");
    await page.click("#older-messages");
    await waitUntil(() => page.execute("return !!document.querySelector('#messages [data-sequence=\"1\"]')"), "older history prepended");
    assert.equal(await page.execute("return document.getElementById('message-announcement').textContent"), "2 new messages received.");
    assert.equal(await page.execute("return window.__probe.mutations === window.__probe.afterMessages"), true, "older history causes no live-region DOM mutation");
    await noJavascriptErrors(page);
  } finally { await page.close(); }
});

test("Chrome mobile: native modal Escape restores photo / gallery focus; private media is memory-only", { timeout: 40000 }, async () => {
  resetFixture(); const page = await browser(390);
  try {
    await loaded(page, "/messages"); await loadedPhoto(page);
    await tabUntil(page, "#messages .photo-open");
    await page.execute("window.__photoOpener = document.activeElement");
    await page.key("\uE007");
    await waitUntil(() => page.execute("const dialog = document.getElementById('lightbox'); const image = dialog.querySelector('img'); return dialog.open && dialog.matches(':modal') && !!image && image.complete && image.naturalWidth > 0"), "native modal with decoded full JPEG");
    assert.equal(await page.execute("return document.getElementById('lightbox').contains(document.activeElement)"), true, "native modal contains focus");
    assert.equal(await page.execute("return document.querySelector('#lightbox img').src.startsWith('blob:')"), true);
    await page.key("\uE00C");
    await waitUntil(() => page.execute("return !document.getElementById('lightbox').open"), "Escape closes native modal");
    assert.equal(await page.execute("return document.activeElement === window.__photoOpener"), true, "Escape restores the same photo control");
    await page.click("#open-gallery");
    await waitUntil(() => page.execute("const dialog = document.getElementById('media-dialog'); const image = dialog.querySelector('img'); return dialog.open && dialog.matches(':modal') && !!image && image.complete && image.naturalWidth > 0"), "native conversation gallery");
    await page.key("\uE00C");
    await waitUntil(() => page.execute("return !document.getElementById('media-dialog').open"), "Escape closes conversation gallery");
    assert.equal(await page.execute("return document.activeElement.id"), "open-gallery");
    const persistence = await page.executeAsync(`const done = arguments[arguments.length - 1];
      Promise.all([caches.keys(), navigator.serviceWorker.getRegistrations()]).then(([cacheKeys, registrations]) => {
        done({ cacheKeys, registrations: registrations.length, localKeys: Object.keys(localStorage), sessionKeys: Object.keys(sessionStorage) });
      }).catch(error => done({ error: String(error) }));`);
    assert.deepEqual(persistence, { cacheKeys: [], registrations: 0, localKeys: [], sessionKeys: [] }, "private chat creates no persistent cache, worker or stored private state");
    assert.equal(await page.execute("return document.documentElement.scrollWidth <= window.innerWidth"), true);
    await noJavascriptErrors(page);
  } finally { await page.close(); }
});


test("Chrome mobile: deleting a message has a keyboard-accessible confirmation with safe cancellation", { timeout: 30000 }, async () => {
  resetFixture(); const page = await browser(390);
  try {
    await loaded(page, "/messages");
    await tabUntil(page, "#messages .delete-message");
    await page.execute("window.__deleteOpener = document.activeElement"); await page.key("\uE007");
    await waitUntil(() => page.execute("return document.getElementById('confirm-delete').matches(':modal')"), "native delete confirmation");
    assert.equal(await page.execute("return document.activeElement.id"), "cancel-delete");
    assert.equal(fixture.deleteRequests, 0);
    await page.key("\uE00C");
    await waitUntil(() => page.execute("return !document.getElementById('confirm-delete').open"), "Escape cancels deletion");
    assert.equal(await page.execute("return document.activeElement === window.__deleteOpener"), true);
    assert.equal(fixture.deleteRequests, 0);
    await page.key("\uE007");
    await waitUntil(() => page.execute("return document.getElementById('confirm-delete').matches(':modal') && document.activeElement.id==='cancel-delete'"), "second native confirmation is open with cancellation focused");
    assert.equal(fixture.deleteRequests, 0);
    await page.click("#accept-delete");
    await waitUntil(() => page.execute("return document.querySelector('#messages [data-sequence=\"2\"]').classList.contains('deleted')"), "confirmed deletion replaces the message");
    assert.equal(fixture.deleteRequests, 1);
    assert.equal(await page.execute("return document.activeElement.dataset.sequence"), "2", "focus moves to the tombstone");
    await noJavascriptErrors(page);
  } finally { await page.close(); }
});
