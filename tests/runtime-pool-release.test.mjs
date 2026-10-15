import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { AuthStoreError } from "../server/auth/store.mjs";

const env = {
  JESSIEMESSAGE_DB_HOST: "database.example.invalid", JESSIEMESSAGE_DB_NAME: "recipe",
  JESSIEMESSAGE_APPLICATION_DATABASE: "recipe", JESSIEMESSAGE_RUNTIME_DB_USER: "runtime_only",
  JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic-not-a-secret",
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const sanitized = (error) => error instanceof AuthStoreError && error.code === "AUTH_DATABASE_CONNECTION"
  && error.cause === undefined && !error.message.includes("driver-private-value");
async function fixture({ release = () => {}, query = async () => [], end = async () => {} } = {}) {
  const calls = { releases: 0, ends: 0, queries: [] };
  const pool = await createRuntimePool(env, { createPool(options) {
    assert.equal(options.password, env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD);
    assert.deepEqual(options.ssl, { rejectUnauthorized: true, minVersion: "TLSv1.2" });
    return {
      async getConnection() {
        return { query: async (...args) => { calls.queries.push(args); return query(...args); },
          release: () => { calls.releases += 1; return release(); } };
      },
      async end() { calls.ends += 1; return end(); },
    };
  } });
  return { pool, calls };
}

test("runtime release retains the driver's asynchronous completion and returns one cached Promise", async () => {
  const pending = deferred(), { pool, calls } = await fixture({ release: () => pending.promise });
  const connection = await pool.getConnection();
  const released = connection.release();
  assert.equal(released, connection.release());
  let settled = false; released.then(() => { settled = true; });
  await tick();
  assert.equal(calls.releases, 1); assert.equal(settled, false);
  pending.resolve(); await released;
  assert.equal(connection.release(), released); assert.equal(calls.releases, 1);
  await pool.end();
});

test("runtime shutdown drains ignored releases before closing the driver pool", async () => {
  const pending = deferred(), { pool, calls } = await fixture({ release: () => pending.promise });
  const connection = await pool.getConnection(); connection.release();
  const ended = pool.end(); assert.equal(pool.end(), ended);
  await tick(); assert.equal(calls.ends, 0);
  await assert.rejects(pool.getConnection(), (error) => error.code === "AUTH_DATABASE_BUSY");
  pending.resolve(); await ended;
  assert.equal(calls.releases, 1); assert.equal(calls.ends, 1);
});

test("an asynchronous release rejection remains observable and makes shutdown fail after driver cleanup", async () => {
  const pending = deferred(), { pool, calls } = await fixture({ release: () => pending.promise });
  const connection = await pool.getConnection(), released = connection.release();
  // A store may deliberately ignore release() after COMMIT. The adapter must
  // observe that rejection without an unhandled event and retain the failure.
  pending.reject(new Error("driver-private-value")); await tick();
  await assert.rejects(released, sanitized);
  assert.equal(connection.release(), released);
  const ended = pool.end(); await assert.rejects(ended, sanitized);
  assert.equal(pool.end(), ended); assert.equal(calls.ends, 1); assert.equal(calls.releases, 1);
});

test("a synchronous driver release throw becomes the same sanitized rejected Promise", async () => {
  const { pool, calls } = await fixture({ release() { throw new Error("driver-private-value"); } });
  const connection = await pool.getConnection();
  let released; assert.doesNotThrow(() => { released = connection.release(); });
  assert.equal(connection.release(), released);
  await assert.rejects(released, sanitized); await assert.rejects(pool.end(), sanitized);
  assert.equal(calls.releases, 1); assert.equal(calls.ends, 1);
});

test("failed timezone initialization waits for asynchronous release before rejecting acquisition", async () => {
  const pending = deferred(), { pool, calls } = await fixture({
    query() { throw new Error("driver-private-value"); }, release: () => pending.promise,
  });
  let settled = false;
  const acquired = pool.getConnection(); acquired.catch(() => { settled = true; });
  await tick(); assert.equal(settled, false); assert.equal(calls.releases, 1);
  assert.deepEqual(calls.queries, [["SET time_zone = '+00:00'"]]);
  pending.resolve(); await assert.rejects(acquired, sanitized); await pool.end();
  assert.equal(calls.ends, 1);
});

test("failed acquisition drains a rejected release and never exposes its driver error", async () => {
  const pending = deferred(), { pool, calls } = await fixture({
    query() { throw new Error("driver-private-value-query"); }, release: () => pending.promise,
  });
  const acquired = pool.getConnection(); acquired.catch(() => {});
  await tick(); pending.reject(new Error("driver-private-value-release"));
  await assert.rejects(acquired, sanitized); await assert.rejects(pool.end(), sanitized);
  assert.equal(calls.releases, 1); assert.equal(calls.ends, 1);
});

test("failed timezone cleanup decrements each acquisition once and restores bounded admission", async () => {
  const pending = deferred(); let queryFailures = true;
  const { pool, calls } = await fixture({
    query() { if (queryFailures) throw new Error("driver-private-value"); return []; },
    release: () => pending.promise,
  });
  const acquisitions = Array.from({ length: 8 }, () => pool.getConnection());
  acquisitions.forEach((acquired) => acquired.catch(() => {}));
  await tick();
  await assert.rejects(pool.getConnection(), (error) => error.code === "AUTH_DATABASE_BUSY");
  assert.equal(calls.releases, 8); pending.resolve();
  assert.ok((await Promise.allSettled(acquisitions)).every((result) => result.status === "rejected" && sanitized(result.reason)));
  queryFailures = false;
  const connections = await Promise.all(Array.from({ length: 8 }, () => pool.getConnection()));
  await assert.rejects(pool.getConnection(), (error) => error.code === "AUTH_DATABASE_BUSY");
  await Promise.all(connections.map((connection) => connection.release()));
  await pool.end(); assert.equal(calls.releases, 16); assert.equal(calls.ends, 1);
});

test("driver pool shutdown errors are sanitized after successful release cleanup", async () => {
  const { pool, calls } = await fixture({ end() { throw new Error("driver-private-value"); } });
  const connection = await pool.getConnection(); await connection.release();
  await assert.rejects(pool.end(), sanitized);
  assert.equal(calls.releases, 1); assert.equal(calls.ends, 1);
});
