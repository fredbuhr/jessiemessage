import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import {
  ChatCryptoError, validateMessageBody, encryptMessageBody, decryptMessageBody, messageFingerprint, videoMessageFingerprint,
} from "../server/chat/crypto.mjs";

const key = randomBytes(32);
const context = Object.freeze({ messageId: randomBytes(16), conversationId: randomBytes(16), senderId: randomBytes(16) });
const hasCode = (code) => (error) => error instanceof ChatCryptoError && error.code === code;
const replaceByte = (value) => {
  const bytes = Buffer.from(value, "base64url");
  bytes[0] ^= 1;
  return bytes.toString("base64url");
};

test("video request fingerprints isolate literal JSON text while retaining exact retry and sender bindings", () => {
  const body = JSON.stringify({ videoId: "a".repeat(32), caption: "Bonjour 🎥" });
  const fingerprint = videoMessageFingerprint(body, key, context);
  assert.equal(fingerprint.length, 32);
  assert.notDeepEqual(fingerprint, messageFingerprint(body, key, context));
  assert.deepEqual(fingerprint, videoMessageFingerprint(body, key, { ...context, messageId: randomBytes(16) }));
  for (const changed of [{ ...context, senderId: randomBytes(16) }, { ...context, conversationId: randomBytes(16) }]) {
    assert.notDeepEqual(fingerprint, videoMessageFingerprint(body, key, changed));
  }
  assert.notDeepEqual(fingerprint, videoMessageFingerprint(body.replace("Bonjour", "Bonsoir"), key, context));
  assert.throws(() => videoMessageFingerprint(body, null, context), hasCode("CHAT_CRYPTO_CONFIG"));
});

