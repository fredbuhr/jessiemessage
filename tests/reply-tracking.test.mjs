import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createReplyTracking, needsReplySql } from "../server/tasks/reply.mjs";

function fixture(messages = []) {
  const state = { messages, task: null, writes: 0 }, key = randomBytes(32);
  const context = { actor: { id: Buffer.alloc(16, 1), role: "admin" }, admin: { id: Buffer.alloc(16, 1) }, conversation: { id: Buffer.alloc(16, 2) }, now: 1750000000000 };
  const tracking = createReplyTracking({ key });
  const connection = { async query(sql, args) {
    if (sql.startsWith("SELECT id, title_encrypted")) return state.task ? [state.task] : [];
    if (sql.includes("AS through_value")) return [{ through_value: String(Math.max(0, ...state.messages.filter(m => m.role === "admin" && !m.broadcast).map(m => m.sequence))) }];
    if (sql.includes("AS latest")) {
      const incoming = state.messages.filter(m => m.role === "client");
      const waiting = incoming.filter(m => BigInt(m.sequence) > BigInt(args[0]));
      return [{ latest: String(Math.max(0, ...incoming.map(m => m.sequence))), oldest: waiting.length ? new Date(Math.min(...waiting.map(m => m.time))) : null }];
    }
    if (sql.startsWith("SELECT id FROM messages")) return state.messages.some(m => m.role === "client" && String(m.sequence) === args[1]) ? [{ id: Buffer.alloc(16, 3) }] : [];
    if (sql.startsWith("INSERT INTO crm_tasks")) {
      assert.equal(state.task, null, "one reserved task only"); state.writes++;
      state.task = { id: args[0], title_encrypted: args[3], done: args[4], version: args[5], request_fingerprint: args[6], created_at: args[7], updated_at: args[8], reply_through: args[9], reply_reopened: args[10] };
      return {};
    }
    if (sql.startsWith("UPDATE crm_tasks")) {
      state.writes++; Object.assign(state.task, { title_encrypted: args[0], done: args[1], version: args[2], request_fingerprint: args[3], reply_through: args[4], reply_reopened: args[5], updated_at: args[6] }); return {};
    }
    assert.fail("Unexpected query " + sql);
  } };
  const client = seq => { state.messages.push({ role: "client", sequence: seq, time: context.now - 1000 + seq }); };
  return { state, connection, context, tracking, client };
}

test("historical incoming remains pending after broadcast; individual historical reply establishes a baseline", async () => {
  const f = fixture([{ role: "client", sequence: 1, time: 1749999999000 }, { role: "admin", sequence: 2, time: 1749999999001, broadcast: true }]);
  assert.equal((await f.tracking.view(f.connection, f.context)).needed, true);
  assert.equal(f.state.task, null, "reading alone creates no task and treats nothing");
  f.state.messages.push({ role: "admin", sequence: 3, time: 1749999999002 });
  assert.equal((await f.tracking.view(f.connection, f.context)).needed, false);
});

test("successful individual reply handles only its captured incoming watermark", async () => {
  const f = fixture(); f.client(1);
  await f.tracking.before(f.connection, f.context);
  const observed = await f.tracking.view(f.connection, f.context);
  f.client(2); // Arrived during the upload/send: never covered by this reply.
  await f.tracking.append(f.connection, f.context, { replyThrough: observed.through, replyVersion: observed.version });
  const reply = await f.tracking.view(f.connection, f.context);
  assert.equal(reply.needed, true); assert.equal(reply.handledThrough, "1"); assert.equal(reply.through, "2"); assert.equal(f.state.task.done, 0);
  await f.tracking.append(f.connection, f.context, { replyThrough: "2", replyVersion: reply.version });
  assert.equal((await f.tracking.view(f.connection, f.context)).needed, false); assert.equal(f.state.task.done, 1);
});

test("broadcast and legacy sends without captured watermark cannot clear current pending request", async () => {
  const f = fixture(); f.client(1); await f.tracking.before(f.connection, f.context);
  const before = structuredClone(f.state.task);
  await f.tracking.append(f.connection, { ...f.context, deliveryKind: "broadcast" }, { replyThrough: "1" });
  assert.equal(f.state.task.version, before.version);
  await f.tracking.append(f.connection, f.context, {});
  assert.equal((await f.tracking.view(f.connection, f.context)).needed, true);
});

test("manual reopen is shared; a response drafted before it cannot silently dismiss it", async () => {
  const f = fixture(); f.client(1); await f.tracking.before(f.connection, f.context);
  const initial = await f.tracking.view(f.connection, f.context);
  await f.tracking.append(f.connection, f.context, { replyThrough: "1", replyVersion: initial.version });
  const old = await f.tracking.view(f.connection, f.context);
  await f.tracking.mark(f.connection, f.context, { action: "needed", through: old.through, expectedVersion: old.version });
  await f.tracking.append(f.connection, f.context, { replyThrough: old.through, replyVersion: old.version });
  assert.equal((await f.tracking.view(f.connection, f.context)).needed, true);
  const latest = await f.tracking.view(f.connection, f.context);
  await f.tracking.mark(f.connection, f.context, { action: "handled", through: latest.through, expectedVersion: latest.version });
  assert.equal((await f.tracking.view(f.connection, f.context)).needed, false);
});

test("manual handling respects unseen incoming; stale/manual invalid IDs and client access refuse", async () => {
  const f = fixture(); f.client(1); await f.tracking.before(f.connection, f.context);
  const old = await f.tracking.view(f.connection, f.context); f.client(2);
  await f.tracking.mark(f.connection, f.context, { action: "handled", through: old.through, expectedVersion: old.version });
  assert.equal((await f.tracking.view(f.connection, f.context)).needed, true);
  await assert.rejects(f.tracking.mark(f.connection, f.context, { action: "handled", through: "2", expectedVersion: old.version }), e => e.code === "CHAT_CONFLICT");
  const current = await f.tracking.view(f.connection, f.context);
  await assert.rejects(f.tracking.mark(f.connection, f.context, { action: "handled", through: "3", expectedVersion: current.version }), e => e.code === "CHAT_INPUT");
  await assert.rejects(f.tracking.mark(f.connection, { ...f.context, actor: { role: "client" } }, { action: "handled", through: "2", expectedVersion: current.version }), e => e.code === "CHAT_FORBIDDEN");
});

test("reserved watermark is authenticated and ciphertext is not a private cleartext task", async () => {
  const f = fixture(); f.client(1); await f.tracking.before(f.connection, f.context);
  assert.ok(!f.state.task.title_encrypted.includes("À répondre"));
  f.state.task.reply_through = "1";
  await assert.rejects(f.tracking.view(f.connection, f.context), e => e.code === "CHAT_DATABASE_STATE");
  assert.match(needsReplySql("c"), /broadcast_recipients/);
});
