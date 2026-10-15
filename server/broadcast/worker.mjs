import { createHmac } from "node:crypto";
import { encryptMessageBody, messageFingerprint } from "../chat/crypto.mjs";
import { openPayload } from "./crypto.mjs";

export class BroadcastWorkerError extends Error {
  constructor() { super("Private broadcasts worker could not complete its batch."); this.name = "BroadcastWorkerError"; this.code = "BROADCAST_WORKER_FAILED"; }
}
const bytes = (value) => Buffer.isBuffer(value) && value.length === 16;
export function createBroadcastWorker({ store, authStore, key, clock = Date.now, pollMilliseconds = 2000, batchSize = 5 } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || typeof clock !== "function" || !Number.isInteger(pollMilliseconds)
    || pollMilliseconds < 1000 || pollMilliseconds > 300000 || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20
    || typeof authStore?.consumeRateLimit !== "function" || ["claim", "deliver", "defer", "fail"].some((method) => typeof store?.[method] !== "function")) throw new BroadcastWorkerError();
  key = Buffer.from(key);
  let active = null, timer = null, started = false, stopped = false;
  function now() { const value = clock(); if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) throw new BroadcastWorkerError(); return value; }
  async function batch() {
    const result = { delivered: 0, deferred: 0, failed: 0 };
    try {
      for (let index = 0; index < batchSize && !stopped; index += 1) {
        const job = await store.claim({ now: now() });
        if (!job) break;
        try {
          if (["campaignId", "adminId", "conversationId", "clientId", "messageId", "clientMessageId", "leaseToken"].some((field) => !bytes(job[field]))
            || !(job.mediaId === null || bytes(job.mediaId)) || typeof job.allowRepeatMedia !== "boolean") throw new BroadcastWorkerError();
          const payload = openPayload(job.payloadEncrypted, key, { campaignId: job.campaignId, adminId: job.adminId });
          if (!payload.conversationIds.includes(job.conversationId.toString("hex")) || payload.mediaId !== (job.mediaId?.toString("hex") ?? null)
            || payload.allowRepeatMedia !== job.allowRepeatMedia) throw new BroadcastWorkerError();
          const current = now(); let retryAfter = null;
          // Share precisely the normal chat send buckets, including their key.
          for (const [name, identity, limit] of [["global-send", "all", 300], ["user-send", job.adminId.toString("hex"), 30]]) {
            const bucket = createHmac("sha256", key).update("jessiemessage:chat-rate:v1:").update(name).update("\0").update(identity).digest();
            const budget = await authStore.consumeRateLimit(bucket, { now: current, windowSeconds: 60, limit });
            if (!budget || typeof budget.allowed !== "boolean") throw new BroadcastWorkerError();
            if (!budget.allowed) { retryAfter = Number.isFinite(budget.retryAfter) ? Math.max(1, Math.min(3600, Math.ceil(budget.retryAfter))) : 60; break; }
          }
          if (retryAfter !== null) {
            if (await store.defer(job, { now: current, availableAt: current + retryAfter * 1000 })) result.deferred += 1;
            continue;
          }
          const binding = { messageId: job.messageId, conversationId: job.conversationId, senderId: job.adminId };
          const body = payload.mediaId === null ? payload.body : JSON.stringify({ mediaId: payload.mediaId, caption: payload.body });
          const message = { id: job.messageId, clientMessageId: job.clientMessageId,
            bodyEncrypted: encryptMessageBody(body, key, binding), bodyFingerprint: messageFingerprint(body, key, binding),
            ...(job.mediaId === null ? {} : { mediaId: job.mediaId }) };
          const delivered = await store.deliver(job, { now: now(), message });
          if (!delivered || typeof delivered.delivered !== "boolean") throw new BroadcastWorkerError();
          if (delivered.delivered) result.delivered += 1;
        } catch {
          // A commit may have succeeded before a lost acknowledgement. The
          // lease CAS in fail then does nothing to that delivered recipient.
          if (await store.fail(job, { now: now() })) result.failed += 1;
        }
      }
      return result;
    } catch { throw new BroadcastWorkerError(); }
  }
  function runOnce() {
    if (stopped) return Promise.reject(new BroadcastWorkerError());
    if (!active) active = batch().finally(() => { active = null; });
    return active;
  }
  function schedule(delay) {
    if (stopped || !started) return;
    timer = setTimeout(() => { timer = null; void runOnce().catch(() => {}).finally(() => schedule(pollMilliseconds)); }, delay);
    timer.unref();
  }
  return Object.freeze({
    runOnce,
    start() { if (stopped) throw new BroadcastWorkerError(); if (!started) { started = true; schedule(0); } },
    async stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; if (active) await active.catch(() => {}); },
  });
}
