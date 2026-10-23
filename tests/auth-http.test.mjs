import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { createAuthHandler, AUTH_HEADERS } from "../server/auth/http.mjs";

const origin = "https://jessiemessage.example";
const token = Buffer.alloc(32, 7).toString("base64url");
const csrf = Buffer.alloc(32, 9).toString("base64url");
const user = { id: "1234567890abcdef1234567890abcdef", role: "admin", pseudonym: "Jessie" };
const credentials = { email: "jessie@example.invalid", password: "un vrai mot de passe de test", factor: "123456" };
const cookie = `__Host-jessie_session=${token}`;

async function fixture(t, overrides = {}) {
  const calls = [];
  const session = { token, csrf, user, expiresAt: Date.now() + 60 * 60 * 1000 };
  const service = {
    async login(input) { calls.push(["login", input]); return { ...session, internalPasswordHash: "never-expose-this" }; },
    async session(value) { calls.push(["session", value]); return value === token ? session : null; },
    async logout(value) { calls.push(["logout", value]); },
    async logoutAll(value) { calls.push(["logoutAll", value]); },
    ...overrides,
  };
  const handler = createAuthHandler(service, { origin });
  const server = createServer(async (req, res) => {
    if (!await handler(req, res)) { res.writeHead(404); res.end("fallback"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, calls, service, session, server };
}

function mutationHeaders(extra = {}) {
  return { Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1", ...extra };
}

function post(base, path, body = credentials, headers = mutationHeaders()) {
  return fetch(`${base}${path}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

function assertHeaders(response) {
  for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value, name);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}

test("auth handler requires an exact HTTPS origin and all service methods", () => {
  const service = { login() {}, session() {}, logout() {}, logoutAll() {} };
  for (const value of ["http://jessiemessage.example", `${origin}/`, `${origin}/admin`, `${origin}?x=1`, "https://user:password@jessiemessage.example"]) {
    assert.throws(() => createAuthHandler(service, { origin: value }));
  }
  assert.throws(() => createAuthHandler({}, { origin }));
});

test("login issues only an HttpOnly secure session cookie and a minimal public response", async (t) => {
  const { base, calls } = await fixture(t);
  const response = await post(base, "/api/auth/login", credentials, mutationHeaders({ "X-Forwarded-For": "203.0.113.44", "Sec-Fetch-Site": "same-origin" }));
  assert.equal(response.status, 200);
  assertHeaders(response);
  const data = await response.json();
  assert.deepEqual(Object.keys(data).sort(), ["csrf", "expiresAt", "user"]);
  assert.deepEqual(data.user, user);
  assert.equal(data.csrf, csrf);
  const value = response.headers.get("set-cookie");
  assert.match(value, new RegExp(`^__Host-jessie_session=${token}; Path=/; Max-Age=\\d+; Secure; HttpOnly; SameSite=Strict$`));
  assert.doesNotMatch(value, /Domain=/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], { ...credentials, peerAddress: "127.0.0.1" });
  assert.equal(JSON.stringify(data).includes(token), false);
  assert.equal(JSON.stringify(data).includes("never-expose"), false);
});

test("mutation rejects absent, cross-site and noncanonical origins before password verification", async (t) => {
  const { base, calls } = await fixture(t);
  for (const headers of [
    { "Content-Type": "application/json", "X-Jessie-Request": "1" },
    mutationHeaders({ Origin: "https://attacker.example" }),
    mutationHeaders({ Origin: `${origin}/` }),
    mutationHeaders({ Origin: "null" }),
    mutationHeaders({ "Sec-Fetch-Site": "cross-site" }),
    mutationHeaders({ "Sec-Fetch-Site": "same-site" }),
    mutationHeaders({ "X-Jessie-Request": "wrong" }),
  ]) {
    const response = await post(base, "/api/auth/login", credentials, headers);
    assert.equal(response.status, 403);
    assertHeaders(response);
    assert.deepEqual(await response.json(), { error: "request_rejected" });
  }
  assert.equal(calls.length, 0);
});

test("login requires a bounded JSON object and validates payload shape", async (t) => {
  const { base, calls } = await fixture(t);
  for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "application/json; charset=latin1", "application/json; unexpected=yes"]) {
    const response = await post(base, "/api/auth/login", credentials, mutationHeaders({ "Content-Type": contentType }));
    assert.equal(response.status, 415);
  }
  for (const body of ["not-json", "[]", "null", "{}", { ...credentials, factor: "12345" }, { ...credentials, factor: "<script>" }, { ...credentials, password: "x".repeat(129) }, { ...credentials, admin: true }, { ...credentials, email: "a".repeat(255) }]) {
    const response = await post(base, "/api/auth/login", body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  const oversized = await post(base, "/api/auth/login", "x".repeat(4097));
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get("connection"), "close");
  assert.deepEqual(await oversized.json(), { error: "request_too_large" });
  assert.equal(calls.length, 0);
});

test("chunked bodies are bounded independently of content-length", async (t) => {
  const { base } = await fixture(t);
  const result = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/api/auth/login`, { method: "POST", headers: mutationHeaders() }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.write("x".repeat(2048));
    req.write("x".repeat(2048));
    req.end("x");
  });
  assert.equal(result.status, 413);
  assert.deepEqual(JSON.parse(result.body), { error: "request_too_large" });
});

test("an aborted body is handled without crashing subsequent requests", async (t) => {
  const { base, calls } = await fixture(t);
  await new Promise((resolve) => {
    const req = httpRequest(`${base}/api/auth/login`, { method: "POST", headers: mutationHeaders() });
    req.on("error", () => {});
    req.write('{"email":');
    setTimeout(() => { req.destroy(); resolve(); }, 20);
  });
  const result = await post(base, "/api/auth/login");
  assert.equal(result.status, 200);
  assert.equal(calls.filter(([name]) => name === "login").length, 1);
});

test("invalid UTF-8 JSON is rejected rather than silently repaired", async (t) => {
  const { base, calls } = await fixture(t);
  const result = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/api/auth/login`, { method: "POST", headers: mutationHeaders() }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end(Buffer.concat([Buffer.from('{"email":"'), Buffer.from([0xc3, 0x28]), Buffer.from('","password":"example","factor":"123456"}') ]));
  });
  assert.equal(result, 400);
  assert.equal(calls.length, 0);
});

test("JSON UTF-8 charset and grouped recovery codes are accepted", async (t) => {
  const { base } = await fixture(t);
  const response = await post(base, "/api/auth/login", { ...credentials, factor: "12345678-abcdabcd-01234567-89abcdef" }, mutationHeaders({ "Content-Type": 'application/json; charset="utf-8"', "Sec-Fetch-Site": "none" }));
  assert.equal(response.status, 200);
});

test("recovery code separators are limited to ASCII spaces and hyphens", async (t) => {
  const { base, calls } = await fixture(t);
  for (const separator of ["\t", "\n", "\r", "\u00a0"]) {
    const factor = ["12345678", "abcdabcd", "01234567", "89abcdef"].join(separator);
    const response = await post(base, "/api/auth/login", { ...credentials, factor });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.equal(calls.length, 0);
  const accepted = await post(base, "/api/auth/login", { ...credentials, factor: "12345678 abcdabcd 01234567 89abcdef" });
  assert.equal(accepted.status, 200);
});

test("session endpoint returns the CSRF token only for a canonical authenticated cookie", async (t) => {
  const { base, calls } = await fixture(t);
  const response = await fetch(`${base}/api/auth/session`, { headers: { Cookie: `irrelevant=a; ${cookie}; preference=b` } });
  assert.equal(response.status, 200);
  assertHeaders(response);
  assert.deepEqual((await response.json()).user, user);
  const before = calls.length;
  for (const header of ["__Host-jessie_session=", `${cookie}; ${cookie}`, `${cookie}; __Host-jessie_session=other`, `__Host-jessie_session=${"A".repeat(42)}B`, `__Host-jessie_session=${token}=`, `__Host-jessie_session="${token}"`, "__Host-jessie_session=short", `preference=${"x".repeat(8192)}; ${cookie}`]) {
    const result = await fetch(`${base}/api/auth/session`, { headers: { Cookie: header } });
    assert.equal(result.status, 401);
    assert.deepEqual(await result.json(), { error: "authentication_required" });
    assert.equal(result.headers.get("set-cookie"), null);
  }
  assert.equal(calls.length, before);
});

test("unauthenticated admin reads without their cookie deny access without changing cookies", async (t) => {
  const { base, calls } = await fixture(t);
  for (const header of [undefined, "preference=a", `__Host-jessie_client=${token}`, `other_${cookie}`, `__Host-jessie_session_extra=${token}`]) {
    for (const [path, method] of [["/api/auth/session", "GET"], ["/api/auth/devices", "GET"], ["/admin", "GET"], ["/admin", "HEAD"]]) {
      const response = await fetch(`${base}${path}`, { method, redirect: "manual",
        headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", ...(header ? { Cookie: header } : {}) } });
      assert.equal(response.status, path === "/admin" ? 303 : 401);
      assert.equal(response.headers.get("set-cookie"), null);
      if (path === "/admin") assert.equal(response.headers.get("location"), "/admin/login");
      else assert.deepEqual(await response.json(), { error: "authentication_required" });
    }
  }
  assert.equal(calls.length, 0);
});

test("admin reads reject an absent SQL session without changing cookies", async (t) => {
  const { base, calls } = await fixture(t, { async session(value) { calls.push(["session", value]); return null; } });
  for (const path of ["/api/auth/session", "/api/auth/devices", "/admin"]) {
    const response = await fetch(`${base}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
    assert.equal(response.status, path === "/admin" ? 303 : 401);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.deepEqual(calls, Array.from({ length: 3 }, () => ["session", token]));
});

test("logout checks origin, session and CSRF before revoking or accepting a body", async (t) => {
  const { base, calls } = await fixture(t);
  for (const headers of [
    mutationHeaders({ Cookie: cookie }),
    mutationHeaders({ Cookie: cookie, "X-CSRF-Token": "invalid" }),
    mutationHeaders({ Cookie: cookie, "X-CSRF-Token": csrf, Origin: "https://attacker.example" }),
  ]) {
    const response = await post(base, "/api/auth/logout", {}, headers);
    assert.equal(response.status, 403);
  }
  const invalidBody = await post(base, "/api/auth/logout", { ignored: true }, mutationHeaders({ Cookie: cookie, "X-CSRF-Token": csrf }));
  assert.equal(invalidBody.status, 400);
  assert.equal(calls.some(([name]) => name === "logout"), false);
  for (const [path, method] of [["/api/auth/logout", "logout"], ["/api/auth/logout-all", "logoutAll"]]) {
    const result = await post(base, path, {}, mutationHeaders({ Cookie: cookie, "X-CSRF-Token": csrf }));
    assert.equal(result.status, 200);
    assertHeaders(result);
    assert.deepEqual(await result.json(), { status: "signed_out" });
    assert.equal(result.headers.get("set-cookie"), null);
    assert.deepEqual(calls.filter(([name]) => name === method), [[method, token]]);
  }
});

test("logout without a session returns 401 without changing cookies", async (t) => {
  const { base, calls } = await fixture(t);
  for (const path of ["/api/auth/logout", "/api/auth/logout-all"]) {
    const response = await post(base, path, {}, mutationHeaders({ "X-CSRF-Token": csrf }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(calls.length, 0);
});

test("rate limiting and backend errors expose no credentials or exception detail", async (t) => {
  const { base, service } = await fixture(t);
  for (const [code, status, publicCode] of [["AUTH_INVALID", 401, "invalid_credentials"], ["AUTH_RATE_LIMIT", 429, "try_again_later"], ["AUTH_BUSY", 429, "try_again_later"], ["AUTH_UNAVAILABLE", 503, "authentication_unavailable"], ["SQL_ERROR", 503, "authentication_unavailable"]]) {
    service.login = async () => { throw Object.assign(new Error("database password secret; factor 123456"), { code, retryAfter: 17.2 }); };
    const response = await post(base, "/api/auth/login");
    assert.equal(response.status, status);
    assertHeaders(response);
    assert.deepEqual(await response.json(), { error: publicCode });
    if (status === 429) assert.equal(response.headers.get("retry-after"), "18");
  }
  service.session = async () => { throw new Error("private SQL connection details"); };
  const response = await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "authentication_unavailable" });
});

test("admin page is protected, public login preserves the approved brand, assets are explicitly mapped", async (t) => {
  const { base } = await fixture(t);
  const unauthorized = await fetch(`${base}/admin`, { redirect: "manual" });
  assert.equal(unauthorized.status, 303);
  assert.equal(unauthorized.headers.get("location"), "/admin/login");
  for (const [path, headers] of [["/admin/login", {}], ["/admin", { Cookie: cookie }]]) {
    const response = await fetch(`${base}${path}`, { headers });
    assert.equal(response.status, 200);
    assertHeaders(response);
    const html = await response.text();
    assert.match(html, /<span class="brand-name">Jessie<\/span>/);
    assert.match(html, /src="\/brand\/icon-128.png"/);
    assert.match(html, /autocomplete="current-password"/);
    assert.match(html, /autocomplete="one-time-code"/);
    assert.doesNotMatch(html, /<script[^>]*>(?!<\/script>)\s*\S|localStorage|data:image/);
  }
  const css = await fetch(`${base}/admin-login.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
  for (const color of ["#100d12", "#1b161e", "#71354f", "#d8b999", "#f5eef2"]) assert.ok((await (await fetch(`${base}/admin-login.css`)).text()).includes(color));
  const script = await fetch(`${base}/admin-login.js`);
  assert.equal(script.status, 200);
  const source = await script.text();
  assert.doesNotMatch(source, /localStorage|sessionStorage|innerHTML/);
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /textContent/);
  for (const path of ["/server/auth/http.mjs", "/admin-login.html", "/admin/other", "/api/auth/unknown"]) {
    const unknown = await fetch(`${base}${path}`);
    assert.equal(unknown.status, 404);
    assert.equal(await unknown.text(), "fallback");
  }
});

test("only the exact login slash alias redirects locally without reading or changing a session", async (t) => {
  const { base, calls } = await fixture(t);
  for (const query of ["", "?continue=%2Fadmin%2Fbackups", "?continue=https%3A%2F%2Fattacker.example%2Fx&continue=%2F%2Fattacker.example"]) {
    for (const method of ["GET", "HEAD"]) for (const value of [undefined, cookie, "__Host-jessie_session=invalid", `__Host-jessie_session=${Buffer.alloc(32, 99).toString("base64url")}`]) {
      const response = await fetch(`${base}/admin/login/${query}`, { method, redirect: "manual", headers: value ? { Cookie: value } : {} });
      assert.equal(response.status, 308);
      assertHeaders(response);
      const location = response.headers.get("location");
      assert.equal(location, `/admin/login${query}`);
      assert.equal(new URL(location, origin).origin, origin);
      assert.equal(new URL(location, origin).pathname, "/admin/login");
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(await response.text(), "");
    }
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await fetch(`${base}/admin/login/?continue=%2Fadmin%2Fbackups`, {
      method, redirect: "manual", headers: { Cookie: cookie, Origin: "https://attacker.example", "Content-Type": "text/plain" }, body: "not-json",
    });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("set-cookie"), null);
    assertHeaders(response);
    assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  }
  for (const path of ["/api/auth/login/", "/admin/login//"]) for (const method of ["GET", "HEAD", "POST"]) {
    const response = await fetch(`${base}${path}`, { method, redirect: "manual", headers: { Cookie: cookie } });
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(await response.text(), method === "HEAD" ? "" : "fallback");
  }
  assert.deepEqual(calls, [], "canonicalization must neither read nor mutate authentication state");
});

test("auth routes enforce methods and HEAD never contains a page or JSON body", async (t) => {
  const { base, calls } = await fixture(t);
  for (const [path, method, allow] of [["/api/auth/login", "GET", "POST"], ["/api/auth/session", "POST", "GET"], ["/api/auth/logout", "GET", "POST"], ["/admin/login", "OPTIONS", "GET, HEAD"], ["/admin-login.js", "POST", "GET, HEAD"]]) {
    const response = await fetch(`${base}${path}`, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), allow);
    assertHeaders(response);
  }
  assert.equal(calls.length, 0);
  for (const path of ["/admin/login", "/admin-login.js", "/admin-login.css", "/api/auth/login", "/api/auth/session"]) {
    const response = await fetch(`${base}${path}`, { method: "HEAD" });
    assert.equal(await response.text(), "");
  }
});

test("bad service session output fails closed instead of setting a malformed cookie", async (t) => {
  const { base, service } = await fixture(t);
  service.login = async () => ({ token: "not-canonical", csrf, user, expiresAt: Date.now() + 60000 });
  const response = await post(base, "/api/auth/login");
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(await response.json(), { error: "authentication_unavailable" });
});

test("administrator session reads return renewed server expiry without changing cookies", async (t) => {
  const { base, session } = await fixture(t);
  session.expiresAt = Date.now() + 180 * 86400000;
  const response = await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(Object.keys(await response.json()).sort(), ["csrf", "expiresAt", "user"]);
});

test("device routes require authentication, exact origin, an empty JSON body and the current CSRF proof", async (t) => {
  const devices = [{ id: user.id, createdAt: 1800000000000, lastSeenAt: 1800000000000, current: true }];
  const { base, calls } = await fixture(t, {
    async devices(raw, page) { calls.push(["devices", raw, page]); return { devices, nextCursor: null, hasMore: false }; },
    async revokeDevice(raw, id) { calls.push(["revokeDevice", raw, id]); return { status: "device_revoked", current: id === user.id }; },
  });
  assert.equal((await fetch(`${base}/api/auth/devices`)).status, 401);
  const list = await fetch(`${base}/api/auth/devices`, { headers: { Cookie: cookie } });
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), { devices, nextCursor: null, hasMore: false });
  for (const query of ["?cursor=a&cursor=b", "?secret=value"]) {
    assert.equal((await fetch(`${base}/api/auth/devices${query}`, { headers: { Cookie: cookie } })).status, 400);
  }
  const path = `/api/auth/devices/${user.id}/revoke`;
  for (const headers of [mutationHeaders({ Cookie: cookie }), mutationHeaders({ Cookie: cookie, "X-CSRF-Token": csrf, Origin: "https://foreign.example" })]) {
    assert.equal((await post(base, path, {}, headers)).status, 403);
  }
  assert.equal(calls.some(([name]) => name === "revokeDevice"), false);
  assert.equal((await post(base, path, { user: user.id }, mutationHeaders({ Cookie: cookie, "X-CSRF-Token": csrf }))).status, 400);
  const removed = await post(base, path, {}, mutationHeaders({ Cookie: cookie, "X-CSRF-Token": csrf }));
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { status: "device_revoked", current: true });
  assert.equal(removed.headers.get("set-cookie"), null);
  assert.deepEqual(calls.find(([name]) => name === "revokeDevice"), ["revokeDevice", token, user.id]);
  assert.equal((await fetch(`${base}${path}`, { headers: { Cookie: cookie } })).status, 405);
});
