import { opendir } from "node:fs/promises";
import { relative, sep } from "node:path";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { withConfiguredWitnessOrigin } from "./witness-origin-context.mjs";
import { readWitnessGenesisObservation } from "./witness-genesis.mjs";
import { createBackupCopyService } from "./copy-service.mjs";
import { createWitnessTransport } from "./witness-transport.mjs";
import { createErasureContinuity } from "./registry-continuity.mjs";
import { captureOperationalState } from "./operational-checkpoint.mjs";
import { registryHash, snapshotErasureRegistry } from "./registry-snapshot.mjs";
import { assertRuntimeSource } from "./recurring-supervisor.mjs";
import { createWitnessEnrollment, WitnessEnrollmentError } from "./witness-enrollment.mjs";
import { createWitnessEnrollmentHandler } from "./witness-enrollment-http.mjs";

const fail = () => { throw Object.assign(new Error("The original witness observer is unavailable."), { code: "WITNESS_OBSERVATION_UNAVAILABLE" }); };
const inside = (a, b) => { const p = relative(b, a); return p === "" || p !== ".." && !p.startsWith(`..${sep}`) && !p.startsWith(sep); };

/** Production composition for the original empty registry only. It cannot
 * construct an erasure owner, delete a journal, import SQL or authorize a
 * restored application. PC availability is observed, not a startup bypass. */
