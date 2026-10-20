import test from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import { AUTH_HEADERS } from "../server/auth/http.mjs";
import { createNotificationsHttpHandler } from "../server/notifications/http.mjs";

const origin = "https://jessiemessage.example", now = Date.UTC(2026, 9, 17);
const tokens = { admin: Buffer.alloc(32, 7).toString("base64url"), client: Buffer.alloc(32, 9).toString("base64url") };
const csrf = Buffer.alloc(32, 11).toString("base64url"), subscriptionId = "aa".repeat(16);
const publicKey = createECDH("prime256v1").generateKeys().toString("base64url");
const endpoint = "https://fcm.googleapis.com/fcm/send/private-browser-endpoint";
const subscription = { endpoint, expirationTime: null, keys: { p256dh: publicKey, auth: Buffer.alloc(16, 4).toString("base64url") } };
const cookie = (role = "admin") => `${role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${tokens[role]}`;
const path = (kind = "capabilities", role = "admin") => `/api/notifications/${role}/${kind}`;
const headers = (role = "admin", extra = {}) => ({ Origin: origin, Cookie: cookie(role), "Content-Type": "application/json", "X-CSRF-Token": csrf, ...extra });
const row = (changes = {}) => ({ id: subscriptionId, enabled: true, createdAt: now, updatedAt: now,
  endpoint, keys: subscription.keys, ciphertext: "private-ciphertext", ownerId: "private-owner", ...changes });
const actor = (role, changes = {}) => ({ user: { id: (role === "admin" ? "bb" : "cc").repeat(16), role, pseudonym: "Fictional account" },
  csrf, expiresAt: now + 600000, access: { state: "active", admissionPolicy: "manual_invitation", emailVerified: true, invitationConsumed: true, approved: true }, ...changes });
async function fixture(t, overrides = {}) {
  const calls = [];
  const record = (method, result) => async (...args) => { calls.push([method, ...args]); return typeof result === "function" ? result(...args) : result; };
  const service = {
    actor: record("actor", (role) => actor(role)),
    capabilities: record("capabilities", { enabled: true, vapidPublicKey: publicKey, subscriptions: [row()], secret: "private-secret" }),
    status: record("status", { enabled: true, subscriptionId, endpoint }),
    subscribe: record("subscribe", { enabled: true, subscriptionId, endpoint }),
    disable: record("disable", { enabled: false, endpoint }),
    open: record("open", { conversationId: "dd".repeat(16), messageId: "ee".repeat(16), sequence: "9007199254740993" }), ...overrides,
  };
  const handler = createNotificationsHttpHandler(service, { origin });
  const server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { service, handler, calls, server, base: `http://127.0.0.1:${server.address().port}` };
}
const post = (base, kind, body, role = "admin", extra = {}) => fetch(`${base}${path(kind, role)}`, { method: "POST", headers: headers(role, extra), body: typeof body === "string" ? body : JSON.stringify(body) });

test("notification opening requires the current role cookie, CSRF and a bounded opaque reference", async (t) => {
  const f = await fixture(t), notification = "ff".repeat(16);
  for (const role of ["admin", "client"]) {
    const result = await post(f.base, "open", { notification }, role);
    assert.equal(result.status, 200); privateHeaders(result);
    assert.deepEqual(await result.json(), { conversationId: "dd".repeat(16), messageId: "ee".repeat(16), sequence: "9007199254740993" });
    assert.deepEqual(f.calls.at(-1), ["open", role, tokens[role], { notification }]);
  }
  const before = f.calls.filter(([method]) => method === "open").length;
  for (const [body, extra, status] of [[{ notification }, { Cookie: "" }, 401], [{ notification }, { "X-CSRF-Token": "wrong" }, 403],
    [{ notification, next: "https://evil.invalid" }, {}, 400], [{ notification: "bad" }, {}, 400], [{ notification }, { Origin: "https://evil.invalid" }, 403]]) {
    const result = await post(f.base, "open", body, "client", extra); assert.equal(result.status, status);
  }
  assert.equal(f.calls.filter(([method]) => method === "open").length, before);
});
function privateHeaders(response) {
  for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value, name);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
}
function privateFields(value) { assert.doesNotMatch(JSON.stringify(value), /private-|endpoint|ciphertext|p256dh|ownerId|secret/); }

test("notifications HTTP requires a full service and canonical HTTPS origin", () => {
  const service = Object.fromEntries(["actor", "capabilities", "status", "subscribe", "disable", "open"].map((method) => [method, () => {}]));
  for (const candidate of ["http://example.invalid", `${origin}/`, `${origin}/app`, "https://user:pass@example.invalid", `${origin}?x=1`]) assert.throws(() => createNotificationsHttpHandler(service, { origin: candidate }));
  assert.throws(() => createNotificationsHttpHandler({}, { origin }));
});

