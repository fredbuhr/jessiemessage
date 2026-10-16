import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { validateRuntimeMediaConfiguration } from "../server/config/runtime-database-file.mjs";
import { loadRuntimeMediaEnvironment, copyRuntimeMediaEnvironment, MEDIA_ENV_FIELDS } from "../server/config/runtime-media.mjs";
import { copyRuntimeMessagingEnvironment } from "../server/config/runtime-messaging.mjs";
import { checkRuntimeMediaStorage } from "../server/config/runtime-media-storage.mjs";
import { run as prepare, parseArguments as prepareArguments } from "../scripts/prepare-runtime-media.mjs";
import { run as launch, parseArguments as startupArguments } from "../scripts/start-private-messaging.mjs";
import { DATABASE_CHECK_NAMES } from "../server/preflight/database.mjs";

const directory = resolve("../audit/private-photos-fixture"), mediaRoot = resolve("../audit/owned-photos-fixture");
const key = byte => Buffer.alloc(32, byte).toString("base64url"), origin = "https://recette.jessiemessage.com";
const inheritedEnv = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" };
const media = () => ({ format: "jessiemessage-runtime-media", version: 1, origin, mediaKey: key(4), mediaRoot,
  ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "536870912" });
const bundle = () => ({
  database: { format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306",
    database: "only_recipe", user: "runtime_user", password: "synthetic-db-password", privilegeProfile: "infomaniak-shared-pattern" },
  authentication: { format: "jessiemessage-runtime-auth", version: 1, origin, mfaKey: key(1) },
  messaging: { format: "jessiemessage-runtime-messaging", version: 1, origin, mailKey: key(2), messageKey: key(3),
    smtpHost: "smtp.example.invalid", smtpPort: "587", smtpUser: "synthetic-user", smtpPassword: "synthetic-smtp-password" },
  media: media(),
});
const environment = () => loadRuntimeMediaEnvironment(directory, {}, { readBundle: async () => bundle() });
const neutral = code => error => error.code === code && error.cause === undefined && !JSON.stringify(error).includes("synthetic-");

test("photo records require canonical private paths, quotas, real key syntax and data properties", () => {
  const good = media(); assert.deepEqual(validateRuntimeMediaConfiguration(Object.freeze(good)), good);
  for (const override of [{ version: "1" }, { mediaKey: "invalid" }, { mediaKey: key(4) + "=" }, { origin: "https://jessiemessage.com" },
    { mediaRoot: resolve("public") }, { mediaRoot: "/" }, { mediaRoot: "/private/../media" }, { ownerBytes: "01" },
    { ownerBytes: "81" }, { ownerBytes: "10737418241" }, { totalBytes: "1125899906842625" }, { minimumFreeBytes: "-1" }, { extra: true }]) {
    assert.throws(() => validateRuntimeMediaConfiguration({ ...good, ...override }), neutral("RUNTIME_MESSAGING_CONFIGURATION"));
  }
  let reads = 0; const accessor = { ...good };
  Object.defineProperty(accessor, "mediaKey", { get() { reads++; return key(4); } });
  assert.throws(() => validateRuntimeMediaConfiguration(accessor), neutral("RUNTIME_MESSAGING_CONFIGURATION")); assert.equal(reads, 0);
});

test("one private photo bundle preserves all current secrets, fixes the enabled profile and leaves injected records unchanged", async () => {
  const source = bundle(), before = structuredClone(source); let reads = 0;
  const env = await loadRuntimeMediaEnvironment(directory, { port: "4321" }, { readBundle: async () => { reads++; return source; } });
  assert.equal(reads, 1); assert.deepEqual(source, before); assert.equal(env.PORT, "4321");
  assert.deepEqual(Object.keys(env).sort(), [...MEDIA_ENV_FIELDS].sort());
  for (const name of ["AUTH", "ACCESS", "CHAT", "MAIL_DELIVERY", "MEDIA"]) assert.equal(env[`JESSIEMESSAGE_ENABLE_${name}`], "1");
  for (const name of ["CRM", "BROADCAST", "CLIENT_RECOVERY"]) assert.equal(env[`JESSIEMESSAGE_ENABLE_${name}`], "0");
  assert.equal(env.JESSIEMESSAGE_MFA_KEY, key(1)); assert.equal(env.JESSIEMESSAGE_MAIL_KEY, key(2));
  assert.equal(env.JESSIEMESSAGE_MESSAGE_KEY, key(3)); assert.equal(env.JESSIEMESSAGE_MEDIA_KEY, key(4));
  assert.throws(() => copyRuntimeMessagingEnvironment(env)); assert.deepEqual(copyRuntimeMediaEnvironment(env), env);
});

