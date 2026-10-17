import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { databaseOptions } from "../server/db/connection.mjs";
import { loadMigrations, createdMigrationTables } from "../server/db/migrations.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { loadRuntimeCrmEnvironment } from "../server/config/runtime-crm.mjs";
import { loadRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { loadRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";
import { checkpointBackupProfile, CHECKPOINT_RUNTIME_PROFILES } from "../server/backup/profiles.mjs";
import { parseArguments as importArguments, run as importCheckpoint, ApplicationCheckpointImportError } from "./import-application-checkpoint.mjs";
import { run as verifyCheckpoint, PrivateCheckpointVerificationError } from "./verify-private-checkpoint.mjs";
import { readPassword } from "./migration-input.mjs";

const CA = "/etc/ssl/certs/ca-certificates.crt";
const FIELDS = ["command", "privateDirectory", "privatePathMode", "checkpointDirectory", "database", "confirmation", "user", "profile", "sqlSha256"];
const PHASES = new Set(["arguments", "precheck", "configuration", "password", "connection", "inspection", "import", "verification", "cleanup"]);
const CODES = new Set(["USAGE", "ENVIRONMENT", "CHECKPOINT", "CONFIGURATION", "PASSWORD", "AUTHENTICATION", "ACCESS", "DATABASE", "TLS", "CONNECTION", "PARTIAL_CLONE", "IMPORT", "VERIFY", "RESULT", "CANCELLED", "CLEANUP", "OPERATION"]);
export class CheckpointResumeError extends Error {
  constructor(code, phase = "arguments", detailCode) {
    const selected = CODES.has(code) ? code : "OPERATION";
    super(`APPLICATION_CHECKPOINT_RESUME_${selected}`);
    this.name = "CheckpointResumeError"; this.code = this.message;
    this.phase = PHASES.has(phase) ? phase : "arguments";
    if (typeof detailCode === "string" && /^(?:APPLICATION_CHECKPOINT_IMPORT|PRIVATE_CHECKPOINT_VERIFY)_[A-Z_]+$/.test(detailCode)) this.detailCode = detailCode;
  }
}
const fail = (code, phase) => { throw new CheckpointResumeError(code, phase); };
const active = (signal, phase) => { if (signal?.aborted) fail("CANCELLED", phase); };

export function parseArguments(args) {
  if (!Array.isArray(args) || !["check", "resume"].includes(args[0])) fail("USAGE", "arguments");
  let selected;
  try { selected = importArguments([args[0] === "check" ? "check" : "restore", ...args.slice(1)]); }
  catch { fail("USAGE", "arguments"); }
  if (!CHECKPOINT_RUNTIME_PROFILES.includes(selected.profile)) fail("USAGE", "arguments");
  return { ...selected, command: args[0] };
}

function selectedRecord(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail("USAGE", "arguments");
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(fields).length !== FIELDS.length || FIELDS.some(name => !Object.hasOwn(fields[name] ?? {}, "value"))) fail("USAGE", "arguments");
  const get = name => fields[name].value;
  return parseArguments([get("command"), "--private-directory", get("privateDirectory"), "--private-path-mode", get("privatePathMode"),
    "--checkpoint-directory", get("checkpointDirectory"), "--database", get("database"), "--confirm-database", get("confirmation"),
    "--user", get("user"), "--profile", get("profile"), "--sql-sha256", get("sqlSha256")]);
}

/** Keep only closed driver categories. Driver messages may contain credentials. */
export async function connectOperatorDatabase(configuration, { readCa = readFile, driverConnect = async options => {
  const { default: driver } = await import("mariadb"); return driver.createConnection(options);
} } = {}) {
  let options;
  try {
    options = databaseOptions(configuration);
    if (!options.ssl || options.ssl.rejectUnauthorized !== true || options.multipleStatements !== false) fail("CONFIGURATION", "connection");
    options.ssl.ca = await readCa(CA, "utf8");
    return await driverConnect(options);
  } catch (error) {
    if (error instanceof CheckpointResumeError) throw error;
    const errno = Object.getOwnPropertyDescriptor(error ?? {}, "errno")?.value;
    const code = Object.getOwnPropertyDescriptor(error ?? {}, "code")?.value;
    if (errno === 1045) fail("AUTHENTICATION", "connection");
    if ([1044, 1142].includes(errno)) fail("ACCESS", "connection");
    if (errno === 1049) fail("DATABASE", "connection");
    if (["CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT"].includes(code)) fail("TLS", "connection");
    fail("CONNECTION", "connection");
  } finally { if (options) options.password = ""; }
}

export async function inspectResumeClone(connection, database) {
  const identity = await connection.query("SELECT DATABASE() AS name");
  const tls = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  if (identity.length !== 1 || identity[0]?.name !== database || tls.length !== 1 || tls[0]?.Variable_name !== "Ssl_cipher" || !tls[0]?.Value) fail("DATABASE", "inspection");
  const rows = await connection.query("SELECT TABLE_NAME AS name, TABLE_TYPE AS kind, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME LIMIT 31", [database]);
  if (!Array.isArray(rows) || rows.length > 31) fail("DATABASE", "inspection");
  if (rows.length === 0) return "empty";
  const migrations = await loadMigrations(), names = [...createdMigrationTables(migrations), "schema_migrations"];
  return migrations.length === 30 && names.length === 30 && rows.length === 30 && new Set(rows.map(row => row.name)).size === 30
    && rows.every(row => names.includes(row.name) && row.kind === "BASE TABLE" && row.engine === "InnoDB") ? "application-schema" : "partial";
}

function matches(result, selected, status) {
  const profile = checkpointBackupProfile(selected.profile, true);
  return result?.status === status && result.version === profile.receiptVersion && result.profile === profile.manifestProfile
    && result.tables === 30 && result.migrations === 30 && result.sqlSha256 === selected.sqlSha256
    && result.checkpointFilesMatched === true && result.capacityRebound === false
    && result.httpStarted === false && result.smtpStarted === false && result.workersStarted === false;
}

/** A single personal credential read, followed by inspection before any write.
 * Empty copies use the existing native importer; populated copies only verify.
 * A partial copy is preserved and refused, never cleaned or overwritten. */
export async function run(value, { inheritedEnv = process.env, execArgv = process.execArgv, inputStream = process.stdin,
  importOperation = importCheckpoint, verifyOperation = verifyCheckpoint, loadEnvironment,
  readSecret = readPassword, connect = connectOperatorDatabase, inspect = inspectResumeClone, signal } = {}) {
  let phase = "arguments", environment, connectionEnv, connection, password = "", result, failure;
  try {
    const selected = selectedRecord(value), { crm, broadcast } = checkpointBackupProfile(selected.profile, true);
    let processOptions;
    try { processOptions = privateAuthenticationProcessOptions(inheritedEnv, execArgv); } catch { fail("ENVIRONMENT", "precheck"); }
    const dependencies = { inheritedEnv, execArgv, signal };
    phase = "precheck"; active(signal, phase);
    const before = await importOperation({ ...selected, command: "check-application" }, dependencies);
    if (!matches(before, selected, "application_restore_precheck_passed") || before.databaseConnected !== false || before.imported !== false
      || before.nativeImportClientVerified !== true || before.sqlImportFormatVerified !== true || before.trustedSqlSha256Matched !== true) fail("CHECKPOINT", phase);
    active(signal, phase);
    if (selected.command === "check") return { ...before, resumeSupported: true };
    phase = "configuration"; active(signal, phase);
    loadEnvironment ??= broadcast ? loadRuntimeBroadcastEnvironment : crm ? loadRuntimeCrmEnvironment : loadRuntimeNotificationsEnvironment;
    environment = await loadEnvironment(selected.privateDirectory, { port: processOptions.port, originProfile: "primary", recovery: true });
    if (selected.database.toLowerCase() === environment.JESSIEMESSAGE_DB_NAME.toLowerCase() || selected.user === environment.JESSIEMESSAGE_RUNTIME_DB_USER) fail("CONFIGURATION", phase);
    phase = "password";
    try { password = await readSecret(inputStream); } catch { fail("PASSWORD", phase); }
    if (typeof password !== "string" || !password || !password.isWellFormed() || /[\x00-\x1f\x7f]/.test(password) || Buffer.byteLength(password, "utf8") > 4096) fail("PASSWORD", phase);
    connectionEnv = { JESSIEMESSAGE_DB_HOST: environment.JESSIEMESSAGE_DB_HOST, JESSIEMESSAGE_DB_PORT: environment.JESSIEMESSAGE_DB_PORT,
      JESSIEMESSAGE_DB_NAME: selected.database, JESSIEMESSAGE_MIGRATION_DATABASE: selected.confirmation,
      JESSIEMESSAGE_DB_USER: selected.user, JESSIEMESSAGE_DB_PASSWORD: password, JESSIEMESSAGE_DB_TLS_CA_PATH: CA };
    phase = "connection"; active(signal, phase); connection = await connect(connectionEnv);
    phase = "inspection"; active(signal, phase); const state = await inspect(connection, selected.database);
    await connection.end(); connection = undefined; active(signal, phase);
    if (state === "partial") fail("PARTIAL_CLONE", phase);
    const authenticated = { ...dependencies, readSecret: async () => password };
    if (state === "empty") {
      phase = "import"; active(signal, phase);
      const restored = await importOperation({ ...selected, command: "verify-application" }, authenticated);
      if (!matches(restored, selected, "application_checkpoint_restored_verified") || restored.imported !== true
        || restored.databaseConnected !== true || restored.applicationSnapshotMatched !== true || restored.sourceMutated !== false) fail("RESULT", phase);
      result = { ...restored, action: "imported_empty_clone", importedThisRun: true };
    } else if (state === "application-schema") {
      phase = "verification"; active(signal, phase);
      const { sqlSha256: _hash, command: _command, ...verification } = selected;
      const verified = await verifyOperation({ ...verification, command: "verify-application" }, authenticated);
      if (!matches(verified, selected, "verified") || verified.databaseConnected !== true || verified.applicationSnapshotMatched !== true) fail("RESULT", phase);
      result = { ...verified, status: "application_checkpoint_existing_clone_verified", action: "verified_existing_clone", imported: false, importedThisRun: false, sourceMutated: false };
    } else fail("DATABASE", phase);
  } catch (error) {
    failure = error instanceof CheckpointResumeError ? error : error instanceof ApplicationCheckpointImportError
      ? new CheckpointResumeError("IMPORT", phase, error.code) : error instanceof PrivateCheckpointVerificationError
        ? new CheckpointResumeError("VERIFY", phase, error.code) : new CheckpointResumeError("OPERATION", phase);
  } finally {
    password = ""; if (connectionEnv) connectionEnv.JESSIEMESSAGE_DB_PASSWORD = "";
    clearRuntimeMessagingSecrets(environment);
    try { await connection?.end(); } catch { failure = new CheckpointResumeError("CLEANUP", "cleanup"); }
  }
  if (failure) throw failure; active(signal, phase); return result;
}

export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  const result = await run(parseArguments(args), dependencies); outputStream.write(`${JSON.stringify(result)}\n`); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController(), cancel = () => cancellation.abort(); process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  try { await main(process.argv.slice(2), { signal: cancellation.signal }); }
  catch (error) {
    const safe = error instanceof CheckpointResumeError ? error : new CheckpointResumeError("OPERATION", "arguments");
    process.stderr.write(`${JSON.stringify({ status: "application_checkpoint_resume_failed", code: safe.code, phase: safe.phase, ...(safe.detailCode ? { detailCode: safe.detailCode } : {}) })}\n`); process.exitCode = 1;
  } finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
