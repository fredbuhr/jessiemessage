import { createHmac } from "node:crypto";
import { tokenDigest } from "../auth/crypto.mjs";
import { TasksError, fail, fields, id, instant, version, titleText, validateList, validateSave } from "./validation.mjs";

function checked(operation) { try { return operation(); } catch { fail(); } }
function actorView(value) {
  if (!value?.user || value.user.role !== "admin") fail("TASKS_UNAUTHORIZED");
  checked(() => { id(value.user.id); tokenDigest(value.csrf); instant(value.expiresAt); });
  if (typeof value.user.pseudonym !== "string" || value.user.pseudonym.length > 64 || !value.user.pseudonym.isWellFormed()) fail();
  return { user: { id: value.user.id, role: "admin", pseudonym: value.user.pseudonym }, csrf: value.csrf, expiresAt: value.expiresAt };
}
export function taskView(value) {
  return checked(() => {
    fields(value, ["id", "conversationId", "clientName", "title", "dueAt", "done", "version", "createdAt", "updatedAt"]);
    id(value.id); id(value.conversationId); titleText(value.title); version(value.version, false);
    instant(value.createdAt); instant(value.updatedAt);
    if (value.dueAt !== null) instant(value.dueAt);
    if (typeof value.done !== "boolean" || typeof value.clientName !== "string" || value.clientName.length > 64
      || !value.clientName.length || !value.clientName.isWellFormed() || value.updatedAt < value.createdAt) fail();
    return { id: value.id, conversationId: value.conversationId, clientName: value.clientName, title: value.title,
      dueAt: value.dueAt, done: value.done, version: value.version, createdAt: value.createdAt, updatedAt: value.updatedAt };
  });
}
export function taskListView(value, input) {
  return checked(() => {
    fields(value, ["tasks", "hasMore", "nextCursor", "serverTime"]); instant(value.serverTime);
    if (!Array.isArray(value.tasks) || value.tasks.length > input.limit || typeof value.hasMore !== "boolean") fail();
    let previous = input.afterId;
    const tasks = Array.from(value.tasks, raw => {
      const task = taskView(raw);
      if (previous !== null && task.id <= previous || task.updatedAt > value.serverTime
        || input.conversationId !== null && task.conversationId !== input.conversationId
        || input.filter === "done" && !task.done || input.filter !== "done" && task.done
        || input.filter === "due" && (task.dueAt === null || task.dueAt > value.serverTime)) fail();
      previous = task.id; return task;
    });
    if (value.nextCursor !== null) id(value.nextCursor);
    if (value.hasMore ? tasks.length !== input.limit || value.nextCursor !== previous : value.nextCursor !== null) fail();
    return { tasks, hasMore: value.hasMore, nextCursor: value.nextCursor, serverTime: value.serverTime };
  });
}
export function taskSummaryView(value) {
  return checked(() => {
    fields(value, ["dueCount", "serverTime"]); instant(value.serverTime);
    if (!Number.isSafeInteger(value.dueCount) || value.dueCount < 0) fail();
    return { dueCount: value.dueCount, serverTime: value.serverTime };
  });
}
export function taskGetView(value, taskId) {
  return checked(() => {
    fields(value, ["task", "serverTime"]); instant(value.serverTime);
    const task = taskView(value.task);
    if (task.id !== taskId || task.updatedAt > value.serverTime) fail();
    return { task, serverTime: value.serverTime };
  });
}
export function taskSaveView(value, taskId, input) {
  return checked(() => {
    fields(value, ["task", "duplicate"]);
    if (typeof value.duplicate !== "boolean") fail();
    const task = taskView(value.task);
    if (task.id !== taskId || task.conversationId !== input.conversationId || task.title !== input.title
      || task.dueAt !== input.dueAt || task.done !== input.done || task.version !== String(BigInt(input.expectedVersion) + 1n)) fail();
    return { task, duplicate: value.duplicate };
  });
}

export async function createTasksService({ store, authService, authStore, key, clock = Date.now } = {}) {
  if (!["list", "summary", "get", "save"].every(name => typeof store?.[name] === "function") || typeof authService?.session !== "function"
    || typeof authStore?.consumeRateLimit !== "function" || !Buffer.isBuffer(key) || key.length !== 32 || typeof clock !== "function") fail("TASKS_CONFIG");
  key = Buffer.from(key);
  async function guarded(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof TasksError) throw error;
      if (["AUTH_INVALID", "CHAT_UNAUTHORIZED"].includes(error?.code)) fail("TASKS_UNAUTHORIZED");
      if (["CHAT_FORBIDDEN", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"].includes(error?.code)) fail("TASKS_FORBIDDEN");
      if (error?.code === "CHAT_NOT_FOUND") fail("TASKS_NOT_FOUND");
      if (["AUTH_RATE_LIMIT", "AUTH_BUSY", "CHAT_RATE_LIMIT"].includes(error?.code)) throw new TasksError("TASKS_RATE_LIMIT", error.retryAfter);
      fail();
    }
  }
  async function actor(token) {
    try { tokenDigest(token); } catch { fail("TASKS_UNAUTHORIZED"); }
    return actorView(await authService.session(token));
  }
  async function context(token, mutation = false) {
    const session = await actor(token), now = checked(() => instant(clock()));
    const budgets = mutation ? [["user-write", session.user.id, 120]] : [["user-read", session.user.id, 180], ["global-read", "all", 300]];
    for (const [name, identity, limit] of budgets) {
      const bucket = createHmac("sha256", key).update("jessiemessage:tasks-rate:v1:").update(name).update("\0").update(identity).digest();
      const result = await authStore.consumeRateLimit(bucket, { now, windowSeconds: 60, limit });
      if (!result || typeof result.allowed !== "boolean") fail();
      if (!result.allowed) throw new TasksError("TASKS_RATE_LIMIT", result.retryAfter);
    }
    return { tokenHash: tokenDigest(token), now: checked(() => instant(clock())) };
  }
  return Object.freeze({
    actor: token => guarded(() => actor(token)),
    list: (token, input = {}) => guarded(async () => {
      input = validateList(input);
      const request = await context(token);
      return taskListView(await store.list({ ...request, ...input,
        conversationId: input.conversationId === null ? null : Buffer.from(input.conversationId, "hex"),
        afterId: input.afterId === null ? null : Buffer.from(input.afterId, "hex") }), input);
    }),
    summary: token => guarded(async () => taskSummaryView(await store.summary(await context(token)))),
    get: (token, taskId) => guarded(async () => {
      id(taskId); return taskGetView(await store.get({ ...await context(token), taskId: Buffer.from(taskId, "hex") }), taskId);
    }),
    save: (token, taskId, input) => guarded(async () => {
      id(taskId); input = validateSave(input);
      return taskSaveView(await store.save({ ...await context(token, true), taskId: Buffer.from(taskId, "hex"), input }), taskId, input);
    }),
  });
}
