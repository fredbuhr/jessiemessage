// Real product markup/controllers in Chrome against a synthetic loopback API.
// No production account, SQL connection, external notification or message send.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { startWebDriver, waitUntil } from "./webdriver.mjs";

const id = number => number.toString(16).padStart(32, "0"), publicRoot = new URL("../../public/", import.meta.url);
const assets = ["announcements.html", "announcements.js", "announcements-model.js", "announcements.css", "announcement-banner.js", "announcement-banner.css",
  "chat.html", "chat.js", "chat-model.js", "chat.css", "image-preparation.js", "quick-replies.js", "emoji-catalog.js", "emoji.css",
  "profile.js", "profile.css", "i18n-profile.js", "notification-link.js", "notifications.js", "notifications.css", "session-clock.js",
  "i18n.js", "i18n.css", "i18n-tools.js", "i18n-chat.js", "help-link.js", "manifest.webmanifest", "favicon.ico", "apple-touch-icon.png",
  "brand/brand.css", "brand/icon-16.png", "brand/icon-32.png", "brand/icon-48.png", "brand/icon-64.png", "brand/icon-128.png",
  "brand/icon-192.png", "brand/icon-512.png", "brand/icon-maskable-512.png"];
let driver;
before(async () => { driver = await startWebDriver(); }, { timeout: 60000 });
after(async () => { await driver?.close(); });
const bootstrap = `window.__announcementErrors=[];
addEventListener('error',event=>window.__announcementErrors.push(String(event.message)));
addEventListener('unhandledrejection',event=>window.__announcementErrors.push(String(event.reason?.message??event.reason)));
addEventListener('securitypolicyviolation',event=>window.__announcementErrors.push('CSP:'+event.violatedDirective));`;

