"use strict";

const adminUI = globalThis.JessieI18n ?? {
  t(source, params = {}) { return source.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, key) => Object.hasOwn(params, key) ? String(params[key]) : whole); },
  text(node, source, params = {}) { node.textContent = this.t(source, params); },
  attr(node, name, source, params = {}) { node.setAttribute(name, this.t(source, params)); },
  rawText(node, value) { node.textContent = value; },
  forget() {},
  dateParam(value, options = {}) { return new Date(value).toLocaleString("fr-FR", options); },
  numberParam(value) { return String(value); },
};
const adminLine = (source, params = {}) => ({ source, params });

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
const accessPages = {
  invitations: { cursor: null, nextCursor: null, hasMore: false, epoch: 0 },
  clients: { cursor: null, nextCursor: null, hasMore: false, epoch: 0 },
};

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
  for (const id of ["invitations-list", "clients-list"]) {
    const list = document.getElementById(id); adminUI.forget(list); list.replaceChildren();
  }
  for (const kind of ["invitations", "clients"]) {
    const page = accessPages[kind];
    page.cursor = null; page.nextCursor = null; page.hasMore = false; page.epoch += 1;
    document.getElementById(`${kind}-pagination`).hidden = true;
    adminUI.rawText(document.getElementById(`${kind}-page-note`), "");
    updatePagination(kind);
  }
}

function notice(message, error = false) {
  if (message) adminUI.text(status, message); else adminUI.rawText(status, "");
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
  adminUI.text(title, "Bienvenue, Jessie.");
  intro.hidden = false;
  clearCredentials();
  adminUI.rawText(document.getElementById("connected-name"), "");
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
  adminUI.text(title, "Ton accès est prêt.");
  adminUI.rawText(document.getElementById("connected-name"), session.user.pseudonym);
  notice("");
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => signedOut("Ta session a expiré. Reconnecte-toi pour continuer."), Math.max(0, session.expiresAt - Date.now()));
  if (location.pathname === "/admin/login") history.replaceState(null, "", "/admin");
  void loadAccess();
  if (session.user.role === "admin") void loadChatAccess();
}

async function loadChatAccess() {
  const ticket = generation;
  adminUI.text(document.getElementById("admin-session-note"), "L’accès administrateur est prêt. La messagerie sera disponible dès son activation.");
  try {
    const capability = await request("/api/chat/admin/capabilities");
    if (ticket !== generation || capability.enabled !== true) return;
    await verifyIdentity(ticket);
    document.getElementById("admin-chat-link").hidden = false;
    adminUI.text(document.getElementById("admin-session-note"), "Tes conversations privées sont accessibles.");
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
    let data;
    try { data = await response.json(); }
    catch (error) { if (response.ok) throw error; }
    if (!current(ticket)) throw stale();
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status, code: data?.error });
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
  adminUI.rawText(document.getElementById("connected-name"), "");
  adminUI.rawText(document.getElementById("admin-session-note"), "");
  document.getElementById("admin-chat-link").hidden = true;
  adminUI.text(title, "Bienvenue, Jessie.");
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

