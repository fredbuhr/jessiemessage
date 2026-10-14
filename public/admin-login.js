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
let expiryTimer = null;
let busy = false;

function notice(message, error = false) {
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

function signedOut(message = "") {
  csrf = null;
  clearTimeout(expiryTimer);
  expiryTimer = null;
  form.hidden = false;
  connected.hidden = true;
  title.textContent = "Bienvenue, Jessie.";
  intro.hidden = false;
  form.reset();
  document.getElementById("connected-name").textContent = "";
  notice(message);
}

function signedIn(session) {
  csrf = session.csrf;
  form.reset();
  form.hidden = true;
  connected.hidden = false;
  intro.hidden = true;
  title.textContent = "Ton accès est prêt.";
  document.getElementById("connected-name").textContent = session.user.pseudonym;
  notice("");
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => signedOut("Ta session a expiré. Reconnecte-toi pour continuer."), Math.max(0, session.expiresAt - Date.now()));
  if (location.pathname === "/admin/login") history.replaceState(null, "", "/admin");
}

function setBusy(value) {
  busy = value;
  loginButton.disabled = value;
  logoutButton.disabled = value;
  logoutAllButton.disabled = value;
  form.setAttribute("aria-busy", String(value));
}

async function request(path, { body, mutation = false, login = false } = {}) {
  const headers = {};
  if (mutation) {
    headers["Content-Type"] = "application/json";
    if (login) headers["X-Jessie-Request"] = "1";
    else headers["X-CSRF-Token"] = csrf ?? "";
  }
  const controller = new AbortController();
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
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status, code: data.error });
    return data;
  } finally { clearTimeout(timeout); }
}

function errorMessage(error, login = false) {
  if (error.status === 401) return login ? "Les identifiants ou le code de sécurité sont incorrects." : "Ta session a expiré. Reconnecte-toi pour continuer.";
  if (error.status === 429) return "Trop de tentatives. Patiente un moment avant de réessayer.";
  if (error.status === 403) return "La demande a été refusée. Recharge la page puis réessaie.";
  if (error.status === 400) return "Vérifie l’adresse e-mail, le mot de passe et le code de sécurité.";
  return "La connexion est indisponible pour le moment. Réessaie dans quelques instants.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
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
    signedIn(session);
  } catch (error) {
    document.getElementById("factor").value = "";
    document.getElementById("password").value = "";
    notice(errorMessage(error, true), true);
  } finally { setBusy(false); }
});

async function logout(all) {
  if (busy) return;
  setBusy(true);
  try {
    await request(all ? "/api/auth/logout-all" : "/api/auth/logout", { mutation: true });
    signedOut(all ? "Toutes tes sessions sont déconnectées." : "Tu es déconnectée.");
    history.replaceState(null, "", "/admin/login");
  } catch (error) {
    if (error.status === 401) signedOut(errorMessage(error));
    else notice(errorMessage(error), true);
  } finally { setBusy(false); }
}
logoutButton.addEventListener("click", () => logout(false));
logoutAllButton.addEventListener("click", () => logout(true));

async function refreshSession() {
  if (busy) return;
  try { signedIn(await request("/api/auth/session")); }
  catch (error) {
    if (error.status === 401) signedOut();
    else { signedOut(); notice(errorMessage(error), true); }
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshSession();
});
window.addEventListener("pageshow", (event) => { if (event.persisted) void refreshSession(); });
void refreshSession();
