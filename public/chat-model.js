// Private chat state stays in memory. Decimal sequences never pass through Number.
const MAX_SEQUENCE = 18446744073709551615n;

export function sequence(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > MAX_SEQUENCE || BigInt(value).toString() !== value) throw new TypeError("invalid_sequence");
  return value;
}
export function compareSequence(left, right) {
  const a = BigInt(sequence(left)); const b = BigInt(sequence(right));
  return a < b ? -1 : a > b ? 1 : 0;
}
export function maxSequence(left, right) { return compareSequence(left, right) < 0 ? right : left; }
export function makeConversationState(id, epoch = 0) {
  return { id, epoch, messages: new Map(), conversation: null, eventCursor: "0", pending: null, draft: "", imageDraft: null, hasMoreBefore: false, nextBefore: null };
}
export function belongsTo(state, id, epoch) { return Boolean(state && state.id === id && state.epoch === epoch); }
export function orderedMessages(state) { return [...state.messages.values()].sort((a, b) => compareSequence(a.sequence, b.sequence)); }
export function mergeMessages(state, messages) {
  for (const incoming of messages) {
    sequence(incoming.sequence);
    const existing = state.messages.get(incoming.sequence);
    if (existing && existing.id !== incoming.id) throw new TypeError("conflicting_message_sequence");
    // A later fetch may contain an older snapshot; a deletion always wins.
    const message = existing?.deletedAt != null ? { ...existing } : { ...incoming, body: incoming.deletedAt != null ? null : incoming.body };
    if (message.deletedAt != null) delete message.media;
    state.messages.set(incoming.sequence, message);
    if (message.sender === "me" && message.clientMessageId && state.pending?.clientMessageId === message.clientMessageId) {
      state.pending = null; state.imageDraft = null;
    }
  }
  return state;
}
export function mergeConversation(state, incoming) {
  if (!incoming || incoming.id !== state.id) throw new TypeError("wrong_conversation");
  const old = state.conversation;
  state.conversation = { ...incoming };
  for (const name of ["latestSequence", "lastReadSequence", "peerReadSequence", "latestEventSequence"]) {
    state.conversation[name] = old ? maxSequence(sequence(old[name]), sequence(incoming[name])) : sequence(incoming[name]);
  }
  return state;
}
export function mergeEvents(state, events, nextCursor) {
  const previous = state.eventCursor;
  let cursor = previous;
  for (const event of events) {
    sequence(event.sequence);
    if (compareSequence(event.sequence, previous) <= 0) continue;
    if (compareSequence(event.sequence, cursor) <= 0) throw new TypeError("unordered_events");
    if (!["message", "delete"].includes(event.kind)) throw new TypeError("invalid_event");
    if (event.kind === "delete" && event.message.deletedAt == null) throw new TypeError("invalid_tombstone");
    if (event.kind !== "delete" || state.messages.has(event.message.sequence)) mergeMessages(state, [event.message]);
    cursor = event.sequence;
  }
  sequence(nextCursor);
  if (compareSequence(cursor, previous) > 0 && compareSequence(nextCursor, cursor) < 0) throw new TypeError("invalid_event_cursor");
  state.eventCursor = maxSequence(previous, nextCursor);
  return state;
}
export function validBody(body) {
  return typeof body === "string" && body.length >= 1 && body.length <= 4096 && body.isWellFormed()
    && body.trim().length > 0 && !/^[\p{C}\p{Z}]+$/u.test(body)
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(body)
    && new TextEncoder().encode(body).length <= 16384;
}
export function prepareSend(state, body, clientMessageId) {
  if (state.pending) {
    if (state.pending.kind === "image" || state.pending.body !== body) throw new Error("pending_message_changed");
    state.pending.status = "sending";
    return state.pending;
  }
  if (!validBody(body) || typeof clientMessageId !== "string" || clientMessageId.length !== 32 || !/^[0-9a-f]{32}$/.test(clientMessageId)) throw new TypeError("invalid_message");
  state.pending = { clientMessageId, body, status: "sending" };
  return state.pending;
}
export function validCaption(caption) {
  return typeof caption === "string" && caption.length <= 1000 && (caption === "" || validBody(caption));
}
export function prepareImageSend(state, { caption, mediaId = null, file = null }, clientMessageId) {
  if (state.pending) {
    if (state.pending.kind !== "image" || state.pending.caption !== caption
      || (mediaId !== null && state.pending.mediaId !== mediaId) || (file !== null && state.pending.file !== file)) throw new Error("pending_message_changed");
    state.pending.status = "sending"; return state.pending;
  }
  if (!validCaption(caption) || typeof clientMessageId !== "string" || !/^[0-9a-f]{32}$/.test(clientMessageId) || clientMessageId.length !== 32
    || (mediaId !== null && (typeof mediaId !== "string" || mediaId.length !== 32 || !/^[0-9a-f]{32}$/.test(mediaId)))
    || (mediaId === null && !file)) throw new TypeError("invalid_image_message");
  state.pending = { kind: "image", clientMessageId, caption, mediaId, file, stage: mediaId ? "sending" : "uploading", status: "sending" };
  return state.pending;
}
export function completeImageUpload(state, clientMessageId, mediaId) {
  if (!state.pending || state.pending.kind !== "image" || state.pending.clientMessageId !== clientMessageId) return false;
  if (typeof mediaId !== "string" || mediaId.length !== 32 || !/^[0-9a-f]{32}$/.test(mediaId)) throw new TypeError("invalid_media_id");
  if (state.pending.mediaId && state.pending.mediaId !== mediaId) throw new Error("pending_asset_changed");
  state.pending.mediaId = mediaId; state.pending.file = null; state.pending.stage = "sending"; return true;
}
export function mediaStillCurrent(state, { id, epoch, messageId, mediaId }) {
  if (!belongsTo(state, id, epoch)) return false;
  return [...state.messages.values()].some((message) => message.id === messageId && message.deletedAt == null && message.media?.id === mediaId);
}
// Memory-only resources have one owner. Clearing or eviction always revokes
// the browser URL; callers abort pending network reads separately.
export function createObjectUrlCache({ revoke = (url) => URL.revokeObjectURL(url), maxEntries = 100, maxBytes = 30 * 1024 * 1024 } = {}) {
  const entries = new Map(); let totalBytes = 0;
  function remove(key) { const value = entries.get(key); if (!value) return; entries.delete(key); totalBytes -= value.bytes; revoke(value.url); }
  return {
    get(key) { const value = entries.get(key); if (!value) return null; entries.delete(key); entries.set(key, value); return value.url; },
    put(key, url, bytes) { if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxBytes) { revoke(url); return false; } remove(key); entries.set(key, { url, bytes }); totalBytes += bytes; while (entries.size > maxEntries || totalBytes > maxBytes) remove(entries.keys().next().value); return entries.has(key); },
    remove,
    removeWhere(predicate) { for (const key of entries.keys()) if (predicate(key)) remove(key); },
    clear() { for (const key of [...entries.keys()]) remove(key); },
    get size() { return entries.size; }, get bytes() { return totalBytes; }
  };
}
export function retrySend(state) { if (state.pending) state.pending.status = "retry"; }
export function rejectPendingSend(state, status) {
  // These responses prove the request was rejected before persistence. A lost
  // response, 409 or transient failure must retain its original retry key.
  if (![400, 413, 415].includes(status)) return false;
  state.pending = null;
  return true;
}
export function rejectPendingImageSend(state, status) {
  if (state.pending?.kind !== "image") return false;
  if (status === 404) { state.pending = null; state.imageDraft = null; return true; }
  if (status === 422) { state.pending = null; return true; }
  return rejectPendingSend(state, status);
}
export function nearBottom({ scrollHeight, scrollTop, clientHeight }, threshold = 90) { return scrollHeight - scrollTop - clientHeight <= threshold; }
export function shouldScroll({ initial = false, ownSend = false, wasNearBottom = false, prepend = false }) {
  return !prepend && (initial || ownSend || wasNearBottom);
}
export function readableSequence(messages, { visible, nearBottom: atBottom, visibleSequences = [], loadedMediaIds = [] }) {
  if (!visible || !atBottom) return "0";
  const onScreen = new Set(visibleSequences);
  const loaded = new Set(loadedMediaIds);
  const waitingPhoto = messages.filter((message) => message.sender === "peer" && onScreen.has(message.sequence)
    && message.media && !validBody(message.body) && !loaded.has(message.id)).reduce((first, message) => first === null || compareSequence(message.sequence, first) < 0 ? message.sequence : first, null);
  return messages.filter((message) => message.sender === "peer" && onScreen.has(message.sequence)
    && (waitingPhoto === null || compareSequence(message.sequence, waitingPhoto) < 0)
    && (!message.media || validBody(message.body) || loaded.has(message.id))).reduce((latest, message) => maxSequence(latest, message.sequence), "0");
}
export function inboxRefreshPlan(loadedIds, page) {
  const lastLoadedId = [...loadedIds].sort().at(-1) ?? null;
  const reachedEnd = !page.hasMore || !page.nextCursor || !lastLoadedId
    || page.nextCursor >= lastLoadedId || page.conversations.some((item) => item.id >= lastLoadedId);
  return { lastLoadedId, nextBoundary: reachedEnd ? null : page.nextCursor, probeTail: reachedEnd && lastLoadedId !== null };
}
