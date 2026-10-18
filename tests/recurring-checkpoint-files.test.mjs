import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, statfs, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RecurringCheckpointFilesError, acquireRecurringLock as realAcquireRecurringLock, appendCheckpointRecord as realAppendCheckpointRecord, readCheckpointHistory as realReadCheckpointHistory,
  readRecurringConfiguration as realReadRecurringConfiguration, readRecurringRecipientPublicKey as realReadRecurringRecipientPublicKey } from "../server/backup/recurring-checkpoint-files.mjs";

// Real local scopes exercise safe file handling even when the sandbox omits
// procfs. A separate mandatory Linux CI scenario exercises the production anchor.
async function withDirectory(directory, callback) {
  const initial = await lstat(directory, { bigint: true });
  const valid = value => value.isDirectory() && value.uid === BigInt(process.getuid()) && (value.mode & 0o7777n) === 0o700n;
  if (!valid(initial)) throw new Error(marker);
  const scope = {
    path: directory,
    file: name => { assert.equal(/[/\\\0]/.test(name), false); return path.join(directory, name); },
    async assertReady() { const current = await lstat(directory, { bigint: true });
      assert.equal(valid(current), true); assert.equal(current.dev, initial.dev); assert.equal(current.ino, initial.ino); return current; },
    async sync() { await this.assertReady(); const handle = await open(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      try { await handle.sync(); } finally { await handle.close(); } },
  };
  const result = await callback(scope); await scope.assertReady(); return result;
}
const internal = { withDirectory };
const readRecurringConfiguration = (directory, options) => realReadRecurringConfiguration(directory, options, internal);
const readRecurringRecipientPublicKey = (directory, options) => realReadRecurringRecipientPublicKey(directory, options, internal);
const acquireRecurringLock = (directory, operation, options) => realAcquireRecurringLock(directory, operation, options, internal);
const appendCheckpointRecord = (directory, value, options) => realAppendCheckpointRecord(directory, value, options, internal);
const readCheckpointHistory = (directory, options) => realReadCheckpointHistory(directory, options, internal);

const repository = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const marker = "synthetic-private-information-must-not-leak";
const configuration = () => ({ version: 1, recipientSha256: "a".repeat(64), hourUtc: 5, minuteUtc: 15, enabled: true });
const report = (status = "running", startedAt = 1792278000000) => ({ version: 1, type: "recurring_checkpoint", status,
  phase: status === "succeeded" ? "finished" : status === "failed" ? "capturing" : "preflight",
  code: status === "failed" ? "CAPTURE_FAILED" : "OK", startedAt, finishedAt: status === "running" ? null : startedAt + 1000,
  runtimeResumed: status !== "running" });
const unavailable = error => error instanceof RecurringCheckpointFilesError && /^RECURRING_FILES_[A-Z]+$/.test(error.code)
  && error.message === "The private recurring checkpoint files are unavailable." && !JSON.stringify(error).includes(marker);
async function fixture(t) {
  const base = path.resolve(repository, "../audit");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(base, "recurring-files-"));
  await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function put(root, name, content) {
  await writeFile(path.join(root, name), typeof content === "string" || Buffer.isBuffer(content) ? content : `${JSON.stringify(content)}\n`, { flag: "wx", mode: 0o600 });
}
async function hookOpen(callback, operation) {
  const original = fs.promises.open;
  fs.promises.open = async (...args) => callback(original, args);
  syncBuiltinESMExports();
  try { return await operation(); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
}

test("recurring configuration accepts a closed private DTO and returns an owned immutable projection", async t => {
  const root = await fixture(t), input = configuration();
  await put(root, "recurring-backup.json", input);
  const result = await readRecurringConfiguration(root);
  assert.deepEqual(result, input);
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(await readCheckpointHistory(root), { records: [], lastAttemptAt: null, lastSuccessAt: null });
});

test("configuration rejects malformed, duplicate, extended, oversized and non-UTF8 contents", async t => {
  const invalid = [
    { ...configuration(), path: marker }, { ...configuration(), enabled: 1 }, { ...configuration(), hourUtc: 24 },
    { ...configuration(), minuteUtc: -1 }, { ...configuration(), recipientSha256: "A".repeat(64) }, [], null,
    `${JSON.stringify(configuration()).slice(0, -1)},"enabled":false}`,
    `${JSON.stringify(configuration()).slice(0, -1)},"enabl\\u0065d":false}`,
    " ".repeat(4097), Buffer.from([0xff, 0xfe]), "{",
  ];
  for (const value of invalid) {
    const root = await fixture(t);
    await put(root, "recurring-backup.json", value === null ? "null" : value);
    await assert.rejects(readRecurringConfiguration(root), unavailable);
  }
});

test("fixed configuration and public recipient reads reject symlinks, hardlinks, directories and wrong permissions", async t => {
  for (const name of ["recurring-backup.json", "recipient-public.asc"]) {
    const read = name === "recurring-backup.json" ? readRecurringConfiguration : readRecurringRecipientPublicKey;
    for (const defect of ["symlink", "hardlink", "directory", "mode"]) {
      const root = await fixture(t), value = name.endsWith(".json") ? configuration() : "synthetic public recipient";
      if (defect === "symlink") { await put(root, "outside", value); await symlink(path.join(root, "outside"), path.join(root, name)); }
      if (defect === "hardlink") { await put(root, name, value); await link(path.join(root, name), path.join(root, "alias")); }
      if (defect === "directory") await mkdir(path.join(root, name), { mode: 0o700 });
      if (defect === "mode") { await put(root, name, value); await chmod(path.join(root, name), 0o640); }
      await assert.rejects(read(root), unavailable);
    }
  }
  const root = await fixture(t);
  await put(root, "recipient-public.asc", "synthetic public recipient");
  assert.deepEqual(await readRecurringRecipientPublicKey(root), Buffer.from("synthetic public recipient"));
});

test("private directory pinning rejects a linked root, a nonprivate root and a replaced unsafe owner", async t => {
  const root = await fixture(t);
  await put(root, "recurring-backup.json", configuration());
  await chmod(root, 0o750);
  await assert.rejects(readRecurringConfiguration(root), unavailable);
  await chmod(root, 0o700);
  const alias = `${root}-alias`;
  await symlink(root, alias); t.after(() => rm(alias, { force: true }));
  await assert.rejects(readRecurringConfiguration(alias), unavailable);
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith("/recurring-backup.json")) {
      const stat = handle.stat.bind(handle);
      handle.stat = async (...parameters) => { const value = await stat(...parameters); value.uid += 1n; return value; };
    }
    return handle;
  }, () => assert.rejects(readRecurringConfiguration(root), { code: "RECURRING_FILES_UNSAFE" }));
});

