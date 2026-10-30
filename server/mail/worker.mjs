import { openVerificationPayload } from "./crypto.mjs";
import { openResetPayload } from "../reset/mail-crypto.mjs";

export class MailWorkerError extends Error {
  constructor() {
    super("Private email worker could not complete its batch.");
    this.name = "MailWorkerError";
    this.code = "MAIL_WORKER_FAILED";
  }
}

// Telemetry is best effort and cannot fail or delay SMTP/SQL lifecycle work.
// Fixed caller-built objects prevent an exception or job from reaching it.
function observe(callback, event) {
  if (!callback) return;
  try { void Promise.resolve(callback(Object.freeze(event))).catch(() => {}); } catch {}
}

export async function runMailBatch({ store, transport, key, clock = Date.now, batchSize = 5, purpose = "verification", signal = null }) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20
    || typeof clock !== "function" || !["verification", "password-reset"].includes(purpose)
    || (signal !== null && !(signal instanceof AbortSignal))) throw new MailWorkerError();
  const openPayload = purpose === "password-reset" ? openResetPayload : openVerificationPayload;
  const deliveryMethod = purpose === "password-reset" ? "sendPasswordReset" : "sendVerification";
  let sent = 0;
  let failed = 0;
  try {
    for (let index = 0; index < batchSize && !signal?.aborted; index += 1) {
      const job = await store.claim({ now: clock() });
      if (!job) break;
      if (signal?.aborted) {
        // No SMTP call has started. Return this exact live reservation, even
        // its eighth claim, rather than consuming an attempt during shutdown.
        await store.releaseClaim(job.id, job.leaseToken, { now: clock() });
        break;
      }
      let payload;
      try {
        payload = openPayload(job.payloadEncrypted, key, job.id);
        if (payload.email !== job.recipientEmail) throw new Error();
      } catch {
        await store.markFailed(job.id, job.leaseToken, { now: clock(), code: "PAYLOAD_INVALID", permanent: true });
        failed += 1;
        continue;
      }
      if (signal?.aborted) { await store.releaseClaim(job.id, job.leaseToken, { now: clock() }); break; }
      const sendAt = clock();
      if (!Number.isSafeInteger(sendAt) || sendAt < 0 || sendAt > 253402300799999
        || !Number.isSafeInteger(job.expiresAt) || job.expiresAt <= sendAt || job.expiresAt > 253402300799999
        || !Number.isSafeInteger(job.leaseUntil) || job.leaseUntil <= sendAt || job.leaseUntil > job.expiresAt) {
        // No transport has started. A stale lease cannot authorize an SMTP
        // attempt; its CAS remains untouched if another worker has replaced it.
        await store.markFailed(job.id, job.leaseToken, { now: sendAt, code: "MAIL_DELIVERY_FAILED" });
        failed += 1;
        continue;
      }
      try {
        if (await transport[deliveryMethod]({ ...payload, jobId: job.id }) !== true) throw new Error();
      } catch {
        await store.markFailed(job.id, job.leaseToken, { now: clock(), code: "MAIL_DELIVERY_FAILED" });
        failed += 1;
        continue;
      }
      // The SMTP server may have accepted delivery before a crash or stale lease.
      // Persisting completion is a separate action, so delivery is at least once.
      if (await store.markSent(job.id, job.leaseToken, { now: clock() })) sent += 1;
      else failed += 1;
    }
    if (!signal?.aborted) await store.prune({ now: clock() });
    return { sent, failed };
  } catch { throw new MailWorkerError(); }
}

export function startMailWorker(options = {}) {
  const intervalMilliseconds = options.intervalMilliseconds ?? 15000;
  const closeTransport = options.closeTransport === undefined ? true : options.closeTransport;
  const purpose = options.purpose === undefined ? "verification" : options.purpose;
  if (!Number.isInteger(intervalMilliseconds) || intervalMilliseconds < 1000 || intervalMilliseconds > 300000
    || typeof closeTransport !== "boolean" || !["verification", "password-reset"].includes(purpose)
    || options.onState !== undefined && typeof options.onState !== "function"
    || options.onError !== undefined && typeof options.onError !== "function") throw new MailWorkerError();
  let closed = false;
  const controller = new AbortController();
  let stopping = null;
  let active = null;
  let timer = null;
  let wakePending = false;
  function schedule(delay) {
    if (closed) return;
    timer = setTimeout(() => {
      timer = null;
      wakePending = false;
      let batchFull = false;
      active = runMailBatch({ ...options, signal: controller.signal }).then((counts) => {
        batchFull = counts.sent + counts.failed >= (options.batchSize ?? 5);
        observe(options.onState, { state: "idle", counts: Object.freeze({ ...counts }) });
      }, () => {
        // Only a fixed code may be surfaced; never propagate SQL/SMTP details.
        observe(options.onState, { state: "error", code: "MAIL_WORKER_FAILED" });
        observe(options.onError, { code: "MAIL_WORKER_FAILED" });
      }).finally(() => {
        active = null;
        // Drain a ready backlog without an artificial pause between five-mail
        // batches. Idle/error polling remains bounded and recovers missed wakes.
        schedule(wakePending || batchFull ? 0 : intervalMilliseconds);
      });
      observe(options.onState, { state: "running" });
    }, delay);
    timer.unref();
  }
  schedule(0);
  let closing;
  function wake() {
    if (closed) return;
    if (active) { wakePending = true; return; }
    if (timer) clearTimeout(timer);
    timer = null;
    schedule(0);
  }
  function stop() {
    if (stopping) return stopping;
    // The flag and signal change before returning the drain promise. A caller
    // can stop every shared-transport worker before waiting for any one batch.
    closed = true; controller.abort();
    if (timer) clearTimeout(timer);
    timer = null;
    const drained = active ? active.then(() => {}) : Promise.resolve();
    stopping = drained.then(() => { observe(options.onState, { state: "stopped" }); });
    observe(options.onState, { state: "stopping" });
    return stopping;
  }
  return Object.freeze({
    wake,
    stop,
    close() {
      if (closing) return closing;
      const drained = stop();
      closing = (async () => {
        await drained;
        if (closeTransport) {
          try { await options.transport.close(); } catch { throw new MailWorkerError(); }
        }
      })();
      return closing;
    },
  });
}
