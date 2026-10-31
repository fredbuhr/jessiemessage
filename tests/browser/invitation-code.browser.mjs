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
import { AuthError } from "../../server/auth/service.mjs";
import { createAccessHandler } from "../../server/access/http.mjs";
import { decodeAccessCursor, encodeAccessCursor } from "../../server/access/pagination.mjs";
import { createEntryHandler } from "../../server/entry/http.mjs";
import { startWebDriver, waitUntil } from "./webdriver.mjs";

const code = "0123-4567-89AB-CDEF-GHJK", compact = code.replaceAll("-", "");
const legacyToken = Buffer.alloc(32, 21).toString("base64url");
const verificationToken = Buffer.alloc(32, 24).toString("base64url");
const password = "Synthetic invitation password", email = "invited@example.invalid";
const screenshots = new URL("../../artifacts/homepage/", import.meta.url);
const copy = {
  fr: { invalid: "Ce code est invalide, expiré ou déjà utilisé.", created: "Ton compte est créé.", verificationRejected: "Ce lien de confirmation est invalide, expiré ou déjà utilisé. Connecte-toi si ton e-mail est confirmé, ou demande un nouvel e-mail ci-dessous.", verified: "Ton adresse e-mail est vérifiée. Connecte-toi pour ouvrir ta conversation.", signIn: "Aller à la connexion" },
  en: { invalid: "This code is invalid, expired or already used.", created: "Your account is ready.", verificationRejected: "This confirmation link is invalid, expired or already used. Sign in if your email is confirmed, or request another email below.", verified: "Your email address is verified. Sign in to open your conversation.", signIn: "Go to sign in" },
};

