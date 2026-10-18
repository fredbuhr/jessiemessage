import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { createPrivacyHandler } from "../server/privacy/http.mjs";
import { createPrivacyService } from "../server/privacy/service.mjs";
import { PrivacyError } from "../server/privacy/draft.mjs";
import { createAppServer } from "../server/index.mjs";

const token = Buffer.alloc(32, 1).toString("base64url"), csrf = Buffer.alloc(32, 2).toString("base64url"), origin = "https://jessiemessage.com", id = "1".repeat(32);
async function fixture(t) {
  let stored = { revision: 0, prepared: null }, authorized = true, role = "admin", actorCalls = 0, failAt = Infinity, beforeCommit = async () => {};
  const actor = async value => { actorCalls++; return authorized && actorCalls < failAt && value === token ? { user: { id, role, pseudonym: "Synthetic" }, csrf, expiresAt: Date.now() + 3600000 } : null; };
  const files = { async read() { return structuredClone(stored); }, async save(value, revision, authorize) {
    if (revision !== stored.revision) throw new PrivacyError("changed"); await beforeCommit(); await authorize(); stored = { revision: revision + 1, prepared: structuredClone(value) }; return stored.revision;
  }, close() {} };
  const service = await createPrivacyService({ directory: "/synthetic", key: Buffer.alloc(32, 3) }, { files });
  const handler = createPrivacyHandler(service, { origin, actor }), server = createServer(async (request, response) => { if (!await handler(request, response)) { response.writeHead(404); response.end(); } });
  await new Promise(done => server.listen(0, "127.0.0.1", done)); const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { handler.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); });
  const headers = { Cookie: `__Host-jessie_session=${token}`, Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf };
  const get = (path, options = {}) => fetch(url + path, options);
  const post = (body, extra = {}) => fetch(url + "/api/admin/privacy", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  return { service, handler, headers, get, post, revision: () => stored.revision, revoke: () => { authorized = false; }, client: () => { role = "client"; }, failOnNextProof: () => { failAt = actorCalls + 2; }, beforeCommit: callback => { beforeCommit = callback; } };
}
test("all preparation assets and API require current admin, no-store, no CORS and no cookie deletion", async t => {
  const f = await fixture(t);
  for (const path of ["/admin/privacy", "/privacy.js", "/privacy.css", "/i18n-privacy.js", "/api/admin/privacy"]) {
    const anonymous = await f.get(path); assert.equal(anonymous.status, 401); assert.equal(anonymous.headers.get("set-cookie"), null);
    const response = await f.get(path, { headers: f.headers }); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("access-control-allow-origin"), null); await response.arrayBuffer();
  }
  f.client(); assert.equal((await f.get("/api/admin/privacy", { headers: f.headers })).status, 401);
});
test("read and HEAD do not save; drafts and legal identity are unavailable from public paths", async t => {
  const f = await fixture(t), response = await f.get("/admin/privacy", { method: "HEAD", headers: f.headers }); assert.equal(response.status, 200); assert.equal(await response.text(), "");
  assert.equal(f.revision(), 0);
  for (const path of ["/privacy", "/privacy-preparation.json", "/docs/privacy-notice-draft.md", "/api/admin/privacy?token=hidden"]) {
    const response = await f.get(path, { headers: f.headers }); assert.equal(response.status, path.includes("?") ? 400 : 404);
  }
});
test("origin, CSRF, JSON type, closed payload and bounded body are checked before saving", async t => {
  const f = await fixture(t), state = await f.service.read(), body = { revision: state.revision, draft: state.draft };
  for (const [headers, expected] of [[{ Origin: "https://other.invalid" }, 403], [{ "Sec-Fetch-Site": "cross-site" }, 403], [{ "X-CSRF-Token": "wrong" }, 403], [{ "Content-Type": "text/plain" }, 415]]) assert.equal((await f.post(body, headers)).status, expected);
  assert.equal((await f.post({ ...body, publish: true })).status, 400); assert.equal((await f.post({ text: "x".repeat(49153) })).status, 413);
  assert.equal(f.revision(), 0);
  const saved = await f.post(body); assert.equal(saved.status, 200); assert.equal((await saved.json()).publication, "draft_only"); assert.equal(f.revision(), 1);
  assert.equal((await f.post(body)).status, 409); assert.equal(f.revision(), 1);
});
test("revocation while reading never returns private text or erases a replacement login cookie", async t => {
  const f = await fixture(t); f.failOnNextProof();
  const response = await f.get("/api/admin/privacy", { headers: f.headers }); assert.equal(response.status, 401); assert.deepEqual(await response.json(), { error: "authentication_required" }); assert.equal(response.headers.get("set-cookie"), null);
});
test("revocation during a submitted body prevents the durable write", async t => {
  const f = await fixture(t), state = await f.service.read(); f.beforeCommit(async () => f.revoke());
  const response = await f.post({ revision: 0, draft: state.draft }); assert.equal(response.status, 401); assert.equal(f.revision(), 0); assert.equal(response.headers.get("set-cookie"), null);
});
test("closing the runtime rejects reads and writes without publication or mutation", async t => {
  const f = await fixture(t), state = await f.service.read(); f.handler.close(); assert.equal((await f.get("/api/admin/privacy", { headers: f.headers })).status, 503); assert.equal((await f.post({ revision: 0, draft: state.draft })).status, 503); assert.equal(f.revision(), 0);
});
test("legacy origin and an unconfigured runtime cannot expose a preparation draft", async t => {
  const f = await fixture(t), server = createAppServer({ privacyHandler: f.handler, requestOrigin: origin, legacyHandlers: { entryHandler: async () => false } });
  await new Promise(done => server.listen(0, "127.0.0.1", done)); t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  for (const path of ["/admin/privacy", "/privacy.js", "/api/admin/privacy"]) {
    const status = await new Promise((yes, no) => { const request = httpRequest({ host: "127.0.0.1", port: server.address().port, path, headers: { Host: "recette.jessiemessage.com", "X-Forwarded-Proto": "https", ...f.headers } }, response => { response.resume(); response.once("end", () => yes(response.statusCode)); }); request.once("error", no); request.end(); });
    assert.equal(status, 404);
  }
  const disabled = createAppServer(); await new Promise(done => disabled.listen(0, "127.0.0.1", done)); t.after(async () => { disabled.closeAllConnections(); await new Promise(done => disabled.close(done)); });
  assert.equal((await fetch(`http://127.0.0.1:${disabled.address().port}/admin/privacy`)).status, 404);
});
