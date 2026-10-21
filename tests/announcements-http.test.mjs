import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createAnnouncementsHandler } from "../server/announcements/http.mjs";
import { AUTH_HEADERS } from "../server/auth/http.mjs";
import { newToken } from "../server/auth/crypto.mjs";

const origin = "https://jessiemessage.example", basePath = "/api/announcements", now = 1792594800000;
const token = newToken(), clientToken = newToken(), csrf = newToken(), adminId = "a".repeat(32), clientId = "b".repeat(32);
const cookie = `__Host-jessie_session=${token}`, clientCookie = `__Host-jessie_client=${clientToken}`;
const input = () => ({ mutationId: "c".repeat(32), expectedRevision: "0", body: "Je commence bientôt 💋 <b>texte</b>", startsAt: null,
  expiresAt: now + 3600000, sendPrivateMessage: false, previewToken: null });
const actor = role => ({ user: { id: role === "admin" ? adminId : clientId, role, pseudonym: "Jessie", email: "private-secret" }, csrf, expiresAt: now + 3600000 });
const view = (role, mutation = false) => ({ serverTime: now, ...(role === "admin" ? { revision: "0" } : {}), announcement: null, ...(mutation ? { duplicate: false } : {}) });
function service(overrides = {}, calls = []) {
  return { actor: async (role, value) => value === (role === "admin" ? token : clientToken) ? actor(role) : null,
    current: async (role, value) => { calls.push(["current", role, value]); return view(role); },
    preview: async (value, body) => { calls.push(["preview", value, body]); return { totalCount: 10, eligibleCount: 9, excludedCount: 1, previewToken: "preview" }; },
    save: async (value, body) => { calls.push(["save", value, body]); return view("admin", true); },
    remove: async (value, body) => { calls.push(["remove", value, body]); return view("admin", true); }, ...overrides };
}
async function fixture(t, overrides) {
  const calls = [], handler = createAnnouncementsHandler(service(overrides, calls), { origin });
  const server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end("fallback"); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, calls };
}
const headers = (changes = {}) => ({ Cookie: cookie, Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf, ...changes });
const get = (f, path, options = {}) => fetch(f.base + path, { headers: { Cookie: cookie }, ...options });
const post = (f, path, body, customHeaders = headers()) => fetch(f.base + path, { method: "POST", headers: customHeaders, body: typeof body === "string" ? body : JSON.stringify(body) });
function privateResponse(response) { for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value, name); }
async function failure(response, status, error) { assert.equal(response.status, status); privateResponse(response); assert.deepEqual(await response.json(), { error }); }

