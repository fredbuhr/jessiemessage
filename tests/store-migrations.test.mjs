import test from "node:test";
import assert from "node:assert/strict";
import { loadMigrations } from "../server/db/migrations.mjs";
import { loadVideoMigrations } from "../server/video/migrations.mjs";
import { loadStoreMigrations } from "../server/db/store-migrations.mjs";

test("store schema assertions select only the authored normal33 or explicitly requested video36 plan", async () => {
  const base = await loadMigrations(), candidate = await loadVideoMigrations();
  assert.equal(base.length, 33); assert.equal(candidate.length, 36);
  assert.deepEqual(await loadStoreMigrations(), base);
  assert.deepEqual(await loadStoreMigrations({}), base);
  assert.deepEqual(await loadStoreMigrations({ video: false }), base);
  assert.deepEqual(await loadStoreMigrations({ video: true }), candidate);
  assert.deepEqual((await loadStoreMigrations({ video: true })).slice(0, 33), base);
  assert.equal((await loadMigrations()).length, 33, "the normal migration loader remains closed after candidate inspection");
});

test("store schema profile refuses implicit activation, arbitrary plans and input accessors", async () => {
  let getters = 0;
  const accessor = {}; Object.defineProperty(accessor, "video", { get() { getters++; return true; } });
  for (const options of [true, false, "video", null, [], Object.create({ video: true }), accessor,
    { video: "1" }, { video: 1 }, { video: null }, { migrations: await loadVideoMigrations() },
    { video: true, extra: true }, { [Symbol("video")]: true }])
    await assert.rejects(loadStoreMigrations(options), TypeError);
  assert.equal(getters, 0);
});
