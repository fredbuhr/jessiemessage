import { createServer, createConnection } from "node:net";
import { chmod, lstat } from "node:fs/promises";
import { openPrivateDirectory } from "../files/private-directory.mjs";
import { erasureBinding } from "../data/erasure-state.mjs";
import { registryFields, registryHash, REGISTRY_HEX, REGISTRY_MAX_BYTES, validateRegistrySnapshot } from "./registry-snapshot.mjs";

const NAME = "witness-recovery.sock", REQUEST_BYTES = 4096, TIMEOUT = 45000;
const fail = () => Object.assign(new Error("Private witness recovery is unavailable."), { code: "WITNESS_RECOVERY_UNAVAILABLE" });
const same = (a, b) => ["dev", "ino", "uid", "gid", "mode", "nlink"].every(name => a[name] === b[name]);
function socketIdentity(value) {
  if (!value.isSocket() || value.uid !== BigInt(process.getuid()) || (value.mode & 0o7777n) !== 0o600n || value.nlink !== 1n) throw fail();
  return value;
}
export function validateWitnessRecoveryEnvelope(value) {
  registryFields(value, ["version", "contractSha256", "binding", "request"]);
  registryFields(value.request, ["version", "registryId", "challenge", "snapshot"]);
  const binding = erasureBinding(value.binding), request = value.request;
  if (value.version !== 1 || !REGISTRY_HEX.test(value.contractSha256 ?? "") || request.version !== 1
    || !REGISTRY_HEX.test(request.registryId ?? "") || !REGISTRY_HEX.test(request.challenge ?? "") || request.snapshot !== null) throw fail();
  return { version: 1, contractSha256: value.contractSha256, binding,
    request: { version: 1, registryId: request.registryId, challenge: request.challenge, snapshot: null } };
}
function result(value, request) {
  registryFields(value, ["version", "registryId", "challenge", "revision", "sha256", "snapshot"]);
  const snapshot = validateRegistrySnapshot(value.snapshot);
  if (value.version !== 1 || value.registryId !== request.registryId || value.challenge !== request.challenge
    || !Number.isSafeInteger(value.revision) || value.revision < 1 || value.revision > 10000
    || value.sha256 !== registryHash(snapshot) || snapshot.registryId !== request.registryId) throw fail();
  return { version: 1, registryId: value.registryId, challenge: value.challenge, revision: value.revision, sha256: value.sha256, snapshot };
}
function frame(socket, maximum, { signal, timeout = TIMEOUT } = {}) {
  return new Promise((yes, no) => {
    const chunks = []; let bytes = 0, done = false;
    const finish = (error, value) => {
      if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      socket.off("data", data); socket.off("error", errorEvent); socket.off("end", end); socket.off("close", end);
      if (error) no(fail()); else yes(value);
    };
    const abort = () => { finish(fail()); socket.destroy(); }, errorEvent = () => finish(fail()), end = () => finish(fail());
    const data = part => {
      bytes += part.length;
      if (bytes > maximum) { abort(); return; }
      chunks.push(part);
      const newline = part.indexOf(10);
      if (newline < 0) return;
      if (newline !== part.length - 1) { abort(); return; }
      const content = Buffer.concat(chunks);
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
        if (text.indexOf("\n") !== text.length - 1) throw fail();
        const value = JSON.parse(text.slice(0, -1));
        if (`${JSON.stringify(value)}\n` !== text) throw fail();
        finish(null, value);
      } catch { abort(); }
      finally { content.fill(0); }
    };
    const timer = setTimeout(abort, timeout);
    socket.on("data", data); socket.once("error", errorEvent); socket.once("end", end); socket.once("close", end);
    signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  });
}

/** A private local relay to the already authenticated PC transport. No public
 * route, persisted proof, registry publication, erasure owner or runtime stop. */
