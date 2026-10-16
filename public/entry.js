import { createEntryState, clearEntry, currentEntry, beginEntryCheck, acceptEntry, rejectEntry } from "/entry-model.js";

const words = {
  fr: {
    pageTitle: "JessieMessage — Ouvrir mon espace", badge: "UN ESPACE À PART", title: "Retrouver notre conversation.",
    subtitle: "Ton espace privé avec Jessie, accessible sur invitation.", invitation: "Une nouvelle invitation ? Ouvre directement le lien transmis par Jessie.",
    openSpace: "Ouvrir mon espace", clientRole: "Ma conversation", administratorRole: "Administration", footer: "JessieMessage · Accès privé sur invitation", contact: "Contact",
    checking: "Vérification de l’accès…", available: "Choisis l’espace que tu souhaites ouvrir.", unavailable: "L’ouverture des accès est en préparation. Reviens plus tard ou contacte Jessie.",
    offline: "La connexion internet est indisponible. Reconnecte-toi, puis vérifie à nouveau les accès.", error: "L’accès n’a pas pu être vérifié. Réessaie dans un moment.", retry: "Vérifier à nouveau", retryChecking: "Vérification en cours…",
    clientSignIn: "Me connecter", clientSignedOut: "Connecte-toi pour retrouver notre conversation.",
    clientPending: "Ton compte attend encore la validation de son accès.", clientExpired: "Consulte ton accès pour connaître les possibilités de renouvellement.",
    clientAccess: "Consulter mon accès", clientActive: "Ta conversation privée est accessible.", clientMessages: "Reprendre ma conversation", clientChatUnavailable: "Retrouve l’état de ton accès et les fonctions disponibles.",
    administratorSignedOut: "Accès réservé à l’administration de Jessie.", administratorSignIn: "Connexion administrateur", administratorConnected: "Ouvre les outils de ton espace administrateur.", administratorOpen: "Ouvrir l’administration", administratorMessages: "Ouvrir les conversations",
    keepClose: "Retrouve Jessie en un geste", install: "Installer Jessie", installHelp: "Ajouter à l’écran d’accueil", installIntro: "Si ton navigateur propose cette option :",
    installApple: "Sur iPhone ou iPad, ouvre le menu Partager, puis « Sur l’écran d’accueil ».",
    installAndroid: "Sur Android, ouvre le menu du navigateur, puis « Installer l’application » ou « Ajouter à l’écran d’accueil ».",
    installLimits: "Les intitulés varient selon le navigateur. Tu peux aussi continuer dans le navigateur ; une connexion internet reste nécessaire.",
    installBusy: "La demande d’installation est ouverte dans ton navigateur.", installCancelled: "Installation annulée. Tu peux continuer ici ou utiliser le menu du navigateur.",
    installAccepted: "La demande d’installation a été acceptée. Termine les étapes proposées par ton navigateur.", installError: "La demande d’installation n’a pas abouti. Tu peux utiliser le menu du navigateur.", installed: "Jessie a été ajouté à tes applications."
  },
  en: {
    pageTitle: "JessieMessage — Open my space", badge: "A SPACE APART", title: "Return to our conversation.",
    subtitle: "Your private space with Jessie, available by invitation.", invitation: "A new invitation? Open the link Jessie shared with you directly.",
    openSpace: "Open my space", clientRole: "My conversation", administratorRole: "Administration", footer: "JessieMessage · Invitation-only access", contact: "Contact",
    checking: "Checking access…", available: "Choose the space you would like to open.", unavailable: "Access is being prepared. Come back later or contact Jessie.",
    offline: "An internet connection is unavailable. Reconnect, then check access again.", error: "Access could not be checked. Please try again in a moment.", retry: "Check again", retryChecking: "Checking access…",
    clientSignIn: "Sign in", clientSignedOut: "Sign in to return to our conversation.",
    clientPending: "Your account is still waiting for access approval.", clientExpired: "Check your access for renewal options.",
    clientAccess: "View my access", clientActive: "Your private conversation is available.", clientMessages: "Return to my conversation", clientChatUnavailable: "View your access status and available features.",
    administratorSignedOut: "Reserved for Jessie’s administration.", administratorSignIn: "Administrator sign-in", administratorConnected: "Open the tools in your administrator space.", administratorOpen: "Open administration", administratorMessages: "Open conversations",
    keepClose: "Keep Jessie one tap away", install: "Install Jessie", installHelp: "Add to your Home Screen", installIntro: "If your browser offers the option:",
    installApple: "On iPhone or iPad, open the Share menu, then choose “Add to Home Screen”.",
    installAndroid: "On Android, open the browser menu, then choose “Install app” or “Add to Home Screen”.",
    installLimits: "Labels vary by browser. You can also continue in your browser; an internet connection is still required.",
    installBusy: "The installation request is open in your browser.", installCancelled: "Installation cancelled. You can continue here or use the browser menu.",
    installAccepted: "The installation request was accepted. Complete any steps shown by your browser.", installError: "The installation request could not be completed. You can use the browser menu.", installed: "Jessie has been added to your apps."
  }
};
const el = (id) => document.getElementById(id), state = createEntryState();
const sharedLanguage = globalThis.JessieI18n;
let language = sharedLanguage?.getLanguage() ?? (typeof navigator.language === "string" && !navigator.language.toLowerCase().startsWith("fr") ? "en" : "fr");
let checkTask = null, installEvent = null, installBusy = false, installEpoch = 0, installMessage = "", installed = false;
const displayMode = typeof window.matchMedia === "function" ? window.matchMedia("(display-mode: standalone)") : null;
const visible = () => document.visibilityState === "visible";
const online = () => navigator.onLine !== false;
const standalone = () => installed || displayMode?.matches === true || navigator.standalone === true;
const t = (key) => words[language][key];
function cleanLocation() { try { globalThis.history?.replaceState(null, "", "/app"); } catch { /* The browser may disable history changes. */ } }
function clearLinks() {
  el("entry-options").hidden = true;
  for (const role of ["client", "administrator"]) { el(`${role}-card`).hidden = true; el(`${role}-link`).hidden = true; el(`${role}-link`).removeAttribute("href"); el(`${role}-link`).textContent = ""; el(`${role}-description`).textContent = ""; }
}
function renderInstall() {
  const canOffer = visible() && online() && !standalone();
  el("install-app").hidden = !canOffer || !installEvent || installBusy;
  el("install-app").textContent = t("install"); el("install-help").hidden = standalone();
  el("install-status").textContent = visible() && installMessage ? t(installMessage) : "";
}
function render() {
  document.documentElement.lang = language; document.title = t("pageTitle");
  for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = t(element.dataset.i18n);
  el("language-switch").textContent = language === "fr" ? "EN" : "FR";
  el("language-switch").setAttribute("aria-label", language === "fr" ? "Switch to English" : "Passer en français");
  clearLinks();
  const phase = state.visible && visible() ? state.phase : "idle";
  el("entry-status").textContent = phase === "idle" ? "" : t(phase);
  el("entry-status").classList.toggle("is-error", phase === "offline" || phase === "error");
  // aria-disabled keeps a retry button's existing keyboard focus in place.
  el("entry-retry").hidden = phase === "idle" || phase === "available";
  el("entry-retry").setAttribute("aria-disabled", String(phase === "checking"));
  el("entry-retry").textContent = t(phase === "checking" ? "retryChecking" : "retry");
  if (phase === "available") {
    el("entry-options").hidden = false;
    const { client, administrator } = state.entry;
    if (client) {
      el("client-card").hidden = false; const link = el("client-link"); link.href = client.href; link.hidden = false;
      const description = client.state === "signed_out" ? "clientSignedOut" : client.state === "pending" ? "clientPending" : client.state === "expired" ? "clientExpired" : client.href === "/messages" ? "clientActive" : "clientChatUnavailable";
      link.textContent = t(client.state === "signed_out" ? "clientSignIn" : client.href === "/messages" ? "clientMessages" : "clientAccess"); el("client-description").textContent = t(description);
    }
    if (administrator) {
      el("administrator-card").hidden = false; const link = el("administrator-link"); link.href = administrator.href; link.hidden = false;
      link.textContent = t(administrator.state === "signed_out" ? "administratorSignIn" : administrator.href === "/admin/messages" ? "administratorMessages" : "administratorOpen");
      el("administrator-description").textContent = t(administrator.state === "signed_out" ? "administratorSignedOut" : "administratorConnected");
    }
  }
  renderInstall();
}
function cancelCheck() {
  const previous = checkTask; checkTask = null;
  if (previous) { clearTimeout(previous.timer); previous.controller.abort(); previous.cancel(); }
}
function clearInstall() { installEpoch += 1; installEvent = null; installBusy = false; installMessage = ""; }
function suspend() { cancelCheck(); clearEntry(state); clearInstall(); render(); }
async function checkAccess() {
  if (!visible()) return;
  cleanLocation();
  if (checkTask && currentEntry(state, checkTask.ticket)) return checkTask.promise;
  cancelCheck(); const ticket = beginEntryCheck(state);
  if (!online()) { rejectEntry(state, ticket, { offline: true }); render(); return; }
  const task = { ticket, controller: new AbortController(), timer: null, cancel: null, promise: null };
  const cancelled = new Promise((resolve, reject) => { task.cancel = () => reject(new Error("entry_cancelled")); });
  const deadline = new Promise((resolve, reject) => { task.timer = setTimeout(() => { task.controller.abort(); reject(new Error("entry_timeout")); }, 8000); });
  checkTask = task; render();
  const reading = Promise.resolve().then(async () => {
    const response = await fetch("/api/entry", { method: "GET", credentials: "same-origin", cache: "no-store", signal: task.controller.signal });
    if (!response.ok || response.status !== 200) throw new Error("entry_unavailable");
    return response.json();
  });
  task.promise = (async () => {
    try {
      const result = await Promise.race([reading, deadline, cancelled]);
      if (!visible() || !currentEntry(state, ticket)) return;
      acceptEntry(state, ticket, result);
      const { client, administrator } = state.entry;
      const destinations = [];
      if (client?.state === "active" && client.href === "/messages") destinations.push(client.href);
      if (administrator?.state === "connected" && administrator.href === "/admin/messages") destinations.push(administrator.href);
      // A single authenticated role opens its conversation. If both roles are
      // connected, keep the explicit choice instead of guessing an identity.
      const connectedRoles = Number(Boolean(client && client.state !== "signed_out")) + Number(administrator?.state === "connected");
      render();
      if (destinations.length === 1 && connectedRoles === 1 && visible() && currentEntry(state, ticket)) location.replace(destinations[0]);
    } catch {
      if (!visible() || !currentEntry(state, ticket)) return;
      rejectEntry(state, ticket, { offline: !online() }); render();
    } finally { clearTimeout(task.timer); if (checkTask === task) checkTask = null; }
  })();
  return task.promise;
}
async function install() {
  if (!visible() || !online() || standalone() || installBusy || !installEvent) return;
  const event = installEvent, epoch = ++installEpoch; installEvent = null; installBusy = true; installMessage = "installBusy"; renderInstall();
  try {
    const result = await event.prompt(); const choice = await (event.userChoice ?? result);
    if (epoch !== installEpoch || !visible() || !online() || standalone()) return;
    installMessage = choice?.outcome === "accepted" ? "installAccepted" : "installCancelled";
  } catch { if (epoch === installEpoch && visible() && online() && !standalone()) installMessage = "installError"; }
  finally { if (epoch === installEpoch) { installBusy = false; renderInstall(); } }
}
if (sharedLanguage) sharedLanguage.onChange((next) => { language = next; render(); });
else el("language-switch").addEventListener("click", () => { language = language === "fr" ? "en" : "fr"; render(); });
el("entry-retry").addEventListener("click", () => { if (!checkTask) void checkAccess(); });
el("install-app").addEventListener("click", () => { void install(); });
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  if (!visible() || !online() || standalone() || installBusy || typeof event.prompt !== "function") return;
  installEpoch += 1; installEvent = event; installMessage = ""; renderInstall();
});
window.addEventListener("appinstalled", () => { clearInstall(); installed = true; installMessage = "installed"; renderInstall(); });
displayMode?.addEventListener?.("change", () => { clearInstall(); renderInstall(); });
window.addEventListener("online", () => { if (visible()) { renderInstall(); void checkAccess(); } });
window.addEventListener("offline", () => { clearInstall(); if (!visible()) return; cancelCheck(); const ticket = beginEntryCheck(state); rejectEntry(state, ticket, { offline: true }); render(); });
document.addEventListener("visibilitychange", () => { if (visible()) void checkAccess(); else suspend(); });
window.addEventListener("pagehide", suspend);
window.addEventListener("pageshow", (event) => { if (visible() && (event.persisted || !state.visible)) void checkAccess(); });
cleanLocation(); render(); if (visible()) void checkAccess();