test("exclusive capture lock stays open and durable through the callback, rejects overlap and removes only its own lock", async t => {
  const root = await fixture(t);
  let reached = false;
  const result = await acquireRecurringLock(root, async ({ token }) => {
    reached = true; assert.match(token, /^[a-f0-9]{32}$/);
    const stats = await lstat(path.join(root, "recurring-backup.lock"), { bigint: true });
    assert.equal(stats.mode & 0o7777n, 0o600n); assert.equal(stats.nlink, 1n);
    assert.equal(stats.uid, BigInt(process.getuid()));
    const before = await readFile(path.join(root, "recurring-backup.lock"));
    await assert.rejects(acquireRecurringLock(root, () => { throw new Error("must not run"); }), { code: "RECURRING_FILES_LOCKED" });
    assert.deepEqual(await readFile(path.join(root, "recurring-backup.lock")), before);
    return 123;
  });
  assert.equal(reached, true); assert.equal(result, 123);
  assert.deepEqual(await readdir(root), []);
});

test("a stale lock or malicious collision is retained without opening or changing its bytes", async t => {
  for (const defect of ["regular", "symlink", "hardlink", "directory"]) {
    const root = await fixture(t), lock = path.join(root, "recurring-backup.lock");
    await put(root, "existing", marker);
    if (defect === "regular") await put(root, "recurring-backup.lock", marker);
    if (defect === "symlink") await symlink(path.join(root, "existing"), lock);
    if (defect === "hardlink") await link(path.join(root, "existing"), lock);
    if (defect === "directory") await mkdir(lock, { mode: 0o700 });
    const before = await lstat(lock, { bigint: true });
    await assert.rejects(acquireRecurringLock(root, () => { throw new Error(marker); }), { code: "RECURRING_FILES_LOCKED" });
    const after = await lstat(lock, { bigint: true });
    assert.equal(after.ino, before.ino); assert.equal(after.ctimeNs, before.ctimeNs);
    assert.deepEqual(await readFile(path.join(root, "existing")), Buffer.from(marker));
  }
});

test("failure and cancellation release a verified owned lock while private callback errors remain sanitized", async t => {
  const root = await fixture(t);
  await assert.rejects(acquireRecurringLock(root, async () => { throw new Error(marker); }), unavailable);
  assert.deepEqual(await readdir(root), []);
  const pre = new AbortController(); pre.abort();
  await assert.rejects(acquireRecurringLock(root, () => assert.fail(), { signal: pre.signal }), { code: "RECURRING_FILES_ABORTED" });
  const during = new AbortController();
  await assert.rejects(acquireRecurringLock(root, () => { during.abort(); }, { signal: during.signal }), { code: "RECURRING_FILES_ABORTED" });
  assert.deepEqual(await readdir(root), []);
});

