// Separate from *.browser.mjs: this rehearsal requires the explicitly enabled,
// disposable MariaDB fixture as well as real Chrome. No production credentials.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { startWebDriver, waitUntil } from "../browser/webdriver.mjs";
import { createAuthenticationFixture, validateFixtureEnvironment } from "./auth-fixture.mjs";
import { connectDatabase } from "../../server/db/connection.mjs";

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
// Called only after this scenario owns the freshly created disposable schema.
// Compare a bounded fingerprint of row IDs, never tokens or row contents, so
// an unchanged cookie cannot conceal a session inserted by a refused factor.
async function sessionSnapshot() {
  validateFixtureEnvironment();
  const connection = await connectDatabase();
  try {
    const rows = await connection.query("SELECT id FROM sessions ORDER BY id LIMIT 16");
    if (rows.length >= 16 || rows.some(row => !Buffer.isBuffer(row.id) || row.id.length !== 16)) throw new Error();
    return { count: rows.length, fingerprint: createHash("sha256").update(Buffer.concat(rows.map(row => row.id))).digest("hex") };
  } catch { throw new Error("Owned authentication fixture session snapshot unavailable"); }
  finally { await connection.end(); }
}
async function rejectedLogin(page, before) {
  await waitUntil(() => page.execute("return document.getElementById('auth-status').textContent === arguments[0] && !document.getElementById('login-button').disabled", incorrectFactor), "invalid MFA is rejected by the real service");
  assert.equal(await page.execute("return document.getElementById('connected').hidden"), true);
  const cookies = (await page.cookies()).filter(cookie => cookie.name === cookieName);
  assert.equal(cookies.length, before.cookies.length, "a rejected factor creates no new session cookie");
  assert.equal(cookies.every((cookie, index) => cookie.value === before.cookies[index].value), true, "a rejected factor preserves the exact cookie already present, including an SQL-expired one");
  const metadata = values => values.map(({ name, path, domain, secure, httpOnly, sameSite, expiry }) => ({ name, path, domain, secure, httpOnly, sameSite, expiry }));
  assert.deepEqual(metadata(cookies), metadata(before.cookies), "a rejected factor does not replace or expire the existing cookie");
  assert.deepEqual(await sessionSnapshot(), before.sessions, "a rejected factor creates zero SQL sessions and preserves the existing session IDs");
  assert.equal(await page.execute("return document.getElementById('password').value === '' && document.getElementById('factor').value === ''"), true, "rejected credentials are cleared from the form");
}
async function submitRejectedLogin(page, fixture, factor) {
  const before = { cookies: (await page.cookies()).filter(cookie => cookie.name === cookieName), sessions: await sessionSnapshot() };
  await submitLogin(page, fixture, factor); await rejectedLogin(page, before);
  return before.sessions;
}
async function connected(page) {
  await waitUntil(() => page.execute("return !!document.getElementById('connected') && !document.getElementById('connected').hidden && location.pathname === '/admin'"), "real administrator session confirmed in the DOM");
}
async function signOutThisDevice(page) {
  await waitUntil(() => page.execute("return !!document.querySelector('#account-settings > summary') && !document.getElementById('connected').hidden"), "administrator account settings available");
  if (!await page.execute("return document.getElementById('account-settings').open")) await page.click("#account-settings > summary");
  await waitUntil(() => page.execute("const button = document.getElementById('logout-button'); return document.getElementById('account-settings').open && !button.disabled && button.getClientRects().length > 0"), "this-device logout visible and ready inside account settings");
  await page.click("#logout-button");
  await loginForm(page);
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
  if (state === "connected") await connected(page);
  else await waitUntil(() => page.execute("const card = document.getElementById('administrator-card'); return !!card && card.hidden && document.getElementById('entry-status').textContent.includes('pas encore disponible')"), "anonymous opening conceals administrator access");
  assert.equal(await page.execute("return location.protocol"), "https:", "the actual browser is using HTTPS, not localhost HTTP cookie exceptions");
  if (state !== "connected") assert.equal(await page.execute("return document.getElementById('client-card').hidden"), true, "the fixture has no client access service");
}
async function signedOutEntry(origin) {
  const result = await fixtureRequest(origin, "/api/entry");
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { status: "unavailable", client: null, administrator: null });
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
    await page.navigate("/admin/login"); await loginForm(page);
    assert.equal(await page.execute("return location.pathname"), "/admin/login");
    t.diagnostic("Anonymous API / protected page and HTTPS neutral opening verified.");

    assert.equal((await submitRejectedLogin(page, fixture, fixture.invalidTotp())).count, 0, "initial invalid MFA leaves the SQL session table empty");
    assert.equal((await fixtureRequest(fixture.origin, "/api/auth/session")).status, 401);
    await loginForm(page); await page.type("#email", fixture.email); await page.type("#password", fixture.password);
    await page.click("#toggle-password");
    await page.execute("const password=document.getElementById('password');password.focus();password.setSelectionRange(2,6);Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))");
    assert.equal(await page.execute("return document.getElementById('login-form').hidden && document.getElementById('password').type === 'password' && document.getElementById('toggle-password').getAttribute('aria-pressed') === 'false'"), true, "the background login is hidden and its password is masked");
    await page.execute("delete document.visibilityState;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:false}))");
    await loginForm(page);
    assert.equal(await page.execute("return document.getElementById('email').value === arguments[0] && document.getElementById('password').value === arguments[1] && document.getElementById('factor').value === ''", fixture.email, fixture.password), true, "email and password survive the authenticator switch in memory");
    assert.equal(await page.execute("const password=document.getElementById('password');return password.type === 'password' && password.selectionStart === 2 && password.selectionEnd === 6"), true, "masking does not select or overwrite the existing password");
    assert.equal(await page.execute("return localStorage.length === 0 && sessionStorage.length === 0"), true, "login fields never enter persistent browser storage");
    const acceptedTotp = fixture.currentTotp();
    await page.type("#factor", acceptedTotp);
    assert.equal(await page.execute("return document.activeElement.id === 'factor' && document.getElementById('password').value === arguments[0]", fixture.password), true, "the security code receives focus without changing the password");
    await page.click("#login-button"); await connected(page);
    const initialCookie = await sessionCookie(page);
    assert.equal(await page.execute("return ['email', 'password', 'factor'].every(id => document.getElementById(id).value === '')"), true, "successful login clears credential fields");
    // Check reuse immediately, without first navigating / logging out. A fresh
    // window on both sides rules out expiry as the reason for this rejection.
    assert.equal(fixture.isTotpFresh(acceptedTotp), true, "accepted OTP is still within the server's verification window before replay");
    const beforeTotpReplay = await sessionSnapshot();
    const replayedTotp = await fixtureRequest(fixture.origin, "/api/auth/login", { method: "POST",
      headers: { Origin: fixture.origin, "Content-Type": "application/json", "X-Jessie-Request": "1" },
      body: JSON.stringify({ email: fixture.email, password: fixture.password, factor: acceptedTotp }) });
    assert.equal(replayedTotp.status, 401, "a previously accepted OTP is rejected even while its time window remains valid");
    assert.equal(replayedTotp.headers["set-cookie"], undefined, "replayed OTP creates or clears no cookie");
    assert.deepEqual(await sessionSnapshot(), beforeTotpReplay, "replayed OTP creates zero SQL sessions");
    assert.equal(fixture.isTotpFresh(acceptedTotp), true, "OTP replay did not merely wait for expiry");
    t.diagnostic("Wrong MFA rejected; authenticator app-switch fields, real TOTP login and browser cookie protection verified.");

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
    await entry(page, "connected");
    t.diagnostic("CSRF / Origin refusals preserve the session; /api/entry, /app and /admin recognize the real cookie.");

    await signOutThisDevice(page);
    await waitUntil(() => page.execute("return location.pathname === '/admin/login'"), "logout returns to the login URL");
    const signedOutCookie = await sessionCookie(page);
    assert.equal(signedOutCookie.value === initialCookie.value, true, "logout preserves the cookie value so a late response cannot erase a newer login");
    assert.equal(signedOutCookie.secure && signedOutCookie.httpOnly && signedOutCookie.sameSite === "Strict", true);
    assert.equal((await fixtureRequest(fixture.origin, "/api/auth/session", { cookie: initialCookie })).status, 401, "SQL revocation rejects the cookie that remains in the browser");
    await entry(page, "signed_out"); await signedOutEntry(fixture.origin);
    await page.navigate("/admin/login"); await loginForm(page);
    t.diagnostic("DOM logout revokes the cookie in SQL; the retained browser value grants no access and direct login remains available.");

    await submitLogin(page, fixture, fixture.recoveryCodes[0]); await connected(page);
    const recoveryCookie = await sessionCookie(page);
    await fixture.expireSession();
    assert.equal((await fixtureRequest(fixture.origin, "/api/auth/session", { cookie: recoveryCookie })).status, 401, "SQL expiry rejects a cookie still present in the browser");
    await page.navigate("/admin"); await loginForm(page);
    assert.equal(await page.execute("return location.pathname"), "/admin/login");
    assert.equal((await sessionCookie(page)).value === recoveryCookie.value, true, "SQL-expired navigation retains the identical browser cookie without authorizing it");
    await submitRejectedLogin(page, fixture, fixture.recoveryCodes[0]);
    assert.equal((await sessionCookie(page)).value === recoveryCookie.value, true, "consumed recovery-code rejection preserves the expired cookie rather than creating a new one");
    assert.equal((await fixtureRequest(fixture.origin, "/api/auth/session", { cookie: recoveryCookie })).status, 401, "preserving the expired cookie never restores its SQL session");
    await submitLogin(page, fixture, fixture.recoveryCodes[1]); await connected(page);
    const finalCookie = await sessionCookie(page);
    await signOutThisDevice(page);
    assert.equal((await fixtureRequest(fixture.origin, "/api/auth/session", { cookie: finalCookie })).status, 401);
    t.diagnostic("Recovery code works once, SQL session expiry returns to login, consumed code replay fails and a different unused code still works.");
  } finally {
    try { await page?.close(); }
    finally { try { await driver.close(); } finally { await fixture?.stop(); } }
  }
});
