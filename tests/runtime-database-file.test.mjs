import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, statfs, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RuntimeDatabaseConfigurationError, readRuntimeDatabaseConfiguration, runtimeDatabaseEnvironment,
  validateRuntimeDatabaseConfiguration, writeRuntimeDatabaseConfiguration,
  readRuntimeDiagnosticConfiguration, validateRuntimeDiagnosticConfiguration, writeRuntimeDiagnosticConfiguration,
} from "../server/config/runtime-database-file.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const supported = process.platform === "linux" && await statfs("/proc/self/fd", { bigint: true }).then((value) => value.type === 0x9fa0n, () => false);
const config = () => ({ format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306",
  database: "ONLY_RECIPE", user: "application_account", password: " private ' \" $() ` & é 😀 ", privilegeProfile: "infomaniak-shared" });
const diagnostic = () => ({ format: "jessiemessage-runtime-diagnostic", version: 1,
  createdAt: "2026-10-15T18:00:00.000Z", credentials: config() });
const unavailable = (error) => error instanceof RuntimeDatabaseConfigurationError
  && error.code === "RUNTIME_DATABASE_CONFIGURATION" && error.message === "Private runtime database configuration is unavailable."
  && error.cause === undefined && Object.keys(error).sort().join(",") === "code,name";

test("runtime database files accept exact data fields and clone without changing password bytes", () => {
  const source = config(), result = validateRuntimeDatabaseConfiguration(source);
  assert.deepEqual(result, source); assert.notEqual(result, source);
  result.password = ""; assert.notEqual(source.password, "");
  for (const host of ["127.0.0.1", "::1", "sql.example.invalid"])
    assert.equal(validateRuntimeDatabaseConfiguration({ ...source, host }).host, host);
  for (const privilegeProfile of ["strict", "infomaniak-shared"])
    assert.equal(validateRuntimeDatabaseConfiguration({ ...source, privilegeProfile }).privilegeProfile, privilegeProfile);
  for (const password of [" ", "x".repeat(4096), "é".repeat(2048), "😀".repeat(1024)])
    assert.equal(validateRuntimeDatabaseConfiguration({ ...source, password }).password, password);
});

test("runtime database files reject ambiguous targets, accessors, extensions and malformed secrets with one fixed error", () => {
  const source = config();
  const invalid = [null, [], Object.create(null), { ...source, version: "1" }, { ...source, format: "other" },
    ...[undefined, "", "0001", "03306", "0", "65536", "3306 ", 3306].map((port) => ({ ...source, port })),
    ...["", "server/secret", "user@host", "-bad", "x".repeat(254)].map((host) => ({ ...source, host })),
    ...["", "other.base", "x".repeat(65)].map((database) => ({ ...source, database })),
    ...["", "user@host", "x".repeat(81)].map((user) => ({ ...source, user })),
    ...["", "a\0b", "a\rb", "a\nb", "\ud800", "x".repeat(4097), "é".repeat(2049), "\x01".repeat(4096)].map((password) => ({ ...source, password })),
    ...["", "unknown", undefined].map((privilegeProfile) => ({ ...source, privilegeProfile })),
    { ...source, JESSIEMESSAGE_ENABLE_AUTH: "1" }, { ...source, insecure: true }, { ...source, mfaKey: "private-key" },
    { ...source, [Symbol("private")]: "secret" }, Object.assign(Object.create({ inherited: true }), source)];
  let getterCalled = false;
  invalid.push(Object.defineProperty({ ...source }, "password", { get() { getterCalled = true; throw new Error("private-native-secret"); } }));
  for (const value of invalid) assert.throws(() => validateRuntimeDatabaseConfiguration(value), unavailable);
  assert.equal(getterCalled, false);
  const missing = { ...source }; delete missing.user;
  assert.throws(() => validateRuntimeDatabaseConfiguration(missing), unavailable);
});

