import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";
import { inspectPreproductionConfiguration, CONFIG_CHECK_NAMES } from "../server/preflight/config.mjs";

const expectedOrigin = "https://synthetic-preprod.jessiemessage.com";
const options = { target: "auth-only", expectedOrigin };
const key = () => randomBytes(32).toString("base64url");
const flags = ["AUTH", "MAIL_DELIVERY", "ACCESS", "CHAT", "MEDIA", "CRM", "CLIENT_RECOVERY", "BROADCAST"].map((name) => `JESSIEMESSAGE_ENABLE_${name}`);
const statusOf = (result, name) => result.checks.find((check) => check.name === name)?.status;
const checkout = fileURLToPath(new URL("../", import.meta.url));

function environment() {
  return {
    ...Object.fromEntries(flags.map((name) => [name, name === flags[0] ? "1" : "0"])),
    JESSIEMESSAGE_SITE_ORIGIN: expectedOrigin,
    JESSIEMESSAGE_MFA_KEY: key(),
    JESSIEMESSAGE_DB_NAME: "synthetic_preflight",
    JESSIEMESSAGE_APPLICATION_DATABASE: "synthetic_preflight",
    JESSIEMESSAGE_DB_HOST: "db.example.invalid",
    JESSIEMESSAGE_DB_PORT: "3306",
    JESSIEMESSAGE_RUNTIME_DB_USER: "synthetic_runtime",
    JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic-runtime-password",
    JESSIEMESSAGE_DB_USER: "synthetic_migrator",
  };
}

function completeEnvironment() {
  return {
    ...environment(), ...Object.fromEntries(flags.map((name) => [name, "1"])),
    JESSIEMESSAGE_MAIL_KEY: key(), JESSIEMESSAGE_MESSAGE_KEY: key(), JESSIEMESSAGE_MEDIA_KEY: key(), JESSIEMESSAGE_CRM_KEY: key(),
    JESSIEMESSAGE_MEDIA_ROOT: resolve(checkout, "../synthetic-preflight-media"),
    JESSIEMESSAGE_SMTP_HOST: "smtp.example.invalid", JESSIEMESSAGE_SMTP_PORT: "587",
    JESSIEMESSAGE_SMTP_USER: "synthetic-smtp-user", JESSIEMESSAGE_SMTP_PASSWORD: "synthetic-smtp-password",
  };
}

function assertShape(result) {
  assert.deepEqual(Object.keys(result).sort(), ["checks", "target", "valid"]);
  assert.equal(result.target, "auth-only");
  assert.equal(typeof result.valid, "boolean");
  assert.deepEqual(result.checks.map((check) => check.name), [...CONFIG_CHECK_NAMES]);
  assert.equal(result.checks.length, 16);
  for (const check of result.checks) {
    assert.deepEqual(Object.keys(check).sort(), ["name", "status"]);
    assert.ok(["pass", "fail", "disabled", "not_checked"].includes(check.status));
    assert.ok(Object.isFrozen(check));
  }
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.checks));
}

test("auth-only preflight returns a fixed frozen configuration report and leaves disabled inputs unused", () => {
  const env = { ...environment(), JESSIEMESSAGE_MAIL_KEY: "unused-invalid-key", JESSIEMESSAGE_MEDIA_ROOT: "unused-private-path",
    JESSIEMESSAGE_CRM_KEY: "unused-invalid-key", JESSIEMESSAGE_SMTP_TLS_CA_PATH: "/nonexistent/synthetic-ca.pem" };
  const original = { ...env }, inputOptions = { ...options };
  const result = inspectPreproductionConfiguration(Object.freeze(env), Object.freeze(inputOptions));
  assertShape(result); assert.ok(Object.isFrozen(CONFIG_CHECK_NAMES));
  assert.equal(result.valid, true);
  for (const name of ["feature_flags", "authentication", "runtime_database", "database_tls", "official_subdomain", "auth_only"]) assert.equal(statusOf(result, name), "pass");
  for (const name of ["mail", "client_access", "chat", "media", "crm", "client_recovery", "broadcasts", "key_separation"]) assert.equal(statusOf(result, name), "disabled");
  assert.equal(statusOf(result, "port"), "not_checked");
  assert.deepEqual(env, original); assert.deepEqual(inputOptions, options);
  const implicitOff = Object.fromEntries(Object.entries(env).filter(([name]) => !flags.slice(1).includes(name)));
  assert.equal(inspectPreproductionConfiguration(implicitOff, { expectedOrigin }).valid, true);
});

