import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { createPrivateJsonStore } from "../files/private-json.mjs";
import { erasureBinding } from "../data/erasure-state.mjs";
import { registryHash } from "./registry-snapshot.mjs";

export const WITNESS_ENROLLMENT_FILE = "witness-enrollment.json";
export const WITNESS_ENROLLMENT_ORIGIN = "witness-enrollment-origin.json";
const LOCK = "witness-enrollment.lock", MAX_BYTES = 8192;
const STAT_FIELDS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const CODES = ["UNAVAILABLE", "INPUT", "MISSING", "CHANGED", "AUTHENTICATION", "RECOVERY_REQUIRED", "MAINTENANCE", "CLOSED", "BUSY", "UNSAFE"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const hex = (value, size = 64) => typeof value === "string" && new RegExp(`^[a-f0-9]{${size}}$`).test(value);
const same = (a, b) => STAT_FIELDS.every(name => a[name] === b[name]);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export class WitnessEnrollmentError extends Error {
  constructor(suffix = "UNAVAILABLE") {
    super("The original witness enrollment was not confirmed."); this.name = "WitnessEnrollmentError";
    this.code = `WITNESS_ENROLLMENT_${CODES.includes(suffix) ? suffix : "UNAVAILABLE"}`;
  }
}
const fail = suffix => { throw new WitnessEnrollmentError(suffix); };
const safe = async work => { try { return await work(); } catch (error) { if (error instanceof WitnessEnrollmentError) throw error; fail(); } };
function fields(value, names) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== names.length
    || names.some(name => !Object.hasOwn(value, name) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), "value"))) fail("INPUT");
}
function physical(value) {
  const result = { dev: String(value.dev), ino: String(value.ino) };
  if (!/^(?:0|[1-9][0-9]{0,19})$/.test(result.dev) || !/^[1-9][0-9]{0,19}$/.test(result.ino)) fail("UNSAFE");
  return result;
}
function selectedContract(value) {
  fields(value, ["version", "origin", "contractId", "createdAt", "binding", "sourceIdentity", "registryId", "destination", "initialSnapshotSha256"]);
  fields(value.sourceIdentity, ["dev", "ino"]); fields(value.destination, ["destinationId", "pairedAt", "pairingFingerprint"]);
  const destination = value.destination;
  if (value.version !== 1 || value.origin !== "https://jessiemessage.com" || !hex(value.contractId) || !hex(value.registryId)
    || !hex(value.initialSnapshotSha256) || !Number.isSafeInteger(value.createdAt) || value.createdAt < 1
    || !hex(destination.destinationId, 32) || !Number.isSafeInteger(destination.pairedAt) || destination.pairedAt < 1 || !hex(destination.pairingFingerprint)) fail("INPUT");
  let binding; try { binding = erasureBinding(value.binding); } catch { fail("INPUT"); }
  const result = { version: 1, origin: value.origin, contractId: value.contractId, createdAt: value.createdAt,
    binding, sourceIdentity: physical(value.sourceIdentity), registryId: value.registryId,
    destination: { destinationId: destination.destinationId, pairedAt: destination.pairedAt, pairingFingerprint: destination.pairingFingerprint },
    initialSnapshotSha256: value.initialSnapshotSha256 };
  if (result.initialSnapshotSha256 !== registryHash({ version: 1, registryId: result.registryId, files: [] })) fail("INPUT");
  return result;
}
function regular(stats) {
  if (!stats.isFile() || stats.uid !== BigInt(process.getuid()) || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n
    || stats.size < 1n || stats.size > BigInt(MAX_BYTES)) fail("UNSAFE");
}

/** Explicit first use only. The separate immutable origin makes a missing or
 * interrupted mutable state an error; no check/reservation creates defaults.
 * The caller owns provenance and real process maintenance, not an offline flag. */
