import { makeConversationState, belongsTo, orderedMessages, mergeMessages, mergeConversation, mergeEvents, sequence, compareSequence, maxSequence, validBody, validCaption, prepareSend, prepareImageSend, completeImageUpload, prepareVideoSend, completeVideoUpload, rejectPendingVideoSend, mediaStillCurrent, createObjectUrlCache, retrySend, rejectPendingSend, rejectPendingImageSend, nearBottom, shouldScroll, readableSequence, inboxRefreshPlan } from "/chat-model.js";
import { prepareImageUpload } from "/image-preparation.js";
import { createPhotoBatch, removePhoto, runPhotoBatch, MAX_PHOTO_BATCH } from "/photo-batch.js";
import { quickReplyOptions } from "/quick-replies.js";
import { emojiCategories, emojiOptions, emojiSkinTones, insertEmoji } from "/emoji-catalog.js";
import { createChatDrafts } from "/chat-drafts.js";

const ui = globalThis.JessieI18n ?? {
  register() {}, t(source, params = {}) { return source.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (whole, key) => Object.hasOwn(params, key) ? String(params[key]) : whole); },
  text(node, source, params = {}) { node.textContent = this.t(source, params); },
  attr(node, name, source, params = {}) { node.setAttribute(name, this.t(source, params)); },
  rawText(node, value) { node.textContent = value; }, forget() {},
  dateParam(value, options = {}) { return new Date(value).toLocaleString("fr-FR", options); },
  numberParam(value, options = {}) { return value.toLocaleString("fr-FR", options); },
  getLanguage() { return "fr"; }, onChange() { return () => {}; }, apply() {},
};
ui.register({
  "Ton brouillon texte a été retrouvé.": "Your text draft has been restored.",
  "Ton brouillon texte a été retrouvé. Ajoute à nouveau les pièces jointes.": "Your text draft has been restored. Add the attachments again.",
  "Un envoi reste à confirmer. Réessaie cet envoi pour reprendre la même demande.": "A send still needs confirmation. Retry this send to resume the same request.",
  "Ce navigateur ne peut pas garder ce brouillon après rechargement. Il reste dans cet onglet.": "This browser cannot keep this draft after reloading. It remains in this tab.",
  "Cet envoi n’a pas commencé. Réessaie sans recharger la page pour conserver ton brouillon.": "This send has not started. Retry without reloading the page to keep your draft.",
});

