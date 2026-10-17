import test from "node:test";
import assert from "node:assert/strict";
import { createRecurringCheckpoint, nextDailyCheckpoint, RecurringCheckpointError, validateRecurringCheckpointReport } from "../server/backup/recurring-checkpoint.mjs";

const now = Date.UTC(2026, 9, 18, 0, 0);
const later = now + 1000;
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(overrides = {}) {
  const calls = [], records = [];
  const dependencies = {
    async stopRuntime({ signal }) { calls.push("stop"); assert.ok(signal instanceof AbortSignal); return { exitCode: 0, signal: null }; },
    async capture({ signal }) { calls.push("capture"); assert.ok(signal instanceof AbortSignal); return { saved: true }; },
    async encrypt({ signal }) { calls.push("encrypt"); assert.ok(signal instanceof AbortSignal); return { encrypted: true }; },
    async resumeRuntime({ signal }) { calls.push("resume"); assert.ok(signal instanceof AbortSignal); return { ready: true }; },
    async record(value) { calls.push(`record:${value.status}`); records.push(value); },
    clock: (() => { let calls = 0; return () => calls++ === 0 ? now : later; })(),
    ...overrides,
  };
  return { calls, records, dependencies, operation: createRecurringCheckpoint(dependencies) };
}
const safe = value => { assert.equal(JSON.stringify(value).includes("secret"), false); assert.equal(Object.isFrozen(value), true); };

test("durable begin precedes stop; archive encryption precedes ready runtime and durable success", async () => {
  const f = fixture();
  assert.equal(f.operation.state().status, "idle");
  const running = f.operation.run(); assert.equal(f.operation.state().status, "running");
  const result = await running;
  assert.deepEqual(f.calls, ["record:running", "stop", "capture", "encrypt", "resume", "record:succeeded"]);
  assert.deepEqual(result, { version: 1, type: "recurring_checkpoint", status: "succeeded", phase: "finished", code: "OK", startedAt: now, finishedAt: later, runtimeResumed: true });
  assert.deepEqual(f.records[0], { ...result, status: "running", phase: "preflight", finishedAt: null, runtimeResumed: false });
  for (const record of f.records) safe(record);
  assert.equal(f.operation.state().status, "idle");
});

test("failed begin journal prevents stopping and a closed failure record is attempted", async () => {
  const records = [];
  const f = fixture({ async record(value) { records.push(value); if (value.status === "running") throw new Error("secret disk"); } });
  const result = await f.operation.run();
  assert.equal(result.status, "failed"); assert.equal(result.code, "JOURNAL_FAILED"); assert.equal(result.phase, "preflight");
  assert.equal(result.runtimeResumed, false); assert.deepEqual(f.calls, []);
  assert.deepEqual(records.map(row => row.status), ["running", "failed"]); safe(result);
});

for (const stopped of [undefined, {}, { exitCode: 1, signal: null }, { exitCode: 0, signal: "SIGTERM" }, { exitCode: 0 }, { exitCode: "0", signal: null }]) {
  test(`ambiguous stop ${JSON.stringify(stopped)} cannot capture and still resumes`, async () => {
    const f = fixture({ async stopRuntime() { f.calls.push("stop"); return stopped; } });
    const result = await f.operation.run();
    assert.equal(result.code, "STOP_FAILED"); assert.equal(result.phase, "stopping"); assert.equal(result.runtimeResumed, true);
    assert.deepEqual(f.calls, ["record:running", "stop", "resume", "record:failed"]); safe(result);
  });
}

for (const [hook, phase, code] of [["stopRuntime", "stopping", "STOP_FAILED"], ["capture", "capturing", "CAPTURE_FAILED"], ["encrypt", "encrypting", "ENCRYPT_FAILED"]]) {
  test(`${hook} exception always resumes and preserves only a fixed error`, async () => {
    const f = fixture({ async [hook]() { f.calls.push("broken"); throw new Error("secret SQL customer file"); } });
    const result = await f.operation.run();
    assert.equal(result.status, "failed"); assert.equal(result.code, code); assert.equal(result.phase, phase); assert.equal(result.runtimeResumed, true);
    assert.equal(f.calls.filter(value => value === "resume").length, 1); assert.equal(f.records.at(-1).status, "failed"); safe(result);
  });
}

