import { prepareImageUpload } from "/image-preparation.js";
import { LIBRARY_PAGE_SIZE, createLibraryState, clearLibrary, libraryTicket, currentLibraryTicket, acceptLibrarySession, parseLibraryAsset, parseLibraryPage } from "/media-library-model.js";

const ui = globalThis.JessieI18n, el = id => document.getElementById(id);
const state = createLibraryState(), controllers = new Set(), thumbnailControllers = new Set(), thumbnailUrls = new Set();
const visible = () => document.visibilityState === "visible", stale = () => Object.assign(new Error("stale_response"), { stale: true });
let loading = false, mutating = false, uncertain = false, paused = false, bootstrapTask = null, logoutBusy = false;
let cancelSession = null, thumbnailObserver = null, thumbnailQueue = [], thumbnailActive = 0, thumbnailEpoch = 0, previewEpoch = 0, previewUrl = null;
let deleteTarget = null, previewOpener = null;
let photoSelectionIntent = null, deferredPhoto = null, photoSelectionTask = null;
const replace = (element, ...children) => { ui.forget(element); element.replaceChildren(...children); };
const node = (name, source, className) => { const result = document.createElement(name); if (source !== undefined) ui.text(result, source); if (className) result.className = className; return result; };
function notice(source = "", error = false, target = "library-status", params = {}) { ui.text(el(target), source, params); el(target).classList.toggle("is-error", error); }
function current(ticket) { return visible() && currentLibraryTicket(state, ticket); }
function clearThumbnails() {
  thumbnailEpoch += 1; thumbnailObserver?.disconnect(); thumbnailObserver = null; thumbnailQueue = [];
  for (const controller of thumbnailControllers) { controller.abort(); controllers.delete(controller); }
  thumbnailControllers.clear();
  for (const url of thumbnailUrls) URL.revokeObjectURL(url); thumbnailUrls.clear();
}
function clearPreview({ selection = true } = {}) {
  previewEpoch += 1;
  for (const video of el("media-preview").querySelectorAll("video")) { video.pause?.(); video.removeAttribute("src"); video.load?.(); }
  replace(el("media-preview")); if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null;
  el("media-detail").hidden = true; notice("", false, "preview-status"); ui.rawText(el("detail-summary"), "");
  if (selection) state.selected = null;
}
function stopRequests() {
  for (const controller of controllers) controller.abort(); controllers.clear(); clearThumbnails();
  cancelSession?.(); cancelSession = null; state.listEpoch += 1; loading = false; mutating = false;
}
function hidePrivate() {
  clearPreview(); replace(el("media-grid")); el("library-content").hidden = true; el("logout").hidden = true;
  el("photo-file").value = ""; notice(""); if (el("delete-dialog").open) el("delete-dialog").close(); deleteTarget = null;
}
function clearPrivate({ keepDeferredPhoto = false } = {}) {
  stopRequests(); clearLibrary(state); hidePrivate(); paused = false; uncertain = false; bootstrapTask = null;
  if (!keepDeferredPhoto) deferredPhoto = null;
  // Keep a picker’s original owner proof until its native change event arrives.
  // A new session must never turn an old picker selection into its own upload.
}
function login() { clearPrivate(); location.replace("/admin/login?continue=%2Fadmin%2Fmedia"); }
function sessionChanged() {
  clearPrivate(); state.visible = visible(); paused = true; el("reload-session").hidden = false;
  notice("La session a changé. Actualise la connexion avant de reprendre.", true, "session-status");
}
async function transport(path, { ticket = libraryTicket(state), body, raw = null, signal, binaryLimit = null } = {}) {
  if (!current(ticket)) throw stale();
  const controller = new AbortController(), abort = () => controller.abort(); controllers.add(controller);
  signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), raw ? 120000 : 20000);
  try {
    const response = await fetch(path, { method: body === undefined && raw === null ? "GET" : "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: raw !== null ? { "Content-Type": raw.type, "X-CSRF-Token": state.session.csrf } : body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": state.session.csrf },
      body: raw !== null ? raw : body === undefined ? undefined : JSON.stringify(body) });
    if (!current(ticket)) throw stale();
    if (!response.ok) {
      let data; try { data = await response.json(); } catch { /* A refused response has no trusted private content. */ }
      if (!current(ticket)) throw stale();
      throw Object.assign(new Error("request_failed"), { status: response.status, code: data?.error });
    }
    if (binaryLimit !== null) {
      const length = response.headers.get("content-length");
      if (response.headers.get("content-type")?.split(";")[0] !== "image/jpeg" || length !== null && (!/^\d+$/.test(length) || Number(length) > binaryLimit)) throw new Error("invalid_media_response");
      const blob = await response.blob();
      if (!current(ticket)) throw stale();
      if (!blob.size || blob.size > binaryLimit || blob.type.split(";")[0] !== "image/jpeg") throw new Error("invalid_media_response");
      return blob;
    }
    const data = await response.json(); if (!current(ticket)) throw stale(); return data;
  } catch (error) { if (!current(ticket)) throw stale(); throw error; }
  finally { clearTimeout(timer); controllers.delete(controller); signal?.removeEventListener("abort", abort); }
}
async function verifySession(ticket) {
  let session;
  try { session = await transport("/api/auth/session", { ticket }); } catch (error) { error.proofFailure = true; throw error; }
  if (!acceptLibrarySession(state, session)) { sessionChanged(); throw stale(); }
}
async function request(path, options = {}) {
  const ticket = options.ticket ?? libraryTicket(state);
  if (paused || !current(ticket)) throw stale();
  await verifySession(ticket); if (!current(ticket)) throw stale();
  const result = await transport(path, { ...options, ticket });
  await verifySession(ticket); if (!current(ticket)) throw stale(); return result;
}
function report(error, target = "library-status") {
  if (error?.stale) return;
  if (error?.status === 401) { login(); return; }
  if (error?.status === 403) { sessionChanged(); return; }
  let text = "La connexion est momentanément indisponible. Actualise la liste avant de reprendre.";
  if (error?.status === 409 && ["media_in_use", "video_in_use"].includes(error.code)) text = "Ce média est utilisé par un message ou une diffusion et ne peut pas être supprimé ici.";
  else if (error?.status === 404) text = "Ce média n’est plus disponible. Actualise la liste.";
  else if (error?.status === 429) text = "Trop de demandes. Patiente un moment avant de réessayer.";
  else if (error?.status === 507) text = "L’espace de stockage est momentanément insuffisant.";
  else if (error?.code?.startsWith("media_") && !error.status) text = "La préparation de cette photo n’a pas abouti. Choisis une autre photo ou réessaie.";
  notice(text, true, target); controls();
}
function controls() {
  const frozen = loading || mutating || paused || uncertain || !!deferredPhoto;
  el("show-photos").hidden = !state.photos; el("show-videos").hidden = !state.videos;
  for (const kind of ["photos", "videos"]) { el(`show-${kind}`).disabled = frozen; el(`show-${kind}`).setAttribute("aria-pressed", String(state.kind === kind)); }
  el("refresh-list").disabled = loading || mutating || paused;
  el("add-photo").hidden = !state.photos || state.kind !== "photos"; el("photo-file").disabled = frozen;
  el("add-photo").classList.toggle("is-disabled", frozen);
  el("add-video").hidden = !state.videos || state.kind !== "videos"; el("video-help").hidden = el("add-video").hidden;
  el("first-page").hidden = state.page === 1; el("previous-page").hidden = !state.back.length; el("next-page").hidden = !state.more;
  for (const id of ["first-page", "previous-page", "next-page", "delete-media", "confirm-delete"]) el(id).disabled = frozen;
  for (const button of el("media-grid").querySelectorAll("button")) button.disabled = frozen;
  el("reload-session").hidden = !paused; el("logout").disabled = logoutBusy;
}
function summary(element, asset) {
  const size = ui.numberParam(asset.bytes / 1048576, { maximumFractionDigits: 1 });
  if (asset.kind === "photos") ui.text(element, "{width} × {height} · {size} Mo", { width: ui.numberParam(asset.width), height: ui.numberParam(asset.height), size });
  else ui.text(element, "{size} Mo", { size });
}
function date(asset) { return ui.dateParam(asset.createdAt, { dateStyle: "medium", timeStyle: "short" }); }
function armSession() {
  cancelSession?.(); if (!state.session || !state.visible) return;
  const ticket = libraryTicket(state);
  cancelSession = globalThis.JessieSessionClock.scheduleSessionCheck(Math.min(state.session.expiresAt, Date.now() + 300000), () => {
    if (!current(ticket)) return;
    void verifySession(ticket).then(() => { if (current(ticket)) armSession(); }).catch(error => {
      if (!current(ticket) || error.stale) return;
      if (error.status === 401) login(); else { stopRequests(); hidePrivate(); paused = true; notice("La connexion est momentanément indisponible. Actualise la liste avant de reprendre.", true, "session-status"); controls(); }
    });
  }, { maxDelayMs: 300000 });
}
async function thumbnail(job) {
  const { ticket, epoch, viewEpoch, asset, host } = job;
  if (!current(ticket) || epoch !== state.listEpoch || viewEpoch !== thumbnailEpoch || state.kind !== "photos") return;
  const controller = new AbortController(); thumbnailControllers.add(controller);
  try {
    const blob = await request(asset.thumbnailUrl, { ticket, binaryLimit: 524288, signal: controller.signal });
    if (!current(ticket) || epoch !== state.listEpoch || viewEpoch !== thumbnailEpoch || state.kind !== "photos") return;
    const url = URL.createObjectURL(blob); thumbnailUrls.add(url); const image = node("img"); image.alt = ""; image.width = asset.thumbnailWidth; image.height = asset.thumbnailHeight; image.src = url; replace(host, image);
  } catch (error) {
    if (!current(ticket) || epoch !== state.listEpoch || viewEpoch !== thumbnailEpoch || error.stale) return;
    ui.text(host, "Aperçu indisponible"); if ([401, 403].includes(error.status)) report(error);
  } finally { thumbnailControllers.delete(controller); }
}
function pumpThumbnails() {
  while (thumbnailActive < 2 && thumbnailQueue.length) {
    const job = thumbnailQueue.shift(); thumbnailActive += 1;
    void thumbnail(job).finally(() => { thumbnailActive -= 1; pumpThumbnails(); });
  }
}
function renderRows() {
  clearThumbnails(); const ticket = libraryTicket(state), epoch = state.listEpoch, rows = [];
  if (typeof IntersectionObserver === "function") thumbnailObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { thumbnailObserver?.unobserve(entry.target); if (entry.target.libraryThumbnail) thumbnailQueue.push(entry.target.libraryThumbnail); }
    pumpThumbnails();
  }, { root: el("media-grid"), rootMargin: "180px" });
  for (const asset of state.rows) {
    const item = node("li", undefined, "media-card"), button = node("button", undefined, "media-choice"); button.type = "button"; button.dataset.mediaId = asset.id;
    button.setAttribute("aria-pressed", String(state.selected?.id === asset.id)); ui.attr(button, "aria-label", asset.kind === "photos" ? "Voir la photo du {date}" : "Voir la vidéo du {date}", { date: date(asset) });
    const image = node("div", asset.kind === "photos" ? "Photo" : asset.cleanupPending ? "Nettoyage à terminer" : "Vidéo", "media-thumb");
    const meta = node("div", undefined, "media-meta"), label = node("p"); ui.text(label, asset.kind === "photos" ? "Photo du {date}" : "Vidéo du {date}", { date: date(asset) });
    const detail = node("p", undefined, "small-copy"); summary(detail, asset); meta.append(label, detail); button.append(image, meta); item.append(button); rows.push(item);
    button.addEventListener("click", () => { if (!loading && !mutating && !uncertain) void selectAsset(asset, button); });
    if (asset.kind === "photos") {
      image.libraryThumbnail = { asset, host: image, ticket, epoch, viewEpoch: thumbnailEpoch };
      if (thumbnailObserver) thumbnailObserver.observe(image); else thumbnailQueue.push(image.libraryThumbnail);
    }
  }
  replace(el("media-grid"), ...rows); if (!rows.length) notice("Aucun média dans cette liste.");
  ui.text(el("page-note"), "Page {page} · {count} sur cette page.", { page: ui.numberParam(state.page), count: ui.numberParam(state.rows.length) });
  pumpThumbnails(); controls();
}
async function loadList(action = "current") {
  if (!state.session || loading || mutating || paused) return false;
  const ticket = libraryTicket(state), kind = state.kind;
  const after = action === "next" ? state.cursor : action === "previous" ? state.back.at(-1) : action === "first" ? null : state.after;
  if (action === "next" && !state.more || action === "previous" && !state.back.length) return false;
  const back = action === "next" ? [...state.back, state.after].slice(-100) : action === "previous" ? state.back.slice(0, -1) : action === "first" ? [] : state.back;
  const number = action === "next" ? state.page + 1 : action === "previous" ? state.page - 1 : action === "first" ? 1 : state.page;
  const epoch = ++state.listEpoch; loading = true; clearThumbnails(); controls(); notice("Chargement des médias…");
  try {
    const root = kind === "photos" ? "/api/media/admin/assets" : "/api/video/admin/assets";
    const data = await request(`${root}?limit=${LIBRARY_PAGE_SIZE}${after ? `&afterId=${after}` : ""}`, { ticket });
    if (!current(ticket) || kind !== state.kind || epoch !== state.listEpoch) return false;
    const page = parseLibraryPage(data, kind, after);
    state.rows = page.rows; state.cursor = page.cursor; state.more = page.more; state.after = after; state.back = back; state.page = number; uncertain = false;
    notice(""); renderRows(); return true;
  } catch (error) { report(error); return false; }
  finally { if (current(ticket) && epoch === state.listEpoch) { loading = false; controls(); void drainDeferredPhoto(); } }
}
async function selectAsset(asset, opener = null) {
  if (paused || uncertain || mutating || loading) return;
  clearPreview(); state.selected = asset; previewOpener = opener; el("media-detail").hidden = false; summary(el("detail-summary"), asset);
  el("detail-title").focus({ preventScroll: true }); el("media-detail").scrollIntoView?.({ block: "nearest" });
  for (const button of el("media-grid").querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.mediaId === asset.id));
  const ticket = libraryTicket(state), epoch = previewEpoch;
  if (asset.cleanupPending) { notice("Ce média a déjà été retiré. Tu peux terminer son nettoyage.", false, "preview-status"); return; }
  try {
    await verifySession(ticket); if (!current(ticket) || epoch !== previewEpoch || state.selected?.id !== asset.id) return;
    if (asset.kind === "photos") {
      const blob = await request(asset.fullUrl, { ticket, binaryLimit: 10485760 });
      if (!current(ticket) || epoch !== previewEpoch || state.selected?.id !== asset.id) return;
      previewUrl = URL.createObjectURL(blob); const image = node("img"); image.alt = ""; ui.attr(image, "aria-label", "Aperçu de la photo"); image.src = previewUrl; replace(el("media-preview"), image);
    } else {
      const video = node("video"); video.controls = true; video.preload = "metadata"; video.playsInline = true; ui.attr(video, "aria-label", "Aperçu de la vidéo"); video.src = asset.contentUrl; replace(el("media-preview"), video);
    }
  } catch (error) { if (current(ticket) && epoch === previewEpoch) report(error, "preview-status"); }
}
function switchKind(kind) {
  if (loading || mutating || uncertain || paused || kind === state.kind || !state[kind]) return;
  clearPreview(); clearThumbnails(); state.kind = kind; state.rows = []; state.after = null; state.back = []; state.page = 1; state.more = false; state.cursor = null;
  renderRows(); void loadList();
}
function photoOwner() { return state.session ? { id: state.session.user.id, csrf: state.session.csrf } : null; }
function samePhotoOwner(intent) { return !!intent && state.session?.user.id === intent.id && state.session?.csrf === intent.csrf; }
function capturePhotoIntent() {
  if (!state.session || !visible() || paused || loading || mutating || uncertain || deferredPhoto) return;
  photoSelectionIntent = photoOwner();
}
function drainDeferredPhoto() {
  if (photoSelectionTask) return photoSelectionTask;
  if (!deferredPhoto || !visible()) return Promise.resolve(false);
  const task = (async () => {
    if (bootstrapTask?.promise) await bootstrapTask.promise;
    if (!deferredPhoto || !visible() || !state.session || paused || loading || mutating || uncertain) return false;
    const selection = deferredPhoto;
    if (!samePhotoOwner(selection.intent)) {
      deferredPhoto = null; notice("La session a changé. Choisis de nouveau la photo avant de l’ajouter.", true); controls(); return false;
    }
    const ticket = libraryTicket(state);
    try {
      await verifySession(ticket);
      if (!current(ticket) || deferredPhoto !== selection || !samePhotoOwner(selection.intent)) return false;
      deferredPhoto = null; controls();
      await uploadPhoto(selection.file, ticket); return true;
    } catch (error) {
      if (error.stale || !current(ticket)) return false;
      if ([401, 403].includes(error.status)) { report(error); return false; }
      stopRequests(); hidePrivate(); paused = true;
      notice("La connexion est momentanément indisponible. Actualise la liste avant de reprendre.", true, "session-status"); controls(); return false;
    }
  })();
  photoSelectionTask = task;
  return task.finally(() => {
    if (photoSelectionTask === task) photoSelectionTask = null;
    // A visibility/bootstrap transition can finish while an old proof unwinds.
    // Only a never-attempted queued selection may resume after that proof.
    if (deferredPhoto && visible() && state.session && !paused && !loading && !mutating && !uncertain)
      void Promise.resolve().then(() => drainDeferredPhoto());
  });
}
async function addPhoto() {
  const file = el("photo-file").files?.[0], intent = photoSelectionIntent ?? photoOwner();
  el("photo-file").value = ""; photoSelectionIntent = null;
  if (!file || !intent || mutating || uncertain) return;
  deferredPhoto = { file, intent }; controls();
  return drainDeferredPhoto();
}
async function uploadPhoto(file, ticket) {
  if (!file || !current(ticket) || loading || mutating || paused || uncertain || !state.photos) return;
  const controller = new AbortController(); controllers.add(controller); mutating = true; controls(); notice("Préparation de la photo…");
  let attempted = false;
  try {
    const prepared = await prepareImageUpload(file, { signal: controller.signal }); if (!current(ticket)) throw stale();
    notice("Chargement de la photo…"); attempted = true;
    const data = await request("/api/media/admin/assets", { ticket, raw: prepared, signal: controller.signal });
    if (!current(ticket)) throw stale(); if (typeof data?.duplicate !== "boolean") throw new Error("response_unconfirmed");
    const asset = parseLibraryAsset(data.asset, "photos"); mutating = false; const refreshed = await loadList("first"); if (!current(ticket)) return;
    await selectAsset(asset); if (refreshed) notice("Photo ajoutée à ta bibliothèque.");
  } catch (error) {
    if (!current(ticket) || error.stale) return;
    if ([401, 403].includes(error.status)) { report(error); return; }
    uncertain = attempted && (!Number.isInteger(error.status) || error.status >= 500 || error.proofFailure);
    if (uncertain) notice("Le résultat n’a pas été confirmé. Actualise la liste avant toute nouvelle modification.", true); else report(error);
  } finally { controllers.delete(controller); if (current(ticket)) { mutating = false; controls(); } }
}
async function deleteSelected() {
  const asset = deleteTarget; deleteTarget = null; el("delete-dialog").close();
  if (!asset || state.selected !== asset || mutating || loading || paused || uncertain) return;
  const ticket = libraryTicket(state); mutating = true; controls();
  try {
    const root = asset.kind === "photos" ? "/api/media/admin/assets" : "/api/video/admin/assets";
    const result = await request(`${root}/${asset.id}/delete`, { ticket, body: {} });
    if (!current(ticket)) return; if (result?.deleted !== true) throw new Error("response_unconfirmed");
    clearPreview(); state.rows = state.rows.filter(row => row.id !== asset.id || row.kind !== asset.kind); renderRows();
    mutating = false; const refreshed = await loadList(); if (current(ticket) && refreshed) notice("Média supprimé.");
  } catch (error) {
    if (!current(ticket) || error.stale) return;
    if ([401, 403].includes(error.status)) { report(error); return; }
    uncertain = !Number.isInteger(error.status) || error.status >= 500 || error.proofFailure;
    if (uncertain) notice("Le résultat n’a pas été confirmé. Actualise la liste avant toute nouvelle modification.", true); else report(error, "preview-status");
  } finally { if (current(ticket)) { mutating = false; controls(); } }
}
function bootstrap() {
  if (!visible() || logoutBusy) return Promise.resolve(false);
  if (bootstrapTask) return bootstrapTask.promise;
  clearPrivate({ keepDeferredPhoto: true }); state.visible = true; paused = false; notice("Vérification de la connexion…", false, "session-status");
  const task = {}, ticket = libraryTicket(state); bootstrapTask = task;
  task.promise = (async () => { try {
    const session = await transport("/api/auth/session", { ticket }); if (!acceptLibrarySession(state, session)) { login(); return; }
    const ownTicket = libraryTicket(state);
    const media = await request("/api/media/admin/capabilities", { ticket: ownTicket }).catch(error => { if (error.status === 404) return null; throw error; });
    const chat = await request("/api/chat/admin/capabilities", { ticket: ownTicket }).catch(error => { if (error.status === 404) return null; throw error; });
    if (!current(ownTicket)) return;
    state.photos = media?.enabled === true; state.videos = chat?.video?.enabled === true;
    if (!state.photos && !state.videos) throw Object.assign(new Error("media_unavailable"), { status: 404 });
    state.kind = state.photos ? "photos" : "videos"; el("library-content").hidden = false; el("logout").hidden = false; notice("", false, "session-status");
    controls(); await loadList(); if (current(ownTicket)) armSession();
  } catch (error) {
    if (error.stale) return;
    if (error.status === 401) { login(); return; }
    hidePrivate(); paused = true; notice("Les médias ne sont pas disponibles pour le moment.", true, "session-status"); el("reload-session").hidden = false;
  } finally { if (bootstrapTask === task) { bootstrapTask = null; void drainDeferredPhoto(); } }
  })();
  return task.promise;
}
async function logout() {
  if (!state.session || logoutBusy) return;
  const csrf = state.session.csrf; logoutBusy = true; clearPrivate(); const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000); let confirmed = false;
  try { const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: "{}" }); confirmed = response.ok || response.status === 401; }
  catch { /* Private content stays cleared until a new session check. */ }
  finally { clearTimeout(timer); logoutBusy = false; if (confirmed) login(); else void bootstrap(); }
}
el("show-photos").addEventListener("click", () => switchKind("photos")); el("show-videos").addEventListener("click", () => switchKind("videos"));
el("first-page").addEventListener("click", () => { void loadList("first"); }); el("previous-page").addEventListener("click", () => { void loadList("previous"); }); el("next-page").addEventListener("click", () => { void loadList("next"); });
el("refresh-list").addEventListener("click", () => { clearPreview(); void loadList(); });
el("photo-file").addEventListener("click", capturePhotoIntent);
el("photo-file").addEventListener("change", () => { void addPhoto(); }); el("reload-session").addEventListener("click", () => { void bootstrap(); }); el("logout").addEventListener("click", () => { void logout(); });
el("close-preview").addEventListener("click", () => { clearPreview(); previewOpener?.focus?.({ preventScroll: true }); previewOpener = null; for (const button of el("media-grid").querySelectorAll("button")) button.setAttribute("aria-pressed", "false"); });
el("delete-media").addEventListener("click", () => { if (!state.selected || mutating || loading || paused || uncertain) return; deleteTarget = state.selected; el("delete-dialog").showModal(); el("cancel-delete").focus({ preventScroll: true }); });
el("cancel-delete").addEventListener("click", () => { deleteTarget = null; el("delete-dialog").close(); el("delete-media").focus({ preventScroll: true }); });
el("confirm-delete").addEventListener("click", () => { void deleteSelected(); });
el("delete-dialog").addEventListener("cancel", () => { deleteTarget = null; });
document.addEventListener("visibilitychange", () => { if (!visible()) clearPrivate({ keepDeferredPhoto: !mutating }); else void bootstrap(); });
window.addEventListener("pagehide", () => { clearPrivate(); });
window.addEventListener("pageshow", event => { if (event.persisted && visible()) void bootstrap(); });
void bootstrap();
