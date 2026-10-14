import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { clientRecoveryConfiguration, ClientRecoveryConfigError } from "../server/reset/config.mjs";

const environment = () => ({
  JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "1", JESSIEMESSAGE_ENABLE_AUTH: "1",
  JESSIEMESSAGE_ENABLE_ACCESS: "1", JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1",
  JESSIEMESSAGE_SITE_ORIGIN: "https://example.invalid",
  JESSIEMESSAGE_MFA_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_MAIL_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_SMTP_HOST: "smtp.example.invalid", JESSIEMESSAGE_SMTP_PORT: "587",
  JESSIEMESSAGE_SMTP_USER: "synthetic-test-user", JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-test-password",
  JESSIEMESSAGE_SMTP_FROM: "no-reply@example.invalid",
});
const configuredError = (error) => error instanceof ClientRecoveryConfigError && error.code === "RESET_CONFIG";

test("client recovery defaults off and ignores unused mail or feature configuration", () => {
  assert.deepEqual(clientRecoveryConfiguration({}), { enabled: false });
  assert.deepEqual(clientRecoveryConfiguration({ JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "0",
    JESSIEMESSAGE_ENABLE_ACCESS: "invalid", JESSIEMESSAGE_MAIL_KEY: "invalid-private-key",
    JESSIEMESSAGE_SMTP_PASSWORD: "unused-private-password" }), { enabled: false });
  for (const flag of ["", "true", "false", "01", "2", 1, true, null]) {
    assert.throws(() => clientRecoveryConfiguration({ JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: flag }), configuredError);
  }
});

test("enabled recovery requires current client access, administrator authentication and TLS mail configuration", () => {
  const env = environment();
  for (const field of ["JESSIEMESSAGE_ENABLE_ACCESS", "JESSIEMESSAGE_ENABLE_AUTH", "JESSIEMESSAGE_ENABLE_MAIL_DELIVERY"]) {
    for (const value of [undefined, "0", "invalid"]) assert.throws(() => clientRecoveryConfiguration({ ...env, [field]: value }), configuredError);
  }
  for (const field of ["JESSIEMESSAGE_MFA_KEY", "JESSIEMESSAGE_MAIL_KEY", "JESSIEMESSAGE_SMTP_PASSWORD", "JESSIEMESSAGE_SMTP_HOST"]) {
    assert.throws(() => clientRecoveryConfiguration({ ...env, [field]: undefined }), configuredError);
  }
  for (const origin of ["http://example.invalid", "https://example.invalid/", "https://example.invalid/recover", "https://user:password@example.invalid"]) {
    assert.throws(() => clientRecoveryConfiguration({ ...env, JESSIEMESSAGE_SITE_ORIGIN: origin }), configuredError);
  }
  assert.throws(() => clientRecoveryConfiguration({ ...env, JESSIEMESSAGE_SMTP_PORT: "25" }), configuredError);
});

test("recovery reuses only the canonical mail key and rejects key aliases or MFA key reuse", () => {
  const env = environment(), canonical = Buffer.alloc(32).toString("base64url"), alias = `${canonical.slice(0, -1)}B`;
  assert.deepEqual(Buffer.from(alias, "base64url"), Buffer.from(canonical, "base64url"));
  for (const value of [undefined, null, "", Buffer.alloc(32), "A".repeat(42), "A".repeat(44), alias,
    `${env.JESSIEMESSAGE_MAIL_KEY}=`, `${env.JESSIEMESSAGE_MAIL_KEY}\n`, env.JESSIEMESSAGE_MFA_KEY]) {
    assert.throws(() => clientRecoveryConfiguration({ ...env, JESSIEMESSAGE_MAIL_KEY: value }), configuredError);
  }
  const before = { ...env }, result = clientRecoveryConfiguration(env);
  assert.deepEqual(Object.keys(result).sort(), ["enabled", "key", "origin"]);
  assert.equal(result.enabled, true); assert.equal(result.origin, env.JESSIEMESSAGE_SITE_ORIGIN);
  assert.deepEqual(result.key, Buffer.from(env.JESSIEMESSAGE_MAIL_KEY, "base64url"));
  assert.deepEqual(env, before);
});

test("recovery does not require chat, media or CRM and sanitizes dependency failures", () => {
  const env = environment();
  assert.equal(clientRecoveryConfiguration({ ...env, JESSIEMESSAGE_ENABLE_CHAT: "0",
    JESSIEMESSAGE_ENABLE_MEDIA: "0", JESSIEMESSAGE_ENABLE_CRM: "0" }).enabled, true);
  const secret = "synthetic-private-invalid-smtp-password-and-key";
  assert.throws(() => clientRecoveryConfiguration({ ...env, JESSIEMESSAGE_MAIL_KEY: secret }), (error) => {
    assert.ok(configuredError(error)); assert.equal(error.cause, undefined);
    assert.equal(error.message.includes(secret), false); assert.equal(JSON.stringify(error).includes(secret), false); return true;
  });
});
