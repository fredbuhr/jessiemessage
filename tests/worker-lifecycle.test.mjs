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

for (const purpose of ["verification", "password-reset"]) {
  test(`${purpose} observations cover empty queues and freeze only fixed aggregate loop state`, async () => {
    const f = fixture(purpose), events = []; f.jobs.length = 0;
    const worker = startMailWorker({ ...f.options, closeTransport: false, onState: (event) => events.push(event) });
    try {
      await waitFor(() => events.some((event) => event.state === "idle"));
      assert.deepEqual(events, [{ state: "running" }, { state: "idle", counts: { sent: 0, failed: 0 } }]);
      for (const event of events) { assert.ok(Object.isFrozen(event)); if (event.counts) assert.ok(Object.isFrozen(event.counts)); }
      const stop = worker.stop(); assert.equal(worker.stop(), stop); await stop;
      assert.deepEqual(events.slice(-2), [{ state: "stopping" }, { state: "stopped" }]);
      assert.equal(events.filter((event) => event.state === "stopped").length, 1);
    } finally { await worker.close(); }
  });

  test(`${purpose} partial failures complete with degraded counts without exposing email, token or error`, async () => {
    const f = fixture(purpose), events = [], errors = []; let attempts = 0;
    const method = purpose === "verification" ? "sendVerification" : "sendPasswordReset";
    const transport = { ...f.transport, async [method]() { if (++attempts === 1) throw new Error("private mail@example.invalid token and password"); return true; } };
    const worker = startMailWorker({ ...f.options, transport, closeTransport: false, onState: (event) => events.push(event), onError: (event) => errors.push(event) });
    try {
      await waitFor(() => events.some((event) => event.state === "idle"));
      assert.deepEqual(events, [{ state: "running" }, { state: "idle", counts: { sent: 2, failed: 1 } }]);
      assert.deepEqual(errors, []); assert.equal(JSON.stringify(events).includes("private"), false);
    } finally { await worker.close(); }
  });
}

test("mail loop failures retain the legacy fixed onError callback and next scheduled batch can become healthy", async () => {
  const f = fixture(), events = [], errors = []; let first = true;
  const store = { ...f.store, async claim() { if (first) { first = false; throw new Error("private SQL SMTP account"); } return null; } };
  const worker = startMailWorker({ ...f.options, store, closeTransport: false, onState: (event) => events.push(event), onError: (event) => errors.push(event) });
  try {
    await waitFor(() => errors.length === 1);
    assert.deepEqual(events, [{ state: "running" }, { state: "error", code: "MAIL_WORKER_FAILED" }]);
    assert.deepEqual(errors, [{ code: "MAIL_WORKER_FAILED" }]); assert.ok(Object.isFrozen(errors[0]));
    // A subsequent periodic loop proves freshness even though it claims no job.
    await new Promise((resolve) => setTimeout(resolve, 1050));
    assert.deepEqual(events.slice(-2), [{ state: "running" }, { state: "idle", counts: { sent: 0, failed: 0 } }]);
  } finally { await worker.close(); }
});

test("mail observer failures are isolated for sync throws, rejected promises and rejected thenables", async () => {
  for (const mode of ["throw", "reject", "thenable"]) {
    const f = fixture(); let states = 0, errors = 0;
    const broken = () => { if (mode === "throw") throw new Error("private observer"); if (mode === "reject") return Promise.reject(new Error("private observer"));
      return { then() { throw new Error("private observer"); } }; };
    const worker = startMailWorker({ ...f.options, closeTransport: false, onState() { states += 1; return broken(); }, onError() { errors += 1; return broken(); } });
    try {
      await waitFor(() => states >= 2); await worker.stop(); await flush();
      assert.equal(named(f, "sent").length, 3); assert.equal(states, 4); assert.equal(errors, 0);
    } finally { await worker.close(); }
    const failed = startMailWorker({ ...f.options, store: { ...f.store, async claim() { throw new Error("private SQL"); } },
      closeTransport: false, onState: broken, onError() { errors += 1; return broken(); } });
    try { await waitFor(() => errors === 1); } finally { await failed.close(); } await flush();
  }
});

test("reentrant stopping observers preserve one mail drain and callback configuration stays explicit", async () => {
  const f = fixture(), events = []; let worker;
  worker = startMailWorker({ ...f.options, closeTransport: false, onState(event) { events.push(event);
    if (event.state === "running" || event.state === "stopping") void worker.stop(); } });
  try {
    await waitFor(() => events.some((event) => event.state === "stopped"));
    assert.deepEqual(events.map((event) => event.state), ["running", "stopping", "idle", "stopped"]);
    assert.deepEqual(events.find((event) => event.state === "idle").counts, { sent: 0, failed: 0 });
    assert.equal(named(f, "send").length, 0); assert.equal(named(f, "release").length, 1);
  } finally { await worker.close(); }
  for (const name of ["onState", "onError"]) for (const value of [null, true, {}, "callback"]) {
    assert.throws(() => startMailWorker({ ...f.options, [name]: value }), { code: "MAIL_WORKER_FAILED" });
  }
});
