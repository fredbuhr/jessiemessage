import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { createAccessHandler } from "../server/access/http.mjs";
import { AUTH_HEADERS } from "../server/auth/http.mjs";

const origin = "https://jessiemessage.example";
const adminToken = Buffer.alloc(32, 1).toString("base64url");
const clientToken = Buffer.alloc(32, 2).toString("base64url");
const invitationToken = Buffer.alloc(32, 3).toString("base64url");
const csrf = Buffer.alloc(32, 4).toString("base64url");
const adminId = "1234567890abcdef1234567890abcdef";
const clientId = "abcdefabcdefabcdefabcdefabcdefab";
const invitationId = "00112233445566778899aabbccddeeff";
const adminCookie = `__Host-jessie_session=${adminToken}`;
const clientCookie = `__Host-jessie_client=${clientToken}`;
const credentials = { email: "client@example.invalid", password: "un mot de passe assez long" };
const registration = { ...credentials, pseudonym: "Client", invitationToken, ageDeclared: true };
const invitation = () => ({ id: invitationId, createdAt: Date.now(), expiresAt: Date.now() + 3600000, accessDays: 30, state: "pending", consumedById: null });
const client = () => ({ id: clientId, pseudonym: "Client", email: credentials.email, status: "pending", emailVerified: false, ageAssured: false, approved: false, accessExpiresAt: null });
const adminSession = () => ({ user: { id: adminId, role: "admin", pseudonym: "Jessie" }, csrf, expiresAt: Date.now() + 3600000 });
const clientSession = () => ({ user: { id: clientId, role: "client", pseudonym: "Client" }, token: clientToken, csrf, expiresAt: Date.now() + 3600000, access: { state: "pending", emailVerified: false, ageAssured: false, approved: false, expiresAt: null } });