async function fixture({ invitations = [] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "jessie-invitation-code-")); await chmod(directory, 0o700);
  const key = join(directory, "key.pem"), cert = join(directory, "cert.pem");
  let server;
  try {
    await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", key, "-out", cert],
      { timeout: 10000, maxBuffer: 65536, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", OPENSSL_CONF: "/dev/null" } });
    await chmod(key, 0o600); await chmod(cert, 0o600);
    const adminToken = Buffer.alloc(32, 22).toString("base64url");
    const admin = { user: { id: "2".repeat(32), role: "admin", pseudonym: "Jessie de test" }, csrf: Buffer.alloc(32, 23).toString("base64url"), expiresAt: Date.now() + 3600000 };
    const requests = [], inspections = [], registrations = [], creations = [], verifications = [], failures = [], listQueries = [];
    let app, registrationRefused = false, verificationRefused = false;
    server = createServer({ key: await readFile(key), cert: await readFile(cert), minVersion: "TLSv1.2" }, (request, response) => {
      const url = new URL(request.url, "https://localhost");
      requests.push({ path: url.pathname, method: request.method, noQuery: !url.search,
        noSecretInReferrer: ![compact, code, legacyToken, verificationToken].some(value => request.headers.referer?.includes(value)) });
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
      async verifyEmail({ token }) {
        const accepted = token === verificationToken && !verificationRefused;
        verifications.push({ accepted });
        if (!accepted) throw new AuthError("AUTH_INVALID");
        return { status: "email_verified" };
      },
      listClients: async () => ({ clients: [], hasMore: false, nextCursor: null }),
      listInvitations: async (_token, { state = "all", cursor = null, limit = 50 } = {}) => {
        const position = cursor === null ? null : decodeAccessCursor("invitations", cursor, state);
        const before = position === null ? Infinity : Date.parse(position.createdAt.replace(" ", "T") + "Z");
        const rows = invitations.filter(row => (state === "all" || row.state === state) && (position === null || row.createdAt < before || row.createdAt === before && row.id < position.id))
          .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
        const selected = rows.slice(0, limit), hasMore = rows.length > limit, last = selected.at(-1);
        listQueries.push({ state, cursor, limit, returned: selected.length });
        return { invitations: selected, hasMore, nextCursor: hasMore ? encodeAccessCursor("invitations", { id: last.id, createdAt: new Date(last.createdAt).toISOString().replace("T", " ").replace("Z", "000") }, state) : null };
      },
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
    return { origin, requests, inspections, registrations, creations, verifications, failures, listQueries,
      setVerificationRefused(value) { verificationRefused = value; },
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
    && values.every(value=>![location.href,JSON.stringify({...localStorage}),JSON.stringify({...sessionStorage})].some(surface=>surface.includes(value)));`, [compact, code, legacyToken, verificationToken]), true,
  "invitation secrets stay out of the current URL and browser storage");
}
async function fillRegistration(page) {
  await page.type("#registration-email", email); await page.type("#registration-name", "Compte invité");
  await page.type("#registration-password", password); await page.click("#age-declared");
}
function cleanFixture(source) {
  assert.deepEqual(source.failures, []);
  assert.equal(source.requests.every(request => request.noSecretInReferrer && (request.method !== "POST" || !["/api/access/invitation", "/api/access/register", "/api/access/verify-email", "/api/access/login", "/api/admin/invitations"].includes(request.path) || request.noQuery)), true, "no invitation or verification secret is transported by API query or any referrer");
  assert.equal(source.registrations.every(call => call.valid), true, "registration forwards the exact synthetic credentials and accepted invitation");
}

test("real Chrome: opening an email link confirms automatically, and invalid links remain usable inFR/EN at320/1280px", { timeout: 240000 }, async t => {
  const source = await fixture(); let driver;
  try {
    driver = await startWebDriver();
    for (const language of ["fr", "en"]) for (const width of [320, 1280]) await t.test(`${language}, ${width}px`, async () => {
      const page = await driver.browser({ origin: source.origin, acceptInsecureCerts: true, width });
      try {
        source.setVerificationRefused(true);
        const before = source.verifications.length;
        await open(page, language, `/access#verification=${verificationToken}`); await loginReady(page);
        assert.equal(await page.execute("return document.getElementById('access-status').textContent"), copy[language].verificationRejected);
        assert.equal(await page.execute("return document.getElementById('email-verification').hidden && !document.getElementById('resend-section').hidden && document.activeElement?.id==='login-email'"), true);
        assert.deepEqual(source.verifications.slice(before), [{ accepted: false }]);
        await geometry(page); await capture(page, `verification-used-${language}-${width}`); await cleanClientSurfaces(page);

        source.setVerificationRefused(false);
        const beforeSuccess = source.verifications.length;
        await open(page, language, `/access#verification=${verificationToken}`); await loginReady(page);
        assert.equal(await page.execute("return document.getElementById('access-status').textContent"), copy[language].verified);
        assert.deepEqual(source.verifications.slice(beforeSuccess), [{ accepted: true }], "opening the link is enough: no confirmation-button click");
        assert.equal(await page.execute("return document.getElementById('email-verification').hidden && document.getElementById('verify-email-button').hidden"), true);
        await cleanClientSurfaces(page); await geometry(page); await capture(page, `verification-one-click-${language}-${width}`);

        const beforeRepeat = source.verifications.length;
        await open(page, language, `/access#verification=${verificationToken}`); await loginReady(page);
        assert.equal(await page.execute("return document.getElementById('access-status').textContent"), copy[language].verified);
        assert.deepEqual(source.verifications.slice(beforeRepeat), [{ accepted: true }], "reopening the same successful link does not show an approval or another confirmation step");
      } finally { await page.close(); }
    });
    cleanFixture(source);
  } finally { await driver?.close(); await source.close(); }
});

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
        assert.equal(await page.execute("return document.getElementById('invitation-unlimited').checked && document.getElementById('invitation-days').disabled && !document.getElementById('invitation-days').required"), true,
          "new invitations default to unlimited access in either language");
        await page.execute("window.__clipboardWrites=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__clipboardWrites.push(value)}}})");
        const before = source.creations.length; await page.click("#invitation-create");
        await waitUntil(() => page.execute("return !document.getElementById('new-invitation').hidden && !document.getElementById('invitation-code-result-field').hidden && !document.getElementById('copy-invitation-code').disabled"), "one-time code result");
        assert.deepEqual(source.creations.slice(before), [{ lifetimeHours: 72, accessDays: null, format: "code" }]);
        assert.equal(await page.execute("return document.getElementById('invitation-code-result').value===arguments[0] && document.getElementById('invitation-link-field').hidden && document.getElementById('invitation-link').value===''", code), true);
        await geometry(page); await capture(page, `invitation-code-admin-${language}-${width}`);
        await page.click("#copy-invitation-code");
        await waitUntil(() => page.execute("return window.__clipboardWrites.length===1"), "code copy action");
        assert.deepEqual(await page.execute("return window.__clipboardWrites"), [code]);
        await page.execute("const input=document.getElementById('invitation-format');input.value='link';input.dispatchEvent(new Event('change',{bubbles:true}))");
        await page.execute("const unlimited=document.getElementById('invitation-unlimited');unlimited.checked=false;unlimited.dispatchEvent(new Event('change',{bubbles:true}));document.getElementById('invitation-days').value='17'");
        assert.equal(await page.execute("return !document.getElementById('invitation-days').disabled && document.getElementById('invitation-days').required"), true,
          "a finite duration remains an explicit choice");
        await waitUntil(() => page.execute("return !document.getElementById('invitation-create').disabled"), "format selection remains ready"); await page.click("#invitation-create");
        await waitUntil(() => page.execute("return !document.getElementById('new-invitation').hidden && !document.getElementById('invitation-link-field').hidden && !document.getElementById('copy-invitation').disabled"), "legacy link result");
        const url = `${source.origin}/access#invitation=${legacyToken}`;
        assert.deepEqual(source.creations.at(-1), { lifetimeHours: 72, accessDays: 17, format: "link" });
        assert.equal(await page.execute("return document.getElementById('invitation-link').value===arguments[0] && document.getElementById('invitation-code-result-field').hidden && document.getElementById('invitation-code-result').value===''", url), true);
        await page.click("#copy-invitation"); await waitUntil(() => page.execute("return window.__clipboardWrites.length===2"), "link copy action");
        assert.deepEqual(await page.execute("return window.__clipboardWrites"), [code, url]);
        await page.execute("document.getElementById('invitation-form').reset()");
        await waitUntil(() => page.execute("return document.getElementById('invitation-unlimited').checked && document.getElementById('invitation-days').disabled && !document.getElementById('invitation-days').required"), "reset restores the unlimited default without creating anything");
        assert.equal(source.creations.length, before + 2);
        await page.navigate("/admin/clients");
        await waitUntil(() => page.execute("return !document.getElementById('access-tools').hidden"), "reloaded admin access");
        assert.equal(await page.execute("return document.getElementById('new-invitation').hidden && document.getElementById('invitation-code-result').value==='' && document.getElementById('invitation-link').value===''"), true, "lists and reload do not recover either creation secret");
        assert.equal(await page.execute("return document.getElementById('invitation-unlimited').checked && document.getElementById('invitation-days').disabled && !document.getElementById('invitation-days').required"), true,
          "a fresh invitation form reloads with unlimited access selected");
      } finally { await page.close(); }
    });
    cleanFixture(source);
  } finally { try { await source.close(); } finally { await driver?.close(); } }
});


