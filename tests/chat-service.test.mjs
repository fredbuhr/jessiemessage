import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createChatService, ChatError } from "../server/chat/service.mjs";
import { encryptMessageBody, decryptMessageBody, messageFingerprint, videoMessageFingerprint } from "../server/chat/crypto.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";

const now = 1750000000000;
const adminId = Buffer.alloc(16, 0x11), clientId = Buffer.alloc(16, 0x22), conversationId = Buffer.alloc(16, 0x33);
const adminHex = adminId.toString("hex"), clientHex = clientId.toString("hex"), conversationHex = conversationId.toString("hex");
const maximumSequence = "18446744073709551615";
const hasCode = (code) => (error) => error instanceof ChatError && error.code === code;

test("read-only video chat still sends ordinary text but refuses its lower-level video writer", async () => {
  const f = await fixture(); let videoWrites = 0;
  const service = await createChatService({ ...f.options, videoCreationEnabled: false, videoMessages: { async sendMessage() { videoWrites++; assert.fail("Video writer is closed"); } } });
  await assert.rejects(service.sendVideo("admin", f.token, conversationHex, { clientMessageId: "4".repeat(32), videoId: "5".repeat(32), caption: "Existing asset" }), hasCode("CHAT_READ_ONLY"));
  assert.equal(videoWrites, 0);
  const ordinary = await service.send("admin", f.token, conversationHex, { clientMessageId: "6".repeat(32), body: "Still an ordinary text message" });
  assert.equal(ordinary.message.body, "Still an ordinary text message");
  f.state.admin = false;
  await assert.rejects(service.sendVideo("admin", f.token, conversationHex, { clientMessageId: "4".repeat(32), videoId: "5".repeat(32), caption: "Existing asset" }), hasCode("CHAT_UNAUTHORIZED"));
});
const conversation = () => ({
  id: conversationId, clientId, clientPseudonym: "Synthetic client", peerPseudonym: "Jessie",
  createdAt: now - 20000, closedAt: null, lastActivityAt: now,
  latestSequence: maximumSequence, latestEventSequence: maximumSequence, lastReadSequence: "9007199254740993",
  peerReadSequence: "9007199254740992", unreadCount: "2", canSend: true,
  email: "private-client@example.invalid", privateNote: "Internal-only metadata",
});

async function fixture() {
  const key = randomBytes(32), token = newToken(), calls = [], authCalls = [], rateCalls = [];
  const state = { now, admin: true, client: true, adminError: null, clientError: null, roleOverride: null, idOverride: null,
    rateResults: [], rows: [], sendRow: null, rawError: null, internalMetadata: false };
  const row = (senderId, body, overrides = {}) => {
    const binding = { messageId: randomBytes(16), conversationId, senderId };
    return { id: binding.messageId, conversationId, senderId, sequence: "9007199254740993", clientMessageId: randomBytes(16),
      bodyEncrypted: encryptMessageBody(body, key, binding), bodyFingerprint: messageFingerprint(body, key, binding),
      createdAt: now, deletedAt: null, email: "private-sender@example.invalid", ...overrides };
  };
  state.rows = [row(adminId, "Synthetic admin text"), row(clientId, "Synthetic client text", { sequence: maximumSequence })];
  const record = (name, options) => { calls.push({ name, options }); if (state.rawError) throw state.rawError; };
  const store = {
    readInbox: async (options) => { record("readInbox", options); return state.inboxPage ?? { items: [{ conversation: conversation(), message: state.rows[1], unread: true }], hasMore: false, nextCursor: null }; },
    listConversations: async (options) => { record("listConversations", options); return { conversations: [conversation()], nextCursor: conversationId, hasMore: true }; },
    getClientConversation: async (options) => { record("getClientConversation", options); return state.noConversation ? null : conversation(); },
    readMessages: async (options) => {
      record("readMessages", options);
      return { conversation: conversation(), messages: state.rows, hasMoreBefore: true, hasMoreAfter: false,
        nextBefore: "9007199254740993", nextAfter: null, eventCursor: maximumSequence,
        ...(state.internalMetadata ? { email: "internal-result@example.invalid", bodyEncrypted: "internal-ciphertext", bodyFingerprint: Buffer.alloc(32) } : {}) };
    },
    readEvents: async (options) => {
      record("readEvents", options);
      return { conversation: conversation(), events: state.rows.map((message) => ({ sequence: message.sequence,
        kind: message.deletedAt === null ? "message" : "delete", occurredAt: now, message })),
      nextCursor: maximumSequence, hasMore: false };
    },
    sendMessage: async (options) => {
      record("sendMessage", options);
      if (state.sendRow) {
        if (!timingSafeEqual(state.sendRow.bodyFingerprint, options.message.bodyFingerprint)) throw Object.assign(new Error("Private conflict details"), { code: "CHAT_CONFLICT" });
        return { message: state.sendRow, duplicate: true };
      }
      state.sendRow = { ...options.message, conversationId: options.conversationId,
        senderId: options.role === "admin" ? adminId : clientId, sequence: maximumSequence,
        createdAt: now, deletedAt: null };
      return { message: state.sendRow, duplicate: false };
    },
    markRead: async (options) => { record("markRead", options); return { lastReadSequence: options.through }; },
    deleteMessage: async (options) => {
      record("deleteMessage", options);
      state.sendRow ??= { ...state.rows[0] };
      state.sendRow = { ...state.sendRow, deletedAt: now + 60000, bodyEncrypted: null };
      return state.sendRow;
    },
  };
  const authStore = { consumeRateLimit: async (bucket, options) => {
    rateCalls.push({ bucket, options });
    return state.rateResults.shift() ?? { allowed: true, retryAfter: 0 };
  } };
  const authService = { session: async (raw) => {
    authCalls.push({ kind: "admin", token: raw });
    if (state.adminError) throw state.adminError;
    return state.admin ? { user: { role: state.roleOverride ?? "admin", id: state.idOverride ?? adminHex, pseudonym: "Jessie", email: "private-admin@example.invalid" } } : null;
  } };
  const accessService = { requireActiveClient: async (raw) => {
    authCalls.push({ kind: "client", token: raw });
    if (state.clientError) throw state.clientError;
    return state.client ? { user: { role: state.roleOverride ?? "client", id: state.idOverride ?? clientHex, pseudonym: "Synthetic client" } } : null;
  } };
  const options = { store, authStore, authService, accessService, key, clock: () => state.now };
  const service = await createChatService(options);
  return { key, token, calls, authCalls, rateCalls, state, row, store, options, service };
}

