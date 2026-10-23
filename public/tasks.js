import { taskId, createTasksState, clearTasks, taskTicket, currentTaskTicket, acceptTasksSession, taskQuery, setTaskFilter, applyTaskPage, parseTask, parseTaskSummary, editTask, changeTaskDraft, prepareTaskMutation, retryTaskMutation, uncertainTaskMutation, rejectTaskMutation, taskConflict, completeTaskMutation, localTaskDate, readTaskDate } from "/tasks-model.js";

const ui = globalThis.JessieI18n;
ui.register({
  "JessieMessage — Mes tâches": "JessieMessage — My tasks", "Mes tâches": "My tasks", "Ma tâche": "My task",
  "Photos à envoyer, demande personnelle, rendez-vous… garde tes prochaines choses à faire ici.": "Photos to send, a personal request, an appointment… keep your next things to do here.",
  "Afficher les tâches": "Show tasks", "À traiter maintenant": "Due now", "Terminées": "Completed", "Ajouter une tâche": "Add a task", "Actualiser": "Refresh",
  "Voir les tâches de tous mes clients": "See tasks for all my clients", "Pour ajouter une tâche, ouvre la fiche du client dans tes messages.": "To add a task, open the client’s profile in your messages.",
  "Ces tâches restent dans ton espace privé. Les rappels apparaissent ici lorsque tu ouvres l’application ; aucune alerte n’est envoyée au client.": "These tasks stay in your private space. Reminders appear here when you open the app; no alert is sent to the client.",
  "Il n’y a pas de notification lorsque l’application est fermée.": "There is no notification when the app is closed.",
  "Autres tâches": "More tasks", "Échéance · heure de cet appareil": "Due date · this device’s local time", "La date est facultative. Modifie-la pour reporter cette tâche.": "The date is optional. Change it to postpone this task.",
  "Enregistrer la tâche": "Save task", "La tâche a changé sur un autre appareil": "The task changed on another device", "Ton brouillon est conservé. Compare la version enregistrée avant de choisir.": "Your draft is preserved. Compare the saved version before choosing.",
  "Reprendre cette version": "Use this version", "Enregistrer mon brouillon": "Save my draft", "La confirmation n’a pas été reçue. Réessaie la même demande pour éviter une seconde tâche.": "Confirmation was not received. Retry the same request to avoid creating a second task.",
  "Active JavaScript pour retrouver tes tâches.": "Enable JavaScript to see your tasks.", "Abandonner le brouillon": "Discard draft", "Reprendre mon brouillon": "Resume my draft", "Reprendre la demande": "Resume request",
  "Aucune tâche à traiter pour le moment.": "No tasks are due at the moment.", "{count} tâche à traiter maintenant.": "{count} task is due now.", "{count} tâches à traiter maintenant.": "{count} tasks are due now.",
  "Tâches de {name}": "Tasks for {name}", "Les tâches de ce client ne sont plus accessibles.": "This client’s tasks are no longer available.", "Sans échéance": "No due date", "Terminée": "Completed", "À traiter · {date}": "Due · {date}", "Prévue le {date}": "Due on {date}",
  "Modifier": "Edit", "Reporter": "Postpone", "Terminer": "Complete", "Réouvrir": "Reopen", "Aucune tâche dans cette liste.": "No tasks in this list.", "Chargement des tâches…": "Loading tasks…",
  "La connexion est momentanément indisponible. Ton brouillon reste ici.": "The connection is temporarily unavailable. Your draft stays here.", "Vérifie le texte de 500 caractères maximum et la date.": "Check the text of up to 500 characters and the date.",
  "Cette tâche n’est plus accessible.": "This task is no longer available.", "La tâche a changé. Ton brouillon est conservé.": "The task changed. Your draft is preserved.", "La connexion a changé. Actualise-la avant de reprendre.": "The sign-in changed. Refresh it before continuing.",
  "La version enregistrée n’a pas pu être chargée. Actualise la liste avant de réessayer.": "The saved version could not be loaded. Refresh the list before trying again.", "Une tâche reste à enregistrer. Termine-la ou abandonne son brouillon avant d’en ouvrir une autre.": "A task is still waiting to be saved. Finish it or discard its draft before opening another.",
  "Tâche enregistrée.": "Task saved.", "Tâche terminée.": "Task completed.", "Tâche réouverte.": "Task reopened.", "Version enregistrée reprise.": "Saved version loaded.", "Les tâches ne sont pas disponibles pour le moment.": "Tasks are not available at the moment.",
  "L’adresse de ce client n’est pas valide. Reviens à tes messages.": "This client’s address is invalid. Go back to your messages.", "La tâche dépasse le nombre de modifications autorisé.": "This task has reached the allowed number of changes."
});
const el = id => document.getElementById(id), BASE = "/api/admin/crm/tasks";
const params = new URLSearchParams(location.search), contextValues = params.getAll("conversationId");
const contextInvalid = contextValues.length > 1 || contextValues.length === 1 && !taskId(contextValues[0]);
const state = createTasksState(contextInvalid ? null : contextValues[0] ?? null), controllers = new Set();
const visible = () => document.visibilityState === "visible", stale = () => Object.assign(new Error("stale_response"), { stale: true });
let busy = false, listBusy = false, listRequest = 0, summaryRequest = 0, bootstrapRunning = null, sessionPaused = false, logoutBusy = false;
let pollTimer = null, cancelSession = null, contextReady = false, returnTarget = null, quickAction = false, serverOffset = 0;
const now = () => Date.now() + serverOffset;
function notice(source = "", error = false, target = "session-status", values = {}) { ui.text(el(target), source, values); el(target).classList.toggle("is-error", error); }
function replace(node, ...children) { ui.forget(node); node.replaceChildren(...children); }
function hidePrivate() {
  el("tasks-content").hidden = true; el("logout").hidden = true;
  if (el("task-dialog").open) el("task-dialog").close();
  for (const id of ["task-title", "task-due"]) el(id).value = "";
  for (const id of ["summary", "client-context", "editor-client", "saved-title", "saved-due", "task-status", "list-status"]) ui.rawText(el(id), "");
  replace(el("task-list")); el("task-conflict").hidden = true; el("task-uncertain").hidden = true;
}
function stopRequests() {
  for (const controller of controllers) controller.abort(); controllers.clear(); clearTimeout(pollTimer); pollTimer = null;
  cancelSession?.(); cancelSession = null; listRequest += 1; summaryRequest += 1; listBusy = false; busy = false;
}
function clearPrivate() { stopRequests(); clearTasks(state); hidePrivate(); contextReady = false; returnTarget = null; quickAction = false; serverOffset = 0; sessionPaused = false; bootstrapRunning = null; }
function login() { clearPrivate(); location.replace(`/admin/login?continue=${encodeURIComponent("/admin/tasks")}`); }
async function request(path, { body, ticket = taskTicket(state), proof = true } = {}) {
  if (!currentTaskTicket(state, ticket) || !visible()) throw stale();
  if (proof && sessionPaused) throw new Error("session_paused");
  if (proof) await verifySession(ticket);
  if (!currentTaskTicket(state, ticket)) throw stale();
  const controller = new AbortController(); controllers.add(controller); const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": state.session?.csrf ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data; try { data = await response.json(); } catch { throw new Error("response_unconfirmed"); }
    if (!currentTaskTicket(state, ticket) || !visible()) throw stale();
    if (proof) await verifySession(ticket);
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status, code: data.error });
    return data;
  } catch (error) { if (!currentTaskTicket(state, ticket) || !visible()) throw stale(); throw error; }
  finally { clearTimeout(timer); controllers.delete(controller); }
}
async function verifySession(ticket) {
  let session;
  try { session = await request("/api/auth/session", { ticket, proof: false }); } catch (error) { error.proofFailure = true; throw error; }
  if (!acceptTasksSession(state, session)) {
    clearPrivate(); if (visible()) void bootstrap("La session a changé. Ton espace a été actualisé."); throw stale();
  }
}
function report(error, target = "task-status") {
  if (error.stale) return;
  if (error.status === 401) { login(); return; }
  let source = "La connexion est momentanément indisponible. Ton brouillon reste ici.";
  if ([400, 413].includes(error.status)) source = "Vérifie le texte de 500 caractères maximum et la date.";
  else if (error.status === 403) { state.csrfFailed = true; source = "La connexion a changé. Actualise-la avant de reprendre."; }
  else if (error.status === 404) source = "Cette tâche n’est plus accessible.";
  else if (error.status === 409) source = "La tâche a changé. Ton brouillon est conservé.";
  else if (error.status === 429) source = "Trop de demandes. Patiente un moment avant de réessayer.";
  notice(source, true, target); controls();
}
function controls() {
  const frozen = busy || !!state.pending || state.csrfFailed || sessionPaused;
  el("task-fields").disabled = frozen; el("save-task").disabled = frozen || !!state.draft?.conflict;
  el("reload-task").disabled = frozen; el("overwrite-task").disabled = frozen || !state.draft?.conflict;
  el("discard-task").disabled = busy || !!state.pending; el("retry-task").disabled = busy || state.csrfFailed || sessionPaused;
  el("task-uncertain").hidden = state.pending?.status !== "uncertain";
  el("new-task").hidden = !state.draft && (!state.conversationId || !contextReady);
  ui.text(el("new-task"), state.pending ? "Reprendre la demande" : state.draft?.dirty ? "Reprendre mon brouillon" : "Ajouter une tâche");
  el("new-task").disabled = busy || sessionPaused || state.csrfFailed;
  el("task-filter").disabled = listBusy || busy || sessionPaused; el("refresh-tasks").disabled = listBusy || busy || sessionPaused;
  el("more-tasks").hidden = !state.hasMore; el("more-tasks").disabled = listBusy || busy || sessionPaused;
  el("reload").hidden = !sessionPaused && !state.csrfFailed;
  for (const button of el("task-list").querySelectorAll("button")) button.disabled = frozen;
}
function renderSummary() { notice(state.dueCount === 0 ? "Aucune tâche à traiter pour le moment." : state.dueCount === 1 ? "{count} tâche à traiter maintenant." : "{count} tâches à traiter maintenant.", false, "summary", { count: ui.numberParam(state.dueCount) }); }
function showDate(node, task) {
  const due = !task.done && task.dueAt !== null && task.dueAt <= now(); node.classList.toggle("is-due", due);
  ui.text(node, task.done ? "Terminée" : task.dueAt === null ? "Sans échéance" : due ? "À traiter · {date}" : "Prévue le {date}", task.dueAt === null || task.done ? {} : { date: ui.dateParam(task.dueAt, { dateStyle: "medium", timeStyle: "short" }) });
}
function button(source, action, task) {
  const node = document.createElement("button"); node.type = "button"; node.className = "button secondary"; node.dataset.taskAction = action; ui.text(node, source);
  node.addEventListener("click", () => {
    const opened = openEditor(task, node, action === "postpone" ? "task-due" : "task-title");
    if (opened && ["complete", "reopen"].includes(action)) { changeTaskDraft(state, { done: action === "complete" }); quickAction = true; void save(); }
  }); return node;
}
function renderList() {
  const active = document.activeElement?.closest?.(".task-card"), focusedId = active?.dataset.taskId, action = document.activeElement?.dataset.taskAction;
  const nodes = [];
  for (const task of state.tasks.values()) {
    const card = document.createElement("li"); card.className = "task-card"; card.dataset.taskId = task.id; card.classList.toggle("is-due", !task.done && task.dueAt !== null && task.dueAt <= now());
    const client = document.createElement("a"); client.className = "task-client"; client.href = task.reply === true ? `/admin/messages#conversation=${task.conversationId}` : `/admin/tasks?conversationId=${task.conversationId}`; ui.rawText(client, task.clientName);
    const title = document.createElement("h2"); title.className = "task-title"; if (task.reply === true) ui.text(title, "À répondre"); else ui.rawText(title, task.title);
    const date = document.createElement("p"); date.className = "task-date"; showDate(date, task);
    const actions = document.createElement("div"); actions.className = "task-actions"; if (task.reply !== true) actions.append(button("Modifier", "edit", task));
    if (task.reply !== true) { if (!task.done) actions.append(button("Reporter", "postpone", task)); actions.append(button(task.done ? "Réouvrir" : "Terminer", task.done ? "reopen" : "complete", task)); }
    card.append(client, title, date, actions); nodes.push(card);
  }
  replace(el("task-list"), ...nodes);
  if (focusedId && action && !document.activeElement?.closest?.(".task-card")) el("task-list").querySelector(`[data-task-id="${focusedId}"] [data-task-action="${action}"]`)?.focus({ preventScroll: true });
  controls();
}
function renderDraft() {
  const draft = state.draft; if (!draft) return;
  el("task-title").value = draft.title; el("task-due").value = localTaskDate(draft.dueAt); ui.rawText(el("editor-client"), draft.clientName);
  el("task-conflict").hidden = !draft.conflict;
  if (draft.conflict) { ui.rawText(el("saved-title"), draft.conflict.title); showDate(el("saved-due"), draft.conflict); }
  controls();
}
function focusReturn() {
  const target = returnTarget;
  if (target?.isConnected && !target.disabled) target.focus({ preventScroll: true });
  else el("tasks-title").focus({ preventScroll: true });
  returnTarget = null;
}
function openEditor(task = null, opener = el("new-task"), focusId = "task-title") {
  if (sessionPaused || state.csrfFailed || busy) return false;
  if (state.pending || state.draft?.dirty && state.draft.id !== (task?.id ?? null)) {
    returnTarget = opener; renderDraft(); if (!el("task-dialog").open) el("task-dialog").showModal();
    if (!state.pending) notice("Une tâche reste à enregistrer. Termine-la ou abandonne son brouillon avant d’en ouvrir une autre.", true, "task-status");
    return false;
  }
  if (!state.draft?.dirty || task && state.draft.id !== task.id) editTask(state, task);
  returnTarget = opener; quickAction = false; renderDraft(); notice("", false, "task-status");
  if (!el("task-dialog").open) el("task-dialog").showModal(); el(focusId).focus({ preventScroll: true }); return true;
}
function closeEditor() { if (el("task-dialog").open) el("task-dialog").close(); focusReturn(); controls(); }
function readDraft() {
  if (!state.draft || state.pending) return false;
  try {
    const dueAt = el("task-due").value === localTaskDate(state.draft.dueAt) ? state.draft.dueAt : readTaskDate(el("task-due").value);
    changeTaskDraft(state, { title: el("task-title").value, dueAt }); return true;
  } catch { notice("Vérifie le texte de 500 caractères maximum et la date.", true, "task-status"); return false; }
}
async function loadList(more = false, afterSave = false) {
  if (listBusy || busy && !afterSave || !state.session || sessionPaused || !visible() || more && !state.hasMore) return;
  const ticket = taskTicket(state), requestId = ++listRequest, epoch = state.listEpoch, afterId = more ? state.cursor : null;
  listBusy = true; controls(); notice("Chargement des tâches…", false, "list-status");
  try {
    const page = await request(`${BASE}?${taskQuery(state, afterId)}`, { ticket });
    if (requestId !== listRequest || !applyTaskPage(state, page, { epoch, afterId })) return;
    serverOffset = page.serverTime - Date.now(); renderList(); notice(state.tasks.size ? "" : "Aucune tâche dans cette liste.", false, "list-status");
  } catch (error) { if (requestId === listRequest) report(error, "list-status"); }
  finally { if (currentTaskTicket(state, ticket) && requestId === listRequest) { listBusy = false; controls(); } }
}
async function loadSummary(afterSave = false) {
  if (busy && !afterSave) return;
  const ticket = taskTicket(state), requestId = ++summaryRequest;
  try {
    const summary = parseTaskSummary(await request(`${BASE}/summary`, { ticket }));
    if (requestId !== summaryRequest) return;
    state.dueCount = summary.dueCount; serverOffset = summary.serverTime - Date.now(); renderSummary();
  } catch (error) { if (requestId !== summaryRequest) return; throw error; }
}
async function loadContext() {
  if (!state.conversationId) return;
  const profile = await request(`/api/admin/crm/conversations/${state.conversationId}`);
  if (profile.conversationId !== state.conversationId || typeof profile.client?.pseudonym !== "string" || profile.client.pseudonym.length > 64
    || typeof profile.nickname !== "string" || profile.nickname.length > 64) throw new Error("invalid_profile");
  state.clientName = profile.nickname || profile.client.pseudonym; contextReady = true;
  notice("Tâches de {name}", false, "client-context", { name: state.clientName }); controls();
}
async function loadConflict(id, ticket) {
  try {
    const response = await request(`${BASE}/${id}`, { ticket }); taskConflict(state, response.task); renderDraft();
  } catch (error) { if (error.stale) return; if ([401, 403].includes(error.status)) report(error); else notice("La version enregistrée n’a pas pu être chargée. Actualise la liste avant de réessayer.", true, "task-status"); }
}
const randomId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(value => value.toString(16).padStart(2, "0")).join("");
async function save({ retry = false, overwrite = false } = {}) {
  if (busy || state.csrfFailed || sessionPaused) return;
  let pending;
  try {
    if (!retry && (!readDraft() || !el("task-title").checkValidity() || !el("task-due").checkValidity())) return;
    pending = retry ? retryTaskMutation(state) : prepareTaskMutation(state, randomId(), { overwrite });
  } catch { notice("Vérifie le texte de 500 caractères maximum et la date.", true, "task-status"); return; }
  if (!pending) return;
  const ticket = taskTicket(state); listRequest += 1; summaryRequest += 1; listBusy = false; busy = true; let confirmed = false; controls(); notice("Enregistrement…", false, "task-status");
  try {
    const result = await request(`${BASE}/${pending.id}`, { body: pending.body, ticket }); const task = completeTaskMutation(state, result);
    confirmed = true;
    const source = quickAction ? task.done ? "Tâche terminée." : "Tâche réouverte." : "Tâche enregistrée.";
    state.draft = null; closeEditor(); notice(source); await loadList(false, true); await loadSummary(true);
  } catch (error) {
    if (error.stale) return;
    if (confirmed) { report(error, "list-status"); return; }
    if ([400, 404, 409, 413].includes(error.status) && !error.proofFailure) {
      rejectTaskMutation(state); report(error);
      if (error.status === 409 && state.draft?.id) await loadConflict(pending.id, ticket);
    } else { uncertainTaskMutation(state); report(error); }
  } finally { if (currentTaskTicket(state, ticket)) { busy = false; controls(); } }
}
function armSession() {
  cancelSession?.(); if (!state.session || !visible()) return;
  const ticket = taskTicket(state);
  cancelSession = globalThis.JessieSessionClock.scheduleSessionCheck(Math.min(state.session.expiresAt, Date.now() + 300000), () => { void renewSession(ticket); }, { maxDelayMs: 300000 });
}
async function renewSession(ticket) {
  try { await verifySession(ticket); armSession(); }
  catch (error) {
    if (error.stale) return; if (error.status === 401) { login(); return; }
    if (state.pending?.status === "sending") uncertainTaskMutation(state);
    stopRequests(); state.generation += 1; sessionPaused = true; hidePrivate(); notice("La connexion a changé. Actualise-la avant de reprendre.", true); el("reload").hidden = false;
  }
}
function scheduleRefresh() {
  clearTimeout(pollTimer); if (!state.session || !visible() || sessionPaused) return;
  const ticket = taskTicket(state);
  pollTimer = setTimeout(async () => {
    if (!currentTaskTicket(state, ticket)) return;
    try { await loadSummary(); if (state.tasks.size <= 50 && !el("task-dialog").open) await loadList(); }
    catch (error) { report(error, "list-status"); }
    if (currentTaskTicket(state, ticket)) scheduleRefresh();
  }, 30000);
}
async function bootstrap(message = "") {
  if (!visible() || bootstrapRunning || logoutBusy || contextInvalid) return;
  const boot = {}; bootstrapRunning = boot; state.visible = true; state.csrfFailed = false; sessionPaused = false; notice("Vérification de la connexion…");
  try {
    const session = await request("/api/auth/session", { proof: false });
    if (!acceptTasksSession(state, session)) {
      clearPrivate(); state.visible = true; if (!acceptTasksSession(state, session)) throw new Error("invalid_session"); message = "La session a changé. Ton espace a été actualisé.";
    }
    el("tasks-content").hidden = false; el("logout").hidden = false; el("all-clients").hidden = !state.conversationId; el("create-help").hidden = !!state.conversationId; el("task-filter").value = state.filter;
    renderDraft(); notice(message); await loadContext(); await loadList(); await loadSummary(); armSession(); scheduleRefresh(); controls();
  } catch (error) {
    if (!error.stale) { if (error.status === 401) login(); else { sessionPaused = true; hidePrivate(); notice(error.status === 404 ? "Les tâches ne sont pas disponibles pour le moment." : "La connexion est momentanément indisponible. Ton brouillon reste ici.", true); el("reload").hidden = false; } }
  } finally { if (bootstrapRunning === boot) bootstrapRunning = null; }
}
async function logout() {
  if (logoutBusy || !state.session) return;
  logoutBusy = true; const csrf = state.session.csrf; clearPrivate();
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000); let confirmed = false;
  try { const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" }); confirmed = response.ok || response.status === 401; }
  catch { /* The private display stays cleared until the session is checked. */ }
  finally { clearTimeout(timer); logoutBusy = false; if (confirmed) login(); else void bootstrap("La déconnexion n’a pas été confirmée. Réessaie de te déconnecter."); }
}
el("task-form").addEventListener("submit", event => { event.preventDefault(); void save(); });
for (const id of ["task-title", "task-due"]) el(id).addEventListener("input", readDraft);
el("new-task").addEventListener("click", () => { openEditor(); });
el("close-task").addEventListener("click", closeEditor); el("task-dialog").addEventListener("close", () => { if (!el("task-dialog").open) focusReturn(); });
el("discard-task").addEventListener("click", () => { if (state.pending || busy) return; state.draft = null; closeEditor(); });
el("retry-task").addEventListener("click", () => { void save({ retry: true }); });
el("reload-task").addEventListener("click", () => { const latest = state.draft?.conflict; if (!latest || state.pending) return; editTask(state, latest); renderDraft(); notice("Version enregistrée reprise.", false, "task-status"); el("task-title").focus({ preventScroll: true }); });
el("overwrite-task").addEventListener("click", () => { void save({ overwrite: true }); });
el("task-filter").addEventListener("change", () => { setTaskFilter(state, el("task-filter").value); listRequest += 1; listBusy = false; renderList(); void loadList(); });
el("refresh-tasks").addEventListener("click", () => { void loadList(); void loadSummary().catch(error => report(error, "list-status")); });
el("more-tasks").addEventListener("click", () => { void loadList(true); }); el("reload").addEventListener("click", () => { void bootstrap(); }); el("logout").addEventListener("click", () => { void logout(); });
ui.onChange(() => { if (!state.visible) return; renderSummary(); renderList(); renderDraft(); if (state.clientName) notice("Tâches de {name}", false, "client-context", { name: state.clientName }); });
document.addEventListener("visibilitychange", () => {
  if (visible()) { void bootstrap(); return; }
  if (state.pending?.status === "sending") uncertainTaskMutation(state);
  stopRequests(); state.visible = false; state.generation += 1; bootstrapRunning = null; hidePrivate();
});
window.addEventListener("pagehide", clearPrivate); window.addEventListener("pageshow", event => { if (event.persisted && visible()) void bootstrap(); });
window.addEventListener("online", () => { if (visible() && sessionPaused) void bootstrap(); });
window.addEventListener("beforeunload", event => { if (state.pending || state.draft?.dirty) { event.preventDefault(); event.returnValue = ""; } });
if (contextInvalid) { hidePrivate(); notice("L’adresse de ce client n’est pas valide. Reviens à tes messages.", true); }
else if (visible()) void bootstrap(); else hidePrivate();