test("photos cannot collide with existing keys or silently enable unrelated domains", async () => {
  for (const mediaKey of [key(1), key(2), key(3)]) {
    const source = bundle(); source.media.mediaKey = mediaKey;
    await assert.rejects(loadRuntimeMediaEnvironment(directory, {}, { readBundle: async () => source }), neutral("RUNTIME_MEDIA_ENVIRONMENT"));
  }
  const source = bundle(); source.media.origin = "https://other.jessiemessage.com";
  await assert.rejects(loadRuntimeMediaEnvironment(directory, {}, { readBundle: async () => source }), neutral("RUNTIME_MEDIA_ENVIRONMENT"));
  const env = await environment();
  for (const override of [{ JESSIEMESSAGE_ENABLE_MEDIA: "0" }, { JESSIEMESSAGE_ENABLE_CRM: "1" }, { JESSIEMESSAGE_ENABLE_BROADCAST: "1" },
    { JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "1" }, { JESSIEMESSAGE_MEDIA_TOTAL_BYTES: "01" }, { JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1" }]) {
    assert.throws(() => copyRuntimeMediaEnvironment({ ...env, ...override }), neutral("RUNTIME_MEDIA_ENVIRONMENT"));
  }
});

function preparation() {
  const source = bundle(), { media: unused, ...existing } = source;
  const state = { events: [], writes: 0, saved: null, buffers: [] };
  const options = prepareArguments(["prepare", "--private-directory", directory, "--private-path-mode", "linux-dirfd", "--media-root", mediaRoot]);
  const dependencies = { inheritedEnv, execArgv: [], exists: async () => false, readBundle: async () => existing,
    random: () => { state.events.push("random"); const bytes = Buffer.alloc(32, 4); state.buffers.push(bytes); return bytes; },
    verifySource: async () => { state.events.push("source"); }, inspectStorage: async (_env, opts) => { assert.equal(opts.requireInitialized, false); state.events.push("storage"); },
    list: async () => [], writeConfiguration: async (_directory, value) => { state.events.push("write"); state.writes++; state.saved = structuredClone(value); return { saved: true }; },
    readConfiguration: async () => structuredClone(state.saved) };
  return { source: existing, options, dependencies, state };
}

test("photo preparation preserves existing secrets, checks source/native storage before exclusive publication and erases transient keys", async () => {
  const f = preparation(), before = structuredClone(f.source), report = await prepare(f.options, f.dependencies);
  assert.deepEqual(report, { status: "prepared", mediaConfigSaved: true, keysPreserved: true, started: false });
  assert.deepEqual(f.state.events, ["random", "source", "storage", "write"]); assert.equal(f.state.writes, 1);
  assert.deepEqual(f.state.saved, media()); assert.deepEqual(f.source, before);
  assert.ok(f.state.buffers.every(value => value.every(byte => byte === 0))); assert.doesNotMatch(JSON.stringify(report), /synthetic|mediaKey|password/);
  const check = preparation(); await prepare({ ...check.options, command: "check" }, check.dependencies); assert.equal(check.state.writes, 0);
});

test("existing media config, populated source, nonempty root and readback mismatch fail closed without replacement", async () => {
  for (const kind of ["exists", "source", "root", "readback", "environment", "invalid-base"]) {
    const f = preparation();
    if (kind === "exists") f.dependencies.exists = async () => true;
    if (kind === "source") f.dependencies.verifySource = async () => { throw new Error("synthetic private rows"); };
    if (kind === "root") f.dependencies.list = async () => ["synthetic-existing-object"];
    if (kind === "readback") f.dependencies.readConfiguration = async () => ({ ...f.state.saved, mediaKey: key(9) });
    if (kind === "environment") f.dependencies.inheritedEnv = { ...inheritedEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" };
    if (kind === "invalid-base") f.source.authentication.mfaKey = "invalid";
    await assert.rejects(prepare(f.options, f.dependencies), error => error.code.startsWith("PRIVATE_MEDIA_") && !JSON.stringify(error).includes("synthetic"));
    assert.equal(f.state.writes, kind === "readback" ? 1 : 0);
    if (["exists", "environment", "invalid-base"].includes(kind)) assert.equal(f.state.buffers.length, 0);
  }
});

test("photo startup waits for capacity/storage checks before the listener and preserves the exact text default", async () => {
  const args = ["check", "--profile", "photos", "--private-directory", directory, "--private-path-mode", "linux-dirfd"];
  const options = startupArguments(args); assert.equal(options.profile, "photos");
  assert.equal(Object.hasOwn(startupArguments([args[0], ...args.slice(3)]), "profile"), false);
  const events = [], dependencies = { inheritedEnv, execArgv: [], loadEnvironment: environment,
    inspect: async () => ({ valid: true, checks: DATABASE_CHECK_NAMES.map(name => ({ name, status: "pass" })),
      privilegeObservation: { profile: "infomaniak-shared-pattern", source: "show_grants_and_visible_schemata", ledgerWritable: true,
        tempTables: true, tableLocks: true, permanentDdl: false, databaseNamePattern: true,
        visibleApplicationNamespace: "selected_only", futureMatchingDatabasesUnproven: true } }),
    checkSchema: async () => events.push("schema"), checkStorage: async () => events.push("storage"), startServer: async () => events.push("start") };
  const checked = await launch(options, dependencies); assert.equal(checked.profile, "messaging-photos"); assert.deepEqual(events, ["schema", "storage"]);
  await launch({ ...options, command: "start" }, dependencies); assert.deepEqual(events.slice(-3), ["schema", "storage", "start"]);
  await assert.rejects(launch({ ...options, command: "start" }, { ...dependencies, checkStorage: async () => { throw new Error(); } }), neutral("PRIVATE_MESSAGING_SCHEMA"));
  assert.equal(events.filter(x => x === "start").length, 1);
});

test("storage preflight exercises the real native worker without writes, checks capacity readiness and closes its pool", async () => {
  const env = await environment(), events = [];
  const dependencies = { createPool: async () => ({ end: async () => events.push("end") }),
    makeStorage: async () => ({ fingerprint: async () => Buffer.alloc(32, 6), availableSpace: async () => ({ availableBytes: 20000000000n }), assertReady: async () => events.push("root") }),
    makeCapacity: () => ({ assertSchema: async () => events.push("schema"), status: async () => ({ ready: true }) }) };
  const report = await checkRuntimeMediaStorage(env, dependencies); assert.equal(report.nativeDecoderVerified, true); assert.equal(report.ready, true);
  assert.deepEqual(events, ["schema", "root", "end"]);
  await assert.rejects(checkRuntimeMediaStorage(env, { ...dependencies, requireInitialized: false }), neutral("RUNTIME_MEDIA_STORAGE"));
  assert.equal(events.at(-1), "end");
});
