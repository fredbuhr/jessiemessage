import test from "node:test";
import assert from "node:assert/strict";
import { ProfileError, createProfileService } from "../server/profile/service.mjs";
import { newToken, tokenDigest } from "../server/auth/crypto.mjs";

const now = 1792500000000, admin = Buffer.alloc(16, 1), client = Buffer.alloc(16, 2), conversationId = Buffer.alloc(16, 3), imageId = Buffer.alloc(16, 4);
const token = newToken(), jpeg = Buffer.from([255, 216, 255, 224, 1, 255, 217]);
const rejected = code => error => error instanceof ProfileError && error.code === code && !/secret|SELECT|example\.invalid/.test(error.message);
function fixture(changes = {}) {
  const state = { name: "Synthetic name", version: "1", avatarId: imageId, rates: [], reads: 0, storageReads: 0, ...changes }, calls = [];
  const selected = role => role === "admin" ? admin : client;
  const row = role => ({ userId: selected(role), pseudonym: state.name, version: state.version, avatarId: state.avatarId, privateNote: "secret" });
  const image = role => ({ userId: selected(role), version: state.version, assetId: imageId, storageKey: Buffer.alloc(32, 9), thumbnailBytes: jpeg.length });
  const store = {
    async getProfile(options) { calls.push(["get", options]); return row(options.role); },
    async saveProfile(options) { calls.push(["save", options]); if (state.saveError) throw state.saveError; return { ...row(options.role), pseudonym: options.pseudonym, version: "2", avatarId: options.avatarId }; },
    async getAvatar(options) { calls.push(["avatar", options]); state.reads++; if (state.avatarError) throw state.avatarError; return image(options.role); },
    async getPeerAvatar(options) { calls.push(["peer", options]); state.reads++; if (state.avatarError) throw state.avatarError; return image(options.role === "admin" ? "client" : "admin"); },
  };
  const dependencies = { store, chatService: { async actor(role, raw) {
    calls.push(["actor", role, raw]); if (state.actorError) throw state.actorError;
    return state.signedOut ? null : { user: { id: selected(role).toString("hex"), role: state.roleOverride ?? role, pseudonym: "Name" } };
  } }, storage: { async get(options) {
    calls.push(["storage", options]); state.storageReads++;
    if (state.duringRead) await state.duringRead();
    state.lastBuffer = Buffer.from(state.content ?? jpeg); return state.lastBuffer;
  } }, authStore: { async consumeRateLimit(bucket, options) { calls.push(["rate", bucket, options]); return state.rates.shift() ?? { allowed: true, retryAfter: 0 }; } }, key: Buffer.alloc(32, 11), clock: () => now };
  return { state, calls, store, dependencies, service: createProfileService(dependencies) };
}

test("profile service exposes only own display fields and canonical private avatar URL for both roles", async () => {
  const f = fixture();
  for (const role of ["admin", "client"]) {
    assert.deepEqual(await f.service.profile(role, token), { pseudonym: "Synthetic name", version: "1", avatarId: imageId.toString("hex"), avatarUrl: `/api/profile/${role}/avatar?v=1` });
    assert.deepEqual(f.calls.find(([name, options]) => name === "get" && options.role === role)[1].tokenHash, tokenDigest(token));
  }
  f.state.version = "0"; f.state.avatarId = null;
  assert.deepEqual(await f.service.profile("client", token), { pseudonym: "Synthetic name", version: "0", avatarId: null, avatarUrl: null });
});

test("profile save canonicalizes a name, selects only own media and forwards no claimed identity", async () => {
  const f = fixture();
  const result = await f.service.save("client", token, { expectedVersion: "1", pseudonym: "Jose\u0301", avatarId: imageId.toString("hex") });
  assert.equal(result.pseudonym, "José"); assert.equal(result.version, "2");
  const saved = f.calls.find(([name]) => name === "save")[1];
  assert.deepEqual(saved.avatarId, imageId); assert.equal(saved.userId, undefined); assert.deepEqual(saved.tokenHash, tokenDigest(token));
  for (const input of [null, [], {}, { expectedVersion: "1", pseudonym: "A", avatarId: null, userId: admin.toString("hex") },
    { expectedVersion: "01", pseudonym: "A", avatarId: null }, { expectedVersion: "4294967296", pseudonym: "A", avatarId: null },
    { expectedVersion: "1", pseudonym: " A", avatarId: null }, { expectedVersion: "1", pseudonym: "A\u200b", avatarId: null },
    { expectedVersion: "1", pseudonym: "A", avatarId: "unknown" }]) await assert.rejects(f.service.save("client", token, input), rejected("PROFILE_INPUT"));
});

