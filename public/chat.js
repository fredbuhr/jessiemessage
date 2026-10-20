import { makeConversationState, belongsTo, orderedMessages, mergeMessages, mergeConversation, mergeEvents, sequence, compareSequence, maxSequence, validBody, validCaption, prepareSend, prepareImageSend, completeImageUpload, mediaStillCurrent, createObjectUrlCache, retrySend, rejectPendingSend, rejectPendingImageSend, nearBottom, shouldScroll, readableSequence, inboxRefreshPlan } from "/chat-model.js";
import { prepareImageUpload } from "/image-preparation.js";
import { quickReplyOptions, appendQuickReply } from "/quick-replies.js";

const ui = globalThis.JessieI18n ?? {
  register() {}, t(source, params = {}) { return source.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, key) => Object.hasOwn(params, key) ? String(params[key]) : whole); },
  text(node, source, params = {}) { node.textContent = this.t(source, params); },
  attr(node, name, source, params = {}) { node.setAttribute(name, this.t(source, params)); },
  rawText(node, value) { node.textContent = value; }, forget() {},
  dateParam(value, options = {}) { return new Date(value).toLocaleString("fr-FR", options); },
  numberParam(value, options = {}) { return value.toLocaleString("fr-FR", options); },
  getLanguage() { return "fr"; }, onChange() { return () => {}; }, apply() {},
};

const el = (id) => document.getElementById(id);
const role = location.pathname === "/admin/messages" ? "admin" : location.pathname === "/messages" ? "client" : null;
const sessionBase = role === "admin" ? "/api/auth" : "/api/access";
const chatBase = `/api/chat/${role}`;
const mediaBase = `/api/media/${role}`;
const states = new Map(); const inbox = new Map(); const controllers = new Set();
const messageRows = new Map();
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
let conversationDownload = null; let conversationDownloadCapability = null;
let quickReplyContext = null, quickReplyLanguage = null;
let reconnectTimer = null; let reconnectAttempt = 0; let resumeTask = null; let pendingConfirmation = null;
let notificationsPanel = null;
let pendingNotification = globalThis.JessieNotificationLink?.read() ?? null;
let notificationTask = null;
let newerBusy = false;
// The live region contains only a cumulative count for this visible selection.
// No message body, sender name, caption or persistent announcement log is kept.
let messageAnnouncement = null;

