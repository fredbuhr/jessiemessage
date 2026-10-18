import { CLIENT_SESSION_SECONDS, CLIENT_IDLE_SECONDS } from "../auth/session-policy.mjs";
import { CLIENT_ADMISSION_POLICY } from "./admission.mjs";
import { createHmac } from "node:crypto";
import { canonicalEmail } from "../auth/config.mjs";
import { AuthError } from "../auth/service.mjs";
import { csrfToken, hashPassword, newId, newToken, tokenDigest, verifyPassword } from "../auth/crypto.mjs";
import { sealVerificationPayload } from "../mail/crypto.mjs";
import { decodeAccessCursor, encodeAccessCursor, validateAccessPage } from "./pagination.mjs";

const SESSION_MILLISECONDS = CLIENT_SESSION_SECONDS * 1000;
const VERIFICATION_MILLISECONDS = 24 * 3600000;
const invalid = () => new AuthError("AUTH_INVALID");
const unavailable = () => new AuthError("AUTH_UNAVAILABLE");
const rejected = (code = "ACCESS_REGISTRATION_FAILED") => new AuthError(code);
const DAY_MILLISECONDS = 86400000;
const MAX_INSTANT = 253402300799999;
const storedId = (value) => {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) throw unavailable();
  return value;
};
const storedInstant = (value) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_INSTANT) throw unavailable();
  return value;
};
const nullableInstant = (value) => value === null ? null : storedInstant(value);
function inputOptions(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw rejected("ACCESS_INPUT");
}
function pageInput(kind, input) {
  inputOptions(input, ["cursor", "limit"]);
  try { return validateAccessPage(kind, input); } catch { throw rejected("ACCESS_INPUT"); }
}
function invitationDTO(row) {
  if (!row || !["used", "revoked", "expired", "pending"].includes(row.state)
    || row.accessDays !== null && (!Number.isSafeInteger(row.accessDays) || row.accessDays < 1 || row.accessDays > 3650)) throw unavailable();
  const id = storedId(row.id), createdAt = storedInstant(row.createdAt), expiresAt = storedInstant(row.expiresAt);
  const consumedById = row.consumedById === null ? null : storedId(row.consumedById);
  if (expiresAt <= createdAt || (row.state === "used") !== (consumedById !== null)) throw unavailable();
  return { id, createdAt, expiresAt, accessDays: row.accessDays, state: row.state, consumedById };
}
function clientDTO(row) {
  if (!row || !["pending", "active", "suspended", "revoked", "deleted"].includes(row.status)
    || row.admissionPolicy !== CLIENT_ADMISSION_POLICY
    || [row.emailVerified, row.ageAssured, row.approved, row.invitationConsumed].some((value) => typeof value !== "boolean")) throw unavailable();
  try {
    if (canonicalPseudonym(row.pseudonym) !== row.pseudonym || canonicalEmail(row.email) !== row.email) throw unavailable();
  } catch { throw unavailable(); }
  return { id: storedId(row.id), createdAt: storedInstant(row.createdAt), pseudonym: row.pseudonym, email: row.email,
    status: row.status, admissionPolicy: CLIENT_ADMISSION_POLICY, invitationConsumed: row.invitationConsumed,
    emailVerified: row.emailVerified, ageAssured: row.ageAssured, approved: row.approved,
    accessExpiresAt: nullableInstant(row.accessExpiresAt) };
}
function pageDTO(result, kind, { limit, position }, rebuild) {
  if (!result || !Array.isArray(result[kind]) || result[kind].length > limit || typeof result.hasMore !== "boolean") throw unavailable();
  const rows = result[kind].map(rebuild);
  if (new Set(rows.map((row) => row.id)).size !== rows.length || position !== null && rows.some((row) => row.id === position.id)) throw unavailable();
  // Public dates use milliseconds, while cursors retain all six SQL digits.
  // IDs cannot break same-millisecond ties here: earlier microseconds may have a larger ID.
  let previous = position === null ? Infinity : Date.parse(`${position.createdAt.replace(" ", "T")}Z`);
  for (const row of rows) { if (row.createdAt > previous) throw unavailable(); previous = row.createdAt; }
  if (!result.hasMore) {
    if (result.nextCursor !== null) throw unavailable();
  } else {
    if (rows.length !== limit || typeof result.nextCursor !== "string") throw unavailable();
    let next;
    try { next = decodeAccessCursor(kind, result.nextCursor); } catch { throw unavailable(); }
    const last = rows.at(-1);
    if (next.id !== last.id || Date.parse(`${next.createdAt.replace(" ", "T")}Z`) !== last.createdAt
      || position !== null && (next.createdAt > position.createdAt || next.createdAt === position.createdAt && next.id >= position.id)) throw unavailable();
  }
  return { [kind]: rows, nextCursor: result.nextCursor, hasMore: result.hasMore };
}

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
      if (["ACCESS_REGISTRATION_FAILED", "ACCESS_FORBIDDEN", "ACCESS_PREREQUISITES", "ACCESS_CONFLICT", "ACCESS_INPUT"].includes(error?.code)) throw rejected(error.code);
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
  async function administration(raw, mutation = false) {
    let actorTokenHash;
    try { actorTokenHash = tokenDigest(raw); } catch { throw rejected("ACCESS_FORBIDDEN"); }
    const connected = await database(() => authService.session(raw));
    if (!connected || connected.user?.role !== "admin") throw rejected("ACCESS_FORBIDDEN");
    const userId = storedId(connected.user.id), now = storedInstant(clock());
    const budgets = mutation ? [["user-write", userId, 30], ["global-write", "all", 120]]
      : [["user-read", userId, 60], ["global-read", "all", 240]];
    for (const [kind, value, maximum] of budgets) {
      const hash = createHmac("sha256", rateKey).update("jessiemessage:access-admin-rate:v1:").update(kind).update("\0").update(value).digest();
      const result = await database(() => authStore.consumeRateLimit(hash, { now, windowSeconds: 60, limit: maximum }));
      if (!result || typeof result.allowed !== "boolean"
        || !result.allowed && (!Number.isSafeInteger(result.retryAfter) || result.retryAfter < 1 || result.retryAfter > 60)) throw unavailable();
      if (!result.allowed) throw new AuthError("AUTH_RATE_LIMIT", result.retryAfter);
    }
    // The persisted session and gates must be tested at the time the quota wait ends.
    return { actorTokenHash, now: storedInstant(clock()) };
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
    const record = await database(() => store.getClientSession(hash, { now: clock(), idleSeconds: CLIENT_IDLE_SECONDS }));
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
  async function listInvitations(raw, input = {}) {
    const page = pageInput("invitations", input), cursor = page.position === null ? null : encodeAccessCursor("invitations", page.position);
    const { actorTokenHash, now } = await administration(raw);
    const result = await database(() => store.listInvitations(actorTokenHash, { now, cursor, limit: page.limit }));
    if (!result) throw rejected("ACCESS_FORBIDDEN");
    return pageDTO(result, "invitations", page, invitationDTO);
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
  async function listClients(raw, input = {}) {
    const page = pageInput("clients", input), cursor = page.position === null ? null : encodeAccessCursor("clients", page.position);
    const { actorTokenHash, now } = await administration(raw);
    const result = await database(() => store.listClients(actorTokenHash, { now, cursor, limit: page.limit }));
    if (!result) throw rejected("ACCESS_FORBIDDEN");
    return pageDTO(result, "clients", page, clientDTO);
  }
  async function renewClient(raw, id, input) {
    inputOptions(input, ["expectedExpiresAt", "accessDays"]);
    const { expectedExpiresAt, accessDays } = input;
    if (typeof id !== "string" || !/^[a-fA-F0-9]{32}$/.test(id)
      || !Number.isSafeInteger(expectedExpiresAt) || expectedExpiresAt < 0 || expectedExpiresAt > MAX_INSTANT
      || !Number.isSafeInteger(accessDays) || accessDays < 1 || accessDays > 3650) throw rejected("ACCESS_INPUT");
    const targetAt = (now) => {
      const target = Math.max(now, expectedExpiresAt) + accessDays * DAY_MILLISECONDS;
      if (target > MAX_INSTANT || target > now + 3650 * DAY_MILLISECONDS) throw rejected("ACCESS_INPUT");
      return target;
    };
    targetAt(storedInstant(clock()));
    const { actorTokenHash, now } = await administration(raw, true), expectedTarget = targetAt(now);
    const result = await database(() => store.renewClient(actorTokenHash, Buffer.from(id, "hex"), { now, expectedExpiresAt, accessDays }));
    if (result === null) return null;
    if (!result || storedId(result.id) !== id.toLowerCase() || storedInstant(result.accessExpiresAt) !== expectedTarget) throw unavailable();
    return { id: result.id, accessExpiresAt: result.accessExpiresAt };
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
    register, verifyEmail, resendVerification, login, session, logout, logoutAll, requireActiveClient, listClients, renewClient, approveClient, revokeClient });
}
