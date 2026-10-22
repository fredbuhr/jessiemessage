import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { createAccessHandler } from "../server/access/http.mjs";
import { AUTH_HEADERS } from "../server/auth/http.mjs";
import { encodeAccessCursor } from "../server/access/pagination.mjs";

const origin = "https://jessiemessage.example";
const adminToken = Buffer.alloc(32, 1).toString("base64url");
const clientToken = Buffer.alloc(32, 2).toString("base64url");
const invitationToken = Buffer.alloc(32, 3).toString("base64url");
const csrf = Buffer.alloc(32, 4).toString("base64url");
const adminId = "1234567890abcdef1234567890abcdef";
const clientId = "abcdefabcdefabcdefabcdefabcdefab";
const invitationId = "00112233445566778899aabbccddeeff";
const createdAt = Date.parse("2026-10-14T12:00:00Z");
const adminCookie = `__Host-jessie_session=${adminToken}`;
const clientCookie = `__Host-jessie_client=${clientToken}`;
const credentials = { email: "client@example.invalid", password: "un mot de passe assez long" };
const registration = { ...credentials, pseudonym: "Client", invitationToken, ageDeclared: true };
const invitation = () => ({ id: invitationId, createdAt, expiresAt: Date.now() + 3600000, accessDays: 30, state: "pending", consumedById: null });
const client = () => ({ id: clientId, createdAt, pseudonym: "Client", email: credentials.email, status: "pending", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: false, ageAssured: false, approved: false, accessExpiresAt: null });
const page = (kind, rows, nextCursor = null) => ({ [kind]: rows, nextCursor, hasMore: nextCursor !== null });
const adminSession = () => ({ user: { id: adminId, role: "admin", pseudonym: "Jessie" }, csrf, expiresAt: Date.now() + 3600000 });
const clientSession = () => ({ user: { id: clientId, role: "client", pseudonym: "Client" }, token: clientToken, csrf, expiresAt: Date.now() + 3600000, access: { state: "pending", admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: false, ageAssured: false, approved: false, expiresAt: null } });

