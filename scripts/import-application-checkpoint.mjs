import { constants } from "node:fs";
import { lstat, open, realpath, unlink } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { loadRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";
import { loadRuntimeCrmEnvironment } from "../server/config/runtime-crm.mjs";
import { loadRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { checkpointBackupProfile, matchesCheckpointReceipt, sameCheckpointReceiptScope } from "../server/backup/profiles.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { parseArguments as verificationArguments, run as verifyCheckpoint } from "./verify-private-checkpoint.mjs";
import { readPassword } from "./migration-input.mjs";

const CLIENT = "/usr/bin/mariadb", CA = "/etc/ssl/certs/ca-certificates.crt";
const PROCESS_ENV = Object.freeze({ PATH: "/usr/bin:/bin", HOME: "/", LANG: "C", LC_ALL: "C" });
const MAX_GZIP = 16 * 1024 * 1024, MAX_SQL = 64 * 1024 * 1024;
const STATS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const CODES = new Set(["USAGE", "CHECKPOINT", "PASSWORD", "CONFIGURATION", "DATABASE", "NOT_EMPTY", "SQL", "IMPORT", "VERIFY", "CLEANUP", "CANCELLED", "OPERATION"].map(name => `APPLICATION_CHECKPOINT_IMPORT_${name}`));
export class ApplicationCheckpointImportError extends Error {
  constructor(code) { const selected = CODES.has(code) ? code : "APPLICATION_CHECKPOINT_IMPORT_OPERATION"; super(selected); this.name = "ApplicationCheckpointImportError"; this.code = selected; }
}
const fail = name => { throw new ApplicationCheckpointImportError(`APPLICATION_CHECKPOINT_IMPORT_${name}`); };
const active = signal => { if (signal?.aborted) fail("CANCELLED"); };
const digest = value => createHash("sha256").update(value).digest("hex");
const same = (first, second) => STATS.every(name => first[name] === second[name]);
function regular(stats) {
  if (!stats.isFile() || stats.uid !== BigInt(process.getuid()) || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n) fail("CHECKPOINT");
}
function passwordValue(value) {
  if (typeof value !== "string" || !value || !value.isWellFormed() || /[\x00-\x1f\x7f]/.test(value) || Buffer.byteLength(value, "utf8") > 4096) fail("PASSWORD");
  return value;
}
function optionValue(value) {
  if (typeof value !== "string" || !value || !value.isWellFormed() || /[\x00-\x1f\x7f]/.test(value)) fail("CONFIGURATION");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function parseArguments(args) {
  if (!Array.isArray(args) || ![15, 17].includes(args.length) || !["check", "restore"].includes(args[0])) fail("USAGE");
  const flags = args.slice(1), positions = flags.flatMap((value, index) => value === "--sql-sha256" ? [index] : []);
  if (positions.length !== 1 || positions[0] % 2 || !/^[a-f0-9]{64}$/.test(flags[positions[0] + 1])) fail("USAGE");
  const sqlSha256 = flags[positions[0] + 1]; flags.splice(positions[0], 2);
  try { return { ...verificationArguments([args[0] === "check" ? "check-application" : "verify-application", ...flags]), sqlSha256 }; }
  catch { fail("USAGE"); }
}

export async function inspectImportClient() {
  const output = await new Promise((yes, no) => execFile(CLIENT, ["--no-defaults", "--version"], {
    env: PROCESS_ENV, encoding: "utf8", timeout: 5000, maxBuffer: 8192,
  }, (error, stdout) => error ? no(new ApplicationCheckpointImportError("APPLICATION_CHECKPOINT_IMPORT_IMPORT")) : yes(stdout)));
  if (!/\bDistrib 10\.11\.14(?:\b|-)/.test(output)) fail("IMPORT");
}

// This accepts the closed native application dump format, not arbitrary SQL.
// String values are opaque. Quoted identifiers stay distinguishable from SQL
// keywords; dots and client commands outside strings are always refused.
function tokens(source) {
  const result = []; let index = 0;
  while (index < source.length) {
    const rest = source.slice(index), char = source[index];
    if (/\s/.test(char)) { index++; continue; }
    if (char === "#" || rest.startsWith("--") && /\s/.test(source[index + 2] ?? "")) {
      const end = source.indexOf("\n", index); index = end === -1 ? source.length : end + 1; continue;
    }
    if (rest.startsWith("/*")) {
      const end = source.indexOf("*/", index + 2); if (end === -1) fail("SQL");
      const content = source.slice(index + 2, end);
      if (/^(?:!|M!)999999\\- enable the sandbox mode\s*$/.test(content)) { index = end + 2; continue; }
      if (content.startsWith("!") || content.startsWith("M!")) {
        const executable = /^(?:!|M!)\d{5,6}\s+([\s\S]*)$/.exec(content); if (!executable) fail("SQL");
        result.push(...tokens(executable[1]));
      }
      index = end + 2; continue;
    }
    if (char === "'" || char === '"') {
      const start = index, quote = char; index++; let ended = false;
      while (index < source.length) {
        if (source[index] === "\\") { index += 2; continue; }
        if (source[index] === quote) { if (source[index + 1] === quote) { index += 2; continue; } index++; ended = true; break; }
        index++;
      }
      if (!ended) fail("SQL");
      const literal = source.slice(start, index);
      result.push({ literal: true, canonicalSqlMode: literal === "'NO_AUTO_VALUE_ON_ZERO'", utc: literal === "'+00:00'" }); continue;
    }
    if (char === "`") {
      const end = source.indexOf("`", index + 1), name = source.slice(index + 1, end);
      if (end === -1 || !/^[a-z][a-z0-9_]*$/i.test(name)) fail("SQL");
      result.push({ identifier: name }); index = end + 1; continue;
    }
    const number = /^(?:0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(rest);
    if (number) { result.push({ number: number[0] }); index += number[0].length; continue; }
    const word = /^[a-z_][a-z0-9_]*/i.exec(rest);
    if (word) { result.push(word[0].toUpperCase()); index += word[0].length; continue; }
    if (!"(),;=@+-*/%<>!|&".includes(char)) fail("SQL");
    result.push(char); index++;
  }
  return result;
}
const identifier = token => token && typeof token === "object" ? token.identifier : undefined;
const SET_NAMES = new Set(["CHARACTER_SET_CLIENT", "CHARACTER_SET_RESULTS", "COLLATION_CONNECTION", "TIME_ZONE", "UNIQUE_CHECKS", "FOREIGN_KEY_CHECKS", "SQL_MODE", "SQL_NOTES"]);
function validSet(statement) {
  if (statement.length === 3 && statement[1] === "NAMES" && ["UTF8MB4", "UTF8"].includes(statement[2])) return {};
  let index = 1, canonicalMode = false, restoreMode = false;
  const variable = (left = false) => {
    let ats = 0; while (statement[index] === "@") { ats++; index++; }
    const name = statement[index++];
    if (typeof name !== "string" || ats > (left ? 1 : 2)) return undefined;
    const valid = ats === 0 ? SET_NAMES.has(name) : ats === 2 ? SET_NAMES.has(name)
      : name === "SAVED_CS_CLIENT" || name.startsWith("OLD_") && SET_NAMES.has(name.slice(4));
    return valid ? { ats, name } : undefined;
  };
  while (index < statement.length) {
    const left = variable(true); if (!left || statement[index++] !== "=") return undefined;
    let right;
    if (statement[index]?.literal || statement[index]?.number) right = statement[index++];
    else if (statement[index] === "UTF8MB4" || statement[index] === "UTF8") right = { charset: statement[index++] };
    else right = variable();
    if (!right) return undefined;
    if (left.ats === 1) {
      const original = left.name === "SAVED_CS_CLIENT" ? "CHARACTER_SET_CLIENT" : left.name.slice(4);
      if (right.ats !== 2 || right.name !== original) return undefined;
    } else if (left.name === "SQL_MODE") {
      if (right.canonicalSqlMode) canonicalMode = true;
      else if (right.ats === 1 && right.name === "OLD_SQL_MODE") restoreMode = true;
      else return undefined;
    } else if (right.ats === 1 && (right.name === `OLD_${left.name}` || left.name === "CHARACTER_SET_CLIENT" && right.name === "SAVED_CS_CLIENT")) {
      // Restoring exactly the client's corresponding saved session setting.
    } else if (left.name === "TIME_ZONE" && right.utc || ["UNIQUE_CHECKS", "FOREIGN_KEY_CHECKS", "SQL_NOTES"].includes(left.name) && right.number === "0"
      || left.name === "CHARACTER_SET_CLIENT" && right.charset) {
      // Only canonical native-dump literals may change a session setting.
    } else return undefined;
    if (index === statement.length) return { canonicalMode, restoreMode };
    if (statement[index++] !== ",") return undefined;
  }
  return undefined;
}

export async function validateApplicationSql(bytes) {
  let source;
  try { source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail("SQL"); }
  if (!bytes.length || bytes.length > MAX_SQL || source.includes("\0")) fail("SQL");
  const migrations = await loadMigrations(), tables = [...createdMigrationTables(migrations), "schema_migrations"].sort(), expected = new Set(tables), created = new Set();
  if (migrations.length !== 30 || tables.length !== 30 || expected.size !== 30) fail("SQL");
  const all = tokens(source), statements = []; let statement = [];
  for (const token of all) { if (token === ";") { if (statement.length) statements.push(statement); statement = []; } else statement.push(token); }
  if (statement.length) fail("SQL");
  let canonicalMode = false, restoredMode = false;
  for (const row of statements) {
    if (row[0] === "SET") {
      const settings = validSet(row); if (!settings) fail("SQL");
      if (settings.canonicalMode) { if (restoredMode || settings.restoreMode) fail("SQL"); canonicalMode = true; }
      if (settings.restoreMode) { if (!canonicalMode || created.size !== expected.size) fail("SQL"); restoredMode = true; }
      continue;
    }
    if (!canonicalMode || restoredMode) fail("SQL");
    if (row[0] === "CREATE" && row[1] === "TABLE" && expected.has(identifier(row[2])) && row[3] === "(" && !created.has(identifier(row[2]))) {
      const forbidden = new Set(["SELECT", "INTO", "OUTFILE", "DUMPFILE", "LOAD", "GRANT", "REVOKE", "RENAME", "DATABASE", "SCHEMA", "TRIGGER", "EVENT", "PROCEDURE", "FUNCTION", "CALL", "DELIMITER", "SOURCE", "SYSTEM", "EXECUTE", "PREPARE", "DEALLOCATE", "USE", "ALTER", "DROP", "TRUNCATE", "TABLESPACE", "CONNECTION", "DIRECTORY"]);
      if (row.slice(3).some(token => typeof token === "string" && forbidden.has(token))) fail("SQL");
      created.add(identifier(row[2])); continue;
    }
    if (row[0] === "INSERT" && row[1] === "INTO" && expected.has(identifier(row[2])) && created.has(identifier(row[2])) && row[3] === "VALUES"
      && row.length > 4 && row.slice(4).every(token => token?.literal || token?.number || ["NULL", "(", ")", ",", "+", "-"].includes(token))) continue;
    if (row.length === 5 && row[0] === "ALTER" && row[1] === "TABLE" && created.has(identifier(row[2])) && ["ENABLE", "DISABLE"].includes(row[3]) && row[4] === "KEYS") continue;
    fail("SQL");
  }
  if (created.size !== expected.size) fail("SQL");
  return { tables: created.size };
}

export async function readApplicationSql(scope, expected, { signal } = {}) {
  let handle, gzip, sql;
  try {
    active(signal); await scope.assertReady();
    handle = await open(scope.file("database.sql.gz"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true }); regular(before);
    if (before.size < 1n || before.size > BigInt(MAX_GZIP) || Number(before.size) !== expected.backupBytes) fail("CHECKPOINT");
    gzip = Buffer.alloc(Number(before.size) + 1); let length = 0;
    while (length < gzip.length) { active(signal); const part = await handle.read(gzip, length, gzip.length - length, length); if (!part.bytesRead) break; length += part.bytesRead; }
    const after = await handle.stat({ bigint: true }), visible = await lstat(scope.file("database.sql.gz"), { bigint: true }); regular(after); regular(visible);
    if (!same(before, after) || !same(after, visible) || length !== Number(before.size) || digest(gzip.subarray(0, length)) !== expected.backupSha256) fail("CHECKPOINT");
    sql = gunzipSync(gzip.subarray(0, length), { maxOutputLength: MAX_SQL });
    if (sql.length !== expected.sqlBytes || digest(sql) !== expected.sqlSha256) fail("CHECKPOINT");
    await validateApplicationSql(sql); await scope.assertReady(); active(signal); return sql;
  } catch (error) { sql?.fill(0); if (error instanceof ApplicationCheckpointImportError) throw error; fail("CHECKPOINT"); }
  finally { gzip?.fill(0); await handle?.close(); }
}

export async function inspectEmptyClone(connection, database) {
  const selected = await connection.query("SELECT DATABASE() AS name"), cipher = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  if (selected.length !== 1 || selected[0]?.name !== database || cipher.length !== 1 || cipher[0]?.Variable_name !== "Ssl_cipher" || !cipher[0]?.Value) fail("DATABASE");
  const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? LIMIT 1", [database]);
  if (!Array.isArray(tables) || tables.length) fail("NOT_EMPTY");
}

export async function importNativeSql(scope, selected, configuration, password, sql, { spawnClient = spawn, signal, timeoutMs = 90000 } = {}) {
  const name = `.application-import-${randomBytes(16).toString("hex")}.cnf`;
  let handle, content, identity, written, canonical, failure;
  const diagnostic = Buffer.alloc(8192);
  try {
    passwordValue(password); active(signal); canonical = await realpath(scope.path); await scope.assertReady();
    const root = await lstat(canonical, { bigint: true }), pinned = await scope.assertReady();
    if (root.dev !== pinned.dev || root.ino !== pinned.ino || root.mode !== pinned.mode || root.uid !== pinned.uid) fail("IMPORT");
    content = Buffer.from(`[client]\nhost=${optionValue(configuration.host)}\nport=${configuration.port}\nuser=${optionValue(selected.user)}\npassword=${optionValue(password)}\n`, "utf8");
    handle = await open(scope.file(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    identity = await handle.stat({ bigint: true });
    await handle.chmod(0o600); await handle.writeFile(content); await handle.sync(); written = await handle.stat({ bigint: true }); regular(written);
    if (written.size !== BigInt(content.length)) fail("IMPORT"); await handle.close(); handle = undefined; await scope.sync();
    const visible = await lstat(`${canonical}/${name}`, { bigint: true }); regular(visible);
    if (!same(visible, written) || await realpath(scope.path) !== canonical) fail("IMPORT"); await scope.assertReady(); active(signal);
    await new Promise((yes, no) => {
      let child, timer, failed = false, output = 0, errors = 0;
      const reject = () => { failed = true; try { child?.kill("SIGKILL"); } catch {} };
      try {
        child = spawnClient(CLIENT, [`--defaults-file=${canonical}/${name}`, "--protocol=TCP", `--ssl-ca=${CA}`, "--ssl-verify-server-cert", "--sandbox", "--local-infile=0", "--skip-reconnect", `--database=${selected.database}`], { env: PROCESS_ENV, stdio: ["pipe", "pipe", "pipe"] });
        timer = setTimeout(reject, timeoutMs); signal?.addEventListener("abort", reject, { once: true }); if (signal?.aborted) reject();
        child.stdout.on("data", chunk => { output += chunk.length; chunk.fill(0); if (output > 8192) reject(); });
        child.stderr.on("data", chunk => { if (errors < diagnostic.length) chunk.copy(diagnostic, errors, 0, Math.min(chunk.length, diagnostic.length - errors)); errors += chunk.length; chunk.fill(0); if (errors > diagnostic.length) reject(); });
        child.stdin.on("error", reject); child.stdout.on("error", reject); child.stderr.on("error", reject); child.once("error", reject);
        child.once("close", (code, killed) => { clearTimeout(timer); signal?.removeEventListener("abort", reject); failed || code !== 0 || killed ? no(new ApplicationCheckpointImportError("APPLICATION_CHECKPOINT_IMPORT_IMPORT")) : yes(); });
        child.stdin.end(sql);
      } catch { clearTimeout(timer); signal?.removeEventListener("abort", reject); reject(); no(new ApplicationCheckpointImportError("APPLICATION_CHECKPOINT_IMPORT_IMPORT")); }
    });
    const final = await lstat(`${canonical}/${name}`, { bigint: true }); regular(final);
    if (!same(final, written) || await realpath(scope.path) !== canonical) fail("IMPORT"); await scope.assertReady();
  } catch (error) { failure = error instanceof ApplicationCheckpointImportError ? error : new ApplicationCheckpointImportError("APPLICATION_CHECKPOINT_IMPORT_IMPORT"); }
  finally {
    content?.fill(0); diagnostic.fill(0);
    try {
      await handle?.close();
      if (identity) { const current = await lstat(scope.file(name), { bigint: true }); regular(current); if (current.dev !== identity.dev || current.ino !== identity.ino) fail("CLEANUP"); await unlink(scope.file(name)); await scope.sync(); }
    } catch { failure = new ApplicationCheckpointImportError("APPLICATION_CHECKPOINT_IMPORT_CLEANUP"); }
  }
  if (failure) throw failure; active(signal);
}

export async function run(value, { inheritedEnv = process.env, execArgv = process.execArgv, inputStream = process.stdin,
  verify = verifyCheckpoint, loadEnvironment, readSecret = readPassword,
  scopeOperation = withPrivateDirectory, readSql = readApplicationSql, inspectClient = inspectImportClient, connect = connectDatabase,
  inspect = inspectEmptyClone, importSql = importNativeSql, signal } = {}) {
  let environment, password = "", sql, connection, connectionEnv, result, failure;
  try {
    if (value && Object.hasOwn(value, "profile") && !Object.hasOwn(Object.getOwnPropertyDescriptor(value, "profile") ?? {}, "value")) fail("USAGE");
    const selected = verificationArguments([value.command, "--private-directory", value.privateDirectory, "--private-path-mode", value.privatePathMode,
      "--checkpoint-directory", value.checkpointDirectory, "--database", value.database, "--confirm-database", value.confirmation, "--user", value.user,
      ...(Object.hasOwn(value, "profile") ? ["--profile", value.profile] : [])]);
    if (!["check-application", "verify-application"].includes(selected.command) || !/^[a-f0-9]{64}$/.test(value.sqlSha256)) fail("USAGE");
    const selectedProfile = checkpointBackupProfile(selected.profile, true), { recovery, crm, broadcast } = selectedProfile;
    loadEnvironment ??= broadcast ? loadRuntimeBroadcastEnvironment : crm ? loadRuntimeCrmEnvironment : loadRuntimeNotificationsEnvironment;
    const matchesRecovery = report => !recovery || matchesCheckpointReceipt(selectedProfile, report);
    active(signal); const processOptions = privateAuthenticationProcessOptions(inheritedEnv, execArgv);
    const check = { ...selected, command: "check-application" }, dependencies = { inheritedEnv, execArgv, signal };
    const before = await verify(check, dependencies);
    if (before?.status !== "ready_for_input" || before.checkpointFilesMatched !== true || before.databaseConnected !== false || before.tables !== 30 || before.migrations !== 30 || before.sqlSha256 !== value.sqlSha256 || !matchesRecovery(before)) fail("CHECKPOINT");
    await inspectClient();
    await scopeOperation(selected.checkpointDirectory, async scope => {
      sql = await readSql(scope, before, { signal }); active(signal);
      if (digest(sql) !== value.sqlSha256) fail("CHECKPOINT");
      if (selected.command === "check-application") { result = { ...before, status: "application_restore_precheck_passed", imported: false, nativeImportClientVerified: true, sqlImportFormatVerified: true, trustedSqlSha256Matched: true }; return; }
      environment = await loadEnvironment(selected.privateDirectory, { port: processOptions.port,
        ...(recovery ? { originProfile: "primary", recovery: true } : {}) });
      if (selected.database.toLowerCase() === environment.JESSIEMESSAGE_DB_NAME.toLowerCase() || selected.user === environment.JESSIEMESSAGE_RUNTIME_DB_USER) fail("CONFIGURATION");
      try { password = passwordValue(await readSecret(inputStream)); } catch { fail("PASSWORD"); }
      connectionEnv = { JESSIEMESSAGE_DB_HOST: environment.JESSIEMESSAGE_DB_HOST, JESSIEMESSAGE_DB_PORT: environment.JESSIEMESSAGE_DB_PORT,
        JESSIEMESSAGE_DB_NAME: selected.database, JESSIEMESSAGE_MIGRATION_DATABASE: selected.confirmation,
        JESSIEMESSAGE_DB_USER: selected.user, JESSIEMESSAGE_DB_PASSWORD: password, JESSIEMESSAGE_DB_TLS_CA_PATH: CA };
      connection = await connect(connectionEnv); await inspect(connection, selected.database); active(signal);
      await connection.end(); connection = undefined;
      const rechecked = await verify(check, dependencies);
      if (JSON.stringify(rechecked) !== JSON.stringify(before)) fail("CHECKPOINT"); active(signal);
      await importSql(scope, selected, { host: environment.JESSIEMESSAGE_DB_HOST, port: environment.JESSIEMESSAGE_DB_PORT }, password, sql, { signal }); active(signal);
      sql.fill(0); sql = undefined;
      const verified = await verify(selected, { ...dependencies, readSecret: async () => password });
      if (verified?.status !== "verified" || verified.applicationSnapshotMatched !== true || verified.checkpointFilesMatched !== true || verified.databaseConnected !== true || verified.capacityRebound !== false
        || !matchesRecovery(verified) || !sameCheckpointReceiptScope(before, verified)) fail("VERIFY");
      result = { ...verified, status: "application_checkpoint_restored_verified", imported: true, completeDatabase: false, sourceMutated: false };
    });
  } catch (error) { failure = error instanceof ApplicationCheckpointImportError ? error : new ApplicationCheckpointImportError("APPLICATION_CHECKPOINT_IMPORT_OPERATION"); }
  finally {
    sql?.fill(0); password = ""; if (connectionEnv) connectionEnv.JESSIEMESSAGE_DB_PASSWORD = "";
    clearRuntimeMessagingSecrets(environment);
    try { await connection?.end(); } catch { failure = new ApplicationCheckpointImportError("APPLICATION_CHECKPOINT_IMPORT_CLEANUP"); }
  }
  if (failure) throw failure; active(signal); return result;
}

export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  const result = await run(parseArguments(args), dependencies); outputStream.write(`${JSON.stringify(result)}\n`); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController(), cancel = () => cancellation.abort();
  process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  try { await main(process.argv.slice(2), { signal: cancellation.signal }); }
  catch (error) { process.stderr.write(`${error instanceof ApplicationCheckpointImportError ? error.code : "APPLICATION_CHECKPOINT_IMPORT_OPERATION"}: Application checkpoint restoration was not confirmed.\n`); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
