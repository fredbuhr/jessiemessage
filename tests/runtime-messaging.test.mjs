import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { validateRuntimeMessagingConfiguration } from "../server/config/runtime-database-file.mjs";
import { loadRuntimeMessagingEnvironment, copyRuntimeMessagingEnvironment, MESSAGING_ENV_FIELDS } from "../server/config/runtime-messaging.mjs";
import { inspectPreproductionConfiguration, MESSAGING_CONFIG_CHECK_NAMES } from "../server/preflight/config.mjs";
import { run as prepare, parseArguments as prepareArguments, readSmtpCredentials } from "../scripts/prepare-runtime-messaging.mjs";
import { run as startup, parseArguments as startupArguments } from "../scripts/start-private-messaging.mjs";
import { DATABASE_CHECK_NAMES } from "../server/preflight/database.mjs";

const key = (byte) => Buffer.alloc(32, byte).toString("base64url");
const origin = "https://recette.jessiemessage.com", directory = "/private/runtime-fixture";
const database = () => ({ format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306",
  database: "jessiemessage_test", user: "fixture_runtime", password: "synthetic-db-secret", privilegeProfile: "infomaniak-shared-pattern" });
const authentication = () => ({ format: "jessiemessage-runtime-auth", version: 1, origin, mfaKey: key(17) });
const messaging = () => ({ format: "jessiemessage-runtime-messaging", version: 1, origin, mailKey: key(18), messageKey: key(19),
  smtpHost: "smtp.example.invalid", smtpPort: "587", smtpUser: "synthetic-smtp-user", smtpPassword: "synthetic-smtp-secret ' $()" });
const bundle = () => ({ database: database(), authentication: authentication(), messaging: messaging() });
const inheritedEnv = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" };
const options = { command: "check", privateDirectory: directory, privatePathMode: "linux-dirfd" };
const preparationOptions = { ...options, smtpHost: "smtp.example.invalid", smtpPort: "587" };
const environment = () => loadRuntimeMessagingEnvironment(directory, {}, { readBundle: async () => bundle() });
const errorCode = (code) => (error) => error.code === code && error.cause === undefined && !JSON.stringify(error).includes("synthetic-");
const inspection = () => ({ valid: true, checks: DATABASE_CHECK_NAMES.map((name) => ({ name, status: "pass" })),
  privilegeObservation: { profile: "infomaniak-shared-pattern", source: "show_grants_and_visible_schemata", ledgerWritable: true,
    tempTables: true, tableLocks: true, permanentDdl: false, databaseNamePattern: true,
    visibleApplicationNamespace: "selected_only", futureMatchingDatabasesUnproven: true } });

test("messaging record validates SMTP with the existing policy and only canonical distinct mail/chat keys", () => {
  const source = messaging(); assert.deepEqual(validateRuntimeMessagingConfiguration(Object.freeze(source)), source);
  let getters = 0;
  for (const overrides of [{ format: "other" }, { version: "1" }, { origin: "https://jessiemessage.com" }, { mailKey: "bad" },
    { messageKey: source.mailKey }, { messageKey: `${source.messageKey}=` }, { smtpPort: "25" }, { smtpPassword: "" },
    { smtpPassword: "a\nb" }, { smtpUser: "x".repeat(257) }, { smtpHost: "smtp host" }, { enabled: true }]) {
    assert.throws(() => validateRuntimeMessagingConfiguration({ ...source, ...overrides }), errorCode("RUNTIME_MESSAGING_CONFIGURATION"));
  }
  const accessor = { ...source }; Object.defineProperty(accessor, "smtpPassword", { get() { getters++; throw new Error(source.smtpPassword); } });
  assert.throws(() => validateRuntimeMessagingConfiguration(accessor), errorCode("RUNTIME_MESSAGING_CONFIGURATION"));
  assert.equal(getters, 0); assert.equal(source.smtpPassword, messaging().smtpPassword);
});

test("one anchored bundle reuses SQL and MFA, pins its origin and enables only the four text-profile flags", async () => {
  const source = bundle(), before = structuredClone(source); let reads = 0;
  const env = await loadRuntimeMessagingEnvironment(directory, { port: "4321" }, { readBundle: async (value) => {
    reads++; assert.equal(value, directory); return source;
  } });
  assert.equal(reads, 1); assert.equal(env.PORT, "4321");
  assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, database().password); assert.equal(env.JESSIEMESSAGE_MFA_KEY, authentication().mfaKey);
  for (const name of ["AUTH", "ACCESS", "CHAT", "MAIL_DELIVERY"]) assert.equal(env[`JESSIEMESSAGE_ENABLE_${name}`], "1");
  for (const name of ["MEDIA", "CRM", "BROADCAST", "CLIENT_RECOVERY"]) assert.equal(env[`JESSIEMESSAGE_ENABLE_${name}`], "0");
  assert.deepEqual(Object.keys(env).sort(), [...MESSAGING_ENV_FIELDS].sort()); assert.deepEqual(source, before);
  const report = inspectPreproductionConfiguration(env, { expectedOrigin: origin, target: "messaging-text" });
  assert.equal(report.valid, true); assert.equal(report.target, "messaging-text");
  assert.deepEqual(report.checks.map((check) => check.name), [...MESSAGING_CONFIG_CHECK_NAMES]);
  assert.equal(inspectPreproductionConfiguration(env, { expectedOrigin: origin, target: "auth-only" }).valid, false);
});