test("capabilities authenticate both roles and only expose the public VAPID key and bounded device metadata", async (t) => {
  const { base, calls } = await fixture(t);
  for (const role of ["admin", "client"]) {
    const response = await fetch(`${base}${path("capabilities", role)}`, { headers: { Cookie: cookie(role) } });
    assert.equal(response.status, 200); privateHeaders(response); const body = await response.json(); privateFields(body);
    assert.deepEqual(body, { enabled: true, vapidPublicKey: publicKey, subscriptions: [{ id: subscriptionId, enabled: true, createdAt: now, updatedAt: now }] });
    assert.ok(calls.some(([name, sentRole, token]) => name === "capabilities" && sentRole === role && token === tokens[role]));
  }
});

test("role cookies reject other-role tokens, duplicates and noncanonical encodings before any service call", async (t) => {
  const { base, calls } = await fixture(t);
  for (const role of ["admin", "client"]) for (const [header, clears] of [[undefined, false], [cookie(role === "admin" ? "client" : "admin"), false], [`${cookie(role).split("=")[0]}=`, true], [`${cookie(role)}; ${cookie(role)}`, true], [`${cookie(role)}=`, true], [`${role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${"!".repeat(43)}`, true]]) {
    const response = await fetch(`${base}${path("capabilities", role)}`, { headers: header ? { Cookie: header } : {} });
    assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: "authentication_required" });
    if (clears) assert.match(response.headers.get("set-cookie"), new RegExp(`^${cookie(role).split("=")[0]}=;.*Max-Age=0`));
    else assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(calls.length, 0);
});

test("unauthenticated notification POST still clears only the requested role cookie", async (t) => {
  const { base, calls } = await fixture(t);
  for (const role of ["admin", "client"]) {
    const response = await post(base, "status", { endpoint }, role, { Cookie: "" });
    assert.equal(response.status, 401); assert.match(response.headers.get("set-cookie"), new RegExp(`^${cookie(role).split("=")[0]}=;.*Max-Age=0`));
  }
  assert.equal(calls.length, 0);
});

test("POST rejects cross-site origin and unsafe MIME before authentication or reading body", async (t) => {
  const { handler, calls } = await fixture(t);
  for (const extra of [{ origin: "https://other.invalid" }, { "sec-fetch-site": "cross-site" }, { "content-type": "text/plain" }, { "content-encoding": "gzip" }]) {
    const request = new PassThrough(); request.method = "POST"; request.url = path("subscription");
    request.headers = Object.fromEntries(Object.entries(headers()).map(([key, value]) => [key.toLowerCase(), value]));
    Object.assign(request.headers, extra);
    let status; const response = { headersSent: false, destroyed: false, writeHead(value) { status = value; }, end() {} };
    await handler(request, response); assert.ok([403, 415].includes(status)); assert.equal(request.listenerCount("data"), 0); request.destroy();
  }
  assert.equal(calls.length, 0);
});

test("status, subscribe and disable require current CSRF and preserve the exact authenticated role", async (t) => {
  const { base, calls } = await fixture(t);
  for (const role of ["admin", "client"]) {
    for (const [kind, body] of [["status", { endpoint }], ["subscription", { subscription, language: "fr" }], ["disable", { id: subscriptionId }]]) {
      const before = calls.filter(([name]) => name !== "actor").length;
      for (const candidate of ["", "A".repeat(43), `${csrf}, ${csrf}`]) {
        const rejected = await post(base, kind, body, role, { "X-CSRF-Token": candidate });
        assert.equal(rejected.status, 403); assert.deepEqual(await rejected.json(), { error: "csrf_failed" });
      }
      assert.equal(calls.filter(([name]) => name !== "actor").length, before);
      const response = await post(base, kind, body, role); assert.equal(response.status, 200); privateHeaders(response);
      const result = await response.json(); privateFields(result);
      assert.deepEqual(result, kind === "disable" ? { enabled: false } : { enabled: true, subscriptionId });
      assert.deepEqual(calls.at(-1), [kind === "subscription" ? "subscribe" : kind, role, tokens[role], body]);
    }
  }
});

