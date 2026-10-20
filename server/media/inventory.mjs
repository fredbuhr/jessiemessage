import { createHash } from "node:crypto";
import { BACKUP_MEDIA_MAX_BYTES, BACKUP_MEDIA_MAX_FILES, BACKUP_MEDIA_MAX_OBJECTS } from "./backup-limits.mjs";

class InventoryStop extends Error { constructor(code) { super(code); this.code = code; } }
const stop = (code) => { throw new InventoryStop(code); };
const bytes = (value, length) => { if (!Buffer.isBuffer(value) || value.length !== length) stop("invalid_metadata"); return value; };
const natural = (value) => { try {
  if (!(typeof value === "bigint" || typeof value === "number" && Number.isSafeInteger(value)
    || typeof value === "string" && /^(?:0|[1-9][0-9]{0,19})$/.test(value))) throw new Error();
  const result = BigInt(value); if (result < 0n || result > 18446744073709551615n) throw new Error(); return result;
} catch { stop("invalid_metadata"); } };
const size = (value, max) => { if (!Number.isSafeInteger(value) || value < 1 || value > max) stop("invalid_metadata"); return value; };
const checkSignal = (signal) => { if (signal?.aborted) stop("aborted"); };
const millis = (value) => { if (!Number.isSafeInteger(value) || value < 0) stop("invalid_metadata"); return value; };
function normalize(row, journal = false) {
  if (!row || typeof row !== "object") stop("invalid_metadata");
  const result = { id: bytes(row.id, 16), ownerId: bytes(row.ownerId, 16), storageKey: bytes(row.storageKey, 32),
    fullBytes: size(row.fullBytes, 10485760), thumbnailBytes: size(row.thumbnailBytes, 524288) };
  result.storedBytes = BigInt(result.fullBytes + result.thumbnailBytes + 80);
  if (journal) {
    if (!["reserved", "registered", "cleanup_pending", "released"].includes(row.state) || natural(row.storedBytes) !== result.storedBytes) stop("invalid_metadata");
    Object.assign(result, { state: row.state, assetId: row.assetId === null ? null : bytes(row.assetId, 16) });
    if (result.state === "registered" && result.assetId === null || result.state === "reserved" && result.assetId !== null
      || result.assetId !== null && !result.assetId.equals(result.id)) stop("invalid_metadata");
  } else {
    if (typeof row.deleted !== "boolean") stop("invalid_metadata");
    result.deleted = row.deleted;
  }
  return result;
}
function canonical(row, journal) {
  return JSON.stringify([journal ? "object" : "asset", row.id.toString("hex"), row.ownerId.toString("hex"), row.storageKey.toString("hex"),
    row.fullBytes, row.thumbnailBytes, journal ? row.state : row.deleted, journal ? row.assetId?.toString("hex") ?? null : null]);
}
function bag() {
  const sum = Buffer.alloc(32); let count = 0;
  return { add(entry) {
    const hash = createHash("sha256").update(JSON.stringify([entry.storageKey.toString("hex"), entry.variant, entry.encryptedBytes.toString(), entry.mtimeMs, entry.status])).digest();
    for (let i = 0; i < sum.length; i++) sum[i] ^= hash[i]; count++;
  }, signature: () => `${count}:${sum.toString("hex")}` };
}
function statusValue(value) {
  if (!value || typeof value.ready !== "boolean" || !(value.rootFingerprint === null || Buffer.isBuffer(value.rootFingerprint) && value.rootFingerprint.length === 32)) stop("invalid_metadata");
  return { ready: value.ready, heldBytes: natural(value.heldBytes), pendingBytes: natural(value.pendingBytes), ownerBytes: natural(value.ownerBytes),
    totalBytes: natural(value.totalBytes), rootFingerprint: value.rootFingerprint };
}
function statusSignature(value) { return JSON.stringify([value.ready, String(value.heldBytes), String(value.pendingBytes), String(value.ownerBytes), String(value.totalBytes), value.rootFingerprint?.toString("hex") ?? null]); }

