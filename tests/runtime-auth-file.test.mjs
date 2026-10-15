import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, statfs, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RuntimeAuthenticationConfigurationError, validateRuntimeAuthenticationConfiguration,
  writeRuntimeAuthenticationConfiguration, readRuntimeAuthenticationConfiguration,
  readRuntimeAuthenticationBundle, runtimeAuthenticationConfigurationExists,
  validateRuntimeDatabaseConfiguration, validateRuntimeDiagnosticConfiguration,
  readRuntimeDatabaseConfiguration, writeRuntimeDatabaseConfiguration, writeRuntimeDiagnosticConfiguration,
} from "../server/config/runtime-database-file.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supported = process.platform === "linux" && await statfs("/proc/self/fd", { bigint: true }).then((value) => value.type === 0x9fa0n, () => false);
const authentication = () => ({ format: "jessiemessage-runtime-auth", version: 1,
  origin: "https://recette.jessiemessage.com", mfaKey: Buffer.alloc(32, 7).toString("base64url") });
const database = () => ({ format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306",
  database: "ONLY_RECIPE", user: "application_account", password: "synthetic-private-password", privilegeProfile: "infomaniak-shared-pattern" });
const diagnostic = () => ({ format: "jessiemessage-runtime-diagnostic", version: 1,
  createdAt: "2026-10-15T18:00:00.000Z", credentials: database() });
const unavailable = (error) => error instanceof RuntimeAuthenticationConfigurationError
  && error.code === "RUNTIME_AUTH_CONFIGURATION" && error.message === "Private authentication configuration is unavailable."
  && error.cause === undefined && Object.keys(error).sort().join(",") === "code,name";

test("authentication records contain only a canonical official subdomain and canonical 32-byte key", () => {
  const source = authentication(), selected = validateRuntimeAuthenticationConfiguration(Object.freeze(source));
  assert.deepEqual(selected, source); assert.notEqual(selected, source);
  selected.mfaKey = ""; assert.notEqual(source.mfaKey, "");
  for (const origin of ["https://recette.jessiemessage.com", "https://a-b.recette.jessiemessage.com"])
    assert.equal(validateRuntimeAuthenticationConfiguration({ ...source, origin }).origin, origin);
});

test("authentication records reject source accessors, inherited or extra fields and invalid secret encodings", () => {
  const source = authentication(), invalid = [null, [], Object.create(null), { ...source, version: "1" },
    { ...source, format: "jessiemessage-runtime-database" }, { ...source, password: "do-not-persist" },
    { ...source, JESSIEMESSAGE_ENABLE_AUTH: "1" }, { ...source, host: "sql.example.invalid" },
    { ...source, [Symbol("secret")]: true }, Object.assign(Object.create({ inherited: true }), source),
    ...[undefined, null, Buffer.alloc(32), "", "A".repeat(42), "A".repeat(44), "A".repeat(42) + "B",
      source.mfaKey + "=", "x".repeat(42) + "/", source.mfaKey + "\n"].map((mfaKey) => ({ ...source, mfaKey }))];
  let called = false;
  for (const name of ["origin", "mfaKey"])
    invalid.push(Object.defineProperty({ ...source }, name, { get() { called = true; throw new Error("private-secret-accessor"); } }));
  for (const value of invalid) assert.throws(() => validateRuntimeAuthenticationConfiguration(value), unavailable);
  assert.equal(called, false); assert.notEqual(source.mfaKey, "");
  const missing = { ...source }; delete missing.origin;
  assert.throws(() => validateRuntimeAuthenticationConfiguration(missing), unavailable);
});

test("authentication origin rejects apex, www, noncanonical URLs, foreign domains and custom ports", () => {
  const source = authentication();
  for (const origin of [undefined, {}, "https://jessiemessage.com", "https://www.jessiemessage.com", "http://recette.jessiemessage.com",
    "https://RECETTE.jessiemessage.com", "https://recette.jessiemessage.com:443", "https://recette.jessiemessage.com:8443",
    "https://recette.jessiemessage.com/", "https://recette.jessiemessage.com?x=1", "https://recette.jessiemessage.com#secret",
    "https://user:password@recette.jessiemessage.com", "https://user@recette.jessiemessage.com",
    "https://jessiemessage.com.example.invalid", "https://recette.example.invalid", "https://127.0.0.1",
    "https://-invalid.jessiemessage.com", "https://a..jessiemessage.com", "https://recette.jessiemessage.com."])
    assert.throws(() => validateRuntimeAuthenticationConfiguration({ ...source, origin }), unavailable);
});