async function fixture(t, overrides = {}) {
  const calls = [];
  const methods = {
    adminSession: (token) => token === adminToken ? adminSession() : null,
    inspectInvitation: () => invitation(),
    createInvitation: () => ({ ...invitation(), url: `${origin}/access#invitation=${invitationToken}` }),
    listInvitations: () => [invitation()], revokeInvitation: () => true,
    register: () => ({ status: "verification_pending", verificationToken: "must-not-leak" }),
    verifyEmail: () => ({ status: "email_verified", token: "must-not-leak" }),
    resendVerification: () => ({ status: "accepted", accountExists: true }),
    login: () => clientSession(), session: (token) => token === clientToken ? clientSession() : null,
    logout: () => {}, logoutAll: () => {}, listClients: () => [client()], approveClient: () => true, revokeClient: () => true,
  };
  const service = {};
  for (const [name, implementation] of Object.entries({ ...methods, ...overrides })) service[name] = async (...args) => { calls.push([name, ...args]); return implementation(...args); };
  const handler = createAccessHandler(service, { origin });
  const server = createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end("fallback"); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, calls, service };
}
const headers = (extra = {}) => ({ Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1", ...extra });
const adminHeaders = (extra = {}) => headers({ Cookie: adminCookie, "X-CSRF-Token": csrf, ...extra });
function post(base, path, body, values = headers()) { return fetch(`${base}${path}`, { method: "POST", headers: values, body: typeof body === "string" ? body : JSON.stringify(body) }); }
function assertHeaders(response) {
  for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value, name);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}

test("access handler requires exact HTTPS origin and a complete service", () => {
  for (const value of ["http://jessiemessage.example", `${origin}/`, `${origin}/access`, `${origin}?x=1`, "https://user:password@jessiemessage.example"]) assert.throws(() => createAccessHandler({}, { origin: value }));
  assert.throws(() => createAccessHandler({}, { origin }));
});

test("invitation inspection requires a body token and exposes only expiry and access duration", async (t) => {
  const { base, calls } = await fixture(t);
  const response = await post(base, "/api/access/invitation", { token: invitationToken }, headers({ "X-Forwarded-For": "203.0.113.55" }));
  assert.equal(response.status, 200); assertHeaders(response);
  assert.deepEqual(Object.keys(await response.json()).sort(), ["accessDays", "expiresAt"]);
  assert.deepEqual(calls[0], ["inspectInvitation", { token: invitationToken, peerAddress: "127.0.0.1" }]);
  const query = await post(base, `/api/access/invitation?token=${invitationToken}`, {});
  assert.equal(query.status, 400);
  assert.equal(calls.length, 1);
});

test("all pre-auth mutations require same-origin JSON and a custom header before service work", async (t) => {
  const { base, calls } = await fixture(t);
  for (const path of ["invitation", "register", "verify-email", "resend-verification", "login"]) {
    for (const values of [headers({ Origin: "https://attacker.example" }), headers({ Origin: "null" }), headers({ "X-Jessie-Request": "" }), headers({ "Sec-Fetch-Site": "cross-site" })]) {
      const response = await post(base, `/api/access/${path}`, registration, values); assert.equal(response.status, 403); assertHeaders(response);
    }
    const response = await post(base, `/api/access/${path}`, registration, headers({ "Content-Type": "text/plain" })); assert.equal(response.status, 415);
  }
  assert.equal(calls.length, 0);
});

test("registration sends only declaration and credentials, never exposes a verification token", async (t) => {
  const { base, calls } = await fixture(t);
  const response = await post(base, "/api/access/register", registration);
  assert.equal(response.status, 202); assertHeaders(response);
  assert.deepEqual(await response.json(), { status: "verification_pending" });
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(calls[0], ["register", { ...registration, peerAddress: "127.0.0.1" }]);
});

test("registration rejects forged roles, approval, verified majority and an unchecked declaration", async (t) => {
  const { base, calls } = await fixture(t);
  for (const body of [{ ...registration, role: "admin" }, { ...registration, ageAssured: true }, { ...registration, approved: true }, { ...registration, status: "active" }, { ...registration, ageDeclared: false }, { ...registration, ageDeclared: "true" }, { ...registration, password: "short" }, { ...registration, pseudonym: " " }, { ...registration, invitationToken: "bad" }]) {
    const response = await post(base, "/api/access/register", body); assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.equal(calls.length, 0);
});

test("verification and resend responses strip service internals and prevent enumeration", async (t) => {
  const { base, calls } = await fixture(t);
  const verified = await post(base, "/api/access/verify-email", { token: invitationToken });
  assert.equal(verified.status, 200); assert.deepEqual(await verified.json(), { status: "email_verified" });
  const resent = await post(base, "/api/access/resend-verification", credentials);
  assert.equal(resent.status, 202); assert.deepEqual(await resent.json(), { status: "accepted" });
  assert.deepEqual(calls, [["verifyEmail", { token: invitationToken, peerAddress: "127.0.0.1" }], ["resendVerification", { ...credentials, peerAddress: "127.0.0.1" }]]);
  const forged = await post(base, "/api/access/verify-email", { token: invitationToken, userId: clientId }); assert.equal(forged.status, 400);
});

test("client login uses a separate secure cookie and returns a minimal restricted access state", async (t) => {
  const { base, calls } = await fixture(t, { login: () => ({ ...clientSession(), passwordHash: "hidden", email: credentials.email }) });
  const response = await post(base, "/api/access/login", credentials);
  assert.equal(response.status, 200); assertHeaders(response);
  const data = await response.json();
  assert.deepEqual(Object.keys(data).sort(), ["access", "csrf", "expiresAt", "user"]);
  assert.deepEqual(data.access, clientSession().access);
  assert.deepEqual(data.user, clientSession().user);
  assert.match(response.headers.get("set-cookie"), new RegExp(`^__Host-jessie_client=${clientToken}; Path=/; Max-Age=\\d+; Secure; HttpOnly; SameSite=Strict$`));
  assert.equal(JSON.stringify(data).includes(clientToken), false); assert.equal(JSON.stringify(data).includes("hidden"), false);
  assert.deepEqual(calls[0], ["login", { ...credentials, peerAddress: "127.0.0.1" }]);
});

test("admin cookie cannot authenticate a client and client cookie cannot authenticate administration", async (t) => {
  const { base, calls } = await fixture(t);
  const clientResponse = await fetch(`${base}/api/access/session`, { headers: { Cookie: adminCookie } }); assert.equal(clientResponse.status, 401);
  assert.match(clientResponse.headers.get("set-cookie"), /^__Host-jessie_client=;.*Max-Age=0/);
  const adminResponse = await fetch(`${base}/api/admin/clients`, { headers: { Cookie: clientCookie } }); assert.equal(adminResponse.status, 401);
  assert.equal(calls.length, 0);
  const both = await fetch(`${base}/api/access/session`, { headers: { Cookie: `${adminCookie}; ${clientCookie}` } }); assert.equal(both.status, 200);
  assert.deepEqual(calls[0], ["session", clientToken]);
});

test("client sessions reject duplicate or noncanonical cookies without looking up a session", async (t) => {
  const { base, calls } = await fixture(t);
  for (const cookie of [`${clientCookie}; ${clientCookie}`, "__Host-jessie_client=bad", `__Host-jessie_client=${clientToken}=`, `__Host-jessie_client=${"A".repeat(42)}B`]) {
    const response = await fetch(`${base}/api/access/session`, { headers: { Cookie: cookie } }); assert.equal(response.status, 401);
  }
  assert.equal(calls.length, 0);
});

test("client logout requires CSRF, an empty object and its client session before revocation", async (t) => {
  const { base, calls } = await fixture(t);
  for (const path of ["logout", "logout-all"]) {
    const missing = await post(base, `/api/access/${path}`, {}, headers({ Cookie: clientCookie })); assert.equal(missing.status, 403);
    const forged = await post(base, `/api/access/${path}`, { role: "admin" }, headers({ Cookie: clientCookie, "X-CSRF-Token": csrf })); assert.equal(forged.status, 400);
    const response = await post(base, `/api/access/${path}`, {}, headers({ Cookie: clientCookie, "X-CSRF-Token": csrf })); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: "signed_out" });
    assert.match(response.headers.get("set-cookie"), /^__Host-jessie_client=;.*Max-Age=0/);
  }
  assert.deepEqual(calls.filter(([name]) => ["logout", "logoutAll"].includes(name)), [["logout", clientToken], ["logoutAll", clientToken]]);
});