test("optional video sends encrypt captions, retain stable typed retries and expose only delivery URLs", async () => {
  const f = await fixture(), videoId = "e".repeat(32), requests = [];
  assert.equal(f.service.sendVideo, undefined, "the normal service has no video send operation");
  const videoMessages = { async sendMessage(request) {
    requests.push(request);
    const result = await f.store.sendMessage(request);
    return { ...result, message: { ...result.message, video: { id: request.message.videoId, bytes: 901, mime: "video/mp4", storageKey: "internal-key" } } };
  } };
  const service = await createChatService({ ...f.options, videoMessages });
  const input = { clientMessageId: "d".repeat(32), videoId, caption: "" };
  const first = await service.sendVideo("admin", f.token, conversationHex, input);
  assert.equal(first.message.body, ""); assert.equal(first.duplicate, false);
  assert.deepEqual(first.message.video, { id: videoId, bytes: 901, mime: "video/mp4",
    contentUrl: `/api/video/admin/conversations/${conversationHex}/messages/${first.message.id}/content` });
  const request = requests[0], binding = { messageId: request.message.id, conversationId, senderId: adminId };
  const plaintext = JSON.stringify({ videoId, caption: "" });
  assert.equal(decryptMessageBody(request.message.bodyEncrypted, f.key, binding), plaintext);
  assert.deepEqual(request.message.bodyFingerprint, videoMessageFingerprint(plaintext, f.key, binding));
  const retry = await service.sendVideo("admin", f.token, conversationHex, input);
  assert.equal(retry.duplicate, true); assert.deepEqual(retry.message, first.message);
  await assert.rejects(service.sendVideo("admin", f.token, conversationHex, { ...input, caption: "different" }), hasCode("CHAT_CONFLICT"));
  for (const changed of [{ ...input, caption: "\u0000" }, { ...input, caption: "x".repeat(1001) }, { ...input, ownerId: adminHex }]) {
    await assert.rejects(service.sendVideo("admin", f.token, conversationHex, changed), hasCode("CHAT_INPUT"));
  }
});

test("video history never falls back to plaintext JSON for missing or mistyped links, and tombstones omit video", async () => {
  const f = await fixture(), videoId = Buffer.alloc(16, 0xee), payload = JSON.stringify({ videoId: videoId.toString("hex"), caption: "Légende privée" });
  const row = f.row(adminId, payload), binding = { messageId: row.id, conversationId, senderId: adminId };
  row.bodyFingerprint = videoMessageFingerprint(payload, f.key, binding);
  row.video = { id: videoId, bytes: 64, mime: "video/mp4", digest: Buffer.alloc(32) };
  f.state.rows = [row];
  const service = await createChatService({ ...f.options, videoMessages: { sendMessage: async () => { throw Error("unused"); } } });
  const result = await service.messages("client", f.token, conversationHex);
  assert.equal(result.messages[0].body, "Légende privée"); assert.equal(result.messages[0].video.id, videoId.toString("hex"));
  assert.equal(result.messages[0].clientMessageId, null); assert.doesNotMatch(JSON.stringify(result), /digest|bodyEncrypted|storageKey/);
  const orphan = { ...row }; delete orphan.video; f.state.rows = [orphan];
  await assert.rejects(service.messages("client", f.token, conversationHex), hasCode("CHAT_UNAVAILABLE"));
  f.state.rows = [{ ...row, bodyFingerprint: messageFingerprint(payload, f.key, binding) }];
  await assert.rejects(service.messages("client", f.token, conversationHex), hasCode("CHAT_UNAVAILABLE"));
  f.state.rows = [{ ...row, bodyEncrypted: null, deletedAt: now + 1 }];
  const tombstone = (await service.messages("client", f.token, conversationHex)).messages[0];
  assert.equal(tombstone.body, null); assert.equal(tombstone.video, undefined);
});

test("chat service refuses absent dependencies, missing store operations and implicit keys", async () => {
  const f = await fixture();
  for (const key of [undefined, null, f.key.toString("hex"), Buffer.alloc(31), Buffer.alloc(33)]) {
    await assert.rejects(createChatService({ ...f.options, key }), hasCode("CHAT_CONFIG"));
  }
  for (const dependency of ["store", "authStore", "authService", "accessService"]) {
    await assert.rejects(createChatService({ ...f.options, [dependency]: null }), hasCode("CHAT_CONFIG"));
  }
  for (const method of Object.keys(f.store).filter(name => name !== "readInbox")) await assert.rejects(createChatService({ ...f.options, store: { ...f.store, [method]: undefined } }), hasCode("CHAT_CONFIG"));
  await assert.rejects(createChatService({ ...f.options, clock: null }), hasCode("CHAT_CONFIG"));
  assert.ok(Object.isFrozen(f.service));
});

test("every operation rechecks current role/session and forwards only the token digest to persistent authorization", async () => {
  const f = await fixture();
  await f.service.listConversations(f.token, { afterId: conversationHex, limit: 10, userId: clientHex });
  await f.service.clientConversation(f.token);
  await f.service.messages("admin", f.token, conversationHex, { after: "0", userId: clientHex });
  await f.service.events("client", f.token, conversationHex);
  assert.deepEqual(f.authCalls.map((entry) => entry.kind), ["admin", "client", "admin", "client"]);
  assert.ok(f.authCalls.every((entry) => entry.token === f.token));
  for (const { options } of f.calls) {
    assert.deepEqual(options.tokenHash, tokenDigest(f.token)); assert.equal(options.now, now);
    assert.equal(options.token, undefined); assert.equal(options.userId, undefined); assert.equal(options.session, undefined);
  }
  assert.deepEqual(f.calls[0].options.afterId, conversationId);
  f.state.admin = false;
  const previousCalls = f.calls.length;
  await assert.rejects(f.service.messages("admin", f.token, conversationHex), hasCode("CHAT_UNAUTHORIZED"));
  assert.equal(f.calls.length, previousCalls);
  f.state.admin = true; f.state.roleOverride = "client";
  await assert.rejects(f.service.listConversations(f.token), hasCode("CHAT_UNAUTHORIZED"));
});