test("profile rejects origin drift, collisions with existing MFA, arbitrary flags, ambient TLS overrides and accessors", async () => {
  for (const change of [(value) => { value.messaging.origin = "https://other.jessiemessage.com"; },
    (value) => { value.messaging.mailKey = value.authentication.mfaKey; },
    (value) => { value.messaging.messageKey = value.authentication.mfaKey; },
    (value) => { delete value.authentication; }, (value) => { value.diagnostic = {}; }]) {
    const source = bundle(); change(source);
    await assert.rejects(loadRuntimeMessagingEnvironment(directory, {}, { readBundle: async () => source }), errorCode("RUNTIME_MESSAGING_ENVIRONMENT"));
  }
  const env = await environment();
  for (const change of [(value) => { value.JESSIEMESSAGE_ENABLE_MEDIA = "1"; }, (value) => { value.JESSIEMESSAGE_ENABLE_CHAT = "0"; },
    (value) => { value.JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL = "1"; }, (value) => { value.PATH = "/inherited"; }]) {
    const altered = { ...env }; change(altered);
    assert.throws(() => copyRuntimeMessagingEnvironment(altered), errorCode("RUNTIME_MESSAGING_ENVIRONMENT"));
  }
  let invoked = 0; const altered = { ...env }; Object.defineProperty(altered, "JESSIEMESSAGE_SMTP_PASSWORD", { get() { invoked++; return "secret"; } });
  assert.throws(() => copyRuntimeMessagingEnvironment(altered), errorCode("RUNTIME_MESSAGING_ENVIRONMENT")); assert.equal(invoked, 0);
  for (const parameters of [{ port: "03000" }, { enableMedia: true }]) {
    await assert.rejects(loadRuntimeMessagingEnvironment(directory, parameters, { readBundle: () => assert.fail("No read") }), errorCode("RUNTIME_MESSAGING_ENVIRONMENT"));
  }
});

test("masked SMTP input uses one bounded stdin record and rejects malformed controls without leaking diagnostics", async () => {
  const bytes = Buffer.from("user\nsynthetic-smtp-secret");
  assert.deepEqual(await readSmtpCredentials(Readable.from([bytes])), { smtpUser: "user", smtpPassword: "synthetic-smtp-secret" });
  assert.ok(bytes.every((byte) => byte === 0));
  for (const input of ["", "user", "user\n", "user\npass\n", "user\np\rass", "x".repeat(8193), Buffer.from([0xff])]) {
    await assert.rejects(readSmtpCredentials(Readable.from([input])), errorCode("RUNTIME_MESSAGING_PREPARATION_INPUT"));
  }
});

function preparationFixture() {
  const observed = { events: [], buffers: [] };
  const dependencies = { inheritedEnv, execArgv: [], exists: async () => { observed.events.push("exists"); return false; },
    readBundle: async () => { observed.events.push("bundle"); return { database: database(), authentication: authentication() }; },
    readCredentials: async () => { observed.events.push("input"); return { smtpUser: messaging().smtpUser, smtpPassword: messaging().smtpPassword }; },
    random: () => { observed.events.push("random"); const bytes = Buffer.alloc(32, 18 + observed.buffers.length); observed.buffers.push(bytes); return bytes; },
    writeConfiguration: async (_directory, value) => { observed.events.push("write"); observed.written = value; observed.saved = structuredClone(value); return { saved: true }; },
    readConfiguration: async () => { observed.events.push("readback"); return structuredClone(observed.saved); } };
  return { observed, dependencies };
}

test("preparation check inspects existing private prerequisites before input or generation; prepare saves two distinct keys once", async () => {
  const check = preparationFixture();
  assert.deepEqual(await prepare(preparationOptions, check.dependencies), { status: "ready_for_input", messagingConfigSaved: false, launchApproved: false });
  assert.deepEqual(check.observed.events, ["exists", "bundle"]);
  const f = preparationFixture();
  assert.deepEqual(await prepare({ ...preparationOptions, command: "prepare" }, f.dependencies), { status: "prepared", messagingConfigSaved: true, launchApproved: false });
  assert.deepEqual(f.observed.events, ["exists", "bundle", "input", "random", "random", "write", "readback"]);
  assert.deepEqual(f.observed.saved, messaging()); assert.equal(f.observed.written.smtpPassword, "");
  assert.equal(f.observed.written.mailKey, ""); assert.ok(f.observed.buffers.every((value) => value.every((byte) => byte === 0)));
});

