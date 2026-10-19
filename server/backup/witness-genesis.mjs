import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { erasureBinding } from "../data/erasure-state.mjs";
import { captureOperationalState } from "./operational-checkpoint.mjs";
import { acquireRecurringLock } from "./recurring-checkpoint-files.mjs";
import { readCopyState } from "./copy-files.mjs";
import { registryFields, registryHash, registryIdentity, snapshotErasureRegistry, REGISTRY_HEX } from "./registry-snapshot.mjs";

export const WITNESS_GENESIS_FILE = "witness-genesis.json";
const ORIGIN = "https://jessiemessage.com", PURPOSE = `jessiemessage:witness-genesis:${ORIGIN}:v1`;
const MAX_BYTES = 4096, MAX_DATE = 253402300799999;
const CODES = ["UNAVAILABLE", "INPUT", "UNSAFE", "CHANGED", "ABORTED", "AUTHENTICATION", "PAIRING", "BINDING", "NOT_EMPTY", "EXISTS"];
const STATS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => STATS.every(name => a[name] === b[name]);
const below = (a, b) => { const part = relative(b, a); return part === "" || part !== ".." && !part.startsWith(`..${sep}`) && !part.startsWith(sep); };
const absolute = value => typeof value === "string" && value.startsWith("/") && value !== "/" && resolve(value) === value
  && value.length <= 4096 && !/[\\\x00-\x1f\x7f]/.test(value);
const isHash = value => typeof value === "string" && REGISTRY_HEX.test(value);

