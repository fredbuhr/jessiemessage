import test from "node:test";
import assert from "node:assert/strict";
import { createChatStore } from "../server/chat/store.mjs";

// Exercise the real store with synthetic SQL responses. These counters measure
// round trips through its control flow, not query plans, latency or MariaDB.
const now = Date.UTC(2026, 9, 31, 12), id = n => Buffer.from(n.toString(16).padStart(32, "0"), "hex");
const sqlDate = n => new Date(n).toISOString().replace("T", " ").replace("Z", "000");
function fixture(size, { batchChange, expireDuringBatch = false, foreignBinding = false } = {}) {
  const queries = [], clientLocks = new Set(), proofLocks = new Set(), conversationLocks = new Set();
  const state = { current: now, batchCalls: 0, commits: 0, rollbacks: 0, decorations: 0 };
  const admin = { id: id(1), role: "admin", status: "active", pseudonym: "Synthetic admin" };
  const clients = new Map(), conversations = new Map(), previews = [], summaries = new Map();
  for (let i = 0; i < size; i++) {
    const client = { id: id(100 + i), role: "client", status: "active", pseudonym: `Synthetic ${i}`,
      email_verified_at: sqlDate(now), access_approved_at: sqlDate(now), invitation_consumed_at: sqlDate(now), access_expires_at: null };
    const conversation = { id: id(300 + i), admin_id: admin.id, client_id: client.id, created_at: sqlDate(now - 5000), closed_at: null };
    clients.set(client.id.toString("hex"), client); conversations.set(conversation.id.toString("hex"), conversation);
    const empty = i % 3 === 2, mine = i % 3 === 0;
    previews.push({ id: empty ? null : id(200 + i), conversation_id: empty ? null : conversation.id,
      sender_id: empty ? null : mine ? admin.id : client.id, sender_role: empty ? null : mine ? "admin" : "client",
      sequence_no: empty ? null : "2", client_message_id: empty ? null : id(400 + i),
      body_encrypted: empty ? null : "v1.synthetic", body_fingerprint: empty ? null : Buffer.alloc(32),
      created_at: empty ? null : sqlDate(now - i), deleted_at: null, linked_media_id: null,
      inbox_conversation_id: conversation.id, inbox_client_id: client.id, inbox_created: empty ? sqlDate(now - 5000) : sqlDate(now - i) });
    summaries.set(conversation.id.toString("hex"), {
      inbox_summary_conversation_id: conversation.id, inbox_summary_admin_id: admin.id, inbox_summary_client_id: client.id,
      latestSequence: "2", latestEventSequence: "2", lastActivityAt: sqlDate(now),
      lastReadSequence: "0", peerReadSequence: "0", unreadCount: empty ? 0 : 1,
      peerAvatarVersion: i % 2 === 0 ? "1" : null,
    });
  }
  const connection = {
    async beginTransaction() {}, async commit() { state.commits++; }, async rollback() { state.rollbacks++; }, release() {},
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.startsWith("SET TRANSACTION")) return [];
      if (sql.startsWith("SELECT user_id FROM sessions")) return [{ user_id: admin.id }];
      if (sql.includes("FROM users WHERE id = ? FOR UPDATE")) {
        if (params[0].equals(admin.id)) return [admin];
        const client = clients.get(params[0].toString("hex")); clientLocks.add(client.id.toString("hex")); return [client];
      }
      if (sql.startsWith("SELECT version, enabled_at FROM admin_mfa")) return [{ version: 1, enabled_at: sqlDate(now) }];
      if (sql.includes("FROM sessions s JOIN auth_session_state")) return [{ id: id(2), user_id: admin.id, created_at: sqlDate(now), expires_at: sqlDate(now + 1000), revoked_at: null, last_seen_at: sqlDate(now), mfa_verified_at: sqlDate(now), mfa_version: 1 }];
      if (sql.includes("AS inbox_created")) return previews;
      if (sql.startsWith("SELECT credential_version FROM client_auth_state")) { proofLocks.add(params[0].toString("hex")); return [{ credential_version: 1 }]; }
      if (sql.startsWith("SELECT id, admin_id, client_id, created_at, closed_at FROM conversations")) {
        const row = conversations.get(params[0].toString("hex")); conversationLocks.add(row.id.toString("hex"));
        return [{ ...row, ...(foreignBinding ? { client_id: id(999) } : {}) }];
      }
      if (sql.includes("AS inbox_summary_conversation_id")) {
        state.batchCalls++;
        assert.equal(clientLocks.size, size, "all selected clients are locked before summaries");
        assert.equal(proofLocks.size, size, "all selected credential proofs are locked before summaries");
        assert.equal(conversationLocks.size, size, "all selected bindings are locked before summaries");
        if (expireDuringBatch) state.current = now + 1000;
        const selected = new Set(params.slice(4).map(value => value.toString("hex")));
        const rows = [...summaries.values()].filter(row => selected.has(row.inbox_summary_conversation_id.toString("hex")));
        assert.ok(selected.size <= 50, "each shared summary query is bounded to fifty conversations");
        return batchChange ? batchChange(rows) : rows;
      }
      if (sql.includes("AS latestSequence")) return [summaries.get(params[0].toString("hex"))];
      if (sql.includes("FROM user_profiles p JOIN media_assets")) {
        const index = [...clients.keys()].indexOf(params[0].toString("hex")); return index % 2 === 0 ? [{ version: "1" }] : [];
      }
      throw new Error("Unexpected synthetic query: " + sql.slice(0, 80));
    },
  };
  const store = createChatStore({ getConnection: async () => connection }, { clock: () => state.current,
    decorateMessages: async (_connection, _context, rows) => { state.decorations++; return rows; } });
  return { store, request: { tokenHash: Buffer.alloc(32, 9), now, limit: Math.max(1, size) }, queries, state, previews, summaries };
}