test("authentication, normal database and diagnostic record formats cannot substitute for one another", () => {
  for (const source of [database(), diagnostic()]) assert.throws(() => validateRuntimeAuthenticationConfiguration(source), unavailable);
  assert.throws(() => validateRuntimeDatabaseConfiguration(authentication()), { code: "RUNTIME_DATABASE_CONFIGURATION" });
  assert.throws(() => validateRuntimeDiagnosticConfiguration(authentication()), { code: "RUNTIME_DATABASE_CONFIGURATION" });
});

test("all authentication file operations reject checkout paths and unclean aliases without exposing inputs", async () => {
  for (const directory of [repository, path.join(repository, "public"), path.join(repository, "private"),
    "relative", "/private/../other", "/private//other", null]) {
    await assert.rejects(writeRuntimeAuthenticationConfiguration(directory, authentication()), unavailable);
    await assert.rejects(readRuntimeAuthenticationConfiguration(directory), unavailable);
    await assert.rejects(readRuntimeAuthenticationBundle(directory), unavailable);
    await assert.rejects(runtimeAuthenticationConfigurationExists(directory), unavailable);
  }
});

test("Linux CI must exercise authentication file and same-directory bundle operations", { skip: !process.env.CI || process.platform !== "linux" }, () => {
  assert.equal(supported, true, "Linux CI requires real procfs for authentication configuration file tests");
});

async function fixture(t) {
  const base = path.resolve(repository, "../audit");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "runtime-auth-file-")), directory = path.join(root, "private");
  await chmod(root, 0o700); await mkdir(directory, { mode: 0o700 }); await chmod(directory, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, directory, filename: path.join(directory, "runtime-auth.json"), databaseFile: path.join(directory, "runtime-database.json") };
}

