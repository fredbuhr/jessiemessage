import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import sharp from "sharp";
import { createMediaService, MediaError } from "../server/media/service.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";

const now = 1750000000000;
const adminId = Buffer.alloc(16, 0x11), clientId = Buffer.alloc(16, 0x22), conversationId = Buffer.alloc(16, 0x33);
const assetId = Buffer.alloc(16, 0x44), messageId = Buffer.alloc(16, 0x55);
const adminHex = adminId.toString("hex"), clientHex = clientId.toString("hex"), conversationHex = conversationId.toString("hex");
const assetHex = assetId.toString("hex"), messageHex = messageId.toString("hex"), maximumSequence = "18446744073709551615";
const hasCode = (code) => (error) => error instanceof MediaError && error.code === code;
const sourceImage = sharp({ create: { width: 12, height: 8, channels: 4, background: { r: 24, g: 60, b: 100, alpha: 0.75 } } }).png().toBuffer();

async function fixture() {
  const key = randomBytes(32), token = newToken(), calls = [], actorCalls = [], rateCalls = [];
  const state = { actorEnabled: true, actorError: null, roleOverride: null, idOverride: null, storeError: null,
    storageError: null, storageRemoveError: null, rateResults: [], uploadDuplicate: false, registered: null, removed: false };
  const asset = () => ({ id: assetId, ownerId: adminId, storageKey: Buffer.alloc(32, 0x66), digest: Buffer.alloc(32, 0x77),
    width: 12, height: 8, thumbnailWidth: 12, thumbnailHeight: 8, fullBytes: 4, thumbnailBytes: 3,
    createdAt: now - 1000, deletedAt: state.removed ? now : null, sharedHere: true,
    filename: "private-original-name.jpg", email: "private-owner@example.invalid", bodyEncrypted: "private-ciphertext" });
  const record = (name, options) => { calls.push({ name, options }); if (state.storeError) throw state.storeError; };
  const store = {
    registerAsset: async (options) => {
      record("registerAsset", options); state.registered = options.asset;
      return { asset: state.uploadDuplicate ? asset() : { ...options.asset, ownerId: adminId, createdAt: now, deletedAt: null, sharedHere: false,
        fullBytes: options.asset.fullBytes, thumbnailBytes: options.asset.thumbnailBytes }, duplicate: state.uploadDuplicate };
    },
    listAssets: async (options) => { record("listAssets", options); return { assets: [asset()], nextCursor: assetId, hasMore: true, storageRoot: "/private/root" }; },
    getOwnedAsset: async (options) => { record("getOwnedAsset", options); return asset(); },
    getMessageAsset: async (options) => { record("getMessageAsset", options); return asset(); },
    deleteAsset: async (options) => { record("deleteAsset", options); state.removed = true; return asset(); },
    gallery: async (options) => { record("gallery", options); return { items: [
      { messageId, sequence: maximumSequence, senderId: adminId, createdAt: now, asset: asset(), privateNote: "private-note" },
      { messageId: Buffer.alloc(16, 0x88), sequence: "9007199254740993", senderId: clientId, createdAt: now, asset: asset() },
    ], nextBefore: "9007199254740993", hasMore: true }; },
  };
  const storage = {
    put: async (options) => { calls.push({ name: "storage.put", options }); if (state.storageError) throw state.storageError; },
    get: async (options) => {
      calls.push({ name: "storage.get", options }); if (state.storageError) throw state.storageError;
      return state.storageResult ?? (options.variant === "full" ? Buffer.from([1, 2, 3, 4]) : Buffer.from([5, 6, 7]));
    },
    remove: async (options) => { calls.push({ name: "storage.remove", options }); if (state.storageRemoveError) throw state.storageRemoveError; },
  };
  const chatService = {
    actor: async (role, raw) => {
      actorCalls.push({ role, raw }); if (state.actorError) throw state.actorError;
      return state.actorEnabled ? { user: { id: state.idOverride ?? (role === "admin" ? adminHex : clientHex), role: state.roleOverride ?? role,
        pseudonym: "Synthetic actor" }, csrf: "synthetic-csrf", expiresAt: now + 10000 } : null;
    },
    sendImage: async (...args) => { calls.push({ name: "sendImage", args }); if (state.storeError) throw state.storeError; return { message: { id: messageHex }, duplicate: false }; },
  };
  const authStore = { consumeRateLimit: async (bucket, options) => {
    rateCalls.push({ bucket, options }); return state.rateResults.shift() ?? { allowed: true, retryAfter: 0 };
  } };
  const options = { store, chatService, authStore, storage, key, clock: () => now };
  const service = await createMediaService(options);
  return { key, token, calls, actorCalls, rateCalls, state, asset, store, storage, chatService, options, service };
}

