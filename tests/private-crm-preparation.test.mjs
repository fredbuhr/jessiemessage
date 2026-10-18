import test from "node:test";
import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArguments, run, main } from "../scripts/prepare-runtime-crm.mjs";
import { readRuntimeCrmBundle } from "../server/config/runtime-database-file.mjs";
import { PRIMARY, bundle, baseBundle, fixture, inheritedEnv, key, names, supportedFiles } from "./fixtures/crm-private.mjs";

const options = { command: "prepare", privateDirectory: "/synthetic/private", privatePathMode: "linux-dirfd" };
const blocked = error => /^PRIVATE_CRM_[A-Z]+$/.test(error.code) && error.message === error.code;
function dependencies(extra = {}) { return { inheritedEnv, execArgv: [], exists: async () => false, readBundle: async () => baseBundle(), random: () => Buffer.alloc(32, 6),
  writeConfiguration: async () => ({ saved: true }), readBack: async () => bundle(), ...extra }; }
test("CRM preparation options reject extra fields, injected environment and argument accessors", async () => {
  assert.deepEqual(parseArguments(["check", "--private-directory", options.privateDirectory, "--private-path-mode", "linux-dirfd"]), { ...options, command: "check" });
  for (const args of [[], ["start"], ["prepare", "--key", key(6)]]) assert.throws(() => parseArguments(args), blocked);
  for (const env of [{ ...inheritedEnv, NODE_OPTIONS: "--inspect" }, { ...inheritedEnv, JESSIEMESSAGE_CRM_KEY: key(6) }, {}]) await assert.rejects(run(options, dependencies({ inheritedEnv: env })), blocked);
  let invoked = false; const accessor = { ...options }; Object.defineProperty(accessor, "command", { get() { invoked = true; return "prepare"; } });
  await assert.rejects(run(accessor, dependencies()), blocked); assert.equal(invoked, false);
  await assert.rejects(run({ ...options, extra: true }, dependencies()), blocked);
});
test("CRM check validates the existing primary records without randomness, publication or activation", async () => {
  const report = await run({ ...options, command: "check" }, dependencies({ random() { throw new Error("must not generate"); }, writeConfiguration() { throw new Error("must not publish"); } }));
  assert.deepEqual(report, { status: "ready_for_prepare", profile: "primary-crm", crmConfigSaved: false, keysPreserved: true, started: false, migrationPerformed: false });
});
test("CRM preparation refuses reuse of any existing key and invalid randomness before writing", async () => {
  const data = bundle();
  const reused = [data.authentication.mfaKey, data.messaging.mailKey, data.messaging.messageKey, data.media.mediaKey, data.notifications.notificationKey, data.notifications.vapidPrivateKey];
  for (const output of ["invalid", Buffer.alloc(31), ...reused.map(value => Buffer.from(value, "base64url"))]) {
    let wrote = false; await assert.rejects(run(options, dependencies({ random: () => output, writeConfiguration: async () => { wrote = true; return { saved: true }; } })), blocked); assert.equal(wrote, false);
  }
});
test("CRM readback must match the new key and every preexisting private record", async () => {
  const original = baseBundle();
  for (const changed of [{ ...bundle(), crm: { ...bundle().crm, crmKey: key(8) } }, { ...bundle(), messaging: { ...bundle().messaging, smtpPassword: "changed-in-fixture" } }]) {
    await assert.rejects(run(options, dependencies({ readBundle: async () => original, readBack: async () => changed })), error => error.code === "PRIVATE_CRM_PUBLICATION");
    assert.deepEqual(original, baseBundle(), "injected source belongs to the caller");
  }
});
test("existing CRM configuration is refused before key generation or source reads", async () => {
  let generated = false, read = false;
  await assert.rejects(run(options, dependencies({ exists: async () => true, random() { generated = true; }, readBundle() { read = true; } })), error => error.code === "PRIVATE_CRM_EXISTS");
  assert.equal(generated, false); assert.equal(read, false);
});
test("generated CRM key bytes are cleared after success and failure", async () => {
  const success = Buffer.alloc(32, 6); await run(options, dependencies({ random: () => success })); assert.equal(success.every(byte => byte === 0), true);
  const failure = Buffer.alloc(32, 6);
  await assert.rejects(run(options, dependencies({ random: () => failure, writeConfiguration: async () => { throw new Error("synthetic publication error"); } })), blocked);
  assert.equal(failure.every(byte => byte === 0), true);
});
test("real preparation saves exactly one unused key, preserves prior bytes and reports no secrets", { skip: !supportedFiles }, async t => {
  const f = await fixture(t, { crm: false }), selected = { ...options, privateDirectory: f.directory };
  const settings = { inheritedEnv, execArgv: [], random: () => Buffer.alloc(32, 6) };
  assert.equal((await run({ ...selected, command: "check" }, settings)).crmConfigSaved, false);
  await assert.rejects(lstat(path.join(f.directory, names[5])), { code: "ENOENT" });
  let output = ""; const report = await main(["prepare", "--private-directory", f.directory, "--private-path-mode", "linux-dirfd"], { ...settings, outputStream: { write: value => { output += value; } } });
  assert.equal(report.crmConfigSaved, true); assert.equal(report.started, false); assert.equal(report.migrationPerformed, false);
  assert.equal(output.includes(key(6)), false); assert.equal(output.includes(f.records.messaging.smtpPassword), false);
  assert.deepEqual(await readRuntimeCrmBundle(f.directory, PRIMARY), f.records);
  await assert.rejects(run(selected, settings), error => error.code === "PRIVATE_CRM_EXISTS");
  assert.deepEqual(await Promise.all(names.slice(0, 5).map(name => readFile(path.join(f.directory, name)))), f.before);
});
