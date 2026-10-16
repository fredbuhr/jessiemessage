import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createECDH, randomBytes } from "node:crypto";
import { endpointDigest, openSubscription, sealSubscription, NotificationCryptoError } from "../server/notifications/crypto.mjs";
import { validatePushEndpoint, validateSubscription, NotificationValidationError } from "../server/notifications/validation.mjs";

const key = randomBytes(32), binding = { subscriptionId: randomBytes(16), userId: randomBytes(16), generation: 1 };
function subscription(endpoint = "https://fcm.googleapis.com/fcm/send/synthetic-not-a-real-device") {
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  return { endpoint, expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
}
const inputError = (error) => error instanceof NotificationValidationError && error.code === "NOTIFICATIONS_INPUT";
const cryptoError = (error) => error instanceof NotificationCryptoError && error.code === "NOTIFICATIONS_CRYPTO" && error.retryable === false;

test("notification subscriptions accept supported opaque provider endpoints and preserve their queries", () => {
  for (const endpoint of ["https://fcm.googleapis.com/wp/synthetic", "https://updates.push.services.mozilla.com/wpush/v2/synthetic",
    "https://web.push.apple.com/synthetic", "https://new.web.push.apple.com/a%2Fb?token=opaque%2Fvalue",
    "https://db5.notify.windows.com/?token=opaque%2Bvalue"]) {
    assert.equal(validatePushEndpoint(endpoint), endpoint);
    assert.deepEqual(validateSubscription(subscription(endpoint)).endpoint, endpoint);
  }
});

test("notification endpoint validation rejects private and unrecognized destinations and alternate URL interpretations", () => {
  for (const endpoint of ["http://fcm.googleapis.com/a", "https://127.0.0.1/a", "https://[::1]/a", "https://2130706433/a",
    "https://fcm.googleapis.com.attacker.invalid/a", "https://push.apple.com/a", "https://notify.windows.com/a",
    "https://fcm.googleapis.com:444/a", "https://user:pass@fcm.googleapis.com/a", "https://fcm.googleapis.com/a#token",
    "https://fcm.googleapis.com/a\n", "https://fcm.googleapis.com/a\\b", "https://FCM.GOOGLEAPIS.COM/a",
    "https://fcm.googleapis.com/a/../b", "https://fcm.googleapis.com/" + "a".repeat(2049)]) {
    assert.throws(() => validatePushEndpoint(endpoint), inputError, endpoint);
  }
});

test("notification subscription keys must be canonical and represent a real uncompressed P-256 point", () => {
  const value = subscription();
  for (const mutated of [
    { ...value, unexpected: true }, { ...value, keys: { ...value.keys, auth: value.keys.auth + "=" } },
    { ...value, keys: { ...value.keys, p256dh: Buffer.alloc(65).toString("base64url") } },
    { ...value, keys: { ...value.keys, p256dh: randomBytes(65).toString("base64url") } },
    { ...value, expirationTime: -1 }, { ...value, expirationTime: 1.5 }, { ...value, expirationTime: "later" },
  ]) assert.throws(() => validateSubscription(mutated), inputError);
  const accessor = { ...value };
  Object.defineProperty(accessor, "endpoint", { enumerable: true, get() { throw new Error("must not execute"); } });
  assert.throws(() => validateSubscription(accessor), inputError);
  assert.deepEqual(validateSubscription({ endpoint: value.endpoint, keys: value.keys }), value);
});

test("notification encryption is randomized, confidential and tied to owner, subscription and generation", () => {
  const value = subscription(), first = sealSubscription(value, key, binding), second = sealSubscription(value, key, binding);
  assert.notEqual(first, second);
  assert.ok(!first.includes(value.endpoint) && !first.includes(value.keys.auth));
  assert.deepEqual(openSubscription(first, key, binding), value);
  for (const otherBinding of [{ ...binding, userId: randomBytes(16) }, { ...binding, subscriptionId: randomBytes(16) },
    { ...binding, generation: 2 }]) assert.throws(() => openSubscription(first, key, otherBinding), cryptoError);
  assert.throws(() => openSubscription(first, randomBytes(32), binding), cryptoError);
});

test("notification ciphertext rejects tampering, noncanonical envelopes and authenticated noncanonical JSON", () => {
  const value = subscription(), first = sealSubscription(value, key, binding), fields = first.split(".");
  const tag = Buffer.from(fields[3], "base64url"); tag[0] ^= 1;
  assert.throws(() => openSubscription([...fields.slice(0, 3), tag.toString("base64url")].join("."), key, binding), cryptoError);
  for (const envelope of [first + "=", first + ".extra", first.replace(/^v1/, "v2"), "a".repeat(4097)]) {
    assert.throws(() => openSubscription(envelope, key, binding), cryptoError);
  }
  function authenticated(text) {
    const generation = Buffer.alloc(4); generation.writeUInt32BE(binding.generation);
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(Buffer.concat([Buffer.from("jessiemessage:push-subscription:v1:\0"), binding.subscriptionId, binding.userId, generation]));
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
    return `v1.${nonce.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
  }
  for (const text of [JSON.stringify(value, null, 1), "\ufeff" + JSON.stringify(value),
    JSON.stringify(value).replace('"expirationTime":null', '"expirationTime":null,"expirationTime":null')]) {
    assert.throws(() => openSubscription(authenticated(text), key, binding), cryptoError);
  }
});

test("notification endpoint digests are deterministic, keyed and different from exposed URLs", () => {
  const endpoint = subscription().endpoint;
  assert.deepEqual(endpointDigest(endpoint, key), endpointDigest(endpoint, key));
  assert.equal(endpointDigest(endpoint, key).length, 32);
  assert.notDeepEqual(endpointDigest(endpoint, key), endpointDigest(endpoint, randomBytes(32)));
});
