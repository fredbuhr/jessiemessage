import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { probePrivateService, validateExternalProbeReport } from "../server/operations/external-probe.mjs";

const failure = (code) => ({ report: { version: 1, type: "private_service_check", status: "error", code }, exitCode: 2 });

/** Fixed destination; retries only failed passes, without credentials or mail. */
export async function main(args = process.argv.slice(2), { probe = probePrivateService, wait = delay } = {}) {
  if (!Array.isArray(args) || !(args.length === 0 || args.length === 1 && args[0] === "--once")) return failure("SERVICE_CHECK_USAGE");
  if (typeof probe !== "function" || typeof wait !== "function") return failure("SERVICE_CHECK_CONFIGURATION");
  const maximumAttempts = args.length === 0 ? 3 : 1;
  try {
    for (let attempts = 1; attempts <= maximumAttempts; attempts++) {
      const lastProbe = validateExternalProbeReport(await probe());
      if (lastProbe.status === "healthy" || attempts === maximumAttempts) {
        return { report: { version: 1, type: "private_service_check", status: lastProbe.status,
          attempts, confirmedFailure: lastProbe.status === "unavailable" && attempts === 3, lastProbe },
        exitCode: lastProbe.status === "healthy" ? 0 : 1 };
      }
      await wait(10000);
    }
  } catch { return failure("SERVICE_CHECK_OPERATION"); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Bounds the whole CLI, including a stuck transport or cancellation cleanup.
  const deadline = setTimeout(() => {
    process.stdout.write(`${JSON.stringify(failure("SERVICE_CHECK_TIMEOUT").report)}\n`);
    process.exit(2);
  }, 45000);
  try {
    const { report, exitCode } = await main();
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = exitCode;
  } finally { clearTimeout(deadline); }
}
