const sharedRights = Object.freeze(["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE TEMPORARY TABLES", "LOCK TABLES"]);
const schemaQuery = "SELECT SCHEMA_NAME AS schema_name FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME LIMIT 3";

function arrayValues(rows, maximum) {
  if (!Array.isArray(rows)) throw new Error();
  const descriptors = Object.getOwnPropertyDescriptors(rows);
  if (Reflect.ownKeys(descriptors).some((key) => !Object.hasOwn(descriptors[key], "value"))) throw new Error();
  const length = descriptors.length?.value;
  if (!Number.isInteger(length) || length < 1 || length > maximum) throw new Error();
  const values = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(descriptors, String(index))) throw new Error();
    values.push(descriptors[index].value);
  }
  return values;
}

function field(row, expectedName) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error();
  const fields = Object.getOwnPropertyDescriptors(row);
  const names = Reflect.ownKeys(fields);
  if (names.length !== 1 || typeof names[0] !== "string" || !Object.hasOwn(fields[names[0]], "value")
    || (expectedName !== undefined && names[0] !== expectedName)) throw new Error();
  return fields[names[0]].value;
}

// A database-level name is a MariaDB pattern even inside backticks. This exact
// profile accepts only alphanumerics and escaped underscores, as before.
function exactDatabasePattern(value) {
  const plain = value.startsWith("`") ? value.slice(1, -1) : value;
  return /^(?:[a-zA-Z0-9]|\\_)+$/.test(plain) ? plain.replaceAll("\\_", "_") : null;
}

// This alternative is intentionally still a pattern. A raw underscore is never
// normalized into an exact literal grant; its current visible scope requires
// the independent inspection below, and future matching databases are unproven.
function rawDatabasePattern(value, database) {
  const plain = value.startsWith("`") ? value.slice(1, -1) : value;
  return /^[a-zA-Z0-9_]+$/.test(plain) && plain.includes("_") && plain === database;
}

export function sharedRuntimePrivileges(rows, database, { databasePattern = false } = {}) {
  try {
    if (typeof database !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(database) || typeof databasePattern !== "boolean") return false;
    const rights = new Set(); let usage = false, totalLength = 0;
    for (const row of arrayValues(rows, 128)) {
      const statement = field(row);
      if (typeof statement !== "string" || statement.length > 16384
        || (totalLength += statement.length) > 131072 || /[\r\n\0]/.test(statement)) return false;
      const grant = /^GRANT\s+([A-Z ,]+)\s+ON\s+(`[^`]+`|\*|[a-zA-Z0-9_\\]+)\.(\*)\s+TO\s+(?:'(?:[^'\\]|\\.|'')*'|`(?:[^`\\]|\\.|``)*`)@(?:'(?:[^'\\]|\\.|'')*'|`(?:[^`\\]|\\.|``)*`)(.*)$/i.exec(statement);
      if (!grant) return false;
      const privileges = grant[1].split(",").map((part) => part.trim().toUpperCase());
      if (!privileges.length || new Set(privileges).size !== privileges.length) return false;
      if (grant[2] === "*") {
        const suffix = /^(?: IDENTIFIED BY PASSWORD '[*a-fA-F0-9]+')?(?: REQUIRE SSL)?(?: WITH MAX_USER_CONNECTIONS (0|[1-9][0-9]{0,9}))?$/.exec(grant[4]);
        if (privileges.length !== 1 || privileges[0] !== "USAGE"
          || !suffix || (suffix[1] !== undefined && Number(suffix[1]) > 2147483647)) return false;
        usage = true; continue;
      }
      const matchingScope = databasePattern ? rawDatabasePattern(grant[2], database) : exactDatabasePattern(grant[2]) === database;
      if (grant[4] !== "" || !matchingScope || privileges.some((privilege) => !sharedRights.includes(privilege))) return false;
      for (const privilege of privileges) rights.add(privilege);
    }
    return usage && sharedRights.every((privilege) => rights.has(privilege));
  } catch { return false; }
}

export async function inspectSharedRuntimePatternPrivileges(connection, database) {
  try {
    if (typeof database !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(database)
      || !database.includes("_") || database === "information_schema") return false;
    const grants = await connection.query({ sql: "SHOW GRANTS FOR CURRENT_USER", timeout: 2000 });
    if (!sharedRuntimePrivileges(grants, database, { databasePattern: true })) return false;
    const rows = await connection.query({ sql: schemaQuery, timeout: 2000 });
    let selected = false, information = false;
    for (const row of arrayValues(rows, 2)) {
      const name = field(row, "schema_name");
      if (typeof name !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(name)) return false;
      if (name === database && !selected) selected = true;
      else if (name === "information_schema" && !information) information = true;
      else return false;
    }
    return selected;
  } catch { return false; }
}
