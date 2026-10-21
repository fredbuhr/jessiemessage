import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { gzipSync } from "node:zlib";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { parseArguments, validateApplicationSql, readApplicationSql, inspectEmptyClone, importNativeSql, run, main } from "../scripts/import-application-checkpoint.mjs";

const tables = [...createdMigrationTables(await loadMigrations()), "schema_migrations"].sort();
const sql = Buffer.from("/*!999999\\- enable the sandbox mode */\n"
  + "/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;\n"
  + "/*!40101 SET NAMES utf8mb4 */;\n"
  + "/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;\n"
  + "/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;\n"
  + tables.map(name => `CREATE TABLE \`${name}\` (\`id\` int NOT NULL, \`label\` varchar(100) DEFAULT NULL) ENGINE=InnoDB;\n`
    + `/*!40000 ALTER TABLE \`${name}\` DISABLE KEYS */;\n`
    + `INSERT INTO \`${name}\` VALUES (1,'private value; USE another; \\\' \\\\'),(2,NULL);\n`
    + `/*!40000 ALTER TABLE \`${name}\` ENABLE KEYS */;\n`).join("")
  + "/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;\n");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const archive = gzipSync(sql), expected = { backupBytes: archive.length, backupSha256: digest(archive), sqlBytes: sql.length, sqlSha256: digest(sql) };
const env = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" };
const base = fileURLToPath(new URL("../../audit/", import.meta.url));
const args = command => [command, "--private-directory", "/private/source", "--private-path-mode", "linux-dirfd", "--checkpoint-directory", "/private/checkpoint", "--database", "only_clone", "--confirm-database", "only_clone", "--user", "clone_operator", "--sql-sha256", expected.sqlSha256];
const neutral = code => error => { assert.equal(error.code, `APPLICATION_CHECKPOINT_IMPORT_${code}`); assert.equal(error.message, error.code); assert.equal(error.cause, undefined); assert.doesNotMatch(JSON.stringify(error), /private value|synthetic password|example\.invalid/); return true; };
const ready = () => ({ status: "ready_for_input", checkpointFilesMatched: true, databaseConnected: false, tables: 32, migrations: 32, ...expected });
const verified = () => ({ status: "verified", applicationSnapshotMatched: true, checkpointFilesMatched: true, databaseConnected: true, capacityRebound: false, tables: 32, migrations: 32 });

async function fixture(t) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(base, "application-import-")); await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const scope = { path: directory, file: name => join(directory, name), assertReady: () => lstat(directory, { bigint: true }), sync: async () => {} };
  await writeFile(join(directory, "database.sql.gz"), archive, { mode: 0o600 });
  return { directory, scope };
}

function dependencies(events, overrides = {}) {
  const source = { JESSIEMESSAGE_DB_NAME: "only_source", JESSIEMESSAGE_RUNTIME_DB_USER: "source_runtime", JESSIEMESSAGE_DB_HOST: "sql.example.invalid", JESSIEMESSAGE_DB_PORT: "3306", JESSIEMESSAGE_MESSAGE_KEY: "synthetic secret" };
  return { inheritedEnv: env, execArgv: [],
    verify: async (selected, options) => { events.push(selected.command); if (selected.command === "check-application") return ready(); assert.equal(await options.readSecret(), "synthetic password"); return verified(); },
    loadEnvironment: async () => { events.push("load"); return source; },
    inspectClient: async () => events.push("client"),
    scopeOperation: async (_directory, operation) => operation({}),
    readSql: async () => { events.push("sql"); return Buffer.from(sql); },
    readSecret: async () => { events.push("password"); return "synthetic password"; },
    connect: async configuration => { events.push("connect"); assert.equal(configuration.JESSIEMESSAGE_DB_NAME, "only_clone"); assert.equal(configuration.JESSIEMESSAGE_DB_TLS_CA_PATH, "/etc/ssl/certs/ca-certificates.crt"); return { end: async () => events.push("close") }; },
    inspect: async (_connection, database) => { assert.equal(database, "only_clone"); events.push("empty"); },
    importSql: async (_scope, selected, _configuration, password, bytes) => { events.push("import"); assert.equal(selected.database, "only_clone"); assert.equal(password, "synthetic password"); assert.deepEqual(bytes, sql); },
    ...overrides,
  };
}

