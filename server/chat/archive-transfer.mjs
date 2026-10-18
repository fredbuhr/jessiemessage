import { reply } from "../auth/http.mjs";
import { ConversationExportError } from "./conversation-export.mjs";

// Primary and legacy handlers sharing one exporter also share its transfer slot.
// A slow receiver cannot retain one archive and start another preparation.
const transfers = new WeakMap();

export function conversationExportFailure(error) {
  if (!(error instanceof ConversationExportError)) return null;
  const states = { input: [400, "invalid_request"], limit: [413, "conversation_export_limit"], busy: [429, "conversation_export_busy"], changed: [409, "conversation_export_changed"], unauthorized: [401, "authentication_required"], cancelled: [503, "conversation_export_interrupted"] };
  const [status, code] = states[error.code] ?? [503, "conversation_export_unavailable"];
  return { status, code, ...(status === 429 ? { retry: 30 } : {}) };
}

/** Shared transport; each caller supplies its own current role and ownership proof. */
export function createArchiveTransfer(exporter, { invalidArchive = () => new ConversationExportError() } = {}) {
  if (exporter !== null && (typeof exporter?.create !== "function" || typeof exporter.photos !== "boolean"
    || !Number.isSafeInteger(exporter.maxBytes) || exporter.maxBytes < 22 || exporter.maxBytes > 32 * 1024 * 1024)) throw new TypeError("A bounded conversation exporter is required.");
  const active = exporter ? transfers.get(exporter) ?? new Set() : new Set();
  if (exporter) transfers.set(exporter, active);
  let closing = false;
  return {
    close() { closing = true; for (const controller of active) controller.abort(); },
    async send(request, response, parameters, verify) {
      if (!exporter || closing) throw new ConversationExportError("cancelled");
      if (!/^[a-f0-9]{32}$/.test(parameters.conversationId) || typeof verify !== "function") throw invalidArchive();
      if (active.size) throw new ConversationExportError("busy");
      const controller = new AbortController(), abort = () => controller.abort(); let archive;
      const deadline = setTimeout(abort, 65000); deadline.unref?.();
      const abortTransfer = () => { if (response.headersSent && !response.writableFinished) response.destroy(); };
      controller.signal.addEventListener("abort", abortTransfer);
      active.add(controller); request.once("aborted", abort); response.once("close", abort);
      try {
        if (request.aborted || response.destroyed || closing) controller.abort();
        archive = await exporter.create({ ...parameters, signal: controller.signal });
        if (!Buffer.isBuffer(archive) || archive.length < 22 || archive.length > exporter.maxBytes || archive.readUInt32LE() !== 0x04034b50) throw invalidArchive();
        await verify();
        if (controller.signal.aborted) throw new ConversationExportError("cancelled");
        await new Promise((resolve, reject) => {
          const done = () => { response.off("finish", done); response.off("close", done); resolve(); };
          response.once("finish", done); response.once("close", done);
          try { reply(response, request.method, 200, archive, { "Content-Type": "application/zip", "Content-Length": String(archive.length),
            "Content-Disposition": `attachment; filename="JessieMessage-conversation-${parameters.conversationId}.zip"` }); }
          catch (error) { response.off("finish", done); response.off("close", done); reject(error); }
        });
      } finally {
        if (Buffer.isBuffer(archive)) archive.fill(0);
        clearTimeout(deadline);
        active.delete(controller); controller.signal.removeEventListener("abort", abortTransfer); request.off("aborted", abort); response.off("close", abort);
      }
    }
  };
}
