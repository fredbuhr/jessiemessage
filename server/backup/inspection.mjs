import { createRuntimePool } from "../db/runtime.mjs";

export class BackupInspectionError extends Error {
  constructor() { super("Private backup schema inspection is unavailable."); this.name = "BackupInspectionError"; this.code = "BACKUP_INSPECTION_CONFIG"; }
}
const fail = () => { throw new BackupInspectionError(); };

/** Explicit offline inspection identity. No mutation method is exposed and
 * every statement issued through this pool is restricted to metadata reads.
 * Scoped ALL is required for complete executable-object inspection; DML-only
 * identities can expose partial metadata. No grant is created by this command. */
export async function createBackupInspectionPool(env = process.env) {
  const user = env.JESSIEMESSAGE_BACKUP_SCHEMA_USER, password = env.JESSIEMESSAGE_BACKUP_SCHEMA_PASSWORD;
  if (typeof user !== "string" || !user.length || user === env.JESSIEMESSAGE_RUNTIME_DB_USER || typeof password !== "string" || !password.length) fail();
  let pool;
  try {
    const inspectionEnv = { ...env, JESSIEMESSAGE_RUNTIME_DB_USER: user, JESSIEMESSAGE_RUNTIME_DB_PASSWORD: password, JESSIEMESSAGE_DB_USER: undefined };
    // The application profile restricts its own six-rights identity on every
    // acquisition. Inspection instead proves direct, exact-schema ALL below;
    // inheriting the application profile would reject that separate identity.
    delete inspectionEnv.JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE;
    pool = await createRuntimePool(inspectionEnv);
  } catch { fail(); }
  return Object.freeze({
    async getConnection() {
      const connection = await pool.getConnection();
      return Object.freeze({
        query(sql, parameters) {
          if (typeof sql !== "string" || !/^(?:SELECT\s|SHOW GRANTS(?:\s|$))/.test(sql.trim()) || /\b(?:INTO|OUTFILE|DUMPFILE|FOR\s+UPDATE|LOCK\s+IN\s+SHARE)\b/i.test(sql)) fail();
          return connection.query(sql, parameters);
        },
        release: () => connection.release(),
      });
    },
    end: () => pool.end(),
  });
}

/** Require direct, schema-scoped privileges, avoiding hidden metadata under
 * DML-only users, inactive roles, wildcard databases or a global root grant. */
export async function assertBackupInspection(connection, database) {
  if (typeof database !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(database)) fail();
  const name = (await connection.query("SELECT DATABASE() AS name"))[0]?.name;
  if (name !== database) fail();
  const grants = await connection.query("SHOW GRANTS");
  const escaped = database.replaceAll("_", "\\_");
  if (!Array.isArray(grants) || !grants.some((row) => Object.values(row).some((value) => {
    if (typeof value !== "string") return false;
    const grant = /^GRANT ALL PRIVILEGES ON `([^`]+)`\.\* TO /i.exec(value);
    return grant !== null && grant[1] === escaped;
  }))) fail();
  for (const [view, column] of [["TRIGGERS", "TRIGGER_SCHEMA"], ["EVENTS", "EVENT_SCHEMA"], ["ROUTINES", "ROUTINE_SCHEMA"]]) {
    const rows = await connection.query(`SELECT COUNT(*) AS value FROM information_schema.${view} WHERE ${column} = ?`, [database]);
    if (Number(rows[0]?.value) !== 0) fail();
  }
  return true;
}
