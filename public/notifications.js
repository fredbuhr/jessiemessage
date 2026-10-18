"use strict";
(() => {
  const words = {
    "Notifications": "Notifications",
    "Un petit signe quand un message arrive, même si Jessie est fermée.": "A little heads-up when a message arrives, even when Jessie is closed.",
    "Les alertes restent discrètes : aucun nom, texte ou photo du message n’apparaît.": "Alerts stay discreet: no name, message text or photo is shown.",
    "Ces réglages concernent uniquement cet appareil.": "These settings apply only to this device.",
    "Préparation des notifications…": "Preparing notifications…",
    "Notifications désactivées sur cet appareil.": "Notifications are off on this device.",
    "Notifications activées sur cet appareil.": "Notifications are on on this device.",
    "Activer sur cet appareil": "Turn on on this device",
    "Désactiver sur cet appareil": "Turn off on this device",
    "Vérifier à nouveau": "Check again",
    "Activation en cours…": "Turning notifications on…",
    "Désactivation en cours…": "Turning notifications off…",
    "Le navigateur a bloqué les notifications. Autorise-les dans les réglages de ce site, puis vérifie à nouveau.": "Your browser has blocked notifications. Allow them in this site’s settings, then check again.",
    "Tu n’as pas activé les notifications. Tu peux réessayer quand tu veux.": "Notifications are still off. You can try again whenever you like.",
    "Les notifications ne sont pas disponibles dans ce navigateur. Essaie dans ton navigateur habituel.": "Notifications are not available in this browser. Try your usual browser.",
    "Sur iPhone ou iPad : ouvre Partager, choisis « Sur l’écran d’accueil », puis ouvre Jessie depuis son icône pour activer les notifications.": "On iPhone or iPad: open Share, choose “Add to Home Screen”, then open Jessie from its icon to turn notifications on.",
    "Les réglages n’ont pas pu être vérifiés. Réessaie quand la connexion revient.": "The settings could not be checked. Try again when the connection is back.",
    "L’activation n’est pas confirmée. Vérifie à nouveau avant de réessayer.": "Activation is not confirmed. Check again before trying again.",
    "La désactivation n’est pas confirmée. Vérifie à nouveau avant de réessayer.": "Deactivation is not confirmed. Check again before trying again.",
    "Cette connexion a changé. Rouvre ton espace pour régler les notifications.": "This sign-in has changed. Reopen your space to adjust notifications.",
    "Cet appareil utilise les notifications d’un autre compte. Réinitialise-les ici avant d’activer les tiennes.": "This device uses notifications from another account. Reset them here before turning on yours.",
    "Réinitialiser sur cet appareil": "Reset on this device",
    "Réinitialisation en cours…": "Resetting…",
    "C’est réinitialisé. Active maintenant les notifications pour ce compte. Les autres appareils restent inchangés.": "Reset complete. Now turn notifications on for this account. Your other devices are unchanged.",
    "La réinitialisation n’est pas confirmée. Vérifie à nouveau avant de réessayer.": "The reset is not confirmed. Check again before trying again.",
    "Les réglages de cet appareil ont changé. Réinitialise les notifications ici pour continuer.": "This device’s settings have changed. Reset notifications here to continue.",
    "Trop de demandes. Patiente un peu, puis vérifie à nouveau.": "Too many requests. Wait a little, then check again.",
    "Le maximum d’appareils est atteint. Désactive les notifications sur un appareil que tu n’utilises plus, puis réessaie.": "The device limit has been reached. Turn notifications off on a device you no longer use, then try again.",
    "Les notifications sont désactivées ici. Les autres appareils restent inchangés.": "Notifications are off here. Your other devices are unchanged.",
  };
  globalThis.JessieI18n?.register(words);
  const ui = globalThis.JessieI18n ?? {
    text(node, source) { node.textContent = source; }, rawText(node, value) { node.textContent = value; }, forget() {}, getLanguage() { return "fr"; },
  };
  const fixedError = (code, status) => Object.assign(new Error(code), { code, status });
  const visible = () => document.visibilityState === "visible";
  function decodeKey(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(value)) throw fixedError("invalid_capability");
    const raw = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=");
    const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
    if (bytes.length !== 65 || bytes[0] !== 4) throw fixedError("invalid_capability");
    return bytes;
  }
  function mount(host, { role, owner, isCurrent, onAvailability = () => {} }) {
    if (!host || !["admin", "client"].includes(role) || !/^[a-f0-9]{32}$/.test(owner?.id)
      || !/^[A-Za-z0-9_-]{43}$/.test(owner?.csrf) || typeof isCurrent !== "function") throw new TypeError("Invalid notification view.");
    let disposed = false, epoch = 0, busy = false, ready = false, registration = null, localSubscription = null;
    let subscriptionId = null, enabled = false, applicationServerKey = null;
    const controllers = new Set(), base = `/api/notifications/${role}`, sessionPath = role === "admin" ? "/api/auth/session" : "/api/access/session";
    const card = document.createElement("section"); card.className = "notification-card";
    const heading = document.createElement("h2"); ui.text(heading, "Notifications"); card.append(heading);
    for (const source of ["Un petit signe quand un message arrive, même si Jessie est fermée.", "Les alertes restent discrètes : aucun nom, texte ou photo du message n’apparaît.", "Ces réglages concernent uniquement cet appareil."]) {
      const note = document.createElement("p"); note.className = "notification-note"; ui.text(note, source); card.append(note);
    }
    const status = document.createElement("p"); status.className = "notification-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); card.append(status);
    const install = document.createElement("p"); install.className = "notification-note"; install.hidden = true;
    ui.text(install, "Sur iPhone ou iPad : ouvre Partager, choisis « Sur l’écran d’accueil », puis ouvre Jessie depuis son icône pour activer les notifications."); card.append(install);
    const actions = document.createElement("div"); actions.className = "notification-actions"; card.append(actions);
    const button = (source, name) => { const node = document.createElement("button"); node.type = "button"; node.className = "notification-button"; node.dataset.notificationAction = name; ui.text(node, source); actions.append(node); return node; };
    const enableButton = button("Activer sur cet appareil", "enable"), disableButton = button("Désactiver sur cet appareil", "disable"), retryButton = button("Vérifier à nouveau", "retry"), resetButton = button("Réinitialiser sur cet appareil", "reset");
    const buttons = [enableButton, disableButton, retryButton, resetButton];
    host.replaceChildren(card); host.hidden = true;
    const current = (ticket = epoch) => !disposed && ticket === epoch && visible() && isCurrent();
    const stale = () => fixedError("stale_view");
    function state(source, { error = false, canEnable = false, canDisable = false, retry = false, reset = false } = {}) {
      ui.text(status, source); status.classList.toggle("is-error", error);
      enableButton.hidden = !canEnable; disableButton.hidden = !canDisable; retryButton.hidden = !retry; resetButton.hidden = !reset;
      for (const node of buttons) node.disabled = busy;
      card.setAttribute("aria-busy", String(busy));
    }
    async function request(path, body, ticket) {
      if (!current(ticket)) throw stale();
      const controller = new AbortController(); controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const mutation = body !== undefined;
        const response = await fetch(path, { method: mutation ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
          headers: mutation ? { "Content-Type": "application/json", "X-CSRF-Token": owner.csrf } : {},
          ...(mutation ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
        let result;
        try { result = await response.json(); } catch { if (response.ok) throw fixedError("invalid_response"); }
        if (!current(ticket)) throw stale();
        if (!response.ok) throw fixedError(result?.error ?? "request_failed", response.status);
        return result;
      } finally { clearTimeout(timer); controllers.delete(controller); }
    }
    async function proof(ticket) {
      const result = await request(sessionPath, undefined, ticket);
      if (result?.user?.id !== owner.id || result.user.role !== role || result.csrf !== owner.csrf
        || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) throw fixedError("identity_changed", 401);
    }
    function problem(error, operation = "check") {
      if (error.code === "stale_view" || disposed) return;
      const message = error.status === 401 || error.status === 403 ? "Cette connexion a changé. Rouvre ton espace pour régler les notifications."
        : error.code === "subscription_conflict" ? "Cet appareil utilise les notifications d’un autre compte. Réinitialise-les ici avant d’activer les tiennes."
        : error.code === "subscription_limit" ? "Le maximum d’appareils est atteint. Désactive les notifications sur un appareil que tu n’utilises plus, puis réessaie."
        : error.status === 429 ? "Trop de demandes. Patiente un peu, puis vérifie à nouveau."
        : operation === "enable" ? "L’activation n’est pas confirmée. Vérifie à nouveau avant de réessayer."
        : operation === "disable" ? "La désactivation n’est pas confirmée. Vérifie à nouveau avant de réessayer."
        : operation === "reset" ? "La réinitialisation n’est pas confirmée. Vérifie à nouveau avant de réessayer."
        : "Les réglages n’ont pas pu être vérifiés. Réessaie quand la connexion revient.";
      state(message, { error: true, retry: true, reset: error.code === "subscription_conflict" });
    }
    async function bounded(task) {
      let timer;
      try { return await Promise.race([task, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(fixedError("browser_timeout")), 15000); })]); }
      finally { clearTimeout(timer); }
    }
    function support() {
      return globalThis.isSecureContext === true && typeof globalThis.Notification?.permission === "string"
        && typeof globalThis.PushManager === "function" && typeof navigator.serviceWorker?.register === "function";
    }
    function keyMatches(subscription) {
      try {
        const key = subscription?.options?.applicationServerKey;
        const bytes = new Uint8Array(key);
        return bytes.length === applicationServerKey.length && bytes.every((value, index) => value === applicationServerKey[index]);
      } catch { return false; }
    }
    function showPermissionState() {
      if (Notification.permission === "denied") state("Le navigateur a bloqué les notifications. Autorise-les dans les réglages de ce site, puis vérifie à nouveau.", { canDisable: enabled, retry: true });
      else if (enabled && Notification.permission === "granted") state("Notifications activées sur cet appareil.", { canDisable: true, retry: true });
      else state("Notifications désactivées sur cet appareil.", { canEnable: ready, canDisable: enabled, retry: true });
    }
    async function prepare() {
      if (busy || !current()) return;
      const ticket = ++epoch; busy = true; ready = false;
      state("Préparation des notifications…");
      try {
        await proof(ticket);
        const capability = await request(`${base}/capabilities`, undefined, ticket);
        if (capability?.enabled !== true) throw fixedError("invalid_capability");
        applicationServerKey = decodeKey(capability.vapidPublicKey);
        await proof(ticket);
        if (!current(ticket)) throw stale();
        host.hidden = false; onAvailability(true);
        const standalone = navigator.standalone === true || globalThis.matchMedia?.("(display-mode: standalone)")?.matches === true;
        const appleMobile = /^(iPhone|iPad|iPod)$/.test(navigator.platform ?? "") || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
        install.hidden = !appleMobile || standalone;
        if (!support() || appleMobile && !standalone) {
          state("Les notifications ne sont pas disponibles dans ce navigateur. Essaie dans ton navigateur habituel.", { retry: true }); return;
        }
        const result = await bounded(navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }));
        registration = result?.active ? result : await bounded(navigator.serviceWorker.ready);
        if (!current(ticket)) throw stale();
        if (!registration?.active || typeof registration.pushManager?.getSubscription !== "function") throw fixedError("browser_not_ready");
        localSubscription = await bounded(registration.pushManager.getSubscription());
        if (!current(ticket)) throw stale();
        subscriptionId = null; enabled = false;
        if (localSubscription) {
          const result = await request(`${base}/status`, { endpoint: localSubscription.endpoint }, ticket);
          if (typeof result?.enabled !== "boolean" || !(result.subscriptionId === null || /^[a-f0-9]{32}$/.test(result.subscriptionId)) || result.enabled && result.subscriptionId === null) throw fixedError("invalid_status");
          await proof(ticket); enabled = result.enabled; subscriptionId = result.subscriptionId;
        }
        ready = true;
        if (localSubscription && !keyMatches(localSubscription)) state("Les réglages de cet appareil ont changé. Réinitialise les notifications ici pour continuer.", { reset: true, canDisable: enabled, retry: true });
        else showPermissionState();
      } catch (error) {
        if (!current(ticket)) return;
        if (error.status === 404) { host.hidden = true; onAvailability(false); }
        else { host.hidden = false; onAvailability(true); problem(error); }
      } finally { if (current(ticket)) { busy = false; for (const node of buttons) node.disabled = false; card.setAttribute("aria-busy", "false"); } }
    }
    function enable() {
      if (busy || !ready || !current() || Notification.permission === "denied" || localSubscription && !keyMatches(localSubscription)) return;
      const ticket = epoch;
      let subscription;
      // WebKit requires subscribe itself to stay in the original click stack.
      // It handles the browser permission prompt; SW and VAPID are already ready.
      // The authenticated owner is proved before sending anything to our API.
      try { subscription = localSubscription && Notification.permission === "granted" ? Promise.resolve(localSubscription) : registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }); }
      catch (error) { problem(error, "enable"); return; }
      busy = true; state("Activation en cours…");
      void (async () => {
        try {
          localSubscription = await subscription;
          if (!current(ticket)) throw stale();
          await proof(ticket);
          const data = localSubscription.toJSON();
          const result = await request(`${base}/subscription`, { subscription: data, language: ui.getLanguage() === "en" ? "en" : "fr" }, ticket);
          if (result?.enabled !== true || !/^[a-f0-9]{32}$/.test(result.subscriptionId)) throw fixedError("invalid_status");
          await proof(ticket); enabled = true; subscriptionId = result.subscriptionId; showPermissionState();
        } catch (error) {
          if (!current(ticket)) return;
          if (Notification.permission === "denied") state("Le navigateur a bloqué les notifications. Autorise-les dans les réglages de ce site, puis vérifie à nouveau.", { retry: true });
          else if (Notification.permission === "default" && error.name === "NotAllowedError") state("Tu n’as pas activé les notifications. Tu peux réessayer quand tu veux.", { canEnable: true, retry: true });
          else problem(error, "enable");
        } finally { if (current(ticket)) { busy = false; for (const node of buttons) node.disabled = false; card.setAttribute("aria-busy", "false"); } }
      })();
    }
    async function reset() {
      if (busy || !ready || !current() || !registration) return;
      const ticket = epoch; busy = true; state("Réinitialisation en cours…");
      try {
        await proof(ticket);
        const previous = await bounded(registration.pushManager.getSubscription());
        if (!current(ticket)) throw stale();
        if (previous && await bounded(previous.unsubscribe()) !== true && await bounded(registration.pushManager.getSubscription())) throw fixedError("reset_failed");
        if (!current(ticket)) throw stale();
        localSubscription = null; subscriptionId = null; enabled = false;
        // A second explicit click calls subscribe in a fresh gesture. Never
        // replace an account's browser subscription after an ambiguous POST.
        state("C’est réinitialisé. Active maintenant les notifications pour ce compte. Les autres appareils restent inchangés.", { canEnable: true, retry: true });
      } catch (error) { if (current(ticket)) problem(error, "reset"); }
      finally { if (current(ticket)) { busy = false; for (const node of buttons) node.disabled = false; card.setAttribute("aria-busy", "false"); } }
    }
    async function disable() {
      if (busy || !enabled || !subscriptionId || !current()) return;
      const ticket = epoch; busy = true; state("Désactivation en cours…");
      try {
        await proof(ticket);
        const result = await request(`${base}/disable`, { id: subscriptionId }, ticket);
        if (result?.enabled !== false) throw fixedError("invalid_status");
        await proof(ticket); enabled = false; subscriptionId = null;
        try { if (localSubscription) await bounded(localSubscription.unsubscribe()); } catch { /* The server preference already prevents delivery. */ }
        if (!current(ticket)) throw stale();
        localSubscription = null; state("Les notifications sont désactivées ici. Les autres appareils restent inchangés.", { canEnable: true, retry: true });
      } catch (error) { if (current(ticket)) problem(error, "disable"); }
      finally { if (current(ticket)) { busy = false; for (const node of buttons) node.disabled = false; card.setAttribute("aria-busy", "false"); } }
    }
    enableButton.addEventListener("click", enable); disableButton.addEventListener("click", () => { void disable(); }); retryButton.addEventListener("click", () => { void prepare(); }); resetButton.addEventListener("click", () => { void reset(); });
    void prepare();
    return { clear() { if (disposed) return; disposed = true; epoch += 1; for (const controller of controllers) controller.abort(); controllers.clear(); ui.forget(host); host.replaceChildren(); host.hidden = true; }, refresh: prepare };
  }
  globalThis.JessieNotifications = Object.freeze({ mount });
})();