async function fixture({ uncertain = false, clientBody = null, clientLifetime = 60000, clientResponseDelay = 0, enabled = true } = {}) {
  const files = new Map(await Promise.all(assets.map(async name => ["/" + name, await readFile(new URL(name, publicRoot))])));
  const state = { owner: 1, revision: "0", current: null, saves: [], removes: [], requests: [], commits: new Map(), dropped: false,
    clientBody, clientExpiresAt: null, clientResponses: 0, clientProofsAfterResponse: 0, enabled };
  const session = role => ({ user: { id: id((role === "admin" ? 8000 : 1000) + state.owner), role, pseudonym: role === "admin" ? "Synthetic Jessie" : `Synthetic client ${state.owner}` },
    csrf: state.owner === 1 ? "A".repeat(43) : "B".repeat(42) + "A", expiresAt: Date.now() + 8 * 3600000,
    ...(role === "client" ? { access: { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: true, expiresAt: null } } : {}) });
  function current() {
    const now = Date.now(), announcement = state.owner === 1 && state.current ? { ...state.current,
      status: state.current.expiresAt <= now ? "expired" : state.current.startsAt > now ? "scheduled" : "visible" } : null;
    return { serverTime: now, revision: state.owner === 1 ? state.revision : "0", announcement };
  }
  function conversation() {
    const at = Date.now() - 600000;
    return { id: id(100 + state.owner), client: null, peerName: "Jessie", createdAt: at, closedAt: null, lastActivityAt: at + 1000,
      latestSequence: "1", latestEventSequence: "1", lastReadSequence: "1", peerReadSequence: "0", unreadCount: 0, canSend: true };
  }
  const server = createServer((request, response) => { void (async () => {
    const url = new URL(request.url, "http://localhost"); state.requests.push({ path: url.pathname, method: request.method });
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (status, value) => { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify(value)); };
    if (["/api/announcements/admin/session", "/api/auth/session"].includes(url.pathname)) { json(200, session("admin")); return; }
    if (url.pathname === "/api/access/session") {
      if (state.clientResponses > 0) state.clientProofsAfterResponse++;
      json(200, session("client")); return;
    }
    if (url.pathname === "/api/announcements/admin/current" && request.method === "GET") { json(200, current()); return; }
    if (url.pathname === "/api/announcements/admin/preview" && request.method === "POST") {
      for await (const _chunk of request) { /* Synthetic empty request only. */ }
      json(200, { totalCount: 2500, eligibleCount: 2475, excludedCount: 25, previewToken: "synthetic.announcement-preview" }); return;
    }
    if (["/api/announcements/admin/current", "/api/announcements/admin/current/remove"].includes(url.pathname) && request.method === "POST") {
      let raw = ""; for await (const chunk of request) raw += chunk;
      const input = JSON.parse(raw), remove = url.pathname.endsWith("/remove"), payload = JSON.stringify({ remove, input });
      (remove ? state.removes : state.saves).push(input);
      assert.equal(request.headers["x-csrf-token"], session("admin").csrf);
      const prior = state.commits.get(input.mutationId);
      if (prior && prior.payload !== payload || !prior && input.expectedRevision !== state.revision) { json(409, { error: "conflict" }); return; }
      if (prior) { json(200, { ...current(), duplicate: true }); return; }
      state.revision = String(Number(state.revision) + 1);
      state.current = remove ? null : { id: id(9000 + Number(state.revision)), revision: state.revision, body: input.body,
        startsAt: input.startsAt ?? Date.now(), expiresAt: input.expiresAt,
        sendPrivateMessage: input.sendPrivateMessage, campaignId: input.sendPrivateMessage ? id(19000 + Number(state.revision)) : null };
      state.commits.set(input.mutationId, { payload });
      if (uncertain && !state.dropped) {
        state.dropped = true;
        // Let the response reach headers after commit so Chrome cannot silently
        // retry this POST as a connection failure before the user's own retry.
        response.writeHead(201, { "Content-Type": "application/json", "Content-Length": "128", Connection: "close" }); response.end('{"announcement":'); return;
      }
      json(201, { ...current(), duplicate: false }); return;
    }
    if (url.pathname === "/api/announcements/client/current") {
      const at = Date.now();
      state.clientExpiresAt ??= at + clientLifetime;
      const result = { serverTime: at, announcement: state.owner === 1 && state.clientBody && at < state.clientExpiresAt
        ? { id: id(3000), revision: "1", body: state.clientBody, startsAt: at - 1000, expiresAt: state.clientExpiresAt } : null };
      if (clientResponseDelay) await delay(clientResponseDelay);
      state.clientResponses++; json(200, result); return;
    }
    if (url.pathname === "/api/chat/client/capabilities") { json(200, { enabled: true, ...(state.enabled ? { announcements: { enabled: true } } : {}) }); return; }
    if (url.pathname === "/api/chat/client/conversation") { json(200, { id: conversation().id }); return; }
    const path = `/api/chat/client/conversations/${conversation().id}`;
    if (url.pathname === path + "/messages") {
      json(200, { conversation: conversation(), messages: [{ id: id(200 + state.owner), sequence: "1", sender: "peer", body: `Fictional message for client ${state.owner}`,
        createdAt: conversation().lastActivityAt, deletedAt: null, clientMessageId: null }], eventCursor: "1", hasMoreBefore: false, nextBefore: null }); return;
    }
    if (url.pathname === path + "/events") { json(200, { conversation: conversation(), events: [], nextCursor: "1", hasMore: false }); return; }
    if (url.pathname === path + "/read") { for await (const _chunk of request) { /* Synthetic read acknowledgement. */ } json(200, { lastReadSequence: "1" }); return; }
    if (url.pathname === "/announcement-fixture.js") { response.writeHead(200, { "Content-Type": "text/javascript" }); response.end(bootstrap); return; }
    const html = url.pathname === "/admin/announcements" ? "announcements.html" : url.pathname === "/messages" ? "chat.html" : null;
    if (html) { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(files.get("/" + html).toString().replace("<head>", '<head><script src="/announcement-fixture.js"></script>')); return; }
    if (files.has(url.pathname)) {
      const type = { js: "text/javascript", css: "text/css", png: "image/png", ico: "image/x-icon", webmanifest: "application/manifest+json" }[url.pathname.split(".").at(-1)] ?? "application/octet-stream";
      response.writeHead(200, { "Content-Type": type }); response.end(files.get(url.pathname)); return;
    }
    json(404, { error: "not_found" });
  })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); }); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { state, origin: `http://127.0.0.1:${server.address().port}`, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

async function openAdmin(source, width, language = "fr") {
  const page = await driver.browser({ origin: source.origin, width, height: 780 });
  await page.navigate("/admin/announcements");
  await waitUntil(() => page.execute("return !document.getElementById('announcements-content').hidden && document.getElementById('expires-at').value!==''"), "announcement admin bootstrap and persisted version");
  if (language === "en") await page.click("[data-jm-language]");
  assert.equal(await page.execute("return document.documentElement.lang"), language);
  return page;
}
async function compose(page, text, scheduled = false) {
  await page.type("#body", text);
  await page.execute(`const local=value=>{const d=new Date(value),pad=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes())};
    const end=document.getElementById('expires-at');end.value=local(Date.now()+3*3600000);end.dispatchEvent(new Event('input',{bubbles:true}));
    if(arguments[0]){const mode=document.getElementById('start-mode');mode.value='scheduled';mode.dispatchEvent(new Event('change',{bubbles:true}));const start=document.getElementById('starts-at');start.value=local(Date.now()+3600000);start.dispatchEvent(new Event('input',{bubbles:true}));}`, scheduled);
}
async function browserErrors(page) { assert.deepEqual(await page.execute("return window.__announcementErrors"), []); }

test("Chrome mobile FR/EN: schedule, review the complete audience and publish one announcement without overflow", { timeout: 150000 }, async () => {
  for (const width of [320, 390]) for (const language of ["fr", "en"]) {
    const source = await fixture(); let page;
    try {
      page = await openAdmin(source, width, language); await compose(page, "Je commence mon show à 22 h 💋", true);
      await page.click("#send-message"); await page.click("#preview");
      await waitUntil(() => page.execute("return !document.getElementById('acknowledge-choice').hidden"), "full private-message audience preview");
      const count = await page.execute("return document.getElementById('acknowledge-label').textContent.replace(/[^0-9]/g,'')");
      assert.ok(count.includes("2475")); assert.equal(source.state.saves.length, 0);
      await page.click("#acknowledge"); await page.click("#save");
      await waitUntil(() => source.state.saves.length === 1 && page.execute("return document.getElementById('current-body').textContent.includes('22 h')"), "confirmed scheduled announcement");
      assert.equal(source.state.current.body, "Je commence mon show à 22 h 💋"); assert.ok(source.state.current.startsAt > Date.now());
      assert.equal(source.state.saves[0].sendPrivateMessage, true); assert.equal(source.state.saves[0].previewToken, "synthetic.announcement-preview");
      assert.equal(await page.execute("return document.documentElement.scrollWidth<=innerWidth"), true);
      await page.click("#remove-announcement"); await waitUntil(() => source.state.removes.length === 1 && page.execute("return document.getElementById('current-body').textContent===''") , "announcement removal");
      await browserErrors(page);
    } finally { await page?.close(); await source.close(); }
  }
});

test("Chrome: a lost acknowledgement retries exactly one publication, conflicts preserve drafts and account changes purge them", { timeout: 90000 }, async () => {
  const source = await fixture({ uncertain: true }); let page;
  try {
    page = await openAdmin(source, 320); await compose(page, "A private announcement draft"); await page.click("#save");
    await waitUntil(() => page.execute("return !document.getElementById('uncertain').hidden && !document.getElementById('retry').disabled"), "uncertain publication and explicit retry");
    assert.equal(source.state.saves.length, 1); assert.equal(await page.execute("return document.getElementById('announcement-fields').disabled"), true);
    await page.click("#retry");
    await waitUntil(() => source.state.saves.length === 2 && page.execute("return document.getElementById('uncertain').hidden && document.getElementById('current-body').textContent==='A private announcement draft'"), "the original publication is acknowledged");
    assert.deepEqual(source.state.saves[0], source.state.saves[1]); assert.equal(source.state.commits.size, 1);
    await page.execute("const body=document.getElementById('body');body.value='New unsaved private draft';body.dispatchEvent(new Event('input',{bubbles:true}));");
    source.state.revision = "8"; source.state.current = { ...source.state.current, revision: "8", body: "Saved by another device" };
    await page.click("#save");
    await waitUntil(() => page.execute("return document.getElementById('current-body').textContent==='Saved by another device'"), "conflict reads the new persisted revision");
    assert.equal(await page.execute("return document.getElementById('body').value"), "New unsaved private draft");
    source.state.owner = 2; await page.click("#refresh-current");
    await waitUntil(() => page.execute("return document.getElementById('body').value==='' && document.getElementById('current-body').textContent===''") , "changed account clears draft and saved private body");
    assert.equal(source.state.commits.size, 1); await browserErrors(page);
  } finally { await page?.close(); await source.close(); }
});

test("Chrome client mobile: the compact banner opens accessibly, expires locally and clears on an account change", { timeout: 120000 }, async () => {
  for (const [width, language] of [[320, "fr"], [390, "en"]]) {
    const body = "Je commence mon show bientôt 💋 ".repeat(24), source = await fixture({ clientBody: body }); let page;
    try {
      page = await driver.browser({ origin: source.origin, width, height: 780 }); await page.navigate("/messages");
      await waitUntil(() => page.execute("return !document.getElementById('message-body').disabled && document.getElementById('announcement-banner')?.hidden===false"), "real chat and announcement module");
      if (language === "en") {
        await page.execute("document.getElementById('open-conversation-menu').click()"); await page.click("[data-jm-language]");
        await waitUntil(() => page.execute("return document.documentElement.lang==='en' && document.getElementById('chat-menu').hidden && document.activeElement?.id==='open-conversation-menu'"), "language change closes Options and restores its visible opener");
      }
      assert.equal(await page.execute("return document.documentElement.lang"), language);
      assert.equal(await page.execute("return document.documentElement.scrollWidth<=innerWidth && document.getElementById('announcement-banner').getBoundingClientRect().height<=70 && document.getElementById('message-scroll').getBoundingClientRect().height>300"), true);
      await page.click("#open-announcement");
      await waitUntil(() => page.execute("return document.querySelector('#announcement-dialog')?.open"), "full announcement dialog");
      assert.equal(await page.execute("return document.querySelector('#announcement-dialog').textContent.includes(arguments[0])", body), true);
      await page.key("\uE00C");
      await waitUntil(() => page.execute("return !document.querySelector('#announcement-dialog').open && document.activeElement?.matches('#open-announcement')"), "Escape closes and restores focus");
      await page.click("#hide-announcement"); assert.equal(await page.execute("return document.getElementById('announcement-banner').hidden"), true);
      await page.execute("document.getElementById('open-conversation-menu').click()"); await page.click("#open-current-announcement");
      await waitUntil(() => page.execute("return document.getElementById('announcement-dialog').open"), "a dismissed banner remains available through Options");
      await page.key("\uE00C");
      await waitUntil(() => page.execute("return !document.getElementById('announcement-dialog').open && document.getElementById('chat-menu').hidden && document.activeElement?.id==='open-conversation-menu'"), "menu announcement closes and restores the conversation options opener");
      source.state.owner = 2; await page.execute("window.dispatchEvent(new Event('online'))");
      await waitUntil(() => page.execute("return !document.body.textContent.includes('Je commence mon show bientôt') && document.getElementById('messages').textContent.includes('client 2')"), "account replacement purges the prior banner and conversation");
      await browserErrors(page);
    } finally { await page?.close(); await source.close(); }
  }
  const source = await fixture({ clientBody: "Une annonce très courte", clientLifetime: 2500 }); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 320, height: 780 }); await page.navigate("/messages");
    await waitUntil(() => page.execute("return !!document.querySelector('#announcement-banner') && !document.querySelector('#announcement-banner').hidden"), "short-lived announcement appears");
    const reads = source.state.requests.filter(request => request.path === "/api/announcements/client/current").length;
    await waitUntil(() => page.execute("return !document.body.textContent.includes('Une annonce très courte')"), "local expiry removes private announcement text");
    assert.equal(source.state.requests.filter(request => request.path === "/api/announcements/client/current").length, reads, "expiry does not depend on a subsequent API poll");
    await browserErrors(page);
  } finally { await page?.close(); await source.close(); }
});

