import test from "node:test";
import assert from "node:assert/strict";
import { DELETION_FACT_NAMES, readDeletionFacts, DeletionStoreError } from "../server/data/deletion-store.mjs";
import { withClientData } from "../server/data/store.mjs";

const id = (n) => Buffer.alloc(16, n), clientId = id(1), adminId = id(2), conversationId = id(3);
const now = Date.parse("2026-10-15T08:00:00Z"), nowSql = "2026-10-15 08:00:00.000000";
const context = { id: conversationId, clientId, adminId };
const unavailable = (error) => error.code === "DATA_STORE_UNAVAILABLE" && !/private@example|secret|SELECT/.test(error.message);
const present = (count) => Array.from({ length: count }, () => ({ present: 1 }));

test("deletion facts have a fixed order, capped reference counts and metadata-only bound queries", async () => {
  const queries = [];
  const connection = { async query(sql, parameters) {
    const index = queries.length; queries.push({ sql, parameters }); return present(index === 0 ? 10001 : index === 1 ? 10000 : 1);
  } };
  const result = await readDeletionFacts({ connection, clientId, conversation: context, nowSql });
  assert.ok(Object.isFrozen(DELETION_FACT_NAMES)); assert.equal(DELETION_FACT_NAMES.length, 19);
  assert.deepEqual(result.map((item) => item.name), DELETION_FACT_NAMES);
  assert.deepEqual(result[0], { name: "activeSessions", count: 10000, truncated: true });
  assert.deepEqual(result[1], { name: "verificationPending", count: 10000, truncated: false });
  assert.equal(queries.length, 19);
  for (const { sql, parameters } of queries) {
    assert.match(sql, /^SELECT 1 AS present /); assert.match(sql, /LIMIT 10001$/);
    assert.doesNotMatch(sql, /COUNT\s*\(|SELECT \*|payload|notes_encrypted|password_hash|token_hash|lease_token|FOR UPDATE|DELETE|INSERT|UPDATE/);
    assert.ok(parameters.every((value) => Buffer.isBuffer(value) || value === nowSql));
  }
  assert.match(queries[5].sql, /client_id = \? AND conversation_id = \? AND state = 'pending'/);
  assert.match(queries[13].sql, /other\.conversation_id <> \?/);
  assert.match(queries[18].sql, /UNION ALL/);
  assert.equal((queries[18].sql.match(/LIMIT 10001/g) ?? []).length, 3);
});
test("without a conversation all client-sender, receipt and recipient links are foreign", async () => {
  const queries = [];
  await readDeletionFacts({ connection: { async query(sql, parameters) { queries.push({ sql, parameters }); return []; } }, clientId, conversation: null, nowSql });
  assert.match(queries[5].sql, /WHERE 1 = 0/); assert.match(queries[6].sql, /WHERE 1 = 0/); assert.match(queries[13].sql, /WHERE 1 = 0/);
  assert.match(queries[14].sql, /FROM messages WHERE sender_id = \?/);
  assert.match(queries[15].sql, /FROM chat_receipts WHERE user_id = \?/);
  assert.match(queries[16].sql, /FROM broadcast_recipients WHERE client_id = \?/);
  assert.equal(queries[11].parameters.length, 1);
});
test("deletion facts reject malformed identities, timestamps, row shapes and private database errors", async () => {
  const connection = { async query() { return []; } };
  for (const changed of [{ clientId: Buffer.alloc(15) }, { nowSql: "2026-02-30 08:00:00.000000" }, { conversation: undefined },
    { conversation: { ...context, clientId: id(9) } }, { conversation: { ...context, adminId: clientId } }, { nowSql: new Date(now) }]) {
    await assert.rejects(readDeletionFacts({ connection, clientId, conversation: context, nowSql, ...changed }), unavailable);
  }
  for (const rows of [null, {}, [{ present: "1" }], [{ present: 1, email: "private@example.invalid" }], present(10002)]) {
    await assert.rejects(readDeletionFacts({ connection: { async query() { return rows; } }, clientId, conversation: context, nowSql }), unavailable);
  }
  await assert.rejects(readDeletionFacts({ connection: { async query() { throw new Error("SELECT private@example.invalid secret"); } }, clientId, conversation: context, nowSql }),
    (error) => error instanceof DeletionStoreError && unavailable(error));
});
test("deletion facts share the client reader's one read-only snapshot and reject reads after callback", async () => {
  const queries = []; let releases = 0, commits = 0, retained;
  const connection = { async query(sql, parameters) {
    queries.push({ sql, parameters });
    if (/^(SET|START)/.test(sql)) return {};
    if (/FROM users u/.test(sql)) return [{ id: clientId, role: "client", pseudonym: "Synthetic client", email: "client@example.invalid", status: "revoked",
      created_at: nowSql, updated_at: nowSql, email_verified_at: null, age_declared_at: nowSql, age_assured_at: null,
      access_approved_at: null, access_expires_at: null }];
    if (/FROM conversations c/.test(sql)) return [{ id: conversationId, client_id: clientId, admin_id: adminId, peer_name: "Peer", created_at: nowSql,
      closed_at: null, last_read_sequence: 0n, peer_read_sequence: 0n }];
    if (/SELECT enabled/.test(sql)) return [];
    return [];
  }, async commit() { commits++; }, async rollback() {}, release() { releases++; } };
  let acquisitions = 0;
  const pool = { async getConnection() { acquisitions++; return connection; } };
  await withClientData({ pool, clientId, now }, async (reader) => {
    retained = reader; reader.account.id.fill(7); reader.conversation.id.fill(8);
    const facts = await reader.deletionFacts(); assert.equal(facts.length, 19);
  });
  assert.equal(acquisitions, 1); assert.equal(commits, 1); assert.equal(releases, 1);
  assert.equal(queries.filter(({ sql }) => /^SELECT 1 AS present/.test(sql)).length, 19);
  assert.equal(queries[1].sql, "START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT");
  const previous = queries.length; await assert.rejects(retained.deletionFacts(), unavailable); assert.equal(queries.length, previous);
  const bindings = queries.find(({ sql }) => /FROM broadcast_recipients WHERE client_id = \? AND conversation_id/.test(sql)).parameters;
  assert.ok(bindings[0].equals(clientId)); assert.ok(bindings[1].equals(conversationId));
});
