import { acquireRecurringLock } from "./recurring-checkpoint-files.mjs";
import { failErasure } from "../data/erasure-state.mjs";

/** The caller holds the existing capture exclusion. No saved proof or pending
 * flag authorizes a reopen; every owner supplies a new verified startup check. */
async function resumeCheckedRuntime({ runtime, operations, assertReady, signal }, checkProof) {
  if ([runtime?.state, runtime?.stop, runtime?.start, operations?.verifyStartup, assertReady].some(value => typeof value !== "function")) failErasure("ERASURE_INPUT");
  const ready = async () => { if (signal?.aborted) failErasure("ERASURE_ABORTED"); await assertReady(); if (signal?.aborted) failErasure("ERASURE_ABORTED"); };
  const assertQuiescent = async () => { await ready(); if (runtime.state().status !== "stopped") failErasure("ERASURE_MAINTENANCE"); };
  let attempted = false;
  try {
    await assertQuiescent(); const proof = await operations.verifyStartup(assertQuiescent, { signal });
    if (!checkProof(proof)) failErasure("ERASURE_MAINTENANCE");
    await assertQuiescent(); attempted = true; await runtime.start(); await ready();
    if (runtime.state().status !== "running") failErasure("ERASURE_MAINTENANCE");
    return { ready: true };
  } catch (error) {
    if (attempted) { try { await runtime.stop(); } catch {} }
    throw error;
  }
}

/** Historical witnessed composition: an application-only report cannot satisfy it. */
export async function resumeManagedClosureRuntime(options) {
  return resumeCheckedRuntime(options, proof => proof?.verified === true && Number.isSafeInteger(proof.completedReceipts) && proof.completedReceipts >= 0
    && /^[a-f0-9]{64}$/.test(proof.registrySha256 ?? "") && Number.isSafeInteger(proof.witnessRevision) && proof.witnessRevision >= 1);
}

/** Explicit local composition, without fabricated witness fields or freshness. */
export async function resumeManagedLocalClosureRuntime(options) {
  return resumeCheckedRuntime(options, proof => proof && Object.getPrototypeOf(proof) === Object.prototype
    && Reflect.ownKeys(proof).length === 3 && ["verified", "completedReceipts", "scope"].every(name => Object.hasOwn(proof, name)
      && Object.hasOwn(Object.getOwnPropertyDescriptor(proof, name), "value"))
    && proof.verified === true && Number.isSafeInteger(proof.completedReceipts) && proof.completedReceipts >= 0 && proof.scope === "local_application");
}

/** A real managed-process stop, under the same on-disk exclusion as captures.
 * A failed drain, uncertain acknowledgement, cancellation or changed source
 * leaves the runtime stopped. There is no destructive retry in this cycle. */
export async function runManagedClosures({ runtime, operations, directory, source, signal, resumeClosures = resumeManagedClosureRuntime }, internal = {}) {
  if (typeof runtime?.stop !== "function" || typeof runtime?.start !== "function" || typeof runtime?.state !== "function"
    || [operations?.preflight, operations?.run, operations?.verifyStartup, source, resumeClosures].some(value => typeof value !== "function")) failErasure("ERASURE_INPUT");
  const active = () => { if (signal?.aborted) failErasure("ERASURE_ABORTED"); };
  let reopening = false;
  try { return await (internal.lock ?? acquireRecurringLock)(directory, async lease => {
    if (typeof lease?.assertReady !== "function") failErasure("ERASURE_MAINTENANCE");
    const ready = async () => { active(); await source(); await lease.assertReady(); active(); };
    await operations.preflight(ready); await ready();
    const stopped = await runtime.stop();
    if (stopped?.exitCode !== 0 || stopped.signal !== null) failErasure("ERASURE_MAINTENANCE");
    const assertQuiescent = async () => {
      await ready(); if (runtime.state().status !== "stopped") failErasure("ERASURE_MAINTENANCE");
    };
    await assertQuiescent(); const result = await operations.run(assertQuiescent);
    reopening = true; await resumeClosures({ runtime, operations, assertReady: ready, signal });
    return result;
  }, { signal }); }
  catch (error) {
    // The lock also checks descriptors and removes its durable exclusion after
    // work returns. A failed cleanup invalidates an already-opened child.
    if (reopening) { try { await runtime.stop(); } catch {} }
    throw error;
  }
}
