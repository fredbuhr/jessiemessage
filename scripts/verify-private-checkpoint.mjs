import { lstat, realpath } from "node:fs/promises";
import { resolve, relative, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { loadRuntimeNotificationsEnvironment, copyRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";
import { loadRuntimeCrmEnvironment, copyRuntimeCrmEnvironment } from "../server/config/runtime-crm.mjs";
import { loadRuntimeBroadcastEnvironment, copyRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { CHECKPOINT_RUNTIME_PROFILES, checkpointBackupProfile, matchesCheckpointReceipt } from "../server/backup/profiles.mjs";
import { readOperationalCheckpoint, OPERATIONAL_CHECKPOINT } from "../server/backup/operational-checkpoint.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { readManifest, verifyBackupManifest, backupIdentity, assertCloneIdentity } from "../server/backup/manifest.mjs";
import { assertBackupInspection } from "../server/backup/inspection.mjs";
import { APPLICATION_COVERAGE, validateApplicationCoverage, assertApplicationTableInspection } from "../server/backup/application-scope.mjs";
import { verifyPhotoNotificationBackupData, verifyPhotoNotificationRecoveryBackupData, verifyPhotoNotificationRecoveryCrmBackupData, verifyPhotoNotificationRecoveryCrmBroadcastBackupData } from "../server/backup/verify.mjs";
import { connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { inspectDumpClient, readFrozenBackup, dumpCloneSql, inspectClone } from "./verify-text-clone.mjs";
import { readPassword } from "./migration-input.mjs";
import { main as backupMain } from "./backup.mjs";

const REPOSITORY = resolve(fileURLToPath(new URL("../", import.meta.url)));
const CA = "/etc/ssl/certs/ca-certificates.crt";
const FIELDS = ["command", "privateDirectory", "privatePathMode", "checkpointDirectory", "database", "confirmation", "user"];
const COUNT_NAMES = ["rows", "mfa", "mail", "reset", "messages", "crm", "broadcast", "broadcastRecipients", "media", "mediaFiles", "notifications", "notificationJobs"];
const KEY_FIELDS = { totpKey: "JESSIEMESSAGE_MFA_KEY", mailKey: "JESSIEMESSAGE_MAIL_KEY", messageKey: "JESSIEMESSAGE_MESSAGE_KEY",
  mediaKey: "JESSIEMESSAGE_MEDIA_KEY", notificationKey: "JESSIEMESSAGE_NOTIFICATIONS_KEY" };
const CODES = new Set(["USAGE", "ENVIRONMENT", "CONFIGURATION", "CHECKPOINT", "PASSWORD", "CLIENT", "DUMP", "DUMP_MISMATCH",
  "AUTHENTICATION", "ACCESS", "DATABASE", "SCHEMA", "CRYPTO", "SNAPSHOT", "CLEANUP", "CANCELLED", "OPERATION"].map(name => `PRIVATE_CHECKPOINT_VERIFY_${name}`));
export class PrivateCheckpointVerificationError extends Error {
  constructor(code) { const selected = CODES.has(code) ? code : "PRIVATE_CHECKPOINT_VERIFY_OPERATION"; super(selected); this.name = "PrivateCheckpointVerificationError"; this.code = selected; }
}
const fail = name => { throw new PrivateCheckpointVerificationError(`PRIVATE_CHECKPOINT_VERIFY_${name}`); };
const inside = (name, root) => { const suffix = relative(root, name); return suffix === "" || suffix !== ".." && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep); };
const ordered = value => Array.isArray(value) ? value.map(ordered) : value !== null && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(name => [name, ordered(value[name])])) : value;
const same = (first, second) => JSON.stringify(ordered(first)) === JSON.stringify(ordered(second));
const readReceipt = async (scope, options) => (await import("../server/backup/checkpoint-receipt.mjs")).readCheckpointReceipt(scope, options);
const verifyMedia = async (scope, media, options) => (await import("../server/backup/checkpoint-files.mjs")).verifyCheckpointMedia(scope, media, options);

export function parseArguments(args) {
  if (!Array.isArray(args) || ![13, 15].includes(args.length) || !["check", "verify", "check-application", "verify-application"].includes(args[0])) fail("USAGE");
  const selected = { command: args[0] }, names = new Map([["--private-directory", "privateDirectory"], ["--private-path-mode", "privatePathMode"],
    ["--checkpoint-directory", "checkpointDirectory"], ["--database", "database"], ["--confirm-database", "confirmation"], ["--user", "user"], ["--profile", "profile"]]);
  for (let index = 1; index < args.length; index += 2) {
    const name = names.get(args[index]), value = args[index + 1];
    if (!name || Object.hasOwn(selected, name) || typeof value !== "string" || !value || value.startsWith("--")) fail("USAGE");
    selected[name] = value;
  }
  if (selected.privatePathMode !== "linux-dirfd" || !/^[A-Za-z0-9_]{1,64}$/.test(selected.database)
    || selected.database !== selected.confirmation || !/^[A-Za-z0-9_]{1,80}$/.test(selected.user)
    || Object.hasOwn(selected, "profile") && !CHECKPOINT_RUNTIME_PROFILES.includes(selected.profile)) fail("USAGE");
  for (const directory of [selected.privateDirectory, selected.checkpointDirectory]) {
    if (typeof directory !== "string" || !directory.startsWith("/") || directory === "/" || directory.length > 4096
      || directory !== resolve(directory) || /[\\\x00-\x1f\x7f]/.test(directory) || inside(directory, REPOSITORY) || inside(REPOSITORY, directory)) fail("USAGE");
  }
  if (selected.privateDirectory === selected.checkpointDirectory) fail("USAGE");
  return Object.fromEntries([...FIELDS, ...(Object.hasOwn(selected, "profile") ? ["profile"] : [])].map(name => [name, selected[name]]));
}

function optionsFromRecord(value) {
  const fields = [...FIELDS, ...(value && Object.hasOwn(value, "profile") ? ["profile"] : [])];
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length
    || !same(Object.getOwnPropertyNames(value).sort(), fields.sort())
    || fields.some(name => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, "value"))) fail("USAGE");
  return parseArguments([value.command, "--private-directory", value.privateDirectory, "--private-path-mode", value.privatePathMode,
    "--checkpoint-directory", value.checkpointDirectory, "--database", value.database, "--confirm-database", value.confirmation, "--user", value.user,
    ...(Object.hasOwn(value, "profile") ? ["--profile", value.profile] : [])]);
}
function frozenMatches(receipt, backup) {
  if (backup?.backupBytes !== receipt.sql.bytes || backup.backupSha256 !== receipt.sql.sha256
    || backup.sqlBytes !== receipt.sql.uncompressedBytes || backup.sqlSha256 !== receipt.sql.uncompressedSha256) fail("CHECKPOINT");
}

