import { constants } from "node:fs";
import { lstat, open, opendir, unlink } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { createVideoStorage } from "../video/storage.mjs";
import { createVideoStore } from "../video/store.mjs";
import { createVideoErasureExtension } from "../video/erasure-store.mjs";
import { composeVideoErasureStorage } from "../video/erasure-storage.mjs";
import { loadVideoMigrations } from "../video/migrations.mjs";
import { createChatStore } from "../chat/store.mjs";
import { createMediaStorage } from "../media/storage.mjs";
import { acquireRecurringLock } from "./recurring-checkpoint-files.mjs";
import { readCheckpointReceipt } from "./checkpoint-receipt.mjs";
import { readManifest, verifyBackupManifest, manifestHash, backupIdentity, assertCloneIdentity } from "./manifest.mjs";
import { readOperationalCheckpoint, readOperationalQuarantine, planOperationalRestore, operationalStateHash } from "./operational-checkpoint.mjs";
import { snapshotErasureRegistry, authenticateRegistrySnapshot } from "./registry-snapshot.mjs";
import { createReconciliationProgress } from "./reconciliation-progress.mjs";
import { createBackupSnapshotStore, captureBackupSnapshot, assertBackupSnapshot, verifyBackupStorage } from "./snapshot.mjs";
import { verifyPhotoNotificationRecoveryCrmBroadcastBackupData, verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData } from "./verify.mjs";
import { assertApplicationTableInspection, assertVideoApplicationTableInspection } from "./application-scope.mjs";
import { createBackupRecoveryStore, createVideoBackupRecoveryStore } from "./recovery-store.mjs";
import { createErasureStore } from "../data/erasure-store.mjs";
import { createErasureJournal, readErasureJournalBatch } from "../data/erasure-journal.mjs";
import { createAccountErasure } from "../data/erasure.mjs";
import { createLocalClosureOperations } from "../data/closure-operations.mjs";
import { resumeManagedLocalClosureRuntime } from "./managed-closures.mjs";
import { assertErasureSchema } from "../data/erasure-schema.mjs";
import { ERASURE_PHASES, erasureTime, erasureSqlDate } from "../data/erasure-state.mjs";

