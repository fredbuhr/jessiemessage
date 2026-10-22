import { createHash, createHmac } from "node:crypto";
import { AccountErasureError, erasureBinding, erasureFields, erasureTransition } from "../data/erasure-state.mjs";
import { erasureJournalBindings, verifyScopedErasureJournalEnvelope } from "../data/erasure-journal.mjs";

export const REGISTRY_MAX_BYTES = 64 * 1024 * 1024;
export const REGISTRY_NAME = /^erasure-[a-f0-9]{64}\.json$/;
export const REGISTRY_HEX = /^[a-f0-9]{64}$/;
export class ErasureContinuityError extends AccountErasureError {
  constructor(code = "ERASURE_CONTINUITY_UNAVAILABLE") { super(code); this.name = "ErasureContinuityError"; }
}
export const failContinuity = code => { throw new ErasureContinuityError(code); };
export const registryHash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function continuitySafe(work) {
  try { return await work(); }
  catch (error) { if (error instanceof ErasureContinuityError) throw error; failContinuity(); }
}
export function registryFields(value, names) {
  try { erasureFields(value, names); } catch { failContinuity("ERASURE_CONTINUITY_INPUT"); }
}
function array(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 9990
    || Reflect.ownKeys(value).length !== value.length + 1) failContinuity("ERASURE_CONTINUITY_INPUT");
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) failContinuity("ERASURE_CONTINUITY_INPUT");
    return descriptor.value;
  });
}
function decoded(value, minimum, maximum = minimum) {
  if (typeof value !== "string" || value.length > Math.ceil(maximum * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) failContinuity("ERASURE_CONTINUITY_INPUT");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < minimum || bytes.length > maximum || bytes.toString("base64url") !== value) failContinuity("ERASURE_CONTINUITY_INPUT");
  return bytes;
}

/** The witness needs neither the CRM key nor plaintext client identities. It
 * checks canonical, bounded encrypted envelopes and never decrypts them. */
function registryEnvelopeState(file) {
  registryFields(file, ["name", "content"]);
  if (typeof file.name !== "string" || !REGISTRY_NAME.test(file.name)) failContinuity("ERASURE_CONTINUITY_INPUT");
  let content;
  try {
    content = decoded(file.content, 1, 4096);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content), state = JSON.parse(text);
    registryFields(state, ["version", "revision", "envelope"]);
    if (![1, 2].includes(state.version) || !Number.isSafeInteger(state.revision) || state.revision < 1 || state.revision >= Number.MAX_SAFE_INTEGER) failContinuity("ERASURE_CONTINUITY_INPUT");
    registryFields(state.envelope, ["iv", "ciphertext", "tag"]);
    decoded(state.envelope.iv, 12); decoded(state.envelope.ciphertext, 1, 2048); decoded(state.envelope.tag, 16);
    if (`${JSON.stringify(state)}\n` !== text) failContinuity("ERASURE_CONTINUITY_INPUT");
    return { version: state.version, revision: state.revision };
  } catch (error) { if (error instanceof ErasureContinuityError) throw error; failContinuity("ERASURE_CONTINUITY_INPUT"); }
  finally { content?.fill(0); }
}
export function registryEnvelope(file) { return registryEnvelopeState(file).revision; }
export function validateRegistrySnapshot(value) {
  registryFields(value, ["version", "registryId", "files"]);
  if (![1, 2].includes(value.version) || typeof value.registryId !== "string" || !REGISTRY_HEX.test(value.registryId)) failContinuity("ERASURE_CONTINUITY_INPUT");
  let previous = null, bytes = 0;
  const files = array(value.files).map(file => {
    const envelope = registryEnvelopeState(file);
    if (value.version === 1 && envelope.version !== 1) failContinuity("ERASURE_CONTINUITY_INPUT");
    if (previous !== null && file.name <= previous || (bytes += file.content.length) > 56 * 1024 * 1024) failContinuity("ERASURE_CONTINUITY_INPUT");
    previous = file.name; return { name: file.name, content: file.content };
  });
  return { version: value.version, registryId: value.registryId, files };
}
export function registryIdentity(key, value) {
  const { binding, legacyBinding } = erasureJournalBindings(value);
  if (!Buffer.isBuffer(key) || key.length !== 32) failContinuity("ERASURE_CONTINUITY_INPUT");
  const namespace = legacyBinding ? "jessiemessage:erasure-witness:https://jessiemessage.com:v2:video:"
    : "jessiemessage:erasure-witness:https://jessiemessage.com:v1:";
  return createHmac("sha256", key).update(namespace).update(JSON.stringify(binding)).digest("hex");
}
export function authenticateRegistrySnapshot(value, { key, binding }) {
  const snapshot = validateRegistrySnapshot(value), jobs = new Map(), scopes = erasureJournalBindings(binding);
  if (snapshot.version !== (scopes.legacyBinding ? 2 : 1)
    || snapshot.registryId !== registryIdentity(key, scopes.binding)) failContinuity("ERASURE_CONTINUITY_BINDING");
  for (const file of snapshot.files) {
    const content = Buffer.from(file.content, "base64url");
    try { jobs.set(file.name, { ...verifyScopedErasureJournalEnvelope({ key, ...scopes, filename: file.name, content }), file }); }
    catch { failContinuity("ERASURE_CONTINUITY_AUTHENTICATION"); }
    finally { content.fill(0); }
  }
  return { snapshot, jobs };
}
export function snapshotErasureRegistry(value, { key, binding }) {
  const scopes = erasureJournalBindings(binding), version = scopes.legacyBinding ? 2 : 1;
  registryFields(value, ["version", "binding", ...(version === 2 ? ["legacyBinding"] : []), "files"]);
  if (value.version !== version || JSON.stringify(erasureBinding(value.binding)) !== JSON.stringify(scopes.binding)
    || version === 2 && JSON.stringify(erasureBinding(value.legacyBinding)) !== JSON.stringify(scopes.legacyBinding)) failContinuity("ERASURE_CONTINUITY_BINDING");
  const files = array(value.files).filter(file => {
    registryFields(file, ["name", "content"]);
    if (file.name !== "privacy-preparation.json" && (typeof file.name !== "string" || !REGISTRY_NAME.test(file.name))) failContinuity("ERASURE_CONTINUITY_INPUT");
    return file.name !== "privacy-preparation.json";
  });
  return authenticateRegistrySnapshot({ version, registryId: registryIdentity(key, scopes.binding), files }, { key, binding: scopes.binding }).snapshot;
}

