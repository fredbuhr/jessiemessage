import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { opendir } from "node:fs/promises";
import { createPrivateJsonStore } from "../files/private-json.mjs";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { AccountErasureError, erasureBinding, erasureFields, erasureId, erasureRecord, erasureTransition, failErasure } from "./erasure-state.mjs";

const namespace = "jessiemessage:account-erasure:https://jessiemessage.com:v1";
const journalName = (binding, clientId) => `erasure-${createHash("sha256").update(`${namespace}:${JSON.stringify(binding)}:${clientId}`).digest("hex")}`;
const revision = value => {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) failErasure("ERASURE_INPUT"); return value;
};
function encoded(value, min, max = min) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value) || value.length > 3000) failErasure();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < min || bytes.length > max || bytes.toString("base64url") !== value) failErasure();
  return bytes;
}
function validate(value) {
  erasureFields(value, ["version", "revision", "envelope"]); revision(value.revision);
  if (value.version !== 1 || value.envelope === null && value.revision !== 0) failErasure();
  if (value.envelope !== null) {
    erasureFields(value.envelope, ["iv", "ciphertext", "tag"]);
    encoded(value.envelope.iv, 12); encoded(value.envelope.ciphertext, 1, 2048); encoded(value.envelope.tag, 16);
  }
  return { version: 1, revision: value.revision, envelope: value.envelope === null ? null
    : { iv: value.envelope.iv, ciphertext: value.envelope.ciphertext, tag: value.envelope.tag } };
}

/** Outside the SQL/media backup: a minimal encrypted intent and completion receipt.
 * Key-independent opaque names ensure a wrong key cannot hide an existing job. */
export function createErasureJournal({ directory, key: sourceKey, binding, clientId }, internal = {}) {
  erasureId(clientId); binding = erasureBinding(binding);
  return journalFile({ directory, sourceKey, binding, clientId, name: journalName(binding, clientId) }, internal);
}
function journalFile({ directory, sourceKey, binding, clientId, name }, internal) {
  if (!Buffer.isBuffer(sourceKey) || sourceKey.length !== 32) failErasure("ERASURE_INPUT");
  const context = `${namespace}:${JSON.stringify(binding)}:${name}`;
  const key = Buffer.from(hkdfSync("sha256", sourceKey, Buffer.alloc(0), Buffer.from(namespace), 32));
  let closed = false;
  const available = () => { if (closed) failErasure(); };
  const check = value => {
    const record = erasureRecord(value);
    if (clientId !== null && record.clientId !== clientId || journalName(binding, record.clientId) !== name
      || JSON.stringify(record.binding) !== JSON.stringify(binding)) failErasure("ERASURE_CHANGED");
    return record;
  };
  const store = createPrivateJsonStore({ name: `${name}.json`, lock: `${name}.lock`, maxBytes: 4096, validate,
    empty: () => ({ version: 1, revision: 0, envelope: null }),
    fail: code => failErasure(({ input: "ERASURE_INPUT", changed: "ERASURE_CHANGED", busy: "ERASURE_BUSY" })[code]),
    isKnownError: error => error instanceof AccountErasureError });
  function opened(state) {
    if (state.envelope === null) return { revision: 0, record: null };
    let bytes, tail;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, encoded(state.envelope.iv, 12));
      decipher.setAAD(Buffer.from(`${context}:${state.revision}`)); decipher.setAuthTag(encoded(state.envelope.tag, 16));
      bytes = decipher.update(encoded(state.envelope.ciphertext, 1, 2048)); tail = decipher.final();
      if (tail.length) failErasure();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), record = check(JSON.parse(text));
      if (JSON.stringify(record) !== text) failErasure();
      available(); return { revision: state.revision, record };
    } catch { failErasure(); }
    finally { bytes?.fill(0); tail?.fill(0); }
  }
  return Object.freeze({
    async read() { available(); const state = await store.read(directory, internal); available(); return opened(state); },
    async save(value, expectedRevision, authorize) {
      available(); revision(expectedRevision); const record = check(value);
      if (typeof authorize !== "function") failErasure("ERASURE_INPUT");
      const bytes = Buffer.from(JSON.stringify(record));
      try {
        const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(Buffer.from(`${context}:${expectedRevision + 1}`));
        const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
        const saved = await store.save(directory, { version: 1, revision: expectedRevision,
          envelope: { iv: iv.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") } }, expectedRevision,
        { ...internal, async beforeCommit(previous) {
          available(); erasureTransition(opened(previous).record, record); await authorize(); available();
        } });
        available(); return { revision: saved.revision, record: check(record) };
      } finally { bytes.fill(0); }
    },
    close() { closed = true; key.fill(0); },
  });
}

/** Read-only recovery discovery, including a job whose SQL account is already
 * gone. No plaintext identity index or remembered browser ID is required. */
export async function readErasureJournalBatch({ directory, key, binding, afterName = null, limit = 25 }, internal = {}) {
  binding = erasureBinding(binding);
  const pattern = /^erasure-[a-f0-9]{64}\.json$/;
  if (!Buffer.isBuffer(key) || key.length !== 32 || afterName !== null && (typeof afterName !== "string" || !pattern.test(afterName))
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) failErasure("ERASURE_INPUT");
  try {
    return await (internal.withDirectory ?? withPrivateDirectory)(directory, async scope => {
      await scope.assertReady(); const names = []; let entries = 0;
      const handle = await opendir(scope.path);
      for await (const entry of handle) {
        if (++entries > 10000) failErasure("ERASURE_LIMIT");
        if (!entry.name.startsWith("erasure-") || !entry.name.endsWith(".json")) continue;
        if (!pattern.test(entry.name)) failErasure("ERASURE_INPUT");
        if (afterName === null || entry.name > afterName) names.push(entry.name);
      }
      names.sort(); const jobs = [];
      for (const filename of names.slice(0, limit)) {
        const file = journalFile({ directory, sourceKey: key, binding, clientId: null, name: filename.slice(0, -5) },
          { withDirectory: (_directory, work) => work(scope) });
        try {
          const { revision, record } = await file.read();
          if (record === null) failErasure("ERASURE_CHANGED");
          jobs.push({ clientId: record.clientId, phase: record.phase, revision, updatedAt: record.updatedAt });
        } finally { file.close(); }
      }
      await scope.assertReady(); return { jobs, nextCursor: names.length > limit ? names[limit - 1] : null };
    });
  } catch (error) { if (error instanceof AccountErasureError) throw error; failErasure(); }
}
