import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, checksumSql, loadMigrations, migrationLockName, migrationStatus, resolveMigration } from "../server/db/migrations.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
const errorCode = (code) => (error) => error.code === code;
const id = () => randomBytes(16);
const tokenHash = () => randomBytes(32);
const fixture = (sql) => [{ version: 1, name: "0001_probe.sql", sql, checksum: checksumSql(sql) }];
const probeSql = "CREATE TABLE migration_probe (id INT NOT NULL, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;";
const allowedTables = ["chat_events", "chat_receipts", "messages", "mail_outbox", "client_session_state", "email_verifications", "client_auth_state", "auth_session_state", "admin_recovery_codes", "admin_mfa", "auth_rate_limits", "conversations", "sessions", "invitations", "users", "migration_probe", "schema_migrations"];

test("real MariaDB migration and foundation constraints (synthetic disposable database only)", { skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback test database.", timeout: 120000 }, async (t) => {
  const options = databaseOptions();
  // This is intentionally stricter than migration configuration: tests destroy only their fixture tables.
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host), "integration tests require loopback");
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/, "integration tests require a dedicated jessiemessage_test[_suffix] schema");
  const connection = await connectDatabase();
  const database = options.database;
  const migrations = await loadMigrations();
  const context = { database, migrations };
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
    assert.ok(tables.every((table) => allowedTables.includes(table.name)), "refuse cleanup when unrelated tables are present");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  async function seed() {
    const admin = id();
    const client = id();
    const otherClient = id();
    for (const [userId, role, email] of [[admin, "admin", "admin@example.invalid"], [client, "client", "client@example.invalid"], [otherClient, "client", "other@example.invalid"]]) {
      await connection.query("INSERT INTO users (id, role, pseudonym, email) VALUES (?, ?, ?, ?)", [userId, role, "Synthetic", email]);
    }
    return { admin, client, otherClient };
  }
  try {
    await reset();
    await t.test("status is read-only on an empty schema; application is ordered and repeatable", async () => {
      assert.deepEqual((await migrationStatus(connection, context)).map((item) => item.state), Array(15).fill("pending"));
      assert.equal((await connection.query("SHOW TABLES")).length, 0);
      assert.deepEqual(await applyMigrations(connection, context), { applied: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], unchanged: 0 });
      assert.deepEqual(await applyMigrations(connection, context), { applied: [], unchanged: 15 });
      assert.deepEqual((await migrationStatus(connection, context)).map((item) => item.state), Array(15).fill("applied"));
      const timezone = await connection.query("SELECT @@session.time_zone AS value");
      assert.equal(timezone[0].value, "+00:00");
    });
    await t.test("a concurrent connection cannot migrate while the same database lock is held", async () => {
      const competitor = await connectDatabase();
      const lockName = migrationLockName(database);
      try {
        assert.equal(Number((await connection.query("SELECT GET_LOCK(?, 0) AS acquired", [lockName]))[0].acquired), 1);
        await assert.rejects(applyMigrations(competitor, context), errorCode("MIGRATION_LOCKED"));
      } finally {
        await connection.query("SELECT RELEASE_LOCK(?)", [lockName]);
        await competitor.end();
      }
      assert.deepEqual(await applyMigrations(connection, context), { applied: [], unchanged: 15 });
    });
    await t.test("edited and removed applied migrations are rejected before new DDL", async () => {
      const changed = migrations.map((migration) => ({ ...migration }));
      changed[0].sql += "\n-- modified immutable history\n";
      changed[0].checksum = checksumSql(changed[0].sql);
      await assert.rejects(applyMigrations(connection, { database, migrations: changed }), errorCode("CHECKSUM_DRIFT"));
      await assert.rejects(applyMigrations(connection, { database, migrations: migrations.slice(0, -1) }), errorCode("HISTORY_DIVERGED"));
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM schema_migrations"))[0].count, 15n);
    });
    await t.test("client activation and access expiry require all recorded gate prerequisites", async () => {
      const { client } = await seed();
      await assert.rejects(connection.query("UPDATE users SET status = 'active' WHERE id = ?", [client]));
      await assert.rejects(connection.query("UPDATE users SET access_expires_at = '2030-01-01' WHERE id = ?", [client]));
      await connection.query(`UPDATE users SET status = 'active', email_verified_at = '2026-01-01',
        age_assured_at = '2026-01-01', access_approved_at = '2026-01-01', access_expires_at = '2030-01-01' WHERE id = ?`, [client]);
      await assert.rejects(connection.query("UPDATE users SET age_assured_at = NULL WHERE id = ?", [client]));
      await assert.rejects(connection.query("INSERT INTO users (id, role, pseudonym, email) VALUES (?, 'client', 'Synthetic', 'short@example.invalid')", [Buffer.alloc(1)]));
    });
    await t.test("invites enforce administrator issuer, exact token digests, lifecycle and independent access duration", async () => {
      const users = await connection.query("SELECT id, role, email FROM users");
      const admin = users.find((user) => user.role === "admin").id;
      const client = users.find((user) => user.email === "client@example.invalid").id;
      const invite = id();
      const digest = tokenHash();
      const insert = "INSERT INTO invitations (id, token_hash, created_by_id, created_at, expires_at, access_days) VALUES (?, ?, ?, '2026-01-01', '2030-01-01', ?)";
      await connection.query(insert, [invite, digest, admin, 30]);
      await assert.rejects(connection.query(insert, [id(), digest, admin, null]));
      await assert.rejects(connection.query(insert, [id(), Buffer.alloc(1), admin, null]));
      await assert.rejects(connection.query(insert, [id(), tokenHash(), client, null]));
      await assert.rejects(connection.query(insert, [id(), tokenHash(), admin, 0]));
      await assert.rejects(connection.query(insert, [id(), tokenHash(), admin, 3651]));
      await assert.rejects(connection.query("UPDATE invitations SET consumed_at = '2027-01-01' WHERE id = ?", [invite]));
      await assert.rejects(connection.query("UPDATE invitations SET consumed_at = '2027-01-01', consumed_by_id = ? WHERE id = ?", [admin, invite]));
      await assert.rejects(connection.query("UPDATE invitations SET consumed_at = expires_at, consumed_by_id = ? WHERE id = ?", [client, invite]));
      await connection.query("UPDATE invitations SET consumed_at = '2027-01-01', consumed_by_id = ? WHERE id = ?", [client, invite]);
      await assert.rejects(connection.query("UPDATE invitations SET revoked_at = '2027-01-01' WHERE id = ?", [invite]));
    });
    await t.test("sessions support per-device revocation and reject duplicate/short hashes or invalid lifetimes", async () => {
      const client = (await connection.query("SELECT id FROM users WHERE email = 'client@example.invalid'"))[0].id;
      const session = id();
      const digest = tokenHash();
      const insert = "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, '2026-01-01', '2030-01-01')";
      await connection.query(insert, [session, client, digest]);
      await assert.rejects(connection.query(insert, [id(), client, digest]));
      await assert.rejects(connection.query(insert, [id(), client, Buffer.alloc(1)]));
      await assert.rejects(connection.query(insert, [id(), id(), tokenHash()]));
      await assert.rejects(connection.query("UPDATE sessions SET expires_at = created_at WHERE id = ?", [session]));
      await connection.query("UPDATE sessions SET revoked_at = '2027-01-01' WHERE id = ?", [session]);
      assert.match((await connection.query("SELECT revoked_at FROM sessions WHERE id = ?", [session]))[0].revoked_at, /^2027-01-01 00:00:00(?:\.0{1,6})?$/);
    });
    await t.test("conversations enforce one per client, correct participant roles and restrictive deletion", async () => {
      const users = await connection.query("SELECT id, role, email FROM users");
      const admin = users.find((user) => user.role === "admin").id;
      const client = users.find((user) => user.email === "client@example.invalid").id;
      const other = users.find((user) => user.email === "other@example.invalid").id;
      const insert = "INSERT INTO conversations (id, client_id, admin_id) VALUES (?, ?, ?)";
      await connection.query(insert, [id(), client, admin]);
      await assert.rejects(connection.query(insert, [id(), client, admin]));
      await assert.rejects(connection.query(insert, [id(), other, client]));
      await assert.rejects(connection.query(insert, [id(), admin, admin]));
      await assert.rejects(connection.query("UPDATE users SET role = 'client' WHERE id = ?", [admin]));
      await assert.rejects(connection.query("DELETE FROM users WHERE id = ?", [client]));
    });
    await t.test("nonempty shared schema and malformed existing ledger are refused", async () => {
      await reset();
      await connection.query(probeSql);
      await assert.rejects(applyMigrations(connection, context), errorCode("DATABASE_NOT_EMPTY"));
      await reset();
      await connection.query("CREATE TABLE schema_migrations (version INT NOT NULL) ENGINE=InnoDB");
      await assert.rejects(applyMigrations(connection, context), errorCode("LEDGER_SHAPE"));
    });
    await t.test("DDL may commit before a failure; dirty state blocks reruns and recovery requires exact inspection confirmation", async () => {
      await reset();
      const probe = fixture(probeSql);
      const probeContext = { database, migrations: probe };
      let interrupted = false;
      const interruptedConnection = { query: async (query, parameters) => {
        const result = await connection.query(query, parameters);
        if (!interrupted && query === probeSql) { interrupted = true; throw new Error("synthetic interruption after committed DDL"); }
        return result;
      } };
      await assert.rejects(applyMigrations(interruptedConnection, probeContext), errorCode("MIGRATION_FAILED"));
      assert.equal((await connection.query("SELECT COUNT(*) AS count FROM migration_probe"))[0].count, 0n);
      assert.equal((await migrationStatus(connection, probeContext))[0].state, "failed");
      await assert.rejects(applyMigrations(connection, probeContext), errorCode("RECOVERY_REQUIRED"));
      await assert.rejects(resolveMigration(connection, { ...probeContext, version: 1, checksum: "0".repeat(64), outcome: "applied", reviewed: true }), errorCode("RECOVERY_CONFIRMATION"));
      await assert.rejects(resolveMigration(connection, { ...probeContext, version: 1, checksum: probe[0].checksum, outcome: "applied" }), errorCode("RECOVERY_CONFIRMATION"));
      assert.deepEqual(await resolveMigration(connection, { ...probeContext, version: 1, checksum: probe[0].checksum, outcome: "applied", reviewed: true }), { version: 1, state: "applied" });
      assert.deepEqual(await applyMigrations(connection, probeContext), { applied: [], unchanged: 1 });
    });
    await t.test("retry recovery preserves checksum and counts a fresh attempt after manually restoring the prior schema", async () => {
      await reset();
      const probe = fixture(probeSql);
      const probeContext = { database, migrations: probe };
      const crashConnection = { query: async (query, parameters) => {
        if (query === probeSql) throw new Error("synthetic interruption before DDL");
        return connection.query(query, parameters);
      } };
      await assert.rejects(applyMigrations(crashConnection, probeContext), errorCode("MIGRATION_FAILED"));
      assert.deepEqual(await resolveMigration(connection, { ...probeContext, version: 1, checksum: probe[0].checksum, outcome: "retry", reviewed: true }), { version: 1, state: "retry" });
      assert.deepEqual(await applyMigrations(connection, probeContext), { applied: [1], unchanged: 0 });
      assert.equal((await migrationStatus(connection, probeContext))[0].attempts, 2);
    });
    await t.test("a simulated lost connection leaves a durable running marker even when recording failure is impossible", async () => {
      await reset();
      const probe = fixture(probeSql);
      const probeContext = { database, migrations: probe };
      let crashed = false;
      const crashConnection = { query: async (query, parameters) => {
        if (crashed) throw new Error("synthetic connection lost");
        const result = await connection.query(query, parameters);
        if (query === probeSql) { crashed = true; throw new Error("synthetic connection lost"); }
        return result;
      } };
      await assert.rejects(applyMigrations(crashConnection, probeContext), errorCode("MIGRATION_FAILED"));
      // The underlying test connection is still open; release its simulated orphaned lock.
      await connection.query("SELECT RELEASE_LOCK(?)", [migrationLockName(database)]);
      assert.equal((await migrationStatus(connection, probeContext))[0].state, "running");
      await assert.rejects(applyMigrations(connection, probeContext), errorCode("RECOVERY_REQUIRED"));
    });
  } finally {
    try { await reset(); } finally { await connection.end(); }
  }
});
