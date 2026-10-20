import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";
import { evaluateCheckpointFreshness, validateBackupFreshnessReport, CHECKPOINT_MAXIMUM_AGE } from "../server/backup/freshness.mjs";
import { appendCheckpointRecord } from "../server/backup/recurring-checkpoint-files.mjs";
import { main } from "../scripts/check-private-backups.mjs";

const NOW = Date.UTC(2026, 9, 18, 12);
const configuration = () => ({ version: 1, recipientSha256: "a".repeat(64), hourUtc: 5, minuteUtc: 15, enabled: true });
const marker = "private-data-must-not-leak";
const args = ["--operations-directory", "/srv/private-backups", "--private-path-mode", "linux-dirfd"];
const begin = at => ({ version: 1, type: "recurring_checkpoint", status: "running", phase: "preflight", code: "OK",
  startedAt: at, finishedAt: null, runtimeResumed: false });
const end = (at, status = "succeeded") => ({ ...begin(at), status, phase: status === "succeeded" ? "finished" : "encrypting",
  code: status === "succeeded" ? "OK" : "ENCRYPT_FAILED", finishedAt: at + 1000, runtimeResumed: true });
function history(records = []) {
  return { records, lastAttemptAt: records.length ? Math.max(...records.map(item => item.startedAt)) : null,
    lastSuccessAt: records.some(item => item.status === "succeeded") ? Math.max(...records.filter(item => item.status === "succeeded").map(item => item.finishedAt)) : null };
}
const success = (at = NOW - 5000) => history([begin(at), end(at)]);
const evaluate = (selected = success(), config = configuration(), now = NOW) => evaluateCheckpointFreshness({ configuration: config, history: selected, now });
const dependencies = overrides => ({ readConfiguration: async () => configuration(), readHistory: async () => success(),
  readCapacity: async () => ({ records: 2, rootEntries: 8 }), clock: () => NOW, ...overrides });

test("history capacity warns at either 75-percent boundary and preserves every stronger diagnosis", () => {
  const value = { configuration: configuration(), history: success(), now: NOW };
  for (const capacity of [{ records: 1499, rootEntries: 3071 }, { records: 1500, rootEntries: 3071 }, { records: 1499, rootEntries: 3072 }]) {
    const result = evaluateCheckpointFreshness(value, capacity), low = capacity.records >= 1500 || capacity.rootEntries >= 3072;
    assert.equal(result.code, low ? "HISTORY_CAPACITY_LOW" : "OK"); assert.equal(result.status, low ? "attention" : "current");
    assert.deepEqual(Object.keys(result), Object.keys(evaluate())); assert.equal(result.lastSuccessAt, value.history.lastSuccessAt);
    assert.equal(result.copyStatus, "not_checked"); assert.equal(result.decryptionStatus, "not_checked");
  }
  const full = { records: 2000, rootEntries: 4096 };
  for (const [selected, config, expected] of [
    [success(), { ...configuration(), enabled: false }, "BACKUP_DISABLED"], [history(), configuration(), "NO_SUCCESS"],
    [history([begin(NOW - 60000), ...success().records]), configuration(), "JOURNAL_INCOMPLETE"],
    [history([begin(NOW - 5000)]), configuration(), "CAPTURE_RUNNING"], [history([begin(NOW - 600000)]), configuration(), "CAPTURE_STALLED"],
    [history([begin(NOW - 5000), end(NOW - 5000, "failed")]), configuration(), "LAST_ATTEMPT_FAILED"],
    [success(NOW - CHECKPOINT_MAXIMUM_AGE - 1000), configuration(), "BACKUP_STALE"],
  ]) assert.equal(evaluateCheckpointFreshness({ configuration: config, history: selected, now: NOW }, full).code, expected);
  assert.throws(() => evaluateCheckpointFreshness(value, { records: 2001, rootEntries: 4096 }), { code: "BACKUP_CHECK_INPUT" });
  assert.throws(() => evaluateCheckpointFreshness(value, { records: 2, rootEntries: 4097 }), { code: "BACKUP_CHECK_INPUT" });
  const warning = evaluateCheckpointFreshness(value, full);
  assert.throws(() => validateBackupFreshnessReport({ ...warning, lastAttemptStatus: "running", lastAttemptCode: null }), { code: "BACKUP_CHECK_INPUT" });
});

