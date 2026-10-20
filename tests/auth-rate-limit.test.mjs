import test from "node:test";
import assert from "node:assert/strict";
import { createAuthStore } from "../server/auth/store.mjs";

const hash = Buffer.alloc(32, 1), other = Buffer.alloc(32, 2);
const now = Date.UTC(2026, 9, 20);

test("public quota configuration rejects ambiguous or unbounded network budgets before SQL", async () => {
  let connections = 0;
  const store = createAuthStore({ async getConnection() { connections++; throw new Error("unexpected SQL"); } });
  for (const network of [null, [], {}, { bucketHash: hash, windowSeconds: 900, limit: 20 },
    { bucketHash: other, windowSeconds: 0, limit: 20 }, { bucketHash: other, windowSeconds: 900, limit: 0 },
    { bucketHash: other, windowSeconds: 900, limit: 20, extra: true },
    { bucketHash: Buffer.alloc(31), windowSeconds: 900, limit: 20 }]) {
    await assert.rejects(store.consumeRateLimit(hash, { now, windowSeconds: 60, limit: 120, network }), { code: "AUTH_STORE_INPUT" });
  }
  assert.equal(connections, 0);
});

test("failure to undo a refused network aborts the entire quota transaction and never commits", async () => {
  let commits = 0, rollbacks = 0, releases = 0;
  const connection = {
    async beginTransaction() {}, async commit() { commits++; }, async rollback() { rollbacks++; }, release() { releases++; },
    async query(sql, values) {
      if (sql.startsWith("SELECT window_started_at")) return [{ window_started_at: new Date(now), attempts: values[0].equals(hash) ? 1 : 21 }];
      if (sql.startsWith("ROLLBACK TO SAVEPOINT")) throw new Error("synthetic connection failure");
      return [];
    },
  };
  const store = createAuthStore({ async getConnection() { return connection; } });
  await assert.rejects(store.consumeRateLimit(hash, { now, windowSeconds: 60, limit: 120,
    network: { bucketHash: other, windowSeconds: 900, limit: 20 } }), { code: "AUTH_DATABASE_OPERATION" });
  assert.equal(commits, 0); assert.equal(rollbacks, 1); assert.equal(releases, 1);
});