test("POST bodies reject spoofed owners, extra fields, malformed IDs, locales and arrays", async (t) => {
  const { base, calls } = await fixture(t);
  const invalid = [["status", { endpoint, ownerId: "private-owner" }], ["status", {}], ["status", { endpoint: "x".repeat(4097) }],
    ["subscription", { subscription, language: "jp" }], ["subscription", { subscription: [], language: "fr" }], ["subscription", { subscription, language: "fr", userId: subscriptionId }],
    ["disable", { id: "AA".repeat(16) }], ["disable", { id: subscriptionId, allDevices: true }], ["disable", { id: subscriptionId + "\n" }]];
  for (const [kind, body] of invalid) {
    const response = await post(base, kind, body); assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  for (const body of ["[]", "null", "{", '"private-value"']) assert.equal((await post(base, "status", body)).status, 400);
  assert.equal(calls.some(([name]) => name !== "actor"), false);
});

test("notification JSON has an eight-KiB byte bound for declared and streaming bodies", async (t) => {
  const { base, calls } = await fixture(t);
  const response = await post(base, "status", JSON.stringify({ endpoint: "x".repeat(9000) }));
  assert.equal(response.status, 413); assert.deepEqual(await response.json(), { error: "request_too_large" });
  const streamed = await fetch(`${base}${path("status")}`, { method: "POST", headers: headers(),
    body: (async function* () { yield Buffer.alloc(5000, 32); yield Buffer.alloc(5000, 32); })(), duplex: "half" });
  assert.equal(streamed.status, 413);
  assert.equal(calls.some(([name]) => name === "status"), false);
});

test("routes are exact, queries never carry endpoints and unsupported methods do not reach the service", async (t) => {
  const { base, calls } = await fixture(t);
  for (const route of ["/api/notifications/client/capabilities/", "/api/notifications/other/capabilities", "/api/notifications/client/subscription/extra", "/api/notifications/client/%73tatus"]) assert.equal((await fetch(`${base}${route}`)).status, 404);
  for (const suffix of ["?endpoint=private", "?limit=1&limit=1"]) assert.equal((await fetch(`${base}${path()}${suffix}`, { headers: headers() })).status, 400);
  const getStatus = await fetch(`${base}${path("status")}`, { headers: headers() }); assert.equal(getStatus.status, 405); assert.equal(getStatus.headers.get("allow"), "POST");
  const head = await fetch(`${base}${path()}`, { method: "HEAD", headers: headers() }); assert.equal(head.status, 405); assert.equal(await head.text(), "");
  assert.equal(calls.length, 0);
});

test("inactive admission and malformed actor metadata cannot access notification settings", async (t) => {
  const { base, service } = await fixture(t);
  for (const change of [{ access: null }, { access: { state: "active" } }, { access: { ...actor("client").access, approved: false } }]) {
    service.actor = async () => actor("client", change);
    assert.equal((await fetch(`${base}${path("capabilities", "client")}`, { headers: headers("client") })).status, 403);
  }
  for (const change of [{ csrf: "private-invalid" }, { expiresAt: NaN }, { user: { ...actor("admin").user, id: "AA".repeat(16) } }, { user: { ...actor("admin").user, role: "client" } }]) {
    service.actor = async () => actor("admin", change);
    const response = await fetch(`${base}${path()}`, { headers: headers() }); assert.equal(response.status, 503); privateFields(await response.json());
  }
});

test("malformed capability/status outputs fail closed and private response fields never escape", async (t) => {
  const { base, service } = await fixture(t);
  const valid = { enabled: true, vapidPublicKey: publicKey, subscriptions: [row()] };
  for (const output of [{ ...valid, enabled: false }, { ...valid, enabled: undefined }, { ...valid, vapidPublicKey: "private-key" },
    { ...valid, subscriptions: [row({ id: "x" })] }, { ...valid, subscriptions: [row({ enabled: undefined })] },
    { ...valid, subscriptions: [row({ updatedAt: now - 1 })] }, { ...valid, subscriptions: [row(), row()] }]) {
    service.capabilities = async () => output;
    const response = await fetch(`${base}${path()}`, { headers: headers() }); assert.equal(response.status, 503); privateFields(await response.json());
  }
  for (const output of [{ enabled: true, subscriptionId: null }, { enabled: false, subscriptionId }, { subscriptionId }, { enabled: true, subscriptionId: "private-id" }]) {
    service.status = async () => output;
    const response = await post(base, "status", { endpoint }); assert.equal(response.status, 503); privateFields(await response.json());
  }
  service.disable = async () => ({ endpoint }); assert.equal((await post(base, "disable", { id: subscriptionId })).status, 503);
});

test("bounded errors distinguish conflict, device limit, authorization and retry without leaking SQL or endpoints", async (t) => {
  const { base, service } = await fixture(t);
  for (const [code, status, expected] of [["NOTIFICATIONS_CONFLICT", 409, "subscription_conflict"], ["NOTIFICATIONS_LIMIT", 409, "subscription_limit"],
    ["NOTIFICATIONS_NOT_FOUND", 404, "not_found"], ["NOTIFICATIONS_INPUT", 400, "invalid_request"], ["NOTIFICATIONS_RATE_LIMIT", 429, "try_again_later"],
    ["AUTH_BUSY", 429, "try_again_later"], ["CHAT_UNAUTHORIZED", 401, "authentication_required"], ["AUTH_INVALID", 401, "authentication_required"],
    ["ACCESS_EXPIRED", 403, "request_rejected"], ["NOTIFICATIONS_UNAVAILABLE", 503, "notifications_unavailable"], ["ER_PRIVATE_SQL", 503, "notifications_unavailable"]]) {
    service.capabilities = async () => { throw Object.assign(new Error(endpoint), { code, retryAfter: 90000, endpoint, privateKey: "private-key" }); };
    const response = await fetch(`${base}${path("capabilities", "client")}`, { headers: headers("client") });
    assert.equal(response.status, status, code); assert.deepEqual(await response.json(), { error: expected });
    assert.equal(response.headers.has("set-cookie"), status === 401); if (status === 429) assert.equal(response.headers.get("retry-after"), "3600");
  }
  service.capabilities = async () => { throw Object.assign(new Error("private"), { httpStatus: 400, publicCode: "private_endpoint" }); };
  const response = await fetch(`${base}${path()}`, { headers: headers() }); assert.equal(response.status, 503); privateFields(await response.json());
});
