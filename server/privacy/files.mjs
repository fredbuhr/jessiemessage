import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { createPrivateJsonStore } from "../files/private-json.mjs";
import { fields, failPrivacy, PrivacyError, validatePrepared, MAX_DRAFT_BYTES } from "./draft.mjs";

const namespace = "jessiemessage:privacy-preparation:https://jessiemessage.com:v1";
function revision(value) { if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) failPrivacy("input"); return value; }
function encoded(value, bytes, maximum = bytes) {
  if (typeof value !== "string" || value.length > 61000 || !/^[A-Za-z0-9_-]+$/.test(value)) failPrivacy("input");
  const buffer = Buffer.from(value, "base64url");
  if (buffer.length < bytes || buffer.length > maximum || buffer.toString("base64url") !== value) failPrivacy("input");
  return buffer;
}
function validate(value) {
  fields(value, ["version", "revision", "envelope"]);
  if (value.version !== 1 || value.envelope === null && value.revision !== 0) failPrivacy("input");
  const result = { version: 1, revision: revision(value.revision), envelope: null };
  if (value.envelope !== null) {
    fields(value.envelope, ["iv", "ciphertext", "tag"]);
    encoded(value.envelope.iv, 12); encoded(value.envelope.ciphertext, 1, MAX_DRAFT_BYTES + 128); encoded(value.envelope.tag, 16);
    result.envelope = { iv: value.envelope.iv, ciphertext: value.envelope.ciphertext, tag: value.envelope.tag };
  }
  return result;
}
const store = createPrivateJsonStore({ name: "privacy-preparation.json", lock: "privacy-preparation.lock", maxBytes: 65536,
  validate, empty: () => ({ version: 1, revision: 0, envelope: null }), fail: failPrivacy, isKnownError: error => error instanceof PrivacyError || Number.isInteger(error?.httpStatus) });

export function createPrivacyFiles(directory, sourceKey, internal = {}) {
  if (!Buffer.isBuffer(sourceKey) || sourceKey.length !== 32) throw new TypeError("A private application key is required.");
  const key = Buffer.from(hkdfSync("sha256", sourceKey, Buffer.alloc(0), Buffer.from(namespace), 32));
  let closed = false;
  const available = () => { if (closed) failPrivacy(); };
  const aad = value => Buffer.from(`${namespace}:${revision(value)}`);
  function opened(state) {
      if (state.envelope === null) return { revision: 0, prepared: null };
      let plaintext, tail;
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, encoded(state.envelope.iv, 12));
        decipher.setAAD(aad(state.revision)); decipher.setAuthTag(encoded(state.envelope.tag, 16));
        plaintext = decipher.update(encoded(state.envelope.ciphertext, 1, MAX_DRAFT_BYTES + 128)); tail = decipher.final();
        if (tail.length) failPrivacy();
        const value = validatePrepared(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)));
        available(); return { revision: state.revision, prepared: value };
      } catch { failPrivacy(); }
      finally { plaintext?.fill(0); tail?.fill(0); }
  }
  return Object.freeze({
    async read() {
      available(); const state = await store.read(directory, internal); available(); return opened(state);
    },
    async save(prepared, expectedRevision, authorize) {
      available(); revision(expectedRevision);
      if (typeof authorize !== "function") failPrivacy("input");
      const plaintext = Buffer.from(JSON.stringify(validatePrepared(prepared)));
      try {
        const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(aad(expectedRevision + 1));
        const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const state = { version: 1, revision: expectedRevision, envelope: { iv: iv.toString("base64url"), ciphertext: encrypted.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") } };
        const saved = await store.save(directory, state, expectedRevision, { ...internal, async beforeCommit(previous) { available(); opened(previous); await authorize(); available(); } });
        available(); return saved.revision;
      } finally { plaintext.fill(0); }
    },
    close() { closed = true; key.fill(0); },
  });
}
