"use strict";

const form = document.getElementById("login-form");
const connected = document.getElementById("connected");
const status = document.getElementById("auth-status");
const title = document.getElementById("access-title");
const intro = document.getElementById("access-intro");
const loginButton = document.getElementById("login-button");
const logoutButton = document.getElementById("logout-button");
const logoutAllButton = document.getElementById("logout-all-button");
let csrf = null;
let principalId = null;
let expiryTimer = null;
let busy = false;
let generation = 0;
let suspended = document.visibilityState !== "visible";
let needsSession = true;
let nextSessionNotice = "";
let proofRecoveryAvailable = true;
const controllers = new Set();
const accessTools = document.getElementById("access-tools");

function invalidate() {
  generation += 1;
  for (const controller of controllers) controller.abort();
  controllers.clear();
  setBusy(false);
}

function current(ticket) { return ticket === generation && !suspended && document.visibilityState === "visible"; }
function stale() { return Object.assign(new Error("stale_response"), { stale: true }); }
function clearCredentials() {
  form.reset();
  for (const id of ["email", "password", "factor"]) document.getElementById(id).value = "";
}

function clearAccess() {
  accessTools.hidden = true;
  document.body.classList.remove("has-access");
  document.getElementById("new-invitation").hidden = true;
  document.getElementById("invitation-link").value = "";
  document.getElementById("invitations-list").replaceChildren();
  document.getElementById("clients-list").replaceChildren();
}

function notice(message, error = false) {
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

function signedOut(message = "") {
  invalidate();
  clearAccess();
  document.getElementById("admin-chat-link").hidden = true;
  csrf = null;
  principalId = null;
  clearTimeout(expiryTimer);
  expiryTimer = null;
  form.hidden = suspended;
  connected.hidden = true;
  title.textContent = "Bienvenue, Jessie.";
  intro.hidden = false;
  clearCredentials();
  document.getElementById("connected-name").textContent = "";
  notice(message);
}

function signedIn(session) {
  if (suspended || document.visibilityState !== "visible") return;
  if (!Number.isFinite(session?.expiresAt) || session.expiresAt <= Date.now()) {
    signedOut("Ta session a expiré. Reconnecte-toi pour continuer.");
    return;
  }
  invalidate();
  clearAccess();
  document.getElementById("admin-chat-link").hidden = true;
  csrf = session.csrf;
  principalId = session.user.id;
  clearCredentials();
  form.hidden = true;
  connected.hidden = false;
  intro.hidden = true;
  title.textContent = "Ton accès est prêt.";
  document.getElementById("connected-name").textContent = session.user.pseudonym;
  notice("");
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => signedOut("Ta session a expiré. Reconnecte-toi pour continuer."), Math.max(0, session.expiresAt - Date.now()));
  if (location.pathname === "/admin/login") history.replaceState(null, "", "/admin");
  void loadAccess();
  if (session.user.role === "admin") void loadChatAccess();
}

async function loadChatAccess() {
  const ticket = generation;
  document.getElementById("admin-session-note").textContent = "L’accès administrateur est prêt. La messagerie sera disponible dès son activation.";
  try {
    const capability = await request("/api/chat/admin/capabilities");
    if (ticket !== generation || capability.enabled !== true) return;
    await verifyIdentity(ticket);
    document.getElementById("admin-chat-link").hidden = false;
    document.getElementById("admin-session-note").textContent = "Tes conversations privées sont accessibles.";
  } catch (error) {
    if (error.stale || error.status === 404) return;
    if (error.status === 401 || error.status === 403) signedOut(errorMessage(error));
  }
}

function setBusy(value) {
  busy = value;
  loginButton.disabled = value;
  logoutButton.disabled = value;
  logoutAllButton.disabled = value;
  form.setAttribute("aria-busy", String(value));
  for (const button of accessTools.querySelectorAll("button")) button.disabled = value || button.dataset.unavailable === "true";
}