test("media service requires explicit keys and every persistent/storage authorization dependency", async () => {
  const f = await fixture();
  for (const key of [undefined, null, f.key.toString("hex"), Buffer.alloc(31), Buffer.alloc(33)]) {
    await assert.rejects(createMediaService({ ...f.options, key }), hasCode("MEDIA_CONFIG"));
  }
  for (const dependency of ["store", "chatService", "authStore", "storage"]) {
    await assert.rejects(createMediaService({ ...f.options, [dependency]: null }), hasCode("MEDIA_CONFIG"));
  }
  for (const method of Object.keys(f.store)) await assert.rejects(createMediaService({ ...f.options, store: { ...f.store, [method]: undefined } }), hasCode("MEDIA_CONFIG"));
  for (const method of Object.keys(f.storage)) await assert.rejects(createMediaService({ ...f.options, storage: { ...f.storage, [method]: undefined } }), hasCode("MEDIA_CONFIG"));
  for (const method of ["actor", "sendImage"]) await assert.rejects(createMediaService({ ...f.options, chatService: { ...f.chatService, [method]: undefined } }), hasCode("MEDIA_CONFIG"));
  await assert.rejects(createMediaService({ ...f.options, clock: null }), hasCode("MEDIA_CONFIG"));
  assert.ok(Object.isFrozen(f.service));
});

test("asset operations preflight the current role and forward digest authorization without claimed ownership", async () => {
  const f = await fixture();
  await f.service.listAssets("admin", f.token, { conversationId: conversationHex, afterId: assetHex, limit: 10, ownerId: clientHex });
  await f.service.asset("client", f.token, assetHex, "thumb");
  await f.service.messageAsset("admin", f.token, conversationHex, messageHex, "full");
  await f.service.gallery("client", f.token, conversationHex);
  assert.deepEqual(f.actorCalls.map((call) => call.role), ["admin", "client", "admin", "client"]);
  assert.ok(f.actorCalls.every((call) => call.raw === f.token));
  for (const call of f.calls.filter((entry) => !entry.name.startsWith("storage."))) {
    assert.deepEqual(call.options.tokenHash, tokenDigest(f.token)); assert.equal(call.options.now, now);
    for (const field of ["ownerId", "userId", "token", "session"]) assert.equal(call.options[field], undefined);
  }
  assert.deepEqual(f.calls[0].options.conversationId, conversationId); assert.deepEqual(f.calls[0].options.afterId, assetId);
  f.state.actorEnabled = false; const count = f.calls.length;
  await assert.rejects(f.service.listAssets("admin", f.token), hasCode("CHAT_UNAUTHORIZED"));
  f.state.actorEnabled = true; f.state.roleOverride = "client";
  await assert.rejects(f.service.listAssets("admin", f.token), hasCode("CHAT_UNAUTHORIZED"));
  assert.equal(f.calls.length, count);
});

