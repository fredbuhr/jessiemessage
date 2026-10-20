import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { APPLICATION_COVERAGE, validateApplicationCoverage } from "./application-scope.mjs";
import { manifestBackupProfile, matchesCheckpointReceipt } from "./profiles.mjs";
import { BACKUP_MEDIA_MAX_BYTES, BACKUP_MEDIA_MAX_FILES } from "../media/backup-limits.mjs";

const MIB = 1024 * 1024;
const MAX_FILE = 64 * MIB, MAX_RECEIPT = 32 * MIB, MAX_MEDIA = BACKUP_MEDIA_MAX_BYTES, MAX_HASH = 2 * 1024 * MIB;
const FILE_NAMES = new Set(["database.sql", "database.sql.gz", "manifest.json", "manifest-after.json", "receipt.json", "checkpoint.tar.gz", "operations.enc.json"]);
const HEX = /^[a-f0-9]{64}$/;
const MEDIA_NAME = /^[a-f0-9]{64}\.(?:full|thumb)\.enc$/;
const STATS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const CODES = new Set(["CHECKPOINT_RECEIPT_INVALID", "CHECKPOINT_RECEIPT_UNAVAILABLE", "CHECKPOINT_RECEIPT_ABORTED"]);

export class CheckpointReceiptError extends Error {
  constructor(code = "CHECKPOINT_RECEIPT_UNAVAILABLE") {
    const selected = CODES.has(code) ? code : "CHECKPOINT_RECEIPT_UNAVAILABLE";
    super("Private checkpoint receipt operation failed.");
    this.name = "CheckpointReceiptError"; this.code = selected;
  }
}
const fail = (code) => { throw new CheckpointReceiptError(code); };
const active = (signal) => { if (signal?.aborted) fail("CHECKPOINT_RECEIPT_ABORTED"); };
const integer = (value, minimum, maximum) => Number.isSafeInteger(value) && value >= minimum && value <= maximum && !Object.is(value, -0);
const digest = (value) => typeof value === "string" && HEX.test(value);

function record(value, fields) {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("CHECKPOINT_RECEIPT_INVALID");
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length !== fields.length || names.some((name) => typeof name !== "string" || !fields.includes(name)
    || !descriptors[name].enumerable || !Object.hasOwn(descriptors[name], "value"))) fail("CHECKPOINT_RECEIPT_INVALID");
  return Object.fromEntries(fields.map((name) => [name, descriptors[name].value]));
}

function canonicalReceipt(value) {
  const version = value && typeof value === "object" && Object.getOwnPropertyDescriptor(value, "version")?.value;
  const application = [2, 4, 6, 8, 10].includes(version), operational = [9, 10].includes(version);
  const root = record(value, ["format", "version", "profile", ...(application ? ["coverage"] : []), "createdAt", "schema", "sql", "manifest", "media", ...(operational ? ["operations"] : [])]);
  if (application) {
    try { validateApplicationCoverage(root.coverage); }
    catch { fail("CHECKPOINT_RECEIPT_INVALID"); }
  }
  const schema = record(root.schema, ["tables", "migrations"]);
  const sql = record(root.sql, ["file", "bytes", "sha256", "uncompressedBytes", "uncompressedSha256"]);
  const manifest = record(root.manifest, ["file", "sha256"]), media = record(root.media, ["files", "bytes"]);
  if (root.format !== "jessiemessage-private-checkpoint"
    || !matchesCheckpointReceipt(manifestBackupProfile(root.profile), root) || !integer(root.version, 1, 10)
    || !integer(root.createdAt, 0, 253402300799999) || schema.tables !== 30 || schema.migrations !== 30
    || sql.file !== "database.sql.gz" || !integer(sql.bytes, 1, 16 * MIB) || !digest(sql.sha256)
    || !integer(sql.uncompressedBytes, 1, MAX_FILE) || !digest(sql.uncompressedSha256)
    || manifest.file !== "manifest.json" || !digest(manifest.sha256)
    || !integer(media.bytes, 0, MAX_MEDIA) || !Array.isArray(media.files) || media.files.length > BACKUP_MEDIA_MAX_FILES
    || Object.getPrototypeOf(media.files) !== Array.prototype) fail("CHECKPOINT_RECEIPT_INVALID");
  const fields = Object.getOwnPropertyDescriptors(media.files), names = Reflect.ownKeys(fields);
  if (names.length !== media.files.length + 1 || !Object.hasOwn(fields.length ?? {}, "value")) fail("CHECKPOINT_RECEIPT_INVALID");
  const files = []; let total = 0, previous = null;
  for (let index = 0; index < media.files.length; index++) {
    const descriptor = fields[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail("CHECKPOINT_RECEIPT_INVALID");
    const file = record(descriptor.value, ["name", "bytes", "sha256"]);
    if (typeof file.name !== "string" || !MEDIA_NAME.test(file.name) || previous !== null && previous >= file.name
      || !integer(file.bytes, 1, 10 * MIB + 128) || !digest(file.sha256)) fail("CHECKPOINT_RECEIPT_INVALID");
    total += file.bytes; if (total > MAX_MEDIA) fail("CHECKPOINT_RECEIPT_INVALID");
    previous = file.name; files.push(file);
  }
  if (total !== media.bytes) fail("CHECKPOINT_RECEIPT_INVALID");
  const operations = operational ? record(root.operations, ["file", "bytes", "sha256"]) : null;
  if (operational && (operations.file !== "operations.enc.json" || !integer(operations.bytes, 1, MAX_FILE) || !digest(operations.sha256))) fail("CHECKPOINT_RECEIPT_INVALID");
  return { format: root.format, version: root.version, profile: root.profile,
    ...(application ? { coverage: { ...APPLICATION_COVERAGE } } : {}), createdAt: root.createdAt,
    schema, sql, manifest, media: { files, bytes: total }, ...(operational ? { operations } : {}) };
}

function regular(stats) {
  if (!stats.isFile() || typeof process.getuid !== "function" || stats.uid !== BigInt(process.getuid())
    || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n) fail();
}
function unchanged(before, after) { if (STATS.some((name) => before[name] !== after[name])) fail(); }
function scopeReady(scope) {
  if (typeof scope?.file !== "function" || typeof scope?.assertReady !== "function") fail();
  return scope.assertReady();
}
function bounds(name, maximum) {
  if (!FILE_NAMES.has(name) || !integer(maximum, 1, MAX_HASH)) fail("CHECKPOINT_RECEIPT_INVALID");
}

async function readPrivateFile(scope, name, { signal, maxBytes, collect = false }) {
  let handle, buffer, content;
  try {
    bounds(name, maxBytes); active(signal); await scopeReady(scope); active(signal);
    const filename = scope.file(name), initial = await lstat(filename, { bigint: true }); regular(initial);
    if (initial.size < 1n || initial.size > BigInt(maxBytes)) fail();
    handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await handle.stat({ bigint: true }); regular(before); unchanged(initial, before);
    buffer = Buffer.alloc(64 * 1024); if (collect) content = Buffer.alloc(Number(before.size));
    const hash = createHash("sha256"); let bytes = 0;
    while (bytes < Number(before.size)) {
      active(signal);
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - bytes), bytes);
      if (bytesRead === 0) fail();
      hash.update(buffer.subarray(0, bytesRead));
      if (content) buffer.copy(content, bytes, 0, bytesRead);
      bytes += bytesRead; buffer.fill(0);
    }
    active(signal);
    const after = await handle.stat({ bigint: true }); regular(after); unchanged(before, after);
    const visible = await lstat(filename, { bigint: true }); regular(visible); unchanged(after, visible);
    await scopeReady(scope); active(signal);
    return { bytes, sha256: hash.digest("hex"), ...(collect ? { content } : {}) };
  } catch (error) {
    content?.fill(0);
    if (error instanceof CheckpointReceiptError) throw error;
    fail();
  } finally {
    buffer?.fill(0);
    try { await handle?.close(); } catch { content?.fill(0); fail(); }
  }
}