test("a full valid legacy history can warn without adding fields to its three-key DTO", () => {
  const records = Array.from({ length: 750 }, (_, index) => { const at = NOW - (750 - index) * 2000; return [begin(at), end(at)]; }).flat();
  assert.equal(evaluate(history(records)).code, "HISTORY_CAPACITY_LOW");
});

test("the shared reader and CLI retain capacity attention and reject unavailable inventory", async () => {
  const warning = await main(args, dependencies({ readCapacity: async () => ({ records: 2, rootEntries: 3072 }) }));
  assert.equal(warning.exitCode, 1); assert.equal(warning.report.code, "HISTORY_CAPACITY_LOW");
  const failed = await main(args, dependencies({ readCapacity: async () => { throw new Error(marker); } }));
  assert.equal(failed.exitCode, 2); assert.equal(failed.report.code, "BACKUP_CHECK_UNAVAILABLE"); assert.equal(JSON.stringify(failed).includes(marker), false);
});

test("a fresh completed journal never certifies an independent copy or decryption", () => {
  const report = evaluate();
  assert.equal(report.status, "current"); assert.equal(report.code, "OK");
  assert.equal(report.scope, "capture-journal"); assert.equal(report.ageMilliseconds, 4000);
  assert.equal(report.copyStatus, "not_checked"); assert.equal(report.decryptionStatus, "not_checked");
  assert.equal(Object.isFrozen(report), true);
  for (const forbidden of ["recipientSha256", "records", "path", "key", "archive", "runtimeResumed"]) assert.equal(Object.hasOwn(report, forbidden), false);
});

test("the 26-hour boundary changes the journal from current to stale without changing data", () => {
  const at = NOW - CHECKPOINT_MAXIMUM_AGE - 1000, source = success(at), saved = structuredClone(source);
  assert.equal(evaluate(source, configuration(), NOW - 1).code, "OK");
  assert.equal(evaluate(source).code, "BACKUP_STALE");
  assert.equal(evaluate(source, configuration(), NOW + 1).status, "attention");
  assert.deepEqual(source, saved);
});

test("an empty journal, disabled configuration and a new failure cannot inherit an old success", () => {
  assert.equal(evaluate(history()).code, "NO_SUCCESS");
  assert.equal(evaluate(success(), { ...configuration(), enabled: false }).code, "BACKUP_DISABLED");
  const old = success(NOW - 60000).records, at = NOW - 5000;
  const report = evaluate(history([...old, begin(at), end(at, "failed")]));
  assert.equal(report.code, "LAST_ATTEMPT_FAILED"); assert.equal(report.lastAttemptCode, "ENCRYPT_FAILED");
  assert.equal(report.lastSuccessAt, NOW - 59000); assert.equal(report.status, "attention");
});

test("a running capture becomes stalled after ten minutes even if the previous backup is fresh", () => {
  for (const [age, code] of [[1000, "CAPTURE_RUNNING"], [599999, "CAPTURE_RUNNING"], [600000, "CAPTURE_STALLED"]]) {
    assert.equal(evaluate(history([...success(NOW - 3600000).records, begin(NOW - age)])).code, code);
  }
});

test("a dangling old attempt or a missing durable begin is attention even after a newer success", () => {
  assert.equal(evaluate(history([begin(NOW - 60000), ...success().records])).code, "JOURNAL_INCOMPLETE");
  assert.equal(evaluate(history([end(NOW - 5000)])).code, "JOURNAL_INCOMPLETE");
});

test("timestamps in the future, duplicate terminals and fabricated summary dates are refused", () => {
  const invalid = [history([begin(NOW + 1)]), history([begin(NOW), end(NOW)]),
    history([...success().records, end(NOW - 5000)]),
    { ...success(), lastSuccessAt: NOW }, { ...success(), lastAttemptAt: null },
    history([begin(NOW - 5000), { ...end(NOW - 5000), runtimeResumed: false }])];
  for (const input of invalid) assert.throws(() => evaluate(input), { code: "BACKUP_CHECK_INPUT" });
  for (const now of [NaN, Infinity, -1, 0.5, "now", 253402300800000]) assert.throws(() => evaluate(success(), configuration(), now), { code: "BACKUP_CHECK_INPUT" });
  assert.equal(evaluate(history([begin(0), end(0)]), configuration(), 1000).lastAttemptAt, 0);
});

