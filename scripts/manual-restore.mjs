import { constants } from "node:fs";
import { lstat, mkdir, open, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { createPrivateJsonStore } from "../server/files/private-json.mjs";
import { loadManualOperatorContext } from "../server/backup/manual-operator-context.mjs";
import { acquireRecurringLock, readRecurringConfiguration, readRecurringRecipientPublicKey } from "../server/backup/recurring-checkpoint-files.mjs";
import { readCopyState } from "../server/backup/copy-files.mjs";
import { copyCheckpointMedia, verifyCheckpointMedia } from "../server/backup/checkpoint-files.mjs";
import { readCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";
import { readOperationalCheckpoint, readOperationalQuarantine, restoreOperationalQuarantine } from "../server/backup/operational-checkpoint.mjs";
import { backupIdentity } from "../server/backup/manifest.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { createApplicationInspectionPool } from "../server/backup/application-scope.mjs";
import { reconcileManualRestore, publishManualRestore } from "../server/backup/manual-restore.mjs";
import { createRecurringSupervisor } from "../server/backup/recurring-supervisor.mjs";
import { createManagedRuntime } from "../server/backup/managed-runtime.mjs";
import { main as recurringMain } from "./start-recurring-private-messaging.mjs";
import { run as resumeCheckpoint, connectOperatorDatabase, inspectResumeClone } from "./resume-application-checkpoint.mjs";
import { readPassword } from "./migration-input.mjs";

const HEX = /^[a-f0-9]{64}$/;
export class ManualOperatorError extends Error {
  constructor(suffix = "UNAVAILABLE") { super("La restauration manuelle n’est pas confirmée."); this.name = "ManualOperatorError"; this.code = `MANUAL_OPERATOR_${suffix}`; }
}
const fail = suffix => { throw new ManualOperatorError(suffix); };
const active = signal => { if (signal?.aborted) fail("ABORTED"); };
export function parseArguments(args) {
  if (!Array.isArray(args) || args.some(value => typeof value !== "string") || !["check", "restore", "open"].includes(args[0])
    || args[1] !== "--operator-directory" || typeof args[2] !== "string" || !args[2].startsWith("/") || args[2] === "/"
    || resolve(args[2]) !== args[2] || /[\\\x00-\x1f\x7f]/.test(args[2]) || args.length !== (args[0] === "open" ? 5 : 3)
    || args[0] === "open" && (args[3] !== "--confirm-plan-sha256" || !HEX.test(args[4]))) fail("USAGE");
  return { command: args[0], operatorDirectory: args[2], ...(args[0] === "open" ? { expectedPlanSha256: args[4] } : {}) };
}

function validateState(value) {
  const names = ["version", "revision", "jobSha256", "phase", "planSha256"];
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== names.length
    || names.some(name => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, "value"))
    || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !["new", "allocated", "imported", "reconciled", "opening", "opened"].includes(value.phase)
    || (value.phase === "new" ? value.revision !== 0 || value.jobSha256 !== null || value.planSha256 !== null
      : !HEX.test(value.jobSha256 ?? "") || (["reconciled", "opening", "opened"].includes(value.phase) ? !HEX.test(value.planSha256 ?? "") : value.planSha256 !== null))) fail("STATE");
  return Object.fromEntries(names.map(name => [name, value[name]]));
}
const stateStore = createPrivateJsonStore({ name: "manual-restore-state.json", lock: "manual-restore-state.lock", maxBytes: 2048,
  validate: validateState, empty: () => ({ version: 1, revision: 0, jobSha256: null, phase: "new", planSha256: null }),
  fail: suffix => fail(`STATE_${suffix.toUpperCase()}`), isKnownError: error => error instanceof ManualOperatorError });

async function withOperatorLock(directory, work, signal) {
  let failure;
  const result = await acquireRecurringLock(directory, async lease => {
    try { return await work(lease); }
    catch (error) { failure = error; return null; }
  }, { signal });
  if (failure) throw failure;
  return result;
}

