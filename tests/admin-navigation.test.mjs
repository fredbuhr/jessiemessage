import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../server/index.mjs";
import { createAuthHandler } from "../server/auth/http.mjs";
import { request as httpRequest } from "node:http";

const token = Buffer.alloc(32, 17).toString("base64url"), csrf = Buffer.alloc(32, 18).toString("base64url");
const origin = "https://jessiemessage.com";
const paths = ["/admin", "/admin/clients", "/admin/messages", "/admin/broadcasts", "/admin/readiness", "/admin/backups", "/admin/privacy"];
async function fixture(t, { legacy = false, backups = true, auth = true } = {}) {
  const session = { user: { id: "1".repeat(32), role: "admin", pseudonym: "Synthetic" }, csrf, expiresAt: Date.now() + 86400000 };
  const authHandler = auth ? createAuthHandler({ login() {}, logout() {}, logoutAll() {}, async session(value) { return value === token ? session : null; } }, { origin }) : undefined;
  const restricted = async (request, response) => {
    const path = new URL(request.url, origin).pathname;
    if (path === "/admin/clients" || !paths.slice(1).includes(path)) return false;
    response.writeHead(401, { "Content-Type": "application/json" }); response.end('{"error":"authentication_required"}'); return true;
  };
  const handlers = { privacyHandler: restricted, authHandler, chatHandler: restricted, broadcastHandler: restricted, readinessHandler: restricted, ...(backups ? { backupHandler: restricted } : {}) };
  const server = createAppServer({ ...handlers, ...(legacy ? { requestOrigin: origin, legacyHandlers: { authHandler, entryHandler: async () => false } } : {}) });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return (path, options = {}) => new Promise((resolve, reject) => {
    const request = httpRequest(`http://127.0.0.1:${server.address().port}${path}`, options, response => {
      const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.once("error", reject);
      response.once("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    });
    request.once("error", reject); request.end(options.body);
  });
}

test("external administrator page navigation keeps the Strict cookie and a closed return path", async t => {
  const request = await fixture(t);
  for (const path of paths) for (const method of ["GET", "HEAD"]) {
    const response = await request(`${path}?untrusted=https://example.invalid`, { method, headers: { Accept: "text/html,application/xhtml+xml;q=0.9", "Sec-Fetch-Site": "cross-site" } });
    assert.equal(response.status, 303, path);
    assert.equal(response.headers.get("location"), path === "/admin" ? "/admin/login" : `/admin/login?continue=${encodeURIComponent(path)}`);
    assert.equal(response.headers.get("set-cookie"), null, "an absent cookie must not erase a browser login");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "");
  }
  const navigation = await request("/admin/backups", { headers: { "Sec-Fetch-Mode": "navigate" } });
  assert.equal(navigation.status, 303, "navigation metadata also works without Accept");
});

test("backup navigation keeps its canonical login target and the slash alias retains the return query", async t => {
  const request = await fixture(t);
  for (const method of ["GET", "HEAD"]) {
    const options = { method, headers: { Accept: "text/html", "Sec-Fetch-Site": "cross-site" } };
    const navigation = await request("/admin/backups?untrusted=https://attacker.example", options);
    const destination = "/admin/login?continue=%2Fadmin%2Fbackups";
    assert.equal(navigation.status, 303);
    assert.equal(navigation.headers.get("location"), destination);
    const alias = await request("/admin/login/?continue=%2Fadmin%2Fbackups", options);
    assert.equal(alias.status, 308);
    assert.equal(alias.headers.get("location"), destination);
    assert.equal(alias.headers.get("cache-control"), "no-store");
    assert.equal(alias.headers.get("set-cookie"), null);
    assert.equal(await alias.text(), "");
    const login = await request(alias.headers.get("location"), options);
    assert.equal(login.status, 200);
    assert.equal(login.headers.get("set-cookie"), null);
    assert.equal((await request("/admin/backups", { method })).status, 401, "the public login document does not authenticate protected reads");
  }
  assert.equal((await request("/api/auth/session")).status, 401);
});

test("navigation bridge never authenticates APIs, changes mutation checks or intercepts a presented session", async t => {
  const request = await fixture(t);
  const good = await request("/admin", { headers: { Accept: "text/html", Cookie: `__Host-jessie_session=${token}` } });
  assert.equal(good.status, 200);
  assert.equal((await request("/api/auth/session", { headers: { Accept: "text/html" } })).status, 401);
  assert.equal((await request("/admin/backups")).status, 401, "non-navigation API-style access retains its refusal");
  assert.equal((await request("/api/auth/logout", { method: "POST", headers: { Accept: "text/html" }, body: "{}" })).status, 403);
  const expired = await request("/admin", { headers: { Accept: "text/html", Cookie: `__Host-jessie_session=${Buffer.alloc(32, 99).toString("base64url")}` } });
  assert.equal(expired.status, 303);
  assert.equal(expired.headers.get("set-cookie"), null, "an old navigation cannot erase a later login");
});

test("disabled routes and the recipe origin cannot acquire a primary-only backup bridge", async t => {
  const request = await fixture(t, { legacy: true });
  const response = await request("/admin/backups", { headers: { Host: "recette.jessiemessage.com", Accept: "text/html" } });
  assert.equal(response.status, 404); assert.equal(response.headers.get("location"), null);
  const disabled = await fixture(t, { backups: false });
  assert.equal((await disabled("/admin/backups", { headers: { Accept: "text/html" } })).status, 401);
  for (const path of ["/admin/unknown", "/admin/backups/extra", "/admin-login.js"]) {
    const response = await disabled(path, { headers: { Accept: "text/html" } });
    assert.notEqual(response.status, 303);
  }
});

test("a server without authentication does not acquire the login slash alias", async t => {
  const request = await fixture(t, { auth: false });
  for (const path of ["/admin/login", "/admin/login/", "/admin/login/?continue=%2Fadmin%2Fbackups"]) for (const method of ["GET", "HEAD"]) {
    const response = await request(path, { method, headers: { Accept: "text/html" } });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});


test("a delayed refusal on the new clients page cannot erase a newer administrator login", async t => {
  const old = Buffer.alloc(32, 61).toString("base64url"), next = Buffer.alloc(32, 62).toString("base64url");
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const current = { user: { id: "1".repeat(32), role: "admin", pseudonym: "Synthetic" }, csrf, expiresAt: Date.now() + 86400000 };
  const authHandler = createAuthHandler({ async login() { return { ...current, token: next }; }, async session(value) {
    if (value === old) { entered(); await gate; return null; } return value === next ? current : null;
  }, async logout() {}, async logoutAll() {} }, { origin });
  const server = createAppServer({ authHandler }); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const pending = fetch(base + "/admin/clients", { redirect: "manual", headers: { Accept: "text/html", Cookie: `__Host-jessie_session=${old}` } });
  await started;
  const login = await fetch(base + "/api/auth/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1" },
    body: JSON.stringify({ email: "admin@example.invalid", password: "synthetic password", factor: "123456" }) });
  assert.equal(login.status, 200); assert.ok(login.headers.get("set-cookie").startsWith(`__Host-jessie_session=${next};`));
  release(); const refused = await pending; assert.equal(refused.status, 303); assert.equal(refused.headers.get("location"), "/admin/login?continue=%2Fadmin%2Fclients");
  assert.equal(refused.headers.get("set-cookie"), null);
  const page = await fetch(base + "/admin/clients", { headers: { Cookie: `__Host-jessie_session=${next}` } });
  assert.equal(page.status, 200); assert.match(await page.text(), /id="access-tools"/);
});
