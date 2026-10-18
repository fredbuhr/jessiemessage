import { readFile } from "node:fs/promises";
import { checkMutation, httpError, readJson, reply, safeSession, sameText, sessionToken } from "../auth/http.mjs";
import { PrivacyError } from "./draft.mjs";

const assets = new Map([["/admin/privacy", ["privacy.html", "text/html; charset=utf-8"]],
  ["/privacy.js", ["privacy.js", "text/javascript; charset=utf-8"]], ["/privacy.css", ["privacy.css", "text/css; charset=utf-8"]],
  ["/i18n-privacy.js", ["i18n-privacy.js", "text/javascript; charset=utf-8"]]]);
export function createPrivacyHandler(service, { actor, origin }) {
  if (origin !== "https://jessiemessage.com" || typeof actor !== "function") throw new TypeError("Private primary administration required.");
  let closing = false;
  const handler = async (request, response) => {
    let url; try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    if (!assets.has(url.pathname) && url.pathname !== "/api/admin/privacy") return false;
    const method = request.method ?? "GET", allowed = assets.has(url.pathname) ? ["GET", "HEAD"] : ["GET", "POST"];
    try {
      if (closing) throw new PrivacyError();
      if (!allowed.includes(method)) { reply(response, method, 405, { error: "method_not_allowed" }, { Allow: allowed.join(", ") }); request.resume(); return true; }
      if (method === "POST") checkMutation(request, origin, url.pathname, false);
      const token = sessionToken(request), current = token ? await actor(token) : null;
      if (current?.user?.role !== "admin") throw httpError(401, "authentication_required");
      const proof = safeSession(current);
      if (method === "POST" && !sameText(request.headers["x-csrf-token"], proof.csrf)) throw httpError(403, "csrf_failed");
      if (url.search || url.hash) throw httpError(400, "invalid_request");
      const authorize = async () => {
        if (closing) throw new PrivacyError();
        const session = await actor(token);
        if (session?.user?.role !== "admin") throw httpError(401, "authentication_required");
        const next = safeSession(session);
        if (next.user.id !== proof.user.id || !sameText(next.csrf, proof.csrf)) throw httpError(401, "authentication_required");
      };
      let body, headers;
      if (assets.has(url.pathname)) {
        const [name, type] = assets.get(url.pathname); body = await readFile(new URL(`../../public/${name}`, import.meta.url)); headers = { "Content-Type": type };
      } else if (method === "GET") body = await service.read();
      else body = await service.save(await readJson(request, { maxBytes: 49152 }), authorize);
      await authorize();
      reply(response, method, 200, body, headers);
    } catch (error) {
      if (response.headersSent) response.destroy();
      else {
        const status = error instanceof PrivacyError ? ({ input: 400, changed: 409, busy: 429 })[error.code] ?? 503
          : [400, 401, 403, 408, 413, 415].includes(error?.httpStatus) ? error.httpStatus : 503;
        const code = error instanceof PrivacyError ? ({ input: "invalid_request", changed: "preparation_changed", busy: "try_again_later" })[error.code] ?? "privacy_unavailable"
          : status === 503 ? "privacy_unavailable" : error.publicCode;
        // A late 401 must never erase a replacement cookie set by another tab.
        const headers = { ...(status === 429 ? { "Retry-After": "5" } : {}), ...(method === "POST" ? { Connection: "close" } : {}) };
        if (method === "POST") request.resume();
        reply(response, method, status, { error: code }, headers);
      }
    }
    return true;
  };
  return Object.assign(handler, { close() { closing = true; service.close(); } });
}
