"use strict";

// UI sources are French; private values never enter the translation catalog.
const accessI18n = globalThis.JessieI18n ?? {
  t(source, params = {}) { return source.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, key) => Object.hasOwn(params, key) ? String(params[key]) : whole); },
  text(node, source, params = {}) { node.textContent = this.t(source, params); },
  attr(node, name, source, params = {}) { node.setAttribute(name, this.t(source, params)); },
  rawText(node, value) { node.textContent = value; },
  forget() {},
  dateParam(value, options = {}) { return new Date(value).toLocaleString("fr-FR", options); },
  numberParam(value, options = {}) { return value.toLocaleString("fr-FR", options); },
};

const element = (id) => document.getElementById(id);
const status = element("access-status");
const loginForm = element("client-login-form");
const registrationForm = element("registration-form");
const connected = element("client-connected");
const verificationSection = element("email-verification");
let invitationToken = null;
let verificationToken = null;
let csrf = null;
let busy = false;
let generation = 0;
let cancelSessionCheck = null;
let checkingSession = false;
let sessionOwner = null;
let displayedSession = null;
let notificationsPanel = null;
let pendingPolls = 0;
let recoveryEnabled = null;
let recoveryCapabilityPending = false;
let recoveryCapabilityFailed = false;
let recoveryCapabilityEpoch = 0;
let submitEpoch = 0;
let sessionRefreshEpoch = 0;
const controllers = new Set();
const visible = () => document.visibilityState === "visible";
const recoveryRetry = document.createElement("button"); recoveryRetry.id = "client-recovery-retry";
recoveryRetry.type = "button"; recoveryRetry.className = "button button-secondary"; recoveryRetry.hidden = true;
accessI18n.text(recoveryRetry, "Réessayer « Mot de passe oublié ? »");
element("client-recovery-link").parentElement.append(recoveryRetry);

// Tokens travel in URL fragments, never query strings, storage or page markup.
const fragment = new URLSearchParams(location.hash.slice(1));
const notificationReference = globalThis.JessieNotificationLink?.read() ?? null;
const entries = [...fragment.entries()];
if (entries.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(entries[0][1])) {
  if (entries[0][0] === "invitation") invitationToken = entries[0][1];
  if (entries[0][0] === "verification") verificationToken = entries[0][1];
}
history.replaceState(null, "", notificationReference ? `/access#notification=${notificationReference}` : "/access");