export async function createWitnessRecoveryControl({ directory, exchange, signal }, internal = {}) {
  if (typeof exchange !== "function" || signal?.aborted) throw fail();
  const scope = await (internal.openDirectory ?? openPrivateDirectory)(directory);
  const connections = new Set(); let server, identity, ready = false, closed = false, closing;
  const assertReady = async () => {
    if (closed || signal?.aborted || !ready) throw fail();
    await scope.assertReady();
    if (!same(identity, socketIdentity(await lstat(scope.file(NAME), { bigint: true })))) throw fail();
  };
  const stop = () => { void close().catch(() => {}); };
  async function close() {
    if (closing) return closing;
    closed = true; ready = false; signal?.removeEventListener("abort", stop);
    for (const socket of connections) socket.destroy();
    closing = (async () => {
      try { if (server?.listening) await new Promise(resolve => server.close(resolve)); }
      finally { await scope.close(); }
    })();
    return closing;
  }
  try {
    await scope.assertReady();
    try { await lstat(scope.file(NAME)); throw fail(); } catch (error) { if (error.code !== "ENOENT") throw error; }
    server = createServer({ allowHalfOpen: true }, socket => {
      // Root 0700 protects the short bind/chmod interval as well.
      if (!ready || closed || connections.size >= 1) { socket.destroy(); return; }
      connections.add(socket); const cancellation = new AbortController();
      const cancel = () => cancellation.abort(); socket.once("close", cancel);
      // Keep a listener installed after frame parsing and before/during write.
      socket.on("error", cancel);
      const deadline = setTimeout(() => { cancellation.abort(); socket.destroy(); }, TIMEOUT);
      void (async () => {
        try {
          await assertReady();
          const envelope = validateWitnessRecoveryEnvelope(await frame(socket, REQUEST_BYTES, { signal: cancellation.signal }));
          await assertReady();
          const response = result(await exchange(envelope, { signal: cancellation.signal }), envelope.request);
          await assertReady(); if (cancellation.signal.aborted) throw fail();
          const payload = `${JSON.stringify({ version: 1, result: response })}\n`;
          if (Buffer.byteLength(payload) > REGISTRY_MAX_BYTES + 2048) throw fail();
          await new Promise((yes, no) => socket.end(payload, error => error ? no(fail()) : yes()));
        } catch {
          if (!socket.destroyed) socket.end('{"version":1,"error":"WITNESS_RECOVERY_UNAVAILABLE"}\n');
        } finally {
          clearTimeout(deadline); connections.delete(socket); cancellation.abort(); socket.destroy();
        }
      })();
    });
    await new Promise((yes, no) => {
      server.once("error", no); server.listen(scope.file(NAME), () => { server.removeListener("error", no); yes(); });
    });
    server.on("error", stop);
    await chmod(scope.file(NAME), 0o600);
    identity = socketIdentity(await lstat(scope.file(NAME), { bigint: true }));
    await scope.sync(); ready = true; await assertReady();
    signal?.addEventListener("abort", stop, { once: true }); if (signal?.aborted) throw fail();
    return Object.freeze({ close, assertReady });
  } catch { try { await close(); } catch {} throw fail(); }
}

/** Every call relays the caller's new challenge; nothing is cached or treated
 * as authorization. The caller's continuity gate authenticates the ciphertext. */
export async function exchangeWitnessRecovery({ directory, contractSha256, binding, request, signal }, internal = {}) {
  let scope, socket;
  try {
    if (signal?.aborted) throw fail();
    const envelope = validateWitnessRecoveryEnvelope({ version: 1, contractSha256, binding, request });
    const payload = `${JSON.stringify(envelope)}\n`; if (Buffer.byteLength(payload) > REQUEST_BYTES) throw fail();
    scope = await (internal.openDirectory ?? openPrivateDirectory)(directory); await scope.assertReady();
    const before = socketIdentity(await lstat(scope.file(NAME), { bigint: true }));
    socket = createConnection({ path: scope.file(NAME) }); socket.on("error", () => {});
    const response = frame(socket, REGISTRY_MAX_BYTES + 2048, { signal });
    socket.once("connect", () => socket.write(payload));
    const value = await response;
    await scope.assertReady();
    if (signal?.aborted || !same(before, socketIdentity(await lstat(scope.file(NAME), { bigint: true })))) throw fail();
    registryFields(value, ["version", "result"]); if (value.version !== 1) throw fail();
    return result(value.result, request);
  } catch { throw fail(); }
  finally { socket?.destroy(); try { await scope?.close(); } catch { throw fail(); } }
}
