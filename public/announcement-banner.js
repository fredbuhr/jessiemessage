const date = value => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
const revision = value => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
export function parseAnnouncementBannerResponse(value) {
  if (!value || !date(value.serverTime) || !Object.hasOwn(value, "announcement")) throw new TypeError("invalid_announcement");
  const item = value.announcement;
  if (item !== null && (!item || typeof item.id !== "string" || !/^[a-f0-9]{32}$/.test(item.id) || !revision(item.revision)
    || typeof item.body !== "string" || !item.body.trim() || item.body.length > 1000 || !item.body.isWellFormed()
    || !date(item.startsAt) || !date(item.expiresAt) || item.startsAt > value.serverTime || item.expiresAt <= value.serverTime)) throw new TypeError("invalid_announcement");
  return { serverTime: value.serverTime, announcement: item === null ? null : { id: item.id, revision: item.revision, body: item.body, startsAt: item.startsAt, expiresAt: item.expiresAt } };
}

export function createAnnouncementBanner({ host, menuParent, request, isCurrent, getReturnFocus, onError = () => {}, ui = globalThis.JessieI18n }) {
  const clock = () => globalThis.performance?.now?.() ?? Date.now();
  let destroyed = false, epoch = 0, busy = false, lastRefresh = -Infinity, announcement = null, dismissed = false, expiryAt = null, expiryTimer = null, opener = null;
  const node = (tag, id, className) => { const item = document.createElement(tag); if (id) item.id = id; if (className) item.className = className; return item; };
  let style = document.getElementById("announcement-banner-style");
  if (!style) { style = node("link", "announcement-banner-style"); style.rel = "stylesheet"; style.href = "/announcement-banner.css"; document.head.append(style); }
  const banner = node("section", "announcement-banner", "announcement-banner"); banner.hidden = true;
  ui.attr(banner, "aria-label", "Une nouvelle pour toi");
  const preview = node("p", "announcement-preview", "announcement-preview");
  const openButton = node("button", "open-announcement", "announcement-button"); openButton.type = "button"; openButton.textContent = "›";
  ui.attr(openButton, "aria-label", "Lire l’annonce"); openButton.setAttribute("aria-haspopup", "dialog");
  const hideButton = node("button", "hide-announcement", "announcement-button"); hideButton.type = "button"; hideButton.textContent = "×"; ui.attr(hideButton, "aria-label", "Masquer l’annonce");
  banner.append(preview, openButton, hideButton); host.prepend(banner);
  const available = node("p", "announcement-available", "sr-only"); available.setAttribute("role", "status"); available.setAttribute("aria-live", "polite"); host.prepend(available);
  const menuButton = node("button", "open-current-announcement", "text-button"); menuButton.type = "button"; menuButton.hidden = true;
  ui.text(menuButton, "L’annonce du moment"); menuButton.setAttribute("aria-haspopup", "dialog"); menuParent.append(menuButton);
  const dialog = node("dialog", "announcement-dialog", "announcement-dialog");
  const heading = node("h2", "announcement-title"); ui.text(heading, "Une nouvelle pour toi"); dialog.setAttribute("aria-labelledby", heading.id);
  const closeButton = node("button", "close-announcement", "text-button"); closeButton.type = "button"; ui.text(closeButton, "Fermer");
  const body = node("p", "announcement-body", "announcement-body"); dialog.append(heading, body, closeButton); document.body.append(dialog);
  function focusReturn() {
    if (!isCurrent() || document.visibilityState !== "visible") return;
    const target = opener?.isConnected && !opener.hidden && !banner.hidden && banner.contains(opener) ? opener : getReturnFocus?.();
    target?.focus?.({ preventScroll: true });
  }
  function close(restore = false) { const opened = dialog.open; if (opened) dialog.close(); if (opened && restore) focusReturn(); }
  function clearContent(restore = false) {
    const restoreFocus = restore && (dialog.open || banner.contains(document.activeElement) || document.activeElement === menuButton);
    banner.hidden = true; menuButton.hidden = true; close(); announcement = null; dismissed = false; expiryAt = null;
    ui.rawText(preview, ""); ui.rawText(body, ""); ui.rawText(available, ""); clearTimeout(expiryTimer); expiryTimer = null;
    if (restoreFocus) focusReturn();
  }
  function expire() {
    if (!announcement || destroyed || !isCurrent()) return;
    const remaining = expiryAt - clock();
    if (remaining <= 0) clearContent(dialog.open || banner.contains(document.activeElement));
    else { clearTimeout(expiryTimer); expiryTimer = setTimeout(expire, Math.min(remaining, 2147483647)); }
  }
  function open(event) {
    expire(); if (!announcement || !isCurrent() || destroyed) return;
    opener = event?.currentTarget ?? openButton;
    if (!dialog.open) dialog.showModal(); closeButton.focus({ preventScroll: true });
  }
  function render(value, elapsed) {
    const item = value.announcement;
    if (!item) { clearContent(dialog.open || banner.contains(document.activeElement)); return; }
    const changed = !announcement || announcement.id !== item.id || announcement.revision !== item.revision;
    if (changed) { close(dialog.open); dismissed = false; ui.rawText(available, ui.t("Une nouvelle annonce est disponible.")); }
    announcement = item; expiryAt = clock() + Math.max(0, item.expiresAt - value.serverTime - elapsed);
    if (preview.textContent !== item.body) ui.rawText(preview, item.body);
    if (body.textContent !== item.body) ui.rawText(body, item.body);
    banner.hidden = dismissed; menuButton.hidden = false; expire();
  }
  async function refresh(force = false) {
    if (destroyed || !isCurrent() || busy || !force && clock() - lastRefresh < 30000) return;
    const ticket = ++epoch, started = clock(); busy = true; lastRefresh = started;
    try {
      const result = parseAnnouncementBannerResponse(await request("/api/announcements/client/current", { account: true }));
      if (ticket === epoch && !destroyed && isCurrent()) render(result, Math.max(0, clock() - started));
    } catch (error) {
      if (ticket === epoch && !destroyed && isCurrent()) {
        if (error.status === 404) clearContent();
        else { expire(); if (!error.stale) onError(error); }
      }
    } finally { if (ticket === epoch) busy = false; }
  }
  openButton.addEventListener("click", open); menuButton.addEventListener("click", open);
  closeButton.addEventListener("click", () => close(true));
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(true); });
  hideButton.addEventListener("click", () => { dismissed = true; banner.hidden = true; getReturnFocus?.()?.focus?.({ preventScroll: true }); });
  const unsubscribe = ui.onChange(() => { ui.rawText(available, ""); });
  return {
    refresh,
    suspend() { epoch += 1; busy = false; lastRefresh = -Infinity; close(); banner.hidden = true; menuButton.hidden = true; clearTimeout(expiryTimer); expiryTimer = null; ui.rawText(preview, ""); ui.rawText(body, ""); ui.rawText(available, ""); },
    destroy() { if (destroyed) return; destroyed = true; epoch += 1; clearContent(); unsubscribe(); ui.forget(banner); ui.forget(menuButton); ui.forget(dialog); banner.remove(); available.remove(); menuButton.remove(); dialog.remove(); },
  };
}
