import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { ChatStoreError } from "../server/chat/store.mjs";
import { sealSubscription } from "../server/notifications/crypto.mjs";
import { createNotificationsStore, NotificationStoreError } from "../server/notifications/store.mjs";

const id = () => randomBytes(16), key = randomBytes(32), now = Date.UTC(2026, 9, 17, 12);
const ownerId = id(), sessionId = id(), request = { role: "admin", tokenHash: randomBytes(32), now };
function subscription() {
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/wp/synthetic-${id().toString("hex")}`, expirationTime: null,
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
}

// The SQL owner intentionally replaces all foreign callback exceptions, just
// like ChatStore.run. These tests exercise the boundary without a database.
function bridge(query, { commitFails = false } = {}) {
  const events = [];
  const chatStore = { async withActor(_request, operation) {
    events.push("begin");
    try {
      const result = await operation({ query: async (sql, parameters) => {
        if (sql.includes("FROM sessions s")) return [{ id: sessionId, credential_version: 1 }];
        return query(sql, parameters);
      } }, { actor: { id: ownerId, role: "admin" }, now });
      if (commitFails) throw new Error("synthetic SQL commit error with private connection details");
      events.push("commit"); return result;
    } catch {
      events.push("rollback");
      throw new ChatStoreError("CHAT_DATABASE_OPERATION");
    }
  } };
  const store = createNotificationsStore({ pool: { getConnection() { throw new Error("chat owns this transaction"); } }, chatStore, key });
  return { store, events };
}

test("notification endpoint conflicts survive the chat transaction sanitizer only after rollback", async () => {
  const { store, events } = bridge(async (sql) => {
    assert.match(sql, /FROM push_subscriptions WHERE endpoint_digest/);
    return [{ id: id(), user_id: id() }];
  });
  await assert.rejects(store.subscribe({ ...request, subscription: subscription(), locale: "fr" }), (error) => {
    assert.deepEqual(events, ["begin", "rollback"]);
    assert.ok(error instanceof NotificationStoreError); assert.equal(error.code, "NOTIFICATIONS_CONFLICT");
    assert.equal(error.cause, undefined); return true;
  });
});

test("notification device limits preserve their typed failure through asynchronous rollback", async () => {
  const active = Array.from({ length: 16 }, () => {
    const subscriptionId = id();
    return { id: subscriptionId, user_id: ownerId, generation: 1,
      subscription_encrypted: sealSubscription(subscription(), key, { subscriptionId, userId: ownerId, generation: 1 }) };
  });
  const { store, events } = bridge(async (sql) => {
    if (sql.includes("WHERE endpoint_digest")) return [];
    if (sql.startsWith("UPDATE push_subscriptions")) return { affectedRows: 0 };
    assert.match(sql, /WHERE user_id = \? AND enabled = 1/); return active;
  });
  await assert.rejects(store.subscribe({ ...request, subscription: subscription(), locale: "fr" }), (error) => {
    assert.deepEqual(events, ["begin", "rollback"]);
    return error instanceof NotificationStoreError && error.code === "NOTIFICATIONS_LIMIT";
  });
});

test("raw SQL errors cannot masquerade as trusted notification domain failures", async () => {
  const { store, events } = bridge(async () => {
    throw Object.assign(new Error("private SQL endpoint and credentials must remain hidden"), { code: "NOTIFICATIONS_CONFLICT" });
  });
  await assert.rejects(store.subscribe({ ...request, subscription: subscription(), locale: "fr" }), (error) => {
    assert.deepEqual(events, ["begin", "rollback"]);
    return error instanceof ChatStoreError && error.code === "CHAT_DATABASE_OPERATION"
      && !error.message.includes("credentials") && error.cause === undefined;
  });
});

test("a failure after a successful callback remains a sanitized transaction failure", async () => {
  const { store, events } = bridge(async () => [], { commitFails: true });
  await assert.rejects(store.disable({ ...request, id: id() }), (error) => {
    assert.deepEqual(events, ["begin", "rollback"]);
    return error instanceof ChatStoreError && error.code === "CHAT_DATABASE_OPERATION" && !error.message.includes("connection details");
  });
});

test("chat authorization failures before the callback retain their original boundary", async () => {
  const expected = new ChatStoreError("CHAT_UNAUTHORIZED");
  const store = createNotificationsStore({ pool: { getConnection() {} }, key,
    chatStore: { async withActor() { throw expected; } } });
  await assert.rejects(store.status(request), (error) => error === expected);
});
