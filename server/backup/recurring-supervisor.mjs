import { createParentGateway } from "./parent-gateway.mjs";
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
import { runManagedClosures, resumeManagedClosureRuntime } from "./managed-closures.mjs";
import { runManagedWitnessPreparation } from "./managed-witness.mjs";
import { witnessOriginErrorCode } from "./witness-origin-diagnostics.mjs";
import { runWitnessObservationMaintenance } from "./witness-observation-maintenance.mjs";
import { createManualBackupRequests } from "./manual-backup-files.mjs";

const REPOSITORY = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const PROFILE = "photos-notify-recovery-crm-broadcast";
const VIDEO_PROFILE = "photos-notify-recovery-crm-broadcast-video";
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
  if (!Array.isArray(args) || args.some(value => typeof value !== "string")) fail("USAGE");
  const witness = ["plan-witness", "check-witness", "prepare-witness"].includes(args[0]);
  const observer = ["prepare-witness-enrollment", "check-witness-observer", "start-witness-observer"].includes(args[0]);
  const recovery = ["check-witness-recovery", "start-witness-recovery"].includes(args[0]);
  const video = args.includes("--profile");
  if (args.length !== (witness || observer || recovery ? 17 : video ? 15 : 13) || !["check", "start", "check-local-closures", "start-local-closures", "plan-witness", "check-witness", "prepare-witness",
    "prepare-witness-enrollment", "check-witness-observer", "start-witness-observer", "check-witness-recovery", "start-witness-recovery"].includes(args[0])) fail("USAGE");
  const names = new Map([["--runtime-directory", "runtimeDirectory"], ["--runtime-head", "runtimeHead"], ["--runtime-tree", "runtimeTree"],
    ["--private-directory", "privateDirectory"], ["--operations-directory", "operationsDirectory"], ["--private-path-mode", "privatePathMode"],
    ["--witness-operator-directory", "witnessOperatorDirectory"], ["--witness-destination", "witnessDestination"], ["--witness-plan-sha256", "witnessPlanSha256"],
    ["--witness-contract-sha256", "witnessContractSha256"], ["--profile", "profile"]]);
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
  if (video) {
    if (!["check-local-closures", "start-local-closures"].includes(result.command) || result.profile !== VIDEO_PROFILE) fail("USAGE");
    result.video = true;
  }
  const extras = ["witnessOperatorDirectory", "witnessDestination", "witnessPlanSha256", "witnessContractSha256"].filter(name => Object.hasOwn(result, name));
  if (witness || observer || recovery) {
    if (extras.length !== 2 || !path(result.witnessOperatorDirectory)
      || [REPOSITORY, result.runtimeDirectory, result.privateDirectory, result.operationsDirectory].some(root => inside(root, result.witnessOperatorDirectory) || inside(result.witnessOperatorDirectory, root))
      || witness && result.witnessContractSha256 !== undefined
      || witness && args[0] === "plan-witness" && (!/^[a-f0-9]{32}$/.test(result.witnessDestination ?? "") || result.witnessPlanSha256 !== undefined)
      || witness && args[0] !== "plan-witness" && (!/^[a-f0-9]{64}$/.test(result.witnessPlanSha256 ?? "") || result.witnessDestination !== undefined)
      || (observer || recovery) && (!/^[a-f0-9]{64}$/.test(result.witnessContractSha256 ?? "") || result.witnessDestination !== undefined || result.witnessPlanSha256 !== undefined)) fail("USAGE");
  } else if (extras.length) fail("USAGE");
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
        "--private-path-mode", "linux-dirfd", "--destination-private-directory", destination, "--profile", options.video === true ? VIDEO_PROFILE : PROFILE,
        "--operations-directory", options.operationsDirectory];
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
          if (result?.status !== expected || result.profile !== `messaging-${options.video === true ? VIDEO_PROFILE : PROFILE}-application` || result.started !== false
            || result.migrationPerformed !== false || options.video === true && command === "check-application" && (result.schema !== 36
              || result.coverage?.encryptedVideo !== true || result.databaseConnected !== false || result.passwordInputRequired !== false)
            || command === "capture-application" && (result.tables !== (options.video === true ? 36 : 33) || result.migrations !== (options.video === true ? 36 : 33)
              || options.video === true && (result.videoCovered !== true || result.coverage?.encryptedVideo !== true)
              || result.operationsCovered !== true || result.archiveListed !== true || result.archiveContentsVerified !== true || !/^[a-f0-9]{64}$/.test(result.archive?.sha256 ?? ""))) fail("CHECKPOINT");
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
  schedule = setTimeout, unschedule = clearTimeout, closureOperations = null, runClosures = runManagedClosures, resumeClosures = resumeManagedClosureRuntime, witnessControl = null, makeGateway = createParentGateway,
  witnessOriginOperations = null, prepareWitness = runManagedWitnessPreparation, manualBackups = false, manualRequests = null,
  allowManualRequests = () => true } = {}) {
  if (!["start", "prepare-witness"].includes(options.command) || options.video !== undefined && options.video !== true
    || options.video === true && !manualBackups) fail("CONFIGURATION");
  if (witnessControl !== null && typeof witnessControl !== "function") fail("CONFIGURATION");
  if (!Number.isSafeInteger(intervalMilliseconds) || intervalMilliseconds < 1 || intervalMilliseconds > 60000) fail("CONFIGURATION");
  if (closureOperations !== null && ["hasPending", "preflight", "run", "verifyStartup"].some(name => typeof closureOperations?.[name] !== "function")) fail("CONFIGURATION");
  if (typeof resumeClosures !== "function") fail("CONFIGURATION");
  if (typeof allowManualRequests !== "function" || typeof manualBackups !== "boolean" || manualBackups && (closureOperations === null || witnessControl !== null || witnessOriginOperations !== null)
    || manualRequests !== null && !manualBackups) fail("CONFIGURATION");
  const requests = manualBackups ? manualRequests ?? createManualBackupRequests({ operationsDirectory: options.operationsDirectory, clock }) : null;
  if (requests !== null && ["status", "recover", "claim", "complete", "fail"].some(name => typeof requests[name] !== "function")) fail("CONFIGURATION");
  if (witnessOriginOperations !== null && (options.command !== "prepare-witness" || closureOperations !== null || witnessControl !== null
    || typeof prepareWitness !== "function" || ["check", "prepare"].some(name => typeof witnessOriginOperations?.[name] !== "function"))
    || options.command === "prepare-witness" && witnessOriginOperations === null) fail("CONFIGURATION");
  const processOptions = privateAuthenticationProcessOptions(environment, []);
  const cancellation = new AbortController();
  let timer, closed = false, started = false, starting = false, ticking = null, observing = null, closing = null, controller = null, lastNotice = null, fatal = false;
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
  const publicPort = Number(processOptions.port), childPort = witnessControl === null ? publicPort : publicPort + 1;
  if (childPort > 65535) fail("CONFIGURATION");
  const gateway = witnessControl === null ? null : makeGateway({ port: publicPort, childPort, control: witnessControl, onFailure: unexpected });
  const runtime = makeRuntime({ runtimeDirectory: options.runtimeDirectory, privateDirectory: options.privateDirectory, operationsDirectory: options.operationsDirectory,
    port: childPort, environment: witnessControl === null ? environment : { ...environment, PORT: String(childPort) }, onUnexpectedExit: unexpected, accountClosures: closureOperations !== null, ...(options.video === true ? { video: true } : {}),
    ...(witnessControl === null ? {} : { parentGateway: true }) });
  function tick() {
    if (closed || !started || observing) return Promise.resolve(null);
    if (ticking) return ticking;
    ticking = (async () => {
      let ownerStopAttempted = false, manualRequest = null, manualArchiveId = null, manualPreflightPassed = false;
      try {
        let closurePending = false;
        if (closureOperations !== null) {
          try { closurePending = await closureOperations.hasPending(); }
          catch { if (!closed) unexpected(); return null; }
        }
        if (closurePending) {
          try {
            const result = await runClosures({ runtime, operations: closureOperations, directory: options.operationsDirectory,
              source: () => source(options, { signal: cancellation.signal }), signal: cancellation.signal, resumeClosures });
            notice({ version: 1, type: "account_closures", status: "completed", completedReceipts: result.completedReceipts });
          } catch {
            // Never reopen producers after an uncertain destructive operation.
            if (!closed) unexpected();
          }
          return null;
        }
        if (manualBackups) {
          if (allowManualRequests() !== true) return null;
          manualRequest = await requests.status();
          if (manualRequest?.status !== "queued") return null;
        } else {
          const configuration = await readConfiguration(options.operationsDirectory, { signal: cancellation.signal });
          if (!configuration.enabled) return null;
          const previous = await history(options.operationsDirectory, { signal: cancellation.signal });
          if (!recurringCheckpointDue(clock(), configuration, previous)) return null;
        }
        const result = await lock(options.operationsDirectory, async lease => {
          let current;
          if (manualBackups) {
            const claimed = await requests.claim(manualRequest.requestId);
            if (claimed.status !== "running") return null;
          } else {
            current = await readConfiguration(options.operationsDirectory, { signal: cancellation.signal });
            const checkedHistory = await history(options.operationsDirectory, { signal: cancellation.signal });
            if (!recurringCheckpointDue(clock(), current, checkedHistory)) return null;
          }
          const prepared = await preflight(options, { environment, signal: cancellation.signal, readConfiguration });
          if (manualBackups) { current = prepared; manualPreflightPassed = true; }
          else if (["enabled", "recipientSha256", "hourUtc", "minuteUtc"].some(name => prepared?.[name] !== current[name])) fail("CONFIGURATION");
          active(cancellation.signal);
          let destination, stopAttempted = false, stopConfirmed = false;
          controller = createRecurringCheckpoint({ clock,
            record: async report => {
              if (report.status === "running") {
                const archiveId = `capture-${report.startedAt}-${randomBytes(8).toString("hex")}`;
                destination = `${options.operationsDirectory}/${archiveId}`;
                if (manualBackups) manualArchiveId = archiveId;
              }
              await append(options.operationsDirectory, report);
            },
            stopRuntime: async ({ signal }) => {
              active(signal); stopAttempted = true; ownerStopAttempted = closureOperations !== null;
              const result = await runtime.stop();
              stopConfirmed = result?.exitCode === 0 && result.signal === null;
              return result;
            },
            capture: ({ signal }) => checkpoint("capture-application", options, destination, { signal, environment }),
            encrypt: ({ signal }) => encrypt({ checkpointDirectory: destination, recipientDirectory: options.operationsDirectory,
              recipientSha256: current.recipientSha256, signal }),
            resumeRuntime: async ({ signal }) => {
              // The manual owner never reopens after an unconfirmed drain.
              if (manualBackups && !stopConfirmed) fail("RUNTIME");
              active(signal); await source(options, { signal }); active(signal);
              // An intent can arrive after the initial tick check, while the
              // preflight or HTTP drain is in progress. Keep producers stopped.
              if (closureOperations !== null && await closureOperations.hasPending()) fail("RUNTIME");
              if (closureOperations !== null) {
                if (typeof lease?.assertReady !== "function") fail("RUNTIME");
                return resumeClosures({ runtime, operations: closureOperations, signal, assertReady: async () => {
                  active(signal); await source(options, { signal }); await lease.assertReady(); active(signal);
                } });
              }
              active(signal); return runtime.start();
            },
          });
          const report = await controller.run({ signal: cancellation.signal });
          notice(report); lastNotice = null;
          if (!closed && stopAttempted && !report.runtimeResumed) { unexpected(); }
          return report;
        }, { signal: cancellation.signal });
        if (manualBackups && result !== null) {
          if (result.status === "succeeded") await requests.complete(manualRequest.requestId, manualArchiveId);
          else await requests.fail(manualRequest.requestId, result.code === "CANCELLED" ? "CANCELLED" : "CAPTURE_FAILED");
        }
        return result;
      } catch (error) {
        if (manualRequest?.status === "queued") {
          try { await requests.fail(manualRequest.requestId, cancellation.signal.aborted ? "CANCELLED" : manualPreflightPassed ? "CAPTURE_FAILED" : "PREFLIGHT_FAILED"); }
          catch { /* An uncertain state is preserved for startup recovery. */ }
        }
        if (!closed) {
          // A lock may reject during final descriptor/sync/unlink checks after
          // the callback reopened the child. End this owner without awaiting
          // close here: close itself waits for the current ticking operation.
          if (ownerStopAttempted) unexpected();
          else unavailable(error);
        }
        return null;
      }
      finally { controller = null; }
    })().finally(() => { ticking = null; });
    return ticking;
  }
  function arm() {
    if (closed) return;
    timer = schedule(() => { void tick().finally(arm); }, intervalMilliseconds);
  }
  function withWitnessMaintenance(work, verifyResume) {
    // This capability is handed only to the fixed non-destructive observer.
    // It is never available alongside an erasure owner or a direct listener.
    if (closed || !started || ticking || observing || closureOperations !== null || witnessControl === null
      || typeof work !== "function" || typeof verifyResume !== "function") return Promise.reject(new RecurringSupervisorError("RUNTIME"));
    observing = runWitnessObservationMaintenance({ runtime, directory: options.operationsDirectory,
      source: () => source(options, { signal: cancellation.signal }), work, verifyResume, signal: cancellation.signal })
      .catch(error => { if (!closed && runtime.state().status !== "running") unexpected(); throw error; })
      .finally(() => { observing = null; });
    return observing;
  }
  async function start() {
    if (closed || started || starting) fail("RUNTIME");
    starting = true; let witnessPhase = "initial_precheck";
    try {
      await source(options, { signal: cancellation.signal }); active(cancellation.signal);
      // Recovery is serialized with captures and closures. A stale running
      // request is failed, never replayed; queued requests have a short TTL.
      if (manualBackups) await lock(options.operationsDirectory, async lease => {
        if (typeof lease?.assertReady !== "function") fail("RUNTIME");
        await lease.assertReady(); await requests.recover(); await lease.assertReady();
      }, { signal: cancellation.signal });
      // Initial-only operator preparation never runs from a normal startup,
      // timer, recovery or public request. Reject its plan before any listener.
      if (witnessOriginOperations !== null) {
        notice({ version: 1, type: "witness_origin_progress", phase: "initial_precheck", event: "started" });
        await witnessOriginOperations.check();
        notice({ version: 1, type: "witness_origin_progress", phase: "initial_precheck", event: "passed" });
      }
      await gateway?.start(); active(cancellation.signal);
      // A queued confirmed intent survives a parent/child restart. Resolve it
      // while the child is still stopped, before any listener or producer.
      witnessPhase = "initial_start";
      if (witnessOriginOperations !== null) notice({ version: 1, type: "witness_origin_progress", phase: witnessPhase, event: "started" });
      if (closureOperations === null) await runtime.start();
      else if (await closureOperations.hasPending()) {
        // This owner already verifies and reopens under its own capture lock.
        await runClosures({ runtime, operations: closureOperations, directory: options.operationsDirectory,
          source: () => source(options, { signal: cancellation.signal }), signal: cancellation.signal, resumeClosures });
        if (runtime.state().status !== "running") fail("RUNTIME");
      } else await lock(options.operationsDirectory, async lease => {
        if (typeof lease?.assertReady !== "function") fail("RUNTIME");
        await resumeClosures({ runtime, operations: closureOperations, signal: cancellation.signal, assertReady: async () => {
          active(cancellation.signal); await source(options, { signal: cancellation.signal }); await lease.assertReady(); active(cancellation.signal);
        } });
      }, { signal: cancellation.signal });
      if (closed) fail("ABORTED");
      if (witnessOriginOperations !== null) {
        notice({ version: 1, type: "witness_origin_progress", phase: "initial_start", event: "passed" });
        witnessPhase = "maintenance";
        const report = await prepareWitness({ runtime, operations: witnessOriginOperations,
          source: () => source(options, { signal: cancellation.signal }), signal: cancellation.signal, emit: notice });
        notice(report);
      }
      if (closed) fail("ABORTED"); started = true;
      notice({ version: 1, type: "recurring_supervisor", status: "started", backupStarted: false, nodeVersion: process.version,
        ...(manualBackups ? { backupMode: "manual" } : {}) });
      void tick().finally(arm);
      return { ready: true };
    } catch (error) {
      if (witnessOriginOperations !== null) {
        notice({ version: 1, type: "witness_origin_progress", phase: witnessPhase, event: "failed", code: witnessOriginErrorCode(error) });
      }
      if (witnessOriginOperations !== null || closureOperations !== null) {
        try { await runtime.destroy(); } catch { fatal = true; }
        try { await gateway?.close(); } catch { fatal = true; }
      }
      throw error;
    } finally { starting = false; }
  }
  function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      let cleanupFailed = false;
      const attempt = async work => { try { await work(); } catch { cleanupFailed = true; fatal = true; } };
      await attempt(() => unschedule(timer)); cancellation.abort();
      await attempt(() => controller?.close());
      await attempt(() => ticking);
      // Cancelling witness maintenance intentionally rejects its work promise.
      // A failed runtime drain is still observed independently by destroy().
      try { await observing; } catch {}
      await attempt(() => runtime.destroy());
      await attempt(() => gateway?.close());
      finish({ failed: fatal });
      if (cleanupFailed) fail("RUNTIME");
    })();
    return closing;
  }
  return Object.freeze({ start, tick, close, withWitnessMaintenance, failWitnessObservation: unexpected, finished,
    state: () => Object.freeze({ closed, started, backupRunning: controller?.state().status === "running" }) });
}
