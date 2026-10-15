// Separate from *.browser.mjs: this rehearsal requires the explicitly enabled,
// disposable MariaDB fixture as well as real Chrome. No production credentials.
import assert from "node:assert/strict";
import test from "node:test";
import { request as httpsRequest } from "node:https";
import { startWebDriver, waitUntil } from "../browser/webdriver.mjs";
import { createAuthenticationFixture } from "./auth-fixture.mjs";

const cookieName = "__Host-jessie_session";
const incorrectFactor = "Les identifiants ou le code de sécurité sont incorrects.";

// TLS verification is relaxed only for a request to this fixture's HTTPS
// loopback origin, whose private self-signed certificate is generated per run.
// This is not a deployment certificate / reverse-proxy certification.
async function fixtureRequest(origin, path, { cookie, method = "GET", headers = {}, body } = {}) {
  const base = new URL(origin), url = new URL(path, origin);
  if (base.protocol !== "https:" || !["127.0.0.1", "[::1]", "localhost"].includes(base.hostname)
    || base.username || base.password || url.origin !== base.origin) throw new Error("HTTPS loopback fixture required");
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { method, rejectUnauthorized: false, timeout: 10000,
      headers: { ...headers, ...(cookie ? { Cookie: `${cookie.name}=${cookie.value}` } : {}) } }, (response) => {
      let text = "", bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { request.destroy(); reject(new Error("Fixture response exceeded rehearsal limit")); return; }
        text += chunk.toString("utf8");
      });
      response.once("error", () => reject(new Error("Fixture HTTPS response unavailable")));
      response.once("end", () => {
        let data = null; try { data = JSON.parse(text); } catch {}
        resolve({ status: response.statusCode, headers: response.headers, data });
      });
    });
    request.once("timeout", () => { request.destroy(); reject(new Error("Fixture HTTPS request timed out")); });
    request.once("error", () => reject(new Error("Fixture HTTPS request unavailable")));
    if (body !== undefined) request.write(body);
    request.end();
  });
}
async function loginForm(page) {
  await waitUntil(() => page.execute("return !!document.getElementById('login-form') && !document.getElementById('login-form').hidden && !document.getElementById('login-button').disabled"), "real login form available");
}
async function submitLogin(page, fixture, factor) {
  await loginForm(page);
  await page.type("#email", fixture.email);
  await page.type("#password", fixture.password);
  await page.type("#factor", factor);
  await page.click("#login-button");
}
async function rejectedLogin(page) {
  await waitUntil(() => page.execute("return document.getElementById('auth-status').textContent === arguments[0] && !document.getElementById('login-button').disabled", incorrectFactor), "invalid MFA is rejected by the real service");
  assert.equal(await page.execute("return document.getElementById('connected').hidden"), true);
  assert.equal((await page.cookies()).some((cookie) => cookie.name === cookieName), false, "a rejected factor must not create a session cookie");
  assert.equal(await page.execute("return document.getElementById('password').value === '' && document.getElementById('factor').value === ''"), true, "rejected credentials are cleared from the form");
}
async function connected(page) {
  await waitUntil(() => page.execute("return !!document.getElementById('connected') && !document.getElementById('connected').hidden && location.pathname === '/admin'"), "real administrator session confirmed in the DOM");
}
async function sessionCookie(page) {
  const cookies = (await page.cookies()).filter((cookie) => cookie.name === cookieName);
  assert.equal(cookies.length, 1, "the browser accepts one __Host- administrator cookie");
  const cookie = cookies[0];
  // Never pass the full cookie or its value into an assertion / diagnostic.
  assert.deepEqual({ name: cookie.name, path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite },
    { name: cookieName, path: "/", secure: true, httpOnly: true, sameSite: "Strict" });
  assert.equal(typeof cookie.value === "string" && /^[A-Za-z0-9_-]{43}$/.test(cookie.value), true, "session token has the expected opaque format");
  assert.equal(await page.execute("return document.cookie.split(';').some(part => part.trim().startsWith('__Host-jessie_session='))"), false, "HttpOnly administrator cookie is invisible to JavaScript");
  return cookie;
}
async function entry(page, state) {
  await page.navigate("/app");
  const destination = state === "connected" ? "/admin" : "/admin/login";
  await waitUntil(() => page.execute("const link = document.getElementById('administrator-link'); return !!link && !link.hidden && link.getAttribute('href') === arguments[0]", destination), `neutral opening shows administrator ${state} choice`);
  assert.equal(await page.execute("return location.protocol"), "https:", "the actual browser is using HTTPS, not localhost HTTP cookie exceptions");
  assert.equal(await page.execute("return document.getElementById('client-card').hidden"), true, "the fixture has no client access service");
}
async function signedOutEntry(origin) {
  const result = await fixtureRequest(origin, "/api/entry");
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { status: "available", client: null, administrator: { state: "signed_out", href: "/admin/login" } });
}