test("administration requires a current admin session and CSRF on every mutation", async (t) => {
  const { base, calls } = await fixture(t);
  for (const path of ["/api/admin/invitations", `/api/admin/invitations/${invitationId}/revoke`, `/api/admin/clients/${clientId}/approve`, `/api/admin/clients/${clientId}/revoke`]) {
    const anonymous = await post(base, path, {}); assert.equal(anonymous.status, 401);
    const missing = await post(base, path, {}, adminHeaders({ "X-CSRF-Token": "" })); assert.equal(missing.status, 403);
    const crossSite = await post(base, path, {}, adminHeaders({ Origin: "https://attacker.example" })); assert.equal(crossSite.status, 403);
  }
  assert.equal(calls.some(([name]) => ["createInvitation", "revokeInvitation", "approveClient", "revokeClient"].includes(name)), false);
});

test("invitation creation bounds validity and access duration, exposes its fragment link once", async (t) => {
  const { base, calls } = await fixture(t);
  for (const body of [{ lifetimeHours: 0, accessDays: 30 }, { lifetimeHours: 721, accessDays: null }, { lifetimeHours: 72, accessDays: 0 }, { lifetimeHours: 72, accessDays: 3651 }, { lifetimeHours: 1.5, accessDays: 30 }, { lifetimeHours: 72, accessDays: null, approved: true }]) {
    assert.equal((await post(base, "/api/admin/invitations", body, adminHeaders())).status, 400);
  }
  const response = await post(base, "/api/admin/invitations", { lifetimeHours: 72, accessDays: null }, adminHeaders());
  assert.equal(response.status, 201);
  const data = await response.json(); assert.deepEqual(Object.keys(data).sort(), ["accessDays", "expiresAt", "id", "url"]);
  assert.equal(data.url, `${origin}/access#invitation=${invitationToken}`);
  assert.deepEqual(calls.filter(([name]) => name === "createInvitation"), [["createInvitation", adminToken, { lifetimeHours: 72, accessDays: null }]]);
});