const el = (id) => document.getElementById(id);
const role = location.pathname === "/admin/messages" ? "admin" : location.pathname === "/messages" ? "client" : null;
const sessionBase = role === "admin" ? "/api/auth" : "/api/access";
const chatBase = `/api/chat/${role}`;
const mediaBase = `/api/media/${role}`;
const videoBase = "/api/video/" + role;
const states = new Map(); const inbox = new Map(); const controllers = new Set();
const drafts = createChatDrafts({ storage: () => globalThis.sessionStorage, clock: () => Date.now(), digest: bytes => crypto.subtle.digest("SHA-256", bytes) });
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
let videoEnabled = false, videoCreationEnabled = false, videoVersion = 0, videoPreviewUrl = null, videoPreviewIdentity = null, videoTransfer = null;
let videoGallery = null, videoGalleryBusy = false, videoGalleryVersion = 0, videoGalleryReturnFocus = null;
const videoPlayers = new Map();
let panel = null; let panelVersion = 0; let panelBusy = false; let lightboxVersion = 0; let lightboxItem = null;
let dialogReturnFocus = null; let lightboxReturnFocus = null;
let lightboxBusy = false, lightboxScrollTop = null, lightboxTouch = null;
let crm = null;
let profileUI = null; let profileMount = null; let profileCapability = null;
let announcementUI = null; let announcementMount = null; let announcementCapability = null; let announcementHost = null;
let tasksCapability = false, repliesCapability = false, followupUI = null, followupHost = null, followupMount = null;
const avatarContainers = new Map(); const avatarVersions = new Map(); const avatarPaths = new Map();
let emojiContext = null;
let emojiCategory = "all";
let emojiSkinTone = "default";
let conversationDownload = null; let conversationDownloadCapability = null;
let quickReplyContext = null, quickReplyLanguage = null;
let personalReplies = null, personalReplyDraft = null, personalReplyBusy = null, personalReplyConflict = false, personalReplyUncertain = false, personalReplyDelete = null, personalReplyAbort = null;
let reconnectTimer = null; let reconnectAttempt = 0; let resumeTask = null; let pendingConfirmation = null;
let notificationsPanel = null;
let pendingNotification = globalThis.JessieNotificationLink?.read() ?? null;
let notificationTask = null;
let newerBusy = false;
let menuOpener = null;
let selectedMessageSequence = null;
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
function touchKeyboard() { return globalThis.matchMedia?.("(any-pointer: coarse)").matches === true; }
function dismissComposerKeyboard() {
  if (touchKeyboard() && document.activeElement === el("message-body")) el("message-body").blur();
}
function focusComposer(fallback = "open-composer-tools") {
  return focusVisible(el(touchKeyboard() ? fallback : "message-body"));
}
function menuReturnFocus() {
  if (menuOpener?.isConnected && menuOpener.getClientRects?.().length) return menuOpener;
  return el(el("workspace").classList.contains("selected") ? "open-conversation-menu" : "open-account-menu");
}
function closeChatMenu(restoreFocus = false) {
  const wasOpen = !el("chat-menu").hidden;
  el("chat-menu").hidden = true;
  for (const details of el("chat-menu").querySelectorAll("details")) details.open = false;
  for (const id of ["open-account-menu", "open-conversation-menu"]) el(id).setAttribute("aria-expanded", "false");
  if (wasOpen && restoreFocus) focusVisible(menuReturnFocus());
}
function closeComposerTools(restoreFocus = false) {
  const wasOpen = !el("composer-tools").hidden;
  el("composer-tools").hidden = true; el("open-composer-tools").setAttribute("aria-expanded", "false");
  if (wasOpen && restoreFocus) focusVisible(el("open-composer-tools"));
}
function positionComposerTools() {
  const panel = el("composer-tools"), button = el("open-composer-tools");
  if (panel.hidden || typeof button.getBoundingClientRect !== "function") return;
  const rect = button.getBoundingClientRect(), viewport = globalThis.visualViewport;
  const visibleTop = viewport?.offsetTop ?? 0, visibleHeight = viewport?.height ?? window.innerHeight;
  const visibleLeft = viewport?.offsetLeft ?? 0, visibleWidth = viewport?.width ?? window.innerWidth;
  const width = Math.min(330, Math.max(0, visibleWidth - 24)), roomAbove = rect.top - visibleTop - 16;
  panel.style.width = `${width}px`;
  panel.style.left = `${Math.max(visibleLeft + 12, Math.min(rect.left, visibleLeft + visibleWidth - width - 12))}px`;
  if (roomAbove >= 96 && rect.top <= visibleTop + visibleHeight - 8) {
    panel.style.top = "auto"; panel.style.bottom = `${window.innerHeight - rect.top + 8}px`;
    panel.style.maxHeight = `${Math.min(340, roomAbove)}px`;
  } else {
    // With little room above the composer, use the visible viewport instead
    // of clipping the panel or hiding the photo draft to make room.
    panel.style.top = `${visibleTop + 8}px`; panel.style.bottom = "auto";
    panel.style.maxHeight = `${Math.max(0, visibleHeight - 16)}px`;
  }
}
function openChatMenu(opener) {
  if (!visible()) return;
  if (!el("chat-menu").hidden) { closeChatMenu(true); return; }
  dismissComposerKeyboard(); closeComposerTools(); menuOpener = opener;
  el("chat-menu").hidden = false; opener.setAttribute("aria-expanded", "true");
  focusVisible(el("close-chat-menu"));
}
function resizeComposer() {
  const textarea = el("message-body");
  textarea.style.height = "44px";
  // A wrapping placeholder must not enlarge an empty draft on narrow screens.
  textarea.style.overflowY = textarea.value ? "auto" : "hidden";
  if (textarea.value) textarea.style.height = `${Math.min(112, Math.max(44, textarea.scrollHeight))}px`;
  positionComposerTools();
}
function inboxButton(id) { return [...el("conversations").children].find((button) => button.dataset.conversationId === id) ?? null; }
function focusInbox(id) { if (!focusVisible(inboxButton(id))) focusVisible(el("inbox-title")); }
function focusMessage(sequence) {
  const article = messageRows.get(sequence)?.article;
  if (article?.classList.contains("deleted")) { article.setAttribute("tabindex", "-1"); if (focusVisible(article)) return; }
  focusVisible(el("message-scroll"));
}
function showMessageDetails(row, expanded) {
  row.article.classList.toggle("is-selected", expanded);
  row.meta.hidden = !expanded;
  row.detailsToggle.setAttribute("aria-expanded", String(expanded));
}
function clearMessageSelection(restoreFocus = false) {
  const row = messageRows.get(selectedMessageSequence);
  selectedMessageSequence = null;
  if (!row) return;
  showMessageDetails(row, false);
  if (restoreFocus) focusVisible(row.detailsToggle);
}
function toggleMessageDetails(state, message, row) {
  if (!visible() || !ready || loggingOut || !belongsTo(currentState(), state.id, state.epoch)
    || messageRows.get(message.sequence) !== row || !row.article.isConnected) return;
  const opening = selectedMessageSequence !== message.sequence;
  const detailsHadFocus = messageRows.get(selectedMessageSequence)?.meta.contains(document.activeElement);
  clearMessageSelection();
  if (opening) { selectedMessageSequence = message.sequence; showMessageDetails(row, true); }
  if (detailsHadFocus) focusVisible(row.detailsToggle);
}
function hasSelectedMessageText(article) {
  const selection = globalThis.getSelection?.();
  return Boolean(selection && !selection.isCollapsed && (article.contains(selection.anchorNode) || article.contains(selection.focusNode)));
}
function currentState() { return selected ? states.get(selected) : null; }
function visible() { return document.visibilityState === "visible"; }
function abortRequests(selectionOnly = false) { for (const controller of controllers) { if (selectionOnly && controller.accountScope) continue; controller.abort(); controllers.delete(controller); } }
function stopPolling() { clearTimeout(pollTimer); pollTimer = null; clearTimeout(readTimer); readTimer = null; }
function revokePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; previewIdentity = null; ui.forget(el("image-preview")); el("image-preview").replaceChildren(); }
function closeLightbox(restoreFocus = true) {
  lightboxVersion += 1;
  const returnItem = lightboxItem, restoreScroll = lightboxScrollTop; lightboxScrollTop = null; lightboxBusy = false;
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
      if (!focusVisible(card?.querySelector(".photo-open")) && !focusVisible(panel ? el("close-media") : menuReturnFocus())) focusVisible(el("message-scroll"));
    }
  }
  lightboxReturnFocus = null;
  if (restoreFocus && restoreScroll && belongsTo(currentState(), restoreScroll.id, restoreScroll.epoch)) el("message-scroll").scrollTop = restoreScroll.top;
}
function closeMedia(restoreFocus = true) {
  panelVersion += 1; panel = null; panelBusy = false; ui.forget(el("media-grid")); el("media-grid").replaceChildren();
  if (el("media-dialog").open) el("media-dialog").close();
  if (restoreFocus && !focusVisible(dialogReturnFocus) && !focusVisible(menuReturnFocus())) focusVisible(el("message-scroll"));
  dialogReturnFocus = null;
}
function clearImages() {
  for (const value of states.values()) revokeBatchPreviews(value.photoBatch);
  videoVersion += 1; clearVideoPlayers(); revokeVideoPreview(); closeVideoGallery(false);
  mediaVersion += 1;
  for (const record of imageRequests.values()) record.controller.abort(); imageRequests.clear();
  imageUrls.clear(); revokePreview(); closeLightbox(false); closeMedia(false);
  for (const [container, record] of avatarContainers) {
    if (container.isConnected) ui.rawText(container, record.initials);
  }
  avatarContainers.clear();
  for (const image of el("messages").querySelectorAll("img")) image.removeAttribute("src");
}
function clearChat() {
  followupUI?.clear();
  clearMessageSelection();
  closeChatMenu(); closeComposerTools();
  conversationDownload?.suspend();
  closeQuickReplies();
  closeEmojis();
  clearMessageAnnouncement(); messageRows.clear();
  clearImages();
  ui.forget(el("messages")); el("messages").replaceChildren(); ui.text(el("peer-name"), "Messages privés");
  ui.text(el("conversation-status"), "Choisis une conversation.");
  el("message-body").value = ""; el("message-body").disabled = true; el("send").disabled = true;
  el("open-emojis").disabled = true;
  el("open-composer-tools").disabled = true;
  ui.rawText(el("peer-avatar"), "");
  el("photo-tools").hidden = true; el("open-gallery").hidden = true; el("image-draft").hidden = true; el("image-file").value = "";
  el("photo-batch").hidden = true; ui.forget(el("photo-batch-list")); el("photo-batch-list").replaceChildren();
  el("video-draft").hidden = true; el("video-file").value = ""; el("open-video-gallery").hidden = true;
  for (const id of ["older-messages", "newer-messages", "new-messages", "empty-message", "pending-controls"]) if (el(id)) el(id).hidden = true;
  el("workspace").classList.remove("selected"); document.querySelector(".page").classList.remove("has-conversation"); notice("");
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
    conversationDownload = createConversationDownload({ parent: el("conversation-download-menu"), capability, getContext, request, getReturnFocus: menuReturnFocus, onError: error => handleError(error) });
    conversationDownload.update();
  } catch (error) { if (fresh(ticket, true) && getContext()) notice("Le téléchargement n’est pas disponible. Réessaie ; aucun fichier incomplet n’est proposé.", true); }
}
async function mountFollowup() {
  if (role !== "admin" || !repliesCapability || followupUI || followupMount || !ready || !visible() || !sessionOwner) return;
  const owner = sessionOwner, ticket = snapshot(), mounting = {}; followupMount = mounting;
  try {
    const { createFollowupUI } = await import("/followup.js");
    if (followupMount !== mounting || !fresh(ticket, true) || !sameOwner(owner, sessionOwner) || !ready || !visible()) return;
    followupHost = document.createElement("div"); followupHost.id = "reply-followup-host";
    document.querySelector(".chat-head").after(followupHost);
    followupUI = createFollowupUI({ host: followupHost, getConversation: () => currentState()?.conversation ?? null,
      getReplyThrough: () => { const holder = {}, state = currentState(); if (state) captureReply(state, holder); return holder.replyThrough ?? "0"; }, request,
      onChanged(id, reply) {
        const state = states.get(id);
        if (state?.conversation) { state.conversation = { ...state.conversation, reply }; crm?.updateConversation(state.conversation); }
        if (inbox.has(id)) inbox.set(id, { ...inbox.get(id), reply });
        renderInbox(); if (currentState()?.conversation) renderMeta(currentState()); schedulePolling(0);
      }, onError: error => handleError(error) });
    followupUI.update();
  } catch { /* A failed optional control must not remove the conversation. */ }
  finally { if (followupMount === mounting) followupMount = null; }
}
async function mountProfile() {
  if (profileCapability?.enabled !== true || !ready || !visible() || !sessionOwner || profileUI || profileMount) return;
  const owner = sessionOwner, ticket = snapshot(), lifetime = generation;
  const mounting = {}; profileMount = mounting;
  try {
    const { createProfileUI } = await import("/profile.js");
    if (profileMount !== mounting || !fresh(ticket, true) || !ready || !visible() || !sameOwner(owner, sessionOwner) || loggingOut) return;
    profileUI = createProfileUI({ role, button: el("open-profile"), request, fetchBinary: fetchProfileBinary,
      avatarsEnabled: profileCapability.avatars === true,
      passwordEnabled: profileCapability.passwordEnabled === true,
      preferencesEnabled: profileCapability.preferencesEnabled === true,
      onPasswordChanged: async changed => {
        const current = await refreshSession();
        await start({ session: current.session });
        notice(current.session.user.id === changed.user.id && current.session.csrf === changed.csrf
          ? "Mot de passe modifié. Cet appareil reste connecté." : "Ta connexion a été actualisée.");
      },
      getReturnFocus: menuReturnFocus,
      isCurrent: () => generation === lifetime && sameOwner(owner, sessionOwner) && ready && visible() && !el("workspace").hidden && !loggingOut,
      onError: error => handleError(error) });
    el("open-profile").hidden = false;
  } catch (error) {
    if (fresh(ticket, true) && ready && visible()) el("open-profile").hidden = true;
  } finally { if (profileMount === mounting) profileMount = null; }
}
async function mountAnnouncements() {
  if (announcementCapability?.enabled !== true || !ready || !visible() || !sessionOwner || loggingOut) return;
  if (role === "admin") return;
  if (announcementUI) { void announcementUI.refresh(true); return; }
  if (announcementMount) return;
  const owner = sessionOwner, lifetime = generation, ticket = snapshot(), mounting = {}; announcementMount = mounting;
  try {
    const { createAnnouncementBanner } = await import("/announcement-banner.js");
    if (announcementMount !== mounting || !fresh(ticket, true) || !ready || !visible() || !sameOwner(owner, sessionOwner) || loggingOut) return;
    announcementHost = document.createElement("div"); announcementHost.id = "announcement-host";
    document.querySelector(".chat-head").after(announcementHost);
    announcementUI = createAnnouncementBanner({ host: announcementHost, menuParent: el("conversation-actions"), request, ui,
      getReturnFocus: menuReturnFocus,
      isCurrent: () => generation === lifetime && sameOwner(owner, sessionOwner) && ready && visible() && !el("workspace").hidden && !loggingOut,
      onError: error => { if (error.status === 401 || error.status === 403) void handleError(error); } });
    void announcementUI.refresh(true);
  } catch { /* An unavailable optional banner must not interrupt messages. */ }
  finally { if (announcementMount === mounting) announcementMount = null; }
}
function mountNotificationSettings() {
  if (notificationsPanel || !ready || !sessionOwner || !visible() || !globalThis.JessieNotifications) return;
  const ticket = snapshot(), owner = { id: sessionOwner.id, csrf: sessionOwner.csrf };
  notificationsPanel = globalThis.JessieNotifications.mount(el("notifications-chat-host"), {
    role, owner, isCurrent: () => fresh(ticket, true) && ready && visible() && !loggingOut && sessionOwner?.id === owner.id && csrf === owner.csrf,
    onAvailability: (available) => { if (fresh(ticket, true) && ready && visible()) el("open-notifications").hidden = !available; },
  });
}
function clearPrivate({ purgeDrafts = false } = {}) {
  if (purgeDrafts) drafts.clear(role);
  else {
    for (const state of states.values()) if (state.conversation) drafts.write(state, { selected: state.id === selected });
    drafts.detach();
  }
  closeChatMenu(); closeComposerTools(); menuOpener = null;
  quickReplyLanguage = null;
  tasksCapability = false; repliesCapability = false; followupMount = null;
  followupUI?.destroy(); followupUI = null; followupHost?.remove(); followupHost = null;
  emojiSkinTone = "default";
  profileUI?.destroy(); profileUI = null; profileMount = null; profileCapability = null;
  announcementUI?.destroy(); announcementUI = null; announcementMount = null; announcementCapability = null; announcementHost?.remove(); announcementHost = null;
  avatarVersions.clear(); avatarPaths.clear(); el("open-profile").hidden = true;
  clearNotificationSettings();
  cancelConfirmation(); stopReconnect(); resumeTask = null; retryConnection(false);
  generation += 1; selectionEpoch += 1; visibilityGeneration += 1; ready = false; csrf = null;
  sessionOwner = null; ownerCheck = null; bootstrapTask = null; pollEpoch += 1; cycleRunning = false;
  olderBusy = false; newerBusy = false; sendBusy = false; readBusy = false; selectionLoading = false; eventRequests.clear();
  mediaEnabled = false; videoEnabled = false; videoCreationEnabled = false;
  conversationDownload?.clear(); conversationDownload = null; conversationDownloadCapability = null;
  crm?.clear(); crm = null; document.getElementById("crm-style")?.remove();
  stopPolling(); abortRequests(); expiryTimer?.(); expiryTimer = null;
  for (const value of states.values()) revokeBatchPreviews(value.photoBatch);
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
  ui.text(el("confirm-title"), kind === "video" ? "Supprimer cette vidéo ?" : kind === "photo" ? "Supprimer cette photo ?" : "Supprimer ce message ?");
  ui.text(el("confirm-description"), ["photo", "video"].includes(kind) ? "Elle sera retirée de ta bibliothèque. Cette action est définitive." : "Il disparaîtra de cette conversation pour vous deux. Cette action est définitive.");
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
      const state = currentState(); if (state) renderMessages(state);
      el("workspace").hidden = false; conversationDownload?.update(); void mountConversationDownload(conversationDownloadCapability); void mountProfile(); void mountFollowup(); void mountAnnouncements(); notice("", false, "session-status"); retryConnection(false); mountNotificationSettings();
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
  return !loggingOut && (crm?.hasUnsavedWork?.() === true || [...states.values()].some((state) => state.draft?.length || state.pending || state.imageDraft || state.videoDraft));
}
function signOut() {
  clearPrivate({ purgeDrafts: true });
  location.replace(pendingNotification ? globalThis.JessieNotificationLink.destination(role, pendingNotification, true) : role === "admin" ? "/admin/login" : "/access");
}
function snapshot(state = null) { return { generation, visibilityGeneration, selectionEpoch, id: state?.id, epoch: state?.epoch }; }
function fresh(ticket, account = false) { return ticket.generation === generation && ticket.visibilityGeneration === visibilityGeneration && (account || (ticket.selectionEpoch === selectionEpoch && (!ticket.id || belongsTo(currentState(), ticket.id, ticket.epoch)))); }
async function request(path, { body, rawBody, contentType, mutation = false, state = null, account = false, signal = null, verifyOwner = true, archive = false } = {}) {
  const owner = sessionOwner; const ticket = snapshot(state); const controller = new AbortController(); controllers.add(controller);
  const passwordChange = mutation && account && path === `/api/account/${role}/password`;
  controller.accountScope = account;
  const abort = () => controller.abort(); if (signal?.aborted) controller.abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), archive && videoEnabled ? 300000 : rawBody || archive ? 65000 : 15000);
  const headers = mutation ? { "Content-Type": contentType ?? "application/json", "X-CSRF-Token": csrf ?? "" } : {};
  try {
    if (mutation && verifyOwner && owner) await confirmOwner(ticket, owner, account);
    if (!fresh(ticket, account)) throw staleResponse();
    const response = await fetch(path, { method: mutation ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers, body: mutation ? rawBody ?? JSON.stringify(body ?? {}) : undefined, signal: controller.signal });
    let data;
    if (archive && response.ok) {
      try {
        const reader = await import(role === "client" ? "/client-archive.js" : "/private-archive.js");
        data = await (videoEnabled ? reader.readVideoArchive : reader.readPrivateArchive)(response, controller.signal);
      } catch (error) { controller.abort(); throw error; }
    } else { try { data = await response.json(); } catch { data = {}; } }
    if (!fresh(ticket, account)) throw staleResponse();
    // This one authenticated operation intentionally rotates the cookie. Prove
    // its old owner before POST, then let its callback verify the current cookie
    // by GET before adopting the new session. Ordinary replies keep both proofs.
    if (passwordChange && response.ok) {
      if (!owner || data.status !== "password_changed" || !sessionIdentity(data)
        || data.user.id !== owner.id || data.user.role !== owner.role) throw new Error("invalid_password_response");
    } else if (verifyOwner && owner && path !== `${sessionBase}/session`) await confirmOwner(ticket, owner, account);
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
  if (changed) clearPrivate({ purgeDrafts: true });
  sessionOwner = owner; csrf = session.csrf; sessionCheckedAt = Date.now();
  const ticket = snapshot();
  await drafts.bind(owner);
  if (!fresh(ticket, true) || !sameOwner(owner, sessionOwner) || !visible() || loggingOut && !allowLoggingOut) throw staleResponse();
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
    drafts.forget(state.id); states.delete(state.id); inbox.delete(state.id); selected = null; crm?.removeConversation(state.id); selectionEpoch += 1; selectionLoading = false; clearChat(); renderInbox(); notice("Cette conversation n’est plus accessible.", true); schedulePolling(); return;
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
function validAvatarUrl(path, conversationId = null) {
  if (typeof path !== "string" || conversationId !== null && !/^[0-9a-f]{32}$/.test(conversationId)) return false;
  const suffix = conversationId === null ? "(?:avatar|conversations/[0-9a-f]{32}/avatar)" : `conversations/${conversationId}/avatar`;
  const match = new RegExp(`^/api/profile/${role}/${suffix}\\?v=([1-9][0-9]{0,9})$`).exec(path);
  return Boolean(match && BigInt(match[1]) <= 4294967295n);
}
async function fetchProfileBinary(path, { signal = null, maxBytes = 131072 } = {}) {
  if (!validAvatarUrl(path) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 262144) throw new Error("invalid_avatar_request");
  const limit = Math.min(maxBytes, 131072), owner = sessionOwner, ticket = snapshot(), version = mediaVersion;
  const controller = new AbortController(); controller.accountScope = true; controllers.add(controller);
  const abort = () => controller.abort(); if (signal?.aborted) controller.abort(); else signal?.addEventListener("abort", abort, { once: true });
  let acquired = false, reader = null, bytes = null;
  const timeout = setTimeout(() => controller.abort(), 15000);
  const current = () => !controller.signal.aborted && fresh(ticket, true) && version === mediaVersion && sameOwner(owner, sessionOwner) && visible() && !loggingOut;
  try {
    await confirmOwner(ticket, owner, true);
    if (!current()) throw staleResponse();
    acquired = await acquireImageSlot(controller.signal); if (!acquired || !current()) throw staleResponse();
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
    if (!current()) throw staleResponse();
    await confirmOwner(ticket, owner, true);
    if (!current()) throw staleResponse();
    if (!response.ok) {
      if (response.status === 401 || role === "client" && response.status === 403) signOut();
      throw Object.assign(new Error("avatar_unavailable"), { status: response.status });
    }
    if (response.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() !== "image/jpeg") throw new Error("invalid_avatar_response");
    const declared = response.headers.get("Content-Length");
    if (declared !== null && (!/^[1-9][0-9]*$/.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > limit)) throw new Error("invalid_avatar_response");
    reader = response.body?.getReader?.(); if (!reader) throw new Error("invalid_avatar_response");
    bytes = new Uint8Array(limit); let size = 0;
    while (true) {
      const part = await reader.read();
      if (!current()) throw staleResponse();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || size + part.value.length > limit) throw new Error("invalid_avatar_response");
      bytes.set(part.value, size); size += part.value.length;
    }
    if (size < 1 || declared !== null && Number(declared) !== size) throw new Error("invalid_avatar_response");
    await confirmOwner(ticket, owner, true);
    if (!current()) throw staleResponse();
    return new Blob([bytes.subarray(0, size)], { type: "image/jpeg" });
  } catch (error) {
    controller.abort();
    if (!fresh(ticket, true) || !sameOwner(owner, sessionOwner) || !visible() || loggingOut) throw staleResponse();
    throw error;
  } finally {
    bytes?.fill(0);
    try { await reader?.cancel(); } catch { /* The read may already be closed. */ }
    clearTimeout(timeout); signal?.removeEventListener("abort", abort); controllers.delete(controller);
    if (acquired) releaseImageSlot();
  }
}
async function avatarImageUrl(path, conversationId) {
  if (!visible() || !validAvatarUrl(path, conversationId)) throw staleResponse();
  const owner = sessionOwner, ticket = snapshot(), version = mediaVersion;
  if (imageUrls.get(path)) {
    await confirmOwner(ticket, owner, true);
    if (!fresh(ticket, true) || version !== mediaVersion || !sameOwner(owner, sessionOwner)) throw staleResponse();
    const cached = imageUrls.get(path); if (cached) return cached;
  }
  const pending = imageRequests.get(path); if (pending) return pending.promise;
  const controller = new AbortController(), record = { controller, promise: null };
  record.promise = (async () => {
    try {
      const blob = await fetchProfileBinary(path, { signal: controller.signal });
      if (controller.signal.aborted || !fresh(ticket, true) || version !== mediaVersion || !sameOwner(owner, sessionOwner) || !visible()) throw staleResponse();
      const url = URL.createObjectURL(blob);
      if (!imageUrls.put(path, url, blob.size)) throw new Error("invalid_avatar_response");
      return url;
    } finally { if (imageRequests.get(path) === record) imageRequests.delete(path); }
  })();
  imageRequests.set(path, record); return record.promise;
}
function renderPeerAvatar(container, conversation) {
  const initials = String(conversation.peerName ?? "").trim().split(/\s+/u).slice(0, 2).map(part => [...part][0] ?? "").join("").toUpperCase() || "?";
  if (!visible()) { avatarContainers.delete(container); ui.rawText(container, initials); return; }
  let avatar = conversation.peerAvatar;
  if (profileCapability?.avatars !== true || !avatar || !/^[1-9][0-9]{0,9}$/.test(avatar.version)
    || BigInt(avatar.version) > 4294967295n || avatar.url !== `/api/profile/${role}/conversations/${conversation.id}/avatar?v=${avatar.version}`) avatar = null;
  const previousVersion = avatarVersions.get(conversation.id);
  if (avatar && previousVersion && BigInt(avatar.version) < BigInt(previousVersion)) avatar = null;
  if (avatar) avatarVersions.set(conversation.id, avatar.version);
  const path = avatar?.url ?? null, previousPath = avatarPaths.get(conversation.id);
  if (previousPath && previousPath !== path) { imageUrls.remove(previousPath); imageRequests.get(previousPath)?.controller.abort(); }
  avatarPaths.set(conversation.id, path);
  const existing = avatarContainers.get(container);
  if (existing && existing.path === path && existing.initials === initials && existing.version === mediaVersion && !existing.failed) return;
  const record = { path, initials, version: mediaVersion, failed: false }; avatarContainers.set(container, record);
  ui.rawText(container, initials);
  if (!path) return;
  void avatarImageUrl(path, conversation.id).then(url => {
    if (!container.isConnected || !visible() || avatarContainers.get(container) !== record || record.version !== mediaVersion || avatarPaths.get(conversation.id) !== path) return;
    const image = document.createElement("img"); image.alt = ""; image.width = 40; image.height = 40; image.decoding = "async";
    image.addEventListener("error", () => { if (avatarContainers.get(container) === record) { record.failed = true; imageUrls.remove(path); ui.rawText(container, initials); } });
    image.src = url; container.replaceChildren(image);
  }).catch(() => { if (avatarContainers.get(container) === record) record.failed = true; });
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
  let galleryChanged = false, videoGalleryChanged = false;
  for (const message of [...state.messages.values(), ...deleted]) {
    if (message.deletedAt == null) continue;
    const prefix = `${mediaBase}/conversations/${state.id}/messages/${message.id}/`;
    imageUrls.removeWhere((path) => path.startsWith(prefix));
    for (const [path, record] of imageRequests) if (path.startsWith(prefix)) { record.controller.abort(); imageRequests.delete(path); }
    if (lightboxItem?.messageId === message.id) closeLightbox();
    if (panel?.kind === "gallery") { const length = panel.items.length; panel.items = panel.items.filter((item) => item.messageId !== message.id); galleryChanged ||= length !== panel.items.length; }
    if (videoGallery?.state.id === state.id) {
      const length = videoGallery.items.length; videoGallery.items = videoGallery.items.filter(item => item.messageId !== message.id);
      videoGalleryChanged ||= length !== videoGallery.items.length;
    }
  }
  if (galleryChanged) renderMediaPanel();
  if (videoGalleryChanged) renderVideoGallery();
}
function renderImageDraft(state) {
  const draft = state.imageDraft; const pending = state.pending?.kind === "image" ? state.pending : null; const hasImage = Boolean(draft || pending || state.photoBatch?.items.length);
  el("image-draft").hidden = !Boolean(draft || pending);
  renderPhotoBatch(state);
  el("message-body").maxLength = hasImage ? 1000 : 4096; el("message-body").required = !hasImage;
  ui.attr(el("message-body"), "placeholder", hasImage ? "Ajoute une légende (facultatif)…" : role === "client" ? "Écris-moi…" : "Écris ton message…");
  ui.text(el("composer-help"), hasImage ? "Photo privée · légende facultative de 1 000 caractères maximum" : "Message privé · 4 096 caractères maximum");
  el("composer-help").classList.toggle("sr-only", !hasImage && el("message-body").value.length < 3896);
  el("cancel-image").disabled = Boolean(state.pending) || sendBusy;
  if (!draft && !pending) { revokePreview(); return; }
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
function videoErrorText(error) {
  if (error.code === "video_admin_only") return "L’envoi de vidéos est réservé à Jessie. Tu peux envoyer des photos.";
  if (error.status === 409 && error.code === "video_in_use") return "Cette vidéo ne peut pas être supprimée : elle est utilisée dans un message, ou une diffusion est en cours.";
  if (error.status === 507) return "Le stockage des vidéos a atteint sa limite.";
  if ([400, 411, 413, 415].includes(error.status)) return "Vidéo refusée. Choisis une vidéo MP4 de 100 Mo maximum et une légende de 1 000 caractères maximum.";
  if (error.status === 404) return "Cette vidéo n’est plus disponible.";
  if (error.status === 429) return "Patiente un moment avant de réessayer cet envoi.";
  return "La confirmation de la vidéo manque. Tu peux réessayer ; un transfert interrompu devra recommencer.";
}
function validVideoUrl(value, state, messageId, ownedAssetId = null) {
  if (ownedAssetId !== null) return typeof value === "string" && /^[a-f0-9]{32}$/.test(ownedAssetId)
    && value === videoBase + "/assets/" + ownedAssetId + "/content";
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(messageId ?? "")
    && value === videoBase + "/conversations/" + state.id + "/messages/" + messageId + "/content";
}
function releaseVideoPlayer(video) {
  if (!video) return;
  videoPlayers.delete(video);
  try { video.pause?.(); } catch {}
  video.removeAttribute("src");
  try { video.load?.(); } catch {}
}
function clearVideoPlayers(container = null) {
  for (const video of videoPlayers.keys()) if (!container || container.contains(video)) releaseVideoPlayer(video);
}
function revokeVideoPreview() {
  const container = el("video-preview");
  for (const video of container.querySelectorAll("video")) releaseVideoPlayer(video);
  if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
  videoPreviewUrl = null; videoPreviewIdentity = null; ui.forget(container); container.replaceChildren();
}
function privateVideoElement() {
  const video = document.createElement("video"); video.className = "private-video";
  video.controls = true; video.playsInline = true; video.preload = "none";
  video.disablePictureInPicture = true; video.disableRemotePlayback = true;
  ui.attr(video, "aria-label", "Vidéo privée");
  return video;
}
function attachPrivateVideo(video, metadata, state, messageId, current = () => true, ownedAssetId = null) {
  if (!videoEnabled || !visible() || !validVideoUrl(metadata?.contentUrl, state, messageId, ownedAssetId)) return;
  const ticket = snapshot(state), owner = sessionOwner, version = videoVersion;
  const record = { current: () => current() && video.isConnected && visible() && fresh(ticket)
    && version === videoVersion && sameOwner(owner, sessionOwner) && !loggingOut };
  videoPlayers.set(video, record);
  let permitted = false, checking = false;
  if (!video.dataset.videoGuard) {
    video.dataset.videoGuard = "true";
    video.addEventListener("play", async () => {
      const active = videoPlayers.get(video);
      if (permitted) { permitted = false; return; }
      try { video.pause(); } catch {}
      if (!active?.current() || checking) return;
      checking = true;
      try {
        await confirmOwner(snapshot(state), sessionOwner);
        if (videoPlayers.get(video) === active && active.current()) {
          permitted = true;
          try { await video.play(); } catch { permitted = false; }
        }
      } catch { releaseVideoPlayer(video); }
      finally { checking = false; }
    });
    video.addEventListener("error", () => {
      if (videoPlayers.get(video)?.current()) {
        const error = video.parentElement?.querySelector(".video-error");
        if (error) { error.hidden = false; ui.text(error, "Cette vidéo n’est plus disponible ou ce navigateur ne peut pas la lire."); }
      }
    });
  }
  void confirmOwner(ticket, owner).then(() => {
    if (videoPlayers.get(video) === record && record.current()) video.src = metadata.contentUrl;
  }).catch(() => { if (videoPlayers.get(video) === record) releaseVideoPlayer(video); });
}
function renderVideoDraft(state) {
  const draft = state.videoDraft, pending = state.pending?.kind === "video" ? state.pending : null;
  const hasVideo = Boolean(draft || pending); el("video-draft").hidden = !hasVideo;
  el("video-progress").hidden = !videoTransfer || videoTransfer.state !== state || pending?.stage !== "uploading";
  const uploading = Boolean(videoTransfer?.state === state && pending?.stage === "uploading");
  el("cancel-video").disabled = Boolean(state.pending) && !uploading;
  ui.text(el("cancel-video"), uploading ? "Annuler le transfert" : "Retirer la vidéo");
  if (!hasVideo) { revokeVideoPreview(); return; }
  el("message-body").maxLength = 1000; el("message-body").required = false;
  ui.attr(el("message-body"), "placeholder", "Ajoute une légende (facultatif)…");
  ui.text(el("composer-help"), "Vidéo privée · MP4, 100 Mo maximum · légende facultative");
  el("composer-help").classList.remove("sr-only");
  ui.text(el("video-draft-status"), pending?.stage === "sending" ? "Envoi de la vidéo…" : uploading ? "Transfert de la vidéo…" : draft?.invalid ? "Cette vidéo n’est plus disponible ou ce navigateur ne peut pas la lire." : "Une vidéo à envoyer");
  if (!visible() || !draft?.file || videoPreviewIdentity === draft.file) return;
  revokeVideoPreview(); videoPreviewIdentity = draft.file; videoPreviewUrl = URL.createObjectURL(draft.file);
  const video = privateVideoElement(); video.preload = "metadata"; video.muted = true;
  ui.attr(video, "aria-label", "Aperçu de la vidéo choisie"); video.src = videoPreviewUrl;
  video.addEventListener("loadedmetadata", () => {
    if (state.videoDraft === draft && videoPreviewIdentity === draft.file && belongsTo(currentState(), state.id, state.epoch)) {
      draft.ready = true; draft.invalid = false; renderMeta(state);
    }
  });
  video.addEventListener("error", () => {
    if (state.videoDraft === draft && videoPreviewIdentity === draft.file && belongsTo(currentState(), state.id, state.epoch)) {
      draft.invalid = true; draft.ready = false; renderMeta(state);
    }
  });
  el("video-preview").append(video);
}
function chooseVideo() {
  if (role !== "admin") { el("video-file").value = ""; notice("L’envoi de vidéos est réservé à Jessie. Tu peux envoyer des photos.", true); return; }
  const state = currentState(), file = el("video-file").files?.[0]; el("video-file").value = "";
  if (!state || !file || !videoCreationEnabled || state.pending || sendBusy || state.photoBatch?.started || !state.conversation?.canSend) return;
  if (file.type !== "video/mp4" || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > 104857600) {
    notice("Choisis une vidéo MP4 de 100 Mo maximum.", true); return;
  }
  if (el("message-body").value.length > 1000) { notice("Raccourcis ton texte à 1 000 caractères avant d’ajouter une vidéo.", true); return; }
  discardPhotoBatch(state); state.imageDraft = null; revokePreview();
  state.videoDraft = { file, ready: false, invalid: false }; renderMeta(state);
  notice("Vidéo choisie. Vérifie l’aperçu, ajoute une légende ou envoie-la."); focusComposer();
}
async function uploadVideo(file, state, transfer) {
  const ticket = snapshot(state), owner = sessionOwner;
  await confirmOwner(ticket, owner);
  if (!fresh(ticket) || transfer.controller.signal.aborted) throw staleResponse();
  const value = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); let done = false;
    const abort = () => xhr.abort();
    const finish = (error, data) => {
      if (done) return; done = true; transfer.controller.signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(data);
    };
    xhr.open("POST", videoBase + "/assets"); xhr.withCredentials = true; xhr.timeout = 300000;
    xhr.setRequestHeader("Content-Type", "video/mp4"); xhr.setRequestHeader("X-CSRF-Token", csrf ?? "");
    xhr.upload.addEventListener("progress", event => {
      if (!fresh(ticket) || videoTransfer !== transfer || state.pending !== transfer.pending) return;
      el("video-progress").value = Math.min(100, Math.floor(event.loaded * 100 / file.size));
    });
    xhr.addEventListener("load", () => {
      let result = {}; try { if (xhr.responseText.length <= 8192) result = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status < 200 || xhr.status >= 300) { finish(Object.assign(new Error("video_upload_failed"), { status: xhr.status, code: result.error })); return; }
      if (!/^[a-f0-9]{32}$/.test(result.id ?? "") || result.mime !== "video/mp4" || result.bytes !== file.size) { finish(new Error("invalid_video_response")); return; }
      finish(null, result);
    });
    xhr.addEventListener("error", () => finish(new Error("video_upload_failed")));
    xhr.addEventListener("timeout", () => finish(new Error("video_upload_timeout")));
    xhr.addEventListener("abort", () => finish(Object.assign(new Error("video_upload_aborted"), { cancelled: transfer.cancelled })));
    transfer.controller.signal.addEventListener("abort", abort, { once: true });
    if (transfer.controller.signal.aborted) { finish(staleResponse()); return; }
    try { xhr.send(file); } catch (error) { finish(error); }
  });
  if (!fresh(ticket) || transfer.controller.signal.aborted) throw staleResponse();
  await confirmOwner(ticket, owner);
  if (!fresh(ticket) || transfer.controller.signal.aborted) throw staleResponse();
  return value;
}
function closeVideoGallery(restoreFocus = true) {
  videoGalleryVersion++; videoGallery = null; videoGalleryBusy = false;
  clearVideoPlayers(el("video-grid")); ui.forget(el("video-grid")); el("video-grid").replaceChildren();
  if (el("video-gallery").open) el("video-gallery").close();
  if (restoreFocus) focusVisible(videoGalleryReturnFocus ?? menuReturnFocus());
  videoGalleryReturnFocus = null;
}
async function openVideoGallery(opener, kind = "gallery") {
  const state = currentState(); if (!videoEnabled || !state || !visible()) return;
  if (!["gallery", "library"].includes(kind)) return;
  closeVideoGallery(false); videoGalleryReturnFocus = opener; videoGallery = { state, kind, items: [], nextBefore: null, hasMore: false };
  ui.text(el("video-gallery-title"), kind === "library" ? "Mes vidéos" : "Vidéos de la conversation");
  el("video-gallery-conversation").setAttribute("aria-pressed", String(kind === "gallery"));
  el("video-gallery-library").setAttribute("aria-pressed", String(kind === "library"));
  el("video-gallery").showModal(); focusVisible(el("close-video-gallery")); await loadVideoGallery();
}
async function loadVideoGallery(more = false) {
  const panel = videoGallery; if (!panel || videoGalleryBusy || more && !panel.hasMore) return;
  const version = videoGalleryVersion; videoGalleryBusy = true; el("more-videos").disabled = true;
  ui.text(el("video-gallery-status"), "Chargement des vidéos…");
  try {
    const library = panel.kind === "library";
    const path = library ? videoBase + "/assets?limit=20" + (more ? "&afterId=" + panel.nextBefore : "")
      : videoBase + "/conversations/" + panel.state.id + "/gallery?limit=20" + (more ? "&before=" + panel.nextBefore : "");
    const result = await request(path, { state: panel.state });
    if (videoGallery !== panel || version !== videoGalleryVersion) return;
    const received = library ? result.assets : result.items, cursor = library ? result.nextCursor : result.nextBefore;
    if (!Array.isArray(received) || received.length > 20 || typeof result.hasMore !== "boolean"
      || cursor !== null && typeof cursor !== "string") throw new Error("invalid_video_gallery");
    let previous = more ? panel.nextBefore : null;
    for (const item of received) {
      if (library) {
        if (!/^[a-f0-9]{32}$/.test(item.id ?? "") || previous !== null && item.id <= previous
          || typeof item.cleanupPending !== "boolean" || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 104857600
          || item.mime !== "video/mp4" || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0
          || (item.cleanupPending ? item.contentUrl !== null : !validVideoUrl(item.contentUrl, panel.state, null, item.id))) throw new Error("invalid_video_gallery");
        previous = item.id;
      } else {
        sequence(item.sequence);
        if (previous !== null && compareSequence(item.sequence, previous) >= 0 || !validVideoUrl(item.video?.contentUrl, panel.state, item.messageId)) throw new Error("invalid_video_gallery");
        previous = item.sequence;
      }
    }
    if (result.hasMore && (!received.length || cursor !== (library ? received.at(-1).id : received.at(-1).sequence))
      || !result.hasMore && cursor !== null) throw new Error("invalid_video_gallery");
    const deleted = new Set([...panel.state.messages.values()].filter(message => message.deletedAt != null).map(message => message.id));
    const items = library ? received : received.filter(item => !deleted.has(item.messageId));
    panel.items = more ? [...panel.items, ...items] : items;
    panel.nextBefore = cursor; panel.hasMore = result.hasMore; renderVideoGallery();
    ui.text(el("video-gallery-status"), library ? "Tu peux supprimer tes vidéos inutilisées lorsqu’aucune diffusion n’est en cours."
      : panel.items.length ? "Les vidéos restent privées dans cette conversation." : "Aucune vidéo dans cette conversation.");
  } catch (error) {
    if (videoGallery === panel && version === videoGalleryVersion && !error.stale) {
      ui.text(el("video-gallery-status"), videoErrorText(error));
      if ([401, 403].includes(error.status)) await handleError(error, panel.state);
    }
  } finally {
    if (videoGallery === panel && version === videoGalleryVersion) { videoGalleryBusy = false; el("more-videos").disabled = false; }
  }
}
function renderVideoGallery() {
  const panel = videoGallery; if (!panel) return;
  const library = panel.kind === "library";
  clearVideoPlayers(el("video-grid")); ui.forget(el("video-grid")); el("video-grid").replaceChildren();
  for (const item of panel.items) {
    const card = document.createElement("article"), video = privateVideoElement(); card.className = "video-card";
    const error = document.createElement("p"); error.className = "video-error"; error.hidden = true;
    const time = document.createElement("p"); ui.text(time, "{date}", { date: dateParameter(item.createdAt, true) });
    if (!library || !item.cleanupPending) card.append(video, error);
    else { const pending = document.createElement("p"); ui.text(pending, "Suppression à terminer"); card.append(pending); }
    card.append(time); el("video-grid").append(card);
    if (!library || !item.cleanupPending) attachPrivateVideo(video, library ? item : item.video, panel.state, item.messageId,
      () => videoGallery === panel && panel.items.includes(item), library ? item.id : null);
    if (library && videoCreationEnabled) {
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button";
      ui.text(remove, item.cleanupPending ? "Terminer la suppression" : "Supprimer");
      remove.disabled = [...states.values()].some(state => state.pending?.kind === "video" && state.pending.videoId === item.id);
      remove.addEventListener("click", () => { void removeOwnVideo(item, panel, remove); }); card.append(remove);
    }
  }
  el("more-videos").hidden = !panel.hasMore;
  ui.text(el("more-videos"), library ? "Autres vidéos" : "Vidéos précédentes");
}
async function removeOwnVideo(item, panel, button) {
  if (button.disabled || videoGallery !== panel) return;
  const ticket = snapshot(panel.state), owner = sessionOwner;
  if (!await confirmDeletion("video", button) || videoGallery !== panel || !fresh(ticket) || !sameOwner(owner, sessionOwner)
    || !belongsTo(currentState(), panel.state.id, panel.state.epoch) || !visible() || !videoCreationEnabled
    || !button.isConnected || !panel.items.includes(item)
    || [...states.values()].some(state => state.pending?.kind === "video" && state.pending.videoId === item.id)) return;
  button.disabled = true;
  try {
    await request(`${videoBase}/assets/${item.id}/delete`, { state: panel.state, mutation: true });
    if (videoGallery !== panel) return;
    panel.items = panel.items.filter(value => value.id !== item.id); renderVideoGallery();
    ui.text(el("video-gallery-status"), "Vidéo retirée de ta bibliothèque."); focusVisible(el("close-video-gallery"));
  } catch (error) {
    if (videoGallery !== panel || error.stale) return;
    ui.text(el("video-gallery-status"), videoErrorText(error));
    if ([401, 403].includes(error.status)) await handleError(error, panel.state);
  } finally { if (button.isConnected) button.disabled = false; }
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
      request, inboxHead: document.querySelector(".inbox-head"), chatHead: el("conversation-actions"), getReturnFocus: menuReturnFocus,
      conversationExport: capability.conversationExport?.enabled === true ? capability.conversationExport : null,
      tasksEnabled: tasksCapability, repliesEnabled: repliesCapability, preferencesEnabled: profileCapability?.preferencesEnabled === true,
      onError: (error) => handleError(error),
      onUnavailable(id) {
        drafts.forget(id);
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
function revokeBatchPreviews(batch) {
  for (const item of batch?.items ?? []) { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); item.previewUrl = null; }
}
function discardPhotoBatch(state) { revokeBatchPreviews(state.photoBatch); state.photoBatch = null; }
function chooseFile() {
  const state = currentState(), files = [...el("image-file").files ?? []]; el("image-file").value = "";
  if (!state || !files.length || state.pending || sendBusy || state.photoBatch?.started || !state.conversation?.canSend) return;
  const accepted = files.filter(file => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size > 0 && file.size <= 10485760);
  const videoRefused = role === "client" && files.some(file => file.type.startsWith("video/"));
  if (el("message-body").value.length > 1000) { notice("Raccourcis ton texte à 1 000 caractères avant d’ajouter une photo.", true); return; }
  if (!accepted.length) { notice(videoRefused ? "L’envoi de vidéos est réservé à Jessie. Tu peux envoyer des photos." : "Choisis une photo JPEG, PNG ou WebP de 10 Mo maximum.", true); return; }
  const previous = state.imageDraft?.file ? [state.imageDraft.file] : [];
  const available = MAX_PHOTO_BATCH - (state.photoBatch?.items.length ?? previous.length);
  const chosen = accepted.slice(0, available);
  if (!chosen.length) { notice("Choisis au maximum 10 photos par envoi.", true); return; }
  state.videoDraft = null; revokeVideoPreview();
  if (!state.photoBatch && !state.imageDraft && chosen.length === 1) state.imageDraft = { file: chosen[0], asset: null };
  else {
    state.photoBatch = createPhotoBatch([...previous, ...chosen], newClientId, state.photoBatch);
    state.imageDraft = null; revokePreview();
  }
  renderMeta(state);
  notice(videoRefused ? "L’envoi de vidéos est réservé à Jessie. Tu peux envoyer des photos." : chosen.length !== accepted.length ? "Choisis au maximum 10 photos par envoi." : accepted.length !== files.length ? "Certaines photos ont été refusées. Les autres restent dans ta sélection." : "Photos choisies. Vérifie les aperçus avant d’envoyer.", videoRefused || accepted.length !== files.length || chosen.length !== accepted.length);
  focusComposer();
}
function renderPhotoBatch(state) {
  const batch = state.photoBatch, host = el("photo-batch"); host.hidden = !batch?.items.length;
  if (!batch) { ui.forget(el("photo-batch-list")); el("photo-batch-list").replaceChildren(); return; }
  const sent = batch.items.filter(item => item.status === "sent").length;
  ui.text(el("photo-batch-status"), "{sent} sur {count} photos envoyées", { sent: ui.numberParam(sent), count: ui.numberParam(batch.items.length) });
  el("photo-batch-clear").disabled = sendBusy || batch.started;
  const list = el("photo-batch-list"), previous = new Map([...list.children].map(node => [node.dataset.photoId, node]));
  for (const item of batch.items) {
    let card = previous.get(item.clientMessageId);
    if (!card) {
      card = document.createElement("div"); card.className = "photo-batch-item"; card.dataset.photoId = item.clientMessageId;
      const image = document.createElement("img"); image.alt = ""; ui.attr(image, "aria-label", "Aperçu de la photo choisie");
      card.append(image, document.createElement("span"));
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button"; ui.text(remove, "Retirer la photo");
      remove.addEventListener("click", () => {
        const removed = removePhoto(batch, item.clientMessageId); if (!removed) return;
        if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl);
        if (!batch.items.length || batch.items.every(value => value.status === "sent")) {
          if (batch.captionDelivered) { state.draft = ""; el("message-body").value = ""; }
          discardPhotoBatch(state);
        }
        renderMeta(state); focusVisible(el("pick-image"));
      }); card.append(remove);
    }
    if (!item.previewUrl && item.file && visible()) item.previewUrl = URL.createObjectURL(item.prepared ?? item.file);
    const image = card.querySelector("img"); if (item.previewUrl && image.getAttribute("src") !== item.previewUrl) image.src = item.previewUrl;
    const label = item.status === "sent" ? "Photo envoyée" : item.status === "preparing" ? "Préparation de la photo…" : item.status === "uploading" ? "Transfert de la photo…" : item.status === "sending" ? "Envoi de la photo…" : ["failed", "uncertain"].includes(item.status) ? "À réessayer" : "Photo prête";
    ui.text(card.querySelector("span"), item.status === "failed" && item.error ? mediaErrorText(item.error) : label);
    card.querySelector("button").disabled = sendBusy || batch.started && !(item.status === "failed" && (!item.mediaId || [400,404,413,415,422].includes(item.error?.status)));
    list.append(card); previous.delete(item.clientMessageId);
  }
  for (const card of previous.values()) { ui.forget(card); card.remove(); }
}
function captureReply(state, holder = {}) {
  if (!state || role !== "admin" || Object.hasOwn(holder, "replyThrough")) return holder;
  let through = [...state.messages.values()].filter(value => value.sender === "peer" && value.deletedAt == null).reduce((max, value) => maxSequence(max, value.sequence), "0");
  for (const bound of [state.conversation?.reply?.through, state.conversation?.lastReadSequence]) if (bound !== undefined && compareSequence(through, bound) > 0) through = bound;
  holder.replyThrough = through;
  if (state.conversation?.reply?.version) holder.replyVersion = state.conversation.reply.version;
  return holder;
}
function replyFields(holder) { return role === "admin" && holder.replyThrough !== undefined && holder.replyThrough !== null ? { replyThrough: holder.replyThrough, ...(holder.replyVersion === undefined ? {} : { replyVersion: holder.replyVersion }) } : {}; }
async function sendPhotoSelection() {
  const state = currentState(), batch = state?.photoBatch;
  if (!batch || batch.busy || sendBusy || !state.conversation?.canSend || !validCaption(el("message-body").value)) return;
  const ticket = snapshot(state); if (batch.caption === null) batch.caption = el("message-body").value;
  if (!batch.started) { delete batch.replyThrough; captureReply(state, batch); if (batch.replyThrough === undefined) batch.replyThrough = null; }
  state.draft = batch.caption; sendBusy = true; renderMeta(state);
  try {
    // Sending from an old gallery/message anchor returns to the current page
    // before publishing. The reply boundary above stays tied to what was seen.
    if (state.hasMoreAfter && (!await loadNewer({ latest: true }) || !fresh(ticket) || state.photoBatch !== batch)) return;
    const complete = await runPhotoBatch(batch, {
      current: () => fresh(ticket) && visible() && state.photoBatch === batch,
      prepare: async file => {
        const controller = new AbortController(); controllers.add(controller);
        try { return await prepareImageUpload(file, { signal: controller.signal }); } finally { controllers.delete(controller); }
      },
      upload: async file => (await request(`${mediaBase}/assets`, { state, mutation: true, rawBody: file, contentType: file.type })).asset,
      send: messages => request(`${mediaBase}/conversations/${state.id}/messages/batch`, { state, mutation: true, body: { messages } }),
      changed: () => { if (fresh(ticket)) renderMeta(state); }
    });
    if (!fresh(ticket)) return;
    const messages = batch.items.filter(item => item.status === "sent").map(item => item.message);
    if (messages.length) { mergeMessages(state, messages); for (const message of messages) state.conversation.latestSequence = maxSequence(state.conversation.latestSequence, message.sequence); renderMessages(state, { ownSend: true }); }
    if (complete) { discardPhotoBatch(state); state.draft = ""; el("message-body").value = ""; notice("Toutes les photos ont été envoyées."); }
    else notice("Certaines photos restent à envoyer. Réessaie uniquement celles-ci.", true);
    schedulePolling(300);
  } catch (error) { await handleMediaError(error, state); }
  finally { if (fresh(ticket)) { sendBusy = false; renderMeta(state); } }
}

