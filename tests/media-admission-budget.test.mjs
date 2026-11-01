import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createMediaStore } from "../server/media/store.mjs";

const GiB = 1024 ** 3, now = Date.UTC(2026, 9, 20), ownerId = Buffer.alloc(16, 1);
const asset = () => ({ id: randomBytes(16), storageKey: randomBytes(32), digest: randomBytes(32), width: 1, height: 1,
  thumbnailWidth: 1, thumbnailHeight: 1, fullBytes: 267, thumbnailBytes: 267 });
const charge = 614;
function fixture({ heldBytes = 0, heldObjects = 0, ownerBytes = GiB, totalBytes = 10 * GiB } = {}) {
  const capacity = { ownerBytes: Math.min(ownerBytes, totalBytes), totalBytes, rootFingerprint: Buffer.alloc(32, 2) };
  const state = { heldBytes, heldObjects, existing: null, duplicate: null }, queries = [];
  const connection = { async query(sql, parameters) {
    queries.push(sql);
    if (sql === "SELECT held_bytes, total_bytes FROM media_storage_state WHERE id = 1 FOR UPDATE") return [{ held_bytes: state.heldBytes, total_bytes: capacity.totalBytes }];
    if (sql.startsWith("SELECT owner_bytes")) return [{ owner_bytes: capacity.ownerBytes, total_bytes: capacity.totalBytes, root_fingerprint: capacity.rootFingerprint, held_bytes: state.heldBytes }];
    if (sql.startsWith("SELECT * FROM media_storage_objects")) return state.existing ? [state.existing] : [];
    if (sql.includes("SUM(stored_bytes)")) { assert.doesNotMatch(sql, /owner_id/); return [{ value: state.heldBytes }]; }
    if (sql.includes("FROM media_assets a WHERE a.owner_id")) return state.duplicate ? [state.duplicate] : [];
    if (sql.startsWith("INSERT INTO media_storage_objects")) { state.heldObjects += 1; return { affectedRows: 1 }; }
    if (sql.startsWith("UPDATE media_storage_state")) { state.heldBytes += parameters[0]; return { affectedRows: 1 }; }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const chatStore = { withActor: async (_request, operation) => operation(connection, { actor: { id: ownerId, role: "client" }, now }), withConversation() {} };
  const store = createMediaStore({ pool: { getConnection() {} }, chatStore, capacity });
  const row = value => ({ id: value.id, owner_id: ownerId, owner_role: "client", storage_key: value.storageKey, content_digest: value.digest,
    full_bytes: value.fullBytes, thumbnail_bytes: value.thumbnailBytes, stored_bytes: charge, state: "reserved", created_at: new Date(now),
    width: 1, height: 1, thumbnail_width: 1, thumbnail_height: 1, deleted_at: null });
  return { state, queries, capacity, row, reserve: (value = asset()) => store.reserveAsset({ role: "client", tokenHash: Buffer.alloc(32, 3), now, asset: value }) };
}
const denied = error => error.code === "MEDIA_STORAGE_LIMIT";

test("photos pass one GiB and historical object ceilings while preserving configured total and owner binding", async () => {
  const f = fixture({ heldBytes: GiB, heldObjects: 100001, ownerBytes: 82 });
  assert.equal((await f.reserve()).reservation.bytes, charge);
  assert.equal(f.state.heldBytes, GiB + charge); assert.equal(f.state.heldObjects, 100002);
  assert.equal(f.capacity.ownerBytes, 82); assert.equal(f.capacity.totalBytes, 10 * GiB);
  assert.ok(f.queries.every(sql => !sql.includes("COUNT(") && !(sql.includes("SUM(") && sql.includes("owner_id"))), "neither allocation history nor owner usage limits a new photo");
});

test("both encrypted variants spend the configured total exactly and the next byte is refused before mutation", async () => {
  const f = fixture({ heldBytes: 10 * GiB - charge });
  await f.reserve(); assert.equal(f.state.heldBytes, f.capacity.totalBytes);
  const before = { ...f.state }; await assert.rejects(f.reserve(), denied); assert.deepEqual(f.state, before);
  assert.equal(f.queries.filter(sql => sql.startsWith("INSERT INTO media_storage_objects")).length, 1);
});

test("a configured total smaller than the encrypted object refuses every write", async () => {
  const f = fixture({ totalBytes: charge - 1 }); await assert.rejects(f.reserve(), denied);
  assert.equal(f.state.heldBytes, 0); assert.equal(f.state.heldObjects, 0);
  assert.equal(f.queries.some(sql => sql.startsWith("INSERT") || sql.startsWith("UPDATE")), false);
});

test("an acknowledged uncertain reservation can be retried at configured capacity without another charge", async () => {
  const f = fixture({ heldBytes: 10 * GiB, heldObjects: 100001 }), value = asset();
  f.state.existing = f.row(value);
  assert.equal((await f.reserve(value)).duplicate, false);
  assert.equal(f.state.heldBytes, 10 * GiB); assert.equal(f.state.heldObjects, 100001);
  assert.equal(f.queries.some(sql => sql.startsWith("INSERT") || sql.startsWith("UPDATE") || sql.includes("COUNT(")), false);
});

test("an active duplicate remains reusable when configured capacity is exhausted", async () => {
  const f = fixture({ heldBytes: 10 * GiB, heldObjects: 100001 }), value = asset();
  f.state.duplicate = f.row(value);
  const result = await f.reserve(); assert.equal(result.duplicate, true); assert.ok(result.asset.id.equals(value.id));
  assert.equal(f.queries.some(sql => sql.startsWith("INSERT") || sql.startsWith("UPDATE") || sql.includes("COUNT(")), false);
});
