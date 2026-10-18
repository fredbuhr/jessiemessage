import { passwordProblem, createRecoveryState, beginRecoveryOperation, currentRecoveryOperation, finishRecoveryOperation,
  showRecoveryRequest, suspendRecovery, resumeRecovery, clearRecoveryState } from "/recover-model.js";

// UI sources are French; private values never enter the translation catalog.
const recoveryI18n = globalThis.JessieI18n ?? {
  t(source, params = {}) { return source.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, key) => Object.hasOwn(params, key) ? String(params[key]) : whole); },
  text(node, source, params = {}) { node.textContent = this.t(source, params); },
  attr(node, name, source, params = {}) { node.setAttribute(name, this.t(source, params)); },
  rawText(node, value) { node.textContent = value; },
  forget() {},
  dateParam(value, options = {}) { return new Date(value).toLocaleString("fr-FR", options); },
  numberParam(value, options = {}) { return value.toLocaleString("fr-FR", options); },
};

// The fragment and any query disappear before the first application request.
// No token is written into markup, browser storage or a subsequent URL.
let fragment = location.hash;
history.replaceState(null, "", "/recover");
const state = createRecoveryState(fragment);
fragment = "";
const element = (id) => document.getElementById(id);
const requestForm = element("recovery-request-form");
const resetForm = element("recovery-reset-form");
const password = element("recovery-password");
const confirmation = element("recovery-confirmation");
const status = element("recovery-status");
const newRequest = element("recovery-new-request");
const retryCapability = element("recovery-retry-capability");
const controllers = new Set();
let enabled = null;
let capabilityEpoch = 0;
let loadingCapability = false;
let interrupted = null;

