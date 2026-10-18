import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { statfs } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { privateAuthenticationProcessOptions } from "../config/private-auth-environment.mjs";
import { createRecurringCheckpoint, nextDailyCheckpoint } from "./recurring-checkpoint.mjs";
import { readRecurringConfiguration, readCheckpointHistory, acquireRecurringLock, appendCheckpointRecord } from "./recurring-checkpoint-files.mjs";
import { inspectCheckpointRecipient, encryptCheckpointArchive } from "./checkpoint-encryption.mjs";
import { createManagedRuntime } from "./managed-runtime.mjs";

const REPOSITORY = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const PROFILE = "photos-notify-recovery-crm-broadcast";
const DAY = 86400000, MAX_DATE = 253402300799999;
const MINIMUM_FREE = 8n * 1024n ** 3n;
const CODE_SUFFIXES = ["USAGE", "ENVIRONMENT", "SOURCE", "SPACE", "CONFIGURATION", "CHECKPOINT", "TIMEOUT", "ABORTED", "RUNTIME", "OPERATION"];
export class RecurringSupervisorError extends Error {
  constructor(suffix = "OPERATION") {
    super("The private recurring backup operation was not confirmed.");
    this.name = "RecurringSupervisorError";
    this.code = `RECURRING_SUPERVISOR_${CODE_SUFFIXES.includes(suffix) ? suffix : "OPERATION"}`;
  }
}
const fail = suffix => { throw new RecurringSupervisorError(suffix); };
const active = signal => { if (signal?.aborted) fail("ABORTED"); };
const integerDate = now => Number.isSafeInteger(now) && now >= 0 && now <= MAX_DATE;
const path = value => typeof value === "string" && value.startsWith("/") && value !== "/" && resolve(value) === value
  && value.length <= 4096 && !/[\\\x00-\x1f\x7f]/.test(value);
const inside = (value, root) => { const part = relative(root, value); return part === "" || part !== ".." && !part.startsWith(`..${sep}`) && !part.startsWith(sep); };
const knownCode = error => /^(?:RECURRING_(?:SUPERVISOR|FILES|CHECKPOINT)|CHECKPOINT_ENCRYPTION|MANAGED_RUNTIME)_[A-Z_]{1,40}$/.test(error?.code ?? "")
  ? error.code : "RECURRING_SUPERVISOR_OPERATION";

export function parseRecurringArguments(args) {
  if (!Array.isArray(args) || args.length !== 13 || args.some(value => typeof value !== "string") || !["check", "start"].includes(args[0])) fail("USAGE");
  const names = new Map([["--runtime-directory", "runtimeDirectory"], ["--runtime-head", "runtimeHead"], ["--runtime-tree", "runtimeTree"],
    ["--private-directory", "privateDirectory"], ["--operations-directory", "operationsDirectory"], ["--private-path-mode", "privatePathMode"]]);
  const result = { command: args[0] };
  for (let index = 1; index < args.length; index += 2) {
    const name = names.get(args[index]);
    if (!name || Object.hasOwn(result, name)) fail("USAGE");
    result[name] = args[index + 1];
  }
  if (![result.runtimeDirectory, result.privateDirectory, result.operationsDirectory].every(path)
    || !/^[a-f0-9]{40}$/.test(result.runtimeHead ?? "") || !/^[a-f0-9]{40}$/.test(result.runtimeTree ?? "")
    || result.privatePathMode !== "linux-dirfd" || inside(result.privateDirectory, REPOSITORY) || inside(result.operationsDirectory, REPOSITORY)
    || inside(result.operationsDirectory, result.privateDirectory) || inside(result.privateDirectory, result.operationsDirectory)
    || inside(result.runtimeDirectory, result.privateDirectory) || inside(result.runtimeDirectory, result.operationsDirectory)
    || inside(result.privateDirectory, result.runtimeDirectory) || inside(result.operationsDirectory, result.runtimeDirectory)) fail("USAGE");
  return Object.freeze(result);
}

/** Never execute a runtime whose reviewed source identity has changed. */
export async function assertRuntimeSource(options, { signal } = {}) {
  try {
    active(signal);
    const env = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
    const invoke = async args => (await promisify(execFile)("/usr/bin/git", ["-C", options.runtimeDirectory, ...args],
      { env, encoding: "utf8", maxBuffer: 8192, timeout: 10000, signal })).stdout.trim();
    if (await invoke(["rev-parse", "HEAD"]) !== options.runtimeHead || await invoke(["rev-parse", "HEAD^{tree}"]) !== options.runtimeTree
      || await invoke(["status", "--porcelain", "--untracked-files=normal"]) !== "") fail("SOURCE");
    active(signal);
  } catch { if (signal?.aborted) fail("ABORTED"); fail("SOURCE"); }
}

