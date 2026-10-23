import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { databaseOptions, connectDatabase } from "../../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations } from "../../server/db/migrations.mjs";
import { loadVideoMigrations } from "../../server/video/migrations.mjs";
import { loadExperienceMigrations } from "../../server/experience/migrations.mjs";
import { createRuntimePool } from "../../server/db/runtime.mjs";
import { createApplicationInspectionPool } from "../../server/backup/application-scope.mjs";
import { createBroadcastStore } from "../../server/broadcast/store.mjs";
import { campaignFingerprint, recipientProof, sealPayload } from "../../server/broadcast/crypto.mjs";
import { audienceSelectorHash } from "../../server/broadcast/audience.mjs";
import { createChatStore } from "../../server/chat/store.mjs";
import { createMediaStore } from "../../server/media/store.mjs";
import { createMediaCapacityStore } from "../../server/media/capacity-store.mjs";
import { createMediaStorage } from "../../server/media/storage.mjs";
import { normalizeImage } from "../../server/media/image.mjs";
import { createVideoStorage, VIDEO_BLOCK_BYTES, videoStoredBytes } from "../../server/video/storage.mjs";
import { createVideoStore } from "../../server/video/store.mjs";
import { createVideoMessageStore } from "../../server/video/message-store.mjs";
import { createReplyTracking } from "../../server/tasks/reply.mjs";
import { sealPreferences } from "../../server/preferences/crypto.mjs";
import { preferencesIndex, PREFERENCES_CATALOGUE_VERSION } from "../../server/preferences/validation.mjs";
import { makeTotpSecret, sealTotpSecret } from "../../server/auth/crypto.mjs";
import { encryptMessageBody, messageFingerprint, videoMessageFingerprint } from "../../server/chat/crypto.mjs";
import { createErasureJournal } from "../../server/data/erasure-journal.mjs";
import { createQuickRepliesFiles } from "../../server/quick-replies/files.mjs";
import { withPrivateDirectory } from "../../server/files/private-directory.mjs";
import { readCheckpointReceipt } from "../../server/backup/checkpoint-receipt.mjs";
import { resumeCheckpointMedia, copyCheckpointMedia, verifyCheckpointMedia } from "../../server/backup/checkpoint-files.mjs";
import { resumeCheckpointVideo, copyCheckpointVideo, verifyCheckpointVideo } from "../../server/backup/video-checkpoint-files.mjs";
import { verifyCheckpointArchive } from "../../server/backup/checkpoint-archive.mjs";
import { captureBackupSnapshot, createBackupSnapshotStore } from "../../server/backup/snapshot.mjs";
import { readManifest, verifyBackupManifest } from "../../server/backup/manifest.mjs";
import { main as backupMain } from "../../scripts/backup.mjs";
import { main as captureMain, inspectApplicationCheckpointIdentity, inspectCheckpointTools, gzipCheckpointSql, archiveCheckpoint } from "../../scripts/private-checkpoint.mjs";
import { importNativeSql, run as importApplicationCheckpoint } from "../../scripts/import-application-checkpoint.mjs";
import { run as resumeApplicationCheckpoint } from "../../scripts/resume-application-checkpoint.mjs";
import { run as verifyPrivateCheckpoint, verifyApplicationCloneSnapshot } from "../../scripts/verify-private-checkpoint.mjs";
import { dumpCloneSql } from "../../scripts/verify-text-clone.mjs";
import { loadRuntimeVideoEnvironment } from "../../server/config/runtime-video.mjs";
import { writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration, writeRuntimeMessagingConfiguration,
  writeRuntimeMediaConfiguration, writeRuntimeNotificationsConfiguration, writeRuntimeCrmConfiguration, writeRuntimeVideoConfiguration } from "../../server/config/runtime-database-file.mjs";
import { seedLegacyClientVideoAsset, seedLegacyClientVideoMessage } from "../helpers/legacy-video-seed.mjs";
import { consumeSyntheticInvitation } from "./manual-admission.mjs";
import { videoBundle } from "./video-private.mjs";
import { PRIMARY } from "./crm-private.mjs";
import { mp4Source } from "../helpers/video-transport-fixture.mjs";

