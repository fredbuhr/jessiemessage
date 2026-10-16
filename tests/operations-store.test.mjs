import test from "node:test";
import assert from "node:assert/strict";
import { createOperationsStore, OperationsStoreError } from "../server/operations/store.mjs";

const now = Date.parse("2026-10-15T08:00:00.123Z");
const date = "2026-10-15 08:00:00.122999";
const present = (length) => Array.from({ length }, () => ({ present: 1 }));
const unavailable = (error) => error instanceof OperationsStoreError && error.code === "OPERATIONS_STORE_UNAVAILABLE"
  && !/private@example|password|SELECT|payload|secret/i.test(error.message);
function fixture(results = []) {
  const calls = [];
  let acquisitions = 0, releases = 0;
  const connection = { async query(sql) {
    calls.push(sql);
    const value = calls.length === 1 ? [{ ready: 1 }] : results.shift() ?? [];
    if (value instanceof Error) throw value;
    return value;
  }, release() { releases++; } };
  const pool = { async getConnection() { acquisitions++; return connection; } };
  return { calls, pool, connection, acquisitions: () => acquisitions, releases: () => releases };
}

test("operations sampling reads one connection and enabled queues with fixed bounded metadata queries", async () => {
  const f = fixture([[{ available_at: date }], present(2), present(1), [], [], [], [], present(1), []]);
  const value = await createOperationsStore({ pool: f.pool, recovery: true, broadcasts: true }).sample({ now });
  assert.deepEqual(value, { database: true, queues: [
    { name: "verification", pending: { count: 1, truncated: false }, sending: { count: 2, truncated: false }, failed: { count: 1, truncated: false }, oldestDueAt: now - 1 },
    { name: "recovery", pending: { count: 0, truncated: false }, sending: { count: 0, truncated: false }, failed: { count: 0, truncated: false }, oldestDueAt: null },
    { name: "broadcasts", pending: { count: 0, truncated: false }, sending: { count: 1, truncated: false }, failed: { count: 0, truncated: false }, oldestDueAt: null },
  ] });
  assert.equal(f.acquisitions(), 1); assert.equal(f.releases(), 1); assert.equal(f.calls.length, 10);
  assert.equal(f.calls[0], "SELECT 1 AS ready");
  for (const query of f.calls.slice(1)) {
    assert.match(query, /^SELECT (?:available_at|1 AS present) FROM (?:mail_outbox|password_reset_outbox|broadcast_recipients)/);
    assert.match(query, /LIMIT 1001$/);
    assert.doesNotMatch(query, /COUNT|SUM|payload|email|recipient_user_id|lease_token|FOR UPDATE|INSERT|UPDATE|DELETE/);
  }
  assert.equal(f.calls.filter((query) => /WHERE state =/.test(query)).length, 3);
});

test("operations sampling caps each count independently and retains the true first scheduling time", async () => {
  const f = fixture([Array.from({ length: 1001 }, () => ({ available_at: date })), present(1000), present(1001)]);
  const [queue] = (await createOperationsStore({ pool: f.pool }).sample({ now })).queues;
  assert.deepEqual(queue.pending, { count: 1000, truncated: true });
  assert.deepEqual(queue.sending, { count: 1000, truncated: false });
  assert.deepEqual(queue.failed, { count: 1000, truncated: true });
  assert.equal(queue.oldestDueAt, now - 1); assert.equal(f.releases(), 1);
});

test("operations due time distinguishes a future microsecond, exact now, future dates and empty queues", async () => {
  for (const [available, expected] of [
    ["2026-10-15 08:00:00.123001", null], ["2026-10-15 08:00:00.123000", now],
    ["2026-10-15 08:00:01.000000", null], [null, null],
  ]) {
    const f = fixture([available === null ? [] : [{ available_at: available }], [], []]);
    assert.equal((await createOperationsStore({ pool: f.pool }).sample({ now })).queues[0].oldestDueAt, expected);
  }
});

