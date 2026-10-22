import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { erasureBinding, ERASURE_PHASES } from "../data/erasure-state.mjs";
import { verifyScopedErasureJournalEnvelope, erasureJournalBindings } from "../data/erasure-journal.mjs";
import { verifyPrivacyEnvelope } from "../privacy/files.mjs";
import { QUICK_REPLIES_FILENAME_PATTERN, QUICK_REPLIES_LOCK_PATTERN, QUICK_REPLIES_FILE_MAX_BYTES, verifyQuickRepliesEnvelope } from "../quick-replies/files.mjs";

const NAMESPACE = "jessiemessage:operational-checkpoint:https://jessiemessage.com:v1";
const VIDEO_NAMESPACE = "jessiemessage:operational-checkpoint:https://jessiemessage.com:v2:video";
const MAX_BYTES = 64 * 1024 * 1024, MAX_FILES = 9990, MAX_STATE_FILE_BYTES = 42 * 1024 * 1024;
const NAME = /^(?:privacy-preparation\.json|erasure-[a-f0-9]{64}\.json)$/;
const admittedName = name => NAME.test(name) || QUICK_REPLIES_FILENAME_PATTERN.test(name);
const fileMaximum = name => name === "privacy-preparation.json" ? 65536
  : QUICK_REPLIES_FILENAME_PATTERN.test(name) ? QUICK_REPLIES_FILE_MAX_BYTES : 4096;
