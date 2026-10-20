import { createHmac } from "node:crypto";
import { ADMIN_SESSION_SECONDS, CLIENT_IDLE_SECONDS } from "./session-policy.mjs";
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
const SESSION_SECONDS = ADMIN_SESSION_SECONDS;
const IDLE_SECONDS = CLIENT_IDLE_SECONDS;
const MAX_INSTANT = 253402300799999;

// One private, random dummy hash per process keeps nonexistent accounts on the
// same bounded password-work path as existing administrators.
export async function createAuthService({ store, totpKey, clock = Date.now }) {
  if (!store || !Buffer.isBuffer(totpKey) || totpKey.length !== 32 || typeof clock !== "function") throw unavailable();
  const dummyHash = await hashPassword(newToken());
  const rateKey = createHmac("sha256", totpKey).update("jessiemessage:rate-key:v1").digest();
  const bucket = (kind, value) => createHmac("sha256", rateKey).update(`${kind}:`).update(value).digest();
  function nowValue() {
    let now;
    try { now = clock(); } catch { throw unavailable(); }
    if (!Number.isSafeInteger(now) || now < 0 || now > MAX_INSTANT) throw unavailable();
    return now;
  }

  async function database(work) {
    try { return await work(); } catch { throw unavailable(); }
  }
  function publicSession(record, rawToken) {
    return { user: { id: record.userId.toString("hex"), role: record.role, pseudonym: record.pseudonym }, expiresAt: record.expiresAt, csrf: csrfToken(rawToken) };
  }
  async function session(rawToken) {
    let digest;
    try { digest = tokenDigest(rawToken); } catch { return null; }
    const record = await database(() => store.getSession(digest, { now: nowValue(), idleSeconds: IDLE_SECONDS }));
    return record ? publicSession(record, rawToken) : null;
  }

  async function login({ email, password, factor, peerAddress } = {}) {
    let canonical;
    try { canonical = canonicalEmail(email); } catch { canonical = null; }
    const accountKey = canonical ?? "invalid-email";
    const network = typeof peerAddress === "string" && peerAddress.length <= 128 ? peerAddress : "unknown-peer";
    const quotaTime = nowValue();
    const budgets = [
      [bucket("global", "login"), { now: quotaTime, windowSeconds: 60, limit: 120,
        network: { bucketHash: bucket("network", network), windowSeconds: 900, limit: 20 } }],
      [bucket("account", accountKey), { now: quotaTime, windowSeconds: 900, limit: 8 }],
    ];
    for (const [hash, options] of budgets) {
      const result = await database(() => store.consumeRateLimit(hash, options));
      if (!result.allowed) throw new AuthError("AUTH_RATE_LIMIT", result.retryAfter);
    }
    const record = canonical ? await database(() => store.getLoginRecord(canonical)) : null;
    const candidate = record?.role === "admin" && record.status === "active" && typeof record.passwordHash === "string" ? record.passwordHash : dummyHash;
    let matched;
    try { matched = await verifyPassword(password, candidate); }
    catch (error) { if (error.code === "AUTH_BUSY") throw new AuthError("AUTH_BUSY", 5); throw unavailable(); }
    if (!matched || !record || candidate === dummyHash || typeof factor !== "string" || factor.length > 128) throw invalid();
    // Persistent quotas and bounded password work can both wait. Their start
    // time must not keep an expired TOTP step live or shorten a new session.
    const now = nowValue();
    if (now > MAX_INSTANT - SESSION_SECONDS * 1000) throw unavailable();
    const rawToken = newToken();
    const accepted = await database(() => store.completeAdminLogin({
      userId: record.id, expectedPasswordHash: record.passwordHash, now,
      session: { id: newId(), tokenHash: tokenDigest(rawToken), expiresAt: now + SESSION_SECONDS * 1000 },
      factorCheck: (mfa, checkedAt = now) => {
        if (/^[0-9]{6}$/.test(factor)) {
          const secret = openTotpSecret(mfa.secretEncrypted, totpKey, record.id);
          const step = verifyTotp(secret, factor, { now: checkedAt, lastStep: mfa.lastStep });
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
    await database(() => store.revokeSession(digest, { now: nowValue() }));
  }
  async function logoutAll(rawToken) {
    const connected = await session(rawToken);
    if (!connected) throw invalid();
    await database(() => store.revokeAllSessions(Buffer.from(connected.user.id, "hex"), { now: nowValue() }));
  }
  async function devices(rawToken, { cursor = null } = {}) {
    let hash;
    try { hash = tokenDigest(rawToken); } catch { throw invalid(); }
    if (cursor !== null && (typeof cursor !== "string" || !/^[a-f0-9]{32}$/.test(cursor))) throw new AuthError("AUTH_INPUT");
    const page = await database(() => store.listDevices(hash, { now: nowValue(), afterId: cursor === null ? null : Buffer.from(cursor, "hex"), limit: 50 }));
    if (!page) throw invalid();
    return { devices: page.devices.map((item) => ({ id: item.id.toString("hex"), createdAt: item.createdAt, lastSeenAt: item.lastSeenAt, current: item.current })),
      nextCursor: page.nextCursor?.toString("hex") ?? null, hasMore: page.hasMore };
  }
  async function revokeDevice(rawToken, id) {
    let hash;
    try { hash = tokenDigest(rawToken); } catch { throw invalid(); }
    if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id)) throw new AuthError("AUTH_INPUT");
    const result = await database(() => store.revokeDevice(hash, Buffer.from(id, "hex"), { now: nowValue() }));
    if (!result) throw invalid();
    if (!result.found) throw new AuthError("AUTH_DEVICE_NOT_FOUND");
    return { status: "device_revoked", current: result.current };
  }
  return Object.freeze({ login, session, logout, logoutAll, devices, revokeDevice });
}
