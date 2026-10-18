import { createReadinessState, clearReadiness, readinessTicket, currentReadiness, acceptAdminSession } from "/readiness-model.js";

const ui = globalThis.JessieI18n, el = id => document.getElementById(id), state = createReadinessState();
const controllers = new Set(), blobs = new Set(); let summary = null, busy = false, cancelCheck = null;
const visible = () => document.visibilityState === "visible";
const kinds = { computer: "Ordinateur Windows", synced_folder: "Dossier synchronisé avec un drive", server: "Serveur ou partage réseau" };
const node = (tag, text, className = "") => { const element = document.createElement(tag); if (text) ui.text(element, text); element.className = className; return element; };
const notice = (text, error = false) => { ui.text(el("backup-status"), text); el("backup-status").classList.toggle("is-error", error); };
const stale = () => Object.assign(new Error("stale"), { stale: true });
function clear() {
  clearReadiness(state); summary = null; busy = false; cancelCheck?.(); cancelCheck = null;
  for (const controller of controllers) controller.abort(); controllers.clear();
  for (const url of blobs) URL.revokeObjectURL(url); blobs.clear();
  el("backup-content").hidden = true; el("destinations").replaceChildren(); el("capture-details").replaceChildren(); notice("");
}
function signOut() { clear(); location.replace("/admin/login"); }
async function request(path, { body, ticket = readinessTicket(state), zip = false } = {}) {
  const controller = new AbortController(); controllers.add(controller); const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": state.session?.csrf ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data;
    if (response.ok && zip) {
      if (response.headers.get("content-type") !== "application/zip") throw new Error("invalid_kit");
      data = await response.blob(); if (data.size > 131072) throw new Error("invalid_kit");
    } else { try { data = await response.json(); } catch { data = {}; } }
    if (!visible() || !currentReadiness(state, ticket)) throw stale();
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status, code: data.error });
    return data;
  } catch (error) { if (!visible() || !currentReadiness(state, ticket)) throw stale(); throw error; }
  finally { clearTimeout(timer); controllers.delete(controller); }
}
async function prove(ticket) {
  const session = await request("/api/auth/session", { ticket });
  if (!acceptAdminSession(state, ticket, session)) { if (!state.visible) signOut(); throw stale(); }
}
function arm() {
  cancelCheck?.();
  cancelCheck = globalThis.JessieSessionClock.scheduleSessionCheck(state.session.expiresAt, async () => {
    const ticket = readinessTicket(state);
    try { await prove(ticket); arm(); }
    catch (error) {
      if (error.stale) { if (visible() && state.visible && !state.session) void bootstrap("La session a changé. Recommence l’action."); return; }
      if (error.status === 401) signOut(); else { clear(); notice("Les sauvegardes sont momentanément indisponibles. Actualise la page.", true); }
    }
  }, { maxDelayMs: 300000 });
}
function detail(label, value) { const row = node("div"); row.append(node("dt", label)); const text = node("dd"); text.textContent = value; row.append(text); return row; }
const date = value => value === null ? ui.t("Pas encore reçu") : new Date(value).toLocaleString(ui.getLanguage() === "en" ? "en-GB" : "fr-FR");
function field(form, label, value, choices = null) {
  const id = `setting-${form.dataset.id}-${label === "Emplacement" ? "kind" : "label"}`, heading = node("label", label); heading.htmlFor = id;
  const input = document.createElement(choices ? "select" : "input"); input.id = id; input.name = choices ? "kind" : "label";
  if (choices) for (const [key, title] of Object.entries(choices)) { const option = node("option", title); option.value = key; input.append(option); }
  else { input.maxLength = 64; input.required = true; input.autocomplete = "off"; }
  input.value = value; form.append(heading, input); return input;
}
function action(text, callback, className = "secondary") { const button = node("button", text, `button ${className}`); button.type = "button"; button.addEventListener("click", callback); return button; }
function destination(item) {
  const card = node("article", undefined, "card destination"); card.dataset.id = item.id;
  const heading = node("div", undefined, "destination-heading"), title = node("h3"); title.textContent = item.label;
  const current = item.lastReceipt && summary.latestArchive && item.lastReceipt.captureId === summary.latestArchive.id && item.lastReceipt.sha256 === summary.latestArchive.sha256;
  const status = !item.enabled ? "Copies suspendues" : !item.paired ? "À raccorder" : current ? "Dernière archive copiée" : "Copie en attente";
  heading.append(title, node("span", status, `copy-badge${current && item.enabled ? " current" : ""}`)); card.append(heading);
  const details = node("dl", undefined, "backup-details"); details.append(detail("Emplacement", ui.t(kinds[item.kind])), detail("Dernier contact du PC", date(item.lastSeenAt)), detail("Dernier reçu de copie vérifiée", date(item.lastReceipt?.receivedAt ?? null)));
  card.append(details);
  const actions = node("div", undefined, "backup-actions");
  const kit = action("Raccorder Windows", () => void perform(`/api/admin/backups/destinations/${item.id}/windows-kit`, {}, "JessieMessage-sauvegardes-Windows.zip"), "primary"); kit.dataset.action = "kit";
  const toggle = action(item.enabled ? "Suspendre les copies" : "Reprendre les copies", () => void perform(`/api/admin/backups/destinations/${item.id}/settings`, { label: item.label, kind: item.kind, enabled: !item.enabled }));
  toggle.dataset.action = "toggle"; actions.append(kit, toggle); card.append(actions);
  card.append(node("p", "Un nouveau raccordement remplace l’autorisation de l’appareil précédent lorsqu’il aboutit. Le kit est personnel et valable 15 minutes.", "small-copy"));
  const settings = node("details", undefined, "destination-settings"); settings.append(node("summary", "Modifier la destination"));
  const form = node("form"); form.dataset.id = item.id;
  const label = field(form, "Nom de la destination", item.label), kind = field(form, "Emplacement", item.kind, kinds);
  form.append(node("p", "Le dossier se choisit sur le PC avec le raccourci JessieMessage — Sauvegardes. Pour un autre appareil, télécharge son kit depuis cette carte.", "small-copy"));
  const save = node("button", "Enregistrer", "button primary"); save.type = "submit"; form.append(save);
  form.addEventListener("submit", event => { event.preventDefault(); void perform(`/api/admin/backups/destinations/${item.id}/settings`, { label: label.value.trim(), kind: kind.value, enabled: item.enabled }); }); settings.append(form);
  const revoke = node("details", undefined, "revoke-panel"); revoke.append(node("summary", "Révoquer cette destination"), node("p", "Le droit de copie sera retiré. Les fichiers déjà copiés resteront sur l’appareil.", "small-copy"), action("Confirmer la révocation", () => void perform(`/api/admin/backups/destinations/${item.id}/revoke`, {})));
  settings.append(revoke); card.append(settings); return card;
}
function render() {
  if (!summary || !state.session || !visible()) return;
  el("backup-content").hidden = false;
  const schedule = summary.schedule, time = `${String(schedule.hourUtc).padStart(2, "0")}:${String(schedule.minuteUtc).padStart(2, "0")} UTC`;
  el("capture-details").replaceChildren(detail("Prochaine capture quotidienne", schedule.enabled ? time : ui.t("Suspendue")), detail("Dernière archive chiffrée", date(summary.latestArchive?.startedAt ?? null)), detail("Archives disponibles", String(summary.archiveCount)));
  el("verify-archive").disabled = !summary.latestArchive;
  el("destinations").replaceChildren(...summary.destinations.map(destination));
  if (!summary.destinations.length) el("destinations").append(node("p", "Ajoute une destination pour recevoir les copies hors du site.", "body-copy"));
  el("add-form").querySelector('button[type="submit"]').disabled = summary.destinations.length >= 5;
}
async function bootstrap(message = "") {
  if (!visible()) return;
  clear(); clearReadiness(state, { visible: true }); const ticket = readinessTicket(state); notice("Vérification de la connexion…");
  try {
    await prove(ticket); const value = await request("/api/admin/backups", { ticket }); await prove(ticket);
    if (value?.version !== 1 || !Array.isArray(value.destinations) || value.destinations.length > 5 || !value.schedule) throw new Error("invalid_summary");
    summary = value; render(); arm(); notice(message);
  } catch (error) {
    if (error.stale) { if (visible() && state.visible && !state.session) void bootstrap(); return; }
    if (error.status === 401) { signOut(); return; }
    clear(); notice("Les sauvegardes sont momentanément indisponibles. Actualise la page.", true);
  }
}
async function perform(path, body, download = null) {
  if (busy || !state.session || !visible()) return;
  busy = true; const ticket = readinessTicket(state);
  for (const button of el("backup-content").querySelectorAll("button")) button.disabled = true;
  notice("Enregistrement en cours…");
  try {
    await prove(ticket); const result = await request(path, { ticket, body, zip: download !== null }); await prove(ticket);
    if (download) {
      const url = URL.createObjectURL(result); blobs.add(url); const link = document.createElement("a"); link.href = url; link.download = download;
      document.body.append(link); try { link.click(); } finally { link.remove(); }
      // Revoke at the next private clear or after download startup.
      setTimeout(() => { URL.revokeObjectURL(url); blobs.delete(url); }, 5000);
      render(); notice(download === "JessieMessage-verifier-Windows.zip"
        ? "Vérification téléchargée. Extrais le ZIP puis ouvre Verifier.cmd sur le PC qui contient la copie et ta clé GPG."
        : "Kit téléchargé. Extrais le ZIP puis ouvre Installer.cmd sur le PC choisi."); return;
    }
    await bootstrap("Réglages enregistrés.");
  } catch (error) {
    if (error.stale) { if (visible()) void bootstrap("La session a changé. Recommence l’action."); return; }
    if (error.status === 401) { signOut(); return; }
    await bootstrap(error.status === 429 ? "Trop de demandes. Patiente une minute puis réessaie." : "L’action n’est pas confirmée. Vérifie l’état affiché avant de réessayer.");
  } finally { busy = false; }
}
el("refresh").addEventListener("click", () => { if (!busy) void bootstrap(); });
el("verify-archive").addEventListener("click", () => {
  if (summary?.latestArchive) void perform("/api/admin/backups/verification-kit", { captureId: summary.latestArchive.id }, "JessieMessage-verifier-Windows.zip");
});
el("add-form").addEventListener("submit", event => { event.preventDefault(); void perform("/api/admin/backups/destinations", { label: el("destination-label").value.trim(), kind: el("destination-kind").value }); });
document.addEventListener("visibilitychange", () => { if (visible()) void bootstrap(); else clear(); });
window.addEventListener("pagehide", clear); window.addEventListener("pageshow", event => { if (event.persisted && visible()) void bootstrap(); });
ui.onChange(() => { if (!busy) render(); });
if (visible()) void bootstrap();
