import test from "node:test";
import assert from "node:assert/strict";
import { describeRuntimePrivileges, sanitizePrivilegeDiagnostics } from "../server/preflight/privilege-diagnostics.mjs";

const database = "fixture_private_database";
const account = "'fixture_private_account'@'fixture_private_host.invalid'";
const rights = "SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES";
const rows = (...statements) => statements.map((statement) => ({ Grants_for_fixture_private_account: statement }));
const usage = (suffix = "", identity = account) => `GRANT USAGE ON *.* TO ${identity}${suffix}`;
const grant = (scope = "`fixture\\_private\\_database`.*", privileges = rights, identity = account, suffix = "") => `GRANT ${privileges} ON ${scope} TO ${identity}${suffix}`;
const describe = (...statements) => describeRuntimePrivileges(rows(...statements), database);
const unavailable = () => describeRuntimePrivileges(undefined, database);

test("exact escaped database scope and all six observed rights have a closed metadata shape", () => {
  const result = describe(usage(), grant());
  assert.deepEqual(result, {
    available: true, statements: 2,
    rights: { select: true, insert: true, update: true, delete: true, createTemporaryTables: true, lockTables: true },
    extraRights: false, scope: "exact_literal", authentication: "none", tls: "none",
    resources: { maxUserConnections: false, maxQueriesPerHour: false, maxUpdatesPerHour: false, maxConnectionsPerHour: false, maxStatementTime: false },
    unrecognizedTail: false, delegation: false, roleOrProxy: false, unrecognizedStatements: 0,
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.rights), true);
});

test("scope diagnostics distinguish raw underscores without accepting or expanding their pattern", () => {
  for (const scope of ["`fixture_private_database`.*", "`fixture\\_private_database`.*"]) {
    assert.equal(describe(usage(), grant(scope)).scope, "unescaped_underscore");
  }
  assert.equal(describeRuntimePrivileges(rows(grant("`plainname`.*")), "plainname").scope, "exact_literal");
  assert.equal(describeRuntimePrivileges(rows(grant("plainname.*")), "plainname").scope, "exact_literal");
});

test("percent patterns, table scope and different databases remain distinct metadata", () => {
  for (const scope of ["`fixture%`.*", "`%`.*", "`other%pattern`.*"]) assert.equal(describe(grant(scope)).scope, "percent_pattern");
  assert.equal(describe(grant("`fixture_private_database`.`users`")).scope, "table_scoped");
  assert.equal(describe(grant("`other_database`.`users`")).scope, "other_scope");
  assert.equal(describe(grant("`other\\_database`.*")).scope, "other_scope");
  assert.equal(describe(grant("*.*")).scope, "other_scope");
  assert.equal(describe(usage()).scope, "unknown");
});

test("mixed object scopes use fixed categorical priority and global USAGE is ignored", () => {
  assert.equal(describe(usage(), grant(), grant("`fixture_private_database`.`users`")).scope, "table_scoped");
  assert.equal(describe(grant(), grant("`fixture_private_database`.*")).scope, "unescaped_underscore");
  assert.equal(describe(grant("`fixture%`.*"), grant("`other_database`.*")).scope, "other_scope");
});

test("observed rights are booleans and unknown or administrative rights are only an extra flag", () => {
  for (const privilege of ["CREATE", "DROP", "ALTER", "ALL PRIVILEGES", "CREATE USER", "BINLOG MONITOR"]) {
    const result = describe(grant(undefined, `SELECT, ${privilege}`));
    assert.equal(result.rights.select, true);
    assert.equal(result.rights.insert, false);
    assert.equal(result.extraRights, true);
    assert.equal(result.unrecognizedStatements, 0);
  }
  const columnGrant = describe(grant(undefined, "SELECT (`private_column`)"));
  assert.equal(columnGrant.unrecognizedStatements, 1);
  assert.equal(columnGrant.scope, "unknown");
});

