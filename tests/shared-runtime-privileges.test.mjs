import test from "node:test";
import assert from "node:assert/strict";
import { sharedRuntimePrivileges, inspectSharedRuntimePatternPrivileges } from "../server/db/shared-runtime-privileges.mjs";

const database = "fixture_private_database";
const all = "SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES";
const account = "'fixture_private_account'@'fixture_private_host'";
const usage = { private_grant_label: `GRANT USAGE ON *.* TO ${account} IDENTIFIED BY PASSWORD '*ABCD0123456789'` };
const objectGrant = (scope = "`fixture_private_database`.*", privileges = all, suffix = "") => ({
  private_grant_label: `GRANT ${privileges} ON ${scope} TO ${account}${suffix}`,
});
const grants = () => [usage, objectGrant()];
const schemas = () => [{ schema_name: "information_schema" }, { schema_name: database }];
const schemaSql = "SELECT SCHEMA_NAME AS schema_name FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME LIMIT 3";
function connectionFixture({ grantRows = grants(), schemaRows = schemas(), failAt } = {}) {
  const calls = [];
  return { calls, connection: { async query(command) {
    calls.push(command);
    if (calls.length === failAt) throw new Error("PRIVATE_DATABASE_ERROR_AND_CREDENTIALS");
    return command.sql === "SHOW GRANTS FOR CURRENT_USER" ? grantRows : schemaRows;
  } } };
}

test("the legacy shared profile still requires escaped literal scope and the pattern alternative is explicit", () => {
  assert.equal(sharedRuntimePrivileges(grants(), database), false);
  assert.equal(sharedRuntimePrivileges(grants(), database, { databasePattern: true }), true);
  const literal = [usage, objectGrant("`fixture\\_private\\_database`.*")];
  assert.equal(sharedRuntimePrivileges(literal, database), true);
  assert.equal(sharedRuntimePrivileges(literal, database, { databasePattern: true }), false);
  assert.equal(sharedRuntimePrivileges(grants(), database, { databasePattern: "true" }), false);
});

test("the pattern alternative accepts only its confirmed raw underscore token without case normalization", () => {
  for (const scope of ["fixture_private_database.*", "`fixture_private_database`.*"]) {
    assert.equal(sharedRuntimePrivileges([usage, objectGrant(scope)], database, { databasePattern: true }), true);
  }
  for (const scope of ["`fixture%`.*", "`%`.*", "`fixture\\_private_database`.*", "`fixture_private_database\\`.*", "`fixture_private_database_other`.*", "`FIXTURE_PRIVATE_DATABASE`.*", "*.*", "`fixture_private_database`.`users`", "`fixture``private_database`.*"]) {
    assert.equal(sharedRuntimePrivileges([usage, objectGrant(scope)], database, { databasePattern: true }), false);
  }
  assert.equal(sharedRuntimePrivileges([usage, objectGrant("`plainname`.*")], "plainname", { databasePattern: true }), false);
  assert.equal(sharedRuntimePrivileges(grants(), database.toUpperCase(), { databasePattern: true }), false);
});

test("pattern grants preserve the exact six-right set, native account forms and USAGE suffix rules", () => {
  const split = [usage, objectGrant(undefined, "SELECT, INSERT"), objectGrant(undefined, "UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES")];
  assert.equal(sharedRuntimePrivileges(split, database, { databasePattern: true }), true);
  const nativeQuotes = grants().map((row) => ({ grant: row.private_grant_label.replace(account, "`fixture``account`@'fixture\\'host'") }));
  nativeQuotes[0].grant += " REQUIRE SSL WITH MAX_USER_CONNECTIONS 2147483647";
  assert.equal(sharedRuntimePrivileges(nativeQuotes, database, { databasePattern: true }), true);
  const invalid = [[], [usage], [objectGrant()],
    ...all.split(", ").map((missing) => [usage, objectGrant(undefined, all.split(", ").filter((right) => right !== missing).join(", "))]),
    ...["CREATE", "ALTER", "DROP", "ALL PRIVILEGES", "USAGE", "SELECT"].map((extra) => [usage, objectGrant(undefined, `${all}, ${extra}`)]),
    ...[" WITH GRANT OPTION", " WITH MAX_USER_CONNECTIONS 3", " REQUIRE SSL", ";", "\n"].map((suffix) => [usage, objectGrant(undefined, all, suffix)]),
    [...grants(), { grant: `GRANT \`PRIVATE_ROLE\` TO ${account}` }],
    [...grants(), { grant: `GRANT PROXY ON 'PRIVATE_OTHER'@'%' TO ${account}` }],
    [{ grant: `${usage.private_grant_label} WITH GRANT OPTION` }, objectGrant()],
    [{ grant: `${usage.private_grant_label} WITH MAX_QUERIES_PER_HOUR 0` }, objectGrant()],
  ];
  for (const input of invalid) assert.equal(sharedRuntimePrivileges(input, database, { databasePattern: true }), false);
});

test("the scope inspection uses fixed timeout queries and requires the selected namespace exactly once", async () => {
  for (const schemaRows of [schemas(), [{ schema_name: database }], schemas().reverse()]) {
    const fixture = connectionFixture({ schemaRows });
    assert.equal(await inspectSharedRuntimePatternPrivileges(fixture.connection, database), true);
    assert.deepEqual(fixture.calls, [
      { sql: "SHOW GRANTS FOR CURRENT_USER", timeout: 2000 }, { sql: schemaSql, timeout: 2000 },
    ]);
    assert.doesNotMatch(JSON.stringify(fixture.calls), /fixture_private|ABCD0123456789/);
  }
});