export function createWitnessEnrollment({ directory, contract, contractSha256, key: suppliedKey, assertOriginal, withMaintenance, assertProvenance = null }, internal = {}) {
  if (typeof directory !== "string" || directory === "/" || directory !== resolve(directory) || !directory.startsWith("/")
    || /[\\\x00-\x1f\x7f]/.test(directory) || !hex(contractSha256) || !Buffer.isBuffer(suppliedKey) || suppliedKey.length !== 32
    || typeof assertOriginal !== "function" || typeof withMaintenance !== "function"
    || assertProvenance !== null && typeof assertProvenance !== "function") fail("INPUT");
  const original = selectedContract(contract), key = Buffer.from(hkdfSync("sha256", suppliedKey, Buffer.alloc(0),
    Buffer.from(`jessiemessage:witness-enrollment:https://jessiemessage.com:v1:${contractSha256}`), 32));
  const withDirectory = internal.withDirectory ?? withPrivateDirectory;
  let closed = false, busy = false, initializationAttempted = false, originPin = null;
  const active = () => { if (closed) fail("CLOSED"); };
  const mac = value => { active(); return createHmac("sha256", key).update(JSON.stringify(value)).digest("hex"); };
  function authenticate(value, authentication) {
    if (!hex(authentication) || !timingSafeEqual(Buffer.from(authentication, "hex"), Buffer.from(mac(value), "hex"))) fail("AUTHENTICATION");
  }
  async function source() { active(); try { await assertOriginal(); } catch { fail("CHANGED"); } active(); }
  async function guard(scope, assertQuiescent) {
    active(); if (typeof assertQuiescent !== "function") fail("MAINTENANCE");
    await assertQuiescent(); await scope.assertReady(); await source(); await assertQuiescent(); active();
  }
  function originPayload(value) {
    fields(value, ["version", "contractSha256", "contract", "directoryIdentity"]);
    fields(value.directoryIdentity, ["dev", "ino"]);
    if (value.version !== 1 || value.contractSha256 !== contractSha256 || !equal(selectedContract(value.contract), original)) fail("CHANGED");
    return { version: 1, contractSha256, contract: original, directoryIdentity: physical(value.directoryIdentity) };
  }
  async function readOrigin(scope) {
    let file, bytes;
    try {
      await scope.assertReady();
      try { file = await open(scope.file(WITNESS_ENROLLMENT_ORIGIN), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
      catch (error) { if (error?.code === "ENOENT") fail("MISSING"); throw error; }
      const before = await file.stat({ bigint: true }); regular(before);
      bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
      while (length < bytes.length) { const part = await file.read(bytes, length, bytes.length - length, length); if (!part.bytesRead) break; length += part.bytesRead; }
      const after = await file.stat({ bigint: true }), visible = await lstat(scope.file(WITNESS_ENROLLMENT_ORIGIN), { bigint: true });
      regular(after); regular(visible);
      if (length !== Number(before.size) || !same(before, after) || !same(after, visible)) fail("CHANGED");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)), envelope = JSON.parse(text);
      fields(envelope, ["origin", "authentication"]); const payload = originPayload(envelope.origin);
      authenticate(payload, envelope.authentication);
      if (`${JSON.stringify({ origin: payload, authentication: envelope.authentication })}\n` !== text
        || !equal(payload.directoryIdentity, physical(await scope.assertReady())) || equal(payload.directoryIdentity, original.sourceIdentity)) fail("CHANGED");
      const fingerprint = hash(text); if (originPin !== null && fingerprint !== originPin) fail("CHANGED");
      originPin = fingerprint; return fingerprint;
    } finally { bytes?.fill(0); await file?.close(); }
  }
  async function inventory(scope, empty = false) {
    await scope.assertReady(); const entries = await opendir(scope.path), names = [];
    for await (const entry of entries) {
      if (empty || ![WITNESS_ENROLLMENT_ORIGIN, WITNESS_ENROLLMENT_FILE].includes(entry.name) || names.includes(entry.name)) fail("RECOVERY_REQUIRED");
      names.push(entry.name);
    }
    if (!empty && (names.length !== 2 || !names.includes(WITNESS_ENROLLMENT_ORIGIN) || !names.includes(WITNESS_ENROLLMENT_FILE))) fail("MISSING");
    await scope.assertReady();
  }
  function state(value) {
    fields(value, ["version", "revision", "phase", "attemptId", "originSha256", "authentication"]);
    if (value.version !== 1 || ![0, 1, 2].includes(value.revision)) fail("INPUT");
    if (value.revision === 0 && value.phase === null && value.attemptId === null && value.originSha256 === null && value.authentication === null) return { ...value };
    if (!["ready", "spent"].includes(value.phase) || !hex(value.originSha256) || !hex(value.authentication)
      || (value.phase === "ready" ? value.attemptId !== null : !hex(value.attemptId, 32))) fail("INPUT");
    return { version: 1, revision: value.revision, phase: value.phase, attemptId: value.attemptId, originSha256: value.originSha256, authentication: value.authentication };
  }
  const store = createPrivateJsonStore({ name: WITNESS_ENROLLMENT_FILE, lock: LOCK, maxBytes: MAX_BYTES, validate: state,
    empty: () => ({ version: 1, revision: 0, phase: null, attemptId: null, originSha256: null, authentication: null }),
    fail: () => fail("RECOVERY_REQUIRED"), isKnownError: error => error instanceof WitnessEnrollmentError });
  const payload = value => ({ version: value.version, revision: value.revision, phase: value.phase, attemptId: value.attemptId, originSha256: value.originSha256 });
  async function readState(scope) {
    await inventory(scope); const originSha256 = await readOrigin(scope);
    const value = await store.read(directory, { withDirectory: (_directory, work) => work(scope) });
    if (value.revision === 0) fail("MISSING");
    if (value.originSha256 !== originSha256 || value.phase === "ready" && value.revision !== 1 || value.phase === "spent" && value.revision !== 2) fail("CHANGED");
    authenticate(payload(value), value.authentication); await inventory(scope); return value;
  }
  async function saveState(scope, phase, attemptId, originSha256, revision, assertQuiescent) {
    const next = { version: 1, revision: revision + 1, phase, attemptId, originSha256 };
    const saved = await store.save(directory, { ...next, revision, authentication: mac(next) }, revision, {
      withDirectory: (_directory, work) => work(scope), beforeCommit: async () => {
        await guard(scope, assertQuiescent); if (await readOrigin(scope) !== originSha256) fail("CHANGED");
      },
    });
    await guard(scope, assertQuiescent); const reread = await readState(scope);
    if (!equal(saved, reread)) fail("CHANGED"); return reread;
  }
  async function exclusive(work) {
    return safe(async () => { active(); if (busy) fail("BUSY"); busy = true;
      try { return await work(); } finally { busy = false; } });
  }
  async function maintained(work) {
    let entered = false, completed = false, expected;
    const result = await withMaintenance(async assertQuiescent => {
      if (entered || typeof assertQuiescent !== "function") fail("MAINTENANCE"); entered = true;
      expected = await withDirectory(directory, async scope => { await guard(scope, assertQuiescent); return work(scope, assertQuiescent); });
      completed = true; return expected;
    });
    active(); if (!entered || !completed || result !== expected) fail("MAINTENANCE"); await source(); return result;
  }
  const status = value => Object.freeze({ ready: value.phase === "ready", spent: value.phase === "spent" });
  return Object.freeze({
    async initialize() {
      return exclusive(async () => {
        if (initializationAttempted) fail("RECOVERY_REQUIRED"); initializationAttempted = true;
        return maintained(async (scope, assertQuiescent) => {
          await inventory(scope, true); const directoryIdentity = physical(await scope.assertReady());
          if (equal(directoryIdentity, original.sourceIdentity)) fail("UNSAFE");
          const origin = { version: 1, contractSha256, contract: original, directoryIdentity };
          const bytes = Buffer.from(`${JSON.stringify({ origin, authentication: mac(origin) })}\n`); let file;
          try {
            await guard(scope, assertQuiescent);
            file = await open(scope.file(WITNESS_ENROLLMENT_ORIGIN), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
            await file.writeFile(bytes); await file.sync(); await scope.sync();
          } finally { bytes.fill(0); await file?.close(); }
          const originSha256 = await readOrigin(scope);
          const value = await saveState(scope, "ready", null, originSha256, 0, assertQuiescent);
          await guard(scope, assertQuiescent); return status(value);
        });
      });
    },
    async check() {
      return exclusive(async () => { await source(); const result = await withDirectory(directory, async scope => status(await readState(scope))); await source(); return result; });
    },
    // Separate read-only authority for recovery. Initialization/reservation and
    // their guards continue to require the original empty local registry.
    async readRecoveryAuthority() {
      return exclusive(async () => {
        if (typeof assertProvenance !== "function") fail("INPUT");
        active(); await assertProvenance();
        const value = await withDirectory(directory, scope => readState(scope));
        if (value.phase !== "spent" || value.revision !== 2) fail("RECOVERY_REQUIRED");
        await assertProvenance(); active(); return status(value);
      });
    },
    async reserve(value) {
      return exclusive(async () => {
        fields(value, ["version", "destinationId", "attemptId"]);
        if (value.version !== 1 || value.destinationId !== original.destination.destinationId || !hex(value.attemptId, 32)) fail("INPUT");
        return maintained(async (scope, assertQuiescent) => {
          let current = await readState(scope); let initialize = false;
          if (current.phase === "spent") { if (current.attemptId !== value.attemptId) fail("RECOVERY_REQUIRED"); }
          else { current = await saveState(scope, "spent", value.attemptId, current.originSha256, 1, assertQuiescent); initialize = true; }
          await guard(scope, assertQuiescent);
          return Object.freeze({ version: 1, initialize, destinationId: original.destination.destinationId, attemptId: current.attemptId,
            contractSha256, contractId: original.contractId, registryId: original.registryId, initialSnapshotSha256: original.initialSnapshotSha256 });
        });
      });
    },
    close() { closed = true; key.fill(0); },
  });
}
