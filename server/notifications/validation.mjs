import { ECDH } from "node:crypto";

export class NotificationValidationError extends Error {
  constructor() { super("Notification settings are invalid."); this.name = "NotificationValidationError"; this.code = "NOTIFICATIONS_INPUT"; }
}
const fail = () => { throw new NotificationValidationError(); };
function record(value, required, optional = []) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Object.keys(descriptors);
  if (required.some((name) => !names.includes(name)) || names.some((name) => ![...required, ...optional].includes(name)
    || !descriptors[name].enumerable || !Object.hasOwn(descriptors[name], "value"))) fail();
}
function encoded(value, size) {
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== size || bytes.toString("base64url") !== value) fail();
  return bytes;
}
export function validatePushEndpoint(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 2048 || /[\\\s\x00-\x1f\x7f]/.test(value)) fail();
  let url;
  try { url = new URL(value); } catch { fail(); }
  const host = url.hostname;
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password || url.hash || url.href !== value
    || host.split(".").some((label) => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
    || !(host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com"
      || host.endsWith(".push.apple.com") || host.endsWith(".notify.windows.com"))) fail();
  return url.href;
}
export function validateLocale(value) { if (!["fr", "en"].includes(value)) fail(); return value; }
export function validateSubscription(value) {
  record(value, ["endpoint", "keys"], ["expirationTime"]);
  record(value.keys, ["p256dh", "auth"]);
  const endpoint = validatePushEndpoint(value.endpoint), publicKey = encoded(value.keys.p256dh, 65);
  encoded(value.keys.auth, 16);
  try {
    if (publicKey[0] !== 4 || !ECDH.convertKey(publicKey, "prime256v1", undefined, undefined, "uncompressed").equals(publicKey)) fail();
  } catch { fail(); }
  const expirationTime = value.expirationTime ?? null;
  if (expirationTime !== null && (!Number.isSafeInteger(expirationTime) || expirationTime < 0 || expirationTime > 253402300799999)) fail();
  return { endpoint, expirationTime, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}