test("pending/expired clients, malformed tokens and unexpected principals fail before message store access", async () => {
  const f = await fixture();
  for (const code of ["ACCESS_PREREQUISITES", "ACCESS_EXPIRED"]) {
    f.state.clientError = Object.assign(new Error("Private account metadata"), { code });
    await assert.rejects(f.service.messages("client", f.token, conversationHex), hasCode(code));
  }
  f.state.clientError = null; f.state.client = false;
  await assert.rejects(f.service.clientConversation(f.token), hasCode("CHAT_UNAUTHORIZED"));
  f.state.client = true; f.state.roleOverride = "admin";
  await assert.rejects(f.service.actor("client", f.token), hasCode("CHAT_UNAUTHORIZED"));
  f.state.roleOverride = null; f.state.idOverride = "malformed-principal";
  await assert.rejects(f.service.actor("admin", f.token), hasCode("CHAT_UNAVAILABLE"));
  for (const token of [undefined, null, "", `${f.token}=`, "A".repeat(42)]) {
    await assert.rejects(f.service.actor("admin", token), hasCode("CHAT_UNAUTHORIZED"));
  }
  await assert.rejects(f.service.actor("owner", f.token), hasCode("CHAT_INPUT"));
  assert.equal(f.calls.length, 0);
});

test("conversation and message DTOs omit email/ciphertext/fingerprints and expose retry IDs only to their sender", async () => {
  const f = await fixture();
  const admin = await f.service.messages("admin", f.token, conversationHex);
  const client = await f.service.messages("client", f.token, conversationHex);
  const messageKeys = ["body", "clientMessageId", "createdAt", "deletedAt", "id", "sender", "sequence"];
  for (const result of [admin, client]) {
    for (const message of result.messages) assert.deepEqual(Object.keys(message).sort(), messageKeys);
    const serialized = JSON.stringify(result);
    for (const privateValue of ["private-client@example.invalid", "private-sender@example.invalid", "Internal-only metadata", f.state.rows[0].bodyEncrypted]) {
      assert.equal(serialized.includes(privateValue), false);
    }
    assert.equal(serialized.includes("bodyEncrypted"), false); assert.equal(serialized.includes("bodyFingerprint"), false);
  }
  assert.equal(admin.messages[0].sender, "me"); assert.equal(admin.messages[0].clientMessageId, f.state.rows[0].clientMessageId.toString("hex"));
  assert.equal(admin.messages[1].sender, "peer"); assert.equal(admin.messages[1].clientMessageId, null);
  assert.equal(client.messages[0].sender, "peer"); assert.equal(client.messages[0].clientMessageId, null);
  assert.equal(client.messages[1].sender, "me"); assert.equal(client.messages[1].clientMessageId, f.state.rows[1].clientMessageId.toString("hex"));
  assert.deepEqual(admin.conversation.client, { id: clientHex, pseudonym: "Synthetic client" });
  assert.equal(client.conversation.client, null);
  assert.equal(admin.messages[1].sequence, maximumSequence);
});

test("message response allowlists pagination fields instead of exposing internal store result metadata", async () => {
  const f = await fixture(); f.state.internalMetadata = true;
  const result = await f.service.messages("admin", f.token, conversationHex);
  assert.deepEqual(Object.keys(result).sort(), ["conversation", "eventCursor", "hasMoreAfter", "hasMoreBefore", "messages", "nextAfter", "nextBefore"]);
  assert.equal(JSON.stringify(result).includes("internal-result@example.invalid"), false);
});

test("client conversation, history and event DTOs hide administrator reads while administrator DTOs retain client receipts", async () => {
  const f = await fixture();
  const clientResults = [await f.service.clientConversation(f.token),
    (await f.service.messages("client", f.token, conversationHex)).conversation,
    (await f.service.events("client", f.token, conversationHex)).conversation];
  for (const value of clientResults) {
    assert.equal(value.peerReadSequence, "0");
    assert.equal(value.lastReadSequence, "9007199254740993", "the client's own read position still synchronizes between devices");
  }
  const adminResults = [(await f.service.listConversations(f.token)).conversations[0],
    (await f.service.messages("admin", f.token, conversationHex)).conversation,
    (await f.service.events("admin", f.token, conversationHex)).conversation];
  for (const value of adminResults) assert.equal(value.peerReadSequence, "9007199254740992");
});

test("send persists encrypted exact text with fresh binding and resolves retries to the original stored identifier", async () => {
  const f = await fixture(); const clientMessageId = randomBytes(16).toString("hex"); const body = "  Exact text\nالعربية <b>literal</b>  ";
  await assert.rejects(f.service.send("admin", f.token, conversationHex, { clientMessageId, body, senderId: clientHex }), hasCode("CHAT_INPUT"));
  assert.equal(f.calls.length, 0);
  const first = await f.service.send("admin", f.token, conversationHex, { clientMessageId, body });
  const second = await f.service.send("admin", f.token, conversationHex, { clientMessageId, body });
  assert.equal(first.duplicate, false); assert.equal(second.duplicate, true); assert.deepEqual(second.message, first.message);
  const commands = f.calls.filter((entry) => entry.name === "sendMessage").map((entry) => entry.options);
  assert.equal(commands.length, 2);
  assert.notDeepEqual(commands[0].message.id, commands[1].message.id);
  for (const command of commands) {
    const binding = { messageId: command.message.id, conversationId, senderId: adminId };
    assert.equal(decryptMessageBody(command.message.bodyEncrypted, f.key, binding), body);
    assert.deepEqual(command.message.bodyFingerprint, messageFingerprint(body, f.key, binding));
    assert.deepEqual(command.tokenHash, tokenDigest(f.token));
    assert.equal(command.senderId, undefined); assert.equal(command.message.senderId, undefined); assert.equal(command.body, undefined);
    assert.equal(JSON.stringify(command).includes(body), false);
  }
  assert.equal(first.message.id, commands[0].message.id.toString("hex"));
  await assert.rejects(f.service.send("admin", f.token, conversationHex, { clientMessageId, body: `${body}!` }), hasCode("CHAT_CONFLICT"));
});

