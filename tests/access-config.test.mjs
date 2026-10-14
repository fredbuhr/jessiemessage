import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { accessConfiguration } from "../server/access/config.mjs";
import { createConfiguredServer } from "../server/index.mjs";

const environment = () => ({ JESSIEMESSAGE_ENABLE_AUTH: "1", JESSIEMESSAGE_ENABLE_ACCESS: "1", JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1",
  JESSIEMESSAGE_SITE_ORIGIN: "https://example.invalid", JESSIEMESSAGE_MFA_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_MAIL_KEY: randomBytes(32).toString("base64url"), JESSIEMESSAGE_SMTP_HOST: "smtp.example.invalid",
  JESSIEMESSAGE_SMTP_PORT: "587", JESSIEMESSAGE_SMTP_USER: "synthetic-test-user", JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-test-password",
  JESSIEMESSAGE_SMTP_FROM: "no-reply@example.invalid" });

test("client access is explicitly opt-in and never creates a mail worker or database by default", async () => {
  assert.deepEqual(accessConfiguration({}), { enabled: false });
  assert.deepEqual(accessConfiguration({ JESSIEMESSAGE_ENABLE_ACCESS: "0" }), { enabled: false });
  const configured = await createConfiguredServer({});
  assert.equal(configured.pool, null);
  assert.equal(configured.mailWorker, undefined);
  for (const flag of ["", "true", "2"]) assert.throws(() => accessConfiguration({ JESSIEMESSAGE_ENABLE_ACCESS: flag }), { code: "AUTH_CONFIG" });
});
test("access cannot enable without administrator authentication and explicit validated email delivery", () => {
  const env = environment();
  const config = accessConfiguration(env);
  assert.equal(config.enabled, true); assert.equal(config.mail.enabled, true);
  assert.equal(config.mail.key.length, 32);
  assert.throws(() => accessConfiguration({ ...env, JESSIEMESSAGE_ENABLE_AUTH: "0" }), { code: "AUTH_CONFIG" });
  assert.throws(() => accessConfiguration({ ...env, JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "0" }), { code: "AUTH_CONFIG" });
  assert.throws(() => accessConfiguration({ ...env, JESSIEMESSAGE_SMTP_PASSWORD: undefined }), { code: "MAIL_CONFIG" });
  assert.throws(() => accessConfiguration({ ...env, JESSIEMESSAGE_MAIL_KEY: "invalid" }), { code: "MAIL_CONFIG" });
  assert.throws(() => accessConfiguration({ ...env, JESSIEMESSAGE_MAIL_KEY: env.JESSIEMESSAGE_MFA_KEY }), { code: "AUTH_CONFIG" });
});
