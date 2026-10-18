const MAX_DATE = 253402300799999;
const DAY = 24 * 60 * 60 * 1000;
const PHASES = Object.freeze(["preflight", "stopping", "capturing", "encrypting", "resuming", "finished"]);
const CODES = Object.freeze(["OK", "CLOCK_INVALID", "JOURNAL_FAILED", "STOP_FAILED", "CAPTURE_FAILED", "ENCRYPT_FAILED", "RESUME_FAILED", "CANCELLED"]);
const FIELDS = Object.freeze(["version", "type", "status", "phase", "code", "startedAt", "finishedAt", "runtimeResumed"]);

export class RecurringCheckpointError extends Error {
  constructor(code = "RECURRING_CHECKPOINT_CONFIGURATION") {
    const selected = ["RECURRING_CHECKPOINT_CONFIGURATION", "RECURRING_CHECKPOINT_BUSY", "RECURRING_CHECKPOINT_CLOSED", "RECURRING_CHECKPOINT_REPORT"].includes(code)
      ? code : "RECURRING_CHECKPOINT_CONFIGURATION";
    super("The recurring checkpoint operation is unavailable."); this.name = "RecurringCheckpointError"; this.code = selected;
  }
}
const date = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
function valueField(value, name) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

/** Project an owned journal/result without invoking supplied getters or toJSON. */
export function validateRecurringCheckpointReport(value) {
  try {
    if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(descriptors);
    if (names.length !== FIELDS.length || names.some(name => typeof name !== "string" || !FIELDS.includes(name)
      || !Object.hasOwn(descriptors[name], "value"))) throw new Error();
    const result = Object.fromEntries(FIELDS.map(name => [name, descriptors[name].value]));
    if (result.version !== 1 || result.type !== "recurring_checkpoint" || !["running", "succeeded", "failed"].includes(result.status)
      || !PHASES.includes(result.phase) || !CODES.includes(result.code) || typeof result.runtimeResumed !== "boolean"
      || result.startedAt !== null && !date(result.startedAt) || result.finishedAt !== null && !date(result.finishedAt)
      || result.startedAt === null && result.finishedAt !== null
      || result.finishedAt !== null && result.finishedAt < result.startedAt) throw new Error();
    if (result.status === "running" && (result.phase !== "preflight" || result.code !== "OK" || result.startedAt === null
      || result.finishedAt !== null || result.runtimeResumed)) throw new Error();
    if (result.status === "succeeded" && (result.phase !== "finished" || result.code !== "OK"
      || result.startedAt === null || result.finishedAt === null || !result.runtimeResumed)) throw new Error();
    if (result.status === "failed" && (result.code === "OK" || result.finishedAt === null && (result.startedAt !== null
      || result.code !== "CLOCK_INVALID" || result.phase !== "preflight" || result.runtimeResumed))) throw new Error();
    return Object.freeze(result);
  } catch { throw new RecurringCheckpointError("RECURRING_CHECKPOINT_REPORT"); }
}

/** The next UTC occurrence is strictly after now, including an exact boundary. */
export function nextDailyCheckpoint(now, { hourUtc = 5, minuteUtc = 15 } = {}) {
  if (!date(now) || !Number.isInteger(hourUtc) || hourUtc < 0 || hourUtc > 23
    || !Number.isInteger(minuteUtc) || minuteUtc < 0 || minuteUtc > 59) throw new RecurringCheckpointError();
  const day = Math.floor(now / DAY) * DAY;
  let next = day + hourUtc * 60 * 60 * 1000 + minuteUtc * 60 * 1000;
  if (next <= now) next += DAY;
  if (!date(next) || next <= now || next - now > DAY) throw new RecurringCheckpointError();
  return next;
}

/**
 * Only a durable begin record permits stopping the managed runtime. Once stop
 * is attempted, normal cancellation/failure always passes through resume.
 * Global close instead aborts the operation and suppresses runtime resumption.
 * Hooks must settle only after their actual operation and children settle.
 */