for (const [hook, invalid, code] of [["capture", { saved: false }, "CAPTURE_FAILED"], ["encrypt", { encrypted: false }, "ENCRYPT_FAILED"], ["resumeRuntime", { ready: false }, "RESUME_FAILED"]]) {
  test(`${hook} requires an explicit successful acknowledgement`, async () => {
    const f = fixture({ async [hook]() { return invalid; } });
    const result = await f.operation.run(); assert.equal(result.code, code); assert.equal(result.status, "failed"); safe(result);
  });
}

test("resume errors prevent success after a completed encrypted archive", async () => {
  const f = fixture({ async resumeRuntime() { f.calls.push("resume"); throw new Error("secret runtime error"); } });
  const result = await f.operation.run(); assert.equal(result.code, "RESUME_FAILED"); assert.equal(result.phase, "resuming"); assert.equal(result.runtimeResumed, false);
  assert.ok(f.calls.includes("encrypt")); assert.equal(f.records.at(-1).status, "failed"); safe(result);
});

test("final journal failure cannot prevent resumption or manufacture persistent success", async () => {
  const records = [];
  const f = fixture({ async record(report) { records.push(report); if (report.status !== "running") throw new Error("secret fsync"); } });
  const result = await f.operation.run(); assert.equal(result.code, "JOURNAL_FAILED"); assert.equal(result.status, "failed"); assert.equal(result.runtimeResumed, true);
  assert.equal(f.calls.filter(value => value === "resume").length, 1); assert.equal(records[1].status, "succeeded"); safe(result);
});

test("concurrent and reentrant runs never create a second producer pause", async () => {
  const gate = deferred(); let reentrant;
  const f = fixture({ async record(report) { if (report.status === "running") { reentrant = f.operation.run(); reentrant.catch(() => {}); await gate.promise; } } });
  const run = f.operation.run();
  await assert.rejects(f.operation.run(), { code: "RECURRING_CHECKPOINT_BUSY" });
  await flush(); await assert.rejects(reentrant, { code: "RECURRING_CHECKPOINT_BUSY" });
  assert.deepEqual(f.calls, []); gate.resolve(); await run;
  assert.equal(f.calls.filter(value => value === "capture").length, 1);
  await f.operation.run(); assert.equal(f.calls.filter(value => value === "capture").length, 2);
});

test("normal cancellation during capture waits for its actual close then resumes with a fresh signal", async () => {
  const signal = new AbortController(), gate = deferred(); let captureSignal;
  const f = fixture({ async capture({ signal: passed }) { captureSignal = passed; f.calls.push("capture"); await gate.promise; throw new Error("secret abort"); },
    async resumeRuntime({ signal: passed }) { assert.equal(passed.aborted, false); f.calls.push("resume"); return { ready: true }; } });
  const running = f.operation.run({ signal: signal.signal }); await flush();
  signal.abort(); assert.equal(captureSignal.aborted, true); await flush(); assert.equal(f.calls.includes("resume"), false);
  gate.resolve(); const result = await running;
  assert.equal(result.code, "CANCELLED"); assert.equal(result.runtimeResumed, true); assert.equal(f.calls.includes("encrypt"), false);
});

test("global close aborts and awaits capture without restarting the managed runtime", async () => {
  const gate = deferred(); let signal, closed = false;
  const f = fixture({ async capture(options) { signal = options.signal; f.calls.push("capture"); await gate.promise; return { saved: true }; } });
  const running = f.operation.run(); await flush();
  const closing = f.operation.close(); assert.equal(f.operation.close(), closing); closing.then(() => { closed = true; });
  assert.equal(signal.aborted, true); await flush(); assert.equal(closed, false); assert.equal(f.operation.state().status, "closed");
  await assert.rejects(f.operation.run(), { code: "RECURRING_CHECKPOINT_CLOSED" });
  gate.resolve(); const result = await running; await closing;
  assert.equal(result.status, "failed"); assert.equal(result.code, "CANCELLED"); assert.equal(result.runtimeResumed, false);
  assert.equal(f.calls.includes("resume"), false); assert.equal(f.calls.includes("encrypt"), false); assert.equal(closed, true);
});

test("global close during an uncertain stop never captures or resumes", async () => {
  const gate = deferred();
  const f = fixture({ async stopRuntime() { f.calls.push("stop"); await gate.promise; return { exitCode: 0, signal: null }; } });
  const running = f.operation.run(); await flush(); const closing = f.operation.close(); gate.resolve();
  const result = await running; await closing;
  assert.equal(result.code, "CANCELLED"); assert.deepEqual(f.calls, ["record:running", "stop", "record:failed"]);
});

