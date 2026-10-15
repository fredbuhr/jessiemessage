// Observation only: this module neither grants privileges nor establishes the
// complete effective privileges of an account. Never return SQL, identifiers,
// authentication material, resource values, or substrings from SHOW GRANTS.
const RIGHT_NAMES = Object.freeze({
  SELECT: "select", INSERT: "insert", UPDATE: "update", DELETE: "delete",
  "CREATE TEMPORARY TABLES": "createTemporaryTables", "LOCK TABLES": "lockTables",
});
const RESOURCE_NAMES = Object.freeze({
  MAX_USER_CONNECTIONS: "maxUserConnections", MAX_QUERIES_PER_HOUR: "maxQueriesPerHour",
  MAX_UPDATES_PER_HOUR: "maxUpdatesPerHour", MAX_CONNECTIONS_PER_HOUR: "maxConnectionsPerHour",
  MAX_STATEMENT_TIME: "maxStatementTime",
});
const SCOPES = Object.freeze(["exact_literal", "table_scoped", "unescaped_underscore", "percent_pattern", "other_scope", "unknown"]);
const AUTHENTICATION = Object.freeze(["none", "native_password", "alternative", "unknown"]);
const TLS = Object.freeze(["none", "ssl", "other", "unknown"]);
const MAX_ROWS = 128;
const MAX_LENGTH = 16384;
const MAX_TOTAL_LENGTH = 131072;
const rightKeys = Object.freeze(Object.values(RIGHT_NAMES));
const resourceKeys = Object.freeze(Object.values(RESOURCE_NAMES));
const rootKeys = Object.freeze([
  "available", "statements", "rights", "extraRights", "scope", "authentication", "tls", "resources",
  "unrecognizedTail", "delegation", "roleOrProxy", "unrecognizedStatements",
]);

const booleans = (keys) => Object.fromEntries(keys.map((key) => [key, false]));
function blank(available = false) {
  return {
    available, statements: 0, rights: booleans(rightKeys), extraRights: false,
    scope: "unknown", authentication: "unknown", tls: "unknown", resources: booleans(resourceKeys),
    unrecognizedTail: false, delegation: false, roleOrProxy: false, unrecognizedStatements: 0,
  };
}
function freeze(value) {
  Object.freeze(value.rights); Object.freeze(value.resources);
  return Object.freeze(value);
}

// Inspect data descriptors without evaluating getters, including properties
// that would otherwise be ignored by JSON serialization or Object.keys().
function record(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== keys.length || names.some((key) => typeof key !== "string" || !keys.includes(key))) throw new Error();
  const result = {};
  for (const key of keys) {
    if (!Object.hasOwn(descriptors[key], "value")) throw new Error();
    result[key] = descriptors[key].value;
  }
  return result;
}

// Reconstruct rather than spread untrusted input. This is also suitable for a
// CLI boundary receiving a substituted or mocked diagnostic implementation.
export function sanitizePrivilegeDiagnostics(value) {
  try {
    const source = record(value, rootKeys);
    const rights = record(source.rights, rightKeys);
    const resources = record(source.resources, resourceKeys);
    if (typeof source.available !== "boolean"
      || !Number.isInteger(source.statements) || source.statements < 0 || source.statements > MAX_ROWS
      || (source.available && source.statements === 0)
      || !Number.isInteger(source.unrecognizedStatements) || source.unrecognizedStatements < 0
      || source.unrecognizedStatements > source.statements
      || !SCOPES.includes(source.scope) || !AUTHENTICATION.includes(source.authentication) || !TLS.includes(source.tls)
      || ["extraRights", "unrecognizedTail", "delegation", "roleOrProxy"].some((key) => typeof source[key] !== "boolean")
      || Object.values(rights).some((item) => typeof item !== "boolean")
      || Object.values(resources).some((item) => typeof item !== "boolean")) return freeze(blank());
    if (!source.available) return freeze(blank());
    return freeze({
      available: true, statements: source.statements, rights, extraRights: source.extraRights,
      scope: source.scope, authentication: source.authentication, tls: source.tls, resources,
      unrecognizedTail: source.unrecognizedTail, delegation: source.delegation, roleOrProxy: source.roleOrProxy,
      unrecognizedStatements: source.unrecognizedStatements,
    });
  } catch { return freeze(blank()); }
}

