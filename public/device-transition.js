(() => {
  "use strict";
  const legacy = document.documentElement.dataset.transitionLegacy, primary = document.documentElement.dataset.transitionPrimary;
  const path = /^\/connect-device\/(admin|client)$/.exec(location.pathname);
  const role = path?.[1], start = document.getElementById("transition-start"), status = document.getElementById("transition-status");
  const login = document.getElementById("transition-login"), back = document.getElementById("transition-back");
  const language = document.getElementById("transition-language");
  const words = {
    fr: { eyebrow: "TOUJOURS À TES CÔTÉS", title: "Ton espace trouve sa nouvelle adresse.", copy: "Retrouve tes messages sur jessiemessage.com, en gardant la connexion de cet appareil.",
      start: "Retrouver mon espace", back: "Revenir à mon espace", login: "Me connecter", note: "Les notifications et l’icône de l’app se règlent ensuite sur la nouvelle adresse.",
      preparing: "Un instant, on retrouve ton espace…", unavailable: "La reprise n’a pas abouti. Tu peux réessayer ou revenir à ton espace.",
      missing: "Pour retrouver tes messages, connecte-toi une fois sur la nouvelle adresse.",
      conflict: "Un autre compte est déjà ouvert à cette adresse. Reviens à l’espace de ce compte pour continuer.", retry: "Réessayer", badLink: "Ce lien n’est plus disponible. Recommence depuis la nouvelle adresse." },
    en: { eyebrow: "ALWAYS CLOSE BY", title: "Your space has a new address.", copy: "Find your messages at jessiemessage.com and keep this device signed in.",
      start: "Find my space", back: "Back to my space", login: "Sign in", note: "Notifications and the app icon can then be set up at the new address.",
      preparing: "Just a moment while we find your space…", unavailable: "We couldn’t finish this time. Try again or return to your space.",
      missing: "To find your messages, sign in once at the new address.",
      conflict: "Another account is already open at this address. Return to that account’s space to continue.", retry: "Try again", badLink: "This link is no longer available. Start again at the new address." },
  };
  let locale = document.documentElement.lang === "en" ? "en" : "fr", statusKey = null, busy = false, epoch = 0, active = true;
  const pending = new Set();
  function render() {
    const t = words[locale]; document.documentElement.lang = locale;
    for (const [id, key] of [["transition-eyebrow", "eyebrow"], ["transition-title", "title"], ["transition-copy", "copy"], ["transition-notifications", "note"]]) document.getElementById(id).textContent = t[key];
    start.textContent = t[statusKey && statusKey !== "preparing" ? "retry" : "start"]; back.textContent = t.back; login.textContent = t.login;
    status.textContent = statusKey ? t[statusKey] : ""; language.textContent = locale === "fr" ? "EN" : "FR";
    language.setAttribute("aria-label", locale === "fr" ? "Switch to English" : "Passer en français");
  }
  language.addEventListener("click", () => { locale = locale === "fr" ? "en" : "fr"; render(); });
  // Read once, then remove the complete fragment before any asynchronous work.
  const fragment = location.hash;
  history.replaceState(null, "", location.pathname);
  const value = /^#(challenge|ticket)=([A-Za-z0-9_-]{80,2048})(?:&notification=([a-f0-9]{32}))?$/.exec(fragment);
  // The public message reference only helps restart an interrupted handoff.
  // Completion still follows the server's authenticated packet destination.
  const notification = value?.[3] ?? /^#notification=([a-f0-9]{32})$/.exec(fragment)?.[1] ?? null;
  const retryHint = notification ? `&notification=${notification}` : "";
  const page = `/connect-device/${role}`;
  const messagePath = role === "admin" ? "/admin/messages" : "/messages";
  const allowedDestination = role === "admin" ? /^\/admin\/messages(?:#notification=[a-f0-9]{32})?$/ : /^\/(?:messages|access)(?:#notification=[a-f0-9]{32})?$/;
  const setState = (key) => { statusKey = key; render(); };
  function requireCurrent(generation) { if (!active || generation !== epoch) throw new Error("unavailable"); }
  async function requestJson(url, options, generation) {
    requireCurrent(generation);
    const controller = new AbortController(); pending.add(controller);
    const timer = setTimeout(() => controller.abort(), 8000);
    const aborted = new Promise((resolve, reject) => controller.signal.addEventListener("abort", () => reject(new Error("unavailable")), { once: true }));
    try {
      // The same deadline covers receiving headers and reading the JSON body.
      const work = (async () => {
        const response = await fetch(url, { ...options, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal });
        const result = await response.json();
        return { response, result };
      })();
      const result = await Promise.race([work, aborted]);
      requireCurrent(generation); return result;
    } finally { clearTimeout(timer); pending.delete(controller); }
  }
  async function post(action, input, csrf, generation) {
    const { response, result } = await requestJson(`/api/device-transition/${role}/${action}`, { method: "POST",
      headers: { "Content-Type": "application/json", "X-Jessie-Request": "1", ...(csrf ? { "X-CSRF-Token": csrf } : {}) }, body: JSON.stringify(input) }, generation);
    if (!response.ok) throw Object.assign(new Error("unavailable"), { status: response.status, code: result?.error, login: result?.login });
    return result;
  }
  async function run(action) {
    if (busy || !active) return; const generation = ++epoch;
    busy = true; start.disabled = true; login.hidden = true; setState("preparing");
    try {
      if (action === "authorize") {
        const { response, result: session } = await requestJson(role === "admin" ? "/api/auth/session" : "/api/access/session", { method: "GET" }, generation);
        if (!response.ok && response.status !== 401) throw new Error("unavailable");
        const current = response.ok ? session : null;
        if (current && (current.user?.role !== role || typeof current.csrf !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(current.csrf))) throw new Error("unavailable");
        const result = await post("authorize", { challenge: value[2] }, current?.csrf, generation);
        if (typeof result.ticket !== "string" || !/^[A-Za-z0-9_-]{80,2048}$/.test(result.ticket)) throw new Error("unavailable");
        location.replace(`${primary}${page}#ticket=${result.ticket}${retryHint}`);
      } else if (action === "complete") {
        const result = await post("complete", { ticket: value[2] }, undefined, generation);
        if (typeof result.destination !== "string" || !allowedDestination.test(result.destination)) throw new Error("unavailable");
        location.replace(result.destination);
      } else {
        if (location.origin !== primary) { location.assign(`${primary}${page}${notification ? `#notification=${notification}` : ""}`); return; }
        const result = await post("begin", { notification }, undefined, generation);
        if (typeof result.challenge !== "string" || !/^[A-Za-z0-9_-]{80,2048}$/.test(result.challenge)) throw new Error("unavailable");
        location.replace(`${legacy}${page}#challenge=${result.challenge}${retryHint}`);
      }
    } catch (error) {
      if (!active || generation !== epoch) return;
      setState(error.status === 401 ? "missing" : error.status === 409 && error.code === "account_conflict" ? "conflict" : "unavailable");
      if (error.status === 401) {
        const allowedLogin = role === "admin" ? /^\/admin\/login(?:#notification=[a-f0-9]{32})?$/ : /^\/access(?:#notification=[a-f0-9]{32})?$/;
        login.href = `${primary}${typeof error.login === "string" && allowedLogin.test(error.login) ? error.login : role === "admin" ? "/admin/login" : "/access"}`;
        login.hidden = false;
      }
      start.disabled = false; busy = false;
    }
  }
  window.addEventListener("pagehide", () => {
    active = false; epoch += 1;
    for (const controller of pending) controller.abort();
  });
  window.addEventListener("pageshow", () => {
    if (active) return; active = true; busy = false; start.disabled = false;
    if (statusKey === "preparing") setState("unavailable");
  });
  back.href = `${location.origin === legacy ? legacy : primary}${messagePath}`;
  start.addEventListener("click", () => void run("begin")); render();
  if (!role || ![legacy, primary].includes(location.origin) || location.search) { setState("badLink"); start.hidden = true; return; }
  if (fragment && !value && notification === null) { setState("badLink"); return; }
  if (value) {
    if (value[1] === "challenge" && location.origin === legacy) void run("authorize");
    else if (value[1] === "ticket" && location.origin === primary) void run("complete");
    else setState("badLink");
  }
})();