test("native password material is classified and never returned", () => {
  for (const suffix of [
    " IDENTIFIED BY PASSWORD '*PRIVATE_HASH_A3F48B'",
    " IDENTIFIED VIA mysql_native_password USING '*PRIVATE_HASH_A3F48B'",
    " IDENTIFIED WITH `mysql_native_password` AS '*PRIVATE_HASH_A3F48B'",
  ]) {
    const result = describe(usage(suffix), grant());
    assert.equal(result.authentication, "native_password");
    assert.equal(result.unrecognizedTail, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_HASH_A3F48B|fixture_private|GRANT |IDENTIFIED|\.invalid/);
  }
});

test("alternative authentication methods are metadata only, including multiple plugin forms", () => {
  for (const suffix of [
    " IDENTIFIED BY 'PRIVATE_NEW_PASSWORD'",
    " IDENTIFIED VIA unix_socket",
    " IDENTIFIED WITH caching_sha2_password AS 'PRIVATE_AUTH_HASH'",
    " IDENTIFIED VIA mysql_native_password USING '*PRIVATE_HASH' OR unix_socket",
  ]) {
    const result = describe(usage(suffix));
    assert.equal(result.authentication, "alternative");
    assert.equal(result.unrecognizedTail, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_NEW_PASSWORD|PRIVATE_AUTH_HASH|PRIVATE_HASH|unix_socket|caching_sha2_password/);
  }
});

test("single quotes, doubled quotes, backticks and escaped account contents cannot forge tail metadata", () => {
  const identities = [
    "'fixture'' WITH GRANT OPTION MAX_USER_CONNECTIONS 99'@'private_host'",
    "`fixture`` REQUIRE SSL`@`private_host`",
    "'fixture\\' IDENTIFIED VIA unix_socket'@'private_host'",
    "`fixture\\` WITH ADMIN OPTION`@`private_host`",
  ];
  for (const identity of identities) {
    const result = describe(usage("", identity), grant(undefined, rights, identity));
    assert.equal(result.available, true);
    assert.equal(result.authentication, "none");
    assert.equal(result.tls, "none");
    assert.equal(result.delegation, false);
    assert.equal(result.resources.maxUserConnections, false);
    assert.equal(result.unrecognizedTail, false);
  }
});

test("SQL-like quoted authentication and TLS contents cannot forge other metadata", () => {
  const result = describe(usage(" IDENTIFIED BY PASSWORD 'WITH GRANT OPTION REQUIRE SSL MAX_USER_CONNECTIONS 9' REQUIRE SUBJECT 'MAX_QUERIES_PER_HOUR 9 WITH ADMIN OPTION'"));
  assert.equal(result.authentication, "native_password");
  assert.equal(result.tls, "other");
  assert.equal(result.delegation, false);
  assert.equal(Object.values(result.resources).some(Boolean), false);
});

test("TLS requirements are classified without certificate identities or cipher strings", () => {
  assert.equal(describe(usage(" REQUIRE NONE")).tls, "none");
  assert.equal(describe(usage(" REQUIRE SSL")).tls, "ssl");
  for (const suffix of [" REQUIRE X509", " REQUIRE CIPHER 'PRIVATE_CIPHER'", " REQUIRE SUBJECT 'PRIVATE_SUBJECT' AND ISSUER 'PRIVATE_ISSUER' CIPHER 'PRIVATE_CIPHER'"]) {
    const result = describe(usage(suffix));
    assert.equal(result.tls, "other");
    assert.equal(result.unrecognizedTail, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_CIPHER|PRIVATE_SUBJECT|PRIVATE_ISSUER/);
  }
});

test("all fixed resource names are recognized while their values remain absent", () => {
  const result = describe(usage(" IDENTIFIED BY PASSWORD '*PRIVATE_AUTH' REQUIRE SSL WITH MAX_USER_CONNECTIONS 38 MAX_QUERIES_PER_HOUR 0 MAX_UPDATES_PER_HOUR 876543210 MAX_CONNECTIONS_PER_HOUR 123456789 MAX_STATEMENT_TIME 0.000001"));
  assert.deepEqual(result.resources, { maxUserConnections: true, maxQueriesPerHour: true, maxUpdatesPerHour: true, maxConnectionsPerHour: true, maxStatementTime: true });
  assert.equal(result.authentication, "native_password");
  assert.equal(result.tls, "ssl");
  assert.equal(result.unrecognizedTail, false);
  assert.doesNotMatch(JSON.stringify(result), /38|876543210|123456789|0\.000001|PRIVATE_AUTH/);
  for (const value of ["0", "39", "2147483647", "999999999999999999999"]) {
    assert.equal(describe(usage(` WITH MAX_USER_CONNECTIONS ${value}`)).resources.maxUserConnections, true);
  }
});

