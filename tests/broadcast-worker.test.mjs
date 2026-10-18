import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { createBroadcastWorker, BroadcastWorkerError } from "../server/broadcast/worker.mjs";
import { sealPayload } from "../server/broadcast/crypto.mjs";
import { decryptMessageBody, messageFingerprint } from "../server/chat/crypto.mjs";

const now = 1750000000000;
const invalid = (error) => error instanceof BroadcastWorkerError && error.code === "BROADCAST_WORKER_FAILED";
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function fixture({ photo = false, batchSize = 5 } = {}) {
  const key = randomBytes(32), calls = [], rates = [], state = { queue: [], budgets: [], failResult: true, deliverResult: { delivered: true, duplicate: false }, clock: now };
  const job = { campaignId: randomBytes(16), adminId: randomBytes(16), mfaVersion: 5, conversationId: randomBytes(16), clientId: randomBytes(16),
    messageId: randomBytes(16), clientMessageId: randomBytes(16), leaseToken: randomBytes(16), mediaId: photo ? randomBytes(16) : null, allowRepeatMedia: false };
  const payload = { title: "Une diffusion privée", body: photo ? "Une photo" : "  Bonjour exact\n<b>texte</b>  ", mediaId: job.mediaId?.toString("hex") ?? null,
    allowRepeatMedia: false, conversationIds: [job.conversationId.toString("hex")] };
  job.payloadEncrypted = sealPayload(payload, key, { campaignId: job.campaignId, adminId: job.adminId });
  state.queue.push(job);
  const store = {
    claim: async (options) => { calls.push({ name: "claim", options }); if (state.claimError) throw state.claimError;
      if (state.claimBarrier) await state.claimBarrier.promise; return state.queue.shift() ?? null; },
    deliver: async (currentJob, options) => { calls.push({ name: "deliver", job: currentJob, options });
      if (state.deliverBarrier) await state.deliverBarrier.promise;
      if (state.deliverError) throw state.deliverError; return state.deliverResult; },
    defer: async (currentJob, options) => { calls.push({ name: "defer", job: currentJob, options }); return true; },
    fail: async (currentJob, options) => { calls.push({ name: "fail", job: currentJob, options }); if (state.failError) throw state.failError; return state.failResult; },
  };
  const authStore = { consumeRateLimit: async (bucket, options) => { rates.push({ bucket, options }); if (state.rateError) throw state.rateError; return state.budgets.shift() ?? { allowed: true }; } };
  const options = { store, authStore, key, batchSize, clock: () => state.clock };
  return { key, job, payload, state, calls, rates, store, authStore, options, worker: createBroadcastWorker(options) };
}

test("broadcast worker validates configuration and exposes immutable lifecycle methods", () => {
  const f = fixture();
  for (const key of [undefined, null, "key", Buffer.alloc(31), Buffer.alloc(33), new Uint8Array(32)]) assert.throws(() => createBroadcastWorker({ ...f.options, key }), invalid);
  for (const method of Object.keys(f.store)) assert.throws(() => createBroadcastWorker({ ...f.options, store: { ...f.store, [method]: undefined } }), invalid);
  for (const changes of [{ clock: null }, { authStore: null }, { pollMilliseconds: 999 }, { pollMilliseconds: 300001 }, { pollMilliseconds: 1000.5 }, { batchSize: 0 }, { batchSize: 21 }]) {
    assert.throws(() => createBroadcastWorker({ ...f.options, ...changes }), invalid);
  }
  assert.ok(Object.isFrozen(f.worker));
});

test("worker delivers ordinary text bound to durable message IDs without exposing campaign data to chat", async () => {
  const f = fixture(), result = await f.worker.runOnce();
  assert.deepEqual(result, { delivered: 1, deferred: 0, failed: 0 });
  const command = f.calls.find((call) => call.name === "deliver");
  assert.equal(command.job, f.job); assert.equal(command.options.now, now);
  const message = command.options.message, binding = { messageId: f.job.messageId, conversationId: f.job.conversationId, senderId: f.job.adminId };
  assert.deepEqual(message.id, f.job.messageId); assert.deepEqual(message.clientMessageId, f.job.clientMessageId);
  assert.equal(decryptMessageBody(message.bodyEncrypted, f.key, binding), f.payload.body);
  assert.deepEqual(message.bodyFingerprint, messageFingerprint(f.payload.body, f.key, binding));
  assert.deepEqual(Object.keys(message).sort(), ["bodyEncrypted", "bodyFingerprint", "clientMessageId", "id"]);
  assert.equal(f.calls.some((call) => ["fail", "defer"].includes(call.name)), false);
});

