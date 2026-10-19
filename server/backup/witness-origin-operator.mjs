import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { opendir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { createPrivateJsonStore } from "../files/private-json.mjs";
import { erasureBinding } from "../data/erasure-state.mjs";
import { captureOperationalState } from "./operational-checkpoint.mjs";
import { readCopyState } from "./copy-files.mjs";
import { acquireRecurringLock } from "./recurring-checkpoint-files.mjs";
import { assertRuntimeSource } from "./recurring-supervisor.mjs";
import { registryFields, registryHash, snapshotErasureRegistry } from "./registry-snapshot.mjs";
import { prepareWitnessGenesis, readWitnessGenesis } from "./witness-genesis.mjs";
import { withConfiguredWitnessOrigin } from "./witness-origin-context.mjs";
import { witnessOriginFailure } from "./witness-origin-diagnostics.mjs";

export const WITNESS_ORIGIN_PLAN = "witness-origin-plan.json";
const PURPOSE = "jessiemessage:witness-origin-plan:https://jessiemessage.com:v1", HOUR = 3600000;
const REPOSITORY = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const hash = value => createHash("sha256").update(value).digest("hex");
const hex = (value, size = 64) => typeof value === "string" && new RegExp(`^[a-f0-9]{${size}}$`).test(value);
const absolute = value => typeof value === "string" && value.startsWith("/") && value !== "/" && value === resolve(value)
  && value.length <= 4096 && !/[\\\x00-\x1f\x7f]/.test(value);
const inside = (a, b) => { const part = relative(b, a); return part === "" || part !== ".." && !part.startsWith(`..${sep}`) && !part.startsWith(sep); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const time = value => Number.isSafeInteger(value) && value > 0 && value <= 253402300799999;
export class WitnessOriginError extends Error {
  constructor(code = "UNAVAILABLE") {
    super("The initial witness origin operation was not confirmed."); this.name = "WitnessOriginError";
    this.code = `WITNESS_ORIGIN_${["UNAVAILABLE", "INPUT", "MISSING", "CHANGED", "EXPIRED", "NOT_EMPTY", "PAIRING", "ABORTED"].includes(code) ? code : "UNAVAILABLE"}`;
  }
}
const fail = code => { throw new WitnessOriginError(code); };
const safe = async work => { try { return await work(); } catch (error) { throw witnessOriginFailure(error); } };
function fields(value, names) { try { registryFields(value, names); } catch { fail("INPUT"); } }
function plan(value) {
  fields(value, ["version", "purpose", "createdAt", "expiresAt", "operatorDirectory", "runtime", "privateDirectory", "operationsDirectory", "observed"]);
  fields(value.runtime, ["directory", "head", "tree"]);
  fields(value.observed, ["binding", "sourceIdentity", "destination", "configurationFingerprint", "registrySha256"]);
  const o = value.observed; fields(o.sourceIdentity, ["dev", "ino"]); fields(o.destination, ["destinationId", "pairedAt", "pairingFingerprint"]);
  if (value.version !== 1 || value.purpose !== "initial_only_operator_provenance_required" || !time(value.createdAt)
    || !time(value.expiresAt) || value.expiresAt !== value.createdAt + HOUR
    || ![value.operatorDirectory, value.runtime.directory, value.privateDirectory, value.operationsDirectory].every(absolute)
    || !hex(value.runtime.head, 40) || !hex(value.runtime.tree, 40)
    || [o.sourceIdentity.dev, o.sourceIdentity.ino].some(x => typeof x !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(x))
    || o.sourceIdentity.ino === "0" || !hex(o.destination.destinationId, 32) || !time(o.destination.pairedAt)
    || !hex(o.destination.pairingFingerprint) || !hex(o.configurationFingerprint) || !hex(o.registrySha256)) fail("INPUT");
  return { version: 1, purpose: value.purpose, createdAt: value.createdAt, expiresAt: value.expiresAt,
    operatorDirectory: value.operatorDirectory, runtime: { directory: value.runtime.directory, head: value.runtime.head, tree: value.runtime.tree },
    privateDirectory: value.privateDirectory, operationsDirectory: value.operationsDirectory, observed: {
      binding: erasureBinding(o.binding), sourceIdentity: { dev: o.sourceIdentity.dev, ino: o.sourceIdentity.ino },
      destination: { destinationId: o.destination.destinationId, pairedAt: o.destination.pairedAt, pairingFingerprint: o.destination.pairingFingerprint },
      configurationFingerprint: o.configurationFingerprint, registrySha256: o.registrySha256 } };
}
function state(value) {
  fields(value, ["version", "revision", "plan", "authentication"]);
  if (value.version !== 1 || ![0, 1].includes(value.revision)) fail("INPUT");
  if (value.plan === null && value.authentication === null && value.revision === 0) return { version: 1, revision: 0, plan: null, authentication: null };
  if (!hex(value.authentication)) fail("INPUT");
  return { version: 1, revision: value.revision, plan: plan(value.plan), authentication: value.authentication };
}
const plans = createPrivateJsonStore({ name: WITNESS_ORIGIN_PLAN, lock: "witness-origin-plan.lock", maxBytes: 16384,
  validate: state, empty: () => ({ version: 1, revision: 0, plan: null, authentication: null }),
  fail: () => fail(), isKnownError: error => error instanceof WitnessOriginError });
function mac(value, key) {
  const derived = Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), Buffer.from(PURPOSE), 32));
  try { return createHmac("sha256", derived).update(JSON.stringify(value)).digest("hex"); } finally { derived.fill(0); }
}

