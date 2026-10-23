import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createTasksStore } from "../server/tasks/store.mjs";

const now = 1792764000000, adminId = Buffer.alloc(16, 1), conversationId = Buffer.alloc(16, 2), taskId = Buffer.alloc(16, 3);
const tokenHash = Buffer.alloc(32, 4), key = randomBytes(32), clientName = "Client synthétique";
const sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const input = changes => ({ conversationId: conversationId.toString("hex"), expectedVersion: "0", title: "Tâche ordinaire", dueAt: now, done: false, ...changes });
function fixture({ experience = true, reserved = false, forceReservedRead = false } = {}) {
  let row = reserved ? { id: taskId, admin_id: adminId, admin_role: "admin", conversation_id: conversationId,
    reply_kind: "reply", reply_through: "9007199254740993", reply_reopened: 1, title_encrypted: "must-not-decrypt",
    request_fingerprint: Buffer.alloc(32, 7), done: 0, version: 4, created_at: sqlDate(now), updated_at: sqlDate(now), due_at: sqlDate(now) } : null;
  const calls = [];
  const connection = { async query(statement, args = []) {
    calls.push({ statement, args });
    if (statement.startsWith("SELECT COUNT(*)")) {
      if (experience) assert.match(statement, /t\.reply_kind IS NULL/);
      return [{ due_count: row && row.reply_kind === null && !row.done ? 1 : 0 }];
    }
    if (statement.startsWith("SELECT ") && statement.includes("FROM crm_tasks t JOIN")) {
      if (experience) assert.match(statement, /t\.reply_kind IS NULL/);
      if (!row || row.reply_kind !== null && !forceReservedRead) return [];
      return [{ ...row, client_name: clientName, conversation_admin_id: adminId }];
    }
    if (statement.startsWith("SELECT ") && statement.includes("FROM crm_tasks WHERE id = ? FOR UPDATE")) {
      if (experience) assert.match(statement, /reply_kind/);
      return row ? [{ ...row }] : [];
    }
    if (statement.startsWith("INSERT INTO crm_tasks")) {
      row = { id: args[0], admin_id: args[1], admin_role: "admin", conversation_id: args[2], title_encrypted: args[3],
        due_at: args[4], done: args[5], version: args[6], request_fingerprint: args[7], created_at: args[8], updated_at: args[9],
        reply_kind: null, reply_through: null, reply_reopened: 0 };
      return { affectedRows: 1 };
    }
    if (statement.startsWith("UPDATE crm_tasks SET")) {
      Object.assign(row, { title_encrypted: args[0], due_at: args[1], done: args[2], version: args[3], request_fingerprint: args[4], updated_at: args[5] });
      return { affectedRows: 1 };
    }
    throw new Error("Unexpected task fixture query");
  } };
  const context = { actor: { id: adminId }, client: { pseudonym: clientName }, now };
  const chatStore = { withActor: async (_, fn) => fn(connection, context), withConversation: async (_, fn) => fn(connection, context) };
  const store = createTasksStore({ pool: { getConnection: async () => { throw new Error("Schema access not expected"); } }, chatStore, key, clock: () => now, experience });
  return { store, calls, row: () => row, request: { tokenHash, now }, context };
}

test("185 compatibility excludes reserved reply tasks from open/done/due lists, get and summary", async () => {
  const f = fixture({ reserved: true });
  for (const filter of ["open", "done", "due"]) assert.deepEqual((await f.store.list({ ...f.request, filter })).tasks, []);
  assert.equal((await f.store.summary(f.request)).dueCount, 0);
  await assert.rejects(f.store.get({ ...f.request, taskId }), { code: "TASKS_NOT_FOUND" });
  assert.equal(f.calls.filter(value => /^(?:UPDATE|INSERT|DELETE)\b/.test(value.statement)).length, 0);
});
test("185 reserved revision is refused under the row lock before decryption or retry matching", async () => {
  const f = fixture({ reserved: true }), before = JSON.stringify(f.row());
  for (const expectedVersion of ["0", "3", "4"]) await assert.rejects(f.store.save({ ...f.request, taskId, input: input({ expectedVersion, done: true }) }), { code: "TASKS_CONFLICT" });
  assert.equal(JSON.stringify(f.row()), before);
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(value => value.statement.endsWith("FOR UPDATE")));
});
test("185 get also rejects an unexpectedly returned reserved row without decrypting it", async () => {
  const f = fixture({ reserved: true, forceReservedRead: true });
  await assert.rejects(f.store.get({ ...f.request, taskId }), { code: "TASKS_NOT_FOUND" });
});
test("185 schema compatibility leaves ordinary encrypted tasks editable and retries idempotent", async () => {
  const f = fixture();
  const first = await f.store.save({ ...f.request, taskId, input: input() });
  assert.equal(first.task.title, "Tâche ordinaire"); assert.equal(first.task.version, "1"); assert.equal(first.duplicate, false);
  assert.equal((await f.store.save({ ...f.request, taskId, input: input() })).duplicate, true);
  const completed = await f.store.save({ ...f.request, taskId, input: input({ expectedVersion: "1", done: true }) });
  assert.equal(completed.task.done, true); assert.equal(completed.task.version, "2");
  assert.equal(f.row().reply_kind, null); assert.equal(f.row().reply_through, null); assert.equal(f.row().reply_reopened, 0);
});
test("185 compatibility schema selection is explicit and cannot be toggled by an assertion", async () => {
  const f = fixture(); await assert.rejects(f.store.assertSchema({ video: true }), { code: "TASKS_UNAVAILABLE" });
  const legacy = fixture({ experience: false }); await assert.rejects(legacy.store.assertSchema({ video: true, experience: true }), { code: "TASKS_UNAVAILABLE" });
  for (const experience of [null, 1, "true"]) assert.throws(() => createTasksStore({ pool: {}, chatStore: {}, key, experience }), { code: "TASKS_CONFIG" });
});
