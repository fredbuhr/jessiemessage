import { createReadinessState, clearReadiness, readinessTicket, currentReadiness, acceptAdminSession } from "/readiness-model.js";

const ui = globalThis.JessieI18n, el = id => document.getElementById(id), state = createReadinessState();
const controllers = new Set(), REQUEST_ID = /^[0-9a-f]{32}$/, CAPTURE_ID = /^capture-[0-9]{1,15}-[0-9a-f]{16}$/;
const codes = [null, "EXPIRED", "INTERRUPTED", "PREFLIGHT_FAILED", "CAPTURE_FAILED", "CANCELLED"];
let summary = null, busy = false, pending = null, knownActive = false, pollTimer = null, cancelCheck = null;
const visible = () => document.visibilityState === "visible";
const stale = () => Object.assign(new Error("stale"), { stale: true });
const active = request => ["queued", "running"].includes(request?.status);
const waiting = () => pending !== null || knownActive;
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
const notice = (text, error = false) => { ui.text(el("backup-status"), text); el("backup-status").classList.toggle("is-error", error); };

function parseRequest(value) {
  if (value === null) return null;
  if (!value || value.version !== 1 || !REQUEST_ID.test(value.requestId) || !["queued", "running", "complete", "failed"].includes(value.status)
    || !timestamp(value.requestedAt) || !(value.startedAt === null || timestamp(value.startedAt))
    || !(value.finishedAt === null || timestamp(value.finishedAt)) || !(value.captureId === null || CAPTURE_ID.test(value.captureId))
    || !codes.includes(value.code) || value.status === "complete" && (value.captureId === null || value.finishedAt === null)
    || value.status === "failed" && (value.finishedAt === null || value.code === null)) throw new Error("invalid_backup_request");
  return { version: 1, requestId: value.requestId, status: value.status, requestedAt: value.requestedAt, startedAt: value.startedAt,
    finishedAt: value.finishedAt, captureId: value.captureId, code: value.code };
}
function parseSummary(value) {
  const archive = value?.latestArchive;
  if (value?.version !== 1 || value.mode !== "manual" || !timestamp(value.checkedAt)
    || !Number.isSafeInteger(value.archiveCount) || value.archiveCount < 0 || !Array.isArray(value.archives)
    || !(archive === null || archive && CAPTURE_ID.test(archive.id) && timestamp(archive.startedAt)
      && Number.isSafeInteger(archive.bytes) && archive.bytes > 0 && /^[0-9a-f]{64}$/.test(archive.sha256)
      && archive.filename === `JessieMessage-${archive.id}.tar.gz.gpg`)) throw new Error("invalid_backup_summary");
  return { request: parseRequest(value.request), latestArchive: archive === null ? null : { id: archive.id, startedAt: archive.startedAt, bytes: archive.bytes, filename: archive.filename } };
}
function clearPrivate() {
  clearReadiness(state); summary = null; busy = false;
  clearTimeout(pollTimer); pollTimer = null; cancelCheck?.(); cancelCheck = null;
  for (const controller of controllers) controller.abort(); controllers.clear();
  el("backup-content").hidden = true; el("capture-details").replaceChildren(); el("archive-details").replaceChildren();
  ui.rawText(el("capture-state"), ""); el("capture-state").classList.remove("is-error");
  el("download-backup").hidden = true; el("download-backup").disabled = true; el("create-backup").disabled = true;
  el("refresh").disabled = false; notice("");
}
function signOut() { pending = null; knownActive = false; clearPrivate(); location.replace("/admin/login?continue=%2Fadmin%2Fbackups"); }
async function request(path, { body, ticket = readinessTicket(state) } = {}) {
  if (!visible() || !currentReadiness(state, ticket)) throw stale();
  const controller = new AbortController(); controllers.add(controller); const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": state.session?.csrf ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data; try { data = await response.json(); } catch { data = null; }
    if (!visible() || !currentReadiness(state, ticket)) throw stale();
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status, code: data?.error });
    return data;
  } catch (error) { if (!visible() || !currentReadiness(state, ticket)) throw stale(); throw error; }
  finally { clearTimeout(timer); controllers.delete(controller); }
}
async function prove(ticket) {
  const session = await request("/api/auth/session", { ticket });
  if (!currentReadiness(state, ticket)) throw stale();
  if (!acceptAdminSession(state, ticket, session)) {
    pending = null; knownActive = false;
    if (!state.visible) signOut();
    else if (visible()) void bootstrap("La session a changé. Cet écran correspond à ta session actuelle.");
    throw stale();
  }
  if (pending && (pending.adminId !== state.session.id || pending.csrf !== state.session.csrf)) { pending = null; knownActive = false; }
}
function poll() {
  clearTimeout(pollTimer); pollTimer = null;
  if (visible() && waiting()) pollTimer = setTimeout(() => { pollTimer = null; void bootstrap(); }, 5000);
}
function arm() {
  cancelCheck?.();
  cancelCheck = globalThis.JessieSessionClock.scheduleSessionCheck(state.session.expiresAt, async () => {
    if (!busy && visible()) await bootstrap();
  }, { maxDelayMs: 300000 });
}
function detail(label, value) {
  const row = document.createElement("div"), title = document.createElement("dt"), text = document.createElement("dd");
  ui.text(title, label); ui.rawText(text, value); row.append(title, text); return row;
}
const date = value => new Date(value).toLocaleString(ui.getLanguage() === "en" ? "en-GB" : "fr-FR", { dateStyle: "medium", timeStyle: "short" });
function captureText(value) {
  if (!value) return pending ? "Le résultat de la demande n’est pas encore confirmé. Son état sera vérifié sans créer une autre sauvegarde." : "Aucune sauvegarde demandée pour le moment.";
  if (value.status === "queued") return "Demande de sauvegarde en attente.";
  if (value.status === "running") return "Sauvegarde en cours. La messagerie peut être momentanément indisponible.";
  if (value.status === "complete") return "Sauvegarde terminée.";
  return { EXPIRED: "La demande a expiré avant son démarrage. Tu peux faire une nouvelle demande.",
    INTERRUPTED: "La sauvegarde a été interrompue. Tu peux faire une nouvelle demande.",
    PREFLIGHT_FAILED: "La préparation a échoué. Réessaie plus tard ou contacte l’administrateur du service.",
    CANCELLED: "La demande a été annulée. Tu peux faire une nouvelle demande." }[value.code] ?? "La sauvegarde n’a pas abouti. Tu peux faire une nouvelle demande.";
}
function acceptSummary(value) {
  summary = parseSummary(value); knownActive = active(summary.request);
  // Only durable state resolves a lost acknowledgement. A newer request also
  // prevents replaying an identifier that the server no longer considers current.
  if (pending && summary.request && (summary.request.requestId !== pending.requestId || !active(summary.request))) pending = null;
}
function render() {
  if (!summary || !state.session || !visible()) return;
  el("backup-content").hidden = false;
  ui.text(el("capture-state"), captureText(summary.request)); el("capture-state").classList.toggle("is-error", summary.request?.status === "failed");
  const captureDetails = summary.request ? [detail("Demande envoyée le", date(summary.request.requestedAt))] : [];
  if (summary.request?.status === "complete") captureDetails.push(detail("Sauvegarde terminée le", date(summary.request.finishedAt)));
  el("capture-details").replaceChildren(...captureDetails);
  ui.text(el("create-backup"), pending && !active(summary.request) ? "Réessayer la demande" : "Créer une sauvegarde");
  el("create-backup").disabled = busy || active(summary.request); el("refresh").disabled = busy;
  const archive = summary.latestArchive; el("archive-empty").hidden = archive !== null;
  el("archive-details").replaceChildren(...(archive ? [detail("Date de la sauvegarde", date(archive.startedAt)),
    detail("Taille du fichier", ui.t("{size} Mo", { size: ui.numberParam(archive.bytes / 1048576, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) }))] : []));
  el("download-backup").hidden = !archive; el("download-backup").disabled = busy || !archive || active(summary.request);
}
async function bootstrap(message = "") {
  if (!visible()) return;
  clearPrivate(); clearReadiness(state, { visible: true }); const ticket = readinessTicket(state);
  notice(knownActive ? "Sauvegarde en cours. La messagerie peut être momentanément indisponible."
    : pending ? "Le résultat de la demande n’est pas encore confirmé. Son état sera vérifié sans créer une autre sauvegarde." : "Vérification de la connexion…");
  try {
    await prove(ticket); const value = await request("/api/admin/backups", { ticket }); await prove(ticket);
    if (!currentReadiness(state, ticket)) throw stale();
    acceptSummary(value); render(); arm(); notice(message); poll();
  } catch (error) {
    if (error.stale || !currentReadiness(state, ticket)) return;
    if (error.status === 401) { signOut(); return; }
    const interrupted = waiting(); clearPrivate();
    notice(interrupted ? "La connexion est momentanément indisponible. L’état de la sauvegarde sera vérifié à son retour."
      : "Les sauvegardes sont momentanément indisponibles. Actualise l’état dans quelques instants.", !interrupted); poll();
  }
}
async function createBackup() {
  if (busy || !state.session || !summary || active(summary.request) || !visible()) return;
  clearTimeout(pollTimer); pollTimer = null;
  busy = true; const ticket = readinessTicket(state); const previousId = pending?.requestId; render(); notice("Envoi de la demande…");
  try {
    // Refresh durable state before any explicit retry; visibility, timeouts and
    // online events only perform GETs and never submit another capture.
    await prove(ticket); const value = await request("/api/admin/backups", { ticket }); await prove(ticket); acceptSummary(value);
    if (active(summary.request) || previousId && summary.request) { await bootstrap(); return; }
    if (!pending) {
      const bytes = crypto.getRandomValues(new Uint8Array(16)), requestId = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      pending = { requestId, adminId: state.session.id, csrf: state.session.csrf };
    }
    const result = await request("/api/admin/backups/captures", { ticket, body: { requestId: pending.requestId } });
    if (result?.version !== 1 || result.mode !== "manual" || parseRequest(result.request)?.requestId !== pending.requestId) throw new Error("invalid_backup_result");
    await prove(ticket); await bootstrap();
  } catch (error) {
    if (error.stale || !currentReadiness(state, ticket)) return;
    if (error.status === 401) { signOut(); return; }
    if (error.status >= 400 && error.status < 500) {
      pending = null;
      await bootstrap(error.code === "backup_in_progress" ? "Une sauvegarde est déjà demandée. Son état va être actualisé."
        : error.code === "request_changed" ? "La demande a changé. Consulte son état avant une nouvelle action."
        : "La demande a été refusée. Actualise l’état avant de réessayer.");
    } else {
      const uncertain = waiting(); clearPrivate();
      notice(uncertain ? "Le résultat de la demande n’est pas encore confirmé. Son état sera vérifié sans créer une autre sauvegarde."
        : "Les sauvegardes sont momentanément indisponibles. Actualise l’état dans quelques instants.", !uncertain); poll();
    }
  } finally { if (currentReadiness(state, ticket)) { busy = false; render(); arm(); poll(); } }
}
async function downloadBackup() {
  if (busy || !state.session || !summary?.latestArchive || active(summary.request) || !visible()) return;
  clearTimeout(pollTimer); pollTimer = null;
  busy = true; const ticket = readinessTicket(state), archive = summary.latestArchive; render(); notice("Préparation du téléchargement…");
  try {
    await prove(ticket);
    const link = document.createElement("a"); link.href = `/api/admin/backups/archives/${archive.id}`; link.download = archive.filename;
    document.body.append(link); try { link.click(); } finally { link.remove(); }
    notice("Le téléchargement du fichier chiffré a été demandé.");
  } catch (error) {
    if (error.stale || !currentReadiness(state, ticket)) return;
    if (error.status === 401) { signOut(); return; }
    clearPrivate(); notice("Le téléchargement n’a pas pu démarrer. Actualise l’état puis réessaie.", true); poll();
  } finally { if (currentReadiness(state, ticket)) { busy = false; render(); arm(); poll(); } }
}
el("refresh").addEventListener("click", () => { if (!busy) void bootstrap(); });
el("create-backup").addEventListener("click", () => void createBackup());
el("download-backup").addEventListener("click", () => void downloadBackup());
document.addEventListener("visibilitychange", () => { if (visible()) void bootstrap(); else clearPrivate(); });
window.addEventListener("pagehide", clearPrivate);
window.addEventListener("pageshow", event => { if (event.persisted && visible()) void bootstrap(); });
window.addEventListener("online", () => { if (visible() && !busy) void bootstrap(); });
ui.onChange(render);
if (visible()) void bootstrap();
