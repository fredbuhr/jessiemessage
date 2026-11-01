import test from "node:test";
import assert from "node:assert/strict";
import { createMediaStore } from "../server/media/store.mjs";

const now = Date.UTC(2026, 10, 1, 12), sqlDate = new Date(now).toISOString().replace("T", " ").replace("Z", "000");
const owner = Buffer.alloc(16, 1), assetId = Buffer.alloc(16, 2), otherAsset = Buffer.alloc(16, 3), otherOwner = Buffer.alloc(16, 4);
function fixture({ role = "admin", campaigns = [], state = "registered", references = false, avatar = false } = {}) {
  const capacity = { ownerBytes: 10000, totalBytes: 20000, rootFingerprint: Buffer.alloc(32, 5) };
  const asset = { id: assetId, owner_id: owner, owner_role: role, storage_key: Buffer.alloc(32, 6), content_digest: Buffer.alloc(32, 7),
    width: 1, height: 1, thumbnail_width: 1, thumbnail_height: 1, full_bytes: 100, thumbnail_bytes: 30,
    created_at: sqlDate, deleted_at: state === "registered" ? null : sqlDate, shared_here: 0 };
  const object = { ...asset, asset_id: assetId, stored_bytes: 210, state, updated_at: sqlDate };
  const queries = [];
  const connection = { async query(statement, values = []) {
    queries.push(statement);
    if (statement.startsWith("SELECT owner_bytes")) return [{ owner_bytes: capacity.ownerBytes, total_bytes: capacity.totalBytes,
      root_fingerprint: capacity.rootFingerprint, held_bytes: state === "released" ? 0 : 210 }];
    if (statement.startsWith("SELECT * FROM media_storage_objects")) return [object];
    if (statement.includes("FROM media_assets a WHERE a.id =")) return [{ ...asset }];
    if (statement.startsWith("SELECT 1 FROM message_media")) return references ? [{}] : [];
    if (statement.startsWith("SELECT 1 FROM user_profiles")) return avatar ? [{}] : [];
    if (statement.startsWith("SELECT 1 FROM broadcast_campaigns")) {
      assert.match(statement, /FORCE INDEX \(broadcast_campaigns_media\)/); assert.doesNotMatch(statement, /FOR UPDATE/);
      return campaigns.some(campaign => campaign.mediaId.equals(values[0]) && campaign.ownerId.equals(values[1])
        && ["queued", "running"].includes(campaign.status)) ? [{}] : [];
    }
    if (statement.startsWith("UPDATE media_assets SET deleted_at")) { asset.deleted_at = values[0]; return {}; }
    if (statement.startsWith("UPDATE media_storage_objects SET state = 'cleanup_pending'")) { object.state = "cleanup_pending"; return {}; }
    if (statement.includes("AS shared_here FROM media_assets a")) {
      const cleanup = statement.includes("JOIN media_storage_objects");
      if (cleanup) assert.match(statement, /o\.state = 'cleanup_pending'/);
      return asset.deleted_at === null || cleanup && object.state === "cleanup_pending" ? [{ ...asset }] : [];
    }
    throw new Error("Unexpected synthetic lifecycle statement: " + statement);
  } };
  const chatStore = { withActor: (_request, operation) => operation(connection, { actor: { id: owner, role }, now }),
    withConversation: (_request, operation) => operation(connection, { actor: { id: owner, role }, now }) };
  const store = createMediaStore({ capacity, chatStore, pool: { getConnection() { throw new Error("No real database"); } } });
  return { store, asset, object, queries, request: { role, now, tokenHash: Buffer.alloc(32, 8), assetId } };
}

test("queued and running photo campaigns retain their original before any cleanup intent", async () => {
  for (const status of ["queued", "running"]) {
    const f = fixture({ campaigns: [{ ownerId: owner, mediaId: assetId, status }] });
    await assert.rejects(f.store.deleteAsset(f.request), error => error.code === "MEDIA_IN_USE");
    assert.equal(f.asset.deleted_at, null); assert.equal(f.object.state, "registered");
    assert.equal(f.queries.some(statement => statement.startsWith("UPDATE")), false);
  }
});

test("only the exact photo in its owner's active campaign blocks deletion; terminal history remains", async () => {
  for (const status of ["completed", "cancelled", "paused"]) {
    const f = fixture({ campaigns: [{ ownerId: owner, mediaId: assetId, status },
      { ownerId: otherOwner, mediaId: assetId, status: "queued" }, { ownerId: owner, mediaId: otherAsset, status: "running" }] });
    assert.equal((await f.store.deleteAsset(f.request)).deletedAt, now); assert.equal(f.object.state, "cleanup_pending");
  }
});

test("photo campaign protection preserves live references, client ownership and idempotent cleanup", async () => {
  for (const restriction of [{ references: true }, { avatar: true }]) {
    const f = fixture(restriction);
    await assert.rejects(f.store.deleteAsset(f.request), error => error.code === "MEDIA_IN_USE");
  }
  for (const options of [{ role: "client" }, { state: "cleanup_pending" }, { state: "released" }]) {
    const f = fixture({ ...options, campaigns: [{ ownerId: owner, mediaId: assetId, status: "queued" }] });
    assert.equal((await f.store.deleteAsset(f.request)).deletedAt, now);
    assert.equal(f.queries.some(statement => statement.includes("FROM broadcast_campaigns")), false);
  }
});

test("explicit admin cleanup listing recovers tombstones while ordinary selectors and reads deny them", async () => {
  for (const state of ["registered", "cleanup_pending", "released"]) {
    const f = fixture({ state });
    assert.equal((await f.store.listAssets(f.request)).assets.length, state === "registered" ? 1 : 0);
    const page = await f.store.listAssets({ ...f.request, includeCleanupPending: true });
    assert.equal(page.assets.length, state === "released" ? 0 : 1);
    if (page.assets.length) assert.equal(page.assets[0].cleanupPending, state === "cleanup_pending");
    if (state !== "registered") await assert.rejects(f.store.getOwnedAsset(f.request), error => error.code === "MEDIA_NOT_FOUND");
  }
  const f = fixture();
  for (const options of [{ role: "client", includeCleanupPending: true }, { conversationId: Buffer.alloc(16, 9), includeCleanupPending: true }, { includeCleanupPending: "1" }]) {
    await assert.rejects(f.store.listAssets({ ...f.request, ...options }), error => error.code === "MEDIA_INPUT");
  }
});
