import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { createOperationsMonitor } from "../server/operations/monitor.mjs";

const EPOCH = 1792050000000;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const pause = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const counts = (count = 0, truncated = false) => ({ count, truncated });
const queue = (name = "verification", values = {}) => ({ name, pending: counts(), sending: counts(), failed: counts(), oldestDueAt: null, ...values });
function fixture(overrides = {}) {
  const state = { now: EPOCH, monotonic: 100, value: { database: true, queues: [queue()] }, gate: null, error: false };
  const calls = [], reports = [];
  const monitor = createOperationsMonitor({ messagingConfigured: true, workerNames: ["verification"], clock: () => state.now, monotonicClock: () => state.monotonic,
    intervalMilliseconds: 1000, timeoutMilliseconds: 100, sampleStaleMilliseconds: 500, workerStaleMilliseconds: 1000,
    report: (event) => reports.push(event), store: { async sample(input) { calls.push(input); if (state.gate) return state.gate.promise;
      if (state.error) throw new Error("private SQL account token and SMTP detail"); return state.value; } }, ...overrides });
  return { state, calls, reports, monitor };
}
const idle = (monitor, name = "verification", counts = { sent: 0, failed: 0 }) => monitor.observe(name, { state: "idle", counts });

test("readiness is cached, unavailable until database plus every configured worker has completed successfully", async () => {
  const f = fixture({ workerNames: ["verification", "recovery", "broadcasts"] });
  assert.deepEqual(f.monitor.publicStatus(), { status: "unavailable" });
  assert.deepEqual(f.monitor.snapshot(), { status: "unavailable", database: { state: "starting", checkedAt: null },
    workers: ["verification", "recovery", "broadcasts"].map((name) => ({ name, state: "starting", lastCompletedAt: null, lastErrorAt: null, consecutiveFailures: 0, processed: 0, failures: 0 })),
    queues: [], queuesCheckedAt: null });
  assert.equal(f.calls.length, 0);
  await f.monitor.sampleNow(); f.monitor.observe("verification", { state: "running" });
  assert.equal(f.monitor.publicStatus().status, "unavailable");
  idle(f.monitor); idle(f.monitor, "recovery");
  assert.equal(f.monitor.publicStatus().status, "unavailable");
  idle(f.monitor, "broadcasts", { delivered: 0, deferred: 1, failed: 0, errors: 0 });
  assert.deepEqual(f.monitor.publicStatus(), { status: "ready" });
  for (let index = 0; index < 10; index++) { f.monitor.publicStatus(); f.monitor.snapshot(); }
  assert.deepEqual(f.calls, [{ now: EPOCH }]); assert.deepEqual(f.reports, []);
  await f.monitor.close();
});

test("default messaging configuration cannot turn a successful database sample green", async () => {
  const monitor = createOperationsMonitor({ store: { async sample() { return { database: true, queues: [] }; } } });
  await monitor.sampleNow(); assert.deepEqual(monitor.publicStatus(), { status: "unavailable" }); await monitor.close();
});

test("partial failures degrade batches, running does not clear them, and a successful empty loop recovers", async () => {
  const f = fixture({ workerNames: ["verification", "broadcasts"] });
  await f.monitor.sampleNow(); idle(f.monitor); idle(f.monitor, "broadcasts", { delivered: 2, deferred: 3, failed: 1, errors: 2 });
  const failed = f.monitor.snapshot().workers[1];
  assert.deepEqual(failed, { name: "broadcasts", state: "idle", lastCompletedAt: EPOCH, lastErrorAt: EPOCH, consecutiveFailures: 1, processed: 2, failures: 2 });
  assert.equal(f.monitor.publicStatus().status, "unavailable");
  f.monitor.observe("broadcasts", { state: "running" }); assert.equal(f.monitor.publicStatus().status, "unavailable");
  f.monitor.observe("broadcasts", { state: "error", code: "private database password" });
  assert.equal(f.monitor.snapshot().workers[1].consecutiveFailures, 2);
  assert.equal(f.monitor.snapshot().workers[1].failures, 3);
  idle(f.monitor, "broadcasts", { delivered: 0, deferred: 1, failed: 0, errors: 0 });
  assert.equal(f.monitor.publicStatus().status, "ready");
  assert.deepEqual(f.reports, [{ event: "worker_unavailable", worker: "broadcasts" }, { event: "worker_recovered", worker: "broadcasts" }]);
  await f.monitor.close();
});

