import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { createEntryHandler } from "../server/entry/http.mjs";

const NOW = Date.parse("2026-10-15T15:00:00.000Z");
const token = (value) => Buffer.alloc(32, value).toString("base64url");
const CLIENT_TOKEN = token(1), ADMIN_TOKEN = token(2), CSRF = token(3);
const cookies = (client = CLIENT_TOKEN, admin = ADMIN_TOKEN) => [client ? `__Host-jessie_client=${client}` : "", admin ? `__Host-jessie_session=${admin}` : ""].filter(Boolean).join("; ");
const client = (state = "active") => ({ user: { id: "1".repeat(32), role: "client", pseudonym: "Private client", email: "secret-client@example.invalid" },
  csrf: CSRF, expiresAt: NOW + 60000,
  access: { state, admissionPolicy: "manual_invitation", invitationConsumed: true, emailVerified: true, ageAssured: false, approved: state !== "pending", expiresAt: state === "expired" ? NOW - 1 : NOW + 30000 },
  token: "private-token", passwordHash: "secret-password" });
const administrator = () => ({ user: { id: "2".repeat(32), role: "admin", pseudonym: "Private administrator", email: "secret-admin@example.invalid" },
  csrf: CSRF, expiresAt: NOW + 60000, token: "private-admin-token", mfa: "secret-factor" });
