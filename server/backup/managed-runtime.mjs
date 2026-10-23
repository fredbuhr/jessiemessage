import { fork } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { request } from "node:http";
import { Readable } from "node:stream";
import { privateAuthenticationProcessOptions } from "../config/private-auth-environment.mjs";

const CHILD = fileURLToPath(new URL("../../scripts/private-messaging-child.mjs", import.meta.url));
const neutral = code => Object.assign(new Error("The managed private runtime operation was not confirmed."), { code });
const path = value => typeof value === "string" && value.startsWith("/") && value !== "/" && resolve(value) === value
  && value.length <= 4096 && !/[\\\x00-\x1f\x7f]/.test(value);
const startedMessage = value => value && Object.getPrototypeOf(value) === Object.prototype
  && Reflect.ownKeys(value).length === 1 && Object.getOwnPropertyDescriptor(value, "type")?.value === "runtime_started";

// Native fetch rewrites Host on Node 24. Use an actual loopback HTTP request so
// the application's exact primary Host is present on the wire.
function localFetch(url, options) {
  return new Promise((yes, no) => {
    const pending = request(url, { method: options.method, headers: options.headers, signal: options.signal, agent: false }, incoming => {
      try {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) headers.append(name, item);
        yes(new Response(Readable.toWeb(incoming), { status: incoming.statusCode, headers }));
      } catch (error) { incoming.destroy(); no(error); }
    });
    pending.once("error", no); pending.end();
  });
}

async function readiness(fetchClient, port, signal, milliseconds, parentGateway) {
  const request = new AbortController();
  const abort = () => request.abort(); signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) request.abort();
  let reader, response, timer;
  const cancelled = new Promise((resolveFailure) => {
    request.signal.addEventListener("abort", () => resolveFailure(false), { once: true });
    if (request.signal.aborted) resolveFailure(false);
    timer = setTimeout(() => request.abort(), milliseconds);
  });
  const operation = (async () => {
    try {
      response = await fetchClient(`http://127.0.0.1:${port}/api/ready`, { method: "GET", redirect: "error", cache: "no-store", credentials: "omit",
        headers: { Accept: "application/json", Host: "jessiemessage.com", "X-Forwarded-Proto": "https", ...(parentGateway ? { "X-Jessie-Parent-Peer": "127.0.0.1" } : {}) }, signal: request.signal });
      if (request.signal.aborted) return false;
      if (response?.status !== 200 || response.redirected || typeof response.headers?.get !== "function"
        || response.headers.get("set-cookie") !== null || typeof response.body?.getReader !== "function") return false;
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 1024)) return false;
      reader = response.body.getReader(); const chunks = []; let length = 0;
      while (!request.signal.aborted) {
        const part = await reader.read();
        if (part.done) break;
        if (!(part.value instanceof Uint8Array) || (length += part.value.byteLength) > 1024) return false;
        chunks.push(part.value);
      }
      if (request.signal.aborted) return false;
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      return value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).length === 1 && value.status === "ready";
    } catch { return false; }
    finally {
      try { void Promise.resolve(reader ? reader.cancel() : response?.body?.cancel?.()).catch(() => {}); } catch {}
      try { reader?.releaseLock(); } catch {}
    }
  })();
  try { return await Promise.race([operation, cancelled]); }
  finally {
    clearTimeout(timer); signal.removeEventListener("abort", abort); request.abort();
    if (!reader) void response?.body?.cancel?.().catch(() => {});
  }
}

