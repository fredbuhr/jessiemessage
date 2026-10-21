import test from "node:test";
import assert from "node:assert/strict";
import { withClientData, DataStoreError } from "../server/data/store.mjs";
import { createVideoDataReader } from "../server/video/data-store.mjs";
import { videoStoredBytes } from "../server/video/storage.mjs";

const id = (n) => Buffer.alloc(16, n), digest = (n) => Buffer.alloc(32, n);
const now = Date.UTC(2026, 9, 21, 12), at = "2026-10-21 11:00:00.000000", nowSql = "2026-10-21 12:00:00.000000";
const unavailable = (error) => error instanceof DataStoreError && error.code === "DATA_STORE_UNAVAILABLE" && error.cause === undefined;
const context = () => ({ clientId: id(1), conversation: { id: id(3), clientId: id(1), adminId: id(2) }, now, nowSql });
const message = (n = 4, extra = {}) => ({ id: id(n), conversationId: id(3), senderId: id(1), senderRole: "client", sequence: String(n - 3),
  encrypted: "v1.synthetic", fingerprint: digest(5), createdAt: at, deletedAt: null, media: null, ...extra });
const link = (n = 4, video = 6, extra = {}) => ({ message_id: id(n), conversation_id: id(3), video_id: id(video), created_at: at, photo_id: null, ...extra });
const asset = (n = 6, extra = {}) => ({ id: id(n), owner_id: id(1), owner_role: "client", storage_key: digest(n), content_digest: digest(n + 1),
  bytes: 65537, stored_bytes: videoStoredBytes(65537), mime: "video/mp4", state: "committed", created_at: at, updated_at: at, released_at: null, ...extra });
function native(plan = {}) {
  const calls = [];
  const connection = { async query(sql, parameters) {
    calls.push({ sql, parameters });
    assert.match(sql, /^SELECT /); assert.doesNotMatch(sql, /FOR UPDATE|LOCK IN SHARE MODE|INSERT|DELETE|UPDATE\s+[a-z_]+\s+SET/i);
    if (sql.includes("FROM message_video")) return plan.links ?? [link()];
    if (sql.includes("FROM video_assets")) return sql.includes("WHERE owner_id") ? (plan.own?.(parameters) ?? plan.assets ?? [asset()]) : (plan.assets ?? [asset()]);
    throw new Error("Unexpected read");
  } };
  return { connection, calls };
}
function wrapper(plan = {}) {
  const calls = [], counts = { acquisitions: 0, commits: 0, rollbacks: 0, releases: 0 };
  const connection = { async query(sql, parameters = []) {
    calls.push({ sql, parameters });
    if (/^(SET TRANSACTION|START TRANSACTION)/.test(sql)) return {};
    assert.match(sql, /^SELECT /); assert.doesNotMatch(sql, /FOR UPDATE|LOCK IN SHARE MODE/);
    if (/FROM users u/.test(sql)) return [{ id: id(1), role: "client", pseudonym: "Synthetic", email: "synthetic@example.invalid", status: "revoked",
      created_at: at, updated_at: at, email_verified_at: at, age_declared_at: at, age_assured_at: null, access_approved_at: at, access_expires_at: null }];
    if (/FROM conversations c/.test(sql)) return [{ id: id(3), client_id: id(1), admin_id: id(2), peer_name: "Synthetic peer",
      created_at: at, closed_at: null, last_read_sequence: "0" }];
    if (/SELECT enabled, updated_at|FROM user_profiles p/.test(sql)) return [];
    if (/FROM messages m/.test(sql)) return plan.messages ?? [];
    throw new Error("Unexpected private query");
  }, async commit() { counts.commits++; }, async rollback() { counts.rollbacks++; }, release() { counts.releases++; } };
  return { connection, calls, counts, pool: { async getConnection() { counts.acquisitions++; return connection; } } };
}
const sqlMessage = (n) => ({ id: id(n), conversation_id: id(3), sender_id: id(1), sender_role: "client", sequence_no: String(n - 3),
  body_encrypted: "v1.synthetic", body_fingerprint: digest(5), created_at: at, deleted_at: null, linked_media_id: null, asset_id: null });
