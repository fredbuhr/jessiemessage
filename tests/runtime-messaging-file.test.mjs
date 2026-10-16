import test from "node:test";
import assert from "node:assert/strict";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, statfs, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration,
  writeRuntimeMessagingConfiguration, readRuntimeMessagingConfiguration, readRuntimeMessagingBundle,
  runtimeMessagingConfigurationExists, replaceRuntimeMessagingSmtpPassword, writeRuntimeMediaConfiguration,
  readRuntimeMediaConfiguration, readRuntimeMediaBundle, runtimeMediaConfigurationExists } from "../server/config/runtime-database-file.mjs";

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

test("exclusive media configuration is owner0600, preserves all three existing files and refuses replacement", { skip: !supported }, async (t) => {
  const f = await fixture(t), media = { format: "jessiemessage-runtime-media", version: 1, origin, mediaKey: key(4),
    mediaRoot: path.join(f.root, "media"), ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "536870912" };
  await writeRuntimeDatabaseConfiguration(f.directory, database()); await writeRuntimeAuthenticationConfiguration(f.directory, authentication());
  await writeRuntimeMessagingConfiguration(f.directory, messaging());
  const oldNames = ["runtime-database.json", "runtime-auth.json", "runtime-messaging.json"];
  const before = await Promise.all(oldNames.map(name => readFile(path.join(f.directory, name))));
  assert.equal(await runtimeMediaConfigurationExists(f.directory), false);
  await writeRuntimeMediaConfiguration(f.directory, media);
  assert.equal(await runtimeMediaConfigurationExists(f.directory), true);
  const filename = path.join(f.directory, "runtime-media.json"), stat = await lstat(filename);
  assert.equal(stat.mode & 0o7777, 0o600); assert.equal(stat.uid, process.getuid()); assert.equal(stat.nlink, 1);
  assert.deepEqual(await readRuntimeMediaBundle(f.directory), { database: database(), authentication: authentication(), messaging: messaging(), media });
  await assert.rejects(writeRuntimeMediaConfiguration(f.directory, { ...media, mediaKey: key(9) }), blocked);
  assert.deepEqual(await readRuntimeMediaConfiguration(f.directory), media);
  assert.deepEqual(await Promise.all(oldNames.map(name => readFile(path.join(f.directory, name)))), before);
  await chmod(filename, 0o640); await assert.rejects(readRuntimeMediaBundle(f.directory), blocked);
});

test("anchored photo bundles refuse key reuse, origin drift and symlinked media files", { skip: !supported }, async (t) => {
  for (const change of [{ mediaKey: key(1) }, { mediaKey: key(2) }, { mediaKey: key(3) }, { origin: "https://other.jessiemessage.com" }]) {
    const f = await fixture(t); await writeRuntimeDatabaseConfiguration(f.directory, database());
    await writeRuntimeAuthenticationConfiguration(f.directory, authentication()); await writeRuntimeMessagingConfiguration(f.directory, messaging());
    await writeRuntimeMediaConfiguration(f.directory, { format: "jessiemessage-runtime-media", version: 1, origin, mediaKey: key(4),
      mediaRoot: path.join(f.root, "media"), ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "536870912", ...change });
    await assert.rejects(readRuntimeMediaBundle(f.directory), blocked);
    const filename = path.join(f.directory, "runtime-media.json"), other = path.join(f.directory, "other");
    await (await import("node:fs/promises")).rename(filename, other); await symlink(other, filename);
    await assert.rejects(readRuntimeMediaConfiguration(f.directory), blocked);
  }
});

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
    await assert.rejects(replaceRuntimeMessagingSmtpPassword(directory, messaging(), "synthetic-new-password"), blocked);
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

