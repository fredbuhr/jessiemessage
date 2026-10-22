import { readFile } from "node:fs/promises";
import { checkMutation, httpError, readJson, reply, sameText, sessionToken } from "../auth/http.mjs";
import { ConversationExportError } from "./conversation-export.mjs";
import { createArchiveTransfer, conversationExportFailure } from "./archive-transfer.mjs";

const root = new URL("../../public/", import.meta.url);
const assets = new Map([["/client-archive.js", "private-archive.js"], ["/conversation-download.js", "conversation-download.js"]]);
const unauthorized = () => new ConversationExportError("unauthorized");
const invalid = () => httpError(400, "invalid_request");

/** Client role is fixed here; neither body nor query can select another account. */
export function createClientConversationExportHandler({ actor, conversation }, { origin, conversationExporter = null }) {
  const transfer = createArchiveTransfer(conversationExporter);
  const handler = async (request, response) => {
    if (!conversationExporter) return false;
    let url; try { url = new URL(request.url ?? "/", origin); } catch { return false; }
    const asset = assets.get(url.pathname), match = /^\/api\/chat\/client\/conversations\/([a-f0-9]{32})\/export$/.exec(url.pathname);
    if (!asset && !match) return false;
    const methods = asset ? ["GET", "HEAD"] : ["POST"], method = request.method ?? "GET";
    if (!methods.includes(method)) { reply(response, method, 405, { error: "method_not_allowed" }, { Allow: methods.join(", ") }); return true; }
    try {
      if (method === "POST") checkMutation(request, origin, url.pathname, false);
      const token = sessionToken(request, "__Host-jessie_client");
      const authenticated = token ? await actor(token) : null;
      if (!authenticated) throw unauthorized();
      if ([...url.searchParams].length) throw invalid();
      if (asset) { reply(response, method, 200, await readFile(new URL(asset, root)), { "Content-Type": "text/javascript; charset=utf-8" }); return true; }
      if (!sameText(request.headers["x-csrf-token"], authenticated.csrf)) throw httpError(403, "csrf_failed");
      const body = await readJson(request, { maxBytes: 1024 });
      const videos = conversationExporter.videos === true, keys = videos ? ["includePhotos", "includeVideos"] : ["includePhotos"];
      if (Object.keys(body).length !== keys.length || keys.some((name) => !Object.hasOwn(body, name))
        || typeof body.includePhotos !== "boolean" || body.includePhotos && !conversationExporter.photos
        || videos && typeof body.includeVideos !== "boolean") throw invalid();
      const initial = await conversation(token);
      if (initial.id !== match[1]) throw Object.assign(new Error("Conversation not found"), { code: "CHAT_NOT_FOUND" });
      await transfer.send(request, response, { token, conversationId: initial.id, expectedClientId: authenticated.user.id, clientName: authenticated.user.pseudonym,
        includePhotos: body.includePhotos, ...(videos ? { includeVideos: body.includeVideos } : {}) }, async () => {
        const current = await actor(token);
        if (!current || !sameText(current.user.id, authenticated.user.id) || !sameText(current.csrf, authenticated.csrf)) throw unauthorized();
        if ((await conversation(token)).id !== initial.id) throw new ConversationExportError("changed");
      });
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const result = conversationExportFailure(error) ??
          (["CHAT_UNAUTHORIZED", "AUTH_INVALID"].includes(error?.code) ? { status: 401, code: "authentication_required" } :
            error?.code === "CHAT_NOT_FOUND" ? { status: 404, code: "not_found" } :
              error?.code === "CHAT_FORBIDDEN" ? { status: 403, code: "request_rejected" } :
                [400, 403, 408, 413, 415, 503].includes(error?.httpStatus) && ["invalid_request", "request_rejected", "csrf_failed", "request_timeout", "request_too_large", "json_required", "messaging_unavailable"].includes(error.publicCode)
                  ? { status: error.httpStatus, code: error.publicCode } : { status: 503, code: "conversation_export_unavailable" });
        const headers = result.retry ? { "Retry-After": String(result.retry) } : {};
        // A delayed request must never erase a newer client session cookie.
        if (method === "POST" || [400, 408, 413].includes(result.status)) { headers.Connection = "close"; request.resume(); }
        reply(response, method, result.status, { error: result.code }, headers);
      }
    }
    return true;
  };
  return Object.assign(handler, { close: () => transfer.close() });
}
