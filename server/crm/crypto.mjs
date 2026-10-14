import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { validateNotes, validateVersion } from "./validation.mjs";

const NOTES_NAMESPACE = Buffer.from("jessiemessage:crm-notes:v1:", "ascii");
const MAX_ENVELOPE_CHARACTERS = 44000;
const MAX_NOTE_BYTES = 32768;

export class CrmCryptoError extends Error {
  constructor(code) {
    super("Private record processing failed.");
    this.name = "CrmCryptoError";
    this.code = code;
  }
}

function invalid(code) { return new CrmCryptoError(code); }

function associatedData(key, context) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || context === null
    || typeof context !== "object" || Array.isArray(context)
    || !Buffer.isBuffer(context.adminId) || context.adminId.length !== 16
    || !Buffer.isBuffer(context.conversationId) || context.conversationId.length !== 16) {
    throw invalid("CRM_CRYPTO_CONFIG");
  }
  try { validateVersion(context.version, { allowZero: false }); }
  catch { throw invalid("CRM_CRYPTO_CONFIG"); }
  const revision = Buffer.alloc(4);
  revision.writeUInt32BE(Number(context.version));
  // This is the notes revision, not the independently incremented optimistic
  // profile version. Label removal must leave existing ciphertext decryptable.
  return Buffer.concat([NOTES_NAMESPACE, context.adminId, context.conversationId, revision]);
}

function decodeCanonical(value, expectedBytes) {
  if (typeof value !== "string" || value.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw invalid("CRM_NOTES_INVALID");
  }
  const bytes = Buffer.from(value, "base64url");
  if ((expectedBytes !== undefined && bytes.length !== expectedBytes)
    || bytes.toString("base64url") !== value) throw invalid("CRM_NOTES_INVALID");
  return bytes;
}

export function sealNotes(notes, key, context) {
  validateNotes(notes);
  const aad = associatedData(key, context);
  if (notes === "") return null;
  const plaintext = Buffer.from(notes, "utf8");
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = `v1.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
    if (envelope.length > MAX_ENVELOPE_CHARACTERS) throw invalid("CRM_UNAVAILABLE");
    return envelope;
  } catch { throw invalid("CRM_UNAVAILABLE"); }
  finally { plaintext.fill(0); }
}

export function openNotes(encrypted, key, context) {
  const aad = associatedData(key, context);
  if (encrypted === null) return "";
  let plaintext;
  let finalBytes;
  try {
    if (typeof encrypted !== "string" || encrypted.length > MAX_ENVELOPE_CHARACTERS) {
      throw invalid("CRM_NOTES_INVALID");
    }
    const fields = encrypted.split(".");
    if (fields.length !== 4 || fields[0] !== "v1") throw invalid("CRM_NOTES_INVALID");
    const nonce = decodeCanonical(fields[1], 12);
    const ciphertext = decodeCanonical(fields[2]);
    const tag = decodeCanonical(fields[3], 16);
    if (ciphertext.length < 1 || ciphertext.length > MAX_NOTE_BYTES) throw invalid("CRM_NOTES_INVALID");
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    plaintext = decipher.update(ciphertext);
    finalBytes = decipher.final();
    if (finalBytes.length > 0) {
      const initialBytes = plaintext;
      plaintext = Buffer.concat([initialBytes, finalBytes]);
      initialBytes.fill(0);
      finalBytes.fill(0);
    }
    const notes = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(plaintext);
    return validateNotes(notes);
  } catch { throw invalid("CRM_NOTES_INVALID"); }
  finally {
    plaintext?.fill(0);
    finalBytes?.fill(0);
  }
}
