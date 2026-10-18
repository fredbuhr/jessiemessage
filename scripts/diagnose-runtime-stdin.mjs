import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeDatabaseOptions, createRuntimePool } from "../server/db/runtime.mjs";
import { inspectDatabase } from "../server/preflight/database.mjs";
import { makePreflightReport } from "../server/preflight/report.mjs";
import { describeRuntimePrivileges, sanitizePrivilegeDiagnostics } from "../server/preflight/privilege-diagnostics.mjs";
import { validateRuntimeDatabaseConfiguration, runtimeDatabaseEnvironment,
  validateRuntimeDiagnosticConfiguration, writeRuntimeDiagnosticConfiguration,
  readRuntimeDiagnosticConfiguration } from "../server/config/runtime-database-file.mjs";
import { parseArguments as parseProvisionArguments } from "./provision-runtime-stdin.mjs";
import { readPassword } from "./migration-input.mjs";

const CODES = new Set(["USAGE", "PASSWORD", "TRANSPORT", "DATABASE", "PRIVILEGES", "CONFIG", "OPERATION", "TIMEOUT"]
  .map((name) => `RUNTIME_DIAGNOSTIC_${name}`));
const FIELDS = ["host", "port", "database", "confirmation", "user", "privateDirectory", "privilegeProfile", "privatePathMode"];
const CONFIG_FIELDS = ["format", "version", "host", "port", "database", "user", "password", "privilegeProfile"];

export class RuntimeDiagnosticError extends Error {
  constructor(code, report) {
    const selected = CODES.has(code) ? code : "RUNTIME_DIAGNOSTIC_OPERATION";
    super(selected); this.name = "RuntimeDiagnosticError"; this.code = selected;
    if (report) this.databaseChecks = report.checks;
  }
}
const fail = (code, report) => { throw new RuntimeDiagnosticError(code, report); };

export function parseArguments(args) {
  try { return parseProvisionArguments(args); }
  catch { fail("RUNTIME_DIAGNOSTIC_USAGE"); }
}

function normalizeOptions(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.getOwnPropertySymbols(options).length
    || Object.getOwnPropertyNames(options).sort().join(",") !== [...FIELDS].sort().join(",")
    || FIELDS.some((name) => !Object.hasOwn(Object.getOwnPropertyDescriptor(options, name) ?? {}, "value"))) {
    fail("RUNTIME_DIAGNOSTIC_USAGE");
  }
  return parseArguments(["--host", options.host, "--port", options.port,
    "--database", options.database, "--confirm-database", options.confirmation, "--user", options.user,
    "--private-directory", options.privateDirectory, "--privilege-profile", options.privilegeProfile,
    "--private-path-mode", options.privatePathMode]);
}

async function observePrivileges(env, database, createPool, describe) {
  let pool, connection, rows, observation, failed = false;
  try {
    pool = await createPool(env);
    connection = await pool.getConnection();
    rows = await connection.query("SHOW GRANTS FOR CURRENT_USER");
    // The component result is reconstructed even when a test dependency or
    // future implementation returns extra fields. No raw grant may escape.
    observation = sanitizePrivilegeDiagnostics(await describe(rows, database));
    if (observation.available !== true) failed = true;
  } catch { failed = true; }
  finally {
    rows = null;
    if (connection) { try { await connection.release(); } catch { failed = true; } }
    if (pool) { try { await pool.end(); } catch { failed = true; } }
  }
  if (failed) fail("RUNTIME_DIAGNOSTIC_PRIVILEGES");
  return observation;
}

function clearCredentials(record) {
  if (!record || typeof record !== "object") return;
  const nested = Object.getOwnPropertyDescriptor(record, "credentials")?.value;
  for (const value of [record, nested]) {
    const descriptor = value && Object.getOwnPropertyDescriptor(value, "password");
    if (descriptor && Object.hasOwn(descriptor, "value") && descriptor.writable) value.password = "";
  }
}