async function hookOpen(callback, operation) {
  const original = fs.promises.open;
  fs.promises.open = async (...args) => callback(original, args); syncBuiltinESMExports();
  try { return await operation(); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
}

test("authentication publication is private and exclusive and never changes caller-owned secrets", { skip: !supported }, async (t) => {
  const f = await fixture(t), source = authentication();
  assert.equal(await runtimeAuthenticationConfigurationExists(f.directory), false);
  assert.deepEqual(await writeRuntimeAuthenticationConfiguration(f.directory, Object.freeze(source)), { saved: true });
  assert.equal(await runtimeAuthenticationConfigurationExists(f.directory), true);
  const metadata = await lstat(f.filename);
  assert.equal(metadata.mode & 0o7777, 0o600); assert.equal(metadata.uid, process.getuid()); assert.equal(metadata.nlink, 1);
  assert.deepEqual(await readdir(f.directory), ["runtime-auth.json"]);
  assert.deepEqual(await readRuntimeAuthenticationConfiguration(f.directory), source); assert.notEqual(source.mfaKey, "");
  const bytes = await readFile(f.filename);
  await assert.rejects(writeRuntimeAuthenticationConfiguration(f.directory, { ...source, mfaKey: Buffer.alloc(32, 9).toString("base64url") }), unavailable);
  assert.deepEqual(await readFile(f.filename), bytes);
  await assert.rejects(readRuntimeDatabaseConfiguration(f.directory), { code: "RUNTIME_DATABASE_CONFIGURATION" });
});

test("presence checks recognize every existing entry but report absence only when the name is missing", { skip: !supported }, async (t) => {
  const f = await fixture(t), missing = path.join(f.root, "missing");
  assert.equal(await runtimeAuthenticationConfigurationExists(f.directory), false);
  await writeFile(f.filename, "invalid-json", { mode: 0o600 });
  assert.equal(await runtimeAuthenticationConfigurationExists(f.directory), true); await unlink(f.filename);
  await symlink(missing, f.filename); assert.equal(await runtimeAuthenticationConfigurationExists(f.directory), true); await unlink(f.filename);
  await mkdir(f.filename, { mode: 0o700 }); assert.equal(await runtimeAuthenticationConfigurationExists(f.directory), true);
  await rm(f.filename, { recursive: true });
  const original = fs.promises.lstat;
  fs.promises.lstat = async (...args) => {
    if (path.basename(String(args[0])) === "runtime-auth.json") { const error = new Error("private-presence-denied"); error.code = "EACCES"; throw error; }
    return original(...args);
  }; syncBuiltinESMExports();
  try { await assert.rejects(runtimeAuthenticationConfigurationExists(f.directory), unavailable); }
  finally { fs.promises.lstat = original; syncBuiltinESMExports(); }
});

test("the authentication bundle reads normal SQL and authentication through one held private directory descriptor", { skip: !supported }, async (t) => {
  const f = await fixture(t); await writeRuntimeDatabaseConfiguration(f.directory, database()); await writeRuntimeAuthenticationConfiguration(f.directory, authentication());
  const descriptors = []; let opened = 0, closed = 0;
  const result = await hookOpen(async (original, args) => {
    const match = /^\/proc\/self\/fd\/(\d+)\/runtime-(database|auth)\.json$/.exec(String(args[0]));
    if (match) descriptors.push(match[1]);
    const handle = await original(...args), close = handle.close.bind(handle); opened += 1;
    handle.close = async () => { await close(); closed += 1; }; return handle;
  }, () => readRuntimeAuthenticationBundle(f.directory));
  assert.deepEqual(result, { database: database(), authentication: authentication() });
  assert.equal(descriptors.length, 2); assert.equal(descriptors[0], descriptors[1]); assert.equal(opened, closed);
  result.database.password = ""; result.authentication.mfaKey = "";
  assert.deepEqual(await readRuntimeAuthenticationBundle(f.directory), { database: database(), authentication: authentication() });
});

test("replacing the private root between bundle reads cannot mix SQL and authentication from different directories", { skip: !supported }, async (t) => {
  const f = await fixture(t), previous = path.join(f.root, "original");
  await writeRuntimeDatabaseConfiguration(f.directory, database()); await writeRuntimeAuthenticationConfiguration(f.directory, authentication());
  let replaced = false;
  const result = await hookOpen(async (original, args) => {
    if (!replaced && path.basename(String(args[0])) === "runtime-auth.json") {
      replaced = true; await rename(f.directory, previous); await mkdir(f.directory, { mode: 0o700 });
      await writeFile(f.databaseFile, JSON.stringify({ ...database(), password: "foreign-password" }), { mode: 0o600 });
      await writeFile(f.filename, JSON.stringify({ ...authentication(), mfaKey: Buffer.alloc(32, 99).toString("base64url") }), { mode: 0o600 });
    }
    return original(...args);
  }, () => readRuntimeAuthenticationBundle(f.directory));
  assert.equal(replaced, true); assert.deepEqual(result, { database: database(), authentication: authentication() });
  assert.equal(JSON.parse(await readFile(f.databaseFile, "utf8")).password, "foreign-password");
  assert.equal(JSON.parse(await readFile(f.filename, "utf8")).mfaKey, Buffer.alloc(32, 99).toString("base64url"));
});

test("authentication reads reject unsafe links, modes, nonregular files, oversized bytes and wrong formats", { skip: !supported }, async (t) => {
  const f = await fixture(t), foreign = path.join(f.root, "foreign");
  await writeFile(foreign, JSON.stringify(authentication()), { mode: 0o600 }); await symlink(foreign, f.filename);
  await assert.rejects(readRuntimeAuthenticationConfiguration(f.directory), unavailable);
  await unlink(f.filename); await link(foreign, f.filename);
  await assert.rejects(readRuntimeAuthenticationConfiguration(f.directory), unavailable); await unlink(f.filename);
  await writeRuntimeAuthenticationConfiguration(f.directory, authentication()); await chmod(f.filename, 0o640);
  await assert.rejects(readRuntimeAuthenticationConfiguration(f.directory), unavailable); await chmod(f.filename, 0o600);
  for (const bytes of [Buffer.alloc(16385, 32), Buffer.from([0xc3, 0x28]), Buffer.from(JSON.stringify(database())), Buffer.from(JSON.stringify(diagnostic()))]) {
    await writeFile(f.filename, bytes); await assert.rejects(readRuntimeAuthenticationConfiguration(f.directory), unavailable);
  }
  await unlink(f.filename); await mkdir(f.filename, { mode: 0o700 });
  await assert.rejects(readRuntimeAuthenticationConfiguration(f.directory), unavailable);
});

test("bundles refuse missing or invalid records, never use diagnostic credentials, and close every descriptor on failure", { skip: !supported }, async (t) => {
  const f = await fixture(t); await writeRuntimeDiagnosticConfiguration(f.directory, diagnostic());
  await writeRuntimeAuthenticationConfiguration(f.directory, authentication());
  await assert.rejects(readRuntimeAuthenticationBundle(f.directory), unavailable);
  await writeRuntimeDatabaseConfiguration(f.directory, database()); await writeFile(f.filename, JSON.stringify(database()));
  let opened = 0, closed = 0;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle); opened += 1;
    handle.close = async () => { await close(); closed += 1; }; return handle;
  }, () => assert.rejects(readRuntimeAuthenticationBundle(f.directory), unavailable));
  assert.ok(opened > 2); assert.equal(opened, closed);
});

