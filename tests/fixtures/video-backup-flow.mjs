import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { databaseOptions, connectDatabase } from "../../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations } from "../../server/db/migrations.mjs";
import { loadVideoMigrations } from "../../server/video/migrations.mjs";
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
import { makeTotpSecret, sealTotpSecret } from "../../server/auth/crypto.mjs";
import { encryptMessageBody, messageFingerprint, videoMessageFingerprint } from "../../server/chat/crypto.mjs";
import { createErasureJournal } from "../../server/data/erasure-journal.mjs";
import { withPrivateDirectory } from "../../server/files/private-directory.mjs";
import { readCheckpointReceipt } from "../../server/backup/checkpoint-receipt.mjs";
import { resumeCheckpointMedia } from "../../server/backup/checkpoint-files.mjs";
import { resumeCheckpointVideo } from "../../server/backup/video-checkpoint-files.mjs";
import { captureBackupSnapshot, createBackupSnapshotStore } from "../../server/backup/snapshot.mjs";
import { readManifest, verifyBackupManifest } from "../../server/backup/manifest.mjs";
import { main as backupMain } from "../../scripts/backup.mjs";
import { main as captureMain, inspectApplicationCheckpointIdentity } from "../../scripts/private-checkpoint.mjs";
import { importNativeSql, readApplicationSql } from "../../scripts/import-application-checkpoint.mjs";
import { dumpCloneSql } from "../../scripts/verify-text-clone.mjs";
import { loadRuntimeVideoEnvironment } from "../../server/config/runtime-video.mjs";
import { writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration, writeRuntimeMessagingConfiguration,
  writeRuntimeMediaConfiguration, writeRuntimeNotificationsConfiguration, writeRuntimeCrmConfiguration, writeRuntimeVideoConfiguration } from "../../server/config/runtime-database-file.mjs";
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
export async function videoBackupFixture(t) {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  const targetDatabase = process.env.JESSIEMESSAGE_RESTORE_TEST_DATABASE;
  assert.match(targetDatabase ?? "", /^jessiemessage_test(?:_[a-z0-9]+)*$/); assert.notEqual(targetDatabase, options.database);
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
  assert.match(process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_USER ?? "", /^jessiemessage_shared_test(?:_[a-z0-9]+)*$/);
  const targetEnv = { ...process.env, JESSIEMESSAGE_DB_NAME: targetDatabase, JESSIEMESSAGE_APPLICATION_DATABASE: targetDatabase, JESSIEMESSAGE_MIGRATION_DATABASE: targetDatabase };
  const migrations = await loadVideoMigrations(), tables = createdMigrationTables(migrations), physical = [...tables, "schema_migrations"];
  assert.equal(migrations.length, 36); assert.equal(tables.length, 35); assert.equal(physical.length, 36);
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
  const chat = createChatStore(sourcePool, { clock }), media = createMediaStore({ pool: sourcePool, chatStore: chat, capacity: mediaCapacity });
  await createMediaCapacityStore({ pool: sourcePool, capacity: mediaCapacity }).initialize({ now, offline: true });
  const videos = createVideoStore({ pool: sourcePool, chatStore: chat, capacity: videoCapacity }); await videos.initialize({ now, offline: true });
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
    await (kind === "video" ? videoMessages : chat).sendMessage(request); messages.push({ id: messageId, conversationId, owner, asset, kind });
  }
  for (const conversation of conversations) { await send(admin, conversation, photo, "photo"); await send(admin, conversation, sharedVideo, "video"); }
  for (let index = 0; index < clients.length; index++) await send(clients[index], conversations[index], clientVideos[index], "video");
  await send(clients[0], conversations[0], clientPhoto, "photo");
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
  const f = { root, dirs, keys, options, targetDatabase, targetEnv, limits, now, clock, environment, sourceEnvironment, sourceConnection, targetConnection,
    source, admin, clients, conversations, photo, clientPhoto, sharedVideo, clientVideos, pending, messages, broadcastCampaignId, broadcastPayload, binding, legacyBinding,
    get target() { return target; } };
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
  f.capture = async () => {
    const report = await captureMain(["capture-application", "--offline", "--private-directory", dirs.privateDirectory,
      "--private-path-mode", "linux-dirfd", "--destination-private-directory", dirs.checkpoint, "--profile", BASE_PROFILE, "--operations-directory", dirs.sourceOperations], {
      inheritedEnv: environment, execArgv: [], outputStream: { write() {} },
      inspectApplicationIdentity: (env, parameters) => inspectApplicationCheckpointIdentity(local(env), parameters),
      prepare: (args, env, parameters) => backupMain(args, local(env), parameters),
      dump: (scope, target, config, password, parameters) => dumpCloneSql(scope, target, config, password, { ...parameters, spawnClient: localSqlClient }),
    });
    const receipt = await withPrivateDirectory(dirs.checkpoint, scope => readCheckpointReceipt(scope));
    const manifest = await readManifest(path.join(dirs.checkpoint, "manifest.json")), payload = await verifyBackupManifest({ manifest, keys });
    f.report = report; f.receipt = receipt; f.manifest = manifest; f.payload = payload; await f.assertSourceUnchanged(); return report;
  };
  f.resetTarget = async () => {
    await reset(targetDatabase);
    for (const directory of [dirs.targetMedia, dirs.targetVideo, dirs.targetOperations, dirs.quarantine]) { await rm(directory, { recursive: true, force: true }); await mkdir(directory, { mode: 0o700 }); }
    target = { database: targetDatabase, rootPath: dirs.targetMedia, videoRootPath: dirs.targetVideo, pool: targetPool, inspectionPool: targetInspector,
      storage: await createMediaStorage({ root: dirs.targetMedia, key: keys.mediaKey, pathMode: "linux-dirfd" }),
      videoStorage: await createVideoStorage({ root: dirs.targetVideo, key: keys.videoKey, pathMode: "linux-dirfd" }) };
  };
  f.import = async () => {
    const present = await targetConnection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [targetDatabase]); assert.deepEqual(present, []);
    await withPrivateDirectory(dirs.checkpoint, async scope => {
      const receipt = await readCheckpointReceipt(scope), bytes = await readApplicationSql(scope, { backupBytes: receipt.sql.bytes, backupSha256: receipt.sql.sha256, sqlBytes: receipt.sql.uncompressedBytes, sqlSha256: receipt.sql.uncompressedSha256 }, { video: true });
      try { assert.equal(fileHash(bytes), receipt.sql.uncompressedSha256); await importNativeSql(scope, { database: targetDatabase, user: options.user }, { host: options.host, port: String(options.port) }, options.password, bytes, { spawnClient: localSqlClient }); }
      finally { bytes.fill(0); }
    });
    assert.equal(await databaseHash(targetDatabase), baseline.sql); await f.assertSourceUnchanged();
  };
  f.copy = async ({ signal } = {}) => {
    const photos = await withPrivateDirectory(dirs.checkpoint, checkpoint => withPrivateDirectory(path.join(dirs.checkpoint, "media"), source =>
      withPrivateDirectory(dirs.targetMedia, target => resumeCheckpointMedia(source, target, f.receipt.media, { signal }))));
    const videos = await withPrivateDirectory(dirs.checkpoint, checkpoint => withPrivateDirectory(path.join(dirs.checkpoint, "video"), source =>
      withPrivateDirectory(dirs.targetVideo, target => resumeCheckpointVideo(source, target, f.receipt.video, { signal }))));
    return { photos, videos };
  };
  f.backup = (command, extra = {}) => backupMain([command, "--offline", "--manifest", path.join(dirs.checkpoint, "manifest.json"), "--profile", VIDEO_BACKUP_PROFILE], targetEnv, {
    configure() { const copies = Object.fromEntries(Object.entries(keys).map(([name, key]) => [name, Buffer.from(key)]));
      return { databaseName: targetDatabase, media: { enabled: true, root: dirs.targetMedia, key: copies.mediaKey, capacity: { ...limits }, minimumFreeBytes: 0 },
        video: { root: dirs.targetVideo, capacity: { ...limits }, minimumFreeBytes: 0n }, keys: copies }; },
    clock, outputStream: { write() {} }, ...extra,
  });
  f.snapshot = (selected = f.target) => captureBackupSnapshot({ store: createBackupSnapshotStore({ pool: selected.pool, inspectionPool: selected.inspectionPool, coverage: "application-tables", video: true }) });
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
