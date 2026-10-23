// Disposable loopback SQL only. This test exercises schema compatibility and
// reserved-row preservation; existing task-flow tests cover session ACLs.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { databaseOptions, connectDatabase } from "../server/db/connection.mjs";
import { applyMigrations, createdMigrationTables } from "../server/db/migrations.mjs";
import { loadExperienceMigrations } from "../server/experience/migrations.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createTasksStore } from "../server/tasks/store.mjs";
import { openTask, sealTask } from "../server/tasks/crypto.mjs";

const enabled = process.env.JESSIEMESSAGE_DB_TEST === "1";
// Fixed 1.9 wire format, kept in the test only. The rollback has no reply engine.
const replyDigest = (key, ...parts) => createHmac("sha256", key).update("jessiemessage:reply-task:v1\0").update(JSON.stringify(parts)).digest();
const replyId = (key, adminId, conversationId) => replyDigest(key, "id", adminId.toString("hex"), conversationId.toString("hex")).subarray(0, 16);
const replyProof = (key, adminId, conversationId, through, reopened, version) => replyDigest(key, "state", adminId.toString("hex"), conversationId.toString("hex"), through, reopened, version);
const id = () => randomBytes(16), sql = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
test("185 on real SQL38 hides and preserves reply state while ordinary reminders remain editable", {
  skip: enabled ? false : "Set JESSIEMESSAGE_DB_TEST=1 with an explicit loopback disposable database.", timeout: 120000,
}, async () => {
  const options = databaseOptions();
  assert.ok(["127.0.0.1", "::1", "localhost"].includes(options.host));
  assert.match(options.database, /^jessiemessage_test(?:_[a-z0-9]+)*$/);
  const migrations = await loadExperienceMigrations(); assert.equal(migrations.length, 38);
  const allowedTables = [...createdMigrationTables(migrations).reverse(), "migration_probe", "schema_migrations"];
  const connection = await connectDatabase(); let pool;
  async function reset() {
    const tables = await connection.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [options.database]);
    assert.ok(tables.every(table => allowedTables.includes(table.name)), "refuse cleanup of unrelated tables");
    for (const table of allowedTables) await connection.query(`DROP TABLE IF EXISTS ${table}`);
  }
  try {
    await reset(); await applyMigrations(connection, { database: options.database, migrations });
    pool = await createRuntimePool(process.env);
    const now = Date.now(), key = randomBytes(32), adminId = id(), clientId = id(), conversationId = id(), ordinaryId = id();
    const reservedId = replyId(key, adminId, conversationId);
    for (const [userId, role] of [[adminId, "admin"], [clientId, "client"]]) await connection.query(`INSERT INTO users
      (id, role, status, pseudonym, email, password_hash, email_verified_at, age_assured_at, access_approved_at, created_at, updated_at)
      VALUES (?, ?, 'active', ?, ?, 'synthetic-not-a-password', ?, ?, ?, ?, ?)`,
      [userId, role, role === "admin" ? "Jessie" : "Client synthétique", `${userId.toString("hex")}@example.invalid`, ...Array(5).fill(sql(now - 1000))]);
    await connection.query("INSERT INTO conversations (id, admin_id, client_id, created_at) VALUES (?, ?, ?, ?)", [conversationId, adminId, clientId, sql(now - 1000)]);
    const encrypted = sealTask("À répondre", key, { adminId, conversationId, taskId: reservedId, version: "1", dueAt: null, done: false });
    await connection.query(`INSERT INTO crm_tasks (id, admin_id, conversation_id, title_encrypted, due_at, done, version,
      request_fingerprint, created_at, updated_at, reply_kind, reply_through, reply_reopened)
      VALUES (?, ?, ?, ?, NULL, 0, 1, ?, ?, ?, 'reply', 0, 1)`,
      [reservedId, adminId, conversationId, encrypted, replyProof(key, adminId, conversationId, "0", true, "1"), sql(now), sql(now)]);
    const snapshot = async () => {
      const row = (await connection.query("SELECT * FROM crm_tasks WHERE id = ?", [reservedId]))[0];
      assert.equal(row.due_at, null);
      assert.ok(row.id.equals(replyId(key, adminId, conversationId)));
      assert.ok(timingSafeEqual(row.request_fingerprint, replyProof(key, adminId, conversationId, String(row.reply_through), Number(row.reply_reopened) === 1, String(row.version))));
      assert.equal(openTask(row.title_encrypted, key, { adminId, conversationId, taskId: row.id, version: String(row.version), dueAt: null, done: Number(row.done) === 1 }), "À répondre");
      return JSON.stringify(row, (_, value) => typeof value === "bigint" ? value.toString() : value);
    };
    const before = await snapshot();
    const wrap = async (_, fn) => {
      const conn = await pool.getConnection();
      try { await conn.beginTransaction(); const result = await fn(conn, { now, actor: { id: adminId }, client: { pseudonym: "Client synthétique" } }); await conn.commit(); return result; }
      catch (error) { await conn.rollback(); throw error; }
      finally { await conn.release(); }
    };
    const store = createTasksStore({ pool, chatStore: { withActor: wrap, withConversation: wrap }, key, clock: () => now, experience: true });
    assert.equal(await store.assertSchema({ video: true, experience: true }), true);
    await assert.rejects(store.assertSchema({ video: true }), { code: "TASKS_UNAVAILABLE" });
    const request = { tokenHash: randomBytes(32), now };
    const input = { conversationId: conversationId.toString("hex"), expectedVersion: "0", title: "Rappel ordinaire", dueAt: now, done: false };
    for (const filter of ["open", "due", "done"]) assert.equal((await store.list({ ...request, filter })).tasks.length, 0);
    assert.equal((await store.summary(request)).dueCount, 0);
    await assert.rejects(store.get({ ...request, taskId: reservedId }), { code: "TASKS_NOT_FOUND" });
    for (const expectedVersion of ["0", "1"]) await assert.rejects(store.save({ ...request, taskId: reservedId, input: { ...input, expectedVersion, done: true } }), { code: "TASKS_CONFLICT" });
    const created = await store.save({ ...request, taskId: ordinaryId, input }); assert.equal(created.task.version, "1");
    assert.equal((await store.save({ ...request, taskId: ordinaryId, input })).duplicate, true);
    assert.equal((await store.summary(request)).dueCount, 1);
    const completed = await store.save({ ...request, taskId: ordinaryId, input: { ...input, expectedVersion: "1", done: true } });
    assert.equal(completed.task.done, true); assert.equal((await store.summary(request)).dueCount, 0);
    const listed = await store.list({ ...request, filter: "done" }); assert.deepEqual(listed.tasks.map(value => value.id), [ordinaryId.toString("hex")]);
    assert.equal(await snapshot(), before, "ciphertext, fingerprint, version and reply watermarks are byte-for-byte preserved");
  } finally {
    await pool?.end(); await reset(); await connection.end();
  }
});