test("only the explicit check/restore interface and exact database confirmation are accepted", () => {
  assert.equal(parseArguments(args("check")).command, "check-application");
  assert.equal(parseArguments(args("restore")).command, "verify-application");
  for (const command of ["verify", "import", "restore-all", undefined]) assert.throws(() => parseArguments(args(command)), neutral("USAGE"));
  const altered = args("restore"); altered[10] = "other"; assert.throws(() => parseArguments(altered), neutral("USAGE"));
  assert.throws(() => parseArguments(args("restore").slice(0, -2)), neutral("USAGE"));
  const upperHash = args("restore"); upperHash[14] = expected.sqlSha256.toUpperCase(); assert.throws(() => parseArguments(upperHash), neutral("USAGE"));
});

test("the optional recovery profile is closed and absent from every legacy option record", async () => {
  const legacy = parseArguments(args("check")); assert.equal(Object.hasOwn(legacy, "profile"), false);
  const selected = parseArguments([...args("check"), "--profile", "photos-notify-recovery"]);
  assert.deepEqual(selected, { ...legacy, profile: "photos-notify-recovery" });
  for (const profile of ["photos-notify", "photos-notify-recovery-application", "full", undefined])
    assert.throws(() => parseArguments([...args("check"), "--profile", profile]), neutral("USAGE"));
  assert.throws(() => parseArguments([...args("check"), "--profile", "photos-notify-recovery", "--profile", "photos-notify-recovery"]), neutral("USAGE"));
  let getter = false;
  Object.defineProperty(legacy, "profile", { get() { getter = true; throw new Error("private profile"); } });
  await assert.rejects(run(legacy, dependencies([])), neutral("USAGE")); assert.equal(getter, false);
});

for (const { crm, broadcast = false } of [{ crm: false }, { crm: true }, { crm: true, broadcast: true }]) test(`${broadcast ? "broadcast, CRM and recovery" : crm ? "CRM and recovery" : "recovery"} restore carries its exact profile through all checks without activating a runtime`, async () => {
  const events = [], selections = [];
  const selectedProfile = `photos-notify-recovery${crm ? "-crm" : ""}${broadcast ? "-broadcast" : ""}`;
  const profile = { version: broadcast ? 8 : crm ? 6 : 4, profile: `messaging-${selectedProfile}-application` };
  const original = dependencies(events);
  const result = await run(parseArguments([...args("restore"), "--profile", selectedProfile]), { ...original,
    verify: async (selected, options) => {
      selections.push(selected); assert.equal(selected.profile, selectedProfile);
      return { ...await original.verify(selected, options), ...profile };
    },
    loadEnvironment: async (directory, options) => {
      assert.equal(directory, "/private/source"); assert.deepEqual(options, { port: "3000", originProfile: "primary", recovery: true });
      return { ...await original.loadEnvironment(), JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "0" };
    },
    importSql: async (...parameters) => { assert.equal(parameters[1].profile, selectedProfile); return original.importSql(...parameters); },
  });
  assert.equal(result.profile, profile.profile); assert.equal(result.version, profile.version); assert.equal(result.status, "application_checkpoint_restored_verified");
  assert.equal(selections.length, 3); assert.deepEqual(events, ["check-application", "client", "sql", "load", "password", "connect", "empty", "close", "check-application", "import", "verify-application"]);
});