test("invalid sessions, client gates and malformed clocks fail before metadata or filesystem access", async () => {
  const f = await fixture();
  for (const code of ["AUTH_INVALID", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"]) {
    f.state.actorError = Object.assign(new Error("Private account details"), { code });
    await assert.rejects(f.service.asset("client", f.token, assetHex, "full"), hasCode(code === "AUTH_INVALID" ? "CHAT_UNAUTHORIZED" : code));
  }
  f.state.actorError = null;
  for (const token of [undefined, null, "", `${f.token}=`, "A".repeat(42)]) {
    await assert.rejects(f.service.listAssets("admin", token), hasCode("CHAT_UNAUTHORIZED"));
  }
  await assert.rejects(f.service.listAssets("owner", f.token), hasCode("MEDIA_INPUT"));
  f.state.idOverride = "malformed-backend-principal";
  await assert.rejects(f.service.listAssets("admin", f.token), hasCode("MEDIA_UNAVAILABLE"));
  f.state.idOverride = null;
  for (const clock of [() => -1, () => NaN, () => 1.5, () => 253402300800000]) {
    const service = await createMediaService({ ...f.options, clock });
    await assert.rejects(service.listAssets("admin", f.token), hasCode("MEDIA_UNAVAILABLE"));
  }
  assert.equal(f.calls.length, 0); assert.equal(f.rateCalls.length, 0);
});

test("own library and delivered galleries publish strict metadata and separate authorization URLs", async () => {
  const f = await fixture(); const own = await f.service.listAssets("admin", f.token); const gallery = await f.service.gallery("client", f.token, conversationHex);
  const fields = ["bytes", "createdAt", "fullUrl", "height", "id", "sharedHere", "thumbnailBytes", "thumbnailHeight", "thumbnailUrl", "thumbnailWidth", "width"];
  assert.deepEqual(Object.keys(own).sort(), ["assets", "hasMore", "nextCursor"]);
  assert.deepEqual(Object.keys(own.assets[0]).sort(), fields);
  assert.equal(own.assets[0].fullUrl, `/api/media/admin/assets/${assetHex}/full`);
  assert.equal(own.assets[0].thumbnailUrl, `/api/media/admin/assets/${assetHex}/thumb`);
  assert.equal(own.nextCursor, assetHex);
  assert.deepEqual(Object.keys(gallery.items[0]).sort(), ["createdAt", "media", "messageId", "sender", "sequence"]);
  assert.equal(gallery.items[0].media.fullUrl, `/api/media/client/conversations/${conversationHex}/messages/${messageHex}/full`);
  assert.equal(gallery.items[0].sender, "peer"); assert.equal(gallery.items[1].sender, "me");
  assert.equal(gallery.items[0].sequence, maximumSequence); assert.equal(gallery.nextBefore, "9007199254740993");
  const serialized = JSON.stringify({ own, gallery });
  for (const privateValue of ["storageKey", "digest", "ownerId", "private-original-name.jpg", "private-owner@example.invalid", "private-ciphertext", "private-note", "/private/root"]) assert.equal(serialized.includes(privateValue), false);
});

test("full and thumbnail reads use authorized server rows before reading storage and verify exact sizes", async () => {
  const f = await fixture();
  const own = await f.service.asset("admin", f.token, assetHex, "full");
  assert.deepEqual(own, { bytes: Buffer.from([1, 2, 3, 4]), mime: "image/jpeg" });
  const received = await f.service.messageAsset("client", f.token, conversationHex, messageHex, "thumb");
  assert.deepEqual(received, { bytes: Buffer.from([5, 6, 7]), mime: "image/jpeg" });
  assert.deepEqual(f.calls.map((call) => call.name), ["getOwnedAsset", "storage.get", "getMessageAsset", "storage.get"]);
  for (const call of f.calls.filter((entry) => entry.name === "storage.get")) {
    assert.deepEqual(call.options.assetId, assetId); assert.deepEqual(call.options.storageKey, f.asset().storageKey);
    assert.deepEqual(Object.keys(call.options).sort(), ["assetId", "storageKey", "variant"]);
  }
  for (const invalid of [Buffer.alloc(2), "not-a-buffer", null]) {
    f.state.storageResult = invalid;
    // null selects the fixture default; use a zero-length buffer for its case.
    if (invalid === null) f.state.storageResult = Buffer.alloc(0);
    await assert.rejects(f.service.asset("admin", f.token, assetHex, "full"), hasCode("MEDIA_UNAVAILABLE"));
  }
});

test("upload quotas precede native processing and use scoped private HMAC buckets", async () => {
  const f = await fixture(); const bytes = await sourceImage;
  f.state.rateResults = [{ allowed: false, retryAfter: 42 }];
  await assert.rejects(f.service.upload("admin", f.token, bytes), (error) => hasCode("MEDIA_RATE_LIMIT")(error) && error.retryAfter === 42);
  f.state.rateResults = [{ allowed: true }, { allowed: false, retryAfter: 17 }];
  await assert.rejects(f.service.upload("admin", f.token, bytes), (error) => hasCode("MEDIA_RATE_LIMIT")(error) && error.retryAfter === 17);
  assert.equal(f.calls.length, 0);
  const [global, , personal] = f.rateCalls;
  assert.deepEqual(global.options, { now, windowSeconds: 60, limit: 30 });
  assert.deepEqual(personal.options, { now, windowSeconds: 60, limit: 10 });
  for (const [call, name, identity] of [[global, "global-upload", "all"], [personal, "user-upload", adminHex]]) {
    assert.deepEqual(call.bucket, createHmac("sha256", f.key).update("jessiemessage:media-rate:v1:").update(name).update("\0").update(identity).digest());
    assert.equal(call.bucket.length, 32);
  }
  const serialized = JSON.stringify(f.rateCalls);
  assert.equal(serialized.includes(f.token), false); assert.equal(serialized.includes(adminHex), false);
});

test("synthetic uploads normalize bytes before encrypted storage and commit metadata only after storage succeeds", async () => {
  const f = await fixture(); const bytes = await sourceImage; const original = Buffer.from(bytes);
  const result = await f.service.upload("admin", f.token, bytes);
  assert.equal(result.duplicate, false); assert.deepEqual(bytes, original);
  assert.deepEqual(f.calls.map((call) => call.name), ["storage.put", "registerAsset"]);
  const stored = f.calls[0].options, registered = f.calls[1].options;
  assert.equal(stored.assetId.length, 16); assert.equal(stored.storageKey.length, 32);
  assert.deepEqual(registered.asset.id, stored.assetId); assert.deepEqual(registered.asset.storageKey, stored.storageKey);
  assert.notDeepEqual(stored.full, bytes); assert.equal(stored.full[0], 0xff); assert.equal(stored.full[1], 0xd8);
  assert.deepEqual(registered.asset.digest, createHash("sha256").update(stored.full).digest());
  assert.equal(registered.asset.fullBytes, stored.full.length); assert.equal(registered.asset.thumbnailBytes, stored.thumbnail.length);
  const metadata = await sharp(stored.full).metadata();
  assert.equal(metadata.format, "jpeg"); assert.equal(metadata.width, 12); assert.equal(metadata.height, 8);
  assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined);
  assert.equal(registered.asset.ownerId, undefined); assert.equal(registered.asset.full, undefined); assert.equal(registered.asset.filename, undefined);
  assert.equal(result.asset.id, stored.assetId.toString("hex"));
  assert.equal(JSON.stringify(result).includes("storageKey"), false); assert.equal(JSON.stringify(result).includes("digest"), false);
  f.state.storageError = new Error("Private filesystem details"); f.calls.length = 0;
  await assert.rejects(f.service.upload("admin", f.token, bytes), hasCode("MEDIA_UNAVAILABLE"));
  assert.deepEqual(f.calls.map((call) => call.name), ["storage.put"]);
});

