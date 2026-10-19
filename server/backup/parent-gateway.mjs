import { createServer, request as forward } from "node:http";
import { isOriginFormTarget } from "../http/request-origin.mjs";
import { PARENT_PEER_HEADER } from "../http/peer-address.mjs";

const fail = () => Object.assign(new Error("The managed gateway is unavailable."), { code: "PARENT_GATEWAY" });
const hop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
function headers(value) {
  const omit = new Set([...hop, ...String(value.connection ?? "").toLowerCase().split(",").map(x => x.trim())]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omit.has(key.toLowerCase())));
}
function unavailable(response) {
  if (response.headersSent) { response.destroy(); return; }
  response.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Connection: "close" });
  response.end('{"error":"service_unavailable"}');
}

/** A single fixed loopback target; no redirects, retries, URL targets or upgrades. */
export function createParentGateway({ port, childPort, control, onFailure = () => {} }) {
  if (![port, childPort].every(x => Number.isSafeInteger(x) && x > 0 && x <= 65535) || port === childPort
    || typeof control !== "function" || typeof onFailure !== "function") throw fail();
  let closed = false, listening = false, starting = null, closing = null;
  const pending = new Set();
  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 610000, headersTimeout: 15000 }, async (incoming, outgoing) => {
    if (closed || pending.size >= 512 || !isOriginFormTarget(incoming.url)
      || incoming.rawHeaders.filter((name, index) => index % 2 === 0 && name.toLowerCase() === "host").length !== 1) { incoming.resume(); unavailable(outgoing); return; }
    try {
      if (await control(incoming, outgoing)) return;
      if (closed || incoming.destroyed || outgoing.destroyed) return;
      const sent = headers(incoming.headers);
      delete sent[PARENT_PEER_HEADER];
      sent[PARENT_PEER_HEADER] = incoming.socket.remoteAddress;
      const request = forward({ hostname: "127.0.0.1", port: childPort, path: incoming.url, method: incoming.method, headers: sent, agent: false }, response => {
        outgoing.writeHead(response.statusCode, headers(response.headers));
        response.on("error", () => outgoing.destroy()); response.pipe(outgoing);
      });
      pending.add(request);
      request.setTimeout(600000, () => request.destroy());
      request.on("error", () => unavailable(outgoing));
      request.on("close", () => pending.delete(request));
      incoming.on("aborted", () => request.destroy());
      outgoing.on("close", () => { if (!outgoing.writableFinished) request.destroy(); });
      incoming.pipe(request);
    } catch { incoming.resume(); unavailable(outgoing); }
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("clientError", (_error, socket) => socket.destroy());
  server.on("error", () => { if (listening && !closed) { try { onFailure(); } catch {} } });
  function start() {
    if (closed) return Promise.reject(fail());
    if (starting) return starting;
    starting = new Promise((yes, no) => {
      const error = () => { server.off("listening", ready); no(fail()); };
      const ready = () => { server.off("error", error); listening = true; yes(); };
      server.once("error", error); server.once("listening", ready);
      server.listen(port, "0.0.0.0");
    });
    return starting;
  }
  function close() {
    if (closing) return closing;
    closed = true;
    if (typeof control.close === "function") control.close();
    for (const request of pending) request.destroy();
    closing = new Promise(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    return closing;
  }
  return Object.freeze({ start, close });
}
