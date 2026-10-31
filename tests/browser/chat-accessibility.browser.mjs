// Real Chrome DOM/keyboard smoke tests. All accounts, messages and images below
// are fictional; this server has no database, cookies, mail or external API.
// Run with Chrome + ChromeDriver installed. Missing binaries are a test failure.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { startWebDriver, tabUntil, waitUntil } from "./webdriver.mjs";
import { createConversationExporter } from "../../server/chat/conversation-export.mjs";
import preferencesCatalogue from "../../public/preferences-catalogue.json" with { type: "json" };

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
    profileEnabled: false, profileAvatarsEnabled: true, preferencesEnabled: false, preferenceRequests: [], preferences: {}, profileRequests: [], avatarRequests: [], avatarUploads: [], profiles: {
      client: { pseudonym: peerName, version: "1", avatarId: null }, admin: { pseudonym: "Jessie", version: "1", avatarId: null },
    } };
}
function releaseHeldSessions() {
  fixture.holdSessions = false;
  for (const release of fixture.sessionHolds?.splice(0) ?? []) release();
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
function galleryPhoto(role, seq) {
  const messageId = id(200 + seq), full = `/api/media/${role}/conversations/${conversationId}/messages/${messageId}`;
  return { messageId, sequence: String(seq), sender: "peer", createdAt: seq === 1 ? Date.UTC(2020,0,15,12) : fixture.now + seq * 1000,
    media: { ...media(role), fullUrl: `${full}/full`, thumbnailUrl: `${full}/thumb` } };
}
function message(sequence, role) {
  const sent = fixture.sent.find(message => message.sequence === String(sequence)); if (sent) return { ...sent };
  const number = Number(sequence);
  if (fixture.allPhotos) return { id: id(200 + number), sequence: String(number), sender: "peer", body: `Fictional photo ${number}`,
    createdAt: fixture.now + number * 1000, deletedAt: null, clientMessageId: null, media: galleryPhoto(role, number).media };
  if (fixture.deletedSequences?.includes(String(sequence))) return { id: id(200 + number), sequence: String(number), sender: number === 2 ? "me" : "peer", body: null, createdAt: fixture.now + number * 1000, deletedAt: fixture.now + 5000, clientMessageId: null };
  return { id: id(200 + number), sequence: String(number), sender: number === 2 || number === 3 && fixture.ownPhoto ? "me" : "peer",
    body: number === 1 ? "Earlier fictional message" : number === 2 ? fixture.longPhotoHistory ? "Fictional long history. ".repeat(120) : "Fictional message from me" : number === 3 ? fixture.photoWithoutCaption ? "" : "Fictional photo caption" : `Fictional incoming body ${number}`,
    createdAt: fixture.now + number * 1000, deletedAt: null, clientMessageId: null,
    ...(fixture.photoSeries && number === 1 ? { media: galleryPhoto(role,1).media } : number === 3 ? { media: media(role) } : {}) };
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
const fileNames = ["conversation-download.js", "quick-replies.js", "crm.js", "crm-model.js", "crm.css", "private-archive.js", "notification-link.js", "access.html", "access.js", "access.css", "admin-login.html", "admin-login.js", "admin-login.css", "admin-navigation.css", "i18n-access.js", "i18n-admin.js", "notifications.js", "notifications.css", "sw.js", "chat.html", "chat.js", "chat-model.js", "chat-drafts.js", "session-clock.js", "image-preparation.js", "photo-batch.js", "chat.css", "i18n.js", "help-link.js", "i18n.css", "i18n-chat.js", "i18n-tools.js",
  "emoji-catalog.js", "emoji.css", "profile.js", "profile.css", "i18n-profile.js", "profile-publication.js", "public-profile-model.js", "i18n-public-profile.js", "public-profile.css",
  "password-change.js", "recover-model.js", "password-fields.js", "password-fields.css", "preferences.js", "preferences-model.js", "preferences-catalogue.json", "preferences.css", "i18n-preferences.js", "manifest.webmanifest", "favicon.ico", "apple-touch-icon.png", "brand/brand.css",
  "brand/icon-16.png", "brand/icon-32.png", "brand/icon-48.png", "brand/icon-64.png", "brand/icon-128.png",
  "brand/icon-192.png", "brand/icon-512.png", "brand/icon-maskable-512.png"];
const contentTypes = { ".json": "application/json; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8",
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
        fixture.chatDocuments = (fixture.chatDocuments ?? 0) + 1;
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
        if (request.method === "GET") {
          fixture.quickReplyReads += 1;
          if (fixture.holdNextQuickReplyRead) {
            const held = fixture; held.holdNextQuickReplyRead = false;
            await new Promise(resolve => {
              const release = () => { response.off("close", release); if (held.releaseQuickReplyRead === release) held.releaseQuickReplyRead = null; resolve(); };
              held.releaseQuickReplyRead = release; response.once("close", release);
            });
            if (response.destroyed) return;
          }
          sendJson(200, { ...fixture.quickReplies, ...(fixture.quickRepliesWritable === false ? { writable: false } : {}) }); return;
        }
        if (request.method === "POST") {
          if (fixture.quickRepliesWritable === false) { sendJson(403, { error: "feature_read_only" }); return; }
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
        if (sessionRole && fixture.holdSessions) {
          await new Promise(resolveHeld => {
            const release = () => { response.off("close", release); resolveHeld(); };
            (fixture.sessionHolds ??= []).push(release); response.once("close", release);
          });
          if (response.destroyed) return;
        }
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
      const preferencesRoute = /^\/api\/profile\/(admin|client)\/preferences$/.exec(url.pathname);
      if (fixture.preferencesEnabled && preferencesRoute) {
        const role = preferencesRoute[1];
        const saved = fixture.preferences[role] ?? { version: "0", catalogueVersion: preferencesCatalogue.meta.version, selectedIds: [] };
        if (request.method === "POST") {
          let raw = ""; for await (const chunk of request) raw += chunk;
          const input = JSON.parse(raw); fixture.preferenceRequests.push({ role, ...input });
          assert.equal(request.headers["x-csrf-token"], fixture.csrf ?? "A".repeat(43));
          if (input.expectedVersion !== saved.version) { sendJson(409, { error: "preferences_changed" }); return; }
          fixture.preferences[role] = { version: String(Number(saved.version) + 1), catalogueVersion: input.catalogueVersion, selectedIds: input.selectedIds };
        }
        sendJson(200, fixture.preferences[role] ?? saved); return;
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
      const selectedRole = url.pathname.includes("/client/") ? "client" : "admin";
      if (fixture.photoBatch && request.method === "POST" && /^\/api\/media\/(admin|client)\/assets$/.test(url.pathname)) {
        let bytes = 0; for await (const chunk of request) bytes += chunk.length;
        assert.ok(bytes > 0); fixture.batchUploads = (fixture.batchUploads ?? 0) + 1;
        sendJson(201, { asset: { id: id(800 + fixture.batchUploads) }, duplicate: false }); return;
      }
      if (fixture.photoBatch && request.method === "POST" && url.pathname.endsWith(`/conversations/${conversationId}/messages/batch`)) {
        let raw = ""; for await (const chunk of request) raw += chunk;
        const body = JSON.parse(raw); assert.ok(body.messages.length <= 10);
        fixture.batchRequests ??= []; fixture.batchRequests.push(body.messages);
        let blocked = false;
        const results = body.messages.map((input,index) => {
          if (blocked) return { clientMessageId:input.clientMessageId, status:424, error:"photo_batch_waiting" };
          if (fixture.failBatchOnce && index === 1) { fixture.failBatchOnce = false; blocked = true; return { clientMessageId: input.clientMessageId, status:503, error:"media_unavailable" }; }
          let saved = fixture.sent.find(value => value.clientMessageId === input.clientMessageId), duplicate = Boolean(saved);
          if (!saved) { fixture.latest++; saved = { ...message(3, selectedRole), id: id(200 + fixture.latest), sequence: String(fixture.latest), sender:"me", body:input.caption, clientMessageId:input.clientMessageId }; fixture.sent.push(saved); }
          return { clientMessageId:input.clientMessageId, message:saved, duplicate };
        }); sendJson(200,{results}); return;
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
            ...(fixture.receivedEnabled && feature === "chat" && role === "admin" ? { inbox: { enabled: true } } : {}),
            ...(fixture.videoReadOnly && feature === "chat" ? { video: { enabled: true, creationEnabled: false, maxBytes: 104857600, mime: "video/mp4" } } : {}),
            ...(fixture.profileEnabled && feature === "chat" ? { profile: { enabled: true, avatars: fixture.profileAvatarsEnabled, preferencesEnabled: fixture.preferencesEnabled } } : {}),
            ...(fixture.clientExportEnabled && feature === "chat" && role === "client" ? { conversationExport: { enabled: true, photos: true, maxBytes: 32 * 1024 * 1024 } } : {}) }); return;
        }
        if (feature === "chat" && request.method === "GET") {
          if (suffix === "/inbox" && role === "admin" && fixture.receivedEnabled) {
            fixture.receivedReads = (fixture.receivedReads ?? 0) + 1;
            if (fixture.receivedFailure) { sendJson(503, { error: "messaging_unavailable" }); return; }
            const items = [3, 2, 1].map(n => ({ conversation: n === 3 ? conversation("admin") : { ...conversation("admin"), id: id(100+n), peerName: n === 2 ? "Read client" : "Other unread client", lastReadSequence: n === 2 ? "2" : "0" }, unread: n === 1,
              message: { ...message(n, "admin"), sender: n === 1 ? "peer" : "me", body: n === 3 ? "<b>Fictional sent photo</b>" : `Fictional conversation ${n}` } }));
            items.push({ conversation: { ...conversation("admin"), id: id(104), peerName: "New invited client", createdAt: fixture.now - 10000 }, message: null, unread: false });
            sendJson(200, { items, nextCursor: null, hasMore: false }); return;
          }
          if (suffix === "/conversation") { sendJson(200, { id: conversationId }); return; }
          if (suffix === "/conversations") { sendJson(200, { conversations: [conversation(role)], nextCursor: null, hasMore: false }); return; }
          if (suffix === `/conversations/${conversationId}/messages`) {
            if (fixture.windowedHistory) {
              (fixture.historyReads ??= []).push(url.search);
              const before = url.searchParams.get("before"), after = url.searchParams.get("after"), limit = Number(url.searchParams.get("limit") ?? 50);
              let rows = Array.from({ length: fixture.latest }, (_, i) => i + 1).filter(n => before === null || n < Number(before)).filter(n => after === null || n > Number(after));
              rows = after === null ? rows.slice(-limit) : rows.slice(0, limit);
              const hasMoreBefore = rows[0] > 1, hasMoreAfter = rows.at(-1) < fixture.latest;
              sendJson(200, { conversation: conversation(role), messages: rows.map(n => message(n, role)), eventCursor: String(fixture.latest),
                hasMoreBefore, nextBefore: hasMoreBefore ? String(rows[0]) : null, hasMoreAfter, nextAfter: hasMoreAfter ? String(rows.at(-1)) : null }); return;
            }
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
          if (fixture.allPhotos && new RegExp(`^/conversations/${conversationId}/messages/[a-f0-9]{32}/thumb$`).test(suffix)) {
            (fixture.thumbnailReads ??= []).push(suffix);
            response.writeHead(200, { "Content-Type": "image/jpeg" }); response.end(jpeg); return;
          }
          if (suffix === `/conversations/${conversationId}/gallery`) {
            fixture.galleryRequests ??= []; fixture.galleryRequests.push(url.search);
            if (fixture.photoNeighbor && (url.searchParams.has("before") || url.searchParams.has("after"))) {
              sendJson(200, { items: [fixture.photoNeighbor], nextBefore: null, hasMore: false }); return;
            }
            let items = fixture.photoSeries ? [galleryPhoto(role,3), galleryPhoto(role,1)] : [galleryPhoto(role,3)];
            if (url.searchParams.has("before")) items = items.filter(item => BigInt(item.sequence) < BigInt(url.searchParams.get("before")));
            if (url.searchParams.has("after")) items = items.filter(item => BigInt(item.sequence) > BigInt(url.searchParams.get("after"))).reverse();
            if (url.searchParams.has("from")) items = items.filter(item => item.createdAt >= Number(url.searchParams.get("from")));
            if (url.searchParams.has("until")) items = items.filter(item => item.createdAt < Number(url.searchParams.get("until")));
            const limit = Number(url.searchParams.get("limit") ?? 50); items = items.slice(0,limit);
            sendJson(200, { items, nextBefore: null, hasMore: false }); return;
          }
          if (suffix === "/assets") { sendJson(200, { assets: fixture.historyAcknowledgement ? [media(role)] : [], nextCursor: null, hasMore: false }); return; }
          if ([`/conversations/${conversationId}/messages/${photoMessageId}/thumb`, `/conversations/${conversationId}/messages/${photoMessageId}/full`, ...(fixture.photoSeries ? [`/conversations/${conversationId}/messages/${id(201)}/full`, `/conversations/${conversationId}/messages/${id(201)}/thumb`] : []), ...(fixture.photoNeighbor ? [`/conversations/${conversationId}/messages/${fixture.photoNeighbor.messageId}/full`] : [])].includes(suffix)) {
            if (suffix.endsWith("/full")) { fixture.photoNeighborReads ??= []; fixture.photoNeighborReads.push(suffix); }
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
async function visibleOptionsButtons(page) {
  return page.execute(`return ['open-account-menu','open-conversation-menu'].filter(id=>{
    const button=document.getElementById(id);return button&&!button.hidden&&!button.disabled&&button.getClientRects().length>0;
  })`);
}
async function captureOptions(page, name) {
  await page.executeAsync("const done=arguments[arguments.length-1];document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>done(true))))");
  const png = Buffer.from(await page.screenshot(), "base64");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const directory = new URL("../../artifacts/homepage/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL(`${name}.png`, directory), png);
}
async function clickOptionsAction(page, selector) {
  await openChatOptions(page);
  if (selector === ".conversation-download-entry" && !await page.execute("return document.querySelector('.menu-extras').open")) await page.click(".menu-extras summary");
  await page.click(selector);
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
  // A native inbox click returns before its asynchronous message page renders.
  await waitUntil(() => page.execute("return !!document.querySelector(arguments[0])", selector), "message details control loaded");
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
async function typeMultilineDraft(page, value) {
  const [first, ...lines] = value.split("\n");
  await page.type("#message-body", first);
  for (const line of lines) {
    await page.click("#insert-line-break");
    if (line) await page.append("#message-body", line);
  }
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
      if (role === "admin") await tabUntil(page, '#messages [data-sequence="2"] .delete-message');
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
        const input=document.getElementById('message-body'),style=getComputedStyle(input),context=document.createElement('canvas').getContext('2d');context.font=style.font;
        return {visibleDetails:[...document.querySelectorAll('#messages .message-meta')].filter(node=>node.getClientRects().length>0).length,
          selected:document.querySelectorAll('#messages .is-selected').length, gap:parseFloat(getComputedStyle(document.getElementById('messages')).rowGap),
          placeholderWidth:context.measureText(input.placeholder).width,
          placeholderRoom:input.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),
          placeholderFits:context.measureText(input.placeholder).width<=input.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)+1,
          bubbleHeight:bubble.getBoundingClientRect().height, placeholder:document.getElementById('message-body').placeholder};`);
      assert.equal(resting.visibleDetails, 0, `${context}: dates, receipts and deletion reserve no permanent row`);
      assert.equal(resting.selected, 0); assert.ok(resting.gap<=10, `${context}: compact message gap (${resting.gap}px)`);
      assert.ok(resting.bubbleHeight<=48, `${context}: one-line text bubble stays compact (${resting.bubbleHeight}px)`);
      assert.equal(resting.placeholder, role === "client" && language === "fr" ? "Écris-moi…" : "Message…");
      assert.equal(resting.placeholderFits, true, `${context}: the empty composer hint fits on one visible line (${resting.placeholderWidth}px in ${resting.placeholderRoom}px)`);

      await openMessageDetails(page, "2");
      const details = await page.execute(`const row=document.querySelector('#messages [data-sequence="2"]'),meta=row.querySelector('.message-meta'),toggle=row.querySelector('.message-details-toggle'),r=toggle.getBoundingClientRect();
        return {selected:document.querySelectorAll('#messages .is-selected').length,visible:!meta.hidden,controls:toggle.getAttribute('aria-controls')===meta.id,
          label:toggle.getAttribute('aria-label'),role:row.getAttribute('role'),width:r.width,height:r.height,below:meta.getBoundingClientRect().top>=row.querySelector('.bubble').getBoundingClientRect().bottom-1,
          receipt:meta.querySelector('span').textContent,deleteVisible:!!row.querySelector('.delete-message')?.getClientRects().length};`);
      assert.equal(details.selected, 1); assert.equal(details.visible && details.controls && details.below, true, context);
      assert.equal(details.deleteVisible, role === "admin", context);
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

test("Chrome mobile: a captionless photo keeps its enlarge action and a keyboard-only details control without an extra row", { timeout: 180000 }, async () => {
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
      assert.equal(resting.visible, false, `${context}: no redundant visible details control`);
      assert.ok(resting.extraHeight<=1, `${context}: the details control adds no vertical space`);
      await openMessageDetails(page, "3");
      assert.equal(await page.execute(`const row=document.querySelector('#messages [data-sequence="3"]');return row.classList.contains('is-selected') && !row.querySelector('.message-meta').hidden && !document.getElementById('lightbox').open && !document.getElementById('confirm-delete').open;`), true, context);
      assert.equal(await page.execute(`const button=document.querySelector('#messages [data-sequence="3"] .delete-message');return !!button && button.getClientRects().length>0;`), ownPhoto && role === "admin", `${context}: only the admin may delete their own messages`);
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

test("Chrome 320px: keyboard emoji panel inserts at the selection without photos or automatic sending, and Escape restores focus", { timeout: 60000 }, async () => {
  for (const role of ["client", "admin"]) {
    resetFixture(); fixture.mediaDisabled = true; const page = await browser(320);
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      if (role === "admin") await page.click(".contact");
      await waitUntil(() => page.execute("return !document.getElementById('open-emojis').disabled"), "emoji selector enabled without photos");
      await page.type("#message-body", "Hello friend");
      await page.execute("document.getElementById('message-body').setSelectionRange(6, 12)");
      await page.click("#open-emojis");
      await waitUntil(() => page.execute("return document.getElementById('emoji-dialog').matches(':modal') && document.activeElement.id === 'close-emojis'"), "native emoji panel and choice focus");
      await tabUntil(page, '#emoji-list [data-emoji-id="kiss-face"]');
      await page.key("\uE014"); assert.notEqual(await page.execute("return document.activeElement.dataset.emojiId"), "kiss-face");
      await page.key("\uE012"); assert.equal(await page.execute("return document.activeElement.dataset.emojiId"), "kiss-face");
      await page.key("\uE007");
      assert.equal(await page.execute("return document.getElementById('message-body').value"), "Hello 😘");
      assert.deepEqual(await page.execute("const t=document.getElementById('message-body');return [t.selectionStart,t.selectionEnd,document.activeElement.id]"), [8, 8, "open-emojis"]);
      assert.equal(fixture.messageRequests.length, 0);
      await page.click("#open-emojis"); await page.key("\uE00C");
      await waitUntil(() => page.execute("return !document.getElementById('emoji-dialog').open && document.activeElement.id === 'open-emojis'"), "Escape returns to the emoji opener");
      await page.click("#open-emojis");
      await page.execute("JessieI18n.setLanguage('en')");
      assert.equal(await page.execute("return document.getElementById('emoji-title').textContent"), "Emojis");
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
      assert.equal(await page.execute("return document.querySelector('[data-emoji-id=\"thumbs-up\"]').textContent"), "👍🏿");
      await page.click('[data-emoji-id="thumbs-up"]');
      assert.equal(await page.execute("return document.getElementById('message-body').value"), "Hello 👍🏿");
      assert.deepEqual(await page.execute("const t=document.getElementById('message-body');return [t.selectionStart,t.selectionEnd,document.activeElement.id]"), [10, 10, "open-emojis"]);
      assert.equal(fixture.messageRequests.length, 0);

      await page.click("#open-emojis");
      assert.equal(await page.execute("return document.getElementById('emoji-skin-tone').value"), "dark");
      await page.execute("JessieI18n.setLanguage('en')");
      const translated = await page.execute("const select=document.getElementById('emoji-skin-tone');return {value:select.value,label:document.querySelector('label[for=\"emoji-skin-tone\"] span').textContent,option:select.selectedOptions[0].textContent};");
      assert.equal(translated.value, "dark"); assert.equal(translated.label, "Skin tone"); assert.match(translated.option, /dark/i);
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
      assert.equal(await page.execute("return document.getElementById('message-body').placeholder"), "Message…");
      assert.equal(await page.execute("return document.getElementById('peer-name').textContent"), peerName);
      assert.deepEqual(await page.execute("const link=document.getElementById('account-link');return {href:link.getAttribute('href'),text:link.textContent,oldNav:!!document.getElementById('readiness-nav')};"), {href:"/admin",text:"Accueil admin",oldNav:false});
      assert.equal(await page.execute("return document.getElementById('message-announcement').textContent"), "", "loaded history is silent");
      await toggleChatLanguage(page);
      assert.equal(await page.execute("return document.documentElement.lang"), "en");
      assert.equal(await page.execute("return document.getElementById('message-body').placeholder"), "Message…");
      assert.equal(await page.execute("return document.getElementById('peer-name').textContent"), peerName, "private names are never translated");
      assert.deepEqual(await page.execute("const link=document.getElementById('account-link');return {href:link.getAttribute('href'),text:link.textContent};"), {href:"/admin",text:"Admin home"});
      await tabUntil(page, "#back-to-inbox"); await page.key("\uE007");
      assert.equal(await page.execute("return document.activeElement.dataset.conversationId"), conversationId, "return restores the contact recreated by the controller");
      assert.equal(await page.execute("return document.activeElement.querySelector('strong').textContent"), peerName);
      if (width === 320) assert.equal(await page.execute("return document.documentElement.scrollWidth <= window.innerWidth"), true, "no page overflow at 320px");
      await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome desktop and mobile: one Options button before selection, in conversation and after returning to the inbox", { timeout: 120000 }, async () => {
  for (const width of [1280, 320]) for (const role of ["client", "admin"]) {
    resetFixture(); const page = await browser(width);
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      if (role === "admin") {
        assert.deepEqual(await visibleOptionsButtons(page), ["open-account-menu"], `${width}px: Options is available before choosing a client`);
        await tabUntil(page, "#open-account-menu"); await page.key("\uE007");
        await waitUntil(() => page.execute("return !document.getElementById('chat-menu').hidden && document.activeElement.id==='close-chat-menu'"), "keyboard opens inbox Options");
        assert.deepEqual(await page.execute("const link=document.getElementById('account-link');return {href:link.getAttribute('href'),text:link.textContent,headerLinks:document.querySelectorAll('.topbar a[href=\"/admin\"],.chat-head a[href=\"/admin\"]').length}"), {href:"/admin",text:"Accueil admin",headerLinks:0});
        await page.key("\uE00C");
        assert.equal(await page.execute("return document.getElementById('chat-menu').hidden && document.activeElement.id==='open-account-menu'"), true);
        await captureOptions(page, `chat-options-${role}-${width}-inbox`);
        await tabUntil(page, ".contact"); await page.key("\uE007");
      }
      await loadedPhoto(page);
      assert.deepEqual(await visibleOptionsButtons(page), ["open-conversation-menu"], `${role}, ${width}px: only conversation Options is visible`);
      assert.equal(await page.execute("return document.querySelectorAll('#client-aside a[href=\"/access\"]').length"), 0);
      const requests = fixture.messageRequests.length, exports = fixture.exportRequests?.length ?? 0;
      await tabUntil(page, "#open-conversation-menu"); await page.key("\uE007");
      await waitUntil(() => page.execute("return !document.getElementById('chat-menu').hidden && document.activeElement.id==='close-chat-menu'"), "keyboard opens conversation Options");
      assert.deepEqual(await page.execute("const link=document.getElementById('account-link');return {href:link.getAttribute('href'),text:link.textContent,expanded:document.getElementById('open-conversation-menu').getAttribute('aria-expanded')};"), {href:role === "admin" ? "/admin" : "/access",text:role === "admin" ? "Accueil admin" : "Mon accès",expanded:"true"});
      assert.deepEqual(await page.execute("const button=document.querySelector('[data-jm-language]');return {text:button.textContent,target:button.getAttribute('data-jm-language-target'),label:button.getAttribute('aria-label')};"), {text:"",target:"en",label:"Passer en anglais"});
      await captureOptions(page, `chat-options-${role}-${width}-open`);
      await page.key("\uE00C");
      assert.equal(await page.execute("return document.getElementById('chat-menu').hidden && document.activeElement.id==='open-conversation-menu' && document.activeElement.getClientRects().length>0"), true, "Escape restores the sole visible opener");
      const target = await page.execute("const r=document.getElementById('open-conversation-menu').getBoundingClientRect();return {width:r.width,height:r.height}");
      assert.ok(target.width >= 44 && target.height >= 44, "the remaining button keeps its touch target");
      await captureOptions(page, `chat-options-${role}-${width}-conversation`);
      if (role === "admin") {
        await tabUntil(page, "#back-to-inbox"); await page.key("\uE007");
        assert.deepEqual(await visibleOptionsButtons(page), ["open-account-menu"], "returning to the inbox restores its only Options button");
      }
      assert.equal(fixture.messageRequests.length, requests);
      assert.equal(fixture.exportRequests?.length ?? 0, exports);
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
        assert.deepEqual(await visibleOptionsButtons(page), ["open-account-menu"], "the inbox exposes one Options button");
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
            controls:['open-conversation-menu','open-composer-tools','open-emojis','message-body','insert-line-break','send'].map(id=>{
              const node=document.getElementById(id),r=node.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
              return {id,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,reachable:hit===node||node.contains(hit)};
            })};
        `);
        const context = `${path}, ${width}x640, ${language}`;
        assert.equal(layout.width, width, context); assert.equal(layout.height, 640, context);
        assert.equal(layout.scrollWidth <= layout.width, true, `${context}: no horizontal page overflow`);
        assert.equal(layout.duplicateHeader, false, `${context}: the conversation has one header`);
        assert.deepEqual(await visibleOptionsButtons(page), ["open-conversation-menu"], `${context}: the conversation exposes one Options button`);
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
        const flag = await page.execute("const button=document.querySelector('[data-jm-language]'),style=getComputedStyle(button,'::before');return {text:button.textContent,target:button.getAttribute('data-jm-language-target'),label:button.getAttribute('aria-label'),width:style.width,height:style.height,image:style.backgroundImage};");
        assert.deepEqual({text:flag.text,target:flag.target,label:flag.label,width:flag.width,height:flag.height}, {text:"",target:language === "fr" ? "en" : "fr",label:language === "fr" ? "Passer en anglais" : "Switch to French",width:"24px",height:"16px"});
        assert.match(flag.image, /data:image\/svg\+xml/, `${context}: the language action has a real decorative flag`);
        assert.equal(await page.execute("return document.getElementById('chat-menu').getAttribute('role')"), null, "ordinary native controls do not masquerade as an ARIA menu");
        await page.click(".menu-extras summary");
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
      await typeMultilineDraft(page, 'A synthetic multiline draft\n'.repeat(8));
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
      await typeMultilineDraft(page, caption);
      assert.equal(fixture.messageRequests.length, 0, "the explicit newline command keeps the selected photo and multiline caption as a draft");
      await captureOptions(page, `photo-caption-short-${role}`);
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
      await waitUntil(() => page.execute("return document.querySelector('.profile-dialog').matches(':modal') && !document.querySelector('.profile-pseudonym').disabled && document.activeElement.matches('.profile-close')"), "touch profile loaded without opening the name keyboard");
      await tabUntil(page, ".profile-pseudonym");
      assert.equal(await page.execute("return document.activeElement.matches('.profile-pseudonym')"), true, "the name remains reachable through explicit keyboard navigation");
      assert.equal(await page.execute("return document.querySelector('.profile-header h2').textContent"), "Mon profil");
      assert.deepEqual(await page.execute("const file=document.querySelector('.profile-file');return {button:document.querySelector('.profile-choose-avatar').textContent,hidden:file.hidden,accept:file.accept,label:file.getAttribute('aria-label')};"), {button:"Choisir ou remplacer l’avatar",hidden:true,accept:"image/jpeg,image/png,image/webp",label:"Choisir ou remplacer l’avatar"});
      assert.equal(await page.execute("return document.querySelector('.profile-avatar-preview img').hidden"), true);
      await page.type(".profile-pseudonym", "Envoyer");
      await page.execute("JessieI18n.setLanguage('en')");
      assert.equal(await page.execute("return document.querySelector('.profile-header h2').textContent"), "My profile");
      assert.equal(await page.execute("return document.querySelector('.profile-save').textContent"), "Save profile");
      assert.deepEqual(await page.execute("return {button:document.querySelector('.profile-choose-avatar').textContent,label:document.querySelector('.profile-file').getAttribute('aria-label')};"), {button:"Choose or replace your avatar",label:"Choose or replace your avatar"});
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
      for (const language of ["fr", "en", "fr"]) {
        await page.execute("JessieI18n.setLanguage(arguments[0])", language);
        assert.deepEqual(await page.execute("return {title:document.querySelector('.profile-header h2').textContent,button:document.querySelector('.profile-choose-avatar').textContent,name:document.querySelector('.profile-pseudonym').value};"), {title:language === "fr" ? "Mon profil" : "My profile",button:language === "fr" ? "Choisir ou remplacer l’avatar" : "Choose or replace your avatar",name:nextName});
        assert.equal(fixture.profileRequests.length, 1); assert.equal(fixture.avatarUploads.length, 0); assert.equal(fixture.messageRequests.length, 0);
      }
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
      assert.equal(await page.execute("return !document.querySelector('.profile-dialog').open && document.querySelector('.profile-pseudonym').value==='Unsaved private profile draft' && !document.querySelector('.profile-avatar-preview img').getAttribute('src')"), true, "controlled hiding retains the in-memory draft and revokes its visible preview");
      assert.equal(await page.execute("return window.__revokedBlobUrls.includes(arguments[0])", discardedPreview), true, "discarded preview's actual object URL is revoked");
      assert.equal(fixture.profileRequests.length, 0); assert.equal(fixture.avatarUploads.length, 0);
      await page.execute("window.__profileHidden=false;document.dispatchEvent(new Event('visibilitychange'))");
      await waitUntil(() => page.execute("return !document.getElementById('workspace').hidden"), "same-session chat resumes after controlled visibility");
      await waitUntil(() => page.execute("return document.querySelector('.profile-dialog').matches(':modal') && document.querySelector('.profile-pseudonym').value==='Unsaved private profile draft'"), "same-owner revalidation restores the open draft");
      await page.click(".profile-close"); await clickOptionsAction(page, "#open-profile");
      await waitUntil(() => page.execute("return document.querySelector('.profile-dialog').matches(':modal') && document.querySelector('.profile-pseudonym').value===arguments[0]", originalName), "explicitly closing discards the unsaved profile draft");
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
    assert.deepEqual(persistence, { cacheKeys: [], registrations: 0, localKeys: [], sessionKeys: [] }, "viewing private photos alone creates no cache, worker or stored media state");
    assert.equal(await page.execute("return document.documentElement.scrollWidth <= window.innerWidth"), true);
    await noJavascriptErrors(page);
  } finally { await page.close(); }
});


test("Chrome mobile: deleting a message has a keyboard-accessible confirmation with safe cancellation", { timeout: 30000 }, async () => {
  resetFixture(); const page = await browser(390);
  try {
    await loaded(page, "/admin/messages"); await page.click(".contact");
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
  await openChatOptions(page); await page.click(".menu-extras summary"); await tabUntil(page, ".conversation-download-entry"); await page.key("\uE007");
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
      assert.equal(await page.execute("return document.activeElement.id"), width < 800 ? "open-composer-tools" : "message-body"); assert.equal(fixture.sent.length, 0, "insertion never sends");
      assert.match(await page.execute("return document.querySelector('#chat-status').textContent"), language === "fr" ? /ajoutée au brouillon/ : /added to your draft/);
      await page.append("#message-body", " Edited"); await page.click("#send");
      await waitUntil(() => fixture.sent.length === 1, "explicit ordinary send");
      assert.equal(fixture.sent[0].body, expected + " Edited");
      await waitUntil(() => page.execute("return document.querySelector('#message-body').value === ''"), "ordinary acknowledgement clears sent draft");
      await noJavascriptErrors(page);
    } finally { await page.close(); }
  });
}

test("Chrome: clients have no quick replies; Escape, full drafts and returning to the inbox never send", { timeout: 35000 }, async () => {
  resetFixture(); fixture.holdInitialAdminMessages = true; fixture.holdNextQuickReplyRead = true; const page = await browser(320);
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
    await page.type("#message-body", "Unsent draft"); await clickComposerAction(page, "#open-quick-replies");
    await waitUntil(() => Boolean(fixture.releaseQuickReplyRead), "personal catalogue GET held while presets are usable");
    await page.execute("window.__heldQuickReplyPresets=[...document.querySelectorAll('#quick-replies-list [data-quick-reply]')];document.querySelector('[data-quick-reply=thanks]').focus()");
    fixture.releaseQuickReplyRead();
    await waitUntil(() => page.execute("return !document.querySelector('#new-personal-reply').disabled"), "held personal catalogue response applied");
    assert.equal(await page.execute("const current=[...document.querySelectorAll('#quick-replies-list [data-quick-reply]')];return current.length===6 && current.every((node,index)=>node===window.__heldQuickReplyPresets[index]) && document.activeElement===current.find(node=>node.dataset.quickReply==='thanks')"), true);
    await page.key("\uE00C");
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
  } finally { fixture.releaseInitialAdminMessages?.(); fixture.releaseQuickReplyRead?.(); await page.close(); }
});

async function openPersonalRepliesBrowser(page, language = "fr") {
  await loaded(page, "/admin/messages"); await page.click(".contact");
  await waitUntil(() => page.execute("const reply=document.querySelector('#open-quick-replies'),body=document.querySelector('#message-body');return !reply.hidden&&!reply.disabled&&!body.disabled&&!body.readOnly&&body.getClientRects().length>0"), "quick replies and the editable message field are ready in the selected conversation");
  if (language === "en") await toggleChatLanguage(page);
  await clickComposerAction(page, "#open-quick-replies");
  await waitUntil(() => page.execute("return !document.querySelector('#new-personal-reply').disabled"), "personal catalogue loaded");
}
async function fillPersonalReply(page, title, body) {
  await page.type("#personal-reply-title", title); await page.type("#personal-reply-body", body); await page.click("#personal-reply-save");
}
for (const [width, language] of [[320, "fr"], [1280, "en"]]) test(`Chrome ${width}px ${language}: personal replies join the preset list, persist between sessions and CAS conflicts preserve both catalogue and draft`, { timeout: 90000 }, async () => {
  resetFixture(); const first = await browser(width), second = await browser(width);
  try {
    await openPersonalRepliesBrowser(first, language);
    await first.click("#new-personal-reply"); await fillPersonalReply(first, "Envoyer", "Mes photos <b>texte personnel</b>");
    await waitUntil(() => fixture.quickReplies.version === "1" && first.execute("return document.querySelector('#personal-reply-editor').hidden"), "first personal reply saved");
    const replyId = fixture.quickReplies.replies[0].id;
    assert.equal(await first.execute(`const list=document.querySelector('#quick-replies-list'),row=document.querySelector('[data-personal-id="${replyId}"]');
      return document.querySelectorAll('.quick-replies-list').length===1 && list.querySelectorAll('[data-quick-reply]').length===6
        && list.querySelectorAll('.quick-reply').length===7 && row?.parentElement===list
        && document.querySelector('#personal-replies-title')===null && document.querySelector('#personal-replies-list')===null
        && [...list.querySelectorAll('[data-quick-reply]')].every(button=>button.tagName==='BUTTON'&&!button.querySelector('[data-personal-action]'));`), true);
    await first.click("#quick-reply-language"); await first.key(language === "fr" ? "\uE015" : "\uE013"); await first.key("\uE007");
    const otherLanguage = language === "fr" ? "en" : "fr";
    await waitUntil(() => first.execute("return document.querySelector('#quick-reply-language').value===arguments[0]", otherLanguage), "common catalogue changes phrase language");
    assert.equal(await first.execute("return document.querySelectorAll('#quick-replies-list [data-quick-reply]').length===6 && document.querySelectorAll('#quick-replies-list [data-personal-id]').length===0"), true);
    await first.click("#quick-reply-language"); await first.key(language === "fr" ? "\uE013" : "\uE015"); await first.key("\uE007");
    await waitUntil(() => first.execute(`return document.querySelector('#quick-replies-list [data-personal-id="${replyId}"]')!==null`), "saved phrase returns to the same list in its language");
    assert.equal(fixture.quickReplyRequests.length, 1); assert.equal(fixture.sent.length, 0);
    await openPersonalRepliesBrowser(second, language);
    assert.equal(await second.execute(`return document.querySelector('[data-personal-id="${replyId}"]').getAttribute('aria-label')`), "Envoyer");
    assert.equal(await second.execute(`return document.querySelector('[data-personal-id="${replyId}"] .personal-reply-insert').textContent`), "Mes photos <b>texte personnel</b>");
    assert.equal(await second.execute("return document.querySelectorAll('#quick-replies-list b').length"), 0);
    assert.equal(await second.execute(`const row=document.querySelector('[data-personal-id="${replyId}"]');return row.getAttribute('role')==='group' && row.querySelector('strong')===null && row.querySelector('.personal-reply-insert').children.length===0;`), true);
    await second.click(`[data-personal-id="${replyId}"] [data-personal-action="edit"]`);
    await second.type("#personal-reply-title", "Mon titre"); await second.type("#personal-reply-body", "Brouillon conservé");
    await first.click("#new-personal-reply"); await fillPersonalReply(first, "Autre réponse", "À conserver depuis la première session");
    await waitUntil(() => fixture.quickReplies.version === "2", "other session adds a reply");
    await second.click("#personal-reply-save");
    const conflictText = language === "fr" ? "Les réponses ont changé ailleurs. Ton brouillon est conservé. Recharge la liste avant de réessayer." : "Replies changed elsewhere. Your draft is preserved. Reload the list before trying again.";
    await waitUntil(() => second.execute("return document.querySelector('#personal-reply-save').disabled && document.querySelector('#personal-replies-status').textContent===arguments[0]", conflictText), "the completed conflict response blocks another mutation");
    assert.equal(fixture.quickReplyRequests.length, 3); assert.equal(await second.execute("return document.querySelector('#personal-reply-body').value"), "Brouillon conservé");
    assert.match(await second.execute("return document.querySelector('#personal-replies-status').textContent"), language === "fr" ? /changé ailleurs/ : /changed elsewhere/);
    await second.click("#reload-personal-replies");
    await waitUntil(() => second.execute("return !document.querySelector('#personal-reply-save').disabled"), "explicit reload adopts the current catalogue version");
    assert.equal(await second.execute("return document.querySelector('#personal-reply-body').value"), "Brouillon conservé"); assert.equal(fixture.quickReplyRequests.length, 3);
    await second.click("#personal-reply-save"); await waitUntil(() => fixture.quickReplies.version === "3", "explicit save keeps the concurrent addition");
    assert.equal(fixture.quickReplies.replies.length, 2); assert.equal(fixture.quickReplies.replies.find(reply => reply.id === replyId).body, "Brouillon conservé");
    await waitUntil(() => second.execute("return document.querySelector('#personal-reply-editor').hidden"), "editor cleared after acknowledgement");
    await second.execute("document.querySelector('#message-body').value='Personal draft'"); await tabUntil(second, `[data-personal-quick-reply="${replyId}"]`); await second.key("\uE007");
    assert.equal(await second.execute("return document.querySelector('#message-body').value"), "Personal draft\nBrouillon conservé"); assert.equal(fixture.sent.length, 0);
    await first.click("#close-quick-replies"); await clickComposerAction(first, "#open-quick-replies");
    await waitUntil(() => first.execute(`return document.querySelector('[data-personal-id="${replyId}"] .personal-reply-insert')?.textContent==='Brouillon conservé'`), "reopening refreshes personal replies");
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

test("Chrome compatibility hides new video and reply editing while preserving gallery access and saved reply insertion", { timeout: 35000 }, async () => {
  resetFixture(); fixture.quickRepliesWritable = false; fixture.videoReadOnly = true;
  fixture.quickReplies = { version: "1", replies: [{ id: id(991), title: "Saved private reply", body: "Existing personal text", language: "fr" }] };
  const page = await browser(375);
  try {
    await loaded(page, "/admin/messages"); await page.click(".contact");
    await waitUntil(() => page.execute("return !document.querySelector('#open-quick-replies').hidden&&!document.querySelector('#open-quick-replies').disabled"), "compatibility conversation ready");
    assert.equal(await page.execute("return document.querySelector('#pick-video').hidden && !document.querySelector('#open-video-gallery').hidden"), true);
    await page.type("#message-body", "Draft"); await clickComposerAction(page, "#open-quick-replies");
    await waitUntil(() => page.execute("return document.querySelectorAll('[data-personal-quick-reply]').length===1"), "saved read-only replies loaded");
    assert.equal(await page.execute("return document.querySelector('#new-personal-reply').hidden&&document.querySelector('#personal-reply-editor').hidden&&document.querySelector('.personal-reply-actions:not([hidden]) [data-personal-action]')===null"), true);
    await page.click('[data-personal-quick-reply]'); assert.equal(await page.execute("return document.querySelector('#message-body').value"), "Draft\nExisting personal text");
    assert.equal(fixture.quickReplyRequests.length, 0); assert.equal(fixture.sent.length, 0); await noJavascriptErrors(page);
  } finally { await page.close(); }
});

async function reloadDraftDocument(page) {
  // The ordinary leave-warning is qualified separately. Explicitly leave this
  // fixture, then perform a real reload in the same Chrome tab and origin.
  await page.execute("window.__draftReloadMarker = 'old-document'; window.dispatchEvent(new Event('pagehide')); setTimeout(() => location.reload(), 0); return true;");
  await waitUntil(() => page.execute("return window.__draftReloadMarker !== 'old-document' && document.getElementById('workspace')?.hidden === false"), "new Chrome document with a freshly authorized workspace");
}

test("Chrome: real same-tab reload restores only the authorized text draft and a changed session purges it", { timeout: 90000 }, async () => {
  for (const role of ["client", "admin"]) {
    resetFixture(); const page = await browser(375);
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      if (role === "admin") { await page.click(".contact"); await waitUntil(() => page.execute("return !document.querySelector('#message-body').disabled"), "selected admin conversation"); }
      const text = `Native ${role} draft with accents é and a second line`;
      await page.type("#message-body", text);
      const saved = await page.execute("const keys=Object.keys(sessionStorage).filter(k=>k.startsWith('jessiemessage.chat-drafts.'));return {keys,record:JSON.parse(sessionStorage.getItem(keys[0])),localKeys:Object.keys(localStorage)}");
      assert.deepEqual(saved.keys, [`jessiemessage.chat-drafts.v1.${role}`]); assert.deepEqual(saved.localKeys, []);
      assert.deepEqual(Object.keys(saved.record).sort(), ["entries", "id", "role", "selected", "sessionTag", "version"]);
      assert.match(saved.record.sessionTag, /^[a-f0-9]{64}$/); assert.equal(JSON.stringify(saved.record).includes("A".repeat(43)), false);
      assert.equal(saved.record.entries[0].text, text); assert.equal(saved.record.entries[0].pending, null);
      await reloadDraftDocument(page);
      await waitUntil(() => page.execute("return document.querySelector('#message-body').value === arguments[0]", text), "native sessionStorage text recovery after reload");
      assert.equal(fixture.messageRequests.length, 0, "restoring text never submits a message");
      fixture.csrf = "B".repeat(43); await reloadDraftDocument(page);
      assert.equal(await page.execute("return document.querySelector('#message-body').value"), "");
      assert.equal(await page.execute("return Object.values(sessionStorage).some(value=>value.includes(arguments[0]))", text), false);
      assert.equal(fixture.messageRequests.length, 0); await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome: an uncertain text survives a real reload with its exact retry key and no automatic POST", { timeout: 60000 }, async () => {
  resetFixture(); fixture.failNextSend = true; const page = await browser(375);
  try {
    await loaded(page, "/messages"); await page.type("#message-body", "Native uncertain synthetic text"); await page.click("#send");
    await waitUntil(() => fixture.messageRequests.length === 1 && page.execute("return !document.querySelector('#pending-controls').hidden"), "uncertain original text send");
    const exact = { ...fixture.messageRequests[0] }; assert.equal(fixture.sent.length, 0);
    await reloadDraftDocument(page);
    assert.equal(fixture.messageRequests.length, 1); assert.equal(fixture.sent.length, 0);
    assert.equal(await page.execute("return !document.querySelector('#pending-controls').hidden && document.querySelector('#message-body').disabled"), true);
    await page.click("#retry-send"); await waitUntil(() => fixture.sent.length === 1, "explicit retry of the same immutable text");
    assert.equal(fixture.messageRequests.length, 2); assert.deepEqual(fixture.messageRequests[1], exact);
    await waitUntil(() => page.execute("return document.querySelector('#message-body').value === ''"), "acknowledged text cleared");
    assert.equal(await page.execute("return JSON.parse(sessionStorage.getItem('jessiemessage.chat-drafts.v1.client')).entries.length"), 0);
    await reloadDraftDocument(page); assert.equal(fixture.messageRequests.length, 2);
    assert.equal(await page.execute("return document.querySelector('#message-body').value"), ""); await noJavascriptErrors(page);
  } finally { await page.close(); }
});


test("Chrome: client tombstones are absent from the actual DOM while admin history retains them", { timeout: 45000 }, async () => {
  for (const role of ["client", "admin"]) {
    resetFixture(); fixture.deletedSequences = ["1", "3"]; const page = await browser(390);
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      if (role === "admin") await page.click(".contact");
      await waitUntil(() => page.execute("return !!document.querySelector('#messages [data-sequence=\"2\"]')"), "live history rendered");
      const snapshot = () => page.execute(`return { sequences:[...document.querySelectorAll('#messages .message')].map(node=>node.dataset.sequence), deleted:document.querySelectorAll('#messages .deleted').length, text:document.getElementById('messages').textContent, deletes:document.querySelectorAll('#messages .delete-message').length };`);
      const initial = await snapshot();
      assert.deepEqual(initial.sequences, role === "admin" ? ["2", "3"] : ["2"], "the initial fixture page contains only sequences 2 and 3");
      assert.equal(initial.deleted, role === "admin" ? 1 : 0); assert.equal(initial.deletes, role === "admin" ? 1 : 0);
      if (role === "client") assert.doesNotMatch(initial.text, /Message supprimé|Message deleted/);
      await tabUntil(page, "#older-messages"); await page.key("\uE007");
      await waitUntil(() => page.execute("return document.getElementById('older-messages').hidden"), "the older tombstone page has been consumed");
      const older = await snapshot();
      assert.deepEqual(older.sequences, role === "admin" ? ["1", "2", "3"] : ["2"], "pagination preserves tombstones for admin and omits them for client");
      assert.equal(new Set(older.sequences).size, older.sequences.length, "pagination never duplicates a rendered message");
      assert.equal(older.deleted, role === "admin" ? 2 : 0); assert.equal(older.deletes, role === "admin" ? 1 : 0);
      if (role === "client") assert.doesNotMatch(older.text, /Message supprimé|Message deleted/);
      assert.equal(fixture.deleteRequests, 0); assert.equal(fixture.messageRequests.length, 0); await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome: synthetic coarse-pointer focus policy keeps keyboards closed after send, profile and emoji panels", { timeout: 60000 }, async () => {
  resetFixture(); fixture.profileEnabled = true; const page = await browser(390);
  try {
    await loaded(page, "/messages");
    await waitUntil(() => page.execute("return !document.getElementById('open-profile').hidden"), "profile control mounted");
    await page.execute(`const original=window.matchMedia.bind(window);window.matchMedia=query=>query==='(any-pointer: coarse)'?{matches:true}:original(query);`);
    await page.type("#message-body", "Synthetic touch message"); await page.click("#send");
    await waitUntil(() => page.execute("return document.getElementById('message-body').value==='' && !document.getElementById('message-body').disabled"), "send acknowledged");
    assert.equal(await page.execute("return document.activeElement.id==='message-body'"), false);
    await clickOptionsAction(page, "#open-profile");
    await waitUntil(() => page.execute("return !!document.querySelector('.profile-dialog[open]') && !document.querySelector('.profile-pseudonym').disabled"), "profile loaded");
    assert.equal(await page.execute("return document.activeElement.classList.contains('profile-close')"), true);
    await page.type(".profile-pseudonym", "Edited touch name"); await page.click(".profile-save");
    await waitUntil(() => page.execute("return !document.querySelector('.profile-dialog').open"), "profile saved and closed");
    assert.equal(await page.execute("return document.activeElement.matches('input,textarea')"), false);
    await page.click("#open-emojis");
    assert.equal(await page.execute("return document.getElementById('emoji-search')===null && document.activeElement.id==='close-emojis'"), true);
    await page.click('[data-emoji-id="kiss-face"]');
    assert.equal(await page.execute("return document.getElementById('message-body').value==='😘' && document.activeElement.id==='open-emojis'"), true);
    assert.equal(fixture.messageRequests.length, 1); await noJavascriptErrors(page);
  } finally { await page.close(); }
});


test("Chrome photo viewer crosses unloaded history, preserves scroll and finds an old month/message", { timeout: 45000 }, async () => {
  for (const role of ["client","admin"]) {
    resetFixture(); fixture.photoSeries = true; fixture.longPhotoHistory = true; const page = await browser(role === "client" ? 360 : 1280);
    try {
      await loaded(page, role === "client" ? "/messages" : "/admin/messages"); if (role === "admin") await page.click(".contact"); await loadedPhoto(page);
      assert.equal(await page.execute("return !!document.querySelector('#messages [data-sequence=\"1\"]')"),false);
      const scroll = await page.execute("const h=document.getElementById('message-scroll');h.scrollTop=h.scrollHeight;return h.scrollTop");
      // Retain only synthetic full-photo source paths, tied to the actual Blob
      // decoded by the viewer. Object URLs themselves conceal the message id.
      await page.execute(`window.__photoOriginalSources={};const sources=new WeakMap(),nativeBlob=Response.prototype.blob,nativeCreate=URL.createObjectURL.bind(URL);
        Response.prototype.blob=async function(){const blob=await nativeBlob.call(this);if(this.url){const path=new URL(this.url).pathname;if(/^\\/api\\/media\\/(?:client|admin)\\/conversations\\/[a-f0-9]{32}\\/messages\\/[a-f0-9]{32}\\/full$/.test(path))sources.set(blob,path);}return blob;};
        URL.createObjectURL=blob=>{const url=nativeCreate(blob),source=sources.get(blob);if(source)window.__photoOriginalSources[url]=source;return url;};`);
      await page.click("#messages .photo-open");
      await waitUntil(()=>page.execute("return document.getElementById('lightbox').open && !!document.querySelector('#lightbox-image img')"),"photo opens");
      if (role === "client") {
        await page.execute(`const surface=document.getElementById('lightbox-image');
          window.__photoTouchProbe={events:[],touchAction:getComputedStyle(surface).touchAction,scale:visualViewport.scale};
          for(const type of ['touchstart','touchend','touchcancel'])surface.addEventListener(type,event=>{
            const point=event.changedTouches[0];window.__photoTouchProbe.events.push({type,touches:event.touches.length,x:point?.clientX,y:point?.clientY});
          },{passive:true});`);
        // Start within the image surface, away from Chrome's edge-back gesture.
        const rect = await page.execute("const r=document.getElementById('lightbox-image').getBoundingClientRect();return {x:Math.round(r.x+r.width*.25),y:Math.round(r.y+r.height/2),endX:Math.round(r.x+r.width*.75)}");
        await page.execute("window.__photoTouchBounds=arguments[0]",rect);
        await page.swipe(rect.x,rect.y,rect.endX,rect.y);
        const probe=await page.execute("return window.__photoTouchProbe");
        assert.ok(probe.touchAction.split(' ').includes('pan-y')&&probe.touchAction.split(' ').includes('pinch-zoom'),"the viewer retains vertical scrolling and native pinch zoom");
        assert.ok(probe.events.some(event=>event.type==='touchstart'),`viewer receives native touch start: ${JSON.stringify(probe)}`);
        assert.ok(probe.events.some(event=>event.type==='touchend'),`horizontal swipe reaches its native end: ${JSON.stringify(probe)}`);
        assert.equal(probe.events.some(event=>event.type==='touchcancel'),false,`horizontal gesture belongs to the viewer: ${JSON.stringify(probe)}`);
      } else await page.click("#previous-photo");
      try { await waitUntil(()=>page.execute("return document.getElementById('lightbox-status').textContent.includes('2020')"),"older photo outside loaded messages"); }
      catch { const probe=await page.execute("return {touch:window.__photoTouchProbe??null,status:document.getElementById('lightbox-status')?.textContent??null}"); assert.fail(`older photo navigation: ${JSON.stringify({role,...probe,cursors:fixture.galleryRequests??[]})}`); }
      assert.ok(fixture.galleryRequests.some(query=>new URLSearchParams(query).get('before')==='3'),"the native previous-photo gesture requests the original message cursor");
      await waitUntil(()=>page.execute("const image=document.querySelector('#lightbox-image img');return !!image&&image.complete&&image.naturalWidth>0&&window.__photoOriginalSources[image.src]===arguments[0]",`/api/media/${role}/conversations/${conversationId}/messages/${id(201)}/full`),"the decoded older image comes from its exact authorized message");
      if(role==='admin')assert.equal(await page.execute("return document.activeElement.id"),'previous-photo','asynchronous navigation restores its temporarily disabled control');
      await page.execute(`window.__photoKeyProbe={focused:document.activeElement.id,events:[]};document.addEventListener('keydown',event=>window.__photoKeyProbe.events.push({key:event.key,target:event.target.id,inDialog:document.getElementById('lightbox').contains(event.target)}));`);
      await page.key("\uE014");
      await waitUntil(()=>page.execute("return !document.getElementById('lightbox-status').textContent.includes('2020')"),"keyboard moves to newer photo");
      assert.ok(fixture.galleryRequests.some(query=>new URLSearchParams(query).get('after')==='1'),'ArrowRight requests the displayed older message cursor');
      await waitUntil(()=>page.execute("const image=document.querySelector('#lightbox-image img');return !!image&&image.complete&&image.naturalWidth>0&&window.__photoOriginalSources[image.src]===arguments[0]",`/api/media/${role}/conversations/${conversationId}/messages/${id(203)}/full`),"the decoded newer image comes from its exact authorized message");
      await page.key("\uE00C");
      assert.equal(await page.execute("return document.getElementById('message-scroll').scrollTop"),scroll);
      await clickOptionsAction(page,"#open-gallery");
      await page.execute("const input=document.getElementById('media-month');input.value='2020-01';input.dispatchEvent(new Event('change',{bubbles:true}))");
      await waitUntil(()=>page.execute("return document.querySelectorAll('#media-grid .media-card').length===1 && document.getElementById('media-grid').textContent.includes('2020')"),"old month is queried from full history");
      assert.ok(fixture.galleryRequests.some(value=>value.includes("from=")&&value.includes("until=")));
      await page.click("#media-grid .photo-open");await page.click("#photo-message");
      await waitUntil(()=>page.execute("const row=document.querySelector('#messages [data-sequence=\"1\"]');return !!row&&row.classList.contains('notification-target')&&document.activeElement===row"),"message origin loaded and highlighted");
      await noJavascriptErrors(page);
    } catch(error) {
      // This fixture contains only fictional accounts and generated solid JPEGs.
      // Capture the rendered state and bounded event metadata for native CI.
      try {
        const directory=new URL('../../artifacts/homepage/',import.meta.url);await mkdir(directory,{recursive:true});
        await writeFile(new URL('debug190-gallery.png',directory),Buffer.from(await page.screenshot(),'base64'));
        const probe=await page.execute("return {touch:window.__photoTouchProbe??null,bounds:window.__photoTouchBounds??null,keyboard:window.__photoKeyProbe??null,active:document.activeElement?.id??null,status:document.getElementById('lightbox-status')?.textContent??null}");
        await writeFile(new URL('debug190-gallery.json',directory),JSON.stringify({role,...probe,cursors:fixture.galleryRequests??[]},null,2)+'\n');
      } catch {}
      throw error;
    } finally { await page.close(); }
  }
});
test("Chrome multiple photos preview before one send and retry only a failed item", { timeout: 45000 }, async () => {
  for (const role of ["client","admin"]) {
    resetFixture();fixture.photoBatch=true;fixture.failBatchOnce=true;const page=await browser(360);
    try {
      await loaded(page,role === "client" ? "/messages" : "/admin/messages");if(role === "admin")await page.click(".contact");
      await loadedPhoto(page); // The inbox can be ready before the selected conversation is loaded.
      await page.execute(`const data=new DataTransfer();const bytes=Uint8Array.from(atob(arguments[0]),c=>c.charCodeAt(0));for(let i=0;i<5;i++)data.items.add(new File([bytes], 'fixture-'+i+'.jpg',{type:'image/jpeg'}));const input=document.getElementById('image-file');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));`,jpeg.toString("base64"));
      await waitUntil(()=>page.execute("return document.querySelectorAll('.photo-batch-item').length===5"),"five previews");
      assert.equal(fixture.batchUploads??0,0);assert.equal(fixture.sent.length,0);
      await page.click(".photo-batch-item:nth-child(2) button");
      assert.equal(await page.execute("return document.querySelectorAll('.photo-batch-item').length"),4);
      await page.click("#send");await waitUntil(()=>page.execute("return !document.getElementById('send').disabled && document.getElementById('send').textContent.includes('restantes')"),"partial result allows retry");
      assert.equal(fixture.sent.length,1);assert.equal(fixture.batchUploads,4);
      await page.click("#send");await waitUntil(()=>page.execute("return document.getElementById('photo-batch').hidden"),"failed item retried");
      assert.equal(fixture.sent.length,4);assert.equal(fixture.batchUploads,4);assert.deepEqual(fixture.batchRequests.map(items=>items.length),[4,3]);
      await noJavascriptErrors(page);
    } finally {await page.close();}
  }
});

test("Chrome photo viewer keeps native pinch zoom and unrestricted pan permission while zoomed", { timeout:30000 }, async()=>{
  resetFixture();fixture.photoSeries=true;const page=await browser(360);
  try {
    await loaded(page,'/messages');await loadedPhoto(page);await page.click('#messages .photo-open');
    await waitUntil(()=>page.execute("const image=document.querySelector('#lightbox-image img');return document.getElementById('lightbox').open&&!!image&&image.complete&&image.naturalWidth>0"),'full photo decoded before native pinch');
    const bounds=await page.execute("const r=document.getElementById('lightbox-image').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),spread:Math.round(r.width*.32)}");
    const before=fixture.galleryRequests?.length??0;
    await page.pinch(bounds.x,bounds.y,35,bounds.spread);
    await waitUntil(()=>page.execute("return visualViewport.scale>1.01&&getComputedStyle(document.getElementById('lightbox-image')).touchAction==='auto'"),'native pinch zoom keeps unrestricted image panning');
    assert.equal(fixture.galleryRequests?.length??0,before,'native pinch never navigates to another photo');
    await noJavascriptErrors(page);
  } catch(error) {
    try {
      const directory=new URL('../../artifacts/homepage/',import.meta.url);await mkdir(directory,{recursive:true});
      await writeFile(new URL('debug190-gallery-zoom.png',directory),Buffer.from(await page.screenshot(),'base64'));
      const viewport=await page.execute("return {scale:visualViewport.scale,touchAction:getComputedStyle(document.getElementById('lightbox-image')).touchAction}");
      await writeFile(new URL('debug190-gallery-zoom.json',directory),JSON.stringify({...viewport,cursors:fixture.galleryRequests??[]},null,2)+'\n');
    } catch {}
    throw error;
  } finally {await page.close();}
});


test("Chrome 320px: profile preference draft resumes after same-owner verification and is discarded for a replaced session", { timeout: 90000 }, async () => {
  const choice = preferencesCatalogue.categories[0].preferences[0];
  for (const role of ["client", "admin"]) {
    resetFixture(); fixture.profileEnabled = true; fixture.preferencesEnabled = true;
    const page = await browser(320);
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      await waitUntil(() => page.execute("return !document.getElementById('open-profile').hidden"), "profile module mounted");
      if (role === "admin") await page.click(".contact");
      await clickOptionsAction(page, "#open-profile");
      await waitUntil(() => page.execute("const section=document.querySelector('.preferences-section');return !!section&&!section.hidden&&section.getAttribute('aria-busy')==='false'&&!document.querySelector('.preferences-search').disabled"), "preference catalogue fully loaded");
      await page.type(".preferences-search", choice.fr); await page.click(`[data-preference-id="${choice.id}"]`);
      await page.execute("Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__hidden?'hidden':'visible'});window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'))");
      assert.equal(await page.execute("return document.querySelector('.profile-dialog').open"), false);
      await page.execute("window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'))");
      await waitUntil(() => page.execute("return document.querySelector('.profile-dialog').matches(':modal') && !document.querySelector('.preferences-section').hidden"), "same-session proof restores the active profile");
      assert.equal(await page.execute("return document.querySelector('.preferences-search').value"), choice.fr);
      assert.equal(await page.execute("return document.querySelector('.preferences-selected').textContent"), choice.fr);
      assert.equal(fixture.preferenceRequests.length, 0);
      await page.execute("window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'))");
      fixture.csrf = "B".repeat(43);
      await page.execute("window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'))");
      await waitUntil(() => page.execute("return !document.getElementById('workspace').hidden && !document.getElementById('open-profile').hidden"), "replaced session bootstraps a new profile owner");
      assert.equal(await page.execute("return !!document.querySelector('.profile-dialog')?.open"), false, "the old profile is not reopened for a new session");
      await clickOptionsAction(page, "#open-profile");
      await waitUntil(() => page.execute("const section=document.querySelector('.preferences-section');return !!section&&!section.hidden&&section.getAttribute('aria-busy')==='false'&&!document.querySelector('.preferences-search').disabled"), "new owner preferences fully loaded");
      assert.equal(await page.execute("return document.querySelector('.preferences-search').value"), "");
      assert.equal(await page.execute("return document.querySelector('.preferences-selected').textContent"), "Aucune sélection.");
      assert.equal(fixture.preferenceRequests.length, 0); await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});


test("Chrome photo viewer ignores a previous close event after reopening and still cleans up native closes", { timeout: 45000 }, async () => {
  for (const role of ["client", "admin"]) {
    resetFixture(); const page = await browser(role === "client" ? 320 : 1280);
    try {
      await loaded(page, role === "client" ? "/messages" : "/admin/messages"); if (role === "admin") await page.click(".contact"); await loadedPhoto(page);
      await page.click("#messages .photo-open");
      await waitUntil(() => page.execute("const image=document.querySelector('#lightbox-image img');return document.getElementById('lightbox').matches(':modal')&&!!image&&image.complete&&image.naturalWidth>0"), "original full photo decoded before reopening");
      // close() queues its native event. Both clicks occur in the same task,
      // so that old event must not tear down the newly opened modal.
      await page.execute("window.__photoReopenCloseObserved=false;document.getElementById('lightbox').addEventListener('close',()=>{window.__photoReopenCloseObserved=true},{once:true});document.getElementById('close-lightbox').click();document.querySelector('#messages .photo-open').click()");
      await waitUntil(() => page.execute("const image=document.querySelector('#lightbox-image img');return window.__photoReopenCloseObserved&&document.getElementById('lightbox').matches(':modal')&&!!image&&image.complete&&image.naturalWidth>0"), "reopened photo survives the previous native close event");
      const escaped = await page.execute("return document.querySelector('#lightbox-image img').src");
      await page.key("\uE00C");
      await waitUntil(() => page.execute("return !document.getElementById('lightbox').open&&!document.querySelector('#lightbox-image img')&&window.__revokedBlobUrls.includes(arguments[0])", escaped), "Escape closes the current modal and revokes its full photo");
      await page.click("#messages .photo-open");
      await waitUntil(() => page.execute("const image=document.querySelector('#lightbox-image img');return document.getElementById('lightbox').matches(':modal')&&!!image&&image.complete&&image.naturalWidth>0"), "photo decoded before native close");
      const nativeClosed = await page.execute("return document.querySelector('#lightbox-image img').src");
      await page.execute("document.getElementById('lightbox').close()");
      await waitUntil(() => page.execute("return !document.getElementById('lightbox').open&&!document.querySelector('#lightbox-image img')&&window.__revokedBlobUrls.includes(arguments[0])", nativeClosed), "native close cleans up the current full photo");
      await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome photo neighbors use authorized server order within a millisecond while rejecting a reversed date or the same message", { timeout: 90000 }, async () => {
  for (const role of ["client", "admin"]) {
    resetFixture(); const page = await browser(role === "client" ? 320 : 1280);
    let caseContext = { role, stage: "initial-load" };
    try {
      await loaded(page, role === "client" ? "/messages" : "/admin/messages"); if (role === "admin") await page.click(".contact"); await loadedPhoto(page);
      const originalDate = fixture.now + 3000;
      for (const direction of ["previous", "next"]) for (const outcome of ["same-millisecond", "reversed-date", "same-message"]) {
        caseContext = { role, direction, outcome, stage: "original-photo" };
        // True SQL microseconds are intentionally absent from the public DTO.
        // IDs run opposite to the authorized chronology for this tie in ms.
        const messageId = outcome === "same-message" ? photoMessageId : direction === "previous" ? id(999) : id(1);
        const full = `/api/media/${role}/conversations/${conversationId}/messages/${messageId}/full`;
        fixture.photoNeighbor = { messageId, sequence: direction === "previous" ? "1" : "5", sender: "peer",
          createdAt: originalDate + (outcome !== "reversed-date" ? 0 : direction === "previous" ? 1 : -1),
          media: { ...media(role), fullUrl: full, thumbnailUrl: full.replace(/full$/, "thumb") } };
        await page.click("#messages .photo-open");
        await waitUntil(() => page.execute("const image=document.querySelector('#lightbox-image img');return document.getElementById('lightbox').open&&!!image&&image.complete&&image.naturalWidth>0"), "original full photo ready");
        const originalBlob = await page.execute("return document.querySelector('#lightbox-image img').src");
        const reads = fixture.photoNeighborReads?.length ?? 0;
        caseContext.stage = "neighbor-photo";
        await page.click(direction === "previous" ? "#previous-photo" : "#next-photo");
        if (outcome === "same-millisecond") {
          await waitUntil(() => page.execute("const image=document.querySelector('#lightbox-image img');return !!image&&image.complete&&image.naturalWidth>0&&image.src!==arguments[0]&&!document.getElementById('next-photo').disabled", originalBlob), "different photo with equal public milliseconds accepted");
          assert.ok(fixture.photoNeighborReads.slice(reads).includes(full.replace(`/api/media/${role}`, "")), "the viewer fetched the exact neighboring message's authorized full photo");
        } else {
          await waitUntil(() => page.execute("return document.getElementById('lightbox-status').textContent==='La photo n’a pas pu être chargée. Réessaie dans un moment.'&&!document.getElementById('next-photo').disabled"), "invalid neighboring metadata rejected without changing the displayed photo");
          assert.equal(await page.execute("return document.querySelector('#lightbox-image img').src"), originalBlob);
          assert.equal(fixture.photoNeighborReads.length, reads, "invalid neighbor does not initiate another original read");
        }
        await page.click("#close-lightbox");
      }
      await noJavascriptErrors(page);
    } catch (error) {
      try {
        const diagnostic = await page.execute("const dialog=document.getElementById('lightbox'),image=document.querySelector('#lightbox-image img');return {open:dialog.open,modal:dialog.matches(':modal'),image:image?{src:image.getAttribute('src'),complete:image.complete,naturalWidth:image.naturalWidth}:null,status:document.getElementById('lightbox-status').textContent,previousDisabled:document.getElementById('previous-photo').disabled,nextDisabled:document.getElementById('next-photo').disabled,errors:window.__browserErrors}");
        console.error("photo_neighbor_diagnostic " + JSON.stringify({ ...caseContext, ...diagnostic, galleryRequests: fixture.galleryRequests ?? [], fullReads: fixture.photoNeighborReads ?? [] }));
        const directory = new URL("../../artifacts/homepage/", import.meta.url); await mkdir(directory, { recursive: true });
        await writeFile(new URL(`debug1101-photo-neighbor-${role}.png`, directory), Buffer.from(await page.screenshot(), "base64"));
      } catch {}
      throw error;
    } finally { await page.close(); }
  }
});

test("Chrome: recent conversation previews show outgoing and empty states in FR/EN at320/1280px", { timeout: 120000 }, async t => {
  for (const [width, language] of [[320, "fr"], [320, "en"], [1280, "fr"], [1280, "en"]]) await t.test(`${language} ${width}px`, async () => {
    resetFixture(); fixture.receivedEnabled = true;
    const page = await browser(width, 800);
    try {
      await loaded(page, "/admin/messages");
      if (language === "en") await toggleChatLanguage(page);
      await waitUntil(() => page.execute("return document.querySelectorAll('.received-item').length===4"), "recent conversations shown without choosing a client");
      assert.equal(await page.execute("return document.getElementById('composer').checkVisibility() || document.querySelector('.chat-head').checkVisibility()"), false);
      assert.deepEqual(await page.execute("return [...document.querySelectorAll('.received-item')].map(node=>({id:node.dataset.receivedId,unread:node.classList.contains('is-unread')}))"), [3,2,1,4].map(n => ({ id:n===4?id(104):id(200+n), unread:n===1 })));
      assert.equal(await page.execute("return new Set([...document.querySelectorAll('.received-item')].map(node=>node.dataset.receivedConversationId)).size"), 4);
      assert.equal(fixture.read.admin, "0", "the overview must never mark messages read");
      assert.equal(await page.execute("return !!document.querySelector('.received-body b')"), false, "message body remains literal text");
      assert.equal(await page.execute("return document.documentElement.scrollWidth<=innerWidth+1"), true);
      assert.equal(await page.execute("return document.getElementById('received-title').textContent"), "Conversations");
      assert.match(await page.execute("return document.querySelector('.received-body').textContent"), language === "en" ? /You:.*Photo/ : /Vous :.*Photo/);
      assert.match(await page.execute("return document.querySelectorAll('.received-body')[3].textContent"), language === "en" ? /no messages/i : /Aucun message/);
      await mkdir(new URL("../../artifacts/homepage/", import.meta.url), { recursive: true });
      await writeFile(new URL(`../../artifacts/homepage/conversation-list1130-${language}-${width}.png`, import.meta.url), Buffer.from(await page.screenshot(), "base64"));
      if (width === 320) {
        await page.click("#show-clients"); await waitUntil(() => page.execute("return document.getElementById('inbox').checkVisibility()"), "mobile client filters");
        await page.click("#return-received"); await waitUntil(() => page.execute("return document.querySelector('.received-item').checkVisibility()"), "mobile back to all received messages");
      }
      fixture.receivedFailure = true; await page.click("#refresh-received");
      await waitUntil(() => page.execute("return document.querySelectorAll('.received-item').length===0 && !document.getElementById('refresh-received').disabled"), "a failed refresh purges old previews");
      fixture.receivedFailure = false; await page.click("#refresh-received");
      await waitUntil(() => page.execute("return document.querySelectorAll('.received-item').length===4 && !document.getElementById('refresh-received').disabled"), "explicit refresh recovers the overview");
      await page.click(".received-item"); await loadedPhoto(page);
      assert.equal(await page.execute("return document.getElementById('received-overview').hidden && document.getElementById('composer').checkVisibility()"), true);
      await page.click("#back-to-inbox");
      await waitUntil(() => page.execute("return document.querySelectorAll('.received-item').length===4 && !document.getElementById('received-overview').hidden"), "back returns to the received overview");
      assert.deepEqual(await page.execute("return window.__browserErrors"), []);
    } finally { await page.close(); }
  });
});

test("Chrome mobile: an initial session wait paints a neutral loading shell before any private workspace", { timeout: 45000 }, async () => {
  for (const role of ["admin", "client"]) {
    resetFixture(); fixture.holdSessions = true;
    const page = await browser(320, 800);
    try {
      await page.navigate(role === "admin" ? "/admin/messages" : "/messages");
      await waitUntil(() => (fixture.sessionHolds?.length ?? 0) > 0, "initial session request retained by the synthetic server");
      assert.deepEqual(await page.execute(`const shell=document.getElementById('connection-shell'),r=shell.getBoundingClientRect();return {
        loading:shell.checkVisibility()&&shell.classList.contains('is-loading'),busy:shell.getAttribute('aria-busy'),
        workspace:document.getElementById('workspace').checkVisibility(),messages:document.querySelectorAll('#messages [data-sequence]').length,
        status:document.getElementById('session-status').textContent,brand:document.querySelector('.topbar').checkVisibility(),
        fits:r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,overflow:document.documentElement.scrollWidth>innerWidth+1};`),
      { loading:true,busy:"true",workspace:false,messages:0,status:"Vérification de la connexion…",brand:true,fits:true,overflow:false });
      await page.executeAsync("const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)))");
      await mkdir(new URL("../../artifacts/homepage/", import.meta.url), { recursive: true });
      await writeFile(new URL(`../../artifacts/homepage/connection-loading-${role}-320.png`, import.meta.url), Buffer.from(await page.screenshot(), "base64"));
      releaseHeldSessions();
      await waitUntil(() => page.execute("return !document.getElementById('workspace').hidden&&!document.getElementById('connection-shell').checkVisibility()"), "authorized workspace replaces the loading shell");
      await noJavascriptErrors(page);
    } finally { releaseHeldSessions(); await page.close(); }
  }
});

test("Chrome mobile: a persisted-page event revalidates without reloading the document or sending its restored draft", { timeout: 45000 }, async () => {
  // The DOM event is dispatched deliberately: this qualifies our persisted-page
  // handler, not the browser's own eligibility/eviction policy for its bfcache.
  for (const role of ["admin", "client"]) {
    resetFixture(); const page = await browser(320, 800);
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      if (role === "admin") await page.click(`#conversations [data-conversation-id="${conversationId}"]`);
      await loadedPhoto(page);
      const draft = `Unsent ${role} browser-back draft`;
      await page.type("#message-body", draft);
      const documents = fixture.chatDocuments;
      fixture.holdSessions = true;
      await page.execute("window.__persistedNavigationMarker='same-document';window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));return true");
      assert.equal(await page.execute("return document.getElementById('workspace').hidden&&document.querySelectorAll('#messages [data-sequence]').length===0&&document.getElementById('message-body').value===''&&document.getElementById('connection-shell').checkVisibility()"), true);
      await page.execute("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));return true");
      await waitUntil(() => (fixture.sessionHolds?.length ?? 0) > 0, "persisted-page return waits for a current session proof");
      assert.equal(await page.execute("return window.__persistedNavigationMarker==='same-document'&&document.getElementById('workspace').hidden&&document.getElementById('connection-shell').checkVisibility()"), true);
      assert.equal(fixture.chatDocuments, documents, "the persisted-page handler does not request the document again");
      releaseHeldSessions();
      await waitUntil(() => page.execute("return !document.getElementById('workspace').hidden&&document.getElementById('message-body').value===arguments[0]", draft), "same-owner draft restored after authorization");
      assert.equal(fixture.sent.length, 0, "a preserved draft is never sent automatically");
      assert.equal(fixture.chatDocuments, documents); await noJavascriptErrors(page);
    } finally { releaseHeldSessions(); await page.close(); }
  }
});

test("Chrome composer: explicit newline retains the caret and Enter sends once for both roles and languages", { timeout: 120000 }, async () => {
  for (const width of [320, 1280]) for (const role of ["client", "admin"]) for (const language of ["fr", "en"]) {
    resetFixture(); const page = await browser(width, 640), context = `${role} ${language} ${width}px`;
    try {
      await loaded(page, role === "admin" ? "/admin/messages" : "/messages");
      if (role === "admin") await page.click(".contact");
      await loadedPhoto(page);
      if (language === "en") await toggleChatLanguage(page);
      if (width === 320) await page.execute(`const original=window.matchMedia.bind(window);window.matchMedia=query=>query==='(any-pointer: coarse)'?{matches:true}:original(query);`);
      assert.equal(await page.execute("return document.getElementById('message-body').getAttribute('enterkeyhint')"), "send");
      assert.equal(await page.execute("return document.getElementById('insert-line-break').getAttribute('aria-label')"), language === "fr" ? "Passer à la ligne" : "Insert a line break");
      await page.type("#message-body", "Alpha Omega");
      await page.execute("document.getElementById('message-body').setSelectionRange(6,6)");
      if (language === "en") {
        await page.key("\uE004");
        assert.equal(await page.execute("return document.activeElement.id"), "insert-line-break", `${context}: the newline command is keyboard reachable`);
        await page.key("\uE007");
      } else await page.click("#insert-line-break");
      assert.deepEqual(await page.execute("const t=document.getElementById('message-body');return {value:t.value,start:t.selectionStart,end:t.selectionEnd,focus:document.activeElement.id}"),
        { value: "Alpha \nOmega", start: 7, end: 7, focus: "message-body" }, context);
      assert.equal(fixture.sent.length, 0, `${context}: inserting a line break never sends`);
      await captureOptions(page, `composer-enter-${role}-${language}-${width}`);
      await page.key("\uE007");
      await waitUntil(() => fixture.sent.length === 1, "native Enter creates one message");
      await waitUntil(() => page.execute("return document.getElementById('message-body').value==='' && !document.getElementById('message-body').disabled"), "send confirmation clears and unlocks composer");
      assert.equal(fixture.sent[0].body, "Alpha \nOmega", context);
      assert.equal(await page.execute("return document.activeElement.id==='message-body'"), width !== 320, `${context}: touch sends do not reopen the keyboard`);
      await delay(80); assert.equal(fixture.sent.length, 1, `${context}: no implicit form-submit duplicate`);
      await noJavascriptErrors(page);
    } finally { await page.close(); }
  }
});

test("Chrome composer: mobile beforeinput fallback does not send an IME confirmation or intercept another textarea", { timeout: 60000 }, async () => {
  resetFixture(); const page = await browser(390, 640);
  try {
    await loaded(page, "/messages"); await loadedPhoto(page);
    await page.execute("const t=document.createElement('textarea');t.id='external-enter-probe';document.body.append(t);t.focus()");
    await page.type("#external-enter-probe", "Other field"); await page.key("\uE007");
    assert.equal(await page.execute("return document.getElementById('external-enter-probe').value"), "Other field\n");
    assert.equal(fixture.sent.length, 0);
    await page.execute("document.getElementById('external-enter-probe').remove()");
    const composition = await page.execute(`const t=document.getElementById('message-body');t.focus();t.value='日本語';t.dispatchEvent(new InputEvent('input',{bubbles:true}));
      t.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
      const key=t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true}));
      t.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
      const newline=t.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertLineBreak',bubbles:true,cancelable:true}));
      return {key,newline,value:t.value};`);
    assert.deepEqual(composition, { key: true, newline: true, value: "日本語" });
    assert.equal(fixture.sent.length, 0, "candidate confirmation is not a send command");
    assert.equal(await page.execute("return document.getElementById('message-body').dispatchEvent(new InputEvent('beforeinput',{inputType:'insertLineBreak',bubbles:true,cancelable:true}))"), false);
    await waitUntil(() => fixture.sent.length === 1, "soft Enter submits after composition confirmation");
    assert.equal(fixture.sent[0].body, "日本語");
    await noJavascriptErrors(page);
  } finally { await page.close(); }
});


test("Chrome: keyboard history loads on upward navigation and keeps a bounded contiguous two-way window", { timeout: 90000 }, async () => {
  resetFixture(); fixture.windowedHistory = true; fixture.latest = 800; fixture.mediaDisabled = true;
  const page = await browser(320, 800); let phase = "initial";
  try {
    await loaded(page, "/messages");
    await waitUntil(() => page.execute("const scroll=document.getElementById('message-scroll'),last=document.querySelector('#messages .message:last-child');if(!last||last.dataset.sequence!=='800')return false;const box=scroll.getBoundingClientRect(),row=last.getBoundingClientRect();return scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<10&&row.bottom>box.top&&row.top<box.bottom"), "latest message is in the initial viewport at the conversation tail");
    for (let i = 0; i < 8; i++) {
      phase = `Home ${i + 1}`;
      const before = fixture.historyReads.length;
      await page.execute("document.getElementById('message-scroll').focus()"); await page.key("\uE011");
      await waitUntil(() => fixture.historyReads.length > before, "Home loads older history without its button");
      await waitUntil(() => page.execute("return !document.getElementById('older-messages').disabled"), "history load completes");
    }
    const window = await page.execute("return [...document.querySelectorAll('#messages .message')].map(node=>Number(node.dataset.sequence))");
    assert.equal(window.length, 300); assert.equal(window.every((seq, index) => !index || seq === window[index - 1] + 1), true);
    const tail = window.at(-1); phase = "End after window trim";
    await page.execute("document.getElementById('message-scroll').focus()"); await page.key("\uE010");
    await waitUntil(() => page.execute(`return Number(document.querySelector('#messages .message:last-child')?.dataset.sequence)>${tail}`), "End restores an evicted newer portion");
    assert.equal(await page.execute("return document.querySelectorAll('#messages .message').length<=300"), true);
    assert.equal(await page.execute("return document.documentElement.scrollWidth<=innerWidth+1"), true);
    await mkdir(new URL("../../artifacts/homepage/", import.meta.url), { recursive: true });
    await writeFile(new URL("../../artifacts/homepage/conversation-history1130-fr-320.png", import.meta.url), Buffer.from(await page.screenshot(), "base64"));
    await noJavascriptErrors(page);
  } catch (error) {
    try {
      const state = await page.execute("const scroll=document.getElementById('message-scroll'),rows=[...document.querySelectorAll('#messages .message')];return {active:document.activeElement.id,scrollTop:scroll.scrollTop,scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight,first:rows[0]?.dataset.sequence,last:rows.at(-1)?.dataset.sequence,rows:rows.length,older:{hidden:document.getElementById('older-messages').hidden,disabled:document.getElementById('older-messages').disabled},status:document.getElementById('chat-status').textContent,errors:window.__browserErrors}");
      console.error("history1130_diagnostic " + JSON.stringify({ phase, reads: fixture.historyReads, ...state }));
      await mkdir(new URL("../../artifacts/homepage/", import.meta.url), { recursive: true });
      await writeFile(new URL("../../artifacts/homepage/debug1130-history.png", import.meta.url), Buffer.from(await page.screenshot(), "base64"));
    } catch {}
    throw error;
  } finally { await page.close(); }
});


test("Chrome mobile: fifty photo placeholders only fetch thumbnails around the visible history", { timeout: 60000 }, async () => {
  resetFixture(); fixture.windowedHistory = true; fixture.latest = 50; fixture.allPhotos = true;
  const page = await browser(320, 800);
  try {
    await loaded(page, "/messages");
    await waitUntil(() => (fixture.thumbnailReads?.length ?? 0) > 0, "visible tail thumbnails start");
    await delay(150);
    const initial = fixture.thumbnailReads.length;
    assert.ok(fixture.thumbnailReads.some(path=>path.includes(id(250))), "the initial viewport fetches the latest photo");
    assert.ok(initial < 20, `initial viewport fetched ${initial} of 50 thumbnails`);
    assert.equal(await page.execute("return document.querySelectorAll('#messages .photo-open').length"), 50);
    await page.execute("document.getElementById('message-scroll').focus()"); await page.key("\uE011");
    await waitUntil(() => fixture.thumbnailReads.length > initial, "scrolling exposes earlier thumbnails");
    assert.ok(fixture.thumbnailReads.length < 40);
    await noJavascriptErrors(page);
  } finally { await page.close(); }
});