test("ambiguous registration failure preserves proposed encrypted files instead of unlinking committed assets", async () => {
  const f = await fixture(); f.state.storeError = Object.assign(new Error("Connection failed after private commit"), { code: "ER_CONNECTION_LOST" });
  await assert.rejects(f.service.upload("admin", f.token, await sourceImage), hasCode("MEDIA_UNAVAILABLE"));
  assert.deepEqual(f.calls.map((call) => call.name), ["storage.put", "registerAsset"]);
  assert.equal(f.calls.some((call) => call.name === "storage.remove"), false);
});

test("confirmed owner deduplication cleans only newly proposed files and tolerates cleanup interruption", async () => {
  const f = await fixture(); f.state.uploadDuplicate = true;
  const result = await f.service.upload("admin", f.token, await sourceImage);
  assert.equal(result.duplicate, true); assert.equal(result.asset.id, assetHex);
  assert.deepEqual(f.calls.map((call) => call.name), ["storage.put", "registerAsset", "storage.remove"]);
  assert.deepEqual(f.calls[2].options.storageKey, f.calls[0].options.storageKey);
  assert.notDeepEqual(f.calls[2].options.storageKey, f.asset().storageKey);
  f.state.storageRemoveError = new Error("Private cleanup failed");
  assert.equal((await f.service.upload("admin", f.token, await sourceImage)).duplicate, true);
});

