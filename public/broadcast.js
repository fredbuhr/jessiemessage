import { createBroadcastState, clearBroadcast, broadcastTicket, currentBroadcast, acceptBroadcastSession, resetContacts, contactPageQuery, acceptContacts, selectRecipient, clearSelection, updateComposition, previewTicket, acceptPreview, canConfirmBroadcast, prepareCampaign, retryCampaign, rejectCampaign, parseCampaign, mergeCampaign, acceptCampaign, campaignNames, recipientNames, reasonNames } from "/broadcast-model.js";

const el = (id) => document.getElementById(id);
const state = createBroadcastState(); const controllers = new Set(); const campaigns = new Map(); const assets = new Map();
let expiryTimer = null; let pollTimer = null; let contactCursor = null; let contactMore = false; let contactsBusy = false;
let historyCursor = null; let historyMore = false; let historyBusy = false; let detailId = null; let detailEpoch = 0;
let photoCursor = null; let photoMore = false; let photosBusy = false; let photoEpoch = 0; let photoUrl = null;
let previewBusy = false; let sendBusy = false; let logoutBusy = false;
const visible = () => document.visibilityState === "visible";
const validId = (value) => typeof value === "string" && value.length === 32 && /^[0-9a-f]{32}$/.test(value);
const node = (tag, value, className) => { const element = document.createElement(tag); if (value !== undefined) element.textContent = value; if (className) element.className = className; return element; };
const stale = () => Object.assign(new Error("stale_response"), { stale: true });
function notice(text, error = false, target = "session-status") { const element = el(target); element.textContent = text; element.classList.toggle("is-error", error); }
function clearPhoto() { photoEpoch += 1; if (photoUrl) URL.revokeObjectURL(photoUrl); photoUrl = null; el("photo-preview").replaceChildren(); }
function clearDisplay() {
  el("broadcast-content").hidden = true; el("logout").hidden = true; el("reload").hidden = true;
  for (const id of ["contacts", "selected", "preview-list", "history", "campaign-detail"]) el(id).replaceChildren();
  for (const id of ["session-status", "contacts-status", "preview-status", "send-status", "history-status", "photo-status"]) notice("", false, id);
  el("campaign-form").reset(); el("filters").reset(); el("photo-select").replaceChildren(Object.assign(node("option", "Sans photo"), { value: "" }));
  for (const id of ["tag-filter", "group-filter"]) el(id).replaceChildren(Object.assign(node("option", id === "tag-filter" ? "Tous les tags" : "Tous les groupes"), { value: "" }));
  for (const id of ["more-contacts", "more-history", "more-photos", "uncertain", "repeat-choice", "photo-field", "campaign-detail"]) el(id).hidden = true;
  el("composition").disabled = false; el("acknowledge").checked = false; el("allow-repeat").checked = false; clearPhoto();
}
function clearPrivate(isVisible = false) {
  for (const controller of controllers) controller.abort(); controllers.clear(); clearTimeout(expiryTimer); clearTimeout(pollTimer); expiryTimer = null; pollTimer = null;
  clearBroadcast(state, { visible: isVisible }); detailEpoch += 1; detailId = null; campaigns.clear(); assets.clear();
  contactCursor = null; contactMore = false; contactsBusy = false; historyCursor = null; historyMore = false; historyBusy = false;
  photoCursor = null; photoMore = false; photosBusy = false; previewBusy = false; sendBusy = false; clearDisplay();
}
function signOut() { clearPrivate(); location.replace("/admin/login"); }
async function request(path, { ticket = broadcastTicket(state), body, timeout = 15000 } = {}) {
  const controller = new AbortController(); controllers.add(controller); const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": state.session?.csrf ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data; try { data = await response.json(); } catch { data = {}; }
    if (!currentBroadcast(state, ticket) || !visible()) throw stale();
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status, code: data.error }); return data;
  } catch (error) { if (!currentBroadcast(state, ticket) || !visible()) throw stale(); throw error; }
  finally { clearTimeout(timer); controllers.delete(controller); }
}
function errorText(error) {
  if (error.status === 429) return "Trop de demandes. Patiente un moment avant de réessayer.";
  if (error.code === "recipients_unavailable") return "Un destinataire n’est plus éligible. Vérifie de nouveau les destinataires et leur accord.";
  if (error.code === "repeat_confirmation_required") return "Cette photo a déjà été partagée. Vérifie l’avertissement avant de confirmer.";
  if (error.code === "media_unavailable") return "Cette photo n’est plus disponible. Choisis une autre photo.";
  if (error.status === 409) return "La demande ne peut pas être confirmée. Consulte l’historique avant de préparer une autre diffusion.";
  if (error.status === 403) return "Ta connexion doit être actualisée. Actualise la page, puis confirme de nouveau ta demande.";
  if (error.status === 404) return "Cet élément n’est plus accessible. Actualise la page.";
  if (error.status === 400 || error.status === 413) return "Vérifie le contenu et les destinataires de cette diffusion.";
  return "La connexion est interrompue. Réessaie dans un moment.";
}
function report(error, target) {
  if (error.stale) return;
  if (error.status === 401) { signOut(); return; }
  if (error.status === 403) { state.csrfFailed = true; el("reload").hidden = false; }
  notice(errorText(error), true, target); renderControls();
}
function armExpiry() { clearTimeout(expiryTimer); expiryTimer = setTimeout(signOut, Math.max(0, Math.min(2147483647, state.session.expiresAt - Date.now()))); }
async function verifySession(ticket) {
  const session = await request("/api/broadcast/admin/session", { ticket });
  if (!acceptBroadcastSession(state, ticket, session)) { await bootstrap("La session a changé. Consulte l’historique avant de préparer une nouvelle diffusion."); throw stale(); }
  armExpiry();
}
function renderControls() {
  const frozen = !!state.pending;
  el("composition").disabled = frozen || sendBusy || state.csrfFailed;
  el("preview").disabled = frozen || previewBusy || state.csrfFailed || state.selected.size === 0;
  el("preview").textContent = previewBusy ? "Vérification…" : "Vérifier les destinataires";
  el("confirm").disabled = sendBusy || !canConfirmBroadcast(state);
  el("confirm").textContent = state.selected.size ? `Confirmer pour ${state.selected.size} client${state.selected.size > 1 ? "s" : ""}` : "Confirmer la diffusion";
  el("acknowledge-label").textContent = `Je confirme le contenu et l’envoi individuel à ${state.selected.size} client${state.selected.size > 1 ? "s" : ""}.`;
  el("clear-selection").disabled = frozen || state.selected.size === 0;
  el("selected-count").textContent = state.selected.size ? `${state.selected.size} / 100 destinataire${state.selected.size > 1 ? "s" : ""} choisi${state.selected.size > 1 ? "s" : ""}` : "Aucun destinataire choisi";
  el("uncertain").hidden = state.pending?.status !== "uncertain";
  el("retry").disabled = sendBusy || state.csrfFailed;
  el("more-contacts").hidden = !contactMore; el("more-contacts").disabled = contactsBusy;
  el("more-history").hidden = !historyMore; el("more-history").disabled = historyBusy;
  el("more-photos").hidden = !photoMore; el("more-photos").disabled = photosBusy || frozen;
  el("refresh-history").disabled = historyBusy;
  for (const input of el("contacts").querySelectorAll("input")) input.disabled = frozen || state.csrfFailed;
  for (const button of el("selected").querySelectorAll("button")) button.disabled = frozen || state.csrfFailed;
}
function renderSelection() {
  const rows = [...state.selected.values()].map((recipient) => {
    const row = node("li"); const remove = node("button", "Retirer", "text-button"); remove.type = "button"; remove.setAttribute("aria-label", `Retirer ${recipient.pseudonym}`);
    remove.addEventListener("click", () => { if (selectRecipient(state, recipient.id, false)) compositionChanged(); }); row.append(node("span", recipient.pseudonym), remove); return row;
  });
  el("selected").replaceChildren(...rows); renderContacts(); renderControls();
}
function renderContacts() {
  const rows = [...state.contacts.values()].map((contact) => {
    const row = node("label", undefined, "contact-row"); const checkbox = node("input"); checkbox.type = "checkbox"; checkbox.checked = state.selected.has(contact.id); checkbox.disabled = !!state.pending || state.csrfFailed;
    const name = node("span", contact.nickname || contact.client.pseudonym); name.append(node("small", `${contact.nickname ? `${contact.client.pseudonym} · ` : ""}${contact.canSend ? "Accès actif · accord à vérifier" : "Accès ou conversation non disponible"}`));
    checkbox.addEventListener("change", () => { if (!selectRecipient(state, contact.id, checkbox.checked)) notice("Choisis au maximum 100 destinataires.", true, "contacts-status"); compositionChanged(); });
    row.append(checkbox, name); return row;
  }); el("contacts").replaceChildren(...rows);
}
function renderPreview() {
  el("preview-list").replaceChildren(); el("repeat-choice").hidden = !state.preview?.repeatCount;
  el("allow-repeat").checked = state.draft.allowRepeatMedia;
  if (!state.preview) { notice("", false, "preview-status"); return; }
  const rows = state.preview.recipients.map((recipient) => node("li", `${recipient.client.pseudonym} · ${recipient.eligible ? "Prêt à recevoir" : reasonNames[recipient.reason]}${recipient.repeatMedia ? " · photo déjà partagée" : ""}`));
  el("preview-list").replaceChildren(...rows);
  const all = state.preview.eligibleCount === state.selected.size;
  notice(`${state.preview.eligibleCount} / ${state.selected.size} destinataires éligibles.${state.preview.repeatCount ? ` Photo déjà partagée avec ${state.preview.repeatCount} client${state.preview.repeatCount > 1 ? "s" : ""}.` : ""}${all ? "" : " Retire les destinataires non éligibles avant de confirmer."}`, !all, "preview-status");
}
function compositionChanged() {
  el("acknowledge").checked = false; el("campaign-body").maxLength = state.draft.mediaId ? 1000 : 4096;
  el("body-help").textContent = state.draft.mediaId ? "Légende facultative · 1 000 caractères maximum." : "De 1 à 4 096 caractères.";
  renderSelection(); renderPreview();
}
function contactQuery(afterId = null) {
  const query = new URLSearchParams({ limit: "50" });
  for (const [key, element] of [["q", "search"], ["tagId", "tag-filter"], ["groupId", "group-filter"]]) if (el(element).value) query.set(key, el(element).value);
  if (el("access-filter").value !== "all") query.set("access", el("access-filter").value);
  if (el("reminder-filter").value !== "all") query.set("reminder", el("reminder-filter").value);
  if (el("unread-filter").checked) query.set("unread", "1"); if (afterId) query.set("afterId", afterId); return query;
}
async function loadContacts(more = false) {
  if (more && (contactsBusy || !contactMore)) return;
  const epoch = more ? state.filterEpoch : resetContacts(state, contactQuery().toString()); contactsBusy = true; renderContacts(); renderControls(); notice("Recherche…", false, "contacts-status");
  try {
    const page = await request(`/api/admin/crm/contacts?${contactPageQuery(state, more ? contactCursor : null)}`);
    if (!acceptContacts(state, page, { epoch })) return; contactCursor = page.nextCursor; contactMore = page.hasMore;
    renderContacts(); notice(state.contacts.size ? "" : "Aucun client ne correspond à ces filtres.", false, "contacts-status");
  } catch (error) { if (epoch === state.filterEpoch) report(error, "contacts-status"); }
  finally { if (epoch === state.filterEpoch) { contactsBusy = false; renderControls(); } }
}
async function loadLabels() {
  const labels = []; let cursor = null;
  for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
    const page = await request(`/api/admin/crm/labels?limit=100${cursor ? `&afterId=${cursor}` : ""}`);
    if (!Array.isArray(page.labels) || typeof page.hasMore !== "boolean" || page.hasMore && !validId(page.nextCursor)) throw new TypeError("invalid_labels");
    for (const label of page.labels) { if (!validId(label?.id) || !["tag", "group"].includes(label.kind) || typeof label.name !== "string" || label.name.length > 64) throw new TypeError("invalid_labels"); labels.push({ id: label.id, name: label.name, kind: label.kind }); }
    if (!page.hasMore) { cursor = null; break; } if (cursor !== null && page.nextCursor <= cursor) throw new TypeError("invalid_labels"); cursor = page.nextCursor;
  }
  if (cursor) throw new TypeError("too_many_labels");
  for (const [element, kind] of [["tag-filter", "tag"], ["group-filter", "group"]]) for (const label of labels.filter((value) => value.kind === kind).sort((a, b) => a.name.localeCompare(b.name, "fr"))) { const option = node("option", label.name); option.value = label.id; el(element).append(option); }
}
async function preview() {
  if (!state.selected.size || previewBusy || state.pending || state.csrfFailed) return;
  previewBusy = true; const ticket = previewTicket(state); notice("Vérification des accès, des accords et de la photo…", false, "preview-status"); renderControls();
  try {
    const data = await request("/api/broadcast/admin/preview", { ticket, body: { conversationIds: ticket.ids, mediaId: ticket.mediaId } });
    if (acceptPreview(state, ticket, data)) { el("acknowledge").checked = false; renderPreview(); }
  } catch (error) { report(error, "preview-status"); }
  finally { if (currentBroadcast(state, ticket)) { previewBusy = false; renderControls(); } }
}
async function loadPhotos(more = false) {
  if (!state.session?.mediaEnabled || photosBusy || state.pending || more && !photoMore) return;
  const ticket = broadcastTicket(state); photosBusy = true; renderControls(); notice("Chargement de tes photos…", false, "photo-status");
  try {
    const page = await request(`/api/media/admin/assets?limit=20${more && photoCursor ? `&afterId=${photoCursor}` : ""}`, { ticket });
    if (!Array.isArray(page.assets) || page.assets.length > 20 || typeof page.hasMore !== "boolean" || page.nextCursor !== null && !validId(page.nextCursor)) throw new TypeError("invalid_assets");
    for (const asset of page.assets) {
      if (!validId(asset?.id) || !Number.isSafeInteger(asset.createdAt) || asset.thumbnailUrl !== `/api/media/admin/assets/${asset.id}/thumb` || !Number.isInteger(asset.width) || !Number.isInteger(asset.height)) throw new TypeError("invalid_asset");
      if (!assets.has(asset.id)) { const option = node("option", `${new Date(asset.createdAt).toLocaleString("fr-FR")} · ${asset.width} × ${asset.height}`); option.value = asset.id; el("photo-select").append(option); }
      assets.set(asset.id, { id: asset.id, thumbnailUrl: asset.thumbnailUrl });
    }
    photoCursor = page.nextCursor; photoMore = page.hasMore; el("photo-field").hidden = false; notice(assets.size ? "Choisis une photo pour l’afficher avant de confirmer." : "Aucune photo dans ta bibliothèque. Ajoute d’abord une photo depuis Messages.", false, "photo-status");
  } catch (error) { report(error, "photo-status"); }
  finally { if (currentBroadcast(state, ticket)) { photosBusy = false; renderControls(); } }
}
async function showPhoto() {
  clearPhoto(); const asset = assets.get(state.draft.mediaId); if (!asset) return;
  const ticket = broadcastTicket(state); const epoch = photoEpoch; const controller = new AbortController(); controllers.add(controller); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(asset.thumbnailUrl, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
    if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/jpeg") throw Object.assign(new Error("photo_unavailable"), { status: response.status });
    const blob = await response.blob(); if (!blob.size || blob.size > 5242880) throw new Error("photo_unavailable");
    if (!currentBroadcast(state, ticket) || !visible() || epoch !== photoEpoch || asset.id !== state.draft.mediaId) return;
    photoUrl = URL.createObjectURL(blob); const image = node("img"); image.alt = "Photo choisie pour cette diffusion"; image.src = photoUrl; el("photo-preview").replaceChildren(image); notice("", false, "photo-status");
  } catch (error) { if (currentBroadcast(state, ticket) && epoch === photoEpoch) report(error, "photo-status"); }
  finally { clearTimeout(timer); controllers.delete(controller); }
}
function newId() { return [...crypto.getRandomValues(new Uint8Array(16))].map((value) => value.toString(16).padStart(2, "0")).join(""); }
async function send(retry = false) {
  if (sendBusy) return;
  const payload = retry ? retryCampaign(state) : prepareCampaign(state, newId()); if (!payload) return;
  const ticket = broadcastTicket(state); sendBusy = true; renderControls(); notice("Confirmation de cette diffusion…", false, "send-status");
  try {
    await verifySession(ticket);
    const result = await request("/api/broadcast/admin/campaigns", { ticket, body: payload });
    await verifySession(ticket);
    const campaign = acceptCampaign(state, ticket, result); if (!campaign) return;
    campaigns.set(campaign.id, campaign); el("campaign-form").reset(); el("photo-select").value = ""; clearPhoto(); compositionChanged();
    notice(`Diffusion enregistrée pour ${campaign.counts.total} client${campaign.counts.total > 1 ? "s" : ""}. Suis les remises et les éventuels destinataires ignorés dans l’historique.`, false, "send-status");
    renderHistory(); await showCampaign(campaign.id); void loadHistory();
  } catch (error) {
    const definitiveRejected = [400, 413].includes(error.status) || error.status === 409 && ["recipients_unavailable", "media_unavailable", "repeat_confirmation_required", "limit_reached"].includes(error.code);
    if (rejectCampaign(state, ticket, { csrfFailed: error.status === 403, definitiveRejected })) { compositionChanged(); report(error, "send-status"); }
  }
  finally { if (currentBroadcast(state, ticket)) { sendBusy = false; renderControls(); } }
}
const countSummary = (campaign) => `${campaign.counts.delivered} remis · ${campaign.counts.pending + campaign.counts.sending} en attente · ${campaign.counts.skipped} ignorés · ${campaign.counts.cancelled} annulés · ${campaign.counts.failed} en échec`;
function renderHistory() {
  const rows = [...campaigns.values()].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).map((campaign) => {
    const button = node("button", undefined, "history-row"); button.type = "button"; button.setAttribute("aria-pressed", String(detailId === campaign.id));
    button.append(node("strong", campaign.title), node("span", `${campaignNames[campaign.status]} · ${new Date(campaign.createdAt).toLocaleString("fr-FR")}`), node("span", countSummary(campaign)));
    button.addEventListener("click", () => { void showCampaign(campaign.id); }); return button;
  }); el("history").replaceChildren(...rows);
}
function parseHistoryPage(page, afterId) {
  if (!Array.isArray(page?.campaigns) || page.campaigns.length > 20 || typeof page.hasMore !== "boolean" || page.nextCursor !== null && !validId(page.nextCursor)) throw new TypeError("invalid_history");
  let previous = afterId; const parsed = page.campaigns.map((value) => { const campaign = parseCampaign(value); if (previous !== null && campaign.id <= previous) throw new TypeError("invalid_history"); previous = campaign.id; return campaign; });
  if (page.hasMore && (!parsed.length || previous !== page.nextCursor)) throw new TypeError("invalid_history"); return parsed;
}
async function loadHistory(more = false) {
  if (historyBusy || more && !historyMore) return;
  const ticket = broadcastTicket(state); historyBusy = true; renderControls(); const afterId = more ? historyCursor : null;
  try {
    const page = await request(`/api/broadcast/admin/campaigns?limit=20${afterId ? `&afterId=${afterId}` : ""}`, { ticket });
    for (const campaign of parseHistoryPage(page, afterId)) campaigns.set(campaign.id, mergeCampaign(campaigns.get(campaign.id), campaign));
    if (more || !historyCursor || !historyMore) { historyCursor = page.nextCursor; historyMore = page.hasMore; }
    renderHistory(); notice(campaigns.size ? "" : "Aucune diffusion pour le moment.", false, "history-status");
  } catch (error) { report(error, "history-status"); }
  finally { if (currentBroadcast(state, ticket)) { historyBusy = false; renderControls(); } }
}
function renderDetail(campaign) {
  const section = el("campaign-detail"); section.hidden = false; section.replaceChildren(node("h3", campaign.title), node("p", `${campaignNames[campaign.status]} · ${countSummary(campaign)}`, "small-copy"), node("p", campaign.body || "Photo sans légende", "campaign-body"));
  if (campaign.mediaId) section.append(node("p", "Une photo jointe", "small-copy"));
  if (["queued", "running"].includes(campaign.status) && campaign.counts.pending + campaign.counts.sending > 0) {
    const cancel = node("button", `Annuler les ${campaign.counts.pending + campaign.counts.sending} envois en attente`, "button secondary"); cancel.type = "button";
    cancel.addEventListener("click", () => { void cancelCampaign(campaign.id); }); section.append(cancel);
  }
  if (campaign.status === "paused") section.append(node("p", "L’autorisation de cette diffusion n’est plus valable. Les envois restants ont été interrompus. Prépare une nouvelle diffusion si tu souhaites les confirmer de nouveau.", "small-copy"));
  const list = node("ul", undefined, "recipient-list");
  for (const recipient of campaign.recipients) list.append(node("li", `${recipient.client.pseudonym} · ${recipientNames[recipient.state]}${recipient.reason ? ` · ${reasonNames[recipient.reason]}` : ""}`)); section.append(list);
}
async function showCampaign(id, refresh = false) {
  if (!validId(id)) return; if (!refresh) { detailId = id; detailEpoch += 1; el("campaign-detail").replaceChildren(node("p", "Chargement…", "status")); el("campaign-detail").hidden = false; renderHistory(); }
  const epoch = detailEpoch;
  try {
    const result = parseCampaign(await request(`/api/broadcast/admin/campaigns/${id}`), { detail: true });
    if (detailId !== id || detailEpoch !== epoch) return;
    const current = mergeCampaign(campaigns.get(id), result); campaigns.set(id, current);
    if (current.recipients) renderDetail(current); else { el("campaign-detail").replaceChildren(node("p", "Les envois ont évolué. Actualise l’historique pour afficher le détail à jour.", "small-copy")); }
    renderHistory();
  } catch (error) { if (detailId === id && detailEpoch === epoch) report(error, "history-status"); }
}
async function cancelCampaign(id) {
  if (state.csrfFailed || detailId !== id) return; const ticket = broadcastTicket(state); const epoch = detailEpoch;
  for (const button of el("campaign-detail").querySelectorAll("button")) button.disabled = true;
  try {
    await verifySession(ticket); const campaign = parseCampaign(await request(`/api/broadcast/admin/campaigns/${id}/cancel`, { ticket, body: {} })); campaigns.set(id, mergeCampaign(campaigns.get(id), campaign)); renderHistory();
    if (detailId === id && epoch === detailEpoch) { detailEpoch += 1; await showCampaign(id, true); } notice("Les envois encore en attente ont été annulés. Les messages déjà remis restent dans les conversations.", false, "history-status");
  } catch (error) { report(error, "history-status"); if (detailId === id && epoch === detailEpoch && !error.stale) void showCampaign(id, true); }
}
function scheduleHistory() {
  clearTimeout(pollTimer); if (!state.session || !visible()) return;
  pollTimer = setTimeout(async () => { try { await loadHistory(); if (detailId) await showCampaign(detailId, true); } finally { if (state.visible && visible()) scheduleHistory(); } }, 10000);
}
async function bootstrap(message = "") {
  if (!visible()) return; clearPrivate(true); const ticket = broadcastTicket(state); notice("Vérification de la connexion…");
  try {
    const session = await request("/api/broadcast/admin/session", { ticket });
    if (!acceptBroadcastSession(state, ticket, session)) { signOut(); return; } armExpiry();
    el("broadcast-content").hidden = false; el("logout").hidden = false; el("reload").hidden = false; el("photo-options").hidden = !state.session.mediaEnabled;
    notice(message); renderControls();
    await Promise.all([loadContacts(), loadHistory(), loadLabels().catch((error) => report(error, "contacts-status"))]);
    if (currentBroadcast(state, ticket)) scheduleHistory();
  } catch (error) {
    if (error.stale) return; if (error.status === 401) { signOut(); return; }
    clearDisplay(); notice(error.status === 404 ? "Les diffusions ne sont pas activées pour le moment." : "Les diffusions sont momentanément indisponibles. Actualise la page pour réessayer.", true); el("reload").hidden = false;
  }
}
async function logout() {
  if (logoutBusy || !state.session || !visible()) return; logoutBusy = true; const csrf = state.session.csrf; clearPrivate(); const epoch = state.epoch;
  notice("Déconnexion en cours…"); const controller = new AbortController(); controllers.add(controller); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" });
    if (epoch !== state.epoch || !visible()) return; if (response.ok || response.status === 401) signOut(); else await bootstrap("La déconnexion n’a pas été confirmée. Réessaie de te déconnecter.");
  } catch { if (epoch === state.epoch && visible()) await bootstrap("La déconnexion n’a pas été confirmée. Réessaie de te déconnecter."); }
  finally { clearTimeout(timer); controllers.delete(controller); logoutBusy = false; }
}
el("filters").addEventListener("submit", (event) => { event.preventDefault(); void loadContacts(); });
el("more-contacts").addEventListener("click", () => { void loadContacts(true); });
el("clear-selection").addEventListener("click", () => { if (clearSelection(state)) compositionChanged(); });
for (const [element, key] of [["campaign-title", "title"], ["campaign-body", "body"]]) el(element).addEventListener("input", () => { updateComposition(state, { [key]: el(element).value }); el("acknowledge").checked = false; renderControls(); });
el("photo-select").addEventListener("change", () => { updateComposition(state, { mediaId: el("photo-select").value || null }); el("campaign-body").maxLength = state.draft.mediaId ? 1000 : 4096; el("body-help").textContent = state.draft.mediaId ? "Légende facultative · 1 000 caractères maximum." : "De 1 à 4 096 caractères."; compositionChanged(); void showPhoto(); });
el("allow-repeat").addEventListener("change", () => { updateComposition(state, { allowRepeatMedia: el("allow-repeat").checked }); el("acknowledge").checked = false; renderControls(); });
el("acknowledge").addEventListener("change", () => { state.acknowledged = el("acknowledge").checked; renderControls(); });
el("load-photos").addEventListener("click", () => { void loadPhotos(); }); el("more-photos").addEventListener("click", () => { void loadPhotos(true); });
el("preview").addEventListener("click", () => { void preview(); }); el("campaign-form").addEventListener("submit", (event) => { event.preventDefault(); void send(); });
el("retry").addEventListener("click", () => { void send(true); }); el("refresh-history").addEventListener("click", () => { void loadHistory(); if (detailId) void showCampaign(detailId, true); });
el("more-history").addEventListener("click", () => { void loadHistory(true); }); el("reload").addEventListener("click", () => { void bootstrap(); }); el("logout").addEventListener("click", () => { void logout(); });
document.addEventListener("visibilitychange", () => { if (visible()) void bootstrap(); else clearPrivate(); }); window.addEventListener("pagehide", () => clearPrivate()); window.addEventListener("pageshow", (event) => { if (event.persisted && visible()) void bootstrap(); });
if (visible()) void bootstrap(); else clearPrivate();
