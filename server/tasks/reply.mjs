import { createHmac, timingSafeEqual } from "node:crypto";
import { ChatStoreError } from "../chat/store.mjs";
import { openTask, sealTask } from "./crypto.mjs";

const fail = code => { throw new ChatStoreError(code); };
const sequence = value => {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n) fail("CHAT_INPUT");
  return value;
};
const storedSequence = value => sequence(String(value));
const sqlDate = value => new Date(value).toISOString().replace("T", " ").replace("Z", "000");
const timestamp = value => value instanceof Date ? value.getTime() : Date.parse(String(value).replace(" ", "T") + "Z");
const title = "À répondre";

// The reserved task is the only durable reply state. For conversations which
// predate it, only real individual administrator messages form a baseline.
export const historicalReplyThroughSql = alias => `COALESCE((SELECT MAX(answer.sequence_no) FROM messages answer WHERE answer.conversation_id = ${alias}.id AND answer.sender_role = 'admin' AND NOT EXISTS (SELECT 1 FROM broadcast_recipients delivery WHERE delivery.conversation_id = answer.conversation_id AND delivery.delivered_message_id = answer.id)), 0)`;
export const needsReplySql = alias => `(EXISTS (SELECT 1 FROM crm_tasks reply_task WHERE reply_task.admin_id = ${alias}.admin_id AND reply_task.conversation_id = ${alias}.id AND reply_task.reply_kind = 'reply' AND reply_task.reply_reopened = 1) OR EXISTS (SELECT 1 FROM messages incoming WHERE incoming.conversation_id = ${alias}.id AND incoming.sender_role = 'client' AND incoming.sequence_no > COALESCE((SELECT reply_task.reply_through FROM crm_tasks reply_task WHERE reply_task.admin_id = ${alias}.admin_id AND reply_task.conversation_id = ${alias}.id AND reply_task.reply_kind = 'reply'), ${historicalReplyThroughSql(alias)})))`;

