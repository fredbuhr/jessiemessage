// Real Help markup, CSS, translations and navigation in Chrome. The optional
// chat/recovery APIs are synthetic and local: no account, mail, Push or external
// service is contacted and no real message or credential is used.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { startWebDriver, tabUntil, waitUntil } from "./webdriver.mjs";

const syntheticToken = "a".repeat(42) + "A";
const draft = "Brouillon fictif : ce texte doit rester ici.";
const id = number => number.toString(16).padStart(32, "0");
const conversationId = id(100);
const files = ["help.html", "help.css", "help.js", "help-link.js", "recover.html", "recover.js", "recover-model.js", "recover.css", "admin-login.css",
  "chat.html", "chat.js", "chat-model.js", "quick-replies.js", "chat.css", "session-clock.js", "image-preparation.js",
  "i18n.js", "i18n.css", "i18n-access.js", "i18n-chat.js", "i18n-tools.js", "notifications.js", "notifications.css", "notification-link.js",
  "manifest.webmanifest", "favicon.ico", "apple-touch-icon.png", "brand/brand.css", "brand/icon-32.png", "brand/icon-128.png"];
const types = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", html: "text/html; charset=utf-8", png: "image/png", ico: "image/x-icon", webmanifest: "application/manifest+json" };
const observer = `"use strict";
window.__helpErrors = [];
window.__helpFetches = [];
window.__helpPageHides = 0;
window.addEventListener("error", () => window.__helpErrors.push("script_error"));
window.addEventListener("unhandledrejection", () => window.__helpErrors.push("unhandled_rejection"));
window.addEventListener("securitypolicyviolation", () => window.__helpErrors.push("csp_violation"));
window.addEventListener("pagehide", () => { window.__helpPageHides += 1; });
const nativeFetch = window.fetch;
window.fetch = function (input, init) {
  window.__helpFetches.push(new URL(typeof input === "string" ? input : input.url, location.href).pathname);
  return nativeFetch.call(this, input, init);
};`;

async function helpFixture() {
  const resources = new Map(await Promise.all(files.map(async name => [`/${name}`, await readFile(new URL(`../../public/${name}`, import.meta.url))])));
  resources.set("/__observer.js", Buffer.from(observer));
  const html = name => resources.get(`/${name}`).toString().replace("<head>", '<head><script src="/__observer.js"></script>');
  const requests = [], failures = [];
  let resetRequests = 0;
  const now = Date.now();
  const conversation = { id: conversationId, client: null, peerName: "Jessie", createdAt: now - 60000, closedAt: null, lastActivityAt: now - 60000,
    latestSequence: "0", latestEventSequence: "0", lastReadSequence: "0", peerReadSequence: "0", unreadCount: 0, canSend: true };
  const json = (response, status, value) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, "http://localhost");
      requests.push({ path: url.pathname, method: request.method, query: url.search, hasReferrer: Boolean(request.headers.referer),
        secretInUrl: request.url.includes(syntheticToken) || request.url.includes(encodeURIComponent(draft)), secretInReferrer: request.headers.referer?.includes(syntheticToken) === true });
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      if (request.method === "GET" && ["/help", "/recover", "/messages"].includes(url.pathname)) {
        response.writeHead(200, { "Content-Type": types.html }); response.end(html(url.pathname === "/help" ? "help.html" : url.pathname === "/recover" ? "recover.html" : "chat.html")); return;
      }
      if (request.method === "GET" && ["/__fixture", "/app"].includes(url.pathname)) {
        response.writeHead(200, { "Content-Type": types.html }); response.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Local fixture</title></head><body><main id="destination">Local fixture</main></body></html>'); return;
      }
      if (request.method === "GET" && resources.has(url.pathname)) {
        response.writeHead(200, { "Content-Type": types[url.pathname.split(".").at(-1)] ?? "application/octet-stream" }); response.end(resources.get(url.pathname)); return;
      }
      if (request.method === "GET" && url.pathname === "/api/access/session") {
        json(response, 200, { user: { id: id(2), role: "client", pseudonym: "Synthetic visitor" }, csrf: "A".repeat(43), expiresAt: now + 3600000,
          access: { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: true, expiresAt: null } }); return;
      }
      if (request.method === "GET" && url.pathname === "/api/chat/client/capabilities") { json(response, 200, { enabled: true }); return; }
      if (request.method === "GET" && url.pathname === "/api/chat/client/conversation") { json(response, 200, { id: conversationId }); return; }
      if (request.method === "GET" && url.pathname === `/api/chat/client/conversations/${conversationId}/messages`) {
        json(response, 200, { conversation, messages: [], eventCursor: "0", hasMoreBefore: false, nextBefore: null }); return;
      }
      if (request.method === "GET" && url.pathname === `/api/chat/client/conversations/${conversationId}/events`) {
        json(response, 200, { conversation, events: [], nextCursor: "0", hasMore: false }); return;
      }
      if (request.method === "GET" && url.pathname === "/api/access/recovery/capabilities") { json(response, 200, { enabled: true, password: { minLength: 8, maxLength: 128 } }); return; }
      if (request.method === "POST" && url.pathname === "/api/access/recovery/reset") {
        resetRequests += 1; request.resume(); json(response, 200, { status: "password_changed" }); return;
      }
      // Optional media, notifications and broadcasts are deliberately disabled.
      request.resume(); json(response, 404, { error: "fixture_not_found" });
    })().catch(error => { failures.push(error?.name ?? "Error"); if (!response.headersSent) json(response, 500, { error: "fixture_failure" }); else response.destroy(); });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, failures,
    reset() { requests.length = 0; failures.length = 0; resetRequests = 0; },
    resetCount: () => resetRequests,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  };
}

