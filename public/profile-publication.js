import { validatePublicProfile } from "./public-profile-model.js";
import { preferenceId, MAX_PREFERENCES, PREFERENCES_CATALOGUE_VERSION } from "./preferences-model.js";
import "./i18n-public-profile.js";
const ui = globalThis.JessieI18n;

export function createPublicationUI({ request, isCurrent, host, getSelection, getName, onError } = {}) {
  if (typeof request !== "function" || typeof isCurrent !== "function" || typeof getSelection !== "function" || typeof getName !== "function" || !host?.append) throw new TypeError("invalid_publication_adapter");
  const path = "/api/profile/admin/publication";
  const node = (tag, text, className) => { const value = document.createElement(tag); if (text !== undefined) ui.text(value, text); if (className) value.className = className; return value; };
  const section = node("section", undefined, "profile-publication"); section.hidden = true;
  const title = node("h3", "Mon profil public"), help = node("p", "Cette page est visible par toute personne qui possède son lien. Publier copie les sélections affichées ci-dessus ; les modifications suivantes restent privées jusqu’à une nouvelle publication.", "profile-publication-help");
  const nameLabel = node("label"), name = node("input"); name.type = "text"; name.maxLength = 64; name.autocomplete = "off"; nameLabel.append(node("span", "Nom affiché sur la page"), name);
  const bioLabel = node("label"), bio = node("textarea"); bio.maxLength = 1000; bio.rows = 4; bioLabel.append(node("span", "Quelques mots sur moi"), bio);
  const length = node("p", "1 000 caractères maximum.", "profile-publication-help");
  const status = node("p", undefined, "profile-publication-status"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const actions = node("div", undefined, "profile-publication-actions");
  const button = (text, handler) => { const value = node("button", text, "button secondary"); value.type = "button"; value.addEventListener("click", handler); return value; };
  const publish = button("Publier mon profil", () => void save(true)), unpublish = button("Retirer le profil public", () => void save(false)), reload = button("Recharger la publication enregistrée", () => void load());
  publish.className = "button primary";
  const preview = node("a", "Voir mon profil public", "button secondary"); preview.href = "/jessie"; preview.target = "_blank"; preview.rel = "noopener noreferrer";
  actions.append(publish, unpublish, preview, reload); section.append(title, help, nameLabel, bioLabel, length, status, actions); host.append(section);
  let saved = null, opened = false, suspended = false, destroyed = false, busy = false, blocked = false, epoch = 0; const controllers = new Set();
  const active = () => opened && !suspended && !destroyed && isCurrent(), current = ticket => active() && ticket === epoch;
  const message = (text, error = false) => { ui.text(status, text); status.classList.toggle("is-error", error); };
  function controls() { const disabled = !active() || busy; name.disabled = bio.disabled = disabled; publish.disabled = disabled || !saved || blocked; unpublish.disabled = disabled || !saved?.published || blocked; reload.disabled = disabled; unpublish.hidden = !saved?.published; preview.hidden = !saved?.published; ui.text(publish, saved?.published ? "Mettre à jour le profil public" : "Publier mon profil"); }
  async function ask(options, ticket) { const controller = new AbortController(); controllers.add(controller); try { const value = await request(path, { ...options, account: true, signal: controller.signal }); if (!current(ticket) || controller.signal.aborted) throw Object.assign(new Error("stale"), { stale: true }); return validatePublicProfile(value, true); } finally { controllers.delete(controller); } }
  function report(error, ticket, mutation) {
    if (!current(ticket) || error?.stale || error?.name === "AbortError") return;
    if ([401, 403].includes(error.status)) { close(); try { Promise.resolve(onError?.(error)).catch(() => {}); } catch {} return; }
    if (error.status === 409 || error.code === "public_profile_changed") { blocked = true; message("La publication a changé sur un autre appareil. Recharge-la pour vérifier avant de publier à nouveau.", true); }
    else if (mutation && ![400, 429].includes(error.status)) { blocked = true; message("La publication n’a pas pu être confirmée. Recharge la publication enregistrée pour vérifier son état avant de réessayer.", true); }
    else message(error.status === 429 ? "Patiente un moment avant de réessayer." : "La publication est indisponible. Réessaie dans un moment.", true);
  }
  async function load() {
    if (destroyed || !isCurrent()) return; for (const controller of controllers) controller.abort(); controllers.clear();
    opened = true; suspended = false; section.hidden = false; busy = true; const ticket = ++epoch; message("Chargement de la publication…"); controls();
    try { const value = await ask({}, ticket); if (!current(ticket)) return; saved = value; name.value = value.version === "0" ? getName() || value.displayName : value.displayName; bio.value = value.bio; blocked = false; message(value.published ? "Le profil public est visible." : "Le profil public est masqué."); }
    catch (error) { report(error, ticket, false); }
    finally { if (current(ticket)) { busy = false; controls(); } }
  }
  async function save(published) {
    if (!active() || busy || blocked || !saved) return;
    const ids = published ? getSelection() : saved.selectedIds;
    const body = { expectedVersion: saved.version, published, displayName: published ? name.value.trim().normalize("NFC") : saved.displayName, bio: published ? bio.value.normalize("NFC") : saved.bio, catalogueVersion: PREFERENCES_CATALOGUE_VERSION, selectedIds: Array.isArray(ids) ? [...ids] : null };
    try {
      validatePublicProfile({ version: body.expectedVersion, published: body.published, displayName: body.displayName, bio: body.bio, catalogueVersion: body.catalogueVersion, selectedIds: body.selectedIds }, true);
      if (!Array.isArray(ids) || ids.length > MAX_PREFERENCES || ids.some(id => !preferenceId(id))) throw new Error("invalid_selection");
    } catch { message("Vérifie le nom, la présentation et les sélections avant de publier.", true); return; }
    busy = true; const ticket = epoch; message(published ? "Publication en cours…" : "Retrait en cours…"); controls();
    try { const value = await ask({ mutation: true, body }, ticket); if (!current(ticket)) return; saved = value; blocked = false; message(value.published ? "Profil public publié." : "Profil public retiré."); }
    catch (error) { report(error, ticket, true); }
    finally { if (current(ticket)) { busy = false; controls(); } }
  }
  function close() { epoch++; opened = false; suspended = false; for (const controller of controllers) controller.abort(); controllers.clear(); saved = null; name.value = bio.value = ""; busy = blocked = false; message(""); section.hidden = true; controls(); }
  function suspend() { if (!opened || suspended || destroyed) return; suspended = true; epoch++; for (const controller of controllers) controller.abort(); controllers.clear(); if (busy) blocked = true; busy = false; section.hidden = true; controls(); }
  async function resume() { if (destroyed || !isCurrent()) return false; if (!opened) { await load(); return active(); } if (!suspended) return active(); suspended = false; section.hidden = false; if (!saved) { await load(); return active(); } if (blocked) message("La publication n’a pas pu être confirmée. Recharge la publication enregistrée pour vérifier son état avant de réessayer.", true); controls(); return active(); }
  return Object.freeze({ section, load, close, suspend, resume, destroy() { if (destroyed) return; close(); destroyed = true; ui.forget(section); section.remove(); } });
}
