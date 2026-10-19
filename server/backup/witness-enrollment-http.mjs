import { createRequestOriginGuard } from "../http/request-origin.mjs";
import { WitnessEnrollmentError } from "./witness-enrollment.mjs";
import { BackupCopyError } from "./copy-state.mjs";

const ROUTE = "/api/backup-copy/witness/enroll", LIMIT = 4096;
const hex = (value, size = 64) => typeof value === "string" && new RegExp(`^[a-f0-9]{${size}}$`).test(value);
const publicFailures = new WeakSet();
const reject = (status, error) => {
  const failure = Object.assign(new Error("Witness enrollment request unavailable."), { status, publicCode: error });
  publicFailures.add(failure); throw failure;
};
function reply(response, method, status, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": bytes.length, "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...(status >= 400 ? { Connection: "close" } : {}), ...(status === 405 ? { Allow: "POST" } : {}) });
  response.end(method === "HEAD" ? undefined : bytes);
}
function fields(value, names) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== names.length
    || names.some(name => !Object.hasOwn(value, name) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), "value"))) reject(400, "invalid_request");
}

/** Native bearer only. A browser/session cannot spend first-use authorization.
 * Revocation after durable reservation wins over the response, without undoing
 * that reservation or authorizing another attempt. */
export function createWitnessEnrollmentHandler({ enrollment, contract, authorize }) {
  if (typeof enrollment?.reserve !== "function" || typeof authorize !== "function" || !hex(contract?.destination?.destinationId, 32)
    || !Number.isSafeInteger(contract.destination.pairedAt) || !hex(contract.destination.pairingFingerprint)
    || !hex(contract.contractId) || !hex(contract.registryId) || !hex(contract.initialSnapshotSha256)) throw new TypeError("A pinned original witness enrollment is required.");
  const destination = { ...contract.destination }, contractId = contract.contractId, registryId = contract.registryId, initialSnapshotSha256 = contract.initialSnapshotSha256;
  const allowed = createRequestOriginGuard("https://jessiemessage.com"), readers = new Set();
  let closed = false, requests = 0, window = 0;
  async function identity(token) {
    let current;
    try { current = await authorize(token); }
    catch (error) {
      if (error instanceof BackupCopyError && ["unauthorized", "paused"].includes(error.code)) reject(403, "copy_authorization_rejected");
      throw error;
    }
    if (closed || current?.destinationId !== destination.destinationId || current?.pairedAt !== destination.pairedAt
      || current?.pairingFingerprint !== destination.pairingFingerprint) reject(403, "copy_authorization_rejected");
  }
  const handler = async (request, response) => {
    if (typeof request.url !== "string" || !request.url.startsWith(ROUTE)) return false;
    const method = request.method ?? "GET"; let timer;
    try {
      if (request.url !== ROUTE || !allowed(request) || request.headers["x-forwarded-proto"] !== "https") reject(404, "not_found");
      if (closed) reject(503, "witness_enrollment_unavailable");
      if (method !== "POST") reject(405, "method_not_allowed");
      if (request.headers.origin !== undefined || request.headers.cookie !== undefined || Object.keys(request.headers).some(name => name.startsWith("sec-fetch-"))
        || request.headers["x-jessie-backup"] !== "1") reject(403, "request_rejected");
      const singles = new Set(["authorization", "x-jessie-backup", "content-type", "content-length", "x-forwarded-proto"]), seen = new Set();
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index].toLowerCase(); if (!singles.has(name)) continue;
        if (seen.has(name)) reject(400, "invalid_request"); seen.add(name);
      }
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? "");
      if (!match) reject(401, "copy_authorization_required");
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) reject(415, "json_required");
      const declared = request.headers["content-length"];
      if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > LIMIT)) reject(413, "request_too_large");
      const now = Date.now(); if (now - window >= 60000 || now < window) { window = now; requests = 0; }
      if (++requests > 60 || readers.size >= 2) reject(429, "try_again_later");
      await identity(match[1]);
      if (readers.size >= 2) reject(429, "try_again_later");
      readers.add(request); timer = setTimeout(() => request.destroy(), 10000);
      const chunks = []; let length = 0;
      for await (const chunk of request) { if ((length += chunk.length) > LIMIT) reject(413, "request_too_large"); chunks.push(chunk); }
      clearTimeout(timer); timer = null; readers.delete(request);
      let value;
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); value = JSON.parse(text);
        fields(value, ["version", "destinationId", "attemptId"]);
        // Native callers send this canonical three-field request. This also
        // excludes duplicate keys and alternate escaped field aliases.
        if (text !== JSON.stringify({ version: value.version, destinationId: value.destinationId, attemptId: value.attemptId })) reject(400, "invalid_request");
      } catch { reject(400, "invalid_request"); }
      if (value.version !== 1 || value.destinationId !== destination.destinationId || !hex(value.attemptId, 32)) reject(400, "invalid_request");
      await identity(match[1]);
      const packet = await enrollment.reserve(value);
      await identity(match[1]);
      try { fields(packet, ["version", "initialize", "destinationId", "attemptId", "contractSha256", "contractId", "registryId", "initialSnapshotSha256"]); }
      catch { reject(503, "witness_enrollment_unavailable"); }
      if (packet.version !== 1 || typeof packet.initialize !== "boolean" || packet.destinationId !== destination.destinationId
        || packet.attemptId !== value.attemptId || !hex(packet.contractSha256) || packet.contractId !== contractId
        || packet.registryId !== registryId || packet.initialSnapshotSha256 !== initialSnapshotSha256) reject(503, "witness_enrollment_unavailable");
      if (!response.destroyed) reply(response, method, 200, packet);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const known = error instanceof WitnessEnrollmentError;
        const status = known ? (error.code === "WITNESS_ENROLLMENT_RECOVERY_REQUIRED" ? 409 : 503) : publicFailures.has(error) ? error.status : 503;
        const code = known && status === 409 ? "witness_recovery_required" : !known && status !== 503 ? error.publicCode : "witness_enrollment_unavailable";
        reply(response, method, status, { error: code });
      }
    } finally { clearTimeout(timer); readers.delete(request); if (!request.complete) request.resume(); }
    return true;
  };
  Object.defineProperty(handler, "close", { value() { closed = true; for (const request of readers) request.destroy(); readers.clear(); } });
  return handler;
}
