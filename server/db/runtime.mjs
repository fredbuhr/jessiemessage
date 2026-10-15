import { readFile } from "node:fs/promises";
import { AuthStoreError } from "../auth/store.mjs";

const failConfig = () => { throw new AuthStoreError("AUTH_DATABASE_CONFIG", "Provide explicit runtime database credentials and exact application database confirmation."); };

export function runtimeDatabaseOptions(env = process.env) {
  const database = env.JESSIEMESSAGE_DB_NAME;
  const host = env.JESSIEMESSAGE_DB_HOST;
  const port = Number(env.JESSIEMESSAGE_DB_PORT ?? "3306");
  const user = env.JESSIEMESSAGE_RUNTIME_DB_USER;
  const password = env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD;
  if (!database || !/^[a-zA-Z0-9_]{1,64}$/.test(database) || database !== env.JESSIEMESSAGE_APPLICATION_DATABASE
    || !host || !user || typeof password !== "string" || !password.length
    || !Number.isInteger(port) || port < 1 || port > 65535) failConfig();
  if (env.JESSIEMESSAGE_DB_USER && user === env.JESSIEMESSAGE_DB_USER) failConfig();
  const insecure = env.JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL === "1";
  if (env.JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL && !insecure) failConfig();
  if (insecure && !["127.0.0.1", "::1", "localhost"].includes(host)) failConfig();
  if (env.JESSIEMESSAGE_DB_TLS_CA_PATH && insecure) failConfig();
  return {
    host, port, user, password, database,
    ssl: insecure ? false : { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionLimit: 4,
    minimumIdle: 0,
    acquireTimeout: 5000,
    connectTimeout: 5000,
    socketTimeout: 30000,
    idleTimeout: 60,
    multipleStatements: false,
    dateStrings: true,
    timezone: "Z",
    logParam: false,
    trace: false,
    logger: { warning: () => {} },
  };
}

export async function createRuntimePool(env = process.env, { createPool } = {}) {
  const options = runtimeDatabaseOptions(env);
  let pool;
  try {
    if (env.JESSIEMESSAGE_DB_TLS_CA_PATH) options.ssl.ca = await readFile(env.JESSIEMESSAGE_DB_TLS_CA_PATH, "utf8");
    // The optional driver factory is a test seam; production uses the installed
    // MariaDB driver with these same validated options.
    const factory = createPool ?? (await import("mariadb")).default.createPool;
    pool = factory(options);
  } catch {
    throw new AuthStoreError("AUTH_DATABASE_CONNECTION", "Unable to initialize the runtime database connection.");
  }
  let outstanding = 0;
  let closed = false;
  let ending;
  let releaseFailed = false;
  const pendingReleases = new Set();
  const connectionFailure = () => new AuthStoreError("AUTH_DATABASE_CONNECTION", "Unable to release the runtime database connection cleanly.");
  function releaseConnection(connection) {
    // MariaDB's Promise API performs asynchronous reset/rollback on release.
    // Legacy stores may ignore the returned Promise after a committed write;
    // observe its rejection here while retaining it for callers that await it.
    const released = Promise.resolve().then(() => connection.release()).catch(() => {
      releaseFailed = true;
      throw connectionFailure();
    });
    pendingReleases.add(released);
    released.then(() => pendingReleases.delete(released), () => pendingReleases.delete(released));
    return released;
  }
  async function drainReleases() {
    while (pendingReleases.size) await Promise.allSettled([...pendingReleases]);
  }
  return {
    async getConnection() {
      if (closed || outstanding >= 8) throw new AuthStoreError("AUTH_DATABASE_BUSY", "The runtime database is unavailable or busy.");
      outstanding += 1;
      let connection;
      try {
        connection = await pool.getConnection();
        await connection.query("SET time_zone = '+00:00'");
      } catch {
        if (connection) { try { await releaseConnection(connection); } catch {} }
        outstanding -= 1;
        throw new AuthStoreError("AUTH_DATABASE_CONNECTION", "Unable to acquire the runtime database connection.");
      }
      let released;
      return {
        query: (...args) => connection.query(...args),
        beginTransaction: () => connection.beginTransaction(),
        commit: () => connection.commit(),
        rollback: () => connection.rollback(),
        release() {
          if (released) return released;
          outstanding -= 1;
          released = releaseConnection(connection);
          return released;
        },
      };
    },
    end() {
      if (ending) return ending;
      closed = true;
      ending = (async () => {
        await drainReleases();
        let failed = releaseFailed;
        try { await pool.end(); } catch { failed = true; }
        await drainReleases();
        if (failed || releaseFailed) throw new AuthStoreError("AUTH_DATABASE_CONNECTION", "Unable to close the runtime database connection cleanly.");
      })();
      // Retain rejection for explicit cleanup callers without an unhandled
      // rejection if a legacy shutdown path does not await its result.
      ending.catch(() => {});
      return ending;
    },
  };
}
