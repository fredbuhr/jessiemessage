import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import webPush from "web-push";
import { validateNotificationVapid } from "./config.mjs";
import { validateSubscription } from "./validation.mjs";

export class NotificationTransportError extends Error {
  constructor(code = "NOTIFICATIONS_TRANSPORT_FAILED", retryable = true) {
    super("Private notification delivery could not be confirmed.");
    this.name = "NotificationTransportError";
    this.code = code;
    this.retryable = retryable;
  }
}

function prefix(value, network, bits, width) { return value >> BigInt(width - bits) === network >> BigInt(width - bits); }
function ipv4(value) { return value.split(".").reduce((total, octet) => total * 256n + BigInt(octet), 0n); }
function ipv6(value) {
  const halves = value.split("::");
  const left = halves[0] ? halves[0].split(":") : [], right = halves[1] ? halves[1].split(":") : [];
  const parts = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return parts.reduce((total, part) => total * 65536n + BigInt(`0x${part}`), 0n);
}

// Only globally routable unicast destinations are useful for the supported
// providers. In particular, reject IPv4-mapped/translated IPv6 and transition
// networks instead of accidentally treating an embedded private IPv4 as public.
export function isPublicPushAddress(address) {
  if (typeof address !== "string" || address.includes("%")) return false;
  if (isIP(address) === 4) {
    const value = ipv4(address);
    return ![
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
      ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
      ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
    ].some(([network, bits]) => prefix(value, ipv4(network), bits, 32));
  }
  if (isIP(address) !== 6 || address.includes(".")) return false;
  const value = ipv6(address);
  return prefix(value, ipv6("2000::"), 3, 128)
    && ![["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]]
      .some(([network, bits]) => prefix(value, ipv6(network), bits, 128));
}

export function notificationRetryAfter(value, now = Date.now()) {
  if (typeof value !== "string" || value.length > 128) return null;
  let seconds;
  if (/^[0-9]+$/.test(value)) seconds = Number(value);
  else { const date = Date.parse(value); seconds = Number.isFinite(date) ? Math.ceil((date - now) / 1000) : NaN; }
  return Number.isFinite(seconds) ? Math.max(1, Math.min(3600, Math.ceil(seconds))) : null;
}

export function createNotificationTransport(config, {
  lookup = dnsLookup, request = httpsRequest, generateRequestDetails = webPush.generateRequestDetails, clock = Date.now,
} = {}) {
  let vapid, deadlineMilliseconds, maxResponseBytes;
  try {
    if (config?.enabled !== true || typeof lookup !== "function" || typeof request !== "function"
      || typeof generateRequestDetails !== "function" || typeof clock !== "function") throw new Error();
    vapid = validateNotificationVapid(config.vapid);
    deadlineMilliseconds = config.transport?.deadlineMilliseconds ?? 10000;
    maxResponseBytes = config.transport?.maxResponseBytes ?? 8192;
    if (!Number.isInteger(deadlineMilliseconds) || deadlineMilliseconds < 1 || deadlineMilliseconds > 10000
      || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 8192) throw new Error();
  } catch { throw new NotificationTransportError("NOTIFICATIONS_TRANSPORT_CONFIG", false); }
  let closed = false, closing;
  const operations = new Set();
  function send(subscription, payload, { signal, ttl = 86400, topic = "JessieMessage" } = {}) {
    if (closed) return Promise.reject(new NotificationTransportError("NOTIFICATIONS_TRANSPORT_CLOSED", false));
    let canonical, details;
    try {
      canonical = validateSubscription(subscription);
      if (typeof payload !== "string" || !payload.isWellFormed() || Buffer.byteLength(payload) > 1024
        || !Number.isInteger(ttl) || ttl < 0 || ttl > 86400 || typeof topic !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(topic)
        || signal !== undefined && (typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) throw new Error();
      details = generateRequestDetails(canonical, payload, { vapidDetails: vapid, TTL: ttl, urgency: "normal", topic, contentEncoding: "aes128gcm" });
      if (details.endpoint !== canonical.endpoint || details.method !== "POST" || !Buffer.isBuffer(details.body)
        || details.body.length > 4096 || !details.headers || typeof details.headers !== "object") throw new Error();
    } catch { return Promise.reject(new NotificationTransportError("NOTIFICATIONS_PAYLOAD_INVALID", false)); }
    let finish, timer, outgoing, incoming, settled = false;
    const record = { abort: () => finish(new NotificationTransportError("NOTIFICATIONS_TRANSPORT_ABORTED")), done: null };
    const result = new Promise((resolve, reject) => {
      finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", record.abort);
        if (error) { incoming?.destroy(); outgoing?.destroy(); reject(error); }
        else resolve(value);
      };
      timer = setTimeout(() => finish(new NotificationTransportError("NOTIFICATIONS_TRANSPORT_TIMEOUT")), deadlineMilliseconds);
      timer.unref?.();
      signal?.addEventListener("abort", record.abort, { once: true });
      if (signal?.aborted || closed) { record.abort(); return; }
      void (async () => {
        const endpoint = new URL(canonical.endpoint);
        const addresses = await lookup(endpoint.hostname, { all: true, verbatim: true });
        if (settled) return;
        if (!Array.isArray(addresses) || addresses.length === 0 || addresses.length > 64
          || addresses.some(({ address, family } = {}) => !isPublicPushAddress(address) || isIP(address) !== family)) {
          throw new NotificationTransportError("NOTIFICATIONS_DESTINATION_INVALID", false);
        }
        const pinned = addresses[0];
        // Keep hostname for Host/SNI/certificate verification, but do not let
        // connect perform a second DNS lookup after the address was checked.
        outgoing = request(endpoint, { method: "POST", headers: details.headers, agent: false, family: pinned.family,
          servername: endpoint.hostname, rejectUnauthorized: true, minVersion: "TLSv1.2", maxHeaderSize: 8192,
          lookup(_host, options, callback) {
            if (typeof options === "function") { callback = options; options = {}; }
            if (settled) { callback(new NotificationTransportError("NOTIFICATIONS_TRANSPORT_ABORTED")); return; }
            if (options?.all) callback(null, [{ ...pinned }]);
            else callback(null, pinned.address, pinned.family);
          },
        }, (response) => {
          incoming = response;
          if (settled) { response.destroy(); return; }
          const statusCode = response.statusCode;
          if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
            finish(new NotificationTransportError()); return;
          }
          let responseBytes = 0;
          response.on("data", (chunk) => {
            responseBytes += Buffer.byteLength(chunk);
            if (responseBytes > maxResponseBytes) finish(new NotificationTransportError("NOTIFICATIONS_RESPONSE_TOO_LARGE"));
          });
          response.once("end", () => finish(null, Object.freeze({ statusCode,
            retryAfterSeconds: notificationRetryAfter(response.headers?.["retry-after"], clock()) })));
          response.once("aborted", () => finish(new NotificationTransportError()));
          response.once("error", () => finish(new NotificationTransportError()));
        });
        outgoing.once("error", () => finish(new NotificationTransportError()));
        if (settled) { outgoing.destroy(); return; }
        outgoing.end(details.body);
      })().catch((error) => finish(error instanceof NotificationTransportError ? error : new NotificationTransportError()));
    });
    record.done = result.then(() => {}, () => {});
    operations.add(record);
    void record.done.then(() => operations.delete(record));
    return result;
  }
  function abort() { for (const operation of operations) operation.abort(); }
  function close() {
    if (closing) return closing;
    closed = true;
    const waiting = [...operations].map(({ done }) => done);
    abort();
    closing = Promise.all(waiting).then(() => {});
    return closing;
  }
  return Object.freeze({ send, abort, close });
}
