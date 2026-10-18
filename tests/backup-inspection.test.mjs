import test from "node:test";
import assert from "node:assert/strict";
import { assertBackupInspection, createBackupInspectionPool } from "../server/backup/inspection.mjs";

function fixture({ name = "jessiemessage_test_ci", grant = "GRANT ALL PRIVILEGES ON `jessiemessage\\_test\\_ci`.* TO `inspector`@`%`", count = {} } = {}) {
  const queries = [];
  return { queries, connection: { query: async (sql) => {
    queries.push(sql);
    if (sql.startsWith("SELECT DATABASE")) return [{ name }];
    if (sql === "SHOW GRANTS") return [{ grant }];
    const view = /information_schema\.([A-Z]+)/.exec(sql)?.[1];
    return [{ value: count[view] ?? 0 }];
  } } };
}
test("offline inspection requires explicit separate schema credentials before connecting", async () => {
  for (const env of [{}, { JESSIEMESSAGE_BACKUP_SCHEMA_USER: "same", JESSIEMESSAGE_RUNTIME_DB_USER: "same", JESSIEMESSAGE_BACKUP_SCHEMA_PASSWORD: "synthetic" },
    { JESSIEMESSAGE_BACKUP_SCHEMA_USER: "same", JESSIEMESSAGE_RUNTIME_DB_USER: "same", JESSIEMESSAGE_BACKUP_SCHEMA_PASSWORD: "synthetic", JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE: "infomaniak-shared-pattern" },
    { JESSIEMESSAGE_BACKUP_SCHEMA_USER: "inspector", JESSIEMESSAGE_BACKUP_SCHEMA_PASSWORD: "" }]) await assert.rejects(createBackupInspectionPool(env));
});
test("inspection proves exact-schema metadata visibility and rejects scoped database mismatch or DML-only grants", async () => {
  for (const grant of ["GRANT ALL PRIVILEGES ON `jessiemessage\\_test\\_ci`.* TO `inspector`@`%`"]) {
    const f = fixture({ grant }); assert.equal(await assertBackupInspection(f.connection, "jessiemessage_test_ci"), true); assert.equal(f.queries.length, 5);
  }
  for (const changes of [{ name: "other" }, { grant: "GRANT SELECT, INSERT, UPDATE, DELETE ON `jessiemessage_test_ci`.* TO `runtime`@`%`" },
    { grant: "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES ON `jessiemessage\\_test\\_ci`.* TO `runtime`@`%`" },
    { grant: "GRANT ALL PRIVILEGES ON *.* TO `root`@`%`" }, { grant: "GRANT ALL PRIVILEGES ON `jessiemessage_test_%`.* TO `inspector`@`%`" },
    { grant: "GRANT ALL PRIVILEGES ON `jessiemessage_test_ci`.* TO `inspector`@`%`" }]) {
    await assert.rejects(assertBackupInspection(fixture(changes).connection, "jessiemessage_test_ci"));
  }
});
test("triggers, scheduled events and routines block offline repair before data mutations", async () => {
  for (const view of ["TRIGGERS", "EVENTS", "ROUTINES"]) {
    const f = fixture({ count: { [view]: 1 } });
    await assert.rejects(assertBackupInspection(f.connection, "jessiemessage_test_ci"), (error) => {
      assert.equal(error.code, "BACKUP_INSPECTION_CONFIG"); assert.doesNotMatch(error.message, /inspector|password|test_ci/); return true;
    });
    assert.ok(f.queries.every((sql) => /^(?:SELECT|SHOW GRANTS)/.test(sql)));
  }
});
