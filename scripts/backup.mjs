import { isAbsolute, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mediaConfiguration } from "../server/media/config.mjs";
import { authConfiguration } from "../server/auth/config.mjs";
import { accessConfiguration } from "../server/access/config.mjs";
import { chatConfiguration } from "../server/chat/config.mjs";
import { crmConfiguration } from "../server/crm/config.mjs";
import { loadNotificationsConfig } from "../server/notifications/config.mjs";
import { runtimeDatabaseOptions } from "../server/db/runtime.mjs";
import { validateRuntimeVideoConfiguration } from "../server/config/runtime-database-file.mjs";
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
const VIDEO_CANDIDATE_FIELDS = ["id", "owner_id", "owner_role", "storage_key", "reserve_token_hash", "content_digest", "bytes", "stored_bytes", "mime", "state", "created_at"];
const videoCandidateDTO = value => Object.fromEntries(VIDEO_CANDIDATE_FIELDS.map(name => [name, value[name]]));
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
  const videoRecord = selected?.video ? validateRuntimeVideoConfiguration({ format: "jessiemessage-runtime-video", version: 1,
    origin: env.JESSIEMESSAGE_SITE_ORIGIN, videoKey: env.JESSIEMESSAGE_VIDEO_KEY, videoRoot: env.JESSIEMESSAGE_VIDEO_ROOT,
    ownerBytes: env.JESSIEMESSAGE_VIDEO_OWNER_BYTES, totalBytes: env.JESSIEMESSAGE_VIDEO_TOTAL_BYTES,
    minimumFreeBytes: env.JESSIEMESSAGE_VIDEO_MINIMUM_FREE_BYTES }, { originProfile: "primary" }) : null;
  if (videoRecord && videoRecord.videoKey === env.JESSIEMESSAGE_VAPID_PRIVATE_KEY) fail("BACKUP_CONFIG");
  const video = videoRecord ? { root: videoRecord.videoRoot,
    capacity: { ownerBytes: Number(videoRecord.ownerBytes), totalBytes: Number(videoRecord.totalBytes) },
    minimumFreeBytes: BigInt(videoRecord.minimumFreeBytes) } : null;
  return { media, ...(video ? { video } : {}), databaseName: runtimeDatabaseOptions(env).database,
    keys: { totpKey: auth.totpKey, mailKey: access.mail.key, messageKey: chat.key, mediaKey: media.key,
      ...(photos && !crmProfile ? {} : { crmKey: crm.key }), ...(selected?.notifications ? { notificationKey: notifications.key } : {}),
      ...(video ? { videoKey: Buffer.from(videoRecord.videoKey, "base64url") } : {}) } };
}

