import { readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { AUTH_HEADERS, checkMutation, httpError, readJson, reply, safeSession, sameText, sessionToken } from "../auth/http.mjs";
import { BackupCopyError } from "./copy-state.mjs";
import { ManualBackupError } from "./manual-backup-files.mjs";

const assets = new Map([["/admin/backups", ["manual-backups.html", "text/html; charset=utf-8"]],
  ["/manual-backups.js", ["manual-backups.js", "text/javascript; charset=utf-8"]],
  ["/manual-backups.css", ["manual-backups.css", "text/css; charset=utf-8"]],
  ["/i18n-manual-backups.js", ["i18n-manual-backups.js", "text/javascript; charset=utf-8"]]]);
const ROOT = new URL("../../public/", import.meta.url);
function route(path) {
  if (assets.has(path)) return { kind: "asset", methods: ["GET", "HEAD"] };
  if (path === "/api/admin/backups") return { kind: "summary", methods: ["GET"] };
  if (path === "/api/admin/backups/captures") return { kind: "capture", methods: ["POST"] };
  const archive = /^\/api\/admin\/backups\/archives\/(capture-[1-9][0-9]{0,14}-[a-f0-9]{16})$/.exec(path);
  return archive ? { kind: "archive", id: archive[1], methods: ["GET"] } : null;
}
function mapped(error) {
  if (error instanceof ManualBackupError) return { status: ({ MANUAL_BACKUP_INPUT: 400, MANUAL_BACKUP_BUSY: 429,
    MANUAL_BACKUP_CHANGED: 409, MANUAL_BACKUP_LIMIT: 409 })[error.code] ?? 503,
    code: ({ MANUAL_BACKUP_INPUT: "invalid_request", MANUAL_BACKUP_BUSY: "backup_in_progress",
      MANUAL_BACKUP_CHANGED: "request_changed", MANUAL_BACKUP_LIMIT: "backup_limit" })[error.code] ?? "backups_unavailable" };
  if (error instanceof BackupCopyError) return { status: ({ input: 400, missing: 404, changed: 409, busy: 429 })[error.code] ?? 503,
    code: ({ input: "invalid_request", missing: "archive_unavailable", changed: "archive_changed", busy: "try_again_later" })[error.code] ?? "backups_unavailable" };
  if (error?.code === "AUTH_INVALID") return { status: 401, code: "authentication_required" };
  if (error?.httpStatus && [400, 401, 403, 408, 413, 415].includes(error.httpStatus)) return { status: error.httpStatus, code: error.publicCode };
  return { status: 503, code: "backups_unavailable" };
}
export function createManualBackupHandler(service, { origin, actor }) {
  if (origin !== "https://jessiemessage.com" || typeof actor !== "function") throw new TypeError("Private primary backup administration required.");
  let closing = false, activeTransfers = 0;
  const transfers = new Set();
  const handler = async (request, response) => {
    let url; try { url = new URL(request.url ?? "/", "http://localhost"); } catch { return false; }
    const selected = route(url.pathname); if (!selected) return false;
    const method = request.method ?? "GET";
    try {
      if (closing) throw new ManualBackupError();
      if (!selected.methods.includes(method)) {
        reply(response, method, 405, { error: "method_not_allowed" }, { Allow: selected.methods.join(", ") }); request.resume(); return true;
      }
      if (method === "POST") checkMutation(request, origin, url.pathname, false);
      const token = sessionToken(request), session = token ? await actor(token) : null;
      if (!session || session.user?.role !== "admin") throw httpError(401, "authentication_required");
      const proof = safeSession(session);
      const recheck = async () => {
        if (closing) throw new ManualBackupError();
        const currentSession = await actor(token);
        if (!currentSession || currentSession.user?.role !== "admin") throw httpError(401, "authentication_required");
        const current = safeSession(currentSession);
        if (current.user.id !== proof.user.id || !sameText(current.csrf, proof.csrf)) throw httpError(401, "authentication_required");
        if (closing) throw new ManualBackupError();
      };
      if (method === "POST" && !sameText(request.headers["x-csrf-token"], proof.csrf)) throw httpError(403, "csrf_failed");
      if (url.search || url.hash) throw httpError(400, "invalid_request");
      if (selected.kind === "asset") {
        const [name, type] = assets.get(url.pathname);
        reply(response, method, 200, await readFile(new URL(name, ROOT)), { "Content-Type": type });
      } else if (selected.kind === "summary") reply(response, method, 200, await service.summary());
      else if (selected.kind === "capture") {
        const body = await readJson(request);
        await recheck();
        // Await the private durable write before acknowledging the request. The
        // parent drains this response before its offline capture can stop Node.
        reply(response, method, 202, await service.request(body));
      } else {
        if (activeTransfers >= 2) {
          reply(response, method, 429, { error: "try_again_later" }, { "Retry-After": "60" }); return true;
        }
        activeTransfers++;
        const cancellation = new AbortController(), timer = setTimeout(() => cancellation.abort(), 600000);
        transfers.add(cancellation);
        const close = () => { if (!response.writableFinished) cancellation.abort(); };
        response.once("close", close);
        try {
          await service.transfer(selected.id, async (archive, file) => {
            if (cancellation.signal.aborted) throw new ManualBackupError();
            // Catalog hashing can take time. A revoked or replaced session wins
            // before any ciphertext headers or bytes leave the pinned file.
            await recheck();
            if (cancellation.signal.aborted) throw new ManualBackupError();
            response.writeHead(200, { ...AUTH_HEADERS, "Content-Type": "application/octet-stream", "Content-Length": String(archive.bytes),
              "Content-Disposition": `attachment; filename="${archive.filename}"`, "X-Backup-Sha256": archive.sha256 });
            await pipeline(file.createReadStream({ start: 0, end: archive.bytes - 1, autoClose: false }), response, { signal: cancellation.signal });
          }, { signal: cancellation.signal });
        } finally {
          clearTimeout(timer); response.off("close", close); transfers.delete(cancellation); activeTransfers--;
        }
      }
    } catch (error) {
      if (response.headersSent) { if (!response.writableFinished) response.destroy(); }
      else if (!response.destroyed) {
        const { status, code } = mapped(error), headers = {};
        if (status === 429) headers["Retry-After"] = "60";
        if (method === "POST") { headers.Connection = "close"; request.resume(); }
        reply(response, method, status, { error: code }, headers);
      }
    }
    return true;
  };
  return Object.assign(handler, { close() { closing = true; for (const controller of transfers) controller.abort(); } });
}
