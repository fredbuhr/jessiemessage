import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { validatePushEndpoint, validateSubscription } from "./validation.mjs";

export class NotificationCryptoError extends Error {
  constructor() { super("Notification settings could not be opened."); this.name = "NotificationCryptoError"; this.code = "NOTIFICATIONS_CRYPTO"; this.retryable = false; }
}
const fail = () => { throw new NotificationCryptoError(); };
function keyValue(key) { if (!Buffer.isBuffer(key) || key.length !== 32) fail(); }
function aad(key, binding) {
  keyValue(key);
  if (!Buffer.isBuffer(binding?.subscriptionId) || binding.subscriptionId.length !== 16 || !Buffer.isBuffer(binding?.userId)
    || binding.userId.length !== 16 || !Number.isInteger(binding.generation) || binding.generation < 1 || binding.generation > 4294967295) fail();
  const generation = Buffer.alloc(4); generation.writeUInt32BE(binding.generation);
  return Buffer.concat([Buffer.from("jessiemessage:push-subscription:v1:\0"), binding.subscriptionId, binding.userId, generation]);
}
function decode(value, size) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || size !== undefined && bytes.length !== size) fail();
  return bytes;
}
export function endpointDigest(endpoint, key) {
  keyValue(key);
  return createHmac("sha256", key).update("jessiemessage:push-endpoint:v1:\0").update(validatePushEndpoint(endpoint)).digest();
}
export function sealSubscription(value, key, binding) {
  const associatedData = aad(key, binding), plaintext = Buffer.from(JSON.stringify(validateSubscription(value)));
  try {
    const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(associatedData);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const result = `v1.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
    if (result.length > 4096) fail();
    return result;
  } catch { fail(); }
  finally { plaintext.fill(0); }
}
export function openSubscription(value, key, binding) {
  const associatedData = aad(key, binding);
  let plaintext, tail;
  try {
    if (typeof value !== "string" || value.length > 4096) fail();
    const fields = value.split(".");
    if (fields.length !== 4 || fields[0] !== "v1") fail();
    const nonce = decode(fields[1], 12), ciphertext = decode(fields[2]), tag = decode(fields[3], 16);
    if (ciphertext.length < 1 || ciphertext.length > 3000) fail();
    const decipher = createDecipheriv("aes-256-gcm", key, nonce); decipher.setAAD(associatedData); decipher.setAuthTag(tag);
    plaintext = decipher.update(ciphertext); tail = decipher.final();
    if (tail.length !== 0) fail();
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(plaintext), result = validateSubscription(JSON.parse(text));
    if (JSON.stringify(result) !== text) fail();
    return result;
  } catch { fail(); }
  finally { plaintext?.fill(0); tail?.fill(0); }
}
