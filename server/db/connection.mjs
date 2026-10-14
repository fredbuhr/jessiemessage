import { readFile } from "node:fs/promises";
import { MigrationError } from "./migrations.mjs";

const configurationError = () => { throw new MigrationError("DATABASE_CONFIG", "Provide explicit JessieMessage database configuration and exact migration database confirmation."); };

export function databaseOptions(env = process.env) {
  const database = env.JESSIEMESSAGE_DB_NAME;
  const host = env.JESSIEMESSAGE_DB_HOST;
  const port = Number(env.JESSIEMESSAGE_DB_PORT ?? "3306");
  const user = env.JESSIEMESSAGE_DB_USER;
  const password = env.JESSIEMESSAGE_DB_PASSWORD;
  if (!database || !/^[a-zA-Z0-9_]{1,64}$/.test(database) || database !== env.JESSIEMESSAGE_MIGRATION_DATABASE
    || !host || !user || typeof password !== "string" || !password.length
    || !Number.isInteger(port) || port < 1 || port > 65535) configurationError();
  const insecure = env.JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL === "1";
  if (env.JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL && !insecure) configurationError();
  if (insecure && !["127.0.0.1", "::1", "localhost"].includes(host)) configurationError();
  return {
    host, port, user, password, database,
    ssl: insecure ? false : { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectTimeout: 10000,
    socketTimeout: 30000,
    multipleStatements: false,
    dateStrings: true,
    timezone: "Z",
    logParam: false,
    trace: false,
    logger: { warning: () => {} },
  };
}

export async function connectDatabase(env = process.env) {
  const options = databaseOptions(env);
  if (env.JESSIEMESSAGE_DB_TLS_CA_PATH && !options.ssl) configurationError();
  try {
    if (env.JESSIEMESSAGE_DB_TLS_CA_PATH) options.ssl.ca = await readFile(env.JESSIEMESSAGE_DB_TLS_CA_PATH, "utf8");
    const { default: mariadb } = await import("mariadb");
    return await mariadb.createConnection(options);
  } catch {
    // Driver errors may embed configuration, SQL or parameters. Never forward them to logs.
    throw new MigrationError("DATABASE_CONNECTION", "Unable to open the dedicated database connection; check private configuration and installed dependencies.");
  }
}
