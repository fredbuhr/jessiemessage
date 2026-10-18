import { constants } from "node:fs";
import * as filesystem from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privatePathMode, withPrivateDirectory } from "../files/private-directory.mjs";

const CHECKOUT = fileURLToPath(new URL("../../", import.meta.url));
const FS_METHODS = ["lstat", "realpath", "mkdir", "open", "rename", "link", "unlink", "rmdir"];
const BODY_BYTES = 1024;
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted").get;
export const PLATFORM_CHECK_NAMES = Object.freeze(["node_runtime", "sharp_jpeg", "scratch_filesystem"]);

export class PlatformPreflightError extends Error {
  constructor() { super("Local platform checks could not be completed."); this.name = "PlatformPreflightError"; this.code = "PREFLIGHT_PLATFORM_INVALID"; }
}
const fail = () => { throw new PlatformPreflightError(); };
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
const absolute = (value) => typeof value === "string" && value.length > 0 && value.length <= 4096
  && path.isAbsolute(value) && path.resolve(value) === value && !/[\x00-\x1f\x7f]/.test(value);
const same = (left, right) => left.dev === right.dev && left.ino === right.ino;
const owned = (stats) => process.getuid === undefined || stats.uid === BigInt(process.getuid());
const privateDirectory = (stats) => stats.isDirectory() && !stats.isSymbolicLink() && owned(stats) && (stats.mode & 0o7777n) === 0o700n;
const privateFile = (stats, links = 1n) => stats.isFile() && owned(stats) && (stats.mode & 0o7777n) === 0o600n && stats.nlink === links;
const checkpoint = (signal) => { if (signal !== undefined && signalAborted.call(signal)) fail(); };

function plain(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !keys.includes(key)
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value"))) fail();
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function options(value) {
  const { scratch = null, mediaRoot = null, pathMode } = plain(value, ["scratch", "mediaRoot", "pathMode"]);
  const mode = pathMode === undefined ? privatePathMode() : privatePathMode({ JESSIEMESSAGE_PRIVATE_PATH_MODE: pathMode });
  if (mediaRoot !== null && !absolute(mediaRoot) || scratch !== null && (!absolute(scratch)
    || scratch === path.parse(scratch).root || inside(scratch, CHECKOUT) || inside(CHECKOUT, scratch)
    || mediaRoot !== null && (inside(scratch, mediaRoot) || inside(mediaRoot, scratch)))) fail();
  return { scratch, mediaRoot, pathMode: mode };
}
function adapters(value) {
  const input = plain(value, ["nodeVersion", "loadSharp", "fs", "signal"]);
  if (input.nodeVersion !== undefined && typeof input.nodeVersion !== "string"
    || input.loadSharp !== undefined && typeof input.loadSharp !== "function") fail();
  const overrides = input.fs === undefined ? {} : plain(input.fs, FS_METHODS);
  if (Object.values(overrides).some((method) => typeof method !== "function")) fail();
  if (input.signal !== undefined) signalAborted.call(input.signal);
  return { nodeVersion: input.nodeVersion ?? process.versions.node,
    loadSharp: input.loadSharp ?? (() => import("sharp").then((module) => module.default)), fs: { ...filesystem, ...overrides }, signal: input.signal };
}

async function jpegProbe(loadSharp, signal) {
  let source, full, thumbnail;
  try {
    checkpoint(signal); const sharp = await loadSharp(); checkpoint(signal); if (typeof sharp !== "function") fail();
    source = await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 90, g: 70, b: 80 } } }).jpeg().toBuffer();
    checkpoint(signal);
    const settings = { failOn: "warning", limitInputPixels: 1024, sequentialRead: true, animated: false };
    full = await sharp(source, settings).rotate().resize({ width: 16, height: 16, fit: "inside", withoutEnlargement: true })
      .flatten({ background: { r: 245, g: 238, b: 242 } }).toColourspace("srgb").jpeg({ quality: 85, progressive: false }).toBuffer();
    checkpoint(signal);
    thumbnail = await sharp(full, settings).resize({ width: 8, height: 8, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: false }).toBuffer();
    checkpoint(signal);
    for (const [bytes, width, height] of [[full, 16, 12], [thumbnail, 8, 6]]) {
      if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes.length > 65536 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail();
      const metadata = await sharp(bytes, settings).metadata();
      checkpoint(signal);
      if (metadata.format !== "jpeg" || metadata.width !== width || metadata.height !== height || (metadata.pages ?? 1) !== 1
        || metadata.exif !== undefined || metadata.xmp !== undefined || metadata.iptc !== undefined) fail();
    }
    return true;
  } catch { return false; }
  finally { for (const bytes of [source, full, thumbnail]) if (Buffer.isBuffer(bytes)) bytes.fill(0); }
}

