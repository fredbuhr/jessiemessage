import { acquireRecurringLock } from "./recurring-checkpoint-files.mjs";
import { failErasure } from "../data/erasure-state.mjs";

/** A real managed-process stop, under the same on-disk exclusion as captures.
 * A failed drain, uncertain acknowledgement, cancellation or changed source
 * leaves the runtime stopped. There is no destructive retry in this cycle. */
export async function runManagedClosures({ runtime, operations, directory, source, signal }, internal = {}) {
  if (typeof runtime?.stop !== "function" || typeof runtime?.start !== "function" || typeof runtime?.state !== "function"
    || typeof operations?.preflight !== "function" || typeof operations?.run !== "function" || typeof source !== "function") failErasure("ERASURE_INPUT");
  const active = () => { if (signal?.aborted) failErasure("ERASURE_ABORTED"); };
  return (internal.lock ?? acquireRecurringLock)(directory, async lease => {
    if (typeof lease?.assertReady !== "function") failErasure("ERASURE_MAINTENANCE");
    const ready = async () => { active(); await source(); await lease.assertReady(); active(); };
    await operations.preflight(ready); await ready();
    const stopped = await runtime.stop();
    if (stopped?.exitCode !== 0 || stopped.signal !== null) failErasure("ERASURE_MAINTENANCE");
    const assertQuiescent = async () => {
      await ready(); if (runtime.state().status !== "stopped") failErasure("ERASURE_MAINTENANCE");
    };
    await assertQuiescent(); const result = await operations.run(assertQuiescent);
    await assertQuiescent(); await runtime.start(); active();
    if (runtime.state().status !== "running") failErasure("ERASURE_MAINTENANCE");
    return result;
  }, { signal });
}
