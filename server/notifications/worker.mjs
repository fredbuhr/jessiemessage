export class NotificationWorkerError extends Error {
  constructor() {
    super("Private notifications worker could not complete its batch.");
    this.name = "NotificationWorkerError";
    this.code = "NOTIFICATIONS_WORKER_FAILED";
  }
}

function observe(callback, event) {
  if (!callback) return;
  try { void Promise.resolve(callback(Object.freeze(event))).catch(() => {}); } catch {}
}
const payloads = Object.freeze({
  fr: JSON.stringify({ type: "message", language: "fr", title: "Jessie", body: "Un nouveau message t’attend.", url: "/app", tag: "JessieMessage" }),
  en: JSON.stringify({ type: "message", language: "en", title: "Jessie", body: "A new message is waiting for you.", url: "/app", tag: "JessieMessage" }),
});

export function createNotificationWorker({ store, transport, config, clock = Date.now, random = Math.random, onError, onEvent, onState } = {}) {
  const batchSize = config?.worker?.batchSize ?? 5, pollMilliseconds = config?.worker?.pollMilliseconds ?? 2000;
  const leaseMilliseconds = config?.worker?.leaseMilliseconds ?? 90000, maxAttempts = config?.worker?.maxAttempts ?? 6;
  if (config?.enabled !== true || ["claimDue", "prepareDelivery", "settleDelivery"].some((name) => typeof store?.[name] !== "function")
    || typeof transport?.send !== "function" || typeof clock !== "function" || typeof random !== "function"
    || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5 || !Number.isInteger(pollMilliseconds) || pollMilliseconds < 1000 || pollMilliseconds > 300000
    || leaseMilliseconds !== 90000 || maxAttempts !== 6
    || [onError, onEvent, onState].some((callback) => callback !== undefined && typeof callback !== "function")) throw new NotificationWorkerError();
  let active = null, timer = null, started = false, stopped = false, stopping = null, lastCleanupAt = null;
  const controller = new AbortController();
  function now() {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) throw new NotificationWorkerError();
    return value;
  }
  async function settle(job, result) {
    return store.settleDelivery({ jobId: job.jobId, leaseToken: job.leaseToken, now: now(), result });
  }
  function retry(job, retryAfterSeconds) {
    const current = now();
    if (!Number.isInteger(job.attempts) || job.attempts < 1 || job.attempts >= maxAttempts) return { status: "failed" };
    const jitter = random();
    if (!Number.isFinite(jitter) || jitter < 0 || jitter >= 1) throw new NotificationWorkerError();
    const delaySeconds = Math.max(1, Math.min(3600, 15 * 2 ** (job.attempts - 1) * (0.75 + jitter * 0.5)));
    const requestedDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 1 ? Math.min(3600, Math.ceil(retryAfterSeconds)) : 0;
    const nextAttemptAt = current + Math.ceil(Math.max(delaySeconds, requestedDelay) * 1000);
    return nextAttemptAt < job.expiresAt ? { status: "retry", nextAttemptAt } : { status: "failed" };
  }
  async function batch() {
    const counts = { sent: 0, failed: 0, deferred: 0, skipped: 0 };
    if (stopped) return counts;
    const jobs = await store.claimDue({ now: now(), limit: batchSize, leaseMs: leaseMilliseconds });
    if (!Array.isArray(jobs) || jobs.length > batchSize) throw new NotificationWorkerError();
    for (const job of jobs) {
      // Claims are recoverable after their lease. On shutdown, return all jobs
      // we have not sent instead of spending the remainder of the lease.
      if (stopped) {
        if (await settle(job, { status: "release", nextAttemptAt: now() })) counts.deferred += 1;
        continue;
      }
      let result, deliveryStarted = false;
      try {
        if (!Buffer.isBuffer(job?.jobId) || job.jobId.length !== 16 || !Buffer.isBuffer(job.leaseToken) || job.leaseToken.length !== 16
          || !Number.isSafeInteger(job.expiresAt) || !Number.isInteger(job.attempts) || job.attempts < 1 || job.attempts > maxAttempts) throw new NotificationWorkerError();
        const delivery = await store.prepareDelivery({ jobId: job.jobId, leaseToken: job.leaseToken, now: now() });
        if (!delivery) { counts.skipped += 1; continue; }
        if (stopped) { if (await settle(job, { status: "release", nextAttemptAt: now() })) counts.deferred += 1; continue; }
        const ttl = Math.min(86400, Math.floor((Math.min(job.expiresAt, delivery.expiresAt) - now()) / 1000));
        if (!Number.isFinite(ttl) || ttl <= 0) result = { status: "failed" };
        else {
          deliveryStarted = true;
          const response = await transport.send(delivery.subscription, payloads[delivery.locale === "en" ? "en" : "fr"],
            { signal: controller.signal, ttl, topic: delivery.topic ?? "JessieMessage" });
          if (!Number.isInteger(response?.statusCode) || response.statusCode < 100 || response.statusCode > 599) throw new NotificationWorkerError();
          const { statusCode } = response;
          if (statusCode >= 200 && statusCode < 300) result = { status: "accepted" };
          else if (statusCode === 404 || statusCode === 410) result = { status: "invalid_subscription" };
          else if (statusCode === 429 || statusCode >= 500) result = retry(job, response.retryAfterSeconds);
          else {
            result = { status: "failed" };
            observe(onError, { code: statusCode === 401 || statusCode === 403 ? "NOTIFICATIONS_PROVIDER_AUTH" : "NOTIFICATIONS_PROVIDER_REJECTED" });
          }
        }
      } catch (error) {
        if (stopped && !deliveryStarted) result = { status: "release", nextAttemptAt: now() };
        else result = error?.retryable === false || error instanceof NotificationWorkerError ? { status: "failed" } : retry(job, null);
        observe(onError, { code: "NOTIFICATIONS_DELIVERY_FAILED" });
      }
      if (await settle(job, result)) {
        if (result.status === "accepted") counts.sent += 1;
        else if (result.status === "retry") { counts.deferred += 1; counts.failed += 1; }
        else if (result.status === "release") counts.deferred += 1;
        else counts.failed += 1;
      }
    }
    if (!stopped && typeof store.cleanup === "function") {
      const current = now();
      if (lastCleanupAt === null || current - lastCleanupAt >= 300000) {
        lastCleanupAt = current;
        try { await store.cleanup({ now: current, limit: 100 }); }
        catch { observe(onError, { code: "NOTIFICATIONS_CLEANUP_FAILED" }); }
      }
    }
    return counts;
  }
  function state(event) { observe(onState, event); observe(onEvent, event); }
  function runOnce() {
    if (stopped) return Promise.reject(new NotificationWorkerError());
    if (!active) {
      active = Promise.resolve().then(batch).then((counts) => { state({ state: "idle", counts: Object.freeze({ ...counts }) }); return counts; }, () => {
        state({ state: "error", code: "NOTIFICATIONS_WORKER_FAILED" });
        observe(onError, { code: "NOTIFICATIONS_WORKER_FAILED" });
        throw new NotificationWorkerError();
      }).finally(() => { active = null; });
      state({ state: "running" });
    }
    return active;
  }
  function schedule(delay) {
    if (!started || stopped) return;
    timer = setTimeout(() => { timer = null; void runOnce().catch(() => {}).finally(() => schedule(pollMilliseconds)); }, delay);
    timer.unref?.();
  }
  return Object.freeze({ runOnce,
    start() { if (stopped) throw new NotificationWorkerError(); if (!started) { started = true; schedule(0); } },
    stop() {
      if (stopping) return stopping;
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      stopping = (active ? active.then(() => {}, () => {}) : Promise.resolve()).then(() => { state({ state: "stopped" }); });
      controller.abort();
      state({ state: "stopping" });
      return stopping;
    },
  });
}