test("the derived environment keeps TLS defaults and disables all private features without inheriting process configuration", () => {
  const source = config(), env = runtimeDatabaseEnvironment(source);
  assert.equal(env.JESSIEMESSAGE_DB_NAME, source.database);
  assert.equal(env.JESSIEMESSAGE_APPLICATION_DATABASE, source.database);
  assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, source.password);
  assert.equal(env.JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE, "infomaniak-shared");
  assert.equal(env.JESSIEMESSAGE_PRIVATE_PATH_MODE, "linux-dirfd");
  assert.deepEqual(Object.entries(env).filter(([name]) => name.startsWith("JESSIEMESSAGE_ENABLE_")).map(([, value]) => value), Array(8).fill("0"));
  for (const name of ["JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL", "JESSIEMESSAGE_DB_TLS_CA_PATH", "JESSIEMESSAGE_DB_USER",
    "JESSIEMESSAGE_DB_PASSWORD", "JESSIEMESSAGE_MIGRATION_DATABASE", "JESSIEMESSAGE_MFA_KEY", "PORT", "PATH"])
    assert.equal(Object.hasOwn(env, name), false);
  env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD = ""; assert.notEqual(source.password, "");
});

test("diagnostic records are separately typed, deeply cloned and cannot act as runtime configuration", () => {
  const source = diagnostic(), record = validateRuntimeDiagnosticConfiguration(source);
  assert.deepEqual(record, source); assert.notEqual(record, source); assert.notEqual(record.credentials, source.credentials);
  record.credentials.password = ""; assert.notEqual(source.credentials.password, "");
  assert.throws(() => validateRuntimeDatabaseConfiguration(source), unavailable);
  assert.throws(() => runtimeDatabaseEnvironment(source), unavailable);
  assert.throws(() => validateRuntimeDiagnosticConfiguration(config()), unavailable);
  assert.equal(validateRuntimeDiagnosticConfiguration({ ...source, createdAt: "2000-01-01T00:00:00.000Z" }).createdAt,
    "2000-01-01T00:00:00.000Z");
  const immutable = Object.freeze({ ...source, credentials: Object.freeze({ ...source.credentials }) });
  const mutable = validateRuntimeDiagnosticConfiguration(immutable); mutable.credentials.password = "";
  assert.notEqual(immutable.credentials.password, "");
});

test("diagnostic records reject added privileges, accessors, noncanonical dates and oversized complete envelopes", () => {
  const source = diagnostic(), invalid = [null, [], Object.create(null), { ...source, format: "jessiemessage-runtime-database" },
    { ...source, version: "1" }, { ...source, enabled: true }, { ...source, expiresAt: source.createdAt },
    { ...source, credentials: { ...source.credentials, JESSIEMESSAGE_ENABLE_AUTH: "1" } },
    { ...source, credentials: { ...source.credentials, migrationUser: "admin" } },
    { ...source, credentials: { ...source.credentials, password: "private\nsecret" } },
    { ...source, [Symbol("private")]: true },
    ...[undefined, null, 0, new Date(source.createdAt), "", "invalid", "2026-02-30T00:00:00.000Z",
      "2026-10-15T18:00:00Z", "2026-10-15T20:00:00.000+02:00", "2026-10-15T18:00:00.000Z\n"]
      .map((createdAt) => ({ ...source, createdAt }))];
  let invoked = false;
  invalid.push(Object.defineProperty({ ...source }, "credentials", { get() { invoked = true; throw new Error("private-secret-getter"); } }));
  for (const value of invalid) assert.throws(() => validateRuntimeDiagnosticConfiguration(value), unavailable);
  assert.equal(invoked, false); assert.notEqual(source.credentials.password, "");
  // A nested configuration may fit alone while its diagnostic envelope exceeds the same hard limit.
  let fitsAlone;
  for (let length = 2600; length <= 2730; length += 1) {
    const candidate = { ...source.credentials, password: "\x01".repeat(length) };
    if (Buffer.byteLength(JSON.stringify(candidate)) + 1 <= 16384
      && Buffer.byteLength(JSON.stringify({ ...source, credentials: candidate })) + 1 > 16384) { fitsAlone = candidate; break; }
  }
  assert.ok(fitsAlone); validateRuntimeDatabaseConfiguration(fitsAlone);
  assert.throws(() => validateRuntimeDiagnosticConfiguration({ ...source, credentials: fitsAlone }), unavailable);
});

