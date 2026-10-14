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
const controllers = new Set();

// Tokens travel in URL fragments, never query strings, storage or page markup.
const fragment = new URLSearchParams(location.hash.slice(1));
const entries = [...fragment.entries()];
if (entries.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(entries[0][1])) {
  if (entries[0][0] === "invitation") invitationToken = entries[0][1];
  if (entries[0][0] === "verification") verificationToken = entries[0][1];
}
history.replaceState(null, "", "/access");

function notice(message, error = false) { status.textContent = message; status.classList.toggle("is-error", error); }
function invalidate() { generation += 1; for (const controller of controllers) controller.abort(); controllers.clear(); }
function setBusy(value) { busy = value; for (const button of document.querySelectorAll("button")) button.disabled = value; }
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
  updateRecoveryLink();
}
function signedIn(session) {
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
}
function updateRecoveryLink() {
  element("client-recovery-link").hidden = recoveryEnabled !== true || loginForm.hidden;
  if (!loginForm.hidden && recoveryEnabled === null && !recoveryCapabilityPending) void loadRecoveryCapability();
}
async function loadRecoveryCapability() {
  recoveryCapabilityPending = true;
  try {
    const capability = await request("/api/access/recovery/capabilities");
    recoveryEnabled = capability.enabled === true;
  } catch (error) {
    if (!error.stale) recoveryEnabled = false;
  } finally {
    recoveryCapabilityPending = false;
    updateRecoveryLink();
  }
}
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
    const data = await response.json();
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
  if (busy) return; setBusy(true);
  try { await action(); } catch (error) { if (!error.stale) notice(errorMessage(error), true); }
  finally { for (const input of document.querySelectorAll('input[type="password"]')) input.value = ""; setBusy(false); }
}
loginForm.addEventListener("submit", (event) => {
  event.preventDefault(); void submit(async () => {
    notice("Connexion en cours…");
    const session = await request("/api/access/login", { mutation: true, body: { email: element("login-email").value, password: element("login-password").value } });
    signedIn(session); notice("");
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
  await request(all ? "/api/access/logout-all" : "/api/access/logout", { mutation: true, authenticated: true });
  signedOut(all ? "Toutes tes sessions sont déconnectées." : "Tu es déconnecté.");
}); }
element("client-logout").addEventListener("click", () => { void logout(false); });
element("client-logout-all").addEventListener("click", () => { void logout(true); });
async function refreshSession() {
  if (busy) return;
  try { signedIn(await request("/api/access/session")); }
  catch (error) { if (!error.stale) signedOut(error.status === 401 ? "" : errorMessage(error)); }
}
async function start() {
  await refreshSession();
  if (invitationToken) {
    try {
      const invitation = await request("/api/access/invitation", { mutation: true, body: { token: invitationToken } });
      element("invitation-summary").textContent = `Invitation valable jusqu’au ${new Date(invitation.expiresAt).toLocaleString("fr-FR")}. ${invitation.accessDays === null ? "Accès sans limite de durée après validation." : `Accès prévu pour ${invitation.accessDays} jours après validation.`}`;
    } catch (error) {
      if (!error.stale) { invitationToken = null; signedOut(errorMessage(error)); }
    }
  }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void refreshSession(); });
window.addEventListener("pageshow", (event) => { if (event.persisted) void refreshSession(); });
void start();
