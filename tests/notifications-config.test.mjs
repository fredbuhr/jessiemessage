import test from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { loadNotificationsConfig, validateNotificationVapid } from "../server/notifications/config.mjs";

function environment() {
  const curve = createECDH("prime256v1"); curve.generateKeys();
  return {
    JESSIEMESSAGE_ENABLE_NOTIFICATIONS: "1", JESSIEMESSAGE_ENABLE_CHAT: "1", JESSIEMESSAGE_ENABLE_AUTH: "1", JESSIEMESSAGE_ENABLE_ACCESS: "1",
    JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1", JESSIEMESSAGE_SITE_ORIGIN: "https://example.invalid",
    ...Object.fromEntries(["MFA", "MAIL", "MESSAGE", "MEDIA", "CRM", "NOTIFICATIONS"].map((name) => [`JESSIEMESSAGE_${name}_KEY`, randomBytes(32).toString("base64url")])),
    JESSIEMESSAGE_VAPID_PUBLIC_KEY: curve.getPublicKey().toString("base64url"), JESSIEMESSAGE_VAPID_PRIVATE_KEY: Buffer.concat([Buffer.alloc(32), curve.getPrivateKey()]).subarray(-32).toString("base64url"),
    JESSIEMESSAGE_VAPID_SUBJECT: "mailto:contact@jessiemessage.com",
    JESSIEMESSAGE_SMTP_HOST: "smtp.example.invalid", JESSIEMESSAGE_SMTP_PORT: "587", JESSIEMESSAGE_SMTP_USER: "synthetic-user",
    JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-password", JESSIEMESSAGE_SMTP_FROM: "no-reply@example.invalid",
  };
}

test("notification configuration is closed by default and disabled mode needs no private material", () => {
  assert.deepEqual(loadNotificationsConfig({}), { enabled: false });
  assert.deepEqual(loadNotificationsConfig({ JESSIEMESSAGE_ENABLE_NOTIFICATIONS: "0", JESSIEMESSAGE_VAPID_PRIVATE_KEY: "invalid" }), { enabled: false });
  for (const value of [null, 1, true, "", "true", "01", "2"]) assert.throws(() => loadNotificationsConfig({ JESSIEMESSAGE_ENABLE_NOTIFICATIONS: value }), { code: "NOTIFICATIONS_CONFIG" });
});

test("enabled notifications validate the complete chat dependencies and independent canonical keys", () => {
  const env = environment(), original = { ...env }, config = loadNotificationsConfig(env);
  assert.equal(config.enabled, true); assert.equal(config.origin, env.JESSIEMESSAGE_SITE_ORIGIN);
  assert.equal(config.key.toString("base64url"), env.JESSIEMESSAGE_NOTIFICATIONS_KEY);
  assert.equal(config.vapid.subject, "mailto:contact@jessiemessage.com");
  assert.deepEqual(config.worker, { batchSize: 5, pollMilliseconds: 2000, leaseMilliseconds: 90000, maxAttempts: 6 });
  assert.deepEqual(config.transport, { deadlineMilliseconds: 10000, maxResponseBytes: 8192, ttlSeconds: 86400 });
  assert.deepEqual(env, original);
  for (const name of ["ENABLE_CHAT", "ENABLE_AUTH", "ENABLE_ACCESS", "ENABLE_MAIL_DELIVERY", "MFA_KEY", "MAIL_KEY", "MESSAGE_KEY", "NOTIFICATIONS_KEY", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
    assert.throws(() => loadNotificationsConfig({ ...env, [`JESSIEMESSAGE_${name}`]: undefined }), { code: "NOTIFICATIONS_CONFIG" });
  }
  for (const name of ["MFA", "MAIL", "MESSAGE", "MEDIA", "CRM"]) {
    assert.throws(() => loadNotificationsConfig({ ...env, JESSIEMESSAGE_NOTIFICATIONS_KEY: env[`JESSIEMESSAGE_${name}_KEY`] }), { code: "NOTIFICATIONS_CONFIG" });
    assert.throws(() => loadNotificationsConfig({ ...env, [`JESSIEMESSAGE_${name}_KEY`]: env.JESSIEMESSAGE_VAPID_PRIVATE_KEY }), { code: "NOTIFICATIONS_CONFIG" });
  }
  assert.throws(() => loadNotificationsConfig({ ...env, JESSIEMESSAGE_NOTIFICATIONS_KEY: env.JESSIEMESSAGE_VAPID_PRIVATE_KEY }), { code: "NOTIFICATIONS_CONFIG" });
  for (const key of [env.JESSIEMESSAGE_NOTIFICATIONS_KEY + "=", "A".repeat(10000), "A".repeat(42), "A".repeat(42) + "B"]) {
    assert.throws(() => loadNotificationsConfig({ ...env, JESSIEMESSAGE_NOTIFICATIONS_KEY: key }), { code: "NOTIFICATIONS_CONFIG" });
  }
});

test("VAPID validates a real P-256 pair without needing other runtime secrets and errors disclose none", () => {
  const env = environment();
  const vapid = { publicKey: env.JESSIEMESSAGE_VAPID_PUBLIC_KEY, privateKey: env.JESSIEMESSAGE_VAPID_PRIVATE_KEY, subject: env.JESSIEMESSAGE_VAPID_SUBJECT };
  assert.deepEqual(validateNotificationVapid(vapid), vapid);
  const other = environment();
  for (const bad of [{ ...vapid, publicKey: other.JESSIEMESSAGE_VAPID_PUBLIC_KEY }, { ...vapid, privateKey: "A".repeat(43) },
    { ...vapid, publicKey: Buffer.alloc(65).toString("base64url") }, { ...vapid, subject: "https://localhost" },
    { ...vapid, subject: "mailto:elsewhere@example.invalid" }, { ...vapid, privateKey: vapid.privateKey + "=" }]) {
    assert.throws(() => validateNotificationVapid(bad), (error) => {
      assert.equal(error.code, "NOTIFICATIONS_CONFIG"); assert.equal(error.cause, undefined);
      assert.equal(JSON.stringify(error).includes(vapid.privateKey), false); return true;
    });
  }
});