test("unknown suffixes remain unknown observations and are not scanned for embedded keywords", () => {
  for (const suffix of [" PRIVATE_EXTENSION WITH GRANT OPTION MAX_USER_CONNECTIONS 38", " /* WITH GRANT OPTION */", " WITH UNKNOWN_LIMIT 8 MAX_USER_CONNECTIONS 38"]) {
    const result = describe(usage(suffix));
    assert.equal(result.unrecognizedTail, true);
    assert.equal(result.delegation, false);
    assert.equal(result.resources.maxUserConnections, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_EXTENSION|UNKNOWN_LIMIT/);
  }
  assert.equal(describe(usage(" IDENTIFIED SOMETHING_PRIVATE 'secret'")).authentication, "unknown");
  assert.equal(describe(usage(" REQUIRE PRIVATE_TLS 'secret'")).tls, "unknown");
  const incompleteTls = describe(usage(" REQUIRE SUBJECT 'PRIVATE_SUBJECT' AND"));
  assert.equal(incompleteTls.unrecognizedTail, true);
  assert.equal(incompleteTls.tls, "unknown");
});

test("delegation is reported only in parsed WITH clauses", () => {
  for (const suffix of [" WITH GRANT OPTION", " WITH MAX_USER_CONNECTIONS 38 GRANT OPTION", " WITH ADMIN OPTION"]) {
    assert.equal(describe(grant(undefined, rights, account, suffix)).delegation, true);
  }
  assert.equal(describe(grant(undefined, rights, account, " WITH MAX_USER_CONNECTIONS 'GRANT OPTION'")).delegation, false);
});

test("roles, default roles and PROXY are explicit flags without role or account names", () => {
  for (const statement of [
    `GRANT \`PRIVATE_ROLE\` TO ${account}`,
    `GRANT 'PRIVATE_ROLE', \`SECOND_PRIVATE_ROLE\` TO ${account} WITH ADMIN OPTION`,
    `GRANT PROXY ON 'PRIVATE_PROXY_USER'@'PRIVATE_PROXY_HOST' TO ${account} WITH GRANT OPTION`,
    `SET DEFAULT ROLE \`PRIVATE_ROLE\` FOR ${account}`,
  ]) {
    const result = describe(statement);
    assert.equal(result.roleOrProxy, true);
    assert.equal(result.unrecognizedStatements, 0);
    assert.equal(result.scope, "unknown");
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ROLE|SECOND_PRIVATE_ROLE|PRIVATE_PROXY_USER|PRIVATE_PROXY_HOST/);
  }
});

test("unknown statements have bounded counters and cannot pretend to be recognized grants", () => {
  const result = describe(usage(), "PRIVATE_UNKNOWN STATEMENT 'WITH GRANT OPTION'", grant());
  assert.equal(result.available, true);
  assert.equal(result.statements, 3);
  assert.equal(result.unrecognizedStatements, 1);
  assert.equal(result.scope, "unknown");
  assert.equal(result.authentication, "unknown");
  assert.equal(result.tls, "unknown");
  assert.equal(result.delegation, false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_UNKNOWN/);
  const incompleteRole = describe(`GRANT 'PRIVATE_ROLE', TO ${account}`);
  assert.equal(incompleteRole.roleOrProxy, false);
  assert.equal(incompleteRole.unrecognizedStatements, 1);
});