export async function createConfiguredWitnessObserver(options, { environment = process.env, signal, emit = () => {} } = {}, internal = {}) {
  const origin = internal.withOrigin ?? withConfiguredWitnessOrigin;
  const withDirectory = internal.withDirectory ?? withPrivateDirectory;
  const source = () => (internal.source ?? assertRuntimeSource)(options, { signal });
  const clock = internal.clock ?? Date.now, interval = internal.intervalMilliseconds ?? 60000;
  if (!/^[a-f0-9]{64}$/.test(options.witnessContractSha256 ?? "") || !Number.isSafeInteger(interval) || interval < 20 || interval > 60000) fail();
  const contractDirectory = `${options.witnessOperatorDirectory}/contract`, enrollmentDirectory = `${options.witnessOperatorDirectory}/enrollment`;
  const cancellation = new AbortController();
  let closed = false, observing = false, verifiedThisConnection = false, attached = null, onFailure = null, timer = null, checking = null, gate, enrollment, transport, enrollmentHttp, contract, configurationFingerprint;
  let observed = { state: "not_confirmed", lastVerifiedAt: null, externalWitnessConfirmed: false };
  const active = () => { if (closed || signal?.aborted || cancellation.signal.aborted) fail(); };
  const notice = state => {
    observed = { ...observed, state, externalWitnessConfirmed: state === "confirmed" };
    try { emit({ version: 1, type: "witness_observation", mode: "observe_only", checkedAt: clock(), ...observed, closuresEnabled: false }); } catch {}
  };
  async function bound(work) {
    active(); await source();
    return origin(options, { environment, signal: cancellation.signal }, async context => {
      active();
      if (inside(options.witnessOperatorDirectory, context.mediaRoot) || inside(context.mediaRoot, options.witnessOperatorDirectory)
        || configurationFingerprint !== undefined && context.configurationFingerprint !== configurationFingerprint) fail();
      const current = await (internal.readGenesis ?? readWitnessGenesisObservation)({ directory: contractDirectory,
        operationsDirectory: options.operationsDirectory, privateDirectory: options.privateDirectory, runtimeDirectory: options.runtimeDirectory,
        key: context.key, binding: context.binding, expectedContractSha256: options.witnessContractSha256, signal: cancellation.signal }, { withDirectory });
      if (contract !== undefined && JSON.stringify(current) !== JSON.stringify(contract)) fail();
      const state = await withDirectory(options.operationsDirectory, async scope => {
        const value = await (internal.captureState ?? captureOperationalState)(scope, { key: context.key, binding: context.binding, signal: cancellation.signal });
        const snapshot = snapshotErasureRegistry(value, context);
        if (snapshot.files.length !== 0 || registryHash(snapshot) !== current.initialSnapshotSha256) fail();
        await scope.assertReady(); return value;
      });
      await context.assertReady(); await source(); active();
      const result = await work(context, current, state);
      await context.assertReady(); active(); return result;
    });
  }
  const invalid = () => { if (!closed) { notice("original_unavailable"); onFailure?.(); } };
  const assertOriginal = async () => { try { return await bound(() => true); } catch (error) { invalid(); throw error; } };
  const maintain = work => {
    active(); if (typeof attached !== "function") return Promise.reject(new Error("Witness supervisor not attached."));
    return attached(work, assertOriginal);
  };
  const stop = () => close();
  try {
    let key, binding;
    try {
      await bound((context, current) => { contract = current; configurationFingerprint = context.configurationFingerprint;
        key = Buffer.from(context.key); binding = { ...context.binding }; });
      const copies = (internal.makeCopyService ?? createBackupCopyService)(options.operationsDirectory);
      transport = (internal.makeTransport ?? createWitnessTransport)({ ...contract.destination, registryId: contract.registryId,
        authorize: copies.authorizeWitness, provisioning: true });
      enrollment = (internal.makeEnrollment ?? createWitnessEnrollment)({ directory: enrollmentDirectory, contract,
        contractSha256: options.witnessContractSha256, key, assertOriginal, withMaintenance: maintain }, { withDirectory });
      gate = (internal.makeContinuity ?? createErasureContinuity)({ key, binding, readCurrent: () => bound((_context, _contract, state) => state),
        exchange: transport.exchange, timeoutMs: 30000 });
      enrollmentHttp = (internal.makeEnrollmentHandler ?? createWitnessEnrollmentHandler)({ enrollment, contract, authorize: copies.authorizeWitness });
      const handler = async (request, response) => await enrollmentHttp(request, response) || transport.handler(request, response);
      Object.defineProperty(handler, "close", { value: close });
      signal?.addEventListener("abort", stop, { once: true });

      async function checkInitial() {
        await assertOriginal();
        await withDirectory(enrollmentDirectory, async scope => {
          const entries = await opendir(scope.path); for await (const _entry of entries) fail(); await scope.assertReady();
        });
        active(); return { version: 1, type: "witness_enrollment_precheck", status: "passed", prepared: false, started: false, closuresEnabled: false };
      }
      async function check() {
        await assertOriginal(); await enrollment.check(); active();
        return { version: 1, type: "witness_observer_precheck", status: "passed", mode: "observe_only", started: false,
          externalWitnessConfirmed: false, closuresEnabled: false };
      }
      async function initialize() {
        active(); await enrollment.initialize(); await enrollment.check();
        return { version: 1, type: "witness_enrollment_authority_prepared", prepared: true,
          contractSha256: options.witnessContractSha256, genesisReplayed: false, closuresEnabled: false, externalWitnessConfirmed: false };
      }
      async function tick() {
        if (closed || checking) return checking;
        checking = (async () => {
          try {
            let authority;
            try { await assertOriginal(); authority = await enrollment.check(); }
            catch (error) {
              // An authenticated enrollment may already hold the exclusive
              // authority while this timer fires. It is not missing state.
              if (!(error instanceof WitnessEnrollmentError && error.code === "WITNESS_ENROLLMENT_BUSY")) invalid();
              return null;
            }
            if (!authority.spent) { notice("enrollment_required"); return null; }
            // Probe the PC before any interruption. A powered-off PC leaves
            // ordinary messages and scheduled captures entirely available.
            const probe = await gate.recover(assertOriginal, { signal: cancellation.signal });
            if (probe.witnessRevision !== 1 || probe.registrySha256 !== contract.initialSnapshotSha256 || probe.state.files.length !== 0) fail();
            // After the first real read/publish maintenance, later polls only
            // refresh the independent head observation. Do not drain the daily
            // server every minute. A lost connection requires a fresh full
            // verification on its return; every parent restart starts fresh.
            if (verifiedThisConnection) { notice("confirmed"); return null; }
            const proof = await maintain(async assertQuiescent => {
              await assertQuiescent(); await assertOriginal();
              const result = await gate.verify(async () => { await assertQuiescent(); await assertOriginal(); }, { signal: cancellation.signal });
              if (result.receipts !== 0 || result.witnessRevision !== 1 || result.registrySha256 !== contract.initialSnapshotSha256) fail();
              return result;
            });
            verifiedThisConnection = true; observed.lastVerifiedAt = clock(); notice("confirmed"); return proof;
          } catch {
            verifiedThisConnection = false;
            if (!closed) {
              try { await assertOriginal(); await enrollment.check(); }
              catch (error) {
                if (!(error instanceof WitnessEnrollmentError && error.code === "WITNESS_ENROLLMENT_BUSY")) invalid();
                return null;
              }
              notice("not_confirmed");
            }
            return null;
          }
        })().finally(() => { checking = null; });
        return checking;
      }
      function startObservation() {
        if (closed || observing || attached === null) fail();
        observing = true;
        const arm = () => { if (!closed) timer = setTimeout(() => { timer = null; void tick().finally(arm); }, interval); };
        void tick().finally(arm);
      }
      return Object.freeze({ handler, check, checkInitial, initialize, tick, startObservation, close,
        attachMaintenance(value, failure) {
          if (attached !== null || typeof value !== "function" || typeof failure !== "function" || closed) fail();
          attached = value; onFailure = failure;
        },
        state: () => Object.freeze({ ...observed, mode: "observe_only", closuresEnabled: false }) });
    } finally { key?.fill(0); }
  } catch (error) { close(); throw error; }

  function close() {
    if (closed) return;
    closed = true; clearTimeout(timer); cancellation.abort(); gate?.close(); transport?.close(); enrollmentHttp?.close(); enrollment?.close();
    signal?.removeEventListener("abort", stop);
  }
}
