import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { runMailBatch, startMailWorker } from "../server/mail/worker.mjs";
import { sealVerificationPayload } from "../server/mail/crypto.mjs";
import { sealResetPayload } from "../server/reset/mail-crypto.mjs";
import { newToken } from "../server/auth/crypto.mjs";

const now = 1750000000000;
const pause = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise((resolve) => setImmediate(resolve));
async function waitFor(condition) { const until = Date.now() + 1000; while (!condition()) { assert.ok(Date.now() < until, "worker reached the expected lifecycle boundary"); await sleep(1); } }
function fixture(purpose = "verification", overrides = {}) {
  const key = randomBytes(32), calls = [], jobs = [];
  const seal = purpose === "verification" ? sealVerificationPayload : sealResetPayload;
  for (let index = 0; index < 3; index++) {
    const id = randomBytes(16), email = `worker-${index}@example.invalid`;
    jobs.push({ id, recipientEmail: email, leaseToken: randomBytes(16), attempts: 8, payloadEncrypted: seal({ email, token: newToken() }, key, id) });
  }
  const state = { claimGate: null, sendGate: null, closeError: false, releaseResult: true };
  const store = {
    async claim() { calls.push(["claim"]); if (state.claimGate) await state.claimGate.promise; return jobs.shift() ?? null; },
    async releaseClaim(...args) { calls.push(["release", ...args]); return state.releaseResult; },
    async markSent(...args) { calls.push(["sent", ...args]); return true; },
    async markFailed(...args) { calls.push(["failed", ...args]); return true; },
    async prune() { calls.push(["prune"]); },
  };
  const send = async (value) => { calls.push(["send", value]); if (state.sendGate) return state.sendGate.promise; return true; };
  const transport = { sendVerification: send, sendPasswordReset: send, async close() { calls.push(["close"]); if (state.closeError) throw new Error("private SMTP close detail"); } };
  const options = { store, transport, key, purpose, clock: () => now, intervalMilliseconds: 1000, ...overrides };
  return { options, store, transport, calls, jobs, state };
}
const named = (f, value) => f.calls.filter((call) => call[0] === value);

for (const purpose of ["verification", "password-reset"]) {
  test(`${purpose} close signals synchronously during SMTP, drains job one and never claims job two`, async () => {
    const f = fixture(purpose); f.state.sendGate = pause();
    const worker = startMailWorker(f.options);
    try {
      await waitFor(() => named(f, "send").length === 1);
      let finished = false; const closing = worker.close(); assert.equal(worker.close(), closing);
      const stopping = worker.stop(); assert.equal(worker.stop(), stopping); closing.then(() => { finished = true; });
      await flush(); assert.equal(finished, false); assert.equal(named(f, "close").length, 0);
      f.state.sendGate.resolve(true); await closing;
      assert.equal(finished, true); assert.equal(named(f, "claim").length, 1); assert.equal(named(f, "send").length, 1);
      assert.equal(named(f, "sent").length, 1); assert.equal(named(f, "release").length, 0); assert.equal(named(f, "failed").length, 0);
      assert.equal(named(f, "prune").length, 0); assert.equal(named(f, "close").length, 1); assert.equal(f.jobs.length, 2);
    } finally { f.state.sendGate.resolve(true); await worker.close(); }
  });

  test(`${purpose} close during an eighth claim emits nothing and releases the exact unstarted reservation`, async () => {
    const f = fixture(purpose); f.state.claimGate = pause(); const expected = f.jobs[0];
    const worker = startMailWorker({ ...f.options, closeTransport: false });
    try {
      await waitFor(() => named(f, "claim").length === 1);
      let finished = false; const closing = worker.close(); closing.then(() => { finished = true; }); await flush(); assert.equal(finished, false);
      f.state.claimGate.resolve(); await closing;
      assert.equal(named(f, "claim").length, 1); assert.equal(named(f, "send").length, 0); assert.equal(named(f, "sent").length, 0);
      assert.equal(named(f, "failed").length, 0); assert.equal(named(f, "close").length, 0); assert.equal(named(f, "prune").length, 0);
      assert.deepEqual(named(f, "release"), [["release", expected.id, expected.leaseToken, { now }]]);
      assert.equal(f.jobs.length, 2);
    } finally { f.state.claimGate.resolve(); await worker.close(); }
  });

  test(`${purpose} shutdown after SMTP started never restores an ambiguous attempt`, async () => {
    const f = fixture(purpose); f.state.sendGate = pause(); const worker = startMailWorker({ ...f.options, closeTransport: false });
    try {
      await waitFor(() => named(f, "send").length === 1); const closing = worker.close();
      f.state.sendGate.reject(new Error("SMTP may already have accepted private mail")); await closing;
      assert.equal(named(f, "release").length, 0); assert.equal(named(f, "sent").length, 0);
      assert.equal(named(f, "failed").length, 1); assert.equal(named(f, "failed")[0][3].code, "MAIL_DELIVERY_FAILED");
      assert.equal(named(f, "claim").length, 1); assert.equal(named(f, "close").length, 0);
    } finally { f.state.sendGate.resolve(true); await worker.close(); }
  });
}