test("a failure before any successful batch never becomes ready on running observations", async () => {
  const f = fixture(); await f.monitor.sampleNow();
  idle(f.monitor, "verification", { sent: 3, failed: 1 });
  f.monitor.observe("verification", { state: "running" });
  assert.equal(f.monitor.publicStatus().status, "unavailable");
  idle(f.monitor); assert.equal(f.monitor.publicStatus().status, "ready");
  assert.deepEqual(f.monitor.snapshot().workers[0], { name: "verification", state: "idle", lastCompletedAt: EPOCH, lastErrorAt: EPOCH,
    consecutiveFailures: 0, processed: 3, failures: 1 });
  await f.monitor.close();
});

test("database timeouts are bounded, coalesce all requests, reject late success and prohibit overlapping queries", async () => {
  const f = fixture({ timeoutMilliseconds: 20 }); f.state.gate = pause();
  const first = f.monitor.sampleNow(); assert.equal(f.monitor.sampleNow(), first);
  await flush(); assert.equal(f.calls.length, 1);
  const timedOut = await first; assert.equal(timedOut.database.state, "unavailable");
  assert.deepEqual(timedOut.queues, []); assert.equal(timedOut.queuesCheckedAt, null);
  assert.equal(f.monitor.sampleNow(), first); assert.equal(f.calls.length, 1);
  f.state.gate.resolve({ database: true, queues: [queue()] }); await flush(); await flush();
  assert.equal(f.monitor.snapshot().database.state, "unavailable");
  f.state.gate = null; await f.monitor.sampleNow(); idle(f.monitor);
  assert.equal(f.calls.length, 2); assert.equal(f.monitor.publicStatus().status, "ready");
  assert.deepEqual(f.reports, [{ event: "database_unavailable" }, { event: "database_recovered" }]);
  await f.monitor.close();
});

test("a delayed event loop completion beyond the monotonic deadline fails closed before the timer fires", async () => {
  const f = fixture(); f.state.gate = pause();
  const sample = f.monitor.sampleNow(); await flush(); f.state.monotonic += 100;
  f.state.gate.resolve({ database: true, queues: [queue()] });
  assert.equal((await sample).database.state, "unavailable"); await f.monitor.close();
});

test("database errors clear old scheduling metrics and produce fixed transition logs only", async () => {
  const f = fixture(); f.state.value.queues[0].pending = counts(5); await f.monitor.sampleNow(); idle(f.monitor);
  f.state.error = true; await f.monitor.sampleNow(); await f.monitor.sampleNow();
  const result = f.monitor.snapshot(); assert.equal(result.database.state, "unavailable");
  assert.equal(result.database.checkedAt, EPOCH); assert.deepEqual(result.queues, []); assert.equal(result.queuesCheckedAt, null);
  assert.deepEqual(f.reports, [{ event: "database_unavailable" }]);
  assert.equal(JSON.stringify(result).includes("private"), false);
  f.state.error = false; await f.monitor.sampleNow(); assert.equal(f.monitor.publicStatus().status, "ready");
  assert.deepEqual(f.reports, [{ event: "database_unavailable" }, { event: "database_recovered" }]); await f.monitor.close();
});

test("freshness uses monotonic time and safely tolerates valid wall-clock adjustments", async () => {
  const f = fixture(); await f.monitor.sampleNow(); idle(f.monitor);
  f.state.now -= 1000000; f.state.monotonic += 499;
  assert.equal(f.monitor.publicStatus().status, "ready");
  f.state.monotonic += 1; assert.equal(f.monitor.publicStatus().status, "unavailable");
  assert.equal(f.monitor.snapshot().database.state, "stale");
  f.state.monotonic += 500; assert.equal(f.monitor.snapshot().workers[0].state, "stale");
  await f.monitor.sampleNow(); idle(f.monitor); assert.equal(f.monitor.publicStatus().status, "ready"); await f.monitor.close();
});

test("sample metadata retains the sampling instant when wall clock changes during the query", async () => {
  const f = fixture(); f.state.gate = pause();
  const sample = f.monitor.sampleNow(); await flush();
  f.state.now -= 1000; f.state.monotonic += 1;
  f.state.gate.resolve({ database: true, queues: [queue("verification", { oldestDueAt: EPOCH - 100 })] });
  const result = await sample;
  assert.equal(result.database.checkedAt, EPOCH); assert.equal(result.queuesCheckedAt, EPOCH);
  assert.equal(result.queues[0].oldestDueAt, EPOCH - 100); await f.monitor.close();
});

