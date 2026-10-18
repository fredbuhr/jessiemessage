import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../server/index.mjs";
import { createAuthHandler } from "../server/auth/http.mjs";
import { request as httpRequest } from "node:http";

const token = Buffer.alloc(32, 17).toString("base64url"), csrf = Buffer.alloc(32, 18).toString("base64url");
const origin = "https://jessiemessage.com";
const paths = ["/admin", "/admin/messages", "/admin/broadcasts", "/admin/readiness", "/admin/backups"];
async function fixture(t, { legacy = false, backups = true } = {}) {
  const session = { user: { id: "1".repeat(32), role: "admin", pseudonym: "Synthetic" }, csrf, expiresAt: Date.now() + 86400000 };
  const authHandler = createAuthHandler({ login() {}, logout() {}, logoutAll() {}, async session(value) { return value === token ? session : null; } }, { origin });
  const restricted = async (request, response) => {
    const path = new URL(request.url, origin).pathname;
    if (!paths.slice(1).includes(path)) return false;
    response.writeHead(401, { "Content-Type": "application/json" }); response.end('{"error":"authentication_required"}'); return true;
  };
  const handlers = { authHandler, chatHandler: restricted, broadcastHandler: restricted, readinessHandler: restricted, ...(backups ? { backupHandler: restricted } : {}) };
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

test("navigation bridge never authenticates APIs, changes mutation checks or intercepts a presented session", async t => {
  const request = await fixture(t);
  const good = await request("/admin", { headers: { Accept: "text/html", Cookie: `__Host-jessie_session=${token}` } });
  assert.equal(good.status, 200);
  assert.equal((await request("/api/auth/session", { headers: { Accept: "text/html" } })).status, 401);
  assert.equal((await request("/admin/backups")).status, 401, "non-navigation API-style access retains its refusal");
  assert.equal((await request("/api/auth/logout", { method: "POST", headers: { Accept: "text/html" }, body: "{}" })).status, 403);
  const expired = await request("/admin", { headers: { Accept: "text/html", Cookie: `__Host-jessie_session=${Buffer.alloc(32, 99).toString("base64url")}` } });
  assert.equal(expired.status, 303);
  assert.match(expired.headers.get("set-cookie"), /Max-Age=0/);
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