test("asset removal commits metadata before unlinking, denies in-use cleanup and can retry failed unlink", async () => {
  const f = await fixture();
  f.state.storeError = Object.assign(new Error("Private live reference"), { code: "MEDIA_IN_USE" });
  await assert.rejects(f.service.removeAsset("admin", f.token, assetHex), hasCode("MEDIA_IN_USE"));
  assert.equal(f.calls.some((call) => call.name === "storage.remove"), false);
  f.state.storeError = null; f.calls.length = 0; f.state.storageRemoveError = new Error("Private filesystem interruption");
  await assert.rejects(f.service.removeAsset("admin", f.token, assetHex), hasCode("MEDIA_UNAVAILABLE"));
  assert.equal(f.state.removed, true); assert.deepEqual(f.calls.map((call) => call.name), ["deleteAsset", "storage.remove"]);
  f.state.storageRemoveError = null; f.calls.length = 0;
  assert.deepEqual(await f.service.removeAsset("admin", f.token, assetHex), { deleted: true });
  assert.deepEqual(f.calls.map((call) => call.name), ["deleteAsset", "storage.remove"]);
  assert.deepEqual(f.calls[1].options, { storageKey: f.asset().storageKey });
});

test("read and removal budgets are distinct and stop before metadata or storage reads", async () => {
  const f = await fixture();
  for (const [kind, ceiling, operation] of [
    ["full", 20, () => f.service.asset("admin", f.token, assetHex, "full")],
    ["thumb", 120, () => f.service.messageAsset("admin", f.token, conversationHex, messageHex, "thumb")],
    ["delete", 30, () => f.service.removeAsset("admin", f.token, assetHex)],
  ]) {
    f.state.rateResults = [{ allowed: false, retryAfter: 4 }];
    await assert.rejects(operation(), hasCode("MEDIA_RATE_LIMIT"));
    const rate = f.rateCalls.at(-1);
    assert.deepEqual(rate.options, { now, windowSeconds: 60, limit: ceiling });
    assert.deepEqual(rate.bucket, createHmac("sha256", f.key).update("jessiemessage:media-rate:v1:").update(`user-${kind}`).update("\0").update(adminHex).digest());
  }
  assert.equal(f.calls.length, 0);
});