async function request(path, { body, mutation = false, login = false } = {}) {
  if (suspended || document.visibilityState !== "visible") throw stale();
  const headers = {};
  if (mutation) {
    headers["Content-Type"] = "application/json";
    if (login) headers["X-Jessie-Request"] = "1";
    else headers["X-CSRF-Token"] = csrf ?? "";
  }
  const controller = new AbortController();
  controllers.add(controller);
  const ticket = generation;
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, {
      method: mutation ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: mutation ? JSON.stringify(body ?? {}) : undefined,
      signal: controller.signal,
    });
    const data = await response.json();
    if (!current(ticket)) throw stale();
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status, code: data.error });
    return data;
  } catch (error) {
    if (!current(ticket)) throw stale();
    throw error;
  } finally { clearTimeout(timeout); controllers.delete(controller); }
}

const uncertainOperation = "Le résultat de l’opération n’a pas pu être confirmé. Vérifie les accès actualisés avant de réessayer.";
function sessionIdentity(session) {
  if (!session?.user || typeof session.user.id !== "string" || !/^[a-f0-9]{32}$/.test(session.user.id) || session.user.role !== "admin"
    || typeof session.user.pseudonym !== "string" || session.user.pseudonym.length > 64 || !session.user.pseudonym.isWellFormed() || typeof session.csrf !== "string"
    || !/^[A-Za-z0-9_-]{43}$/.test(session.csrf) || !Number.isFinite(session.expiresAt)) throw new Error("invalid_session");
  return { id: session.user.id, role: session.user.role, csrf: session.csrf };
}
async function verifyIdentity(ticket, { afterMutation = false, expected = { id: principalId, role: "admin", csrf } } = {}) {
  const message = afterMutation ? uncertainOperation : "Ta session a changé. Les accès sont vérifiés à nouveau.";
  let proof;
  try {
    proof = await request("/api/auth/session");
    const actual = sessionIdentity(proof);
    if (actual.id === expected.id && actual.role === expected.role && actual.csrf === expected.csrf && proof.expiresAt > Date.now()) return proof;
  } catch (error) {
    if (error.stale || !current(ticket)) throw stale();
    // A failed proof is a failed GET, even if an earlier POST may have committed.
    // Clear the view and revalidate once; never retry that mutation.
    const recover = proofRecoveryAvailable;
    proofRecoveryAvailable = false;
    signedOut(recover ? message : `${message} Recharge la page pour vérifier les accès.`);
    if (recover) {
      form.hidden = true;
      needsSession = true;
      nextSessionNotice = message;
      void refreshSession();
    }
    throw stale();
  }
  if (!current(ticket)) throw stale();
  // Rebuild under the current cookie using GET requests and discard every value
  // fetched for the previous proof. Never continue the previous actor's action.
  const recover = proofRecoveryAvailable;
  proofRecoveryAvailable = false;
  if (recover) { signedIn(proof); notice(message, afterMutation); }
  else signedOut(`${message} Recharge la page pour vérifier les accès.`);
  throw stale();
}

function errorMessage(error, login = false) {
  if (error.status === 401) return login ? "Les identifiants ou le code de sécurité sont incorrects." : "Ta session a expiré. Reconnecte-toi pour continuer.";
  if (error.status === 429) return "Trop de tentatives. Patiente un moment avant de réessayer.";
  if (error.status === 403) return "La demande a été refusée. Recharge la page puis réessaie.";
  if (error.status === 400) return "Vérifie l’adresse e-mail, le mot de passe et le code de sécurité.";
  if (error.status === 409) return "La vérification de l’e-mail et de la majorité est nécessaire avant l’approbation.";
  return "La connexion est indisponible pour le moment. Réessaie dans quelques instants.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || suspended || needsSession) return;
  proofRecoveryAvailable = true;
  const ticket = generation;
  setBusy(true);
  notice("Connexion en cours…");
  try {
    const session = await request("/api/auth/login", {
      mutation: true,
      login: true,
      body: {
        email: document.getElementById("email").value,
        password: document.getElementById("password").value,
        factor: document.getElementById("factor").value,
      },
    });
    const expected = sessionIdentity(session);
    signedIn(await verifyIdentity(ticket, { afterMutation: true, expected }));
  } catch (error) {
    if (error.stale) return;
    document.getElementById("factor").value = "";
    document.getElementById("password").value = "";
    notice(errorMessage(error, true), true);
  } finally { if (current(ticket)) setBusy(false); }
});