test("a replaced or modified lock is never unlinked during cleanup", async t => {
  for (const mutation of ["replacement", "contents", "hardlink", "mode"]) {
    const root = await fixture(t), lock = path.join(root, "recurring-backup.lock");
    await assert.rejects(acquireRecurringLock(root, async () => {
      if (mutation === "replacement") { await rename(lock, path.join(root, "retained-original")); await put(root, "recurring-backup.lock", marker); }
      if (mutation === "contents") await writeFile(lock, marker);
      if (mutation === "hardlink") await link(lock, path.join(root, "alias"));
      if (mutation === "mode") await chmod(lock, 0o640);
    }), unavailable);
    assert.equal((await readdir(root)).includes("recurring-backup.lock"), true);
  }
});

test("append-only durable history keeps interrupted starts and computes success only from completed records", async t => {
  const root = await fixture(t), first = report(), success = report("succeeded"), later = report("running", first.startedAt + 86400000);
  await appendCheckpointRecord(root, first);
  const firstNames = await readdir(root), firstBytes = await readFile(path.join(root, firstNames[0]));
  assert.deepEqual(await readCheckpointHistory(root), { records: [first], lastAttemptAt: first.startedAt, lastSuccessAt: null });
  await appendCheckpointRecord(root, success);
  await appendCheckpointRecord(root, later);
  assert.deepEqual(await readFile(path.join(root, firstNames[0])), firstBytes);
  const result = await readCheckpointHistory(root);
  assert.deepEqual(result, { records: [first, success, later], lastAttemptAt: later.startedAt, lastSuccessAt: success.finishedAt });
  assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.records), true);
  assert.equal(result.records.every(Object.isFrozen), true);
  const limited = await readCheckpointHistory(root, { limit: 1 });
  assert.deepEqual(limited.records, [later]); assert.equal(limited.lastSuccessAt, success.finishedAt);
  for (const name of await readdir(root)) {
    assert.match(name, /^checkpoint-[0-9]{15}-[a-f0-9]{32}\.json$/);
    const stats = await lstat(path.join(root, name), { bigint: true });
    assert.equal(stats.mode & 0o7777n, 0o600n); assert.equal(stats.nlink, 1n);
  }
});

test("journal write projection rejects extra fields, getters, invalid states and unusable clocks before creating output", async t => {
  const root = await fixture(t); let accessed = false;
  const accessor = { ...report() }; Object.defineProperty(accessor, "status", { get() { accessed = true; throw new Error(marker); } });
  for (const value of [accessor, { ...report(), privateKey: marker }, { ...report(), status: "succeeded" },
    { ...report(), startedAt: null }, { ...report(), finishedAt: report().startedAt - 1 }, Object.assign(Object.create({ x: 1 }), report())]) {
    await assert.rejects(appendCheckpointRecord(root, value), { code: "RECURRING_FILES_INPUT" });
  }
  assert.equal(accessed, false); assert.deepEqual(await readdir(root), []);
});

test("journal reads fail closed on partial, modified, misnamed, oversized and unsafe records without changing them", async t => {
  for (const mutation of ["partial", "unknown", "different-date", "extra", "symlink", "hardlink", "mode", "large"]) {
    const root = await fixture(t);
    await appendCheckpointRecord(root, report("succeeded"));
    const name = (await readdir(root))[0], filename = path.join(root, name);
    if (mutation === "partial") await writeFile(filename, "{");
    if (mutation === "unknown") await rename(filename, path.join(root, "checkpoint-untrusted.json"));
    if (mutation === "different-date") await writeFile(filename, JSON.stringify(report("succeeded", 1792278000001)));
    if (mutation === "extra") await writeFile(filename, JSON.stringify({ ...report("succeeded"), secret: marker }));
    if (mutation === "symlink") { await rename(filename, path.join(root, "original")); await symlink(path.join(root, "original"), filename); }
    if (mutation === "hardlink") await link(filename, path.join(root, "alias"));
    if (mutation === "mode") await chmod(filename, 0o640);
    if (mutation === "large") await writeFile(filename, " ".repeat(4097));
    const names = await readdir(root);
    await assert.rejects(readCheckpointHistory(root), unavailable);
    assert.deepEqual(await readdir(root), names);
  }
});

test("journal and configuration support bounded cancellation and reject hostile option accessors without evaluation", async t => {
  const root = await fixture(t), abort = new AbortController(); abort.abort();
  await put(root, "recurring-backup.json", configuration());
  for (const operation of [() => readRecurringConfiguration(root, { signal: abort.signal }),
    () => appendCheckpointRecord(root, report(), { signal: abort.signal }), () => readCheckpointHistory(root, { signal: abort.signal })]) {
    await assert.rejects(operation(), { code: "RECURRING_FILES_ABORTED" });
  }
  let accessed = false;
  const hostile = {}; Object.defineProperty(hostile, "signal", { get() { accessed = true; throw new Error(marker); } });
  await assert.rejects(readRecurringConfiguration(root, hostile), { code: "RECURRING_FILES_INPUT" });
  await assert.rejects(readCheckpointHistory(root, { limit: 0 }), { code: "RECURRING_FILES_INPUT" });
  await assert.rejects(readCheckpointHistory(root, { limit: 2001 }), { code: "RECURRING_FILES_INPUT" });
  await assert.rejects(readRecurringConfiguration(root, { directory: marker }), { code: "RECURRING_FILES_INPUT" });
  assert.equal(accessed, false); assert.deepEqual(await readdir(root), ["recurring-backup.json"]);
});