test("real Chrome: invitation status pages stay compact and bounded with working previous/next in FR/EN at320/1280px", { timeout: 180000 }, async t => {
  const now = Date.now(), states = ["pending", "used", "expired", "revoked"],
    invitations = Array.from({ length: 2500 }, (_, index) => ({ id: (index + 100).toString(16).padStart(32, "0"), state: states[index % 4],
      createdAt: now - index * 1000 - 60000, expiresAt: index % 4 === 2 ? now - 1000 : now + 3600000, accessDays: 1, consumedById: index % 4 === 1 ? (index + 3000).toString(16).padStart(32, "0") : null }));
  const source = await fixture({ invitations }); let driver;
  try {
    driver = await startWebDriver();
    for (const language of ["fr", "en"]) for (const width of [320, 1280]) await t.test(`${language}, ${width}px`, async () => {
      const page = await driver.browser({ origin: source.origin, acceptInsecureCerts: true, width, height: 800 });
      try {
        await open(page, language, "/admin/login");
        await waitUntil(() => page.execute("return !document.getElementById('login-form').hidden && !document.getElementById('login-button').disabled"), "admin MFA ready");
        await page.type("#email", "admin@example.invalid"); await page.type("#password", password); await page.type("#factor", "123456"); await page.click("#login-button");
        await waitUntil(() => page.execute("return location.pathname==='/admin' && !document.getElementById('connected').hidden"), "signed-in admin");
        await page.navigate("/admin/clients");
        await waitUntil(() => page.execute("return document.querySelectorAll('#invitations-list>details').length===25 && !document.getElementById('invitation-create').disabled"), "one bounded invitation page");
        await page.click("#invitation-create");
        await waitUntil(() => page.execute("return document.getElementById('invitation-code-result').value.length>0 && !document.getElementById('invitation-create').disabled"), "one-time code remains available");
        await page.execute("document.getElementById('invitation-hours').value='48';const field=document.getElementById('invitation-state');field.value='expired';field.dispatchEvent(new Event('change',{bubbles:true}))");
        await waitUntil(() => page.execute("return document.querySelectorAll('#invitations-list>details[data-invitation-state=expired]').length===25 && !document.getElementById('invitations-next-top').disabled"), "global status filter is loaded");
        const firstIds = await page.execute("return [...document.querySelectorAll('#invitations-list>details')].map(node=>node.dataset.invitationId)");
        await page.click("#invitations-next-top");
        await waitUntil(() => page.execute("return document.getElementById('invitations-page-note').textContent.includes('Page 2') && !document.getElementById('invitations-previous-top').disabled"), "next invitation page");
        assert.equal(await page.execute("return document.activeElement.id"), "invitations-title");
        assert.equal(await page.execute("return document.querySelectorAll('#invitations-list>details').length"), 25);
        assert.equal(await page.execute("return [...document.querySelectorAll('#invitations-list>details')].every(node=>!arguments[0].includes(node.dataset.invitationId))", firstIds), true);
        await page.click("#invitations-previous-top");
        await waitUntil(() => page.execute("return document.getElementById('invitations-page-note').textContent.includes('Page 1') && !document.getElementById('invitations-next-top').disabled"), "previous invitation page");
        assert.deepEqual(await page.execute("return [...document.querySelectorAll('#invitations-list>details')].map(node=>node.dataset.invitationId)"), firstIds);
        assert.equal(await page.execute("return document.getElementById('invitation-code-result').value===arguments[0] && document.getElementById('invitation-hours').value==='48'", code), true);
        assert.equal(await page.execute("const list=document.getElementById('invitations-list');return document.documentElement.scrollWidth<=document.documentElement.clientWidth+1 && list.clientHeight<=innerHeight*.66 && list.scrollHeight>list.clientHeight"), true);
        await page.execute("document.getElementById('invitations-title').scrollIntoView({block:'start'});document.querySelector('#invitations-list>details summary').focus()");
        await page.key("\uE007");
        assert.equal(await page.execute("return document.querySelector('#invitations-list>details').open"), true, "native details can be opened from the keyboard");
        await capture(page, `admin-invitations-1130-${language}-${width}`);
      } finally { await page.close(); }
    });
    assert.ok(source.listQueries.some(query => query.state === "expired" && query.cursor !== null));
    assert.ok(source.listQueries.every(query => query.limit === 25 && query.returned <= 25));
    assert.equal(source.creations.length, 4); cleanFixture(source);
  } finally { try { await source.close(); } finally { await driver?.close(); } }
});
