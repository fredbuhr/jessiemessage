import { makeConversationState, belongsTo, orderedMessages, mergeMessages, mergeConversation, mergeEvents, sequence, compareSequence, maxSequence, validBody, prepareSend, retrySend, rejectPendingSend, nearBottom, shouldScroll, readableSequence, inboxRefreshPlan } from "/chat-model.js";

const el = (id) => document.getElementById(id);
const role = location.pathname === "/admin/messages" ? "admin" : location.pathname === "/messages" ? "client" : null;
const sessionBase = role === "admin" ? "/api/auth" : "/api/access";
const chatBase = `/api/chat/${role}`;
const states = new Map(); const inbox = new Map(); const controllers = new Set();
let generation = 0; let visibilityGeneration = 0; let selectionEpoch = 0;
let selected = null; let csrf = null; let ready = false; let expiryTimer = null;
let pollTimer = null; let cycleRunning = false; let retryDelay = 3000; let sessionCheckedAt = 0;
let inboxCursor = null; let inboxMore = false; let inboxLoading = false;
let inboxRefreshCursor = null; let lastInboxRefresh = 0;
let olderBusy = false; let sendBusy = false; let logoutBusy = false; let loggingOut = false; let readBusy = false; let readTimer = null; let selectionLoading = false;
const eventRequests = new Set();

