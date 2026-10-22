export const MAX_QUICK_REPLIES = 50;
export const MAX_QUICK_REPLIES_BYTES = 32768;
export const MAX_QUICK_REPLIES_VERSION = 4294967295;

export class QuickRepliesError extends Error {
  constructor(code = "QUICK_REPLIES_UNAVAILABLE", retryAfter) {
    super("Private saved replies could not be completed."); this.name = "QuickRepliesError"; this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}
export const failQuickReplies = code => { throw new QuickRepliesError(code); };
export function fields(value, names) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Array.isArray(value)
    || Reflect.ownKeys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(item => !item.enumerable || !Object.hasOwn(item, "value"))) failQuickReplies("QUICK_REPLIES_INPUT");
  return value;
}
export function ownerId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) failQuickReplies("QUICK_REPLIES_INPUT");
  return value;
}
export function version(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,9})$/.test(value) || BigInt(value) > BigInt(MAX_QUICK_REPLIES_VERSION)) failQuickReplies("QUICK_REPLIES_INPUT");
  return value;
}
export function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_QUICK_REPLIES_VERSION) failQuickReplies("QUICK_REPLIES_INPUT");
  return value;
}
export function validateReplies(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_QUICK_REPLIES
    || Reflect.ownKeys(value).length !== value.length + 1) failQuickReplies("QUICK_REPLIES_INPUT");
  const seen = new Set(), result = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) failQuickReplies("QUICK_REPLIES_INPUT");
    const reply = fields(descriptor.value, ["id", "title", "body", "language"]);
    ownerId(reply.id);
    if (seen.has(reply.id) || !["fr", "en"].includes(reply.language)
      || typeof reply.title !== "string" || reply.title.length < 1 || reply.title.length > 64 || !reply.title.isWellFormed()
      || reply.title.trim() !== reply.title || /^[\p{C}\p{Z}]+$/u.test(reply.title) || /[\x00-\x1f\x7f-\x9f]/u.test(reply.title)
      || typeof reply.body !== "string" || reply.body.length < 1 || reply.body.length > 4096 || !reply.body.isWellFormed()
      || !reply.body.trim().length || /^[\p{C}\p{Z}]+$/u.test(reply.body) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(reply.body)) failQuickReplies("QUICK_REPLIES_INPUT");
    seen.add(reply.id); result.push({ id: reply.id, title: reply.title, body: reply.body, language: reply.language });
  }
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_QUICK_REPLIES_BYTES) failQuickReplies("QUICK_REPLIES_INPUT");
  return result;
}
export function validateSave(value) {
  fields(value, ["expectedVersion", "replies"]);
  return { expectedVersion: version(value.expectedVersion), replies: validateReplies(value.replies) };
}
export function quickRepliesView(value) {
  fields(value, ["version", "replies"]);
  return { version: version(value.version), replies: validateReplies(value.replies) };
}