/** Conservative reserve covers raw dump, photo copy, archive and ciphertext. */
export async function inspectCheckpointSpace(directory, { signal } = {}) {
  try {
    active(signal);
    return await withPrivateDirectory(directory, async scope => {
      const before = await scope.assertReady(), value = await statfs(`${scope.path}/.`, { bigint: true });
      if (value.bsize < 1n || value.bavail < 0n || value.bsize * value.bavail < MINIMUM_FREE) fail("SPACE");
      const after = await scope.assertReady(); active(signal);
      if (before.dev !== after.dev || before.ino !== after.ino) fail("SPACE");
      return { freeSpaceSufficient: true };
    });
  } catch { if (signal?.aborted) fail("ABORTED"); fail("SPACE"); }
}

/** The only subprocess command is the existing explicit application capture. */
export async function checkpointProcess(command, options, destination, { signal, environment = process.env } = {}, internal = {}) {
  if (!["check-application", "capture-application"].includes(command) || !path(destination)) fail("USAGE");
  const spawnClient = internal.spawnClient ?? spawn;
  const timeoutMilliseconds = internal.timeoutMilliseconds ?? (command === "capture-application" ? 300000 : 30000);
  const killMilliseconds = internal.killMilliseconds ?? 10000;
  if (![timeoutMilliseconds, killMilliseconds].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 300000)) fail("USAGE");
  active(signal);
  return new Promise((yes, no) => {
    let child, timer, killTimer, failed = null, output = [], length = 0, diagnosticBytes = 0;
    const abort = () => stop("ABORTED");
    const stop = suffix => {
      failed ??= suffix;
      try { child?.kill("SIGTERM"); } catch {}
      killTimer ??= setTimeout(() => { try { child?.kill("SIGKILL"); } catch {} }, killMilliseconds);
    };
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener("abort", abort); };
    try {
      const args = [fileURLToPath(new URL("../../scripts/private-checkpoint-child.mjs", import.meta.url)), command,
        ...(command === "capture-application" ? ["--offline"] : []), "--private-directory", options.privateDirectory,
        "--private-path-mode", "linux-dirfd", "--destination-private-directory", destination, "--profile", PROFILE];
      child = spawnClient(process.execPath, args, { cwd: REPOSITORY, env: environment, stdio: ["ignore", "pipe", "pipe", "ipc"] });
      timer = setTimeout(() => stop("TIMEOUT"), timeoutMilliseconds);
      signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
      child.stdout.on("data", bytes => {
        length += bytes.length;
        if (length > 16384) { bytes.fill(0); stop("CHECKPOINT"); }
        else { output.push(Buffer.from(bytes)); bytes.fill(0); }
      });
      child.stderr.on("data", bytes => { diagnosticBytes += bytes.length; bytes.fill(0); if (diagnosticBytes > 8192) stop("CHECKPOINT"); });
      child.stdout.on("error", () => stop("CHECKPOINT")); child.stderr.on("error", () => stop("CHECKPOINT"));
      child.once("error", () => stop("CHECKPOINT"));
      child.once("close", (exitCode, exitSignal) => {
        cleanup();
        try {
          if (failed || exitCode !== 0 || exitSignal !== null) fail(failed ?? "CHECKPOINT");
          const bytes = Buffer.concat(output); let result;
          try { result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } finally { bytes.fill(0); }
          const expected = command === "capture-application" ? "application_checkpoint_saved" : "application_precheck_passed";
          if (result?.status !== expected || result.profile !== "messaging-photos-notify-recovery-crm-broadcast-application" || result.started !== false
            || result.migrationPerformed !== false || command === "capture-application" && (result.tables !== 30 || result.migrations !== 30
              || result.archiveListed !== true || result.archiveContentsVerified !== true || !/^[a-f0-9]{64}$/.test(result.archive?.sha256 ?? ""))) fail("CHECKPOINT");
          yes({ saved: command === "capture-application", precheckPassed: command === "check-application" });
        } catch (error) { no(error instanceof RecurringSupervisorError ? error : new RecurringSupervisorError("CHECKPOINT")); }
        finally { output.forEach(bytes => bytes.fill(0)); output = []; }
      });
    } catch { cleanup(); try { child?.kill("SIGKILL"); } catch {} no(new RecurringSupervisorError("CHECKPOINT")); }
  });
}

export function recurringCheckpointDue(now, configuration, history) {
  if (!integerDate(now) || history.lastAttemptAt !== null && (!integerDate(history.lastAttemptAt) || history.lastAttemptAt > now)) fail("CONFIGURATION");
  if (!configuration.enabled) return false;
  if (history.lastAttemptAt === null) return true;
  return history.lastAttemptAt < nextDailyCheckpoint(now, configuration) - DAY;
}

export async function recurringPreflight(options, { environment = process.env, signal, destination,
  readConfiguration = readRecurringConfiguration, inspectRecipient = inspectCheckpointRecipient,
  inspectSpace = inspectCheckpointSpace, source = assertRuntimeSource, checkpoint = checkpointProcess } = {}) {
  active(signal);
  const configuration = await readConfiguration(options.operationsDirectory, { signal });
  await source(options, { signal });
  await inspectRecipient({ recipientDirectory: options.operationsDirectory, recipientSha256: configuration.recipientSha256, signal });
  await inspectSpace(options.operationsDirectory, { signal });
  await checkpoint("check-application", options, destination ?? `${options.operationsDirectory}/capture-preflight-${randomBytes(8).toString("hex")}`, { signal, environment });
  active(signal);
  return configuration;
}