test("operations disabled queues require only the database liveness query", async () => {
  const f = fixture();
  assert.deepEqual(await createOperationsStore({ pool: f.pool, verification: false }).sample({ now }), { database: true, queues: [] });
  assert.deepEqual(f.calls, ["SELECT 1 AS ready"]); assert.equal(f.releases(), 1);
});

test("operations configuration and clocks reject before acquiring database resources", async () => {
  for (const config of [undefined, {}, { pool: {} }, { pool: fixture().pool, recovery: 1 }, { pool: fixture().pool, broadcasts: "1" }, { pool: fixture().pool, verification: null }]) {
    assert.throws(() => createOperationsStore(config), unavailable);
  }
  const f = fixture(), store = createOperationsStore({ pool: f.pool });
  for (const value of [undefined, -1, NaN, Infinity, 0.5, "1", 253402300800000]) await assert.rejects(store.sample({ now: value }), unavailable);
  assert.equal(f.acquisitions(), 0);
});

test("operations validates row shapes, strict dates, monotonic ordering and sample limits", async () => {
  for (const invalid of [null, {}, [{ available_at: date, payload: "secret" }], [{ available_at: new Date(now) }],
    [{ available_at: "2026-02-30 00:00:00.000000" }], [{ available_at: "2026-10-15 08:00:00Z" }],
    [{ available_at: "1969-12-31 23:59:59.999999" }], [{ available_at: date }, { available_at: "2026-10-15 08:00:00.100000" }],
    Array.from({ length: 1002 }, () => ({ available_at: date }))]) {
    const f = fixture();
    f.connection.query = async (sql) => sql === "SELECT 1 AS ready" ? [{ ready: 1 }] : invalid;
    await assert.rejects(createOperationsStore({ pool: f.pool }).sample({ now }), unavailable); assert.equal(f.releases(), 1);
  }
  for (const malformed of [[{ present: "1" }], [{ present: 1, id: "secret" }], [{ present: 2 }]]) {
    const f = fixture([[], malformed, []]);
    await assert.rejects(createOperationsStore({ pool: f.pool }).sample({ now }), unavailable); assert.equal(f.releases(), 1);
  }
});

test("operations refuses bad liveness proof and sanitizes acquisition/query/release failures", async () => {
  for (const proof of [[], [{ ready: 0 }], [{ ready: "1" }], [{ ready: 1, password: "secret" }], [{ ready: 1 }, { ready: 1 }]]) {
    const f = fixture(); f.connection.query = async () => proof;
    await assert.rejects(createOperationsStore({ pool: f.pool }).sample({ now }), unavailable); assert.equal(f.releases(), 1);
  }
  const f = fixture([new Error("SELECT payload private@example.invalid password")]);
  await assert.rejects(createOperationsStore({ pool: f.pool }).sample({ now }), unavailable); assert.equal(f.releases(), 1);
  await assert.rejects(createOperationsStore({ pool: { async getConnection() { throw new Error("private@example.invalid secret"); } } }).sample({ now }), unavailable);
  const badRelease = fixture(); badRelease.connection.release = () => { throw new Error("password secret"); };
  await assert.rejects(createOperationsStore({ pool: badRelease.pool }).sample({ now }), unavailable);
});

test("notification supervision samples only capped scheduling metadata and remains opt-in", async () => {
  const f = fixture([[{ available_at: date }], present(1), []]);
  const value = await createOperationsStore({ pool: f.pool, verification: false, notifications: true }).sample({ now });
  assert.deepEqual(value, { database: true, queues: [
    { name: "notifications", pending: {count: 1, truncated: false}, sending: {count: 1, truncated: false},
      failed: {count: 0, truncated: false}, oldestDueAt: now - 1 },
  ] });
  assert.equal(f.calls.length, 4);
  for (const query of f.calls.slice(1)) {
    assert.match(query, /FROM push_outbox\s+WHERE status = '(?:pending|sending|failed)'/);
    assert.match(query, /LIMIT 1001$/);
    assert.doesNotMatch(query, /subscription|endpoint|message_id|recipient|payload|lease_token|FOR UPDATE/);
  }
  assert.throws(() => createOperationsStore({pool: f.pool, notifications: "1"}), unavailable);
});
