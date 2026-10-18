import { readFile } from "node:fs/promises";
import { checkMutation, httpError, readJson, reply, safeSession, sameText, sessionToken } from "../auth/http.mjs";
import { AccountErasureError } from "./erasure-state.mjs";

const assets = new Map([["/admin/closures", ["closures.html", "text/html; charset=utf-8"]],
  ["/closures.js", ["closures.js", "text/javascript; charset=utf-8"]], ["/closures.css", ["closures.css", "text/css; charset=utf-8"]],
  ["/i18n-closures.js", ["i18n-closures.js", "text/javascript; charset=utf-8"]]]);
export function disabledClosureService() {
  return Object.freeze({ async list() { return { version: 1, enabled: false, jobs: [], nextCursor: null }; },
    async preview() { throw new AccountErasureError("ERASURE_DISABLED"); }, async request() { throw new AccountErasureError("ERASURE_DISABLED"); }, close() {} });
}
export function createClosureHandler(service, { actor, origin }) {
  if (origin !== "https://jessiemessage.com" || typeof actor !== "function") throw new TypeError("Private primary administration required.");
  let closing = false;
  const handler = async (request, response) => {
    let url; try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const match = /^\/api\/admin\/closures\/clients\/([a-f0-9]{32})$/.exec(url.pathname);
    if (!assets.has(url.pathname) && url.pathname !== "/api/admin/closures" && !match) return false;
    const method = request.method ?? "GET", allowed = assets.has(url.pathname) ? ["GET", "HEAD"] : match ? ["GET", "POST"] : ["GET"];
    try {
      if (closing) throw new AccountErasureError();
      if (!allowed.includes(method)) { reply(response, method, 405, { error: "method_not_allowed" }, { Allow: allowed.join(", "), Connection: "close" }); request.resume(); return true; }
      if (method === "POST") checkMutation(request, origin, url.pathname, false);
      const token = sessionToken(request), current = token ? await actor(token) : null;
      if (current?.user?.role !== "admin") throw httpError(401, "authentication_required");
      const proof = safeSession(current);
      if (method === "POST" && !sameText(request.headers["x-csrf-token"], proof.csrf)) throw httpError(403, "csrf_failed");
      const authorize = async () => {
        if (closing) throw new AccountErasureError();
        const session = await actor(token);
        if (session?.user?.role !== "admin") throw new AccountErasureError("ERASURE_UNAUTHORIZED");
        const next = safeSession(session);
        if (next.user.id !== proof.user.id || !sameText(next.csrf, proof.csrf)) throw new AccountErasureError("ERASURE_UNAUTHORIZED");
      };
      let body, headers;
      if (assets.has(url.pathname)) {
        // A client selector is a non-secret identity only, never an action.
        if (url.search && (url.pathname !== "/admin/closures" || url.searchParams.size !== 1 || !/^[a-f0-9]{32}$/.test(url.searchParams.get("client") ?? ""))) throw httpError(400, "invalid_request");
        const [name, type] = assets.get(url.pathname); body = await readFile(new URL(`../../public/${name}`, import.meta.url)); headers = { "Content-Type": type };
      } else if (match) {
        if (url.search || url.hash) throw httpError(400, "invalid_request");
        body = method === "GET" ? await service.preview(match[1]) : await service.request(match[1], await readJson(request, { maxBytes: 1024 }), authorize);
      } else {
        if (url.hash || url.searchParams.size > 1 || url.searchParams.size === 1 && (!url.searchParams.has("afterName")
          || !/^erasure-[a-f0-9]{64}\.json$/.test(url.searchParams.get("afterName")))) throw httpError(400, "invalid_request");
        body = await service.list({ afterName: url.searchParams.get("afterName") });
      }
      await authorize(); reply(response, method, method === "POST" ? 202 : 200, body, headers);
    } catch (error) {
      if (response.headersSent) response.destroy();
      else {
        const status = error instanceof AccountErasureError ? ({ ERASURE_INPUT: 400, ERASURE_UNAUTHORIZED: 401, ERASURE_TARGET: 404, ERASURE_CHANGED: 409, ERASURE_BUSY: 429 })[error.code] ?? 503
          : [400, 401, 403, 408, 413, 415].includes(error?.httpStatus) ? error.httpStatus : 503;
        const code = error instanceof AccountErasureError ? ({ 400: "invalid_request", 401: "authentication_required", 404: "client_unavailable", 409: "closure_changed", 429: "try_again_later" })[status] ?? "closure_unavailable"
          : status === 503 ? "closure_unavailable" : error.publicCode;
        if (method === "POST") request.resume();
        reply(response, method, status, { error: code }, { ...(method === "POST" ? { Connection: "close" } : {}), ...(status === 429 ? { "Retry-After": "5" } : {}) });
      }
    }
    return true;
  };
  return Object.assign(handler, { close() { closing = true; service.close(); } });
}
