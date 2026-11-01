import test from "node:test";
import assert from "node:assert/strict";
import { SharedMediaCapacityError, lockSharedMediaCapacity } from "../server/media/shared-capacity.mjs";
import { videoStoredBytes } from "../server/video/storage.mjs";

const GiB = 1024 ** 3;
function fixture({ photoBytes = 0, videoBytes = 0, photoTotal = 10 * GiB, videoTotal = 20 * GiB,
  photoState = true, videoState = true, orphanObjects = 0, orphanAssets = 0 } = {}) {
  const queries = [];
  return { queries, connection: { async query(sql) {
    queries.push(sql);
    if (sql === "SELECT held_bytes, total_bytes FROM video_storage_state WHERE id = 1 FOR UPDATE") return videoState ? [{ held_bytes: videoBytes, total_bytes: videoTotal }] : [];
    if (sql === "SELECT held_bytes, total_bytes FROM media_storage_state WHERE id = 1 FOR UPDATE") return photoState ? [{ held_bytes: photoBytes, total_bytes: photoTotal }] : [];
    if (sql.startsWith("SELECT EXISTS")) return [{ objects: orphanObjects, assets: orphanAssets }];
    assert.fail(`Unexpected shared capacity query: ${sql}`);
  } } };
}

test("photo-only live admission reads configured total and never asks video tables or counts history", async () => {
  const f = fixture({ photoBytes: GiB + 512 });
  assert.deepEqual(await lockSharedMediaCapacity(f.connection), { heldBytes: GiB + 512, totalBytes: 10 * GiB });
  assert.equal(f.queries.length, 1); assert.ok(f.queries.every(sql => !sql.includes("video_") && !sql.includes("COUNT(")));
});

test("photo and video bytes share the photo authority with video-before-photo lock order", async () => {
  const f = fixture({ photoBytes: 5 * GiB, videoBytes: 2 * GiB });
  assert.deepEqual(await lockSharedMediaCapacity(f.connection, { video: true }), { heldBytes: 7 * GiB, totalBytes: 10 * GiB });
  assert.match(f.queries[0], /video_storage_state.*FOR UPDATE$/); assert.match(f.queries[1], /media_storage_state.*FOR UPDATE$/);
  assert.equal(f.queries.length, 2, "retained released allocation history has no live record budget");
});

test("eleven 100MiB video allocations fit the shared configured ten GiB budget", async () => {
  const stored = videoStoredBytes(100 * 1024 ** 2); let held = 0;
  for (let index = 0; index < 11; index++) {
    const result = await lockSharedMediaCapacity(fixture({ videoBytes: held }).connection, { video: true });
    assert.ok(result.heldBytes <= result.totalBytes - stored); held += stored;
  }
  assert.ok(held > GiB && held < 10 * GiB);
});

test("a standalone video catalogue keeps its configured authority only while no photo catalogue exists", async () => {
  const f = fixture({ photoState: false, videoBytes: GiB, videoTotal: 3 * GiB });
  assert.deepEqual(await lockSharedMediaCapacity(f.connection, { video: true }), { heldBytes: GiB, totalBytes: 3 * GiB });
  for (const changes of [{ orphanObjects: 1 }, { orphanAssets: 1 }])
    await assert.rejects(lockSharedMediaCapacity(fixture({ photoState: false, ...changes }).connection, { video: true }), SharedMediaCapacityError);
});

test("historical over-capacity remains observable without rewriting counters or resetting any history", async () => {
  const f = fixture({ photoBytes: 10 * GiB, videoBytes: 1 });
  assert.deepEqual(await lockSharedMediaCapacity(f.connection, { video: true }), { heldBytes: 10 * GiB + 1, totalBytes: 10 * GiB });
  assert.ok(f.queries.every(sql => sql.startsWith("SELECT ")));
});

test("missing or malformed capacity authorities fail closed", async () => {
  await assert.rejects(lockSharedMediaCapacity(fixture({ videoState: false }).connection, { video: true }), error => error.reason === "unavailable");
  await assert.rejects(lockSharedMediaCapacity(fixture({ photoState: false }).connection), error => error.reason === "unavailable");
  for (const changes of [{ photoBytes: -1 }, { videoBytes: "invalid" }, { photoTotal: "" }, { photoTotal: 0 },
    { photoBytes: Number.MAX_SAFE_INTEGER, videoBytes: 1 }, { videoTotal: "01" }])
    await assert.rejects(lockSharedMediaCapacity(fixture(changes).connection, { video: true }), SharedMediaCapacityError);
});