for (const { crm, broadcast = false } of [{ crm: false }, { crm: true }, { crm: true, broadcast: true }]) test(`${broadcast ? "broadcast, CRM and recovery" : crm ? "CRM and recovery" : "recovery"} restoration cannot downgrade its verified precheck or final receipt`, async () => {
  for (const stage of ["precheck", "final"]) {
    const events = [], original = dependencies(events);
    const selectedProfile = `photos-notify-recovery${crm ? "-crm" : ""}${broadcast ? "-broadcast" : ""}`;
    await assert.rejects(run(parseArguments([...args("restore"), "--profile", selectedProfile]), { ...original,
      verify: async (selected, options) => {
        const report = await original.verify(selected, options);
        return stage === "precheck" || selected.command === "verify-application" ? { ...report, version: 2, profile: "messaging-photos-notify-application" }
          : { ...report, version: broadcast ? 8 : crm ? 6 : 4, profile: `messaging-${selectedProfile}-application` };
      },
    }), neutral(stage === "precheck" ? "CHECKPOINT" : "VERIFY"));
    assert.equal(events.includes("import"), stage === "final");
  }
});

test("the closed SQL format accepts native conditional SET/ALTER and opaque string contents for all thirty-two tables", async () => {
  assert.deepEqual(await validateApplicationSql(sql), { tables: 32 });
  assert.deepEqual(await validateApplicationSql(Buffer.from(sql.toString().replace("/*!999999", "/*M!999999"))), { tables: 32 });
});

test("SQL database switches, qualified targets/references, executable routines and native commands are refused", async () => {
  const first = tables[0], candidates = [
    Buffer.concat([sql, Buffer.from("USE only_source;\n")]),
    Buffer.concat([sql, Buffer.from("/*!50000 USE only_source */;\n")]),
    Buffer.concat([sql, Buffer.from("CREATE DATABASE another;\n")]),
    Buffer.concat([sql, Buffer.from("\\! echo private\n")]),
    Buffer.concat([sql, Buffer.from("LOAD DATA LOCAL INFILE '/private' INTO TABLE users;\n")]),
    Buffer.concat([sql, Buffer.from("SET GLOBAL SQL_MODE='';\n")]),
    Buffer.concat([sql, Buffer.from("SET SQL_MODE=(SELECT private FROM only_source.users);\n")]),
    Buffer.from(sql.toString().replace("SQL_MODE='NO_AUTO_VALUE_ON_ZERO'", "SQL_MODE='NO_BACKSLASH_ESCAPES'")),
    Buffer.from(sql.toString().replace("SQL_MODE='NO_AUTO_VALUE_ON_ZERO'", "SQL_MODE='ANSI_QUOTES'")),
    Buffer.from(sql.toString().replace("SQL_MODE='NO_AUTO_VALUE_ON_ZERO'", "SQL_MODE=@OLD_SQL_MODE")),
    Buffer.from(sql.toString().replace(`CREATE TABLE \`${first}\``, `CREATE TABLE \`only_source\`.\`${first}\``)),
    Buffer.from(sql.toString().replace("ENGINE=InnoDB", "ENGINE=InnoDB AS SELECT * FROM users")),
    Buffer.from(sql.toString().replace("ENGINE=InnoDB", "REFERENCES `only_source`.`users` (`id`) ENGINE=InnoDB")),
    Buffer.from(sql.toString().replace(`INSERT INTO \`${first}\` VALUES`, `INSERT INTO \`${first}\` SELECT`)),
    Buffer.from(sql.toString().replace(`CREATE TABLE \`${first}\``, "CREATE TABLE `unrelated_table`")),
  ];
  for (const candidate of candidates) await assert.rejects(validateApplicationSql(candidate), neutral("SQL"));
  await assert.rejects(validateApplicationSql(Buffer.from("CREATE TABLE `users` (`id` int);")), neutral("SQL"));
});

test("only pinned private Gzip bytes matching both authenticated hashes produce validated in-memory SQL", async t => {
  const f = await fixture(t), bytes = await readApplicationSql(f.scope, expected);
  assert.deepEqual(bytes, sql); bytes.fill(0);
  await assert.rejects(readApplicationSql(f.scope, { ...expected, sqlSha256: "0".repeat(64) }), neutral("CHECKPOINT"));
  await chmod(join(f.directory, "database.sql.gz"), 0o644);
  await assert.rejects(readApplicationSql(f.scope, expected), neutral("CHECKPOINT"));
});