test("checkout locations and unclean path aliases are rejected before secret file access", async () => {
  for (const directory of [repository, path.join(repository, "public"), path.join(repository, "private-config"),
    "relative", "/private/../other", "/private//other", null]) {
    await assert.rejects(writeRuntimeDatabaseConfiguration(directory, config()), unavailable);
    await assert.rejects(readRuntimeDatabaseConfiguration(directory), unavailable);
    await assert.rejects(writeRuntimeDiagnosticConfiguration(directory, diagnostic()), unavailable);
    await assert.rejects(readRuntimeDiagnosticConfiguration(directory), unavailable);
  }
});

test("Linux CI must exercise real runtime configuration file operations", { skip: !process.env.CI || process.platform !== "linux" }, () => {
  assert.equal(supported, true, "Linux CI requires real procfs for private credential storage tests");
});

async function fixture(t) {
  const base = path.resolve(repository, "../audit");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "runtime-database-file-")), directory = path.join(root, "private");
  await chmod(root, 0o700); await mkdir(directory, { mode: 0o700 }); await chmod(directory, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, directory, filename: path.join(directory, "runtime-database.json") };
}

async function hookOpen(callback, operation) {
  const original = fs.promises.open;
  fs.promises.open = async (...args) => callback(original, args); syncBuiltinESMExports();
  try { return await operation(); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
}

test("a complete private configuration publishes once, has one link and round-trips exact credentials", { skip: !supported }, async (t) => {
  const f = await fixture(t), expected = config();
  assert.deepEqual(await writeRuntimeDatabaseConfiguration(f.directory, expected), { saved: true });
  const metadata = await lstat(f.filename);
  assert.equal(metadata.mode & 0o7777, 0o600); assert.equal(metadata.uid, process.getuid()); assert.equal(metadata.nlink, 1);
  assert.deepEqual(await readdir(f.directory), ["runtime-database.json"]);
  assert.deepEqual(await readRuntimeDatabaseConfiguration(f.directory), expected);
  const before = await readFile(f.filename);
  await assert.rejects(writeRuntimeDatabaseConfiguration(f.directory, { ...expected, password: "replacement" }), unavailable);
  assert.deepEqual(await readFile(f.filename), before);
  assert.deepEqual(await readdir(f.directory), ["runtime-database.json"]);
});

test("symlink, hardlink, FIFO, unsafe modes, oversized bytes and invalid UTF-8 never expose private configuration", { skip: !supported }, async (t) => {
  const f = await fixture(t), foreign = path.join(f.root, "foreign");
  await writeFile(foreign, "foreign-file-keep", { mode: 0o600 });
  await symlink(foreign, f.filename);
  await assert.rejects(readRuntimeDatabaseConfiguration(f.directory), unavailable);
  await assert.rejects(writeRuntimeDatabaseConfiguration(f.directory, config()), unavailable);
  await unlink(f.filename); await link(foreign, f.filename);
  await assert.rejects(readRuntimeDatabaseConfiguration(f.directory), unavailable);
  await unlink(f.filename); assert.equal(await readFile(foreign, "utf8"), "foreign-file-keep");
  const alias = path.join(f.root, "alias"); await symlink(f.directory, alias);
  await assert.rejects(writeRuntimeDatabaseConfiguration(alias, config()), unavailable);
  await assert.rejects(readRuntimeDatabaseConfiguration(alias), unavailable);
  await chmod(f.directory, 0o750);
  await assert.rejects(writeRuntimeDatabaseConfiguration(f.directory, config()), unavailable);
  await chmod(f.directory, 0o700);
  await writeRuntimeDatabaseConfiguration(f.directory, config()); await chmod(f.filename, 0o640);
  await assert.rejects(readRuntimeDatabaseConfiguration(f.directory), unavailable); await chmod(f.filename, 0o600);
  for (const value of [Buffer.alloc(16385, 32), Buffer.from([0xc3, 0x28]), Buffer.from("{}"), Buffer.from("")]) {
    await writeFile(f.filename, value); await assert.rejects(readRuntimeDatabaseConfiguration(f.directory), unavailable);
  }
  await unlink(f.filename); await mkdir(f.filename, { mode: 0o700 });
  await assert.rejects(readRuntimeDatabaseConfiguration(f.directory), unavailable);
  await rmdir(f.filename);
  await promisify(execFile)("mkfifo", ["-m", "600", f.filename]);
  await assert.rejects(readRuntimeDatabaseConfiguration(f.directory), unavailable);
});

test("writes and reads retain the original directory after its pathname is replaced", { skip: !supported }, async (t) => {
  const f = await fixture(t), previous = path.join(f.root, "original"); let replaced = false;
  await hookOpen(async (original, args) => {
    if (!replaced && path.basename(String(args[0])).startsWith(".runtime-database.json.")) {
      replaced = true; await rename(f.directory, previous); await mkdir(f.directory, { mode: 0o700 });
      await writeFile(f.filename, "foreign-file-keep", { mode: 0o600 });
    }
    return original(...args);
  }, () => writeRuntimeDatabaseConfiguration(f.directory, config()));
  assert.equal(replaced, true); assert.equal(await readFile(f.filename, "utf8"), "foreign-file-keep");
  assert.deepEqual(await readRuntimeDatabaseConfiguration(previous), config());
  replaced = false; const next = path.join(f.root, "original-read");
  const result = await hookOpen(async (original, args) => {
    if (!replaced && path.basename(String(args[0])) === "runtime-database.json") {
      replaced = true; await rename(previous, next); await mkdir(previous, { mode: 0o700 });
      await writeFile(path.join(previous, "runtime-database.json"), "foreign-read-keep", { mode: 0o600 });
    }
    return original(...args);
  }, () => readRuntimeDatabaseConfiguration(previous));
  assert.equal(replaced, true); assert.deepEqual(result, config());
  assert.equal(await readFile(path.join(previous, "runtime-database.json"), "utf8"), "foreign-read-keep");
});

test("concurrent publication has one winner and every opened descriptor is closed", { skip: !supported }, async (t) => {
  const f = await fixture(t); let opened = 0, closed = 0;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle); opened += 1;
    handle.close = async () => { await close(); closed += 1; }; return handle;
  }, async () => {
    const results = await Promise.allSettled([writeRuntimeDatabaseConfiguration(f.directory, config()), writeRuntimeDatabaseConfiguration(f.directory, config())]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected" && unavailable(result.reason)).length, 1);
    assert.deepEqual(await readRuntimeDatabaseConfiguration(f.directory), config());
  });
  assert.ok(opened > 3); assert.equal(opened, closed);
  assert.deepEqual(await readdir(f.directory), ["runtime-database.json"]);
});

