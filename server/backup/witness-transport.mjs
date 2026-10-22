import { randomBytes } from "node:crypto";
import { createRequestOriginGuard } from "../http/request-origin.mjs";
import { REGISTRY_MAX_BYTES, REGISTRY_HEX, registryFields, validateRegistrySnapshot, registryHash } from "./registry-snapshot.mjs";

const ROOT = "/api/backup-copy/witness/";
const fail = () => Object.assign(new Error("The independent witness did not confirm the operation."), { code: "ERASURE_WITNESS_TRANSPORT" });
const validId = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
function reply(response, status, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": bytes.length, "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...(status >= 400 ? { Connection: "close" } : {}) }); response.end(bytes);
}
function requestShape(value, registryId) {
  registryFields(value, ["version", "registryId", "challenge", "snapshot"]);
  const request = value;
  if (request.version !== 1 || request.registryId !== registryId || !REGISTRY_HEX.test(request.challenge)) throw fail();
  if (request.snapshot !== null && request.snapshot?.registryId !== registryId) throw fail();
  return { version: 1, registryId, challenge: request.challenge, snapshot: request.snapshot === null ? null : validateRegistrySnapshot(request.snapshot) };
}

/** The pinned pairing is supplied by an operator-owned contract, never by HTTP.
 * Nonces belong to the core protocol; the existing native bearer capability
 * authenticates the off-host peer. No success is retained across parent restart.
 */
export function createWitnessTransport({ destinationId, pairedAt, pairingFingerprint, registryId, authorize, provisioning = false, pollMilliseconds = 20000 }) {
  if (!validId(destinationId) || !Number.isSafeInteger(pairedAt) || pairedAt < 1 || typeof pairingFingerprint !== "string" || !REGISTRY_HEX.test(pairingFingerprint) || !REGISTRY_HEX.test(registryId)
    || typeof authorize !== "function" || typeof provisioning !== "boolean" || !Number.isSafeInteger(pollMilliseconds) || pollMilliseconds < 1 || pollMilliseconds > 20000) throw fail();
  const allowed = createRequestOriginGuard("https://jessiemessage.com"), waiters = new Set(), polls = new Set(), transfers = new Set();
  let job = null, closed = false, requests = 0, window = 0;
  async function identity(token) {
    const current = await authorize(token);
    if (closed || current?.destinationId !== destinationId || current?.pairedAt !== pairedAt || current?.pairingFingerprint !== pairingFingerprint) throw fail();
  }
  function wake() { for (const resolve of waiters) resolve(); waiters.clear(); }
  function exchange(value, { signal } = {}) {
    if (closed || job || signal?.aborted) return Promise.reject(fail());
    let request; try { request = requestShape(value, registryId); } catch { return Promise.reject(fail()); }
    return new Promise((yes, no) => {
      const record = { requestId: randomBytes(16).toString("hex"), request, finish: null };
      const abort = () => record.finish(null);
      const timer = setTimeout(abort, 60000);
      record.finish = response => {
        if (job !== record) return;
        job = null; clearTimeout(timer); signal?.removeEventListener("abort", abort); wake();
        if (response === null) no(fail()); else yes(response);
      };
      job = record; signal?.addEventListener("abort", abort, { once: true }); wake();
      if (signal?.aborted) abort();
    });
  }
  async function handler(request, response) {
    if (typeof request.url !== "string" || !request.url.startsWith(ROOT)) return false;
    let cancellation;
    try {
      if (!allowed(request) || request.headers["x-forwarded-proto"] !== "https") { reply(response, 404, { error: "not_found" }); return true; }
      const action = request.url.slice(ROOT.length);
      if (!["poll", "response"].includes(action)) { reply(response, 404, { error: "not_found" }); return true; }
      if (closed) throw fail();
      const now = Date.now(); if (now - window >= 60000 || now < window) { window = now; requests = 0; }
      if (++requests > 240 || polls.size >= 2 || transfers.size >= 2) { reply(response, 429, { error: "try_again_later" }); return true; }
      if (request.headers.origin !== undefined || request.headers.cookie !== undefined || Object.keys(request.headers).some(name => name.startsWith("sec-fetch-"))
        || request.headers["x-jessie-backup"] !== "1") { reply(response, 403, { error: "request_rejected" }); return true; }
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? "");
      if (!match) { reply(response, 401, { error: "copy_authorization_required" }); return true; }
      // Authorization can wait. Reserve admission before yielding, including
      // polls that have not reached their long-poll waiter yet.
      (action === "poll" ? polls : transfers).add(request);
      await identity(match[1]);
      if (request.method !== (action === "poll" ? "GET" : "POST")) { reply(response, 405, { error: "method_not_allowed" }); return true; }
      if (action === "poll") {
        if (request.headers["transfer-encoding"] !== undefined || request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0") throw fail();
        if (!job) await new Promise(resolve => {
          const finish = () => { clearTimeout(timer); response.off("close", finish); waiters.delete(finish); resolve(); };
          const timer = setTimeout(finish, pollMilliseconds);
          waiters.add(finish); response.once("close", finish);
          if (closed || job || response.destroyed) finish();
        });
        if (response.destroyed) return true;
        await identity(match[1]);
        reply(response, 200, job ? { version: 1, pending: true, destinationId, provisioning, requestId: job.requestId, request: job.request }
          : { version: 1, pending: false });
      } else {
        if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) { reply(response, 415, { error: "json_required" }); return true; }
        const selected = job;
        if (!selected) { reply(response, 409, { error: "witness_request_expired" }); return true; }
        const declared = request.headers["content-length"];
        if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > REGISTRY_MAX_BYTES + 2048)) { reply(response, 413, { error: "request_too_large" }); return true; }
        cancellation = setTimeout(() => request.destroy(), 20000);
        const chunks = []; let length = 0;
        for await (const chunk of request) { if ((length += chunk.length) > REGISTRY_MAX_BYTES + 2048) throw fail(); chunks.push(chunk); }
        const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
        registryFields(value, ["version", "requestId", "response"]);
        const result = value.response;
        registryFields(result, ["version", "registryId", "challenge", "revision", "sha256", "snapshot"]);
        const snapshot = validateRegistrySnapshot(result.snapshot);
        if (value.version !== 1 || value.requestId !== selected.requestId || result.version !== 1 || result.registryId !== registryId
          || result.challenge !== selected.request.challenge || !Number.isSafeInteger(result.revision) || result.revision < 1 || result.revision > 10000
          || result.sha256 !== registryHash(snapshot) || snapshot.registryId !== registryId) throw fail();
        await identity(match[1]);
        if (job !== selected) { reply(response, 409, { error: "witness_request_expired" }); return true; }
        selected.finish({ version: 1, registryId, challenge: result.challenge, revision: result.revision, sha256: result.sha256, snapshot });
        reply(response, 200, { version: 1, recorded: true });
      }
    } catch { if (!response.headersSent && !response.destroyed) reply(response, 503, { error: "witness_unavailable" }); }
    finally { clearTimeout(cancellation); polls.delete(request); transfers.delete(request); if (!request.complete) request.resume(); }
    return true;
  }
  function close() { closed = true; job?.finish(null); wake(); for (const request of transfers) request.destroy(); }
  Object.defineProperty(handler, "close", { value: close });
  return Object.freeze({ exchange, handler, close });
}
