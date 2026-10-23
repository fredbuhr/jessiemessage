import catalogue from "../../public/preferences-catalogue.json" with { type: "json" };
import { buildPreferencesIndex, preferenceId, preferenceVersion, validatePreferencesView, PREFERENCES_CATALOGUE_VERSION, MAX_PREFERENCES } from "../../public/preferences-model.js";
export { preferenceVersion, validatePreferencesView, PREFERENCES_CATALOGUE_VERSION };
export const preferencesIndex = buildPreferencesIndex(catalogue);
export const MAX_PREFERENCES_BODY_BYTES = 65536;
export const MAX_PREFERENCES_ENVELOPE_BYTES = 90000;
export class PreferencesError extends Error {
  constructor(code = "PREFERENCES_UNAVAILABLE", retryAfter) { super("Private preferences could not be processed."); this.name = "PreferencesError"; this.code = code; if (retryAfter !== undefined) this.retryAfter = retryAfter; }
}
export const failPreferences = code => { throw new PreferencesError(code); };
export const ownerId = value => { if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) failPreferences("PREFERENCES_INPUT"); return value; };
export function selectedIds(value, { known = false } = {}) {
  if (!Array.isArray(value) || value.length > MAX_PREFERENCES || value.some(id => !preferenceId(id) || known && !preferencesIndex.has(id))) failPreferences("PREFERENCES_INPUT");
  const set = new Set(value);
  return [...preferencesIndex.keys()].filter(id => set.delete(id)).concat([...set].sort());
}
export function validatePreferencesSave(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 3 || !["expectedVersion", "catalogueVersion", "selectedIds"].every(key => Object.hasOwn(value, key)) || !preferenceVersion(value.expectedVersion)) failPreferences("PREFERENCES_INPUT");
  if (value.catalogueVersion !== PREFERENCES_CATALOGUE_VERSION) failPreferences("PREFERENCES_CATALOGUE_CHANGED");
  return { expectedVersion: value.expectedVersion, catalogueVersion: value.catalogueVersion, selectedIds: selectedIds(value.selectedIds, { known: true }) };
}
