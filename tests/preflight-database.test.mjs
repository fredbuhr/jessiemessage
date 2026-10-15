import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadMigrations } from "../server/db/migrations.mjs";
import { DATABASE_CHECK_NAMES, inspectDatabase } from "../server/preflight/database.mjs";

const plan = await loadMigrations();
const appTables = plan.map(({ sql }) => /^CREATE TABLE ([a-z_]+)/.exec(sql)[1]);
const env = {
  JESSIEMESSAGE_DB_NAME: "jessiemessage_test_ci", JESSIEMESSAGE_APPLICATION_DATABASE: "jessiemessage_test_ci",
  JESSIEMESSAGE_DB_HOST: "database.example.invalid", JESSIEMESSAGE_DB_USER: "migration_identity",
  JESSIEMESSAGE_RUNTIME_DB_USER: "runtime_identity", JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic-private-password",
};
const grants = (scope = "`jessiemessage_test_ci`.*", privileges = "SELECT, INSERT, UPDATE, DELETE") => ({
  "Grants for private-account@private-host": `GRANT ${privileges} ON ${scope} TO 'private-account'@'private-host'`,
});
const usage = { grant: "GRANT USAGE ON *.* TO 'private-account'@'private-host' IDENTIFIED BY PASSWORD '*PRIVATEHASH'" };
const completeGrants = () => [usage,
  grants("`jessiemessage_test_ci`.`schema_migrations`", "SELECT"),
  ...appTables.map((table) => grants(`\`jessiemessage_test_ci\`.\`${table}\``)),
];
const history = () => plan.map(({ version, name, checksum }) => ({ version, name, checksum, state: "applied", attempts: 1 }));
const statuses = (result) => Object.fromEntries(result.checks.map(({ name, status }) => [name, status]));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function fixture({ selected, cipher, grantRows, rows, query, release, end, rollback, getConnection, createPool, loadPlan } = {}) {
  const calls = [];
  const connection = {
    async query(command) {
      const sql = typeof command === "string" ? command : command.sql;
      calls.push({ sql, ...(typeof command === "object" ? { timeout: command.timeout } : {}) });
      const overridden = await query?.(sql, command);
      if (overridden !== undefined) return overridden;
      if (sql.startsWith("SELECT DATABASE()")) return selected ?? [{ database_name: env.JESSIEMESSAGE_DB_NAME, server_version: "10.11.14-MariaDB-private-build" }];
      if (sql.startsWith("SHOW SESSION")) return cipher ?? [{ Variable_name: "Ssl_cipher", Value: "TLS_AES_256_GCM_SHA384" }];
      if (sql === "SHOW GRANTS FOR CURRENT_USER") return grantRows ?? completeGrants();
      if (sql.startsWith("SELECT version")) return rows ?? history();
      return [];
    },
    async rollback() { calls.push({ action: "rollback" }); await rollback?.(); },
    async release() { calls.push({ action: "release" }); await release?.(); },
  };
  const pool = {
    async getConnection() { calls.push({ action: "getConnection" }); return getConnection ? getConnection() : connection; },
    async end() { calls.push({ action: "end" }); await end?.(); },
  };
  return {
    calls,
    dependencies: {
      async createPool(received) { calls.push({ action: "createPool" }); assert.equal(received, env); return createPool ? createPool() : pool; },
      loadPlan: loadPlan ?? (async () => plan),
    },
  };
}

function safeDto(result) {
  assert.deepEqual(Object.keys(result), ["valid", "checks"]);
  assert.equal(typeof result.valid, "boolean");
  assert.deepEqual(result.checks.map(({ name }) => name), DATABASE_CHECK_NAMES);
  assert.ok(result.checks.every((check) => Object.keys(check).join() === "name,status" && ["pass", "fail", "not_checked"].includes(check.status)));
  assert.doesNotMatch(JSON.stringify(result), /private|password|MariaDB|SELECT|host|account|hash|error|cause|database\.example/i);
}

