import test from "node:test";
import assert from "node:assert/strict";
import { createVideoStore } from "../server/video/store.mjs";
import { createVideoMessageStore } from "../server/video/message-store.mjs";
import { videoStoredBytes } from "../server/video/storage.mjs";

const now = Date.UTC(2026, 9, 31, 12), sql = at => new Date(at).toISOString().replace("T", " ").replace("Z", "000");
const id = number => { const result = Buffer.alloc(16); result.writeUInt32BE(number, 12); return result; };
const admin = id(1), client = id(2), conversationId = id(3);
const code = expected => error => error.code === expected;
function fixture({ count = 100, unique = false, deleted = false } = {}) {
  const queries = [], assets = new Map();
  const rows = Array.from({ length: count }, (_, index) => ({ id: id(index + 100), conversationId, senderId: admin,
    senderRole: "admin", sequence: String(index + 1), createdAt: now - 1000, deletedAt: deleted ? now : null }));
  const links = rows.map((row, index) => {
    const videoId = id(unique ? index + 1000 : 1000);
    assets.set(videoId.toString("hex"), { id: videoId, owner_id: admin, owner_role: "admin", storage_key: Buffer.alloc(32, 4),
      reserve_token_hash: Buffer.alloc(32, 5), content_digest: Buffer.alloc(32, 6), bytes: 100, stored_bytes: videoStoredBytes(100),
      mime: "video/mp4", state: "committed", created_at: sql(now - 2000), updated_at: sql(now - 2000), released_at: null });
    return { message_id: row.id, conversation_id: conversationId, video_id: videoId, message_conversation_id: conversationId,
      sender_id: admin, sender_role: "admin", sequence_no: row.sequence, message_created_at: sql(row.createdAt),
      linked_at: sql(row.createdAt), deleted_at: row.deletedAt === null ? null : sql(row.deletedAt), photo_id: null };
  });
  const capacity = { ownerBytes: 1000000, totalBytes: 2000000, rootFingerprint: Buffer.alloc(32, 7) };
  const state = { capacityRow: { owner_bytes: capacity.ownerBytes, total_bytes: capacity.totalBytes,
    root_fingerprint: capacity.rootFingerprint, held_bytes: count * videoStoredBytes(100) }, live: true };
  const context = { actor: { id: admin, role: "admin" }, conversation: { id: conversationId, admin_id: admin, client_id: client }, now };
  const connection = { async query(statement, values = []) {
    queries.push({ statement, values });
    if (statement.startsWith("SELECT mv.message_id")) {
      if (statement.includes("WHERE mv.message_id IN")) return links.filter(row => values.some(value => value.equals(row.message_id)));
      return links.filter(row => row.deleted_at === null).toReversed();
    }
    if (statement.startsWith("SELECT owner_bytes")) return [state.capacityRow];
    if (statement.startsWith("SELECT id, owner_id") && statement.includes("WHERE id IN")) {
      assert.match(statement, /ORDER BY id FOR UPDATE$/);
      assert.ok(values.every((value, index) => index === 0 || Buffer.compare(values[index - 1], value) < 0));
      return values.map(value => assets.get(value.toString("hex"))).filter(Boolean);
    }
    throw new Error("Unexpected synthetic SQL: " + statement);
  } };
  const pool = { getConnection() { assert.fail("The current chat transaction owns the connection"); } };
  const chatStore = { withActor() {}, withConversationAppend() {},
    withConversation(_request, operation) { if (!state.live) throw Object.assign(new Error("Revoked synthetic actor"), { code: "CHAT_UNAUTHORIZED" }); return operation(connection, context); } };
  const videoStore = createVideoStore({ pool, chatStore, capacity });
  const messages = createVideoMessageStore({ pool, chatStore, videoStore });
  const decorate = (selected = rows) => messages.decorateMessages(connection, context, selected);
  const gallery = () => messages.gallery({ role: "admin", tokenHash: Buffer.alloc(32, 8), conversationId, now, limit: 100 });
  const request = row => ({ assetId: row.video_id, ownerId: row.sender_id, ownerRole: row.sender_role });
  return { rows, links, assets, queries, state, context, connection, videoStore, decorate, gallery, request };
}

test("video message pages batch one or one hundred unique originals under one capacity check", async () => {
  for (const unique of [false, true]) {
    const f = fixture({ unique }), result = await f.decorate();
    assert.equal(result.length, 100);
    assert.deepEqual(result.map(row => row.id), f.rows.map(row => row.id));
    assert.deepEqual(result.map(row => row.video.id), f.links.map(row => row.video_id));
    assert.equal(f.queries.length, 3, "one links query, one capacity lock and one originals query");
    assert.equal(f.queries.filter(query => query.statement.startsWith("SELECT owner_bytes")).length, 1);
    assert.equal(f.queries.at(-1).values.length, unique ? 100 : 1);
  }
});

test("empty pages, ordinary messages and deleted deliveries never load video originals", async () => {
  const empty = fixture({ count: 0 });
  assert.deepEqual(await empty.decorate(), []); assert.equal(empty.queries.length, 0);
  const ordinary = fixture({ count: 1 }); ordinary.links.length = 0;
  assert.deepEqual(await ordinary.decorate(), ordinary.rows); assert.equal(ordinary.queries.length, 1);
  const deleted = fixture({ deleted: true }); deleted.assets.clear();
  assert.deepEqual(await deleted.decorate(), deleted.rows); assert.equal(deleted.queries.length, 1);
});

