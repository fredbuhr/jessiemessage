import { performance } from "node:perf_hooks";

const NAMES = Object.freeze(["verification", "recovery", "broadcasts", "notifications"]);
const MAX_DATE = 253402300799999;
const instant = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
const counter = (value) => Number.isSafeInteger(value) && value >= 0;
const add = (left, right) => Math.min(Number.MAX_SAFE_INTEGER, left + right);
const duration = (value) => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const ignore = () => {};

export class OperationsMonitorError extends Error {
  constructor() {
    super("Private operational monitoring is unavailable.");
    this.name = "OperationsMonitorError";
    this.code = "OPERATIONS_MONITOR_UNAVAILABLE";
  }
}

function isolated(callback, value) {
  try { Promise.resolve(callback(Object.freeze(value))).catch(ignore); } catch { /* Observers cannot interrupt work. */ }
}

function copyQueues(sample, now) {
  if (!sample || sample.database !== true) throw new OperationsMonitorError();
  const sampledQueues = sample.queues;
  if (!Array.isArray(sampledQueues) || sampledQueues.length > NAMES.length) throw new OperationsMonitorError();
  const seen = new Set(), result = [];
  const length = sampledQueues.length;
  for (let index = 0; index < length; index++) {
    const queue = sampledQueues[index];
    if (!queue) throw new OperationsMonitorError();
    const name = queue.name, oldestDueAt = queue.oldestDueAt;
    if (!NAMES.includes(name) || seen.has(name) || oldestDueAt !== null && (!instant(oldestDueAt) || oldestDueAt > now)) throw new OperationsMonitorError();
    seen.add(name);
    const counts = {};
    for (const state of ["pending", "sending", "failed"]) {
      const value = queue[state];
      if (!value) throw new OperationsMonitorError();
      const count = value.count, truncated = value.truncated;
      if (!counter(count) || count > 1000 || typeof truncated !== "boolean" || truncated && count !== 1000) throw new OperationsMonitorError();
      counts[state] = { count, truncated };
    }
    result.push({ name, ...counts, oldestDueAt });
  }
  return result;
}

function batchCounts(name, value) {
  if (!value || typeof value !== "object") throw new OperationsMonitorError();
  const fields = name === "broadcasts" ? ["delivered", "deferred", "failed", "errors"] : ["sent", "failed"];
  const counts = Object.fromEntries(fields.map((field) => [field, value[field]]));
  if (fields.some((field) => !counter(counts[field]))) throw new OperationsMonitorError();
  return { processed: name === "broadcasts" ? counts.delivered : counts.sent,
    failures: name === "broadcasts" ? Math.max(counts.failed, counts.errors) : counts.failed };
}

