import { createHmac } from "node:crypto";
import { tokenDigest } from "../auth/crypto.mjs";
import { openPreferences, sealPreferences } from "./crypto.mjs";
import { PreferencesError, failPreferences, ownerId, preferenceVersion, validatePreferencesSave, PREFERENCES_CATALOGUE_VERSION } from "./validation.mjs";
export function createPreferencesService({ store, chatService, authStore, key, clock = Date.now }) {
  if (!["read", "save", "peer"].every(name => typeof store?.[name] === "function") || typeof chatService?.actor !== "function" || typeof authStore?.consumeRateLimit !== "function" || !Buffer.isBuffer(key) || key.length !== 32) throw new TypeError("A private preferences service is required.");
  key = Buffer.from(key); let closed = false, active = 0;
  const instant = () => { const now = clock(); if (closed || !Number.isSafeInteger(now) || now < 0 || now > 253402300799999) failPreferences(); return now; };
  async function guarded(operation) {
    let admitted = false;
    try { instant(); active++; admitted = true; return await operation(); }
    catch (error) {
      if (error instanceof PreferencesError) throw error;
      if (["AUTH_INVALID", "CHAT_UNAUTHORIZED"].includes(error?.code)) failPreferences("PREFERENCES_UNAUTHORIZED");
      if (["CHAT_FORBIDDEN", "ACCESS_EXPIRED", "ACCESS_PREREQUISITES"].includes(error?.code)) failPreferences("PREFERENCES_FORBIDDEN");
      if (error?.code === "CHAT_NOT_FOUND") failPreferences("PREFERENCES_NOT_FOUND");
      failPreferences();
    }
    finally { if (admitted && --active === 0 && closed) key.fill(0); }
  }
  async function actor(role, token) {
    if (!["admin", "client"].includes(role)) failPreferences("PREFERENCES_INPUT");
    try { tokenDigest(token); } catch { failPreferences("PREFERENCES_UNAUTHORIZED"); }
    const value = await chatService.actor(role, token);
    if (value?.user?.role !== role) failPreferences("PREFERENCES_UNAUTHORIZED");
    ownerId(value.user.id); return value;
  }
  async function context(role, token, mutation) {
    const principal = await actor(role, token);
    for (const [name, identity, limit] of [[mutation ? "user-save" : "user-read", principal.user.id, mutation ? 20 : 120], [mutation ? "global-save" : "global-read", "all", mutation ? 100 : 1200]]) {
      const bucket = createHmac("sha256", key).update("jessiemessage:preferences-rate:v1:").update(name).update("\0").update(identity).digest();
      const result = await authStore.consumeRateLimit(bucket, { now: instant(), windowSeconds: 60, limit });
      if (!result || typeof result.allowed !== "boolean") failPreferences();
      if (!result.allowed) throw new PreferencesError("PREFERENCES_RATE_LIMIT", result.retryAfter);
    }
    return { principal, request: { role, tokenHash: tokenDigest(token), now: instant() } };
  }
  function dto(row, expectedOwner = null, committed = false) {
    // A late read must not reveal private data after shutdown. A positively
    // acknowledged save may still finish using the retained original key.
    if (closed && !committed) failPreferences();
    if (!row || !Buffer.isBuffer(row.userId) || row.userId.length !== 16 || expectedOwner !== null && row.userId.toString("hex") !== expectedOwner || !preferenceVersion(row.version)) failPreferences();
    const value = row.version === "0" && row.encrypted === null ? { catalogueVersion: PREFERENCES_CATALOGUE_VERSION, selectedIds: [] } : openPreferences(row.encrypted, key, row.userId.toString("hex"), row.version);
    return { version: row.version, catalogueVersion: value.catalogueVersion, selectedIds: value.selectedIds };
  }
  return Object.freeze({
    actor: (role, token) => guarded(() => actor(role, token)),
    read: (role, token) => guarded(async () => { const value = await context(role, token, false); return dto(await store.read(value.request), value.principal.user.id); }),
    save: (role, token, input) => guarded(async () => {
      const selected = validatePreferencesSave(input), value = await context(role, token, true);
      return dto(await store.save({ ...value.request, expectedVersion: selected.expectedVersion,
        // SQL may have waited for an account/row lock before this callback.
        // Refuse before encryption/write, inside the transaction's rollback.
        encrypt: (owner, version) => { instant(); return sealPreferences(selected, key, owner, version); },
        same: row => { const current = dto(row, value.principal.user.id); return current.catalogueVersion === selected.catalogueVersion && JSON.stringify(current.selectedIds) === JSON.stringify(selected.selectedIds); },
      }), value.principal.user.id, true);
    }),
    peer: (role, token, conversationId) => guarded(async () => {
      if (role !== "admin") failPreferences("PREFERENCES_FORBIDDEN");
      try { ownerId(conversationId); } catch { failPreferences("PREFERENCES_INPUT"); }
      const value = await context(role, token, false);
      return dto(await store.peer({ ...value.request, conversationId: Buffer.from(conversationId, "hex") }));
    }),
    close() { closed = true; if (active === 0) key.fill(0); },
  });
}