const HEX = /^[a-f0-9]{64}$/, HOLD = "operational-restore.json";
const keyNames = ["totpKey", "mailKey", "messageKey", "mediaKey", "crmKey", "notificationKey"];
export class ManualRestoreError extends Error {
  constructor(code = "MANUAL_RESTORE_UNAVAILABLE") { super("Manual application restoration was not confirmed."); this.name = "ManualRestoreError"; this.code = code; }
}
const fail = suffix => { throw new ManualRestoreError(`MANUAL_RESTORE_${suffix}`); };
const same = (a, b) => operationalStateHash(a) === operationalStateHash(b);
const inside = (a, b) => { const s = relative(b, a); return s === "" || s !== ".." && !s.startsWith(`..${sep}`) && !s.startsWith(sep); };
const path = value => typeof value === "string" && value.startsWith("/") && value !== "/" && resolve(value) === value && !/[\\\x00-\x1f\x7f]/.test(value);
const healthy = report => { if (report?.complete !== true || report.healthy !== true) fail("DATA"); };
async function held(scope, expected, create, name = HOLD) {
  await scope.assertReady(); let file;
  try {
    if (create) {
      try { file = await open(scope.file(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
      if (file) { await file.writeFile(expected); await file.sync(); await file.close(); file = null; await scope.sync(); }
    }
    file = await open(scope.file(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const first = await file.stat({ bigint: true });
    if (!first.isFile() || first.uid !== BigInt(process.getuid()) || (first.mode & 0o7777n) !== 0o600n || first.nlink !== 1n || first.size !== BigInt(expected.length)) fail("HOLD");
    const bytes = Buffer.alloc(expected.length + 1);
    try {
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0), last = await file.stat({ bigint: true }), visible = await lstat(scope.file(name), { bigint: true });
      if (bytesRead !== expected.length || !bytes.subarray(0, bytesRead).equals(expected)
        || ["dev", "ino", "mode", "uid", "nlink", "size", "mtimeNs", "ctimeNs"].some(name => first[name] !== last[name] || last[name] !== visible[name])) fail("HOLD");
    } finally { bytes.fill(0); }
    await scope.assertReady(); return first;
  } finally { await file?.close(); }
}
async function releaseHold(scope, expected) {
  const pinned = await held(scope, expected, false), visible = await lstat(scope.file(HOLD), { bigint: true });
  if (["dev", "ino", "mode", "uid", "nlink", "size", "mtimeNs", "ctimeNs"].some(name => pinned[name] !== visible[name])) fail("HOLD");
  await scope.assertReady(); await unlink(scope.file(HOLD)); await scope.sync(); await scope.assertReady();
  try { await lstat(scope.file(HOLD)); fail("HOLD"); } catch (error) { if (error.code !== "ENOENT") throw error; }
}

/** Explicit manual/local policy. It trusts the operator's pinned recent local
 * registry, without claiming off-host freshness or exhaustive SQL inventory.
 * The default path stays quarantined; only explicit publication may open it. */
async function runManualRestore(input, publication = null) {
  let progress, keys, opening = false, owner, openingHold, openingDirectory;
  try {
    const { checkpointDirectory, quarantineDirectory, journalDirectory, progressDirectory, recentRegistry, expectedRegistrySha256,
      readRecentRegistry, target, maintenance, assertReady, clock = Date.now, signal } = input ?? {};
    if (![checkpointDirectory, quarantineDirectory, journalDirectory, progressDirectory, target?.rootPath].every(path)
      || !HEX.test(expectedRegistrySha256 ?? "") || !recentRegistry || typeof readRecentRegistry !== "function"
      || typeof maintenance?.withQuiescedProducers !== "function" || typeof assertReady !== "function" || typeof clock !== "function"
      || typeof target?.pool?.getConnection !== "function" || typeof target?.inspectionPool?.getConnection !== "function"
      || target.pool === target.inspectionPool || !/^[a-zA-Z0-9_]{1,64}$/.test(target?.database ?? "")) fail("INPUT");
    if (publication && publication.runtime.state()?.status !== "stopped") fail("MAINTENANCE");
    const video = target.videoRootPath !== undefined;
    if (video && (!path(target.videoRootPath) || typeof target.videoStorage?.fingerprint !== "function")) fail("INPUT");
    const directories = [checkpointDirectory, quarantineDirectory, journalDirectory, progressDirectory, target.rootPath, ...(video ? [target.videoRootPath] : [])];
    const targetIndexes = [2, 3, 4, ...(video ? [5] : [])];
    for (const index of targetIndexes) for (let other = 0; other < directories.length; other++)
      if (index !== other && (inside(directories[index], directories[other]) || inside(directories[other], directories[index]))) fail("DIRECTORY");
    const identities = await Promise.all(directories.map(name => lstat(name, { bigint: true })));
    for (const index of targetIndexes) if (identities.some((value, other) => other !== index && value.dev === identities[index].dev && value.ino === identities[index].ino)) fail("DIRECTORY");
    keys = {}; for (const name of [...keyNames, ...(video ? ["videoKey"] : [])]) { if (!Buffer.isBuffer(input.keys?.[name]) || input.keys[name].length !== 32) fail("INPUT"); keys[name] = Buffer.from(input.keys[name]); }
    const receipt = await withPrivateDirectory(checkpointDirectory, scope => readCheckpointReceipt(scope, { signal }));
    const manifest = await readManifest(`${checkpointDirectory}/manifest.json`, { pathMode: "linux-dirfd" }), payload = verifyBackupManifest({ manifest, keys });
    if (receipt.version !== (video ? 12 : 10) || manifest.profile !== `messaging-photos-notify-recovery-crm-broadcast${video ? "-video" : ""}-application`
      || manifestHash(manifest) !== receipt.manifest.sha256) fail("CHECKPOINT");
    const backup = await withPrivateDirectory(checkpointDirectory, scope => readOperationalCheckpoint(scope, receipt, keys.crmKey, { signal }));
    const sourceBinding = backup.binding;
    const rootStorage = await createMediaStorage({ root: target.rootPath, key: keys.mediaKey, pathMode: "linux-dirfd" });
    const rootVideoStorage = video ? await createVideoStorage({ root: target.videoRootPath, key: keys.videoKey, pathMode: "linux-dirfd" }) : null;
    const identityOptions = { databaseName: target.database, rootPath: target.rootPath, storage: rootStorage, mediaKey: keys.mediaKey,
      ...(video ? { videoRootPath: target.videoRootPath, videoStorage: rootVideoStorage } : {}) };
    const targetIdentity = await backupIdentity(identityOptions);
    if ((await target.storage.fingerprint()).toString("hex") !== targetIdentity.rootFingerprint) fail("BINDING");
    if (video && (await target.videoStorage.fingerprint()).toString("hex") !== targetIdentity.video.rootFingerprint) fail("BINDING");
    const targetBinding = { database: target.database, rootFingerprint: targetIdentity.rootFingerprint,
      ...(video ? { videoRootFingerprint: targetIdentity.video.rootFingerprint } : {}) };
    assertCloneIdentity(payload.identity, targetIdentity);
    // Only the database tag is needed here; the original media root may be offline.
    const sourceDatabaseIdentity = await backupIdentity({ ...identityOptions, databaseName: sourceBinding.database });
    if (sourceDatabaseIdentity.databaseTag !== payload.identity.databaseTag || sourceBinding.rootFingerprint !== payload.identity.rootFingerprint
      || payload.snapshot.capacity.rootFingerprint !== payload.identity.rootFingerprint || sourceBinding.database.toLowerCase() === target.database.toLowerCase()
      || video && (sourceBinding.videoRootFingerprint !== payload.identity.video?.rootFingerprint
        || sourceDatabaseIdentity.video?.databaseTag !== payload.identity.video.databaseTag
        || payload.snapshot.video?.capacity.rootFingerprint !== payload.identity.video.rootFingerprint)) fail("BINDING");
    const latest = JSON.parse(JSON.stringify(planOperationalRestore({ backup, current: recentRegistry, targetBinding, key: keys.crmKey }).state));
    if (operationalStateHash(recentRegistry) !== expectedRegistrySha256) fail("REGISTRY");
    const quarantine = await withPrivateDirectory(quarantineDirectory, scope => readOperationalQuarantine(scope, { key: keys.crmKey, sourceBinding, targetBinding, signal }));
    const restored = planOperationalRestore({ backup, current: quarantine.state, targetBinding, key: keys.crmKey });
    if (restored.backupSha256 !== quarantine.marker.backupSha256 || restored.mergedSha256 !== quarantine.stateSha256) fail("QUARANTINE_CHANGED");
    const selected = planOperationalRestore({ backup: quarantine.state, current: latest, targetBinding, key: keys.crmKey });
    const planSha256 = operationalStateHash({ version: video ? 2 : 1, mode: video ? "manual-local-v2-video" : "manual-local-v1", manifestSha256: receipt.manifest.sha256,
      receiptSha256: operationalStateHash(receipt), registrySha256: expectedRegistrySha256, mergedSha256: selected.mergedSha256,
      markerSha256: quarantine.markerSha256, sourceBinding, targetBinding, checkpointDirectory, quarantineDirectory, journalDirectory, progressDirectory });
    if (publication && publication.expectedPlanSha256 !== planSha256) fail("PLAN_CHANGED");
    const privacy = selected.state.files.find(file => file.name === "privacy-preparation.json");
    const privacyBytes = privacy ? Buffer.from(privacy.content, "base64url") : null;
    const hold = Buffer.from(`${JSON.stringify({ version: video ? 2 : 1, format: "manual-restore-hold", planSha256, sourceBinding, targetBinding, started: false })}\n`);
    const active = () => { if (signal?.aborted) fail("ABORTED"); };
    let workError;
    const result = await acquireRecurringLock(progressDirectory, async lease => {
      try { return await maintenance.withQuiescedProducers(async assertQuiescent => {
        if (typeof assertQuiescent !== "function") fail("MAINTENANCE");
        let holdReady = false, holdReleased = false, privacyReady = false;
        const resources = async () => {
          active(); await lease.assertReady(); await assertReady();
          if (operationalStateHash(await readRecentRegistry()) !== expectedRegistrySha256) fail("REGISTRY_CHANGED");
          if (!same(await backupIdentity(identityOptions), targetIdentity)
            || (await target.storage.fingerprint()).toString("hex") !== targetIdentity.rootFingerprint
            || video && (await target.videoStorage.fingerprint()).toString("hex") !== targetIdentity.video.rootFingerprint) fail("BINDING");
          if (!same(await withPrivateDirectory(checkpointDirectory, scope => readCheckpointReceipt(scope, { signal })), receipt)
            || manifestHash(await readManifest(`${checkpointDirectory}/manifest.json`, { pathMode: "linux-dirfd" })) !== receipt.manifest.sha256
            || !same(await withPrivateDirectory(checkpointDirectory, scope => readOperationalCheckpoint(scope, receipt, keys.crmKey, { signal })), backup)) fail("CHECKPOINT_CHANGED");
          const actual = await withPrivateDirectory(quarantineDirectory, scope => readOperationalQuarantine(scope, { key: keys.crmKey, sourceBinding, targetBinding, signal }));
          if (actual.markerSha256 !== quarantine.markerSha256 || actual.stateSha256 !== quarantine.stateSha256) fail("QUARANTINE_CHANGED");
          if (holdReady) await withPrivateDirectory(journalDirectory, scope => held(scope, hold, false));
          if (holdReleased) await withPrivateDirectory(journalDirectory, async scope => { try { await lstat(scope.file(HOLD)); fail("HOLD"); } catch (error) { if (error.code !== "ENOENT") throw error; } });
          if (privacyReady) await withPrivateDirectory(journalDirectory, async scope => {
            if (privacyBytes) await held(scope, privacyBytes, false, "privacy-preparation.json");
            else try { await lstat(scope.file("privacy-preparation.json")); fail("PRIVACY"); } catch (error) { if (error.code !== "ENOENT") throw error; }
          });
          active();
        };
        const guard = async () => { if (publication && publication.runtime.state()?.status !== "stopped") fail("MAINTENANCE"); await assertQuiescent(); await resources(); await assertQuiescent(); };
        await guard();
        const withConnection = async (pool, work) => { const connection = await pool.getConnection(); try { return await work(connection); } finally { await connection.release(); } };
        await withConnection(target.inspectionPool, connection => (video ? assertVideoApplicationTableInspection : assertApplicationTableInspection)(connection, target.database));
        await withConnection(target.pool, async connection => assertErasureSchema(connection, target.database, ...(video ? [{ candidateMigrations: await loadVideoMigrations() }] : [])));
        progress = createReconciliationProgress({ directory: progressDirectory, key: keys.crmKey, planSha256, manifestSha256: receipt.manifest.sha256, targetBinding });
        let run = await progress.read();
        const jobs = [...authenticateRegistrySnapshot(snapshotErasureRegistry(selected.state, { key: keys.crmKey, binding: sourceBinding }), { key: keys.crmKey, binding: sourceBinding }).jobs.values()];
        const clientIds = new Set(jobs.map(job => job.record.clientId));
        const batch = page => readErasureJournalBatch({ directory: journalDirectory, key: keys.crmKey, binding: targetBinding, ...page });
        const readJobs = async () => { const found = new Map(); let afterName = null; do { const page = await batch({ afterName, limit: 100 }); for (const job of page.jobs) { if (found.has(job.clientId) || !clientIds.has(job.clientId)) fail("PROGRESS"); found.set(job.clientId, job); } afterName = page.nextCursor; } while (afterName !== null); return found; };
        const discovered = await readJobs();
        if ((run.record === null || run.record.phase === "prepared") && discovered.size || run.record?.phase === "completed" && (discovered.size !== clientIds.size || [...discovered.values()].some(job => job.phase !== "completed"))) fail("PROGRESS");
        if (run.record === null) await withPrivateDirectory(journalDirectory, async scope => { const dir = await opendir(scope.path); for await (const entry of dir) if (entry.name !== HOLD && !(privacyBytes && entry.name === "privacy-preparation.json")) fail("JOURNAL_NOT_EMPTY"); });
        await withPrivateDirectory(journalDirectory, scope => held(scope, hold, true)); holdReady = true;
        if (privacyBytes) await withPrivateDirectory(journalDirectory, scope => held(scope, privacyBytes, true, "privacy-preparation.json"));
        privacyReady = true; await guard();
        const savePhase = async phase => { await guard(); run = await progress.save({ version: video ? 2 : 1, planSha256, manifestSha256: receipt.manifest.sha256, targetBinding, phase }, run.revision, guard); };
        const snapshot = () => captureBackupSnapshot({ store: createBackupSnapshotStore({ pool: target.pool, inspectionPool: target.inspectionPool, coverage: "application-tables", ...(video ? { video: true } : {}) }), signal });
        const verify = async value => { healthy(await verifyBackupStorage({ snapshot: value, storage: target.storage, ...(video ? { videoStorage: target.videoStorage } : {}), signal })); healthy(await (video ? verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData : verifyPhotoNotificationRecoveryCrmBroadcastBackupData)({ pool: target.pool, storage: target.storage, ...(video ? { videoStorage: target.videoStorage } : {}), keys, signal })); };
        if (run.record === null || run.record.phase === "prepared") {
          await guard(); const before = await snapshot(), comparison = assertBackupSnapshot({ expected: payload.snapshot, actual: before, mode: "recovery", targetFingerprint: targetBinding.rootFingerprint, ...(video ? { targetVideoFingerprint: targetBinding.videoRootFingerprint } : {}) });
          if (before.objects.some(object => ["reserved", "cleanup_pending"].includes(object.state))
            || video && before.video.assets.some(object => ["reserved", "cleanup_pending"].includes(object.state))) fail("CAPACITY_PREPARATION_REQUIRED");
          await verify(before); assertBackupSnapshot({ expected: before, actual: await snapshot(), mode: "exact" });
          if (run.record === null) await savePhase("prepared");
          await guard(); await createBackupRecoveryStore({ pool: target.pool }).rebind({ sourceFingerprint: Buffer.from(sourceBinding.rootFingerprint, "hex"), targetFingerprint: Buffer.from(targetBinding.rootFingerprint, "hex"), targetDatabaseName: target.database,
            capacity: { ownerBytes: payload.snapshot.capacity.ownerBytes, totalBytes: payload.snapshot.capacity.totalBytes }, expectedHeldBytes: comparison.heldBytes, now: erasureTime(clock()) });
          if (video) await createVideoBackupRecoveryStore({ pool: target.pool }).rebind({ sourceFingerprint: Buffer.from(sourceBinding.videoRootFingerprint, "hex"),
            targetFingerprint: Buffer.from(targetBinding.videoRootFingerprint, "hex"), targetDatabaseName: target.database,
            capacity: { ownerBytes: payload.snapshot.video.capacity.ownerBytes, totalBytes: payload.snapshot.video.capacity.totalBytes }, expectedHeldBytes: comparison.videoHeldBytes, now: erasureTime(clock()) });
          await savePhase("running");
        }
        const videoCapacity = video ? { ownerBytes: payload.snapshot.video.capacity.ownerBytes, totalBytes: payload.snapshot.video.capacity.totalBytes, rootFingerprint: Buffer.from(targetBinding.videoRootFingerprint, "hex") } : null;
        const videoExtension = video ? createVideoErasureExtension({ videoStore: createVideoStore({ pool: target.pool, chatStore: createChatStore(target.pool), capacity: videoCapacity }), videoStorage: target.videoStorage, capacity: videoCapacity }) : null;
        const selectedStorage = video ? composeVideoErasureStorage({ storage: target.storage, videoStorage: target.videoStorage }) : target.storage;
        const store = createErasureStore({ pool: target.pool, database: target.database, capacity: { ownerBytes: payload.snapshot.capacity.ownerBytes, totalBytes: payload.snapshot.capacity.totalBytes, rootFingerprint: Buffer.from(targetBinding.rootFingerprint, "hex") }, broadcastKey: keys.messageKey, ...(video ? { video: videoExtension } : {}) });
        const journalFor = clientId => createErasureJournal({ directory: journalDirectory, key: keys.crmKey, binding: targetBinding, clientId });
        const engine = createAccountErasure({ store, storage: selectedStorage, journalFor, clock, maintenance: { async withQuiescedProducers(work) { await guard(); return work(guard, guard); } } });
        const absentFiles = async clientId => {
          for (const object of payload.snapshot.objects.filter(value => value.owner_role === "client" && value.owner_id === clientId)) for (const variant of ["full", "thumb"]) { await guard(); if ((await target.storage.inspectEntry({ storageKey: Buffer.from(object.storage_key, "hex"), variant }))?.exists !== false) fail("FILES_REAPPEARED"); }
          if (video) for (const object of payload.snapshot.video.assets.filter(value => value.owner_role === "client" && value.owner_id === clientId)) { await guard(); if ((await target.videoStorage.inspectEntry({ storageKey: Buffer.from(object.storage_key, "hex") }))?.exists !== false) fail("FILES_REAPPEARED"); }
        };
        let passes = 0;
        for (const clientId of clientIds) {
          for (;;) {
            if (++passes > 10000) fail("LIMIT"); await guard();
            const presence = await store.withLease(clientId, scope => scope.inspectReconciliation(erasureTime(clock())));
            if (run.record.phase === "completed" && presence.present) fail("ACCOUNT_REAPPEARED");
            if (!presence.present) {
              await absentFiles(clientId); if (run.record.phase === "completed") break;
              const journal = journalFor(clientId);
              try { let current = await journal.read(); if (current.record === null) { const at = erasureTime(clock()); current = await journal.save({ version: video ? 2 : 1, clientId, binding: targetBinding, phase: "requested", cursor: null, startedAt: at, updatedAt: at }, 0, guard); }
                while (current.record.phase !== "completed") { await guard(); await store.withLease(clientId, scope => scope.verifyAbsent(erasureTime(clock()))); await absentFiles(clientId); current = await journal.save({ ...current.record, phase: ERASURE_PHASES[ERASURE_PHASES.indexOf(current.record.phase) + 1], updatedAt: erasureTime(clock()) }, current.revision, guard); }
              } finally { journal.close(); } break;
            }
            if ((await engine.resume({ clientId, maxMedia: 100 })).completed) { await absentFiles(clientId); break; }
          }
          await guard(); await store.withLease(clientId, scope => scope.verifyAbsent(erasureTime(clock()))); await absentFiles(clientId);
        }
        await guard();
        await withConnection(target.pool, async connection => {
          if ((await connection.query("SELECT DATABASE() AS name"))[0]?.name !== target.database) fail("BINDING");
          await connection.query("UPDATE sessions SET revoked_at = GREATEST(created_at, ?) WHERE revoked_at IS NULL", [erasureSqlDate(erasureTime(clock()))]);
          if (Number((await connection.query("SELECT COUNT(*) AS value FROM sessions WHERE revoked_at IS NULL"))[0]?.value) !== 0) fail("SESSIONS");
        });
        await guard(); const final = await snapshot(); await verify(final); assertBackupSnapshot({ expected: final, actual: await snapshot(), mode: "exact" });
        const finalJobs = await readJobs(); if (finalJobs.size !== clientIds.size || [...finalJobs.values()].some(job => job.phase !== "completed")) fail("PROGRESS");
        if (run.record.phase !== "completed") await savePhase("completed");
        await guard(); if (!same(await progress.read(), run)) fail("PROGRESS");
        if (publication) {
          openingDirectory = journalDirectory; openingHold = hold; opening = true;
          await withPrivateDirectory(journalDirectory, scope => releaseHold(scope, hold)); holdReady = false; holdReleased = true;
          const inspectApplicationSchema = async () => { await guard(); await withConnection(target.pool, async connection => assertErasureSchema(connection, target.database, ...(video ? [{ candidateMigrations: await loadVideoMigrations() }] : []))); await guard(); return { verified: true }; };
          owner = publication.makeOperations ? await publication.makeOperations() : createLocalClosureOperations({ store, storage: selectedStorage, journalFor, batch, inspectApplicationSchema, clock });
          const operations = owner?.operations ?? owner;
          if (typeof operations?.verifyStartup !== "function" || owner?.operations && owner.close !== undefined && typeof owner.close !== "function") fail("PUBLICATION");
          const completedJobsSha256 = operationalStateHash([...finalJobs]), completedProgressSha256 = operationalStateHash(run);
          const publicationReady = async () => {
            await resources();
            if (operationalStateHash([...(await readJobs())]) !== completedJobsSha256
              || operationalStateHash(await progress.read()) !== completedProgressSha256) fail("PROGRESS");
          };
          await resumeManagedLocalClosureRuntime({ runtime: publication.runtime, signal, assertReady: publicationReady,
            operations: { async verifyStartup(assertStopped, settings) {
              const proof = await operations.verifyStartup(assertStopped, settings);
              if (proof?.completedReceipts !== clientIds.size) fail("PROGRESS"); return proof;
            } } });
          await publicationReady(); if (publication.runtime.state()?.status !== "running") fail("PUBLICATION");
          if (owner?.operations && owner.close) await owner.close(); owner = null;
          return { status: "manual_restore_published", mode: "manual_local", planSha256, reconciledReceipts: clientIds.size,
            targetAbsenceVerified: true, sessionsRevoked: true, capacityRebound: true, quarantineRetained: true,
            targetJournalQuarantined: false, privacyPreparationPreserved: Boolean(privacyBytes), manualReopenRequired: false,
            externalRegistryContinuityVerified: false, completeDatabase: false, started: true, ready: true };
        }
        return { status: "manual_restore_reconciled_quarantined", mode: "manual_local", planSha256, reconciledReceipts: clientIds.size, targetAbsenceVerified: true, sessionsRevoked: true,
          capacityRebound: true, quarantineRetained: true, targetJournalQuarantined: true, manualReopenRequired: true, externalRegistryContinuityVerified: false, completeDatabase: false, started: false };
      }); } catch (error) { workError = error; return null; }
    }, { signal });
    if (workError) throw workError; return result;
  } catch (error) {
    if (opening) {
      let stopped = false, restored = false;
      try { const result = await publication.runtime.stop(); stopped = result?.exitCode === 0 && result.signal === null && publication.runtime.state()?.status === "stopped"; } catch {}
      try { await withPrivateDirectory(openingDirectory, scope => held(scope, openingHold, true)); restored = true; } catch {}
      try { if (owner?.operations && owner.close) await owner.close(); } catch {} owner = null;
      if (!stopped) fail("PUBLICATION_STOP"); if (!restored) fail("PUBLICATION_HOLD");
    }
    if (error instanceof ManualRestoreError) throw error; fail("UNAVAILABLE");
  }
  finally { progress?.close(); for (const key of Object.values(keys ?? {})) key.fill(0); }
}

/** Reconcile only: the target's manual hold remains startup-blocking. */
export async function reconcileManualRestore(input) { return runManualRestore(input); }

/** Explicit publication under the same real maintenance and progress lease.
 * The caller owns the operator CAS phase and the managed runtime's lifetime. */
export async function publishManualRestore(input, options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Reflect.ownKeys(options).some(name => !["expectedPlanSha256", "runtime", "makeOperations"].includes(name) || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, name), "value"))
    || !HEX.test(options.expectedPlanSha256 ?? "") || ["state", "stop", "start"].some(name => typeof options.runtime?.[name] !== "function")
    || options.makeOperations !== undefined && typeof options.makeOperations !== "function") fail("INPUT");
  return runManualRestore(input, options);
}