test("hostile getters, extra fields and sparse records cannot run or enter the report", () => {
  let invoked = 0;
  const accessor = { ...configuration() };
  Object.defineProperty(accessor, "enabled", { get() { invoked++; throw new Error(marker); }, enumerable: true });
  const sparse = { records: Array(1), lastAttemptAt: null, lastSuccessAt: null };
  const extended = { ...configuration(), secret: marker };
  const withGetter = success(); Object.defineProperty(withGetter.records, "0", { get() { invoked++; return begin(NOW - 5000); } });
  for (const [input, config] of [[success(), accessor], [sparse, configuration()], [success(), extended], [withGetter, configuration()]]) {
    assert.throws(() => evaluate(input, config), error => error.code === "BACKUP_CHECK_INPUT" && !String(error).includes(marker));
  }
  assert.equal(invoked, 0);
});

test("freshness CLI returns distinct current, attention and unavailable exit codes", async () => {
  assert.equal((await main(args, dependencies())).exitCode, 0);
  const disabled = await main(args, dependencies({ readConfiguration: async () => ({ ...configuration(), enabled: false }) }));
  assert.equal(disabled.exitCode, 1); assert.equal(disabled.report.code, "BACKUP_DISABLED");
  const unavailable = await main(args, dependencies({ readHistory: async () => { throw new Error(marker); } }));
  assert.deepEqual(unavailable, { report: { version: 1, type: "private_backup_freshness", status: "error", code: "BACKUP_CHECK_UNAVAILABLE" }, exitCode: 2 });
  assert.equal(JSON.stringify(unavailable).includes(marker), false);
});

test("CLI rejects unknown flags and repository paths before touching any private file", async () => {
  let reads = 0;
  const deps = dependencies({ readConfiguration: async () => { reads++; throw new Error(marker); } });
  const repository = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
  const invalid = [[], [...args, "--capture"], ["--operations-directory", repository, ...args.slice(2)],
    [args[0], `${repository}/private`, ...args.slice(2)], [args[0], "/srv/private/../backups", ...args.slice(2)],
    [args[0], "/srv/private", args[2], "strict"], [args[0], "/srv/private\n", ...args.slice(2)]];
  for (const value of invalid) assert.equal((await main(value, deps)).report.code, "BACKUP_CHECK_USAGE");
  assert.equal(reads, 0);
});

test("configuration changes and cancellation during observation never report a current backup", async () => {
  let calls = 0;
  const changed = await main(args, dependencies({ readConfiguration: async () => ({ ...configuration(), hourUtc: calls++ ? 6 : 5 }) }));
  assert.equal(changed.report.code, "BACKUP_CHECK_CHANGED"); assert.equal(changed.exitCode, 2);
  const cancellation = new AbortController();
  const aborted = await main(args, dependencies({ signal: cancellation.signal, readHistory: async () => { cancellation.abort(); return success(); } }));
  assert.equal(aborted.exitCode, 2); assert.equal(aborted.report.code, "BACKUP_CHECK_UNAVAILABLE");
  const corrupt = await main(args, dependencies({ readHistory: async () => ({ ...success(), lastSuccessAt: NOW }) }));
  assert.equal(corrupt.report.code, "BACKUP_CHECK_INPUT");
});

test("native private-file inspection preserves every journal file and creates no lock or capture", {
  skip: process.platform !== "linux" || !existsSync("/proc/self/fd"),
}, async t => {
  const base = resolve(fileURLToPath(new URL("../../audit", import.meta.url)));
  await mkdir(base, { mode: 0o700, recursive: true });
  const root = await mkdtemp(join(base, "backup-freshness-")); await chmod(root, 0o700);
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFile(join(root, "recurring-backup.json"), JSON.stringify(configuration()), { flag: "wx", mode: 0o600 });
  for (const record of success().records) await appendCheckpointRecord(root, record);
  const names = (await readdir(root)).sort();
  const result = await main([args[0], root, ...args.slice(2)], { clock: () => NOW });
  assert.equal(result.exitCode, 0); assert.equal(result.report.code, "OK");
  assert.deepEqual((await readdir(root)).sort(), names);
});
