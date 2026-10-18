import { constants } from "node:fs";
import { lstat, open, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { BackupAlertError, failAlert, emptyBackupAlertState, validateBackupAlertState } from "./alert-state.mjs";

const NAME = "backup-alert-state.json", LOCK = "backup-alert-state.lock", MAX_BYTES = 32768;
const FIELDS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const same = (a, b) => FIELDS.every(key => a[key] === b[key]);
const identity = (a, b) => a.dev === b.dev && a.ino === b.ino;
function regular(stats) {
  if (!stats.isFile() || FIELDS.some(key => typeof stats[key] !== "bigint") || stats.uid !== BigInt(process.getuid())
    || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n || stats.size < 0n || stats.size > BigInt(MAX_BYTES)) failAlert("ALERT_UNAVAILABLE");
}
async function safe(work) {
  try { return await work(); }
  catch (error) { if (error instanceof BackupAlertError) throw error; failAlert("ALERT_UNAVAILABLE"); }
}
async function read(scope) {
  let handle;
  const bytes = Buffer.alloc(MAX_BYTES + 1);
  try {
    await scope.assertReady();
    try { handle = await open(scope.file(NAME), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await scope.assertReady(); return { state: validateBackupAlertState(emptyBackupAlertState()), stats: null };
    }
    const before = await handle.stat({ bigint: true }); regular(before);
    let length = 0;
    while (length <= Number(before.size)) {
      const amount = Math.min(bytes.length - length, Number(before.size) - length + 1);
      const { bytesRead } = await handle.read(bytes, length, amount, length);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > amount) failAlert("ALERT_UNAVAILABLE");
      if (!bytesRead) break;
      length += bytesRead;
      if (length > Number(before.size)) failAlert("ALERT_CHANGED");
    }
    const after = await handle.stat({ bigint: true }), visible = await lstat(scope.file(NAME), { bigint: true });
    regular(after); regular(visible);
    if (length !== Number(before.size) || !same(before, after) || !same(after, visible)) failAlert("ALERT_CHANGED");
    await scope.assertReady();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    const state = validateBackupAlertState(JSON.parse(text));
    // Only the canonical format written below is accepted. Duplicate keys,
    // escaped key aliases and alternate encodings cannot hide state members.
    if (text !== `${JSON.stringify(state)}\n`) failAlert("ALERT_INPUT");
    return { state, stats: after };
  } finally { bytes.fill(0); await handle?.close(); }
}
async function absent(scope, name) {
  try { await lstat(scope.file(name), { bigint: true }); failAlert("ALERT_CHANGED"); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
}
async function removeOwned(scope, name, owned) {
  let visible;
  try { visible = await lstat(scope.file(name), { bigint: true }); }
  catch (error) { if (error?.code === "ENOENT") return; throw error; }
  regular(visible);
  if (!identity(visible, owned)) failAlert("ALERT_CHANGED");
  await scope.assertReady(); await unlink(scope.file(name)); await scope.sync();
}
export async function readBackupAlertState(directory, internal = {}) {
  return safe(() => (internal.withDirectory ?? withPrivateDirectory)(directory, async scope => (await read(scope)).state));
}

/** Independent short-lived writer lock; never held over SMTP or a capture. */
export async function saveBackupAlertState(directory, value, expectedRevision, internal = {}) {
  return safe(async () => {
    const state = validateBackupAlertState(value);
    if (state.revision !== expectedRevision) failAlert("ALERT_CHANGED");
    const next = validateBackupAlertState({ ...state, revision: state.revision + 1 });
    return (internal.withDirectory ?? withPrivateDirectory)(directory, async scope => {
      let lock, lockStats, file, fileStats;
      const temporary = `.${NAME}.${randomBytes(16).toString("hex")}.tmp`;
      const bytes = Buffer.from(`${JSON.stringify(next)}\n`);
      try {
        await scope.assertReady();
        try { lock = await open(scope.file(LOCK), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600); }
        catch (error) { if (error?.code === "EEXIST") failAlert("ALERT_LOCKED"); throw error; }
        lockStats = await lock.stat({ bigint: true }); regular(lockStats);
        if (lockStats.size !== 0n) failAlert("ALERT_CHANGED");
        const previous = await read(scope);
        if (previous.state.revision !== expectedRevision) failAlert("ALERT_CHANGED");
        file = await open(scope.file(temporary), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
        fileStats = await file.stat({ bigint: true }); regular(fileStats);
        if (fileStats.size !== 0n) failAlert("ALERT_CHANGED");
        await file.writeFile(bytes); await file.sync();
        const written = await file.stat({ bigint: true }), visible = await lstat(scope.file(temporary), { bigint: true });
        regular(written); regular(visible);
        if (!identity(written, fileStats) || !same(written, visible) || written.size !== BigInt(bytes.length)) failAlert("ALERT_CHANGED");
        await file.close(); file = null;
        const currentLock = await lstat(scope.file(LOCK), { bigint: true }); regular(currentLock);
        if (!same(currentLock, lockStats)) failAlert("ALERT_CHANGED");
        await scope.assertReady();
        if (previous.stats) {
          const current = await lstat(scope.file(NAME), { bigint: true }); regular(current);
          if (!same(current, previous.stats)) failAlert("ALERT_CHANGED");
        } else await absent(scope, NAME);
        await rename(scope.file(temporary), scope.file(NAME)); await scope.sync();
        const final = await lstat(scope.file(NAME), { bigint: true }); regular(final);
        if (!identity(final, fileStats) || final.size !== BigInt(bytes.length)) failAlert("ALERT_CHANGED");
        if (JSON.stringify((await read(scope)).state) !== JSON.stringify(next)) failAlert("ALERT_CHANGED");
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
