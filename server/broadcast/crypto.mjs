import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { validatePayload } from "./validation.mjs";

const PAYLOAD_NAMESPACE = Buffer.from("jessiemessage:broadcast-payload:v1:", "ascii");
const KEY_NAMESPACE = Buffer.from("jessiemessage:broadcast-payload-key:v1:", "ascii");
const FINGERPRINT_NAMESPACE = Buffer.from("jessiemessage:broadcast-fingerprint:v1:", "ascii");
const PAYLOAD_V2_NAMESPACE = Buffer.from("jessiemessage:broadcast-payload:v2:", "ascii");
const KEY_V2_NAMESPACE = Buffer.from("jessiemessage:broadcast-payload-key:v2:", "ascii");
const FINGERPRINT_V2_NAMESPACE = Buffer.from("jessiemessage:broadcast-fingerprint:v2:", "ascii");
const AUDIENCE_NAMESPACE = Buffer.from("jessiemessage:broadcast-audience:v2:", "ascii");
const RECIPIENT_NAMESPACE = Buffer.from("jessiemessage:broadcast-recipient:v2:", "ascii");
const PAYLOAD_V3_NAMESPACE = Buffer.from("jessiemessage:broadcast-payload:v3:", "ascii");
const KEY_V3_NAMESPACE = Buffer.from("jessiemessage:broadcast-payload-key:v3:", "ascii");
const FINGERPRINT_V3_NAMESPACE = Buffer.from("jessiemessage:broadcast-fingerprint:v3:", "ascii");
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

function associatedData(binding, version = 1) {
  return Buffer.concat([version === 3 ? PAYLOAD_V3_NAMESPACE : version === 2 ? PAYLOAD_V2_NAMESPACE : PAYLOAD_NAMESPACE, binding.adminId, binding.campaignId]);
}

function payloadBytes(input, options) {
  const plaintext = Buffer.from(JSON.stringify(validatePayload(input, options)), "utf8");
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

export function sealPayload(payload, key, binding, options) {
  validateContext(key, binding, true);
  // Invalid caller input keeps the canonical BROADCAST_INPUT error. Stored
  // plaintext failures in openPayload are all treated as corrupt ciphertext.
  const plaintext = payloadBytes(payload, options);
  const version = payload.version === 3 ? 3 : payload.version === 2 ? 2 : 1;
  let purposeKey;
  try {
    purposeKey = createHmac("sha256", key).update(version === 3 ? KEY_V3_NAMESPACE : version === 2 ? KEY_V2_NAMESPACE : KEY_NAMESPACE).digest();
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", purposeKey, nonce, { authTagLength: 16 });
    cipher.setAAD(associatedData(binding, version));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = `v${version}.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
    if (envelope.length > MAX_ENVELOPE_CHARACTERS) invalid();
    return envelope;
  } catch { invalid(); }
  finally { plaintext.fill(0); purposeKey?.fill(0); }
}

export function openPayload(encrypted, key, binding, { video = false } = {}) {
  if (typeof video !== "boolean") invalid();
  validateContext(key, binding, true);
  let plaintext;
  let finalBytes;
  let purposeKey;
  try {
    if (typeof encrypted !== "string" || encrypted.length > MAX_ENVELOPE_CHARACTERS) invalid();
    const fields = encrypted.split(".");
    if (fields.length !== 4 || !["v1", "v2", ...(video ? ["v3"] : [])].includes(fields[0])) invalid();
    const version = fields[0] === "v3" ? 3 : fields[0] === "v2" ? 2 : 1;
    const nonce = decodeCanonical(fields[1], 12);
    const ciphertext = decodeCanonical(fields[2]);
    const tag = decodeCanonical(fields[3], 16);
    if (ciphertext.length < 1 || ciphertext.length > MAX_PAYLOAD_BYTES) invalid();
    purposeKey = createHmac("sha256", key).update(version === 3 ? KEY_V3_NAMESPACE : version === 2 ? KEY_V2_NAMESPACE : KEY_NAMESPACE).digest();
    const decipher = createDecipheriv("aes-256-gcm", purposeKey, nonce, { authTagLength: 16 });
    decipher.setAAD(associatedData(binding, version));
    decipher.setAuthTag(tag);
    plaintext = decipher.update(ciphertext);
    finalBytes = decipher.final();
    if (finalBytes.length > 0) {
      const interim = plaintext;
      plaintext = Buffer.concat([interim, finalBytes]);
      interim.fill(0);
    }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(plaintext);
    const payload = validatePayload(JSON.parse(text), { video });
    if ((payload.version === 3 ? 3 : payload.version === 2 ? 2 : 1) !== version) invalid();
    // Producers write one canonical form. Reject authenticated duplicate JSON
    // keys, unsorted audiences or alternate shapes instead of interpreting them.
    if (JSON.stringify(payload) !== text) invalid();
    return payload;
  } catch { invalid(); }
  finally { plaintext?.fill(0); finalBytes?.fill(0); purposeKey?.fill(0); }
}

export function campaignFingerprint(payload, key, binding, options) {
  validateContext(key, binding, false);
  const plaintext = payloadBytes(payload, options);
  try {
    // Campaign IDs are regenerated on retries; the administrator, complete
    // immutable payload and audience determine the request identity.
    return createHmac("sha256", key).update(payload.version === 3 ? FINGERPRINT_V3_NAMESPACE : payload.version === 2 ? FINGERPRINT_V2_NAMESPACE : FINGERPRINT_NAMESPACE)
      .update(binding.adminId).update(plaintext).digest();
  } catch { invalid(); }
  finally { plaintext.fill(0); }
}

/** One ordered, fixed-width stream; no full audience allocation is needed. */
export function createAudienceDigest() {
  const hash = createHash("sha256").update(AUDIENCE_NAMESPACE);
  let previous = null, count = 0, result = null;
  const value = Object.freeze({
    update(conversationId, clientId) {
      if (result !== null || !Buffer.isBuffer(conversationId) || conversationId.length !== 16
        || !Buffer.isBuffer(clientId) || clientId.length !== 16 || count === Number.MAX_SAFE_INTEGER
        || previous !== null && Buffer.compare(previous, conversationId) >= 0) invalid();
      hash.update(conversationId).update(clientId); previous = Buffer.from(conversationId); count += 1;
      return value;
    },
    digest() { if (result === null) result = hash.digest("hex"); return result; },
    get count() { return count; },
  });
  return value;
}

/** Authenticity for one v2 queue member, stored in its existing retry ID. */
export function recipientProof(key, binding) {
  validateContext(key, binding, true);
  for (const name of ["conversationId", "clientId", "messageId"])
    if (!Buffer.isBuffer(binding[name]) || binding[name].length !== 16) invalid();
  return createHmac("sha256", key).update(RECIPIENT_NAMESPACE).update(binding.campaignId).update(binding.adminId)
    .update(binding.conversationId).update(binding.clientId).update(binding.messageId).digest().subarray(0, 16);
}

export function verifyRecipientProof(key, binding, proof) {
  if (!Buffer.isBuffer(proof) || proof.length !== 16) return false;
  try { return timingSafeEqual(recipientProof(key, binding), proof); } catch { return false; }
}
