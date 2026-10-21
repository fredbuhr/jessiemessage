import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { enqueueNotification } from "../server/notifications/store.mjs";

const now = 1792594800000;
const sql = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
test("announcement message push expires at its useful deadline without changing ordinary message TTL", async () => {
  for (const [deadline, expected] of [[undefined, now + 86400000], [now + 60000, now + 60000], [now + 2 * 86400000, now + 86400000]]) {
    const calls = [], connection = { query: async (statement, values) => {
      calls.push([statement, values]); return statement.startsWith("SELECT") ? [{ id: randomBytes(16), generation: 1 }] : [];
    } };
    const context = { actor: { role: "admin" }, admin: { id: randomBytes(16) }, client: { id: randomBytes(16) }, now };
    await enqueueNotification(connection, context, { id: randomBytes(16), ...(deadline === undefined ? {} : { notificationExpiresAt: deadline }) });
    assert.equal(calls.length, 2); assert.equal(calls[1][1].at(-1), sql(expected));
  }
});
test("an already expired internal notification deadline refuses before any outbox write", async () => {
  for (const notificationExpiresAt of [now, now - 1, NaN, "later"]) {
    let queried = false;
    await assert.rejects(enqueueNotification({ query: async () => { queried = true; } }, { actor: { role: "admin" }, now }, { id: randomBytes(16), notificationExpiresAt }));
    assert.equal(queried, false);
  }
});