test("failed authentication writes clean their temporary inode and preserve the existing normal SQL file", { skip: !supported }, async (t) => {
  const f = await fixture(t); await writeRuntimeDatabaseConfiguration(f.directory, database());
  const originalDatabase = await readFile(f.databaseFile); let opened = 0, closed = 0, injected = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle); opened += 1;
    handle.close = async () => { await close(); closed += 1; };
    if (path.basename(String(args[0])).startsWith(".runtime-auth.json."))
      handle.sync = async () => { injected = true; throw new Error("private-MFA-sync-failure"); };
    return handle;
  }, () => assert.rejects(writeRuntimeAuthenticationConfiguration(f.directory, authentication()), unavailable));
  assert.equal(injected, true); assert.equal(opened, closed);
  assert.deepEqual(await readdir(f.directory), ["runtime-database.json"]); assert.deepEqual(await readFile(f.databaseFile), originalDatabase);
});

test("authentication cleanup never deletes a foreign replacement inode", { skip: !supported }, async (t) => {
  const f = await fixture(t); let replaced = false, name;
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (path.basename(String(args[0])).startsWith(".runtime-auth.json.")) {
      const sync = handle.sync.bind(handle); name = path.basename(String(args[0]));
      handle.sync = async () => {
        await sync(); replaced = true; await rename(String(args[0]), path.join(f.root, "owned-auth-inode"));
        await writeFile(String(args[0]), "foreign-file-keep", { mode: 0o600 });
      };
    }
    return handle;
  }, () => assert.rejects(writeRuntimeAuthenticationConfiguration(f.directory, authentication()), unavailable));
  assert.equal(replaced, true); assert.equal(await readFile(path.join(f.directory, name), "utf8"), "foreign-file-keep");
  await assert.rejects(lstat(f.filename), { code: "ENOENT" });
});

test("uncertain authentication publication durability preserves the sole private key copy", { skip: !supported }, async (t) => {
  const f = await fixture(t); let injected = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith("/private")) handle.sync = async () => { injected = true; throw new Error("private-auth-directory-sync-failure"); };
    return handle;
  }, () => assert.rejects(writeRuntimeAuthenticationConfiguration(f.directory, authentication()), unavailable));
  assert.equal(injected, true); assert.deepEqual(await readRuntimeAuthenticationConfiguration(f.directory), authentication());
  assert.deepEqual(await readdir(f.directory), ["runtime-auth.json"]);
});

test("authentication and bundle descriptor close failures remain fixed errors with no secret-bearing result", { skip: !supported }, async (t) => {
  const f = await fixture(t); await writeRuntimeDatabaseConfiguration(f.directory, database()); await writeRuntimeAuthenticationConfiguration(f.directory, authentication());
  let injected = 0;
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (path.basename(String(args[0])) === "runtime-auth.json") {
      const close = handle.close.bind(handle);
      handle.close = async () => { await close(); injected += 1; throw new Error("private-MFA-close-failure"); };
    }
    return handle;
  }, async () => {
    await assert.rejects(readRuntimeAuthenticationConfiguration(f.directory), unavailable);
    await assert.rejects(readRuntimeAuthenticationBundle(f.directory), unavailable);
  });
  assert.equal(injected, 2);
});
