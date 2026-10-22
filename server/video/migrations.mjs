import { readFile } from "node:fs/promises";
import { checksumSql, loadMigrations, MigrationError, validateMigrationPlan } from "../db/migrations.mjs";

const CANDIDATES = Object.freeze(["0034_video_storage_state.sql", "0035_video_assets.sql", "0036_message_video.sql"]);

/** Read the explicit 36-migration video profile used since release 1.8.0.
 * The ordinary loader intentionally retains its separate 33-migration plan.
 * This function only composes and validates immutable sources; it executes no
 * SQL. The configured video runtime, migrations and prechecks select this plan
 * explicitly; importing it never upgrades a database. */
export async function loadVideoMigrations() {
  const base = await loadMigrations();
  if (base.length !== 33) throw new MigrationError("MIGRATION_PLAN", "Video candidates require the unchanged 33-migration base.");
  const candidates = await Promise.all(CANDIDATES.map(async (name) => {
    const sql = await readFile(new URL(`./migrations/${name}`, import.meta.url), "utf8");
    return { version: Number(name.slice(0, 4)), name, sql, checksum: checksumSql(sql) };
  }));
  return validateMigrationPlan([...base, ...candidates]);
}