test("a prepublication sync failure removes only its own temporary file and closes every descriptor", { skip: !supported }, async (t) => {
  const f = await fixture(t); let opened = 0, closed = 0, injected = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle); opened += 1;
    handle.close = async () => { await close(); closed += 1; };
    if (path.basename(String(args[0])).startsWith(".runtime-database.json."))
      handle.sync = async () => { injected = true; throw new Error("private-secret-sync-failure"); };
    return handle;
  }, () => assert.rejects(writeRuntimeDatabaseConfiguration(f.directory, config()), unavailable));
  assert.equal(injected, true); assert.equal(opened, closed); assert.deepEqual(await readdir(f.directory), []);
});

test("an uncertain directory sync preserves the published private copy and reports failure", { skip: !supported }, async (t) => {
  const f = await fixture(t); let injected = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith("/private")) handle.sync = async () => { injected = true; throw new Error("private-directory-sync-failure"); };
    return handle;
  }, () => assert.rejects(writeRuntimeDatabaseConfiguration(f.directory, config()), unavailable));
  assert.equal(injected, true);
  assert.deepEqual(await readRuntimeDatabaseConfiguration(f.directory), config());
  assert.deepEqual(await readdir(f.directory), ["runtime-database.json"]);
});

test("cleanup preserves a foreign file that replaced the owned temporary name", { skip: !supported }, async (t) => {
  const f = await fixture(t); let replaced = false, temporaryName;
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (path.basename(String(args[0])).startsWith(".runtime-database.json.")) {
      const sync = handle.sync.bind(handle); temporaryName = path.basename(String(args[0]));
      handle.sync = async () => {
        await sync(); replaced = true;
        await rename(String(args[0]), path.join(f.root, "retained-owned-file"));
        await writeFile(String(args[0]), "foreign-cleanup-keep", { mode: 0o600 });
      };
    }
    return handle;
  }, () => assert.rejects(writeRuntimeDatabaseConfiguration(f.directory, config()), unavailable));
  assert.equal(replaced, true);
  assert.equal(await readFile(path.join(f.directory, temporaryName), "utf8"), "foreign-cleanup-keep");
  await assert.rejects(lstat(f.filename), { code: "ENOENT" });
});

