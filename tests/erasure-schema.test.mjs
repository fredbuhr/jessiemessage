import test from "node:test";
import assert from "node:assert/strict";
import { createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { assertErasureSchema } from "../server/data/erasure-schema.mjs";

const database = "jessiemessage_test_fk_metadata";
const ledgerColumns = [
  ["version", "int", null, "NO", true], ["name", "varchar", 128, "NO"], ["checksum", "char", 64, "NO"],
  ["state", "varchar", 8, "NO"], ["attempts", "int", null, "NO", true], ["started_at", "datetime", null, "NO"],
  ["finished_at", "datetime", null, "YES"], ["error_code", "int", null, "YES", true],
  ["recovered_at", "datetime", null, "YES"], ["recovery_action", "varchar", 8, "YES"],
].map(([name, type, size, nullable, unsigned]) => ({ name, type, size, nullable,
  definition: `${type}${unsigned ? " unsigned" : ""}`, precision_value: type === "datetime" ? 6 : null, collation_name: "ascii_bin" }));
const ledgerChecks = [
  ["schema_migrations_version", "version > 0"], ["schema_migrations_state", "state IN ('running', 'failed', 'retry', 'applied')"],
  ["schema_migrations_checksum", "checksum REGEXP '^[0-9a-f]{64}$'"],
  ["schema_migrations_finished", "(state = 'applied' AND finished_at IS NOT NULL) OR (state <> 'applied' AND finished_at IS NULL)"],
  ["schema_migrations_recovery", "recovery_action IS NULL OR recovery_action IN ('retry', 'applied')"],
].map(([name, clause]) => ({ name, clause }));

async function fixture() {
  const migrations = await loadMigrations(), tables = [...createdMigrationTables(migrations), "schema_migrations"];
  const keys = [], rules = [];
  // Authored constraints supply realistic metadata; tests change only the
  // referenced schema while retaining every table, column, order and rule.
  for (const migration of migrations) {
    const table = /^\s*CREATE TABLE ([a-z_]+)/i.exec(migration.sql)?.[1];
    if (!table) continue;
    for (const match of migration.sql.matchAll(/CONSTRAINT\s+([a-z0-9_]+)\s+FOREIGN KEY\s*\(([^)]+)\)\s+REFERENCES\s+([a-z0-9_]+)\s*\(([^)]+)\)\s+ON UPDATE RESTRICT ON DELETE RESTRICT/gi)) {
      const children = match[2].split(",").map(value => value.trim()), parents = match[4].split(",").map(value => value.trim());
      rules.push({ name: match[1], updateRule: "RESTRICT", deleteRule: "RESTRICT" });
      children.forEach((columnName, index) => keys.push({ child: table, name: match[1], positionValue: index + 1,
        columnName, parentSchema: database, parent: match[3], parentColumn: parents[index] }));
    }
  }
  assert.equal(rules.length, 44);
  const queries = [];
  const connection = { async query(sql) {
    queries.push(sql);
    if (sql.startsWith("SELECT DATABASE()")) return [{ database_name: database, server_version: "10.11.18-MariaDB" }];
    if (sql.startsWith("SET SESSION")) return [];
    if (sql.startsWith("SELECT GET_LOCK")) return [{ acquired: 1 }];
    if (sql.startsWith("SELECT RELEASE_LOCK")) return [{ released: 1 }];
    if (sql.includes("information_schema.TABLES")) return sql.includes("TABLE_NAME = ?") ? [{ engine: "InnoDB" }] : tables.map(name => ({ name, engine: "InnoDB" }));
    if (sql.includes("information_schema.COLUMNS")) return ledgerColumns;
    if (sql.includes("information_schema.STATISTICS")) return [{ name: "PRIMARY", column_name: "version" }];
    if (sql.includes("information_schema.CHECK_CONSTRAINTS")) return ledgerChecks;
    if (sql.startsWith("SELECT version, name, checksum")) return migrations.map(({ version, name, checksum }) => ({ version, name, checksum, state: "applied", attempts: 1 }));
    if (sql.startsWith("SELECT @@SESSION.foreign_key_checks")) return [{ foreignKeys: 1, checks: 1 }];
    if (sql.includes("information_schema.KEY_COLUMN_USAGE")) return keys;
    if (sql.includes("information_schema.REFERENTIAL_CONSTRAINTS")) return rules;
    if (sql.includes("information_schema.TRIGGERS")) return [];
    assert.fail(`Unexpected synthetic metadata query: ${sql}`);
  } };
  return { connection, keys, queries };
}

test("the erasure dependency graph accepts only the current database's exact parent schema", async () => {
  const f = await fixture();
  await assertErasureSchema(f.connection, database);
  assert.ok(f.queries.some(sql => sql.includes("REFERENCED_TABLE_SCHEMA AS parentSchema")));
  assert.ok(f.queries.every(sql => /^(?:SELECT|SET SESSION)/.test(sql)), "schema checks must not perform DDL or data writes");
});

test("a homonymous foreign-schema parent cannot pass the complete erasure graph check", async () => {
  for (const parentSchema of ["jessiemessage_test_foreign", database.toUpperCase(), undefined, null]) {
    const f = await fixture(), foreign = f.keys.find(row => row.child === "crm_profiles");
    assert.ok(foreign); foreign.parentSchema = parentSchema;
    await assert.rejects(assertErasureSchema(f.connection, database), { code: "ERASURE_SCHEMA" });
    assert.equal(f.queries.some(sql => sql.includes("information_schema.TRIGGERS")), false, "reject the dependency mismatch before later checks");
  }
});