test("announcement HTTP requires the full service and a canonical HTTPS origin", () => {
  for (const invalid of ["http://localhost", origin + "/", origin + "/path", origin + "?x=1", "https://u:p@example.invalid"]) assert.throws(() => createAnnouncementsHandler(service(), { origin: invalid }));
  for (const name of ["actor", "current", "preview", "save", "remove"]) assert.throws(() => createAnnouncementsHandler({ ...service(), [name]: null }, { origin }));
});
test("sessions and current banners are role-private, no-store and query-free", async t => {
  const f = await fixture(t), response = await get(f, basePath + "/admin/session");
  assert.equal(response.status, 200); privateResponse(response);
  assert.deepEqual(await response.json(), { user: { id: adminId, role: "admin", pseudonym: "Jessie" }, csrf, expiresAt: now + 3600000 });
  assert.deepEqual(await (await get(f, basePath + "/client/current", { headers: { Cookie: clientCookie } })).json(), view("client"));
  await failure(await get(f, basePath + "/admin/current", { headers: { Cookie: clientCookie } }), 401, "unauthorized");
  await failure(await get(f, basePath + "/client/current"), 401, "unauthorized");
  await failure(await get(f, basePath + "/admin/current?revision=1"), 400, "invalid_request");
  await failure(await get(f, basePath + "/admin/current", { headers: {} }), 401, "unauthorized");
});
test("every mutation enforces origin, session, CSRF, bounded JSON and exact request shapes", async t => {
  const f = await fixture(t), path = basePath + "/admin/current";
  await failure(await post(f, path, input(), headers({ Origin: "https://foreign.example" })), 403, "request_rejected");
  await failure(await post(f, path, input(), headers({ "X-CSRF-Token": "wrong" })), 403, "csrf_failed");
  await failure(await post(f, path, input(), headers({ Cookie: clientCookie })), 401, "unauthorized");
  await failure(await post(f, path, { ...input(), secret: true }), 400, "invalid_request");
  await failure(await post(f, path, "{"), 400, "invalid_request");
  await failure(await post(f, path, input(), headers({ "Content-Type": "text/plain" })), 415, "json_required");
  await failure(await post(f, path, { ...input(), body: "x".repeat(17000) }), 413, "request_too_large");
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await (await post(f, path, input())).json(), view("admin", true));
  assert.deepEqual(f.calls[0], ["save", token, input()]);
  const remove = { mutationId: "d".repeat(32), expectedRevision: "1" };
  assert.deepEqual(await (await post(f, path + "/remove", remove)).json(), view("admin", true));
  const preview = await post(f, basePath + "/admin/preview", {});
  assert.equal(preview.status, 200); assert.equal((await preview.json()).eligibleCount, 9);
});
test("stale changes are definitive conflicts while unexpected service failures and invalid DTOs stay opaque", async t => {
  const conflict = await fixture(t, { save: async () => { throw Object.assign(new Error("private"), { code: "ANNOUNCEMENTS_CONFLICT" }); } });
  await failure(await post(conflict, basePath + "/admin/current", input()), 409, "conflict");
  const broken = await fixture(t, { current: async () => ({ ...view("admin"), secret: "private SQL" }) });
  await failure(await get(broken, basePath + "/admin/current"), 503, "announcements_unavailable");
  const fake = await fixture(t, { current: async () => { throw Object.assign(new Error("private SQL"), { httpStatus: 400, publicCode: "private SQL" }); } });
  await failure(await get(fake, basePath + "/admin/current"), 503, "announcements_unavailable");
  const limited = await fixture(t, { current: async () => { throw Object.assign(new Error(), { code: "ANNOUNCEMENTS_RATE_LIMIT", retryAfter: 12 }); } });
  const response = await get(limited, basePath + "/admin/current"); await failure(response, 429, "rate_limit"); assert.equal(response.headers.get("retry-after"), "12");
});
test("admin HTML navigation with an expired or missing session redirects before disclosing its page", async t => {
  const f = await fixture(t, { actor: async () => null });
  const response = await get(f, "/admin/announcements", { redirect: "manual", headers: { Cookie: cookie, Accept: "text/html" } });
  assert.equal(response.status, 303); privateResponse(response);
  assert.equal(response.headers.get("location"), "/admin/login?continue=%2Fadmin%2Fannouncements");
  assert.match(response.headers.get("set-cookie"), /__Host-jessie_session=;.*Max-Age=0/);
  assert.equal(await response.text(), "");
  const missing = await get(f, "/admin/announcements", { redirect: "manual", headers: { Accept: "text/html" } }); assert.equal(missing.status, 303);
  await failure(await get(f, "/announcements.js"), 401, "unauthorized");
});
test("announcement assets use their own roles and reject unsupported methods", async t => {
  const f = await fixture(t);
  const html = await get(f, "/admin/announcements"); assert.equal(html.status, 200); assert.match(html.headers.get("content-type"), /text\/html/);
  const banner = await get(f, "/announcement-banner.js", { headers: { Cookie: clientCookie } }); assert.equal(banner.status, 200); privateResponse(banner);
  const css = await get(f, "/announcement-banner.css", { headers: { Cookie: clientCookie } }); assert.equal(css.status, 200);
  await failure(await get(f, "/announcement-banner.js"), 401, "unauthorized");
  const unsupported = await post(f, basePath + "/client/current", {}); assert.equal(unsupported.status, 405); assert.equal(unsupported.headers.get("allow"), "GET");
});
