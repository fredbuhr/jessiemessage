import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";
import { createTasksService } from "../server/tasks/service.mjs";
import { TasksError } from "../server/tasks/validation.mjs";

const now = 1792594800000, adminId = "a".repeat(32), taskId = "b".repeat(32), conversationId = "c".repeat(32);
const token = newToken(), csrf = newToken(), key = randomBytes(32);
const input = (changes = {}) => ({ conversationId, expectedVersion: "0", title: "Envoyer les photos 💋 <texte>", dueAt: now + 1000, done: false, ...changes });
const task = (changes = {}) => ({ id: taskId, conversationId, clientName: "Client synthétique", title: input().title,
  dueAt: now + 1000, done: false, version: "1", createdAt: now, updatedAt: now, ...changes });
async function fixture(overrides = {}) {
  const calls = [];
  const store = { list: async value => { calls.push(["list", value]); return { tasks: [task()], hasMore: false, nextCursor: null, serverTime: now }; },
    summary: async value => { calls.push(["summary", value]); return { dueCount: 2, serverTime: now }; },
    get: async value => { calls.push(["get", value]); return { task: task(), serverTime: now }; },
    save: async value => { calls.push(["save", value]); return { task: task(), duplicate: false }; }, ...overrides.store };
  const dependencies = { store, authService: { session: async raw => raw === token ? { user: { id: adminId, role: "admin", pseudonym: "Jessie", email: "private" }, csrf, expiresAt: now + 3600000 } : null },
    authStore: { consumeRateLimit: async (bucket, options) => { calls.push(["limit", bucket, options]); return { allowed: true }; } },
    key, clock: () => now, ...overrides.dependencies };
  return { service: await createTasksService(dependencies), dependencies, calls };
}

