import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import * as OTPAuth from "otpauth";
import {
  AuthCryptoError, newId, newToken, tokenDigest, hashPassword, verifyPassword,
  makeTotpSecret, totpCode, verifyTotp, sealTotpSecret, openTotpSecret,
  createRecoveryCodes, recoveryCodeDigest, csrfToken, constantTimeText,
} from "../server/auth/crypto.mjs";

const errorCode = (code) => (error) => error instanceof AuthCryptoError && error.code === code;
const PASSWORD = "Synthetic-test passphrase!";
const SHA1_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("opaque identifiers and tokens use independent random bytes with exact canonical sizes", () => {
  const identifiers = Array.from({ length: 32 }, newId);
  assert.ok(identifiers.every((id) => Buffer.isBuffer(id) && id.length === 16));
  assert.equal(new Set(identifiers.map((id) => id.toString("hex"))).size, 32);
  const tokens = Array.from({ length: 32 }, newToken);
  assert.ok(tokens.every((token) => /^[A-Za-z0-9_-]{43}$/.test(token)));
  assert.equal(new Set(tokens).size, 32);
  for (const token of tokens) {
    const bytes = Buffer.from(token, "base64url");
    assert.equal(bytes.length, 32);
    assert.equal(bytes.toString("base64url"), token);
    assert.deepEqual(tokenDigest(token), createHash("sha256").update(bytes).digest());
    assert.equal(tokenDigest(token).length, 32);
  }
});

test("token decoding rejects aliases, padding, altered trailing bits and unbounded inputs", () => {
  const canonical = Buffer.alloc(32).toString("base64url");
  const alias = `${canonical.slice(0, -1)}B`;
  assert.deepEqual(Buffer.from(alias, "base64url"), Buffer.from(canonical, "base64url"));
  for (const token of [undefined, null, Buffer.alloc(32), "", `${canonical}=`, alias, "A".repeat(42), "A".repeat(44), "A".repeat(100000), ` ${canonical}`, canonical.replace("A", "+")]) {
    assert.throws(() => tokenDigest(token), errorCode("AUTH_CRYPTO_INPUT"));
  }
});

test("password hashes retain fixed memory-hard parameters, random salt and exact passphrase bytes", async () => {
  const password = ` ${PASSWORD} `;
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(first, /^\$scrypt\$v1\$N=131072,r=8,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
  assert.ok(first.length <= 200);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword(password.trim(), first), false);
  assert.equal(await verifyPassword("Another-test passphrase!", first), false);
  assert.equal(first.includes(PASSWORD), false);
});

test("password policy bounds input and never normalizes Unicode", async () => {
  for (const password of [undefined, 123, "a".repeat(7), "a".repeat(129), `${PASSWORD}\ud800`]) {
    await assert.rejects(hashPassword(password), errorCode("AUTH_PASSWORD_INVALID"));
  }
  const minimum = "a".repeat(8);
  assert.equal(await verifyPassword(minimum, await hashPassword(minimum)), true);
  const maximum = "a".repeat(128);
  assert.equal(await verifyPassword(maximum, await hashPassword(maximum)), true);
  const composed = `${PASSWORD}é`;
  const hash = await hashPassword(composed);
  assert.equal(await verifyPassword(`${PASSWORD}e\u0301`, hash), false);
});

test("stored password parsing rejects parameter changes, unsupported versions and noncanonical fields before work", async () => {
  const valid = await hashPassword(PASSWORD);
  const fields = valid.split("$");
  const invalidHashes = [
    undefined, "", "a".repeat(100000), valid.replace("v1", "v2"), valid.replace("131072", "262144"),
    valid.replace("p=1", "p=2"), `${valid}$extra`, `${valid}=`,
    [...fields.slice(0, 4), `${fields[4]}=`, fields[5]].join("$"),
    [...fields.slice(0, 4), fields[4].slice(1), fields[5]].join("$"),
  ];
  for (const encoded of invalidHashes) assert.equal(await verifyPassword(PASSWORD, encoded), false);
  assert.equal(await verifyPassword("short", valid), false);
});

test("password work permits one active operation and four queued operations, then rejects overload", async () => {
  const pending = Array.from({ length: 6 }, () => hashPassword(PASSWORD));
  const results = await Promise.allSettled(pending);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 5);
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "AUTH_BUSY");
  assert.ok(await hashPassword(PASSWORD));
});