test("malformed row containers, values and quoted SQL fail with the same fixed unavailable DTO", () => {
  const expected = unavailable();
  const malformed = [undefined, null, {}, [], [undefined], [null], [[]], ["PRIVATE_ROW"], [{}], [{ a: usage(), b: grant() }], [{ a: 12 }], [{ a: "" }], [{ a: `${usage()}\n` }], [{ a: `${usage()}\0` }], [{ a: "GRANT USAGE ON *.* TO 'PRIVATE_UNTERMINATED" }]];
  for (const input of malformed) assert.deepEqual(describeRuntimePrivileges(input, database), expected);
  for (const name of [undefined, null, {}, "", "bad.database", "a".repeat(65)]) assert.deepEqual(describeRuntimePrivileges(rows(usage()), name), expected);
  const sparse = []; sparse.length = 1;
  assert.deepEqual(describeRuntimePrivileges(sparse, database), expected);
});

test("row, row-array and sanitizer accessors are rejected without being invoked", () => {
  let reads = 0;
  const getter = () => { reads += 1; throw new Error("PRIVATE_GETTER"); };
  const accessorRow = Object.defineProperty({}, "PRIVATE_FIELD", { enumerable: true, get: getter });
  const accessorArray = Object.defineProperty([], "0", { enumerable: true, get: getter });
  const accessorMetadata = rows(usage()); Object.defineProperty(accessorMetadata, "meta", { get: getter });
  for (const input of [[accessorRow], accessorArray, accessorMetadata]) assert.deepEqual(describeRuntimePrivileges(input, database), unavailable());
  const value = structuredClone(describe(usage(), grant()));
  Object.defineProperty(value, "authentication", { get: getter });
  assert.deepEqual(sanitizePrivilegeDiagnostics(value), unavailable());
  const nested = structuredClone(describe(usage(), grant()));
  Object.defineProperty(nested.rights, "select", { get: getter });
  assert.deepEqual(sanitizePrivilegeDiagnostics(nested), unavailable());
  assert.equal(reads, 0);
});

test("row count, individual length and total length limits are enforced before returning metadata", () => {
  assert.equal(describeRuntimePrivileges(rows(...Array(128).fill(usage())), database).statements, 128);
  assert.deepEqual(describeRuntimePrivileges(rows(...Array(129).fill(usage())), database), unavailable());
  assert.deepEqual(describeRuntimePrivileges(rows("x".repeat(16385)), database), unavailable());
  assert.deepEqual(describeRuntimePrivileges(rows(...Array(9).fill("x".repeat(16384))), database), unavailable());
  const within = describeRuntimePrivileges(rows(...Array(8).fill("x".repeat(16384))), database);
  assert.equal(within.available, true);
  assert.equal(within.unrecognizedStatements, 8);
});

test("the sanitizer reconstructs only known booleans, bounded counters and fixed enums", () => {
  const valid = structuredClone(describe(usage(), grant()));
  assert.deepEqual(sanitizePrivilegeDiagnostics(valid), valid);
  const variants = [
    { ...valid, PRIVATE_EXTRA: "PRIVATE_LEAK" },
    { ...valid, scope: "PRIVATE_DATABASE" }, { ...valid, authentication: "PRIVATE_HASH" }, { ...valid, tls: "PRIVATE_CERT" },
    { ...valid, statements: 129 }, { ...valid, statements: -1 }, { ...valid, statements: 2.5 }, { ...valid, statements: 0 },
    { ...valid, unrecognizedStatements: 3 }, { ...valid, delegation: "PRIVATE_STRING" },
    { ...valid, rights: { ...valid.rights, PRIVATE_RIGHT: true } },
    { ...valid, resources: { ...valid.resources, maxUserConnections: 38 } },
    { ...valid, available: false },
  ];
  for (const value of variants) assert.deepEqual(sanitizePrivilegeDiagnostics(value), unavailable());
  assert.deepEqual(sanitizePrivilegeDiagnostics(new Proxy({}, { ownKeys() { throw new Error("PRIVATE_PROXY"); } })), unavailable());
});

test("empty native metadata properties are never copied or traversed", () => {
  const input = rows(usage(), grant());
  input.meta = { PRIVATE_COLUMN_HOST: "PRIVATE_HASH_OR_PATH" };
  const result = describeRuntimePrivileges(input, database);
  assert.equal(result.available, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_COLUMN_HOST|PRIVATE_HASH_OR_PATH/);
});
