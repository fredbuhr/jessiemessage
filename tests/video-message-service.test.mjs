import test from "node:test";
import assert from "node:assert/strict";
import { tokenDigest } from "../server/auth/crypto.mjs";
import { createVideoService } from "../server/video/service.mjs";
import { VIDEO_BLOCK_BYTES } from "../server/video/storage.mjs";
import { videoFixture, uploadFixture, collectVideo } from "./helpers/video-transport-fixture.mjs";

const conversationId = "1".repeat(32), messageId = "2".repeat(32), requestId = "3".repeat(32);
const code = wanted => error => error.code === wanted;
const fail = wanted => { throw Object.assign(new Error("private database path and key"), { code: wanted }); };
async function fixture(t, { uploaded = true } = {}) {
  const f = await videoFixture(t), owner = f.accounts[0], recipient = f.accounts[1], calls = [];
  const saved = uploaded ? await uploadFixture(f, owner, VIDEO_BLOCK_BYTES + 37) : null;
  const row = saved ? f.state.rows.get(saved.id) : null;
  const state = { live: true, row, gallery: null };
  const messages = {
    async getMessageAsset(request) {
      calls.push(["getMessageAsset", request]);
      if (!state.live || request.conversationId.toString("hex") !== conversationId || request.messageId.toString("hex") !== messageId) fail("VIDEO_NOT_FOUND");
      return { ...state.row };
    },
    async gallery(request) {
      calls.push(["gallery", request]);
      return state.gallery ?? { items: [{ messageId: Buffer.from(messageId, "hex"), sequence: "9007199254740993", senderId: owner.id, createdAt: f.state.now, asset: { ...state.row } }], nextBefore: null, hasMore: false };
    },
  };
  const chatService = { ...f.options.chatService, async sendVideo(role, raw, cid, input) {
    calls.push(["send", role, raw, cid, input]); return { message: { id: messageId, body: input.caption }, duplicate: false };
  } };
  const options = { ...f.options, messages, chatService }, service = await createVideoService(options);
  return { ...f, owner, recipient, saved, row, calls, messages, messageState: state, extendedOptions: options, extended: service };
}

test("message functionality is opt-in and incomplete adapters are rejected", async (t) => {
  const f = await fixture(t, { uploaded: false });
  assert.equal(f.service.send, undefined); assert.equal(f.service.openMessage, undefined); assert.equal(f.service.gallery, undefined);
  for (const name of ["getMessageAsset", "gallery"]) await assert.rejects(createVideoService({ ...f.extendedOptions, messages: { ...f.messages, [name]: null } }), code("VIDEO_CONFIG"));
  await assert.rejects(createVideoService({ ...f.extendedOptions, chatService: { ...f.extendedOptions.chatService, sendVideo: null } }), code("VIDEO_CONFIG"));
});

test("compatibility transport reads existing message videos and galleries but cannot send an existing asset", async t => {
  const f = await fixture(t), service = await createVideoService({ ...f.extendedOptions, creationEnabled: false });
  const input = { clientMessageId: requestId, videoId: f.saved.id, caption: "Existing private asset" };
  await assert.rejects(service.send("admin", f.owner.token, conversationId, input), code("VIDEO_READ_ONLY"));
  assert.equal(f.calls.some(([name]) => name === "send"), false);
  const opened = await service.openMessage("client", f.recipient.token, conversationId, messageId);
  assert.equal((await collectVideo(opened.stream({ start: 0, end: 15 }))).length, 16); await opened.close();
  assert.equal((await service.gallery("client", f.recipient.token, conversationId)).items.length, 1);
  f.recipient.active = false;
  await assert.rejects(service.send("client", f.recipient.token, conversationId, input), code("CHAT_UNAUTHORIZED"));
});

