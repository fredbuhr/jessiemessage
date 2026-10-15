"use strict";

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
let expiryTimer = null;
let recoveryEnabled = null;
let recoveryCapabilityPending = false;
let recoveryCapabilityFailed = false;
let recoveryCapabilityEpoch = 0;
let submitEpoch = 0;
let sessionRefreshEpoch = 0;
let broadcastPreference = null;
let broadcastPreferenceEpoch = 0;
const controllers = new Set();
const visible = () => document.visibilityState === "visible";
const recoveryRetry = document.createElement("button"); recoveryRetry.id = "client-recovery-retry";
recoveryRetry.type = "button"; recoveryRetry.className = "button button-secondary"; recoveryRetry.hidden = true;
recoveryRetry.textContent = "Réessayer « Mot de passe oublié ? »";
element("client-recovery-link").parentElement.append(recoveryRetry);

// Tokens travel in URL fragments, never query strings, storage or page markup.
const fragment = new URLSearchParams(location.hash.slice(1));
const entries = [...fragment.entries()];
if (entries.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(entries[0][1])) {
  if (entries[0][0] === "invitation") invitationToken = entries[0][1];
  if (entries[0][0] === "verification") verificationToken = entries[0][1];
}
history.replaceState(null, "", "/access");

function notice(message, error = false) { status.textContent = message; status.classList.toggle("is-error", error); }
function clearBroadcastPreference() { broadcastPreferenceEpoch += 1; broadcastPreference?.clear(); broadcastPreference = null; element("broadcast-preference-host")?.remove(); }
function invalidate() {
  generation += 1; recoveryCapabilityEpoch += 1; recoveryCapabilityPending = false;
  for (const controller of controllers) controller.abort(); controllers.clear(); clearBroadcastPreference();
}
async function loadBroadcastPreference() {
  const ticket = generation; const epoch = broadcastPreferenceEpoch;
  try {
    const module = await import("/broadcast-preference.js");
    if (ticket !== generation || epoch !== broadcastPreferenceEpoch || connected.hidden || document.visibilityState !== "visible") return;
    const host = document.createElement("div"); host.id = "broadcast-preference-host"; connected.append(host);
    broadcastPreference = module.mountBroadcastPreference(host, { isCurrent: () => ticket === generation && epoch === broadcastPreferenceEpoch && !connected.hidden });
  } catch { /* An optional protected feature can be disabled without changing login. */ }
}
function setBusy(value) { busy = value; for (const button of document.querySelectorAll("button")) button.disabled = value; }
function validClientSession(session) {
  const user = session?.user; const access = session?.access;
  const date = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
  return user?.role === "client" && typeof user.id === "string" && user.id.length === 32 && /^[a-f0-9]{32}$/.test(user.id)
    && typeof user.pseudonym === "string" && user.pseudonym.length <= 64 && user.pseudonym.isWellFormed()
    && typeof session.csrf === "string" && session.csrf.length === 43 && /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(session.csrf)
    && date(session.expiresAt) && session.expiresAt > Date.now() && ["pending", "active", "expired"].includes(access?.state)
    && ["emailVerified", "ageAssured", "approved"].every((key) => typeof access[key] === "boolean")
    && (access.expiresAt === null || date(access.expiresAt));
}
function sameClientOwner(first, second) { return first.user.id === second.user.id && first.user.role === second.user.role && first.csrf === second.csrf; }
function signedOut(message = "") {
  invalidate(); csrf = null; clearTimeout(expiryTimer); expiryTimer = null;
  element("client-chat-link").hidden = true;
  loginForm.hidden = Boolean(invitationToken || verificationToken);
  registrationForm.hidden = !invitationToken;
  verificationSection.hidden = !verificationToken;
  connected.hidden = true;
  element("resend-section").hidden = false;
  element("access-title").textContent = invitationToken ? "Ton invitation." : "Bienvenue.";
  loginForm.reset(); element("client-name").textContent = "";
  notice(message);
  updateRecoveryLink({ allowLoad: true });
}
function signedIn(session) {
  if (!validClientSession(session)) throw new Error("invalid_client_session");
  invalidate(); csrf = session.csrf; loginForm.reset(); registrationForm.reset();
  element("client-chat-link").hidden = true;
  element("client-chat-note").textContent = "La messagerie sera disponible quand ton accès sera validé et le service activé.";
  loginForm.hidden = true; registrationForm.hidden = true; connected.hidden = false;
  updateRecoveryLink();
  verificationSection.hidden = !verificationToken;
  element("access-title").textContent = "Ton espace privé.";
  element("client-name").textContent = session.user.pseudonym;
  const access = session.access;
  element("client-access-state").textContent = access.state === "active" ? "Ton accès est validé." : access.state === "expired" ? "Ton accès a expiré. Jessie pourra le renouveler." : "Ton compte est créé. Ton accès reste en attente de validation.";
  const list = element("client-checks"); list.replaceChildren();
  for (const [label, valid] of [["Adresse e-mail", access.emailVerified], ["Vérification de majorité", access.ageAssured], ["Accord de Jessie", access.approved]]) {
    const item = document.createElement("li"); item.textContent = `${label} : ${valid ? "validé" : "en attente"}`; list.append(item);
  }
  element("resend-section").hidden = access.emailVerified;
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => signedOut("Ta session a expiré. Reconnecte-toi pour continuer."), Math.max(0, session.expiresAt - Date.now()));
  if (session.user.role === "client" && access.state === "active") void loadChatAccess();
  if (session.user.role === "client" && access.emailVerified) void loadBroadcastPreference();
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
    if (capability?.enabled !== true || capability.password?.minLength !== 14 || capability.password?.maxLength !== 128) throw new Error("invalid_recovery_capability");
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
    if (ticket !== generation || capability.enabled !== true) return;
    element("client-chat-link").hidden = false;
    element("client-chat-note").textContent = "Ton accès à la conversation privée est ouvert.";
  } catch (error) {
    if (error.stale || error.status === 404) return;
    if (error.status === 401 || error.status === 403) signedOut("Ton accès doit être vérifié. Reconnecte-toi pour continuer.");
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
    invitationToken = null; registrationForm.reset(); signedOut("Ton compte est créé. Consulte tes e-mails pour vérifier ton adresse, puis connecte-toi pour suivre la validation de ton accès.");
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
  clearBroadcastPreference();
  await request(all ? "/api/access/logout-all" : "/api/access/logout", { mutation: true, authenticated: true });
  signedOut(all ? "Toutes tes sessions sont déconnectées." : "Tu es déconnecté.");
}); }
element("client-logout").addEventListener("click", () => { void logout(false); });
element("client-logout-all").addEventListener("click", () => { void logout(true); });
async function refreshSession() {
  if (busy || !visible()) return;
  const epoch = ++sessionRefreshEpoch;
  try { const session = await request("/api/access/session"); if (epoch === sessionRefreshEpoch && visible()) signedIn(session); }
  catch (error) { if (!error.stale && epoch === sessionRefreshEpoch && visible()) signedOut(error.status === 401 ? "" : errorMessage(error)); }
}
async function start() {
  if (!visible()) return;
  await refreshSession();
  if (!visible()) return;
  if (invitationToken) {
    try {
      const invitation = await request("/api/access/invitation", { mutation: true, body: { token: invitationToken } });
      element("invitation-summary").textContent = `Invitation valable jusqu’au ${new Date(invitation.expiresAt).toLocaleString("fr-FR")}. ${invitation.accessDays === null ? "Accès sans limite de durée après validation." : `Accès prévu pour ${invitation.accessDays} jours après validation.`}`;
    } catch (error) {
      if (!error.stale) { invitationToken = null; signedOut(errorMessage(error)); }
    }
  }
}
function hideAccess() {
  submitEpoch += 1; sessionRefreshEpoch += 1; invalidate(); csrf = null; setBusy(false);
  clearTimeout(expiryTimer); expiryTimer = null;
  loginForm.hidden = true; registrationForm.hidden = true; verificationSection.hidden = true; connected.hidden = true;
  element("resend-section").hidden = true; element("client-chat-link").hidden = true;
  element("client-name").textContent = ""; element("client-checks").replaceChildren(); element("client-access-state").textContent = "";
  for (const form of [loginForm, registrationForm, element("resend-form")]) form.reset();
  updateRecoveryLink(); notice("");
}
document.addEventListener("visibilitychange", () => { if (visible()) void refreshSession(); else hideAccess(); });
window.addEventListener("pagehide", hideAccess);
window.addEventListener("pageshow", (event) => { if (event.persisted) void refreshSession(); });
void start();