test("a TLS connection to the exact target must observe no table or view before any import", async () => {
  const connection = ({ name = "only_clone", cipher = "TLS_AES_256_GCM_SHA384", tables = [] } = {}) => ({ query: async statement => statement.startsWith("SELECT DATABASE") ? [{ name }] : statement.startsWith("SHOW SESSION") ? [{ Variable_name: "Ssl_cipher", Value: cipher }] : tables });
  await inspectEmptyClone(connection(), "only_clone");
  await assert.rejects(inspectEmptyClone(connection({ name: "only_source" }), "only_clone"), neutral("DATABASE"));
  await assert.rejects(inspectEmptyClone(connection({ cipher: "" }), "only_clone"), neutral("DATABASE"));
  for (const name of ["users", "synthetic_view"]) await assert.rejects(inspectEmptyClone(connection({ tables: [{ name }] }), "only_clone"), neutral("NOT_EMPTY"));
});

function nativeSpawn(observed, { code = 0, inspect = async () => {}, hang = false } = {}) {
  return (command, argv, options) => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const chunks = []; child.stdin.on("data", chunk => chunks.push(Buffer.from(chunk)));
    child.kill = () => { child.emit("close", null, "SIGKILL"); return true; };
    child.stdin.on("finish", () => setImmediate(async () => {
      try { await inspect(argv); observed.push({ command, argv, options, bytes: Buffer.concat(chunks) }); if (!hang) { child.stderr.end(code ? "ERROR synthetic private detail" : ""); child.stdout.end(); child.emit("close", code, null); } }
      catch (error) { child.emit("error", error); child.emit("close", 1, null); }
    }));
    return child;
  };
}

test("the native importer pins a temporary 0600 password config, uses fixed TLS/sandbox args and a clean environment, then removes it", async t => {
  const f = await fixture(t), observed = [];
  await importNativeSql(f.scope, { database: "only_clone", user: "clone_operator" }, { host: "sql.example.invalid", port: "3306" }, "synthetic password", sql, { spawnClient: nativeSpawn(observed, { inspect: async argv => {
    const filename = argv[0].slice("--defaults-file=".length); assert.equal((await lstat(filename)).mode & 0o7777, 0o600);
    assert.match(await readFile(filename, "utf8"), /password="synthetic password"/);
  } }) });
  assert.equal(observed[0].command, "/usr/bin/mariadb");
  assert.deepEqual(observed[0].argv.slice(1), ["--protocol=TCP", "--ssl-ca=/etc/ssl/certs/ca-certificates.crt", "--ssl-verify-server-cert", "--sandbox", "--local-infile=0", "--skip-reconnect", "--database=only_clone"]);
  assert.deepEqual(observed[0].options, { env: { PATH: "/usr/bin:/bin", HOME: "/", LANG: "C", LC_ALL: "C" }, stdio: ["pipe", "pipe", "pipe"] });
  assert.doesNotMatch(JSON.stringify({ argv: observed[0].argv, options: observed[0].options }), /synthetic password|example\.invalid|--force|MYSQL_PWD/);
  assert.deepEqual(observed[0].bytes, sql); assert.deepEqual(await readdir(f.directory), ["database.sql.gz"]);
});

test("native failure, timeout and cancellation remain neutral, remove credentials and never report success", async t => {
  const f = await fixture(t), parameters = [f.scope, { database: "only_clone", user: "clone_operator" }, { host: "sql.example.invalid", port: "3306" }, "synthetic password", sql];
  await assert.rejects(importNativeSql(...parameters, { spawnClient: nativeSpawn([], { code: 1 }) }), neutral("IMPORT"));
  await assert.rejects(importNativeSql(...parameters, { spawnClient: nativeSpawn([], { hang: true }), timeoutMs: 10 }), neutral("IMPORT"));
  const cancellation = new AbortController(); cancellation.abort();
  await assert.rejects(importNativeSql(...parameters, { signal: cancellation.signal, spawnClient() { assert.fail("cancelled operation must not spawn"); } }), neutral("CANCELLED"));
  assert.deepEqual(await readdir(f.directory), ["database.sql.gz"]);
});

