import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { parseRecurringArguments, recurringPreflight, createRecurringSupervisor, RecurringSupervisorError } from "../server/backup/recurring-supervisor.mjs";
import { createPeriodicBackupMonitor } from "../server/backup/periodic-monitor.mjs";

export async function main(args = process.argv.slice(2), { environment = process.env, execArgv = process.execArgv,
  preflight = recurringPreflight, makeSupervisor = createRecurringSupervisor, makeMonitor = createPeriodicBackupMonitor, outputStream = process.stdout,
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
  const supervisor = makeSupervisor(options, { environment, emit: report => outputStream.write(`${JSON.stringify(report)}\n`) });
  let monitor;
  const monitorUnavailable = () => { try { outputStream.write('{"version":1,"type":"private_backup_monitor","event":"unavailable","code":"MONITOR_UNAVAILABLE","notificationStatus":"not_sent"}\n'); } catch {} };
  const abort = () => { try { void Promise.resolve(monitor?.close()).catch(monitorUnavailable); } catch { monitorUnavailable(); } void supervisor.close(); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await supervisor.start();
    if (signal?.aborted) await supervisor.close();
    else {
      try {
        monitor = makeMonitor({ operationsDirectory: options.operationsDirectory }, { emit: report => outputStream.write(`${JSON.stringify(report)}\n`) });
        Promise.resolve(monitor.start()).catch(monitorUnavailable);
      } catch { monitorUnavailable(); }
    }
    const result = await supervisor.finished;
    if (result.failed) throw new RecurringSupervisorError("RUNTIME");
    return { version: 1, type: "recurring_supervisor", status: "stopped" };
  } finally {
    signal?.removeEventListener("abort", abort);
    try { await monitor?.close(); } catch { monitorUnavailable(); }
    await supervisor.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController(); let deadline;
  const stop = () => {
    if (cancellation.signal.aborted) return;
    cancellation.abort();
    deadline = setTimeout(() => { process.stderr.write("RECURRING_SUPERVISOR_TIMEOUT\n"); process.exit(1); }, 40000);
  };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try { await main(process.argv.slice(2), { signal: cancellation.signal }); }
  catch (error) {
    const code = /^(?:RECURRING_(?:SUPERVISOR|FILES)|CHECKPOINT_ENCRYPTION)_[A-Z_]{1,40}$/.test(error?.code ?? "") ? error.code : "RECURRING_SUPERVISOR_OPERATION";
    process.stderr.write(`${code}: La sauvegarde récurrente n’est pas confirmée.\n`); process.exitCode = 1;
  } finally { clearTimeout(deadline); process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); }
}