/** Daily parent controller; availability survives backup configuration errors. */
export function createRecurringSupervisor(options, { environment = process.env, clock = Date.now,
  readConfiguration = readRecurringConfiguration, history = readCheckpointHistory, lock = acquireRecurringLock,
  append = appendCheckpointRecord, preflight = recurringPreflight, source = assertRuntimeSource, checkpoint = checkpointProcess,
  encrypt = encryptCheckpointArchive, makeRuntime = createManagedRuntime, emit = () => {}, intervalMilliseconds = 60000,
  schedule = setTimeout, unschedule = clearTimeout } = {}) {
  if (!Number.isSafeInteger(intervalMilliseconds) || intervalMilliseconds < 1 || intervalMilliseconds > 60000) fail("CONFIGURATION");
  const processOptions = privateAuthenticationProcessOptions(environment, []);
  const cancellation = new AbortController();
  let timer, closed = false, started = false, starting = false, ticking = null, closing = null, controller = null, lastNotice = null, fatal = false;
  let finish; const finished = new Promise(resolveFinished => { finish = resolveFinished; });
  const notice = value => { try { emit(value); } catch {} };
  const unavailable = error => {
    const code = knownCode(error);
    if (lastNotice !== code) notice({ version: 1, type: "recurring_backup_notice", status: "unavailable", code });
    lastNotice = code;
  };
  const unexpected = () => {
    if (!closed) { fatal = true; unavailable(new RecurringSupervisorError("RUNTIME")); void close().catch(() => finish({ failed: true })); }
  };
  const runtime = makeRuntime({ runtimeDirectory: options.runtimeDirectory, privateDirectory: options.privateDirectory, operationsDirectory: options.operationsDirectory,
    port: Number(processOptions.port), environment, onUnexpectedExit: unexpected });
  function tick() {
    if (closed || !started) return Promise.resolve(null);
    if (ticking) return ticking;
    ticking = (async () => {
      try {
        const configuration = await readConfiguration(options.operationsDirectory, { signal: cancellation.signal });
        if (!configuration.enabled) return null;
        const previous = await history(options.operationsDirectory, { signal: cancellation.signal });
        if (!recurringCheckpointDue(clock(), configuration, previous)) return null;
        return await lock(options.operationsDirectory, async () => {
          const current = await readConfiguration(options.operationsDirectory, { signal: cancellation.signal });
          const checkedHistory = await history(options.operationsDirectory, { signal: cancellation.signal });
          if (!recurringCheckpointDue(clock(), current, checkedHistory)) return null;
          const prepared = await preflight(options, { environment, signal: cancellation.signal, readConfiguration });
          if (["enabled", "recipientSha256", "hourUtc", "minuteUtc"].some(name => prepared?.[name] !== current[name])) fail("CONFIGURATION");
          active(cancellation.signal);
          let destination, stopAttempted = false;
          controller = createRecurringCheckpoint({ clock,
            record: async report => {
              if (report.status === "running") destination = `${options.operationsDirectory}/capture-${report.startedAt}-${randomBytes(8).toString("hex")}`;
              await append(options.operationsDirectory, report);
            },
            stopRuntime: async ({ signal }) => { active(signal); stopAttempted = true; return runtime.stop(); },
            capture: ({ signal }) => checkpoint("capture-application", options, destination, { signal, environment }),
            encrypt: ({ signal }) => encrypt({ checkpointDirectory: destination, recipientDirectory: options.operationsDirectory,
              recipientSha256: current.recipientSha256, signal }),
            resumeRuntime: async ({ signal }) => { active(signal); await source(options, { signal }); active(signal); return runtime.start(); },
          });
          const report = await controller.run({ signal: cancellation.signal });
          notice(report); lastNotice = null;
          if (!closed && stopAttempted && !report.runtimeResumed) { unexpected(); }
          return report;
        }, { signal: cancellation.signal });
      } catch (error) { if (!closed) unavailable(error); return null; }
      finally { controller = null; }
    })().finally(() => { ticking = null; });
    return ticking;
  }
  function arm() {
    if (closed) return;
    timer = schedule(() => { void tick().finally(arm); }, intervalMilliseconds);
  }
  async function start() {
    if (closed || started || starting) fail("RUNTIME");
    starting = true;
    try {
      await source(options, { signal: cancellation.signal }); active(cancellation.signal);
      await runtime.start(); if (closed) fail("ABORTED"); started = true;
      notice({ version: 1, type: "recurring_supervisor", status: "started", backupStarted: false });
      void tick().finally(arm);
      return { ready: true };
    } finally { starting = false; }
  }
  function close() {
    if (closing) return closing;
    closed = true; unschedule(timer); cancellation.abort();
    closing = (async () => {
      await controller?.close();
      await ticking;
      await runtime.destroy();
      finish({ failed: fatal });
    })();
    return closing;
  }
  return Object.freeze({ start, tick, close, finished, state: () => Object.freeze({ closed, started, backupRunning: controller?.state().status === "running" }) });
}