function statementsFrom(rows) {
  if (!Array.isArray(rows)) throw new Error();
  const descriptors = Object.getOwnPropertyDescriptors(rows);
  if (Reflect.ownKeys(descriptors).some((key) => !Object.hasOwn(descriptors[key], "value"))) throw new Error();
  const length = descriptors.length?.value;
  if (!Number.isInteger(length) || length < 1 || length > MAX_ROWS) throw new Error();
  let total = 0;
  const statements = [];
  for (let index = 0; index < length; index += 1) {
    if (!Object.hasOwn(descriptors, String(index))) throw new Error();
    const row = descriptors[index].value;
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error();
    const fields = Object.getOwnPropertyDescriptors(row);
    const names = Reflect.ownKeys(fields);
    if (names.length !== 1 || typeof names[0] !== "string" || !Object.hasOwn(fields[names[0]], "value")) throw new Error();
    const statement = fields[names[0]].value;
    if (typeof statement !== "string" || statement.length === 0 || statement.length > MAX_LENGTH
      || (total += statement.length) > MAX_TOTAL_LENGTH || /[\r\n\0]/.test(statement)) throw new Error();
    statements.push(statement);
  }
  return statements;
}

function tokenize(statement) {
  const tokens = [];
  for (let position = 0; position < statement.length;) {
    const character = statement[position];
    if (/\s/.test(character)) { position += 1; continue; }
    if (character === "'" || character === '"' || character === "`") {
      const quote = character;
      let value = "", closed = false;
      position += 1;
      while (position < statement.length) {
        const next = statement[position++];
        if (next === quote) {
          if (statement[position] === quote) { value += quote; position += 1; continue; }
          closed = true; break;
        }
        if (next === "\\") {
          if (position >= statement.length) throw new Error();
          // Keep pattern escapes intact; quoted contents never become tokens.
          value += next + statement[position++];
        } else value += next;
      }
      if (!closed) throw new Error();
      tokens.push({ kind: quote === "`" ? "identifier" : "literal", value });
      continue;
    }
    const word = /^[a-zA-Z_$][a-zA-Z0-9_$]*/.exec(statement.slice(position));
    if (word) { tokens.push({ kind: "word", value: word[0].toUpperCase(), original: word[0] }); position += word[0].length; continue; }
    const number = /^[0-9]+(?:\.[0-9]+)?/.exec(statement.slice(position));
    if (number) { tokens.push({ kind: "number", value: number[0] }); position += number[0].length; continue; }
    tokens.push({ kind: "symbol", value: character }); position += 1;
  }
  return tokens;
}

const wordIs = (token, value) => token?.kind === "word" && token.value === value;
const quoted = (token) => token?.kind === "literal" || token?.kind === "identifier";
const symbolIs = (token, value) => token?.kind === "symbol" && token.value === value;
function accountEnd(tokens, index) {
  return quoted(tokens[index]) && symbolIs(tokens[index + 1], "@") && quoted(tokens[index + 2]) ? index + 3 : -1;
}

function mergeEnum(previous, next, values) {
  if (previous === next) return previous;
  if (previous === "unknown" || next === "unknown") return "unknown";
  if (previous === "none") return next;
  if (next === "none") return previous;
  // Multiple authentication methods or TLS clauses do not have a single form.
  return values === AUTHENTICATION ? "alternative" : "other";
}

