import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createTasksHttpHandler } from "../server/tasks/http.mjs";
import { AUTH_HEADERS } from "../server/auth/http.mjs";
import { newToken } from "../server/auth/crypto.mjs";

const origin = "https://jessiemessage.example", path = "/api/admin/crm/tasks", now = 1792594800000;
const token = newToken(), csrf = newToken(), adminId = "a".repeat(32), taskId = "b".repeat(32), conversationId = "c".repeat(32);
const cookie = `__Host-jessie_session=${token}`, input = () => ({ conversationId, expectedVersion: "0", title: "Envoyer les photos 💋 <texte>", dueAt: now, done: false });
const task = () => ({ id: taskId, conversationId, clientName: "Client synthétique", title: input().title, dueAt: now, done: false, version: "1", createdAt: now, updatedAt: now });
const page = () => ({ tasks: [task()], hasMore: false, nextCursor: null, serverTime: now });
function service(overrides = {}, calls = []) {
  return { actor: async raw => raw === token ? { user: { id: adminId, role: "admin", pseudonym: "Jessie", email: "private" }, csrf, expiresAt: now + 3600000 } : null,
    list: async (raw, options) => { calls.push(["list", raw, options]); return page(); },
    summary: async raw => { calls.push(["summary", raw]); return { dueCount: 1, serverTime: now }; },
    get: async (raw, value) => { calls.push(["get", raw, value]); return { task: task(), serverTime: now }; },
    save: async (raw, value, body) => { calls.push(["save", raw, value, body]); return { task: task(), duplicate: false }; }, ...overrides };
}
async function fixture(t, overrides = {}, enabled = true) {
  const calls = [], handler = createTasksHttpHandler(service(overrides, calls), { origin, enabled });
  const server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end("fallback"); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, calls };
}
const headers = (changes = {}) => ({ Cookie: cookie, Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf, ...changes });
const get = (f, suffix = path, options = {}) => fetch(f.base + suffix, { headers: { Cookie: cookie }, ...options });
const post = (f, body = input(), customHeaders = headers(), suffix = `${path}/${taskId}`) => fetch(f.base + suffix, { method: "POST", headers: customHeaders, body: typeof body === "string" ? body : JSON.stringify(body) });
function privateResponse(response) { for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value, name); }
async function failure(response, status, error) { assert.equal(response.status, status); privateResponse(response); assert.deepEqual(await response.json(), { error }); }