// Independently seal arbitrary bytes to exercise authenticated data that cannot
// be produced by the public plaintext validator (corruption or a legacy writer).
function sealRawBytes(bytes) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.concat([
    Buffer.from("jessiemessage:message-body:v1:", "ascii"),
    context.messageId, context.conversationId, context.senderId,
  ]));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return `v1.${nonce.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

test("message validation and encryption preserve exact Unicode, newlines, spaces and literal markup", () => {
  const bodies = [
    "a", "  Bonjour Jessie  ", "Une ligne\r\nune autre\n\tfin", "العربية 中文 🎉",
    "é", "e\u0301", "\ufeffBonjour", "texte\u200b\u200d", "<script>alert('text only')</script>",
  ];
  for (const body of bodies) {
    assert.equal(validateMessageBody(body), body);
    assert.equal(decryptMessageBody(encryptMessageBody(body, key, context), key, context), body);
  }
  assert.notEqual(messageFingerprint("é", key, context).toString("hex"), messageFingerprint("e\u0301", key, context).toString("hex"));
  assert.notEqual(messageFingerprint(" message ", key, context).toString("hex"), messageFingerprint("message", key, context).toString("hex"));
});

test("message input rejects nonstrings, empty/invisible content and malformed UTF-16 without normalization", () => {
  for (const body of [undefined, null, 1, false, {}, [], Buffer.from("text"), "", " \t\r\n ", "\u00a0\u3000", "\u200b\u200c\u200d\ufeff", "\u202e\u2066", "\ue000", "valid\ud800", "\udfffvalid"]) {
    assert.throws(() => validateMessageBody(body), hasCode("CHAT_INPUT"));
    assert.throws(() => encryptMessageBody(body, key, context), hasCode("CHAT_INPUT"));
    assert.throws(() => messageFingerprint(body, key, context), hasCode("CHAT_INPUT"));
  }
});

test("message input forbids C0, C1 and DEL controls while retaining allowed tab/LF/CR", () => {
  const forbidden = Array.from({ length: 32 }, (_, index) => index).filter((value) => ![9, 10, 13].includes(value));
  forbidden.push(...Array.from({ length: 33 }, (_, index) => index + 127));
  for (const value of forbidden) assert.throws(() => validateMessageBody(`hello${String.fromCharCode(value)}world`), hasCode("CHAT_INPUT"));
  assert.equal(validateMessageBody("hello\t\n\rworld"), "hello\t\n\rworld");
});

test("message length bounds use JavaScript characters and retain maximum multibyte text", () => {
  for (const body of ["a".repeat(4096), "界".repeat(4096), "😀".repeat(2048)]) {
    assert.equal(validateMessageBody(body), body);
    const encrypted = encryptMessageBody(body, key, context);
    assert.ok(encrypted.length <= 22000);
    assert.equal(decryptMessageBody(encrypted, key, context), body);
  }
  for (const body of ["a".repeat(4097), "界".repeat(4097), "😀".repeat(2049), "a".repeat(100000)]) {
    assert.throws(() => validateMessageBody(body), hasCode("CHAT_INPUT"));
  }
});

test("message envelopes use independent random GCM nonces and canonical versioned fields", () => {
  const body = "Synthetic message body that must remain private.";
  const encrypted = Array.from({ length: 32 }, () => encryptMessageBody(body, key, context));
  assert.equal(new Set(encrypted).size, encrypted.length);
  assert.equal(new Set(encrypted.map((value) => value.split(".")[1])).size, encrypted.length);
  for (const envelope of encrypted) {
    assert.match(envelope, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
    assert.equal(envelope.includes(body), false);
    assert.equal(Buffer.from(envelope.split(".")[1], "base64url").length, 12);
    assert.equal(Buffer.from(envelope.split(".")[3], "base64url").length, 16);
    assert.equal(decryptMessageBody(envelope, key, context), body);
  }
});

test("authentication binds the exact key, message, conversation and sender", () => {
  const encrypted = encryptMessageBody("Bound synthetic message", key, context);
  assert.throws(() => decryptMessageBody(encrypted, randomBytes(32), context), hasCode("CHAT_MESSAGE_INVALID"));
  for (const field of ["messageId", "conversationId", "senderId"]) {
    const alternate = { ...context, [field]: Buffer.from(context[field]) };
    alternate[field][0] ^= 1;
    assert.throws(() => decryptMessageBody(encrypted, key, alternate), hasCode("CHAT_MESSAGE_INVALID"));
  }
  assert.throws(() => decryptMessageBody(encrypted, key, { ...context, conversationId: context.senderId, senderId: context.conversationId }), hasCode("CHAT_MESSAGE_INVALID"));
});

test("crypto requires explicit 32-byte Buffer key and exact 16-byte Buffer identifiers", () => {
  const encrypted = encryptMessageBody("valid", key, context);
  for (const alternateKey of [undefined, null, key.toString("hex"), new Uint8Array(32), Buffer.alloc(31), Buffer.alloc(33)]) {
    assert.throws(() => encryptMessageBody("valid", alternateKey, context), hasCode("CHAT_CRYPTO_CONFIG"));
    assert.throws(() => decryptMessageBody(encrypted, alternateKey, context), hasCode("CHAT_CRYPTO_CONFIG"));
    assert.throws(() => messageFingerprint("valid", alternateKey, context), hasCode("CHAT_CRYPTO_CONFIG"));
  }
  for (const alternate of [undefined, null, [], "context", {}]) {
    assert.throws(() => encryptMessageBody("valid", key, alternate), hasCode("CHAT_CRYPTO_CONFIG"));
    assert.throws(() => decryptMessageBody(encrypted, key, alternate), hasCode("CHAT_CRYPTO_CONFIG"));
    assert.throws(() => messageFingerprint("valid", key, alternate), hasCode("CHAT_CRYPTO_CONFIG"));
  }
  for (const field of ["messageId", "conversationId", "senderId"]) {
    for (const id of [undefined, null, context[field].toString("hex"), new Uint8Array(16), Buffer.alloc(15), Buffer.alloc(17)]) {
      const alternate = { ...context, [field]: id };
      assert.throws(() => encryptMessageBody("valid", key, alternate), hasCode("CHAT_CRYPTO_CONFIG"));
      assert.throws(() => decryptMessageBody(encrypted, key, alternate), hasCode("CHAT_CRYPTO_CONFIG"));
      if (field !== "messageId") assert.throws(() => messageFingerprint("valid", key, alternate), hasCode("CHAT_CRYPTO_CONFIG"));
    }
  }
});

test("message decrypt rejects tampering of nonce, ciphertext and authentication tag", () => {
  const encrypted = encryptMessageBody("Synthetic tamper target", key, context);
  const fields = encrypted.split(".");
  for (const field of [1, 2, 3]) {
    const altered = [...fields];
    altered[field] = replaceByte(altered[field]);
    assert.throws(() => decryptMessageBody(altered.join("."), key, context), hasCode("CHAT_MESSAGE_INVALID"));
  }
});

test("message decrypt rejects unsupported versions, malformed formats and oversized ciphertext", () => {
  const encrypted = encryptMessageBody("Synthetic format target", key, context);
  const fields = encrypted.split(".");
  const invalid = [undefined, null, Buffer.from(encrypted), "", "a".repeat(22001), encrypted.replace("v1", "v2"), encrypted.replace("v1", "V1"), `${encrypted}.extra`, fields.slice(1).join("."), fields.slice(0, 3).join(".")];
  for (const field of [1, 2, 3]) {
    for (const value of ["", `${fields[field]}=`, ` ${fields[field]}`, fields[field].replace(/[A-Za-z0-9_-]/, "+"), fields[field].slice(1)]) {
      const altered = [...fields];
      altered[field] = value;
      invalid.push(altered.join("."));
    }
  }
  invalid.push([fields[0], Buffer.alloc(11).toString("base64url"), fields[2], fields[3]].join("."));
  invalid.push([fields[0], Buffer.alloc(13).toString("base64url"), fields[2], fields[3]].join("."));
  invalid.push([fields[0], fields[1], fields[2], Buffer.alloc(15).toString("base64url")].join("."));
  invalid.push([fields[0], fields[1], fields[2], Buffer.alloc(17).toString("base64url")].join("."));
  // A bounded envelope can still hold a body that exceeds the byte policy.
  invalid.push([fields[0], fields[1], Buffer.alloc(16385).toString("base64url"), fields[3]].join("."));
  for (const value of invalid) assert.throws(() => decryptMessageBody(value, key, context), hasCode("CHAT_MESSAGE_INVALID"));
});

test("message decrypt rejects base64url aliases with non-zero trailing bits even when they decode identically", () => {
  const encrypted = encryptMessageBody("a", key, context);
  const fields = encrypted.split(".");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (const field of [2, 3]) {
    const last = fields[field].at(-1);
    const alias = `${fields[field].slice(0, -1)}${alphabet[alphabet.indexOf(last) + 1]}`;
    assert.deepEqual(Buffer.from(alias, "base64url"), Buffer.from(fields[field], "base64url"));
    const altered = [...fields];
    altered[field] = alias;
    assert.throws(() => decryptMessageBody(altered.join("."), key, context), hasCode("CHAT_MESSAGE_INVALID"));
  }
});

test("authenticated malformed UTF-8 is rejected instead of silently replacing bytes", () => {
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from([0xf0, 0x80, 0x80, 0x80]), Buffer.from([0xe2, 0x82]), Buffer.from([0xff])]) {
    assert.throws(() => decryptMessageBody(sealRawBytes(bytes), key, context), hasCode("CHAT_MESSAGE_INVALID"));
  }
});

test("authenticated invalid message bodies are rejected after decryption", () => {
  for (const body of ["", "   ", "\u200b\u200d", "hello\u0000world", "a".repeat(4097)]) {
    assert.throws(() => decryptMessageBody(sealRawBytes(Buffer.from(body, "utf8")), key, context), hasCode("CHAT_MESSAGE_INVALID"));
  }
});

test("fingerprints are deterministic keyed digests scoped to conversation and sender without message ID", () => {
  const body = "Private retry payload";
  const fingerprint = messageFingerprint(body, key, context);
  assert.ok(Buffer.isBuffer(fingerprint));
  assert.equal(fingerprint.length, 32);
  assert.deepEqual(fingerprint, messageFingerprint(body, key, { ...context, messageId: randomBytes(16) }));
  assert.deepEqual(fingerprint, messageFingerprint(body, key, { conversationId: context.conversationId, senderId: context.senderId }));
  assert.notDeepEqual(fingerprint, createHash("sha256").update(body, "utf8").digest());
  assert.deepEqual(fingerprint, createHmac("sha256", key)
    .update("jessiemessage:message-fingerprint:v1:", "ascii")
    .update(context.conversationId).update(context.senderId).update(body, "utf8").digest());
  assert.notDeepEqual(fingerprint, messageFingerprint(body, randomBytes(32), context));
  assert.notDeepEqual(fingerprint, messageFingerprint(`${body}!`, key, context));
  for (const field of ["conversationId", "senderId"]) {
    assert.notDeepEqual(fingerprint, messageFingerprint(body, key, { ...context, [field]: randomBytes(16) }));
  }
});

test("sanitized crypto errors never expose message, envelope, key or underlying failure", () => {
  const body = "Synthetic private message marker";
  const encrypted = encryptMessageBody(body, key, context);
  const invalidBody = `${body}\u0000`;
  const attempts = [
    () => validateMessageBody(invalidBody),
    () => encryptMessageBody(body, key.toString("hex"), context),
    () => decryptMessageBody(encrypted, randomBytes(32), context),
    () => decryptMessageBody(body, key, context),
    () => messageFingerprint(invalidBody, key, context),
  ];
  for (const attempt of attempts) {
    assert.throws(attempt, (error) => {
      assert.ok(error instanceof ChatCryptoError);
      for (const sensitive of [body, invalidBody, encrypted, key.toString("hex"), key.toString("base64url")]) {
        assert.equal(error.message.includes(sensitive), false);
      }
      assert.equal(error.cause, undefined);
      assert.deepEqual(Object.keys(error).sort(), ["code", "name"]);
      return true;
    });
  }
});
