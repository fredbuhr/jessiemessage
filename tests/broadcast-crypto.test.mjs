import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { BroadcastCryptoError, sealPayload, openPayload, campaignFingerprint } from "../server/broadcast/crypto.mjs";
import { BroadcastInputError } from "../server/broadcast/validation.mjs";
import { decryptMessageBody } from "../server/chat/crypto.mjs";

const key = randomBytes(32), binding = { adminId: randomBytes(16), campaignId: randomBytes(16) };
const first = "1".repeat(32), last = "f".repeat(32);
const payload = (changes = {}) => ({ title: "Un moment privé", body: "Bonjour !", mediaId: null,
  allowRepeatMedia: false, conversationIds: [first, last], ...changes });
const invalid = (error) => error instanceof BroadcastCryptoError && error.code === "BROADCAST_CRYPTO";

function sealRaw(bytes) {
  const purposeKey = createHmac("sha256", key).update("jessiemessage:broadcast-payload-key:v1:", "ascii").digest();
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", purposeKey, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.concat([Buffer.from("jessiemessage:broadcast-payload:v1:", "ascii"), binding.adminId, binding.campaignId]));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  purposeKey.fill(0);
  return `v1.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

test("broadcast encryption preserves exact text and canonicalizes the complete immutable audience", () => {
  for (const body of ["  Bonjour  ", "Une ligne\r\n\tfin", "é", "e\u0301", "\ufeffDébut", "العربية 中文 🎉", "<script>texte</script>"]) {
    const value = payload({ body });
    assert.deepEqual(openPayload(sealPayload(value, key, binding), key, binding), value);
  }
  const value = payload({ conversationIds: [last, first] }), original = structuredClone(value);
  assert.deepEqual(openPayload(sealPayload(value, key, binding), key, binding), payload());
  assert.deepEqual(value, original);
  assert.deepEqual(openPayload(sealPayload(payload({ mediaId: first, body: "" }), key, binding), key, binding), payload({ mediaId: first, body: "" }));
});

test("broadcast maximum body, title and 100 recipients fit the immutable SQL envelope bound", () => {
  const conversationIds = Array.from({ length: 100 }, (_, i) => i.toString(16).padStart(32, "0"));
  for (const body of ["界".repeat(4096), "😀".repeat(2048), "\"".repeat(4096), "\n".repeat(4095) + "x"]) {
    const value = payload({ title: "界".repeat(80), body, conversationIds });
    const encrypted = sealPayload(value, key, binding);
    assert.ok(encrypted.length <= 32000);
    assert.deepEqual(openPayload(encrypted, key, binding), value);
  }
});

test("broadcast payload nonces are independent and envelopes are versioned canonical base64url", () => {
  const value = payload(), encrypted = Array.from({ length: 32 }, () => sealPayload(value, key, binding));
  assert.equal(new Set(encrypted).size, encrypted.length);
  assert.equal(new Set(encrypted.map((text) => text.split(".")[1])).size, encrypted.length);
  for (const text of encrypted) {
    assert.match(text, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/u);
    assert.equal(text.includes(value.body), false);
    assert.deepEqual(openPayload(text, key, binding), value);
  }
});

test("broadcast authenticated encryption binds the administrator and campaign with purpose separation from chat", () => {
  const encrypted = sealPayload(payload(), key, binding);
  assert.throws(() => openPayload(encrypted, randomBytes(32), binding), invalid);
  for (const field of ["adminId", "campaignId"]) {
    assert.throws(() => openPayload(encrypted, key, { ...binding, [field]: randomBytes(16) }), invalid);
  }
  assert.throws(() => openPayload(encrypted, key, { adminId: binding.campaignId, campaignId: binding.adminId }), invalid);
  assert.throws(() => decryptMessageBody(encrypted, key, { messageId: binding.campaignId, conversationId: binding.adminId, senderId: binding.adminId }), { code: "CHAT_MESSAGE_INVALID" });
});

test("broadcast crypto rejects invalid fixed byte keys and bindings with one neutral code", () => {
  for (const badKey of [undefined, null, key.toString("hex"), new Uint8Array(32), Buffer.alloc(31), Buffer.alloc(33)]) {
    assert.throws(() => sealPayload(payload(), badKey, binding), invalid);
    assert.throws(() => openPayload(null, badKey, binding), invalid);
    assert.throws(() => campaignFingerprint(payload(), badKey, binding), invalid);
  }
  for (const badBinding of [undefined, null, [], "context", {}]) {
    assert.throws(() => sealPayload(payload(), key, badBinding), invalid);
    assert.throws(() => openPayload(null, key, badBinding), invalid);
    assert.throws(() => campaignFingerprint(payload(), key, badBinding), invalid);
  }
  for (const field of ["adminId", "campaignId"]) {
    for (const value of [undefined, null, binding[field].toString("hex"), new Uint8Array(16), Buffer.alloc(15), Buffer.alloc(17)]) {
      assert.throws(() => sealPayload(payload(), key, { ...binding, [field]: value }), invalid);
      assert.throws(() => openPayload(null, key, { ...binding, [field]: value }), invalid);
      if (field === "adminId") assert.throws(() => campaignFingerprint(payload(), key, { ...binding, [field]: value }), invalid);
    }
  }
});

test("broadcast fingerprint survives retries with regenerated internal IDs and unordered selection", () => {
  const value = payload(), digest = campaignFingerprint(value, key, binding);
  assert.ok(Buffer.isBuffer(digest)); assert.equal(digest.length, 32);
  assert.deepEqual(digest, campaignFingerprint(value, key, { ...binding, campaignId: randomBytes(16) }));
  assert.deepEqual(digest, campaignFingerprint(value, key, { adminId: binding.adminId }));
  assert.deepEqual(digest, campaignFingerprint(payload({ conversationIds: [last, first] }), key, binding));
  assert.notDeepEqual(digest, campaignFingerprint(value, randomBytes(32), binding));
  assert.notDeepEqual(digest, campaignFingerprint(value, key, { adminId: randomBytes(16) }));
  for (const changes of [{ title: "Autre titre" }, { body: "Autre message" }, { mediaId: first }, { allowRepeatMedia: true }, { conversationIds: [first] }]) {
    assert.notDeepEqual(digest, campaignFingerprint(payload(changes), key, binding));
  }
  const canonical = JSON.stringify(value);
  assert.deepEqual(digest, createHmac("sha256", key).update("jessiemessage:broadcast-fingerprint:v1:", "ascii").update(binding.adminId).update(canonical, "utf8").digest());
  assert.notDeepEqual(campaignFingerprint(payload({ body: "é" }), key, binding), campaignFingerprint(payload({ body: "e\u0301" }), key, binding));
});

test("broadcast encryption and fingerprints validate caller payload before cryptographic processing", () => {
  for (const value of [null, undefined, {}, payload({ body: "" }), payload({ mediaId: first, body: "x".repeat(1001) }), payload({ conversationIds: [first, first] }), { ...payload(), extra: true }]) {
    for (const action of [sealPayload, campaignFingerprint]) {
      assert.throws(() => action(value, key, binding), (error) => error instanceof BroadcastInputError && error.code === "BROADCAST_INPUT");
    }
  }
});

test("broadcast decrypt rejects field tampering, malformed formats, oversized ciphertext and noncanonical encodings", () => {
  const encrypted = sealPayload(payload(), key, binding), fields = encrypted.split(".");
  const bad = [undefined, null, {}, Buffer.from(encrypted), "", "a".repeat(32001), encrypted.replace("v1", "v2"), `${encrypted}.extra`];
  for (const field of [1, 2, 3]) {
    const bytes = Buffer.from(fields[field], "base64url"); bytes[0] ^= 1;
    for (const value of ["", bytes.toString("base64url"), `${fields[field]}=`, ` ${fields[field]}`, `${fields[field]}\n`, fields[field].slice(1)]) {
      const changed = [...fields]; changed[field] = value; bad.push(changed.join("."));
    }
  }
  bad.push([fields[0], Buffer.alloc(11).toString("base64url"), fields[2], fields[3]].join("."));
  bad.push([fields[0], fields[1], fields[2], Buffer.alloc(15).toString("base64url")].join("."));
  bad.push([fields[0], fields[1], Buffer.alloc(23968).toString("base64url"), fields[3]].join("."));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", alias = [...fields];
  alias[3] = fields[3].slice(0, -1) + alphabet[alphabet.indexOf(fields[3].at(-1)) + 1];
  assert.deepEqual(Buffer.from(alias[3], "base64url"), Buffer.from(fields[3], "base64url"));
  bad.push(alias.join("."));
  for (const value of bad) assert.throws(() => openPayload(value, key, binding), invalid);
});

test("broadcast decrypt rejects authenticated malformed UTF-8 and invalid or ambiguous JSON payloads", () => {
  const value = payload();
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from([0xff]), Buffer.alloc(0),
    Buffer.from("null"), Buffer.from("[]"), Buffer.from("{}"), Buffer.from(JSON.stringify({ ...value, body: "x\u0000" })),
    Buffer.from(JSON.stringify({ ...value, extra: true })), Buffer.from(JSON.stringify({ ...value, conversationIds: [last, first] })),
    Buffer.from(` ${JSON.stringify(value)}`), Buffer.from(`{"title":"unused",${JSON.stringify(value).slice(1)}`), Buffer.from("not json")]) {
    assert.throws(() => openPayload(sealRaw(bytes), key, binding), invalid);
  }
});

test("broadcast cryptographic errors disclose no plaintext, key, envelope or underlying cause", () => {
  const value = payload({ body: "Synthetic private broadcast marker" }), encrypted = sealPayload(value, key, binding);
  for (const action of [() => openPayload(encrypted, randomBytes(32), binding), () => openPayload(value.body, key, binding), () => sealPayload(value, key.toString("hex"), binding)]) {
    assert.throws(action, (error) => {
      assert.ok(invalid(error));
      for (const secret of [value.body, encrypted, key.toString("hex"), key.toString("base64url")]) assert.equal(error.message.includes(secret), false);
      assert.equal(error.cause, undefined);
      assert.deepEqual(Object.keys(error).sort(), ["code", "name"]);
      return true;
    });
  }
});