test("a file replaced during reading is refused and read errors close all descriptors", { skip: !supported }, async (t) => {
  const f = await fixture(t); await writeRuntimeDatabaseConfiguration(f.directory, config());
  let opened = 0, closed = 0, replaced = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle); opened += 1;
    handle.close = async () => { await close(); closed += 1; };
    if (path.basename(String(args[0])) === "runtime-database.json") {
      const read = handle.read.bind(handle);
      handle.read = async (...parameters) => {
        const result = await read(...parameters);
        if (!replaced) {
          replaced = true; await rename(f.filename, path.join(f.root, "previous-file"));
          await writeFile(f.filename, "foreign-read-keep", { mode: 0o600 });
        }
        return result;
      };
    }
    return handle;
  }, () => assert.rejects(readRuntimeDatabaseConfiguration(f.directory), unavailable));
  assert.equal(replaced, true); assert.equal(opened, closed);
  assert.equal(await readFile(f.filename, "utf8"), "foreign-read-keep");
});

test("foreign ownership and descriptor close failures are masked without leaking or overwriting credentials", { skip: !supported }, async (t) => {
  const f = await fixture(t); await writeRuntimeDatabaseConfiguration(f.directory, config());
  let injected = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (path.basename(String(args[0])) === "runtime-database.json") {
      const stat = handle.stat.bind(handle);
      handle.stat = async (...parameters) => { injected = true; return { ...await stat(...parameters), isFile: () => true, uid: BigInt(process.getuid()) + 1n }; };
    }
    return handle;
  }, () => assert.rejects(readRuntimeDatabaseConfiguration(f.directory), unavailable));
  assert.equal(injected, true); injected = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (path.basename(String(args[0])) === "runtime-database.json") {
      const close = handle.close.bind(handle);
      handle.close = async () => { await close(); injected = true; throw new Error("private-native-close-secret"); };
    }
    return handle;
  }, () => assert.rejects(readRuntimeDatabaseConfiguration(f.directory), unavailable));
  assert.equal(injected, true);
  assert.deepEqual(await readRuntimeDatabaseConfiguration(f.directory), config());
});

test("diagnostic capture publishes only its separate private file and never enables or overwrites runtime configuration", { skip: !supported }, async (t) => {
  const f = await fixture(t), source = diagnostic(), diagnosticFile = path.join(f.directory, "runtime-diagnostic.json");
  assert.deepEqual(await writeRuntimeDiagnosticConfiguration(f.directory, source), { saved: true });
  assert.notEqual(source.credentials.password, "");
  assert.deepEqual(await readdir(f.directory), ["runtime-diagnostic.json"]);
  await assert.rejects(lstat(f.filename), { code: "ENOENT" });
  await assert.rejects(readRuntimeDatabaseConfiguration(f.directory), unavailable);
  await assert.rejects(writeRuntimeDatabaseConfiguration(f.directory, source), unavailable);
  const record = await readRuntimeDiagnosticConfiguration(f.directory);
  assert.deepEqual(record, source); record.credentials.password = "";
  assert.deepEqual(await readRuntimeDiagnosticConfiguration(f.directory), source);
  const metadata = await lstat(diagnosticFile);
  assert.equal(metadata.mode & 0o7777, 0o600); assert.equal(metadata.nlink, 1); assert.equal(metadata.uid, process.getuid());
  const bytes = await readFile(diagnosticFile);
  await assert.rejects(writeRuntimeDiagnosticConfiguration(f.directory, { ...source, createdAt: "2026-10-16T18:00:00.000Z" }), unavailable);
  assert.deepEqual(await readFile(diagnosticFile), bytes);
  await writeRuntimeDatabaseConfiguration(f.directory, source.credentials);
  assert.deepEqual(await readRuntimeDatabaseConfiguration(f.directory), source.credentials);
  assert.deepEqual(await readRuntimeDiagnosticConfiguration(f.directory), source);
});