test("message publication validates its exact payload and preserves chat conflicts and rate limits", async (t) => {
  const f = await fixture(t, { uploaded: false }), input = { clientMessageId: requestId, videoId: "a".repeat(32), caption: "Texte 👋 <b>littéral</b>" };
  const result = await f.extended.send("admin", f.owner.token, conversationId, input);
  assert.equal(result.message.body, input.caption); assert.deepEqual(f.calls.at(-1), ["send", "admin", f.owner.token, conversationId, input]);
  await f.extended.send("admin", f.owner.token, conversationId, { ...input, caption: "" });
  const invalid = [null, [], {}, { ...input, ownerId: conversationId }, { ...input, videoId: "bad" }, { ...input, clientMessageId: "bad" }, { ...input, caption: "x".repeat(1001) }, { ...input, caption: "\u0000" }, { ...input, caption: "\ud800" }];
  const count = f.calls.length;
  for (const value of invalid) await assert.rejects(f.extended.send("admin", f.owner.token, conversationId, value), code("VIDEO_INPUT"));
  assert.equal(f.calls.length, count);
  for (const wanted of ["CHAT_CONFLICT", "CHAT_RATE_LIMIT", "CHAT_INPUT"]) {
    f.extendedOptions.chatService.sendVideo = async () => fail(wanted);
    await assert.rejects(f.extended.send("admin", f.owner.token, conversationId, input), code(wanted));
  }
});

test("delivery opens the committed owner's encrypted bytes for an authorized recipient without changing ownership", async (t) => {
  const f = await fixture(t), viewer = f.recipient;
  await assert.rejects(f.extended.open(viewer.role, viewer.token, f.saved.id), code("VIDEO_NOT_FOUND"));
  const handle = await f.extended.openMessage(viewer.role, viewer.token, conversationId, messageId);
  assert.deepEqual(await collectVideo(handle.stream({ start: VIDEO_BLOCK_BYTES - 3, end: VIDEO_BLOCK_BYTES + 12 })), Buffer.alloc(16, 0x5a)); await handle.close();
  const request = f.calls.find(([name]) => name === "getMessageAsset")[1];
  assert.equal(request.role, "client"); assert.deepEqual(request.tokenHash, tokenDigest(viewer.token));
  assert.equal(request.conversationId.toString("hex"), conversationId); assert.equal(request.messageId.toString("hex"), messageId);
  const own = await f.extended.open(f.owner.role, f.owner.token, f.saved.id); await own.close();
  assert.equal(f.row.ownerId.toString("hex"), f.owner.id.toString("hex"));
});

test("deleted links, revoked sessions and malformed adapter metadata fail before a file is opened", async (t) => {
  let opens = 0;
  const f = await fixture(t), originalOpen = f.storage.open;
  const options = { ...f.extendedOptions, storage: { ...f.extendedOptions.storage, async open(...args) { opens++; return originalOpen(...args); } } };
  const service = await createVideoService(options), viewer = f.recipient;
  f.messageState.live = false; await assert.rejects(service.openMessage(viewer.role, viewer.token, conversationId, messageId), code("VIDEO_NOT_FOUND"));
  f.messageState.live = true; f.messageState.row = { ...f.row, digest: Buffer.alloc(31) };
  await assert.rejects(service.openMessage(viewer.role, viewer.token, conversationId, messageId), code("VIDEO_UNAVAILABLE"));
  f.messageState.row = f.row; viewer.active = false;
  await assert.rejects(service.openMessage(viewer.role, viewer.token, conversationId, messageId), code("CHAT_UNAUTHORIZED"));
  assert.equal(opens, 0);
});