function tail(tokens, start, result) {
  let index = start, authentication = "none", tls = "none";
  let seenAuthentication = false, seenTls = false, seenWith = false;
  const unknown = () => { result.unrecognizedTail = true; };
  while (index < tokens.length) {
    if (symbolIs(tokens[index], ";") && index === tokens.length - 1) { index += 1; continue; }
    if (wordIs(tokens[index], "IDENTIFIED") && !seenAuthentication && !seenTls && !seenWith) {
      seenAuthentication = true; index += 1;
      if (wordIs(tokens[index], "BY")) {
        index += 1;
        const native = wordIs(tokens[index], "PASSWORD");
        if (native) index += 1;
        if (!quoted(tokens[index])) { authentication = "unknown"; unknown(); break; }
        authentication = native ? "native_password" : "alternative"; index += 1;
      } else if (wordIs(tokens[index], "VIA") || wordIs(tokens[index], "WITH")) {
        index += 1;
        let count = 0, native = true;
        while (true) {
          const plugin = tokens[index];
          if (plugin?.kind !== "word" && plugin?.kind !== "identifier") { authentication = "unknown"; unknown(); break; }
          native &&= plugin.value.toUpperCase() === "MYSQL_NATIVE_PASSWORD";
          count += 1; index += 1;
          if (wordIs(tokens[index], "USING") || wordIs(tokens[index], "AS")) {
            index += 1;
            if (!quoted(tokens[index])) { authentication = "unknown"; unknown(); break; }
            index += 1;
          }
          if (!wordIs(tokens[index], "OR")) { authentication = native && count === 1 ? "native_password" : "alternative"; break; }
          index += 1;
        }
        if (authentication === "unknown") break;
      } else { authentication = "unknown"; unknown(); break; }
      continue;
    }
    if (wordIs(tokens[index], "REQUIRE") && !seenTls && !seenWith) {
      seenTls = true; index += 1;
      if (wordIs(tokens[index], "NONE") || wordIs(tokens[index], "SSL") || wordIs(tokens[index], "X509")) {
        tls = wordIs(tokens[index], "NONE") ? "none" : wordIs(tokens[index], "SSL") ? "ssl" : "other";
        index += 1;
      } else {
        tls = "other";
        let attributes = 0;
        while (["CIPHER", "ISSUER", "SUBJECT"].some((name) => wordIs(tokens[index], name))) {
          if (!quoted(tokens[index + 1])) { tls = "unknown"; unknown(); break; }
          index += 2; attributes += 1;
          if (wordIs(tokens[index], "AND")) {
            index += 1;
            if (!["CIPHER", "ISSUER", "SUBJECT"].some((name) => wordIs(tokens[index], name))) { tls = "unknown"; unknown(); break; }
          }
        }
        if (!attributes || tls === "unknown") { tls = "unknown"; unknown(); break; }
      }
      continue;
    }
    if (wordIs(tokens[index], "WITH") && !seenWith) {
      seenWith = true; index += 1;
      const before = index;
      while (index < tokens.length && !symbolIs(tokens[index], ";")) {
        const token = tokens[index];
        if ((wordIs(token, "GRANT") || wordIs(token, "ADMIN")) && wordIs(tokens[index + 1], "OPTION")) {
          result.delegation = true; index += 2; continue;
        }
        const resource = token?.kind === "word" && Object.hasOwn(RESOURCE_NAMES, token.value) ? RESOURCE_NAMES[token.value] : null;
        if (resource && tokens[index + 1]?.kind === "number") { result.resources[resource] = true; index += 2; continue; }
        unknown(); break;
      }
      if (index === before) unknown();
      if (result.unrecognizedTail) break;
      continue;
    }
    unknown(); break;
  }
  return { authentication, tls };
}

function scopeOf(database, table, confirmedDatabase) {
  const databaseValue = database?.kind === "identifier" ? database.value : database?.kind === "word" ? database.original : null;
  if (symbolIs(database, "*") && symbolIs(table, "*")) return "other_scope";
  if (databaseValue === null || !(symbolIs(table, "*") || table?.kind === "identifier" || table?.kind === "word")) return "unknown";
  if (!symbolIs(table, "*")) return databaseValue === confirmedDatabase ? "table_scoped" : "other_scope";
  let literal = "", underscore = false, percent = false;
  for (let index = 0; index < databaseValue.length; index += 1) {
    const character = databaseValue[index];
    if (character === "\\") {
      const escaped = databaseValue[++index];
      if (escaped !== "_" && escaped !== "%" && escaped !== "\\") return "unknown";
      literal += escaped;
    } else {
      underscore ||= character === "_"; percent ||= character === "%";
      literal += character;
    }
  }
  if (percent) return "percent_pattern";
  if (literal !== confirmedDatabase) return "other_scope";
  return underscore ? "unescaped_underscore" : "exact_literal";
}