test("all feature flags reject ambiguous values and unknown enable flags fail closed", () => {
  for (const flag of flags) for (const value of ["", "true", "false", "01", "2", " 0", "1\n", 0, 1, false, true, null]) {
    const result = inspectPreproductionConfiguration({ ...environment(), [flag]: value }, options);
    assert.equal(result.valid, false, `${flag}: ${String(value)}`);
    assert.equal(statusOf(result, "feature_flags"), "fail");
    assert.equal(statusOf(result, "auth_only"), "fail");
  }
  for (const value of [undefined, "0", "1"]) {
    const result = inspectPreproductionConfiguration({ ...environment(), JESSIEMESSAGE_ENABLE_UNKNOWN: value }, options);
    assert.equal(result.valid, false); assert.equal(statusOf(result, "feature_flags"), "fail");
  }
  for (const value of [undefined, "0"]) {
    const result = inspectPreproductionConfiguration({ ...environment(), JESSIEMESSAGE_ENABLE_AUTH: value }, options);
    assert.equal(statusOf(result, "authentication"), "disabled"); assert.equal(statusOf(result, "auth_only"), "fail");
  }
});

test("expected origin is required, exact, canonical HTTPS and an official subdomain excluding apex and www", () => {
  const env = environment();
  for (const expected of [undefined, null, "", "http://synthetic-preprod.jessiemessage.com", `${expectedOrigin}/`, `${expectedOrigin}/path`,
    `${expectedOrigin}?token=synthetic`, "https://user:synthetic@synthetic-preprod.jessiemessage.com", "https://jessiemessage.com", "https://www.jessiemessage.com",
    "https://synthetic-preprod.jessiemessage.com.example.invalid", "https://other.example.invalid", "https://SYNTHETIC-PREPROD.jessiemessage.com"]) {
    const result = inspectPreproductionConfiguration({ ...env, JESSIEMESSAGE_SITE_ORIGIN: expected }, { target: "auth-only", expectedOrigin: expected });
    assert.equal(result.valid, false); assert.equal(statusOf(result, "official_subdomain"), "fail");
  }
  const different = inspectPreproductionConfiguration(env, { ...options, expectedOrigin: "https://other-preprod.jessiemessage.com" });
  assert.equal(different.valid, false); assert.equal(statusOf(different, "authentication"), "pass");
  assert.equal(statusOf(different, "official_subdomain"), "fail");
  assert.equal(inspectPreproductionConfiguration(env).valid, false);
});

