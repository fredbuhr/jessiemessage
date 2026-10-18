import test from "node:test";
import assert from "node:assert/strict";
import { chmod, link, lstat, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateRuntimeCrmConfiguration, validateRuntimeCrmBundle, writeRuntimeCrmConfiguration,
  readRuntimeCrmConfiguration, readRuntimeCrmBundle, runtimeCrmConfigurationExists } from "../server/config/runtime-database-file.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";
import { PRIMARY, bundle, fixture, key, names, supportedFiles } from "./fixtures/crm-private.mjs";

const blocked = error => error.code === "RUNTIME_CRM_CONFIGURATION" && error.message === "Private file configuration is unavailable.";
test("CRM key files have a strict version, canonical origin/key and no accessors or extra fields", () => {
  const valid = bundle().crm; assert.deepEqual(validateRuntimeCrmConfiguration(Object.freeze(valid), PRIMARY), valid);
  for (const input of [{ ...valid, version: 2 }, { ...valid, crmKey: key(6) + "\n" }, { ...valid, crmKey: "A" }, { ...valid, token: "extra" },
    { ...valid, origin: "https://recette.jessiemessage.com" }, { ...valid, origin: valid.origin + "/" }]) assert.throws(() => validateRuntimeCrmConfiguration(input, PRIMARY), blocked);
  assert.throws(() => validateRuntimeCrmConfiguration(valid), blocked);
  let invoked = false; const accessor = { ...valid }; Object.defineProperty(accessor, "crmKey", { enumerable: true, get() { invoked = true; return key(6); } });
  assert.throws(() => validateRuntimeCrmConfiguration(accessor, PRIMARY), blocked); assert.equal(invoked, false);
});
test("primary CRM bundles bind exactly six records and seven distinct keys without changing inputs", () => {
  const valid = bundle(), before = structuredClone(valid); assert.deepEqual(validateRuntimeCrmBundle(valid, PRIMARY), before); assert.deepEqual(valid, before);
  for (const reused of [valid.authentication.mfaKey, valid.messaging.mailKey, valid.messaging.messageKey, valid.media.mediaKey, valid.notifications.notificationKey, valid.notifications.vapidPrivateKey]) {
    assert.throws(() => validateRuntimeCrmBundle({ ...valid, crm: { ...valid.crm, crmKey: reused } }, PRIMARY), blocked);
  }
  for (const name of Object.keys(valid)) { const incomplete = { ...valid }; delete incomplete[name]; assert.throws(() => validateRuntimeCrmBundle(incomplete, PRIMARY), blocked); }
  assert.throws(() => validateRuntimeCrmBundle({ ...valid, extra: {} }, PRIMARY), blocked); assert.throws(() => validateRuntimeCrmBundle(valid), blocked);
  let invoked = false; const accessor = { ...valid }; Object.defineProperty(accessor, "crm", { get() { invoked = true; return valid.crm; } });
  assert.throws(() => validateRuntimeCrmBundle(accessor, PRIMARY), blocked); assert.equal(invoked, false);
});
test("secret cleanup also clears CRM file and environment values without invoking accessors", () => {
  const value = { crmKey: key(6), JESSIEMESSAGE_CRM_KEY: key(6), publicValue: "retained" }; let invoked = false;
  Object.defineProperty(value, "smtpPassword", { get() { invoked = true; return "never"; } });
  clearRuntimeMessagingSecrets(value); assert.equal(value.crmKey, ""); assert.equal(value.JESSIEMESSAGE_CRM_KEY, ""); assert.equal(value.publicValue, "retained"); assert.equal(invoked, false);
});
test("Linux CI must run the real anchored CRM configuration tests", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(supportedFiles, true));
test("exclusive CRM publication is owner0600, preserves all five prior files and reads six anchored records", { skip: !supportedFiles }, async t => {
  const f = await fixture(t, { crm: false }); assert.equal(await runtimeCrmConfigurationExists(f.directory), false);
  await writeRuntimeCrmConfiguration(f.directory, f.records.crm, PRIMARY); assert.equal(await runtimeCrmConfigurationExists(f.directory), true);
  const stat = await lstat(path.join(f.directory, names[5])); assert.equal(stat.mode & 0o7777, 0o600); assert.equal(stat.nlink, 1); assert.equal(stat.uid, process.getuid());
  assert.deepEqual(await readRuntimeCrmBundle(f.directory, PRIMARY), f.records);
  await assert.rejects(writeRuntimeCrmConfiguration(f.directory, { ...f.records.crm, crmKey: key(8) }, PRIMARY), blocked);
  assert.deepEqual(await readRuntimeCrmConfiguration(f.directory, PRIMARY), f.records.crm);
  assert.deepEqual(await Promise.all(names.slice(0, 5).map(name => readFile(path.join(f.directory, name)))), f.before);
});
test("CRM anchored reads reject loose modes, hardlinks, symlinks and oversized files", { skip: !supportedFiles }, async t => {
  const f = await fixture(t), filename = path.join(f.directory, names[5]);
  await chmod(filename, 0o640); await assert.rejects(readRuntimeCrmBundle(f.directory, PRIMARY), blocked); await chmod(filename, 0o600);
  const alias = path.join(f.directory, "alias"); await link(filename, alias); await assert.rejects(readRuntimeCrmConfiguration(f.directory, PRIMARY), blocked); await unlink(alias);
  await unlink(filename); await symlink(names[0], filename); assert.equal(await runtimeCrmConfigurationExists(f.directory), true);
  await assert.rejects(readRuntimeCrmBundle(f.directory, PRIMARY), blocked); await unlink(filename);
  await writeFile(filename, " ".repeat(16384) + JSON.stringify(f.records.crm), { mode: 0o600 }); await assert.rejects(readRuntimeCrmConfiguration(f.directory, PRIMARY), blocked);
});
test("CRM file operations reject repository and unclean paths before returning private data", async () => {
  for (const directory of [path.resolve("public"), path.resolve("."), "relative", "/tmp/../private", "/tmp//private"]) {
    await assert.rejects(readRuntimeCrmConfiguration(directory, PRIMARY), blocked); await assert.rejects(readRuntimeCrmBundle(directory, PRIMARY), blocked);
    await assert.rejects(runtimeCrmConfigurationExists(directory), blocked);
  }
});
