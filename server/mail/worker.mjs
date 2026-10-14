import { openVerificationPayload } from "./crypto.mjs";
import { openResetPayload } from "../reset/mail-crypto.mjs";

export class MailWorkerError extends Error {
  constructor() {
    super("Private email worker could not complete its batch.");
    this.name = "MailWorkerError";
    this.code = "MAIL_WORKER_FAILED";
  }
}

export async function runMailBatch({ store, transport, key, clock = Date.now, batchSize = 5, purpose = "verification" }) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20
    || typeof clock !== "function" || !["verification", "password-reset"].includes(purpose)) throw new MailWorkerError();
  const openPayload = purpose === "password-reset" ? openResetPayload : openVerificationPayload;
  const deliveryMethod = purpose === "password-reset" ? "sendPasswordReset" : "sendVerification";
  let sent = 0;
  let failed = 0;
  try {
    for (let index = 0; index < batchSize; index += 1) {
      const job = await store.claim({ now: clock() });
      if (!job) break;
      let payload;
      try {
        payload = openPayload(job.payloadEncrypted, key, job.id);
        if (payload.email !== job.recipientEmail) throw new Error();
      } catch {
        await store.markFailed(job.id, job.leaseToken, { now: clock(), code: "PAYLOAD_INVALID", permanent: true });
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
    await store.prune({ now: clock() });
    return { sent, failed };
  } catch { throw new MailWorkerError(); }
}

export function startMailWorker(options) {
  const intervalMilliseconds = options.intervalMilliseconds ?? 15000;
  const closeTransport = options.closeTransport === undefined ? true : options.closeTransport;
  const purpose = options.purpose === undefined ? "verification" : options.purpose;
  if (!Number.isInteger(intervalMilliseconds) || intervalMilliseconds < 1000 || intervalMilliseconds > 300000
    || typeof closeTransport !== "boolean" || !["verification", "password-reset"].includes(purpose)) throw new MailWorkerError();
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
        if (closeTransport) {
          try { await options.transport.close(); } catch { throw new MailWorkerError(); }
        }
      })();
      return closing;
    },
  });
}
