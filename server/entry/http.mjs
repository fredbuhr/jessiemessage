import { reply, safeSession, sessionToken } from "../auth/http.mjs";
import { safeClientSession } from "../access/http.mjs";

const MAX_DATE = 253402300799999;
const unavailable = () => ({ status: "unavailable", client: null, administrator: null });
const instant = (value, positive = false) => Number.isSafeInteger(value) && value >= (positive ? 1 : 0) && value <= MAX_DATE;
const fail = () => { throw new Error("Entry state is unavailable."); };

function identity(session) {
  if (!instant(session.expiresAt, true) || typeof session.user.pseudonym !== "string"
    || !session.user.pseudonym.isWellFormed() || !session.user.pseudonym.trim().length) fail();
}
function clientChoice(value, now, chatEnabled) {
  if (value === null) return { state: "signed_out", href: "/access" };
  const session = safeClientSession(value);
  identity(session);
  const access = session.access;
  if (access.expiresAt !== null && !instant(access.expiresAt) || access.state === "expired" && access.expiresAt === null) fail();
  if (session.expiresAt <= now) return { state: "signed_out", href: "/access" };
  const state = access.state === "active" && access.expiresAt !== null && access.expiresAt <= now ? "expired" : access.state;
  return { state, href: state === "active" && chatEnabled ? "/messages" : "/access" };
}
function administratorChoice(value, now, chatEnabled) {
  if (value === null) return { state: "signed_out", href: "/admin/login" };
  const session = safeSession(value);
  identity(session);
  if (session.expiresAt <= now) return { state: "signed_out", href: "/admin/login" };
  return { state: "connected", href: chatEnabled ? "/admin/messages" : "/admin" };
}

/** A neutral entry decision only. The parent keeps this SQL-capable handler
 * behind admission; each destination still authorizes its own private data. */
export function createEntryHandler({ clientSession = null, adminSession = null, chatEnabled = false, clock = Date.now } = {}) {
  if (clientSession !== null && typeof clientSession !== "function" || adminSession !== null && typeof adminSession !== "function"
    || typeof chatEnabled !== "boolean" || typeof clock !== "function") throw new TypeError("A valid private entry configuration is required.");
  return async (request, response) => {
    let url;
    const rawUrl = request.url ?? "/";
    try { url = new URL(rawUrl, "http://localhost"); } catch { return false; }
    if (url.pathname !== "/api/entry") return false;
    const method = request.method ?? "GET";
    if (method !== "GET") {
      reply(response, method, 405, { error: "method_not_allowed" }, { Allow: "GET", Connection: "close" });
      request.resume(); return true;
    }
    if (url.search || url.hash || rawUrl.includes("?") || rawUrl.includes("#")) {
      reply(response, method, 400, { error: "invalid_request" }); return true;
    }
    try {
      const clientToken = clientSession === null ? null : sessionToken(request, "__Host-jessie_client");
      const adminToken = adminSession === null ? null : sessionToken(request, "__Host-jessie_session");
      // Both independent roles may be present in this browser. Drain every
      // started lookup even if one rejects, and keep both explicit choices.
      const results = await Promise.allSettled([
        clientToken === null ? Promise.resolve(null) : Promise.resolve().then(() => clientSession(clientToken)),
        adminToken === null ? Promise.resolve(null) : Promise.resolve().then(() => adminSession(adminToken)),
      ]);
      if (results.some((result) => result.status !== "fulfilled")) fail();
      const now = clock();
      if (!instant(now)) fail();
      const client = clientSession === null ? null : clientChoice(results[0].value, now, chatEnabled);
      const administrator = adminSession === null ? null : administratorChoice(results[1].value, now, chatEnabled);
      reply(response, method, 200, { status: client === null && administrator === null ? "unavailable" : "available", client, administrator });
    } catch {
      if (!response.headersSent && !response.destroyed) reply(response, method, 503, unavailable(), { "Retry-After": "5" });
    }
    return true;
  };
}
