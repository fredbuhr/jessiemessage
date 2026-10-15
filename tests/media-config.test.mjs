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

test("successful media configuration exposes its private root and finite capacity defaults", () => {
  const env = environment(), original = { ...env }, result = mediaConfiguration(env);
  assert.deepEqual(Object.keys(result).sort(), ["capacity", "enabled", "key", "minimumFreeBytes", "origin", "root"]);
  assert.deepEqual(result.capacity, { ownerBytes: 1073741824, totalBytes: 10737418240 });
  assert.equal(result.minimumFreeBytes, 536870912);
  assert.equal(result.enabled, true); assert.equal(result.origin, env.JESSIEMESSAGE_SITE_ORIGIN);
  assert.equal(result.root, privateRoot); assert.deepEqual(result.key, Buffer.from(env.JESSIEMESSAGE_MEDIA_KEY, "base64url"));
  assert.deepEqual(env, original);
  const secret = "synthetic-secret-malformed-key";
  assert.throws(() => mediaConfiguration({ ...env, JESSIEMESSAGE_MEDIA_KEY: secret }), (error) => {
    assert.ok(error instanceof MediaConfigError); assert.equal(error.message.includes(secret), false); assert.equal(error.cause, undefined); return true;
  });
});

test("media quotas accept explicit byte ceilings and a zero disk margin without changing the input", () => {
  const env = { ...environment(), JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES: "1024", JESSIEMESSAGE_MEDIA_TOTAL_BYTES: "2048", JESSIEMESSAGE_MEDIA_MIN_FREE_BYTES: "0" };
  const original = { ...env }, config = mediaConfiguration(env);
  assert.deepEqual(config.capacity, { ownerBytes: 1024, totalBytes: 2048 });
  assert.equal(config.minimumFreeBytes, 0); assert.deepEqual(env, original);
  assert.ok(Object.isFrozen(config.capacity));
});

test("capacity configuration refuses ambiguous, unsafe and inconsistent limits before media startup", () => {
  const env = environment();
  for (const field of ["JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES", "JESSIEMESSAGE_MEDIA_TOTAL_BYTES", "JESSIEMESSAGE_MEDIA_MIN_FREE_BYTES"]) {
    for (const value of [null, 1000, "", "01", "1.0", "1e3", " 1024", "1024 ", "1024\n", "+1024", "-1", "1125899906842625", "9007199254740992"]) {
      assert.throws(() => mediaConfiguration({ ...env, [field]: value }), { code: "MEDIA_CONFIG" });
    }
  }
  for (const field of ["JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES", "JESSIEMESSAGE_MEDIA_TOTAL_BYTES"]) {
    for (const value of ["0", "81"]) assert.throws(() => mediaConfiguration({ ...env, [field]: value }), { code: "MEDIA_CONFIG" });
  }
  assert.throws(() => mediaConfiguration({ ...env, JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES: "2048", JESSIEMESSAGE_MEDIA_TOTAL_BYTES: "1024" }), { code: "MEDIA_CONFIG" });
});