test("repeated event positions survive while their original and SQL message identity are read once", async () => {
  const f = fixture({ count: 1 }), raw = f.rows[0], result = await f.decorate([raw, raw]);
  assert.equal(result.length, 2); assert.deepEqual(result[0], result[1]);
  assert.equal(f.queries[0].values.length, 1); assert.equal(f.queries.at(-1).values.length, 1);
});

test("the gallery batches originals without changing descending delivery order", async () => {
  for (const count of [0, 1]) {
    const f = fixture({ count }), value = await f.gallery();
    assert.equal(value.items.length, count); assert.equal(value.hasMore, false); assert.equal(value.nextBefore, null);
    assert.equal(f.queries.length, count === 0 ? 1 : 3);
  }
  const f = fixture({ unique: true }), value = await f.gallery();
  assert.equal(value.items.length, 100); assert.equal(value.hasMore, false); assert.equal(value.nextBefore, null);
  assert.deepEqual(value.items.map(item => item.sequence), f.rows.map(row => row.sequence).toReversed());
  assert.equal(f.queries.length, 3); assert.equal(f.queries.at(-1).values.length, 100);
  f.state.live = false;
  await assert.rejects(async () => f.gallery(), code("CHAT_UNAUTHORIZED"));
  assert.equal(f.queries.length, 3, "revoked conversation authority performs no catalog query");
});

test("batch reuse cannot bypass an individual delivery's binding, role or creation time", async () => {
  for (const mutate of [
    f => { f.links[1].conversation_id = id(900); },
    f => { f.links[1].message_conversation_id = id(900); },
    f => { f.links[1].sender_id = client; },
    f => { f.links[1].sender_role = "client"; },
    f => { f.links[1].photo_id = id(900); },
    f => { f.links[1].linked_at = sql(now - 999); },
    f => { f.rows[1].senderId = client; },
    f => { f.rows[1].sequence = "999"; },
    f => { f.links[1].message_created_at = sql(now - 3000); f.links[1].linked_at = sql(now - 3000); f.rows[1].createdAt = now - 3000; },
  ]) {
    const f = fixture({ count: 2 }); mutate(f);
    await assert.rejects(f.decorate(), code("VIDEO_DATABASE_STATE"));
  }
});

test("missing, wrong-owner, wrong-role, deleted and invalid originals fail the whole batch", async () => {
  for (const [change, expected] of [
    [f => f.assets.clear(), "VIDEO_NOT_FOUND"],
    [f => { f.assets.values().next().value.owner_id = client; }, "VIDEO_NOT_FOUND"],
    [f => { f.assets.values().next().value.owner_role = "client"; }, "VIDEO_NOT_FOUND"],
    [f => { const asset = f.assets.values().next().value; asset.state = "cleanup_pending"; asset.updated_at = sql(now); }, "VIDEO_NOT_FOUND"],
    [f => { f.assets.values().next().value.content_digest = null; }, "VIDEO_DATABASE_STATE"],
    [f => { f.state.capacityRow.root_fingerprint = Buffer.alloc(32, 99); }, "VIDEO_CAPACITY_UNAVAILABLE"],
  ]) {
    const f = fixture({ count: 2 }); change(f);
    await assert.rejects(f.decorate(), code(expected));
  }
});

test("an original read is never cached across operations or reused for a different owner", async () => {
  const f = fixture({ count: 1 });
  await f.decorate(); f.assets.values().next().value.state = "cleanup_pending";
  await assert.rejects(f.decorate(), code("VIDEO_NOT_FOUND"));
  assert.equal(f.queries.length, 6, "both operations recheck capacity and the current original row");
  const other = fixture({ count: 1 }), expected = other.request(other.links[0]);
  await assert.rejects(other.videoStore.getCommittedAssets(other.connection, { now, assets: [expected, { ...expected, ownerId: client }] }), code("VIDEO_NOT_FOUND"));
  assert.equal(other.queries.length, 2);
});

test("catalog batches validate bounds before any SQL and reject substituted result identities", async () => {
  const f = fixture({ count: 1 });
  for (const assets of [null, {}, Array(101).fill(f.request(f.links[0])), [{ ...f.request(f.links[0]), ownerRole: "other" }]]) {
    await assert.rejects(f.videoStore.getCommittedAssets(f.connection, { now, assets }), code("VIDEO_INPUT"));
  }
  assert.equal(f.queries.length, 0);
  assert.deepEqual(await f.videoStore.getCommittedAssets(f.connection, { now, assets: [] }), []);
  assert.equal(f.queries.length, 0);
  const original = f.connection.query;
  f.connection.query = async (...args) => {
    const values = await original(...args);
    if (args[0].includes("WHERE id IN")) return [{ ...values[0], id: id(900) }];
    return values;
  };
  await assert.rejects(f.decorate(), code("VIDEO_DATABASE_STATE"));
});

test("message adapters require the complete bounded catalog composition", () => {
  const pool = { getConnection() {} }, chatStore = { withConversation() {}, withConversationAppend() {} };
  assert.throws(() => createVideoMessageStore({ pool, chatStore,
    videoStore: { getCommittedAsset() {}, assertSchema() {} } }), code("VIDEO_INPUT"));
});