export async function run(options, password, {
  inspect = inspectDatabase, createPool = createRuntimePool, describe = describeRuntimePrivileges,
  writeConfiguration = writeRuntimeDiagnosticConfiguration, readConfiguration = readRuntimeDiagnosticConfiguration,
  now = () => new Date().toISOString(),
} = {}) {
  let config, env, transport, record, loaded, readBack, report;
  try {
    const selected = normalizeOptions(options);
    if (typeof password !== "string" || !password || !password.isWellFormed()
      || Buffer.byteLength(password, "utf8") > 4096 || /[\0\r\n]/.test(password)) fail("RUNTIME_DIAGNOSTIC_PASSWORD");
    try {
      config = validateRuntimeDatabaseConfiguration({ format: "jessiemessage-runtime-database", version: 1,
        host: selected.host, port: selected.port, database: selected.database, user: selected.user,
        password, privilegeProfile: selected.privilegeProfile });
      // Build the same minimal TLS environment as normal provisioning. Never
      // import inherited credentials, insecure overrides or activation flags.
      env = runtimeDatabaseEnvironment(config);
      transport = runtimeDatabaseOptions(env);
    } catch { fail("RUNTIME_DIAGNOSTIC_CONFIG"); }
    if (!transport.ssl || transport.ssl.rejectUnauthorized !== true || transport.ssl.minVersion !== "TLSv1.2"
      || Object.hasOwn(env, "JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL") || Object.hasOwn(env, "JESSIEMESSAGE_DB_TLS_CA_PATH")) {
      fail("RUNTIME_DIAGNOSTIC_TRANSPORT");
    }
    try { report = makePreflightReport("database", await inspect({ env, databaseName: selected.database })); }
    catch { fail("RUNTIME_DIAGNOSTIC_DATABASE"); }
    if (report.privilegeObservation.profile !== selected.privilegeProfile
      || report.checks.some((check) => check.name === "privileges"
        ? !["pass", "fail"].includes(check.status) : check.status !== "pass")) {
      fail("RUNTIME_DIAGNOSTIC_DATABASE", report);
    }
    const privilegeDiagnostics = await observePrivileges(env, selected.database, createPool, describe);
    // This separate envelope is deliberately incompatible with the normal
    // runtime configuration. Observing privileges cannot approve a launch.
    try {
      record = validateRuntimeDiagnosticConfiguration({ format: "jessiemessage-runtime-diagnostic", version: 1,
        createdAt: now(), credentials: config });
      const saved = await writeConfiguration(selected.privateDirectory, record);
      if (saved?.saved !== true) fail("RUNTIME_DIAGNOSTIC_CONFIG");
      readBack = await readConfiguration(selected.privateDirectory);
      loaded = validateRuntimeDiagnosticConfiguration(readBack);
      if (["format", "version", "createdAt"].some((name) => loaded[name] !== record[name])
        || CONFIG_FIELDS.some((name) => loaded.credentials[name] !== config[name])) fail("RUNTIME_DIAGNOSTIC_CONFIG");
    } catch { fail("RUNTIME_DIAGNOSTIC_CONFIG"); }
    return { status: "diagnostic_only", diagnosticSaved: true, configSaved: false, launchApproved: false,
      databaseChecks: report.checks, privilegeDiagnostics };
  } catch (error) {
    if (error instanceof RuntimeDiagnosticError) throw error;
    fail("RUNTIME_DIAGNOSTIC_OPERATION");
  } finally {
    password = "";
    for (const value of [config, record, loaded, readBack]) clearCredentials(value);
    if (env) env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD = "";
    if (transport) transport.password = "";
  }
}

export async function main(args = process.argv.slice(2), { inputStream = process.stdin, outputStream = process.stdout, ...dependencies } = {}) {
  let password = "";
  try {
    const options = parseArguments(args);
    try { password = await readPassword(inputStream); } catch { fail("RUNTIME_DIAGNOSTIC_PASSWORD"); }
    const result = await run(options, password, dependencies);
    outputStream.write(`${JSON.stringify(result)}\n`);
    return result;
  } catch (error) {
    if (error instanceof RuntimeDiagnosticError) throw error;
    fail("RUNTIME_DIAGNOSTIC_OPERATION");
  } finally { password = ""; }
}

function failureResult(error) {
  return { status: "blocked", diagnosticSaved: null, configSaved: false, launchApproved: false,
    error: error instanceof RuntimeDiagnosticError ? error.code : "RUNTIME_DIAGNOSTIC_OPERATION",
    ...(error instanceof RuntimeDiagnosticError && error.databaseChecks ? { databaseChecks: error.databaseChecks } : {}) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const deadline = setTimeout(() => {
    process.stdout.write(`${JSON.stringify(failureResult(new RuntimeDiagnosticError("RUNTIME_DIAGNOSTIC_TIMEOUT")))}\n`);
    process.exit(1);
  }, 60000);
  try { await main(); }
  catch (error) {
    const result = failureResult(error);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.stderr.write(`${result.error}: Runtime diagnostic was not confirmed.\n`);
    process.exitCode = 1;
  } finally { clearTimeout(deadline); }
}
