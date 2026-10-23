import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPublicProfileHandler } from "../server/public-profile/http.mjs";
import { PublicProfileError, PREFERENCES_CATALOGUE_VERSION } from "../server/public-profile/validation.mjs";
import { AUTH_HEADERS } from "../server/auth/http.mjs";
const origin = "https://jessiemessage.example", token = Buffer.alloc(32, 1).toString("base64url"), csrf = Buffer.alloc(32, 2).toString("base64url");
const content = { displayName: "Jessie", bio: "Bienvenue.", catalogueVersion: PREFERENCES_CATALOGUE_VERSION, selectedIds: [] };
const headers = { Cookie: `__Host-jessie_session=${token}`, Origin: origin, "X-CSRF-Token": csrf, "Content-Type": "application/json" };
const input = { expectedVersion: "0", published: true, ...content };
async function fixture(t) {
  let published = false, reads = 0, saves = 0;
  const service = {
    async actor() { return { user: { role: "admin", id: "a".repeat(32) }, csrf }; },
    async read() { reads++; return { version: "0", published, ...content, secret: "never expose" }; },
    async save(raw, body) { saves++; assert.deepEqual(body, input); published = body.published; return { version: "1", published, ...content }; },
    async publicView() { if (!published) throw new PublicProfileError("PUBLIC_PROFILE_NOT_FOUND"); return { ...content, userId: "never expose", version: "private" }; },
  };
  const handler = createPublicProfileHandler(service, { origin }), server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, get reads() { return reads; }, get saves() { return saves; } };
}
test("public GET and HEAD disclose only the explicit published snapshot, with no-store headers", async t => {
  const f = await fixture(t), url = f.base + "/api/public/jessie";
  assert.equal((await fetch(url)).status, 404);
  const saved = await fetch(f.base + "/api/profile/admin/publication", { method: "POST", headers, body: JSON.stringify(input) }); assert.equal(saved.status, 200);
  const response = await fetch(url); assert.equal(response.status, 200); assert.deepEqual(await response.json(), content);
  for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value);
  const head = await fetch(url, { method: "HEAD" }); assert.equal(head.status, 200); assert.equal(await head.text(), "");
  assert.equal((await fetch(url + "?userId=private")).status, 400);
  assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify(input) })).status, 405);
  assert.equal(f.reads, 0); assert.equal(f.saves, 1);
});
test("publication administration rejects clients, absent sessions, forged origins, CSRF and unexpected input", async t => {
  const f = await fixture(t), url = f.base + "/api/profile/admin/publication";
  for (const cookies of [undefined, `__Host-jessie_client=${token}`]) assert.equal((await fetch(url, { headers: cookies ? { Cookie: cookies } : {} })).status, 401);
  for (const [change, expected] of [[{ Origin: "https://other.invalid" }, 403], [{ "X-CSRF-Token": "wrong" }, 403], [{ "Content-Type": "text/plain" }, 415]]) {
    assert.equal((await fetch(url, { method: "POST", headers: { ...headers, ...change }, body: JSON.stringify(input) })).status, expected);
  }
  assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...input, userId: "a".repeat(32) }) })).status, 400);
  const response = await fetch(url, { headers }); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { version: "0", published: false, ...content });
  assert.equal(f.saves, 0);
});
