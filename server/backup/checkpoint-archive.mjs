import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";

const MAX_BYTES = 2 * 1024 * 1024 * 1024, CHUNK = 64 * 1024, BLOCK = 512;
const ROOT_NAMES = ["manifest.json", "database.sql.gz", "receipt.json"];
const NAME = /^(?:manifest\.json|database\.sql\.gz|receipt\.json|operations\.enc\.json|media\/[a-f0-9]{64}\.(?:full|thumb)\.enc)$/;
const STAT_FIELDS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];

export class CheckpointArchiveError extends Error {
  constructor(code = "CHECKPOINT_ARCHIVE_IO") {
    super("Private checkpoint archive could not be verified.");
    this.name = "CheckpointArchiveError"; this.code = code;
  }
}
const fail = (suffix) => { throw new CheckpointArchiveError(`CHECKPOINT_ARCHIVE_${suffix}`); };
const active = (signal) => { if (signal?.aborted) fail("ABORTED"); };
const same = (left, right) => STAT_FIELDS.every((name) => left[name] === right[name]);
const zeros = (buffer) => buffer.every((byte) => byte === 0);

function record(value, names) {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("INPUT");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some((key) => typeof key !== "string" || !names.includes(key)
    || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value"))) fail("INPUT");
  return Object.fromEntries(names.map((name) => [name, descriptors[name].value]));
}

function inventory(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < 3 || value.length > 100004) fail("INPUT");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) fail("INPUT");
  const files = new Map(); let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("INPUT");
    const entry = record(descriptor.value, ["name", "bytes", "sha256"]);
    if (typeof entry.name !== "string" || !NAME.test(entry.name) || files.has(entry.name)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_BYTES
      || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail("INPUT");
    bytes += entry.bytes; if (bytes > MAX_BYTES) fail("INPUT");
    files.set(entry.name, Object.freeze(entry));
  }
  if (ROOT_NAMES.some((name) => !files.has(name))) fail("INPUT");
  return { files, bytes };
}

function selectedSignal(options) {
  const selected = record(options, Object.hasOwn(options ?? {}, "signal") ? ["signal"] : []);
  if (selected.signal !== undefined && !(selected.signal instanceof AbortSignal)) fail("INPUT");
  return selected.signal;
}

function regular(stats) {
  if (!stats?.isFile?.() || STAT_FIELDS.some((name) => typeof stats[name] !== "bigint")
    || typeof process.getuid !== "function" || stats.uid !== BigInt(process.getuid())
    || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n) fail("UNSAFE");
  if (stats.size < 1n || stats.size > BigInt(MAX_BYTES)) fail("LIMIT");
}

async function ready(scope, previous, signal) {
  active(signal);
  if (!scope || typeof scope !== "object") fail("INPUT");
  for (const name of ["file", "assertReady"]) {
    const descriptor = Object.getOwnPropertyDescriptor(scope, name);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "function") fail("INPUT");
  }
  const stats = await scope.assertReady(); active(signal);
  if (!stats?.isDirectory?.() || typeof stats.dev !== "bigint" || typeof stats.ino !== "bigint"
    || typeof stats.mode !== "bigint" || typeof stats.nlink !== "bigint" || stats.nlink < 1n
    || typeof process.getuid !== "function" || stats.uid !== BigInt(process.getuid())
    || (stats.mode & 0o7777n) !== 0o700n) fail("UNSAFE");
  if (previous && (previous.dev !== stats.dev || previous.ino !== stats.ino)) fail("CHANGED");
  return { dev: stats.dev, ino: stats.ino };
}

function octal(buffer, optional = false) {
  if (optional && zeros(buffer)) return 0;
  const text = buffer.toString("latin1");
  if (!/^ *[0-7]+[\x00 ]*$/.test(text)) fail("FORMAT");
  const result = Number.parseInt(text.trim().replace(/[\x00 ]+$/, ""), 8);
  if (!Number.isSafeInteger(result) || result < 0) fail("FORMAT");
  return result;
}

function textField(buffer) {
  const ending = buffer.indexOf(0);
  if (ending < 0 || !zeros(buffer.subarray(ending)) || buffer.subarray(0, ending).some((byte) => byte < 32 || byte > 126)) fail("FORMAT");
  return buffer.subarray(0, ending).toString("ascii");
}

