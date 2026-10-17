// Two real HTTPS origins, native host-only cookies, real transition pages and
// controller. Every identity and adapter is synthetic; no SQL, deployment,
// personal account, notification provider or production host is contacted.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { csrfToken } from "../../server/auth/crypto.mjs";
import { sessionCookie } from "../../server/auth/http.mjs";
import { createDeviceTransitionHandler } from "../../server/transition/http.mjs";
import { startWebDriver, waitUntil } from "./webdriver.mjs";

const run = promisify(execFile);
const cookieNames = Object.freeze({ admin: "__Host-jessie_session", client: "__Host-jessie_client" });
const notification = "a1".repeat(16);
const lifetime = 180 * 86400 * 1000;

async function certificate() {
  const directory = await mkdtemp(join(tmpdir(), "jessiemessage-transition-browser-"));
  await chmod(directory, 0o700);
  const keyPath = join(directory, "key.pem"), certPath = join(directory, "cert.pem");
  try {
    await run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1", "-subj", "/CN=jessiemessage.localhost", "-addext", "subjectAltName=DNS:jessiemessage.localhost,DNS:recette.jessiemessage.localhost", "-keyout", keyPath, "-out", certPath],
      { timeout: 10000, maxBuffer: 65536, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", OPENSSL_CONF: "/dev/null" } });
    await chmod(keyPath, 0o600); await chmod(certPath, 0o600);
    return { key: await readFile(keyPath), cert: await readFile(certPath), close: () => rm(directory, { recursive: true, force: true }) };
  } catch {
    await rm(directory, { recursive: true, force: true });
    throw new Error("Synthetic HTTPS certificate unavailable");
  }
}

async function protectedCookie(page, role, expected, host) {
  const found = (await page.cookies()).filter(cookie => cookie.name === cookieNames[role]);
  assert.equal(found.length, 1, "one native session cookie is present for this host");
  const selected = found[0];
  assert.equal(selected.value === expected, true, "handoff preserves the exact existing session rather than minting one");
  assert.deepEqual({ path: selected.path, secure: selected.secure, httpOnly: selected.httpOnly, sameSite: selected.sameSite, domain: selected.domain },
    { path: "/", secure: true, httpOnly: true, sameSite: "Strict", domain: host });
  assert.equal(await page.execute("return document.cookie.includes(arguments[0])", cookieNames[role]), false, "the session remains inaccessible to JavaScript");
}

async function noCredentialExposure(page, tokens) {
  assert.equal(await page.execute(`const tokens = arguments[0]; const surfaces = [location.href, document.documentElement.outerHTML, JSON.stringify({...localStorage}), JSON.stringify({...sessionStorage})]; return surfaces.every(surface => tokens.every(token => !surface.includes(token)));`, tokens), true,
    "raw session tokens never appear in the URL, DOM or web storage");
}

async function transitionFixture() {
  const tls = await certificate(), sessions = new Map(), requests = [], failures = [], heldResponses = new Set();
  let handler, legacyOrigin, primaryOrigin, active;
  const sessionFor = (role, token) => {
    if (active?.failNextSessionLookup) { active.failNextSessionLookup = false; throw new Error("Synthetic session backend failure"); }
    const current = sessions.get(token);
    return current?.user.role === role ? structuredClone(current) : null;
  };
  const json = (response, status, data) => { response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); response.end(JSON.stringify(data)); };
  const server = createServer({ key: tls.key, cert: tls.cert, minVersion: "TLSv1.2" }, (request, response) => {
    void (async () => {
      const url = new URL(request.url, "https://localhost"), host = request.headers.host;
      const isSource = host === new URL(legacyOrigin).host, isPrimary = host === new URL(primaryOrigin).host;
      if (!isSource && !isPrimary) { json(response, 421, { error: "fixture_authority" }); request.resume(); return; }
      const tokens = [active?.sourceToken, active?.targetToken].filter(Boolean);
      requests.push({ path: url.pathname, method: request.method, host, query: url.search, fragment: url.hash,
        rawTokenInUrl: tokens.some(token => request.url.includes(token)), rawTokenInReferrer: tokens.some(token => request.headers.referer?.includes(token)),
        sourceCookieAtPrimary: isPrimary && request.headers.cookie?.includes(`${cookieNames[active?.role]}=${active?.sourceToken}`) === true,
        sourceCookieAtSource: isSource && request.headers.cookie?.includes(`${cookieNames[active?.role]}=${active?.sourceToken}`) === true });
      if (url.pathname === "/__fixture" || url.pathname === "/__fixture/seed") {
        if (url.pathname.endsWith("/seed")) {
          const token = isSource ? active.sourceToken : active.targetToken;
          if (token) response.setHeader("Set-Cookie", sessionCookie(token, Date.now() + lifetime, cookieNames[active.role], { role: active.role }));
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end("<!doctype html><html lang=fr><title>Isolated browser fixture</title><main id=fixture>Isolated browser fixture</main></html>"); return;
      }
      if (url.pathname === "/api/auth/session" || url.pathname === "/api/access/session") {
        const role = url.pathname.includes("/auth/") ? "admin" : "client";
        const matching = request.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(`${cookieNames[role]}=`));
        const current = sessionFor(role, matching?.slice(cookieNames[role].length + 1));
        json(response, current ? 200 : 401, current ?? { error: "authentication_required" }); return;
      }
      if (url.pathname.endsWith("/begin") && active.failFirstBegin) {
        active.failFirstBegin = false; json(response, 503, { error: "transition_unavailable" }); request.resume(); return;
      }
      if (url.pathname.endsWith("/begin") && active.hangFirstBegin) {
        active.hangFirstBegin = false;
        heldResponses.add(response); response.once("close", () => heldResponses.delete(response));
        // The browser's actual eight-second deadline must abort this request.
        // Never manufacture a server timeout or release the UI from the test.
        request.resume(); return;
      }
      if (active.failAction && url.pathname.endsWith(`/${active.failAction}`)) {
        active.failAction = null;
        if (active.failureMode === "consumed") {
          // complete reserves the real record before this lookup fails. Its
          // handler returns 503, but the spent ticket cannot simply be replayed.
          active.failNextSessionLookup = true;
        } else if (active.failureMode === "timeout") {
          request.resume();
          heldResponses.add(response); response.once("close", () => heldResponses.delete(response));
          return;
        } else {
          request.resume();
          if (active.failureMode === "network") {
            // Closing before headers permits Chrome to retry the POST on a
            // reused connection. Deliver headers and an incomplete JSON body
            // first, then close with a declared length larger than the body.
            // Reading response.json() must fail without a timer or API replay.
            response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", "Content-Length": "128", Connection: "close" });
            response.end('{"ticket":');
          }
          else json(response, 503, { error: "transition_unavailable" });
          return;
        }
      }
      if (url.pathname.endsWith("/complete") && active.revokeBeforeComplete) sessions.delete(active.sourceToken);
      if (await handler(request, response)) return;
      if (["/i18n.js", "/i18n-access.js"].includes(url.pathname)) {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        response.end(await readFile(new URL(`../../public${url.pathname}`, import.meta.url))); return;
      }
      if (["/messages", "/admin/messages", "/access", "/admin/login"].includes(url.pathname)) {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Destination fixture</title><script src="/i18n.js" defer></script><script src="/i18n-access.js" defer></script></head><body><main id="destination"><p id="destination-copy" data-jm-i18n="Bienvenue.">Bienvenue.</p></main></body></html>'); return;
      }
      if (["/favicon.ico", "/brand/icon-128.png"].includes(url.pathname)) {
        response.writeHead(200, { "Content-Type": url.pathname.endsWith(".png") ? "image/png" : "image/x-icon", "Cache-Control": "no-store" });
        response.end(await readFile(new URL(`../../public${url.pathname}`, import.meta.url))); return;
      }
      json(response, 404, { error: "fixture_not_found" });
    })().catch(error => { failures.push(error?.name ?? "Error"); if (!response.headersSent) json(response, 500, { error: "fixture_failure" }); else response.destroy(); });
  });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const port = server.address().port;
    primaryOrigin = `https://jessiemessage.localhost:${port}`; legacyOrigin = `https://recette.jessiemessage.localhost:${port}`;
    handler = createDeviceTransitionHandler({ primaryOrigin, legacyOrigin,
      authService: { session: async token => sessionFor("admin", token) }, accessService: { session: async token => sessionFor("client", token) } });
    return { primaryOrigin, legacyOrigin, requests, failures, reset({ role, state = "active", target = null, missing = false, failFirstBegin = false, hangFirstBegin = false, revokeBeforeComplete = false, failAction = null, failureMode = "503" }) {
      sessions.clear(); requests.length = 0; failures.length = 0;
      const sourceToken = randomBytes(32).toString("base64url"), targetToken = target ? randomBytes(32).toString("base64url") : null;
      const sourceId = randomBytes(16).toString("hex"), targetId = target === "different" ? randomBytes(16).toString("hex") : sourceId;
      const dto = id => ({ user: { id, role, pseudonym: "Synthetic account" }, expiresAt: Date.now() + lifetime,
        ...(role === "client" ? { access: { state, admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: state !== "pending", expiresAt: null } } : {}) });
      if (!missing) sessions.set(sourceToken, { ...dto(sourceId), csrf: csrfToken(sourceToken) });
      if (targetToken) sessions.set(targetToken, { ...dto(targetId), csrf: csrfToken(targetToken) });
      active = { role, sourceToken, targetToken, failFirstBegin, hangFirstBegin, revokeBeforeComplete, failAction, failureMode };
      return { sourceToken, targetToken };
    }, async close() { for (const response of heldResponses) response.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await tls.close(); } };
  } catch (error) {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await tls.close(); throw error;
  }
}