test("gallery uint64 cursors retain precision and reject aliases and malformed request identifiers", async () => {
  const f = await fixture();
  await f.service.gallery("admin", f.token, conversationHex, { before: maximumSequence, limit: 1 });
  assert.equal(f.calls[0].options.before, maximumSequence); assert.equal(f.calls[0].options.limit, 1);
  const count = f.calls.length;
  for (const before of [0, 1, 9007199254740993n, "", "-1", "+1", "01", "1e3", "1.0", "1\n", "1\r", "1\u2028", "18446744073709551616"]) {
    await assert.rejects(f.service.gallery("admin", f.token, conversationHex, { before }), hasCode("MEDIA_INPUT"));
  }
  for (const limit of [0, 101, 1.5, "50", null, NaN]) {
    await assert.rejects(f.service.gallery("admin", f.token, conversationHex, { limit }), hasCode("MEDIA_INPUT"));
    await assert.rejects(f.service.listAssets("admin", f.token, { limit }), hasCode("MEDIA_INPUT"));
  }
  for (const value of [undefined, null, "A".repeat(32), "0".repeat(31), `${assetHex}\n`, `${assetHex}\r`, `${assetHex}\u2028`, Buffer.alloc(16)]) {
    await assert.rejects(f.service.asset("admin", f.token, value, "full"), hasCode("MEDIA_INPUT"));
  }
  for (const variant of [undefined, null, "original", "FULL", "full\n"]) {
    await assert.rejects(f.service.asset("admin", f.token, assetHex, variant), hasCode("MEDIA_INPUT"));
  }
  assert.equal(f.calls.length, count);
});

test("input buffers are bounded before native work and unsupported/corrupted images have generic errors", async () => {
  const f = await fixture();
  for (const bytes of [undefined, null, "image", new Uint8Array([1]), Buffer.alloc(0), Buffer.alloc(10485761)]) {
    await assert.rejects(f.service.upload("admin", f.token, bytes), hasCode("MEDIA_INPUT"));
  }
  assert.equal(f.actorCalls.length, 0); assert.equal(f.rateCalls.length, 0);
  await assert.rejects(f.service.upload("admin", f.token, Buffer.from("private unsupported source bytes")), hasCode("MEDIA_FORMAT"));
  assert.equal(f.calls.length, 0);
});

test("image send delegates role, token, conversation and exact caption to authenticated chat without owner substitution", async () => {
  const f = await fixture(); const input = { clientMessageId: randomBytes(16).toString("hex"), mediaId: assetHex, caption: "  Exact image caption\nالعربية  " };
  const result = await f.service.send("client", f.token, conversationHex, input);
  assert.deepEqual(result, { message: { id: messageHex }, duplicate: false });
  assert.deepEqual(f.calls[0], { name: "sendImage", args: ["client", f.token, conversationHex, input] });
  f.state.storeError = Object.assign(new Error("Private idempotency difference"), { code: "CHAT_CONFLICT" });
  await assert.rejects(f.service.send("client", f.token, conversationHex, { ...input, caption: "" }), hasCode("CHAT_CONFLICT"));
});

test("backend and filesystem errors expose safe codes without raw SQL, image, credential or path details", async () => {
  const f = await fixture(); const privateDetails = "password=private-secret /private/storage/source.jpg private-owner@example.invalid";
  const check = (code) => (error) => {
    assert.ok(hasCode(code)(error)); assert.equal(error.message.includes(privateDetails), false); assert.equal(error.cause, undefined); return true;
  };
  f.state.storeError = Object.assign(new Error(privateDetails), { code: "ER_PRIVATE_SQL" });
  await assert.rejects(f.service.listAssets("admin", f.token), check("MEDIA_UNAVAILABLE"));
  f.state.storeError = Object.assign(new Error(privateDetails), { code: "CHAT_NOT_FOUND" });
  await assert.rejects(f.service.messageAsset("admin", f.token, conversationHex, messageHex, "full"), check("CHAT_NOT_FOUND"));
  f.state.storeError = null; f.state.storageError = Object.assign(new Error(privateDetails), { code: "ENOENT" });
  await assert.rejects(f.service.asset("admin", f.token, assetHex, "full"), check("MEDIA_UNAVAILABLE"));
  f.state.storageError = null; f.state.actorError = Object.assign(new Error(privateDetails), { code: "AUTH_INVALID" });
  await assert.rejects(f.service.actor("client", f.token), check("CHAT_UNAUTHORIZED"));
});