test("send quotas use scoped secret HMAC buckets without tokens or bodies and reject before persistence", async () => {
  const f = await fixture(); const body = "Private send quota payload";
  const payload = { clientMessageId: randomBytes(16).toString("hex"), body };
  f.state.rateResults = [{ allowed: false, retryAfter: 42 }];
  await assert.rejects(f.service.send("admin", f.token, conversationHex, payload), (error) => hasCode("CHAT_RATE_LIMIT")(error) && error.retryAfter === 42);
  assert.equal(f.calls.length, 0); assert.equal(f.rateCalls.length, 1);
  f.state.rateResults = [{ allowed: true }, { allowed: false, retryAfter: 17 }];
  await assert.rejects(f.service.send("admin", f.token, conversationHex, payload), (error) => hasCode("CHAT_RATE_LIMIT")(error) && error.retryAfter === 17);
  assert.equal(f.calls.length, 0); assert.equal(f.rateCalls.length, 3);
  const [personal, , global] = f.rateCalls;
  assert.deepEqual(global.options, { now, windowSeconds: 60, limit: 300 });
  assert.deepEqual(personal.options, { now, windowSeconds: 60, limit: 30 });
  for (const [entry, name, identity] of [[global, "global-send", "all"], [personal, "user-send", adminHex]]) {
    assert.deepEqual(entry.bucket, createHmac("sha256", f.key).update("jessiemessage:chat-rate:v1:").update(name).update("\0").update(identity).digest());
    assert.equal(entry.bucket.length, 32);
  }
  const serialized = JSON.stringify(f.rateCalls);
  assert.equal(serialized.includes(body), false); assert.equal(serialized.includes(f.token), false); assert.equal(serialized.includes(adminHex), false);
});

for (const kind of ["text", "photo"]) test(`${kind} personal refusals cannot exhaust shared send capacity for another account`, async () => {
  const f = await fixture(), ledger = new Map();
  let absentConversation = true, persistenceCalls = 0;
  const authStore = { async consumeRateLimit(bucket, options) {
    const name = bucket.toString("hex"); let current = ledger.get(name);
    if (!current || options.now - current.since >= options.windowSeconds * 1000) {
      current = { since: options.now, count: 0 }; ledger.set(name, current);
    }
    current.count += 1;
    return { allowed: current.count <= options.limit, retryAfter: 60 };
  } };
  const store = { ...f.store, async sendMessage(request) {
    persistenceCalls += 1;
    if (absentConversation) throw Object.assign(new Error("Synthetic absent conversation"), { code: "CHAT_NOT_FOUND" });
    const message = { ...request.message, conversationId: request.conversationId,
      senderId: Buffer.from(f.state.idOverride, "hex"), sequence: String(persistenceCalls), createdAt: f.state.now, deletedAt: null };
    if (request.message.mediaId) message.media = { id: request.message.mediaId, width: 640, height: 480,
      thumbnailWidth: 320, thumbnailHeight: 240, fullBytes: 900, thumbnailBytes: 200 };
    if (request.message.videoId) message.video = { id: request.message.videoId, bytes: 901, mime: "video/mp4" };
    return { message, duplicate: false };
  } };
  const service = await createChatService({ ...f.options, store, authStore, videoMessages: { sendMessage: store.sendMessage } });
  const send = () => {
    const clientMessageId = randomBytes(16).toString("hex");
    if (kind === "photo") return service.sendImage("client", f.token, conversationHex,
      { clientMessageId, mediaId: "e".repeat(32), caption: "Synthetic send" });
    if (kind === "video") return service.sendVideo("client", f.token, conversationHex,
      { clientMessageId, videoId: "f".repeat(32), caption: "Synthetic send" });
    return service.send("client", f.token, conversationHex, { clientMessageId, body: "Synthetic send" });
  };
  const globalBucket = createHmac("sha256", f.key).update("jessiemessage:chat-rate:v1:")
    .update("global-send").update("\0all").digest("hex");
  f.state.idOverride = clientHex;
  for (let index = 0; index < 30; index += 1) await assert.rejects(send(), hasCode("CHAT_NOT_FOUND"));
  for (let index = 0; index < 270; index += 1) await assert.rejects(send(), hasCode("CHAT_RATE_LIMIT"));
  assert.equal(persistenceCalls, 30);
  assert.equal(ledger.get(globalBucket).count, 30, "personal refusals cannot debit the shared broadcast/manual-send bucket");
  absentConversation = false; f.state.idOverride = "b".repeat(32);
  const other = await send();
  assert.equal(other.message.body, "Synthetic send"); assert.equal(other.duplicate, false);
  assert.equal(other.message.sender, "me");
  if (kind === "photo") assert.equal(other.message.media.id, "e".repeat(32));
  if (kind === "video") assert.equal(other.message.video.id, "f".repeat(32));
  assert.equal(persistenceCalls, 31); assert.equal(ledger.get(globalBucket).count, 31);
  // Other admitted accounts really consume the remaining aggregate allowance.
  for (let index = 0; index < 269; index += 1) {
    f.state.idOverride = Buffer.alloc(16, 0x40 + Math.floor(index / 30)).toString("hex");
    await send();
  }
  assert.equal(ledger.get(globalBucket).count, 300); assert.equal(persistenceCalls, 300);
  f.state.idOverride = "9".repeat(32);
  await assert.rejects(send(), hasCode("CHAT_RATE_LIMIT"));
  assert.equal(persistenceCalls, 300, "the genuine aggregate limit still refuses before persistence");
});

test("every chat data read shares persistent global and authenticated-user budgets before private SQL reads", async (t) => {
  const reads = [
    ["list", (f) => f.service.listConversations(f.token, { userId: clientHex }), adminHex],
    ["client conversation", (f) => f.service.clientConversation(f.token), clientHex],
    ["messages", (f) => f.service.messages("admin", f.token, conversationHex, { userId: clientHex }), adminHex],
    ["events", (f) => f.service.events("client", f.token, conversationHex, { userId: adminHex }), clientHex],
  ];
  for (const [name, read, realUserId] of reads) await t.test(name, async () => {
    const f = await fixture();
    f.state.rateResults = [{ allowed: false, retryAfter: 42 }];
    await assert.rejects(read(f), (error) => hasCode("CHAT_RATE_LIMIT")(error) && error.retryAfter === 42);
    assert.equal(f.authCalls.length, 1, "a verified current principal precedes any personal quota");
    assert.equal(f.calls.length, 0, "personal denial must precede the conversation/message query");
    assert.equal(f.rateCalls.length, 1);
    f.state.rateResults = [{ allowed: true }, { allowed: false, retryAfter: 17 }];
    await assert.rejects(read(f), (error) => hasCode("CHAT_RATE_LIMIT")(error) && error.retryAfter === 17);
    assert.equal(f.calls.length, 0, "global denial must also precede the private query");
    const [personal, , global] = f.rateCalls;
    assert.deepEqual(global.options, { now, windowSeconds: 60, limit: 2400 });
    assert.deepEqual(personal.options, { now, windowSeconds: 60, limit: realUserId === adminHex ? 480 : 120 });
    for (const [entry, kind, identity] of [[global, "global-read", "all"], [personal, "user-read", realUserId]]) {
      assert.deepEqual(entry.bucket, createHmac("sha256", f.key).update("jessiemessage:chat-rate:v1:").update(kind).update("\0").update(identity).digest());
      assert.equal(entry.bucket.length, 32);
    }
    const serialized = JSON.stringify(f.rateCalls);
    for (const secret of [f.token, adminHex, clientHex, conversationHex, "Synthetic admin text", "private-client@example.invalid"]) assert.equal(serialized.includes(secret), false);
  });
});

