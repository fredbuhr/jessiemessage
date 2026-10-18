import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { validatePayload } from "./validation.mjs";

const PAYLOAD_NAMESPACE = Buffer.from("jessiemessage:broadcast-payload:v1:", "ascii");
const KEY_NAMESPACE = Buffer.from("jessiemessage:broadcast-payload-key:v1:", "ascii");
const FINGERPRINT_NAMESPACE = Buffer.from("jessiemessage:broadcast-fingerprint:v1:", "ascii");
const MAX_ENVELOPE_CHARACTERS = 32000;
const MAX_PAYLOAD_BYTES = 23967;

export class BroadcastCryptoError extends Error {
  constructor() {
    super("Broadcast processing failed.");
    this.name = "BroadcastCryptoError";
    this.code = "BROADCAST_CRYPTO";
  }
}

function invalid() { throw new BroadcastCryptoError(); }

function validateContext(key, binding, needsCampaign) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || binding === null || typeof binding !== "object"
    || Array.isArray(binding) || !Buffer.isBuffer(binding.adminId) || binding.adminId.length !== 16
    || (needsCampaign && (!Buffer.isBuffer(binding.campaignId) || binding.campaignId.length !== 16))) invalid();
}

function associatedData(binding) {
  return Buffer.concat([PAYLOAD_NAMESPACE, binding.adminId, binding.campaignId]);
}

function payloadBytes(input) {
  const plaintext = Buffer.from(JSON.stringify(validatePayload(input)), "utf8");
  if (plaintext.length > MAX_PAYLOAD_BYTES) { plaintext.fill(0); invalid(); }
  return plaintext;
}

function decodeCanonical(value, expectedBytes) {
  if (typeof value !== "string" || value.length < 1 || !/^[A-Za-z0-9_-]+$/u.test(value)) invalid();
  const bytes = Buffer.from(value, "base64url");
  if ((expectedBytes !== undefined && bytes.length !== expectedBytes)
    || bytes.toString("base64url") !== value) invalid();
  return bytes;
}

export function sealPayload(payload, key, binding) {
  validateContext(key, binding, true);
  // Invalid caller input keeps the canonical BROADCAST_INPUT error. Stored
  // plaintext failures in openPayload are all treated as corrupt ciphertext.
  const plaintext = payloadBytes(payload);
  let purposeKey;
  try {
    purposeKey = createHmac("sha256", key).update(KEY_NAMESPACE).digest();
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", purposeKey, nonce, { authTagLength: 16 });
    cipher.setAAD(associatedData(binding));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = `v1.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
    if (envelope.length > MAX_ENVELOPE_CHARACTERS) invalid();
    return envelope;
  } catch { invalid(); }
  finally { plaintext.fill(0); purposeKey?.fill(0); }
}

export function openPayload(encrypted, key, binding) {
  validateContext(key, binding, true);
  let plaintext;
  let finalBytes;
  let purposeKey;
  try {
    if (typeof encrypted !== "string" || encrypted.length > MAX_ENVELOPE_CHARACTERS) invalid();
    const fields = encrypted.split(".");
    if (fields.length !== 4 || fields[0] !== "v1") invalid();
    const nonce = decodeCanonical(fields[1], 12);
    const ciphertext = decodeCanonical(fields[2]);
    const tag = decodeCanonical(fields[3], 16);
    if (ciphertext.length < 1 || ciphertext.length > MAX_PAYLOAD_BYTES) invalid();
    purposeKey = createHmac("sha256", key).update(KEY_NAMESPACE).digest();
    const decipher = createDecipheriv("aes-256-gcm", purposeKey, nonce, { authTagLength: 16 });
    decipher.setAAD(associatedData(binding));
    decipher.setAuthTag(tag);
    plaintext = decipher.update(ciphertext);
    finalBytes = decipher.final();
    if (finalBytes.length > 0) {
      const interim = plaintext;
      plaintext = Buffer.concat([interim, finalBytes]);
      interim.fill(0);
    }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(plaintext);
    const payload = validatePayload(JSON.parse(text));
    // Producers write one canonical form. Reject authenticated duplicate JSON
    // keys, unsorted audiences or alternate shapes instead of interpreting them.
    if (JSON.stringify(payload) !== text) invalid();
    return payload;
  } catch { invalid(); }
  finally { plaintext?.fill(0); finalBytes?.fill(0); purposeKey?.fill(0); }
}

export function campaignFingerprint(payload, key, binding) {
  validateContext(key, binding, false);
  const plaintext = payloadBytes(payload);
  try {
    // Campaign IDs are regenerated on retries; the administrator, complete
    // immutable payload and audience determine the request identity.
    return createHmac("sha256", key).update(FINGERPRINT_NAMESPACE).update(binding.adminId).update(plaintext).digest();
  } catch { invalid(); }
  finally { plaintext.fill(0); }
}