/** A disposable, explicitly selected directory only. No production root is
 * opened or listed. Portable identity checks are not an openat guarantee or
 * protection against a malicious same-UID operator or all bind-mount aliases. */
async function scratchProbe(scratch, fs, signal, anchor = null) {
  let parentHandle, rootHandle, rootIdentity, parentIdentity, ancestors;
  const files = new Map(), handles = new Set(), body = Buffer.alloc(BODY_BYTES, 0x5a);
  let passed = false, cleaned = true, cleaning = false;
  const progress = () => { if (!cleaning) checkpoint(signal); };
  const parent = path.dirname(scratch), filename = (name) => path.join(scratch, name);
  async function ancestry(directory) {
    progress();
    if (anchor !== null) {
      const stats = await anchor.assertReady(); progress();
      return [{ path: anchor.path, stats }];
    }
    const result = []; let current = path.parse(directory).root;
    for (const component of ["", ...directory.slice(current.length).split(path.sep).filter(Boolean)]) {
      if (component) current = path.join(current, component);
      const stats = await fs.lstat(current, { bigint: true });
      progress();
      if (!stats.isDirectory() || stats.isSymbolicLink() || process.getuid !== undefined && stats.uid !== 0n && !owned(stats)
        || (stats.mode & 0o022n) !== 0n && !((stats.mode & 0o1000n) !== 0n && stats.uid === 0n)) fail();
      result.push({ path: current, stats });
    }
    if (await fs.realpath(directory) !== directory) fail(); progress(); return result;
  }
  async function checkParents() {
    const current = await ancestry(parent);
    if (!ancestors || current.length !== ancestors.length || current.some((entry, index) => entry.path !== ancestors[index].path || !same(entry.stats, ancestors[index].stats))
      || !privateDirectory(current.at(-1).stats)) fail();
  }
  async function checkRoot(handle = true) {
    await checkParents(); const stats = await fs.lstat(scratch, { bigint: true });
    progress();
    if (!rootIdentity || !privateDirectory(stats) || !same(stats, rootIdentity)
      || handle && rootHandle && !same(await rootHandle.stat({ bigint: true }), rootIdentity)) fail();
    progress();
  }
  async function checkFile(name, identity, links = 1n, size = null) {
    await checkRoot(); const stats = await fs.lstat(filename(name), { bigint: true });
    progress();
    if (!privateFile(stats, links) || !same(stats, identity) || size !== null && stats.size !== BigInt(size)) fail();
    return stats;
  }
  async function create(name) {
    await checkRoot();
    const handle = await fs.open(filename(name), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    handles.add(handle);
    const identity = await handle.stat({ bigint: true }); files.set(name, identity);
    progress();
    if (!privateFile(identity)) fail(); await checkFile(name, identity); return { handle, identity };
  }
  async function close(handle) { await handle.close(); handles.delete(handle); }
  try {
    if (!constants.O_NOFOLLOW || !constants.O_DIRECTORY || !constants.O_NONBLOCK) fail();
    ancestors = await ancestry(parent); parentIdentity = ancestors.at(-1).stats;
    if (!privateDirectory(parentIdentity)) fail();
    // The procfs FD itself is a magic link; resolve its anchored "." entry
    // instead, retaining O_NOFOLLOW on the final directory entry.
    parentHandle = await fs.open(anchor === null ? parent : `${parent}/.`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    if (!same(await parentHandle.stat({ bigint: true }), parentIdentity)) fail(); progress();
    // mkdir has no recursive option and refuses every existing destination.
    await fs.mkdir(scratch, { mode: 0o700 });
    rootIdentity = await fs.lstat(scratch, { bigint: true }); if (!privateDirectory(rootIdentity)) fail();
    progress();
    rootHandle = await fs.open(scratch, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    await checkRoot(); await parentHandle.sync();
    const first = await create("probe-staging");
    await first.handle.writeFile(body); progress(); await first.handle.sync(); progress();
    await checkFile("probe-staging", first.identity, 1n, body.length); await close(first.handle);
    progress();
    // rename may overwrite: its destination is therefore another file created
    // exclusively by this probe, never an arbitrary existing filename.
    const destination = await create("probe-renamed"); await destination.handle.sync(); await close(destination.handle);
    await checkFile("probe-staging", first.identity, 1n, body.length); await checkFile("probe-renamed", destination.identity, 1n, 0);
    await fs.rename(filename("probe-staging"), filename("probe-renamed")); files.delete("probe-staging"); files.set("probe-renamed", first.identity);
    progress();
    await rootHandle.sync(); await checkFile("probe-renamed", first.identity, 1n, body.length);
    const reader = await fs.open(filename("probe-renamed"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); handles.add(reader);
    const before = await reader.stat({ bigint: true });
    progress();
    if (!privateFile(before) || !same(before, first.identity) || before.size !== BigInt(body.length)) fail();
    const read = Buffer.alloc(body.length);
    try {
      let offset = 0;
      while (offset < read.length) {
        const { bytesRead } = await reader.read(read, offset, read.length - offset, offset);
        progress();
        if (!Number.isSafeInteger(bytesRead) || bytesRead < 1 || bytesRead > read.length - offset) fail(); offset += bytesRead;
      }
      const after = await reader.stat({ bigint: true });
      progress();
      if (!privateFile(after) || !same(before, after) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || !read.equals(body)) fail();
    } finally { read.fill(0); }
    await close(reader);
    await checkFile("probe-renamed", first.identity, 1n, body.length);
    await fs.link(filename("probe-renamed"), filename("probe-published")); files.set("probe-published", first.identity);
    progress();
    await checkFile("probe-renamed", first.identity, 2n, body.length); await checkFile("probe-published", first.identity, 2n, body.length);
    await fs.unlink(filename("probe-renamed")); files.delete("probe-renamed");
    progress();
    await rootHandle.sync(); await checkFile("probe-published", first.identity, 1n, body.length);
    passed = true;
  } catch { passed = false; }
  finally {
    // Cancellation stops further probe operations, never its identity-checked cleanup.
    cleaning = true;
    body.fill(0);
    for (const handle of handles) { try { await handle.close(); } catch { cleaned = false; } }
    if (rootIdentity) {
      for (const [name, identity] of files) {
        try {
          await checkRoot(); let stats;
          try { stats = await fs.lstat(filename(name), { bigint: true }); } catch (error) { if (error?.code === "ENOENT") continue; throw error; }
          if (!stats.isFile() || !owned(stats) || !same(stats, identity)) fail(); await fs.unlink(filename(name));
        } catch { cleaned = false; }
      }
      try { await checkRoot(); await rootHandle?.sync(); } catch { cleaned = false; }
    }
    try { await rootHandle?.close(); } catch { cleaned = false; } rootHandle = null;
    if (rootIdentity) {
      try { await checkRoot(false); await fs.rmdir(scratch); await checkParents(); await parentHandle.sync(); } catch { cleaned = false; }
    }
    try { await parentHandle?.close(); } catch { cleaned = false; }
  }
  return passed && cleaned && (signal === undefined || !signalAborted.call(signal));
}

/** Local capability evidence only: no SQL, network, listener, SMTP or workers.
 * No result certifies host quotas, redeployment persistence or future durability. */
export async function inspectPlatform(input = {}, dependencies = {}) {
  const checks = PLATFORM_CHECK_NAMES.map((name) => ({ name, status: "not_checked" }));
  let config, deps;
  try { config = options(input); deps = adapters(dependencies); }
  catch { checks[2].status = "fail"; return { valid: false, checks }; }
  checks[0].status = /^24\.(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})$/.test(deps.nodeVersion) ? "pass" : "fail";
  checks[1].status = await jpegProbe(deps.loadSharp, deps.signal) ? "pass" : "fail";
  if (config.scratch !== null) {
    try {
      checkpoint(deps.signal);
      const passed = config.pathMode === "linux-dirfd"
        ? await withPrivateDirectory(path.dirname(config.scratch), (anchor) => scratchProbe(anchor.file(path.basename(config.scratch)), deps.fs, deps.signal, anchor))
        : await scratchProbe(config.scratch, deps.fs, deps.signal);
      checks[2].status = passed ? "pass" : "fail";
    } catch { checks[2].status = "fail"; }
  }
  return { valid: checks.every((check) => check.status !== "fail"), checks };
}
