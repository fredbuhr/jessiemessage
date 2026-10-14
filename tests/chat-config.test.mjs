import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chatConfiguration } from "../server/chat/config.mjs";

const environment = () => ({
  JESSIEMESSAGE_ENABLE_CHAT: "1", JESSIEMESSAGE_ENABLE_AUTH: "1", JESSIEMESSAGE_ENABLE_ACCESS: "1",
  JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1", JESSIEMESSAGE_SITE_ORIGIN: "https://example.invalid",
  JESSIEMESSAGE_MESSAGE_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_MFA_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_MAIL_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_SMTP_HOST: "smtp.example.invalid", JESSIEMESSAGE_SMTP_PORT: "587",
  JESSIEMESSAGE_SMTP_USER: "synthetic-test-user", JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-test-password",
  JESSIEMESSAGE_SMTP_FROM: "no-reply@example.invalid",
});

test("chat stays closed by default and disabled mode does not inspect unrelated private configuration", () => {
  assert.deepEqual(chatConfiguration({}), { enabled: false });
  assert.deepEqual(chatConfiguration({ JESSIEMESSAGE_ENABLE_CHAT: "0", JESSIEMESSAGE_ENABLE_AUTH: "invalid",
    JESSIEMESSAGE_MESSAGE_KEY: "invalid", JESSIEMESSAGE_SITE_ORIGIN: "http://invalid" }), { enabled: false });
  for (const flag of ["", "true", "false", "2", "01", 1, true, null]) {
    assert.throws(() => chatConfiguration({ JESSIEMESSAGE_ENABLE_CHAT: flag }), { code: "CHAT_CONFIG" });
  }
});

test("enabled chat requires complete current authentication, access and email delivery configuration", () => {
  const env = environment();
  for (const field of ["JESSIEMESSAGE_ENABLE_AUTH", "JESSIEMESSAGE_ENABLE_ACCESS", "JESSIEMESSAGE_ENABLE_MAIL_DELIVERY"]) {
    for (const value of [undefined, "0"]) assert.throws(() => chatConfiguration({ ...env, [field]: value }));
  }
  assert.throws(() => chatConfiguration({ ...env, JESSIEMESSAGE_SMTP_PASSWORD: undefined }), { code: "MAIL_CONFIG" });
  assert.throws(() => chatConfiguration({ ...env, JESSIEMESSAGE_MFA_KEY: undefined }), { code: "AUTH_CONFIG" });
  for (const origin of ["http://example.invalid", "https://example.invalid/", "https://example.invalid/path", "https://user:password@example.invalid"]) {
    assert.throws(() => chatConfiguration({ ...env, JESSIEMESSAGE_SITE_ORIGIN: origin }), { code: "AUTH_CONFIG" });
  }
});

test("message key must be a canonical explicit 256-bit key separate from MFA and mail keys", () => {
  const env = environment();
  const canonical = Buffer.alloc(32).toString("base64url");
  const alias = `${canonical.slice(0, -1)}B`;
  assert.deepEqual(Buffer.from(alias, "base64url"), Buffer.from(canonical, "base64url"));
  for (const value of [undefined, null, "", Buffer.alloc(32), env.JESSIEMESSAGE_MESSAGE_KEY + "=", "A".repeat(42), "A".repeat(44), alias,
    env.JESSIEMESSAGE_MFA_KEY, env.JESSIEMESSAGE_MAIL_KEY]) {
    assert.throws(() => chatConfiguration({ ...env, JESSIEMESSAGE_MESSAGE_KEY: value }), { code: "CHAT_CONFIG" });
  }
  assert.throws(() => chatConfiguration({ ...env, JESSIEMESSAGE_MAIL_KEY: env.JESSIEMESSAGE_MFA_KEY }), { code: "AUTH_CONFIG" });
});

test("chat configuration preserves the HTTPS origin and exposes only its independent decoded key", () => {
  const env = environment();
  const original = { ...env };
  const config = chatConfiguration(env);
  assert.deepEqual(Object.keys(config).sort(), ["enabled", "key", "origin"]);
  assert.equal(config.enabled, true); assert.equal(config.origin, env.JESSIEMESSAGE_SITE_ORIGIN);
  assert.ok(Buffer.isBuffer(config.key)); assert.equal(config.key.length, 32);
  assert.equal(config.key.toString("base64url"), env.JESSIEMESSAGE_MESSAGE_KEY);
  assert.deepEqual(env, original);
  const badKey = `${env.JESSIEMESSAGE_MESSAGE_KEY}=`;
  assert.throws(() => chatConfiguration({ ...env, JESSIEMESSAGE_MESSAGE_KEY: badKey }), (error) => {
    assert.equal(error.code, "CHAT_CONFIG"); assert.equal(error.message.includes(badKey), false); assert.equal(error.cause, undefined);
    return true;
  });
});
