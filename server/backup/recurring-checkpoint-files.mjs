import { constants } from "node:fs";
import { lstat, open, opendir, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { validateRecurringCheckpointReport } from "./recurring-checkpoint.mjs";

const MAX_HISTORY = 2000;
const MAX_ENTRIES = 4096;
const MAX_RECORD_BYTES = 4096;
const RECORD_NAME = /^checkpoint-([0-9]{15})-[a-f0-9]{32}\.json$/;
const SNAPSHOT_FIELDS = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const ERROR_CODES = ["INPUT", "UNSAFE", "CHANGED", "LIMIT", "IO", "LOCKED", "ABORTED"];

export class RecurringCheckpointFilesError extends Error {
  constructor(code = "RECURRING_FILES_IO") {
    super("The private recurring checkpoint files are unavailable.");
    this.name = "RecurringCheckpointFilesError";
    this.code = ERROR_CODES.some(suffix => code === `RECURRING_FILES_${suffix}`) ? code : "RECURRING_FILES_IO";
  }
}
const fail = suffix => { throw new RecurringCheckpointFilesError(`RECURRING_FILES_${suffix}`); };
const cancelled = signal => { if (signal?.aborted) fail("ABORTED"); };
const same = (left, right) => SNAPSHOT_FIELDS.every(field => left[field] === right[field]);
const identity = (left, right) => left.dev === right.dev && left.ino === right.ino;

function fields(value, expected) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("INPUT");
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length !== expected.length || names.some(name => typeof name !== "string" || !expected.includes(name)
    || !Object.hasOwn(descriptors[name], "value"))) fail("INPUT");
  return Object.fromEntries(expected.map(name => [name, descriptors[name].value]));
}
function options(value, withLimit = false) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("INPUT");
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  const allowed = withLimit ? ["signal", "limit"] : ["signal"];
  if (names.some(name => typeof name !== "string" || !allowed.includes(name) || !Object.hasOwn(descriptors[name], "value"))) fail("INPUT");
  const signal = descriptors.signal?.value;
  if (signal !== undefined && !(signal instanceof AbortSignal)) fail("INPUT");
  const limit = descriptors.limit?.value ?? MAX_HISTORY;
  if (withLimit && (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_HISTORY)) fail("INPUT");
  return { signal, limit };
}
function regular(stats, maxBytes) {
  if (!stats?.isFile?.() || SNAPSHOT_FIELDS.some(field => typeof stats[field] !== "bigint")
    || typeof process.getuid !== "function" || stats.uid !== BigInt(process.getuid())
    || (stats.mode & 0o7777n) !== 0o600n || stats.nlink !== 1n) fail("UNSAFE");
  if (stats.size < 0n || stats.size > BigInt(maxBytes)) fail("LIMIT");
}
function parsedJson(bytes) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // All persisted DTOs are flat. Reject duplicate JSON member names before
    // parsing so that a later duplicate cannot hide an earlier field value.
    const keys = [...text.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map(match => JSON.parse(match[1]));
    if (new Set(keys).size !== keys.length) fail("INPUT");
    return JSON.parse(text);
  } catch (error) { if (error instanceof RecurringCheckpointFilesError) throw error; fail("INPUT"); }
}
function configuration(value) {
  const result = fields(value, ["version", "recipientSha256", "hourUtc", "minuteUtc", "enabled"]);
  if (result.version !== 1 || typeof result.recipientSha256 !== "string" || !/^[a-f0-9]{64}$/.test(result.recipientSha256)
    || !Number.isInteger(result.hourUtc) || result.hourUtc < 0 || result.hourUtc > 23
    || !Number.isInteger(result.minuteUtc) || result.minuteUtc < 0 || result.minuteUtc > 59 || typeof result.enabled !== "boolean") fail("INPUT");
  return Object.freeze(result);
}
function report(value) {
  let result;
  try { result = validateRecurringCheckpointReport(value); } catch { fail("INPUT"); }
  // An invalid initial clock has no durable attempt and must not create a name.
  if (result.startedAt === null) fail("INPUT");
  return result;
}
async function safe(operation) {
  try { return await operation(); }
  catch (error) { if (error instanceof RecurringCheckpointFilesError) throw error; throw new RecurringCheckpointFilesError(); }
}
async function readStable(scope, name, maxBytes, signal, observed) {
  let handle;
  const buffer = Buffer.alloc(maxBytes + 1);
  try {
    cancelled(signal); await scope.assertReady(); cancelled(signal);
    handle = await open(scope.file(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    cancelled(signal);
    const before = await handle.stat({ bigint: true }); regular(before, maxBytes);
    let length = 0;
    while (length <= maxBytes) {
      cancelled(signal);
      const amount = Math.min(buffer.length - length, Number(before.size) - length + 1);
      const { bytesRead } = await handle.read(buffer, length, amount, length);
      cancelled(signal);
      if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > amount) fail("IO");
      if (bytesRead === 0) break;
      length += bytesRead;
      if (length > Number(before.size)) fail("CHANGED");
    }
    const after = await handle.stat({ bigint: true }), visible = await lstat(scope.file(name), { bigint: true });
    regular(after, maxBytes); regular(visible, maxBytes);
    if (length !== Number(before.size) || !same(before, after) || !same(after, visible)) fail("CHANGED");
    await scope.assertReady(); cancelled(signal);
    observed?.(after);
    return Buffer.from(buffer.subarray(0, length));
  } finally { buffer.fill(0); await handle?.close(); }
}
async function writeAll(handle, bytes, signal) {
  let offset = 0;
  while (offset < bytes.length) {
    cancelled(signal);
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
    cancelled(signal);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten < 1 || bytesWritten > bytes.length - offset) fail("IO");
    offset += bytesWritten;
  }
}
async function verifyCreated(scope, name, handle, created, bytes, signal) {
  cancelled(signal);
  const actual = await handle.stat({ bigint: true }), visible = await lstat(scope.file(name), { bigint: true });
  regular(actual, bytes); regular(visible, bytes);
  if (!identity(created, actual) || !same(actual, visible) || actual.size !== BigInt(bytes)) fail("CHANGED");
  await scope.assertReady(); cancelled(signal);
  return actual;
}

