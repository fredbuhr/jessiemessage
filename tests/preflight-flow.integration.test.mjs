import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { createdMigrationTables, applyMigrations, loadMigrations } from "../server/db/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { DATABASE_CHECK_NAMES, inspectDatabase } from "../server/preflight/database.mjs";
import { makePreflightReport } from "../server/preflight/report.mjs";
import { describeRuntimePrivileges } from "../server/preflight/privilege-diagnostics.mjs";

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
    JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE: "strict",
  };
  const sharedUser = process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_USER;
  const sharedPassword = process.env.JESSIEMESSAGE_SHARED_PREFLIGHT_DB_PASSWORD;
  assert.ok(typeof sharedUser === "string" && sharedUser.length <= 80
    && /^jessiemessage_shared_test(?:_[a-z0-9]+)*$/.test(sharedUser), "a separately precreated synthetic shared-profile account is required");
  assert.ok(typeof sharedPassword === "string" && sharedPassword.length > 0, "the shared-profile fixture requires a synthetic password");
  assert.ok(![options.user, preflightUser, process.env.JESSIEMESSAGE_RUNTIME_DB_USER].includes(sharedUser), "all fixture identities must be distinct");
  const sharedEnv = { ...process.env, JESSIEMESSAGE_RUNTIME_DB_USER: sharedUser,
    JESSIEMESSAGE_RUNTIME_DB_PASSWORD: sharedPassword, JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE: "infomaniak-shared" };
  const migrations = await loadMigrations(); assert.equal(migrations.length, 30);
  const appTables = createdMigrationTables(migrations);
  const allowedTables = [...appTables].reverse().concat("migration_probe", "preflight_ddl_probe", "schema_migrations");
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
    assert.deepEqual(Object.keys(result), ["valid", "checks", "privilegeObservation"]);
    assert.deepEqual(result.checks.map(({ name }) => name), DATABASE_CHECK_NAMES);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-private|example\.invalid|password|pseudonym|\bSELECT\b|MariaDB|host|user/i);
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
        assert.equal(Number((await runtime.query("SELECT COUNT(*) AS total FROM schema_migrations"))[0].total), 30);
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
    await t.test("the Infomaniak profile observes only the six documented rights and declares the writable ledger", async () => {
      const before = await digest(); const result = await probe(sharedEnv);
      for (const check of result.checks) {
        assert.equal(check.status, check.name === "transport" && process.env.JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL === "1" ? "fail" : "pass", check.name);
      }
      const report = makePreflightReport("database", result);
      assert.deepEqual(report.privilegeObservation, { profile: "infomaniak-shared", source: "show_grants",
        ledgerWritable: true, tempTables: true, tableLocks: true, permanentDdl: false });
      assert.equal(await digest(), before, "the shared-profile diagnostic is still read-only");
      const strict = await probe({ ...sharedEnv, JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE: "strict" });
      assert.equal(states(strict).privileges, "fail"); assert.equal(strict.privilegeObservation.ledgerWritable, null);
    });
    await t.test("closed privilege diagnostics classify actual MariaDB grants without exposing account or authentication metadata", async () => {
      const before = await digest(), pool = await createRuntimePool(sharedEnv); let runtime;
      try {
        runtime = await pool.getConnection();
        const report = describeRuntimePrivileges(await runtime.query("SHOW GRANTS FOR CURRENT_USER"), options.database);
        assert.equal(report.available, true); assert.equal(report.scope, "exact_literal");
        assert.equal(Object.values(report.rights).filter(Boolean).length, 6);
        assert.equal(report.extraRights, false); assert.equal(report.resources.maxUserConnections, true);
        assert.equal(report.delegation, false); assert.equal(report.roleOrProxy, false);
        for (const value of [options.database, sharedUser, sharedPassword, preflightUser]) {
          assert.equal(JSON.stringify(report).includes(value), false);
        }
      } finally {
        try { if (runtime) await runtime.release(); }
        finally { await pool.end(); }
      }
      assert.equal(await digest(), before, "grant observation leaves all application and ledger rows unchanged");
    });
    await t.test("the shared-profile account verifies the physical authentication schema without changing rows", async () => {
      const before = await digest();
      const pool = await createRuntimePool(sharedEnv);
      try { assert.equal(await createAuthStore(pool).assertSchema(), true); }
      finally { await pool.end(); }
      assert.equal(await digest(), before, "authentication schema verification leaves every application and ledger row unchanged");
    });
    await t.test("the explicit underscore-pattern profile checks the current schema namespace against real wildcard grants", async (patternTest) => {
      assert.equal(process.env.JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL, "1", "pattern fixtures require explicit disposable loopback configuration");
      assert.match(options.database, /^jessiemessage_test_[a-z0-9_]+$/, "pattern fixtures require a confirmed disposable schema containing underscores");
      const rootPassword = process.env.JESSIEMESSAGE_PATTERN_TEST_ROOT_PASSWORD;
      assert.ok(typeof rootPassword === "string" && rootPassword.length > 0,
        "real pattern fixtures require explicitly supplied disposable administrator credentials");
      const administrator = await connectDatabase({ ...process.env,
        JESSIEMESSAGE_DB_USER: "root", JESSIEMESSAGE_DB_PASSWORD: rootPassword });
      const patternUser = `jessiemessage_pattern_test_${randomBytes(8).toString("hex")}`;
      const patternPassword = `ci-pattern-only-${randomBytes(16).toString("hex")}`;
      const rawEnv = { ...sharedEnv, JESSIEMESSAGE_RUNTIME_DB_USER: patternUser,
        JESSIEMESSAGE_RUNTIME_DB_PASSWORD: patternPassword };
      const patternEnv = { ...rawEnv, JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE: "infomaniak-shared-pattern" };
      // Replace one wildcard at a time, so the fixture proves that every raw
      // underscore grants access to a distinct, same-length database name.
      const shadows = [...options.database.matchAll(/_/g)].map(({ index }) =>
        `${options.database.slice(0, index)}X${options.database.slice(index + 1)}`);
      assert.ok(shadows.length > 0); assert.equal(new Set(shadows).size, shadows.length);
      const createdSchemas = new Set(); let userCreated = false;
      async function createShadow(database) {
        assert.ok(shadows.includes(database), "only generated disposable shadows may be created");
        assert.equal((await administrator.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [database])).length,
          0, "never overwrite or clean up a schema that predates this fixture");
        await administrator.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        createdSchemas.add(database);
      }
      async function dropShadow(database) {
        assert.ok(createdSchemas.has(database), "only this fixture's own schemas may be dropped");
        await administrator.query(`DROP DATABASE \`${database}\``); createdSchemas.delete(database);
      }
      async function withRawRuntime(operation) {
        // The previous profile deliberately has no pool namespace guard. It
        // lets the test demonstrate the database server's actual wider access.
        const pool = await createRuntimePool(rawEnv); let runtime;
        try { runtime = await pool.getConnection(); return await operation(runtime); }
        finally {
          try { if (runtime) await runtime.release(); }
          finally { await pool.end(); }
        }
      }
      async function expectNamespaceRejected() {
        const before = await digest();
        const result = await inspectDatabase({ env: patternEnv, databaseName: options.database });
        assert.equal(result.valid, false);
        assert.ok(states(result).connection === "fail" || states(result).privileges === "fail",
          "the pattern profile must reject wider current visibility before accepting credentials");
        assert.equal(states(result).cleanup, "pass");
        assert.equal(await digest(), before, "namespace verification never changes target application or ledger rows");
      }
      async function expectOnlyTargetAccepted() {
        const before = await digest();
        const result = await probe(patternEnv);
        for (const check of result.checks) assert.equal(check.status, check.name === "transport" ? "fail" : "pass", check.name);
        assert.equal(result.privilegeObservation.profile, "infomaniak-shared-pattern");
        assert.equal(result.privilegeObservation.ledgerWritable, true);
        await withRawRuntime(async (runtime) => {
          const rows = await runtime.query("SHOW DATABASES");
          assert.deepEqual(rows.map((row) => Object.values(row)[0]).sort(), [options.database, "information_schema"].sort());
        });
        assert.equal(await digest(), before);
      }
      try {
        for (const database of shadows) assert.equal((await administrator.query(
          "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?", [database])).length, 0,
        "all shadow names must be absent before this disposable fixture starts");
        await administrator.query(`CREATE USER '${patternUser}'@'%' IDENTIFIED BY ? WITH MAX_USER_CONNECTIONS 38`, [patternPassword]);
        userCreated = true;
        // Database-level GRANT interprets these deliberately unescaped
        // underscores as wildcards, including inside backticks.
        await administrator.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES ON \`${options.database}\`.* TO '${patternUser}'@'%'`);
        await patternTest.test("raw underscore grants remain rejected by the unchanged strict and escaped-shared profiles", async () => {
          for (const privilegeProfile of ["strict", "infomaniak-shared"]) {
            const result = await probe({ ...rawEnv, JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE: privilegeProfile });
            assert.equal(result.valid, false); assert.equal(states(result).privileges, "fail");
            assert.equal(states(result).history, "pass"); assert.equal(states(result).schema_reads, "pass");
          }
        });
        await patternTest.test("the new profile accepts only the target and information_schema in current visibility", expectOnlyTargetAccepted);
        await patternTest.test("each underscore grants actual access to an empty and populated shadow, which the guard rejects", async () => {
          for (const database of shadows) {
            await createShadow(database);
            try {
              await withRawRuntime(async (runtime) => {
                await runtime.query(`USE \`${database}\``);
                assert.equal((await runtime.query("SELECT DATABASE() AS selected_database"))[0].selected_database, database);
                assert.equal((await runtime.query(`SHOW TABLES FROM \`${database}\``)).length, 0);
              });
              await expectNamespaceRejected();
              await administrator.query(`CREATE TABLE \`${database}\`.privilege_pattern_probe (id INT NOT NULL PRIMARY KEY, value INT NOT NULL) ENGINE=InnoDB`);
              await administrator.query(`INSERT INTO \`${database}\`.privilege_pattern_probe VALUES (1, 7)`);
              await withRawRuntime(async (runtime) => {
                assert.equal(Number((await runtime.query(`SELECT value FROM \`${database}\`.privilege_pattern_probe WHERE id = 1`))[0].value), 7);
              });
              await expectNamespaceRejected();
              assert.equal(Number((await administrator.query(`SELECT value FROM \`${database}\`.privilege_pattern_probe WHERE id = 1`))[0].value), 7);
            } finally { await dropShadow(database); }
            await expectOnlyTargetAccepted();
          }
        });
        await patternTest.test("a schema created after an accepted check is rejected on the next check", async () => {
          await expectOnlyTargetAccepted();
          const database = shadows[0]; await createShadow(database);
          try { await expectNamespaceRejected(); }
          finally { await dropShadow(database); }
          await expectOnlyTargetAccepted();
        });
      } finally {
        const failures = [];
        for (const database of createdSchemas) {
          try { await dropShadow(database); } catch (error) { failures.push(error); }
        }
        if (userCreated) {
          try { await administrator.query(`DROP USER '${patternUser}'@'%'`); } catch (error) { failures.push(error); }
        }
        try { await administrator.end(); } catch (error) { failures.push(error); }
        assert.equal(failures.length, 0, "disposable pattern account and schema cleanup must finish successfully");
      }
    });
    await t.test("the shared-profile fixture can perform application DML and ledger writes, with all row changes rolled back", async () => {
      const before = await digest(), pool = await createRuntimePool(sharedEnv); let runtime;
      try {
        runtime = await pool.getConnection(); await runtime.beginTransaction();
        const bucket = randomBytes(32);
        assert.equal((await runtime.query("INSERT INTO auth_rate_limits (bucket_hash, window_started_at, attempts) VALUES (?, '2026-10-15 00:00:00', 1)", [bucket])).affectedRows, 1);
        assert.equal((await runtime.query("UPDATE auth_rate_limits SET attempts = 2 WHERE bucket_hash = ?", [bucket])).affectedRows, 1);
        assert.equal(Number((await runtime.query("SELECT attempts FROM auth_rate_limits WHERE bucket_hash = ?", [bucket]))[0].attempts), 2);
        assert.equal((await runtime.query("DELETE FROM auth_rate_limits WHERE bucket_hash = ?", [bucket])).affectedRows, 1);
        assert.equal((await runtime.query(`INSERT INTO schema_migrations (version, name, checksum, state, attempts, finished_at)
          VALUES (31, 'synthetic_shared_probe', ?, 'applied', 1, '2026-10-15 00:00:00')`, ["0".repeat(64)])).affectedRows, 1);
        assert.equal((await runtime.query("UPDATE schema_migrations SET attempts = 2 WHERE version = 31")).affectedRows, 1);
        assert.equal(Number((await runtime.query("SELECT attempts FROM schema_migrations WHERE version = 31"))[0].attempts), 2);
        assert.equal((await runtime.query("DELETE FROM schema_migrations WHERE version = 31")).affectedRows, 1);
      } finally {
        try { if (runtime) await runtime.rollback(); }
        finally { if (runtime) runtime.release(); await pool.end(); }
      }
      assert.equal(await digest(), before);
    });
    await t.test("shared-profile temporary tables and explicit locks are available, while permanent DDL is denied", async () => {
      await connection.query("CREATE TABLE migration_probe (id INT NOT NULL PRIMARY KEY, value INT NOT NULL) ENGINE=InnoDB");
      await connection.query("INSERT INTO migration_probe VALUES (1, 7)");
      const before = await digest(), pool = await createRuntimePool(sharedEnv); let runtime;
      try {
        runtime = await pool.getConnection();
        const grants = await runtime.query("SHOW GRANTS FOR CURRENT_USER");
        assert.ok(grants.some((row) => / WITH MAX_USER_CONNECTIONS 38$/.test(Object.values(row)[0])), "the real fixture exposes the configured native connection-limit suffix");
        await runtime.query("CREATE TEMPORARY TABLE preflight_temp_probe (id INT NOT NULL)");
        await runtime.query("INSERT INTO preflight_temp_probe VALUES (1)");
        assert.equal(Number((await runtime.query("SELECT COUNT(*) AS total FROM preflight_temp_probe"))[0].total), 1);
        await runtime.query("DROP TEMPORARY TABLE preflight_temp_probe");
        await runtime.query("LOCK TABLES migration_probe READ");
        assert.equal(Number((await runtime.query("SELECT value FROM migration_probe WHERE id = 1"))[0].value), 7);
        await runtime.query("UNLOCK TABLES");
        for (const sql of [
          "CREATE TABLE preflight_ddl_probe (id INT NOT NULL)",
          "ALTER TABLE migration_probe ADD COLUMN unexpected INT",
          "DROP TABLE migration_probe", "TRUNCATE TABLE migration_probe",
        ]) await assert.rejects(runtime.query(sql), (error) => error?.errno === 1142);
        assert.deepEqual((await runtime.query("SHOW COLUMNS FROM migration_probe")).map((column) => column.Field), ["id", "value"]);
        assert.equal(Number((await runtime.query("SELECT value FROM migration_probe WHERE id = 1"))[0].value), 7);
        const created = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'preflight_ddl_probe'", [options.database]);
        assert.equal(created.length, 0);
      } finally {
        try { if (runtime) await runtime.query("UNLOCK TABLES"); }
        finally { if (runtime) runtime.release(); await pool.end(); }
        await connection.query("DROP TABLE IF EXISTS migration_probe");
      }
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
      const [record] = await connection.query("SELECT * FROM schema_migrations WHERE version = ?", [migrations.at(-1).version]);
      await connection.query("DELETE FROM schema_migrations WHERE version = ?", [migrations.at(-1).version]);
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
