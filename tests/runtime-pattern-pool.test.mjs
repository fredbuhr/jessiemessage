import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimePool } from "../server/db/runtime.mjs";

const environment = {
  JESSIEMESSAGE_DB_HOST: "database.example.invalid", JESSIEMESSAGE_DB_NAME: "test_recipe",
  JESSIEMESSAGE_APPLICATION_DATABASE: "test_recipe", JESSIEMESSAGE_RUNTIME_DB_USER: "runtime_only",
  JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic-only", JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE: "infomaniak-shared-pattern",
};
const grants = [
  { grant: "GRANT USAGE ON *.* TO 'runtime_only'@'%'" },
  { grant: "GRANT SELECT, INSERT, UPDATE, DELETE, CREATE TEMPORARY TABLES, LOCK TABLES ON `test_recipe`.* TO 'runtime_only'@'%'" },
];
const namespace = () => [{ schema_name: "information_schema" }, { schema_name: "test_recipe" }];
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function fixture(options = {}) {
  const { schemas = async () => namespace(), release = async () => {} } = options;
  const profile = Object.hasOwn(options, "profile") ? options.profile : "infomaniak-shared-pattern";
  const events = [];
  const pool = await createRuntimePool({ ...environment, JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE: profile }, {
    createPool: () => ({
      getConnection: async () => ({
        async query(command) {
          const sql = typeof command === "string" ? command : command.sql;
          events.push(sql);
          if (sql === "SET time_zone = '+00:00'") return [];
          assert.equal(command.timeout, 2000);
          if (sql === "SHOW GRANTS FOR CURRENT_USER") return grants;
          if (sql === "SELECT SCHEMA_NAME AS schema_name FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME LIMIT 3") return schemas();
          assert.fail("Unexpected connection query");
        },
        async release() { events.push("release"); return release(); },
      }),
      async end() { events.push("end"); },
    }),
  });
  return { pool, events };
}

test("pattern profile withholds a connection until current namespace inspection completes", async () => {
  const pending = deferred();
  const { pool, events } = await fixture({ schemas: () => pending.promise });
  let handedOut = false;
  const acquired = pool.getConnection().then((connection) => { handedOut = true; return connection; });
  await tick();
  assert.equal(handedOut, false);
  assert.equal(events.length, 3);
  pending.resolve(namespace());
  const connection = await acquired;
  assert.equal(handedOut, true);
  await connection.release(); await pool.end();
  assert.deepEqual(events.slice(-2), ["release", "end"]);
});

test("pattern profile detects a newly visible database on the next acquisition", async () => {
  let shadowVisible = false;
  const { pool, events } = await fixture({ schemas: async () => shadowVisible
    ? [...namespace(), { schema_name: "testXrecipe" }] : namespace() });
  const first = await pool.getConnection(); await first.release();
  shadowVisible = true;
  await assert.rejects(pool.getConnection(), (error) => error.code === "AUTH_DATABASE_CONNECTION"
    && error.cause === undefined && !error.message.includes("testXrecipe"));
  await pool.end();
  assert.equal(events.filter((value) => value === "SHOW GRANTS FOR CURRENT_USER").length, 2);
  assert.equal(events.filter((value) => value === "release").length, 2);
  assert.equal(events.at(-1), "end");
});

test("rejected pattern inspection awaits release and preserves cleanup failure for shutdown", async () => {
  const released = deferred();
  const { pool, events } = await fixture({ schemas: async () => { throw new Error("private-driver-detail"); },
    release: async () => { await released.promise; throw new Error("private-release-detail"); } });
  let settled = false;
  const acquired = pool.getConnection(); acquired.catch(() => { settled = true; });
  await tick();
  assert.equal(settled, false); assert.equal(events.at(-1), "release");
  released.resolve();
  const sanitized = (error) => error.code === "AUTH_DATABASE_CONNECTION" && error.cause === undefined
    && !error.message.includes("private-");
  await assert.rejects(acquired, sanitized); await assert.rejects(pool.end(), sanitized);
  assert.equal(events.filter((value) => value === "release").length, 1);
  assert.equal(events.at(-1), "end");
});

test("existing runtime profiles retain their acquisition behavior", async () => {
  for (const profile of [undefined, "strict", "infomaniak-shared"]) {
    const { pool, events } = await fixture({ profile, schemas: async () => assert.fail("Unexpected pattern inspection") });
    const connection = await pool.getConnection(); await connection.release(); await pool.end();
    assert.deepEqual(events, ["SET time_zone = '+00:00'", "release", "end"]);
  }
});
