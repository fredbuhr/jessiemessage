import { validateRecurringCheckpointReport } from "./recurring-checkpoint.mjs";

export const CHECKPOINT_MAXIMUM_AGE = 26 * 60 * 60 * 1000;
const MAXIMUM_CAPTURE_TIME = 10 * 60 * 1000;
const MAX_DATE = 253402300799999;
const instant = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;

export class BackupFreshnessError extends Error {
  constructor() {
    super("The private backup journal could not be checked.");
    this.name = "BackupFreshnessError";
    this.code = "BACKUP_CHECK_INPUT";
  }
}
function fields(value, names) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new BackupFreshnessError();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some(key => typeof key !== "string" || !names.includes(key)
    || !Object.hasOwn(descriptors[key], "value"))) throw new BackupFreshnessError();
  return Object.fromEntries(names.map(name => [name, descriptors[name].value]));
}
function records(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new BackupFreshnessError();
  const descriptors = Object.getOwnPropertyDescriptors(value), length = descriptors.length.value;
  if (length > 2000 || Reflect.ownKeys(descriptors).length !== length + 1) throw new BackupFreshnessError();
  return Array.from({ length }, (_, index) => {
    const item = descriptors[String(index)];
    if (!item || !Object.hasOwn(item, "value")) throw new BackupFreshnessError();
    return validateRecurringCheckpointReport(item.value);
  });
}

/** Journal freshness only: never infer an independent copy or a decryption. */
export function evaluateCheckpointFreshness(value) {
  try {
    const { configuration, history, now } = fields(value, ["configuration", "history", "now"]);
    const config = fields(configuration, ["version", "recipientSha256", "hourUtc", "minuteUtc", "enabled"]);
    if (!instant(now) || config.version !== 1 || typeof config.enabled !== "boolean"
      || typeof config.recipientSha256 !== "string" || !/^[a-f0-9]{64}$/.test(config.recipientSha256)
      || !Number.isInteger(config.hourUtc) || config.hourUtc < 0 || config.hourUtc > 23
      || !Number.isInteger(config.minuteUtc) || config.minuteUtc < 0 || config.minuteUtc > 59) throw new BackupFreshnessError();
    const source = fields(history, ["records", "lastAttemptAt", "lastSuccessAt"]);
    const attempts = new Map();
    let lastAttemptAt = null, lastSuccessAt = null;
    for (const report of records(source.records)) {
      if (report.startedAt === null || report.startedAt > now || report.finishedAt !== null && report.finishedAt > now) throw new BackupFreshnessError();
      const attempt = attempts.get(report.startedAt) ?? { running: null, terminal: null };
      const name = report.status === "running" ? "running" : "terminal";
      if (attempt[name] !== null) throw new BackupFreshnessError();
      attempt[name] = report;
      attempts.set(report.startedAt, attempt);
      lastAttemptAt = Math.max(lastAttemptAt ?? 0, report.startedAt);
      if (report.status === "succeeded") lastSuccessAt = Math.max(lastSuccessAt ?? 0, report.finishedAt);
    }
    if (source.lastAttemptAt !== lastAttemptAt || source.lastSuccessAt !== lastSuccessAt) throw new BackupFreshnessError();
    const latest = attempts.get(lastAttemptAt);
    const ageMilliseconds = lastSuccessAt === null ? null : now - lastSuccessAt;
    const lastAttemptStatus = latest?.terminal?.status ?? (latest ? "running" : "none");
    const incomplete = [...attempts].some(([at, attempt]) => attempt.running === null || at !== lastAttemptAt && attempt.terminal === null);
    let code = "OK";
    if (!config.enabled) code = "BACKUP_DISABLED";
    else if (incomplete) code = "JOURNAL_INCOMPLETE";
    else if (lastAttemptStatus === "running") code = now - lastAttemptAt >= MAXIMUM_CAPTURE_TIME ? "CAPTURE_STALLED" : "CAPTURE_RUNNING";
    else if (lastAttemptStatus === "failed") code = "LAST_ATTEMPT_FAILED";
    else if (lastSuccessAt === null) code = "NO_SUCCESS";
    else if (ageMilliseconds >= CHECKPOINT_MAXIMUM_AGE) code = "BACKUP_STALE";
    return Object.freeze({ version: 1, type: "private_backup_freshness", scope: "capture-journal",
      status: code === "OK" ? "current" : "attention", code, checkedAt: now,
      maximumAgeMilliseconds: CHECKPOINT_MAXIMUM_AGE, lastAttemptAt, lastSuccessAt, ageMilliseconds,
      lastAttemptStatus, lastAttemptCode: latest?.terminal?.code ?? null,
      copyStatus: "not_checked", decryptionStatus: "not_checked" });
  } catch { throw new BackupFreshnessError(); }
}
