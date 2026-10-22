import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { createPrivateJsonStore } from "../files/private-json.mjs";
import { fields, failQuickReplies, QuickRepliesError, ownerId, revision, validateReplies, MAX_QUICK_REPLIES_BYTES, MAX_QUICK_REPLIES_VERSION } from "./validation.mjs";

export const QUICK_REPLIES_FILENAME_PATTERN = /^quick-replies-([a-f0-9]{32})\.json$/;
export const QUICK_REPLIES_LOCK_PATTERN = /^quick-replies-([a-f0-9]{32})\.lock$/;
export const QUICK_REPLIES_TEMPORARY_PATTERN = /^\.quick-replies-([a-f0-9]{32})\.json\.[a-f0-9]{32}\.tmp$/;
export const QUICK_REPLIES_FILE_MAX_BYTES = 65536;
const namespace = "jessiemessage:quick-replies:v1";
const emptyState = Object.freeze({ version: 1, revision: 0, envelope: null });
function encoded(value, length, maximum = length) {
  if (typeof value !== "string" || value.length > 45000 || !/^[A-Za-z0-9_-]+$/.test(value)) failQuickReplies();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < length || bytes.length > maximum || bytes.toString("base64url") !== value) failQuickReplies();
  return bytes;
}
function stateValue(value) {
  try {
    fields(value, ["version", "revision", "envelope"]); revision(value.revision);
    if (value.version !== 1) failQuickReplies();
    // Only the missing-file sentinel can have revision zero and no ciphertext.
    // A persisted catalogue, including an empty one, never resets its revision.
    if (value.envelope === null) {
      if (value !== emptyState) failQuickReplies();
      return { version: 1, revision: 0, envelope: null };
    }
    fields(value.envelope, ["iv", "ciphertext", "tag"]);
    encoded(value.envelope.iv, 12); encoded(value.envelope.ciphertext, 1, MAX_QUICK_REPLIES_BYTES); encoded(value.envelope.tag, 16);
    return { version: 1, revision: value.revision, envelope: { iv: value.envelope.iv, ciphertext: value.envelope.ciphertext, tag: value.envelope.tag } };
  } catch { failQuickReplies(); }
}
function deriveKey(key, owner) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new TypeError("A private application key is required.");
  return Buffer.from(hkdfSync("sha256", key, Buffer.from(ownerId(owner), "hex"), Buffer.from(namespace), 32));
}
const associated = (owner, value) => Buffer.from(`${namespace}:${owner}:${revision(value)}`);
function opened(state, key, owner) {
  if (state.envelope === null) return { revision: 0, ownerId: owner, replies: [] };
  let plaintext, tail;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, encoded(state.envelope.iv, 12));
    decipher.setAAD(associated(owner, state.revision)); decipher.setAuthTag(encoded(state.envelope.tag, 16));
    plaintext = decipher.update(encoded(state.envelope.ciphertext, 1, MAX_QUICK_REPLIES_BYTES)); tail = decipher.final();
    if (tail.length) failQuickReplies();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext), replies = validateReplies(JSON.parse(text));
    if (JSON.stringify(replies) !== text) failQuickReplies();
    return { revision: state.revision, ownerId: owner, replies };
  } catch { failQuickReplies(); }
  finally { plaintext?.fill(0); tail?.fill(0); }
}
export function verifyQuickRepliesEnvelope(content, key, filename) {
  const match = typeof filename === "string" && QUICK_REPLIES_FILENAME_PATTERN.exec(filename);
  if (!match || !Buffer.isBuffer(content) || content.length > QUICK_REPLIES_FILE_MAX_BYTES || !Buffer.isBuffer(key) || key.length !== 32) failQuickReplies();
  const derived = deriveKey(key, match[1]);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content), state = stateValue(JSON.parse(text));
    if (`${JSON.stringify(state)}\n` !== text || state.revision < 1) failQuickReplies();
    return opened(state, derived, match[1]);
  } catch { failQuickReplies(); }
  finally { derived.fill(0); }
}
export function createQuickRepliesFiles(directory, sourceKey, owner, internal = {}) {
  ownerId(owner);
  const key = deriveKey(sourceKey, owner), store = createPrivateJsonStore({ name: `quick-replies-${owner}.json`, lock: `quick-replies-${owner}.lock`, maxBytes: QUICK_REPLIES_FILE_MAX_BYTES,
    validate: stateValue, empty: () => emptyState,
    fail: code => failQuickReplies(({ changed: "QUICK_REPLIES_CONFLICT", busy: "QUICK_REPLIES_BUSY" })[code]),
    isKnownError: error => error instanceof QuickRepliesError || Number.isInteger(error?.httpStatus) || ["CHAT_UNAUTHORIZED", "CHAT_FORBIDDEN", "AUTH_INVALID"].includes(error?.code) });
  let closed = false;
  const available = () => { if (closed) failQuickReplies(); };
  async function read() { available(); const value = await store.read(directory, internal); available(); const result = opened(value, key, owner); available(); return result; }
  return Object.freeze({
    read,
    async save(value, expectedRevision, authorize) {
      available(); const replies = validateReplies(value); revision(expectedRevision);
      if (expectedRevision === MAX_QUICK_REPLIES_VERSION) failQuickReplies("QUICK_REPLIES_CONFLICT");
      if (typeof authorize !== "function") failQuickReplies("QUICK_REPLIES_INPUT");
      const exactReplay = async current => {
        if (current.revision !== expectedRevision + 1 || JSON.stringify(current.replies) !== JSON.stringify(replies)) return null;
        await authorize(); available(); return current;
      };
      const current = await read();
      const replay = await exactReplay(current); if (replay) return replay;
      if (current.revision !== expectedRevision) failQuickReplies("QUICK_REPLIES_CONFLICT");
      const plaintext = Buffer.from(JSON.stringify(replies), "utf8");
      try {
        const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(associated(owner, expectedRevision + 1));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const state = { version: 1, revision: expectedRevision, envelope: { iv: iv.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") } };
        let saved;
        try {
          saved = await store.save(directory, state, expectedRevision, { ...internal, async beforeCommit(previous) { available(); opened(previous, key, owner); await authorize(); available(); } });
        } catch (error) {
          if (error?.code === "QUICK_REPLIES_CONFLICT") { const duplicate = await exactReplay(await read()); if (duplicate) return duplicate; }
          throw error;
        }
        available(); return opened(saved, key, owner);
      } finally { plaintext.fill(0); }
    },
    close() { closed = true; key.fill(0); },
  });
}
