import { createCrmState, setFilters, contactQuery, applyContactPage, updateContact, contactName, selectProfile, currentDetail, detailTicket, invalidateDetail, receiveProfile, changeDraft, saveBody, discardDraft, labelsOfKind, localDateTime, reminderTimestamp, clearCrmState } from "/crm-model.js";

const ui = globalThis.JessieI18n ?? {
  t(source, params = {}) { return source.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, key) => Object.hasOwn(params, key) ? String(params[key]) : whole); },
  text(element, source, params = {}) { element.textContent = this.t(source, params); },
  attr(element, name, source, params = {}) { element.setAttribute(name, this.t(source, params)); },
  rawText(element, value) { element.textContent = value; }, forget() {},
  dateParam(value, options = {}) { return new Date(value).toLocaleString("fr-FR", options); },
  numberParam(value, options = {}) { return value.toLocaleString("fr-FR", options); },
  messageParam(source, params = {}) { return this.t(source, params); }
};
const replace = (element, ...children) => { ui.forget(element); element.replaceChildren(...children); };

const BASE = "/api/admin/crm";
const accessNames = { active: "Actif", pending: "En attente", expired: "Expiré", revoked: "Révoqué", suspended: "Suspendu", deleted: "Supprimé" };
function node(tag, text = null, className = null) { const element = document.createElement(tag); if (text !== null) ui.text(element, text); if (className) element.className = className; return element; }
function rawNode(tag, value, className = null) { const element = node(tag, null, className); ui.rawText(element, value); return element; }
function textNode(tag, source, params = {}, className = null) { const element = node(tag, null, className); ui.text(element, source, params); return element; }
function button(text, action, className = "button secondary") { const element = node("button", text, className); element.type = "button"; element.addEventListener("click", action); return element; }
function field(label, input, params = {}) { const wrapper = node("label", null, "crm-field"); wrapper.append(textNode("span", label, params), input); return wrapper; }
function input(type, name, maximum = null) { const element = node("input"); element.type = type; element.name = name; if (maximum) element.maxLength = maximum; return element; }
function select(options) { const element = node("select"); for (const [value, name] of options) { const option = node("option", name); option.value = value; element.append(option); } return element; }
function dateName(value) { return value === null ? ui.messageParam("Aucun") : ui.dateParam(value, { dateStyle: "medium", timeStyle: "short" }); }
function status(node, text, error = false) { ui.text(node, text); node.classList.toggle("is-error", error); }

