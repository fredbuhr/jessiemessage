import test from "node:test";
import assert from "node:assert/strict";
import { withClientData, DataStoreError } from "../server/data/store.mjs";
import { DATA_POLICY, DATA_POLICY_METADATA } from "../server/data/policy.mjs";

const id = (value) => Buffer.alloc(16, value), digest = (value) => Buffer.alloc(32, value);
const now = Date.parse("2026-10-15T08:00:00Z"), d = "2026-10-15 07:00:00.000000";
const target = id(1), admin = id(2), conv = id(3);
const unavailable = (error) => error instanceof DataStoreError && error.code === "DATA_STORE_UNAVAILABLE"
  && !/example|password|SELECT|cipher|secret|path/.test(error.message);
const account = () => ({ id: target, role: "client", pseudonym: "Synthetic client", email: "client@example.invalid", status: "revoked",
  created_at: d, updated_at: d, email_verified_at: d, age_declared_at: d, age_assured_at: d, access_approved_at: d,
  access_expires_at: "2026-10-15 07:30:00.000000" });
const conversation = () => ({ id: conv, client_id: target, admin_id: admin, peer_name: "Synthetic peer", created_at: d, closed_at: null,
  last_read_sequence: 1n, peer_read_sequence: "2" });
const asset = (owner = target, assetId = id(6), role = "client") => ({ asset_id: assetId, asset_owner_id: owner, asset_owner_role: role,
  storage_key: digest(7), content_digest: digest(8), width: 100, height: 80, full_bytes: 400, asset_deleted_at: null,
  asset_created_at: d, journal_state: "registered", journal_asset_id: assetId, journal_owner_id: owner });
const message = (sequence = "1", sender = target, role = "client") => ({ id: id(4), conversation_id: conv, sender_id: sender, sender_role: role,
  sequence_no: sequence, body_encrypted: "synthetic-ciphertext", body_fingerprint: digest(5), created_at: d, deleted_at: null,
  linked_media_id: null, asset_id: null });
function fixture(plan = {}) {
  const calls = []; let acquisitions = 0, commits = 0, rollbacks = 0, releases = 0;
  const connection = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (/^(SET TRANSACTION|START TRANSACTION)/.test(sql)) return {};
      if (/FROM users u/.test(sql)) return plan.accounts ?? [account()];
      if (/FROM conversations c/.test(sql)) return plan.conversations ?? [conversation()];
      if (/SELECT enabled, updated_at/.test(sql)) return plan.preferences ?? [];
      if (/SELECT 1 AS present/.test(sql)) return plan.inventory?.(sql, parameters) ?? [{ present: 1 }];
      if (/FROM messages m/.test(sql)) return plan.messages?.(sql, parameters) ?? [];
      if (/FROM media_assets a/.test(sql)) return plan.media?.(sql, parameters) ?? [];
      throw new Error("SELECT unexpected private@example.invalid");
    },
    async commit() { commits++; if (plan.commitError) throw new Error("secret commit path"); },
    async rollback() { rollbacks++; },
    release() { releases++; },
  };
  const pool = { async getConnection() { acquisitions++; return connection; } };
  return { pool, connection, calls, counts: () => ({ acquisitions, commits, rollbacks, releases }) };
}

