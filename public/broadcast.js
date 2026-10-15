import { createBroadcastState, clearBroadcast, broadcastTicket, currentBroadcast, acceptBroadcastSession, resetContacts, contactPageQuery, acceptContacts, selectRecipient, clearSelection, updateComposition, previewTicket, acceptPreview, canConfirmBroadcast, prepareCampaign, retryCampaign, rejectCampaign, parseCampaign, mergeCampaign, acceptCampaign, campaignNames, recipientNames, reasonNames } from "/broadcast-model.js";

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

const el = (id) => document.getElementById(id);
const state = createBroadcastState(); const controllers = new Set(); const campaigns = new Map(); const assets = new Map();
let expiryTimer = null; let pollTimer = null; let contactCursor = null; let contactMore = false; let contactsBusy = false;
let historyCursor = null; let historyMore = false; let historyStarted = false; let historyBusy = false; let historyRetryAt = 0; let detailId = null; let detailEpoch = 0;
let photoCursor = null; let photoMore = false; let photosBusy = false; let photoEpoch = 0; let photoUrl = null;
let previewBusy = false; let sendBusy = false; let logoutBusy = false;
const visible = () => document.visibilityState === "visible";
const validId = (value) => typeof value === "string" && value.length === 32 && /^[0-9a-f]{32}$/.test(value);
const node = (tag, value, className) => { const element = document.createElement(tag); if (value !== undefined) ui.text(element, value); if (className) element.className = className; return element; };
const rawNode = (tag, value, className) => { const element = node(tag, undefined, className); ui.rawText(element, value); return element; };
const textNode = (tag, source, params = {}, className) => { const element = node(tag, undefined, className); ui.text(element, source, params); return element; };
const stale = () => Object.assign(new Error("stale_response"), { stale: true });
function notice(text, error = false, target = "session-status", params = {}) { const element = el(target); ui.text(element, text, params); element.classList.toggle("is-error", error); }
function clearPhoto() { photoEpoch += 1; if (photoUrl) URL.revokeObjectURL(photoUrl); photoUrl = null; replace(el("photo-preview")); }
function clearDisplay() {
  el("broadcast-content").hidden = true; el("logout").hidden = true; el("reload").hidden = true;
  for (const id of ["contacts", "selected", "preview-list", "history", "campaign-detail"]) replace(el(id));
  for (const id of ["session-status", "contacts-status", "preview-status", "send-status", "history-status", "photo-status"]) notice("", false, id);
  el("campaign-form").reset(); el("filters").reset(); replace(el("photo-select"), Object.assign(node("option", "Sans photo"), { value: "" }));
  for (const id of ["tag-filter", "group-filter"]) replace(el(id), Object.assign(node("option", id === "tag-filter" ? "Tous les tags" : "Tous les groupes"), { value: "" }));
  for (const id of ["more-contacts", "more-history", "more-photos", "uncertain", "repeat-choice", "photo-field", "campaign-detail"]) el(id).hidden = true;
  el("composition").disabled = false; el("acknowledge").checked = false; el("allow-repeat").checked = false; clearPhoto();
}
function clearPrivate(isVisible = false) {
  for (const controller of controllers) controller.abort(); controllers.clear(); clearTimeout(expiryTimer); clearTimeout(pollTimer); expiryTimer = null; pollTimer = null;
  clearBroadcast(state, { visible: isVisible }); detailEpoch += 1; detailId = null; campaigns.clear(); assets.clear();
  contactCursor = null; contactMore = false; contactsBusy = false; historyCursor = null; historyMore = false; historyStarted = false; historyBusy = false; historyRetryAt = 0;
  photoCursor = null; photoMore = false; photosBusy = false; previewBusy = false; sendBusy = false; clearDisplay();
}
function signOut() { clearPrivate(); location.replace("/admin/login"); }
async function request(path, { ticket = broadcastTicket(state), body, timeout = 15000 } = {}) {
  const privateData = path !== "/api/broadcast/admin/session";
  // Cookies can change in another window without a local visibility event.
  // Bind each private response to the account and CSRF proof that own this UI.
  if (privateData) await verifySession(ticket);
  if (!currentBroadcast(state, ticket) || !visible()) throw stale();
  const controller = new AbortController(); controllers.add(controller); const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": state.session?.csrf ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data; try { data = await response.json(); } catch { data = {}; }
    if (!currentBroadcast(state, ticket) || !visible()) throw stale();
    if (privateData) await verifySession(ticket);
    if (!currentBroadcast(state, ticket) || !visible()) throw stale();
    if (!response.ok) {
      const retry = Number(response.headers?.get("retry-after"));
      throw Object.assign(new Error("request_failed"), { status: response.status, code: data.error,
        retryAfter: Number.isFinite(retry) && retry > 0 ? Math.max(1, Math.min(3600, Math.ceil(retry))) : 60 });
    }
    return data;
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
  if (error.status === 429 && target === "history-status") historyRetryAt = Date.now() + (error.retryAfter ?? 60) * 1000;
  notice(errorText(error), true, target); renderControls();
}
function armExpiry() { clearTimeout(expiryTimer); expiryTimer = setTimeout(signOut, Math.max(0, Math.min(2147483647, state.session.expiresAt - Date.now()))); }
async function verifySession(ticket) {
  let session;
  try { session = await request("/api/broadcast/admin/session", { ticket }); }
  catch (error) { error.proofFailure = true; throw error; }
  if (!acceptBroadcastSession(state, ticket, session)) { await bootstrap("La session a changé. Consulte l’historique avant de préparer une nouvelle diffusion."); throw stale(); }
  armExpiry();
}
function renderControls() {
  const frozen = !!state.pending;
  el("composition").disabled = frozen || sendBusy || state.csrfFailed;
  el("preview").disabled = frozen || previewBusy || state.csrfFailed || state.selected.size === 0;
  ui.text(el("preview"), previewBusy ? "Vérification…" : "Vérifier les destinataires");
  el("confirm").disabled = sendBusy || !canConfirmBroadcast(state);
  ui.text(el("confirm"), state.selected.size ? state.selected.size > 1 ? "Confirmer pour {count} clients" : "Confirmer pour {count} client" : "Confirmer la diffusion", { count: ui.numberParam(state.selected.size) });
  ui.text(el("acknowledge-label"), state.selected.size > 1 ? "Je confirme le contenu et l’envoi individuel à {count} clients." : "Je confirme le contenu et l’envoi individuel à {count} client.", { count: ui.numberParam(state.selected.size) });
  el("clear-selection").disabled = frozen || state.selected.size === 0;
  ui.text(el("selected-count"), state.selected.size ? state.selected.size > 1 ? "{count} / 100 destinataires choisis" : "{count} / 100 destinataire choisi" : "Aucun destinataire choisi", { count: ui.numberParam(state.selected.size) });
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
    const row = node("li"); const remove = node("button", "Retirer", "text-button"); remove.type = "button"; ui.attr(remove, "aria-label", "Retirer {name}", { name: recipient.pseudonym });
    remove.addEventListener("click", () => { if (selectRecipient(state, recipient.id, false)) compositionChanged(); }); row.append(rawNode("span", recipient.pseudonym), remove); return row;
  });
  replace(el("selected"), ...rows); renderContacts(); renderControls();
}
function renderContacts() {
  const rows = [...state.contacts.values()].map((contact) => {
    const row = node("label", undefined, "contact-row"); const checkbox = node("input"); checkbox.type = "checkbox"; checkbox.checked = state.selected.has(contact.id); checkbox.disabled = !!state.pending || state.csrfFailed;
    const name = rawNode("span", contact.nickname || contact.client.pseudonym); name.append(textNode("small", "{prefix}{status}", { prefix: contact.nickname ? `${contact.client.pseudonym} · ` : "", status: ui.messageParam(contact.canSend ? "Accès actif · accord à vérifier" : "Accès ou conversation non disponible") }));
    checkbox.addEventListener("change", () => { if (!selectRecipient(state, contact.id, checkbox.checked)) notice("Choisis au maximum 100 destinataires.", true, "contacts-status"); compositionChanged(); });
    row.append(checkbox, name); return row;
  }); replace(el("contacts"), ...rows);
}
function renderPreview() {
  replace(el("preview-list")); el("repeat-choice").hidden = !state.preview?.repeatCount;
  el("allow-repeat").checked = state.draft.allowRepeatMedia;
  if (!state.preview) { notice("", false, "preview-status"); return; }
  const rows = state.preview.recipients.map((recipient) => textNode("li", "{name} · {status}{repeat}", { name: recipient.client.pseudonym, status: ui.messageParam(recipient.eligible ? "Prêt à recevoir" : reasonNames[recipient.reason]), repeat: ui.messageParam(recipient.repeatMedia ? " · photo déjà partagée" : "") }));
  replace(el("preview-list"), ...rows);
  const all = state.preview.eligibleCount === state.selected.size;
  notice("{eligible} / {selected} destinataires éligibles.{repeat}{warning}", !all, "preview-status", { eligible: ui.numberParam(state.preview.eligibleCount), selected: ui.numberParam(state.selected.size), repeat: ui.messageParam(state.preview.repeatCount ? state.preview.repeatCount > 1 ? " Photo déjà partagée avec {count} clients." : " Photo déjà partagée avec {count} client." : "", { count: ui.numberParam(state.preview.repeatCount) }), warning: ui.messageParam(all ? "" : " Retire les destinataires non éligibles avant de confirmer.") });
}
function compositionChanged() {
  el("acknowledge").checked = false; el("campaign-body").maxLength = state.draft.mediaId ? 1000 : 4096;
  ui.text(el("body-help"), state.draft.mediaId ? "Légende facultative · 1 000 caractères maximum." : "De 1 à 4 096 caractères.");
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
  const ticket = broadcastTicket(state); const labels = []; let cursor = null;
  for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
    const page = await request(`/api/admin/crm/labels?limit=100${cursor ? `&afterId=${cursor}` : ""}`, { ticket });
    if (!currentBroadcast(state, ticket)) throw stale();
    if (!Array.isArray(page.labels) || typeof page.hasMore !== "boolean" || page.hasMore && !validId(page.nextCursor)) throw new TypeError("invalid_labels");
    for (const label of page.labels) { if (!validId(label?.id) || !["tag", "group"].includes(label.kind) || typeof label.name !== "string" || label.name.length > 64) throw new TypeError("invalid_labels"); labels.push({ id: label.id, name: label.name, kind: label.kind }); }
    if (!page.hasMore) { cursor = null; break; } if (cursor !== null && page.nextCursor <= cursor) throw new TypeError("invalid_labels"); cursor = page.nextCursor;
  }
  if (cursor) throw new TypeError("too_many_labels");
  for (const [element, kind] of [["tag-filter", "tag"], ["group-filter", "group"]]) for (const label of labels.filter((value) => value.kind === kind).sort((a, b) => a.name.localeCompare(b.name, "fr"))) { const option = rawNode("option", label.name); option.value = label.id; el(element).append(option); }
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
    if (!currentBroadcast(state, ticket)) return;
    if (!Array.isArray(page.assets) || page.assets.length > 20 || typeof page.hasMore !== "boolean" || page.nextCursor !== null && !validId(page.nextCursor)) throw new TypeError("invalid_assets");
    for (const asset of page.assets) {
      if (!validId(asset?.id) || !Number.isSafeInteger(asset.createdAt) || asset.thumbnailUrl !== `/api/media/admin/assets/${asset.id}/thumb` || !Number.isInteger(asset.width) || !Number.isInteger(asset.height)) throw new TypeError("invalid_asset");
      if (!assets.has(asset.id)) { const option = textNode("option", "{date} · {width} × {height}", { date: ui.dateParam(asset.createdAt), width: ui.numberParam(asset.width), height: ui.numberParam(asset.height) }); option.value = asset.id; el("photo-select").append(option); }
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
    await verifySession(ticket);
    const response = await fetch(asset.thumbnailUrl, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
    if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/jpeg") throw Object.assign(new Error("photo_unavailable"), { status: response.status });
    const blob = await response.blob(); if (!blob.size || blob.size > 5242880) throw new Error("photo_unavailable");
    if (!currentBroadcast(state, ticket) || !visible() || epoch !== photoEpoch || asset.id !== state.draft.mediaId) return;
    await verifySession(ticket);
    if (!currentBroadcast(state, ticket) || !visible() || epoch !== photoEpoch || asset.id !== state.draft.mediaId) return;
    photoUrl = URL.createObjectURL(blob); const image = node("img"); image.alt = ""; ui.attr(image, "aria-label", "Photo choisie pour cette diffusion"); image.src = photoUrl; replace(el("photo-preview"), image); notice("", false, "photo-status");
  } catch (error) { if (currentBroadcast(state, ticket) && epoch === photoEpoch) report(error, "photo-status"); }
  finally { clearTimeout(timer); controllers.delete(controller); }
}
function newId() { return [...crypto.getRandomValues(new Uint8Array(16))].map((value) => value.toString(16).padStart(2, "0")).join(""); }
async function send(retry = false) {
  if (sendBusy) return;
  const payload = retry ? retryCampaign(state) : prepareCampaign(state, newId()); if (!payload) return;
  const ticket = broadcastTicket(state); sendBusy = true; renderControls(); notice("Confirmation de cette diffusion…", false, "send-status");
  try {
    const result = await request("/api/broadcast/admin/campaigns", { ticket, body: payload });
    const campaign = acceptCampaign(state, ticket, result); if (!campaign) return;
    campaigns.set(campaign.id, campaign); el("campaign-form").reset(); el("photo-select").value = ""; clearPhoto(); compositionChanged();
    notice(campaign.counts.total > 1 ? "Diffusion enregistrée pour {count} clients. Suis les remises et les éventuels destinataires ignorés dans l’historique." : "Diffusion enregistrée pour {count} client. Suis les remises et les éventuels destinataires ignorés dans l’historique.", false, "send-status", { count: ui.numberParam(campaign.counts.total) });
    renderHistory(); await showCampaign(campaign.id); void loadHistory();
  } catch (error) {
    const definitiveRejected = !error.proofFailure && ([400, 413].includes(error.status) || error.status === 409 && ["recipients_unavailable", "media_unavailable", "repeat_confirmation_required", "limit_reached"].includes(error.code));
    if (rejectCampaign(state, ticket, { csrfFailed: error.status === 403, definitiveRejected })) { compositionChanged(); report(error, "send-status"); }
  }
  finally { if (currentBroadcast(state, ticket)) { sendBusy = false; renderControls(); } }
}
const countSummary = (campaign) => ui.messageParam("{delivered} remis · {pending} en attente · {skipped} ignorés · {cancelled} annulés · {failed} en échec", { delivered: ui.numberParam(campaign.counts.delivered), pending: ui.numberParam(campaign.counts.pending + campaign.counts.sending), skipped: ui.numberParam(campaign.counts.skipped), cancelled: ui.numberParam(campaign.counts.cancelled), failed: ui.numberParam(campaign.counts.failed) });
function renderHistory() {
  const rows = [...campaigns.values()].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).map((campaign) => {
    const button = node("button", undefined, "history-row"); button.type = "button"; button.setAttribute("aria-pressed", String(detailId === campaign.id));
    button.append(rawNode("strong", campaign.title), textNode("span", "{status} · {date}", { status: ui.messageParam(campaignNames[campaign.status]), date: ui.dateParam(campaign.createdAt) }), textNode("span", "{counts}", { counts: countSummary(campaign) }));
    button.addEventListener("click", () => { void showCampaign(campaign.id); }); return button;
  }); replace(el("history"), ...rows);
}
function parseHistoryPage(page, afterId) {
  if (!Array.isArray(page?.campaigns) || page.campaigns.length > 20 || typeof page.hasMore !== "boolean" || page.nextCursor !== null && !validId(page.nextCursor)) throw new TypeError("invalid_history");
  let previous = afterId; const parsed = page.campaigns.map((value) => { const campaign = parseCampaign(value); if (previous !== null && campaign.id <= previous) throw new TypeError("invalid_history"); previous = campaign.id; return campaign; });
  if (page.hasMore && (!parsed.length || previous !== page.nextCursor)) throw new TypeError("invalid_history"); return parsed;
}
async function loadHistory(more = false, { restartArchive = false } = {}) {
  if (historyBusy || more && !historyMore) return;
  const ticket = broadcastTicket(state); historyBusy = true; renderControls();
  try {
    const incoming = new Map(); let page = null;
    if (!more) {
      // Recent campaigns and every current live campaign are independent of
      // the historical ID cursor. An insertion in another window can have any ID.
      const previousLive = [...campaigns.values()].filter((campaign) => ["queued", "running"].includes(campaign.status));
      const activity = await request("/api/broadcast/admin/activity", { ticket });
      if (!Array.isArray(activity?.campaigns) || activity.campaigns.length > 30) throw new TypeError("invalid_activity");
      for (const value of activity.campaigns) { const campaign = parseCampaign(value); if (incoming.has(campaign.id)) throw new TypeError("invalid_activity"); incoming.set(campaign.id, campaign); }
      // A campaign which just completed may have fallen outside the recent
      // window. Resolve the previously live rows before accepting the snapshot.
      for (const campaign of previousLive.filter((campaign) => !incoming.has(campaign.id)).slice(0, 10)) {
        const current = parseCampaign(await request(`/api/broadcast/admin/campaigns/${campaign.id}`, { ticket }), { detail: true });
        if (current.id !== campaign.id) throw new TypeError("invalid_history"); incoming.set(current.id, current);
      }
    }
    if (more || !historyStarted || restartArchive) {
      const afterId = more ? historyCursor : null;
      page = await request(`/api/broadcast/admin/campaigns?limit=20${afterId ? `&afterId=${afterId}` : ""}`, { ticket });
      for (const campaign of parseHistoryPage(page, afterId)) incoming.set(campaign.id, mergeCampaign(incoming.get(campaign.id), campaign));
    }
    if (!currentBroadcast(state, ticket)) return;
    for (const campaign of incoming.values()) campaigns.set(campaign.id, mergeCampaign(campaigns.get(campaign.id), campaign));
    if (page) { historyCursor = page.nextCursor; historyMore = page.hasMore; historyStarted = true; }
    renderHistory(); notice(campaigns.size ? restartArchive ? "Les 20 diffusions les plus récentes et tous les envois en cours sont actualisés. « Autres diffusions » parcourt le reste de ton historique. Le parcours reprend au début de l’historique." : "Les 20 diffusions les plus récentes et tous les envois en cours sont actualisés. « Autres diffusions » parcourt le reste de ton historique." : "Aucune diffusion pour le moment.", false, "history-status");
  } catch (error) { report(error, "history-status"); }
  finally { if (currentBroadcast(state, ticket)) { historyBusy = false; renderControls(); } }
}
function renderDetail(campaign) {
  const section = el("campaign-detail"); section.hidden = false; replace(section, rawNode("h3", campaign.title), textNode("p", "{status} · {counts}", { status: ui.messageParam(campaignNames[campaign.status]), counts: countSummary(campaign) }, "small-copy"), campaign.body ? rawNode("p", campaign.body, "campaign-body") : node("p", "Photo sans légende", "campaign-body"));
  if (campaign.mediaId) section.append(node("p", "Une photo jointe", "small-copy"));
  if (["queued", "running"].includes(campaign.status) && campaign.counts.pending + campaign.counts.sending > 0) {
    const cancel = textNode("button", "Annuler les {count} envois en attente", { count: ui.numberParam(campaign.counts.pending + campaign.counts.sending) }, "button secondary"); cancel.type = "button";
    cancel.addEventListener("click", () => { void cancelCampaign(campaign.id); }); section.append(cancel);
  }
  if (campaign.status === "paused") section.append(node("p", "L’autorisation de cette diffusion n’est plus valable. Les envois restants ont été interrompus. Prépare une nouvelle diffusion si tu souhaites les confirmer de nouveau.", "small-copy"));
  const list = node("ul", undefined, "recipient-list");
  for (const recipient of campaign.recipients) list.append(textNode("li", "{name} · {status}{reason}", { name: recipient.client.pseudonym, status: ui.messageParam(recipientNames[recipient.state]), reason: ui.messageParam(recipient.reason ? " · {reason}" : "", { reason: ui.messageParam(recipient.reason ? reasonNames[recipient.reason] : "") }) })); section.append(list);
}
async function showCampaign(id, refresh = false) {
  if (!validId(id)) return; if (!refresh) { detailId = id; detailEpoch += 1; replace(el("campaign-detail"), node("p", "Chargement…", "status")); el("campaign-detail").hidden = false; renderHistory(); }
  const epoch = detailEpoch;
  try {
    const result = parseCampaign(await request(`/api/broadcast/admin/campaigns/${id}`), { detail: true });
    if (detailId !== id || detailEpoch !== epoch) return;
    const current = mergeCampaign(campaigns.get(id), result); campaigns.set(id, current);
    if (current.recipients) renderDetail(current); else { replace(el("campaign-detail"), node("p", "Les envois ont évolué. Actualise l’historique pour afficher le détail à jour.", "small-copy")); }
    renderHistory();
  } catch (error) { if (detailId === id && detailEpoch === epoch) report(error, "history-status"); }
}
async function cancelCampaign(id) {
  if (state.csrfFailed || detailId !== id) return; const ticket = broadcastTicket(state); const epoch = detailEpoch;
  for (const button of el("campaign-detail").querySelectorAll("button")) button.disabled = true;
  try {
    const campaign = parseCampaign(await request(`/api/broadcast/admin/campaigns/${id}/cancel`, { ticket, body: {} })); campaigns.set(id, mergeCampaign(campaigns.get(id), campaign)); renderHistory();
    if (detailId === id && epoch === detailEpoch) { detailEpoch += 1; await showCampaign(id, true); } notice("Les envois encore en attente ont été annulés. Les messages déjà remis restent dans les conversations.", false, "history-status");
  } catch (error) { report(error, "history-status"); if (detailId === id && epoch === detailEpoch && !error.stale) void showCampaign(id, true); }
}
function scheduleHistory() {
  clearTimeout(pollTimer); if (!state.session || !visible()) return;
  const ticket = broadcastTicket(state);
  pollTimer = setTimeout(async () => {
    if (!currentBroadcast(state, ticket) || !visible()) return;
    if (Date.now() < historyRetryAt) { scheduleHistory(); return; }
    try { await loadHistory(); if (currentBroadcast(state, ticket) && detailId && Date.now() >= historyRetryAt) await showCampaign(detailId, true); }
    finally { if (currentBroadcast(state, ticket) && visible()) scheduleHistory(); }
  }, Math.max(30000, historyRetryAt - Date.now()));
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
el("photo-select").addEventListener("change", () => { updateComposition(state, { mediaId: el("photo-select").value || null }); el("campaign-body").maxLength = state.draft.mediaId ? 1000 : 4096; ui.text(el("body-help"), state.draft.mediaId ? "Légende facultative · 1 000 caractères maximum." : "De 1 à 4 096 caractères."); compositionChanged(); void showPhoto(); });
el("allow-repeat").addEventListener("change", () => { updateComposition(state, { allowRepeatMedia: el("allow-repeat").checked }); el("acknowledge").checked = false; renderControls(); });
el("acknowledge").addEventListener("change", () => { state.acknowledged = el("acknowledge").checked; renderControls(); });
el("load-photos").addEventListener("click", () => { void loadPhotos(); }); el("more-photos").addEventListener("click", () => { void loadPhotos(true); });
el("preview").addEventListener("click", () => { void preview(); }); el("campaign-form").addEventListener("submit", (event) => { event.preventDefault(); void send(); });
el("retry").addEventListener("click", () => { void send(true); }); el("refresh-history").addEventListener("click", () => { void loadHistory(false, { restartArchive: true }); if (detailId) void showCampaign(detailId, true); });
el("more-history").addEventListener("click", () => { void loadHistory(true); }); el("reload").addEventListener("click", () => { void bootstrap(); }); el("logout").addEventListener("click", () => { void logout(); });
document.addEventListener("visibilitychange", () => { if (visible()) void bootstrap(); else clearPrivate(); }); window.addEventListener("pagehide", () => clearPrivate()); window.addEventListener("pageshow", (event) => { if (event.persisted && visible()) void bootstrap(); });
if (visible()) void bootstrap(); else clearPrivate();