test("worker photo delivery uses ordinary chat media encoding and stable asset identity", async () => {
  const f = fixture({ photo: true });
  assert.deepEqual(await f.worker.runOnce(), { delivered: 1, deferred: 0, failed: 0 });
  const message = f.calls.find((call) => call.name === "deliver").options.message;
  assert.deepEqual(message.mediaId, f.job.mediaId);
  const body = decryptMessageBody(message.bodyEncrypted, f.key, { messageId: f.job.messageId, conversationId: f.job.conversationId, senderId: f.job.adminId });
  assert.deepEqual(JSON.parse(body), { mediaId: f.job.mediaId.toString("hex"), caption: f.payload.body });
  assert.equal(body.includes(f.payload.title), false); assert.equal(body.includes("conversationIds"), false);
});

test("worker reuses the exact normal chat global and administrator send buckets", async () => {
  const f = fixture(); await f.worker.runOnce();
  assert.equal(f.rates.length, 2);
  const expected = [["global-send", "all", 300], ["user-send", f.job.adminId.toString("hex"), 30]];
  for (const [index, [name, identity, limit]] of expected.entries()) {
    assert.deepEqual(f.rates[index].bucket, createHmac("sha256", f.key).update("jessiemessage:chat-rate:v1:").update(name).update("\0").update(identity).digest());
    assert.deepEqual(f.rates[index].options, { now, windowSeconds: 60, limit });
  }
});

test("worker rate limits defer durable jobs without burning a processing attempt", async () => {
  for (const [budget, seconds] of [[{ allowed: false, retryAfter: 17.2 }, 18], [{ allowed: false, retryAfter: 0 }, 1], [{ allowed: false, retryAfter: 7200 }, 3600], [{ allowed: false, retryAfter: Infinity }, 60]]) {
    const f = fixture(); f.state.budgets = [budget];
    assert.deepEqual(await f.worker.runOnce(), { delivered: 0, deferred: 1, failed: 0 });
    assert.deepEqual(f.calls.find((call) => call.name === "defer").options, { now, availableAt: now + seconds * 1000 });
    assert.equal(f.rates.length, 1); assert.equal(f.calls.some((call) => ["deliver", "fail"].includes(call.name)), false);
  }
  const f = fixture(); f.state.budgets = [{ allowed: true }, { allowed: false, retryAfter: 5 }];
  assert.deepEqual(await f.worker.runOnce(), { delivered: 0, deferred: 1, failed: 0 }); assert.equal(f.rates.length, 2);
});

test("worker rejects corrupt payloads and cross-recipient or media mismatches before send budgets", async () => {
  for (const change of ["cipher", "recipient", "media", "repeat", "messageId"]) {
    const f = fixture();
    if (change === "cipher") f.job.payloadEncrypted = "private-corrupted-payload";
    if (change === "recipient") f.job.conversationId = randomBytes(16);
    if (change === "media") f.job.mediaId = randomBytes(16);
    if (change === "repeat") f.job.allowRepeatMedia = true;
    if (change === "messageId") f.job.messageId = Buffer.alloc(15);
    assert.deepEqual(await f.worker.runOnce(), { delivered: 0, deferred: 0, failed: 1 });
    assert.equal(f.rates.length, 0); assert.equal(f.calls.some((call) => call.name === "deliver"), false);
    const failure = f.calls.find((call) => call.name === "fail"); assert.deepEqual(failure.options, { now });
  }
});

test("lost delivery acknowledgement delegates to lease CAS and does not count an already committed delivery as failed", async () => {
  const f = fixture(); f.state.deliverError = new Error("SQL private-secret after committed message"); f.state.failResult = false;
  assert.deepEqual(await f.worker.runOnce(), { delivered: 0, deferred: 0, failed: 0 });
  const calls = f.calls.filter((call) => ["deliver", "fail"].includes(call.name));
  assert.deepEqual(calls.map((call) => call.name), ["deliver", "fail"]);
  assert.equal(calls[0].job, calls[1].job); assert.deepEqual(calls[1].options, { now });
});

test("cancelled or revoked recipients reported by delivery are harmless no-ops", async () => {
  const f = fixture(); f.state.deliverResult = { delivered: false };
  assert.deepEqual(await f.worker.runOnce(), { delivered: 0, deferred: 0, failed: 0 });
  assert.equal(f.calls.some((call) => call.name === "fail"), false);
});

