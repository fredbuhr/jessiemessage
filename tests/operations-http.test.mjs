import test from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "../server/index.mjs";
import { createOperationsMonitor } from "../server/operations/monitor.mjs";
import { safeOperationsSnapshot } from "../server/operations/dto.mjs";

async function listen(t, options = {}) {
  const server = createAppServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
const snapshot = () => ({ status: "unavailable", database: { state: "starting", checkedAt: null }, workers: [], queues: [], queuesCheckedAt: null });

test("neutral server has liveness but never reports an operational messenger", async (t) => {
  const { base } = await listen(t);
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { status: "ok" });
  const response = await fetch(`${base}/api/ready`);
  assert.equal(response.status, 503); assert.equal(response.headers.get("retry-after"), "15");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "unavailable" });
});

test("public readiness uses only cached state, reflects failures, and never enters private handlers or SQL", async (t) => {
  let queries = 0, failing = false, privateCalls = 0;
  const operations = createOperationsMonitor({ messagingConfigured: true,
    store: { async sample() { queries++; if (failing) throw new Error("SQL password=private"); return { database: true, queues: [] }; } },
    clock: () => 1800000000000, monotonicClock: () => 0 });
  t.after(() => operations.close());
  const { server, base } = await listen(t, { operations,
    authHandler: async (request) => { if (request.url === "/api/health") return false; privateCalls++; throw new Error("must not query"); },
    admission: { enter() { throw new Error("must not admit private work"); } } });
  assert.equal((await fetch(`${base}/api/ready`)).status, 503);
  assert.equal(queries, 0);
  await operations.sampleNow();
  for (let index = 0; index < 12; index++) {
    const response = await fetch(`${base}/api/ready`, { headers: { Cookie: "__Host-jessie_session=untrusted" } });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { status: "ready" });
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(queries, 1); assert.equal(privateCalls, 0);
  failing = true; await operations.sampleNow();
  assert.equal((await fetch(`${base}/api/ready`)).status, 503);
  assert.equal((await fetch(`${base}/api/health`)).status, 200); assert.equal(queries, 2);
  server.beginDrain();
  assert.equal((await fetch(`${base}/api/ready`)).status, 503);
});

test("public readiness rejects mutations/query fields, supports HEAD and strips provider details", async (t) => {
  let reads = 0;
  const { base } = await listen(t, { operations: { publicStatus() { reads++; return { status: "ready", hostname: "private", password: "secret" }; } } });
  const head = await fetch(`${base}/api/ready`, { method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
  const get = await fetch(`${base}/api/ready`); assert.deepEqual(await get.json(), { status: "ready" });
  const invalid = await fetch(`${base}/api/ready?details=1`); assert.equal(invalid.status, 400); await invalid.text();
  const post = await fetch(`${base}/api/ready`, { method: "POST", body: "private" });
  assert.equal(post.status, 405); assert.equal(post.headers.get("allow"), "GET, HEAD"); await post.text();
  assert.equal(reads, 2);
  const unavailable = await listen(t, { operations: { publicStatus() { throw new Error("private configuration"); } } });
  const response = await fetch(`${unavailable.base}/api/ready`); assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "unavailable" });
});

test("private operational projection copies only aggregate metadata and rejects guessed readiness", () => {
  const value = snapshot(); value.password = "secret"; value.database.hostname = "private";
  value.workers.push({ name: "verification", state: "error", lastCompletedAt: null, lastErrorAt: 1800000000000,
    consecutiveFailures: 1, processed: 0, failures: 1, recipientEmail: "private@example.invalid" });
  const result = safeOperationsSnapshot(value);
  assert.doesNotMatch(JSON.stringify(result), /private|secret|password|hostname|recipient/);
  value.workers[0].processed = 88; assert.equal(result.workers[0].processed, 0);
  assert.throws(() => safeOperationsSnapshot({ ...snapshot(), status: "ready" }));
  assert.throws(() => safeOperationsSnapshot({ ...snapshot(), workers: [result.workers[0], result.workers[0]] }));
  assert.throws(() => safeOperationsSnapshot({ ...snapshot(), queuesCheckedAt: NaN }));
  assert.throws(() => safeOperationsSnapshot({ ...snapshot(), queues: [{ name: "verification", pending: { count: 1, truncated: true }, sending: { count: 0, truncated: false }, failed: { count: 0, truncated: false }, oldestDueAt: null }] }));
});
