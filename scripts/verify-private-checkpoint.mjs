import { realpath } from "node:fs/promises";
import { resolve, relative, sep, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { loadRuntimeNotificationsEnvironment, copyRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { readManifest, verifyBackupManifest, backupIdentity, assertCloneIdentity } from "../server/backup/manifest.mjs";
import { assertBackupInspection } from "../server/backup/inspection.mjs";
import { verifyPhotoNotificationBackupData } from "../server/backup/verify.mjs";
import { connectDatabase } from "../server/db/connection.mjs";
import { inspectDumpClient, readFrozenBackup, dumpCloneSql, inspectClone } from "./verify-text-clone.mjs";
import { readPassword } from "./migration-input.mjs";

const REPOSITORY = resolve(fileURLToPath(new URL("../", import.meta.url)));
const CA = "/etc/ssl/certs/ca-certificates.crt";
const FIELDS = ["command", "privateDirectory", "privatePathMode", "checkpointDirectory", "database", "confirmation", "user"];
const COUNT_NAMES = ["rows", "mfa", "mail", "reset", "messages", "crm", "broadcast", "broadcastRecipients", "media", "mediaFiles", "notifications", "notificationJobs"];
const KEY_FIELDS = { totpKey: "JESSIEMESSAGE_MFA_KEY", mailKey: "JESSIEMESSAGE_MAIL_KEY", messageKey: "JESSIEMESSAGE_MESSAGE_KEY",
  mediaKey: "JESSIEMESSAGE_MEDIA_KEY", notificationKey: "JESSIEMESSAGE_NOTIFICATIONS_KEY" };
const CODES = new Set(["USAGE", "ENVIRONMENT", "CONFIGURATION", "CHECKPOINT", "PASSWORD", "CLIENT", "DUMP", "DUMP_MISMATCH",
  "AUTHENTICATION", "ACCESS", "DATABASE", "SCHEMA", "CRYPTO", "CLEANUP", "CANCELLED", "OPERATION"].map(name => `PRIVATE_CHECKPOINT_VERIFY_${name}`));
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
  if (!Array.isArray(args) || args.length !== 13 || !["check", "verify"].includes(args[0])) fail("USAGE");
  const selected = { command: args[0] }, names = new Map([["--private-directory", "privateDirectory"], ["--private-path-mode", "privatePathMode"],
    ["--checkpoint-directory", "checkpointDirectory"], ["--database", "database"], ["--confirm-database", "confirmation"], ["--user", "user"]]);
  for (let index = 1; index < args.length; index += 2) {
    const name = names.get(args[index]), value = args[index + 1];
    if (!name || Object.hasOwn(selected, name) || typeof value !== "string" || !value || value.startsWith("--")) fail("USAGE");
    selected[name] = value;
  }
  if (selected.privatePathMode !== "linux-dirfd" || !/^[A-Za-z0-9_]{1,64}$/.test(selected.database)
    || selected.database !== selected.confirmation || !/^[A-Za-z0-9_]{1,80}$/.test(selected.user)) fail("USAGE");
  for (const directory of [selected.privateDirectory, selected.checkpointDirectory]) {
    if (typeof directory !== "string" || !directory.startsWith("/") || directory === "/" || directory.length > 4096
      || directory !== resolve(directory) || /[\\\x00-\x1f\x7f]/.test(directory) || inside(directory, REPOSITORY) || inside(REPOSITORY, directory)) fail("USAGE");
  }
  if (selected.privateDirectory === selected.checkpointDirectory) fail("USAGE");
  return Object.fromEntries(FIELDS.map(name => [name, selected[name]]));
}

function optionsFromRecord(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length
    || !same(Object.getOwnPropertyNames(value).sort(), [...FIELDS].sort())
    || FIELDS.some(name => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, "value"))) fail("USAGE");
  return parseArguments([value.command, "--private-directory", value.privateDirectory, "--private-path-mode", value.privatePathMode,
    "--checkpoint-directory", value.checkpointDirectory, "--database", value.database, "--confirm-database", value.confirmation, "--user", value.user]);
}
function frozenMatches(receipt, backup) {
  if (backup?.backupBytes !== receipt.sql.bytes || backup.backupSha256 !== receipt.sql.sha256
    || backup.sqlBytes !== receipt.sql.uncompressedBytes || backup.sqlSha256 !== receipt.sql.uncompressedSha256) fail("CHECKPOINT");
}

/** Verify an imported checkpoint with one read-only connection. No restoration,
 * capacity rebinding, worker, transport or application server is started. */
