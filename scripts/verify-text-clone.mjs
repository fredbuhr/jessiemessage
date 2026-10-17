import { constants } from "node:fs";
import { lstat, open, readFile, realpath, unlink } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { readRuntimeMessagingBundle, validateRuntimeDatabaseConfiguration, validateRuntimeAuthenticationConfiguration,
  validateRuntimeMessagingConfiguration } from "../server/config/runtime-database-file.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, loadMigrations, inspectHistory } from "../server/db/migrations.mjs";
import { verifyTextBackupData } from "../server/backup/verify.mjs";
import { readPassword } from "./migration-input.mjs";

const REPOSITORY = resolve(fileURLToPath(new URL("../", import.meta.url)));
const CLIENT = "/usr/bin/mariadb-dump", CA = "/etc/ssl/certs/ca-certificates.crt";
const MAX_ARCHIVE = 16 * 1024 * 1024, MAX_SQL = 64 * 1024 * 1024;
const PROCESS_ENV = Object.freeze({ PATH: "/usr/bin:/bin", HOME: "/", LANG: "C", LC_ALL: "C" });
const FIELDS = ["command", "privateDirectory", "privatePathMode", "database", "confirmation", "user", "backup", "backupSha256"];
const STATS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const DUMP_FLAGS = ["--single-transaction", "--quick", "--skip-lock-tables", "--skip-add-locks", "--skip-add-drop-table",
  "--skip-comments", "--skip-triggers", "--hex-blob", "--no-tablespaces"];
const CODES = new Set(["USAGE", "ENVIRONMENT", "CONFIGURATION", "BACKUP", "PASSWORD", "CLIENT", "DUMP", "DUMP_MISMATCH", "AUTHENTICATION", "ACCESS",
  "DATABASE", "SCHEMA", "CRYPTO", "CLEANUP", "CANCELLED", "OPERATION"].map((name) => `TEXT_CLONE_${name}`));

export class TextCloneVerificationError extends Error {
  constructor(code) { const selected = CODES.has(code) ? code : "TEXT_CLONE_OPERATION"; super(selected); this.code = selected; }
}
const fail = (code) => { throw new TextCloneVerificationError(code); };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (name, root) => { const suffix = relative(root, name); return suffix === "" || suffix !== ".." && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep); };
function unchanged(first, second) { if (STATS.some((name) => first[name] !== second[name])) fail("TEXT_CLONE_BACKUP"); }
function regular(stats) {
  if (!stats.isFile() || stats.uid !== BigInt(process.getuid()) || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n) fail("TEXT_CLONE_BACKUP");
}

export function parseArguments(args) {
  if (!Array.isArray(args) || args.length !== 15 || !["check", "verify"].includes(args[0])) fail("TEXT_CLONE_USAGE");
  const names = new Map([["--private-directory", "privateDirectory"], ["--private-path-mode", "privatePathMode"],
    ["--database", "database"], ["--confirm-database", "confirmation"], ["--user", "user"], ["--backup", "backup"], ["--backup-sha256", "backupSha256"]]);
  const selected = { command: args[0] };
  for (let index = 1; index < args.length; index += 2) {
    const name = names.get(args[index]), value = args[index + 1];
    if (!name || Object.hasOwn(selected, name) || typeof value !== "string" || !value || value.startsWith("--")) fail("TEXT_CLONE_USAGE");
    selected[name] = value;
  }
  if (selected.privatePathMode !== "linux-dirfd" || !selected.privateDirectory.startsWith("/") || selected.privateDirectory === "/"
    || selected.privateDirectory.length > 4096 || resolve(selected.privateDirectory) !== selected.privateDirectory
    || /[\\\x00-\x1f\x7f]/.test(selected.privateDirectory) || inside(selected.privateDirectory, REPOSITORY)
    || !/^[a-zA-Z0-9_]{1,64}$/.test(selected.database) || selected.confirmation !== selected.database
    || !/^[a-zA-Z0-9_]{1,80}$/.test(selected.user) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}\.sql\.gz$/.test(selected.backup)
    || !/^[a-f0-9]{64}$/.test(selected.backupSha256)) fail("TEXT_CLONE_USAGE");
  return Object.fromEntries(FIELDS.map((name) => [name, selected[name]]));
}