/** Cached, bounded observation only. Request handlers never initiate database work. */
export function createOperationsMonitor({ store, messagingConfigured = false, workerNames = [], clock = Date.now,
  monotonicClock = () => performance.now(), intervalMilliseconds = 15000, timeoutMilliseconds = 2000,
  sampleStaleMilliseconds = 45000, workerStaleMilliseconds = 180000, report = ignore } = {}) {
  if (typeof store?.sample !== "function" || typeof messagingConfigured !== "boolean" || !Array.isArray(workerNames)
    || workerNames.some((name) => !NAMES.includes(name)) || new Set(workerNames).size !== workerNames.length
    || typeof clock !== "function" || typeof monotonicClock !== "function" || typeof report !== "function"
    || ![intervalMilliseconds, timeoutMilliseconds, sampleStaleMilliseconds, workerStaleMilliseconds].every(duration)) throw new OperationsMonitorError();

  const workers = workerNames.map((name) => ({ name, state: "starting", lastCompletedAt: null, lastErrorAt: null,
    consecutiveFailures: 0, processed: 0, failures: 0, observedAt: null, successful: false, unavailable: false }));
  let database = { state: "starting", checkedAt: null }, sampledAt = null, queues = [], queuesCheckedAt = null;
  let lastMonotonic = null, startingSince = null, databaseUnavailable = false, started = false, closed = false, timer, inFlight, closing;

  function time() {
    try {
      const now = clock(), monotonic = monotonicClock();
      if (!instant(now) || !Number.isFinite(monotonic) || monotonic < 0 || lastMonotonic !== null && monotonic < lastMonotonic) return null;
      lastMonotonic = monotonic;
      startingSince ??= monotonic;
      return { now, monotonic };
    } catch { return null; }
  }
  function emit(event, worker) { isolated(report, worker ? { event, worker } : { event }); }
  function failedDatabase() {
    database = { state: "unavailable", checkedAt: database.checkedAt };
    sampledAt = null; queues = []; queuesCheckedAt = null;
    if (!databaseUnavailable && !closed) { databaseUnavailable = true; emit("database_unavailable"); }
  }
  function workerState(worker, at) {
    if (["stopping", "stopped"].includes(worker.state)) return worker.state;
    if (worker.observedAt === null && startingSince !== null && at && at.monotonic - startingSince >= workerStaleMilliseconds) return "stale";
    if (worker.observedAt !== null && (!at || at.monotonic - worker.observedAt >= workerStaleMilliseconds)) return "stale";
    if (!at && worker.state !== "starting") return "stale";
    return worker.state;
  }
  function healthyWorker(worker, at) {
    return worker.successful && worker.consecutiveFailures === 0 && ["running", "idle"].includes(workerState(worker, at));
  }
  function evaluate(at) {
    const state = database.state === "ok" && (!at || sampledAt === null || at.monotonic - sampledAt >= sampleStaleMilliseconds) ? "stale" : database.state;
    if (!closed) {
      if (state === "stale" && !databaseUnavailable) { databaseUnavailable = true; emit("database_unavailable"); }
      for (const worker of workers) {
        const current = workerState(worker, at);
        if (!worker.unavailable && (current === "error" || current === "stale" || worker.consecutiveFailures > 0)) {
          worker.unavailable = true; emit("worker_unavailable", worker.name);
        } else if (worker.unavailable && healthyWorker(worker, at)) {
          worker.unavailable = false; emit("worker_recovered", worker.name);
        }
      }
    }
    return state;
  }
  function view(at = time()) {
    const state = evaluate(at);
    return { status: !closed && messagingConfigured && at !== null && state === "ok" && workers.every((worker) => healthyWorker(worker, at)) ? "ready" : "unavailable",
      database: { state, checkedAt: database.checkedAt },
      workers: workers.map((worker) => ({ name: worker.name, state: workerState(worker, at), lastCompletedAt: worker.lastCompletedAt,
        lastErrorAt: worker.lastErrorAt, consecutiveFailures: worker.consecutiveFailures, processed: worker.processed, failures: worker.failures })),
      queues: queues.map((queue) => ({ name: queue.name, pending: { ...queue.pending }, sending: { ...queue.sending }, failed: { ...queue.failed }, oldestDueAt: queue.oldestDueAt })),
      queuesCheckedAt };
  }

  function observe(name, event) {
    try {
      if (closed) return;
      const worker = workers.find((candidate) => candidate.name === name);
      if (!worker || !event) return;
      const state = event.state;
      if (!["running", "idle", "error", "stopping", "stopped"].includes(state)) return;
      const at = time();
      if (!at) { evaluate(null); return; }
      // A batch already draining may still emit idle/error after stopping.
      if (worker.state === "stopped" || worker.state === "stopping" && state !== "stopped") return;
      if (state === "idle") {
        const counts = batchCounts(name, event.counts);
        worker.lastCompletedAt = at.now;
        worker.processed = add(worker.processed, counts.processed);
        worker.failures = add(worker.failures, counts.failures);
        if (counts.failures > 0) {
          worker.lastErrorAt = at.now; worker.consecutiveFailures = add(worker.consecutiveFailures, 1);
        } else { worker.successful = true; worker.consecutiveFailures = 0; }
      } else if (state === "error") {
        worker.lastErrorAt = at.now; worker.consecutiveFailures = add(worker.consecutiveFailures, 1); worker.failures = add(worker.failures, 1);
      }
      worker.state = state; worker.observedAt = at.monotonic;
      evaluate(at);
    } catch { /* Do not expose or trust foreign event properties. */ }
  }

  function sampleNow() {
    if (closed) return Promise.resolve(view());
    if (inFlight) return inFlight.bounded;
    const at = time(); evaluate(at);
    // A diagnostic sink may synchronously stop the monitor or request a sample.
    if (closed) return Promise.resolve(view(at));
    if (inFlight) return inFlight.bounded;
    if (!at) { failedDatabase(); return Promise.resolve(view(null)); }
    let complete;
    const operation = { bounded: new Promise((resolve) => { complete = resolve; }), actual: null, settled: false, timeout: null };
    inFlight = operation;
    const finish = () => { if (!operation.settled) { operation.settled = true; clearTimeout(operation.timeout); complete(view()); } };
    operation.timeout = setTimeout(() => { if (!closed) failedDatabase(); finish(); }, timeoutMilliseconds);
    operation.actual = Promise.resolve().then(() => closed ? null : store.sample({ now: at.now })).then((sample) => {
      if (closed || operation.settled) return;
      const completed = time();
      if (!completed || completed.monotonic - at.monotonic >= timeoutMilliseconds) { failedDatabase(); return; }
      const nextQueues = copyQueues(sample, at.now);
      database = { state: "ok", checkedAt: at.now }; sampledAt = completed.monotonic;
      queues = nextQueues; queuesCheckedAt = at.now;
      if (databaseUnavailable) { databaseUnavailable = false; emit("database_recovered"); }
    }).catch(() => { if (!closed && !operation.settled) failedDatabase(); }).finally(() => {
      finish(); if (inFlight === operation) inFlight = null;
    });
    return operation.bounded;
  }
  function start() {
    if (closed || started) return;
    started = true;
    timer = setInterval(() => { evaluate(time()); void sampleNow(); }, intervalMilliseconds);
    timer.unref?.();
    void sampleNow();
  }
  function close() {
    if (closing) return closing;
    closed = true; clearInterval(timer);
    // The timeout only bounds observers. The connection must drain before its pool.
    closing = inFlight ? inFlight.actual.then(ignore, ignore) : Promise.resolve();
    return closing;
  }
  return Object.freeze({ observe, start, sampleNow, publicStatus: () => ({ status: view().status }), snapshot: () => view(), close });
}
