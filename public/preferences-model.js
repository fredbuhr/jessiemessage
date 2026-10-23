export const PREFERENCES_CATALOGUE_VERSION = "2026-10-23-recherche-1";
export const MAX_PREFERENCES = 1200;
export const preferenceId = value => typeof value === "string" && value.length <= 64 && /^pref_c[0-9]{2}_[a-z0-9-]+$/.test(value);
export const preferenceVersion = value => typeof value === "string" && /^(?:0|[1-9][0-9]{0,9})$/.test(value) && BigInt(value) <= 4294967295n;
export const normalizePreferenceSearch = value => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");

export function validatePreferencesCatalogue(value) {
  if (!value || value.meta?.version !== PREFERENCES_CATALOGUE_VERSION || !Array.isArray(value.categories) || value.categories.length !== 25) throw new TypeError("invalid_preferences_catalogue");
  const ids = new Set(), categories = new Set(); let aliases = 0;
  for (const [position, category] of value.categories.entries()) {
    if (!category || !/^c[0-9]{2}$/.test(category.id) || categories.has(category.id) || category.order !== position + 1 || typeof category.name_fr !== "string" || !category.name_fr.trim() || !Array.isArray(category.preferences)) throw new TypeError("invalid_preferences_catalogue");
    categories.add(category.id);
    for (const entry of category.preferences) {
      if (!entry || !preferenceId(entry.id) || ids.has(entry.id) || !entry.id.startsWith(`pref_${category.id}_`) || typeof entry.fr !== "string" || !entry.fr.trim() || typeof entry.en !== "string" || !entry.en.trim() || !Array.isArray(entry.aliases) || entry.aliases.some(alias => typeof alias !== "string" || !alias.trim())) throw new TypeError("invalid_preferences_catalogue");
      ids.add(entry.id); aliases += entry.aliases.length;
    }
  }
  if (ids.size !== 691 || aliases !== 934) throw new TypeError("invalid_preferences_catalogue");
  return value;
}

export function buildPreferencesIndex(catalogue) {
  validatePreferencesCatalogue(catalogue);
  return new Map(catalogue.categories.flatMap(category => category.preferences.map(entry => [entry.id, { ...entry, categoryId: category.id, search: normalizePreferenceSearch([entry.fr, entry.en, ...entry.aliases].join(" ")) }])));
}
export function matchesPreference(entry, search) {
  const words = normalizePreferenceSearch(search).split(" ").filter(Boolean);
  return words.every(word => entry.search.includes(word));
}
export function validatePreferencesView(value) {
  if (!value || !preferenceVersion(value.version) || typeof value.catalogueVersion !== "string" || value.catalogueVersion.length < 1 || value.catalogueVersion.length > 64 || !Array.isArray(value.selectedIds) || value.selectedIds.length > MAX_PREFERENCES || value.selectedIds.some(id => !preferenceId(id)) || new Set(value.selectedIds).size !== value.selectedIds.length) throw new TypeError("invalid_preferences_view");
  return { version: value.version, catalogueVersion: value.catalogueVersion, selectedIds: [...value.selectedIds] };
}