export function createCrmUI(adapter) {
  const state = createCrmState(); const owned = []; const renameDrafts = new Map(); const labelConflicts = new Set();
  let life = 0; let loading = false; let pageRequest = 0; let refreshAfter = null; let refreshTarget = null;
  let debounce = null; let detailBusy = false; let detailRequest = 0; let profileOpen = false; let managerBusy = false;
  let profileReturnFocus = null; let labelsReturnFocus = null; let suspended = false; let deletedCandidate = null;
  let labelsRequest = 0; let managerOpening = 0; let cleared = false;
  let inboxAbort = null;
  let exportAbort = null, exportBusy = false, exportEpoch = 0;
  const exportUrls = new Set();
  const filters = node("form", null, "crm-filters"); ui.attr(filters, "aria-label", "Filtrer les clients");
  const search = input("search", "q", 80); ui.attr(search, "placeholder", "Pseudo, surnom ou e-mail");
  const tagFilter = select([["", "Tous les tags"]]); const groupFilter = select([["", "Tous les groupes"]]);
  const accessFilter = select([["all", "Tous les accès"], ...Object.entries(accessNames)]);
  const reminderFilter = select([["all", "Tous les rappels"], ["due", "Rappels à traiter"], ["upcoming", "À venir"], ["none", "Sans rappel"]]);
  const unreadFilter = input("checkbox", "unread"); const unreadLabel = node("label", null, "crm-check"); unreadLabel.append(unreadFilter, node("span", "Non lus"));
  const replyFilter = input("checkbox", "reply"); const replyLabel = node("label", null, "crm-check"); replyLabel.hidden = adapter.repliesEnabled !== true; replyLabel.append(replyFilter, node("span", "À répondre"));
  const filterGrid = node("div", null, "crm-filter-grid"); filterGrid.append(field("Tag", tagFilter), field("Groupe", groupFilter), field("Accès", accessFilter), field("Rappel privé", reminderFilter));
  const filterActions = node("div", null, "crm-filter-actions"); const managerButton = button("Tags et groupes", () => { void openManager(managerButton); }, "text-button");
  const resetButton = button("Effacer les filtres", () => { search.value = ""; tagFilter.value = ""; groupFilter.value = ""; accessFilter.value = "all"; reminderFilter.value = "all"; unreadFilter.checked = false; replyFilter.checked = false; void applyFilters(); }, "text-button");
  filterActions.append(unreadLabel, replyLabel, resetButton, managerButton); filters.append(field("Rechercher un client", search), filterGrid, filterActions);
  const filterStatus = node("p", null, "crm-filter-status"); filterStatus.setAttribute("role", "status"); filterStatus.setAttribute("aria-live", "polite"); filters.append(filterStatus);
  const selectionStatus = node("p", null, "crm-selection-status"); selectionStatus.hidden = true; selectionStatus.setAttribute("role", "status");
  adapter.inboxHead.after(filters, selectionStatus); owned.push(filters, selectionStatus);
  const ficheButton = button("Fiche", () => { void openProfile(ficheButton); }, "button secondary crm-fiche-button"); ficheButton.hidden = true; adapter.chatHead.append(ficheButton); owned.push(ficheButton);

  const profileDialog = node("dialog", null, "crm-dialog"); profileDialog.setAttribute("aria-labelledby", "crm-profile-title");
  const profileTitle = node("h2", "Fiche client"); profileTitle.id = "crm-profile-title";
  const profileHeader = node("div", null, "dialog-head"); profileHeader.append(profileTitle, button("Fermer", () => closeProfile(), "text-button"));
  const profileHelp = node("p", "Ces informations restent dans ton espace privé.", "crm-help");
  const clientInfo = node("div", null, "crm-client-info"); const profileStatus = node("p", null, "crm-status"); profileStatus.setAttribute("role", "status"); profileStatus.setAttribute("aria-live", "polite");
  const profileForm = node("form", null, "crm-profile-form"); const profileFields = node("fieldset"); profileFields.hidden = true;
  const nickname = input("text", "nickname", 64); const notes = node("textarea"); notes.name = "notes"; notes.maxLength = 8000; notes.rows = 7;
  const reminder = input("datetime-local", "reminder"); reminder.min = "1970-01-01T00:00"; reminder.max = "9999-12-31T23:59";
  const reminderHelp = node("small", "Date de suivi privée, sans notification automatique.", "crm-help"); const notesCount = node("small", "0 / 8 000", "crm-note-count");
  const memberships = node("div", null, "crm-memberships"); const saveButton = node("button", "Enregistrer la fiche", "button primary"); saveButton.type = "submit";
  profileFields.append(field("Surnom privé", nickname), field("Notes privées", notes), notesCount, field("Rappel privé · heure locale", reminder), reminderHelp, memberships, saveButton); profileForm.append(profileFields);
  const conflict = node("section", null, "crm-conflict"); conflict.hidden = true; ui.attr(conflict, "aria-label", "Modification à comparer");
  profileDialog.append(profileHeader, profileHelp, clientInfo, profileStatus, profileForm, conflict); document.body.append(profileDialog); owned.push(profileDialog);
  const tasksLink = adapter.tasksEnabled === true ? node("a", "Tâches du client", "text-button") : null;
  if (tasksLink) { tasksLink.hidden = true; profileDialog.append(tasksLink); }
  const preferencesSection = node("details", null, "crm-client-preferences"); preferencesSection.hidden = adapter.preferencesEnabled !== true;
  preferencesSection.append(node("summary", "Goûts & fantasmes"));
  const preferencesHost = node("div"); preferencesSection.append(preferencesHost); profileDialog.append(preferencesSection);
  let preferencesUI = null, preferencesEpoch = 0;
  function closePreferences() { preferencesEpoch++; preferencesUI?.destroy(); preferencesUI = null; preferencesSection.open = false; replace(preferencesHost); }
  async function openPreferences() {
    if (preferencesUI || !preferencesSection.open || adapter.preferencesEnabled !== true || !profileOpen || !state.selected) return;
    const ticket = ++preferencesEpoch, owner = life, conversationId = state.selected;
    const current = () => ticket === preferencesEpoch && currentLife(owner) && profileOpen && state.selected === conversationId && preferencesSection.open;
    try {
      const { createPreferencesUI } = await import("/preferences.js");
      if (!current()) return;
      preferencesUI = createPreferencesUI({ role: "admin", host: preferencesHost, conversationId, readOnly: true, isCurrent: current,
        request: async (path, options) => { if (!current()) throw stale(); const result = await adapter.request(path, { ...options, account: true }); if (!current()) throw stale(); return result; },
        onError: async error => { if (current()) await report(error, profileStatus); } });
      await preferencesUI.load();
    } catch (error) { if (current()) await report(error, profileStatus); }
  }
  preferencesSection.addEventListener("toggle", () => { if (preferencesSection.open) void openPreferences(); else closePreferences(); });
  const exportSection = node("details", null, "crm-export"); exportSection.hidden = adapter.conversationExport?.enabled !== true;
  exportSection.append(node("summary", "Télécharger la conversation"));
  const exportVideoEnabled = adapter.conversationExport?.videos === true;
  const exportHelp = node("p", exportVideoEnabled ? "Messages, photos et vidéos partagés, sans notes privées, tags ni pièces jointes non envoyées." : "Messages et photos partagées, sans notes privées, tags ni photos non envoyées.", "crm-help");
  const exportPhotos = input("checkbox", "exportPhotos"); exportPhotos.checked = adapter.conversationExport?.photos === true;
  const exportPhotosLabel = node("label", null, "crm-check"); exportPhotosLabel.hidden = adapter.conversationExport?.photos !== true;
  exportPhotosLabel.append(exportPhotos, node("span", "Inclure les photos partagées"));
  const exportVideos = input("checkbox", "exportVideos"); exportVideos.checked = exportVideoEnabled;
  const exportVideosLabel = node("label", null, "crm-check"); exportVideosLabel.hidden = !exportVideoEnabled;
  exportVideosLabel.append(exportVideos, node("span", "Inclure les vidéos partagées"));
  const exportButton = button("Télécharger le ZIP", () => { void downloadConversation(); }, "button secondary");
  const exportStatus = node("p", null, "crm-status"); exportStatus.setAttribute("role", "status"); exportStatus.setAttribute("aria-live", "polite");
  exportSection.append(exportHelp, exportPhotosLabel, exportVideosLabel, exportButton, exportStatus, node("p", "Le fichier se lit sans connexion. Conserve-le dans un endroit privé.", "crm-help")); profileDialog.append(exportSection);

  const manager = node("dialog", null, "crm-dialog crm-label-dialog"); manager.setAttribute("aria-labelledby", "crm-label-title");
  const managerTitle = node("h2", "Tags et groupes"); managerTitle.id = "crm-label-title";
  const managerHeader = node("div", null, "dialog-head"); managerHeader.append(managerTitle, button("Fermer", () => closeManager(), "text-button"));
  const managerStatus = node("p", null, "crm-status"); managerStatus.setAttribute("role", "status"); managerStatus.setAttribute("aria-live", "polite");
  const createForm = node("form", null, "crm-create-label"); const createKind = select([["tag", "Tag"], ["group", "Groupe"]]); const createName = input("text", "name", 64); createName.required = true;
  const createButton = node("button", "Créer", "button primary"); createButton.type = "submit"; createForm.append(field("Type", createKind), field("Nom", createName), createButton);
  const labelList = node("div", null, "crm-label-list"); manager.append(managerHeader, node("p", "Organise tes clients avec des tags et des groupes privés.", "crm-help"), managerStatus, createForm, labelList); document.body.append(manager); owned.push(manager);

  const currentLife = ticket => !cleared && !suspended && ticket === life;
  const stale = () => Object.assign(new Error("stale_crm"), { stale: true });
  async function ask(path, options = {}) {
    const ticket = life;
    if (!currentLife(ticket)) throw stale();
    try {
      const result = await adapter.request(`${BASE}${path}`, { ...options, account: true });
      if (!currentLife(ticket)) throw stale();
      return result;
    } catch (error) {
      // A failed old request has the same lifecycle as a successful one. It
      // must not sign out a resumed session or replace its current feedback.
      if (!currentLife(ticket)) throw stale();
      throw error;
    }
  }
  function publish() {
    adapter.onContacts([...state.contacts.values()], { cursor: state.cursor, hasMore: state.hasMore, loading });
    selectionStatus.hidden = !state.selected || state.contacts.has(state.selected);
    ui.text(selectionStatus, selectionStatus.hidden ? "" : "La conversation ouverte est hors des résultats actuels.");
  }
  async function report(error, target) {
    if (cleared || suspended || error.stale || error.name === "AbortError") return;
    if (error.status === 401 || error.status === 403) { await adapter.onError(error); return; }
    let text = "La demande n’a pas abouti. Tes modifications restent ici ; réessaie dans un moment.";
    if (error.status === 429) text = "Trop de demandes. Patiente un moment avant de réessayer.";
    if (error.status === 400 || error.status === 413) text = "Vérifie les champs : nom de 64 caractères et notes de 8 000 caractères maximum.";
    if (error.status === 404) text = "Cette fiche ou cette étiquette n’est plus accessible. Actualise avant de réessayer.";
    if (error.status === 409 && error.code === "name_in_use") text = "Ce nom est déjà utilisé pour ce type d’étiquette. Choisis un autre nom.";
    if (error.status === 409 && error.code === "limit_reached") text = "La limite a été atteinte. Retire des étiquettes avant de réessayer.";
    status(target, text, true);
  }
  function currentFilters() { return { q: search.value, tagId: tagFilter.value, groupId: groupFilter.value, access: accessFilter.value, unread: unreadFilter.checked, reply: adapter.repliesEnabled === true && replyFilter.checked, reminder: reminderFilter.value }; }
  async function applyFilters() {
    clearTimeout(debounce); if (!setFilters(state, currentFilters())) return;
    inboxAbort?.abort();
    pageRequest += 1; loading = false; refreshAfter = null; refreshTarget = null; publish();
    await loadInbox();
  }
  filters.addEventListener("submit", (event) => { event.preventDefault(); void applyFilters(); });
  search.addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(() => { void applyFilters(); }, 300); });
  for (const element of [tagFilter, groupFilter, accessFilter, reminderFilter, unreadFilter, replyFilter]) element.addEventListener("change", () => { void applyFilters(); });
  async function loadInbox(more = false, refresh = false) {
    if (suspended || loading || (more && (!state.hasMore || !state.cursor))) return;
    const requestId = ++pageRequest; const epoch = state.filterEpoch; loading = true; publish();
    const controller = new AbortController(); inboxAbort = controller;
    status(filterStatus, state.contacts.size ? "Actualisation…" : "Recherche…");
    try {
      if (refresh && refreshTarget === null) refreshTarget = [...state.contacts.keys()].sort().at(-1) ?? null;
      let afterId = more ? state.cursor : refresh ? refreshAfter : null;
      // Bounded refresh covers loaded intervals; a removed filtered client
      // cannot remain indefinitely just because pages are merged in memory.
      for (let pageIndex = 0; pageIndex < (refresh ? 3 : 1); pageIndex += 1) {
        const result = await ask(`/contacts?${contactQuery(state.filters, afterId)}`, { signal: controller.signal });
        if (requestId !== pageRequest || epoch !== state.filterEpoch) return;
        applyContactPage(state, result, { epoch, afterId });
        const continueRefresh = refresh && result.hasMore && refreshTarget && result.nextCursor < refreshTarget;
        if (continueRefresh) { afterId = result.nextCursor; refreshAfter = afterId; }
        else { refreshAfter = null; refreshTarget = null; state.cursor = result.nextCursor ?? [...state.contacts.keys()].sort().at(-1) ?? null; state.hasMore = result.hasMore; }
        if (!continueRefresh) break;
      }
      status(filterStatus, state.contacts.size ? "" : "Aucun client ne correspond à ces filtres.");
    } catch (error) {
      if (requestId === pageRequest && epoch === state.filterEpoch) {
        if (error.status === 404) {
          try { await loadLabels(); if (requestId === pageRequest && epoch === state.filterEpoch) status(filterStatus, "Une étiquette de filtre a été retirée. Choisis un autre filtre.", true); }
          catch (reloadError) { if (requestId === pageRequest && epoch === state.filterEpoch) await report(reloadError, filterStatus); }
        }
        else await report(error, filterStatus);
      }
    } finally { if (inboxAbort === controller) inboxAbort = null; if (requestId === pageRequest && epoch === state.filterEpoch) { loading = false; publish(); } }
  }
  function replaceFilterOptions(element, kind, empty) {
    const previous = element.value; replace(element);
    const first = node("option", empty); first.value = ""; element.append(first);
    for (const label of labelsOfKind(state.labels.values(), kind)) { const option = rawNode("option", label.name); option.value = label.id; element.append(option); }
    if (previous && !state.labels.has(previous)) { const missing = node("option", "Étiquette retirée"); missing.value = previous; element.append(missing); }
    element.value = previous;
  }
  async function loadLabels() {
    const requestId = ++labelsRequest; const ticket = life;
    const labels = new Map(); let cursor = null;
    do {
      const page = await ask(`/labels?limit=100${cursor ? `&afterId=${cursor}` : ""}`);
      if (requestId !== labelsRequest || !currentLife(ticket)) throw stale();
      for (const label of page.labels) labels.set(label.id, label);
      cursor = page.hasMore ? page.nextCursor : null;
    } while (cursor);
    if (requestId !== labelsRequest || !currentLife(ticket)) throw stale();
    state.labels = labels;
    replaceFilterOptions(tagFilter, "tag", "Tous les tags"); replaceFilterOptions(groupFilter, "group", "Tous les groupes");
    if (manager.open) renderLabels();
    const draft = state.drafts.get(state.selected); if (profileOpen && draft) renderMemberships(draft);
  }
  function renderMemberships(draft) {
    replace(memberships);
    for (const [kind, title] of [["tag", "Tags"], ["group", "Groupes"]]) {
      const group = node("fieldset", null, "crm-label-options"); group.append(node("legend", title));
      const available = labelsOfKind(state.labels.values(), kind);
      if (!available.length) group.append(node("p", "Aucun pour le moment.", "crm-help"));
      for (const label of available) {
        const checked = input("checkbox", "labelIds"); checked.value = label.id; checked.checked = draft.labelIds.includes(label.id);
        const wrapper = node("label", null, "crm-check"); wrapper.append(checked, rawNode("span", label.name)); group.append(wrapper);
        checked.addEventListener("change", syncDraft);
      }
      memberships.append(group);
    }
    const missing = draft.labelIds.filter((id) => !state.labels.has(id));
    for (const id of missing) {
      const checkbox = input("checkbox", "labelIds"); checkbox.value = id; checkbox.checked = true;
      const wrapper = node("label", null, "crm-check crm-missing-label"); wrapper.append(checkbox, node("span", "Étiquette retirée · décoche pour l’enlever")); memberships.append(wrapper); checkbox.addEventListener("change", syncDraft);
    }
    memberships.append(node("p", "32 tags et groupes maximum par fiche.", "crm-help"));
  }
  function syncDraft() {
    const draft = state.drafts.get(state.selected); if (!profileOpen || !draft || detailBusy) return;
    let timestamp; try { timestamp = reminder.value === localDateTime(draft.reminderAt) ? draft.reminderAt : reminderTimestamp(reminder.value); } catch { status(profileStatus, "Vérifie la date du rappel.", true); return; }
    changeDraft(draft, { nickname: nickname.value, notes: notes.value, reminderAt: timestamp, labelIds: [...memberships.querySelectorAll("input:checked")].map((checkbox) => checkbox.value) });
    ui.text(notesCount, "{count} / 8 000", { count: ui.numberParam(notes.value.length) });
    if (!draft.conflict) status(profileStatus, "Modifications non enregistrées.");
  }
  for (const element of [nickname, notes, reminder]) element.addEventListener("input", syncDraft);
  function renderConflict(draft) {
    replace(conflict); conflict.hidden = !draft.conflict;
    if (!draft.conflict) { saveButton.disabled = detailBusy; return; }
    saveButton.disabled = true;
    const latest = draft.conflict;
    conflict.append(node("h3", "La fiche a été modifiée ailleurs"), node("p", "Ton brouillon est conservé ci-dessus. Compare la version enregistrée avant de choisir."));
    const summary = textNode("p", "Surnom : {nickname} · Rappel : {reminder} · Étiquettes : {labels}", { nickname: latest.nickname || ui.messageParam("aucun"), reminder: dateName(latest.reminderAt), labels: latest.labels.length ? latest.labels.map((label) => label.name).join(", ") : ui.messageParam("aucune") }); conflict.append(summary);
    const savedNotes = node("textarea"); savedNotes.readOnly = true; savedNotes.rows = 5; savedNotes.value = latest.notes; conflict.append(field("Notes enregistrées", savedNotes));
    const actions = node("div", null, "crm-actions");
    actions.append(button("Recharger la fiche", () => { const current = state.drafts.get(state.selected); if (current?.conflict) { const next = discardDraft(state, state.selected, current.conflict); renderProfile(next); status(profileStatus, "Version enregistrée rechargée."); } }),
      button("Enregistrer ma version", () => { void saveProfile(true); }, "button primary")); conflict.append(actions);
  }
  function renderProfile(draft) {
    if (tasksLink) { tasksLink.href = `/admin/tasks?conversationId=${draft.profile.conversationId}`; tasksLink.hidden = false; }
    const profile = draft.profile; nickname.value = draft.nickname; notes.value = draft.notes; reminder.value = localDateTime(draft.reminderAt);
    ui.text(notesCount, "{count} / 8 000", { count: ui.numberParam(draft.notes.length) }); ui.text(profileTitle, "Fiche · {name}", { name: profile.client.pseudonym });
    replace(clientInfo, rawNode("p", profile.client.email), textNode("p", "{status}{expiry}", { status: ui.messageParam(accessNames[profile.access.state] ?? "En attente"), expiry: ui.messageParam(profile.access.expiresAt === null ? "" : " · jusqu’au {date}", { date: profile.access.expiresAt === null ? "" : dateName(profile.access.expiresAt) }) }));
    profileFields.hidden = false; profileFields.disabled = detailBusy; exportSection.hidden = adapter.conversationExport?.enabled !== true; renderMemberships(draft); renderConflict(draft);
    if (draft.dirty && !draft.conflict) status(profileStatus, "Modifications non enregistrées.");
  }
  async function loadProfile() {
    if (!profileOpen || detailBusy) return;
    const ticket = detailTicket(state); const requestId = ++detailRequest;
    try {
      const profile = await ask(`/conversations/${ticket.id}`);
      if (!profileOpen || requestId !== detailRequest || !currentDetail(state, ticket)) return;
      const draft = receiveProfile(state, profile, ticket); if (draft) { renderProfile(draft); if (!draft.dirty) status(profileStatus, ""); }
    } catch (error) {
      if (profileOpen && requestId === detailRequest && currentDetail(state, ticket)) {
        if (error.status === 404) forgetUnavailableProfile(ticket.id);
        else await report(error, profileStatus);
      }
    }
  }
  async function openProfile(opener) {
    if (!state.selected || suspended) return;
    invalidateDetail(state); const ticket = detailTicket(state);
    profileReturnFocus = opener; profileOpen = true; profileFields.hidden = true; exportSection.hidden = true; conflict.hidden = true; replace(clientInfo); ui.text(profileTitle, "Fiche client"); status(profileStatus, "Chargement…");
    profileDialog.showModal(); const existing = state.drafts.get(state.selected); if (existing) renderProfile(existing);
    try { await loadLabels(); if (profileOpen && currentDetail(state, ticket)) await loadProfile(); } catch (error) { if (profileOpen && currentDetail(state, ticket)) await report(error, profileStatus); }
  }
  function closeProfile(restore = true) {
    closePreferences();
    exportEpoch += 1; exportAbort?.abort(); exportAbort = null; exportBusy = false; exportButton.disabled = false; exportPhotos.disabled = false; exportVideos.disabled = false; exportSection.open = false; exportSection.hidden = true; status(exportStatus, "");
    for (const url of exportUrls) URL.revokeObjectURL(url); exportUrls.clear();
    if (tasksLink) { tasksLink.removeAttribute("href"); tasksLink.hidden = true; }
    profileOpen = false; invalidateDetail(state); detailRequest += 1; detailBusy = false; if (profileDialog.open) profileDialog.close();
    profileFields.hidden = true; profileFields.disabled = false; ui.text(profileTitle, "Fiche client"); nickname.value = ""; notes.value = ""; reminder.value = ""; replace(memberships); replace(clientInfo); replace(conflict); conflict.hidden = true; status(profileStatus, "");
    if (restore) {
      const target = typeof adapter.getReturnFocus === "function" ? adapter.getReturnFocus() : profileReturnFocus;
      if (target?.isConnected) target.focus();
    }
    profileReturnFocus = null;
  }
  profileDialog.addEventListener("close", () => { if (profileOpen) closeProfile(); });
  async function downloadConversation() {
    if (!profileOpen || !profileDialog.open || exportBusy || detailBusy || !state.selected || adapter.conversationExport?.enabled !== true) return;
    const ticket = detailTicket(state), epoch = ++exportEpoch, controller = new AbortController(); exportAbort = controller; exportBusy = true;
    exportButton.disabled = true; exportPhotos.disabled = true; exportVideos.disabled = true; status(exportStatus, "Préparation de la conversation…");
    try {
      const blob = await ask(`/conversations/${ticket.id}/export`, { mutation: true, archive: true,
        body: { includePhotos: exportPhotos.checked, ...(exportVideoEnabled ? { includeVideos: exportVideos.checked } : {}) }, signal: controller.signal });
      if (!profileOpen || !profileDialog.open || epoch !== exportEpoch || !currentDetail(state, ticket) || controller.signal.aborted) return;
      const url = URL.createObjectURL(blob); exportUrls.add(url); const link = document.createElement("a"); link.href = url; link.download = `JessieMessage-conversation-${ticket.id}.zip`;
      document.body.append(link); try { link.click(); } finally { link.remove(); }
      setTimeout(() => { URL.revokeObjectURL(url); exportUrls.delete(url); }, 5000);
      status(exportStatus, "Conversation téléchargée. Extrais le ZIP puis ouvre Conversation.html.");
    } catch (error) {
      if (!profileOpen || epoch !== exportEpoch || !currentDetail(state, ticket) || controller.signal.aborted || error.stale || error.name === "AbortError") return;
      if (error.status === 401 || error.status === 403) { await report(error, exportStatus); return; }
      const message = error.code === "conversation_export_limit"
        ? exportVideoEnabled ? "La conversation dépasse la limite de téléchargement. Essaie sans les photos ou les vidéos si elles sont incluses." : "La conversation dépasse la limite de téléchargement. Essaie sans les photos si elles sont incluses."
        : error.status === 429 ? "Une préparation est déjà en cours ou vient de se terminer. Patiente trente secondes puis réessaie."
        : "Le téléchargement n’est pas disponible. Réessaie ; aucun fichier incomplet n’est proposé.";
      status(exportStatus, message, true);
    } finally {
      if (epoch === exportEpoch) { exportBusy = false; exportAbort = null; exportButton.disabled = false; exportPhotos.disabled = false; exportVideos.disabled = false; }
    }
  }
  profileForm.addEventListener("submit", (event) => { event.preventDefault(); void saveProfile(); });
  async function saveProfile(overwrite = false) {
    const draft = state.drafts.get(state.selected); if (!profileOpen || !draft || detailBusy || (draft.conflict && !overwrite)) return;
    syncDraft(); if (!reminder.checkValidity() || draft.labelIds.length > 32) { status(profileStatus, "Vérifie le rappel et sélectionne 32 étiquettes maximum.", true); return; }
    const ticket = detailTicket(state); const body = saveBody(draft, { overwrite }); detailRequest += 1;
    detailBusy = true; profileFields.disabled = true; for (const control of conflict.querySelectorAll("button")) control.disabled = true; status(profileStatus, "Enregistrement…");
    try {
      const profile = await ask(`/conversations/${ticket.id}`, { mutation: true, body });
      if (!profileOpen || !currentDetail(state, ticket)) return;
      const saved = discardDraft(state, ticket.id, profile); renderProfile(saved); status(profileStatus, "Fiche enregistrée.");
      await loadLabels(); if (profileOpen && currentDetail(state, ticket)) await loadInbox(false, true);
    } catch (error) {
      if (!profileOpen || !currentDetail(state, ticket)) return;
      if (error.status === 409 && error.code === "record_changed") {
        status(profileStatus, "La fiche a changé. Ton brouillon est conservé.", true);
        try { const latest = await ask(`/conversations/${ticket.id}`); if (profileOpen && currentDetail(state, ticket)) { draft.conflict = latest; draft.profile = latest; renderConflict(draft); await loadLabels(); } } catch (latestError) { if (profileOpen && currentDetail(state, ticket)) { if (latestError.status === 404) forgetUnavailableProfile(ticket.id); else await report(latestError, profileStatus); } }
      } else {
        if (error.status === 404) {
          try {
            // A missing label should preserve a draft; a removed assignment
            // must also remove the previously opened private fiche.
            const latest = await ask(`/conversations/${ticket.id}`);
            if (profileOpen && currentDetail(state, ticket)) { receiveProfile(state, latest, ticket); renderProfile(draft); await loadLabels(); }
          } catch (checkError) {
            if (profileOpen && currentDetail(state, ticket) && checkError.status === 404) { forgetUnavailableProfile(ticket.id); return; }
            if (profileOpen && currentDetail(state, ticket)) await report(checkError, profileStatus);
          }
        }
        if (profileOpen && currentDetail(state, ticket)) await report(error, profileStatus);
      }
    } finally { if (profileOpen && currentDetail(state, ticket)) { detailBusy = false; profileFields.disabled = false; renderConflict(state.drafts.get(ticket.id)); } }
  }
  async function openManager(opener) {
    if (!currentLife(life)) return;
    const ticket = life, opening = ++managerOpening;
    labelsReturnFocus = opener; manager.showModal();
    if (managerBusy) return;
    status(managerStatus, "Chargement…");
    const current = () => currentLife(ticket) && opening === managerOpening && manager.open;
    try { await loadLabels(); if (current()) status(managerStatus, ""); }
    catch (error) { if (current()) await report(error, managerStatus); }
  }
  function closeManager(restore = true) { managerOpening += 1; if (manager.open) manager.close(); deletedCandidate = null; if (restore && labelsReturnFocus?.isConnected) labelsReturnFocus.focus(); labelsReturnFocus = null; }
  function renderLabels() {
    replace(labelList);
    for (const [kind, title] of [["tag", "Tags"], ["group", "Groupes"]]) {
      const section = node("section"); const labels = labelsOfKind(state.labels.values(), kind); section.append(textNode("h3", "{kind} · {count} / 100", { kind: ui.messageParam(title), count: ui.numberParam(labels.length) }));
      if (!labels.length) section.append(node("p", "Aucun pour le moment.", "crm-help"));
      for (const label of labels) {
        const row = node("div", null, "crm-label-row"); const name = input("text", "name", 64); name.value = renameDrafts.get(label.id) ?? label.name;
        ui.attr(name, "aria-label", "Renommer {name}", { name: label.name }); name.addEventListener("input", () => { renameDrafts.set(label.id, name.value); });
        row.append(field(label.memberCount > 1 ? "{count} clients" : "{count} client", name, { count: ui.numberParam(label.memberCount) }));
        const actions = node("div", null, "crm-actions");
        actions.append(button(labelConflicts.has(label.id) ? "Enregistrer mon nom" : "Renommer", () => { void mutateLabel("rename", label, { name: name.value, expectedVersion: label.version }); }),
          button("Supprimer", () => { deletedCandidate = label.id; renderLabels(); }, "text-button")); row.append(actions);
        if (labelConflicts.has(label.id)) {
          row.append(textNode("p", "Modifié ailleurs : nom enregistré « {name} ». Ton nom est conservé dans le champ.", { name: label.name }, "crm-help"), button("Reprendre le nom enregistré", () => { renameDrafts.delete(label.id); labelConflicts.delete(label.id); renderLabels(); }, "text-button"));
        }
        if (deletedCandidate === label.id) {
          const confirm = node("div", null, "crm-delete-confirm"); confirm.append(textNode("p", label.memberCount > 1 ? "Retirer « {name} » de {count} fiches et le supprimer ? Les notes seront conservées." : "Retirer « {name} » de {count} fiche et le supprimer ? Les notes seront conservées.", { name: label.name, count: ui.numberParam(label.memberCount) }),
            button("Confirmer la suppression", () => { void mutateLabel("delete", label, { expectedVersion: label.version }); }), button("Annuler", () => { deletedCandidate = null; renderLabels(); }, "text-button")); row.append(confirm);
        }
        section.append(row);
      }
      labelList.append(section);
    }
    for (const control of manager.querySelectorAll("input,select,button")) control.disabled = managerBusy;
  }
  async function mutateLabel(action, label, body) {
    if (managerBusy || !currentLife(life)) return;
    const ticket = life; managerBusy = true; renderLabels(); status(managerStatus, "Enregistrement…");
    try {
      await ask(`/labels/${label.id}/${action}`, { mutation: true, body });
      renameDrafts.delete(label.id); labelConflicts.delete(label.id); deletedCandidate = null;
      await loadLabels(); if (!currentLife(ticket)) return;
      await loadInbox(false, true); if (currentLife(ticket)) status(managerStatus, action === "delete" ? "Étiquette supprimée." : "Nom enregistré.");
    } catch (error) {
      if (!currentLife(ticket)) return;
      if (error.status === 409 && error.code === "record_changed") {
        labelConflicts.add(label.id); deletedCandidate = null;
        try { await loadLabels(); } catch (reloadError) { if (currentLife(ticket)) await report(reloadError, managerStatus); }
        if (currentLife(ticket)) status(managerStatus, "Cette étiquette a changé. Vérifie le nom enregistré avant de réessayer.", true);
      } else { if (error.status === 404) { try { await loadLabels(); } catch {} } if (currentLife(ticket)) await report(error, managerStatus); }
    } finally { if (currentLife(ticket)) { managerBusy = false; renderLabels(); } }
  }
  createForm.addEventListener("submit", (event) => {
    event.preventDefault(); if (managerBusy || !currentLife(life)) return;
    void (async () => {
      const ticket = life;
      managerBusy = true; renderLabels(); status(managerStatus, "Création…");
      try { const value = await ask("/labels", { mutation: true, body: { kind: createKind.value, name: createName.value } }); createName.value = ""; await loadLabels(); status(managerStatus, value.duplicate ? "Cette étiquette existe déjà." : "Étiquette créée."); }
      catch (error) { await report(error, managerStatus); }
      finally { if (currentLife(ticket)) { managerBusy = false; renderLabels(); } }
    })();
  });
  function clear() {
    if (cleared) return; cleared = true; suspended = true;
    life += 1; pageRequest += 1; inboxAbort?.abort(); inboxAbort = null; clearTimeout(debounce); loading = false; detailBusy = false; managerBusy = false; refreshAfter = null; refreshTarget = null;
    closeProfile(false); closeManager(false); clearCrmState(state); renameDrafts.clear(); labelConflicts.clear();
    createName.value = ""; search.value = ""; replace(tagFilter); replace(groupFilter); replace(labelList); status(managerStatus, ""); status(filterStatus, "");
    for (const element of owned) { ui.forget(element); element.remove(); }
  }
  function removeConversation(id) { state.contacts.delete(id); state.drafts.delete(id); if (state.selected === id) { closeProfile(false); selectProfile(state, null); ficheButton.hidden = true; } publish(); }
  function forgetUnavailableProfile(id) { removeConversation(id); adapter.onUnavailable?.(id); status(filterStatus, "Cette fiche n’est plus accessible.", true); }
  return {
    hasUnsavedWork() { return [...state.drafts.values()].some(draft => draft.dirty); },
    async initialize() { try { await loadLabels(); } catch (error) { await report(error, filterStatus); } },
    loadInbox,
    selectConversation(id) { closeProfile(false); selectProfile(state, id); ficheButton.hidden = !id; publish(); },
    removeConversation,
    updateConversation(conversation) {
      const previous = state.contacts.get(conversation.id); if (!updateContact(state, conversation)) return;
      publish();
      if (state.filters.unread && previous.unreadCount !== conversation.unreadCount || state.filters.reply) { clearTimeout(debounce); debounce = setTimeout(() => { void loadInbox(false, true); }, 500); }
    },
    displayName: contactName,
    clear,
    suspend() { if (cleared) return; suspended = true; life += 1; pageRequest += 1; inboxAbort?.abort(); inboxAbort = null; loading = false; detailRequest += 1; detailBusy = false; managerBusy = false; clearTimeout(debounce); closeProfile(false); closeManager(false); },
    async resume() { if (cleared) return; suspended = false; if (state.selected) ficheButton.hidden = false; await loadInbox(false, true); }
  };
}
