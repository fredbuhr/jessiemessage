import test from "node:test";
import assert from "node:assert/strict";
import { loadMigrations, createdMigrationTables } from "../server/db/migrations.mjs";
import { loadVideoMigrations } from "../server/video/migrations.mjs";
import { inspectDatabase } from "../server/preflight/database.mjs";

const env = { JESSIEMESSAGE_DB_NAME: "jessiemessage_test_video", JESSIEMESSAGE_APPLICATION_DATABASE: "jessiemessage_test_video",
  JESSIEMESSAGE_DB_HOST: "database.example.invalid", JESSIEMESSAGE_RUNTIME_DB_USER: "runtime_identity",
  JESSIEMESSAGE_RUNTIME_DB_PASSWORD: "synthetic-only" };
const normal = await loadMigrations(), candidate = await loadVideoMigrations();
const statuses = result => Object.fromEntries(result.checks.map(row => [row.name, row.status]));
function fixture({ plan = candidate, grantTables = createdMigrationTables(plan), rows, readFault, privilegeProfile } = {}) {
  const calls = [], environment = { ...env, ...(privilegeProfile ? { JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE: privilegeProfile } : {}) };
  const grant = (table, rights) => ({ grant: `GRANT ${rights} ON \`${env.JESSIEMESSAGE_DB_NAME}\`.\`${table}\` TO 'runtime_identity'@'localhost'` });
  const connection = {
    async query(command) {
      const sql = typeof command === "string" ? command : command.sql; calls.push(sql);
      if (sql.startsWith("SELECT DATABASE()")) return [{ database_name: env.JESSIEMESSAGE_DB_NAME, server_version: "10.11.14-MariaDB" }];
      if (sql.startsWith("SHOW SESSION")) return [{ Variable_name: "Ssl_cipher", Value: "TLS_AES_256_GCM_SHA384" }];
      if (sql.startsWith("SHOW GRANTS")) return [grant("schema_migrations", "SELECT"), ...grantTables.map(table => grant(table, "SELECT, INSERT, UPDATE, DELETE"))];
      if (sql.startsWith("SELECT version")) return rows ?? plan.map(({ version, name, checksum }) => ({ version, name, checksum, state: "applied", attempts: 1 }));
      if (readFault && sql.includes(`FROM ${readFault} `)) throw Error("synthetic candidate read failure");
      return [];
    },
    async rollback() { calls.push("rollback"); }, async release() { calls.push("release"); },
  };
  return { calls, environment, dependencies: { async createPool() { calls.push("pool"); return { async getConnection() { return connection; }, async end() { calls.push("end"); } }; } } };
}
const run = (f, video) => inspectDatabase({ env: f.environment, databaseName: env.JESSIEMESSAGE_DB_NAME, ...(video === undefined ? {} : { video }) }, f.dependencies);

test("explicit video SQL preflight reads the exact candidate ledger, grants and all 35 application projections", async () => {
  const f = fixture(), result = await run(f, true);
  assert.equal(result.valid, true); assert.equal(result.checks.every(row => row.status === "pass"), true);
  assert.equal(f.calls.filter(sql => /WHERE 1 = 0$/.test(sql)).length, 35);
  assert.ok(f.calls.some(sql => sql.endsWith("ORDER BY version LIMIT 37")));
  for (const table of ["video_storage_state", "video_assets", "message_video"]) assert.ok(f.calls.some(sql => sql.includes(`FROM ${table} WHERE 1 = 0`)));
  assert.deepEqual(f.calls.slice(-3), ["rollback", "release", "end"]);
  assert.doesNotMatch(f.calls.join("\n"), /(?:^|\n)(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/);
  assert.equal((await loadMigrations()).length, 33);
});

test("historical SQL preflight remains schema33-only and never accepts candidate grants or history implicitly", async () => {
  const original = fixture({ plan: normal }); assert.equal((await run(original)).valid, true);
  assert.equal(original.calls.filter(sql => /WHERE 1 = 0$/.test(sql)).length, 32);
  assert.ok(original.calls.some(sql => sql.endsWith("ORDER BY version LIMIT 34")));
  assert.equal(original.calls.some(sql => /FROM (?:video_|message_video)/.test(sql)), false);
  const widened = await run(fixture()); assert.equal(statuses(widened).privileges, "fail"); assert.equal(statuses(widened).history, "fail");
});

test("video SQL preflight refuses missing candidate rights, unreadable tables and ledger substitutions", async () => {
  const missing = fixture({ grantTables: createdMigrationTables(normal) }); assert.equal(statuses(await run(missing, true)).privileges, "fail");
  for (const table of ["video_storage_state", "video_assets", "message_video"]) {
    const f = fixture({ readFault: table }); assert.equal(statuses(await run(f, true)).schema_reads, "fail"); assert.deepEqual(f.calls.slice(-3), ["rollback", "release", "end"]);
  }
  const rows = candidate.map(({ version, name, checksum }) => ({ version, name, checksum, state: "applied", attempts: 1 }));
  for (const selected of [rows.slice(0, 33), [...rows, { ...rows.at(-1), version: 37 }], rows.map(row => row.version === 35 ? { ...row, checksum: "0".repeat(64) } : row)])
    assert.equal(statuses(await run(fixture({ rows: selected }), true)).history, "fail");
});

test("nonboolean video selection is rejected before pool creation", async () => {
  for (const value of ["true", 1, null, {}]) {
    const f = fixture(), result = await run(f, value); assert.equal(statuses(result).config, "fail"); assert.deepEqual(f.calls, []);
  }
});
