// Real recovery markup, controller, model, styles and translations in Chrome.
// Only the API and sign-in destination below are synthetic. This fixture never
// connects to a database, sends mail or touches a production account/password.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { startWebDriver, tabUntil, waitUntil } from "./webdriver.mjs";

const token = "a".repeat(42) + "A";
const password = "  Été fictif  ";
const email = "synthetic-recovery@example.invalid";
const files = ["recover.html", "recover.js", "recover-model.js", "recover.css", "admin-login.css", "i18n.js", "i18n-access.js", "i18n.css",
  "manifest.webmanifest", "favicon.ico", "apple-touch-icon.png", "brand/brand.css", "brand/icon-32.png", "brand/icon-128.png"];
const types = { js: "text/javascript; charset=utf-8", html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", png: "image/png", ico: "image/x-icon", webmanifest: "application/manifest+json" };
const copy = {
  fr: { request: "Recevoir un lien", reset: "Enregistrer mon mot de passe", accepted: "Si cette adresse est liée à ton espace", changed: "Ton mot de passe est modifié.", invalid: "Ce lien est invalide", uncertain: "Le résultat n’a pas pu être confirmé.", capability: "La disponibilité n’a pas pu être vérifiée.", destination: "Bienvenue." },
  en: { request: "Send me a link", reset: "Save my password", accepted: "If this address is linked to your space", changed: "Your password has been changed.", invalid: "This link is invalid", uncertain: "The result could not be confirmed.", capability: "Availability could not be checked.", destination: "Welcome." }
};

// Read-only observation of the real controller's fetch boundary: no response,
// body, timing, history or application behavior is mocked in the browser.
const observer = `"use strict";
window.__recoveryErrors = [];
window.__recoveryRequests = [];
window.addEventListener("error", () => window.__recoveryErrors.push("script_error"));
window.addEventListener("unhandledrejection", () => window.__recoveryErrors.push("unhandled_rejection"));
window.addEventListener("securitypolicyviolation", () => window.__recoveryErrors.push("csp_violation"));
const nativeFetch = window.fetch;
window.fetch = function (input, init) {
  const url = new URL(typeof input === "string" ? input : input.url, location.href);
  if (url.pathname.startsWith("/api/")) window.__recoveryRequests.push({ path: url.pathname,
    cleanLocation: location.pathname === "/recover" && !location.hash && !location.search });
  return nativeFetch.call(this, input, init);
};`;

async function recoveryFixture() {
  const resources = new Map(await Promise.all(files.map(async name => [`/${name}`, await readFile(new URL(`../../public/${name}`, import.meta.url))])));
  resources.set("/__observer.js", Buffer.from(observer));
  const html = Buffer.from(resources.get("/recover.html").toString().replace("<head>", '<head><script src="/__observer.js"></script>'));
  const calls = [], failures = [], held = new Set();
  let settings = {};
  const json = (response, status, value) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(value)); };
  const interruptedJson = response => {
    // Valid headers followed by an incomplete JSON response, rather than a
    // socket close before headers that Chrome may transparently replay.
    response.writeHead(200, { "Content-Type": "application/json", "Content-Length": "128", Connection: "close" });
    response.end('{"status":');
  };
  const hold = (response, result) => {
    const entry = { response, result }; held.add(entry);
    response.once("close", () => held.delete(entry));
  };
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, "http://localhost");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      if (request.method === "GET" && url.pathname === "/recover") {
        response.writeHead(200, { "Content-Type": types.html }); response.end(html); return;
      }
      if (request.method === "GET" && ["/__fixture", "/access"].includes(url.pathname)) {
        response.writeHead(200, { "Content-Type": types.html });
        response.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Recovery destination fixture</title><script src="/i18n.js" defer></script><script src="/i18n-access.js" defer></script></head><body><main id="destination" data-jm-i18n="Bienvenue.">Bienvenue.</main></body></html>'); return;
      }
      if (request.method === "GET" && resources.has(url.pathname)) {
        response.writeHead(200, { "Content-Type": types[url.pathname.split(".").at(-1)] ?? "application/octet-stream" }); response.end(resources.get(url.pathname)); return;
      }
      if (url.pathname === "/api/access/recovery/capabilities" && request.method === "GET") {
        calls.push({ kind: "capabilities", cleanUrl: !url.search && !url.hash, cleanReferrer: !request.headers.referer?.includes(token) });
        if (settings.capabilityFailure) { settings.capabilityFailure = false; interruptedJson(response); return; }
        if (settings.disabled) { json(response, 404, { error: "not_found" }); return; }
        json(response, 200, { enabled: true, password: { minLength: 8, maxLength: 128 } }); return;
      }
      if (["/api/access/recovery/request", "/api/access/recovery/reset"].includes(url.pathname) && request.method === "POST") {
        let raw = ""; for await (const chunk of request) raw += chunk;
        const body = JSON.parse(raw); raw = "";
        const reset = url.pathname.endsWith("/reset");
        // Keep only validation booleans, never credential-bearing request data.
        calls.push({ kind: reset ? "reset" : "request", cleanUrl: !url.search && !url.hash, cleanReferrer: !request.headers.referer?.includes(token),
          protectedRequest: request.headers["x-jessie-request"] === "1" && request.headers["content-type"] === "application/json",
          validBody: reset ? Object.keys(body).sort().join(",") === "password,token" && body.token === token && body.password === password
            : Object.keys(body).join(",") === "email" && body.email === email });
        if (!reset) {
          if (settings.holdRequest) { settings.holdRequest = false; hold(response, { status: "accepted" }); return; }
          json(response, 202, { status: "accepted" }); return;
        }
        if (settings.failReset) {
          settings.failReset = false;
          if (settings.consumeBeforeFailure) settings.spent = true;
          interruptedJson(response); return;
        }
        if (settings.expired || settings.spent) { json(response, 401, { error: "invalid_reset_link" }); return; }
        settings.spent = true;
        if (settings.holdReset) { settings.holdReset = false; hold(response, { status: "password_changed" }); return; }
        json(response, 200, { status: "password_changed" }); return;
      }
      json(response, 404, { error: "fixture_not_found" });
    })().catch(error => { failures.push(error?.name ?? "Error"); if (!response.headersSent) json(response, 500, { error: "fixture_failure" }); else response.destroy(); });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { origin: `http://127.0.0.1:${server.address().port}`, calls, failures,
    reset(options = {}) { for (const { response } of held) response.destroy(); held.clear(); calls.length = 0; failures.length = 0; settings = { ...options }; },
    release() { for (const entry of [...held]) { held.delete(entry); json(entry.response, 200, entry.result); } },
    async close() { for (const { response } of held) response.destroy(); held.clear(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  };
}

async function openRecovery(page, language, fragment = "") {
  await page.navigate("/__fixture");
  await page.execute("sessionStorage.setItem('jessiemessage.language', arguments[0])", language);
  await page.navigate(`/recover${fragment}`);
}
async function readyForm(page, mode) {
  await waitUntil(() => page.execute("return document.getElementById(arguments[0])?.hidden === false", `recovery-${mode}-form`), `visible recovery ${mode} form`);
}
async function statusStarts(page, text) {
  await waitUntil(() => page.execute("return document.getElementById('recovery-status')?.textContent.startsWith(arguments[0])", text), "translated recovery status");
}
async function cleanSurfaces(page) {
  assert.equal(await page.execute(`const secret = arguments[0]; return !location.hash && !location.search
    && [location.href, document.documentElement.outerHTML, JSON.stringify({...localStorage}), JSON.stringify({...sessionStorage})].every(surface => !surface.includes(secret));`, token), true,
    "the recovery token is absent from the current URL, DOM and web storage");
  assert.deepEqual(await page.execute("return window.__recoveryErrors ?? []"), [], "the real page has no browser errors");
  assert.equal(await page.execute("return (window.__recoveryRequests ?? []).every(request => request.cleanLocation)"), true,
    "every application fetch starts after the entire fragment/query has disappeared");
}
function cleanCalls(fixture) {
  assert.deepEqual(fixture.failures, [], "the local fixture has no internal failures");
  assert.equal(fixture.calls.every(call => call.cleanUrl && call.cleanReferrer && (call.kind === "capabilities" || call.protectedRequest && call.validBody)), true,
    "only the intended JSON body carries the synthetic reset token and exact password");
}
async function geometry(page) {
  const result = await page.execute(`const viewport = document.documentElement.clientWidth;
    const visible = [...document.querySelectorAll('.access-card, .topbar, .footer, h1, form:not([hidden]) input, form:not([hidden]) button, .recovery-actions > :not([hidden])')]
      .filter(node => node.getBoundingClientRect().width > 0).map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; });
    return { viewport, page: document.documentElement.scrollWidth, inside: visible.every(r => r.left >= -1 && r.right <= viewport + 1),
      controlsFit: [...document.querySelectorAll('form:not([hidden]) button, #recovery-new-request:not([hidden]), #recovery-retry-capability:not([hidden])')].every(node => node.scrollWidth <= node.clientWidth + 1),
      targets: [...document.querySelectorAll('form:not([hidden]) input, form:not([hidden]) button, [data-jm-language]')].every(node => node.getBoundingClientRect().height >= 44) };`);
  assert.equal(result.page <= result.viewport + 1, true, "the page has no horizontal overflow");
  assert.equal(result.inside, true, "recovery content stays inside the viewport");
  assert.equal(result.controlsFit, true, "long translated button text fits its control");
  assert.equal(result.targets, true, "visible form and language controls have 44px targets");
}
async function fillReset(page) {
  await page.type("#recovery-password", password);
  await page.type("#recovery-confirmation", password);
}
async function passwordsCleared(page) {
  assert.equal(await page.execute("return document.getElementById('recovery-password').value === '' && document.getElementById('recovery-confirmation').value === ''"), true,
    "password fields are cleared after a definitive or ambiguous response");
}

test("real Chrome: client recovery is deliberate, private, translated and usable from phone to desktop", { timeout: 180000 }, async t => {
  const driver = await startWebDriver();
  let fixture;
  try {
    fixture = await recoveryFixture();
    for (const language of ["fr", "en"]) for (const width of [320, 375, 1280]) await t.test(`${language}, ${width}px: native validation, accepted request, deliberate reset and sign-in`, async () => {
      fixture.reset({ holdRequest: true, holdReset: true });
      const page = await driver.browser({ origin: fixture.origin, width });
      try {
        await openRecovery(page, language); await readyForm(page, "request");
        assert.equal(await page.execute("return document.documentElement.lang"), language);
        assert.equal(await page.execute("return document.querySelector('#recovery-request-form button').textContent"), copy[language].request);
        await geometry(page); await cleanSurfaces(page);
        await page.type("#recovery-email", "not-an-email");
        await page.click("#recovery-request-form button");
        assert.equal(await page.execute("return document.getElementById('recovery-email').validity.typeMismatch"), true);
        assert.equal(fixture.calls.filter(call => call.kind === "request").length, 0, "native email validation prevents sending");
        await page.type("#recovery-email", email); await page.click("#recovery-request-form button");
        await waitUntil(() => fixture.calls.some(call => call.kind === "request"), "one deliberate recovery request");
        assert.equal(await page.execute("return document.querySelector('#recovery-request-form button').disabled && document.getElementById('recovery-email').readOnly"), true,
          "pending request prevents duplicate submission and edits");
        fixture.release(); await statusStarts(page, copy[language].accepted);
        assert.equal(await page.execute("return document.getElementById('recovery-request-form').hidden && !document.getElementById('recovery-new-request').hidden"), true);
        assert.equal(await page.execute("return document.getElementById('recovery-email').value"), "", "accepted requests clear their email field");
        await geometry(page); await page.click("#recovery-new-request"); await readyForm(page, "request");
        assert.equal(await page.execute("return document.activeElement.id"), "recovery-email", "requesting another link focuses the email field");
        assert.equal(fixture.calls.filter(call => call.kind === "request").length, 1);

        await page.navigate(`/recover?source=synthetic-mail#reset=${token}`); await readyForm(page, "reset");
        assert.equal(await page.execute("return document.querySelector('#recovery-reset-form button').textContent"), copy[language].reset);
        assert.equal(fixture.calls.filter(call => call.kind === "reset").length, 0, "opening or scanning a link never resets a password");
        await cleanSurfaces(page); await geometry(page);
        await page.type("#recovery-password", "short"); await page.type("#recovery-confirmation", "short");
        await page.click("#recovery-reset-form button");
        assert.equal(await page.execute("return document.getElementById('recovery-password').validity.tooShort"), true);
        assert.equal(fixture.calls.filter(call => call.kind === "reset").length, 0, "native password length validation prevents reset");
        await page.type("#recovery-password", password); await page.type("#recovery-confirmation", "different synthetic password");
        await page.click("#recovery-reset-form button");
        assert.equal(await page.execute("return document.activeElement.id === 'recovery-confirmation' && document.activeElement.getAttribute('aria-invalid') === 'true'"), true,
          "a mismatch is explained and focused without sending the reset");
        assert.equal(fixture.calls.filter(call => call.kind === "reset").length, 0);
        await fillReset(page); await page.click("#recovery-reset-form button");
        await waitUntil(() => fixture.calls.some(call => call.kind === "reset"), "one deliberate reset");
        assert.equal(await page.execute("return document.querySelector('#recovery-reset-form button').disabled && [...document.querySelectorAll('#recovery-reset-form input')].every(input => input.readOnly)"), true);
        fixture.release(); await waitUntil(() => page.execute("return document.getElementById('recovery-title').textContent === arguments[0]", copy[language].changed), "successful translated reset");
        await passwordsCleared(page); await geometry(page); await cleanSurfaces(page); cleanCalls(fixture);
        assert.equal(fixture.calls.filter(call => call.kind === "reset").length, 1, "success never silently submits or signs in again");
        await tabUntil(page, ".recovery-login"); await page.key("\uE007");
        await waitUntil(() => page.execute("return location.pathname === '/access' && document.getElementById('destination')?.textContent === arguments[0]", copy[language].destination), "explicit keyboard navigation to sign-in preserves language");
      } finally { await page.close(); }
    });

    await t.test("an unavailable capability can be retried without submitting a reset or losing the link", async () => {
      fixture.reset({ capabilityFailure: true });
      const page = await driver.browser({ origin: fixture.origin, width: 320 });
      try {
        await openRecovery(page, "en", `#reset=${token}`); await statusStarts(page, copy.en.capability);
        await waitUntil(() => page.execute("return !document.getElementById('recovery-retry-capability').hidden"), "visible capability retry");
        assert.equal(await page.execute("return document.getElementById('recovery-reset-form').hidden && document.getElementById('recovery-request-form').hidden"), true);
        await cleanSurfaces(page); await geometry(page); await page.click("#recovery-retry-capability"); await readyForm(page, "reset");
        assert.equal(fixture.calls.filter(call => call.kind === "capabilities").length, 2);
        assert.equal(fixture.calls.filter(call => call.kind === "reset").length, 0);
        await fillReset(page); await page.click("#recovery-reset-form button");
        await waitUntil(() => page.execute("return document.getElementById('recovery-title').textContent === arguments[0]", copy.en.changed), "reset after successful capability retry");
        await passwordsCleared(page); await cleanSurfaces(page); cleanCalls(fixture);
      } finally { await page.close(); }
    });

    for (const consumed of [false, true]) await t.test(`a lost reset acknowledgment requires an explicit retry; token previously consumed=${consumed}`, async () => {
      fixture.reset({ failReset: true, consumeBeforeFailure: consumed });
      const page = await driver.browser({ origin: fixture.origin, width: 375 });
      try {
        await openRecovery(page, "en", `#reset=${token}`); await readyForm(page, "reset");
        await fillReset(page); await page.click("#recovery-reset-form button"); await statusStarts(page, copy.en.uncertain);
        await passwordsCleared(page); await readyForm(page, "reset"); await geometry(page); await cleanSurfaces(page);
        assert.equal(await page.execute("return !document.querySelector('#recovery-reset-form button').disabled && !document.getElementById('recovery-new-request').hidden"), true);
        assert.equal(fixture.calls.filter(call => call.kind === "reset").length, 1, "network failure never automatically replays a password change");
        await fillReset(page); await page.click("#recovery-reset-form button");
        if (consumed) { await statusStarts(page, copy.en.invalid); await readyForm(page, "request"); }
        else await waitUntil(() => page.execute("return document.getElementById('recovery-title').textContent === arguments[0]", copy.en.changed), "explicit retry succeeds when the token was not consumed");
        assert.equal(fixture.calls.filter(call => call.kind === "reset").length, 2);
        await passwordsCleared(page); await cleanSurfaces(page); cleanCalls(fixture);
      } finally { await page.close(); }
    });

    await t.test("an expired link clears its password form and offers a fresh neutral request", async () => {
      fixture.reset({ expired: true });
      const page = await driver.browser({ origin: fixture.origin, width: 320 });
      try {
        await openRecovery(page, "fr", `#reset=${token}`); await readyForm(page, "reset");
        await fillReset(page); await page.click("#recovery-reset-form button"); await statusStarts(page, copy.fr.invalid); await readyForm(page, "request");
        await passwordsCleared(page); await geometry(page); await cleanSurfaces(page);
        await page.type("#recovery-email", email); await page.click("#recovery-request-form button"); await statusStarts(page, copy.fr.accepted);
        assert.equal(fixture.calls.filter(call => call.kind === "reset").length, 1); cleanCalls(fixture);
      } finally { await page.close(); }
    });

    await t.test("a malformed fragment is removed and can never become a reset submission", async () => {
      fixture.reset();
      const page = await driver.browser({ origin: fixture.origin, width: 375 });
      try {
        await openRecovery(page, "en", `#reset=${token}&extra=1`); await readyForm(page, "request"); await statusStarts(page, copy.en.invalid);
        await cleanSurfaces(page); await geometry(page);
        assert.equal(await page.execute("return document.getElementById('recovery-reset-form').hidden"), true);
        await page.type("#recovery-email", email); await page.click("#recovery-request-form button"); await statusStarts(page, copy.en.accepted);
        assert.equal(fixture.calls.filter(call => call.kind === "reset").length, 0); cleanCalls(fixture);
      } finally { await page.close(); }
    });

    await t.test("reloading the cleaned URL cannot recover a token from browser storage", async () => {
      fixture.reset();
      const page = await driver.browser({ origin: fixture.origin, width: 375 });
      try {
        await openRecovery(page, "en", `#reset=${token}`); await readyForm(page, "reset");
        await fillReset(page); await cleanSurfaces(page);
        await page.navigate("/recover"); await readyForm(page, "request");
        assert.equal(await page.execute("return document.documentElement.lang"), "en");
        await passwordsCleared(page); await cleanSurfaces(page);
        assert.equal(fixture.calls.filter(call => call.kind === "reset").length, 0, "typed but unsubmitted passwords never reach the API");
        assert.equal(await page.execute("return document.getElementById('recovery-reset-form').hidden"), true);
        cleanCalls(fixture);
      } finally { await page.close(); }
    });

    await t.test("choosing a new link abandons a pending reset and cannot be overwritten by its acknowledgment", async () => {
      fixture.reset({ holdReset: true });
      const page = await driver.browser({ origin: fixture.origin, width: 320 });
      try {
        await openRecovery(page, "fr", `#reset=${token}`); await readyForm(page, "reset");
        await fillReset(page); await page.click("#recovery-reset-form button");
        await waitUntil(() => fixture.calls.some(call => call.kind === "reset"), "pending reset before deliberate abandonment");
        await page.click("#recovery-new-request"); await readyForm(page, "request");
        await passwordsCleared(page); await cleanSurfaces(page);
        fixture.release();
        await page.type("#recovery-email", email); await page.click("#recovery-request-form button"); await statusStarts(page, copy.fr.accepted);
        assert.equal(await page.execute("return document.getElementById('recovery-title').textContent"), "Retrouver ton accès.");
        assert.equal(fixture.calls.filter(call => call.kind === "reset").length, 1);
        assert.equal(fixture.calls.filter(call => call.kind === "request").length, 1);
        await passwordsCleared(page); await geometry(page); await cleanSurfaces(page); cleanCalls(fixture);
      } finally { await page.close(); }
    });

    await t.test("an intentionally disabled recovery keeps sign-in available and hides both forms", async () => {
      fixture.reset({ disabled: true });
      const page = await driver.browser({ origin: fixture.origin, width: 320 });
      try {
        await openRecovery(page, "fr", `#reset=${token}`);
        await statusStarts(page, "La récupération du mot de passe n’est pas disponible");
        assert.equal(await page.execute("return document.getElementById('recovery-reset-form').hidden && document.getElementById('recovery-request-form').hidden && document.getElementById('recovery-retry-capability').hidden"), true);
        await cleanSurfaces(page); await geometry(page);
        assert.equal(fixture.calls.filter(call => call.kind === "reset").length, 0);
        await page.click(".recovery-login"); await waitUntil(() => page.execute("return location.pathname === '/access'"), "sign-in remains available when recovery is disabled"); cleanCalls(fixture);
      } finally { await page.close(); }
    });
  } finally { await fixture?.close(); await driver.close(); }
});
