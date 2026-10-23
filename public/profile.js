import { prepareImageUpload } from "./image-preparation.js";
import "./i18n-profile.js";
import { createPasswordChangeUI } from "./password-change.js";
import { createPreferencesUI } from "./preferences.js";

const MAX_AVATAR_BYTES = 262144;
let instance = 0;
const ui = globalThis.JessieI18n ?? {
  text(node, value) { node.textContent = value; },
  attr(node, name, value) { node.setAttribute(name, value); },
  forget() {}
};
const aborted = signal => { if (signal?.aborted) throw new DOMException("Aborted", "AbortError"); };
const invalidImage = () => Object.assign(new Error("invalid_avatar"), { code: "media_format" });
const validAvatar = blob => blob instanceof Blob && blob.type === "image/jpeg" && blob.size > 0 && blob.size <= MAX_AVATAR_BYTES;

// Reuse the bounded image decoder, then crop its normalized image on-device.
// The media endpoint independently validates and normalizes this JPEG again.
export async function prepareProfileAvatar(file, { signal } = {}) {
  const prepared = await prepareImageUpload(file, { signal });
  aborted(signal);
  let bitmap, canvas;
  try {
    bitmap = await globalThis.createImageBitmap(prepared);
    aborted(signal);
    if (!Number.isInteger(bitmap.width) || !Number.isInteger(bitmap.height) || bitmap.width < 1 || bitmap.height < 1
      || bitmap.width > 16384 || bitmap.height > 16384 || bitmap.width * bitmap.height > 64000000) throw invalidImage();
    canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw invalidImage();
    const side = Math.min(bitmap.width, bitmap.height);
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, 256, 256);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(value => {
      if (validAvatar(value)) resolve(value); else reject(invalidImage());
    }, "image/jpeg", 0.88));
    aborted(signal);
    return blob;
  } finally {
    bitmap?.close?.();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

const validName = value => typeof value === "string" && value.trim().normalize("NFC").length >= 1 && value.trim().normalize("NFC").length <= 64
  && !/[\p{Cc}\p{Cf}]/u.test(value) && (typeof value.isWellFormed !== "function" || value.isWellFormed());

// request is the chat's owner-checked JSON/CSRF adapter. fetchBinary must use
// the same owner checks and return a bounded Blob, never an object URL.
export function createProfileUI(adapter) {
  const { role, request, fetchBinary, isCurrent, onSaved, onError, avatarsEnabled = true,
    prepareAvatar = prepareProfileAvatar, host = document.body, button: openerButton, getReturnFocus, onPasswordChanged, passwordEnabled = false, preferencesEnabled = false } = adapter;
  if (!["admin", "client"].includes(role) || typeof request !== "function" || typeof isCurrent !== "function"
    || avatarsEnabled && typeof fetchBinary !== "function" || typeof prepareAvatar !== "function") throw new TypeError("invalid_profile_adapter");
  const base = `/api/profile/${role}`, media = `/api/media/${role}/assets`;
  const node = (tag, text = null, className = "") => {
    const value = document.createElement(tag); if (className) value.className = className;
    if (text !== null) ui.text(value, text); return value;
  };
  const action = (text, className, handler) => {
    const value = node("button", text, `button secondary ${className}`); value.type = "button";
    value.addEventListener("click", handler); return value;
  };
  const dialog = node("dialog", null, "profile-dialog"), title = node("h2", "Mon profil");
  title.id = `profile-title-${++instance}`; dialog.setAttribute("aria-labelledby", title.id);
  const header = node("div", null, "profile-header");
  const closeButton = action("Fermer le profil", "profile-close", () => close(true));
  header.append(title, closeButton);
  const help = node("p", "Ton nom public et ton avatar sont visibles dans tes échanges.", "profile-help");
  const form = node("form", null, "profile-form");
  const name = node("input", null, "profile-pseudonym"); name.type = "text"; name.name = "pseudonym";
  name.maxLength = 64; name.required = true; name.autocomplete = "nickname"; name.spellcheck = false;
  const nameLabel = node("label", null, "profile-field"); nameLabel.append(node("span", "Nom public"), name);
  const nameHelp = node("small", "64 caractères maximum.", "profile-help");
  const avatarSection = node("section", null, "profile-avatar-section"); avatarSection.hidden = !avatarsEnabled;
  const preview = node("div", null, "profile-avatar-preview"); preview.setAttribute("aria-hidden", "true");
  const image = node("img"); image.alt = ""; image.hidden = true;
  const fallback = node("span", "○", "profile-avatar-fallback"); preview.append(image, fallback);
  const file = node("input", null, "profile-file"); file.type = "file"; file.accept = "image/jpeg,image/png,image/webp";
  // Native file-control captions use the browser's language. Keep that
  // control hidden and bind the visible command to our explicit UI source.
  file.hidden = true; ui.attr(file, "aria-label", "Choisir ou remplacer l’avatar");
  const choose = action("Choisir ou remplacer l’avatar", "profile-choose-avatar", () => {
    if (opened && ownerCurrent() && avatarsEnabled && !busy && saved) file.click();
  });
  const fileLabel = node("div", null, "profile-field"); fileLabel.append(choose, file);
  const remove = action("Retirer l’avatar", "profile-remove-avatar", () => removeAvatar());
  avatarSection.append(preview, fileLabel, remove, node("small", "Le centre de la photo sera recadré en carré.", "profile-help"));
  const saveButton = node("button", "Enregistrer le profil", "button primary profile-save"); saveButton.type = "submit";
  const conflictBox = node("section", null, "profile-conflict"); conflictBox.hidden = true;
  conflictBox.append(node("p", "Le profil a été modifié ailleurs. Ton brouillon est conservé."));
  const reload = action("Recharger le profil enregistré", "profile-reload", () => { void resolveConflict(false); });
  const keep = action("Garder mon brouillon", "profile-keep-draft", () => { void resolveConflict(true); });
  conflictBox.append(reload, keep);
  const status = node("p", null, "profile-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const retry = action("Réessayer le chargement", "profile-retry", () => { void load(); }); retry.hidden = true;
  form.append(nameLabel, nameHelp, avatarSection, conflictBox, saveButton);
  dialog.append(header, help, status, retry, form);
  const feedback = node("p", null, "profile-feedback"); feedback.hidden = true;
  feedback.setAttribute("role", "status"); feedback.setAttribute("aria-live", "polite");
  host.append(dialog, feedback);

  let destroyed = false, opened = false, epoch = 0, preparation = 0, previewEpoch = 0;
  let saved = null, draftAvatarId = null, draftBlob = null, conflict = false, busy = false, preparing = false;
  let previewUrl = null, previewAbort = null, preparationAbort = null, returnFocus = null;
  const controllers = new Set();
  const ownerCurrent = () => !destroyed && isCurrent() && document.visibilityState !== "hidden";
  const current = ticket => {
    if (!opened || ticket !== epoch || destroyed) return false;
    if (!ownerCurrent()) { close(false); return false; }
    return true;
  };
  const stale = () => Object.assign(new Error("stale_profile"), { stale: true });
  const passwordChange = passwordEnabled && typeof onPasswordChanged === "function" ? createPasswordChangeUI({ role, request, isCurrent: () => opened && ownerCurrent(), onSessionChanged: onPasswordChanged, onError, host: dialog }) : null;
  const preferences = preferencesEnabled ? createPreferencesUI({ role, request, isCurrent: () => opened && ownerCurrent(), onError, host: dialog }) : null;

  function message(text, error = false) { ui.text(status, text); status.classList.toggle("is-error", error); }
  function controls() {
    if (opened && !ownerCurrent()) { close(false); return; }
    name.disabled = busy || !saved; file.disabled = busy || !saved; choose.disabled = busy || !saved;
    remove.disabled = busy || !saved || !draftAvatarId && !draftBlob && !preparing;
    saveButton.disabled = busy || preparing || conflict || !saved || !validName(name.value);
    reload.disabled = busy; keep.disabled = busy; conflictBox.hidden = !conflict;
    dialog.setAttribute("aria-busy", String(busy || preparing));
  }
  function focus(target) {
    if (ownerCurrent() && target?.isConnected && !target.disabled && !target.hidden) target.focus({ preventScroll: true });
  }
  // Loading a dialog must not summon a touch keyboard. Editing still starts
  // with an explicit tap; desktop keyboard users retain the name shortcut.
  function focusLoadedProfile() {
    if (document.activeElement !== closeButton && document.activeElement !== dialog) return;
    if (globalThis.matchMedia?.("(any-pointer: coarse)").matches === true) focus(closeButton);
    else focus(name);
  }
  function clearPreview() {
    previewEpoch += 1; previewAbort?.abort(); previewAbort = null;
    image.removeAttribute("src"); image.hidden = true; fallback.hidden = false;
    if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null;
  }
  function showPreview(blob, ticket) {
    if (!current(ticket)) return;
    clearPreview();
    const url = URL.createObjectURL(blob);
    if (!current(ticket)) { URL.revokeObjectURL(url); return; }
    previewUrl = url; image.src = url; image.hidden = false; fallback.hidden = true;
  }
  function profile(value) {
    if (!value || !validName(value.pseudonym) || typeof value.version !== "string" || value.version.length < 1
      || value.version.length > 128 || /[\u0000-\u001f\u007f]/u.test(value.version)
      || value.avatarId !== null && (typeof value.avatarId !== "string" || !/^[0-9a-f]{32}$/.test(value.avatarId))
      || value.avatarUrl !== null && value.avatarUrl !== `${base}/avatar?v=${encodeURIComponent(value.version)}`
      || value.avatarId === null && value.avatarUrl !== null) throw new Error("invalid_profile_response");
    return { pseudonym: value.pseudonym, version: value.version, avatarId: value.avatarId, avatarUrl: value.avatarUrl };
  }
  async function ask(path, options, ticket) {
    if (!current(ticket)) throw stale();
    const controller = new AbortController(); controllers.add(controller);
    try {
      const value = await request(path, { ...options, account: true, signal: controller.signal });
      if (controller.signal.aborted || !current(ticket)) throw stale();
      return value;
    } catch (error) { if (!current(ticket) || controller.signal.aborted) throw stale(); throw error; }
    finally { controllers.delete(controller); }
  }
  function report(error, ticket) {
    if (!current(ticket) || error?.stale || error?.name === "AbortError") return;
    if (error.status === 401 || error.status === 403) {
      close(false);
      try { Promise.resolve(onError?.(error)).catch(() => {}); } catch {}
      return;
    }
    let text = "Le profil est indisponible. Réessaie dans un moment.";
    if (error.code === "media_format" || error.status === 415) text = "Choisis une photo JPEG, PNG ou WebP.";
    if (error.code === "media_unavailable") text = "L’avatar n’a pas pu être préparé. Essaie une autre photo.";
    if (error.code === "media_dimensions" || error.code === "request_too_large" || error.status === 413) text = "Cette photo est trop grande. Choisis une version plus légère.";
    if (error.status === 400 || error.status === 422) text = "Vérifie le nom public et l’avatar avant de réessayer.";
    if (error.status === 429) text = "Patiente un moment avant de réessayer.";
    if (error.status === 507) text = "Le stockage des photos a atteint sa limite. Réessaie sans nouvel avatar.";
    message(text, true);
  }
  async function loadAvatar(value, ticket) {
    clearPreview();
    if (!avatarsEnabled || !value.avatarId || !value.avatarUrl || !current(ticket)) return;
    const sequence = previewEpoch, controller = new AbortController(); previewAbort = controller; controllers.add(controller);
    try {
      const blob = await fetchBinary(value.avatarUrl, { signal: controller.signal, maxBytes: MAX_AVATAR_BYTES, account: true });
      if (!current(ticket) || sequence !== previewEpoch || controller.signal.aborted) return;
      if (!validAvatar(blob)) throw invalidImage();
      showPreview(blob, ticket);
    } catch (error) {
      if (current(ticket) && sequence === previewEpoch && !controller.signal.aborted) {
        if (error.status === 401 || error.status === 403) report(error, ticket);
        else message("L’avatar n’a pas pu être chargé. Tu peux le remplacer ou le retirer.", true);
      }
    } finally { controllers.delete(controller); if (previewAbort === controller) previewAbort = null; }
  }
  function adopt(value, ticket) {
    saved = value; name.value = value.pseudonym; draftAvatarId = value.avatarId; draftBlob = null; conflict = false;
    file.value = ""; preparation += 1; preparationAbort?.abort(); preparationAbort = null; preparing = false;
    void loadAvatar(value, ticket);
  }
  async function load() {
    const ticket = epoch;
    if (!current(ticket) || busy) return;
    busy = true; retry.hidden = true; message("Chargement du profil…"); controls();
    try {
      const value = profile(await ask(base, {}, ticket));
      if (!current(ticket)) return;
      adopt(value, ticket); message("");
    } catch (error) { if (current(ticket)) { report(error, ticket); retry.hidden = !opened || Boolean(saved); } }
    finally { if (current(ticket)) { busy = false; controls(); if (saved) focusLoadedProfile(); } }
  }
  async function chooseAvatar() {
    const selected = file.files?.[0]; file.value = "";
    const ticket = epoch;
    if (!selected || !avatarsEnabled || !saved || busy || !current(ticket)) return;
    const sequence = ++preparation; preparationAbort?.abort();
    previewEpoch += 1; previewAbort?.abort(); previewAbort = null;
    const controller = new AbortController(); preparationAbort = controller; controllers.add(controller);
    preparing = true; message("Préparation de l’avatar…"); controls();
    try {
      const blob = await prepareAvatar(selected, { signal: controller.signal });
      if (!current(ticket) || sequence !== preparation || controller.signal.aborted) return;
      if (!validAvatar(blob)) throw invalidImage();
      draftBlob = blob; draftAvatarId = null; showPreview(blob, ticket);
      message("Avatar prêt. Enregistre le profil pour l’appliquer.");
    } catch (error) { if (current(ticket) && sequence === preparation && !controller.signal.aborted) report(error, ticket); }
    finally {
      controllers.delete(controller);
      if (current(ticket) && sequence === preparation) { preparing = false; preparationAbort = null; controls(); }
    }
  }
  function removeAvatar() {
    if (!opened || !ownerCurrent() || busy || !saved || !avatarsEnabled) return;
    preparation += 1; preparationAbort?.abort(); preparationAbort = null; preparing = false;
    draftBlob = null; draftAvatarId = null; clearPreview();
    message("Avatar retiré du brouillon. Enregistre le profil pour appliquer ce choix."); controls();
  }
  async function resolveConflict(keepDraft) {
    const ticket = epoch;
    if (!current(ticket) || busy || !conflict) return;
    busy = true; message("Chargement du profil…"); controls();
    try {
      const value = profile(await ask(base, {}, ticket));
      if (!current(ticket)) return;
      if (keepDraft) { saved = value; conflict = false; message("Ton brouillon est conservé. Vérifie-le puis enregistre le profil."); }
      else { adopt(value, ticket); message("Profil enregistré rechargé."); }
    } catch (error) { report(error, ticket); }
    finally { if (current(ticket)) { busy = false; controls(); focusLoadedProfile(); } }
  }
  async function save(event) {
    event.preventDefault();
    const ticket = epoch;
    if (!current(ticket) || busy || preparing || conflict || !saved) return;
    if (!validName(name.value)) { message("Choisis un nom public de 1 à 64 caractères.", true); focus(name); return; }
    const pseudonym = name.value.trim().normalize("NFC"); let writingProfile = false;
    busy = true; controls(); message("Enregistrement du profil…");
    try {
      if (avatarsEnabled && draftBlob && !draftAvatarId) {
        const result = await ask(media, { mutation: true, rawBody: draftBlob, contentType: "image/jpeg" }, ticket);
        if (!/^[0-9a-f]{32}$/.test(result?.asset?.id ?? "")) throw new Error("invalid_avatar_asset");
        draftAvatarId = result.asset.id;
      }
      writingProfile = true;
      const value = profile(await ask(base, { mutation: true, body: { expectedVersion: saved.version, pseudonym, avatarId: draftAvatarId } }, ticket));
      if (!current(ticket)) return;
      close(true);
      if (ownerCurrent()) {
        feedback.hidden = false; ui.text(feedback, "Profil enregistré.");
        onSaved?.(value);
      }
    } catch (error) {
      if (!current(ticket)) return;
      if (writingProfile && error.status === 409) { conflict = true; message("Le profil a été modifié ailleurs. Ton brouillon est conservé.", true); }
      else report(error, ticket);
    } finally { if (current(ticket)) { busy = false; controls(); if (conflict) focus(reload); } }
  }
  function close(restoreFocus) {
    const wasOpen = opened, previous = returnFocus;
    opened = false; epoch += 1; preparation += 1;
    passwordChange?.close(); preferences?.close();
    for (const controller of controllers) controller.abort(); controllers.clear();
    preparationAbort = null; preparing = false; clearPreview();
    saved = null; draftAvatarId = null; draftBlob = null; conflict = false; busy = false; returnFocus = null;
    name.value = ""; file.value = ""; message(""); conflictBox.hidden = true; retry.hidden = true;
    feedback.hidden = true; ui.text(feedback, ""); controls();
    if (dialog.open) dialog.close();
    if (wasOpen && restoreFocus) focus(typeof getReturnFocus === "function" ? getReturnFocus() : previous);
  }
  async function open(opener = openerButton) {
    if (!ownerCurrent()) return false;
    close(false); returnFocus = opener ?? document.activeElement; opened = true;
    dialog.showModal(); controls(); focus(closeButton); await load(); if (opened && ownerCurrent()) void preferences?.load(); return opened;
  }
  const onOpen = () => { void open(); };
  const hidden = () => { if (document.visibilityState === "hidden") close(false); };
  const pagehide = () => close(false);
  openerButton?.addEventListener("click", onOpen);
  name.addEventListener("input", controls); file.addEventListener("change", () => { void chooseAvatar(); }); form.addEventListener("submit", event => { void save(event); });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(true); });
  dialog.addEventListener("close", () => { if (opened) close(false); });
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); close(true); return; }
    if (event.key !== "Tab" || !opened) return;
    const candidates = [...dialog.querySelectorAll("button,input,summary,select,textarea,a[href]")]
      .filter(value => {
        if (value.disabled || value.hidden || value.closest?.("[hidden]")) return false;
        const closed = value.closest?.("details:not([open])");
        return !closed || value.tagName.toLowerCase() === "summary" && value.parentElement === closed;
      });
    const first = candidates[0], last = candidates.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); focus(last); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); focus(first); }
  });
  document.addEventListener("visibilitychange", hidden); globalThis.window?.addEventListener("pagehide", pagehide);
  controls();
  return Object.freeze({ open, close: () => close(true), suspend: () => close(false), destroy() {
    if (destroyed) return;
    close(false); destroyed = true;
    openerButton?.removeEventListener("click", onOpen); document.removeEventListener("visibilitychange", hidden);
    globalThis.window?.removeEventListener("pagehide", pagehide);
    passwordChange?.destroy(); preferences?.destroy();
    ui.forget(dialog); ui.forget(feedback); dialog.remove(); feedback.remove();
  } });
}
