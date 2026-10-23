import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPERIENCE_APPLICATION_COVERAGE, VIDEO_APPLICATION_COVERAGE } from "../server/backup/application-scope.mjs";
import { createdMigrationTables } from "../server/db/migrations.mjs";
import { loadExperienceMigrations } from "../server/experience/migrations.mjs";
import { readCheckpointReceipt, writeCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";
import { createBackupManifest, readManifest, writeManifest } from "../server/backup/manifest.mjs";
import { loadRuntimeVideoEnvironment } from "../server/config/runtime-video.mjs";
import { parseArguments as captureArguments } from "../scripts/private-checkpoint.mjs";
import { parseArguments as verifyArguments, run as verifyRun } from "../scripts/verify-private-checkpoint.mjs";
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

async function verificationFixture(t) {
  const f = await receiptFixture(t), sourceDirectory = join(f.directory, "source"), sourceMedia = join(f.directory, "source-media"), sourceVideo = join(f.directory, "source-video");
  for (const path of [sourceDirectory, sourceMedia, sourceVideo, join(f.directory, "media"), join(f.directory, "video")]) await mkdir(path, { mode: 0o700 });
  const curve = createECDH("prime256v1"); curve.setPrivateKey(Buffer.alloc(32, 7));
  const key = number => Buffer.alloc(32, number).toString("base64url"), origin = "https://jessiemessage.com";
  const keys = Object.fromEntries([["totpKey", 1], ["mailKey", 2], ["messageKey", 3], ["mediaKey", 4], ["notificationKey", 5], ["crmKey", 6], ["videoKey", 8]]
    .map(([name, number]) => [name, Buffer.from(key(number), "base64url")]));
  const bundle = () => ({
    database: { format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306", database: "source_database", user: "runtime_user", password: "synthetic-runtime-password", privilegeProfile: "infomaniak-shared-pattern" },
    authentication: { format: "jessiemessage-runtime-auth", version: 1, origin, mfaKey: key(1) },
    messaging: { format: "jessiemessage-runtime-messaging", version: 1, origin, mailKey: key(2), messageKey: key(3), smtpHost: "smtp.example.invalid", smtpPort: "587", smtpUser: "synthetic-smtp-user", smtpPassword: "synthetic-smtp-password" },
    media: { format: "jessiemessage-runtime-media", version: 1, origin, mediaKey: key(4), mediaRoot: sourceMedia, ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "0" },
    notifications: { version: 1, origin, notificationKey: key(5), vapidPublicKey: curve.getPublicKey().toString("base64url"), vapidPrivateKey: curve.getPrivateKey().toString("base64url"), vapidSubject: "mailto:contact@jessiemessage.com" },
    crm: { version: 1, origin, crmKey: key(6) },
    video: { format: "jessiemessage-runtime-video", version: 1, origin, videoKey: key(8), videoRoot: sourceVideo, ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "0" },
  });
  const bound = { databaseTag: "1".repeat(64), rootPathTag: "2".repeat(64), rootPhysicalTag: "3".repeat(64), rootFingerprint: "4".repeat(64), rootAncestors: ["a".repeat(64)],
    video: { databaseTag: "1".repeat(64), rootPathTag: "5".repeat(64), rootPhysicalTag: "6".repeat(64), rootFingerprint: "7".repeat(64), rootAncestors: ["a".repeat(64)] } };
  const manifest = createBackupManifest({ snapshot: { version: 3, coverage: EXPERIENCE_APPLICATION_COVERAGE, counts: { tables: 37, rows: 0 },
    capacity: { rootFingerprint: bound.rootFingerprint }, video: { capacity: { rootFingerprint: bound.video.rootFingerprint } } }, identity: bound, keys, now: 1792748656772, profile: manifestProfile });
  await unlink(join(f.directory, "manifest.json")); await writeManifest(join(f.directory, "manifest.json"), manifest, { pathMode: "strict" });
  const metadata = await readFile(join(f.directory, "manifest.json"));
  f.value.manifest.sha256 = digest(metadata); await writeCheckpointReceipt(f.scope, f.value);
  const events = [], query = async statement => {
    assert.match(statement, /^(SELECT|SET|START|SHOW) /);
    if (statement === "SELECT DATABASE() AS name") return [{ name: "isolated_copy" }];
    if (statement.includes("information_schema.TABLES")) return names.map(name => ({ name, kind: "BASE TABLE", engine: "InnoDB" }));
    if (statement.includes("schema_migrations")) return plan.map(migration => ({ ...migration, state: "applied", attempts: 1 }));
    return [];
  };
  const selection = command => verifyArguments([command, "--private-directory", sourceDirectory, "--private-path-mode", "linux-dirfd", "--checkpoint-directory", f.directory,
    "--database", "isolated_copy", "--confirm-database", "isolated_copy", "--user", "copy_operator", "--profile", profile]);
  return { ...f, manifest, events, selection, dependencies: { inheritedEnv, execArgv: [],
    scopeOperation: async (path, operation) => operation({ path, file: name => join(path, name), assertReady: () => lstat(path, { bigint: true }), sync: async () => {} }),
    loadEnvironment: async (_path, options) => loadRuntimeVideoEnvironment(sourceDirectory, options, { readBundle: async () => bundle() }),
    makeStorage: async () => ({}), makeVideoStorage: async () => ({}), identity: async () => structuredClone(bound), assertIdentity: async () => {},
    readBackupManifest: path => readManifest(path, { pathMode: "strict" }),
    readBackup: async () => ({ backupBytes: f.value.sql.bytes, backupSha256: f.value.sql.sha256, sqlBytes: f.value.sql.uncompressedBytes, sqlSha256: hash }),
    verifyCheckpointMedia: async () => {}, inspectClient: async () => {},
    readSecret: async () => { events.push("password"); return "synthetic password"; },
    dump: async (_scope, _selected, _configuration, _password, options) => {
      events.push("dump"); assert.equal(options.experience, true); assert.equal(options.video, true); assert.deepEqual(options.tables, names);
      return { sqlBytes: sql.length, sqlSha256: hash };
    },
    connect: async () => { events.push("connect"); return { query, rollback: async () => events.push("rollback"), end: async () => events.push("close") }; },
    verifyVideo: async options => {
      assert.equal(options.experience, true); events.push("crypto");
      const countNames = ["rows", "mfa", "mail", "reset", "messages", "crm", "tasks", "broadcast", "broadcastRecipients", "announcements", "media", "mediaFiles", "notifications", "notificationJobs", "videos", "videoFiles", "videoBytes", "preferences"];
      return { complete: true, healthy: true, issues: [], counts: Object.fromEntries(countNames.map(name => [name, name === "preferences" ? 1 : 0])) };
    },
    verifyApplicationSnapshot: async (_environment, selected) => {
      assert.equal(selected.experience, true); events.push("snapshot");
      return { command: "verify", verified: true, prepared: false, restored: false, releasedCandidates: 0 };
    },
  } };
}

test("private checkpoint verification authenticates experience coverage and verifies38 migrations without a persistent service", async t => {
  const f = await verificationFixture(t);
  const checked = await verifyRun(f.selection("check-application"), f.dependencies);
  assert.equal(checked.tables, 37); assert.equal(checked.migrations, 38); assert.equal(checked.databaseConnected, false); assert.deepEqual(f.events, []);
  const verified = await verifyRun(f.selection("verify-application"), f.dependencies);
  assert.equal(verified.tables, 37); assert.equal(verified.migrations, 38); assert.equal(verified.counts.preferences, 1); assert.equal(verified.httpStarted, false);
  assert.deepEqual(f.events, ["password", "dump", "connect", "crypto", "dump", "rollback", "close", "snapshot"]);
});

test("rewriting an experience receipt hash cannot bypass manifest authentication before password or SQL", async t => {
  const f = await verificationFixture(t), changed = { ...f.manifest, signature: "0".repeat(64) };
  await unlink(join(f.directory, "manifest.json")); await writeManifest(join(f.directory, "manifest.json"), changed, { pathMode: "strict" });
  const metadata = await readFile(join(f.directory, "manifest.json"));
  await writeFile(join(f.directory, "receipt.json"), `${JSON.stringify({ ...f.value, manifest: { ...f.value.manifest, sha256: digest(metadata) } })}\n`);
  await assert.rejects(verifyRun(f.selection("verify-application"), f.dependencies));
  assert.deepEqual(f.events, []);
});
