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
  fixture = { deleteRequests: 0, now: Date.now() - 600000, latest: 3, events: [], eventRequests: 0, eventHolds: [], read: { client: "0", admin: "0" }, signedIn: true, loginRequests: 0, notificationsEnabled: false, sent: [], messageRequests: [],
    quickReplies: { version: "0", replies: [] }, quickReplyRequests: [], quickReplyReads: 0,
    profileEnabled: false, profileAvatarsEnabled: true, profileRequests: [], avatarRequests: [], avatarUploads: [], profiles: {
      client: { pseudonym: peerName, version: "1", avatarId: null }, admin: { pseudonym: "Jessie", version: "1", avatarId: null },
    } };
}
function profile(role) {
  const saved = fixture.profiles[role];
  return { ...saved, avatarUrl: saved.avatarId === null ? null : `/api/profile/${role}/avatar?v=${saved.version}` };
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
  return { id: id(200 + number), sequence: String(number), sender: number === 2 || number === 3 && fixture.ownPhoto ? "me" : "peer",
    body: number === 1 ? "Earlier fictional message" : number === 2 ? "Fictional message from me" : number === 3 ? fixture.photoWithoutCaption ? "" : "Fictional photo caption" : `Fictional incoming body ${number}`,
    createdAt: fixture.now + number * 1000, deletedAt: null, clientMessageId: null,
    ...(number === 3 ? { media: media(role) } : {}) };
}
function conversation(role) {
  const peer = fixture.profiles[role === "client" ? "admin" : "client"];
  return { id: conversationId, client: role === "admin" ? { id: id(2), pseudonym: peerName } : null,
    peerName: fixture.peerName ?? peer.pseudonym, createdAt: fixture.now, closedAt: null,
    lastActivityAt: fixture.now + fixture.latest * 1000, latestSequence: String(fixture.latest),
    latestEventSequence: String(fixture.latest), lastReadSequence: fixture.read[role], peerReadSequence: fixture.peerReadSequence ?? "0", unreadCount: 0, canSend: true,
    ...(fixture.profileEnabled && fixture.profileAvatarsEnabled && peer.avatarId !== null
      ? { peerAvatar: { version: peer.version, url: `/api/profile/${role}/conversations/${conversationId}/avatar?v=${peer.version}` } } : {}) };
}
function receiveTwoMessages() {
  for (let count = 0; count < 2; count += 1) { fixture.latest += 1; fixture.events.push(fixture.latest); }
}

