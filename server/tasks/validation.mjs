export const MAX_INSTANT = 253402300799999;
export const MAX_VERSION = 4294967295n;
export class TasksError extends Error {
  constructor(code = "TASKS_UNAVAILABLE", retryAfter) {
    super("Private tasks could not be completed."); this.name = "TasksError"; this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}
export const fail = code => { throw new TasksError(code); };
export function fields(value, names, optional = false) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("TASKS_INPUT");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if ((!optional && keys.length !== names.length) || keys.some(name => typeof name !== "string" || !names.includes(name)
    || !Object.hasOwn(descriptors[name], "value") || !descriptors[name].enumerable)) fail("TASKS_INPUT");
}
export function id(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) fail("TASKS_INPUT"); return value;
}
export function instant(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_INSTANT) fail("TASKS_INPUT"); return value;
}
export function version(value, zero = true) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,9})$/.test(value) || BigInt(value) > MAX_VERSION || !zero && value === "0") fail("TASKS_INPUT");
  return value;
}
export function titleText(value) {
  if (typeof value !== "string" || !value.isWellFormed() || value.length < 1 || value.length > 500 || Buffer.byteLength(value, "utf8") > 2000
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)
    || /^[\p{C}\p{Z}]*$/u.test(value)) fail("TASKS_INPUT");
  return value;
}
export function validateSave(input) {
  fields(input, ["conversationId", "expectedVersion", "title", "dueAt", "done"]);
  if (typeof input.done !== "boolean") fail("TASKS_INPUT");
  return { conversationId: id(input.conversationId), expectedVersion: version(input.expectedVersion), title: titleText(input.title),
    dueAt: input.dueAt === null ? null : instant(input.dueAt), done: input.done };
}
export function validateList(input = {}) {
  fields(input, ["filter", "conversationId", "afterId", "limit"], true);
  const filter = input.filter ?? "open", conversationId = input.conversationId ?? null, afterId = input.afterId ?? null, limit = input.limit ?? 50;
  if (!["open", "due", "done"].includes(filter) || !Number.isInteger(limit) || limit < 1 || limit > 100) fail("TASKS_INPUT");
  if (conversationId !== null) id(conversationId); if (afterId !== null) id(afterId);
  return { filter, conversationId, afterId, limit };
}