test("processing failures and malformed rate responses persist only fixed failure metadata", async () => {
  for (const source of ["quota", "delivery", "malformed-result", "malformed-budget"]) {
    const f = fixture();
    if (source === "quota") f.state.rateError = new Error("SQL password=private-secret");
    if (source === "delivery") f.state.deliverError = new Error("SQL password=private-secret");
    if (source === "malformed-result") f.state.deliverResult = { delivered: "true" };
    if (source === "malformed-budget") f.state.budgets = [{ allowed: "true" }];
    assert.deepEqual(await f.worker.runOnce(), { delivered: 0, deferred: 0, failed: 1 });
    const failure = f.calls.find((call) => call.name === "fail"); assert.deepEqual(failure.options, { now });
    assert.equal(JSON.stringify(failure).includes("private-secret"), false);
  }
});

test("concurrent runOnce calls share one bounded batch and stop waits for the active delivery", async () => {
  const f = fixture({ batchSize: 1 }); f.state.deliverBarrier = deferred();
  const first = f.worker.runOnce(), second = f.worker.runOnce();
  assert.equal(first, second);
  while (!f.calls.some((call) => call.name === "deliver")) await new Promise((resolve) => setImmediate(resolve));
  let stopped = false; const stop = f.worker.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(stopped, false);
  f.state.deliverBarrier.resolve();
  assert.deepEqual(await first, { delivered: 1, deferred: 0, failed: 0 }); await stop;
  assert.equal(stopped, true); assert.equal(f.calls.filter((call) => call.name === "claim").length, 1);
  await assert.rejects(f.worker.runOnce(), invalid); assert.throws(() => f.worker.start(), invalid);
});

test("batches stay sequential and bounded while retries retain durable IDs", async () => {
  const f = fixture({ batchSize: 2 }); f.state.queue = [f.job, f.job, f.job];
  assert.deepEqual(await f.worker.runOnce(), { delivered: 2, deferred: 0, failed: 0 }); assert.equal(f.state.queue.length, 1);
  const messages = f.calls.filter((call) => call.name === "deliver").map((call) => call.options.message);
  assert.deepEqual(messages[0].id, messages[1].id); assert.deepEqual(messages[0].clientMessageId, messages[1].clientMessageId);
  assert.deepEqual(messages[0].bodyFingerprint, messages[1].bodyFingerprint);
  assert.notEqual(messages[0].bodyEncrypted, messages[1].bodyEncrypted);
});

test("worker holds a private key copy and lifecycle shutdown clears an unstarted timer", async () => {
  const f = fixture(), originalKey = Buffer.from(f.key); f.key.fill(0);
  assert.deepEqual(await f.worker.runOnce(), { delivered: 1, deferred: 0, failed: 0 });
  const message = f.calls.find((call) => call.name === "deliver").options.message;
  assert.equal(decryptMessageBody(message.bodyEncrypted, originalKey, { messageId: f.job.messageId, conversationId: f.job.conversationId, senderId: f.job.adminId }), f.payload.body);
  const unused = fixture(); unused.worker.start(); unused.worker.start(); await unused.worker.stop(); await unused.worker.stop();
  assert.equal(unused.calls.length, 0);
});

test("claim, failure storage and invalid clock exceptions are replaced by neutral worker errors", async () => {
  for (const source of ["claim", "fail", "clock"]) {
    const f = fixture();
    if (source === "claim") f.state.claimError = new Error("SQL password=private-secret");
    if (source === "fail") { f.state.deliverError = new Error("private failure"); f.state.failError = new Error("SQL password=private-secret"); }
    if (source === "clock") f.state.clock = NaN;
    await assert.rejects(f.worker.runOnce(), (error) => {
      assert.ok(invalid(error)); assert.equal(error.message.includes("private-secret"), false); assert.equal(error.cause, undefined); return true;
    });
  }
});

test("stop during claim cannot start a delivery or spend quotas and immediately returns the durable lease", async () => {
  const f = fixture(); f.state.claimBarrier = deferred(); f.state.queue.push(f.job);
  const active = f.worker.runOnce(); assert.equal(f.calls.filter((call) => call.name === "claim").length, 1);
  let stopped = false; const stopping = f.worker.stop(); assert.equal(f.worker.stop(), stopping); stopping.then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve)); assert.equal(stopped, false);
  f.state.claimBarrier.resolve(); assert.deepEqual(await active, { delivered: 0, deferred: 1, failed: 0 }); await stopping;
  assert.equal(stopped, true); assert.equal(f.state.queue.length, 1); assert.equal(f.rates.length, 0);
  assert.deepEqual(f.calls.map((call) => call.name), ["claim", "defer"]);
  assert.equal(f.calls[1].job, f.job); assert.deepEqual(f.calls[1].options, { now, availableAt: now }); await assert.rejects(f.worker.runOnce(), invalid);
});

