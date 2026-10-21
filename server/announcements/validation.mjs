import { validateMessageBody } from "../chat/crypto.mjs";

export const MAX_INSTANT = 253402300799999;
export const MAX_REVISION = 18446744073709551615n;
export const WINDOW_MILLISECONDS = 7 * 86400000;
export class AnnouncementsError extends Error {
  constructor(code = "ANNOUNCEMENTS_UNAVAILABLE", retryAfter) {
    super("Private announcements could not be completed."); this.name = "AnnouncementsError"; this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}
export const fail = (code) => { throw new AnnouncementsError(code); };
export function fields(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("ANNOUNCEMENTS_INPUT");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some(name => typeof name !== "string" || !names.includes(name)
    || !Object.hasOwn(descriptors[name], "value") || !descriptors[name].enumerable)) fail("ANNOUNCEMENTS_INPUT");
}
export function id(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) fail("ANNOUNCEMENTS_INPUT");
  return value;
}
export function revision(value, zero = true) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > MAX_REVISION || !zero && value === "0") fail("ANNOUNCEMENTS_INPUT");
  return value;
}
export function instant(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_INSTANT) fail("ANNOUNCEMENTS_INPUT");
  return value;
}
export function bodyText(value) {
  try { validateMessageBody(value); } catch { fail("ANNOUNCEMENTS_INPUT"); }
  if (value.length > 1000 || Buffer.byteLength(value, "utf8") > 4000) fail("ANNOUNCEMENTS_INPUT");
  return value;
}
export function validateSave(value) {
  fields(value, ["mutationId", "expectedRevision", "body", "startsAt", "expiresAt", "sendPrivateMessage", "previewToken"]);
  if (typeof value.sendPrivateMessage !== "boolean" || (value.sendPrivateMessage
    ? typeof value.previewToken !== "string" || value.previewToken.length < 1 || value.previewToken.length > 4096 || /[^\x21-\x7e]/.test(value.previewToken)
    : value.previewToken !== null)) fail("ANNOUNCEMENTS_INPUT");
  const startsAt = value.startsAt === null ? null : instant(value.startsAt), expiresAt = instant(value.expiresAt);
  if (startsAt !== null && expiresAt <= startsAt) fail("ANNOUNCEMENTS_INPUT");
  return { mutationId: id(value.mutationId), expectedRevision: revision(value.expectedRevision), body: bodyText(value.body), startsAt, expiresAt,
    sendPrivateMessage: value.sendPrivateMessage, previewToken: value.previewToken };
}
export function validateRemove(value) {
  fields(value, ["mutationId", "expectedRevision"]);
  return { mutationId: id(value.mutationId), expectedRevision: revision(value.expectedRevision) };
}
