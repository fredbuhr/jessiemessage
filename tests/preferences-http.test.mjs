import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPreferencesHandler } from "../server/preferences/http.mjs";
import { AUTH_HEADERS } from "../server/auth/http.mjs";
const origin = "https://jessiemessage.example", token = Buffer.alloc(32, 1).toString("base64url"), csrf = Buffer.alloc(32, 2).toString("base64url");
const view = { version: "0", catalogueVersion: "2026-10-23-recherche-1", selectedIds: [] }, input = { expectedVersion: "0", catalogueVersion: view.catalogueVersion, selectedIds: [] };
const headers = role => ({ Cookie: `${role === "admin" ? "__Host-jessie_session" : "__Host-jessie_client"}=${token}`, Origin: origin, "X-CSRF-Token": csrf, "Content-Type": "application/json" });
async function fixture(t) {
  const calls = [], service = {
    async actor(role) { calls.push("actor"); return { user: { id: "a".repeat(32), role }, csrf }; },
    async read() { calls.push("read"); return { ...view, secret: "never exposed" }; },
    async save(role, raw, body) { calls.push("save"); assert.deepEqual(body, input); return { ...view, version: "1" }; },
    async peer() { calls.push("peer"); return view; },
  };
  const handler = createPreferencesHandler(service, { origin }), server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, calls };
}
test("preferences HTTP uses separate role cookies and private no-store headers with a bounded public view", async t => {
  const f = await fixture(t);
  for (const role of ["admin", "client"]) {
    const response = await fetch(`${f.base}/api/profile/${role}/preferences`, { headers: headers(role) });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), view);
    for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value);
    assert.equal((await fetch(`${f.base}/api/profile/${role}/preferences`, { method: "POST", headers: headers(role), body: JSON.stringify(input) })).status, 200);
  }
  assert.equal((await fetch(`${f.base}/api/profile/client/preferences`, { headers: headers("admin") })).status, 401);
});
test("preference mutations reject CSRF, foreign origins, unknown IDs, claimed owners and query disclosure", async t => {
  const f = await fixture(t), url = `${f.base}/api/profile/client/preferences`;
  for (const [change, expected] of [[{ Origin: "https://other.invalid" }, 403], [{ "X-CSRF-Token": "wrong" }, 403], [{ "Content-Type": "text/plain" }, 415]]) assert.equal((await fetch(url, { method: "POST", headers: { ...headers("client"), ...change }, body: JSON.stringify(input) })).status, expected);
  for (const body of [{ ...input, userId: "a".repeat(32) }, { ...input, selectedIds: ["pref_c01_not-real"] }]) assert.equal((await fetch(url, { method: "POST", headers: headers("client"), body: JSON.stringify(body) })).status, 400);
  assert.equal((await fetch(url + "?selectedIds=private", { headers: headers("client") })).status, 400); assert.equal(f.calls.includes("save"), false);
});
test("client cross-account paths are denied and admin conversation access is strictly read only", async t => {
  const f = await fixture(t), id = "c".repeat(32);
  assert.equal((await fetch(`${f.base}/api/profile/client/conversations/${id}/preferences`, { headers: headers("client") })).status, 403);
  const url = `${f.base}/api/profile/admin/conversations/${id}/preferences`;
  assert.equal((await fetch(url, { headers: headers("admin") })).status, 200);
  assert.equal((await fetch(url, { method: "POST", headers: headers("admin"), body: JSON.stringify(input) })).status, 405);
  assert.equal(f.calls.includes("save"), false); assert.equal(f.calls.filter(value => value === "peer").length, 1);
});
