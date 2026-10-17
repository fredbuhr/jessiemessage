import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { loadMigrations, createdMigrationTables } from "../server/db/migrations.mjs";
import { CheckpointResumeError, parseArguments, connectOperatorDatabase, inspectResumeClone, run, main } from "../scripts/resume-application-checkpoint.mjs";
import { ApplicationCheckpointImportError } from "../scripts/import-application-checkpoint.mjs";
import { PrivateCheckpointVerificationError } from "../scripts/verify-private-checkpoint.mjs";

const hash = "a".repeat(64), profile = "photos-notify-recovery-crm";
const inheritedEnv = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" };
const args = (command = "resume") => [command, "--private-directory", "/private/source", "--private-path-mode", "linux-dirfd", "--checkpoint-directory", "/private/checkpoint",
  "--database", "isolated_copy", "--confirm-database", "isolated_copy", "--user", "copy_operator", "--profile", profile, "--sql-sha256", hash];
const common = () => ({ version: 6, profile: "messaging-photos-notify-recovery-crm-application", tables: 30, migrations: 30, sqlSha256: hash,
  checkpointFilesMatched: true, capacityRebound: false, httpStarted: false, smtpStarted: false, workersStarted: false });
const ready = () => ({ ...common(), status: "application_restore_precheck_passed", databaseConnected: false, imported: false,
  nativeImportClientVerified: true, sqlImportFormatVerified: true, trustedSqlSha256Matched: true });
