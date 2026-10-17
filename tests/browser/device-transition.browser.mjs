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
      if (["/messages", "/admin/messages", "/access", "/admin/login"].includes(url.pathname)) {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end("<!doctype html><html lang=fr><title>Destination fixture</title><main id=destination>Destination fixture</main></html>"); return;
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

async function startTransition(page, fixture, role, reference = null) {
  await page.navigate("/__fixture"); // The fresh browser starts at the destination.
  await page.navigate(`${fixture.legacyOrigin}/__fixture/seed`);
  await page.navigate("/__fixture/seed");
  await page.navigate(`/connect-device/${role}${reference ? `#notification=${reference}` : ""}`);
  await waitUntil(() => page.execute("return !!document.getElementById('transition-start') && !document.getElementById('transition-start').disabled"), "real transition start button");
  assert.equal(await page.execute("return location.hash"), "", "initial notification fragment is removed immediately");
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
      : status.startsWith('Un instant') ? 'preparing' : status.startsWith('La connexion de cet appareil') ? 'missing'
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
        await page.navigate("/__fixture");
        await page.navigate(`${fixture.legacyOrigin}/__fixture/seed`);
        await page.navigate("/__fixture/seed");
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
        assert.equal(await page.execute("return document.getElementById('transition-login').href"), `${fixture.primaryOrigin}/access#notification=${notification}`);
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
