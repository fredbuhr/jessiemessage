import { selectedIds, PREFERENCES_CATALOGUE_VERSION } from "../preferences/validation.mjs";
import { MAX_AVATAR_THUMBNAIL_BYTES } from "../profile/validation.mjs";

export { PREFERENCES_CATALOGUE_VERSION };
export const MAX_PUBLIC_PROFILE_INPUT_BYTES = 65536;
export const MAX_PUBLIC_PROFILE_BYTES = 262144;
export const MAX_PUBLIC_AVATAR_BYTES = MAX_AVATAR_THUMBNAIL_BYTES;
export const MAX_PUBLIC_PROFILE_VERSION = 4294967295;
export class PublicProfileError extends Error {
  constructor(code = "PUBLIC_PROFILE_UNAVAILABLE", retryAfter) {
    super("The public profile could not be processed."); this.name = "PublicProfileError"; this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}
export const failPublicProfile = (code = "PUBLIC_PROFILE_UNAVAILABLE") => { throw new PublicProfileError(code); };
const input = () => failPublicProfile("PUBLIC_PROFILE_INPUT");
function fields(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length || Object.getOwnPropertyNames(value).length !== names.length
    || names.some(name => { const property = Object.getOwnPropertyDescriptor(value, name); return !property || !Object.hasOwn(property, "value"); })) input();
}
export function profileVersion(value) {
  return typeof value === "string" && /^(?:0|[1-9][0-9]{0,9})$/.test(value) && Number(value) <= MAX_PUBLIC_PROFILE_VERSION;
}
function text(value, min, max, lines = false) {
  if (typeof value !== "string" || value.length < min || value.length > max || value !== value.normalize("NFC")
    || /[\p{Cf}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || !lines && /[\r\n\t]/.test(value)
    || typeof value.isWellFormed === "function" && !value.isWellFormed() || min > 0 && value.trim() !== value) input();
  return value;
}
function content(value) {
  if (typeof value.published !== "boolean" || value.catalogueVersion !== PREFERENCES_CATALOGUE_VERSION) input();
  let selected;
  try { selected = selectedIds(value.selectedIds, { known: true }); } catch { input(); }
  if (selected.length !== value.selectedIds.length) input();
  return { published: value.published, displayName: text(value.displayName, 1, 64), bio: text(value.bio, 0, 1000, true),
    catalogueVersion: PREFERENCES_CATALOGUE_VERSION, selectedIds: selected };
}
export function validatePublicProfileInput(value) {
  fields(value, ["expectedVersion", "published", "displayName", "bio", "catalogueVersion", "selectedIds"]);
  if (!profileVersion(value.expectedVersion) || Number(value.expectedVersion) >= MAX_PUBLIC_PROFILE_VERSION) input();
  return { expectedVersion: value.expectedVersion, ...content(value) };
}
export function publicAvatarSnapshot(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 5 || bytes.length > MAX_PUBLIC_AVATAR_BYTES
    || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) input();
  return bytes.toString("base64");
}
function avatar(value) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > Math.ceil(MAX_PUBLIC_AVATAR_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) input();
  const bytes = Buffer.from(value, "base64");
  try { if (publicAvatarSnapshot(bytes) !== value) input(); return value; }
  finally { bytes.fill(0); }
}
export function validatePublicProfileState(value) {
  fields(value, ["format", "revision", "published", "displayName", "bio", "catalogueVersion", "selectedIds", ...(value?.format === 2 ? ["avatar"] : [])]);
  if (![1, 2].includes(value.format) || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision > MAX_PUBLIC_PROFILE_VERSION) input();
  const validated = content(value);
  if (JSON.stringify(validated.selectedIds) !== JSON.stringify(value.selectedIds)) input();
  return { format: value.format, revision: value.revision, ...validated, ...(value.format === 2 ? { avatar: avatar(value.avatar) } : {}) };
}
export const emptyPublicProfile = () => ({ format: 1, revision: 0, published: false, displayName: "Jessie", bio: "", catalogueVersion: PREFERENCES_CATALOGUE_VERSION, selectedIds: [] });
export function adminPublicProfile(state) {
  const value = validatePublicProfileState(state);
  return { version: String(value.revision), published: value.published, displayName: value.displayName, bio: value.bio,
    catalogueVersion: value.catalogueVersion, selectedIds: [...value.selectedIds] };
}
export function publicProfileView(state) {
  const value = validatePublicProfileState(state);
  if (!value.published) failPublicProfile("PUBLIC_PROFILE_NOT_FOUND");
  return { displayName: value.displayName, bio: value.bio, catalogueVersion: value.catalogueVersion, selectedIds: [...value.selectedIds] };
}