async function seedLanguage(page, language) {
  await page.navigate("/__fixture");
  await page.execute("sessionStorage.setItem('jessiemessage.language', arguments[0])", language);
}
async function readyHelp(page, language) {
  const title = language === "fr" ? "Jessie — Aide et confidentialité" : "Jessie — Help and privacy";
  await waitUntil(() => page.execute("return location.pathname === '/help' && !location.hash && !location.search && document.documentElement.lang === arguments[0] && document.title === arguments[1] && !!globalThis.JessieI18n && !!document.querySelector('main h1')", language, title), "fully initialised real Help page with its URL cleaned");
}
async function noErrors(page) { assert.deepEqual(await page.execute("return window.__helpErrors"), [], "no script, promise or CSP errors"); }
async function privateSurfaces(page) {
  assert.equal(await page.execute(`const secret = arguments[0]; return [location.href, document.documentElement.outerHTML, JSON.stringify({...localStorage}), JSON.stringify({...sessionStorage})].every(surface => !surface.includes(secret));`, syntheticToken), true,
    "no recovery token is copied to the URL, markup or browser storage");
  assert.deepEqual(await page.execute("return Object.keys(localStorage)"), [], "Help introduces no local storage");
  assert.deepEqual(await page.execute("return Object.keys(sessionStorage)"), ["jessiemessage.language"], "only the existing language preference is stored");
  assert.equal(await page.execute("return !JSON.stringify({...localStorage, ...sessionStorage}).includes(arguments[0])", draft), true, "a chat draft is never copied into web storage");
}
async function helpLayout(page) {
  const result = await page.execute(`const width = document.documentElement.clientWidth;
    const targets = [...document.querySelectorAll('summary, button, main a')].filter(node => node.getBoundingClientRect().width > 0);
    const content = [...document.querySelectorAll('header, main, footer, h1, details, summary, main a')].filter(node => node.getBoundingClientRect().width > 0);
    return { width, documentWidth: document.documentElement.scrollWidth, fits: content.every(node => { const r = node.getBoundingClientRect(); return r.left >= -1 && r.right <= width + 1; }),
      targets: targets.every(node => node.getBoundingClientRect().height >= 44), controlsFit: targets.every(node => node.scrollWidth <= node.clientWidth + 1) };`);
  assert.equal(result.documentWidth <= result.width + 1, true, "Help never overflows horizontally");
  assert.equal(result.fits, true, "all Help sections and links stay inside the viewport");
  assert.equal(result.targets, true, "visible Help controls have at least 44px hit targets");
  assert.equal(result.controlsFit, true, "translated text fits every visible Help control");
}

