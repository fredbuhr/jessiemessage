import { readFile } from "node:fs/promises";
import { checksumSql, loadMigrations, MigrationError, validateMigrationPlan } from "../db/migrations.mjs";

const CANDIDATES = Object.freeze(["0034_video_storage_state.sql", "0035_video_assets.sql", "0036_message_video.sql"]);

/** Read the complete candidate plan for isolated qualification only. The
 * ordinary migration loader still sees exactly the 33 production migrations.
 * This function executes no SQL and is not imported by the normal runtime.
 * Promotion requires the lifecycle work in lot 7.3, not an implicit append. */
export async function loadVideoMigrations() {
  const base = await loadMigrations();
  if (base.length !== 33) throw new MigrationError("MIGRATION_PLAN", "Video candidates require the unchanged 33-migration base.");
  const candidates = await Promise.all(CANDIDATES.map(async (name) => {
    const sql = await readFile(new URL(`./migrations/${name}`, import.meta.url), "utf8");
    return { version: Number(name.slice(0, 4)), name, sql, checksum: checksumSql(sql) };
  }));
  return validateMigrationPlan([...base, ...candidates]);
}
