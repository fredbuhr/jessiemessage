import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const defaultMigrationDirectory = fileURLToPath(new URL("../../db/migrations/", import.meta.url));
export const ledgerTable = "schema_migrations";

export class MigrationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "MigrationError";
    this.code = code;
    this.details = details;
  }
}

const fail = (code, message, details) => { throw new MigrationError(code, message, details); };
export const checksumSql = (source) => createHash("sha256").update(source).digest("hex");
export const migrationLockName = (database) => `jessiemessage:migrate:${checksumSql(database).slice(0, 32)}`;

// A deliberately small SQL format: one InnoDB CREATE TABLE in the selected schema,
// or the single reviewed atomic users admission CHECK replacement below.
// This is a validator, not a general SQL splitter or stored-program parser.
function migrationStatement(source) {
  let plain = "";
  let quote = null;
  let comment = null;
  let literalStart = 0;
  const literals = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (comment === "line") {
      if (char === "\n") { comment = null; plain += "\n"; }
      continue;
    }
    if (comment === "block") {
      if (char === "*" && next === "/") { comment = null; index += 1; plain += " "; }
      continue;
    }
    if (quote) {
      if (char === "\\") { index += 1; continue; }
      if (char === quote) {
        if (next === quote) { index += 1; continue; }
        literals.push(source.slice(literalStart, index + 1));
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') { quote = char; literalStart = index; plain += "?"; continue; }
    if (char === "`") fail("SQL_FORMAT", "Quoted SQL identifiers are outside the migration format.");
    if (char === "#" || (char === "-" && next === "-" && /\s/.test(source[index + 2] ?? ""))) {
      comment = "line";
      if (char === "-") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      if (source[index + 2] === "!" || /^M!/i.test(source.slice(index + 2, index + 4))) {
        fail("SQL_FORMAT", "Executable SQL comments are outside the migration format.");
      }
      comment = "block";
      index += 1;
      continue;
    }
    plain += char;
  }
  if (quote || comment === "block") fail("SQL_FORMAT", "An SQL string or comment is incomplete.");
  const statement = plain.trim().replace(/;$/, "").trim();
  if (statement.includes(";") || statement.includes(".")) {
    fail("SQL_FORMAT", "Migrations must contain one statement and no qualified identifiers.");
  }
  return { statement, literals };
}

export function validateSql(source) {
  const { statement, literals } = migrationStatement(source);
  if (/^ALTER\b/i.test(statement)) {
    // Only the exact reviewed additive reply-task migration is admitted here.
    // This does not turn the migration reader into a generic ALTER executor.
    if (checksumSql(source) === "e75f63ecc5e33271343e873aa3e8554c0c9cb22d7f1810768aa2c1488fec0b54") return source;
    // Both operations belong to one atomic MariaDB 10.11+ ALTER. No standalone
    // DROP, other table/constraint, data mutation or generic ALTER is accepted.
    const admissionCheck = /^ALTER\s+TABLE\s+users\s+DROP\s+CONSTRAINT\s+users_active_client_gates\s*,\s*ADD\s+CONSTRAINT\s+users_active_client_gates\s+CHECK\s*\(\s*role\s*<>\s*\?\s+OR\s+status\s*<>\s*\?\s+OR\s*\(\s*email_verified_at\s+IS\s+NOT\s+NULL\s+AND\s+access_approved_at\s+IS\s+NOT\s+NULL\s*\)\s*\)$/i;
    if (!admissionCheck.test(statement) || literals.length !== 2 || literals[0] !== "'client'" || literals[1] !== "'active'") {
      fail("SQL_FORMAT", "Only the reviewed atomic users admission CHECK replacement is supported as ALTER TABLE.");
    }
    return source;
  }
  const match = /^CREATE\s+TABLE\s+([a-z][a-z0-9_]*)\s*\(/i.exec(statement);
  if (!match || /\bschema_migrations\b/i.test(statement)
    || /\b(?:USE|DATABASE|DELIMITER|CALL|TRIGGER|PROCEDURE|FUNCTION|EVENT|GRANT|REVOKE|SELECT|LIKE|AS|RENAME|DIRECTORY|TABLESPACE|CONNECTION|EXCHANGE|PARTITION)\b/i.test(statement)
    || !/\)\s*ENGINE\s*=\s*InnoDB\s+DEFAULT\s+CHARACTER\s+SET\s+(?:utf8mb4|ascii)\s+COLLATE\s+(?:utf8mb4_unicode_ci|ascii_bin)$/i.test(statement)) {
    fail("SQL_FORMAT", "Only unqualified application InnoDB CREATE TABLE statements are supported.");
  }
  for (const invocation of statement.matchAll(/\b([a-z][a-z0-9_]*)\s*\(/gi)) {
    const name = invocation[1].toLowerCase();
    const preceding = statement.slice(0, invocation.index);
    const structural = /\b(?:TABLE|KEY|REFERENCES)\s*$/i.test(preceding);
    if (!structural && !["varbinary", "varchar", "char", "datetime", "current_timestamp", "check", "in", "and", "or", "not", "octet_length", "char_length", "trim", "key"].includes(name)) {
      fail("SQL_FORMAT", "Only the documented structural expressions are allowed in migrations.");
    }
  }
  return source;
}

export function validateMigrationPlan(migrations) {
  if (!Array.isArray(migrations) || !migrations.length) fail("MIGRATION_PLAN", "No migrations were found.");
  for (const [index, migration] of migrations.entries()) {
    const match = /^(\d{4})_[a-z][a-z0-9_]*\.sql$/.exec(migration.name ?? "");
    if (!match || migration.version !== index + 1 || Number(match[1]) !== migration.version) {
      fail("MIGRATION_PLAN", "Migration files must be named and numbered consecutively from 0001.");
    }
    if (typeof migration.sql !== "string" || migration.checksum !== checksumSql(migration.sql)) {
      fail("MIGRATION_PLAN", "A migration checksum does not match its source.", { version: migration.version });
    }
    validateSql(migration.sql);
  }
  return migrations;
}

export async function loadMigrations(directory = defaultMigrationDirectory) {
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const migrations = await Promise.all(files.map(async (name) => {
    const sql = await readFile(join(directory, name), "utf8");
    return { version: Number(name.slice(0, 4)), name, sql, checksum: checksumSql(sql) };
  }));
  return validateMigrationPlan(migrations);
}

// DDL migrations and application tables are separate inventories: an ALTER adds
// a ledger entry without creating a new table or changing cleanup/grant scope.
export function createdMigrationTables(migrations) {
  validateMigrationPlan(migrations);
  return migrations.flatMap(({ sql }) => {
    const { statement } = migrationStatement(sql);
    const match = /^CREATE\s+TABLE\s+([a-z][a-z0-9_]*)\s*\(/i.exec(statement);
    return match ? [match[1]] : [];
  });
}

export function inspectHistory(migrations, rows) {
  validateMigrationPlan(migrations);
  let expectedVersion = 1;
  let dirtySeen = false;
  for (const row of rows) {
    const version = Number(row.version);
    const migration = migrations[version - 1];
    if (version !== expectedVersion || !migration) {
      fail("HISTORY_DIVERGED", "The database migration history is missing or ahead of the source.", { version });
    }
    if (row.name !== migration.name || row.checksum !== migration.checksum) {
      fail("CHECKSUM_DRIFT", "A recorded migration differs from its immutable source.", { version });
    }
    if (!["running", "failed", "retry", "applied"].includes(row.state) || dirtySeen) {
      fail("HISTORY_DIVERGED", "The database migration history has an invalid order or state.", { version });
    }
    if (row.state !== "applied") dirtySeen = true;
    expectedVersion += 1;
  }
  return migrations.map((migration) => ({
    version: migration.version,
    name: migration.name,
    checksum: migration.checksum,
    state: rows[migration.version - 1]?.state ?? "pending",
    attempts: Number(rows[migration.version - 1]?.attempts ?? 0),
  }));
}

const ledgerSql = `CREATE TABLE schema_migrations (
  version INT UNSIGNED NOT NULL,
  name VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  state VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 1,
  started_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  finished_at DATETIME(6) NULL,
  error_code INT UNSIGNED NULL,
  recovered_at DATETIME(6) NULL,
  recovery_action VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (version),
  CONSTRAINT schema_migrations_version CHECK (version > 0),
  CONSTRAINT schema_migrations_state CHECK (state IN ('running', 'failed', 'retry', 'applied')),
  CONSTRAINT schema_migrations_checksum CHECK (checksum REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT schema_migrations_finished CHECK (
    (state = 'applied' AND finished_at IS NOT NULL) OR (state <> 'applied' AND finished_at IS NULL)
  ),
  CONSTRAINT schema_migrations_recovery CHECK (recovery_action IS NULL OR recovery_action IN ('retry', 'applied'))
) ENGINE=InnoDB DEFAULT CHARACTER SET ascii COLLATE ascii_bin`;

const expectedLedgerColumns = [
  ["version", "int", null, "NO", true],
  ["name", "varchar", 128, "NO"],
  ["checksum", "char", 64, "NO"],
  ["state", "varchar", 8, "NO"],
  ["attempts", "int", null, "NO", true],
  ["started_at", "datetime", null, "NO"],
  ["finished_at", "datetime", null, "YES"],
  ["error_code", "int", null, "YES", true],
  ["recovered_at", "datetime", null, "YES"],
  ["recovery_action", "varchar", 8, "YES"],
];

async function verifyLedger(connection, database) {
  const columns = await connection.query(`SELECT COLUMN_NAME AS name, DATA_TYPE AS type,
    CHARACTER_MAXIMUM_LENGTH AS size, IS_NULLABLE AS nullable, COLUMN_TYPE AS definition,
    DATETIME_PRECISION AS precision_value, COLLATION_NAME AS collation_name
    FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`, [database, ledgerTable]);
  const indexes = await connection.query(`SELECT INDEX_NAME AS name, COLUMN_NAME AS column_name
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [database, ledgerTable]);
  const checks = await connection.query(`SELECT CONSTRAINT_NAME AS name, CHECK_CLAUSE AS clause FROM information_schema.CHECK_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = ?`, [database, ledgerTable]);
  const tables = await connection.query(`SELECT ENGINE AS engine FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [database, ledgerTable]);
  const validColumns = columns.length === expectedLedgerColumns.length && columns.every((column, index) => {
    const [name, type, size, nullable, unsigned = false] = expectedLedgerColumns[index];
    return column.name === name && column.type === type && (size === null || Number(column.size) === size)
      && column.nullable === nullable && (!unsigned || /unsigned/i.test(column.definition))
      && (type !== "datetime" || Number(column.precision_value) === 6)
      && (!["char", "varchar"].includes(type) || column.collation_name === "ascii_bin");
  });
  const expectedChecks = new Map([
    ["schema_migrations_version", "version > 0"],
    ["schema_migrations_state", "state IN ('running', 'failed', 'retry', 'applied')"],
    ["schema_migrations_checksum", "checksum REGEXP '^[0-9a-f]{64}$'"],
    ["schema_migrations_finished", "(state = 'applied' AND finished_at IS NOT NULL) OR (state <> 'applied' AND finished_at IS NULL)"],
    ["schema_migrations_recovery", "recovery_action IS NULL OR recovery_action IN ('retry', 'applied')"],
  ]);
  const normalizeCheck = (clause) => clause.toLowerCase().replace(/[`\s()]/g, "");
  if (!validColumns || tables[0]?.engine !== "InnoDB" || indexes.length !== 1
    || indexes[0]?.name !== "PRIMARY" || indexes[0]?.column_name !== "version"
    || checks.length !== expectedChecks.size
    || !checks.every((check) => expectedChecks.has(check.name) && normalizeCheck(check.clause) === normalizeCheck(expectedChecks.get(check.name)))) {
    fail("LEDGER_SHAPE", "The migration ledger does not have the expected structure; inspect it before proceeding.");
  }
}

async function history(connection, database, create) {
  const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
  if (!tables.some((table) => table.name === ledgerTable)) {
    const otherObjects = await connection.query(`SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?
      UNION ALL SELECT EVENT_NAME AS name FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ?`, [database, database]);
    if (tables.length || otherObjects.length) fail("DATABASE_NOT_EMPTY", "Initialize migrations only in an empty, dedicated JessieMessage database.");
    if (!create) return [];
    await connection.query(ledgerSql);
  }
  await verifyLedger(connection, database);
  return connection.query("SELECT version, name, checksum, state, attempts FROM schema_migrations ORDER BY version");
}

async function locked(connection, database, work, lockTimeout = 0) {
  if (typeof database !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(database)) {
    fail("DATABASE_TARGET", "An explicit dedicated database name is required.");
  }
  if (!Number.isInteger(lockTimeout) || lockTimeout < 0 || lockTimeout > 30) fail("LOCK_TIMEOUT", "Lock timeout must be an integer from 0 to 30 seconds.");
  const selected = await connection.query("SELECT DATABASE() AS database_name, VERSION() AS server_version");
  if (selected[0]?.database_name !== database || !/MariaDB/i.test(selected[0]?.server_version ?? "")) {
    fail("DATABASE_TARGET", "The connection must select the explicitly confirmed MariaDB database.");
  }
  const version = /^(\d+)\.(\d+)/.exec(selected[0].server_version);
  if (!version || Number(version[1]) < 10 || (Number(version[1]) === 10 && Number(version[2]) < 11)) {
    fail("DATABASE_VERSION", "This migration foundation requires MariaDB 10.11 or later.");
  }
  await connection.query("SET SESSION time_zone = '+00:00'");
  await connection.query("SET SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
  await connection.query("SET SESSION autocommit = 1, foreign_key_checks = 1, check_constraint_checks = 1");
  const lockName = migrationLockName(database);
  const result = await connection.query("SELECT GET_LOCK(?, ?) AS acquired", [lockName, lockTimeout]);
  if (Number(result[0]?.acquired) !== 1) fail("MIGRATION_LOCKED", "Another migration operation holds the database lock.");
  let operationFailed = false;
  try {
    return await work();
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      const released = await connection.query("SELECT RELEASE_LOCK(?) AS released", [lockName]);
      if (Number(released[0]?.released) !== 1) fail("LOCK_RELEASE", "Close the dedicated migration connection: its lock could not be released.");
    } catch (error) {
      if (!operationFailed) throw error;
    }
  }
}

export async function migrationStatus(connection, { database, migrations, lockTimeout = 0 }) {
  validateMigrationPlan(migrations);
  return locked(connection, database, async () => inspectHistory(migrations, await history(connection, database, false)), lockTimeout);
}

async function writeOne(connection, sql, parameters) {
  const result = await connection.query(sql, parameters);
  if (Number(result?.affectedRows) !== 1) fail("LEDGER_WRITE", "A guarded migration ledger write did not affect exactly one row.");
}

export async function applyMigrations(connection, { database, migrations, lockTimeout = 0 }) {
  validateMigrationPlan(migrations);
  return locked(connection, database, async () => {
    const rows = await history(connection, database, true);
    const plan = inspectHistory(migrations, rows);
    const dirty = plan.find((migration) => ["running", "failed"].includes(migration.state));
    if (dirty) fail("RECOVERY_REQUIRED", "An interrupted migration requires explicit inspection and recovery.", { version: dirty.version });
    const applied = [];
    for (const migration of migrations) {
      const state = plan[migration.version - 1].state;
      if (state === "applied") continue;
      if (state === "retry") {
        await writeOne(connection, `UPDATE schema_migrations SET state = 'running', attempts = attempts + 1,
          started_at = CURRENT_TIMESTAMP(6), finished_at = NULL, error_code = NULL WHERE version = ? AND state = 'retry'`, [migration.version]);
      } else {
        // Autocommit makes this marker durable before DDL is attempted.
        await writeOne(connection, "INSERT INTO schema_migrations (version, name, checksum, state) VALUES (?, ?, ?, 'running')",
          [migration.version, migration.name, migration.checksum]);
      }
      try {
        await connection.query(migration.sql);
        await writeOne(connection, "UPDATE schema_migrations SET state = 'applied', finished_at = CURRENT_TIMESTAMP(6) WHERE version = ? AND state = 'running'", [migration.version]);
        applied.push(migration.version);
      } catch (error) {
        const errorCode = Number.isInteger(error?.errno) && error.errno > 0 ? error.errno : null;
        try {
          await connection.query("UPDATE schema_migrations SET state = 'failed', error_code = ? WHERE version = ? AND state = 'running'", [errorCode, migration.version]);
        } catch {
          // A lost connection leaves the already durable running marker intact.
        }
        fail("MIGRATION_FAILED", "Migration stopped; its DDL may already be committed. Inspect and recover before retrying.", { version: migration.version, errorCode });
      }
    }
    return { applied, unchanged: migrations.length - applied.length };
  }, lockTimeout);
}

export async function resolveMigration(connection, { database, migrations, version, checksum, outcome, reviewed, lockTimeout = 0 }) {
  validateMigrationPlan(migrations);
  if (reviewed !== true || !["applied", "retry"].includes(outcome) || !Number.isInteger(version)) {
    fail("RECOVERY_CONFIRMATION", "Recovery requires an exact version, outcome, checksum and confirmed schema inspection.");
  }
  return locked(connection, database, async () => {
    const plan = inspectHistory(migrations, await history(connection, database, false));
    const migration = plan.find((item) => item.version === version);
    if (!migration || !["running", "failed"].includes(migration.state) || migration.checksum !== checksum) {
      fail("RECOVERY_CONFIRMATION", "Recovery must name the dirty migration and its full recorded checksum.");
    }
    // This records the operator's decision. It intentionally does not execute or infer DDL.
    await writeOne(connection, `UPDATE schema_migrations SET state = ?, recovered_at = CURRENT_TIMESTAMP(6),
      recovery_action = ?, finished_at = ${outcome === "applied" ? "CURRENT_TIMESTAMP(6)" : "NULL"}
      WHERE version = ? AND state IN ('running', 'failed')`, [outcome === "applied" ? "applied" : "retry", outcome, version]);
    return { version, state: outcome === "applied" ? "applied" : "retry" };
  }, lockTimeout);
}