// The final argument is an internal test seam, never scheduling configuration.
/** Read only the fixed, closed, non-secret scheduling configuration. */
export async function readRecurringConfiguration(directory, selected = {}, internal = {}) {
  return safe(async () => {
    const { signal } = options(selected); cancelled(signal);
    return (internal.withDirectory ?? withPrivateDirectory)(directory, async scope => {
      const bytes = await readStable(scope, "recurring-backup.json", MAX_RECORD_BYTES, signal);
      try { return configuration(parsedJson(bytes)); } finally { bytes.fill(0); }
    });
  });
}

/** A public recipient is still read through the same protected file boundary. */
export async function readRecurringRecipientPublicKey(directory, selected = {}, internal = {}) {
  return safe(async () => {
    const { signal } = options(selected); cancelled(signal);
    return (internal.withDirectory ?? withPrivateDirectory)(directory, scope => readStable(scope, "recipient-public.asc", 64 * 1024, signal));
  });
}

/**
 * No stale lock is removed automatically. A collision never reads, truncates or
 * removes its inode. The operator must establish that no capture is active.
 */
export async function acquireRecurringLock(directory, operation, selected = {}, internal = {}) {
  return safe(async () => {
    const { signal } = options(selected);
    if (typeof operation !== "function") fail("INPUT");
    cancelled(signal);
    return (internal.withDirectory ?? withPrivateDirectory)(directory, async scope => {
      const name = "recurring-backup.lock";
      let handle, created, stable, result, failed = false, failure;
      try {
        cancelled(signal); await scope.assertReady(); cancelled(signal);
        try { handle = await open(scope.file(name), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600); }
        catch (error) { if (error?.code === "EEXIST") fail("LOCKED"); throw error; }
        created = await handle.stat({ bigint: true }); regular(created, MAX_RECORD_BYTES);
        if (created.size !== 0n) fail("CHANGED");
        const token = randomBytes(16).toString("hex");
        const bytes = Buffer.from(`${JSON.stringify({ version: 1, type: "recurring_checkpoint_lock", token })}\n`);
        try { await writeAll(handle, bytes); await handle.sync(); await scope.sync();
          stable = await verifyCreated(scope, name, handle, created, bytes.length);
        } finally { bytes.fill(0); }
        cancelled(signal);
        result = await operation(Object.freeze({ token }));
        cancelled(signal);
      } catch (error) { failed = true; failure = error; }
      finally {
        if (handle && created) {
          try {
            const current = await handle.stat({ bigint: true }), visible = await lstat(scope.file(name), { bigint: true });
            regular(current, MAX_RECORD_BYTES); regular(visible, MAX_RECORD_BYTES);
            if (!stable || !identity(created, current) || !same(stable, current) || !same(current, visible)) fail("CHANGED");
            await scope.assertReady();
            await unlink(scope.file(name)); await scope.sync();
          } catch (error) { if (!failed) { failed = true; failure = error; } }
        }
        try { await handle?.close(); } catch (error) { if (!failed) { failed = true; failure = error; } }
      }
      if (failed) throw failure;
      return result;
    });
  });
}

