import test from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, statfs, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRIMARY_SITE_ORIGIN, readRuntimeNotificationsBundle, writeRuntimeDatabaseConfiguration,
  writeRuntimeAuthenticationConfiguration, writeRuntimeMessagingConfiguration, writeRuntimeMediaConfiguration,
  writeRuntimeNotificationsConfiguration, validateRuntimeAuthenticationConfiguration, validateRuntimeMessagingConfiguration,
  validateRuntimeMediaConfiguration, validateRuntimeNotificationsConfiguration, readRuntimeAuthenticationConfiguration,
} from "../server/config/runtime-database-file.mjs";
import { run, main, parseArguments, PrimaryOriginCandidateError } from "../scripts/prepare-primary-origin.mjs";
import { loadRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url)), origin = "https://recette.jessiemessage.com";
const primary = Object.freeze({ originProfile: "primary" }), inheritedEnv = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" };
const dependencies = { inheritedEnv, execArgv: [] };
const supported = process.platform === "linux" && await statfs("/proc/self/fd", { bigint: true }).then(stats => stats.type === 0x9fa0n, () => false);
const key = byte => Buffer.alloc(32, byte).toString("base64url");
function bundle() {
  const curve = createECDH("prime256v1"); curve.setPrivateKey(Buffer.alloc(32, 7));
  return {
    database: { format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306",
      database: "synthetic_recipe", user: "runtime_user", password: "synthetic-db-secret", privilegeProfile: "infomaniak-shared-pattern" },
    authentication: { format: "jessiemessage-runtime-auth", version: 1, origin, mfaKey: key(1) },
    messaging: { format: "jessiemessage-runtime-messaging", version: 1, origin, mailKey: key(2), messageKey: key(3),
      smtpHost: "smtp.example.invalid", smtpPort: "587", smtpUser: "synthetic-smtp-user", smtpPassword: "synthetic-smtp-secret" },
    media: { format: "jessiemessage-runtime-media", version: 1, origin, mediaKey: key(4), mediaRoot: path.resolve(repository, "../audit/synthetic-photos"),
      ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "536870912" },
    notifications: { version: 1, origin, notificationKey: key(5), vapidPublicKey: curve.getPublicKey(undefined, "uncompressed").toString("base64url"),
      vapidPrivateKey: curve.getPrivateKey().toString("base64url"), vapidSubject: "mailto:contact@jessiemessage.com" },
  };
}
const filenames = ["runtime-database.json", "runtime-auth.json", "runtime-messaging.json", "runtime-media.json", "runtime-notifications.json"];
const records = ["database", "authentication", "messaging", "media", "notifications"];
const validators = [validateRuntimeAuthenticationConfiguration, validateRuntimeMessagingConfiguration, validateRuntimeMediaConfiguration, validateRuntimeNotificationsConfiguration];
const writers = [writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration, writeRuntimeMessagingConfiguration, writeRuntimeMediaConfiguration, writeRuntimeNotificationsConfiguration];
const blocked = error => error instanceof PrimaryOriginCandidateError && error.code === "PRIMARY_ORIGIN_CANDIDATE"
  && error.message === "Primary origin candidate preparation was not confirmed." && error.cause === undefined
  && Object.keys(error).join(",") === "code";
const configBlocked = error => /^RUNTIME_(?:AUTH|MESSAGING|NOTIFICATIONS)_CONFIGURATION$/.test(error.code);
async function fixture(t) {
  const base = path.resolve(repository, "../audit"); await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "primary-origin-")); await chmod(root, 0o700);
  const source = path.join(root, "source"); await mkdir(source, { mode: 0o700 });
  const value = bundle();
  for (let index = 0; index < records.length; index++) await writers[index](source, value[records[index]]);
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = path.join(root, "primary-candidate");
  return { root, source, destination, value, options: { sourcePrivateDirectory: source, destinationPrivateDirectory: destination,
    privatePathMode: "linux-dirfd", originProfile: "primary" } };
}
async function contents(directory) { return Promise.all(filenames.map(name => readFile(path.join(directory, name), "utf8"))); }
async function absent(filename) { await assert.rejects(lstat(filename), { code: "ENOENT" }); }

test("primary syntax is exact and explicit; every existing default still rejects apex", () => {
  const source = bundle();
  for (let index = 0; index < validators.length; index++) {
    const validate = validators[index], value = source[records[index + 1]], final = { ...value, origin: PRIMARY_SITE_ORIGIN };
    assert.deepEqual(validate(value), value); assert.deepEqual(validate(final, primary), final);
    assert.throws(() => validate(final), configBlocked);
    assert.throws(() => validate(value, primary), configBlocked);
    for (const badOrigin of ["https://www.jessiemessage.com", "http://jessiemessage.com", `${PRIMARY_SITE_ORIGIN}/`, `${PRIMARY_SITE_ORIGIN}:443`,
      `${PRIMARY_SITE_ORIGIN}:8443`, `${PRIMARY_SITE_ORIGIN}?secret=synthetic`, "https://jessiemessage.com.example.invalid", "https://JESSIEMESSAGE.com"])
      assert.throws(() => validate({ ...value, origin: badOrigin }, primary), configBlocked);
    let invoked = 0;
    for (const options of [null, [], { originProfile: "production" }, { originProfile: undefined }, { originProfile: "primary", extra: true },
      Object.defineProperty({}, "originProfile", { get() { invoked++; return "primary"; } })]) assert.throws(() => validate(final, options), configBlocked);
    assert.equal(invoked, 0);
  }
});