test("SQL preflight drains one read-only snapshot and returns only fixed checks", async () => {
  const setup = fixture();
  const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
  assert.equal(result.valid, true); safeDto(result);
  assert.ok(result.checks.every(({ status }) => status === "pass"));
  for (const action of ["createPool", "getConnection", "rollback", "release", "end"]) assert.equal(setup.calls.filter((call) => call.action === action).length, 1);
  const statements = setup.calls.filter(({ sql }) => sql);
  assert.equal(statements.filter(({ sql }) => /WHERE 1 = 0$/.test(sql)).length, 27);
  assert.ok(statements.filter(({ sql }) => /^SELECT version|WHERE 1 = 0$/.test(sql)).every(({ timeout }) => timeout === 2000));
  assert.ok(statements.some(({ sql }) => sql === "START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT"));
  assert.ok(statements.some(({ sql }) => sql.endsWith("ORDER BY version LIMIT 28")));
  assert.doesNotMatch(statements.map(({ sql }) => sql).join("\n"), /GET_LOCK|RELEASE_LOCK|autocommit|foreign_key_checks|(?:^|\n)(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE)\b/);
  assert.deepEqual(setup.calls.slice(-3), [{ action: "rollback" }, { action: "release" }, { action: "end" }]);
});

test("exact operator confirmation and runtime configuration are required before any pool or source access", async () => {
  for (const [givenEnv, databaseName] of [[{}, undefined], [env, undefined], [env, "another_database"], [{ ...env, JESSIEMESSAGE_APPLICATION_DATABASE: "another_database" }, env.JESSIEMESSAGE_DB_NAME]]) {
    let calls = 0;
    const result = await inspectDatabase({ env: givenEnv, databaseName }, {
      createPool() { calls++; throw new Error("private credentials"); }, loadPlan() { calls++; throw new Error("private path"); },
    });
    assert.equal(calls, 0); assert.equal(statuses(result).config, "fail");
    assert.ok(result.checks.slice(1).every(({ status }) => status === "not_checked")); safeDto(result);
  }
});

