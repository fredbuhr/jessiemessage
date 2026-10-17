import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { bundle, baseBundle, fixture, supportedFiles, inheritedEnv, names, origin, key } from "./fixtures/crm-private.mjs";
import { CRM_RUNTIME_OPTIONS, CRM_ENV_FIELDS, loadRuntimeCrmEnvironment, copyRuntimeCrmEnvironment } from "../server/config/runtime-crm.mjs";
import { copyRuntimeNotificationsEnvironment, loadRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";
import { inspectPreproductionConfiguration, PRIMARY_NOTIFICATIONS_RECOVERY_CRM_CONFIG_CHECK_NAMES } from "../server/preflight/config.mjs";
import { createConfiguredServer } from "../server/index.mjs";
import { parseArguments, run } from "../scripts/start-private-messaging.mjs";
import { DATABASE_CHECK_NAMES } from "../server/preflight/database.mjs";

const directory = "/private/synthetic-crm";
const load = (source = bundle()) => loadRuntimeCrmEnvironment(directory, CRM_RUNTIME_OPTIONS, { readBundle: async () => source });
const command = mode => [mode, "--deployment", "primary-transition", "--profile", "photos-notify-recovery-crm", "--private-directory", directory, "--private-path-mode", "linux-dirfd"];

test("the explicit CRM loader reads one six-file bundle, preserves its caller and activates only the selected domains", async () => {
  const source = bundle(), before = structuredClone(source); let reads = 0;
  const env = await loadRuntimeCrmEnvironment(directory, { ...CRM_RUNTIME_OPTIONS, port: "4321" }, { readBundle: async (path, options) => {
    reads++; assert.equal(path, directory); assert.deepEqual(options, { originProfile: "primary" }); return source;
  } });
  assert.equal(reads, 1); assert.deepEqual(source, before); assert.equal(env.PORT, "4321");
  assert.deepEqual(Object.keys(env).sort(), [...CRM_ENV_FIELDS].sort());
  assert.equal(env.JESSIEMESSAGE_ENABLE_CRM, "1"); assert.equal(env.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY, "1");
  assert.equal(env.JESSIEMESSAGE_ENABLE_BROADCAST, "0"); assert.equal(env.JESSIEMESSAGE_CRM_KEY, key(6));
  assert.deepEqual(copyRuntimeCrmEnvironment(env, CRM_RUNTIME_OPTIONS), env);
  const base = await loadRuntimeNotificationsEnvironment(directory, CRM_RUNTIME_OPTIONS, { readBundle: async () => baseBundle(source) });
  for (const [name, value] of Object.entries(base)) if (!["JESSIEMESSAGE_ENABLE_CRM", "JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY", "PORT"].includes(name)) assert.equal(env[name], value, name);
  assert.throws(() => copyRuntimeNotificationsEnvironment(env, CRM_RUNTIME_OPTIONS));
  const copy = { ...env }; clearRuntimeMessagingSecrets(copy); assert.equal(copy.JESSIEMESSAGE_CRM_KEY, ""); assert.equal(env.JESSIEMESSAGE_CRM_KEY, key(6));
});

test("CRM configuration rejects absent, incoherent or reused keys, including VAPID, before returning an environment", async () => {
  for (const change of [b => { delete b.crm; }, b => { b.crm.origin = "https://recette.jessiemessage.com"; },
    b => { b.crm.crmKey = key(2); }, b => { b.crm.crmKey = b.notifications.vapidPrivateKey; }, b => { b.extra = true; }]) {
    const source = bundle(); change(source); const before = structuredClone(source);
    await assert.rejects(load(source), { code: "RUNTIME_CRM_ENVIRONMENT" }); assert.deepEqual(source, before);
  }
});

test("CRM permissions and records are closed data properties and cannot be inherited or invoke accessors", async () => {
  let getters = 0;
  const accessor = { originProfile: "primary" }; Object.defineProperty(accessor, "recovery", { get() { getters++; return true; } });
  for (const options of [{}, { originProfile: "primary" }, { originProfile: "preproduction", recovery: true },
    { ...CRM_RUNTIME_OPTIONS, recovery: "1" }, { ...CRM_RUNTIME_OPTIONS, extra: true }, Object.create(CRM_RUNTIME_OPTIONS), accessor,
    { ...CRM_RUNTIME_OPTIONS, [Symbol("extra")]: true }]) {
    await assert.rejects(loadRuntimeCrmEnvironment(directory, options, { readBundle: () => assert.fail("Invalid profile must not read files") }));
  }
  const env = await load(), original = structuredClone(env);
  const withGetter = { ...env }; Object.defineProperty(withGetter, "JESSIEMESSAGE_CRM_KEY", { get() { getters++; return key(6); } });
  for (const value of [withGetter, { ...env, JESSIEMESSAGE_ENABLE_BROADCAST: "1" }, { ...env, JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "0" },
    { ...env, JESSIEMESSAGE_ENABLE_CRM: "0" }, { ...env, JESSIEMESSAGE_CRM_KEY: key(1) }, { ...env, unrelated: "private" }])
    assert.throws(() => copyRuntimeCrmEnvironment(value, CRM_RUNTIME_OPTIONS));
  assert.equal(getters, 0); assert.deepEqual(env, original);
});

test("the CRM preflight requires the primary origin, recovery and its exact explicit target", async () => {
  const env = await load(), options = { expectedOrigin: origin, originProfile: "primary", target: "messaging-photos-notify-recovery-crm" };
  const report = inspectPreproductionConfiguration(env, options);
  assert.equal(report.valid, true); assert.deepEqual(report.checks.map(check => check.name), PRIMARY_NOTIFICATIONS_RECOVERY_CRM_CONFIG_CHECK_NAMES);
  for (const override of [{ JESSIEMESSAGE_ENABLE_CRM: "0" }, { JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "0" },
    { JESSIEMESSAGE_ENABLE_BROADCAST: "1" }, { JESSIEMESSAGE_SITE_ORIGIN: "https://recette.jessiemessage.com" }])
    assert.equal(inspectPreproductionConfiguration({ ...env, ...override }, options).valid, false);
  for (const target of ["messaging-photos-notify-recovery", "messaging-photos-notify", "auth-only"])
    assert.equal(inspectPreproductionConfiguration(env, { ...options, target }).valid, false);
});

test("CRM startup checks configuration, database, physical schema and storage before the only listener call", async () => {
  const source = await load(), before = structuredClone(source), events = [];
  const dependencies = { inheritedEnv, execArgv: [], loadEnvironment: async (_path, options) => {
    assert.deepEqual(options, { port: "3000", ...CRM_RUNTIME_OPTIONS }); events.push("config"); return source;
  }, inspect: async () => { events.push("database"); return { valid: true, checks: DATABASE_CHECK_NAMES.map(name => ({ name, status: "pass" })),
    privilegeObservation: { profile: "strict", source: "show_grants", ledgerWritable: false, tempTables: false, tableLocks: false, permanentDdl: false } }; },
  checkSchema: async env => { assert.equal(env.JESSIEMESSAGE_ENABLE_CRM, "1"); events.push("schema"); },
  checkStorage: async () => events.push("storage"), startServer: async (_env, options) => {
    events.push("start"); assert.deepEqual(options, { requestOrigin: origin, deviceTransition: true, recovery: true, crm: true });
  } };
  assert.deepEqual(await run(parseArguments(command("start")), dependencies), {
    status: "started", profile: "messaging-photos-notify-recovery-crm", deployment: "primary-transition", started: true, smtpDeliveryTested: false, launchApproved: false,
  });
  assert.deepEqual(events, ["config", "database", "schema", "storage", "start"]); assert.deepEqual(source, before);
  events.length = 0; assert.equal((await run(parseArguments(command("check")), dependencies)).started, false);
  assert.deepEqual(events, ["config", "database", "schema", "storage"]);
  for (const step of ["loadEnvironment", "inspect", "checkSchema", "checkStorage"]) {
    let started = false;
    await assert.rejects(run(parseArguments(command("start")), { ...dependencies, [step]: async () => { throw new Error("private synthetic failure"); }, startServer: async () => { started = true; } }));
    assert.equal(started, false);
  }
  await assert.rejects(run(parseArguments(command("start")), { ...dependencies, inheritedEnv: { ...inheritedEnv, JESSIEMESSAGE_CRM_KEY: key(6) } }), { code: "PRIVATE_MESSAGING_ENVIRONMENT" });
});

test("CRM cannot start through an old deployment, ambient flags or incomplete server options", async () => {
  assert.throws(() => parseArguments(command("start").filter(value => !["--deployment", "primary-transition"].includes(value))));
  const env = await load();
  for (const options of [{ requestOrigin: origin, deviceTransition: true, recovery: true }, { crm: true },
    { requestOrigin: origin, deviceTransition: true, crm: true }, { requestOrigin: origin, deviceTransition: true, recovery: true, crm: "1" }])
    await assert.rejects(createConfiguredServer(env, options), { code: "REQUEST_ORIGIN_CONFIG" });
});

test("Linux CI requires the real six-file CRM startup configuration checks", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(supportedFiles, true));
test("the real CRM loader leaves every private file unchanged and requires the sixth key", { skip: !supportedFiles }, async t => {
  const f = await fixture(t), before = await Promise.all(names.map(name => readFile(join(f.directory, name))));
  const env = await loadRuntimeCrmEnvironment(f.directory, CRM_RUNTIME_OPTIONS);
  assert.equal(env.JESSIEMESSAGE_CRM_KEY, key(6)); assert.deepEqual(await Promise.all(names.map(name => readFile(join(f.directory, name)))), before);
  const missing = await fixture(t, { crm: false }); await assert.rejects(loadRuntimeCrmEnvironment(missing.directory, CRM_RUNTIME_OPTIONS));
});
