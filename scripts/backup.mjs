import { isAbsolute, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mediaConfiguration } from "../server/media/config.mjs";
import { authConfiguration } from "../server/auth/config.mjs";
import { accessConfiguration } from "../server/access/config.mjs";
import { chatConfiguration } from "../server/chat/config.mjs";
import { crmConfiguration } from "../server/crm/config.mjs";
import { loadNotificationsConfig } from "../server/notifications/config.mjs";
import { runtimeDatabaseOptions } from "../server/db/runtime.mjs";
import { PHOTO_BACKUP_PROFILES, photoBackupProfile } from "../server/backup/profiles.mjs";

export class BackupCliError extends Error {
  constructor(code) { super("Private backup operation failed. Consult the offline backup procedure."); this.name = "BackupCliError"; this.code = code; }
}
const fail = (code = "BACKUP_OPERATION") => { throw new BackupCliError(code); };
const instant = (clock) => { const now = clock(); if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999) fail("BACKUP_CONFIG"); return now; };
const fingerprint = (value) => { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("BACKUP_VERIFY"); return Buffer.from(value, "hex"); };
const assertReport = (report) => { if (report?.complete !== true || report?.healthy !== true) fail("BACKUP_VERIFY"); };
const checkSignal = (signal) => { if (signal?.aborted) fail("BACKUP_ABORTED"); };
const candidateKeys = ["id", "owner_id", "owner_role", "storage_key", "content_digest", "full_bytes", "thumbnail_bytes", "stored_bytes", "asset_id", "state", "created_at"];
const candidateDTO = (value) => Object.fromEntries(candidateKeys.map((key) => [key, value[key]]));
const PHOTO_PROFILES = PHOTO_BACKUP_PROFILES;
const manifestProfile = (profile) => PHOTO_PROFILES.includes(profile) ? `messaging-${profile}` : "full";
const manifestVersion = (profile) => photoBackupProfile(profile)?.manifestVersion ?? 1;

export function parseArguments(args) {
  if (Array.isArray(args) && args.length === 6 && args[4] === "--profile" && PHOTO_PROFILES.includes(args[5])) {
    return { ...parseArguments(args.slice(0, 4)), profile: args[5] };
  }
  if (!Array.isArray(args) || args.length !== 4 || !["prepare", "verify", "restore"].includes(args[0])
    || args[1] !== "--offline" || args[2] !== "--manifest" || typeof args[3] !== "string" || !isAbsolute(args[3])
    || args[3] !== resolve(args[3]) || args[3].length > 4096 || /[\x00-\x1f\x7f]/.test(args[3])) fail("BACKUP_USAGE");
  return { command: args[0], offline: true, manifestPath: args[3] };
}

function configuration(env, profile) {
  const media = mediaConfiguration(env), auth = authConfiguration(env), access = accessConfiguration(env), chat = chatConfiguration(env), crm = crmConfiguration(env);
  const selected = photoBackupProfile(profile), photos = Boolean(selected), recovery = selected?.recovery, crmProfile = selected?.crm;
  const notifications = loadNotificationsConfig(env);
  if ([media, auth, access, chat].some((value) => value.enabled !== true) || (!photos || crmProfile) && crm.enabled !== true
    || photos && ((crmProfile ? env.JESSIEMESSAGE_ENABLE_CRM !== "1" : ![undefined, "0"].includes(env.JESSIEMESSAGE_ENABLE_CRM))
      || !(selected?.broadcast ? ["1"] : [undefined, "0"]).includes(env.JESSIEMESSAGE_ENABLE_BROADCAST)
      || !(recovery ? [undefined, "0", "1"] : [undefined, "0"]).includes(env.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY))
    || Boolean(selected?.notifications) !== notifications.enabled) fail("BACKUP_CONFIG");
  return { media, databaseName: runtimeDatabaseOptions(env).database,
    keys: { totpKey: auth.totpKey, mailKey: access.mail.key, messageKey: chat.key, mediaKey: media.key,
      ...(photos && !crmProfile ? {} : { crmKey: crm.key }), ...(selected?.notifications ? { notificationKey: notifications.key } : {}) } };
}

