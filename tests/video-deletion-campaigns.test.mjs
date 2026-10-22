import test from "node:test";
import assert from "node:assert/strict";
import { createVideoStore } from "../server/video/store.mjs";
import { videoStoredBytes } from "../server/video/storage.mjs";

const now = Date.UTC(2026, 9, 22, 12), sql = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const id = Buffer.alloc(16, 1), ownerId = Buffer.alloc(16, 2), peerId = Buffer.alloc(16, 3);
function fixture({ role = "admin", campaigns = [], state = "committed", references = false } = {}) {
  const capacity = { ownerBytes: 4096, totalBytes: 8192, rootFingerprint: Buffer.alloc(32, 4) };
  const row = { id, owner_id: ownerId, owner_role: role, storage_key: Buffer.alloc(32, 5), reserve_token_hash: Buffer.alloc(32, 6),
    content_digest: Buffer.alloc(32, 7), bytes: 100, stored_bytes: videoStoredBytes(100), mime: "video/mp4", state,
    created_at: sql(now - 1000), updated_at: sql(now - 1000), released_at: state === "released" ? sql(now - 1000) : null };
  const queries = []; let updates = 0;
  const connection = { async query(statement, values) {
    queries.push({ statement, values });
    if (statement.startsWith("SELECT owner_bytes")) return [{ owner_bytes: capacity.ownerBytes, total_bytes: capacity.totalBytes,
      root_fingerprint: capacity.rootFingerprint, held_bytes: row.state === "released" ? 0 : row.stored_bytes }];
    if (statement.startsWith("SELECT COALESCE(SUM(stored_bytes)")) return [{ held: row.state === "released" ? 0 : row.stored_bytes, pending: 0 }];
    if (statement.startsWith("SELECT id, owner_id")) return [{ ...row }];
    if (statement.startsWith("SELECT 1 FROM message_video")) return references ? [{}] : [];
    if (statement.startsWith("SELECT 1 FROM broadcast_campaigns")) {
      assert.match(statement, /FORCE INDEX \(broadcast_campaigns_owner_page\)/);
      assert.doesNotMatch(statement, /FOR UPDATE/);
      assert.ok(values[0].equals(ownerId));
      return campaigns.some(campaign => campaign.owner.equals(values[0]) && ["queued", "running"].includes(campaign.status)) ? [{}] : [];
    }
    if (statement.startsWith("UPDATE video_assets SET state = 'cleanup_pending'")) { updates++; row.state = "cleanup_pending"; row.updated_at = values[0]; return {}; }
    throw new Error("Unexpected synthetic statement: " + statement);
  } };
  const store = createVideoStore({ pool: { async getConnection() { throw Error("The actor owns this transaction"); } }, capacity,
    chatStore: { async withActor(_request, operation) { return operation(connection, { actor: { id: ownerId, role }, now }); } } });
  return { store, row, queries, updates: () => updates, command: { role, tokenHash: Buffer.alloc(32, 8), now, assetId: id } };
}

test("queued and running owner campaigns protect the committed video before any cleanup intent", async () => {
  for (const status of ["queued", "running"]) {
    const f = fixture({ campaigns: [{ owner: ownerId, status }] });
    await assert.rejects(f.store.deleteAsset(f.command), error => error.code === "VIDEO_IN_USE");
    assert.equal(f.row.state, "committed"); assert.equal(f.updates(), 0);
  }
});

test("terminal campaigns and another administrator's queue do not block an unused video", async () => {
  for (const status of ["completed", "cancelled", "paused"]) {
    const f = fixture({ campaigns: [{ owner: ownerId, status }, { owner: peerId, status: "queued" }] });
    assert.equal((await f.store.deleteAsset(f.command)).deletedAt, now); assert.equal(f.updates(), 1);
  }
});

test("the campaign guard leaves client ownership, live message references and cleanup retries intact", async () => {
  const client = fixture({ role: "client", campaigns: [{ owner: ownerId, status: "running" }] });
  assert.equal((await client.store.deleteAsset(client.command)).deletedAt, now);
  assert.equal(client.queries.some(value => value.statement.includes("FROM broadcast_campaigns")), false);
  const shared = fixture({ references: true });
  await assert.rejects(shared.store.deleteAsset(shared.command), error => error.code === "VIDEO_IN_USE"); assert.equal(shared.updates(), 0);
  for (const state of ["cleanup_pending", "released"]) {
    const retry = fixture({ state, campaigns: [{ owner: ownerId, status: "running" }] });
    assert.notEqual((await retry.store.deleteAsset(retry.command)).deletedAt, null); assert.equal(retry.updates(), 0);
    assert.equal(retry.queries.some(value => value.statement.includes("FROM broadcast_campaigns")), false);
  }
});
