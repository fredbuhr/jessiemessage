import { createHmac } from "node:crypto";
import { encryptMessageBody, messageFingerprint, videoMessageFingerprint } from "../chat/crypto.mjs";
import { openPayload, verifyRecipientProof } from "./crypto.mjs";

export class BroadcastWorkerError extends Error {
  constructor() { super("Private broadcasts worker could not complete its batch."); this.name = "BroadcastWorkerError"; this.code = "BROADCAST_WORKER_FAILED"; }
}
const bytes = (value) => Buffer.isBuffer(value) && value.length === 16;
// Observers receive only fixed operational state. They never own the worker's
// completion path, including when they return an asynchronously rejected value.
function observe(callback, event) {
  if (!callback) return;
  try { void Promise.resolve(callback(Object.freeze(event))).catch(() => {}); } catch {}
}
export function createBroadcastWorker({ store, authStore, key, videoEnabled = false, clock = Date.now, pollMilliseconds = 2000, batchSize = 5, onState, onError } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || typeof videoEnabled !== "boolean" || typeof clock !== "function" || !Number.isInteger(pollMilliseconds)
    || pollMilliseconds < 1000 || pollMilliseconds > 300000 || !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20
    || typeof authStore?.consumeRateLimit !== "function" || ["claim", "deliver", "defer", "fail"].some((method) => typeof store?.[method] !== "function")
    || onState !== undefined && typeof onState !== "function" || onError !== undefined && typeof onError !== "function") throw new BroadcastWorkerError();
  key = Buffer.from(key);
  let active = null, timer = null, started = false, stopped = false, stopping = null;
  function now() { const value = clock(); if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) throw new BroadcastWorkerError(); return value; }
  async function batch() {
    const result = { delivered: 0, deferred: 0, failed: 0 };
    let errors = 0;
    try {
      for (let index = 0; index < batchSize && !stopped; index += 1) {
        const job = await store.claim({ now: now() });
        if (!job) break;
        let deliveryStarted = false, returning = null;
        function returnUnstartedClaim() {
          if (!returning) returning = (async () => {
            const current = now();
            if (await store.defer(job, { now: current, availableAt: current })) result.deferred += 1;
          })();
          return returning;
        }
        if (stopped) { await returnUnstartedClaim(); break; }
        try {
          if (["campaignId", "adminId", "conversationId", "clientId", "messageId", "clientMessageId", "leaseToken"].some((field) => !bytes(job[field]))
            || !(job.mediaId === null || bytes(job.mediaId)) || typeof job.allowRepeatMedia !== "boolean") throw new BroadcastWorkerError();
          const payload = openPayload(job.payloadEncrypted, key, { campaignId: job.campaignId, adminId: job.adminId }, { video: videoEnabled });
          const member = payload.version >= 2 ? verifyRecipientProof(key, job, job.clientMessageId)
            : payload.conversationIds.includes(job.conversationId.toString("hex"));
          if (!member || payload.mediaId !== (job.mediaId?.toString("hex") ?? null)
            || payload.allowRepeatMedia !== job.allowRepeatMedia
            || (payload.version === 3 ? !bytes(job.videoId) || payload.videoId !== job.videoId.toString("hex") : job.videoId !== undefined)) throw new BroadcastWorkerError();
          const current = now(); let retryAfter = null;
          // Legacy jobs keep their original budgets. Compact campaigns have a
          // separate administrator budget, checked before the shared global
          // bucket, leaving normal manual-send capacity available.
          const budgets = payload.version >= 2
            ? [["jessiemessage:broadcast-delivery-rate:v2:", "user-send", job.adminId.toString("hex"), 120],
              ["jessiemessage:chat-rate:v1:", "global-send", "all", 300]]
            : [["jessiemessage:chat-rate:v1:", "global-send", "all", 300],
              ["jessiemessage:chat-rate:v1:", "user-send", job.adminId.toString("hex"), 30]];
          for (const [namespace, name, identity, limit] of budgets) {
            if (stopped) break;
            const bucket = createHmac("sha256", key).update(namespace).update(name).update("\0").update(identity).digest();
            const budget = await authStore.consumeRateLimit(bucket, { now: current, windowSeconds: 60, limit });
            if (stopped) break;
            if (!budget || typeof budget.allowed !== "boolean") throw new BroadcastWorkerError();
            if (!budget.allowed) { retryAfter = Number.isFinite(budget.retryAfter) ? Math.max(1, Math.min(3600, Math.ceil(budget.retryAfter))) : 60; break; }
          }
          if (stopped) { await returnUnstartedClaim(); break; }
          if (retryAfter !== null) {
            if (await store.defer(job, { now: current, availableAt: current + retryAfter * 1000 })) result.deferred += 1;
            continue;
          }
          const binding = { messageId: job.messageId, conversationId: job.conversationId, senderId: job.adminId };
          const body = payload.version === 3 ? JSON.stringify({ videoId: payload.videoId, caption: payload.body }) : payload.mediaId === null ? payload.body : JSON.stringify({ mediaId: payload.mediaId, caption: payload.body });
          const message = { id: job.messageId, clientMessageId: job.clientMessageId,
            bodyEncrypted: encryptMessageBody(body, key, binding), bodyFingerprint: payload.version === 3 ? videoMessageFingerprint(body, key, binding) : messageFingerprint(body, key, binding),
            ...(job.mediaId === null ? {} : { mediaId: job.mediaId }), ...(payload.version === 3 ? { videoId: job.videoId } : {}) };
          const deliveryAt = now();
          if (stopped) { await returnUnstartedClaim(); break; }
          deliveryStarted = true;
          const delivered = await store.deliver(job, { now: deliveryAt, message });
          if (!delivered || typeof delivered.delivered !== "boolean") throw new BroadcastWorkerError();
          if (delivered.delivered) result.delivered += 1;
        } catch {
          // Return an unstarted reservation immediately without spending a
          // processing attempt. Once delivery began its commit result can be
          // uncertain, so keep the ordinary lease-CAS failure handling.
          if (stopped && !deliveryStarted) { await returnUnstartedClaim(); break; }
          // A lost commit acknowledgement can make the failure CAS a no-op.
          // Keep its existing delivery counters while exposing the degraded
          // processing observation without a recipient, cause or job detail.
          errors += 1;
          // A commit may have succeeded before a lost acknowledgement. The
          // lease CAS in fail then does nothing to that delivered recipient.
          if (await store.fail(job, { now: now() })) result.failed += 1;
        }
      }
      return { result, errors };
    } catch { throw new BroadcastWorkerError(); }
  }
  function runOnce() {
    if (stopped) return Promise.reject(new BroadcastWorkerError());
    if (!active) {
      active = batch().then(({ result, errors }) => {
        observe(onState, { state: "idle", counts: Object.freeze({ ...result, errors }) });
        return result;
      }, () => {
        observe(onState, { state: "error", code: "BROADCAST_WORKER_FAILED" });
        observe(onError, { code: "BROADCAST_WORKER_FAILED" });
        throw new BroadcastWorkerError();
      }).finally(() => { active = null; });
      observe(onState, { state: "running" });
    }
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
    stop() {
      if (stopping) return stopping;
      stopped = true; if (timer) clearTimeout(timer); timer = null;
      const drained = active ? active.then(() => {}, () => {}) : Promise.resolve();
      stopping = drained.then(() => { observe(onState, { state: "stopped" }); });
      observe(onState, { state: "stopping" });
      return stopping;
    },
  });
}
