// Actual entry/access/admin pages, controllers and HTTPS handlers on loopback.
// The service uses synthetic invitations/accounts; no SQL, mail or hosted data.
// Clipboard writes are observed at their boundary, without accessing the OS clipboard.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppServer } from "../../server/index.mjs";
import { createAuthHandler } from "../../server/auth/http.mjs";
import { createAccessHandler } from "../../server/access/http.mjs";
import { createEntryHandler } from "../../server/entry/http.mjs";
import { startWebDriver, waitUntil } from "./webdriver.mjs";

const code = "0123-4567-89AB-CDEF-GHJK", compact = code.replaceAll("-", "");
const legacyToken = Buffer.alloc(32, 21).toString("base64url");
const password = "Synthetic invitation password", email = "invited@example.invalid";
const screenshots = new URL("../../artifacts/homepage/", import.meta.url);
const copy = {
  fr: { invalid: "Ce code est invalide, expiré ou déjà utilisé.", created: "C’est créé !" },
  en: { invalid: "This code is invalid, expired or already used.", created: "Your account is ready!" },
};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "jessie-invitation-code-")); await chmod(directory, 0o700);
  const key = join(directory, "key.pem"), cert = join(directory, "cert.pem");
  let server;
  try {
    await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", key, "-out", cert],
      { timeout: 10000, maxBuffer: 65536, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", OPENSSL_CONF: "/dev/null" } });
    await chmod(key, 0o600); await chmod(cert, 0o600);
    const adminToken = Buffer.alloc(32, 22).toString("base64url");
    const admin = { user: { id: "2".repeat(32), role: "admin", pseudonym: "Jessie de test" }, csrf: Buffer.alloc(32, 23).toString("base64url"), expiresAt: Date.now() + 3600000 };
    const requests = [], inspections = [], registrations = [], creations = [], failures = [];
    let app, registrationRefused = false;
    server = createServer({ key: await readFile(key), cert: await readFile(cert), minVersion: "TLSv1.2" }, (request, response) => {
      const url = new URL(request.url, "https://localhost");
      requests.push({ path: url.pathname, method: request.method, noQuery: !url.search,
        noSecretInReferrer: ![compact, code, legacyToken].some(value => request.headers.referer?.includes(value)) });
      app.emit("request", request, response);
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const origin = `https://127.0.0.1:${server.address().port}`;
    const adminSession = async token => token === adminToken ? admin : null;
    const clientSession = async () => null;
    const unsupported = async () => { failures.push("unexpected_service_action"); throw new Error("Unexpected synthetic invitation action"); };
    const access = Object.fromEntries(["revokeInvitation", "verifyEmail", "resendVerification", "login", "logout", "logoutAll", "approveClient", "revokeClient", "renewClient"].map(name => [name, unsupported]));
    Object.assign(access, {
      session: clientSession, adminSession,
      listClients: async () => ({ clients: [], hasMore: false, nextCursor: null }),
      listInvitations: async () => ({ invitations: [], hasMore: false, nextCursor: null }),
      async inspectInvitation(input) {
        const valid = input.token === compact || input.token === legacyToken;
        inspections.push({ valid, kind: input.token === legacyToken ? "link" : "code" });
        return valid ? { expiresAt: Date.now() + 3600000, accessDays: 30 } : null;
      },
      async register(input) {
        registrations.push({ valid: [compact, legacyToken].includes(input.invitationToken) && input.email === email
          && input.pseudonym === "Compte invité" && input.password === password && input.ageDeclared === true,
        kind: input.invitationToken === legacyToken ? "link" : "code" });
        if (registrationRefused) { registrationRefused = false; throw Object.assign(new Error("Synthetic registration refusal"), { code: "ACCESS_REGISTRATION_FAILED" }); }
        return { status: "verification_pending" };
      },
      async createInvitation(token, input) {
        assert.equal(token, adminToken); creations.push({ ...input });
        const metadata = { id: "3".repeat(32), expiresAt: Date.now() + 3600000, accessDays: input.accessDays };
        return input.format === "code" ? { ...metadata, format: "code", code } : { ...metadata, url: `${origin}/access#invitation=${legacyToken}` };
      },
    });
    const authHandler = createAuthHandler({ session: adminSession, async login(input) {
      assert.equal(input.email, "admin@example.invalid"); assert.equal(input.password, password); assert.equal(input.factor, "123456");
      return { ...admin, token: adminToken };
    }, async logout() {}, async logoutAll() {} }, { origin });
    app = createAppServer({ authHandler, accessHandler: createAccessHandler(access, { origin }),
      entryHandler: createEntryHandler({ clientSession, adminSession, chatEnabled: true, deviceTransition: true }) });
    return { origin, requests, inspections, registrations, creations, failures,
      refuseNextRegistration() { registrationRefused = true; },
      async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) {
    server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true }); throw error;
  }
}

async function open(page, language, path = "/") {
  await page.navigate("/help"); await page.execute("sessionStorage.setItem('jessiemessage.language',arguments[0])", language);
  await page.navigate(path);
}
async function loginReady(page) {
  await waitUntil(() => page.execute("return document.getElementById('client-login-form')?.hidden===false && !document.getElementById('show-invitation-code').disabled"), "signed-out invitation entry");
}
async function geometry(page) {
  assert.equal(await page.execute(`const width=document.documentElement.clientWidth;
    const nodes=[...document.querySelectorAll('main form input,main form button,main form select,[data-jm-language]')].filter(node=>node.checkVisibility());
    return document.documentElement.scrollWidth<=width+1 && nodes.every(node=>{const r=node.getBoundingClientRect();return r.left>=-1&&r.right<=width+1&&r.height>=(node.type==='checkbox'?20:44)&&(!node.matches('button')||node.scrollWidth<=node.clientWidth+1)});`), true,
  "invitation controls fit the viewport with readable labels and44px text/action controls");
}
async function capture(page, name) {
  const png = Buffer.from(await page.screenshot(), "base64"); assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  await mkdir(screenshots, { recursive: true }); await writeFile(new URL(`${name}.png`, screenshots), png);
}
async function cleanClientSurfaces(page) {
  assert.equal(await page.execute(`const values=arguments[0];return !location.hash&&!location.search
    && values.every(value=>![location.href,JSON.stringify({...localStorage}),JSON.stringify({...sessionStorage})].some(surface=>surface.includes(value)));`, [compact, code, legacyToken]), true,
  "invitation secrets stay out of the current URL and browser storage");
}
async function fillRegistration(page) {
  await page.type("#registration-email", email); await page.type("#registration-name", "Compte invité");
  await page.type("#registration-password", password); await page.click("#age-declared");
}
function cleanFixture(source) {
  assert.deepEqual(source.failures, []);
  assert.equal(source.requests.every(request => request.noSecretInReferrer && (!["/api/access/invitation", "/api/access/register", "/api/admin/invitations"].includes(request.path) || request.noQuery)), true, "no invitation secret is transported by API query or any referrer");
  assert.equal(source.registrations.every(call => call.valid), true, "registration forwards the exact synthetic credentials and accepted invitation");
}

test("real Chrome: invitation code entry is generic, retryable and opens explicit registration inFR/EN at320/1280px", { timeout: 240000 }, async t => {
  const source = await fixture(); let driver;
  try {
    driver = await startWebDriver();
    for (const language of ["fr", "en"]) for (const width of [320, 1280]) await t.test(`${language}, ${width}px`, async () => {
      const page = await driver.browser({ origin: source.origin, acceptInsecureCerts: true, width });
      try {
        await open(page, language); await loginReady(page);
        await page.click("#show-invitation-code");
        await waitUntil(() => page.execute("return document.getElementById('invitation-code-form').hidden===false"), "manual code entry");
        assert.equal(await page.execute("return document.documentElement.lang"), language); await geometry(page);
        await page.type("#invitation-code", code);
        await capture(page, `invitation-code-${language}-${width}`);
        const before = source.inspections.length;
        await page.type("#invitation-code", "bad"); await page.click("#validate-invitation-code");
        await waitUntil(() => page.execute("return document.getElementById('access-status').textContent===arguments[0] && !document.getElementById('validate-invitation-code').disabled", copy[language].invalid), "generic malformed-code refusal");
        assert.equal(source.inspections.length, before, "malformed code never sends an inspection");
        await page.type("#invitation-code", "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ"); await page.click("#validate-invitation-code");
        await waitUntil(() => page.execute("return document.getElementById('access-status').textContent===arguments[0] && !document.getElementById('validate-invitation-code').disabled", copy[language].invalid), "same generic unknown-code refusal");
        assert.equal(source.inspections.length, before + 1);
        assert.equal(await page.execute("return !document.getElementById('invitation-code-form').hidden && document.getElementById('registration-form').hidden"), true);
        await page.type("#invitation-code", `  ${code.toLowerCase().replaceAll("-", " - ")}  `);
        const registeredBefore = source.registrations.length;
        await page.execute("const form=document.getElementById('invitation-code-form');form.requestSubmit();form.requestSubmit()");
        await waitUntil(() => page.execute("return !document.getElementById('registration-form').hidden && !document.querySelector('#registration-form button[type=submit]').disabled"), "valid code opens registration");
        assert.equal(source.inspections.length, before + 2, "one deliberate valid inspection despite duplicate submit events");
        assert.equal(source.registrations.length, registeredBefore, "inspection never registers automatically");
        assert.equal(await page.execute("return document.getElementById('invitation-code').value"), "");
        await cleanClientSurfaces(page); await geometry(page); await capture(page, `invitation-code-registration-${language}-${width}`);
        await fillRegistration(page); source.refuseNextRegistration(); await page.click('#registration-form button[type="submit"]');
        await waitUntil(() => page.execute("return document.getElementById('access-status').classList.contains('is-error') && !document.querySelector('#registration-form button[type=submit]').disabled"), "registration refusal stays explicit");
        assert.equal(source.registrations.length, registeredBefore + 1);
        assert.equal(await page.execute("return !document.getElementById('registration-form').hidden && document.getElementById('registration-password').value===''"), true);
        await page.type("#registration-password", password); await page.click('#registration-form button[type="submit"]');
        await waitUntil(() => page.execute("return document.getElementById('client-login-form').hidden===false && document.getElementById('registration-form').hidden"), "successful registration returns to email-verification instructions");
        assert.equal(source.registrations.length, registeredBefore + 2, "only explicit retry sends another registration");
        assert.equal(await page.execute("return document.getElementById('access-status').textContent.startsWith(arguments[0])", copy[language].created), true);
        await cleanClientSurfaces(page);
        await page.click("#show-invitation-code"); await page.type("#invitation-code", code); await page.click("#cancel-invitation-code"); await loginReady(page);
        assert.equal(await page.execute("return document.getElementById('invitation-code').value==='' && document.getElementById('invitation-code-form').hidden"), true, "cancel clears the code and returns to sign-in");
      } finally { await page.close(); }
    });
    cleanFixture(source);
  } finally { try { await source.close(); } finally { await driver?.close(); } }
});

test("real Chrome: existing invitation links still inspect and register after their fragment is removed", { timeout: 60000 }, async () => {
  const source = await fixture(); let driver;
  try {
    driver = await startWebDriver(); const page = await driver.browser({ origin: source.origin, acceptInsecureCerts: true, width: 375 });
    try {
      await open(page, "fr", `/access#invitation=${legacyToken}`);
      await waitUntil(() => page.execute("return !document.getElementById('registration-form').hidden && !document.querySelector('#registration-form button[type=submit]').disabled"), "legacy invitation registration");
      assert.deepEqual(source.inspections, [{ valid: true, kind: "link" }]); await cleanClientSurfaces(page);
      await fillRegistration(page); await page.click('#registration-form button[type="submit"]');
      await waitUntil(() => page.execute("return !document.getElementById('client-login-form').hidden && document.getElementById('registration-form').hidden"), "legacy registration completes");
      assert.deepEqual(source.registrations, [{ valid: true, kind: "link" }]); cleanFixture(source);
    } finally { await page.close(); }
  } finally { try { await source.close(); } finally { await driver?.close(); } }
});

test("real Chrome: admin creates and copies only the selected invitation format, with no secret restored by reload", { timeout: 150000 }, async t => {
  const source = await fixture(); let driver;
  try {
    driver = await startWebDriver();
    for (const [language, width] of [["fr", 1280], ["en", 320]]) await t.test(`${language}, ${width}px`, async () => {
      const page = await driver.browser({ origin: source.origin, acceptInsecureCerts: true, width });
      try {
        await open(page, language, "/admin/login");
        await waitUntil(() => page.execute("return !document.getElementById('login-form').hidden && !document.getElementById('login-button').disabled"), "admin MFA form");
        await page.type("#email", "admin@example.invalid"); await page.type("#password", password); await page.type("#factor", "123456"); await page.click("#login-button");
        await waitUntil(() => page.execute("return location.pathname==='/admin' && !document.getElementById('connected').hidden"), "admin dashboard");
        await page.navigate("/admin/clients");
        await waitUntil(() => page.execute("return !document.getElementById('access-tools').hidden && !document.getElementById('invitation-create').disabled"), "admin invitation tools");
        assert.equal(await page.execute("return document.getElementById('invitation-format').value"), "code");
        await page.execute("window.__clipboardWrites=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__clipboardWrites.push(value)}}})");
        const before = source.creations.length; await page.click("#invitation-create");
        await waitUntil(() => page.execute("return !document.getElementById('new-invitation').hidden && !document.getElementById('invitation-code-result-field').hidden && !document.getElementById('copy-invitation-code').disabled"), "one-time code result");
        assert.deepEqual(source.creations.slice(before), [{ lifetimeHours: 72, accessDays: 30, format: "code" }]);
        assert.equal(await page.execute("return document.getElementById('invitation-code-result').value===arguments[0] && document.getElementById('invitation-link-field').hidden && document.getElementById('invitation-link').value===''", code), true);
        await geometry(page); await capture(page, `invitation-code-admin-${language}-${width}`);
        await page.click("#copy-invitation-code");
        await waitUntil(() => page.execute("return window.__clipboardWrites.length===1"), "code copy action");
        assert.deepEqual(await page.execute("return window.__clipboardWrites"), [code]);
        await page.execute("const input=document.getElementById('invitation-format');input.value='link';input.dispatchEvent(new Event('change',{bubbles:true}))");
        await waitUntil(() => page.execute("return !document.getElementById('invitation-create').disabled"), "format selection remains ready"); await page.click("#invitation-create");
        await waitUntil(() => page.execute("return !document.getElementById('new-invitation').hidden && !document.getElementById('invitation-link-field').hidden && !document.getElementById('copy-invitation').disabled"), "legacy link result");
        const url = `${source.origin}/access#invitation=${legacyToken}`;
        assert.deepEqual(source.creations.at(-1), { lifetimeHours: 72, accessDays: 30, format: "link" });
        assert.equal(await page.execute("return document.getElementById('invitation-link').value===arguments[0] && document.getElementById('invitation-code-result-field').hidden && document.getElementById('invitation-code-result').value===''", url), true);
        await page.click("#copy-invitation"); await waitUntil(() => page.execute("return window.__clipboardWrites.length===2"), "link copy action");
        assert.deepEqual(await page.execute("return window.__clipboardWrites"), [code, url]);
        await page.navigate("/admin/clients");
        await waitUntil(() => page.execute("return !document.getElementById('access-tools').hidden"), "reloaded admin access");
        assert.equal(await page.execute("return document.getElementById('new-invitation').hidden && document.getElementById('invitation-code-result').value==='' && document.getElementById('invitation-link').value===''"), true, "lists and reload do not recover either creation secret");
      } finally { await page.close(); }
    });
    cleanFixture(source);
  } finally { try { await source.close(); } finally { await driver?.close(); } }
});
