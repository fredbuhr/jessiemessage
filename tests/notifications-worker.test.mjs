import test from "node:test";
import assert from "node:assert/strict";
import { createNotificationWorker } from "../server/notifications/worker.mjs";

const current = Date.UTC(2026, 9, 16, 20), deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const job = (attempts = 1, suffix = 1) => ({ jobId: Buffer.alloc(16, suffix), leaseToken: Buffer.alloc(16, 2), attempts, expiresAt: current + 86400000 });
function fixture({ jobs = [job()], response = { statusCode: 201, retryAfterSeconds: null }, send, prepare } = {}) {
  const settlements = [], sent = [], events = [], errors = []; let claims = 0;
  const store = {
    async claimDue(input) { claims += 1; assert.deepEqual(input, { now: current, limit: 5, leaseMs: 90000 }); return jobs; },
    async prepareDelivery(input) { return prepare ? prepare(input) : { subscription: { synthetic: true }, locale: "fr", expiresAt: current + 86400000 }; },
    async settleDelivery(input) { settlements.push(input); return true; },
  };
  const transport = { async send(...args) { sent.push(args); return send ? send(...args) : response; } };
  const worker = createNotificationWorker({ store, transport, config: { enabled: true }, clock: () => current, random: () => 0.5,
    onState: (event) => events.push(event), onError: (event) => errors.push(event) });
  return { worker, store, sent, settlements, events, errors, get claims() { return claims; } };
}

test("worker serializes runOnce, claims at most five and sends only generic localized bounded payloads", async () => {
  const gate = deferred(), f = fixture({ send: () => gate.promise });
  const a = f.worker.runOnce(), b = f.worker.runOnce(); assert.equal(a, b);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.claims, 1); assert.equal(f.sent.length, 1);
  const [, payload, options] = f.sent[0], parsed = JSON.parse(payload);
  assert.equal(parsed.url, "/app"); assert.equal(parsed.body, "Un nouveau message t’attend.");
  assert.deepEqual(Object.keys(parsed).sort(), ["body", "language", "tag", "title", "type", "url"]);
  assert.equal(options.ttl, 86400); assert.equal(options.topic, "JessieMessage");
  gate.resolve({ statusCode: 201 }); assert.deepEqual(await a, { sent: 1, failed: 0, deferred: 0, skipped: 0 });
  assert.equal(f.settlements[0].result.status, "accepted"); assert.deepEqual(f.events.map(({ state }) => state), ["running", "idle"]);
  await f.worker.stop();
});

test("role-aware deliveries carry only their opaque job reference and generic copy", async () => {
  for (const role of ["admin", "client"]) {
    const f = fixture({ prepare: async () => ({ subscription: {}, locale: "en", role, expiresAt: current + 86400000 }) });
    await f.worker.runOnce(); const value = JSON.parse(f.sent[0][1]);
    assert.equal(value.role, role); assert.equal(value.notification, job().jobId.toString("hex"));
    assert.equal(value.body, "A new message is waiting for you.");
    assert.doesNotMatch(JSON.stringify(value), /conversationId|messageId|endpoint|password|csrf/);
    await f.worker.stop();
  }
});

test("worker distinguishes permanent subscription removal, provider rejection and bounded retries", async () => {
  for (const [statusCode, expected] of [[201, "accepted"], [204, "accepted"], [404, "invalid_subscription"], [410, "invalid_subscription"], [429, "retry"], [500, "retry"], [503, "retry"], [401, "failed"], [403, "failed"], [413, "failed"], [307, "failed"], [999, "failed"]]) {
    const f = fixture({ response: { statusCode, retryAfterSeconds: 120 } }); const counts = await f.worker.runOnce();
    assert.equal(f.settlements[0].result.status, expected, String(statusCode));
    if (expected === "retry") { assert.equal(f.settlements[0].result.nextAttemptAt, current + 120000); assert.equal(counts.failed, 1); assert.equal(counts.deferred, 1); }
    if ([401, 403].includes(statusCode)) assert.deepEqual(f.errors, [{ code: "NOTIFICATIONS_PROVIDER_AUTH" }]);
    await f.worker.stop();
  }
  for (const retryAfterSeconds of [Infinity, NaN, -100, "120", 1e10]) {
    const f = fixture({ response: { statusCode: 429, retryAfterSeconds } }); await f.worker.runOnce();
    assert.equal(f.settlements[0].result.nextAttemptAt, current + (retryAfterSeconds === 1e10 ? 3600000 : 15000)); await f.worker.stop();
  }
});

