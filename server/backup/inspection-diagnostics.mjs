import { assertBackupInspection, BackupInspectionError } from "./inspection.mjs";

const ADMIN_RIGHTS = Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE TEMPORARY TABLES", "LOCK TABLES",
  "CREATE", "DROP", "INDEX", "ALTER", "CREATE VIEW", "SHOW VIEW", "REFERENCES"]);
const MAX_ROWS = 128, MAX_LENGTH = 16384, MAX_TOTAL = 131072;
const rank = Object.freeze({ missing: 0, other: 1, raw_underscore_pattern: 2, exact: 3 });
const result = (databaseMatched, scope = "missing", privilegeProfile = "insufficient", metadataVisibility = "unproven",
  objectInventory = "unproven", captureAllowed = false) => Object.freeze({
  databaseMatched, scope, privilegeProfile, metadataVisibility, objectInventory, captureAllowed,
});

// Inspect descriptors so malformed rows cannot invoke accessors or leak values
// through an error. Only fixed categories leave this module.
function values(rows, maximum) {
  if (!Array.isArray(rows)) throw new Error();
  const descriptors = Object.getOwnPropertyDescriptors(rows), length = descriptors.length?.value;
  // MariaDB attaches its column metadata as a data property on SELECT results.
  // Permit that one driver field without traversing or returning its contents.
  const meta = descriptors.meta;
  if (meta && (!Object.hasOwn(meta, "value") || !Array.isArray(meta.value))) throw new Error();
  if (!Number.isInteger(length) || length < 0 || length > maximum
    || Reflect.ownKeys(descriptors).length !== length + 1 + (meta ? 1 : 0)) throw new Error();
  const items = [];
  for (let index = 0; index < length; index += 1) {
    const property = descriptors[String(index)];
    if (!property || !Object.hasOwn(property, "value")) throw new Error();
    items.push(property.value);
  }
  return items;
}
function field(row, expected) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error();
  const descriptors = Object.getOwnPropertyDescriptors(row), names = Reflect.ownKeys(descriptors);
  if (names.length !== 1 || typeof names[0] !== "string" || (expected !== undefined && names[0] !== expected)
    || !Object.hasOwn(descriptors[names[0]], "value")) throw new Error();
  return descriptors[names[0]].value;
}
function statements(rows) {
  let total = 0;
  return values(rows, MAX_ROWS).map(row => {
    const value = field(row);
    if (typeof value !== "string" || !value.length || value.length > MAX_LENGTH || (total += value.length) > MAX_TOTAL
      || /[\r\n\0]/.test(value)) throw new Error();
    return value;
  });
}
function parseGrant(statement) {
  const grant = /^GRANT\s+([A-Z ,]+)\s+ON\s+(`[^`]+`|\*|[a-zA-Z0-9_\\]+)\.(\*|`[^`]+`|[a-zA-Z0-9_]+)\s+TO\s+(?:'(?:[^'\\]|\\.|'')*'|`(?:[^`\\]|\\.|``)*`)@(?:'(?:[^'\\]|\\.|'')*'|`(?:[^`\\]|\\.|``)*`)(.*)$/i.exec(statement);
  if (!grant) throw new Error();
  const rights = grant[1].split(",").map(value => value.trim().toUpperCase());
  if (rights.some(value => !value) || new Set(rights).size !== rights.length) throw new Error();
  if (grant[2] === "*" && grant[3] === "*") {
    // SHOW GRANTS may attach authentication and a connection limit to USAGE.
    // They are recognized in memory and are never returned or logged.
    const tail = /^(?: IDENTIFIED BY PASSWORD '[*a-fA-F0-9]+')?(?: REQUIRE SSL)?(?: WITH MAX_USER_CONNECTIONS (0|[1-9][0-9]{0,9}))?$/.exec(grant[4]);
    if (rights.length !== 1 || rights[0] !== "USAGE" || !tail
      || (tail[1] !== undefined && Number(tail[1]) > 2147483647)) throw new Error();
    return { usage: true };
  }
  if (grant[4] !== "" || grant[2] === "*") throw new Error();
  return { usage: false, database: grant[2].startsWith("`") ? grant[2].slice(1, -1) : grant[2], table: grant[3], rights };
}
function scopeOf(grant, database) {
  if (grant.table !== "*") return "other";
  if (grant.database === database.replaceAll("_", "\\_")) return "exact";
  if (database.includes("_") && grant.database === database) return "raw_underscore_pattern";
  return "other";
}

/** Observation only. A shared-admin grant cannot prove that zero visible
 * triggers, events or routines means none exist, so their inventories are not
 * queried. This result never replaces assertBackupInspection during capture. */
export async function diagnoseBackupInspection(connection, database) {
  if (typeof database !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(database)
    || typeof connection?.query !== "function") throw new BackupInspectionError();
  // Query errors propagate for the CLI's closed error mapping. They never
  // become a property of the diagnostic result.
  const selected = await connection.query("SELECT DATABASE() AS name");
  const rows = await connection.query("SHOW GRANTS");
  let databaseMatched = false;
  try { const names = values(selected, 1); databaseMatched = names.length === 1 && field(names[0], "name") === database; }
  catch { /* An invalid selected-database response proves no match. */ }
  let grants;
  try { grants = statements(rows).map(parseGrant); }
  catch { return result(databaseMatched, "other"); }
  let scope = "missing";
  for (const grant of grants) if (!grant.usage) {
    const observed = scopeOf(grant, database);
    if (rank[observed] > rank[scope]) scope = observed;
  }
  const relevant = grants.filter(grant => !grant.usage && scopeOf(grant, database) === scope && scope !== "other");
  const all = relevant.some(grant => grant.rights.length === 1 && grant.rights[0] === "ALL PRIVILEGES");
  const rights = new Set(relevant.flatMap(grant => grant.rights));
  const privilegeProfile = all ? "schema_all" : ADMIN_RIGHTS.every(right => rights.has(right))
    && rights.size === ADMIN_RIGHTS.length ? "shared_admin" : "insufficient";
  if (!databaseMatched || scope !== "exact" || privilegeProfile !== "schema_all") return result(databaseMatched, scope, privilegeProfile);
  try {
    await assertBackupInspection(connection, database);
    return result(true, scope, privilegeProfile, "complete", "absent", true);
  } catch (error) {
    if (!(error instanceof BackupInspectionError)) throw error;
    return result(true, scope, privilegeProfile, "unproven", "present_or_unverified");
  }
}