test("any other currently visible namespace, duplicate or missing target blocks the scope inspection", async () => {
  const invalid = [[], [{ schema_name: "information_schema" }], [{ schema_name: "PRIVATE_OTHER_DATABASE" }],
    [...schemas(), { schema_name: "PRIVATE_OTHER_DATABASE" }],
    [{ schema_name: database }, { schema_name: "fixtureXprivate_database" }],
    [{ schema_name: database }, { schema_name: "fixture_privateXdatabase" }],
    [{ schema_name: database }, { schema_name: "mysql" }],
    [{ schema_name: database }, { schema_name: "performance_schema" }],
    [{ schema_name: database }, { schema_name: database }],
    [{ schema_name: "information_schema" }, { schema_name: "information_schema" }],
    [{ schema_name: database.toUpperCase() }],
  ];
  for (const schemaRows of invalid) {
    const fixture = connectionFixture({ schemaRows });
    assert.equal(await inspectSharedRuntimePatternPrivileges(fixture.connection, database), false);
  }
});

test("malformed schema rows, wrong aliases and out-of-bound strings fail without exposing values", async () => {
  const invalid = [null, {}, [null], [[]], ["PRIVATE_ROW"], [{}], [{ SCHEMA_NAME: database }],
    [{ schema_name: database, private_value: "PRIVATE_CREDENTIALS" }], [{ schema_name: undefined }],
    [{ schema_name: 42 }], [{ schema_name: "a".repeat(65) }], [{ schema_name: `${database}\0` }],
  ];
  const sparse = []; sparse.length = 1; invalid.push(sparse);
  for (const schemaRows of invalid) {
    const fixture = connectionFixture({ schemaRows });
    const result = await inspectSharedRuntimePatternPrivileges(fixture.connection, database);
    assert.equal(result, false);
    assert.equal(JSON.stringify(result), "false");
  }
});

test("grant and schema row accessors are rejected without being evaluated", async () => {
  let reads = 0;
  const getter = () => { reads += 1; throw new Error("PRIVATE_GETTER"); };
  const grantRow = Object.defineProperty({}, "private_grant", { get: getter, enumerable: true });
  assert.equal(sharedRuntimePrivileges([grantRow], database, { databasePattern: true }), false);
  const schemaRow = Object.defineProperty({}, "schema_name", { get: getter, enumerable: true });
  const accessorArray = Object.defineProperty([], "0", { get: getter, enumerable: true });
  const extraAccessor = schemas(); Object.defineProperty(extraAccessor, "private_metadata", { get: getter });
  for (const schemaRows of [[schemaRow], accessorArray, extraAccessor]) {
    const fixture = connectionFixture({ schemaRows });
    assert.equal(await inspectSharedRuntimePatternPrivileges(fixture.connection, database), false);
  }
  assert.equal(reads, 0);
});

test("grant limits reject malformed, excessive and oversized evidence before schema enumeration", async () => {
  const hugeUsage = { grant: `GRANT USAGE ON *.* TO '${"a".repeat(15000)}'@'host'` };
  for (const grantRows of [undefined, {}, [], [null], [{ a: usage.private_grant_label, b: "PRIVATE_EXTRA" }],
    [{ grant: "x".repeat(16385) }], Array(129).fill(usage), [...Array(9).fill(hugeUsage), objectGrant()]]) {
    const fixture = connectionFixture({ grantRows: grantRows === undefined ? null : grantRows });
    assert.equal(await inspectSharedRuntimePatternPrivileges(fixture.connection, database), false);
    assert.equal(fixture.calls.length, 1);
  }
  assert.equal(sharedRuntimePrivileges([...Array(127).fill(usage), objectGrant()], database, { databasePattern: true }), true);
});

test("invalid target names and system metadata targets fail before any database access", async () => {
  for (const name of [undefined, null, "", "plainname", "information_schema", "private.database", "a_".repeat(33)]) {
    const fixture = connectionFixture();
    assert.equal(await inspectSharedRuntimePatternPrivileges(fixture.connection, name), false);
    assert.deepEqual(fixture.calls, []);
  }
});

test("SQL failures are neutral booleans and an unsafe grant stops schema enumeration", async () => {
  for (const failAt of [1, 2]) {
    const fixture = connectionFixture({ failAt });
    assert.equal(await inspectSharedRuntimePatternPrivileges(fixture.connection, database), false);
    assert.equal(fixture.calls.length, failAt);
  }
  const unsafe = connectionFixture({ grantRows: [...grants(), objectGrant("`PRIVATE_OTHER_DATABASE`.*", "SELECT")] });
  assert.equal(await inspectSharedRuntimePatternPrivileges(unsafe.connection, database), false);
  assert.equal(unsafe.calls.length, 1);
});

test("an earlier successful observation does not approve a future matching database", async () => {
  const first = connectionFixture();
  assert.equal(await inspectSharedRuntimePatternPrivileges(first.connection, database), true);
  const later = connectionFixture({ schemaRows: [{ schema_name: database }, { schema_name: "fixture_privateXdatabase" }] });
  assert.equal(await inspectSharedRuntimePatternPrivileges(later.connection, database), false);
});