test("network retry stops after six claims or expiry, while skipped/read/obsolete jobs send nothing", async () => {
  const f = fixture({ jobs: [job(6)], send: () => { throw new Error("sensitive-error"); } });
  assert.deepEqual(await f.worker.runOnce(), { sent: 0, failed: 1, deferred: 0, skipped: 0 });
  assert.deepEqual(f.errors, [{ code: "NOTIFICATIONS_DELIVERY_FAILED" }]); await f.worker.stop();
  const expiring = fixture({ jobs: [{ ...job(), expiresAt: current + 10000 }], response: { statusCode: 503 } });
  await expiring.worker.runOnce(); assert.equal(expiring.settlements[0].result.status, "failed"); await expiring.worker.stop();
  const skipped = fixture({ prepare: async () => null });
  assert.deepEqual(await skipped.worker.runOnce(), { sent: 0, failed: 0, deferred: 0, skipped: 1 });
  assert.equal(skipped.sent.length, 0); assert.equal(skipped.settlements.length, 0); await skipped.worker.stop();
  const stale = fixture(); stale.store.settleDelivery = async () => false;
  assert.deepEqual(await stale.worker.runOnce(), { sent: 0, failed: 0, deferred: 0, skipped: 0 }); await stale.worker.stop();
});

test("shutdown releases unstarted claims without consuming attempts and cannot start another request", async () => {
  const gate = deferred(), f = fixture({ jobs: [job(6), job(1, 2)], prepare: () => gate.promise });
  const running = f.worker.runOnce(); await new Promise((resolve) => setImmediate(resolve));
  const stopping = f.worker.stop(); assert.equal(stopping, f.worker.stop());
  gate.resolve({ subscription: {}, locale: "fr", expiresAt: current + 86400000 });
  await stopping; await running; assert.equal(f.sent.length, 0);
  assert.deepEqual(f.settlements.map(({ result }) => result), [{ status: "release", nextAttemptAt: current }, { status: "release", nextAttemptAt: current }]);
  await assert.rejects(f.worker.runOnce(), { code: "NOTIFICATIONS_WORKER_FAILED" });
  assert.throws(() => f.worker.start(), { code: "NOTIFICATIONS_WORKER_FAILED" });
});

test("shutdown aborts an in-flight transport and applies normal backoff to its uncertain result", async () => {
  const began = deferred(), f = fixture({ jobs: [job(), job(1, 2)], send: (_subscription, _payload, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); began.resolve();
  }) });
  const running = f.worker.runOnce(); await began.promise; await f.worker.stop(); await running;
  assert.equal(f.sent.length, 1);
  assert.deepEqual(f.settlements.map(({ result }) => result), [{ status: "retry", nextAttemptAt: current + 15000 }, { status: "release", nextAttemptAt: current }]);
});

test("observer failures cannot break delivery and infrastructure failures are sanitized", async () => {
  const events = [], worker = createNotificationWorker({ store: { async claimDue() { throw new Error("secret endpoint"); }, async prepareDelivery() {}, async settleDelivery() {} },
    transport: { async send() {} }, config: { enabled: true }, clock: () => current,
    onState: () => Promise.reject(new Error("observer")), onEvent: (event) => events.push(event), onError: () => { throw new Error("observer"); } });
  await assert.rejects(worker.runOnce(), (error) => { assert.equal(error.code, "NOTIFICATIONS_WORKER_FAILED"); assert.equal(error.cause, undefined); assert.equal(error.message.includes("endpoint"), false); return true; });
  assert.deepEqual(events.map(({ state }) => state), ["running", "error"]); await worker.stop();
});

test("terminal-job cleanup is bounded, infrequent and an observed failure does not undo delivery", async () => {
  let time = current, cleanups = 0;
  const errors = [], store = { async claimDue() { return []; }, async prepareDelivery() {}, async settleDelivery() {},
    async cleanup(input) { cleanups += 1; assert.equal(input.limit, 100); throw new Error("sensitive database detail"); } };
  const worker = createNotificationWorker({ store, transport: { async send() {} }, config: { enabled: true }, clock: () => time, onError: (event) => errors.push(event) });
  await worker.runOnce(); await worker.runOnce(); assert.equal(cleanups, 1);
  time += 300000; await worker.runOnce(); assert.equal(cleanups, 2);
  assert.deepEqual(errors, [{ code: "NOTIFICATIONS_CLEANUP_FAILED" }, { code: "NOTIFICATIONS_CLEANUP_FAILED" }]);
  await worker.stop();
});

test("reentrant observers see one run and one stop promise without starting SQL after stop", async () => {
  let worker, claims = 0, runningStates = 0, stoppingStates = 0;
  const workerOptions = { store: { async claimDue() { claims += 1; return []; }, async prepareDelivery() {}, async settleDelivery() {} },
    transport: { async send() {} }, config: { enabled: true }, clock: () => current,
    onState(event) {
      if (event.state === "running") { runningStates += 1; void worker.runOnce(); void worker.stop(); }
      if (event.state === "stopping") { stoppingStates += 1; void worker.stop(); }
    } };
  worker = createNotificationWorker(workerOptions);
  await worker.runOnce(); await worker.stop();
  assert.equal(claims, 0); assert.equal(runningStates, 1); assert.equal(stoppingStates, 1);
});