test("real Chrome: practical Help is translated, accessible and never collects private content", { timeout: 150000 }, async t => {
  const driver = await startWebDriver();
  let fixture;
  try {
    fixture = await helpFixture();
    for (const language of ["fr", "en"]) for (const width of [320, 375, 1280]) await t.test(`${language}, ${width}px: real Help, keyboard FAQ, fixed contact and return`, async () => {
      fixture.reset(); const page = await driver.browser({ origin: fixture.origin, width });
      try {
        await seedLanguage(page, language === "fr" ? "en" : "fr");
        await page.navigate(`/help?source=synthetic#lang=${language}`); await readyHelp(page, language);
        assert.equal(await page.execute("return location.pathname === '/help' && !location.hash && !location.search"), true, "the complete fragment and query are removed");
        assert.equal(await page.execute("return document.title"), language === "fr" ? "Jessie — Aide et confidentialité" : "Jessie — Help and privacy", "the title follows the chosen language");
        assert.equal(await page.execute("return document.querySelector('main h1').textContent"), language === "fr" ? "Un coup de main ?" : "Need a hand?");
        assert.deepEqual(await page.execute("const buttons = [...document.querySelectorAll('button[data-jm-language]')]; return { count: buttons.length, text: buttons[0]?.textContent, label: buttons[0]?.getAttribute('aria-label') };"),
          { count: 1, text: language === "fr" ? "EN" : "FR", label: language === "fr" ? "Switch to English" : "Passer en français" },
          "the language button has its independently translated text and accessible name");
        assert.equal(await page.execute("return [...document.querySelectorAll('[data-jm-i18n]')].every(node => node.textContent === globalThis.JessieI18n.t(node.getAttribute('data-jm-i18n')))"), true,
          "all marked page copy uses the real translation catalog");
        if (language === "en") assert.equal(await page.execute("return [...document.querySelectorAll('[data-jm-i18n]')].every(node => node.getAttribute('data-jm-i18n') === 'Notifications' || node.textContent !== node.getAttribute('data-jm-i18n'))"), true,
          "every French copy entry has its English translation");
        assert.equal(await page.execute(`const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let node;
          while ((node = walker.nextNode())) { if (node.parentElement.closest('button[data-jm-language]')) continue; const text = node.textContent.trim(); if (text && !node.parentElement.closest('[data-jm-i18n]') && !['Jessie', 'contact@jessiemessage.com'].includes(text)) return false; } return true;`), true,
          "all visible copy beyond the fixed brand/contact address and separately checked language button is translatable");
        await helpLayout(page); await noErrors(page); await privateSurfaces(page);
        const summaryCount = await page.execute("return document.querySelectorAll('details > summary').length");
        assert.equal(summaryCount >= 6, true, "the practical FAQ covers the essential journeys");
        await tabUntil(page, "details > summary"); await page.key("\uE007");
        assert.equal(await page.execute("return document.activeElement.parentElement.open"), true, "native Enter opens the focused FAQ");
        await helpLayout(page); await page.key("\uE007");
        assert.equal(await page.execute("return document.activeElement.parentElement.open"), false, "native Enter closes the same FAQ");
        const contacts = await page.execute("return [...document.querySelectorAll('a[href^=\"mailto:\"]')].map(link => link.getAttribute('href'))");
        assert.equal(contacts.length > 0, true);
        for (const href of contacts) {
          const url = new URL(href);
          assert.equal(url.pathname, "contact@jessiemessage.com");
          assert.equal(url.searchParams.has("body"), false, "contact never pre-fills a message with private content");
          assert.equal([...url.searchParams.keys()].every(key => key === "subject"), true, "the only optional contact parameter is its fixed subject");
          assert.equal(["Aide JessieMessage", "Mes données JessieMessage", "Signalement JessieMessage"].includes(url.searchParams.get("subject")), true,
            "contact uses only one of the three fixed Help subjects");
          assert.equal(href.includes(syntheticToken), false);
        }
        assert.deepEqual(await page.execute("return window.__helpFetches"), [], "reading Help never makes an application fetch");
        assert.equal(fixture.requests.some(request => request.path.startsWith("/api/")), false, "Help has no authentication, tracking or data API dependency");
        await page.click(".intro a[href='/app']");
        await waitUntil(() => page.execute("return location.pathname === '/app' && !!document.getElementById('destination')"), "fixed return to the application");
        assert.deepEqual(fixture.failures, []);
      } finally { await page.close(); }
    });

    await t.test("unsupported or augmented language fragments are erased without changing the saved preference", async () => {
      fixture.reset(); const page = await driver.browser({ origin: fixture.origin, width: 320 });
      try {
        for (const fragment of ["#lang=EN", "#lang=en&next=private", "#lang=en%0A", "#lang=fr&lang=en"]) {
          // Each hint is an entry to a newly loaded page. Navigating directly
          // from /help to /help#... changes only the existing document's hash
          // and does not rerun the deliberately one-shot entry controller.
          await seedLanguage(page, "fr");
          await page.navigate(`/help${fragment}`); await readyHelp(page, "fr");
          assert.equal(await page.execute("return !location.hash && !location.search && sessionStorage.getItem('jessiemessage.language') === 'fr'"), true,
            "a malformed hint cannot change language or survive in history");
          await noErrors(page); await privateSurfaces(page);
        }
        assert.equal(fixture.requests.some(request => request.path.startsWith("/api/")), false);
      } finally { await page.close(); }
    });

    for (const source of ["chat", "recovery"]) for (const width of [320, 375, 1280]) await t.test(`${source}, ${width}px: opening Help leaves the real source document and its in-memory work in place`, async () => {
      fixture.reset(); const page = await driver.browser({ origin: fixture.origin, width });
      try {
        await seedLanguage(page, "fr");
        if (source === "chat") {
          await page.navigate("/messages");
          await waitUntil(() => page.execute("return !document.getElementById('workspace')?.hidden && !document.getElementById('message-body')?.disabled"), "synthetic authenticated chat through the real controller");
          await page.type("#message-body", draft);
        } else {
          await page.navigate(`/recover#reset=${syntheticToken}`);
          await waitUntil(() => page.execute("return document.getElementById('recovery-reset-form')?.hidden === false"), "real recovery form with its token only in memory");
        }
        await page.click("[data-jm-language]");
        assert.equal(await page.execute("return document.querySelector('[data-help-link]').getAttribute('href')"), "/help#lang=en", "a late language choice updates the Help link");
        const link = await page.execute("const link = document.querySelector('[data-help-link]'); return { target: link.target, rel: [...link.relList], title: link.textContent, label: link.getAttribute('aria-label') };");
        assert.equal(link.target, "_blank"); assert.equal(link.rel.includes("noopener") && link.rel.includes("noreferrer"), true);
        assert.equal(link.title, "Help and privacy"); assert.equal(link.label, "Help and privacy (new tab)");
        assert.equal(await page.execute(`const width = document.documentElement.clientWidth; const footer = document.querySelector('footer');
          return document.documentElement.scrollWidth <= width + 1 && footer.getBoundingClientRect().height >= 44
            && [...footer.querySelectorAll('a')].every(node => { const rect = node.getBoundingClientRect(); return rect.height >= 44 && rect.left >= -1 && rect.right <= width + 1 && node.scrollWidth <= node.clientWidth + 1; });`), true,
          "the real source footer stays readable with 44px links and no horizontal overflow");
        await page.click("[data-help-link]");
        await waitUntil(() => fixture.requests.some(request => request.path === "/help"), "native Help navigation in another tab");
        assert.equal(await page.execute("return location.pathname"), source === "chat" ? "/messages" : "/recover", "the source tab never navigates away");
        assert.equal(await page.execute("return window.__helpPageHides"), 0, "the source document is not disposed or reloaded");
        if (source === "chat") assert.equal(await page.execute("return document.getElementById('message-body').value"), draft, "the real chat draft remains intact");
        else assert.equal(fixture.resetCount(), 0, "opening Help never submits or consumes the recovery link");
        // A new tab may hide the source. recover.js deliberately clears input
        // fields on hiding but retains the token in its suspended model; this
        // test proves no source navigation/pagehide, not a fabricated focus or
        // credential resubmission in a window handle the driver cannot expose.
        assert.equal(fixture.requests.filter(request => request.path === "/help").every(request => !request.query && !request.hasReferrer), true,
          "native noreferrer navigation sends no source URL or private fragment");
        assert.equal(fixture.requests.every(request => !request.secretInUrl && !request.secretInReferrer), true);
        await noErrors(page); await privateSurfaces(page); assert.deepEqual(fixture.failures, []);
      } finally { await page.close(); }
    });
  } finally { await fixture?.close(); await driver.close(); }
});
