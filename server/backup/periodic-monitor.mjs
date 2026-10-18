import { inspectPrivateBackupFreshness as inspectBackups } from "./freshness-reader.mjs";
import { validateBackupFreshnessReport } from "./freshness.mjs";

const MAX_DATE = 253402300799999;
const instant = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
const ERROR_CODES = ["BACKUP_CHECK_USAGE", "BACKUP_CHECK_INPUT", "BACKUP_CHECK_CHANGED", "BACKUP_CHECK_UNAVAILABLE", "BACKUP_CHECK_TIMEOUT"];
function fields(value, names) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some(key => typeof key !== "string" || !names.includes(key)
    || !Object.hasOwn(descriptors[key], "value"))) throw new Error();
  return Object.fromEntries(names.map(name => [name, descriptors[name].value]));
}
function result(value, now, maximumAge) {
  const selected = fields(value, ["report", "exitCode"]);
  if (selected.exitCode === 2) {
    const report = fields(selected.report, ["version", "type", "status", "code"]);
    if (report.version !== 1 || report.type !== "private_backup_freshness" || report.status !== "error" || !ERROR_CODES.includes(report.code)) throw new Error();
    return { code: report.code, kind: "failure", lastSuccessAt: null, ageMilliseconds: null };
  }
  const report = validateBackupFreshnessReport(selected.report);
  if (selected.exitCode !== (report.status === "current" ? 0 : 1) || report.checkedAt > now || now - report.checkedAt > maximumAge) throw new Error();
  return { code: report.code, kind: report.code === "OK" ? "current" : report.code === "CAPTURE_RUNNING" ? "waiting" : "failure",
    lastSuccessAt: report.lastSuccessAt, ageMilliseconds: report.lastSuccessAt === null ? null : now - report.lastSuccessAt };
}

/** Read-only sampling. Reports are operational logs, never notification receipts. */
export function createPeriodicBackupMonitor({ operationsDirectory } = {}, { inspect = inspectBackups, clock = Date.now,
  emit = () => {}, intervalMilliseconds = 60000, timeoutMilliseconds = 15000, confirmations = 3,
  schedule = setTimeout, unschedule = clearTimeout } = {}) {
  if (typeof operationsDirectory !== "string" || typeof inspect !== "function" || typeof clock !== "function" || typeof emit !== "function"
    || !Number.isSafeInteger(intervalMilliseconds) || intervalMilliseconds < 1 || intervalMilliseconds > 60000
    || !Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 15000
    || !Number.isSafeInteger(confirmations) || confirmations < 1 || confirmations > 10
    || typeof schedule !== "function" || typeof unschedule !== "function") throw new TypeError("Invalid private backup monitor configuration.");
  let started = false, closed = false, timer, inFlight = null, lastTime = null, failures = 0, incident = false, snapshot = null;
  const error = code => ({ kind: "failure", code, lastSuccessAt: null, ageMilliseconds: null });
  function time() {
    try {
      const now = clock();
      if (!instant(now) || lastTime !== null && now < lastTime) return null;
      lastTime = now; return now;
    } catch { return null; }
  }
  function observe(sample, now) {
    if (closed) return null;
    if (now === null) sample = error("MONITOR_CLOCK_INVALID");
    let event = "sample", state;
    if (sample.kind === "current") {
      if (incident) event = "recovered";
      incident = false; failures = 0; state = "current";
    } else if (sample.kind === "waiting") {
      // A running capture proves neither a failure nor recovery from an incident.
      if (!incident) failures = 0;
      state = incident ? "incident" : "waiting";
    } else {
      failures = Math.min(Number.MAX_SAFE_INTEGER, failures + 1);
      if (failures >= confirmations && !incident) { incident = true; event = "incident"; }
      state = incident ? "incident" : "suspect";
    }
    snapshot = Object.freeze({ version: 1, type: "private_backup_monitor", event, checkedAt: now, state, code: sample.code,
      consecutiveFailures: failures, activeIncident: incident, lastSuccessAt: sample.lastSuccessAt, ageMilliseconds: sample.ageMilliseconds,
      copyStatus: "not_checked", decryptionStatus: "not_checked", notificationStatus: "not_sent" });
    try { Promise.resolve(emit(snapshot)).catch(() => {}); } catch { /* Logging never controls the application. */ }
    return snapshot;
  }
  function tick() {
    if (closed || !started) return Promise.resolve(null);
    if (inFlight) {
      // A timed-out adapter may still be draining. Never start another reader.
      return inFlight.expired ? Promise.resolve(observe(error("MONITOR_TIMEOUT"), time())) : inFlight.bounded;
    }
    const at = time();
    if (at === null) return Promise.resolve(observe(error("MONITOR_CLOCK_INVALID"), null));
    let finish;
    const operation = { cancellation: new AbortController(), bounded: new Promise(resolve => { finish = resolve; }),
      settled: false, expired: false, deadline: null };
    const complete = sample => {
      if (operation.settled) return;
      operation.settled = true; unschedule(operation.deadline);
      finish(closed ? null : observe(sample, time()));
    };
    operation.cancel = () => { operation.cancellation.abort(); complete(error("MONITOR_CANCELLED")); };
    inFlight = operation;
    operation.deadline = schedule(() => {
      operation.expired = true; operation.cancellation.abort(); complete(error("MONITOR_TIMEOUT"));
    }, timeoutMilliseconds);
    Promise.resolve().then(() => closed ? null : inspect(operationsDirectory, { signal: operation.cancellation.signal, clock })).then(value => {
      if (closed || operation.settled) return;
      const now = time();
      if (now === null) { complete(error("MONITOR_CLOCK_INVALID")); return; }
      try { complete(result(value, now, timeoutMilliseconds + 1000)); }
      catch { complete(error("MONITOR_INVALID_RESULT")); }
    }, () => complete(error("MONITOR_UNAVAILABLE"))).finally(() => { if (inFlight === operation) inFlight = null; }).catch(() => {});
    return operation.bounded;
  }
  function arm() {
    if (closed) return;
    timer = schedule(() => { void tick().finally(arm); }, intervalMilliseconds);
  }
  function start() {
    if (closed || started) return;
    started = true; void tick().finally(arm);
  }
  function close() {
    if (closed) return Promise.resolve();
    closed = true; unschedule(timer); inFlight?.cancel();
    return inFlight ? inFlight.bounded.then(() => undefined) : Promise.resolve();
  }
  return Object.freeze({ start, tick, close, snapshot: () => snapshot });
}
