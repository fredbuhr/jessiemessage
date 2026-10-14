import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mediaConfiguration, MediaConfigError } from "../server/media/config.mjs";

const checkout = fileURLToPath(new URL("../", import.meta.url));
const privateRoot = resolve(checkout, "../synthetic-private-media");
const environment = () => ({
  JESSIEMESSAGE_ENABLE_MEDIA: "1", JESSIEMESSAGE_ENABLE_CHAT: "1", JESSIEMESSAGE_ENABLE_AUTH: "1",
  JESSIEMESSAGE_ENABLE_ACCESS: "1", JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1",
  JESSIEMESSAGE_SITE_ORIGIN: "https://example.invalid", JESSIEMESSAGE_MEDIA_ROOT: privateRoot,
  JESSIEMESSAGE_MEDIA_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_MESSAGE_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_MFA_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_MAIL_KEY: randomBytes(32).toString("base64url"),
  JESSIEMESSAGE_SMTP_HOST: "smtp.example.invalid", JESSIEMESSAGE_SMTP_PORT: "587",
  JESSIEMESSAGE_SMTP_USER: "synthetic-test-user", JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-test-password",
  JESSIEMESSAGE_SMTP_FROM: "no-reply@example.invalid",
});

test("private media remain closed by default without evaluating disabled configuration", () => {
  assert.deepEqual(mediaConfiguration({}), { enabled: false });
  assert.deepEqual(mediaConfiguration({ JESSIEMESSAGE_ENABLE_MEDIA: "0", JESSIEMESSAGE_ENABLE_CHAT: "invalid",
    JESSIEMESSAGE_MEDIA_KEY: "invalid", JESSIEMESSAGE_MEDIA_ROOT: "/" }), { enabled: false });
  for (const flag of ["", "true", "false", "01", "2", 1, true, null]) {
    assert.throws(() => mediaConfiguration({ JESSIEMESSAGE_ENABLE_MEDIA: flag }), { code: "MEDIA_CONFIG" });
  }
});

test("enabled media require the complete existing authenticated chat configuration", () => {
  const env = environment();
  for (const field of ["JESSIEMESSAGE_ENABLE_CHAT", "JESSIEMESSAGE_ENABLE_AUTH", "JESSIEMESSAGE_ENABLE_ACCESS", "JESSIEMESSAGE_ENABLE_MAIL_DELIVERY"]) {
    for (const value of [undefined, "0"]) assert.throws(() => mediaConfiguration({ ...env, [field]: value }));
  }
  assert.throws(() => mediaConfiguration({ ...env, JESSIEMESSAGE_MESSAGE_KEY: undefined }), { code: "CHAT_CONFIG" });
  assert.throws(() => mediaConfiguration({ ...env, JESSIEMESSAGE_MFA_KEY: undefined }), { code: "AUTH_CONFIG" });
  assert.throws(() => mediaConfiguration({ ...env, JESSIEMESSAGE_SMTP_PASSWORD: undefined }), { code: "MAIL_CONFIG" });
});

test("media encryption key is explicit canonical 256-bit and distinct from all other private keys", () => {
  const env = environment(), canonical = Buffer.alloc(32).toString("base64url"), alias = `${canonical.slice(0, -1)}B`;
  assert.deepEqual(Buffer.from(canonical, "base64url"), Buffer.from(alias, "base64url"));
  for (const value of [undefined, null, "", Buffer.alloc(32), "A".repeat(42), "A".repeat(44), alias,
    `${env.JESSIEMESSAGE_MEDIA_KEY}=`, env.JESSIEMESSAGE_MESSAGE_KEY, env.JESSIEMESSAGE_MFA_KEY, env.JESSIEMESSAGE_MAIL_KEY]) {
    assert.throws(() => mediaConfiguration({ ...env, JESSIEMESSAGE_MEDIA_KEY: value }), { code: "MEDIA_CONFIG" });
  }
});

test("private root rejects checkout descendants, ancestors, relative paths and canonical aliases", () => {
  const env = environment();
  for (const root of [undefined, null, "", "private-media", "../private-media", "/", dirname(checkout), resolve(checkout),
    resolve(checkout, "public/media"), resolve(checkout, "artifacts"), resolve(checkout, "design"),
    `${privateRoot}/`, `${privateRoot}/../synthetic-private-media`, `${privateRoot}//files`, `${privateRoot}\n`, `${privateRoot}\0`, "a".repeat(4097)]) {
    assert.throws(() => mediaConfiguration({ ...env, JESSIEMESSAGE_MEDIA_ROOT: root }), { code: "MEDIA_CONFIG" });
  }
  // A sibling prefix must not be confused with a checkout descendant.
  assert.equal(mediaConfiguration({ ...env, JESSIEMESSAGE_MEDIA_ROOT: `${resolve(checkout)}-private` }).enabled, true);
});

test("successful media configuration exposes only the independent key, origin and private root", () => {
  const env = environment(), original = { ...env }, result = mediaConfiguration(env);
  assert.deepEqual(Object.keys(result).sort(), ["enabled", "key", "origin", "root"]);
  assert.equal(result.enabled, true); assert.equal(result.origin, env.JESSIEMESSAGE_SITE_ORIGIN);
  assert.equal(result.root, privateRoot); assert.deepEqual(result.key, Buffer.from(env.JESSIEMESSAGE_MEDIA_KEY, "base64url"));
  assert.deepEqual(env, original);
  const secret = "synthetic-secret-malformed-key";
  assert.throws(() => mediaConfiguration({ ...env, JESSIEMESSAGE_MEDIA_KEY: secret }), (error) => {
    assert.ok(error instanceof MediaConfigError); assert.equal(error.message.includes(secret), false); assert.equal(error.cause, undefined); return true;
  });
});