test("task HTTP requires the complete service, canonical HTTPS origin and boolean switch", () => {
  for (const invalid of ["http://localhost", origin + "/", origin + "/path", origin + "?x=1", "https://u:p@example.invalid"]) assert.throws(() => createTasksHttpHandler(service(), { origin: invalid }));
  for (const name of ["actor", "list", "summary", "get", "save"]) assert.throws(() => createTasksHttpHandler({ ...service(), [name]: null }, { origin }));
  assert.throws(() => createTasksHttpHandler(service(), { origin, enabled: 0 }));
});
test("task APIs are private, no-store and expose only rebuilt session data", async t => {
  const f = await fixture(t), session = await get(f, `${path}/session`); privateResponse(session); assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { user: { id: adminId, role: "admin", pseudonym: "Jessie" }, csrf, expiresAt: now + 3600000 });
  assert.deepEqual(await (await get(f)).json(), page());
  assert.deepEqual(await (await get(f, `${path}/summary`)).json(), { dueCount: 1, serverTime: now });
  assert.deepEqual(await (await get(f, `${path}/${taskId}`)).json(), { task: task(), serverTime: now });
  await failure(await get(f, path, { headers: {} }), 401, "authentication_required");
  await failure(await get(f, path, { headers: { Cookie: `__Host-jessie_client=${newToken()}` } }), 401, "authentication_required");
});
test("task list queries accept only bounded, unique known fields and preserve their exact scope", async t => {
  const f = await fixture(t), afterId = "0".repeat(32);
  assert.equal((await get(f, `${path}?filter=due&conversationId=${conversationId}&afterId=${afterId}&limit=2`)).status, 200);
  assert.deepEqual(f.calls[0], ["list", token, { filter: "due", conversationId, afterId, limit: 2 }]);
  for (const query of ["limit=01", "limit=101", "limit=0", "filter=all", "filter=open&filter=done", "q=private", "conversationId=no"])
    await failure(await get(f, `${path}?${query}`), 400, "invalid_request");
  await failure(await get(f, `${path}/summary?filter=due`), 400, "invalid_request");
  await failure(await get(f, `${path}/${taskId}?filter=due`), 400, "invalid_request");
  assert.equal(f.calls.length, 1);
});
test("task pages accept a single canonical conversation link while other routes stay query-free", async t => {
  const f = await fixture(t), response = await get(f, `/admin/tasks?conversationId=${conversationId}`);
  assert.equal(response.status, 200); privateResponse(response); assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /<html/);
  for (const query of [`conversationId=${conversationId}&conversationId=${conversationId}`, "conversationId=invalid", `conversationId=${conversationId.toUpperCase()}`, "filter=due"])
    await failure(await get(f, `/admin/tasks?${query}`), 400, "invalid_request");
  await failure(await get(f, `/tasks.js?conversationId=${conversationId}`), 400, "invalid_request");
  await failure(await get(f, `${path}/session?conversationId=${conversationId}`), 400, "invalid_request");
  await failure(await post(f, input(), headers(), `${path}/${taskId}?conversationId=${conversationId}`), 400, "invalid_request");
  assert.equal(f.calls.length, 0);
});
test("task mutations enforce origin, current session, CSRF, bounded JSON and exact fields before saving", async t => {
  const f = await fixture(t);
  await failure(await post(f, input(), headers({ Origin: "https://foreign.example" })), 403, "request_rejected");
  await failure(await post(f, input(), headers({ "X-CSRF-Token": "wrong" })), 403, "csrf_failed");
  await failure(await post(f, input(), headers({ Cookie: "" })), 401, "authentication_required");
  await failure(await post(f, { ...input(), secret: true }), 400, "invalid_request");
  await failure(await post(f, "{"), 400, "invalid_request");
  await failure(await post(f, input(), headers({ "Content-Type": "text/plain" })), 415, "json_required");
  await failure(await post(f, { ...input(), title: "x".repeat(9000) }), 413, "request_too_large");
  assert.equal(f.calls.length, 0);
  const saved = await post(f); assert.equal(saved.status, 200); privateResponse(saved); assert.deepEqual(await saved.json(), { task: task(), duplicate: false });
  assert.deepEqual(f.calls, [["save", token, taskId, input()]]);
});
test("task conflicts and rate limits are actionable while private failures and invalid output are opaque", async t => {
  const conflict = await fixture(t, { save: async () => { throw Object.assign(new Error("private SQL"), { code: "TASKS_CONFLICT" }); } });
  await failure(await post(conflict), 409, "task_changed");
  const limit = await fixture(t, { save: async () => { throw Object.assign(new Error("private SQL"), { code: "TASKS_LIMIT" }); } });
  await failure(await post(limit), 409, "limit_reached");
  const broken = await fixture(t, { list: async () => ({ ...page(), private: "secret" }) });
  await failure(await get(broken), 503, "tasks_unavailable");
  const fake = await fixture(t, { summary: async () => { throw Object.assign(new Error("private SQL"), { httpStatus: 400, publicCode: "private SQL" }); } });
  await failure(await get(fake, `${path}/summary`), 503, "tasks_unavailable");
  const limited = await fixture(t, { summary: async () => { throw Object.assign(new Error(), { code: "TASKS_RATE_LIMIT", retryAfter: 12 }); } });
  const response = await get(limited, `${path}/summary`); await failure(response, 429, "try_again_later"); assert.equal(response.headers.get("retry-after"), "12");
});
test("missing or expired sessions redirect admin navigation and protect each task asset", async t => {
  const f = await fixture(t, { actor: async () => null });
  const response = await get(f, "/admin/tasks", { redirect: "manual", headers: { Cookie: cookie, Accept: "text/html" } });
  assert.equal(response.status, 303); privateResponse(response); assert.equal(response.headers.get("location"), "/admin/login?continue=%2Fadmin%2Ftasks");
  assert.match(response.headers.get("set-cookie"), /__Host-jessie_session=;.*Max-Age=0/); assert.equal(await response.text(), "");
  for (const asset of ["/tasks.js", "/tasks-model.js", "/tasks.css"]) await failure(await get(f, asset), 401, "authentication_required");
});
test("disabled task handlers expose no route and unsupported methods never mutate", async t => {
  const f = await fixture(t, {}, false);
  for (const url of [path, `${path}/summary`, "/admin/tasks", "/tasks.js"]) assert.equal((await get(f, url)).status, 404);
  assert.equal(f.calls.length, 0);
  const active = await fixture(t), response = await post(active, input(), headers(), path);
  await failure(response, 405, "method_not_allowed"); assert.equal(response.headers.get("allow"), "GET"); assert.equal(active.calls.length, 0);
});