test("Chrome compatibility: an absent announcement capability preserves the ordinary conversation", { timeout: 60000 }, async () => {
  const source = await fixture({ enabled: false, clientBody: "This feature must stay absent" }); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 390, height: 780 }); await page.navigate("/messages");
    await waitUntil(() => page.execute("return !document.getElementById('message-body').disabled && document.getElementById('messages').textContent.includes('client 1')"), "ordinary compatibility chat");
    assert.equal(await page.execute("return document.getElementById('announcement-banner')===null && !document.body.textContent.includes('This feature must stay absent')"), true);
    assert.equal(source.state.requests.some(request => request.path === "/api/announcements/client/current"), false);
    await browserErrors(page);
  } finally { await page?.close(); await source.close(); }
});

test("Chrome: an announcement that expires during its response is never displayed after the network proof", { timeout: 60000 }, async () => {
  const body = "This announcement expired while the response was in flight";
  const source = await fixture({ clientBody: body, clientLifetime: 500, clientResponseDelay: 1200 }); let page;
  try {
    page = await driver.browser({ origin: source.origin, width: 320, height: 780 }); await page.navigate("/messages");
    await waitUntil(() => source.state.clientProofsAfterResponse > 0 && page.execute("return !document.getElementById('message-body').disabled && !!document.getElementById('announcement-banner')"), "the delayed response has passed the real account proof");
    await page.executeAsync("const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));");
    assert.equal(await page.execute("return document.getElementById('announcement-banner').hidden && document.getElementById('announcement-body').textContent==='' && !document.body.textContent.includes(arguments[0])", body), true);
    assert.equal(source.state.clientResponses, 1); await browserErrors(page);
  } finally { await page?.close(); await source.close(); }
});
