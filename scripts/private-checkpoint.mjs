import { constants, writeSync } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { dirname, basename, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createGzip } from "node:zlib";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { loadRuntimeNotificationsEnvironment, copyRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";
import { loadRuntimeCrmEnvironment, copyRuntimeCrmEnvironment } from "../server/config/runtime-crm.mjs";
import { loadRuntimeBroadcastEnvironment, copyRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { loadRuntimeVideoEnvironment, copyRuntimeVideoEnvironment } from "../server/config/runtime-video.mjs";
import { loadVideoMigrations } from "../server/video/migrations.mjs";
import { copyCheckpointVideo, verifyCheckpointVideo } from "../server/backup/video-checkpoint-files.mjs";
import { CHECKPOINT_RUNTIME_PROFILES, checkpointBackupProfile, checkpointReceiptVersion } from "../server/backup/profiles.mjs";
import { captureOperationalState, operationalStateHash, writeOperationalCheckpoint, readOperationalCheckpoint, assertNoOperationalRestore, OPERATIONAL_CHECKPOINT } from "../server/backup/operational-checkpoint.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { readManifest, verifyBackupManifest } from "../server/backup/manifest.mjs";
import { assertBackupSnapshot } from "../server/backup/snapshot.mjs";
import { assertBackupInspection, createBackupInspectionPool } from "../server/backup/inspection.mjs";
import { diagnoseBackupInspection } from "../server/backup/inspection-diagnostics.mjs";
import { APPLICATION_COVERAGE, VIDEO_APPLICATION_COVERAGE, validateApplicationCoverage, validateVideoApplicationCoverage, createApplicationInspectionPool, assertApplicationTableInspection, assertVideoApplicationTableInspection } from "../server/backup/application-scope.mjs";
import { createdMigrationTables, inspectHistory, loadMigrations } from "../server/db/migrations.mjs";
import { copyCheckpointMedia, verifyCheckpointMedia } from "../server/backup/checkpoint-files.mjs";
import { hashCheckpointFile, writeCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";
import { verifyCheckpointArchive } from "../server/backup/checkpoint-archive.mjs";
import { main as backupMain } from "./backup.mjs";
import { dumpCloneSql, inspectDumpClient } from "./verify-text-clone.mjs";
import { readPassword } from "./migration-input.mjs";

const REPOSITORY = resolve(fileURLToPath(new URL("../", import.meta.url)));
const PROCESS_ENV = Object.freeze({ PATH: "/usr/bin:/bin", HOME: "/", LANG: "C", LC_ALL: "C" });
const MAX_ARCHIVE = 2 * 1024 * 1024 * 1024;
const FIELDS = ["command", "offline", "privateDirectory", "privatePathMode", "destination", "inspectionUser"];
const CODES = new Set(["USAGE", "ENVIRONMENT", "CONFIGURATION", "DESTINATION", "TOOLS", "PASSWORD", "INSPECTION", "CONNECTION", "DATABASE", "AUTHENTICATION", "ACCESS", "BACKUP", "DUMP", "DRIFT", "ARCHIVE", "CANCELLED", "OPERATION"].map(name => `PRIVATE_CHECKPOINT_${name}`));
export class PrivateCheckpointError extends Error {
  constructor(code) { const selected = CODES.has(code) ? code : "PRIVATE_CHECKPOINT_OPERATION"; super(selected); this.name = "PrivateCheckpointError"; this.code = selected; }
}
const fail = code => { throw new PrivateCheckpointError(code); };
const active = signal => { if (signal?.aborted) fail("PRIVATE_CHECKPOINT_CANCELLED"); };
const inside = (value, root) => { const suffix = relative(root, value); return suffix === "" || suffix !== ".." && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep); };
const path = value => typeof value === "string" && value.startsWith("/") && value !== "/" && value.length <= 4096 && resolve(value) === value && !/[\\\x00-\x1f\x7f]/.test(value);
const same = (a, b) => ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"].every(name => a[name] === b[name]);
function regular(value) { if (!value.isFile() || value.uid !== BigInt(process.getuid()) || (value.mode & 0o7777n) !== 0o600n || value.nlink !== 1n) fail("PRIVATE_CHECKPOINT_DESTINATION"); }

export function parseArguments(args) {
  if (!Array.isArray(args) || !["check", "diagnose", "inspect", "capture", "check-application", "inspect-application", "capture-application"].includes(args[0])) fail("PRIVATE_CHECKPOINT_USAGE");
  const application = args[0].endsWith("-application");
  const offline = args[1] === "--offline", offset = offline ? 2 : 1;
  const expectedLength = offset + (application ? 6 : 8);
  if (["capture", "capture-application"].includes(args[0]) !== offline || ![expectedLength, expectedLength + 2, expectedLength + 4].includes(args.length)) fail("PRIVATE_CHECKPOINT_USAGE");
  const names = new Map([["--private-directory", "privateDirectory"], ["--private-path-mode", "privatePathMode"], ["--destination-private-directory", "destination"], ["--inspection-user", "inspectionUser"], ["--profile", "profile"], ["--operations-directory", "operationsDirectory"]]);
  const value = { command: args[0], offline, ...(application ? { inspectionUser: null } : {}) };
  for (let index = offset; index < args.length; index += 2) {
    const name = names.get(args[index]), content = args[index + 1];
    if (!name || Object.hasOwn(value, name) || typeof content !== "string" || !content || content.startsWith("--")) fail("PRIVATE_CHECKPOINT_USAGE");
    value[name] = content;
  }
  if (!path(value.privateDirectory) || !path(value.destination) || inside(value.privateDirectory, REPOSITORY) || inside(value.destination, REPOSITORY)
    || value.privatePathMode !== "linux-dirfd" || !application && !/^[A-Za-z0-9_]{1,80}$/.test(value.inspectionUser)
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(basename(value.destination))
    || Object.hasOwn(value, "profile") && (!CHECKPOINT_RUNTIME_PROFILES.includes(value.profile) || !checkpointBackupProfile(value.profile, application))
    || Object.hasOwn(value, "operationsDirectory") && (!path(value.operationsDirectory) || inside(value.operationsDirectory, REPOSITORY)
      || !["photos-notify-recovery-crm-broadcast", "photos-notify-recovery-crm-broadcast-video"].includes(value.profile) || inside(value.operationsDirectory, value.destination))) fail("PRIVATE_CHECKPOINT_USAGE");
  return Object.fromEntries([...FIELDS, ...["profile", "operationsDirectory"].filter(name => Object.hasOwn(value, name))].map(name => [name, value[name]]));
}
function options(value) {
  const fields = [...FIELDS, ...["profile", "operationsDirectory"].filter(name => value && Object.hasOwn(value, name))];
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length
    || Object.getOwnPropertyNames(value).sort().join(",") !== fields.sort().join(",")
    || fields.some(name => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, "value"))
    || typeof value.offline !== "boolean") fail("PRIVATE_CHECKPOINT_USAGE");
  return parseArguments([value.command, ...(value.offline ? ["--offline"] : []), "--private-directory", value.privateDirectory,
    "--private-path-mode", value.privatePathMode, "--destination-private-directory", value.destination,
    ...(value.inspectionUser === null ? [] : ["--inspection-user", value.inspectionUser]),
    ...(Object.hasOwn(value, "profile") ? ["--profile", value.profile] : []),
    ...(Object.hasOwn(value, "operationsDirectory") ? ["--operations-directory", value.operationsDirectory] : [])]);
}
export async function inspectCheckpointTools() {
  await inspectDumpClient();
  const result = await promisify(execFile)("/usr/bin/tar", ["--version"], { env: PROCESS_ENV, encoding: "utf8", timeout: 5000, maxBuffer: 8192 });
  if (!/^tar \(GNU tar\) 1\./.test(result.stdout)) fail("PRIVATE_CHECKPOINT_TOOLS");
}
async function absent(scope, name) {
  await scope.assertReady();
  try { await lstat(scope.file(name)); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  fail("PRIVATE_CHECKPOINT_DESTINATION");
}
async function childDirectory(scope, name) {
  await scope.assertReady(); await mkdir(scope.file(name), { mode: 0o700 });
  const handle = await open(scope.file(name), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isDirectory() || stats.uid !== BigInt(process.getuid()) || (stats.mode & 0o7777n) !== 0o700n) fail("PRIVATE_CHECKPOINT_DESTINATION");
    await scope.sync(); return stats;
  } finally { await handle.close(); }
}
function directoryIdentity(actual, expected) {
  if (["dev", "ino", "uid", "gid", "mode"].some(name => actual[name] !== expected[name])) fail("PRIVATE_CHECKPOINT_DESTINATION");
}
export async function inspectCheckpointIdentity(env, { signal } = {}) {
  let pool, connection;
  try {
    active(signal); pool = await createBackupInspectionPool(env); connection = await pool.getConnection();
    await assertBackupInspection(connection, env.JESSIEMESSAGE_DB_NAME);
    const migrations = await loadMigrations(), expected = [...createdMigrationTables(migrations), "schema_migrations"].sort();
    const tables = await connection.query("SELECT TABLE_NAME AS name, TABLE_TYPE AS kind, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME LIMIT 33", [env.JESSIEMESSAGE_DB_NAME]);
    if (migrations.length !== 33 || tables.length !== 33 || JSON.stringify(tables.map(row => row.name).sort()) !== JSON.stringify(expected)
      || tables.some(row => row.kind !== "BASE TABLE" || row.engine !== "InnoDB")) fail("PRIVATE_CHECKPOINT_CONFIGURATION");
    const ledger = await connection.query("SELECT version, name, checksum, state, attempts FROM schema_migrations ORDER BY version LIMIT 33");
    if (ledger.length !== 33 || inspectHistory(migrations, ledger).some(row => row.state !== "applied")) fail("PRIVATE_CHECKPOINT_CONFIGURATION");
    active(signal);
  } finally { try { await connection?.release(); } finally { await pool?.end(); } }
}
export async function inspectApplicationCheckpointIdentity(env, { signal, video = false } = {}) {
  let pool, connection;
  try {
    active(signal); pool = await createApplicationInspectionPool(env); connection = await pool.getConnection();
    if (typeof video !== "boolean") fail("PRIVATE_CHECKPOINT_CONFIGURATION");
    await (video ? assertVideoApplicationTableInspection : assertApplicationTableInspection)(connection, env.JESSIEMESSAGE_DB_NAME);
    const migrations = await (video ? loadVideoMigrations : loadMigrations)(), count = video ? 36 : 33;
    const ledger = await connection.query(`SELECT version, name, checksum, state, attempts FROM schema_migrations ORDER BY version LIMIT ${count}`);
    if (migrations.length !== count || ledger.length !== count || inspectHistory(migrations, ledger).some(row => row.state !== "applied")) fail("PRIVATE_CHECKPOINT_CONFIGURATION");
    active(signal);
  } finally { try { await connection?.release(); } finally { await pool?.end(); } }
}
// This observation is deliberately separate from the strict capture gate.
// In particular, a provider's admin profile cannot prove invisible objects absent.
export async function diagnoseCheckpointIdentity(env, { signal } = {}) {
  let pool, connection;
  try {
    active(signal); pool = await createBackupInspectionPool(env); connection = await pool.getConnection();
    const diagnosis = await diagnoseBackupInspection(connection, env.JESSIEMESSAGE_DB_NAME);
    active(signal); return diagnosis;
  } finally { try { await connection?.release(); } finally { await pool?.end(); } }
}
function publicDiagnosis(value) {
  const choices = { scope: ["exact", "raw_underscore_pattern", "other", "missing"],
    privilegeProfile: ["schema_all", "shared_admin", "insufficient"], metadataVisibility: ["complete", "unproven"],
    objectInventory: ["absent", "present_or_unverified", "unproven"] };
  if (!value || typeof value.databaseMatched !== "boolean" || typeof value.captureAllowed !== "boolean"
    || Object.entries(choices).some(([name, allowed]) => !allowed.includes(value[name]))
    || value.captureAllowed && (!value.databaseMatched || value.scope !== "exact" || value.privilegeProfile !== "schema_all"
      || value.metadataVisibility !== "complete" || value.objectInventory !== "absent")) fail("PRIVATE_CHECKPOINT_INSPECTION");
  return { databaseMatched: value.databaseMatched, scope: value.scope, privilegeProfile: value.privilegeProfile,
    metadataVisibility: value.metadataVisibility, objectInventory: value.objectInventory, inspectionPolicySatisfied: value.captureAllowed };
}
async function exclusive(scope, name) {
  await scope.assertReady();
  const handle = await open(scope.file(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try { await handle.chmod(0o600); regular(await handle.stat({ bigint: true })); return handle; }
  catch (error) { await handle.close(); throw error; }
}
async function visible(scope, name, stats) {
  await scope.assertReady(); const current = await lstat(scope.file(name), { bigint: true }); regular(current);
  if (!same(stats, current)) fail("PRIVATE_CHECKPOINT_DRIFT");
}
export async function gzipCheckpointSql(scope, { signal } = {}) {
  let input, output, reading, gzip;
  try {
    active(signal); await scope.assertReady();
    input = await open(scope.file("database.sql"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await input.stat({ bigint: true }); regular(before);
    if (before.size < 1n || before.size > 67108864n) fail("PRIVATE_CHECKPOINT_DUMP");
    await visible(scope, "database.sql", before);
    output = await exclusive(scope, "database.sql.gz");
    reading = input.createReadStream({ autoClose: false }); gzip = createGzip({ level: 9 });
    reading.on("error", error => gzip.destroy(error)); reading.pipe(gzip);
    let compressed = 0;
    for await (const bytes of gzip) {
      try {
        active(signal); compressed += bytes.length; if (compressed > 16 * 1024 * 1024) fail("PRIVATE_CHECKPOINT_DUMP");
        let offset = 0; while (offset < bytes.length) { const result = await output.write(bytes, offset, bytes.length - offset); if (result.bytesWritten < 1) fail("PRIVATE_CHECKPOINT_DUMP"); offset += result.bytesWritten; }
      } finally { bytes.fill(0); }
    }
    await output.sync(); const after = await input.stat({ bigint: true });
    if (!same(before, after)) fail("PRIVATE_CHECKPOINT_DRIFT");
    await visible(scope, "database.sql", after); await scope.sync();
  } finally {
    reading?.destroy(); gzip?.destroy();
    await Promise.all([input?.close(), output?.close()]);
  }
}

// A single native tar process reads only the explicit, already verified members.
// The archive output is an exclusive pinned FD, never a filename opened by tar.
export async function archiveCheckpoint(scope, inventory, { signal, spawnClient = spawn, operations = false, video } = {}) {
  let output, input, directory, child;
  const run = (args, stdio, collect = false, sink = null) => new Promise((yes, no) => {
    let length = 0, diagnostics = 0, text = "", failed = false;
    const stop = () => { failed = true; try { child?.kill("SIGKILL"); } catch {} };
    let timer;
    try {
      child = spawnClient("/usr/bin/tar", args, { env: PROCESS_ENV, stdio });
      timer = setTimeout(stop, 120000); signal?.addEventListener("abort", stop, { once: true }); if (signal?.aborted) stop();
      child.stdout?.on("data", bytes => {
        try {
          length += bytes.length; if (length > (sink ? MAX_ARCHIVE : 16 * 1024 * 1024)) stop();
          else if (!failed) {
            if (collect) text += bytes.toString("ascii");
            if (sink) { let offset = 0; while (offset < bytes.length) { const count = writeSync(sink.fd, bytes, offset, bytes.length - offset); if (count < 1) throw new Error(); offset += count; } }
          }
        } catch { stop(); } finally { bytes.fill(0); }
      });
      child.stderr.on("data", bytes => { diagnostics += bytes.length; bytes.fill(0); if (diagnostics > 8192) stop(); });
      child.stdout?.on("error", stop); child.stderr.on("error", stop); child.once("error", stop);
      child.once("close", (code, killed) => { clearTimeout(timer); signal?.removeEventListener("abort", stop); child = null;
        if (failed || code !== 0 || killed) no(new PrivateCheckpointError("PRIVATE_CHECKPOINT_ARCHIVE")); else yes(text); });
    } catch { clearTimeout(timer); signal?.removeEventListener("abort", stop); stop(); no(new PrivateCheckpointError("PRIVATE_CHECKPOINT_ARCHIVE")); }
  });
  try {
    active(signal); await scope.assertReady();
    directory = await open(`${scope.path}/.`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const pinned = await scope.assertReady(), actual = await directory.stat({ bigint: true });
    if (pinned.dev !== actual.dev || pinned.ino !== actual.ino) fail("PRIVATE_CHECKPOINT_DRIFT");
    output = await exclusive(scope, "checkpoint.tar.gz");
    await run(["--create", "--gzip", "--file=-", "--directory=/proc/self/fd/3", "--", "manifest.json", "database.sql.gz", "receipt.json", "media", ...(video ? ["video"] : []), ...(operations ? [OPERATIONAL_CHECKPOINT] : [])], ["ignore", "pipe", "pipe", directory.fd], false, output);
    await output.sync(); const stats = await output.stat({ bigint: true }); regular(stats);
    if (stats.size < 1n || stats.size > BigInt(MAX_ARCHIVE)) fail("PRIVATE_CHECKPOINT_ARCHIVE");
    await visible(scope, "checkpoint.tar.gz", stats); await output.close(); output = null;
    input = await open(scope.file("checkpoint.tar.gz"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!same(stats, await input.stat({ bigint: true }))) fail("PRIVATE_CHECKPOINT_DRIFT");
    const listing = await run(["--list", "--gzip", "--file=-"], [input.fd, "pipe", "pipe"], true);
    const names = listing.trimEnd().split("\n").sort();
    const expected = ["manifest.json", "database.sql.gz", "receipt.json", "media/", ...inventory.files.map(file => `media/${file.name}`), ...(video ? ["video/", ...video.files.map(file => `video/${file.name}`)] : []), ...(operations ? [OPERATIONAL_CHECKPOINT] : [])].sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) fail("PRIVATE_CHECKPOINT_ARCHIVE");
    if (!same(stats, await input.stat({ bigint: true }))) fail("PRIVATE_CHECKPOINT_DRIFT");
    await visible(scope, "checkpoint.tar.gz", stats); await scope.sync();
    const finalRoot = await scope.assertReady(), finalDirectory = await directory.stat({ bigint: true });
    if (finalRoot.dev !== finalDirectory.dev || finalRoot.ino !== finalDirectory.ino || actual.dev !== finalDirectory.dev || actual.ino !== finalDirectory.ino) fail("PRIVATE_CHECKPOINT_DRIFT");
    return await hashCheckpointFile(scope, "checkpoint.tar.gz", { signal, maxBytes: MAX_ARCHIVE });
  } finally { try { child?.kill("SIGKILL"); } catch {} await Promise.all([output?.close(), input?.close(), directory?.close()]); }
}

export async function run(value, { inheritedEnv = process.env, execArgv = process.execArgv, inputStream = process.stdin, signal,
  scopeOperation = withPrivateDirectory, loadEnvironment, inspectTools = inspectCheckpointTools,
  inspectIdentity = inspectCheckpointIdentity, diagnoseIdentity = diagnoseCheckpointIdentity, inspectApplicationIdentity = inspectApplicationCheckpointIdentity,
  readSecret = readPassword, prepare = backupMain, dump = dumpCloneSql, copyMedia = copyCheckpointMedia, verifyMedia = verifyCheckpointMedia,
  copyVideo = copyCheckpointVideo, verifyVideo = verifyCheckpointVideo,
  getManifest = readManifest, verifyManifest = verifyBackupManifest, compareSnapshots = assertBackupSnapshot,
  compress = gzipCheckpointSql, archive = archiveCheckpoint, verifyArchive = verifyCheckpointArchive, clock = Date.now } = {}) {
  let env, loaded, password = "", keys;
  try {
    const selected = options(value); active(signal);
    const application = selected.command.endsWith("-application"), selectedProfile = checkpointBackupProfile(selected.profile, application);
    const { recovery, crm, broadcast, video, name: backupProfile, manifestProfile: profile, manifestVersion } = selectedProfile;
    const tableCount = video ? 36 : 33, applicationCoverage = video ? VIDEO_APPLICATION_COVERAGE : APPLICATION_COVERAGE;
    const operational = Object.hasOwn(selected, "operationsDirectory"), receiptVersion = checkpointReceiptVersion(selectedProfile, operational);
    loadEnvironment ??= video ? loadRuntimeVideoEnvironment : broadcast ? loadRuntimeBroadcastEnvironment : crm ? loadRuntimeCrmEnvironment : loadRuntimeNotificationsEnvironment;
    let parameters; try { parameters = privateAuthenticationProcessOptions(inheritedEnv, execArgv); } catch { fail("PRIVATE_CHECKPOINT_ENVIRONMENT"); }
    if (recovery) parameters = { ...parameters, originProfile: "primary", recovery: true };
    loaded = await loadEnvironment(selected.privateDirectory, parameters);
    env = video ? copyRuntimeVideoEnvironment(loaded, { originProfile: "primary", recovery: true }) : broadcast ? copyRuntimeBroadcastEnvironment(loaded, { originProfile: "primary", recovery: true })
      : crm ? copyRuntimeCrmEnvironment(loaded, { originProfile: "primary", recovery: true })
      : recovery ? copyRuntimeNotificationsEnvironment(loaded, { originProfile: "primary", recovery: true }) : copyRuntimeNotificationsEnvironment(loaded);
    if (selected.inspectionUser === env.JESSIEMESSAGE_RUNTIME_DB_USER || inside(selected.destination, env.JESSIEMESSAGE_MEDIA_ROOT)
      || inside(env.JESSIEMESSAGE_MEDIA_ROOT, selected.destination)) fail("PRIVATE_CHECKPOINT_CONFIGURATION");
    if (operational && (inside(selected.operationsDirectory, env.JESSIEMESSAGE_MEDIA_ROOT) || inside(env.JESSIEMESSAGE_MEDIA_ROOT, selected.operationsDirectory)
      || inside(selected.privateDirectory, selected.operationsDirectory) || inside(selected.operationsDirectory, selected.privateDirectory))) fail("PRIVATE_CHECKPOINT_CONFIGURATION");
    if (video && (inside(selected.destination, env.JESSIEMESSAGE_VIDEO_ROOT) || inside(env.JESSIEMESSAGE_VIDEO_ROOT, selected.destination)
      || operational && (inside(selected.operationsDirectory, env.JESSIEMESSAGE_VIDEO_ROOT) || inside(env.JESSIEMESSAGE_VIDEO_ROOT, selected.operationsDirectory)))) fail("PRIVATE_CHECKPOINT_CONFIGURATION");
    if (operational) await scopeOperation(selected.operationsDirectory, assertNoOperationalRestore);
    await inspectTools(); active(signal);
    return await scopeOperation(dirname(selected.destination), async parent => {
      await absent(parent, basename(selected.destination));
      if (["check", "check-application"].includes(selected.command)) return { status: application ? "application_precheck_passed" : "ready_for_input", profile, schema: tableCount,
        ...(application ? { coverage: applicationCoverage, passwordInputRequired: false } : {}),
        databaseConnected: false, checkpointSaved: false, started: false, migrationPerformed: false };
      try { password = application ? env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD : await readSecret(inputStream); if (typeof password !== "string" || !password || !password.isWellFormed()
        || Buffer.byteLength(password) > 4096 || /[\x00-\x1f\x7f]/.test(password)) fail("PRIVATE_CHECKPOINT_PASSWORD"); }
      catch { fail("PRIVATE_CHECKPOINT_PASSWORD"); }
      active(signal);
      if (!application) { env.JESSIEMESSAGE_BACKUP_SCHEMA_USER = selected.inspectionUser; env.JESSIEMESSAGE_BACKUP_SCHEMA_PASSWORD = password; }
      if (selected.command === "diagnose") {
        const diagnosis = publicDiagnosis(await diagnoseIdentity(env, { signal })); active(signal);
        return { status: "inspection_diagnosed", profile, databaseConnected: true, diagnosis,
          checkpointSaved: false, captureAllowed: false, started: false, migrationPerformed: false };
      }
      await (application ? inspectApplicationIdentity : inspectIdentity)(env, { signal, ...(video ? { video: true } : {}) }); active(signal);
      if (["inspect", "inspect-application"].includes(selected.command)) return { status: application ? "application_inspection_verified" : "inspection_verified", profile, tables: tableCount, migrations: tableCount,
        ...(application ? { coverage: applicationCoverage, passwordInputRequired: false } : {}),
        databaseConnected: true, ...(application ? { applicationTablesVerified: true } : { inspectionPrivilegesVerified: true }), checkpointSaved: false, started: false, migrationPerformed: false };
      keys = Object.fromEntries([["totpKey", "MFA"], ["mailKey", "MAIL"], ["messageKey", "MESSAGE"], ["mediaKey", "MEDIA"], ["notificationKey", "NOTIFICATIONS"], ...(crm ? [["crmKey", "CRM"]] : []), ...(video ? [["videoKey", "VIDEO"]] : [])]
        .map(([name, field]) => [name, Buffer.from(env[`JESSIEMESSAGE_${field}_KEY`], "base64url")]));
      const destinationIdentity = await childDirectory(parent, basename(selected.destination));
      return scopeOperation(selected.destination, async scope => {
        directoryIdentity(await scope.assertReady(), destinationIdentity);
        const prepareAt = async name => {
          active(signal);
          const result = await prepare(["prepare", "--offline", "--manifest", `${selected.destination}/${name}`, "--profile", backupProfile], env,
            { signal, outputStream: { write() {} } });
          if (result?.command !== "prepare" || result.verified !== true || result.prepared !== true || result.restored !== false) fail("PRIVATE_CHECKPOINT_BACKUP");
          const manifest = await getManifest(`${selected.destination}/${name}`), payload = await verifyManifest({ manifest, keys });
          if (manifest.version !== manifestVersion || manifest.profile !== profile || payload?.snapshot?.counts?.tables !== tableCount
            || application && payload.snapshot.version !== (video ? 3 : 2)) fail("PRIVATE_CHECKPOINT_BACKUP");
          if (application && (video ? validateVideoApplicationCoverage : validateApplicationCoverage)(payload.snapshot.coverage).tables !== tableCount) fail("PRIVATE_CHECKPOINT_BACKUP");
          return payload;
        };
        const before = await prepareAt("manifest.json");
        const binding = operational ? { database: env.JESSIEMESSAGE_DB_NAME, rootFingerprint: before.snapshot.capacity?.rootFingerprint, ...(video ? { videoRootFingerprint: before.snapshot.video?.capacity?.rootFingerprint } : {}) } : null;
        const captureOperations = () => scopeOperation(selected.operationsDirectory, scope => captureOperationalState(scope, { key: keys.crmKey, binding, signal }));
        const operationsBefore = operational ? await captureOperations() : null;
        let output;
        const configuration = { host: env.JESSIEMESSAGE_DB_HOST, port: env.JESSIEMESSAGE_DB_PORT };
        const target = { user: application ? env.JESSIEMESSAGE_RUNTIME_DB_USER : selected.inspectionUser, database: env.JESSIEMESSAGE_DB_NAME };
        const tableOptions = application ? { tables: [...createdMigrationTables(await (video ? loadVideoMigrations : loadMigrations)()), "schema_migrations"].sort() } : {};
        let sql;
        try {
          output = await exclusive(scope, "database.sql");
          sql = await dump(scope, target, configuration, password, { signal, ...tableOptions, onSqlChunk(bytes) {
            let offset = 0; while (offset < bytes.length) { const count = writeSync(output.fd, bytes, offset, bytes.length - offset); if (count < 1) fail("PRIVATE_CHECKPOINT_DUMP"); offset += count; }
          } });
          await output.sync(); regular(await output.stat({ bigint: true }));
        } finally { await output?.close(); }
        const saved = await hashCheckpointFile(scope, "database.sql", { signal });
        if (saved.bytes !== sql?.sqlBytes || saved.sha256 !== sql.sqlSha256) fail("PRIVATE_CHECKPOINT_DUMP");
        const mediaIdentity = await childDirectory(scope, "media");
        const inventory = await scopeOperation(env.JESSIEMESSAGE_MEDIA_ROOT, sourceScope => scopeOperation(`${selected.destination}/media`, async targetScope => {
          directoryIdentity(await targetScope.assertReady(), mediaIdentity); return copyMedia(sourceScope, targetScope, { signal });
        }));
        const videoIdentity = video ? await childDirectory(scope, "video") : null;
        const videoInventory = video ? await scopeOperation(env.JESSIEMESSAGE_VIDEO_ROOT, sourceScope => scopeOperation(`${selected.destination}/video`, async targetScope => {
          directoryIdentity(await targetScope.assertReady(), videoIdentity); return copyVideo(sourceScope, targetScope, { signal });
        })) : null;
        const verifyVideoCopy = () => scopeOperation(`${selected.destination}/video`, async targetScope => {
          directoryIdentity(await targetScope.assertReady(), videoIdentity); return verifyVideo(targetScope, videoInventory, { signal });
        });
        const second = await dump(scope, target, configuration, password, { signal, ...tableOptions });
        if (second.sqlBytes !== saved.bytes || second.sqlSha256 !== saved.sha256) fail("PRIVATE_CHECKPOINT_DRIFT");
        const after = await prepareAt("manifest-after.json"); compareSnapshots({ expected: before.snapshot, actual: after.snapshot, mode: "exact" });
        await scopeOperation(env.JESSIEMESSAGE_MEDIA_ROOT, sourceScope => verifyMedia(sourceScope, inventory, { signal }));
        await scopeOperation(`${selected.destination}/media`, async targetScope => {
          directoryIdentity(await targetScope.assertReady(), mediaIdentity); return verifyMedia(targetScope, inventory, { signal });
        });
        if (video) {
          await scopeOperation(env.JESSIEMESSAGE_VIDEO_ROOT, sourceScope => verifyVideo(sourceScope, videoInventory, { signal }));
          await verifyVideoCopy();
        }
        active(signal); await compress(scope, { signal });
        const compressed = await hashCheckpointFile(scope, "database.sql.gz", { signal, maxBytes: 16 * 1024 * 1024 });
        const manifest = await hashCheckpointFile(scope, "manifest.json", { signal });
        const now = clock(); if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999) fail("PRIVATE_CHECKPOINT_CONFIGURATION");
        const receipt = { format: "jessiemessage-private-checkpoint", version: receiptVersion, profile,
          ...(application ? { coverage: applicationCoverage } : {}), createdAt: now,
          schema: { tables: tableCount, migrations: tableCount }, sql: { file: "database.sql.gz", ...compressed, uncompressedBytes: saved.bytes, uncompressedSha256: saved.sha256 },
          manifest: { file: "manifest.json", sha256: manifest.sha256 }, media: inventory, ...(video ? { video: videoInventory } : {}) };
        if (operational) {
          if (operationalStateHash(await captureOperations()) !== operationalStateHash(operationsBefore)) fail("PRIVATE_CHECKPOINT_DRIFT");
          receipt.operations = await writeOperationalCheckpoint(scope, operationsBefore, receipt, keys.crmKey, { signal });
          if (operationalStateHash(await readOperationalCheckpoint(scope, receipt, keys.crmKey, { signal })) !== operationalStateHash(operationsBefore)) fail("PRIVATE_CHECKPOINT_DRIFT");
        }
        await writeCheckpointReceipt(scope, receipt, { signal });
        const receiptFile = await hashCheckpointFile(scope, "receipt.json", { signal });
        const archived = await archive(scope, inventory, { signal, ...(video ? { video: videoInventory } : {}), ...(operational ? { operations: true } : {}) });
        const archiveCheck = await verifyArchive(scope, [
          { name: "manifest.json", bytes: manifest.bytes, sha256: manifest.sha256 },
          { name: "database.sql.gz", ...compressed }, { name: "receipt.json", ...receiptFile },
          ...inventory.files.map(file => ({ ...file, name: `media/${file.name}` })),
          ...(video ? videoInventory.files.map(file => ({ ...file, name: `video/${file.name}` })) : []),
          ...(operational ? [{ name: receipt.operations.file, bytes: receipt.operations.bytes, sha256: receipt.operations.sha256 }] : []),
        ], { signal, ...(video ? { video: true } : {}) });
        if (archiveCheck.archiveBytes !== archived.bytes || archiveCheck.archiveSha256 !== archived.sha256) fail("PRIVATE_CHECKPOINT_ARCHIVE");
        await scopeOperation(`${selected.destination}/media`, async targetScope => {
          directoryIdentity(await targetScope.assertReady(), mediaIdentity); return verifyMedia(targetScope, inventory, { signal });
        });
        if (video) {
          await scopeOperation(env.JESSIEMESSAGE_VIDEO_ROOT, sourceScope => verifyVideo(sourceScope, videoInventory, { signal }));
          await verifyVideoCopy();
        }
        if ((await hashCheckpointFile(scope, "database.sql.gz", { signal })).sha256 !== compressed.sha256
          || (await hashCheckpointFile(scope, "manifest.json", { signal })).sha256 !== manifest.sha256
          || (await hashCheckpointFile(scope, "receipt.json", { signal })).sha256 !== receiptFile.sha256) fail("PRIVATE_CHECKPOINT_DRIFT");
        if (operational && (operationalStateHash(await captureOperations()) !== operationalStateHash(operationsBefore)
          || operationalStateHash(await readOperationalCheckpoint(scope, receipt, keys.crmKey, { signal })) !== operationalStateHash(operationsBefore))) fail("PRIVATE_CHECKPOINT_DRIFT");
        active(signal); const finalEnvironment = await loadEnvironment(selected.privateDirectory, parameters);
        try { if (Object.keys(loaded).some(name => finalEnvironment[name] !== loaded[name]) || Object.keys(finalEnvironment).length !== Object.keys(loaded).length) fail("PRIVATE_CHECKPOINT_DRIFT"); }
        finally { clearRuntimeMessagingSecrets(finalEnvironment); }
        await parent.assertReady(); directoryIdentity(await scope.assertReady(), destinationIdentity);
        return { status: application ? "application_checkpoint_saved" : "checkpoint_saved", profile, tables: tableCount, migrations: tableCount,
          ...(application ? { coverage: applicationCoverage } : {}),
          ...(operational ? { operationsCovered: true, operationalFiles: operationsBefore.files.length, externalRegistryContinuityVerified: false } : {}),
          sqlBytes: compressed.bytes, sqlSha256: compressed.sha256, mediaFiles: inventory.files.length, mediaBytes: inventory.bytes,
          ...(video ? { videoCovered: true, videoFiles: videoInventory.files.length, videoBytes: videoInventory.bytes } : {}),
          archive: { file: "checkpoint.tar.gz", ...archived }, archiveListed: true, archiveContentsVerified: true, archiveExtracted: false,
          independentCopyPending: true, sqlRestorePending: true, capacityRebound: false, started: false, migrationPerformed: false };
      });
    });
  } catch (error) {
    if (signal?.aborted) fail("PRIVATE_CHECKPOINT_CANCELLED");
    if (error instanceof PrivateCheckpointError) throw error;
    if (error?.code === "AUTH_DATABASE_CONNECTION" || error?.code === "AUTH_DATABASE_BUSY") fail("PRIVATE_CHECKPOINT_CONNECTION");
    if (error?.code === "BACKUP_INSPECTION_CONFIG" || error?.code === "BACKUP_APPLICATION_SCOPE") fail("PRIVATE_CHECKPOINT_INSPECTION");
    if (/^TEXT_CLONE_(?:AUTHENTICATION|ACCESS|DATABASE|DUMP)$/.test(error?.code ?? "")) fail(error.code.replace("TEXT_CLONE_", "PRIVATE_CHECKPOINT_"));
    fail("PRIVATE_CHECKPOINT_OPERATION");
  }
  finally {
    password = ""; for (const key of Object.values(keys ?? {})) key.fill(0);
    if (env) { env.JESSIEMESSAGE_BACKUP_SCHEMA_PASSWORD = ""; env.JESSIEMESSAGE_BACKUP_SCHEMA_USER = ""; }
    clearRuntimeMessagingSecrets(env); clearRuntimeMessagingSecrets(loaded);
  }
}
export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  const result = await run(parseArguments(args), dependencies); outputStream.write(`${JSON.stringify(result)}\n`); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController(), cancel = () => cancellation.abort(); process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  try { await main(process.argv.slice(2), { signal: cancellation.signal }); }
  catch (error) {
    const code = error instanceof PrivateCheckpointError ? error.code : "PRIVATE_CHECKPOINT_OPERATION";
    const detail = code === "PRIVATE_CHECKPOINT_CONNECTION" ? "La connexion SQL n’a pas pu être établie ou fermée correctement."
      : code === "PRIVATE_CHECKPOINT_INSPECTION" ? "Les droits ou métadonnées requis ne sont pas confirmés. Utiliser diagnose sans arrêter l’application."
      : "La sauvegarde privée n’est pas confirmée.";
    process.stderr.write(`${code}: ${detail}\n`); process.exitCode = 1;
  }
  finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