async function logout(all) {
  if (busy || suspended || !csrf) return;
  const ticket = generation;
  setBusy(true);
  try {
    await request(all ? "/api/auth/logout-all" : "/api/auth/logout", { mutation: true });
    signedOut(all ? "Toutes tes sessions sont déconnectées." : "Tu es déconnectée.");
    history.replaceState(null, "", "/admin/login");
  } catch (error) {
    if (error.stale) return;
    if (error.status === 401) signedOut(errorMessage(error));
    else notice(errorMessage(error), true);
  } finally { if (current(ticket)) setBusy(false); }
}
logoutButton.addEventListener("click", () => logout(false));
logoutAllButton.addEventListener("click", () => logout(true));

async function refreshSession() {
  if (suspended || !needsSession) return;
  needsSession = false;
  const message = nextSessionNotice;
  nextSessionNotice = "";
  try {
    const session = await request("/api/auth/session");
    sessionIdentity(session);
    signedIn(session);
    if (message) notice(message, true);
  }
  catch (error) {
    if (error.stale) return;
    if (error.status === 401) signedOut(message);
    else { signedOut(); notice(message || errorMessage(error), true); }
  }
}
function suspend() {
  suspended = true;
  needsSession = true;
  invalidate();
  clearAccess();
  csrf = null;
  principalId = null;
  clearCredentials();
  form.hidden = true;
  connected.hidden = true;
  document.getElementById("connected-name").textContent = "";
  document.getElementById("admin-session-note").textContent = "";
  document.getElementById("admin-chat-link").hidden = true;
  title.textContent = "Bienvenue, Jessie.";
  intro.hidden = false;
  notice("");
  // Keep the existing absolute expiry timer. Hiding the page never extends it.
}
function resume() {
  if (document.visibilityState !== "visible") return;
  suspended = false;
  if (needsSession) {
    proofRecoveryAvailable = true;
    notice("Vérification de la connexion…");
    void refreshSession();
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") resume();
  else suspend();
});
window.addEventListener("pagehide", suspend);
window.addEventListener("pageshow", () => resume());
if (suspended) suspend();
else resume();