const restored = () => ({ ...common(), status: "application_checkpoint_restored_verified", databaseConnected: true, imported: true, applicationSnapshotMatched: true, sourceMutated: false });
const verified = () => ({ ...common(), status: "verified", databaseConnected: true, applicationSnapshotMatched: true });
const neutral = (code, phase) => error => {
  assert.ok(error instanceof CheckpointResumeError); assert.equal(error.code, `APPLICATION_CHECKPOINT_RESUME_${code}`); assert.equal(error.phase, phase);
  assert.equal(error.message, error.code); assert.equal(error.cause, undefined);
  assert.doesNotMatch(JSON.stringify(error), /synthetic password|private-sql|secret-query/); return true;
};
function fixture(state = "empty") {
  const events = [], source = { JESSIEMESSAGE_DB_HOST: "private-sql.invalid", JESSIEMESSAGE_DB_PORT: "3306", JESSIEMESSAGE_DB_NAME: "source_database",
    JESSIEMESSAGE_RUNTIME_DB_USER: "runtime_user", JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic source secret" };
  let suppliedConfiguration;
  const dependencies = { inheritedEnv, execArgv: [],
    importOperation: async (selection, options) => {
      if (selection.command === "check-application") { events.push("precheck"); return ready(); }
      events.push("import"); assert.equal(selection.database, "isolated_copy"); assert.equal(selection.sqlSha256, hash);
      assert.equal(await options.readSecret(), "synthetic password"); return restored();
    },
    verifyOperation: async (selection, options) => {
      events.push("verify"); assert.equal(selection.command, "verify-application"); assert.equal(selection.profile, profile);
      assert.equal(Object.hasOwn(selection, "sqlSha256"), false); assert.equal(await options.readSecret(), "synthetic password"); return verified();
    },
    loadEnvironment: async (_directory, options) => { events.push("configuration"); assert.deepEqual(options, { port: "3000", originProfile: "primary", recovery: true }); return source; },
    readSecret: async () => { events.push("password"); return "synthetic password"; },
    connect: async configuration => { suppliedConfiguration = configuration; events.push("connection"); assert.equal(configuration.JESSIEMESSAGE_DB_PASSWORD, "synthetic password"); assert.equal(configuration.JESSIEMESSAGE_DB_NAME, "isolated_copy"); return { end: async () => events.push("close") }; },
    inspect: async (_connection, database) => { events.push("inspection"); assert.equal(database, "isolated_copy"); return state; },
  };
  return { events, source, dependencies, configuration: () => suppliedConfiguration };
}

test("the resume interface requires an explicit recovery profile and exact target/hash", () => {
  assert.equal(parseArguments(args()).command, "resume"); assert.equal(parseArguments(args("check")).command, "check");
  for (const command of ["restore", "verify", "import", null]) assert.throws(() => parseArguments(args(command)), neutral("USAGE", "arguments"));
  assert.throws(() => parseArguments(args().slice(0, 13).concat(args().slice(15))), neutral("USAGE", "arguments"));
  const changed = args(); changed[10] = "source_database"; assert.throws(() => parseArguments(changed), neutral("USAGE", "arguments"));
});

test("precheck never reads the personal credential, connects, inspects or imports", async () => {
  const f = fixture(); const result = await run(parseArguments(args("check")), f.dependencies);
  assert.deepEqual(f.events, ["precheck"]); assert.equal(result.resumeSupported, true); assert.equal(result.imported, false);
});

test("one credential read imports an independently observed empty clone and validates the full receipt", async () => {
  const f = fixture(); const result = await run(parseArguments(args()), f.dependencies);
  assert.deepEqual(f.events, ["precheck", "configuration", "password", "connection", "inspection", "close", "import"]);
  assert.equal(result.status, "application_checkpoint_restored_verified"); assert.equal(result.importedThisRun, true);
  assert.equal(f.configuration().JESSIEMESSAGE_DB_PASSWORD, ""); assert.equal(f.source.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "");
});

test("a populated application clone verifies using the same credential without invoking import", async () => {
  const f = fixture("application-schema"); const result = await run(parseArguments(args()), f.dependencies);
  assert.deepEqual(f.events, ["precheck", "configuration", "password", "connection", "inspection", "close", "verify"]);
  assert.equal(result.status, "application_checkpoint_existing_clone_verified"); assert.equal(result.imported, false); assert.equal(result.importedThisRun, false);
  assert.equal(result.applicationSnapshotMatched, true); assert.equal(result.sourceMutated, false);
});

test("a partial clone is preserved without an import or a verification that could be misreported as restoration", async () => {
  const f = fixture("partial"); await assert.rejects(run(parseArguments(args()), f.dependencies), neutral("PARTIAL_CLONE", "inspection"));
  assert.deepEqual(f.events, ["precheck", "configuration", "password", "connection", "inspection", "close"]);
  assert.equal(f.configuration().JESSIEMESSAGE_DB_PASSWORD, "");
});

for (const change of [source => { source.JESSIEMESSAGE_DB_NAME = "ISOLATED_COPY"; }, source => { source.JESSIEMESSAGE_RUNTIME_DB_USER = "copy_operator"; }])
  test("source database or runtime identity is rejected before requesting a password", async () => {
    const f = fixture(); change(f.source); await assert.rejects(run(parseArguments(args()), f.dependencies), neutral("CONFIGURATION", "configuration"));
    assert.deepEqual(f.events, ["precheck", "configuration"]);
  });

test("authentication rejection retains only its phase and never reaches SQL inspection or import", async () => {
  const f = fixture(); f.dependencies.connect = async () => { f.events.push("connection"); throw new CheckpointResumeError("AUTHENTICATION", "connection"); };
  await assert.rejects(run(parseArguments(args()), f.dependencies), neutral("AUTHENTICATION", "connection"));
  assert.deepEqual(f.events, ["precheck", "configuration", "password", "connection"]); assert.equal(f.source.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "");
});

test("an unknown connection failure never leaks its SQL, host or password", async () => {
  const f = fixture(); f.dependencies.connect = async () => { throw new Error("synthetic password private-sql.invalid secret-query"); };
  await assert.rejects(run(parseArguments(args()), f.dependencies), neutral("OPERATION", "connection"));
});

test("a stale precheck or final result cannot lower the bound profile or expected SQL hash", async () => {
  for (const when of ["before", "after"]) {
    const f = fixture(), original = f.dependencies.importOperation;
    f.dependencies.importOperation = async (...parameters) => {
      const result = await original(...parameters);
      return (when === "before") === (parameters[0].command === "check-application") ? { ...result, sqlSha256: "b".repeat(64) } : result;
    };
    await assert.rejects(run(parseArguments(args()), f.dependencies), neutral(when === "before" ? "CHECKPOINT" : "RESULT", when === "before" ? "precheck" : "import"));
    assert.equal(f.events.includes("import"), when === "after");
  }
});

test("typed import and verification failures retain only their existing safe category", async () => {
  for (const [state, operation, error, code, phase] of [["empty", "importOperation", new ApplicationCheckpointImportError("APPLICATION_CHECKPOINT_IMPORT_IMPORT"), "IMPORT", "import"],
    ["application-schema", "verifyOperation", new PrivateCheckpointVerificationError("PRIVATE_CHECKPOINT_VERIFY_DUMP_MISMATCH"), "VERIFY", "verification"]]) {
    const f = fixture(state), original = f.dependencies[operation];
    f.dependencies[operation] = async (...parameters) => { if (parameters[0].command === "check-application") return original(...parameters); throw error; };
    await assert.rejects(run(parseArguments(args()), f.dependencies), failure => { neutral(code, phase)(failure); assert.equal(failure.detailCode, error.code); return true; });
  }
});

test("an existing clone cannot be accepted with a downgraded receipt or changed SQL hash", async () => {
  for (const altered of [{ version: 4 }, { sqlSha256: "b".repeat(64) }, { applicationSnapshotMatched: false }]) {
    const f = fixture("application-schema"); f.dependencies.verifyOperation = async () => ({ ...verified(), ...altered });
    await assert.rejects(run(parseArguments(args()), f.dependencies), neutral("RESULT", "verification"));
    assert.equal(f.events.includes("import"), false);
  }
});

test("an inspection failure closes the connection and clears credentials without importing", async () => {
  const f = fixture(); f.dependencies.inspect = async () => { throw new Error("secret-query private-sql.invalid"); };
  await assert.rejects(run(parseArguments(args()), f.dependencies), neutral("OPERATION", "inspection"));
  assert.equal(f.events.filter(event => event === "close").length, 1); assert.equal(f.events.includes("import"), false);
  assert.equal(f.configuration().JESSIEMESSAGE_DB_PASSWORD, "");
});

test("invalid and interrupted password input stops before any SQL connection", async () => {
  for (const password of ["", "has\nnewline", "\0", "x".repeat(4097), "\ud800"]) {
    const f = fixture(); f.dependencies.readSecret = async () => password;
    await assert.rejects(run(parseArguments(args()), f.dependencies), neutral("PASSWORD", "password")); assert.equal(f.events.includes("connection"), false);
  }
});

test("accessors and ambient trust overrides are refused before configuration or password input", async () => {
  const f = fixture(), selected = parseArguments(args()); let called = false;
  Object.defineProperty(selected, "profile", { get() { called = true; return profile; } });
  await assert.rejects(run(selected, f.dependencies), neutral("USAGE", "arguments")); assert.equal(called, false);
  await assert.rejects(run(parseArguments(args()), { ...f.dependencies, inheritedEnv: { ...inheritedEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" } }), neutral("ENVIRONMENT", "precheck"));
  assert.deepEqual(f.events, []);
});

test("SQL connection categories use numeric driver metadata while discarding every private error field", async () => {
  const configuration = { JESSIEMESSAGE_DB_HOST: "private-sql.invalid", JESSIEMESSAGE_DB_PORT: "3306", JESSIEMESSAGE_DB_NAME: "isolated_copy", JESSIEMESSAGE_MIGRATION_DATABASE: "isolated_copy", JESSIEMESSAGE_DB_USER: "copy_operator", JESSIEMESSAGE_DB_PASSWORD: "synthetic password" };
  for (const [errno, code] of [[1045, "AUTHENTICATION"], [1044, "ACCESS"], [1142, "ACCESS"], [1049, "DATABASE"], [9999, "CONNECTION"]]) {
    let observed;
    await assert.rejects(connectOperatorDatabase(configuration, { readCa: async () => "synthetic CA", driverConnect: async options => {
      observed = options; assert.equal(options.ssl.rejectUnauthorized, true); assert.equal(options.ssl.minVersion, "TLSv1.2"); assert.equal(options.ssl.ca, "synthetic CA");
      assert.equal(options.password, "synthetic password"); assert.equal(options.multipleStatements, false); assert.equal(options.logParam, false);
      throw Object.assign(new Error("synthetic password private-sql.invalid secret-query"), { errno });
    } }), neutral(code, "connection")); assert.equal(observed.password, "");
  }
});

test("clone inspection distinguishes no objects, all expected tables, views and partial schemas using SELECT/SHOW only", async () => {
  const names = [...createdMigrationTables(await loadMigrations()), "schema_migrations"].sort();
  const rows = names.map(name => ({ name, kind: "BASE TABLE", engine: "InnoDB" }));
  function connection(tables, name = "isolated_copy", tls = true) { return { query: async (sql, parameters) => {
    assert.match(sql, /^(SELECT|SHOW) /); if (sql.startsWith("SELECT DATABASE")) return [{ name }];
    if (sql.startsWith("SHOW")) return [{ Variable_name: "Ssl_cipher", Value: tls ? "TLS_AES_256_GCM_SHA384" : "" }];
    assert.deepEqual(parameters, ["isolated_copy"]); return tables;
  } }; }
  assert.equal(await inspectResumeClone(connection([]), "isolated_copy"), "empty");
  assert.equal(await inspectResumeClone(connection(rows), "isolated_copy"), "application-schema");
  for (const tables of [rows.slice(1), [{ name: "unexpected", kind: "VIEW" }], [...rows, rows[0]], rows.map((row, i) => i ? row : { ...row, kind: "VIEW" })])
    assert.equal(await inspectResumeClone(connection(tables), "isolated_copy"), "partial");
  await assert.rejects(inspectResumeClone(connection([], "source_database"), "isolated_copy"), neutral("DATABASE", "inspection"));
  await assert.rejects(inspectResumeClone(connection([], "isolated_copy", false), "isolated_copy"), neutral("DATABASE", "inspection"));
});

test("the CLI success output reports the exact action without the credential", async () => {
  const f = fixture(), output = new PassThrough(); let text = ""; output.on("data", chunk => { text += chunk; });
  await main(args(), { ...f.dependencies, outputStream: output });
  assert.equal(JSON.parse(text).action, "imported_empty_clone"); assert.doesNotMatch(text, /synthetic password|private-sql/);
});

test("broadcast resume accepts only the new profile-bound receipt and preserves single-read import and verify behavior", async () => {
  const selectedProfile = "photos-notify-recovery-crm-broadcast", receipt = { version: 8, profile: "messaging-photos-notify-recovery-crm-broadcast-application" };
  for (const state of ["empty", "application-schema"]) {
    const f = fixture(state), original = f.dependencies.importOperation, selectedArgs = args().map(value => value === profile ? selectedProfile : value);
    f.dependencies.importOperation = async (selection, options) => ({ ...await original(selection, options), ...receipt });
    f.dependencies.verifyOperation = async (selection, options) => {
      f.events.push("verify"); assert.equal(selection.profile, selectedProfile); assert.equal(await options.readSecret(), "synthetic password");
      return { ...verified(), ...receipt };
    };
    const result = await run(parseArguments(selectedArgs), f.dependencies);
    assert.equal(result.version, 8); assert.equal(result.profile, receipt.profile);
    assert.equal(f.events.filter(event => event === "password").length, 1);
    assert.equal(result.importedThisRun, state === "empty");
  }
  const f = fixture(); await assert.rejects(run(parseArguments(args().map(value => value === profile ? selectedProfile : value)), f.dependencies), neutral("CHECKPOINT", "precheck"));
  assert.deepEqual(f.events, ["precheck"]);
});