/** A new fsynced file per report; existing history is never overwritten. */
export async function appendCheckpointRecord(directory, value, selected = {}, internal = {}) {
  return safe(async () => {
    const { signal } = options(selected), owned = report(value);
    cancelled(signal);
    return (internal.withDirectory ?? withPrivateDirectory)(directory, async scope => {
      const name = `checkpoint-${String(owned.startedAt).padStart(15, "0")}-${randomBytes(16).toString("hex")}.json`;
      const bytes = Buffer.from(`${JSON.stringify(owned)}\n`);
      let handle;
      try {
        await scope.assertReady(); cancelled(signal);
        handle = await open(scope.file(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
        const created = await handle.stat({ bigint: true }); regular(created, MAX_RECORD_BYTES);
        if (created.size !== 0n) fail("CHANGED");
        await writeAll(handle, bytes, signal); await handle.sync(); await scope.sync();
        await verifyCreated(scope, name, handle, created, bytes.length, signal);
      } finally { bytes.fill(0); await handle?.close(); }
      const reloaded = await readStable(scope, name, MAX_RECORD_BYTES, signal);
      try {
        const checked = report(parsedJson(reloaded));
        if (JSON.stringify(checked) !== JSON.stringify(owned)) fail("CHANGED");
      } finally { reloaded.fill(0); }
      return owned;
    });
  });
}

async function historyNames(scope, signal) {
  let iterator, seen = 0;
  const names = [];
  try {
    await scope.assertReady(); cancelled(signal);
    iterator = await opendir(`${scope.path}/.`);
    while (true) {
      cancelled(signal);
      const entry = await iterator.read();
      cancelled(signal);
      if (entry === null) break;
      if (++seen > MAX_ENTRIES) fail("LIMIT");
      if (!entry.name.startsWith("checkpoint-")) continue;
      if (!RECORD_NAME.test(entry.name)) fail("UNSAFE");
      if (names.length >= MAX_HISTORY) fail("LIMIT");
      names.push(entry.name);
    }
  } finally { await iterator?.close(); }
  await scope.assertReady(); cancelled(signal);
  return names.sort();
}

/** Only validated records advance attempt/success dates; no implicit success. */
export async function readCheckpointHistory(directory, selected = {}, internal = {}) {
  return safe(async () => {
    const { signal, limit } = options(selected, true); cancelled(signal);
    return (internal.withDirectory ?? withPrivateDirectory)(directory, async scope => {
      const names = await historyNames(scope, signal), records = [], states = [];
      let lastAttemptAt = null, lastSuccessAt = null;
      for (const name of names) {
        const bytes = await readStable(scope, name, MAX_RECORD_BYTES, signal, stats => states.push(stats));
        try {
          const checked = report(parsedJson(bytes));
          if (Number(RECORD_NAME.exec(name)[1]) !== checked.startedAt) fail("CHANGED");
          lastAttemptAt = Math.max(lastAttemptAt ?? 0, checked.startedAt);
          if (checked.status === "succeeded") lastSuccessAt = Math.max(lastSuccessAt ?? 0, checked.finishedAt);
          records.push(checked);
        } finally { bytes.fill(0); }
      }
      for (let index = 0; index < names.length; index += 1) {
        cancelled(signal);
        const current = await lstat(scope.file(names[index]), { bigint: true });
        regular(current, MAX_RECORD_BYTES);
        if (!same(states[index], current)) fail("CHANGED");
      }
      const after = await historyNames(scope, signal);
      if (names.length !== after.length || names.some((name, index) => name !== after[index])) fail("CHANGED");
      records.sort((left, right) => left.startedAt - right.startedAt || (left.finishedAt ?? left.startedAt) - (right.finishedAt ?? right.startedAt)
        || Number(left.status !== "running") - Number(right.status !== "running"));
      return Object.freeze({ records: Object.freeze(records.slice(-limit)), lastAttemptAt, lastSuccessAt });
    });
  });
}
