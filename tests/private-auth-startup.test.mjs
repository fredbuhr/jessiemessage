import test from "node:test";
import assert from "node:assert/strict";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { runtimeDatabaseEnvironment } from "../server/config/runtime-database-file.mjs";
import { main, parseArguments, run } from "../scripts/start-private-auth.mjs";
import { DATABASE_CHECK_NAMES } from "../server/preflight/database.mjs";

const inherited = () => ({ JESSIEMESSAGE_PRIVATE_PATH_MODE: "linux-dirfd" });
const options = { privateDirectory: "/private/operator-root", privatePathMode: "linux-dirfd" };
const config = { format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306",
  database: "test_recipe", user: "runtime_only", password: "synthetic-private-password", privilegeProfile: "infomaniak-shared-pattern" };
const environment = () => ({ ...runtimeDatabaseEnvironment(config), PORT: "3000", JESSIEMESSAGE_ENABLE_AUTH: "1",
  JESSIEMESSAGE_SITE_ORIGIN: "https://recette.jessiemessage.com", JESSIEMESSAGE_MFA_KEY: Buffer.alloc(32, 17).toString("base64url") });
const code = (expected) => (error) => error.code === expected && error.cause === undefined
  && !error.message.includes("synthetic-private");
const inspection = () => ({ valid: true, checks: DATABASE_CHECK_NAMES.map((name) => ({ name, status: "pass" })),
  privilegeObservation: { profile: "infomaniak-shared-pattern", source: "show_grants_and_visible_schemata",
    ledgerWritable: true, tempTables: true, tableLocks: true, permanentDdl: false, databaseNamePattern: true,
    visibleApplicationNamespace: "selected_only", futureMatchingDatabasesUnproven: true } });

