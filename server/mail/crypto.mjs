import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { canonicalEmail } from "../auth/config.mjs";
import { tokenDigest } from "../auth/crypto.mjs";

const namespace = Buffer.from("jessiemessage:verification-mail:v1:", "ascii");

export class MailCryptoError extends Error {
  constructor() {
    super("Invalid encrypted verification mail payload.");
    this.name = "MailCryptoError";
    this.code = "PAYLOAD_INVALID";
  }
}

const fail = () => { throw new MailCryptoError(); };
function context(key, jobId) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !Buffer.isBuffer(jobId) || jobId.length !== 16) fail();
  return Buffer.concat([namespace, jobId]);
}
function payload(value) {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "email,token"
      || canonicalEmail(value.email) !== value.email) fail();
    tokenDigest(value.token);
    return { email: value.email, token: value.token };
  } catch { fail(); }
}
function decode(value, length) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) fail();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== length || bytes.toString("base64url") !== value) fail();
  return bytes;
}

export function sealVerificationPayload(value, key, jobId) {
  const aad = context(key, jobId);
  const validated = payload(value);
  const plaintext = Buffer.from(JSON.stringify(validated), "utf8");
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    cipher.setAAD(aad);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const result = `v1.${nonce.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
    if (result.length > 1024) fail();
    return result;
  } catch { fail(); }
  finally { plaintext.fill(0); }
}

export function openVerificationPayload(sealed, key, jobId) {
  const aad = context(key, jobId);
  let plaintext;
  try {
    if (typeof sealed !== "string" || sealed.length > 1024) fail();
    const fields = sealed.split(".");
    if (fields.length !== 4 || fields[0] !== "v1") fail();
    const nonce = decode(fields[1], 12);
    const tag = decode(fields[3], 16);
    if (!/^[A-Za-z0-9_-]+$/.test(fields[2])) fail();
    const encrypted = Buffer.from(fields[2], "base64url");
    if (encrypted.length < 68 || encrypted.length > 512 || encrypted.toString("base64url") !== fields[2]) fail();
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    plaintext = decipher.update(encrypted);
    const finalBytes = decipher.final();
    if (finalBytes.length) {
      const initialBytes = plaintext;
      plaintext = Buffer.concat([initialBytes, finalBytes]);
      initialBytes.fill(0); finalBytes.fill(0);
    }
    const decoded = plaintext.toString("utf8");
    if (!Buffer.from(decoded, "utf8").equals(plaintext)) fail();
    return payload(JSON.parse(decoded));
  } catch { fail(); }
  finally { plaintext?.fill(0); }
}