function mediaErrorText(error) {
  if (error.code === "media_format") return "Ce format n’est pas pris en charge. Choisis une photo JPEG, PNG ou WebP.";
  if (error.code === "media_dimensions") return "Cette photo est trop grande. Choisis une version plus petite.";
  if (error.code === "request_too_large") return "Cette photo dépasse 10 Mo. Choisis une version plus légère.";
  if (error.code === "media_unavailable") return "La photo n’a pas pu être préparée. Essaie une autre photo.";
  if (error.status === 507 && error.code === "storage_limit") return "Le stockage des photos a atteint sa limite.";
  if (error.status === 409 && error.code === "media_in_use") return "Cette photo est utilisée dans une conversation ou comme avatar. Retire ces utilisations avant de la supprimer.";
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
  panel = { kind, conversationId: state.id, epoch: state.epoch, items: [], cursor: null, hasMore: false, range: null };
  el("media-date-filter").hidden = kind !== "gallery"; el("media-month").value = "";
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
      : `${mediaBase}/conversations/${state.id}/gallery?limit=50${cursor ? `&before=${cursor}` : ""}${activePanel.range ? `&from=${activePanel.range.from}&until=${activePanel.range.until}` : ""}`;
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
  let previousDay = null;
  for (const item of activePanel.items) {
    const media = activePanel.kind === "library" ? item : item.media;
    if (activePanel.kind === "gallery") {
      const date = new Date(item.createdAt), key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      if (key !== previousDay) {
        const heading = document.createElement("h3"); heading.className = "media-date-heading";
        ui.text(heading, "{date}", { date: ui.dateParam(item.createdAt, { day: "numeric", month: "long", year: "numeric" }) }); fragment.append(heading); previousDay = key;
      }
    }
    const card = document.createElement("article"); card.className = "media-card"; card.dataset.mediaKey = activePanel.kind === "library" ? item.id : item.messageId;
    const photo = document.createElement("button"); photo.type = "button"; photo.className = "photo-open"; ui.attr(photo, "aria-label", "Agrandir cette photo privée");
    photo.addEventListener("click", () => { void openLightbox({ media, messageId: activePanel.kind === "gallery" ? item.messageId : null, sequence: item.sequence, createdAt: item.createdAt }, state, photo); });
    card.append(photo);
    const caption = document.createElement("p"); ui.text(caption, "{width} × {height} · {date}", { width: ui.numberParam(media.width), height: ui.numberParam(media.height), date: dateParameter(activePanel.kind === "library" ? media.createdAt : item.createdAt, true, activePanel.kind === "gallery") }); card.append(caption);
    if (activePanel.kind === "library") {
      if (media.sharedHere) { const warning = document.createElement("p"); warning.className = "shared-photo"; ui.text(warning, "Déjà envoyée ici. Renvoyer crée un nouveau message."); card.append(warning); }
      const actions = document.createElement("div"); actions.className = "media-actions";
      const choose = document.createElement("button"); choose.type = "button"; choose.className = "text-button"; choose.dataset.mediaAction = "choose"; ui.text(choose, media.sharedHere ? "Renvoyer" : "Choisir"); choose.disabled = !state.conversation?.canSend || Boolean(state.pending);
      choose.addEventListener("click", () => {
        if (!belongsTo(currentState(), state.id, state.epoch) || state.pending || !state.conversation?.canSend) return;
        if (el("message-body").value.length > 1000) { notice("Raccourcis ton texte à 1 000 caractères avant de choisir une photo.", true, "media-status"); return; }
        discardPhotoBatch(state); state.videoDraft = null; revokeVideoPreview(); state.imageDraft = { file: null, asset: media }; closeMedia(); renderMeta(state); notice(media.sharedHere ? "Cette photo a déjà été envoyée ici. Envoyer ajoutera un nouveau message." : "Photo choisie. Ajoute une légende ou envoie-la."); focusComposer();
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
function renderLightboxControls() {
  const navigable = Boolean(lightboxItem?.messageId && lightboxItem.sequence);
  for (const key of ["previous-photo", "next-photo", "photo-message"]) { el(key).hidden = !navigable; el(key).disabled = lightboxBusy; }
}
function updatePhotoTouchPolicy() {
  el("lightbox-image").classList.toggle("is-zoomed", (globalThis.visualViewport?.scale ?? 1) > 1.01);
}
function showLightboxPhoto(item, state) {
  const version = ++lightboxVersion; lightboxItem = item;
  updatePhotoTouchPolicy();
  ui.text(el("lightbox-status"), item.createdAt ? "Photo privée · {date}" : "Photo privée", item.createdAt ? { date: dateParameter(item.createdAt, true, true) } : {});
  renderLightboxControls();
  loadPhoto(el("lightbox-image"), item.media, state, { full: true, current: () => lightboxItem === item && lightboxVersion === version
    && belongsTo(currentState(), state.id, state.epoch) && (!item.messageId || ![...state.messages.values()].some(message => message.id === item.messageId && message.deletedAt != null)) });
}
async function openLightbox(item, state, opener) {
  if (!visible()) return;
  closeLightbox(false); lightboxReturnFocus = opener;
  lightboxScrollTop = { id: state.id, epoch: state.epoch, top: el("message-scroll").scrollTop };
  el("lightbox").showModal(); showLightboxPhoto(item, state);
}
async function navigatePhoto(direction) {
  const state = currentState(), original = lightboxItem, version = lightboxVersion;
  if (!state || !original?.messageId || !original.sequence || lightboxBusy || !visible()) return;
  lightboxBusy = true; renderLightboxControls();
  try {
    const cursor = direction === "previous" ? "before" : "after";
    const result = await request(`${mediaBase}/conversations/${state.id}/gallery?limit=1&${cursor}=${original.sequence}`, { state });
    if (lightboxItem !== original || lightboxVersion !== version) return;
    const item = result.items?.[0];
    if (!item) { ui.text(el("lightbox-status"), direction === "previous" ? "Première photo de la conversation" : "Dernière photo de la conversation"); return; }
    const compared = item.createdAt - original.createdAt || String(item.messageId).localeCompare(original.messageId);
    if (!/^[a-f0-9]{32}$/.test(item.messageId ?? "") || !validMediaUrl(item.media?.fullUrl, state)
      || !item.sequence || !Number.isSafeInteger(item.createdAt) || (direction === "previous" ? compared >= 0 : compared <= 0)) throw new Error("invalid_photo_neighbor");
    imageUrls.remove(original.media.fullUrl); imageRequests.get(original.media.fullUrl)?.controller.abort(); imageRequests.delete(original.media.fullUrl);
    showLightboxPhoto(item, state);
  } catch (error) { if (lightboxItem === original) await handleMediaError(error, state, "lightbox-status"); }
  finally { lightboxBusy = false; if (lightboxItem) renderLightboxControls(); }
}
async function seePhotoMessage() {
  const state = currentState(), item = lightboxItem;
  if (!state || !item?.messageId || !item.sequence || lightboxBusy) return;
  const target = { conversationId: state.id, messageId: item.messageId, sequence: item.sequence };
  closeLightbox(false); closeMedia(false);
  await selectConversation(state.id, { focus: true, target });
  const current = currentState(), message = current?.messages.get(target.sequence);
  if (current?.id !== target.conversationId || message?.id !== target.messageId || message.deletedAt != null || !message.media) {
    notice("Ce message n’est plus disponible.", true); return;
  }
  if (!focusNotification(target)) { notice("Ce message n’est plus disponible.", true); return; }
  setTimeout(() => { if (currentState() === current && current.notificationSequence === target.sequence) { current.notificationSequence = null; messageRows.get(target.sequence)?.article.classList.remove("notification-target"); } }, 4000);
}
function changeGalleryMonth() {
  const state = currentState(), active = panel, value = el("media-month").value;
  if (!state || active?.kind !== "gallery") return;
  let range = null;
  if (value) {
    if (!/^[0-9]{4}-(?:0[1-9]|1[0-2])$/.test(value)) return;
    const [year, month] = value.split("-").map(Number); if (year < 1970 || year > 9998) return;
    range = { from: new Date(year, month - 1, 1).getTime(), until: new Date(year, month, 1).getTime() };
  }
  panelVersion++; panelBusy = false; active.items = []; active.cursor = null; active.hasMore = false; active.range = range;
  renderMediaPanel(); void loadMediaPage();
}

function dateParameter(value, long = false, year = false) {
  return ui.dateParam(value, long ? { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
}
function renderInbox({ restoreFocus = true } = {}) {
  const container = el("conversations");
  const focused = [...container.children].find((button) => button.contains(document.activeElement));
  const focusedId = focused?.dataset.conversationId;
  for (const avatar of container.querySelectorAll(".peer-avatar")) avatarContainers.delete(avatar);
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
    const avatar = document.createElement("span"); avatar.className = "peer-avatar"; avatar.setAttribute("aria-hidden", "true");
    button.append(avatar, text); renderPeerAvatar(avatar, conversation);
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
  followupUI?.update(state?.conversation ?? null);
  conversationDownload?.update();
  const conversation = state.conversation; if (!conversation) return;
  ui.rawText(el("peer-name"), crm?.displayName(inbox.get(state.id) ?? conversation) ?? conversation.peerName);
  renderPeerAvatar(el("peer-avatar"), conversation);
  ui.text(el("conversation-status"), conversation.closedAt != null ? "Conversation fermée · historique disponible" : !conversation.canSend ? "Accès à l’envoi suspendu · historique disponible" : "Conversation privée");
  el("message-body").disabled = !conversation.canSend || Boolean(state.pending) || sendBusy || Boolean(state.photoBatch?.started);
  const hasImage = Boolean(state.imageDraft || state.pending?.kind === "image" || state.photoBatch?.items.length);
  const hasVideo = Boolean(state.videoDraft || state.pending?.kind === "video");
  ui.text(el("send"), state.photoBatch?.started ? "Réessayer les photos restantes" : "Envoyer");
  el("send").disabled = !conversation.canSend || Boolean(state.pending) || sendBusy || !(hasImage || hasVideo ? validCaption(el("message-body").value) : validBody(el("message-body").value))
    || hasVideo && (!videoCreationEnabled || state.videoDraft?.invalid || !state.videoDraft?.ready && !state.pending?.videoId);
  el("photo-tools").hidden = !mediaEnabled && !videoCreationEnabled && role !== "admin"; el("open-gallery").hidden = !mediaEnabled;
  el("open-video-gallery").hidden = !videoEnabled;
  el("open-composer-tools").hidden = !mediaEnabled && !videoCreationEnabled && role !== "admin";
  el("open-composer-tools").disabled = !conversation.canSend || Boolean(state.pending) || sendBusy;
  if (el("open-composer-tools").hidden || el("open-composer-tools").disabled) closeComposerTools();
  for (const id of ["pick-image", "open-library"]) el(id).hidden = !mediaEnabled;
  el("pick-video").hidden = role !== "admin" || !videoCreationEnabled; el("pick-video").disabled = !conversation.canSend || Boolean(state.pending) || sendBusy || Boolean(state.photoBatch?.started);
  el("open-quick-replies").hidden = role !== "admin";
  el("open-quick-replies").disabled = !canUseQuickReplies();
  if (quickReplyContext && (!canUseQuickReplies() || !fresh(quickReplyContext.ticket))) closeQuickReplies();
  el("open-emojis").disabled = !canUseEmojis();
  if (emojiContext && (!canUseEmojis() || !fresh(emojiContext.ticket))) closeEmojis();
  for (const id of ["pick-image", "open-library"]) el(id).disabled = !conversation.canSend || Boolean(state.pending) || sendBusy || Boolean(state.photoBatch?.started);
  renderImageDraft(state);
  renderVideoDraft(state);
  if (!drafts.write(state) && state.draft.length) {
    ui.text(el("composer-help"), "Ce navigateur ne peut pas garder ce brouillon après rechargement. Il reste dans cet onglet.");
    el("composer-help").classList.remove("sr-only");
  }
  resizeComposer();
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
  const video = message.video;
  return JSON.stringify([message.id, message.sequence, message.sender, message.body, message.createdAt, message.deletedAt,
    media ? [media.id, media.width, media.height, media.thumbnailWidth, media.thumbnailHeight, media.fullUrl, media.thumbnailUrl, mediaEnabled] : null,
    video ? [video.id, video.bytes, video.mime, video.contentUrl, videoEnabled] : null]);
}
function createMessageRow(state, message, contentKey) {
  const own = message.sender === "me"; const fromJessie = role === "admin" ? own : !own;
  const article = document.createElement("article"); article.className = `message ${own ? "own" : ""} ${fromJessie ? "from-jessie" : "from-client"}`; article.dataset.sequence = message.sequence; article.dataset.sender = message.sender; article.setAttribute("role", "listitem");
  const body = document.createElement((message.media || message.video) && message.deletedAt == null ? "div" : "p"); body.className = "bubble"; article.classList.toggle("deleted", message.deletedAt != null);
  const row = { article, contentKey, body, meta: null, detailsToggle: null, time: null, remove: null, photoButton: null, receipt: null, photo: null, mediaVersion: null };
  if (message.video && message.deletedAt == null) {
    body.classList.add("video-message");
    if (videoEnabled && validVideoUrl(message.video.contentUrl, state, message.id)) {
      row.video = privateVideoElement(); body.append(row.video);
      const error = document.createElement("p"); error.className = "video-error"; error.hidden = true; body.append(error);
    } else { const unavailable = document.createElement("p"); ui.text(unavailable, "Vidéos indisponibles pour le moment"); body.append(unavailable); }
    if (message.body) { const caption = document.createElement("p"); caption.className = "photo-caption"; ui.rawText(caption, message.body); body.append(caption); }
  } else if (message.media && message.deletedAt == null) {
    body.classList.add("photo-message"); const photo = document.createElement("button"); photo.type = "button"; photo.className = "photo-open"; photo.style.aspectRatio = `${message.media.thumbnailWidth}/${message.media.thumbnailHeight}`; ui.attr(photo, "aria-label", "Agrandir la photo de ce message");
    row.photoButton = photo;
    if (mediaEnabled) {
      photo.addEventListener("click", () => { void openLightbox({ media: message.media, messageId: message.id, sequence: message.sequence, createdAt: message.createdAt }, state, photo); });
      row.photo = photo;
    } else { ui.text(photo, "Photos indisponibles pour le moment"); photo.disabled = true; }
    body.append(photo); if (message.body) { const caption = document.createElement("p"); caption.className = "photo-caption"; ui.rawText(caption, message.body); body.append(caption); }
  } else if (message.deletedAt != null) ui.text(body, "Message supprimé"); else ui.rawText(body, message.body);
  article.append(body);
  const meta = document.createElement("div"); meta.className = "message-meta"; meta.id = `message-details-${message.sequence}`; meta.hidden = true; row.meta = meta;
  const detailsToggle = document.createElement("button"); detailsToggle.type = "button"; detailsToggle.className = "message-details-toggle";
  ui.text(detailsToggle, "Détails"); detailsToggle.setAttribute("aria-expanded", "false"); detailsToggle.setAttribute("aria-controls", meta.id);
  ui.attr(detailsToggle, "aria-label", "Détails du message du {date}", { date: dateParameter(message.createdAt, true) });
  detailsToggle.addEventListener("click", () => toggleMessageDetails(state, message, row)); row.detailsToggle = detailsToggle;
  body.addEventListener("click", event => {
    if (event.defaultPrevented || event.target.closest("a,button,input,textarea,select,label,video,audio")
      || hasSelectedMessageText(article)) return;
    toggleMessageDetails(state, message, row);
  });
  article.append(detailsToggle);
  const time = document.createElement("time"); time.dateTime = new Date(message.createdAt).toISOString(); ui.text(time, "{date}", { date: dateParameter(message.createdAt, true) }); row.time = time; meta.append(time);
  if (own && message.deletedAt == null) {
    row.receipt = document.createElement("span"); meta.append(row.receipt);
    if (role === "admin") {
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-message"; ui.text(remove, "Supprimer"); ui.attr(remove, "aria-label", "Supprimer mon message du {date}", { date: dateParameter(message.createdAt, true) });
      remove.addEventListener("click", () => { void deleteMessage(state, message, remove); }); row.remove = remove; meta.append(remove);
    }
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
  // Keep tombstones in state for event cursors and idempotent merging. They
  // have no row in the client view, including after a late history response.
  const messages = orderedMessages(state).filter(message => role === "admin" || message.deletedAt == null);
  const container = el("messages"); const photos = [];
  const retained = new Set(messages.map((message) => message.sequence));
  for (const [key, row] of messageRows) if (!retained.has(key)) {
    if (selectedMessageSequence === key) clearMessageSelection();
    releaseVideoPlayer(row.video); row.article.remove(); messageRows.delete(key);
  }
  for (const [index, message] of messages.entries()) {
    const contentKey = messageContentKey(message); let row = messageRows.get(message.sequence);
    if (!row || row.contentKey !== contentKey) {
      if (selectedMessageSequence === message.sequence) clearMessageSelection();
      releaseVideoPlayer(row?.video); row?.article.remove();
      row = createMessageRow(state, message, contentKey); messageRows.set(message.sequence, row);
    }
    row.article.classList.toggle("notification-target", state.notificationSequence === message.sequence);
    showMessageDetails(row, selectedMessageSequence === message.sequence);
    ui.text(row.detailsToggle, "Détails");
    ui.attr(row.detailsToggle, "aria-label", "Détails du message du {date}", { date: dateParameter(message.createdAt, true) });
    ui.text(row.time, "{date}", { date: dateParameter(message.createdAt, true) });
    if (message.deletedAt != null) ui.text(row.body, "Message supprimé");
    if (row.remove) { ui.text(row.remove, "Supprimer"); ui.attr(row.remove, "aria-label", "Supprimer mon message du {date}", { date: dateParameter(message.createdAt, true) }); }
    if (row.photoButton) { ui.attr(row.photoButton, "aria-label", "Agrandir la photo de ce message"); if (!mediaEnabled) ui.text(row.photoButton, "Photos indisponibles pour le moment"); }
    if (row.video && row.videoVersion !== videoVersion) {
      row.videoVersion = videoVersion;
      attachPrivateVideo(row.video, message.video, state, message.id, () => messageRows.get(message.sequence) === row && state.messages.get(message.sequence)?.deletedAt == null);
    }
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
    notice(pending.kind === "image" ? "Photo enregistrée." : pending.kind === "video" ? "Vidéo enregistrée." : "Message enregistré.");
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
  clearChat(); el("workspace").classList.add("selected"); document.querySelector(".page").classList.add("has-conversation"); el("message-body").value = state.draft;
  ui.rawText(el("peer-name"), inbox.get(id)?.peerName ?? "Jessie"); ui.text(el("conversation-status"), "Chargement de la conversation…");
  renderInbox({ restoreFocus: !focus });
  if (focus) focusVisible(el("message-scroll"));
  let moreHistory = false;
  try {
    if (state.messages.size || state.conversation) { renderMessages(state, { initial: true }); moreHistory = await fetchEvents(state); }
    else {
      const anchor = target ? `&after=${(BigInt(target.sequence) - 1n).toString()}` : "";
      const result = await request(`${conversationPath(state)}/messages?limit=50${anchor}`, { state });
      const recovered = state.draftHydrated ? null : drafts.read(state.id);
      state.draftHydrated = true;
      if (recovered && !state.draft && !state.pending && !state.imageDraft && !state.videoDraft) {
        state.draft = recovered.text;
        if (recovered.pending) state.pending = { clientMessageId: recovered.pending.clientMessageId, body: recovered.text, status: "retry" };
      }
      mergeMessagePage(state, result);
      el("message-body").value = state.draft;
      state.eventCursor = sequence(result.eventCursor); state.hasMoreBefore = result.hasMoreBefore; state.nextBefore = result.nextBefore;
      state.hasMoreAfter = result.hasMoreAfter === true; state.nextAfter = result.nextAfter ?? null;
      inbox.set(id, result.conversation);
      renderMessages(state, { initial: true });
      if (recovered && state.pending) notice("Un envoi reste à confirmer. Réessaie cet envoi pour reprendre la même demande.");
      else if (recovered && state.draft) notice(recovered.hadAttachment ? "Ton brouillon texte a été retrouvé. Ajoute à nouveau les pièces jointes." : "Ton brouillon texte a été retrouvé.");
    }
    if (!moreHistory) armMessageAnnouncement(state); schedulePolling(moreHistory ? 300 : retryDelay);
  } catch (error) { await handleError(error, state); }
  finally { if (belongsTo(currentState(), state.id, state.epoch)) { selectionLoading = false; if (state.conversation) renderMeta(state); schedulePolling(moreHistory ? 300 : retryDelay); } }
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
  if (role === "client" && message.deletedAt != null) {
    focusVisible(el("message-scroll"));
    return true;
  }
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
    void announcementUI?.refresh();
    retryDelay = 3000; notice("");
  } catch (error) { if (!error.stale) { retryDelay = Math.min(30000, retryDelay * 2); await handleError(error, currentState()); } }
  finally { if (cycle === pollEpoch) { cycleRunning = false; if (fresh(ticket)) schedulePolling(catchup ? 300 : retryDelay); } }
}
function newClientId() { return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function sendMessage(retry = false) {
  if (currentState()?.photoBatch?.items.length) { await sendPhotoSelection(); return; }
  const state = currentState(); if (!state || sendBusy || !state.conversation?.canSend || (retry && !state.pending) || (!retry && state.pending)) return;
  const reply = {}; captureReply(state, reply);
  if (state.hasMoreAfter && (!await loadNewer({ latest: true }) || state !== currentState() || (retry && !state.pending))) return;
  if ((retry && state.pending?.kind === "video") || (!retry && state.videoDraft)) { await sendVideo(retry, reply); return; }
  if ((retry && state.pending?.kind === "image") || (!retry && state.imageDraft)) { await sendImage(retry, reply); return; }
  const ticket = snapshot(state);
  const body = retry ? state.pending?.body : el("message-body").value;
  if (!validBody(body)) { notice("Écris un message de 1 à 4 096 caractères.", true); return; }
  const pending = prepareSend(state, body, state.pending?.clientMessageId ?? newClientId());
  if (!Object.hasOwn(pending, "replyThrough")) Object.assign(pending, reply);
  captureReply(state, pending);
  state.draft = body;
  if (!drafts.beforeSend(state).safeToSend) { retrySend(state); renderMeta(state); notice("Cet envoi n’a pas commencé. Réessaie sans recharger la page pour conserver ton brouillon.", true); return; }
  state.draft = body; sendBusy = true; renderMeta(state); notice("Envoi en cours…");
  try {
    const result = await request(`${conversationPath(state)}/messages`, { state, mutation: true, body: { clientMessageId: pending.clientMessageId, body: pending.body, ...replyFields(pending) } });
    mergeMessages(state, [result.message]);
    state.conversation.latestSequence = maxSequence(state.conversation.latestSequence, result.message.sequence);
    state.draft = ""; el("message-body").value = ""; renderMessages(state, { ownSend: true }); notice("Message enregistré."); schedulePolling(300);
  } catch (error) {
    // An event may have acknowledged this request while its HTTP response was lost.
    if (!error.stale && state.pending && !rejectPendingSend(state, error.status)) retrySend(state);
    await handleError(error, state);
  } finally { if (fresh(ticket)) { sendBusy = false; renderMeta(state); } }
}
async function sendImage(retry = false, reply = null) {
  const state = currentState(); if (!state || sendBusy || !mediaEnabled || !state.conversation?.canSend) return;
  const ticket = snapshot(state); const caption = retry ? state.pending?.caption : el("message-body").value;
  if (!validCaption(caption)) { notice("Ajoute une légende de 1 000 caractères maximum, ou laisse le champ vide.", true); return; }
  const draft = state.imageDraft;
  const pending = prepareImageSend(state, { caption, mediaId: retry ? state.pending?.mediaId : draft?.asset?.id ?? null, file: retry ? state.pending?.file : draft?.file ?? null }, state.pending?.clientMessageId ?? newClientId());
  if (reply && !Object.hasOwn(pending, "replyThrough")) Object.assign(pending, reply);
  captureReply(state, pending);
  state.draft = caption;
  if (!drafts.beforeSend(state).safeToSend) { retrySend(state); renderMeta(state); notice("Cet envoi n’a pas commencé. Réessaie sans recharger la page pour conserver ton brouillon.", true); return; }
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
    const result = await request(`${mediaBase}/conversations/${state.id}/messages`, { state, mutation: true, body: { clientMessageId: pending.clientMessageId, mediaId: pending.mediaId, caption: pending.caption, ...replyFields(pending) } });
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
async function sendVideo(retry = false, reply = null) {
  const state = currentState(); if (!state || sendBusy || !videoCreationEnabled || !state.conversation?.canSend) return;
  const ticket = snapshot(state), caption = retry ? state.pending?.caption : el("message-body").value;
  if (!validCaption(caption)) { notice("Ajoute une légende de 1 000 caractères maximum, ou laisse le champ vide.", true); return; }
  if (!retry && (!state.videoDraft?.ready || state.videoDraft.invalid)) return;
  const pending = prepareVideoSend(state, { caption, videoId: retry ? state.pending?.videoId : null,
    file: retry ? state.pending?.file : state.videoDraft?.file }, state.pending?.clientMessageId ?? newClientId());
  if (reply && !Object.hasOwn(pending, "replyThrough")) Object.assign(pending, reply);
  captureReply(state, pending);
  state.draft = caption;
  if (!drafts.beforeSend(state).safeToSend) { retrySend(state); renderMeta(state); notice("Cet envoi n’a pas commencé. Réessaie sans recharger la page pour conserver ton brouillon.", true); return; }
  const transfer = { controller: new AbortController(), state, pending, cancelled: false };
  videoTransfer = transfer; controllers.add(transfer.controller); el("video-progress").value = 0;
  state.draft = caption; sendBusy = true; renderMeta(state);
  notice(pending.videoId ? "Envoi de la vidéo…" : "Transfert de la vidéo…");
  try {
    if (!pending.videoId) {
      const result = await uploadVideo(pending.file, state, transfer);
      if (!fresh(ticket) || transfer.cancelled || transfer.controller.signal.aborted || state.pending !== pending) return;
      if (!completeVideoUpload(state, pending.clientMessageId, result.id)) return;
      renderMeta(state);
    }
    if (transfer.cancelled || transfer.controller.signal.aborted || !fresh(ticket)) return;
    const result = await request(videoBase + "/conversations/" + state.id + "/messages", { state, mutation: true,
      body: { clientMessageId: pending.clientMessageId, videoId: pending.videoId, caption: pending.caption, ...replyFields(pending) } });
    mergeMessages(state, [result.message]); state.conversation.latestSequence = maxSequence(state.conversation.latestSequence, result.message.sequence);
    state.draft = ""; state.videoDraft = null; el("message-body").value = ""; renderMessages(state, { ownSend: true });
    notice("Vidéo enregistrée."); schedulePolling(300);
  } catch (error) {
    if (transfer.cancelled && fresh(ticket) && state.pending === pending && pending.stage === "uploading") {
      state.pending = null; notice("Transfert arrêté. La vidéo reste dans ton brouillon.");
    } else if (!error.stale && state.pending) {
      if (!rejectPendingVideoSend(state, error.status)) retrySend(state);
      if ([401, 403].includes(error.status)) await handleError(error, state);
      else notice(videoErrorText(error), true);
    }
  } finally {
    controllers.delete(transfer.controller);
    if (videoTransfer === transfer) videoTransfer = null;
    if (fresh(ticket)) { sendBusy = false; renderMeta(state); }
  }
}

async function deleteMessage(state, message, button) {
  if (role !== "admin" || !belongsTo(currentState(), state.id, state.epoch) || button.disabled) return;
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
  const logoutCsrf = csrf; clearPrivate({ purgeDrafts: true }); csrf = logoutCsrf;
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
  dismissComposerKeyboard();
  try { await sendMessage(retry); }
  finally {
    if (!touchKeyboard() && restoreFocus && state && fresh(ticket) && state === currentState() && !state.pending && state.draft === ""
      && el("message-body").value === "" && focusWasLost(button)) focusVisible(el("message-body"));
  }
}
function canUseQuickReplies() {
  const state = currentState();
  return role === "admin" && ready && visible() && !loggingOut && !logoutBusy && !selectionLoading && !sendBusy
    && Boolean(sessionOwner && state?.conversation?.canSend && !state.pending);
}
function canUseEmojis() {
  const state = currentState();
  return ready && visible() && !loggingOut && !logoutBusy && !selectionLoading && !sendBusy
    && Boolean(sessionOwner && state?.conversation?.canSend && !state.pending);
}
function closeEmojis(restoreFocus = false, compose = false) {
  emojiContext = null; emojiCategory = "all";
  if (el("emoji-dialog").open) el("emoji-dialog").close();
  for (const id of ["emoji-categories", "emoji-list"]) { ui.forget(el(id)); el(id).replaceChildren(); }
  notice("", false, "emoji-status");
  if (restoreFocus) focusVisible(el(compose && !touchKeyboard() ? "message-body" : "open-emojis"));
}
function renderEmojis(rebuildCategories = false) {
  if (!emojiContext) return;
  const capturedContext = emojiContext;
  const language = ui.getLanguage() === "en" ? "en" : "fr";
  const focused = document.activeElement, focusedEmoji = focused?.dataset?.emojiId, focusedCategory = focused?.dataset?.emojiCategory;
  if (rebuildCategories) {
    ui.forget(el("emoji-skin-tone")); el("emoji-skin-tone").replaceChildren();
    for (const tone of emojiSkinTones(language)) {
      const option = document.createElement("option"); option.value = tone.id;
      ui.rawText(option, `${tone.text} ${tone.label}`); el("emoji-skin-tone").append(option);
    }
    el("emoji-skin-tone").value = emojiSkinTone;
    ui.forget(el("emoji-categories")); el("emoji-categories").replaceChildren();
    for (const category of emojiCategories(language)) {
      const button = document.createElement("button"); button.type = "button"; button.className = "emoji-category";
      button.dataset.emojiCategory = category.id; ui.rawText(button, category.label);
      button.addEventListener("click", () => { if (emojiContext === capturedContext && button.isConnected) { emojiCategory = category.id; renderEmojis(); } });
      el("emoji-categories").append(button);
    }
  }
  for (const button of el("emoji-categories").children) button.setAttribute("aria-pressed", String(button.dataset.emojiCategory === emojiCategory));
  const selectedSkinTone = emojiSkinTone;
  const choices = emojiOptions(language, { category: emojiCategory, skinTone: selectedSkinTone });
  ui.forget(el("emoji-list")); el("emoji-list").replaceChildren();
  for (const choice of choices) {
    const button = document.createElement("button"); button.type = "button"; button.className = "emoji-choice";
    button.dataset.emojiId = choice.id; button.setAttribute("aria-label", choice.label); button.title = choice.label; ui.rawText(button, choice.text);
    button.addEventListener("click", () => {
      const context = emojiContext, state = currentState();
      if (context !== capturedContext || !button.isConnected) return;
      if (!context || !canUseEmojis() || !fresh(context.ticket) || context.owner !== sessionOwner.id || context.csrf !== csrf
        || context.draft !== el("message-body").value) { closeEmojis(); return; }
      try {
        const result = insertEmoji(context.draft, choice.id, { start: context.start, end: context.end, image: Boolean(state.imageDraft || state.videoDraft), skinTone: selectedSkinTone });
        el("message-body").value = result.value; state.draft = result.value; closeEmojis(true, true); renderMeta(state);
        el("message-body").setSelectionRange?.(result.caret, result.caret);
        notice("Emoji ajouté au brouillon. Relis le message avant de l’envoyer.");
      } catch {
        notice("Cet emoji ne peut pas être ajouté. Raccourcis le brouillon puis réessaie.", true, "emoji-status");
      }
    });
    el("emoji-list").append(button);
  }
  notice("", false, "emoji-status");
  if (focusedEmoji) focusVisible([...el("emoji-list").children].find(button => button.dataset.emojiId === focusedEmoji) ?? el("close-emojis"));
  else if (rebuildCategories && focusedCategory) focusVisible([...el("emoji-categories").children].find(button => button.dataset.emojiCategory === focusedCategory));
}
el("open-emojis").addEventListener("click", () => {
  dismissComposerKeyboard(); closeChatMenu(); closeComposerTools();
  if (!canUseEmojis()) return;
  closeQuickReplies();
  const textarea = el("message-body"), draft = textarea.value;
  const start = Number.isInteger(textarea.selectionStart) ? textarea.selectionStart : draft.length;
  const end = Number.isInteger(textarea.selectionEnd) ? textarea.selectionEnd : start;
  emojiContext = { ticket: snapshot(currentState()), owner: sessionOwner.id, csrf, draft, start, end };
  emojiCategory = "all"; renderEmojis(true);
  el("emoji-dialog").showModal(); focusVisible(el("close-emojis"));
});
el("emoji-skin-tone").addEventListener("change", () => {
  if (!emojiContext) return;
  const tone = el("emoji-skin-tone").value;
  if (emojiSkinTones("fr").some((option) => option.id === tone)) { emojiSkinTone = tone; renderEmojis(); }
});
el("emoji-list").addEventListener("keydown", (event) => {
  const buttons = [...el("emoji-list").children], index = buttons.indexOf(document.activeElement);
  if (index < 0 || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  const width = buttons[0]?.getBoundingClientRect().width;
  const columns = Number.isFinite(width) && width > 0 ? Math.max(1, Math.round(el("emoji-list").clientWidth / (width + 6))) : 1;
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.min(buttons.length - 1,
    Math.max(0, index + (event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -columns : columns)));
  event.preventDefault(); focusVisible(buttons[next]);
});
el("close-emojis").addEventListener("click", () => closeEmojis(true));
el("open-profile").addEventListener("click", () => { dismissComposerKeyboard(); closeChatMenu(); closeEmojis(); closeQuickReplies(); closeComposerTools(); });
el("emoji-dialog").addEventListener("close", () => { if (emojiContext && !el("emoji-dialog").open) closeEmojis(true); });
ui.onChange(() => { if (emojiContext) renderEmojis(true); });
function quickRepliesCurrent(context = quickReplyContext) {
  return Boolean(context && context === quickReplyContext && canUseQuickReplies() && fresh(context.ticket)
    && context.owner === sessionOwner.id && context.csrf === csrf);
}
function closeQuickReplies(restoreFocus = false, compose = false) {
  quickReplyContext = null; personalReplyAbort?.abort(); personalReplyAbort = null;
  personalReplies = null; personalReplyDraft = null; personalReplyBusy = null; personalReplyConflict = false; personalReplyUncertain = false; personalReplyDelete = null;
  if (el("quick-replies-dialog").open) el("quick-replies-dialog").close();
  ui.forget(el("quick-replies-list")); el("quick-replies-list").replaceChildren();
  for (const id of ["personal-reply-title", "personal-reply-body"]) el(id).value = "";
  el("personal-reply-language").value = "fr"; el("personal-reply-editor").hidden = true;
  notice("", false, "quick-replies-status"); notice("", false, "personal-replies-status");
  if (restoreFocus) { if (compose) focusComposer(); else focusVisible(el("open-composer-tools")); }
}
function insertQuickReply(text) {
  const context = quickReplyContext, state = currentState();
  if (!quickRepliesCurrent(context)) { closeQuickReplies(); return; }
  if (personalReplyDraft || personalReplyBusy === "write") return;
  const draft = el("message-body").value, value = draft + (draft && !draft.endsWith("\n") ? "\n" : "") + text;
  if (!(state.imageDraft || state.videoDraft ? validCaption(value) : validBody(value))) {
    notice("Cette réponse ne peut pas être ajoutée. Raccourcis ou corrige le brouillon puis réessaie.", true, "quick-replies-status"); return;
  }
  el("message-body").value = value; state.draft = value; closeQuickReplies(true, true); renderMeta(state);
  el("message-body").setSelectionRange?.(value.length, value.length);
  notice("Réponse ajoutée au brouillon. Relis le message avant de l’envoyer.");
}
function validPersonalReplyTitle(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 64 && value.isWellFormed() && value.trim() === value
    && !/^[\p{C}\p{Z}]+$/u.test(value) && !/[\x00-\x1f\x7f-\x9f]/u.test(value);
}
function personalReplyView(value) {
  if (!value || value.writable !== undefined && typeof value.writable !== "boolean" || typeof value.version !== "string" || (!/^(0|[1-9][0-9]{0,9})$/.test(value.version) || Number(value.version) > 4294967295) || !Array.isArray(value.replies) || value.replies.length > 50) throw new Error("invalid_quick_replies");
  const ids = new Set(), replies = value.replies.map(reply => {
    if (!reply || !/^[0-9a-f]{32}$/.test(reply.id) || ids.has(reply.id) || !validPersonalReplyTitle(reply.title) || !validBody(reply.body) || !["fr", "en"].includes(reply.language)) throw new Error("invalid_quick_replies");
    ids.add(reply.id); return { id: reply.id, title: reply.title, body: reply.body, language: reply.language };
  });
  if (new TextEncoder().encode(JSON.stringify(replies)).length > 32768) throw new Error("invalid_quick_replies");
  return { version: value.version, replies, writable: value.writable !== false };
}
function personalReplyControls() {
  const blocked = Boolean(personalReplyBusy || personalReplyConflict || personalReplyUncertain || !personalReplies || !personalReplies.writable);
  el("new-personal-reply").hidden = personalReplies?.writable === false;
  el("new-personal-reply").disabled = blocked || Boolean(personalReplyDraft) || personalReplies.replies.length >= 50;
  el("reload-personal-replies").disabled = Boolean(personalReplyBusy);
  el("personal-reply-save").disabled = blocked; el("personal-reply-save").hidden = personalReplies?.writable === false;
  el("personal-reply-cancel").disabled = Boolean(personalReplyBusy);
  for (const id of ["personal-reply-title", "personal-reply-body"]) { el(id).disabled = Boolean(personalReplyBusy); el(id).readOnly = personalReplies?.writable === false; }
  el("personal-reply-language").disabled = Boolean(personalReplyBusy) || personalReplies?.writable === false;
  for (const button of el("quick-replies-list").querySelectorAll(".quick-reply")) button.disabled = Boolean(personalReplyDraft || personalReplyBusy === "write");
}
function personalReplyAction(source, handler, marker) {
  const button = document.createElement("button"); button.type = "button"; button.className = "text-button"; ui.text(button, source);
  if (marker) button.dataset.personalAction = marker;
  button.disabled = Boolean(personalReplyBusy || personalReplyConflict || personalReplyUncertain || personalReplyDraft || !personalReplies?.writable);
  button.addEventListener("click", () => { if (quickRepliesCurrent() && !button.disabled) handler(); }); return button;
}
function renderQuickReplies() {
  const list = el("quick-replies-list");
  if (list.querySelector("[data-quick-reply]")?.lang !== quickReplyLanguage) {
    ui.forget(list); list.replaceChildren();
    for (const reply of quickReplyOptions(quickReplyLanguage)) {
      const button = document.createElement("button"); button.type = "button"; button.className = "quick-reply";
      button.dataset.quickReply = reply.id; button.lang = quickReplyLanguage; ui.rawText(button, reply.text);
      button.disabled = Boolean(personalReplyDraft || personalReplyBusy === "write");
      button.addEventListener("click", () => insertQuickReply(reply.text)); list.append(button);
    }
  } else {
    for (const row of list.querySelectorAll(".personal-reply-row")) { ui.forget(row); row.remove(); }
  }
  for (const reply of personalReplies?.replies ?? []) {
    if (reply.language !== quickReplyLanguage) continue;
    const row = document.createElement("div"); row.className = "personal-reply-row"; row.dataset.personalId = reply.id;
    row.setAttribute("role", "group"); row.setAttribute("aria-label", reply.title);
    const insert = document.createElement("button"); insert.type = "button"; insert.className = "quick-reply personal-reply-insert"; insert.lang = reply.language;
    insert.dataset.personalQuickReply = reply.id; insert.disabled = Boolean(personalReplyDraft || personalReplyBusy === "write");
    ui.rawText(insert, reply.body);
    insert.addEventListener("click", () => insertQuickReply(reply.body)); row.append(insert);
    const actions = document.createElement("div"); actions.className = "personal-reply-actions"; actions.hidden = personalReplies.writable === false;
    actions.append(personalReplyAction("Modifier", () => editPersonalReply(reply), "edit"), personalReplyAction("Supprimer", () => { personalReplyDelete = reply.id; renderQuickReplies(); focusVisible(el("quick-replies-list").querySelector(".personal-reply-confirm")?.querySelector("button")); }, "delete"));
    row.append(actions);
    if (personalReplyDelete === reply.id) {
      const confirmation = document.createElement("div"), prompt = document.createElement("p"); ui.text(prompt, "Supprimer cette réponse personnelle ?");
      confirmation.className = "personal-reply-confirm"; confirmation.append(prompt,
        personalReplyAction("Confirmer la suppression", () => { void savePersonalReplies(personalReplies.replies.filter(value => value.id !== reply.id)); }, "confirm-delete"),
        personalReplyAction("Annuler", () => { personalReplyDelete = null; renderQuickReplies(); }, "cancel-delete")); row.append(confirmation);
    }
    list.append(row);
  }
  personalReplyControls();
}
function capturePersonalReplyDraft() {
  if (!personalReplyDraft) return;
  personalReplyDraft.title = el("personal-reply-title").value; personalReplyDraft.body = el("personal-reply-body").value;
  personalReplyDraft.language = el("personal-reply-language").value;
}
function editPersonalReply(reply = null) {
  if (!quickRepliesCurrent() || !personalReplies?.writable || personalReplyBusy || personalReplyConflict || personalReplyUncertain) return;
  personalReplyDraft = reply ? { ...reply } : { id: newClientId(), title: "", body: "", language: quickReplyLanguage };
  personalReplyDelete = null; el("personal-reply-editor").hidden = false;
  el("personal-reply-title").value = personalReplyDraft.title; el("personal-reply-body").value = personalReplyDraft.body; el("personal-reply-language").value = personalReplyDraft.language;
  notice("", false, "personal-replies-status"); renderQuickReplies(); focusVisible(el("personal-reply-title"));
}
function reportPersonalReplyError(error) {
  if (error.status === 401) { signOut(); return; }
  const text = error.status === 400 || error.status === 413 ? "Vérifie la réponse : titre de 1 à 64 caractères, texte de 1 à 4 096 caractères et 50 réponses maximum."
    : "Les réponses personnelles sont momentanément indisponibles. Tu peux utiliser les phrases proposées.";
  notice(text, true, "personal-replies-status");
}
async function loadPersonalReplies() {
  const context = quickReplyContext; if (!quickRepliesCurrent(context) || personalReplyBusy) return;
  capturePersonalReplyDraft(); personalReplyBusy = "load"; const abort = new AbortController(); personalReplyAbort = abort; personalReplyControls();
  try {
    const value = personalReplyView(await request("/api/admin/quick-replies", { account: true, signal: abort.signal }));
    if (!quickRepliesCurrent(context)) return;
    personalReplies = value; personalReplyConflict = false; personalReplyUncertain = false; personalReplyDelete = null;
    notice(!value.writable ? personalReplyDraft ? "Les réponses sont en lecture seule. Ton brouillon est conservé." : "Les réponses personnelles sont en lecture seule." : personalReplyDraft ? "Liste rechargée. Ton brouillon est conservé : vérifie-le puis enregistre." : "", false, "personal-replies-status");
  } catch (error) { if (quickRepliesCurrent(context) && !error.stale) reportPersonalReplyError(error); }
  finally { if (quickRepliesCurrent(context)) { personalReplyBusy = null; personalReplyAbort = null; renderQuickReplies(); } }
}
async function savePersonalReplies(replies) {
  const context = quickReplyContext; if (!quickRepliesCurrent(context) || !personalReplies?.writable || personalReplyBusy || personalReplyConflict || personalReplyUncertain) return;
  if (replies.length > 50 || new TextEncoder().encode(JSON.stringify(replies)).length > 32768) {
    notice("Vérifie la réponse : titre de 1 à 64 caractères, texte de 1 à 4 096 caractères et 50 réponses maximum.", true, "personal-replies-status"); return;
  }
  const command = { expectedVersion: personalReplies.version, replies }; personalReplyBusy = "write";
  const abort = new AbortController(); personalReplyAbort = abort; renderQuickReplies(); notice("Enregistrement…", false, "personal-replies-status");
  try {
    const value = personalReplyView(await request("/api/admin/quick-replies", { account: true, mutation: true, body: command, signal: abort.signal }));
    if (!quickRepliesCurrent(context)) return;
    personalReplies = value; personalReplyDraft = null; personalReplyDelete = null; el("personal-reply-editor").hidden = true;
    el("personal-reply-title").value = ""; el("personal-reply-body").value = ""; notice("Réponses personnelles enregistrées.", false, "personal-replies-status");
  } catch (error) {
    if (!quickRepliesCurrent(context) || error.stale) return;
    if (error.status === 409) { personalReplyConflict = true; notice("Les réponses ont changé ailleurs. Ton brouillon est conservé. Recharge la liste avant de réessayer.", true, "personal-replies-status"); }
    else if (!error.status || error.status >= 500 || error.status === 408) {
      personalReplyUncertain = true; notice("La confirmation manque. Recharge les réponses enregistrées avant toute nouvelle modification ; ton brouillon est conservé.", true, "personal-replies-status");
    } else reportPersonalReplyError(error);
  } finally { if (quickRepliesCurrent(context)) { personalReplyBusy = null; personalReplyAbort = null; renderQuickReplies(); } }
}
el("open-quick-replies").addEventListener("click", () => {
  closeComposerTools();
  if (!canUseQuickReplies()) return;
  closeEmojis();
  quickReplyContext = { ticket: snapshot(currentState()), owner: sessionOwner.id, csrf };
  quickReplyLanguage ??= ui.getLanguage() === "en" ? "en" : "fr";
  el("quick-reply-language").value = quickReplyLanguage; renderQuickReplies();
  el("quick-replies-dialog").showModal(); focusVisible(el("quick-reply-language")); void loadPersonalReplies();
});
el("quick-reply-language").addEventListener("change", () => {
  if (!quickRepliesCurrent() || !["fr", "en"].includes(el("quick-reply-language").value)) return;
  quickReplyLanguage = el("quick-reply-language").value; renderQuickReplies(); notice("", false, "quick-replies-status");
});
el("new-personal-reply").addEventListener("click", () => editPersonalReply());
el("reload-personal-replies").addEventListener("click", () => { void loadPersonalReplies(); });
el("personal-reply-cancel").addEventListener("click", () => {
  if (!quickRepliesCurrent() || personalReplyBusy) return;
  personalReplyDraft = null; el("personal-reply-title").value = ""; el("personal-reply-body").value = ""; el("personal-reply-editor").hidden = true;
  renderQuickReplies(); focusVisible(el("new-personal-reply"));
});
for (const id of ["personal-reply-title", "personal-reply-body", "personal-reply-language"]) el(id).addEventListener("input", capturePersonalReplyDraft);
el("personal-reply-editor").addEventListener("submit", event => {
  event.preventDefault(); if (!quickRepliesCurrent() || !personalReplyDraft || !personalReplies?.writable || personalReplyBusy || personalReplyConflict || personalReplyUncertain) return;
  capturePersonalReplyDraft(); const reply = { ...personalReplyDraft, title: personalReplyDraft.title.trim().normalize("NFC") };
  if (!validPersonalReplyTitle(reply.title) || !validBody(reply.body) || !["fr", "en"].includes(reply.language)) {
    notice("Vérifie la réponse : titre de 1 à 64 caractères, texte de 1 à 4 096 caractères et 50 réponses maximum.", true, "personal-replies-status"); return;
  }
  const replies = personalReplies.replies.filter(value => value.id !== reply.id); replies.push(reply); void savePersonalReplies(replies);
});
el("close-quick-replies").addEventListener("click", () => closeQuickReplies(true));
el("quick-replies-dialog").addEventListener("close", () => { if (quickReplyContext && !el("quick-replies-dialog").open) closeQuickReplies(true); });
el("composer").addEventListener("submit", (event) => { event.preventDefault(); void sendWithFocus(false, el("send")); });
el("message-body").addEventListener("input", () => { const state = currentState(); if (state) { state.draft = el("message-body").value; renderMeta(state); } });
el("retry-send").addEventListener("click", () => { void sendWithFocus(true, el("retry-send")); });
el("pick-image").addEventListener("click", () => { if (!el("pick-image").disabled) { closeComposerTools(); el("image-file").click(); focusVisible(el("open-composer-tools")); } });
el("image-file").addEventListener("change", chooseFile);
el("pick-video").addEventListener("click", () => { if (role === "admin" && videoCreationEnabled && !el("pick-video").disabled) { closeComposerTools(); el("video-file").click(); focusVisible(el("open-composer-tools")); } });
el("video-file").addEventListener("change", chooseVideo);
el("cancel-video").addEventListener("click", () => {
  const state = currentState(); if (!state) return;
  if (videoTransfer?.state === state && state.pending?.kind === "video" && state.pending.stage === "uploading") {
    videoTransfer.cancelled = true; videoTransfer.controller.abort(); return;
  }
  if (state.pending || sendBusy) return;
  state.videoDraft = null; revokeVideoPreview(); renderMeta(state); focusComposer();
});
el("open-video-gallery").addEventListener("click", () => { const opener = menuReturnFocus(); closeChatMenu(); void openVideoGallery(opener); });
el("video-gallery-conversation").addEventListener("click", () => { const opener = videoGalleryReturnFocus; void openVideoGallery(opener, "gallery"); });
el("video-gallery-library").addEventListener("click", () => { const opener = videoGalleryReturnFocus; void openVideoGallery(opener, "library"); });
el("close-video-gallery").addEventListener("click", () => closeVideoGallery());
el("video-gallery").addEventListener("close", () => { if (videoGallery && !el("video-gallery").open) closeVideoGallery(); });
el("more-videos").addEventListener("click", () => { void loadVideoGallery(true); });
el("cancel-image").addEventListener("click", () => {
  const state = currentState(), restoreFocus = document.activeElement === el("cancel-image");
  if (state && !state.pending && !sendBusy) {
    state.imageDraft = null; renderMeta(state); notice("Photo retirée de cet envoi.");
    if (restoreFocus && !focusComposer()) focusVisible(el("message-scroll"));
  }
});
el("open-library").addEventListener("click", () => { closeComposerTools(); void openMedia("library", el("open-composer-tools")); });
el("open-gallery").addEventListener("click", () => { const opener = menuReturnFocus(); closeChatMenu(); void openMedia("gallery", opener); });
el("close-media").addEventListener("click", () => closeMedia());
el("photo-batch-clear").addEventListener("click", () => { const state = currentState(); if (state?.photoBatch && !state.photoBatch.started && !sendBusy) { discardPhotoBatch(state); renderMeta(state); focusComposer(); } });
el("media-month").addEventListener("change", changeGalleryMonth);
el("clear-media-date").addEventListener("click", () => { el("media-month").value = ""; changeGalleryMonth(); });
el("previous-photo").addEventListener("click", () => { void navigatePhoto("previous"); });
el("next-photo").addEventListener("click", () => { void navigatePhoto("next"); });
el("photo-message").addEventListener("click", () => { void seePhotoMessage(); });
el("lightbox").addEventListener("keydown", event => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); void navigatePhoto(event.key === "ArrowLeft" ? "previous" : "next"); }
});
el("lightbox-image").addEventListener("touchstart", event => { lightboxTouch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null; }, { passive: true });
el("lightbox-image").addEventListener("touchcancel", () => { lightboxTouch = null; }, { passive: true });
el("lightbox-image").addEventListener("touchend", event => {
  const start = lightboxTouch; lightboxTouch = null;
  if (!start || event.touches.length || event.changedTouches.length !== 1 || (globalThis.visualViewport?.scale ?? 1) > 1.01) return;
  const x = event.changedTouches[0].clientX - start.x, y = event.changedTouches[0].clientY - start.y;
  if (Math.abs(x) > 60 && Math.abs(x) > Math.abs(y) * 2) void navigatePhoto(x > 0 ? "previous" : "next");
}, { passive: true });
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
el("open-notifications").addEventListener("click", () => {
  if (!ready || !visible() || !notificationsPanel) return;
  dismissComposerKeyboard(); closeChatMenu(); void notificationsPanel.refresh?.();
  el("notifications-dialog").showModal(); focusVisible(el("close-notifications"));
});
el("close-notifications").addEventListener("click", () => el("notifications-dialog").close());
el("notifications-dialog").addEventListener("close", () => { focusVisible(menuReturnFocus()); });
for (const id of ["open-account-menu", "open-conversation-menu"]) el(id).addEventListener("click", event => openChatMenu(event.currentTarget));
el("close-chat-menu").addEventListener("click", () => closeChatMenu(true));
el("chat-menu").addEventListener("click", event => {
  if (event.target.closest("a,button") && !el("chat-menu").hidden) closeChatMenu(!document.querySelector("dialog[open]"));
});
el("open-composer-tools").addEventListener("click", () => {
  const button = el("open-composer-tools"); if (button.disabled || button.hidden || !visible()) return;
  if (!el("composer-tools").hidden) { closeComposerTools(true); return; }
  dismissComposerKeyboard(); closeChatMenu(); el("composer-tools").hidden = false; button.setAttribute("aria-expanded", "true"); positionComposerTools();
  focusVisible(el("close-composer-tools"));
});
el("close-composer-tools").addEventListener("click", () => closeComposerTools(true));
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
  if (!el("chat-menu").hidden) { event.preventDefault(); closeChatMenu(true); }
  else if (!el("composer-tools").hidden) { event.preventDefault(); closeComposerTools(true); }
  else if (selectedMessageSequence !== null) { event.preventDefault(); clearMessageSelection(true); }
});
document.addEventListener("click", event => {
  const row = messageRows.get(selectedMessageSequence);
  if (row && !row.article.contains(event.target) && !event.target.closest("dialog")) clearMessageSelection(row.meta.contains(document.activeElement));
});
document.addEventListener("pointerdown", event => {
  if (!el("chat-menu").hidden && !el("chat-menu").contains(event.target)
    && ![el("open-account-menu"), el("open-conversation-menu")].some(button => button.contains(event.target))) closeChatMenu();
  if (!el("composer-tools").hidden && !el("composer-tools").contains(event.target)
    && !el("open-composer-tools").contains(event.target)) closeComposerTools();
});
// Use the visible height only at normal scale. Pinch zoom keeps the browser's
// native viewport; no height threshold is interpreted as a keyboard signal.
if (globalThis.visualViewport) {
  const fitViewport = () => {
    if (visualViewport.scale === 1) document.documentElement.style.setProperty("--chat-viewport-height", `${visualViewport.height}px`);
    else document.documentElement.style.removeProperty("--chat-viewport-height");
    updatePhotoTouchPolicy();
    resizeComposer();
  };
  visualViewport.addEventListener("resize", fitViewport); visualViewport.addEventListener("scroll", positionComposerTools); fitViewport();
}
window.addEventListener("resize", resizeComposer);
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
    clearMessageSelection();
    closeChatMenu(); closeComposerTools();
    closeQuickReplies();
    closeEmojis();
    profileMount = null;
    profileUI?.suspend();
    announcementUI?.suspend(); announcementMount = null;
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
    el("account-link").href = role === "admin" ? "/admin" : "/access"; ui.text(el("account-link"), role === "admin" ? "Accueil admin" : "Mon accès");
    try {
      if (session) {
        const owner = sessionIdentity(session); if (!owner) { signOut(); return; }
        sessionOwner = owner; csrf = session.csrf; sessionCheckedAt = Date.now();
        await drafts.bind(owner);
        if (!fresh(task.ticket, true) || !sameOwner(owner, sessionOwner) || !visible() || loggingOut) throw staleResponse();
        expiryTimer = globalThis.JessieSessionClock.scheduleSessionCheck(session.expiresAt, () => { void resumeConnection(); });
      } else await refreshSession();
      if (!fresh(task.ticket, true) || !visible() || loggingOut) throw staleResponse();
      const capability = await request(`${chatBase}/capabilities`, { account: true });
      if (capability.enabled !== true) throw Object.assign(new Error("chat_disabled"), { status: 404 });
      videoEnabled = capability.video?.enabled === true && capability.video.maxBytes === 104857600 && capability.video.mime === "video/mp4";
      videoCreationEnabled = videoEnabled && capability.video.creationEnabled !== false;
      profileCapability = capability.profile?.enabled === true ? capability.profile : null;
      announcementCapability = capability.announcements?.enabled === true ? capability.announcements : null;
      tasksCapability = role === "admin" && capability.tasks?.enabled === true;
      repliesCapability = role === "admin" && capability.replies?.enabled === true;
      if (!fresh(task.ticket, true) || !visible() || loggingOut) throw staleResponse();
      await refreshMediaCapability();
      if (!fresh(task.ticket, true) || !visible() || loggingOut) throw staleResponse();
      await refreshCrmCapability();
      if (!fresh(task.ticket, true) || !visible() || loggingOut) throw staleResponse();
      el("workspace").classList.toggle("is-admin", role === "admin");
      el("inbox").hidden = role !== "admin"; el("client-aside").hidden = role !== "client"; el("back-to-inbox").hidden = role !== "admin";
      clearChat();
      if (role === "admin") {
        await loadInbox();
        const remembered = drafts.selected();
        if (remembered && !pendingNotification) await selectConversation(remembered);
      }
      else {
        const conversation = await request(`${chatBase}/conversation`, { account: true });
        await selectConversation(conversation.id);
      }
      if (!fresh(task.ticket, true) || !visible() || loggingOut) throw staleResponse();
      ready = true; reconnectAttempt = 0; stopReconnect(); retryConnection(false); el("workspace").hidden = false; notice("", false, "session-status");
      if (currentState()?.conversation) renderMeta(currentState());
      await mountProfile(); await mountFollowup();
      conversationDownloadCapability = capability.conversationExport;
      await mountConversationDownload(conversationDownloadCapability);
      if (!fresh(task.ticket, true) || !visible() || loggingOut) throw staleResponse();
      mountNotificationSettings(); void mountAnnouncements(); scheduleRead(); schedulePolling();
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
