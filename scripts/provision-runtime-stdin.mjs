import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeDatabaseOptions, createRuntimePool } from "../server/db/runtime.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { inspectDatabase } from "../server/preflight/database.mjs";
import { makePreflightReport, preflightExitCode } from "../server/preflight/report.mjs";
import { validateRuntimeDatabaseConfiguration, runtimeDatabaseEnvironment,
  writeRuntimeDatabaseConfiguration, readRuntimeDatabaseConfiguration } from "../server/config/runtime-database-file.mjs";
import { readPassword } from "./migration-input.mjs";

const CODES = new Set(["RUNTIME_INPUT_USAGE", "RUNTIME_INPUT_PASSWORD", "RUNTIME_INPUT_TRANSPORT",
  "RUNTIME_INPUT_DATABASE", "RUNTIME_INPUT_SCHEMA", "RUNTIME_INPUT_CONFIG", "RUNTIME_INPUT_OPERATION", "RUNTIME_INPUT_TIMEOUT"]);
const FIELDS = ["host", "port", "database", "confirmation", "user", "privateDirectory", "privilegeProfile", "privatePathMode"];
const CONFIG_FIELDS = ["format", "version", "host", "port", "database", "user", "password", "privilegeProfile"];

export class RuntimeProvisionError extends Error {
  constructor(code, report) {
    const selected = CODES.has(code) ? code : "RUNTIME_INPUT_OPERATION";
    super(selected); this.name = "RuntimeProvisionError"; this.code = selected;
    if (report) {
      this.databaseChecks = report.checks;
      this.privilegeObservation = report.privilegeObservation;
    }
  }
}
const fail = (code, report) => { throw new RuntimeProvisionError(code, report); };

export function parseArguments(args) {
  if (!Array.isArray(args) || args.length % 2 || args.length > 16) fail("RUNTIME_INPUT_USAGE");
  const selected = {};
  const names = new Map([["--host", "host"], ["--port", "port"], ["--database", "database"],
    ["--confirm-database", "confirmation"], ["--user", "user"], ["--private-directory", "privateDirectory"],
    ["--privilege-profile", "privilegeProfile"], ["--private-path-mode", "privatePathMode"]]);
  for (let index = 0; index < args.length; index += 2) {
    const key = names.get(args[index]), value = args[index + 1];
    if (!key || Object.hasOwn(selected, key) || typeof value !== "string" || !value || value.startsWith("--")) {
      fail("RUNTIME_INPUT_USAGE");
    }
    selected[key] = value;
  }
  selected.port ??= "3306";
  if (selected.confirmation !== selected.database || selected.privatePathMode !== "linux-dirfd"
    || typeof selected.privateDirectory !== "string" || selected.privateDirectory.length > 4096
    || !selected.privateDirectory.startsWith("/") || selected.privateDirectory === "/"
    || selected.privateDirectory.includes("\\") || resolve(selected.privateDirectory) !== selected.privateDirectory
    || /[\x00-\x1f\x7f]/.test(selected.privateDirectory)) {
    fail("RUNTIME_INPUT_USAGE");
  }
  try {
    // Use the same metadata contract as the persisted file before consuming any
    // password input. This fixed placeholder is never used for a connection.
    validateRuntimeDatabaseConfiguration({ format: "jessiemessage-runtime-database", version: 1,
      host: selected.host, port: selected.port, database: selected.database, user: selected.user,
      password: "metadata-validation-only", privilegeProfile: selected.privilegeProfile });
  } catch { fail("RUNTIME_INPUT_USAGE"); }
  return Object.fromEntries(FIELDS.map((name) => [name, selected[name]]));
}

function normalizeOptions(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.getOwnPropertySymbols(options).length
    || Object.getOwnPropertyNames(options).sort().join(",") !== [...FIELDS].sort().join(",")
    || FIELDS.some((name) => !Object.hasOwn(Object.getOwnPropertyDescriptor(options, name) ?? {}, "value"))) {
    fail("RUNTIME_INPUT_USAGE");
  }
  return parseArguments(["--host", options.host, "--port", options.port,
    "--database", options.database, "--confirm-database", options.confirmation, "--user", options.user,
    "--private-directory", options.privateDirectory, "--privilege-profile", options.privilegeProfile,
    "--private-path-mode", options.privatePathMode]);
}

async function verifyAuthSchema(env, createPool, createStore) {
  let pool, schemaVerified = false, releaseFailed = false;
  const releases = [];
  try {
    pool = await createPool(env);
    // The store deliberately suppresses release errors for committed writes.
    // This read-only provisioning step must instead observe and drain them.
    const guardedPool = { async getConnection() {
      const connection = await pool.getConnection();
      return {
        query: (...args) => connection.query(...args),
        release() {
          try {
            const released = Promise.resolve(connection.release());
            released.catch(() => {});
            releases.push(released);
            return released;
          } catch {
            releaseFailed = true;
            throw new RuntimeProvisionError("RUNTIME_INPUT_SCHEMA");
          }
        },
      };
    } };
    schemaVerified = await createStore(guardedPool).assertSchema() === true;
  } catch { schemaVerified = false; }
  finally {
    const released = await Promise.allSettled(releases);
    if (releaseFailed || released.some((result) => result.status !== "fulfilled")) schemaVerified = false;
    if (pool) {
      try { await pool.end(); } catch { schemaVerified = false; }
    }
  }
  if (!schemaVerified) fail("RUNTIME_INPUT_SCHEMA");
}

