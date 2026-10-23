import { validatePublicProfile } from "./public-profile-model.js";
import { buildPreferencesIndex } from "./preferences-model.js";
import "./i18n-preferences.js";
import "./i18n-public-profile.js";

const ui = globalThis.JessieI18n, byId = id => document.getElementById(id);
let profile = null, catalogue = null, busy = false;
const content = byId("public-profile-content"), status = byId("public-profile-status"), retry = byId("public-profile-retry"), list = byId("public-profile-preferences");
function clear() { for (const child of [...list.children]) { ui.forget(child); child.remove(); } }
function render() {
  if (!profile || !catalogue) return;
  ui.rawText(byId("public-profile-name"), profile.displayName); ui.rawText(byId("public-profile-bio"), profile.bio); byId("public-profile-bio").hidden = profile.bio.length === 0;
  clear(); const selected = new Set(profile.selectedIds), language = ui.getLanguage();
  for (const category of catalogue.categories) {
    const entries = category.preferences.filter(entry => selected.has(entry.id)); if (!entries.length) continue;
    const section = document.createElement("section"); section.className = "public-preference-category";
    const heading = document.createElement("h3"); ui.text(heading, category.name_fr); section.append(heading);
    const ul = document.createElement("ul"); ul.className = "public-preference-list";
    for (const entry of entries) { const li = document.createElement("li"); ui.rawText(li, language === "en" ? entry.en : entry.fr); ul.append(li); }
    section.append(ul); list.append(section);
  }
  if (!selected.size) { const empty = document.createElement("p"); empty.className = "status"; ui.text(empty, "Jessie n’a pas encore partagé de préférences ici."); list.append(empty); }
}
async function json(path, limit) {
  const response = await fetch(path, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Object.assign(new Error("unavailable"), { status: response.status });
  const raw = await response.text(); if (raw.length > limit) throw new Error("oversized"); return JSON.parse(raw);
}
async function load() {
  if (busy) return; busy = true; retry.hidden = true; content.hidden = true; status.hidden = false; status.classList.remove("is-error"); ui.text(status, "Chargement du profil…");
  try {
    const [value, definitions] = await Promise.all([json("/api/public/jessie", 150000), json("/preferences-catalogue.json", 200000)]);
    const validated = validatePublicProfile(value), index = buildPreferencesIndex(definitions); if (validated.selectedIds.some(id => !index.has(id))) throw new Error("invalid_preferences");
    profile = validated; catalogue = definitions; render(); status.hidden = true; content.hidden = false;
  } catch (error) { profile = null; catalogue = null; clear(); ui.rawText(byId("public-profile-name"), ""); ui.rawText(byId("public-profile-bio"), ""); ui.text(status, error.status === 404 ? "Ce profil n’est pas disponible pour le moment." : "Le profil n’a pas pu être chargé. Réessaie dans un moment."); status.classList.add("is-error"); retry.hidden = false; }
  finally { busy = false; }
}
ui.onChange(render); retry.addEventListener("click", () => void load()); void load();
