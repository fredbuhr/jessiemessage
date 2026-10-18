import { createHash } from "node:crypto";

export class BackupCopyError extends Error {
  constructor(code = "unavailable") { super("Backup copy operation unavailable."); this.code = code; this.name = "BackupCopyError"; }
}
export const failCopy = (code = "unavailable") => { throw new BackupCopyError(code); };
export const digestCopyToken = value => createHash("sha256").update(value).digest("hex");
export const copyId = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
export const captureId = value => typeof value === "string" && /^capture-[1-9][0-9]{0,14}-[a-f0-9]{16}$/.test(value);
export const copyHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const copyDate = value => Number.isSafeInteger(value) && value >= 0 && value <= 253402300799999;
export const copyLabel = value => typeof value === "string" && value === value.trim() && value.length >= 1 && value.length <= 64
  && value.isWellFormed() && !/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/.test(value);
export function copyFields(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) failCopy("input");
  const descriptors = Object.getOwnPropertyDescriptors(value), actual = Reflect.ownKeys(descriptors);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key) || !Object.hasOwn(descriptors[key], "value"))) failCopy("input");
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
export const emptyCopyState = () => ({ version: 1, revision: 0, destinations: [] });
export function validateCopyReceipt(value) {
  const result = copyFields(value, ["captureId", "bytes", "sha256", "receivedAt"]);
  if (!captureId(result.captureId) || !copyHash(result.sha256) || !Number.isSafeInteger(result.bytes) || result.bytes < 1 || result.bytes > 2151677952
    || !copyDate(result.receivedAt)) failCopy("input");
  return result;
}
export function validateCopyState(value) {
  const state = copyFields(value, ["version", "revision", "destinations"]);
  if (state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || state.revision >= Number.MAX_SAFE_INTEGER
    || !Array.isArray(state.destinations) || state.destinations.length > 5) failCopy("input");
  state.destinations = state.destinations.map(value => {
    const item = copyFields(value, ["id", "label", "kind", "enabled", "pairHash", "pairExpiresAt", "tokenHash", "pairedAt", "lastSeenAt", "locationId", "lastReceipt"]);
    if (!copyId(item.id) || !copyLabel(item.label) || !["computer", "synced_folder", "server"].includes(item.kind) || typeof item.enabled !== "boolean"
      || item.pairHash !== null && !copyHash(item.pairHash) || item.tokenHash !== null && !copyHash(item.tokenHash)
      || [item.pairExpiresAt, item.pairedAt, item.lastSeenAt].some(value => value !== null && !copyDate(value))
      || item.locationId !== null && !copyId(item.locationId)
      || (item.pairHash === null) !== (item.pairExpiresAt === null) || (item.tokenHash === null) !== (item.pairedAt === null)) failCopy("input");
    if (item.lastReceipt !== null) item.lastReceipt = validateCopyReceipt(item.lastReceipt);
    return item;
  });
  if (new Set(state.destinations.map(item => item.id)).size !== state.destinations.length) failCopy("input");
  return state;
}
