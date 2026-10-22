import { constants } from "node:fs";
import { lstat, realpath, open, mkdir, readdir, link, unlink } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { inspectDirectoryIdentities, openPrivateDirectory, privatePathMode } from "../files/private-directory.mjs";

const MAX_BYTES = 285212672;
const MAX_FILES = 10010;
const JSON_FILES = new Set(["account.json", "inventory.json", "policy.json", "deletion-plan.json"]);
const LINE_FILES = new Set(["messages.jsonl", "library.jsonl"]);
const MEDIA_NAME = /^media\/[0-9a-f]{32}\.jpg$/;
const VIDEO_NAME = /^media\/[0-9a-f]{32}\.mp4$/;
const COUNTS = ["messages", "mediaFiles", "libraryItems", "mediaBytes", "rows", "inventoryCategories", "observations", "affectedCategories", "blockers"];
const VIDEO_COUNTS = ["videoFiles", "videoBytes", "videoLibraryItems"];
const FLAGS = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

export class DataWriterError extends Error {
  constructor() { super("Private data output is unavailable."); this.name = "DataWriterError"; this.code = "DATA_OUTPUT_UNAVAILABLE"; }
}
const fail = () => { throw new DataWriterError(); };
const same = (left, right) => left.dev === right.dev && left.ino === right.ino;
const owned = (stats) => process.getuid === undefined || stats.uid === BigInt(process.getuid());
const absolute = (value) => typeof value === "string" && path.isAbsolute(value) && path.resolve(value) === value && !value.includes("\0");
const inside = (candidate, parent) => candidate === parent || candidate.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
const privateDirectory = (stats) => stats.isDirectory() && !stats.isSymbolicLink() && owned(stats) && (stats.mode & 0o7777n) === 0o700n;
const privateFile = (stats) => stats.isFile() && !stats.isSymbolicLink() && owned(stats) && (stats.mode & 0o7777n) === 0o600n && stats.nlink === 1n;

// JSON values are copied without invoking accessors or toJSON. The destination
// budget also bounds serialization before a file is created.
function encode(object, maximumBytes) {
  let nodes = 1000000, remaining = maximumBytes;
  const spend = (bytes) => { remaining -= bytes; if (remaining < 0) fail(); };
  function copy(value, depth = 0) {
    if (--nodes < 0 || depth > 64) fail();
    if (value === null || typeof value === "boolean") { spend(value === null ? 4 : value ? 4 : 5); return value; }
    if (typeof value === "string") { if (!value.isWellFormed()) fail(); spend(Buffer.byteLength(JSON.stringify(value))); return value; }
    if (typeof value === "number") { if (!Number.isFinite(value)) fail(); spend(String(value).length); return value; }
    if (Array.isArray(value)) {
      if (value.length > nodes || Reflect.ownKeys(value).length !== value.length + 1) fail();
      spend(2 + Math.max(0, value.length - 1));
      return Array.from(value, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail();
        return copy(descriptor.value, depth + 1);
      });
    }
    if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
    const descriptors = Object.getOwnPropertyDescriptors(value), result = Object.create(null), keys = Reflect.ownKeys(descriptors);
    spend(2 + Math.max(0, keys.length - 1));
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (typeof key !== "string" || !key.isWellFormed() || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail();
      spend(Buffer.byteLength(JSON.stringify(key)) + 1); result[key] = copy(descriptor.value, depth + 1);
    }
    return result;
  }
  if (!object || typeof object !== "object" || Array.isArray(object)) fail();
  spend(1); return Buffer.from(JSON.stringify(copy(object)) + "\n");
}

async function ancestry(directory) {
  const result = [];
  let current = path.parse(directory).root;
  for (const component of ["", ...directory.slice(current.length).split(path.sep).filter(Boolean)]) {
    if (component) current = path.join(current, component);
    const stats = await lstat(current, { bigint: true });
    if (!stats.isDirectory() || stats.isSymbolicLink() || process.getuid !== undefined && stats.uid !== 0n && !owned(stats)
      || (stats.mode & 0o022n) !== 0n && !((stats.mode & 0o1000n) !== 0n && stats.uid === 0n)) fail();
    result.push({ name: current, stats });
  }
  if (await realpath(directory) !== directory) fail();
  return result;
}

/** Offline, operator-private output. Linux dirfd mode anchors all output I/O
 * to opened directories; strict mode retains its pathname identity checks.
 * Concurrent changes by the same operator and bind-mounted aliases remain
 * outside this output writer's isolation contract. */
