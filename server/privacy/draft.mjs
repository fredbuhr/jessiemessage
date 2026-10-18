export const DECISIONS = Object.freeze(["D01", "D02", "D03", "D04", "D05", "D06", "D07", "D08"]);
export const MAX_DRAFT_BYTES = 45056;
export class PrivacyError extends Error {
  constructor(code = "unavailable") { super("Private preparation is unavailable."); this.name = "PrivacyError"; this.code = code; }
}
export function failPrivacy(code) { throw new PrivacyError(code); }
export function fields(value, names) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Array.isArray(value)
    || Reflect.ownKeys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(item => !item.enumerable || !Object.hasOwn(item, "value"))) failPrivacy("input");
  return value;
}
function text(value, length) {
  if (typeof value !== "string" || value.length > length || !value.isWellFormed() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) failPrivacy("input");
  return value;
}
export function validateDraft(value) {
  fields(value, ["answers", "notice"]); fields(value.answers, DECISIONS); fields(value.notice, ["fr", "en"]);
  const draft = { answers: Object.fromEntries(DECISIONS.map(id => [id, text(value.answers[id], 1024)])),
    notice: { fr: text(value.notice.fr, 12288), en: text(value.notice.en, 12288) } };
  if (Buffer.byteLength(JSON.stringify(draft)) > MAX_DRAFT_BYTES) failPrivacy("input");
  return draft;
}
export function validatePrepared(value) {
  fields(value, ["updatedAt", "draft"]);
  if (value.updatedAt !== null && (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 1 || value.updatedAt > 253402300799999)) failPrivacy("input");
  return { updatedAt: value.updatedAt, draft: validateDraft(value.draft) };
}