test("both shared SMTP workers are stopped before either drain, and neither closes their caller-owned transport", async () => {
  const verification = fixture(), reset = fixture("password-reset"), gate = pause(), sharedCalls = [];
  const transport = {
    async sendVerification() { sharedCalls.push("verification"); await gate.promise; return true; },
    async sendPasswordReset() { sharedCalls.push("reset"); await gate.promise; return true; },
    async close() { sharedCalls.push("close"); },
  };
  const workers = [verification, reset].map((f) => startMailWorker({ ...f.options, transport, closeTransport: false }));
  try {
    await waitFor(() => sharedCalls.length === 2);
    const drains = workers.map((worker) => worker.stop()); // all flags change before awaiting a drain
    assert.equal(sharedCalls.includes("close"), false); gate.resolve(); await Promise.all(drains); await Promise.all(workers.map((worker) => worker.close()));
    assert.equal(named(verification, "claim").length, 1); assert.equal(named(reset, "claim").length, 1);
    assert.deepEqual(sharedCalls.sort(), ["reset", "verification"]); await transport.close(); assert.equal(sharedCalls.filter((value) => value === "close").length, 1);
  } finally { gate.resolve(); await Promise.all(workers.map((worker) => worker.close())); }
});

test("stopping an idle mail worker cancels its timer immediately and drains idempotently without owning the shared transport", async () => {
  const f = fixture(), worker = startMailWorker({ ...f.options, closeTransport: false });
  const stopping = worker.stop(); assert.equal(worker.stop(), stopping); await stopping;
  const closing = worker.close(); assert.equal(worker.close(), closing); await closing; await flush();
  assert.deepEqual(f.calls, []);
});

test("release CAS returning false neither claims success nor performs a send after stop", async () => {
  const f = fixture(), signal = new AbortController(); f.state.claimGate = pause(); f.state.releaseResult = false;
  const batch = runMailBatch({ ...f.options, signal: signal.signal });
  assert.equal(named(f, "claim").length, 1); signal.abort(); f.state.claimGate.resolve();
  assert.deepEqual(await batch, { sent: 0, failed: 0 }); assert.equal(named(f, "release").length, 1);
  for (const name of ["send", "sent", "failed", "prune"]) assert.equal(named(f, name).length, 0);
});

test("an already aborted batch does not acquire a lease and malformed stop signals fail before persistence", async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  assert.deepEqual(await runMailBatch({ ...f.options, signal: controller.signal }), { sent: 0, failed: 0 }); assert.deepEqual(f.calls, []);
  for (const signal of [false, {}, { aborted: true }, "aborted"]) await assert.rejects(runMailBatch({ ...f.options, signal }), { code: "MAIL_WORKER_FAILED" });
  assert.deepEqual(f.calls, []);
});

test("owned transport close errors remain sanitized and the one close promise is reused", async () => {
  const f = fixture(); f.state.closeError = true; const worker = startMailWorker(f.options);
  const closing = worker.close(); assert.equal(worker.close(), closing);
  await assert.rejects(closing, (error) => error.code === "MAIL_WORKER_FAILED" && error.cause === undefined && !error.message.includes("private SMTP"));
  assert.equal(named(f, "close").length, 1); assert.equal(named(f, "claim").length, 0);
});
