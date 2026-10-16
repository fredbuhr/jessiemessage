import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, createHmac } from "node:crypto";
import { tokenDigest } from "../server/auth/crypto.mjs";
import { endpointDigest } from "../server/notifications/crypto.mjs";
import { createNotificationsService, NotificationsError } from "../server/notifications/service.mjs";

const now = Date.UTC(2026, 9, 17), userId = "bb".repeat(16), subscriptionId = "aa".repeat(16);
const token = Buffer.alloc(32, 4).toString("base64url"), otherToken = Buffer.alloc(32, 9).toString("base64url");
const publicKey = createECDH("prime256v1").generateKeys().toString("base64url");
const endpoint = "https://fcm.googleapis.com/fcm/send/private-browser-endpoint";
const subscription = { endpoint, expirationTime: null, keys: { p256dh: publicKey, auth: Buffer.alloc(16, 4).toString("base64url") } };
const row = (changes = {}) => ({ id: subscriptionId, enabled: true, createdAt: now, updatedAt: now,
  endpoint, ciphertext: "private-ciphertext", keys: subscription.keys, ...changes });
const hasCode = (code) => (error) => error instanceof NotificationsError && error.code === code
  && error.cause === undefined && !error.message.includes("private");
async function fixture() {
  const calls = [], rateCalls = [], actorCalls = [], key = Buffer.alloc(32, 13), state = { time: now, actorError: null,
    rates: [], status: { subscriptions: [row()], currentId: subscriptionId }, subscribed: row(), disabled: true };
  const store = Object.fromEntries(["status", "subscribe", "disable"].map((method) => [method, async (request) => {
    calls.push({ method, request });
    if (state.storeError) throw state.storeError;
    return method === "status" ? state.status : method === "subscribe" ? state.subscribed : state.disabled;
  }]));
  const config = { enabled: true, key, vapid: { publicKey, privateKey: "private-vapid-key", subject: "mailto:contact@jessiemessage.com" } };
  const options = { store, config, clock: () => state.time, chatService: { async actor(role, raw) {
    actorCalls.push({ role, raw }); if (state.actorError) throw state.actorError;
    return state.actorValue ?? { user: { id: userId, role, pseudonym: "Fictional account" }, csrf: Buffer.alloc(32, 7).toString("base64url"), expiresAt: now + 600000 };
  } }, authStore: { async consumeRateLimit(bucket, input) {
    rateCalls.push({ bucket, input }); if (state.rateError) throw state.rateError;
    return state.rates.length ? state.rates.shift() : { allowed: true };
  } } };
  return { service: await createNotificationsService(options), options, state, calls, rateCalls, actorCalls, key, config, store };
}

test("notifications service requires enabled configuration, explicit key/VAPID and every authorization dependency", async () => {
  const f = await fixture();
  for (const config of [undefined, { ...f.config, enabled: false }, { ...f.config, enabled: undefined }, { ...f.config, key: Buffer.alloc(31) },
    { ...f.config, vapid: {} }, { ...f.config, vapid: { publicKey: "private-key" } }, { ...f.config, vapid: { publicKey: Buffer.alloc(65).toString("base64url") } }]) {
    await assert.rejects(createNotificationsService({ ...f.options, config }), hasCode("NOTIFICATIONS_CONFIG"));
  }
  for (const changes of [{ authStore: {} }, { chatService: {} }, { store: {} }, { clock: null }]) await assert.rejects(createNotificationsService({ ...f.options, ...changes }), hasCode("NOTIFICATIONS_CONFIG"));
});

test("capabilities publish only the public VAPID key and the current account's safe device metadata", async () => {
  const f = await fixture();
  for (const role of ["admin", "client"]) {
    const result = await f.service.capabilities(role, token);
    assert.deepEqual(result, { enabled: true, vapidPublicKey: publicKey, subscriptions: [{ id: subscriptionId, enabled: true, createdAt: now, updatedAt: now }] });
    assert.doesNotMatch(JSON.stringify(result), /private-|endpoint|ciphertext|p256dh|ownerId/);
    assert.deepEqual(f.calls.at(-1), { method: "status", request: { role, tokenHash: tokenDigest(token), now } });
  }
});