test("task requests are validated before private reads or writes", async () => {
  const f = await fixture();
  for (const name of ["store", "authService", "authStore", "key", "clock"]) await assert.rejects(createTasksService({ ...f.dependencies, [name]: null }), { code: "TASKS_CONFIG" });
  for (const body of [{ ...input(), expectedVersion: 0 }, { ...input(), done: 1 }, { ...input(), secret: "x" }, { ...input(), title: " " }])
    await assert.rejects(f.service.save(token, taskId, body), { code: "TASKS_INPUT" });
  await assert.rejects(f.service.get(token, "invalid"), { code: "TASKS_INPUT" });
  await assert.rejects(f.service.list(token, { limit: 101 }), { code: "TASKS_INPUT" });
  assert.equal(f.calls.length, 0);
});
test("task sessions are admin-only and private authority is passed as a digest with bounded opaque budgets", async () => {
  const f = await fixture();
  const actor = await f.service.actor(token); assert.equal(actor.user.role, "admin"); assert.equal(JSON.stringify(actor).includes("private"), false);
  await assert.rejects(f.service.summary(newToken()), { code: "TASKS_UNAUTHORIZED" });
  const client = await fixture({ dependencies: { authService: { session: async () => ({ ...actor, user: { ...actor.user, role: "client" } }) } } });
  await assert.rejects(client.service.list(token), { code: "TASKS_UNAUTHORIZED" });
  await f.service.list(token, { conversationId, limit: 3 });
  await f.service.get(token, taskId); await f.service.summary(token); await f.service.save(token, taskId, input());
  for (const call of f.calls.filter(([kind]) => kind !== "limit")) { assert.ok(call[1].tokenHash.equals(tokenDigest(token))); assert.equal(call[1].now, now); }
  const listed = f.calls.find(([kind]) => kind === "list")[1]; assert.ok(listed.conversationId.equals(Buffer.from(conversationId, "hex"))); assert.equal(listed.afterId, null);
  const saved = f.calls.find(([kind]) => kind === "save")[1]; assert.ok(saved.taskId.equals(Buffer.from(taskId, "hex"))); assert.deepEqual(saved.input, input());
  assert.ok(f.calls.filter(([kind]) => kind === "limit").every(([, bucket]) => Buffer.isBuffer(bucket) && bucket.length === 32));
});
test("rate refusal and invalid clocks stop before task persistence", async () => {
  const limits = [];
  const f = await fixture({ dependencies: { authStore: { consumeRateLimit: async (_, options) => { limits.push(options.limit); return { allowed: false, retryAfter: 12 }; } } } });
  await assert.rejects(f.service.summary(token), { code: "TASKS_RATE_LIMIT", retryAfter: 12 });
  assert.deepEqual(limits, [180]); assert.equal(f.calls.length, 0);
  const invalid = await fixture({ dependencies: { clock: () => NaN } });
  await assert.rejects(invalid.service.list(token), { code: "TASKS_UNAVAILABLE" }); assert.equal(invalid.calls.length, 0);
});
test("task output refuses other conversations, cursor disorder, filter violations and private extra fields", async () => {
  const page = changes => ({ tasks: [task()], hasMore: false, nextCursor: null, serverTime: now, ...changes });
  const invalid = [page({ secret: "private SQL" }), page({ tasks: [task({ encrypted: "private" })] }), page({ tasks: [task(), task()] }),
    page({ hasMore: true }), page({ nextCursor: taskId }), page({ tasks: [task({ done: true })] }), page({ tasks: [task({ updatedAt: now + 1 })] })];
  for (const output of invalid) {
    const f = await fixture({ store: { list: async () => output } });
    await assert.rejects(f.service.list(token), { code: "TASKS_UNAVAILABLE" });
  }
  const foreign = await fixture(); await assert.rejects(foreign.service.list(token, { conversationId: "d".repeat(32) }), { code: "TASKS_UNAVAILABLE" });
  const notDue = await fixture(); await assert.rejects(notDue.service.list(token, { filter: "due" }), { code: "TASKS_UNAVAILABLE" });
  const due = await fixture({ store: { list: async () => page({ tasks: [task({ dueAt: now })] }) } });
  assert.equal((await due.service.list(token, { filter: "due" })).tasks.length, 1);
});
test("save and fresh single-task reads must refer to the requested identity and full saved revision", async () => {
  const f = await fixture(); assert.deepEqual(await f.service.save(token, taskId, input()), { task: task(), duplicate: false });
  for (const changed of [{ id: "d".repeat(32) }, { title: "Other title" }, { version: "2" }, { conversationId: "e".repeat(32) }]) {
    const invalid = await fixture({ store: { save: async () => ({ task: task(changed), duplicate: false }) } });
    await assert.rejects(invalid.service.save(token, taskId, input()), { code: "TASKS_UNAVAILABLE" });
  }
  const invalidGet = await fixture({ store: { get: async () => ({ task: task({ id: "d".repeat(32) }), serverTime: now }) } });
  await assert.rejects(invalidGet.service.get(token, taskId), { code: "TASKS_UNAVAILABLE" });
});
test("typed conflicts remain actionable while unexpected backend details remain opaque", async () => {
  const conflict = await fixture({ store: { save: async () => { throw new TasksError("TASKS_CONFLICT"); } } });
  await assert.rejects(conflict.service.save(token, taskId, input()), { code: "TASKS_CONFLICT" });
  const forbidden = await fixture({ store: { get: async () => { throw Object.assign(new Error(), { code: "CHAT_NOT_FOUND" }); } } });
  await assert.rejects(forbidden.service.get(token, taskId), { code: "TASKS_NOT_FOUND" });
  const broken = await fixture({ store: { summary: async () => { throw new Error("private SQL secret"); } } });
  await assert.rejects(broken.service.summary(token), error => error.code === "TASKS_UNAVAILABLE" && !error.message.includes("secret"));
  const malformed = await fixture({ store: { summary: async () => ({ dueCount: 1, serverTime: now, private: "x" }) } });
  await assert.rejects(malformed.service.summary(token), { code: "TASKS_UNAVAILABLE" });
});