function assertApplicationSnapshotReport(report) {
  if (report?.command !== "verify" || report.verified !== true || report.prepared !== false
    || report.restored !== false || report.releasedCandidates !== 0) fail("SNAPSHOT");
}

/** Compare the isolated clone to the signed application snapshot, including
 * schema and row digests. The source runtime configuration is never mutated. */
export async function verifyApplicationCloneSnapshot(source, selection, password, { signal, backup = backupMain } = {}) {
  let cloneEnv;
  try {
    const selected = optionsFromRecord(selection);
    if (selected.command !== "verify-application" || typeof password !== "string" || !password
      || !password.isWellFormed() || /[\x00-\x1f\x7f]/.test(password) || Buffer.byteLength(password, "utf8") > 4096) fail("SNAPSHOT");
    const profile = checkpointBackupProfile(selected.profile, true), { recovery, crm, broadcast } = profile;
    cloneEnv = broadcast ? copyRuntimeBroadcastEnvironment(source, { originProfile: "primary", recovery: true })
      : crm ? copyRuntimeCrmEnvironment(source, { originProfile: "primary", recovery: true })
      : recovery ? copyRuntimeNotificationsEnvironment(source, { originProfile: "primary", recovery: true }) : copyRuntimeNotificationsEnvironment(source);
    if (selected.database.toLowerCase() === cloneEnv.JESSIEMESSAGE_DB_NAME.toLowerCase()
      || selected.user === cloneEnv.JESSIEMESSAGE_RUNTIME_DB_USER) fail("SNAPSHOT");
    cloneEnv.JESSIEMESSAGE_DB_NAME = selected.database;
    cloneEnv.JESSIEMESSAGE_APPLICATION_DATABASE = selected.confirmation;
    cloneEnv.JESSIEMESSAGE_RUNTIME_DB_USER = selected.user;
    cloneEnv.JESSIEMESSAGE_RUNTIME_DB_PASSWORD = password;
    cloneEnv.JESSIEMESSAGE_MEDIA_ROOT = join(selected.checkpointDirectory, "media");
    cloneEnv.JESSIEMESSAGE_DB_TLS_CA_PATH = CA;
    // This is an operator-only clone identity, not the six-right runtime user.
    // Remove its runtime grant profile only from this ephemeral copy.
    delete cloneEnv.JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE;
    delete cloneEnv.JESSIEMESSAGE_DB_USER;
    delete cloneEnv.JESSIEMESSAGE_DB_PASSWORD;
    const report = await backup(["verify", "--offline", "--manifest", join(selected.checkpointDirectory, "manifest.json"),
      "--profile", profile.name], cloneEnv, { signal, outputStream: { write() {} } });
    assertApplicationSnapshotReport(report);
    return report;
  } catch (error) {
    if (error instanceof PrivateCheckpointVerificationError) throw error;
    fail("SNAPSHOT");
  } finally { clearRuntimeMessagingSecrets(cloneEnv); }
}