/** All commands require an operator-confirmed offline source or isolated clone. */
export async function main(args = process.argv.slice(2), env = process.env, dependencies = {}) {
  const options = parseArguments(args), clock = dependencies.clock ?? Date.now;
  let pool, inspectionPool, result;
  try {
    checkSignal(dependencies.signal);
    const selected = photoBackupProfile(options.profile), photos = Boolean(selected), notifications = selected?.notifications,
      application = selected?.application, recovery = selected?.recovery, crm = selected?.crm, broadcast = selected?.broadcast;
    const keyNames = [...["totpKey", "mailKey", "messageKey", "mediaKey"], ...(!photos || crm ? ["crmKey"] : []), ...(notifications ? ["notificationKey"] : [])];
    const config = (dependencies.configure ?? configuration)(env, options.profile), { media, keys } = config ?? {};
    if (media?.enabled !== true || !media.capacity || typeof config.databaseName !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(config.databaseName)
      || !keys || keyNames.some((key) => !Buffer.isBuffer(keys[key]) || keys[key].length !== 32)
      || !Buffer.isBuffer(media.key) || !media.key.equals(keys.mediaKey)) fail("BACKUP_CONFIG");
    const keyValues = Object.values(keys);
    if (keyValues.length !== keyNames.length || keyValues.some((key, index) => keyValues.slice(index + 1).some((other) => key.equals(other)))) fail("BACKUP_CONFIG");
    const manifestRelative = relative(media.root, options.manifestPath);
    if (manifestRelative === "" || !manifestRelative.startsWith(`..${sep}`) && manifestRelative !== ".." && !isAbsolute(manifestRelative)) fail("BACKUP_CONFIG");
    const manifests = dependencies.manifests ?? await import("../server/backup/manifest.mjs");
    const snapshots = dependencies.snapshots ?? await import("../server/backup/snapshot.mjs");
    const verification = await import("../server/backup/verify.mjs");
    const verifyCrypto = dependencies.verifyBackupData ?? (broadcast ? verification.verifyPhotoNotificationRecoveryCrmBroadcastBackupData : crm ? verification.verifyPhotoNotificationRecoveryCrmBackupData : recovery ? verification.verifyPhotoNotificationRecoveryBackupData
      : notifications ? verification.verifyPhotoNotificationBackupData : photos ? verification.verifyPhotoBackupData : verification.verifyBackupData);
    const makeCryptoStore = dependencies.makeCryptoStore ?? (await import("../server/backup/crypto-store.mjs")).createBackupCryptoStore;
    let manifest, payload;
    if (options.command !== "prepare") {
      manifest = await manifests.readManifest(options.manifestPath);
      if (photos && (manifest?.version !== manifestVersion(options.profile) || manifest.profile !== manifestProfile(options.profile))
        || !photos && manifest?.version !== 1) fail("BACKUP_VERIFY");
      payload = await manifests.verifyBackupManifest({ manifest, keys });
      if (!payload?.snapshot || payload.snapshot.capacity?.rootFingerprint !== payload.identity?.rootFingerprint) fail("BACKUP_VERIFY");
    }
    pool = await (dependencies.createPool ?? (await import("../server/db/runtime.mjs")).createRuntimePool)(env);
    const storage = await (dependencies.makeStorage ?? (await import("../server/media/storage.mjs")).createMediaStorage)({ root: media.root, key: keys.mediaKey });
    const rootFingerprint = await storage.fingerprint();
    if (!Buffer.isBuffer(rootFingerprint) || rootFingerprint.length !== 32) fail("BACKUP_VERIFY");
    const capacity = { ...media.capacity, rootFingerprint };
    const schemaStore = dependencies.makeSchemaStore ? dependencies.makeSchemaStore({ pool, capacity })
      : (await import("../server/media/store.mjs")).createMediaStore({ pool, capacity, chatStore: (await import("../server/chat/store.mjs")).createChatStore(pool) });
    await schemaStore.assertSchema();
    inspectionPool = await (dependencies.createInspectionPool ?? (application
      ? (await import("../server/backup/application-scope.mjs")).createApplicationInspectionPool
      : (await import("../server/backup/inspection.mjs")).createBackupInspectionPool))(env);
    if (!inspectionPool || inspectionPool === pool) fail("BACKUP_CONFIG");
    const store = (dependencies.makeSnapshotStore ?? snapshots.createBackupSnapshotStore)({ pool, inspectionPool, ...(application ? { coverage: "application-tables" } : {}) });
    const databaseName = await store.databaseName();
    if (databaseName !== config.databaseName) fail("BACKUP_CONFIG");
    const identity = await manifests.backupIdentity({ databaseName, rootPath: media.root, storage, mediaKey: keys.mediaKey });
    if (!fingerprint(identity.rootFingerprint).equals(rootFingerprint)) fail("BACKUP_VERIFY");
    const sourceIdentity = payload?.identity;
    if (sourceIdentity) await manifests.assertCloneIdentity(sourceIdentity, identity);
    const cryptoStore = photos ? undefined : makeCryptoStore({ pool });
    const capture = () => {
      checkSignal(dependencies.signal);
      return snapshots.captureBackupSnapshot({ store, signal: dependencies.signal, limits: dependencies.limits });
    };
    const compare = (expected, actual, mode) => snapshots.assertBackupSnapshot({ expected, actual, mode,
      ...(sourceIdentity ? { targetFingerprint: identity.rootFingerprint } : {}) });
    async function verifyData(snapshot, mode) {
      checkSignal(dependencies.signal);
      assertReport(await snapshots.verifyBackupStorage({ snapshot, storage, mode, signal: dependencies.signal, limits: dependencies.limits }));
      const cryptoLimits = Object.fromEntries(Object.entries(dependencies.limits ?? {}).filter(([key]) => ["maxRows", "maxIssues"].includes(key)));
      assertReport(await verifyCrypto({ ...(photos ? { pool } : { store: cryptoStore }), storage, keys, signal: dependencies.signal, limits: cryptoLimits }));
    }
    async function sameIdentity() {
      const current = await manifests.backupIdentity({ databaseName: await store.databaseName(), rootPath: media.root, storage, mediaKey: keys.mediaKey });
      if (JSON.stringify(current) !== JSON.stringify(identity)) fail("BACKUP_VERIFY");
      checkSignal(dependencies.signal);
    }
    let before = await capture();
    if (options.command === "prepare") {
      const makeCapacityStore = dependencies.makeCapacityStore ?? (await import("../server/media/capacity-store.mjs")).createMediaCapacityStore;
      const status = await makeCapacityStore({ pool, capacity }).status();
      if (status?.ready !== true || !Buffer.isBuffer(status.rootFingerprint) || !status.rootFingerprint.equals(rootFingerprint)
        || status.ownerBytes !== media.capacity.ownerBytes || status.totalBytes !== media.capacity.totalBytes
        || before.capacity?.rootFingerprint !== identity.rootFingerprint) fail("BACKUP_VERIFY");
      await verifyData(before, "exact");
      const after = await capture(); compare(before, after, "exact"); await sameIdentity();
      manifest = await manifests.createBackupManifest({ snapshot: after, identity, keys, now: instant(clock),
        ...(photos ? { profile: manifestProfile(options.profile) } : {}) });
      checkSignal(dependencies.signal);
      await manifests.writeManifest(options.manifestPath, manifest);
      result = { command: options.command, verified: true, prepared: true, restored: false, releasedCandidates: 0, manifestHash: manifests.manifestHash(manifest) };
    } else {
      const expected = payload.snapshot;
      if (expected.capacity?.ownerBytes !== media.capacity.ownerBytes || expected.capacity?.totalBytes !== media.capacity.totalBytes) fail("BACKUP_VERIFY");
      let comparison = compare(expected, before, "recovery");
      await verifyData(before, "recovery");
      const afterChecks = await capture(); compare(before, afterChecks, "exact"); compare(expected, afterChecks, "recovery"); await sameIdentity();
      before = afterChecks;
      let releasedCandidates = 0;
      if (options.command === "restore") {
        const recovery = (dependencies.makeRecoveryStore ?? (await import("../server/backup/recovery-store.mjs")).createBackupRecoveryStore)({ pool });
        const sourceFingerprint = fingerprint(sourceIdentity.rootFingerprint), targetFingerprint = fingerprint(identity.rootFingerprint);
        const rebound = before.capacity.rootFingerprint === identity.rootFingerprint;
        if (!rebound) {
          const current = new Map(before.objects.map((row) => [row.id, row]));
          if (!Array.isArray(comparison.candidates)) fail("BACKUP_VERIFY");
          for (const original of comparison.candidates) {
            checkSignal(dependencies.signal);
            const row = current.get(original.id);
            if (!row || !["reserved", "cleanup_pending", "released"].includes(row.state)) fail("BACKUP_VERIFY");
            if (row.state === "released") continue;
            const candidate = candidateDTO(original);
            const command = { candidate, sourceFingerprint, targetDatabaseName: databaseName };
            const closed = await recovery.closeCandidate({ ...command, now: instant(clock) });
            if (closed?.closed !== true || !["cleanup_pending", "released"].includes(closed.state)) fail("BACKUP_VERIFY");
            if (closed.state === "released") continue;
            checkSignal(dependencies.signal);
            if (typeof candidate.storage_key !== "string" || !/^[a-f0-9]{64}$/.test(candidate.storage_key)) fail("BACKUP_VERIFY");
            await storage.remove({ storageKey: Buffer.from(candidate.storage_key, "hex") });
            const released = await recovery.releaseCandidate({ ...command, now: instant(clock) });
            if (released?.released !== true) fail("BACKUP_VERIFY");
            releasedCandidates++;
          }
        }
        const afterRecovery = await capture();
        comparison = compare(expected, afterRecovery, "recovery");
        await verifyData(afterRecovery, "recovery");
        const final = await capture(); compare(afterRecovery, final, "exact"); comparison = compare(expected, final, "recovery"); await sameIdentity();
        if (!Number.isSafeInteger(comparison.heldBytes) || comparison.heldBytes < 0) fail("BACKUP_VERIFY");
        const binding = await recovery.rebind({ sourceFingerprint, targetFingerprint, targetDatabaseName: databaseName,
          capacity: media.capacity, expectedHeldBytes: comparison.heldBytes, now: instant(clock) });
        if (binding?.rebound !== true) fail("BACKUP_VERIFY");
      }
      result = { command: options.command, verified: true, prepared: false, restored: options.command === "restore", releasedCandidates, manifestHash: manifests.manifestHash(manifest) };
    }
  } catch (error) {
    if (error instanceof BackupCliError) throw error;
    fail("BACKUP_OPERATION");
  } finally {
    const pools = [...new Set([pool, inspectionPool].filter(Boolean))];
    const outcomes = await Promise.allSettled(pools.map((current) => Promise.resolve().then(() => current.end())));
    if (outcomes.some((outcome) => outcome.status === "rejected")) fail("BACKUP_OPERATION");
  }
  (dependencies.outputStream ?? process.stdout).write(`${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof BackupCliError ? error.code : "BACKUP_OPERATION"}: Private offline backup operation failed.\n`);
    process.exitCode = 1;
  });
}