test("TLS CA precheck rejects missing, oversized and non-regular files before creating a pool", async () => {
  const directory = await mkdtemp(path.join(fileURLToPath(new URL("../", import.meta.url)), ".preflight-ca-test-"));
  try {
    const large = path.join(directory, "large.pem"), folder = path.join(directory, "folder"), missing = path.join(directory, "missing.pem");
    await writeFile(large, Buffer.alloc(1048577)); await mkdir(folder);
    for (const ca of [large, folder, missing]) {
      let calls = 0;
      const result = await inspectDatabase({ env: { ...env, JESSIEMESSAGE_DB_TLS_CA_PATH: ca }, databaseName: env.JESSIEMESSAGE_DB_NAME }, {
        createPool() { calls++; },
      });
      assert.equal(calls, 0); assert.equal(statuses(result).config, "fail"); safeDto(result);
    }
    const certificate = path.join(directory, "ca.pem"), link = path.join(directory, "ca-link.pem");
    await writeFile(certificate, "synthetic-public-certificate"); await symlink(certificate, link);
    const setup = fixture();
    const result = await inspectDatabase({ env: { ...env, JESSIEMESSAGE_DB_TLS_CA_PATH: link }, databaseName: env.JESSIEMESSAGE_DB_NAME }, {
      ...setup.dependencies, createPool: () => setup.dependencies.createPool(env),
    });
    assert.equal(result.valid, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("acquisition and initialization failures are sanitized and an initialized pool is always closed", async () => {
  const setup = fixture({ getConnection() { throw new Error("private database host/account/password"); } });
  const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
  assert.equal(statuses(result).connection, "fail"); assert.equal(statuses(result).cleanup, "pass");
  assert.equal(setup.calls.at(-1).action, "end"); safeDto(result);
  const failed = fixture({ createPool() { throw new Error("private certificate path"); } });
  const noPool = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, failed.dependencies);
  assert.equal(statuses(noPool).connection, "fail"); assert.equal(statuses(noPool).cleanup, "not_checked"); safeDto(noPool);
});

test("a mismatched selected database stops every subsequent database inspection", async () => {
  const setup = fixture({ selected: [{ database_name: "private_unconfirmed_database", server_version: "10.11.14-MariaDB" }] });
  const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
  assert.equal(statuses(result).identity, "fail"); assert.equal(statuses(result).engine, "not_checked");
  assert.equal(setup.calls.filter(({ sql }) => sql).length, 1);
  assert.deepEqual(setup.calls.slice(-2), [{ action: "release" }, { action: "end" }]); safeDto(result);
});

test("unsupported or malformed engine versions cannot pass and start no snapshot", async () => {
  for (const server_version of ["10.10.9-MariaDB", "9.99.0-MariaDB", "8.4.0-MySQL", "MariaDB-private-value", "10.11.private-MariaDB", 101114, "10.11.0-MariaDB".repeat(40)]) {
    const setup = fixture({ selected: [{ database_name: env.JESSIEMESSAGE_DB_NAME, server_version }] });
    const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
    assert.equal(statuses(result).engine, "fail"); assert.equal(statuses(result).history, "not_checked");
    assert.equal(setup.calls.some(({ sql }) => sql?.startsWith("START TRANSACTION")), false); safeDto(result);
  }
  const setup = fixture({ selected: [{ database_name: env.JESSIEMESSAGE_DB_NAME, server_version: "11.8.1-MariaDB" }] });
  assert.equal((await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies)).valid, true);
});

test("a cipher is required and an explicit insecure loopback override remains a failed production transport check", async () => {
  for (const cipher of [[{ Variable_name: "Ssl_cipher", Value: "" }], [{ Variable_name: "other", Value: "TLS" }], []]) {
    const setup = fixture({ cipher });
    const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
    assert.equal(statuses(result).transport, "fail"); assert.equal(statuses(result).history, "pass"); safeDto(result);
  }
  const setup = fixture();
  const result = await inspectDatabase({ env: { ...env, JESSIEMESSAGE_DB_HOST: "127.0.0.1", JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1" }, databaseName: env.JESSIEMESSAGE_DB_NAME }, {
    ...setup.dependencies, createPool: () => setup.dependencies.createPool(env),
  });
  assert.equal(result.valid, false); assert.equal(statuses(result).transport, "fail"); assert.equal(statuses(result).history, "pass");
});

test("privilege evidence rejects readonly, DDL, global rights, roles, grant options and unknown or excessive forms without stopping diagnostic reads", async () => {
  const invalid = [
    [usage, grants(undefined, "SELECT")],
    ...["CREATE", "CREATE TEMPORARY TABLES", "LOCK TABLES", "ALL PRIVILEGES"].map((privilege) => [...completeGrants(), grants(undefined, privilege)]),
    ...["SELECT", "INSERT", "UPDATE", "DELETE"].map((privilege) => [...completeGrants(), grants("*.*", privilege)]),
    [...completeGrants(), { grant: `${Object.values(grants("`jessiemessage_test_ci`.`users`"))[0]} WITH GRANT OPTION` }],
    [...completeGrants(), { grant: "GRANT USAGE ON *.* TO 'private-account'@'private-host' WITH GRANT OPTION" }],
    [...completeGrants(), { grant: "GRANT `application_role` TO 'private-account'@'private-host' WITH ADMIN OPTION" }],
    [...completeGrants(), { grant: "GRANT `application_role` TO 'private-account'@'private-host'" }],
    [...completeGrants(), { grant: "GRANT PROXY ON 'another'@'%' TO 'private-account'@'private-host'" }],
    [...completeGrants(), { grant: "GRANT SELECT (`id`) ON `jessiemessage_test_ci`.`users` TO 'private-account'@'private-host'" }],
    [{ grant: "x".repeat(16385) }], Array.from({ length: 129 }, () => usage), [{ first: "private", second: "private" }],
  ];
  for (const grantRows of invalid) {
    const setup = fixture({ grantRows });
    const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
    assert.equal(statuses(result).privileges, "fail");
    assert.equal(statuses(result).history, "pass"); assert.equal(statuses(result).schema_reads, "pass"); safeDto(result);
  }
});

test("exact table grants may split required DML while the migration ledger remains SELECT-only", async () => {
  const grantRows = [usage, grants("`jessiemessage_test_ci`.`schema_migrations`", "SELECT")];
  for (const table of appTables) {
    grantRows.push(grants(`\`jessiemessage_test_ci\`.\`${table}\``, "SELECT, INSERT"));
    grantRows.push(grants(`jessiemessage_test_ci.${table}`, "UPDATE, DELETE"));
  }
  const setup = fixture({ grantRows });
  assert.equal((await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies)).valid, true);
});

test("otherwise complete grants cannot hide any migration-ledger write privilege", async () => {
  for (const privilege of ["INSERT", "UPDATE", "DELETE", "SELECT, INSERT, UPDATE, DELETE"]) {
    const setup = fixture({ grantRows: [...completeGrants(), grants("`jessiemessage_test_ci`.`schema_migrations`", privilege)] });
    const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
    assert.equal(statuses(result).privileges, "fail", privilege); safeDto(result);
  }
});

test("database-wide grants are rejected even for escaped exact database names or SELECT-only rights", async () => {
  for (const scope of ["`jessiemessage_test_ci`.*", "`jessiemessage\\_test\\_ci`.*", "`jessiemessage%`.*", "`%`.*"])
    for (const privilege of ["SELECT", "INSERT, UPDATE, DELETE", "SELECT, INSERT, UPDATE, DELETE"]) {
      const setup = fixture({ grantRows: [...completeGrants(), grants(scope, privilege)] });
      const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
      assert.equal(statuses(result).privileges, "fail", `${scope}: ${privilege}`); safeDto(result);
    }
});

test("other databases, unknown tables and ambiguous escaped names fail despite sufficient required grants", async () => {
  for (const scope of [
    "`another_named_database`.`users`", "`jessiemessage_test_restore_ci`.`schema_migrations`",
    "`jessiemessage_test_ci`.`unexpected_table`", "`jessiemessage_test_ci`.`user_`",
    "`jessiemessage_test_ci`.`users%`", "`jessiemessage%`.`users`",
    "`jessiemessage\\_test\\_ci`.`users`", "`jessiemessage_test_ci`.`schema\\_migrations`",
    "`jessiemessage_test_ci`.`users``other`", "*.users",
  ]) for (const privilege of ["SELECT", "SELECT, INSERT, UPDATE, DELETE"]) {
    const setup = fixture({ grantRows: [...completeGrants(), grants(scope, privilege)] });
    const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
    assert.equal(statuses(result).privileges, "fail", `${scope}: ${privilege}`); safeDto(result);
  }
});

test("every application table needs all four DML rights and the ledger needs explicit SELECT", async () => {
  for (const table of [...appTables, "schema_migrations"]) {
    const grantRows = completeGrants().filter((row) => !Object.values(row)[0].includes(`.\`${table}\``));
    const setup = fixture({ grantRows });
    const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
    assert.equal(statuses(result).privileges, "fail", table); safeDto(result);
  }
  for (const missing of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    const grantRows = completeGrants().filter((row) => !Object.values(row)[0].includes(".`users`"));
    grantRows.push(grants("`jessiemessage_test_ci`.`users`", ["SELECT", "INSERT", "UPDATE", "DELETE"].filter((privilege) => privilege !== missing).join(", ")));
    const setup = fixture({ grantRows });
    const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
    assert.equal(statuses(result).privileges, "fail", missing); safeDto(result);
  }
});

test("ledger drift, missing migrations, invalid counters and unavailable sources fail history while projections still run", async () => {
  const drift = history(); drift[3].checksum = "f".repeat(64);
  const dirty = history(); dirty[26].state = "running";
  const badAttempts = history(); badAttempts[2].attempts = "NaN";
  for (const rows of [[], history().slice(0, -1), [...history(), { ...history()[26], version: 28 }], drift, dirty, badAttempts]) {
    const setup = fixture({ rows });
    const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
    assert.equal(statuses(result).history, "fail"); assert.equal(statuses(result).schema_reads, "pass"); safeDto(result);
  }
  const setup = fixture({ loadPlan() { throw new Error("private migration path"); } });
  const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
  assert.equal(statuses(result).history, "fail"); assert.equal(statuses(result).schema_reads, "pass"); safeDto(result);
});

test("a projection failure stops the bounded loop and still rolls back, releases and closes", async () => {
  const setup = fixture({ query(sql) { if (sql.includes(" FROM sessions WHERE")) throw new Error("private row schema failure"); } });
  const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
  assert.equal(statuses(result).schema_reads, "fail"); assert.equal(statuses(result).history, "pass");
  assert.equal(setup.calls.filter(({ sql }) => sql?.endsWith("WHERE 1 = 0")).length, 3);
  assert.deepEqual(setup.calls.slice(-3), [{ action: "rollback" }, { action: "release" }, { action: "end" }]); safeDto(result);
});

test("a failed read-only transaction never falls back to unprotected table reads", async () => {
  const setup = fixture({ query(sql) { if (sql.startsWith("START TRANSACTION")) throw new Error("private start failure"); } });
  const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
  assert.equal(statuses(result).history, "fail"); assert.equal(statuses(result).schema_reads, "fail");
  assert.equal(setup.calls.some(({ sql }) => sql?.includes("FROM schema_migrations")), false);
  assert.deepEqual(setup.calls.slice(-3), [{ action: "rollback" }, { action: "release" }, { action: "end" }]); safeDto(result);
});

test("every cleanup failure invalidates the result and never prevents subsequent cleanup", async () => {
  for (const action of ["rollback", "release", "end"]) {
    const setup = fixture({ [action]() { throw new Error(`private ${action} failure`); } });
    const result = await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies);
    assert.equal(result.valid, false); assert.equal(statuses(result).cleanup, "fail");
    assert.deepEqual(setup.calls.slice(-3), [{ action: "rollback" }, { action: "release" }, { action: "end" }]); safeDto(result);
  }
});

test("the promise waits for actual SQL completion, release and pool closure rather than abandoning timed-out work", async () => {
  const sql = deferred(), release = deferred(), closure = deferred();
  const setup = fixture({ query(statement) { if (statement.startsWith("SELECT version")) return sql.promise; }, release: () => release.promise, end: () => closure.promise });
  let completed = false;
  const pending = inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, setup.dependencies).then((result) => { completed = true; return result; });
  while (!setup.calls.some(({ sql: statement }) => statement?.startsWith("SELECT version"))) await new Promise(setImmediate);
  assert.equal(completed, false); assert.equal(setup.calls.some(({ action }) => action === "release"), false);
  sql.reject(new Error("private timeout after actual server operation"));
  while (!setup.calls.some(({ action }) => action === "release")) await new Promise(setImmediate);
  assert.equal(completed, false); assert.equal(setup.calls.some(({ action }) => action === "end"), false);
  release.resolve();
  while (!setup.calls.some(({ action }) => action === "end")) await new Promise(setImmediate);
  assert.equal(completed, false); closure.resolve();
  const result = await pending;
  assert.equal(statuses(result).history, "fail"); assert.equal(statuses(result).cleanup, "pass"); safeDto(result);
});

