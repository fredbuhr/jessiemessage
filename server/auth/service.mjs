import { createHmac } from "node:crypto";
import { canonicalEmail } from "./config.mjs";
import { csrfToken, hashPassword, newId, newToken, openTotpSecret, recoveryCodeDigest, tokenDigest, verifyPassword, verifyTotp } from "./crypto.mjs";

export class AuthError extends Error {
  constructor(code, retryAfter) {
    super("Authentication could not be completed.");
    this.name = "AuthError";
    this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

const invalid = () => new AuthError("AUTH_INVALID");
const unavailable = () => new AuthError("AUTH_UNAVAILABLE");
const SESSION_SECONDS = 8 * 60 * 60;
const IDLE_SECONDS = 30 * 60;

// One private, random dummy hash per process keeps nonexistent accounts on the
// same bounded password-work path as existing administrators.
export async function createAuthService({ store, totpKey, clock = Date.now }) {
  if (!store || !Buffer.isBuffer(totpKey) || totpKey.length !== 32 || typeof clock !== "function") throw unavailable();
  const dummyHash = await hashPassword(newToken());
  const rateKey = createHmac("sha256", totpKey).update("jessiemessage:rate-key:v1").digest();
  const bucket = (kind, value) => createHmac("sha256", rateKey).update(`${kind}:`).update(value).digest();

  async function database(work) {
    try { return await work(); } catch { throw unavailable(); }
  }
  function publicSession(record, rawToken) {
    return { user: { id: record.userId.toString("hex"), role: record.role, pseudonym: record.pseudonym }, expiresAt: record.expiresAt, csrf: csrfToken(rawToken) };
  }
  async function session(rawToken) {
    let digest;
    try { digest = tokenDigest(rawToken); } catch { return null; }
    const record = await database(() => store.getSession(digest, { now: clock(), idleSeconds: IDLE_SECONDS }));
    return record ? publicSession(record, rawToken) : null;
  }

  async function login({ email, password, factor, peerAddress } = {}) {
    let canonical;
    try { canonical = canonicalEmail(email); } catch { canonical = null; }
    const accountKey = canonical ?? "invalid-email";
    const network = typeof peerAddress === "string" && peerAddress.length <= 128 ? peerAddress : "unknown-peer";
    const now = clock();
    for (const [kind, value, windowSeconds, limit] of [["global", "login", 60, 120], ["network", network, 900, 20], ["account", accountKey, 900, 8]]) {
      const result = await database(() => store.consumeRateLimit(bucket(kind, value), { now, windowSeconds, limit }));
      if (!result.allowed) throw new AuthError("AUTH_RATE_LIMIT", result.retryAfter);
    }
    const record = canonical ? await database(() => store.getLoginRecord(canonical)) : null;
    const candidate = record?.role === "admin" && record.status === "active" && typeof record.passwordHash === "string" ? record.passwordHash : dummyHash;
    let matched;
    try { matched = await verifyPassword(password, candidate); }
    catch (error) { if (error.code === "AUTH_BUSY") throw new AuthError("AUTH_BUSY", 5); throw unavailable(); }
    if (!matched || !record || candidate === dummyHash || typeof factor !== "string" || factor.length > 128) throw invalid();
    const rawToken = newToken();
    const accepted = await database(() => store.completeAdminLogin({
      userId: record.id, expectedPasswordHash: record.passwordHash, now,
      session: { id: newId(), tokenHash: tokenDigest(rawToken), expiresAt: now + SESSION_SECONDS * 1000 },
      factorCheck: (mfa) => {
        if (/^[0-9]{6}$/.test(factor)) {
          const secret = openTotpSecret(mfa.secretEncrypted, totpKey, record.id);
          const step = verifyTotp(secret, factor, { now, lastStep: mfa.lastStep });
          return step === null ? null : { step };
        }
        if (!mfa.enabled) return null;
        try { return { recoveryDigest: recoveryCodeDigest(factor) }; } catch { return null; }
      },
    }));
    if (!accepted) throw invalid();
    const connected = await session(rawToken);
    if (!connected) throw invalid();
    return { ...connected, token: rawToken };
  }

  async function logout(rawToken) {
    let digest;
    try { digest = tokenDigest(rawToken); } catch { return; }
    await database(() => store.revokeSession(digest, { now: clock() }));
  }
  async function logoutAll(rawToken) {
    const connected = await session(rawToken);
    if (!connected) throw invalid();
    await database(() => store.revokeAllSessions(Buffer.from(connected.user.id, "hex"), { now: clock() }));
  }
  return Object.freeze({ login, session, logout, logoutAll });
}
