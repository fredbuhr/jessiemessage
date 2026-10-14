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
  return { id, epoch, messages: new Map(), conversation: null, eventCursor: "0", pending: null, draft: "", hasMoreBefore: false, nextBefore: null };
}
export function belongsTo(state, id, epoch) { return Boolean(state && state.id === id && state.epoch === epoch); }
export function orderedMessages(state) { return [...state.messages.values()].sort((a, b) => compareSequence(a.sequence, b.sequence)); }
export function mergeMessages(state, messages) {
  for (const incoming of messages) {
    sequence(incoming.sequence);
    const existing = state.messages.get(incoming.sequence);
    if (existing && existing.id !== incoming.id) throw new TypeError("conflicting_message_sequence");
    // A later fetch may contain an older snapshot; a deletion always wins.
    const message = existing?.deletedAt != null ? existing : { ...incoming, body: incoming.deletedAt != null ? null : incoming.body };
    state.messages.set(incoming.sequence, message);
    if (message.sender === "me" && message.clientMessageId && state.pending?.clientMessageId === message.clientMessageId) {
      state.pending = null;
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
    if (state.pending.body !== body) throw new Error("pending_message_changed");
    state.pending.status = "sending";
    return state.pending;
  }
  if (!validBody(body) || typeof clientMessageId !== "string" || clientMessageId.length !== 32 || !/^[0-9a-f]{32}$/.test(clientMessageId)) throw new TypeError("invalid_message");
  state.pending = { clientMessageId, body, status: "sending" };
  return state.pending;
}
export function retrySend(state) { if (state.pending) state.pending.status = "retry"; }
export function rejectPendingSend(state, status) {
  // These responses prove the request was rejected before persistence. A lost
  // response, 409 or transient failure must retain its original retry key.
  if (![400, 413, 415].includes(status)) return false;
  state.pending = null;
  return true;
}
export function nearBottom({ scrollHeight, scrollTop, clientHeight }, threshold = 90) { return scrollHeight - scrollTop - clientHeight <= threshold; }
export function shouldScroll({ initial = false, ownSend = false, wasNearBottom = false, prepend = false }) {
  return !prepend && (initial || ownSend || wasNearBottom);
}
export function readableSequence(messages, { visible, nearBottom: atBottom, visibleSequences = [] }) {
  if (!visible || !atBottom) return "0";
  const onScreen = new Set(visibleSequences);
  return messages.filter((message) => message.sender === "peer" && onScreen.has(message.sequence)).reduce((latest, message) => maxSequence(latest, message.sequence), "0");
}
export function inboxRefreshPlan(loadedIds, page) {
  const lastLoadedId = [...loadedIds].sort().at(-1) ?? null;
  const reachedEnd = !page.hasMore || !page.nextCursor || !lastLoadedId
    || page.nextCursor >= lastLoadedId || page.conversations.some((item) => item.id >= lastLoadedId);
  return { lastLoadedId, nextBoundary: reachedEnd ? null : page.nextCursor, probeTail: reachedEnd && lastLoadedId !== null };
}
