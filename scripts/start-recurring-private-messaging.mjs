import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { parseRecurringArguments, recurringPreflight, assertRuntimeSource, createRecurringSupervisor, RecurringSupervisorError } from "../server/backup/recurring-supervisor.mjs";
import { createPeriodicBackupMonitor } from "../server/backup/periodic-monitor.mjs";
import { createBackupAlertWorker } from "../server/backup/alert-worker.mjs";
import { createWitnessOriginOperations } from "../server/backup/witness-origin-operator.mjs";
import { createConfiguredWitnessObserver } from "../server/backup/witness-observer.mjs";
import { createConfiguredWitnessRecovery } from "../server/backup/witness-recovery-parent.mjs";
import { createWitnessRecoveryServer } from "../server/backup/witness-recovery-server.mjs";
import { createConfiguredLocalClosures } from "../server/backup/local-closure-parent.mjs";
import { resumeManagedLocalClosureRuntime } from "../server/backup/managed-closures.mjs";

export async function main(args = process.argv.slice(2), { environment = process.env, execArgv = process.execArgv,
  preflight = recurringPreflight, localPreflight = assertRuntimeSource, makeSupervisor = createRecurringSupervisor, makeMonitor = createPeriodicBackupMonitor,
  makeAlerts = createBackupAlertWorker, makeWitnessOrigin = createWitnessOriginOperations,
  makeWitnessObserver = createConfiguredWitnessObserver, makeWitnessRecovery = createConfiguredWitnessRecovery,
  makeRecoveryServer = createWitnessRecoveryServer, makeLocalClosures = createConfiguredLocalClosures, outputStream = process.stdout,
  signal } = {}) {
  const options = parseRecurringArguments(args);
  try { privateAuthenticationProcessOptions(environment, execArgv); } catch { throw new RecurringSupervisorError("ENVIRONMENT"); }
  if (signal?.aborted) throw new RecurringSupervisorError("ABORTED");
  if (["check-witness-recovery", "start-witness-recovery"].includes(options.command)) {
    const recovery = await makeWitnessRecovery(options, { environment, signal });
    let listener;
    const stop = () => {
      try { void Promise.resolve(recovery.close()).catch(() => {}); } catch {}
      try { void Promise.resolve(listener?.close()).catch(() => {}); } catch {}
    };
    signal?.addEventListener("abort", stop, { once: true });
    try {
      if (signal?.aborted) throw new RecurringSupervisorError("ABORTED");
      const checked = await recovery.check();
      if (signal?.aborted) throw new RecurringSupervisorError("ABORTED");
      if (options.command === "check-witness-recovery") { outputStream.write(`${JSON.stringify(checked)}\n`); return checked; }
      listener = makeRecoveryServer({ port: Number(environment.PORT ?? "3000"), control: recovery.handler });
      // Reserve the public port before the shared private socket. An active
      // application parent is never stopped or displaced by this command.
      await listener.start();
      if (signal?.aborted) throw new RecurringSupervisorError("ABORTED");
      const started = await recovery.start();
      if (signal?.aborted) throw new RecurringSupervisorError("ABORTED");
      listener.assertReady();
      outputStream.write(`${JSON.stringify(started)}\n`);
      const result = await listener.finished;
      if (result.failed) throw new RecurringSupervisorError("RUNTIME");
      return { version: 1, type: "witness_recovery_parent", status: "stopped", mode: "recovery_only", closuresEnabled: false };
    } finally {
      signal?.removeEventListener("abort", stop);
      try { await recovery.close(); } finally { await listener?.close(); }
    }
  }
  if (options.command === "check") {
    const configuration = await preflight(options, { environment, signal });
    const report = { version: 1, type: "recurring_supervisor_preflight", status: "passed", enabled: configuration.enabled,
      hourUtc: configuration.hourUtc, minuteUtc: configuration.minuteUtc, started: false, backupStarted: false };
    outputStream.write(`${JSON.stringify(report)}\n`); return report;
  }
  const localMode = ["check-local-closures", "start-local-closures"].includes(options.command);
  let local;
  if (localMode) {
    // Local closures and ordinary messaging do not depend on a backup clock,
    // recipient or free space. Those checks belong to an explicit request.
    await localPreflight(options, { signal });
    local = await makeLocalClosures(options, { environment, signal });
    if (options.command === "check-local-closures") {
      try { const report = await local.check(); outputStream.write(`${JSON.stringify(report)}\n`); return report; }
      finally { await local.close(); }
    }
  }
  const witnessOriginOperations = ["plan-witness", "check-witness", "prepare-witness"].includes(options.command)
    ? makeWitnessOrigin(options, { environment, signal }) : null;
  if (["plan-witness", "check-witness"].includes(options.command)) {
    const report = await witnessOriginOperations[options.command === "plan-witness" ? "plan" : "check"]();
    outputStream.write(`${JSON.stringify(report)}\n`); return report;
  }
  const emit = report => outputStream.write(`${JSON.stringify(report)}\n`);
  const observerMode = ["prepare-witness-enrollment", "check-witness-observer", "start-witness-observer"].includes(options.command);
  const observer = observerMode ? await makeWitnessObserver(options, { environment, signal, emit }) : null;
  if (options.command === "check-witness-observer") {
    try { const report = await observer.check(); emit(report); return report; }
    finally { await observer.close(); }
  }
  let supervisor;
  try {
    if (observer !== null) await observer[options.command === "prepare-witness-enrollment" ? "checkInitial" : "check"]();
    supervisor = makeSupervisor(observer === null && !localMode ? options : { ...options, command: "start" }, { environment, emit,
      ...(observer === null ? {} : { witnessControl: observer.handler }),
      ...(local === undefined ? {} : { closureOperations: local.operations, resumeClosures: resumeManagedLocalClosureRuntime, manualBackups: true }),
      ...(witnessOriginOperations === null ? {} : { witnessOriginOperations }) });
    if (observer !== null) observer.attachMaintenance(supervisor.withWitnessMaintenance, supervisor.failWitnessObservation);
  } catch (error) {
    try { await observer?.close(); } finally { try { await supervisor?.close(); } finally { await local?.close(); } }
    throw error;
  }
  let monitor, alerts;
  const monitorUnavailable = () => { try { outputStream.write('{"version":1,"type":"private_backup_monitor","event":"unavailable","code":"MONITOR_UNAVAILABLE","notificationStatus":"not_sent"}\n'); } catch {} };
  const alertsUnavailable = () => { try { outputStream.write('{"version":1,"type":"private_backup_alert","event":"unavailable","code":"ALERT_UNAVAILABLE","notificationStatus":"not_confirmed","inboxStatus":"not_checked"}\n'); } catch {} };
  const abort = () => {
    try { void Promise.resolve(observer?.close()).catch(() => {}); } catch {}
    try { void Promise.resolve(monitor?.close()).catch(monitorUnavailable); } catch { monitorUnavailable(); }
    try { void Promise.resolve(alerts?.close()).catch(alertsUnavailable); } catch { alertsUnavailable(); }
    try { void Promise.resolve(supervisor.close()).catch(() => {}); } catch {}
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await supervisor.start();
    if (signal?.aborted) await supervisor.close();
    else {
      if (observer !== null) {
        // Wait for the startup capture decision before the explicit enrollment
        // maintenance competes for the same capture lease.
        await supervisor.tick();
        if (signal?.aborted) {
          await supervisor.close();
          return { version: 1, type: "recurring_supervisor", status: "stopped" };
        }
        if (options.command === "prepare-witness-enrollment") emit(await observer.initialize());
        if (!signal?.aborted) {
          await observer.startRecoveryControl();
          if (!signal?.aborted) observer.startObservation();
        }
      }
      if (!localMode) {
        try { alerts = makeAlerts({ operationsDirectory: options.operationsDirectory, privateDirectory: options.privateDirectory },
          { emit: report => outputStream.write(`${JSON.stringify(report)}\n`) }); } catch { alertsUnavailable(); }
        try {
          monitor = makeMonitor({ operationsDirectory: options.operationsDirectory }, { emit: report => {
            // A broken console cannot prevent enqueueing a technical alert.
            try { outputStream.write(`${JSON.stringify(report)}\n`); } catch {}
            try { Promise.resolve(alerts?.observe(report)).catch(alertsUnavailable); } catch { alertsUnavailable(); }
          } });
          Promise.resolve(monitor.start()).catch(monitorUnavailable);
        } catch { monitorUnavailable(); }
      }
    }
    const result = await supervisor.finished;
    if (result.failed) throw new RecurringSupervisorError("RUNTIME");
    return { version: 1, type: "recurring_supervisor", status: "stopped" };
  } finally {
    signal?.removeEventListener("abort", abort);
    try { await observer?.close(); }
    finally {
      try { await monitor?.close(); } catch { monitorUnavailable(); }
      // Stop the application without waiting for mail delivery/cleanup.
      try { await supervisor.close(); }
      finally {
        try { await alerts?.close(); } catch { alertsUnavailable(); }
        await local?.close();
      }
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController(); let deadline;
  const recoveryCommand = ["check-witness-recovery", "start-witness-recovery"].includes(process.argv[2]);
  const operationDeadline = ["plan-witness", "check-witness", "check-witness-observer", "check-witness-recovery", "check-local-closures"].includes(process.argv[2])
    ? setTimeout(() => { process.stderr.write(recoveryCommand ? "WITNESS_RECOVERY_TIMEOUT\n" : "WITNESS_ORIGIN_TIMEOUT\n"); process.exit(1); }, 45000) : null;
  const stop = () => {
    if (cancellation.signal.aborted) return;
    cancellation.abort();
    deadline = setTimeout(() => { process.stderr.write("RECURRING_SUPERVISOR_TIMEOUT\n"); process.exit(1); }, 40000);
  };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try { await main(process.argv.slice(2), { signal: cancellation.signal }); }
  catch (error) {
    const code = /^(?:RECURRING_(?:SUPERVISOR|FILES)|CHECKPOINT_ENCRYPTION|MANAGED_RUNTIME|ERASURE|WITNESS_(?:ORIGIN|GENESIS|ENROLLMENT|OBSERVATION|RECOVERY))_[A-Z_]{1,40}$/.test(error?.code ?? "") ? error.code : "RECURRING_SUPERVISOR_OPERATION";
    process.stderr.write(`${code}: ${recoveryCommand ? "La récupération privée n’est pas confirmée." : "La sauvegarde récurrente n’est pas confirmée."}\n`); process.exitCode = 1;
  } finally { clearTimeout(operationDeadline); clearTimeout(deadline); process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); }
}
