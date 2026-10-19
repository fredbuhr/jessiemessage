import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { createPrivateJsonStore } from "../files/private-json.mjs";

const NAMESPACE = "jessiemessage:closure-reconciliation-progress:v1";
const PHASES = ["prepared", "running", "completed"];
const HEX = /^[a-f0-9]{64}$/;
const MAX_PLAINTEXT = 1024;

export class ReconciliationProgressError extends Error {
  constructor(code = "RECONCILIATION_PROGRESS_UNAVAILABLE") {
    super("Private reconciliation progress is unavailable.");
    this.name = "ReconciliationProgressError"; this.code = code;
  }
}
const fail = suffix => { throw new ReconciliationProgressError(`RECONCILIATION_PROGRESS_${suffix ?? "UNAVAILABLE"}`); };
function fields(value, names) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== names.length
    || names.some(name => !Object.hasOwn(value, name) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), "value"))) fail("INPUT");
}
function binding(value) {
  fields(value, ["database", "rootFingerprint"]);
  if (typeof value.database !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(value.database)
    || typeof value.rootFingerprint !== "string" || !HEX.test(value.rootFingerprint)) fail("INPUT");
  return { database: value.database, rootFingerprint: value.rootFingerprint };
}
function selected(options, hasDirectory) {
  fields(options, [...(hasDirectory ? ["directory"] : []), "key", "planSha256", "manifestSha256", "targetBinding"]);
  if (!Buffer.isBuffer(options.key) || options.key.length !== 32
    || [options.planSha256, options.manifestSha256].some(value => typeof value !== "string" || !HEX.test(value))
    || hasDirectory && (typeof options.directory !== "string" || !options.directory.length)) fail("INPUT");
  return { planSha256: options.planSha256, manifestSha256: options.manifestSha256, targetBinding: binding(options.targetBinding) };
}
function derive(key, context, purpose) {
  return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), Buffer.from(`${NAMESPACE}:${purpose}:${JSON.stringify(context)}`), 32));
}

/** Separate keys for target progress receipts, never for rewriting source envelopes. */
export function deriveReconciliationJournalKey(options) {
  const context = selected(options, false);
  return derive(options.key, context, "target-erasure-journal-key");
}

function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) fail("INPUT");
  return value;
}
function decoded(value, min, max = min) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]+$/.test(value) || value.length > 1366) fail();
  const result = Buffer.from(value, "base64url");
  if (result.length < min || result.length > max || result.toString("base64url") !== value) { result.fill(0); fail(); }
  return result;
}
function envelopeState(value) {
  fields(value, ["version", "revision", "envelope"]); revision(value.revision);
  if (value.version !== 1 || value.envelope === null && value.revision !== 0) fail("INPUT");
  if (value.envelope === null) return { version: 1, revision: value.revision, envelope: null };
  fields(value.envelope, ["iv", "ciphertext", "tag"]);
  for (const [field, min, max] of [["iv", 12, 12], ["ciphertext", 1, MAX_PLAINTEXT], ["tag", 16, 16]]) decoded(value.envelope[field], min, max).fill(0);
  return { version: 1, revision: value.revision, envelope: { iv: value.envelope.iv, ciphertext: value.envelope.ciphertext, tag: value.envelope.tag } };
}

/** A private run ledger; completion is neither a startup nor authority capability. */
export function createReconciliationProgress(options, internal = {}) {
  const context = selected(options, true), directory = options.directory;
  const key = derive(options.key, context, "ledger-key"), associated = `${NAMESPACE}:ledger:${JSON.stringify(context)}`;
  let closed = false;
  const available = () => { if (closed) fail(); };
  function record(value) {
    fields(value, ["version", "planSha256", "manifestSha256", "targetBinding", "phase"]);
    const result = { version: value.version, planSha256: value.planSha256, manifestSha256: value.manifestSha256,
      targetBinding: binding(value.targetBinding), phase: value.phase };
    if (result.version !== 1 || !PHASES.includes(result.phase)) fail("INPUT");
    if (result.planSha256 !== context.planSha256 || result.manifestSha256 !== context.manifestSha256
      || JSON.stringify(result.targetBinding) !== JSON.stringify(context.targetBinding)) fail("CHANGED");
    return result;
  }
  function opened(state) {
    available();
    if (state.envelope === null) return { revision: 0, record: null };
    if (state.revision < 1) fail();
    let plaintext, tail;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, decoded(state.envelope.iv, 12));
      decipher.setAAD(Buffer.from(`${associated}:${state.revision}`)); decipher.setAuthTag(decoded(state.envelope.tag, 16));
      plaintext = decipher.update(decoded(state.envelope.ciphertext, 1, MAX_PLAINTEXT)); tail = decipher.final();
      if (tail.length || plaintext.length > MAX_PLAINTEXT) fail();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext), value = record(JSON.parse(text));
      if (JSON.stringify(value) !== text) fail();
      available(); return { revision: state.revision, record: value };
    } catch (error) { if (error instanceof ReconciliationProgressError) throw error; fail(); }
    finally { plaintext?.fill(0); tail?.fill(0); }
  }
  function transition(previous, next) {
    if (previous === null) { if (next.phase !== "prepared") fail("CHANGED"); return; }
    const from = PHASES.indexOf(previous.phase), to = PHASES.indexOf(next.phase);
    if (to < from || to > from + 1 || to === from && JSON.stringify(previous) !== JSON.stringify(next)) fail("CHANGED");
  }
  const store = createPrivateJsonStore({ name: "reconciliation-progress.json", lock: "reconciliation-progress.lock", maxBytes: 8192,
    validate: envelopeState, empty: () => ({ version: 1, revision: 0, envelope: null }),
    fail: code => fail(({ input: "INPUT", changed: "CHANGED", busy: "BUSY" })[code]),
    isKnownError: error => error instanceof ReconciliationProgressError });
  return Object.freeze({
    async read() {
      available(); const state = await store.read(directory, internal); available(); return opened(state);
    },
    async save(value, expectedRevision, authorize) {
      available(); revision(expectedRevision); const next = record(value);
      if (typeof authorize !== "function") fail("INPUT");
      const plaintext = Buffer.from(JSON.stringify(next));
      try {
        if (plaintext.length > MAX_PLAINTEXT) fail("INPUT");
        const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(Buffer.from(`${associated}:${expectedRevision + 1}`));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const saved = await store.save(directory, { version: 1, revision: expectedRevision,
          envelope: { iv: iv.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") } }, expectedRevision,
        { ...internal, async beforeCommit(previous) {
          available(); transition(opened(previous).record, next); await authorize(); available();
        } });
        available(); return { revision: saved.revision, record: next };
      } finally { plaintext.fill(0); }
    },
    close() { closed = true; key.fill(0); },
  });
}