test("cancellation stops new queries but drains the actual pending SQL and closes its pool", async () => {
  const sql = deferred(), controller = new AbortController();
  const setup = fixture({ query(statement) { if (statement.startsWith("SELECT version")) return sql.promise; } });
  let completed = false;
  const pending = inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, {
    ...setup.dependencies, signal: controller.signal,
  }).then((result) => { completed = true; return result; });
  while (!setup.calls.some(({ sql: statement }) => statement?.startsWith("SELECT version"))) await new Promise(setImmediate);
  controller.abort(); await new Promise(setImmediate);
  assert.equal(completed, false); assert.equal(setup.calls.some(({ action }) => action === "release"), false);
  sql.resolve(history());
  const result = await pending;
  assert.equal(statuses(result).schema_reads, "fail"); assert.equal(statuses(result).cleanup, "pass");
  assert.equal(setup.calls.some(({ sql: statement }) => statement?.endsWith("WHERE 1 = 0")), false);
  assert.deepEqual(setup.calls.slice(-3), [{ action: "rollback" }, { action: "release" }, { action: "end" }]);
  safeDto(result);
  const already = new AbortController(); already.abort(); const unopened = fixture();
  await inspectDatabase({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }, { ...unopened.dependencies, signal: already.signal });
  assert.equal(unopened.calls.length, 0);
});