test("invalid dates, invalid monotonic readings and monotonic rollback fail closed without querying", async () => {
  for (const value of [NaN, Infinity, -1, 253402300800000, "date"]) {
    const f = fixture(); await f.monitor.sampleNow(); idle(f.monitor); f.state.now = value;
    assert.equal(f.monitor.publicStatus().status, "unavailable"); await f.monitor.sampleNow();
    assert.equal(f.calls.length, 1); assert.equal(f.monitor.snapshot().database.state, "unavailable"); await f.monitor.close();
  }
  for (const value of [NaN, Infinity, -1, 99]) {
    const f = fixture(); await f.monitor.sampleNow(); idle(f.monitor); f.state.monotonic = value;
    assert.equal(f.monitor.publicStatus().status, "unavailable"); assert.equal(f.monitor.snapshot().database.state, "stale");
    f.monitor.observe("verification", { state: "running" }); await f.monitor.sampleNow(); assert.equal(f.calls.length, 1);
    f.state.monotonic = 101; await f.monitor.sampleNow(); idle(f.monitor); assert.equal(f.monitor.publicStatus().status, "ready"); await f.monitor.close();
  }
});

test("periodic sampling detects both a hung running worker and a worker that never reported its first batch", async () => {
  const f = fixture({ intervalMilliseconds: 5, workerNames: ["verification", "recovery"] });
  f.monitor.start(); f.monitor.start(); await flush(); idle(f.monitor); f.monitor.observe("verification", { state: "running" });
  f.state.monotonic += 1000; await sleep(20);
  assert.deepEqual(f.monitor.snapshot().workers.map((worker) => worker.state), ["stale", "stale"]);
  assert.deepEqual(f.reports.filter((event) => event.event === "worker_unavailable"),
    [{ event: "worker_unavailable", worker: "verification" }, { event: "worker_unavailable", worker: "recovery" }]);
  idle(f.monitor); idle(f.monitor, "recovery"); assert.equal(f.monitor.publicStatus().status, "ready");
  await f.monitor.close(); const calls = f.calls.length; await sleep(15); assert.equal(f.calls.length, calls);
});

test("stopping is sticky despite a draining batch completion and stopped cannot resume", async () => {
  const f = fixture(); await f.monitor.sampleNow(); idle(f.monitor); assert.equal(f.monitor.publicStatus().status, "ready");
  f.monitor.observe("verification", { state: "stopping" }); idle(f.monitor, "verification", { sent: 4, failed: 0 });
  f.monitor.observe("verification", { state: "running" }); f.monitor.observe("verification", { state: "error" });
  assert.equal(f.monitor.snapshot().workers[0].state, "stopping"); assert.equal(f.monitor.publicStatus().status, "unavailable");
  f.monitor.observe("verification", { state: "stopped" }); idle(f.monitor);
  assert.equal(f.monitor.snapshot().workers[0].state, "stopped"); assert.deepEqual(f.reports, []); await f.monitor.close();
});

test("close stops work immediately and drains the actual query even after its bounded observer timed out", async () => {
  const f = fixture({ intervalMilliseconds: 5, timeoutMilliseconds: 15 }); f.state.gate = pause();
  f.monitor.start(); await flush(); await f.monitor.sampleNow();
  let drained = false; const closing = f.monitor.close(); assert.equal(f.monitor.close(), closing); closing.then(() => { drained = true; });
  await flush(); assert.equal(drained, false); assert.equal(f.monitor.publicStatus().status, "unavailable");
  await f.monitor.sampleNow(); f.monitor.start(); await sleep(15); assert.equal(f.calls.length, 1);
  f.state.gate.resolve({ database: true, queues: [queue()] }); await closing;
  assert.equal(drained, true); assert.equal(f.monitor.snapshot().database.state, "unavailable");
});

test("closing before an explicitly queued sample acquires the pool prevents that query from starting", async () => {
  const f = fixture(); const sampling = f.monitor.sampleNow(); await f.monitor.close(); await sampling;
  assert.equal(f.calls.length, 0); assert.equal(f.monitor.publicStatus().status, "unavailable");
});