test("session proofs and rejected principals do not consume chat read quotas", async () => {
  const f = await fixture();
  await f.service.actor("admin", f.token); await f.service.actor("client", f.token);
  assert.equal(f.rateCalls.length, 0); assert.equal(f.calls.length, 0);
  f.state.admin = false;
  for (const operation of [() => f.service.listConversations(f.token), () => f.service.messages("admin", f.token, conversationHex), () => f.service.events("admin", f.token, conversationHex)]) {
    await assert.rejects(operation(), hasCode("CHAT_UNAUTHORIZED"));
  }
  f.state.clientError = Object.assign(new Error("Private expired-access details"), { code: "ACCESS_EXPIRED" });
  for (const operation of [() => f.service.clientConversation(f.token), () => f.service.messages("client", f.token, conversationHex), () => f.service.events("client", f.token, conversationHex)]) {
    await assert.rejects(operation(), hasCode("ACCESS_EXPIRED"));
  }
  await assert.rejects(f.service.messages("client", "invalid-cookie", conversationHex), hasCode("CHAT_UNAUTHORIZED"));
  assert.equal(f.rateCalls.length, 0); assert.equal(f.calls.length, 0);
});

test("each chat read reauthorizes with time sampled after slow quotas rather than its earlier session snapshot", async () => {
  const reads = [
    ["listConversations", (service, token) => service.listConversations(token)],
    ["getClientConversation", (service, token) => service.clientConversation(token)],
    ["readMessages", (service, token) => service.messages("admin", token, conversationHex)],
    ["readEvents", (service, token) => service.events("client", token, conversationHex)],
  ];
  for (const [method, read] of reads) {
    const f = await fixture(), expiresAt = now + 1500;
    const timestamps = []; let privateReads = 0, decisions = 0;
    const store = { ...f.store, async [method](request) {
      timestamps.push(request.now);
      if (request.now >= expiresAt) throw Object.assign(new Error("Private expired-session metadata"), { code: "CHAT_UNAUTHORIZED" });
      privateReads += 1;
      return f.store[method](request);
    } };
    const service = await createChatService({ ...f.options, store, authStore: { async consumeRateLimit() {
      f.state.now += 1000; decisions += 1; return { allowed: true };
    } } });
    await assert.rejects(read(service, f.token), hasCode("CHAT_UNAUTHORIZED"), method);
    assert.deepEqual(timestamps, [now + 2000], `${method} receives the fresh time after both SQL quotas`);
    assert.equal(decisions, 2); assert.equal(privateReads, 0); assert.equal(f.calls.length, 0);
  }
});

const mutationOperations = [
  ["sendMessage", "send", (service, token, role) => service.send(role, token, conversationHex, { clientMessageId: "7".repeat(32), body: "Synthetic boundary text" })],
  ["sendMessage", "sendImage", (service, token, role) => service.sendImage(role, token, conversationHex, { clientMessageId: "7".repeat(32), mediaId: "8".repeat(32), caption: "Synthetic boundary image" })],
  ["markRead", "markRead", (service, token, role) => service.markRead(role, token, conversationHex, { throughSequence: "0" })],
  ["deleteMessage", "delete", (service, token, role) => service.delete(role, token, conversationHex, "9".repeat(32))],
];

test("each chat mutation reauthorizes at session and access deadlines reached during quota waits", async () => {
  for (const [method, name, mutation] of mutationOperations) {
    for (const role of ["admin", "client"]) for (const code of ["CHAT_UNAUTHORIZED", "CHAT_FORBIDDEN"]) for (const offset of [0, 1]) {
      const f = await fixture(), expiresAt = now + 1500, checked = [];
      let decisions = 0, mutations = 0;
      const store = { ...f.store, async [method](request) {
        checked.push(request.now);
        if (request.now >= expiresAt) throw Object.assign(new Error("Private expired authorization details"), { code });
        mutations += 1; return f.store[method](request);
      } };
      const service = await createChatService({ ...f.options, store, authStore: { async consumeRateLimit() {
        f.state.now = expiresAt + offset; decisions += 1; return { allowed: true };
      } } });
      await assert.rejects(mutation(service, f.token, role), hasCode(code), `${name}/${role}/${code}/${offset}`);
      assert.deepEqual(checked, [expiresAt + offset], name);
      assert.equal(decisions, name === "send" || name === "sendImage" ? 2 : 1);
      assert.equal(mutations, 0); assert.equal(f.calls.length, 0, "expired requests cannot mutate or replay");
    }
  }
});

test("each chat mutation fails closed before persistence if the post-quota clock becomes invalid", async () => {
  for (const [method, name, mutation] of mutationOperations) for (const invalidTime of [-1, NaN, 1.5, 253402300800000]) {
    const f = await fixture(); let decisions = 0;
    const service = await createChatService({ ...f.options, authStore: { async consumeRateLimit() {
      f.state.now = invalidTime; decisions += 1; return { allowed: true };
    } } });
    await assert.rejects(mutation(service, f.token, "admin"), hasCode("CHAT_UNAVAILABLE"), `${name}/${invalidTime}`);
    assert.equal(decisions, method === "sendMessage" ? 2 : 1);
    assert.equal(f.calls.length, 0); assert.equal(f.state.sendRow, null);
  }
});

