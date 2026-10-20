import { createReadinessState, clearReadiness, readinessTicket, currentReadiness, acceptAdminSession, acceptReadinessSummary, beginSmtpCheck, acceptSmtpProof, rejectSmtpCheck, featureNames, operationNames, databaseStateNames, workerStateNames, queueDelayMinutes, formatOperationsReport } from "/readiness-model.js";

const interpolate = (source, values = {}) => source.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => String(values[key] ?? ""));
const ui = globalThis.JessieI18n ?? { t: interpolate,
  text: (element, source, values) => { element.textContent = interpolate(source, values); },
  rawText: (element, value) => { element.textContent = String(value ?? ""); },
  dateParam: (value, options = {}) => new Date(value).toLocaleString("fr-FR", options),
  numberParam: (value, options = {}) => value.toLocaleString("fr-FR", options), messageParam: interpolate,
};

const el = (id) => document.getElementById(id);
const state = createReadinessState();
const controllers = new Set();
let cancelSessionCheck = null; let logoutBusy = false; let sessionPaused = false;
let reportTask = null;
const visible = () => document.visibilityState === "visible";
function notice(text, error = false, id = "session-status") {
  const node = el(id); ui.text(node, text); node.classList.toggle("is-error", error);
}
function clearDisplay() {
  el("readiness-content").hidden = true; el("logout").hidden = true; el("refresh").hidden = true;
  el("refresh").disabled = false;
  el("mail-sender").textContent = ""; el("mail-status").textContent = ""; el("feature-list").replaceChildren();
  el("operations-details").hidden = true; el("operations-details").open = false; el("operations-status").textContent = ""; el("operations-sample").textContent = "";
  el("release-details").hidden = true; el("release-details").replaceChildren();
  el("download-operations").hidden = true; el("download-operations").disabled = false;
  notice("", false, "operations-download-status");
  for (const id of ["operations-database", "operations-workers", "operations-queues"]) el(id).replaceChildren();
  el("smtp-proof-date").textContent = ""; el("smtp-proof-date").hidden = true; el("verify-smtp").hidden = true;
  el("verify-smtp").disabled = false; ui.text(el("verify-smtp"), "Vérifier la connexion e-mail");
  notice(""); notice("", false, "smtp-status");
}
const node = (tag, text, className = "", values = {}) => { const element = document.createElement(tag); if (text !== undefined) ui.text(element, text, values); if (className) element.className = className; return element; };
const observedDate = (value) => value === null ? ui.messageParam("aucune mesure disponible") : ui.dateParam(value);
function detail(label, source, values = {}) { const row = node("div"); row.append(node("dt", label), node("dd", source, "", values)); return row; }
function renderOperations(operations) {
  el("operations-details").hidden = !operations;
  ui.text(el("operations-status"), !operations ? "Mesure non disponible." : operations.status === "ready" ? "Signal de service : disponible." : "Signal de service : indisponible.");
  el("operations-status").classList.toggle("is-error", operations?.status === "unavailable");
  if (!operations) return;
  el("operations-database").replaceChildren(detail("Base de données", databaseStateNames[operations.database.state]), detail("Dernier contrôle de la base", "{date}", { date: observedDate(operations.database.checkedAt) }));
  const workers = operations.workers.map((worker) => {
    const item = node("li", undefined, "operation-item");
    const heading = node("div", undefined, "operation-heading"); heading.append(node("h4", operationNames[worker.name]), node("span", workerStateNames[worker.state], "feature-status"));
    const counts = node("dl", undefined, "operation-counts");
    counts.append(detail("Traités", "{count}", { count: ui.numberParam(worker.processed) }), detail("Échecs", "{count}", { count: ui.numberParam(worker.failures) }), detail("Échecs consécutifs", "{count}", { count: ui.numberParam(worker.consecutiveFailures) }));
    item.append(heading, counts, node("p", "Dernier cycle terminé : {completed}. Dernière erreur : {error}.", "small-copy", { completed: observedDate(worker.lastCompletedAt), error: observedDate(worker.lastErrorAt) }));
    return item;
  });
  el("operations-workers").replaceChildren(...workers);
  if (!workers.length) el("operations-workers").append(node("li", "Aucun traitement suivi dans cette mesure.", "small-copy"));
  const queues = operations.queues.map((queue) => {
    const item = node("li", undefined, "operation-item"); item.append(node("h4", operationNames[queue.name]));
    const counts = node("dl", undefined, "operation-counts");
    for (const [key, name] of [["pending", "En attente"], ["sending", "En traitement"], ["failed", "En échec"]]) {
      const value = queue[key]; counts.append(detail(name, value.truncated ? "au moins {count}" : "{count}", { count: ui.numberParam(value.count) }));
    }
    item.append(counts);
    const delay = queueDelayMinutes(queue.oldestDueAt, operations.queuesCheckedAt);
    const suffix = delay === null ? ui.messageParam(" Ancienneté non mesurée.") : queue.oldestDueAt > operations.queuesCheckedAt ? ui.messageParam(" Échéance à venir au moment de la mesure.") : ui.messageParam(" Retard planifié à la mesure : {minutes} min.", { minutes: ui.numberParam(delay) });
    item.append(queue.oldestDueAt === null ? node("p", "Plus ancienne échéance en attente : non disponible.", "small-copy") : node("p", "Plus ancienne échéance en attente : {date}.{delay}", "small-copy", { date: observedDate(queue.oldestDueAt), delay: suffix }));
    return item;
  });
  el("operations-queues").replaceChildren(...queues);
  if (!queues.length) el("operations-queues").append(node("li", "Aucune file suivie dans cette mesure.", "small-copy"));
  ui.text(el("operations-sample"), "Mesure des files : {date}. Les mesures sont mises à jour périodiquement ; « Actualiser la page » recharge le dernier instantané disponible.", { date: observedDate(operations.queuesCheckedAt) });
}
function clearPrivate(isVisible = false) {
  for (const controller of controllers) controller.abort(); controllers.clear();
  reportTask = null;
  cancelSessionCheck?.(); cancelSessionCheck = null; sessionPaused = false; clearReadiness(state, { visible: isVisible }); clearDisplay();
}
function signOut() { clearPrivate(); location.replace("/admin/login"); }
function stale() { return Object.assign(new Error("stale_response"), { stale: true }); }
async function request(path, { ticket = readinessTicket(state), csrf = null, timeout = 15000 } = {}) {
  const controller = new AbortController(); controllers.add(controller);
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(path, { method: csrf === null ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: csrf === null ? {} : { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: csrf === null ? undefined : "{}" });
    let data; try { data = await response.json(); } catch { data = {}; }
    if (!currentReadiness(state, ticket) || !visible()) throw stale();
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status, code: data.error });
    return data;
  } catch (error) {
    if (!currentReadiness(state, ticket) || !visible()) throw stale();
    throw error;
  } finally { clearTimeout(timer); controllers.delete(controller); }
}
function render() {
  const summary = state.summary;
  if (!state.visible || !state.session || !summary || !visible() || sessionPaused) return;
  el("readiness-content").hidden = false; el("logout").hidden = false;
  el("refresh").hidden = false; el("refresh").disabled = state.busy;
  ui.rawText(el("mail-sender"), summary.mail.sender);
  ui.text(el("mail-status"), summary.mail.configured
    ? "L’envoi d’e-mails est configuré. Tu peux vérifier sa connexion en cas de problème ou après un changement de réglages."
    : "L’envoi d’e-mails reste à configurer dans les réglages privés du serveur. La vérification sera disponible ensuite.");
  el("verify-smtp").hidden = !summary.mail.configured;
  el("verify-smtp").disabled = state.busy;
  ui.text(el("verify-smtp"), state.busy ? "Vérification en cours…" : "Vérifier la connexion e-mail");
  const rows = [];
  for (const [key, name] of Object.entries(featureNames)) {
    const row = document.createElement("li"); const label = document.createElement("span"); const status = document.createElement("span");
    ui.text(label, name); status.className = "feature-status"; status.classList.toggle("enabled", summary.features[key]);
    ui.text(status, summary.features[key] ? "Activée" : "Non activée"); row.append(label, status); rows.push(row);
  }
  el("feature-list").replaceChildren(...rows);
  renderOperations(summary.operations);
  el("release-details").hidden = true; el("release-details").replaceChildren();
  if (summary.release) {
    const release = summary.release;
    el("operations-details").hidden = false;
    el("release-details").hidden = false;
    el("release-details").replaceChildren(
      detail("Version de l’application", "{value}", { value: release.version ?? ui.messageParam("Non identifiée") }),
      detail("Commit au démarrage", "{value}", { value: release.commit ?? ui.messageParam("Non identifié") }),
      detail("Version Node.js", "{value}", { value: release.nodeVersion }),
      detail("Relevé au démarrage", "{date}", { date: ui.dateParam(release.startedAt) }));
  }
  el("download-operations").hidden = !summary.operations;
  el("download-operations").disabled = state.busy || reportTask !== null;
  if (state.proof) {
    notice("Connexion chiffrée et authentification réussies. Aucun e-mail n’a été envoyé.", false, "smtp-status");
    ui.text(el("smtp-proof-date"), "Vérification de cette session : {date}.", { date: ui.dateParam(state.proof.checkedAt) });
    el("smtp-proof-date").hidden = false;
  } else { el("smtp-proof-date").textContent = ""; el("smtp-proof-date").hidden = true; }
}
function armExpiry(retry = false) {
  cancelSessionCheck?.();
  if (!state.session || !visible()) { cancelSessionCheck = null; return; }
  const ticket = readinessTicket(state);
  cancelSessionCheck = globalThis.JessieSessionClock.scheduleSessionCheck(retry ? Date.now() + 30000 : state.session.expiresAt, () => { void checkSession(ticket); }, { maxDelayMs: retry ? 30000 : 300000 });
}
async function checkSession(ticket) {
  if (!currentReadiness(state, ticket) || !visible()) return;
  try {
    const session = await request("/api/auth/session", { ticket });
    if (!acceptAdminSession(state, ticket, session)) {
      if (state.visible) await bootstrap(); else signOut();
      return;
    }
    const wasPaused = sessionPaused; sessionPaused = false; armExpiry();
    if (wasPaused) { notice(""); render(); }
  } catch (error) {
    if (error.stale) return;
    if (error.status === 401) { signOut(); return; }
    sessionPaused = true; el("readiness-content").hidden = true; el("refresh").hidden = false;
    notice("L’état du service est momentanément indisponible. Actualise la page pour réessayer.", true);
    armExpiry(true);
  }
}
async function bootstrap(message = "") {
  if (!visible()) return;
  clearPrivate(true); notice("Vérification de la connexion…"); const ticket = readinessTicket(state);
  try {
    const session = await request("/api/auth/session", { ticket });
    if (!acceptAdminSession(state, ticket, session)) { signOut(); return; }
    armExpiry();
    const summaryTicket = readinessTicket(state);
    const summary = await request("/api/admin/readiness", { ticket: summaryTicket });
    // A cookie can change between the proof and this private read. Adopt the
    // snapshot only after the same account and login have been proved again.
    const finalSession = await request("/api/auth/session", { ticket: summaryTicket });
    if (!acceptAdminSession(state, summaryTicket, finalSession)) {
      if (state.visible) await bootstrap(); else signOut();
      return;
    }
    armExpiry();
    if (!acceptReadinessSummary(state, summaryTicket, summary)) return;
    notice(message); render();
  } catch (error) {
    if (error.stale) return;
    if (error.status === 401) { signOut(); return; }
    clearDisplay(); notice(error.status === 429 ? "Trop de demandes. Patiente un moment avant d’actualiser." : "L’état du service est momentanément indisponible. Actualise la page pour réessayer.", true);
    el("refresh").hidden = false;
  }
}
async function verify() {
  const ticket = beginSmtpCheck(state); if (!ticket) return;
  notice("Connexion sécurisée en cours de vérification… Aucun e-mail n’est envoyé.", false, "smtp-status"); render();
  try {
    // The explicit click authorizes one check. Refreshing a CSRF token never
    // repeats the SMTP action, and a different session requires a new click.
    const session = await request("/api/auth/session", { ticket });
    if (!acceptAdminSession(state, ticket, session)) {
      if (state.visible) await bootstrap("La session a changé. Clique de nouveau pour vérifier la connexion e-mail.");
      else signOut();
      return;
    }
    armExpiry();
    const proof = await request("/api/admin/readiness/smtp", { ticket, csrf: state.session.csrf, timeout: 30000 });
    // Another tab may have replaced the browser's cookie while the server was
    // checking the original session. Attach proof only to the current login.
    const finalSession = await request("/api/auth/session", { ticket });
    if (!acceptAdminSession(state, ticket, finalSession)) {
      if (state.visible) await bootstrap("La session a changé. Clique de nouveau pour vérifier la connexion e-mail.");
      else signOut();
      return;
    }
    armExpiry();
    if (acceptSmtpProof(state, ticket, proof)) render();
  } catch (error) {
    if (error.stale) return;
    if (error.status === 401) { signOut(); return; }
    const csrfFailed = error.status === 403 && error.code === "csrf_failed";
    if (!rejectSmtpCheck(state, ticket, { csrfFailed })) return;
    if (csrfFailed) { await bootstrap("Ta connexion a été actualisée. Clique de nouveau pour vérifier la connexion e-mail."); return; }
    let text = "La connexion e-mail n’a pas pu être vérifiée. Réessaie dans un moment.";
    if (error.status === 429) text = "Une vérification est déjà en cours ou la limite de demandes est atteinte. Patiente avant de réessayer.";
    else if (error.status === 409) text = "L’envoi d’e-mails n’est pas activé pour le moment. Actualise la page après sa configuration.";
    else if (error.status === 403) text = "Cette vérification n’est pas autorisée pour le moment. Actualise la page avant de réessayer.";
    notice(text, true, "smtp-status"); render();
  }
}
async function downloadOperations() {
  if (reportTask || !visible() || sessionPaused || !state.visible || !state.session || !state.summary?.operations || state.busy) return;
  const task = { ticket: readinessTicket(state) }; reportTask = task; render();
  notice("Préparation du diagnostic…", false, "operations-download-status");
  try {
    const session = await request("/api/auth/session", { ticket: task.ticket });
    if (!acceptAdminSession(state, task.ticket, session)) {
      if (state.visible) await bootstrap("La session a changé. Recommence le téléchargement du diagnostic."); else signOut();
      return;
    }
    const summary = await request("/api/admin/readiness", { ticket: task.ticket });
    const finalSession = await request("/api/auth/session", { ticket: task.ticket });
    if (!acceptAdminSession(state, task.ticket, finalSession)) {
      if (state.visible) await bootstrap("La session a changé. Recommence le téléchargement du diagnostic."); else signOut();
      return;
    }
    if (reportTask !== task || sessionPaused || !acceptReadinessSummary(state, task.ticket, summary)) return;
    if (state.busy || !state.summary.operations) throw new TypeError("operations_report_unavailable");
    armExpiry();
    const text = formatOperationsReport(state.summary.operations, { translate: (source, values) => ui.t(source, values) });
    // Small fixed-field plaintext: no Blob URL, browser storage or upload.
    const link = document.createElement("a");
    link.href = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
    link.download = "JessieMessage-diagnostic.txt"; link.hidden = true;
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
    notice("Le téléchargement du diagnostic a été lancé.", false, "operations-download-status");
  } catch (error) {
    if (error.stale) return;
    if (error.status === 401) { signOut(); return; }
    notice("Le diagnostic n’a pas pu être préparé. Actualise la page puis réessaie.", true, "operations-download-status");
  } finally {
    if (reportTask === task) { reportTask = null; render(); }
  }
}
async function logout() {
  if (logoutBusy || !state.session || !visible()) return;
  logoutBusy = true; const csrf = state.session.csrf; clearPrivate(); const epoch = state.epoch;
  notice("Déconnexion en cours…"); const controller = new AbortController(); controllers.add(controller); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" });
    if (epoch !== state.epoch || !visible()) return;
    if (response.ok || response.status === 401) { signOut(); return; }
    await bootstrap("La déconnexion n’a pas été confirmée. Réessaie de te déconnecter.");
  } catch {
    if (epoch === state.epoch && visible()) await bootstrap("La déconnexion n’a pas été confirmée. Réessaie de te déconnecter.");
  } finally { clearTimeout(timer); controllers.delete(controller); logoutBusy = false; }
}
el("verify-smtp").addEventListener("click", () => { void verify(); });
el("download-operations").addEventListener("click", () => { void downloadOperations(); });
el("refresh").addEventListener("click", () => { void bootstrap(); });
el("logout").addEventListener("click", () => { void logout(); });
document.addEventListener("visibilitychange", () => { if (visible()) void bootstrap(); else clearPrivate(); });
window.addEventListener("pagehide", () => clearPrivate());
window.addEventListener("pageshow", (event) => { if (event.persisted && visible()) void bootstrap(); });
window.addEventListener("online", () => { if (visible() && sessionPaused) void checkSession(readinessTicket(state)); });
if (visible()) void bootstrap(); else clearPrivate();
