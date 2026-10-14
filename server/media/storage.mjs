import { constants } from "node:fs";
import { lstat, realpath, open, link, unlink } from "node:fs/promises";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const NAMESPACE = Buffer.from("jessiemessage:media-file:v1:", "ascii");
const MAGIC = Buffer.from("JMIMGv1\0", "ascii");
const OVERHEAD = MAGIC.length + 12 + 4 + 16;
const MAX_BYTES = { full: 10 * 1024 * 1024, thumb: 512 * 1024 };

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
function owned(stats) { return process.getuid === undefined || stats.uid === process.getuid(); }
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
      const stats = await lstat(root);
      if ((stats.mode & 0o777) !== 0o700 || !owned(stats) || await realpath(root) !== root) throw new Error();
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
      const directory = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await directory.sync(); } finally { await directory.close(); }
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
    } catch { throw new MediaStorageError(); }
  }

  await assertReady();
  return { assertReady, put, get, remove };
}
