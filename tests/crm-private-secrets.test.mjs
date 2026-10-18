import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { chmod, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { check, run, verifyCiphertext, parseArguments } from "../scripts/private-secrets-backup.mjs";
import { fixture, key, names, supportedGpg } from "./fixtures/crm-private.mjs";

const password = "five synthetic words for CRM recovery";
const selected = directory => ({ privateDirectory: directory, output: "primary-crm-config.json.gpg", profile: "primary-crm" });
const blocked = error => /^PRIVATE_SECRETS_[A-Z]+$/.test(error.code) && error.message === error.code;
test("the six-file primary CRM coffre has an explicit profile instead of reusing a legacy format", () => {
  assert.deepEqual(parseArguments(["--profile", "primary-crm", "--private-directory", "/synthetic/private", "--output", "coffre.json.gpg"]),
    { profile: "primary-crm", privateDirectory: "/synthetic/private", output: "coffre.json.gpg" });
  assert.throws(() => parseArguments(["--profile", "primary-crm\n", "--private-directory", "/synthetic/private", "--output", "coffre.json.gpg"]), blocked);
});
test("Linux CI must exercise the real encrypted CRM coffre", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(supportedGpg, true));
test("CRM coffre metadata check reads no source content and needs no historical admin setup", { skip: !supportedGpg }, async t => {
  const f = await fixture(t); let reads = 0; const original = fs.promises.open;
  fs.promises.open = async (...args) => {
    const handle = await original(...args);
    if (names.includes(path.basename(String(args[0])))) handle.read = async () => { reads++; throw new Error("must not read"); };
    return handle;
  }; syncBuiltinESMExports();
  let report;
  try { report = await check(selected(f.directory)); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
  assert.equal(reads, 0); assert.deepEqual(report, { status: "checked", profile: "primary-crm", files: 6, sourceContentsRead: false, gpgAvailable: true, secretsOnly: true, databaseBackup: false });
  assert.deepEqual((await readdir(f.directory)).sort(), [...names].sort());
});
test("primary CRM coffre encrypts and verifies all current keys without plaintext files or overwrites", { skip: !supportedGpg }, async t => {
  const f = await fixture(t), options = selected(f.directory);
  const report = await run(options, password), ciphertext = await readFile(path.join(f.directory, options.output));
  assert.equal(report.profile, "primary-crm"); assert.equal(report.files, 6); assert.equal(report.verified, true); assert.equal(report.databaseBackup, false);
  assert.equal(report.sha256, createHash("sha256").update(ciphertext).digest("hex"));
  for (const secret of [key(6), f.records.messaging.smtpPassword, f.records.database.password, f.records.notifications.vapidPrivateKey]) {
    assert.equal(ciphertext.includes(Buffer.from(secret)), false); assert.equal(JSON.stringify(report).includes(secret), false);
  }
  assert.deepEqual((await readdir(f.directory)).sort(), [...names, options.output].sort());
  assert.deepEqual(await Promise.all(names.slice(0, 5).map(name => readFile(path.join(f.directory, name)))), f.before);
  await assert.rejects(run(options, password), blocked); assert.deepEqual(await readFile(path.join(f.directory, options.output)), ciphertext);
  const independent = path.join(f.root, "verification"); await mkdir(independent, { mode: 0o700 });
  const verification = { ...options, privateDirectory: independent, output: "never-written.json.gpg" };
  assert.deepEqual(await verifyCiphertext(verification, ciphertext, password), { verified: true, profile: "primary-crm", files: 6, secretsOnly: true, databaseBackup: false });
  assert.deepEqual(await readdir(independent), []);
  await assert.rejects(verifyCiphertext({ ...verification, profile: "messaging-photos-notify" }, ciphertext, password), blocked);
  await assert.rejects(verifyCiphertext(verification, ciphertext, "a different synthetic long recovery password"), blocked);
  const damaged = Buffer.from(ciphertext); damaged[Math.floor(damaged.length / 2)] ^= 1;
  await assert.rejects(verifyCiphertext(verification, damaged, password), blocked);
});
test("new legacy coffres cannot omit a prepared CRM key and the primary profile requires that key", { skip: !supportedGpg }, async t => {
  const f = await fixture(t);
  for (const profile of ["auth", "messaging", "messaging-photos", "messaging-photos-notify"]) await assert.rejects(check({ ...selected(f.directory), profile }), blocked);
  const missing = await fixture(t, { crm: false }); await assert.rejects(check(selected(missing.directory)), blocked);
  await assert.rejects(lstat(path.join(missing.directory, "primary-crm-config.json.gpg")), { code: "ENOENT" });
});
test("CRM coffre refuses mismatched primary origins and reused keys before publication", { skip: !supportedGpg }, async t => {
  for (const change of [{ crmKey: key(2) }, { origin: "https://recette.jessiemessage.com" }]) {
    const f = await fixture(t); await writeFile(path.join(f.directory, names[5]), JSON.stringify({ ...f.records.crm, ...change }), { mode: 0o600 });
    assert.equal((await check(selected(f.directory))).sourceContentsRead, false);
    await assert.rejects(run(selected(f.directory), password), blocked);
    await assert.rejects(lstat(path.join(f.directory, "primary-crm-config.json.gpg")), { code: "ENOENT" });
  }
});
test("CRM source permissions are checked before prompting for a coffre passphrase", { skip: !supportedGpg }, async t => {
  const f = await fixture(t); await chmod(path.join(f.directory, names[5]), 0o640); await assert.rejects(check(selected(f.directory)), blocked);
});
