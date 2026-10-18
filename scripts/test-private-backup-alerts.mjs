import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { createPrivateBackupAlertDelivery, sendBoundedBackupAlert } from "../server/backup/alert-delivery.mjs";
import { BackupAlertError, failAlert, alertInstant, validateBackupAlert } from "../server/backup/alert-state.mjs";

const REPOSITORY = resolve(fileURLToPath(new URL("../", import.meta.url)));
export async function main(args = process.argv.slice(2), { environment = process.env, execArgv = process.execArgv,
  makeDelivery = createPrivateBackupAlertDelivery, send = sendBoundedBackupAlert, clock = Date.now,
  makeId = () => randomBytes(16).toString("hex"), outputStream = process.stdout, signal } = {}) {
  privateAuthenticationProcessOptions(environment, execArgv);
  if (!Array.isArray(args) || args.length !== 5 || !["check", "send-test"].includes(args[0])
    || args[1] !== "--private-directory" || args[3] !== "--private-path-mode" || args[4] !== "linux-dirfd") failAlert("ALERT_INPUT");
  const directory = args[2];
  if (typeof directory !== "string" || !directory.startsWith("/") || directory === "/" || resolve(directory) !== directory
    || directory.length > 4096 || /[\\\x00-\x1f\x7f]/.test(directory)) failAlert("ALERT_INPUT");
  const part = relative(REPOSITORY, directory);
  if (!part || part !== ".." && !part.startsWith(`..${sep}`) && !part.startsWith(sep)) failAlert("ALERT_INPUT");
  if (signal?.aborted) failAlert("ALERT_UNAVAILABLE");
  if (args[0] === "check") {
    const delivery = await makeDelivery(directory);
    await delivery.close();
    const report = { version: 1, type: "private_backup_alert_test", status: "configuration_valid", sent: false, inboxStatus: "not_checked" };
    outputStream.write(`${JSON.stringify(report)}\n`); return report;
  }
  const incidentId = makeId(), now = clock();
  if (!alertInstant(now)) failAlert("ALERT_INPUT");
  for (const event of ["incident", "recovered"]) {
    const alert = validateBackupAlert({ version: 1, id: event === "incident" ? incidentId : makeId(), incidentId, event,
      code: event === "incident" ? "BACKUP_STALE" : "OK", observedAt: now, lastSuccessAt: now, synthetic: true });
    if (signal?.aborted) failAlert("ALERT_UNAVAILABLE");
    if (await send(() => makeDelivery(directory), alert, { signal }) !== true) failAlert("ALERT_SMTP_FAILED");
    outputStream.write(`${JSON.stringify({ version: 1, type: "private_backup_alert_test", event, alertId: alert.id,
      incidentId, synthetic: true, notificationStatus: "smtp_accepted", inboxStatus: "not_checked" })}\n`);
  }
  return { sent: 2, synthetic: true, inboxStatus: "not_checked" };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController();
  const stop = () => cancellation.abort();
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  try { await main(process.argv.slice(2), { signal: cancellation.signal }); }
  catch (error) {
    const code = error instanceof BackupAlertError ? error.code : "ALERT_UNAVAILABLE";
    process.stderr.write(`${code}: Le test des alertes n’est pas confirmé.\n`); process.exitCode = 1;
  } finally { process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); }
}