test("admin lists whitelist fields and never return invitation tokens or credential internals", async (t) => {
  const { base } = await fixture(t, {
    listInvitations: () => [{ ...invitation(), token: invitationToken, url: `https://private.example/${invitationToken}` }],
    listClients: () => [{ ...client(), passwordHash: "hidden", seed: "hidden", recovery: "hidden" }],
  });
  const invitations = await fetch(`${base}/api/admin/invitations`, { headers: { Cookie: adminCookie } });
  const invitationData = await invitations.json(); assert.equal(invitations.status, 200); assert.equal(JSON.stringify(invitationData).includes(invitationToken), false);
  assert.deepEqual(Object.keys(invitationData.invitations[0]).sort(), ["accessDays", "consumedById", "createdAt", "expiresAt", "id", "state"]);
  const clients = await fetch(`${base}/api/admin/clients`, { headers: { Cookie: adminCookie } }); const data = await clients.json(); assert.equal(clients.status, 200); assert.deepEqual(data, { clients: [client()] });
});

test("admin actions pass only target IDs and expose prerequisite failures safely", async (t) => {
  const { base, calls, service } = await fixture(t);
  for (const [path, action, id, status] of [[`/api/admin/invitations/${invitationId}/revoke`, "revokeInvitation", invitationId, "revoked"], [`/api/admin/clients/${clientId}/approve`, "approveClient", clientId, "approved"], [`/api/admin/clients/${clientId}/revoke`, "revokeClient", clientId, "revoked"]]) {
    const response = await post(base, path, {}, adminHeaders()); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status });
    assert.ok(calls.some(([name, token, target]) => name === action && token === adminToken && target === id));
    const forged = await post(base, path, { ageAssured: true }, adminHeaders()); assert.equal(forged.status, 400);
  }
  service.approveClient = async () => { throw Object.assign(new Error("private user state"), { code: "ACCESS_PREREQUISITES" }); };
  const blocked = await post(base, `/api/admin/clients/${clientId}/approve`, {}, adminHeaders()); assert.equal(blocked.status, 409); assert.deepEqual(await blocked.json(), { error: "verification_required" });
  service.revokeClient = async () => false;
  const absent = await post(base, `/api/admin/clients/${clientId}/revoke`, {}, adminHeaders()); assert.equal(absent.status, 404); assert.deepEqual(await absent.json(), { error: "not_found" });
});

test("capabilities report email configuration and pending age assurance", async (t) => {
  const { base } = await fixture(t);
  const response = await fetch(`${base}/api/admin/access`, { headers: { Cookie: adminCookie } }); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { capabilities: { emailDelivery: "configured", ageAssurance: "pending" } });
});

test("admin action paths use exact action names and do not reinterpret mixed-case approval as revocation", async (t) => {
  const { base, calls } = await fixture(t);
  for (const path of [`/api/admin/clients/${clientId}/APPROVE`, `/api/admin/CLIENTS/${clientId}/approve`, `/api/admin/invitations/${invitationId}/approve`]) {
    const response = await post(base, path, {}, adminHeaders());
    assert.equal(response.status, 404);
  }
  assert.equal(calls.length, 0);
});

test("malformed service sessions and unsafe links fail closed before setting cookies or returning links", async (t) => {
  const { base, service } = await fixture(t);
  for (const value of [{ ...clientSession(), user: adminSession().user }, { ...clientSession(), access: { ...clientSession().access, state: "unrestricted" } }, { ...clientSession(), access: { ...clientSession().access, state: "active" } }, { ...clientSession(), token: "bad" }]) {
    service.login = async () => value;
    const response = await post(base, "/api/access/login", credentials); assert.equal(response.status, 503); assert.equal(response.headers.get("set-cookie"), null);
  }
  for (const url of [`${origin}/access?invitation=${invitationToken}`, `https://attacker.example/access#invitation=${invitationToken}`, `${origin}/access#invitation=bad`]) {
    service.createInvitation = async () => ({ ...invitation(), url });
    const response = await post(base, "/api/admin/invitations", { lifetimeHours: 72, accessDays: null }, adminHeaders()); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "authentication_unavailable" });
  }
});

test("account creation and verification do not report success for an invalid service result", async (t) => {
  const { base, service } = await fixture(t);
  for (const [method, path, body] of [["register", "/api/access/register", registration], ["verifyEmail", "/api/access/verify-email", { token: invitationToken }], ["resendVerification", "/api/access/resend-verification", credentials]]) {
    service[method] = async () => false;
    const response = await post(base, path, body);
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "authentication_unavailable" });
  }
});