/** An operator explicitly chooses initial preparation against its independently
 * established original service. The plan records and pins that source; an
 * empty current directory alone never establishes historical provenance.
 * No normal start, browser request, timer or recovery invokes plan/prepare. */
export function createWitnessOriginOperations(options, { environment = process.env, signal } = {}, internal = {}) {
  const withDirectory = internal.withDirectory ?? withPrivateDirectory, clock = internal.clock ?? Date.now;
  const source = () => (internal.source ?? assertRuntimeSource)(options, { signal });
  const origin = work => (internal.withOrigin ?? withConfiguredWitnessOrigin)(options, { environment, signal }, work);
  const directory = options.witnessOperatorDirectory, contractDirectory = `${directory}/contract`;
  const active = () => { if (signal?.aborted) fail("ABORTED"); };
  const runtime = { directory: options.runtimeDirectory, head: options.runtimeHead, tree: options.runtimeTree };
  const roots = [directory, options.runtimeDirectory, options.privateDirectory, options.operationsDirectory, REPOSITORY];
  if (!absolute(directory) || roots.slice(1).some(root => !absolute(root) || inside(directory, root) || inside(root, directory))) fail("INPUT");
  async function emptyContract() {
    return withDirectory(contractDirectory, async scope => { await scope.assertReady(); const entries = await opendir(scope.path);
      for await (const _entry of entries) fail("NOT_EMPTY"); await scope.assertReady(); });
  }
  async function observe(context, destinationId) {
    active(); await source(); await context.assertReady();
    if (inside(directory, context.mediaRoot) || inside(context.mediaRoot, directory)) fail("INPUT");
    return withDirectory(options.operationsDirectory, async scope => {
      const before = await scope.assertReady();
      const snapshot = snapshotErasureRegistry(await captureOperationalState(scope, { key: context.key, binding: context.binding, signal }), context);
      if (snapshot.files.length !== 0) fail("NOT_EMPTY");
      const copies = await readCopyState(options.operationsDirectory, { withDirectory: (_directory, work) => work(scope) });
      const item = copies.destinations.find(value => value.id === destinationId);
      if (!item || !item.enabled || item.tokenHash === null || !time(item.pairedAt)) fail("PAIRING");
      const after = await scope.assertReady();
      if (before.dev !== after.dev || before.ino !== after.ino) fail("CHANGED");
      await context.assertReady(); active();
      return { binding: erasureBinding(context.binding), sourceIdentity: { dev: String(before.dev), ino: String(before.ino) },
        destination: { destinationId: item.id, pairedAt: item.pairedAt, pairingFingerprint: item.tokenHash },
        configurationFingerprint: context.configurationFingerprint, registrySha256: registryHash(snapshot) };
    });
  }
  async function read(context) {
    active(); const current = await plans.read(directory, { withDirectory });
    if (current.revision !== 1 || current.plan === null) fail("MISSING");
    if (!hex(options.witnessPlanSha256) || hash(`${JSON.stringify(current)}\n`) !== options.witnessPlanSha256
      || !timingSafeEqual(Buffer.from(current.authentication, "hex"), Buffer.from(mac(current.plan, context.key), "hex"))) fail("CHANGED");
    const value = current.plan, now = clock();
    if (!time(now) || now < value.createdAt || now >= value.expiresAt) fail("EXPIRED");
    if (value.operatorDirectory !== directory || !equal(value.runtime, runtime) || value.privateDirectory !== options.privateDirectory
      || value.operationsDirectory !== options.operationsDirectory) fail("CHANGED");
    if (!equal(await observe(context, value.observed.destination.destinationId), value.observed)) fail("CHANGED");
    return value;
  }
  return Object.freeze({
    async plan() {
      return safe(() => origin(async context => {
        if (!hex(options.witnessDestination, 32)) fail("INPUT");
        await emptyContract(); let failure;
        const result = await (internal.lock ?? acquireRecurringLock)(options.operationsDirectory, async lease => {
          try {
            await lease.assertReady(); const observed = await observe(context, options.witnessDestination), now = clock();
            const value = plan({ version: 1, purpose: "initial_only_operator_provenance_required", createdAt: now, expiresAt: now + HOUR,
              operatorDirectory: directory, runtime, privateDirectory: options.privateDirectory, operationsDirectory: options.operationsDirectory, observed });
            const saved = await plans.save(directory, { version: 1, revision: 0, plan: value, authentication: mac(value, context.key) }, 0, { withDirectory });
            await lease.assertReady(); await emptyContract();
            if (!equal(await observe(context, options.witnessDestination), observed)) fail("CHANGED");
            active(); return { version: 1, type: "witness_origin_plan", planSha256: hash(`${JSON.stringify(saved)}\n`), expiresAt: value.expiresAt,
              operatorProvenanceRequired: true, prepared: false, started: false, closuresEnabled: false, externalWitnessConfirmed: false };
          } catch (error) { failure = error; return null; }
        }, { signal }, { withDirectory });
        if (failure) throw failure; return result;
      }));
    },
    async check() {
      return safe(() => origin(async context => {
        const value = await read(context); await emptyContract(); active();
        return { version: 1, type: "witness_origin_precheck", status: "passed", expiresAt: value.expiresAt,
          prepared: false, started: false, closuresEnabled: false, externalWitnessConfirmed: false };
      }));
    },
    async prepare({ assertQuiescent: assertStopped, withMaintenance }) {
      return safe(() => origin(async context => {
        if (typeof assertStopped !== "function" || typeof withMaintenance !== "function") fail("INPUT");
        const value = await read(context); await emptyContract();
        return prepareWitnessGenesis({ directory: contractDirectory, operationsDirectory: options.operationsDirectory,
          privateDirectory: options.privateDirectory, runtimeDirectory: options.runtimeDirectory, key: context.key,
          binding: value.observed.binding, sourceIdentity: value.observed.sourceIdentity, destination: value.observed.destination,
          signal, async assertQuiescent() { active(); await assertStopped(); await source(); await context.assertReady(); } }, {
          withDirectory, clock, withMaintenance: (work, leaseReady) => withMaintenance(async () => {
            await read(context); const result = await work();
            await read(context); await context.checkCapacity();
            const confirmed = await readWitnessGenesis({ directory: contractDirectory, operationsDirectory: options.operationsDirectory,
              privateDirectory: options.privateDirectory, runtimeDirectory: options.runtimeDirectory, key: context.key,
              binding: context.binding, expectedContractSha256: result.contractSha256, signal }, { withDirectory });
            if (confirmed.initialSnapshotSha256 !== value.observed.registrySha256 || !equal(confirmed.sourceIdentity, value.observed.sourceIdentity)) fail("CHANGED");
            return result;
          }, leaseReady),
        });
      }));
    },
  });
}
