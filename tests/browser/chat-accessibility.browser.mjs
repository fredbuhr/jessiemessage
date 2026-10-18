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
import { createConversationExporter } from "../../server/chat/conversation-export.mjs";

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
  fixture = { deleteRequests: 0, now: Date.now() - 600000, latest: 3, events: [], eventRequests: 0, read: { client: "0", admin: "0" }, signedIn: true, loginRequests: 0, notificationsEnabled: false, sent: [] };
}
function media(role) {
  const prefix = `/api/media/${role}/conversations/${conversationId}/messages/${photoMessageId}`;
  return { id: id(300), width: 2, height: 2, thumbnailWidth: 2, thumbnailHeight: 2, bytes: jpeg.length,
    thumbnailBytes: jpeg.length, createdAt: fixture.now + 3000, sharedHere: true,
    fullUrl: `${prefix}/full`, thumbnailUrl: `${prefix}/thumb` };
}
function message(sequence, role) {
  const sent = fixture.sent.find(message => message.sequence === String(sequence)); if (sent) return { ...sent };
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
const fileNames = ["conversation-download.js", "quick-replies.js", "crm.js", "crm-model.js", "crm.css", "private-archive.js", "notification-link.js", "access.html", "access.js", "access.css", "admin-login.html", "admin-login.js", "admin-login.css", "i18n-access.js", "i18n-admin.js", "notifications.js", "notifications.css", "sw.js", "chat.html", "chat.js", "chat-model.js", "session-clock.js", "image-preparation.js", "chat.css", "i18n.js", "help-link.js", "i18n.css", "i18n-chat.js", "i18n-tools.js",
  "manifest.webmanifest", "favicon.ico", "apple-touch-icon.png", "brand/brand.css",
  "brand/icon-16.png", "brand/icon-32.png", "brand/icon-48.png", "brand/icon-64.png", "brand/icon-128.png",
  "brand/icon-192.png", "brand/icon-512.png", "brand/icon-maskable-512.png"];
const contentTypes = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".ico": "image/x-icon" };