/** Verify an imported checkpoint with one read-only connection. No restoration,
 * capacity rebinding, worker, transport or application server is started. */
export async function run(value, { inheritedEnv = process.env, execArgv = process.execArgv, inputStream = process.stdin,
  scopeOperation = withPrivateDirectory, loadEnvironment, makeStorage = createMediaStorage,
  readCheckpoint = readReceipt, verifyCheckpointMedia = verifyMedia, readBackup = readFrozenBackup,
  readBackupManifest = readManifest, verifyManifest = verifyBackupManifest, identity = backupIdentity, assertIdentity = assertCloneIdentity,
  inspectClient = inspectDumpClient, readSecret = readPassword, dump = dumpCloneSql, connect = connectDatabase,
  inspect = inspectClone, inspectPrivileges = assertBackupInspection, inspectApplicationPrivileges = assertApplicationTableInspection,
  verify = verifyPhotoNotificationBackupData, verifyRecovery = verifyPhotoNotificationRecoveryBackupData,
  verifyCrm = verifyPhotoNotificationRecoveryCrmBackupData, verifyBroadcast = verifyPhotoNotificationRecoveryCrmBroadcastBackupData,
  verifyApplicationSnapshot = verifyApplicationCloneSnapshot, signal } = {}) {
  let sourceEnv, env, keys, password = "", connectionEnv, connection, transaction = false, result, failure;
  const active = () => { if (signal?.aborted) fail("CANCELLED"); };
  try {
    active(); const selected = optionsFromRecord(value);
    const application = selected.command.endsWith("-application");
    const selectedProfile = checkpointBackupProfile(selected.profile, application);
    const { recovery, crm, broadcast, manifestProfile: profile, manifestVersion } = selectedProfile;
    loadEnvironment ??= broadcast ? loadRuntimeBroadcastEnvironment : crm ? loadRuntimeCrmEnvironment : loadRuntimeNotificationsEnvironment;
    let dumpTables;
    if (application) {
      const migrations = await loadMigrations();
      dumpTables = [...createdMigrationTables(migrations), "schema_migrations"].sort();
      if (migrations.length !== 30 || dumpTables.length !== 30 || new Set(dumpTables).size !== 30) fail("SCHEMA");
    }
    let processOptions;
    try { processOptions = privateAuthenticationProcessOptions(inheritedEnv, execArgv); } catch { fail("ENVIRONMENT"); }
    sourceEnv = await loadEnvironment(selected.privateDirectory, { port: processOptions.port, ...(recovery ? { originProfile: "primary", recovery: true } : {}) });
    env = broadcast ? copyRuntimeBroadcastEnvironment(sourceEnv, { originProfile: "primary", recovery: true })
      : crm ? copyRuntimeCrmEnvironment(sourceEnv, { originProfile: "primary", recovery: true })
      : recovery ? copyRuntimeNotificationsEnvironment(sourceEnv, { originProfile: "primary", recovery: true }) : copyRuntimeNotificationsEnvironment(sourceEnv);
    if (selected.database.toLowerCase() === env.JESSIEMESSAGE_DB_NAME.toLowerCase() || selected.user === env.JESSIEMESSAGE_RUNTIME_DB_USER) fail("CONFIGURATION");
    keys = Object.fromEntries([...Object.entries(KEY_FIELDS), ...(crm ? [["crmKey", "JESSIEMESSAGE_CRM_KEY"]] : [])]
      .map(([name, field]) => [name, Buffer.from(env[field], "base64url")]));
    const mediaDirectory = join(selected.checkpointDirectory, "media");
    await scopeOperation(selected.privateDirectory, async sourceScope => scopeOperation(selected.checkpointDirectory, async checkpointScope =>
      scopeOperation(mediaDirectory, async mediaScope => {
        for (const directory of [selected.privateDirectory, selected.checkpointDirectory, mediaDirectory])
          if (await realpath(directory) !== directory || inside(directory, await realpath(REPOSITORY))) fail("CONFIGURATION");
        const sourcePhysical = await sourceScope.assertReady(), checkpointPhysical = await checkpointScope.assertReady();
        if (sourcePhysical.dev === checkpointPhysical.dev && sourcePhysical.ino === checkpointPhysical.ino) fail("CONFIGURATION");
        const sourceStorage = await makeStorage({ root: env.JESSIEMESSAGE_MEDIA_ROOT, key: keys.mediaKey, pathMode: selected.privatePathMode });
        const storage = await makeStorage({ root: mediaDirectory, key: keys.mediaKey, pathMode: selected.privatePathMode });
        const sourceIdentity = await identity({ databaseName: env.JESSIEMESSAGE_DB_NAME, rootPath: env.JESSIEMESSAGE_MEDIA_ROOT, storage: sourceStorage, mediaKey: keys.mediaKey });
        const targetIdentity = await identity({ databaseName: selected.database, rootPath: mediaDirectory, storage, mediaKey: keys.mediaKey });
        await assertIdentity(sourceIdentity, targetIdentity);
        const checkpoint = await readCheckpoint(checkpointScope, { signal });
        if (!matchesCheckpointReceipt(selectedProfile, checkpoint)) fail("CHECKPOINT");
        const receiptVersion = checkpoint.version, operational = Object.hasOwn(checkpoint, "operations");
        if (!operational) {
          try { await lstat(checkpointScope.file(OPERATIONAL_CHECKPOINT)); fail("CHECKPOINT"); }
          catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        if (application) {
          try { validateApplicationCoverage(checkpoint.coverage); } catch { fail("CHECKPOINT"); }
        }
        const backupSelection = { backup: "database.sql.gz", backupSha256: checkpoint.sql.sha256 };
        const backup = await readBackup(checkpointScope, backupSelection); frozenMatches(checkpoint, backup);
        async function checkManifest() {
          const manifest = await readBackupManifest(join(selected.checkpointDirectory, "manifest.json"), { pathMode: selected.privatePathMode });
          if (manifest?.version !== manifestVersion || manifest.profile !== profile) fail("CHECKPOINT");
          const payload = await verifyManifest({ manifest, keys });
          if (!same(payload?.identity, sourceIdentity) || payload?.snapshot?.counts?.tables !== 30
            || payload?.snapshot?.capacity?.rootFingerprint !== sourceIdentity.rootFingerprint) fail("CHECKPOINT");
          if (application) {
            try { validateApplicationCoverage(payload.snapshot.coverage); } catch { fail("CHECKPOINT"); }
            if (payload.snapshot.version !== 2 || !same(payload.snapshot.coverage, checkpoint.coverage)) fail("CHECKPOINT");
          } else if (payload.snapshot.version === 2 || Object.hasOwn(payload.snapshot, "coverage")) fail("CHECKPOINT");
          return payload;
        }
        const payload = await checkManifest();
        async function checkOperations() {
          if (!operational) return null;
          const recovered = await readOperationalCheckpoint(checkpointScope, checkpoint, keys.crmKey, { signal });
          if (recovered.binding.database !== env.JESSIEMESSAGE_DB_NAME || recovered.binding.rootFingerprint !== sourceIdentity.rootFingerprint) fail("CHECKPOINT");
          return recovered;
        }
        const operations = await checkOperations();
        await verifyCheckpointMedia(mediaScope, checkpoint.media, { signal }); active();
        try { await inspectClient(); } catch { fail("CLIENT"); }
        async function unchanged() {
          active();
          const final = await readCheckpoint(checkpointScope, { signal });
          if (!same(final, checkpoint)) fail("CHECKPOINT");
          frozenMatches(checkpoint, await readBackup(checkpointScope, backupSelection));
          if (!same(await checkManifest(), payload)) fail("CHECKPOINT");
          if (!same(await checkOperations(), operations)) fail("CHECKPOINT");
          await verifyCheckpointMedia(mediaScope, checkpoint.media, { signal });
          const currentSource = await identity({ databaseName: env.JESSIEMESSAGE_DB_NAME, rootPath: env.JESSIEMESSAGE_MEDIA_ROOT, storage: sourceStorage, mediaKey: keys.mediaKey });
          const currentTarget = await identity({ databaseName: selected.database, rootPath: mediaDirectory, storage, mediaKey: keys.mediaKey });
          if (!same(currentSource, sourceIdentity) || !same(currentTarget, targetIdentity)) fail("CHECKPOINT");
          await assertIdentity(currentSource, currentTarget);
          await sourceScope.assertReady(); await checkpointScope.assertReady(); await mediaScope.assertReady(); active();
        }
        const common = { ...(application ? { version: receiptVersion, profile, coverage: { ...APPLICATION_COVERAGE }, completeDatabase: false }
          : recovery ? { version: receiptVersion, profile } : {}),
          tables: 30, migrations: 30, backupBytes: backup.backupBytes, sqlBytes: backup.sqlBytes,
          backupSha256: backup.backupSha256, sqlSha256: backup.sqlSha256, checkpointFilesMatched: true, independentMediaDirectory: true,
          httpStarted: false, smtpStarted: false, workersStarted: false, capacityRebound: false };
        if (operational) Object.assign(common, { operationsCovered: true, operationalFiles: operations.files.length,
          operations: { ...checkpoint.operations }, externalRegistryContinuityVerified: false, operationalRestorationPending: true });
        if (["check", "check-application"].includes(selected.command)) { await unchanged(); result = { status: "ready_for_input", ...common, databaseConnected: false }; return; }
        try {
          password = await readSecret(inputStream);
          if (typeof password !== "string" || !password || !password.isWellFormed() || /[\x00-\x1f\x7f]/.test(password) || Buffer.byteLength(password, "utf8") > 4096) fail("PASSWORD");
        } catch { fail("PASSWORD"); }
        active();
        const dumped = await dump(checkpointScope, { database: selected.database, user: selected.user },
          { host: env.JESSIEMESSAGE_DB_HOST, port: env.JESSIEMESSAGE_DB_PORT }, password, { signal, ...(application ? { tables: [...dumpTables] } : {}) });
        if (dumped?.sqlBytes !== backup.sqlBytes || dumped.sqlSha256 !== backup.sqlSha256) fail("DUMP_MISMATCH");
        active();
        connectionEnv = { JESSIEMESSAGE_DB_HOST: env.JESSIEMESSAGE_DB_HOST, JESSIEMESSAGE_DB_PORT: env.JESSIEMESSAGE_DB_PORT,
          JESSIEMESSAGE_DB_NAME: selected.database, JESSIEMESSAGE_MIGRATION_DATABASE: selected.confirmation,
          JESSIEMESSAGE_DB_USER: selected.user, JESSIEMESSAGE_DB_PASSWORD: password, JESSIEMESSAGE_DB_TLS_CA_PATH: CA };
        connection = await connect(connectionEnv); active();
        await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"); transaction = true;
        await connection.query("START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT"); active();
        await (application ? inspectApplicationPrivileges : inspectPrivileges)(connection, selected.database);
        const schema = await inspect(connection, selected.database);
        if (schema?.tables !== 30 || schema.migrations !== 30) fail("SCHEMA");
        const pool = { getConnection: async () => ({ query(sql, parameters) {
          if (typeof sql !== "string" || !/^SELECT\s/.test(sql) || /\b(?:INTO|OUTFILE|DUMPFILE|FOR\s+UPDATE|LOCK\s+IN\s+SHARE)\b/i.test(sql)) fail("DATABASE");
          return connection.query(sql, parameters);
        }, release: async () => {} }) };
        const report = await (broadcast ? verifyBroadcast : crm ? verifyCrm : recovery ? verifyRecovery : verify)({ pool, storage, keys, signal }); active();
        if (report?.complete !== true || report.healthy !== true || !Array.isArray(report.issues) || report.issues.length
          || !same(Object.keys(report.counts ?? {}).sort(), [...COUNT_NAMES].sort())
          || COUNT_NAMES.some(name => !Number.isSafeInteger(report.counts[name]) || report.counts[name] < 0)) fail("CRYPTO");
        if (application) {
          const after = await dump(checkpointScope, { database: selected.database, user: selected.user },
            { host: env.JESSIEMESSAGE_DB_HOST, port: env.JESSIEMESSAGE_DB_PORT }, password, { signal, tables: [...dumpTables] });
          if (after?.sqlBytes !== backup.sqlBytes || after.sqlSha256 !== backup.sqlSha256) fail("DUMP_MISMATCH");
          active();
        }
        await unchanged();
        if (application) {
          try { await connection.rollback(); transaction = false; } catch { fail("CLEANUP"); }
          try { await connection.end(); connection = undefined; } catch { fail("CLEANUP"); }
          active();
          const snapshotReport = await verifyApplicationSnapshot(env, selected, password, { signal });
          assertApplicationSnapshotReport(snapshotReport); active();
          await unchanged();
        }
        result = { status: "verified", ...common, databaseConnected: true, ...(application ? { applicationSnapshotMatched: true } : {}),
          counts: Object.fromEntries(COUNT_NAMES.map(name => [name, report.counts[name]])) };
      })));
  } catch (error) {
    if (error instanceof PrivateCheckpointVerificationError) failure = error;
    else if (/^TEXT_CLONE_(?:AUTHENTICATION|ACCESS|DATABASE|DUMP|DUMP_MISMATCH)$/.test(error?.code ?? ""))
      failure = new PrivateCheckpointVerificationError(error.code.replace("TEXT_CLONE_", "PRIVATE_CHECKPOINT_VERIFY_"));
    else failure = new PrivateCheckpointVerificationError("PRIVATE_CHECKPOINT_VERIFY_OPERATION");
  } finally {
    try { if (transaction) await connection?.rollback(); } catch { failure = new PrivateCheckpointVerificationError("PRIVATE_CHECKPOINT_VERIFY_CLEANUP"); }
    try { await connection?.end(); } catch { failure = new PrivateCheckpointVerificationError("PRIVATE_CHECKPOINT_VERIFY_CLEANUP"); }
    password = ""; if (connectionEnv) connectionEnv.JESSIEMESSAGE_DB_PASSWORD = "";
    for (const key of Object.values(keys ?? {})) key.fill(0);
    clearRuntimeMessagingSecrets(sourceEnv); clearRuntimeMessagingSecrets(env);
  }
  if (failure) throw failure;
  active(); return result;
}

export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  const result = await run(parseArguments(args), dependencies); outputStream.write(`${JSON.stringify(result)}\n`); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController(), cancel = () => cancellation.abort();
  process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  try { await main(process.argv.slice(2), { signal: cancellation.signal }); }
  catch (error) {
    process.stderr.write(`${error instanceof PrivateCheckpointVerificationError ? error.code : "PRIVATE_CHECKPOINT_VERIFY_OPERATION"}: Private checkpoint verification was not confirmed.\n`);
    process.exitCode = 1;
  } finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
