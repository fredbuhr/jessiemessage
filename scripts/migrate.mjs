import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { connectDatabase, databaseOptions } from "../server/db/connection.mjs";
import { applyMigrations, loadMigrations, migrationStatus, MigrationError, resolveMigration } from "../server/db/migrations.mjs";

export function parseArguments(args) {
  const [command, ...flags] = args;
  if (!["up", "status", "resolve"].includes(command)) throw new MigrationError("USAGE", "Use: migrate.mjs up | status | resolve --version N --checksum SHA256 --outcome applied|retry --confirm-inspected");
  if (command !== "resolve") {
    if (flags.length) throw new MigrationError("USAGE", "The up/status commands take no arguments.");
    return { command };
  }
  const values = {};
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === "--confirm-inspected" && !values.reviewed) { values.reviewed = true; continue; }
    const key = { "--version": "version", "--checksum": "checksum", "--outcome": "outcome" }[flag];
    if (!key || values[key] !== undefined || !flags[index + 1] || flags[index + 1].startsWith("--")) {
      throw new MigrationError("USAGE", "Recovery arguments are missing, duplicated or unknown.");
    }
    values[key] = flags[++index];
  }
  if (!/^\d+$/.test(values.version ?? "") || !/^[0-9a-f]{64}$/.test(values.checksum ?? "")
    || !["applied", "retry"].includes(values.outcome) || values.reviewed !== true) {
    throw new MigrationError("USAGE", "Recovery requires --version N --checksum SHA256 --outcome applied|retry --confirm-inspected.");
  }
  return { command, ...values, version: Number(values.version) };
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const options = parseArguments(args);
  const { database } = databaseOptions(env);
  const migrations = await loadMigrations();
  const connection = await connectDatabase(env);
  try {
    const context = { database, migrations, ...options };
    const result = options.command === "up" ? await applyMigrations(connection, context)
      : options.command === "status" ? await migrationStatus(connection, context)
        : await resolveMigration(connection, context);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result;
  } finally {
    await connection.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const safe = error instanceof MigrationError ? `${error.code}: ${error.message}` : "DATABASE_OPERATION: Database operation failed; inspect private configuration and docs/DATABASE.md.";
    process.stderr.write(`${safe}\n`);
    process.exitCode = 1;
  });
}
