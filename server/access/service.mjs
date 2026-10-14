import { createHmac } from "node:crypto";
import { canonicalEmail } from "../auth/config.mjs";
import { AuthError } from "../auth/service.mjs";
import { csrfToken, hashPassword, newId, newToken, tokenDigest, verifyPassword } from "../auth/crypto.mjs";
import { sealVerificationPayload } from "../mail/crypto.mjs";

const SESSION_MILLISECONDS = 8 * 3600000;
const VERIFICATION_MILLISECONDS = 24 * 3600000;
const invalid = () => new AuthError("AUTH_INVALID");
const unavailable = () => new AuthError("AUTH_UNAVAILABLE");
const rejected = (code = "ACCESS_REGISTRATION_FAILED") => new AuthError(code);

function identity(value) {
  if (typeof value !== "string" || !/^[a-fA-F0-9]{32}$/.test(value)) throw invalid();
  return Buffer.from(value, "hex");
}
function canonicalPseudonym(value) {
  if (typeof value !== "string" || !value.isWellFormed() || value !== value.trim() || /[\p{Cc}\p{Cf}]/u.test(value)) throw rejected();
  const normalized = value.normalize("NFC");
  if (normalized.length < 1 || normalized.length > 64) throw rejected();
  return normalized;
}
function digest(raw) {
  try { return tokenDigest(raw); } catch { throw invalid(); }
}

