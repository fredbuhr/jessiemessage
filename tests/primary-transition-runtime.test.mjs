import test from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { chmod, mkdir, mkdtemp, readFile, rm, statfs, writeFile } from "node:fs/promises";
import { createAppServer, createConfiguredServer } from "../server/index.mjs";
import { createAuthHandler } from "../server/auth/http.mjs";
import { createEntryHandler } from "../server/entry/http.mjs";
import { inspectPreproductionConfiguration, PRIMARY_NOTIFICATIONS_CONFIG_CHECK_NAMES, PRIMARY_NOTIFICATIONS_RECOVERY_CONFIG_CHECK_NAMES } from "../server/preflight/config.mjs";
import { loadRuntimeMessagingEnvironment, copyRuntimeMessagingEnvironment } from "../server/config/runtime-messaging.mjs";
import { loadRuntimeMediaEnvironment, copyRuntimeMediaEnvironment } from "../server/config/runtime-media.mjs";
import { loadRuntimeNotificationsEnvironment, copyRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";
import { parseArguments, run } from "../scripts/start-private-messaging.mjs";
import { DATABASE_CHECK_NAMES } from "../server/preflight/database.mjs";

const primary = "https://jessiemessage.com", recipe = "https://recette.jessiemessage.com";
const directory = "/private/synthetic-primary-transition", key = value => Buffer.alloc(32, value).toString("base64url");
const supported = process.platform === "linux" && await statfs("/proc/self/fd", { bigint: true }).then(stats => stats.type === 0x9fa0n, () => false);
function bundle(origin = primary) {
  const vapid = createECDH("prime256v1"); vapid.setPrivateKey(Buffer.alloc(32, 7));
  return {
    database: { format: "jessiemessage-runtime-database", version: 1, host: "db.example.invalid", port: "3306", database: "synthetic_primary",
      user: "synthetic_runtime", password: "synthetic-db-password", privilegeProfile: "infomaniak-shared-pattern" },
    authentication: { format: "jessiemessage-runtime-auth", version: 1, origin, mfaKey: key(1) },
    messaging: { format: "jessiemessage-runtime-messaging", version: 1, origin, mailKey: key(2), messageKey: key(3),
      smtpHost: "smtp.example.invalid", smtpPort: "587", smtpUser: "synthetic-smtp-user", smtpPassword: "synthetic-smtp-password" },
    media: { format: "jessiemessage-runtime-media", version: 1, origin, mediaKey: key(4), mediaRoot: resolve("../synthetic-primary-media"),
      ownerBytes: "1073741824", totalBytes: "10737418240", minimumFreeBytes: "536870912" },
    notifications: { version: 1, origin, notificationKey: key(5), vapidPublicKey: vapid.getPublicKey().toString("base64url"),
      vapidPrivateKey: vapid.getPrivateKey().toString("base64url"), vapidSubject: "mailto:contact@jessiemessage.com" },
  };
}
const load = (origin = primary, options = { originProfile: "primary" }) => loadRuntimeNotificationsEnvironment(directory, options, { readBundle: async () => bundle(origin) });
const fail = code => error => error.code === code && !error.cause && !JSON.stringify(error).includes("synthetic-");

test("primary profile is explicit at each layered loader and copy boundary, preserving the exact recipe default", async () => {
  for (const [loader, copy, fields] of [[loadRuntimeMessagingEnvironment, copyRuntimeMessagingEnvironment, ["database", "authentication", "messaging"]],
    [loadRuntimeMediaEnvironment, copyRuntimeMediaEnvironment, ["database", "authentication", "messaging", "media"]],
    [loadRuntimeNotificationsEnvironment, copyRuntimeNotificationsEnvironment, ["database", "authentication", "messaging", "media", "notifications"]]]) {
    const source = Object.fromEntries(fields.map(name => [name, bundle()[name]])), before = structuredClone(source);
    const dependencies = { readBundle: async () => source };
    await assert.rejects(loader(directory, {}, dependencies));
    const env = await loader(directory, { originProfile: "primary", port: "4321" }, dependencies);
    assert.equal(env.JESSIEMESSAGE_SITE_ORIGIN, primary); assert.equal(env.PORT, "4321");
    assert.throws(() => copy(env)); assert.deepEqual(copy(env, { originProfile: "primary" }), env);
    assert.deepEqual(source, before);
    const old = Object.fromEntries(fields.map(name => [name, bundle(recipe)[name]]));
    const oldEnv = await loader(directory, {}, { readBundle: async () => old });
    assert.equal(oldEnv.JESSIEMESSAGE_SITE_ORIGIN, recipe); assert.deepEqual(copy(oldEnv), oldEnv);
    await assert.rejects(loader(directory, { originProfile: "primary" }, { readBundle: async () => old }));
  }
});

test("Linux CI runs the real primary runtime readers through anchored private files", { skip: !process.env.CI || process.platform !== "linux" }, () => assert.equal(supported, true));

test("real file-backed text, photo and notification loaders forward the primary profile through every reader layer", { skip: !supported }, async t => {
  const parent = resolve("../audit"); await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(`${parent}/primary-runtime-readers-`); await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  const names = ["runtime-database.json", "runtime-auth.json", "runtime-messaging.json", "runtime-media.json", "runtime-notifications.json"];
  const fields = ["database", "authentication", "messaging", "media", "notifications"];
  async function save(origin) {
    const value = bundle(origin);
    for (let index = 0; index < fields.length; index++) await writeFile(`${root}/${names[index]}`, JSON.stringify(value[fields[index]]) + "\n", { mode: 0o600 });
  }
  const bytes = () => Promise.all(names.map(name => readFile(`${root}/${name}`, "utf8")));
  const loaders = [loadRuntimeMessagingEnvironment, loadRuntimeMediaEnvironment, loadRuntimeNotificationsEnvironment];
  await save(primary); const primaryBefore = await bytes();
  for (const loader of loaders) {
    await assert.rejects(loader(root));
    const env = await loader(root, { originProfile: "primary" });
    assert.equal(env.JESSIEMESSAGE_SITE_ORIGIN, primary); assert.equal(env.JESSIEMESSAGE_MFA_KEY, key(1));
    assert.equal(env.JESSIEMESSAGE_MAIL_KEY, key(2)); assert.equal(env.JESSIEMESSAGE_MESSAGE_KEY, key(3));
    if (loader !== loadRuntimeMessagingEnvironment) assert.equal(env.JESSIEMESSAGE_MEDIA_KEY, key(4));
    if (loader === loadRuntimeNotificationsEnvironment) assert.equal(env.JESSIEMESSAGE_NOTIFICATIONS_KEY, key(5));
  }
  assert.deepEqual(await bytes(), primaryBefore);
  await save(recipe); const recipeBefore = await bytes();
  for (const loader of loaders) {
    assert.equal((await loader(root)).JESSIEMESSAGE_SITE_ORIGIN, recipe);
    await assert.rejects(loader(root, { originProfile: "primary" }));
  }
  assert.deepEqual(await bytes(), recipeBefore);
});

test("primary diagnostics identify the primary origin and retain TLS, key, flags and origin drift failures", async () => {
  const env = await load(), options = { expectedOrigin: primary, originProfile: "primary", target: "messaging-photos-notify" };
  const report = inspectPreproductionConfiguration(env, options);
  assert.equal(report.valid, true); assert.deepEqual(report.checks.map(row => row.name), PRIMARY_NOTIFICATIONS_CONFIG_CHECK_NAMES);
  assert.equal(report.checks.find(row => row.name === "primary_origin").status, "pass");
  assert.ok(!report.checks.some(row => row.name === "official_subdomain"));
  assert.equal(inspectPreproductionConfiguration(env, { expectedOrigin: primary, target: "messaging-photos-notify" }).valid, false);
  for (const override of [{ JESSIEMESSAGE_SITE_ORIGIN: recipe }, { JESSIEMESSAGE_SITE_ORIGIN: `${primary}/` },
    { JESSIEMESSAGE_SITE_ORIGIN: "https://www.jessiemessage.com" }, { JESSIEMESSAGE_DB_HOST: "127.0.0.1", JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1" },
    { JESSIEMESSAGE_NOTIFICATIONS_KEY: env.JESSIEMESSAGE_MFA_KEY }, { JESSIEMESSAGE_ENABLE_CRM: "1" }]) {
    assert.equal(inspectPreproductionConfiguration({ ...env, ...override }, options).valid, false);
    assert.throws(() => copyRuntimeNotificationsEnvironment({ ...env, ...override }, { originProfile: "primary" }));
  }
  assert.doesNotMatch(JSON.stringify(report), /synthetic|password|smtp|privateKey|base64|mailto/);
});

test("new profile options reject accessors, symbols, inherited or arbitrary activation without executing caller code", async () => {
  const env = await load(); let getters = 0;
  const accessor = {}; Object.defineProperty(accessor, "originProfile", { enumerable: true, get() { getters++; return "primary"; } });
  for (const options of [accessor, { originProfile: true }, { originProfile: "production" }, { originProfile: "primary", other: true },
    Object.create({ originProfile: "primary" }), { originProfile: "primary", [Symbol("extra")]: true }]) {
    assert.throws(() => copyRuntimeNotificationsEnvironment(env, options));
    await assert.rejects(loadRuntimeNotificationsEnvironment(directory, options, { readBundle: () => assert.fail("No configuration read") }));
  }
  assert.equal(getters, 0);
  const runtimeAccessor = {}; Object.defineProperty(runtimeAccessor, "deviceTransition", { get() { getters++; return true; } });
  for (const options of [runtimeAccessor, { deviceTransition: "1" }, { deviceTransition: undefined }, { deviceTransition: true },
    { deviceTransition: true, requestOrigin: recipe }, { deviceTransition: true, requestOrigin: primary, arbitrary: true }]) {
    await assert.rejects(createConfiguredServer({}, options), fail("REQUEST_ORIGIN_CONFIG"));
  }
  assert.equal(getters, 0);
  await assert.rejects(createConfiguredServer({ ...env, JESSIEMESSAGE_ENABLE_MEDIA: "0" }, { requestOrigin: primary, deviceTransition: true }), fail("REQUEST_ORIGIN_CONFIG"));
});

const command = value => [value, "--deployment", "primary-transition", "--profile", "photos-notify", "--private-directory", directory, "--private-path-mode", "linux-dirfd"];
const inspection = () => ({ valid: true, checks: DATABASE_CHECK_NAMES.map(name => ({ name, status: "pass" })),
  privilegeObservation: { profile: "infomaniak-shared-pattern", source: "show_grants_and_visible_schemata", ledgerWritable: true, tempTables: true,
    tableLocks: true, permanentDdl: false, databaseNamePattern: true, visibleApplicationNamespace: "selected_only", futureMatchingDatabasesUnproven: true } });

test("primary transition CLI performs the same SQL, schema and storage gates before requesting exactly one guarded runtime", async () => {
  const options = parseArguments(command("start")), events = [], source = await load(), before = structuredClone(source); let runtime;
  const dependencies = { inheritedEnv: { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" }, execArgv: [],
    loadEnvironment: async (path, parameters) => { assert.equal(path, directory); assert.deepEqual(parameters, { port: "3000", originProfile: "primary" }); events.push("config"); return source; },
    inspect: async () => { events.push("database"); return inspection(); }, checkSchema: async () => events.push("schema"),
    checkStorage: async () => events.push("storage"), startServer: async (env, parameters) => {
      assert.deepEqual(parameters, { requestOrigin: primary, deviceTransition: true }); runtime = env; events.push("start");
    } };
  const result = await run(options, dependencies);
  assert.deepEqual(events, ["config", "database", "schema", "storage", "start"]);
  assert.deepEqual(result, { status: "started", profile: "messaging-photos-notify", deployment: "primary-transition", started: true, smtpDeliveryTested: false, launchApproved: false });
  assert.deepEqual(source, before); assert.equal(runtime.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, ""); assert.equal(runtime.JESSIEMESSAGE_VAPID_PRIVATE_KEY, "");
  events.length = 0; await run(parseArguments(command("check")), dependencies); assert.deepEqual(events, ["config", "database", "schema", "storage"]);
  for (const step of ["inspect", "checkSchema", "checkStorage"]) {
    events.length = 0; await assert.rejects(run(options, { ...dependencies, [step]: async () => { throw new Error("synthetic failure"); } }));
    assert.equal(events.includes("start"), false);
  }
  events.length = 0;
  await assert.rejects(run(options, { ...dependencies, loadEnvironment: async () => load(recipe, {}) })); assert.deepEqual(events, []);
});

test("transition CLI is restricted to one explicit fixed deployment and the full photos-notify profile", () => {
  for (const args of [command("start").map(value => value === "primary-transition" ? "anything" : value),
    command("start").map(value => value === "photos-notify" ? "photos" : value), command("check").filter(value => !["--profile", "photos-notify"].includes(value)),
    [...command("start"), "--origin", primary], [...command("start"), "--keep-recipe"],
    ["start", "--profile", "photos-notify", "--deployment", "primary-transition", ...command("start").slice(5)]]) {
    assert.throws(() => parseArguments(args), fail("PRIVATE_MESSAGING_USAGE"));
  }
});

const recoveryOptions = { originProfile: "primary", recovery: true };
const recoveryCommand = value => command(value).map(value => value === "photos-notify" ? "photos-notify-recovery" : value);

test("offline recovery permission reuses the same five anchored files without activating or changing the environment", async () => {
  const source = bundle(), before = structuredClone(source); let reads = 0;
  const env = await loadRuntimeNotificationsEnvironment(directory, { ...recoveryOptions, port: "4321" }, {
    readBundle: async (path, options) => {
      reads++; assert.equal(path, directory); assert.deepEqual(options, { originProfile: "primary" }); return source;
    },
  });
  assert.equal(reads, 1); assert.deepEqual(source, before);
  assert.equal(env.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY, "0"); assert.equal(env.PORT, "4321");
  assert.deepEqual(copyRuntimeNotificationsEnvironment(env, recoveryOptions), env);
  const active = { ...env, JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "1" }, activeBefore = structuredClone(active);
  assert.deepEqual(copyRuntimeNotificationsEnvironment(active, recoveryOptions), activeBefore);
  assert.deepEqual(active, activeBefore); assert.deepEqual(Object.keys(active).sort(), Object.keys(env).sort());
  assert.throws(() => copyRuntimeNotificationsEnvironment(active, { originProfile: "primary" }));
  assert.throws(() => copyRuntimeNotificationsEnvironment(active, { originProfile: "primary", recovery: false }));
  assert.equal(active.JESSIEMESSAGE_MAIL_KEY, key(2));
  assert.equal(active.JESSIEMESSAGE_SMTP_HOST, env.JESSIEMESSAGE_SMTP_HOST);
});

test("recovery profile permission is primary-only, data-only, boolean and preserves every old feature boundary", async () => {
  const env = await load(); let getters = 0;
  const accessor = { originProfile: "primary" }; Object.defineProperty(accessor, "recovery", { get() { getters++; return true; } });
  for (const options of [{ recovery: true }, { originProfile: "preproduction", recovery: true },
    ...["1", 1, null, undefined, {}].map(recovery => ({ originProfile: "primary", recovery })), accessor,
    { ...recoveryOptions, extra: true }, { ...recoveryOptions, [Symbol("extra")]: true }, Object.create(recoveryOptions)]) {
    assert.throws(() => copyRuntimeNotificationsEnvironment(env, options));
    await assert.rejects(loadRuntimeNotificationsEnvironment(directory, options, { readBundle: () => assert.fail("Invalid permission cannot read files") }));
  }
  assert.equal(getters, 0);
  for (const override of [{ JESSIEMESSAGE_ENABLE_CRM: "1" }, { JESSIEMESSAGE_ENABLE_BROADCAST: "1" },
    { JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "true" }, { JESSIEMESSAGE_ENABLE_NOTIFICATIONS: "0" },
    { JESSIEMESSAGE_MAIL_KEY: env.JESSIEMESSAGE_MFA_KEY }]) {
    assert.throws(() => copyRuntimeNotificationsEnvironment({ ...env, ...override }, recoveryOptions));
  }
});

test("recovery preflight requires the explicit target, primary origin and precisely its enabled domains", async () => {
  const inactive = await load(), active = { ...inactive, JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "1" };
  const options = { expectedOrigin: primary, originProfile: "primary", target: "messaging-photos-notify-recovery" };
  const report = inspectPreproductionConfiguration(active, options);
  assert.equal(report.target, options.target); assert.equal(report.valid, true);
  assert.deepEqual(report.checks.map(row => row.name), PRIMARY_NOTIFICATIONS_RECOVERY_CONFIG_CHECK_NAMES);
  assert.equal(report.checks.find(row => row.name === "client_recovery").status, "pass");
  assert.equal(report.checks.find(row => row.name === "messaging_photos_notify_recovery").status, "pass");
  assert.equal(inspectPreproductionConfiguration(inactive, options).valid, false);
  assert.equal(inspectPreproductionConfiguration(active, { ...options, target: "messaging-photos-notify" }).valid, false);
  for (const override of [{ JESSIEMESSAGE_SITE_ORIGIN: recipe }, { JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "0" },
    { JESSIEMESSAGE_ENABLE_CRM: "1" }, { JESSIEMESSAGE_ENABLE_BROADCAST: "1" }, { JESSIEMESSAGE_ENABLE_MEDIA: "0" }]) {
    assert.equal(inspectPreproductionConfiguration({ ...active, ...override }, options).valid, false);
  }
  assert.equal(inspectPreproductionConfiguration(active, { ...options, originProfile: "preproduction" }).valid, false);
  assert.doesNotMatch(JSON.stringify(report), /synthetic|password|smtp|privateKey|base64|mailto/);
});

test("explicit recovery start alone activates the flag after loading and preserves all existing pre-listen gates", async () => {
  const source = await load(), before = structuredClone(source), events = []; let runtime;
  const dependencies = { inheritedEnv: { JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" }, execArgv: [],
    loadEnvironment: async (path, options) => { assert.equal(path, directory); assert.deepEqual(options, { port: "3000", ...recoveryOptions }); events.push("config"); return source; },
    inspect: async ({ env }) => { assert.equal(env.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY, "1"); events.push("database"); return inspection(); },
    checkSchema: async env => { assert.equal(env.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY, "1"); events.push("schema"); },
    checkStorage: async () => events.push("storage"),
    startServer: async (env, options) => {
      assert.deepEqual(options, { requestOrigin: primary, deviceTransition: true, recovery: true });
      assert.equal(env.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY, "1"); runtime = env; events.push("start");
    },
  };
  assert.deepEqual(await run(parseArguments(recoveryCommand("start")), dependencies), {
    status: "started", profile: "messaging-photos-notify-recovery", deployment: "primary-transition", started: true, smtpDeliveryTested: false, launchApproved: false,
  });
  assert.deepEqual(events, ["config", "database", "schema", "storage", "start"]);
  assert.deepEqual(source, before); assert.equal(runtime.JESSIEMESSAGE_MAIL_KEY, ""); assert.equal(runtime.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "");
  events.length = 0;
  assert.equal((await run(parseArguments(recoveryCommand("check")), dependencies)).started, false);
  assert.deepEqual(events, ["config", "database", "schema", "storage"]);
  for (const step of ["inspect", "checkSchema", "checkStorage"]) {
    events.length = 0;
    await assert.rejects(run(parseArguments(recoveryCommand("start")), { ...dependencies, [step]: async () => { throw new Error("synthetic failure"); } }));
    assert.equal(events.includes("start"), false);
  }
  events.length = 0;
  await assert.rejects(run(parseArguments(recoveryCommand("start")), { ...dependencies,
    inheritedEnv: { ...dependencies.inheritedEnv, JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "1" } }), fail("PRIVATE_MESSAGING_ENVIRONMENT"));
  assert.deepEqual(events, []);
});

test("recovery cannot be selected through an old deployment, an ambient flag or an unguarded server option", async () => {
  for (const args of [recoveryCommand("start").filter(value => !["--deployment", "primary-transition"].includes(value)),
    [...command("start"), "--recovery"], [...recoveryCommand("start"), "--recovery", "1"]]) assert.throws(() => parseArguments(args));
  const env = await load(), active = { ...env, JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "1" };
  await assert.rejects(createConfiguredServer(active, { requestOrigin: primary, deviceTransition: true }), fail("REQUEST_ORIGIN_CONFIG"));
  await assert.rejects(createConfiguredServer(env, { requestOrigin: primary, deviceTransition: true, recovery: true }), fail("REQUEST_ORIGIN_CONFIG"));
  for (const options of [{ recovery: true }, { requestOrigin: primary, recovery: true },
    { requestOrigin: recipe, deviceTransition: true, recovery: true }, { requestOrigin: primary, deviceTransition: true, recovery: "1" },
    { requestOrigin: primary, deviceTransition: true, recovery: undefined }]) {
    await assert.rejects(createConfiguredServer(active, options), fail("REQUEST_ORIGIN_CONFIG"));
  }
  let invoked = 0; const accessor = { requestOrigin: primary, deviceTransition: true };
  Object.defineProperty(accessor, "recovery", { get() { invoked++; return true; } });
  await assert.rejects(createConfiguredServer(active, accessor), fail("REQUEST_ORIGIN_CONFIG")); assert.equal(invoked, 0);
});

function request(port, host, path = "/api/auth/session", { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolveRequest, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, agent: false, headers: { Host: host, ...headers } }, response => {
      const chunks = []; response.on("data", chunk => chunks.push(chunk)); response.on("error", reject);
      response.on("end", () => resolveRequest({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    }); req.on("error", reject); req.end(body);
  });
}

test("two fixed authorities share one HTTP admission but their ordinary mutations remain strictly same-origin", async t => {
  const now = Date.now(), token = key(9), csrf = key(10), events = [];
  const session = { user: { id: "1".repeat(32), role: "admin", pseudonym: "Synthetic administrator" }, token, csrf, expiresAt: now + 3600000 };
  const service = { login: async () => session, session: async value => value === token ? session : null,
    logout: async () => { events.push("logout"); }, logoutAll: async () => {} };
  let entered = 0, completed = 0;
  const server = createAppServer({ requestOrigin: primary, authHandler: createAuthHandler(service, { origin: primary }),
    notificationsHandler: async () => false,
    legacyHandlers: { authHandler: createAuthHandler(service, { origin: recipe }), notificationsHandler: async () => false, entryHandler: createEntryHandler() },
    admission: { enter() { entered++; return () => { completed++; }; } }, operations: { publicStatus: () => ({ status: "ready" }) } });
  await new Promise(resolveRequest => server.listen(0, "127.0.0.1", resolveRequest));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolveRequest => server.close(resolveRequest)); });
  const port = server.address().port;
  for (const origin of [primary, recipe]) {
    const host = new URL(origin).host;
    const connected = await request(port, host, undefined, { headers: { Cookie: `__Host-jessie_session=${token}` } });
    assert.equal(connected.status, 200); assert.equal(JSON.parse(connected.body).user.id, session.user.id);
    assert.match(connected.headers["set-cookie"][0], /Secure; HttpOnly; SameSite=Strict/);
    const headers = { Cookie: `__Host-jessie_session=${token}`, Origin: origin, "Content-Type": "application/json", "X-CSRF-Token": csrf };
    assert.equal((await request(port, host, "/api/auth/logout", { method: "POST", headers, body: "{}" })).status, 200);
    assert.equal((await request(port, host, "/api/auth/logout", { method: "POST", headers: { ...headers, Origin: origin === primary ? recipe : primary }, body: "{}" })).status, 403);
    const sw = await request(port, host, "/sw.js"); assert.equal(sw.status, 200); assert.equal(sw.headers["service-worker-allowed"], "/");
    assert.equal((await request(port, host, "/api/ready")).status, 200);
  }
  assert.deepEqual(events, ["logout", "logout"]); assert.equal(entered, completed);
  const before = entered;
  for (const host of ["www.jessiemessage.com", "other.jessiemessage.com", "jessiemessage.com:8443", "recette.jessiemessage.com.evil.invalid"]) {
    const response = await request(port, host, undefined, { headers: { "X-Forwarded-Host": "jessiemessage.com", Forwarded: "host=jessiemessage.com;proto=https" } });
    assert.equal(response.status, 421); assert.equal(response.headers["set-cookie"], undefined);
  }
  assert.equal(entered, before); assert.equal((await request(port, "proxy.invalid", "/api/health")).status, 200);
});
