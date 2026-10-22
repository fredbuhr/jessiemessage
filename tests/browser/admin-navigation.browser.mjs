// Real cross-site navigation (localhost -> 127.0.0.1), native Strict cookies,
// real login controller and server routing. All accounts and TLS are synthetic.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:https";
import { createAppServer } from "../../server/index.mjs";
import { createAuthHandler, sessionToken } from "../../server/auth/http.mjs";
import { startWebDriver, waitUntil } from "./webdriver.mjs";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "jessiemessage-admin-navigation-"));
  await chmod(directory, 0o700);
  let server, app;
  try {
    const keyPath = join(directory, "key.pem"), certPath = join(directory, "cert.pem");
    await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", keyPath, "-out", certPath],
      { timeout: 10000, maxBuffer: 65536, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", OPENSSL_CONF: "/dev/null" } });
    await chmod(keyPath, 0o600); await chmod(certPath, 0o600);
    const token = Buffer.alloc(32, 27).toString("base64url"), csrf = Buffer.alloc(32, 28).toString("base64url");
    const session = { user: { id: "1".repeat(32), role: "admin", pseudonym: "Synthetic" }, csrf, expiresAt: Date.now() + 180 * 86400000 };
    let origin, outside;
    const requests = [];
    server = createServer({ key: await readFile(keyPath), cert: await readFile(certPath), minVersion: "TLSv1.2" }, (request, response) => {
      const url = new URL(request.url, "https://localhost");
      requests.push({ path: url.pathname, host: request.headers.host, hasCookie: sessionToken(request) === token, site: request.headers["sec-fetch-site"] });
      if (request.headers.host === new URL(outside).host) {
        const path = url.searchParams.get("target") === "/admin/backups" ? "/admin/backups" : "/admin";
        response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
        response.end(`<!doctype html><title>Synthetic outside site</title><a id="return" href="${origin}${path}">Open JessieMessage</a>`); return;
      }
      app.emit("request", request, response);
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    origin = `https://127.0.0.1:${server.address().port}`; outside = `https://localhost:${server.address().port}`;
    const authHandler = createAuthHandler({ async login() { return { ...session, token }; }, async session(value) { return value === token ? session : null; }, async logout() {}, async logoutAll() {} }, { origin });
    const backupHandler = async (request, response) => {
      if (new URL(request.url, origin).pathname !== "/admin/backups") return false;
      const connected = sessionToken(request) === token;
      response.writeHead(connected ? 200 : 401, { "Content-Type": "text/html", "Cache-Control": "no-store" });
      response.end(connected ? '<!doctype html><h1 id="private-backups">Synthetic private backups</h1>' : "denied"); return true;
    };
    app = createAppServer({ authHandler, backupHandler });
    return { origin, outside, token, requests, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) {
    server?.closeAllConnections(); if (server?.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true }); throw error;
  }
}
async function link(page, href) {
  await page.execute("document.getElementById('test-link')?.remove();const a=document.createElement('a');a.id='test-link';a.href=arguments[0];a.textContent='Synthetic navigation';document.body.prepend(a)", href);
  await page.click("#test-link");
}

test("real Chrome: external links retain the existing Strict admin session and resume a private deep link", { timeout: 90000 }, async () => {
  const driver = await startWebDriver(); let source, page;
  try {
    source = await fixture(); page = await driver.browser({ origin: source.origin, acceptInsecureCerts: true, width: 375 });
    await page.navigate("/admin/login");
    await waitUntil(() => page.execute("return !document.getElementById('login-form').hidden && !document.getElementById('login-button').disabled"), "synthetic login form");
    await page.type("#email", "admin@example.invalid"); await page.type("#password", "synthetic fixture password"); await page.type("#factor", "123456"); await page.click("#login-button");
    await waitUntil(() => page.execute("return location.pathname === '/admin' && !document.getElementById('connected').hidden"), "initial administrator connection");
    for (const path of ["/admin", "/admin/backups"]) {
      const start = source.requests.length;
      await link(page, `${source.outside}/outside?target=${encodeURIComponent(path)}`);
      await page.click("#return");
      await waitUntil(() => page.execute("return location.pathname === arguments[0] && (arguments[0] === '/admin' ? !!document.getElementById('connected') && !document.getElementById('connected').hidden : !!document.getElementById('private-backups'))", path), "automatic session resumption");
      const entry = source.requests.slice(start).find(item => item.path === path && item.host === new URL(source.origin).host);
      assert.equal(entry?.site, "cross-site"); assert.equal(entry?.hasCookie, false, "Chrome actually withheld the Strict cookie on the first page navigation");
      assert.equal(source.requests.slice(start).some(item => item.path === "/api/auth/session" && item.hasCookie), true, "same-origin login proof recovers the existing cookie");
      const cookie = (await page.cookies()).find(cookie => cookie.name === "__Host-jessie_session");
      assert.equal(cookie?.value === source.token, true, "the identical session survives without another login");
      assert.deepEqual({ secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite }, { secure: true, httpOnly: true, sameSite: "Strict" });
    }
    for (const query of ["continue=https%3A%2F%2Fexample.invalid", "continue=%2F%2Fexample.invalid", "continue=%2Fadmin%2Fbackups&continue=%2Fadmin%2Fmessages"]) {
      await link(page, `${source.origin}/admin/login?${query}`);
      await waitUntil(() => page.execute("return location.pathname === '/admin' && !document.getElementById('connected').hidden"), "invalid return link ignored");
    }
    assert.equal(await page.execute("return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.querySelector('.admin-dashboard a[href=\"/admin/backups\"]')?.getBoundingClientRect().height >= 44"), true);
  } finally {
    try { await page?.close(); } finally { try { await source?.close(); } finally { await driver.close(); } }
  }
});
