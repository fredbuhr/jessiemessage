import { readFile } from "node:fs/promises";
import { checksumSql, validateMigrationPlan } from "../db/migrations.mjs";
import { loadVideoMigrations } from "../video/migrations.mjs";

// Additive profile for release 1.9.0. The authored SQL33/SQL36 plans remain
// immutable and are still used to inspect historical archives and releases.
export async function loadExperienceMigrations() {
  const base = await loadVideoMigrations();
  const names = ["0037_profile_preferences.sql", "0038_reply_tracking.sql"];
  const extra = await Promise.all(names.map(async name => {
    const sql = await readFile(new URL(`./migrations/${name}`, import.meta.url), "utf8");
    return { version: Number(name.slice(0, 4)), name, sql, checksum: checksumSql(sql) };
  }));
  return validateMigrationPlan([...base, ...extra]);
}
