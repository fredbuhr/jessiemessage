import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseBackupInspection } from "../server/backup/inspection-diagnostics.mjs";

const database = "synthetic_checkpoint";
const escaped = "synthetic\\_checkpoint";
const admin = "SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES, CREATE, DROP, INDEX, ALTER, CREATE VIEW, SHOW VIEW, REFERENCES";
const usage = "GRANT USAGE ON *.* TO `synthetic_inspector`@`%` IDENTIFIED BY PASSWORD '*ABC123' WITH MAX_USER_CONNECTIONS 20";
const grant = (rights, name = escaped, table = "*") => `GRANT ${rights} ON \`${name}\`.${table} TO \`synthetic_inspector\`@\`%\``;
const expected = (changes = {}) => ({ databaseMatched: true, scope: "exact", privilegeProfile: "insufficient",
  metadataVisibility: "unproven", objectInventory: "unproven", captureAllowed: false, ...changes });
function fixture({ name = database, grants = [usage, grant(admin)], counts = {}, queryError } = {}) {
  const queries = [];
  return { queries, connection: { async query(sql, parameters) {
    queries.push({ sql, parameters });
    if (queryError?.(sql)) throw queryError(sql);
    if (sql === "SELECT DATABASE() AS name") return [{ name }];
    if (sql === "SHOW GRANTS") return Array.isArray(grants) ? grants.map(value => typeof value === "string" ? { grant: value } : value) : grants;
    const view = /information_schema\.([A-Z]+)/.exec(sql)?.[1];
    if (view) return [{ value: counts[view] ?? 0 }];
    throw new Error("Unexpected synthetic query");
  } } };
}

