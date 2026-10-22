import test from "node:test";
import assert from "node:assert/strict";
import { checksumSql } from "../server/db/migrations.mjs";
import { loadVideoMigrations } from "../server/video/migrations.mjs";
import { assertErasureSchema } from "../server/data/erasure-schema.mjs";

for (const index of [0, 33, 34, 35]) test(`candidate erasure refuses substituted migration ${index + 1} bytes even with a matching replacement checksum`, async () => {
  const plan = (await loadVideoMigrations()).map(row => ({ ...row }));
  plan[index].sql += "\n-- Synthetic alternative with the same dependency graph.\n";
  plan[index].checksum = checksumSql(plan[index].sql);
  let queried = false;
  const connection = { async query() { queried = true; throw new Error("No SQL inspection is permitted for substituted source bytes"); } };
  await assert.rejects(assertErasureSchema(connection, "jessiemessage_test_erasure", { candidateMigrations: plan }), { code: "ERASURE_SCHEMA" });
  assert.equal(queried, false);
});
