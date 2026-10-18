import { MigrationError, inspectHistory, validateMigrationPlan } from "../db/migrations.mjs";

const MAX_MIGRATIONS = 1000;
export class DataRollbackError extends Error {
  constructor() {
    super("Migration rollback history could not be inspected.");
    this.name = "DataRollbackError"; this.code = "DATA_ROLLBACK_INVALID";
  }
}
const fail = () => { throw new DataRollbackError(); };
function version(value) {
  if (typeof value === "bigint") return value > 0n && value <= 4294967295n ? Number(value) : null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 4294967295
    || typeof value === "string" && String(number) !== value) return null;
  return number;
}
function divergentReason(rows, migrationCount) {
  for (let index = 0; index < rows.length; index++) {
    const current = version(rows[index].version);
    if (current === null || current < index + 1) return "invalid_history";
    if (current > index + 1) return "incomplete_history";
    if (!["applied", "running", "failed", "retry"].includes(rows[index].state)) return "invalid_history";
  }
  if (rows.some((row) => row.state !== "applied")) return "incomplete_history";
  return rows.length > migrationCount ? "database_ahead" : "invalid_history";
}

/** Advisory migration-history check only. A matching ledger does not certify
 * the physical schema, configuration, keys, data formats or runtime readiness. */
export function inspectRollbackHistory(input = {}) {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some((key) => !["migrations", "rows"].includes(key))) fail();
    const { migrations, rows } = input;
    if (!Array.isArray(migrations) || migrations.length < 1 || migrations.length > MAX_MIGRATIONS
      || !Array.isArray(rows) || rows.length > MAX_MIGRATIONS) fail();
    for (const list of [migrations, rows]) for (let index = 0; index < list.length; index++) {
      if (!Object.hasOwn(list, index) || !list[index] || typeof list[index] !== "object" || Array.isArray(list[index])) fail();
    }
    const result = (reason) => Object.freeze({ codeMigrationCount: migrations.length,
      recordedMigrationCount: rows.length, canStart: reason === "matching_history", reason });
    try {
      validateMigrationPlan(migrations);
      const history = inspectHistory(migrations, rows);
      // Reject noncanonical or invalid versions even if JavaScript coercion in
      // the underlying history validator would otherwise accept an alias.
      if (rows.some((row, index) => version(row.version) !== index + 1)) return result("invalid_history");
      if (history.some((row) => ["running", "failed", "retry"].includes(row.state))) return result("incomplete_history");
      if (history.some((row) => row.state !== "applied")) return result("migrations_pending");
      return result("matching_history");
    } catch (error) {
      if (!(error instanceof MigrationError)) throw error;
      if (error.code === "CHECKSUM_DRIFT") return result("checksum_drift");
      if (error.code === "HISTORY_DIVERGED") return result(divergentReason(rows, migrations.length));
      return result("invalid_history");
    }
  } catch { fail(); }
}
