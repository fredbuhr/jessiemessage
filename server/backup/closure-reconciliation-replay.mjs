import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { lstat } from "node:fs/promises";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { createMediaStorage } from "../media/storage.mjs";
import { createAccountErasure } from "../data/erasure.mjs";
import { createErasureStore } from "../data/erasure-store.mjs";
import { createErasureJournal, readErasureJournalBatch } from "../data/erasure-journal.mjs";
import { AccountErasureError, ERASURE_PHASES, erasureTime } from "../data/erasure-state.mjs";
import { assertErasureSchema } from "../data/erasure-schema.mjs";
import { assertBackupInspection, BackupInspectionError } from "./inspection.mjs";
import { backupIdentity, assertCloneIdentity, manifestHash, readManifest, verifyBackupManifest } from "./manifest.mjs";
import { createBackupSnapshotStore, captureBackupSnapshot, assertBackupSnapshot, verifyBackupStorage } from "./snapshot.mjs";
import { verifyPhotoNotificationRecoveryCrmBroadcastBackupData } from "./verify.mjs";
import { createBackupRecoveryStore } from "./recovery-store.mjs";
import { readCheckpointReceipt } from "./checkpoint-receipt.mjs";
import { operationalStateHash, captureOperationalState, readOperationalCheckpoint, readOperationalQuarantine,
  OperationalCheckpointError } from "./operational-checkpoint.mjs";
import { authenticateRegistrySnapshot, snapshotErasureRegistry } from "./registry-snapshot.mjs";
import { planClosureReconciliation } from "./closure-reconciliation.mjs";
import { createReconciliationProgress, deriveReconciliationJournalKey } from "./reconciliation-progress.mjs";
import { acquireRecurringLock } from "./recurring-checkpoint-files.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url))), HEX = /^[a-f0-9]{64}$/;
export class ClosureReplayError extends OperationalCheckpointError {
  constructor(code = "CLOSURE_REPLAY_UNAVAILABLE") { super(code); this.name = "ClosureReplayError"; }
}
const fail = code => { throw new ClosureReplayError(code); };
const same = (a, b) => operationalStateHash(a) === operationalStateHash(b);
const inside = (a, b) => { const suffix = relative(b, a); return suffix === "" || suffix !== ".." && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep); };
function path(value) {
  return typeof value === "string" && value.startsWith("/") && value !== "/" && resolve(value) === value && value.length <= 4096
    && !/[\\\x00-\x1f\x7f]/.test(value) && !inside(value, ROOT);
}
function fields(value, names) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== names.length
    || names.some(name => !Object.hasOwn(value, name) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), "value"))) fail("CLOSURE_REPLAY_INPUT");
}
const report = value => { if (value?.complete !== true || value.healthy !== true) fail("CLOSURE_REPLAY_DATA"); };

/** Internal isolated-target executor, without an apply CLI or startup authority.
 * Its caller must actually exclude and drain every target producer and capture.
 * A source phase/cursor is provenance only; all new target journals start empty.
 * Pending media allocations require the existing authenticated backup-recovery
 * preparation first. This executor never guesses which pending files to erase. */
