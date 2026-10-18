import test from "node:test";
import assert from "node:assert/strict";
import { cleanupAuthenticationSchema } from "./rehearsal/auth-fixture.mjs";

const options = { database: "jessiemessage_test_fixture", lockName: "synthetic-rehearsal-lock", allowedTables: ["sessions", "users", "schema_migrations"] };
const blocked = (error) => error.code === "AUTH_REHEARSAL_CLEANUP" && error.cause === undefined
  && !JSON.stringify(error).includes("synthetic-");

test("cleanup waits for proof from the original lock owner before any inventory read or DROP", async () => {
  const statements = []; let resolveOwner, destroyed = 0, settled = false;
  const owner = new Promise((resolve) => { resolveOwner = resolve; });
  const connection = { query: async (sql, parameters) => {
    statements.push(sql);
    if (sql.startsWith("SELECT IS_USED_LOCK")) { assert.deepEqual(parameters, [options.lockName]); return owner; }
    if (sql.startsWith("SELECT TABLE_NAME")) { assert.deepEqual(parameters, [options.database]); return options.allowedTables.map((name) => ({ name })); }
    return [];
  }, destroy: () => { destroyed++; } };
  const pending = cleanupAuthenticationSchema(connection, options).then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false); assert.equal(statements.length, 1, "slow ownership proof must not race ahead to cleanup");
  resolveOwner([{ held: 1 }]); await pending;
  assert.deepEqual(statements.slice(2), options.allowedTables.map((name) => `DROP TABLE IF EXISTS ${name}`)); assert.equal(destroyed, 0);
});

test("lost or unreadable lock ownership destroys the original connection and leaves every table intact", async () => {
  for (const response of [[{ held: 0 }], [{ held: null }], [], [{ held: 1 }, { held: 1 }], "failure"]) {
    let queries = 0, destroyed = 0;
    const connection = { query: async () => { queries++; if (response === "failure") throw new Error("synthetic-private-driver-error"); return response; }, destroy: () => { destroyed++; } };
    await assert.rejects(cleanupAuthenticationSchema(connection, options), blocked);
    assert.equal(queries, 1, "no inventory or DROP after an uncertain/lost lock"); assert.equal(destroyed, 1);
  }
});

test("an unknown table still blocks all DROPs after successful lock verification", async () => {
  const statements = []; let destroyed = 0;
  const connection = { query: async (sql) => {
    statements.push(sql);
    return sql.startsWith("SELECT IS_USED_LOCK") ? [{ held: 1 }] : [{ name: "users" }, { name: "unrelated" }];
  }, destroy: () => { destroyed++; } };
  await assert.rejects(cleanupAuthenticationSchema(connection, options), blocked);
  assert.equal(statements.length, 2); assert.equal(statements.some((sql) => sql.startsWith("DROP")), false); assert.equal(destroyed, 1);
});