test("TOTP matches every RFC 6238 appendix B vector for SHA1, SHA256 and SHA512", () => {
  // Published vectors: https://datatracker.ietf.org/doc/html/rfc6238#appendix-B
  const times = [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000];
  const vectors = [
    { algorithm: "SHA1", seed: "12345678901234567890", codes: ["94287082", "07081804", "14050471", "89005924", "69279037", "65353130"] },
    { algorithm: "SHA256", seed: "12345678901234567890123456789012", codes: ["46119246", "68084774", "67062674", "91819424", "90698825", "77737706"] },
    { algorithm: "SHA512", seed: "1234567890123456789012345678901234567890123456789012345678901234", codes: ["90693936", "25091201", "99943326", "93441116", "38618901", "47863826"] },
  ];
  for (const vector of vectors) {
    const secret = OTPAuth.Secret.fromUTF8(vector.seed).base32;
    times.forEach((time, index) => {
      assert.equal(totpCode(secret, { now: time * 1000, digits: 8, algorithm: vector.algorithm }), vector.codes[index]);
      assert.equal(totpCode(secret, { now: time * 1000, algorithm: vector.algorithm }), vector.codes[index].slice(-6));
    });
  }
});

test("TOTP accepts only one adjacent step and returns the actual step for persistent replay protection", () => {
  const now = 1234567890000;
  const step = Math.floor(now / 30000);
  const current = totpCode(SHA1_SECRET, { now });
  const previous = totpCode(SHA1_SECRET, { now: now - 30000 });
  const next = totpCode(SHA1_SECRET, { now: now + 30000 });
  assert.equal(verifyTotp(SHA1_SECRET, current, { now }), step);
  assert.equal(verifyTotp(SHA1_SECRET, previous, { now }), step - 1);
  assert.equal(verifyTotp(SHA1_SECRET, next, { now }), step + 1);
  assert.equal(verifyTotp(SHA1_SECRET, current, { now, lastStep: step }), null);
  assert.equal(verifyTotp(SHA1_SECRET, previous, { now, lastStep: step - 1 }), null);
  assert.equal(verifyTotp(SHA1_SECRET, current, { now, lastStep: step + 1 }), null);
  assert.equal(verifyTotp(SHA1_SECRET, next, { now, lastStep: step }), step + 1);
  for (const distant of [-60000, 60000]) {
    assert.equal(verifyTotp(SHA1_SECRET, totpCode(SHA1_SECRET, { now: now + distant }), { now }), null);
  }
});

test("TOTP rejects malformed codes, timestamps, options and noncanonical or undersized secrets", () => {
  const now = 59000;
  for (const code of [287082, null, "", "28708", "0287082", " 287082", "287082 ", "２８７０８２", "28708\n"]) {
    assert.equal(verifyTotp(SHA1_SECRET, code, { now }), null);
  }
  for (const options of [{ now: -1 }, { now: NaN }, { now: Infinity }, { now: 1.5 }, { now: Number.MAX_SAFE_INTEGER + 1 }, { digits: 5 }, { digits: 10 }, { algorithm: "MD5" }, { algorithm: "sha1" }, { period: 0 }, { period: 301 }, { period: 30.5 }]) {
    assert.throws(() => totpCode(SHA1_SECRET, options), errorCode("AUTH_TOTP_INVALID"));
  }
  for (const lastStep of [-2, 1.5, NaN, Infinity, "1"]) {
    assert.throws(() => verifyTotp(SHA1_SECRET, "287082", { now, lastStep }), errorCode("AUTH_TOTP_INVALID"));
  }
  const trailingBitsAlias = `${"A".repeat(25)}B`;
  for (const secret of [null, "A".repeat(25), "A".repeat(104), SHA1_SECRET.toLowerCase(), `${SHA1_SECRET}=`, ` ${SHA1_SECRET}`, trailingBitsAlias, SHA1_SECRET.replace("G", "0")]) {
    assert.throws(() => totpCode(secret, { now }), errorCode("AUTH_TOTP_INVALID"));
  }
});

test("generated TOTP secrets have independent 160-bit entropy and usable authenticator shape", () => {
  const secrets = Array.from({ length: 24 }, makeTotpSecret);
  assert.equal(new Set(secrets).size, 24);
  for (const secret of secrets) {
    assert.match(secret, /^[A-Z2-7]{32}$/);
    assert.equal(OTPAuth.Secret.fromBase32(secret).bytes.length, 20);
    const now = 1740000000000;
    assert.equal(verifyTotp(secret, totpCode(secret, { now }), { now }), Math.floor(now / 30000));
  }
});

