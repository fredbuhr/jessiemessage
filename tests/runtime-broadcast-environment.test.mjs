import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { bundle, fixture, inheritedEnv, names, supportedFiles, origin } from "./fixtures/crm-private.mjs";
import { CRM_ENV_FIELDS, CRM_RUNTIME_OPTIONS, copyRuntimeCrmEnvironment } from "../server/config/runtime-crm.mjs";
import { BROADCAST_RUNTIME_OPTIONS, loadRuntimeBroadcastEnvironment, copyRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";
import { inspectPreproductionConfiguration, PRIMARY_BROADCAST_CONFIG_CHECK_NAMES } from "../server/preflight/config.mjs";
import { createConfiguredServer } from "../server/index.mjs";
import { parseArguments, run } from "../scripts/start-private-messaging.mjs";
import { DATABASE_CHECK_NAMES } from "../server/preflight/database.mjs";

const directory = "/private/synthetic-broadcast";
const load = source => loadRuntimeBroadcastEnvironment(directory, BROADCAST_RUNTIME_OPTIONS, { readBundle: async () => source ?? bundle() });
const command = mode => [mode, "--deployment", "primary-transition", "--profile", "photos-notify-recovery-crm-broadcast", "--private-directory", directory, "--private-path-mode", "linux-dirfd"];

test("broadcast activation reads the existing six anchored records once and preserves all keys and the caller", async () => {
  const source = bundle(), before = structuredClone(source); let reads = 0;
  const env = await loadRuntimeBroadcastEnvironment(directory, { ...BROADCAST_RUNTIME_OPTIONS, port: "4321" }, { readBundle: async (path, options) => {
    reads++; assert.equal(path, directory); assert.deepEqual(options, { originProfile: "primary" }); return source;
  } });
  assert.equal(reads, 1); assert.deepEqual(source, before); assert.equal(env.PORT, "4321");
  assert.deepEqual(Object.keys(env).sort(), [...CRM_ENV_FIELDS].sort());
  assert.equal(env.JESSIEMESSAGE_ENABLE_BROADCAST, "1");
  assert.deepEqual(copyRuntimeBroadcastEnvironment(env, BROADCAST_RUNTIME_OPTIONS), env);
  const base = copyRuntimeCrmEnvironment({ ...env, JESSIEMESSAGE_ENABLE_BROADCAST: "0" }, CRM_RUNTIME_OPTIONS);
  for (const name of Object.keys(base)) if (name !== "JESSIEMESSAGE_ENABLE_BROADCAST") assert.equal(base[name], env[name], name);
  assert.throws(() => copyRuntimeCrmEnvironment(env, CRM_RUNTIME_OPTIONS));
  const copy = { ...env }; clearRuntimeMessagingSecrets(copy); assert.equal(copy.JESSIEMESSAGE_MESSAGE_KEY, ""); assert.notEqual(env.JESSIEMESSAGE_MESSAGE_KEY, "");
});

test("broadcast copying rejects accessors, unknown fields, inherited records and incomplete activation flags", async () => {
  const env = await load(), before = structuredClone(env); let getters = 0;
  const getter = { ...env }; Object.defineProperty(getter, "JESSIEMESSAGE_ENABLE_BROADCAST", { get() { getters++; return "1"; } });
  for (const selected of [getter, Object.create(env), { ...env, extra: true }, { ...env, [Symbol("extra")]: true },
    ...["JESSIEMESSAGE_ENABLE_BROADCAST", "JESSIEMESSAGE_ENABLE_CRM", "JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY", "JESSIEMESSAGE_ENABLE_NOTIFICATIONS"]
      .map(name => ({ ...env, [name]: "0" })), { ...env, JESSIEMESSAGE_CRM_KEY: env.JESSIEMESSAGE_MESSAGE_KEY }])
    assert.throws(() => copyRuntimeBroadcastEnvironment(selected, BROADCAST_RUNTIME_OPTIONS), { code: "RUNTIME_BROADCAST_ENVIRONMENT" });
  assert.equal(getters, 0); assert.deepEqual(env, before);
});

test("broadcast loading requires the existing strict primary/recovery permissions before reading a file", async () => {
  let reads = 0, getters = 0;
  const getter = { originProfile: "primary" }; Object.defineProperty(getter, "recovery", { get() { getters++; return true; } });
  for (const options of [{}, { originProfile: "primary" }, { originProfile: "preproduction", recovery: true },
    { ...BROADCAST_RUNTIME_OPTIONS, extra: true }, Object.create(BROADCAST_RUNTIME_OPTIONS), getter])
    await assert.rejects(loadRuntimeBroadcastEnvironment(directory, options, { readBundle: async () => { reads++; return bundle(); } }), { code: "RUNTIME_BROADCAST_ENVIRONMENT" });
  assert.equal(reads, 0); assert.equal(getters, 0);
  const source = bundle(); delete source.crm; await assert.rejects(load(source), { code: "RUNTIME_BROADCAST_ENVIRONMENT" });
});

test("the broadcast preflight accepts only the explicit all-enabled primary target and leaves earlier profiles closed", async () => {
  const env = await load(), options = { expectedOrigin: origin, originProfile: "primary", target: "messaging-photos-notify-recovery-crm-broadcast" };
  const report = inspectPreproductionConfiguration(env, options);
  assert.equal(report.valid, true); assert.equal(report.target, options.target);
  assert.deepEqual(report.checks.map(check => check.name), PRIMARY_BROADCAST_CONFIG_CHECK_NAMES);
  assert.ok(report.checks.every(check => check.status === "pass"));
  for (const target of ["messaging-photos-notify-recovery-crm", "messaging-photos-notify-recovery", "messaging-photos-notify", "auth-only"])
    assert.equal(inspectPreproductionConfiguration(env, { ...options, target }).valid, false);
  for (const field of Object.keys(env).filter(name => name.startsWith("JESSIEMESSAGE_ENABLE_")))
    assert.equal(inspectPreproductionConfiguration({ ...env, [field]: "0" }, options).valid, false, field);
});

test("broadcast startup checks configuration, privileges, physical schemas and storage before one explicit listener call", async () => {
  const source = await load(), before = structuredClone(source), events = [];
  const dependencies = { inheritedEnv, execArgv: [], loadEnvironment: async (_path, options) => {
    events.push("configuration"); assert.deepEqual(options, { port: "3000", ...BROADCAST_RUNTIME_OPTIONS }); return source;
  }, inspect: async env => { events.push("privileges"); assert.equal(env.env.JESSIEMESSAGE_ENABLE_BROADCAST, "1");
    return { valid: true, checks: DATABASE_CHECK_NAMES.map(name => ({ name, status: "pass" })), privilegeObservation: { profile: "strict", source: "show_grants", ledgerWritable: false, tempTables: false, tableLocks: false, permanentDdl: false } };
  }, checkSchema: async env => { events.push("schema"); assert.equal(env.JESSIEMESSAGE_ENABLE_BROADCAST, "1"); },
  checkStorage: async () => events.push("storage"), startServer: async (_env, options) => {
    events.push("listener"); assert.deepEqual(options, { requestOrigin: origin, deviceTransition: true, recovery: true, crm: true, broadcast: true });
  } };
  const result = await run(parseArguments(command("start")), dependencies);
  assert.equal(result.profile, "messaging-photos-notify-recovery-crm-broadcast"); assert.equal(result.started, true);
  assert.deepEqual(events, ["configuration", "privileges", "schema", "storage", "listener"]); assert.deepEqual(source, before);
  events.length = 0; assert.equal((await run(parseArguments(command("check")), dependencies)).started, false);
  assert.deepEqual(events, ["configuration", "privileges", "schema", "storage"]);
  for (const phase of ["loadEnvironment", "inspect", "checkSchema", "checkStorage"]) {
    let started = false;
    await assert.rejects(run(parseArguments(command("start")), { ...dependencies, [phase]: async () => { throw Error("synthetic private failure"); }, startServer: async () => { started = true; } }));
    assert.equal(started, false);
  }
  await assert.rejects(run(parseArguments(command("start")), { ...dependencies, inheritedEnv: { ...inheritedEnv, JESSIEMESSAGE_ENABLE_BROADCAST: "1" } }), { code: "PRIVATE_MESSAGING_ENVIRONMENT" });
});

test("a broadcast environment cannot enter the server through earlier or incomplete primary options", async () => {
  const env = await load();
  assert.throws(() => parseArguments(command("start").filter(value => !["--deployment", "primary-transition"].includes(value))));
  for (const options of [{ requestOrigin: origin, deviceTransition: true, recovery: true, crm: true }, { broadcast: true },
    { requestOrigin: origin, deviceTransition: true, recovery: true, broadcast: true },
    { requestOrigin: origin, deviceTransition: true, recovery: true, crm: true, broadcast: "1" }])
    await assert.rejects(createConfiguredServer(env, options), { code: "REQUEST_ORIGIN_CONFIG" });
});

test("the real Linux broadcast loader keeps all six private files byte-identical", { skip: !supportedFiles }, async t => {
  const f = await fixture(t), before = await Promise.all(names.map(name => readFile(join(f.directory, name))));
  const env = await loadRuntimeBroadcastEnvironment(f.directory, BROADCAST_RUNTIME_OPTIONS);
  assert.equal(env.JESSIEMESSAGE_ENABLE_BROADCAST, "1");
  assert.deepEqual(await Promise.all(names.map(name => readFile(join(f.directory, name)))), before);
});
