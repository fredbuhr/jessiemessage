import { createHmac } from "node:crypto";
import { tokenDigest } from "../auth/crypto.mjs";
import { createPublicProfileStore } from "./store.mjs";
import { PublicProfileError, adminPublicProfile, failPublicProfile, profileVersion, publicAvatarSnapshot, publicProfileView, validatePublicProfileInput } from "./validation.mjs";

export function createPublicProfileService({ directory, chatService, authStore, profileService = null, key, clock = Date.now }, internal = {}) {
  if (typeof chatService?.actor !== "function" || typeof authStore?.consumeRateLimit !== "function" || !Buffer.isBuffer(key) || key.length !== 32
    || typeof clock !== "function") throw new TypeError("An administrative public-profile service is required.");
  const secret = Buffer.from(key), store = internal.store ?? createPublicProfileStore(directory);
  if (["read", "save"].some(name => typeof store?.[name] !== "function")) throw new TypeError("A public-profile store is required.");
  if (profileService !== null && ["profile", "avatar"].some(name => typeof profileService?.[name] !== "function")) throw new TypeError("A profile image service is required.");
  let closed = false;
  const now = () => { const value = clock(); if (closed || !Number.isSafeInteger(value) || value < 0 || value > 253402300799999) failPublicProfile(); return value; };
  async function guarded(work) {
    try { now(); return await work(); }
    catch (error) {
      if (error instanceof PublicProfileError) throw error;
      if (["AUTH_INVALID", "CHAT_UNAUTHORIZED", "PROFILE_UNAUTHORIZED"].includes(error?.code)) failPublicProfile("PUBLIC_PROFILE_UNAUTHORIZED");
      if (["CHAT_FORBIDDEN", "PROFILE_FORBIDDEN", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"].includes(error?.code)) failPublicProfile("PUBLIC_PROFILE_FORBIDDEN");
      if (["AUTH_RATE_LIMIT", "PROFILE_RATE_LIMIT"].includes(error?.code)) throw new PublicProfileError("PUBLIC_PROFILE_RATE_LIMIT", error.retryAfter);
      failPublicProfile();
    }
  }
  async function actor(token) {
    try { tokenDigest(token); } catch { failPublicProfile("PUBLIC_PROFILE_UNAUTHORIZED"); }
    const value = await chatService.actor("admin", token);
    if (value?.user?.role !== "admin" || typeof value.user.id !== "string" || !/^[a-f0-9]{32}$/.test(value.user.id)) failPublicProfile("PUBLIC_PROFILE_UNAUTHORIZED");
    return value;
  }
  async function budget(kind, identity, limit) {
    const bucket = createHmac("sha256", secret).update("jessiemessage:public-profile-rate:v1:").update(kind).update("\0").update(identity).digest();
    const value = await authStore.consumeRateLimit(bucket, { now: now(), windowSeconds: 60, limit });
    if (!value || typeof value.allowed !== "boolean") failPublicProfile();
    if (!value.allowed) throw new PublicProfileError("PUBLIC_PROFILE_RATE_LIMIT", value.retryAfter);
  }
  async function context(token, mutation) {
    const principal = await actor(token);
    await budget(mutation ? "admin-save" : "admin-read", principal.user.id, mutation ? 20 : 120);
    await budget(mutation ? "global-save" : "global-admin-read", "all", mutation ? 100 : 1200);
    return principal;
  }
  async function snapshotAvatar(token) {
    if (profileService === null) return null;
    const source = await profileService.profile("admin", token);
    if (!source || !profileVersion(source.version) || !(source.avatarId === null || typeof source.avatarId === "string" && /^[a-f0-9]{32}$/.test(source.avatarId))) failPublicProfile();
    if (source.avatarId === null) return null;
    if (source.version === "0") failPublicProfile();
    const result = await profileService.avatar("admin", token, source.version);
    try {
      if (result?.mime !== "image/jpeg") failPublicProfile();
      try { return publicAvatarSnapshot(result.bytes); } catch { failPublicProfile(); }
    } finally { if (Buffer.isBuffer(result?.bytes)) result.bytes.fill(0); }
  }
  return Object.freeze({
    actor: token => guarded(() => actor(token)),
    read: token => guarded(async () => { await context(token, false); const state = await store.read(); await actor(token); return adminPublicProfile(state); }),
    save: (token, input) => guarded(async () => {
      const value = validatePublicProfileInput(input), principal = await context(token, true), revision = Number(value.expectedVersion);
      const previous = value.published ? null : await store.read();
      const avatar = value.published ? await snapshotAvatar(token) : previous?.format === 2 ? previous.avatar : null;
      const state = { format: 2, revision, published: value.published, displayName: value.displayName, bio: value.bio,
        catalogueVersion: value.catalogueVersion, selectedIds: value.selectedIds, avatar };
      const next = await store.save(state, revision, async () => {
        // Translate authentication failures before crossing the file store's
        // sanitizer so revocation remains a typed denial, never a write.
        const fresh = await guarded(() => actor(token));
        if (fresh.user.id !== principal.user.id) failPublicProfile("PUBLIC_PROFILE_UNAUTHORIZED");
      });
      return adminPublicProfile(next);
    }),
    publicView: () => guarded(async () => {
      await budget("public-read", "all", 1200); const state = await store.read();
      return { ...publicProfileView(state), avatarVersion: state.format === 2 && state.avatar !== null ? String(state.revision) : null };
    }),
    publicAvatar: version => guarded(async () => {
      if (!profileVersion(version) || version === "0") failPublicProfile("PUBLIC_PROFILE_INPUT");
      await budget("public-avatar", "all", 1200); const state = await store.read();
      if (!state.published || state.format !== 2 || state.avatar === null || String(state.revision) !== version) failPublicProfile("PUBLIC_PROFILE_NOT_FOUND");
      return { bytes: Buffer.from(state.avatar, "base64"), mime: "image/jpeg" };
    }),
    close() { closed = true; secret.fill(0); },
  });
}
