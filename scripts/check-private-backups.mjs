import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPrivateBackupFreshness } from "../server/backup/freshness-reader.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const failure = code => ({ report: { version: 1, type: "private_backup_freshness", status: "error", code }, exitCode: 2 });
function directory(value) {
  if (typeof value !== "string" || value === "/" || !value.startsWith("/") || resolve(value) !== value
    || value.length > 4096 || /[\\\x00-\x1f\x7f]/.test(value)) return false;
  const part = relative(repository, value);
  return part === ".." || part.startsWith(`..${sep}`) || part.startsWith(sep);
}

/** Read-only CLI: no capture, lock, stop, transfer, database or network action. */
export async function main(args = process.argv.slice(2), dependencies = {}) {
  if (!Array.isArray(args) || args.length !== 4 || args.some(item => typeof item !== "string")
    || args[0] !== "--operations-directory" || !directory(args[1])
    || args[2] !== "--private-path-mode" || args[3] !== "linux-dirfd") return failure("BACKUP_CHECK_USAGE");
  return inspectPrivateBackupFreshness(args[1], dependencies);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const deadline = setTimeout(() => {
    process.stdout.write(`${JSON.stringify(failure("BACKUP_CHECK_TIMEOUT").report)}\n`);
    process.exit(2);
  }, 15000);
  try {
    const { report, exitCode } = await main();
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = exitCode;
  } finally { clearTimeout(deadline); }
}
