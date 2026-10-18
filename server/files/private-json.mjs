import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { withPrivateDirectory } from "./private-directory.mjs";

/** Atomic, bounded, canonical private JSON with optimistic revision and a short writer lock. */
export function createPrivateJsonStore({ name: NAME, lock: LOCK, maxBytes: MAX_BYTES, validate: validateCopyState, empty: emptyCopyState, fail: failCopy, isKnownError }) {
  if (![NAME, LOCK].every(name => typeof name === "string" && /^[a-z][a-z0-9.-]{0,80}$/.test(name)) || NAME === LOCK
    || !Number.isSafeInteger(MAX_BYTES) || MAX_BYTES < 1 || MAX_BYTES > 131072
    || [validateCopyState, emptyCopyState, failCopy, isKnownError].some(value => typeof value !== "function")) throw new TypeError("Invalid private JSON store configuration.");
const FIELDS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const same = (a, b) => FIELDS.every(key => a[key] === b[key]);
const identity = (a, b) => a.dev === b.dev && a.ino === b.ino;
function regular(stats) {
  if (!stats.isFile() || FIELDS.some(key => typeof stats[key] !== "bigint") || stats.uid !== BigInt(process.getuid())
    || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n || stats.size < 0n || stats.size > BigInt(MAX_BYTES)) failCopy("unavailable");
}
async function safe(work) {
  try { return await work(); }
  catch (error) { if (isKnownError(error)) throw error; failCopy("unavailable"); }
}
async function read(scope) {
  let handle;
  const bytes = Buffer.alloc(MAX_BYTES + 1);
  try {
    await scope.assertReady();
    try { handle = await open(scope.file(NAME), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await scope.assertReady(); return { state: validateCopyState(emptyCopyState()), stats: null };
    }
    const before = await handle.stat({ bigint: true }); regular(before);
    let length = 0;
    while (length <= Number(before.size)) {
      const amount = Math.min(bytes.length - length, Number(before.size) - length + 1);
      const { bytesRead } = await handle.read(bytes, length, amount, length);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > amount) failCopy("unavailable");
      if (!bytesRead) break;
      length += bytesRead;
      if (length > Number(before.size)) failCopy("changed");
    }
    const after = await handle.stat({ bigint: true }), visible = await lstat(scope.file(NAME), { bigint: true });
    regular(after); regular(visible);
    if (length !== Number(before.size) || !same(before, after) || !same(after, visible)) failCopy("changed");
    await scope.assertReady();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    const state = validateCopyState(JSON.parse(text));
    // Only the canonical format written below is accepted. Duplicate keys,
    // escaped key aliases and alternate encodings cannot hide state members.
    if (text !== `${JSON.stringify(state)}\n`) failCopy("input");
    return { state, stats: after };
  } finally { bytes.fill(0); await handle?.close(); }
}
async function absent(scope, name) {
  try { await lstat(scope.file(name), { bigint: true }); failCopy("changed"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
}
async function removeOwned(scope, name, owned) {
  let visible;
  try { visible = await lstat(scope.file(name), { bigint: true }); }
  catch (error) { if (error?.code === "ENOENT") return; throw error; }
  regular(visible);
  if (!identity(visible, owned)) failCopy("changed");
  await scope.assertReady(); await unlink(scope.file(name)); await scope.sync();
}
async function readCopyState(directory, internal = {}) {
  return safe(() => (internal.withDirectory ?? withPrivateDirectory)(directory, async scope => (await read(scope)).state));
}

/** Independent short-lived writer lock; never held over a transfer or a capture. */
async function saveCopyState(directory, value, expectedRevision, internal = {}) {
  return safe(async () => {
    const state = validateCopyState(value);
    if (state.revision !== expectedRevision) failCopy("changed");
    const next = validateCopyState({ ...state, revision: state.revision + 1 });
    return (internal.withDirectory ?? withPrivateDirectory)(directory, async scope => {
      let lock, lockStats, file, fileStats;
      const temporary = `.${NAME}.${randomBytes(16).toString("hex")}.tmp`;
      const bytes = Buffer.from(`${JSON.stringify(next)}\n`);
      if (bytes.length > MAX_BYTES) { bytes.fill(0); failCopy("input"); }
      try {
        await scope.assertReady();
        try { lock = await open(scope.file(LOCK), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600); }
        catch (error) { if (error?.code === "EEXIST") failCopy("busy"); throw error; }
        lockStats = await lock.stat({ bigint: true }); regular(lockStats);
        if (lockStats.size !== 0n) failCopy("changed");
        const previous = await read(scope);
        if (previous.state.revision !== expectedRevision) failCopy("changed");
        file = await open(scope.file(temporary), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
        fileStats = await file.stat({ bigint: true }); regular(fileStats);
        if (fileStats.size !== 0n) failCopy("changed");
        await file.writeFile(bytes); await file.sync();
        const written = await file.stat({ bigint: true }), visible = await lstat(scope.file(temporary), { bigint: true });
        regular(written); regular(visible);
        if (!identity(written, fileStats) || !same(written, visible) || written.size !== BigInt(bytes.length)) failCopy("changed");
        await file.close(); file = null;
        const currentLock = await lstat(scope.file(LOCK), { bigint: true }); regular(currentLock);
        if (!same(currentLock, lockStats)) failCopy("changed");
        await scope.assertReady();
        if (previous.stats) {
          const current = await lstat(scope.file(NAME), { bigint: true }); regular(current);
          if (!same(current, previous.stats)) failCopy("changed");
        } else await absent(scope, NAME);
        if (internal.beforeCommit) await internal.beforeCommit(previous.state);
        // Recheck both visible entries after an asynchronous authorization proof.
        await scope.assertReady();
        if (previous.stats) {
          const current = await lstat(scope.file(NAME), { bigint: true }); regular(current);
          if (!same(current, previous.stats)) failCopy("changed");
        } else await absent(scope, NAME);
        if (!same(await lstat(scope.file(LOCK), { bigint: true }), lockStats)) failCopy("changed");
        if (!same(await lstat(scope.file(temporary), { bigint: true }), visible)) failCopy("changed");
        await rename(scope.file(temporary), scope.file(NAME)); await scope.sync();
        const final = await lstat(scope.file(NAME), { bigint: true }); regular(final);
        if (!identity(final, fileStats) || final.size !== BigInt(bytes.length)) failCopy("changed");
        if (JSON.stringify((await read(scope)).state) !== JSON.stringify(next)) failCopy("changed");
        return next;
      } finally {
        bytes.fill(0);
        try { await file?.close(); }
        finally {
          try { if (fileStats) await removeOwned(scope, temporary, fileStats); }
          finally { try { await lock?.close(); } finally { if (lockStats) await removeOwned(scope, LOCK, lockStats); } }
        }
      }
    });
  });
}

  return Object.freeze({ read: readCopyState, save: saveCopyState });
}
