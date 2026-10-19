import { createReadinessState, clearReadiness, readinessTicket, currentReadiness, acceptAdminSession } from "/readiness-model.js";

const ui = globalThis.JessieI18n, el = id => document.getElementById(id), state = createReadinessState();
const decisions = [
  ["D01", "Qui est responsable de l’espace ?", "Nom ou structure, coordonnées utilisables et pays d’établissement. Indique aussi le contact du délégué aux données s’il existe."],
  ["D02", "Pourquoi utiliser ces données ?", "Précise les fondements retenus pour l’accès, les échanges, le suivi, la sécurité, les notifications et les demandes de données, ainsi que ce qui est obligatoire."],
  ["D03", "Comment encadrer les contenus sensibles ?", "Précise la condition retenue pour les informations sur la vie sexuelle et ses modalités. Si un consentement est retenu, il faut prévoir son recueil et son retrait."],
  ["D04", "Combien de temps conserver les données ?", "Pour les comptes, échanges, photos, suivis, traces de sécurité et files : indique le point de départ, la durée ou le critère, et le sort final."],
  ["D05", "Que doit couvrir une suppression ?", "Précise le sort du compte, des échanges et des photos, y compris les photos réutilisées, et les éventuelles exceptions justifiées."],
  ["D06", "Que deviennent les copies et sauvegardes ?", "La copie automatique sur le PC fonctionne. Il reste à préciser les lieux, la rotation, la fin de vie des copies et le traitement d’une restauration."],
  ["D07", "Quels prestataires et quels lieux ?", "L’hébergement Infomaniak, les e-mails et les services Push sont utilisés. Précise les entités, lieux, transferts, journaux et autres sources de données réellement applicables."],
  ["D08", "Qui traite les demandes de données ?", "Le contact est contact@jessiemessage.com. Indique qui répond, comment les données sont remises et où le suivi privé est conservé, avec sa durée."],
];
const controllers = new Set();
let record = null, baseRevision = null, remote = null, pending = null, busy = false, cancelCheck = null, previewLanguage = "fr";
const visible = () => document.visibilityState === "visible";
const stale = () => Object.assign(new Error("stale"), { stale: true });
const node = (tag, text) => { const item = document.createElement(tag); if (text) ui.text(item, text); return item; };
function notice(text, error = false) { ui.text(el("privacy-status"), text); el("privacy-status").classList.toggle("is-error", error); }
function readDraft() { return { answers: Object.fromEntries(decisions.map(([id]) => [id, el(`answer-${id}`).value])), notice: { fr: el("notice-fr").value, en: el("notice-en").value } }; }
function dirty() { return record && JSON.stringify(readDraft()) !== JSON.stringify(record.draft); }
function remember() {
  if (record && state.session && dirty()) pending = { id: state.session.id, csrf: state.session.csrf, revision: baseRevision, draft: readDraft() };
}
function purge({ keepDraft = false } = {}) {
  if (keepDraft) remember(); else pending = null;
  clearReadiness(state); cancelCheck?.(); cancelCheck = null;
  for (const controller of controllers) controller.abort(); controllers.clear();
  record = null; remote = null; baseRevision = null; busy = false;
  el("privacy-content").hidden = true; el("decision-groups").replaceChildren();
  for (const id of ["notice-fr", "notice-en", "notice-preview", "remote-preview", "progress", "save-state", "choice-responsible", "closure-status"]) {
    if (el(id).tagName === "TEXTAREA") el(id).value = ""; else el(id).textContent = "";
  }
  el("conflict").hidden = true; el("save").disabled = true; notice("");
}
function signOut() { purge(); location.replace("/admin/login?continue=%2Fadmin%2Fprivacy"); }
async function request(path, { body, ticket = readinessTicket(state) } = {}) {
  const controller = new AbortController(); controllers.add(controller); const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": state.session?.csrf ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const length = response.headers.get("content-length"); if (length !== null && (!/^\d+$/.test(length) || Number(length) > 65536)) throw new Error("invalid_preparation");
    const text = await response.text(); if (text.length > 65536) throw new Error("invalid_preparation");
    let data; try { data = JSON.parse(text); } catch { throw new Error("invalid_preparation"); }
    if (!visible() || !currentReadiness(state, ticket)) throw stale();
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status, code: data.error });
    return data;
  } catch (error) { if (!visible() || !currentReadiness(state, ticket)) throw stale(); throw error; }
  finally { clearTimeout(timer); controllers.delete(controller); }
}
async function prove(ticket) {
  const proof = await request("/api/auth/session", { ticket });
  if (!acceptAdminSession(state, ticket, proof)) throw Object.assign(stale(), { accountChanged: true });
}
function parsed(value) {
  if (value?.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.publication !== "draft_only" || value.retention !== "not_enabled"
    || value.updatedAt !== null && (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < 1)
    || value.confirmed?.version !== 1 || typeof value.confirmed.responsibleName !== "string" || !value.confirmed.responsibleName.length || value.confirmed.responsibleName.length > 100
    || value.confirmed.countryCode !== "FR" || value.confirmed.organization !== null || value.confirmed.space !== "private_invitation"
    || value.confirmed.conversationRetention !== "until_permanent_account_closure" || !["not_enabled", "administrator_local"].includes(value.confirmed.permanentClosure)
    || !value.draft || !value.draft.answers || !value.draft.notice
    || decisions.some(([id]) => typeof value.draft.answers[id] !== "string" || value.draft.answers[id].length > 1024)
    || ["fr", "en"].some(lang => typeof value.draft.notice[lang] !== "string" || value.draft.notice[lang].length > 12288)) throw new Error("invalid_preparation");
  return { revision: value.revision, updatedAt: value.updatedAt, responsibleName: value.confirmed.responsibleName, permanentClosure: value.confirmed.permanentClosure,
    draft: { answers: Object.fromEntries(decisions.map(([id]) => [id, value.draft.answers[id]])), notice: { fr: value.draft.notice.fr, en: value.draft.notice.en } } };
}
function preview() {
  el("notice-preview").textContent = el(`notice-${previewLanguage}`).value; el("notice-preview").lang = previewLanguage;
  el("preview-fr").setAttribute("aria-pressed", String(previewLanguage === "fr")); el("preview-en").setAttribute("aria-pressed", String(previewLanguage === "en"));
}
function controls() {
  const changed = Boolean(record && dirty()), count = record ? decisions.filter(([id]) => el(`answer-${id}`).value.trim()).length : 0;
  if (record) ui.text(el("closure-status"), record.permanentClosure === "administrator_local"
    ? "La fermeture définitive s’effectue depuis « Fermetures de comptes » dans l’administration. Les sauvegardes et fichiers déjà téléchargés sont des copies séparées."
    : "La fermeture définitive n’est pas activée sur ce service. Les sauvegardes et fichiers déjà téléchargés sont des copies séparées.");
  ui.text(el("progress"), "{count} points renseignés sur 8", { count });
  ui.text(el("save-state"), changed ? "Modifications non enregistrées" : "Brouillon à jour");
  for (const item of el("privacy-form").querySelectorAll("textarea,button")) item.disabled = busy;
  el("save").disabled = busy || !changed || Boolean(remote);
  el("refresh").disabled = busy;
}
function fill(draft) {
  ui.text(el("choice-responsible"), "{name} — France", { name: record.responsibleName });
  const groups = [["Qui gère l’espace et les demandes", ["D01", "D08"]], ["Les échanges et leur conservation", ["D02", "D03", "D04"]], ["Les copies et l’effacement", ["D05", "D06", "D07"]]];
  el("decision-groups").replaceChildren(...groups.map(([title, ids]) => {
    const group = node("details"); group.append(node("summary", title));
    for (const id of ids) {
      const [, label, help] = decisions.find(([key]) => key === id), heading = node("label", label); heading.htmlFor = `answer-${id}`;
      const hint = node("p", help); hint.id = `help-${id}`; hint.className = "field-help";
      const input = node("textarea"); input.id = `answer-${id}`; input.maxLength = 1024; input.rows = 3; input.value = draft.answers[id]; input.autocomplete = "off"; input.setAttribute("aria-describedby", hint.id);
      group.append(heading, hint, input);
    }
    return group;
  }));
  el("notice-fr").value = draft.notice.fr; el("notice-en").value = draft.notice.en;
  preview(); controls();
}
function showConflict(value) {
  remote = value; el("conflict").hidden = false;
  el("remote-preview").textContent = decisions.map(([id, title]) => `${ui.t(title)}\n${value.draft.answers[id]}`).join("\n\n")
    + `\n\nFrançais\n${value.draft.notice.fr}\n\nEnglish\n${value.draft.notice.en}`;
  notice("Un autre appareil a enregistré une version. Choisis la suite après comparaison.", true); controls();
}
function arm() {
  cancelCheck?.(); cancelCheck = globalThis.JessieSessionClock.scheduleSessionCheck(state.session.expiresAt, async () => {
    const ticket = readinessTicket(state);
    try { await prove(ticket); arm(); }
    catch (error) { handle(error); }
  }, { maxDelayMs: 300000 });
}
function handle(error) {
  if (error.accountChanged) { purge(); if (visible()) void bootstrap(); }
  else if (error.stale) return;
  else if (error.status === 401) signOut();
  else { notice(error.status === 403 ? "La vérification de session a changé. Actualise avant de reprendre." : "La préparation est momentanément indisponible. Tes modifications restent ici ; actualise pour vérifier la version enregistrée.", true); }
}
async function bootstrap() {
  if (!visible()) return;
  purge({ keepDraft: true }); clearReadiness(state, { visible: true }); const ticket = readinessTicket(state);
  notice("Vérification de la connexion…");
  try {
    await prove(ticket); const latest = parsed(await request("/api/admin/privacy", { ticket })); await prove(ticket);
    record = latest; baseRevision = latest.revision; el("privacy-content").hidden = false;
    const saved = pending; pending = null;
    const sameOwner = saved && saved.id === state.session.id && saved.csrf === state.session.csrf;
    if (sameOwner) { baseRevision = saved.revision; fill(saved.draft); }
    else fill(record.draft);
    if (sameOwner && baseRevision !== record.revision && dirty()) showConflict(record);
    else { baseRevision = record.revision; notice(sameOwner && dirty() ? "Tes modifications non enregistrées ont été conservées." : "Tes choix sont déjà renseignés."); }
    arm();
  } catch (error) { handle(error); }
}
async function save() {
  if (busy || !record || remote || !dirty() || !visible()) return;
  const ticket = readinessTicket(state), payload = { revision: baseRevision, draft: readDraft() };
  busy = true; controls(); notice("Enregistrement…");
  try {
    await prove(ticket); const saved = parsed(await request("/api/admin/privacy", { body: payload, ticket })); await prove(ticket);
    record = saved; baseRevision = saved.revision; pending = null;
    notice("Brouillon enregistré. Les textes restent privés.");
  } catch (error) {
    if (error.status === 409) {
      try { const latest = parsed(await request("/api/admin/privacy", { ticket })); await prove(ticket); showConflict(latest); }
      catch (failure) { handle(failure); }
    } else handle(error);
  } finally { if (visible() && currentReadiness(state, ticket) && record) { busy = false; controls(); } }
}
el("privacy-form").addEventListener("submit", event => event.preventDefault());
el("privacy-form").addEventListener("input", () => { if (record && !busy) { preview(); controls(); } });
el("save").addEventListener("click", () => void save());
el("refresh").addEventListener("click", () => void bootstrap());
for (const lang of ["fr", "en"]) el(`preview-${lang}`).addEventListener("click", () => { previewLanguage = lang; preview(); });
el("load-remote").addEventListener("click", () => { if (busy || !remote) return; record = remote; baseRevision = remote.revision; remote = null; pending = null; el("conflict").hidden = true; el("remote-preview").textContent = ""; fill(record.draft); notice("La version enregistrée a été chargée."); });
el("keep-local").addEventListener("click", () => { if (busy || !remote) return; record = remote; baseRevision = remote.revision; remote = null; el("conflict").hidden = true; el("remote-preview").textContent = ""; controls(); notice("Tes modifications sont prêtes. Enregistre pour les conserver."); });
document.addEventListener("visibilitychange", () => { if (visible()) void bootstrap(); else purge({ keepDraft: true }); });
window.addEventListener("pagehide", () => purge());
window.addEventListener("pageshow", event => { if (event.persisted) void bootstrap(); });
ui.onChange(() => { if (record && visible()) controls(); document.title = ui.t("JessieMessage — Confidentialité"); });
document.title = ui.t("JessieMessage — Confidentialité"); void bootstrap();
