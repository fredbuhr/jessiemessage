import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { httpError, isToken, safeSession, sameText } from "../auth/http.mjs";
import { safeClientSession } from "../access/http.mjs";
import { createSessionClock, MAX_SESSION_INSTANT } from "../auth/session-policy.mjs";

export const LEGACY_DEVICE_ORIGIN = "https://recette.jessiemessage.com";
export const PRIMARY_DEVICE_ORIGIN = "https://jessiemessage.com";
export const DEVICE_TRANSITION_MILLISECONDS = 120000;
const namespace = Buffer.from("jessiemessage:device-transition:v1");
const closed = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const validRole = (role) => role === "admin" || role === "client";
const notificationValid = (value) => value === null || typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const invalid = () => { throw httpError(400, "transition_unavailable"); };
const unavailable = () => { throw httpError(503, "transition_unavailable"); };
const digest = (value) => createHash("sha256").update(value).digest("base64url");
const missingSession = (role, notification) => Object.assign(httpError(401, "authentication_required"), {
  loginDestination: `${role === "admin" ? "/admin/login" : "/access"}${notification ? `#notification=${notification}` : ""}`,
});

export function validDeviceTransitionOrigins(legacyOrigin, primaryOrigin) {
  if (legacyOrigin === LEGACY_DEVICE_ORIGIN && primaryOrigin === PRIMARY_DEVICE_ORIGIN) return true;
  // Trusted factory seam for an isolated HTTPS browser fixture. Runtime callers
  // use the fixed production defaults; no request or environment selects these.
  try {
    const legacy = new URL(legacyOrigin), primary = new URL(primaryOrigin);
    return legacy.origin === legacyOrigin && primary.origin === primaryOrigin
      && legacy.protocol === "https:" && primary.protocol === "https:"
      && legacy.hostname === "recette.jessiemessage.localhost" && primary.hostname === "jessiemessage.localhost"
      && legacy.port !== "" && legacy.port === primary.port;
  } catch { return false; }
}

