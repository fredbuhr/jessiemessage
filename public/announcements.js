import { createAnnouncementsState, clearAnnouncements, announcementTicket, currentAnnouncementTicket, acceptAnnouncementsSession, setAnnouncementCurrent, updateAnnouncementDraft, announcementDraft, acceptAnnouncementPreview, prepareAnnouncementMutation, retryAnnouncementMutation, uncertainAnnouncementMutation, rejectAnnouncementMutation, completeAnnouncementMutation, localAnnouncementDate, readLocalAnnouncementDate } from "/announcements-model.js";

const ui = globalThis.JessieI18n;
const el = id => document.getElementById(id), state = createAnnouncementsState(), controllers = new Set();
const visible = () => document.visibilityState === "visible";
let busy = false, previewBusy = false, currentBusy = false, pollTimer = null, cancelSession = null, sessionPaused = false;
let serverOffset = 0, bootstrapRunning = null, logoutBusy = false;
const stale = () => Object.assign(new Error("stale_response"), { stale: true });
const now = () => Date.now() + serverOffset;
function notice(text = "", error = false, target = "session-status", params = {}) {
  ui.text(el(target), text, params); el(target).classList.toggle("is-error", error);
}
function hidePrivate() {
  el("announcements-content").hidden = true; el("logout").hidden = true;
  for (const id of ["body", "starts-at", "expires-at"]) el(id).value = "";
  for (const id of ["current-body", "current-dates", "draft-preview", "draft-dates", "current-status", "preview-status", "save-status"]) ui.rawText(el(id), "");
}
function stopRequests() {
  for (const controller of controllers) controller.abort(); controllers.clear(); clearTimeout(pollTimer); pollTimer = null;
  cancelSession?.(); cancelSession = null; currentBusy = false; previewBusy = false; busy = false;
}
function clearPrivate() { stopRequests(); clearAnnouncements(state); hidePrivate(); serverOffset = 0; sessionPaused = false; bootstrapRunning = null; }
function signOut() { clearPrivate(); location.replace("/admin/login?continue=%2Fadmin%2Fannouncements"); }
async function request(path, { body, ticket = announcementTicket(state), proof = true } = {}) {
  if (!currentAnnouncementTicket(state, ticket) || !visible()) throw stale();
  if (proof && sessionPaused) throw new Error("session_check_pending");
  if (proof) await verifySession(ticket);
  if (!currentAnnouncementTicket(state, ticket)) throw stale();
  if (proof && sessionPaused) throw new Error("session_check_pending");
  const controller = new AbortController(); controllers.add(controller); const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": state.session?.csrf ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data; try { data = await response.json(); } catch { throw new Error("response_unconfirmed"); }
    if (!currentAnnouncementTicket(state, ticket) || !visible()) throw stale();
    if (proof) await verifySession(ticket);
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status, code: data.error });
    return data;
  } catch (error) { if (!currentAnnouncementTicket(state, ticket) || !visible()) throw stale(); throw error; }
  finally { clearTimeout(timer); controllers.delete(controller); }
}
async function verifySession(ticket) {
  let session;
  try { session = await request("/api/announcements/admin/session", { ticket, proof: false }); }
  catch (error) { error.proofFailure = true; throw error; }
  if (!acceptAnnouncementsSession(state, session)) {
    clearPrivate(); if (visible()) void bootstrap("La session a changé. Ton espace a été actualisé."); throw stale();
  }
}
function errorText(error) {
  if (error.status === 409) return "L’annonce a changé. Ton brouillon est conservé. Actualise puis reprends l’annonce avant de confirmer.";
  if (error.status === 400 || error.status === 413) return "Vérifie ton texte, les dates et la confirmation des destinataires.";
  if (error.status === 403) return "Ta connexion doit être actualisée. Réessaie après avoir actualisé la connexion.";
  if (error.status === 429) return "Trop de demandes. Patiente un moment avant de réessayer.";
  return "La connexion est momentanément indisponible. Réessaie dans un instant.";
}
function report(error, target = "save-status") {
  if (error.stale) return;
  if (error.status === 401) { signOut(); return; }
  if (error.status === 403) state.csrfFailed = true;
  notice(errorText(error), true, target); renderControls();
}
function dateRange(value, target) {
  if (!value?.expiresAt) { ui.rawText(el(target), ""); return; }
  if (value.startsAt === null || value.mode === "now") ui.text(el(target), "Dès maintenant · jusqu’au {end}", { end: ui.dateParam(value.expiresAt) });
  else ui.text(el(target), "Du {start} au {end}", { start: ui.dateParam(value.startsAt), end: ui.dateParam(value.expiresAt) });
}
function renderCurrent() {
  const value = state.current;
  if (el("current-body").textContent !== (value?.body ?? "")) ui.rawText(el("current-body"), value?.body ?? "");
  dateRange(value, "current-dates");
  const status = !value ? "Aucune annonce pour le moment." : value.expiresAt <= now() ? "Terminée" : value.startsAt > now() ? "Programmée" : "Visible dans les conversations";
  ui.text(el("current-status"), status);
  el("remove-announcement").hidden = !value;
  el("use-current").hidden = !value && state.currentRevision === state.baseRevision;
  ui.text(el("use-current"), value ? "Reprendre cette annonce" : "Actualiser mon brouillon");
  renderControls();
}
function renderDraft() {
  ui.rawText(el("draft-preview"), state.draft.body);
  dateRange({ ...state.draft, startsAt: state.draft.mode === "now" ? null : state.draft.startsAt }, "draft-dates");
  el("starts-field").hidden = state.draft.mode !== "scheduled";
  el("starts-at").required = state.draft.mode === "scheduled";
  el("preview").hidden = !state.draft.sendMessage;
  el("acknowledge-choice").hidden = !state.draft.sendMessage || !state.preview;
  if (state.preview) {
    notice("{eligible} clients éligibles · {excluded} exclus.", false, "preview-status", { eligible: ui.numberParam(state.preview.eligibleCount), excluded: ui.numberParam(state.preview.excludedCount) });
    ui.text(el("acknowledge-label"), "Je confirme l’envoi individuel à {count} clients.", { count: ui.numberParam(state.preview.eligibleCount) });
  } else notice("", false, "preview-status");
  renderControls();
}
function renderControls() {
  const frozen = !!state.pending || busy || state.csrfFailed || sessionPaused;
  el("announcement-fields").disabled = frozen;
  el("save").disabled = frozen || state.draft.sendMessage && (!state.preview || !state.acknowledged);
  el("preview").disabled = frozen || previewBusy;
  el("remove-announcement").disabled = frozen || !state.current;
  el("use-current").disabled = frozen;
  el("refresh-current").disabled = currentBusy || busy;
  el("uncertain").hidden = state.pending?.status !== "uncertain";
  el("retry").disabled = busy || state.csrfFailed || sessionPaused;
  el("reload").hidden = !state.csrfFailed && !sessionPaused;
}
function fillFields() {
  el("body").value = state.draft.body; el("start-mode").value = state.draft.mode;
  el("starts-at").value = localAnnouncementDate(state.draft.startsAt);
  el("expires-at").value = localAnnouncementDate(state.draft.expiresAt);
  el("send-message").checked = state.draft.sendMessage; el("acknowledge").checked = state.acknowledged; renderDraft();
}
function readDraft() {
  if (!updateAnnouncementDraft(state, { body: el("body").value, mode: el("start-mode").value,
    startsAt: readLocalAnnouncementDate(el("starts-at").value), expiresAt: readLocalAnnouncementDate(el("expires-at").value), sendMessage: el("send-message").checked })) return;
  el("acknowledge").checked = false; renderDraft(); notice("", false, "save-status");
}
async function loadCurrent(fillDraft = false) {
  if (currentBusy || !state.session || !visible()) return;
  const ticket = announcementTicket(state); currentBusy = true; renderControls();
  try {
    const response = await request("/api/announcements/admin/current", { ticket });
    if (!setAnnouncementCurrent(state, response, { fillDraft })) return;
    serverOffset = response.serverTime - Date.now();
    if (fillDraft) { if (!state.draft.expiresAt) state.draft.expiresAt = Math.floor((now() + 2 * 3600000) / 60000) * 60000; fillFields(); }
    renderCurrent();
  } catch (error) { report(error, "current-status"); }
  finally { if (currentAnnouncementTicket(state, ticket)) { currentBusy = false; renderControls(); } }
}
function armSession() {
  cancelSession?.(); if (!state.session || !visible()) return;
  const ticket = announcementTicket(state);
  cancelSession = globalThis.JessieSessionClock.scheduleSessionCheck(Math.min(state.session.expiresAt, Date.now() + 300000), () => { void renewSession(ticket); }, { maxDelayMs: 300000 });
}
async function renewSession(ticket) {
  try {
    const session = await request("/api/auth/session", { ticket, proof: false });
    if (!acceptAnnouncementsSession(state, session)) { clearPrivate(); void bootstrap("La session a changé. Ton espace a été actualisé."); return; }
    await verifySession(ticket); armSession();
  } catch (error) {
    if (error.stale) return; if (error.status === 401) { signOut(); return; }
    if (state.pending?.status === "sending") uncertainAnnouncementMutation(state);
    stopRequests(); state.generation += 1; sessionPaused = true; hidePrivate(); notice(errorText(error), true); el("reload").hidden = false;
  }
}
function scheduleCurrent() {
  clearTimeout(pollTimer); if (!state.session || !visible() || sessionPaused) return;
  const ticket = announcementTicket(state);
  pollTimer = setTimeout(async () => { if (!currentAnnouncementTicket(state, ticket)) return; await loadCurrent(); if (currentAnnouncementTicket(state, ticket)) scheduleCurrent(); }, 30000);
}
async function preview() {
  if (previewBusy || state.pending || !state.draft.sendMessage || state.csrfFailed) return;
  try { announcementDraft(state, now()); } catch { notice("Vérifie ton texte, les dates et la confirmation des destinataires.", true, "preview-status"); return; }
  const ticket = announcementTicket(state), version = state.draftVersion; previewBusy = true; renderControls();
  try {
    const result = await request("/api/announcements/admin/preview", { ticket, body: {} });
    if (acceptAnnouncementPreview(state, version, result)) { renderDraft(); el("acknowledge").focus({ preventScroll: true }); }
  } catch (error) { report(error, "preview-status"); }
  finally { if (currentAnnouncementTicket(state, ticket)) { previewBusy = false; renderControls(); } }
}
const mutationId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, "0")).join("");
async function mutate({ retry = false, remove = false } = {}) {
  if (busy || state.csrfFailed || sessionPaused) return;
  let payload;
  try { payload = retry ? retryAnnouncementMutation(state) : prepareAnnouncementMutation(state, mutationId(), now(), remove); }
  catch { notice("Vérifie ton texte, les dates et la confirmation des destinataires.", true, "save-status"); return; }
  if (!payload) return;
  const ticket = announcementTicket(state); busy = true; renderControls();
  notice("Enregistrement de l’annonce…", false, "save-status");
  try {
    const result = await request(`/api/announcements/admin/current${state.pending.kind === "remove" ? "/remove" : ""}`, { ticket, body: payload });
    completeAnnouncementMutation(state, result); serverOffset = result.serverTime - Date.now(); fillFields(); renderCurrent();
    notice(remove || !result.announcement ? "L’annonce a été retirée." : "Ton annonce est enregistrée.", false, "save-status");
  } catch (error) {
    if (error.stale) return;
    if ([400, 404, 409, 413].includes(error.status) && !error.proofFailure) {
      rejectAnnouncementMutation(state); report(error); if (error.status === 409) await loadCurrent();
    } else { uncertainAnnouncementMutation(state); report(error); }
  } finally { if (currentAnnouncementTicket(state, ticket)) { busy = false; renderControls(); } }
}
async function bootstrap(message = "") {
  if (!visible() || bootstrapRunning || logoutBusy) return;
  const task = {}; bootstrapRunning = task; state.visible = true; const ticket = announcementTicket(state); sessionPaused = false; state.csrfFailed = false;
  notice("Vérification de la connexion…");
  try {
    const response = await request("/api/announcements/admin/session", { ticket, proof: false });
    if (!acceptAnnouncementsSession(state, response)) { clearPrivate(); state.visible = true; void bootstrap("La session a changé. Ton espace a été actualisé."); return; }
    const initialized = state.serverTime !== null;
    el("announcements-content").hidden = false; el("logout").hidden = false; fillFields(); notice(message);
    await loadCurrent(!initialized); armSession(); scheduleCurrent(); renderControls();
  } catch (error) {
    if (!error.stale) { if (error.status === 401) signOut(); else { sessionPaused = true; hidePrivate(); notice(error.status === 404 ? "Les annonces ne sont pas activées pour le moment." : errorText(error), true); el("reload").hidden = false; } }
  } finally { if (bootstrapRunning === task) bootstrapRunning = null; }
}
async function logout() {
  if (logoutBusy || !state.session) return;
  logoutBusy = true; const csrf = state.session.csrf; clearPrivate();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  let confirmed = false;
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" });
    confirmed = response.ok || response.status === 401;
  }
  catch { /* The local private state remains cleared. */ }
  finally {
    clearTimeout(timer); logoutBusy = false;
    if (confirmed) signOut(); else void bootstrap("La déconnexion n’a pas été confirmée. Réessaie de te déconnecter.");
  }
}
el("announcement-form").addEventListener("submit", event => { event.preventDefault(); void mutate(); });
for (const id of ["body", "starts-at", "expires-at"]) el(id).addEventListener("input", readDraft);
for (const id of ["start-mode", "send-message"]) el(id).addEventListener("change", readDraft);
el("acknowledge").addEventListener("change", () => { state.acknowledged = el("acknowledge").checked; renderControls(); });
el("preview").addEventListener("click", () => { void preview(); }); el("retry").addEventListener("click", () => { void mutate({ retry: true }); });
el("refresh-current").addEventListener("click", () => { void loadCurrent(); });
el("use-current").addEventListener("click", () => {
  if (state.current) setAnnouncementCurrent(state, { serverTime: now(), revision: state.currentRevision, announcement: state.current }, { fillDraft: true });
  else { state.baseRevision = state.currentRevision; updateAnnouncementDraft(state, {}); }
  fillFields(); renderCurrent(); el("body").focus({ preventScroll: true }); notice("", false, "save-status");
});
el("remove-announcement").addEventListener("click", () => { void mutate({ remove: true }); });
el("reload").addEventListener("click", () => { void bootstrap(); }); el("logout").addEventListener("click", () => { void logout(); });
ui.onChange(() => { if (state.visible) { renderCurrent(); renderDraft(); } });
document.addEventListener("visibilitychange", () => {
  if (visible()) { void bootstrap(); return; }
  if (state.pending?.status === "sending") uncertainAnnouncementMutation(state);
  stopRequests(); state.visible = false; state.generation += 1; bootstrapRunning = null; hidePrivate();
});
window.addEventListener("pagehide", clearPrivate); window.addEventListener("pageshow", event => { if (event.persisted && visible()) void bootstrap(); });
window.addEventListener("online", () => { if (visible() && sessionPaused) void bootstrap(); });
window.addEventListener("beforeunload", event => { if (state.pending || state.draft.body && state.draft.body !== state.current?.body) { event.preventDefault(); event.returnValue = ""; } });
if (visible()) void bootstrap(); else hidePrivate();