function describeStatement(tokens, databaseName, result, observed) {
  if (wordIs(tokens[0], "SET") && wordIs(tokens[1], "DEFAULT") && wordIs(tokens[2], "ROLE")) {
    const role = tokens[3];
    if (!(quoted(role) || role?.kind === "word") || !wordIs(tokens[4], "FOR")) return false;
    const end = accountEnd(tokens, 5);
    if (end < 0) return false;
    result.roleOrProxy = true;
    const forms = tail(tokens, end, result); observed.authentication.push(forms.authentication); observed.tls.push(forms.tls);
    return true;
  }
  if (!wordIs(tokens[0], "GRANT")) return false;
  const on = tokens.findIndex((token, index) => index > 0 && wordIs(token, "ON"));
  const to = tokens.findIndex((token, index) => index > 0 && wordIs(token, "TO"));
  if (on < 0) {
    if (to < 2 || to % 2 !== 0 || !tokens.slice(1, to).every((token, index) => index % 2 === 0 ? quoted(token) || token.kind === "word" : symbolIs(token, ","))) return false;
    const end = accountEnd(tokens, to + 1);
    if (end < 0) return false;
    result.roleOrProxy = true;
    const forms = tail(tokens, end, result); observed.authentication.push(forms.authentication); observed.tls.push(forms.tls);
    return true;
  }
  if (wordIs(tokens[1], "PROXY") && on === 2) {
    const proxyEnd = accountEnd(tokens, on + 1);
    if (proxyEnd < 0 || !wordIs(tokens[proxyEnd], "TO")) return false;
    const end = accountEnd(tokens, proxyEnd + 1);
    if (end < 0) return false;
    result.roleOrProxy = true;
    const forms = tail(tokens, end, result); observed.authentication.push(forms.authentication); observed.tls.push(forms.tls);
    return true;
  }
  if (on < 2 || to !== on + 4 || !symbolIs(tokens[on + 2], ".")) return false;
  const end = accountEnd(tokens, to + 1);
  if (end < 0) return false;
  const privileges = [], pieces = [];
  for (let index = 1; index < on; index += 1) {
    if (symbolIs(tokens[index], ",")) {
      if (!pieces.length) return false;
      privileges.push(pieces.splice(0).join(" "));
    } else if (tokens[index].kind === "word") pieces.push(tokens[index].value);
    else return false;
  }
  if (!pieces.length) return false;
  privileges.push(pieces.join(" "));
  for (const privilege of privileges) {
    if (Object.hasOwn(RIGHT_NAMES, privilege)) result.rights[RIGHT_NAMES[privilege]] = true;
    else if (privilege !== "USAGE") result.extraRights = true;
  }
  // The normal global USAGE row carries authentication but no object scope.
  if (!(privileges.every((privilege) => privilege === "USAGE")
    && symbolIs(tokens[on + 1], "*") && symbolIs(tokens[on + 3], "*"))) {
    observed.scope.push(scopeOf(tokens[on + 1], tokens[on + 3], databaseName));
  }
  const forms = tail(tokens, end, result); observed.authentication.push(forms.authentication); observed.tls.push(forms.tls);
  return true;
}

export function describeRuntimePrivileges(rows, databaseName) {
  try {
    if (typeof databaseName !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(databaseName)) return freeze(blank());
    const statements = statementsFrom(rows);
    const result = blank(true);
    result.statements = statements.length;
    const observed = { scope: [], authentication: [], tls: [] };
    for (const statement of statements) {
      if (!describeStatement(tokenize(statement), databaseName, result, observed)) {
        result.unrecognizedStatements += 1;
        observed.scope.push("unknown"); observed.authentication.push("unknown"); observed.tls.push("unknown");
      }
    }
    // Mixed observations use a fixed diagnostic priority (unknown, other,
    // percent, underscore, table, exact). This is no ordering of effective
    // privilege breadth and never expands or matches a wildcard grant.
    result.scope = observed.scope.length ? observed.scope.reduce((current, next) => SCOPES.indexOf(next) > SCOPES.indexOf(current) ? next : current) : "unknown";
    result.authentication = observed.authentication.reduce((current, next) => mergeEnum(current, next, AUTHENTICATION), "none");
    result.tls = observed.tls.reduce((current, next) => mergeEnum(current, next, TLS), "none");
    return sanitizePrivilegeDiagnostics(result);
  } catch { return freeze(blank()); }
}
