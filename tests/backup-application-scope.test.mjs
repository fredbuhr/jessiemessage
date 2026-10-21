import test from "node:test";
import assert from "node:assert/strict";
import { APPLICATION_COVERAGE, ApplicationBackupScopeError, validateApplicationCoverage,
  createApplicationInspectionPool, assertApplicationTableInspection } from "../server/backup/application-scope.mjs";
import { createdMigrationTables, loadMigrations } from "../server/db/migrations.mjs";
import { createBackupSnapshotStore, captureBackupSnapshot, assertBackupSnapshot } from "../server/backup/snapshot.mjs";

const neutral = error => error instanceof ApplicationBackupScopeError && error.code === "BACKUP_APPLICATION_SCOPE"
  && error.message === "Private application backup coverage could not be verified." && error.cause === undefined;
const names = async () => [...createdMigrationTables(await loadMigrations()), "schema_migrations"];
const database = "jessiemessage_test_application";
const tables = async () => (await names()).map(name => ({ name, kind: "BASE TABLE", engine: "InnoDB", collation: "utf8mb4_unicode_ci" }));

test("application coverage is detached and cannot claim a complete SQL object inventory", () => {
  assert.equal(Object.isFrozen(APPLICATION_COVERAGE), true);
  const value = validateApplicationCoverage(APPLICATION_COVERAGE);
  assert.deepEqual(value, APPLICATION_COVERAGE); assert.notEqual(value, APPLICATION_COVERAGE);
  value.tables = 1; assert.equal(APPLICATION_COVERAGE.tables, 33);
  assert.deepEqual(validateApplicationCoverage({ ...APPLICATION_COVERAGE, tables: 30 }), { ...APPLICATION_COVERAGE, tables: 30 });
  for (const change of [{ scope: "complete-schema" }, { tables: 29 }, { tables: 34 }, { encryptedMedia: false }, { completeDatabase: true },
    { executableInventory: "absent" }, { executableObjects: "included" }, { extra: true }]) {
    assert.throws(() => validateApplicationCoverage({ ...APPLICATION_COVERAGE, ...change }), neutral);
  }
  for (const name of Object.keys(APPLICATION_COVERAGE)) {
    const missing = { ...APPLICATION_COVERAGE }; delete missing[name];
    assert.throws(() => validateApplicationCoverage(missing), neutral);
    const accessor = { ...APPLICATION_COVERAGE };
    Object.defineProperty(accessor, name, { enumerable: true, get() { assert.fail("A coverage accessor must not execute"); } });
    assert.throws(() => validateApplicationCoverage(accessor), neutral);
  }
  for (const value of [null, [], Object.assign(Object.create({ private: true }), APPLICATION_COVERAGE),
    { ...APPLICATION_COVERAGE, [Symbol("extra")]: true }]) assert.throws(() => validateApplicationCoverage(value), neutral);
});

test("application inspection validates exact table identities without probing executable metadata", async () => {
  const inventory = await tables(), queries = [];
  const connection = { async query(sql, parameters) {
    queries.push(sql);
    if (sql === "SELECT DATABASE() AS name") return [{ name: database }];
    assert.match(sql, /FROM information_schema\.TABLES .*LIMIT 34$/);
    assert.deepEqual(parameters, [database]); return [...inventory].reverse();
  } };
  assert.equal(await assertApplicationTableInspection(connection, database), true);
  assert.equal(queries.length, 2);
  assert.doesNotMatch(queries.join(" "), /TRIGGERS|EVENTS|ROUTINES|SHOW GRANTS/);
  for (const change of [rows => rows.slice(1), rows => [...rows, rows[0]], rows => rows.map((row, i) => i ? row : { ...row, name: "unrelated" }),
    rows => rows.map((row, i) => i ? row : { ...row, kind: "VIEW" }), rows => rows.map((row, i) => i ? row : { ...row, engine: "MyISAM" }),
    rows => rows.map((row, i) => i ? row : Object.defineProperty({ ...row }, "name", { get() { assert.fail("Unsafe table field accessor"); } }))]) {
    await assert.rejects(assertApplicationTableInspection({ query: async sql => sql.startsWith("SELECT DATABASE")
      ? [{ name: database }] : change(inventory) }, database), neutral);
  }
  await assert.rejects(assertApplicationTableInspection({ query: async () => [{ name: "other" }] }, database), neutral);
  await assert.rejects(assertApplicationTableInspection({ query: async () => { throw new Error("private-password SQL diagnostic"); } }, database), neutral);
});

