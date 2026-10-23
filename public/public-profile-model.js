import { preferenceId, preferenceVersion, PREFERENCES_CATALOGUE_VERSION, MAX_PREFERENCES } from "./preferences-model.js";

const text = (value, limit, lines = false) => typeof value === "string" && value.length <= limit && (lines || value.length > 0 && value.trim() === value)
  && value === value.normalize("NFC") && !/[\p{Cf}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) && (lines || !/[\r\n\t]/u.test(value))
  && (typeof value.isWellFormed !== "function" || value.isWellFormed());
export function validatePublicProfile(value, admin = false) {
  const fields = ["displayName", "bio", "catalogueVersion", "selectedIds", ...(admin ? ["version", "published"] : [])];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))
    || !text(value.displayName, 64) || !text(value.bio, 1000, true) || value.catalogueVersion !== PREFERENCES_CATALOGUE_VERSION
    || !Array.isArray(value.selectedIds) || value.selectedIds.length > MAX_PREFERENCES || value.selectedIds.some(id => !preferenceId(id))
    || new Set(value.selectedIds).size !== value.selectedIds.length || admin && (!preferenceVersion(value.version) || typeof value.published !== "boolean")) throw new TypeError("invalid_public_profile");
  return { displayName: value.displayName, bio: value.bio, catalogueVersion: value.catalogueVersion, selectedIds: [...value.selectedIds], ...(admin ? { version: value.version, published: value.published } : {}) };
}
