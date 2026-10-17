import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { createDeviceTransitionHandler } from "../server/transition/http.mjs";
import { AUTH_HEADERS } from "../server/auth/http.mjs";

const primary = "https://jessiemessage.com", legacy = "https://recette.jessiemessage.com", now = Date.UTC(2026, 9, 17);
const csrf = Buffer.alloc(32, 6).toString("base64url"), notification = "f".repeat(32);
const tokens = { admin: Buffer.alloc(32, 1).toString("base64url"), client: Buffer.alloc(32, 2).toString("base64url") };
const cookieName = (role) => role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client";
const actor = (role) => ({ user: { id: (role === "admin" ? "a" : "b").repeat(32), role, pseudonym: "Fictional account" }, csrf, expiresAt: now + 86400000,
  ...(role === "client" ? { access: { state: "active", admissionPolicy: "manual_invitation", emailVerified: true, invitationConsumed: true, ageAssured: false, approved: true, expiresAt: null } } : {}) });
async function fixture(t) {
  const calls = [], sessions = new Map(Object.entries(tokens).map(([role, token]) => [token, actor(role)]));
  const authService = { async session(token) { calls.push(["admin", token]); return sessions.get(token)?.user.role === "admin" ? sessions.get(token) : null; } };
  const accessService = { async session(token) { calls.push(["client", token]); return sessions.get(token)?.user.role === "client" ? sessions.get(token) : null; } };
  const handler = createDeviceTransitionHandler({ authService, accessService, clock: () => now });
  const server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  function request(path, { method = "POST", origin = primary, body, cookie, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const fields = { Host: new URL(origin).host, Origin: origin, "Content-Type": "application/json", "X-Jessie-Request": "1", "Sec-Fetch-Site": "same-origin", ...(cookie ? { Cookie: cookie } : {}), ...headers };
      const wireHeaders = Object.entries(fields).flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).flatMap((entry) => [name, entry]));
      const outgoing = httpRequest({ hostname: "127.0.0.1", port: server.address().port, path, method, headers: wireHeaders }, (response) => {
        const chunks = []; response.on("data", (part) => chunks.push(part)); response.on("error", reject);
        response.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); let json; try { json = JSON.parse(text); } catch {} resolve({ status: response.statusCode, headers: response.headers, text, json }); });
      });
      outgoing.on("error", reject); outgoing.end(body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
    });
  }
  return { request, calls, sessions, authService, accessService };
}
const path = (role, action) => `/api/device-transition/${role}/${action}`;
async function flow(f, role = "admin", reference = notification) {
  const begin = await f.request(path(role, "begin"), { body: { notification: reference } }); assert.equal(begin.status, 200);
  const nonceCookie = begin.headers["set-cookie"][0].split(";", 1)[0];
  const authorize = await f.request(path(role, "authorize"), { origin: legacy, cookie: `${cookieName(role)}=${tokens[role]}`, headers: { "X-CSRF-Token": csrf }, body: { challenge: begin.json.challenge } });
  assert.equal(authorize.status, 200); return { begin, authorize, nonceCookie };
}
test("HTTP bridge never exposes raw session tokens and retains all private security headers", async (t) => {
  const f = await fixture(t);
  for (const role of ["admin", "client"]) {
    const run = await flow(f, role);
    assert.deepEqual(Object.keys(run.begin.json), ["challenge"]); assert.deepEqual(Object.keys(run.authorize.json), ["ticket"]);
    assert.match(run.begin.headers["set-cookie"][0], new RegExp(`^__Host-jessie_transition_${role}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=120; Secure; HttpOnly; SameSite=Strict$`));
    const result = await f.request(path(role, "complete"), { cookie: run.nonceCookie, body: { ticket: run.authorize.json.ticket } });
    assert.equal(result.status, 200); assert.deepEqual(result.json, { destination: `${role === "admin" ? "/admin/messages" : "/messages"}#notification=${notification}`, keptExisting: false });
    assert.match(result.headers["set-cookie"][0], new RegExp(`^${cookieName(role)}=${tokens[role]}; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Strict$`));
    assert.match(result.headers["set-cookie"][1], new RegExp(`^__Host-jessie_transition_${role}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict$`));
    for (const [key, value] of Object.entries(AUTH_HEADERS)) assert.equal(result.headers[key.toLowerCase()], value);
    assert.equal(result.headers["access-control-allow-origin"], undefined);
    for (const response of [run.begin, run.authorize, result]) { assert.equal(response.text.includes(tokens[role]), false); assert.equal(response.text.includes(csrf), false); }
  }
});
test("routes reject wrong Host, duplicate Host, forwarding overrides and cross-host API use before session work", async (t) => {
  const f = await fixture(t), cases = [
    ["begin", primary, { Host: "evil.invalid" }], ["begin", primary, { Host: "evil.invalid", "X-Forwarded-Host": "jessiemessage.com" }],
    ["begin", legacy, {}], ["authorize", primary, {}], ["complete", legacy, {}],
    ["begin", primary, { Host: ["jessiemessage.com", "jessiemessage.com"] }],
  ];
  for (const [action, origin, headers] of cases) assert.equal((await f.request(path("admin", action), { origin, headers, body: { notification: null } })).status, 421);
  assert.equal(f.calls.length, 0);
});
test("normal same-origin mutation rules apply equally to every bridge API", async (t) => {
  const f = await fixture(t);
  for (const headers of [{ Origin: "null" }, { Origin: legacy }, { "X-Jessie-Request": "" }, { "Sec-Fetch-Site": "same-site" }, { "Sec-Fetch-Site": "cross-site" }, { "Content-Type": "text/plain" }, { "Content-Encoding": "gzip" }]) {
    const result = await f.request(path("client", "begin"), { headers, body: { notification: null } });
    assert.ok([403, 415].includes(result.status)); assert.equal(result.headers["set-cookie"], undefined);
  }
  assert.equal(f.calls.length, 0);
});
test("body fields, duplicate wire fields, query strings, streaming size and methods stay closed", async (t) => {
  const f = await fixture(t);
  for (const body of [{}, [], { notification, role: "admin" }, '{"notification":null,"notification":null}', '{"notification":null,"next":"https://evil.invalid"}', 'null', '{"notification":"' + "a".repeat(5000) + '"}']) {
    assert.ok([400, 413].includes((await f.request(path("admin", "begin"), { body })).status));
  }
  assert.equal((await f.request(path("admin", "begin") + "?notification=" + notification, { body: { notification: null } })).status, 400);
  const emptyQuery = await f.request(path("admin", "begin") + "?", { body: { notification: null } });
  assert.equal(emptyQuery.status, 400); assert.equal(emptyQuery.headers["set-cookie"], undefined);
  for (const method of ["GET", "HEAD", "PUT"]) {
    const result = await f.request(path("admin", "begin"), { method }); assert.equal(result.status, 405); assert.equal(result.headers.allow, "POST");
    if (method === "HEAD") assert.equal(result.text, "");
  }
  assert.equal(f.calls.length, 0);
});
test("source role cookie, CSRF and destination nonce must be current and unambiguous", async (t) => {
  const f = await fixture(t), begun = await f.request(path("admin", "begin"), { body: { notification } });
  for (const [cookie, sent, expected] of [[`__Host-jessie_client=${tokens.client}`, csrf, 401], [`__Host-jessie_session=${tokens.admin}; __Host-jessie_session=${tokens.admin}`, csrf, 401], [`__Host-jessie_session=${tokens.admin}`, "wrong", 403]]) {
    const result = await f.request(path("admin", "authorize"), { origin: legacy, cookie, headers: { "X-CSRF-Token": sent }, body: { challenge: begun.json.challenge } }); assert.equal(result.status, expected);
    if (expected === 401) assert.equal(result.json.login, `/admin/login#notification=${notification}`);
  }
  const run = await flow(f);
  for (const cookie of [undefined, run.nonceCookie + "; " + run.nonceCookie]) assert.equal((await f.request(path("admin", "complete"), { cookie, body: { ticket: run.authorize.json.ticket } })).status, 400);
});
test("keeping a same-account primary session never emits an authentication Set-Cookie", async (t) => {
  const f = await fixture(t), run = await flow(f), otherToken = Buffer.alloc(32, 20).toString("base64url");
  f.sessions.set(otherToken, actor("admin"));
  const result = await f.request(path("admin", "complete"), { cookie: `${run.nonceCookie}; __Host-jessie_session=${otherToken}`, body: { ticket: run.authorize.json.ticket } });
  assert.equal(result.status, 200); assert.equal(result.json.keptExisting, true); assert.equal(result.headers["set-cookie"].length, 1);
  assert.match(result.headers["set-cookie"][0], /^__Host-jessie_transition_admin=;/);
});
test("a session revoked after export retains only the fixed login and notification reference", async (t) => {
  const f = await fixture(t), run = await flow(f, "client"); f.sessions.delete(tokens.client);
  const result = await f.request(path("client", "complete"), { cookie: run.nonceCookie, body: { ticket: run.authorize.json.ticket } });
  assert.equal(result.status, 401); assert.deepEqual(result.json, { error: "authentication_required", login: `/access#notification=${notification}` });
  assert.equal(result.headers["set-cookie"], undefined);
});
test("both roles can begin and complete independently on the same browser without replacing each other's nonce", async (t) => {
  const f = await fixture(t), admin = await flow(f, "admin"), client = await flow(f, "client");
  const both = `${admin.nonceCookie}; ${client.nonceCookie}`;
  const results = await Promise.all([["admin", admin], ["client", client]].map(async ([role, run]) => {
    const result = await f.request(path(role, "complete"), { cookie: both, body: { ticket: run.authorize.json.ticket } });
    assert.equal(result.status, 200); assert.match(result.headers["set-cookie"][0], new RegExp(`^${cookieName(role)}=`));
    assert.match(result.headers["set-cookie"][1], new RegExp(`^__Host-jessie_transition_${role}=;`)); return result;
  }));
  assert.equal(results.length, 2);
});
test("a newer ordinary primary sign-in cancels an in-flight handoff before it can set a stale cookie", async (t) => {
  const f = await fixture(t), run = await flow(f);
  let release, entered; const waiting = new Promise((resolve) => { release = resolve; }), started = new Promise((resolve) => { entered = resolve; });
  f.authService.session = async (token) => { entered(); await waiting; return f.sessions.get(token) ?? null; };
  const completion = f.request(path("admin", "complete"), { cookie: run.nonceCookie, body: { ticket: run.authorize.json.ticket } });
  await started;
  assert.equal((await f.request("/api/auth/login", { cookie: run.nonceCookie, body: {} })).status, 404);
  release(); const result = await completion;
  assert.equal(result.status, 400); assert.equal(result.headers["set-cookie"], undefined);
});
test("bridge pages and assets are fixed files, have no inline script, and purge fragments before asynchronous work", async (t) => {
  const f = await fixture(t);
  for (const origin of [primary, legacy]) for (const role of ["admin", "client"]) {
    const result = await f.request(`/connect-device/${role}`, { origin, method: "GET" }); assert.equal(result.status, 200);
    assert.match(result.text, /data-transition-primary="https:\/\/jessiemessage.com"/);
    assert.match(result.text, /id="transition-start"/); assert.doesNotMatch(result.text, /<script[^>]*>\s*[^<\s]/);
    assert.equal((await f.request(`/connect-device/${role}`, { origin, method: "HEAD" })).text, "");
  }
  for (const name of ["js", "css"]) assert.equal((await f.request(`/device-transition.${name}`, { method: "GET" })).status, 200);
  const script = await readFile(new URL("../public/device-transition.js", import.meta.url), "utf8");
  assert.ok(script.indexOf("history.replaceState") < script.indexOf("async function post"));
  assert.doesNotMatch(script, /document\.cookie|localStorage|sessionStorage|postMessage|\.token\b|innerHTML/);
  assert.match(script, /credentials: "same-origin"/); assert.match(script, /redirect: "error"/);
});
