import { makeConversationState, belongsTo, orderedMessages, mergeMessages, mergeConversation, mergeEvents, sequence, compareSequence, maxSequence, validBody, validCaption, prepareSend, prepareImageSend, completeImageUpload, mediaStillCurrent, createObjectUrlCache, retrySend, rejectPendingSend, rejectPendingImageSend, nearBottom, shouldScroll, readableSequence, inboxRefreshPlan } from "/chat-model.js";

const el = (id) => document.getElementById(id);
const role = location.pathname === "/admin/messages" ? "admin" : location.pathname === "/messages" ? "client" : null;
const sessionBase = role === "admin" ? "/api/auth" : "/api/access";
const chatBase = `/api/chat/${role}`;
const mediaBase = `/api/media/${role}`;
const states = new Map(); const inbox = new Map(); const controllers = new Set();
let generation = 0; let visibilityGeneration = 0; let selectionEpoch = 0;
let selected = null; let csrf = null; let ready = false; let expiryTimer = null;
let sessionOwner = null; let ownerCheck = null; let bootstrapTask = null; let pollEpoch = 0;
let pollTimer = null; let cycleRunning = false; let retryDelay = 3000; let sessionCheckedAt = 0;
let inboxCursor = null; let inboxMore = false; let inboxLoading = false;
let inboxRefreshCursor = null; let lastInboxRefresh = 0;
let olderBusy = false; let sendBusy = false; let logoutBusy = false; let loggingOut = false; let readBusy = false; let readTimer = null; let selectionLoading = false;
const eventRequests = new Set();
const imageUrls = createObjectUrlCache(); const imageRequests = new Map();
let mediaEnabled = false; let mediaVersion = 0; let previewUrl = null; let previewIdentity = null;
let panel = null; let panelVersion = 0; let panelBusy = false; let lightboxVersion = 0; let lightboxItem = null;
let dialogReturnFocus = null; let lightboxReturnFocus = null;
let crm = null;
let broadcastPreference = null;

function notice(message, error = false, id = "chat-status") { const node = el(id); node.textContent = message; node.classList.toggle("is-error", error); }
function currentState() { return selected ? states.get(selected) : null; }
function visible() { return document.visibilityState === "visible"; }
function abortRequests(selectionOnly = false) { for (const controller of controllers) { if (selectionOnly && controller.accountScope) continue; controller.abort(); controllers.delete(controller); } }
function stopPolling() { clearTimeout(pollTimer); pollTimer = null; clearTimeout(readTimer); readTimer = null; }
function revokePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; previewIdentity = null; el("image-preview").replaceChildren(); }
function closeLightbox(restoreFocus = true) {
  lightboxVersion += 1;
  if (lightboxItem) { imageUrls.remove(lightboxItem.media.fullUrl); imageRequests.get(lightboxItem.media.fullUrl)?.controller.abort(); imageRequests.delete(lightboxItem.media.fullUrl); }
  lightboxItem = null; el("lightbox-image").replaceChildren();
  if (el("lightbox").open) el("lightbox").close();
  if (restoreFocus && lightboxReturnFocus?.isConnected) lightboxReturnFocus.focus();
  else if (restoreFocus && visible() && currentState()) (panel ? el("close-media") : el("open-gallery")).focus();
  lightboxReturnFocus = null;
}
function closeMedia(restoreFocus = true) {
  panelVersion += 1; panel = null; panelBusy = false; el("media-grid").replaceChildren();
  if (el("media-dialog").open) el("media-dialog").close();
  if (restoreFocus && dialogReturnFocus?.isConnected) dialogReturnFocus.focus(); dialogReturnFocus = null;
}
function clearImages() {
  mediaVersion += 1;
  for (const record of imageRequests.values()) record.controller.abort(); imageRequests.clear();
  imageUrls.clear(); revokePreview(); closeLightbox(false); closeMedia(false);
  for (const image of el("messages").querySelectorAll("img")) image.removeAttribute("src");
}
function clearChat() {
  clearImages();
  el("messages").replaceChildren(); el("peer-name").textContent = "Messages privés";
  el("conversation-status").textContent = "Choisis une conversation.";
  el("message-body").value = ""; el("message-body").disabled = true; el("send").disabled = true;
  el("photo-tools").hidden = true; el("open-gallery").hidden = true; el("image-draft").hidden = true; el("image-file").value = "";
  for (const id of ["older-messages", "new-messages", "empty-message", "pending-controls"]) el(id).hidden = true;
  el("workspace").classList.remove("selected"); notice("");
}
function clearPrivate() {
  generation += 1; selectionEpoch += 1; visibilityGeneration += 1; ready = false; csrf = null;
  sessionOwner = null; ownerCheck = null; bootstrapTask = null; pollEpoch += 1; cycleRunning = false;
  olderBusy = false; sendBusy = false; readBusy = false; selectionLoading = false; eventRequests.clear();
  mediaEnabled = false;
  crm?.clear(); crm = null; document.getElementById("crm-style")?.remove();
  broadcastPreference?.clear(); broadcastPreference = null; document.getElementById("broadcast-preference-host")?.remove();
  document.getElementById("readiness-nav")?.remove();
  stopPolling(); abortRequests(); clearTimeout(expiryTimer); expiryTimer = null;
  states.clear(); inbox.clear(); selected = null; el("conversations").replaceChildren(); clearChat();
  inboxCursor = null; inboxMore = false; inboxRefreshCursor = null; lastInboxRefresh = 0; inboxLoading = false;
  el("workspace").hidden = true; el("session-status").textContent = ""; el("inbox-status").textContent = "";
  el("more-conversations").hidden = true;
}
function signOut() { clearPrivate(); location.replace(role === "admin" ? "/admin/login" : "/access"); }
function snapshot(state = null) { return { generation, visibilityGeneration, selectionEpoch, id: state?.id, epoch: state?.epoch }; }
function fresh(ticket, account = false) { return ticket.generation === generation && ticket.visibilityGeneration === visibilityGeneration && (account || (ticket.selectionEpoch === selectionEpoch && (!ticket.id || belongsTo(currentState(), ticket.id, ticket.epoch)))); }
async function request(path, { body, rawBody, contentType, mutation = false, state = null, account = false, signal = null, verifyOwner = true } = {}) {
  const owner = sessionOwner; const ticket = snapshot(state); const controller = new AbortController(); controllers.add(controller);
  controller.accountScope = account;
  const abort = () => controller.abort(); if (signal?.aborted) controller.abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), rawBody ? 30000 : 15000);
  const headers = mutation ? { "Content-Type": contentType ?? "application/json", "X-CSRF-Token": csrf ?? "" } : {};
  try {
    if (mutation && verifyOwner && owner) await confirmOwner(ticket, owner, account);
    if (!fresh(ticket, account)) throw staleResponse();
    const response = await fetch(path, { method: mutation ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers, body: mutation ? rawBody ?? JSON.stringify(body ?? {}) : undefined, signal: controller.signal });
    let data; try { data = await response.json(); } catch { data = {}; }
    if (!fresh(ticket, account)) throw staleResponse();
    if (verifyOwner && owner && path !== `${sessionBase}/session`) await confirmOwner(ticket, owner, account);
    if (!fresh(ticket, account)) throw staleResponse();
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status, code: data.error });
    return data;
  } catch (error) {
    if (!fresh(ticket, account)) throw Object.assign(new Error("stale_response"), { stale: true });
    throw error;
  } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); controllers.delete(controller); }
}
function staleResponse() { return Object.assign(new Error("stale_response"), { stale: true }); }
function sameOwner(left, right) { return Boolean(left && right && left.id === right.id && left.role === right.role && left.csrf === right.csrf); }
function sessionIdentity(session) {
  const user = session?.user;
  if (user?.role !== role || typeof user.id !== "string" || user.id.length !== 32 || !/^[0-9a-f]{32}$/.test(user.id)
    || typeof session.csrf !== "string" || session.csrf.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(session.csrf)
    || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Date.now()
    || (role === "client" && session.access?.state !== "active")) return null;
  return { id: user.id, role: user.role, csrf: session.csrf };
}
async function refreshSession({ allowLoggingOut = false } = {}) {
  if (!visible() || (loggingOut && !allowLoggingOut)) throw staleResponse();
  const session = await request(`${sessionBase}/session`, { account: true, verifyOwner: false });
  if (!visible() || (loggingOut && !allowLoggingOut)) throw staleResponse();
  const owner = sessionIdentity(session);
  if (!owner) { signOut(); throw staleResponse(); }
  const changed = Boolean(sessionOwner && !sameOwner(sessionOwner, owner));
  if (changed) clearPrivate();
  sessionOwner = owner; csrf = session.csrf; sessionCheckedAt = Date.now();
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(signOut, Math.max(0, Math.min(2147483647, session.expiresAt - Date.now())));
  return { session, changed };
}
async function refreshAndContinue() {
  const result = await refreshSession();
  if (!result.changed) return true;
  await start({ session: result.session }); return false;
}
async function confirmOwner(ticket, owner, account = false) {
  if (!fresh(ticket, account) || !sameOwner(owner, sessionOwner) || !visible() || loggingOut) throw staleResponse();
  // A response can belong to a new cookie even if this tab's own epoch did not
  // change. Prove the current session before adopting it. Concurrent responses
  // and cached thumbnails share a proof only before that GET is dispatched.
  // A later response needs a later proof, even while the first is outstanding.
  let check = ownerCheck;
  if (!check || check.dispatched || !fresh(check.ticket, true) || !sameOwner(check.owner, owner)) {
    check = { ticket: snapshot(), owner, dispatched: false, promise: null };
    check.promise = Promise.resolve().then(() => { check.dispatched = true; return refreshSession(); })
      .finally(() => { if (ownerCheck === check) ownerCheck = null; });
    ownerCheck = check;
  }
  let result;
  try { result = await check.promise; }
  catch (error) {
    if (error.stale || !fresh(ticket, account) || !sameOwner(owner, sessionOwner)) throw staleResponse();
    // This may follow a committed POST. A failed proof is never a definitive
    // rejection of that POST and must not release its original retry key.
    throw Object.assign(new Error("session_proof_unavailable"), { status: error.status === 401 ? 401 : undefined });
  }
  if (result.changed) { await start({ session: result.session }); throw staleResponse(); }
  if (!fresh(ticket, account) || !sameOwner(owner, sessionOwner) || !visible() || loggingOut) throw staleResponse();
}