test("profile saves preserve conflict and media errors without leaking private database details", async () => {
  const f = fixture();
  for (const code of ["PROFILE_CONFLICT", "PROFILE_NOT_FOUND", "PROFILE_AVATAR", "CHAT_FORBIDDEN"]) {
    f.state.saveError = Object.assign(new Error("SELECT secret"), { code });
    await assert.rejects(f.service.save("admin", token, { expectedVersion: "1", pseudonym: "Changed", avatarId: null }), rejected(code));
  }
  f.state.saveError = new Error("secret@example.invalid");
  await assert.rejects(f.service.save("admin", token, { expectedVersion: "1", pseudonym: "Changed", avatarId: null }), rejected("PROFILE_UNAVAILABLE"));
});

test("avatar reads use only authenticated thumbnails and reauthorize after file access", async () => {
  const f = fixture();
  for (const role of ["admin", "client"]) {
    assert.deepEqual(await f.service.avatar(role, token, "1"), { bytes: jpeg, mime: "image/jpeg" });
    assert.deepEqual(await f.service.peerAvatar(role, token, conversationId.toString("hex"), "1"), { bytes: jpeg, mime: "image/jpeg" });
  }
  assert.equal(f.state.storageReads, 4); assert.equal(f.state.reads, 8);
  assert.ok(f.calls.filter(([name]) => name === "storage").every(([, options]) => options.variant === "thumb"));
  for (const [, options] of f.calls.filter(([name]) => name === "peer")) assert.deepEqual(options.conversationId, conversationId);
});

test("avatar revocation, replacement or corrupt bytes during storage access cannot publish an old image", async () => {
  for (const mutation of ["revoked", "version", "bytes"]) {
    const f = fixture();
    f.state.duringRead = () => {
      if (mutation === "revoked") f.state.avatarError = Object.assign(new Error("secret"), { code: "CHAT_UNAUTHORIZED" });
      if (mutation === "version") f.state.version = "2";
      if (mutation === "bytes") f.state.content = Buffer.from("invalid");
    };
    await assert.rejects(f.service.avatar("client", token, "1"), rejected(mutation === "revoked" ? "CHAT_UNAUTHORIZED" : "PROFILE_UNAVAILABLE"));
    assert.ok(f.state.lastBuffer.every(byte => byte === 0));
  }
});

test("profiles remain editable with media disabled; avatar replacement is refused and existing avatar may be kept or removed", async () => {
  const f = fixture(), service = createProfileService({ ...f.dependencies, storage: null });
  assert.equal((await service.profile("client", token)).pseudonym, "Synthetic name");
  assert.equal((await service.save("client", token, { expectedVersion: "1", pseudonym: "Changed", avatarId: imageId.toString("hex") })).version, "2");
  await service.save("client", token, { expectedVersion: "1", pseudonym: "Changed", avatarId: null });
  await assert.rejects(service.save("client", token, { expectedVersion: "1", pseudonym: "Changed", avatarId: admin.toString("hex") }), rejected("PROFILE_AVATAR"));
  await assert.rejects(service.avatar("client", token, "1"), rejected("PROFILE_UNAVAILABLE"));
  assert.equal(f.state.storageReads, 0);
});

test("authentication and account budget failures precede profile or filesystem operations", async () => {
  for (const changes of [{ signedOut: true }, { roleOverride: "wrong" }, { rates: [{ allowed: false, retryAfter: 3 }] }]) {
    const f = fixture(changes);
    await assert.rejects(f.service.profile("client", token), rejected(changes.rates ? "AUTH_RATE_LIMIT" : "CHAT_UNAUTHORIZED"));
    assert.equal(f.calls.some(([name]) => ["get", "storage", "save"].includes(name)), false);
  }
});
