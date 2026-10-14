import test from "node:test";
import assert from "node:assert/strict";
import { sequence, compareSequence, makeConversationState, belongsTo, orderedMessages, mergeMessages, mergeEvents, mergeConversation, prepareSend, retrySend, rejectPendingSend, validBody, shouldScroll, readableSequence, inboxRefreshPlan } from "../public/chat-model.js";

const conversationId = "a".repeat(32);
const message = (seq, extra = {}) => ({ id: seq.padStart(32, "0"), sequence: seq, sender: "peer", body: `Texte ${seq}`, deletedAt: null, clientMessageId: null, createdAt: 1, ...extra });
const meta = (extra = {}) => ({ id: conversationId, latestSequence: "0", lastReadSequence: "0", peerReadSequence: "0", latestEventSequence: "0", canSend: true, ...extra });

test("history keeps exact ordering beyond JavaScript's safe integer boundary", () => {
  const state = makeConversationState(conversationId);
  mergeMessages(state, [message("9007199254740993"), message("9007199254740992"), message("18446744073709551615")]);
  assert.deepEqual(orderedMessages(state).map((item) => item.sequence), ["9007199254740992", "9007199254740993", "18446744073709551615"]);
  assert.equal(compareSequence("9007199254740992", "9007199254740993"), -1);
});
test("only canonical unsigned 64-bit decimal cursors are accepted", () => {
  for (const value of [1, "01", "-1", "1e4", "1.0", "18446744073709551616", "", " 1", "1\n", "0\n", "1\r\n"]) assert.throws(() => sequence(value));
  assert.equal(sequence("0"), "0"); assert.equal(sequence("18446744073709551615"), "18446744073709551615");
});
test("deletion of an older loaded message propagates and a stale page cannot resurrect it", () => {
  const state = makeConversationState(conversationId);
  mergeMessages(state, [message("1"), message("80")]); state.eventCursor = "90";
  mergeEvents(state, [{ sequence: "91", kind: "delete", message: message("1", { body: "must disappear", deletedAt: 50 }) }], "91");
  mergeMessages(state, [message("1")]);
  assert.equal(state.messages.get("1").body, null); assert.equal(state.messages.get("1").deletedAt, 50);
  assert.equal(state.messages.get("80").body, "Texte 80");
});
test("replayed event pages keep the cursor and tombstone monotonically", () => {
  const state = makeConversationState(conversationId); state.eventCursor = "12";
  mergeEvents(state, [{ sequence: "11", kind: "message", message: message("1") }], "11");
  assert.equal(state.eventCursor, "12"); assert.equal(state.messages.size, 0);
  assert.throws(() => mergeEvents(state, [{ sequence: "13", kind: "delete", message: message("1") }], "13"));
});
test("a deletion outside the loaded page does not insert an isolated old message", () => {
  const state = makeConversationState(conversationId); mergeMessages(state, [message("80")]); state.eventCursor = "90";
  mergeEvents(state, [{ sequence: "91", kind: "delete", message: message("1", { body: null, deletedAt: 50 }) }], "91");
  assert.deepEqual(orderedMessages(state).map((item) => item.sequence), ["80"]); assert.equal(state.eventCursor, "91");
});
test("persisted sends reconcile a lost response through their exact client key", () => {
  const state = makeConversationState(conversationId); const key = "b".repeat(32);
  const first = prepareSend(state, "  Bonsoir\nJessie  ", key); retrySend(state);
  const retry = prepareSend(state, "  Bonsoir\nJessie  ", "c".repeat(32));
  assert.strictEqual(retry, first); assert.equal(retry.clientMessageId, key); assert.equal(retry.body, "  Bonsoir\nJessie  ");
  mergeEvents(state, [{ sequence: "1", kind: "message", message: message("1", { sender: "me", clientMessageId: key, body: first.body }) }], "1");
  assert.equal(state.pending, null); assert.equal(state.messages.size, 1);
});
test("a pending send prevents changing content under the same idempotency key", () => {
  const state = makeConversationState(conversationId); prepareSend(state, "Premier texte", "b".repeat(32));
  assert.throws(() => prepareSend(state, "Autre texte", "c".repeat(32)), /pending_message_changed/);
  assert.equal(state.pending.body, "Premier texte");
  assert.throws(() => prepareSend(makeConversationState(conversationId), "Texte", `${"c".repeat(32)}\n`), /invalid_message/);
});
test("body validation preserves whitespace and rejects empty or oversized text", () => {
  assert.equal(validBody("   \n"), false); assert.equal(validBody("x".repeat(4096)), true); assert.equal(validBody("x".repeat(4097)), false);
  assert.equal(validBody("🙂".repeat(2048)), true); assert.equal(validBody(" <script>alert(1)</script> "), true);
  for (const body of ["\u0000x", "\u200b", "\ud800", "x\u007f", "x\u0085"]) assert.equal(validBody(body), false);
  assert.equal(validBody("\tBonsoir\nJessie\r\n"), true);
});
test("definite validation rejection unlocks correction while an uncertain response keeps its key", () => {
  const state = makeConversationState(conversationId); state.draft = "Texte à corriger";
  prepareSend(state, state.draft, "b".repeat(32));
  assert.equal(rejectPendingSend(state, 503), false); assert.equal(state.pending.clientMessageId, "b".repeat(32));
  assert.equal(rejectPendingSend(state, 409), false); assert.equal(state.pending.clientMessageId, "b".repeat(32));
  assert.equal(rejectPendingSend(state, 400), true); assert.equal(state.pending, null); assert.equal(state.draft, "Texte à corriger");
  assert.doesNotThrow(() => prepareSend(state, "Texte corrigé", "c".repeat(32)));
});
test("read receipts cannot jump to unseen messages or advance in a hidden page", () => {
  const messages = [message("5"), message("6", { sender: "me" }), message("99")];
  assert.equal(readableSequence(messages, { visible: true, nearBottom: true, visibleSequences: ["5", "6"] }), "5");
  assert.equal(readableSequence(messages, { visible: false, nearBottom: true, visibleSequences: ["99"] }), "0");
  assert.equal(readableSequence(messages, { visible: true, nearBottom: false, visibleSequences: ["99"] }), "0");
});
test("metadata receipts cannot regress when an older snapshot finishes later", () => {
  const state = makeConversationState(conversationId);
  mergeConversation(state, meta({ latestSequence: "20", lastReadSequence: "18", peerReadSequence: "17", latestEventSequence: "22" }));
  mergeConversation(state, meta({ latestSequence: "19", lastReadSequence: "10", peerReadSequence: "11", latestEventSequence: "21" }));
  assert.equal(state.conversation.latestSequence, "20"); assert.equal(state.conversation.lastReadSequence, "18"); assert.equal(state.conversation.peerReadSequence, "17"); assert.equal(state.conversation.latestEventSequence, "22");
});
test("a conversation epoch prevents a late result being applied after switching away and back", () => {
  const first = makeConversationState(conversationId, 1); const reopened = { ...first, epoch: 3 };
  assert.equal(belongsTo(reopened, conversationId, 1), false); assert.equal(belongsTo(reopened, conversationId, 3), true);
  assert.equal(belongsTo(reopened, "d".repeat(32), 3), false);
});
test("new arrivals preserve reading position and earlier pages never trigger bottom jumps", () => {
  assert.equal(shouldScroll({ wasNearBottom: false }), false);
  assert.equal(shouldScroll({ wasNearBottom: true }), true);
  assert.equal(shouldScroll({ initial: true }), true);
  assert.equal(shouldScroll({ ownSend: true }), true);
  assert.equal(shouldScroll({ prepend: true, wasNearBottom: true }), false);
});
test("inbox rotates loaded pages and probes new tail rows after exhausting known contacts", () => {
  const id = (value) => value.toString(16).padStart(32, "0");
  const loaded = Array.from({ length: 120 }, (_, index) => id(index + 1));
  const first = { conversations: loaded.slice(0, 50).map((value) => ({ id: value })), nextCursor: id(50), hasMore: true };
  assert.deepEqual(inboxRefreshPlan(loaded, first), { lastLoadedId: id(120), nextBoundary: id(50), probeTail: false });
  const last = { conversations: [id(120), id(121)].map((value) => ({ id: value })), nextCursor: null, hasMore: false };
  assert.deepEqual(inboxRefreshPlan(loaded, last), { lastLoadedId: id(120), nextBoundary: null, probeTail: true });
  // A known last page still probes the tail even when the previous response
  // reported no more contacts, so later invitations can become discoverable.
  assert.equal(inboxRefreshPlan(loaded, { conversations: [{ id: id(120) }], nextCursor: null, hasMore: false }).probeTail, true);
});