export async function createDataWriter({ output, protectedRoots, maximumBytes = MAX_BYTES, maximumFiles = MAX_FILES, pathMode, video = false } = {}) {
  let rootHandle = null, mediaHandle = null, parentScope = null, mode;
  const records = new Map(); let rootIdentity, mediaIdentity = null, ancestors, protectedIdentities, parentIdentity;
  let totalBytes = 0, failed = false, closed = false, finalized = false, closing = null, chain = Promise.resolve();
  const parent = absolute(output) ? path.dirname(output) : null;
  async function check(verifyHandles = true) {
    if (mode === "linux-dirfd") {
      const parentStats = await parentScope.assertReady(), stats = await lstat(parentScope.file(path.basename(output)), { bigint: true });
      if (!privateDirectory(parentStats) || !same(parentStats, parentIdentity) || !privateDirectory(stats) || !same(stats, rootIdentity)
        || verifyHandles && rootHandle && !same(await rootHandle.stat({ bigint: true }), rootIdentity)) fail();
      if (protectedIdentities.some((protectedRoot) => ancestors.some((item) => same(item.stats, protectedRoot.root)))) fail();
    } else {
      const current = await ancestry(output);
      if (current.length !== ancestors.length || current.some((item, index) => item.name !== ancestors[index].name || !same(item.stats, ancestors[index].stats))
        || !privateDirectory(current.at(-1).stats) || !privateDirectory(current.at(-2).stats) || verifyHandles && rootHandle && !same(await rootHandle.stat({ bigint: true }), rootIdentity)) fail();
      if (protectedIdentities.some((protectedRoot) => current.some((item) => same(item.stats, protectedRoot.root)))) fail();
    }
    if (mediaIdentity) {
      const stats = await lstat(filename("media"), { bigint: true });
      if (!privateDirectory(stats) || !same(stats, mediaIdentity) || verifyHandles && mediaHandle && !same(await mediaHandle.stat({ bigint: true }), mediaIdentity)) fail();
    }
  }
  function run(action) {
    const task = chain.then(async () => {
      try { if (closed || failed || finalized) fail(); await check(); const result = await action(); await check(); return result; }
      catch { failed = true; throw new DataWriterError(); }
    });
    chain = task.catch(() => {}); return task;
  }
  function room(bytes, newFile = false) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > maximumBytes - totalBytes || newFile && records.size + 1 > maximumFiles) fail();
  }
  const rootPath = () => mode === "linux-dirfd"
    ? rootHandle && rootHandle.fd >= 0 ? `/proc/self/fd/${rootHandle.fd}` : parentScope.file(path.basename(output)) : output;
  const filename = (name) => mode === "linux-dirfd" && name.startsWith("media/") && mediaHandle
    ? `/proc/self/fd/${mediaHandle.fd}/${name.slice(6)}` : path.join(rootPath(), name);
  async function verify(record, handle = record.handle) {
    const local = await lstat(filename(record.name), { bigint: true });
    if (!privateFile(local) || !same(local, record.identity) || local.size !== BigInt(record.bytes)) fail();
    if (handle) { const stats = await handle.stat({ bigint: true }); if (!privateFile(stats) || !same(stats, local) || stats.size !== local.size) fail(); }
  }
  async function writeBytes(handle, bytes, position = 0, synchronize = true, signal) {
    let offset = 0;
    while (offset < bytes.length) {
      if (closed || signal?.aborted) fail();
      const result = await handle.write(bytes, offset, bytes.length - offset, position + offset);
      if (!Number.isSafeInteger(result.bytesWritten) || result.bytesWritten < 1 || result.bytesWritten > bytes.length - offset) fail();
      offset += result.bytesWritten;
    }
    if (synchronize) await handle.sync();
  }
  async function mediaDirectory(name) {
    if (name.startsWith("media/") && !mediaHandle) {
      await mkdir(filename("media"), { mode: 0o700 });
      const stats = await lstat(filename("media"), { bigint: true }); if (!privateDirectory(stats)) fail();
      mediaHandle = await open(filename("media"), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      if (!same(stats, await mediaHandle.stat({ bigint: true }))) fail(); mediaIdentity = stats; await check();
    }
  }
  async function create(name, bytes, keepOpen = false) {
    if (records.has(name)) fail(); room(bytes.length, true);
    await mediaDirectory(name);
    let handle;
    try {
      handle = await open(filename(name), FLAGS, 0o600);
      const identity = await handle.stat({ bigint: true }); if (!privateFile(identity)) fail();
      await check();
      const record = { name, bytes: 0, hash: createHash("sha256"), identity, handle: keepOpen ? handle : null };
      records.set(name, record); await writeBytes(handle, bytes);
      record.bytes = bytes.length; record.hash.update(bytes); totalBytes += bytes.length;
      await verify(record, handle);
      if (keepOpen) handle = null;
    } finally { await handle?.close(); }
  }
  async function createVideo(name, source, options) {
    if (typeof name !== "string" || name.length !== 42 || !VIDEO_NAME.test(name)
      || typeof source?.[Symbol.asyncIterator] !== "function" || !options || typeof options !== "object" || Array.isArray(options)
      || Object.keys(options).some((key) => !["bytes", "signal"].includes(key))) fail();
    const { bytes, signal } = options;
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 104857600
      || signal !== undefined && !(signal instanceof AbortSignal) || signal?.aborted || closed || records.has(name)) fail();
    room(bytes, true); await mediaDirectory(name);
    let handle;
    try {
      if (signal?.aborted || closed) fail();
      handle = await open(filename(name), FLAGS, 0o600);
      const identity = await handle.stat({ bigint: true }); if (!privateFile(identity)) fail();
      await check();
      const record = { name, bytes: 0, hash: createHash("sha256"), identity, handle: null };
      records.set(name, record);
      for await (const chunk of source) {
        if (signal?.aborted || closed || !Buffer.isBuffer(chunk) || chunk.length < 1 || chunk.length > 262144 || chunk.length > bytes - record.bytes) fail();
        room(chunk.length); await check(); await verify(record, handle);
        await writeBytes(handle, chunk, record.bytes, false, signal);
        record.hash.update(chunk); record.bytes += chunk.length; totalBytes += chunk.length;
        await check(); await verify(record, handle);
        if (signal?.aborted || closed) fail();
      }
      if (record.bytes !== bytes || signal?.aborted || closed) fail();
      await handle.sync(); await check(); await verify(record, handle);
      if (signal?.aborted || closed) fail();
    } finally { await handle?.close(); }
  }
  async function cleanOwned(name, identity) {
    try { await check(false); const stats = await lstat(filename(name), { bigint: true }); if (same(stats, identity) && stats.isFile()) await unlink(filename(name)); }
    catch { /* Preserve an uncertain private artifact rather than delete another file. */ }
  }
  try {
    if (!absolute(output) || output === path.parse(output).root || !Array.isArray(protectedRoots) || protectedRoots.length < 1 || protectedRoots.length > 32
      || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_BYTES
      || !Number.isSafeInteger(maximumFiles) || maximumFiles < 1 || maximumFiles > MAX_FILES || typeof video !== "boolean" || !constants.O_NOFOLLOW || !constants.O_DIRECTORY) fail();
    mode = pathMode === undefined ? privatePathMode() : privatePathMode({ JESSIEMESSAGE_PRIVATE_PATH_MODE: pathMode });
    let parentAncestors;
    if (mode === "linux-dirfd") {
      parentScope = await openPrivateDirectory(parent); parentIdentity = await parentScope.assertReady();
      parentAncestors = (await inspectDirectoryIdentities(parent)).map((stats) => ({ stats }));
      if (!same(parentAncestors.at(-1).stats, parentIdentity)) fail();
    } else parentAncestors = await ancestry(parent);
    if (!privateDirectory(mode === "linux-dirfd" ? parentIdentity : parentAncestors.at(-1).stats)) fail();
    protectedIdentities = [];
    for (const protectedRoot of protectedRoots) {
      if (!absolute(protectedRoot) || inside(output, protectedRoot) || inside(protectedRoot, output)) fail();
      const protectedAncestors = mode === "linux-dirfd" ? (await inspectDirectoryIdentities(protectedRoot)).map((stats) => ({ stats })) : await ancestry(protectedRoot);
      if (parentAncestors.some((item) => same(item.stats, protectedAncestors.at(-1).stats))) fail();
      protectedIdentities.push({ root: protectedAncestors.at(-1).stats, ancestors: protectedAncestors });
    }
    const initialRoot = mode === "linux-dirfd" ? parentScope.file(path.basename(output)) : output;
    await mkdir(initialRoot, { mode: 0o700 });
    rootIdentity = await lstat(initialRoot, { bigint: true }); if (!privateDirectory(rootIdentity)) fail();
    if (protectedIdentities.some((item) => item.ancestors.some((ancestor) => same(ancestor.stats, rootIdentity)))) fail();
    ancestors = [...parentAncestors, { name: output, stats: rootIdentity }];
    rootHandle = await open(initialRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); await check();
  } catch { await mediaHandle?.close().catch(() => {}); await rootHandle?.close().catch(() => {}); await parentScope?.close().catch(() => {}); throw new DataWriterError(); }

  return {
    empty(name) { return run(async () => { if (!LINE_FILES.has(name)) fail(); await create(name, Buffer.alloc(0), true); }); },
    json(name, object) { return run(async () => { if (!JSON_FILES.has(name)) fail(); await create(name, encode(object, maximumBytes - totalBytes)); }); },
    line(name, object) { return run(async () => {
      if (!LINE_FILES.has(name)) fail(); const record = records.get(name); if (!record?.handle) fail();
      const bytes = encode(object, maximumBytes - totalBytes); room(bytes.length); await verify(record);
      await writeBytes(record.handle, bytes, record.bytes); record.hash.update(bytes); record.bytes += bytes.length; totalBytes += bytes.length; await verify(record);
    }); },
    media(name, bytes) { return run(async () => { if (typeof name !== "string" || !MEDIA_NAME.test(name) || !Buffer.isBuffer(bytes)) fail(); await create(name, bytes); }); },
    ...(video ? { video(name, source, options = {}) { return run(() => createVideo(name, source, options)); } } : {}),
    finalize(summary) { return run(async () => {
      if (!summary || typeof summary !== "object" || Array.isArray(summary) || ![Object.prototype, null].includes(Object.getPrototypeOf(summary))) fail();
      const counts = {};
      for (const name of video ? [...COUNTS, ...VIDEO_COUNTS] : COUNTS) {
        const descriptor = Object.getOwnPropertyDescriptor(summary, name); if (!descriptor) continue;
        if (!Object.hasOwn(descriptor, "value") || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) fail(); counts[name] = descriptor.value;
      }
      const expectedRoot = new Set([...records.keys()].map((name) => name.split("/")[0]));
      const rootNames = await readdir(rootPath()); if (rootNames.length !== expectedRoot.size || rootNames.some((name) => !expectedRoot.has(name))) fail();
      if (mediaIdentity) {
        const expectedMedia = new Set([...records.keys()].filter((name) => name.startsWith("media/")).map((name) => name.slice(6)));
        const mediaNames = await readdir(filename("media")); if (mediaNames.length !== expectedMedia.size || mediaNames.some((name) => !expectedMedia.has(name))) fail();
      }
      const entries = [];
      for (const record of records.values()) {
        await check(); await verify(record); let handle = record.handle;
        try {
          // Bounded reads also detect same-inode alteration before completion.
          handle = await open(filename(record.name), constants.O_RDONLY | constants.O_NOFOLLOW); await verify(record, handle);
          const hash = createHash("sha256"), chunk = Buffer.alloc(65536); let position = 0;
          try { while (position < record.bytes) { const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, record.bytes - position), position); if (bytesRead < 1) fail(); hash.update(chunk.subarray(0, bytesRead)); position += bytesRead; } }
          finally { chunk.fill(0); }
          if (hash.digest("hex") !== record.hash.copy().digest("hex")) fail(); await handle.sync(); await verify(record, handle);
        } finally { if (handle && handle !== record.handle) await handle.close(); }
        if (record.handle) { await record.handle.sync(); await record.handle.close(); record.handle = null; }
        entries.push({ name: record.name, bytes: record.bytes, sha256: record.hash.copy().digest("hex") });
      }
      entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
      const manifest = encode({ format: "jessiemessage-private-export", version: video ? 2 : 1, status: "complete", counts, entries }, maximumBytes - totalBytes);
      room(manifest.length, true);
      if (mediaHandle) { await mediaHandle.sync(); await mediaHandle.close(); mediaHandle = null; }
      await rootHandle.sync(); await check();
      const temporary = `.COMPLETE-${randomBytes(16).toString("hex")}.tmp`; let handle, identity, published = false;
      try {
        handle = await open(filename(temporary), FLAGS, 0o600); identity = await handle.stat({ bigint: true }); if (!privateFile(identity)) fail();
        await writeBytes(handle, manifest); await handle.close(); handle = null; await check(); if (closed) fail();
        await link(filename(temporary), filename("COMPLETE.json")); published = true;
        await unlink(filename(temporary)); await check();
        const marker = await lstat(filename("COMPLETE.json"), { bigint: true }); if (!privateFile(marker) || !same(marker, identity)) fail();
        await rootHandle.sync(); await check(); if (closed) fail();
        await rootHandle.close(); rootHandle = null;
        if (closed) fail(); finalized = true; totalBytes += manifest.length;
        return { files: records.size + 1, totalBytes };
      } catch {
        if (published && identity) await cleanOwned("COMPLETE.json", identity);
        if (identity) await cleanOwned(temporary, identity);
        await rootHandle?.sync().catch(() => {}); fail();
      } finally { await handle?.close(); }
    }); },
    close() {
      if (closing) return closing; closed = true;
      closing = chain.then(async () => {
        let bad = false;
        for (const handle of [...records.values()].map((record) => record.handle).filter(Boolean)) { try { await handle.sync(); } catch { bad = true; } try { await handle.close(); } catch { bad = true; } }
        for (const handle of [mediaHandle, rootHandle].filter(Boolean)) { try { await handle.sync(); } catch { bad = true; } try { await handle.close(); } catch { bad = true; } }
        try { await parentScope?.close(); } catch { bad = true; }
        if (bad) { failed = true; throw new DataWriterError(); }
      });
      return closing;
    }
  };
}