export async function createAccessService({ store, authStore, authService, totpKey, mailKey, origin, clock = Date.now }) {
  if (!store || !authStore || !authService || !Buffer.isBuffer(totpKey) || totpKey.length !== 32
    || !Buffer.isBuffer(mailKey) || mailKey.length !== 32 || typeof clock !== "function") throw unavailable();
  try { if (new URL(origin).protocol !== "https:" || new URL(origin).origin !== origin) throw new Error(); }
  catch { throw unavailable(); }
  const dummyHash = await hashPassword(newToken());
  const rateKey = createHmac("sha256", totpKey).update("jessiemessage:access-rate-key:v1").digest();
  const bucket = (kind, value) => createHmac("sha256", rateKey).update(`${kind}:`).update(value).digest();
  async function database(operation) {
    try { return await operation(); }
    catch (error) {
      if (["ACCESS_REGISTRATION_FAILED", "ACCESS_FORBIDDEN", "ACCESS_PREREQUISITES"].includes(error?.code)) throw rejected(error.code);
      throw unavailable();
    }
  }
  async function limit(operation, account, peerAddress, maximum = 8) {
    const network = typeof peerAddress === "string" && peerAddress.length <= 128 ? peerAddress : "unknown-peer";
    const now = clock();
    // One aggregate bucket bounds all public access operations before creating
    // per-network/account rows or starting expensive password work.
    for (const [kind, value, seconds, count] of [["global", "public-access", 60, 60], [`${operation}:network`, network, 900, 20], [`${operation}:account`, account, 900, maximum]]) {
      const result = await database(() => authStore.consumeRateLimit(bucket(kind, value), { now, windowSeconds: seconds, limit: count }));
      if (!result.allowed) throw new AuthError("AUTH_RATE_LIMIT", result.retryAfter);
    }
  }
  async function passwordMatches(password, encoded) {
    try { return await verifyPassword(password, encoded); }
    catch (error) { if (error.code === "AUTH_BUSY") throw new AuthError("AUTH_BUSY", 5); throw unavailable(); }
  }
  async function administratorToken(raw) {
    const hash = digest(raw);
    const connected = await authService.session(raw);
    if (!connected || connected.user.role !== "admin") throw rejected("ACCESS_FORBIDDEN");
    return hash;
  }
  function verificationJob(email, now) {
    const token = newToken();
    const jobId = newId();
    return {
      verification: { id: newId(), tokenHash: tokenDigest(token), expiresAt: now + VERIFICATION_MILLISECONDS },
      mail: { id: jobId, payloadEncrypted: sealVerificationPayload({ email, token }, mailKey, jobId) },
    };
  }
  function publicSession(record, token) {
    return { user: { id: record.userId.toString("hex"), role: "client", pseudonym: record.pseudonym },
      expiresAt: record.expiresAt, csrf: csrfToken(token), access: { ...record.access } };
  }
  async function session(token) {
    let hash;
    try { hash = tokenDigest(token); } catch { return null; }
    const record = await database(() => store.getClientSession(hash, { now: clock(), idleSeconds: 1800 }));
    return record ? publicSession(record, token) : null;
  }

  async function inspectInvitation({ token, peerAddress } = {}) {
    const hash = digest(token);
    await limit("inspect", hash.toString("hex"), peerAddress, 20);
    return database(() => store.inspectInvitation(hash, { now: clock() }));
  }
  async function createInvitation(raw, { lifetimeHours = 72, accessDays = 30 } = {}) {
    if (!Number.isSafeInteger(lifetimeHours) || lifetimeHours < 1 || lifetimeHours > 720
      || (accessDays !== null && (!Number.isSafeInteger(accessDays) || accessDays < 1 || accessDays > 3650))) throw invalid();
    const actorTokenHash = await administratorToken(raw);
    const now = clock(); const token = newToken();
    const result = await database(() => store.createInvitation({ actorTokenHash, now, id: newId(), tokenHash: tokenDigest(token), expiresAt: now + lifetimeHours * 3600000, accessDays }));
    if (!result) throw rejected("ACCESS_FORBIDDEN");
    return { id: result.id.toString("hex"), expiresAt: result.expiresAt, accessDays: result.accessDays, url: `${origin}/access#invitation=${token}` };
  }
  async function listInvitations(raw) {
    const hash = await administratorToken(raw);
    const rows = await database(() => store.listInvitations(hash, { now: clock() }));
    if (!rows) throw rejected("ACCESS_FORBIDDEN");
    return rows;
  }
  async function revokeInvitation(raw, id) {
    const hash = await administratorToken(raw);
    return database(() => store.revokeInvitation(hash, identity(id), { now: clock() }));
  }
  async function register({ invitationToken, email, pseudonym, password, ageDeclared, peerAddress } = {}) {
    const invitationHash = digest(invitationToken);
    await limit("register", invitationHash.toString("hex"), peerAddress, 3);
    let address;
    try { address = canonicalEmail(email); } catch { throw rejected(); }
    const display = canonicalPseudonym(pseudonym);
    if (ageDeclared !== true) throw rejected();
    if (!await database(() => store.inspectInvitation(invitationHash, { now: clock() }))) throw rejected();
    let passwordHash;
    try { passwordHash = await hashPassword(password); }
    catch (error) { if (error.code === "AUTH_BUSY") throw new AuthError("AUTH_BUSY", 5); throw rejected(); }
    const now = clock();
    const accepted = await database(() => store.register({ invitationHash,
      user: { id: newId(), email: address, pseudonym: display, passwordHash }, ...verificationJob(address, now), now }));
    if (!accepted) throw rejected();
    return { status: "verification_pending" };
  }
  async function verifyEmail({ token, peerAddress } = {}) {
    const hash = digest(token);
    await limit("verify", hash.toString("hex"), peerAddress, 8);
    if (!await database(() => store.verifyEmail(hash, { now: clock() }))) throw invalid();
    return { status: "email_verified" };
  }
  async function resendVerification({ email, password, peerAddress } = {}) {
    let address;
    try { address = canonicalEmail(email); } catch { address = null; }
    await limit("resend", address ?? "invalid-email", peerAddress, 3);
    const record = address ? await database(() => store.getClientLoginRecord(address)) : null;
    const eligible = record?.role === "client" && record.status === "pending" && !record.emailVerified && typeof record.passwordHash === "string";
    const matched = await passwordMatches(password, eligible ? record.passwordHash : dummyHash);
    if (matched && eligible) {
      const now = clock();
      await database(() => store.reissueVerification({ userId: record.id, expectedPasswordHash: record.passwordHash,
        expectedVersion: record.credentialVersion, ...verificationJob(address, now), now }));
    }
    // Mailbox/account existence and password validity are never disclosed.
    return { status: "accepted" };
  }
  async function login({ email, password, peerAddress } = {}) {
    let address;
    try { address = canonicalEmail(email); } catch { address = null; }
    await limit("login", address ?? "invalid-email", peerAddress);
    const record = address ? await database(() => store.getClientLoginRecord(address)) : null;
    const eligible = record?.role === "client" && ["pending", "active"].includes(record.status) && record.emailVerified && typeof record.passwordHash === "string";
    const matched = await passwordMatches(password, eligible ? record.passwordHash : dummyHash);
    if (!matched || !eligible) throw invalid();
    const now = clock(); const rawToken = newToken();
    const accepted = await database(() => store.completeClientLogin({ userId: record.id, expectedPasswordHash: record.passwordHash,
      expectedVersion: record.credentialVersion, now, session: { id: newId(), tokenHash: tokenDigest(rawToken), expiresAt: now + SESSION_MILLISECONDS } }));
    if (!accepted) throw invalid();
    const connected = await session(rawToken);
    if (!connected) throw invalid();
    return { ...connected, token: rawToken };
  }
  async function logout(raw) {
    let hash;
    try { hash = tokenDigest(raw); } catch { return; }
    await database(() => store.revokeClientSession(hash, { now: clock() }));
  }
  async function logoutAll(raw) {
    const connected = await session(raw);
    if (!connected) throw invalid();
    await database(() => store.revokeAllClientSessions(identity(connected.user.id), { now: clock() }));
  }
  async function requireActiveClient(raw) {
    const connected = await session(raw);
    if (!connected) throw invalid();
    if (connected.access.state !== "active") throw rejected(connected.access.state === "expired" ? "ACCESS_EXPIRED" : "ACCESS_PREREQUISITES");
    return connected;
  }
  async function listClients(raw) {
    const hash = await administratorToken(raw);
    const rows = await database(() => store.listClients(hash, { now: clock() }));
    if (!rows) throw rejected("ACCESS_FORBIDDEN");
    return rows;
  }
  async function approveClient(raw, id) {
    const hash = await administratorToken(raw);
    if (!await database(() => store.approveClient(hash, identity(id), { now: clock() }))) throw rejected("ACCESS_PREREQUISITES");
    return true;
  }
  async function revokeClient(raw, id) {
    const hash = await administratorToken(raw);
    return database(() => store.revokeClient(hash, identity(id), { now: clock() }));
  }
  return Object.freeze({ adminSession: (raw) => authService.session(raw), inspectInvitation, createInvitation, listInvitations, revokeInvitation,
    register, verifyEmail, resendVerification, login, session, logout, logoutAll, requireActiveClient, listClients, approveClient, revokeClient });
}
