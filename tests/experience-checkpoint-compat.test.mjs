import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPERIENCE_APPLICATION_COVERAGE, VIDEO_APPLICATION_COVERAGE } from "../server/backup/application-scope.mjs";
import { createdMigrationTables } from "../server/db/migrations.mjs";
import { loadExperienceMigrations } from "../server/experience/migrations.mjs";
import { readCheckpointReceipt, writeCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";
import { parseArguments as captureArguments } from "../scripts/private-checkpoint.mjs";
import { parseArguments as verifyArguments } from "../scripts/verify-private-checkpoint.mjs";
import { parseArguments as importArguments, validateApplicationSql, run as importRun } from "../scripts/import-application-checkpoint.mjs";
import { parseArguments as resumeArguments, inspectResumeClone, run as resumeRun } from "../scripts/resume-application-checkpoint.mjs";

const profile = "photos-notify-recovery-crm-broadcast-video";
const manifestProfile = `messaging-${profile}-application`;
const plan = await loadExperienceMigrations(), names = [...createdMigrationTables(plan), "schema_migrations"].sort();
const sql = Buffer.from("SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';\n" + names.map(name => `CREATE TABLE \`${name}\` (\`id\` INT NOT NULL) ENGINE=InnoDB;\n`).join(""));
const digest = bytes => createHash("sha256").update(bytes).digest("hex"), hash = digest(sql);
const inheritedEnv = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" };
const commonArgs = ["--private-directory", "/synthetic/source", "--private-path-mode", "linux-dirfd", "--checkpoint-directory", "/synthetic/checkpoint",
  "--database", "isolated_copy", "--confirm-database", "isolated_copy", "--user", "copy_operator", "--profile", profile];
const captureArgs = ["check-application", "--private-directory", "/synthetic/source", "--private-path-mode", "linux-dirfd",
  "--destination-private-directory", "/synthetic/checkpoint", "--profile", profile];
const report = () => ({ version: 11, profile: manifestProfile, coverage: { ...EXPERIENCE_APPLICATION_COVERAGE }, tables: 37, migrations: 38,
  sqlSha256: hash, checkpointFilesMatched: true, capacityRebound: false, httpStarted: false, smtpStarted: false, workersStarted: false });
const ready = () => ({ ...report(), status: "ready_for_input", databaseConnected: false });
const precheck = () => ({ ...report(), status: "application_restore_precheck_passed", databaseConnected: false, imported: false,
  nativeImportClientVerified: true, sqlImportFormatVerified: true, trustedSqlSha256Matched: true });
const verified = () => ({ ...report(), status: "verified", databaseConnected: true, applicationSnapshotMatched: true });
const restored = () => ({ ...verified(), status: "application_checkpoint_restored_verified", imported: true, sourceMutated: false });

test("checkpoint entry points accept only paired experience1 on the application video profile", () => {
  const cases = [[captureArguments, captureArgs], [verifyArguments, ["check-application", ...commonArgs]],
    [importArguments, ["check", ...commonArgs, "--sql-sha256", hash]], [resumeArguments, ["resume", ...commonArgs, "--sql-sha256", hash]]];
  for (const [parse, args] of cases) {
    assert.equal(parse([...args, "--experience", "1"]).experience, true);
    assert.equal(Object.hasOwn(parse(args), "experience"), false);
    for (const invalid of [[...args, "--experience"], [...args, "--experience", "0"], [...args, "--experience", "true"],
      [...args, "--experience", "1", "--experience", "1"], args.map(value => value === profile ? "photos-notify-recovery-crm-broadcast" : value).concat("--experience", "1")])
      assert.throws(() => parse(invalid), error => /USAGE$/.test(error.code));
  }
});

test("SQL38 import accepts exactly37 authored tables and never broadens executable SQL or historical SQL36", async () => {
  assert.equal(plan.length, 38); assert.equal(names.length, 37); assert.ok(names.includes("profile_preferences"));
  assert.deepEqual(await validateApplicationSql(sql, { video: true, experience: true }), { tables: 37 });
  for (const options of [{}, { video: true }, { experience: true }, { video: true, experience: "true" }])
    await assert.rejects(validateApplicationSql(sql, options));
  for (const bytes of [Buffer.from(sql.toString().replace(/CREATE TABLE `profile_preferences`[^;]+;\n/, "")),
    Buffer.from(sql.toString().replace("`profile_preferences`", "`unrelated_table`")),
    Buffer.concat([sql, Buffer.from("ALTER TABLE `crm_tasks` ADD `untrusted` INT;\n")]),
    Buffer.concat([sql, Buffer.from("CREATE TRIGGER changed BEFORE INSERT ON users FOR EACH ROW SET @secret=1;\n")]),
    Buffer.concat([sql, Buffer.from("USE another_database;\n")])])
    await assert.rejects(validateApplicationSql(bytes, { video: true, experience: true }), { code: "APPLICATION_CHECKPOINT_IMPORT_SQL" });
});

async function receiptFixture(t) {
  const base = fileURLToPath(new URL("../../audit/", import.meta.url)); await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(base, "experience-checkpoint-")); await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const metadata = Buffer.from('{"synthetic":"experience-manifest"}'); await writeFile(join(directory, "manifest.json"), metadata, { mode: 0o600 });
  return { directory, scope: { file: name => join(directory, name), assertReady: () => lstat(directory), sync: async () => {} },
    value: { format: "jessiemessage-private-checkpoint", version: 11, profile: manifestProfile, coverage: { ...EXPERIENCE_APPLICATION_COVERAGE },
      createdAt: 1792748656772, schema: { tables: 37, migrations: 38 },
      sql: { file: "database.sql.gz", bytes: 120, sha256: "a".repeat(64), uncompressedBytes: sql.length, uncompressedSha256: hash },
      manifest: { file: "manifest.json", sha256: digest(metadata) }, media: { files: [], bytes: 0 }, video: { files: [], bytes: 0 } } };
}