const options = (fixture, video) => ({ pool: fixture.pool, clientId: id(1), now, ...(video === undefined ? {} : { video }) });
const emptyVideo = () => ({ async decorateMessages(_tx, _context, rows) { return rows.map((row) => ({ ...row, video: null })); },
  async ownVideos() { return { rows: [], hasMore: false, nextCursor: null }; } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("operator video extension is explicit and all-or-none; normal reader keeps its SQL and shape", async () => {
  const f = wrapper({ messages: [sqlMessage(4)] });
  await withClientData(options(f), async (reader) => {
    assert.equal(Object.hasOwn(reader, "ownVideos"), false);
    assert.equal(Object.hasOwn((await reader.messages()).rows[0], "video"), false);
  });
  assert.ok(f.calls.every(({ sql }) => !/message_video|video_assets/.test(sql)));
  assert.equal(f.calls[0].sql, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  assert.equal(f.calls[1].sql, "START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT");
  for (const video of [{}, { decorateMessages() {} }, { ownVideos() {} }, [], true]) {
    const invalid = wrapper();
    await assert.rejects(withClientData(options(invalid, video), () => {}), unavailable);
    assert.equal(invalid.counts.acquisitions, 0);
  }
});

test("video export callbacks batch only selected live deliveries, preserve order and never lock or mutate SQL", async () => {
  const rows = [message(4), message(5, { senderId: id(2), senderRole: "admin" }), message(8)];
  const f = native({ links: [link(5, 7), link()], assets: [asset(7, { owner_id: id(2), owner_role: "admin" }), asset()] });
  const output = await createVideoDataReader().decorateMessages(f.connection, context(), rows);
  assert.deepEqual(output.map((row) => row.id), rows.map((row) => row.id));
  assert.equal(output[0].video.state, "committed"); assert.equal(output[0].video.createdAt, at);
  assert.equal(output[1].video.ownerRole, "admin"); assert.equal(output[2].video, null);
  assert.deepEqual(f.calls[0].parameters, rows.map((row) => row.id));
  assert.deepEqual(f.calls[1].parameters.map((value) => value.toString("hex")).sort(), [id(6), id(7)].map((value) => value.toString("hex")));
  assert.ok(f.calls.every(({ sql }) => !/reserve_token_hash|SELECT \*/.test(sql)));
  assert.equal(rows[0].video, undefined, "decoration does not add fields to its input objects");
});

test("video delivery reader refuses divergent conversation, sender, role, date and double-photo bindings", async () => {
  for (const change of [{ conversation_id: id(9) }, { created_at: nowSql }, { photo_id: id(8) }, { video_id: Buffer.alloc(15) }]) {
    const f = native({ links: [link(4, 6, change)] });
    await assert.rejects(createVideoDataReader().decorateMessages(f.connection, context(), [message()]), unavailable);
  }
  for (const change of [{ senderId: id(9) }, { senderRole: "guest" }, { senderId: id(2), senderRole: "client" },
    { conversationId: id(9) }, { media: { id: id(6) } }]) {
    const f = native();
    await assert.rejects(createVideoDataReader().decorateMessages(f.connection, context(), [message(4, change)]), unavailable);
  }
  const duplicate = native({ links: [link(), link()] });
  await assert.rejects(createVideoDataReader().decorateMessages(duplicate.connection, context(), [message()]), unavailable);
});

test("video export rejects noncommitted, foreign or malformed catalog metadata without exposing reservation secrets", async () => {
  for (const change of [{ state: "reserved" }, { state: "released", released_at: nowSql }, { owner_id: id(9) }, { owner_role: "admin" },
    { bytes: 0 }, { bytes: 104857601 }, { stored_bytes: 65537 }, { content_digest: Buffer.alloc(31) }, { storage_key: Buffer.alloc(31) },
    { mime: "image/jpeg" }, { released_at: nowSql }, { created_at: "2026-10-21 11:00:01.000000", updated_at: "2026-10-21 11:00:01.000000" },
    { updated_at: "2026-10-21 12:00:01.000000" }]) {
    const f = native({ assets: [asset(6, change)] });
    await assert.rejects(createVideoDataReader().decorateMessages(f.connection, context(), [message()]), unavailable);
  }
  for (const assets of [[], [asset(), asset()], [asset(9)]]) {
    const f = native({ assets }); await assert.rejects(createVideoDataReader().decorateMessages(f.connection, context(), [message()]), unavailable);
  }
});

test("video tombstones never fetch their former live asset and empty batches perform no SQL", async () => {
  const f = native({ assets: [] }), reader = createVideoDataReader();
  const output = await reader.decorateMessages(f.connection, context(), [message(4, { encrypted: null, deletedAt: nowSql })]);
  assert.equal(output[0].video, null); assert.equal(output[0].encrypted, null);
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].sql, /FROM message_video/);
  assert.deepEqual(await reader.decorateMessages(f.connection, { ...context(), conversation: null }, []), []);
  assert.equal(f.calls.length, 1);
});

test("own video keyset pages enforce selected client, limit plus one, cursor order and lookahead metadata", async () => {
  const f = native({ own: (parameters) => parameters.length === 3 ? [asset(6), asset(7), asset(8)] : [asset(8)] }), reader = createVideoDataReader();
  const first = await reader.ownVideos(f.connection, context(), { limit: 2 });
  assert.equal(first.hasMore, true); assert.deepEqual(first.nextCursor, id(7)); assert.deepEqual(first.rows.map((row) => row.id), [id(6), id(7)]);
  assert.deepEqual(f.calls[0].parameters, [id(1), nowSql, 3]); assert.match(f.calls[0].sql, /owner_role = 'client' AND state = 'committed'/);
  const second = await reader.ownVideos(f.connection, context(), { afterId: first.nextCursor, limit: 2 });
  assert.deepEqual(second.rows.map((row) => row.id), [id(8)]); assert.equal(second.hasMore, false); assert.equal(second.nextCursor, null);
  assert.deepEqual(f.calls[1].parameters, [id(1), nowSql, id(7), 3]);
  for (const assets of [[asset(7), asset(6)], [asset(6), asset(7), asset(8, { owner_id: id(9) })], [asset(6, { owner_role: "admin" })]]) {
    const invalid = native({ assets });
    await assert.rejects(reader.ownVideos(invalid.connection, context(), { limit: 2 }), unavailable);
  }
});

test("operator wrapper checks decorated identities, own-video options and scope without widening normal reads", async () => {
  for (const decorateMessages of [
    async (_tx, _ctx, rows) => rows.toReversed(),
    async (_tx, _ctx, rows) => { rows[0].id.fill(9); return rows; },
    async (_tx, _ctx, rows) => rows.map((row) => ({ ...row, conversationId: id(9) })),
    async (_tx, _ctx, rows) => rows.map((row) => ({ ...row, sequence: "9" })),
  ]) {
    const f = wrapper({ messages: [sqlMessage(4), sqlMessage(5)] });
    await assert.rejects(withClientData(options(f, { ...emptyVideo(), decorateMessages }), (reader) => reader.messages()), unavailable);
    assert.equal(f.counts.commits, 0); assert.equal(f.counts.rollbacks, 1); assert.equal(f.counts.releases, 1);
  }
  const f = wrapper(); let retained, reads = 0;
  const video = { ...emptyVideo(), async ownVideos(tx, ctx, page) {
    reads++; assert.equal(tx, f.connection); assert.deepEqual(ctx, context()); assert.deepEqual(page, { afterId: id(6), limit: 2 });
    return { rows: [{ id: id(7) }], hasMore: false, nextCursor: null };
  } };
  await withClientData(options(f, video), async (reader) => {
    retained = reader;
    for (const page of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { afterId: "bad" }, { extra: true }]) await assert.rejects(reader.ownVideos(page), unavailable);
    assert.equal(reads, 0); assert.deepEqual((await reader.ownVideos({ afterId: id(6), limit: 2 })).rows[0].id, id(7));
  });
  await assert.rejects(retained.ownVideos(), unavailable); assert.equal(reads, 1);
  assert.equal(f.counts.commits, 1); assert.equal(f.counts.releases, 1);
});

