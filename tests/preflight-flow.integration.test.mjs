import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { DATABASE_CHECK_NAMES, inspectDatabase } from "../server/preflight/database.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const states = (value) => Object.fromEntries(value.checks.map(({ name, status }) => [name, status]));

test("operator SQL preflight observes real MariaDB with runtime DML rights without mutation (synthetic disposable database only)", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 120000,
}, async (t) => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated disposable schema");
  assert.ok(process.env.JESSIEMESSAGE_RUNTIME_DB_USER && process.env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD,
    "separately provisioned shared runtime DML credentials are required");
  const preflightUser = process.env.JESSIEMESSAGE_PREFLIGHT_DB_USER;
  const preflightPassword = process.env.JESSIEMESSAGE_PREFLIGHT_DB_PASSWORD;
  assert.ok(typeof preflightUser === "string" && preflightUser.length <= 80
    && /^jessiemessage_preflight_test(?:_[a-z0-9]+)*$/.test(preflightUser),
    "a separately precreated synthetic preflight account is required");
  assert.ok(typeof preflightPassword === "string" && preflightPassword.length > 0,
    "the precreated preflight account requires a synthetic password");
  assert.ok(preflightUser !== options.user && preflightUser !== process.env.JESSIEMESSAGE_RUNTIME_DB_USER,
    "preflight credentials must be distinct from the migration and shared runtime identities");
  const preflightEnv = { ...process.env,
    JESSIEMESSAGE_RUNTIME_DB_USER: preflightUser,
    JESSIEMESSAGE_RUNTIME_DB_PASSWORD: preflightPassword,
  };
  const migrations = await loadMigrations(); assert.equal(migrations.length, 27);
  const appTables = migrations.map((migration) => {
    const match = /^CREATE\s+TABLE\s+([a-z][a-z0-9_]*)\s*\(/i.exec(migration.sql.trim());
    assert.ok(match, "cleanup accepts only explicit unqualified CREATE TABLE migrations"); return match[1];
  });
  const allowedTables = [...appTables].reverse().concat("migration_probe", "schema_migrations");
  const connection = await connectDatabase();
  async function cleanup() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  async function digest() {
    const hash = createHash("sha256");
    const present = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    for (const table of [...appTables, "schema_migrations"].filter((table) => present.some(({ name }) => name === table))) {
      const rows = await connection.query(`SELECT * FROM ${table}`);
      hash.update(table).update(JSON.stringify(rows.map((row) => JSON.stringify(row, (_key, value) => typeof value === "bigint" ? value.toString() : value)).sort()));
    }
    return hash.digest("hex");
  }
  async function probe(probeEnv = preflightEnv) {
    const lifecycle = [];
    let acquisitions = 0, releases = 0, closed = false;
    const result = await inspectDatabase({ env: probeEnv, databaseName: options.database }, {
      async createPool(env) {
        lifecycle.push("pool"); const pool = await createRuntimePool(env);
        return {
          async getConnection() {
            acquisitions++; const runtime = await pool.getConnection();
            return {
              query: (...args) => runtime.query(...args),
              rollback: () => runtime.rollback(),
              release() { releases++; lifecycle.push("release"); return runtime.release(); },
            };
          },
          async end() { lifecycle.push("end"); await pool.end(); closed = true; },
        };
      },
    });
    assert.equal(closed, true, "the real pool is closed before returning a report");
    assert.equal(acquisitions, 1); assert.equal(releases, 1);
    assert.deepEqual(lifecycle, ["pool", "release", "end"]);
    assert.deepEqual(Object.keys(result), ["valid", "checks"]);
    assert.deepEqual(result.checks.map(({ name }) => name), DATABASE_CHECK_NAMES);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-private|example\.invalid|password|pseudonym|SELECT|MariaDB|host|user/i);
    return result;
  }
  try {
    await cleanup(); await applyMigrations(connection, { database: options.database, migrations });
    // Only the disposable CI migrator receives database-scoped GRANT OPTION.
    // No account creation or authentication data belongs in these statements.
    const [{ mode }] = await connection.query("SELECT @@SESSION.sql_mode AS mode");
    assert.equal(typeof mode, "string");
    await connection.query("SET SESSION sql_mode = ?", [[...new Set(mode.split(",").filter(Boolean).concat("NO_AUTO_CREATE_USER"))].join(",")]);
    try {
      await t.test("table provisioning refuses a synthetic account that was not precreated", async () => {
        const absentUser = `jessiemessage_preflight_missing_${randomBytes(8).toString("hex")}`;
        await assert.rejects(connection.query(`GRANT SELECT ON \`${options.database}\`.\`users\` TO '${absentUser}'@'%'`),
          (error) => error?.errno === 1133 || error?.errno === 1410);
      });
      for (const table of appTables) {
        await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${options.database}\`.\`${table}\` TO '${preflightUser}'@'%'`);
      }
      await connection.query(`GRANT SELECT ON \`${options.database}\`.\`schema_migrations\` TO '${preflightUser}'@'%'`);
    } finally { await connection.query("SET SESSION sql_mode = ?", [mode]); }
    await connection.query(`INSERT INTO users (id, role, status, pseudonym, email, password_hash)
      VALUES (?, 'admin', 'active', 'synthetic-private-preflight-name', 'preflight-secret@example.invalid', 'synthetic-private-password-hash')`, [randomBytes(16)]);
    await t.test("table-scoped runtime DML and read-only ledger grants are observed, including driver query timeouts", async () => {
      const before = await digest(); const result = await probe();
      for (const check of result.checks) {
        const expected = check.name === "transport" && process.env.JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL === "1" ? "fail" : "pass";
        assert.equal(check.status, expected, check.name);
      }
      assert.equal(result.valid, process.env.JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL !== "1");
      assert.equal(await digest(), before, "preflight never modifies application or ledger rows");
    });
    await t.test("the dedicated runtime can mutate an application table but all ledger writes are denied by MariaDB", async () => {
      const before = await digest(); const pool = await createRuntimePool(preflightEnv);
      let runtime;
      try {
        runtime = await pool.getConnection(); await runtime.beginTransaction();
        assert.equal(Number((await runtime.query("SELECT COUNT(*) AS total FROM schema_migrations"))[0].total), 27);
        for (const sql of [
          "UPDATE schema_migrations SET attempts = attempts WHERE version = 1",
          "DELETE FROM schema_migrations WHERE version = 0",
          "INSERT INTO schema_migrations SELECT * FROM schema_migrations WHERE 1 = 0",
        ]) await assert.rejects(runtime.query(sql), (error) => error?.errno === 1142);
        const bucket = randomBytes(32);
        await runtime.query("INSERT INTO auth_rate_limits (bucket_hash, window_started_at, attempts) VALUES (?, '2026-10-15 00:00:00', 1)", [bucket]);
        assert.equal(Number((await runtime.query("SELECT attempts FROM auth_rate_limits WHERE bucket_hash = ?", [bucket]))[0].attempts), 1);
        await runtime.query("UPDATE auth_rate_limits SET attempts = 2 WHERE bucket_hash = ?", [bucket]);
        assert.equal(Number((await runtime.query("SELECT attempts FROM auth_rate_limits WHERE bucket_hash = ?", [bucket]))[0].attempts), 2);
        assert.equal((await runtime.query("DELETE FROM auth_rate_limits WHERE bucket_hash = ?", [bucket])).affectedRows, 1);
      } finally {
        try { if (runtime) await runtime.rollback(); }
        finally { if (runtime) runtime.release(); await pool.end(); }
      }
      assert.equal(await digest(), before, "privilege verification leaves all application and ledger rows unchanged");
    });
    await t.test("the existing shared database-wide runtime grants are rejected without changing them", async () => {
      const before = await digest(); const result = await probe(process.env);
      assert.equal(result.valid, false); assert.equal(states(result).privileges, "fail");
      assert.equal(states(result).history, "pass"); assert.equal(states(result).schema_reads, "pass");
      assert.equal(await digest(), before);
    });
    await t.test("the actual migration identity fails the DML-only privilege check without writing or repairing anything", async () => {
      assert.ok(process.env.JESSIEMESSAGE_DB_USER && process.env.JESSIEMESSAGE_DB_PASSWORD);
      const before = await digest();
      const result = await probe({ ...process.env,
        JESSIEMESSAGE_DB_USER: undefined,
        JESSIEMESSAGE_RUNTIME_DB_USER: process.env.JESSIEMESSAGE_DB_USER,
        JESSIEMESSAGE_RUNTIME_DB_PASSWORD: process.env.JESSIEMESSAGE_DB_PASSWORD,
      });
      assert.equal(result.valid, false); assert.equal(states(result).privileges, "fail");
      assert.equal(states(result).history, "pass"); assert.equal(states(result).schema_reads, "pass");
      assert.equal(await digest(), before);
    });
    await t.test("checksum drift is reported from the bounded real ledger and is never repaired", async () => {
      await connection.query("UPDATE schema_migrations SET checksum = ? WHERE version = 5", ["f".repeat(64)]);
      try {
        const before = await digest(); const result = await probe();
        assert.equal(states(result).history, "fail"); assert.equal(states(result).schema_reads, "pass");
        assert.equal(await digest(), before);
      } finally { await connection.query("UPDATE schema_migrations SET checksum = ? WHERE version = 5", [migrations[4].checksum]); }
    });
    await t.test("a missing recorded migration is not inferred from existing physical tables or repaired", async () => {
      const [record] = await connection.query("SELECT * FROM schema_migrations WHERE version = 27");
      await connection.query("DELETE FROM schema_migrations WHERE version = 27");
      try {
        const before = await digest(); const result = await probe();
        assert.equal(states(result).history, "fail"); assert.equal(states(result).schema_reads, "pass");
        assert.equal(await digest(), before);
      } finally {
        await connection.query(`INSERT INTO schema_migrations (version, name, checksum, state, attempts, started_at,
          finished_at, error_code, recovered_at, recovery_action) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [record.version, record.name, record.checksum, record.state, record.attempts, record.started_at,
          record.finished_at, record.error_code, record.recovered_at, record.recovery_action]);
      }
    });
    await t.test("matching history cannot hide an unreadable physical table, and the probe creates no replacement", async () => {
      await connection.query("DROP TABLE media_storage_objects");
      const before = await digest(); const result = await probe();
      assert.equal(states(result).history, "pass"); assert.equal(states(result).schema_reads, "fail");
      assert.equal(await digest(), before);
      const rows = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'media_storage_objects'", [options.database]);
      assert.equal(rows.length, 0);
    });
  } finally {
    try { await cleanup(); } finally { await connection.end(); }
  }
});
