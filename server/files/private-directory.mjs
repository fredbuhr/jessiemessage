import { constants } from "node:fs";
import * as filesystem from "node:fs/promises";
import path from "node:path";

const PROC_DIRECTORY = "/proc/self/fd";
const PROC_SUPER_MAGIC = 0x9fa0n;
const MODE_KEY = "JESSIEMESSAGE_PRIVATE_PATH_MODE";
const FIELDS = ["dev", "ino", "mode", "uid", "gid"];

function unavailable() {
  const error = new Error("Private filesystem path is unavailable.");
  error.name = "PrivatePathError";
  error.code = "PRIVATE_PATH_UNAVAILABLE";
  return error;
}

export function privatePathMode(env = process.env) {
  const mode = env?.[MODE_KEY];
  if (mode === undefined || mode === "strict") return "strict";
  if (mode === "linux-dirfd") return mode;
  throw unavailable();
}

function snapshot(stats) {
  if (!stats?.isDirectory?.() || FIELDS.some((field) => typeof stats[field] !== "bigint")
    || typeof stats.nlink !== "bigint" || stats.nlink < 1n) throw unavailable();
  return Object.freeze(Object.fromEntries(FIELDS.map((field) => [field, stats[field]])));
}

function allowed(stats, uid, gid, final) {
  const mode = stats.mode & 0o7777n;
  if (final) return stats.uid === uid && mode === 0o700n;
  if (stats.uid !== 0n && stats.uid !== uid) return false;
  // A group-writable provider ancestor is traversed through its pinned fd;
  // it never becomes the prefix of a later absolute pathname lookup.
  const stickySystem = stats.uid === 0n && (mode & 0o1000n) !== 0n;
  if ((mode & 0o002n) !== 0n && !stickySystem) return false;
  if ((mode & 0o020n) !== 0n && !stickySystem && !(stats.uid === 0n && stats.gid === gid)) return false;
  return true;
}

async function anchorDirectory(root, internal, requirePrivateRoot) {
  const fs = internal.fs ?? filesystem;
  const platform = internal.platform ?? process.platform;
  const uid = internal.uid ?? process.getuid?.();
  const gid = internal.gid ?? process.getgid?.();
  const handles = [];
  let closed = false, closing;
  const assertOpen = () => { if (closed) throw unavailable(); };

  async function assertReady() {
    try {
      assertOpen();
      let finalStats;
      for (let index = 0; index < handles.length; index += 1) {
        const record = handles[index];
        const stats = await record.handle.stat({ bigint: true });
        const current = snapshot(stats);
        if (FIELDS.some((field) => current[field] !== record.identity[field])
          || !allowed(current, BigInt(uid), BigInt(gid), index === handles.length - 1 && record.final)) throw unavailable();
        finalStats = stats;
        assertOpen();
      }
      if (handles.length === 0) throw unavailable();
      return Object.freeze(Object.assign(Object.create(Object.getPrototypeOf(finalStats)), finalStats));
    } catch { throw unavailable(); }
  }

  async function anchor(filename, final = false) {
    const handle = await fs.open(filename, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const record = { handle, identity: undefined, final };
    handles.push(record);
    record.identity = snapshot(await handle.stat({ bigint: true }));
    if (!allowed(record.identity, BigInt(uid), BigInt(gid), final)) throw unavailable();
    await assertReady();
    return handle;
  }

  async function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      let failed = false;
      for (const { handle } of [...handles].reverse()) {
        try { await handle.close(); } catch { failed = true; }
      }
      if (failed) throw unavailable();
    })();
    return closing;
  }

  try {
    if (platform !== "linux" || !Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0
      || !constants.O_DIRECTORY || !constants.O_NOFOLLOW || !constants.O_NONBLOCK
      || typeof root !== "string" || !root.startsWith("/")
      || root === "/" || root.includes("\\") || /[\x00-\x1f\x7f]/.test(root)
      || path.posix.normalize(root) !== root || root.endsWith("/")
      || root.split("/").slice(1).some((component) => !component || component === "." || component === "..")) throw unavailable();
    if ((await fs.statfs(PROC_DIRECTORY, { bigint: true })).type !== PROC_SUPER_MAGIC) throw unavailable();
    let parent = await anchor("/");
    const components = root.slice(1).split("/");
    for (let index = 0; index < components.length; index += 1) {
      parent = await anchor(`${PROC_DIRECTORY}/${parent.fd}/${components[index]}`, requirePrivateRoot && index === components.length - 1);
    }
    const scope = Object.freeze({
      get path() { assertOpen(); return `${PROC_DIRECTORY}/${handles.at(-1).handle.fd}`; },
      file(name) {
        assertOpen();
        if (typeof name !== "string" || !name || name === "." || name === ".." || /[/\\\x00-\x1f\x7f]/.test(name)) throw unavailable();
        return `${PROC_DIRECTORY}/${handles.at(-1).handle.fd}/${name}`;
      },
      assertReady,
      close,
      async sync() {
        try {
          await assertReady();
          await handles.at(-1).handle.sync();
          await assertReady();
        } catch { throw unavailable(); }
      },
    });
    return {
      scope,
      identities() {
        assertOpen();
        return Object.freeze(handles.map(({ identity: { dev, ino } }) => Object.freeze({ dev, ino })));
      },
    };
  } catch {
    try { await close(); } catch { /* Preserve a fixed opening failure. */ }
    throw unavailable();
  }
}

// The optional second argument is an internal test seam, never configuration.
export async function openPrivateDirectory(root, internal = {}) {
  return (await anchorDirectory(root, internal, true)).scope;
}

export async function inspectDirectoryIdentities(root, internal = {}) {
  const { scope, identities } = await anchorDirectory(root, internal, false);
  let failed = false, failure, result;
  try { await scope.assertReady(); result = identities(); }
  catch { failed = true; failure = unavailable(); }
  finally { try { await scope.close(); } catch { if (!failed) { failed = true; failure = unavailable(); } } }
  if (failed) throw failure;
  return result;
}

// The optional third argument is an internal test seam, never configuration.
export async function withPrivateDirectory(root, callback, internal = {}) {
  if (typeof callback !== "function") throw unavailable();
  const scope = await openPrivateDirectory(root, internal);
  let failed = false, failure, result;
  try {
    // Callback failures belong to the consumer, which owns their public boundary.
    result = await callback(scope);
    await scope.assertReady();
  } catch (error) { failed = true; failure = error; }
  finally { try { await scope.close(); } catch (error) { if (!failed) { failed = true; failure = error; } } }
  if (failed) throw failure;
  return result;
}