export async function run(value, { inheritedEnv = process.env, execArgv = process.execArgv, inputStream = process.stdin,
  scopeOperation = withPrivateDirectory, loadEnvironment = loadRuntimeNotificationsEnvironment, makeStorage = createMediaStorage,
  readCheckpoint = readReceipt, verifyCheckpointMedia = verifyMedia, readBackup = readFrozenBackup,
  readBackupManifest = readManifest, verifyManifest = verifyBackupManifest, identity = backupIdentity, assertIdentity = assertCloneIdentity,
  inspectClient = inspectDumpClient, readSecret = readPassword, dump = dumpCloneSql, connect = connectDatabase,
  inspect = inspectClone, inspectPrivileges = assertBackupInspection, verify = verifyPhotoNotificationBackupData, signal } = {}) {
  let sourceEnv, env, keys, password = "", connectionEnv, connection, transaction = false, result, failure;
  const active = () => { if (signal?.aborted) fail("CANCELLED"); };
  try {
    active(); const selected = optionsFromRecord(value);
    let processOptions;
    try { processOptions = privateAuthenticationProcessOptions(inheritedEnv, execArgv); } catch { fail("ENVIRONMENT"); }
    sourceEnv = await loadEnvironment(selected.privateDirectory, { port: processOptions.port });
    env = copyRuntimeNotificationsEnvironment(sourceEnv);
    if (selected.database.toLowerCase() === env.JESSIEMESSAGE_DB_NAME.toLowerCase() || selected.user === env.JESSIEMESSAGE_RUNTIME_DB_USER) fail("CONFIGURATION");
    keys = Object.fromEntries(Object.entries(KEY_FIELDS).map(([name, field]) => [name, Buffer.from(env[field], "base64url")]));
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
        const backupSelection = { backup: "database.sql.gz", backupSha256: checkpoint.sql.sha256 };
        const backup = await readBackup(checkpointScope, backupSelection); frozenMatches(checkpoint, backup);
        async function checkManifest() {
          const manifest = await readBackupManifest(join(selected.checkpointDirectory, "manifest.json"), { pathMode: selected.privatePathMode });
          if (manifest?.version !== 3 || manifest.profile !== "messaging-photos-notify") fail("CHECKPOINT");
          const payload = await verifyManifest({ manifest, keys });
          if (!same(payload?.identity, sourceIdentity) || payload?.snapshot?.counts?.tables !== 30
            || payload?.snapshot?.capacity?.rootFingerprint !== sourceIdentity.rootFingerprint) fail("CHECKPOINT");
          return payload;
        }
        const payload = await checkManifest();
        await verifyCheckpointMedia(mediaScope, checkpoint.media, { signal }); active();
        try { await inspectClient(); } catch { fail("CLIENT"); }
        async function unchanged() {
          active();
          const final = await readCheckpoint(checkpointScope, { signal });
          if (!same(final, checkpoint)) fail("CHECKPOINT");
          frozenMatches(checkpoint, await readBackup(checkpointScope, backupSelection));
          if (!same(await checkManifest(), payload)) fail("CHECKPOINT");
          await verifyCheckpointMedia(mediaScope, checkpoint.media, { signal });
          const currentSource = await identity({ databaseName: env.JESSIEMESSAGE_DB_NAME, rootPath: env.JESSIEMESSAGE_MEDIA_ROOT, storage: sourceStorage, mediaKey: keys.mediaKey });
          const currentTarget = await identity({ databaseName: selected.database, rootPath: mediaDirectory, storage, mediaKey: keys.mediaKey });
          if (!same(currentSource, sourceIdentity) || !same(currentTarget, targetIdentity)) fail("CHECKPOINT");
          await assertIdentity(currentSource, currentTarget);
          await sourceScope.assertReady(); await checkpointScope.assertReady(); await mediaScope.assertReady(); active();
        }
        const common = { tables: 30, migrations: 30, backupBytes: backup.backupBytes, sqlBytes: backup.sqlBytes,
          backupSha256: backup.backupSha256, sqlSha256: backup.sqlSha256, checkpointFilesMatched: true, independentMediaDirectory: true,
          httpStarted: false, smtpStarted: false, workersStarted: false, capacityRebound: false };
        if (selected.command === "check") { await unchanged(); result = { status: "ready_for_input", ...common, databaseConnected: false }; return; }
        try {
          password = await readSecret(inputStream);
          if (typeof password !== "string" || !password || !password.isWellFormed() || /[\x00-\x1f\x7f]/.test(password) || Buffer.byteLength(password, "utf8") > 4096) fail("PASSWORD");
        } catch { fail("PASSWORD"); }
        active();
        const dumped = await dump(checkpointScope, { database: selected.database, user: selected.user },
          { host: env.JESSIEMESSAGE_DB_HOST, port: env.JESSIEMESSAGE_DB_PORT }, password, { signal });
        if (dumped?.sqlBytes !== backup.sqlBytes || dumped.sqlSha256 !== backup.sqlSha256) fail("DUMP_MISMATCH");
        active();
        connectionEnv = { JESSIEMESSAGE_DB_HOST: env.JESSIEMESSAGE_DB_HOST, JESSIEMESSAGE_DB_PORT: env.JESSIEMESSAGE_DB_PORT,
          JESSIEMESSAGE_DB_NAME: selected.database, JESSIEMESSAGE_MIGRATION_DATABASE: selected.confirmation,
          JESSIEMESSAGE_DB_USER: selected.user, JESSIEMESSAGE_DB_PASSWORD: password, JESSIEMESSAGE_DB_TLS_CA_PATH: CA };
        connection = await connect(connectionEnv); active();
        await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"); transaction = true;
        await connection.query("START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT"); active();
        await inspectPrivileges(connection, selected.database);
        const schema = await inspect(connection, selected.database);
        if (schema?.tables !== 30 || schema.migrations !== 30) fail("SCHEMA");
        const pool = { getConnection: async () => ({ query(sql, parameters) {
          if (typeof sql !== "string" || !/^SELECT\s/.test(sql) || /\b(?:INTO|OUTFILE|DUMPFILE|FOR\s+UPDATE|LOCK\s+IN\s+SHARE)\b/i.test(sql)) fail("DATABASE");
          return connection.query(sql, parameters);
        }, release: async () => {} }) };
        const report = await verify({ pool, storage, keys, signal }); active();
        if (report?.complete !== true || report.healthy !== true || !Array.isArray(report.issues) || report.issues.length
          || !same(Object.keys(report.counts ?? {}).sort(), [...COUNT_NAMES].sort())
          || COUNT_NAMES.some(name => !Number.isSafeInteger(report.counts[name]) || report.counts[name] < 0)) fail("CRYPTO");
        await unchanged();
        result = { status: "verified", ...common, databaseConnected: true,
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