test("stable file reads detect inode replacement during a read and close descriptors without exposing input", async t => {
  const root = await fixture(t); await put(root, "recurring-backup.json", configuration());
  let replaced = false, opened = 0, closed = 0;
  await hookOpen(async (original, args) => {
    const handle = await original(...args), close = handle.close.bind(handle);
    opened += 1; handle.close = async () => { await close(); closed += 1; };
    if (String(args[0]).endsWith("/recurring-backup.json")) {
      const read = handle.read.bind(handle);
      handle.read = async (...parameters) => {
        if (!replaced) { replaced = true; await rename(path.join(root, "recurring-backup.json"), path.join(root, "retained")); await put(root, "recurring-backup.json", configuration()); }
        return read(...parameters);
      };
    }
    return handle;
  }, () => assert.rejects(readRecurringConfiguration(root), { code: "RECURRING_FILES_CHANGED" }));
  assert.equal(replaced, true); assert.equal(opened, closed);
});

test("history rejects more than 2000 records before reading or pruning any journal", async t => {
  const root = await fixture(t), value = report();
  await Promise.all(Array.from({ length: 2001 }, (_, index) => put(root, `checkpoint-${String(value.startedAt).padStart(15, "0")}-${index.toString(16).padStart(32, "0")}.json`, value)));
  await assert.rejects(readCheckpointHistory(root), { code: "RECURRING_FILES_LIMIT" });
  assert.equal((await readdir(root)).length, 2001);
});

test("append refuses a collision and retains previously created journal bytes", async t => {
  const root = await fixture(t), previous = report();
  await hookOpen(async (original, args) => {
    if (String(args[0]).includes("/checkpoint-") && (args[1] & fs.constants.O_CREAT)) {
      await put(root, path.basename(String(args[0])), previous);
    }
    return original(...args);
  }, () => assert.rejects(appendCheckpointRecord(root, report("succeeded")), unavailable));
  const names = await readdir(root);
  assert.equal(names.length, 1);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, names[0]), "utf8")), previous);
});

test("history notices an earlier record mutated while a later record is being read", async t => {
  const root = await fixture(t);
  await appendCheckpointRecord(root, report());
  await appendCheckpointRecord(root, report("succeeded", report().startedAt + 1000));
  const names = (await readdir(root)).sort();
  let changed = false;
  await hookOpen(async (original, args) => {
    const handle = await original(...args);
    if (String(args[0]).endsWith(`/${names[1]}`)) {
      const read = handle.read.bind(handle);
      handle.read = async (...parameters) => {
        if (!changed) { changed = true; await writeFile(path.join(root, names[0]), JSON.stringify(report("failed"))); }
        return read(...parameters);
      };
    }
    return handle;
  }, () => assert.rejects(readCheckpointHistory(root), { code: "RECURRING_FILES_CHANGED" }));
  assert.equal(changed, true);
});

let realUnavailable;
if (process.platform !== "linux") realUnavailable = "production anchor requires Linux";
else {
  try { if ((await statfs("/proc/self/fd", { bigint: true })).type !== 0x9fa0n) realUnavailable = "procfs is unavailable"; }
  catch { realUnavailable = "procfs is unavailable in this sandbox"; }
}
test("Linux CI must verify recurring files through real pinned directory descriptors", { skip: !process.env.CI || process.platform !== "linux" }, () => {
  assert.equal(realUnavailable, undefined, realUnavailable);
});
test("production dirfd path keeps configuration, recipient, lock and journal in a private pinned root", { skip: realUnavailable }, async t => {
  const root = await fixture(t);
  await put(root, "recurring-backup.json", configuration()); await put(root, "recipient-public.asc", "public recipient");
  assert.deepEqual(await realReadRecurringConfiguration(root), configuration());
  assert.deepEqual(await realReadRecurringRecipientPublicKey(root), Buffer.from("public recipient"));
  await realAcquireRecurringLock(root, async () => { await realAppendCheckpointRecord(root, report()); });
  const result = await realReadCheckpointHistory(root);
  assert.equal(result.lastAttemptAt, report().startedAt); assert.equal(result.lastSuccessAt, null);
  assert.equal((await readdir(root)).includes("recurring-backup.lock"), false);
});
