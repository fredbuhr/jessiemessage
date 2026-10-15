const ID = /^[0-9a-f]{32}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const date = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
export function parseBroadcastPreference(input) {
  if (typeof input?.enabled !== "boolean" || typeof input.version !== "string" || input.version.length > 20 || !/^(0|[1-9][0-9]*)$/.test(input.version)
    || BigInt(input.version) > 18446744073709551615n || input.updatedAt !== null && !date(input.updatedAt)
    || input.version === "0" && (input.enabled || input.updatedAt !== null) || input.version !== "0" && input.updatedAt === null) throw new TypeError("invalid_broadcast_preference");
  return { enabled: input.enabled, version: input.version, updatedAt: input.updatedAt };
}
export function createPreferenceState() { return { epoch: 0, visible: false, session: null, preference: null, busy: false, refreshRequired: false }; }
export function clearPreference(state, { visible = false } = {}) { state.epoch += 1; state.visible = visible; state.session = null; state.preference = null; state.busy = false; state.refreshRequired = false; return preferenceTicket(state); }
export function preferenceTicket(state) { return { epoch: state.epoch, clientId: state.session?.id ?? null }; }
export function currentPreference(state, ticket) { return state.visible && ticket.epoch === state.epoch && (ticket.clientId === null || ticket.clientId === state.session?.id); }
export function acceptPreferenceSession(state, ticket, input, now = Date.now()) {
  if (!currentPreference(state, ticket)) return false;
  if (input?.user?.role !== "client" || typeof input.user.id !== "string" || input.user.id.length !== 32 || !ID.test(input.user.id)
    || typeof input.csrf !== "string" || input.csrf.length !== 43 || !TOKEN.test(input.csrf) || !date(input.expiresAt) || input.expiresAt <= now) { clearPreference(state); return false; }
  if (state.session && (state.session.id !== input.user.id || state.session.csrf !== input.csrf)) { clearPreference(state, { visible: true }); return false; }
  state.session = { id: input.user.id, csrf: input.csrf, expiresAt: input.expiresAt }; return true;
}
export function acceptPreference(state, ticket, input) {
  if (!currentPreference(state, ticket) || !state.session) return false; state.preference = parseBroadcastPreference(input); state.refreshRequired = false; return true;
}
export function preferenceSaveBody(state, enabled, now = Date.now()) {
  if (!state.visible || !state.session || state.session.expiresAt <= now || !state.preference || state.busy || state.refreshRequired || typeof enabled !== "boolean") return null;
  state.busy = true; return { enabled, expectedVersion: state.preference.version };
}

