import { createHash } from "node:crypto";
import { VIDEO_BLOCK_BYTES, MAX_VIDEO_BYTES, videoStoredBytes } from "../video/storage.mjs";
import { BACKUP_MEDIA_MAX_BYTES } from "../media/backup-limits.mjs";

export class VideoBackupInventoryError extends Error {
  constructor() { super("Private video backup inventory is unavailable."); this.name = "VideoBackupInventoryError"; this.code = "BACKUP_VIDEO_INVENTORY"; }
}
class InventoryStop extends Error { constructor(code) { super(code); this.code = code; } }
const stop = code => { throw new InventoryStop(code); };
const hex = (value, size) => typeof value === "string" && new RegExp(`^[a-f0-9]{${size * 2}}$`).test(value);
const integer = (value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum && value <= maximum;
const active = signal => { if (signal?.aborted) stop("aborted"); };
function date(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/.test(value)) return false;
  const iso = `${value.slice(0, 23).replace(" ", "T")}Z`, instant = Date.parse(iso);
  return Number.isSafeInteger(instant) && instant >= 0 && new Date(instant).toISOString() === iso;
}
function fields(value, expected) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) stop("invalid_metadata");
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length !== expected.length || names.some(name => typeof name !== "string" || !expected.includes(name)
    || !descriptors[name].enumerable || !Object.hasOwn(descriptors[name], "value"))) stop("invalid_metadata");
  return Object.fromEntries(expected.map(name => [name, descriptors[name].value]));
}
function catalog(value, maxObjects) {
  const video = fields(value, ["capacity", "assets"]);
  const capacity = fields(video.capacity, ["ownerBytes", "totalBytes", "heldBytes", "rootFingerprint", "initializedAt"]);
  if (!integer(capacity.ownerBytes, 1) || !integer(capacity.totalBytes, capacity.ownerBytes) || !integer(capacity.heldBytes, 0, capacity.totalBytes)
    || !hex(capacity.rootFingerprint, 32) || !date(capacity.initializedAt) || !Array.isArray(video.assets)
    || Object.getPrototypeOf(video.assets) !== Array.prototype || video.assets.length > maxObjects) stop("invalid_metadata");
  const properties = Object.getOwnPropertyDescriptors(video.assets);
  if (Reflect.ownKeys(properties).length !== video.assets.length + 1) stop("invalid_metadata");
  let previous = null, held = 0; const assets = [], keys = new Set(), ownerHeld = new Map();
  for (let index = 0; index < video.assets.length; index++) {
    const descriptor = properties[String(index)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) stop("invalid_metadata");
    const row = fields(descriptor.value, ["id", "owner_id", "owner_role", "storage_key", "reserve_token_hash", "content_digest", "bytes", "stored_bytes", "mime", "state", "created_at", "updated_at", "released_at"]);
    if (!hex(row.id, 16) || previous !== null && row.id <= previous || !hex(row.owner_id, 16) || !["admin", "client"].includes(row.owner_role)
      || !hex(row.storage_key, 32) || keys.has(row.storage_key) || !hex(row.reserve_token_hash, 32)
      || !(row.content_digest === null || hex(row.content_digest, 32)) || !integer(row.bytes, 1, MAX_VIDEO_BYTES)
      || row.stored_bytes !== videoStoredBytes(row.bytes) || row.mime !== "video/mp4"
      || !["reserved", "committed", "cleanup_pending", "released"].includes(row.state)
      || !date(row.created_at) || !date(row.updated_at) || row.updated_at < row.created_at
      || !(row.released_at === null || date(row.released_at) && row.released_at >= row.created_at && row.released_at <= row.updated_at)
      || (row.state === "released") !== (row.released_at !== null) || row.state === "reserved" && row.content_digest !== null
      || row.state === "committed" && row.content_digest === null) stop("invalid_metadata");
    if (row.state !== "released") {
      held += row.stored_bytes; if (!integer(held) || held > capacity.totalBytes) stop("invalid_metadata");
      const owner = `${row.owner_role}:${row.owner_id}`, charged = (ownerHeld.get(owner) ?? 0) + row.stored_bytes;
      if (!integer(charged) || charged > capacity.ownerBytes) stop("invalid_metadata"); ownerHeld.set(owner, charged);
    }
    previous = row.id; keys.add(row.storage_key); assets.push(row);
  }
  if (held !== capacity.heldBytes) stop("capacity_accounting_mismatch");
  return { capacity, assets };
}
function entry(value) {
  if (!value || !["published", "staging", "unknown"].includes(value.kind)
    || !["structural_ok", "invalid_envelope", "unsafe", "unstable"].includes(value.status)
    || typeof value.encryptedBytes !== "bigint" || value.encryptedBytes < 0n || !integer(value.mtimeMs)
    || value.kind !== "unknown" && (!Buffer.isBuffer(value.storageKey) || value.storageKey.length !== 32)) stop("invalid_metadata");
  return value;
}
function signature(value) {
  return JSON.stringify([value.kind, value.storageKey?.toString("hex") ?? null, value.encryptedBytes.toString(), value.mtimeMs, value.status]);
}

