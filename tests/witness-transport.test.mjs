import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createWitnessTransport } from "../server/backup/witness-transport.mjs";
import { createParentGateway } from "../server/backup/parent-gateway.mjs";
import { createAppServer } from "../server/index.mjs";
import { peerAddress } from "../server/http/peer-address.mjs";
import { registryHash } from "../server/backup/registry-snapshot.mjs";
import { registryWitnessFixture } from "./fixtures/registry-witness.mjs";

const destinationId = "1".repeat(32), registryId = "a".repeat(64), token = "A".repeat(43), pairedAt = 1792350000000, pairingFingerprint = "d".repeat(64);
const empty = { version: 1, registryId, files: [] };
const packet = () => ({ version: 1, registryId, challenge: "b".repeat(64), snapshot: null });
const identity = async value => { if (value !== token) throw new Error("private cause"); return { destinationId, pairedAt, pairingFingerprint }; };
const headers = { Host: "jessiemessage.com", "X-Forwarded-Proto": "https", "X-Jessie-Backup": "1", Authorization: `Bearer ${token}` };
const pause = ms => new Promise(yes => setTimeout(yes, ms));
function wire(port, path, { body, method = body === undefined ? "GET" : "POST", extra = {}, signal } = {}) {
  return new Promise((yes, no) => {
    const outgoing = request({ hostname: "127.0.0.1", port, path, method, headers: { ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extra }, signal }, incoming => {
      const chunks = []; incoming.on("data", x => chunks.push(x)); incoming.on("error", no);
      incoming.on("end", () => { const text = Buffer.concat(chunks).toString(); yes({ status: incoming.statusCode, headers: incoming.headers, value: text ? JSON.parse(text) : null }); });
    }); outgoing.on("error", no); outgoing.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function listen(server) { await new Promise(yes => server.listen(0, "127.0.0.1", yes)); return server.address().port; }
async function close(server) { server.closeAllConnections(); await new Promise(yes => server.close(yes)); }
async function fixture(t, options = {}) {
  const transport = createWitnessTransport({ destinationId, registryId, pairedAt, pairingFingerprint, authorize: identity, pollMilliseconds: 20, ...options });
  const server = createServer(async (q, s) => { if (!await transport.handler(q, s)) { s.writeHead(404); s.end('{}'); } });
  const port = await listen(server); t.after(async () => { transport.close(); await close(server); });
  return { transport, port, poll: () => wire(port, "/api/backup-copy/witness/poll") };
}
function result(value, snapshot = empty) { return { version: 1, requestId: value.requestId,
  response: { version: 1, registryId: snapshot.registryId, challenge: value.request.challenge, revision: 1, sha256: registryHash(snapshot), snapshot } }; }

test("fresh RPC is authenticated, bounded, correlated and never retained after restart", async t => {
  const f = await fixture(t); assert.deepEqual((await f.poll()).value, { version: 1, pending: false });
  const controller = new AbortController(), operation = f.transport.exchange(packet(), { signal: controller.signal });
  const polled = await f.poll(); assert.equal(polled.value.pending, true); assert.equal(polled.headers["cache-control"], "no-store");
  assert.equal(polled.headers["access-control-allow-origin"], undefined); assert.equal(polled.headers["set-cookie"], undefined);
  const body = result(polled.value), stale = { ...body, requestId: "0".repeat(32) };
  assert.equal((await wire(f.port, "/api/backup-copy/witness/response", { body: stale })).status, 503);
  assert.equal((await wire(f.port, "/api/backup-copy/witness/response", { body })).status, 200);
  assert.deepEqual(await operation, body.response);
  assert.equal((await wire(f.port, "/api/backup-copy/witness/response", { body })).status, 409);
  const next = f.transport.exchange(packet(), { signal: controller.signal }); const rejected = assert.rejects(next, { code: "ERASURE_WITNESS_TRANSPORT" }); controller.abort(); await rejected;
  assert.equal((await f.poll()).value.pending, false);
});

test("native authority, headers, URL, revocation and pinned pairing are rechecked", async t => {
  let enabled = true;
  const f = await fixture(t, { authorize: async value => { if (!enabled) throw new Error(); return identity(value); } });
  for (const [extra, status] of [[{ Host: "recette.jessiemessage.com" }, 404], [{ Origin: "https://jessiemessage.com" }, 403], [{ Cookie: "untrusted=1" }, 403],
    [{ "Sec-Fetch-Mode": "cors" }, 403], [{ "X-Jessie-Backup": "0" }, 403], [{ Authorization: "Bearer wrong" }, 401]]) {
    assert.equal((await wire(f.port, "/api/backup-copy/witness/poll", { extra })).status, status);
  }
  assert.equal((await wire(f.port, `/api/backup-copy/witness/poll?token=${token}`)).status, 404);
  const operation = f.transport.exchange(packet()), rejected = assert.rejects(operation, { code: "ERASURE_WITNESS_TRANSPORT" });
  const polled = await f.poll(); enabled = false;
  const response = await wire(f.port, "/api/backup-copy/witness/response", { body: result(polled.value) }); assert.equal(response.status, 503);
  assert.equal(JSON.stringify(response).includes("private cause"), false); f.transport.close(); await rejected;
  const wrong = await fixture(t, { authorize: async () => ({ destinationId, pairedAt: pairedAt + 1, pairingFingerprint }) }); assert.equal((await wrong.poll()).status, 503);
  const replaced = await fixture(t, { authorize: async () => ({ destinationId, pairedAt, pairingFingerprint: "e".repeat(64) }) }); assert.equal((await replaced.poll()).status, 503);
});

test("polls are cancelled on close and a busy/aborted exchange never replaces its predecessor", async t => {
  const f = await fixture(t, { pollMilliseconds: 20000 });
  const polled = f.poll(); await pause(20); f.transport.close(); assert.equal((await polled).status, 503);
  await assert.rejects(f.transport.exchange(packet()), { code: "ERASURE_WITNESS_TRANSPORT" });
  const g = await fixture(t); const controller = new AbortController(); const first = g.transport.exchange(packet(), { signal: controller.signal });
  const rejected = assert.rejects(first, { code: "ERASURE_WITNESS_TRANSPORT" });
  await assert.rejects(g.transport.exchange(packet()), { code: "ERASURE_WITNESS_TRANSPORT" });
  controller.abort(); await rejected;
});

test("parent channel and authenticated core proof survive an actual stopped child listener", async t => {
  const f = await registryWitnessFixture(t, { key: Buffer.alloc(32, 7), binding: { database: "synthetic_rpc", rootFingerprint: "c".repeat(64) } });
  const transport = createWitnessTransport({ destinationId, registryId: f.registryId, pairedAt, pairingFingerprint, authorize: identity, pollMilliseconds: 20 });
  const child = createAppServer({ parentGateway: true, entryHandler: async (q, s) => {
    if (q.url !== "/test") return false; s.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": ["first=1", "second=2"] });
    s.end(JSON.stringify({ peer: peerAddress(q) })); return true;
  } });
  const childPort = await listen(child), reservation = createServer(); const port = await listen(reservation); await close(reservation);
  const gateway = createParentGateway({ port, childPort, control: transport.handler });
  t.after(async () => { transport.close(); await gateway.close(); await close(child); }); await gateway.start();
  const response = await wire(port, "/test", { extra: { "X-Jessie-Parent-Peer": "198.51.100.4", Connection: "x-jessie-parent-peer" } });
  assert.equal(response.status, 200); assert.equal(response.value.peer, "127.0.0.1"); assert.deepEqual(response.headers["set-cookie"], ["first=1", "second=2"]);
  assert.equal((await wire(childPort, "/test")).status, 503);
  await close(child); assert.equal((await wire(port, "/test")).status, 503);
  const gate = f.makeGate({ exchange: transport.exchange });
  const proof = gate.verify(async () => {});
  for (let index = 0; index < 2; index++) {
    const packet = (await wire(port, "/api/backup-copy/witness/poll")).value;
    const response = await f.witness.exchange(packet.request);
    assert.equal((await wire(port, "/api/backup-copy/witness/response", { body: { version: 1, requestId: packet.requestId, response } })).status, 200);
  }
  assert.equal((await proof).witnessRevision, 1);
  assert.equal((await wire(port, "/api/backup-copy/witness/poll")).value.pending, false);
  const pending = transport.exchange({ version: 1, registryId: f.registryId, challenge: "f".repeat(64), snapshot: null });
  const cancelled = assert.rejects(pending, { code: "ERASURE_WITNESS_TRANSPORT" }); await gateway.close(); await cancelled;
});