test("chat read quotas follow the authenticated user across tokens, services and read kinds and reopen after their shared window", async () => {
  const f = await fixture(), ledger = new Map(), rateCalls = [];
  const authStore = { async consumeRateLimit(bucket, options) {
    rateCalls.push({ bucket, options });
    const name = bucket.toString("hex"); let current = ledger.get(name);
    if (!current || options.now - current.since >= options.windowSeconds * 1000) { current = { since: options.now, count: 0 }; ledger.set(name, current); }
    current.count += 1;
    return { allowed: current.count <= options.limit, retryAfter: Math.max(1, Math.ceil((current.since + options.windowSeconds * 1000 - options.now) / 1000)) };
  } };
  const first = await createChatService({ ...f.options, authStore });
  const restarted = await createChatService({ ...f.options, authStore });
  for (let index = 0; index < 480; index += 1) {
    if (index % 3 === 0) await first.listConversations(f.token);
    else if (index % 3 === 1) await first.messages("admin", f.token, conversationHex);
    else await restarted.events("admin", newToken(), conversationHex);
  }
  assert.equal(f.calls.length, 480);
  const globalBucket = createHmac("sha256", f.key).update("jessiemessage:chat-rate:v1:").update("global-read").update("\0all").digest("hex");
  assert.equal(ledger.get(globalBucket).count, 480);
  await assert.rejects(restarted.messages("admin", newToken(), conversationHex), (error) => hasCode("CHAT_RATE_LIMIT")(error) && error.retryAfter === 60);
  assert.equal(f.calls.length, 480);
  assert.equal(ledger.get(globalBucket).count, 480, "a user already at its allowance must not spend the shared global budget");
  f.state.now = now + 59999;
  await assert.rejects(first.events("admin", f.token, conversationHex), (error) => hasCode("CHAT_RATE_LIMIT")(error) && error.retryAfter === 1);
  assert.equal(f.calls.length, 480);
  assert.equal(ledger.get(globalBucket).count, 480, "repeated personal refusals cannot exhaust capacity for other users");
  f.state.now = now + 60000;
  const readable = await restarted.messages("admin", f.token, conversationHex);
  assert.equal(readable.messages[0].body, "Synthetic admin text"); assert.equal(f.calls.length, 481);
  assert.equal(ledger.size, 2, "read kinds and fresh session tokens must not create new user buckets");
  assert.ok(rateCalls.every((entry) => entry.options.windowSeconds === 60));
  const lastReadCount = rateCalls.length;
  await first.actor("admin", newToken()); assert.equal(rateCalls.length, lastReadCount);
  f.state.admin = false;
  await assert.rejects(first.messages("admin", f.token, conversationHex), hasCode("CHAT_UNAUTHORIZED"));
  assert.equal(rateCalls.length, lastReadCount, "renewed allowance must not bypass current authorization");
});

test("different verified users have separate personal read buckets and share the same global budget", async () => {
  const f = await fixture(); const otherAdmin = Buffer.alloc(16, 0x55).toString("hex");
  await f.service.messages("admin", f.token, conversationHex);
  f.state.idOverride = otherAdmin;
  await f.service.messages("admin", newToken(), conversationHex);
  f.state.idOverride = null;
  await f.service.clientConversation(newToken());
  const [userA, globalA, userB, globalB, userClient, globalClient] = f.rateCalls;
  assert.deepEqual(globalA.bucket, globalB.bucket); assert.deepEqual(globalA.bucket, globalClient.bucket);
  assert.notDeepEqual(userA.bucket, userB.bucket);
  assert.notDeepEqual(userB.bucket, userClient.bucket);
  assert.deepEqual(userClient.bucket, createHmac("sha256", f.key).update("jessiemessage:chat-rate:v1:").update("user-read").update("\0").update(clientHex).digest());
  assert.equal(f.calls.length, 3);
});

test("read rate persistence failures and malformed decisions fail closed without exposing backend details", async () => {
  for (const bad of [null, undefined, {}, { allowed: "true" }, { allowed: 1 }, { allowed: null }]) {
    const f = await fixture();
    const service = await createChatService({ ...f.options, authStore: { async consumeRateLimit() { return bad; } } });
    await assert.rejects(service.messages("admin", f.token, conversationHex), hasCode("CHAT_UNAVAILABLE"));
    assert.equal(f.calls.length, 0);
  }
  const f = await fixture();
  const service = await createChatService({ ...f.options, authStore: { async consumeRateLimit() {
    throw Object.assign(new Error("SQL password=private-rate-secret private-client@example.invalid"), { code: "ER_PRIVATE_RATE_FAILURE" });
  } } });
  await assert.rejects(service.events("admin", f.token, conversationHex), (error) => {
    assert.ok(hasCode("CHAT_UNAVAILABLE")(error)); assert.equal(error.cause, undefined);
    for (const secret of ["private-rate-secret", "private-client@example.invalid", f.token]) assert.equal(error.message.includes(secret), false);
    return true;
  });
  assert.equal(f.calls.length, 0);
  for (const [value, expected] of [[0, 1], [-1, 1], [0.1, 1], [19.2, 20], [10000, 60], [NaN, 60], ["private-sql-detail", 60]]) {
    const bounded = await createChatService({ ...f.options, authStore: { async consumeRateLimit() { return { allowed: false, retryAfter: value }; } } });
    await assert.rejects(bounded.events("admin", f.token, conversationHex), (error) => hasCode("CHAT_RATE_LIMIT")(error) && error.retryAfter === expected);
  }
});

test("chat read quotas do not consume or rename the send budgets shared with the broadcasts worker", async () => {
  const f = await fixture();
  await f.service.messages("admin", f.token, conversationHex);
  await f.service.send("admin", f.token, conversationHex, { clientMessageId: randomBytes(16).toString("hex"), body: "Synthetic independent send budget" });
  assert.equal(f.rateCalls.length, 4);
  for (const [index, name, identity, limit] of [[0, "user-read", adminHex, 480], [1, "global-read", "all", 2400], [2, "user-send", adminHex, 30], [3, "global-send", "all", 300]]) {
    assert.deepEqual(f.rateCalls[index].bucket, createHmac("sha256", f.key).update("jessiemessage:chat-rate:v1:").update(name).update("\0").update(identity).digest());
    assert.deepEqual(f.rateCalls[index].options, { now, windowSeconds: 60, limit });
  }
  assert.equal(f.calls.at(-1).name, "sendMessage");
});

