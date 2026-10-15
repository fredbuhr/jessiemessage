import { resolve } from "node:path";
import { validateRuntimeDatabaseConfiguration, validateRuntimeAuthenticationConfiguration,
  readRuntimeAuthenticationBundle, runtimeDatabaseEnvironment } from "./runtime-database-file.mjs";
import { CONFIG_CHECK_NAMES, inspectPreproductionConfiguration } from "../preflight/config.mjs";

export class RuntimeAuthenticationEnvironmentError extends Error {
  constructor() {
    super("Private authentication environment is unavailable.");
    this.name = "RuntimeAuthenticationEnvironmentError";
    this.code = "RUNTIME_AUTH_ENVIRONMENT";
  }
}
const fail = () => { throw new RuntimeAuthenticationEnvironmentError(); };

function record(value, required, optional = []) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail();
  const names = Object.getOwnPropertyNames(value);
  if (required.some((name) => !names.includes(name)) || names.some((name) => ![...required, ...optional].includes(name))) fail();
  const copy = {};
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
    copy[name] = descriptor.value;
  }
  return copy;
}

function clearSecrets(value) {
  if (!value || typeof value !== "object") return;
  for (const name of ["password", "mfaKey"]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (descriptor && Object.hasOwn(descriptor, "value") && descriptor.writable) value[name] = "";
  }
}

export async function loadRuntimeAuthenticationEnvironment(privateDirectory, options = {}, dependencies = {}) {
  let readBundle, source, database, authentication, env, complete = false;
  try {
    if (typeof privateDirectory !== "string" || privateDirectory.length > 4096 || !privateDirectory.startsWith("/")
      || privateDirectory === "/" || privateDirectory.includes("\\") || resolve(privateDirectory) !== privateDirectory
      || /[\x00-\x1f\x7f]/.test(privateDirectory)) fail();
    const parameters = record(options, [], ["port"]), selected = record(dependencies, [], ["readBundle"]);
    const port = parameters.port === undefined ? "3000" : parameters.port;
    if (typeof port !== "string" || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) fail();
    readBundle = selected.readBundle === undefined ? readRuntimeAuthenticationBundle : selected.readBundle;
    if (typeof readBundle !== "function") fail();
    source = await readBundle(privateDirectory);
    const bundle = record(source, ["database", "authentication"]);
    database = validateRuntimeDatabaseConfiguration(bundle.database);
    authentication = validateRuntimeAuthenticationConfiguration(bundle.authentication);
    // The two records come from one anchored private-directory acquisition.
    // Build a fresh environment; inherited feature flags, TLS bypasses, other
    // application secrets and diagnostic credentials are never merged.
    env = { ...runtimeDatabaseEnvironment(database), PORT: port,
      JESSIEMESSAGE_SITE_ORIGIN: authentication.origin, JESSIEMESSAGE_MFA_KEY: authentication.mfaKey,
      JESSIEMESSAGE_ENABLE_AUTH: "1" };
    const report = inspectPreproductionConfiguration(env, { expectedOrigin: authentication.origin, target: "auth-only" });
    if (report.valid !== true || report.checks.length !== CONFIG_CHECK_NAMES.length
      || report.checks.some((check, index) => check.name !== CONFIG_CHECK_NAMES[index] || !["pass", "disabled"].includes(check.status))) fail();
    complete = true;
    // The caller owns these two environment secrets and must clear them after
    // its operation or after transferring the environment to the server.
    return env;
  } catch { fail(); }
  finally {
    clearSecrets(database); clearSecrets(authentication);
    if (readBundle === readRuntimeAuthenticationBundle && source && typeof source === "object") {
      clearSecrets(Object.getOwnPropertyDescriptor(source, "database")?.value);
      clearSecrets(Object.getOwnPropertyDescriptor(source, "authentication")?.value);
    }
    if (!complete && env) { env.JESSIEMESSAGE_RUNTIME_DB_PASSWORD = ""; env.JESSIEMESSAGE_MFA_KEY = ""; }
  }
}
