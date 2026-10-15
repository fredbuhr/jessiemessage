import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectDatabase, databaseOptions } from "../server/db/connection.mjs";
import { applyMigrations, loadMigrations, migrationStatus, MigrationError } from "../server/db/migrations.mjs";
import { MigrationInputError, parseArguments, readPassword } from "./migration-input.mjs";

const fail = (code) => { throw new MigrationInputError(code); };

export async function run(options, password, {
  connect = connectDatabase, loadPlan = loadMigrations, status = migrationStatus, apply = applyMigrations,
} = {}) {
  const selected = parseArguments([options?.command, "--host", options?.host, "--port", options?.port ?? "3306",
    "--database", options?.database, "--confirm-database", options?.confirmation, "--user", options?.user]);
  if (typeof password !== "string" || !password || !password.isWellFormed()
    || Buffer.byteLength(password, "utf8") > 4096 || /[\0\r\n]/.test(password)) fail("MIGRATION_INPUT_PASSWORD");
  const env = {
    JESSIEMESSAGE_DB_HOST: selected.host, JESSIEMESSAGE_DB_PORT: selected.port,
    JESSIEMESSAGE_DB_NAME: selected.database, JESSIEMESSAGE_MIGRATION_DATABASE: selected.confirmation,
    JESSIEMESSAGE_DB_USER: selected.user, JESSIEMESSAGE_DB_PASSWORD: password,
  };
  const transport = databaseOptions(env);
  if (!transport.ssl || transport.ssl.rejectUnauthorized !== true || transport.ssl.minVersion !== "TLSv1.2") {
    fail("MIGRATION_INPUT_TRANSPORT");
  }
  let connection;
  try {
    const migrations = await loadPlan();
    if (!Array.isArray(migrations) || !migrations.length || migrations.length > 1000) fail("MIGRATION_INPUT_HISTORY");
    connection = await connect(env);
    const cipher = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
    if (!Array.isArray(cipher) || cipher.length !== 1 || cipher[0]?.Variable_name !== "Ssl_cipher"
      || typeof cipher[0]?.Value !== "string" || !cipher[0].Value || cipher[0].Value.length > 256) {
      fail("MIGRATION_INPUT_TRANSPORT");
    }
    const context = { database: selected.database, migrations };
    // The existing status operation checks the selected MariaDB engine/version,
    // acquires GET_LOCK and refuses an unrelated nonempty schema before return.
    const before = await status(connection, context);
    const valid = (rows) => Array.isArray(rows) && rows.length === migrations.length
      && rows.every((row, index) => row?.version === migrations[index].version
        && row?.checksum === migrations[index].checksum && row?.name === migrations[index].name
        && ["pending", "applied", "running", "failed", "retry"].includes(row.state));
    if (!valid(before)) fail("MIGRATION_INPUT_HISTORY");
    if (selected.command === "status") {
      return { status: "checked", engineVerified: true, transportVerified: true, migrations: migrations.length,
        applied: before.filter((row) => row.state === "applied").length,
        pending: before.filter((row) => row.state === "pending").length,
        interrupted: before.some((row) => !["pending", "applied"].includes(row.state)) };
    }
    const empty = before.every((row) => row.state === "pending");
    const alreadyApplied = before.every((row) => row.state === "applied");
    if (!empty && !alreadyApplied) fail("MIGRATION_INPUT_NOT_FRESH");
    let applied = 0;
    if (empty) {
      const result = await apply(connection, context);
      if (!Array.isArray(result?.applied) || result.applied.length > migrations.length) fail("MIGRATION_INPUT_HISTORY");
      applied = result.applied.length;
    }
    const after = await status(connection, context);
    if (!valid(after) || !after.every((row) => row.state === "applied")) fail("MIGRATION_INPUT_HISTORY");
    return { status: "prepared", engineVerified: true, transportVerified: true, migrations: migrations.length,
      applied, unchanged: migrations.length - applied };
  } finally {
    try { if (connection) await connection.end(); }
    finally { env.JESSIEMESSAGE_DB_PASSWORD = ""; }
  }
}

export async function main(args = process.argv.slice(2), { inputStream = process.stdin, ...dependencies } = {}) {
  const options = parseArguments(args);
  const password = await readPassword(inputStream);
  const result = await run(options, password, dependencies);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = error instanceof MigrationInputError || error instanceof MigrationError ? error.code : "MIGRATION_INPUT_OPERATION";
    process.stderr.write(`${code}: Migration not confirmed; inspect operator configuration and migration status.\n`);
    process.exitCode = 1;
  });
}
