import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createChatService, ChatError } from "../server/chat/service.mjs";
import { encryptMessageBody, decryptMessageBody, messageFingerprint } from "../server/chat/crypto.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";

const now = 1750000000000;
const adminId = Buffer.alloc(16, 0x11), clientId = Buffer.alloc(16, 0x22), conversationId = Buffer.alloc(16, 0x33);
const adminHex = adminId.toString("hex"), clientHex = clientId.toString("hex"), conversationHex = conversationId.toString("hex");
const maximumSequence = "18446744073709551615";
const hasCode = (code) => (error) => error instanceof ChatError && error.code === code;
const conversation = () => ({
  id: conversationId, clientId, clientPseudonym: "Synthetic client", peerPseudonym: "Jessie",
  createdAt: now - 20000, closedAt: null, lastActivityAt: now,
  latestSequence: maximumSequence, latestEventSequence: maximumSequence, lastReadSequence: "9007199254740993",
  peerReadSequence: "9007199254740992", unreadCount: "2", canSend: true,
  email: "private-client@example.invalid", privateNote: "Internal-only metadata",
});

async function fixture() {
  const key = randomBytes(32), token = newToken(), calls = [], authCalls = [], rateCalls = [];
  const state = { admin: true, client: true, adminError: null, clientError: null, roleOverride: null, idOverride: null,
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
  const options = { store, authStore, authService, accessService, key, clock: () => now };
  const service = await createChatService(options);
  return { key, token, calls, authCalls, rateCalls, state, row, store, options, service };
}

test("chat service refuses absent dependencies, missing store operations and implicit keys", async () => {
  const f = await fixture();
  for (const key of [undefined, null, f.key.toString("hex"), Buffer.alloc(31), Buffer.alloc(33)]) {
    await assert.rejects(createChatService({ ...f.options, key }), hasCode("CHAT_CONFIG"));
  }
  for (const dependency of ["store", "authStore", "authService", "accessService"]) {
    await assert.rejects(createChatService({ ...f.options, [dependency]: null }), hasCode("CHAT_CONFIG"));
  }
  for (const method of Object.keys(f.store)) await assert.rejects(createChatService({ ...f.options, store: { ...f.store, [method]: undefined } }), hasCode("CHAT_CONFIG"));
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
  const [global, , personal] = f.rateCalls;
  assert.deepEqual(global.options, { now, windowSeconds: 60, limit: 300 });
  assert.deepEqual(personal.options, { now, windowSeconds: 60, limit: 30 });
  for (const [entry, name, identity] of [[global, "global-send", "all"], [personal, "user-send", adminHex]]) {
    assert.deepEqual(entry.bucket, createHmac("sha256", f.key).update("jessiemessage:chat-rate:v1:").update(name).update("\0").update(identity).digest());
    assert.equal(entry.bucket.length, 32);
  }
  const serialized = JSON.stringify(f.rateCalls);
  assert.equal(serialized.includes(body), false); assert.equal(serialized.includes(f.token), false); assert.equal(serialized.includes(adminHex), false);
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
