import { peerAddress as verifiedPeerAddress } from "./peer-address.mjs";
import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { sessionToken } from "../auth/http.mjs";

// Pilot limits apply independently in each HTTP process. They are deliberately
// above the UI's session proofs, polling and four concurrent photo downloads.
export const REQUEST_ADMISSION_LIMITS = Object.freeze({
  windowMilliseconds: 60_000,
  globalRequests: 2400,
  peerRequests: 1200,
  tokenRequests: 300,
  peerNewTokens: 128,
  globalConcurrent: 32,
  peerConcurrent: 16,
  tokenConcurrent: 8,
  peerCapacity: 1024,
  tokenCapacity: 2048,
});

const COOKIES = Object.freeze(["__Host-jessie_session", "__Host-jessie_client"]);
const MAX_DATE = 253402300799999;
const BUSY_RETRY_SECONDS = 5;

export class RequestAdmissionError extends Error {
  constructor(code, retryAfter) {
    super("The request cannot be admitted at this time.");
    this.name = "RequestAdmissionError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const busy = () => { throw new RequestAdmissionError("REQUEST_BUSY", BUSY_RETRY_SECONDS); };

function peerAddress(request) {
  const address = verifiedPeerAddress(request);
  if (typeof address !== "string" || address.length > 128 || !isIP(address)) return "unknown";
  // IPv4 clients on a dual-stack listener must retain their IPv4 bucket.
  const normalized = address.toLowerCase();
  const mapped = normalized.startsWith("::ffff:") ? normalized.slice(7) : null;
  return mapped !== null && isIP(mapped) === 4 ? mapped : normalized;
}

/** Synchronous, bounded admission before any session or private SQL lookup. */
export function createRequestAdmission({ clock = Date.now } = {}) {
  if (typeof clock !== "function") throw new TypeError("A request admission clock is required");
  const key = randomBytes(32);
  const peers = new Map(), tokens = new Map();
  const global = { window: -1, count: 0, active: 0 };
  let lastNow = 0;
  const limits = REQUEST_ADMISSION_LIMITS;
  const digest = (purpose, value) => createHmac("sha256", key).update("jessiemessage:request-admission:v1:")
    .update(purpose).update("\0").update(value).digest("hex");
  const count = (entry, window) => entry?.window === window ? entry.count : 0;

  function makeRoom(table, capacity, needed, window, retained = null) {
    if (table.size + needed <= capacity) return;
    // Never evict a live-window counter or an operation/response still using
    // its entry, even when its rate window has expired. Rotating identifiers
    // therefore cannot reset counters through capacity eviction.
    for (const [id, entry] of table) {
      if (entry.window !== window && entry.active === 0 && !retained?.has(id)) table.delete(id);
      if (table.size + needed <= capacity) return;
    }
    busy();
  }

  function enter(request, response) {
    if (typeof response?.once !== "function" || typeof response?.off !== "function") {
      throw new TypeError("A response lifecycle is required for request admission");
    }
    let sampled;
    try { sampled = clock(); } catch { busy(); }
    if (!Number.isSafeInteger(sampled) || sampled < 0 || sampled > MAX_DATE) busy();
    // A backward wall-clock adjustment cannot open an earlier empty window.
    const now = Math.max(lastNow, sampled); lastNow = now;
    const window = Math.floor(now / limits.windowMilliseconds);
    const retryAfter = Math.max(1, Math.ceil(((window + 1) * limits.windowMilliseconds - now) / 1000));
    if (global.active >= limits.globalConcurrent) busy();
    if (count(global, window) >= limits.globalRequests) throw new RequestAdmissionError("REQUEST_RATE_LIMIT", retryAfter);

    const peerId = digest("peer", peerAddress(request));
    const peer = peers.get(peerId);
    const tokenIds = [];
    if (request?.headers) {
      for (const name of COOKIES) {
        const token = sessionToken(request, name);
        if (token !== null) tokenIds.push(digest(`cookie:${name}`, token));
      }
    }
    const tokenEntries = tokenIds.map((id) => tokens.get(id));
    const newTokens = tokenEntries.filter((entry) => !entry).length;
    if ((peer?.active ?? 0) >= limits.peerConcurrent || tokenEntries.some((entry) => (entry?.active ?? 0) >= limits.tokenConcurrent)) busy();
    const allocated = peer?.window === window ? peer.newTokens : 0;
    if (count(peer, window) >= limits.peerRequests || tokenEntries.some((entry) => count(entry, window) >= limits.tokenRequests)
      || allocated + newTokens > limits.peerNewTokens) {
      throw new RequestAdmissionError("REQUEST_RATE_LIMIT", retryAfter);
    }
    // Capacity failures and actor refusals consume no other actor's budget.
    makeRoom(peers, limits.peerCapacity, peer ? 0 : 1, window);
    makeRoom(tokens, limits.tokenCapacity, newTokens, window, new Set(tokenIds));

    const admittedPeer = peer ?? { window, count: 0, active: 0, newTokens: 0 };
    const admittedTokens = tokenEntries.map((entry) => entry ?? { window, count: 0, active: 0 });
    const entries = [global, admittedPeer, ...admittedTokens];
    let operationDone = false, responseDone = response.writableFinished === true || response.destroyed === true;
    let charged = false, released = false;
    function releaseIfComplete() {
      // A close event cannot cancel an outstanding SQL/filesystem operation.
      if (!charged || released || !operationDone || !responseDone) return;
      released = true;
      for (const entry of entries) entry.active -= 1;
      response.off("finish", onResponseDone);
      response.off("close", onResponseDone);
    }
    function onResponseDone() { responseDone = true; releaseIfComplete(); }
    if (!responseDone) {
      try { response.once("finish", onResponseDone); response.once("close", onResponseDone); }
      catch {
        response.off("finish", onResponseDone); response.off("close", onResponseDone);
        busy();
      }
    }
    peers.set(peerId, admittedPeer);
    tokenIds.forEach((id, index) => tokens.set(id, admittedTokens[index]));
    for (const entry of entries) {
      if (entry.window !== window) { entry.window = window; entry.count = 0; }
      entry.count += 1; entry.active += 1;
    }
    admittedPeer.newTokens = allocated + newTokens;
    charged = true;
    return () => { operationDone = true; releaseIfComplete(); };
  }

  return Object.freeze({ enter });
}