test("status hashes the exact endpoint privately and hides absent, disabled and other-account subscriptions", async () => {
  const f = await fixture();
  assert.deepEqual(await f.service.status("admin", token, { endpoint }), { enabled: true, subscriptionId });
  assert.deepEqual(f.calls.at(-1).request, { role: "admin", tokenHash: tokenDigest(token), now, endpointDigest: endpointDigest(endpoint, f.key) });
  assert.equal(Object.hasOwn(f.calls.at(-1).request, "endpoint"), false);
  for (const result of [{ subscriptions: [], currentId: null }, { subscriptions: [row()], currentId: null }, { subscriptions: [row({ enabled: false })], currentId: null }]) {
    f.state.status = result;
    assert.deepEqual(await f.service.status("admin", token, { endpoint }), { enabled: false, subscriptionId: null });
  }
});

test("subscribe forwards validated browser keys, session proof and locale while returning no private transport data", async () => {
  const f = await fixture();
  for (const role of ["admin", "client"]) for (const language of ["fr", "en"]) {
    assert.deepEqual(await f.service.subscribe(role, token, { subscription, language }), { enabled: true, subscriptionId });
    assert.deepEqual(f.calls.at(-1), { method: "subscribe", request: { role, tokenHash: tokenDigest(token), now, subscription, locale: language } });
  }
});

test("disable targets one owned binary ID, is safe to repeat and never accepts a whole-account mutation", async () => {
  const f = await fixture();
  for (let count = 0; count < 2; count += 1) {
    assert.deepEqual(await f.service.disable("admin", token, { id: subscriptionId }), { enabled: false });
    assert.deepEqual(f.calls.at(-1), { method: "disable", request: { role: "admin", tokenHash: tokenDigest(token), now, id: Buffer.from(subscriptionId, "hex") } });
  }
  f.state.disabled = false;
  await assert.rejects(f.service.disable("admin", token, { id: subscriptionId }), hasCode("NOTIFICATIONS_NOT_FOUND"));
  await assert.rejects(f.service.disable("admin", token, { id: subscriptionId, allDevices: true }), hasCode("NOTIFICATIONS_INPUT"));
});

test("role, token and current authorization are required before spending budgets or accessing SQL metadata", async () => {
  const f = await fixture();
  await assert.rejects(f.service.capabilities("other", token), hasCode("NOTIFICATIONS_INPUT"));
  await assert.rejects(f.service.capabilities("admin", "private-invalid-token"), hasCode("CHAT_UNAUTHORIZED"));
  f.state.actorError = Object.assign(new Error("private auth details"), { code: "AUTH_INVALID" });
  await assert.rejects(f.service.capabilities("admin", token), hasCode("CHAT_UNAUTHORIZED"));
  f.state.actorError = null; f.state.actorValue = { user: { id: userId, role: "client" } };
  await assert.rejects(f.service.capabilities("admin", token), hasCode("CHAT_UNAUTHORIZED"));
  f.state.actorValue = { user: { id: "private-id", role: "admin" } };
  await assert.rejects(f.service.capabilities("admin", token), hasCode("NOTIFICATIONS_UNAVAILABLE"));
  assert.equal(f.rateCalls.length, 0); assert.equal(f.calls.length, 0);
});

