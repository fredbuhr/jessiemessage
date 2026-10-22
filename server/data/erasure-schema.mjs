import { createdMigrationTables, loadMigrations, migrationStatus, validateMigrationPlan } from "../db/migrations.mjs";
import { failErasure } from "./erasure-state.mjs";

/** Fail closed on an unknown table/dependency graph. Never disable constraints. */
export async function assertErasureSchema(connection, database, { candidateMigrations } = {}) {
  const base = await loadMigrations(), candidate = candidateMigrations !== undefined;
  const migrations = candidate ? validateMigrationPlan(candidateMigrations) : base, tables = createdMigrationTables(migrations);
  if (candidate) {
    // Only this explicit dormant mode reads video sources. A caller-supplied
    // plan with the same filenames/graph cannot replace the authored bytes.
    const authored = await (await import("../video/migrations.mjs")).loadVideoMigrations();
    if (migrations.length !== authored.length || migrations.some((row, index) => row.version !== authored[index].version
      || row.name !== authored[index].name || row.checksum !== authored[index].checksum || row.sql !== authored[index].sql))
      failErasure("ERASURE_SCHEMA");
  }
  if (base.length !== 33 || migrations.length !== (candidate ? 36 : 33) || tables.length !== (candidate ? 35 : 32)
    || candidate && (migrations.slice(0, 33).some((row, index) => row.version !== base[index].version
      || row.name !== base[index].name || row.checksum !== base[index].checksum || row.sql !== base[index].sql)
      || migrations.slice(33).some((row, index) => row.name !== ["0034_video_storage_state.sql", "0035_video_assets.sql", "0036_message_video.sql"][index])))
    failErasure("ERASURE_SCHEMA");
  const history = await migrationStatus(connection, { database, migrations });
  if (history.length !== migrations.length || history.some(row => row.state !== "applied")) failErasure("ERASURE_SCHEMA");
  const enforcement = (await connection.query("SELECT @@SESSION.foreign_key_checks AS foreignKeys, @@SESSION.check_constraint_checks AS checks"))[0];
  if (Number(enforcement?.foreignKeys) !== 1 || Number(enforcement?.checks) !== 1) failErasure("ERASURE_SCHEMA");
  const actual = await connection.query("SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database]);
  const names = [...tables, "schema_migrations"].sort();
  if (actual.length !== names.length || actual.some(row => row.engine !== "InnoDB")
    || JSON.stringify(actual.map(row => row.name).sort()) !== JSON.stringify(names)) failErasure("ERASURE_SCHEMA");
  const expected = [];
  for (const migration of migrations) {
    const table = /^\s*CREATE TABLE ([a-z_]+)/i.exec(migration.sql)?.[1];
    if (!table) continue;
    for (const match of migration.sql.matchAll(/CONSTRAINT\s+([a-z0-9_]+)\s+FOREIGN KEY\s*\(([^)]+)\)\s+REFERENCES\s+([a-z0-9_]+)\s*\(([^)]+)\)\s+ON UPDATE RESTRICT ON DELETE RESTRICT/gi)) {
      const children = match[2].split(",").map(x => x.trim()), parents = match[4].split(",").map(x => x.trim());
      children.forEach((column, index) => expected.push([table, match[1], index + 1, column, database, match[3], parents[index]]));
    }
  }
  const foreignCount = candidate ? 49 : 46;
  if (new Set(expected.map(row => row[1])).size !== foreignCount) failErasure("ERASURE_SCHEMA");
  const keys = await connection.query(`SELECT TABLE_NAME AS child, CONSTRAINT_NAME AS name, ORDINAL_POSITION AS positionValue,
    COLUMN_NAME AS columnName, REFERENCED_TABLE_SCHEMA AS parentSchema, REFERENCED_TABLE_NAME AS parent, REFERENCED_COLUMN_NAME AS parentColumn
    FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`, [database]);
  const canonical = rows => rows.map(row => JSON.stringify(row)).sort().join("\n");
  if (canonical(keys.map(row => [row.child, row.name, Number(row.positionValue), row.columnName, row.parentSchema, row.parent, row.parentColumn])) !== canonical(expected)) failErasure("ERASURE_SCHEMA");
  const rules = await connection.query("SELECT CONSTRAINT_NAME AS name, UPDATE_RULE AS updateRule, DELETE_RULE AS deleteRule FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?", [database]);
  if (rules.length !== foreignCount || rules.some(row => row.updateRule !== "RESTRICT" || row.deleteRule !== "RESTRICT")) failErasure("ERASURE_SCHEMA");
  const triggers = await connection.query("SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ?", [database]);
  if (triggers.length) failErasure("ERASURE_SCHEMA");
}
