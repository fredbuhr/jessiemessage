import { createServer } from "node:http";
import { isOriginFormTarget } from "../http/request-origin.mjs";

const fail = () => Object.assign(new Error("Private witness recovery is unavailable."), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
function unavailable(response) {
  if (response.headersSent) { response.destroy(); return; }
  response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Connection: "close" });
  response.end('{"error":"service_unavailable"}');
}

/** Explicit recovery listener: only the existing PC transport is served.
 * There is no application target, readiness claim, worker or child process. */
export function createWitnessRecoveryServer({ port, control }) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || typeof control !== "function") throw fail();
  let closed = false, listening = false, starting, closing, failed = false, pending = 0, finish;
  const finished = new Promise(resolve => { finish = resolve; });
  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 45000, headersTimeout: 15000 }, async (incoming, outgoing) => {
    if (closed || pending >= 128 || !isOriginFormTarget(incoming.url)
      || incoming.rawHeaders.filter((name, index) => index % 2 === 0 && name.toLowerCase() === "host").length !== 1) {
      incoming.resume(); unavailable(outgoing); return;
    }
    pending++;
    try {
      if (await control(incoming, outgoing)) return;
      incoming.resume(); if (!outgoing.destroyed) unavailable(outgoing);
    } catch { incoming.resume(); if (!outgoing.destroyed) unavailable(outgoing); }
    finally { pending--; }
  });
  server.maxConnections = 128;
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("error", () => {
    if (listening && !closed) { failed = true; void close().catch(() => finish({ failed: true })); }
  });
  function start() {
    if (closed) return Promise.reject(fail());
    if (starting) return starting;
    starting = new Promise((yes, no) => {
      const error = () => { server.off("listening", ready); no(fail()); };
      const ready = () => { server.off("error", error); listening = true; yes(); };
      server.once("error", error); server.once("listening", ready);
      try { server.listen(port, "0.0.0.0"); } catch { server.off("error", error); server.off("listening", ready); no(fail()); }
    });
    return starting;
  }
  function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      try {
        try { await starting; } catch {}
        await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      } finally { finish({ failed }); }
    })();
    return closing;
  }
  function assertReady() { if (closed || !listening || !server.listening) throw fail(); }
  return Object.freeze({ start, close, finished, assertReady });
}
