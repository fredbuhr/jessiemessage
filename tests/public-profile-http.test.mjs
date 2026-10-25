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
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
async function fixture(t, { photo = false, legacy = false, avatarResult = () => ({ bytes: Buffer.from(jpeg), mime: "image/jpeg" }) } = {}) {
  let published = false, reads = 0, saves = 0, avatarReads = 0;
  const service = {
    async actor() { return { user: { role: "admin", id: "a".repeat(32) }, csrf }; },
    async read() { reads++; return { version: "0", published, ...content, secret: "never expose" }; },
    async save(raw, body) { saves++; assert.deepEqual(body, input); published = body.published; return { version: "1", published, ...content }; },
    async publicView() { if (!published) throw new PublicProfileError("PUBLIC_PROFILE_NOT_FOUND"); return { ...content, userId: "never expose", version: "private", avatarVersion: photo ? "1" : null }; },
    async publicAvatar(version) { avatarReads++; if (!published || !photo || version !== "1") throw new PublicProfileError("PUBLIC_PROFILE_NOT_FOUND"); return avatarResult(); },
  };
  if (legacy) delete service.publicAvatar;
  const handler = createPublicProfileHandler(service, { origin }), server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { base: `http://127.0.0.1:${server.address().port}`, get reads() { return reads; }, get saves() { return saves; }, get avatarReads() { return avatarReads; }, unpublish() { published = false; } };
}
test("public GET and HEAD disclose only the explicit published snapshot, with no-store headers", async t => {
  const f = await fixture(t), url = f.base + "/api/public/jessie";
  assert.equal((await fetch(url)).status, 404);
  const saved = await fetch(f.base + "/api/profile/admin/publication", { method: "POST", headers, body: JSON.stringify(input) }); assert.equal(saved.status, 200);
  const response = await fetch(url); assert.equal(response.status, 200); assert.deepEqual(await response.json(), content);
  assert.equal(response.headers.get("X-Jessie-Avatar-Version"), null, "legacy text-only profiles advertise no photo");
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

test("public avatar GET and HEAD expose only the selected published JPEG with a public revision header", async t => {
  const f = await fixture(t, { photo: true }), image = f.base + "/api/public/jessie/avatar?v=1";
  assert.equal((await fetch(image)).status, 404, "a hidden publication has no anonymous image");
  assert.equal((await fetch(f.base + "/api/profile/admin/publication", { method: "POST", headers, body: JSON.stringify(input) })).status, 200);
  const profile = await fetch(f.base + "/api/public/jessie");
  assert.equal(profile.headers.get("X-Jessie-Avatar-Version"), "1");
  assert.deepEqual(await profile.json(), content, "the established four-field public JSON shape stays unchanged");
  const response = await fetch(image); assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.equal(response.headers.get("Content-Length"), String(jpeg.length));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
  for (const [name, value] of Object.entries(AUTH_HEADERS)) assert.equal(response.headers.get(name), value);
  assert.equal(response.headers.get("Accept-Ranges"), "none");
  const head = await fetch(image, { method: "HEAD" }); assert.equal(head.status, 200);
  assert.equal(head.headers.get("Content-Length"), String(jpeg.length)); assert.equal(await head.text(), "");
  assert.equal((await fetch(f.base + "/api/public/jessie/avatar?v=2")).status, 404, "an old or foreign revision cannot select another saved image");
  const beforeInvalid = f.avatarReads;
  for (const query of ["", "?v=0", "?v=01", "?v=-1", "?v=4294967296", "?v=1&v=1", "?v=1&owner=private", "?version=1"]) {
    assert.equal((await fetch(f.base + "/api/public/jessie/avatar" + query)).status, 400, query);
  }
  assert.equal(f.avatarReads, beforeInvalid, "malformed image selectors refuse before store or image reads");
  assert.equal((await fetch(image, { method: "POST", headers, body: "{}" })).status, 405);
  f.unpublish(); assert.equal((await fetch(image)).status, 404, "unpublishing removes image access at the same route");
});

test("public avatar responses reject non-JPEG and oversized backend bytes without exposing them", async t => {
  const oversized = Buffer.alloc(131073, 9); jpeg.copy(oversized); oversized[oversized.length - 2] = 0xff; oversized[oversized.length - 1] = 0xd9;
  for (const result of [{ bytes: Buffer.from("<svg onload=alert(1)>"), mime: "image/jpeg" }, { bytes: Buffer.from(jpeg), mime: "image/svg+xml" }, { bytes: oversized, mime: "image/jpeg" }]) {
    const f = await fixture(t, { photo: true, avatarResult: () => result });
    await fetch(f.base + "/api/profile/admin/publication", { method: "POST", headers, body: JSON.stringify(input) });
    const response = await fetch(f.base + "/api/public/jessie/avatar?v=1");
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "public_profile_unavailable" });
  }
});

test("legacy service adapters retain text-only public JSON without requiring an avatar capability", async t => {
  const f = await fixture(t, { legacy: true });
  await fetch(f.base + "/api/profile/admin/publication", { method: "POST", headers, body: JSON.stringify(input) });
  const response = await fetch(f.base + "/api/public/jessie"); assert.equal(response.status, 200); assert.deepEqual(await response.json(), content);
  assert.equal((await fetch(f.base + "/api/public/jessie/avatar?v=1")).status, 503);
});