export async function replayClosureReconciliation(input, internal = {}) {
  let progress, journalKey;
  try {
    fields(input, ["planParameters", "expectedPlanSha256", "checkpointReceipt", "manifest", "keys", "target", "directories", "maintenance", "clock", ...(Object.hasOwn(input ?? {}, "signal") ? ["signal"] : [])]);
    const { planParameters: parameters, expectedPlanSha256, checkpointReceipt, manifest, keys, target, directories, maintenance, clock, signal } = input;
    fields(directories, ["sourceOperations", "checkpoint", "quarantine", "progress", "sourceMedia"]);
    if (!parameters || !HEX.test(expectedPlanSha256 ?? "") || typeof expectedPlanSha256 !== "string" || typeof clock !== "function"
      || typeof maintenance?.withQuiescedProducers !== "function" || typeof target?.pool?.getConnection !== "function"
      || typeof target?.inspectionPool?.getConnection !== "function" || target.pool === target.inspectionPool
      || !keys || !Buffer.isBuffer(keys.crmKey) || !Buffer.isBuffer(parameters.key) || !keys.crmKey.equals(parameters.key)
      || !Buffer.isBuffer(keys.mediaKey) || !Buffer.isBuffer(keys.messageKey) || !Buffer.isBuffer(target.broadcastKey) || !target.broadcastKey.equals(keys.messageKey)
      || Object.values(directories).some(value => !path(value)) || !path(target.rootPath)) fail("CLOSURE_REPLAY_INPUT");
    for (const directory of [...Object.values(directories).filter(value => value !== directories.progress), target.rootPath])
      if (inside(directory, directories.progress) || inside(directories.progress, directory)) fail("CLOSURE_REPLAY_INPUT");
    const progressIdentity = await lstat(directories.progress, { bigint: true });
    for (const directory of [...Object.values(directories).filter(value => value !== directories.progress), target.rootPath]) {
      const identity = await lstat(directory, { bigint: true });
      if (identity.dev === progressIdentity.dev && identity.ino === progressIdentity.ino) fail("CLOSURE_REPLAY_INPUT");
    }
    const sourceGuard = parameters.assertReady;
    if (typeof sourceGuard !== "function") fail("CLOSURE_REPLAY_INPUT");
    const active = () => { if (signal?.aborted) fail("CLOSURE_REPLAY_ABORTED"); };
    active();
    const scope = internal.withDirectory ?? withPrivateDirectory;
    return await (internal.lock ?? acquireRecurringLock)(directories.progress, lease => maintenance.withQuiescedProducers(async assertQuiescent => {
      if (typeof lease?.assertReady !== "function" || typeof assertQuiescent !== "function") fail("CLOSURE_REPLAY_EXCLUSION");
      const basic = async () => { active(); await lease.assertReady(); await assertQuiescent(); await sourceGuard(); active(); };
      const planned = await planClosureReconciliation({ ...parameters, assertReady: basic, signal });
      if (planned.planSha256 !== expectedPlanSha256) fail("CLOSURE_REPLAY_CHANGED");
      const plan = planned.plan, sourceBinding = plan.sourceBinding, targetBinding = plan.targetBinding;
      if (operationalStateHash(checkpointReceipt) !== plan.checkpointReceiptSha256) fail("CLOSURE_REPLAY_CHANGED");
      const manifestSha256 = manifestHash(manifest), payload = verifyBackupManifest({ manifest, keys });
      if (manifestSha256 !== checkpointReceipt.manifest.sha256 || !same(payload.identity, plan.sourceIdentity)
        || payload.snapshot.capacity.rootFingerprint !== sourceBinding.rootFingerprint
        || manifest.profile !== "messaging-photos-notify-recovery-crm-broadcast-application") fail("CLOSURE_REPLAY_CHECKPOINT");
      const actualIdentity = () => backupIdentity({ databaseName: targetBinding.database, rootPath: target.rootPath, storage: target.storage, mediaKey: keys.mediaKey });
      const sourceStorage = await createMediaStorage({ root: directories.sourceMedia, key: keys.mediaKey, pathMode: "linux-dirfd" });
      const actualSourceIdentity = () => backupIdentity({ databaseName: sourceBinding.database, rootPath: directories.sourceMedia, storage: sourceStorage, mediaKey: keys.mediaKey });
      assertCloneIdentity(plan.sourceIdentity, await actualIdentity());
      const resources = async () => {
        await basic();
        if (!same(await actualIdentity(), plan.targetIdentity) || !same(await actualSourceIdentity(), plan.sourceIdentity)) fail("CLOSURE_REPLAY_CHANGED");
        await scope(directories.sourceOperations, async current => {
          if (operationalStateHash(await captureOperationalState(current, { key: keys.crmKey, binding: sourceBinding, signal })) !== plan.localSha256) fail("CLOSURE_REPLAY_CHANGED");
        });
        await scope(directories.checkpoint, async checkpoint => {
          if (!same(await readCheckpointReceipt(checkpoint, { signal }), checkpointReceipt)
            || operationalStateHash(await readOperationalCheckpoint(checkpoint, checkpointReceipt, keys.crmKey, { signal })) !== plan.backupSha256) fail("CLOSURE_REPLAY_CHANGED");
        });
        if (manifestHash(await readManifest(`${directories.checkpoint}/manifest.json`, { pathMode: "linux-dirfd" })) !== manifestSha256) fail("CLOSURE_REPLAY_CHANGED");
        await scope(directories.quarantine, async quarantine => {
          const actual = await readOperationalQuarantine(quarantine, { key: keys.crmKey, sourceBinding, targetBinding, signal });
          if (actual.markerSha256 !== plan.markerSha256 || actual.stateSha256 !== plan.quarantineSha256) fail("CLOSURE_REPLAY_CHANGED");
        });
        await basic();
      };
      const inspect = async () => {
        await resources(); let connection;
        try {
          connection = await target.inspectionPool.getConnection();
          await assertBackupInspection(connection, targetBinding.database);
          await assertErasureSchema(connection, targetBinding.database);
        } finally { await connection?.release(); }
        await resources();
      };
      const witnessed = async () => {
        await inspect();
        const fresh = await parameters.continuity.recover(resources, { signal });
        if (fresh.registrySha256 !== plan.registrySha256 || fresh.witnessRevision !== plan.witnessRevision
          || operationalStateHash(fresh.state) !== plan.currentSha256) fail("CLOSURE_REPLAY_CHANGED");
        await resources();
      };
      await witnessed();
      const snapshotStore = createBackupSnapshotStore({ pool: target.pool, inspectionPool: target.inspectionPool, coverage: "application-tables" });
      const snapshot = () => captureBackupSnapshot({ store: snapshotStore, signal });
      const verify = async value => {
        report(await verifyBackupStorage({ snapshot: value, storage: target.storage, signal }));
        report(await verifyPhotoNotificationRecoveryCrmBroadcastBackupData({ pool: target.pool, storage: target.storage, keys, signal }));
      };
      const registry = snapshotErasureRegistry(plan.state, { key: keys.crmKey, binding: sourceBinding });
      const { jobs: sourceJobs } = authenticateRegistrySnapshot(registry, { key: keys.crmKey, binding: sourceBinding });
      const identities = [...sourceJobs.values()].map(job => job.record.clientId), selected = new Set(identities);
      journalKey = deriveReconciliationJournalKey({ key: keys.crmKey, planSha256: expectedPlanSha256, manifestSha256, targetBinding });
      progress = createReconciliationProgress({ directory: directories.progress, key: keys.crmKey,
        planSha256: expectedPlanSha256, manifestSha256, targetBinding }, { withDirectory: scope });
      let run = await progress.read(), afterName = null;
      const discovered = new Map();
      do {
        const page = await readErasureJournalBatch({ directory: directories.progress, key: journalKey, binding: targetBinding, afterName, limit: 100 }, { withDirectory: scope });
        if ((run.record === null || run.record.phase === "prepared") && page.jobs.length !== 0) fail("CLOSURE_REPLAY_PROGRESS");
        if (page.jobs.some(job => !selected.has(job.clientId))) fail("CLOSURE_REPLAY_PROGRESS");
        for (const job of page.jobs) {
          if (discovered.has(job.clientId)) fail("CLOSURE_REPLAY_PROGRESS");
          discovered.set(job.clientId, job);
        }
        afterName = page.nextCursor;
      } while (afterName !== null);
      const completedRun = run.record?.phase === "completed";
      if (completedRun && (discovered.size !== selected.size || [...discovered.values()].some(job => job.phase !== "completed"))) fail("CLOSURE_REPLAY_PROGRESS");
      const savePhase = async phase => {
        await witnessed();
        run = await progress.save({ version: 1, planSha256: expectedPlanSha256, manifestSha256, targetBinding, phase }, run.revision, witnessed);
        await witnessed();
      };
      if (run.record === null || run.record.phase === "prepared") {
        await witnessed(); const before = await snapshot();
        const comparison = assertBackupSnapshot({ expected: payload.snapshot, actual: before, mode: "recovery", targetFingerprint: targetBinding.rootFingerprint });
        if (before.objects.some(object => ["reserved", "cleanup_pending"].includes(object.state))) fail("CLOSURE_REPLAY_CAPACITY_PREPARATION_REQUIRED");
        await verify(before);
        assertBackupSnapshot({ expected: before, actual: await snapshot(), mode: "exact" });
        if (run.record === null) await savePhase("prepared");
        await witnessed();
        const rebound = await createBackupRecoveryStore({ pool: target.pool }).rebind({ sourceFingerprint: Buffer.from(sourceBinding.rootFingerprint, "hex"),
          targetFingerprint: Buffer.from(targetBinding.rootFingerprint, "hex"), targetDatabaseName: targetBinding.database,
          capacity: { ownerBytes: payload.snapshot.capacity.ownerBytes, totalBytes: payload.snapshot.capacity.totalBytes }, expectedHeldBytes: comparison.heldBytes, now: erasureTime(clock()) });
        if (rebound.rebound !== true) fail("CLOSURE_REPLAY_CAPACITY");
        await savePhase("running");
      }
      const capacity = { ownerBytes: payload.snapshot.capacity.ownerBytes, totalBytes: payload.snapshot.capacity.totalBytes,
        rootFingerprint: Buffer.from(targetBinding.rootFingerprint, "hex") };
      const store = createErasureStore({ pool: target.pool, database: targetBinding.database, capacity, broadcastKey: target.broadcastKey });
      const journalFor = clientId => createErasureJournal({ directory: directories.progress, key: journalKey, binding: targetBinding, clientId }, { withDirectory: scope });
      const engine = createAccountErasure({ store, storage: target.storage, journalFor, clock,
        maintenance: { async withQuiescedProducers(work) { await witnessed(); return work(witnessed, witnessed); } } });
      const absentFiles = async clientId => {
        for (const object of payload.snapshot.objects.filter(value => value.owner_role === "client" && value.owner_id === clientId))
          for (const variant of ["full", "thumb"]) {
            await resources();
            const entry = await target.storage.inspectEntry({ storageKey: Buffer.from(object.storage_key, "hex"), variant });
            if (entry?.exists !== false) fail("CLOSURE_REPLAY_FILES_REAPPEARED");
          }
      };
      let passes = 0;
      for (const clientId of identities) {
        for (;;) {
          if (++passes > 10000) fail("CLOSURE_REPLAY_LIMIT");
          await witnessed(); const presence = await store.withLease(clientId, sql => sql.inspectReconciliation(erasureTime(clock())));
          if (completedRun && presence.present) throw new AccountErasureError("ERASURE_RESTORE_REPLAY_REQUIRED");
          if (!presence.present) {
            await absentFiles(clientId);
            if (completedRun) break;
            const journal = journalFor(clientId);
            try {
              let current = await journal.read();
              if (current.record === null) {
                const at = erasureTime(clock());
                current = await journal.save({ version: 1, clientId, binding: targetBinding, phase: "requested", cursor: null, startedAt: at, updatedAt: at }, 0, witnessed);
              }
              while (current.record.phase !== "completed") {
                await witnessed(); await store.withLease(clientId, sql => sql.verifyAbsent(erasureTime(clock()))); await absentFiles(clientId);
                const phase = ERASURE_PHASES[ERASURE_PHASES.indexOf(current.record.phase) + 1];
                current = await journal.save({ ...current.record, phase, updatedAt: erasureTime(clock()) }, current.revision, witnessed);
              }
            } finally { journal.close(); }
            break;
          }
          const result = await engine.resume({ clientId, maxMedia: 100 });
          if (result.completed) { await absentFiles(clientId); break; }
        }
        await witnessed(); await store.withLease(clientId, sql => sql.verifyAbsent(erasureTime(clock()))); await absentFiles(clientId);
      }
      await witnessed(); const final = await snapshot();
      if (final.capacity.rootFingerprint !== targetBinding.rootFingerprint) fail("CLOSURE_REPLAY_CAPACITY");
      await verify(final); assertBackupSnapshot({ expected: final, actual: await snapshot(), mode: "exact" });
      await witnessed();
      if (run.record.phase !== "completed") await savePhase("completed");
      await witnessed();
      let finalCursor = null; const finalJobs = new Set();
      do {
        const page = await readErasureJournalBatch({ directory: directories.progress, key: journalKey, binding: targetBinding, afterName: finalCursor, limit: 100 }, { withDirectory: scope });
        for (const job of page.jobs) {
          if (!selected.has(job.clientId) || finalJobs.has(job.clientId) || job.phase !== "completed") fail("CLOSURE_REPLAY_PROGRESS");
          finalJobs.add(job.clientId);
        }
        finalCursor = page.nextCursor;
      } while (finalCursor !== null);
      if (finalJobs.size !== selected.size || !same(await progress.read(), run)) fail("CLOSURE_REPLAY_PROGRESS");
      await witnessed();
      return { status: "closure_target_reconciled_quarantined", planSha256: expectedPlanSha256, reconciledReceipts: identities.length,
        targetAbsenceVerified: true, capacityRebound: true, quarantineRetained: true, reconciliationRequired: true,
        authorityTransferred: false, started: false };
    }), { signal });
  } catch (error) {
    if (error instanceof OperationalCheckpointError || error instanceof AccountErasureError || error instanceof BackupInspectionError) throw error;
    fail();
  } finally { progress?.close(); journalKey?.fill(0); }
}