async function startFixtureServer() {
  const files = new Map(await Promise.all(fileNames.map(async (name) => [`/${name}`, await readFile(join(publicRoot, name))])));
  files.set("/client-archive.js", files.get("/private-archive.js"));
  files.set("/browser-fixture.js", Buffer.from(bootstrap));
  const html = Buffer.from(files.get("/chat.html").toString().replace("<head>", '<head><script src="/browser-fixture.js"></script>'));
  server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, "http://localhost");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      const sendJson = (status, value) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
      if (fixture.exportEnabled && url.pathname.startsWith("/api/admin/crm/")) {
        if (url.pathname.endsWith("/capabilities")) { sendJson(200, { enabled: true, conversationExport: { enabled: true, photos: true, maxBytes: 33554432 } }); return; }
        if (url.pathname.endsWith("/labels")) { sendJson(200, { labels: [], hasMore: false, nextCursor: null }); return; }
        if (url.pathname.endsWith("/contacts")) { sendJson(200, { contacts: [conversation("admin")], hasMore: false, nextCursor: null }); return; }
        if (url.pathname.endsWith("/export") && request.method === "POST") {
          let raw = ""; for await (const chunk of request) raw += chunk;
          const body = JSON.parse(raw); fixture.exportRequests ??= []; fixture.exportRequests.push(body);
          if (fixture.holdExport) await new Promise(resolve => { fixture.releaseExport = resolve; });
          if (response.destroyed) return;
          if (fixture.replaceExportSession) fixture.csrf = "C".repeat(43);
          const exporter = createConversationExporter({ history: async () => ({ conversation: conversation("admin"), messages: [message("1", "admin"), message("2", "admin"), message("3", "admin")], hasMoreBefore: false, nextBefore: null }),
            photo: async () => ({ bytes: Buffer.from(jpeg), mime: "image/jpeg" }) });
          const bytes = await exporter.create({ token: "synthetic", conversationId, expectedClientId: id(2), includePhotos: body.includePhotos });
          response.writeHead(200, { "Content-Type": "application/zip", "Content-Length": String(bytes.length) }); response.end(bytes); return;
        }
        if (url.pathname === `/api/admin/crm/conversations/${conversationId}`) {
          sendJson(200, { conversationId, client: { id: id(2), pseudonym: peerName, email: "synthetic@example.invalid", status: "active" }, access: { state: "active", expiresAt: null }, nickname: "", notes: "Existing private note", reminderAt: null, labels: [], version: "1", updatedAt: fixture.now }); return;
        }
      }
      if (request.method === "GET" && ["/messages", "/admin/messages"].includes(url.pathname)) {
        if (!fixture.signedIn) { response.writeHead(303, { Location: url.pathname === "/messages" ? "/access" : "/admin/login" }); response.end(); return; }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(html); return;
      }
      if (request.method === "GET" && ["/access", "/admin/login", "/admin"].includes(url.pathname)) {
        const name = url.pathname === "/access" ? "/access.html" : "/admin-login.html";
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(files.get(name).toString().replace("<head>", '<head><script src="/browser-fixture.js"></script>')); return;
      }
      if (request.method === "GET" && files.has(url.pathname)) {
        const extension = url.pathname.slice(url.pathname.lastIndexOf("."));
        response.writeHead(200, { "Content-Type": contentTypes[extension] ?? "application/octet-stream" }); response.end(files.get(url.pathname)); return;
      }
      const sessionRole = url.pathname === "/api/auth/session" ? "admin" : url.pathname === "/api/access/session" ? "client" : null;
      const loginRole = url.pathname === "/api/auth/login" ? "admin" : url.pathname === "/api/access/login" ? "client" : null;
      if (sessionRole && request.method === "GET" || loginRole && request.method === "POST") {
        if (loginRole) { for await (const _chunk of request) { /* Synthetic credentials only. */ } fixture.signedIn = true; fixture.loginRequests++; }
        if (!fixture.signedIn) { sendJson(401, { error: "authentication_required" }); return; }
        const role = sessionRole ?? loginRole;
        sendJson(200, { user: { id: id(role === "admin" ? 1 : 2), role, pseudonym: role === "admin" ? "Jessie" : peerName },
          csrf: fixture.csrf ?? "A".repeat(43), expiresAt: Date.now() + 3600000, ...(role === "client" ? { access: { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: true, expiresAt: null } } : {}) }); return;
      }
      if (/^\/api\/notifications\/(admin|client)\/open$/.test(url.pathname) && request.method === "POST") {
        let body = ""; for await (const chunk of request) body += chunk;
        assert.deepEqual(JSON.parse(body), { notification: id(999) });
        sendJson(200, { conversationId, messageId: id(201), sequence: "1" }); return;
      }
      if (/^\/api\/notifications\/(admin|client)\/capabilities$/.test(url.pathname) && request.method === "GET" && fixture.notificationsEnabled) {
        // Public synthetic key only. This fixture never requests permission,
        // creates a push subscription or sends a notification.
        sendJson(200, { enabled: true, vapidPublicKey: Buffer.from([4, ...Array(64).fill(1)]).toString("base64url") }); return;
      }
      if (fixture.clientExportEnabled && url.pathname === `/api/chat/client/conversations/${conversationId}/export` && request.method === "POST") {
        let raw = ""; for await (const chunk of request) raw += chunk;
        const body = JSON.parse(raw); fixture.exportRequests ??= []; fixture.exportRequests.push(body);
        if (fixture.holdExport) await new Promise(resolve => { fixture.releaseExport = resolve; });
        if (response.destroyed) return;
        if (fixture.clientExportFailure) { sendJson(413, { error: "conversation_export_limit" }); return; }
        const exporter = createConversationExporter({ role: "client", history: async () => ({ conversation: conversation("client"), messages: [message("1", "client"), message("2", "client"), message("3", "client")], hasMoreBefore: false, nextBefore: null }),
          photo: async () => ({ bytes: Buffer.from(jpeg), mime: "image/jpeg" }) });
        const bytes = await exporter.create({ token: "synthetic", conversationId, expectedClientId: id(2), clientName: peerName, includePhotos: body.includePhotos });
        if (fixture.replaceExportSession) fixture.csrf = "C".repeat(43);
        response.writeHead(200, { "Content-Type": "application/zip", "Content-Length": String(bytes.length) }); response.end(bytes); return;
      }
      const match = /^\/api\/(chat|media)\/(admin|client)(\/.*)$/.exec(url.pathname);
      if (match) {
        const [, feature, role, suffix] = match;
        if (request.method === "GET" && suffix === "/capabilities") { sendJson(200, { enabled: true, ...(fixture.clientExportEnabled && feature === "chat" && role === "client" ? { conversationExport: { enabled: true, photos: true, maxBytes: 32 * 1024 * 1024 } } : {}) }); return; }
        if (feature === "chat" && request.method === "GET") {
          if (suffix === "/conversation") { sendJson(200, { id: conversationId }); return; }
          if (suffix === "/conversations") { sendJson(200, { conversations: [conversation(role)], nextCursor: null, hasMore: false }); return; }
          if (suffix === `/conversations/${conversationId}/messages`) {
            const older = url.searchParams.has("before");
            sendJson(200, { conversation: conversation(role), messages: (url.searchParams.has("after") ? [1, 2, 3] : older ? [1] : [2, 3]).map((n) => message(n, role)),
              eventCursor: String(fixture.latest), hasMoreBefore: !older, nextBefore: older ? null : "2" }); return;
          }
          if (suffix === `/conversations/${conversationId}/events`) {
            fixture.eventRequests += 1;
            const after = Number(url.searchParams.get("after"));
            sendJson(200, { conversation: conversation(role), events: fixture.events.filter((n) => n > after).map((n) => ({ sequence: String(n), kind: "message", message: message(n, role) })),
              nextCursor: String(fixture.latest), hasMore: false }); return;
          }
        }
        if (feature === "chat" && request.method === "POST" && suffix === `/conversations/${conversationId}/messages`) {
          let body = ""; for await (const chunk of request) { body += chunk; if (body.length > 20000) throw new Error("oversized_fixture_request"); }
          const parsed = JSON.parse(body); assert.match(parsed.clientMessageId, /^[a-f0-9]{32}$/); assert.equal(typeof parsed.body, "string");
          fixture.latest += 1; fixture.events.push(fixture.latest);
          const sent = { id: id(200 + fixture.latest), sequence: String(fixture.latest), sender: "me", body: parsed.body,
            createdAt: Date.now(), deletedAt: null, clientMessageId: parsed.clientMessageId };
          fixture.sent.push(sent); sendJson(201, { message: sent }); return;
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

test("Chrome mobile: every account control stays visible and separate with Notifications, French / English, both roles", { timeout: 90000 }, async () => {
  for (const width of [320, 360, 390]) for (const path of ["/messages", "/admin/messages"]) {
    resetFixture(); fixture.notificationsEnabled = true;
    const page = await browser(width);
    try {
      await loaded(page, path);
      await waitUntil(() => page.execute("return !document.getElementById('open-notifications').hidden"), "real notification capability exposes the account control");
      for (const language of ["fr", "en"]) {
        if (language === "en") await page.click("[data-jm-language]");
        assert.equal(await page.execute("return document.documentElement.lang"), language);
        if (path === "/messages") {
          assert.equal(await page.execute("return !!document.querySelector('.broadcast-preference, #broadcast-preference-host, #broadcast-nav')"), false);
          assert.equal(await page.execute("return performance.getEntriesByType('resource').some(entry => /\\/api\\/broadcast\\/|broadcast-preference\\.js/.test(new URL(entry.name).pathname))"), false, "the recipient workspace never loads broadcast settings or campaign metadata");
        }
        const layout = await page.execute(`
          const controls = [...document.querySelectorAll('.topbar .brand, .topbar .account-nav > a, .topbar .account-nav > button')]
            .filter(node => !node.hidden).map(node => {
              const rect = node.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
              const container = node.closest('.topbar').getBoundingClientRect();
              return { name: node.id || (node.matches('.brand') ? 'brand' : node.matches('[data-jm-language]') ? 'language' : new URL(node.href).pathname),
                left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height,
                containerTop: container.top, containerBottom: container.bottom,
                reachable: hit === node || node.contains(hit) };
            });
          return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, controls };
        `);
        const context = `${path}, ${width}px, ${language}`;
        assert.equal(layout.width, width, context);
        assert.equal(layout.scrollWidth <= layout.width, true, `${context}: no horizontal page overflow`);
        assert.deepEqual(layout.controls.map(control => control.name).sort(), ["account-link", "brand", "language", "logout", "open-notifications"], `${context}: all five header controls are present`);
        for (const control of layout.controls) {
          assert.ok(control.left >= -1 && control.right <= layout.width + 1, `${context}: ${control.name} stays inside the viewport`);
          assert.ok(control.top >= 0 && control.bottom <= layout.height + 1, `${context}: ${control.name} stays vertically visible`);
          assert.ok(control.top >= control.containerTop - 1 && control.bottom <= control.containerBottom + 1, `${context}: ${control.name} stays inside the header`);
          assert.ok(control.height >= 44, `${context}: ${control.name} keeps its 44px touch height`);
          assert.equal(control.reachable, true, `${context}: ${control.name} is not covered`);
        }
        for (let first = 0; first < layout.controls.length; first++) for (let second = first + 1; second < layout.controls.length; second++) {
          const a = layout.controls[first], b = layout.controls[second];
          assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1,
            `${context}: ${a.name} and ${b.name} do not overlap`);
        }
      }
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

test("Chrome: a notification reaches its exact old message for each role, directly or after required login", { timeout: 60000 }, async () => {
  for (const role of ["client", "admin"]) for (const signedIn of [true, false]) {
    resetFixture(); fixture.signedIn = signedIn; const page = await browser(390);
    const path = role === "admin" ? "/admin/messages" : "/messages";
    try {
      await page.navigate(`${path}#notification=${id(999)}`);
      if (!signedIn) {
        const form = role === "admin" ? "login-form" : "client-login-form";
        await waitUntil(() => page.execute("const form=document.getElementById(arguments[0]);return !!form&&!form.hidden;", form), "required login preserves the notification destination");
        assert.equal(await page.execute("return location.hash"), `#notification=${id(999)}`, "HTTP 303 and the actual login controller retain the reference");
        await page.type(role === "admin" ? "#email" : "#login-email", "synthetic@example.invalid");
        await page.type(role === "admin" ? "#password" : "#login-password", "synthetic-test-password");
        if (role === "admin") await page.type("#factor", "123456");
        await page.click(`#${form} button[type=submit]`);
      }
      await waitUntil(() => page.execute("return location.pathname===arguments[0]&&location.hash===''&&!!document.querySelector('#messages [data-sequence=\"1\"].notification-target');", path), "exact notification message after live session proof");
      assert.equal(await page.execute("return document.activeElement.dataset.sequence"), "1");
      assert.equal(fixture.loginRequests, signedIn ? 0 : 1);
      await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});
async function openConversationExport(page) {
  await loaded(page, "/admin/messages");
  await waitUntil(() => page.execute("return !!document.querySelector('.crm-fiche-button') && !!document.querySelector('.contact')"), "CRM initialized");
  if (await page.execute("return document.querySelector('.crm-fiche-button').hidden")) await page.click(".contact");
  await waitUntil(() => page.execute("return !document.querySelector('.crm-fiche-button').hidden"), "selected conversation profile");
  await tabUntil(page, ".crm-fiche-button"); await page.key("\uE007");
  await waitUntil(() => page.execute("return !!document.querySelector('.crm-dialog[open] .crm-export:not([hidden])')"), "download section of current profile");
  await page.click(".crm-export > summary");
  await page.execute("window.__exportDownloads=[];const original=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{if(blob.type==='application/zip')window.__exportDownloadBytes=blob.size;return original(blob);};document.addEventListener('click',e=>{const a=e.target.closest('a[download]');if(a){e.preventDefault();window.__exportDownloads.push(a.download);}})");
}

test("real Chrome: conversation archive from the actual chat controller, keyboard and translations", { timeout: 120000 }, async t => {
  for (const width of [320, 1280]) for (const language of ["fr", "en"]) await t.test(`${language} ${width}px`, async () => {
    resetFixture(); fixture.exportEnabled = true; const page = await browser(width);
    try {
      await openConversationExport(page);
      if (language === "en") { await page.key("\uE00C"); await page.click("[data-jm-language]"); await page.click(".crm-fiche-button"); await waitUntil(() => page.execute("return !!document.querySelector('.crm-dialog[open] .crm-export:not([hidden])')"), "translated profile ready"); await page.click(".crm-export > summary"); }
      await page.type('.crm-profile-form textarea[name="notes"]', "Unsent private change");
      await tabUntil(page, ".crm-export button"); await page.key("\uE007");
      await waitUntil(() => page.execute("return window.__exportDownloads.length === 1 && window.__exportDownloadBytes > 22"), "private ZIP starts downloading");
      assert.equal(await page.execute("return window.__exportDownloads[0]"), `JessieMessage-conversation-${conversationId}.zip`);
      assert.deepEqual(fixture.exportRequests, [{ includePhotos: true }]);
      assert.equal(await page.execute("return document.querySelector('.crm-profile-form textarea[name=notes]').value.endsWith('Unsent private change')"), true, "export does not save or replace the CRM draft");
      assert.equal(await page.execute("return document.querySelector('.crm-export .crm-status').textContent"), language === "fr" ? "Conversation téléchargée. Extrais le ZIP puis ouvre Conversation.html." : "Conversation downloaded. Extract the ZIP and open Conversation.html.");
      assert.equal(await page.execute("const dialog=document.querySelector('.crm-dialog[open]');return dialog.scrollWidth<=dialog.clientWidth+1 && document.querySelector('.crm-export button').getBoundingClientRect().height>=44"), true);
      assert.deepEqual(await page.execute("return window.__browserErrors"), []);
    } finally { fixture.releaseExport?.(); await page.close(); }
  });
});

test("real Chrome: another login during export suppresses the old file without replaying the request", { timeout: 60000 }, async () => {
  resetFixture(); fixture.exportEnabled = true; fixture.replaceExportSession = true; const page = await browser(375);
  try {
    await openConversationExport(page); await page.click(".crm-export button");
    await waitUntil(() => page.execute("return !!document.querySelector('.crm-fiche-button') && document.querySelectorAll('.crm-dialog[open]').length === 0"), "replacement login clears the former profile");
    assert.equal(await page.execute("return window.__exportDownloads.length"), 0); assert.equal(fixture.exportRequests.length, 1);
    assert.equal(await page.execute("return document.body.textContent.includes('Conversation téléchargée')"), false);
  } finally { fixture.releaseExport?.(); await page.close(); }
});

test("real Chrome: closing a profile cancels its download and cannot unlock or populate a new profile", { timeout: 60000 }, async () => {
  resetFixture(); fixture.exportEnabled = true; fixture.holdExport = true; const page = await browser(375);
  try {
    await openConversationExport(page); await page.click(".crm-export button");
    await waitUntil(() => Boolean(fixture.releaseExport), "server holds the first export");
    await page.key("\uE00C"); fixture.releaseExport();
    await page.click(".crm-fiche-button");
    await waitUntil(() => page.execute("return document.querySelector('.crm-dialog[open] .crm-export .crm-status').textContent === ''"), "a fresh profile has no old download status");
    assert.equal(await page.execute("return window.__exportDownloads.length"), 0); assert.equal(fixture.exportRequests.length, 1);
    assert.equal(await page.execute("return document.querySelector('.crm-export button').disabled"), false);
  } finally { fixture.releaseExport?.(); await page.close(); }
});

async function openClientExport(page, language = "fr") {
  await loaded(page, "/messages");
  await waitUntil(() => page.execute("return !!document.querySelector('.conversation-download-entry:not([hidden])')"), "client download control mounted");
  if (language === "en") await page.click("[data-jm-language]");
  await page.execute("window.__exportDownloads=[];const original=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{if(blob.type==='application/zip')window.__exportDownloadBytes=blob.size;return original(blob);};document.addEventListener('click',e=>{const a=e.target.closest('a[download]');if(a){e.preventDefault();window.__exportDownloads.push(a.download);}})");
  await tabUntil(page, ".conversation-download-entry"); await page.key("\uE007");
  await waitUntil(() => page.execute("return !!document.querySelector('.conversation-download[open]')"), "client export dialog open");
}

test("real Chrome: clients download their own conversation at mobile/desktop widths in both languages", { timeout: 120000 }, async t => {
  for (const width of [320, 1280]) for (const language of ["fr", "en"]) await t.test(`${language} ${width}px`, async () => {
    resetFixture(); fixture.clientExportEnabled = true; const page = await browser(width);
    try {
      await openClientExport(page, language);
      assert.equal(await page.execute("return document.querySelector('.conversation-download h2').textContent"), language === "fr" ? "Télécharger ma conversation" : "Download my conversation");
      await page.key("\uE00C"); await page.type("#message-body", "Unsent client draft");
      await page.click(".conversation-download-entry");
      if (language === "en") await page.click(".conversation-download-photos input");
      await tabUntil(page, ".conversation-download .primary"); await page.key("\uE007");
      await waitUntil(() => page.execute("return window.__exportDownloads.length === 1 && window.__exportDownloadBytes > 22"), "client ZIP accepted by the actual archive reader");
      assert.deepEqual(fixture.exportRequests, [{ includePhotos: language !== "en" }]);
      assert.equal(await page.execute("return window.__exportDownloads[0]"), `JessieMessage-conversation-${conversationId}.zip`);
      assert.equal(await page.execute("return document.querySelector('#message-body').value"), "Unsent client draft");
      assert.equal(await page.execute("return document.querySelector('.conversation-download [role=status]').textContent"), language === "fr" ? "Conversation téléchargée. Extrais le ZIP puis ouvre Conversation.html." : "Conversation downloaded. Extract the ZIP and open Conversation.html.");
      assert.equal(await page.execute("const d=document.querySelector('.conversation-download');return d.scrollWidth<=d.clientWidth+1 && document.querySelector('.conversation-download-photos').getBoundingClientRect().height>=44 && document.querySelector('.conversation-download .primary').getBoundingClientRect().height>=44"), true);
      assert.equal(await page.execute("return document.querySelector('.conversation-download').textContent.includes('notes') || document.querySelector('.conversation-download').textContent.includes('groups')"), false);
      await page.key("\uE00C");
      assert.equal(await page.execute("return document.activeElement.matches('.conversation-download-entry')"), true);
      await noJavascriptErrors(page);
    } finally { fixture.releaseExport?.(); await page.close(); }
  });
});

test("real Chrome: a replacement client login suppresses the previous archive without replay", { timeout: 60000 }, async () => {
  resetFixture(); fixture.clientExportEnabled = true; fixture.replaceExportSession = true; const page = await browser(375);
  try {
    await openClientExport(page); await page.click(".conversation-download .primary");
    await waitUntil(() => page.execute("return !!document.querySelector('.conversation-download-entry:not([hidden])') && !document.querySelector('.conversation-download[open]')"), "replacement client session has a fresh download control");
    assert.equal(await page.execute("return window.__exportDownloads.length"), 0); assert.equal(fixture.exportRequests.length, 1);
    assert.equal(await page.execute("return document.querySelector('.conversation-download [role=status]').textContent"), "");
    await noJavascriptErrors(page);
  } finally { fixture.releaseExport?.(); await page.close(); }
});

test("real Chrome: closing the client dialog cancels a held archive and never updates a reopened dialog", { timeout: 60000 }, async () => {
  resetFixture(); fixture.clientExportEnabled = true; fixture.holdExport = true; const page = await browser(375);
  try {
    await openClientExport(page); await page.click(".conversation-download .primary");
    await waitUntil(() => Boolean(fixture.releaseExport), "server holds client export");
    await page.key("\uE00C"); fixture.releaseExport(); await page.click(".conversation-download-entry");
    await waitUntil(() => page.execute("return !!document.querySelector('.conversation-download[open]') && !document.querySelector('.conversation-download .primary').disabled"), "reopened client dialog remains usable");
    assert.equal(await page.execute("return window.__exportDownloads.length"), 0); assert.equal(fixture.exportRequests.length, 1);
    assert.equal(await page.execute("return document.querySelector('.conversation-download [role=status]').textContent"), "");
    await noJavascriptErrors(page);
  } finally { fixture.releaseExport?.(); await page.close(); }
});

test("real Chrome: client size limit offers an explicit text-only retry without sending a message", { timeout: 60000 }, async () => {
  resetFixture(); fixture.clientExportEnabled = true; fixture.clientExportFailure = true; const page = await browser(375);
  try {
    await openClientExport(page, "en"); await page.click(".conversation-download .primary");
    await waitUntil(() => page.execute("return document.querySelector('.conversation-download [role=status]').textContent.includes('Try without photos')"), "translated size limit");
    assert.equal(await page.execute("return window.__exportDownloads.length"), 0); assert.equal(fixture.exportRequests.length, 1);
    fixture.clientExportFailure = false; await page.click(".conversation-download-photos input"); await page.click(".conversation-download .primary");
    await waitUntil(() => page.execute("return window.__exportDownloads.length === 1"), "explicit text-only retry");
    assert.deepEqual(fixture.exportRequests, [{ includePhotos: true }, { includePhotos: false }]);
    await noJavascriptErrors(page);
  } finally { fixture.releaseExport?.(); await page.close(); }
});

test("real Chrome: hiding the client page cancels the archive and returns with no stale download", { timeout: 60000 }, async () => {
  resetFixture(); fixture.clientExportEnabled = true; fixture.holdExport = true; const page = await browser(375);
  try {
    await openClientExport(page); await page.click(".conversation-download .primary");
    await waitUntil(() => Boolean(fixture.releaseExport), "server holds archive before page is hidden");
    await page.execute("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__exportVisibility??'visible'});window.__exportVisibility='hidden';document.dispatchEvent(new Event('visibilitychange'))");
    assert.equal(await page.execute("return !!document.querySelector('.conversation-download[open]')"), false);
    fixture.releaseExport();
    await page.execute("window.__exportVisibility='visible';document.dispatchEvent(new Event('visibilitychange'))");
    await waitUntil(() => page.execute("return !document.querySelector('#workspace').hidden && !!document.querySelector('.conversation-download-entry:not([hidden])')"), "visible client session resumes with its download control");
    assert.equal(await page.execute("return window.__exportDownloads.length"), 0); assert.equal(fixture.exportRequests.length, 1);
    assert.equal(await page.execute("return document.querySelector('.conversation-download [role=status]').textContent"), "");
    await noJavascriptErrors(page);
  } finally { fixture.releaseExport?.(); await page.close(); }
});

for (const width of [320, 1280]) for (const language of ["fr", "en"]) {
  test(`Chrome ${width}px ${language}: quick replies preserve the draft and send only after editing and explicit submission`, { timeout: 35000 }, async () => {
    resetFixture(); const page = await browser(width);
    try {
      await loaded(page, "/admin/messages"); await tabUntil(page, ".contact"); await page.key("\uE007");
      await waitUntil(() => page.execute("return !document.querySelector('#open-quick-replies').hidden && !document.querySelector('#open-quick-replies').disabled"), "administrator quick replies ready");
      if (language === "en") await page.click("[data-jm-language]");
      await page.type("#message-body", "Personal draft");
      await tabUntil(page, "#open-quick-replies"); await page.key("\uE007");
      assert.equal(await page.execute("return document.querySelector('#quick-replies-dialog').open"), true);
      assert.equal(await page.execute("return document.querySelector('#quick-reply-language').value"), language);
      assert.equal(await page.execute("return document.querySelector('#quick-replies-title').textContent"), language === "fr" ? "Réponses rapides" : "Quick replies");
      assert.equal(await page.execute("const d=document.querySelector('#quick-replies-dialog');return d.scrollWidth<=d.clientWidth+1 && [...d.querySelectorAll('.quick-reply')].every(b=>b.getBoundingClientRect().height>=44)"), true);
      // Phrase language is explicitly independent from the interface language.
      await page.click("#quick-reply-language"); await page.key(language === "fr" ? "\uE015" : "\uE013"); await page.key("\uE007");
      const replyLanguage = language === "fr" ? "en" : "fr";
      await waitUntil(() => page.execute(`return document.querySelector('#quick-reply-language').value === '${replyLanguage}'`), "phrase language selected with keyboard");
      await tabUntil(page, '[data-quick-reply="good-night"]'); await page.key("\uE007");
      const expected = "Personal draft\n" + (replyLanguage === "fr" ? "Bonne nuit, bisous 😘" : "Good night, kisses 😘");
      assert.equal(await page.execute("return document.querySelector('#message-body').value"), expected);
      assert.equal(await page.execute("return document.querySelector('#quick-replies-dialog').open"), false);
      assert.equal(await page.execute("return document.activeElement.id"), "message-body"); assert.equal(fixture.sent.length, 0, "insertion never sends");
      assert.match(await page.execute("return document.querySelector('#chat-status').textContent"), language === "fr" ? /ajoutée au brouillon/ : /added to your draft/);
      await page.type("#message-body", expected + " Edited"); await page.click("#send");
      await waitUntil(() => fixture.sent.length === 1, "explicit ordinary send");
      assert.equal(fixture.sent[0].body, expected + " Edited");
      await waitUntil(() => page.execute("return document.querySelector('#message-body').value === ''"), "ordinary acknowledgement clears sent draft");
      await noJavascriptErrors(page);
    } finally { await page.close(); }
  });
}

test("Chrome: clients have no quick replies; Escape, full drafts and returning to the inbox never send", { timeout: 35000 }, async () => {
  resetFixture(); const page = await browser(320);
  try {
    await loaded(page, "/messages"); assert.equal(await page.execute("return document.querySelector('#open-quick-replies').hidden"), true);
    await loaded(page, "/admin/messages"); await page.click(".contact");
    await waitUntil(() => page.execute("return !document.querySelector('#open-quick-replies').disabled"), "quick replies available");
    await page.type("#message-body", "Unsent draft"); await page.click("#open-quick-replies"); await page.key("\uE00C");
    assert.equal(await page.execute("return document.querySelector('#quick-replies-dialog').open"), false);
    assert.equal(await page.execute("return document.querySelector('#message-body').value"), "Unsent draft");
    await page.type("#message-body", "x".repeat(4096)); await page.click("#open-quick-replies"); await page.click('[data-quick-reply="thanks"]');
    assert.equal(await page.execute("return document.querySelector('#message-body').value.length"), 4096);
    assert.equal(await page.execute("return document.querySelector('#quick-replies-dialog').open"), true);
    assert.match(await page.execute("return document.querySelector('#quick-replies-status').textContent"), /ne peut pas être ajoutée/);
    await page.key("\uE00C"); await page.click("#back-to-inbox");
    assert.equal(await page.execute("return document.querySelector('#quick-replies-dialog').open"), false);
    assert.equal(await page.execute("return document.querySelector('#quick-replies-list').children.length"), 0);
    assert.equal(fixture.sent.length, 0); await noJavascriptErrors(page);
  } finally { await page.close(); }
});
