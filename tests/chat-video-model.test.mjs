import test from "node:test";
import assert from "node:assert/strict";
import { makeConversationState, prepareVideoSend, completeVideoUpload, retrySend, prepareSend,
  prepareImageSend, rejectPendingVideoSend, mergeMessages, mergeEvents } from "../public/chat-model.js";

const id = n => n.toString(16).padStart(32, "0");
test("a video retries the same message identity and uploaded asset after an uncertain send", () => {
  const state = makeConversationState(id(1)), file = { type: "video/mp4" };
  const pending = prepareVideoSend(state, { caption: "Same caption", file }, id(2));
  assert.equal(pending.stage, "uploading");
  assert.equal(completeVideoUpload(state, id(2), id(3)), true);
  assert.equal(pending.file, null); assert.equal(pending.stage, "sending");
  retrySend(state);
  assert.equal(prepareVideoSend(state, { caption: "Same caption", videoId: id(3) }, id(99)), pending);
  assert.equal(pending.clientMessageId, id(2));
  for (const status of [undefined, 409, 429, 500, 503]) assert.equal(rejectPendingVideoSend(state, status), false);
  assert.equal(state.pending, pending);
});
test("video upload and send cannot switch attachment, caption or kind under an accepted identity", () => {
  const state = makeConversationState(id(1)), file = {};
  prepareVideoSend(state, { caption: "", file }, id(2));
  assert.throws(() => prepareVideoSend(state, { caption: "changed", file }, id(2)));
  assert.throws(() => prepareVideoSend(state, { caption: "", file: {} }, id(2)));
  assert.throws(() => prepareSend(state, "text", id(2)));
  assert.throws(() => prepareImageSend(state, { caption: "", file }, id(2)));
  completeVideoUpload(state, id(2), id(3));
  assert.throws(() => completeVideoUpload(state, id(2), id(4)));
  assert.equal(completeVideoUpload(state, id(99), id(4)), false);
});
test("definite video rejection permits a replacement while preserving the caption draft", () => {
  const state = makeConversationState(id(1)); state.draft = "caption"; state.videoDraft = { file: {} };
  prepareVideoSend(state, { caption: state.draft, file: state.videoDraft.file }, id(2));
  assert.equal(rejectPendingVideoSend(state, 404), true);
  assert.equal(state.pending, null); assert.equal(state.videoDraft, null); assert.equal(state.draft, "caption");
});
test("a delivered video reconciles its exact pending identity and a tombstone cannot restore its metadata", () => {
  const state = makeConversationState(id(1)); state.videoDraft = { file: {} };
  prepareVideoSend(state, { caption: "", file: state.videoDraft.file }, id(2));
  const message = { id: id(3), sequence: "1", sender: "me", body: "", deletedAt: null, clientMessageId: id(2),
    video: { id: id(4), contentUrl: "/private-delivery" } };
  mergeMessages(state, [message]);
  assert.equal(state.pending, null); assert.equal(state.videoDraft, null);
  mergeEvents(state, [{ sequence: "2", kind: "delete", message: { ...message, body: null, deletedAt: 123 } }], "2");
  assert.equal(state.messages.get("1").video, undefined);
  mergeMessages(state, [message]); assert.equal(state.messages.get("1").video, undefined);
  assert.equal(state.messages.get("1").deletedAt, 123);
});