function dateText(value) { return new Date(value).toLocaleString("fr-FR"); }
function item(titleText, lines) {
  const card = document.createElement("article"); card.className = "access-item";
  const heading = document.createElement("h3"); heading.textContent = titleText; card.append(heading);
  for (const line of lines) { const paragraph = document.createElement("p"); paragraph.textContent = line; card.append(paragraph); }
  return card;
}
function emptyList(container, message) {
  const paragraph = document.createElement("p"); paragraph.className = "empty-list"; paragraph.textContent = message; container.append(paragraph);
}
function actionButton(card, label, action, disabled = false) {
  const button = document.createElement("button"); button.type = "button"; button.className = "button button-secondary"; button.textContent = label;
  button.disabled = disabled || busy;
  button.dataset.unavailable = String(disabled);
  button.addEventListener("click", () => { void accessAction(action); }); card.append(button);
}
function paintInvitations(invitations) {
  const container = document.getElementById("invitations-list"); container.replaceChildren();
  if (!invitations.length) emptyList(container, "Aucune invitation créée.");
  const states = { pending: "Disponible", used: "Utilisée", expired: "Expirée", revoked: "Révoquée" };
  for (const invitation of invitations) {
    const card = item(`Invitation · ${states[invitation.state]}`, [`Créée le ${dateText(invitation.createdAt)} · valable jusqu’au ${dateText(invitation.expiresAt)}`, invitation.accessDays === null ? "Accès sans limite de durée après validation." : `Accès de ${invitation.accessDays} jours après validation.`]);
    if (invitation.state === "pending") actionButton(card, "Révoquer le lien", async () => {
      await request(`/api/admin/invitations/${invitation.id}/revoke`, { mutation: true });
      document.getElementById("new-invitation").hidden = true; document.getElementById("invitation-link").value = "";
      await refreshAccessLists({ afterMutation: true }); notice("L’invitation est révoquée.");
    });
    container.append(card);
  }
}
function paintClients(clients) {
  const container = document.getElementById("clients-list"); container.replaceChildren();
  if (!clients.length) emptyList(container, "Aucun compte client inscrit.");
  const states = { pending: "En attente", active: "Actif", suspended: "Suspendu", revoked: "Révoqué", deleted: "Supprimé" };
  for (const client of clients) {
    const card = item(client.pseudonym, [client.email, `État : ${states[client.status]} · E-mail : ${client.emailVerified ? "vérifié" : "en attente"} · Majorité : ${client.ageAssured ? "vérifiée" : "en attente"}`, client.accessExpiresAt === null ? "Aucune date de fin d’accès." : `Fin d’accès : ${dateText(client.accessExpiresAt)}`]);
    if (client.status === "pending") actionButton(card, "Approuver l’accès", async () => {
      await request(`/api/admin/clients/${client.id}/approve`, { mutation: true }); await refreshAccessLists({ afterMutation: true }); notice("L’accès client est approuvé.");
    }, !client.emailVerified || !client.ageAssured);
    if (["pending", "active", "suspended"].includes(client.status)) actionButton(card, "Révoquer l’accès", async () => {
      await request(`/api/admin/clients/${client.id}/revoke`, { mutation: true }); await refreshAccessLists({ afterMutation: true }); notice("L’accès client est révoqué.");
    });
    container.append(card);
  }
}
async function refreshAccessLists({ afterMutation = false } = {}) {
  const ticket = generation;
  const [invitations, clients] = await Promise.all([request("/api/admin/invitations"), request("/api/admin/clients")]);
  if (ticket !== generation) throw Object.assign(new Error("stale_response"), { stale: true });
  await verifyIdentity(ticket, { afterMutation });
  paintInvitations(invitations.invitations); paintClients(clients.clients);
}
async function loadAccess() {
  const ticket = generation;
  try {
    await request("/api/admin/access");
    await refreshAccessLists();
    if (ticket !== generation) return;
    accessTools.hidden = false; document.body.classList.add("has-access");
  } catch (error) {
    if (error.stale) return;
    if (error.status === 404) { clearAccess(); return; }
    if (error.status === 401) signedOut(errorMessage(error));
    else notice(errorMessage(error), true);
  }
}
async function accessAction(action) {
  if (busy || suspended || !csrf) return;
  proofRecoveryAvailable = true;
  const ticket = generation;
  setBusy(true);
  try { await action(); }
  catch (error) {
    if (error.stale) return;
    if (error.status === 401) signedOut(errorMessage(error));
    else notice(errorMessage(error), true);
  } finally { if (current(ticket)) setBusy(false); }
}
document.getElementById("invitation-unlimited").addEventListener("change", (event) => {
  document.getElementById("invitation-days").disabled = event.target.checked;
  document.getElementById("invitation-days").required = !event.target.checked;
});
document.getElementById("invitation-form").addEventListener("submit", (event) => {
  event.preventDefault(); void accessAction(async () => {
    const invitation = await request("/api/admin/invitations", { mutation: true, body: { lifetimeHours: Number(document.getElementById("invitation-hours").value), accessDays: document.getElementById("invitation-unlimited").checked ? null : Number(document.getElementById("invitation-days").value) } });
    await refreshAccessLists({ afterMutation: true });
    document.getElementById("invitation-link").value = invitation.url;
    document.getElementById("new-invitation").hidden = false;
    notice("L’invitation est créée. Tu peux transmettre le lien au client.");
  });
});
document.getElementById("copy-invitation").addEventListener("click", () => { void accessAction(async () => {
  const ticket = generation;
  const input = document.getElementById("invitation-link");
  await verifyIdentity(ticket);
  try { await navigator.clipboard.writeText(input.value); if (ticket === generation) notice("Le lien est copié."); }
  catch { if (ticket !== generation) return; input.focus(); input.select(); notice("Sélectionne puis copie le lien affiché."); }
}); });
document.getElementById("refresh-access").addEventListener("click", () => { void accessAction(async () => { await refreshAccessLists(); notice("Les accès sont actualisés."); }); });
