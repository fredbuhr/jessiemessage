import test from "node:test";
import assert from "node:assert/strict";
import { validateFixtureEnvironment } from "./rehearsal/auth-fixture.mjs";

// Pure guard checks: no connection, schema creation or browser startup.
const fixtureEnv = () => ({
  JESSIEMESSAGE_DB_TEST: "1",
  JESSIEMESSAGE_DB_HOST: "127.0.0.1",
  JESSIEMESSAGE_DB_PORT: "3306",
  JESSIEMESSAGE_DB_NAME: "jessiemessage_test_auth_guard",
  JESSIEMESSAGE_MIGRATION_DATABASE: "jessiemessage_test_auth_guard",
  JESSIEMESSAGE_APPLICATION_DATABASE: "jessiemessage_test_auth_guard",
  JESSIEMESSAGE_DB_USER: "migration_test",
  JESSIEMESSAGE_DB_PASSWORD: "synthetic-migration-fixture",
  JESSIEMESSAGE_RUNTIME_DB_USER: "runtime_test",
  JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic-runtime-fixture",
  JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1"
});

test("authentication rehearsal permits an explicitly confirmed loopback test target", () => {
  for (const host of ["127.0.0.1", "localhost", "::1"]) {
    assert.doesNotThrow(() => validateFixtureEnvironment({ ...fixtureEnv(), JESSIEMESSAGE_DB_HOST: host }));
  }
});

for (const [label, overrides] of [
  ["missing opt-in", { JESSIEMESSAGE_DB_TEST: undefined }],
  ["false opt-in", { JESSIEMESSAGE_DB_TEST: "0" }],
  ["non-loopback host", { JESSIEMESSAGE_DB_HOST: "database.example.invalid" }],
  ["loopback-looking hostname", { JESSIEMESSAGE_DB_HOST: "127.0.0.1.example.invalid" }],
  ["ordinary database", { JESSIEMESSAGE_DB_NAME: "jessiemessage_production" }],
  ["ambiguous test prefix", { JESSIEMESSAGE_DB_NAME: "jessiemessage_testproduction" }],
  ["different migration confirmation", { JESSIEMESSAGE_MIGRATION_DATABASE: "jessiemessage_test_other" }],
  ["missing application confirmation", { JESSIEMESSAGE_APPLICATION_DATABASE: undefined }],
  ["different application confirmation", { JESSIEMESSAGE_APPLICATION_DATABASE: "jessiemessage_test_other" }],
  ["shared SQL identity", { JESSIEMESSAGE_RUNTIME_DB_USER: "migration_test" }],
  ["missing runtime credentials", { JESSIEMESSAGE_RUNTIME_DB_PASSWORD: undefined }],
  ["implicit insecure database", { JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: undefined }],
  ["arbitrary CA file", { JESSIEMESSAGE_DB_TLS_CA_PATH: "/private/do-not-read.pem" }]
]) {
  test(`authentication rehearsal refuses ${label} before any SQL connection`, () => {
    assert.throws(() => validateFixtureEnvironment({ ...fixtureEnv(), ...overrides }), (error) => {
      assert.ok(["AUTH_REHEARSAL_DISABLED", "AUTH_REHEARSAL_CONFIG"].includes(error?.code));
      // Failures must not echo connection details or credential values.
      assert.equal(/synthetic-|example\.invalid|do-not-read|migration_test|runtime_test/.test(error.message), false);
      return true;
    });
  });
}
