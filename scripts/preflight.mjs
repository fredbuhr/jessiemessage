import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPreproductionConfiguration } from "../server/preflight/config.mjs";
import { inspectPlatform } from "../server/preflight/platform.mjs";
import { inspectDatabase } from "../server/preflight/database.mjs";
import { isOfficialOrigin } from "../server/site.mjs";
import { makePreflightReport, preflightFailure, preflightExitCode, PreflightReportError } from "../server/preflight/report.mjs";

export class PreflightCliError extends Error {
  constructor() { super("Invalid preflight command. Consult the preproduction procedure."); this.code = "PREFLIGHT_USAGE"; }
}
const usage = () => { throw new PreflightCliError(); };
const pathValue = (value) => typeof value === "string" && value.length <= 4096 && value.startsWith("/")
  && resolve(value) === value && !/[\x00-\x1f\x7f]/.test(value);
function originValue(value) {
  if (typeof value !== "string" || value.length > 512 || !isOfficialOrigin(value)) return false;
  const hostname = new URL(value).hostname;
  return hostname !== "jessiemessage.com" && hostname !== "www.jessiemessage.com";
}

export function parsePreflightArguments(args) {
  if (!Array.isArray(args) || args.some((value) => typeof value !== "string") || args[1] !== "--offline") usage();
  if (args[0] === "config" && args.length === 4 && args[2] === "--origin" && originValue(args[3])) {
    return { command: "config", expectedOrigin: args[3] };
  }
  if (args[0] === "platform" && (args.length === 2 || args.length === 4 && args[2] === "--scratch" && pathValue(args[3]))) {
    return { command: "platform", scratch: args[3] ?? null };
  }
  if (args[0] === "database" && args.length === 6 && args[2] === "--database" && args[4] === "--confirm-database"
    && /^[a-zA-Z0-9_]{1,64}$/.test(args[3]) && args[5] === args[3]) {
    return { command: "database", databaseName: args[3] };
  }
  usage();
}

export async function main(args = process.argv.slice(2), env = process.env, dependencies = {}) {
  let command = "unavailable";
  try {
    const options = parsePreflightArguments(args); command = options.command;
    const signal = dependencies.signal;
    if (signal?.aborted) return { report: preflightFailure(command, "PREFLIGHT_ABORTED"), exitCode: 1 };
    let result;
    if (command === "config") result = await (dependencies.inspectConfiguration ?? inspectPreproductionConfiguration)(env,
      { target: "auth-only", expectedOrigin: options.expectedOrigin });
    else if (command === "platform") result = await (dependencies.inspectPlatform ?? inspectPlatform)(
      { scratch: options.scratch, mediaRoot: env.JESSIEMESSAGE_MEDIA_ROOT ?? null }, { signal });
    else result = await (dependencies.inspectDatabase ?? inspectDatabase)({ env, databaseName: options.databaseName }, { signal });
    if (signal?.aborted) return { report: preflightFailure(command, "PREFLIGHT_ABORTED"), exitCode: 1 };
    const report = makePreflightReport(command, result);
    return { report, exitCode: preflightExitCode(report) };
  } catch (error) {
    const code = error instanceof PreflightCliError ? "PREFLIGHT_USAGE" : error instanceof PreflightReportError ? "PREFLIGHT_REPORT" : "PREFLIGHT_OPERATION";
    const report = preflightFailure(command, code);
    return { report, exitCode: preflightExitCode(report) };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Last resort for a stuck native call/driver close. A timeout never certifies
  // cleanup; only the caller's new synthetic probe directory may remain.
  const deadline = setTimeout(() => {
    process.stdout.write(`${JSON.stringify(preflightFailure("unavailable", "PREFLIGHT_TIMEOUT"))}\n`);
    process.exit(1);
  }, 60000);
  try {
    const { report, exitCode } = await main();
    process.stdout.write(`${JSON.stringify(report)}\n`); process.exitCode = exitCode;
  } finally { clearTimeout(deadline); }
}