test("observation and reporting callbacks cannot throw or leave rejected promises unhandled", async () => {
  for (const mode of ["throw", "reject", "thenable"]) {
    const f = fixture({ report() { if (mode === "throw") throw new Error("private logging token");
      if (mode === "reject") return Promise.reject(new Error("private logging token"));
      return { then() { throw new Error("private thenable token"); } }; } });
    await f.monitor.sampleNow(); f.monitor.observe("verification", { state: "error", code: "private password" });
    idle(f.monitor); assert.equal(f.monitor.publicStatus().status, "ready");
    f.state.error = true; await f.monitor.sampleNow(); f.state.error = false; await f.monitor.sampleNow();
    assert.doesNotThrow(() => f.monitor.observe("verification", { get state() { throw new Error("private getter"); } }));
    assert.doesNotThrow(() => f.monitor.observe("verification", { state: "idle", counts: { get sent() { throw new Error("private counts"); } } }));
    await flush(); await f.monitor.close();
  }
});

test("snapshots own their fields, saturate counters, and never expose foreign worker or queue properties", async () => {
  const f = fixture(); f.state.value.secret = "private SQL"; f.state.value.queues[0].secret = "private email";
  await f.monitor.sampleNow(); idle(f.monitor, "verification", { sent: Number.MAX_SAFE_INTEGER, failed: Number.MAX_SAFE_INTEGER, token: "private" });
  idle(f.monitor, "verification", { sent: 2, failed: 2 });
  f.monitor.observe("unknown private worker", { state: "error" });
  const result = f.monitor.snapshot(), worker = result.workers[0];
  assert.equal(worker.processed, Number.MAX_SAFE_INTEGER); assert.equal(worker.failures, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(Object.keys(result), ["status", "database", "workers", "queues", "queuesCheckedAt"]);
  assert.equal(JSON.stringify(result).includes("private"), false);
  result.workers[0].processed = -1; result.queues[0].pending.count = -1; result.database.state = "evil";
  f.state.value.queues[0].pending.count = -10;
  assert.equal(f.monitor.snapshot().workers[0].processed, Number.MAX_SAFE_INTEGER);
  assert.equal(f.monitor.snapshot().queues[0].pending.count, 0); assert.equal(f.monitor.snapshot().database.state, "ok"); await f.monitor.close();
});

test("a reentrant diagnostic sink cannot overlap queries or restart sampling after it stops the monitor", async () => {
  let monitor, requested;
  const f = fixture({ report(event) { if (event.event === "worker_unavailable") requested = monitor.sampleNow(); } }); monitor = f.monitor;
  await monitor.sampleNow(); idle(monitor); f.state.monotonic += 1000;
  const sample = monitor.sampleNow(); assert.equal(sample, requested); await sample;
  assert.equal(f.calls.length, 2); await monitor.close();
  let closing;
  const stopped = fixture({ report() { closing = stopped.monitor.close(); } });
  await stopped.monitor.sampleNow(); stopped.state.monotonic += 500;
  stopped.monitor.start(); await closing; await flush();
  assert.equal(stopped.calls.length, 1); assert.equal(stopped.monitor.publicStatus().status, "unavailable");
});

test("malformed samples never enter the cache or produce unsanitized error logs", async () => {
  for (const value of [null, { database: false, queues: [] }, { database: true, queues: [queue("private")] },
    { database: true, queues: [queue(), queue()] }, { database: true, queues: [queue("verification", { pending: counts(1001) })] },
    { database: true, queues: [queue("verification", { pending: counts(1, true) })] },
    { database: true, queues: [queue("verification", { oldestDueAt: EPOCH + 1 })] },
    { database: true, queues: [queue("verification", { oldestDueAt: NaN })] },
    { get database() { throw new Error("private driver error"); } }]) {
    const f = fixture(); f.state.value = value;
    assert.equal((await f.monitor.sampleNow()).database.state, "unavailable");
    assert.deepEqual(f.monitor.snapshot().queues, []); assert.deepEqual(f.reports, [{ event: "database_unavailable" }]); await f.monitor.close();
  }
});

test("invalid configuration fails with a fixed message and no driver error details", () => {
  for (const values of [{}, { store: {}, messagingConfigured: true }, { workerNames: ["secret"] }, { workerNames: ["verification", "verification"] },
    { messagingConfigured: "true" }, { clock: null }, { monotonicClock: null }, { report: null }, { timeoutMilliseconds: 0 }, { intervalMilliseconds: Infinity }]) {
    const options = Object.keys(values).length === 0 ? values : { store: { sample() {} }, ...values };
    assert.throws(() => createOperationsMonitor(options), (error) => error.code === "OPERATIONS_MONITOR_UNAVAILABLE" && error.cause === undefined);
  }
});
