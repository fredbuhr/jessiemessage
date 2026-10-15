import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { DATABASE_CHECK_NAMES } from "../server/preflight/database.mjs";
import { run as provisionRuntime } from "../scripts/provision-runtime-stdin.mjs";
import { main, parseArguments, run } from "../scripts/promote-runtime-diagnostic.mjs";

const password = " Synthetic-only 'quoted' \\\" $() # é secret 42! ";
const options = { privateDirectory: "/private/runtime-fixture", privilegeProfile: "infomaniak-shared-pattern", privatePathMode: "linux-dirfd" };
const args = () => ["--private-directory", options.privateDirectory, "--privilege-profile", options.privilegeProfile,
  "--private-path-mode", options.privatePathMode];
const codeIs = (code) => (error) => error.code === code;
const diagnostic = () => ({ format: "jessiemessage-runtime-diagnostic", version: 1, createdAt: "2026-10-15T18:50:00.000Z",
  credentials: { format: "jessiemessage-runtime-database", version: 1, host: "sql.example.invalid", port: "3306",
    database: "jessiemessage_test", user: "fixture_runtime", password, privilegeProfile: "infomaniak-shared" } });
const observation = () => ({ profile: "infomaniak-shared-pattern", source: "show_grants_and_visible_schemata",
  ledgerWritable: true, tempTables: true, tableLocks: true, permanentDdl: false,
  databaseNamePattern: true, visibleApplicationNamespace: "selected_only", futureMatchingDatabasesUnproven: true });
const prepared = () => ({ status: "prepared", configSaved: true, authSchemaVerified: true,
  databaseChecks: DATABASE_CHECK_NAMES.map((name) => ({ name, status: "pass" })), privilegeObservation: observation() });

function fixture() {
  const observed = { events: [], source: diagnostic() };
  return { observed, dependencies: {
    readDiagnostic: async (directory) => {
      observed.events.push("read-diagnostic"); assert.equal(directory, options.privateDirectory); return observed.source;
    },
    provision: async (selected, secret) => {
      observed.events.push("provision"); observed.options = selected;
      assert.equal(secret, password); return prepared();
    },
  } };
}

test("promotion requires explicit pattern profile and normalized private metadata before reading any file", async () => {
  assert.deepEqual(parseArguments(args()), options);
  const malformed = [[], args().slice(0, -1), [...args(), "--password", password], [...args(), "--confirm-database", "other"],
    ["--private-directory", "/private", "--private-directory", "/private", "--private-path-mode", "linux-dirfd"]];
  for (const [name, value] of [["--privilege-profile", "strict"], ["--privilege-profile", "infomaniak-shared"],
    ["--privilege-profile", "unknown"], ["--private-path-mode", "strict"], ["--private-directory", "/"],
    ["--private-directory", "/private/../other"], ["--private-directory", "/private/"],
    ["--private-directory", "/private\nfixture"], ["--private-directory", "/private\\fixture"]]) {
    const selected = args(); selected[selected.indexOf(name) + 1] = value; malformed.push(selected);
  }
  for (const selected of malformed) {
    const f = fixture(); await assert.rejects(main(selected, f.dependencies), codeIs("RUNTIME_PROMOTION_USAGE"));
    assert.deepEqual(f.observed.events, []);
  }
  const f = fixture();
  await assert.rejects(run({ ...options, password }, f.dependencies), codeIs("RUNTIME_PROMOTION_USAGE"));
  assert.deepEqual(f.observed.events, []);
});

test("promotion clones its diagnostic credentials and confirms exactly that database through ordinary provisioning", async () => {
  const f = fixture(), output = [], before = structuredClone(f.observed.source);
  Object.freeze(f.observed.source.credentials); Object.freeze(f.observed.source);
  const result = await main(args(), { ...f.dependencies, outputStream: { write: (value) => output.push(value) } });
  assert.deepEqual(f.observed.events, ["read-diagnostic", "provision"]);
  assert.deepEqual(f.observed.options, { host: before.credentials.host, port: before.credentials.port,
    database: before.credentials.database, confirmation: before.credentials.database, user: before.credentials.user, ...options });
  assert.deepEqual(f.observed.source, before);
  assert.equal(result.status, "prepared"); assert.equal(result.configSaved, true); assert.equal(result.launchApproved, false);
  assert.equal(result.authSchemaVerified, true); assert.equal(result.databaseChecks.length, 9);
  assert.deepEqual(result.privilegeObservation, observation());
  for (const value of [password, before.credentials.host, before.credentials.database, before.credentials.user, options.privateDirectory]) {
    assert.equal(output.join("").includes(value), false);
  }
});

