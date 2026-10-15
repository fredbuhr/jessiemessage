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
    storageError: null, storageRemoveError: null, rateResults: [], uploadDuplicate: false, earlyDuplicate: false,
    registered: null, removed: false, availableBytes: 100000000000n, chargedBytes: 0, objects: new Map() };
  const asset = () => ({ id: assetId, ownerId: adminId, storageKey: Buffer.alloc(32, 0x66), digest: Buffer.alloc(32, 0x77),
    width: 12, height: 8, thumbnailWidth: 12, thumbnailHeight: 8, fullBytes: 4, thumbnailBytes: 3,
    createdAt: now - 1000, deletedAt: state.removed ? now : null, sharedHere: true,
    filename: "private-original-name.jpg", email: "private-owner@example.invalid", bodyEncrypted: "private-ciphertext" });
  const record = (name, options) => { calls.push({ name, options }); if (state.storeError) throw state.storeError; };
  const store = {
    reserveAsset: async (options) => {
      record("reserveAsset", options);
      if (state.reserveError) throw state.reserveError;
      if (state.earlyDuplicate) return { duplicate: true, asset: { ...asset(), ownerId: options.role === "admin" ? adminId : clientId } };
      const bytes = options.asset.fullBytes + options.asset.thumbnailBytes + 80;
      state.objects.set(options.asset.id.toString("hex"), bytes); state.chargedBytes += bytes;
      if (state.reserveAckError) throw state.reserveAckError;
      return state.reservationResult ?? { duplicate: false, reservation: { id: options.asset.id, storageKey: options.asset.storageKey,
        bytes, pendingBytes: state.pendingBytes ?? state.chargedBytes } };
    },
    registerAsset: async (options) => {
      record("registerAsset", options); state.registered = options.asset;
      if (state.registrationError) throw state.registrationError;
      return { asset: state.uploadDuplicate ? { ...asset(), ownerId: options.role === "admin" ? adminId : clientId } : { ...options.asset, ownerId: options.role === "admin" ? adminId : clientId, createdAt: now, deletedAt: null, sharedHere: false,
        fullBytes: options.asset.fullBytes, thumbnailBytes: options.asset.thumbnailBytes }, duplicate: state.uploadDuplicate };
    },
    releaseStorageObject: async (options) => {
      record("releaseStorageObject", options); if (state.releaseError) throw state.releaseError;
      const hex = options.objectId.toString("hex");
      if (state.objects.has(hex)) { state.chargedBytes -= state.objects.get(hex); state.objects.delete(hex); }
      return state.releaseResult ?? { released: true };
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
    availableSpace: async () => {
      calls.push({ name: "storage.availableSpace" }); if (state.capacityError) throw state.capacityError;
      return state.spaceResult ?? { availableBytes: state.availableBytes };
    },
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
  for (const minimumFreeBytes of [-1, NaN, 1.5, "536870912", Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(createMediaService({ ...f.options, minimumFreeBytes }), hasCode("MEDIA_CONFIG"));
  }
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
  const [personal, , global] = f.rateCalls;
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
  assert.deepEqual(f.calls.map((call) => call.name), ["reserveAsset", "storage.availableSpace", "storage.put", "registerAsset"]);
  const stored = f.calls[2].options, registered = f.calls[3].options;
  assert.deepEqual(f.calls[0].options.asset, registered.asset);
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
  assert.deepEqual(f.calls.map((call) => call.name), ["reserveAsset", "storage.availableSpace", "storage.put"]);
});

test("ambiguous registration failure preserves proposed encrypted files instead of unlinking committed assets", async () => {
  const f = await fixture(); f.state.registrationError = Object.assign(new Error("Connection failed after private commit"), { code: "ER_CONNECTION_LOST" });
  await assert.rejects(f.service.upload("admin", f.token, await sourceImage), hasCode("MEDIA_UNAVAILABLE"));
  assert.deepEqual(f.calls.map((call) => call.name), ["reserveAsset", "storage.availableSpace", "storage.put", "registerAsset"]);
  assert.equal(f.calls.some((call) => call.name === "storage.remove"), false);
  assert.ok(f.state.chargedBytes > 0);
});

test("storage quota refusals and lost reservation acknowledgements never begin filesystem writes", async () => {
  const bytes = await sourceImage;
  for (const code of ["MEDIA_STORAGE_LIMIT", "MEDIA_CAPACITY_UNAVAILABLE", "CHAT_UNAUTHORIZED"]) {
    const f = await fixture(); f.state.reserveError = Object.assign(new Error("Private capacity account details"), { code });
    await assert.rejects(f.service.upload("admin", f.token, bytes), hasCode(code));
    assert.deepEqual(f.calls.map((call) => call.name), ["reserveAsset"]);
    assert.equal(f.state.chargedBytes, 0);
  }
  const f = await fixture(); f.state.reserveAckError = Object.assign(new Error("Private reservation committed before connection loss"), { code: "ER_CONNECTION_LOST" });
  await assert.rejects(f.service.upload("admin", f.token, bytes), hasCode("MEDIA_UNAVAILABLE"));
  assert.deepEqual(f.calls.map((call) => call.name), ["reserveAsset"]);
  assert.ok(f.state.chargedBytes > 0); assert.equal(f.state.objects.size, 1);
});

test("an early acknowledged duplicate skips capacity checks, file writes and additional capacity charges", async () => {
  const f = await fixture(); f.state.earlyDuplicate = true; f.state.availableBytes = 0n;
  const result = await f.service.upload("admin", f.token, await sourceImage);
  assert.equal(result.duplicate, true); assert.equal(result.asset.id, assetHex);
  assert.deepEqual(f.calls.map((call) => call.name), ["reserveAsset"]);
  assert.equal(f.state.chargedBytes, 0); assert.equal(f.state.objects.size, 0);
  assert.doesNotMatch(JSON.stringify(result), /storageKey|digest|ownerId|private-/);
});

test("the disk margin includes every pending reservation and uses an exact BigInt boundary", async () => {
  const f = await fixture(), pendingBytes = 2000000; f.state.pendingBytes = pendingBytes;
  f.state.availableBytes = BigInt(pendingBytes) + 536870912n - 1n;
  await assert.rejects(f.service.upload("admin", f.token, await sourceImage), hasCode("MEDIA_STORAGE_LIMIT"));
  assert.deepEqual(f.calls.map((call) => call.name), ["reserveAsset", "storage.availableSpace"]);
  assert.ok(f.state.chargedBytes > 0, "margin refusal conservatively keeps the acknowledged reservation");
  f.calls.length = 0; f.state.availableBytes += 1n;
  assert.equal((await f.service.upload("admin", f.token, await sourceImage)).duplicate, false);
  assert.deepEqual(f.calls.map((call) => call.name), ["reserveAsset", "storage.availableSpace", "storage.put", "registerAsset"]);
  const huge = await fixture(); huge.state.availableBytes = 10n ** 30n;
  const service = await createMediaService({ ...huge.options, minimumFreeBytes: Number.MAX_SAFE_INTEGER });
  const clientUpload = await service.upload("client", huge.token, await sourceImage);
  assert.equal(clientUpload.duplicate, false); assert.match(clientUpload.asset.fullUrl, /^\/api\/media\/client\/assets\//);
});

test("unavailable or malformed disk capacity fails closed after reservation without unlink or release", async () => {
  for (const space of [null, {}, { availableBytes: 1000000000 }, { availableBytes: "1000000000" }, { availableBytes: -1n }]) {
    const f = await fixture(); f.storage.availableSpace = async () => { f.calls.push({ name: "storage.availableSpace" }); return space; };
    await assert.rejects(f.service.upload("admin", f.token, await sourceImage), hasCode("MEDIA_CAPACITY_UNAVAILABLE"));
    assert.deepEqual(f.calls.map((call) => call.name), ["reserveAsset", "storage.availableSpace"]);
    assert.ok(f.state.chargedBytes > 0);
  }
  const f = await fixture(); f.state.capacityError = new Error("Private statfs path and device error");
  await assert.rejects(f.service.upload("admin", f.token, await sourceImage), (error) => hasCode("MEDIA_UNAVAILABLE")(error) && !error.message.includes("statfs"));
  assert.deepEqual(f.calls.map((call) => call.name), ["reserveAsset", "storage.availableSpace"]);
});

test("reservation acknowledgements must match the proposal and exact encrypted capacity before put", async () => {
  const corruptions = [
    () => null, () => ({}), (result) => ({ ...result, duplicate: "false" }),
    (result) => ({ ...result, reservation: null }),
    (result) => ({ ...result, reservation: { ...result.reservation, id: Buffer.alloc(16) } }),
    (result) => ({ ...result, reservation: { ...result.reservation, storageKey: Buffer.alloc(32) } }),
    (result) => ({ ...result, reservation: { ...result.reservation, bytes: result.reservation.bytes - 1 } }),
    (result) => ({ ...result, reservation: { ...result.reservation, bytes: BigInt(result.reservation.bytes) } }),
    (result) => ({ ...result, reservation: { ...result.reservation, pendingBytes: result.reservation.bytes - 1 } }),
    (result) => ({ ...result, reservation: { ...result.reservation, pendingBytes: Number.MAX_SAFE_INTEGER + 1 } }),
  ];
  for (const corrupt of corruptions) {
    const f = await fixture(), reserve = f.store.reserveAsset;
    f.store.reserveAsset = async (request) => corrupt(await reserve(request));
    await assert.rejects(f.service.upload("admin", f.token, await sourceImage), hasCode("MEDIA_UNAVAILABLE"));
    assert.deepEqual(f.calls.map((call) => call.name), ["reserveAsset"]);
    assert.ok(f.state.chargedBytes > 0, "an invalid acknowledgement does not authorize compensating release");
  }
});

test("partial file writes and unavailable registration retain their reservation without compensating cleanup", async () => {
  for (const step of ["storageError", "registrationError"]) {
    const f = await fixture(); f.state[step] = new Error("Private acknowledgement could be lost after the operation");
    await assert.rejects(f.service.upload("admin", f.token, await sourceImage), hasCode("MEDIA_UNAVAILABLE"));
    assert.ok(f.state.chargedBytes > 0); assert.equal(f.state.objects.size, 1);
    assert.equal(f.calls.some((call) => ["storage.remove", "releaseStorageObject"].includes(call.name)), false);
    assert.equal(f.calls.filter((call) => call.name === "storage.put").length, 1);
    assert.equal(f.calls.filter((call) => call.name === "registerAsset").length, step === "storageError" ? 0 : 1);
  }
});

test("confirmed owner deduplication cleans only newly proposed files and tolerates cleanup interruption", async () => {
  const f = await fixture(); f.state.uploadDuplicate = true;
  const result = await f.service.upload("admin", f.token, await sourceImage);
  assert.equal(result.duplicate, true); assert.equal(result.asset.id, assetHex);
  assert.deepEqual(f.calls.map((call) => call.name), ["reserveAsset", "storage.availableSpace", "storage.put", "registerAsset", "storage.remove", "releaseStorageObject"]);
  assert.deepEqual(f.calls[4].options.storageKey, f.calls[2].options.storageKey);
  assert.notDeepEqual(f.calls[4].options.storageKey, f.asset().storageKey);
  assert.deepEqual(f.calls[5].options.objectId, f.calls[0].options.asset.id);
  assert.equal(f.state.chargedBytes, 0);
  f.state.storageRemoveError = new Error("Private cleanup failed");
  assert.equal((await f.service.upload("admin", f.token, await sourceImage)).duplicate, true);
  assert.ok(f.state.chargedBytes > 0, "failed unlink retains the proposed object's charge");
});

test("late duplicate cleanup keeps the canonical result and holds capacity until unlink and release acknowledge", async () => {
  const f = await fixture(); f.state.uploadDuplicate = true;
  f.state.releaseError = new Error("Private release transaction failed");
  const result = await f.service.upload("admin", f.token, await sourceImage);
  assert.equal(result.asset.id, assetHex); assert.equal(result.duplicate, true);
  assert.ok(f.state.chargedBytes > 0); assert.equal(f.state.objects.size, 1);
  assert.deepEqual(f.calls.slice(-2).map((call) => call.name), ["storage.remove", "releaseStorageObject"]);
  const release = f.calls.at(-1).options, proposed = f.calls.find((call) => call.name === "reserveAsset").options.asset;
  assert.deepEqual(release.objectId, proposed.id); assert.deepEqual(release.storageKey, proposed.storageKey);
  assert.notDeepEqual(release.objectId, assetId); assert.notDeepEqual(release.storageKey, f.asset().storageKey);
});

test("malformed late duplicate acknowledgements cannot unlink a canonical key or release uncertain capacity", async () => {
  for (const field of ["both", "id", "storageKey"]) {
    const f = await fixture(), register = f.store.registerAsset;
    f.store.registerAsset = async (request) => {
      const result = await register(request);
      return { duplicate: true, asset: { ...result.asset,
        id: field === "storageKey" ? assetId : request.asset.id,
        storageKey: field === "id" ? f.asset().storageKey : request.asset.storageKey } };
    };
    await assert.rejects(f.service.upload("admin", f.token, await sourceImage), hasCode("MEDIA_UNAVAILABLE"), field);
    assert.deepEqual(f.calls.map((call) => call.name), ["reserveAsset", "storage.availableSpace", "storage.put", "registerAsset"]);
    assert.ok(f.state.chargedBytes > 0); assert.equal(f.state.objects.size, 1);
    assert.equal(f.calls.some((call) => ["storage.remove", "releaseStorageObject"].includes(call.name)), false);
  }
});

test("reserve, registration and post-unlink release use fresh clocks after asynchronous waits", async () => {
  const f = await fixture(); let current = now;
  const consume = f.options.authStore.consumeRateLimit, reserve = f.store.reserveAsset;
  const availableSpace = f.storage.availableSpace, put = f.storage.put, remove = f.storage.remove;
  f.options.authStore.consumeRateLimit = async (...args) => { const result = await consume(...args); current += 1000; return result; };
  f.store.reserveAsset = async (request) => { assert.equal(request.now, now + 2000); const result = await reserve(request); current += 2000; return result; };
  f.storage.availableSpace = async () => { const result = await availableSpace(); current += 3000; return result; };
  f.storage.put = async (request) => { await put(request); current += 4000; };
  f.storage.remove = async (request) => { await remove(request); current += 5000; };
  f.state.uploadDuplicate = true;
  const service = await createMediaService({ ...f.options, clock: () => current });
  assert.equal((await service.upload("admin", f.token, await sourceImage)).duplicate, true);
  assert.equal(f.calls.find((call) => call.name === "registerAsset").options.now, now + 11000);
  assert.equal(f.calls.find((call) => call.name === "releaseStorageObject").options.now, now + 16000);
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
  assert.deepEqual(f.calls.map((call) => call.name), ["deleteAsset", "storage.remove", "releaseStorageObject"]);
  assert.deepEqual(f.calls[1].options, { storageKey: f.asset().storageKey });
});

test("deletion retries a tombstone and releases capacity only after durable unlink with a fresh actor proof", async () => {
  const f = await fixture(); let current = now;
  f.state.objects.set(assetHex, 87); f.state.chargedBytes = 87;
  const remove = f.storage.remove;
  f.storage.remove = async (request) => { await remove(request); current += 5000; };
  const service = await createMediaService({ ...f.options, clock: () => current });
  f.state.storageRemoveError = new Error("Private unlink incomplete");
  await assert.rejects(service.removeAsset("admin", f.token, assetHex), hasCode("MEDIA_UNAVAILABLE"));
  assert.equal(f.state.removed, true); assert.equal(f.state.chargedBytes, 87);
  assert.equal(f.calls.some((call) => call.name === "releaseStorageObject"), false);
  f.state.storageRemoveError = null; f.state.releaseError = new Error("Private release unavailable"); f.calls.length = 0;
  await assert.rejects(service.removeAsset("admin", f.token, assetHex), hasCode("MEDIA_UNAVAILABLE"));
  assert.equal(f.state.chargedBytes, 87); assert.equal(f.calls.at(-1).options.now, now + 5000);
  f.state.releaseError = null; f.calls.length = 0;
  assert.deepEqual(await service.removeAsset("admin", f.token, assetHex), { deleted: true });
  assert.equal(f.state.chargedBytes, 0);
  const release = f.calls.at(-1).options;
  assert.deepEqual(release, { role: "admin", tokenHash: tokenDigest(f.token), now: now + 10000, objectId: assetId, storageKey: f.asset().storageKey });
  assert.deepEqual(await service.removeAsset("admin", f.token, assetHex), { deleted: true });
  assert.equal(f.state.chargedBytes, 0, "idempotent release never subtracts the same object twice");
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

test("upload admission is opaque, one-shot and bound to the current role and session without charging twice", async () => {
  const f = await fixture(), bytes = await sourceImage; const ticket = await f.service.admitUpload("admin", f.token);
  try {
    assert.equal(Object.getPrototypeOf(ticket), null); assert.deepEqual(Object.keys(ticket), []); assert.ok(Object.isFrozen(ticket)); assert.equal(JSON.stringify(ticket), "{}");
    await assert.rejects(f.service.upload("admin", f.token, bytes, {}), hasCode("MEDIA_INPUT")); assert.equal(f.calls.length, 0);
    assert.equal(f.rateCalls.length, 2); const result = await f.service.upload("admin", f.token, bytes, ticket); assert.equal(result.duplicate, false);
    assert.equal(f.rateCalls.length, 2, "consumption does not charge admission a second time");
    const writes = f.calls.length; await assert.rejects(f.service.upload("admin", f.token, bytes, ticket), hasCode("MEDIA_INPUT")); assert.equal(f.calls.length, writes);
    await f.service.upload("admin", f.token, bytes); assert.equal(f.rateCalls.length, 4, "direct upload still requires a new paid admission");
  } finally { f.service.releaseUpload(ticket); }
  for (const [role, raw] of [["client", f.token], ["admin", newToken()]]) {
    const admission = await f.service.admitUpload("admin", f.token);
    try { await assert.rejects(f.service.upload(role, raw, bytes, admission), hasCode("MEDIA_INPUT")); }
    finally { f.service.releaseUpload(admission); }
  }
});

test("one account keeps one upload place across sessions and service instances while three distinct accounts fit", async () => {
  const accounts = await Promise.all(Array.from({ length: 4 }, () => fixture())); const held = [];
  try {
    held.push([accounts[0].service, await accounts[0].service.admitUpload("admin", accounts[0].token)]);
    await assert.rejects(accounts[1].service.admitUpload("admin", accounts[1].token), hasCode("MEDIA_BUSY"));
    await assert.rejects(accounts[0].service.upload("admin", accounts[0].token, await sourceImage), hasCode("MEDIA_BUSY"));
    assert.equal(accounts[1].rateCalls.length, 0, "another session cannot reserve another place for the same account");
    for (let index = 1; index <= 2; index += 1) {
      accounts[index].state.idOverride = Buffer.alloc(16, 0x90 + index).toString("hex");
      held.push([accounts[index].service, await accounts[index].service.admitUpload("admin", accounts[index].token)]);
    }
    accounts[3].state.idOverride = Buffer.alloc(16, 0x93).toString("hex");
    await assert.rejects(accounts[3].service.admitUpload("admin", accounts[3].token), hasCode("MEDIA_BUSY"));
    held[0][0].releaseUpload(held[0][1]);
    held.push([accounts[3].service, await accounts[3].service.admitUpload("admin", accounts[3].token)]);
  } finally { for (const [service, ticket] of held) service.releaseUpload(ticket); }
});

test("admission places remain occupied during quota SQL and are restored after a quota refusal", async () => {
  const f = await fixture(), other = await fixture(); let completeQuota, quotaStarted;
  const started = new Promise((resolve) => { quotaStarted = resolve; });
  f.options.authStore.consumeRateLimit = async () => { quotaStarted(); return new Promise((resolve) => { completeQuota = resolve; }); };
  const pending = f.service.admitUpload("admin", f.token); await started;
  f.service.releaseUpload({}); await assert.rejects(other.service.admitUpload("admin", other.token), hasCode("MEDIA_BUSY"));
  const rejected = assert.rejects(pending, hasCode("MEDIA_RATE_LIMIT")); completeQuota({ allowed: false, retryAfter: 7 }); await rejected;
  const ticket = await other.service.admitUpload("admin", other.token); other.service.releaseUpload(ticket);
});

test("release or replay cannot free an upload while its filesystem or registration work is pending", async () => {
  const f = await fixture(), other = await fixture(); let continuePut, startedPut;
  const started = new Promise((resolve) => { startedPut = resolve; });
  const put = f.storage.put;
  f.storage.put = async (options) => { await put(options); startedPut(); await new Promise((resolve) => { continuePut = resolve; }); };
  const ticket = await f.service.admitUpload("admin", f.token); const uploaded = f.service.upload("admin", f.token, await sourceImage, ticket);
  try {
    await started; f.service.releaseUpload(ticket);
    await assert.rejects(other.service.admitUpload("admin", other.token), hasCode("MEDIA_BUSY"));
    await assert.rejects(f.service.upload("admin", f.token, await sourceImage, ticket), hasCode("MEDIA_INPUT"));
    await assert.rejects(other.service.admitUpload("admin", other.token), hasCode("MEDIA_BUSY"));
    continuePut(); await uploaded;
    const next = await other.service.admitUpload("admin", other.token); other.service.releaseUpload(next);
  } finally { continuePut?.(); await uploaded.catch(() => {}); f.service.releaseUpload(ticket); }
});

test("abandoned, invalid, expired and revoked admissions release their place without metadata writes", async () => {
  const f = await fixture(), bytes = await sourceImage;
  let ticket = await f.service.admitUpload("admin", f.token); f.service.releaseUpload(ticket); f.service.releaseUpload(ticket);
  await assert.rejects(f.service.upload("admin", f.token, bytes, ticket), hasCode("MEDIA_INPUT"));
  ticket = await f.service.admitUpload("admin", f.token); await assert.rejects(f.service.upload("admin", f.token, Buffer.alloc(0), ticket), hasCode("MEDIA_INPUT"));
  ticket = await f.service.admitUpload("admin", f.token); f.state.actorEnabled = false;
  await assert.rejects(f.service.upload("admin", f.token, bytes, ticket), hasCode("CHAT_UNAUTHORIZED")); f.state.actorEnabled = true;
  let current = now; const expiring = await createMediaService({ ...f.options, clock: () => current });
  ticket = await expiring.admitUpload("admin", f.token); current += 15000;
  await assert.rejects(expiring.upload("admin", f.token, bytes, ticket), hasCode("MEDIA_INPUT"));
  ticket = await f.service.admitUpload("admin", f.token); f.service.releaseUpload(ticket);
  assert.equal(f.calls.length, 0); assert.equal(f.rateCalls.length, 10, "each of the five abandoned attempts remains paid");
});

test("a ticket from another service cannot skip its upload budget or be substituted for a new admission", async () => {
  const f = await fixture(), other = await fixture(); const ticket = await f.service.admitUpload("admin", f.token);
  try {
    await assert.rejects(other.service.upload("admin", f.token, await sourceImage, ticket), hasCode("MEDIA_INPUT"));
    assert.equal(other.rateCalls.length, 0); assert.equal(other.calls.length, 0);
    await assert.rejects(other.service.upload("admin", other.token, await sourceImage), hasCode("MEDIA_BUSY"));
  } finally { f.service.releaseUpload(ticket); }
});

test("library and gallery reads pay persistent global and account budgets before querying metadata", async () => {
  for (const [kind, operation] of [["library", (f) => f.service.listAssets("admin", f.token)], ["gallery", (f) => f.service.gallery("admin", f.token, conversationHex)]]) {
    const f = await fixture();
    f.state.rateResults = [{ allowed: false, retryAfter: 3 }]; await assert.rejects(operation(f), hasCode("MEDIA_RATE_LIMIT"));
    f.state.rateResults = [{ allowed: true }, { allowed: false, retryAfter: 4 }]; await assert.rejects(operation(f), hasCode("MEDIA_RATE_LIMIT"));
    assert.equal(f.calls.length, 0, "neither refusal may reach metadata or filesystem");
    const personal = f.rateCalls[0], global = f.rateCalls[2];
    assert.deepEqual(global.options, { now, windowSeconds: 60, limit: 300 }); assert.deepEqual(personal.options, { now, windowSeconds: 60, limit: 60 });
    for (const [entry, name, identity] of [[global, "global-read", "all"], [personal, `user-${kind}`, adminHex]]) {
      assert.deepEqual(entry.bucket, createHmac("sha256", f.key).update("jessiemessage:media-rate:v1:").update(name).update("\0").update(identity).digest());
    }
    f.state.rateResults = [{ allowed: true }, { allowed: true }]; await operation(f); assert.equal(f.calls.length, 1);
  }
});

test("metadata read budgets are shared across sessions but distinguish library and gallery operations", async () => {
  const f = await fixture(); await f.service.listAssets("admin", f.token); await f.service.listAssets("admin", newToken()); await f.service.gallery("admin", f.token, conversationHex);
  assert.deepEqual(f.rateCalls[1].bucket, f.rateCalls[3].bucket); assert.deepEqual(f.rateCalls[1].bucket, f.rateCalls[5].bucket);
  assert.deepEqual(f.rateCalls[0].bucket, f.rateCalls[2].bucket); assert.notDeepEqual(f.rateCalls[0].bucket, f.rateCalls[4].bucket);
  assert.equal(f.rateCalls.length, 6);
});

test("an exhausted upload or metadata account cannot spend the shared allowance on refused work", async () => {
  for (const operation of [(f) => f.service.admitUpload("admin", f.token), (f) => f.service.listAssets("admin", f.token), (f) => f.service.gallery("admin", f.token, conversationHex)]) {
    const f = await fixture(); f.state.rateResults = [{ allowed: false, retryAfter: 8 }];
    await assert.rejects(operation(f), hasCode("MEDIA_RATE_LIMIT")); assert.equal(f.rateCalls.length, 1); assert.equal(f.calls.length, 0);
    const first = f.rateCalls[0]; assert.ok([10, 60].includes(first.options.limit));
  }
});

test("metadata registration uses a fresh authorization time and retains its upload place through a SQL refusal", async () => {
  const f = await fixture(), other = await fixture(); let current = now;
  const service = await createMediaService({ ...f.options, clock: () => current });
  const put = f.storage.put, register = f.store.registerAsset;
  f.storage.put = async (options) => { await put(options); current += 20000; };
  f.store.registerAsset = async (options) => {
    assert.equal(options.now, current); assert.equal(options.now, now + 20000);
    await assert.rejects(other.service.admitUpload("admin", other.token), hasCode("MEDIA_BUSY"));
    await register(options); throw Object.assign(new Error("synthetic current SQL denial"), { code: "CHAT_UNAUTHORIZED" });
  };
  await assert.rejects(service.upload("admin", f.token, await sourceImage), hasCode("CHAT_UNAUTHORIZED"));
  assert.deepEqual(f.calls.map((entry) => entry.name), ["reserveAsset", "storage.availableSpace", "storage.put", "registerAsset"]);
  assert.equal(f.calls.some((entry) => entry.name === "storage.remove"), false, "an ambiguous SQL outcome preserves the encrypted files");
  const next = await other.service.admitUpload("admin", other.token); other.service.releaseUpload(next);
});

for (const [method, operation] of [
  ["listAssets", (service, token) => service.listAssets("client", token)],
  ["gallery", (service, token) => service.gallery("client", token, conversationHex)],
]) {
  test(`${method} rechecks access at the time after its persistent quotas complete`, async () => {
    const f = await fixture(); const expiresAt = now + 1000; let current = now; let budgets = 0; const authorizations = [];
    const consume = f.options.authStore.consumeRateLimit;
    f.options.authStore.consumeRateLimit = async (...args) => {
      const result = await consume(...args);
      if (++budgets === 2) current = expiresAt;
      return result;
    };
    const read = f.store[method];
    f.store[method] = async (request) => {
      authorizations.push(request.now);
      if (request.now >= expiresAt) throw Object.assign(new Error("Synthetic current access has expired"), { code: "ACCESS_EXPIRED" });
      return read(request);
    };
    const service = await createMediaService({ ...f.options, clock: () => current });
    await assert.rejects(operation(service, f.token), hasCode("ACCESS_EXPIRED"));
    assert.equal(budgets, 2); assert.deepEqual(authorizations, [expiresAt]);
    assert.equal(f.calls.length, 0, "current SQL authorization refuses the read before any DTO or filesystem work");
  });
}

const fileOperations = [
  ["owned full image", "getOwnedAsset", (service, role, token) => service.asset(role, token, assetHex, "full")],
  ["owned thumbnail", "getOwnedAsset", (service, role, token) => service.asset(role, token, assetHex, "thumb")],
  ["delivered full image", "getMessageAsset", (service, role, token) => service.messageAsset(role, token, conversationHex, messageHex, "full")],
  ["delivered thumbnail", "getMessageAsset", (service, role, token) => service.messageAsset(role, token, conversationHex, messageHex, "thumb")],
  ["asset removal", "deleteAsset", (service, role, token) => service.removeAsset(role, token, assetHex)],
];

for (const [name, method, operation] of fileOperations) {
  test(`${name} refuses access expiring exactly while its persistent quota waits`, async () => {
    const f = await fixture(), expiresAt = now + 1000; let current = now;
    const authorizations = [], consume = f.options.authStore.consumeRateLimit, persist = f.store[method];
    f.options.authStore.consumeRateLimit = async (...args) => {
      const result = await consume(...args); current = expiresAt; return result;
    };
    f.store[method] = async (request) => {
      authorizations.push(request);
      if (request.now >= expiresAt) throw Object.assign(new Error("Synthetic current access has expired"), { code: "ACCESS_EXPIRED" });
      return persist(request);
    };
    const service = await createMediaService({ ...f.options, clock: () => current });
    await assert.rejects(operation(service, "client", f.token), hasCode("ACCESS_EXPIRED"));
    assert.equal(f.actorCalls.length, 1); assert.equal(f.rateCalls.length, 1); assert.equal(authorizations.length, 1);
    assert.equal(authorizations[0].now, expiresAt); assert.equal(authorizations[0].role, "client");
    assert.deepEqual(authorizations[0].tokenHash, tokenDigest(f.token));
    assert.equal(f.calls.length, 0, "current SQL authorization rejects before metadata changes or filesystem access");
    assert.equal(f.state.removed, false);
  });
}

test("file reads and removal recheck current SQL revocation and permissions after a pending quota", async () => {
  for (const role of ["admin", "client"]) for (const [name, method, operation] of fileOperations) {
    for (const code of ["CHAT_UNAUTHORIZED", "CHAT_FORBIDDEN"]) {
      const f = await fixture(); let current = now, revoked = false, startQuota, finishQuota;
      const started = new Promise((resolve) => { startQuota = resolve; });
      const pending = new Promise((resolve) => { finishQuota = resolve; });
      const authorizations = [], consume = f.options.authStore.consumeRateLimit, persist = f.store[method];
      f.options.authStore.consumeRateLimit = async (...args) => {
        startQuota(); await pending; return consume(...args);
      };
      f.store[method] = async (request) => {
        authorizations.push(request);
        if (revoked) throw Object.assign(new Error("Synthetic current SQL authorization revoked"), { code });
        return persist(request);
      };
      const service = await createMediaService({ ...f.options, clock: () => current });
      const attempted = operation(service, role, f.token);
      await started; revoked = true; current += 1000; finishQuota();
      await assert.rejects(attempted, hasCode(code), `${role} ${name} ${code}`);
      assert.equal(f.actorCalls.length, 1); assert.equal(f.rateCalls.length, 1); assert.equal(authorizations.length, 1);
      assert.equal(authorizations[0].now, current); assert.equal(authorizations[0].role, role);
      assert.deepEqual(authorizations[0].tokenHash, tokenDigest(f.token));
      assert.equal(f.calls.length, 0, "a previously valid preflight cannot bypass current SQL or touch storage");
      assert.equal(f.state.removed, false);
    }
  }
});

test("an invalid clock after a file quota fails before SQL authorization or filesystem access", async () => {
  for (const current of [NaN, -1, 1.5, 253402300800000]) for (const [name, , operation] of fileOperations) {
    const f = await fixture(); let sampled = now;
    const consume = f.options.authStore.consumeRateLimit;
    f.options.authStore.consumeRateLimit = async (...args) => {
      const result = await consume(...args); sampled = current; return result;
    };
    const service = await createMediaService({ ...f.options, clock: () => sampled });
    await assert.rejects(operation(service, "client", f.token), hasCode("MEDIA_UNAVAILABLE"), name);
    assert.equal(f.rateCalls.length, 1); assert.equal(f.calls.length, 0); assert.equal(f.state.removed, false);
  }
});
