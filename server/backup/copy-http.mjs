import { readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { AUTH_HEADERS, checkMutation, httpError, isToken, readJson, reply, safeSession, sameText, sessionToken } from "../auth/http.mjs";
import { BackupCopyError, copyFields } from "./copy-state.mjs";
import { createCopyKit, createCopyUpdateKit } from "./copy-kit.mjs";
import { createVerificationKit } from "./verification-kit.mjs";

const assets = new Map([["/admin/backups", ["backups.html", "text/html; charset=utf-8"]],
  ["/backups.js", ["backups.js", "text/javascript; charset=utf-8"]], ["/backups.css", ["backups.css", "text/css; charset=utf-8"]],
  ["/i18n-backups.js", ["i18n-backups.js", "text/javascript; charset=utf-8"]]]);
const ROOT = new URL("../../public/", import.meta.url);
function route(path) {
  if (assets.has(path)) return { kind: "asset", methods: ["GET", "HEAD"] };
  if (path === "/api/admin/backups") return { kind: "summary", methods: ["GET"] };
  if (path === "/api/admin/backups/verification-kit") return { kind: "verification-kit", methods: ["POST"] };
  if (path === "/api/admin/backups/destinations") return { kind: "create", methods: ["POST"] };
  const admin = /^\/api\/admin\/backups\/destinations\/([a-f0-9]{32})\/(settings|revoke|windows-kit|windows-update-kit)$/.exec(path);
  if (admin) return { kind: admin[2], id: admin[1], methods: ["POST"] };
  if (path === "/api/backup-copy/pair") return { kind: "pair", agent: true, methods: ["POST"] };
  if (path === "/api/backup-copy/manifest") return { kind: "manifest", agent: true, methods: ["GET"] };
  if (path === "/api/backup-copy/receipt") return { kind: "receipt", agent: true, methods: ["POST"] };
  const archive = /^\/api\/backup-copy\/archives\/(capture-[1-9][0-9]{0,14}-[a-f0-9]{16})$/.exec(path);
  if (archive) return { kind: "archive", id: archive[1], agent: true, methods: ["GET"] };
  return null;
}
function agentToken(request) {
  // These endpoints are for a native collector. Browsers cannot attach its
  // credential implicitly, use cookies, CORS or an Origin-bearing request.
  if (request.headers.origin !== undefined || request.headers["sec-fetch-site"] !== undefined || request.headers["x-jessie-backup"] !== "1") throw httpError(403, "request_rejected");
  const match = typeof request.headers.authorization === "string" && /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization);
  if (!match || !isToken(match[1])) throw httpError(401, "copy_authorization_required");
  return match[1];
}
function requireAgentHeaders(request) {
  if (request.headers.origin !== undefined || request.headers["sec-fetch-site"] !== undefined || request.headers["x-jessie-backup"] !== "1") throw httpError(403, "request_rejected");
  if (request.method === "POST" && !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) throw httpError(415, "json_required");
}
function mapped(error, agent) {
  if (error instanceof BackupCopyError) return { status: ({ input: 400, missing: 404, unauthorized: 401, paused: 409, limit: 409, busy: 429, changed: 409 })[error.code] ?? 503,
    code: ({ input: "invalid_request", missing: "destination_unavailable", unauthorized: "copy_authorization_required", paused: "copy_paused", limit: "destination_limit", busy: "try_again_later", changed: "settings_changed" })[error.code] ?? "backups_unavailable" };
  if (error?.code === "AUTH_INVALID") return { status: 401, code: "authentication_required" };
  if (error?.httpStatus && [400, 401, 403, 408, 413, 415].includes(error.httpStatus)) return { status: error.httpStatus, code: error.publicCode };
  return { status: 503, code: agent ? "copy_unavailable" : "backups_unavailable" };
}
export function createBackupCopyHandler(service, { origin, actor, kit = createCopyKit, updateKit = createCopyUpdateKit, verificationKit = createVerificationKit, clock = Date.now }) {
  if (origin !== "https://jessiemessage.com" || typeof actor !== "function") throw new TypeError("Private primary backup administration required.");
  let activeTransfers = 0, windowStart = 0, requests = 0, closing = false;
  const transfers = new Set();
  const handler = async (request, response) => {
    let url; try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const selected = route(url.pathname); if (!selected) return false;
    const method = request.method ?? "GET";
    try {
      if (closing) throw new BackupCopyError();
      if (!selected.methods.includes(method)) { reply(response, method, 405, { error: "method_not_allowed" }, { Allow: selected.methods.join(", ") }); request.resume(); return true; }
      let token, adminProof;
      if (selected.agent) {
        const now = clock(); if (now - windowStart >= 60000 || now < windowStart) { windowStart = now; requests = 0; }
        if (++requests > 240) { reply(response, method, 429, { error: "try_again_later" }, { "Retry-After": "60" }); request.resume(); return true; }
        requireAgentHeaders(request);
        if (selected.kind !== "pair") token = agentToken(request);
      } else {
        if (method === "POST") checkMutation(request, origin, url.pathname, false);
        token = sessionToken(request);
        const session = token ? await actor(token) : null;
        if (!session || session.user?.role !== "admin") throw httpError(401, "authentication_required");
        const current = safeSession(session);
        adminProof = current;
        if (method === "POST" && !sameText(request.headers["x-csrf-token"], current.csrf)) throw httpError(403, "csrf_failed");
      }
      if (url.search || url.hash) throw httpError(400, "invalid_request");
      if (selected.kind === "asset") {
        const [name, type] = assets.get(url.pathname); reply(response, method, 200, await readFile(new URL(name, ROOT)), { "Content-Type": type });
      } else if (selected.kind === "summary") reply(response, method, 200, await service.summary());
      else if (selected.kind === "manifest") reply(response, method, 200, await service.manifest(token, request.headers["x-backup-location"]));
      else if (selected.kind === "archive") {
        if (activeTransfers >= 2) { reply(response, method, 429, { error: "try_again_later" }, { "Retry-After": "60" }); return true; }
        activeTransfers++;
        const cancellation = new AbortController(), timer = setTimeout(() => cancellation.abort(), 600000);
        transfers.add(cancellation);
        const close = () => { if (!response.writableFinished) cancellation.abort(); };
        response.once("close", close);
        try {
          await service.transfer(token, selected.id, async (archive, file) => {
            if (cancellation.signal.aborted) throw new BackupCopyError();
            response.writeHead(200, { ...AUTH_HEADERS, "Content-Type": "application/octet-stream", "Content-Length": String(archive.bytes),
              "Content-Disposition": `attachment; filename="${archive.filename}"`, "X-Backup-Sha256": archive.sha256 });
            await pipeline(file.createReadStream({ start: 0, end: archive.bytes - 1, autoClose: false }), response, { signal: cancellation.signal });
          }, { signal: cancellation.signal });
        } finally { clearTimeout(timer); response.off("close", close); transfers.delete(cancellation); activeTransfers--; }
      } else {
        const body = await readJson(request);
        if (selected.kind === "verification-kit") {
          const { captureId } = copyFields(body, ["captureId"]);
          const bytes = await verificationKit(await service.verification(captureId));
          const session = await actor(token);
          if (!session || session.user?.role !== "admin") throw httpError(401, "authentication_required");
          const current = safeSession(session);
          if (current.user.id !== adminProof.user.id || !sameText(current.csrf, adminProof.csrf)) throw httpError(401, "authentication_required");
          reply(response, method, 200, bytes, { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="JessieMessage-verifier-Windows.zip"' });
        } else if (selected.kind === "pair") reply(response, method, 200, await service.pair(body));
        else if (selected.kind === "receipt") reply(response, method, 200, await service.acknowledge(token, body));
        else if (selected.kind === "create") reply(response, method, 201, await service.create(body));
        else if (selected.kind === "settings") reply(response, method, 200, await service.update(selected.id, body));
        else {
          copyFields(body, []);
          if (selected.kind === "revoke") reply(response, method, 200, await service.revoke(selected.id));
          else {
            const updating = selected.kind === "windows-update-kit";
            const bytes = updating ? await updateKit(await service.updateKit(selected.id)) : await kit(await service.preparePairing(selected.id));
            const session = await actor(token);
            if (!session || session.user?.role !== "admin") throw httpError(401, "authentication_required");
            const current = safeSession(session);
            if (current.user.id !== adminProof.user.id || !sameText(current.csrf, adminProof.csrf)) throw httpError(401, "authentication_required");
            reply(response, method, 200, bytes, { "Content-Type": "application/zip", "Content-Disposition": updating ? 'attachment; filename="JessieMessage-mise-a-jour-Windows.zip"' : 'attachment; filename="JessieMessage-sauvegardes-Windows.zip"' });
          }
        }
      }
    } catch (error) {
      if (response.headersSent) { if (!response.writableFinished) response.destroy(); }
      else if (!response.destroyed) {
        const { status, code } = mapped(error, selected.agent), headers = {};
        if (status === 429) headers["Retry-After"] = "60";
        if (method === "POST") { headers.Connection = "close"; request.resume(); }
        reply(response, method, status, { error: code }, headers);
      }
    }
    return true;
  };
  return Object.assign(handler, { close() { closing = true; for (const controller of transfers) controller.abort(); } });
}
