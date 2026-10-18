import { readRecurringConfiguration, readCheckpointHistory } from "./recurring-checkpoint-files.mjs";
import { evaluateCheckpointFreshness, BackupFreshnessError } from "./freshness.mjs";

const failure = code => ({ report: { version: 1, type: "private_backup_freshness", status: "error", code }, exitCode: 2 });

/** Shared, bounded private reader for the CLI and periodic supervisor observer. */
export async function inspectPrivateBackupFreshness(directory, { readConfiguration = readRecurringConfiguration,
  readHistory = readCheckpointHistory, clock = Date.now, signal } = {}) {
  try {
    if (signal?.aborted) return failure("BACKUP_CHECK_UNAVAILABLE");
    const configuration = await readConfiguration(directory, { signal });
    const history = await readHistory(directory, { signal });
    const confirmed = await readConfiguration(directory, { signal });
    const now = clock();
    const report = evaluateCheckpointFreshness({ configuration, history, now });
    const current = evaluateCheckpointFreshness({ configuration: confirmed, history, now });
    if (["version", "enabled", "recipientSha256", "hourUtc", "minuteUtc"].some(name => configuration[name] !== confirmed[name])) return failure("BACKUP_CHECK_CHANGED");
    if (signal?.aborted) return failure("BACKUP_CHECK_UNAVAILABLE");
    return { report: current, exitCode: report.status === "current" ? 0 : 1 };
  } catch (error) { return failure(error instanceof BackupFreshnessError ? "BACKUP_CHECK_INPUT" : "BACKUP_CHECK_UNAVAILABLE"); }
}
