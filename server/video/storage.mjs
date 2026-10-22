import { constants } from "node:fs";
import { lstat, realpath, open as openFile, link, unlink, statfs, readdir, opendir } from "node:fs/promises";
import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openPrivateDirectory, privatePathMode } from "../files/private-directory.mjs";

export const VIDEO_BLOCK_BYTES = 262144;
export const MAX_VIDEO_BYTES = 104857600;
const MAGIC = Buffer.from("JMVIDv1\0", "ascii");
const RAW_HEADER_BYTES = 32;
const HEADER_BYTES = RAW_HEADER_BYTES + 16;
const NAMESPACE = Buffer.from("jessiemessage:video-file:v1:\0", "ascii");
const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export class VideoStorageError extends Error {
  constructor(code = "VIDEO_UNAVAILABLE", published = false) {
    super("Private video storage is unavailable.");
    this.name = "VideoStorageError"; this.code = code;
    this.published = published;
  }
}
const input = () => { throw new VideoStorageError("VIDEO_INPUT"); };
function identifier(value, size) { if (!Buffer.isBuffer(value) || value.length !== size) input(); return Buffer.from(value); }
function length(value) { if (!Number.isSafeInteger(value) || value < 1 || value > MAX_VIDEO_BYTES) input(); return value; }
function abort(signal) { if (signal?.aborted) throw new VideoStorageError("VIDEO_ABORTED"); }
function checkSignal(signal) { if (signal !== undefined && !(signal instanceof AbortSignal)) input(); }
const inside = (candidate, parent) => candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
const owner = (stats) => process.getuid === undefined || stats.uid === BigInt(process.getuid());
const safeFile = (stats) => stats.isFile() && owner(stats) && (stats.mode & 0o7777n) === 0o600n && stats.nlink === 1n;
const unchanged = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
function wrapped(error, published = false) {
  if (error instanceof VideoStorageError && !published) return error;
  return new VideoStorageError(error instanceof VideoStorageError ? error.code : "VIDEO_UNAVAILABLE", published || error?.published === true);
}

export function videoStoredBytes(bytes) { return HEADER_BYTES + length(bytes) + Math.ceil(bytes / VIDEO_BLOCK_BYTES) * 16; }
function nonce(header, index) { const value = Buffer.alloc(12); header.copy(value, 0, 20, 28); value.writeUInt32BE(index, 8); return value; }
function fileKey(secret, assetId, storageKey, header) {
  return createHmac("sha256", secret).update(NAMESPACE).update("key\0", "ascii").update(assetId).update(storageKey).update(header.subarray(20, 32)).digest();
}
function aad(assetId, storageKey, header, index) {
  const position = Buffer.alloc(4); position.writeUInt32BE(index);
  return Buffer.concat([NAMESPACE, assetId, storageKey, header, position]);
}
function headerTag(key, assetId, storageKey, header) {
  const cipher = createCipheriv("aes-256-gcm", key, nonce(header, 0xffffffff), { authTagLength: 16 });
  cipher.setAAD(aad(assetId, storageKey, header, 0xffffffff)); cipher.final(); return cipher.getAuthTag();
}
function authenticateHeader(key, assetId, storageKey, header, tag) {
  const decipher = createDecipheriv("aes-256-gcm", key, nonce(header, 0xffffffff), { authTagLength: 16 });
  decipher.setAAD(aad(assetId, storageKey, header, 0xffffffff)); decipher.setAuthTag(tag); decipher.final();
}
async function readExactly(handle, size, position) {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) { const result = await handle.read(bytes, offset, size - offset, position + offset); if (!result.bytesRead) throw new VideoStorageError(); offset += result.bytesRead; }
  return bytes;
}
async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.length) { const result = await handle.write(bytes, offset, bytes.length - offset); if (!result.bytesWritten) throw new VideoStorageError(); offset += result.bytesWritten; }
}
async function nextChunk(iterator, signal) {
  abort(signal);
  if (!signal) return iterator.next();
  let listener;
  const cancelled = new Promise((_, reject) => { listener = () => reject(new VideoStorageError("VIDEO_ABORTED")); signal.addEventListener("abort", listener, { once: true }); });
  try { return await Promise.race([iterator.next(), cancelled]); }
  finally { signal.removeEventListener("abort", listener); }
}