test("normal and diagnostic readers refuse each other's on-disk formats even under the expected basename", { skip: !supported }, async (t) => {
  const f = await fixture(t), diagnosticFile = path.join(f.directory, "runtime-diagnostic.json");
  await writeFile(f.filename, JSON.stringify(diagnostic()), { mode: 0o600 });
  await writeFile(diagnosticFile, JSON.stringify(config()), { mode: 0o600 });
  await assert.rejects(readRuntimeDatabaseConfiguration(f.directory), unavailable);
  await assert.rejects(readRuntimeDiagnosticConfiguration(f.directory), unavailable);
  await chmod(diagnosticFile, 0o640);
  await assert.rejects(readRuntimeDiagnosticConfiguration(f.directory), unavailable);
  await chmod(diagnosticFile, 0o600);
  await writeFile(diagnosticFile, Buffer.alloc(16385, 32));
  await assert.rejects(readRuntimeDiagnosticConfiguration(f.directory), unavailable);
});

test("failed diagnostic capture cleans only its owned temporary inode and closes all descriptors", { skip: !supported }, async (t) => {
  const f = await fixture(t), source = diagnostic(); let opened = 0, closed = 0, injected = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle); opened += 1;
    handle.close = async () => { await close(); closed += 1; };
    if (path.basename(String(args[0])).startsWith(".runtime-diagnostic.json."))
      handle.sync = async () => { injected = true; throw new Error("private-diagnostic-secret-fsync"); };
    return handle;
  }, () => assert.rejects(writeRuntimeDiagnosticConfiguration(f.directory, source), unavailable));
  assert.equal(injected, true); assert.equal(opened, closed); assert.notEqual(source.credentials.password, "");
  assert.deepEqual(await readdir(f.directory), []);
  await assert.rejects(lstat(f.filename), { code: "ENOENT" });
});

test("diagnostic cleanup leaves a foreign replacement inode intact and does not publish normal configuration", { skip: !supported }, async (t) => {
  const f = await fixture(t); let replaced = false, temporaryName;
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (path.basename(String(args[0])).startsWith(".runtime-diagnostic.json.")) {
      const sync = handle.sync.bind(handle); temporaryName = path.basename(String(args[0]));
      handle.sync = async () => {
        await sync(); replaced = true; await rename(String(args[0]), path.join(f.root, "retained-diagnostic-inode"));
        await writeFile(String(args[0]), "foreign-diagnostic-keep", { mode: 0o600 });
      };
    }
    return handle;
  }, () => assert.rejects(writeRuntimeDiagnosticConfiguration(f.directory, diagnostic()), unavailable));
  assert.equal(replaced, true);
  assert.equal(await readFile(path.join(f.directory, temporaryName), "utf8"), "foreign-diagnostic-keep");
  await assert.rejects(lstat(f.filename), { code: "ENOENT" });
  await assert.rejects(lstat(path.join(f.directory, "runtime-diagnostic.json")), { code: "ENOENT" });
});

test("uncertain diagnostic durability preserves its private copy without creating the normal file", { skip: !supported }, async (t) => {
  const f = await fixture(t); let injected = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith("/private")) handle.sync = async () => { injected = true; throw new Error("private-diagnostic-directory-sync"); };
    return handle;
  }, () => assert.rejects(writeRuntimeDiagnosticConfiguration(f.directory, diagnostic()), unavailable));
  assert.equal(injected, true);
  assert.deepEqual(await readRuntimeDiagnosticConfiguration(f.directory), diagnostic());
  await assert.rejects(lstat(f.filename), { code: "ENOENT" });
  assert.deepEqual(await readdir(f.directory), ["runtime-diagnostic.json"]);
});