test("malformed endpoint, locale, nested keys and spoofed identities never reach rate SQL or subscription persistence", async () => {
  const f = await fixture();
  for (const candidate of ["http://fcm.googleapis.com/fcm/send/x", "https://127.0.0.1/private", "https://other.invalid/private", "https://fcm.googleapis.com:443/fcm/send/x", endpoint + "\n"]) {
    await assert.rejects(f.service.status("admin", token, { endpoint: candidate }), hasCode("NOTIFICATIONS_INPUT"));
  }
  for (const input of [{ subscription, language: "jp" }, { subscription, language: "fr", ownerId: userId },
    { subscription: { ...subscription, userId }, language: "fr" }, { subscription: { ...subscription, keys: { ...subscription.keys, auth: "private" } }, language: "fr" },
    { subscription: { ...subscription, expirationTime: true }, language: "fr" }, { subscription, language: undefined }]) {
    await assert.rejects(f.service.subscribe("admin", token, input), hasCode("NOTIFICATIONS_INPUT"));
  }
  for (const candidate of [null, "AA".repeat(16), subscriptionId + "\n", Buffer.from(subscriptionId, "hex")]) await assert.rejects(f.service.disable("admin", token, { id: candidate }), hasCode("NOTIFICATIONS_INPUT"));
  assert.equal(f.rateCalls.length, 0); assert.equal(f.calls.length, 0);
});

test("notification read/update budgets are distinct private HMAC buckets shared across an account's sessions", async () => {
  const f = await fixture();
  await f.service.capabilities("admin", token); await f.service.status("admin", otherToken, { endpoint });
  assert.deepEqual(f.rateCalls[0].bucket, f.rateCalls[2].bucket); assert.deepEqual(f.rateCalls[1].bucket, f.rateCalls[3].bucket);
  const expected = createHmac("sha256", f.key).update("jessiemessage:notifications-rate:v1:").update("user-read").update("\0").update(`admin:${userId}`).digest();
  assert.deepEqual(f.rateCalls[0].bucket, expected);
  assert.deepEqual(f.rateCalls[0].input, { now, windowSeconds: 60, limit: 120 });
  assert.deepEqual(f.rateCalls[1].input, { now, windowSeconds: 60, limit: 600 });
  await f.service.disable("admin", token, { id: subscriptionId });
  assert.notDeepEqual(f.rateCalls[0].bucket, f.rateCalls[4].bucket);
  assert.deepEqual(f.rateCalls[4].input, { now, windowSeconds: 60, limit: 30 });
  assert.deepEqual(f.rateCalls[5].input, { now, windowSeconds: 60, limit: 300 });
});

test("an exhausted account cannot spend the global allowance or reach subscription SQL", async () => {
  const f = await fixture(); f.state.rates = [{ allowed: false, retryAfter: 1.2 }];
  await assert.rejects(f.service.capabilities("admin", token), (error) => hasCode("NOTIFICATIONS_RATE_LIMIT")(error) && error.retryAfter === 2);
  assert.equal(f.rateCalls.length, 1); assert.equal(f.calls.length, 0);
  f.state.rates = [{ allowed: true }, { allowed: false, retryAfter: Infinity }];
  await assert.rejects(f.service.disable("admin", token, { id: subscriptionId }), (error) => hasCode("NOTIFICATIONS_RATE_LIMIT")(error) && error.retryAfter === 60);
  assert.equal(f.calls.length, 0);
});

test("every SQL operation receives the fresh time after quotas, so expiry/revocation during a wait is enforced by the store", async () => {
  const operations = [(f) => f.service.capabilities("admin", token), (f) => f.service.status("admin", token, { endpoint }),
    (f) => f.service.subscribe("admin", token, { subscription, language: "fr" }), (f) => f.service.disable("admin", token, { id: subscriptionId })];
  for (const operation of operations) {
    const f = await fixture(), consume = f.options.authStore.consumeRateLimit;
    f.options.authStore.consumeRateLimit = async (...args) => { const result = await consume(...args); f.state.time += 1000; return result; };
    f.state.storeError = Object.assign(new Error("private expired session"), { code: "ACCESS_EXPIRED" });
    await assert.rejects(operation(f), hasCode("ACCESS_EXPIRED"));
    assert.equal(f.calls.at(-1).request.now, now + 2000);
  }
});

