import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual,
} from "node:crypto";
import * as OTPAuth from "otpauth";

// Fixed parameters avoid accepting attacker-controlled work factors from stored hashes.
// N=2^17,r=8,p=1 is the OWASP scrypt minimum (about 128 MiB per active operation).
const SCRYPT_OPTIONS = Object.freeze({ N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 });
const PASSWORD_PREFIX = "$scrypt$v1$N=131072,r=8,p=1$";
const MAX_PASSWORD_QUEUE = 4;
const TOTP_AAD_NAMESPACE = Buffer.from("jessiemessage:totp-secret:v1:", "ascii");
const RECOVERY_NAMESPACE = "jessiemessage:recovery-code:v1:";
const CSRF_NAMESPACE = "jessiemessage:csrf:v1";
let passwordWorkActive = false;
const passwordWorkQueue = [];

export class AuthCryptoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuthCryptoError";
    this.code = code;
  }
}

function invalid(code = "AUTH_CRYPTO_INPUT") {
  return new AuthCryptoError(code, "Invalid authentication data.");
}

function canonicalBase64url(value, expectedBytes) {
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== expectedBytes || bytes.toString("base64url") !== value) throw invalid();
  return bytes;
}

function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8 || password.length > 128 || Buffer.byteLength(password, "utf8") > 512) {
    throw invalid("AUTH_PASSWORD_INVALID");
  }
  // Reject unpaired UTF-16 surrogates: UTF-8 otherwise silently maps different
  // JavaScript strings onto the same replacement-character bytes.
  if (!password.isWellFormed()) throw invalid("AUTH_PASSWORD_INVALID");
}

function drainPasswordWork() {
  if (passwordWorkActive || passwordWorkQueue.length === 0) return;
  passwordWorkActive = true;
  const item = passwordWorkQueue.shift();
  Promise.resolve().then(item.work).then((result) => {
    passwordWorkActive = false;
    item.resolve(result);
    drainPasswordWork();
  }, (error) => {
    passwordWorkActive = false;
    item.reject(error);
    drainPasswordWork();
  });
}

function withPasswordWork(work) {
  return new Promise((resolve, reject) => {
    if (passwordWorkActive && passwordWorkQueue.length >= MAX_PASSWORD_QUEUE) {
      reject(new AuthCryptoError("AUTH_BUSY", "Authentication is busy. Try again shortly."));
      return;
    }
    passwordWorkQueue.push({ work, resolve, reject });
    drainPasswordWork();
  });
}

function derivePassword(password, salt) {
  const bytes = Buffer.from(password, "utf8");
  return new Promise((resolve, reject) => {
    try {
      scrypt(bytes, salt, 64, SCRYPT_OPTIONS, (error, key) => {
        bytes.fill(0);
        if (error) reject(new AuthCryptoError("AUTH_CRYPTO_FAILURE", "Authentication processing failed."));
        else resolve(key);
      });
    } catch {
      bytes.fill(0);
      reject(new AuthCryptoError("AUTH_CRYPTO_FAILURE", "Authentication processing failed."));
    }
  });
}

export function newId() {
  return randomBytes(16);
}

export function newToken() {
  return randomBytes(32).toString("base64url");
}

export function tokenDigest(token) {
  const bytes = canonicalBase64url(token, 32);
  try { return createHash("sha256").update(bytes).digest(); }
  finally { bytes.fill(0); }
}

export async function hashPassword(password) {
  validatePassword(password);
  return withPasswordWork(async () => {
    const salt = randomBytes(16);
    const key = await derivePassword(password, salt);
    try { return `${PASSWORD_PREFIX}${salt.toString("base64url")}$${key.toString("base64url")}`; }
    finally { key.fill(0); }
  });
}

export async function verifyPassword(password, encoded) {
  let salt;
  let expected;
  try {
    validatePassword(password);
    if (typeof encoded !== "string" || encoded.length > 200 || !encoded.startsWith(PASSWORD_PREFIX)) return false;
    const fields = encoded.slice(PASSWORD_PREFIX.length).split("$");
    if (fields.length !== 2) return false;
    salt = canonicalBase64url(fields[0], 16);
    expected = canonicalBase64url(fields[1], 64);
  } catch { return false; }
  try {
    return await withPasswordWork(async () => {
      const actual = await derivePassword(password, salt);
      try { return timingSafeEqual(actual, expected); }
      finally { actual.fill(0); }
    });
  } finally { expected.fill(0); }
}

function parseTotpSecret(value) {
  if (typeof value !== "string" || value.length < 26 || value.length > 103 || !/^[A-Z2-7]+$/.test(value)) throw invalid("AUTH_TOTP_INVALID");
  let parsed;
  try {
    parsed = OTPAuth.Secret.fromBase32(value);
    // Re-encode the decoded bytes to reject aliases with non-zero trailing bits.
    const canonical = OTPAuth.Secret.fromHex(parsed.hex);
    try {
      if (parsed.bytes.length < 16 || parsed.bytes.length > 64 || canonical.base32 !== value) throw invalid("AUTH_TOTP_INVALID");
    } finally { canonical.bytes.fill(0); }
    return parsed;
  } catch {
    parsed?.bytes.fill(0);
    throw invalid("AUTH_TOTP_INVALID");
  }
}

