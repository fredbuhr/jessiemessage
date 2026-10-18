import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { createClosureService } from "../server/data/closure-service.mjs";
import { createClosureHandler, disabledClosureService } from "../server/data/closure-http.mjs";
import { createErasureJournal, readErasureJournalBatch } from "../server/data/erasure-journal.mjs";
import { AccountErasureError } from "../server/data/erasure-state.mjs";
import { createAppServer } from "../server/index.mjs";
import { erasureDirectory, withErasureDirectory } from "./fixtures/erasure-files.mjs";

const origin = "https://jessiemessage.com", clientId = "2".repeat(32), adminId = "1".repeat(32);
const token = Buffer.alloc(32, 1).toString("base64url"), csrf = Buffer.alloc(32, 2).toString("base64url");
const binding = { database: "jessiemessage_test_closure", rootFingerprint: "a".repeat(64) }, key = Buffer.alloc(32, 8);
const endpoint = `/api/admin/closures/clients/${clientId}`, now = Date.UTC(2026, 9, 18);
const payload = { confirmation: "FERMER", expectedPseudonym: "Synthetic private client" };
async function fixture(t, { disabled = false } = {}) {
  const directory = await erasureDirectory(t), internal = { withDirectory: withErasureDirectory };
  let authorized = true, role = "admin", actorCalls = 0, failAt = Infinity, inspections = 0, inspectionError = null, name = payload.expectedPseudonym;
  const journalFor = id => createErasureJournal({ directory, binding, key, clientId: id }, internal);
  const service = disabled ? disabledClosureService() : createClosureService({ directory, key, clock: () => now,
    store: { binding, async withLease(id, work) { assert.equal(id, clientId); return work({ async inspect() { inspections++; if (inspectionError) throw inspectionError; } }); } },
    target: async id => { if (id !== clientId) throw new AccountErasureError("ERASURE_TARGET"); return { id, pseudonym: name, status: "active" }; },
  }, { journalFor, batch: page => readErasureJournalBatch({ directory, key, binding, ...page }, internal) });
  const actor = async value => {
    actorCalls++; return authorized && actorCalls < failAt && value === token ? { user: { id: adminId, role, pseudonym: "Synthetic admin" }, csrf, expiresAt: Date.now() + 3600000 } : null;
  };
  const handler = createClosureHandler(service, { origin, actor }), server = createServer(async (request, response) => {
    if (!await handler(request, response)) { response.writeHead(404); response.end(); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  t.after(async () => { handler.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); });
  const headers = { Cookie: `__Host-jessie_session=${token}`, Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf };
  const get = (route, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${route}`, options);
  const post = (body = payload, extra = {}) => get(endpoint, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  const record = async () => { const journal = journalFor(clientId); try { return await journal.read(); } finally { journal.close(); } };
  return { directory, journalFor, handler, service, get, post, headers, record, inspections: () => inspections,
    failInspection: () => { inspectionError = new AccountErasureError("ERASURE_BINDING"); }, rename: () => { name = "Changed elsewhere"; },
    revoke: () => { authorized = false; }, client: () => { role = "client"; }, failAtProof: offset => { failAt = actorCalls + offset; } };
}

test("closure preview, list and all private assets require an admin and never create an intent", async t => {
  const f = await fixture(t);
  for (const route of ["/admin/closures", "/closures.js", "/closures.css", "/i18n-closures.js", "/api/admin/closures", endpoint]) {
    const anonymous = await f.get(route); assert.equal(anonymous.status, 401); assert.equal(anonymous.headers.get("set-cookie"), null);
    const response = await f.get(route, { headers: f.headers }); assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("access-control-allow-origin"), null); await response.arrayBuffer();
  }
  assert.equal(f.inspections(), 0); assert.equal((await f.record()).record, null); assert.deepEqual(await readdir(f.directory), []);
  f.client(); assert.equal((await f.get(endpoint, { headers: f.headers })).status, 401);
});

test("an explicit confirmation writes an encrypted intent once, with no destructive store method", async t => {
  const f = await fixture(t), response = await f.post(); assert.equal(response.status, 202);
  assert.equal((await response.json()).closure.phase, "requested"); assert.equal(f.inspections(), 1);
  const first = await f.record(); assert.equal(first.revision, 1); assert.equal(first.record.phase, "requested");
  const duplicate = await f.post(); assert.equal(duplicate.status, 202); assert.equal(f.inspections(), 1); assert.deepEqual(await f.record(), first);
  const files = await readdir(f.directory); assert.equal(files.length, 1);
  const bytes = await readFile(path.join(f.directory, files[0]), "utf8");
  for (const privateText of [clientId, payload.expectedPseudonym, token, csrf, "confirmation", "adminId"]) assert.equal(bytes.includes(privateText), false);
  const list = await (await f.get("/api/admin/closures", { headers: f.headers })).json(); assert.equal(list.enabled, true); assert.equal(list.jobs[0].clientId, clientId);
});

test("missing confirmation, renamed target, unexpected fields and oversized input cannot enqueue", async t => {
  const f = await fixture(t);
  for (const body of [{ ...payload, confirmation: "YES" }, { ...payload, allAccounts: true }, { confirmation: "FERMER" }, [], null]) assert.equal((await f.post(body)).status, 400);
  assert.equal((await f.post({ ...payload, expectedPseudonym: "x".repeat(1025) })).status, 413);
  f.rename(); assert.equal((await f.post()).status, 409); assert.equal((await f.record()).record, null);
});

test("mutation origin, CSRF, fetch metadata and content type precede every durable intent", async t => {
  const f = await fixture(t);
  for (const [headers, expected] of [[{ Origin: "https://other.invalid" }, 403], [{ "Sec-Fetch-Site": "cross-site" }, 403], [{ "X-CSRF-Token": "wrong" }, 403], [{ "Content-Type": "text/plain" }, 415], [{ Cookie: "" }, 401]]) assert.equal((await f.post(payload, headers)).status, expected);
  assert.equal(f.inspections(), 0); assert.equal((await f.record()).record, null);
});

test("revoked proof at the publication boundary prevents a durable request", async t => {
  const f = await fixture(t); f.failAtProof(3);
  const response = await f.post(); assert.equal(response.status, 401); assert.equal(response.headers.get("set-cookie"), null); assert.equal((await f.record()).record, null);
});

test("a lost final proof leaves the authorized intent discoverable and never repeats SQL", async t => {
  const f = await fixture(t); f.failAtProof(4);
  const response = await f.post(); assert.equal(response.status, 401); assert.equal(response.headers.get("set-cookie"), null);
  assert.equal((await f.record()).record.phase, "requested"); assert.equal(f.inspections(), 1);
});

test("preparation failure does not manufacture acceptance, and safe errors expose no diagnostic text", async t => {
  const f = await fixture(t); f.failInspection();
  const response = await f.post(); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "closure_unavailable" }); assert.equal((await f.record()).record, null);
});

test("disabled production service exposes status but rejects every request without a journal", async t => {
  const f = await fixture(t, { disabled: true });
  const list = await (await f.get("/api/admin/closures", { headers: f.headers })).json(); assert.deepEqual(list, { version: 1, enabled: false, jobs: [], nextCursor: null });
  assert.equal((await f.post()).status, 503); assert.equal((await f.record()).record, null);
});

test("query confusion, unsupported methods, unknown client and closing are rejected", async t => {
  const f = await fixture(t);
  for (const route of [endpoint + "?confirm=FERMER", "/api/admin/closures?afterName=x", "/api/admin/closures?afterName=x&afterName=y", "/admin/closures?client=" + clientId + "&client=" + clientId]) assert.equal((await f.get(route, { headers: f.headers })).status, 400);
  assert.equal((await f.get("/admin/closures?client=" + clientId, { method: "HEAD", headers: f.headers })).status, 200);
  assert.equal((await f.get(endpoint, { method: "HEAD", headers: f.headers })).status, 405);
  assert.equal((await f.get(`/api/admin/closures/clients/${adminId}`, { headers: f.headers })).status, 404);
  assert.equal((await f.record()).record, null); f.handler.close(); assert.equal((await f.post()).status, 503);
});

test("legacy authority and an unconfigured server cannot access closure data or assets", async t => {
  const f = await fixture(t), server = createAppServer({ closureHandler: f.handler, authHandler: async () => false, requestOrigin: origin, legacyHandlers: { entryHandler: async () => false } });
  await new Promise(done => server.listen(0, "127.0.0.1", done)); t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  for (const route of ["/admin/closures", "/closures.js", "/api/admin/closures", endpoint]) {
    const status = await new Promise((yes, no) => { const request = httpRequest({ host: "127.0.0.1", port: server.address().port, path: route,
      headers: { Host: "recette.jessiemessage.com", "X-Forwarded-Proto": "https", ...f.headers } }, response => { response.resume(); response.once("end", () => yes(response.statusCode)); }); request.once("error", no); request.end(); });
    assert.equal(status, 404);
  }
  const redirect = await f.get("/admin/closures", { headers: { Accept: "text/html" }, redirect: "manual" }); assert.equal(redirect.status, 401); // Bare handler never performs a login action.
  const disabled = createAppServer(); await new Promise(done => disabled.listen(0, "127.0.0.1", done)); t.after(async () => { disabled.closeAllConnections(); await new Promise(done => disabled.close(done)); });
  assert.equal((await fetch(`http://127.0.0.1:${disabled.address().port}/admin/closures`)).status, 404);
});