test("status and subscribe validate fresh store timestamps after pending SQL locks rather than against request-start time", async () => {
  for (const operation of ["capabilities", "status", "subscribe"]) {
    const f = await fixture();
    const method = operation === "subscribe" ? "subscribe" : "status";
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    let entered;
    const entering = new Promise((resolve) => { entered = resolve; });
    f.store[method] = async (request) => {
      assert.equal(request.now, now); entered(); await blocked;
      const fresh = row({ updatedAt: f.state.time });
      return method === "subscribe" ? fresh : { subscriptions: [fresh], currentId: subscriptionId };
    };
    const pending = operation === "capabilities" ? f.service.capabilities("admin", token)
      : operation === "status" ? f.service.status("admin", token, { endpoint })
        : f.service.subscribe("admin", token, { subscription, language: "fr" });
    await entering; f.state.time += 5000; release();
    const result = await pending;
    assert.equal(result.enabled, true);
    if (operation === "capabilities") assert.equal(result.subscriptions[0].updatedAt, now + 5000);
    else assert.equal(result.subscriptionId, subscriptionId);
  }
});

test("malformed clocks, rate acknowledgements and result DTOs fail closed without exposing endpoint or secrets", async () => {
  for (const bad of [NaN, -1, now + 0.5, 253402300800000]) {
    const f = await fixture(); f.state.time = bad;
    await assert.rejects(f.service.capabilities("admin", token), hasCode("NOTIFICATIONS_UNAVAILABLE")); assert.equal(f.calls.length, 0);
  }
  for (const status of [{ subscriptions: [row({ enabled: undefined })] }, { subscriptions: [row({ updatedAt: now + 1 })] },
    { subscriptions: [row({ createdAt: now + 1 })] }, { subscriptions: [row(), row()] }, { subscriptions: [] , currentId: "private-id" }]) {
    const f = await fixture(); f.state.status = status;
    await assert.rejects(f.service.status("admin", token, { endpoint }), hasCode("NOTIFICATIONS_UNAVAILABLE"));
  }
  const f = await fixture(); f.state.rates = [{}];
  await assert.rejects(f.service.capabilities("admin", token), hasCode("NOTIFICATIONS_UNAVAILABLE")); assert.equal(f.calls.length, 0);
  f.state.subscribed = row({ enabled: false });
  await assert.rejects(f.service.subscribe("admin", token, { subscription, language: "fr" }), hasCode("NOTIFICATIONS_UNAVAILABLE"));
  f.state.disabled = { endpoint };
  await assert.rejects(f.service.disable("admin", token, { id: subscriptionId }), hasCode("NOTIFICATIONS_UNAVAILABLE"));
});

test("safe store conflicts/authentication survive sanitization, unexpected SQL and crypto errors do not", async () => {
  for (const code of ["NOTIFICATIONS_CONFLICT", "NOTIFICATIONS_LIMIT", "CHAT_UNAUTHORIZED", "ACCESS_PREREQUISITES", "AUTH_BUSY", "ER_PRIVATE_SQL", "NOTIFICATIONS_CRYPTO"]) {
    const f = await fixture(); f.state.storeError = Object.assign(new Error(endpoint), { code, retryAfter: 5, privateKey: "private-vapid" });
    await assert.rejects(f.service.subscribe("admin", token, { subscription, language: "fr" }), hasCode(["ER_PRIVATE_SQL", "NOTIFICATIONS_CRYPTO"].includes(code) ? "NOTIFICATIONS_UNAVAILABLE" : code));
  }
});

test("service snapshots its cryptographic key and public key instead of retaining mutable configuration", async () => {
  const f = await fixture(), originalKey = Buffer.from(f.key), expected = endpointDigest(endpoint, originalKey);
  f.config.key.fill(0); f.config.vapid.publicKey = "private-mutated";
  await f.service.status("admin", token, { endpoint }); assert.deepEqual(f.calls.at(-1).request.endpointDigest, expected);
  const result = await f.service.capabilities("admin", token); assert.equal(result.vapidPublicKey, publicKey);
});