function validateTotpOptions(now, digits, algorithm, period) {
  if (!Number.isSafeInteger(now) || now < 0 || ![6, 8].includes(digits) || !["SHA1", "SHA256", "SHA512"].includes(algorithm)
    || !Number.isInteger(period) || period < 1 || period > 300) throw invalid("AUTH_TOTP_INVALID");
}

export function makeTotpSecret() {
  const secret = new OTPAuth.Secret({ size: 20 });
  try { return secret.base32; }
  finally { secret.bytes.fill(0); }
}

export function totpCode(secret, { now = Date.now(), digits = 6, algorithm = "SHA1", period = 30 } = {}) {
  validateTotpOptions(now, digits, algorithm, period);
  const parsed = parseTotpSecret(secret);
  try { return new OTPAuth.TOTP({ secret: parsed, digits, algorithm, period }).generate({ timestamp: now }); }
  finally { parsed.bytes.fill(0); }
}

export function verifyTotp(secret, code, { now = Date.now(), lastStep = -1 } = {}) {
  validateTotpOptions(now, 6, "SHA1", 30);
  if (!Number.isSafeInteger(lastStep) || lastStep < -1) throw invalid("AUTH_TOTP_INVALID");
  if (typeof code !== "string" || !/^[0-9]{6}$/.test(code)) return null;
  const parsed = parseTotpSecret(secret);
  try {
    const totp = new OTPAuth.TOTP({ secret: parsed, digits: 6, algorithm: "SHA1", period: 30 });
    const delta = totp.validate({ token: code, timestamp: now, window: 1 });
    if (delta === null) return null;
    const step = Math.floor(now / 30000) + delta;
    // The caller must persist this step atomically with session creation.
    return step >= 0 && step > lastStep ? step : null;
  } finally { parsed.bytes.fill(0); }
}

function validateEncryptionContext(key, userId) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !Buffer.isBuffer(userId) || userId.length !== 16) {
    throw invalid("AUTH_CRYPTO_CONFIG");
  }
}

function totpAssociatedData(userId) {
  return Buffer.concat([TOTP_AAD_NAMESPACE, userId]);
}

export function sealTotpSecret(secret, key, userId) {
  validateEncryptionContext(key, userId);
  const parsed = parseTotpSecret(secret);
  parsed.bytes.fill(0);
  const plaintext = Buffer.from(secret, "ascii");
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    cipher.setAAD(totpAssociatedData(userId));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return `v1.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
  } catch { throw new AuthCryptoError("AUTH_CRYPTO_FAILURE", "Authentication processing failed."); }
  finally { plaintext.fill(0); }
}

export function openTotpSecret(sealed, key, userId) {
  validateEncryptionContext(key, userId);
  let plaintext;
  try {
    if (typeof sealed !== "string" || sealed.length > 190) throw invalid();
    const fields = sealed.split(".");
    if (fields.length !== 4 || fields[0] !== "v1") throw invalid();
    const nonce = canonicalBase64url(fields[1], 12);
    const tag = canonicalBase64url(fields[3], 16);
    if (!/^[A-Za-z0-9_-]{35,138}$/.test(fields[2])) throw invalid();
    const ciphertext = Buffer.from(fields[2], "base64url");
    if (ciphertext.toString("base64url") !== fields[2] || ciphertext.length < 26 || ciphertext.length > 103) throw invalid();
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    decipher.setAAD(totpAssociatedData(userId));
    decipher.setAuthTag(tag);
    // Keep even unauthenticated interim bytes reachable for cleanup if final()
    // rejects the tag; never decode or return them before GCM authenticates.
    plaintext = decipher.update(ciphertext);
    const finalBytes = decipher.final();
    if (finalBytes.length > 0) {
      const initialBytes = plaintext;
      plaintext = Buffer.concat([initialBytes, finalBytes]);
      initialBytes.fill(0);
      finalBytes.fill(0);
    }
    const secret = plaintext.toString("utf8");
    const parsed = parseTotpSecret(secret);
    parsed.bytes.fill(0);
    return secret;
  } catch { throw invalid("AUTH_SECRET_INVALID"); }
  finally { plaintext?.fill(0); }
}

export function createRecoveryCodes(count = 8) {
  if (!Number.isInteger(count) || count < 1 || count > 16) throw invalid("AUTH_RECOVERY_INVALID");
  const codes = new Set();
  while (codes.size < count) codes.add(randomBytes(16).toString("hex"));
  return [...codes];
}

export function recoveryCodeDigest(code) {
  if (typeof code !== "string" || code.length > 128 || !/^[0-9A-Fa-f -]+$/.test(code)) throw invalid("AUTH_RECOVERY_INVALID");
  const canonical = code.replace(/[ -]/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(canonical)) throw invalid("AUTH_RECOVERY_INVALID");
  const bytes = Buffer.from(canonical, "hex");
  try { return createHash("sha256").update(RECOVERY_NAMESPACE, "ascii").update(bytes).digest(); }
  finally { bytes.fill(0); }
}

export function csrfToken(rawSessionToken) {
  const key = canonicalBase64url(rawSessionToken, 32);
  try { return createHmac("sha256", key).update(CSRF_NAMESPACE, "ascii").digest("base64url"); }
  finally { key.fill(0); }
}
