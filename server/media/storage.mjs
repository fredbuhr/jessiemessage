import { constants } from "node:fs";
import { lstat, realpath, open, link, unlink, opendir, statfs } from "node:fs/promises";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NAMESPACE = Buffer.from("jessiemessage:media-file:v1:", "ascii");
const MAGIC = Buffer.from("JMIMGv1\0", "ascii");
const OVERHEAD = MAGIC.length + 12 + 4 + 16;
const HEADER_BYTES = MAGIC.length + 12 + 4;
const MAX_BYTES = { full: 10 * 1024 * 1024, thumb: 512 * 1024 };
const PUBLISHED_NAME = /^([a-f0-9]{64})\.(full|thumb)\.enc$/;
const STAGING_NAME = /^\.([a-f0-9]{64})\.(full|thumb)\.[a-f0-9]{32}\.tmp$/;

export class MediaStorageError extends Error {
  constructor(code = "MEDIA_UNAVAILABLE") {
    super("Private image storage is unavailable.");
    this.name = "MediaStorageError";
    this.code = code;
  }
}

function invalid() { throw new MediaStorageError("MEDIA_INPUT"); }
function buffer(value, size) { if (!Buffer.isBuffer(value) || value.length !== size) invalid(); }
function variantName(variant) { if (variant !== "full" && variant !== "thumb") invalid(); return variant; }
function associatedData(assetId, variant) { return Buffer.concat([NAMESPACE, assetId, Buffer.from(variant === "full" ? [1] : [2])]); }
function owned(stats) { return process.getuid === undefined || stats.uid === (typeof stats.uid === "bigint" ? BigInt(process.getuid()) : process.getuid()); }
function inside(candidate, parent) { return candidate === parent || candidate.startsWith(`${parent}${path.sep}`); }

