import { AUTH_HEADERS, reply } from "../auth/http.mjs";
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
export function createArchiveTransfer(exporter, { invalidArchive = () => new ConversationExportError(), transferTimeoutMs } = {}) {
  const streaming = exporter?.streaming === true;
  if (exporter !== null && (typeof exporter?.create !== "function" || typeof exporter.photos !== "boolean"
    || exporter.streaming !== undefined && typeof exporter.streaming !== "boolean"
    || exporter.videos !== undefined && typeof exporter.videos !== "boolean" || (exporter.videos === true) !== streaming
    || !Number.isSafeInteger(exporter.maxBytes) || exporter.maxBytes < 22
    || exporter.maxBytes > (streaming ? 256 : 32) * 1024 * 1024)) throw new TypeError("A bounded conversation exporter is required.");
  const timeout = transferTimeoutMs === undefined ? (streaming ? 300000 : 65000) : transferTimeoutMs;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > (streaming ? 300000 : 65000)) throw new TypeError("A bounded archive deadline is required.");
  const active = exporter ? transfers.get(exporter) ?? new Set() : new Set();
  if (exporter) transfers.set(exporter, active);
  let closing = false;
  return {
    close() { closing = true; for (const controller of active) controller.abort(); },
    async send(request, response, parameters, verify) {
      if (!exporter || closing) throw new ConversationExportError("cancelled");
      if (!/^[a-f0-9]{32}$/.test(parameters.conversationId) || typeof verify !== "function") throw invalidArchive();
      if (active.size) throw new ConversationExportError("busy");
      const controller = new AbortController(), abort = () => controller.abort(); let archive, iterator, archiveClosing;
      const deadline = setTimeout(abort, timeout); deadline.unref?.();
      const abortTransfer = () => { if (response.headersSent && !response.writableFinished) response.destroy(); };
      const responseError = () => abort();
      const activeTransfer = () => { if (controller.signal.aborted || response.destroyed) throw new ConversationExportError("cancelled"); };
      const closeArchive = () => {
        if (streaming && typeof archive?.close === "function") archiveClosing ??= Promise.resolve().then(() => archive.close());
        return archiveClosing;
      };
      controller.signal.addEventListener("abort", abortTransfer);
      active.add(controller); request.once("aborted", abort); response.once("close", abort); response.on("error", responseError);
      try {
        if (request.aborted || response.destroyed || closing) controller.abort();
        archive = await exporter.create({ ...parameters, signal: controller.signal });
        if (streaming ? !archive || !Number.isSafeInteger(archive.bytes) || archive.bytes < 22 || archive.bytes > exporter.maxBytes
          || typeof archive.stream !== "function" || typeof archive.close !== "function"
          : !Buffer.isBuffer(archive) || archive.length < 22 || archive.length > exporter.maxBytes || archive.readUInt32LE() !== 0x04034b50) throw invalidArchive();
        await verify();
        activeTransfer();
        if (!streaming) {
          await new Promise((resolve, reject) => {
            const done = () => { response.off("finish", done); response.off("close", done); resolve(); };
            response.once("finish", done); response.once("close", done);
            try { reply(response, request.method, 200, archive, { "Content-Type": "application/zip", "Content-Length": String(archive.length),
              "Content-Disposition": `attachment; filename="JessieMessage-conversation-${parameters.conversationId}.zip"` }); }
            catch (error) { response.off("finish", done); response.off("close", done); reject(error); }
          });
        } else {
          const source = archive.stream({ signal: controller.signal });
          if (typeof source?.[Symbol.asyncIterator] !== "function") throw invalidArchive();
          iterator = source[Symbol.asyncIterator]();
          const read = async () => {
            activeTransfer(); const result = await iterator.next();
            try {
              activeTransfer(); if (!result || typeof result.done !== "boolean") throw invalidArchive(); return result;
            } catch (error) { if (Buffer.isBuffer(result?.value)) result.value.fill(0); throw error; }
          };
          const validChunk = (chunk, remaining) => {
            if (!Buffer.isBuffer(chunk) || chunk.length < 1 || chunk.length > 262144 || chunk.length > remaining) throw invalidArchive();
          };
          let sent = 0, prefixBytes = 0; const prefix = [];
          try {
            while (prefixBytes < 4) {
              const part = await read(); if (part.done) throw invalidArchive();
              // Retain ownership before validation so even a rejected Buffer is wiped.
              prefix.push(part.value); validChunk(part.value, archive.bytes - prefixBytes); prefixBytes += part.value.length;
            }
            const signature = Buffer.alloc(4); let offset = 0;
            for (const part of prefix) { const length = Math.min(4 - offset, part.length); part.copy(signature, offset, 0, length); offset += length; if (offset === 4) break; }
            if (signature.readUInt32LE() !== 0x04034b50) throw invalidArchive();
            response.writeHead(200, { ...AUTH_HEADERS, "Content-Type": "application/zip", "Content-Length": String(archive.bytes),
              "Content-Disposition": `attachment; filename="JessieMessage-conversation-${parameters.conversationId}.zip"` });
            const write = async (chunk) => {
              try {
                activeTransfer(); validChunk(chunk, archive.bytes - sent);
                // A successful write() boolean only describes queue pressure.
                // Wait for its callback before wiping this owned plaintext or advancing the source.
                await new Promise((resolve, reject) => { response.write(chunk, (error) => error ? reject(new ConversationExportError("cancelled")) : resolve()); });
                sent += chunk.length; activeTransfer();
              } finally { if (Buffer.isBuffer(chunk)) chunk.fill(0); }
            };
            for (const chunk of prefix) await write(chunk);
            prefix.length = 0;
            while (true) { const part = await read(); if (part.done) break; await write(part.value); }
            if (sent !== archive.bytes) throw invalidArchive();
            await closeArchive(); activeTransfer();
            await new Promise((resolve, reject) => {
              const clean = () => { response.off("finish", finished); response.off("close", closed); };
              const finished = () => { clean(); resolve(); };
              const closed = () => { clean(); response.writableFinished ? resolve() : reject(new ConversationExportError("cancelled")); };
              response.once("finish", finished); response.once("close", closed);
              try { response.end(); } catch (error) { clean(); reject(error); }
            });
          } finally { for (const chunk of prefix) if (Buffer.isBuffer(chunk)) chunk.fill(0); }
        }
      } catch (error) {
        if (response.headersSent && !response.writableFinished && !response.destroyed) response.destroy();
        throw error;
      } finally {
        try {
          if (streaming) { try { await closeArchive(); } finally { await iterator?.return?.(); } }
          else if (Buffer.isBuffer(archive)) archive.fill(0);
        } finally {
          clearTimeout(deadline);
          active.delete(controller); controller.signal.removeEventListener("abort", abortTransfer); request.off("aborted", abort); response.off("close", abort); response.off("error", responseError);
        }
      }
    }
  };
}