test("deletion returns a tombstone without decryption and retrying the same client key never resurrects its body", async () => {
  const f = await fixture(); const clientMessageId = randomBytes(16).toString("hex"), body = "Private text to delete";
  const sent = await f.service.send("admin", f.token, conversationHex, { clientMessageId, body });
  const deleted = await f.service.delete("admin", f.token, conversationHex, sent.message.id);
  assert.equal(deleted.body, null); assert.equal(deleted.deletedAt, now + 60000);
  f.state.sendRow.bodyEncrypted = "must-not-decrypt-a-tombstone";
  const retry = await f.service.send("admin", f.token, conversationHex, { clientMessageId, body });
  assert.equal(retry.duplicate, true); assert.equal(retry.message.id, sent.message.id); assert.equal(retry.message.body, null);
  f.state.rows = [f.state.sendRow];
  assert.equal((await f.service.messages("admin", f.token, conversationHex)).messages[0].body, null);
  const events = await f.service.events("admin", f.token, conversationHex);
  assert.equal(events.events[0].kind, "delete"); assert.equal(events.events[0].message.body, null);
  assert.equal(JSON.stringify(events).includes(body), false);
});

test("message read/event/delete errors stay generic when ciphertext, binding or backend data is invalid", async () => {
  const f = await fixture(); const original = { ...f.state.rows[0] };
  const corruptions = [
    { bodyEncrypted: "private-corrupted-envelope" },
    { conversationId: randomBytes(16) }, { senderId: randomBytes(16) }, { id: randomBytes(16) },
  ];
  for (const corruption of corruptions) {
    f.state.rows = [{ ...original, ...corruption }];
    for (const operation of [() => f.service.messages("admin", f.token, conversationHex), () => f.service.events("admin", f.token, conversationHex)]) {
      await assert.rejects(operation(), (error) => {
        assert.ok(hasCode("CHAT_UNAVAILABLE")(error)); assert.equal(error.cause, undefined);
        assert.equal(error.message.includes("private-corrupted-envelope"), false); assert.equal(error.message.includes("Synthetic admin text"), false);
        return true;
      });
    }
  }
  f.state.rawError = Object.assign(new Error("SQL password=private-secret private-client@example.invalid"), { code: "ER_PRIVATE_DATABASE_ERROR" });
  await assert.rejects(f.service.clientConversation(f.token), (error) => hasCode("CHAT_UNAVAILABLE")(error) && !error.message.includes("private-secret"));
  f.state.adminError = Object.assign(new Error("Private login metadata"), { code: "AUTH_INVALID" });
  await assert.rejects(f.service.actor("admin", f.token), hasCode("CHAT_UNAUTHORIZED"));
});

test("unsigned 64-bit sequence cursors stay decimal strings beyond Number precision", async () => {
  const f = await fixture();
  const messages = await f.service.messages("admin", f.token, conversationHex, { after: maximumSequence, limit: 1 });
  const events = await f.service.events("admin", f.token, conversationHex, { after: maximumSequence, limit: 100 });
  const marked = await f.service.markRead("admin", f.token, conversationHex, { throughSequence: maximumSequence });
  assert.equal(f.calls.find((entry) => entry.name === "readMessages").options.after, maximumSequence);
  assert.equal(f.calls.find((entry) => entry.name === "readEvents").options.after, maximumSequence);
  assert.equal(f.calls.find((entry) => entry.name === "markRead").options.through, maximumSequence);
  assert.equal(messages.eventCursor, maximumSequence); assert.equal(events.nextCursor, maximumSequence); assert.equal(marked.lastReadSequence, maximumSequence);
  assert.equal(messages.conversation.latestSequence, maximumSequence);
  const updateBudget = f.rateCalls.at(-1);
  assert.deepEqual(updateBudget.options, { now, windowSeconds: 60, limit: 120 });
  assert.deepEqual(updateBudget.bucket, createHmac("sha256", f.key).update("jessiemessage:chat-rate:v1:").update("user-update").update("\0").update(adminHex).digest());
});

test("malformed identifiers, cursor aliases and limits fail before persistent operations", async () => {
  const f = await fixture();
  for (const value of [null, 0, 1, 9007199254740993n, "", "-1", "+1", "01", "1e3", "1.0", "1\n", "1\r", "1\u2028", "18446744073709551616", "0".repeat(100)]) {
    await assert.rejects(f.service.events("admin", f.token, conversationHex, { after: value }), hasCode("CHAT_INPUT"));
    await assert.rejects(f.service.markRead("admin", f.token, conversationHex, { throughSequence: value }), hasCode("CHAT_INPUT"));
  }
  for (const id of [undefined, null, conversationHex.toUpperCase().replace("3", "A"), "A".repeat(32), "0".repeat(31), `${conversationHex}\n`, `${conversationHex}\r`, `${conversationHex}\u2028`, Buffer.alloc(16)]) {
    await assert.rejects(f.service.messages("admin", f.token, id), hasCode("CHAT_INPUT"));
  }
  for (const limit of [0, 101, 1.5, "50", NaN, null]) await assert.rejects(f.service.messages("admin", f.token, conversationHex, { limit }), hasCode("CHAT_INPUT"));
  await assert.rejects(f.service.messages("admin", f.token, conversationHex, { before: "1", after: "0" }), hasCode("CHAT_INPUT"));
  await assert.rejects(f.service.send("admin", f.token, conversationHex, { clientMessageId: randomBytes(16).toString("hex"), body: "\u200b\u200d" }), hasCode("CHAT_INPUT"));
  assert.equal(f.calls.length, 0); assert.equal(f.rateCalls.length, 0);
});

test("mutation payloads reject missing arguments and claimed sender fields as sanitized input errors", async () => {
  const f = await fixture();
  const valid = { clientMessageId: randomBytes(16).toString("hex"), body: "Synthetic text" };
  for (const payload of [undefined, null, [], "text", {}, { ...valid, senderId: clientHex }, { ...valid, role: "admin" }]) {
    await assert.rejects(f.service.send("admin", f.token, conversationHex, payload), hasCode("CHAT_INPUT"));
  }
  for (const payload of [undefined, null, [], "text", {}, { throughSequence: undefined }, { throughSequence: "0", userId: clientHex }]) {
    await assert.rejects(f.service.markRead("admin", f.token, conversationHex, payload), hasCode("CHAT_INPUT"));
  }
  assert.equal(f.calls.length, 0); assert.equal(f.rateCalls.length, 0);
});