test("the existing video receipt format binds37 tables to38 migrations and refuses contradictory coverage", async t => {
  const f = await receiptFixture(t);
  for (const change of [v => { v.schema.migrations = 37; }, v => { v.schema.tables = 38; }, v => { v.coverage.tables = 36; },
    v => { v.schema = { tables: 36, migrations: 38 }; }, v => { v.coverage.completeDatabase = true; }]) {
    const value = structuredClone(f.value); change(value);
    await assert.rejects(writeCheckpointReceipt(f.scope, value), { code: "CHECKPOINT_RECEIPT_INVALID" });
  }
  assert.deepEqual(await writeCheckpointReceipt(f.scope, f.value), f.value);
  assert.deepEqual(await readCheckpointReceipt(f.scope), f.value);
  assert.equal(await readFile(join(f.directory, "receipt.json"), "utf8"), `${JSON.stringify(f.value)}\n`);
});

test("clone inspection distinguishes the experience graph from36 tables and preserves partial clones", async () => {
  const rows = names.map(name => ({ name, kind: "BASE TABLE", engine: "InnoDB" }));
  const connection = values => ({ async query(statement) {
    assert.match(statement, /^(SELECT|SHOW) /);
    if (statement.startsWith("SELECT DATABASE")) return [{ name: "isolated_copy" }];
    if (statement.startsWith("SHOW")) return [{ Variable_name: "Ssl_cipher", Value: "TLS_AES_256_GCM_SHA384" }];
    return values;
  } });
  assert.equal(await inspectResumeClone(connection(rows), "isolated_copy", { video: true, experience: true }), "application-schema");
  assert.equal(await inspectResumeClone(connection(rows), "isolated_copy", { video: true }), "partial");
  assert.equal(await inspectResumeClone(connection([]), "isolated_copy", { video: true, experience: true }), "empty");
  for (const values of [rows.slice(1), rows.map((row, index) => index ? row : { ...row, kind: "VIEW" }), [...rows, rows[0]],
    rows.map(row => row.name === "profile_preferences" ? { ...row, name: "unrelated_table" } : row)])
    assert.equal(await inspectResumeClone(connection(values), "isolated_copy", { video: true, experience: true }), "partial");
});