export function createRecurringCheckpoint({ stopRuntime, capture, encrypt, resumeRuntime, record, clock = Date.now } = {}) {
  if ([stopRuntime, capture, encrypt, resumeRuntime, record, clock].some(value => typeof value !== "function")) throw new RecurringCheckpointError();
  let closed = false, active = null, closing = null;
  let phase = "preflight", startedAt = null, currentCode = "OK";
  const globalCancellation = new AbortController();
  const state = () => Object.freeze({ status: closed ? "closed" : active ? "running" : "idle", phase, code: currentCode, startedAt });

  function run(options = {}) {
    if (closed) return Promise.reject(new RecurringCheckpointError("RECURRING_CHECKPOINT_CLOSED"));
    if (active) return Promise.reject(new RecurringCheckpointError("RECURRING_CHECKPOINT_BUSY"));
    const externalSignal = options instanceof AbortSignal ? options : valueField(options, "signal");
    if (externalSignal !== undefined && !(externalSignal instanceof AbortSignal)) return Promise.reject(new RecurringCheckpointError());
    const cancellation = new AbortController();
    const abort = () => cancellation.abort();
    globalCancellation.signal.addEventListener("abort", abort, { once: true });
    externalSignal?.addEventListener("abort", abort, { once: true });
    if (globalCancellation.signal.aborted || externalSignal?.aborted) abort();
    phase = "preflight"; startedAt = null; currentCode = "OK";
    const operation = async () => {
      let failedPhase = "preflight", code = "OK", stopAttempted = false, runtimeResumed = false, lastTime = null;
      const sample = () => {
        let now; try { now = clock(); } catch { throw new Error(); }
        if (!date(now) || lastTime !== null && now < lastTime) throw new Error();
        lastTime = now; return now;
      };
      const fail = (nextCode, nextPhase = phase) => { if (code === "OK") { code = nextCode; failedPhase = nextPhase; } };
      const result = (status, finishedAt) => validateRecurringCheckpointReport({ version: 1, type: "recurring_checkpoint", status,
        phase: status === "succeeded" ? "finished" : status === "running" ? "preflight" : failedPhase,
        code, startedAt, finishedAt, runtimeResumed });
      const cancelled = () => {
        if (!cancellation.signal.aborted) return false;
        code = "CANCELLED"; failedPhase = phase; return true;
      };
      try {
        try { startedAt = sample(); } catch { fail("CLOCK_INVALID"); return result("failed", null); }
        try { await record(result("running", null)); } catch { fail("JOURNAL_FAILED"); }
        if (code === "OK" && !cancelled()) {
          phase = "stopping"; stopAttempted = true;
          try {
            const stopped = await stopRuntime({ signal: cancellation.signal });
            if (valueField(stopped, "exitCode") !== 0 || valueField(stopped, "signal") !== null) fail("STOP_FAILED");
          } catch { fail("STOP_FAILED"); }
        }
        if (code === "OK" && !cancelled()) {
          phase = "capturing";
          try { if (valueField(await capture({ signal: cancellation.signal }), "saved") !== true) fail("CAPTURE_FAILED"); }
          catch { fail("CAPTURE_FAILED"); }
        }
        if (code === "OK" && !cancelled()) {
          phase = "encrypting";
          try { if (valueField(await encrypt({ signal: cancellation.signal }), "encrypted") !== true) fail("ENCRYPT_FAILED"); }
          catch { fail("ENCRYPT_FAILED"); }
        }
        // Even a rejected or ambiguous stop may have stopped the child. The
        // adapter owns identity and must not spawn over a still-running child.
        if (stopAttempted && !closed) {
          phase = "resuming";
          try { runtimeResumed = valueField(await resumeRuntime({ signal: globalCancellation.signal }), "ready") === true; }
          catch { runtimeResumed = false; }
          if (!runtimeResumed) fail("RESUME_FAILED");
        }
        if (closed) { runtimeResumed = false; code = "CANCELLED"; failedPhase = phase; }
        else cancelled();
        let finishedAt;
        try { finishedAt = sample(); } catch { fail("CLOCK_INVALID"); finishedAt = lastTime; }
        let report = result(code === "OK" ? "succeeded" : "failed", finishedAt);
        try { await record(report); }
        catch { code = "JOURNAL_FAILED"; failedPhase = "finished"; report = result("failed", finishedAt); }
        return report;
      } finally {
        currentCode = code; phase = code === "OK" ? "finished" : failedPhase;
        globalCancellation.signal.removeEventListener("abort", abort);
        externalSignal?.removeEventListener("abort", abort);
      }
    };
    // Reserve admission before invoking any hook, including reentrant record.
    active = Promise.resolve().then(operation);
    const current = active;
    void current.finally(() => { if (active === current) active = null; }).catch(() => {});
    return current;
  }
  function close() {
    if (closing) return closing;
    closed = true; globalCancellation.abort();
    closing = active ? active.then(() => undefined, () => undefined) : Promise.resolve();
    return closing;
  }
  return Object.freeze({ run, close, state });
}