/** This keyless check protects the witness against source rollback. The
 * application additionally authenticates and checks plaintext transitions. */
export function assertRegistryEnvelopeAdvance(previous, proposed) {
  previous = validateRegistrySnapshot(previous); proposed = validateRegistrySnapshot(proposed);
  if (previous.version !== proposed.version || previous.registryId !== proposed.registryId) failContinuity("ERASURE_CONTINUITY_BINDING");
  const files = new Map(proposed.files.map(file => [file.name, file]));
  for (const before of previous.files) {
    const after = files.get(before.name), oldRevision = registryEnvelope(before);
    if (!after || registryEnvelopeState(after).version !== registryEnvelopeState(before).version
      || registryEnvelope(after) < oldRevision || registryEnvelope(after) > oldRevision + 1
      || registryEnvelope(after) === oldRevision && after.content !== before.content) failContinuity("ERASURE_CONTINUITY_ROLLBACK");
  }
  const oldNames = new Set(previous.files.map(file => file.name));
  if (proposed.files.some(file => !oldNames.has(file.name) && registryEnvelope(file) !== 1)) failContinuity("ERASURE_CONTINUITY_UNWITNESSED");
  return proposed;
}
export function assertRegistryAdvance(previous, proposed, options) {
  assertRegistryEnvelopeAdvance(previous, proposed);
  const before = authenticateRegistrySnapshot(previous, options), after = authenticateRegistrySnapshot(proposed, options);
  for (const [name, old] of before.jobs) {
    const next = after.jobs.get(name), a = old.record, b = next.record;
    if (next.revision === old.revision + 1) {
      try { erasureTransition(a, b); } catch { failContinuity("ERASURE_CONTINUITY_ROLLBACK"); }
    }
  }
  for (const [name, job] of after.jobs) if (!before.jobs.has(name)
    && (job.revision !== 1 || job.record.phase !== "requested" || job.record.updatedAt !== job.record.startedAt)) failContinuity("ERASURE_CONTINUITY_UNWITNESSED");
  return after.snapshot;
}
