import { performance } from "node:perf_hooks";

const MAX_DATE = 253402300799999;
const MAX_BODY_BYTES = 1024;
export const EXTERNAL_PROBE_CODES = Object.freeze(["ok", "network_unavailable", "request_timeout", "invalid_response",
  "redirect_rejected", "http_status", "cache_policy", "unexpected_cookie", "body_too_large", "invalid_json", "invalid_status", "clock_invalid"]);
const TARGETS = Object.freeze([
  { name: "http", url: "https://jessiemessage.com/api/health", expected: "ok" },
  { name: "readiness", url: "https://jessiemessage.com/api/ready", expected: "ready" },
]);
const instant = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
const ignore = () => {};
const result = (name, code) => ({ name, status: code === "ok" ? "pass" : "fail", code });

export class ExternalProbeError extends Error {
  constructor() {
    super("The external service probe configuration is invalid.");
    this.name = "ExternalProbeError";
    this.code = "EXTERNAL_PROBE_CONFIGURATION";
  }
}

function record(value, fields) {
  if (value === null || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.getOwnPropertySymbols(value).length) throw new ExternalProbeError();
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== fields.length || fields.some((name) => !Object.hasOwn(value, name))) throw new ExternalProbeError();
  return Object.fromEntries(fields.map((name) => {
    const property = Object.getOwnPropertyDescriptor(value, name);
    if (!Object.hasOwn(property, "value")) throw new ExternalProbeError();
    return [name, property.value];
  }));
}

/** Project an independently supplied report without trusting getters or extras. */
export function validateExternalProbeReport(value) {
  try {
    const item = record(value, ["version", "type", "status", "checkedAt", "durationMilliseconds", "checks"]);
    if (item.version !== 1 || item.type !== "private_service_probe" || !["healthy", "unavailable"].includes(item.status)
      || !instant(item.checkedAt) || !Number.isSafeInteger(item.durationMilliseconds) || item.durationMilliseconds < 0 || item.durationMilliseconds > 60000
      || !Array.isArray(item.checks) || Object.getOwnPropertySymbols(item.checks).length
      || Object.getOwnPropertyNames(item.checks).length !== 3 || item.checks.length !== 2) throw new ExternalProbeError();
    const checks = TARGETS.map((target, index) => {
      const property = Object.getOwnPropertyDescriptor(item.checks, String(index));
      if (!property || !Object.hasOwn(property, "value")) throw new ExternalProbeError();
      const check = record(property.value, ["name", "status", "code"]);
      if (check.name !== target.name || !EXTERNAL_PROBE_CODES.includes(check.code)
        || check.status !== (check.code === "ok" ? "pass" : "fail")) throw new ExternalProbeError();
      return check;
    });
    if (item.status !== (checks.every((check) => check.status === "pass") ? "healthy" : "unavailable")) throw new ExternalProbeError();
    return { version: 1, type: "private_service_probe", status: item.status, checkedAt: item.checkedAt,
      durationMilliseconds: item.durationMilliseconds, checks };
  } catch { throw new ExternalProbeError(); }
}

async function check(target, fetch, timeoutMilliseconds) {
  const controller = new AbortController();
  const deadline = performance.now() + timeoutMilliseconds;
  let timer, reader, expired = false, cancelled = false;
  function cancelBody(response) {
    try {
      if (cancelled || !reader && !response?.body) return;
      cancelled = true;
      Promise.resolve(reader ? reader.cancel() : response.body.cancel()).catch(ignore);
    } catch {}
  }
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      controller.abort();
      cancelBody();
      resolve(result(target.name, "request_timeout"));
    }, timeoutMilliseconds);
  });
  const operation = (async () => {
    let response;
    try {
      response = await fetch(target.url, { method: "GET", redirect: "error", cache: "no-store", credentials: "omit",
        referrerPolicy: "no-referrer", headers: { Accept: "application/json" }, signal: controller.signal });
    } catch { return result(target.name, expired ? "request_timeout" : "network_unavailable"); }
    try {
      if (expired || performance.now() >= deadline) { expired = true; controller.abort(); cancelBody(response); return result(target.name, "request_timeout"); }
      if (!response || typeof response.headers?.get !== "function") return result(target.name, "invalid_response");
      if (response.redirected === true || response.url && response.url !== target.url) return result(target.name, "redirect_rejected");
      if (response.status !== 200) return result(target.name, "http_status");
      const cache = response.headers.get("cache-control");
      if (typeof cache !== "string" || !cache.split(",").some((value) => value.trim().toLowerCase() === "no-store")) return result(target.name, "cache_policy");
      if (response.headers.get("set-cookie") !== null) return result(target.name, "unexpected_cookie");
      const length = response.headers.get("content-length");
      if (length !== null && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES) return result(target.name, "body_too_large");
      if (typeof response.body?.getReader !== "function") return result(target.name, "invalid_response");
      reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const next = await reader.read();
        if (expired || performance.now() >= deadline) { expired = true; controller.abort(); return result(target.name, "request_timeout"); }
        if (next.done) break;
        if (!(next.value instanceof Uint8Array)) return result(target.name, "invalid_response");
        bytes += next.value.byteLength;
        if (bytes > MAX_BODY_BYTES) return result(target.name, "body_too_large");
        chunks.push(Buffer.from(next.value));
      }
      let value;
      try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))); }
      catch { return result(target.name, "invalid_json"); }
      return result(target.name, value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).length === 1 && Object.hasOwn(value, "status") && value.status === target.expected ? "ok" : "invalid_status");
    } catch { return result(target.name, expired ? "request_timeout" : "invalid_response"); }
    finally {
      cancelBody(response);
      try { reader?.releaseLock(); } catch {}
    }
  })();
  try { return await Promise.race([operation, timeout]); }
  finally { clearTimeout(timer); }
}

/** One bounded, anonymous pass over the two fixed public service signals. */
export async function probePrivateService({ fetch = globalThis.fetch, clock = Date.now, timeoutMilliseconds = 5000 } = {}) {
  if (typeof fetch !== "function" || typeof clock !== "function" || !Number.isInteger(timeoutMilliseconds)
    || timeoutMilliseconds < 1 || timeoutMilliseconds > 30000) throw new ExternalProbeError();
  let checkedAt;
  try { checkedAt = clock(); } catch { throw new ExternalProbeError(); }
  if (!instant(checkedAt)) throw new ExternalProbeError();
  const began = performance.now();
  let checks = await Promise.all(TARGETS.map((target) => check(target, fetch, timeoutMilliseconds)));
  try { if (!instant(clock())) checks = TARGETS.map((target) => result(target.name, "clock_invalid")); }
  catch { checks = TARGETS.map((target) => result(target.name, "clock_invalid")); }
  return { version: 1, type: "private_service_probe", status: checks.every((item) => item.status === "pass") ? "healthy" : "unavailable",
    checkedAt, durationMilliseconds: Math.min(timeoutMilliseconds * 2, Math.max(0, Math.ceil(performance.now() - began))), checks };
}