function notice(message, error = false, id = "chat-status") { const node = el(id); if (message) ui.text(node, message); else ui.rawText(node, ""); node.classList.toggle("is-error", error); }
function clearMessageAnnouncement() {
  messageAnnouncement = null;
  const node = el("message-announcement"); if (node) ui.rawText(node, "");
}
function armMessageAnnouncement(state) {
  if (!visible() || !belongsTo(currentState(), state.id, state.epoch) || !state.conversation) return;
  messageAnnouncement = { id: state.id, epoch: state.epoch, throughSequence: state.conversation.latestSequence, count: 0 };
}
function incomingAnnouncements(state, events, previousCursor) {
  const record = messageAnnouncement;
  if (!record || !ready || !visible() || selectionLoading || !belongsTo(currentState(), record.id, record.epoch)
    || !belongsTo(state, record.id, record.epoch)) return [];
  return events.filter((event) => event.kind === "message" && compareSequence(event.sequence, previousCursor) > 0
    && compareSequence(event.message.sequence, record.throughSequence) > 0 && !state.messages.has(event.message.sequence)
    && event.message.sender === "peer" && event.message.deletedAt == null).map((event) => ({ id: event.message.id, sequence: event.message.sequence }));
}
function announceIncoming(state, events, candidates) {
  const record = messageAnnouncement;
  if (!record || !ready || !visible() || selectionLoading || !belongsTo(currentState(), record.id, record.epoch)
    || !belongsTo(state, record.id, record.epoch)) return;
  // Advance only across events actually consumed. Conversation metadata may
  // already describe later pages that have not reached the browser yet.
  for (const event of events) if (event.kind === "message") record.throughSequence = maxSequence(record.throughSequence, event.message.sequence);
  const received = new Set(candidates.filter((candidate) => {
    const message = state.messages.get(candidate.sequence);
    return message?.id === candidate.id && message.sender === "peer" && message.deletedAt == null;
  }).map((candidate) => candidate.id)).size;
  if (!received) return;
  record.count += received;
  const node = el("message-announcement");
  if (node) ui.rawText(node, ui.t(record.count === 1 ? "Nouveau message reçu." : "{count} nouveaux messages reçus.",
    record.count === 1 ? {} : { count: ui.numberParam(record.count) }));
}
// A language change clears only the spoken text. Keeping the visible-session
// count avoids replaying a prior announcement through a reactive translation.
ui.onChange(() => { const node = el("message-announcement"); if (node) ui.rawText(node, ""); });
function focusVisible(node) {
  if (!visible() || !node?.isConnected || node.disabled || typeof node.focus !== "function") return false;
  for (let current = node; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute?.("aria-hidden") === "true" || current.getAttribute?.("inert") != null) return false;
    if (typeof globalThis.getComputedStyle === "function") {
      const style = globalThis.getComputedStyle(current); if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility)) return false;
    }
  }
  const modal = [...document.querySelectorAll?.("dialog") ?? []].filter((dialog) => dialog.open).at(-1);
  if (modal && !modal.contains(node)) return false;
  if (document.activeElement !== node) node.focus({ preventScroll: true });
  return document.activeElement === node;
}
function focusWasLost(node) { return document.activeElement === node || document.activeElement === document.body; }
function inboxButton(id) { return [...el("conversations").children].find((button) => button.dataset.conversationId === id) ?? null; }
function focusInbox(id) { if (!focusVisible(inboxButton(id))) focusVisible(el("inbox-title")); }
function focusMessage(sequence) {
  const article = messageRows.get(sequence)?.article;
  if (article?.classList.contains("deleted")) { article.setAttribute("tabindex", "-1"); if (focusVisible(article)) return; }
  focusVisible(el("message-scroll"));
}
function currentState() { return selected ? states.get(selected) : null; }
function visible() { return document.visibilityState === "visible"; }
function abortRequests(selectionOnly = false) { for (const controller of controllers) { if (selectionOnly && controller.accountScope) continue; controller.abort(); controllers.delete(controller); } }
function stopPolling() { clearTimeout(pollTimer); pollTimer = null; clearTimeout(readTimer); readTimer = null; }
function revokePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; previewIdentity = null; ui.forget(el("image-preview")); el("image-preview").replaceChildren(); }
function closeLightbox(restoreFocus = true) {
  lightboxVersion += 1;
  const returnItem = lightboxItem;
  if (lightboxItem) { imageUrls.remove(lightboxItem.media.fullUrl); imageRequests.get(lightboxItem.media.fullUrl)?.controller.abort(); imageRequests.delete(lightboxItem.media.fullUrl); }
  lightboxItem = null; ui.forget(el("lightbox-image")); el("lightbox-image").replaceChildren();
  if (el("lightbox").open) el("lightbox").close();
  if (restoreFocus) {
    const state = currentState();
    // A deletion can close the lightbox before rendering its tombstone. Its
    // still-connected old photo button must not receive transient focus.
    const openerAllowed = !returnItem?.messageId || ![...state?.messages.values() ?? []].some((message) => message.id === returnItem.messageId && message.deletedAt != null);
    if ((!openerAllowed || !focusVisible(lightboxReturnFocus)) && state) {
      const key = panel?.kind === "gallery" ? returnItem?.messageId : returnItem?.media.id;
      const card = openerAllowed && key ? [...el("media-grid").children].find((item) => item.dataset.mediaKey === key) : null;
      if (!focusVisible(card?.querySelector(".photo-open")) && !focusVisible(panel ? el("close-media") : el("open-gallery"))) focusVisible(el("message-scroll"));
    }
  }
  lightboxReturnFocus = null;
}
function closeMedia(restoreFocus = true) {
  panelVersion += 1; panel = null; panelBusy = false; ui.forget(el("media-grid")); el("media-grid").replaceChildren();
  if (el("media-dialog").open) el("media-dialog").close();
  if (restoreFocus && !focusVisible(dialogReturnFocus) && !focusVisible(el("open-gallery"))) focusVisible(el("message-scroll"));
  dialogReturnFocus = null;
}
function clearImages() {
  mediaVersion += 1;
  for (const record of imageRequests.values()) record.controller.abort(); imageRequests.clear();
  imageUrls.clear(); revokePreview(); closeLightbox(false); closeMedia(false);
  for (const image of el("messages").querySelectorAll("img")) image.removeAttribute("src");
}
function clearChat() {
  conversationDownload?.suspend();
  closeQuickReplies();
  clearMessageAnnouncement(); messageRows.clear();
  clearImages();
  ui.forget(el("messages")); el("messages").replaceChildren(); ui.text(el("peer-name"), "Messages privés");
  ui.text(el("conversation-status"), "Choisis une conversation.");
  el("message-body").value = ""; el("message-body").disabled = true; el("send").disabled = true;
  el("photo-tools").hidden = true; el("open-gallery").hidden = true; el("image-draft").hidden = true; el("image-file").value = "";
  for (const id of ["older-messages", "newer-messages", "new-messages", "empty-message", "pending-controls"]) if (el(id)) el(id).hidden = true;
  el("workspace").classList.remove("selected"); notice("");
}
function clearNotificationSettings() {
  notificationsPanel?.clear(); notificationsPanel = null;
  el("open-notifications").hidden = true;
  if (el("notifications-dialog").open) el("notifications-dialog").close();
}
async function mountConversationDownload(capability) {
  if (role !== "client" || capability?.enabled !== true || conversationDownload) return;
  const ticket = snapshot(), getContext = () => {
    const state = currentState();
    return ready && visible() && !loggingOut && !el("workspace").hidden && state?.conversation
      ? { id: state.id, key: `${generation}:${visibilityGeneration}:${selectionEpoch}:${state.epoch}`, state } : null;
  };
  try {
    const { createConversationDownload } = await import("/conversation-download.js");
    if (!fresh(ticket, true) || !getContext() || conversationDownload) return;
    conversationDownload = createConversationDownload({ parent: el("chat-footer"), capability, getContext, request, onError: error => handleError(error) });
    conversationDownload.update();
  } catch (error) { if (fresh(ticket, true) && getContext()) notice("Le téléchargement n’est pas disponible. Réessaie ; aucun fichier incomplet n’est proposé.", true); }
}
function mountNotificationSettings() {
  if (notificationsPanel || !ready || !sessionOwner || !visible() || !globalThis.JessieNotifications) return;
  const ticket = snapshot(), owner = { id: sessionOwner.id, csrf: sessionOwner.csrf };
  notificationsPanel = globalThis.JessieNotifications.mount(el("notifications-chat-host"), {
    role, owner, isCurrent: () => fresh(ticket, true) && ready && visible() && !loggingOut && sessionOwner?.id === owner.id && csrf === owner.csrf,
    onAvailability: (available) => { if (fresh(ticket, true) && ready && visible()) el("open-notifications").hidden = !available; },
  });
}
function clearPrivate() {
  quickReplyLanguage = null;
  clearNotificationSettings();
  cancelConfirmation(); stopReconnect(); resumeTask = null; retryConnection(false);
  generation += 1; selectionEpoch += 1; visibilityGeneration += 1; ready = false; csrf = null;
  sessionOwner = null; ownerCheck = null; bootstrapTask = null; pollEpoch += 1; cycleRunning = false;
  olderBusy = false; newerBusy = false; sendBusy = false; readBusy = false; selectionLoading = false; eventRequests.clear();
  mediaEnabled = false;
  conversationDownload?.clear(); conversationDownload = null; conversationDownloadCapability = null;
  crm?.clear(); crm = null; document.getElementById("crm-style")?.remove();
  document.getElementById("readiness-nav")?.remove();
  stopPolling(); abortRequests(); expiryTimer?.(); expiryTimer = null;
  states.clear(); inbox.clear(); selected = null; ui.forget(el("conversations")); el("conversations").replaceChildren(); clearChat();
  inboxCursor = null; inboxMore = false; inboxRefreshCursor = null; lastInboxRefresh = 0; inboxLoading = false;
  el("workspace").hidden = true; ui.rawText(el("session-status"), ""); ui.rawText(el("inbox-status"), "");
  el("more-conversations").hidden = true;
}
function cancelConfirmation() {
  if (!pendingConfirmation) return;
  const pending = pendingConfirmation; pendingConfirmation = null;
  if (el("confirm-delete").open) el("confirm-delete").close();
  pending.resolve(false); focusVisible(pending.opener);
}
function confirmDeletion(kind, opener) {
  cancelConfirmation();
  ui.text(el("confirm-title"), kind === "photo" ? "Supprimer cette photo ?" : "Supprimer ce message ?");
  ui.text(el("confirm-description"), kind === "photo" ? "Elle sera retirée de ta bibliothèque. Cette action est définitive." : "Il disparaîtra de cette conversation pour vous deux. Cette action est définitive.");
  return new Promise((resolve) => { pendingConfirmation = { resolve, opener }; el("confirm-delete").showModal(); focusVisible(el("cancel-delete")); });
}
function retryConnection(show = true) { el("retry-connection").hidden = !show; }
function stopReconnect() { clearTimeout(reconnectTimer); reconnectTimer = null; }
function scheduleReconnect() {
  stopReconnect();
  if (!visible() || loggingOut || reconnectAttempt >= 3) return;
  const delay = [2000, 5000, 15000][reconnectAttempt++];
  reconnectTimer = setTimeout(() => { reconnectTimer = null; void resumeConnection(); }, delay);
}
async function resumeConnection({ reset = false } = {}) {
  if (!visible() || loggingOut) return;
  if (reset) { reconnectAttempt = 0; stopReconnect(); }
  if (!ready) { await start(); return; }
  if (resumeTask) return resumeTask.promise;
  const ticket = snapshot(); notice("Retrouvons ta conversation…", false, "session-status");
  const task = { promise: null }; resumeTask = task;
  task.promise = (async () => {
    try {
      const continued = await refreshAndContinue();
      if (!continued || !fresh(ticket, true) || !visible() || loggingOut) return;
      if (crm) await crm.resume();
      if (!fresh(ticket, true) || !visible() || loggingOut) return;
      void refreshBroadcastAccess(); const state = currentState(); if (state) renderMessages(state);
      el("workspace").hidden = false; conversationDownload?.update(); void mountConversationDownload(conversationDownloadCapability); notice("", false, "session-status"); retryConnection(false); mountNotificationSettings();
      reconnectAttempt = 0; stopReconnect(); retryDelay = 3000; schedulePolling(0);
      await openNotification();
    } catch (error) {
      if (error.stale || !fresh(ticket, true)) return;
      if (error.status === 401) { signOut(); return; }
      notice("La connexion est momentanément indisponible. Tes brouillons restent dans cet onglet.", true, "session-status");
      retryConnection(); scheduleReconnect();
    }
  })();
  try { return await task.promise; } finally { if (resumeTask === task) resumeTask = null; }
}
function hasUnsavedWork() {
  return !loggingOut && [...states.values()].some((state) => state.draft?.length || state.pending || state.imageDraft);
}
function signOut() {
  clearPrivate();
  location.replace(pendingNotification ? globalThis.JessieNotificationLink.destination(role, pendingNotification, true) : role === "admin" ? "/admin/login" : "/access");
}
function snapshot(state = null) { return { generation, visibilityGeneration, selectionEpoch, id: state?.id, epoch: state?.epoch }; }
function fresh(ticket, account = false) { return ticket.generation === generation && ticket.visibilityGeneration === visibilityGeneration && (account || (ticket.selectionEpoch === selectionEpoch && (!ticket.id || belongsTo(currentState(), ticket.id, ticket.epoch)))); }
async function request(path, { body, rawBody, contentType, mutation = false, state = null, account = false, signal = null, verifyOwner = true, archive = false } = {}) {
  const owner = sessionOwner; const ticket = snapshot(state); const controller = new AbortController(); controllers.add(controller);
  controller.accountScope = account;
  const abort = () => controller.abort(); if (signal?.aborted) controller.abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), rawBody || archive ? 65000 : 15000);
  const headers = mutation ? { "Content-Type": contentType ?? "application/json", "X-CSRF-Token": csrf ?? "" } : {};
  try {
    if (mutation && verifyOwner && owner) await confirmOwner(ticket, owner, account);
    if (!fresh(ticket, account)) throw staleResponse();
    const response = await fetch(path, { method: mutation ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers, body: mutation ? rawBody ?? JSON.stringify(body ?? {}) : undefined, signal: controller.signal });
    let data;
    if (archive && response.ok) {
      try {
        const { readPrivateArchive } = await import(role === "client" ? "/client-archive.js" : "/private-archive.js");
        data = await readPrivateArchive(response, controller.signal);
      } catch (error) { controller.abort(); throw error; }
    } else { try { data = await response.json(); } catch { data = {}; } }
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
  expiryTimer?.();
  expiryTimer = globalThis.JessieSessionClock.scheduleSessionCheck(session.expiresAt, () => { void resumeConnection(); });
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
  if (role !== "admin") return;
  const ticket = snapshot();
  try {
    const capability = await request("/api/broadcast/admin/session", { account: true });
    if (!fresh(ticket, true) || capability.user?.role !== "admin" || document.getElementById("broadcast-nav")) return;
    const link = document.createElement("a"); link.id = "broadcast-nav"; link.href = "/admin/broadcasts"; ui.text(link, "Diffusions");
    document.getElementById("readiness-nav")?.append(link);
  } catch (error) { if (!error.stale && error.status === 401) signOut(); }
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
function replacePhotoContents(container, child) {
  for (const old of container.childNodes) ui.forget(old);
  container.replaceChildren(child);
}
function photoStatus(container, source) {
  const status = document.createElement("span"); ui.text(status, source); replacePhotoContents(container, status);
}
function loadPhoto(container, media, state, { full = false, current = () => true } = {}) {
  const path = full ? media.fullUrl : media.thumbnailUrl;
  delete container.dataset.loaded; delete container.dataset.failed;
  photoStatus(container, "Chargement de la photo…");
  void imageUrl(path, state).then((url) => {
    if (!container.isConnected || !current() || !visible()) return;
    const image = document.createElement("img"); image.alt = ""; ui.attr(image, "aria-label", full ? "Photo privée agrandie" : "Photo privée"); image.decoding = "async";
    image.width = full ? media.width : media.thumbnailWidth; image.height = full ? media.height : media.thumbnailHeight;
    image.addEventListener("load", () => { if (current()) { container.dataset.loaded = "true"; scheduleRead(); } });
    image.addEventListener("error", () => { if (current() && container.isConnected) { delete container.dataset.loaded; container.dataset.failed = "true"; photoStatus(container, "Photo indisponible"); imageUrls.remove(path); } });
    image.src = url; replacePhotoContents(container, image);
  }).catch((error) => { if (!error.stale && container.isConnected && current()) { container.dataset.failed = "true"; photoStatus(container, "Photo indisponible"); } });
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
  ui.attr(el("message-body"), "placeholder", hasImage ? "Ajoute une légende (facultatif)…" : "Écris ton message…");
  ui.text(el("composer-help"), hasImage ? "Photo privée · légende facultative de 1 000 caractères maximum" : "Message privé · 4 096 caractères maximum");
  el("cancel-image").disabled = Boolean(state.pending) || sendBusy;
  if (!hasImage) { revokePreview(); return; }
  ui.text(el("image-draft-status"), pending?.stage === "uploading" ? "Préparation de la photo…" : draft?.asset?.sharedHere ? "Déjà envoyée ici · nouvel envoi" : "Une photo à envoyer");
  if (!visible()) return;
  const identity = draft?.file ?? draft?.asset?.id ?? pending?.mediaId;
  if (identity && identity === previewIdentity) return;
  revokePreview(); previewIdentity = identity;
  if (draft?.file) {
    previewUrl = URL.createObjectURL(draft.file); const image = document.createElement("img"); image.alt = ""; ui.attr(image, "aria-label", "Aperçu de la photo choisie"); image.src = previewUrl; el("image-preview").append(image);
  } else if (draft?.asset) {
    const id = draft.asset.id; loadPhoto(el("image-preview"), draft.asset, state, { current: () => belongsTo(currentState(), state.id, state.epoch) && state.imageDraft?.asset?.id === id });
  } else ui.text(el("image-preview"), "Photo prête");
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
      conversationExport: capability.conversationExport?.enabled === true ? capability.conversationExport : null,
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
        const state = currentState(); if (state?.conversation) ui.rawText(el("peer-name"), crm?.displayName(inbox.get(state.id) ?? state.conversation) ?? state.conversation.peerName);
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
  if (error.code === "media_format") return "Ce format n’est pas pris en charge. Choisis une photo JPEG, PNG ou WebP.";
  if (error.code === "media_dimensions") return "Cette photo est trop grande. Choisis une version plus petite.";
  if (error.code === "request_too_large") return "Cette photo dépasse 10 Mo. Choisis une version plus légère.";
  if (error.code === "media_unavailable") return "La photo n’a pas pu être préparée. Essaie une autre photo.";
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
  ui.text(el("media-title"), kind === "library" ? "Mes photos" : "Photos de la conversation");
  ui.text(el("media-help"), kind === "library" ? "Tes photos personnelles peuvent être envoyées dans cette conversation. Une photo reçue ne fait pas partie de ta bibliothèque." : "Les photos partagées ici restent accessibles tant que le message et ton accès le permettent.");
  ui.text(el("media-status"), "Chargement…"); el("more-media").hidden = true; el("media-dialog").showModal();
  await loadMediaPage();
}
async function loadMediaPage(more = false) {
  const state = currentState(); const activePanel = panel; const version = panelVersion;
  if (!state || !activePanel || panelBusy || (more && !activePanel.hasMore)) return;
  const paginator = el("more-media"), restorePaginator = more && document.activeElement === paginator;
  const oldKeys = new Set(activePanel.items.map((item) => activePanel.kind === "library" ? item.id : item.messageId));
  panelBusy = true; paginator.disabled = true;
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
    notice(activePanel.items.length ? "" : activePanel.kind === "library" ? "Aucune photo dans ta bibliothèque pour le moment." : "Aucune photo partagée dans cette conversation.", false, "media-status");
    renderMediaPanel();
  } catch (error) { if (panel === activePanel && version === panelVersion) await handleMediaError(error, state, "media-status"); }
  finally { if (panel === activePanel && version === panelVersion) {
    panelBusy = false; paginator.disabled = false;
    if (restorePaginator && focusWasLost(paginator) && !focusVisible(paginator)) {
      const card = [...el("media-grid").children].find((item) => !oldKeys.has(item.dataset.mediaKey)) ?? [...el("media-grid").children].at(-1);
      if (!focusVisible(card?.querySelector(".photo-open"))) focusVisible(el("close-media"));
    }
  } }
}
function renderMediaPanel() {
  const state = currentState(); const activePanel = panel; if (!state || !activePanel || !belongsTo(state, activePanel.conversationId, activePanel.epoch)) return;
  const version = panelVersion; const grid = el("media-grid"), focused = document.activeElement;
  const focusedCard = [...grid.children].find((card) => card.contains(focused));
  const focusKey = focusedCard?.dataset.mediaKey, focusAction = focused?.dataset.mediaAction;
  const fragment = document.createDocumentFragment();
  for (const item of activePanel.items) {
    const media = activePanel.kind === "library" ? item : item.media;
    const card = document.createElement("article"); card.className = "media-card"; card.dataset.mediaKey = activePanel.kind === "library" ? item.id : item.messageId;
    const photo = document.createElement("button"); photo.type = "button"; photo.className = "photo-open"; ui.attr(photo, "aria-label", "Agrandir cette photo privée");
    photo.addEventListener("click", () => { void openLightbox({ media, messageId: activePanel.kind === "gallery" ? item.messageId : null }, state, photo); });
    card.append(photo);
    const caption = document.createElement("p"); ui.text(caption, "{width} × {height} · {date}", { width: ui.numberParam(media.width), height: ui.numberParam(media.height), date: dateParameter(activePanel.kind === "library" ? media.createdAt : item.createdAt, true) }); card.append(caption);
    if (activePanel.kind === "library") {
      if (media.sharedHere) { const warning = document.createElement("p"); warning.className = "shared-photo"; ui.text(warning, "Déjà envoyée ici. Renvoyer crée un nouveau message."); card.append(warning); }
      const actions = document.createElement("div"); actions.className = "media-actions";
      const choose = document.createElement("button"); choose.type = "button"; choose.className = "text-button"; choose.dataset.mediaAction = "choose"; ui.text(choose, media.sharedHere ? "Renvoyer" : "Choisir"); choose.disabled = !state.conversation?.canSend || Boolean(state.pending);
      choose.addEventListener("click", () => {
        if (!belongsTo(currentState(), state.id, state.epoch) || state.pending || !state.conversation?.canSend) return;
        if (el("message-body").value.length > 1000) { notice("Raccourcis ton texte à 1 000 caractères avant de choisir une photo.", true, "media-status"); return; }
        state.imageDraft = { file: null, asset: media }; closeMedia(); renderMeta(state); notice(media.sharedHere ? "Cette photo a déjà été envoyée ici. Envoyer ajoutera un nouveau message." : "Photo choisie. Ajoute une légende ou envoie-la."); el("message-body").focus();
      });
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button"; remove.dataset.mediaAction = "remove"; ui.text(remove, "Supprimer la photo");
      remove.addEventListener("click", () => { void removeOwnAsset(media, state, remove); }); actions.append(choose, remove); card.append(actions);
    }
    fragment.append(card);
    // Start only after this fragment is attached, so late reads never populate
    // a detached panel or an old conversation.
    queueMicrotask(() => { if (panel === activePanel && version === panelVersion && photo.isConnected) loadPhoto(photo, media, state, { current: () => panel === activePanel && version === panelVersion && activePanel.items.includes(item) }); });
  }
  ui.forget(el("media-grid")); el("media-grid").replaceChildren(fragment); el("more-media").hidden = !activePanel.hasMore;
  ui.text(el("more-media"), activePanel.kind === "library" ? "Autres photos" : "Photos précédentes");
  if (focusKey && focusWasLost(focused)) {
    const card = [...grid.children].find((item) => item.dataset.mediaKey === focusKey);
    const control = focusAction ? [...card?.querySelectorAll("button") ?? []].find((button) => button.dataset.mediaAction === focusAction) : card?.querySelector(".photo-open");
    if (!focusVisible(control)) focusVisible(el("close-media"));
  }
}
async function removeOwnAsset(media, state, button) {
  if (button.disabled || !await confirmDeletion("photo", button) || !belongsTo(currentState(), state.id, state.epoch) || !visible()) return;
  button.disabled = true; const activePanel = panel;
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
  ui.text(el("lightbox-status"), "Photo privée"); el("lightbox").showModal();
  loadPhoto(el("lightbox-image"), item.media, state, { full: true, current: () => lightboxItem === item && lightboxVersion === version
    && belongsTo(currentState(), state.id, state.epoch) && (!item.messageId || ![...state.messages.values()].some((message) => message.id === item.messageId && message.deletedAt != null)) });
}
function dateParameter(value, long = false) {
  return ui.dateParam(value, long ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
}
function renderInbox({ restoreFocus = true } = {}) {
  const container = el("conversations");
  const focused = [...container.children].find((button) => button.contains(document.activeElement));
  const focusedId = focused?.dataset.conversationId;
  ui.forget(container); container.replaceChildren();
  for (const conversation of [...inbox.values()].sort((a, b) => (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt) || a.id.localeCompare(b.id))) {
    const button = document.createElement("button"); button.type = "button"; button.className = "contact"; button.dataset.conversationId = conversation.id;
    button.classList.toggle("active", conversation.id === selected); button.setAttribute("aria-pressed", String(conversation.id === selected));
    const text = document.createElement("span"); const name = document.createElement("strong"); ui.rawText(name, crm?.displayName(conversation) ?? conversation.peerName);
    const time = document.createElement("time"); time.dateTime = new Date(conversation.lastActivityAt ?? conversation.createdAt).toISOString(); ui.text(time, "{date}", { date: dateParameter(conversation.lastActivityAt ?? conversation.createdAt, true) });
    text.append(name, time);
    if (crm && conversation.crm) {
      const details = document.createElement("span"); details.className = "crm-contact-meta";
      const labels = conversation.crm.labels.map((label) => label.name).join(" · "); ui.rawText(details, labels);
      const due = conversation.crm.reminderAt !== null && conversation.crm.reminderAt <= Date.now();
      if (due) { const reminder = document.createElement("span"); ui.text(reminder, labels ? " · Rappel à traiter" : "Rappel à traiter"); details.append(reminder); }
      if (labels || due) text.append(details);
    }
    button.append(text);
    if (conversation.unreadCount > 0) { const count = document.createElement("span"); count.className = "unread"; ui.text(count, "{count}", { count: ui.numberParam(conversation.unreadCount) }); ui.attr(count, "aria-label", conversation.unreadCount === 1 ? "{count} message non lu" : "{count} messages non lus", { count: ui.numberParam(conversation.unreadCount) }); button.append(count); }
    button.addEventListener("click", () => { void selectConversation(conversation.id, { focus: true }); }); container.append(button);
  }
  notice(inbox.size ? "" : "Aucune conversation pour le moment.", false, "inbox-status");
  el("more-conversations").hidden = !inboxMore; el("more-conversations").disabled = inboxLoading;
  if (restoreFocus && focusedId && focusWasLost(focused)) focusInbox(focusedId);
}
function restoreInboxPaginator(paginator, previousIds) {
  if (!focusWasLost(paginator) || focusVisible(paginator)) return;
  const added = [...el("conversations").children].find((button) => !previousIds.has(button.dataset.conversationId));
  if (!focusVisible(added ?? [...el("conversations").children].at(-1))) focusVisible(el("inbox-title"));
}
async function loadInbox(more = false, refresh = false) {
  const ticket = snapshot(); const paginator = el("more-conversations"), restorePaginator = more && document.activeElement === paginator;
  const previousIds = new Set(inbox.keys());
  if (crm) {
    try { await crm.loadInbox(more, refresh); lastInboxRefresh = Date.now(); }
    finally { if (restorePaginator && fresh(ticket)) restoreInboxPaginator(paginator, previousIds); }
    return;
  }
  if (inboxLoading) return;
  if (more && (!inboxMore || !inboxCursor)) return;
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
  } finally { if (fresh(ticket)) {
    inboxLoading = false; paginator.disabled = false;
    if (restorePaginator) restoreInboxPaginator(paginator, previousIds);
  } }
}
function renderMeta(state) {
  conversationDownload?.update();
  const conversation = state.conversation; if (!conversation) return;
  ui.rawText(el("peer-name"), crm?.displayName(inbox.get(state.id) ?? conversation) ?? conversation.peerName);
  ui.text(el("conversation-status"), conversation.closedAt != null ? "Conversation fermée · historique disponible" : !conversation.canSend ? "Accès à l’envoi suspendu · historique disponible" : "Conversation privée");
  el("message-body").disabled = !conversation.canSend || Boolean(state.pending) || sendBusy;
  const hasImage = Boolean(state.imageDraft || state.pending?.kind === "image");
  el("send").disabled = !conversation.canSend || Boolean(state.pending) || sendBusy || !(hasImage ? validCaption(el("message-body").value) : validBody(el("message-body").value));
  el("photo-tools").hidden = !mediaEnabled && role !== "admin"; el("open-gallery").hidden = !mediaEnabled;
  for (const id of ["pick-image", "open-library"]) el(id).hidden = !mediaEnabled;
  el("open-quick-replies").hidden = role !== "admin";
  el("open-quick-replies").disabled = !canUseQuickReplies();
  if (quickReplyContext && (!canUseQuickReplies() || !fresh(quickReplyContext.ticket))) closeQuickReplies();
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
// Only displayed content determines a row's identity. Read receipts change
// independently, and fresh API snapshots need not disturb an existing control.
function messageContentKey(message) {
  const media = message.media;
  return JSON.stringify([message.id, message.sequence, message.sender, message.body, message.createdAt, message.deletedAt,
    media ? [media.id, media.width, media.height, media.thumbnailWidth, media.thumbnailHeight, media.fullUrl, media.thumbnailUrl, mediaEnabled] : null]);
}
function createMessageRow(state, message, contentKey) {
  const own = message.sender === "me"; const fromJessie = role === "admin" ? own : !own;
  const article = document.createElement("article"); article.className = `message ${own ? "own" : ""} ${fromJessie ? "from-jessie" : "from-client"}`; article.dataset.sequence = message.sequence; article.dataset.sender = message.sender; article.setAttribute("role", "listitem");
  const body = document.createElement(message.media && message.deletedAt == null ? "div" : "p"); body.className = "bubble"; article.classList.toggle("deleted", message.deletedAt != null);
  const row = { article, contentKey, body, time: null, remove: null, photoButton: null, receipt: null, photo: null, mediaVersion: null };
  if (message.media && message.deletedAt == null) {
    body.classList.add("photo-message"); const photo = document.createElement("button"); photo.type = "button"; photo.className = "photo-open"; photo.style.aspectRatio = `${message.media.thumbnailWidth}/${message.media.thumbnailHeight}`; ui.attr(photo, "aria-label", "Agrandir la photo de ce message");
    row.photoButton = photo;
    if (mediaEnabled) {
      photo.addEventListener("click", () => { void openLightbox({ media: message.media, messageId: message.id }, state, photo); });
      row.photo = photo;
    } else { ui.text(photo, "Photos indisponibles pour le moment"); photo.disabled = true; }
    body.append(photo); if (message.body) { const caption = document.createElement("p"); caption.className = "photo-caption"; ui.rawText(caption, message.body); body.append(caption); }
  } else if (message.deletedAt != null) ui.text(body, "Message supprimé"); else ui.rawText(body, message.body);
  article.append(body);
  const meta = document.createElement("div"); meta.className = "message-meta";
  const time = document.createElement("time"); time.dateTime = new Date(message.createdAt).toISOString(); ui.text(time, "{date}", { date: dateParameter(message.createdAt, true) }); row.time = time; meta.append(time);
  if (own && message.deletedAt == null) {
    row.receipt = document.createElement("span"); meta.append(row.receipt);
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-message"; ui.text(remove, "Supprimer"); ui.attr(remove, "aria-label", "Supprimer mon message du {date}", { date: dateParameter(message.createdAt, true) });
    remove.addEventListener("click", () => { void deleteMessage(state, message, remove); }); row.remove = remove; meta.append(remove);
  }
  article.append(meta);
  return row;
}
function renderMessages(state, { initial = false, ownSend = false, prepend = false } = {}) {
  if (!belongsTo(currentState(), state.id, state.epoch)) return;
  const focused = document.activeElement;
  const focusedRow = [...messageRows.values()].find((row) => row.article.contains(focused));
  const scroll = el("message-scroll"); const atBottom = nearBottom(scroll); const anchor = viewportAnchor(); const oldTop = scroll.scrollTop;
  pruneDeletedPhotos(state);
  const messages = orderedMessages(state); const container = el("messages"); const photos = [];
  const retained = new Set(messages.map((message) => message.sequence));
  for (const [key, row] of messageRows) if (!retained.has(key)) { row.article.remove(); messageRows.delete(key); }
  for (const [index, message] of messages.entries()) {
    const contentKey = messageContentKey(message); let row = messageRows.get(message.sequence);
    if (!row || row.contentKey !== contentKey) {
      row?.article.remove();
      row = createMessageRow(state, message, contentKey); messageRows.set(message.sequence, row);
    }
    row.article.classList.toggle("notification-target", state.notificationSequence === message.sequence);
    ui.text(row.time, "{date}", { date: dateParameter(message.createdAt, true) });
    if (message.deletedAt != null) ui.text(row.body, "Message supprimé");
    if (row.remove) { ui.text(row.remove, "Supprimer"); ui.attr(row.remove, "aria-label", "Supprimer mon message du {date}", { date: dateParameter(message.createdAt, true) }); }
    if (row.photoButton) { ui.attr(row.photoButton, "aria-label", "Agrandir la photo de ce message"); if (!mediaEnabled) ui.text(row.photoButton, "Photos indisponibles pour le moment"); }
    if (row.receipt) {
      const receipt = role === "admin" && compareSequence(state.conversation.peerReadSequence, message.sequence) >= 0 ? "Lu" : "Envoyé";
      ui.text(row.receipt, receipt);
    }
    // Moving a live node also loses focus in some browsers. Insert only a new
    // or genuinely misplaced row; unchanged rows never leave their parent.
    if (container.children[index] !== row.article) container.insertBefore(row.article, container.children[index] ?? null);
    if (row.photo && (row.mediaVersion !== mediaVersion || row.photo.dataset.failed === "true")) photos.push({ row, message });
  }
  el("empty-message").hidden = messages.length !== 0;
  for (const { row, message } of photos) {
    const version = mediaVersion; const attempt = {}; row.mediaVersion = version; row.photoAttempt = attempt;
    const ticket = { id: state.id, epoch: state.epoch, messageId: message.id, mediaId: message.media.id };
    loadPhoto(row.photo, message.media, state, { current: () => messageRows.get(message.sequence) === row
      && version === mediaVersion && row.mediaVersion === version && row.photoAttempt === attempt && mediaStillCurrent(currentState(), ticket) });
  }
  if (shouldScroll({ initial, ownSend, wasNearBottom: atBottom, prepend })) { scroll.scrollTop = scroll.scrollHeight; el("new-messages").hidden = true; }
  else if (anchor) {
    const item = [...container.children].find((node) => node.dataset.sequence === anchor.sequence);
    if (item) scroll.scrollTop += item.getBoundingClientRect().top - scroll.getBoundingClientRect().top - anchor.offset;
    else scroll.scrollTop = oldTop;
  }
  renderMeta(state); scheduleRead();
  if (el("newer-messages")) { el("newer-messages").hidden = !state.hasMoreAfter; el("newer-messages").disabled = newerBusy; }
  if (state.hasMoreAfter) { el("new-messages").hidden = false; ui.text(el("new-messages"), "Messages récents ↓"); }
  else ui.text(el("new-messages"), "Nouveaux messages ↓");
  if (focusedRow && !focused.isConnected && focusWasLost(focused)) focusMessage(focusedRow.article.dataset.sequence);
}
function mergeMessagePage(state, result) {
  const pending = state.pending;
  mergeConversation(state, result.conversation); mergeMessages(state, result.messages);
  // A history page can confirm an uncertain send just like an event. Clear
  // its draft only when the exact clientMessageId has actually been found.
  if (pending && !state.pending) {
    state.draft = ""; el("message-body").value = "";
    notice(pending.kind === "image" ? "Photo enregistrée." : "Message enregistré.");
  }
}
async function selectConversation(id, { focus = false, target = null } = {}) {
  if (focus && !target && pendingNotification) { pendingNotification = null; history.replaceState(null, "", location.pathname); }
  if (id === selected && (!target || currentState()?.messages.get(target.sequence)?.id === target.messageId)) { if (focus) focusVisible(el("message-scroll")); return; }
  const previous = currentState(); if (previous) { previous.draft = el("message-body").value; if (previous.pending?.status === "sending") retrySend(previous); }
  selectionEpoch += 1; stopPolling(); abortRequests(true); inboxLoading = false; olderBusy = false; newerBusy = false; sendBusy = false; readBusy = false; selectionLoading = true;
  selected = id;
  crm?.selectConversation(id);
  const oldState = states.get(id);
  const state = oldState ? { ...oldState, epoch: selectionEpoch } : makeConversationState(id, selectionEpoch);
  if (target) { state.messages = new Map(); state.conversation = null; state.notificationSequence = target.sequence; }
  if (state.pending?.status === "sending") retrySend(state);
  states.set(id, state);
  clearChat(); el("workspace").classList.add("selected"); el("message-body").value = state.draft;
  ui.rawText(el("peer-name"), inbox.get(id)?.peerName ?? "Jessie"); ui.text(el("conversation-status"), "Chargement de la conversation…");
  renderInbox({ restoreFocus: !focus });
  if (focus) focusVisible(el("message-scroll"));
  let moreHistory = false;
  try {
    if (state.messages.size || state.conversation) { renderMessages(state, { initial: true }); moreHistory = await fetchEvents(state); }
    else {
      const anchor = target ? `&after=${(BigInt(target.sequence) - 1n).toString()}` : "";
      const result = await request(`${conversationPath(state)}/messages?limit=50${anchor}`, { state });
      mergeMessagePage(state, result);
      state.eventCursor = sequence(result.eventCursor); state.hasMoreBefore = result.hasMoreBefore; state.nextBefore = result.nextBefore;
      state.hasMoreAfter = result.hasMoreAfter === true; state.nextAfter = result.nextAfter ?? null;
      inbox.set(id, result.conversation);
      renderMessages(state, { initial: true });
    }
    if (!moreHistory) armMessageAnnouncement(state); schedulePolling(moreHistory ? 300 : retryDelay);
  } catch (error) { await handleError(error, state); }
  finally { if (belongsTo(currentState(), state.id, state.epoch)) { selectionLoading = false; schedulePolling(moreHistory ? 300 : retryDelay); } }
}
async function loadNewer({ latest = false } = {}) {
  const state = currentState(); if (!state || newerBusy || !latest && (!state.hasMoreAfter || !state.nextAfter)) return;
  const ticket = snapshot(state); newerBusy = true;
  try {
    const result = await request(`${conversationPath(state)}/messages?limit=50${latest ? "" : `&after=${state.nextAfter}`}`, { state });
    if (latest) { state.messages = new Map(); state.eventCursor = sequence(result.eventCursor); state.notificationSequence = null; }
    mergeMessagePage(state, result);
    if (latest) { state.hasMoreBefore = result.hasMoreBefore; state.nextBefore = result.nextBefore; }
    state.hasMoreAfter = result.hasMoreAfter === true; state.nextAfter = result.nextAfter ?? null;
    renderMessages(state, { initial: latest });
    return true;
  } catch (error) { await handleError(error, state); }
  finally { if (fresh(ticket)) { newerBusy = false; if (el("newer-messages")) el("newer-messages").disabled = false; } }
}
function focusNotification(target) {
  const state = currentState(), message = state?.messages.get(target.sequence);
  if (!state || message?.id !== target.messageId) return false;
  state.notificationSequence = target.sequence; renderMessages(state);
  const article = messageRows.get(target.sequence)?.article;
  if (!article || !visible()) return false;
  article.setAttribute("tabindex", "-1"); article.scrollIntoView?.({ block: "center" }); focusVisible(article);
  if (message.deletedAt != null) notice("Ce message a été supprimé.");
  return true;
}
async function openNotification() {
  if (!ready || !visible() || !pendingNotification || notificationTask) return;
  const reference = pendingNotification, ticket = snapshot(), task = {}; notificationTask = task;
  try {
    const target = await request(`/api/notifications/${role}/open`, { account: true, mutation: true, body: { notification: reference } });
    if (!fresh(ticket, true) || pendingNotification !== reference || !visible()) return;
    if (!target || !/^[a-f0-9]{32}$/.test(target.conversationId) || !/^[a-f0-9]{32}$/.test(target.messageId) || sequence(target.sequence) === "0") throw new Error("invalid_notification_target");
    await selectConversation(target.conversationId, { focus: true, target });
    if (!fresh(ticket, true) || pendingNotification !== reference || !visible()) return;
    if (!focusNotification(target)) throw new Error("notification_target_missing");
    pendingNotification = null; history.replaceState(null, "", location.pathname);
  } catch (error) {
    if (error.stale || !fresh(ticket, true) || pendingNotification !== reference) return;
    if (error.status === 401 || error.status === 403) { signOut(); return; }
    if (error.status === 404) { pendingNotification = null; history.replaceState(null, "", location.pathname); notice("Cette notification n’est plus disponible. Retrouve les échanges dans ta conversation."); }
    else { notice("Le message n’a pas pu être ouvert. Réessaie dès que la connexion revient.", true); retryConnection(); }
  } finally {
    if (notificationTask === task) notificationTask = null;
    if (pendingNotification && pendingNotification !== reference && ready && visible()) void openNotification();
  }
}
async function loadOlder() {
  const state = currentState(); if (!state || olderBusy || !state.hasMoreBefore || !state.nextBefore) return;
  const ticket = snapshot(state); const paginator = el("older-messages"), restorePaginator = document.activeElement === paginator;
  olderBusy = true; renderMeta(state);
  try {
    const result = await request(`${conversationPath(state)}/messages?before=${state.nextBefore}&limit=50`, { state });
    mergeMessagePage(state, result);
    state.hasMoreBefore = result.hasMoreBefore; state.nextBefore = result.nextBefore; renderMessages(state, { prepend: true });
  } catch (error) { await handleError(error, state); }
  finally { if (fresh(ticket)) {
    olderBusy = false; renderMeta(state);
    if (restorePaginator && focusWasLost(paginator) && !focusVisible(paginator)) focusVisible(el("message-scroll"));
  } }
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
    const previousCursor = state.eventCursor;
    const acceptedEvents = result.events.filter((event) => compareSequence(event.sequence, previousCursor) > 0);
    const candidates = incomingAnnouncements(state, acceptedEvents, previousCursor);
    const windowEvents = state.hasMoreAfter ? result.events.filter((event) => state.messages.has(event.message.sequence)) : result.events;
    mergeConversation(state, result.conversation); mergeEvents(state, windowEvents, result.nextCursor);
    pruneDeletedPhotos(state, result.events.filter((event) => event.kind === "delete").map((event) => event.message));
    if (pending && !state.pending) { state.draft = ""; el("message-body").value = ""; notice("Message enregistré."); }
    renderMessages(state); announceIncoming(state, acceptedEvents, candidates);
    if (!atBottom && compareSequence(state.conversation.latestSequence, before) > 0) el("new-messages").hidden = false;
    more = result.hasMore; if (!more) break;
  }
  // The first catch-up after hiding or re-entering a selection is history,
  // not a fresh live announcement. It establishes the next visible baseline.
  if (!messageAnnouncement && !selectionLoading && !more) armMessageAnnouncement(state);
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
  const state = currentState(); if (!state || sendBusy || !state.conversation?.canSend || (retry && !state.pending) || (!retry && state.pending)) return;
  if (state.hasMoreAfter && (!await loadNewer({ latest: true }) || state !== currentState() || (retry && !state.pending))) return;
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
  state.draft = caption; sendBusy = true; let preparing = false; renderMeta(state); notice(pending.mediaId ? "Envoi de la photo…" : "Préparation de la photo…");
  try {
    if (!pending.mediaId) {
      const preparation = new AbortController(); controllers.add(preparation); let prepared;
      preparing = true;
      try { prepared = await prepareImageUpload(pending.file, { signal: preparation.signal }); }
      finally { controllers.delete(preparation); }
      preparing = false;
      if (!fresh(ticket) || !visible() || state.pending !== pending) return;
      pending.file = prepared;
      const result = await request(`${mediaBase}/assets`, { state, mutation: true, rawBody: prepared, contentType: prepared.type });
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
    if (preparing && fresh(ticket) && state.pending === pending) {
      // Local preparation failed before any upload/message request. The photo
      // can be changed safely; uncertain network sends keep their retry key.
      state.pending = null;
    } else if (!error.stale && state.pending && !rejectPendingImageSend(state, error.status)) retrySend(state);
    await handleMediaError(error, state);
  } finally { if (fresh(ticket)) { sendBusy = false; renderMeta(state); } }
}
async function deleteMessage(state, message, button) {
  if (!belongsTo(currentState(), state.id, state.epoch) || button.disabled) return;
  if (!await confirmDeletion("message", button) || !belongsTo(currentState(), state.id, state.epoch) || !visible()) return;
  const restoreFocus = document.activeElement === button;
  button.disabled = true;
  try {
    const result = await request(`${conversationPath(state)}/messages/${message.id}/delete`, { state, mutation: true });
    mergeMessages(state, [result.message]); renderMessages(state); notice("Ton message est supprimé.");
    if (restoreFocus && focusWasLost(button)) focusMessage(message.sequence);
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
async function sendWithFocus(retry, button) {
  const state = currentState(), ticket = snapshot(state), restoreFocus = document.activeElement === button;
  try { await sendMessage(retry); }
  finally {
    if (restoreFocus && state && fresh(ticket) && state === currentState() && !state.pending && state.draft === ""
      && el("message-body").value === "" && focusWasLost(button)) focusVisible(el("message-body"));
  }
}
function canUseQuickReplies() {
  const state = currentState();
  return role === "admin" && ready && visible() && !loggingOut && !logoutBusy && !selectionLoading && !sendBusy
    && Boolean(sessionOwner && state?.conversation?.canSend && !state.pending);
}
function closeQuickReplies(restoreFocus = false) {
  quickReplyContext = null;
  if (el("quick-replies-dialog").open) el("quick-replies-dialog").close();
  ui.forget(el("quick-replies-list")); el("quick-replies-list").replaceChildren();
  notice("", false, "quick-replies-status");
  if (restoreFocus) focusVisible(el("message-body"));
}
function renderQuickReplies() {
  ui.forget(el("quick-replies-list")); el("quick-replies-list").replaceChildren();
  for (const reply of quickReplyOptions(quickReplyLanguage)) {
    const button = document.createElement("button"); button.type = "button"; button.className = "quick-reply";
    button.dataset.quickReply = reply.id; button.lang = quickReplyLanguage; ui.rawText(button, reply.text);
    button.addEventListener("click", () => {
      const context = quickReplyContext, state = currentState();
      if (!context || !canUseQuickReplies() || !fresh(context.ticket) || context.owner !== sessionOwner.id || context.csrf !== csrf) { closeQuickReplies(); return; }
      try {
        const value = appendQuickReply(el("message-body").value, reply.id, quickReplyLanguage, Boolean(state.imageDraft));
        el("message-body").value = value; state.draft = value; closeQuickReplies(true); renderMeta(state);
        el("message-body").setSelectionRange?.(value.length, value.length);
        notice("Réponse ajoutée au brouillon. Relis le message avant de l’envoyer.");
      } catch {
        notice("Cette réponse ne peut pas être ajoutée. Raccourcis ou corrige le brouillon puis réessaie.", true, "quick-replies-status");
      }
    });
    el("quick-replies-list").append(button);
  }
}
el("open-quick-replies").addEventListener("click", () => {
  if (!canUseQuickReplies()) return;
  quickReplyContext = { ticket: snapshot(currentState()), owner: sessionOwner.id, csrf };
  quickReplyLanguage ??= ui.getLanguage() === "en" ? "en" : "fr";
  el("quick-reply-language").value = quickReplyLanguage; renderQuickReplies();
  el("quick-replies-dialog").showModal(); focusVisible(el("quick-reply-language"));
});
el("quick-reply-language").addEventListener("change", () => {
  if (!quickReplyContext || !["fr", "en"].includes(el("quick-reply-language").value)) return;
  quickReplyLanguage = el("quick-reply-language").value; renderQuickReplies(); notice("", false, "quick-replies-status");
});
el("close-quick-replies").addEventListener("click", () => closeQuickReplies(true));
el("quick-replies-dialog").addEventListener("close", () => { if (quickReplyContext && !el("quick-replies-dialog").open) closeQuickReplies(true); });
el("composer").addEventListener("submit", (event) => { event.preventDefault(); void sendWithFocus(false, el("send")); });
el("message-body").addEventListener("input", () => { const state = currentState(); if (state) { state.draft = el("message-body").value; renderMeta(state); } });
el("retry-send").addEventListener("click", () => { void sendWithFocus(true, el("retry-send")); });
el("pick-image").addEventListener("click", () => { if (!el("pick-image").disabled) el("image-file").click(); });
el("image-file").addEventListener("change", chooseFile);
el("cancel-image").addEventListener("click", () => {
  const state = currentState(), restoreFocus = document.activeElement === el("cancel-image");
  if (state && !state.pending && !sendBusy) {
    state.imageDraft = null; renderMeta(state); notice("Photo retirée de cet envoi.");
    if (restoreFocus && !focusVisible(el("message-body"))) focusVisible(el("message-scroll"));
  }
});
el("open-library").addEventListener("click", (event) => { void openMedia("library", event.currentTarget); });
el("open-gallery").addEventListener("click", (event) => { void openMedia("gallery", event.currentTarget); });
el("close-media").addEventListener("click", () => closeMedia());
el("close-lightbox").addEventListener("click", () => closeLightbox());
el("media-dialog").addEventListener("close", () => { if (panel) closeMedia(); });
el("lightbox").addEventListener("close", () => { if (lightboxItem) closeLightbox(); });
el("more-media").addEventListener("click", () => { void loadMediaPage(true); });
el("older-messages").addEventListener("click", () => { void loadOlder(); });
el("newer-messages")?.addEventListener("click", () => { void loadNewer(); });
el("more-conversations").addEventListener("click", () => { void loadInbox(true).catch((error) => handleError(error)); });
el("new-messages").addEventListener("click", () => {
  if (currentState()?.hasMoreAfter) { void loadNewer({ latest: true }); return; }
  const restoreFocus = document.activeElement === el("new-messages");
  el("message-scroll").scrollTop = el("message-scroll").scrollHeight; el("new-messages").hidden = true;
  if (restoreFocus) focusVisible(el("message-scroll")); scheduleRead();
});
el("message-scroll").addEventListener("scroll", () => { if (nearBottom(el("message-scroll")) && !currentState()?.hasMoreAfter) el("new-messages").hidden = true; scheduleRead(); }, { passive: true });
el("back-to-inbox").addEventListener("click", () => {
  const state = currentState(); const returnId = state?.id;
  if (state) { state.draft = el("message-body").value; if (state.pending?.status === "sending") retrySend(state); }
  selectionEpoch += 1; abortRequests(true); inboxLoading = false; selected = null; crm?.selectConversation(null); clearChat(); renderInbox(); schedulePolling();
  selectionLoading = false; focusInbox(returnId);
});
el("logout").addEventListener("click", () => { void logout(); });
el("open-notifications").addEventListener("click", () => { if (!ready || !visible() || !notificationsPanel) return; el("notifications-dialog").showModal(); focusVisible(el("close-notifications")); });
el("close-notifications").addEventListener("click", () => el("notifications-dialog").close());
el("notifications-dialog").addEventListener("close", () => { focusVisible(el("open-notifications")); });
el("retry-connection").addEventListener("click", () => { void resumeConnection({ reset: true }); });
el("cancel-delete").addEventListener("click", cancelConfirmation);
el("confirm-delete").addEventListener("close", () => {
  // Native close events are queued. A previous close must not cancel a new
  // confirmation that has already reopened this same dialog.
  if (!el("confirm-delete").open) cancelConfirmation();
});
el("accept-delete").addEventListener("click", () => {
  const pending = pendingConfirmation; if (!pending) return;
  pendingConfirmation = null; el("confirm-delete").close(); focusVisible(pending.opener); pending.resolve(true);
});
window.addEventListener("beforeunload", (event) => { if (hasUnsavedWork()) { event.preventDefault(); event.returnValue = ""; } });
window.addEventListener("online", () => { void resumeConnection({ reset: true }); });
window.addEventListener("hashchange", () => {
  const reference = globalThis.JessieNotificationLink?.read();
  if (!reference) return;
  pendingNotification = reference;
  if (ready && visible()) void openNotification();
});
globalThis.navigator?.serviceWorker?.addEventListener("message", (event) => {
  const data = event.data, link = globalThis.JessieNotificationLink;
  if (event.source !== navigator.serviceWorker.controller || event.origin !== location.origin
    || data?.type !== "jessie-open-notification" || data.role !== role || !link?.valid(data.notification)) return;
  pendingNotification = data.notification;
  history.replaceState(null, "", link.destination(role, pendingNotification));
  event.ports?.[0]?.postMessage({ accepted: true });
  if (ready && visible()) void openNotification();
});
document.addEventListener("visibilitychange", () => {
  if (!visible()) {
    closeQuickReplies();
    clearNotificationSettings();
    cancelConfirmation(); stopReconnect(); resumeTask = null; clearMessageAnnouncement(); stopPolling(); el("workspace").hidden = true; visibilityGeneration += 1; pollEpoch += 1; cycleRunning = false; eventRequests.clear(); abortRequests(); clearImages(); crm?.suspend(); conversationDownload?.suspend();
    const state = currentState(); if (state?.pending?.status === "sending") retrySend(state);
    sendBusy = false; olderBusy = false; newerBusy = false; readBusy = false; inboxLoading = false; if (state) renderMeta(state);
  } else if (!loggingOut) void resumeConnection({ reset: true });
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
    el("account-link").href = role === "admin" ? "/admin" : "/access"; ui.text(el("account-link"), role === "admin" ? "Gérer les accès" : "Mon accès");
    try {
      if (session) {
        const owner = sessionIdentity(session); if (!owner) { signOut(); return; }
        sessionOwner = owner; csrf = session.csrf; sessionCheckedAt = Date.now();
        expiryTimer = globalThis.JessieSessionClock.scheduleSessionCheck(session.expiresAt, () => { void resumeConnection(); });
      } else await refreshSession();
      if (!fresh(task.ticket, true) || !visible() || loggingOut) throw staleResponse();
      const capability = await request(`${chatBase}/capabilities`, { account: true });
      if (capability.enabled !== true) throw Object.assign(new Error("chat_disabled"), { status: 404 });
      if (!fresh(task.ticket, true) || !visible() || loggingOut) throw staleResponse();
      if (role === "admin" && !document.getElementById("readiness-nav")) {
        const nav = document.createElement("nav"); nav.id = "readiness-nav"; nav.className = "account-nav"; ui.attr(nav, "aria-label", "Administration");
        const link = document.createElement("a"); link.href = "/admin/readiness"; ui.text(link, "État du service"); nav.append(link); el("inbox-title").parentElement.append(nav);
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
      ready = true; reconnectAttempt = 0; stopReconnect(); retryConnection(false); el("workspace").hidden = false; notice("", false, "session-status");
      conversationDownloadCapability = capability.conversationExport;
      await mountConversationDownload(conversationDownloadCapability);
      if (!fresh(task.ticket, true) || !visible() || loggingOut) throw staleResponse();
      mountNotificationSettings(); void refreshBroadcastAccess(); scheduleRead(); schedulePolling();
      await openNotification();
    } catch (error) {
      if (error.stale || !fresh(task.ticket, true)) return;
      if (error.status === 401 || error.status === 403) { signOut(); return; }
      clearPrivate(); notice(error.status === 404 ? "La messagerie n’est pas encore activée. Consulte ton accès pour revenir plus tard." : "La connexion est momentanément indisponible. Réessaie dans un instant.", true, "session-status");
      retryConnection(); if (error.status !== 404) scheduleReconnect();
    }
  })();
  try { return await task.promise; }
  finally { if (bootstrapTask === task) bootstrapTask = null; }
}
clearChat(); void start();
