import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { CrmCryptoError, sealNotes, openNotes } from "../server/crm/crypto.mjs";
import { CrmInputError } from "../server/crm/validation.mjs";

const key = randomBytes(32);
const context = Object.freeze({ adminId: randomBytes(16), conversationId: randomBytes(16), version: "1" });
const hasCode = (code) => (error) => error instanceof CrmCryptoError && error.code === code;

function sealRawBytes(bytes) {
  const revision = Buffer.alloc(4);
  revision.writeUInt32BE(Number(context.version));
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.concat([Buffer.from("jessiemessage:crm-notes:v1:", "ascii"), context.adminId, context.conversationId, revision]));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return `v1.${nonce.toString("base64url")}.${ciphertext.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

test("CRM note encryption preserves exact text, whitespace, composition, BOM and literal markup", () => {
  for (const notes of ["a", "  Notes privées  ", " \t\r\n ", "é", "e\u0301", "\ufeffDébut", "\u200b\u200d", "العربية 中文 🎉", "<script>alert('literal')</script>"]) {
    assert.equal(openNotes(sealNotes(notes, key, context), key, context), notes);
  }
});

test("CRM empty notes use null storage but still require a valid key and positive notes revision", () => {
  assert.equal(sealNotes("", key, context), null);
  assert.equal(openNotes(null, key, context), "");
  assert.throws(() => sealNotes("", Buffer.alloc(31), context), hasCode("CRM_CRYPTO_CONFIG"));
  assert.throws(() => openNotes(null, Buffer.alloc(31), context), hasCode("CRM_CRYPTO_CONFIG"));
  assert.throws(() => openNotes(null, key, { ...context, version: "0" }), hasCode("CRM_CRYPTO_CONFIG"));
  assert.throws(() => sealNotes("", key, { ...context, version: "0" }), hasCode("CRM_CRYPTO_CONFIG"));
});

test("CRM note encryption preserves maximum valid multibyte text within the schema envelope limit", () => {
  for (const notes of ["a".repeat(8000), "界".repeat(8000), "😀".repeat(4000)]) {
    const sealed = sealNotes(notes, key, context);
    assert.ok(sealed.length <= 44000);
    assert.equal(openNotes(sealed, key, context), notes);
  }
  for (const notes of [null, undefined, {}, "a".repeat(8001), "x\ud800", "x\u0000"]) assert.throws(() => sealNotes(notes, key, context), (error) => error instanceof CrmInputError && error.code === "CRM_INPUT");
});

test("CRM notes use independently randomized canonical AES-GCM envelopes", () => {
  const notes = "Synthetic private notes marker";
  const sealed = Array.from({ length: 32 }, () => sealNotes(notes, key, context));
  assert.equal(new Set(sealed).size, sealed.length);
  assert.equal(new Set(sealed.map((value) => value.split(".")[1])).size, sealed.length);
  for (const value of sealed) {
    assert.match(value, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/u);
    assert.equal(value.includes(notes), false);
    assert.equal(openNotes(value, key, context), notes);
  }
});

test("CRM authentication binds the key, administrator, conversation and exact notes revision", () => {
  const sealed = sealNotes("Bound notes", key, context);
  assert.throws(() => openNotes(sealed, randomBytes(32), context), hasCode("CRM_NOTES_INVALID"));
  for (const field of ["adminId", "conversationId"]) assert.throws(() => openNotes(sealed, key, { ...context, [field]: randomBytes(16) }), hasCode("CRM_NOTES_INVALID"));
  for (const version of ["2", "256", "4294967295"]) assert.throws(() => openNotes(sealed, key, { ...context, version }), hasCode("CRM_NOTES_INVALID"));
  assert.throws(() => openNotes(sealed, key, { ...context, adminId: context.conversationId, conversationId: context.adminId }), hasCode("CRM_NOTES_INVALID"));
  const highRevision = { ...context, version: "4294967295" };
  assert.equal(openNotes(sealNotes("Highest revision", key, highRevision), key, highRevision), "Highest revision");
});

test("CRM ciphertext remains decryptable when only the independent optimistic profile version changes", () => {
  const sealed = sealNotes("Notes survive a label deletion", key, { ...context, version: "7" });
  const rawProfile = { version: "8", notesRevision: "7", notesEncrypted: sealed };
  assert.equal(openNotes(rawProfile.notesEncrypted, key, { ...context, version: rawProfile.notesRevision }), "Notes survive a label deletion");
  assert.throws(() => openNotes(rawProfile.notesEncrypted, key, { ...context, version: rawProfile.version }), hasCode("CRM_NOTES_INVALID"));
});

test("CRM crypto configuration accepts only explicit fixed Buffer keys/IDs and positive canonical uint32 strings", () => {
  for (const alternateKey of [undefined, null, key.toString("base64url"), new Uint8Array(32), Buffer.alloc(31), Buffer.alloc(33)]) {
    assert.throws(() => sealNotes("valid", alternateKey, context), hasCode("CRM_CRYPTO_CONFIG"));
    assert.throws(() => openNotes(null, alternateKey, context), hasCode("CRM_CRYPTO_CONFIG"));
  }
  for (const alternate of [undefined, null, "context", [], {}]) {
    assert.throws(() => sealNotes("valid", key, alternate), hasCode("CRM_CRYPTO_CONFIG"));
    assert.throws(() => openNotes(null, key, alternate), hasCode("CRM_CRYPTO_CONFIG"));
  }
  for (const field of ["adminId", "conversationId"]) {
    for (const alternate of [undefined, null, new Uint8Array(16), Buffer.alloc(15), Buffer.alloc(17), context[field].toString("hex")]) {
      const changed = { ...context, [field]: alternate };
      assert.throws(() => sealNotes("valid", key, changed), hasCode("CRM_CRYPTO_CONFIG"));
      assert.throws(() => openNotes(null, key, changed), hasCode("CRM_CRYPTO_CONFIG"));
    }
  }
  for (const version of [undefined, null, 1, 1n, "", "0", "01", "+1", "1.0", "1\n", "4294967296"]) {
    assert.throws(() => sealNotes("valid", key, { ...context, version }), hasCode("CRM_CRYPTO_CONFIG"));
    assert.throws(() => openNotes(null, key, { ...context, version }), hasCode("CRM_CRYPTO_CONFIG"));
  }
});

test("CRM decrypt rejects nonce, ciphertext and tag tampering with a sanitized error", () => {
  const sealed = sealNotes("Synthetic tamper target", key, context);
  const fields = sealed.split(".");
  for (const field of [1, 2, 3]) {
    const changed = [...fields];
    const bytes = Buffer.from(fields[field], "base64url");
    bytes[0] ^= 1;
    changed[field] = bytes.toString("base64url");
    assert.throws(() => openNotes(changed.join("."), key, context), hasCode("CRM_NOTES_INVALID"));
  }
});

test("CRM decrypt rejects malformed envelopes, unsupported versions and noncanonical encodings", () => {
  const sealed = sealNotes("a", key, context);
  const fields = sealed.split(".");
  const values = [undefined, {}, Buffer.from(sealed), "", "x".repeat(44001), sealed.replace("v1", "v2"), `${sealed}.extra`, fields.slice(1).join(".")];
  for (const field of [1, 2, 3]) {
    for (const value of ["", `${fields[field]}=`, `${fields[field]}\n`, ` ${fields[field]}`, fields[field].slice(1)]) {
      const changed = [...fields];
      changed[field] = value;
      values.push(changed.join("."));
    }
  }
  values.push([fields[0], Buffer.alloc(11).toString("base64url"), fields[2], fields[3]].join("."));
  values.push([fields[0], fields[1], fields[2], Buffer.alloc(15).toString("base64url")].join("."));
  values.push([fields[0], fields[1], Buffer.alloc(32769).toString("base64url"), fields[3]].join("."));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (const field of [2, 3]) {
    const changed = [...fields];
    const alias = fields[field].slice(0, -1) + alphabet[alphabet.indexOf(fields[field].at(-1)) + 1];
    assert.deepEqual(Buffer.from(alias, "base64url"), Buffer.from(fields[field], "base64url"));
    changed[field] = alias;
    values.push(changed.join("."));
  }
  for (const value of values) assert.throws(() => openNotes(value, key, context), hasCode("CRM_NOTES_INVALID"));
});

test("CRM decrypt rejects authenticated malformed UTF-8, forbidden note controls and oversized text", () => {
  for (const bytes of [Buffer.from([0xc3, 0x28]), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from([0xff]), Buffer.from("x\u0000"), Buffer.from("x\u0080"), Buffer.from("x".repeat(8001)), Buffer.alloc(0)]) {
    assert.throws(() => openNotes(sealRawBytes(bytes), key, context), hasCode("CRM_NOTES_INVALID"));
  }
});

test("CRM crypto errors expose neither note content, key, ciphertext nor underlying causes", () => {
  const notes = "Synthetic private marker";
  const sealed = sealNotes(notes, key, context);
  for (const attempt of [() => openNotes(sealed, randomBytes(32), context), () => openNotes(notes, key, context), () => openNotes(null, key.toString("hex"), context)]) {
    assert.throws(attempt, (error) => {
      assert.ok(error instanceof CrmCryptoError);
      for (const secret of [notes, sealed, key.toString("hex"), key.toString("base64url")]) assert.equal(error.message.includes(secret), false);
      assert.equal(error.cause, undefined);
      assert.deepEqual(Object.keys(error).sort(), ["code", "name"]);
      return true;
    });
  }
});