test("candidate CLI accepts only the fixed explicit profile and clean distinct paths without evaluating accessors", async () => {
  const args = ["prepare", "--source-private-directory", "/private/source", "--destination-private-directory", "/private/candidate",
    "--private-path-mode", "linux-dirfd", "--origin-profile", "primary"];
  const selected = parseArguments(args); assert.equal(selected.originProfile, "primary");
  for (const bad of [[], args.slice(1), [...args, "--start"], args.map(value => value === "primary" ? "production" : value),
    args.map(value => value === "/private/candidate" ? "/private/source" : value),
    args.map(value => value === "/private/candidate" ? "/private" : value),
    args.map(value => value === "/private/candidate" ? "/private/../candidate" : value)]) assert.throws(() => parseArguments(bad), blocked);
  let invoked = 0;
  await assert.rejects(run(Object.defineProperty({ ...selected }, "originProfile", { get() { invoked++; return "primary"; } }), dependencies), blocked);
  assert.equal(invoked, 0);
});

test("existing runtime environment loaders cannot launch a primary candidate", async () => {
  const source = bundle(); for (const name of records.slice(1)) source[name].origin = PRIMARY_SITE_ORIGIN;
  await assert.rejects(loadRuntimeNotificationsEnvironment("/private/candidate", {}, { readBundle: async () => source }), { code: "RUNTIME_NOTIFICATIONS_ENVIRONMENT" });
  assert.equal(source.authentication.mfaKey, key(1));
});

test("Linux CI must run the real candidate file checks", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(supported, true));

test("a new private candidate preserves every source byte, six keys and all values except four origins", { skip: !supported }, async t => {
  const f = await fixture(t), before = await contents(f.source);
  const result = await run(f.options, dependencies);
  assert.deepEqual(result, { status: "candidate_prepared", originProfile: "primary", filesSaved: 5, keysPreserved: true,
    started: false, migrationPerformed: false, launchApproved: false });
  assert.equal(JSON.stringify(result).includes(f.source), false); assert.equal(JSON.stringify(result).includes("synthetic"), false);
  assert.deepEqual(await contents(f.source), before); assert.equal((await lstat(f.destination)).mode & 0o7777, 0o700);
  assert.deepEqual((await readdir(f.destination)).sort(), [...filenames].sort());
  for (const filename of filenames) { const stats = await lstat(path.join(f.destination, filename)); assert.equal(stats.mode & 0o7777, 0o600); assert.equal(stats.nlink, 1); }
  const expected = structuredClone(f.value); for (const name of records.slice(1)) expected[name].origin = PRIMARY_SITE_ORIGIN;
  assert.deepEqual(await readRuntimeNotificationsBundle(f.destination, primary), expected);
  assert.deepEqual(await readRuntimeAuthenticationConfiguration(f.destination, primary), expected.authentication);
  await assert.rejects(readRuntimeNotificationsBundle(f.destination), configBlocked);
  await assert.rejects(readRuntimeAuthenticationConfiguration(f.destination), configBlocked);
  await assert.rejects(writeRuntimeAuthenticationConfiguration(f.root, expected.authentication), configBlocked);
});

test("a fresh child of the source remains isolated and never modifies source files", { skip: !supported }, async t => {
  const f = await fixture(t), before = await contents(f.source), destination = path.join(f.source, "primary-candidate");
  assert.equal((await run({ ...f.options, destinationPrivateDirectory: destination }, dependencies)).status, "candidate_prepared");
  assert.deepEqual(await contents(f.source), before); assert.equal((await readRuntimeNotificationsBundle(destination, primary)).authentication.origin, PRIMARY_SITE_ORIGIN);
});

test("existing files, directories, source aliases and parent symlinks are refused without replacement", { skip: !supported }, async t => {
  const f = await fixture(t), before = await contents(f.source);
  await mkdir(f.destination, { mode: 0o700 }); await writeFile(path.join(f.destination, "keep"), "keep", { mode: 0o600 });
  await assert.rejects(run(f.options, dependencies), blocked); assert.equal(await readFile(path.join(f.destination, "keep"), "utf8"), "keep");
  assert.deepEqual(await readdir(f.destination), ["keep"]);
  const file = path.join(f.root, "file"); await writeFile(file, "keep", { mode: 0o600 });
  await assert.rejects(run({ ...f.options, destinationPrivateDirectory: file }, dependencies), blocked); assert.equal(await readFile(file, "utf8"), "keep");
  const alias = path.join(f.root, "alias"); await symlink(f.source, alias);
  await assert.rejects(run({ ...f.options, destinationPrivateDirectory: alias }, dependencies), blocked);
  await assert.rejects(run({ ...f.options, sourcePrivateDirectory: alias, destinationPrivateDirectory: path.join(f.root, "unused") }, dependencies), blocked);
  await assert.rejects(run({ ...f.options, destinationPrivateDirectory: path.join(alias, "child") }, dependencies), blocked);
  await absent(path.join(f.source, "child")); assert.deepEqual(await contents(f.source), before);
});