function item(titleText, lines, { rawTitle = false } = {}) {
  const card = document.createElement("article"); card.className = "access-item";
  const heading = document.createElement("h3");
  if (rawTitle) adminUI.rawText(heading, titleText); else adminUI.text(heading, titleText);
  card.append(heading);
  for (const line of lines) {
    const paragraph = document.createElement("p");
    if (line && typeof line === "object" && Object.hasOwn(line, "raw")) adminUI.rawText(paragraph, line.raw);
    else if (line && typeof line === "object") adminUI.text(paragraph, line.source, line.params);
    else adminUI.text(paragraph, line);
    card.append(paragraph);
  }
  return card;
}
function emptyList(container, message) {
  const paragraph = document.createElement("p"); paragraph.className = "empty-list"; adminUI.text(paragraph, message); container.append(paragraph);
}
function actionButton(card, label, action, disabled = false) {
  const button = document.createElement("button"); button.type = "button"; button.className = "button button-secondary"; adminUI.text(button, label);
  button.disabled = disabled || busy;
  button.dataset.unavailable = String(disabled);
  button.addEventListener("click", () => { void accessAction(action); }); card.append(button);
}
function paintInvitations(invitations) {
  const container = document.getElementById("invitations-list"); adminUI.forget(container); container.replaceChildren();
  if (!invitations.length) emptyList(container, "Aucune invitation sur cette page.");
  const states = { pending: "Disponible", used: "Utilisée", expired: "Expirée", revoked: "Révoquée" };
  for (const invitation of invitations) {
    const card = item(`Invitation · ${states[invitation.state]}`, [
      adminLine("Créée le {created} · valable jusqu’au {expires}", { created: adminUI.dateParam(invitation.createdAt), expires: adminUI.dateParam(invitation.expiresAt) }),
      invitation.accessDays === null ? "Accès sans limite de durée après validation." : adminLine("Accès de {days} jours après validation.", { days: adminUI.numberParam(invitation.accessDays) }),
    ]);
    if (invitation.state === "pending") actionButton(card, "Révoquer le lien", async () => {
      await request(`/api/admin/invitations/${invitation.id}/revoke`, { mutation: true });
      document.getElementById("new-invitation").hidden = true; document.getElementById("invitation-link").value = "";
      await refreshAccessLists({ afterMutation: true }); notice("L’invitation est révoquée.");
    });
    container.append(card);
  }
}
function paintClients(clients, renewalDraft = null) {
  const container = document.getElementById("clients-list"); adminUI.forget(container); container.replaceChildren();
  if (!clients.length) emptyList(container, "Aucun compte client sur cette page.");
  const states = { pending: "En attente", active: "Actif", suspended: "Suspendu", revoked: "Révoqué", deleted: "Supprimé" };
  for (const client of clients) {
    const expired = client.status === "active" && client.accessExpiresAt !== null && client.accessExpiresAt <= Date.now();
    const card = item(client.pseudonym, [{ raw: client.email },
      `État : ${expired ? "Accès expiré" : states[client.status]} · E-mail : ${client.emailVerified ? "vérifié" : "en attente"} · Majorité : ${client.ageAssured ? "vérifiée" : "en attente"}`,
      client.accessExpiresAt === null ? "Aucune date de fin d’accès." : adminLine("Fin d’accès : {date}", { date: adminUI.dateParam(client.accessExpiresAt) }),
    ], { rawTitle: true });
    if (client.status === "pending") actionButton(card, "Approuver l’accès", async () => {
      await request(`/api/admin/clients/${client.id}/approve`, { mutation: true }); await refreshAccessLists({ afterMutation: true }); notice("L’accès client est approuvé.");
    }, !client.emailVerified || !client.ageAssured);
    if (client.status === "active" && client.emailVerified && client.ageAssured && client.approved && Number.isSafeInteger(client.accessExpiresAt)) {
      const renewal = document.createElement("form"); renewal.className = "renewal-form";
      const label = document.createElement("label");
      const labelText = document.createElement("span"); adminUI.text(labelText, "Durée à ajouter (jours)"); label.append(labelText);
      const days = document.createElement("input"); days.type = "number"; days.min = "1"; days.max = "3650"; days.value = "30"; days.required = true;
      if (renewalDraft?.id === client.id && renewalDraft.expectedExpiresAt === client.accessExpiresAt) days.value = renewalDraft.value;
      adminUI.attr(days, "aria-label", "Durée à ajouter pour {name}, en jours", { name: client.pseudonym });
      adminUI.attr(days, "title", "Entre une durée de 1 à 3 650 jours.");
      label.append(days); renewal.append(label);
      const button = document.createElement("button"); button.type = "submit"; button.className = "button button-secondary";
      adminUI.text(button, expired ? "Renouveler l’accès expiré" : "Prolonger l’accès"); button.disabled = busy;
      renewal.append(button);
      renewal.addEventListener("submit", (event) => {
        event.preventDefault();
        if (busy || suspended || !csrf) return;
        const accessDays = Number(days.value);
        if (!Number.isSafeInteger(accessDays) || accessDays < 1 || accessDays > 3650) { notice("Choisis une durée de 1 à 3 650 jours.", true); return; }
        void accessAction(() => renewClient(client, accessDays, days));
      });
      card.append(renewal);
    }
    if (["pending", "active", "suspended"].includes(client.status)) actionButton(card, "Révoquer l’accès", async () => {
      await request(`/api/admin/clients/${client.id}/revoke`, { mutation: true }); await refreshAccessLists({ afterMutation: true }); notice("L’accès client est révoqué.");
    });
    container.append(card);
  }
}
function updatePagination(kind) {
  const page = accessPages[kind];
  for (const [suffix, unavailable] of [["next", !page.hasMore], ["first", page.cursor === null]]) {
    const button = document.getElementById(`${kind}-${suffix}`);
    button.dataset.unavailable = String(unavailable); button.disabled = busy || unavailable;
  }
}
function pagePath(kind, cursor) {
  return `/api/admin/${kind}?limit=50${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
}
async function readAccessPage(kind, cursor) {
  const page = accessPages[kind], epoch = ++page.epoch;
  const result = await request(pagePath(kind, cursor));
  if (page.epoch !== epoch) throw stale();
  const entries = result?.[kind];
  if (!Array.isArray(entries) || entries.length > 50 || typeof result.hasMore !== "boolean"
    || (result.hasMore ? entries.length !== 50 || typeof result.nextCursor !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(result.nextCursor) || result.nextCursor === cursor : result.nextCursor !== null)) throw new Error("invalid_page");
  return { kind, cursor, epoch, entries, nextCursor: result.nextCursor, hasMore: result.hasMore };
}
function paintAccessPage(result, { renewalDraft = null } = {}) {
  const page = accessPages[result.kind];
  if (page.epoch !== result.epoch) throw stale();
  page.cursor = result.cursor; page.nextCursor = result.nextCursor; page.hasMore = result.hasMore;
  if (result.kind === "clients") paintClients(result.entries, renewalDraft); else paintInvitations(result.entries);
  const label = result.kind === "clients"
    ? `Comptes clients ${result.cursor === null ? "les plus récents" : "plus anciens"}`
    : `Invitations ${result.cursor === null ? "les plus récentes" : "plus anciennes"}`;
  adminUI.text(document.getElementById(`${result.kind}-page-note`), `${label} · {count} sur cette page${result.hasMore ? "" : " · fin de la liste"}.`, { count: adminUI.numberParam(result.entries.length) });
  document.getElementById(`${result.kind}-pagination`).hidden = false;
  updatePagination(result.kind);
}
async function refreshAccessPage(kind, { cursor = accessPages[kind].cursor, afterMutation = false, renewalDraft = null } = {}) {
  const ticket = generation;
  const result = await readAccessPage(kind, cursor);
  await verifyIdentity(ticket, { afterMutation });
  if (!current(ticket)) throw stale();
  paintAccessPage(result, { renewalDraft });
}
async function refreshAccessLists({ afterMutation = false } = {}) {
  const ticket = generation;
  const results = await Promise.all([readAccessPage("invitations", null), readAccessPage("clients", null)]);
  await verifyIdentity(ticket, { afterMutation });
  if (!current(ticket)) throw stale();
  for (const result of results) paintAccessPage(result);
}
async function renewClient(client, accessDays, input) {
  // Keep a draft only for this pending action and this exact expiry snapshot.
  // Its DOM reference is discarded with the action; it is never a cross-page cache.
  const renewalDraft = { id: client.id, expectedExpiresAt: client.accessExpiresAt, get value() { return input.value; } };
  try {
    const result = await request(`/api/admin/clients/${client.id}/renew`, { mutation: true, body: { accessDays, expectedExpiresAt: client.accessExpiresAt } });
    if (result?.status !== "renewed" || result.client?.id !== client.id || !Number.isSafeInteger(result.client?.accessExpiresAt)
      || result.client.accessExpiresAt <= client.accessExpiresAt) throw new Error("invalid_renewal");
  } catch (error) {
    if (error.stale) throw error;
    if (error.status === 409 && error.code === "access_changed") {
      await refreshAccessPage("clients", { afterMutation: true, renewalDraft });
      notice("L’accès a été modifié entre-temps. Vérifie sa nouvelle date de fin avant de réessayer.", true);
      return;
    }
    if (error.status === 400) {
      notice("Cette durée ne peut pas être appliquée. Choisis une durée plus courte et vérifie la date de fin d’accès.", true);
      return;
    }
    if (!error.status || error.status >= 500) {
      try { await refreshAccessPage("clients", { afterMutation: true, renewalDraft }); }
      catch (refreshError) { if (refreshError.stale) throw refreshError; }
      notice(uncertainOperation, true);
      return;
    }
    throw error;
  }
  try { await refreshAccessPage("clients", { afterMutation: true, renewalDraft }); }
  catch (error) {
    if (error.stale) throw error;
    notice(uncertainOperation, true);
    return;
  }
  notice("La durée d’accès du client est prolongée. Vérifie la nouvelle date affichée.");
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
  try { await verifyIdentity(ticket); await action(); }
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

for (const kind of ["invitations", "clients"]) {
  document.getElementById(`${kind}-next`).addEventListener("click", () => {
    if (!accessPages[kind].hasMore) return;
    const cursor = accessPages[kind].nextCursor;
    void accessAction(() => refreshAccessPage(kind, { cursor }));
  });
  document.getElementById(`${kind}-first`).addEventListener("click", () => {
    if (accessPages[kind].cursor === null) return;
    void accessAction(() => refreshAccessPage(kind, { cursor: null }));
  });
}