test("real Chrome + MariaDB: HTTPS administrator MFA, protected cookie, revocation, expiry and recovery replay", { timeout: 150000 }, async (t) => {
  // Resolve the real browser prerequisite first. Missing Chrome is a failure,
  // never a synthetic success or a reason to connect to an arbitrary database.
  const driver = await startWebDriver();
  let fixture, page;
  try {
    fixture = await createAuthenticationFixture();
    page = await driver.browser({ origin: fixture.origin, acceptInsecureCerts: true });

    assert.equal((await fixtureRequest(fixture.origin, "/api/auth/session")).status, 401, "anonymous API session is denied");
    const privatePage = await fixtureRequest(fixture.origin, "/admin");
    assert.equal(privatePage.status, 303); assert.equal(privatePage.headers.location, "/admin/login");
    await signedOutEntry(fixture.origin);
    await entry(page, "signed_out");
    await page.click("#administrator-link"); await loginForm(page);
    assert.equal(await page.execute("return location.pathname"), "/admin/login");
    t.diagnostic("Anonymous API / protected page and HTTPS neutral opening verified.");

    await submitLogin(page, fixture, fixture.invalidTotp()); await rejectedLogin(page);
    assert.equal((await fixtureRequest(fixture.origin, "/api/auth/session")).status, 401);
    const acceptedTotp = fixture.currentTotp();
    await submitLogin(page, fixture, acceptedTotp); await connected(page);
    const initialCookie = await sessionCookie(page);
    assert.equal(await page.execute("return ['email', 'password', 'factor'].every(id => document.getElementById(id).value === '')"), true, "successful login clears credential fields");
    // Check reuse immediately, without first navigating / logging out. A fresh
    // window on both sides rules out expiry as the reason for this rejection.
    assert.equal(fixture.isTotpFresh(acceptedTotp), true, "accepted OTP is still within the server's verification window before replay");
    const replayedTotp = await fixtureRequest(fixture.origin, "/api/auth/login", { method: "POST",
      headers: { Origin: fixture.origin, "Content-Type": "application/json", "X-Jessie-Request": "1" },
      body: JSON.stringify({ email: fixture.email, password: fixture.password, factor: acceptedTotp }) });
    assert.equal(replayedTotp.status, 401, "a previously accepted OTP is rejected even while its time window remains valid");
    assert.equal(fixture.isTotpFresh(acceptedTotp), true, "OTP replay did not merely wait for expiry");
    t.diagnostic("Wrong MFA rejected without cookie; real password + TOTP login and browser cookie protection verified.");

    const proof = await fixtureRequest(fixture.origin, "/api/auth/session", { cookie: initialCookie });
    assert.equal(proof.status, 200);
    const deniedCsrf = await fixtureRequest(fixture.origin, "/api/auth/logout", { cookie: initialCookie, method: "POST", body: "{}",
      headers: { Origin: fixture.origin, "Content-Type": "application/json", "X-CSRF-Token": "invalid-test-csrf" } });
    assert.equal(deniedCsrf.status, 403, "logout with incorrect CSRF is refused");
    assert.equal((await fixtureRequest(fixture.origin, "/api/auth/session", { cookie: initialCookie })).status, 200, "CSRF rejection leaves the session usable");
    const deniedOrigin = await fixtureRequest(fixture.origin, "/api/auth/logout", { cookie: initialCookie, method: "POST", body: "{}",
      headers: { Origin: "https://wrong-origin.example.invalid", "Content-Type": "application/json", "X-CSRF-Token": proof.data.csrf } });
    assert.equal(deniedOrigin.status, 403, "logout with a foreign Origin is refused even with the current CSRF token");
    assert.equal((await fixtureRequest(fixture.origin, "/api/auth/session", { cookie: initialCookie })).status, 200, "Origin rejection leaves the session usable");
    const authenticatedEntry = await fixtureRequest(fixture.origin, "/api/entry", { cookie: initialCookie });
    assert.equal(authenticatedEntry.status, 200);
    assert.deepEqual(authenticatedEntry.data, { status: "available", client: null, administrator: { state: "connected", href: "/admin" } });
    await entry(page, "connected"); await page.click("#administrator-link"); await connected(page);
    t.diagnostic("CSRF / Origin refusals preserve the session; /api/entry, /app and /admin recognize the real cookie.");

    await page.click("#logout-button"); await loginForm(page);
    await waitUntil(() => page.execute("return location.pathname === '/admin/login'"), "logout returns to the login URL");
    assert.equal((await page.cookies()).some((cookie) => cookie.name === cookieName), false);
    assert.equal((await fixtureRequest(fixture.origin, "/api/auth/session", { cookie: initialCookie })).status, 401, "the old cookie is revoked in SQL, not merely removed from the browser");
    await entry(page, "signed_out"); await signedOutEntry(fixture.origin);
    await page.click("#administrator-link"); await loginForm(page);
    t.diagnostic("DOM logout removes the cookie and revokes it in SQL; the neutral opening returns to sign-in.");

    await submitLogin(page, fixture, fixture.recoveryCodes[0]); await connected(page);
    const recoveryCookie = await sessionCookie(page);
    await fixture.expireSession();
    assert.equal((await fixtureRequest(fixture.origin, "/api/auth/session", { cookie: recoveryCookie })).status, 401, "SQL expiry rejects a cookie still present in the browser");
    await page.navigate("/admin"); await loginForm(page);
    assert.equal(await page.execute("return location.pathname"), "/admin/login");
    await submitLogin(page, fixture, fixture.recoveryCodes[0]); await rejectedLogin(page);
    await submitLogin(page, fixture, fixture.recoveryCodes[1]); await connected(page);
    const finalCookie = await sessionCookie(page);
    await page.click("#logout-button"); await loginForm(page);
    assert.equal((await fixtureRequest(fixture.origin, "/api/auth/session", { cookie: finalCookie })).status, 401);
    t.diagnostic("Recovery code works once, SQL session expiry returns to login, consumed code replay fails and a different unused code still works.");
  } finally {
    try { await page?.close(); }
    finally { try { await driver.close(); } finally { await fixture?.stop(); } }
  }
});