async function fixture(t, overrides = {}, options = {}) {
  const calls = [];
  const methods = {
    adminSession: (token) => token === adminToken ? adminSession() : null,
    inspectInvitation: () => invitation(),
    createInvitation: () => ({ ...invitation(), url: `${origin}/access#invitation=${invitationToken}` }),
    listInvitations: () => page("invitations", [invitation()]), revokeInvitation: () => true,
    register: () => ({ status: "verification_pending", verificationToken: "must-not-leak" }),
    verifyEmail: () => ({ status: "email_verified", token: "must-not-leak" }),
    resendVerification: () => ({ status: "accepted", accountExists: true }),
    login: () => clientSession(), session: (token) => token === clientToken ? clientSession() : null,
    logout: () => {}, logoutAll: () => {}, listClients: () => page("clients", [client()]), approveClient: () => true, revokeClient: () => true,
    renewClient: (_token, id, body) => ({ id, accessExpiresAt: Math.max(Date.now(), body.expectedExpiresAt) + body.accessDays * 86400000 }),
  };
  const service = {};
  for (const [name, implementation] of Object.entries({ ...methods, ...overrides })) service[name] = async (...args) => { calls.push([name, ...args]); return implementation(...args); };
  const handler = createAccessHandler(service, { origin, ...options });
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

test("client login, cookie renewal and admission renewal use the same injected clock as their services", async t => {
  const now = Date.UTC(2024, 0, 1), expiresAt = now + 3600000, accessExpiresAt = now + 86400000;
  const session = { ...clientSession(), expiresAt };
  const { base, service } = await fixture(t, { login: () => session, session: () => session,
    renewClient: (_token, id) => ({ id, accessExpiresAt }) }, { clock: () => now });
  for (const response of [await post(base, "/api/access/login", credentials),
    await fetch(`${base}/api/access/session`, { headers: { Cookie: clientCookie } })]) {
    assert.equal(response.status, 200); assert.equal((await response.json()).expiresAt, expiresAt);
    assert.match(response.headers.get("set-cookie"), /Max-Age=3600; Secure; HttpOnly; SameSite=Strict/);
  }
  const renewed = await post(base, `/api/admin/clients/${clientId}/renew`, { accessDays: 1, expectedExpiresAt: now }, adminHeaders());
  assert.equal(renewed.status, 200); assert.equal((await renewed.json()).client.accessExpiresAt, accessExpiresAt);
  for (const clock of [null, true, 1, "now"]) assert.throws(() => createAccessHandler(service, { origin, clock }), TypeError);
});

test("invalid injected access clock values cannot produce cookies or approve renewal DTOs", async t => {
  for (const now of [NaN, -1, Infinity, "2024", 253402300800000]) {
    const { base } = await fixture(t, {}, { clock: () => now });
    const login = await post(base, "/api/access/login", credentials);
    assert.equal(login.status, 503); assert.equal(login.headers.get("set-cookie"), null);
    const renewed = await post(base, `/api/admin/clients/${clientId}/renew`, { accessDays: 1, expectedExpiresAt: Date.now() }, adminHeaders());
    assert.equal(renewed.status, 503);
  }
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

test("registration accepts eight-character passwords and rejects seven before account creation", async (t) => {
  const { base, calls } = await fixture(t);
  for (const length of [7, 8, 13, 14, 128]) {
    const password = "x".repeat(length);
    const response = await post(base, "/api/access/register", { ...registration, password });
    assert.equal(response.status, length < 8 ? 400 : 202);
    if (length >= 8) assert.equal(calls.at(-1)[1].password, password);
  }
  assert.equal(calls.length, 4);
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
  assert.equal(clientResponse.headers.get("set-cookie"), null);
  const adminResponse = await fetch(`${base}/api/admin/clients`, { headers: { Cookie: clientCookie } }); assert.equal(adminResponse.status, 401);
  assert.equal(adminResponse.headers.get("set-cookie"), null);
  assert.equal(calls.length, 0);
  const both = await fetch(`${base}/api/access/session`, { headers: { Cookie: `${adminCookie}; ${clientCookie}` } }); assert.equal(both.status, 200);
  assert.deepEqual(calls[0], ["session", clientToken]);
});

test("client sessions reject duplicate or noncanonical cookies without looking up a session", async (t) => {
  const { base, calls } = await fixture(t);
  for (const cookie of ["__Host-jessie_client=", `${clientCookie}; ${clientCookie}`, "__Host-jessie_client=bad", `__Host-jessie_client=${clientToken}=`, `__Host-jessie_client=${"A".repeat(42)}B`, `preference=${"x".repeat(8192)}; ${clientCookie}`]) {
    const response = await fetch(`${base}/api/access/session`, { headers: { Cookie: cookie } }); assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(calls.length, 0);
});

test("unauthenticated client reads without their cookie deny access without changing cookies", async (t) => {
  const { base, calls } = await fixture(t);
  for (const cookie of [undefined, "preference=a", `other_${clientCookie}`, `__Host-jessie_client_extra=${clientToken}`]) {
    const response = await fetch(`${base}/api/access/session`, {
      headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", ...(cookie ? { Cookie: cookie } : {}) } });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(calls.length, 0);
});

test("client reads reject an absent SQL session without changing cookies", async (t) => {
  const { base, calls } = await fixture(t, { session: () => null });
  const response = await fetch(`${base}/api/access/session`, { headers: { Cookie: clientCookie } });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(calls, [["session", clientToken]]);
});

test("client logout without a session rejects without changing cookies", async (t) => {
  const { base, calls } = await fixture(t);
  for (const path of ["logout", "logout-all"]) {
    const response = await post(base, `/api/access/${path}`, {}, headers());
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(calls.length, 0);
});

test("client logout requires CSRF, an empty object and its client session before revocation", async (t) => {
  const { base, calls } = await fixture(t);
  for (const path of ["logout", "logout-all"]) {
    const crossSite = await post(base, `/api/access/${path}`, {}, headers({ Cookie: clientCookie, "X-CSRF-Token": csrf, "Sec-Fetch-Site": "cross-site" })); assert.equal(crossSite.status, 403);
    assert.equal(crossSite.headers.get("set-cookie"), null);
    const missing = await post(base, `/api/access/${path}`, {}, headers({ Cookie: clientCookie })); assert.equal(missing.status, 403);
    const forged = await post(base, `/api/access/${path}`, { role: "admin" }, headers({ Cookie: clientCookie, "X-CSRF-Token": csrf })); assert.equal(forged.status, 400);
    const response = await post(base, `/api/access/${path}`, {}, headers({ Cookie: clientCookie, "X-CSRF-Token": csrf })); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: "signed_out" });
    assert.match(response.headers.get("set-cookie"), /^__Host-jessie_client=;.*Max-Age=0/);
  }
  assert.deepEqual(calls.filter(([name]) => ["logout", "logoutAll"].includes(name)), [["logout", clientToken], ["logoutAll", clientToken]]);
});

test("administration requires a current admin session and CSRF on every mutation", async (t) => {
  const { base, calls } = await fixture(t);
  for (const path of ["/api/admin/invitations", `/api/admin/invitations/${invitationId}/revoke`, `/api/admin/clients/${clientId}/approve`, `/api/admin/clients/${clientId}/revoke`, `/api/admin/clients/${clientId}/renew`]) {
    const anonymous = await post(base, path, {}); assert.equal(anonymous.status, 401);
    const missing = await post(base, path, {}, adminHeaders({ "X-CSRF-Token": "" })); assert.equal(missing.status, 403);
    const crossSite = await post(base, path, {}, adminHeaders({ Origin: "https://attacker.example" })); assert.equal(crossSite.status, 403);
  }
  assert.equal(calls.some(([name]) => ["createInvitation", "revokeInvitation", "approveClient", "revokeClient", "renewClient"].includes(name)), false);
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
    listInvitations: () => ({ ...page("invitations", [{ ...invitation(), token: invitationToken, url: `https://private.example/${invitationToken}` }]), secret: "hidden" }),
    listClients: () => ({ ...page("clients", [{ ...client(), passwordHash: "hidden", seed: "hidden", recovery: "hidden" }]), secret: "hidden" }),
  });
  const invitations = await fetch(`${base}/api/admin/invitations`, { headers: { Cookie: adminCookie } });
  const invitationData = await invitations.json(); assert.equal(invitations.status, 200); assert.equal(JSON.stringify(invitationData).includes(invitationToken), false);
  assert.deepEqual(Object.keys(invitationData.invitations[0]).sort(), ["accessDays", "consumedById", "createdAt", "expiresAt", "id", "state"]);
  assert.deepEqual(Object.keys(invitationData).sort(), ["hasMore", "invitations", "nextCursor"]);
  const clients = await fetch(`${base}/api/admin/clients`, { headers: { Cookie: adminCookie } }); const data = await clients.json(); assert.equal(clients.status, 200); assert.deepEqual(data, page("clients", [client()]));
});

test("admin pagination validates canonical scoped cursors and bounded query options before private work", async (t) => {
  const { base, calls } = await fixture(t);
  for (const kind of ["clients", "invitations"]) {
    const otherKind = kind === "clients" ? "invitations" : "clients";
    const cursor = encodeAccessCursor(kind, { createdAt: "2026-10-14 12:00:00.000001", id: clientId });
    const foreign = encodeAccessCursor(otherKind, { createdAt: "2026-10-14 12:00:00.000001", id: clientId });
    const noncanonical = Buffer.from(`${Buffer.from(cursor, "base64url").toString()} `).toString("base64url");
    for (const query of ["limit=0", "limit=101", "limit=01", "limit=1.0", "limit=1e2", "limit=-1", "limit=", "limit=+1", "limit=1&limit=2", "afterId=bad", "extra=1", "cursor=", "cursor=bad", `cursor=${cursor}&cursor=${cursor}`, `cursor=${foreign}`, `cursor=${cursor}=`, `cursor=${noncanonical}`, `cursor=${"A".repeat(257)}`]) {
      const response = await fetch(`${base}/api/admin/${kind}?${query}`, { headers: { Cookie: adminCookie } });
      assert.equal(response.status, 400, `${kind}?${query}`); assertHeaders(response);
      assert.deepEqual(await response.json(), { error: "invalid_request" });
    }
  }
  for (const path of ["/api/admin/access?extra=1", "/api/access/session?extra=1"]) {
    assert.equal((await fetch(`${base}${path}`, { headers: { Cookie: `${adminCookie}; ${clientCookie}` } })).status, 400);
  }
  assert.deepEqual(calls, []);
});

test("admin pagination forwards defaults and cursor options without imposing ID order on submillisecond ties", async (t) => {
  const firstId = "11111111111111111111111111111111", lastId = "ffffffffffffffffffffffffffffffff";
  const { base, calls, service } = await fixture(t);
  for (const kind of ["clients", "invitations"]) {
    const method = kind === "clients" ? "listClients" : "listInvitations", make = kind === "clients" ? client : invitation;
    let response = await fetch(`${base}/api/admin/${kind}`, { headers: { Cookie: adminCookie } });
    assert.equal(response.status, 200); assertHeaders(response);
    assert.deepEqual(calls.at(-1), [method, adminToken, { cursor: null, limit: 50 }]);
    const nextCursor = encodeAccessCursor(kind, { createdAt: "2026-10-14 12:00:00.000001", id: lastId });
    const rows = [{ ...make(), id: firstId }, { ...make(), id: lastId }];
    service[method] = async () => page(kind, rows, nextCursor);
    response = await fetch(`${base}/api/admin/${kind}?limit=2`, { headers: { Cookie: adminCookie } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), page(kind, rows, nextCursor));
    service[method] = async (...args) => { calls.push([method, ...args]); return page(kind, []); };
    response = await fetch(`${base}/api/admin/${kind}?cursor=${nextCursor}&limit=100`, { headers: { Cookie: adminCookie } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), page(kind, []));
    assert.deepEqual(calls.at(-1), [method, adminToken, { cursor: nextCursor, limit: 100 }]);
  }
});

test("forged access pages fail closed for bounds, duplicate IDs, dates and cursor coherence", async (t) => {
  const { base, service } = await fixture(t);
  for (const kind of ["clients", "invitations"]) {
    const method = kind === "clients" ? "listClients" : "listInvitations", make = kind === "clients" ? client : invitation;
    const row = make(), row2 = { ...make(), id: "ffffffffffffffffffffffffffffffff" };
    const goodCursor = encodeAccessCursor(kind, { createdAt: "2026-10-14 12:00:00.000001", id: row.id });
    const badDate = encodeAccessCursor(kind, { createdAt: "2026-10-14 12:00:00.001001", id: row2.id });
    const badId = encodeAccessCursor(kind, { createdAt: "2026-10-14 12:00:00.000001", id: row2.id });
    const foreign = encodeAccessCursor(kind === "clients" ? "invitations" : "clients", { createdAt: "2026-10-14 12:00:00.000001", id: row.id });
    const cases = [null, [row], {}, { [kind]: [row] }, page(kind, [{ ...row, createdAt: "2026-10-14T12:00:00Z" }]),
      page(kind, [{ ...row, createdAt: NaN }]), page(kind, [{ ...row, createdAt: -1 }]), page(kind, [{ ...row, createdAt: 253402300800000 }]),
      page(kind, [row, row]), page(kind, [row, { ...row, id: row.id.toUpperCase() }]), page(kind, [row, { ...row2, createdAt: row.createdAt + 1 }]),
      { ...page(kind, [row]), hasMore: "true" }, { ...page(kind, [row]), hasMore: true },
      { ...page(kind, [row], goodCursor), hasMore: false }, page(kind, [], goodCursor),
      page(kind, [row], goodCursor), page(kind, [row, row2], badDate), page(kind, [row, row2], goodCursor),
      page(kind, [row, row2], foreign), page(kind, [row, row2], `${badId}=`)];
    for (const value of cases) {
      service[method] = async () => value;
      const response = await fetch(`${base}/api/admin/${kind}?limit=2`, { headers: { Cookie: adminCookie } });
      assert.equal(response.status, 503, `${kind}: ${JSON.stringify(value)}`); assertHeaders(response);
      assert.deepEqual(await response.json(), { error: "authentication_unavailable" });
    }
    service[method] = async () => page(kind, [row, row2]);
    assert.equal((await fetch(`${base}/api/admin/${kind}?limit=1`, { headers: { Cookie: adminCookie } })).status, 503);
  }
});

test("admin pages enforce the incoming cursor boundary while allowing genuine submillisecond progress", async (t) => {
  const { base, service } = await fixture(t);
  for (const kind of ["clients", "invitations"]) {
    const method = kind === "clients" ? "listClients" : "listInvitations", make = kind === "clients" ? client : invitation;
    const incomingId = "22222222222222222222222222222222", rowId = "ffffffffffffffffffffffffffffffff";
    const incoming = encodeAccessCursor(kind, { createdAt: "2026-10-14 12:00:00.000900", id: incomingId });
    const row = { ...make(), id: rowId };
    const sameTimeHigherId = encodeAccessCursor(kind, { createdAt: "2026-10-14 12:00:00.000900", id: rowId });
    const laterMicrosecond = encodeAccessCursor(kind, { createdAt: "2026-10-14 12:00:00.000901", id: rowId });
    const cases = [page(kind, [{ ...row, createdAt: createdAt + 1 }]), page(kind, [{ ...row, id: incomingId }]),
      page(kind, [row], sameTimeHigherId), page(kind, [row], laterMicrosecond), page(kind, [{ ...row, id: incomingId }], incoming)];
    for (const value of cases) {
      service[method] = async () => value;
      const response = await fetch(`${base}/api/admin/${kind}?cursor=${incoming}&limit=1`, { headers: { Cookie: adminCookie } });
      assert.equal(response.status, 503, `${kind}: ${JSON.stringify(value)}`); assertHeaders(response);
      assert.deepEqual(await response.json(), { error: "authentication_unavailable" });
    }
    const progressed = encodeAccessCursor(kind, { createdAt: "2026-10-14 12:00:00.000899", id: rowId });
    service[method] = async () => page(kind, [row], progressed);
    const response = await fetch(`${base}/api/admin/${kind}?cursor=${incoming}&limit=1`, { headers: { Cookie: adminCookie } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), page(kind, [row], progressed));
  }
});

test("client renewal forwards a bounded duration and expected deadline, and strips service internals", async (t) => {
  const expectedExpiresAt = Date.now() + 86400000, accessExpiresAt = expectedExpiresAt + 30 * 86400000;
  const { base, calls } = await fixture(t, { renewClient: () => ({ id: clientId, accessExpiresAt, email: credentials.email, ageAssured: true, token: invitationToken }) });
  const body = { accessDays: 30, expectedExpiresAt };
  const response = await post(base, `/api/admin/clients/${clientId.toUpperCase()}/renew`, body, adminHeaders());
  assert.equal(response.status, 200); assertHeaders(response);
  assert.deepEqual(await response.json(), { status: "renewed", client: { id: clientId, accessExpiresAt } });
  assert.deepEqual(calls, [["adminSession", adminToken], ["renewClient", adminToken, clientId, body]]);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("client renewal rejects missing deadlines, unlimited duration and forged approval fields", async (t) => {
  const { base, calls } = await fixture(t);
  const valid = { accessDays: 1, expectedExpiresAt: Date.now() };
  for (const body of [{}, { accessDays: 30 }, { expectedExpiresAt: 1 }, { ...valid, accessDays: null }, { ...valid, accessDays: 0 },
    { ...valid, accessDays: 3651 }, { ...valid, accessDays: 1.5 }, { ...valid, accessDays: "30" },
    { ...valid, expectedExpiresAt: null }, { ...valid, expectedExpiresAt: "1" }, { ...valid, expectedExpiresAt: -1 },
    { ...valid, expectedExpiresAt: 1.5 }, { ...valid, expectedExpiresAt: 253402300800000 },
    { ...valid, ageAssured: true }, { ...valid, approved: true }, { ...valid, status: "active" }, { ...valid, id: clientId }, [], "null", ""]) {
    const response = await post(base, `/api/admin/clients/${clientId}/renew`, body, adminHeaders());
    assert.equal(response.status, 400, JSON.stringify(body)); assertHeaders(response);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.equal(calls.some(([name]) => name === "renewClient"), false);
});

test("renewal preserves admin origin, JSON and CSRF gates and does not accept client authentication", async (t) => {
  const { base, calls, service } = await fixture(t);
  const body = { accessDays: 1, expectedExpiresAt: Date.now() };
  for (const [values, status] of [[headers(), 401], [headers({ Cookie: clientCookie, "X-CSRF-Token": csrf }), 401],
    [adminHeaders({ Origin: "https://attacker.example" }), 403], [adminHeaders({ "Sec-Fetch-Site": "cross-site" }), 403],
    [adminHeaders({ "X-CSRF-Token": "" }), 403], [adminHeaders({ "Content-Type": "text/plain" }), 415]]) {
    const response = await post(base, `/api/admin/clients/${clientId}/renew`, body, values);
    assert.equal(response.status, status); assertHeaders(response);
  }
  service.adminSession = async () => null;
  assert.equal((await post(base, `/api/admin/clients/${clientId}/renew`, body, adminHeaders())).status, 401);
  assert.equal(calls.some(([name]) => name === "renewClient"), false);
});

test("renewal exposes only neutral conflict, prerequisite, input and missing results", async (t) => {
  const { base, service } = await fixture(t);
  const body = { accessDays: 1, expectedExpiresAt: Date.now() };
  for (const [code, status, publicCode] of [["ACCESS_CONFLICT", 409, "access_changed"], ["ACCESS_PREREQUISITES", 409, "verification_required"],
    ["ACCESS_INPUT", 400, "invalid_request"], ["ACCESS_FORBIDDEN", 403, "request_rejected"], ["AUTH_INVALID", 401, "invalid_credentials"],
    ["AUTH_RATE_LIMIT", 429, "try_again_later"], ["SQL_FAILURE", 503, "authentication_unavailable"]]) {
    service.renewClient = async () => { throw Object.assign(new Error("private status, email, SQL and credentials"), { code, retryAfter: 12.2 }); };
    const response = await post(base, `/api/admin/clients/${clientId}/renew`, body, adminHeaders());
    assert.equal(response.status, status); assertHeaders(response); assert.deepEqual(await response.json(), { error: publicCode });
    if (status === 429) assert.equal(response.headers.get("retry-after"), "13");
  }
  service.renewClient = async () => null;
  const response = await post(base, `/api/admin/clients/${clientId}/renew`, body, adminHeaders());
  assert.equal(response.status, 404); assert.deepEqual(await response.json(), { error: "not_found" });
});

test("renewal does not report success for a forged target, nonfuture or shortened deadline", async (t) => {
  const { base, service } = await fixture(t);
  const expectedExpiresAt = Date.now() + 86400000, body = { accessDays: 1, expectedExpiresAt };
  const valid = { id: clientId, accessExpiresAt: expectedExpiresAt + 86400000 };
  for (const value of [false, undefined, {}, { ...valid, id: invitationId }, { ...valid, accessExpiresAt: null },
    { ...valid, accessExpiresAt: new Date(valid.accessExpiresAt).toISOString() }, { ...valid, accessExpiresAt: Infinity },
    { ...valid, accessExpiresAt: expectedExpiresAt }, { ...valid, accessExpiresAt: Date.now() - 1 },
    { ...valid, accessExpiresAt: valid.accessExpiresAt + 0.5 }, { ...valid, accessExpiresAt: 253402300800000 }]) {
    service.renewClient = async () => value;
    const response = await post(base, `/api/admin/clients/${clientId}/renew`, body, adminHeaders());
    assert.equal(response.status, 503); assertHeaders(response); assert.deepEqual(await response.json(), { error: "authentication_unavailable" });
  }
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
  assert.deepEqual(await response.json(), { capabilities: { emailDelivery: "configured", admissionPolicy: "manual_invitation", ageAssurance: "not_integrated" } });
});

test("admin action paths use exact action names and do not reinterpret mixed-case approval as revocation", async (t) => {
  const { base, calls } = await fixture(t);
  for (const path of [`/api/admin/clients/${clientId}/APPROVE`, `/api/admin/CLIENTS/${clientId}/approve`, `/api/admin/invitations/${invitationId}/approve`, `/api/admin/invitations/${invitationId}/renew`]) {
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
  assert.match(script, /history\.replaceState\(null, "", notificationReference \?/);
  assert.match(script, /JessieNotificationLink\?\.read\(\)/);
  assert.match(script, /credentials: "same-origin"/); assert.match(script, /textContent/); assert.match(script, /ticket !== generation/);
  for (const path of ["/access.html", "/server/access/http.mjs", "/api/access/unknown", "/api/admin/clients/bad/approve"]) assert.equal((await fetch(`${base}${path}`)).status, 404);
});

test("access routes enforce methods and HEAD never includes JSON or file contents", async (t) => {
  const { base, calls } = await fixture(t);
  for (const [path, method, allow] of [["/api/access/login", "GET", "POST"], ["/api/access/session", "POST", "GET"], ["/api/admin/clients", "POST", "GET"], [`/api/admin/clients/${clientId}/renew`, "GET", "POST"], ["/access", "OPTIONS", "GET, HEAD"], ["/access.js", "POST", "GET, HEAD"]]) {
    const response = await fetch(`${base}${path}`, { method }); assert.equal(response.status, 405); assert.equal(response.headers.get("allow"), allow); assertHeaders(response);
  }
  assert.equal(calls.length, 0);
  for (const path of ["/access", "/access.js", "/access.css", "/api/access/login", "/api/access/session"]) assert.equal(await (await fetch(`${base}${path}`, { method: "HEAD" })).text(), "");
});
