import { createReadinessState, clearReadiness, readinessTicket, currentReadiness, acceptAdminSession } from "/readiness-model.js";

const ui = globalThis.JessieI18n, el = id => document.getElementById(id), state = createReadinessState();
const phases = { none: "Aucune fermeture demandée", requested: "Demande enregistrée · en attente", prepared: "Compte fermé · effacement des photos en cours", files_erased: "Photos effacées · vérification finale", completed: "Effacement terminé dans l’application" };
const controllers = new Set(), idPattern = /^[a-f0-9]{32}$/;
const query = new URLSearchParams(location.search), selectedId = query.size === 1 && idPattern.test(query.get("client") ?? "") ? query.get("client") : null;
let client = null, selectedPhase = null, busy = false, loading = false, cursor = null, nextCursor = null, pollTimer, cancelSession, uncertain = false, delay = 5000;
const visible = () => document.visibilityState === "visible";
const stale = () => Object.assign(new Error("stale"), { stale: true });
function notice(source, error = false) { ui.text(el("status"), source); el("status").classList.toggle("is-error", error); }
function resetConfirmation() { el("confirmation").value = ""; el("acknowledge").checked = false; el("confirm").disabled = true; ui.rawText(el("confirm-name"), ""); if (el("confirm-dialog").open) el("confirm-dialog").close(); }
function purge() {
  clearReadiness(state); clearTimeout(pollTimer); cancelSession?.(); cancelSession = null;
  for (const controller of controllers) controller.abort(); controllers.clear();
  resetConfirmation(); client = null; selectedPhase = null; busy = false; loading = false; cursor = null; nextCursor = null; uncertain = false; delay = 5000;
  for (const id of ["client-name", "client-reference", "selected-state", "jobs"]) { ui.forget(el(id)); el(id).replaceChildren(); }
  for (const id of ["content", "disabled", "selected", "prepare"]) el(id).hidden = true;
  el("refresh").disabled = false; notice("");
}
async function request(path, { body, ticket = readinessTicket(state) } = {}) {
  const controller = new AbortController(); controllers.add(controller); const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
      headers: body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": state.session?.csrf ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const length = response.headers.get("content-length"); if (length !== null && (!/^\d+$/.test(length) || Number(length) > 65536)) throw new Error("invalid_closure");
    const text = await response.text(); if (text.length > 65536) throw new Error("invalid_closure");
    const value = JSON.parse(text);
    if (!visible() || !currentReadiness(state, ticket)) throw stale();
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status });
    return value;
  } catch (error) { if (!visible() || !currentReadiness(state, ticket)) throw stale(); throw error; }
  finally { clearTimeout(timer); controllers.delete(controller); }
}
async function prove(ticket) {
  const proof = await request("/api/auth/session", { ticket });
  if (!acceptAdminSession(state, ticket, proof)) throw Object.assign(stale(), { accountChanged: true });
}
function closure(value) {
  if (!value || !idPattern.test(value.clientId) || !Object.hasOwn(phases, value.phase)
    || value.phase === "none" && value.updatedAt !== null || value.phase !== "none" && (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0 || value.updatedAt > 253402300799999)
    || value.scope !== "active_database_and_client_owned_media" || value.backupCopies !== "separate_not_erased" || value.externalCopies !== "not_checked") throw new Error("invalid_closure");
  return value;
}
function armSession() {
  cancelSession?.(); cancelSession = globalThis.JessieSessionClock.scheduleSessionCheck(state.session.expiresAt, async () => {
    const ticket = readinessTicket(state); try { await prove(ticket); armSession(); } catch (error) { handle(error); }
  }, { maxDelayMs: 300000 });
}
function handle(error) {
  if (error.accountChanged) { purge(); if (visible()) void bootstrap(); }
  else if (error.stale) return;
  else if (error.status === 401) { purge(); location.replace("/admin/login?continue=%2Fadmin%2Fclosures"); }
  else if (error.status === 403) { resetConfirmation(); client = null; el("prepare").hidden = true; notice("La vérification de session a changé. Actualise avant de reprendre.", true); }
  else notice(uncertain ? "Réponse non confirmée. Actualise le suivi avant toute nouvelle demande." : "Le suivi est momentanément indisponible. Réessaie dans un moment.", true);
}
function armPoll() {
  clearTimeout(pollTimer); if (!visible()) return;
  pollTimer = setTimeout(() => { if (!busy && !loading) void load(); else armPoll(); }, delay);
}
async function load() {
  if (!visible() || loading || busy || !state.session) return;
  loading = true; el("refresh").disabled = true; const ticket = readinessTicket(state);
  try {
    await prove(ticket);
    const page = await request(`/api/admin/closures${cursor === null ? "" : `?afterName=${encodeURIComponent(cursor)}`}`, { ticket });
    if (page?.version !== 1 || typeof page.enabled !== "boolean" || !Array.isArray(page.jobs) || page.jobs.length > 25
      || page.nextCursor !== null && !/^erasure-[a-f0-9]{64}\.json$/.test(page.nextCursor)
      || !page.enabled && (page.jobs.length || page.nextCursor !== null)) throw new Error("invalid_closure");
    const jobs = page.jobs.map(closure);
    if (new Set(jobs.map(job => job.clientId)).size !== jobs.length || jobs.some(job => job.phase === "none")) throw new Error("invalid_closure");
    let preview = null;
    if (page.enabled && selectedId) {
      try {
        preview = await request(`/api/admin/closures/clients/${selectedId}`, { ticket });
        if (preview?.version !== 1 || closure(preview.closure).clientId !== selectedId
          || preview.client === null && preview.closure.phase !== "completed"
          || preview.client !== null && (preview.client.id !== selectedId || typeof preview.client.pseudonym !== "string" || !preview.client.pseudonym.length
            || preview.client.pseudonym.length > 64 || !["active", "pending", "revoked", "suspended", "deleted"].includes(preview.client.status))) throw new Error("invalid_closure");
      } catch (error) { if (error.status !== 404) throw error; }
    }
    await prove(ticket);
    client = preview?.client ?? null; selectedPhase = preview?.closure.phase ?? null; nextCursor = page.nextCursor;
    el("disabled").hidden = page.enabled; el("content").hidden = !page.enabled;
    el("selected").hidden = !preview; el("choose").hidden = Boolean(preview);
    ui.rawText(el("client-name"), client?.pseudonym ?? (preview ? ui.t("Compte fermé") : ""));
    ui.text(el("client-reference"), preview ? "Référence : {reference}" : "", { reference: selectedId ?? "" });
    ui.text(el("selected-state"), preview ? phases[selectedPhase] : "");
    el("prepare").hidden = !client || selectedPhase !== "none" || client.status === "deleted";
    ui.forget(el("jobs")); el("jobs").replaceChildren(...jobs.map(job => {
      const item = document.createElement("li"), title = document.createElement("strong"), detail = document.createElement("p"), time = document.createElement("p");
      ui.text(title, phases[job.phase]); ui.text(detail, "Référence : {reference}", { reference: job.clientId });
      time.className = "muted"; ui.rawText(time, ui.dateParam(job.updatedAt, { dateStyle: "medium", timeStyle: "short" })); item.append(title, detail, time); return item;
    }));
    el("empty").hidden = jobs.length > 0; el("next").hidden = nextCursor === null; el("first").hidden = cursor === null;
    uncertain = false; delay = 5000; notice(page.enabled ? "Suivi à jour." : "La fermeture définitive n’est pas encore activée."); armSession();
    clearTimeout(pollTimer);
    if (jobs.some(job => job.phase !== "completed") || preview && selectedPhase !== "none" && selectedPhase !== "completed") armPoll();
  } catch (error) { handle(error); if (uncertain || selectedPhase && selectedPhase !== "none" && selectedPhase !== "completed") { delay = Math.min(delay * 2, 30000); armPoll(); } }
  finally { if (currentReadiness(state, ticket)) { loading = false; el("refresh").disabled = false; } }
}
async function bootstrap() {
  if (!visible()) return; purge(); clearReadiness(state, { visible: true }); const ticket = readinessTicket(state); notice("Vérification de la connexion…");
  try { await prove(ticket); await load(); } catch (error) { handle(error); }
}
el("prepare").addEventListener("click", () => {
  if (busy || loading || !client || selectedPhase !== "none" || !visible()) return;
  resetConfirmation(); ui.text(el("confirm-name"), "Compte à fermer : {name}", { name: client.pseudonym }); el("confirm-dialog").showModal(); el("cancel").focus();
});
el("cancel").addEventListener("click", resetConfirmation);
el("confirm-dialog").addEventListener("cancel", resetConfirmation);
el("confirm-dialog").addEventListener("close", resetConfirmation);
el("confirm-form").addEventListener("input", () => { el("confirm").disabled = busy || !el("acknowledge").checked || el("confirmation").value !== "FERMER"; });
el("confirm-form").addEventListener("submit", event => {
  event.preventDefault();
  if (busy || loading || !client || selectedPhase !== "none" || !el("confirm-dialog").open || !el("acknowledge").checked || el("confirmation").value !== "FERMER" || !visible()) return;
  const payload = { confirmation: "FERMER", expectedPseudonym: client.pseudonym }, ticket = readinessTicket(state);
  busy = true; uncertain = true; resetConfirmation(); el("prepare").hidden = true; notice("Enregistrement de la fermeture…");
  void (async () => {
    try {
      await prove(ticket); const result = await request(`/api/admin/closures/clients/${selectedId}`, { body: payload, ticket });
      if (result?.version !== 1 || result.accepted !== true || closure(result.closure).clientId !== selectedId || result.closure.phase === "none") throw new Error("invalid_closure");
      await prove(ticket);
      selectedPhase = result.closure.phase; notice("Demande enregistrée. L’effacement peut interrompre brièvement le service.");
    } catch (error) { handle(error); }
    finally { if (currentReadiness(state, ticket)) { busy = false; await load(); } }
  })();
});
el("refresh").addEventListener("click", () => { if (!state.session) void bootstrap(); else void load(); });
el("next").addEventListener("click", () => { if (!busy && !loading && nextCursor) { cursor = nextCursor; void load(); } });
el("first").addEventListener("click", () => { if (!busy && !loading) { cursor = null; void load(); } });
document.addEventListener("visibilitychange", () => { if (visible()) void bootstrap(); else purge(); });
window.addEventListener("pagehide", purge); window.addEventListener("pageshow", event => { if (event.persisted) void bootstrap(); });
ui.onChange(() => { document.title = ui.t("JessieMessage — Fermeture des comptes"); });
document.title = ui.t("JessieMessage — Fermeture des comptes"); void bootstrap();
