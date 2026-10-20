import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { BACKUP_MEDIA_MAX_BYTES, BACKUP_MEDIA_MAX_FILES } from "../media/backup-limits.mjs";

const PUBLISHED_NAME = /^[a-f0-9]{64}\.(?:full|thumb)\.enc$/;
const MAX_FILES = BACKUP_MEDIA_MAX_FILES;
const MAX_TOTAL_BYTES = BACKUP_MEDIA_MAX_BYTES;
const MAX_FILE_BYTES = 10 * 1024 * 1024 + 128;
const CHUNK_BYTES = 64 * 1024;
const SNAPSHOT_FIELDS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];

export class CheckpointFilesError extends Error {
  constructor(code = "CHECKPOINT_FILES_IO") {
    super("Private checkpoint files could not be verified.");
    this.name = "CheckpointFilesError";
    this.code = code;
  }
}

const fail = (suffix) => { throw new CheckpointFilesError(`CHECKPOINT_FILES_${suffix}`); };
const checkSignal = (signal) => { if (signal?.aborted) fail("ABORTED"); };
const identity = (left, right) => left.dev === right.dev && left.ino === right.ino;
const snapshot = (stats) => Object.fromEntries(SNAPSHOT_FIELDS.map((name) => [name, stats[name]]));
const unchanged = (before, after) => SNAPSHOT_FIELDS.every((name) => before[name] === after[name]);

function fields(value, expected) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("INPUT");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(descriptors);
  if (names.length !== expected.length || expected.some((name) => !Object.hasOwn(descriptors, name)
    || !Object.hasOwn(descriptors[name], "value")) || names.some((name) => !expected.includes(name))) fail("INPUT");
}

function selectedOptions(options) {
  fields(options, Object.hasOwn(options ?? {}, "signal") ? ["signal"] : []);
  const signal = options.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) fail("INPUT");
  return signal;
}

function owned(stats) {
  return typeof process.getuid === "function" && stats.uid === BigInt(process.getuid());
}

function regular(stats) {
  if (!stats?.isFile?.() || SNAPSHOT_FIELDS.some((name) => typeof stats[name] !== "bigint")
    || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n || !owned(stats)) fail("UNSAFE");
  if (stats.size < 0n || stats.size > BigInt(MAX_FILE_BYTES)) fail("LIMIT");
}

async function ready(scope, previous, signal) {
  checkSignal(signal);
  if (!scope || typeof scope.path !== "string" || typeof scope.file !== "function"
    || typeof scope.assertReady !== "function" || typeof scope.sync !== "function") fail("INPUT");
  const stats = await scope.assertReady();
  checkSignal(signal);
  if (!stats?.isDirectory?.() || typeof stats.dev !== "bigint" || typeof stats.ino !== "bigint"
    || typeof stats.mode !== "bigint" || typeof stats.nlink !== "bigint" || stats.nlink < 1n
    || (stats.mode & 0o7777n) !== 0o700n || !owned(stats)) fail("UNSAFE");
  if (previous && !identity(previous, stats)) fail("CHANGED");
  return { dev: stats.dev, ino: stats.ino };
}

async function scan(scope, root, signal) {
  await ready(scope, root, signal);
  let directory;
  const entries = [];
  let total = 0;
  try {
    directory = await opendir(`${scope.path}/.`);
    while (true) {
      checkSignal(signal);
      const entry = await directory.read();
      checkSignal(signal);
      if (entry === null) break;
      if (entries.length >= MAX_FILES) fail("LIMIT");
      if (!PUBLISHED_NAME.test(entry.name)) fail("UNSAFE");
      const stats = await lstat(scope.file(entry.name), { bigint: true });
      checkSignal(signal);
      regular(stats);
      if (stats.size === 0n) fail("UNSAFE");
      total += Number(stats.size);
      if (total > MAX_TOTAL_BYTES) fail("LIMIT");
      entries.push({ name: entry.name, bytes: Number(stats.size), state: snapshot(stats) });
    }
  } finally { await directory?.close(); }
  await ready(scope, root, signal);
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  return { entries, bytes: total };
}

