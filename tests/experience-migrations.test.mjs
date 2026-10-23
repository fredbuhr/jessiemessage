import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadExperienceMigrations } from "../server/experience/migrations.mjs";
import { loadVideoMigrations } from "../server/video/migrations.mjs";
import { loadStoreMigrations } from "../server/db/store-migrations.mjs";
import { createdMigrationTables, inspectHistory, validateSql } from "../server/db/migrations.mjs";

test("experience upgrade preserves every applied SQL36 migration and adds only two pending entries", async () => {
  const old = await loadVideoMigrations(), current = await loadExperienceMigrations();
  assert.deepEqual(current.slice(0, old.length), old);
  const ledger = old.map(row => ({ ...row, state: "applied", attempts: 1 }));
  const history = inspectHistory(current, ledger);
  assert.deepEqual(history.filter(row => row.state === "pending").map(row => row.name),
    ["0037_profile_preferences.sql", "0038_reply_tracking.sql"]);
  assert.equal(createdMigrationTables(current).length + 1, 37);
  assert.equal(current.length, 38);
});

test("the experience plan requires explicit video selection and rejects option getters", async () => {
  assert.equal((await loadStoreMigrations()).length, 33);
  assert.equal((await loadStoreMigrations({ video: true })).length, 36);
  assert.equal((await loadStoreMigrations({ video: true, experience: true })).length, 38);
  await assert.rejects(loadStoreMigrations({ experience: true }));
  await assert.rejects(loadStoreMigrations({ video: true, get experience() { throw Error("must not run"); } }));
});

test("the reviewed reply ALTER does not admit a modified or destructive statement", async () => {
  const sql = await readFile(new URL("../server/experience/migrations/0038_reply_tracking.sql", import.meta.url), "utf8");
  assert.equal(validateSql(sql), sql);
  for (const bad of [sql.replace("reply_kind", "other_kind"), sql + "\nDROP TABLE users;", "ALTER TABLE users DROP COLUMN password_hash;"])
    assert.throws(() => validateSql(bad), { code: "SQL_FORMAT" });
});
