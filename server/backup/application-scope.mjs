import { createRuntimePool } from "../db/runtime.mjs";
import { createdMigrationTables, loadMigrations } from "../db/migrations.mjs";

export class ApplicationBackupScopeError extends Error {
  constructor() {
    super("Private application backup coverage could not be verified.");
    this.name = "ApplicationBackupScopeError"; this.code = "BACKUP_APPLICATION_SCOPE";
  }
}
const fail = () => { throw new ApplicationBackupScopeError(); };

// This is deliberately weaker than complete-schema inspection: executable
// objects are excluded, and no claim is made about their visible inventory.
export const APPLICATION_COVERAGE = Object.freeze({ scope: "application-tables", tables: 33, encryptedMedia: true,
  executableObjects: "excluded", executableInventory: "unproven", completeDatabase: false });

export function validateApplicationCoverage(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
    const fields = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(fields);
    if (names.length !== Object.keys(APPLICATION_COVERAGE).length || names.some(name => typeof name !== "string"
      || !Object.hasOwn(APPLICATION_COVERAGE, name) || !fields[name].enumerable
      || !Object.hasOwn(fields[name], "value") || (name === "tables" ? ![30, 31, 32, 33].includes(fields[name].value) : fields[name].value !== APPLICATION_COVERAGE[name]))) fail();
    // Archived authenticated coverage retains its original table count.
    return { ...APPLICATION_COVERAGE, tables: fields.tables.value };
  } catch { fail(); }
}

/** A separate metadata-read facade over the existing runtime identity. Its
 * connection-acquisition privilege guard is retained without any overrides. */
export async function createApplicationInspectionPool(env = process.env, { createPool } = {}) {
  const pool = await createRuntimePool(env, { createPool });
  return Object.freeze({
    async getConnection() {
      const connection = await pool.getConnection();
      return Object.freeze({
        query(sql, parameters) {
          if (typeof sql !== "string" || !/^(?:SELECT\s|SHOW GRANTS(?:\s+FOR\s+CURRENT_USER(?:\(\))?)?\s*$)/i.test(sql.trim())
            || /\b(?:INTO|OUTFILE|DUMPFILE|FOR\s+UPDATE|LOCK\s+IN\s+SHARE)\b/i.test(sql)) fail();
          return connection.query(sql, parameters);
        },
        release: () => connection.release(),
      });
    },
    end: () => pool.end(),
  });
}

function dataField(row, name) {
  if (!row || typeof row !== "object" || Array.isArray(row)) fail();
  const descriptor = Object.getOwnPropertyDescriptor(row, name);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
  return descriptor.value;
}
function rowValues(rows, count) {
  if (!Array.isArray(rows) || rows.length !== count) fail();
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(rows, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
    result.push(descriptor.value);
  }
  return result;
}

/** Inspect exactly the application's thirty-three physical InnoDB tables. This
 * intentionally does not query triggers, events or routines. */
export async function assertApplicationTableInspection(connection, database) {
  try {
    if (typeof connection?.query !== "function" || typeof database !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(database)) fail();
    const identity = rowValues(await connection.query("SELECT DATABASE() AS name"), 1);
    if (dataField(identity[0], "name") !== database) fail();
    const migrations = await loadMigrations(), names = [...createdMigrationTables(migrations), "schema_migrations"].sort();
    if (migrations.length !== 33 || names.length !== 33 || new Set(names).size !== 33) fail();
    const tables = rowValues(await connection.query("SELECT TABLE_NAME AS name, TABLE_TYPE AS kind, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME LIMIT 34", [database]), 33);
    const actual = tables.map(row => {
      if (dataField(row, "kind") !== "BASE TABLE" || dataField(row, "engine") !== "InnoDB") fail();
      return dataField(row, "name");
    });
    if (actual.some(name => typeof name !== "string") || JSON.stringify(actual.sort()) !== JSON.stringify(names)) fail();
    return true;
  } catch { fail(); }
}
