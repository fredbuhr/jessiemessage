import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createChatService } from "../server/chat/service.mjs";
import { encryptMessageBody, decryptMessageBody } from "../server/chat/crypto.mjs";

async function fixture() {
  const key = randomBytes(32), senderId = randomBytes(16), conversationId = randomBytes(16), mediaId = randomBytes(16);
  const token = randomBytes(32).toString("base64url"), now = Date.now(); let saved;
  const metadata = { id: mediaId, width: 320, height: 240, thumbnailWidth: 320, thumbnailHeight: 240, fullBytes: 777, thumbnailBytes: 333 };
  const store = Object.fromEntries(["listConversations", "getClientConversation", "readMessages", "readEvents", "sendMessage", "markRead", "deleteMessage"].map((name) => [name, async () => {}]));
  store.sendMessage = async ({ message }) => {
    saved = { ...message, conversationId, senderId, senderRole: "admin", sequence: "9007199254740993", createdAt: now, deletedAt: null, media: metadata };
    return { message: saved, duplicate: false };
  };
  store.readMessages = async () => ({ conversation: { id: conversationId, clientId: randomBytes(16), clientPseudonym: "Synthetic client", peerPseudonym: "Synthetic client", createdAt: now, closedAt: null, lastActivityAt: now, latestSequence: "9007199254740993", latestEventSequence: "1", lastReadSequence: "0", peerReadSequence: "0", unreadCount: 0, canSend: true }, messages: [saved], hasMoreBefore: false, hasMoreAfter: false, nextBefore: null, nextAfter: null, eventCursor: "1" });
  const principal = { user: { id: senderId.toString("hex"), role: "admin", pseudonym: "Synthetic Jessie" }, csrf: randomBytes(32).toString("base64url"), expiresAt: now + 3600000 };
  const service = await createChatService({ store, authStore: { consumeRateLimit: async () => ({ allowed: true }) }, authService: { session: async () => principal }, accessService: { requireActiveClient: async () => null }, key, clock: () => now });
  return { service, key, token, conversationId, senderId, mediaId, metadata, now, saved: () => saved };
}

test("photo messages encrypt a caption and asset binding while exporting only authorized delivery URLs", async () => {
  const f = await fixture(), caption = "  <b>Texte littéral</b>\nصورة  ";
  const result = await f.service.sendImage("admin", f.token, f.conversationId.toString("hex"), { clientMessageId: randomBytes(16).toString("hex"), mediaId: f.mediaId.toString("hex"), caption });
  const row = f.saved();
  const payload = JSON.parse(decryptMessageBody(row.bodyEncrypted, f.key, { messageId: row.id, conversationId: f.conversationId, senderId: f.senderId }));
  assert.deepEqual(payload, { mediaId: f.mediaId.toString("hex"), caption });
  assert.equal(result.message.body, caption); assert.equal(result.message.media.id, f.mediaId.toString("hex"));
  assert.equal(result.message.media.fullUrl, `/api/media/admin/conversations/${f.conversationId.toString("hex")}/messages/${row.id.toString("hex")}/full`);
  assert.equal(JSON.stringify(result).includes("bodyEncrypted"), false); assert.equal(JSON.stringify(result).includes("storageKey"), false);
  assert.equal(result.message.sequence, "9007199254740993");
});

test("photo-only sends allow an empty caption and stored caption corruption never becomes a public input error", async () => {
  const f = await fixture(), conversation = f.conversationId.toString("hex");
  assert.equal((await f.service.sendImage("admin", f.token, conversation, { clientMessageId: randomBytes(16).toString("hex"), mediaId: f.mediaId.toString("hex"), caption: "" })).message.body, "");
  const row = f.saved(), binding = { messageId: row.id, conversationId: row.conversationId, senderId: row.senderId };
  for (const payload of [{ mediaId: randomBytes(16).toString("hex"), caption: "Other asset" }, { mediaId: f.mediaId.toString("hex"), caption: "\u0000" }, { mediaId: f.mediaId.toString("hex"), caption: "Private caption", extra: true }]) {
    row.bodyEncrypted = encryptMessageBody(JSON.stringify(payload), f.key, binding);
    await assert.rejects(f.service.messages("admin", f.token, conversation), (error) => error.code === "CHAT_UNAVAILABLE" && !error.message.includes("Private caption"));
  }
  row.deletedAt = f.now; row.bodyEncrypted = null; row.media = null;
  const tombstone = (await f.service.messages("admin", f.token, conversation)).messages[0];
  assert.equal(tombstone.body, null); assert.equal(Object.hasOwn(tombstone, "media"), false);
});

test("invalid photo captions and claimed sender properties are rejected before persistent sends", async () => {
  const f = await fixture(), input = { clientMessageId: randomBytes(16).toString("hex"), mediaId: f.mediaId.toString("hex"), caption: "valid" };
  for (const value of [null, { ...input, caption: "x".repeat(1001) }, { ...input, caption: "\u200b" }, { ...input, mediaId: `${input.mediaId}\n` }, { ...input, senderId: randomBytes(16).toString("hex") }]) {
    await assert.rejects(f.service.sendImage("admin", f.token, f.conversationId.toString("hex"), value), { code: "CHAT_INPUT" });
    assert.equal(f.saved(), undefined);
  }
});
