import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { parseRecurringArguments, recurringPreflight, createRecurringSupervisor, RecurringSupervisorError } from "../server/backup/recurring-supervisor.mjs";
import { createPeriodicBackupMonitor } from "../server/backup/periodic-monitor.mjs";
import { createBackupAlertWorker } from "../server/backup/alert-worker.mjs";
import { createWitnessOriginOperations } from "../server/backup/witness-origin-operator.mjs";

export async function main(args = process.argv.slice(2), { environment = process.env, execArgv = process.execArgv,
  preflight = recurringPreflight, makeSupervisor = createRecurringSupervisor, makeMonitor = createPeriodicBackupMonitor,
  makeAlerts = createBackupAlertWorker, makeWitnessOrigin = createWitnessOriginOperations, outputStream = process.stdout,
  signal } = {}) {
  const options = parseRecurringArguments(args);
  try { privateAuthenticationProcessOptions(environment, execArgv); } catch { throw new RecurringSupervisorError("ENVIRONMENT"); }
  if (signal?.aborted) throw new RecurringSupervisorError("ABORTED");
  if (options.command === "check") {
    const configuration = await preflight(options, { environment, signal });
    const report = { version: 1, type: "recurring_supervisor_preflight", status: "passed", enabled: configuration.enabled,
      hourUtc: configuration.hourUtc, minuteUtc: configuration.minuteUtc, started: false, backupStarted: false };
    outputStream.write(`${JSON.stringify(report)}\n`); return report;
  }
  const witnessOriginOperations = ["plan-witness", "check-witness", "prepare-witness"].includes(options.command)
    ? makeWitnessOrigin(options, { environment, signal }) : null;
  if (["plan-witness", "check-witness"].includes(options.command)) {
    const report = await witnessOriginOperations[options.command === "plan-witness" ? "plan" : "check"]();
    outputStream.write(`${JSON.stringify(report)}\n`); return report;
  }
  const supervisor = makeSupervisor(options, { environment, emit: report => outputStream.write(`${JSON.stringify(report)}\n`),
    ...(witnessOriginOperations === null ? {} : { witnessOriginOperations }) });
  let monitor, alerts;
  const monitorUnavailable = () => { try { outputStream.write('{"version":1,"type":"private_backup_monitor","event":"unavailable","code":"MONITOR_UNAVAILABLE","notificationStatus":"not_sent"}\n'); } catch {} };
  const alertsUnavailable = () => { try { outputStream.write('{"version":1,"type":"private_backup_alert","event":"unavailable","code":"ALERT_UNAVAILABLE","notificationStatus":"not_confirmed","inboxStatus":"not_checked"}\n'); } catch {} };
  const abort = () => {
    try { void Promise.resolve(monitor?.close()).catch(monitorUnavailable); } catch { monitorUnavailable(); }
    try { void Promise.resolve(alerts?.close()).catch(alertsUnavailable); } catch { alertsUnavailable(); }
    void supervisor.close();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await supervisor.start();
    if (signal?.aborted) await supervisor.close();
    else {
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
    const result = await supervisor.finished;
    if (result.failed) throw new RecurringSupervisorError("RUNTIME");
    return { version: 1, type: "recurring_supervisor", status: "stopped" };
  } finally {
    signal?.removeEventListener("abort", abort);
    try { await monitor?.close(); } catch { monitorUnavailable(); }
    // Stop the application without waiting for mail delivery/cleanup.
    await supervisor.close();
    try { await alerts?.close(); } catch { alertsUnavailable(); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController(); let deadline;
  const operationDeadline = ["plan-witness", "check-witness"].includes(process.argv[2])
    ? setTimeout(() => { process.stderr.write("WITNESS_ORIGIN_TIMEOUT\n"); process.exit(1); }, 45000) : null;
  const stop = () => {
    if (cancellation.signal.aborted) return;
    cancellation.abort();
    deadline = setTimeout(() => { process.stderr.write("RECURRING_SUPERVISOR_TIMEOUT\n"); process.exit(1); }, 40000);
  };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try { await main(process.argv.slice(2), { signal: cancellation.signal }); }
  catch (error) {
    const code = /^(?:RECURRING_(?:SUPERVISOR|FILES)|CHECKPOINT_ENCRYPTION|MANAGED_RUNTIME|WITNESS_(?:ORIGIN|GENESIS))_[A-Z_]{1,40}$/.test(error?.code ?? "") ? error.code : "RECURRING_SUPERVISOR_OPERATION";
    process.stderr.write(`${code}: La sauvegarde récurrente n’est pas confirmée.\n`); process.exitCode = 1;
  } finally { clearTimeout(operationDeadline); clearTimeout(deadline); process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); }
}