test("unprotected/missing parents, source files with unsafe permissions and checkout paths never produce a candidate", { skip: !supported }, async t => {
  const f = await fixture(t);
  const unsafe = path.join(f.root, "unsafe"); await mkdir(unsafe, { mode: 0o755 }); await chmod(unsafe, 0o755);
  for (const destination of [path.join(unsafe, "candidate"), path.join(f.root, "missing", "candidate"), path.join(repository, "candidate"), path.join(repository, "public", "candidate")])
    await assert.rejects(run({ ...f.options, destinationPrivateDirectory: destination }, dependencies), blocked);
  await chmod(path.join(f.source, filenames[0]), 0o644);
  await assert.rejects(run(f.options, dependencies), blocked); await absent(f.destination);
});

test("incoherent source origins and duplicate key domains fail before destination creation", { skip: !supported }, async t => {
  for (const kind of ["origin", "key", "vapid"]) {
    const f = await fixture(t), changed = structuredClone(f.value);
    if (kind === "origin") changed.notifications.origin = "https://other.jessiemessage.com";
    else if (kind === "key") changed.notifications.notificationKey = changed.authentication.mfaKey;
    else changed.authentication.mfaKey = changed.notifications.vapidPrivateKey;
    const index = kind === "vapid" ? 1 : 4;
    await writeFile(path.join(f.source, filenames[index]), JSON.stringify(changed[records[index]]) + "\n", { mode: 0o600 });
    const before = await contents(f.source); await assert.rejects(run(f.options, dependencies), blocked);
    await absent(f.destination); assert.deepEqual(await contents(f.source), before);
  }
});

test("changed or failed readback never reports success and leaves the source intact", { skip: !supported }, async t => {
  for (const kind of ["failed", "changed", "accessor"]) {
    const f = await fixture(t), before = await contents(f.source); let invoked = 0;
    const readBack = async (directory, selected) => {
      assert.deepEqual(selected, primary);
      if (kind === "failed") throw new Error("synthetic-secret-path");
      const value = await readRuntimeNotificationsBundle(directory, selected);
      if (kind === "changed") value.media.ownerBytes = "536870912";
      else Object.defineProperty(value, "database", { get() { invoked++; return f.value.database; } });
      return value;
    };
    await assert.rejects(run(f.options, { ...dependencies, readBack }), blocked);
    assert.equal(invoked, 0); assert.deepEqual(await contents(f.source), before);
  }
});

test("a concurrent source change blocks success after otherwise valid candidate readback", { skip: !supported }, async t => {
  const f = await fixture(t);
  const readBack = async (directory, selected) => {
    const changed = { ...f.value.messaging, smtpPassword: "synthetic-rotated-secret" };
    await writeFile(path.join(f.source, filenames[2]), JSON.stringify(changed) + "\n", { mode: 0o600 });
    return readRuntimeNotificationsBundle(directory, selected);
  };
  await assert.rejects(run(f.options, { ...dependencies, readBack }), blocked);
  assert.equal((await readRuntimeNotificationsBundle(f.source)).messaging.smtpPassword, "synthetic-rotated-secret");
});

test("identical replacement directories cannot substitute for a pinned source or destination inode", { skip: !supported }, async t => {
  for (const kind of ["source", "destination"]) {
    const f = await fixture(t);
    const readBack = async (directory, selected) => {
      const result = await readRuntimeNotificationsBundle(directory, selected), replaced = kind === "source" ? f.source : directory;
      const before = await contents(replaced), moved = `${replaced}-moved`;
      await rename(replaced, moved); await mkdir(replaced, { mode: 0o700 });
      for (let index = 0; index < filenames.length; index++) await writeFile(path.join(replaced, filenames[index]), before[index], { mode: 0o600 });
      return result;
    };
    await assert.rejects(run(f.options, { ...dependencies, readBack }), blocked);
  }
});

test("main writes only the closed success DTO and rejects ambient configuration before directory creation", { skip: !supported }, async t => {
  const f = await fixture(t), args = ["prepare", "--source-private-directory", f.source, "--destination-private-directory", f.destination,
    "--private-path-mode", "linux-dirfd", "--origin-profile", "primary"];
  await assert.rejects(run(f.options, { ...dependencies, inheritedEnv: { ...inheritedEnv, JESSIEMESSAGE_SITE_ORIGIN: PRIMARY_SITE_ORIGIN } }), blocked);
  await absent(f.destination);
  let output = ""; const result = await main(args, { ...dependencies, outputStream: { write(value) { output += value; } } });
  assert.deepEqual(JSON.parse(output), result); assert.equal(output.includes(f.root), false); assert.equal(output.includes("synthetic"), false);
});
