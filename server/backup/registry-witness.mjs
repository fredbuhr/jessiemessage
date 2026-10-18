import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { createPrivateJsonStore } from "../files/private-json.mjs";
import { continuitySafe, ErasureContinuityError, failContinuity, registryFields, registryHash,
  REGISTRY_HEX, REGISTRY_MAX_BYTES, validateRegistrySnapshot, assertRegistryEnvelopeAdvance } from "./registry-snapshot.mjs";

const FIELDS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const same = (a, b) => FIELDS.every(name => a[name] === b[name]);
const snapshotName = (revision, sha256) => `registry-${String(revision).padStart(16, "0")}-${sha256}.json`;
function regular(stats, empty = false) {
  if (!stats.isFile() || stats.uid !== BigInt(process.getuid()) || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n
    || stats.size < (empty ? 0n : 1n) || stats.size > BigInt(REGISTRY_MAX_BYTES)) failContinuity("ERASURE_CONTINUITY_UNSAFE");
}
function head(value) {
  registryFields(value, ["version", "revision", "registryId", "snapshotSha256"]);
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision >= Number.MAX_SAFE_INTEGER
    || !(value.revision === 0 && value.registryId === null && value.snapshotSha256 === null
      || typeof value.registryId === "string" && REGISTRY_HEX.test(value.registryId) && typeof value.snapshotSha256 === "string" && REGISTRY_HEX.test(value.snapshotSha256))) failContinuity("ERASURE_CONTINUITY_INPUT");
  return { version: 1, revision: value.revision, registryId: value.registryId, snapshotSha256: value.snapshotSha256 };
}
const emptyHead = () => ({ version: 1, revision: 0, registryId: null, snapshotSha256: null });

/** Storage core for a separately hosted witness. Directory separation on the
 * application host is NOT an independent witness. Transport/authentication and
 * durable PC storage must be bound before production can use this protocol. */