async function privateWrite(scope, name, content) {
  await scope.assertReady(); let file;
  try {
    try { file = await open(scope.file(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await open(scope.file(name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const before = await existing.stat({ bigint: true });
        if (!before.isFile() || before.uid !== BigInt(process.getuid()) || (before.mode & 0o7777n) !== 0o600n || before.nlink !== 1n || before.size !== BigInt(content.length)) fail("SETTINGS");
        const bytes = Buffer.alloc(content.length + 1);
        try {
          const { bytesRead } = await existing.read(bytes, 0, bytes.length, 0), after = await existing.stat({ bigint: true }), visible = await lstat(scope.file(name), { bigint: true });
          if (bytesRead !== content.length || !bytes.subarray(0, bytesRead).equals(content)
            || ["dev", "ino", "mode", "uid", "nlink", "size", "mtimeNs", "ctimeNs"].some(key => before[key] !== after[key] || after[key] !== visible[key])) fail("SETTINGS");
        } finally { bytes.fill(0); }
      } finally { await existing.close(); }
      return;
    }
    await file.writeFile(content); await file.sync(); await scope.sync(); await scope.assertReady();
  } finally { await file?.close(); }
}

async function copyBackupSettings(context, signal) {
  const source = context.job.sourceOperationsDirectory;
  const read = async () => {
    const configuration = await readRecurringConfiguration(source, { signal });
    const recipient = await readRecurringRecipientPublicKey(source, { signal });
    const copies = await readCopyState(source);
    return [Buffer.from(`${JSON.stringify(configuration)}\n`), recipient, Buffer.from(`${JSON.stringify(copies)}\n`)];
  };
  const bytes = await read();
  try {
    await context.assertReady();
    await withPrivateDirectory(context.paths.journalDirectory, async scope => {
      for (const [index, name] of ["recurring-backup.json", "recipient-public.asc", "backup-copy-state.json"].entries()) await privateWrite(scope, name, bytes[index]);
    });
    const current = await read();
    try { if (bytes.some((value, index) => !value.equals(current[index]))) fail("SETTINGS_CHANGED"); }
    finally { current.forEach(value => value.fill(0)); }
  } finally { bytes.forEach(value => value.fill(0)); }
}

/** The normal daily parent owns the real child, monitors and alerts after the
 * one-time publication. Captures stay paused only until publication completes. */
export function createRestoredService(context, { environment = process.env, signal, outputStream = process.stdout } = {}, internal = {}) {
  const cancellation = new AbortController();
  let runtime, supervisor, service, stopped = false, allowed = false, resolveReady, rejectReady;
  const ready = new Promise((yes, no) => { resolveReady = yes; rejectReady = no; });
  ready.catch(() => {});
  const abort = () => cancellation.abort(); signal?.addEventListener("abort", abort, { once: true });
  const { job, paths } = context;
  const options = ["start-local-closures", "--runtime-directory", job.runtimeDirectory, "--runtime-head", job.runtimeHead, "--runtime-tree", job.runtimeTree,
    "--private-directory", job.targetPrivateDirectory, "--operations-directory", paths.journalDirectory, "--private-path-mode", "linux-dirfd"];
  return Object.freeze({
    state: () => stopped ? { status: "stopped" } : runtime?.state() ?? { status: "stopped" },
    async start() {
      if (service || signal?.aborted) fail("SERVICE");
      service = (internal.recurringMain ?? recurringMain)(options, { environment, execArgv: [], signal: cancellation.signal, outputStream,
        makeSupervisor: (selected, dependencies) => {
          supervisor = (internal.makeSupervisor ?? createRecurringSupervisor)(selected, { ...dependencies,
            readConfiguration: async (...args) => { const value = await (internal.readConfiguration ?? readRecurringConfiguration)(...args); return allowed ? value : { ...value, enabled: false }; },
            makeRuntime: (...args) => { runtime = (internal.makeRuntime ?? createManagedRuntime)(...args); return runtime; } });
          return { ...supervisor, async start() { try { const result = await supervisor.start(); resolveReady(result); return result; } catch (error) { rejectReady(error); throw error; } } };
        } });
      service.catch(rejectReady); return ready;
    },
    async stop() {
      const result = runtime ? await runtime.stop() : { exitCode: 0, signal: null };
      if (result?.exitCode !== 0 || result.signal !== null) fail("DRAIN");
      stopped = true; cancellation.abort();
      if (service) { try { await service; } catch {} }
      return result;
    },
    allowCaptures() { allowed = true; },
    async finished() { if (!service) fail("SERVICE"); return service; },
    async close() { signal?.removeEventListener("abort", abort); if (service) { cancellation.abort(); await service; } },
  });
}

export async function run(selected, { environment = process.env, signal, inputStream = process.stdin, outputStream = process.stdout } = {}, internal = {}) {
  const options = parseArguments([selected?.command, "--operator-directory", selected?.operatorDirectory,
    ...(selected?.command === "open" ? ["--confirm-plan-sha256", selected.expectedPlanSha256] : [])]);
  let context, pool, inspectionPool, password = "", connection, service;
  const emit = value => outputStream.write(`${JSON.stringify(value)}\n`);
  try {
    active(signal); context = await (internal.loadContext ?? loadManualOperatorContext)(options.operatorDirectory, { environment, signal });
    const resume = internal.resumeCheckpoint ?? resumeCheckpoint;
    if (options.command === "check") {
      await resume({ ...context.importSelection, command: "check" }, { inheritedEnv: environment, execArgv: [], signal });
      const state = await stateStore.read(options.operatorDirectory);
      if (state.phase !== "new" && state.jobSha256 !== context.jobSha256) fail("JOB_CHANGED");
      const result = { status: "manual_operator_precheck_passed", phase: state.phase, databaseConnected: false, imported: false, started: false };
      emit(result); return result;
    }
    return await withOperatorLock(options.operatorDirectory, async lease => {
      let state = await stateStore.read(options.operatorDirectory);
      const guard = async () => { active(signal); await lease.assertReady(); await context.assertReady(); };
      const save = async (phase, planSha256 = state.planSha256) => {
        await guard(); state = await stateStore.save(options.operatorDirectory,
          { ...state, jobSha256: context.jobSha256, phase, planSha256 }, state.revision, { beforeCommit: guard });
      };
      if (state.phase !== "new" && state.jobSha256 !== context.jobSha256) fail("JOB_CHANGED");
      if (["opening", "opened"].includes(state.phase)) fail("ALREADY_OPENED_OR_UNCERTAIN");
      const { job, paths } = context;
      if (options.command === "restore" && ["new", "allocated"].includes(state.phase)) {
        await guard();
        password = await (internal.readSecret ?? readPassword)(inputStream);
        if (typeof password !== "string" || !password || !password.isWellFormed() || /[\x00-\x1f\x7f]/.test(password) || Buffer.byteLength(password) > 4096) fail("PASSWORD");
        if (state.phase === "new") {
          const source = context.sourceEnvironment;
          connection = await (internal.connect ?? connectOperatorDatabase)({ JESSIEMESSAGE_DB_HOST: source.JESSIEMESSAGE_DB_HOST,
            JESSIEMESSAGE_DB_PORT: source.JESSIEMESSAGE_DB_PORT, JESSIEMESSAGE_DB_NAME: job.targetDatabase,
            JESSIEMESSAGE_MIGRATION_DATABASE: job.targetDatabase, JESSIEMESSAGE_DB_USER: job.importUser,
            JESSIEMESSAGE_DB_PASSWORD: password, JESSIEMESSAGE_DB_TLS_CA_PATH: "/etc/ssl/certs/ca-certificates.crt" });
          if (await (internal.inspect ?? inspectResumeClone)(connection, job.targetDatabase) !== "empty") fail("TARGET_NOT_EMPTY");
          await connection.end(); connection = undefined; await guard();
          await withPrivateDirectory(options.operatorDirectory, async scope => { await mkdir(scope.file("target"), { mode: 0o700 }); await scope.sync(); });
          await withPrivateDirectory(paths.targetDirectory, async scope => {
            for (const name of ["media", "operations", "progress", "quarantine"]) await mkdir(scope.file(name), { mode: 0o700 });
            await scope.sync();
          });
          await save("allocated", null);
        }
        await guard();
        await resume({ ...context.importSelection, command: "resume" }, { inheritedEnv: environment, execArgv: [], readSecret: async () => password, signal });
        password = "";
        const receipt = await withPrivateDirectory(job.checkpointDirectory, scope => readCheckpointReceipt(scope, { signal }));
        await withPrivateDirectory(paths.rootPath, async target => {
          if ((await readdir(target.path)).length === 0) await withPrivateDirectory(`${job.checkpointDirectory}/media`, source => copyCheckpointMedia(source, target, { signal }));
          await verifyCheckpointMedia(target, receipt.media, { signal });
        });
        await save("imported", null);
      }
      if (options.command === "open" && (state.phase !== "reconciled" || state.planSha256 !== options.expectedPlanSha256)) fail("PLAN_CONFIRMATION");
      if (!["imported", "reconciled"].includes(state.phase)) fail("STATE");
      await guard();
      const storage = await (internal.makeStorage ?? createMediaStorage)({ root: paths.rootPath, key: context.keys.mediaKey, pathMode: "linux-dirfd" });
      const targetIdentity = await backupIdentity({ databaseName: job.targetDatabase, rootPath: paths.rootPath, storage, mediaKey: context.keys.mediaKey });
      const targetBinding = { database: job.targetDatabase, rootFingerprint: targetIdentity.rootFingerprint };
      const receipt = await withPrivateDirectory(job.checkpointDirectory, scope => readCheckpointReceipt(scope, { signal }));
      const backup = await withPrivateDirectory(job.checkpointDirectory, scope => readOperationalCheckpoint(scope, receipt, context.keys.crmKey, { signal }));
      await withPrivateDirectory(paths.quarantineDirectory, async scope => {
        if ((await readdir(scope.path)).length === 0) await restoreOperationalQuarantine(scope, { backup, current: context.recentRegistry, targetBinding,
          key: context.keys.crmKey, expectedCurrentSha256: job.registrySha256, assertCurrent: guard, signal });
        else await readOperationalQuarantine(scope, { key: context.keys.crmKey, sourceBinding: context.sourceBinding, targetBinding, signal });
      });
      pool = await (internal.createPool ?? createRuntimePool)(context.targetEnvironment);
      inspectionPool = await (internal.createInspectionPool ?? createApplicationInspectionPool)(context.targetEnvironment);
      const maintenance = { async withQuiescedProducers(work) {
        // Only this newly allocated, never-opened target belongs to this job.
        // stop() without a child is not used as evidence about another process.
        const quiescent = async () => { await guard(); if (service && service.state().status !== "stopped") fail("MAINTENANCE"); };
        await quiescent(); return work(quiescent);
      } };
      const input = { checkpointDirectory: job.checkpointDirectory, quarantineDirectory: paths.quarantineDirectory,
        journalDirectory: paths.journalDirectory, progressDirectory: paths.progressDirectory, recentRegistry: context.recentRegistry,
        expectedRegistrySha256: job.registrySha256, readRecentRegistry: async () => { await context.assertReady(); return context.recentRegistry; },
        keys: context.keys, target: { database: job.targetDatabase, rootPath: paths.rootPath, storage, pool, inspectionPool }, maintenance, assertReady: guard, signal };
      if (options.command === "restore") {
        const result = await (internal.reconcile ?? reconcileManualRestore)(input);
        await copyBackupSettings(context, signal); await save("reconciled", result.planSha256);
        emit(result); return result;
      }
      await copyBackupSettings(context, signal);
      service = (internal.makeService ?? createRestoredService)(context, { environment, signal, outputStream });
      await save("opening");
      let published = false;
      try {
        const runtime = { state: service.state, stop: service.stop, async start() { await service.start(); await save("opened"); } };
        const result = await (internal.publish ?? publishManualRestore)(input, { expectedPlanSha256: options.expectedPlanSha256, runtime });
        published = true; service.allowCaptures(); emit(result);
        // Normal service lifetime: the existing parent handles actual SIGTERM
        // drain, daily captures, closure priority, monitor and alerts.
        await service.finished(); return result;
      } catch (error) {
        if (!published) {
          const stopped = await service.stop();
          if (stopped?.exitCode !== 0 || stopped.signal !== null) fail("DRAIN");
          // publish restores its exact hold before throwing after a failed open.
          // Cancellation leaves the durable opening state for operator review.
          if (!signal?.aborted) await save("reconciled");
        }
        throw error;
      }
    }, signal);
  } catch (error) {
    if (error instanceof ManualOperatorError || /^(?:MANUAL_RESTORE|MANUAL_OPERATOR_CONTEXT|APPLICATION_CHECKPOINT_RESUME)_[A-Z_]+$/.test(error?.code ?? "")) throw error;
    fail("UNAVAILABLE");
  } finally {
    password = "";
    try { await service?.close(); } finally {
      try { await connection?.end(); } finally {
        try { await pool?.end(); } finally { try { await inspectionPool?.end(); } finally { await context?.close(); } }
      }
    }
  }
}

export async function main(args = process.argv.slice(2), dependencies = {}, internal = {}) { return run(parseArguments(args), dependencies, internal); }
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController(); let deadline;
  const stop = () => { if (cancellation.signal.aborted) return; cancellation.abort(); deadline = setTimeout(() => process.exit(1), 40000); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try { await main(process.argv.slice(2), { signal: cancellation.signal }); }
  catch (error) {
    const code = /^[A-Z_]{1,100}$/.test(error?.code ?? "") ? error.code : "MANUAL_OPERATOR_UNAVAILABLE";
    process.stderr.write(`${JSON.stringify({ status: "manual_operator_failed", code })}\n`); process.exitCode = 1;
  } finally { clearTimeout(deadline); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
