import { createHmac } from "node:crypto";
import { csrfToken, hashPassword, newId, newToken, tokenDigest, validatePassword, verifyPassword } from "../auth/crypto.mjs";

export class PasswordError extends Error {
  constructor(code, retryAfter) {
    super("Password change could not be completed."); this.name = "PasswordError"; this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}
const fail = code => { throw new PasswordError(code); };
const validId = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);

/** Password changes never derive or replace message/media encryption keys. */
export function createPasswordService({ authService, accessService = null, authStore, accessStore = null, key, clock = Date.now }) {
  if (typeof authService?.session !== "function" || typeof authStore?.consumeRateLimit !== "function"
    || !["getPasswordChangeRecord", "changePassword"].every(name => typeof authStore?.[name] === "function")
    || accessService !== null && (typeof accessService.session !== "function" || !["getPasswordChangeRecord", "changePassword"].every(name => typeof accessStore?.[name] === "function"))
    || !Buffer.isBuffer(key) || key.length !== 32 || typeof clock !== "function") fail("PASSWORD_CONFIG");
  const rateKey = createHmac("sha256", key).update("jessiemessage:password-change-rate:v1").digest();
  const now = () => { const value = clock(); if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) fail("PASSWORD_UNAVAILABLE"); return value; };
  async function guarded(work) {
    try { return await work(); }
    catch (error) {
      if (error instanceof PasswordError) throw error;
      if (error?.code === "AUTH_BUSY") throw new PasswordError("AUTH_BUSY", 5);
      fail("PASSWORD_UNAVAILABLE");
    }
  }
  async function actor(role, token) {
    if (!["admin", "client"].includes(role) || role === "client" && accessService === null) fail("PASSWORD_AUTH_INVALID");
    try { tokenDigest(token); } catch { fail("PASSWORD_AUTH_INVALID"); }
    const value = await (role === "admin" ? authService : accessService).session(token);
    if (!value || value.user?.role !== role || !validId(value.user.id)) fail("PASSWORD_AUTH_INVALID");
    return value;
  }
  function input(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 3
      || !["currentPassword", "newPassword", "confirmation"].every(name => Object.hasOwn(value, name))) fail("PASSWORD_INPUT");
    try { validatePassword(value.newPassword); } catch { fail("PASSWORD_INVALID"); }
    if (typeof value.confirmation !== "string" || value.confirmation !== value.newPassword) fail("PASSWORD_MISMATCH");
    try { validatePassword(value.currentPassword); } catch { fail("PASSWORD_CURRENT_INVALID"); }
    return value;
  }
  return Object.freeze({
    actor: (role, token) => guarded(() => actor(role, token)),
    change: (role, token, value, { peerAddress = "unknown" } = {}) => guarded(async () => {
      const body = input(value), principal = await actor(role, token);
      const current = now(), network = typeof peerAddress === "string" && peerAddress.length <= 128 ? peerAddress : "unknown";
      for (const [kind, identity, windowSeconds, limit] of [["global", "all", 60, 60], ["account", role + ":" + principal.user.id, 900, 5], ["network", network, 900, 20]]) {
        const bucket = createHmac("sha256", rateKey).update(kind).update("\0").update(identity).digest();
        const result = await authStore.consumeRateLimit(bucket, { now: current, windowSeconds, limit });
        if (!result || typeof result.allowed !== "boolean") fail("PASSWORD_UNAVAILABLE");
        if (!result.allowed) throw new PasswordError("PASSWORD_RATE_LIMIT", Math.max(1, Math.min(900, Math.ceil(Number(result.retryAfter) || 60))));
      }
      const store = role === "admin" ? authStore : accessStore, tokenHash = tokenDigest(token);
      const record = await store.getPasswordChangeRecord(tokenHash, { now: now() });
      if (!record || !Buffer.isBuffer(record.userId) || record.userId.toString("hex") !== principal.user.id
        || typeof record.passwordHash !== "string" || !Number.isSafeInteger(record.generation)) fail("PASSWORD_AUTH_INVALID");
      if (!await verifyPassword(body.currentPassword, record.passwordHash)) fail("PASSWORD_CURRENT_INVALID");
      const passwordHash = await hashPassword(body.newPassword), rawToken = newToken();
      const result = await store.changePassword({ tokenHash, expectedPasswordHash: record.passwordHash, expectedGeneration: record.generation,
        passwordHash, session: { id: newId(), tokenHash: tokenDigest(rawToken) }, now: now() });
      if (!result) fail("PASSWORD_AUTH_INVALID");
      if (!Buffer.isBuffer(result.userId) || result.userId.toString("hex") !== principal.user.id || result.role !== role
        || typeof result.pseudonym !== "string" || result.pseudonym.length > 64 || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= now()) fail("PASSWORD_UNAVAILABLE");
      return { status: "password_changed", user: { id: principal.user.id, role, pseudonym: result.pseudonym }, expiresAt: result.expiresAt,
        csrf: csrfToken(rawToken), ...(role === "client" ? { access: result.access } : {}), token: rawToken };
    }),
  });
}
