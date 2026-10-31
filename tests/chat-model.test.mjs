import test from "node:test";
import assert from "node:assert/strict";
import { sequence, compareSequence, makeConversationState, belongsTo, orderedMessages, mergeMessages, mergeEvents, mergeConversation, prepareSend, prepareImageSend, completeImageUpload, validCaption, mediaStillCurrent, createObjectUrlCache, retrySend, rejectPendingSend, rejectPendingImageSend, validBody, shouldScroll, readableSequence, inboxRefreshPlan, boundMessageWindow, currentHistoryPage } from "../public/chat-model.js";

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
test("image retries preserve the uploaded asset and message key after a lost response", () => {
  const state = makeConversationState(conversationId); const file = { synthetic: true }; const key = "b".repeat(32); const mediaId = "c".repeat(32);
  const first = prepareImageSend(state, { file, caption: "  Bonsoir\n " }, key);
  assert.equal(first.stage, "uploading"); retrySend(state);
  assert.strictEqual(prepareImageSend(state, { file, caption: "  Bonsoir\n " }, "d".repeat(32)), first);
  assert.equal(completeImageUpload(state, key, mediaId), true); assert.equal(first.file, null); assert.equal(first.stage, "sending");
  retrySend(state); const retry = prepareImageSend(state, { caption: first.caption, mediaId }, "e".repeat(32));
  assert.equal(retry.clientMessageId, key); assert.equal(retry.mediaId, mediaId); assert.equal(retry.caption, "  Bonsoir\n ");
  state.imageDraft = { asset: { id: mediaId } };
  mergeMessages(state, [message("1", { sender: "me", clientMessageId: key, body: first.caption, media: { id: mediaId } })]);
  assert.equal(state.pending, null); assert.equal(state.imageDraft, null);
});
test("a pending image cannot change asset, caption, local file or become text", () => {
  const state = makeConversationState(conversationId); const file = {}; const key = "b".repeat(32);
  prepareImageSend(state, { file, caption: "Légende" }, key);
  assert.throws(() => prepareImageSend(state, { file: {}, caption: "Légende" }, key), /pending_message_changed/);
  assert.throws(() => prepareImageSend(state, { file, caption: "Autre" }, key), /pending_message_changed/);
  assert.throws(() => prepareSend(state, "Légende", key), /pending_message_changed/);
  assert.equal(completeImageUpload(state, "c".repeat(32), "d".repeat(32)), false);
  completeImageUpload(state, key, "d".repeat(32));
  assert.throws(() => completeImageUpload(state, key, "e".repeat(32)), /pending_asset_changed/);
  assert.throws(() => prepareImageSend(state, { caption: "Légende", mediaId: "e".repeat(32) }, key), /pending_message_changed/);
});
test("image captions allow an empty exact value and reject malformed or oversized input", () => {
  assert.equal(validCaption(""), true); assert.equal(validCaption("  Une légende\n"), true); assert.equal(validCaption("🙂".repeat(500)), true);
  for (const value of ["  \n", "\u200b", "x".repeat(1001), "\ud800", "x\u0000", "x\u007f", null]) assert.equal(validCaption(value), false);
  const state = makeConversationState(conversationId);
  assert.doesNotThrow(() => prepareImageSend(state, { mediaId: "c".repeat(32), caption: "" }, "b".repeat(32)));
  assert.throws(() => prepareImageSend(makeConversationState(conversationId), { mediaId: "c".repeat(32), caption: "" }, `${"b".repeat(32)}\n`), /invalid_image_message/);
});
test("a photo tombstone removes delivery metadata and blocks stale thumbnail completion", () => {
  const state = makeConversationState(conversationId, 3); const photo = message("1", { media: { id: "c".repeat(32), fullUrl: "/private/full" }, body: "" });
  mergeMessages(state, [photo]); const ticket = { id: state.id, epoch: 3, messageId: photo.id, mediaId: photo.media.id };
  assert.equal(mediaStillCurrent(state, ticket), true);
  assert.equal(mediaStillCurrent({ ...state, epoch: 5 }, ticket), false);
  mergeEvents(state, [{ sequence: "2", kind: "delete", message: { ...photo, deletedAt: 20, body: null } }], "2");
  assert.equal(mediaStillCurrent(state, ticket), false); assert.equal("media" in state.messages.get("1"), false);
  mergeMessages(state, [photo]); assert.equal("media" in state.messages.get("1"), false); assert.equal(state.messages.get("1").body, null);
});
test("a photo without a visible caption is read only after loading, without jumping over it", () => {
  const photo = message("7", { body: "", media: { id: "c".repeat(32) } }); const text = message("8");
  const options = { visible: true, nearBottom: true, visibleSequences: ["7", "8"] };
  assert.equal(readableSequence([photo, text], options), "0");
  assert.equal(readableSequence([photo, text], { ...options, loadedMediaIds: [photo.id] }), "8");
  assert.equal(readableSequence([{ ...photo, body: "Une légende" }], options), "7");
  assert.equal(readableSequence([{ ...photo, body: "  \n" }], options), "0");
  assert.equal(readableSequence([photo], { ...options, visible: false, loadedMediaIds: [photo.id] }), "0");
});
test("memory image resources revoke on replacement, bounded eviction and privacy clearing", () => {
  const revoked = []; const cache = createObjectUrlCache({ revoke: (url) => revoked.push(url), maxEntries: 2, maxBytes: 10 });
  cache.put("first", "blob:first", 4); cache.put("second", "blob:second", 4); assert.equal(cache.get("first"), "blob:first");
  cache.put("third", "blob:third", 4); assert.deepEqual(revoked, ["blob:second"]); assert.equal(cache.size, 2); assert.equal(cache.bytes, 8);
  cache.put("first", "blob:first-new", 4); assert.deepEqual(revoked, ["blob:second", "blob:first"]);
  assert.equal(cache.put("huge", "blob:huge", 11), false); assert.equal(cache.get("huge"), null);
  cache.removeWhere((key) => key === "third"); assert.equal(cache.size, 1);
  cache.clear(); cache.clear(); assert.equal(cache.size, 0); assert.equal(cache.bytes, 0);
  assert.deepEqual(revoked, ["blob:second", "blob:first", "blob:huge", "blob:third", "blob:first-new"]);
});
test("an image removed in another tab releases its rejected send while uncertain sends retain their key", () => {
  const state = makeConversationState(conversationId); state.draft = "Légende conservée"; state.imageDraft = { asset: { id: "c".repeat(32) } };
  prepareImageSend(state, { caption: state.draft, mediaId: "c".repeat(32) }, "b".repeat(32));
  assert.equal(rejectPendingImageSend(state, 503), false); assert.equal(state.pending.clientMessageId, "b".repeat(32));
  assert.equal(rejectPendingImageSend(state, 409), false); assert.equal(state.pending.clientMessageId, "b".repeat(32));
  assert.equal(rejectPendingImageSend(state, 404), true); assert.equal(state.pending, null); assert.equal(state.imageDraft, null); assert.equal(state.draft, "Légende conservée");
  assert.doesNotThrow(() => prepareImageSend(state, { caption: state.draft, mediaId: "d".repeat(32) }, "e".repeat(32)));
});