test("promotion does not infer a fallback profile from the saved record", async () => {
  for (const sourceProfile of ["strict", "infomaniak-shared", "infomaniak-shared-pattern"]) {
    const f = fixture(); f.observed.source.credentials.privilegeProfile = sourceProfile;
    await run(options, f.dependencies);
    assert.equal(f.observed.options.privilegeProfile, "infomaniak-shared-pattern");
    assert.equal(f.observed.source.credentials.privilegeProfile, sourceProfile);
  }
});

test("unreadable, malformed and mismatched diagnostic envelopes cannot reach provisioning", async () => {
  for (const kind of ["read", "normal", "extra", "timestamp", "missing", "password", "database", "profile", "getter"]) {
    const f = fixture(); let getterCalled = false;
    if (kind === "read") f.dependencies.readDiagnostic = async () => { throw new Error(password); };
    if (kind === "normal") f.observed.source = f.observed.source.credentials;
    if (kind === "extra") f.observed.source.active = true;
    if (kind === "timestamp") f.observed.source.createdAt = "yesterday";
    if (kind === "missing") delete f.observed.source.credentials;
    if (kind === "password") f.observed.source.credentials.password = "";
    if (kind === "database") f.observed.source.credentials.database = "invalid`database";
    if (kind === "profile") f.observed.source.credentials.privilegeProfile = "automatic";
    if (kind === "getter") Object.defineProperty(f.observed.source, "credentials", { get() { getterCalled = true; throw new Error(password); } });
    await assert.rejects(run(options, f.dependencies), (error) => {
      assert.equal(error.code, "RUNTIME_PROMOTION_DIAGNOSTIC"); assert.equal(JSON.stringify(error).includes(password), false); return true;
    });
    assert.equal(f.observed.events.includes("provision"), false); assert.equal(getterCalled, false);
  }
});

test("native provisioning errors are replaced without copying checks, metadata, secrets or native properties", async () => {
  const f = fixture(), before = structuredClone(f.observed.source), output = [];
  f.dependencies.provision = async () => { throw Object.assign(new Error(password), { code: password, databaseChecks: [{ raw: password }] }); };
  await assert.rejects(main(args(), { ...f.dependencies, outputStream: { write: (value) => output.push(value) } }), (error) => {
    assert.equal(error.code, "RUNTIME_PROMOTION_PROVISION"); assert.equal(error.message, "RUNTIME_PROMOTION_PROVISION");
    assert.equal(JSON.stringify(error).includes(password), false); assert.equal(Object.hasOwn(error, "databaseChecks"), false); return true;
  });
  assert.deepEqual(output, []); assert.deepEqual(f.observed.source, before);
});

test("unconfirmed persistence, physical schema and malformed report results cannot claim promotion success", async () => {
  for (const kind of ["null", "status", "saved", "schema", "missing", "failed", "profile", "observation", "getter"]) {
    const f = fixture(); let getterCalled = false;
    f.dependencies.provision = async () => {
      const result = prepared();
      if (kind === "null") return null;
      if (kind === "status") result.status = "diagnostic_only";
      if (kind === "saved") result.configSaved = false;
      if (kind === "schema") result.authSchemaVerified = false;
      if (kind === "missing") result.databaseChecks.pop();
      if (kind === "failed") result.databaseChecks[5].status = "fail";
      if (kind === "profile") result.privilegeObservation.profile = "infomaniak-shared";
      if (kind === "observation") result.privilegeObservation.futureMatchingDatabasesUnproven = false;
      if (kind === "getter") Object.defineProperty(result, "status", { get() { getterCalled = true; throw new Error(password); } });
      return result;
    };
    await assert.rejects(run(options, f.dependencies), codeIs("RUNTIME_PROMOTION_PROVISION"));
    assert.equal(getterCalled, false);
  }
});

test("promotion rebuilds a closed public DTO and always reports launchApproved false", async () => {
  const f = fixture(); f.dependencies.provision = async () => ({ ...prepared(), password, metadata: f.observed.source,
    launchApproved: true, privilegeObservation: { ...observation(), native: password } });
  const result = await run(options, f.dependencies);
  assert.deepEqual(Object.keys(result).sort(), ["authSchemaVerified", "configSaved", "databaseChecks", "launchApproved", "privilegeObservation", "status"]);
  assert.equal(result.launchApproved, false); assert.equal(JSON.stringify(result).includes(password), false);
  assert.deepEqual(result.privilegeObservation, observation());
});

