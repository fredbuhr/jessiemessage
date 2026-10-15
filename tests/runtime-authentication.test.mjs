import test from "node:test";
import assert from "node:assert/strict";
import { loadRuntimeAuthenticationEnvironment } from "../server/config/runtime-authentication.mjs";
import { runtimeDatabaseOptions } from "../server/db/runtime.mjs";
import { inspectPreproductionConfiguration } from "../server/preflight/config.mjs";

const directory = "/private/runtime-fixture";
const password = "synthetic-only database fixture 'quoted' $()";
const mfaKey = Buffer.alloc(32, 19).toString("base64url");
const bundle = () => ({ database: { format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306",
  database: "jessiemessage_test", user: "fixture_runtime", password, privilegeProfile: "infomaniak-shared-pattern" },
authentication: { format: "jessiemessage-runtime-auth", version: 1, origin: "https://recette.jessiemessage.com", mfaKey } });
const codeIs = (error) => error.code === "RUNTIME_AUTH_ENVIRONMENT";

test("auth environment reads one complete bundle and enables authentication alone with strict database TLS", async () => {
  const source = bundle(), before = structuredClone(source); let reads = 0;
  Object.freeze(source.database); Object.freeze(source.authentication); Object.freeze(source);
  const env = await loadRuntimeAuthenticationEnvironment(directory, {}, { readBundle: async (selected) => {
    reads++; assert.equal(selected, directory); return source;
  } });
  assert.equal(reads, 1); assert.equal(env.PORT, "3000");
  assert.equal(env.JESSIEMESSAGE_ENABLE_AUTH, "1");
  for (const name of ["ACCESS", "CHAT", "MEDIA", "CRM", "CLIENT_RECOVERY", "BROADCAST", "MAIL_DELIVERY"]) {
    assert.equal(env[`JESSIEMESSAGE_ENABLE_${name}`], "0");
  }
  assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, password); assert.equal(env.JESSIEMESSAGE_MFA_KEY, mfaKey);
  assert.equal(env.JESSIEMESSAGE_SITE_ORIGIN, source.authentication.origin);
  assert.equal(env.JESSIEMESSAGE_APPLICATION_DATABASE, source.database.database);
  assert.equal(env.JESSIEMESSAGE_PRIVATE_PATH_MODE, "linux-dirfd");
  const options = runtimeDatabaseOptions(env);
  assert.deepEqual(options.ssl, { rejectUnauthorized: true, minVersion: "TLSv1.2" });
  assert.equal(options.multipleStatements, false); assert.equal(options.logParam, false); assert.equal(options.trace, false);
  const report = inspectPreproductionConfiguration(env, { expectedOrigin: source.authentication.origin, target: "auth-only" });
  assert.equal(report.valid, true); assert.ok(report.checks.every((check) => ["pass", "disabled"].includes(check.status)));
  assert.deepEqual(source, before);
  env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD = ""; env.JESSIEMESSAGE_MFA_KEY = "";
});

test("auth environment accepts only a canonical string port and rejects unknown options before private reads", async () => {
  let reads = 0; const dependencies = { readBundle: async () => { reads++; return bundle(); } };
  for (const port of ["1", "3000", "65535"]) {
    const env = await loadRuntimeAuthenticationEnvironment(directory, { port }, dependencies); assert.equal(env.PORT, port);
  }
  const before = reads;
  for (const options of [{ port: 3000 }, { port: "0" }, { port: "03000" }, { port: "65536" }, { port: " 3000" },
    { port: null }, { port: false }, { port: "3000\n" }, { enableChat: true }, null, []]) {
    await assert.rejects(loadRuntimeAuthenticationEnvironment(directory, options, dependencies), codeIs);
  }
  assert.equal(reads, before);
});

test("invalid directory, unknown dependencies and accessor options are refused without invoking caller code", async () => {
  let reads = 0, getters = 0; const dependencies = { readBundle: async () => { reads++; return bundle(); } };
  for (const selected of [undefined, "/", "relative", "/private/../other", "/private/", "/private\nfixture", "/private\\fixture"]) {
    await assert.rejects(loadRuntimeAuthenticationEnvironment(selected, {}, dependencies), codeIs);
  }
  await assert.rejects(loadRuntimeAuthenticationEnvironment(directory, {}, { ...dependencies, env: { password } }), codeIs);
  await assert.rejects(loadRuntimeAuthenticationEnvironment(directory, {}, { readBundle: null }), codeIs);
  const options = {}; Object.defineProperty(options, "port", { get() { getters++; return "3000"; } });
  const injected = {}; Object.defineProperty(injected, "readBundle", { get() { getters++; return dependencies.readBundle; } });
  await assert.rejects(loadRuntimeAuthenticationEnvironment(directory, options, dependencies), codeIs);
  await assert.rejects(loadRuntimeAuthenticationEnvironment(directory, {}, injected), codeIs);
  assert.equal(reads, 0); assert.equal(getters, 0);
});