test("precheck validates native tools and SQL format without password or database connection", async () => {
  const events = [], result = await run(parseArguments(args("check")), dependencies(events));
  assert.equal(result.status, "application_restore_precheck_passed"); assert.equal(result.imported, false);
  assert.equal(result.nativeImportClientVerified, true); assert.equal(result.sqlImportFormatVerified, true);
  assert.equal(result.trustedSqlSha256Matched, true);
  assert.deepEqual(events, ["check-application", "client", "sql"]);
});

test("an independently pinned SQL hash rejects a rewritten receipt/hash before password, SQL access or import", async () => {
  const events = [];
  await assert.rejects(run(parseArguments(args("restore")), dependencies(events, { verify: async () => ({ ...ready(), sqlSha256: "0".repeat(64) }) })), neutral("CHECKPOINT"));
  assert.deepEqual(events, []);
  await assert.rejects(run(parseArguments(args("restore")), dependencies(events, { readSql: async () => Buffer.from("tampered SQL") })), neutral("CHECKPOINT"));
  assert.deepEqual(events, ["check-application", "client"]);
});

test("the personal one-password wrapper has valid shell syntax and no exported password or native inline secret", async () => {
  const wrapper = fileURLToPath(new URL("../scripts/capture-application-checkpoint-restore.sh", import.meta.url));
  execFileSync("bash", ["-n", wrapper]);
  const content = await readFile(wrapper, "utf8");
  assert.match(content, /read -r -s/); assert.match(content, /unset JM_APPLICATION_RESTORE_PASSWORD/);
  assert.doesNotMatch(content, /export .*PASSWORD|MYSQL_PWD|--password=/);
});

test("one in-memory password drives an empty-clone native import and final signed snapshot verification in order", async () => {
  const events = [], result = await run(parseArguments(args("restore")), dependencies(events));
  assert.equal(result.status, "application_checkpoint_restored_verified"); assert.equal(result.imported, true); assert.equal(result.applicationSnapshotMatched, true); assert.equal(result.sourceMutated, false);
  assert.deepEqual(events, ["check-application", "client", "sql", "load", "password", "connect", "empty", "close", "check-application", "import", "verify-application"]);
  assert.equal(events.filter(value => value === "password").length, 1);
});

test("source database and runtime identity are refused before reading the password or opening SQL", async () => {
  for (const source of [{ JESSIEMESSAGE_DB_NAME: "ONLY_CLONE", JESSIEMESSAGE_RUNTIME_DB_USER: "source_runtime" }, { JESSIEMESSAGE_DB_NAME: "only_source", JESSIEMESSAGE_RUNTIME_DB_USER: "clone_operator" }]) {
    const events = [];
    await assert.rejects(run(parseArguments(args("restore")), dependencies(events, { loadEnvironment: async () => source })), neutral("CONFIGURATION"));
    assert.deepEqual(events, ["check-application", "client", "sql"]);
  }
});

test("a nonempty target, changed checkpoint, failed native import or incomplete final verification cannot publish a success receipt", async () => {
  let checkpointReads = 0;
  const cases = [
    { inspect: async () => { throw Object.assign(new Error("blocked"), { code: "not empty" }); } },
    { verify: async selected => {
      if (selected.command !== "check-application") assert.fail("a changed checkpoint must refuse before final verification");
      checkpointReads++;
      return checkpointReads === 1 ? ready() : { ...ready(), sqlSha256: "0".repeat(64) };
    } },
    { importSql: async () => { throw new Error("synthetic password private details"); } },
    { verify: async selected => selected.command === "check-application" ? ready() : { ...verified(), applicationSnapshotMatched: false } },
  ];
  for (const overrides of cases) {
    const events = [], output = [];
    await assert.rejects(main(args("restore"), { ...dependencies(events, overrides), outputStream: { write: value => output.push(value) } }));
    assert.deepEqual(output, []);
    if (overrides === cases[1]) { assert.equal(checkpointReads, 2); assert.equal(events.includes("import"), false); }
  }
});
