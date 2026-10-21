import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadMigrations } from "../server/db/migrations.mjs";
import { DataRollbackError, inspectRollbackHistory } from "../server/data/rollback.mjs";

const migrations = await loadMigrations();
const older = migrations.slice(0, 25);
const ledger = (plan) => plan.map(({ version, name, checksum }) => ({ version, name, checksum, state: "applied", attempts: 1 }));
const inspect = (rows, plan = migrations) => inspectRollbackHistory({ migrations: plan, rows });
const reason = (rows, expected, plan = migrations) => {
  const report = inspect(rows, plan);
  assert.equal(report.reason, expected);
  assert.equal(report.canStart, expected === "matching_history");
  assert.deepEqual(Object.keys(report).sort(), ["canStart", "codeMigrationCount", "reason", "recordedMigrationCount"]);
  assert.equal(report.codeMigrationCount, plan.length);
  assert.equal(report.recordedMigrationCount, rows.length);
  return report;
};

test("schema-25 fixture uses the unchanged real migration bytes from version 0.14", () => {
  // Digest of [{version,name,checksum}] captured from historical commit
  // 57e779b80492280d650971c9e2bf71042ee9f2bd; this test never invokes Git.
  const projection = older.map(({ version, name, checksum }) => ({ version, name, checksum }));
  assert.equal(createHash("sha256").update(JSON.stringify(projection)).digest("hex"),
    "36e6334d6e30f1498821ec5f1277a20ebd2621d6fb892ea2293e9a13088cbfa3");
  assert.equal(migrations.length, 33);
});

test("the actual history validator permits only the diagonal of the 25/33 rollback matrix", () => {
  reason(ledger(older), "matching_history", older);
  reason(ledger(migrations), "database_ahead", older);
  reason(ledger(older), "migrations_pending", migrations);
  reason(ledger(migrations), "matching_history", migrations);
});

test("matching schema-33 candidate packages retain their independent migration objects", () => {
  const candidate = migrations.map((item) => ({ ...item }));
  const rows = ledger(migrations), before = structuredClone(rows);
  reason(rows, "matching_history", candidate);
  assert.deepEqual(rows, before);
  assert.deepEqual(candidate, migrations);
});

test("the schema32 production history remains valid on its own while schema33 requires a matching compatible package", () => {
  const prior = migrations.slice(0, 32);
  reason(ledger(prior), "matching_history", prior);
  reason(ledger(migrations), "database_ahead", prior);
  reason(ledger(prior), "migrations_pending", migrations);
  reason(ledger(migrations), "matching_history", migrations);
});

test("empty and contiguous partial ledgers remain pending without enabling startup", () => {
  reason([], "migrations_pending");
  reason(ledger(migrations).slice(0, 1), "migrations_pending");
  reason(ledger(migrations).slice(0, 26), "migrations_pending");
});

test("running, failed and retry histories never permit startup", () => {
  for (const state of ["running", "failed", "retry"]) {
    const rows = ledger(migrations); rows.at(-1).state = state;
    reason(rows, "incomplete_history");
    rows.splice(-1, 1); rows.at(-1).state = state;
    reason(rows, "incomplete_history");
    rows.push(ledger(migrations).at(-1));
    reason(rows, "incomplete_history");
  }
});

test("changed recorded names or checksums return only fixed drift metadata", () => {
  for (const changed of [{ name: "private-email@example.invalid" }, { checksum: "private SQL or password" }]) {
    const rows = ledger(migrations); Object.assign(rows[2], changed);
    const report = reason(rows, "checksum_drift");
    assert.equal(JSON.stringify(report).includes(Object.values(changed)[0]), false);
  }
});

test("gaps, duplicate rows, reordered rows and future versions fail closed", () => {
  const full = ledger(migrations);
  reason(full.slice(1), "incomplete_history");
  reason([full[0], ...full.slice(2)], "incomplete_history");
  reason([full[0], full[0]], "invalid_history");
  reason([full[1], full[0]], "incomplete_history");
  reason([...full, { ...full.at(-1), version: 34, name: "0034_future.sql" }], "database_ahead");
  reason([...full, { ...full.at(-1), version: 99, name: "0099_future.sql" }], "incomplete_history");
});

test("invalid and noncanonical version aliases never pass a matching ledger", () => {
  for (const value of [0, -1, 1.5, NaN, Infinity, "", "01", "+1", "1.0", " 1", "1 ", null, true, {}, 4294967296]) {
    const rows = ledger(migrations); rows[0].version = value;
    reason(rows, "invalid_history");
  }
  for (const value of [1, "1", 1n]) {
    const rows = ledger(migrations); rows[0].version = value;
    reason(rows, "matching_history");
  }
});

test("invalid recorded states and candidate migration plans cannot certify a ledger", () => {
  const rows = ledger(migrations); rows.at(-1).state = "unexpected private state";
  reason(rows, "invalid_history");
  for (const plan of [migrations.slice(1), [{ ...migrations[0], checksum: "0".repeat(64) }],
    [{ ...migrations[0], sql: `${migrations[0].sql} DROP TABLE private;` }]]) {
    reason([], "invalid_history", plan);
  }
});

test("malformed, sparse and unbounded input throws only a fixed DataRollbackError", () => {
  const sparse = new Array(1);
  for (const input of [undefined, null, [], {}, { migrations, rows: null }, { migrations: [], rows: [] },
    { migrations: new Array(1001).fill(migrations[0]), rows: [] }, { migrations, rows: new Array(1001).fill(ledger(migrations)[0]) },
    { migrations: sparse, rows: [] }, { migrations, rows: sparse }, { migrations, rows: [null] },
    { migrations, rows: [[]] }, { migrations, rows: [], privateExtra: "private-path" },
    { migrations, rows: [{ get version() { throw new Error("private credential"); } }] }]) {
    assert.throws(() => inspectRollbackHistory(input), (error) => {
      assert.ok(error instanceof DataRollbackError);
      assert.equal(error.code, "DATA_ROLLBACK_INVALID");
      assert.equal(error.message, "Migration rollback history could not be inspected.");
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});