test("runtime database uses the real syntax validator and requires verified TLS even for permitted local test connections", () => {
  const env = environment();
  for (const override of [
    { JESSIEMESSAGE_APPLICATION_DATABASE: "other_database" }, { JESSIEMESSAGE_DB_NAME: "invalid-name" },
    { JESSIEMESSAGE_RUNTIME_DB_USER: env.JESSIEMESSAGE_DB_USER }, { JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "" },
    { JESSIEMESSAGE_DB_HOST: "" }, { JESSIEMESSAGE_DB_PORT: "65536" }, { JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "0" },
    { JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1" }, { JESSIEMESSAGE_DB_PORT: {} }, { JESSIEMESSAGE_RUNTIME_DB_USER: 1 },
  ]) {
    const result = inspectPreproductionConfiguration({ ...env, ...override }, options);
    assert.equal(result.valid, false); assert.equal(statusOf(result, "runtime_database"), "fail");
    assert.equal(statusOf(result, "database_tls"), "not_checked");
  }
  for (const host of ["127.0.0.1", "localhost", "::1"]) {
    const result = inspectPreproductionConfiguration({ ...env, JESSIEMESSAGE_DB_HOST: host, JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1" }, options);
    assert.equal(result.valid, false); assert.equal(statusOf(result, "runtime_database"), "pass");
    assert.equal(statusOf(result, "database_tls"), "fail");
  }
  // This is syntax only: it never opens or reads the CA path.
  assert.equal(inspectPreproductionConfiguration({ ...env, JESSIEMESSAGE_DB_TLS_CA_PATH: "/nonexistent/synthetic-ca.pem" }, options).valid, true);
});

test("a fully configured client stack remains incompatible with the first auth-only preproduction target", () => {
  const env = completeEnvironment(), result = inspectPreproductionConfiguration(env, options);
  assertShape(result); assert.equal(result.valid, false);
  for (const name of ["authentication", "mail", "client_access", "chat", "media", "crm", "client_recovery", "broadcasts", "key_separation"]) assert.equal(statusOf(result, name), "pass");
  assert.equal(statusOf(result, "auth_only"), "fail");
  for (const [flag, name] of [[flags[2], "client_access"], [flags[3], "chat"], [flags[4], "media"], [flags[5], "crm"], [flags[6], "client_recovery"], [flags[7], "broadcasts"]]) {
    const partial = inspectPreproductionConfiguration({ ...environment(), [flag]: "1" }, options);
    assert.equal(partial.valid, false); assert.equal(statusOf(partial, name), "fail");
  }
  for (const [field, name] of [["JESSIEMESSAGE_MFA_KEY", "authentication"], ["JESSIEMESSAGE_MAIL_KEY", "mail"],
    ["JESSIEMESSAGE_MESSAGE_KEY", "chat"], ["JESSIEMESSAGE_MEDIA_KEY", "media"], ["JESSIEMESSAGE_CRM_KEY", "crm"]]) {
    const invalid = inspectPreproductionConfiguration({ ...env, [field]: "invalid-private-key" }, options);
    assert.equal(statusOf(invalid, name), "fail"); assert.equal(statusOf(invalid, "key_separation"), "not_checked");
  }
});

test("key separation checks independent active keys while preserving intentional recovery and broadcast key reuse", () => {
  const all = completeEnvironment();
  const mailOnly = { ...environment(), JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1", JESSIEMESSAGE_MAIL_KEY: all.JESSIEMESSAGE_MFA_KEY,
    JESSIEMESSAGE_SMTP_HOST: all.JESSIEMESSAGE_SMTP_HOST, JESSIEMESSAGE_SMTP_PORT: all.JESSIEMESSAGE_SMTP_PORT,
    JESSIEMESSAGE_SMTP_USER: all.JESSIEMESSAGE_SMTP_USER, JESSIEMESSAGE_SMTP_PASSWORD: all.JESSIEMESSAGE_SMTP_PASSWORD };
  mailOnly.JESSIEMESSAGE_MAIL_KEY = mailOnly.JESSIEMESSAGE_MFA_KEY;
  const equal = inspectPreproductionConfiguration(mailOnly, options);
  assert.equal(statusOf(equal, "mail"), "pass"); assert.equal(statusOf(equal, "key_separation"), "fail");
  for (const [field, other, name] of [["JESSIEMESSAGE_MAIL_KEY", "JESSIEMESSAGE_MFA_KEY", "client_access"],
    ["JESSIEMESSAGE_MESSAGE_KEY", "JESSIEMESSAGE_MAIL_KEY", "chat"], ["JESSIEMESSAGE_MEDIA_KEY", "JESSIEMESSAGE_MESSAGE_KEY", "media"],
    ["JESSIEMESSAGE_CRM_KEY", "JESSIEMESSAGE_MEDIA_KEY", "crm"]]) {
    const result = inspectPreproductionConfiguration({ ...all, [field]: all[other] }, options);
    assert.equal(result.valid, false); assert.equal(statusOf(result, name), "fail");
  }
  const optionalMedia = inspectPreproductionConfiguration({ ...all, JESSIEMESSAGE_ENABLE_MEDIA: "0", JESSIEMESSAGE_MEDIA_KEY: all.JESSIEMESSAGE_CRM_KEY }, options);
  assert.equal(statusOf(optionalMedia, "media"), "disabled"); assert.equal(statusOf(optionalMedia, "crm"), "fail");
  const officialSender = inspectPreproductionConfiguration({ ...all, JESSIEMESSAGE_SMTP_FROM: "other@example.invalid" }, options);
  assert.equal(statusOf(officialSender, "mail"), "fail");
});

test("optional listener port is checked strictly without claiming proxy configuration", () => {
  const env = environment();
  assert.equal(statusOf(inspectPreproductionConfiguration(env, options), "port"), "not_checked");
  for (const value of ["1", "80", "443", "3000", "65535"]) {
    const result = inspectPreproductionConfiguration({ ...env, PORT: value }, options);
    assert.equal(result.valid, true); assert.equal(statusOf(result, "port"), "pass");
  }
  for (const value of ["", "0", "65536", "-1", "01", "1.0", "1e3", "+3000", " 3000", "3000\n", 3000, null, {}]) {
    const result = inspectPreproductionConfiguration({ ...env, PORT: value }, options);
    assert.equal(result.valid, false); assert.equal(statusOf(result, "port"), "fail");
  }
});

test("malformed callers and hostile properties produce only fixed failures without invoking coercion or accessors", () => {
  for (const env of [null, false, 1, "private-input", [], () => {}, new Proxy({}, { ownKeys() { throw new Error("synthetic-private-error"); } })]) {
    const result = inspectPreproductionConfiguration(env, options);
    assertShape(result); assert.equal(result.valid, false);
  }
  for (const parameters of [null, false, 1, "private-options", [], () => {}]) {
    const result = inspectPreproductionConfiguration(environment(), parameters);
    assertShape(result); assert.equal(result.valid, false);
  }
  let read = 0;
  const object = { toString() { read += 1; throw new Error("synthetic-private-error"); }, valueOf() { read += 1; throw new Error("synthetic-private-error"); } };
  for (const [env, parameters] of [
    [{ ...environment(), JESSIEMESSAGE_SITE_ORIGIN: object }, options],
    [environment(), { ...options, expectedOrigin: object }], [{ ...environment(), JESSIEMESSAGE_DB_PORT: object }, options],
    [{ ...environment(), PORT: object }, options], [environment(), { ...options, target: object }],
    [Object.defineProperty(environment(), "JESSIEMESSAGE_MFA_KEY", { get() { read += 1; throw new Error("synthetic-private-error"); } }), options],
    [environment(), Object.defineProperty({}, "expectedOrigin", { get() { read += 1; throw new Error("synthetic-private-error"); } })],
  ]) { const result = inspectPreproductionConfiguration(env, parameters); assertShape(result); assert.equal(result.valid, false); }
  assert.equal(read, 0);
  const wrongTarget = inspectPreproductionConfiguration(environment(), { ...options, target: "synthetic-private-target" });
  assert.equal(wrongTarget.target, "auth-only"); assert.equal(wrongTarget.valid, false); assert.equal(statusOf(wrongTarget, "auth_only"), "fail");
});

test("reports contain no configuration values or error text and configuration inspection performs no file or network work", (t) => {
  const forbidden = () => { throw new Error("Unexpected synthetic file or network access"); };
  const spies = [t.mock.method(fs, "readFile", forbidden), t.mock.method(fs, "readdir", forbidden),
    t.mock.method(net, "connect", forbidden), t.mock.method(net, "createConnection", forbidden), t.mock.method(tls, "connect", forbidden),
    t.mock.method(globalThis, "fetch", forbidden)];
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const env = { ...completeEnvironment(), PORT: "443", JESSIEMESSAGE_DB_TLS_CA_PATH: "/synthetic-private-ca.pem" };
  for (const input of [env, { ...env, JESSIEMESSAGE_MFA_KEY: "synthetic-private-error-secret" }, environment()]) {
    const result = inspectPreproductionConfiguration(input, options);
    assertShape(result); assert.equal(result instanceof Promise, false);
    const serialized = JSON.stringify(result);
    for (const value of Object.values(input).filter((value) => typeof value === "string" && value.length > 3)) assert.equal(serialized.includes(value), false);
    assert.doesNotMatch(serialized, /Error|cause|stack|smtp\.example|synthetic-|jessiemessage\.com/);
  }
  for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
});
