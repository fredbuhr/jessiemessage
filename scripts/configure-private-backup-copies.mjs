import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBackupCopyService } from "../server/backup/copy-service.mjs";

export async function main(args = process.argv.slice(2), internal = {}) {
  if (!Array.isArray(args) || args.length !== 3 || !["check", "initialize-pc"].includes(args[0]) || args[1] !== "--operations-directory"
    || typeof args[2] !== "string" || !args[2].startsWith("/") || args[2] === "/" || resolve(args[2]) !== args[2] || /[\\\x00-\x1f\x7f]/.test(args[2])) throw new Error("BACKUP_COPIES_USAGE");
  const service = (internal.makeService ?? createBackupCopyService)(args[2]);
  let summary = await service.summary(), initialized = false;
  if (args[0] === "initialize-pc" && summary.destinations.length === 0) {
    await service.create({ label: "Mon PC", kind: "computer" }); initialized = true; summary = await service.summary();
  }
  const result = { version: 1, type: "private_backup_copies", status: "configured", initialized, archiveCount: summary.archiveCount,
    latestArchive: summary.latestArchive, destinations: summary.destinations, independentCopyStatus: summary.destinations.some(item => item.lastReceipt !== null) ? "agent_reported" : "pending", decryptionStatus: "not_checked" };
  (internal.output ?? process.stdout).write(`${JSON.stringify(result)}\n`); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch { process.stderr.write("BACKUP_COPIES_UNAVAILABLE: Les réglages des copies ne sont pas confirmés.\n"); process.exitCode = 1; }
}