function sameScan(before, after) {
  if (before.bytes !== after.bytes || before.entries.length !== after.entries.length
    || before.entries.some((entry, index) => entry.name !== after.entries[index].name
      || !unchanged(entry.state, after.entries[index].state))) fail("CHANGED");
}

function closedInventory(value) {
  fields(value, ["files", "bytes"]);
  if (!Array.isArray(value.files) || value.files.length > MAX_FILES || !Number.isSafeInteger(value.bytes)
    || value.bytes < 0 || value.bytes > MAX_TOTAL_BYTES) fail("INPUT");
  let total = 0, previous = "";
  const files = value.files.map((entry) => {
    fields(entry, ["name", "bytes", "sha256"]);
    if (typeof entry.name !== "string" || !PUBLISHED_NAME.test(entry.name) || entry.name <= previous
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_FILE_BYTES
      || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail("INPUT");
    previous = entry.name;
    total += entry.bytes;
    if (total > MAX_TOTAL_BYTES) fail("INPUT");
    return Object.freeze({ name: entry.name, bytes: entry.bytes, sha256: entry.sha256 });
  });
  if (total !== value.bytes) fail("INPUT");
  return Object.freeze({ files: Object.freeze(files), bytes: total });
}

async function readStable(scope, root, entry, signal, onReady, consume) {
  let file;
  const buffer = Buffer.alloc(CHUNK_BYTES);
  try {
    await ready(scope, root, signal);
    file = await open(scope.file(entry.name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    checkSignal(signal);
    const before = await file.stat({ bigint: true });
    regular(before);
    if (!unchanged(entry.state, before)) fail("CHANGED");
    await onReady?.(before);
    const hash = createHash("sha256");
    let length = 0;
    while (length <= entry.bytes) {
      checkSignal(signal);
      const amount = Math.min(buffer.length, entry.bytes - length + 1);
      const { bytesRead } = await file.read(buffer, 0, amount, length);
      checkSignal(signal);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > amount) fail("IO");
      if (bytesRead === 0) break;
      if (length + bytesRead > entry.bytes) fail("CHANGED");
      hash.update(buffer.subarray(0, bytesRead));
      await consume?.(buffer, bytesRead, length);
      length += bytesRead;
    }
    if (length !== entry.bytes) fail("CHANGED");
    const after = await file.stat({ bigint: true });
    regular(after);
    const visible = await lstat(scope.file(entry.name), { bigint: true });
    regular(visible);
    if (!unchanged(before, after) || !unchanged(after, visible)) fail("CHANGED");
    await ready(scope, root, signal);
    return Object.freeze({ name: entry.name, bytes: length, sha256: hash.digest("hex") });
  } finally {
    buffer.fill(0);
    await file?.close();
  }
}

async function copyOne(source, sourceRoot, target, targetRoot, entry, signal) {
  let file, created;
  try {
    const record = await readStable(source, sourceRoot, entry, signal, async (sourceStats) => {
      await ready(target, targetRoot, signal);
      file = await open(target.file(entry.name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      checkSignal(signal);
      const stats = await file.stat({ bigint: true });
      regular(stats);
      if (stats.size !== 0n || identity(stats, sourceStats)) fail("UNSAFE");
      created = { dev: stats.dev, ino: stats.ino };
    }, async (buffer, bytes, position) => {
      let offset = 0;
      while (offset < bytes) {
        checkSignal(signal);
        const { bytesWritten } = await file.write(buffer, offset, bytes - offset, position + offset);
        checkSignal(signal);
        if (!Number.isSafeInteger(bytesWritten) || bytesWritten < 1 || bytesWritten > bytes - offset) fail("IO");
        offset += bytesWritten;
      }
    });
    checkSignal(signal);
    await file.sync();
    checkSignal(signal);
    const after = await file.stat({ bigint: true });
    regular(after);
    const visible = await lstat(target.file(entry.name), { bigint: true });
    regular(visible);
    if (!identity(created, after) || !unchanged(after, visible) || after.size !== BigInt(record.bytes)) fail("CHANGED");
    await ready(target, targetRoot, signal);
    return record;
  } finally { await file?.close(); }
}

async function verify(scope, inventory, root, signal, expectedScan) {
  const before = await scan(scope, root, signal);
  if (expectedScan) sameScan(expectedScan, before);
  if (before.bytes !== inventory.bytes || before.entries.length !== inventory.files.length
    || before.entries.some((entry, index) => entry.name !== inventory.files[index].name
      || entry.bytes !== inventory.files[index].bytes)) fail("CHANGED");
  for (let index = 0; index < before.entries.length; index += 1) {
    const actual = await readStable(scope, root, before.entries[index], signal);
    if (actual.sha256 !== inventory.files[index].sha256) fail("CHANGED");
  }
  sameScan(before, await scan(scope, root, signal));
  return inventory;
}

/** Copy encrypted published files only; retain partial private output on failure. */
export async function copyCheckpointMedia(sourceScope, targetScope, options = {}) {
  try {
    const signal = selectedOptions(options);
    checkSignal(signal);
    const sourceRoot = await ready(sourceScope, null, signal);
    const targetRoot = await ready(targetScope, null, signal);
    if (identity(sourceRoot, targetRoot)) fail("INPUT");
    const source = await scan(sourceScope, sourceRoot, signal);
    if ((await scan(targetScope, targetRoot, signal)).entries.length !== 0) fail("UNSAFE");
    const files = [];
    for (const entry of source.entries) files.push(await copyOne(sourceScope, sourceRoot, targetScope, targetRoot, entry, signal));
    await targetScope.sync();
    await ready(targetScope, targetRoot, signal);
    const inventory = closedInventory({ files, bytes: source.bytes });
    const copied = await scan(targetScope, targetRoot, signal);
    await verify(targetScope, inventory, targetRoot, signal, copied);
    await verify(sourceScope, inventory, sourceRoot, signal, source);
    sameScan(copied, await scan(targetScope, targetRoot, signal));
    await ready(targetScope, targetRoot, signal);
    return inventory;
  } catch (error) {
    if (error instanceof CheckpointFilesError) throw error;
    throw new CheckpointFilesError();
  }
}

/** Complete a private restore copy without overwriting any existing file. */
export async function resumeCheckpointMedia(sourceScope, targetScope, inventory, options = {}) {
  try {
    const signal = selectedOptions(options), expected = closedInventory(inventory);
    const sourceRoot = await ready(sourceScope, null, signal);
    const targetRoot = await ready(targetScope, null, signal);
    if (identity(sourceRoot, targetRoot)) fail("INPUT");
    const source = await scan(sourceScope, sourceRoot, signal);
    await verify(sourceScope, expected, sourceRoot, signal, source);
    const existing = await scan(targetScope, targetRoot, signal);
    const names = new Set(existing.entries.map(entry => entry.name));
    const present = expected.files.filter(entry => names.has(entry.name));
    const retained = closedInventory({ files: present, bytes: present.reduce((sum, entry) => sum + entry.bytes, 0) });
    await verify(targetScope, retained, targetRoot, signal, existing);
    for (let index = 0; index < source.entries.length; index += 1) {
      const entry = source.entries[index];
      if (names.has(entry.name)) continue;
      const copied = await copyOne(sourceScope, sourceRoot, targetScope, targetRoot, entry, signal);
      if (copied.sha256 !== expected.files[index].sha256) fail("CHANGED");
    }
    await targetScope.sync();
    const copied = await scan(targetScope, targetRoot, signal);
    const kept = copied.entries.filter(entry => names.has(entry.name));
    sameScan(existing, { entries: kept, bytes: kept.reduce((sum, entry) => sum + entry.bytes, 0) });
    await verify(targetScope, expected, targetRoot, signal, copied);
    await verify(sourceScope, expected, sourceRoot, signal, source);
    sameScan(copied, await scan(targetScope, targetRoot, signal));
    await ready(targetScope, targetRoot, signal);
    return expected;
  } catch (error) {
    if (error instanceof CheckpointFilesError) throw error;
    throw new CheckpointFilesError();
  }
}

/** Read-only verification of an exact private inventory; never decrypts images. */
export async function verifyCheckpointMedia(scope, inventory, options = {}) {
  try {
    const signal = selectedOptions(options), expected = closedInventory(inventory);
    const root = await ready(scope, null, signal);
    return await verify(scope, expected, root, signal);
  } catch (error) {
    if (error instanceof CheckpointFilesError) throw error;
    throw new CheckpointFilesError();
  }
}