/** Reconcile a transactionally captured SQL catalogue against its separately
 * bound private root. Authentication consumes and erases one video block at a
 * time; it never returns plaintext or buffers a complete video. */
export async function inspectVideoBackupInventory({ video, storage, signal, limits = {}, minimumFreeBytes = 0n, authenticate = true, expectedRootFingerprint } = {}) {
  const maxObjects = limits.maxObjects ?? 100000, maxEntries = limits.maxEntries ?? 100000, maxIssues = limits.maxIssues ?? 100;
  if (!["fingerprint", "inspectEntry", "scanEntries", "availableSpace"].every(method => typeof storage?.[method] === "function")
    || authenticate && typeof storage.open !== "function" || typeof authenticate !== "boolean"
    || !integer(maxObjects, 1, 100000) || !integer(maxEntries, 1, 100000) || !integer(maxIssues, 1, 100)
    || typeof minimumFreeBytes !== "bigint" || minimumFreeBytes < 0n || expectedRootFingerprint !== undefined && !hex(expectedRootFingerprint, 32) || signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError("A bounded private video inventory reader is required.");
  const report = { version: 1, integrity: authenticate ? "authenticated" : "structure_only", complete: true, healthy: false,
    rootFingerprint: null, capacity: null,
    counts: { assets: 0, committed: 0, reserved: 0, cleanupPending: 0, released: 0, files: 0, staging: 0, unknown: 0, authenticated: 0, blockingIssues: 0 },
    bytes: { declared: "0", observedEncrypted: "0", available: null },
    backupAdmission: { maxBytes: String(BACKUP_MEDIA_MAX_BYTES), maxFiles: maxObjects }, issues: [], issuesTruncated: false };
  const issue = (code, row = null) => {
    report.counts.blockingIssues++;
    if (report.issues.length >= maxIssues) { report.issuesTruncated = true; stop("issue_limit"); }
    report.issues.push({ code, ...(row ? { assetId: row.id } : {}) });
  };
  let observedBytes = 0n;
  try {
    active(signal); const source = catalog(video, maxObjects);
    report.capacity = { ...source.capacity }; report.bytes.declared = String(source.capacity.heldBytes);
    if (source.capacity.heldBytes > BACKUP_MEDIA_MAX_BYTES) issue("backup_byte_limit");
    const fingerprint = await storage.fingerprint();
    if (!Buffer.isBuffer(fingerprint) || fingerprint.length !== 32) stop("invalid_metadata");
    report.rootFingerprint = fingerprint.toString("hex");
    if (report.rootFingerprint !== (expectedRootFingerprint ?? source.capacity.rootFingerprint)) stop("capacity_binding_mismatch");
    const byKey = new Map(source.assets.map(row => [row.storage_key, row])), expected = new Map();
    for (const row of source.assets) {
      active(signal); report.counts.assets++;
      report.counts[row.state === "cleanup_pending" ? "cleanupPending" : row.state]++;
      const storageKey = Buffer.from(row.storage_key, "hex"), observed = await storage.inspectEntry({ storageKey });
      if (!observed || typeof observed.exists !== "boolean") stop("invalid_metadata");
      if (!observed.exists) { if (row.state === "committed") issue("missing_committed", row); continue; }
      const value = entry(observed);
      if (value.kind !== "published" || !value.storageKey.equals(storageKey)) stop("invalid_metadata");
      expected.set(row.storage_key, signature(value));
      if (value.status !== "structural_ok") issue(value.status, row);
      if (value.encryptedBytes !== BigInt(row.stored_bytes)) issue("size_mismatch", row);
      if (row.state === "released") issue("released_file_present", row);
      if (!authenticate || row.state === "released" || value.status !== "structural_ok" || value.encryptedBytes !== BigInt(row.stored_bytes)) continue;
      let reader;
      try {
        reader = await storage.open({ assetId: Buffer.from(row.id, "hex"), storageKey });
        if (!reader || reader.bytes !== row.bytes || reader.storedBytes !== row.stored_bytes || typeof reader.stream !== "function" || typeof reader.close !== "function") stop("invalid_metadata");
        const hash = createHash("sha256"); let plaintextBytes = 0;
        for await (const block of reader.stream({ signal })) {
          try {
            active(signal);
            if (!Buffer.isBuffer(block) || block.length < 1 || block.length > VIDEO_BLOCK_BYTES || plaintextBytes + block.length > row.bytes) stop("invalid_video_stream");
            plaintextBytes += block.length; hash.update(block);
          } finally { if (Buffer.isBuffer(block)) block.fill(0); }
        }
        const digest = hash.digest("hex");
        if (plaintextBytes !== row.bytes || row.content_digest !== null && digest !== row.content_digest) issue("content_digest_mismatch", row);
        else report.counts.authenticated++;
      } catch (error) {
        if (signal?.aborted) stop("aborted");
        if (error instanceof InventoryStop) throw error;
        issue("authentication_failed", row);
      } finally { await reader?.close(); }
    }
    const seen = new Set();
    for await (const raw of storage.scanEntries({ maxEntries, signal })) {
      active(signal); const value = entry(raw); if (++report.counts.files > maxEntries) stop("entry_limit");
      observedBytes += value.encryptedBytes;
      if (observedBytes > BigInt(BACKUP_MEDIA_MAX_BYTES)) issue("backup_byte_limit");
      if (value.kind === "unknown") { report.counts.unknown++; issue("unknown_file"); continue; }
      const key = value.storageKey.toString("hex"), row = byKey.get(key);
      if (value.kind === "staging") { report.counts.staging++; issue("staging_file", row); continue; }
      if (!row) { report.counts.unknown++; issue("orphan_file"); continue; }
      if (seen.has(key)) stop("filesystem_drift"); seen.add(key);
      if (expected.get(key) !== signature(value)) stop("filesystem_drift");
    }
    if (seen.size !== expected.size) stop("filesystem_drift");
    const after = await storage.fingerprint();
    if (!Buffer.isBuffer(after) || after.length !== 32 || !after.equals(fingerprint)) stop("root_changed");
    const free = await storage.availableSpace();
    if (!free || typeof free.availableBytes !== "bigint" || free.availableBytes < 0n) stop("invalid_metadata");
    report.bytes.available = String(free.availableBytes);
    if (free.availableBytes < minimumFreeBytes) issue("insufficient_free_space");
    active(signal);
  } catch (error) {
    report.complete = false;
    const code = signal?.aborted ? "aborted" : error instanceof InventoryStop ? error.code : error?.code === "VIDEO_SCAN_LIMIT" ? "entry_limit" : "inventory_unavailable";
    try { issue(code); } catch {}
  }
  report.bytes.observedEncrypted = String(observedBytes);
  report.healthy = report.complete && report.counts.blockingIssues === 0;
  return report;
}

export async function assertVideoBackupInventory(options) {
  const result = await inspectVideoBackupInventory(options);
  if (!result.complete || !result.healthy) throw new VideoBackupInventoryError();
  return result;
}