async function seedTransition(page, fixture, { primaryLanguage = "fr", legacyLanguage = "fr" } = {}) {
  await page.navigate("/__fixture"); // The fresh browser starts at the destination.
  await page.navigate(`${fixture.legacyOrigin}/__fixture/seed`);
  await page.execute("sessionStorage.setItem('jessiemessage.language', arguments[0])", legacyLanguage);
  await page.navigate("/__fixture/seed");
  await page.execute("sessionStorage.setItem('jessiemessage.language', arguments[0])", primaryLanguage);
}

async function startTransition(page, fixture, role, reference = null, { language = "fr", primaryLanguage = "fr", legacyLanguage = "fr" } = {}) {
  await seedTransition(page, fixture, { primaryLanguage, legacyLanguage });
  await page.navigate(`/connect-device/${role}${reference ? `#notification=${reference}` : ""}`);
  await waitUntil(() => page.execute("return !!document.getElementById('transition-start') && !document.getElementById('transition-start').disabled"), "real transition start button");
  assert.equal(await page.execute("return location.hash"), "", "initial notification fragment is removed immediately");
  if (await page.execute("return document.documentElement.lang") !== language) await page.click("#transition-language");
  assert.equal(await page.execute("return document.documentElement.lang"), language);
  await page.click("#transition-start");
}

function cleanRequests(fixture) {
  assert.deepEqual(fixture.failures, [], "the HTTPS fixture has no internal failures");
  assert.equal(fixture.requests.every(request => !request.query && !request.fragment && !request.rawTokenInUrl && !request.rawTokenInReferrer), true,
    "server requests never carry ticket fragments, query credentials or raw session tokens");
}

async function transitionDiagnostics(page, fixture) {
  // Only fixed route names, UI categories and counts: never URL fragments,
  // packet bodies, notification references or protected cookie values.
  const ui = await page.execute(`const status = document.getElementById('transition-status')?.textContent ?? '';
    return { pathname: location.pathname, status: document.getElementById('destination') ? 'destination'
      : document.getElementById('transition-start')?.textContent === 'Réessayer' ? 'retry'
      : status.startsWith('Un instant') ? 'preparing' : status.startsWith('Pour retrouver tes messages') ? 'missing'
      : status.startsWith('Un autre compte') ? 'conflict' : 'other' };`).catch(() => ({ pathname: "unavailable", status: "unavailable" }));
  const requestCounts = {};
  for (const { path } of fixture.requests) if (/^\/api\/(?:auth\/session|access\/session|device-transition\/(?:admin|client)\/(?:begin|authorize|complete))$/.test(path)) {
    requestCounts[path] = (requestCounts[path] ?? 0) + 1;
  }
  return { ...ui, requestCounts };
}

test("real Chrome: two HTTPS hosts preserve native protected sessions through the real device transition", { timeout: 90000 }, async t => {
  const driver = await startWebDriver();
  let fixture;
  try {
    fixture = await transitionFixture();
    const browser = () => driver.browser({ origin: fixture.primaryOrigin, siblingOrigins: [fixture.legacyOrigin], acceptInsecureCerts: true, width: 360 });
    for (const { role, state, destination } of [
      { role: "admin", state: "active", destination: "/admin/messages" },
      { role: "client", state: "active", destination: "/messages" },
      { role: "client", state: "pending", destination: "/access" },
    ]) await t.test(`${role} ${state}: native source cookie, exact token and notification reference survive`, async () => {
      const tokens = fixture.reset({ role, state }), page = await browser();
      try {
        await startTransition(page, fixture, role, notification);
        await waitUntil(() => page.execute("return !!document.getElementById('destination') && location.origin === arguments[0] && location.pathname === arguments[1]", fixture.primaryOrigin, destination), "target page after the real transition");
        assert.equal(await page.execute("return location.hash"), `#notification=${notification}`);
        await protectedCookie(page, role, tokens.sourceToken, new URL(fixture.primaryOrigin).hostname);
        assert.equal((await page.cookies()).some(cookie => cookie.name.startsWith("__Host-jessie_transition_")), false, "completion clears the temporary nonce cookie");
        await noCredentialExposure(page, [tokens.sourceToken]);
        assert.equal(fixture.requests.some(request => request.path.endsWith("/authorize") && request.sourceCookieAtSource), true, "the browser natively sends the original host-only source cookie");
        assert.equal(fixture.requests.some(request => request.path.endsWith("/complete") && request.sourceCookieAtPrimary), false, "the old host-only session is not sent to the target before completion");
        await page.navigate(`${fixture.legacyOrigin}/__fixture`);
        await protectedCookie(page, role, tokens.sourceToken, new URL(fixture.legacyOrigin).hostname);
        cleanRequests(fixture);
      } finally { await page.close(); }
    });

    await t.test("a transient start failure offers a real retry and then succeeds", async () => {
      const tokens = fixture.reset({ role: "admin", failFirstBegin: true }), page = await browser();
      try {
        await startTransition(page, fixture, "admin");
        await waitUntil(() => page.execute("return document.getElementById('transition-start')?.textContent === 'Réessayer' && !document.getElementById('transition-start').disabled"), "retry after an unavailable request");
        assert.equal((await page.cookies()).some(cookie => cookie.name === cookieNames.admin), false);
        await page.click("#transition-start");
        await waitUntil(() => page.execute("return location.pathname === '/admin/messages' && !!document.getElementById('destination')"), "successful retried handoff");
        await protectedCookie(page, "admin", tokens.sourceToken, new URL(fixture.primaryOrigin).hostname);
        await noCredentialExposure(page, [tokens.sourceToken]); cleanRequests(fixture);
      } finally { await page.close(); }
    });

    await t.test("an unanswered network request times out, restores retry and then succeeds", async () => {
      const tokens = fixture.reset({ role: "client", hangFirstBegin: true }), page = await browser();
      try {
        await startTransition(page, fixture, "client");
        await waitUntil(() => page.execute("return document.getElementById('transition-start')?.textContent === 'Réessayer' && !document.getElementById('transition-start').disabled"), "real browser deadline releases the retry button", 15000);
        assert.equal(fixture.requests.filter(request => request.path.endsWith("/begin")).length, 1, "the controller never silently retries a timed-out request");
        assert.equal((await page.cookies()).some(cookie => cookie.name === cookieNames.client), false);
        await page.click("#transition-start");
        await waitUntil(() => page.execute("return location.pathname === '/messages' && !!document.getElementById('destination')"), "successful handoff after the network deadline");
        await protectedCookie(page, "client", tokens.sourceToken, new URL(fixture.primaryOrigin).hostname);
        assert.equal((await page.cookies()).some(cookie => cookie.name.startsWith("__Host-jessie_transition_")), false);
        await noCredentialExposure(page, [tokens.sourceToken]); cleanRequests(fixture);
      } finally { await page.close(); }
    });

    for (const failAction of ["authorize", "complete"]) for (const failureMode of ["503", "network", "timeout", ...(failAction === "complete" ? ["consumed"] : [])]) {
      // Exercise both independent roles while keeping real eight-second
      // deadlines, native host-only cookies and the complete two-origin flow.
      const role = failAction === "authorize" ? "admin" : "client";
      await t.test(`${role}: ${failAction} ${failureMode} retries to the exact notified message`, async () => {
        const tokens = fixture.reset({ role, failAction, failureMode }), page = await browser();
        try {
          await startTransition(page, fixture, role, notification);
          await waitUntil(() => page.execute("return document.getElementById('transition-start')?.textContent === 'Réessayer' && !document.getElementById('transition-start').disabled"), "retry after the actual interrupted handoff", 15000);
          assert.equal(await page.execute("return location.origin"), failAction === "authorize" ? fixture.legacyOrigin : fixture.primaryOrigin);
          assert.equal(await page.execute("return location.hash"), "", "the packet and hint are removed before awaiting the request");
          assert.equal(fixture.requests.filter(request => request.path.endsWith(`/${failAction}`)).length, 1, "no implicit replay of a failed operation");
          await noCredentialExposure(page, [tokens.sourceToken]);
          await page.click("#transition-start");
          if (failAction === "authorize") {
            // A fresh browser-bound request must begin on the destination.
            await waitUntil(() => page.execute("return location.origin === arguments[0] && location.pathname === arguments[1] && document.getElementById('transition-start')?.textContent === 'Retrouver mon espace'", fixture.primaryOrigin, `/connect-device/${role}`), "explicit restart at the primary address");
            await page.click("#transition-start");
          }
          const destination = role === "admin" ? "/admin/messages" : "/messages";
          await waitUntil(() => page.execute("return location.origin === arguments[0] && location.pathname === arguments[1] && !!document.getElementById('destination')", fixture.primaryOrigin, destination), "notified message after the retry");
          assert.equal(await page.execute("return location.hash"), `#notification=${notification}`);
          assert.equal(fixture.requests.filter(request => request.path.endsWith("/begin")).length, 2, "retry creates a fresh browser-bound handoff rather than replaying a spent ticket");
          await protectedCookie(page, role, tokens.sourceToken, new URL(fixture.primaryOrigin).hostname);
          assert.equal((await page.cookies()).some(cookie => cookie.name.startsWith("__Host-jessie_transition_")), false);
          await noCredentialExposure(page, [tokens.sourceToken]); cleanRequests(fixture);
        } catch (error) {
          t.diagnostic(JSON.stringify(await transitionDiagnostics(page, fixture)));
          throw error;
        } finally { await page.close(); }
      });
    }

    await t.test("a forged retry hint cannot replace the real ticket's authenticated notification destination", async () => {
      const role = "client", tokens = fixture.reset({ role }), page = await browser();
      try {
        await seedTransition(page, fixture);
        const challenge = await page.executeAsync(`const done = arguments[arguments.length - 1];
          fetch('/api/device-transition/client/begin', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Jessie-Request': '1' }, body: JSON.stringify({ notification: arguments[0] }) })
            .then(response => response.json()).then(result => done(result.challenge), () => done(null));`, notification);
        assert.match(challenge, /^[A-Za-z0-9_-]{80,2048}$/);
        await page.navigate(`${fixture.legacyOrigin}/connect-device/${role}#challenge=${challenge}&notification=${"b2".repeat(16)}`);
        await waitUntil(() => page.execute("return location.origin === arguments[0] && location.pathname === '/messages' && !!document.getElementById('destination')", fixture.primaryOrigin), "authenticated destination despite a different public retry hint");
        assert.equal(await page.execute("return location.hash"), `#notification=${notification}`);
        await protectedCookie(page, role, tokens.sourceToken, new URL(fixture.primaryOrigin).hostname);
        await noCredentialExposure(page, [tokens.sourceToken]); cleanRequests(fixture);
      } finally { await page.close(); }
    });

    await t.test("revocation after authorization cannot install the previously valid source session", async () => {
      const tokens = fixture.reset({ role: "client", revokeBeforeComplete: true }), page = await browser();
      try {
        await startTransition(page, fixture, "client");
        await waitUntil(() => page.execute("return location.origin === arguments[0] && !!document.getElementById('transition-login') && !document.getElementById('transition-login').hidden", fixture.primaryOrigin), "revoked session asks for sign-in");
        assert.equal(await page.execute("return location.hash"), "");
        assert.equal((await page.cookies()).some(cookie => cookie.name === cookieNames.client), false, "a revoked source cannot create a target session");
        await noCredentialExposure(page, [tokens.sourceToken]); cleanRequests(fixture);
      } finally { await page.close(); }
    });

    await t.test("a different target account is preserved and the page explains the conflict", async () => {
      const tokens = fixture.reset({ role: "admin", target: "different" }), page = await browser();
      try {
        await startTransition(page, fixture, "admin");
        await waitUntil(() => page.execute("return document.getElementById('transition-status')?.textContent.startsWith('Un autre compte est déjà ouvert')"), "account-conflict explanation");
        assert.equal(await page.execute("return location.origin"), fixture.primaryOrigin);
        assert.equal(await page.execute("return location.hash"), "");
        await protectedCookie(page, "admin", tokens.targetToken, new URL(fixture.primaryOrigin).hostname);
        await noCredentialExposure(page, [tokens.sourceToken, tokens.targetToken]); cleanRequests(fixture);
      } finally { await page.close(); }
    });

    await t.test("an existing target session for the same account is kept", async () => {
      const tokens = fixture.reset({ role: "client", target: "same" }), page = await browser();
      try {
        await startTransition(page, fixture, "client");
        await waitUntil(() => page.execute("return location.pathname === '/messages' && !!document.getElementById('destination')"), "already connected target account");
        await protectedCookie(page, "client", tokens.targetToken, new URL(fixture.primaryOrigin).hostname);
        assert.equal((await page.cookies()).some(cookie => cookie.name.startsWith("__Host-jessie_transition_")), false);
        await noCredentialExposure(page, [tokens.sourceToken, tokens.targetToken]); cleanRequests(fixture);
      } finally { await page.close(); }
    });

    await t.test("a missing source session offers sign-in at the new address with the notification reference", async () => {
      const tokens = fixture.reset({ role: "client", missing: true }), page = await browser();
      try {
        await startTransition(page, fixture, "client", notification);
        await waitUntil(() => page.execute("return location.origin === arguments[0] && !!document.getElementById('transition-login') && !document.getElementById('transition-login').hidden", fixture.legacyOrigin), "source session missing notice");
        assert.equal(await page.execute("return location.hash"), "");
        assert.equal(await page.execute("return document.getElementById('transition-login').href"), `${fixture.primaryOrigin}/connect-device/client#signin=fr&notification=${notification}`);
        await noCredentialExposure(page, [tokens.sourceToken]);
        await page.click("#transition-login");
        await waitUntil(() => page.execute("return location.origin === arguments[0] && location.pathname === '/access' && !!document.getElementById('destination')", fixture.primaryOrigin), "new-address sign-in destination");
        assert.equal(await page.execute("return location.hash"), `#notification=${notification}`);
        assert.equal((await page.cookies()).some(cookie => cookie.name === cookieNames.client), false);
        cleanRequests(fixture);
      } finally { await page.close(); }
    });
  } finally { try { await driver.close(); } finally { await fixture?.close(); } }
});

async function transitionLayout(page) {
  return page.execute(`
    const box = node => {
      const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
      return { id: node.id || node.className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: rect.width, height: rect.height, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
        background: style.backgroundColor };
    };
    const visible = node => node.getClientRects().length > 0;
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, language: document.documentElement.lang,
      card: box(document.querySelector('.transition-card')), brand: box(document.querySelector('.brand')),
      languageButton: box(document.getElementById('transition-language')),
      actions: [...document.querySelectorAll('#transition-login, #transition-start')].filter(visible).map(box),
      loginVisible: visible(document.getElementById('transition-login')),
      back: box(document.getElementById('transition-back')) };
  `);
}

function checkTransitionLayout(layout, { width, language, missing, context }) {
  assert.equal(layout.width, width, `${context}: exact viewport width`);
  assert.equal(layout.language, language, `${context}: selected language is rendered`);
  assert.ok(layout.scrollWidth <= width, `${context}: no horizontal page overflow`);
  assert.ok(layout.card.left >= 0 && layout.card.right <= width, `${context}: the card stays inside the viewport`);
  assert.equal(layout.loginVisible, missing, `${context}: sign-in is shown only when the previous session is missing`);
  const controls = [layout.brand, layout.languageButton, ...layout.actions, layout.back];
  for (const control of controls) {
    assert.ok(control.left >= layout.card.left && control.right <= layout.card.right, `${context}: ${control.id} stays inside the card`);
    assert.ok(control.height >= 44 && control.width >= 44, `${context}: ${control.id} keeps its touch target`);
    assert.ok(control.scrollWidth <= control.clientWidth + 1, `${context}: ${control.id} does not clip its label horizontally`);
  }
  const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  assert.equal(overlap(layout.brand, layout.languageButton), false, `${context}: brand and language control do not overlap`);
  assert.deepEqual(layout.actions.map(({ id }) => id), missing ? ["transition-login", "transition-start"] : ["transition-start"], `${context}: DOM order matches action priority`);
  for (let index = 1; index < layout.actions.length; index += 1) {
    assert.ok(layout.actions[index].top - layout.actions[index - 1].bottom >= 12 - 0.1, `${context}: dynamic actions keep a twelve-pixel gap`);
  }
  if (missing) assert.notEqual(layout.actions[0].background, layout.actions[1].background, `${context}: sign-in and Retry have distinct visual priority`);
  assert.ok(layout.back.top >= layout.actions.at(-1).bottom, `${context}: the return link does not overlap the actions`);
}

test("real Chrome: transition actions stay distinct and accessible in every responsive state and language", { timeout: 120000 }, async t => {
  const driver = await startWebDriver();
  let fixture;
  try {
    fixture = await transitionFixture();
    const scenarios = [
      { name: "initial", role: "client" },
      { name: "preparing", role: "client", hangFirstBegin: true },
      { name: "unavailable", role: "client", failFirstBegin: true },
      { name: "missing client", role: "client", missing: true },
      { name: "missing administrator", role: "admin", missing: true },
      { name: "account conflict", role: "admin", target: "different" },
    ];
    for (const width of [320, 360, 390, 635]) for (const scenario of scenarios) {
      await t.test(`${scenario.name}, ${width}px: French and English`, async () => {
        fixture.reset(scenario);
        const page = await driver.browser({ origin: fixture.primaryOrigin, siblingOrigins: [fixture.legacyOrigin], acceptInsecureCerts: true, width });
        try {
          if (scenario.name === "initial") {
            await page.navigate("/__fixture");
            await page.execute("sessionStorage.setItem('jessiemessage.language', 'fr')");
            await page.navigate(`/connect-device/${scenario.role}`);
            await waitUntil(() => page.execute("return document.getElementById('transition-start')?.textContent === 'Retrouver mon espace'"), "initial transition rendered");
          } else {
            await startTransition(page, fixture, scenario.role, notification);
            await waitUntil(() => page.execute(`
              const start = document.getElementById('transition-start'), login = document.getElementById('transition-login');
              if (!start || !login) return false;
              if (arguments[0] === 'preparing') return start.disabled;
              if (arguments[1]) return !login.hidden && !start.disabled;
              if (arguments[0] === 'account conflict') return document.getElementById('transition-status').textContent.startsWith('Un autre compte est déjà ouvert');
              return start.textContent === 'Réessayer' && !start.disabled;
            `, scenario.name, Boolean(scenario.missing)), "the real transition state is visible");
          }
          for (const language of ["fr", "en"]) {
            if (language === "en") await page.click("#transition-language");
            const context = `${scenario.name}, ${width}px, ${language}`;
            const layout = await transitionLayout(page);
            checkTransitionLayout(layout, { width, language, missing: Boolean(scenario.missing), context });
            if (scenario.name !== "preparing") {
              await page.execute("document.getElementById('transition-language').focus()");
              await page.key("\uE004");
              const focus = await page.execute(`
                const node = document.activeElement, rect = node.getBoundingClientRect(), style = getComputedStyle(node);
                return { id: node.id, left: rect.left, right: rect.right,
                  outlineWidth: parseFloat(style.outlineWidth), outlineOffset: parseFloat(style.outlineOffset), outlineStyle: style.outlineStyle };
              `);
              assert.equal(focus.id, scenario.missing ? "transition-login" : "transition-start", `${context}: the first Tab reaches the primary available action`);
              assert.notEqual(focus.outlineStyle, "none", `${context}: keyboard focus remains visible`);
              assert.ok(focus.outlineWidth >= 2, `${context}: keyboard focus has a visible outline`);
              const clearance = focus.outlineWidth + focus.outlineOffset;
              assert.ok(focus.left - clearance >= layout.card.left && focus.right + clearance <= layout.card.right, `${context}: focus ring stays clear of the card edges`);
              if (scenario.missing) assert.ok(layout.actions[1].top - layout.actions[0].bottom >= clearance, `${context}: the sign-in focus ring does not touch Retry`);
            }
          }
          cleanRequests(fixture);
        } finally { await page.close(); }
      });
    }
  } finally { try { await driver.close(); } finally { await fixture?.close(); } }
});

async function translatedDestination(page, fixture, path, language, reference) {
  const expected = language === "en" ? "Welcome." : "Bienvenue.";
  await waitUntil(() => page.execute(`return location.origin === arguments[0] && location.pathname === arguments[1]
    && document.documentElement.lang === arguments[2] && globalThis.JessieI18n?.getLanguage() === arguments[2]
    && document.getElementById('destination-copy')?.textContent === arguments[3]`, fixture.primaryOrigin, path, language, expected), "the destination uses the actual shared language runtime and catalog");
  assert.equal(await page.execute("return location.hash"), reference ? `#notification=${reference}` : "", "only the canonical notification fragment reaches the destination");
  assert.equal(await page.execute("return sessionStorage.getItem('jessiemessage.language')"), language);
}

test("real Chrome: the chosen language survives both origins, retries and the sign-in fallback", { timeout: 90000 }, async t => {
  const driver = await startWebDriver();
  let fixture;
  try {
    fixture = await transitionFixture();
    const browser = () => driver.browser({ origin: fixture.primaryOrigin, siblingOrigins: [fixture.legacyOrigin], acceptInsecureCerts: true, width: 360 });

    for (const role of ["admin", "client"]) await t.test(`${role}: English overrides an old French source preference and reaches a genuinely translated destination`, async () => {
      const tokens = fixture.reset({ role }), page = await browser();
      try {
        await startTransition(page, fixture, role, notification, { language: "en", primaryLanguage: "fr", legacyLanguage: "fr" });
        await translatedDestination(page, fixture, role === "admin" ? "/admin/messages" : "/messages", "en", notification);
        await protectedCookie(page, role, tokens.sourceToken, new URL(fixture.primaryOrigin).hostname);
        await noCredentialExposure(page, [tokens.sourceToken]);
        await page.navigate(`${fixture.legacyOrigin}/__fixture`);
        assert.equal(await page.execute("return sessionStorage.getItem('jessiemessage.language')"), "en", "the source preference also follows the chosen language");
        cleanRequests(fixture);
      } finally { await page.close(); }
    });

    await t.test("an English source error followed by a French choice keeps the latest language and notification through retry", async () => {
      const role = "client", tokens = fixture.reset({ role, failAction: "authorize", failureMode: "503" }), page = await browser();
      try {
        await startTransition(page, fixture, role, notification, { language: "en", primaryLanguage: "fr", legacyLanguage: "fr" });
        await waitUntil(() => page.execute("return location.origin === arguments[0] && document.getElementById('transition-start')?.textContent === 'Try again' && !document.getElementById('transition-start').disabled", fixture.legacyOrigin), "a real source failure is shown in English");
        assert.equal(await page.execute("return sessionStorage.getItem('jessiemessage.language')"), "en");
        await page.click("#transition-language");
        assert.equal(await page.execute("return globalThis.JessieI18n.getLanguage()"), "fr");
        await page.click("#transition-start");
        await waitUntil(() => page.execute("return location.origin === arguments[0] && document.getElementById('transition-start')?.textContent === 'Retrouver mon espace'", fixture.primaryOrigin), "the retry overwrites the primary's older English preference");
        assert.equal(await page.execute("return sessionStorage.getItem('jessiemessage.language')"), "fr");
        await page.click("#transition-start");
        await translatedDestination(page, fixture, "/messages", "fr", notification);
        assert.equal(fixture.requests.filter(({ path }) => path.endsWith("/begin")).length, 2, "a retry starts a fresh handoff");
        await protectedCookie(page, role, tokens.sourceToken, new URL(fixture.primaryOrigin).hostname);
        await noCredentialExposure(page, [tokens.sourceToken]); cleanRequests(fixture);
      } finally { await page.close(); }
    });

    await t.test("missing source sign-in carries its latest language and the server's reference instead of a forged retry hint", async () => {
      const role = "client", authenticated = notification, forged = "b2".repeat(16);
      const tokens = fixture.reset({ role, missing: true }), page = await browser();
      try {
        await seedTransition(page, fixture, { primaryLanguage: "en", legacyLanguage: "fr" });
        const challenge = await page.executeAsync(`const done = arguments[arguments.length - 1];
          fetch('/api/device-transition/client/begin', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Jessie-Request': '1' }, body: JSON.stringify({ notification: arguments[0] }) })
            .then(response => response.json()).then(result => done(result.challenge), () => done(null));`, authenticated);
        assert.match(challenge, /^[A-Za-z0-9_-]{80,2048}$/);
        await page.navigate(`${fixture.legacyOrigin}/connect-device/client#challenge=${challenge}&notification=${forged}&locale=en`);
        await waitUntil(() => page.execute("return location.origin === arguments[0] && document.getElementById('transition-login')?.hidden === false && document.documentElement.lang === 'en'", fixture.legacyOrigin), "missing source session is explained in the requested language");
        assert.equal(await page.execute("return document.getElementById('transition-login').href"), `${fixture.primaryOrigin}/connect-device/client#signin=en&notification=${authenticated}`);
        await page.click("#transition-language");
        assert.equal(await page.execute("return document.getElementById('transition-login').href"), `${fixture.primaryOrigin}/connect-device/client#signin=fr&notification=${authenticated}`, "changing language updates the existing sign-in action");
        const apiCount = fixture.requests.filter(({ path }) => path.startsWith("/api/")).length;
        await page.click("#transition-login");
        await translatedDestination(page, fixture, "/access", "fr", authenticated);
        assert.equal(fixture.requests.filter(({ path }) => path.startsWith("/api/")).length, apiCount, "the sign-in preference hop performs no authentication API request");
        assert.equal((await page.cookies()).some(({ name }) => name === cookieNames.client), false, "a preference cannot create a primary session");
        await noCredentialExposure(page, [tokens.sourceToken]); cleanRequests(fixture);
      } finally { await page.close(); }
    });
  } finally { try { await driver.close(); } finally { await fixture?.close(); } }
});
