import { mkdir } from "node:fs/promises";
import { relative, sep } from "node:path";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { withConfiguredWitnessOrigin } from "./witness-origin-context.mjs";
import { readWitnessGenesis } from "./witness-genesis.mjs";
import { createBackupCopyService } from "./copy-service.mjs";
import { createWitnessTransport } from "./witness-transport.mjs";
import { createWitnessEnrollment } from "./witness-enrollment.mjs";
import { createWitnessRecoveryControl, validateWitnessRecoveryEnvelope } from "./witness-recovery-control.mjs";
import { assertRuntimeSource } from "./recurring-supervisor.mjs";

const fail = () => { throw Object.assign(new Error("The original witness recovery parent is unavailable."), { code: "WITNESS_RECOVERY_UNAVAILABLE" }); };
const inside = (a, b) => { const value = relative(b, a); return value === "" || value !== ".." && !value.startsWith(`..${sep}`) && !value.startsWith(sep); };
const paths = new Set(["/api/backup-copy/witness/poll", "/api/backup-copy/witness/response"]);
function unavailable(response) {
  if (response.headersSent) { response.destroy(); return; }
  response.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", Connection: "close" });
  response.end('{"error":"witness_unavailable"}');
}

/** An explicit recovery-only parent under the original physical provenance.
 * It owns neither an application child nor initialization, registry publishing,
 * SQL restoration or startup authority. Local receipts may be nonempty/lost;
 * the original contract, pairing and spent enrollment must still exist. */
