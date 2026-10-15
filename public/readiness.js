import { createReadinessState, clearReadiness, readinessTicket, currentReadiness, acceptAdminSession, acceptReadinessSummary, beginSmtpCheck, acceptSmtpProof, rejectSmtpCheck, featureNames, operationNames, databaseStateNames, workerStateNames, queueCountText, queueDelayMinutes } from "/readiness-model.js";

const el = (id) => document.getElementById(id);
const state = createReadinessState();
const controllers = new Set();
let expiryTimer = null; let logoutBusy = false;
const visible = () => document.visibilityState === "visible";
function notice(text, error = false, id = "session-status") {
  const node = el(id); node.textContent = text; node.classList.toggle("is-error", error);
}
function clearDisplay() {
  el("readiness-content").hidden = true; el("logout").hidden = true; el("refresh").hidden = true;
  el("refresh").disabled = false;
  el("mail-sender").textContent = ""; el("mail-status").textContent = ""; el("feature-list").replaceChildren();
  el("operations-details").hidden = true; el("operations-status").textContent = ""; el("operations-sample").textContent = "";
  for (const id of ["operations-database", "operations-workers", "operations-queues"]) el(id).replaceChildren();
  el("smtp-proof-date").textContent = ""; el("smtp-proof-date").hidden = true; el("verify-smtp").hidden = true;
  el("verify-smtp").disabled = false; el("verify-smtp").textContent = "Vérifier la connexion e-mail";
  notice(""); notice("", false, "smtp-status");
}
const node = (tag, text, className = "") => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };
const observedDate = (value) => value === null ? "aucune mesure disponible" : new Date(value).toLocaleString("fr-FR");
function detail(label, value) { const row = node("div"); row.append(node("dt", label), node("dd", value)); return row; }
function renderOperations(operations) {
  el("operations-details").hidden = !operations;
  el("operations-status").textContent = !operations ? "Mesure non disponible." : operations.status === "ready" ? "Signal de service : disponible." : "Signal de service : indisponible.";
  el("operations-status").classList.toggle("is-error", operations?.status === "unavailable");
  if (!operations) return;
  el("operations-database").replaceChildren(detail("Base de données", databaseStateNames[operations.database.state]), detail("Dernier contrôle de la base", observedDate(operations.database.checkedAt)));
  const workers = operations.workers.map((worker) => {
    const item = node("li", undefined, "operation-item");
    const heading = node("div", undefined, "operation-heading"); heading.append(node("h4", operationNames[worker.name]), node("span", workerStateNames[worker.state], "feature-status"));
    const counts = node("dl", undefined, "operation-counts");
    counts.append(detail("Traités", worker.processed.toLocaleString("fr-FR")), detail("Échecs", worker.failures.toLocaleString("fr-FR")), detail("Échecs consécutifs", worker.consecutiveFailures.toLocaleString("fr-FR")));
    item.append(heading, counts, node("p", `Dernier cycle terminé : ${observedDate(worker.lastCompletedAt)}. Dernière erreur : ${observedDate(worker.lastErrorAt)}.`, "small-copy"));
    return item;
  });
  el("operations-workers").replaceChildren(...workers);
  if (!workers.length) el("operations-workers").append(node("li", "Aucun traitement suivi dans cette mesure.", "small-copy"));
  const queues = operations.queues.map((queue) => {
    const item = node("li", undefined, "operation-item"); item.append(node("h4", operationNames[queue.name]));
    const counts = node("dl", undefined, "operation-counts");
    for (const [key, name] of [["pending", "En attente"], ["sending", "En traitement"], ["failed", "En échec"]]) counts.append(detail(name, queueCountText(queue[key])));
    item.append(counts);
    const delay = queueDelayMinutes(queue.oldestDueAt, operations.queuesCheckedAt);
    item.append(node("p", queue.oldestDueAt === null ? "Plus ancienne échéance en attente : non disponible." : `Plus ancienne échéance en attente : ${observedDate(queue.oldestDueAt)}.${delay === null ? " Ancienneté non mesurée." : queue.oldestDueAt > operations.queuesCheckedAt ? " Échéance à venir au moment de la mesure." : ` Retard planifié à la mesure : ${delay.toLocaleString("fr-FR")} min.`}`, "small-copy"));
    return item;
  });
  el("operations-queues").replaceChildren(...queues);
  if (!queues.length) el("operations-queues").append(node("li", "Aucune file suivie dans cette mesure.", "small-copy"));
  el("operations-sample").textContent = `Mesure des files : ${observedDate(operations.queuesCheckedAt)}. Les mesures sont mises à jour périodiquement ; « Actualiser la page » recharge le dernier instantané disponible.`;
}
function clearPrivate(isVisible = false) {
  for (const controller of controllers) controller.abort(); controllers.clear();
  clearTimeout(expiryTimer); expiryTimer = null; clearReadiness(state, { visible: isVisible }); clearDisplay();
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
  if (!state.visible || !state.session || !summary || !visible()) return;
  el("readiness-content").hidden = false; el("logout").hidden = false;
  el("refresh").hidden = false; el("refresh").disabled = state.busy;
  el("mail-sender").textContent = summary.mail.sender;
  el("mail-status").textContent = summary.mail.configured
    ? "L’envoi d’e-mails est configuré. Tu peux vérifier sa connexion avant de tester la réception."
    : "L’envoi d’e-mails reste à configurer dans les réglages privés du serveur. La vérification sera disponible ensuite.";
  el("verify-smtp").hidden = !summary.mail.configured;
  el("verify-smtp").disabled = state.busy;
  el("verify-smtp").textContent = state.busy ? "Vérification en cours…" : "Vérifier la connexion e-mail";
  const rows = [];
  for (const [key, name] of Object.entries(featureNames)) {
    const row = document.createElement("li"); const label = document.createElement("span"); const status = document.createElement("span");
    label.textContent = name; status.className = "feature-status"; status.classList.toggle("enabled", summary.features[key]);
    status.textContent = summary.features[key] ? "Activée" : "Non activée"; row.append(label, status); rows.push(row);
  }
  el("feature-list").replaceChildren(...rows);
  renderOperations(summary.operations);
  if (state.proof) {
    notice("Connexion chiffrée et authentification réussies. La réception d’un e-mail reste à tester.", false, "smtp-status");
    el("smtp-proof-date").textContent = `Vérification de cette session : ${new Date(state.proof.checkedAt).toLocaleString("fr-FR")}.`;
    el("smtp-proof-date").hidden = false;
  } else { el("smtp-proof-date").textContent = ""; el("smtp-proof-date").hidden = true; }
}
function armExpiry() {
  clearTimeout(expiryTimer); expiryTimer = setTimeout(signOut, Math.max(0, Math.min(2147483647, state.session.expiresAt - Date.now())));
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
    if (!acceptReadinessSummary(state, summaryTicket, summary)) return;
    notice(message); render();
  } catch (error) {
    if (error.stale) return;
    if (error.status === 401) { signOut(); return; }
    clearDisplay(); notice(error.status === 429 ? "Trop de demandes. Patiente un moment avant d’actualiser." : "La préparation du site est momentanément indisponible. Actualise la page pour réessayer.", true);
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
el("refresh").addEventListener("click", () => { void bootstrap(); });
el("logout").addEventListener("click", () => { void logout(); });
document.addEventListener("visibilitychange", () => { if (visible()) void bootstrap(); else clearPrivate(); });
window.addEventListener("pagehide", () => clearPrivate());
window.addEventListener("pageshow", (event) => { if (event.persisted && visible()) void bootstrap(); });
if (visible()) void bootstrap(); else clearPrivate();
