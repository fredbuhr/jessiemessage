const fail = () => { throw Object.assign(new Error("Managed witness preparation was not confirmed."), { code: "WITNESS_ORIGIN_MAINTENANCE" }); };

/** The core enters this wrapper only while it owns the capture lease. A real
 * child's zero exit, not a caller's offline flag, establishes quiescence.
 * Errors after any stop never resume a potentially uncertain preparation. */
export async function runManagedWitnessPreparation({ runtime, operations, source, signal }) {
  if ([runtime?.stop, runtime?.start, runtime?.state, operations?.check, operations?.prepare, source].some(fn => typeof fn !== "function")) fail();
  let leasedReady = null, entered = false, stopped = false, resumed = false;
  const active = () => { if (signal?.aborted) fail(); };
  const ready = async () => { active(); await source(); await leasedReady?.(); active(); };
  const assertQuiescent = async () => {
    if (!entered || !stopped || resumed || !leasedReady) fail();
    await ready(); if (runtime.state().status !== "stopped") fail();
  };
  try {
    active(); await operations.check(); await ready();
    const result = await operations.prepare({ assertQuiescent, async withMaintenance(work, leaseReady) {
      if (entered || typeof work !== "function" || typeof leaseReady !== "function" || runtime.state().status !== "running") fail();
      entered = true; leasedReady = leaseReady; await ready();
      const receipt = await runtime.stop();
      if (receipt?.exitCode !== 0 || receipt.signal !== null) fail();
      stopped = true; await assertQuiescent();
      const prepared = await work();
      if (prepared?.prepared !== true || prepared.externalWitnessConfirmed !== false || prepared.closuresEnabled !== false
        || typeof prepared.contractSha256 !== "string" || !/^[a-f0-9]{64}$/.test(prepared.contractSha256)) fail();
      await assertQuiescent(); await runtime.start(); active();
      if (runtime.state().status !== "running") fail();
      await ready(); resumed = true; return prepared;
    } });
    if (!entered || !resumed || result?.prepared !== true) fail(); active();
    return Object.freeze({ version: 1, type: "witness_origin_prepared", prepared: true,
      contractSha256: result.contractSha256, runtimeResumed: true, externalWitnessConfirmed: false, closuresEnabled: false });
  } catch {
    // Scope/descriptor cleanup can fail even after the lease callback resumed.
    // Do not leave that process running behind an unconfirmed final outcome.
    if (entered) { try { await runtime.stop(); } catch {} }
    fail();
  }
}