const neutral = { status: "unavailable", client: null, administrator: null };
const pause = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function waitFor(condition) { const until = Date.now() + 2000; while (!condition()) { assert.ok(Date.now() < until, "request reached the expected lookup boundary"); await sleep(1); } }
async function listen(t, options = {}) {
  const handler = createEntryHandler({ clock: () => NOW, ...options });
  const server = createServer(async (request, response) => {
    if (!await handler(request, response)) { response.writeHead(404, { "Cache-Control": "no-store" }); response.end("Not found"); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
function privateHeaders(response) {
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff"); assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("set-cookie"), null);
}

test("entry configuration accepts only explicit callback services, a boolean chat flag and a callable clock", () => {
  assert.equal(typeof createEntryHandler(), "function");
  for (const changes of [{ clientSession: true }, { clientSession: {} }, { adminSession: "enabled" }, { chatEnabled: "true" }, { chatEnabled: null }, { clock: null }]) {
    assert.throws(() => createEntryHandler(changes), (error) => error instanceof TypeError && !error.message.includes(Object.values(changes)[0]));
  }
});

test("disabled features return a neutral available HTTP response without inspecting or querying supplied cookies", async (t) => {
  const base = await listen(t);
  const response = await fetch(`${base}/api/entry`, { headers: { Cookie: cookies() } });
  assert.equal(response.status, 200); privateHeaders(response); assert.deepEqual(await response.json(), neutral);
});

test("anonymous entry offers only the client destination and never advertises administration or queries session SQL", async (t) => {
  let calls = 0;
  const lookup = () => { calls += 1; throw new Error("must not query private SQL"); };
  for (const enabled of ["client", "admin", "both"]) {
    const base = await listen(t, { clientSession: enabled === "admin" ? null : lookup, adminSession: enabled === "client" ? null : lookup });
    const response = await fetch(`${base}/api/entry`); assert.equal(response.status, 200); privateHeaders(response);
    assert.deepEqual(await response.json(), { status: enabled === "admin" ? "unavailable" : "available", client: enabled === "admin" ? null : { state: "signed_out", href: "/access" },
      administrator: null });
  }
  assert.equal(calls, 0);
});

test("current client states navigate only to their fixed allowed destination while retaining limited access", async (t) => {
  for (const state of ["pending", "active", "expired"]) for (const chatEnabled of [false, true]) {
    const calls = [];
    const base = await listen(t, { clientSession: async (value) => { calls.push(value); return client(state); }, chatEnabled });
    const response = await fetch(`${base}/api/entry`, { headers: { Cookie: cookies(CLIENT_TOKEN, null) } });
    assert.equal(response.status, 200); privateHeaders(response);
    assert.deepEqual(await response.json(), { status: "available", client: { state, href: state === "active" && chatEnabled ? "/messages" : "/access" }, administrator: null });
    assert.deepEqual(calls, [CLIENT_TOKEN]);
  }
});

test("current administrator destinations honor only the server chat flag", async (t) => {
  for (const chatEnabled of [false, true]) {
    const base = await listen(t, { adminSession: async () => administrator(), chatEnabled });
    const response = await fetch(`${base}/api/entry`, { headers: { Cookie: cookies(null) } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "available", client: null, administrator: { state: "connected", href: chatEnabled ? "/admin/messages" : "/admin" } });
  }
});

test("two valid role cookies remain two explicit choices without identity, CSRF, dates or cookie mutation", async (t) => {
  const calls = [];
  const base = await listen(t, { clientSession: async (value) => { calls.push(["client", value]); return client(); },
    adminSession: async (value) => { calls.push(["admin", value]); return administrator(); }, chatEnabled: true });
  const response = await fetch(`${base}/api/entry`, { headers: { Cookie: cookies(), "X-Forwarded-User": "secret-admin@example.invalid" } });
  const result = await response.json(); assert.equal(response.status, 200); privateHeaders(response);
  assert.deepEqual(result, { status: "available", client: { state: "active", href: "/messages" }, administrator: { state: "connected", href: "/admin/messages" } });
  assert.deepEqual(calls, [["client", CLIENT_TOKEN], ["admin", ADMIN_TOKEN]]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private|secret|example\.invalid|csrf|expiresAt|password|user|pseudonym|token|"id"/i);
  for (const value of [CLIENT_TOKEN, ADMIN_TOKEN, CSRF, "1".repeat(32), "2".repeat(32), String(NOW)]) assert.equal(serialized.includes(value), false);
});

test("null session proof means signed out, without clearing either role cookie", async (t) => {
  const base = await listen(t, { clientSession: async () => null, adminSession: async () => null });
  const response = await fetch(`${base}/api/entry`, { headers: { Cookie: cookies() } });
  assert.equal(response.status, 200); privateHeaders(response);
  assert.deepEqual(await response.json(), { status: "available", client: { state: "signed_out", href: "/access" }, administrator: null });
});

test("missing, duplicate, noncanonical and oversized role cookies never invoke a session service", async (t) => {
  let calls = 0; const lookup = async () => { calls += 1; return client(); };
  const base = await listen(t, { clientSession: lookup, adminSession: lookup });
  for (const Cookie of ["unrelated=private", `__Host-jessie_client=${CLIENT_TOKEN}; __Host-jessie_client=${CLIENT_TOKEN}`,
    `__Host-jessie_session=${ADMIN_TOKEN}; __Host-jessie_session=${ADMIN_TOKEN}`, "__Host-jessie_client=bad", `__Host-jessie_client=${"B".repeat(43)}`,
    `__Host-jessie_session=${ADMIN_TOKEN}=`, `private=${"x".repeat(8200)}; ${cookies()}`]) {
    const response = await fetch(`${base}/api/entry`, { headers: { Cookie } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: "available", client: { state: "signed_out", href: "/access" }, administrator: null });
  }
  assert.equal(calls, 0);
});

test("entry rejects every query and non-GET method before reading a cookie or allocating SQL", async (t) => {
  let calls = 0; const lookup = async () => { calls += 1; return client(); };
  const base = await listen(t, { clientSession: lookup, adminSession: lookup });
  for (const query of ["?next=https://private.example/", "?next=/messages&next=/admin", "?token=secret", "?role=admin", "?"]) {
    const response = await fetch(`${base}/api/entry${query}`, { headers: { Cookie: cookies() } });
    assert.equal(response.status, 400); privateHeaders(response); assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  for (const method of ["HEAD", "POST", "PUT", "DELETE", "OPTIONS"]) {
    const response = await fetch(`${base}/api/entry`, { method, headers: { Cookie: cookies() }, ...(method === "POST" ? { body: "private secret body" } : {}) });
    assert.equal(response.status, 405); privateHeaders(response); assert.equal(response.headers.get("allow"), "GET");
    if (method === "HEAD") assert.equal(await response.text(), ""); else assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  }
  assert.equal(calls, 0);
});

test("unrelated paths and route aliases fall through without any session work", async (t) => {
  let calls = 0;
  const base = await listen(t, { clientSession: async () => { calls += 1; return client(); } });
  for (const path of ["/app", "/api/entry/", "/api/ENTRY", "/api/access/session", "/api/entry.js"]) {
    const response = await fetch(`${base}${path}`, { headers: { Cookie: cookies() } }); assert.equal(response.status, 404); await response.text();
  }
  assert.equal(calls, 0);
  const handler = createEntryHandler();
  assert.equal(await handler({ url: "http://[", method: "GET" }, { writeHead() { throw new Error("must fall through"); } }), false);
});

test("service exceptions and malformed role DTOs return neutral 503 without anonymous or opposite-role fallback", async (t) => {
  for (const role of ["client", "admin"]) {
    for (const mutation of ["undefined", "false", "role", "id", "csrf", "pseudonym", "fractional-date", "date-string", "infinity", "max-date", "zero-date", "throw"]) {
      const value = role === "client" ? client() : administrator(); let result = value;
      if (mutation === "undefined") result = undefined;
      if (mutation === "false") result = false;
      if (mutation === "role") value.user.role = role === "client" ? "admin" : "client";
      if (mutation === "id") value.user.id = "private-client-id";
      if (mutation === "csrf") value.csrf = "B".repeat(43);
      if (mutation === "pseudonym") value.user.pseudonym = "\ud800";
      if (mutation === "fractional-date") value.expiresAt = NOW + 0.5;
      if (mutation === "date-string") value.expiresAt = String(NOW + 60000);
      if (mutation === "infinity") value.expiresAt = Infinity;
      if (mutation === "max-date") value.expiresAt = 253402300800000;
      if (mutation === "zero-date") value.expiresAt = 0;
      const lookup = async () => { if (mutation === "throw") throw new Error("secret SQL password and client@example.invalid"); return result; };
      const base = await listen(t, { clientSession: role === "client" ? lookup : async () => client(), adminSession: role === "admin" ? lookup : async () => administrator() });
      const response = await fetch(`${base}/api/entry`, { headers: { Cookie: cookies() } });
      assert.equal(response.status, 503, `${role}:${mutation}`); privateHeaders(response); assert.equal(response.headers.get("retry-after"), "5");
      assert.deepEqual(await response.json(), neutral);
    }
  }
});

test("active client gates and access expiry metadata are validated before allowing messages", async (t) => {
  for (const mutation of ["emailVerified", "invitationConsumed", "admissionPolicy", "approved", "fraction", "string", "infinity", "negative", "expired-null"]) {
    const value = client();
    if (["emailVerified", "invitationConsumed", "approved"].includes(mutation)) value.access[mutation] = false;
    if (mutation === "admissionPolicy") value.access.admissionPolicy = "external_verified";
    if (mutation === "fraction") value.access.expiresAt = NOW + 0.5;
    if (mutation === "string") value.access.expiresAt = new Date(NOW + 30000).toISOString();
    if (mutation === "infinity") value.access.expiresAt = Infinity;
    if (mutation === "negative") value.access.expiresAt = -1;
    if (mutation === "expired-null") { value.access.state = "expired"; value.access.expiresAt = null; }
    const base = await listen(t, { clientSession: async () => value, chatEnabled: true });
    const response = await fetch(`${base}/api/entry`, { headers: { Cookie: cookies(CLIENT_TOKEN, null) } });
    assert.equal(response.status, 503, mutation); assert.deepEqual(await response.json(), neutral);
  }
  const value = client(); value.access.expiresAt = null;
  const base = await listen(t, { clientSession: async () => value, chatEnabled: true });
  const response = await fetch(`${base}/api/entry`, { headers: { Cookie: cookies(CLIENT_TOKEN, null) } });
  assert.equal((await response.json()).client.href, "/messages", "manually approved unlimited access without an age observation remains supported");
});

test("both independent lookups drain after one rejects and no error response abandons the remaining query", async (t) => {
  for (const failing of ["client", "admin"]) {
    const gate = pause(), calls = []; let settled = false;
    const base = await listen(t, { clientSession: async () => { calls.push("client"); if (failing === "client") throw new Error("private SQL client"); return gate.promise; },
      adminSession: async () => { calls.push("admin"); if (failing === "admin") throw new Error("private SQL admin"); return gate.promise; } });
    const pending = fetch(`${base}/api/entry`, { headers: { Cookie: cookies() } }).then((response) => { settled = true; return response; });
    await waitFor(() => calls.length === 2); await sleep(5); assert.equal(settled, false);
    gate.resolve(failing === "client" ? administrator() : client());
    const response = await pending; assert.equal(response.status, 503); assert.deepEqual(await response.json(), neutral);
  }
});

test("session and access expiry use the clock after both awaited lookups, including exact expiry boundaries", async (t) => {
  for (const boundary of ["access", "session"]) {
    const gate = pause(); let now = NOW, clockCalls = 0, adminStarted = false;
    const base = await listen(t, { clientSession: async () => client(), adminSession: async () => { adminStarted = true; await gate.promise; return administrator(); },
      chatEnabled: true, clock: () => { clockCalls += 1; return now; } });
    const pending = fetch(`${base}/api/entry`, { headers: { Cookie: cookies() } });
    await waitFor(() => adminStarted); assert.equal(clockCalls, 0);
    now = NOW + (boundary === "access" ? 30000 : 60000); gate.resolve();
    const response = await pending; assert.equal(response.status, 200); const result = await response.json();
    assert.deepEqual(result.client, boundary === "access" ? { state: "expired", href: "/access" } : { state: "signed_out", href: "/access" });
    assert.deepEqual(result.administrator, boundary === "access" ? { state: "connected", href: "/admin/messages" } : null);
    assert.equal(clockCalls, 1);
  }
});

test("an invalid or throwing post-wait clock cannot expose a usable role decision", async (t) => {
  for (const value of [NaN, Infinity, -1, 1.5, 253402300800000, "date", null, undefined, "throw"]) {
    const base = await listen(t, { clientSession: async () => client(), clock: () => { if (value === "throw") throw new Error("private clock token"); return value; } });
    const response = await fetch(`${base}/api/entry`, { headers: { Cookie: cookies(CLIENT_TOKEN, null) } });
    assert.equal(response.status, 503); privateHeaders(response); assert.deepEqual(await response.json(), neutral);
  }
});

test("primary transition offers role-specific resume links only while a role is signed out", async t => {
  for (const connected of [false, true]) {
    const base = await listen(t, { deviceTransition: true, chatEnabled: true,
      clientSession: async () => connected ? client() : null, adminSession: async () => connected ? administrator() : null });
    const response = await fetch(`${base}/api/entry`, { headers: { Cookie: cookies() } });
    privateHeaders(response);
    assert.deepEqual(await response.json(), { status: "available",
      client: { state: connected ? "active" : "signed_out", href: connected ? "/messages" : "/connect-device/client" },
      administrator: connected ? { state: "connected", href: "/admin/messages" } : null });
  }
  for (const deviceTransition of ["true", 1, null, {}]) assert.throws(() => createEntryHandler({ deviceTransition }), TypeError);
});