test("owner and delivery readers share their process slots and release unstarted streams", async (t) => {
  const f = await fixture(t), viewer = f.recipient;
  const one = await f.extended.openMessage(viewer.role, viewer.token, conversationId, messageId);
  const two = await f.extended.openMessage(viewer.role, viewer.token, conversationId, messageId);
  await assert.rejects(f.extended.openMessage(viewer.role, viewer.token, conversationId, messageId), code("VIDEO_BUSY"));
  const ownerRead = await f.extended.open(f.owner.role, f.owner.token, f.saved.id);
  const ownerDelivery = await f.extended.openMessage(f.owner.role, f.owner.token, conversationId, messageId);
  await assert.rejects(f.extended.open(f.owner.role, f.owner.token, f.saved.id), code("VIDEO_BUSY"));
  const third = f.accounts[2];
  await assert.rejects(f.extended.openMessage(third.role, third.token, conversationId, messageId), code("VIDEO_BUSY"));
  await one.stream().return(); await two.close(); await ownerRead.close(); await ownerDelivery.close();
  for (let i = 0; i < 4; i++) { const handle = await f.extended.openMessage(viewer.role, viewer.token, conversationId, messageId); await handle.stream().return(); }
  const afterCleanup = await f.extended.open(f.owner.role, f.owner.token, f.saved.id); await afterCleanup.close();
  f.state.rateAllowed = false;
  await assert.rejects(f.extended.openMessage(viewer.role, viewer.token, conversationId, messageId), code("VIDEO_RATE_LIMIT"));
});

test("video gallery keeps decimal cursors and current viewer URLs without exposing private metadata", async (t) => {
  const f = await fixture(t), viewer = f.recipient;
  const value = await f.extended.gallery(viewer.role, viewer.token, conversationId, { before: "9007199254740995", limit: 1 });
  assert.equal(value.items[0].sequence, "9007199254740993"); assert.equal(value.items[0].sender, "peer");
  assert.deepEqual(value.items[0].video, { id: f.saved.id, bytes: f.saved.bytes, mime: "video/mp4", contentUrl: `/api/video/client/conversations/${conversationId}/messages/${messageId}/content` });
  assert.doesNotMatch(JSON.stringify(value), /storageKey|digest|ownerId|senderId|tokenHash/);
  const previous = f.calls.length;
  for (const options of [{ before: "01" }, { before: "18446744073709551616" }, { limit: 0 }, { limit: 101 }, { limit: "1" }, { extra: true }]) {
    await assert.rejects(f.extended.gallery(viewer.role, viewer.token, conversationId, options), code("VIDEO_INPUT"));
  }
  assert.equal(f.calls.length, previous);
  f.messageState.gallery = { items: [{ messageId: Buffer.from(messageId, "hex"), sequence: "1", senderId: viewer.id, createdAt: f.state.now, asset: f.row }], nextBefore: null, hasMore: false };
  await assert.rejects(f.extended.gallery(viewer.role, viewer.token, conversationId), code("VIDEO_UNAVAILABLE"));
});


test("client video reuse is forbidden before a chat append, including historical owned IDs", async t => {
  const f = await fixture(t), input = { clientMessageId: requestId, videoId: f.saved.id, caption: "" };
  const before = f.calls.length;
  await assert.rejects(f.extended.send("client", f.recipient.token, conversationId, input), code("VIDEO_ADMIN_ONLY"));
  await assert.rejects(f.extended.send("client", f.recipient.token, conversationId, null), code("VIDEO_ADMIN_ONLY"));
  assert.equal(f.calls.length, before);
  const withWatermark = { ...input, replyThrough: "18446744073709551615" };
  await f.extended.send("admin", f.owner.token, conversationId, withWatermark);
  assert.deepEqual(f.calls.at(-1).at(-1), withWatermark);
  const versioned = { ...withWatermark, replyVersion: "4294967295" };
  await f.extended.send("admin", f.owner.token, conversationId, versioned);
  assert.deepEqual(f.calls.at(-1).at(-1), versioned);
  for (const extra of [{ replyVersion: "0" }, { replyThrough: "0", replyVersion: "4294967296" }, { replyThrough: "0", replyVersion: "01" }])
    await assert.rejects(f.extended.send("admin", f.owner.token, conversationId, { ...input, ...extra }), code("VIDEO_INPUT"));
  for (const replyThrough of [0, "01", "-1", "18446744073709551616", null])
    await assert.rejects(f.extended.send("admin", f.owner.token, conversationId, { ...input, replyThrough }), code("VIDEO_INPUT"));
});