/** A fixed IPC child, never an arbitrary command or shell. Internal seams are tests only. */
export function createManagedRuntime({ runtimeDirectory, privateDirectory, operationsDirectory, port = 3000, environment, onUnexpectedExit, accountClosures = false, parentGateway = false, video = false, experience = false } = {}, internal = {}) {
  const { forkClient = fork, fetchClient = localFetch, startupMilliseconds = 30000, stopMilliseconds = 20000,
    requestMilliseconds = 1000, retryMilliseconds = 100 } = internal;
  if (typeof experience !== "boolean" || experience && !video || typeof video !== "boolean" || video && (!accountClosures || parentGateway) || typeof parentGateway !== "boolean" || typeof accountClosures !== "boolean" || accountClosures && operationsDirectory === undefined || !path(runtimeDirectory) || !path(privateDirectory) || operationsDirectory !== undefined && !path(operationsDirectory) || !Number.isSafeInteger(port) || port < 1 || port > 65535
    || typeof forkClient !== "function" || typeof fetchClient !== "function" || onUnexpectedExit !== undefined && typeof onUnexpectedExit !== "function"
    || [startupMilliseconds, stopMilliseconds, requestMilliseconds, retryMilliseconds].some(value => !Number.isSafeInteger(value) || value < 1 || value > 60000)) throw neutral("MANAGED_RUNTIME_CONFIGURATION");
  try {
    const options = privateAuthenticationProcessOptions(environment, []);
    if (options.port !== String(port)) throw new Error();
  } catch { throw neutral("MANAGED_RUNTIME_CONFIGURATION"); }
  const childEnvironment = { ...environment };
  let current = null, destroyed = false, destroying = null;

  function state() { return Object.freeze({ status: destroyed ? "closed" : current?.status ?? "stopped" }); }
  async function stopRecord(record) {
    if (record.stopping) return record.stopping;
    record.stopping = (async () => {
      record.status = "stopping"; record.cancel.abort();
      if (record.result) {
        record.status = "stopped";
        if (record.result.exitCode !== 0 || record.result.signal !== null) throw neutral("MANAGED_RUNTIME_STOP");
        return record.result;
      }
      let forced = false;
      const timer = setTimeout(() => { forced = true; try { record.child.kill("SIGKILL"); } catch {} }, stopMilliseconds);
      try {
        try { if (!record.child.kill("SIGTERM") && !record.result) throw new Error(); }
        catch { forced = true; try { record.child.kill("SIGKILL"); } catch {} }
        const result = await record.closed;
        record.status = "stopped";
        if (forced || result.exitCode !== 0 || result.signal !== null) throw neutral("MANAGED_RUNTIME_STOP");
        return result;
      } finally { clearTimeout(timer); }
    })();
    return record.stopping;
  }
  function start() {
    if (destroyed) return Promise.reject(neutral("MANAGED_RUNTIME_CLOSED"));
    if (current && !current.result) {
      if (current.status === "stopping") return Promise.reject(neutral("MANAGED_RUNTIME_BUSY"));
      return current.starting;
    }
    let child;
    try {
      child = forkClient(CHILD, ["--runtime-directory", runtimeDirectory, "--private-directory", privateDirectory, "--port", String(port),
        ...(operationsDirectory === undefined ? [] : ["--operations-directory", operationsDirectory]), ...(accountClosures ? ["--account-closures", "managed"] : []), ...(parentGateway ? ["--parent-gateway", "managed"] : []), ...(video ? ["--video", "managed"] : []), ...(experience ? ["--experience", "managed"] : [])],
        { env: childEnvironment, execArgv: [], stdio: ["ignore", "inherit", "inherit", "ipc"], serialization: "json" });
    } catch { return Promise.reject(neutral("MANAGED_RUNTIME_START")); }
    const record = { child, status: "starting", cancel: new AbortController(), result: null, stopping: null, starting: null, closed: null };
    current = record;
    let resolveMessage;
    const message = new Promise(resolveReady => { resolveMessage = resolveReady; });
    const onMessage = value => { resolveMessage(startedMessage(value)); };
    child.on("message", onMessage);
    record.closed = new Promise(resolveClose => {
      const finished = (exitCode, signal) => {
        if (record.result) return;
        const unexpected = record.status !== "stopping" && !destroyed;
        record.result = Object.freeze({ exitCode, signal });
        record.cancel.abort(); resolveMessage(false); resolveClose(record.result);
        if (record.status !== "stopping") record.status = "stopped";
        if (unexpected && onUnexpectedExit) {
          try { void Promise.resolve(onUnexpectedExit(Object.freeze({ type: "runtime_exited" }))).catch(() => {}); } catch {}
        }
      };
      child.once("close", finished);
      // Logs are inherited, not pipes owned by this parent. The actual exit
      // also proves termination when a parent-initiated IPC disconnect leaves
      // Node's close notification pending despite a completed process exit.
      child.once("exit", finished);
    });
    child.once("error", () => { resolveMessage(false); record.cancel.abort(); });
    record.starting = (async () => {
      const until = performance.now() + startupMilliseconds;
      let startupTimer, waitTimer;
      const aborted = new Promise(resolveAbort => { record.cancel.signal.addEventListener("abort", () => resolveAbort(false), { once: true }); });
      const expired = new Promise(resolveExpired => { startupTimer = setTimeout(() => resolveExpired(false), startupMilliseconds); });
      try {
        if (!await Promise.race([message, expired, aborted])) throw new Error();
        while (!record.cancel.signal.aborted && !destroyed && performance.now() < until) {
          const remaining = Math.max(1, Math.floor(until - performance.now()));
          if (await readiness(fetchClient, port, record.cancel.signal, Math.min(requestMilliseconds, remaining), parentGateway)) {
            if (record.cancel.signal.aborted || record.result || destroyed) throw new Error();
            record.status = "running"; return Object.freeze({ ready: true });
          }
          await Promise.race([new Promise(resolveWait => { waitTimer = setTimeout(resolveWait, Math.min(retryMilliseconds, remaining)); }), aborted, expired]);
          clearTimeout(waitTimer);
        }
        throw new Error();
      } catch {
        try { await stopRecord(record); } catch {}
        throw neutral("MANAGED_RUNTIME_START");
      } finally { clearTimeout(startupTimer); clearTimeout(waitTimer); child.off("message", onMessage); }
    })();
    return record.starting;
  }
  function stop() { return current ? stopRecord(current) : Promise.resolve(Object.freeze({ exitCode: 0, signal: null })); }
  function destroy() {
    if (destroying) return destroying;
    destroyed = true;
    destroying = stop().then(() => {});
    return destroying;
  }
  return Object.freeze({ start, stop, destroy, state });
}