const HEX = /^[a-f0-9]{64}$/;
const STATS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
export const OPERATIONAL_CHECKPOINT = "operations.enc.json";
export const OPERATIONAL_RESTORE_MARKER = "operational-restore.json";
export class OperationalCheckpointError extends Error {
  constructor(code = "OPERATIONS_UNAVAILABLE") { super("Private operational recovery was not confirmed."); this.name = "OperationalCheckpointError"; this.code = code; }
}
const fail = code => { throw new OperationalCheckpointError(code); };
const hash = value => createHash("sha256").update(value).digest("hex");
const same = (a, b) => STATS.every(name => a[name] === b[name]);
const active = signal => { if (signal?.aborted) fail("OPERATIONS_ABORTED"); };
function fields(value, names) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length !== names.length
    || names.some(name => !Object.hasOwn(value, name) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), "value"))) fail("OPERATIONS_INPUT");
}
function regular(stats, maximum) {
  if (!stats.isFile() || stats.uid !== BigInt(process.getuid()) || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n
    || stats.size < 1n || stats.size > BigInt(maximum)) fail("OPERATIONS_UNSAFE");
}
function encoded(value, maximum, exact) {
  if (typeof value !== "string" || value.length > Math.ceil(maximum * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) fail("OPERATIONS_INPUT");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < 1 || bytes.length > maximum || exact && bytes.length !== exact || bytes.toString("base64url") !== value) fail("OPERATIONS_INPUT");
  return bytes;
}
async function readFile(scope, name, maximum, signal) {
  let file, bytes;
  try {
    active(signal); await scope.assertReady();
    const visible = await lstat(scope.file(name), { bigint: true }); regular(visible, maximum);
    file = await open(scope.file(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat({ bigint: true }); regular(before, maximum);
    if (!same(before, visible)) fail("OPERATIONS_CHANGED");
    bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
    while (length < bytes.length) {
      active(signal); const part = await file.read(bytes, length, bytes.length - length, length);
      if (part.bytesRead === 0) break; length += part.bytesRead;
    }
    const after = await file.stat({ bigint: true }), final = await lstat(scope.file(name), { bigint: true });
    regular(after, maximum); regular(final, maximum);
    if (length !== Number(before.size) || !same(before, after) || !same(after, final)) fail("OPERATIONS_CHANGED");
    await scope.assertReady(); active(signal); return Buffer.from(bytes.subarray(0, length));
  } finally { bytes?.fill(0); await file?.close(); }
}
async function writeFile(scope, name, content, signal) {
  let file;
  try {
    active(signal); await scope.assertReady();
    file = await open(scope.file(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    const before = await file.stat({ bigint: true });
    await file.writeFile(content); await file.sync();
    const after = await file.stat({ bigint: true }); regular(after, MAX_BYTES);
    if (before.dev !== after.dev || before.ino !== after.ino || after.size !== BigInt(content.length)
      || !same(after, await lstat(scope.file(name), { bigint: true }))) fail("OPERATIONS_CHANGED");
    await scope.sync(); await scope.assertReady(); active(signal);
  } finally { await file?.close(); }
}
async function safe(work) {
  try { return await work(); }
  catch (error) { if (error instanceof OperationalCheckpointError) throw error; fail(); }
}
async function names(scope, allowRestoreMarker = false) {
  await scope.assertReady(); const result = []; let count = 0;
  const directory = await opendir(scope.path);
  for await (const entry of directory) {
    if (++count > 10000) fail("OPERATIONS_LIMIT");
    if (entry.name === OPERATIONAL_RESTORE_MARKER && !allowRestoreMarker) fail("OPERATIONS_RECONCILIATION_REQUIRED");
    if (entry.name === "privacy-preparation.lock" || /^erasure-.*\.lock$/.test(entry.name)
      || QUICK_REPLIES_LOCK_PATTERN.test(entry.name)
      || entry.name.startsWith(".quick-replies-") && entry.name.endsWith(".tmp")) fail("OPERATIONS_BUSY");
    if (entry.name.startsWith("erasure-") && entry.name.endsWith(".json") && !NAME.test(entry.name)) fail("OPERATIONS_INPUT");
    if (entry.name.startsWith("quick-replies-") && entry.name.endsWith(".json") && !QUICK_REPLIES_FILENAME_PATTERN.test(entry.name)) fail("OPERATIONS_INPUT");
    if (admittedName(entry.name)) result.push(entry.name);
  }
  if (result.length > MAX_FILES) fail("OPERATIONS_LIMIT");
  await scope.assertReady(); return result.sort();
}
function state(value, key) {
  const video = value?.version === 2;
  fields(value, ["version", "binding", ...(video ? ["legacyBinding"] : []), "files"]);
  const binding = erasureBinding(value.binding), scopes = erasureJournalBindings(binding);
  if (video !== Object.hasOwn(binding, "videoRootFingerprint") || value.version !== (video ? 2 : 1)
    || video && JSON.stringify(erasureBinding(value.legacyBinding)) !== JSON.stringify(scopes.legacyBinding)
    || !Buffer.isBuffer(key) || key.length !== 32 || !Array.isArray(value.files)
    || Object.getPrototypeOf(value.files) !== Array.prototype || value.files.length > MAX_FILES
    || Reflect.ownKeys(value.files).length !== value.files.length + 1) fail("OPERATIONS_INPUT");
  let previous = null, total = 0; const jobs = new Map(), quickReplies = new Map(); let privacy = null;
  for (let index = 0; index < value.files.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value.files, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("OPERATIONS_INPUT");
    const file = descriptor.value; fields(file, ["name", "content"]);
    if (typeof file.name !== "string" || !admittedName(file.name) || previous !== null && file.name <= previous) fail("OPERATIONS_INPUT");
    const content = encoded(file.content, fileMaximum(file.name));
    try {
      total += content.length; if (total > MAX_STATE_FILE_BYTES) fail("OPERATIONS_LIMIT");
      if (file.name === "privacy-preparation.json") privacy = { ...verifyPrivacyEnvelope(content, key), file };
      else if (QUICK_REPLIES_FILENAME_PATTERN.test(file.name)) quickReplies.set(file.name, { ...verifyQuickRepliesEnvelope(content, key, file.name), file });
      else jobs.set(file.name, { ...verifyScopedErasureJournalEnvelope({ key, binding, ...(video ? { legacyBinding: scopes.legacyBinding } : {}), filename: file.name, content }), file });
    } finally { content.fill(0); }
    previous = file.name;
  }
  return { value: { version: video ? 2 : 1, binding, ...(video ? { legacyBinding: scopes.legacyBinding } : {}), files: value.files.map(file => ({ name: file.name, content: file.content })) }, jobs, privacy, quickReplies };
}
export const operationalStateHash = value => hash(JSON.stringify(value));

/** Two complete inventories and byte comparisons detect a publication during
 * capture. The caller must additionally hold real producer quiescence. */
async function readState(scope, { key, binding, signal }, allowRestoreMarker = false) {
  const selected = await names(scope, allowRestoreMarker), files = []; let total = 0;
  for (const name of selected) {
    const content = await readFile(scope, name, fileMaximum(name), signal);
    try {
      total += content.length; if (total > MAX_STATE_FILE_BYTES) fail("OPERATIONS_LIMIT");
      files.push({ name, content: content.toString("base64url") });
    } finally { content.fill(0); }
  }
  const video = Object.hasOwn(binding, "videoRootFingerprint");
  const checked = state({ version: video ? 2 : 1, ...erasureJournalBindings(binding), files }, key).value;
  if (JSON.stringify(await names(scope, allowRestoreMarker)) !== JSON.stringify(selected)) fail("OPERATIONS_CHANGED");
  for (const file of checked.files) {
    const content = await readFile(scope, file.name, fileMaximum(file.name), signal);
    try { if (content.toString("base64url") !== file.content) fail("OPERATIONS_CHANGED"); } finally { content.fill(0); }
  }
  if (JSON.stringify(await names(scope, allowRestoreMarker)) !== JSON.stringify(selected)) fail("OPERATIONS_CHANGED");
  active(signal); return checked;
}
export async function captureOperationalState(scope, { key, binding, signal }) {
  return safe(() => readState(scope, { key, binding, signal }));
}

/** Inspect a complete quarantine without changing its source-bound envelopes or
 * its startup-blocking marker. This read is never permission to open a runtime. */
export async function readOperationalQuarantine(scope, { key, sourceBinding, targetBinding, signal }) {
  return safe(async () => {
    const source = erasureBinding(sourceBinding), target = erasureBinding(targetBinding);
    if (Object.hasOwn(source, "videoRootFingerprint") !== Object.hasOwn(target, "videoRootFingerprint")) fail("OPERATIONS_BINDING_CHANGED");
    let content, final;
    try {
      content = await readFile(scope, OPERATIONAL_RESTORE_MARKER, 4096, signal);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(content), value = JSON.parse(text);
      fields(value, ["version", "status", "backupSha256", "currentSha256", "mergedSha256", "sourceBinding", "targetBinding"]);
      const version = Object.hasOwn(source, "videoRootFingerprint") ? 2 : 1;
      if (value.version !== version || value.status !== "reconciliation_required"
        || ![value.backupSha256, value.currentSha256, value.mergedSha256].every(value => typeof value === "string" && HEX.test(value))) fail("OPERATIONS_INPUT");
      const marker = { version, status: "reconciliation_required", backupSha256: value.backupSha256,
        currentSha256: value.currentSha256, mergedSha256: value.mergedSha256,
        sourceBinding: erasureBinding(value.sourceBinding), targetBinding: erasureBinding(value.targetBinding) };
      if (`${JSON.stringify(marker)}\n` !== text) fail("OPERATIONS_INPUT");
      if (JSON.stringify(marker.sourceBinding) !== JSON.stringify(source)
        || JSON.stringify(marker.targetBinding) !== JSON.stringify(target)) fail("OPERATIONS_BINDING_CHANGED");
      const current = await readState(scope, { key, binding: source, signal }, true), stateSha256 = operationalStateHash(current);
      if (stateSha256 !== marker.mergedSha256) fail("OPERATIONS_CHANGED");
      final = await readFile(scope, OPERATIONAL_RESTORE_MARKER, 4096, signal);
      if (!final.equals(content)) fail("OPERATIONS_CHANGED");
      await scope.assertReady(); active(signal);
      return { marker, state: current, markerSha256: hash(content), stateSha256 };
    } finally { content?.fill(0); final?.fill(0); }
  });
}
function context(receipt) {
  if (![9, 10, 12].includes(receipt?.version) || typeof receipt.profile !== "string" || !HEX.test(receipt.manifest?.sha256 ?? "")
    || !HEX.test(receipt.sql?.sha256 ?? "")) fail("OPERATIONS_INPUT");
  if (receipt.version === 12 && (receipt.profile !== "messaging-photos-notify-recovery-crm-broadcast-video-application"
    || !receipt.video || typeof receipt.video !== "object" || Array.isArray(receipt.video))) fail("OPERATIONS_INPUT");
  return { version: receipt.version, profile: receipt.profile, createdAt: receipt.createdAt,
    manifestSha256: receipt.manifest.sha256, sqlSha256: receipt.sql.sha256, mediaSha256: hash(JSON.stringify(receipt.media)),
    ...(receipt.version === 12 ? { videoSha256: hash(JSON.stringify(receipt.video)) } : {}) };
}
function secret(key, namespace = NAMESPACE) {
  if (!Buffer.isBuffer(key) || key.length !== 32) fail("OPERATIONS_INPUT");
  return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), Buffer.from(namespace), 32));
}
export async function writeOperationalCheckpoint(scope, value, receipt, key, { signal } = {}) {
  return safe(async () => {
    const checked = state(value, key).value, version = receipt?.version === 12 ? 2 : 1, namespace = version === 2 ? VIDEO_NAMESPACE : NAMESPACE;
    if (checked.version !== version) fail("OPERATIONS_INPUT");
    const derived = secret(key, namespace), plaintext = Buffer.from(JSON.stringify(checked));
    let content;
    try {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", derived, iv);
      cipher.setAAD(Buffer.from(`${namespace}:${JSON.stringify(context(receipt))}`));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      content = Buffer.from(`${JSON.stringify({ version, iv: iv.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") })}\n`);
      if (content.length > MAX_BYTES) fail("OPERATIONS_LIMIT");
      await writeFile(scope, OPERATIONAL_CHECKPOINT, content, signal);
      const saved = await readFile(scope, OPERATIONAL_CHECKPOINT, MAX_BYTES, signal);
      try { if (!saved.equals(content)) fail("OPERATIONS_CHANGED"); } finally { saved.fill(0); }
      return { file: OPERATIONAL_CHECKPOINT, bytes: content.length, sha256: hash(content) };
    } finally { derived.fill(0); plaintext.fill(0); content?.fill(0); }
  });
}
export async function readOperationalCheckpoint(scope, receipt, key, { signal } = {}) {
  return safe(async () => {
    fields(receipt.operations, ["file", "bytes", "sha256"]);
    if (receipt.operations.file !== OPERATIONAL_CHECKPOINT || !Number.isSafeInteger(receipt.operations.bytes)
      || receipt.operations.bytes < 1 || receipt.operations.bytes > MAX_BYTES || !HEX.test(receipt.operations.sha256)) fail("OPERATIONS_INPUT");
    const version = receipt?.version === 12 ? 2 : 1, namespace = version === 2 ? VIDEO_NAMESPACE : NAMESPACE;
    const content = await readFile(scope, OPERATIONAL_CHECKPOINT, MAX_BYTES, signal), derived = secret(key, namespace);
    let plaintext, tail;
    try {
      if (content.length !== receipt.operations.bytes || hash(content) !== receipt.operations.sha256) fail("OPERATIONS_CHANGED");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(content), envelope = JSON.parse(text);
      fields(envelope, ["version", "iv", "ciphertext", "tag"]);
      if (envelope.version !== version || `${JSON.stringify(envelope)}\n` !== text) fail("OPERATIONS_INPUT");
      const decipher = createDecipheriv("aes-256-gcm", derived, encoded(envelope.iv, 12, 12));
      decipher.setAAD(Buffer.from(`${namespace}:${JSON.stringify(context(receipt))}`)); decipher.setAuthTag(encoded(envelope.tag, 16, 16));
      plaintext = decipher.update(encoded(envelope.ciphertext, MAX_BYTES)); tail = decipher.final();
      if (tail.length) fail("OPERATIONS_INPUT");
      const data = new TextDecoder("utf-8", { fatal: true }).decode(plaintext), checked = state(JSON.parse(data), key).value;
      if (checked.version !== version || JSON.stringify(checked) !== data) fail("OPERATIONS_INPUT");
      active(signal); return checked;
    } finally { content.fill(0); derived.fill(0); plaintext?.fill(0); tail?.fill(0); }
  });
}

/** A live/current registry is mandatory. An older SQL capture is never allowed
 * to remove a newer receipt. This comparison cannot prove external freshness. */
export function planOperationalRestore({ backup, current, targetBinding, key }) {
  try {
    const old = state(backup, key), latest = state(current, key), target = erasureBinding(targetBinding);
    if (old.value.version !== latest.value.version || JSON.stringify(old.value.binding) !== JSON.stringify(latest.value.binding)
      || Object.hasOwn(target, "videoRootFingerprint") !== (old.value.version === 2)) fail("OPERATIONS_BINDING_CHANGED");
    const files = new Map(latest.value.files.map(file => [file.name, file]));
    for (const [name, job] of old.jobs) {
      const newer = latest.jobs.get(name);
      if (!newer || newer.revision < job.revision) fail("OPERATIONS_REGISTRY_ROLLBACK");
      const a = job.record, b = newer.record;
      if (a.clientId !== b.clientId || a.startedAt !== b.startedAt || b.updatedAt < a.updatedAt
        || ERASURE_PHASES.indexOf(b.phase) < ERASURE_PHASES.indexOf(a.phase)
        || a.cursor !== null && (b.cursor === null || b.cursor < a.cursor)
        || a.phase === "completed" && JSON.stringify(a) !== JSON.stringify(b)
        || newer.revision === job.revision && newer.file.content !== job.file.content) fail("OPERATIONS_REGISTRY_ROLLBACK");
    }
    if (old.privacy) {
      if (!latest.privacy || latest.privacy.revision < old.privacy.revision) files.set(old.privacy.file.name, old.privacy.file);
      else if (latest.privacy.revision === old.privacy.revision && latest.privacy.file.content !== old.privacy.file.content) fail("OPERATIONS_CHANGED");
    }
    for (const [name, settings] of old.quickReplies) {
      const newer = latest.quickReplies.get(name);
      if (!newer || newer.revision < settings.revision) files.set(name, settings.file);
      else if (newer.revision === settings.revision && newer.file.content !== settings.file.content) fail("OPERATIONS_CHANGED");
    }
    const merged = { version: old.value.version, binding: old.value.binding,
      ...(old.value.version === 2 ? { legacyBinding: old.value.legacyBinding } : {}), files: [...files.values()].sort((a, b) => a.name.localeCompare(b.name, "en")) };
    state(merged, key);
    return { state: merged, targetBinding: target, backupSha256: operationalStateHash(old.value), currentSha256: operationalStateHash(latest.value),
      mergedSha256: operationalStateHash(merged), completedReceipts: [...latest.jobs.values()].filter(job => job.record.phase === "completed").length,
      pendingReceipts: [...latest.jobs.values()].filter(job => job.record.phase !== "completed").length,
      bindingChanged: JSON.stringify(target) !== JSON.stringify(old.value.binding),
      externalContinuityVerified: false, reconciliationRequired: true };
  } catch (error) { if (error instanceof OperationalCheckpointError) throw error; fail(); }
}

/** Restore only into an empty quarantine. The marker is published first, so an
 * interrupted copy cannot be opened as an ordinary application directory. */
export async function restoreOperationalQuarantine(scope, { backup, current, targetBinding, key, expectedCurrentSha256, assertCurrent, signal }) {
  return safe(async () => {
    if (typeof assertCurrent !== "function" || !HEX.test(expectedCurrentSha256 ?? "")) fail("OPERATIONS_INPUT");
    const plan = planOperationalRestore({ backup, current, targetBinding, key });
    if (plan.currentSha256 !== expectedCurrentSha256) fail("OPERATIONS_CHANGED");
    await scope.assertReady(); const directory = await opendir(scope.path); let empty = true;
    for await (const _entry of directory) empty = false;
    if (!empty) fail("OPERATIONS_NOT_EMPTY");
    await assertCurrent(plan.currentSha256); active(signal);
    const marker = Buffer.from(`${JSON.stringify({ version: plan.state.version, status: "reconciliation_required", backupSha256: plan.backupSha256,
      currentSha256: plan.currentSha256, mergedSha256: plan.mergedSha256, sourceBinding: plan.state.binding, targetBinding: plan.targetBinding })}\n`);
    try { await writeFile(scope, OPERATIONAL_RESTORE_MARKER, marker, signal); } finally { marker.fill(0); }
    for (const file of plan.state.files) {
      const content = Buffer.from(file.content, "base64url");
      try { await writeFile(scope, file.name, content, signal); } finally { content.fill(0); }
    }
    await assertCurrent(plan.currentSha256); active(signal); await scope.assertReady();
    return { restored: true, started: false, externalContinuityVerified: false, reconciliationRequired: true,
      files: plan.state.files.length, completedReceipts: plan.completedReceipts, pendingReceipts: plan.pendingReceipts, bindingChanged: plan.bindingChanged };
  });
}

export async function assertNoOperationalRestore(scope) {
  return safe(async () => {
    await scope.assertReady();
    try { await lstat(scope.file(OPERATIONAL_RESTORE_MARKER), { bigint: true }); }
    catch (error) { if (error.code === "ENOENT") { await scope.assertReady(); return; } throw error; }
    fail("OPERATIONS_RECONCILIATION_REQUIRED");
  });
}