/** Bounded, read-only reconciliation. Envelope checks do not authenticate GCM. */
export async function inspectMediaInventory({ store, capacityStore, storage, capacity, minimumFreeBytes = 0n, limits = {}, signal } = {}) {
  for (const method of ["listAssets", "listObjects", "lookupStorageKey"]) if (typeof store?.[method] !== "function") throw new TypeError("An inventory reader is required");
  if (typeof capacityStore?.status !== "function") throw new TypeError("A capacity reader is required");
  for (const method of ["fingerprint", "inspectEntry", "scanEntries", "availableSpace"]) if (typeof storage?.[method] !== "function") throw new TypeError("A private storage reader is required");
  const maxObjects = limits.maxObjects ?? 100000, maxEntries = limits.maxEntries ?? 100000, maxIssues = limits.maxIssues ?? 100;
  if (!Number.isSafeInteger(maxObjects) || maxObjects < 1 || maxObjects > 100000 || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 100000
    || !Number.isSafeInteger(maxIssues) || maxIssues < 1 || maxIssues > 100) throw new TypeError("Bounded inventory limits are required");
  const minimumFree = natural(minimumFreeBytes), expectedCapacity = capacity ? { ownerBytes: natural(capacity.ownerBytes), totalBytes: natural(capacity.totalBytes) } : null;
  const report = { version: 1, integrity: "structure_only", complete: true, healthy: false, canInitialize: false,
    counts: { assets: 0, activeAssets: 0, deletedAssets: 0, journalObjects: 0, reserved: 0, cleanupPending: 0, released: 0,
      files: 0, knownPublished: 0, unknown: 0, staging: 0, missingActive: 0, missingDeleted: 0, blockingIssues: 0 },
    bytes: { declared: "0", observedEncrypted: "0", available: null }, capacity: null, backupAdmission: null, issues: [], issuesTruncated: false };
  const issue = (code, row = null, variant = null, blocking = true) => {
    if (blocking) report.counts.blockingIssues++;
    if (report.issues.length >= maxIssues) { report.issuesTruncated = true; stop("issue_limit"); }
    const item = { code };
    if (row) item[row.state ? "objectId" : "assetId"] = row.id.toString("hex");
    if (variant !== null) item.variant = variant;
    report.issues.push(item);
  };
  let declared = 0n, observedBytes = 0n;
  const expectedFiles = bag(), observedFiles = bag();
  async function* rows(journal) {
    let afterId = null;
    do {
      checkSignal(signal);
      const page = journal ? await store.listObjects({ afterId, limit: 100 }) : await store.listAssets({ afterId, limit: 100 });
      const values = page?.[journal ? "objects" : "assets"];
      if (!Array.isArray(values) || values.length > 100 || typeof page.hasMore !== "boolean" || page.hasMore !== (page.nextCursor !== null)
        || page.hasMore && values.length !== 100) stop("invalid_metadata");
      for (const raw of values) {
        const row = normalize(raw, journal);
        if (afterId !== null && Buffer.compare(row.id, afterId) <= 0) stop("invalid_metadata");
        afterId = row.id;
        yield row;
      }
      if (page.hasMore && (!Buffer.isBuffer(page.nextCursor) || !page.nextCursor.equals(afterId))) stop("invalid_metadata");
      if (!page.hasMore) break;
    } while (true);
  }
  async function lookup(storageKey) {
    const result = await store.lookupStorageKey({ storageKey });
    if (!result || !(result.asset === null || typeof result.asset === "object") || !(result.object === null || typeof result.object === "object")) stop("invalid_metadata");
    const asset = result.asset === null ? null : normalize(result.asset), object = result.object === null ? null : normalize(result.object, true);
    if (asset && !asset.storageKey.equals(storageKey) || object && !object.storageKey.equals(storageKey)) stop("invalid_metadata");
    return { asset, object };
  }
  function relationship(asset, object) {
    if (asset && object && (!object.assetId?.equals(asset.id) || !asset.ownerId.equals(object.ownerId)
      || asset.fullBytes !== object.fullBytes || asset.thumbnailBytes !== object.thumbnailBytes
      || (asset.deleted ? !["cleanup_pending", "released"].includes(object.state) : object.state !== "registered"))) return false;
    return !(object?.assetId && !asset);
  }
  function entryValue(entry) {
    if (!entry || !["published", "staging", "unknown"].includes(entry.kind) || !["structural_ok", "invalid_envelope", "unsafe", "unstable"].includes(entry.status)) stop("invalid_metadata");
    const result = { ...entry, encryptedBytes: natural(entry.encryptedBytes), mtimeMs: millis(entry.mtimeMs) };
    if (entry.kind !== "unknown") { bytes(entry.storageKey, 32); if (!["full", "thumb"].includes(entry.variant)) stop("invalid_metadata"); }
    return result;
  }
  function verifyFile(entry, row) {
    if (entry.status !== "structural_ok") issue(entry.status, row, entry.variant);
    if (entry.encryptedBytes !== BigInt((entry.variant === "full" ? row.fullBytes : row.thumbnailBytes) + 40)) issue("size_mismatch", row, entry.variant);
  }
  async function inspectExpected(row, asset = false) {
    for (const variant of ["full", "thumb"]) {
      checkSignal(signal);
      const result = await storage.inspectEntry({ storageKey: row.storageKey, variant });
      if (!result || typeof result.exists !== "boolean") stop("invalid_metadata");
      if (!result.exists) {
        if (asset) {
          report.counts[row.deleted ? "missingDeleted" : "missingActive"]++;
          if (!row.deleted) issue("missing_active", row, variant);
        }
        continue;
      }
      const entry = entryValue(result);
      if (entry.kind !== "published" || entry.variant !== variant || !entry.storageKey.equals(row.storageKey)) stop("invalid_metadata");
      expectedFiles.add(entry); verifyFile(entry, row);
      if (!asset && row.state === "released") issue("released_files_present", row, variant);
    }
  }
  async function sqlDigest(inspect) {
    const hash = createHash("sha256"); let count = 0;
    for (const journal of [false, true]) for await (const row of rows(journal)) {
      if (++count > maxObjects) stop("object_limit");
      hash.update(canonical(row, journal)).update("\n");
      if (!inspect) continue;
      if (!journal) {
        report.counts.assets++; report.counts[row.deleted ? "deletedAssets" : "activeAssets"]++; declared += row.storedBytes;
        const known = await lookup(row.storageKey);
        if (!known.asset || canonical(known.asset, false) !== canonical(row, false)) stop("sql_drift");
        if (!relationship(row, known.object)) issue("metadata_mismatch", row);
        if (initialStatus.ready && known.object === null) issue("unaccounted_asset", row);
        await inspectExpected(row, true);
      } else {
        report.counts.journalObjects++;
        if (!initialStatus.ready && report.counts.journalObjects === 1) issue("uninitialized_journal");
        if (row.state === "reserved") { report.counts.reserved++; issue("reserved_object", row); }
        if (row.state === "cleanup_pending") { report.counts.cleanupPending++; issue("cleanup_pending", row); }
        if (row.state === "released") report.counts.released++;
        const known = await lookup(row.storageKey);
        if (!known.object || canonical(known.object, true) !== canonical(row, true)) stop("sql_drift");
        if (!relationship(known.asset, row)) issue("metadata_mismatch", row);
        if (!known.asset) await inspectExpected(row);
      }
    }
    return hash.digest("hex");
  }
  let initialStatus;
  try {
    checkSignal(signal);
    const rootFingerprint = bytes(await storage.fingerprint(), 32);
    initialStatus = statusValue(await capacityStore.status());
    report.capacity = { ready: initialStatus.ready, heldBytes: String(initialStatus.heldBytes), pendingBytes: String(initialStatus.pendingBytes), ownerBytes: String(initialStatus.ownerBytes), totalBytes: String(initialStatus.totalBytes) };
    report.backupAdmission = { totalBytes: String(initialStatus.totalBytes < BigInt(BACKUP_MEDIA_MAX_BYTES) ? initialStatus.totalBytes : BACKUP_MEDIA_MAX_BYTES),
      maxObjects: BACKUP_MEDIA_MAX_OBJECTS, maxFiles: BACKUP_MEDIA_MAX_FILES };
    if (!initialStatus.rootFingerprint?.equals(rootFingerprint) || expectedCapacity && (initialStatus.ownerBytes !== expectedCapacity.ownerBytes || initialStatus.totalBytes !== expectedCapacity.totalBytes)) issue("capacity_binding_mismatch");
    const before = await sqlDigest(true);
    for await (const raw of storage.scanEntries({ maxEntries, signal })) {
      checkSignal(signal);
      if (++report.counts.files > maxEntries) stop("entry_limit");
      const entry = entryValue(raw); observedBytes += entry.encryptedBytes;
      if (entry.kind === "unknown") { report.counts.unknown++; issue("unknown_file"); continue; }
      const known = await lookup(entry.storageKey), row = known.asset ?? known.object;
      if (entry.kind === "staging") { report.counts.staging++; issue("staging_file", row, entry.variant); continue; }
      if (!row) { report.counts.unknown++; issue("unknown_file"); continue; }
      report.counts.knownPublished++; observedFiles.add(entry);
      if (!relationship(known.asset, known.object)) issue("metadata_mismatch", row);
      if (known.object?.state === "released") issue("released_files_present", known.object, entry.variant);
      verifyFile(entry, row);
    }
    if (expectedFiles.signature() !== observedFiles.signature()) stop("filesystem_drift");
    if (before !== await sqlDigest(false)) stop("sql_drift");
    if (!bytes(await storage.fingerprint(), 32).equals(rootFingerprint) || statusSignature(statusValue(await capacityStore.status())) !== statusSignature(initialStatus)) stop("sql_drift");
    const free = await storage.availableSpace();
    const available = natural(free?.availableBytes); report.bytes.available = String(available);
    if (available < minimumFree) issue("insufficient_free_space");
    checkSignal(signal);
  } catch (error) {
    report.complete = false;
    const code = signal?.aborted ? "aborted" : error instanceof InventoryStop ? error.code : error?.code === "MEDIA_SCAN_LIMIT" ? "entry_limit" : error?.code === "MEDIA_SCAN_ABORTED" ? "aborted" : "inventory_unavailable";
    try { issue(code); } catch {}
  }
  report.bytes.declared = String(declared); report.bytes.observedEncrypted = String(observedBytes);
  report.healthy = report.complete && report.counts.blockingIssues === 0;
  report.canInitialize = report.healthy && initialStatus?.ready === false;
  return report;
}
