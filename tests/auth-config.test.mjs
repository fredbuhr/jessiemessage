import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { authConfiguration, canonicalEmail } from "../server/auth/config.mjs";
import { createConfiguredServer } from "../server/index.mjs";

test("authentication is opt-in and has no generated/default secret", () => {
  assert.deepEqual(authConfiguration({}), { enabled: false });
  assert.deepEqual(authConfiguration({ JESSIEMESSAGE_ENABLE_AUTH: "0" }), { enabled: false });
  for (const flag of ["true", "", "2"]) assert.throws(() => authConfiguration({ JESSIEMESSAGE_ENABLE_AUTH: flag }), { code: "AUTH_CONFIG" });
});
test("enabled authentication requires a canonical HTTPS origin and canonical 32-byte key", () => {
  const env = { JESSIEMESSAGE_ENABLE_AUTH: "1", JESSIEMESSAGE_SITE_ORIGIN: "https://example.invalid", JESSIEMESSAGE_MFA_KEY: randomBytes(32).toString("base64url") };
  assert.equal(authConfiguration(env).totpKey.length, 32);
  for (const origin of [undefined, "http://example.invalid", "https://example.invalid/", "https://example.invalid/path", "https://user:pass@example.invalid", "https://example.invalid?x=1"]) assert.throws(() => authConfiguration({ ...env, JESSIEMESSAGE_SITE_ORIGIN: origin }), { code: "AUTH_CONFIG" });
  for (const key of [undefined, "short", env.JESSIEMESSAGE_MFA_KEY + "="]) assert.throws(() => authConfiguration({ ...env, JESSIEMESSAGE_MFA_KEY: key }), { code: "AUTH_CONFIG" });
});
test("administrator emails have one canonical spelling and reject unsafe or ambiguous addresses", () => {
  assert.equal(canonicalEmail("Jessie.Admin@Example.INVALID"), "jessie.admin@example.invalid");
  for (const value of [" a@example.invalid", "a@example.invalid\n", "a@@example.invalid", "a@localhost", ".a@example.invalid", "a..b@example.invalid", "a@-example.invalid", "a@exämple.invalid", "a".repeat(65) + "@example.invalid"]) assert.throws(() => canonicalEmail(value), { code: "AUTH_INPUT" });
});
test("disabled authentication creates no database pool; incomplete enabled configuration never falls back to a public server", async () => {
  const configured = await createConfiguredServer({});
  assert.equal(configured.pool, null);
  assert.equal(configured.server.listening, false);
  await assert.rejects(createConfiguredServer({ JESSIEMESSAGE_ENABLE_AUTH: "1", JESSIEMESSAGE_SITE_ORIGIN: "https://example.invalid", JESSIEMESSAGE_MFA_KEY: randomBytes(32).toString("base64url") }), { code: "AUTH_DATABASE_CONFIG" });
});

test("invalid or dependency-free broadcast enablement fails before any database work", async () => {
  for (const flag of ["1", "true", "", "2"]) await assert.rejects(createConfiguredServer({ JESSIEMESSAGE_ENABLE_BROADCAST: flag }), { code: "BROADCAST_CONFIG" });
});
