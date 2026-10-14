import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { checksumSql, inspectHistory, loadMigrations, migrationLockName, migrationStatus, validateMigrationPlan, validateSql } from "../server/db/migrations.mjs";
import { parseArguments } from "../scripts/migrate.mjs";

const sql = "CREATE TABLE example (id INT NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;";
const migration = (version = 1, source = sql) => ({ version, name: `${String(version).padStart(4, "0")}_example.sql`, sql: source, checksum: checksumSql(source) });
const record = (source = migration(), state = "applied") => ({ version: source.version, name: source.name, checksum: source.checksum, state, attempts: 1 });
const config = {
  JESSIEMESSAGE_DB_HOST: "127.0.0.1", JESSIEMESSAGE_DB_NAME: "jessiemessage_test_unit",
  JESSIEMESSAGE_MIGRATION_DATABASE: "jessiemessage_test_unit", JESSIEMESSAGE_DB_USER: "synthetic_user",
  JESSIEMESSAGE_DB_PASSWORD: "synthetic_test_only",
};
const errorCode = (code) => (error) => error.code === code;

test("all committed migrations have consecutive names, exact SHA-256 checksums and a supported SQL format", async () => {
  const migrations = await loadMigrations();
  assert.equal(migrations.length, 8);
  assert.deepEqual(migrations.map((item) => item.version), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(migrations.every((item) => /^[0-9a-f]{64}$/.test(item.checksum)));
});

test("SQL format accepts strings/comments without treating their semicolons as statements", () => {
  const source = sql.replace("id INT", "label VARCHAR(20) DEFAULT 'semi;colon', id INT");
  assert.equal(validateSql(`-- comment;\n${source}\n/* comment; */`), `-- comment;\n${source}\n/* comment; */`);
});

test("SQL format rejects second statements, shared-schema names, ledger mutation and executable comments", () => {
  for (const source of [
    `${sql} DROP TABLE users;`, sql.replace("example (", "ztikix.example ("),
    sql.replace("example (", "schema_migrations ("), `/*! CREATE TABLE hidden (id INT) */ ${sql}`,
    `/*M! CREATE TABLE hidden (id INT) */ ${sql}`, sql.replace("example", "`example`"),
    "USE other_database;", "CREATE TABLE example (id INT", "CREATE TABLE example (id VARCHAR(20) DEFAULT 'unfinished)",
  ]) assert.throws(() => validateSql(source), errorCode("SQL_FORMAT"), source);
});

test("SQL format refuses external engines, copied data and arbitrary executable functions", () => {
  for (const source of [
    sql.replace("ENGINE=InnoDB", "ENGINE=CONNECT"),
    "CREATE TABLE example AS SELECT RELEASE_ALL_LOCKS() AS unlocked;",
    "CREATE TABLE example LIKE schema_migrations;",
    sql.replace("PRIMARY KEY (id)", "PRIMARY KEY (id), CHECK (SLEEP(1) = 0)"),
    sql.replace("COLLATE utf8mb4_unicode_ci", "COLLATE utf8mb4_unicode_ci DATA DIRECTORY = '/tmp'"),
    "ALTER TABLE example RENAME TO copied;",
  ]) assert.throws(() => validateSql(source), errorCode("SQL_FORMAT"), source);
});

test("migration source bytes including comments remain part of the checksum", () => {
  assert.notEqual(checksumSql(sql), checksumSql(`${sql}\n-- edited`));
});

test("plans reject missing, duplicate, renamed and mismatched migration files", () => {
  for (const plan of [[], [migration(2)], [migration(1), migration(1)],
    [{ ...migration(), name: "0001_Bad.sql" }], [{ ...migration(), checksum: "0".repeat(64) }]]) {
    assert.throws(() => validateMigrationPlan(plan), errorCode("MIGRATION_PLAN"));
  }
});

test("loader refuses incorrectly named SQL files before contacting a database", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".jessiemessage-migration-unit-"));
  try {
    await writeFile(join(directory, "0001_example.sql"), sql);
    await writeFile(join(directory, "malformed.sql"), sql);
    await assert.rejects(loadMigrations(directory), errorCode("MIGRATION_PLAN"));
  } finally { await rm(directory, { recursive: true }); }
});

test("history inspection reports pending, applied and interrupted states", () => {
  const plan = [migration(), migration(2)];
  assert.deepEqual(inspectHistory(plan, []).map((item) => item.state), ["pending", "pending"]);
  assert.deepEqual(inspectHistory(plan, [record(plan[0])]).map((item) => item.state), ["applied", "pending"]);
  assert.deepEqual(inspectHistory(plan, [record(plan[0]), record(plan[1], "running")]).map((item) => item.state), ["applied", "running"]);
});

