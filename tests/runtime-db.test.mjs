import test from "node:test";
import assert from "node:assert/strict";
import { runtimeDatabaseOptions, createRuntimePool } from "../server/db/runtime.mjs";
import { AuthStoreError } from "../server/auth/store.mjs";

const configured = {
  JESSIEMESSAGE_DB_HOST: "database.example.invalid",
  JESSIEMESSAGE_DB_NAME: "jessiemessage_private",
  JESSIEMESSAGE_APPLICATION_DATABASE: "jessiemessage_private",
  JESSIEMESSAGE_RUNTIME_DB_USER: "runtime_only",
  JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic-do-not-use",
  JESSIEMESSAGE_DB_USER: "migration_only",
};
const configError = (error) => error instanceof AuthStoreError && error.code === "AUTH_DATABASE_CONFIG";

test("runtime configuration uses explicit separate credentials, encrypted TLS and bounded pool settings", () => {
  const options = runtimeDatabaseOptions(configured);
  assert.equal(options.user, "runtime_only");
  assert.equal(options.database, "jessiemessage_private");
  assert.deepEqual(options.ssl, { rejectUnauthorized: true, minVersion: "TLSv1.2" });
  assert.equal(options.connectionLimit, 4);
  assert.equal(options.minimumIdle, 0);
  assert.equal(options.acquireTimeout, 5000);
  assert.equal(options.multipleStatements, false);
  assert.equal(options.dateStrings, true);
  assert.equal(options.timezone, "Z");
  assert.equal(options.logParam, false);
  assert.equal(options.trace, false);
});

test("runtime configuration refuses missing confirmation or implicit migration credentials", () => {
  assert.throws(() => runtimeDatabaseOptions({}), configError);
  for (const key of ["JESSIEMESSAGE_APPLICATION_DATABASE", "JESSIEMESSAGE_RUNTIME_DB_USER", "JESSIEMESSAGE_RUNTIME_DB_PASSWORD", "JESSIEMESSAGE_DB_HOST"]) {
    assert.throws(() => runtimeDatabaseOptions({ ...configured, [key]: undefined }), configError);
  }
  assert.throws(() => runtimeDatabaseOptions({ ...configured, JESSIEMESSAGE_APPLICATION_DATABASE: "other_database" }), configError);
  assert.throws(() => runtimeDatabaseOptions({ ...configured, JESSIEMESSAGE_RUNTIME_DB_USER: "migration_only" }), configError);
  assert.throws(() => runtimeDatabaseOptions({ ...configured, JESSIEMESSAGE_DB_NAME: "database.other" }), configError);
  for (const port of ["0", "65536", "1.5", "bad"]) assert.throws(() => runtimeDatabaseOptions({ ...configured, JESSIEMESSAGE_DB_PORT: port }), configError);
});

test("unencrypted database connections require an explicit loopback-only override", () => {
  for (const host of ["127.0.0.1", "::1", "localhost"]) {
    assert.equal(runtimeDatabaseOptions({ ...configured, JESSIEMESSAGE_DB_HOST: host, JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1" }).ssl, false);
  }
  assert.throws(() => runtimeDatabaseOptions({ ...configured, JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1" }), configError);
  assert.throws(() => runtimeDatabaseOptions({ ...configured, JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "true" }), configError);
  assert.throws(() => runtimeDatabaseOptions({ ...configured, JESSIEMESSAGE_DB_HOST: "localhost", JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL: "1", JESSIEMESSAGE_DB_TLS_CA_PATH: "/private/ca.pem" }), configError);
});

test("unreadable private TLS material produces a sanitized connection failure", async () => {
  await assert.rejects(createRuntimePool({ ...configured, JESSIEMESSAGE_DB_TLS_CA_PATH: "/nonexistent/private-test-ca.pem" }), (error) => {
    assert.equal(error.code, "AUTH_DATABASE_CONNECTION");
    assert.ok(!error.message.includes("private-test-ca"));
    assert.equal(error.cause, undefined);
    return true;
  });
});