function importDependencies(events, { final = verified } = {}) {
  return { inheritedEnv, execArgv: [],
    verify: async (selection, options) => {
      events.push(selection.command);
      if (selection.command === "check-application") return ready();
      assert.equal(selection.experience, true); assert.equal(await options.readSecret(), "synthetic password"); return final();
    },
    inspectClient: async () => events.push("client"), scopeOperation: async (_path, operation) => operation({}),
    readSql: async (_scope, before, options) => { events.push("sql"); assert.equal(before.migrations, 38); assert.equal(options.experience, true); return Buffer.from(sql); },
    loadEnvironment: async () => ({ JESSIEMESSAGE_DB_HOST: "synthetic.invalid", JESSIEMESSAGE_DB_PORT: "3306", JESSIEMESSAGE_DB_NAME: "source_database", JESSIEMESSAGE_RUNTIME_DB_USER: "runtime_user" }),
    readSecret: async () => { events.push("password"); return "synthetic password"; },
    connect: async () => ({ end: async () => events.push("close") }), inspect: async () => events.push("empty"),
    importSql: async (_scope, selection) => { assert.equal(selection.experience, true); events.push("import"); } };
}

test("application import derives37/38 from the verified precheck and carries it to SQL and final verification", async () => {
  for (const explicit of [false, true]) {
    const events = [], selection = importArguments(["restore", ...commonArgs, "--sql-sha256", hash, ...(explicit ? ["--experience", "1"] : [])]);
    const result = await importRun(selection, importDependencies(events));
    assert.equal(result.tables, 37); assert.equal(result.migrations, 38); assert.equal(result.imported, true);
    assert.equal(events.filter(value => value === "password").length, 1); assert.equal(events.filter(value => value === "import").length, 1);
  }
});

test("application import refuses an experience downgrade at final verification", async () => {
  for (const change of [{ tables: 36, migrations: 36 }, { tables: 37, migrations: 37 }, { coverage: VIDEO_APPLICATION_COVERAGE }]) {
    const events = [];
    await assert.rejects(importRun(importArguments(["restore", ...commonArgs, "--sql-sha256", hash]),
      importDependencies(events, { final: () => ({ ...verified(), ...change }) })), { code: "APPLICATION_CHECKPOINT_IMPORT_VERIFY" });
    assert.equal(events.filter(value => value === "import").length, 1);
  }
});

test("resume derives experience only after precheck and propagates it through both existing clone paths", async () => {
  for (const state of ["empty", "application-schema"]) {
    const events = [], selected = resumeArguments(["resume", ...commonArgs, "--sql-sha256", hash]);
    const result = await resumeRun(selected, { inheritedEnv, execArgv: [],
      importOperation: async (selection, options) => {
        if (selection.command === "check-application") { events.push("precheck"); return precheck(); }
        assert.equal(selection.experience, true); assert.equal(await options.readSecret(), "synthetic password"); events.push("import"); return restored();
      },
      verifyOperation: async (selection, options) => {
        assert.equal(selection.experience, true); assert.equal(await options.readSecret(), "synthetic password"); events.push("verify"); return verified();
      },
      loadEnvironment: async () => ({ JESSIEMESSAGE_DB_HOST: "synthetic.invalid", JESSIEMESSAGE_DB_PORT: "3306", JESSIEMESSAGE_DB_NAME: "source_database", JESSIEMESSAGE_RUNTIME_DB_USER: "runtime_user" }),
      readSecret: async () => { events.push("password"); return "synthetic password"; },
      connect: async () => ({ end: async () => {} }), inspect: async (_connection, _database, options) => { assert.deepEqual(options, { video: true, experience: true }); return state; },
    });
    assert.equal(result.tables, 37); assert.equal(result.migrations, 38);
    assert.deepEqual(events, ["precheck", "password", state === "empty" ? "import" : "verify"]);
  }
});

test("a contradictory experience precheck refuses resume before credentials or clone inspection", async () => {
  for (const change of [{ migrations: 37 }, { coverage: VIDEO_APPLICATION_COVERAGE }, { coverage: { ...EXPERIENCE_APPLICATION_COVERAGE, completeDatabase: true } }]) {
    let accessed = false;
    await assert.rejects(resumeRun(resumeArguments(["resume", ...commonArgs, "--sql-sha256", hash]), { inheritedEnv, execArgv: [],
      importOperation: async () => ({ ...precheck(), ...change }), loadEnvironment: async () => { accessed = true; }, readSecret: async () => { accessed = true; },
    }), { code: "APPLICATION_CHECKPOINT_RESUME_CHECKPOINT", phase: "precheck" });
    assert.equal(accessed, false);
  }
});
