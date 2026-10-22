import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createQuickRepliesHandler } from "../server/quick-replies/http.mjs";
import { AUTH_HEADERS } from "../server/auth/http.mjs";

const origin = "https://jessiemessage.example", token = Buffer.alloc(32, 1).toString("base64url"), csrf = Buffer.alloc(32, 2).toString("base64url");
const replies = [{ id: "b".repeat(32), title: "Saved", body: "Synthetic personal reply", language: "en" }], input = { expectedVersion: "0", replies };
const headers = { Cookie: `__Host-jessie_session=${token}`, Origin: origin, "X-CSRF-Token": csrf, "Content-Type": "application/json" };
async function fixture(t, overrides = {}) {
  const calls = [], service = { async actor(value) { calls.push("actor"); assert.equal(value, token); return { user: { id: "a".repeat(32), role: "admin" }, csrf }; },
    async read() { calls.push("read"); return { version: "0", replies: [] }; }, async save(value, body) { calls.push("save"); assert.equal(value, token); assert.deepEqual(body, input); return { version: "1", replies }; }, close() { calls.push("close"); }, ...overrides };
  const handler = createQuickRepliesHandler(service, { origin }), server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { handler.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, calls, service, handler };
}
test("saved replies HTTP returns only the catalogue with private response headers and closes the service", async t => {
  const f = await fixture(t); const response = await fetch(f.base + "/api/admin/quick-replies", { headers });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { version: "0", replies: [] });
  for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value);
  const saved = await fetch(f.base + "/api/admin/quick-replies", { method: "POST", headers, body: JSON.stringify(input) }); assert.equal(saved.status, 200); assert.deepEqual(await saved.json(), { version: "1", replies });
  f.handler.close(); assert.ok(f.calls.includes("close"));
});
test("clients and absent admin cookies cannot read or mutate saved replies", async t => {
  const f = await fixture(t), url = f.base + "/api/admin/quick-replies";
  for (const cookie of [undefined, `__Host-jessie_client=${token}`, "__Host-jessie_session=bad"]) {
    const result = await fetch(url, { headers: cookie ? { Cookie: cookie } : {} }); assert.equal(result.status, 401); assert.deepEqual(await result.json(), { error: "authentication_required" });
  }
  assert.equal(f.calls.length, 0);
  f.service.actor = async () => ({ user: { id: "a".repeat(32), role: "client" }, csrf });
  assert.equal((await fetch(url, { headers })).status, 401); assert.equal(f.calls.includes("read"), false);
});
test("saved replies mutations require origin, CSRF, JSON, exact shape and no query parameters", async t => {
  const f = await fixture(t), url = f.base + "/api/admin/quick-replies";
  for (const [change, status] of [[{ Origin: "https://foreign.invalid" },403],[{ "X-CSRF-Token": "wrong" },403],[{ "Content-Type": "text/plain" },415]]) {
    assert.equal((await fetch(url, { method: "POST", headers: { ...headers, ...change }, body: JSON.stringify(input) })).status, status);
  }
  for (const body of [{ ...input, ownerId: "a".repeat(32) }, { ...input, expectedVersion: "01" }, { ...input, replies: [{ ...replies[0], extra: true }] }]) {
    assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify(body) })).status, 400);
  }
  assert.equal((await fetch(url + "?owner=other", { headers })).status, 400);
  assert.equal((await fetch(url, { method: "POST", headers, body: " ".repeat(33000) })).status, 413);
  assert.equal(f.calls.includes("save"), false);
});
test("conflicts, busy stores and failures are sanitized and unsupported methods never reach the service", async t => {
  const f = await fixture(t), url = f.base + "/api/admin/quick-replies";
  for (const [code, status, publicCode] of [["QUICK_REPLIES_CONFLICT",409,"quick_replies_changed"],["QUICK_REPLIES_BUSY",429,"try_again_later"],["OTHER",503,"quick_replies_unavailable"]]) {
    f.service.save = async () => { throw Object.assign(new Error("/private/key/path SQL secret"), { code }); };
    const result = await fetch(url, { method: "POST", headers, body: JSON.stringify(input) }); assert.equal(result.status, status); assert.deepEqual(await result.json(), { error: publicCode });
  }
  const count = f.calls.length;
  for (const method of ["PUT", "DELETE", "HEAD"]) { const result = await fetch(url, { method, headers }); assert.equal(result.status, 405); assert.equal(result.headers.get("allow"), "GET, POST"); }
  assert.equal(f.calls.length, count);
});