test("private process options use only a canonical port and explicitly selected anchored path mode", () => {
  assert.deepEqual(privateAuthenticationProcessOptions({ ...inherited(), PATH: "/synthetic/bin", unrelated: "ignored" }, []), { port: "3000" });
  assert.deepEqual(privateAuthenticationProcessOptions({ ...inherited(), PORT: "4321" }, []), { port: "4321" });
  for (const port of ["0", "03000", "3000 ", "65536", 3000, "synthetic-private-value"]) {
    assert.throws(() => privateAuthenticationProcessOptions({ ...inherited(), PORT: port }, []), code("PRIVATE_AUTH_ENVIRONMENT"));
  }
  for (const env of [{}, { JESSIEMESSAGE_PRIVATE_PATH_MODE: "strict" }, { ...inherited(), JESSIEMESSAGE_ENABLE_AUTH: "0" },
    { ...inherited(), JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic-private-value" }]) {
    assert.throws(() => privateAuthenticationProcessOptions(env, []), code("PRIVATE_AUTH_ENVIRONMENT"));
  }
});

test("private startup rejects ambient trust overrides and execution flags without evaluating accessors", () => {
  for (const name of ["NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "NODE_USE_SYSTEM_CA",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "OPENSSL_CONF"]) {
    assert.throws(() => privateAuthenticationProcessOptions({ ...inherited(), [name]: "" }, []), code("PRIVATE_AUTH_ENVIRONMENT"));
  }
  assert.throws(() => privateAuthenticationProcessOptions(inherited(), ["--require=synthetic-private-value"]), code("PRIVATE_AUTH_ENVIRONMENT"));
  let invoked = 0;
  const source = inherited(); Object.defineProperty(source, "PORT", { get() { invoked++; return "3000"; } });
  assert.throws(() => privateAuthenticationProcessOptions(source, []), code("PRIVATE_AUTH_ENVIRONMENT"));
  assert.equal(invoked, 0);
});

test("private startup validates its fixed path arguments before private file access", async () => {
  for (const args of [[], ["--password", "synthetic-private-value"], ["--private-directory", "/private/root", "--private-path-mode", "strict"],
    ["--private-directory", "/private/../root", "--private-path-mode", "linux-dirfd"],
    ["--private-directory", "/private/root", "--private-directory", "/other/root"]]) {
    await assert.rejects(main(args, { loadEnvironment: () => assert.fail("No file access allowed") }), code("PRIVATE_AUTH_USAGE"));
  }
  assert.deepEqual(parseArguments(["--private-directory", options.privateDirectory, "--private-path-mode", "linux-dirfd"]), options);
});

test("private startup never falls back to ambient credentials or a neutral listener after file/configuration failure", async () => {
  let loaded = 0, started = 0;
  const dependencies = { inheritedEnv: inherited(), execArgv: [],
    loadEnvironment: async () => { loaded++; throw new Error("synthetic-private-value"); },
    startServer: async () => { started++; } };
  await assert.rejects(run(options, { ...dependencies, inheritedEnv: { ...inherited(), NODE_OPTIONS: "" } }), code("PRIVATE_AUTH_ENVIRONMENT"));
  assert.equal(loaded, 0);
  await assert.rejects(run(options, dependencies), code("PRIVATE_AUTH_CONFIGURATION"));
  for (const transform of [(env) => { env.JESSIEMESSAGE_ENABLE_AUTH = "0"; }, (env) => { env.JESSIEMESSAGE_ENABLE_CHAT = "1"; },
    (env) => { env.JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL = "1"; }, (env) => { env.JESSIEMESSAGE_SITE_ORIGIN = "https://jessiemessage.com"; }]) {
    const env = environment(); transform(env);
    await assert.rejects(run(options, { ...dependencies, loadEnvironment: async () => env }), code("PRIVATE_AUTH_CONFIGURATION"));
  }
  assert.equal(started, 0);
});

test("private startup forwards only the validated owned environment with the exact request-origin guard", async () => {
  const source = Object.freeze({ ...environment(), PORT: "4321" }); let captured;
  const result = await run(options, { inheritedEnv: { ...inherited(), PORT: "4321", PATH: "/synthetic/bin" }, execArgv: [],
    loadEnvironment: async (directory, selected) => {
      assert.equal(directory, options.privateDirectory); assert.deepEqual(selected, { port: "4321" }); return source;
    }, inspect: async () => inspection(), startServer: async (env, selected) => {
      assert.notEqual(env, source); assert.equal(env.PATH, undefined);
      assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, config.password);
      assert.equal(env.JESSIEMESSAGE_ENABLE_AUTH, "1");
      assert.deepEqual(selected, { requestOrigin: source.JESSIEMESSAGE_SITE_ORIGIN }); captured = env;
    } });
  assert.deepEqual(result, { started: true, authOnly: true });
  assert.equal(source.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, config.password);
  assert.equal(captured.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, ""); assert.equal(captured.JESSIEMESSAGE_MFA_KEY, "");
});

test("private startup waits for the actual listener and sanitizes failures before clearing owned secrets", async () => {
  let resolve, settled = false, captured;
  const pending = new Promise((yes) => { resolve = yes; });
  const started = run(options, { inheritedEnv: inherited(), execArgv: [], loadEnvironment: async () => environment(),
    inspect: async () => inspection(),
    startServer: async (env) => { captured = env; await pending; throw new Error("synthetic-private-value"); } });
  started.catch(() => { settled = true; }); await new Promise((yes) => setImmediate(yes));
  assert.equal(settled, false); assert.equal(captured.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, config.password);
  resolve(); await assert.rejects(started, code("PRIVATE_AUTH_STARTUP"));
  assert.equal(captured.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, ""); assert.equal(captured.JESSIEMESSAGE_MFA_KEY, "");
});

test("a stale or rejected SQL proof blocks a listener and waits for the actual inspector cleanup", async () => {
  for (const name of ["transport", "privileges", "history", "cleanup"]) {
    let started = false;
    await assert.rejects(run(options, { inheritedEnv: inherited(), execArgv: [], loadEnvironment: async () => environment(),
      inspect: async () => {
        const result = inspection(); result.valid = false;
        result.checks.find((check) => check.name === name).status = "fail";
        if (name === "privileges") result.privilegeObservation = { profile: "infomaniak-shared-pattern", source: "unverified",
          ledgerWritable: null, tempTables: null, tableLocks: null, permanentDdl: null,
          databaseNamePattern: null, visibleApplicationNamespace: null, futureMatchingDatabasesUnproven: null };
        return result;
      }, startServer: async () => { started = true; } }), code("PRIVATE_AUTH_CONFIGURATION"));
    assert.equal(started, false);
  }
});
