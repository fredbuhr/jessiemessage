import test from "node:test";
import assert from "node:assert/strict";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, statfs, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration,
  writeRuntimeMessagingConfiguration, readRuntimeMessagingConfiguration, readRuntimeMessagingBundle,
  runtimeMessagingConfigurationExists } from "../server/config/runtime-database-file.mjs";

const repository = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const supported = process.platform === "linux" && await statfs("/proc/self/fd", { bigint: true }).then((value) => value.type === 0x9fa0n, () => false);
const key = (byte) => Buffer.alloc(32, byte).toString("base64url");
const origin = "https://recette.jessiemessage.com";
const database = () => ({ format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306",
  database: "ONLY_RECIPE", user: "fixture_runtime", password: "synthetic-database-password", privilegeProfile: "infomaniak-shared-pattern" });
const authentication = () => ({ format: "jessiemessage-runtime-auth", version: 1, origin, mfaKey: key(1) });
const messaging = () => ({ format: "jessiemessage-runtime-messaging", version: 1, origin, mailKey: key(2), messageKey: key(3),
  smtpHost: "smtp.example.invalid", smtpPort: "587", smtpUser: "synthetic-user", smtpPassword: "synthetic-smtp-password" });
const blocked = (error) => error.code === "RUNTIME_MESSAGING_CONFIGURATION" && !JSON.stringify(error).includes("synthetic-");

async function fixture(t) {
  const base = path.resolve(repository, "../audit"); await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "runtime-messaging-file-")); await chmod(root, 0o700);
  const directory = path.join(root, "private"); await mkdir(directory, { mode: 0o700 }); await chmod(directory, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, directory, file: path.join(directory, "runtime-messaging.json") };
}

test("messaging file operations exclude checkout and unclean paths before source access", async () => {
  for (const directory of [repository, path.join(repository, "public"), "relative", "/private/../other", "/private//other", null]) {
    await assert.rejects(writeRuntimeMessagingConfiguration(directory, messaging()), blocked);
    await assert.rejects(readRuntimeMessagingConfiguration(directory), blocked);
    await assert.rejects(readRuntimeMessagingBundle(directory), blocked);
    await assert.rejects(runtimeMessagingConfigurationExists(directory), blocked);
  }
});

test("Linux CI must exercise the real three-file anchored messaging bundle", { skip: !process.env.CI || process.platform !== "linux" }, () => {
  assert.equal(supported, true, "Linux CI requires procfs for messaging configuration tests");
});

test("exclusive owner0600 messaging publication preserves DB/MFA and reads three files under one private anchor", { skip: !supported }, async (t) => {
  const f = await fixture(t); const source = messaging();
  await writeRuntimeDatabaseConfiguration(f.directory, database());
  await writeRuntimeAuthenticationConfiguration(f.directory, authentication());
  const dbBefore = await readFile(path.join(f.directory, "runtime-database.json")), authBefore = await readFile(path.join(f.directory, "runtime-auth.json"));
  assert.equal(await runtimeMessagingConfigurationExists(f.directory), false);
  assert.deepEqual(await writeRuntimeMessagingConfiguration(f.directory, Object.freeze(source)), { saved: true });
  const stats = await lstat(f.file); assert.equal(stats.mode & 0o7777, 0o600); assert.equal(stats.uid, process.getuid()); assert.equal(stats.nlink, 1);
  assert.equal(await runtimeMessagingConfigurationExists(f.directory), true);
  assert.deepEqual(await readRuntimeMessagingBundle(f.directory), { database: database(), authentication: authentication(), messaging: source });
  const saved = await readFile(f.file);
  await assert.rejects(writeRuntimeMessagingConfiguration(f.directory, { ...source, smtpPassword: "changed" }), blocked);
  assert.deepEqual(await readFile(f.file), saved);
  assert.deepEqual(await readFile(path.join(f.directory, "runtime-database.json")), dbBefore);
  assert.deepEqual(await readFile(path.join(f.directory, "runtime-auth.json")), authBefore);
  assert.deepEqual((await readdir(f.directory)).sort(), ["runtime-auth.json", "runtime-database.json", "runtime-messaging.json"]);
  assert.equal(source.smtpPassword, messaging().smtpPassword);
});

test("messaging reads refuse unsafe modes/links/oversize, and any existing name blocks replacement", { skip: !supported }, async (t) => {
  const f = await fixture(t); await writeRuntimeMessagingConfiguration(f.directory, messaging());
  await chmod(f.file, 0o640); await assert.rejects(readRuntimeMessagingConfiguration(f.directory), blocked); await chmod(f.file, 0o600);
  const other = path.join(f.directory, "other"); await link(f.file, other);
  await assert.rejects(readRuntimeMessagingConfiguration(f.directory), blocked); await unlink(other);
  await unlink(f.file); await writeFile(other, JSON.stringify(messaging()), { mode: 0o600 }); await symlink(other, f.file);
  assert.equal(await runtimeMessagingConfigurationExists(f.directory), true);
  await assert.rejects(readRuntimeMessagingConfiguration(f.directory), blocked);
  await assert.rejects(writeRuntimeMessagingConfiguration(f.directory, messaging()), blocked);
  await unlink(f.file); await writeFile(f.file, "x".repeat(16385), { mode: 0o600 });
  await assert.rejects(readRuntimeMessagingConfiguration(f.directory), blocked);
});

test("bundles refuse origin drift and key collision with the existing durable MFA", { skip: !supported }, async (t) => {
  for (const change of [{ origin: "https://other.jessiemessage.com" }, { mailKey: key(1) }, { messageKey: key(1) }]) {
    const f = await fixture(t); await writeRuntimeDatabaseConfiguration(f.directory, database());
    await writeRuntimeAuthenticationConfiguration(f.directory, authentication());
    await writeRuntimeMessagingConfiguration(f.directory, { ...messaging(), ...change });
    await assert.rejects(readRuntimeMessagingBundle(f.directory), blocked);
  }
});