export function createRegistryWitness({ directory, registryId }, internal = {}) {
  if (typeof directory !== "string" || typeof registryId !== "string" || !REGISTRY_HEX.test(registryId)) failContinuity("ERASURE_CONTINUITY_INPUT");
  const withDirectory = internal.withDirectory ?? withPrivateDirectory;
  const heads = createPrivateJsonStore({ name: "registry-head.json", lock: "registry-head.lock", maxBytes: 1024,
    validate: head, empty: emptyHead, fail: code => failContinuity(({ input: "ERASURE_CONTINUITY_INPUT", changed: "ERASURE_CONTINUITY_CHANGED", busy: "ERASURE_CONTINUITY_BUSY" })[code]),
    isKnownError: error => error instanceof ErasureContinuityError });
  let busy = false;
  async function exclusive(work) {
    if (busy) failContinuity("ERASURE_CONTINUITY_BUSY"); busy = true;
    try { return await continuitySafe(() => withDirectory(directory, work)); } finally { busy = false; }
  }
  async function readSnapshot(scope, revision, sha256) {
    let file, bytes;
    try {
      await scope.assertReady(); const name = snapshotName(revision, sha256), visible = await lstat(scope.file(name), { bigint: true }); regular(visible);
      file = await open(scope.file(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = await file.stat({ bigint: true }); regular(before);
      if (!same(visible, before)) failContinuity("ERASURE_CONTINUITY_CHANGED");
      bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
      while (length < bytes.length) {
        const part = await file.read(bytes, length, bytes.length - length, length);
        if (!part.bytesRead) break; length += part.bytesRead;
      }
      const after = await file.stat({ bigint: true }); regular(after);
      if (length !== Number(before.size) || !same(before, after) || !same(after, await lstat(scope.file(name), { bigint: true }))) failContinuity("ERASURE_CONTINUITY_CHANGED");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)), value = validateRegistrySnapshot(JSON.parse(text));
      if (`${JSON.stringify(value)}\n` !== text || registryHash(value) !== sha256 || value.registryId !== registryId) failContinuity("ERASURE_CONTINUITY_CHANGED");
      // This also covers a fully written publication observed before another
      // process reached fsync. An EEXIST path is not a durability receipt.
      await file.sync();
      if (!same(after, await file.stat({ bigint: true })) || !same(after, await lstat(scope.file(name), { bigint: true }))) failContinuity("ERASURE_CONTINUITY_CHANGED");
      await scope.assertReady(); return value;
    } finally { bytes?.fill(0); await file?.close(); }
  }
  async function publish(scope, snapshot, revision) {
    const sha256 = registryHash(snapshot), name = snapshotName(revision, sha256);
    const bytes = Buffer.from(`${JSON.stringify(snapshot)}\n`); let file;
    try {
      if (bytes.length > REGISTRY_MAX_BYTES) failContinuity("ERASURE_CONTINUITY_INPUT");
      await scope.assertReady();
      try { file = await open(scope.file(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        if (JSON.stringify(await readSnapshot(scope, revision, sha256)) !== JSON.stringify(snapshot)) failContinuity("ERASURE_CONTINUITY_CHANGED");
        return sha256;
      }
      const before = await file.stat({ bigint: true }); regular(before, true);
      await file.writeFile(bytes); await file.sync();
      const after = await file.stat({ bigint: true }); regular(after);
      if (before.ino !== after.ino || before.dev !== after.dev || after.size !== BigInt(bytes.length)
        || !same(after, await lstat(scope.file(name), { bigint: true }))) failContinuity("ERASURE_CONTINUITY_CHANGED");
      await scope.sync();
      if (JSON.stringify(await readSnapshot(scope, revision, sha256)) !== JSON.stringify(snapshot)) failContinuity("ERASURE_CONTINUITY_CHANGED");
      return sha256;
    } finally { bytes.fill(0); await file?.close(); }
  }
  async function inventory(scope) {
    const entries = await opendir(scope.path), snapshots = new Map(); let count = 0, bytes = 0n;
    for await (const entry of entries) {
      if (++count > 10002) failContinuity("ERASURE_CONTINUITY_LIMIT");
      if (entry.name === "registry-head.json") continue;
      if (entry.name === "registry-head.lock" || entry.name.startsWith(".registry-head.json.")) failContinuity("ERASURE_CONTINUITY_BUSY");
      const match = /^registry-([0-9]{16})-([a-f0-9]{64})\.json$/.exec(entry.name);
      if (!match) failContinuity("ERASURE_CONTINUITY_UNSAFE");
      const revision = Number(match[1]);
      if (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER || snapshots.has(revision)) failContinuity("ERASURE_CONTINUITY_ROLLBACK");
      const stats = await lstat(scope.file(entry.name), { bigint: true }); regular(stats); bytes += stats.size;
      if (bytes > 1024n * 1024n * 1024n) failContinuity("ERASURE_CONTINUITY_LIMIT");
      snapshots.set(revision, match[2]);
    }
    // Immutable publication numbers must be contiguous. A rolled-back head
    // cannot hide a later durable snapshot or make a lost receipt look absent.
    if (snapshots.size > 10000 || [...snapshots.keys()].some(revision => revision > snapshots.size)) failContinuity("ERASURE_CONTINUITY_ROLLBACK");
    await scope.assertReady(); return { snapshots, bytes };
  }
  async function current(scope) {
    const value = await heads.read(directory, { withDirectory: (_directory, work) => work(scope) });
    if (value.revision < 1) failContinuity("ERASURE_CONTINUITY_UNINITIALIZED");
    if (value.registryId !== registryId) failContinuity("ERASURE_CONTINUITY_BINDING");
    const snapshot = await readSnapshot(scope, value.revision, value.snapshotSha256);
    if (JSON.stringify(await heads.read(directory, { withDirectory: (_directory, work) => work(scope) })) !== JSON.stringify(value)) failContinuity("ERASURE_CONTINUITY_CHANGED");
    return { head: value, snapshot };
  }
  function scoped(scope, beforeCommit) { return { withDirectory: (_directory, work) => work(scope), ...(beforeCommit ? { beforeCommit } : {}) }; }
  return Object.freeze({
    /** Explicit genesis only, before any real closure. Missing storage during
     * exchange is an error, never permission to initialize an empty registry. */
    async initializeEmpty() {
      return exclusive(async scope => {
        const entries = await opendir(scope.path); let count = 0;
        for await (const _entry of entries) { if (++count) break; }
        if (count) failContinuity("ERASURE_CONTINUITY_NOT_EMPTY");
        const snapshot = { version: 1, registryId, files: [] }, sha256 = await publish(scope, snapshot, 1);
        const value = await heads.save(directory, { version: 1, revision: 0, registryId, snapshotSha256: sha256 }, 0,
          scoped(scope, async previous => { if (previous.revision !== 0) failContinuity("ERASURE_CONTINUITY_CHANGED"); }));
        const reread = await current(scope);
        if (JSON.stringify(reread.head) !== JSON.stringify(value)) failContinuity("ERASURE_CONTINUITY_CHANGED");
        return { initialized: true, revision: value.revision, sha256 };
      });
    },
    async exchange(request) {
      return exclusive(async scope => {
        registryFields(request, ["version", "registryId", "challenge", "snapshot"]);
        if (request.version !== 1 || request.registryId !== registryId || typeof request.challenge !== "string" || !REGISTRY_HEX.test(request.challenge)) failContinuity("ERASURE_CONTINUITY_INPUT");
        let previous = await current(scope);
        const { snapshots: history, bytes: storedBytes } = await inventory(scope);
        if (history.get(previous.head.revision) !== previous.head.snapshotSha256 || history.size < previous.head.revision
          || history.size > previous.head.revision + 1) failContinuity("ERASURE_CONTINUITY_ROLLBACK");
        if (history.size === previous.head.revision + 1) {
          // A fully fsynced immutable publication is already a durable fence.
          // Finish only its head pointer after a lost acknowledgement; never
          // replace it with the caller's older or different proposal.
          const pending = await readSnapshot(scope, history.size, history.get(history.size));
          assertRegistryEnvelopeAdvance(previous.snapshot, pending);
          const saved = await heads.save(directory, { ...previous.head, snapshotSha256: history.get(history.size) }, previous.head.revision, scoped(scope));
          previous = await current(scope);
          if (JSON.stringify(previous.head) !== JSON.stringify(saved)) failContinuity("ERASURE_CONTINUITY_CHANGED");
        }
        // Null requests only a fresh recovery inventory. A pending durable
        // publication may finish its metadata pointer above; no receipt is
        // removed or reset. This is distinct from proposing an empty registry.
        if (request.snapshot === null) {
          if (history.size !== previous.head.revision) failContinuity("ERASURE_CONTINUITY_CHANGED");
          if (JSON.stringify((await current(scope)).head) !== JSON.stringify(previous.head)) failContinuity("ERASURE_CONTINUITY_CHANGED");
          return { version: 1, registryId, challenge: request.challenge, revision: previous.head.revision,
            sha256: previous.head.snapshotSha256, snapshot: previous.snapshot };
        }
        const snapshot = validateRegistrySnapshot(request.snapshot);
        if (snapshot.registryId !== registryId) failContinuity("ERASURE_CONTINUITY_BINDING");
        assertRegistryEnvelopeAdvance(previous.snapshot, snapshot);
        const sha256 = registryHash(snapshot); let saved = previous.head;
        if (sha256 !== saved.snapshotSha256) {
          if (saved.revision >= 10000 || history.size === saved.revision
            && storedBytes + BigInt(Buffer.byteLength(JSON.stringify(snapshot)) + 1) > 1024n * 1024n * 1024n) failContinuity("ERASURE_CONTINUITY_LIMIT");
          await publish(scope, snapshot, saved.revision + 1);
          saved = await heads.save(directory, { ...previous.head, snapshotSha256: sha256 }, previous.head.revision, scoped(scope));
        }
        const reread = await current(scope);
        const { snapshots: finalHistory } = await inventory(scope);
        if (JSON.stringify(reread.head) !== JSON.stringify(saved) || finalHistory.size !== saved.revision
          || finalHistory.get(saved.revision) !== saved.snapshotSha256) failContinuity("ERASURE_CONTINUITY_CHANGED");
        await scope.assertReady();
        return { version: 1, registryId, challenge: request.challenge, revision: saved.revision, sha256, snapshot: reread.snapshot };
      });
    },
  });
}
