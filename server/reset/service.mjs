import { createHmac } from "node:crypto";
import { canonicalEmail } from "../auth/config.mjs";
import { hashPassword, newId, newToken, tokenDigest } from "../auth/crypto.mjs";
import { sealResetPayload } from "./mail-crypto.mjs";

const MAX_INSTANT = 253402300799999;
const LIFETIME = 30 * 60000;
export class ResetError extends Error {
  constructor(code, retryAfter) {
    super("Client password recovery could not be completed."); this.name = "ResetError"; this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}
const fail = (code) => { throw new ResetError(code); };
function shape(input, required) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((name) => ![...required, "peerAddress"].includes(name))
    || required.some((name) => !Object.hasOwn(input, name))) fail("RESET_INPUT");
}
function validatePassword(value) {
  if (typeof value !== "string" || value.length < 14 || value.length > 128 || !value.isWellFormed()
    || Buffer.byteLength(value, "utf8") > 512) fail("RESET_INPUT");
}
function digest(value) { try { return tokenDigest(value); } catch { fail("RESET_INPUT"); } }
const validVersion = (value) => Number.isInteger(value) && value >= 1 && value < 4294967295;

export async function createResetService({ store, authStore, mailKey, clock = Date.now }) {
  if (!Buffer.isBuffer(mailKey) || mailKey.length !== 32 || typeof clock !== "function"
    || typeof authStore?.consumeRateLimit !== "function"
    || ["requestReset", "inspectReset", "consumeReset"].some((method) => typeof store?.[method] !== "function")) fail("RESET_CONFIG");
  mailKey = Buffer.from(mailKey);
  const rateKey = createHmac("sha256", mailKey).update("jessiemessage:client-recovery-rate-key:v1").digest();
  const nowValue = () => {
    const now = clock();
    if (!Number.isSafeInteger(now) || now < 0 || now > MAX_INSTANT) fail("RESET_UNAVAILABLE");
    return now;
  };
  async function guarded(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof ResetError) throw error;
      if (error?.code === "AUTH_BUSY") throw new ResetError("AUTH_BUSY", 5);
      fail("RESET_UNAVAILABLE");
    }
  }
  async function limit(kind, account, peerAddress, now) {
    const network = typeof peerAddress === "string" && peerAddress.length <= 128 ? peerAddress : "unknown-peer";
    const budgets = [["global", "all", 60, 60],
      [`${kind}:network`, network, 900, kind === "request" ? 10 : 20],
      [`${kind}:account`, account, kind === "request" ? 1800 : 900, kind === "request" ? 3 : 5]];
    for (const [name, identity, windowSeconds, maximum] of budgets) {
      const bucket = createHmac("sha256", rateKey).update(name).update("\0").update(identity).digest();
      const result = await authStore.consumeRateLimit(bucket, { now, windowSeconds, limit: maximum });
      if (!result || typeof result.allowed !== "boolean") fail("RESET_UNAVAILABLE");
      if (!result.allowed) {
        const retry = result.retryAfter;
        throw new ResetError("RESET_RATE_LIMIT", Number.isFinite(retry) ? Math.max(1, Math.min(3600, Math.ceil(retry))) : 60);
      }
    }
  }
  return Object.freeze({
    requestReset: (input = {}) => guarded(async () => {
      shape(input, ["email"]);
      if (typeof input.email !== "string" || input.email.length < 1 || input.email.length > 254 || !input.email.isWellFormed()
        || Buffer.byteLength(input.email, "utf8") > 1016) fail("RESET_INPUT");
      let email;
      try { email = canonicalEmail(input.email); } catch { email = null; }
      const quotaTime = nowValue();
      await limit("request", email ?? "invalid-email", input.peerAddress, quotaTime);
      const now = nowValue();
      if (email !== null) {
        if (now > MAX_INSTANT - LIFETIME) fail("RESET_UNAVAILABLE");
        // Generate the same encrypted candidate for every canonical address;
        // only the transaction can decide whether a current client is eligible.
        const token = newToken(), jobId = newId();
        const accepted = await store.requestReset({ email, now,
          reset: { id: newId(), tokenHash: tokenDigest(token), expiresAt: now + LIFETIME },
          mail: { id: jobId, payloadEncrypted: sealResetPayload({ email, token }, mailKey, jobId) } });
        if (typeof accepted !== "boolean") fail("RESET_UNAVAILABLE");
      }
      return { status: "accepted" };
    }),
    resetPassword: (input = {}) => guarded(async () => {
      shape(input, ["token", "password"]); validatePassword(input.password); const tokenHash = digest(input.token);
      await limit("complete", tokenHash.toString("hex"), input.peerAddress, nowValue());
      const proof = await store.inspectReset({ tokenHash, now: nowValue() });
      if (proof === null) fail("RESET_INVALID");
      if (!proof || !Buffer.isBuffer(proof.userId) || proof.userId.length !== 16 || !validVersion(proof.credentialVersion)) fail("RESET_UNAVAILABLE");
      // Expensive work is bounded by the existing global scrypt queue and only
      // starts for a live link. Nothing is reserved or consumed at inspection.
      const passwordHash = await hashPassword(input.password);
      const changed = await store.consumeReset({ tokenHash, expectedUserId: proof.userId,
        expectedVersion: proof.credentialVersion, passwordHash, now: nowValue() });
      if (changed === false) fail("RESET_INVALID");
      if (changed !== true) fail("RESET_UNAVAILABLE");
      return { status: "password_changed" };
    }),
  });
}