// Loaded only after the account page or chat has authenticated a client. The
// module is protected itself; anonymous login pages never request this asset.
export function mountBroadcastPreference(container, { isCurrent = () => true } = {}) {
  const state = createPreferenceState(); const controllers = new Set(); let disposed = false; let expiryTimer = null;
  const section = document.createElement("section"); section.className = "broadcast-preference"; section.setAttribute("aria-label", "Messages de diffusion");
  section.style.marginTop = "24px"; section.style.paddingTop = "20px"; section.style.borderTop = "1px solid #554353";
  const heading = document.createElement("h2"); heading.textContent = "Les nouvelles de Jessie"; heading.style.fontSize = "18px";
  const copy = document.createElement("p"); copy.className = "session-note"; copy.textContent = "Tu peux accepter les messages que Jessie propose à plusieurs clients. Chacun les reçoit dans sa conversation privée. Ce choix est facultatif et tu peux le retirer à tout moment ; tes échanges directs avec Jessie restent disponibles selon ton accès.";
  const form = document.createElement("form"); const label = document.createElement("label"); label.className = "checkbox-field";
  const checkbox = document.createElement("input"); checkbox.type = "checkbox"; const span = document.createElement("span"); span.textContent = "Je souhaite recevoir les messages de diffusion de Jessie."; label.append(checkbox, span);
  const save = document.createElement("button"); save.type = "submit"; save.className = "button button-secondary secondary"; save.textContent = "Enregistrer mon choix"; save.style.marginTop = "14px";
  const reload = document.createElement("button"); reload.type = "button"; reload.className = "button button-secondary secondary"; reload.textContent = "Recharger mon choix"; reload.style.marginTop = "14px";
  const status = document.createElement("p"); status.className = "status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  form.append(label, save); section.append(heading, copy, form, status, reload); container.append(section);
  const visible = () => document.visibilityState === "visible";
  const alive = () => !disposed && container.isConnected && isCurrent();
  const current = (ticket) => alive() && visible() && currentPreference(state, ticket);
  const stale = () => Object.assign(new Error("stale_response"), { stale: true });
  function notice(text, error = false) { status.textContent = text; status.classList.toggle("is-error", error); }
  function render() { form.hidden = !state.session || !state.preference; checkbox.disabled = state.busy || state.refreshRequired; save.disabled = state.busy || state.refreshRequired; reload.hidden = !state.refreshRequired; }
  function reset(isVisible = false) {
    for (const controller of controllers) controller.abort(); controllers.clear(); clearTimeout(expiryTimer); expiryTimer = null;
    clearPreference(state, { visible: isVisible }); checkbox.checked = false; notice(""); render(); section.hidden = !isVisible;
  }
  function armExpiry() { clearTimeout(expiryTimer); expiryTimer = setTimeout(() => { reset(); }, Math.max(0, Math.min(2147483647, state.session.expiresAt - Date.now()))); }
  async function request(path, { ticket = preferenceTicket(state), body } = {}) {
    const controller = new AbortController(); controllers.add(controller); const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": state.session?.csrf ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
      let data; try { data = await response.json(); } catch { data = {}; }
      if (!current(ticket)) throw stale(); if (!response.ok) throw Object.assign(new Error("preference_unavailable"), { status: response.status, code: data.error }); return data;
    } catch (error) { if (!current(ticket)) throw stale(); throw error; }
    finally { clearTimeout(timer); controllers.delete(controller); }
  }
  async function bootstrap() {
    if (!alive() || !visible()) return; reset(true); const ticket = preferenceTicket(state); notice("Chargement de ton choix…");
    try {
      const session = await request("/api/broadcast/client/session", { ticket });
      if (!acceptPreferenceSession(state, ticket, session)) { reset(); return; } armExpiry();
      const result = await request("/api/broadcast/client/preference", { ticket: preferenceTicket(state) });
      if (acceptPreference(state, preferenceTicket(state), result)) { checkbox.checked = state.preference.enabled; notice(""); render(); }
    } catch (error) {
      if (error.stale) return; if (error.status === 404 || error.status === 401) { reset(); return; }
      state.refreshRequired = true; notice("Ton choix est indisponible pour le moment. Recharge-le pour réessayer.", true); render();
    }
  }
  async function submit(event) {
    event.preventDefault(); const body = preferenceSaveBody(state, checkbox.checked); if (!body) return; const ticket = preferenceTicket(state); render(); notice("Enregistrement de ton choix…");
    try {
      // Never repeat this POST after a conflict or a CSRF failure. A fresh GET
      // requires another explicit save and uses the newly loaded version.
      const before = await request("/api/broadcast/client/session", { ticket });
      if (!acceptPreferenceSession(state, ticket, before)) { await bootstrap(); return; }
      const result = await request("/api/broadcast/client/preference", { ticket, body });
      const after = await request("/api/broadcast/client/session", { ticket });
      if (!acceptPreferenceSession(state, ticket, after)) { await bootstrap(); return; }
      if (acceptPreference(state, ticket, result)) { checkbox.checked = state.preference.enabled; notice(state.preference.enabled ? "Ton choix est enregistré. Tu acceptes les prochaines diffusions de Jessie." : "Ton choix est enregistré. Tu ne recevras pas les prochaines diffusions de Jessie. Les messages déjà reçus restent dans ta conversation."); armExpiry(); }
    } catch (error) {
      if (error.stale) return; if (error.status === 401) { reset(); return; }
      state.refreshRequired = true;
      notice(error.status === 409 ? "Ton choix a changé dans une autre fenêtre. Recharge-le avant de l’enregistrer de nouveau." : error.status === 403 ? "Ta connexion a changé. Recharge ton choix, puis enregistre-le de nouveau." : "L’enregistrement n’a pas été confirmé. Recharge ton choix avant de réessayer.", true);
    } finally { if (current(ticket)) { state.busy = false; render(); } }
  }
  function onVisibility() { if (visible()) void bootstrap(); else reset(); }
  function onPageHide() { reset(); }
  form.addEventListener("submit", submit); reload.addEventListener("click", () => { void bootstrap(); });
  document.addEventListener("visibilitychange", onVisibility); window.addEventListener("pagehide", onPageHide);
  void bootstrap();
  return { clear() { if (disposed) return; reset(); disposed = true; document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("pagehide", onPageHide); section.remove(); }, reload: bootstrap };
}
