import { BACKUP_FRESHNESS_CODES } from "./freshness.mjs";

const MAX_DATE = 253402300799999;
export const BACKUP_ALERT_CODES = Object.freeze([...BACKUP_FRESHNESS_CODES,
  "BACKUP_CHECK_USAGE", "BACKUP_CHECK_INPUT", "BACKUP_CHECK_CHANGED", "BACKUP_CHECK_UNAVAILABLE", "BACKUP_CHECK_TIMEOUT",
  "MONITOR_CLOCK_INVALID", "MONITOR_TIMEOUT", "MONITOR_CANCELLED", "MONITOR_UNAVAILABLE", "MONITOR_INVALID_RESULT"]);
export class BackupAlertError extends Error {
  constructor(code = "ALERT_UNAVAILABLE") {
    super("Private backup alert delivery is not confirmed.");
    this.code = ["ALERT_INPUT", "ALERT_UNAVAILABLE", "ALERT_CHANGED", "ALERT_LOCKED", "ALERT_QUEUE_FULL", "ALERT_SMTP_FAILED", "ALERT_TIMEOUT"].includes(code)
      ? code : "ALERT_UNAVAILABLE";
  }
}
export const failAlert = code => { throw new BackupAlertError(code); };
export const alertInstant = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
const identifier = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
export function alertFields(value, names) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) failAlert("ALERT_INPUT");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some(key => typeof key !== "string" || !names.includes(key)
    || !Object.hasOwn(descriptors[key], "value"))) failAlert("ALERT_INPUT");
  return Object.fromEntries(names.map(name => [name, descriptors[name].value]));
}
export function validateBackupAlert(value) {
  const item = alertFields(value, ["version", "id", "incidentId", "event", "code", "observedAt", "lastSuccessAt", "synthetic"]);
  if (item.version !== 1 || !identifier(item.id) || !identifier(item.incidentId) || !["incident", "recovered"].includes(item.event)
    || !BACKUP_ALERT_CODES.includes(item.code) || !alertInstant(item.observedAt) || typeof item.synthetic !== "boolean"
    || item.lastSuccessAt !== null && (!alertInstant(item.lastSuccessAt) || item.lastSuccessAt > item.observedAt)
    || item.event === "incident" && (item.code === "OK" || item.id !== item.incidentId)
    || item.event === "recovered" && (item.code !== "OK" || item.lastSuccessAt === null || item.id === item.incidentId)) failAlert("ALERT_INPUT");
  return Object.freeze(item);
}
export function emptyBackupAlertState() {
  return { version: 1, revision: 0, activeIncident: null, pending: [], lastObservedAt: null,
    lastAttemptAt: null, consecutiveFailures: 0, lastAcceptedId: null, lastAcceptedAt: null };
}
export function validateBackupAlertState(value) {
  const state = alertFields(value, ["version", "revision", "activeIncident", "pending", "lastObservedAt", "lastAttemptAt", "consecutiveFailures", "lastAcceptedId", "lastAcceptedAt"]);
  if (state.version !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || state.revision >= Number.MAX_SAFE_INTEGER
    || !Array.isArray(state.pending) || state.pending.length > 32
    || Reflect.ownKeys(state.pending).length !== state.pending.length + 1
    || !Number.isSafeInteger(state.consecutiveFailures) || state.consecutiveFailures < 0 || state.consecutiveFailures > 1000000
    || [state.lastObservedAt, state.lastAttemptAt, state.lastAcceptedAt].some(time => time !== null && !alertInstant(time))
    || (state.lastAcceptedId === null) !== (state.lastAcceptedAt === null)
    || state.lastAcceptedId !== null && !identifier(state.lastAcceptedId)
    || (state.lastAttemptAt === null) !== (state.consecutiveFailures === 0)) failAlert("ALERT_INPUT");
  const pending = Array.from({ length: state.pending.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(state.pending, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) failAlert("ALERT_INPUT");
    return validateBackupAlert(descriptor.value);
  });
  if (new Set(pending.map(item => item.id)).size !== pending.length || state.lastAcceptedId !== null && pending.some(item => item.id === state.lastAcceptedId)
    || pending.some(item => item.synthetic || state.lastObservedAt === null || item.observedAt > state.lastObservedAt)
    || pending.some((item, index) => index > 0 && item.observedAt < pending[index - 1].observedAt)
    || state.lastAttemptAt !== null && !pending.length) failAlert("ALERT_INPUT");
  const activeIncident = state.activeIncident === null ? null : validateBackupAlert(state.activeIncident);
  if (activeIncident && (activeIncident.event !== "incident" || activeIncident.synthetic || state.lastObservedAt === null
    || activeIncident.observedAt > state.lastObservedAt)) failAlert("ALERT_INPUT");
  return Object.freeze({ ...state, activeIncident, pending: Object.freeze(pending) });
}
export function backupMonitorAlertObservation(value, now) {
  const item = alertFields(value, ["version", "type", "event", "checkedAt", "state", "code", "consecutiveFailures", "activeIncident",
    "lastSuccessAt", "ageMilliseconds", "copyStatus", "decryptionStatus", "notificationStatus"]);
  if (!alertInstant(now) || item.version !== 1 || item.type !== "private_backup_monitor" || !["sample", "incident", "recovered"].includes(item.event)
    || !["current", "waiting", "suspect", "incident"].includes(item.state) || !BACKUP_ALERT_CODES.includes(item.code)
    || item.checkedAt !== null && (!alertInstant(item.checkedAt) || item.checkedAt > now || now - item.checkedAt > 30000)
    || item.checkedAt === null && item.code !== "MONITOR_CLOCK_INVALID"
    || typeof item.activeIncident !== "boolean" || item.activeIncident !== (item.state === "incident")
    || !Number.isSafeInteger(item.consecutiveFailures) || item.consecutiveFailures < 0
    || (item.lastSuccessAt === null) !== (item.ageMilliseconds === null)
    || item.lastSuccessAt !== null && (!alertInstant(item.lastSuccessAt) || item.lastSuccessAt > now
      || !Number.isSafeInteger(item.ageMilliseconds) || item.ageMilliseconds < 0
      || item.checkedAt === null || item.ageMilliseconds !== item.checkedAt - item.lastSuccessAt)
    || item.state === "current" && (item.code !== "OK" || item.consecutiveFailures !== 0 || item.lastSuccessAt === null)
    || item.state !== "current" && item.code === "OK"
    || item.event === "incident" && item.state !== "incident" || item.event === "recovered" && item.state !== "current"
    || item.copyStatus !== "not_checked" || item.decryptionStatus !== "not_checked" || item.notificationStatus !== "not_sent") failAlert("ALERT_INPUT");
  return { state: item.state, code: item.code, observedAt: now, lastSuccessAt: item.lastSuccessAt };
}
export function enqueueBackupAlert(state, observation, makeId) {
  state = validateBackupAlertState(state);
  if (state.lastObservedAt !== null && observation.observedAt < state.lastObservedAt) failAlert("ALERT_INPUT");
  const event = observation.state === "incident" && state.activeIncident === null ? "incident"
    : observation.state === "current" && state.activeIncident !== null ? "recovered" : null;
  if (!event) return state;
  if (state.pending.length >= 32) failAlert("ALERT_QUEUE_FULL");
  const id = makeId();
  const alert = validateBackupAlert({ version: 1, id, incidentId: event === "incident" ? id : state.activeIncident.id,
    event, code: observation.code, observedAt: observation.observedAt, lastSuccessAt: observation.lastSuccessAt, synthetic: false });
  return validateBackupAlertState({ ...state, lastObservedAt: observation.observedAt,
    activeIncident: event === "incident" ? alert : null, pending: [...state.pending, alert] });
}
export function backupAlertRetryDue(state, now) {
  if (!alertInstant(now)) failAlert("ALERT_INPUT");
  if (!state.pending.length) return false;
  if (state.lastAttemptAt === null) return true;
  if (now < state.lastAttemptAt) failAlert("ALERT_INPUT");
  return now - state.lastAttemptAt >= Math.min(900000, 60000 * 2 ** Math.min(4, state.consecutiveFailures - 1));
}