function notice(message, error = false) {
  recoveryI18n.text(status, message); status.classList.toggle("is-error", error);
}
function clearPasswords() {
  password.value = ""; confirmation.value = "";
  recoveryI18n.text(element("recovery-password-help"), "Entre 8 et 128 caractères. Les espaces et les accents sont conservés.");
  password.removeAttribute("aria-invalid"); confirmation.removeAttribute("aria-invalid");
  recoveryI18n.text(element("recovery-confirmation-help"), "Saisis exactement le même mot de passe.");
  element("recovery-confirmation-help").classList.remove("is-error");
}
function render() {
  requestForm.hidden = enabled !== true || state.suspended || state.mode !== "request";
  resetForm.hidden = enabled !== true || state.suspended || state.mode !== "reset";
  newRequest.hidden = enabled !== true || state.suspended || !["reset", "accepted"].includes(state.mode);
  retryCapability.hidden = enabled !== null || state.suspended || loadingCapability;
  retryCapability.disabled = loadingCapability;
  for (const button of document.querySelectorAll('form button[type="submit"]')) button.disabled = Boolean(state.pending) || state.suspended;
  for (const input of document.querySelectorAll("form input")) input.readOnly = Boolean(state.pending);
  const resetting = state.mode === "reset";
  recoveryI18n.text(element("recovery-title"), state.mode === "complete" ? "Ton mot de passe est modifié." : resetting ? "Un nouveau mot de passe." : "Retrouver ton accès.");
  recoveryI18n.text(element("recovery-intro"), state.mode === "complete"
    ? "Reconnecte-toi avec ton nouveau mot de passe pour retrouver ton espace."
    : resetting ? "Choisis un nouveau mot de passe. Le lien sera utilisé seulement lorsque tu valideras ce formulaire."
      : "Demande un lien par e-mail pour choisir un nouveau mot de passe.");
  if (resetForm.hidden) clearPasswords();
}
function cancelRequests() {
  for (const controller of controllers) controller.abort();
  controllers.clear(); capabilityEpoch += 1; loadingCapability = false;
}
async function send(path, body, ticket) {
  const controller = new AbortController(); controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Jessie-Request": "1" }, body: JSON.stringify(body), signal: controller.signal });
    const data = await response.json();
    if (!currentRecoveryOperation(state, ticket)) throw Object.assign(new Error("stale_response"), { stale: true });
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status, code: data?.error });
    return data;
  } catch (error) {
    if (!currentRecoveryOperation(state, ticket)) throw Object.assign(new Error("stale_response"), { stale: true });
    throw error;
  } finally { clearTimeout(timeout); controllers.delete(controller); }
}
function operationFailure(error, ticket) {
  if (error.stale || !currentRecoveryOperation(state, ticket)) return;
  const invalid = ticket.operation === "reset" && error.status === 401 && error.code === "invalid_reset_link";
  finishRecoveryOperation(state, ticket, invalid ? "invalid" : "retry");
  if (invalid) notice("Ce lien est invalide, expiré ou a déjà été utilisé. Tu peux demander un nouveau lien ci-dessous.", true);
  else if (error.status === 429) notice("Trop de tentatives. Patiente quelques instants avant de réessayer.", true);
  else if (error.status === 400) notice(error.code === "invalid_password" ? "Choisis un mot de passe entre 8 et 128 caractères, puis confirme-le." : "Vérifie les informations saisies, puis réessaie.", true);
  else if (error.status === 403) notice("La demande a été refusée. Réessaie depuis cette page.", true);
  else notice(ticket.operation === "reset"
    ? "Le résultat n’a pas pu être confirmé. Saisis à nouveau ton mot de passe pour réessayer avec ce lien. Tu peux aussi essayer de te connecter si la modification a abouti."
    : "Le résultat n’a pas pu être confirmé. Consulte tes e-mails ou réessaie dans quelques instants.", true);
  render();
}
function passwordFeedback() {
  const help = element("recovery-password-help");
  const remaining = 8 - password.value.length;
  recoveryI18n.text(help, password.value.length > 0 && password.value.length < 8
    ? remaining > 1 ? "{count} caractères encore pour atteindre le minimum de 8." : "{count} caractère encore pour atteindre le minimum de 8."
    : "Entre 8 et 128 caractères. Les espaces et les accents sont conservés.",
  password.value.length > 0 && password.value.length < 8 ? { count: recoveryI18n.numberParam(remaining) } : {});
  const mismatch = confirmation.value.length > 0 && confirmation.value !== password.value;
  recoveryI18n.text(element("recovery-confirmation-help"), mismatch ? "Les deux mots de passe ne correspondent pas encore." : "Saisis exactement le même mot de passe.");
  element("recovery-confirmation-help").classList.toggle("is-error", mismatch);
  if (mismatch) confirmation.setAttribute("aria-invalid", "true"); else confirmation.removeAttribute("aria-invalid");
}
password.addEventListener("input", passwordFeedback);
confirmation.addEventListener("input", passwordFeedback);
requestForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (enabled !== true || state.suspended || state.pending) return;
  const ticket = beginRecoveryOperation(state, "request"); if (!ticket) return;
  notice("Demande en cours…"); render();
  void (async () => {
    try {
      const data = await send("/api/access/recovery/request", { email: element("recovery-email").value }, ticket);
      if (data?.status !== "accepted") throw new Error("invalid_response");
      if (!finishRecoveryOperation(state, ticket, "accepted")) return;
      requestForm.reset();
      notice("Si cette adresse est liée à ton espace, tu recevras un lien par e-mail. Il est valable 30 minutes et ne peut servir qu’une fois. Pense à vérifier tes courriers indésirables."); render();
    } catch (error) { operationFailure(error, ticket); }
  })();
});
resetForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (enabled !== true || state.suspended || state.pending) return;
  const problem = passwordProblem(password.value, confirmation.value);
  if (problem) {
    notice(problem === "mismatch" ? "Les deux mots de passe doivent être identiques." : "Choisis un mot de passe entre 8 et 128 caractères.", true);
    const field = problem === "mismatch" ? confirmation : password;
    field.setAttribute("aria-invalid", "true"); field.focus(); return;
  }
  const ticket = beginRecoveryOperation(state, "reset"); if (!ticket) return;
  notice("Enregistrement en cours…"); render();
  void (async () => {
    try {
      const data = await send("/api/access/recovery/reset", { token: state.token, password: password.value }, ticket);
      if (data?.status !== "password_changed") throw new Error("invalid_response");
      if (!finishRecoveryOperation(state, ticket, "changed")) return;
      notice("Ton mot de passe est modifié. Reconnecte-toi sur tes appareils pour retrouver ta conversation."); render();
    } catch (error) { operationFailure(error, ticket); }
    finally { if (ticket.generation === state.generation) clearPasswords(); }
  })();
});
newRequest.addEventListener("click", () => {
  cancelRequests(); showRecoveryRequest(state); clearPasswords(); render();
  notice("Demande un nouveau lien. Les liens précédents seront remplacés si un nouvel e-mail est envoyé.");
  element("recovery-email").focus();
});
async function loadCapability() {
  if (state.suspended || loadingCapability || enabled !== null) return;
  loadingCapability = true;
  notice("Vérification de la disponibilité…"); render();
  const epoch = ++capabilityEpoch;
  const controller = new AbortController(); controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch("/api/access/recovery/capabilities", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
    if (epoch !== capabilityEpoch || state.suspended) return;
    if (response.status === 404) { enabled = false; notice("La récupération du mot de passe n’est pas disponible pour le moment.", true); render(); return; }
    if (!response.ok) throw new Error("unavailable");
    const capability = await response.json();
    if (epoch !== capabilityEpoch || state.suspended) return;
    if (capability?.enabled !== true || capability.password?.minLength !== 8 || capability.password?.maxLength !== 128) throw new Error("unavailable");
    enabled = true; render();
    notice(state.invalidLink ? "Ce lien est invalide. Demande un nouveau lien ci-dessous." : "", state.invalidLink);
  } catch {
    if (epoch !== capabilityEpoch || state.suspended) return;
    enabled = null; notice("La disponibilité n’a pas pu être vérifiée. Réessaie dans quelques instants.", true); render();
  } finally {
    clearTimeout(timeout); controllers.delete(controller);
    if (epoch === capabilityEpoch) { loadingCapability = false; render(); }
  }
}
retryCapability.addEventListener("click", () => { void loadCapability(); });
function hide() {
  interrupted = state.pending ?? interrupted;
  suspendRecovery(state); cancelRequests(); clearPasswords(); render();
}
function restore() {
  resumeRecovery(state); render();
  if (interrupted) {
    notice(interrupted === "reset"
      ? "La page a été masquée pendant l’enregistrement. Le résultat n’a pas pu être confirmé. Saisis à nouveau ton mot de passe pour réessayer avec ce lien, ou essaie de te connecter."
      : "La demande a été interrompue. Consulte tes e-mails ou réessaie.", true);
    interrupted = null;
  }
  if (enabled === null) void loadCapability();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") hide(); else restore(); });
window.addEventListener("pagehide", () => {
  hide(); clearRecoveryState(state); requestForm.reset(); clearPasswords();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) { interrupted = null; restore(); notice("Pour utiliser un lien de récupération, ouvre-le à nouveau depuis ton e-mail. Tu peux aussi demander un nouveau lien."); }
});
if (document.visibilityState === "hidden") hide();
else void loadCapability();