export async function readFrozenBackup(scope, selected) {
  let handle, bytes, gunzip;
  try {
    await scope.assertReady();
    handle = await open(scope.file(selected.backup), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true }); regular(before);
    if (before.size < 1n || before.size > BigInt(MAX_ARCHIVE)) fail("TEXT_CLONE_BACKUP");
    bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
    while (length < bytes.length) { const read = await handle.read(bytes, length, bytes.length - length, length); if (!read.bytesRead) break; length += read.bytesRead; }
    if (BigInt(length) !== before.size) fail("TEXT_CLONE_BACKUP");
    const after = await handle.stat({ bigint: true }); regular(after); unchanged(before, after);
    const visible = await lstat(scope.file(selected.backup), { bigint: true }); regular(visible); unchanged(after, visible);
    await scope.assertReady();
    if (digest(bytes.subarray(0, length)) !== selected.backupSha256) fail("TEXT_CLONE_BACKUP");
    const hash = createHash("sha256"); let sqlBytes = 0;
    gunzip = Readable.from([bytes.subarray(0, length)]).pipe(createGunzip());
    for await (const chunk of gunzip) {
      sqlBytes += chunk.length; if (sqlBytes > MAX_SQL) { chunk.fill(0); fail("TEXT_CLONE_BACKUP"); }
      hash.update(chunk); chunk.fill(0);
    }
    if (sqlBytes < 1) fail("TEXT_CLONE_BACKUP");
    return { backupBytes: length, backupSha256: selected.backupSha256, sqlBytes, sqlSha256: hash.digest("hex"), stats: after };
  } catch { fail("TEXT_CLONE_BACKUP"); }
  finally { gunzip?.destroy(); bytes?.fill(0); await handle?.close(); }
}

export async function inspectDumpClient() {
  try { await readFile(CA, "utf8"); await import("mariadb"); } catch { fail("TEXT_CLONE_CLIENT"); }
  const output = await new Promise((yes, no) => execFile(CLIENT, ["--no-defaults", "--version"], {
    env: PROCESS_ENV, encoding: "utf8", timeout: 5000, maxBuffer: 8192,
  }, (error, stdout) => error ? no(new TextCloneVerificationError("TEXT_CLONE_CLIENT")) : yes(stdout)));
  if (!/\bDistrib 10\.11\.14(?:\b|-)/.test(output)) fail("TEXT_CLONE_CLIENT");
}

