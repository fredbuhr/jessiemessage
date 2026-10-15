import { createHmac } from "node:crypto";
import { canonicalEmail } from "../auth/config.mjs";
import { tokenDigest } from "../auth/crypto.mjs";
import { createVerificationTransport } from "../mail/transport.mjs";
import { SITE_CONTACT_EMAIL } from "../site.mjs";

const FEATURE_NAMES = ["clientAccess", "chat", "photos", "clientFiles", "passwordRecovery", "broadcasts"];
const MAX_DATE = 253402300799999;
export class ReadinessError extends Error {
  constructor(code, retryAfter) {
    super("Site preparation could not be completed."); this.name = "ReadinessError"; this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}
const fail = (code) => { throw new ReadinessError(code); };
const instant = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
function safeToken(value) { try { tokenDigest(value); return true; } catch { return false; } }

export async function createReadinessService({ authService, authStore, mailConfig, features, key,
  createTransport = createVerificationTransport, clock = Date.now }) {
  if (typeof authService?.session !== "function" || typeof authStore?.consumeRateLimit !== "function"
    || !Buffer.isBuffer(key) || key.length !== 32 || typeof createTransport !== "function" || typeof clock !== "function"
    || !mailConfig || typeof mailConfig.enabled !== "boolean" || !features || typeof features !== "object" || Array.isArray(features)
    || Object.keys(features).length !== FEATURE_NAMES.length || FEATURE_NAMES.some((name) => typeof features[name] !== "boolean")) fail("READINESS_CONFIG");
  let sender = SITE_CONTACT_EMAIL;
  if (mailConfig.enabled) {
    try {
      sender = canonicalEmail(mailConfig.smtp?.from);
      if (sender !== mailConfig.smtp.from || mailConfig.smtp.replyTo !== sender) fail("READINESS_CONFIG");
    } catch { fail("READINESS_CONFIG"); }
  }
  const configured = mailConfig.enabled;
  mailConfig = configured ? { ...mailConfig, key: Buffer.isBuffer(mailConfig.key) ? Buffer.from(mailConfig.key) : mailConfig.key, smtp: { ...mailConfig.smtp } } : { enabled: false };
  const featureSnapshot = Object.freeze(Object.fromEntries(FEATURE_NAMES.map((name) => [name, features[name]])));
  key = Buffer.from(key);
  let active = false, closed = false, closing, activeTransport, closeFailed = false;
  const diagnostics = new Set();
  const nowValue = () => { const now = clock(); if (!instant(now)) fail("READINESS_UNAVAILABLE"); return now; };
  async function guarded(operation) {
    try { return await operation(); }
    catch (error) {
      if (error instanceof ReadinessError) throw error;
      if (error?.code === "AUTH_INVALID") fail("READINESS_UNAUTHORIZED");
      fail("READINESS_UNAVAILABLE");
    }
  }
  async function actor(token) {
    if (!safeToken(token)) fail("READINESS_UNAUTHORIZED");
    const session = await authService.session(token);
    if (!session || session.user?.role !== "admin") fail("READINESS_UNAUTHORIZED");
    if (typeof session.user.id !== "string" || session.user.id.length !== 32 || !/^[a-f0-9]{32}$/.test(session.user.id)
      || typeof session.user.pseudonym !== "string" || session.user.pseudonym.length > 64 || !session.user.pseudonym.isWellFormed()
      || !safeToken(session.csrf) || !instant(session.expiresAt)) fail("READINESS_UNAVAILABLE");
    return { user: { id: session.user.id, role: "admin", pseudonym: session.user.pseudonym }, csrf: session.csrf, expiresAt: session.expiresAt };
  }
  async function limit(session, operation) {
    const now = nowValue();
    const budgets = operation === "read" ? [["global-read", "all", 240, 60], ["user-read", session.user.id, 60, 60]]
      : [["global-verify", "all", 10, 60], ["user-verify", session.user.id, 3, 900]];
    for (const [name, identity, maximum, windowSeconds] of budgets) {
      if (closed) fail("READINESS_UNAVAILABLE");
      const bucket = createHmac("sha256", key).update("jessiemessage:readiness-rate:v1:").update(name).update("\0").update(identity).digest();
      const result = await authStore.consumeRateLimit(bucket, { now, windowSeconds, limit: maximum });
      if (!result || typeof result.allowed !== "boolean") fail("READINESS_UNAVAILABLE");
      if (!result.allowed) throw new ReadinessError("READINESS_RATE_LIMIT", Number.isFinite(result.retryAfter) ? Math.max(1, Math.min(3600, Math.ceil(result.retryAfter))) : 60);
    }
  }
  function dispose(lease) {
    if (!lease) return Promise.resolve();
    if (!lease.closing) {
      try { lease.closing = Promise.resolve(lease.transport.close()); }
      catch { lease.closing = Promise.reject(new ReadinessError("READINESS_UNAVAILABLE")); }
      // Closing can be signalled synchronously before the diagnostic reaches
      // its own finally block; always attach a handler immediately.
      void lease.closing.catch(() => { closeFailed = true; });
    }
    return lease.closing;
  }
  function close() {
    if (closing) return closing;
    closed = true;
    const cleanup = dispose(activeTransport);
    closing = (async () => {
      await Promise.allSettled([...diagnostics]);
      try { await cleanup; } catch { closeFailed = true; }
      if (closeFailed) fail("READINESS_UNAVAILABLE");
    })();
    return closing;
  }
  function verifySmtp(token) {
    if (closed) return Promise.reject(new ReadinessError("READINESS_UNAVAILABLE"));
    const pending = guarded(async () => {
      const session = await actor(token);
      if (closed) fail("READINESS_UNAVAILABLE");
      if (!configured) fail("READINESS_MAIL_DISABLED");
      if (active) throw new ReadinessError("READINESS_BUSY", 5);
      // Reserve before awaiting quotas or the factory: concurrent callers can
      // never create another diagnostic transport while this check is active.
      active = true;
      let transport, lease, failure;
      try {
        await limit(session, "verify");
        if (closed) fail("READINESS_UNAVAILABLE");
        // Quota storage can wait behind other work. Its admission does not
        // preserve an administrator session that expired or was revoked meanwhile.
        await actor(token);
        if (closed) fail("READINESS_UNAVAILABLE");
        try { transport = await createTransport(mailConfig); } catch { fail("READINESS_UNAVAILABLE"); }
        if (typeof transport?.close === "function") activeTransport = lease = { transport };
        if (!transport || typeof transport.verify !== "function" || !lease) fail("READINESS_UNAVAILABLE");
        if (closed) fail("READINESS_UNAVAILABLE");
        try { if (await transport.verify() !== true) fail("READINESS_SMTP_FAILED"); }
        catch { fail("READINESS_SMTP_FAILED"); }
      } catch (error) { failure = error instanceof ReadinessError ? error : new ReadinessError("READINESS_UNAVAILABLE"); }
      finally {
        try { await dispose(lease); }
        catch { failure ??= new ReadinessError("READINESS_UNAVAILABLE"); }
        finally { if (activeTransport === lease) activeTransport = undefined; active = false; }
      }
      if (closed) fail("READINESS_UNAVAILABLE");
      // A completed connection is not permission to disclose a result after
      // the administrator session was revoked during network work or cleanup.
      await actor(token);
      if (closed) fail("READINESS_UNAVAILABLE");
      if (failure) throw failure;
      return { status: "verified", checkedAt: nowValue(), scope: "smtp_authentication", delivery: "not_checked" };
    });
    diagnostics.add(pending);
    void pending.then(() => diagnostics.delete(pending), () => diagnostics.delete(pending));
    return pending;
  }
  return Object.freeze({
    actor: (token) => guarded(() => actor(token)),
    summary: (token) => guarded(async () => {
      const session = await actor(token); await limit(session, "read");
      if (closed) fail("READINESS_UNAVAILABLE");
      await actor(token);
      if (closed) fail("READINESS_UNAVAILABLE");
      return { contactEmail: SITE_CONTACT_EMAIL, mail: { configured, sender, replyTo: sender }, features: { ...featureSnapshot },
        checks: { ageAssurance: "pending", smtpDelivery: "not_checked", deviceAcceptance: "pending" } };
    }),
    verifySmtp,
    close,
  });
}
