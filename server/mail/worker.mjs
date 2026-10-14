import { openVerificationPayload } from "./crypto.mjs";

export class MailWorkerError extends Error {
  constructor() {
    super("Verification email worker could not complete its batch.");
    this.name = "MailWorkerError";
    this.code = "MAIL_WORKER_FAILED";
  }
}

export async function runMailBatch({ store, transport, key, clock = Date.now, batchSize = 5 }) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20
    || typeof clock !== "function") throw new MailWorkerError();
  let sent = 0;
  let failed = 0;
  try {
    for (let index = 0; index < batchSize; index += 1) {
      const job = await store.claim({ now: clock() });
      if (!job) break;
      let payload;
      try {
        payload = openVerificationPayload(job.payloadEncrypted, key, job.id);
        if (payload.email !== job.recipientEmail) throw new Error();
      } catch {
        await store.markFailed(job.id, job.leaseToken, { now: clock(), code: "PAYLOAD_INVALID", permanent: true });
        failed += 1;
        continue;
      }
      try {
        if (await transport.sendVerification({ ...payload, jobId: job.id }) !== true) throw new Error();
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
    await store.prune({ now: clock() });
    return { sent, failed };
  } catch { throw new MailWorkerError(); }
}

export function startMailWorker(options) {
  const intervalMilliseconds = options.intervalMilliseconds ?? 15000;
  if (!Number.isInteger(intervalMilliseconds) || intervalMilliseconds < 1000 || intervalMilliseconds > 300000) throw new MailWorkerError();
  let closed = false;
  let active = null;
  let timer = null;
  function schedule(delay) {
    if (closed) return;
    timer = setTimeout(() => {
      timer = null;
      active = runMailBatch(options).catch(() => {
        // Only a fixed code may be surfaced; never propagate SQL/SMTP details.
        try { options.onError?.({ code: "MAIL_WORKER_FAILED" }); } catch {}
      }).finally(() => {
        active = null;
        schedule(intervalMilliseconds);
      });
    }, delay);
    timer.unref();
  }
  schedule(0);
  let closing;
  return Object.freeze({
    close() {
      if (closing) return closing;
      closed = true;
      if (timer) clearTimeout(timer);
      closing = (async () => {
        if (active) await active;
        try { await options.transport.close(); } catch { throw new MailWorkerError(); }
      })();
      return closing;
    },
  });
}