export class WitnessGenesisError extends Error {
  constructor(suffix = "UNAVAILABLE") {
    super("The original witness contract was not confirmed."); this.name = "WitnessGenesisError";
    this.code = `WITNESS_GENESIS_${CODES.includes(suffix) ? suffix : "UNAVAILABLE"}`;
  }
}
const fail = suffix => { throw new WitnessGenesisError(suffix); };
async function safe(work) { try { return await work(); } catch (error) { if (error instanceof WitnessGenesisError) throw error; fail(); } }
function active(signal) { if (signal?.aborted) fail("ABORTED"); }
function identity(value) {
  registryFields(value, ["dev", "ino"]);
  if ([value.dev, value.ino].some(part => typeof part !== "string" || !/^(?:0|[1-9][0-9]{0,19})$/.test(part)
    || BigInt(part) > 18446744073709551615n) || value.ino === "0") fail("INPUT");
  return { dev: value.dev, ino: value.ino };
}
async function physical(scope) {
  const stats = await scope.assertReady();
  if (typeof stats?.dev !== "bigint" || typeof stats?.ino !== "bigint") fail("UNSAFE");
  return identity({ dev: String(stats.dev), ino: String(stats.ino) });
}
function destination(value) {
  registryFields(value, ["destinationId", "pairedAt", "pairingFingerprint"]);
  if (typeof value.destinationId !== "string" || !/^[a-f0-9]{32}$/.test(value.destinationId)
    || !Number.isSafeInteger(value.pairedAt) || value.pairedAt < 1 || value.pairedAt > MAX_DATE || !isHash(value.pairingFingerprint)) fail("INPUT");
  return { destinationId: value.destinationId, pairedAt: value.pairedAt, pairingFingerprint: value.pairingFingerprint };
}
function parameters(options) {
  const roots = [options.directory, options.operationsDirectory, options.privateDirectory, options.runtimeDirectory];
  if (!roots.every(absolute) || roots.some((root, index) => roots.some((other, j) => j !== index && below(root, other)))
    || !Buffer.isBuffer(options.key) || options.key.length !== 32) fail("INPUT");
  return { directory: options.directory, operationsDirectory: options.operationsDirectory,
    binding: erasureBinding(options.binding), key: Buffer.from(options.key) };
}
function contract(value) {
  registryFields(value, ["version", "origin", "contractId", "createdAt", "binding", "sourceIdentity", "registryId", "destination", "initialSnapshotSha256"]);
  if (value.version !== 1 || value.origin !== ORIGIN || !isHash(value.contractId) || !Number.isSafeInteger(value.createdAt)
    || value.createdAt < 1 || value.createdAt > MAX_DATE || !isHash(value.registryId) || !isHash(value.initialSnapshotSha256)) fail("INPUT");
  return { version: 1, origin: ORIGIN, contractId: value.contractId, createdAt: value.createdAt,
    binding: erasureBinding(value.binding), sourceIdentity: identity(value.sourceIdentity), registryId: value.registryId,
    destination: destination(value.destination), initialSnapshotSha256: value.initialSnapshotSha256 };
}
function mac(value, key) {
  const derived = Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), Buffer.from(PURPOSE), 32));
  try { return createHmac("sha256", derived).update(JSON.stringify(value)).digest("hex"); }
  finally { derived.fill(0); }
}
function encode(value, key) { return Buffer.from(`${JSON.stringify({ version: 1, contract: value, authentication: mac(value, key) })}\n`); }
function decode(bytes, key) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), envelope = JSON.parse(text);
  registryFields(envelope, ["version", "contract", "authentication"]);
  const value = contract(envelope.contract);
  if (envelope.version !== 1 || !isHash(envelope.authentication)
    || !timingSafeEqual(Buffer.from(envelope.authentication, "hex"), Buffer.from(mac(value, key), "hex"))) fail("AUTHENTICATION");
  const canonical = encode(value, key);
  try { if (!canonical.equals(bytes)) fail("INPUT"); } finally { canonical.fill(0); }
  return value;
}
function regular(stats) {
  if (!stats.isFile() || stats.uid !== BigInt(process.getuid()) || (stats.mode & 0o7777n) !== 0o600n
    || stats.nlink !== 1n || stats.size < 1n || stats.size > BigInt(MAX_BYTES)) fail("UNSAFE");
}
async function read(scope) {
  let file, bytes;
  try {
    await scope.assertReady(); await inventory(scope);
    file = await open(scope.file(WITNESS_GENESIS_FILE), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat({ bigint: true }); regular(before);
    bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
    while (length < bytes.length) { const part = await file.read(bytes, length, bytes.length - length, length); if (!part.bytesRead) break; length += part.bytesRead; }
    const after = await file.stat({ bigint: true }), visible = await lstat(scope.file(WITNESS_GENESIS_FILE), { bigint: true });
    regular(after); regular(visible);
    if (length !== Number(before.size) || !same(before, after) || !same(after, visible)) fail("CHANGED");
    await inventory(scope); await scope.assertReady(); return Buffer.from(bytes.subarray(0, length));
  } finally { bytes?.fill(0); await file?.close(); }
}
async function inventory(scope) {
  const entries = await opendir(scope.path); let count = 0;
  for await (const entry of entries) if (++count > 1 || entry.name !== WITNESS_GENESIS_FILE) fail("UNSAFE");
  if (count !== 1) fail();
}
async function paired(scope, destinationId) {
  const state = await readCopyState(scope.path, { withDirectory: (_directory, work) => work(scope) });
  const item = state.destinations.find(value => value.id === destinationId);
  if (!item || !item.enabled || item.tokenHash === null || item.pairedAt === null) fail("PAIRING");
  return destination({ destinationId: item.id, pairedAt: item.pairedAt, pairingFingerprint: item.tokenHash });
}
function freeze(value) {
  for (const name of ["binding", "sourceIdentity", "destination"]) Object.freeze(value[name]);
  return Object.freeze(value);
}
async function leased(scope, options, work) {
  // The shared lock sanitizes callback errors to its own file-error family.
  // Preserve this module's closed error codes only after lock cleanup succeeds.
  let failure;
  const result = await acquireRecurringLock(options.operationsDirectory, async lock => {
    try { return await work(lock); } catch (error) { failure = error; return null; }
  }, { signal: options.signal }, { withDirectory: (_directory, callback) => callback(scope) });
  if (failure) throw failure;
  return result;
}

/** An explicit operator-only preparation, never a startup/recovery fallback.
 * The caller must pin the ORIGINAL source identity before any closure exists
 * and actually stop all producers. An empty restored directory is not provenance.
 * A prepared contract is NOT an off-host witness acknowledgement or activation. */
export async function prepareWitnessGenesis(options, internal = {}) {
  return safe(async () => {
    const p = parameters(options), withDirectory = internal.withDirectory ?? withPrivateDirectory;
    let bytes;
    try {
      const expected = identity(options.sourceIdentity), selected = destination(options.destination);
      if (typeof options.assertQuiescent !== "function") fail("INPUT");
      active(options.signal);
      return await withDirectory(p.directory, trust => withDirectory(p.operationsDirectory, source =>
        leased(source, options, async lock => {
          const guard = async () => {
            active(options.signal); await options.assertQuiescent(); await lock.assertReady(); await trust.assertReady();
            if (JSON.stringify(await physical(source)) !== JSON.stringify(expected)
              || JSON.stringify(await physical(trust)) === JSON.stringify(expected)) fail("BINDING");
            const observed = await paired(source, selected.destinationId);
            if (JSON.stringify(observed) !== JSON.stringify(selected)) fail("PAIRING");
            const snapshot = snapshotErasureRegistry(await captureOperationalState(source, { key: p.key, binding: p.binding, signal: options.signal }), p);
            if (snapshot.files.length !== 0) fail("NOT_EMPTY");
            active(options.signal); await options.assertQuiescent(); await lock.assertReady(); return snapshot;
          };
          const initial = await guard(), entries = await opendir(trust.path);
          for await (const _entry of entries) fail("EXISTS");
          const value = contract({ version: 1, origin: ORIGIN, contractId: randomBytes(32).toString("hex"),
            createdAt: (internal.clock ?? Date.now)(), binding: p.binding, sourceIdentity: expected,
            registryId: registryIdentity(p.key, p.binding), destination: selected, initialSnapshotSha256: registryHash(initial) });
          bytes = encode(value, p.key); if (bytes.length > MAX_BYTES) fail("INPUT");
          await guard(); let file;
          try {
            // An interrupted publication is deliberately retained and cannot
            // be overwritten, "repaired", or reinitialized by another call.
            file = await open(trust.file(WITNESS_GENESIS_FILE), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
            const created = await file.stat({ bigint: true });
            if (!created.isFile() || created.size !== 0n || created.nlink !== 1n || created.uid !== BigInt(process.getuid())
              || (created.mode & 0o7777n) !== 0o600n) fail("UNSAFE");
            await guard(); await file.writeFile(bytes); await file.sync(); await trust.sync();
            const saved = await file.stat({ bigint: true }); regular(saved);
            if (saved.dev !== created.dev || saved.ino !== created.ino || saved.size !== BigInt(bytes.length)
              || !same(saved, await lstat(trust.file(WITNESS_GENESIS_FILE), { bigint: true }))) fail("CHANGED");
          } finally { await file?.close(); }
          await guard(); const reread = await read(trust);
          try { if (!reread.equals(bytes)) fail("CHANGED"); decode(reread, p.key); }
          finally { reread.fill(0); }
          await guard();
          return Object.freeze({ prepared: true, contractSha256: hash(bytes), contract: freeze(value),
            externalWitnessConfirmed: false, closuresEnabled: false });
        })));
    } finally { p.key.fill(0); bytes?.fill(0); }
  });
}

/** The launcher must pin the immutable file hash independently of restorable
 * operational files. Missing/replaced contracts never create a default state.
 * This read authenticates enrollment metadata only; every destructive action
 * still needs the fresh off-host inventory from createErasureContinuity. */
export async function readWitnessGenesis(options, internal = {}) {
  return safe(async () => {
    const p = parameters(options), withDirectory = internal.withDirectory ?? withPrivateDirectory;
    let bytes;
    try {
      if (!isHash(options.expectedContractSha256)) fail("INPUT"); active(options.signal);
      return await withDirectory(p.directory, trust => withDirectory(p.operationsDirectory, async source => {
        bytes = await read(trust);
        if (hash(bytes) !== options.expectedContractSha256) fail("CHANGED");
        const value = decode(bytes, p.key);
        if (JSON.stringify(value.binding) !== JSON.stringify(p.binding) || value.registryId !== registryIdentity(p.key, p.binding)
          || JSON.stringify(value.sourceIdentity) !== JSON.stringify(await physical(source))
          || JSON.stringify(await physical(trust)) === JSON.stringify(value.sourceIdentity)
          || value.initialSnapshotSha256 !== registryHash({ version: 1, registryId: value.registryId, files: [] })) fail("BINDING");
        if (JSON.stringify(await paired(source, value.destination.destinationId)) !== JSON.stringify(value.destination)) fail("PAIRING");
        const confirmed = await read(trust);
        try { if (!confirmed.equals(bytes)) fail("CHANGED"); } finally { confirmed.fill(0); }
        active(options.signal); await source.assertReady(); await trust.assertReady(); return freeze(value);
      }));
    } finally { p.key.fill(0); bytes?.fill(0); }
  });
}
