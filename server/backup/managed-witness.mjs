import { witnessOriginErrorCode, witnessOriginFailure } from "./witness-origin-diagnostics.mjs";

const fail = () => { throw Object.assign(new Error("Managed witness preparation was not confirmed."), { code: "WITNESS_ORIGIN_MAINTENANCE" }); };

/** The core enters this wrapper only while it owns the capture lease. A real
 * child's zero exit, not a caller's offline flag, establishes quiescence.
 * Errors after any stop never resume a potentially uncertain preparation. */
export async function runManagedWitnessPreparation({ runtime, operations, source, signal, emit = () => {} }) {
  if ([runtime?.stop, runtime?.start, runtime?.state, operations?.check, operations?.prepare, source].some(fn => typeof fn !== "function")) fail();
  let leasedReady = null, entered = false, stopped = false, resumed = false;
  let phase = "precheck";
  const notice = (event, error) => {
    try { emit({ version: 1, type: "witness_origin_progress", phase, event,
      ...(error === undefined ? {} : { code: witnessOriginErrorCode(error, "WITNESS_ORIGIN_MAINTENANCE") }) }); } catch {}
  };
  const active = () => { if (signal?.aborted) fail(); };
  const ready = async () => { active(); await source(); await leasedReady?.(); active(); };
  const assertQuiescent = async () => {
    if (!entered || !stopped || resumed || !leasedReady) fail();
    await ready(); if (runtime.state().status !== "stopped") fail();
  };
  try {
    notice("started"); active(); await operations.check(); await ready(); notice("passed"); phase = "lease"; notice("started");
    const result = await operations.prepare({ assertQuiescent, async withMaintenance(work, leaseReady) {
      if (entered || typeof work !== "function" || typeof leaseReady !== "function" || runtime.state().status !== "running") fail();
      entered = true; leasedReady = leaseReady; await ready(); notice("passed"); phase = "stop"; notice("started");
      const receipt = await runtime.stop();
      if (receipt?.exitCode !== 0 || receipt.signal !== null) fail();
      stopped = true; await assertQuiescent(); notice("passed"); phase = "publication"; notice("started");
      const prepared = await work();
      if (prepared?.prepared !== true || prepared.externalWitnessConfirmed !== false || prepared.closuresEnabled !== false
        || typeof prepared.contractSha256 !== "string" || !/^[a-f0-9]{64}$/.test(prepared.contractSha256)) fail();
      await assertQuiescent(); notice("passed"); phase = "resume"; notice("started"); await runtime.start(); active();
      if (runtime.state().status !== "running") fail();
      await ready(); resumed = true; notice("passed"); phase = "cleanup"; notice("started"); return prepared;
    } });
    if (!entered || !resumed || result?.prepared !== true) fail(); active(); notice("passed");
    return Object.freeze({ version: 1, type: "witness_origin_prepared", prepared: true,
      contractSha256: result.contractSha256, runtimeResumed: true, externalWitnessConfirmed: false, closuresEnabled: false });
  } catch (error) {
    notice("failed", error);
    // Scope/descriptor cleanup can fail even after the lease callback resumed.
    // Do not leave that process running behind an unconfirmed final outcome.
    if (entered) { try { await runtime.stop(); } catch {} }
    throw witnessOriginFailure(error, "WITNESS_ORIGIN_MAINTENANCE");
  }
}