test("a definitive photo-dimension rejection allows replacing the file while preserving its caption", () => {
  const state = makeConversationState(conversationId); state.draft = "Caption to keep"; state.imageDraft = { file: { synthetic: true }, asset: null };
  prepareImageSend(state, { caption: state.draft, file: state.imageDraft.file }, "b".repeat(32));
  assert.equal(rejectPendingImageSend(state, 422), true); assert.equal(state.pending, null);
  assert.equal(state.draft, "Caption to keep"); assert.ok(state.imageDraft.file);
});


test("bounded history preserves contiguous forward/back cursors and independent drafts and uncertain sends", () => {
  const state = makeConversationState(conversationId); state.draft = "Keep draft"; state.pending = { clientMessageId: "a".repeat(32), body: "Pending", status: "retry" };
  state.eventCursor = "400";
  mergeMessages(state, Array.from({ length: 400 }, (_, i) => ({ id: String(i + 1), sequence: String(i + 1), sender: "peer", body: "Synthetic", deletedAt: null })));
  assert.equal(boundMessageWindow(state).length, 100); assert.equal(state.messages.size, 300);
  assert.equal(state.nextBefore, "101"); assert.equal(state.hasMoreBefore, true); assert.equal(state.draft, "Keep draft"); assert.equal(state.pending.status, "retry");
  mergeMessages(state, Array.from({ length: 50 }, (_, i) => ({ id: String(i + 51), sequence: String(i + 51), sender: "peer", body: "Earlier", deletedAt: null })));
  assert.equal(boundMessageWindow(state, { retain: "oldest" }).length, 50); assert.equal(state.nextAfter, "350"); assert.equal(state.hasMoreAfter, true);
  assert.equal(currentHistoryPage(state, { eventCursor: "399" }), false); assert.equal(currentHistoryPage(state, { eventCursor: "400" }), true);
  assert.equal(state.messages.size, 300); assert.throws(() => boundMessageWindow(state, { limit: 1 }));
});
