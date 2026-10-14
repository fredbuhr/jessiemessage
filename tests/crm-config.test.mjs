import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { crmConfiguration, CrmConfigError } from "../server/crm/config.mjs";

const environment = () => ({
  JESSIEMESSAGE_ENABLE_CRM: "1", JESSIEMESSAGE_ENABLE_CHAT: "1", JESSIEMESSAGE_ENABLE_AUTH: "1",
  JESSIEMESSAGE_ENABLE_ACCESS: "1", JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1",
  JESSIEMESSAGE_SITE_ORIGIN: "https://example.invalid",
  JESSIEMESSAGE_CRM_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_MESSAGE_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_MFA_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_MAIL_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_SMTP_HOST: "smtp.example.invalid", JESSIEMESSAGE_SMTP_PORT: "587",
  JESSIEMESSAGE_SMTP_USER: "synthetic-test-user", JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-test-password",
  JESSIEMESSAGE_SMTP_FROM: "no-reply@example.invalid",
});

test("CRM remains disabled without evaluating unused keys or dependencies", () => {
  assert.deepEqual(crmConfiguration({}), { enabled: false });
  assert.deepEqual(crmConfiguration({ JESSIEMESSAGE_ENABLE_CRM: "0", JESSIEMESSAGE_ENABLE_CHAT: "invalid",
    JESSIEMESSAGE_CRM_KEY: "private-invalid-key", JESSIEMESSAGE_MEDIA_KEY: "invalid" }), { enabled: false });
  for (const flag of ["", "true", "false", "01", "2", 1, true, null]) {
    assert.throws(() => crmConfiguration({ JESSIEMESSAGE_ENABLE_CRM: flag }), { code: "CRM_CONFIG" });
  }
});

test("enabled CRM requires complete authenticated chat and wraps dependency configuration errors", () => {
  const env = environment();
  for (const field of ["JESSIEMESSAGE_ENABLE_CHAT", "JESSIEMESSAGE_ENABLE_AUTH", "JESSIEMESSAGE_ENABLE_ACCESS", "JESSIEMESSAGE_ENABLE_MAIL_DELIVERY"]) {
    for (const value of [undefined, "0", "invalid"]) assert.throws(() => crmConfiguration({ ...env, [field]: value }), { code: "CRM_CONFIG" });
  }
  for (const field of ["JESSIEMESSAGE_MESSAGE_KEY", "JESSIEMESSAGE_MFA_KEY", "JESSIEMESSAGE_MAIL_KEY", "JESSIEMESSAGE_SMTP_PASSWORD"]) {
    assert.throws(() => crmConfiguration({ ...env, [field]: undefined }), { code: "CRM_CONFIG" });
  }
  for (const origin of ["http://example.invalid", "https://example.invalid/", "https://example.invalid/path"]) {
    assert.throws(() => crmConfiguration({ ...env, JESSIEMESSAGE_SITE_ORIGIN: origin }), { code: "CRM_CONFIG" });
  }
});

test("CRM requires a canonical independent 256-bit key including separation from optional media", () => {
  const env = environment(), canonical = Buffer.alloc(32).toString("base64url"), alias = `${canonical.slice(0, -1)}B`;
  assert.deepEqual(Buffer.from(canonical, "base64url"), Buffer.from(alias, "base64url"));
  for (const value of [undefined, null, "", Buffer.alloc(32), "A".repeat(42), "A".repeat(44), alias,
    `${env.JESSIEMESSAGE_CRM_KEY}=`, `${env.JESSIEMESSAGE_CRM_KEY}\n`, env.JESSIEMESSAGE_MESSAGE_KEY,
    env.JESSIEMESSAGE_MFA_KEY, env.JESSIEMESSAGE_MAIL_KEY]) {
    assert.throws(() => crmConfiguration({ ...env, JESSIEMESSAGE_CRM_KEY: value }), { code: "CRM_CONFIG" });
  }
  assert.throws(() => crmConfiguration({ ...env, JESSIEMESSAGE_MEDIA_KEY: env.JESSIEMESSAGE_CRM_KEY }), { code: "CRM_CONFIG" });
  for (const value of ["", "invalid", alias, Buffer.alloc(32), null]) {
    assert.throws(() => crmConfiguration({ ...env, JESSIEMESSAGE_MEDIA_KEY: value }), { code: "CRM_CONFIG" });
  }
});

test("CRM may operate without media and exposes only its own key and canonical origin", () => {
  const env = environment(), original = { ...env }, result = crmConfiguration(env);
  assert.deepEqual(Object.keys(result).sort(), ["enabled", "key", "origin"]);
  assert.equal(result.enabled, true); assert.equal(result.origin, env.JESSIEMESSAGE_SITE_ORIGIN);
  assert.deepEqual(result.key, Buffer.from(env.JESSIEMESSAGE_CRM_KEY, "base64url"));
  assert.deepEqual(env, original);
  assert.equal(crmConfiguration({ ...env, JESSIEMESSAGE_ENABLE_MEDIA: "0", JESSIEMESSAGE_MEDIA_KEY: randomBytes(32).toString("base64url") }).enabled, true);
  const secret = "synthetic-secret-invalid-crm-key";
  assert.throws(() => crmConfiguration({ ...env, JESSIEMESSAGE_CRM_KEY: secret }), (error) => {
    assert.ok(error instanceof CrmConfigError); assert.equal(error.message.includes(secret), false);
    assert.equal(error.cause, undefined); return true;
  });
});
