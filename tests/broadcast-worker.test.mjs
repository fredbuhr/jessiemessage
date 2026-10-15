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
