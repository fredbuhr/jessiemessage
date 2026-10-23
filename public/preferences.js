import { buildPreferencesIndex, matchesPreference, validatePreferencesView, PREFERENCES_CATALOGUE_VERSION } from "./preferences-model.js";
import "./i18n-preferences.js";
const ui = globalThis.JessieI18n ?? { text: (node, text) => { node.textContent = text; }, attr: (node, name, value) => node.setAttribute(name, value), rawText: (node, text) => { node.textContent = text; }, forget() {}, getLanguage: () => "fr" };

export function createPreferencesUI({ role, request, isCurrent, onError, host, conversationId = null, readOnly = conversationId !== null, loadCatalogue } = {}) {
  if (!["admin", "client"].includes(role) || typeof request !== "function" || typeof isCurrent !== "function" || !host?.append || conversationId !== null && (role !== "admin" || !/^[a-f0-9]{32}$/.test(conversationId)) || conversationId !== null && !readOnly) throw new TypeError("invalid_preferences_adapter");
  const path = `/api/profile/${role}${conversationId === null ? "" : `/conversations/${conversationId}`}/preferences`;
  const node = (tag, source, className = "") => { const value = document.createElement(tag); if (source !== undefined) ui.text(value, source); if (className) value.className = className; return value; };
  const action = (source, handler) => { const value = node("button", source, "button secondary"); value.type = "button"; value.addEventListener("click", handler); return value; };
  const section = node("section", undefined, "preferences-section"); section.hidden = true;
  const title = node("h3", readOnly ? "Goûts & fantasmes" : "Mes goûts & fantasmes");
  const help = node("p", "Facultatif. Tes choix restent accessibles à toi et aux administrateurs autorisés.", "preferences-help"); help.hidden = readOnly;
  const status = node("p", undefined, "preferences-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const searchLabel = node("label", "Rechercher une préférence", "preferences-search-label"), search = node("input", undefined, "preferences-search");
  search.type = "search"; search.maxLength = 120; search.autocomplete = "off"; ui.attr(search, "placeholder", "Rechercher en français, en anglais ou avec un synonyme"); searchLabel.append(search); searchLabel.hidden = readOnly;
  const selectedTitle = node("h4", readOnly ? "Sélections partagées" : "Mes sélections"), summary = node("div", undefined, "preferences-selected");
  const categories = node("div", undefined, "preferences-categories");
  const family = node("p", "J’aime / Mes fantasmes", "preferences-help"); family.hidden = readOnly;
  const saveButton = action("Enregistrer mes choix", () => { void save(); }), clearButton = action("Tout effacer", () => { if (!active() || busy || readOnly) return; selected.clear(); render(); message("Les choix ont été retirés du brouillon. Enregistre pour appliquer ce changement."); });
  const buttons = node("div", undefined, "preferences-actions"); buttons.append(saveButton, clearButton); buttons.hidden = readOnly;
  const conflictBox = node("div", undefined, "preferences-conflict"); conflictBox.hidden = true;
  const reload = action("Recharger les choix enregistrés", () => { void load(); }), keep = action("Garder mes choix en cours", () => { void load(true); }); conflictBox.append(reload, keep);
  const retry = action("Réessayer le chargement des préférences", () => { void load(); }); retry.hidden = true;
  section.append(title, help, status, retry, searchLabel, selectedTitle, summary, family, categories, conflictBox, buttons); host.append(section);
  let destroyed = false, opened = false, epoch = 0, busy = false, catalogue = null, index = null, saved = null, selected = new Set(), conflict = false;
  const controllers = new Set(), expanded = new Set();
  const active = () => !destroyed && opened && isCurrent() && document.visibilityState !== "hidden";
  const current = ticket => active() && ticket === epoch;
  function message(source, error = false) { ui.text(status, source); status.classList.toggle("is-error", error); }
  function clearChildren(target) { ui.forget?.(target); target.replaceChildren(); }
  function label(entry) { return ui.getLanguage?.() === "en" ? entry.en : entry.fr; }
  function controls() {
    saveButton.disabled = busy || !saved || conflict; clearButton.disabled = busy || !saved || selected.size === 0;
    search.disabled = busy || !saved; reload.disabled = busy; keep.disabled = busy; retry.disabled = busy;
    for (const button of categories.querySelectorAll("button")) button.disabled = busy || readOnly;
    for (const button of summary.querySelectorAll("button")) button.disabled = busy || readOnly;
    conflictBox.hidden = !conflict; section.setAttribute("aria-busy", String(busy));
  }
  function updateChoices() {
    for (const button of categories.querySelectorAll("button")) {
      const chosen = selected.has(button.getAttribute("data-preference-id"));
      button.setAttribute("aria-pressed", String(chosen)); button.classList.toggle("is-selected", chosen);
    }
  }
  function toggle(id) { if (!active() || busy || readOnly || !index?.has(id)) return; if (selected.has(id)) selected.delete(id); else selected.add(id); renderSummary(); updateChoices(); controls(); }
  function renderSummary() {
    clearChildren(summary); if (!saved || !index) return;
    if (!selected.size) summary.append(node("p", "Aucune sélection.", "preferences-help"));
    for (const id of selected) {
      const entry = index.get(id), chip = node(readOnly ? "span" : "button", undefined, "preference-choice is-selected");
      if (entry) ui.rawText(chip, label(entry)); else ui.text(chip, "Choix d’un ancien catalogue");
      if (!readOnly) { chip.type = "button"; chip.setAttribute("aria-pressed", "true"); chip.addEventListener("click", () => { if (!active() || busy) return; const focused = document.activeElement === chip; selected.delete(id); renderSummary(); updateChoices(); controls(); if (focused) saveButton.focus({ preventScroll: true }); }); }
      summary.append(chip);
    }
  }
  function render() {
    renderSummary(); clearChildren(categories);
    if (!saved || !index) { controls(); return; }
    let results = 0;
    for (const category of catalogue.categories) {
      const matches = category.preferences.filter(entry => readOnly ? selected.has(entry.id) : matchesPreference(index.get(entry.id), search.value));
      if (!matches.length) continue; const firstSearchResult = results === 0 && search.value.trim() !== ""; results += matches.length;
      const details = node("details", undefined, "preference-category"), heading = node("summary");
      const name = node("span", category.name_fr), count = node("span", undefined, "preference-count");
      ui.rawText(count, ` ${matches.length}`); heading.append(name, count); details.append(heading); details.open = expanded.has(category.id) || firstSearchResult;
      const list = node("div", undefined, "preference-grid"); let rendered = false;
      const populate = () => {
        if (rendered || !details.open) return; rendered = true;
        for (const entry of matches) {
          const button = node(readOnly ? "span" : "button", undefined, "preference-choice"); ui.rawText(button, label(entry));
          if (!readOnly) { button.type = "button"; button.setAttribute("data-preference-id", entry.id); button.setAttribute("aria-pressed", String(selected.has(entry.id))); button.classList.toggle("is-selected", selected.has(entry.id)); button.disabled = busy; button.addEventListener("click", () => toggle(entry.id)); }
          list.append(button);
        }
      };
      details.addEventListener("toggle", () => { if (details.open) expanded.add(category.id); else expanded.delete(category.id); populate(); });
      details.append(list); categories.append(details); populate();
    }
    if (!results) categories.append(node("p", "Aucun résultat pour cette recherche.", "preferences-help"));
    controls();
  }
  async function ask(options, ticket) {
    const controller = new AbortController(); controllers.add(controller);
    try { const value = await request(path, { ...options, account: true, signal: controller.signal }); if (!current(ticket) || controller.signal.aborted) throw Object.assign(new Error("stale_preferences"), { stale: true }); return validatePreferencesView(value); }
    finally { controllers.delete(controller); }
  }
  async function getCatalogue(ticket) {
    if (catalogue) return;
    const controller = new AbortController(); controllers.add(controller);
    try {
      let value;
      if (loadCatalogue) value = await loadCatalogue(controller.signal);
      else {
        const response = await fetch("/preferences-catalogue.json", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("catalogue_unavailable"); const text = await response.text(); if (text.length > 200000) throw new Error("catalogue_unavailable"); value = JSON.parse(text);
      }
      if (!current(ticket) || controller.signal.aborted) return;
      const next = buildPreferencesIndex(value); catalogue = value; index = next;
    } finally { controllers.delete(controller); }
  }
  function report(error, ticket) {
    if (!current(ticket) || error?.stale || error?.name === "AbortError") return;
    if ([401, 403].includes(error.status)) { close(); try { Promise.resolve(onError?.(error)).catch(() => {}); } catch {} return; }
    if (error.code === "preferences_changed") { conflict = true; message("Les préférences ont changé sur un autre appareil. Ton brouillon est conservé.", true); }
    else if (error.code === "preferences_catalogue_changed") { conflict = true; catalogue = null; index = null; message("Le catalogue a changé. Recharge-le avant d’enregistrer ; tes choix en cours sont conservés.", true); }
    else message(error.status === 429 ? "Patiente un moment avant de réessayer." : "Les préférences sont indisponibles. Réessaie dans un moment.", true);
    retry.hidden = Boolean(saved); controls();
  }
  async function load(keepDraft = false) {
    if (destroyed || !isCurrent()) return;
    const draft = keepDraft ? new Set(selected) : null;
    close(); opened = true; section.hidden = false; busy = true; const ticket = ++epoch; message("Chargement des préférences…"); controls();
    try {
      await getCatalogue(ticket); if (!current(ticket)) return;
      const value = await ask({}, ticket); if (!current(ticket)) return;
      saved = value; selected = draft ?? new Set(value.selectedIds); conflict = false; retry.hidden = true; render();
      if ([...selected].some(id => !index.has(id))) message("Un choix d’un ancien catalogue est conservé. Retire-le explicitement pour modifier cette sélection.", true);
      else message(draft ? "Ton brouillon est conservé. Vérifie-le avant d’enregistrer." : "");
    } catch (error) { report(error, ticket); }
    finally { if (current(ticket)) { busy = false; controls(); } }
  }
  async function save() {
    if (!active() || busy || conflict || !saved || readOnly) return;
    busy = true; const ticket = epoch; message("Enregistrement des préférences…"); controls();
    try {
      const input = { expectedVersion: saved.version, catalogueVersion: PREFERENCES_CATALOGUE_VERSION, selectedIds: [...selected] };
      const result = await ask({ mutation: true, body: input }, ticket); if (!current(ticket)) return;
      saved = result; selected = new Set(result.selectedIds); conflict = false; render(); message("Préférences enregistrées.");
    } catch (error) { report(error, ticket); }
    finally { if (current(ticket)) { busy = false; controls(); } }
  }
  function close() { epoch++; opened = false; for (const controller of controllers) controller.abort(); controllers.clear(); saved = null; selected.clear(); conflict = false; busy = false; expanded.clear(); search.value = ""; clearChildren(summary); clearChildren(categories); message(""); section.hidden = true; }
  const changed = () => { if (active()) render(); }, hidden = () => { if (document.visibilityState === "hidden") close(); };
  search.addEventListener("input", () => { if (active() && !busy) render(); });
  const unbind = ui.onChange?.(changed); document.addEventListener("visibilitychange", hidden);
  return Object.freeze({ section, load, close, destroy() { if (destroyed) return; close(); destroyed = true; unbind?.(); document.removeEventListener("visibilitychange", hidden); ui.forget?.(section); section.remove(); } });
}
