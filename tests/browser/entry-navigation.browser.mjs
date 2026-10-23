// Actual entry/access/admin routing, controllers and native HTTPS cookies.
// Accounts, credential checks and destinations are synthetic; no SQL, SMTP,
// Push provider, production host, backup or restore is used.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppServer } from "../../server/index.mjs";
import { createAuthHandler, sessionToken } from "../../server/auth/http.mjs";
import { createAccessHandler } from "../../server/access/http.mjs";
import { createEntryHandler } from "../../server/entry/http.mjs";
import { startWebDriver, tabUntil, waitUntil } from "./webdriver.mjs";

const password = "Synthetic navigation password", email = "client@example.invalid";
const reference = "b".repeat(32), screenshots = new URL("../../artifacts/homepage/", import.meta.url);
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "jessie-entry-navigation-")); await chmod(directory, 0o700);
  const key = join(directory, "key.pem"), cert = join(directory, "cert.pem");
  let server;
  try {
    await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", key, "-out", cert],
      { timeout: 10000, maxBuffer: 65536, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", OPENSSL_CONF: "/dev/null" } });
    await chmod(key, 0o600); await chmod(cert, 0o600);
    const clientToken = Buffer.alloc(32, 7).toString("base64url"), adminToken = Buffer.alloc(32, 8).toString("base64url");
    const client = { user: { id: "1".repeat(32), role: "client", pseudonym: "Compte de test" }, csrf: Buffer.alloc(32, 9).toString("base64url"), expiresAt: Date.now() + 3600000,
      access: { state: "active", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, approved: true, ageAssured: false, expiresAt: null } };
    const admin = { user: { id: "2".repeat(32), role: "admin", pseudonym: "Jessie de test" }, csrf: Buffer.alloc(32, 10).toString("base64url"), expiresAt: Date.now() + 3600000 };
    const requests = []; let app;
    server = createServer({ key: await readFile(key), cert: await readFile(cert), minVersion: "TLSv1.2" }, (request, response) => {
      requests.push({ path: new URL(request.url, "https://localhost").pathname, method: request.method });
      app.emit("request", request, response);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `https://127.0.0.1:${server.address().port}`;
    const clientSession = async token => token === clientToken ? client : null, adminSession = async token => token === adminToken ? admin : null;
    const access = Object.fromEntries(["inspectInvitation", "createInvitation", "revokeInvitation", "register", "verifyEmail", "resendVerification", "logout", "logoutAll", "approveClient", "revokeClient", "renewClient"].map(name => [name, async () => { throw new Error(`Unexpected synthetic action: ${name}`); }]));
    Object.assign(access, { session: clientSession, adminSession, listClients: async () => ({ clients: [], hasMore: false, nextCursor: null }),
      listInvitations: async () => ({ invitations: [], hasMore: false, nextCursor: null }), async login(input) {
        assert.equal(input.email, email); assert.equal(input.password, password); return { ...client, token: clientToken };
      } });
    const authHandler = createAuthHandler({ session: adminSession, async login(input) {
      assert.equal(input.email, "admin@example.invalid"); assert.equal(input.password, password); assert.equal(input.factor, "123456");
      return { ...admin, token: adminToken };
    }, async logout() {}, async logoutAll() {} }, { origin });
    const chatHandler = async (request, response) => {
      const path = new URL(request.url, origin).pathname;
      if (!["/messages", "/admin/messages", "/api/chat/client/capabilities", "/api/chat/admin/capabilities"].includes(path)) return false;
      const administrator = path.includes("admin"), token = sessionToken(request, administrator ? "__Host-jessie_session" : "__Host-jessie_client");
      const session = await (administrator ? adminSession : clientSession)(token);
      const page = path.endsWith("messages");
      response.writeHead(session ? 200 : 401, { "Content-Type": page ? "text/html" : "application/json", "Cache-Control": "no-store" });
      response.end(session ? page ? '<!doctype html><title>Synthetic messages</title><h1 id="synthetic-messages">Conversation de test</h1>' : '{"enabled":true}' : '{"error":"authentication_required"}');
      return true;
    };
    app = createAppServer({ authHandler, accessHandler: createAccessHandler(access, { origin }), chatHandler,
      entryHandler: createEntryHandler({ clientSession, adminSession, chatEnabled: true, deviceTransition: true }) });
    return { origin, requests, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) {
    server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true }); throw error;
  }
}
async function capture(page, name) {
  const png = Buffer.from(await page.screenshot(), "base64");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  await mkdir(screenshots, { recursive: true }); await writeFile(new URL(`${name}.png`, screenshots), png);
}
async function layout(page) {
  assert.equal(await page.execute(`const width = document.documentElement.clientWidth;
    const controls = [...document.querySelectorAll('a,button,input,summary')].filter(node => node.checkVisibility());
    return document.documentElement.scrollWidth <= width + 1 && controls.every(node => {
      const r = node.getBoundingClientRect(); return (node.matches('a.brand') || r.height >= 44) && r.left >= -1 && r.right <= width + 1 && node.scrollWidth <= node.clientWidth + 1;
    });`), true, "visible action controls have fitting labels and44px targets; all visible controls including the logo fit without horizontal overflow");
}
async function loginClient(page) {
  await page.type("#login-email", email); await page.type("#login-password", password);
  await tabUntil(page, "#client-login-form button[type=submit]"); await page.key("\uE007");
  await waitUntil(() => page.execute("return location.pathname === '/messages' && !!document.getElementById('synthetic-messages')"), "client opens messages after one login");
}
async function loginAdmin(page) {
  await waitUntil(() => page.execute("return !document.getElementById('login-form').hidden && !document.getElementById('login-button').disabled"), "administrator MFA form");
  assert.deepEqual(await adminDestinations(page), { home: 1, messages: 0 }, "anonymous MFA has only its labelled home link");
  await page.type("#email", "admin@example.invalid"); await page.type("#password", password); await page.type("#factor", "123456"); await page.click("#login-button");
}
async function adminDestinations(page) {
  return page.execute(`const count = href => [...document.querySelectorAll('a[href="'+href+'"]')].filter(node => node.checkVisibility()).length;
    return {home:count('/admin'), messages:count('/admin/messages')};`);
}

test("real Chrome: configured root is one client sign-in page and administrator home has its own tools at320/1280px", { timeout: 180000 }, async t => {
  const source = await fixture(); let driver;
  try {
    driver = await startWebDriver();
    for (const width of [320, 1280]) await t.test(`${width}px`, async () => {
      const page = await driver.browser({ origin: source.origin, acceptInsecureCerts: true, width });
      try {
        await page.navigate("/"); await waitUntil(() => page.execute("return !document.getElementById('client-login-form').hidden"), "root sign-in form");
        assert.equal(await page.execute("return location.pathname"), "/");
        assert.equal(await page.execute("return document.getElementById('entry-role-choice').hidden"), true);
        await layout(page); await capture(page, `client-home-${width}`);
        const start = source.requests.length; await loginClient(page);
        assert.equal(source.requests.slice(start).filter(item => item.path === "/api/access/login" && item.method === "POST").length, 1);
        assert.equal(source.requests.slice(start).some(item => item.path.startsWith("/connect-device") || item.path === "/app"), false);
        await page.navigate("/"); await waitUntil(() => page.execute("return location.pathname === '/messages'"), "connected client skips the landing page");
        await page.navigate("/access"); await waitUntil(() => page.execute("return !document.getElementById('client-connected').hidden && !document.getElementById('client-chat-link').hidden"), "explicit account settings stay available");
        assert.equal(await page.execute("return location.pathname"), "/access");
        await page.navigate("/admin"); await waitUntil(() => page.execute("return location.pathname === '/admin/login'"), "short admin address reaches MFA login");
        await loginAdmin(page); await waitUntil(() => page.execute("return location.pathname === '/admin' && !document.getElementById('connected').hidden"), "separate administrator home");
        assert.equal(await page.execute("return document.getElementById('access-tools').hidden && !document.getElementById('admin-dashboard').hidden"), true);
        await waitUntil(() => page.execute("return !document.getElementById('admin-chat-link').hidden"), "unique messaging CTA after capability proof");
        assert.deepEqual(await adminDestinations(page), { home: 0, messages: 1 }, "home has no self-link or duplicate messaging CTA");
        assert.equal(await page.execute("return !document.getElementById('admin-home-current').hidden"), true);
        await layout(page); await capture(page, `admin-home-${width}`);
        if (await page.execute("return document.documentElement.scrollHeight > innerHeight + 1")) {
          await page.execute("scrollTo(0,document.documentElement.scrollHeight)"); await capture(page, `admin-home-${width}-bottom`); await page.execute("scrollTo(0,0)");
        }
        await page.click('#admin-dashboard a[href="/admin/clients"]');
        await waitUntil(() => page.execute("return location.pathname === '/admin/clients' && !document.getElementById('access-tools').hidden"), "client management is its own view");
        assert.equal(await page.execute("return document.getElementById('admin-dashboard').hidden"), true);
        await waitUntil(() => page.execute("return !document.getElementById('admin-chat-link').hidden"), "client management messaging capability");
        assert.deepEqual(await adminDestinations(page), { home: 1, messages: 1 });
        assert.equal(await page.execute("const home=document.getElementById('admin-home-link');return home.getAttribute('aria-label')==='Accueil admin' && home.title==='Accueil admin'"), true);
        await page.navigate("/"); await waitUntil(() => page.execute("return !document.getElementById('entry-role-choice').hidden"), "two roles remain an explicit compact choice");
        assert.equal(await page.execute("return location.pathname === '/' && document.getElementById('client-login-form').hidden"), true);
        await page.click("#entry-admin-link"); await waitUntil(() => page.execute("return location.pathname === '/admin' && !document.getElementById('connected').hidden"), "explicit administration choice");
        assert.equal(await page.execute("return Object.keys(localStorage).length === 0 && Object.keys(sessionStorage).every(key=>key==='jessiemessage.language')"), true);
        await page.click("#logout-button");
        await waitUntil(() => page.execute("return location.pathname === '/admin/login' && !document.getElementById('login-form').hidden"), "explicit logout returns to the MFA form");
        assert.deepEqual(await adminDestinations(page), { home: 1, messages: 0 }, "logout restores the single home link on the login page");
        assert.equal(await page.execute("return document.getElementById('admin-home-current').hidden"), true);
      } finally { await page.close(); }
    });
  } finally { try { await source.close(); } finally { await driver?.close(); } }
});

test("real Chrome: client and MFA administrator sign-in preserve the exact notification destination without a dashboard hop", { timeout: 90000 }, async () => {
  const source = await fixture(); let driver;
  try {
    driver = await startWebDriver();
    for (const role of ["client", "admin"]) {
      const page = await driver.browser({ origin: source.origin, acceptInsecureCerts: true, width: 375 });
      try {
        const start = source.requests.length;
        await page.navigate(`${role === "admin" ? "/admin/login" : "/"}#notification=${reference}`);
        if (role === "admin") await loginAdmin(page);
        else { await waitUntil(() => page.execute("return !document.getElementById('client-login-form').hidden"), "notified client sign-in"); await loginClient(page); }
        await waitUntil(() => page.execute("return location.pathname === arguments[0] && location.hash === arguments[1] && !!document.getElementById('synthetic-messages')", role === "admin" ? "/admin/messages" : "/messages", `#notification=${reference}`), "exact authenticated notification destination");
        const requests = source.requests.slice(start);
        assert.equal(requests.some(item => item.path.startsWith("/connect-device")), false);
        assert.equal(requests.filter(item => item.path === (role === "admin" ? "/api/auth/login" : "/api/access/login") && item.method === "POST").length, 1);
        if (role === "admin") assert.equal(requests.some(item => item.path === "/admin"), false);
      } finally { await page.close(); }
    }
  } finally { try { await source.close(); } finally { await driver?.close(); } }
});