test("stop during job one's delivery drains that job without claiming the next queued recipient", async () => {
  const f = fixture(); f.state.queue.push(f.job); f.state.deliverBarrier = deferred();
  const active = f.worker.runOnce();
  while (!f.calls.some((call) => call.name === "deliver")) await new Promise((resolve) => setImmediate(resolve));
  const stopping = f.worker.stop(); assert.equal(f.worker.stop(), stopping); f.state.deliverBarrier.resolve(); await stopping;
  assert.deepEqual(await active, { delivered: 1, deferred: 0, failed: 0 }); assert.equal(f.state.queue.length, 1);
  assert.equal(f.calls.filter((call) => call.name === "claim").length, 1); assert.equal(f.calls.filter((call) => call.name === "deliver").length, 1);
});

test("stop while an asynchronous quota is pending cannot begin delivery or charge a processing failure", async () => {
  for (const reject of [false, true]) {
    const f = fixture(), gate = deferred(); let rejectQuota;
    const pending = reject ? new Promise((resolve, no) => { rejectQuota = no; }) : gate.promise;
    const worker = createBroadcastWorker({ ...f.options, authStore: { consumeRateLimit: async () => pending } });
    const active = worker.runOnce(); await new Promise((resolve) => setImmediate(resolve)); const stopping = worker.stop();
    if (reject) rejectQuota(new Error("private SQL details during stop")); else gate.resolve({ allowed: true });
    assert.deepEqual(await active, { delivered: 0, deferred: 1, failed: 0 }); await stopping;
    assert.deepEqual(f.calls.map((call) => call.name), ["claim", "defer"]);
    assert.equal(f.calls[1].job, f.job); assert.deepEqual(f.calls[1].options, { now, availableAt: now });
  }
});


test("stop after either quota result returns the unstarted lease once before any later quota or delivery", async () => {
  for (const stopAfter of [1, 2]) {
    const f = fixture(); let quotaCalls = 0, worker;
    worker = createBroadcastWorker({ ...f.options, authStore: { async consumeRateLimit() {
      quotaCalls += 1; if (quotaCalls === stopAfter) void worker.stop(); return { allowed: true };
    } } });
    assert.deepEqual(await worker.runOnce(), { delivered: 0, deferred: 1, failed: 0 }); await worker.stop();
    assert.equal(quotaCalls, stopAfter); assert.deepEqual(f.calls.map((call) => call.name), ["claim", "defer"]);
    assert.equal(f.calls[1].job, f.job); assert.deepEqual(f.calls[1].options, { now, availableAt: now });
  }
});

test("an ambiguous started delivery is never deferred or refunded during stop", async () => {
  const f = fixture(); let worker;
  worker = createBroadcastWorker({ ...f.options, store: { ...f.store, async deliver(job, options) {
    f.calls.push({ name: "deliver", job, options }); void worker.stop(); throw new Error("private SQL acknowledgement lost");
  } } });
  f.state.failResult = false;
  assert.deepEqual(await worker.runOnce(), { delivered: 0, deferred: 0, failed: 0 }); await worker.stop();
  assert.deepEqual(f.calls.map((call) => call.name), ["claim", "deliver", "fail"]);
});

test("an unstarted lease return failure is attempted once and cannot turn shutdown into a processing failure", async () => {
  const f = fixture(); let worker, returnCalls = 0;
  worker = createBroadcastWorker({ ...f.options,
    authStore: { async consumeRateLimit() { void worker.stop(); return { allowed: true }; } },
    store: { ...f.store, async defer() { returnCalls += 1; throw new Error("private SQL lease return result unknown"); } },
  });
  await assert.rejects(worker.runOnce(), invalid); await worker.stop();
  assert.equal(returnCalls, 1); assert.deepEqual(f.calls.map((call) => call.name), ["claim"]);
});