test("inherited environment credentials, activation flags, arbitrary secrets and TLS bypasses are never merged", async () => {
  const inherited = { PORT: "not-a-port", JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1", JESSIEMESSAGE_DB_TLS_CA_PATH: "/fixture/ca",
    JESSIEMESSAGE_DB_USER: "migration_fixture", JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "inherited-secret",
    JESSIEMESSAGE_ENABLE_CHAT: "1", JESSIEMESSAGE_ENABLE_MEDIA: "1", JESSIEMESSAGE_MFA_KEY: "inherited-key",
    JESSIEMESSAGE_MESSAGE_KEY: "inherited-message-key", JESSIEMESSAGE_ENABLE_UNKNOWN: "1" };
  const previous = Object.fromEntries(Object.keys(inherited).map((name) => [name, process.env[name]])); Object.assign(process.env, inherited);
  try {
    const env = await loadRuntimeAuthenticationEnvironment(directory, {}, { readBundle: async () => bundle() });
    assert.equal(env.PORT, "3000"); assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, password);
    assert.equal(env.JESSIEMESSAGE_MFA_KEY, mfaKey); assert.equal(env.JESSIEMESSAGE_ENABLE_CHAT, "0");
    for (const name of ["JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL", "JESSIEMESSAGE_DB_TLS_CA_PATH", "JESSIEMESSAGE_DB_USER",
      "JESSIEMESSAGE_MESSAGE_KEY", "JESSIEMESSAGE_ENABLE_UNKNOWN"]) assert.equal(Object.hasOwn(env, name), false);
  } finally {
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  }
});

test("malformed bundles and secret accessors fail closed without mutation or a diagnostic credential fallback", async () => {
  for (const kind of ["missing-database", "missing-auth", "diagnostic", "extra", "key", "password", "origin", "getter-database", "getter-key", "symbol"]) {
    const source = bundle(); let getters = 0;
    if (kind === "missing-database") delete source.database;
    if (kind === "missing-auth") delete source.authentication;
    if (kind === "diagnostic") source.database = { format: "jessiemessage-runtime-diagnostic", version: 1, credentials: source.database };
    if (kind === "extra") source.diagnostic = { password };
    if (kind === "key") source.authentication.mfaKey = "invalid";
    if (kind === "password") source.database.password = "";
    if (kind === "origin") source.authentication.origin = "https://jessiemessage.com";
    if (kind === "getter-database") Object.defineProperty(source, "database", { get() { getters++; throw new Error(password); } });
    if (kind === "getter-key") Object.defineProperty(source.authentication, "mfaKey", { get() { getters++; throw new Error(mfaKey); } });
    if (kind === "symbol") source[Symbol("hidden")] = password;
    await assert.rejects(loadRuntimeAuthenticationEnvironment(directory, {}, { readBundle: async () => source }), (error) => {
      assert.equal(error.code, "RUNTIME_AUTH_ENVIRONMENT"); assert.equal(JSON.stringify(error).includes(password), false);
      assert.equal(JSON.stringify(error).includes(mfaKey), false); return true;
    });
    assert.equal(getters, 0);
    if (source.authentication && kind !== "getter-key") assert.equal(source.authentication.mfaKey, kind === "key" ? "invalid" : mfaKey);
  }
});

test("bundle reader errors expose only the fixed environment code", async () => {
  await assert.rejects(loadRuntimeAuthenticationEnvironment(directory, {}, { readBundle: async () => {
    throw Object.assign(new Error(password), { code: mfaKey, path: directory });
  } }), (error) => {
    assert.equal(error.code, "RUNTIME_AUTH_ENVIRONMENT"); assert.equal(error.message, "Private authentication environment is unavailable.");
    assert.equal(JSON.stringify(error).includes(password), false); assert.equal(Object.hasOwn(error, "path"), false); return true;
  });
});