function optionValue(value) {
  if (typeof value !== "string" || !value || !value.isWellFormed() || /[\x00-\x1f\x7f]/.test(value)) fail("TEXT_CLONE_CONFIGURATION");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
async function visibleConfig(scope, canonical, name, expected) {
  await scope.assertReady();
  if (await realpath(canonical) !== canonical) fail("TEXT_CLONE_DUMP");
  const root = await lstat(canonical, { bigint: true }), pinned = await scope.assertReady();
  if (root.dev !== pinned.dev || root.ino !== pinned.ino || root.uid !== pinned.uid || root.mode !== pinned.mode) fail("TEXT_CLONE_DUMP");
  const stats = await lstat(`${canonical}/${name}`, { bigint: true }); regular(stats); unchanged(expected, stats);
}

export async function dumpCloneSql(scope, selected, configuration, password, { spawnClient = spawn, signal, onSqlChunk } = {}) {
  const name = `.text-clone-${randomBytes(16).toString("hex")}.cnf`;
  // Retain only a bounded diagnostic in memory. The native text can contain
  // private identities and is never attached to the public error or report.
  const diagnostic = Buffer.alloc(8192);
  let handle, identity, written, content, result, failure;
  try {
    if (onSqlChunk !== undefined && typeof onSqlChunk !== "function") fail("TEXT_CLONE_DUMP");
    if (signal?.aborted) fail("TEXT_CLONE_CANCELLED");
    const canonical = await realpath(scope.path);
    content = Buffer.from(`[client]\nhost=${optionValue(configuration.host)}\nport=${configuration.port}\nuser=${optionValue(selected.user)}\npassword=${optionValue(password)}\n`, "utf8");
    await scope.assertReady();
    handle = await open(scope.file(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    identity = await handle.stat({ bigint: true }); await handle.chmod(0o600); regular(await handle.stat({ bigint: true }));
    await handle.writeFile(content); await handle.sync(); written = await handle.stat({ bigint: true }); regular(written);
    if (written.dev !== identity.dev || written.ino !== identity.ino || written.size !== BigInt(content.length)) fail("TEXT_CLONE_DUMP");
    await handle.close(); handle = null; await scope.sync(); await visibleConfig(scope, canonical, name, written);
    result = await new Promise((yes, no) => {
      let child, timer, failed = false, sqlBytes = 0, errors = 0;
      const hash = createHash("sha256");
      const reject = () => { failed = true; try { child?.kill("SIGKILL"); } catch {} };
      try {
        child = spawnClient(CLIENT, [`--defaults-file=${canonical}/${name}`, ...DUMP_FLAGS,
          "--protocol=TCP", `--ssl-ca=${CA}`, "--ssl-verify-server-cert", selected.database], {
          env: PROCESS_ENV, stdio: ["ignore", "pipe", "pipe"],
        });
        timer = setTimeout(reject, 90000);
        signal?.addEventListener("abort", reject, { once: true });
        if (signal?.aborted) reject();
        child.stdout.on("data", (chunk) => {
          try {
            sqlBytes += chunk.length;
            if (sqlBytes > MAX_SQL) reject();
            else if (!failed) {
              hash.update(chunk);
              // A private sink must consume/copy bytes synchronously: this
              // buffer is erased as soon as the callback returns.
              if (onSqlChunk !== undefined && onSqlChunk(chunk) !== undefined) reject();
            }
          } catch { reject(); }
          finally { chunk.fill(0); }
        });
        child.stderr.on("data", (chunk) => {
          if (errors < diagnostic.length) chunk.copy(diagnostic, errors, 0, Math.min(chunk.length, diagnostic.length - errors));
          errors += chunk.length; chunk.fill(0); if (errors > diagnostic.length) reject();
        });
        child.stdout.on("error", reject); child.stderr.on("error", reject); child.once("error", reject);
        child.once("close", (code, signal) => {
          clearTimeout(timer);
          if (failed || code !== 0 || signal || sqlBytes < 1) {
            let failureCode = "TEXT_CLONE_DUMP";
            if (!failed && code !== 0 && !signal) {
              const native = /\b(?:Got error|ERROR)\s*:?\s*([0-9]{4})\b/i.exec(diagnostic.toString("ascii", 0, errors));
              const number = Number(native?.[1]);
              if (number === 1045) failureCode = "TEXT_CLONE_AUTHENTICATION";
              else if ([1044, 1142].includes(number)) failureCode = "TEXT_CLONE_ACCESS";
              else if (number === 1049) failureCode = "TEXT_CLONE_DATABASE";
            }
            no(new TextCloneVerificationError(failureCode));
          }
          else yes({ sqlBytes, sqlSha256: hash.digest("hex") });
        });
        child.once("close", () => signal?.removeEventListener("abort", reject));
      } catch { clearTimeout(timer); signal?.removeEventListener("abort", reject); reject(); no(new TextCloneVerificationError("TEXT_CLONE_DUMP")); }
    });
    await visibleConfig(scope, canonical, name, written);
  } catch (error) { failure = error instanceof TextCloneVerificationError ? error : new TextCloneVerificationError("TEXT_CLONE_DUMP"); }
  finally {
    diagnostic.fill(0);
    content?.fill(0);
    try { await handle?.close(); } catch { failure = new TextCloneVerificationError("TEXT_CLONE_CLEANUP"); }
    try {
      if (identity) {
        const current = await lstat(scope.file(name), { bigint: true }); regular(current);
        if (current.dev !== identity.dev || current.ino !== identity.ino) fail("TEXT_CLONE_CLEANUP");
        await unlink(scope.file(name)); await scope.sync();
      }
    } catch { failure = new TextCloneVerificationError("TEXT_CLONE_CLEANUP"); }
  }
  if (failure) { if (signal?.aborted && failure.code !== "TEXT_CLONE_CLEANUP") fail("TEXT_CLONE_CANCELLED"); throw failure; }
  return result;
}

export async function inspectClone(connection, database) {
  const identity = await connection.query("SELECT DATABASE() AS name, VERSION() AS version");
  if (identity.length !== 1 || identity[0]?.name !== database || !/^10\.11\.[0-9]+.*MariaDB|^11\.[0-9]+\.[0-9]+.*MariaDB/.test(identity[0]?.version ?? "")) fail("TEXT_CLONE_DATABASE");
  const cipher = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  if (cipher.length !== 1 || !cipher[0]?.Value || cipher[0]?.Variable_name !== "Ssl_cipher") fail("TEXT_CLONE_DATABASE");
  const migrations = await loadMigrations(), names = [...createdMigrationTables(migrations), "schema_migrations"];
  const tables = await connection.query("SELECT TABLE_NAME AS name, TABLE_TYPE AS kind, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME LIMIT 31", [database]);
  if (migrations.length !== 30 || names.length !== 30 || tables.length !== 30 || new Set(tables.map((row) => row.name)).size !== 30
    || tables.some((row) => !names.includes(row.name) || row.kind !== "BASE TABLE" || row.engine !== "InnoDB")) fail("TEXT_CLONE_SCHEMA");
  const ledger = await connection.query("SELECT version, name, checksum, state, attempts FROM schema_migrations ORDER BY version LIMIT 31");
  try {
    if (ledger.length !== migrations.length || inspectHistory(migrations, ledger).some((row) => row.state !== "applied")) fail("TEXT_CLONE_SCHEMA");
  } catch { fail("TEXT_CLONE_SCHEMA"); }
  const foreign = await connection.query("SELECT REFERENCED_TABLE_SCHEMA AS parent_schema FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL LIMIT 1001", [database]);
  if (foreign.length > 1000 || foreign.some((row) => row.parent_schema !== database)) fail("TEXT_CLONE_SCHEMA");
  return { tables: tables.length, migrations: ledger.length };
}

export async function run(value, { inheritedEnv = process.env, execArgv = process.execArgv, inputStream = process.stdin,
  scopeOperation = withPrivateDirectory, readBundle = readRuntimeMessagingBundle, readBackup = readFrozenBackup,
  inspectClient = inspectDumpClient, readSecret = readPassword, dump = dumpCloneSql, connect = connectDatabase,
  inspect = inspectClone, verify = verifyTextBackupData, signal } = {}) {
  let source, database, authentication, messaging, password = "", keys, env, connection, transaction = false, result, failure;
  const active = () => { if (signal?.aborted) fail("TEXT_CLONE_CANCELLED"); };
  try {
    active();
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length
      || Object.getOwnPropertyNames(value).sort().join(",") !== [...FIELDS].sort().join(",")
      || FIELDS.some((name) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, "value"))) fail("TEXT_CLONE_USAGE");
    const selected = parseArguments([value.command, "--private-directory", value.privateDirectory, "--private-path-mode", value.privatePathMode,
      "--database", value.database, "--confirm-database", value.confirmation, "--user", value.user, "--backup", value.backup, "--backup-sha256", value.backupSha256]);
    try { privateAuthenticationProcessOptions(inheritedEnv, execArgv); } catch { fail("TEXT_CLONE_ENVIRONMENT"); }
    source = await readBundle(selected.privateDirectory);
    database = validateRuntimeDatabaseConfiguration(source?.database); authentication = validateRuntimeAuthenticationConfiguration(source?.authentication);
    messaging = validateRuntimeMessagingConfiguration(source?.messaging);
    if (selected.database === database.database || selected.user === database.user || authentication.origin !== messaging.origin
      || [messaging.mailKey, messaging.messageKey].includes(authentication.mfaKey)) fail("TEXT_CLONE_CONFIGURATION");
    await scopeOperation(selected.privateDirectory, async (scope) => {
      if (inside(await realpath(scope.path), await realpath(REPOSITORY))) fail("TEXT_CLONE_CONFIGURATION");
      const backup = await readBackup(scope, selected); await inspectClient(); active();
      if (selected.command === "check") { result = { status: "ready_for_input", backupBytes: backup.backupBytes, sqlBytes: backup.sqlBytes,
        backupSha256: backup.backupSha256, sqlSha256: backup.sqlSha256, databaseConnected: false }; return; }
      try { password = await readSecret(inputStream); optionValue(password); if (Buffer.byteLength(password, "utf8") > 4096) fail("TEXT_CLONE_PASSWORD"); }
      catch { fail("TEXT_CLONE_PASSWORD"); }
      active(); const dumped = await dump(scope, selected, database, password, { signal }); active();
      if (dumped.sqlSha256 !== backup.sqlSha256 || dumped.sqlBytes !== backup.sqlBytes) fail("TEXT_CLONE_DUMP_MISMATCH");
      env = { JESSIEMESSAGE_DB_HOST: database.host, JESSIEMESSAGE_DB_PORT: database.port, JESSIEMESSAGE_DB_NAME: selected.database,
        JESSIEMESSAGE_MIGRATION_DATABASE: selected.confirmation, JESSIEMESSAGE_DB_USER: selected.user, JESSIEMESSAGE_DB_PASSWORD: password,
        JESSIEMESSAGE_DB_TLS_CA_PATH: CA };
      connection = await connect(env); active();
      await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      transaction = true; await connection.query("START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT");
      const schema = await inspect(connection, selected.database);
      keys = { totpKey: Buffer.from(authentication.mfaKey, "base64url"), mailKey: Buffer.from(messaging.mailKey, "base64url"), messageKey: Buffer.from(messaging.messageKey, "base64url") };
      const pool = { getConnection: async () => ({ query: (sql, parameters) => {
        if (typeof sql !== "string" || !/^SELECT\s/i.test(sql) || /\b(?:INTO|OUTFILE|DUMPFILE|FOR\s+UPDATE)\b/i.test(sql)) fail("TEXT_CLONE_DATABASE");
        return connection.query(sql, parameters);
      }, release: async () => {} }) };
      const report = await verify({ pool, keys, signal }); active();
      if (report?.complete !== true || report.healthy !== true || report.issues?.length !== 0) fail("TEXT_CLONE_CRYPTO");
      const countNames = ["rows", "mfa", "mail", "reset", "messages", "crm", "broadcast", "broadcastRecipients", "media", "mediaFiles"];
      if (countNames.some((name) => !Number.isSafeInteger(report.counts?.[name]) || report.counts[name] < 0)) fail("TEXT_CLONE_CRYPTO");
      result = { status: "verified", tables: schema.tables, migrations: schema.migrations, backupBytes: backup.backupBytes,
        sqlBytes: backup.sqlBytes, backupSha256: backup.backupSha256, sqlSha256: backup.sqlSha256,
        counts: Object.fromEntries(countNames.map((name) => [name, report.counts[name]])), httpStarted: false, smtpStarted: false };
      const final = await readBackup(scope, selected);
      if (final.sqlSha256 !== backup.sqlSha256 || final.sqlBytes !== backup.sqlBytes) fail("TEXT_CLONE_BACKUP");
      active();
    });
  } catch (error) { failure = error instanceof TextCloneVerificationError ? error : new TextCloneVerificationError("TEXT_CLONE_OPERATION"); }
  finally {
    try { if (transaction) await connection?.rollback(); } catch { failure = new TextCloneVerificationError("TEXT_CLONE_CLEANUP"); }
    try { await connection?.end(); } catch { failure = new TextCloneVerificationError("TEXT_CLONE_CLEANUP"); }
    password = ""; if (env) env.JESSIEMESSAGE_DB_PASSWORD = "";
    for (const key of Object.values(keys ?? {})) key.fill(0);
    for (const record of [database, authentication, messaging]) clearRuntimeMessagingSecrets(record);
    if (readBundle === readRuntimeMessagingBundle && source) for (const name of ["database", "authentication", "messaging"]) clearRuntimeMessagingSecrets(Object.getOwnPropertyDescriptor(source, name)?.value);
  }
  if (failure) throw failure;
  active();
  return result;
}

export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  const result = await run(parseArguments(args), dependencies); outputStream.write(`${JSON.stringify(result)}\n`); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController(), cancel = () => cancellation.abort();
  process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  try { await main(process.argv.slice(2), { signal: cancellation.signal }); }
  catch (error) {
    process.stderr.write(`${error instanceof TextCloneVerificationError ? error.code : "TEXT_CLONE_OPERATION"}: Text clone verification was not confirmed.\n`);
    process.exitCode = 1;
  }
  finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