function seal(plaintext, key, assetId, variant) {
  const nonce = randomBytes(12);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(plaintext.length);
  const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
  cipher.setAAD(associatedData(assetId, variant));
  return Buffer.concat([MAGIC, nonce, size, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function unseal(envelope, key, assetId, variant) {
  let plaintext;
  let tail;
  try {
    if (envelope.length <= OVERHEAD || envelope.length > MAX_BYTES[variant] + OVERHEAD
      || !envelope.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error();
    const nonceStart = MAGIC.length;
    const sizeStart = nonceStart + 12;
    const bodyStart = sizeStart + 4;
    const size = envelope.readUInt32BE(sizeStart);
    if (size < 1 || size > MAX_BYTES[variant] || size !== envelope.length - OVERHEAD) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, envelope.subarray(nonceStart, sizeStart), { authTagLength: 16 });
    decipher.setAAD(associatedData(assetId, variant));
    decipher.setAuthTag(envelope.subarray(-16));
    plaintext = decipher.update(envelope.subarray(bodyStart, -16));
    tail = decipher.final();
    if (tail.length > 0) {
      const first = plaintext;
      plaintext = Buffer.concat([first, tail]);
      first.fill(0);
    }
    const result = plaintext;
    plaintext = undefined;
    return result;
  } catch { throw new MediaStorageError(); }
  finally { plaintext?.fill(0); tail?.fill(0); }
}

export async function createMediaStorage({ root, key } = {}) {
  if (typeof root !== "string" || !path.isAbsolute(root) || root !== path.resolve(root)
    || root === path.parse(root).root || root.includes("\0") || inside(root, CHECKOUT) || inside(CHECKOUT, root)) invalid();
  buffer(key, 32);
  const secret = Buffer.from(key);
  let identity;

  async function assertReady() {
    try {
      // Check each path component. A symlink anywhere, including an ancestor,
      // is rejected instead of being resolved to a potentially public location.
      let current = path.parse(root).root;
      for (const component of root.slice(current.length).split(path.sep)) {
        current = path.join(current, component);
        const stats = await lstat(current);
        if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error();
        // Other users must not be able to rename an ancestor between checks
        // and file operations. A system-owned sticky parent (e.g. /tmp) may
        // contain an owner-private root; arbitrary writable parents may not.
        if (process.getuid !== undefined && stats.uid !== 0 && stats.uid !== process.getuid()) throw new Error();
        if ((stats.mode & 0o022) !== 0 && (stats.mode & 0o1000) === 0) throw new Error();
      }
      const stats = await lstat(root, { bigint: true });
      if ((stats.mode & 0o777n) !== 0o700n || !owned(stats) || await realpath(root) !== root) throw new Error();
      if (identity && (identity.dev !== stats.dev || identity.ino !== stats.ino)) throw new Error();
      identity ??= { dev: stats.dev, ino: stats.ino };
    } catch { throw new MediaStorageError(); }
  }

  function filename(storageKey, variant) {
    buffer(storageKey, 32);
    variantName(variant);
    return path.join(root, `${storageKey.toString("hex")}.${variant}.enc`);
  }

  async function privateFile(filenameValue, flags) {
    const handle = await open(filenameValue, flags | constants.O_NOFOLLOW, 0o600);
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || (stats.mode & 0o777) !== 0o600 || !owned(stats) || stats.nlink !== 1) throw new Error();
      return { handle, stats };
    } catch (error) { await handle.close(); throw error; }
  }

  async function privateDirectory() {
    const handle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stats = await handle.stat({ bigint: true });
      if (!stats.isDirectory() || (stats.mode & 0o777n) !== 0o700n || !owned(stats)
        || stats.dev !== identity.dev || stats.ino !== identity.ino) throw new Error();
      return handle;
    } catch (error) { await handle.close(); throw error; }
  }

  async function syncDirectory() {
    await assertReady();
    const handle = await privateDirectory();
    try { await handle.sync(); }
    finally { await handle.close(); }
    await assertReady();
  }

  async function fingerprint() {
    try {
      await assertReady();
      const result = createHmac("sha256", secret).update("jessiemessage:media-root:v1:\0", "ascii")
        .update(root, "utf8").update("\0").update(identity.dev.toString()).update("\0").update(identity.ino.toString()).digest();
      await assertReady();
      return result;
    } catch { throw new MediaStorageError(); }
  }

  async function availableSpace() {
    try {
      await assertReady();
      const stats = await statfs(root, { bigint: true });
      if (typeof stats.bavail !== "bigint" || stats.bavail < 0n || typeof stats.bsize !== "bigint" || stats.bsize <= 0n) throw new Error();
      const availableBytes = stats.bavail * stats.bsize;
      await assertReady();
      return { availableBytes };
    } catch { throw new MediaStorageError(); }
  }

  function entryIdentity(name) {
    const published = PUBLISHED_NAME.exec(name);
    const staging = published ? null : STAGING_NAME.exec(name);
    const match = published ?? staging;
    return match ? { kind: published ? "published" : "staging", storageKey: Buffer.from(match[1], "hex"), variant: match[2] } : { kind: "unknown" };
  }

  function entryMetadata(stats) {
    const mtimeMs = Number(stats.mtimeMs);
    if (typeof stats.size !== "bigint" || stats.size < 0n || !Number.isSafeInteger(mtimeMs)) throw new Error();
    return { encryptedBytes: stats.size, mtimeMs };
  }
  function safeEntry(stats) {
    return stats.isFile() && (stats.mode & 0o7777n) === 0o600n && owned(stats) && stats.nlink === 1n;
  }
  function sameEntry(before, after) {
    return before.dev === after.dev && before.ino === after.ino && before.size === after.size
      && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
  }

  // This checks the encrypted envelope's structure only. It never reads image
  // bodies, authenticates a GCM tag or decrypts a photo.
  async function inspectNamed(name, entry) {
    let handle, header;
    try {
      const target = path.join(root, name);
      let initial;
      try { initial = await lstat(target, { bigint: true }); }
      catch (error) { if (error?.code === "ENOENT") return null; throw error; }
      const metadata = entryMetadata(initial);
      if (entry.kind === "unknown" || !safeEntry(initial)) return { ...entry, ...metadata, status: "unsafe" };
      try {
        // NONBLOCK also prevents a swapped FIFO from blocking before fstat
        // rejects its type. NOFOLLOW refuses a swapped final symlink.
        handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        if (["ELOOP", "EISDIR", "ENXIO"].includes(error?.code)) return { ...entry, ...metadata, status: "unstable" };
        throw error;
      }
      const before = await handle.stat({ bigint: true });
      if (before.dev !== initial.dev || before.ino !== initial.ino) return { ...entry, ...metadata, status: "unstable" };
      if (!safeEntry(before)) return { ...entry, ...entryMetadata(before), status: "unsafe" };
      let status = "invalid_envelope";
      if (before.size > BigInt(OVERHEAD) && before.size <= BigInt(MAX_BYTES[entry.variant] + OVERHEAD)) {
        header = Buffer.alloc(HEADER_BYTES);
        let offset = 0;
        while (offset < header.length) {
          const { bytesRead } = await handle.read(header, offset, header.length - offset, offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        if (offset === header.length && header.subarray(0, MAGIC.length).equals(MAGIC)) {
          const size = header.readUInt32BE(MAGIC.length + 12);
          if (size >= 1 && size <= MAX_BYTES[entry.variant] && BigInt(size + OVERHEAD) === before.size) status = "structural_ok";
        }
      }
      const after = await handle.stat({ bigint: true });
      if (!safeEntry(after) || !sameEntry(before, after) || !sameEntry(initial, after)) status = "unstable";
      return { ...entry, ...entryMetadata(after), status };
    } finally { header?.fill(0); await handle?.close(); }
  }

  async function inspectEntry(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)
      || Object.keys(options).some((name) => !["storageKey", "variant"].includes(name))) invalid();
    const { storageKey, variant } = options;
    const target = filename(storageKey, variant);
    const entry = { kind: "published", storageKey: Buffer.from(storageKey), variant };
    try {
      await assertReady();
      const result = await inspectNamed(path.basename(target), entry);
      await assertReady();
      return result === null ? { exists: false } : { exists: true, ...result };
    } catch { throw new MediaStorageError(); }
  }

  async function* scanEntries(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)
      || Object.keys(options).some((name) => !["maxEntries", "signal"].includes(name))) invalid();
    const { maxEntries = 100000, signal } = options;
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100000
      || signal !== undefined && (!signal || typeof signal.aborted !== "boolean")) invalid();
    let directory, directoryHandle;
    const checkAbort = () => { if (signal?.aborted) throw new MediaStorageError(); };
    try {
      checkAbort(); await assertReady();
      directoryHandle = await privateDirectory();
      directory = await opendir(root, { bufferSize: 32 });
      await assertReady();
      let count = 0;
      while (true) {
        checkAbort();
        const dirent = await directory.read();
        checkAbort(); await assertReady();
        if (dirent === null) break;
        if (++count > maxEntries) throw new MediaStorageError("MEDIA_SCAN_LIMIT");
        const entry = entryIdentity(dirent.name);
        const result = await inspectNamed(dirent.name, entry);
        checkAbort(); await assertReady();
        yield result ?? { ...entry, encryptedBytes: 0n, mtimeMs: 0, status: "unstable" };
      }
      await assertReady();
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      throw new MediaStorageError();
    } finally {
      let closeFailed = false;
      try { await directory?.close(); } catch { closeFailed = true; }
      try { await directoryHandle?.close(); } catch { closeFailed = true; }
      if (closeFailed) throw new MediaStorageError();
    }
  }

  async function put({ assetId, storageKey, full, thumbnail } = {}) {
    buffer(assetId, 16); buffer(storageKey, 32);
    if (!Buffer.isBuffer(full) || full.length < 1 || full.length > MAX_BYTES.full
      || !Buffer.isBuffer(thumbnail) || thumbnail.length < 1 || thumbnail.length > MAX_BYTES.thumb) invalid();
    const temporary = [];
    const published = [];
    try {
      await assertReady();
      for (const [variant, plaintext] of [["full", full], ["thumb", thumbnail]]) {
        const destination = filename(storageKey, variant);
        const staging = path.join(root, `.${storageKey.toString("hex")}.${variant}.${randomBytes(16).toString("hex")}.tmp`);
        const { handle } = await privateFile(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
        temporary.push(staging);
        try { await handle.writeFile(seal(plaintext, secret, assetId, variant)); await handle.sync(); }
        finally { await handle.close(); }
        // link is exclusive and atomic. rename would silently overwrite an
        // existing asset and is deliberately not used.
        await assertReady();
        await link(staging, destination);
        published.push(destination);
        await unlink(staging);
        temporary.pop();
      }
      await syncDirectory();
    } catch {
      // Remove exactly the paths created by this call; an existing conflicting
      // destination or unrelated orphan is never removed.
      for (const created of [...temporary, ...published]) {
        try { await unlink(created); } catch { /* Best effort, encrypted only. */ }
      }
      throw new MediaStorageError();
    }
  }

  async function get({ assetId, storageKey, variant } = {}) {
    buffer(assetId, 16); buffer(storageKey, 32); variantName(variant);
    let handle;
    let envelope;
    try {
      await assertReady();
      const file = await privateFile(filename(storageKey, variant), constants.O_RDONLY);
      handle = file.handle;
      if (file.stats.size <= OVERHEAD || file.stats.size > MAX_BYTES[variant] + OVERHEAD) throw new Error();
      // A fixed-length read cannot grow without bound if a file is changed
      // during the read. Only owner-private regular files are ever accepted.
      envelope = Buffer.alloc(file.stats.size);
      let offset = 0;
      while (offset < envelope.length) {
        const { bytesRead } = await handle.read(envelope, offset, envelope.length - offset, offset);
        if (bytesRead === 0) throw new Error();
        offset += bytesRead;
      }
      const finalStats = await handle.stat();
      if (finalStats.size !== file.stats.size || finalStats.mtimeMs !== file.stats.mtimeMs
        || finalStats.ctimeMs !== file.stats.ctimeMs) throw new Error();
      return unseal(envelope, secret, assetId, variant);
    } catch { throw new MediaStorageError(); }
    finally { envelope?.fill(0); try { await handle?.close(); } catch { /* Already closed or unavailable. */ } }
  }

  async function remove({ storageKey } = {}) {
    buffer(storageKey, 32);
    try {
      await assertReady();
      for (const variant of ["full", "thumb"]) {
        const target = filename(storageKey, variant);
        try {
          const stats = await lstat(target);
          if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600 || !owned(stats) || stats.nlink !== 1) throw new Error();
          await unlink(target);
        } catch (error) { if (error?.code !== "ENOENT") throw error; }
      }
      await syncDirectory();
    } catch { throw new MediaStorageError(); }
  }

  await assertReady();
  return { assertReady, put, get, remove, fingerprint, availableSpace, scanEntries, inspectEntry };
}
