import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, statfs, writeFile } from "node:fs/promises";
import { createECDH, createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";
import { loadRuntimeCrmEnvironment } from "../server/config/runtime-crm.mjs";
import { loadRuntimeVideoEnvironment } from "../server/config/runtime-video.mjs";
import { loadRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { copyCheckpointMedia, verifyCheckpointMedia } from "../server/backup/checkpoint-files.mjs";
import { readCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";
import { createErasureJournal } from "../server/data/erasure-journal.mjs";
import { readOperationalCheckpoint } from "../server/backup/operational-checkpoint.mjs";
import { withErasureDirectory } from "./fixtures/erasure-files.mjs";
import { APPLICATION_COVERAGE, VIDEO_APPLICATION_COVERAGE } from "../server/backup/application-scope.mjs";
import { PrivateCheckpointError, archiveCheckpoint, parseArguments, run, main } from "../scripts/private-checkpoint.mjs";

const base = fileURLToPath(new URL("../../audit/", import.meta.url));
const origin = "https://recette.jessiemessage.com";
const now = 1792193000000;
const procDirectoryAvailable = process.platform === "linux" && await statfs("/proc/self/fd", { bigint: true }).then((stats) => stats.type === 0x9fa0n, () => false);
const runtimePassword = "synthetic-runtime-password";
const inspectionPassword = "synthetic-inspection-password";
const sql = Buffer.from("-- Synthetic checkpoint only\nCREATE TABLE fixture (id INT PRIMARY KEY, value VARCHAR(60));\nINSERT INTO fixture VALUES (1, 'synthetic-row');\n");
const hash = (content) => createHash("sha256").update(content).digest("hex");
const mediaName = (variant) => `${"1".repeat(64)}.${variant}.enc`;
const key = (number) => Buffer.alloc(32, number).toString("base64url");
const secretFields = ["JESSIEMESSAGE_RUNTIME_DB_PASSWORD", "JESSIEMESSAGE_MFA_KEY", "JESSIEMESSAGE_MAIL_KEY",
  "JESSIEMESSAGE_MESSAGE_KEY", "JESSIEMESSAGE_MEDIA_KEY", "JESSIEMESSAGE_NOTIFICATIONS_KEY",
  "JESSIEMESSAGE_VAPID_PRIVATE_KEY", "JESSIEMESSAGE_SMTP_USER", "JESSIEMESSAGE_SMTP_PASSWORD"];
const neutral = (error) => error instanceof PrivateCheckpointError && /^PRIVATE_CHECKPOINT_[A-Z]+$/.test(error.code)
  && error.message === error.code && !error.cause && !JSON.stringify(error).includes("synthetic");

function bundle(mediaRoot, origin = "https://recette.jessiemessage.com") {
  const vapid = createECDH("prime256v1");
  vapid.setPrivateKey(Buffer.alloc(32, 7));
  return {
    database: { format: "jessiemessage-runtime-database", version: 1, host: "db.example.invalid", port: "3306", database: "synthetic_checkpoint",
      user: "synthetic_runtime", password: runtimePassword, privilegeProfile: "infomaniak-shared-pattern" },
    authentication: { format: "jessiemessage-runtime-auth", version: 1, origin, mfaKey: key(1) },
    messaging: { format: "jessiemessage-runtime-messaging", version: 1, origin, mailKey: key(2), messageKey: key(3),
      smtpHost: "smtp.example.invalid", smtpPort: "587", smtpUser: "synthetic-smtp-user", smtpPassword: "synthetic-smtp-password" },
    media: { format: "jessiemessage-runtime-media", version: 1, origin, mediaKey: key(4), mediaRoot,
      ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "536870912" },
    notifications: { version: 1, origin, notificationKey: key(5), vapidPublicKey: vapid.getPublicKey().toString("base64url"),
      vapidPrivateKey: vapid.getPrivateKey().toString("base64url"), vapidSubject: "mailto:contact@jessiemessage.com" },
  };
}

async function syntheticScope(directory) {
  const identity = await lstat(directory, { bigint: true });
  return {
    path: directory,
    file(name) { assert.equal(/[/\\\0]/.test(name), false); return join(directory, name); },
    async assertReady() {
      const actual = await lstat(directory, { bigint: true });
      assert.equal(actual.isDirectory(), true);
      assert.equal(actual.uid, BigInt(process.getuid()));
      assert.equal(actual.mode & 0o7777n, 0o700n);
      assert.equal(actual.dev, identity.dev);
      assert.equal(actual.ino, identity.ino);
      return actual;
    },
    async sync() {
      const handle = await open(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      try { await handle.sync(); }
      finally { await handle.close(); }
    },
  };
}

async function fixture(t, { video = false, broadcast = video, crm = broadcast, recovery = crm } = {}) {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(base, "private-checkpoint-capture-"));
  await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  const privateDirectory = join(root, "private"), mediaRoot = join(root, "media"), videoRoot = join(root, "video"), destination = join(root, "checkpoint-036");
  await mkdir(privateDirectory, { mode: 0o700 });
  await mkdir(mediaRoot, { mode: 0o700 });
  if (video) { await mkdir(videoRoot, { mode: 0o700 }); await writeFile(join(videoRoot, `${"9".repeat(64)}.video.enc`), Buffer.alloc(300001, 91), { mode: 0o600 }); }
  const full = Buffer.alloc(150001, 61), thumb = Buffer.from("synthetic-encrypted-thumbnail");
  await writeFile(join(mediaRoot, mediaName("full")), full, { mode: 0o600 });
  await writeFile(join(mediaRoot, mediaName("thumb")), thumb, { mode: 0o600 });
  const snapshot = { schemaDigest: "a".repeat(64), coreDigest: "b".repeat(64), counts: { tables: 33, rows: 1 } };
  const state = { events: [], loaded: [], usedEnvironments: [], keys: [], dumps: 0, prepares: 0, secretReads: 0,
    manifests: 0, compares: 0, copies: 0, verifications: 0, tools: 0, identities: 0, clocks: 0, snapshot, recovery };
  const inputStream = { isTTY: true };
  const command = (mode = "capture") => [mode, ...(["capture", "capture-application"].includes(mode) ? ["--offline"] : []),
    "--private-directory", privateDirectory, "--private-path-mode", "linux-dirfd", "--destination-private-directory", destination,
    ...(mode.endsWith("-application") ? [] : ["--inspection-user", "synthetic_inspection"]), ...(recovery ? ["--profile", `photos-notify-recovery${crm ? "-crm" : ""}${broadcast ? "-broadcast" : ""}${video ? "-video" : ""}`] : [])];
  const dependencies = {
    inheritedEnv: { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" }, execArgv: [], inputStream,
    async scopeOperation(directory, operation) { return operation(await syntheticScope(directory)); },
    async loadEnvironment(directory, parameters) {
      assert.equal(directory, privateDirectory);
      assert.deepEqual(parameters, { port: "3000", ...(recovery ? { originProfile: "primary", recovery: true } : {}) });
      const environment = await (video ? loadRuntimeVideoEnvironment : broadcast ? loadRuntimeBroadcastEnvironment : crm ? loadRuntimeCrmEnvironment : loadRuntimeNotificationsEnvironment)(directory, parameters,
        { readBundle: async () => ({ ...bundle(mediaRoot, recovery ? "https://jessiemessage.com" : origin),
          ...(crm ? { crm: { version: 1, origin: "https://jessiemessage.com", crmKey: key(6) } } : {}),
          ...(video ? { video: { format: "jessiemessage-runtime-video", version: 1, origin: "https://jessiemessage.com", videoKey: key(8), videoRoot,
            ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "0" } } : {}) }) });
      state.loaded.push(environment);
      state.events.push("load");
      return environment;
    },
    async inspectTools() { state.tools += 1; state.events.push("tools"); },
    async readSecret(input) { assert.equal(input, inputStream); state.secretReads += 1; state.events.push("secret"); return inspectionPassword; },
    async inspectIdentity(environment) {
      assert.equal(environment.JESSIEMESSAGE_BACKUP_SCHEMA_USER, "synthetic_inspection");
      assert.equal(environment.JESSIEMESSAGE_BACKUP_SCHEMA_PASSWORD, inspectionPassword);
      assert.equal(environment.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, runtimePassword);
      await assert.rejects(lstat(destination), { code: "ENOENT" });
      state.usedEnvironments.push(environment);
      state.identities += 1;
      state.events.push("identity");
    },
    async inspectApplicationIdentity(environment) {
      assert.equal(environment.JESSIEMESSAGE_BACKUP_SCHEMA_USER, undefined);
      assert.equal(environment.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, runtimePassword);
      assert.equal(environment.JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE, "infomaniak-shared-pattern");
      await assert.rejects(lstat(destination), { code: "ENOENT" });
      state.usedEnvironments.push(environment); state.identities += 1; state.events.push("application-identity");
    },
    async prepare(args, environment, parameters) {
      assert.equal(args[0], "prepare");
      assert.equal(args[1], "--offline");
      assert.equal(args[2], "--manifest");
      assert.deepEqual(args.slice(4), ["--profile", `photos-notify${recovery ? "-recovery" : ""}${crm ? "-crm" : ""}${broadcast ? "-broadcast" : ""}${video ? "-video" : ""}${state.application ? "-application" : ""}`]);
      assert.equal(environment.JESSIEMESSAGE_BACKUP_SCHEMA_USER, state.application ? undefined : "synthetic_inspection");
      assert.equal(environment.JESSIEMESSAGE_BACKUP_SCHEMA_PASSWORD, state.application ? undefined : inspectionPassword);
      assert.equal(environment.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, runtimePassword);
      assert.equal(environment.JESSIEMESSAGE_MEDIA_ROOT, mediaRoot);
      assert.equal(typeof parameters.outputStream.write, "function");
      state.usedEnvironments.push(environment);
      state.prepares += 1;
      state.events.push(`prepare:${basename(args[3])}`);
      await writeFile(args[3], `${JSON.stringify({ version: video ? 11 : broadcast ? state.application ? 10 : 9 : crm ? state.application ? 8 : 7 : recovery ? state.application ? 6 : 5 : state.application ? 4 : 3,
        profile: `messaging-photos-notify${recovery ? "-recovery" : ""}${crm ? "-crm" : ""}${broadcast ? "-broadcast" : ""}${video ? "-video" : ""}${state.application ? "-application" : ""}`, payload: { snapshot: structuredClone(state.snapshot) } })}\n`,
        { mode: 0o600, flag: "wx" });
      return { command: "prepare", verified: true, prepared: true, restored: false };
    },
    async getManifest(filename) { state.manifests += 1; return JSON.parse(await readFile(filename, "utf8")); },
    async verifyManifest({ manifest, keys }) {
      state.keys.push(keys);
      assert.deepEqual(Object.keys(keys).sort(), ["mailKey", "mediaKey", "messageKey", "notificationKey", "totpKey", ...(crm ? ["crmKey"] : []), ...(video ? ["videoKey"] : [])].sort());
      for (const value of Object.values(keys)) assert.equal(value.length, 32);
      return manifest.payload;
    },
    compareSnapshots({ expected, actual, mode }) { assert.equal(mode, "exact"); state.compares += 1; assert.deepEqual(actual, expected); },
    async dump(scope, target, configuration, password, parameters) {
      assert.equal(scope.path, destination);
      assert.deepEqual(target, { user: state.application ? "synthetic_runtime" : "synthetic_inspection", database: "synthetic_checkpoint" });
      assert.deepEqual(configuration, { host: "db.example.invalid", port: "3306" });
      assert.equal(password, state.application ? runtimePassword : inspectionPassword);
      if (state.application) { assert.equal(parameters.tables.length, video ? 36 : 33); assert.equal(new Set(parameters.tables).size, video ? 36 : 33); assert.ok(parameters.tables.includes("schema_migrations")); }
      else assert.equal(parameters.tables, undefined);
      assert.equal(Object.hasOwn(parameters, "video"), video); if (video) assert.equal(parameters.video, true);
      state.dumps += 1;
      state.events.push(`dump:${state.dumps}`);
      if (state.dumps === 1) {
        assert.equal(typeof parameters.onSqlChunk, "function");
        parameters.onSqlChunk(sql.subarray(0, 37));
        parameters.onSqlChunk(sql.subarray(37));
      } else assert.equal(parameters.onSqlChunk, undefined);
      return { sqlBytes: sql.length, sqlSha256: hash(sql) };
    },
    async copyMedia(...parameters) { state.copies += 1; return copyCheckpointMedia(...parameters); },
    async verifyMedia(...parameters) { state.verifications += 1; return verifyCheckpointMedia(...parameters); },
    async archive(scope, inventory, parameters) {
      if (process.env.CI && process.platform === "linux") assert.equal(procDirectoryAvailable, true);
      if (procDirectoryAvailable) return archiveCheckpoint(scope, inventory, parameters);
      // This local sandbox has no procfs. Keep the real GNU tar, archive writer
      // and verifier, substituting only its already-private synthetic root.
      // Linux CI must exercise the inherited directory FD without substitution.
      assert.equal(scope.path, destination);
      return archiveCheckpoint(scope, inventory, { ...parameters, spawnClient(executable, args, selected) {
        assert.equal(executable, "/usr/bin/tar");
        return spawn(executable, args.map((argument) => argument === "--directory=/proc/self/fd/3" ? `--directory=${destination}` : argument), selected);
      } });
    },
    clock() { state.clocks += 1; return now; },
  };
  return { root, privateDirectory, mediaRoot, videoRoot, destination, full, thumb, state, command, dependencies };
}

function cleared(state) {
  for (const environment of [...state.loaded, ...state.usedEnvironments]) {
    for (const field of secretFields) assert.equal(environment[field], "", field);
  }
  for (const environment of state.usedEnvironments) {
    assert.equal(environment.JESSIEMESSAGE_BACKUP_SCHEMA_USER, "");
    assert.equal(environment.JESSIEMESSAGE_BACKUP_SCHEMA_PASSWORD, "");
  }
  for (const keys of state.keys) for (const value of Object.values(keys)) assert.equal(value.every((byte) => byte === 0), true);
}

function publicOnly(result, f) {
  const output = JSON.stringify(result);
  assert.doesNotMatch(output, /synthetic|example\.invalid|CREATE TABLE|INSERT INTO/);
  for (const privateValue of [f.root, f.privateDirectory, f.mediaRoot, f.destination, runtimePassword, inspectionPassword, "synthetic_inspection", "synthetic_runtime",
    key(1), key(2), key(3), key(4), key(5), mediaName("full"), mediaName("thumb")]) assert.equal(output.includes(privateValue), false, privateValue);
}

test("checkpoint check loads a validated profile but performs no SQL, secret input or writes", async (t) => {
  const f = await fixture(t), original = fs.promises.open;
  let writes = 0;
  fs.promises.open = async (...args) => {
    if ((args[1] & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0) writes += 1;
    return original(...args);
  };
  syncBuiltinESMExports();
  let result;
  try { result = await run(parseArguments(f.command("check")), f.dependencies); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
  assert.deepEqual(result, { status: "ready_for_input", profile: "messaging-photos-notify", schema: 33,
    databaseConnected: false, checkpointSaved: false, started: false, migrationPerformed: false });
  assert.equal(writes, 0);
  assert.equal(f.state.dumps, 0);
  assert.equal(f.state.prepares, 0);
  assert.equal(f.state.secretReads, 0);
  assert.equal(f.state.copies, 0);
  assert.equal(f.state.identities, 0);
  assert.equal(f.state.clocks, 0);
  assert.deepEqual(await readdir(f.root), ["media", "private"]);
  publicOnly(result, f);
  cleared(f.state);
});

test("inspection verifies the dedicated identity before any writes and leaves the checkpoint absent", async (t) => {
  const f = await fixture(t), original = fs.promises.open;
  let writes = 0;
  fs.promises.open = async (...args) => {
    if ((args[1] & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0) writes += 1;
    return original(...args);
  };
  syncBuiltinESMExports();
  let result;
  try { result = await run(parseArguments(f.command("inspect")), f.dependencies); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
  assert.deepEqual(result, { status: "inspection_verified", profile: "messaging-photos-notify", tables: 33, migrations: 33,
    databaseConnected: true, inspectionPrivilegesVerified: true, checkpointSaved: false, started: false, migrationPerformed: false });
  assert.equal(writes, 0);
  assert.equal(f.state.identities, 1);
  assert.equal(f.state.secretReads, 1);
  assert.equal(f.state.dumps, 0);
  assert.equal(f.state.prepares, 0);
  assert.equal(f.state.copies, 0);
  assert.equal(f.state.clocks, 0);
  assert.deepEqual(await readdir(f.root), ["media", "private"]);
  publicOnly(result, f);
  cleared(f.state);
});

test("diagnosis publishes only fixed categories without passing the strict inspection or creating files", async (t) => {
  const f = await fixture(t), original = fs.promises.open;
  let writes = 0, diagnoses = 0, output = "";
  fs.promises.open = async (...args) => {
    if ((args[1] & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0) writes += 1;
    return original(...args);
  };
  syncBuiltinESMExports();
  let result;
  try {
    result = await main(f.command("diagnose"), { ...f.dependencies,
      async diagnoseIdentity(environment) {
        diagnoses += 1; f.state.usedEnvironments.push(environment);
        assert.equal(environment.JESSIEMESSAGE_BACKUP_SCHEMA_PASSWORD, inspectionPassword);
        return { databaseMatched: true, scope: "raw_underscore_pattern", privilegeProfile: "shared_admin",
          metadataVisibility: "unproven", objectInventory: "unproven", captureAllowed: false,
          rawGrant: `private ${inspectionPassword}`, database: "synthetic_checkpoint" };
      }, outputStream: { write(value) { output += value; } } });
  } finally { fs.promises.open = original; syncBuiltinESMExports(); }
  assert.deepEqual(result, { status: "inspection_diagnosed", profile: "messaging-photos-notify", databaseConnected: true,
    diagnosis: { databaseMatched: true, scope: "raw_underscore_pattern", privilegeProfile: "shared_admin",
      metadataVisibility: "unproven", objectInventory: "unproven", inspectionPolicySatisfied: false },
    checkpointSaved: false, captureAllowed: false, started: false, migrationPerformed: false });
  assert.equal(output, `${JSON.stringify(result)}\n`);
  assert.equal(diagnoses, 1); assert.equal(writes, 0); assert.equal(f.state.secretReads, 1);
  for (const name of ["identities", "dumps", "prepares", "copies", "clocks"]) assert.equal(f.state[name], 0, name);
  assert.deepEqual(await readdir(f.root), ["media", "private"]);
  publicOnly(result, f); cleared(f.state);
});

test("diagnosis failures and impossible success reports remain closed and clear credentials", async (t) => {
  for (const mode of ["connection", "query", "inconsistent", "private-category", "cancelled"]) {
    const f = await fixture(t), controller = new AbortController(); let output = "";
    const expected = mode === "connection" ? "PRIVATE_CHECKPOINT_CONNECTION" : mode === "query" ? "PRIVATE_CHECKPOINT_OPERATION"
      : mode === "cancelled" ? "PRIVATE_CHECKPOINT_CANCELLED" : "PRIVATE_CHECKPOINT_INSPECTION";
    await assert.rejects(main(f.command("diagnose"), { ...f.dependencies, signal: controller.signal,
      async diagnoseIdentity(environment) {
        f.state.usedEnvironments.push(environment);
        if (mode === "connection" || mode === "query") throw Object.assign(new Error(inspectionPassword), { code: mode === "connection" ? "AUTH_DATABASE_CONNECTION" : "ER_TABLEACCESS_DENIED_ERROR" });
        if (mode === "cancelled") controller.abort();
        return { databaseMatched: true, scope: mode === "private-category" ? inspectionPassword : "exact", privilegeProfile: "shared_admin",
          metadataVisibility: "unproven", objectInventory: "unproven", captureAllowed: mode === "inconsistent" };
      }, outputStream: { write(value) { output += value; } } }), error => {
      assert.equal(error.code, expected); assert.doesNotMatch(error.message, /synthetic|password/); return true;
    });
    assert.equal(output, ""); assert.equal(f.state.identities, 0); assert.equal(f.state.dumps, 0);
    await assert.rejects(lstat(f.destination), { code: "ENOENT" }); cleared(f.state);
  }
  const f = await fixture(t);
  const args = f.command("diagnose"); args.splice(1, 0, "--offline");
  assert.throws(() => parseArguments(args), { code: "PRIVATE_CHECKPOINT_USAGE" });
});

test("offline capture verifies two SQL dumps and both manifests, builds the real receipt, gzip and GNU tar archive", { timeout: 15000 }, async (t) => {
  const f = await fixture(t);
  let output = "";
  const result = await main(f.command(), { ...f.dependencies, outputStream: { write(value) { output += value; } } });
  assert.equal(result.status, "checkpoint_saved");
  assert.equal(result.profile, "messaging-photos-notify");
  assert.equal(result.tables, 33);
  assert.equal(result.migrations, 33);
  assert.equal(result.mediaFiles, 2);
  assert.equal(result.mediaBytes, f.full.length + f.thumb.length);
  assert.equal(result.archiveListed, true);
  assert.equal(result.archiveContentsVerified, true);
  assert.equal(result.archiveExtracted, false);
  assert.equal(result.independentCopyPending, true);
  assert.equal(result.sqlRestorePending, true);
  assert.equal(result.capacityRebound, false);
  assert.equal(result.started, false);
  assert.equal(result.migrationPerformed, false);
  assert.equal(output, `${JSON.stringify(result)}\n`);
  assert.equal(f.state.dumps, 2);
  assert.equal(f.state.prepares, 2);
  assert.equal(f.state.manifests, 2);
  assert.equal(f.state.compares, 1);
  assert.equal(f.state.copies, 1);
  assert.equal(f.state.verifications, 3);
  assert.equal(f.state.secretReads, 1);
  assert.equal(f.state.identities, 1);
  assert.equal(f.state.clocks, 1);
  assert.deepEqual(f.state.events, ["load", "tools", "secret", "identity", "prepare:manifest.json", "dump:1", "dump:2", "prepare:manifest-after.json", "load"]);
  const receipt = await readCheckpointReceipt(await syntheticScope(f.destination));
  const compressed = await readFile(join(f.destination, "database.sql.gz"));
  assert.deepEqual(gunzipSync(compressed), sql);
  assert.deepEqual(await readFile(join(f.destination, "database.sql")), sql);
  assert.equal(receipt.createdAt, now);
  assert.deepEqual(receipt.schema, { tables: 33, migrations: 33 });
  assert.deepEqual(receipt.sql, { file: "database.sql.gz", bytes: compressed.length, sha256: hash(compressed), uncompressedBytes: sql.length, uncompressedSha256: hash(sql) });
  assert.equal(result.sqlBytes, compressed.length);
  assert.equal(result.sqlSha256, hash(compressed));
  assert.equal(receipt.manifest.sha256, hash(await readFile(join(f.destination, "manifest.json"))));
  assert.deepEqual(receipt.media, { files: [
    { name: mediaName("full"), bytes: f.full.length, sha256: hash(f.full) },
    { name: mediaName("thumb"), bytes: f.thumb.length, sha256: hash(f.thumb) },
  ], bytes: f.full.length + f.thumb.length });
  const archive = await readFile(join(f.destination, "checkpoint.tar.gz"));
  assert.deepEqual(result.archive, { file: "checkpoint.tar.gz", bytes: archive.length, sha256: hash(archive) });
  const extracted = join(f.root, "extracted");
  await mkdir(extracted, { mode: 0o700 });
  await promisify(execFile)("/usr/bin/tar", ["--extract", "--gzip", "--file", join(f.destination, "checkpoint.tar.gz"), "--directory", extracted],
    { env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, timeout: 5000, maxBuffer: 8192 });
  assert.deepEqual((await readdir(extracted)).sort(), ["database.sql.gz", "manifest.json", "media", "receipt.json"]);
  for (const filename of ["manifest.json", "database.sql.gz", "receipt.json", `media/${mediaName("full")}`, `media/${mediaName("thumb")}`]) {
    assert.deepEqual(await readFile(join(extracted, filename)), await readFile(join(f.destination, filename)));
    assert.equal((await lstat(join(f.destination, filename))).mode & 0o7777, 0o600);
  }
  assert.equal((await lstat(f.destination)).mode & 0o7777, 0o700);
  assert.deepEqual(await readFile(join(f.mediaRoot, mediaName("full"))), f.full);
  publicOnly(result, f);
  cleared(f.state);
});

test("application precheck and inspection use existing guarded credentials without password input or files", async (t) => {
  for (const mode of ["check-application", "inspect-application"]) {
    const f = await fixture(t);
    const result = await run(parseArguments(f.command(mode)), { ...f.dependencies, readSecret: () => assert.fail("no personal input in application mode") });
    assert.equal(result.status, mode === "check-application" ? "application_precheck_passed" : "application_inspection_verified");
    assert.equal(result.profile, "messaging-photos-notify-application"); assert.deepEqual(result.coverage, APPLICATION_COVERAGE);
    assert.equal(result.checkpointSaved, false); assert.equal(result.passwordInputRequired, false);
    assert.equal(f.state.secretReads, 0); assert.equal(f.state.prepares, 0); assert.equal(f.state.dumps, 0);
    assert.equal(f.state.identities, mode === "check-application" ? 0 : 1);
    await assert.rejects(lstat(f.destination), { code: "ENOENT" }); publicOnly(result, f); cleared(f.state);
    const invalid = f.command(mode); invalid.push("--inspection-user", "synthetic_inspection");
    assert.throws(() => parseArguments(invalid), { code: "PRIVATE_CHECKPOINT_USAGE" });
  }
});

test("application capture archives the limited manifest and matching coverage receipt without reading a password", { timeout: 15000 }, async (t) => {
  const f = await fixture(t); f.state.application = true;
  Object.assign(f.state.snapshot, { version: 2, coverage: { ...APPLICATION_COVERAGE } });
  const result = await run(parseArguments(f.command("capture-application")), { ...f.dependencies, readSecret: () => assert.fail("no personal input") });
  assert.equal(result.status, "application_checkpoint_saved"); assert.equal(result.profile, "messaging-photos-notify-application");
  assert.deepEqual(result.coverage, APPLICATION_COVERAGE); assert.equal(result.coverage.completeDatabase, false);
  assert.equal(f.state.secretReads, 0); assert.equal(f.state.dumps, 2); assert.equal(f.state.prepares, 2); assert.equal(f.state.compares, 1);
  const receipt = await readCheckpointReceipt(await syntheticScope(f.destination));
  assert.equal(receipt.version, 2); assert.equal(receipt.profile, result.profile); assert.deepEqual(receipt.coverage, APPLICATION_COVERAGE);
  assert.equal(result.archiveContentsVerified, true); assert.equal(result.sqlRestorePending, true); assert.equal(result.independentCopyPending, true);
  publicOnly(result, f); cleared(f.state);
});

test("application capture refuses missing coverage or a strict manifest before dumping data", async (t) => {
  for (const variant of ["missing", "strict", "falsified"]) {
    const f = await fixture(t); f.state.application = true;
    Object.assign(f.state.snapshot, { version: 2, ...(variant === "missing" ? {} : { coverage: { ...APPLICATION_COVERAGE, completeDatabase: variant === "falsified" } }) });
    const prepare = f.dependencies.prepare;
    await assert.rejects(run(parseArguments(f.command("capture-application")), { ...f.dependencies,
      async prepare(...args) {
        const result = await prepare(...args);
        if (variant === "strict") { const file = args[0][3], value = JSON.parse(await readFile(file, "utf8")); value.version = 3; value.profile = "messaging-photos-notify"; await writeFile(file, JSON.stringify(value)); }
        return result;
      } }), neutral);
    assert.equal(f.state.dumps, 0); assert.equal(f.state.secretReads, 0);
    await assert.rejects(lstat(join(f.destination, "checkpoint.tar.gz")), { code: "ENOENT" }); cleared(f.state);
  }
});

test("recovery is an explicit closed selection and leaves old argument records unchanged", async t => {
  const f = await fixture(t);
  assert.deepEqual(Object.keys(parseArguments(f.command("check"))).sort(), ["command", "destination", "inspectionUser", "offline", "privateDirectory", "privatePathMode"].sort());
  for (const profile of ["photos-notify", "photos-notify-recovery-application", "full", "", undefined])
    assert.throws(() => parseArguments([...f.command("check"), "--profile", profile]), { code: "PRIVATE_CHECKPOINT_USAGE" });
  assert.throws(() => parseArguments([...f.command("check"), "--profile", "photos-notify-recovery", "--profile", "photos-notify-recovery"]), { code: "PRIVATE_CHECKPOINT_USAGE" });
  let getter = false; const selection = { ...parseArguments(f.command("check")) };
  Object.defineProperty(selection, "profile", { get() { getter = true; throw new Error("private profile"); } });
  await assert.rejects(run(selection, f.dependencies), { code: "PRIVATE_CHECKPOINT_USAGE" }); assert.equal(getter, false);
});

test("recovery capture authenticates distinct strict/application envelopes while recovery stays disabled", { timeout: 15000 }, async t => {
  for (const application of [false, true]) {
    const f = await fixture(t, { recovery: true }); f.state.application = application;
    if (application) Object.assign(f.state.snapshot, { version: 2, coverage: { ...APPLICATION_COVERAGE } });
    const prepare = f.dependencies.prepare;
    f.dependencies.prepare = async (args, environment, parameters) => {
      assert.equal(environment.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY, "0");
      return prepare(args, environment, parameters);
    };
    const result = await run(parseArguments(f.command(application ? "capture-application" : "capture")), f.dependencies);
    const receipt = await readCheckpointReceipt(await syntheticScope(f.destination));
    assert.equal(result.profile, `messaging-photos-notify-recovery${application ? "-application" : ""}`);
    assert.equal(receipt.profile, result.profile); assert.equal(receipt.version, application ? 4 : 3);
    assert.equal(result.started, false); assert.equal(result.migrationPerformed, false); assert.equal(result.capacityRebound, false);
    assert.equal(result.archiveContentsVerified, true); assert.equal(f.state.secretReads, application ? 0 : 1);
    if (application) assert.deepEqual(receipt.coverage, APPLICATION_COVERAGE);
    publicOnly(result, f); cleared(f.state);
  }
});

test("recovery capture refuses downgraded backup profiles before SQL dumping", async t => {
  for (const application of [false, true]) {
    const f = await fixture(t, { recovery: true }); f.state.application = application;
    if (application) Object.assign(f.state.snapshot, { version: 2, coverage: { ...APPLICATION_COVERAGE } });
    const prepare = f.dependencies.prepare;
    await assert.rejects(run(parseArguments(f.command(application ? "capture-application" : "capture")), { ...f.dependencies,
      async prepare(...args) {
        const result = await prepare(...args), file = args[0][3], manifest = JSON.parse(await readFile(file, "utf8"));
        manifest.version = application ? 4 : 3; manifest.profile = `messaging-photos-notify${application ? "-application" : ""}`;
        await writeFile(file, JSON.stringify(manifest)); return result;
      } }), { code: "PRIVATE_CHECKPOINT_BACKUP" });
    assert.equal(f.state.dumps, 0); await assert.rejects(lstat(join(f.destination, "receipt.json")), { code: "ENOENT" }); cleared(f.state);
  }
});

test("CRM checkpoint capture carries all six keys through strict and application archives, then erases only owned secrets", { timeout: 15000 }, async t => {
  for (const application of [false, true]) {
    const f = await fixture(t, { crm: true }); f.state.application = application;
    if (application) Object.assign(f.state.snapshot, { version: 2, coverage: { ...APPLICATION_COVERAGE } });
    const report = await run(parseArguments(f.command(application ? "capture-application" : "capture")), f.dependencies);
    const receipt = await readCheckpointReceipt(await syntheticScope(f.destination));
    assert.equal(receipt.version, application ? 6 : 5); assert.equal(receipt.profile, `messaging-photos-notify-recovery-crm${application ? "-application" : ""}`);
    assert.equal(report.profile, receipt.profile); assert.equal(report.archiveContentsVerified, true);
    assert.equal(report.started, false); assert.equal(report.migrationPerformed, false); assert.equal(report.capacityRebound, false);
    assert.equal(f.state.secretReads, application ? 0 : 1);
    for (const env of f.state.loaded) assert.equal(env.JESSIEMESSAGE_CRM_KEY, "");
    for (const keys of f.state.keys) assert.equal(keys.crmKey.equals(Buffer.alloc(32)), true);
    publicOnly(report, f); cleared(f.state);
  }
});

test("CRM capture rejects an old five-key envelope before dumping SQL or publishing a receipt", async t => {
  const f = await fixture(t, { crm: true }), prepare = f.dependencies.prepare;
  await assert.rejects(run(parseArguments(f.command()), { ...f.dependencies, prepare: async (...args) => {
    const result = await prepare(...args), file = args[0][3], manifest = JSON.parse(await readFile(file, "utf8"));
    manifest.version = 5; manifest.profile = "messaging-photos-notify-recovery"; await writeFile(file, JSON.stringify(manifest)); return result;
  } }), { code: "PRIVATE_CHECKPOINT_BACKUP" });
  assert.equal(f.state.dumps, 0); await assert.rejects(lstat(join(f.destination, "receipt.json")), { code: "ENOENT" });
  cleared(f.state); assert.equal(f.state.loaded[0].JESSIEMESSAGE_CRM_KEY, "");
});

test("an existing destination is rejected before password input or any database operation", async (t) => {
  const f = await fixture(t);
  await mkdir(f.destination, { mode: 0o700 });
  await writeFile(join(f.destination, "keep"), "existing-checkpoint", { mode: 0o600 });
  await assert.rejects(run(parseArguments(f.command()), f.dependencies), { code: "PRIVATE_CHECKPOINT_DESTINATION" });
  assert.equal(f.state.secretReads, 0);
  assert.equal(f.state.dumps, 0);
  assert.equal(f.state.prepares, 0);
  assert.equal(await readFile(join(f.destination, "keep"), "utf8"), "existing-checkpoint");
  cleared(f.state);
});

test("an inspection failure stops both inspection and capture before creating their destination", async (t) => {
  for (const mode of ["inspect", "capture"]) {
    const f = await fixture(t), inspect = f.dependencies.inspectIdentity;
    let output = "";
    await assert.rejects(main(f.command(mode), { ...f.dependencies,
      async inspectIdentity(...parameters) { await inspect(...parameters); throw new Error("synthetic-inspection-denied"); },
      outputStream: { write(value) { output += value; } } }), neutral);
    assert.equal(output, "");
    assert.equal(f.state.secretReads, 1);
    assert.equal(f.state.identities, 1);
    assert.equal(f.state.dumps, 0);
    assert.equal(f.state.prepares, 0);
    await assert.rejects(lstat(f.destination), { code: "ENOENT" });
    cleared(f.state);
  }
});

test("wrong inspection identity, ambient environment and incomplete runtime profiles fail before input", async (t) => {
  for (const defect of ["identity", "environment", "profile"]) {
    const f = await fixture(t), args = f.command();
    const dependencies = { ...f.dependencies };
    if (defect === "identity") args[args.length - 1] = "synthetic_runtime";
    if (defect === "environment") dependencies.inheritedEnv = { ...dependencies.inheritedEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" };
    if (defect === "profile") {
      const load = dependencies.loadEnvironment;
      dependencies.loadEnvironment = async (...parameters) => {
        const environment = await load(...parameters);
        environment.JESSIEMESSAGE_ENABLE_NOTIFICATIONS = "0";
        return environment;
      };
    }
    await assert.rejects(run(parseArguments(args), dependencies), neutral);
    assert.equal(f.state.secretReads, 0);
    assert.equal(f.state.dumps, 0);
    await assert.rejects(lstat(f.destination), { code: "ENOENT" });
    cleared(f.state);
  }
});

test("SQL drift, manifest drift and failed media copying never publish checkpoint_saved", async (t) => {
  for (const defect of ["dump", "manifest", "copy"]) {
    const f = await fixture(t), dependencies = { ...f.dependencies };
    if (defect === "dump") {
      const dump = dependencies.dump;
      dependencies.dump = async (...parameters) => {
        const result = await dump(...parameters);
        return f.state.dumps === 2 ? { ...result, sqlSha256: "f".repeat(64) } : result;
      };
    }
    if (defect === "manifest") {
      const verify = dependencies.verifyManifest;
      dependencies.verifyManifest = async (...parameters) => {
        const payload = await verify(...parameters);
        if (f.state.prepares === 2) payload.snapshot.coreDigest = "c".repeat(64);
        return payload;
      };
    }
    if (defect === "copy") dependencies.copyMedia = async () => { throw new Error("synthetic-copy-failure"); };
    let output = "";
    await assert.rejects(main(f.command(), { ...dependencies, outputStream: { write(value) { output += value; } } }), neutral);
    assert.equal(output, "");
    assert.equal(f.state.secretReads, 1);
    assert.equal(f.state.dumps, defect === "copy" ? 1 : 2);
    assert.equal(f.state.prepares, defect === "manifest" ? 2 : 1);
    await assert.rejects(lstat(join(f.destination, "receipt.json")), { code: "ENOENT" });
    await assert.rejects(lstat(join(f.destination, "checkpoint.tar.gz")), { code: "ENOENT" });
    assert.equal((await lstat(f.destination)).mode & 0o7777, 0o700);
    cleared(f.state);
  }
});

test("cancellation before work or during copying leaves no success result and erases loaded secrets", async (t) => {
  const early = await fixture(t), before = new AbortController();
  before.abort();
  await assert.rejects(run(parseArguments(early.command()), { ...early.dependencies, signal: before.signal }), { code: "PRIVATE_CHECKPOINT_CANCELLED" });
  assert.equal(early.state.loaded.length, 0);
  assert.equal(early.state.secretReads, 0);
  await assert.rejects(lstat(early.destination), { code: "ENOENT" });
  const f = await fixture(t), running = new AbortController();
  let output = "";
  await assert.rejects(main(f.command(), { ...f.dependencies, signal: running.signal,
    copyMedia: async () => { running.abort(); throw new Error("synthetic-cancellation"); },
    outputStream: { write(value) { output += value; } } }), { code: "PRIVATE_CHECKPOINT_CANCELLED" });
  assert.equal(output, "");
  assert.equal(f.state.dumps, 1);
  await assert.rejects(lstat(join(f.destination, "receipt.json")), { code: "ENOENT" });
  assert.equal((await lstat(f.destination)).mode & 0o7777, 0o700);
  cleared(f.state);
});

test("a nonrepresentable clock fails before receipt publication and clears every source key reference", { timeout: 10000 }, async (t) => {
  const f = await fixture(t);
  await assert.rejects(run(parseArguments(f.command()), { ...f.dependencies, clock: () => -1 }), { code: "PRIVATE_CHECKPOINT_CONFIGURATION" });
  assert.equal(f.state.dumps, 2);
  await assert.rejects(lstat(join(f.destination, "receipt.json")), { code: "ENOENT" });
  cleared(f.state);
});

test("a private configuration key changed during capture prevents success even after the archive exists", { timeout: 10000 }, async (t) => {
  const f = await fixture(t), load = f.dependencies.loadEnvironment;
  let output = "";
  await assert.rejects(main(f.command(), { ...f.dependencies,
    loadEnvironment: async (...parameters) => {
      const environment = await load(...parameters);
      if (f.state.loaded.length === 2) environment.JESSIEMESSAGE_MESSAGE_KEY = key(11);
      return environment;
    }, outputStream: { write(value) { output += value; } } }), { code: "PRIVATE_CHECKPOINT_DRIFT" });
  assert.equal(output, "");
  assert.equal((await lstat(join(f.destination, "checkpoint.tar.gz"))).isFile(), true);
  cleared(f.state);
});

test("Broadcast checkpoint capture carries all six keys through strict and application archives, then erases only owned secrets", { timeout: 15000 }, async t => {
  for (const application of [false, true]) {
    const f = await fixture(t, { broadcast: true }); f.state.application = application;
    if (application) Object.assign(f.state.snapshot, { version: 2, coverage: { ...APPLICATION_COVERAGE } });
    const report = await run(parseArguments(f.command(application ? "capture-application" : "capture")), f.dependencies);
    const receipt = await readCheckpointReceipt(await syntheticScope(f.destination));
    assert.equal(receipt.version, application ? 8 : 7); assert.equal(receipt.profile, `messaging-photos-notify-recovery-crm-broadcast${application ? "-application" : ""}`);
    assert.equal(report.profile, receipt.profile); assert.equal(report.archiveContentsVerified, true);
    assert.equal(report.started, false); assert.equal(report.migrationPerformed, false); assert.equal(report.capacityRebound, false);
    assert.equal(f.state.secretReads, application ? 0 : 1);
    for (const env of f.state.loaded) assert.equal(env.JESSIEMESSAGE_CRM_KEY, "");
    for (const keys of f.state.keys) assert.equal(keys.crmKey.equals(Buffer.alloc(32)), true);
    publicOnly(report, f); cleared(f.state);
  }
});

test("managed operational captures put exact encrypted receipts in the verified native archive for strict and application SQL", { timeout: 15000 }, async t => {
  for (const application of [false, true]) {
    const f = await fixture(t, { broadcast: true }), operationsDirectory = join(f.root, "operations"); await mkdir(operationsDirectory, { mode: 0o700 });
    f.state.application = application;
    Object.assign(f.state.snapshot, { capacity: { rootFingerprint: "b".repeat(64) }, ...(application ? { version: 2, coverage: { ...APPLICATION_COVERAGE } } : {}) });
    const binding = { database: "synthetic_checkpoint", rootFingerprint: "b".repeat(64) }, clientId = "a".repeat(32);
    const journal = createErasureJournal({ directory: operationsDirectory, key: Buffer.alloc(32, 6), binding, clientId }, { withDirectory: withErasureDirectory });
    try { await journal.save({ version: 1, clientId, binding, phase: "requested", cursor: null, startedAt: now, updatedAt: now }, 0, async () => {}); }
    finally { journal.close(); }
    const report = await run(parseArguments([...f.command(application ? "capture-application" : "capture"), "--operations-directory", operationsDirectory]), f.dependencies);
    const scope = await syntheticScope(f.destination), receipt = await readCheckpointReceipt(scope);
    assert.equal(receipt.version, application ? 10 : 9); assert.equal(report.operationsCovered, true); assert.equal(report.operationalFiles, 1);
    assert.equal(report.externalRegistryContinuityVerified, false);
    const recovered = await readOperationalCheckpoint(scope, receipt, Buffer.alloc(32, 6));
    assert.deepEqual(recovered.binding, binding); assert.equal(recovered.files.length, 1);
    const archive = await promisify(execFile)("/usr/bin/tar", ["--list", "--gzip", `--file=${f.destination}/checkpoint.tar.gz`], { encoding: "utf8" });
    assert.ok(archive.stdout.split("\n").includes("operations.enc.json"));
    assert.equal(report.archiveContentsVerified, true); cleared(f.state);
  }
});

test("an operational publication during SQL capture refuses the receipt and never emits checkpoint_saved", async t => {
  const f = await fixture(t, { broadcast: true }), operationsDirectory = join(f.root, "operations"); await mkdir(operationsDirectory, { mode: 0o700 });
  f.state.application = true; Object.assign(f.state.snapshot, { version: 2, coverage: { ...APPLICATION_COVERAGE }, capacity: { rootFingerprint: "b".repeat(64) } });
  const original = f.dependencies.dump;
  await assert.rejects(run(parseArguments([...f.command("capture-application"), "--operations-directory", operationsDirectory]), { ...f.dependencies,
    dump: async (...args) => {
      const result = await original(...args);
      if (f.state.dumps === 2) {
        const clientId = "a".repeat(32), binding = { database: "synthetic_checkpoint", rootFingerprint: "b".repeat(64) };
        const journal = createErasureJournal({ directory: operationsDirectory, key: Buffer.alloc(32, 6), binding, clientId }, { withDirectory: withErasureDirectory });
        try { await journal.save({ version: 1, clientId, binding, phase: "requested", cursor: null, startedAt: now, updatedAt: now }, 0, async () => {}); } finally { journal.close(); }
      }
      return result;
    } }), { code: "PRIVATE_CHECKPOINT_DRIFT" });
  await assert.rejects(lstat(join(f.destination, "receipt.json")), { code: "ENOENT" }); cleared(f.state);
});


test("candidate video capture binds seven keys, SQL36 and both exact ciphertext roots into one verified native archive", async t => {
  const f = await fixture(t, { video: true }); f.state.application = true;
  Object.assign(f.state.snapshot, { version: 3, coverage: VIDEO_APPLICATION_COVERAGE, counts: { tables: 36, rows: 1 },
    video: { capacity: { rootFingerprint: "d".repeat(64) }, assets: [] } });
  const result = await run(parseArguments(f.command("capture-application")), f.dependencies);
  assert.equal(result.status, "application_checkpoint_saved"); assert.equal(result.tables, 36); assert.equal(result.migrations, 36);
  assert.equal(result.videoCovered, true); assert.equal(result.videoFiles, 1); assert.equal(result.videoBytes, 300001);
  assert.equal(result.archiveListed, true); assert.equal(result.archiveContentsVerified, true);
  assert.equal(f.state.secretReads, 0); assert.equal(f.state.dumps, 2);
  const receipt = await readCheckpointReceipt(await syntheticScope(f.destination));
  assert.equal(receipt.version, 11); assert.equal(receipt.profile, "messaging-photos-notify-recovery-crm-broadcast-video-application");
  assert.deepEqual(receipt.coverage, VIDEO_APPLICATION_COVERAGE); assert.equal(receipt.video.files.length, 1);
  const name = `${"9".repeat(64)}.video.enc`;
  assert.deepEqual(await readFile(join(f.destination, "video", name)), await readFile(join(f.videoRoot, name)));
  assert.equal(receipt.video.files[0].sha256, hash(await readFile(join(f.videoRoot, name))));
  for (const environment of f.state.loaded) assert.equal(environment.JESSIEMESSAGE_VIDEO_KEY, "");
  cleared(f.state);
  for (const command of ["capture", "check", "inspect"]) assert.throws(() => parseArguments(f.command(command)), neutral);
});

test("candidate video ciphertext drift after native archive creation never publishes a successful checkpoint result", async t => {
  const f = await fixture(t, { video: true }); f.state.application = true;
  Object.assign(f.state.snapshot, { version: 3, coverage: VIDEO_APPLICATION_COVERAGE, counts: { tables: 36, rows: 1 },
    video: { capacity: { rootFingerprint: "d".repeat(64) }, assets: [] } });
  const archive = f.dependencies.archive;
  f.dependencies.archive = async (...args) => {
    const result = await archive(...args);
    await writeFile(join(f.videoRoot, `${"9".repeat(64)}.video.enc`), Buffer.alloc(300001, 92), { mode: 0o600 });
    return result;
  };
  await assert.rejects(run(parseArguments(f.command("capture-application")), f.dependencies), neutral);
  assert.equal(f.state.dumps, 2); assert.ok((await lstat(join(f.destination, "checkpoint.tar.gz"))).size > 0);
  assert.equal((await readdir(f.videoRoot)).length, 1); cleared(f.state);
});