function notice(message, error = false) { accessI18n.text(status, message); status.classList.toggle("is-error", error); }
function invalidate() {
  generation += 1; recoveryCapabilityEpoch += 1; recoveryCapabilityPending = false;
  notificationsPanel?.clear(); notificationsPanel = null;
  cancelSessionCheck?.(); cancelSessionCheck = null;
  for (const controller of controllers) controller.abort(); controllers.clear();
}
function setBusy(value) { busy = value; for (const button of document.querySelectorAll("button")) if (button.getAttribute("data-jm-language") === null) button.disabled = value; }
function validClientSession(session) {
  const user = session?.user; const access = session?.access;
  const date = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
  return user?.role === "client" && typeof user.id === "string" && user.id.length === 32 && /^[a-f0-9]{32}$/.test(user.id)
    && typeof user.pseudonym === "string" && user.pseudonym.length <= 64 && user.pseudonym.isWellFormed()
    && typeof session.csrf === "string" && session.csrf.length === 43 && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(session.csrf)
    && date(session.expiresAt) && session.expiresAt > Date.now() && ["pending", "active", "expired"].includes(access?.state)
    && access.admissionPolicy === "manual_invitation" && ["emailVerified", "invitationConsumed", "ageAssured", "approved"].every((key) => typeof access[key] === "boolean")
    && (access.expiresAt === null || date(access.expiresAt));
}
function sameClientOwner(first, second) { return first.user.id === second.user.id && first.user.role === second.user.role && first.csrf === second.csrf; }
function signedOut(message = "") {
  invalidate(); csrf = null; displayedSession = null; sessionOwner = null; pendingPolls = 0;
  element("client-chat-link").hidden = true;
  element("access-retry").hidden = true;
  element("access-intro").hidden = false;
  loginForm.hidden = Boolean(invitationToken || verificationToken);
  registrationForm.hidden = !invitationToken;
  verificationSection.hidden = !verificationToken;
  connected.hidden = true;
  element("resend-section").hidden = false;
  accessI18n.text(element("access-title"), invitationToken ? "Bienvenue chez Jessie." : "Bienvenue.");
  loginForm.reset(); clearPrivateAccessSummary();
  notice(message);
  updateRecoveryLink({ allowLoad: true });
}
function signedIn(session) {
  if (!validClientSession(session)) throw new Error("invalid_client_session");
  if (displayedSession && !connected.hidden && sameClientOwner(displayedSession, session)
    && displayedSession.user.pseudonym === session.user.pseudonym
    && Object.keys(session.access).every((key) => session.access[key] === displayedSession.access[key])) {
    displayedSession = session;
    planSessionCheck(session.expiresAt, session.access.state === "pending" && pendingPolls < 60 ? 15000 : 300000);
    return;
  }
  displayedSession = session;
  invalidate(); csrf = session.csrf; loginForm.reset(); registrationForm.reset();
  element("client-chat-link").hidden = true;
  element("client-chat-note").hidden = true;
  accessI18n.rawText(element("client-chat-note"), "");
  element("access-intro").hidden = true;
  element("access-retry").hidden = true;
  loginForm.hidden = true; registrationForm.hidden = true; connected.hidden = false;
  updateRecoveryLink();
  verificationSection.hidden = !verificationToken;
  accessI18n.text(element("access-title"), "Ton espace privé.");
  accessI18n.rawText(element("client-name"), session.user.pseudonym);
  const access = session.access;
  const stateMessage = access.state === "active" ? "On reprend notre conversation ?"
    : access.state === "expired" ? "Ton accès est arrivé à son terme. Contacte Jessie pour le renouveler."
    : !access.emailVerified ? "Confirme ton e-mail pour continuer."
    : "Tout est prêt. Jessie doit encore valider ton accès.";
  accessI18n.text(element("client-access-state"), stateMessage);
  const list = element("client-checks"); accessI18n.forget(list); list.replaceChildren(); list.hidden = true;
  element("client-validity").hidden = access.state !== "active" || access.expiresAt === null;
  if (!element("client-validity").hidden) accessI18n.text(element("client-validity"), "Ton accès est ouvert jusqu’au {date}.", { date: accessI18n.dateParam(access.expiresAt) });
  else accessI18n.rawText(element("client-validity"), "");
  element("renewal-contact").hidden = access.state !== "expired";
  element("check-client-access").hidden = access.state !== "pending";
  element("resend-section").hidden = access.emailVerified;
  if (sessionOwner !== session.user.id || access.state !== "pending") pendingPolls = 0;
  sessionOwner = session.user.id;
  planSessionCheck(session.expiresAt, access.state === "pending" && pendingPolls < 60 ? 15000 : 300000);
  if (session.user.role === "client" && access.state === "active") {
    void loadChatAccess();
    if (globalThis.JessieNotifications) {
      const ticket = generation, owner = { id: session.user.id, csrf };
      notificationsPanel = globalThis.JessieNotifications.mount(element("notifications-client-host"), {
        role: "client", owner, isCurrent: () => ticket === generation && visible() && !connected.hidden && csrf === owner.csrf,
      });
    }
  }
}
function updateRecoveryLink({ allowLoad = false } = {}) {
  element("client-recovery-link").hidden = recoveryEnabled !== true || loginForm.hidden || !visible();
  recoveryRetry.hidden = recoveryEnabled !== null || !recoveryCapabilityFailed || recoveryCapabilityPending || loginForm.hidden || !visible();
  recoveryRetry.disabled = busy || recoveryCapabilityPending;
  if (allowLoad && visible() && !loginForm.hidden && recoveryEnabled === null && !recoveryCapabilityPending) void loadRecoveryCapability();
}
async function loadRecoveryCapability() {
  if (!visible() || loginForm.hidden || recoveryEnabled !== null || recoveryCapabilityPending) return;
  const epoch = ++recoveryCapabilityEpoch;
  recoveryCapabilityPending = true; recoveryCapabilityFailed = false; updateRecoveryLink();
  try {
    const capability = await request("/api/access/recovery/capabilities");
    if (epoch !== recoveryCapabilityEpoch || !visible()) return;
    if (capability?.enabled !== true || capability.password?.minLength !== 8 || capability.password?.maxLength !== 128) throw new Error("invalid_recovery_capability");
    recoveryEnabled = true;
  } catch (error) {
    if (error.stale || epoch !== recoveryCapabilityEpoch || !visible()) return;
    recoveryEnabled = error.status === 404 ? false : null;
    recoveryCapabilityFailed = error.status !== 404;
  } finally {
    if (epoch === recoveryCapabilityEpoch) { recoveryCapabilityPending = false; updateRecoveryLink(); }
  }
}
recoveryRetry.addEventListener("click", () => { if (!busy) void loadRecoveryCapability(); });
async function loadChatAccess() {
  const ticket = generation;
  try {
    const capability = await request("/api/chat/client/capabilities");
    if (ticket !== generation) return;
    if (capability.enabled !== true) { element("client-chat-note").hidden = false; accessI18n.text(element("client-chat-note"), "La conversation sera bientôt disponible. Tu peux revenir ici pour la retrouver."); return; }
    if (notificationReference && visible()) {
      location.replace(globalThis.JessieNotificationLink.destination("client", notificationReference)); return;
    }
    element("client-chat-link").hidden = false;
    element("client-chat-note").hidden = true;
    accessI18n.rawText(element("client-chat-note"), "");
  } catch (error) {
    if (error.stale) return;
    if (error.status === 404) { element("client-chat-note").hidden = false; accessI18n.text(element("client-chat-note"), "La conversation sera bientôt disponible. Tu peux revenir ici pour la retrouver."); return; }
    if (error.status === 401 || error.status === 403) signedOut("Ton accès doit être vérifié. Reconnecte-toi pour continuer.");
    else sessionUnavailable();
  }
}
async function request(path, { body, mutation = false, authenticated = false } = {}) {
  const headers = {};
  if (mutation) { headers["Content-Type"] = "application/json"; headers[authenticated ? "X-CSRF-Token" : "X-Jessie-Request"] = authenticated ? csrf ?? "" : "1"; }
  const controller = new AbortController(); controllers.add(controller);
  const ticket = generation;
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, { method: mutation ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers, body: mutation ? JSON.stringify(body ?? {}) : undefined, signal: controller.signal });
    let data;
    try { data = await response.json(); }
    catch { throw Object.assign(new Error("invalid_response"), { status: response.ok ? undefined : response.status }); }
    if (ticket !== generation) throw Object.assign(new Error("stale_response"), { stale: true });
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status, code: data.error });
    return data;
  } catch (error) {
    if (ticket !== generation) throw Object.assign(new Error("stale_response"), { stale: true });
    throw error;
  } finally { clearTimeout(timeout); controllers.delete(controller); }
}
function errorMessage(error) {
  if (error.status === 401) return "Le lien ou les identifiants sont invalides ou expirés.";
  if (error.status === 429) return "Trop de tentatives. Patiente un moment avant de réessayer.";
  if (error.status === 403) return "La demande a été refusée. Recharge la page puis réessaie.";
  if (error.status === 400) return error.code === "registration_failed" ? "L’inscription n’a pas pu être finalisée. Vérifie ton invitation et tes informations." : "Vérifie les informations saisies.";
  return "L’accès est indisponible pour le moment. Réessaie dans quelques instants.";
}
async function submit(action) {
  if (busy || !visible()) return; const epoch = ++submitEpoch; setBusy(true);
  try { await action(); } catch (error) {
    if (!error.stale) notice(error.loginUnconfirmed
      ? "La connexion a peut-être abouti, mais sa vérification a échoué. Actualise la page pour vérifier ta session avant de réessayer."
      : errorMessage(error), true);
  }
  finally { if (epoch === submitEpoch) { for (const input of document.querySelectorAll('input[type="password"]')) input.value = ""; setBusy(false); updateRecoveryLink(); } }
}
loginForm.addEventListener("submit", (event) => {
  event.preventDefault(); void submit(async () => {
    notice("Connexion en cours…");
    const login = await request("/api/access/login", { mutation: true, body: { email: element("login-email").value, password: element("login-password").value } });
    try {
      if (!validClientSession(login)) throw new Error("invalid_client_session");
      // Another window may replace the cookie after the login response. Only
      // the final GET can identify the session currently owned by this page.
      const current = await request("/api/access/session");
      if (!validClientSession(current)) throw new Error("invalid_client_session");
      const unchanged = sameClientOwner(login, current);
      signedIn(current); notice(unchanged ? "" : "La connexion a changé. Cet espace correspond à ta session actuelle.");
    } catch (error) { if (!error.stale) error.loginUnconfirmed = true; throw error; }
  });
});
registrationForm.addEventListener("submit", (event) => {
  event.preventDefault(); void submit(async () => {
    if (!invitationToken || !element("age-declared").checked) { notice("L’invitation et la déclaration de majorité sont nécessaires.", true); return; }
    notice("Création du compte…");
    await request("/api/access/register", { mutation: true, body: { invitationToken, email: element("registration-email").value, pseudonym: element("registration-name").value, password: element("registration-password").value, ageDeclared: true } });
    invitationToken = null; registrationForm.reset(); signedOut("C’est créé ! Ouvre l’e-mail reçu pour confirmer ton adresse, puis connecte-toi ici.");
  });
});
element("show-login").addEventListener("click", () => { invitationToken = null; registrationForm.reset(); signedOut(); });
element("verify-email-button").addEventListener("click", () => { void submit(async () => {
  if (!verificationToken) return;
  await request("/api/access/verify-email", { mutation: true, body: { token: verificationToken } });
  verificationToken = null; verificationSection.hidden = true;
  if (csrf) { signedIn(await request("/api/access/session")); notice("Ton adresse e-mail est vérifiée."); }
  else signedOut("Ton adresse e-mail est vérifiée. Connecte-toi pour suivre la validation de ton accès.");
}); });
element("resend-form").addEventListener("submit", (event) => {
  event.preventDefault(); void submit(async () => {
    await request("/api/access/resend-verification", { mutation: true, body: { email: element("resend-email").value, password: element("resend-password").value } });
    element("resend-form").reset(); notice("Si les informations correspondent à un compte en attente, un nouvel e-mail de vérification sera envoyé.");
  });
});
async function logout(all) { await submit(async () => {
  await request(all ? "/api/access/logout-all" : "/api/access/logout", { mutation: true, authenticated: true });
  signedOut(all ? "Toutes tes sessions sont déconnectées." : "Tu es déconnecté.");
}); }
element("client-logout").addEventListener("click", () => { void logout(false); });
element("client-logout-all").addEventListener("click", () => { if (busy || !visible() || !csrf) return; if (window.confirm(accessI18n.t("Déconnecter tous tes appareils ? Tu devras te reconnecter sur chacun d’eux."))) void logout(true); });
function planSessionCheck(expiresAt, maxDelayMs = 300000) {
  cancelSessionCheck?.();
  cancelSessionCheck = globalThis.JessieSessionClock.scheduleSessionCheck(expiresAt, () => {
    cancelSessionCheck = null;
    if (!visible()) return;
    if (busy || checkingSession) { planSessionCheck(Date.now() + 15000, 15000); return; }
    pendingPolls += 1; void refreshSession();
  }, { maxDelayMs });
}
function sessionUnavailable() {
  hideAccess();
  accessI18n.text(element("access-title"), "Ton espace privé.");
  notice("La connexion est interrompue. Réessaie dès que le réseau revient.", true);
  element("access-retry").hidden = false;
  planSessionCheck(Date.now() + 30000, 30000);
}
async function refreshSession() {
  if (busy || checkingSession || !visible()) return;
  checkingSession = true;
  const epoch = ++sessionRefreshEpoch;
  try {
    const session = await request("/api/access/session");
    if (epoch === sessionRefreshEpoch && visible()) signedIn(session);
  } catch (error) {
    if (error.stale || epoch !== sessionRefreshEpoch || !visible()) return;
    if (error.status === 401) signedOut();
    else sessionUnavailable();
  } finally { if (epoch === sessionRefreshEpoch) checkingSession = false; }
}
element("check-client-access").addEventListener("click", () => { if (!busy && !checkingSession) { pendingPolls = 0; void refreshSession(); } });
element("access-retry").addEventListener("click", () => { void refreshSession(); });
window.addEventListener("online", () => { if (visible()) void refreshSession(); });
async function start() {
  if (!visible()) return;
  await refreshSession();
  if (!visible()) return;
  if (invitationToken) {
    try {
      const invitation = await request("/api/access/invitation", { mutation: true, body: { token: invitationToken } });
      accessI18n.text(element("invitation-summary"), invitation.accessDays === null
        ? "Invitation valable jusqu’au {date}. Accès sans limite de durée après validation."
        : "Invitation valable jusqu’au {date}. Accès prévu pour {days} jours après validation.",
      { date: accessI18n.dateParam(invitation.expiresAt), ...(invitation.accessDays === null ? {} : { days: accessI18n.numberParam(invitation.accessDays) }) });
    } catch (error) {
      if (!error.stale) { invitationToken = null; signedOut(errorMessage(error)); }
    }
  }
}
function clearPrivateAccessSummary() {
  for (const id of ["client-name", "client-access-state", "client-validity", "client-chat-note"]) accessI18n.rawText(element(id), "");
  const checks = element("client-checks"); accessI18n.forget(checks); checks.replaceChildren();
  for (const id of ["client-validity", "renewal-contact", "check-client-access"]) element(id).hidden = true;
}
function hideAccess() {
  submitEpoch += 1; sessionRefreshEpoch += 1; checkingSession = false; invalidate(); csrf = null; displayedSession = null; setBusy(false);
  cancelSessionCheck?.(); cancelSessionCheck = null;
  element("access-retry").hidden = true;
  loginForm.hidden = true; registrationForm.hidden = true; verificationSection.hidden = true; connected.hidden = true;
  element("resend-section").hidden = true; element("client-chat-link").hidden = true;
  clearPrivateAccessSummary();
  for (const form of [loginForm, registrationForm, element("resend-form")]) form.reset();
  updateRecoveryLink(); notice("");
}
document.addEventListener("visibilitychange", () => { if (visible()) void refreshSession(); else hideAccess(); });
window.addEventListener("pagehide", hideAccess);
window.addEventListener("pageshow", (event) => { if (event.persisted) void refreshSession(); });
void start();