test("application inspection pool retains the runtime privilege guard on every acquisition and exposes only reads", async () => {
  let namespaceChanged = false, released = 0, ended = 0, guarded = 0, driverOptions;
  const env = { JESSIEMESSAGE_DB_NAME: database, JESSIEMESSAGE_APPLICATION_DATABASE: database,
    JESSIEMESSAGE_DB_HOST: "127.0.0.1", JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1", JESSIEMESSAGE_RUNTIME_DB_USER: "runtime",
    JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic", JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE: "infomaniak-shared-pattern" };
  const queries = [];
  const pool = await createApplicationInspectionPool(env, { createPool(options) {
    driverOptions = options;
    return { getConnection: async () => ({ async query(sql) {
      const value = typeof sql === "string" ? sql : sql.sql; queries.push(value);
      if (value === "SHOW GRANTS FOR CURRENT_USER") {
        guarded++;
        return [{ grant: "GRANT USAGE ON *.* TO 'runtime'@'%'" },
          { grant: `GRANT SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES ON \`${database}\`.* TO 'runtime'@'%'` }];
      }
      if (value.includes("information_schema.SCHEMATA")) return [{ schema_name: "information_schema" }, { schema_name: namespaceChanged ? "other" : database }];
      return [];
    }, release: async () => { released++; } }), end: async () => { ended++; } };
  } });
  assert.equal(driverOptions.user, "runtime"); assert.equal(driverOptions.multipleStatements, false);
  const connection = await pool.getConnection(); assert.deepEqual(Object.keys(connection).sort(), ["query", "release"]);
  await connection.query("SELECT DATABASE() AS name"); await connection.query("SHOW GRANTS");
  for (const sql of ["UPDATE users SET status = 'active'", "SELECT id INTO OUTFILE '/private' FROM users", "SELECT * FROM users FOR UPDATE",
    "SELECT * FROM users LOCK IN SHARE MODE", "SHOW TABLES", "SHOW GRANTS FOR 'other'@'%'"]) assert.throws(() => connection.query(sql), neutral);
  await connection.release();
  namespaceChanged = true;
  await assert.rejects(pool.getConnection(), error => error.code === "AUTH_DATABASE_CONNECTION");
  await pool.end();
  assert.equal(guarded, 2); assert.equal(released, 2); assert.equal(ended, 1);
  assert.equal(queries.some(sql => sql.startsWith("UPDATE")), false);
});

async function captureFixture(coverage) {
  const migrations = await loadMigrations(), inventory = await tables();
  const definitions = migrations.filter(({ sql }) => /^CREATE\s+TABLE\s/i.test(sql.trim())).map(({ sql }) => ({
    name: /^CREATE\s+TABLE\s+([a-z_]+)/i.exec(sql.trim())[1],
    primary: /PRIMARY KEY\s*\(([a-z_, ]+)\)/i.exec(sql)[1].split(",").map(value => value.trim()),
  })).concat({ name: "schema_migrations", primary: ["version"] });
  const columns = definitions.flatMap(({ name, primary }) => primary.map((column, index) => ({ table_name: name, name: column,
    type: name === "schema_migrations" ? "int unsigned" : "varbinary(16)", nullable: "NO", default_value: null,
    extra: "", collation: null, position: index + 1 })));
  const instant = "2026-10-17 12:00:00.000000";
  for (const [name, type] of [["owner_bytes", "bigint unsigned"], ["total_bytes", "bigint unsigned"], ["held_bytes", "bigint unsigned"],
    ["root_fingerprint", "varbinary(32)"], ["initialized_at", "datetime(6)"]]) columns.push({ table_name: "media_storage_state", name,
    type, nullable: "NO", default_value: null, extra: "", collation: null, position: columns.filter(c => c.table_name === "media_storage_state").length + 1 });
  const queries = [];
  const connection = { async query(sql) {
    queries.push(sql);
    if (sql === "SELECT DATABASE() AS name") return [{ name: database }];
    if (sql.startsWith("SET TRANSACTION")) return [];
    if (sql.includes(" FROM media_storage_state ")) return [{ id: 1, owner_bytes: 1000, total_bytes: 10000, held_bytes: 0,
      root_fingerprint: Buffer.alloc(32, 1), initialized_at: instant }];
    return [];
  }, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: async () => {} };
  const inspection = { async query(sql) {
    queries.push(sql);
    if (sql === "SELECT DATABASE() AS name") return [{ name: database }];
    if (sql === "SHOW GRANTS") return [{ grant: `GRANT ALL PRIVILEGES ON \`${database.replaceAll("_", "\\_")}\`.* TO 'synthetic'@'%'` }];
    if (sql.startsWith("SELECT COUNT(*)")) return [{ value: 0 }];
    if (sql.includes("information_schema.TABLES")) return inventory;
    if (sql.includes("information_schema.COLUMNS")) return columns;
    return [];
  }, release: async () => {} };
  return { queries, store: createBackupSnapshotStore({ pool: { getConnection: async () => connection },
    inspectionPool: { getConnection: async () => inspection }, ...(coverage === undefined ? {} : { coverage }) }) };
}

test("an explicit application snapshot has signed-data coverage while the default remains strict", async () => {
  const app = await captureFixture("application-tables"), strict = await captureFixture();
  const application = await captureBackupSnapshot({ store: app.store }), complete = await captureBackupSnapshot({ store: strict.store });
  assert.equal(application.version, 2); assert.deepEqual(application.coverage, APPLICATION_COVERAGE); assert.equal(application.counts.tables, 33);
  assert.equal(complete.version, 1); assert.equal(Object.hasOwn(complete, "coverage"), false);
  assert.equal(application.schemaDigest, complete.schemaDigest); assert.equal(application.coreDigest, complete.coreDigest);
  assert.doesNotMatch(app.queries.join(" "), /TRIGGERS|EVENTS|ROUTINES|SHOW GRANTS/);
  assert.match(strict.queries.join(" "), /TRIGGERS/);
  for (const [expected, actual] of [[application, complete], [complete, application]]) {
    assert.throws(() => assertBackupSnapshot({ expected, actual, mode: "exact" }), error => error.code === "BACKUP_SNAPSHOT_DRIFT");
    assert.throws(() => assertBackupSnapshot({ expected, actual, mode: "recovery" }), error => error.code === "BACKUP_SNAPSHOT_DRIFT");
  }
  assert.equal(assertBackupSnapshot({ expected: application, actual: structuredClone(application), mode: "recovery" }).heldBytes, 0);
  for (const mutate of [snapshot => { snapshot.version = 1; }, snapshot => { delete snapshot.coverage; },
    snapshot => { snapshot.coverage.completeDatabase = true; }, snapshot => { snapshot.counts.tables = 29; },
    snapshot => { Object.defineProperty(snapshot, "coverage", { get() { assert.fail("Snapshot coverage accessor must not execute"); } }); },
    snapshot => { Object.defineProperty(snapshot, "coverage", { enumerable: false }); }]) {
    const malformed = structuredClone(application); mutate(malformed);
    await assert.rejects(captureBackupSnapshot({ store: { capture: async () => malformed } }), error => error.code === "BACKUP_SNAPSHOT_STATE");
  }
  const inherited = Object.assign(Object.create({ coverage: APPLICATION_COVERAGE }), complete);
  await assert.rejects(captureBackupSnapshot({ store: { capture: async () => inherited } }), error => error.code === "BACKUP_SNAPSHOT_STATE");
  assert.throws(() => createBackupSnapshotStore({ pool: {}, coverage: "unknown" }), error => error.code === "BACKUP_SNAPSHOT_INPUT");
});
