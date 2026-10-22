import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createWitnessTransport } from "../server/backup/witness-transport.mjs";
import { registryHash } from "../server/backup/registry-snapshot.mjs";

const destinationId = "1".repeat(32), registryId = "a".repeat(64), pairedAt = 1792350000000, pairingFingerprint = "d".repeat(64);
const current = { destinationId, pairedAt, pairingFingerprint };
const packet = () => ({ version: 1, registryId, challenge: "b".repeat(64), snapshot: null });
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture(t, authorize) {
  const transport = createWitnessTransport({ ...current, registryId, authorize, pollMilliseconds: 1 });
  t.after(() => transport.close()); return transport;
}
function request(action, { headers: extraHeaders, ...options } = {}) {
  return { url: `/api/backup-copy/witness/${action}`, method: action === "poll" ? "GET" : "POST", complete: action === "poll", destroyed: false,
    headers: { host: "jessiemessage.com", "x-forwarded-proto": "https", "x-jessie-backup": "1", authorization: `Bearer ${"A".repeat(43)}`,
      ...(action === "poll" ? {} : { "content-type": "application/json", "content-length": "2" }), ...extraHeaders },
    rawHeaders: ["Host", "jessiemessage.com"], resume() {}, destroy() { this.destroyed = true; },
    async *[Symbol.asyncIterator]() { yield Buffer.from("{}"); this.complete = true; }, ...options };
}
function response() {
  return Object.assign(new EventEmitter(), { headersSent: false, destroyed: false, status: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    end(bytes) { this.value = JSON.parse(bytes); } });
}

for (const action of ["poll", "response"]) test(`${action} admission includes pending authorization and releases failed requests`, async t => {
  const authorization = deferred(); let calls = 0, reject = true;
  const transport = fixture(t, async () => { calls++; await authorization.promise; if (reject) throw new Error("denied"); return current; });
  const replies = Array.from({ length: 4 }, response), runs = replies.map(reply => transport.handler(request(action), reply));
  assert.equal(calls, 2, "only two requests may enter authorization");
  assert.deepEqual(replies.slice(2).map(reply => reply.status), [429, 429]);
  authorization.resolve(); await Promise.all(runs);
  assert.deepEqual(replies.slice(0, 2).map(reply => reply.status), [503, 503]);
  reject = false;
  const next = response(); await transport.handler(request(action, { method: "DELETE" }), next);
  assert.equal(next.status, 405, "authorization failures must return their reservations");
  assert.equal(calls, 3);
});

test("transfer admission remains bounded during body reads and releases parse failures", async t => {
  const authorization = deferred(), bodies = deferred(), twoReaders = deferred(); let calls = 0, readers = 0, peak = 0;
  const transport = fixture(t, async () => { calls++; await authorization.promise; return current; });
  const pending = transport.exchange(packet()).catch(error => error.code);
  const incoming = () => request("response", { async *[Symbol.asyncIterator]() {
    readers++; peak = Math.max(peak, readers); if (readers === 2) twoReaders.resolve();
    try { await bodies.promise; yield Buffer.from("{}"); } finally { readers--; this.complete = true; }
  } });
  const replies = Array.from({ length: 4 }, response), runs = replies.map(reply => transport.handler(incoming(), reply));
  assert.equal(calls, 2); assert.deepEqual(replies.slice(2).map(reply => reply.status), [429, 429]);
  authorization.resolve(); await twoReaders.promise;
  const extra = response(); await transport.handler(incoming(), extra); assert.equal(extra.status, 429);
  assert.equal(readers, 2); assert.equal(peak, 2);
  bodies.resolve(); await Promise.all(runs); assert.deepEqual(replies.slice(0, 2).map(reply => reply.status), [503, 503]);
  const next = response(); await transport.handler(request("response"), next); assert.equal(next.status, 503, "parse errors release admission");
  transport.close(); assert.equal(await pending, "ERASURE_WITNESS_TRANSPORT");
});

test("poll admission remains reserved after wake while final identity is checked", async t => {
  const finalIdentity = deferred(), bothFinal = deferred(); let calls = 0;
  const transport = fixture(t, async () => { if (++calls > 2) { if (calls === 4) bothFinal.resolve(); await finalIdentity.promise; } return current; });
  const replies = [response(), response()], runs = replies.map(reply => transport.handler(request("poll"), reply));
  const pending = transport.exchange(packet()).catch(error => error.code);
  await bothFinal.promise;
  const extra = response(); await transport.handler(request("poll"), extra); assert.equal(extra.status, 429);
  finalIdentity.resolve(); await Promise.all(runs);
  assert.deepEqual(replies.map(reply => reply.status), [200, 200]); assert.equal(replies.every(reply => reply.value.pending), true);
  const next = response(); await transport.handler(request("poll"), next); assert.equal(next.status, 200);
  transport.close(); assert.equal(await pending, "ERASURE_WITNESS_TRANSPORT");
});

test("early transfer errors release admission without consuming a body", async t => {
  const transport = fixture(t, async () => current);
  let reads = 0;
  for (let index = 0; index < 3; index++) {
    const reply = response();
    await transport.handler(request("response", { headers: { host: "jessiemessage.com", "x-forwarded-proto": "https", "x-jessie-backup": "1",
      authorization: `Bearer ${"A".repeat(43)}`, "content-type": "text/plain" }, async *[Symbol.asyncIterator]() { reads++; } }), reply);
    assert.equal(reply.status, 415);
  }
  assert.equal(reads, 0);
  const expired = response(); await transport.handler(request("response"), expired); assert.equal(expired.status, 409);
});

test("transfer size refusal, read failure and successful replies each return admission", async t => {
  const transport = fixture(t, async () => current), snapshot = { version: 1, registryId, files: [] };
  for (let index = 0; index < 3; index++) {
    const pending = transport.exchange(packet()), polled = response();
    await transport.handler(request("poll"), polled); assert.equal(polled.status, 200);
    const tooLarge = response();
    await transport.handler(request("response", { headers: { "content-length": String(1024 ** 3) } }), tooLarge);
    assert.equal(tooLarge.status, 413);
    const failedRead = response();
    await transport.handler(request("response", { async *[Symbol.asyncIterator]() { throw new Error("synthetic read failure"); } }), failedRead);
    assert.equal(failedRead.status, 503);
    const value = { version: 1, requestId: polled.value.requestId, response: { version: 1, registryId, challenge: polled.value.request.challenge,
      revision: 1, sha256: registryHash(snapshot), snapshot } }, body = Buffer.from(JSON.stringify(value)), recorded = response();
    await transport.handler(request("response", { headers: { "content-length": String(body.length) },
      async *[Symbol.asyncIterator]() { yield body; this.complete = true; } }), recorded);
    assert.equal(recorded.status, 200); assert.deepEqual(await pending, value.response);
  }
});

test("close also terminates transfers still awaiting authorization", async t => {
  const authorization = deferred(), transport = fixture(t, async () => { await authorization.promise; return current; });
  const incoming = [request("response"), request("response")], replies = [response(), response()];
  const runs = incoming.map((value, index) => transport.handler(value, replies[index]));
  transport.close(); assert.equal(incoming.every(value => value.destroyed), true);
  authorization.resolve(); await Promise.all(runs); assert.deepEqual(replies.map(reply => reply.status), [503, 503]);
});
