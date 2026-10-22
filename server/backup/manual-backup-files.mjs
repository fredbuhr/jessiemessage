import { createPrivateJsonStore } from "../files/private-json.mjs";
import { captureId } from "./copy-state.mjs";

export const MANUAL_BACKUP_REQUEST_MAX_AGE = 15 * 60 * 1000;
const MAX_REQUESTS = 2000, MAX_DATE = 253402300799999;
const CODES = ["EXPIRED", "INTERRUPTED", "PREFLIGHT_FAILED", "CAPTURE_FAILED", "CANCELLED"];
const id = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const date = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
export class ManualBackupError extends Error {
  constructor(suffix = "UNAVAILABLE") {
    super("The manual backup request is unavailable."); this.name = "ManualBackupError";
    this.code = `MANUAL_BACKUP_${["INPUT", "BUSY", "CHANGED", "LIMIT", "UNAVAILABLE"].includes(suffix) ? suffix : "UNAVAILABLE"}`;
  }
}
const fail = suffix => { throw new ManualBackupError(typeof suffix === "string" ? suffix.toUpperCase() : suffix); };
function fields(value, expected) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("INPUT");
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
  if (names.length !== expected.length || names.some(name => typeof name !== "string" || !expected.includes(name)
    || !Object.hasOwn(descriptors[name], "value"))) fail("INPUT");
  return Object.fromEntries(expected.map(name => [name, descriptors[name].value]));
}
function requestRecord(value) {
  const result = fields(value, ["version", "requestId", "status", "requestedAt", "startedAt", "finishedAt", "captureId", "code"]);
  if (result.version !== 1 || !id(result.requestId) || !date(result.requestedAt)
    || !["queued", "running", "complete", "failed"].includes(result.status)
    || result.startedAt !== null && (!date(result.startedAt) || result.startedAt < result.requestedAt)
    || result.finishedAt !== null && (!date(result.finishedAt) || result.finishedAt < (result.startedAt ?? result.requestedAt))) fail("INPUT");
  if (result.status === "queued" && (result.startedAt !== null || result.finishedAt !== null || result.captureId !== null || result.code !== null)
    || result.status === "running" && (result.startedAt === null || result.finishedAt !== null || result.captureId !== null || result.code !== null)
    || result.status === "complete" && (result.startedAt === null || result.finishedAt === null || !captureId(result.captureId) || result.code !== null)
    || result.status === "failed" && (result.finishedAt === null || result.captureId !== null || !CODES.includes(result.code))) fail("INPUT");
  return result;
}
function validate(value) {
  const result = fields(value, ["version", "revision", "requestIds", "current"]);
  if (result.version !== 1 || !Number.isSafeInteger(result.revision) || result.revision < 0 || result.revision >= Number.MAX_SAFE_INTEGER
    || !Array.isArray(result.requestIds) || result.requestIds.length > MAX_REQUESTS || result.requestIds.some(value => !id(value))
    || new Set(result.requestIds).size !== result.requestIds.length) fail("INPUT");
  const current = result.current === null ? null : requestRecord(result.current);
  if (current === null ? result.requestIds.length !== 0 : !result.requestIds.includes(current.requestId)) fail("INPUT");
  return { version: 1, revision: result.revision, requestIds: [...result.requestIds], current };
}
const files = createPrivateJsonStore({ name: "manual-backup-request.json", lock: "manual-backup-request.lock", maxBytes: 131072,
  validate, empty: () => ({ version: 1, revision: 0, requestIds: [], current: null }), fail,
  isKnownError: error => error instanceof ManualBackupError });

/** One durable request, bounded accepted identities, and no automatic retry.
 * The short optimistic writer lock is never held over a capture or HTTP drain. */
export function createManualBackupRequests({ operationsDirectory, clock = Date.now }, internal = {}) {
  if (typeof operationsDirectory !== "string" || !operationsDirectory.startsWith("/") || typeof clock !== "function") fail("INPUT");
  const read = internal.read ?? (() => files.read(operationsDirectory, internal));
  const save = internal.save ?? ((state, revision) => files.save(operationsDirectory, state, revision, internal));
  let queue = Promise.resolve(), pending = 0;
  const now = minimum => { const value = clock(); if (!date(value) || value < minimum) fail("UNAVAILABLE"); return value; };
  const publicRecord = value => value === null ? null : { ...value };
  async function change(work) {
    if (pending >= 16) fail("BUSY");
    pending++;
    const operation = queue.then(async () => {
      const state = await read();
      const changed = await work(state);
      if (changed) await save(state, state.revision);
      return publicRecord(state.current);
    });
    queue = operation.catch(() => {});
    try { return await operation; } finally { pending--; }
  }
  function failed(state, code) {
    state.current = { ...state.current, status: "failed", finishedAt: now(state.current.startedAt ?? state.current.requestedAt), captureId: null, code };
  }
  return Object.freeze({
    async status() { return publicRecord((await read()).current); },
    request(value) {
      const { requestId } = fields(value, ["requestId"]); if (!id(requestId)) fail("INPUT");
      return change(state => {
        if (state.current?.requestId === requestId) return false;
        if (state.requestIds.includes(requestId)) fail("CHANGED");
        if (["queued", "running"].includes(state.current?.status)) fail("BUSY");
        if (state.requestIds.length >= MAX_REQUESTS) fail("LIMIT");
        state.requestIds.push(requestId);
        state.current = { version: 1, requestId, status: "queued", requestedAt: now(0), startedAt: null, finishedAt: null, captureId: null, code: null };
        return true;
      });
    },
    /** Startup only: an uncertain running request is never executed again. */
    recover() { return change(state => {
      if (state.current?.status === "running") { failed(state, "INTERRUPTED"); return true; }
      if (state.current?.status === "queued" && now(state.current.requestedAt) - state.current.requestedAt > MANUAL_BACKUP_REQUEST_MAX_AGE) {
        failed(state, "EXPIRED"); return true;
      }
      return false;
    }); },
    claim(requestId) { return change(state => {
      if (!id(requestId) || state.current?.requestId !== requestId || state.current.status !== "queued") fail("CHANGED");
      const startedAt = now(state.current.requestedAt);
      if (startedAt - state.current.requestedAt > MANUAL_BACKUP_REQUEST_MAX_AGE) failed(state, "EXPIRED");
      else state.current = { ...state.current, status: "running", startedAt };
      return true;
    }); },
    complete(requestId, archiveId) { return change(state => {
      if (!id(requestId) || !captureId(archiveId) || state.current?.requestId !== requestId || state.current.status !== "running") fail("CHANGED");
      state.current = { ...state.current, status: "complete", finishedAt: now(state.current.startedAt), captureId: archiveId }; return true;
    }); },
    fail(requestId, code) { return change(state => {
      if (!id(requestId) || !CODES.includes(code) || state.current?.requestId !== requestId || !["queued", "running"].includes(state.current.status)) fail("CHANGED");
      failed(state, code); return true;
    }); },
  });
}