test("operator video callback work stays serialized and forgotten in-flight reads drain before rollback/release", async () => {
  const f = wrapper(), entered = deferred(), release = deferred(); let held;
  const operation = withClientData(options(f, { ...emptyVideo(), async ownVideos() {
    entered.resolve(); await release.promise; return { rows: [], hasMore: false, nextCursor: null };
  } }), async (reader) => {
    held = reader; const pending = reader.ownVideos(); await entered.promise;
    await assert.rejects(reader.messages(), unavailable); release.resolve(); await pending;
  });
  await operation; assert.equal(f.counts.commits, 1); await assert.rejects(held.ownVideos(), unavailable);
  const abandonedFixture = wrapper(), started = deferred(), unblock = deferred(); let abandoned;
  const unfinished = withClientData(options(abandonedFixture, { ...emptyVideo(), async ownVideos() {
    started.resolve(); await unblock.promise; return { rows: [], hasMore: false, nextCursor: null };
  } }), async (reader) => { abandoned = reader.ownVideos(); await started.promise; });
  await started.promise;
  assert.equal(abandonedFixture.counts.commits, 0); assert.equal(abandonedFixture.counts.releases, 0);
  unblock.resolve(); await assert.rejects(unfinished, unavailable); await assert.rejects(abandoned, unavailable);
  assert.deepEqual(abandonedFixture.counts, { acquisitions: 1, commits: 0, rollbacks: 1, releases: 1 });
});