/** One-process, short-lived handoff. A restart invalidates every outstanding ticket. */
export function createDeviceTransitionService({ authService, accessService, clock = Date.now,
  legacyOrigin = LEGACY_DEVICE_ORIGIN, primaryOrigin = PRIMARY_DEVICE_ORIGIN, maxChallenges = 2048 } = {}) {
  if (!validDeviceTransitionOrigins(legacyOrigin, primaryOrigin)
    || typeof authService?.session !== "function" || typeof accessService?.session !== "function"
    || typeof clock !== "function" || !Number.isInteger(maxChallenges) || maxChallenges < 1 || maxChallenges > 4096) {
    throw new TypeError("An explicit private device transition is required.");
  }
  // This independent key is intentionally neither persisted nor derived from an application secret.
  const key = randomBytes(32), records = new Map(), nowValue = createSessionClock(clock);
  const now = () => { try { return nowValue(); } catch { unavailable(); } };
  function seal(value) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(namespace);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  }
  function open(value, kind, role, sampled) {
    if (!validRole(role) || typeof value !== "string" || value.length < 80 || value.length > 2048
      || !/^[A-Za-z0-9_-]+$/.test(value)) invalid();
    let result;
    try {
      const bytes = Buffer.from(value, "base64url");
      if (bytes.toString("base64url") !== value || bytes.length < 29) invalid();
      const cipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      cipher.setAAD(namespace); cipher.setAuthTag(bytes.subarray(12, 28));
      result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()])));
    } catch { invalid(); }
    const keys = ["v", "kind", "id", "role", "issuedAt", "expiresAt", "issuer", "audience", "nonceHash", "notification"];
    if (kind === "ticket") keys.push("token", "userId");
    if (!closed(result, keys) || result.v !== 1 || result.kind !== kind || result.role !== role
      || typeof result.id !== "string" || !/^[a-f0-9]{32}$/.test(result.id) || !isToken(result.nonceHash)
      || !Number.isSafeInteger(result.issuedAt) || result.issuedAt < 0 || result.issuedAt > sampled
      || !Number.isSafeInteger(result.expiresAt) || result.expiresAt > MAX_SESSION_INSTANT
      || result.expiresAt !== result.issuedAt + DEVICE_TRANSITION_MILLISECONDS || sampled >= result.expiresAt
      || !notificationValid(result.notification)
      || result.issuer !== (kind === "challenge" ? primaryOrigin : legacyOrigin)
      || result.audience !== (kind === "challenge" ? legacyOrigin : primaryOrigin)
      || kind === "ticket" && (!isToken(result.token) || typeof result.userId !== "string" || !/^[a-f0-9]{32}$/.test(result.userId))) invalid();
    const record = records.get(result.id);
    if (!record || record.phase !== "issued" || record.role !== role || record.issuedAt !== result.issuedAt
      || record.expiresAt !== result.expiresAt || record.notification !== result.notification
      || !sameText(record.nonceHash, result.nonceHash)) invalid();
    return { payload: result, record };
  }
  async function session(role, token) {
    if (!isToken(token)) return null;
    let value;
    try { value = await (role === "admin" ? authService : accessService).session(token); }
    catch { unavailable(); }
    if (!value) return null;
    let safe;
    try { safe = role === "admin" ? safeSession(value) : safeClientSession(value); }
    catch { unavailable(); }
    if (!Number.isSafeInteger(safe.expiresAt) || safe.expiresAt <= now()) return null;
    return safe;
  }
  return Object.freeze({
    cancel(role, nonce) {
      if (!validRole(role) || !isToken(nonce)) return;
      const nonceHash = digest(nonce);
      for (const record of records.values()) if (record.role === role && sameText(record.nonceHash, nonceHash)) record.phase = "cancelled";
    },
    begin(role, input, previousNonce = null) {
      if (!validRole(role) || !closed(input, ["notification"]) || !notificationValid(input.notification)) invalid();
      const sampled = now();
      if (isToken(previousNonce)) {
        const previousHash = digest(previousNonce);
        for (const record of records.values()) if (record.role === role && sameText(record.nonceHash, previousHash)) record.phase = "cancelled";
      }
      if (sampled > MAX_SESSION_INSTANT - DEVICE_TRANSITION_MILLISECONDS) unavailable();
      for (const [id, record] of records) if (record.expiresAt <= sampled) records.delete(id);
      if (records.size >= maxChallenges) throw httpError(429, "try_again_later");
      const nonce = randomBytes(32).toString("base64url"), id = randomBytes(16).toString("hex");
      const payload = { v: 1, kind: "challenge", id, role, issuedAt: sampled, expiresAt: sampled + DEVICE_TRANSITION_MILLISECONDS,
        issuer: primaryOrigin, audience: legacyOrigin, nonceHash: digest(nonce), notification: input.notification };
      records.set(id, { role, issuedAt: sampled, expiresAt: payload.expiresAt, nonceHash: payload.nonceHash,
        notification: input.notification, phase: "issued" });
      return { nonce, challenge: seal(payload) };
    },
    async authorize(role, token, csrf, input) {
      if (!closed(input, ["challenge"])) invalid();
      const { payload } = open(input.challenge, "challenge", role, now());
      const current = await session(role, token);
      if (!current) throw missingSession(role, payload.notification);
      if (!isToken(csrf) || !sameText(current.csrf, csrf)) throw httpError(403, "csrf_failed");
      // No async operation follows this recheck before the opaque ticket is returned.
      const fresh = open(input.challenge, "challenge", role, now());
      if (fresh.record.phase !== "issued") invalid();
      return { ticket: seal({ ...payload, kind: "ticket", issuer: legacyOrigin, audience: primaryOrigin,
        token, userId: current.user.id.toLowerCase() }) };
    },
    async complete(role, nonce, currentToken, input) {
      if (!closed(input, ["ticket"]) || !isToken(nonce)) invalid();
      const { payload, record } = open(input.ticket, "ticket", role, now());
      if (!sameText(payload.nonceHash, digest(nonce))) invalid();
      // Atomic within this single process, before the first awaited credential lookup.
      // A failed lookup requires a fresh challenge; it never resurrects a spent handoff.
      record.phase = "consuming";
      const source = await session(role, payload.token);
      if (!source || source.user.id.toLowerCase() !== payload.userId) throw missingSession(role, payload.notification);
      const target = await session(role, currentToken);
      if (target && target.user.id.toLowerCase() !== payload.userId) throw httpError(409, "account_conflict");
      const selected = target ?? source, token = target ? currentToken : payload.token;
      if (record.phase !== "consuming" || now() >= payload.expiresAt || selected.expiresAt <= now()) invalid();
      record.phase = "consumed";
      let destination = role === "admin" ? "/admin/messages" : selected.access.state === "active" ? "/messages" : "/access";
      if (payload.notification !== null) destination += `#notification=${payload.notification}`;
      return { token, expiresAt: selected.expiresAt, destination, keptExisting: Boolean(target) };
    },
  });
}