const id = () => randomBytes(16), secret = () => randomBytes(32), hex = value => value.toString("hex");
export const sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const local = env => ({ ...env, JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1" });
const BASE_PROFILE = "photos-notify-recovery-crm-broadcast-video";
export const VIDEO_BACKUP_PROFILE = `${BASE_PROFILE}-application`;
export const fileHash = value => createHash("sha256").update(value).digest("hex");
export async function fileInventory(root) {
  const result = [];
  for (const name of (await readdir(root)).sort()) {
    const stat = await lstat(path.join(root, name)); assert.equal(stat.isFile(), true); assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.mode & 0o777, 0o600); assert.equal(stat.nlink, 1);
    result.push([name, fileHash(await readFile(path.join(root, name)))]);
  }
  return result;
}
function localSqlClient(executable, args, options) {
  assert.ok(["/usr/bin/mariadb-dump", "/usr/bin/mariadb"].includes(executable));
  assert.ok(args.some(arg => arg.startsWith("--defaults-file=")), "native credentials stay in the pinned private file");
  return spawn(executable, [args[0], "--skip-ssl", ...args.slice(1).filter(arg => !arg.startsWith("--ssl-ca=") && arg !== "--ssl-verify-server-cert")], options);
}

/** Disposable native fixture. The only transport substitution is loopback SQL
 * without TLS; capture, SQL parser/import, crypto, files and tar remain real. */
export async function videoBackupFixture(t, { experience = false } = {}) {
  assert.equal(typeof experience, "boolean");
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  const targetDatabase = process.env.JESSIEMESSAGE_RESTORE_TEST_DATABASE;
  assert.match(targetDatabase ?? "", /^jessiemessage_test(?:_[a-z0-9]+)*$/); assert.notEqual(targetDatabase, options.database);
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  assert.match(process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_USER ?? "", /^jessiemessage_shared_test(?:_[a-z0-9]+)*$/);
  const targetEnv = { ...process.env, JESSIEMESSAGE_DB_NAME: targetDatabase, JESSIEMESSAGE_APPLICATION_DATABASE: targetDatabase, JESSIEMESSAGE_MIGRATION_DATABASE: targetDatabase };
  const migrations = await (experience ? loadExperienceMigrations : loadVideoMigrations)(), tables = createdMigrationTables(migrations), physical = [...tables, "schema_migrations"];
  assert.equal(migrations.length, experience ? 38 : 36); assert.equal(tables.length, experience ? 36 : 35); assert.equal(physical.length, experience ? 37 : 36);
  const allowed = [...tables, "schema_migrations", "migration_probe"];
  const sourceConnection = await connectDatabase(), targetConnection = await connectDatabase(targetEnv);
  const qualified = (database, table) => {
    assert.ok([options.database, targetDatabase].includes(database)); assert.ok(allowed.includes(table)); return `\`${database}\`.\`${table}\``;
  };
  async function reset(database) {
    const actual = await sourceConnection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
    assert.ok(actual.every(row => allowed.includes(row.name)), "never drop an unrelated disposable schema object");
    for (const table of [...tables].reverse().concat(["migration_probe", "schema_migrations"])) await sourceConnection.query(`DROP TABLE IF EXISTS ${qualified(database, table)}`);
  }
  const parent = path.resolve(import.meta.dirname, "../../../audit"); await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(parent, "video-backup-flow-")); await chmod(root, 0o700);
  const dirs = Object.fromEntries(["sourceMedia", "sourceVideo", "privateDirectory", "sourceOperations", "targetMedia", "targetVideo", "targetOperations", "quarantine"].map(name => [name, path.join(root, name)]));
  dirs.checkpoint = path.join(root, "checkpoint");
  for (const [name, directory] of Object.entries(dirs)) if (name !== "checkpoint") await mkdir(directory, { mode: 0o700 });
  const keys = Object.fromEntries(["totpKey", "mailKey", "messageKey", "mediaKey", "notificationKey", "crmKey", "videoKey"].map((name, index) => [name, Buffer.alloc(32, index + 1)]));
  const limits = { ownerBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024 };
  const now = Date.now() - 60000, clock = () => now + 10000, created = sqlDate(now - 1000);
  let sourcePool, sourceInspector, targetPool, targetInspector, source, target, baseline;
  t.after(async () => {
    try { await sourceInspector?.end(); await targetInspector?.end(); await sourcePool?.end(); await targetPool?.end(); }
    finally { try { await reset(targetDatabase); await reset(options.database); } finally { await sourceConnection.end(); await targetConnection.end(); await rm(root, { recursive: true, force: true }); } }
  });
  await reset(options.database); await reset(targetDatabase); await applyMigrations(sourceConnection, { database: options.database, migrations });
  sourcePool = await createRuntimePool(process.env); targetPool = await createRuntimePool(targetEnv);
  const records = videoBundle(dirs.sourceMedia, dirs.sourceVideo);
  records.database = { ...records.database, host: options.host, port: String(options.port), database: options.database,
    user: process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_USER, password: process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_PASSWORD, privilegeProfile: "infomaniak-shared" };
  records.media = { ...records.media, ownerBytes: String(limits.ownerBytes), totalBytes: String(limits.totalBytes), minimumFreeBytes: "0" };
  records.video = { ...records.video, ownerBytes: String(limits.ownerBytes), totalBytes: String(limits.totalBytes), minimumFreeBytes: "0" };
  const writers = [writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration, writeRuntimeMessagingConfiguration,
    writeRuntimeMediaConfiguration, writeRuntimeNotificationsConfiguration, writeRuntimeCrmConfiguration, writeRuntimeVideoConfiguration];
  for (const [index, value] of Object.values(records).entries()) await writers[index](dirs.privateDirectory, value, PRIMARY);
  const loadEnvironment = async (directory, params) => loadRuntimeVideoEnvironment(directory, params);
  const environment = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" }, sourceEnvironment = local(await loadEnvironment(dirs.privateDirectory, { originProfile: "primary", recovery: true }));
  sourceInspector = await createApplicationInspectionPool(sourceEnvironment); targetInspector = await createApplicationInspectionPool(targetEnv);
  const storage = await createMediaStorage({ root: dirs.sourceMedia, key: keys.mediaKey, pathMode: "linux-dirfd" });
  const videoStorage = await createVideoStorage({ root: dirs.sourceVideo, key: keys.videoKey, pathMode: "linux-dirfd" });
  source = { database: options.database, rootPath: dirs.sourceMedia, videoRootPath: dirs.sourceVideo, pool: sourcePool, inspectionPool: sourceInspector, storage, videoStorage };
  const mediaCapacity = { ...limits, rootFingerprint: await storage.fingerprint() }, videoCapacity = { ...limits, rootFingerprint: await videoStorage.fingerprint() };
  const chat = createChatStore(sourcePool, { clock, ...(experience ? { replyTracking: createReplyTracking({ key: keys.crmKey }) } : {}) }), media = createMediaStore({ pool: sourcePool, chatStore: chat, capacity: mediaCapacity });
  await createMediaCapacityStore({ pool: sourcePool, capacity: mediaCapacity }).initialize({ now, offline: true });
  const videos = createVideoStore({ pool: sourcePool, chatStore: chat, capacity: videoCapacity, experience }); await videos.initialize({ now, offline: true });
  const videoMessages = createVideoMessageStore({ pool: sourcePool, chatStore: chat, videoStore: videos });
  const actor = user => ({ role: user.role, tokenHash: user.tokenHash, now });
  async function addUser(role) {
    const user = { id: id(), role, tokenHash: secret(), sessionId: id() };
    await sourceConnection.query(`INSERT INTO users (id,role,status,pseudonym,email,password_hash,email_verified_at,age_assured_at,access_approved_at,created_at,updated_at)
      VALUES (?,?,'active',?,?,'synthetic-not-a-password',?,?,?,?,?)`, [user.id, role, `Synthetic backup ${role}`, `${hex(user.id)}@example.invalid`, created, created, created, created, created]);
    if (role === "admin") await sourceConnection.query("INSERT INTO admin_mfa (user_id,secret_encrypted,version,last_totp_step,enabled_at) VALUES (?,?,1,?,?)", [user.id, sealTotpSecret(makeTotpSecret(), keys.totpKey, user.id), Math.floor(now / 30000), created]);
    else { await sourceConnection.query("INSERT INTO client_auth_state (user_id,credential_version,age_declared_at) VALUES (?,1,?)", [user.id, created]); await consumeSyntheticInvitation(sourceConnection, user.id, now - 1000); }
    await sourceConnection.query("INSERT INTO sessions (id,user_id,token_hash,created_at,expires_at) VALUES (?,?,?,?,?)", [user.sessionId, user.id, user.tokenHash, created, sqlDate(now + 8 * 3600000)]);
    if (role === "admin") await sourceConnection.query("INSERT INTO auth_session_state (session_id,last_seen_at,mfa_verified_at,mfa_version) VALUES (?,?,?,1)", [user.sessionId, created, created]);
    else await sourceConnection.query("INSERT INTO client_session_state (session_id,last_seen_at,credential_version) VALUES (?,?,1)", [user.sessionId, created]);
    return user;
  }
  const admin = await addUser("admin"), clients = [await addUser("client"), await addUser("client")], conversations = [];
  for (const client of clients) { const conversationId = id(); conversations.push(conversationId); await sourceConnection.query("INSERT INTO conversations (id,client_id,admin_id,created_at) VALUES (?,?,?,?)", [conversationId, client.id, admin.id, created]); }
  const normalized = await normalizeImage(await sharp({ create: { width: 40, height: 30, channels: 3, background: "#864561" } }).png().toBuffer());
  const photo = { id: id(), storageKey: secret(), digest: normalized.digest, width: normalized.width, height: normalized.height,
    thumbnailWidth: normalized.thumbnailWidth, thumbnailHeight: normalized.thumbnailHeight, fullBytes: normalized.full.length, thumbnailBytes: normalized.thumbnail.length };
  await media.reserveAsset({ ...actor(admin), asset: photo }); await storage.put({ assetId: photo.id, storageKey: photo.storageKey, full: normalized.full, thumbnail: normalized.thumbnail });
  await media.registerAsset({ ...actor(admin), asset: photo });
  const clientPhoto = { ...photo, id: id(), storageKey: secret() };
  await media.reserveAsset({ ...actor(clients[0]), asset: clientPhoto });
  await storage.put({ assetId: clientPhoto.id, storageKey: clientPhoto.storageKey, full: normalized.full, thumbnail: normalized.thumbnail });
  await media.registerAsset({ ...actor(clients[0]), asset: clientPhoto });
  async function addVideo(owner, state = "committed", file = true) {
    const asset = { id: id(), storageKey: secret(), bytes: VIDEO_BLOCK_BYTES * 2 + 113, mime: "video/mp4" }; asset.storedBytes = videoStoredBytes(asset.bytes);
    if (owner.role === "client") {
      if (state !== "committed" || !file) throw new TypeError("Historical client fixture must be committed");
      const legacy = await seedLegacyClientVideoAsset({ connection: sourceConnection, storage: videoStorage, owner, now, asset, source: mp4Source(asset.bytes) });
      return { ...legacy, owner, state, file };
    }
    await videos.reserve({ ...actor(owner), asset });
    if (file) { const written = await videoStorage.put({ assetId: asset.id, storageKey: asset.storageKey, bytes: asset.bytes, source: mp4Source(asset.bytes) }); asset.digest = written.digest; }
    if (state !== "reserved") await videos.commit({ ...actor(owner), now: now + 1000, asset });
    if (state === "cleanup_pending") await videos.deleteAsset({ ...actor(owner), now: now + 2000, assetId: asset.id });
    return { ...asset, owner, state, file };
  }
  const sharedVideo = await addVideo(admin), clientVideos = [await addVideo(clients[0]), await addVideo(clients[1])];
  const pending = [await addVideo(admin, "reserved", false), await addVideo(admin, "reserved", true), await addVideo(admin, "cleanup_pending", true)];
  const messages = [];
  async function send(owner, conversationId, asset, kind) {
    const messageId = id(), body = JSON.stringify({ [kind === "video" ? "videoId" : "mediaId"]: hex(asset.id), caption: "Synthetic restored attachment" }), binding = { conversationId, messageId, senderId: owner.id };
    const request = { ...actor(owner), now: now + 3000, conversationId, message: { id: messageId, clientMessageId: id(),
      [kind === "video" ? "videoId" : "mediaId"]: asset.id, bodyEncrypted: encryptMessageBody(body, keys.messageKey, binding),
      bodyFingerprint: (kind === "video" ? videoMessageFingerprint : messageFingerprint)(body, keys.messageKey, binding) } };
    if (kind === "video" && owner.role === "client") await seedLegacyClientVideoMessage({ chatStore: chat, owner, conversationId, asset, caption: "Synthetic restored attachment", key: keys.messageKey, now: now + 3000, messageId, clientMessageId: request.message.clientMessageId });
    else await (kind === "video" ? videoMessages : chat).sendMessage(request);
    messages.push({ id: messageId, conversationId, owner, asset, kind });
  }
  for (const conversation of conversations) { await send(admin, conversation, photo, "photo"); await send(admin, conversation, sharedVideo, "video"); }
  for (let index = 0; index < clients.length; index++) await send(clients[index], conversations[index], clientVideos[index], "video");
  await send(clients[0], conversations[0], clientPhoto, "photo");
  const preferenceSelections = [];
  if (experience) {
    const choices = [...preferencesIndex.keys()].slice(0, 6);
    for (const [index, owner] of [admin, ...clients].entries()) {
      const value = { catalogueVersion: PREFERENCES_CATALOGUE_VERSION, selectedIds: choices.slice(index * 2, index * 2 + 2) },
        encrypted = sealPreferences(value, keys.crmKey, hex(owner.id), "1");
      await sourceConnection.query("INSERT INTO profile_preferences (user_id, version, selection_encrypted, created_at, updated_at) VALUES (?, 1, ?, ?, ?)", [owner.id, encrypted, created, created]);
      preferenceSelections.push({ owner, value, encrypted });
    }
    const request = { ...actor(admin), now: now + 4000, conversationId: conversations[1] },
      reply = (await chat.readMessages({ ...request, limit: 50 })).conversation.reply;
    const handled = await chat.markReply({ ...request, input: { action: "handled", through: reply.through, expectedVersion: reply.version } });
    await chat.markReply({ ...request, input: { action: "needed", through: handled.through, expectedVersion: handled.version } });
  }
  // A retained pending v3 campaign proves that capture and later account
  // closure authenticate typed references without abusing the photo FK.
  const broadcasts = createBroadcastStore(sourcePool, { chatStore: chat, key: keys.messageKey, videoEnabled: true,
    videoStore: videos, videoMessageStore: videoMessages, clock });
  const audience = { mode: "selected", conversationIds: conversations.map(hex).sort() };
  const preview = await broadcasts.previewAudience({ ...actor(admin), audience, mediaId: null, videoId: sharedVideo.id });
  const broadcastCampaignId = id(), broadcastBinding = { campaignId: broadcastCampaignId, adminId: admin.id };
  const broadcastPayload = { version: 3, title: "Synthetic retained video campaign", body: "Synthetic private video caption", mediaId: null,
    videoId: hex(sharedVideo.id), allowRepeatMedia: true,
    audience: { mode: "selected", count: preview.eligibleCount, digest: preview.digest, selectorHash: audienceSelectorHash(audience) } };
  const createdCampaign = await broadcasts.createAudience({ ...actor(admin), audience,
    snapshot: { count: preview.eligibleCount, digest: preview.digest, repeatCount: preview.repeatCount }, verifyPreview() {},
    campaign: { id: broadcastCampaignId, clientCampaignId: id(), mediaId: null, videoId: sharedVideo.id, allowRepeatMedia: true,
      payloadEncrypted: sealPayload(broadcastPayload, keys.messageKey, broadcastBinding, { video: true }),
      requestFingerprint: campaignFingerprint(broadcastPayload, keys.messageKey, broadcastBinding, { video: true }),
      recipientProof: member => recipientProof(keys.messageKey, member) } });
  assert.equal(createdCampaign.campaign.counts.pending, 2);
  const binding = { database: options.database, rootFingerprint: hex(mediaCapacity.rootFingerprint), videoRootFingerprint: hex(videoCapacity.rootFingerprint) };
  const legacyBinding = { database: binding.database, rootFingerprint: binding.rootFingerprint };
  for (const [selected, clientId] of [[legacyBinding, "9".repeat(32)], [binding, "8".repeat(32)]]) {
    assert.ok([admin, ...clients].every(user => hex(user.id) !== clientId), "historical receipts concern nonlive fixture accounts");
    const journal = createErasureJournal({ directory: dirs.sourceOperations, key: keys.crmKey, binding: selected, clientId });
    let revision = 0, updatedAt = now;
    try { for (const phase of ["requested", "prepared", "files_erased", "completed"]) revision = (await journal.save({ version: selected.videoRootFingerprint ? 2 : 1,
      clientId, binding: selected, phase, cursor: null, startedAt: now, updatedAt: updatedAt++ }, revision, async () => {})).revision; }
    finally { journal.close(); }
  }
  const quickRepliesOwner = hex(admin.id), quickRepliesName = `quick-replies-${quickRepliesOwner}.json`,
    quickRepliesStore = createQuickRepliesFiles(dirs.sourceOperations, keys.crmKey, quickRepliesOwner);
  let quickRepliesInitial;
  try {
    quickRepliesInitial = await quickRepliesStore.save([{ id: "7".repeat(32), title: "Synthetic saved reply", body: "Synthetic private answer retained in backup", language: "en" }], 0, async () => {
      assert.equal(Number((await sourceConnection.query("SELECT COUNT(*) AS count FROM users WHERE id = ? AND role = 'admin' AND status = 'active'", [admin.id]))[0].count), 1);
    });
  } finally { quickRepliesStore.close(); }
  const quickRepliesCiphertext = await readFile(path.join(dirs.sourceOperations, quickRepliesName));
  assert.equal(quickRepliesCiphertext.includes(Buffer.from(quickRepliesInitial.replies[0].body)), false);
  const f = { root, dirs, keys, options, targetDatabase, targetEnv, limits, now, clock, environment, sourceEnvironment, sourceConnection, targetConnection, experience, preferenceSelections,
    source, admin, clients, conversations, photo, clientPhoto, sharedVideo, clientVideos, pending, messages, broadcastCampaignId, broadcastPayload, binding, legacyBinding,
    quickReplies: { owner: quickRepliesOwner, filename: quickRepliesName, initial: quickRepliesInitial, ciphertext: quickRepliesCiphertext },
    get target() { return target; } };
  const measurements = [], operator = { imports: 0, resumes: 0, inspections: [] };
  async function measure(phase, work) {
    const started = performance.now();
    try { return await work(); }
    finally {
      const value = { phase, durationMs: Math.round((performance.now() - started) * 1000) / 1000, peakNodeRssKiB: process.resourceUsage().maxRSS };
      assert.ok(Number.isFinite(value.durationMs) && value.durationMs >= 0);
      assert.ok(Number.isSafeInteger(value.peakNodeRssKiB) && value.peakNodeRssKiB > 0);
      measurements.push(value);
    }
  }
  f.operator = operator;
  f.measure = measure;
  f.measurements = measurements;
  f.reportMetrics = () => {
    const totals = files => files.reduce((bytes, file) => bytes + file.bytes, 0);
    const value = { type: "video-backup-synthetic-metrics", sqlBytes: f.receipt.sql.uncompressedBytes,
      encryptedPhotoBytes: totals(f.receipt.media.files), encryptedVideoBytes: totals(f.receipt.video.files),
      measurements, peakNodeRssKiB: process.resourceUsage().maxRSS,
      memoryScope: "Node test process peak RSS only; MariaDB, Chrome and child processes excluded", sqlTransport: "owned loopback without TLS" };
    t.diagnostic(JSON.stringify(value)); return value;
  };
  async function databaseHash(database) {
    const hash = createHash("sha256");
    for (const table of physical) {
      const rows = await sourceConnection.query(`SELECT * FROM ${qualified(database, table)}`);
      hash.update(table).update(JSON.stringify(rows.map(row => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => [name, Buffer.isBuffer(value) ? `hex:${hex(value)}` : typeof value === "bigint" ? `int:${value}` : value])))).sort()));
    }
    return hash.digest("hex");
  }
  f.databaseHash = databaseHash;
  f.sourceState = async () => ({ sql: await databaseHash(options.database), photos: await fileInventory(dirs.sourceMedia), videos: await fileInventory(dirs.sourceVideo), operations: await fileInventory(dirs.sourceOperations) });
  baseline = await f.sourceState(); f.sourceBaseline = baseline;
  f.assertSourceUnchanged = async () => assert.deepEqual(await f.sourceState(), baseline, "native capture/import/rebind must not mutate its source");
  f.capture = () => measure("capture", async () => {
    const phase = (label, operation) => async (...args) => {
      t.diagnostic(`Video backup capture: ${label} started`);
      try {
        const result = await operation(...args); t.diagnostic(`Video backup capture: ${label} passed`); return result;
      } catch (error) { t.diagnostic(`Video backup capture: ${label} failed`); throw error; }
    };
    const report = await captureMain(["capture-application", "--offline", "--private-directory", dirs.privateDirectory,
      "--private-path-mode", "linux-dirfd", "--destination-private-directory", dirs.checkpoint, "--profile", BASE_PROFILE, "--operations-directory", dirs.sourceOperations, ...(experience ? ["--experience", "1"] : [])], {
      inheritedEnv: environment, execArgv: [], outputStream: { write() {} },
      loadEnvironment: phase("private configuration", loadRuntimeVideoEnvironment), inspectTools: phase("native tools", inspectCheckpointTools),
      inspectApplicationIdentity: phase("application identity", (env, parameters) => inspectApplicationCheckpointIdentity(local(env), parameters)),
      prepare: phase("backup prepare", (args, env, parameters) => backupMain(args, local(env), parameters)),
      getManifest: phase("manifest read", readManifest), verifyManifest: phase("manifest authentication", verifyBackupManifest),
      dump: phase("native SQL dump", (scope, target, config, password, parameters) => dumpCloneSql(scope, target, config, password, { ...parameters, spawnClient: localSqlClient })),
      copyMedia: phase("photo copy", copyCheckpointMedia), verifyMedia: phase("photo verification", verifyCheckpointMedia),
      copyVideo: phase("video copy", copyCheckpointVideo), verifyVideo: phase("video verification", verifyCheckpointVideo),
      compress: phase("SQL compression", gzipCheckpointSql), archive: phase("archive creation", archiveCheckpoint),
      verifyArchive: phase("archive verification", verifyCheckpointArchive),
    });
    const receipt = await phase("fixture receipt read", () => withPrivateDirectory(dirs.checkpoint, scope => readCheckpointReceipt(scope)))();
    const manifest = await phase("fixture manifest read", readManifest)(path.join(dirs.checkpoint, "manifest.json")), payload = await phase("fixture manifest authentication", verifyBackupManifest)({ manifest, keys });
    f.report = report; f.receipt = receipt; f.manifest = manifest; f.payload = payload; await f.assertSourceUnchanged(); return report;
  });
  f.resetTarget = async () => {
    await reset(targetDatabase);
    for (const directory of [dirs.targetMedia, dirs.targetVideo, dirs.targetOperations, dirs.quarantine]) { await rm(directory, { recursive: true, force: true }); await mkdir(directory, { mode: 0o700 }); }
    target = { database: targetDatabase, rootPath: dirs.targetMedia, videoRootPath: dirs.targetVideo, pool: targetPool, inspectionPool: targetInspector,
      storage: await createMediaStorage({ root: dirs.targetMedia, key: keys.mediaKey, pathMode: "linux-dirfd" }),
      videoStorage: await createVideoStorage({ root: dirs.targetVideo, key: keys.videoKey, pathMode: "linux-dirfd" }) };
  };
  function loopbackConfiguration(value) {
    assert.equal(value.JESSIEMESSAGE_DB_HOST, options.host); assert.equal(Number(value.JESSIEMESSAGE_DB_PORT), options.port);
    assert.equal(value.JESSIEMESSAGE_DB_NAME, targetDatabase);
    assert.equal(value.JESSIEMESSAGE_DB_TLS_CA_PATH, "/etc/ssl/certs/ca-certificates.crt");
    const selected = local(value); delete selected.JESSIEMESSAGE_DB_TLS_CA_PATH; return selected;
  }
  const connectLoopback = value => connectDatabase(loopbackConfiguration(value));
  async function operatorStage(name, work) {
    t.diagnostic(`Video operator ${name} started`);
    try { const result = await work(); t.diagnostic(`Video operator ${name} passed`); return result; }
    catch (error) {
      const codes = [error?.code, error?.detailCode].filter(value => typeof value === "string"
        && /^(?:(?:APPLICATION_CHECKPOINT_(?:IMPORT|RESUME)|PRIVATE_CHECKPOINT_VERIFY|BACKUP)_[A-Z_]+|ERR_ASSERTION)$/.test(value));
      t.diagnostic(`Video operator ${name} failed (${codes.join(",") || "closed error"})`); throw error;
    }
  }
  // CI's database has no TLS listener. Do not invent a successful Ssl_cipher:
  // assert that fact and classify the real disposable schema. Only these two
  // TLS-only operator inspectors are replaced; the wrappers, exact application
  // inspection/history, crypto, two native dumps and signed snapshot are real.
  async function inspectLoopbackClone(connection, database, selection = { video: true, ...(experience ? { experience: true } : {}) }) {
    assert.equal(database, targetDatabase); assert.equal(selection.video, true); assert.equal(selection.experience === true, experience);
    const identity = await connection.query("SELECT DATABASE() AS name"), transport = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    assert.equal(identity.length, 1); assert.equal(identity[0].name, targetDatabase);
    assert.equal(transport.length, 1); assert.equal(transport[0].Variable_name, "Ssl_cipher"); assert.equal(transport[0].Value, "");
    const rows = await connection.query(`SELECT TABLE_NAME AS name, TABLE_TYPE AS kind, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME LIMIT ${physical.length + 1}`, [database]);
    const state = !rows.length ? "empty" : rows.length === physical.length
      && rows.every(row => row.kind === "BASE TABLE" && row.engine === "InnoDB")
      && JSON.stringify(rows.map(row => row.name).sort()) === JSON.stringify([...physical].sort()) ? "application-schema" : "partial";
    operator.inspections.push(state); return state;
  }
  const verifyOperator = (selection, dependencies) => operatorStage(`verification ${selection.command}`, () => verifyPrivateCheckpoint(selection, { ...dependencies, connect: connectLoopback,
    dump: (scope, selected, configuration, password, parameters) => dumpCloneSql(scope, selected, configuration, password, { ...parameters, spawnClient: localSqlClient }),
    verifyApplicationSnapshot: (source, selected, password, parameters) => verifyApplicationCloneSnapshot(source, selected, password, { ...parameters,
      backup: (args, env, settings) => backupMain(args, loopbackConfiguration(env), settings) }),
  }));
  const importOperator = (selection, dependencies) => operatorStage(`import ${selection.command}`, () => importApplicationCheckpoint(selection, { ...dependencies, verify: verifyOperator, connect: connectLoopback,
    async inspect(connection, database) { assert.equal(await inspectLoopbackClone(connection, database), "empty"); },
    async importSql(scope, selected, configuration, password, sql, parameters) {
      operator.imports++; return importNativeSql(scope, selected, configuration, password, sql, { ...parameters, spawnClient: localSqlClient });
    },
  }));
  f.resumeImport = () => measure("operator-resume", async () => {
    operator.resumes++;
    const result = await resumeApplicationCheckpoint({ command: "resume", privateDirectory: dirs.privateDirectory, privatePathMode: "linux-dirfd",
      checkpointDirectory: dirs.checkpoint, database: targetDatabase, confirmation: targetDatabase, user: options.user,
      profile: BASE_PROFILE, sqlSha256: f.receipt.sql.uncompressedSha256, ...(experience ? { experience: true } : {}) },
    { inheritedEnv: environment, execArgv: [], readSecret: async () => options.password, connect: connectLoopback,
      inspect: inspectLoopbackClone, importOperation: importOperator, verifyOperation: verifyOperator });
    assert.equal(await databaseHash(targetDatabase), baseline.sql); await f.assertSourceUnchanged(); return result;
  });
  f.import = async () => {
    const present = await targetConnection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [targetDatabase]); assert.deepEqual(present, []);
    const result = await f.resumeImport(); assert.equal(result.action, "imported_empty_clone"); assert.equal(result.importedThisRun, true); return result;
  };
  f.copy = ({ signal } = {}) => measure("copy-two-roots", async () => {
    const photos = await withPrivateDirectory(dirs.checkpoint, checkpoint => withPrivateDirectory(path.join(dirs.checkpoint, "media"), source =>
      withPrivateDirectory(dirs.targetMedia, target => resumeCheckpointMedia(source, target, f.receipt.media, { signal }))));
    const videos = await withPrivateDirectory(dirs.checkpoint, checkpoint => withPrivateDirectory(path.join(dirs.checkpoint, "video"), source =>
      withPrivateDirectory(dirs.targetVideo, target => resumeCheckpointVideo(source, target, f.receipt.video, { signal }))));
    return { photos, videos };
  });
  f.backup = (command, extra = {}) => measure(`backup-${command}`, () => backupMain([command, "--offline", "--manifest", path.join(dirs.checkpoint, "manifest.json"), "--profile", VIDEO_BACKUP_PROFILE, ...(experience ? ["--experience", "1"] : [])], targetEnv, {
    configure() { const copies = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, Buffer.from(key)]));
      return { databaseName: targetDatabase, media: { enabled: true, root: dirs.targetMedia, key: copies.mediaKey, capacity: { ...limits }, minimumFreeBytes: 0 },
        video: { root: dirs.targetVideo, capacity: { ...limits }, minimumFreeBytes: 0n }, keys: copies }; },
    clock, outputStream: { write() {} }, ...extra,
  }));
  f.snapshot = (selected = f.target) => captureBackupSnapshot({ store: createBackupSnapshotStore({ pool: selected.pool, inspectionPool: selected.inspectionPool, coverage: "application-tables", video: true, experience }) });
  f.interruptVideoCopy = async () => {
    const names = new Set(f.receipt.video.files.map(file => file.name)), cancellation = new AbortController(), original = fs.promises.open;
    let retained, injected = false;
    fs.promises.open = async (...args) => {
      const handle = await original(...args);
      if (!injected && (args[1] & fs.constants.O_CREAT) && names.has(path.basename(String(args[0])))) {
        injected = true; const sync = handle.sync.bind(handle);
        handle.sync = async () => { await sync(); retained = { name: path.basename(String(args[0])), stat: await handle.stat({ bigint: true }) }; cancellation.abort(); };
      }
      return handle;
    }; syncBuiltinESMExports();
    try { await assert.rejects(f.copy({ signal: cancellation.signal })); assert.equal(injected, true); return retained; }
    finally { fs.promises.open = original; syncBuiltinESMExports(); }
  };
  await f.resetTarget(); return f;
}