test("service errors are sanitized and rate-limit retry durations are bounded", async (t) => {
  const { base, service } = await fixture(t);
  for (const [code, status, publicCode] of [["AUTH_INVALID", 401, "invalid_credentials"], ["AUTH_RATE_LIMIT", 429, "try_again_later"], ["AUTH_BUSY", 429, "try_again_later"], ["ACCESS_FORBIDDEN", 403, "request_rejected"], ["ACCESS_REGISTRATION_FAILED", 400, "registration_failed"], ["AUTH_UNAVAILABLE", 503, "authentication_unavailable"], ["SQL_FAILURE", 503, "authentication_unavailable"]]) {
    service.register = async () => { throw Object.assign(new Error("private email password and token"), { code, retryAfter: 17.2 }); };
    const response = await post(base, "/api/access/register", registration); assert.equal(response.status, status); assertHeaders(response); assert.deepEqual(await response.json(), { error: publicCode });
    if (status === 429) assert.equal(response.headers.get("retry-after"), "18");
  }
});

test("access JSON bodies are bounded independently of content-length and invalid UTF-8 is rejected", async (t) => {
  const { base, calls } = await fixture(t);
  for (const body of ["[]", "null", "broken", { ...credentials, role: "admin" }, { ...credentials, password: "x".repeat(129) }]) assert.equal((await post(base, "/api/access/login", body)).status, 400);
  assert.equal((await post(base, "/api/access/login", "x".repeat(4097))).status, 413);
  async function raw(body) {
    return new Promise((resolve, reject) => {
      const req = httpRequest(`${base}/api/access/login`, { method: "POST", headers: headers() }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
      req.on("error", reject); req.write(body.subarray(0, Math.floor(body.length / 2))); req.end(body.subarray(Math.floor(body.length / 2)));
    });
  }
  assert.equal(await raw(Buffer.alloc(4097, 120)), 413);
  assert.equal(await raw(Buffer.concat([Buffer.from('{"email":"'), Buffer.from([0xc3, 0x28]), Buffer.from('","password":"long enough password"}')])), 400);
  assert.equal(calls.length, 0);
});

test("public access page preserves the approved identity and distinguishes declaration from verification", async (t) => {
  const { base } = await fixture(t);
  const page = await fetch(`${base}/access`); assert.equal(page.status, 200); assertHeaders(page);
  const html = await page.text();
  assert.match(html, /<span class="brand-name">Jessie<\/span>/); assert.match(html, /src="\/brand\/icon-128.png"/); assert.match(html, /Cette déclaration ne vérifie pas ta majorité/);
  assert.doesNotMatch(html, /ageAssured|onclick=|data:image/);
  const script = await (await fetch(`${base}/access.js`)).text();
  assert.doesNotMatch(script, /localStorage|sessionStorage|innerHTML/);
  assert.match(script, /history\.replaceState\(null, "", "\/access"\)/);
  assert.match(script, /credentials: "same-origin"/); assert.match(script, /textContent/); assert.match(script, /ticket !== generation/);
  for (const path of ["/access.html", "/server/access/http.mjs", "/api/access/unknown", "/api/admin/clients/bad/approve"]) assert.equal((await fetch(`${base}${path}`)).status, 404);
});

test("access routes enforce methods and HEAD never includes JSON or file contents", async (t) => {
  const { base, calls } = await fixture(t);
  for (const [path, method, allow] of [["/api/access/login", "GET", "POST"], ["/api/access/session", "POST", "GET"], ["/api/admin/clients", "POST", "GET"], ["/access", "OPTIONS", "GET, HEAD"], ["/access.js", "POST", "GET, HEAD"]]) {
    const response = await fetch(`${base}${path}`, { method }); assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), allow); assertHeaders(response);
  }
  assert.equal(calls.length, 0);
  for (const path of ["/access", "/access.js", "/access.css", "/api/access/login", "/api/access/session"]) assert.equal(await (await fetch(`${base}${path}`, { method: "HEAD" })).text(), "");
});