export async function createConfiguredWitnessRecovery(options, { environment = process.env, signal, emit = () => {} } = {}, internal = {}) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Reflect.ownKeys(options).some(name =>
    !Object.hasOwn(Object.getOwnPropertyDescriptor(options, name), "value")) || !/^[a-f0-9]{64}$/.test(options.witnessContractSha256 ?? "")) fail();
  const selected = Object.freeze({ ...options }), withDirectory = internal.withDirectory ?? withPrivateDirectory;
  const origin = internal.withOrigin ?? withConfiguredWitnessOrigin;
  const cancellation = new AbortController();
  const source = () => (internal.source ?? assertRuntimeSource)(selected, { signal: cancellation.signal });
  let contract, configurationFingerprint, transport, enrollment, recoveryControl, authorityChecking, starting, closing;
  let closed = false, started = false, recovering = false;
  const active = () => { if (closed || signal?.aborted || cancellation.signal.aborted) fail(); };
  const notice = () => { try { emit({ version: 1, type: "witness_recovery_parent_notice", status: "unavailable", mode: "recovery_only", closuresEnabled: false }); } catch {} };
  async function provenance(work = () => true) {
    active(); await source(); active();
    return origin(selected, { environment, signal: cancellation.signal }, async context => {
      active();
      if (inside(selected.witnessOperatorDirectory, context.mediaRoot) || inside(context.mediaRoot, selected.witnessOperatorDirectory)
        || configurationFingerprint !== undefined && context.configurationFingerprint !== configurationFingerprint) fail();
      const current = await (internal.readGenesis ?? readWitnessGenesis)({ directory: `${selected.witnessOperatorDirectory}/contract`,
        operationsDirectory: selected.operationsDirectory, privateDirectory: selected.privateDirectory, runtimeDirectory: selected.runtimeDirectory,
        key: context.key, binding: context.binding, expectedContractSha256: selected.witnessContractSha256, signal: cancellation.signal }, { withDirectory });
      if (contract !== undefined && JSON.stringify(current) !== JSON.stringify(contract)) fail();
      await context.assertReady(); await source(); active();
      const result = await work(context, current);
      await context.assertReady(); await source(); active(); return result;
    });
  }
  function authority() {
    active();
    // Concurrent PC polling and an operator read may share this in-flight
    // authentication, never a persisted or previously completed success.
    if (!authorityChecking) authorityChecking = (async () => {
      const result = await enrollment.readRecoveryAuthority();
      if (result?.spent !== true || result?.ready !== false) fail(); active();
    })().finally(() => { authorityChecking = null; });
    return authorityChecking;
  }
  async function recoverExchange(value, { signal: requestSignal } = {}) {
    active(); if (!started || recovering || requestSignal?.aborted) fail();
    const envelope = validateWitnessRecoveryEnvelope(value);
    if (envelope.contractSha256 !== selected.witnessContractSha256 || envelope.request.registryId !== contract.registryId
      || JSON.stringify(envelope.binding) !== JSON.stringify(contract.binding)) fail();
    recovering = true;
    try {
      await authority();
      const result = await provenance(async () => {
        const response = await transport.exchange(envelope.request, {
          signal: requestSignal === undefined ? cancellation.signal : AbortSignal.any([cancellation.signal, requestSignal]) });
        active(); if (requestSignal?.aborted) fail(); return response;
      });
      await authority(); active(); if (requestSignal?.aborted) fail(); return result;
    } catch { fail(); }
    finally { recovering = false; }
  }
  async function handler(request, response) {
    if (!paths.has(request.url)) return false;
    try { active(); if (!started) fail();
      // The transport checks origin/rate limits and the existing bearer first.
      // Its authorize wrapper rechecks provenance at every authenticated
      // boundary, including after long polling and before accepting a reply.
      await transport.handler(request, response); active();
    } catch { unavailable(response); }
    return true;
  }
  Object.defineProperty(handler, "close", { value: close });
  async function check() {
    try {
      await authority(); active();
      return { version: 1, type: "witness_recovery_precheck", status: "passed", mode: "recovery_only", started: false,
        closuresEnabled: false, externalWitnessConfirmed: false };
    } catch { fail(); }
  }
  async function start() {
    active(); if (starting) return starting;
    starting = (async () => {
      try {
        await check();
        await withDirectory(selected.witnessOperatorDirectory, async scope => {
          await scope.assertReady();
          try { await mkdir(scope.file("control"), { mode: 0o700 }); await scope.sync(); }
          catch (error) { if (error.code !== "EEXIST") throw error; }
          await scope.assertReady();
        });
        recoveryControl = await (internal.makeRecoveryControl ?? createWitnessRecoveryControl)({
          directory: `${selected.witnessOperatorDirectory}/control`, exchange: recoverExchange, signal: cancellation.signal });
        await check(); active(); started = true;
        return { version: 1, type: "witness_recovery_parent", status: "started", mode: "recovery_only", started: true,
          closuresEnabled: false, externalWitnessConfirmed: false };
      } catch {
        notice(); try { await recoveryControl?.close(); } catch {}
        try { await close(); } catch {} fail();
      }
    })();
    return starting;
  }
  const stop = () => { void close().catch(() => {}); };
  async function close() {
    if (closing) return closing;
    closed = true; started = false; cancellation.abort(); signal?.removeEventListener("abort", stop);
    closing = (async () => {
      let failed = false;
      for (const component of [transport, enrollment, recoveryControl]) {
        try { await component?.close(); } catch { failed = true; }
      }
      if (failed) fail();
    })();
    return closing;
  }
  signal?.addEventListener("abort", stop, { once: true });
  let key;
  try {
    await provenance((context, original) => {
      contract = original; configurationFingerprint = context.configurationFingerprint; key = Buffer.from(context.key);
    });
    active();
    const copies = (internal.makeCopyService ?? createBackupCopyService)(selected.operationsDirectory);
    transport = (internal.makeTransport ?? createWitnessTransport)({ ...contract.destination, registryId: contract.registryId,
      authorize: async token => {
        const identity = await copies.authorizeWitness(token); await authority(); active(); return identity;
      }, provisioning: false });
    enrollment = (internal.makeEnrollment ?? createWitnessEnrollment)({ directory: `${selected.witnessOperatorDirectory}/enrollment`,
      contract, contractSha256: selected.witnessContractSha256, key,
      // These capabilities can never perform initialization/reservation here.
      assertOriginal: async () => fail(), withMaintenance: async () => fail(), assertProvenance: provenance }, { withDirectory });
    await check(); active();
    return Object.freeze({ check, start, handler, close });
  } catch { try { await close(); } catch {} fail(); }
  finally { key?.fill(0); }
}
