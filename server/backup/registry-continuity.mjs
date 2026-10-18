import { randomBytes } from "node:crypto";
import { erasureBinding, erasureId, erasureRecord } from "../data/erasure-state.mjs";
import { authenticateRegistrySnapshot, assertRegistryAdvance, continuitySafe, failContinuity, registryFields,
  registryHash, registryIdentity, REGISTRY_HEX, snapshotErasureRegistry } from "./registry-snapshot.mjs";

const gates = new WeakMap();
export function assertErasureContinuity(value, binding) {
  if (!gates.has(value) || gates.get(value) !== JSON.stringify(erasureBinding(binding))) failContinuity("ERASURE_CONTINUITY_INPUT");
}

/** Each proof is an authenticated, complete encrypted inventory returned for a
 * new random challenge and reread against the live source. A persisted success
 * flag or an old HTTP reply cannot prove continuity after a restart/restore.
 * exchange MUST be bound to an authenticated off-host durable witness; no such
 * production transport is installed by this module. */
export function createErasureContinuity({ key: sourceKey, binding: sourceBinding, readCurrent, exchange, timeoutMs = 30000 }) {
  const binding = erasureBinding(sourceBinding);
  if (!Buffer.isBuffer(sourceKey) || sourceKey.length !== 32 || typeof readCurrent !== "function" || typeof exchange !== "function"
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 20 || timeoutMs > 60000) failContinuity("ERASURE_CONTINUITY_INPUT");
  const key = Buffer.from(sourceKey), registryId = registryIdentity(key, binding);
  let closed = false, busy = false, previous = null, highwater = 0, highwaterHash = null, activeCancel = null;
  const available = signal => { if (closed) failContinuity(); if (signal?.aborted) failContinuity("ERASURE_CONTINUITY_ABORTED"); };
  async function current(assertReady, signal) {
    available(signal); await assertReady(); available(signal);
    const result = snapshotErasureRegistry(await readCurrent(), { key, binding });
    available(signal); await assertReady();
    if (previous) assertRegistryAdvance(previous, result, { key, binding });
    return result;
  }
  async function request(snapshot, assertReady, signal) {
    available(signal); await assertReady(); available(signal);
    if (snapshot !== null) {
      for (const file of snapshot.files) Object.freeze(file);
      Object.freeze(snapshot.files); Object.freeze(snapshot);
    }
    const challenge = randomBytes(32).toString("hex"), controller = new AbortController();
    let timer, cancel;
    const abort = new Promise((_resolve, reject) => { cancel = code => { controller.abort(); reject(Object.assign(new Error("Registry witness proof unavailable."), { continuityCode: code })); }; });
    const cancelled = () => cancel("ERASURE_CONTINUITY_ABORTED");
    signal?.addEventListener("abort", cancelled, { once: true });
    activeCancel = cancel; timer = setTimeout(() => cancel("ERASURE_CONTINUITY_TIMEOUT"), timeoutMs);
    try {
      const input = Object.freeze({ version: 1, registryId, challenge, snapshot });
      const response = await Promise.race([Promise.resolve().then(() => exchange(input, { signal: controller.signal })), abort]);
      available(signal); await assertReady(); available(signal);
      registryFields(response, ["version", "registryId", "challenge", "revision", "sha256", "snapshot"]);
      if (response.version !== 1 || response.registryId !== registryId || response.challenge !== challenge
        || !Number.isSafeInteger(response.revision) || response.revision < 1 || response.revision >= Number.MAX_SAFE_INTEGER
        || typeof response.sha256 !== "string" || !REGISTRY_HEX.test(response.sha256)) failContinuity("ERASURE_CONTINUITY_PROOF");
      const value = authenticateRegistrySnapshot(response.snapshot, { key, binding }).snapshot;
      if (registryHash(value) !== response.sha256 || response.revision < highwater
        || response.revision === highwater && response.sha256 !== highwaterHash) failContinuity("ERASURE_CONTINUITY_ROLLBACK");
      if (previous) assertRegistryAdvance(previous, value, { key, binding });
      if (snapshot !== null && registryHash(snapshot) !== response.sha256) failContinuity("ERASURE_CONTINUITY_CHANGED");
      // Pin the witness observation even if the local reread below fails. An
      // uncertain local publication cannot roll this process's proof backwards.
      previous = value; highwater = response.revision; highwaterHash = response.sha256;
      return { value, revision: highwater, sha256: highwaterHash };
    } catch (error) {
      if (error?.continuityCode) failContinuity(error.continuityCode);
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancelled); activeCancel = null; }
  }
  async function exclusive(assertReady, signal, work) {
    if (typeof assertReady !== "function") failContinuity("ERASURE_CONTINUITY_INPUT");
    if (busy) failContinuity("ERASURE_CONTINUITY_BUSY"); busy = true;
    try { return await continuitySafe(async () => { available(signal); return work(); }); }
    finally { busy = false; }
  }
  async function verify(assertReady, signal, expected = null) {
    const before = await current(assertReady, signal);
    const observed = await request(null, assertReady, signal);
    // The keyless witness can compare revisions, but cannot inspect phases or
    // identity continuity inside ciphertext. Authenticate its previous state
    // before allowing any new publication, including on a fresh process.
    assertRegistryAdvance(observed.value, before, { key, binding });
    const receipt = await request(before, assertReady, signal);
    const after = await current(assertReady, signal);
    if (registryHash(after) !== registryHash(before)) failContinuity("ERASURE_CONTINUITY_CHANGED");
    if (expected) {
      const { jobs } = authenticateRegistrySnapshot(after, { key, binding });
      const job = [...jobs.values()].find(value => value.record.clientId === expected.clientId);
      if (expected.record === null ? job !== undefined
        : !job || job.revision !== expected.revision || JSON.stringify(job.record) !== JSON.stringify(expected.record)) failContinuity("ERASURE_CONTINUITY_JOURNAL");
    }
    return Object.freeze({ verified: true, registrySha256: receipt.sha256, witnessRevision: receipt.revision, receipts: after.files.length });
  }
  const gate = Object.freeze({
    async verify(assertReady, { signal } = {}) {
      return exclusive(assertReady, signal, () => verify(assertReady, signal));
    },
    /** Bind the engine's actual journal to the complete witnessed inventory.
     * A gate pointed at an unrelated empty directory cannot authorize it. */
    async verifyJournal(clientId, state, assertReady, { signal } = {}) {
      return exclusive(assertReady, signal, async () => {
        erasureId(clientId); registryFields(state, ["revision", "record"]);
        const record = state.record === null ? null : erasureRecord(state.record);
        if (!Number.isSafeInteger(state.revision) || (record === null ? state.revision !== 0 : state.revision < 1
          || record.clientId !== clientId || JSON.stringify(record.binding) !== JSON.stringify(binding))) failContinuity("ERASURE_CONTINUITY_JOURNAL");
        return verify(assertReady, signal, { clientId, revision: state.revision, record });
      });
    },
    /** A recovery read supplies original envelopes for a quarantine, including
     * receipts newer than an old SQL backup. It never authorizes a runtime. */
    async recover(assertReady, { signal } = {}) {
      return exclusive(assertReady, signal, async () => {
        const result = await request(null, assertReady, signal);
        return { state: { version: 1, binding: { ...binding }, files: result.value.files.map(file => ({ ...file })) },
          registrySha256: result.sha256, witnessRevision: result.revision, reconciliationRequired: true, started: false };
      });
    },
    close() { closed = true; activeCancel?.("ERASURE_CONTINUITY_ABORTED"); key.fill(0); previous = null; gates.delete(gate); },
  });
  gates.set(gate, JSON.stringify(binding)); return gate;
}