test("invalid clocks and missing conversations cannot report successful private access", async () => {
  const f = await fixture();
  f.state.noConversation = true;
  await assert.rejects(f.service.clientConversation(f.token), hasCode("CHAT_NOT_FOUND"));
  for (const clock of [() => -1, () => NaN, () => 1.5, () => 253402300800000]) {
    const service = await createChatService({ ...f.options, clock });
    const before = f.calls.length;
    await assert.rejects(service.messages("admin", f.token, conversationHex), hasCode("CHAT_UNAVAILABLE"));
    assert.equal(f.calls.length, before);
  }
});

test("six to eight administrator devices retain polling and history headroom in one persistent account budget", async () => {
  for (const devices of [6, 8]) {
    const f = await fixture(), ledger = new Map();
    const authStore = { async consumeRateLimit(bucket, options) {
      const name = bucket.toString("hex"), count = (ledger.get(name) ?? 0) + 1; ledger.set(name, count);
      return { allowed: count <= options.limit, retryAfter: 60 };
    } };
    const app = await createChatService({ ...f.options, authStore });
    const tokens = Array.from({ length: devices }, () => newToken());
    // One minute: 20 event polls, four inbox/tail reads, and 14 initial/history
    // reads on every device. They all identify the same administrator.
    for (const token of tokens) {
      for (let poll = 0; poll < 20; poll += 1) await app.events("admin", token, conversationHex);
      for (let page = 0; page < 4; page += 1) await app.listConversations(token);
      for (let page = 0; page < 14; page += 1) await app.messages("admin", token, conversationHex);
    }
    assert.equal(f.calls.length, devices * 38);
    const remaining = 480 - f.calls.length;
    for (let read = 0; read < remaining; read += 1) await app.events("admin", newToken(), conversationHex);
    await assert.rejects(app.events("admin", newToken(), conversationHex), hasCode("CHAT_RATE_LIMIT"));
    assert.equal(f.calls.length, 480, "new device tokens cannot bypass the account ceiling");
    assert.equal(ledger.size, 2, "only one personal and one global bucket are used");
  }
});


test("client video sends refuse before persistence and never consume shared send budgets", async () => {
  const f = await fixture(); let writes = 0;
  const service = await createChatService({ ...f.options, videoMessages: { async sendMessage() { writes++; } } });
  await assert.rejects(service.sendVideo("client", f.token, conversationHex, { clientMessageId: "5".repeat(32), videoId: "6".repeat(32), caption: "" }), hasCode("CHAT_FORBIDDEN"));
  assert.equal(writes, 0); assert.equal(f.rateCalls.length, 0);
});

test("conversation inbox decrypts authorized exchanges in either direction and keeps existing read quotas", async () => {
  const f = await fixture();
  const page = await f.service.inbox(f.token);
  assert.equal(page.items.length, 1); assert.equal(page.items[0].message.sender, "peer");
  assert.equal(page.items[0].message.body, "Synthetic client text");
  assert.equal(page.items[0].unread, true);
  const text = JSON.stringify(page); assert.ok(!text.includes("bodyEncrypted") && !text.includes("bodyFingerprint") && !text.includes("private-client@example.invalid"));
  assert.equal(f.calls.filter(call => call.name === "readInbox").length, 1);
  f.state.inboxPage = { items: [{ conversation: conversation(), message: f.state.rows[0], unread: true }], hasMore: false, nextCursor: null };
  const outgoing = await f.service.inbox(f.token);
  assert.equal(outgoing.items[0].message.sender, "me"); assert.equal(outgoing.items[0].message.body, "Synthetic admin text");
  assert.equal(outgoing.items[0].unread, true, "a later own preview does not change incoming unread state");
  f.state.inboxPage = { items: [{ conversation: { ...conversation(), unreadCount: 0 }, message: null, unread: false }], hasMore: false, nextCursor: null };
  const empty = await f.service.inbox(f.token);
  assert.equal(empty.items[0].message, null, "an empty preview does not enter the decryption path");
  assert.equal(empty.items[0].unread, false);
  await assert.rejects(f.service.inbox(f.token, { cursor: "invalid" }), hasCode("CHAT_INPUT"));
  await assert.rejects(f.service.inbox(f.token, { limit: 101 }), hasCode("CHAT_INPUT"));
  f.state.admin = false; await assert.rejects(f.service.inbox(f.token), hasCode("CHAT_UNAUTHORIZED"));
});

test("conversation inbox builds message-scoped photo and video previews without leaking their private descriptors", async () => {
  const f = await fixture(), assetId = Buffer.alloc(16, 0xee);
  for (const senderId of [adminId, clientId]) {
    const payload = JSON.stringify({ mediaId: assetId.toString("hex"), caption: "Photo caption" });
    const row = f.row(senderId, payload);
    row.media = { id: assetId, width: 100, height: 150, thumbnailWidth: 100, thumbnailHeight: 150,
      fullBytes: 1000, thumbnailBytes: 500, storageKey: "private-storage-key" };
    f.state.inboxPage = { items: [{ conversation: conversation(), message: row, unread: true }], hasMore: false, nextCursor: null };
    const preview = (await f.service.inbox(f.token)).items[0].message;
    assert.equal(preview.body, "Photo caption"); assert.equal(preview.sender, senderId.equals(adminId) ? "me" : "peer");
    assert.equal(preview.media.fullUrl, `/api/media/admin/conversations/${conversationHex}/messages/${row.id.toString("hex")}/full`);
    assert.doesNotMatch(JSON.stringify(preview), /private-storage-key|bodyEncrypted|bodyFingerprint/);
  }
  const payload = JSON.stringify({ videoId: assetId.toString("hex"), caption: "Video caption" });
  const row = f.row(adminId, payload);
  row.bodyFingerprint = videoMessageFingerprint(payload, f.key, { messageId: row.id, conversationId, senderId: adminId });
  row.video = { id: assetId, bytes: 1234, mime: "video/mp4", storageKey: "private-video-key" };
  f.state.inboxPage = { items: [{ conversation: conversation(), message: row, unread: true }], hasMore: false, nextCursor: null };
  const service = await createChatService({ ...f.options, videoMessages: { async sendMessage() { assert.fail("reading never sends a video"); } } });
  const preview = (await service.inbox(f.token)).items[0].message;
  assert.equal(preview.sender, "me"); assert.equal(preview.body, "Video caption");
  assert.equal(preview.video.contentUrl, `/api/video/admin/conversations/${conversationHex}/messages/${row.id.toString("hex")}/content`);
  assert.doesNotMatch(JSON.stringify(preview), /private-video-key|bodyEncrypted|bodyFingerprint/);
});