test("pre-aborted run never stops a runtime; idle close forbids subsequent work", async () => {
  const cancellation = new AbortController(); cancellation.abort(); const f = fixture();
  const result = await f.operation.run(cancellation.signal); assert.equal(result.code, "CANCELLED");
  assert.deepEqual(f.calls, ["record:running", "record:failed"]); await f.operation.close();
  await assert.rejects(f.operation.run(), { code: "RECURRING_CHECKPOINT_CLOSED" });
});

for (const value of [NaN, Infinity, -1, 1.25, 253402300800000, "secret", null]) {
  test(`invalid initial clock ${String(value)} never reaches a journal or runtime`, async () => {
    const f = fixture({ clock: () => value }); const result = await f.operation.run();
    assert.equal(result.code, "CLOCK_INVALID"); assert.equal(result.startedAt, null); assert.equal(result.finishedAt, null); assert.deepEqual(f.calls, []);
  });
}

test("clock exception and backward final sample fail without a future or reversed journal", async () => {
  const throwing = fixture({ clock() { throw new Error("secret clock"); } });
  assert.equal((await throwing.operation.run()).code, "CLOCK_INVALID"); assert.deepEqual(throwing.calls, []);
  let samples = 0; const f = fixture({ clock: () => ++samples === 1 ? now : now - 1 });
  const result = await f.operation.run(); assert.equal(result.code, "CLOCK_INVALID"); assert.equal(result.finishedAt, now); assert.equal(result.runtimeResumed, true);
  assert.equal(f.records.at(-1).status, "failed");
});

test("journal validator rejects extra fields, getters, invalid states and future-shaped reversed timestamps", async () => {
  const f = fixture(); const result = await f.operation.run(); let reads = 0;
  for (const report of [{ ...result, secret: "private" }, { ...result, finishedAt: now - 1 }, { ...result, status: "succeeded", runtimeResumed: false },
    { ...result, status: "failed", code: "OK" }, { ...result, phase: "unknown" }, { ...result, finishedAt: 253402300800000 },
    { ...result, get code() { reads += 1; return "OK"; } }, Object.assign(Object.create({ secret: true }), result)]) {
    assert.throws(() => validateRecurringCheckpointReport(report), { code: "RECURRING_CHECKPOINT_REPORT" });
  }
  assert.equal(reads, 0); assert.notEqual(validateRecurringCheckpointReport(result), result);
});

test("hook acknowledgements with getters do not execute application-controlled code", async () => {
  let reads = 0;
  const f = fixture({ async stopRuntime() { return { get exitCode() { reads += 1; return 0; }, signal: null }; } });
  assert.equal((await f.operation.run()).code, "STOP_FAILED"); assert.equal(reads, 0);
});

test("next daily UTC checkpoint is strictly future and at most one day away across month/year/leap boundaries", () => {
  for (const at of [Date.UTC(2026, 9, 18), Date.UTC(2026, 9, 18, 5, 14, 59, 999), Date.UTC(2026, 9, 18, 5, 15), Date.UTC(2026, 11, 31, 23, 59, 59), Date.UTC(2028, 1, 28, 23, 59, 59)]) {
    const next = nextDailyCheckpoint(at), instant = new Date(next);
    assert.ok(next > at); assert.ok(next - at <= 86400000); assert.equal(instant.getUTCHours(), 5); assert.equal(instant.getUTCMinutes(), 15);
    assert.equal(instant.getUTCSeconds(), 0); assert.equal(instant.getUTCMilliseconds(), 0);
  }
  assert.equal(nextDailyCheckpoint(Date.UTC(2026, 9, 18, 5, 15)), Date.UTC(2026, 9, 19, 5, 15));
  assert.equal(nextDailyCheckpoint(now, { hourUtc: 0, minuteUtc: 0 }), now + 86400000);
});

test("schedule configuration and unrepresentable future dates are rejected", () => {
  for (const at of [NaN, -1, "secret", 253402300799999]) assert.throws(() => nextDailyCheckpoint(at), RecurringCheckpointError);
  for (const options of [{ hourUtc: -1 }, { hourUtc: 24 }, { minuteUtc: 60 }, { minuteUtc: 0.5 }]) assert.throws(() => nextDailyCheckpoint(now, options), RecurringCheckpointError);
  assert.throws(() => createRecurringCheckpoint(), RecurringCheckpointError);
});
