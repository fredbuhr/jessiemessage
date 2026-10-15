import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRuntimeDatabaseConfiguration, validateRuntimeDiagnosticConfiguration,
  readRuntimeDiagnosticConfiguration } from "../server/config/runtime-database-file.mjs";
import { makePreflightReport, preflightExitCode } from "../server/preflight/report.mjs";
import { parseArguments as parseProvisionArguments, run as provisionRuntime } from "./provision-runtime-stdin.mjs";

const PROFILE = "infomaniak-shared-pattern";
const FIELDS = ["privateDirectory", "privilegeProfile", "privatePathMode"];
const CODES = new Set(["USAGE", "DIAGNOSTIC", "PROVISION", "OPERATION", "TIMEOUT"].map((name) => `RUNTIME_PROMOTION_${name}`));

export class RuntimePromotionError extends Error {
  constructor(code) {
    const selected = CODES.has(code) ? code : "RUNTIME_PROMOTION_OPERATION";
    super(selected); this.name = "RuntimePromotionError"; this.code = selected;
  }
}
const fail = (code) => { throw new RuntimePromotionError(code); };

export function parseArguments(args) {
  if (!Array.isArray(args) || args.length !== 6) fail("RUNTIME_PROMOTION_USAGE");
  const names = new Map([["--private-directory", "privateDirectory"], ["--privilege-profile", "privilegeProfile"],
    ["--private-path-mode", "privatePathMode"]]);
  const selected = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = names.get(args[index]), value = args[index + 1];
    if (!name || Object.hasOwn(selected, name) || typeof value !== "string" || !value || value.startsWith("--")) {
      fail("RUNTIME_PROMOTION_USAGE");
    }
    selected[name] = value;
  }
  if (selected.privilegeProfile !== PROFILE || selected.privatePathMode !== "linux-dirfd"
    || selected.privateDirectory.length > 4096 || !selected.privateDirectory.startsWith("/")
    || selected.privateDirectory === "/" || selected.privateDirectory.includes("\\")
    || resolve(selected.privateDirectory) !== selected.privateDirectory || /[\x00-\x1f\x7f]/.test(selected.privateDirectory)) {
    fail("RUNTIME_PROMOTION_USAGE");
  }
  return Object.fromEntries(FIELDS.map((name) => [name, selected[name]]));
}

function normalizeOptions(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.getOwnPropertySymbols(options).length
    || Object.getOwnPropertyNames(options).sort().join(",") !== [...FIELDS].sort().join(",")
    || FIELDS.some((name) => !Object.hasOwn(Object.getOwnPropertyDescriptor(options, name) ?? {}, "value"))) {
    fail("RUNTIME_PROMOTION_USAGE");
  }
  return parseArguments(["--private-directory", options.privateDirectory, "--privilege-profile", options.privilegeProfile,
    "--private-path-mode", options.privatePathMode]);
}

function data(value, key) {
  if (!value || typeof value !== "object") fail("RUNTIME_PROMOTION_PROVISION");
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("RUNTIME_PROMOTION_PROVISION");
  return descriptor.value;
}

function confirmedResult(value) {
  if (data(value, "status") !== "prepared" || data(value, "configSaved") !== true || data(value, "authSchemaVerified") !== true) {
    fail("RUNTIME_PROMOTION_PROVISION");
  }
  let report;
  try {
    report = makePreflightReport("database", { valid: true, checks: data(value, "databaseChecks"),
      privilegeObservation: data(value, "privilegeObservation") });
  } catch { fail("RUNTIME_PROMOTION_PROVISION"); }
  if (preflightExitCode(report) !== 0 || report.checks.some((check) => check.status !== "pass")
    || report.privilegeObservation.profile !== PROFILE) fail("RUNTIME_PROMOTION_PROVISION");
  // Rebuild the public result. Native driver/configuration errors, metadata,
  // extra fields and any claimed activation can never reach stdout.
  return { status: "prepared", configSaved: true, launchApproved: false, databaseChecks: report.checks,
    authSchemaVerified: true, privilegeObservation: report.privilegeObservation };
}

function clearCredentials(value) {
  if (!value || typeof value !== "object") return;
  const nested = Object.getOwnPropertyDescriptor(value, "credentials")?.value;
  for (const record of [value, nested]) {
    if (!record || typeof record !== "object") continue;
    const descriptor = Object.getOwnPropertyDescriptor(record, "password");
    if (descriptor && Object.hasOwn(descriptor, "value") && descriptor.writable) record.password = "";
  }
}

export async function run(options, {
  readDiagnostic = readRuntimeDiagnosticConfiguration, provision = provisionRuntime,
} = {}) {
  let source, diagnostic, credentials;
  try {
    // Complete this check before touching any private file. The profile must
    // be chosen explicitly; no fallback is selected from a saved record.
    const selected = normalizeOptions(options);
    try {
      source = await readDiagnostic(selected.privateDirectory);
      diagnostic = validateRuntimeDiagnosticConfiguration(source);
      credentials = validateRuntimeDatabaseConfiguration({ ...diagnostic.credentials, privilegeProfile: selected.privilegeProfile });
    } catch { fail("RUNTIME_PROMOTION_DIAGNOSTIC"); }
    let provisionOptions;
    try {
      provisionOptions = parseProvisionArguments(["--host", credentials.host, "--port", credentials.port,
        "--database", credentials.database, "--confirm-database", credentials.database, "--user", credentials.user,
        "--private-directory", selected.privateDirectory, "--privilege-profile", selected.privilegeProfile,
        "--private-path-mode", selected.privatePathMode]);
    } catch { fail("RUNTIME_PROMOTION_PROVISION"); }
    try {
      // The ordinary provisioning path still performs all nine preflight
      // checks, physical auth-schema validation, cleanup and exclusive durable
      // publication/readback. No diagnostic file is written or removed here.
      return confirmedResult(await provision(provisionOptions, credentials.password));
    } catch { fail("RUNTIME_PROMOTION_PROVISION"); }
  } catch (error) {
    if (error instanceof RuntimePromotionError) throw error;
    fail("RUNTIME_PROMOTION_OPERATION");
  } finally {
    clearCredentials(diagnostic); clearCredentials(credentials);
    // An injected reader owns its source; validation above always clones it.
    // The production reader instead transfers an owned in-memory record.
    if (readDiagnostic === readRuntimeDiagnosticConfiguration) clearCredentials(source);
    source = null;
  }
}

export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  try {
    const result = await run(parseArguments(args), dependencies);
    outputStream.write(`${JSON.stringify(result)}\n`);
    return result;
  } catch (error) {
    if (error instanceof RuntimePromotionError) throw error;
    fail("RUNTIME_PROMOTION_OPERATION");
  }
}

function failureResult(error) {
  return { status: "blocked", configSaved: null, launchApproved: false,
    error: error instanceof RuntimePromotionError ? error.code : "RUNTIME_PROMOTION_OPERATION" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const deadline = setTimeout(() => {
    process.stdout.write(`${JSON.stringify(failureResult(new RuntimePromotionError("RUNTIME_PROMOTION_TIMEOUT")))}\n`);
    process.exit(1);
  }, 60000);
  try { await main(); }
  catch (error) {
    const result = failureResult(error);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.stderr.write(`${result.error}: Runtime promotion was not confirmed.\n`);
    process.exitCode = 1;
  } finally { clearTimeout(deadline); }
}
