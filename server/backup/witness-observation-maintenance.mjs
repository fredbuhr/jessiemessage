import { acquireRecurringLock } from "./recurring-checkpoint-files.mjs";

const fail = () => { throw Object.assign(new Error("Witness-only maintenance was not confirmed."), { code: "WITNESS_OBSERVATION_MAINTENANCE" }); };

/** Exclusively for the non-destructive observer: no account-erasure owner is
 * installed. A failed PC exchange may resume the daily application only after
 * independently rechecking the original empty registry, configuration and
 * runtime. This is deliberately NOT an erasure/recovery startup barrier. */
export async function runWitnessObservationMaintenance({ runtime, directory, source, work, verifyResume, signal }, internal = {}) {
  if ([runtime?.state, runtime?.stop, runtime?.start, source, work, verifyResume].some(value => typeof value !== "function")) fail();
  let result, workFailure, workFailed = false, stopped = false, resumed = false, entered = false;
  const active = () => { if (signal?.aborted) fail(); };
  try { await (internal.lock ?? acquireRecurringLock)(directory, async lease => {
    const ready = async () => { active(); await source(); await lease.assertReady(); active(); };
    const assertQuiescent = async () => { await ready(); if (!stopped || resumed || runtime.state().status !== "stopped") fail(); };
    try {
      await ready(); if (entered || runtime.state().status !== "running") fail();
      entered = true;
      const receipt = await runtime.stop();
      if (receipt?.exitCode !== 0 || receipt.signal !== null) fail();
      stopped = true; await assertQuiescent();
      try { result = await work(assertQuiescent); } catch (error) { workFailed = true; workFailure = error; }
      // Work can consume an enrollment permission, but cannot modify SQL,
      // messages or erasure journals. A lost answer never unconsumes it.
      await assertQuiescent(); await verifyResume(assertQuiescent); await assertQuiescent();
      await runtime.start(); active();
      if (runtime.state().status !== "running") fail();
      await ready(); resumed = true;
    } catch {
      if (entered) { try { await runtime.stop(); } catch {} }
      fail();
    }
  }, { signal }); active(); } catch {
    if (entered) { try { await runtime.stop(); } catch {} }
    fail();
  }
  if (!resumed) fail();
  // Preserve a consumer's already-neutralized error only after successful
  // lease/descriptor cleanup and a verified daily-runtime restart.
  if (workFailed) throw workFailure;
  return result;
}