/** All commands require an operator-confirmed offline source or isolated clone. */
export async function main(args = process.argv.slice(2), env = process.env, dependencies = {}) {
  const options = parseArguments(args), clock = dependencies.clock ?? Date.now;
  let pool, inspectionPool, result;
  try {
    checkSignal(dependencies.signal);
    const selected = photoBackupProfile(options.profile), photos = Boolean(selected), notifications = selected?.notifications,
      application = selected?.application, recovery = selected?.recovery, crm = selected?.crm, broadcast = selected?.broadcast, video = selected?.video;
    const keyNames = [...["totpKey", "mailKey", "messageKey", "mediaKey"], ...(!photos || crm ? ["crmKey"] : []), ...(notifications ? ["notificationKey"] : []), ...(video ? ["videoKey"] : [])];
    const config = (dependencies.configure ?? configuration)(env, options.profile), { media, keys, video: videoConfig } = config ?? {};
    if (media?.enabled !== true || !media.capacity || typeof config.databaseName !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(config.databaseName)
      || !keys || keyNames.some((key) => !Buffer.isBuffer(keys[key]) || keys[key].length !== 32)
      || !Buffer.isBuffer(media.key) || !media.key.equals(keys.mediaKey)
      || video && (!videoConfig || typeof videoConfig.root !== "string" || !isAbsolute(videoConfig.root) || videoConfig.root !== resolve(videoConfig.root)
        || !videoConfig.capacity || ![videoConfig.capacity.ownerBytes, videoConfig.capacity.totalBytes].every(value => Number.isSafeInteger(value) && value > 0)
        || videoConfig.capacity.totalBytes < videoConfig.capacity.ownerBytes)) fail("BACKUP_CONFIG");
    const keyValues = Object.values(keys);
    if (keyValues.length !== keyNames.length || keyValues.some((key, index) => keyValues.slice(index + 1).some((other) => key.equals(other)))) fail("BACKUP_CONFIG");
    const manifestRelative = relative(media.root, options.manifestPath);
    if (video) {
      const overlaps = (a, b) => { const suffix = relative(a, b); return suffix === "" || suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix); };
      if (overlaps(media.root, videoConfig.root) || overlaps(videoConfig.root, media.root) || overlaps(videoConfig.root, options.manifestPath)) fail("BACKUP_CONFIG");
    }
    if (manifestRelative === "" || !manifestRelative.startsWith(`..${sep}`) && manifestRelative !== ".." && !isAbsolute(manifestRelative)) fail("BACKUP_CONFIG");
    const manifests = dependencies.manifests ?? await import("../server/backup/manifest.mjs");
    const snapshots = dependencies.snapshots ?? await import("../server/backup/snapshot.mjs");
    const verification = await import("../server/backup/verify.mjs");
    const verifyCrypto = dependencies.verifyBackupData ?? (video ? verification.verifyPhotoNotificationRecoveryCrmBroadcastVideoBackupData : broadcast ? verification.verifyPhotoNotificationRecoveryCrmBroadcastBackupData : crm ? verification.verifyPhotoNotificationRecoveryCrmBackupData : recovery ? verification.verifyPhotoNotificationRecoveryBackupData
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
    const videoStorage = video ? await (dependencies.makeVideoStorage ?? (await import("../server/video/storage.mjs")).createVideoStorage)({ root: videoConfig.root, key: keys.videoKey }) : null;
    const videoFingerprint = video ? await videoStorage.fingerprint() : null;
    if (video && (!Buffer.isBuffer(videoFingerprint) || videoFingerprint.length !== 32)) fail("BACKUP_VERIFY");
    const videoCapacity = video ? { ...videoConfig.capacity, rootFingerprint: videoFingerprint } : null;
    const videoStore = video ? await (dependencies.makeVideoStore ?? (await import("../server/video/store.mjs")).createVideoStore)({ pool, capacity: videoCapacity,
      chatStore: (await import("../server/chat/store.mjs")).createChatStore(pool) }) : null;
    if (video) await videoStore.assertSchema();
    const schemaStore = dependencies.makeSchemaStore ? dependencies.makeSchemaStore({ pool, capacity })
      : (await import("../server/media/store.mjs")).createMediaStore({ pool, capacity, chatStore: (await import("../server/chat/store.mjs")).createChatStore(pool) });
    if (video) await schemaStore.assertSchema({ video: true });
    else await schemaStore.assertSchema();
    inspectionPool = await (dependencies.createInspectionPool ?? (application
      ? (await import("../server/backup/application-scope.mjs")).createApplicationInspectionPool
      : (await import("../server/backup/inspection.mjs")).createBackupInspectionPool))(env);
    if (!inspectionPool || inspectionPool === pool) fail("BACKUP_CONFIG");
    const store = (dependencies.makeSnapshotStore ?? snapshots.createBackupSnapshotStore)({ pool, inspectionPool, ...(application ? { coverage: "application-tables" } : {}), ...(video ? { video: true } : {}) });
    const databaseName = await store.databaseName();
    if (databaseName !== config.databaseName) fail("BACKUP_CONFIG");
    const identity = await manifests.backupIdentity({ databaseName, rootPath: media.root, storage, mediaKey: keys.mediaKey, ...(video ? { videoRootPath: videoConfig.root, videoStorage } : {}) });
    if (!fingerprint(identity.rootFingerprint).equals(rootFingerprint)) fail("BACKUP_VERIFY");
    const sourceIdentity = payload?.identity;
    if (sourceIdentity) await manifests.assertCloneIdentity(sourceIdentity, identity);
    const cryptoStore = photos ? undefined : makeCryptoStore({ pool });
    const capture = () => {
      checkSignal(dependencies.signal);
      return snapshots.captureBackupSnapshot({ store, signal: dependencies.signal, limits: dependencies.limits });
    };
    const compare = (expected, actual, mode) => snapshots.assertBackupSnapshot({ expected, actual, mode,
      ...(sourceIdentity ? { targetFingerprint: identity.rootFingerprint, ...(video ? { targetVideoFingerprint: identity.video.rootFingerprint } : {}) } : {}) });
    async function verifyData(snapshot, mode) {
      checkSignal(dependencies.signal);
      assertReport(await snapshots.verifyBackupStorage({ snapshot, storage, ...(video ? { videoStorage, expectedVideoRootFingerprint: identity.video.rootFingerprint } : {}), mode, signal: dependencies.signal, limits: dependencies.limits }));
      const cryptoLimits = Object.fromEntries(Object.entries(dependencies.limits ?? {}).filter(([key]) => ["maxRows", "maxIssues"].includes(key)));
      assertReport(await verifyCrypto({ ...(photos ? { pool } : { store: cryptoStore }), storage, ...(video ? { videoStorage } : {}), keys, signal: dependencies.signal, limits: cryptoLimits }));
    }
    async function sameIdentity() {
      const current = await manifests.backupIdentity({ databaseName: await store.databaseName(), rootPath: media.root, storage, mediaKey: keys.mediaKey, ...(video ? { videoRootPath: videoConfig.root, videoStorage } : {}) });
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
      if (video) {
        const status = await videoStore.status();
        if (status?.ready !== true || !Buffer.isBuffer(status.rootFingerprint) || !status.rootFingerprint.equals(videoFingerprint)
          || status.ownerBytes !== videoConfig.capacity.ownerBytes || status.totalBytes !== videoConfig.capacity.totalBytes
          || before.video?.capacity?.rootFingerprint !== identity.video.rootFingerprint) fail("BACKUP_VERIFY");
      }
      await verifyData(before, "exact");
      const after = await capture(); compare(before, after, "exact"); await sameIdentity();
      manifest = await manifests.createBackupManifest({ snapshot: after, identity, keys, now: instant(clock),
        ...(photos ? { profile: manifestProfile(options.profile) } : {}) });
      checkSignal(dependencies.signal);
      await manifests.writeManifest(options.manifestPath, manifest);
      result = { command: options.command, verified: true, prepared: true, restored: false, releasedCandidates: 0, manifestHash: manifests.manifestHash(manifest) };
    } else {
      const expected = payload.snapshot;
      if (expected.capacity?.ownerBytes !== media.capacity.ownerBytes || expected.capacity?.totalBytes !== media.capacity.totalBytes
        || video && (expected.video?.capacity?.ownerBytes !== videoConfig.capacity.ownerBytes || expected.video?.capacity?.totalBytes !== videoConfig.capacity.totalBytes)) fail("BACKUP_VERIFY");
      let comparison = compare(expected, before, "recovery");
      await verifyData(before, "recovery");
      const afterChecks = await capture(); compare(before, afterChecks, "exact"); compare(expected, afterChecks, "recovery"); await sameIdentity();
      before = afterChecks;
      let releasedCandidates = 0, releasedVideoCandidates = 0;
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
        if (video) {
          const videoRecovery = (dependencies.makeVideoRecoveryStore ?? (await import("../server/backup/recovery-store.mjs")).createVideoBackupRecoveryStore)({ pool });
          const sourceFingerprint = fingerprint(sourceIdentity.video.rootFingerprint), targetFingerprint = fingerprint(identity.video.rootFingerprint);
          const current = await capture(), currentComparison = compare(expected, current, "recovery");
          if (!Array.isArray(currentComparison.videoCandidates)) fail("BACKUP_VERIFY");
          if (current.video.capacity.rootFingerprint !== identity.video.rootFingerprint) {
            const byId = new Map(current.video.assets.map(row => [row.id, row]));
            for (const original of currentComparison.videoCandidates) {
              checkSignal(dependencies.signal); const row = byId.get(original.id);
              if (!row || !["reserved", "cleanup_pending", "released"].includes(row.state)) fail("BACKUP_VERIFY");
              if (row.state === "released") continue;
              const candidate = videoCandidateDTO(original), command = { candidate, sourceFingerprint, targetDatabaseName: databaseName };
              const closed = await videoRecovery.closeCandidate({ ...command, now: instant(clock) });
              if (closed?.closed !== true || !["cleanup_pending", "released"].includes(closed.state)) fail("BACKUP_VERIFY");
              if (closed.state === "released") continue;
              await videoStorage.remove({ storageKey: Buffer.from(candidate.storage_key, "hex") });
              if ((await videoRecovery.releaseCandidate({ ...command, now: instant(clock) }))?.released !== true) fail("BACKUP_VERIFY");
              releasedVideoCandidates++;
            }
          }
          const afterVideo = await capture(); compare(expected, afterVideo, "recovery"); await verifyData(afterVideo, "recovery");
          const finalVideo = await capture(); compare(afterVideo, finalVideo, "exact");
          const compared = compare(expected, finalVideo, "recovery"); await sameIdentity();
          if (!Number.isSafeInteger(compared.videoHeldBytes) || compared.videoHeldBytes < 0) fail("BACKUP_VERIFY");
          if ((await videoRecovery.rebind({ sourceFingerprint, targetFingerprint, targetDatabaseName: databaseName,
            capacity: videoConfig.capacity, expectedHeldBytes: compared.videoHeldBytes, now: instant(clock) }))?.rebound !== true) fail("BACKUP_VERIFY");
        }
      }
      result = { command: options.command, verified: true, prepared: false, restored: options.command === "restore", releasedCandidates,
        ...(video ? { releasedVideoCandidates } : {}), manifestHash: manifests.manifestHash(manifest) };
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