async function refreshBroadcastAccess() {
  if (role === "client" && broadcastPreference) return;
  const ticket = snapshot();
  try {
    if (role === "admin") {
      const capability = await request("/api/broadcast/admin/session", { account: true });
      if (!fresh(ticket, true) || capability.user?.role !== "admin" || document.getElementById("broadcast-nav")) return;
      const link = document.createElement("a"); link.id = "broadcast-nav"; link.href = "/admin/broadcasts"; link.textContent = "Diffusions";
      document.getElementById("readiness-nav")?.append(link);
    } else {
      const module = await import("/broadcast-preference.js");
      if (!fresh(ticket, true) || !ready || !visible()) return;
      const host = document.createElement("div"); host.id = "broadcast-preference-host"; el("client-aside").append(host);
      broadcastPreference = module.mountBroadcastPreference(host, { isCurrent: () => ticket.generation === generation && ready && !loggingOut });
    }
  } catch (error) { if (role === "admin" && !error.stale && error.status === 401) signOut(); }
}
function conversationPath(state) { return `${chatBase}/conversations/${state.id}`; }
function errorText(error) {
  if (error.status === 429) return "Trop de demandes. Patiente un moment avant de réessayer.";
  if (error.status === 409) return "Cet envoi a déjà été enregistré avec un contenu différent. Actualise l’historique avant de poursuivre.";
  if (error.status === 400 || error.status === 413) return "Vérifie ton message : 1 à 4 096 caractères, avec du texte.";
  if (error.status === 403) return "L’envoi n’est pas autorisé pour le moment.";
  return "La connexion est interrompue. Ton texte reste ici ; tu peux réessayer.";
}
async function handleError(error, state = null) {
  if (error.stale) return;
  if (state && !belongsTo(currentState(), state.id, state.epoch)) return;
  if (error.status === 403 && error.code === "csrf_failed") {
    try { if (await refreshAndContinue()) notice("Ta connexion a été actualisée. Réessaie ta demande.", true); }
    catch (refreshError) { if (refreshError.status === 401 || refreshError.status === 403) signOut(); else if (!refreshError.stale) notice(errorText(refreshError), true); }
    return;
  }
  if (error.status === 401 || (role === "client" && error.status === 403)) { signOut(); return; }
  if (state && error.status === 404 && belongsTo(currentState(), state.id, state.epoch)) {
    states.delete(state.id); inbox.delete(state.id); selected = null; crm?.removeConversation(state.id); selectionEpoch += 1; selectionLoading = false; clearChat(); renderInbox(); notice("Cette conversation n’est plus accessible.", true); schedulePolling(); return;
  }
  if (role === "admin" && error.status === 403) {
    try {
      if (!await refreshAndContinue()) return;
      if (state && belongsTo(currentState(), state.id, state.epoch)) {
        const result = await request(`${conversationPath(state)}/messages?limit=1`, { state });
        mergeConversation(state, result.conversation); renderMeta(state);
      }
    } catch (refreshError) {
      if (refreshError.status === 401 || refreshError.status === 403) signOut();
      if (refreshError.stale) return;
    }
  }
  notice(errorText(error), true);
}
let imageActive = 0; const imageWaiters = [];
function acquireImageSlot(signal) {
  if (signal.aborted) return Promise.resolve(false);
  if (imageActive < 4) { imageActive += 1; return Promise.resolve(true); }
  return new Promise((resolve) => {
    const waiter = { resolve, signal, cancelled: false };
    const cancel = () => { waiter.cancelled = true; resolve(false); };
    signal.addEventListener("abort", cancel, { once: true }); waiter.cancel = cancel; imageWaiters.push(waiter);
  });
}
function releaseImageSlot() {
  imageActive -= 1;
  while (imageWaiters.length) {
    const waiter = imageWaiters.shift(); waiter.signal.removeEventListener("abort", waiter.cancel);
    if (waiter.cancelled || waiter.signal.aborted) continue;
    imageActive += 1; waiter.resolve(true); break;
  }
}
function validMediaUrl(path, state) {
  if (typeof path !== "string" || /[\r\n]/.test(path)) return false;
  const id = "[0-9a-f]{32}";
  return new RegExp(`^${mediaBase}/(?:assets/${id}|conversations/${state.id}/messages/${id})/(?:full|thumb)$`).test(path);
}
async function imageUrl(path, state) {
  if (!visible() || !validMediaUrl(path, state)) throw Object.assign(new Error("image_unavailable"), { stale: true });
  const owner = sessionOwner; const ownerTicket = snapshot(state);
  await confirmOwner(ownerTicket, owner);
  const cached = imageUrls.get(path); if (cached) return cached;
  const inFlight = imageRequests.get(path); if (inFlight) return inFlight.promise;
  const ticket = snapshot(state); const version = mediaVersion; const controller = new AbortController();
  const record = { controller, promise: null };
  record.promise = (async () => {
    const acquired = await acquireImageSlot(controller.signal); if (!acquired) throw Object.assign(new Error("stale_image"), { stale: true });
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (controller.signal.aborted || !fresh(ticket) || version !== mediaVersion || !sameOwner(owner, sessionOwner) || !visible() || loggingOut) throw staleResponse();
      await confirmOwner(ticket, owner);
      if (controller.signal.aborted || !fresh(ticket) || version !== mediaVersion || !sameOwner(owner, sessionOwner) || !visible() || loggingOut) throw staleResponse();
      if (!response.ok) {
        if (response.status === 401 || (role === "client" && response.status === 403)) signOut();
        throw Object.assign(new Error("image_unavailable"), { status: response.status });
      }
      if (response.headers.get("Content-Type")?.split(";")[0] !== "image/jpeg") throw new Error("invalid_image_response");
      const blob = await response.blob();
      await confirmOwner(ticket, owner);
      if (blob.size > 10485760 || controller.signal.aborted || !fresh(ticket) || version !== mediaVersion || !visible()) throw Object.assign(new Error("stale_image"), { stale: true });
      const url = URL.createObjectURL(blob);
      if (!imageUrls.put(path, url, blob.size)) throw new Error("image_too_large");
      return url;
    } finally { clearTimeout(timeout); releaseImageSlot(); if (imageRequests.get(path) === record) imageRequests.delete(path); }
  })();
  imageRequests.set(path, record); return record.promise;
}
function loadPhoto(container, media, state, { full = false, current = () => true } = {}) {
  const path = full ? media.fullUrl : media.thumbnailUrl;
  container.textContent = "Chargement de la photo…";
  void imageUrl(path, state).then((url) => {
    if (!container.isConnected || !current() || !visible()) return;
    const image = document.createElement("img"); image.alt = full ? "Photo privée agrandie" : "Photo privée"; image.decoding = "async";
    image.width = full ? media.width : media.thumbnailWidth; image.height = full ? media.height : media.thumbnailHeight;
    image.addEventListener("load", () => { if (current()) { container.dataset.loaded = "true"; scheduleRead(); } });
    image.addEventListener("error", () => { if (current() && container.isConnected) { container.textContent = "Photo indisponible"; imageUrls.remove(path); } });
    image.src = url; container.replaceChildren(image);
  }).catch((error) => { if (!error.stale && container.isConnected && current()) container.textContent = "Photo indisponible"; });
}
function pruneDeletedPhotos(state, deleted = []) {
  let galleryChanged = false;
  for (const message of [...state.messages.values(), ...deleted]) {
    if (message.deletedAt == null) continue;
    const prefix = `${mediaBase}/conversations/${state.id}/messages/${message.id}/`;
    imageUrls.removeWhere((path) => path.startsWith(prefix));
    for (const [path, record] of imageRequests) if (path.startsWith(prefix)) { record.controller.abort(); imageRequests.delete(path); }
    if (lightboxItem?.messageId === message.id) closeLightbox();
    if (panel?.kind === "gallery") { const length = panel.items.length; panel.items = panel.items.filter((item) => item.messageId !== message.id); galleryChanged ||= length !== panel.items.length; }
  }
  if (galleryChanged) renderMediaPanel();
}
function renderImageDraft(state) {
  const draft = state.imageDraft; const pending = state.pending?.kind === "image" ? state.pending : null; const hasImage = Boolean(draft || pending);
  el("image-draft").hidden = !hasImage;
  el("message-body").maxLength = hasImage ? 1000 : 4096; el("message-body").required = !hasImage;
  el("message-body").placeholder = hasImage ? "Ajoute une légende (facultatif)…" : "Écris ton message…";
  el("composer-help").textContent = hasImage ? "Photo privée · légende facultative de 1 000 caractères maximum" : "Message privé · 4 096 caractères maximum";
  el("cancel-image").disabled = Boolean(state.pending) || sendBusy;
  if (!hasImage) { revokePreview(); return; }
  el("image-draft-status").textContent = pending?.stage === "uploading" ? "Préparation de la photo…" : draft?.asset?.sharedHere ? "Déjà envoyée ici · nouvel envoi" : "Une photo à envoyer";
  if (!visible()) return;
  const identity = draft?.file ?? draft?.asset?.id ?? pending?.mediaId;
  if (identity && identity === previewIdentity) return;
  revokePreview(); previewIdentity = identity;
  if (draft?.file) {
    previewUrl = URL.createObjectURL(draft.file); const image = document.createElement("img"); image.alt = "Aperçu de la photo choisie"; image.src = previewUrl; el("image-preview").append(image);
  } else if (draft?.asset) {
    const id = draft.asset.id; loadPhoto(el("image-preview"), draft.asset, state, { current: () => belongsTo(currentState(), state.id, state.epoch) && state.imageDraft?.asset?.id === id });
  } else el("image-preview").textContent = "Photo prête";
}
async function refreshMediaCapability() {
  try { const value = await request(`${mediaBase}/capabilities`); mediaEnabled = value.enabled === true; }
  catch (error) { if (error.stale) throw error; if (error.status === 404) mediaEnabled = false; else if (error.status === 401 || (role === "client" && error.status === 403)) { signOut(); throw error; } else mediaEnabled = false; }
}
async function refreshCrmCapability() {
  if (role !== "admin") return;
  const ticket = snapshot();
  try {
    const capability = await request("/api/admin/crm/capabilities", { account: true });
    if (capability.enabled !== true) return;
    const module = await import("/crm.js");
    if (!fresh(ticket, true)) return;
    const style = document.createElement("link"); style.id = "crm-style"; style.rel = "stylesheet"; style.href = "/crm.css"; document.head.append(style);
    crm = module.createCrmUI({
      request, inboxHead: document.querySelector(".inbox-head"), chatHead: document.querySelector(".chat-head"),
      onError: (error) => handleError(error),
      onUnavailable(id) {
        states.delete(id); inbox.delete(id);
        if (selected === id) { selected = null; selectionEpoch += 1; selectionLoading = false; clearChat(); }
        renderInbox(); notice("Cette conversation n’est plus accessible.", true); schedulePolling();
      },
      onContacts(contacts, page) {
        inbox.clear(); for (const contact of contacts) inbox.set(contact.id, contact);
        inboxCursor = page.cursor; inboxMore = page.hasMore; inboxLoading = page.loading;
        renderInbox();
        const state = currentState(); if (state?.conversation) el("peer-name").textContent = crm?.displayName(inbox.get(state.id) ?? state.conversation) ?? state.conversation.peerName;
      }
    });
    await crm.initialize();
  } catch (error) {
    if (error.stale) return;
    if (error.status === 401 || error.status === 403) { signOut(); throw error; }
    if (error.status !== 404) notice("Les fiches privées sont indisponibles pour le moment.", true, "session-status");
  }
}
function chooseFile() {
  const state = currentState(); const file = el("image-file").files?.[0]; el("image-file").value = "";
  if (!state || !file || state.pending || sendBusy || !state.conversation?.canSend) return;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size < 1 || file.size > 10485760) { notice("Choisis une photo JPEG, PNG ou WebP de 10 Mo maximum.", true); return; }
  if (el("message-body").value.length > 1000) { notice("Raccourcis ton texte à 1 000 caractères avant d’ajouter une photo.", true); return; }
  state.imageDraft = { file, asset: null }; renderMeta(state); notice("Photo choisie. Ajoute une légende ou envoie-la."); el("message-body").focus();
}
function mediaErrorText(error) {
  if (error.status === 507 && error.code === "storage_limit") return "Le stockage des photos a atteint sa limite. Contacte Jessie.";
  if (error.status === 409 && error.code === "media_in_use") return "Cette photo est encore présente dans une conversation. Supprime d’abord tous tes messages qui la contiennent.";
  if (error.status === 404) return "Cette photo n’est plus disponible.";
  if (error.status === 415 || error.status === 400 || error.status === 413) return "Photo refusée. Utilise une image JPEG, PNG ou WebP de 10 Mo maximum, avec une légende de 1 000 caractères maximum.";
  if (error.status === 429) return "Patiente un moment avant de réessayer cet envoi.";
  return "La photo n’a pas pu être chargée. Réessaie dans un moment.";
}
async function handleMediaError(error, state, target = "chat-status") {
  if (error.stale) return;
  if (error.status === 401 || error.status === 403) { await handleError(error, state); return; }
  notice(mediaErrorText(error), true, target);
}
async function openMedia(kind, opener) {
  const state = currentState(); if (!state || !mediaEnabled || !visible() || (kind === "library" && (state.pending || !state.conversation?.canSend))) return;
  closeMedia(false); dialogReturnFocus = opener;
  panel = { kind, conversationId: state.id, epoch: state.epoch, items: [], cursor: null, hasMore: false };
  el("media-title").textContent = kind === "library" ? "Mes photos" : "Photos de la conversation";
  el("media-help").textContent = kind === "library" ? "Tes photos personnelles peuvent être envoyées dans cette conversation. Une photo reçue ne fait pas partie de ta bibliothèque." : "Les photos partagées ici restent accessibles tant que le message et ton accès le permettent.";
  el("media-status").textContent = "Chargement…"; el("more-media").hidden = true; el("media-dialog").showModal();
  await loadMediaPage();
}
async function loadMediaPage(more = false) {
  const state = currentState(); const activePanel = panel; const version = panelVersion;
  if (!state || !activePanel || panelBusy || (more && !activePanel.hasMore)) return;
  panelBusy = true; el("more-media").disabled = true;
  try {
    const cursor = more ? activePanel.cursor : null;
    const path = activePanel.kind === "library" ? `${mediaBase}/assets?conversationId=${state.id}&limit=50${cursor ? `&afterId=${cursor}` : ""}`
      : `${mediaBase}/conversations/${state.id}/gallery?limit=50${cursor ? `&before=${cursor}` : ""}`;
    const result = await request(path, { state });
    if (panel !== activePanel || version !== panelVersion) return;
    const items = activePanel.kind === "library" ? result.assets : result.items;
    const map = new Map((more ? activePanel.items : []).map((item) => [activePanel.kind === "library" ? item.id : item.messageId, item]));
    for (const item of items) {
      if (activePanel.kind === "gallery" && [...state.messages.values()].some((message) => message.id === item.messageId && message.deletedAt != null)) continue;
      map.set(activePanel.kind === "library" ? item.id : item.messageId, item);
    }
    activePanel.items = [...map.values()].slice(-100); activePanel.cursor = activePanel.kind === "library" ? result.nextCursor : result.nextBefore; activePanel.hasMore = result.hasMore;
    el("media-status").textContent = activePanel.items.length ? "" : activePanel.kind === "library" ? "Aucune photo dans ta bibliothèque pour le moment." : "Aucune photo partagée dans cette conversation.";
    renderMediaPanel();
  } catch (error) { if (panel === activePanel && version === panelVersion) await handleMediaError(error, state, "media-status"); }
  finally { if (panel === activePanel && version === panelVersion) { panelBusy = false; el("more-media").disabled = false; } }
}
function renderMediaPanel() {
  const state = currentState(); const activePanel = panel; if (!state || !activePanel || !belongsTo(state, activePanel.conversationId, activePanel.epoch)) return;
  const version = panelVersion; const fragment = document.createDocumentFragment();
  for (const item of activePanel.items) {
    const media = activePanel.kind === "library" ? item : item.media;
    const card = document.createElement("article"); card.className = "media-card";
    const photo = document.createElement("button"); photo.type = "button"; photo.className = "photo-open"; photo.setAttribute("aria-label", "Agrandir cette photo privée");
    photo.addEventListener("click", () => { void openLightbox({ media, messageId: activePanel.kind === "gallery" ? item.messageId : null }, state, photo); });
    card.append(photo);
    const caption = document.createElement("p"); caption.textContent = `${media.width} × ${media.height} · ${dateText(activePanel.kind === "library" ? media.createdAt : item.createdAt, true)}`; card.append(caption);
    if (activePanel.kind === "library") {
      if (media.sharedHere) { const warning = document.createElement("p"); warning.className = "shared-photo"; warning.textContent = "Déjà envoyée ici. Renvoyer crée un nouveau message."; card.append(warning); }
      const actions = document.createElement("div"); actions.className = "media-actions";
      const choose = document.createElement("button"); choose.type = "button"; choose.className = "text-button"; choose.textContent = media.sharedHere ? "Renvoyer" : "Choisir"; choose.disabled = !state.conversation?.canSend || Boolean(state.pending);
      choose.addEventListener("click", () => {
        if (!belongsTo(currentState(), state.id, state.epoch) || state.pending || !state.conversation?.canSend) return;
        if (el("message-body").value.length > 1000) { notice("Raccourcis ton texte à 1 000 caractères avant de choisir une photo.", true, "media-status"); return; }
        state.imageDraft = { file: null, asset: media }; closeMedia(); renderMeta(state); notice(media.sharedHere ? "Cette photo a déjà été envoyée ici. Envoyer ajoutera un nouveau message." : "Photo choisie. Ajoute une légende ou envoie-la."); el("message-body").focus();
      });
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button"; remove.textContent = "Supprimer la photo";
      remove.addEventListener("click", () => { void removeOwnAsset(media, state, remove); }); actions.append(choose, remove); card.append(actions);
    }
    fragment.append(card);
    // Start only after this fragment is attached, so late reads never populate
    // a detached panel or an old conversation.
    queueMicrotask(() => { if (panel === activePanel && version === panelVersion && photo.isConnected) loadPhoto(photo, media, state, { current: () => panel === activePanel && version === panelVersion && activePanel.items.includes(item) }); });
  }
  el("media-grid").replaceChildren(fragment); el("more-media").hidden = !activePanel.hasMore;
  el("more-media").textContent = activePanel.kind === "library" ? "Autres photos" : "Photos précédentes";
}
async function removeOwnAsset(media, state, button) {
  if (button.disabled) return; button.disabled = true; const activePanel = panel;
  try {
    await request(`${mediaBase}/assets/${media.id}/delete`, { state, mutation: true });
    imageUrls.remove(media.fullUrl); imageUrls.remove(media.thumbnailUrl);
    for (const path of [media.fullUrl, media.thumbnailUrl]) { imageRequests.get(path)?.controller.abort(); imageRequests.delete(path); }
    if (lightboxItem?.media.id === media.id) closeLightbox();
    if (state.imageDraft?.asset?.id === media.id) { state.imageDraft = null; renderMeta(state); }
    if (panel === activePanel) { panel.items = panel.items.filter((item) => item.id !== media.id); renderMediaPanel(); notice("Photo retirée de ta bibliothèque.", false, "media-status"); }
  } catch (error) { if (panel === activePanel) await handleMediaError(error, state, "media-status"); }
  finally { if (button.isConnected) button.disabled = false; }
}
async function openLightbox(item, state, opener) {
  if (!visible()) return;
  closeLightbox(false); lightboxItem = item; lightboxReturnFocus = opener; const version = lightboxVersion;
  el("lightbox-status").textContent = "Photo privée"; el("lightbox").showModal();
  loadPhoto(el("lightbox-image"), item.media, state, { full: true, current: () => lightboxItem === item && lightboxVersion === version
    && belongsTo(currentState(), state.id, state.epoch) && (!item.messageId || ![...state.messages.values()].some((message) => message.id === item.messageId && message.deletedAt != null)) });
}
function dateText(value, long = false) {
  return new Date(value).toLocaleString("fr-FR", long ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
}
function renderInbox() {
  const container = el("conversations"); container.replaceChildren();
  for (const conversation of [...inbox.values()].sort((a, b) => (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt) || a.id.localeCompare(b.id))) {
    const button = document.createElement("button"); button.type = "button"; button.className = "contact";
    button.classList.toggle("active", conversation.id === selected); button.setAttribute("aria-pressed", String(conversation.id === selected));
    const text = document.createElement("span"); const name = document.createElement("strong"); name.textContent = crm?.displayName(conversation) ?? conversation.peerName;
    const time = document.createElement("time"); time.dateTime = new Date(conversation.lastActivityAt ?? conversation.createdAt).toISOString(); time.textContent = dateText(conversation.lastActivityAt ?? conversation.createdAt, true);
    text.append(name, time);
    if (crm && conversation.crm) {
      const details = document.createElement("span"); details.className = "crm-contact-meta";
      details.textContent = conversation.crm.labels.map((label) => label.name).join(" · ");
      if (conversation.crm.reminderAt !== null && conversation.crm.reminderAt <= Date.now()) details.textContent += `${details.textContent ? " · " : ""}Rappel à traiter`;
      if (details.textContent) text.append(details);
    }
    button.append(text);
    if (conversation.unreadCount > 0) { const count = document.createElement("span"); count.className = "unread"; count.textContent = String(conversation.unreadCount); count.setAttribute("aria-label", `${conversation.unreadCount} messages non lus`); button.append(count); }
    button.addEventListener("click", () => { void selectConversation(conversation.id); }); container.append(button);
  }
  el("inbox-status").textContent = inbox.size ? "" : "Aucune conversation pour le moment.";
  el("more-conversations").hidden = !inboxMore; el("more-conversations").disabled = inboxLoading;
}
async function loadInbox(more = false, refresh = false) {
  if (crm) { await crm.loadInbox(more, refresh); lastInboxRefresh = Date.now(); return; }
  if (inboxLoading) return;
  if (more && (!inboxMore || !inboxCursor)) return;
  const ticket = snapshot();
  inboxLoading = true;
  try {
    const boundary = more ? inboxCursor : refresh ? inboxRefreshCursor : null;
    const loadedIds = [...inbox.keys()];
    const result = await request(`${chatBase}/conversations?limit=50${boundary ? `&afterId=${boundary}` : ""}`);
    const plan = inboxRefreshPlan(loadedIds, result);
    for (const conversation of result.conversations) {
      if (!refresh || !plan.lastLoadedId || conversation.id <= plan.lastLoadedId) inbox.set(conversation.id, conversation);
    }
    if (refresh) {
      inboxRefreshCursor = plan.nextBoundary;
      if (plan.lastLoadedId === null) {
        inboxCursor = result.nextCursor ?? [...inbox.keys()].sort().at(-1) ?? null;
        inboxMore = result.hasMore;
      }
      if (plan.probeTail) {
        // One metadata row is enough to discover a new tail, even after all
        // known pages were loaded. The user still chooses to load those rows.
        const tail = await request(`${chatBase}/conversations?limit=1&afterId=${plan.lastLoadedId}`);
        inboxMore = tail.conversations.length > 0; inboxCursor = plan.lastLoadedId;
      }
    } else {
      inboxCursor = result.nextCursor ?? [...inbox.keys()].sort().at(-1) ?? null;
      inboxMore = result.hasMore;
    }
    lastInboxRefresh = Date.now();
    renderInbox();
  } finally { if (fresh(ticket)) { inboxLoading = false; el("more-conversations").disabled = false; } }
}
function renderMeta(state) {
  const conversation = state.conversation; if (!conversation) return;
  el("peer-name").textContent = crm?.displayName(inbox.get(state.id) ?? conversation) ?? conversation.peerName;
  el("conversation-status").textContent = conversation.closedAt != null ? "Conversation fermée · historique disponible" : !conversation.canSend ? "Accès à l’envoi suspendu · historique disponible" : "Conversation privée";
  el("message-body").disabled = !conversation.canSend || Boolean(state.pending) || sendBusy;
  const hasImage = Boolean(state.imageDraft || state.pending?.kind === "image");
  el("send").disabled = !conversation.canSend || Boolean(state.pending) || sendBusy || !(hasImage ? validCaption(el("message-body").value) : validBody(el("message-body").value));
  el("photo-tools").hidden = !mediaEnabled; el("open-gallery").hidden = !mediaEnabled;
  for (const id of ["pick-image", "open-library"]) el(id).disabled = !conversation.canSend || Boolean(state.pending) || sendBusy;
  renderImageDraft(state);
  el("pending-controls").hidden = state.pending?.status !== "retry";
  el("retry-send").disabled = !conversation.canSend || sendBusy;
  el("older-messages").hidden = !state.hasMoreBefore; el("older-messages").disabled = olderBusy;
  if (role === "admin") {
    if (crm) crm.updateConversation(conversation);
    else { inbox.set(state.id, conversation); renderInbox(); }
  }
}
function viewportAnchor() {
  const box = el("message-scroll").getBoundingClientRect();
  const first = [...el("messages").children].find((item) => item.getBoundingClientRect().bottom > box.top);
  return first ? { sequence: first.dataset.sequence, offset: first.getBoundingClientRect().top - box.top } : null;
}
function renderMessages(state, { initial = false, ownSend = false, prepend = false } = {}) {
  if (!belongsTo(currentState(), state.id, state.epoch)) return;
  const scroll = el("message-scroll"); const atBottom = nearBottom(scroll); const anchor = viewportAnchor(); const oldTop = scroll.scrollTop;
  pruneDeletedPhotos(state);
  const messages = orderedMessages(state); const container = el("messages"); const fragment = document.createDocumentFragment(); const photos = [];
  for (const message of messages) {
    const own = message.sender === "me"; const fromJessie = role === "admin" ? own : !own;
    const article = document.createElement("article"); article.className = `message ${own ? "own" : ""} ${fromJessie ? "from-jessie" : "from-client"}`; article.dataset.sequence = message.sequence; article.dataset.sender = message.sender; article.setAttribute("role", "listitem");
    const body = document.createElement(message.media && message.deletedAt == null ? "div" : "p"); body.className = "bubble"; article.classList.toggle("deleted", message.deletedAt != null);
    if (message.media && message.deletedAt == null) {
      body.classList.add("photo-message"); const photo = document.createElement("button"); photo.type = "button"; photo.className = "photo-open"; photo.style.aspectRatio = `${message.media.thumbnailWidth}/${message.media.thumbnailHeight}`; photo.setAttribute("aria-label", "Agrandir la photo de ce message");
      if (mediaEnabled) {
        photo.addEventListener("click", () => { void openLightbox({ media: message.media, messageId: message.id }, state, photo); });
        photos.push({ photo, message });
      } else { photo.textContent = "Photos indisponibles pour le moment"; photo.disabled = true; }
      body.append(photo); if (message.body) { const caption = document.createElement("p"); caption.className = "photo-caption"; caption.textContent = message.body; body.append(caption); }
    } else body.textContent = message.deletedAt != null ? "Message supprimé" : message.body;
    article.append(body);
    const meta = document.createElement("div"); meta.className = "message-meta";
    const time = document.createElement("time"); time.dateTime = new Date(message.createdAt).toISOString(); time.textContent = dateText(message.createdAt, true); meta.append(time);
    if (own && message.deletedAt == null) {
      const receipt = document.createElement("span"); receipt.textContent = compareSequence(state.conversation.peerReadSequence, message.sequence) >= 0 ? "Lu" : "Envoyé"; meta.append(receipt);
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-message"; remove.textContent = "Supprimer"; remove.setAttribute("aria-label", `Supprimer mon message du ${dateText(message.createdAt, true)}`);
      remove.addEventListener("click", () => { void deleteMessage(state, message, remove); }); meta.append(remove);
    }
    article.append(meta); fragment.append(article);
  }
  container.replaceChildren(fragment); el("empty-message").hidden = messages.length !== 0;
  for (const { photo, message } of photos) {
    const ticket = { id: state.id, epoch: state.epoch, messageId: message.id, mediaId: message.media.id };
    loadPhoto(photo, message.media, state, { current: () => mediaStillCurrent(currentState(), ticket) });
  }
  if (shouldScroll({ initial, ownSend, wasNearBottom: atBottom, prepend })) { scroll.scrollTop = scroll.scrollHeight; el("new-messages").hidden = true; }
  else if (anchor) {
    const item = [...container.children].find((node) => node.dataset.sequence === anchor.sequence);
    if (item) scroll.scrollTop += item.getBoundingClientRect().top - scroll.getBoundingClientRect().top - anchor.offset;
    else scroll.scrollTop = oldTop;
  }
  renderMeta(state); scheduleRead();
}
async function selectConversation(id) {
  if (id === selected) return;
  const previous = currentState(); if (previous) { previous.draft = el("message-body").value; if (previous.pending?.status === "sending") retrySend(previous); }
  selectionEpoch += 1; stopPolling(); abortRequests(true); inboxLoading = false; olderBusy = false; sendBusy = false; readBusy = false; selectionLoading = true;
  selected = id;
  crm?.selectConversation(id);
  const oldState = states.get(id);
  const state = oldState ? { ...oldState, epoch: selectionEpoch } : makeConversationState(id, selectionEpoch);
  if (state.pending?.status === "sending") retrySend(state);
  states.set(id, state);
  clearChat(); el("workspace").classList.add("selected"); el("message-body").value = state.draft;
  el("peer-name").textContent = inbox.get(id)?.peerName ?? "Jessie"; el("conversation-status").textContent = "Chargement de la conversation…";
  renderInbox();
  try {
    if (state.messages.size || state.conversation) { renderMessages(state, { initial: true }); await fetchEvents(state); }
    else {
      const result = await request(`${conversationPath(state)}/messages?limit=50`, { state });
      mergeConversation(state, result.conversation); mergeMessages(state, result.messages);
      state.eventCursor = sequence(result.eventCursor); state.hasMoreBefore = result.hasMoreBefore; state.nextBefore = result.nextBefore;
      renderMessages(state, { initial: true });
    }
    schedulePolling();
  } catch (error) { await handleError(error, state); }
  finally { if (belongsTo(currentState(), state.id, state.epoch)) { selectionLoading = false; schedulePolling(); } }
}
async function loadOlder() {
  const state = currentState(); if (!state || olderBusy || !state.hasMoreBefore || !state.nextBefore) return;
  const ticket = snapshot(state);
  olderBusy = true; renderMeta(state);
  try {
    const result = await request(`${conversationPath(state)}/messages?before=${state.nextBefore}&limit=50`, { state });
    mergeConversation(state, result.conversation); mergeMessages(state, result.messages);
    state.hasMoreBefore = result.hasMoreBefore; state.nextBefore = result.nextBefore; renderMessages(state, { prepend: true });
  } catch (error) { await handleError(error, state); }
  finally { if (fresh(ticket)) { olderBusy = false; renderMeta(state); } }
}
async function fetchEvents(state) {
  const requestKey = `${state.id}:${state.epoch}:${visibilityGeneration}`;
  if (eventRequests.has(requestKey)) return false;
  eventRequests.add(requestKey);
  try {
  let more = false;
  for (let page = 0; page < 3; page += 1) {
    const result = await request(`${conversationPath(state)}/events?after=${state.eventCursor}&limit=100`, { state });
    const atBottom = nearBottom(el("message-scroll")); const before = state.conversation?.latestSequence ?? "0"; const pending = state.pending?.clientMessageId;
    mergeConversation(state, result.conversation); mergeEvents(state, result.events, result.nextCursor);
    pruneDeletedPhotos(state, result.events.filter((event) => event.kind === "delete").map((event) => event.message));
    if (pending && !state.pending) { state.draft = ""; el("message-body").value = ""; notice("Message enregistré."); }
    renderMessages(state);
    if (!atBottom && compareSequence(state.conversation.latestSequence, before) > 0) el("new-messages").hidden = false;
    more = result.hasMore; if (!more) break;
  }
  return more;
  } finally { eventRequests.delete(requestKey); }
}
function schedulePolling(delay = retryDelay) {
  if (!ready || !visible()) return;
  clearTimeout(pollTimer); pollTimer = setTimeout(() => { void poll(); }, delay);
}
async function poll() {
  if (!ready || !visible()) return;
  if (cycleRunning) { schedulePolling(300); return; }
  if (selectionLoading) { schedulePolling(); return; }
  cycleRunning = true; const cycle = ++pollEpoch; const ticket = snapshot(); let catchup = false;
  try {
    if (Date.now() - sessionCheckedAt > 60000 && !await refreshAndContinue()) return;
    if (role === "admin" && Date.now() - lastInboxRefresh >= 30000) await loadInbox(false, true);
    const state = currentState(); if (state) catchup = await fetchEvents(state);
    retryDelay = 3000; notice("");
  } catch (error) { if (!error.stale) { retryDelay = Math.min(30000, retryDelay * 2); await handleError(error, currentState()); } }
  finally { if (cycle === pollEpoch) { cycleRunning = false; if (fresh(ticket)) schedulePolling(catchup ? 300 : retryDelay); } }
}
function newClientId() { return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function sendMessage(retry = false) {
  const state = currentState(); if (!state || sendBusy || !state.conversation?.canSend || (!retry && state.pending)) return;
  if ((retry && state.pending?.kind === "image") || (!retry && state.imageDraft)) { await sendImage(retry); return; }
  const ticket = snapshot(state);
  const body = retry ? state.pending?.body : el("message-body").value;
  if (!validBody(body)) { notice("Écris un message de 1 à 4 096 caractères.", true); return; }
  const pending = prepareSend(state, body, state.pending?.clientMessageId ?? newClientId());
  state.draft = body; sendBusy = true; renderMeta(state); notice("Envoi en cours…");
  try {
    const result = await request(`${conversationPath(state)}/messages`, { state, mutation: true, body: { clientMessageId: pending.clientMessageId, body: pending.body } });
    mergeMessages(state, [result.message]);
    state.conversation.latestSequence = maxSequence(state.conversation.latestSequence, result.message.sequence);
    state.draft = ""; el("message-body").value = ""; renderMessages(state, { ownSend: true }); notice("Message enregistré."); schedulePolling(300);
  } catch (error) {
    // An event may have acknowledged this request while its HTTP response was lost.
    if (!error.stale && state.pending && !rejectPendingSend(state, error.status)) retrySend(state);
    await handleError(error, state);
  } finally { if (fresh(ticket)) { sendBusy = false; renderMeta(state); } }
}
async function sendImage(retry = false) {
  const state = currentState(); if (!state || sendBusy || !mediaEnabled || !state.conversation?.canSend) return;
  const ticket = snapshot(state); const caption = retry ? state.pending?.caption : el("message-body").value;
  if (!validCaption(caption)) { notice("Ajoute une légende de 1 000 caractères maximum, ou laisse le champ vide.", true); return; }
  const draft = state.imageDraft;
  const pending = prepareImageSend(state, { caption, mediaId: retry ? state.pending?.mediaId : draft?.asset?.id ?? null, file: retry ? state.pending?.file : draft?.file ?? null }, state.pending?.clientMessageId ?? newClientId());
  state.draft = caption; sendBusy = true; renderMeta(state); notice(pending.mediaId ? "Envoi de la photo…" : "Préparation de la photo…");
  try {
    if (!pending.mediaId) {
      const result = await request(`${mediaBase}/assets`, { state, mutation: true, rawBody: pending.file, contentType: pending.file.type });
      if (!completeImageUpload(state, pending.clientMessageId, result.asset.id)) return;
      state.imageDraft = { file: null, asset: result.asset }; renderMeta(state);
    }
    const result = await request(`${mediaBase}/conversations/${state.id}/messages`, { state, mutation: true, body: { clientMessageId: pending.clientMessageId, mediaId: pending.mediaId, caption: pending.caption } });
    mergeMessages(state, [result.message]); state.conversation.latestSequence = maxSequence(state.conversation.latestSequence, result.message.sequence);
    state.draft = ""; state.imageDraft = null; el("message-body").value = ""; renderMessages(state, { ownSend: true }); notice("Photo enregistrée."); schedulePolling(300);
  } catch (error) {
    // The server resolves an existing idempotency key before checking an
    // asset's existence. A 404 here proves no image send was recorded and
    // permits choosing a replacement, including after deletion in another tab.
    if (!error.stale && state.pending && !rejectPendingImageSend(state, error.status)) retrySend(state);
    await handleMediaError(error, state);
  } finally { if (fresh(ticket)) { sendBusy = false; renderMeta(state); } }
}
async function deleteMessage(state, message, button) {
  if (!belongsTo(currentState(), state.id, state.epoch) || button.disabled) return;
  button.disabled = true;
  try {
    const result = await request(`${conversationPath(state)}/messages/${message.id}/delete`, { state, mutation: true });
    mergeMessages(state, [result.message]); renderMessages(state); notice("Ton message est supprimé.");
  } catch (error) { await handleError(error, state); if (button.isConnected) button.disabled = false; }
}
function scheduleRead() { clearTimeout(readTimer); if (ready && visible()) readTimer = setTimeout(() => { void markRead(); }, 150); }
async function markRead() {
  const state = currentState(); if (!state || !state.conversation || readBusy || !visible()) return;
  const ticket = snapshot(state);
  const scroll = el("message-scroll"); const box = scroll.getBoundingClientRect();
  const visibleSequences = [...el("messages").children].filter((node) => { const rect = node.getBoundingClientRect(); return rect.bottom > box.top + 12 && rect.top < box.bottom - 12; }).map((node) => node.dataset.sequence);
  const loadedMediaIds = [...el("messages").children].filter((node) => node.querySelector(".photo-open")?.dataset.loaded === "true").map((node) => [...state.messages.values()].find((message) => message.sequence === node.dataset.sequence)?.id).filter(Boolean);
  const throughSequence = readableSequence(orderedMessages(state), { visible: visible(), nearBottom: nearBottom(scroll), visibleSequences, loadedMediaIds });
  if (compareSequence(throughSequence, state.conversation.lastReadSequence) <= 0) return;
  readBusy = true;
  try {
    const result = await request(`${conversationPath(state)}/read`, { state, mutation: true, body: { throughSequence } });
    if (result.conversation) mergeConversation(state, result.conversation);
    else state.conversation.lastReadSequence = maxSequence(state.conversation.lastReadSequence, sequence(result.lastReadSequence));
    renderMeta(state);
  } catch (error) { await handleError(error, state); }
  finally { if (fresh(ticket)) readBusy = false; }
}
async function logout() {
  if (logoutBusy) return; logoutBusy = true; loggingOut = true;
  const logoutCsrf = csrf; clearPrivate(); csrf = logoutCsrf;
  el("logout").disabled = true; notice("Déconnexion en cours…", false, "session-status");
  try { await request(`${sessionBase}/logout`, { mutation: true, verifyOwner: false }); signOut(); }
  catch (error) {
    if (error.status === 401) signOut();
    else {
      if (error.status === 403) { try { await refreshSession({ allowLoggingOut: true }); } catch (refreshError) { if (refreshError.status === 401 || refreshError.status === 403) signOut(); } }
      notice("La déconnexion n’a pas été confirmée. Réessaie avec le bouton Se déconnecter.", true, "session-status");
    }
  }
  finally { logoutBusy = false; el("logout").disabled = false; }
}
el("composer").addEventListener("submit", (event) => { event.preventDefault(); void sendMessage(); });
el("message-body").addEventListener("input", () => { const state = currentState(); if (state) { state.draft = el("message-body").value; renderMeta(state); } });
el("retry-send").addEventListener("click", () => { void sendMessage(true); });
el("pick-image").addEventListener("click", () => { if (!el("pick-image").disabled) el("image-file").click(); });
el("image-file").addEventListener("change", chooseFile);
el("cancel-image").addEventListener("click", () => { const state = currentState(); if (state && !state.pending && !sendBusy) { state.imageDraft = null; renderMeta(state); notice("Photo retirée de cet envoi."); } });
el("open-library").addEventListener("click", (event) => { void openMedia("library", event.currentTarget); });
el("open-gallery").addEventListener("click", (event) => { void openMedia("gallery", event.currentTarget); });
el("close-media").addEventListener("click", () => closeMedia());
el("close-lightbox").addEventListener("click", () => closeLightbox());
el("media-dialog").addEventListener("close", () => { if (panel) closeMedia(); });
el("lightbox").addEventListener("close", () => { if (lightboxItem) closeLightbox(); });
el("more-media").addEventListener("click", () => { void loadMediaPage(true); });
el("older-messages").addEventListener("click", () => { void loadOlder(); });
el("more-conversations").addEventListener("click", () => { void loadInbox(true).catch((error) => handleError(error)); });
el("new-messages").addEventListener("click", () => { el("message-scroll").scrollTop = el("message-scroll").scrollHeight; el("new-messages").hidden = true; scheduleRead(); });
el("message-scroll").addEventListener("scroll", () => { if (nearBottom(el("message-scroll"))) el("new-messages").hidden = true; scheduleRead(); }, { passive: true });
el("back-to-inbox").addEventListener("click", () => {
  const state = currentState(); if (state) { state.draft = el("message-body").value; if (state.pending?.status === "sending") retrySend(state); }
  selectionEpoch += 1; abortRequests(true); inboxLoading = false; selected = null; crm?.selectConversation(null); clearChat(); renderInbox(); schedulePolling();
  selectionLoading = false;
});
el("logout").addEventListener("click", () => { void logout(); });
document.addEventListener("visibilitychange", () => {
  if (!visible()) {
    stopPolling(); el("workspace").hidden = true; visibilityGeneration += 1; pollEpoch += 1; cycleRunning = false; eventRequests.clear(); abortRequests(); clearImages(); crm?.suspend();
    const state = currentState(); if (state?.pending?.status === "sending") retrySend(state);
    sendBusy = false; olderBusy = false; readBusy = false; inboxLoading = false; if (state) renderMeta(state);
  } else if (ready) {
    const ticket = snapshot(); notice("Vérification de la connexion…", false, "session-status");
    void refreshAndContinue().then(async (continued) => {
      if (!continued || !fresh(ticket, true) || !visible() || loggingOut) return;
      if (crm) await crm.resume();
      if (!fresh(ticket, true) || !visible() || loggingOut) return;
      void refreshBroadcastAccess(); const state = currentState(); if (state) renderMessages(state);
      el("workspace").hidden = false; notice("", false, "session-status"); retryDelay = 3000; schedulePolling(0);
    }).catch((error) => {
      if (error.stale || !fresh(ticket, true)) return;
      if (error.status === 401 || error.status === 403) { signOut(); return; }
      notice("La connexion n’a pas pu être vérifiée. Actualise la page pour réessayer.", true, "session-status");
    });
  } else if (!loggingOut) void start();
});
window.addEventListener("pagehide", clearPrivate);
window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
async function start({ session = null } = {}) {
  if (!role) { clearPrivate(); notice("Cette page n’est pas disponible.", true, "session-status"); return; }
  if (!visible() || loggingOut) return;
  if (bootstrapTask && fresh(bootstrapTask.ticket, true)) return bootstrapTask.promise;
  // Only an incomplete or replaced session bootstraps here. Healthy same-session
  // visibility changes use refreshAndContinue and preserve uncertain send IDs.
  clearPrivate();
  const task = { ticket: snapshot(), promise: null }; bootstrapTask = task;
  task.promise = (async () => {
    el("account-link").href = role === "admin" ? "/admin" : "/access"; el("account-link").textContent = role === "admin" ? "Gérer les accès" : "Mon accès";
    try {
      if (session) {
        const owner = sessionIdentity(session); if (!owner) { signOut(); return; }
        sessionOwner = owner; csrf = session.csrf; sessionCheckedAt = Date.now();
        expiryTimer = setTimeout(signOut, Math.max(0, Math.min(2147483647, session.expiresAt - Date.now())));
      } else await refreshSession();
      if (!fresh(task.ticket, true) || !visible() || loggingOut) throw staleResponse();
      const capability = await request(`${chatBase}/capabilities`, { account: true });
      if (capability.enabled !== true) throw Object.assign(new Error("chat_disabled"), { status: 404 });
      if (!fresh(task.ticket, true) || !visible() || loggingOut) throw staleResponse();
      if (role === "admin" && !document.getElementById("readiness-nav")) {
        const nav = document.createElement("nav"); nav.id = "readiness-nav"; nav.className = "account-nav"; nav.setAttribute("aria-label", "Administration");
        const link = document.createElement("a"); link.href = "/admin/readiness"; link.textContent = "Préparer le site"; nav.append(link); el("inbox-title").parentElement.append(nav);
      }
      await refreshMediaCapability();
      if (!fresh(task.ticket, true) || !visible() || loggingOut) throw staleResponse();
      await refreshCrmCapability();
      if (!fresh(task.ticket, true) || !visible() || loggingOut) throw staleResponse();
      el("workspace").classList.toggle("is-admin", role === "admin");
      el("inbox").hidden = role !== "admin"; el("client-aside").hidden = role !== "client"; el("back-to-inbox").hidden = role !== "admin";
      clearChat();
      if (role === "admin") await loadInbox();
      else {
        const conversation = await request(`${chatBase}/conversation`, { account: true });
        await selectConversation(conversation.id);
      }
      if (!fresh(task.ticket, true) || !visible() || loggingOut) throw staleResponse();
      ready = true; el("workspace").hidden = false; notice("", false, "session-status");
      void refreshBroadcastAccess(); scheduleRead(); schedulePolling();
    } catch (error) {
      if (error.stale || !fresh(task.ticket, true)) return;
      if (error.status === 401 || error.status === 403) { signOut(); return; }
      clearPrivate(); notice(error.status === 404 ? "La messagerie n’est pas encore activée. Consulte ton accès pour revenir plus tard." : "La messagerie est indisponible. Recharge la page pour réessayer.", true, "session-status");
    }
  })();
  try { return await task.promise; }
  finally { if (bootstrapTask === task) bootstrapTask = null; }
}
clearChat(); void start();