const bootstrap = `"use strict";
window.__browserErrors = [];
window.__revokedBlobUrls = [];
const nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL = function (url) { window.__revokedBlobUrls.push(String(url)); return nativeRevokeObjectURL(url); };
window.addEventListener("error", event => { window.__browserErrors.push(String(event.message).slice(0, 500)); });
window.addEventListener("unhandledrejection", event => { window.__browserErrors.push(String(event.reason?.message ?? event.reason).slice(0, 500)); });
window.addEventListener("securitypolicyviolation", event => { window.__browserErrors.push("CSP: " + event.violatedDirective); });
`;
const fileNames = ["conversation-download.js", "quick-replies.js", "crm.js", "crm-model.js", "crm.css", "private-archive.js", "notification-link.js", "access.html", "access.js", "access.css", "admin-login.html", "admin-login.js", "admin-login.css", "i18n-access.js", "i18n-admin.js", "notifications.js", "notifications.css", "sw.js", "chat.html", "chat.js", "chat-model.js", "session-clock.js", "image-preparation.js", "chat.css", "i18n.js", "help-link.js", "i18n.css", "i18n-chat.js", "i18n-tools.js",
  "emoji-catalog.js", "emoji.css", "profile.js", "profile.css", "i18n-profile.js", "manifest.webmanifest", "favicon.ico", "apple-touch-icon.png", "brand/brand.css",
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
      if (url.pathname === "/api/admin/quick-replies") {
        if (!fixture.signedIn) { sendJson(401, { error: "authentication_required" }); return; }
        if (request.method === "GET") { fixture.quickReplyReads += 1; sendJson(200, fixture.quickReplies); return; }
        if (request.method === "POST") {
          let raw = ""; for await (const chunk of request) { raw += chunk; if (raw.length > 65536) throw new Error("oversized_fixture_quick_replies"); }
          const command = JSON.parse(raw); fixture.quickReplyRequests.push(command);
          assert.equal(request.headers["x-csrf-token"], fixture.csrf ?? "A".repeat(43));
          if (command.expectedVersion !== fixture.quickReplies.version) { sendJson(409, { error: "quick_replies_conflict" }); return; }
          fixture.quickReplies = { version: String(BigInt(fixture.quickReplies.version) + 1n), replies: command.replies };
          if (fixture.loseQuickReplyAck) { fixture.loseQuickReplyAck = false; response.writeHead(200, { "Content-Type": "application/json", "Content-Length": "4096" }); response.write("{"); setImmediate(() => response.destroy()); return; }
          sendJson(200, fixture.quickReplies); return;
        }
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
      const ownProfile = /^\/api\/profile\/(admin|client)$/.exec(url.pathname);
      if (fixture.profileEnabled && ownProfile) {
        const role = ownProfile[1];
        if (request.method === "GET") { sendJson(200, profile(role)); return; }
        if (request.method === "POST") {
          let raw = ""; for await (const chunk of request) { raw += chunk; if (raw.length > 4096) throw new Error("oversized_fixture_profile"); }
          const input = JSON.parse(raw);
          assert.equal(request.headers["x-csrf-token"], fixture.csrf ?? "A".repeat(43));
          assert.deepEqual(Object.keys(input).sort(), ["avatarId", "expectedVersion", "pseudonym"]);
          assert.equal(typeof input.pseudonym, "string"); assert.ok(input.pseudonym.length > 0 && input.pseudonym.length <= 64);
          assert.ok(input.avatarId === null || /^[a-f0-9]{32}$/.test(input.avatarId));
          fixture.profileRequests.push({ role, ...input });
          if (input.expectedVersion !== fixture.profiles[role].version) { sendJson(409, { error: "profile_conflict" }); return; }
          fixture.profiles[role] = { pseudonym: input.pseudonym, avatarId: input.avatarId, version: String(Number(input.expectedVersion) + 1) };
          sendJson(200, profile(role)); return;
        }
      }
      const avatar = /^\/api\/profile\/(admin|client)\/(avatar|conversations\/([a-f0-9]{32})\/avatar)$/.exec(url.pathname);
      if (fixture.profileEnabled && fixture.profileAvatarsEnabled && avatar && request.method === "GET") {
        const role = avatar[1], owner = avatar[3] ? role === "client" ? "admin" : "client" : role;
        const saved = fixture.profiles[owner];
        fixture.avatarRequests.push({ role, conversationId: avatar[3] ?? null, version: url.searchParams.get("v") });
        if (avatar[3] && avatar[3] !== conversationId || saved.avatarId === null || url.searchParams.get("v") !== saved.version) {
          sendJson(404, { error: "not_found" }); return;
        }
        response.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": String(jpeg.length) }); response.end(jpeg); return;
      }
      const avatarUpload = /^\/api\/media\/(admin|client)\/assets$/.exec(url.pathname);
      if (fixture.profileEnabled && fixture.profileAvatarsEnabled && avatarUpload && request.method === "POST") {
        let bytes = 0; for await (const chunk of request) { bytes += chunk.length; if (bytes > 262144) throw new Error("oversized_fixture_avatar"); }
        assert.equal(request.headers["content-type"], "image/jpeg"); assert.ok(bytes > 0);
        fixture.avatarUploads.push({ role: avatarUpload[1], bytes });
        sendJson(201, { asset: { id: id(400 + fixture.avatarUploads.length) }, duplicate: false }); return;
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
        if (request.method === "GET" && suffix === "/capabilities") {
          if (feature === "media" && fixture.mediaDisabled) { sendJson(404, { error: "not_found" }); return; }
          sendJson(200, { enabled: true,
            ...(fixture.profileEnabled && feature === "chat" ? { profile: { enabled: true, avatars: fixture.profileAvatarsEnabled } } : {}),
            ...(fixture.clientExportEnabled && feature === "chat" && role === "client" ? { conversationExport: { enabled: true, photos: true, maxBytes: 32 * 1024 * 1024 } } : {}) }); return;
        }
        if (feature === "chat" && request.method === "GET") {
          if (suffix === "/conversation") { sendJson(200, { id: conversationId }); return; }
          if (suffix === "/conversations") { sendJson(200, { conversations: [conversation(role)], nextCursor: null, hasMore: false }); return; }
          if (suffix === `/conversations/${conversationId}/messages`) {
            const older = url.searchParams.has("before");
            const numbers = url.searchParams.has("after") ? [1, 2, 3, ...(fixture.historyAcknowledgement ? fixture.sent.map(item => Number(item.sequence)) : [])] : older ? [1] : [2, 3];
            if (role === "admin" && fixture.holdInitialAdminMessages && !older && !url.searchParams.has("after")) {
              const held = fixture; held.holdInitialAdminMessages = false;
              await new Promise(resolve => {
                let released = false;
                const release = () => {
                  if (released) return;
                  released = true; response.off("close", release);
                  if (held.releaseInitialAdminMessages === release) held.releaseInitialAdminMessages = null;
                  resolve();
                };
                held.releaseInitialAdminMessages = release;
                response.once("close", release);
              });
              if (response.destroyed) return;
            }
            sendJson(200, { conversation: conversation(role), messages: numbers.map((n) => message(n, role)),
              eventCursor: String(fixture.latest), hasMoreBefore: !older, nextBefore: older ? null : "2" }); return;
          }
          if (suffix === `/conversations/${conversationId}/events`) {
            fixture.eventRequests += 1;
            // Delay the real HTTP response so history, rather than an event
            // poll, is the first acknowledgement of the uncertain send.
            if (fixture.holdEvents) {
              await new Promise(resolve => { fixture.eventHolds.push(resolve); response.once("close", resolve); });
              if (response.destroyed) return;
            }
            const after = Number(url.searchParams.get("after"));
            sendJson(200, { conversation: conversation(role), events: fixture.events.filter((n) => n > after).map((n) => ({ sequence: String(n), kind: "message", message: message(n, role) })),
              nextCursor: String(fixture.latest), hasMore: false }); return;
          }
        }
        if (request.method === "POST" && suffix === `/conversations/${conversationId}/messages`) {
          let body = ""; for await (const chunk of request) { body += chunk; if (body.length > 20000) throw new Error("oversized_fixture_request"); }
          const parsed = JSON.parse(body); assert.match(parsed.clientMessageId, /^[a-f0-9]{32}$/);
          assert.equal(typeof (feature === "media" ? parsed.caption : parsed.body), "string");
          if (feature === "media") assert.equal(parsed.mediaId, id(300));
          fixture.messageRequests.push({ feature, role, ...parsed });
          if (fixture.failNextSend) { fixture.failNextSend = false; sendJson(503, { error: "temporarily_unavailable" }); return; }
          fixture.latest += 1; fixture.events.push(fixture.latest);
          const sent = { id: id(200 + fixture.latest), sequence: String(fixture.latest), sender: "me", body: feature === "media" ? parsed.caption : parsed.body,
            createdAt: Date.now(), deletedAt: null, clientMessageId: parsed.clientMessageId, ...(feature === "media" ? { media: media(role) } : {}) };
          fixture.sent.push(sent);
          if (fixture.historyAcknowledgement) {
            // Persistence precedes response loss. Selection aborts native
            // fetch; neither fetch nor the application controller is replaced.
            response.once("close", () => { fixture.sendResponseClosed = true; });
            fixture.dropSendResponse = () => response.destroy(); return;
          }
          sendJson(201, { message: sent }); return;
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
          if (suffix === "/assets") { sendJson(200, { assets: fixture.historyAcknowledgement ? [media(role)] : [], nextCursor: null, hasMore: false }); return; }
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

const browser = (width = 1280, height) => driver.browser({ origin: baseUrl, width, ...(height === undefined ? {} : { height }) });
async function openChatOptions(page) {
  if (await page.execute("return !document.getElementById('chat-menu').hidden")) return;
  const opener = await page.execute(`return ['open-conversation-menu','open-account-menu'].find(id=>{
    const button=document.getElementById(id);return button&&!button.hidden&&!button.disabled&&button.getClientRects().length>0;
  })`);
  assert.ok(opener, "a visible options opener is available");
  await page.click(`#${opener}`);
  await waitUntil(() => page.execute("return !document.getElementById('chat-menu').hidden"), "options panel opens");
}
async function clickOptionsAction(page, selector) {
  await openChatOptions(page); await page.click(selector);
}
async function toggleChatLanguage(page) {
  await clickOptionsAction(page, "[data-jm-language]");
  await waitUntil(() => page.execute("return document.getElementById('chat-menu').hidden"), "language selection closes the options panel");
}
async function openComposerTools(page) {
  if (await page.execute("return !document.getElementById('composer-tools').hidden")) return;
  await page.click("#open-composer-tools");
  await waitUntil(() => page.execute("return !document.getElementById('composer-tools').hidden"), "attachment tools open");
}
async function clickComposerAction(page, selector) {
  await openComposerTools(page); await page.click(selector);
}
async function openMessageDetails(page, sequence) {
  const selector = `#messages [data-sequence="${sequence}"] .message-details-toggle`;
  if (await page.execute("return document.querySelector(arguments[0]).getAttribute('aria-expanded')==='true'", selector)) return;
  await tabUntil(page, selector); await page.key("\uE007");
  await waitUntil(() => page.execute("return document.querySelector(arguments[0]).getAttribute('aria-expanded')==='true'", selector), "message details opened through the native keyboard control");
}
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

test("Chrome: only Jessie sees a read receipt after a metadata-only poll, with stable focus and French / English labels", { timeout: 45000 }, async () => {
  for (const role of ["client", "admin"]) {
    resetFixture(); const page = await browser(390);
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      if (role === "admin") await page.click(".contact");
      await loadedPhoto(page);
      await openMessageDetails(page, "2");
      await tabUntil(page, '#messages [data-sequence="2"] .delete-message');
      await page.execute(`window.__receiptProbe = { article: document.querySelector('#messages [data-sequence="2"]'),
        remove: document.activeElement, receipt: document.querySelector('#messages [data-sequence="2"] .message-meta span') };`);
      assert.equal(await page.execute("return window.__receiptProbe.receipt.textContent"), "Envoyé");
      // Deliberately supply a nonzero value to both roles to verify that even
      // an old response cannot reveal Jessie's read state in the client UI.
      fixture.peerReadSequence = "2"; fixture.peerName = "Updated receipt fixture"; const requests = fixture.eventRequests;
      await waitUntil(() => fixture.eventRequests > requests, "metadata-only scheduled poll", 10000);
      await waitUntil(() => page.execute("return document.getElementById('peer-name').textContent === 'Updated receipt fixture'"), "metadata-only snapshot adopted");
      await waitUntil(() => page.execute("return window.__receiptProbe.receipt.textContent === arguments[0]", role === "admin" ? "Lu" : "Envoyé"), "role-specific receipt label");
      assert.equal(await page.execute(`const p = window.__receiptProbe; return document.querySelector('#messages [data-sequence="2"]') === p.article
        && document.activeElement === p.remove && p.article.querySelector('.message-meta span') === p.receipt`), true);
      await toggleChatLanguage(page);
      await openMessageDetails(page, "2");
      assert.equal(await page.execute("return window.__receiptProbe.receipt.textContent"), role === "admin" ? "Read" : "Sent");
      assert.equal(await page.execute("return document.querySelector('#messages [data-sequence=\"2\"]') === window.__receiptProbe.article"), true);
      await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome mobile: compact messages reveal one accessible details area at a time without intercepting photos or native links", { timeout: 180000 }, async () => {
  for (const width of [320, 360, 390]) for (const role of ["client", "admin"]) for (const language of ["fr", "en"]) {
    resetFixture(); fixture.peerReadSequence = "2";
    const page = await browser(width, 640), context = `${role} ${language} ${width}px`;
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      if (role === "admin") await page.click(".contact");
      await loadedPhoto(page);
      if (language === "en") await toggleChatLanguage(page);
      const resting = await page.execute(`const row=document.querySelector('#messages [data-sequence="2"]'), bubble=row.querySelector('.bubble');
        return {visibleDetails:[...document.querySelectorAll('#messages .message-meta')].filter(node=>node.getClientRects().length>0).length,
          selected:document.querySelectorAll('#messages .is-selected').length, gap:parseFloat(getComputedStyle(document.getElementById('messages')).rowGap),
          bubbleHeight:bubble.getBoundingClientRect().height, placeholder:document.getElementById('message-body').placeholder};`);
      assert.equal(resting.visibleDetails, 0, `${context}: dates, receipts and deletion reserve no permanent row`);
      assert.equal(resting.selected, 0); assert.ok(resting.gap<=10, `${context}: compact message gap (${resting.gap}px)`);
      assert.ok(resting.bubbleHeight<=48, `${context}: one-line text bubble stays compact (${resting.bubbleHeight}px)`);
      assert.equal(resting.placeholder, role === "client" ? language === "fr" ? "Écris-moi…" : "Write to me…" : language === "fr" ? "Écris ton message…" : "Write your message…");

      await openMessageDetails(page, "2");
      const details = await page.execute(`const row=document.querySelector('#messages [data-sequence="2"]'),meta=row.querySelector('.message-meta'),toggle=row.querySelector('.message-details-toggle'),r=toggle.getBoundingClientRect();
        return {selected:document.querySelectorAll('#messages .is-selected').length,visible:!meta.hidden,controls:toggle.getAttribute('aria-controls')===meta.id,
          label:toggle.getAttribute('aria-label'),role:row.getAttribute('role'),width:r.width,height:r.height,below:meta.getBoundingClientRect().top>=row.querySelector('.bubble').getBoundingClientRect().bottom-1,
          receipt:meta.querySelector('span').textContent,deleteVisible:row.querySelector('.delete-message').getClientRects().length>0};`);
      assert.equal(details.selected, 1); assert.equal(details.visible && details.controls && details.below && details.deleteVisible, true, context);
      assert.equal(details.role, "listitem"); assert.match(details.label, language === "fr" ? /^Détails du message/ : /^Details of message/);
      assert.ok(details.width>=44 && details.height>=44, `${context}: focused details control is touch-sized`);
      assert.equal(details.receipt, role === "admin" ? language === "fr" ? "Lu" : "Read" : language === "fr" ? "Envoyé" : "Sent", `${context}: only Jessie may see a read receipt`);
      await page.click('#messages [data-sequence="2"] .bubble');
      assert.equal(await page.execute("return document.querySelectorAll('#messages .is-selected').length"), 0, "another tap on the same message closes its details");
      await openMessageDetails(page, "2"); await page.key("\uE00C");
      assert.equal(await page.execute("return document.querySelectorAll('#messages .is-selected').length===0 && document.activeElement.matches('#messages [data-sequence=\"2\"] .message-details-toggle')"), true, `${context}: Escape restores the details button`);

      await openMessageDetails(page, "2");
      await page.click('#messages [data-sequence="3"] .photo-caption');
      assert.equal(await page.execute("return document.querySelectorAll('#messages .is-selected').length===1 && document.querySelector('#messages [data-sequence=\"3\"]').classList.contains('is-selected') && document.querySelector('#messages [data-sequence=\"2\"] .message-meta').hidden"), true, `${context}: selection is unique`);
      assert.equal(await page.execute("return document.querySelector('#messages [data-sequence=\"3\"] .delete-message')===null"), true, `${context}: a peer message has no delete permission`);
      await page.click("#message-body");
      assert.equal(await page.execute("return document.querySelectorAll('#messages .is-selected').length"), 0, `${context}: an outside click closes details`);
      await page.click('#messages [data-sequence="3"] .photo-open');
      await waitUntil(() => page.execute("return document.getElementById('lightbox').open"), "the photo keeps its own enlarge action");
      assert.equal(await page.execute("return document.querySelectorAll('#messages .is-selected').length"), 0);
      assert.equal(await page.execute("return document.getElementById('confirm-delete').open"), false); await page.key("\uE00C");

      // Exercise the interactive-descendant guard with a native anchor. This
      // fixture does not claim that plain message text is automatically linked.
      await page.execute(`const link=document.createElement('a');link.id='synthetic-message-link';link.href='#synthetic-link';link.textContent='Synthetic link';document.querySelector('#messages [data-sequence="2"] .bubble').append(link);`);
      await page.click("#synthetic-message-link");
      assert.equal(await page.execute("return location.hash"), "#synthetic-link", `${context}: the native link keeps its navigation action`);
      assert.equal(await page.execute("return document.querySelectorAll('#messages .is-selected').length===0 && !document.getElementById('confirm-delete').open && document.getElementById('chat-menu').hidden"), true, `${context}: a native link never opens details, deletion or account options`);
      assert.equal(fixture.deleteRequests, 0); assert.equal(fixture.messageRequests.length, 0); await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome mobile: a captionless photo has a visible touch-sized details control without adding a metadata row", { timeout: 180000 }, async () => {
  for (const width of [320, 360, 390]) for (const role of ["client", "admin"]) for (const ownPhoto of [false, true]) {
    resetFixture(); fixture.photoWithoutCaption = true; fixture.ownPhoto = ownPhoto;
    const page = await browser(width, 640), context = `${role} ${ownPhoto ? "own" : "peer"} photo ${width}px`;
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      if (role === "admin") await page.click(".contact");
      await loadedPhoto(page);
      const resting = await page.execute(`const row=document.querySelector('#messages [data-sequence="3"]'),bubble=row.querySelector('.photo-message'),button=row.querySelector('.message-details-toggle'),meta=row.querySelector('.message-meta'),r=button.getBoundingClientRect(),b=bubble.getBoundingClientRect(),s=document.getElementById('message-scroll').getBoundingClientRect();
        return {caption:!!row.querySelector('.photo-caption'),hidden:meta.hidden,visible:button.getClientRects().length>0 && getComputedStyle(button).clipPath==='none',
          touch:r.width>=44 && r.height>=44,fits:r.left>=s.left && r.right<=s.right,beside:r.bottom<=b.bottom+1,
          hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===button,extraHeight:row.getBoundingClientRect().height-b.height};`);
      assert.equal(resting.caption, false, context); assert.equal(resting.hidden, true, context);
      assert.equal(resting.visible && resting.touch && resting.fits && resting.beside && resting.hit, true, context);
      assert.ok(resting.extraHeight<=1, `${context}: the details control adds no vertical space`);
      await page.click('#messages [data-sequence="3"] .message-details-toggle');
      assert.equal(await page.execute(`const row=document.querySelector('#messages [data-sequence="3"]');return row.classList.contains('is-selected') && !row.querySelector('.message-meta').hidden && !document.getElementById('lightbox').open && !document.getElementById('confirm-delete').open;`), true, context);
      assert.equal(await page.execute(`const button=document.querySelector('#messages [data-sequence="3"] .delete-message');return !!button && button.getClientRects().length>0;`), ownPhoto, `${context}: existing ownership governs deletion`);
      await page.click("#message-body");
      await page.click('#messages [data-sequence="3"] .photo-open');
      await waitUntil(() => page.execute("return document.getElementById('lightbox').open"), "the captionless photo still opens its viewer");
      assert.equal(await page.execute("return document.querySelectorAll('#messages .is-selected').length===0 && !document.getElementById('confirm-delete').open"), true, context);
      await page.key("\uE00C");
      assert.equal(fixture.deleteRequests, 0); assert.equal(fixture.messageRequests.length, 0); await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome: message details never hide an uncertain send, its error or the explicit retry action", { timeout: 60000 }, async () => {
  for (const role of ["client", "admin"]) {
    resetFixture(); fixture.failNextSend = true; const page = await browser(360, 640), draft = "Synthetic retry draft";
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      if (role === "admin") await page.click(".contact");
      await page.type("#message-body", draft); await page.click("#send");
      await waitUntil(() => page.execute("return !document.getElementById('pending-controls').hidden && !document.getElementById('retry-send').disabled && document.getElementById('chat-status').classList.contains('is-error')"), "uncertain send keeps its error and retry outside message details");
      const originalKey = fixture.messageRequests[0].clientMessageId;
      await openMessageDetails(page, "2"); await page.key("\uE00C");
      assert.equal(await page.execute("return document.getElementById('message-body').value===arguments[0] && !document.getElementById('pending-controls').hidden && document.getElementById('retry-send').getClientRects().length>0 && document.getElementById('chat-status').textContent.length>0", draft), true);
      assert.equal(fixture.messageRequests.length, 1); assert.equal(fixture.deleteRequests, 0);
      await page.click("#retry-send");
      await waitUntil(async () => fixture.sent.length === 1 && await page.execute("return document.getElementById('pending-controls').hidden && document.getElementById('message-body').value===''") , "explicit retry confirms the original send");
      assert.equal(fixture.messageRequests.length, 2); assert.equal(fixture.messageRequests[1].clientMessageId, originalKey);
      assert.equal(fixture.sent.length, 1); await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome 320px: keyboard emoji search inserts at the selection without photos or automatic sending, and Escape restores focus", { timeout: 60000 }, async () => {
  for (const role of ["client", "admin"]) {
    resetFixture(); fixture.mediaDisabled = true; const page = await browser(320);
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      if (role === "admin") await page.click(".contact");
      await waitUntil(() => page.execute("return !document.getElementById('open-emojis').disabled"), "emoji selector enabled without photos");
      await page.type("#message-body", "Hello friend");
      await page.execute("document.getElementById('message-body').setSelectionRange(6, 12)");
      await page.click("#open-emojis");
      await waitUntil(() => page.execute("return document.getElementById('emoji-dialog').matches(':modal') && document.activeElement.id === 'emoji-search'"), "native emoji dialog and search focus");
      await page.type("#emoji-search", "kiss");
      await tabUntil(page, '#emoji-list [data-emoji-id="kiss-face"]');
      await page.key("\uE014"); assert.notEqual(await page.execute("return document.activeElement.dataset.emojiId"), "kiss-face");
      await page.key("\uE012"); assert.equal(await page.execute("return document.activeElement.dataset.emojiId"), "kiss-face");
      await page.key("\uE007");
      assert.equal(await page.execute("return document.getElementById('message-body').value"), "Hello 😘");
      assert.deepEqual(await page.execute("const t=document.getElementById('message-body');return [t.selectionStart,t.selectionEnd,document.activeElement.id]"), [8, 8, "message-body"]);
      assert.equal(fixture.messageRequests.length, 0);
      await page.click("#open-emojis"); await page.key("\uE00C");
      await waitUntil(() => page.execute("return !document.getElementById('emoji-dialog').open && document.activeElement.id === 'open-emojis'"), "Escape returns to the emoji opener");
      await page.click("#open-emojis");
      await page.execute("JessieI18n.setLanguage('en')");
      assert.equal(await page.execute("return document.querySelector('.emoji-search span').textContent"), "Find an emoji");
      const layout = await page.execute(`const dialog=document.getElementById('emoji-dialog'), rect=dialog.getBoundingClientRect();
        return {fits:rect.left>=0 && rect.right<=innerWidth && dialog.scrollWidth<=dialog.clientWidth,
          touch:[...document.querySelectorAll('#emoji-list button')].every(button=>{const b=button.getBoundingClientRect();return b.width>=44 && b.height>=44})};`);
      assert.deepEqual(layout, { fits: true, touch: true });
      await page.key("\uE00C"); assert.equal(await page.execute("return document.getElementById('message-body').value"), "Hello 😘");
      assert.equal(fixture.messageRequests.length, 0); await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome 320px: skin tone changes the preview and inserted text, survives reopening and translation without sending", { timeout: 60000 }, async () => {
  for (const role of ["client", "admin"]) {
    resetFixture(); fixture.mediaDisabled = true; const page = await browser(320);
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      if (role === "admin") await page.click(".contact");
      await waitUntil(() => page.execute("return !document.getElementById('open-emojis').disabled"), "emoji selector enabled");
      await page.type("#message-body", "Hello friend");
      await page.execute("document.getElementById('message-body').setSelectionRange(6, 12)");
      await page.click("#open-emojis");
      assert.equal(await page.execute("return document.getElementById('emoji-skin-tone').value"), "default");
      await tabUntil(page, "#emoji-skin-tone");
      await page.key("\uE010"); await page.key("\uE004");
      await waitUntil(() => page.execute("return document.getElementById('emoji-skin-tone').value === 'dark'"), "dark skin tone chosen with the keyboard");
      await page.type("#emoji-search", "pouce");
      assert.equal(await page.execute("return document.querySelector('[data-emoji-id=\"thumbs-up\"]').textContent"), "👍🏿");
      await page.click('[data-emoji-id="thumbs-up"]');
      assert.equal(await page.execute("return document.getElementById('message-body').value"), "Hello 👍🏿");
      assert.deepEqual(await page.execute("const t=document.getElementById('message-body');return [t.selectionStart,t.selectionEnd,document.activeElement.id]"), [10, 10, "message-body"]);
      assert.equal(fixture.messageRequests.length, 0);

      await page.click("#open-emojis");
      assert.equal(await page.execute("return document.getElementById('emoji-skin-tone').value"), "dark");
      await page.execute("JessieI18n.setLanguage('en')");
      const translated = await page.execute("const select=document.getElementById('emoji-skin-tone');return {value:select.value,label:document.querySelector('label[for=\"emoji-skin-tone\"] span').textContent,option:select.selectedOptions[0].textContent};");
      assert.equal(translated.value, "dark"); assert.equal(translated.label, "Skin tone"); assert.match(translated.option, /dark/i);
      await page.type("#emoji-search", "peace");
      assert.equal(await page.execute("return document.querySelector('[data-emoji-id=\"peace\"]').textContent"), "✌🏿");
      const layout = await page.execute(`const dialog=document.getElementById('emoji-dialog'), rect=dialog.getBoundingClientRect(), tone=document.getElementById('emoji-skin-tone').getBoundingClientRect();
        return {fits:rect.left>=0 && rect.right<=innerWidth && dialog.scrollWidth<=dialog.clientWidth,
          tone: tone.width>=44 && tone.height>=44,
          touch:[...document.querySelectorAll('#emoji-list button')].every(button=>{const b=button.getBoundingClientRect();return b.width>=44 && b.height>=44})};`);
      assert.deepEqual(layout, { fits: true, tone: true, touch: true });
      await page.click('[data-emoji-id="peace"]');
      assert.equal(await page.execute("return document.getElementById('message-body').value"), "Hello 👍🏿✌🏿");
      assert.equal(fixture.messageRequests.length, 0); await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

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
      assert.equal(await page.execute("return document.querySelector('#readiness-nav a[href=\"/admin/readiness\"]').textContent"), "État du service");
      assert.equal(await page.execute("return document.getElementById('message-announcement').textContent"), "", "loaded history is silent");
      await toggleChatLanguage(page);
      assert.equal(await page.execute("return document.documentElement.lang"), "en");
      assert.equal(await page.execute("return document.getElementById('message-body').placeholder"), "Write your message…");
      assert.equal(await page.execute("return document.getElementById('peer-name').textContent"), peerName, "private names are never translated");
      assert.equal(await page.execute("return document.querySelector('#readiness-nav a[href=\"/admin/readiness\"]').textContent"), "Service status");
      await tabUntil(page, "#back-to-inbox"); await page.key("\uE007");
      assert.equal(await page.execute("return document.activeElement.dataset.conversationId"), conversationId, "return restores the contact recreated by the controller");
      assert.equal(await page.execute("return document.activeElement.querySelector('strong').textContent"), peerName);
      if (width === 320) assert.equal(await page.execute("return document.documentElement.scrollWidth <= window.innerWidth"), true, "no page overflow at 320px");
      await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome mobile: a single compact conversation bar leaves room for history and exposes account actions through its menu", { timeout: 120000 }, async () => {
  for (const width of [320, 360, 390]) for (const path of ["/messages", "/admin/messages"]) {
    resetFixture(); fixture.notificationsEnabled = true; fixture.profileEnabled = true; fixture.clientExportEnabled = true;
    fixture.peerName = "A deliberately long synthetic contact name for a small screen";
    const page = await browser(width, 640);
    try {
      await loaded(page, path);
      await waitUntil(() => page.execute("return !document.getElementById('open-notifications').hidden && !document.getElementById('open-profile').hidden"), "optional account controls mounted");
      if (path === "/messages") await waitUntil(() => page.execute("return !!document.querySelector('.conversation-download-entry:not([hidden])')"), "optional client export mounted");
      if (path === "/admin/messages") {
        assert.equal(await page.execute("return document.querySelector('.topbar').getClientRects().length>0 && !document.getElementById('open-account-menu').disabled"), true, "the inbox has its compact account bar");
        await page.click(".contact");
      }
      for (const language of ["fr", "en"]) {
        if (language === "en") await toggleChatLanguage(page);
        assert.equal(await page.execute("return document.documentElement.lang"), language);
        if (path === "/messages") {
          assert.equal(await page.execute("return !!document.querySelector('.broadcast-preference, #broadcast-preference-host, #broadcast-nav')"), false);
          assert.equal(await page.execute("return performance.getEntriesByType('resource').some(entry => /\\/api\\/broadcast\\/|broadcast-preference\\.js/.test(new URL(entry.name).pathname))"), false);
        }
        const layout = await page.execute(`
          const visible=node=>!!node&&node.getClientRects().length>0, rect=id=>document.getElementById(id).getBoundingClientRect();
          const head=document.querySelector('.chat-head').getBoundingClientRect(), history=rect('message-scroll'), row=document.querySelector('.composer-row').getBoundingClientRect();
          return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
            duplicateHeader:visible(document.querySelector('.topbar')), avatar:visible(document.getElementById('peer-avatar')),
            name:document.getElementById('peer-name').textContent, headHeight:head.height,
            optionsClosed:document.getElementById('chat-menu').hidden, toolsClosed:document.getElementById('composer-tools').hidden,
            footerVisible:visible(document.getElementById('chat-footer')), historyHeight:history.height, historyBottom:history.bottom,
            rowHeight:row.height, rowBottom:row.bottom,
            controls:['open-conversation-menu','open-composer-tools','open-emojis','message-body','send'].map(id=>{
              const node=document.getElementById(id),r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
              return {id,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,reachable:hit===node||node.contains(hit)};
            })};
        `);
        const context = `${path}, ${width}x640, ${language}`;
        assert.equal(layout.width, width, context); assert.equal(layout.height, 640, context);
        assert.equal(layout.scrollWidth <= layout.width, true, `${context}: no horizontal page overflow`);
        assert.equal(layout.duplicateHeader, false, `${context}: the conversation has one header`);
        assert.equal(layout.avatar, true); assert.equal(layout.name, fixture.peerName);
        assert.ok(layout.headHeight <= 80, `${context}: conversation bar stays compact`);
        assert.equal(layout.optionsClosed && layout.toolsClosed && !layout.footerVisible, true, `${context}: secondary actions reserve no permanent rows`);
        assert.ok(layout.rowHeight <= 64, `${context}: the initial composer fits one row (row=${layout.rowHeight}px, viewport=${layout.width}x${layout.height}, controls=${JSON.stringify(layout.controls)})`);
        assert.ok(layout.rowBottom <= layout.height+1, `${context}: send stays inside the viewport`);
        assert.ok(layout.historyHeight > 0 && layout.historyBottom <= layout.rowBottom, context);
        if (width === 360) assert.ok(layout.historyHeight/layout.height >= 0.70, `${context}: history receives at least 70% of the visible height (history=${layout.historyHeight}px, viewport=${layout.height}px, composer=${layout.rowHeight}px, header=${layout.headHeight}px)`);
        for (const control of layout.controls) {
          assert.ok(control.left >= -1 && control.right <= layout.width+1 && control.top >= 0 && control.bottom <= layout.height+1, `${context}: ${control.id} remains visible`);
          assert.ok(control.width >= 44 && control.height >= 44, `${context}: ${control.id} retains its touch target`);
          assert.equal(control.reachable, true, `${context}: ${control.id} is not covered`);
        }
        const composer = layout.controls.filter(control=>control.id!=="open-conversation-menu");
        assert.ok(composer.every(control=>Math.abs((control.top+control.bottom)/2-(composer[0].top+composer[0].bottom)/2)<=8), `${context}: composer controls share a row`);
        const sent = fixture.messageRequests.length, exports = fixture.exportRequests?.length ?? 0;
        await openChatOptions(page);
        assert.equal(await page.execute("return document.getElementById('chat-menu').getAttribute('role')"), null, "ordinary native controls do not masquerade as an ARIA menu");
        const selectors = ["#account-link", "#open-profile", "#open-notifications", "[data-jm-language]", "#logout", '#chat-footer a[href^="mailto:"]', "#chat-footer [data-help-link]"];
        if (path === "/messages") selectors.push(".conversation-download-entry");
        for (const selector of selectors) {
          const action = await page.execute(`const node=document.querySelector(arguments[0]);node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
            return {width:r.width,height:r.height,reachable:hit===node||node.contains(hit),inside:r.left>=0&&r.right<=innerWidth};`, selector);
          assert.ok(action.width>=44 && action.height>=44 && action.reachable && action.inside, `${context}: ${selector} is accessible in the opened menu`);
        }
        await page.key("\uE00C");
        assert.equal(await page.execute("return document.getElementById('chat-menu').hidden && document.activeElement.id==='open-conversation-menu'"), true, "Escape closes options and restores visible focus");
        assert.equal(fixture.messageRequests.length, sent); assert.equal(fixture.exportRequests?.length ?? 0, exports, "opening options never starts an export");
      }
      await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome short mobile viewports: a multiline draft keeps the composer usable with bounded independent history", { timeout: 60000 }, async () => {
  for (const [width,height] of [[360,360],[640,360]]) for (const role of ["client","admin"]) {
    resetFixture(); const page=await browser(width,height);
    try {
      await loaded(page,role==='admin'?'/admin/messages':'/messages');
      if(role==='admin') await page.click('.contact');
      await page.type('#message-body','A synthetic multiline draft\n'.repeat(8));
      const layout=await page.execute(`const ids=['message-body','send','open-emojis','open-composer-tools'];
        return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
          history:document.getElementById('message-scroll').getBoundingClientRect().height,
          controls:ids.map(id=>{const node=document.getElementById(id),r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {id,top:r.top,bottom:r.bottom,height:r.height,left:r.left,right:r.right,reachable:hit===node||node.contains(hit)};})};`);
      assert.equal(layout.width,width);assert.equal(layout.height,height);assert.ok(layout.scrollWidth<=width);
      assert.ok(layout.history>0,`${role} ${width}x${height}: history retains independent space`);
      for(const control of layout.controls) {
        assert.ok(control.top>=0&&control.bottom<=height+1&&control.left>=0&&control.right<=width+1,`${role} ${width}x${height}: ${control.id} is in the viewport`);
        assert.ok(control.height>=44&&control.reachable,`${role} ${width}x${height}: ${control.id} remains usable`);
      }
      assert.equal(fixture.messageRequests.length,0);await noJavascriptErrors(page);
    } finally {await page.close();}
  }
});

test("Chrome 360px high: photo preview and multiline caption retain reachable attachment tools and Close", { timeout: 60000 }, async () => {
  for (const role of ["client", "admin"]) {
    resetFixture(); const page = await browser(360, 360), caption = "A synthetic photo caption\n".repeat(6);
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      if (role === "admin") await page.click(".contact");
      await openComposerTools(page);
      await page.execute(`const bytes=Uint8Array.from(atob(arguments[0]),char=>char.charCodeAt(0)),files=new DataTransfer();
        files.items.add(new File([bytes],'synthetic-attachment.jpg',{type:'image/jpeg'}));
        const input=document.getElementById('image-file');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));`, jpeg.toString("base64"));
      await waitUntil(() => page.execute("const image=document.querySelector('#image-preview img');return !document.getElementById('image-draft').hidden && image?.complete && image.naturalWidth>0"), "the real photo preview remains present");
      await page.type("#message-body", caption);
      if (await page.execute("return !document.getElementById('composer-tools').hidden")) await page.click("#close-composer-tools");
      await openComposerTools(page);
      const panel = await page.execute("const node=document.getElementById('composer-tools'),r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};");
      assert.ok(panel.top>=0 && panel.bottom<=360+1 && panel.left>=0 && panel.right<=360+1 && panel.height>=44, `${role}: tools stay inside the short viewport`);
      assert.ok(panel.scrollWidth<=panel.clientWidth, `${role}: tools have no horizontal clipping`);
      const selectors = ["#close-composer-tools", "#pick-image", "#open-library", ...(role === "admin" ? ["#open-quick-replies"] : [])];
      for (const selector of selectors) {
        const control = await page.execute(`const node=document.querySelector(arguments[0]);node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
          return {height:r.height,width:r.width,top:r.top,bottom:r.bottom,reachable:hit===node||node.contains(hit)};`, selector);
        assert.ok(control.height>=44 && control.width>=44 && control.top>=0 && control.bottom<=360+1 && control.reachable, `${role}: ${selector} is reachable without removing the photo preview`);
      }
      await page.key("\uE00C");
      assert.equal(await page.execute("return document.getElementById('composer-tools').hidden && document.activeElement.id==='open-composer-tools'"), true);
      assert.equal(await page.execute("return !document.getElementById('image-draft').hidden"), true);
      assert.equal(await page.execute("return document.getElementById('message-body').value"), caption);
      assert.equal(fixture.messageRequests.length, 0); await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome 320px: both roles edit their public profile with the keyboard, translated labels and focus restored to the opener", { timeout: 60000 }, async () => {
  for (const role of ["client", "admin"]) {
    resetFixture(); fixture.profileEnabled = true;
    const page = await browser(320), nextName = `Synthetic ${role} display name`;
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      await waitUntil(() => page.execute("return !document.getElementById('open-profile').hidden"), "profile control mounted");
      if (role === "admin") await page.click(".contact");
      await waitUntil(() => page.execute("return !document.getElementById('message-body').disabled"), "selected conversation metadata rendered");
      assert.equal(await page.execute("return document.getElementById('peer-avatar').textContent"), role === "client" ? "J" : "A", "missing avatar uses the peer's initials");
      await openChatOptions(page); await tabUntil(page, "#open-profile"); await page.key("\uE007");
      await waitUntil(() => page.execute("return document.querySelector('.profile-dialog').matches(':modal') && document.activeElement.matches('.profile-pseudonym')"), "profile loaded with the name focused");
      assert.equal(await page.execute("return document.querySelector('.profile-header h2').textContent"), "Mon profil");
      assert.equal(await page.execute("return document.querySelector('.profile-avatar-preview img').hidden"), true);
      await page.type(".profile-pseudonym", "Envoyer");
      await page.execute("JessieI18n.setLanguage('en')");
      assert.equal(await page.execute("return document.querySelector('.profile-header h2').textContent"), "My profile");
      assert.equal(await page.execute("return document.querySelector('.profile-save').textContent"), "Save profile");
      assert.equal(await page.execute("return document.querySelector('.profile-pseudonym').value"), "Envoyer", "the raw public name is not translated");
      const layout = await page.execute(`const dialog=document.querySelector('.profile-dialog'), rect=dialog.getBoundingClientRect();
        return {fits:rect.left>=0 && rect.right<=innerWidth && dialog.scrollWidth<=dialog.clientWidth,
          touch:[...dialog.querySelectorAll('button,input')].filter(node=>!node.disabled && !node.closest('[hidden]'))
            .every(node=>node.getBoundingClientRect().height>=44)};`);
      assert.deepEqual(layout, { fits: true, touch: true });
      await page.type(".profile-pseudonym", nextName);
      await tabUntil(page, ".profile-save"); await page.key("\uE007");
      await waitUntil(() => page.execute("return !document.querySelector('.profile-dialog').open && document.activeElement.id==='open-conversation-menu'"), "saved profile closes and returns focus");
      assert.deepEqual(fixture.profileRequests, [{ role, expectedVersion: "1", pseudonym: nextName, avatarId: null }]);
      assert.equal(fixture.avatarUploads.length, 0); assert.equal(fixture.messageRequests.length, 0);
      await page.key("\uE007");
      await waitUntil(() => page.execute("return !document.getElementById('chat-menu').hidden"), "returned options button reopens its menu");
      await tabUntil(page, "#open-profile"); await page.key("\uE007");
      await waitUntil(() => page.execute("return document.querySelector('.profile-dialog').matches(':modal') && document.querySelector('.profile-pseudonym').value===arguments[0]", nextName), "reopening reloads the saved public name");
      await page.key("\uE00C");
      await waitUntil(() => page.execute("return !document.querySelector('.profile-dialog').open && document.activeElement.id==='open-conversation-menu'"), "Escape restores the profile opener");
      assert.equal(fixture.profileRequests.length, 1); await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome: real avatar crop, private preview cleanup on controlled hiding, explicit upload/save and peer initials after removal", { timeout: 90000 }, async () => {
  for (const role of ["client", "admin"]) {
    resetFixture(); fixture.profileEnabled = true;
    const peerRole = role === "client" ? "admin" : "client", originalName = fixture.profiles[role].pseudonym;
    fixture.profiles[role].avatarId = id(351); fixture.profiles[peerRole].avatarId = id(352);
    const page = await browser(390);
    const chooseSyntheticAvatar = async () => {
      await page.execute(`const bytes=Uint8Array.from(atob(arguments[0]),char=>char.charCodeAt(0)), files=new DataTransfer();
        files.items.add(new File([bytes],'synthetic-avatar.jpg',{type:'image/jpeg'}));
        const input=document.querySelector('.profile-file');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));`, jpeg.toString("base64"));
      await waitUntil(() => page.execute(`const image=document.querySelector('.profile-avatar-preview img');
        return !document.querySelector('.profile-save').disabled && image?.complete && image.naturalWidth===256
          && document.querySelector('.profile-status').textContent==='Avatar prêt. Enregistre le profil pour l’appliquer.'`), "actual browser JPEG decode and central 256px crop");
    };
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      await waitUntil(() => page.execute("return !document.getElementById('open-profile').hidden"), "profile module mounted");
      if (role === "admin") await page.click(".contact");
      await waitUntil(() => page.execute("const img=document.querySelector('#peer-avatar img');return !!img && img.src.startsWith('blob:') && img.complete && img.naturalWidth>0"), "private peer avatar decoded from a bounded authenticated response");
      await clickOptionsAction(page, "#open-profile");
      await waitUntil(() => page.execute("const img=document.querySelector('.profile-avatar-preview img');return document.querySelector('.profile-dialog').matches(':modal') && !img.hidden && img.complete && img.naturalWidth>0"), "saved avatar appears as a private blob preview");
      await page.type(".profile-pseudonym", "Unsaved private profile draft");
      await chooseSyntheticAvatar();
      const discardedPreview = await page.execute("return document.querySelector('.profile-avatar-preview img').src");
      assert.match(discardedPreview, /^blob:/); assert.equal(fixture.avatarUploads.length, 0); assert.equal(fixture.profileRequests.length, 0);
      await page.execute("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__profileHidden?'hidden':'visible'});window.__profileHidden=true;document.dispatchEvent(new Event('visibilitychange'))");
      assert.equal(await page.execute("return !document.querySelector('.profile-dialog').open && document.querySelector('.profile-pseudonym').value==='' && !document.querySelector('.profile-avatar-preview img').getAttribute('src')"), true, "controlled hiding clears the private profile DOM");
      assert.equal(await page.execute("return window.__revokedBlobUrls.includes(arguments[0])", discardedPreview), true, "discarded preview's actual object URL is revoked");
      assert.equal(fixture.profileRequests.length, 0); assert.equal(fixture.avatarUploads.length, 0);
      await page.execute("window.__profileHidden=false;document.dispatchEvent(new Event('visibilitychange'))");
      await waitUntil(() => page.execute("return !document.getElementById('workspace').hidden"), "same-session chat resumes after controlled visibility");
      await clickOptionsAction(page, "#open-profile");
      await waitUntil(() => page.execute("return document.querySelector('.profile-dialog').matches(':modal') && document.querySelector('.profile-pseudonym').value===arguments[0]", originalName), "reopening discards the unsaved profile draft");
      await chooseSyntheticAvatar(); await page.click(".profile-save");
      await waitUntil(() => page.execute("return !document.querySelector('.profile-dialog').open"), "explicit save finishes the avatar upload");
      assert.equal(fixture.avatarUploads.length, 1); assert.equal(fixture.avatarUploads[0].role, role);
      assert.equal(fixture.profileRequests.length, 1); assert.equal(fixture.profileRequests[0].avatarId, id(401));
      assert.equal(fixture.profileRequests[0].pseudonym, originalName); assert.equal(fixture.messageRequests.length, 0, "an avatar is never sent as a conversation message");
      await clickOptionsAction(page, "#open-profile");
      await waitUntil(() => page.execute("return document.querySelector('.profile-dialog').matches(':modal') && !document.querySelector('.profile-remove-avatar').disabled"), "saved avatar can be removed");
      await page.click(".profile-remove-avatar"); assert.equal(fixture.profileRequests.length, 1, "removal remains a draft before save");
      await page.click(".profile-save");
      await waitUntil(() => page.execute("return !document.querySelector('.profile-dialog').open"), "avatar removal saved");
      assert.equal(fixture.profileRequests.length, 2); assert.equal(fixture.profileRequests[1].avatarId, null);
      assert.equal(fixture.avatarUploads.length, 1); assert.equal(fixture.messageRequests.length, 0);
      fixture.profiles[peerRole].avatarId = null; fixture.profiles[peerRole].version = "2";
      await waitUntil(() => page.execute("return !document.querySelector('#peer-avatar img') && document.getElementById('peer-avatar').textContent===arguments[0]", role === "client" ? "J" : "A"), "a peer without an avatar returns to initials after a real scheduled poll", 15000);
      assert.ok(fixture.avatarRequests.some(request => request.role === role && request.conversationId === conversationId));
      assert.ok(fixture.avatarRequests.some(request => request.role === role && request.conversationId === null));
      await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome: aggregate new-message announcement, silent empty poll / older history, stable focused photo", { timeout: 45000 }, async () => {
  resetFixture(); const page = await browser();
  try {
    await loaded(page, "/messages"); await loadedPhoto(page);
    await toggleChatLanguage(page);
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
    await waitUntil(() => page.execute("return !document.getElementById('lightbox').open && document.activeElement === window.__photoOpener"), "Escape closes native modal and its close event restores photo focus");
    assert.equal(await page.execute("return document.activeElement === window.__photoOpener"), true, "Escape restores the same photo control");
    await clickOptionsAction(page, "#open-gallery");
    await waitUntil(() => page.execute("const dialog = document.getElementById('media-dialog'); const image = dialog.querySelector('img'); return dialog.open && dialog.matches(':modal') && !!image && image.complete && image.naturalWidth > 0"), "native conversation gallery");
    await page.key("\uE00C");
    await waitUntil(() => page.execute("return !document.getElementById('media-dialog').open && document.activeElement.id === 'open-conversation-menu'"), "Escape closes conversation gallery and its close event restores menu focus");
    assert.equal(await page.execute("return document.activeElement.id"), "open-conversation-menu");
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
    await openMessageDetails(page, "2");
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

test("Chrome: notification history acknowledges a persisted send after native response loss, without duplicate text or photo caption", { timeout: 60000 }, async () => {
  for (const role of ["client", "admin"]) for (const kind of ["text", "photo"]) {
    resetFixture(); fixture.historyAcknowledgement = true; fixture.holdEvents = true;
    const page = await browser(390), body = `Fictional ${role} ${kind} with an uncertain response`;
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      if (role === "admin") await page.click(".contact");
      await waitUntil(() => page.execute("return !document.querySelector('#message-body').disabled"), "conversation can send");
      await page.type("#message-body", body);
      if (kind === "photo") {
        await clickComposerAction(page, "#open-library");
        await waitUntil(() => page.execute("return !!document.querySelector('#media-dialog[open] [data-media-action=choose]')"), "synthetic JPEG available in the real library dialog");
        await page.click("[data-media-action=choose]");
        await waitUntil(() => page.execute("const img=document.querySelector('#image-preview img');return !document.querySelector('#image-draft').hidden && !!img && img.complete && img.naturalWidth>0"), "selected JPEG preview decoded");
      }
      await page.click("#send");
      await waitUntil(() => fixture.sent.length === 1 && Boolean(fixture.dropSendResponse), "server persisted the send and withheld its response");
      const persisted = { ...fixture.sent[0] }, originalKey = fixture.messageRequests[0].clientMessageId;
      assert.match(originalKey, /^[a-f0-9]{32}$/); assert.equal(persisted.clientMessageId, originalKey);
      assert.equal(persisted.body, body);
      assert.equal(await page.execute("return document.querySelector('#message-body').value"), body, "uncertain send retains its draft before proof");

      // A real hash event opens an older, initially unloaded peer message.
      // The selection aborts the held native fetch, then loads a snapshot
      // containing our exact persisted client key with an advanced cursor.
      await page.execute("location.hash=arguments[0]", `notification=${id(999)}`);
      await waitUntil(() => page.execute("return location.hash==='' && !!document.querySelector('#messages [data-sequence=\"1\"].notification-target')"), "notification selected its exact message through fresh history");
      await waitUntil(() => fixture.sendResponseClosed === true, "native abort closed the withheld POST response");
      assert.equal(await page.execute("return document.querySelector('#message-body').value"), "", `${role}/${kind}: history acknowledgement clears the sent draft`);
      assert.equal(await page.execute("return document.querySelector('#pending-controls').hidden && document.querySelector('#image-draft').hidden && document.querySelector('#send').disabled"), true);
      assert.equal(await page.execute("return document.querySelectorAll('#messages [data-sequence=\"4\"]').length"), 1);
      assert.equal(await page.execute("const row=document.querySelector('#messages [data-sequence=\"4\"]');return (row.querySelector('.photo-caption')??row.querySelector('.bubble')).textContent"), body);

      // A queued retry click after its control disappeared must be harmless.
      await page.execute("document.querySelector('#retry-send').click()");
      assert.equal(await page.execute("return document.querySelector('#chat-status').classList.contains('is-error')"), false, "acknowledged text is not reported as an invalid retry");
      const completedPolls = await page.execute("return performance.getEntriesByType('resource').filter(entry=>new URL(entry.name).pathname.endsWith('/events')).length");
      const requestedPolls = fixture.eventRequests;
      fixture.holdEvents = false; for (const release of fixture.eventHolds.splice(0)) release();
      await waitUntil(async () => fixture.eventRequests > requestedPolls && await page.execute("return performance.getEntriesByType('resource').filter(entry=>new URL(entry.name).pathname.endsWith('/events')).length>arguments[0]", completedPolls), "normal event polling continues after the history acknowledgement");
      assert.equal(await page.execute("return document.querySelector('#message-body').value === '' && document.querySelector('#pending-controls').hidden && !document.querySelector('#chat-status').classList.contains('is-error')"), true);
      assert.equal(fixture.messageRequests.length, 1, "neither navigation nor the acknowledged retry sends another POST");
      assert.equal(fixture.sent.length, 1); assert.equal(fixture.messageRequests[0].clientMessageId, originalKey);
      await noJavascriptErrors(page);
    } finally {
      fixture.dropSendResponse?.(); fixture.holdEvents = false;
      for (const release of fixture.eventHolds.splice(0)) release();
      await page.close();
    }
  }
});

async function openConversationExport(page) {
  await loaded(page, "/admin/messages");
  await waitUntil(() => page.execute("return !!document.querySelector('.crm-fiche-button') && !!document.querySelector('.contact')"), "CRM initialized");
  if (await page.execute("return document.querySelector('.crm-fiche-button').hidden")) await page.click(".contact");
  await waitUntil(() => page.execute("return !document.querySelector('.crm-fiche-button').hidden"), "selected conversation profile");
  await openChatOptions(page); await tabUntil(page, ".crm-fiche-button"); await page.key("\uE007");
  await waitUntil(() => page.execute("return !!document.querySelector('.crm-dialog[open] .crm-export:not([hidden])')"), "download section of current profile");
  await page.click(".crm-export > summary");
  await page.execute("window.__exportDownloads=[];const original=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{if(blob.type==='application/zip')window.__exportDownloadBytes=blob.size;return original(blob);};document.addEventListener('click',e=>{const a=e.target.closest('a[download]');if(a){e.preventDefault();window.__exportDownloads.push(a.download);}})");
}

test("real Chrome: conversation archive from the actual chat controller, keyboard and translations", { timeout: 120000 }, async t => {
  for (const width of [320, 1280]) for (const language of ["fr", "en"]) await t.test(`${language} ${width}px`, async () => {
    resetFixture(); fixture.exportEnabled = true; const page = await browser(width);
    try {
      await openConversationExport(page);
      if (language === "en") { await page.key("\uE00C"); await toggleChatLanguage(page); await clickOptionsAction(page, ".crm-fiche-button"); await waitUntil(() => page.execute("return !!document.querySelector('.crm-dialog[open] .crm-export:not([hidden])')"), "translated profile ready"); await page.click(".crm-export > summary"); }
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
    await clickOptionsAction(page, ".crm-fiche-button");
    await waitUntil(() => page.execute("return document.querySelector('.crm-dialog[open] .crm-export .crm-status').textContent === ''"), "a fresh profile has no old download status");
    assert.equal(await page.execute("return window.__exportDownloads.length"), 0); assert.equal(fixture.exportRequests.length, 1);
    assert.equal(await page.execute("return document.querySelector('.crm-export button').disabled"), false);
  } finally { fixture.releaseExport?.(); await page.close(); }
});

async function openClientExport(page, language = "fr") {
  await loaded(page, "/messages");
  await waitUntil(() => page.execute("return !!document.querySelector('.conversation-download-entry:not([hidden])')"), "client download control mounted");
  if (language === "en") await toggleChatLanguage(page);
  await page.execute("window.__exportDownloads=[];const original=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{if(blob.type==='application/zip')window.__exportDownloadBytes=blob.size;return original(blob);};document.addEventListener('click',e=>{const a=e.target.closest('a[download]');if(a){e.preventDefault();window.__exportDownloads.push(a.download);}})");
  await openChatOptions(page); await tabUntil(page, ".conversation-download-entry"); await page.key("\uE007");
  await waitUntil(() => page.execute("return !!document.querySelector('.conversation-download[open]')"), "client export dialog open");
}

test("real Chrome: clients download their own conversation at mobile/desktop widths in both languages", { timeout: 120000 }, async t => {
  for (const width of [320, 1280]) for (const language of ["fr", "en"]) await t.test(`${language} ${width}px`, async () => {
    resetFixture(); fixture.clientExportEnabled = true; const page = await browser(width);
    try {
      await openClientExport(page, language);
      assert.equal(await page.execute("return document.querySelector('.conversation-download h2').textContent"), language === "fr" ? "Télécharger ma conversation" : "Download my conversation");
      await page.key("\uE00C"); await page.type("#message-body", "Unsent client draft");
      await clickOptionsAction(page, ".conversation-download-entry");
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
      assert.equal(await page.execute("return ['open-account-menu','open-conversation-menu'].includes(document.activeElement.id) && document.activeElement.getClientRects().length>0"), true);
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
    await page.key("\uE00C"); fixture.releaseExport(); await clickOptionsAction(page, ".conversation-download-entry");
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
      if (language === "en") await toggleChatLanguage(page);
      await page.type("#message-body", "Personal draft");
      await openComposerTools(page); await tabUntil(page, "#open-quick-replies"); await page.key("\uE007");
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
  resetFixture(); fixture.holdInitialAdminMessages = true; const page = await browser(320);
  try {
    await loaded(page, "/messages"); assert.equal(await page.execute("return document.querySelector('#open-quick-replies').hidden"), true);
    await loaded(page, "/admin/messages"); await page.click(".contact");
    await waitUntil(() => Boolean(fixture.releaseInitialAdminMessages), "initial administrator history held before composition is ready");
    assert.deepEqual(await page.execute(`const reply=document.querySelector('#open-quick-replies'),body=document.querySelector('#message-body');
      return {replyHidden:reply.hidden,replyDisabled:reply.disabled,bodyDisabled:body.disabled};`),
    { replyHidden: true, replyDisabled: false, bodyDisabled: true }, "an initially enabled but hidden reply button does not prove the composer is ready");
    fixture.releaseInitialAdminMessages();
    await waitUntil(() => page.execute(`const reply=document.querySelector('#open-quick-replies'),body=document.querySelector('#message-body');
      return !reply.hidden && !reply.disabled && !body.disabled && !body.readOnly && body.getClientRects().length>0;`), "quick replies and editable message field available after history");
    await page.type("#message-body", "Unsent draft"); await clickComposerAction(page, "#open-quick-replies"); await page.key("\uE00C");
    assert.equal(await page.execute("return document.querySelector('#quick-replies-dialog').open"), false);
    assert.equal(await page.execute("return document.querySelector('#message-body').value"), "Unsent draft");
    await page.type("#message-body", "x".repeat(4096)); await clickComposerAction(page, "#open-quick-replies"); await page.click('[data-quick-reply="thanks"]');
    assert.equal(await page.execute("return document.querySelector('#message-body').value.length"), 4096);
    assert.equal(await page.execute("return document.querySelector('#quick-replies-dialog').open"), true);
    assert.match(await page.execute("return document.querySelector('#quick-replies-status').textContent"), /ne peut pas être ajoutée/);
    await page.key("\uE00C"); await page.click("#back-to-inbox");
    assert.equal(await page.execute("return document.querySelector('#quick-replies-dialog').open"), false);
    assert.equal(await page.execute("return document.querySelector('#quick-replies-list').children.length"), 0);
    assert.equal(fixture.sent.length, 0); await noJavascriptErrors(page);
  } finally { fixture.releaseInitialAdminMessages?.(); await page.close(); }
});

async function openPersonalRepliesBrowser(page, language = "fr") {
  await loaded(page, "/admin/messages"); await page.click(".contact");
  await waitUntil(() => page.execute("return !document.querySelector('#open-quick-replies').disabled"), "quick replies are available in the selected conversation");
  if (language === "en") await toggleChatLanguage(page);
  await clickComposerAction(page, "#open-quick-replies");
  await waitUntil(() => page.execute("return !document.querySelector('#new-personal-reply').disabled"), "personal catalogue loaded");
}
async function fillPersonalReply(page, title, body) {
  await page.type("#personal-reply-title", title); await page.type("#personal-reply-body", body); await page.click("#personal-reply-save");
}
for (const [width, language] of [[320, "fr"], [1280, "en"]]) test(`Chrome ${width}px ${language}: personal replies persist between sessions and CAS conflicts preserve both catalogue and draft`, { timeout: 90000 }, async () => {
  resetFixture(); const first = await browser(width), second = await browser(width);
  try {
    await openPersonalRepliesBrowser(first, language);
    await first.click("#new-personal-reply"); await fillPersonalReply(first, "Envoyer", "Mes photos <b>texte personnel</b>");
    await waitUntil(() => fixture.quickReplies.version === "1" && first.execute("return document.querySelector('#personal-reply-editor').hidden"), "first personal reply saved");
    const replyId = fixture.quickReplies.replies[0].id;
    assert.equal(fixture.quickReplyRequests.length, 1); assert.equal(fixture.sent.length, 0);
    await openPersonalRepliesBrowser(second, language);
    assert.equal(await second.execute(`return document.querySelector('[data-personal-id="${replyId}"] strong').textContent`), "Envoyer");
    assert.equal(await second.execute(`return document.querySelector('[data-personal-id="${replyId}"] span').textContent`), "Mes photos <b>texte personnel</b>");
    assert.equal(await second.execute("return document.querySelectorAll('#personal-replies-list b').length"), 0);
    await second.click(`[data-personal-id="${replyId}"] [data-personal-action="edit"]`);
    await second.type("#personal-reply-title", "Mon titre"); await second.type("#personal-reply-body", "Brouillon conservé");
    await first.click("#new-personal-reply"); await fillPersonalReply(first, "Autre réponse", "À conserver depuis la première session");
    await waitUntil(() => fixture.quickReplies.version === "2", "other session adds a reply");
    await second.click("#personal-reply-save");
    await waitUntil(() => second.execute("return document.querySelector('#personal-reply-save').disabled && document.querySelector('#personal-replies-status').textContent.length>0"), "conflict blocks another mutation");
    assert.equal(fixture.quickReplyRequests.length, 3); assert.equal(await second.execute("return document.querySelector('#personal-reply-body').value"), "Brouillon conservé");
    assert.match(await second.execute("return document.querySelector('#personal-replies-status').textContent"), language === "fr" ? /changé ailleurs/ : /changed elsewhere/);
    await second.click("#reload-personal-replies");
    await waitUntil(() => second.execute("return !document.querySelector('#personal-reply-save').disabled"), "explicit reload adopts the current catalogue version");
    assert.equal(await second.execute("return document.querySelector('#personal-reply-body').value"), "Brouillon conservé"); assert.equal(fixture.quickReplyRequests.length, 3);
    await second.click("#personal-reply-save"); await waitUntil(() => fixture.quickReplies.version === "3", "explicit save keeps the concurrent addition");
    assert.equal(fixture.quickReplies.replies.length, 2); assert.equal(fixture.quickReplies.replies.find(reply => reply.id === replyId).body, "Brouillon conservé");
    await waitUntil(() => second.execute("return document.querySelector('#personal-reply-editor').hidden"), "editor cleared after acknowledgement");
    await second.execute("document.querySelector('#message-body').value='Personal draft'"); await second.click(`[data-personal-quick-reply="${replyId}"]`);
    assert.equal(await second.execute("return document.querySelector('#message-body').value"), "Personal draft\nBrouillon conservé"); assert.equal(fixture.sent.length, 0);
    await first.click("#close-quick-replies"); await clickComposerAction(first, "#open-quick-replies");
    await waitUntil(() => first.execute(`return document.querySelector('[data-personal-id="${replyId}"] span')?.textContent==='Brouillon conservé'`), "reopening refreshes personal replies");
    await first.click(`[data-personal-id="${replyId}"] [data-personal-action="delete"]`); assert.equal(fixture.quickReplies.replies.length, 2);
    await first.click(`[data-personal-id="${replyId}"] [data-personal-action="confirm-delete"]`);
    await waitUntil(() => fixture.quickReplies.version === "4", "confirmed deletion persists"); assert.equal(fixture.quickReplies.replies.length, 1);
    assert.equal(await first.execute("const d=document.querySelector('#quick-replies-dialog');return d.scrollWidth<=d.clientWidth+1 && document.documentElement.scrollWidth<=innerWidth"), true);
    await noJavascriptErrors(first); await noJavascriptErrors(second);
  } finally { await first.close(); await second.close(); }
});

test("Chrome personal reply lost acknowledgement never retries automatically and explicit reload reveals the saved reply", { timeout: 45000 }, async () => {
  resetFixture(); const page = await browser(375);
  try {
    await openPersonalRepliesBrowser(page); await page.click("#new-personal-reply"); fixture.loseQuickReplyAck = true;
    await fillPersonalReply(page, "Réponse sauvegardée", "Confirmation perdue");
    await waitUntil(() => page.execute("return document.querySelector('#personal-replies-status').textContent.includes('La confirmation manque') && document.querySelector('#personal-reply-save').disabled"), "uncertain save is explicit");
    assert.equal(fixture.quickReplyRequests.length, 1); assert.equal(fixture.quickReplies.version, "1"); assert.equal(fixture.sent.length, 0);
    assert.equal(await page.execute("return document.querySelector('#personal-reply-body').value"), "Confirmation perdue");
    await page.click("#reload-personal-replies"); await waitUntil(() => page.execute("return !document.querySelector('#personal-reply-save').disabled && document.querySelectorAll('[data-personal-quick-reply]').length===1"), "explicit reload observes the saved reply");
    assert.equal(fixture.quickReplyRequests.length, 1); assert.equal(fixture.quickReplies.replies.length, 1); assert.equal(fixture.sent.length, 0);
    await page.key("\uE00C"); assert.equal(await page.execute("return document.querySelector('#personal-reply-body').value"), "");
    const reads = fixture.quickReplyReads; await loaded(page, "/messages"); assert.equal(await page.execute("return document.querySelector('#open-quick-replies').hidden"), true);
    assert.equal(fixture.quickReplyReads, reads); await noJavascriptErrors(page);
  } finally { await page.close(); }
});