function notice(message, error = false, id = "chat-status") { const node = el(id); node.textContent = message; node.classList.toggle("is-error", error); }
function currentState() { return selected ? states.get(selected) : null; }
function visible() { return document.visibilityState === "visible"; }
function abortRequests() { for (const controller of controllers) controller.abort(); controllers.clear(); }
function stopPolling() { clearTimeout(pollTimer); pollTimer = null; clearTimeout(readTimer); readTimer = null; }
function clearChat() {
  el("messages").replaceChildren(); el("peer-name").textContent = "Messages privés";
  el("conversation-status").textContent = "Choisis une conversation.";
  el("message-body").value = ""; el("message-body").disabled = true; el("send").disabled = true;
  for (const id of ["older-messages", "new-messages", "empty-message", "pending-controls"]) el(id).hidden = true;
  el("workspace").classList.remove("selected"); notice("");
}
function clearPrivate() {
  generation += 1; selectionEpoch += 1; visibilityGeneration += 1; ready = false; csrf = null;
  stopPolling(); abortRequests(); clearTimeout(expiryTimer); expiryTimer = null;
  states.clear(); inbox.clear(); selected = null; el("conversations").replaceChildren(); clearChat();
  inboxCursor = null; inboxMore = false; inboxRefreshCursor = null; lastInboxRefresh = 0; inboxLoading = false;
  el("workspace").hidden = true; el("session-status").textContent = ""; el("inbox-status").textContent = "";
  el("more-conversations").hidden = true;
}
function signOut() { clearPrivate(); location.replace(role === "admin" ? "/admin/login" : "/access"); }
function snapshot(state = null) { return { generation, visibilityGeneration, selectionEpoch, id: state?.id, epoch: state?.epoch }; }
function fresh(ticket) { return ticket.generation === generation && ticket.visibilityGeneration === visibilityGeneration && ticket.selectionEpoch === selectionEpoch && (!ticket.id || belongsTo(currentState(), ticket.id, ticket.epoch)); }
async function request(path, { body, mutation = false, state = null } = {}) {
  const ticket = snapshot(state); const controller = new AbortController(); controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 15000);
  const headers = mutation ? { "Content-Type": "application/json", "X-CSRF-Token": csrf ?? "" } : {};
  try {
    const response = await fetch(path, { method: mutation ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers, body: mutation ? JSON.stringify(body ?? {}) : undefined, signal: controller.signal });
    let data; try { data = await response.json(); } catch { data = {}; }
    if (!fresh(ticket)) throw Object.assign(new Error("stale_response"), { stale: true });
    if (!response.ok) throw Object.assign(new Error("request_failed"), { status: response.status, code: data.error });
    return data;
  } catch (error) {
    if (!fresh(ticket)) throw Object.assign(new Error("stale_response"), { stale: true });
    throw error;
  } finally { clearTimeout(timeout); controllers.delete(controller); }
}
async function refreshSession() {
  const session = await request(`${sessionBase}/session`);
  if (session.user?.role !== role || (role === "client" && session.access?.state !== "active")) { signOut(); throw Object.assign(new Error("access_unavailable"), { stale: true }); }
  csrf = session.csrf; sessionCheckedAt = Date.now();
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(signOut, Math.max(0, session.expiresAt - Date.now()));
  return session;
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
    try { await refreshSession(); notice("Ta connexion a été actualisée. Réessaie ta demande.", true); }
    catch (refreshError) { if (refreshError.status === 401 || refreshError.status === 403) signOut(); else if (!refreshError.stale) notice(errorText(refreshError), true); }
    return;
  }
  if (error.status === 401 || (role === "client" && error.status === 403)) { signOut(); return; }
  if (state && error.status === 404 && belongsTo(currentState(), state.id, state.epoch)) {
    states.delete(state.id); inbox.delete(state.id); selected = null; selectionEpoch += 1; selectionLoading = false; clearChat(); renderInbox(); notice("Cette conversation n’est plus accessible.", true); return;
  }
  if (role === "admin" && error.status === 403) {
    try {
      await refreshSession();
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
function dateText(value, long = false) {
  return new Date(value).toLocaleString("fr-FR", long ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
}
function renderInbox() {
  const container = el("conversations"); container.replaceChildren();
  for (const conversation of [...inbox.values()].sort((a, b) => (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt) || a.id.localeCompare(b.id))) {
    const button = document.createElement("button"); button.type = "button"; button.className = "contact";
    button.classList.toggle("active", conversation.id === selected); button.setAttribute("aria-pressed", String(conversation.id === selected));
    const text = document.createElement("span"); const name = document.createElement("strong"); name.textContent = conversation.peerName;
    const time = document.createElement("time"); time.dateTime = new Date(conversation.lastActivityAt ?? conversation.createdAt).toISOString(); time.textContent = dateText(conversation.lastActivityAt ?? conversation.createdAt, true);
    text.append(name, time); button.append(text);
    if (conversation.unreadCount > 0) { const count = document.createElement("span"); count.className = "unread"; count.textContent = String(conversation.unreadCount); count.setAttribute("aria-label", `${conversation.unreadCount} messages non lus`); button.append(count); }
    button.addEventListener("click", () => { void selectConversation(conversation.id); }); container.append(button);
  }
  el("inbox-status").textContent = inbox.size ? "" : "Aucune conversation pour le moment.";
  el("more-conversations").hidden = !inboxMore; el("more-conversations").disabled = inboxLoading;
}
async function loadInbox(more = false, refresh = false) {
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
  el("peer-name").textContent = conversation.peerName;
  el("conversation-status").textContent = conversation.closedAt != null ? "Conversation fermée · historique disponible" : !conversation.canSend ? "Accès à l’envoi suspendu · historique disponible" : "Conversation privée";
  el("message-body").disabled = !conversation.canSend || Boolean(state.pending) || sendBusy;
  el("send").disabled = !conversation.canSend || Boolean(state.pending) || sendBusy || !validBody(el("message-body").value);
  el("pending-controls").hidden = state.pending?.status !== "retry";
  el("retry-send").disabled = !conversation.canSend || sendBusy;
  el("older-messages").hidden = !state.hasMoreBefore; el("older-messages").disabled = olderBusy;
  if (role === "admin") { inbox.set(state.id, conversation); renderInbox(); }
}
function viewportAnchor() {
  const box = el("message-scroll").getBoundingClientRect();
  const first = [...el("messages").children].find((item) => item.getBoundingClientRect().bottom > box.top);
  return first ? { sequence: first.dataset.sequence, offset: first.getBoundingClientRect().top - box.top } : null;
}
function renderMessages(state, { initial = false, ownSend = false, prepend = false } = {}) {
  if (!belongsTo(currentState(), state.id, state.epoch)) return;
  const scroll = el("message-scroll"); const atBottom = nearBottom(scroll); const anchor = viewportAnchor(); const oldTop = scroll.scrollTop;
  const messages = orderedMessages(state); const container = el("messages"); const fragment = document.createDocumentFragment();
  for (const message of messages) {
    const own = message.sender === "me"; const fromJessie = role === "admin" ? own : !own;
    const article = document.createElement("article"); article.className = `message ${own ? "own" : ""} ${fromJessie ? "from-jessie" : "from-client"}`; article.dataset.sequence = message.sequence; article.dataset.sender = message.sender; article.setAttribute("role", "listitem");
    const body = document.createElement("p"); body.className = "bubble"; body.textContent = message.deletedAt != null ? "Message supprimé" : message.body; article.classList.toggle("deleted", message.deletedAt != null); article.append(body);
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
  selectionEpoch += 1; stopPolling(); abortRequests(); inboxLoading = false; olderBusy = false; sendBusy = false; readBusy = false; selectionLoading = true;
  selected = id;
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
  const requestKey = `${state.id}:${state.epoch}`;
  if (eventRequests.has(requestKey)) return false;
  eventRequests.add(requestKey);
  try {
  let more = false;
  for (let page = 0; page < 3; page += 1) {
    const result = await request(`${conversationPath(state)}/events?after=${state.eventCursor}&limit=100`, { state });
    const atBottom = nearBottom(el("message-scroll")); const before = state.conversation?.latestSequence ?? "0"; const pending = state.pending?.clientMessageId;
    mergeConversation(state, result.conversation); mergeEvents(state, result.events, result.nextCursor);
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
  cycleRunning = true; const ticket = snapshot(); let catchup = false;
  try {
    if (Date.now() - sessionCheckedAt > 60000) await refreshSession();
    if (role === "admin" && Date.now() - lastInboxRefresh >= 30000) await loadInbox(false, true);
    const state = currentState(); if (state) catchup = await fetchEvents(state);
    retryDelay = 3000; notice("");
  } catch (error) { if (!error.stale) { retryDelay = Math.min(30000, retryDelay * 2); await handleError(error, currentState()); } }
  finally { cycleRunning = false; if (fresh(ticket)) schedulePolling(catchup ? 300 : retryDelay); }
}
function newClientId() { return [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function sendMessage(retry = false) {
  const state = currentState(); if (!state || sendBusy || !state.conversation?.canSend || (!retry && state.pending)) return;
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
  const throughSequence = readableSequence(orderedMessages(state), { visible: visible(), nearBottom: nearBottom(scroll), visibleSequences });
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
  try { await request(`${sessionBase}/logout`, { mutation: true }); signOut(); }
  catch (error) {
    if (error.status === 401) signOut();
    else {
      if (error.status === 403) { try { await refreshSession(); } catch (refreshError) { if (refreshError.status === 401 || refreshError.status === 403) signOut(); } }
      notice("La déconnexion n’a pas été confirmée. Réessaie avec le bouton Se déconnecter.", true, "session-status");
    }
  }
  finally { logoutBusy = false; el("logout").disabled = false; }
}
el("composer").addEventListener("submit", (event) => { event.preventDefault(); void sendMessage(); });
el("message-body").addEventListener("input", () => { const state = currentState(); if (state) { state.draft = el("message-body").value; renderMeta(state); } });
el("retry-send").addEventListener("click", () => { void sendMessage(true); });
el("older-messages").addEventListener("click", () => { void loadOlder(); });
el("more-conversations").addEventListener("click", () => { void loadInbox(true).catch((error) => handleError(error)); });
el("new-messages").addEventListener("click", () => { el("message-scroll").scrollTop = el("message-scroll").scrollHeight; el("new-messages").hidden = true; scheduleRead(); });
el("message-scroll").addEventListener("scroll", () => { if (nearBottom(el("message-scroll"))) el("new-messages").hidden = true; scheduleRead(); }, { passive: true });
el("back-to-inbox").addEventListener("click", () => {
  const state = currentState(); if (state) { state.draft = el("message-body").value; if (state.pending?.status === "sending") retrySend(state); }
  selectionEpoch += 1; abortRequests(); inboxLoading = false; selected = null; clearChat(); renderInbox(); schedulePolling();
  selectionLoading = false;
});
el("logout").addEventListener("click", () => { void logout(); });
document.addEventListener("visibilitychange", () => {
  if (!visible()) {
    stopPolling(); visibilityGeneration += 1; abortRequests();
    const state = currentState(); if (state?.pending?.status === "sending") retrySend(state);
    sendBusy = false; olderBusy = false; readBusy = false; inboxLoading = false; if (state) renderMeta(state);
  } else if (ready) {
    void refreshSession().then(() => { retryDelay = 3000; schedulePolling(0); }).catch((error) => handleError(error));
  } else if (!loggingOut) void start();
});
window.addEventListener("pagehide", clearPrivate);
window.addEventListener("pageshow", (event) => { if (event.persisted) location.reload(); });
async function start() {
  if (!role) { clearPrivate(); notice("Cette page n’est pas disponible.", true, "session-status"); return; }
  el("account-link").href = role === "admin" ? "/admin" : "/access"; el("account-link").textContent = role === "admin" ? "Gérer les accès" : "Mon accès";
  try {
    await refreshSession(); const capability = await request(`${chatBase}/capabilities`);
    if (capability.enabled !== true) throw Object.assign(new Error("chat_disabled"), { status: 404 });
    ready = true; el("workspace").hidden = false; el("workspace").classList.toggle("is-admin", role === "admin");
    el("inbox").hidden = role !== "admin"; el("client-aside").hidden = role !== "client"; el("back-to-inbox").hidden = role !== "admin";
    notice("", false, "session-status"); clearChat();
    if (role === "admin") { await loadInbox(); }
    else { const conversation = await request(`${chatBase}/conversation`); await selectConversation(conversation.id); }
    schedulePolling();
  } catch (error) {
    if (error.stale) return;
    if (error.status === 401 || error.status === 403) { signOut(); return; }
    clearPrivate(); notice(error.status === 404 ? "La messagerie n’est pas encore activée. Consulte ton accès pour revenir plus tard." : "La messagerie est indisponible. Recharge la page pour réessayer.", true, "session-status");
  }
}
clearChat(); void start();
