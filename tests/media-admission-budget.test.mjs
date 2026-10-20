import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createMediaStore } from "../server/media/store.mjs";
import { BACKUP_MEDIA_MAX_BYTES, BACKUP_MEDIA_MAX_OBJECTS } from "../server/media/backup-limits.mjs";

const now = Date.UTC(2026, 9, 20), ownerId = Buffer.alloc(16, 1);
const asset = () => ({ id: randomBytes(16), storageKey: randomBytes(32), digest: randomBytes(32), width: 1, height: 1,
  thumbnailWidth: 1, thumbnailHeight: 1, fullBytes: 267, thumbnailBytes: 267 });
const charge = 614;
function fixture({ heldBytes = 0, heldObjects = 0, totalBytes = 10 * BACKUP_MEDIA_MAX_BYTES } = {}) {
  const capacity = { ownerBytes: 2 * BACKUP_MEDIA_MAX_BYTES, totalBytes, rootFingerprint: Buffer.alloc(32, 2) };
  if (capacity.ownerBytes > totalBytes) capacity.ownerBytes = totalBytes;
  const state = { heldBytes, heldObjects, ownerHeld: 0, existing: null, duplicate: null }, queries = [];
  const connection = { async query(sql, parameters) {
    queries.push(sql);
    if (sql.startsWith("SELECT owner_bytes")) return [{ owner_bytes: capacity.ownerBytes, total_bytes: capacity.totalBytes, root_fingerprint: capacity.rootFingerprint, held_bytes: state.heldBytes }];
    if (sql.startsWith("SELECT * FROM media_storage_objects")) return state.existing ? [state.existing] : [];
    if (sql.includes("SUM(stored_bytes)") && sql.includes("owner_id = ?")) return [{ value: state.ownerHeld }];
    if (sql.includes("SUM(stored_bytes)")) return [{ value: state.heldBytes }];
    if (sql.includes("FROM media_assets a WHERE a.owner_id")) return state.duplicate ? [state.duplicate] : [];
    if (sql.startsWith("SELECT COUNT(*)")) return [{ value: state.heldObjects }];
    if (sql.startsWith("INSERT INTO media_storage_objects")) { state.heldObjects += 1; return { affectedRows: 1 }; }
    if (sql.startsWith("UPDATE media_storage_state")) { state.heldBytes += parameters[0]; return { affectedRows: 1 }; }
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const chatStore = { withActor: async (_request, operation) => operation(connection, { actor: { id: ownerId, role: "client" }, now }), withConversation() {} };
  const store = createMediaStore({ pool: { getConnection() {} }, chatStore, capacity });
  const row = (value) => ({ id: value.id, owner_id: ownerId, owner_role: "client", storage_key: value.storageKey, content_digest: value.digest,
    full_bytes: value.fullBytes, thumbnail_bytes: value.thumbnailBytes, stored_bytes: charge, state: "reserved", created_at: new Date(now),
    width: 1, height: 1, thumbnail_width: 1, thumbnail_height: 1, deleted_at: null });
  return { state, queries, capacity, row, reserve: (value = asset()) => store.reserveAsset({ role: "client", tokenHash: Buffer.alloc(32, 3), now, asset: value }) };
}
const denied = (error) => error.code === "MEDIA_STORAGE_LIMIT";

test("new media charges both encrypted variants and stops at the backup byte ceiling without changing persisted quotas", async () => {
  const f = fixture({ heldBytes: BACKUP_MEDIA_MAX_BYTES - charge });
  assert.equal((await f.reserve()).reservation.bytes, charge);
  assert.equal(f.state.heldBytes, BACKUP_MEDIA_MAX_BYTES);
  await assert.rejects(f.reserve(), denied);
  assert.equal(f.queries.filter((sql) => sql.startsWith("INSERT INTO media_storage_objects")).length, 1);
  assert.equal(f.capacity.totalBytes, 10 * BACKUP_MEDIA_MAX_BYTES);
});

test("one encrypted byte beyond the backup margin refuses before any insertion or counter update", async () => {
  const f = fixture({ heldBytes: BACKUP_MEDIA_MAX_BYTES - charge + 1 });
  const before = { ...f.state };
  await assert.rejects(f.reserve(), denied); assert.deepEqual(f.state, before);
  assert.equal(f.queries.some((sql) => sql.startsWith("INSERT") || sql.startsWith("UPDATE")), false);
});

test("tiny media exhaust their backup object budget long before their byte budget", async () => {
  const f = fixture({ heldBytes: (BACKUP_MEDIA_MAX_OBJECTS - 1) * charge, heldObjects: BACKUP_MEDIA_MAX_OBJECTS - 1 });
  await f.reserve(); assert.equal(f.state.heldObjects, BACKUP_MEDIA_MAX_OBJECTS);
  assert.ok(f.state.heldBytes < BACKUP_MEDIA_MAX_BYTES);
  const before = { ...f.state };
  await assert.rejects(f.reserve(), denied); assert.deepEqual(f.state, before);
});

test("a smaller persisted global quota still takes precedence over the backup ceiling", async () => {
  const f = fixture({ totalBytes: charge - 1 }); await assert.rejects(f.reserve(), denied);
  assert.equal(f.state.heldBytes, 0); assert.equal(f.state.heldObjects, 0);
});

test("an existing uncertain reservation can be retried at both backup ceilings without a new charge", async () => {
  const f = fixture({ heldBytes: BACKUP_MEDIA_MAX_BYTES, heldObjects: BACKUP_MEDIA_MAX_OBJECTS }), value = asset();
  f.state.existing = f.row(value);
  assert.equal((await f.reserve(value)).duplicate, false);
  assert.equal(f.state.heldBytes, BACKUP_MEDIA_MAX_BYTES); assert.equal(f.state.heldObjects, BACKUP_MEDIA_MAX_OBJECTS);
  assert.equal(f.queries.some((sql) => sql.startsWith("INSERT") || sql.startsWith("UPDATE") || sql.startsWith("SELECT COUNT(*)")), false);
});

test("an already registered duplicate remains reusable at both backup ceilings", async () => {
  const f = fixture({ heldBytes: BACKUP_MEDIA_MAX_BYTES, heldObjects: BACKUP_MEDIA_MAX_OBJECTS }), value = asset();
  f.state.duplicate = f.row(value);
  const result = await f.reserve(); assert.equal(result.duplicate, true); assert.ok(result.asset.id.equals(value.id));
  assert.equal(f.queries.some((sql) => sql.startsWith("INSERT") || sql.startsWith("UPDATE") || sql.startsWith("SELECT COUNT(*)")), false);
});