test("existing or malformed prerequisites cannot consume credentials, regenerate keys or overwrite; mismatched readback never confirms", async () => {
  for (const kind of ["exists", "invalid-bundle", "origin", "collision", "readback"]) {
    const f = preparationFixture();
    if (kind === "exists") f.dependencies.exists = async () => true;
    if (kind === "invalid-bundle") f.dependencies.readBundle = async () => ({ diagnostic: database() });
    if (kind === "origin") f.dependencies.readBundle = async () => ({ database: database(), authentication: { ...authentication(), origin: "https://jessiemessage.com" } });
    if (kind === "collision") f.dependencies.random = () => Buffer.alloc(32, 17);
    if (kind === "readback") f.dependencies.readConfiguration = async () => ({ ...f.observed.saved, smtpPassword: "different" });
    await assert.rejects(prepare({ ...preparationOptions, command: "prepare" }, f.dependencies), errorCode(kind === "exists" ? "RUNTIME_MESSAGING_PREPARATION_EXISTS" : "RUNTIME_MESSAGING_PREPARATION_CONFIG"));
    if (["exists", "invalid-bundle", "origin"].includes(kind)) assert.equal(f.observed.events.includes("input"), false);
    if (kind !== "readback") assert.equal(f.observed.events.includes("write"), false);
  }
});

test("check mode waits for SQL and physical schema checks without a listener or any SMTP send", async () => {
  const events = [], source = await environment(); let checkedEnv;
  const result = await startup(options, { inheritedEnv, execArgv: [], loadEnvironment: async () => source,
    inspect: async ({ env, databaseName }) => { assert.equal(databaseName, database().database); checkedEnv = env; events.push("database"); return inspection(); },
    checkSchema: async () => { events.push("schema"); }, startServer: () => assert.fail("No listener or SMTP allowed") });
  assert.deepEqual(events, ["database", "schema"]);
  assert.deepEqual(result, { status: "checks_passed", profile: "messaging-text", started: false, smtpDeliveryTested: false, launchApproved: false });
  for (const name of ["JESSIEMESSAGE_RUNTIME_DB_PASSWORD", "JESSIEMESSAGE_MFA_KEY", "JESSIEMESSAGE_MAIL_KEY", "JESSIEMESSAGE_MESSAGE_KEY", "JESSIEMESSAGE_SMTP_PASSWORD"]) {
    assert.equal(checkedEnv[name], ""); assert.notEqual(source[name], "");
  }
});

test("start waits for listener and pins request origin; failed preflight/schema/configuration never falls back to neutral startup", async () => {
  const events = [];
  const dependencies = { inheritedEnv, execArgv: [], loadEnvironment: environment, inspect: async () => inspection(),
    checkSchema: async () => { events.push("schema"); }, startServer: async (env, selected) => {
      assert.deepEqual(selected, { requestOrigin: origin }); assert.equal(env.JESSIEMESSAGE_ENABLE_CHAT, "1"); events.push("listener"); } };
  const result = await startup({ ...options, command: "start" }, dependencies);
  assert.equal(result.started, true); assert.deepEqual(events, ["schema", "listener"]);
  for (const kind of ["config", "database", "schema", "environment"]) {
    let started = false; const selected = { ...dependencies, startServer: () => { started = true; } };
    if (kind === "config") selected.loadEnvironment = async () => ({ ...await environment(), JESSIEMESSAGE_ENABLE_CHAT: "0" });
    if (kind === "database") selected.inspect = async () => { const value = inspection(); value.checks[0].status = "fail"; value.valid = false; return value; };
    if (kind === "schema") selected.checkSchema = async () => { throw new Error("synthetic-private-error"); };
    if (kind === "environment") selected.inheritedEnv = { ...inheritedEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" };
    await assert.rejects(startup({ ...options, command: "start" }, selected), errorCode(`PRIVATE_MESSAGING_${kind === "config" ? "CONFIGURATION" : kind.toUpperCase()}`));
    assert.equal(started, false);
  }
});

test("CLI metadata allows neither credentials, keys nor arbitrary feature activation in arguments", () => {
  const args = ["check", "--private-directory", directory, "--private-path-mode", "linux-dirfd"];
  assert.deepEqual(startupArguments(args), options);
  assert.deepEqual(prepareArguments([...args, "--smtp-host", preparationOptions.smtpHost, "--smtp-port", "587"]), preparationOptions);
  for (const selected of [[], [...args, "--password", "synthetic-secret"], [...args, "--mail-key", key(18)], ["start", ...args.slice(1), "--enable-media", "1"]]) {
    assert.throws(() => startupArguments(selected), errorCode("PRIVATE_MESSAGING_USAGE"));
  }
});