test("data policy covers each application table once and defers every retention decision", () => {
  assert.equal(DATA_POLICY.length, 29);
  assert.equal(new Set(DATA_POLICY.map((entry) => entry.table)).size, 29);
  assert.equal(DATA_POLICY_METADATA.retentionDecided, false);
  for (const entry of DATA_POLICY) { assert.equal(entry.retentionDays, null); assert.equal(entry.decisionRequired, true); assert.ok(Object.isFrozen(entry)); }
  assert.ok(Object.isFrozen(DATA_POLICY));
  assert.deepEqual(DATA_POLICY_METADATA.existingCleanup.map((entry) => entry.days), [7, 7, 30]);
  assert.equal(DATA_POLICY_METADATA.existingCleanup.at(-1).table, "push_outbox");
});
test("data reader uses a single read-only snapshot, whitelists account data and retains revoked clients", async () => {
  const f = fixture(); let held;
  const result = await withClientData({ pool: f.pool, clientId: target, now }, async (reader) => {
    held = reader;
    assert.ok(Object.isFrozen(reader)); assert.ok(Object.isFrozen(reader.account));
    assert.equal(reader.account.status, "revoked"); assert.equal(reader.account.role, "client");
    assert.deepEqual(reader.account.id, target);
    assert.equal(reader.conversation.lastReadSequence, "1"); assert.equal(reader.conversation.peerReadSequence, "2");
    assert.deepEqual(reader.preference, { enabled: false, updatedAt: null });
    assert.doesNotMatch(JSON.stringify(reader.account), /password_hash|credential_version|encrypted/);
    return "finished";
  });
  assert.equal(result, "finished");
  assert.deepEqual(f.counts(), { acquisitions: 1, commits: 1, rollbacks: 0, releases: 1 });
  assert.equal(f.calls[0].sql, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  assert.equal(f.calls[1].sql, "START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT");
  const before = f.calls.length;
  await assert.rejects(held.messages(), unavailable); await assert.rejects(held.inventory(), unavailable); await assert.rejects(held.ownMedia(), unavailable);
  assert.equal(f.calls.length, before);
});
test("data inventory uses capped scoped metadata queries and never reads administrator/global material", async () => {
  const f = fixture({ inventory: (sql) => /FROM sessions /.test(sql) ? Array.from({ length: 10001 }, () => ({ present: 1 })) : [{ present: 1 }] });
  const inventory = await withClientData({ pool: f.pool, clientId: target, now }, (reader) => reader.inventory());
  assert.equal(inventory.length, 29);
  assert.deepEqual(inventory.find((entry) => entry.table === "sessions"), { table: "sessions", scope: "subject", count: 10000, truncated: true });
  assert.deepEqual(inventory.find((entry) => entry.table === "crm_labels"), { table: "crm_labels", scope: "administrator", count: null, truncated: false });
  assert.equal(inventory.find((entry) => entry.table === "push_subscriptions").count, 1);
  assert.equal(inventory.find((entry) => entry.table === "push_outbox").count, 1);
  const subscriptions = f.calls.find(({ sql }) => /FROM push_subscriptions WHERE/.test(sql));
  assert.deepEqual(subscriptions.parameters, [target]); assert.match(subscriptions.sql, /role = 'client'/);
  const push = f.calls.find(({ sql }) => /FROM push_outbox o/.test(sql));
  assert.deepEqual(push.parameters, [target, conv]);
  assert.doesNotMatch(push.sql, /endpoint|subscription_encrypted|p256dh|auth|lease_token/);
  for (const query of f.calls.filter(({ sql }) => /^SELECT 1 AS present/.test(sql))) {
    assert.match(query.sql, /LIMIT 10001$/); assert.ok(query.parameters[0].equals(target) || query.parameters[0].equals(conv));
    assert.doesNotMatch(query.sql, /payload|notes|password_hash|token_hash|COUNT|SELECT \*/);
  }
  assert.ok(f.calls.some(({ sql }) => /crm_profiles WHERE conversation_id/.test(sql)));
  assert.ok(f.calls.some(({ sql }) => /broadcast_recipients WHERE client_id = \? AND conversation_id = \?/.test(sql)));
  assert.equal(f.calls.some(({ sql }) => /FROM (admin_mfa|admin_recovery_codes|auth_rate_limits|crm_labels|broadcast_campaigns|media_storage_state)\b/.test(sql)), false);
});
test("data messages keyset paging validates sender bindings and removes tombstoned attachments", async () => {
  const first = { ...message("1", admin, "admin"), ...asset(admin, id(6), "admin"), linked_media_id: id(6) };
  const deleted = { ...message("2"), body_encrypted: null, deleted_at: "2026-10-15 07:01:00.000000", linked_media_id: id(10), asset_id: id(10) };
  const f = fixture({ messages: (_sql, params) => params[1] === "0" ? [first, deleted, message("3")] : [message("3")] });
  await withClientData({ pool: f.pool, clientId: target, now }, async (reader) => {
    reader.account.id.fill(9); reader.conversation.adminId.fill(9); // Public buffers cannot alter internal authorization context.
    const page = await reader.messages({ limit: 2 });
    assert.equal(page.hasMore, true); assert.equal(page.nextCursor, "2");
    assert.equal(page.rows[0].media.ownerRole, "admin"); assert.ok(page.rows[0].senderId.equals(admin));
    assert.equal(page.rows[1].encrypted, null); assert.equal(page.rows[1].media, null);
    const last = await reader.messages({ afterSequence: page.nextCursor, limit: 2 });
    assert.equal(last.hasMore, false); assert.equal(last.nextCursor, null); assert.equal(last.rows[0].sequence, "3");
  });
});
test("data own media includes unused owned active assets with safe keyset cursors", async () => {
  const f = fixture({ media: () => [asset(target, id(6)), asset(target, id(9))] });
  await withClientData({ pool: f.pool, clientId: target, now }, async (reader) => {
    const page = await reader.ownMedia({ limit: 1 });
    assert.equal(page.hasMore, true); assert.ok(page.nextCursor.equals(id(6))); assert.equal(page.rows.length, 1);
    assert.ok(page.rows[0].ownerId.equals(target));
  });
  assert.match(f.calls.find(({ sql }) => /FROM media_assets a/.test(sql)).sql, /a.owner_id = \? AND a.owner_role = 'client' AND a.deleted_at IS NULL/);
});
test("data reader allows absent conversation and validates client identity, scalar fields, dates and page inputs", async () => {
  const empty = fixture({ conversations: [] });
  await withClientData({ pool: empty.pool, clientId: target, now }, async (reader) => {
    assert.equal(reader.conversation, null);
    assert.deepEqual(await reader.messages(), { rows: [], hasMore: false, nextCursor: null });
    const inventory = await reader.inventory(); assert.equal(inventory.find((entry) => entry.table === "messages").count, 0);
    for (const options of [null, { limit: 0 }, { limit: 101 }, { afterSequence: "01" }, { afterSequence: "18446744073709551616" }, { unknown: 1 }]) await assert.rejects(reader.messages(options), unavailable);
    for (const options of [null, { afterId: "bad" }, { limit: 101 }]) await assert.rejects(reader.ownMedia(options), unavailable);
  });
  for (const modified of [{ role: "admin" }, { id: id(90) }, { status: "unexpected" }, { created_at: "2026-02-30 00:00:00.000000" }, { email: "" }, { updated_at: null }]) {
    const f = fixture({ accounts: [{ ...account(), ...modified }] });
    await assert.rejects(withClientData({ pool: f.pool, clientId: target, now }, () => assert.fail()), unavailable);
    assert.equal(f.counts().rollbacks, 1); assert.equal(f.counts().releases, 1);
  }
  for (const accounts of [[], [account(), account()]]) {
    const f = fixture({ accounts }); await assert.rejects(withClientData({ pool: f.pool, clientId: target, now }, () => assert.fail()), unavailable);
  }
});
test("data reader rejects foreign senders/conversations, broken journal or attachment bindings, malformed tombstones", async () => {
  for (const bad of [{ sender_id: id(91) }, { sender_role: "admin" }, { conversation_id: id(92) }, { sequence_no: "0" },
    { body_fingerprint: id(1) }, { deleted_at: d }, { body_encrypted: null },
    { ...asset(admin, id(6), "admin"), linked_media_id: id(6) },
    { ...asset(), linked_media_id: id(7) }, { ...asset(), linked_media_id: id(6), journal_state: "cleanup_pending" },
    { ...asset(), linked_media_id: id(6), journal_owner_id: id(99) }, { ...asset(), linked_media_id: id(6), asset_deleted_at: d }]) {
    const f = fixture({ messages: () => [{ ...message(), ...bad }] });
    await assert.rejects(withClientData({ pool: f.pool, clientId: target, now }, (reader) => reader.messages()), unavailable);
    assert.equal(f.counts().rollbacks, 1); assert.equal(f.counts().releases, 1);
  }
  for (const bad of [{ asset_owner_id: admin }, { asset_owner_role: "admin" }, { journal_asset_id: id(99) }, { width: 2049 }]) {
    const f = fixture({ media: () => [{ ...asset(), ...bad }] });
    await assert.rejects(withClientData({ pool: f.pool, clientId: target, now }, (reader) => reader.ownMedia()), unavailable);
  }
});
test("data snapshot sanitizes callback/query/commit errors and releases after rollback", async () => {
  for (const action of [async () => { throw new Error("private@example.invalid secret path"); }, (reader) => reader.messages()]) {
    const f = fixture({ messages: () => { throw new Error("SELECT password secret"); } });
    await assert.rejects(withClientData({ pool: f.pool, clientId: target, now }, action), unavailable);
    assert.deepEqual(f.counts(), { acquisitions: 1, commits: 0, rollbacks: 1, releases: 1 });
  }
  const f = fixture({ commitError: true });
  await assert.rejects(withClientData({ pool: f.pool, clientId: target, now }, () => "done"), unavailable);
  assert.deepEqual(f.counts(), { acquisitions: 1, commits: 1, rollbacks: 1, releases: 1 });
  const lostStart = fixture();
  const originalQuery = lostStart.connection.query;
  lostStart.connection.query = async (sql, parameters) => {
    if (sql.startsWith("START TRANSACTION")) throw new Error("private lost acknowledgement");
    return originalQuery(sql, parameters);
  };
  await assert.rejects(withClientData({ pool: lostStart.pool, clientId: target, now }, () => assert.fail()), unavailable);
  assert.deepEqual(lostStart.counts(), { acquisitions: 1, commits: 0, rollbacks: 1, releases: 1 });
  for (const input of [null, {}, { pool: f.pool, clientId: id(1), now: -1 }, { pool: f.pool, clientId: Buffer.alloc(15), now }]) await assert.rejects(withClientData(input, () => {}), unavailable);
});
test("data snapshot drains but rejects unawaited in-flight reads before rollback and release", async () => {
  let announce, releaseRead;
  const started = new Promise((resolve) => { announce = resolve; });
  const delayed = new Promise((resolve) => { releaseRead = resolve; });
  const f = fixture({ messages: async () => { announce(); await delayed; return [message()]; } });
  let retained, abandoned;
  const operation = withClientData({ pool: f.pool, clientId: target, now }, (reader) => {
    retained = reader; abandoned = reader.messages(); return "must not succeed";
  });
  await started;
  assert.equal(f.counts().releases, 0); assert.equal(f.counts().commits, 0);
  releaseRead();
  await assert.rejects(operation, unavailable); await assert.rejects(abandoned, unavailable);
  assert.deepEqual(f.counts(), { acquisitions: 1, commits: 0, rollbacks: 1, releases: 1 });
  const queries = f.calls.length; await assert.rejects(retained.inventory(), unavailable); assert.equal(f.calls.length, queries);
});
