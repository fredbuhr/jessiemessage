import test from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { resolve } from "node:path";
import { validateRuntimeNotificationsConfiguration } from "../server/config/runtime-database-file.mjs";
import { loadRuntimeNotificationsEnvironment, copyRuntimeNotificationsEnvironment, NOTIFICATIONS_ENV_FIELDS } from "../server/config/runtime-notifications-file.mjs";
import { loadRuntimeMediaEnvironment, copyRuntimeMediaEnvironment } from "../server/config/runtime-media.mjs";
import { copyRuntimeMessagingEnvironment, clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";
import { run as prepare, parseArguments as prepareArguments, generateNotificationVapidKeys } from "../scripts/prepare-runtime-notifications.mjs";
import { run as launch, parseArguments as startupArguments } from "../scripts/start-private-messaging.mjs";
import { DATABASE_CHECK_NAMES } from "../server/preflight/database.mjs";

const directory = resolve("../audit/private-notifications-fixture"), mediaRoot = resolve("../audit/owned-notifications-photos-fixture");
const key = byte => Buffer.alloc(32, byte).toString("base64url"), origin = "https://recette.jessiemessage.com";
const inheritedEnv = { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" };
function vapid(byte = 7) { const curve = createECDH("prime256v1"); curve.setPrivateKey(Buffer.alloc(32, byte)); return { publicKey: curve.getPublicKey(undefined, "uncompressed"), privateKey: curve.getPrivateKey() }; }
const notifications = () => { const pair = vapid(); return { version: 1, origin, notificationKey: key(5), vapidPublicKey: pair.publicKey.toString("base64url"),
  vapidPrivateKey: pair.privateKey.toString("base64url"), vapidSubject: "mailto:contact@jessiemessage.com" }; };
const bundle = () => ({
  database: { format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306",
    database: "only_recipe", user: "runtime_user", password: "synthetic-db-password", privilegeProfile: "infomaniak-shared-pattern" },
  authentication: { format: "jessiemessage-runtime-auth", version: 1, origin, mfaKey: key(1) },
  messaging: { format: "jessiemessage-runtime-messaging", version: 1, origin, mailKey: key(2), messageKey: key(3),
    smtpHost: "smtp.example.invalid", smtpPort: "587", smtpUser: "synthetic-user", smtpPassword: "synthetic-smtp-password" },
  media: { format: "jessiemessage-runtime-media", version: 1, origin, mediaKey: key(4), mediaRoot,
    ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "536870912" }, notifications: notifications(),
});
const environment = () => loadRuntimeNotificationsEnvironment(directory, {}, { readBundle: async () => bundle() });
const neutral = code => error => error.code === code && error.cause === undefined && !JSON.stringify(error).includes("synthetic-");

test("private notifications record has exactly six data fields, canonical independent AES and a matching P-256 pair", () => {
  const source = notifications(), before = structuredClone(source);
  assert.deepEqual(validateRuntimeNotificationsConfiguration(Object.freeze(source)), before);
  for (const override of [{ version: "1" }, { format: "extra" }, { notificationKey: "invalid" }, { notificationKey: source.vapidPrivateKey },
    { notificationKey: `${key(5)}=` }, { origin: "https://jessiemessage.com" }, { origin: `${origin}/` },
    { vapidPublicKey: vapid(8).publicKey.toString("base64url") }, { vapidPrivateKey: key(0) }, { vapidPrivateKey: key(255) },
    { vapidSubject: "mailto:other@example.invalid" }, { vapidSubject: "https://jessiemessage.com" }]) {
    assert.throws(() => validateRuntimeNotificationsConfiguration({ ...source, ...override }), neutral("RUNTIME_NOTIFICATIONS_CONFIGURATION"));
  }
  let invoked = 0; const accessor = { ...source };
  Object.defineProperty(accessor, "vapidPrivateKey", { get() { invoked++; throw new Error("synthetic-private-key"); } });
  assert.throws(() => validateRuntimeNotificationsConfiguration(accessor), neutral("RUNTIME_NOTIFICATIONS_CONFIGURATION"));
  assert.equal(invoked, 0); assert.deepEqual(source, before);
});

test("one anchored bundle fixes the notify profile and preserves all four old configurations and input records", async () => {
  const source = bundle(), before = structuredClone(source); let reads = 0;
  const env = await loadRuntimeNotificationsEnvironment(directory, { port: "4321" }, { readBundle: async () => { reads++; return source; } });
  assert.equal(reads, 1); assert.deepEqual(source, before); assert.equal(env.PORT, "4321");
  assert.deepEqual(Object.keys(env).sort(), [...NOTIFICATIONS_ENV_FIELDS].sort());
  for (const name of ["AUTH", "ACCESS", "CHAT", "MAIL_DELIVERY", "MEDIA", "NOTIFICATIONS"]) assert.equal(env[`JESSIEMESSAGE_ENABLE_${name}`], "1");
  for (const name of ["CRM", "BROADCAST", "CLIENT_RECOVERY"]) assert.equal(env[`JESSIEMESSAGE_ENABLE_${name}`], "0");
  for (const [name, value] of [["MFA", key(1)], ["MAIL", key(2)], ["MESSAGE", key(3)], ["MEDIA", key(4)], ["NOTIFICATIONS", key(5)]]) assert.equal(env[`JESSIEMESSAGE_${name}_KEY`], value);
  assert.deepEqual(copyRuntimeNotificationsEnvironment(env), env);
  assert.throws(() => copyRuntimeMessagingEnvironment(env)); assert.throws(() => copyRuntimeMediaEnvironment(env));
});

test("notify environment rejects every domain collision, origin drift, missing/accessor fields and unrelated activation before SQL", async () => {
  for (const change of [1, 2, 3, 4]) {
    const source = bundle(); source.notifications.notificationKey = key(change);
    await assert.rejects(loadRuntimeNotificationsEnvironment(directory, {}, { readBundle: async () => source }), neutral("RUNTIME_NOTIFICATIONS_ENVIRONMENT"));
    const pair = vapid(change); source.notifications = { ...notifications(), vapidPublicKey: pair.publicKey.toString("base64url"), vapidPrivateKey: pair.privateKey.toString("base64url") };
    await assert.rejects(loadRuntimeNotificationsEnvironment(directory, {}, { readBundle: async () => source }), neutral("RUNTIME_NOTIFICATIONS_ENVIRONMENT"));
  }
  const source = bundle(); source.notifications.origin = "https://other.jessiemessage.com";
  await assert.rejects(loadRuntimeNotificationsEnvironment(directory, {}, { readBundle: async () => source }), neutral("RUNTIME_NOTIFICATIONS_ENVIRONMENT"));
  const env = await environment();
  for (const override of [{ JESSIEMESSAGE_ENABLE_NOTIFICATIONS: "0" }, { JESSIEMESSAGE_ENABLE_CRM: "1" }, { JESSIEMESSAGE_ENABLE_BROADCAST: "1" },
    { JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "1" }, { JESSIEMESSAGE_MEDIA_KEY: key(5) }, { JESSIEMESSAGE_NOTIFICATIONS_KEY: key(1) }, { JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1" }]) {
    assert.throws(() => copyRuntimeNotificationsEnvironment({ ...env, ...override }), neutral("RUNTIME_NOTIFICATIONS_ENVIRONMENT"));
  }
  let invoked = 0; const accessor = { ...env }; Object.defineProperty(accessor, "JESSIEMESSAGE_VAPID_PRIVATE_KEY", { get() { invoked++; return key(7); } });
  assert.throws(() => copyRuntimeNotificationsEnvironment(accessor), neutral("RUNTIME_NOTIFICATIONS_ENVIRONMENT")); assert.equal(invoked, 0);
  for (const options of [{ port: "03000" }, { enableNotifications: true }]) await assert.rejects(loadRuntimeNotificationsEnvironment(directory, options, {
    readBundle: () => assert.fail("No configuration read before validated options"),
  }), neutral("RUNTIME_NOTIFICATIONS_ENVIRONMENT"));
});

function preparation() {
  const { notifications: omitted, ...source } = bundle();
  const state = { events: [], buffers: [], writes: 0, saved: null };
  const options = prepareArguments(["prepare", "--private-directory", directory, "--private-path-mode", "linux-dirfd"]);
  const dependencies = { inheritedEnv, execArgv: [], readBundle: async () => { state.events.push("read"); return source; },
    exists: async () => { state.events.push("exists"); return false; },
    random: () => { state.events.push("random"); const result = Buffer.alloc(32, 5); state.buffers.push(result); return result; },
    generateVapid: () => { state.events.push("vapid"); const result = vapid(); state.buffers.push(result.publicKey, result.privateKey); return result; },
    writeConfiguration: async (_directory, value) => { state.events.push("write"); state.writes++; state.saved = structuredClone(value); return { saved: true }; },
    readConfiguration: async () => { state.events.push("readback"); return structuredClone(state.saved); } };
  return { source, state, options, dependencies };
}

test("notification preparation checks the existing photo profile before generation and publishes only one exclusive new record", async () => {
  const check = preparation(), beforeCheck = structuredClone(check.source);
  const result = await prepare({ ...check.options, command: "check" }, check.dependencies);
  assert.equal(result.status, "ready_for_prepare"); assert.equal(result.notificationsConfigSaved, false);
  assert.deepEqual(check.state.events, ["exists", "read"]); assert.deepEqual(check.source, beforeCheck);
  const f = preparation(), before = structuredClone(f.source), saved = await prepare(f.options, f.dependencies);
  assert.deepEqual(saved, { status: "prepared", profile: "messaging-photos-notify", notificationsConfigSaved: true, keysPreserved: true, started: false, migrationPerformed: false });
  assert.deepEqual(f.state.events, ["exists", "read", "random", "vapid", "write", "readback"]);
  assert.equal(f.state.writes, 1); assert.deepEqual(f.source, before); assert.deepEqual(f.state.saved, notifications());
  assert.ok(f.state.buffers.every(bytes => bytes.every(byte => byte === 0)));
  for (const value of [notifications().notificationKey, notifications().vapidPrivateKey, "synthetic-"]) assert.equal(JSON.stringify(saved).includes(value), false);
});

test("existing notification config, invalid base, invalid pairs, reused keys and ambiguous publication never trigger regeneration or false success", async () => {
  for (const kind of ["exists", "base", "environment", "pair", "collision", "publication", "readback"]) {
    const f = preparation();
    if (kind === "exists") f.dependencies.exists = async () => true;
    if (kind === "base") f.source.authentication.mfaKey = "invalid";
    if (kind === "environment") f.dependencies.inheritedEnv = { ...inheritedEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" };
    if (kind === "pair") f.dependencies.generateVapid = () => ({ publicKey: vapid().publicKey, privateKey: vapid(8).privateKey });
    if (kind === "collision") f.dependencies.random = () => Buffer.alloc(32, 1);
    if (kind === "publication") f.dependencies.writeConfiguration = async () => ({ saved: false });
    if (kind === "readback") f.dependencies.readConfiguration = async () => ({ ...f.state.saved, notificationKey: key(9) });
    await assert.rejects(prepare(f.options, f.dependencies), error => error.code.startsWith("PRIVATE_NOTIFICATIONS_") && !JSON.stringify(error).includes("synthetic"));
    assert.equal(f.state.writes, kind === "readback" ? 1 : 0);
    if (["exists", "base", "environment"].includes(kind)) assert.equal(f.state.buffers.length, 0);
  }
});

test("strict private start checks notifications schema and photo storage before listening, preserves injected source and clears copied secrets", async () => {
  const options = startupArguments(["start", "--profile", "photos-notify", "--private-directory", directory, "--private-path-mode", "linux-dirfd"]);
  assert.equal(options.profile, "photos-notify"); const source = await environment(), before = structuredClone(source), events = []; let selected;
  const dependencies = { inheritedEnv, execArgv: [], loadEnvironment: async () => source,
    inspect: async () => ({ valid: true, checks: DATABASE_CHECK_NAMES.map(name => ({ name, status: "pass" })),
      privilegeObservation: { profile: "infomaniak-shared-pattern", source: "show_grants_and_visible_schemata", ledgerWritable: true, tempTables: true,
        tableLocks: true, permanentDdl: false, databaseNamePattern: true, visibleApplicationNamespace: "selected_only", futureMatchingDatabasesUnproven: true } }),
    checkSchema: async env => { assert.equal(env.JESSIEMESSAGE_ENABLE_NOTIFICATIONS, "1"); events.push("schema"); }, checkStorage: async () => events.push("storage"),
    startServer: async (env, parameters) => { selected = env; assert.deepEqual(parameters, { requestOrigin: origin }); events.push("start"); } };
  assert.equal((await launch(options, dependencies)).profile, "messaging-photos-notify"); assert.deepEqual(events, ["schema", "storage", "start"]);
  assert.deepEqual(source, before); assert.equal(selected.JESSIEMESSAGE_NOTIFICATIONS_KEY, ""); assert.equal(selected.JESSIEMESSAGE_VAPID_PRIVATE_KEY, "");
  let started = false;
  await assert.rejects(launch(options, { ...dependencies, checkStorage: async () => { throw new Error("synthetic-storage"); }, startServer: () => { started = true; } }), neutral("PRIVATE_MESSAGING_SCHEMA"));
  assert.equal(started, false);
});

test("old photo profiles stay notifications-disabled and CLI arguments cannot contain keys or feature bypasses", async () => {
  const { notifications: omitted, ...source } = bundle();
  const old = await loadRuntimeMediaEnvironment(directory, {}, { readBundle: async () => source });
  assert.equal(old.JESSIEMESSAGE_ENABLE_NOTIFICATIONS, "0");
  assert.throws(() => copyRuntimeMediaEnvironment({ ...old, JESSIEMESSAGE_ENABLE_NOTIFICATIONS: "1" }));
  const args = ["check", "--private-directory", directory, "--private-path-mode", "linux-dirfd"];
  for (const extra of [["--vapid-private-key", key(7)], ["--notification-key", key(5)], ["--enable-notifications", "1"], ["--profile", "photos-notify"]]) {
    assert.throws(() => prepareArguments([...args, ...extra]), neutral("PRIVATE_NOTIFICATIONS_USAGE"));
  }
  const env = await environment(); clearRuntimeMessagingSecrets(env); assert.equal(env.JESSIEMESSAGE_VAPID_PRIVATE_KEY, ""); assert.equal(env.JESSIEMESSAGE_NOTIFICATIONS_KEY, "");
});


test("VAPID generation pads small valid P-256 scalars to 32 bytes and erases the minimal export", () => {
  for (const scalar of [Buffer.from([1]), Buffer.alloc(31, 7)]) {
    const curve = createECDH("prime256v1"); curve.setPrivateKey(scalar);
    const minimal = curve.getPrivateKey(); assert.equal(minimal.length, scalar.length);
    const pair = generateNotificationVapidKeys(name => {
      assert.equal(name, "prime256v1");
      return { generateKeys() {}, getPrivateKey: () => minimal, getPublicKey: (...args) => curve.getPublicKey(...args) };
    });
    assert.equal(pair.privateKey.length, 32); assert.ok(minimal.every(byte => byte === 0));
    assert.deepEqual(pair.privateKey.subarray(32 - scalar.length), scalar);
    assert.ok(pair.privateKey.subarray(0, 32 - scalar.length).every(byte => byte === 0));
    const record = { ...notifications(), vapidPublicKey: pair.publicKey.toString("base64url"), vapidPrivateKey: pair.privateKey.toString("base64url") };
    assert.deepEqual(validateRuntimeNotificationsConfiguration(record), record);
    pair.privateKey.fill(0); pair.publicKey.fill(0); scalar.fill(0);
  }
});