function normalProvisionFixture() {
  const f = fixture(); f.observed.envs = [];
  const connection = { query: async () => { f.observed.events.push("physical-query"); return []; },
    release: async () => { f.observed.events.push("release"); } };
  const pool = { getConnection: async () => connection, end: async () => { f.observed.events.push("end"); } };
  const dependencies = {
    inspect: async ({ env, databaseName }) => {
      f.observed.events.push("inspect"); f.observed.envs.push(env);
      assert.equal(databaseName, f.observed.source.credentials.database);
      assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, password);
      return { valid: true, checks: prepared().databaseChecks, privilegeObservation: observation() };
    },
    createPool: async (env) => { f.observed.events.push("pool"); f.observed.envs.push(env); return pool; },
    createStore: (selectedPool) => ({ assertSchema: async () => {
      f.observed.events.push("physical-schema"); const selected = await selectedPool.getConnection();
      await selected.query("physical-schema-fixture"); selected.release(); return true;
    } }),
    writeConfiguration: async (directory, credentials) => {
      f.observed.events.push("write-normal"); assert.equal(directory, options.privateDirectory);
      f.observed.written = credentials; f.observed.saved = structuredClone(credentials); return { saved: true };
    },
    readConfiguration: async () => { f.observed.events.push("read-normal"); return structuredClone(f.observed.saved); },
  };
  f.dependencies.provision = (selected, secret) => provisionRuntime(selected, secret, dependencies);
  return { ...f, normal: dependencies, connection, pool };
}

test("promotion preserves normal TLS, physical-schema, drained cleanup and durable readback ordering with every flag disabled", async () => {
  const f = normalProvisionFixture(), before = structuredClone(f.observed.source);
  const result = await run(options, f.dependencies);
  assert.deepEqual(f.observed.events, ["read-diagnostic", "inspect", "pool", "physical-schema", "physical-query", "release", "end", "write-normal", "read-normal"]);
  assert.equal(result.configSaved, true); assert.equal(result.launchApproved, false);
  assert.equal(f.observed.saved.format, "jessiemessage-runtime-database");
  assert.equal(f.observed.saved.privilegeProfile, options.privilegeProfile);
  assert.equal(f.observed.written.password, ""); assert.deepEqual(f.observed.source, before);
  for (const env of f.observed.envs) {
    assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "");
    for (const name of ["AUTH", "ACCESS", "CHAT", "MEDIA", "CRM", "CLIENT_RECOVERY", "BROADCAST", "MAIL_DELIVERY"]) {
      assert.equal(env[`JESSIEMESSAGE_ENABLE_${name}`], "0");
    }
    assert.equal(Object.hasOwn(env, "JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL"), false);
    assert.equal(Object.hasOwn(env, "JESSIEMESSAGE_DB_TLS_CA_PATH"), false);
  }
});

test("normal preflight, schema, release, pool-close and readback failures remain blocked without deleting or altering diagnostic source", async () => {
  for (const kind of ["preflight", "schema", "release", "end", "readback"]) {
    const f = normalProvisionFixture(), before = structuredClone(f.observed.source);
    if (kind === "preflight") f.normal.inspect = async () => ({ valid: false,
      checks: prepared().databaseChecks.map((check) => check.name === "identity" ? { name: check.name, status: "fail" } : check),
      privilegeObservation: observation() });
    if (kind === "schema") f.normal.createStore = () => ({ assertSchema: async () => false });
    if (kind === "release") f.connection.release = () => Promise.reject(new Error(password));
    if (kind === "end") f.pool.end = async () => { throw new Error(password); };
    if (kind === "readback") f.normal.readConfiguration = async () => ({ ...f.observed.saved, user: "different_fixture" });
    await assert.rejects(run(options, f.dependencies), codeIs("RUNTIME_PROMOTION_PROVISION"));
    if (kind !== "readback") assert.equal(f.observed.events.includes("write-normal"), false);
    if (f.observed.written) assert.equal(f.observed.written.password, "");
    assert.deepEqual(f.observed.source, before);
    for (const env of f.observed.envs) assert.equal(env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD, "");
  }
});

test("promotion awaits ordinary provisioning completion before emitting confirmation", async () => {
  const f = fixture(), output = []; let finish;
  f.dependencies.provision = () => new Promise((resolve) => { finish = resolve; });
  const pending = main(args(), { ...f.dependencies, outputStream: { write: (value) => output.push(value) } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof finish, "function"); assert.deepEqual(output, []);
  finish(prepared()); await pending; assert.equal(output.length, 1);
});

test("promotion CLI accepts no password, host override or implicit profile and emits only a fixed blocked DTO", () => {
  for (const selected of [[...args(), "--password", password], [...args(), "--host", "secret.invalid"], []]) {
    const result = spawnSync(process.execPath, ["scripts/promote-runtime-diagnostic.mjs", ...selected],
      { input: password, encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 1); assert.match(result.stderr, /^RUNTIME_PROMOTION_USAGE:/);
    assert.deepEqual(JSON.parse(result.stdout), { status: "blocked", configSaved: null, launchApproved: false, error: "RUNTIME_PROMOTION_USAGE" });
    assert.equal(`${result.stdout}${result.stderr}`.includes(password), false);
    assert.equal(`${result.stdout}${result.stderr}`.includes(options.privateDirectory), false);
  }
});