/** Dedicated transport storage. No production media directory or route uses it in lot 6. */
export async function createVideoStorage({ root, key, pathMode = privatePathMode() } = {}) {
  if (typeof root !== "string" || !path.isAbsolute(root) || root !== path.resolve(root) || root === path.parse(root).root
    || /[\\\x00-\x1f\x7f]/.test(root) || inside(root, CHECKOUT) || inside(CHECKOUT, root) || !["strict", "linux-dirfd"].includes(pathMode)) input();
  const secret = identifier(key, 32);
  let identity;

  async function strictRoot() {
    let current = path.parse(root).root;
    for (const part of root.slice(current.length).split(path.sep)) {
      current = path.join(current, part); const stats = await lstat(current, { bigint: true });
      if (!stats.isDirectory() || stats.isSymbolicLink() || process.getuid !== undefined && stats.uid !== 0n && !owner(stats)
        || (stats.mode & 0o022n) !== 0n && (stats.mode & 0o1000n) === 0n) throw new VideoStorageError();
    }
    if (await realpath(root) !== root) throw new VideoStorageError();
  }
  async function strictDirectory() {
    let handle, closing;
    try {
      await strictRoot(); handle = await openFile(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const initial = await handle.stat({ bigint: true });
      if (!initial.isDirectory() || !owner(initial) || (initial.mode & 0o7777n) !== 0o700n) throw new VideoStorageError();
      async function assertReady() {
        if (closing) throw new VideoStorageError(); await strictRoot();
        const named = await lstat(root, { bigint: true }), opened = await handle.stat({ bigint: true });
        for (const stats of [named, opened]) if (!stats.isDirectory() || !owner(stats) || (stats.mode & 0o7777n) !== 0o700n || stats.dev !== initial.dev || stats.ino !== initial.ino) throw new VideoStorageError();
        return opened;
      }
      await assertReady();
      return Object.freeze({ path: root, file: (name) => path.join(root, name), assertReady,
        async sync() { await assertReady(); await handle.sync(); await assertReady(); },
        close() { closing ??= handle.close(); return closing; } });
    } catch (error) { await handle?.close().catch(() => {}); throw error; }
  }
  async function directory() {
    let scope;
    try {
      // The hosted Linux mode pins the entire ancestry for each operation,
      // including streams. Strict retains the existing portable path policy.
      scope = pathMode === "strict" ? await strictDirectory() : await openPrivateDirectory(root);
      const stats = await scope.assertReady();
      if (identity && (stats.dev !== identity.dev || stats.ino !== identity.ino)) throw new VideoStorageError();
      identity ??= { dev: stats.dev, ino: stats.ino };
      return scope;
    } catch (error) { await scope?.close().catch(() => {}); throw wrapped(error); }
  }
  const initial = await directory(); await initial.close();
  const filename = (storageKey) => `${storageKey.toString("hex")}.video.enc`;
  async function privateFile(name) {
    const handle = await openFile(name, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { const stats = await handle.stat({ bigint: true }); if (!safeFile(stats)) throw new VideoStorageError(); return { handle, stats }; }
    catch (error) { await handle.close(); throw error; }
  }

  async function put({ assetId: rawAsset, storageKey: rawStorage, bytes, source, signal } = {}) {
    let scope, handle, staging, iterator, fileSecret, block, failure, published = false, completed = false, stagingCreated = false, stagingUncertain = false;
    try {
      const assetId = identifier(rawAsset, 16), storageKey = identifier(rawStorage, 32); length(bytes); checkSignal(signal); abort(signal);
      if (!source || typeof source[Symbol.asyncIterator] !== "function") input();
      scope = await directory(); abort(signal);
      staging = scope.file(`.${storageKey.toString("hex")}.video.${randomBytes(16).toString("hex")}.tmp`);
      try { handle = await openFile(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600); stagingCreated = true; }
      catch (error) { stagingUncertain = error?.code !== "EEXIST"; throw error; }
      if (!safeFile(await handle.stat({ bigint: true }))) throw new VideoStorageError();
      const header = Buffer.alloc(RAW_HEADER_BYTES); MAGIC.copy(header); header.writeUInt32BE(VIDEO_BLOCK_BYTES, 8); header.writeBigUInt64BE(BigInt(bytes), 12); randomBytes(12).copy(header, 20);
      fileSecret = fileKey(secret, assetId, storageKey, header);
      await writeAll(handle, header); await writeAll(handle, headerTag(fileSecret, assetId, storageKey, header));
      const digest = createHash("sha256"); block = Buffer.allocUnsafe(VIDEO_BLOCK_BYTES);
      let filled = 0, received = 0, index = 0;
      async function writeBlock() {
        abort(signal); await scope.assertReady();
        const cipher = createCipheriv("aes-256-gcm", fileSecret, nonce(header, index), { authTagLength: 16 });
        cipher.setAAD(aad(assetId, storageKey, header, index));
        const ciphertext = cipher.update(block.subarray(0, filled)); const tail = cipher.final();
        await writeAll(handle, ciphertext); if (tail.length) await writeAll(handle, tail); await writeAll(handle, cipher.getAuthTag());
        block.fill(0, 0, filled); filled = 0; index += 1;
      }
      iterator = source[Symbol.asyncIterator]();
      while (true) {
        const next = await nextChunk(iterator, signal); abort(signal);
        if (next.done) { completed = true; break; }
        const chunk = next.value;
        if (!Buffer.isBuffer(chunk) || received + chunk.length > bytes) input();
        received += chunk.length; digest.update(chunk);
        for (let offset = 0; offset < chunk.length;) {
          const count = Math.min(VIDEO_BLOCK_BYTES - filled, chunk.length - offset);
          chunk.copy(block, filled, offset, offset + count); filled += count; offset += count;
          if (filled === VIDEO_BLOCK_BYTES) await writeBlock();
        }
      }
      if (received !== bytes) input(); if (filled) await writeBlock();
      abort(signal); await handle.sync(); await handle.close(); handle = undefined; await scope.assertReady(); abort(signal);
      try { await link(staging, scope.file(filename(storageKey))); published = true; }
      catch (error) { if (error?.code !== "EEXIST") published = true; throw error; }
      await unlink(staging); staging = undefined; await scope.sync();
      return { bytes, storedBytes: videoStoredBytes(bytes), digest: digest.digest() };
    } catch (error) { failure = wrapped(error, published); throw failure; }
    finally {
      block?.fill(0); fileSecret?.fill(0);
      if (!completed && iterator?.return) Promise.resolve().then(() => iterator.return()).catch(() => {});
      let cleanupConfirmed = !published && !stagingCreated && !stagingUncertain;
      try { await handle?.close(); } catch { stagingUncertain = true; }
      if (stagingCreated && staging && scope) {
        try { await unlink(staging); await scope.sync(); cleanupConfirmed = !published && !stagingUncertain; }
        catch { cleanupConfirmed = false; }
      }
      try { await scope?.close(); } catch (error) { cleanupConfirmed = false; if (!failure) { failure = wrapped(error, published); failure.cleanupConfirmed = false; throw failure; } }
      if (failure) { failure.published = published; failure.cleanupConfirmed = cleanupConfirmed; }
    }
  }

  async function open({ assetId: rawAsset, storageKey: rawStorage } = {}) {
    const assetId = identifier(rawAsset, 16), storageKey = identifier(rawStorage, 32);
    let scope, handle, initialStats, fileSecret, header, bytes, closed = false, started = false, closing;
    async function close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => { let failure; try { await handle?.close(); } catch (error) { failure = error; } try { await scope?.close(); } catch (error) { failure ??= error; } fileSecret?.fill(0); if (failure) throw wrapped(failure); })();
      return closing;
    }
    try {
      scope = await directory(); ({ handle, stats: initialStats } = await privateFile(scope.file(filename(storageKey))));
      if (initialStats.size < BigInt(videoStoredBytes(1)) || initialStats.size > BigInt(videoStoredBytes(MAX_VIDEO_BYTES))) throw new VideoStorageError();
      const envelope = await readExactly(handle, HEADER_BYTES, 0); header = envelope.subarray(0, RAW_HEADER_BYTES);
      if (!header.subarray(0, 8).equals(MAGIC) || header.readUInt32BE(8) !== VIDEO_BLOCK_BYTES) throw new VideoStorageError();
      const size = header.readBigUInt64BE(12); if (size < 1n || size > BigInt(MAX_VIDEO_BYTES)) throw new VideoStorageError(); bytes = Number(size);
      if (initialStats.size !== BigInt(videoStoredBytes(bytes))) throw new VideoStorageError();
      fileSecret = fileKey(secret, assetId, storageKey, header); authenticateHeader(fileSecret, assetId, storageKey, header, envelope.subarray(RAW_HEADER_BYTES));
      if (!unchanged(initialStats, await handle.stat({ bigint: true }))) throw new VideoStorageError(); await scope.assertReady();
      const stream = (options = {}) => {
        if (!options || typeof options !== "object" || Object.keys(options).some((name) => !["start", "end", "signal"].includes(name))) input();
        const { start = 0, end = bytes - 1, signal } = options; checkSignal(signal);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= bytes) input();
        if (closed || started) throw new VideoStorageError(); started = true;
        const generator = (async function* () {
          try {
            abort(signal);
            for (let index = Math.floor(start / VIDEO_BLOCK_BYTES); index <= Math.floor(end / VIDEO_BLOCK_BYTES); index += 1) {
              if (closed) throw new VideoStorageError(); await scope.assertReady(); abort(signal);
              const plainBytes = Math.min(VIDEO_BLOCK_BYTES, bytes - index * VIDEO_BLOCK_BYTES);
              const envelope = await readExactly(handle, plainBytes + 16, HEADER_BYTES + index * (VIDEO_BLOCK_BYTES + 16));
              let plaintext, tail;
              try {
                const decipher = createDecipheriv("aes-256-gcm", fileSecret, nonce(header, index), { authTagLength: 16 });
                decipher.setAAD(aad(assetId, storageKey, header, index)); decipher.setAuthTag(envelope.subarray(plainBytes));
                plaintext = decipher.update(envelope.subarray(0, plainBytes)); tail = decipher.final();
                if (tail.length || plaintext.length !== plainBytes || !unchanged(initialStats, await handle.stat({ bigint: true }))) throw new VideoStorageError();
                await scope.assertReady(); abort(signal);
                const lo = Math.max(0, start - index * VIDEO_BLOCK_BYTES), hi = Math.min(plainBytes, end + 1 - index * VIDEO_BLOCK_BYTES);
                // Ownership passes to the consumer. Wipe only failed plaintext;
                // a successful yielded Buffer must remain valid after next().
                const result = plaintext.subarray(lo, hi); plaintext = undefined; yield result;
              } finally { plaintext?.fill(0); tail?.fill(0); }
            }
          } catch (error) { throw wrapped(error); }
          finally { await close(); }
        })();
        // return() must close even if next() was never called, a case where
        // JavaScript does not enter the async generator's try/finally.
        return { [Symbol.asyncIterator]() { return this; }, next: (value) => generator.next(value),
          async return(value) { try { return await generator.return(value); } finally { await close(); } },
          async throw(error) { try { return await generator.throw(error); } finally { await close(); } } };
      };
      return Object.freeze({ bytes, storedBytes: videoStoredBytes(bytes), stream, close });
    } catch (error) { await close().catch(() => {}); throw wrapped(error); }
  }

  async function remove({ storageKey: rawStorage } = {}) {
    const storageKey = identifier(rawStorage, 32); let scope, failure;
    try {
      scope = await directory();
      const finalName = filename(storageKey), staging = new RegExp(`^\\.${storageKey.toString("hex")}\\.video\\.[a-f0-9]{32}\\.tmp$`);
      const selected = (name) => name === finalName || staging.test(name);
      const cleanupFile = (stats) => stats.isFile() && owner(stats) && (stats.mode & 0o7777n) === 0o600n && stats.nlink >= 1n;
      const names = (await readdir(scope.path)).filter(selected).sort();
      const groups = new Map();
      // Validate the complete selection before unlinking anything. The one
      // supported hardlink group is the interrupted put publication: all its
      // links must be the exact final/staging names for this storage key.
      for (const name of names) {
        const stats = await lstat(scope.file(name), { bigint: true });
        if (!cleanupFile(stats)) throw new VideoStorageError();
        const key = `${stats.dev}:${stats.ino}`;
        if (!groups.has(key)) groups.set(key, { stats, names: [] });
        const group = groups.get(key);
        if (!unchanged(group.stats, stats) || group.stats.nlink !== stats.nlink) throw new VideoStorageError();
        group.names.push(name);
      }
      for (const group of groups.values()) {
        if (group.stats.nlink !== BigInt(group.names.length)
          || group.names.length > 1 && !group.names.includes(finalName)) throw new VideoStorageError();
      }
      for (const group of groups.values()) {
        const handle = await openFile(scope.file(group.names[0]), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          let before = group.stats, remaining = BigInt(group.names.length);
          for (const name of group.names) {
            const opened = await handle.stat({ bigint: true }), named = await lstat(scope.file(name), { bigint: true });
            if (![opened, named].every((stats) => cleanupFile(stats) && unchanged(before, stats) && stats.nlink === remaining)) throw new VideoStorageError();
            await scope.assertReady(); await unlink(scope.file(name));
            remaining -= 1n;
            const after = await handle.stat({ bigint: true });
            if (!after.isFile() || !owner(after) || (after.mode & 0o7777n) !== 0o600n || after.dev !== before.dev
              || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.nlink !== remaining) throw new VideoStorageError();
            try { await lstat(scope.file(name), { bigint: true }); throw new VideoStorageError(); }
            catch (error) { if (error?.code !== "ENOENT") throw error; }
            before = after;
          }
        } finally { await handle.close(); }
      }
      await scope.sync();
      // A sync alone does not prove absence: refuse a name recreated during
      // unlink/sync, and never remove that replacement as part of this call.
      if ((await readdir(scope.path)).some(selected)) throw new VideoStorageError();
      try { await lstat(scope.file(finalName), { bigint: true }); throw new VideoStorageError(); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      await scope.assertReady();
    } catch (error) { failure = wrapped(error); }
    finally { try { await scope?.close(); } catch (error) { failure ??= wrapped(error); } }
    if (failure) throw failure;
    return { removed: true };
  }
  async function fingerprint() {
    let scope, result, failure;
    try {
      scope = await directory(); const stats = await scope.assertReady();
      result = createHmac("sha256", secret).update("jessiemessage:video-root:v1:\0", "ascii")
        .update(root, "utf8").update("\0").update(stats.dev.toString()).update("\0").update(stats.ino.toString()).digest();
      await scope.assertReady();
    } catch (error) { failure = wrapped(error); }
    finally { try { await scope?.close(); } catch (error) { failure ??= wrapped(error); } }
    if (failure) throw failure;
    return result;
  }
  const publishedName = /^([a-f0-9]{64})\.video\.enc$/;
  const stagingName = /^\.([a-f0-9]{64})\.video\.[a-f0-9]{32}\.tmp$/;
  function entryIdentity(name) {
    const published = publishedName.exec(name), staging = published ? null : stagingName.exec(name), match = published ?? staging;
    return match ? { kind: published ? "published" : "staging", storageKey: Buffer.from(match[1], "hex") } : { kind: "unknown" };
  }
  function entryMetadata(stats) {
    const mtimeMs = Number(stats.mtimeMs);
    if (typeof stats.size !== "bigint" || stats.size < 0n || !Number.isSafeInteger(mtimeMs) || mtimeMs < 0) throw new VideoStorageError();
    return { encryptedBytes: stats.size, mtimeMs };
  }
  // A bounded header inspection classifies entries without authenticating the
  // payload. Backup admission separately authenticates every video block.
  async function inspectNamed(scope, name, entry) {
    let handle, header;
    try {
      await scope.assertReady();
      const target = scope.file(name); let initial;
      try { initial = await lstat(target, { bigint: true }); }
      catch (error) { if (error?.code === "ENOENT") return null; throw error; }
      const metadata = entryMetadata(initial);
      if (entry.kind === "unknown" || !safeFile(initial)) return { ...entry, ...metadata, status: "unsafe" };
      try { handle = await openFile(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
      catch (error) {
        if (error?.code === "ENOENT") return null;
        if (["ELOOP", "EISDIR", "ENXIO"].includes(error?.code)) return { ...entry, ...metadata, status: "unstable" };
        throw error;
      }
      const before = await handle.stat({ bigint: true });
      if (!unchanged(initial, before)) return { ...entry, ...metadata, status: "unstable" };
      if (!safeFile(before)) return { ...entry, ...entryMetadata(before), status: "unsafe" };
      let status = "invalid_envelope";
      if (before.size >= BigInt(videoStoredBytes(1)) && before.size <= BigInt(videoStoredBytes(MAX_VIDEO_BYTES))) {
        header = await readExactly(handle, RAW_HEADER_BYTES, 0);
        if (header.subarray(0, MAGIC.length).equals(MAGIC) && header.readUInt32BE(8) === VIDEO_BLOCK_BYTES) {
          const bytes = header.readBigUInt64BE(12);
          if (bytes >= 1n && bytes <= BigInt(MAX_VIDEO_BYTES) && BigInt(videoStoredBytes(Number(bytes))) === before.size) status = "structural_ok";
        }
      }
      const after = await handle.stat({ bigint: true }); let visible;
      try { visible = await lstat(target, { bigint: true }); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      if (!safeFile(after) || !unchanged(initial, after) || !visible || !safeFile(visible) || !unchanged(after, visible)) status = "unstable";
      await scope.assertReady();
      return { ...entry, ...entryMetadata(after), status };
    } finally { header?.fill(0); await handle?.close(); }
  }
  async function inspectEntry(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(name => name !== "storageKey")) input();
    const storageKey = identifier(options.storageKey, 32); let scope, failure, result;
    try {
      scope = await directory();
      const entry = await inspectNamed(scope, filename(storageKey), { kind: "published", storageKey });
      await scope.assertReady(); result = entry === null ? { exists: false } : { exists: true, ...entry };
    } catch (error) { failure = wrapped(error); }
    finally { try { await scope?.close(); } catch (error) { failure ??= wrapped(error); } }
    if (failure) throw failure; return result;
  }
  async function* scanEntries(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(name => !["maxEntries", "signal"].includes(name))) input();
    const { maxEntries = 100000, signal } = options; checkSignal(signal);
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100000) input();
    let scope, directoryHandle, failure;
    try {
      abort(signal); scope = await directory(); directoryHandle = await opendir(scope.path, { bufferSize: 32 }); await scope.assertReady();
      let count = 0;
      while (true) {
        abort(signal); const entry = await directoryHandle.read(); abort(signal); await scope.assertReady();
        if (entry === null) break;
        if (++count > maxEntries) throw new VideoStorageError("VIDEO_SCAN_LIMIT");
        const identity = entryIdentity(entry.name), value = await inspectNamed(scope, entry.name, identity);
        abort(signal); await scope.assertReady();
        yield value ?? { ...identity, encryptedBytes: 0n, mtimeMs: 0, status: "unstable" };
      }
      abort(signal); await scope.assertReady();
    } catch (error) { failure = wrapped(error); }
    finally {
      try { await directoryHandle?.close(); } catch (error) { failure ??= wrapped(error); }
      try { await scope?.close(); } catch (error) { failure ??= wrapped(error); }
      if (failure) throw failure;
    }
  }
  async function availableSpace() {
    let scope;
    try { scope = await directory(); const stats = await statfs(`${scope.path}/.`, { bigint: true }); await scope.assertReady(); if (stats.bavail < 0n || stats.bsize <= 0n) throw new VideoStorageError(); return { availableBytes: stats.bavail * stats.bsize }; }
    catch (error) { throw wrapped(error); } finally { await scope?.close().catch(() => {}); }
  }
  return Object.freeze({ put, open, remove, fingerprint, availableSpace, inspectEntry, scanEntries });
}