test("shared administrator is observed without claiming visibility or reading filtered inventories", async () => {
  for (const [name, scope] of [[escaped, "exact"], [database, "raw_underscore_pattern"]]) {
    const f = fixture({ grants: [usage, grant(admin, name)] });
    const observed = await diagnoseBackupInspection(f.connection, database);
    assert.deepEqual(observed, expected({ scope, privilegeProfile: "shared_admin" }));
    assert.equal(Object.isFrozen(observed), true);
    assert.deepEqual(f.queries.map(query => query.sql), ["SELECT DATABASE() AS name", "SHOW GRANTS"]);
    for (const sensitive of [database, "synthetic_inspector", "ABC123", "GRANT", "20"]) assert.ok(!JSON.stringify(observed).includes(sensitive));
  }
});
test("real MariaDB-style result metadata is ignored without traversing column definitions", async () => {
  let metadataReads = 0;
  const column = {};
  Object.defineProperty(column, "name", { get() { metadataReads += 1; throw new Error("Metadata traversed"); } });
  for (const enumerable of [false, true]) {
    const f = fixture(), query = f.connection.query;
    f.connection.query = async (sql, parameters) => {
      const rows = await query(sql, parameters);
      Object.defineProperty(rows, "meta", { value: [column], writable: true, enumerable });
      return rows;
    };
    assert.deepEqual(await diagnoseBackupInspection(f.connection, database), expected({ privilegeProfile: "shared_admin" }));
  }
  assert.equal(metadataReads, 0);
});
test("other visible database grants do not masquerade as the source grant or require namespace enumeration", async () => {
  const f = fixture({ grants: [usage, grant(admin, database), ...["synthetic_clone_one", "synthetic_clone_two", "synthetic_clone_three"].map(name => grant(admin, name))] });
  assert.deepEqual(await diagnoseBackupInspection(f.connection, database), expected({ scope: "raw_underscore_pattern", privilegeProfile: "shared_admin" }));
  assert.equal(f.queries.length, 2);
});
test("exact ALL retains the existing gate and only then reports absent objects and capture eligibility", async () => {
  const f = fixture({ grants: [usage, grant("ALL PRIVILEGES")] });
  assert.deepEqual(await diagnoseBackupInspection(f.connection, database), expected({ privilegeProfile: "schema_all", metadataVisibility: "complete", objectInventory: "absent", captureAllowed: true }));
  assert.equal(f.queries.length, 7);
  assert.ok(f.queries.every(query => /^(?:SELECT\s|SHOW GRANTS$)/.test(query.sql)));
  assert.deepEqual(f.queries.filter(query => query.parameters).map(query => query.parameters), [[database], [database], [database]]);
});
test("a raw underscore ALL is a pattern and never triggers object inspection or permission to capture", async () => {
  const f = fixture({ grants: [usage, grant("ALL PRIVILEGES", database)] });
  assert.deepEqual(await diagnoseBackupInspection(f.connection, database), expected({ scope: "raw_underscore_pattern", privilegeProfile: "schema_all" }));
  assert.equal(f.queries.length, 2);
});
test("objects or a failed exact-schema proof retain a closed result", async () => {
  for (const view of ["TRIGGERS", "EVENTS", "ROUTINES"]) {
    const f = fixture({ grants: [usage, grant("ALL PRIVILEGES")], counts: { [view]: 1 } });
    assert.deepEqual(await diagnoseBackupInspection(f.connection, database), expected({ privilegeProfile: "schema_all", objectInventory: "present_or_unverified" }));
  }
});
test("the selected database must match before any object inventory can be queried", async () => {
  const f = fixture({ name: "synthetic_other", grants: [usage, grant("ALL PRIVILEGES")] });
  assert.deepEqual(await diagnoseBackupInspection(f.connection, database), expected({ databaseMatched: false, privilegeProfile: "schema_all" }));
  assert.equal(f.queries.length, 2);
});
test("a more specific limited exact grant is not upgraded by ALL on an underscore pattern", async () => {
  const f = fixture({ grants: [usage, grant("ALL PRIVILEGES", database), grant("SELECT")] });
  assert.deepEqual(await diagnoseBackupInspection(f.connection, database), expected());
  assert.equal(f.queries.length, 2);
});
test("missing and unrelated or table-scoped rights are classified without reading inventory", async () => {
  for (const [grants, scope] of [[[usage], "missing"], [[], "missing"], [[grant(admin, "synthetic_other")], "other"],
    [[grant(admin, escaped, "`synthetic_table`")], "other"], [[grant("SELECT")], "exact"],
    [[grant(admin.replace(", REFERENCES", ""))], "exact"]]) {
    const f = fixture({ grants });
    assert.deepEqual(await diagnoseBackupInspection(f.connection, database), expected({ scope }));
    assert.equal(f.queries.length, 2);
  }
});
test("global rights, roles, delegation, unexpected tails and malformed grant structures fail closed", async () => {
  const accessor = {};
  Object.defineProperty(accessor, "grant", { enumerable: true, get() { throw new Error("Accessor evaluated"); } });
  const cases = [["GRANT ALL PRIVILEGES ON *.* TO `synthetic_inspector`@`%`"], [grant("ALL PRIVILEGES"), "GRANT `synthetic_role` TO `synthetic_inspector`@`%`"],
    [grant("ALL PRIVILEGES") + " WITH GRANT OPTION"], [grant(admin) + " REQUIRE SSL"], [grant("SELECT, SELECT")],
    [grant(admin) + "\n"], [accessor], [{ a: usage, b: grant(admin) }], [{ grant: null }], {}, Array(129).fill(usage),
    ["x".repeat(16385)], Array(9).fill("x".repeat(16384))];
  for (const grants of cases) {
    const f = fixture({ grants });
    assert.deepEqual(await diagnoseBackupInspection(f.connection, database), expected({ scope: "other" }));
    assert.equal(f.queries.length, 2);
  }
});
test("database-result accessors and unexpected shapes are never accepted as a database match", async () => {
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "name", { enumerable: true, get() { getterCalls += 1; return database; } });
  for (const selected of [[], [{ other: database }], [{ name: database }, { name: database }], [{ name: null }], [accessor]]) {
    const f = fixture(), query = f.connection.query;
    f.connection.query = (sql, parameters) => sql === "SELECT DATABASE() AS name" ? selected : query(sql, parameters);
    assert.deepEqual(await diagnoseBackupInspection(f.connection, database), expected({ databaseMatched: false, privilegeProfile: "shared_admin" }));
  }
  assert.equal(getterCalls, 0);
});
test("sparse and accessor grant arrays cannot evaluate hidden values or bypass the row budget", async () => {
  let getterCalls = 0;
  const accessor = new Array(1);
  Object.defineProperty(accessor, "0", { enumerable: true, get() { getterCalls += 1; return { grant: usage }; } });
  const additional = [{ grant: usage }]; additional[Symbol("synthetic-extra")] = "synthetic-sensitive-value";
  const metaAccessor = [{ grant: usage }];
  Object.defineProperty(metaAccessor, "meta", { get() { getterCalls += 1; return []; } });
  const metaMalformed = [{ grant: usage }]; Object.defineProperty(metaMalformed, "meta", { value: "synthetic-sensitive-value" });
  for (const rows of [new Array(1), accessor, additional, metaAccessor, metaMalformed]) {
    const f = fixture(), query = f.connection.query;
    f.connection.query = (sql, parameters) => sql === "SHOW GRANTS" ? rows : query(sql, parameters);
    assert.deepEqual(await diagnoseBackupInspection(f.connection, database), expected({ scope: "other" }));
  }
  assert.equal(getterCalls, 0);
});
test("query failures propagate unchanged without being incorporated into a diagnostic DTO", async () => {
  for (const failed of ["SELECT DATABASE() AS name", "SHOW GRANTS", "information_schema.TRIGGERS"]) {
    const secretError = Object.assign(new Error("synthetic-sensitive-driver-detail"), { code: "synthetic" });
    const f = fixture({ grants: [usage, grant("ALL PRIVILEGES")], queryError: sql => sql.includes(failed) ? secretError : null });
    await assert.rejects(diagnoseBackupInspection(f.connection, database), error => error === secretError);
  }
});
test("invalid database input stops before issuing a query", async () => {
  const f = fixture();
  for (const value of [null, "", "synthetic.name", "synthetic%", "a".repeat(65)]) {
    await assert.rejects(diagnoseBackupInspection(f.connection, value), error => error.code === "BACKUP_INSPECTION_CONFIG");
  }
  assert.equal(f.queries.length, 0);
});