test("history rejects edited or missing applied migrations, gaps and later rows after an interruption", () => {
  const plan = [migration(), migration(2)];
  assert.throws(() => inspectHistory(plan, [{ ...record(plan[0]), checksum: "0".repeat(64) }]), errorCode("CHECKSUM_DRIFT"));
  assert.throws(() => inspectHistory([plan[0]], [record(plan[0]), record(plan[1])]), errorCode("HISTORY_DIVERGED"));
  assert.throws(() => inspectHistory(plan, [record(plan[1])]), errorCode("HISTORY_DIVERGED"));
  assert.throws(() => inspectHistory(plan, [record(plan[0], "failed"), record(plan[1])]), errorCode("HISTORY_DIVERGED"));
});

test("database configuration requires all credentials and exact database confirmation", () => {
  assert.throws(() => databaseOptions({}), errorCode("DATABASE_CONFIG"));
  for (const key of ["JESSIEMESSAGE_DB_HOST", "JESSIEMESSAGE_DB_NAME", "JESSIEMESSAGE_MIGRATION_DATABASE", "JESSIEMESSAGE_DB_USER", "JESSIEMESSAGE_DB_PASSWORD"]) {
    assert.throws(() => databaseOptions({ ...config, [key]: "" }), errorCode("DATABASE_CONFIG"));
  }
  assert.throws(() => databaseOptions({ ...config, JESSIEMESSAGE_MIGRATION_DATABASE: "ztikix" }), errorCode("DATABASE_CONFIG"));
  assert.throws(() => databaseOptions({ ...config, JESSIEMESSAGE_DB_PORT: "not-a-port" }), errorCode("DATABASE_CONFIG"));
});

test("TLS validates the server by default and insecure connections are restricted to explicit loopback", () => {
  assert.equal(databaseOptions(config).ssl.rejectUnauthorized, true);
  assert.equal(databaseOptions({ ...config, JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1" }).ssl, false);
  assert.throws(() => databaseOptions({ ...config, JESSIEMESSAGE_DB_HOST: "db.example.test", JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1" }), errorCode("DATABASE_CONFIG"));
  assert.equal(databaseOptions(config).multipleStatements, false);
  assert.equal(databaseOptions(config).logParam, false);
});

test("connection errors sanitize inaccessible CA paths", async () => {
  const privatePath = "/not-accessible/private-certificate.pem";
  await assert.rejects(connectDatabase({ ...config, JESSIEMESSAGE_DB_TLS_CA_PATH: privatePath }), (error) => {
    assert.equal(error.code, "DATABASE_CONNECTION");
    assert.equal(error.message.includes(privatePath), false);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("lock names are deterministic, database-scoped and do not include credentials", () => {
  assert.equal(migrationLockName("test_a"), migrationLockName("test_a"));
  assert.notEqual(migrationLockName("test_a"), migrationLockName("test_b"));
  assert.ok(migrationLockName("test_a").length <= 64);
});

test("runner refuses a different selected database and unsupported server before writes", async () => {
  for (const selected of [
    { database_name: "ztikix", server_version: "10.11.18-MariaDB" },
    { database_name: "jessiemessage_test_unit", server_version: "8.4.0-MySQL" },
    { database_name: "jessiemessage_test_unit", server_version: "10.6.20-MariaDB" },
  ]) {
    const queries = [];
    const connection = { query: async (query) => { queries.push(query); return [selected]; } };
    await assert.rejects(migrationStatus(connection, { database: "jessiemessage_test_unit", migrations: [migration()] }),
      (error) => ["DATABASE_TARGET", "DATABASE_VERSION"].includes(error.code));
    assert.equal(queries.length, 1);
  }
});

test("runner never bootstraps a ledger when it cannot acquire its lock", async () => {
  const queries = [];
  const connection = { query: async (query) => {
    queries.push(query);
    if (query.startsWith("SELECT DATABASE")) return [{ database_name: "jessiemessage_test_unit", server_version: "10.11.18-MariaDB" }];
    if (query.startsWith("SELECT GET_LOCK")) return [{ acquired: 0 }];
    return [];
  } };
  await assert.rejects(migrationStatus(connection, { database: "jessiemessage_test_unit", migrations: [migration()] }), errorCode("MIGRATION_LOCKED"));
  assert.ok(queries.every((query) => !query.startsWith("CREATE") && !query.includes("information_schema")));
});

test("CLI requires complete explicit recovery arguments and refuses duplicate or unknown flags", () => {
  assert.deepEqual(parseArguments(["up"]), { command: "up" });
  assert.deepEqual(parseArguments(["resolve", "--version", "1", "--checksum", "a".repeat(64), "--outcome", "applied", "--confirm-inspected"]),
    { command: "resolve", version: 1, checksum: "a".repeat(64), outcome: "applied", reviewed: true });
  for (const args of [[], ["up", "--force"], ["resolve"], ["resolve", "--version", "1", "--version", "1"], ["resolve", "--confirm-inspected", "--confirm-inspected"]]) {
    assert.throws(() => parseArguments(args), errorCode("USAGE"));
  }
});