export function createReplyTracking({ key } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError("Private reply key required");
  key = Buffer.from(key);
  const digest = (...parts) => createHmac("sha256", key).update("jessiemessage:reply-task:v1\0").update(JSON.stringify(parts)).digest();
  const taskId = context => digest("id", context.admin.id.toString("hex"), context.conversation.id.toString("hex")).subarray(0, 16);
  function fingerprint(context, through, reopened, version) {
    return digest("state", context.admin.id.toString("hex"), context.conversation.id.toString("hex"), through, reopened, version);
  }
  async function history(connection, context, through = "0") {
    const rows = await connection.query(`SELECT COALESCE(MAX(sequence_no), 0) AS latest, MIN(CASE WHEN sequence_no > ? THEN created_at ELSE NULL END) AS oldest FROM messages WHERE conversation_id = ? AND sender_role = 'client'`, [through, context.conversation.id]);
    return { latest: storedSequence(rows[0].latest), oldest: rows[0].oldest === null ? null : timestamp(rows[0].oldest) };
  }
  async function load(connection, context) {
    const row = (await connection.query("SELECT id, title_encrypted, done, version, request_fingerprint, reply_through, reply_reopened, created_at, updated_at FROM crm_tasks WHERE admin_id = ? AND conversation_id = ? AND reply_kind = 'reply' FOR UPDATE", [context.admin.id, context.conversation.id]))[0];
    if (!row) {
      const through = storedSequence((await connection.query(`SELECT ${historicalReplyThroughSql("c")} AS through_value FROM conversations c WHERE c.id = ?`, [context.conversation.id]))[0].through_value);
      return { id: taskId(context), through, reopened: false, version: "0", createdAt: context.now, updatedAt: context.now, exists: false };
    }
    const through = storedSequence(row.reply_through), reopened = Number(row.reply_reopened) === 1, version = String(row.version);
    if (!Buffer.isBuffer(row.id) || !row.id.equals(taskId(context)) || !/^[1-9][0-9]{0,9}$/.test(version) || BigInt(version) > 4294967295n
      || ![0, 1].includes(Number(row.done)) || ![0, 1].includes(Number(row.reply_reopened)) || !Buffer.isBuffer(row.request_fingerprint)
      || row.request_fingerprint.length !== 32 || !timingSafeEqual(row.request_fingerprint, fingerprint(context, through, reopened, version))) fail("CHAT_DATABASE_STATE");
    if (openTask(row.title_encrypted, key, { adminId: context.admin.id, conversationId: context.conversation.id, taskId: row.id, version, dueAt: null, done: Number(row.done) === 1 }) !== title) fail("CHAT_DATABASE_STATE");
    return { id: row.id, through, reopened, version, createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at), exists: true, done: Number(row.done) === 1 };
  }
  async function save(connection, context, state, incoming) {
    const done = !state.reopened && BigInt(incoming.latest) <= BigInt(state.through);
    if (state.exists && state.done === done && !state.changed) return state;
    const version = String(BigInt(state.version) + 1n);
    if (BigInt(version) > 4294967295n) fail("CHAT_DATABASE_STATE");
    const encrypted = sealTask(title, key, { adminId: context.admin.id, conversationId: context.conversation.id, taskId: state.id, version, dueAt: null, done });
    const proof = fingerprint(context, state.through, state.reopened, version);
    if (state.exists) await connection.query("UPDATE crm_tasks SET title_encrypted = ?, done = ?, version = ?, request_fingerprint = ?, reply_through = ?, reply_reopened = ?, updated_at = ? WHERE id = ? AND admin_id = ? AND conversation_id = ? AND reply_kind = 'reply'", [encrypted, Number(done), version, proof, state.through, Number(state.reopened), sqlDate(context.now), state.id, context.admin.id, context.conversation.id]);
    else await connection.query("INSERT INTO crm_tasks (id, admin_id, conversation_id, title_encrypted, due_at, done, version, request_fingerprint, created_at, updated_at, reply_kind, reply_through, reply_reopened) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'reply', ?, ?)", [state.id, context.admin.id, context.conversation.id, encrypted, Number(done), version, proof, sqlDate(state.createdAt), sqlDate(context.now), state.through, Number(state.reopened)]);
    return { ...state, version, exists: true, done, changed: false, updatedAt: context.now };
  }
  function view(state, incoming) {
    const needed = state.reopened || BigInt(incoming.latest) > BigInt(state.through);
    return { needed, through: incoming.latest, handledThrough: state.through, version: state.version, oldestAt: needed ? incoming.oldest ?? state.updatedAt : null };
  }
  return Object.freeze({
    async view(connection, context) {
      const state = await load(connection, context), incoming = await history(connection, context, state.through);
      return view(state, incoming);
    },
    async before(connection, context) {
      if (context.deliveryKind === "broadcast") return;
      const state = await load(connection, context);
      if (!state.exists) await save(connection, context, state, await history(connection, context, state.through));
    },
    async append(connection, context, message) {
      if (context.deliveryKind === "broadcast") return;
      const state = await load(connection, context);
      const incoming = await history(connection, context, state.through);
      if (context.actor.role === "admin" && message.replyThrough !== undefined) {
        const through = sequence(message.replyThrough);
        if (BigInt(through) > BigInt(incoming.latest)) fail("CHAT_INPUT");
        if (through !== "0" && !(await connection.query("SELECT id FROM messages WHERE conversation_id = ? AND sender_role = 'client' AND sequence_no = ?", [context.conversation.id, through])).length) fail("CHAT_INPUT");
        if (BigInt(through) > BigInt(state.through)) { state.through = through; state.changed = true; }
        // A stale response cannot dismiss a manually reopened/newer request.
        if (through === incoming.latest && state.reopened && message.replyVersion === state.version) { state.reopened = false; state.changed = true; }
      }
      await save(connection, context, state, await history(connection, context, state.through));
    },
    async mark(connection, context, input) {
      if (context.actor.role !== "admin") fail("CHAT_FORBIDDEN");
      const state = await load(connection, context), incoming = await history(connection, context, state.through);
      const through = sequence(input.through);
      if (input.expectedVersion !== state.version) fail("CHAT_CONFLICT");
      if (BigInt(through) > BigInt(incoming.latest)) fail("CHAT_INPUT");
      if (through !== "0" && !(await connection.query("SELECT id FROM messages WHERE conversation_id = ? AND sender_role = 'client' AND sequence_no = ?", [context.conversation.id, through])).length) fail("CHAT_INPUT");
      if (input.action === "handled") {
        if (BigInt(through) > BigInt(state.through)) state.through = through;
        state.reopened = false;
      } else if (input.action === "needed") state.reopened = true;
      else fail("CHAT_INPUT");
      state.changed = true;
      const result = await save(connection, context, state, await history(connection, context, state.through));
      return view(result, await history(connection, context, result.through));
    },
  });
}