/** Hash only the closed checkpoint inventory; each read buffer is bounded and erased. */
export async function hashCheckpointFile(scope, name, { signal, maxBytes = MAX_FILE } = {}) {
  return readPrivateFile(scope, name, { signal, maxBytes });
}

export async function readCheckpointReceipt(scope, { signal } = {}) {
  let content;
  try {
    ({ content } = await readPrivateFile(scope, "receipt.json", { signal, maxBytes: MAX_RECEIPT, collect: true }));
    active(signal);
    let parsed;
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content)); }
    catch { fail("CHECKPOINT_RECEIPT_INVALID"); }
    const receipt = canonicalReceipt(parsed), canonical = Buffer.from(`${JSON.stringify(receipt)}\n`, "utf8");
    try { if (!canonical.equals(content)) fail("CHECKPOINT_RECEIPT_INVALID"); }
    finally { canonical.fill(0); }
    const manifest = await hashCheckpointFile(scope, "manifest.json", { signal });
    if (manifest.sha256 !== receipt.manifest.sha256) fail("CHECKPOINT_RECEIPT_INVALID");
    await scopeReady(scope); active(signal);
    return receipt;
  } catch (error) {
    if (error instanceof CheckpointReceiptError) throw error;
    fail();
  } finally { content?.fill(0); }
}

/** Publish once, then reread the receipt and its original raw manifest binding. */
export async function writeCheckpointReceipt(scope, value, { signal } = {}) {
  let handle, content;
  try {
    active(signal);
    const receipt = canonicalReceipt(value);
    content = Buffer.from(`${JSON.stringify(receipt)}\n`, "utf8");
    if (content.length > MAX_RECEIPT) fail("CHECKPOINT_RECEIPT_INVALID");
    const manifest = await hashCheckpointFile(scope, "manifest.json", { signal });
    if (manifest.sha256 !== receipt.manifest.sha256) fail("CHECKPOINT_RECEIPT_INVALID");
    await scopeReady(scope); active(signal);
    const filename = scope.file("receipt.json");
    handle = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    const before = await handle.stat({ bigint: true }); regular(before);
    await handle.writeFile(content); active(signal); await handle.sync();
    const after = await handle.stat({ bigint: true }); regular(after);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== BigInt(content.length)) fail();
    const visible = await lstat(filename, { bigint: true }); regular(visible); unchanged(after, visible);
    await scopeReady(scope); active(signal);
    if (typeof scope.sync !== "function") fail();
    await scope.sync(); await scopeReady(scope); active(signal);
    await handle.close(); handle = null;
    return await readCheckpointReceipt(scope, { signal });
  } catch (error) {
    if (error instanceof CheckpointReceiptError) throw error;
    fail();
  } finally {
    content?.fill(0);
    try { await handle?.close(); } catch { fail(); }
  }
}