// Only the short-name GNU/USTAR subset emitted by the checkpoint writer is
// accepted. No extraction, path resolution, extension records or link targets.
function tarReader(expected) {
  const header = Buffer.alloc(BLOCK), seen = new Set();
  let filled = 0, remaining = 0, padding = 0, fileHash, current, ended = 0, media = false, total = 0;
  const finishFile = () => {
    if (fileHash.digest("hex") !== current.sha256) fail("CONTENT");
    fileHash = null; current = null;
  };
  function readHeader() {
    if (zeros(header)) { ended += 1; return; }
    if (ended !== 0) fail("FORMAT");
    const checksum = octal(header.subarray(148, 156));
    let sum = 0;
    for (let index = 0; index < BLOCK; index++) sum += index >= 148 && index < 156 ? 32 : header[index];
    if (checksum !== sum) fail("FORMAT");
    const magic = header.subarray(257, 265);
    if (!magic.equals(Buffer.from("ustar\0" + "00", "ascii")) && !magic.equals(Buffer.from("ustar  \0", "ascii"))) fail("FORMAT");
    if (!zeros(header.subarray(157, 257)) || !zeros(header.subarray(345))) fail("FORMAT");
    octal(header.subarray(100, 108)); octal(header.subarray(108, 116)); octal(header.subarray(116, 124));
    octal(header.subarray(136, 148)); octal(header.subarray(329, 337), true); octal(header.subarray(337, 345), true);
    textField(header.subarray(265, 297)); textField(header.subarray(297, 329));
    const name = textField(header.subarray(0, 100)), size = octal(header.subarray(124, 136)), type = header[156];
    if (size > MAX_BYTES) fail("LIMIT");
    if (type === 53 && name === "media/" && size === 0 && !media) { media = true; return; }
    if (type !== 0 && type !== 48 || !NAME.test(name) || seen.has(name)) fail("FORMAT");
    current = expected.files.get(name);
    if (!current || size !== current.bytes) fail("CONTENT");
    seen.add(name); remaining = size; padding = (BLOCK - size % BLOCK) % BLOCK; fileHash = createHash("sha256");
  }
  return {
    push(chunk) {
      total += chunk.length; if (total > MAX_BYTES) fail("LIMIT");
      let offset = 0;
      while (offset < chunk.length) {
        if (remaining > 0) {
          const length = Math.min(remaining, chunk.length - offset);
          fileHash.update(chunk.subarray(offset, offset + length)); remaining -= length; offset += length;
          if (remaining === 0) finishFile();
        } else if (padding > 0) {
          const length = Math.min(padding, chunk.length - offset);
          if (!zeros(chunk.subarray(offset, offset + length))) fail("FORMAT");
          padding -= length; offset += length;
        } else {
          const length = Math.min(BLOCK - filled, chunk.length - offset);
          chunk.copy(header, filled, offset, offset + length); filled += length; offset += length;
          if (filled === BLOCK) { readHeader(); header.fill(0); filled = 0; }
        }
      }
    },
    finish() {
      if (remaining !== 0 || padding !== 0 || filled !== 0 || ended < 2 || !media || seen.size !== expected.files.size) fail("FORMAT");
    },
    clear() { header.fill(0); current = null; fileHash = null; },
  };
}

/** Verify every archived byte against a closed inventory without extracting it. */
export async function verifyCheckpointArchive(scope, expected, options = {}) {
  let file, gunzip, parser, buffer, signal, abort;
  try {
    signal = selectedSignal(options); active(signal);
    const selected = inventory(expected), root = await ready(scope, null, signal);
    const filename = scope.file("checkpoint.tar.gz"), visible = await lstat(filename, { bigint: true }); regular(visible);
    file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); active(signal);
    const before = await file.stat({ bigint: true }); regular(before);
    if (!same(visible, before)) fail("CHANGED");
    parser = tarReader(selected); buffer = Buffer.alloc(CHUNK);
    const hash = createHash("sha256"); let bytes = 0;
    gunzip = createGunzip({ chunkSize: CHUNK, highWaterMark: CHUNK });
    // A fixed listener also covers cancellation before the iterator starts.
    gunzip.on("error", () => {});
    abort = () => gunzip.destroy(new CheckpointArchiveError("CHECKPOINT_ARCHIVE_ABORTED"));
    signal?.addEventListener("abort", abort, { once: true }); active(signal);
    const stop = (error) => { gunzip.destroy(error); throw error; };
    const consumer = (async () => {
      for await (const chunk of gunzip) {
        try { active(signal); parser.push(chunk); }
        finally { chunk.fill(0); }
      }
      active(signal); parser.finish();
    })().catch(stop);
    const producer = (async () => {
      while (bytes < Number(before.size)) {
        active(signal);
        const amount = Math.min(CHUNK, Number(before.size) - bytes);
        const { bytesRead } = await file.read(buffer, 0, amount, bytes); active(signal);
        if (!Number.isSafeInteger(bytesRead) || bytesRead < 1 || bytesRead > amount) fail("CHANGED");
        hash.update(buffer.subarray(0, bytesRead)); bytes += bytesRead;
        // Await zlib's write completion before erasing/reusing compressed input.
        await new Promise((resolve, reject) => {
          let settled = false;
          const finish = (error) => {
            if (settled) return;
            settled = true; gunzip.removeListener("error", failed); gunzip.removeListener("close", closed);
            if (error) reject(error); else resolve();
          };
          const failed = (error) => finish(error), closed = () => finish(new CheckpointArchiveError("CHECKPOINT_ARCHIVE_FORMAT"));
          gunzip.once("error", failed); gunzip.once("close", closed);
          gunzip.write(buffer.subarray(0, bytesRead), finish);
        });
        buffer.fill(0);
      }
      active(signal); gunzip.end();
    })().catch(stop);
    const results = await Promise.allSettled([producer, consumer]);
    active(signal);
    const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length) throw failures.find((error) => error instanceof CheckpointArchiveError) ?? new CheckpointArchiveError("CHECKPOINT_ARCHIVE_FORMAT");
    if (gunzip.bytesWritten !== bytes) fail("FORMAT");
    const after = await file.stat({ bigint: true }); regular(after);
    const final = await lstat(filename, { bigint: true }); regular(final);
    if (!same(before, after) || !same(after, final)) fail("CHANGED");
    await ready(scope, root, signal);
    return Object.freeze({ files: selected.files.size, bytes: selected.bytes, archiveBytes: bytes, archiveSha256: hash.digest("hex") });
  } catch (error) {
    if (error instanceof CheckpointArchiveError) throw error;
    throw new CheckpointArchiveError();
  } finally {
    signal?.removeEventListener("abort", abort);
    gunzip?.destroy(); parser?.clear(); buffer?.fill(0);
    try { await file?.close(); } catch { throw new CheckpointArchiveError(); }
  }
}
