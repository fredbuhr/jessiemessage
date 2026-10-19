import { createHash } from "node:crypto";
import { erasureBinding } from "../data/erasure-state.mjs";
import { assertCloneIdentity } from "./manifest.mjs";
import { operationalStateHash, planOperationalRestore, OperationalCheckpointError } from "./operational-checkpoint.mjs";
import { assertErasureContinuity } from "./registry-continuity.mjs";
import { authenticateRegistrySnapshot, ErasureContinuityError, registryHash, snapshotErasureRegistry } from "./registry-snapshot.mjs";

const HEX = /^[a-f0-9]{64}$/;
const hash = value => createHash("sha256").update(value).digest("hex");
export class ClosureReconciliationError extends OperationalCheckpointError {
  constructor(code = "CLOSURE_RECONCILIATION_UNAVAILABLE") { super(code); this.name = "ClosureReconciliationError"; }
}
const fail = code => { throw new ClosureReconciliationError(code); };
function fields(value, names) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== names.length
    || names.some(name => !Object.hasOwn(value, name) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), "value"))) fail("CLOSURE_RECONCILIATION_INPUT");
}
function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child);
  return Object.freeze(value);
}
const copied = value => JSON.parse(JSON.stringify(value));

/** A private, read-only plan, never a SQL, erasure or startup capability.
 * Source receipts remain encrypted under their original names and binding.
 * Every target job would have to start from the beginning: source phases and
 * cursors cannot describe the progress of a separately restored SQL/media copy.
 * The caller pins actual files, original authority, paths and physical roots in
 * assertReady/contextSha256 throughout both fresh witness observations. */
export async function planClosureReconciliation({ key: sourceKey, backup, local, quarantine, sourceIdentity, targetIdentity,
  checkpointReceiptSha256, contextSha256, continuity, assertReady, signal } = {}) {
  let key;
  try {
    if (!Buffer.isBuffer(sourceKey) || sourceKey.length !== 32 || typeof assertReady !== "function"
      || [checkpointReceiptSha256, contextSha256].some(value => typeof value !== "string" || !HEX.test(value))) fail("CLOSURE_RECONCILIATION_INPUT");
    key = Buffer.from(sourceKey);
    fields(quarantine, ["marker", "state", "markerSha256", "stateSha256"]);
    const marker = quarantine.marker;
    fields(marker, ["version", "status", "backupSha256", "currentSha256", "mergedSha256", "sourceBinding", "targetBinding"]);
    if (marker.version !== 1 || marker.status !== "reconciliation_required"
      || [marker.backupSha256, marker.currentSha256, marker.mergedSha256, quarantine.markerSha256, quarantine.stateSha256].some(value => typeof value !== "string" || !HEX.test(value))) fail("CLOSURE_RECONCILIATION_INPUT");
    const sourceBinding = erasureBinding(marker.sourceBinding), targetBinding = erasureBinding(marker.targetBinding);
    assertCloneIdentity(sourceIdentity, targetIdentity);
    if (sourceBinding.database.toLowerCase() === targetBinding.database.toLowerCase()
      || sourceIdentity.rootFingerprint !== sourceBinding.rootFingerprint || targetIdentity.rootFingerprint !== targetBinding.rootFingerprint) fail("CLOSURE_RECONCILIATION_BINDING");
    assertErasureContinuity(continuity, sourceBinding);
    const restored = planOperationalRestore({ backup, current: quarantine.state, targetBinding, key });
    if (JSON.stringify(restored.state.binding) !== JSON.stringify(sourceBinding)
      || restored.backupSha256 !== operationalStateHash(backup) || restored.backupSha256 !== marker.backupSha256
      || restored.currentSha256 !== quarantine.stateSha256 || restored.mergedSha256 !== quarantine.stateSha256
      || marker.mergedSha256 !== quarantine.stateSha256
      || hash(`${JSON.stringify(marker)}\n`) !== quarantine.markerSha256) fail("CLOSURE_RECONCILIATION_CHANGED");
    // Validate and detach the local inventory before any asynchronous work.
    const localCheck = planOperationalRestore({ backup: local, current: local, targetBinding, key });
    if (JSON.stringify(localCheck.state.binding) !== JSON.stringify(sourceBinding)
      || localCheck.backupSha256 !== operationalStateHash(local)) fail("CLOSURE_RECONCILIATION_BINDING");
    const selected = { sourceIdentity: copied(sourceIdentity), targetIdentity: copied(targetIdentity), checkpointReceiptSha256, contextSha256,
      sourceBinding, targetBinding, markerSha256: quarantine.markerSha256, backupSha256: restored.backupSha256,
      quarantineSha256: quarantine.stateSha256, quarantineCurrentSha256: marker.currentSha256,
      localSha256: localCheck.backupSha256 };
    const active = () => { if (signal?.aborted) fail("CLOSURE_RECONCILIATION_ABORTED"); };
    const ready = async () => { active(); await assertReady(); active(); };
    await ready();
    const first = await continuity.recover(ready, { signal });
    await ready();
    // A locally acknowledged receipt may not disappear merely because the PC
    // and the older quarantine agree with each other.
    const latest = planOperationalRestore({ backup: localCheck.state, current: first.state, targetBinding, key });
    const merged = planOperationalRestore({ backup: restored.state, current: latest.state, targetBinding, key });
    const snapshot = snapshotErasureRegistry(merged.state, { key, binding: sourceBinding });
    if (registryHash(snapshot) !== first.registrySha256) fail("CLOSURE_RECONCILIATION_CHANGED");
    const { jobs: authenticated } = authenticateRegistrySnapshot(snapshot, { key, binding: sourceBinding });
    const jobs = [...authenticated].map(([name, job]) => ({ name,
      sourceEnvelopeSha256: hash(Buffer.from(job.file.content, "base64url")), sourceRevision: job.revision,
      sourcePhase: job.record.phase, action: "replay_from_start" }));
    const plan = { version: 1, ...selected, currentSha256: operationalStateHash(first.state), mergedSha256: merged.mergedSha256,
      registrySha256: first.registrySha256, witnessRevision: first.witnessRevision, state: merged.state, jobs };
    await ready();
    const last = await continuity.recover(ready, { signal });
    await ready();
    if (last.registrySha256 !== first.registrySha256 || last.witnessRevision !== first.witnessRevision
      || operationalStateHash(last.state) !== operationalStateHash(first.state)) fail("CLOSURE_RECONCILIATION_CHANGED");
    const planSha256 = operationalStateHash(plan);
    const completedReceipts = jobs.filter(job => job.sourcePhase === "completed").length;
    return Object.freeze({ planSha256, plan: freeze(plan), summary: Object.freeze({ status: "closure_reconciliation_planned", planSha256,
      registrySha256: first.registrySha256, witnessRevision: first.witnessRevision, receipts: jobs.length,
      completedReceipts, pendingReceipts: jobs.length - completedReceipts, replayFromStartReceipts: jobs.length,
      reconciliationRequired: true, sqlMutationAuthorized: false, targetAbsenceVerified: false, started: false }) });
  } catch (error) {
    if (error instanceof OperationalCheckpointError || error instanceof ErasureContinuityError) throw error;
    fail();
  } finally { key?.fill(0); }
}