test("worker observations report every completed loop, including empty queues, with fixed frozen aggregate counts", async () => {
  const f = fixture(), events = [];
  const worker = createBroadcastWorker({ ...f.options, onState: (event) => { events.push(event); } });
  assert.deepEqual(await worker.runOnce(), { delivered: 1, deferred: 0, failed: 0 });
  assert.deepEqual(await worker.runOnce(), { delivered: 0, deferred: 0, failed: 0 });
  assert.deepEqual(events, [
    { state: "running" }, { state: "idle", counts: { delivered: 1, deferred: 0, failed: 0, errors: 0 } },
    { state: "running" }, { state: "idle", counts: { delivered: 0, deferred: 0, failed: 0, errors: 0 } },
  ]);
  for (const event of events) { assert.ok(Object.isFrozen(event)); if (event.counts) assert.ok(Object.isFrozen(event.counts)); }
  const stop = worker.stop(); assert.equal(worker.stop(), stop); await stop;
  assert.deepEqual(events.slice(-2), [{ state: "stopping" }, { state: "stopped" }]);
  assert.equal(events.filter((event) => event.state === "stopped").length, 1);
});

test("caught processing failures degrade telemetry even when an ambiguous commit preserves delivery counters", async () => {
  for (const failureRecorded of [true, false]) {
    const f = fixture(), events = [], errors = [];
    f.state.deliverError = new Error("private recipient and SQL acknowledgement details"); f.state.failResult = failureRecorded;
    const worker = createBroadcastWorker({ ...f.options, onState: (event) => events.push(event), onError: (event) => errors.push(event) });
    assert.deepEqual(await worker.runOnce(), { delivered: 0, deferred: 0, failed: failureRecorded ? 1 : 0 });
    assert.deepEqual(events.at(-1), { state: "idle", counts: { delivered: 0, deferred: 0, failed: failureRecorded ? 1 : 0, errors: 1 } });
    assert.deepEqual(errors, []); assert.equal(JSON.stringify(events).includes("private"), false);
    await worker.runOnce();
    assert.deepEqual(events.at(-1), { state: "idle", counts: { delivered: 0, deferred: 0, failed: 0, errors: 0 } });
    await worker.stop();
  }
});

test("fatal loop observations and legacy error callbacks contain only a fixed code and recover on the next batch", async () => {
  const f = fixture(), events = [], errors = [];
  f.state.claimError = new Error("private account SMTP SQL credential");
  const worker = createBroadcastWorker({ ...f.options, onState: (event) => events.push(event), onError: (event) => errors.push(event) });
  await assert.rejects(worker.runOnce(), invalid);
  assert.deepEqual(events, [{ state: "running" }, { state: "error", code: "BROADCAST_WORKER_FAILED" }]);
  assert.deepEqual(errors, [{ code: "BROADCAST_WORKER_FAILED" }]); assert.ok(Object.isFrozen(errors[0]));
  delete f.state.claimError; await worker.runOnce();
  assert.deepEqual(events.at(-1), { state: "idle", counts: { delivered: 1, deferred: 0, failed: 0, errors: 0 } });
  await worker.stop();
});

test("observer exceptions, rejected promises and reentrant stop cannot disrupt delivery or leak unhandled rejection", async () => {
  for (const mode of ["throw", "reject", "thenable"]) {
    const f = fixture(); let observations = 0;
    const callback = () => { observations += 1; if (mode === "throw") throw new Error("private observer");
      if (mode === "reject") return Promise.reject(new Error("private observer")); return { then() { throw new Error("private observer"); } }; };
    const worker = createBroadcastWorker({ ...f.options, onState: callback, onError: callback });
    assert.deepEqual(await worker.runOnce(), { delivered: 1, deferred: 0, failed: 0 });
    f.state.claimError = new Error("private SQL"); await assert.rejects(worker.runOnce(), invalid); await worker.stop();
    await new Promise((resolve) => setImmediate(resolve)); assert.equal(observations, 7);
  }
  const f = fixture(), events = []; let worker;
  worker = createBroadcastWorker({ ...f.options, onState(event) { events.push(event); if (event.state === "running" || event.state === "stopping") void worker.stop(); } });
  assert.deepEqual(await worker.runOnce(), { delivered: 0, deferred: 1, failed: 0 }); await worker.stop();
  assert.deepEqual(events.map((event) => event.state), ["running", "stopping", "idle", "stopped"]);
  assert.equal(f.calls.some((call) => call.name === "deliver"), false);
});

test("observation callbacks must be functions when supplied", () => {
  const f = fixture();
  for (const name of ["onState", "onError"]) for (const value of [null, true, {}, "callback"]) {
    assert.throws(() => createBroadcastWorker({ ...f.options, [name]: value }), invalid);
  }
});
