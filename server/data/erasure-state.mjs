export class AccountErasureError extends Error {
  constructor(code = "ERASURE_UNAVAILABLE") {
    super("Private account erasure could not be completed.");
    this.name = "AccountErasureError"; this.code = code;
  }
}
export const failErasure = (code) => { throw new AccountErasureError(code); };
export const ERASURE_PHASES = Object.freeze(["requested", "prepared", "files_erased", "completed"]);
export function erasureId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{32}$/.test(value)) failErasure("ERASURE_INPUT");
  return value;
}
export function erasureTime(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999) failErasure("ERASURE_INPUT");
  return value;
}
export const erasureSqlDate = value => new Date(erasureTime(value)).toISOString().replace("T", " ").replace("Z", "000");
export function erasureFields(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), "value"))) failErasure("ERASURE_INPUT");
}
export function erasureBinding(value) {
  const video = value !== null && typeof value === "object" && Object.hasOwn(value, "videoRootFingerprint");
  erasureFields(value, ["database", "rootFingerprint", ...(video ? ["videoRootFingerprint"] : [])]);
  if (typeof value.database !== "string" || !/^[a-zA-Z0-9_]{1,64}$/.test(value.database)
    || typeof value.rootFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.rootFingerprint)
    || video && (typeof value.videoRootFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.videoRootFingerprint))) failErasure("ERASURE_INPUT");
  return { database: value.database, rootFingerprint: value.rootFingerprint,
    ...(video ? { videoRootFingerprint: value.videoRootFingerprint } : {}) };
}
export function erasureCursor(value, version = 1) {
  if (version === 1) return erasureId(value);
  if (version !== 2 || typeof value !== "string" || !/^[pv]:[a-f0-9]{32}$/.test(value)) failErasure("ERASURE_INPUT");
  return value;
}
export function erasureRecord(value) {
  erasureFields(value, ["version", "clientId", "binding", "phase", "cursor", "startedAt", "updatedAt"]);
  const binding = erasureBinding(value.binding), version = Object.hasOwn(binding, "videoRootFingerprint") ? 2 : 1;
  if (value.version !== version || !ERASURE_PHASES.includes(value.phase)) failErasure("ERASURE_INPUT");
  const startedAt = erasureTime(value.startedAt), updatedAt = erasureTime(value.updatedAt);
  if (updatedAt < startedAt || value.phase === "requested" && value.cursor !== null) failErasure("ERASURE_INPUT");
  return { version, clientId: erasureId(value.clientId), binding, phase: value.phase,
    cursor: value.cursor === null ? null : erasureCursor(value.cursor, version), startedAt, updatedAt };
}
export function erasureTransition(previous, next) {
  next = erasureRecord(next);
  if (previous === null) { if (next.phase !== "requested" || next.updatedAt !== next.startedAt) failErasure("ERASURE_CHANGED"); return next; }
  previous = erasureRecord(previous);
  const from = ERASURE_PHASES.indexOf(previous.phase), to = ERASURE_PHASES.indexOf(next.phase);
  if (previous.clientId !== next.clientId || JSON.stringify(previous.binding) !== JSON.stringify(next.binding)
    || previous.startedAt !== next.startedAt || next.updatedAt < previous.updatedAt || to < from || to > from + 1
    || previous.cursor !== null && (next.cursor === null || next.cursor < previous.cursor)
    || next.cursor !== previous.cursor && (previous.phase !== "prepared" || next.phase !== "prepared")
    || previous.phase === "completed" && JSON.stringify(previous) !== JSON.stringify(next)) failErasure("ERASURE_CHANGED");
  return next;
}