test("SMTP password replacement is atomic, owner0600 and preserves every other field and private file", { skip: !supported }, async (t) => {
  const f = await fixture(t); const original = messaging();
  await writeRuntimeDatabaseConfiguration(f.directory, database());
  await writeRuntimeAuthenticationConfiguration(f.directory, authentication());
  await writeRuntimeMessagingConfiguration(f.directory, original);
  const otherNames = ["runtime-database.json", "runtime-auth.json", "old-coffre.json.gpg"];
  await writeFile(path.join(f.directory, otherNames[2]), "synthetic encrypted archive", { mode: 0o600 });
  const otherBefore = await Promise.all(otherNames.map((name) => readFile(path.join(f.directory, name))));
  const oldReader = await (await import("node:fs/promises")).open(f.file, "r");
  const newPassword = "synthetic replacement 'quoted' $() é";
  try {
    assert.deepEqual(await replaceRuntimeMessagingSmtpPassword(f.directory, Object.freeze(original), newPassword), { saved: true, keysPreserved: true });
    assert.deepEqual(await readRuntimeMessagingConfiguration(f.directory), { ...messaging(), smtpPassword: newPassword });
    assert.deepEqual(JSON.parse(await oldReader.readFile("utf8")), messaging(), "an already open reader retains the complete old file");
  } finally { await oldReader.close(); }
  const metadata = await lstat(f.file); assert.equal(metadata.mode & 0o7777, 0o600); assert.equal(metadata.nlink, 1);
  assert.equal(metadata.uid, process.getuid());
  assert.deepEqual(await Promise.all(otherNames.map((name) => readFile(path.join(f.directory, name)))), otherBefore);
  assert.equal(original.smtpPassword, messaging().smtpPassword, "the caller's expected record is not cleared");
  assert.deepEqual((await readdir(f.directory)).sort(), [...otherNames, "runtime-messaging.json"].sort());
});

test("SMTP replacement refuses stale records, existing locks and unsafe files without changing credentials", { skip: !supported }, async (t) => {
  const f = await fixture(t); await writeRuntimeMessagingConfiguration(f.directory, messaging());
  const originalBytes = await readFile(f.file);
  for (const change of [{ smtpPassword: "stale" }, { smtpUser: "other-user" }, { mailKey: key(9) }]) {
    await assert.rejects(replaceRuntimeMessagingSmtpPassword(f.directory, { ...messaging(), ...change }, "new-password"), blocked);
    assert.deepEqual(await readFile(f.file), originalBytes);
  }
  const lock = path.join(f.directory, ".runtime-messaging-smtp.lock");
  await writeFile(lock, "synthetic existing lock", { mode: 0o600 });
  await assert.rejects(replaceRuntimeMessagingSmtpPassword(f.directory, messaging(), "new-password"), blocked);
  assert.equal(await readFile(lock, "utf8"), "synthetic existing lock"); await unlink(lock);
  await chmod(f.file, 0o640);
  await assert.rejects(replaceRuntimeMessagingSmtpPassword(f.directory, messaging(), "new-password"), blocked); await chmod(f.file, 0o600);
  const other = path.join(f.directory, "other"); await link(f.file, other);
  await assert.rejects(replaceRuntimeMessagingSmtpPassword(f.directory, messaging(), "new-password"), blocked); await unlink(other);
  await unlink(f.file); await writeFile(other, originalBytes, { mode: 0o600 }); await symlink(other, f.file);
  await assert.rejects(replaceRuntimeMessagingSmtpPassword(f.directory, messaging(), "new-password"), blocked);
  assert.deepEqual(await readFile(other), originalBytes);
});

test("concurrent SMTP password updates cannot overwrite each other using the same old record", { skip: !supported }, async (t) => {
  const f = await fixture(t); await writeRuntimeMessagingConfiguration(f.directory, messaging());
  const results = await Promise.allSettled(["first-password", "second-password"].map((password) =>
    replaceRuntimeMessagingSmtpPassword(f.directory, messaging(), password)));
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  assert.ok(results.filter((row) => row.status === "rejected").every((row) => blocked(row.reason)));
  const updated = await readRuntimeMessagingConfiguration(f.directory);
  assert.ok(["first-password", "second-password"].includes(updated.smtpPassword));
  assert.deepEqual({ ...updated, smtpPassword: messaging().smtpPassword }, messaging());
  assert.deepEqual(await readdir(f.directory), ["runtime-messaging.json"]);
});
