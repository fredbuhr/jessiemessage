import { createHmac, timingSafeEqual } from "node:crypto";
import { tokenDigest } from "../auth/crypto.mjs";
import { canonicalProfileName, isProfileId, isProfileVersion, ownAvatarUrl, MAX_AVATAR_THUMBNAIL_BYTES } from "./validation.mjs";
import { createPreferencesService } from "../preferences/service.mjs";

export class ProfileError extends Error {
  constructor(code, retryAfter) { super("Private profile operation could not be completed."); this.name = "ProfileError"; this.code = code; if (retryAfter !== undefined) this.retryAfter = retryAfter; }
}
const fail = code => { throw new ProfileError(code); };
const allowed = new Set(["PROFILE_INPUT", "PROFILE_CONFLICT", "PROFILE_NOT_FOUND", "PROFILE_AVATAR", "CHAT_UNAUTHORIZED", "CHAT_FORBIDDEN", "CHAT_NOT_FOUND", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES", "AUTH_RATE_LIMIT", "AUTH_BUSY"]);
const id = value => { if (!isProfileId(value)) fail("PROFILE_INPUT"); return Buffer.from(value, "hex"); };

export function createProfileService({ store, chatService, storage = null, authStore, key, clock = Date.now, preferencesStore = null, preferencesKey = null }) {
  if (!["getProfile", "saveProfile", "getAvatar", "getPeerAvatar"].every(method => typeof store?.[method] === "function")
    || typeof chatService?.actor !== "function" || storage !== null && typeof storage?.get !== "function" || typeof authStore?.consumeRateLimit !== "function"
    || !Buffer.isBuffer(key) || key.length !== 32 || typeof clock !== "function") fail("PROFILE_CONFIG");
  const secret = Buffer.from(key);
  const preferences = preferencesStore === null ? null : createPreferencesService({ store: preferencesStore, chatService, authStore, key: preferencesKey, clock });
  const now = () => { const value = clock(); if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) fail("PROFILE_UNAVAILABLE"); return value; };
  async function guarded(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof ProfileError) throw error;
      if (error?.code === "AUTH_INVALID") fail("CHAT_UNAUTHORIZED");
      if (allowed.has(error?.code)) throw new ProfileError(error.code, error.retryAfter);
      fail("PROFILE_UNAVAILABLE");
    }
  }
  async function actor(role, token) {
    if (!["admin", "client"].includes(role)) fail("PROFILE_INPUT");
    try { tokenDigest(token); } catch { fail("CHAT_UNAUTHORIZED"); }
    const value = await chatService.actor(role, token);
    if (!value || value.user?.role !== role || !isProfileId(value.user.id)) fail("CHAT_UNAUTHORIZED");
    return value;
  }
  async function context(role, token, kind) {
    const value = await actor(role, token), current = now();
    for (const [name, identity, limit] of [[`user-${kind}`, value.user.id, kind === "save" ? 20 : 120], [`global-${kind}`, "all", kind === "save" ? 100 : 1200]]) {
      const bucket = createHmac("sha256", secret).update("jessiemessage:profile-rate:v1:").update(name).update("\0").update(identity).digest();
      const result = await authStore.consumeRateLimit(bucket, { now: current, windowSeconds: 60, limit });
      if (!result || typeof result.allowed !== "boolean") fail("PROFILE_UNAVAILABLE");
      if (!result.allowed) throw new ProfileError("AUTH_RATE_LIMIT", Math.max(1, Math.min(60, Math.ceil(Number(result.retryAfter) || 60))));
    }
    return { actor: value, request: { role, tokenHash: tokenDigest(token), now: now() } };
  }
  function dto(row, role, actorId) {
    if (!row || !Buffer.isBuffer(row.userId) || row.userId.toString("hex") !== actorId || !isProfileVersion(row.version)
      || !(row.avatarId === null || Buffer.isBuffer(row.avatarId) && row.avatarId.length === 16) || row.avatarId !== null && row.version === "0") fail("PROFILE_UNAVAILABLE");
    let pseudonym; try { pseudonym = canonicalProfileName(row.pseudonym); } catch { fail("PROFILE_UNAVAILABLE"); }
    if (pseudonym !== row.pseudonym) fail("PROFILE_UNAVAILABLE");
    return { pseudonym, version: row.version, avatarId: row.avatarId?.toString("hex") ?? null, avatarUrl: row.avatarId === null ? null : ownAvatarUrl(role, row.version) };
  }
  function asset(row, version) {
    if (!row || row.version !== version || !Buffer.isBuffer(row.userId) || row.userId.length !== 16
      || !Buffer.isBuffer(row.assetId) || row.assetId.length !== 16 || !Buffer.isBuffer(row.storageKey) || row.storageKey.length !== 32
      || !Number.isSafeInteger(row.thumbnailBytes) || row.thumbnailBytes < 1 || row.thumbnailBytes > MAX_AVATAR_THUMBNAIL_BYTES) fail("PROFILE_UNAVAILABLE");
    return row;
  }
  async function image(role, token, version, conversationId = null) {
    if (!isProfileVersion(version, false)) fail("PROFILE_INPUT");
    if (storage === null) fail("PROFILE_UNAVAILABLE");
    const conversation = conversationId === null ? null : id(conversationId), current = await context(role, token, "avatar");
    const read = () => (conversation === null ? store.getAvatar : store.getPeerAvatar)({ ...current.request, now: now(), version, ...(conversation === null ? {} : { conversationId: conversation }) });
    const first = asset(await read(), version);
    if (conversation === null && first.userId.toString("hex") !== current.actor.user.id) fail("PROFILE_UNAVAILABLE");
    const content = await storage.get({ assetId: first.assetId, storageKey: first.storageKey, variant: "thumb" });
    let completed = false;
    try {
      if (!Buffer.isBuffer(content) || content.length !== first.thumbnailBytes || content.length < 5
        || content[0] !== 0xff || content[1] !== 0xd8 || content[2] !== 0xff || content.at(-2) !== 0xff || content.at(-1) !== 0xd9) fail("PROFILE_UNAVAILABLE");
      // Authorization and the selected avatar may change while disk/crypto is
      // outstanding. Do not publish the previous image after that change.
      const second = asset(await read(), version);
      if (!second.userId.equals(first.userId) || !second.assetId.equals(first.assetId)
        || !timingSafeEqual(second.storageKey, first.storageKey) || second.thumbnailBytes !== first.thumbnailBytes) fail("PROFILE_NOT_FOUND");
      completed = true; return { bytes: content, mime: "image/jpeg" };
    } finally { if (!completed && Buffer.isBuffer(content)) content.fill(0); }
  }
  return Object.freeze({
    preferences,
    actor: (role, token) => guarded(() => actor(role, token)),
    profile: (role, token) => guarded(async () => {
      const value = await context(role, token, "read");
      return dto(await store.getProfile(value.request), role, value.actor.user.id);
    }),
    save: (role, token, input) => guarded(async () => {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 3
        || !["expectedVersion", "pseudonym", "avatarId"].every(key => Object.hasOwn(input, key)) || !isProfileVersion(input.expectedVersion)
        || !(input.avatarId === null || isProfileId(input.avatarId))) fail("PROFILE_INPUT");
      let pseudonym; try { pseudonym = canonicalProfileName(input.pseudonym); } catch { fail("PROFILE_INPUT"); }
      const value = await context(role, token, "save");
      if (storage === null && input.avatarId !== null) {
        const previous = await store.getProfile({ ...value.request, now: now() });
        if (!Buffer.isBuffer(previous?.avatarId) || previous.avatarId.toString("hex") !== input.avatarId) fail("PROFILE_AVATAR");
      }
      return dto(await store.saveProfile({ ...value.request, now: now(), expectedVersion: input.expectedVersion, pseudonym, avatarId: input.avatarId === null ? null : id(input.avatarId) }), role, value.actor.user.id);
    }),
    avatar: (role, token, version) => guarded(() => image(role, token, version)),
    peerAvatar: (role, token, conversationId, version) => guarded(() => image(role, token, version, conversationId)),
  });
}