for (const size of [1, 10, 50]) test(`inbox batches summaries and avatars after all locks for ${size} mixed conversations`, async t => {
  const f = fixture(size), page = await f.store.readInbox(f.request);
  t.diagnostic(JSON.stringify({ items: size, queryCalls: f.queries.length, baselineCalls: 6 + 5 * size, scope: "query calls include isolation SET; no driver transaction methods, pool setup, reply tracking or real video" }));
  assert.equal(f.queries.length, 7 + 3 * size, "three guards per conversation remain; two summary/avatar calls become one bounded batch");
  assert.equal(f.state.batchCalls, 1); assert.equal(page.items.length, size);
  for (let i = 0; i < size; i++) {
    const item = page.items[i];
    assert.equal(item.conversation.clientId.toString("hex"), f.previews[i].inbox_client_id.toString("hex"));
    assert.equal(item.unread, i % 3 !== 2);
    assert.equal(item.message === null, i % 3 === 2);
    if (item.message) assert.equal(item.message.isMine, i % 3 === 0);
    assert.equal(item.conversation.peerAvatarVersion, i % 2 === 0 ? "1" : undefined);
  }
  assert.equal(f.state.commits, 1); assert.equal(f.state.rollbacks, 0);
});

test("maximum inbox pages keep fifty-ID batches and an empty page performs no summary query", async () => {
  const maximum = fixture(100), page = await maximum.store.readInbox(maximum.request);
  assert.equal(page.items.length, 100); assert.equal(maximum.state.batchCalls, 2);
  assert.equal(maximum.queries.length, 308);
  const empty = fixture(0), noItems = await empty.store.readInbox(empty.request);
  assert.deepEqual(noItems, { items: [], hasMore: false, nextCursor: null });
  assert.equal(empty.state.batchCalls, 0); assert.equal(empty.queries.length, 6);
});

test("inbox rejects missing, duplicate, substituted or foreign preloaded bindings", async () => {
  const changes = [rows => rows.slice(1), rows => [rows[0], rows[0]],
    rows => rows.map((r, i) => i ? r : { ...r, inbox_summary_conversation_id: id(999) }),
    rows => rows.map((r, i) => i ? r : { ...r, inbox_summary_client_id: id(999) }),
    rows => rows.map((r, i) => i ? r : { ...r, inbox_summary_admin_id: id(999) })];
  for (const batchChange of changes) {
    const f = fixture(2, { batchChange });
    await assert.rejects(f.store.readInbox(f.request), error => error.code === "CHAT_DATABASE_STATE");
    assert.equal(f.state.commits, 0); assert.equal(f.state.rollbacks, 1); assert.equal(f.state.decorations, 0);
  }
});

test("inbox never batches an unvalidated binding or decorates after its session expires during the batch", async () => {
  const foreign = fixture(2, { foreignBinding: true });
  await assert.rejects(foreign.store.readInbox(foreign.request), error => error.code === "CHAT_NOT_FOUND");
  assert.equal(foreign.state.batchCalls, 0); assert.equal(foreign.state.decorations, 0);
  const expired = fixture(2, { expireDuringBatch: true });
  await assert.rejects(expired.store.readInbox(expired.request), error => error.code === "CHAT_UNAUTHORIZED");
  assert.equal(expired.state.batchCalls, 1); assert.equal(expired.state.decorations, 0); assert.equal(expired.state.commits, 0);
});