export async function run(options, password, {
  inspect = inspectDatabase, createPool = createRuntimePool, createStore = createAuthStore,
  writeConfiguration = writeRuntimeDatabaseConfiguration, readConfiguration = readRuntimeDatabaseConfiguration,
} = {}) {
  let config, env, loaded, readBack, report, transport;
  try {
    const selected = normalizeOptions(options);
    if (typeof password !== "string" || !password || !password.isWellFormed()
      || Buffer.byteLength(password, "utf8") > 4096 || /[\0\r\n]/.test(password)) fail("RUNTIME_INPUT_PASSWORD");
    try {
      config = validateRuntimeDatabaseConfiguration({ format: "jessiemessage-runtime-database", version: 1,
        host: selected.host, port: selected.port, database: selected.database, user: selected.user,
        password, privilegeProfile: selected.privilegeProfile });
      // No process.env merge: inherited local-TLS bypasses, migration accounts,
      // feature flags, CA paths and application secrets are not accepted.
      env = runtimeDatabaseEnvironment(config);
    } catch { fail("RUNTIME_INPUT_CONFIG"); }
    transport = runtimeDatabaseOptions(env);
    if (!transport.ssl || transport.ssl.rejectUnauthorized !== true || transport.ssl.minVersion !== "TLSv1.2"
      || Object.hasOwn(env, "JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL") || Object.hasOwn(env, "JESSIEMESSAGE_DB_TLS_CA_PATH")) {
      fail("RUNTIME_INPUT_TRANSPORT");
    }
    try { report = makePreflightReport("database", await inspect({ env, databaseName: selected.database })); }
    catch { fail("RUNTIME_INPUT_DATABASE"); }
    if (preflightExitCode(report) !== 0 || report.checks.some((check) => check.status !== "pass")
      || report.privilegeObservation.profile !== selected.privilegeProfile) fail("RUNTIME_INPUT_DATABASE", report);
    await verifyAuthSchema(env, createPool, createStore);
    // Only after both independent database probes have drained every release
    // and closed their pools may the file writer publish any credentials.
    try {
      const saved = await writeConfiguration(selected.privateDirectory, config);
      if (saved?.saved !== true) fail("RUNTIME_INPUT_CONFIG");
      readBack = await readConfiguration(selected.privateDirectory);
      loaded = validateRuntimeDatabaseConfiguration(readBack);
      if (CONFIG_FIELDS.some((name) => loaded[name] !== config[name])) fail("RUNTIME_INPUT_CONFIG");
    } catch { fail("RUNTIME_INPUT_CONFIG"); }
    return { status: "prepared", configSaved: true, databaseChecks: report.checks,
      authSchemaVerified: true, privilegeObservation: report.privilegeObservation };
  } catch (error) {
    if (error instanceof RuntimeProvisionError) throw error;
    fail("RUNTIME_INPUT_OPERATION");
  } finally {
    password = "";
    if (config) config.password = "";
    if (loaded) loaded.password = "";
    if (readBack && Object.getOwnPropertyDescriptor(readBack, "password")?.writable === true) readBack.password = "";
    if (env) env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD = "";
    if (transport) transport.password = "";
  }
}

export async function main(args = process.argv.slice(2), { inputStream = process.stdin, outputStream = process.stdout, ...dependencies } = {}) {
  let password = "";
  try {
    const options = parseArguments(args);
    try { password = await readPassword(inputStream); } catch { fail("RUNTIME_INPUT_PASSWORD"); }
    const result = await run(options, password, dependencies);
    outputStream.write(`${JSON.stringify(result)}\n`);
    return result;
  } catch (error) {
    if (error instanceof RuntimeProvisionError) throw error;
    fail("RUNTIME_INPUT_OPERATION");
  } finally { password = ""; }
}

function failureResult(error) {
  return { status: "blocked", configSaved: null, error: error instanceof RuntimeProvisionError ? error.code : "RUNTIME_INPUT_OPERATION",
    ...(error instanceof RuntimeProvisionError && error.databaseChecks ? {
      databaseChecks: error.databaseChecks, privilegeObservation: error.privilegeObservation,
    } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Last resort for a stuck input/native driver call. Normal operation awaits
  // real work and cleanup instead of racing a successful result against a timer.
  const deadline = setTimeout(() => {
    process.stdout.write(`${JSON.stringify(failureResult(new RuntimeProvisionError("RUNTIME_INPUT_TIMEOUT")))}\n`);
    process.exit(1);
  }, 60000);
  try { await main(); }
  catch (error) {
    const result = failureResult(error);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.stderr.write(`${result.error}: Runtime configuration was not confirmed.\n`);
    process.exitCode = 1;
  } finally { clearTimeout(deadline); }
}
