import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const MESSAGE_NAMESPACE = Buffer.from("jessiemessage:message-body:v1:", "ascii");
const FINGERPRINT_NAMESPACE = Buffer.from("jessiemessage:message-fingerprint:v1:", "ascii");
const MAX_BODY_CHARACTERS = 4096;
const MAX_BODY_BYTES = 16384;
const MAX_ENVELOPE_CHARACTERS = 22000;
const FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const ONLY_INVISIBLE = /^[\p{C}\p{Z}]+$/u;

export class ChatCryptoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ChatCryptoError";
    this.code = code;
  }
}

function invalid(code) {
  return new ChatCryptoError(code, "Invalid message data.");
}

export function validateMessageBody(body) {
  if (typeof body !== "string" || body.length < 1 || body.length > MAX_BODY_CHARACTERS
    || !body.isWellFormed() || Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES
    || body.trim().length === 0 || ONLY_INVISIBLE.test(body) || FORBIDDEN_CONTROLS.test(body)) {
    throw invalid("CHAT_INPUT");
  }
  // This is plain text. Preserve spaces, newlines, Unicode and markup exactly;
  // the UI must render it as text rather than interpreting it as HTML.
  return body;
}

function validateContext(key, context, needsMessageId) {
  if (!Buffer.isBuffer(key) || key.length !== 32
    || context === null || typeof context !== "object" || Array.isArray(context)
    || !Buffer.isBuffer(context.conversationId) || context.conversationId.length !== 16
    || !Buffer.isBuffer(context.senderId) || context.senderId.length !== 16
    || (needsMessageId && (!Buffer.isBuffer(context.messageId) || context.messageId.length !== 16))) {
    throw invalid("CHAT_CRYPTO_CONFIG");
  }
}

function associatedData(context) {
  // Every identifier has an exact fixed length, so the concatenation is
  // unambiguous and cannot be moved between messages, conversations or senders.
  return Buffer.concat([MESSAGE_NAMESPACE, context.messageId, context.conversationId, context.senderId]);
}

function decodeCanonical(value, expectedBytes) {
  if (typeof value !== "string" || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw invalid("CHAT_MESSAGE_INVALID");
  }
  const bytes = Buffer.from(value, "base64url");
  if ((expectedBytes !== undefined && bytes.length !== expectedBytes)
    || bytes.toString("base64url") !== value) throw invalid("CHAT_MESSAGE_INVALID");
  return bytes;
}

export function encryptMessageBody(body, key, context) {
  validateMessageBody(body);
  validateContext(key, context, true);
  const plaintext = Buffer.from(body, "utf8");
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    cipher.setAAD(associatedData(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = `v1.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
    if (envelope.length > MAX_ENVELOPE_CHARACTERS) throw invalid("CHAT_CRYPTO_FAILURE");
    return envelope;
  } catch {
    throw new ChatCryptoError("CHAT_CRYPTO_FAILURE", "Message processing failed.");
  } finally {
    plaintext.fill(0);
  }
}

export function decryptMessageBody(encrypted, key, context) {
  validateContext(key, context, true);
  let plaintext;
  let finalBytes;
  try {
    if (typeof encrypted !== "string" || encrypted.length > MAX_ENVELOPE_CHARACTERS) {
      throw invalid("CHAT_MESSAGE_INVALID");
    }
    const fields = encrypted.split(".");
    if (fields.length !== 4 || fields[0] !== "v1") throw invalid("CHAT_MESSAGE_INVALID");
    const nonce = decodeCanonical(fields[1], 12);
    const ciphertext = decodeCanonical(fields[2]);
    const tag = decodeCanonical(fields[3], 16);
    if (ciphertext.length < 1 || ciphertext.length > MAX_BODY_BYTES) throw invalid("CHAT_MESSAGE_INVALID");
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(tag);
    // Retain unauthenticated interim bytes for cleanup even if final() rejects
    // the tag. They are neither decoded nor returned until authentication passes.
    plaintext = decipher.update(ciphertext);
    finalBytes = decipher.final();
    if (finalBytes.length > 0) {
      const initialBytes = plaintext;
      plaintext = Buffer.concat([initialBytes, finalBytes]);
      initialBytes.fill(0);
      finalBytes.fill(0);
    }
    // Fatal UTF-8 rejects malformed stored bytes. ignoreBOM preserves a leading
    // U+FEFF when it was part of the original message instead of stripping it.
    const body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(plaintext);
    return validateMessageBody(body);
  } catch {
    throw invalid("CHAT_MESSAGE_INVALID");
  } finally {
    plaintext?.fill(0);
    finalBytes?.fill(0);
  }
}

export function messageFingerprint(body, key, context) {
  validateMessageBody(body);
  validateContext(key, context, false);
  const plaintext = Buffer.from(body, "utf8");
  try {
    // Omitting messageId permits a retry with a newly proposed identifier to
    // resolve to the original message. The secret key prevents a database-only
    // observer from guessing deleted bodies from their retained fingerprints.
    return createHmac("sha256", key).update(FINGERPRINT_NAMESPACE)
      .update(context.conversationId).update(context.senderId).update(plaintext).digest();
  } catch {
    throw new ChatCryptoError("CHAT_CRYPTO_FAILURE", "Message processing failed.");
  } finally {
    plaintext.fill(0);
  }
}

// A literal text containing the same JSON must remain a different request type.
// The encrypted-body envelope and its message/conversation/sender binding stay v1.
export function videoMessageFingerprint(body, key, context) {
  const fingerprint = messageFingerprint(body, key, context);
  return createHmac("sha256", key).update("jessiemessage:video-message-fingerprint:v1:\0")
    .update(fingerprint).digest();
}