test("TOTP ciphertext uses fresh GCM nonces and binds the secret to its exact user and key", () => {
  const secret = makeTotpSecret();
  const key = randomBytes(32);
  const userId = newId();
  const sealed = sealTotpSecret(secret, key, userId);
  const second = sealTotpSecret(secret, key, userId);
  assert.match(sealed, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
  assert.ok(sealed.length <= 190);
  assert.notEqual(sealed, second);
  assert.equal(sealed.includes(secret), false);
  assert.equal(openTotpSecret(sealed, key, userId), secret);
  assert.equal(openTotpSecret(second, key, userId), secret);
  for (const [otherKey, otherUser] of [[randomBytes(32), userId], [key, newId()]]) {
    assert.throws(() => openTotpSecret(sealed, otherKey, otherUser), errorCode("AUTH_SECRET_INVALID"));
  }
  for (const [otherKey, otherUser] of [[Buffer.alloc(31), userId], [key, Buffer.alloc(15)], [key.toString("hex"), userId]]) {
    assert.throws(() => sealTotpSecret(secret, otherKey, otherUser), errorCode("AUTH_CRYPTO_CONFIG"));
    assert.throws(() => openTotpSecret(sealed, otherKey, otherUser), errorCode("AUTH_CRYPTO_CONFIG"));
  }
});

test("TOTP decryption rejects malformed formats, modified nonce/ciphertext/tag and secret-bearing errors", () => {
  const secret = makeTotpSecret();
  const key = randomBytes(32);
  const userId = newId();
  const sealed = sealTotpSecret(secret, key, userId);
  const fields = sealed.split(".");
  const tampered = [null, "", "x".repeat(100000), sealed.replace("v1", "v2"), `${sealed}.extra`, `${sealed}=`, fields.slice(0, 3).join(".")];
  for (const index of [1, 2, 3]) {
    const changed = [...fields];
    changed[index] = `${changed[index][0] === "A" ? "B" : "A"}${changed[index].slice(1)}`;
    tampered.push(changed.join("."));
  }
  for (const value of tampered) {
    assert.throws(() => openTotpSecret(value, key, userId), (error) => {
      assert.ok(errorCode("AUTH_SECRET_INVALID")(error));
      assert.equal(error.message.includes(secret), false);
      assert.equal(error.message.includes(sealed), false);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test("recovery codes use 128 random bits, canonical digesting and a separate hash namespace", () => {
  const codes = createRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  for (const code of codes) {
    assert.match(code, /^[a-f0-9]{32}$/);
    const formatted = code.toUpperCase().match(/.{4}/g).join(" - ");
    const digest = recoveryCodeDigest(code);
    assert.equal(digest.length, 32);
    assert.deepEqual(recoveryCodeDigest(formatted), digest);
    assert.notDeepEqual(digest, createHash("sha256").update(Buffer.from(code, "hex")).digest());
  }
  for (const count of [0, -1, 17, 1.5, "8", Infinity]) {
    assert.throws(() => createRecoveryCodes(count), errorCode("AUTH_RECOVERY_INVALID"));
  }
  for (const code of [null, "", "a".repeat(31), "a".repeat(33), "g".repeat(32), `${codes[0]}\t`, `${codes[0]}\n`, `${codes[0]}\u200b`, " ".repeat(129)]) {
    assert.throws(() => recoveryCodeDigest(code), errorCode("AUTH_RECOVERY_INVALID"));
  }
});

test("CSRF proof is deterministic, keyed by raw session entropy, namespace-bound and session-specific", () => {
  const session = newToken();
  const token = csrfToken(session);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(csrfToken(session), token);
  assert.equal(token, createHmac("sha256", Buffer.from(session, "base64url")).update("jessiemessage:csrf:v1", "ascii").digest("base64url"));
  assert.notEqual(token, session);
  assert.notEqual(csrfToken(newToken()), token);
  assert.notEqual(createHmac("sha256", tokenDigest(session)).update("jessiemessage:csrf:v1").digest("base64url"), token);
  assert.throws(() => csrfToken(`${session}=`), errorCode("AUTH_CRYPTO_INPUT"));
});

test("constant-time text equality rejects empty, wrong-type, unequal and over-limit inputs", () => {
  assert.equal(constantTimeText("same text", "same text"), true);
  assert.equal(constantTimeText("é", "é"), true);
  assert.equal(constantTimeText("a".repeat(512), "a".repeat(512)), true);
  for (const [a, b] of [["", ""], [null, null], [Buffer.from("a"), "a"], ["a", "b"], ["aa", "a"], ["é", "e\u0301"], ["a".repeat(513), "a".repeat(513)], ["\ud800", "\ud801"]]) {
    assert.equal(constantTimeText(a, b), false);
  }
});
