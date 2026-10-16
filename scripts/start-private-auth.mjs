import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { loadRuntimeAuthenticationEnvironment } from "../server/config/runtime-authentication.mjs";
import { inspectPreproductionConfiguration } from "../server/preflight/config.mjs";
import { inspectDatabase } from "../server/preflight/database.mjs";
import { makePreflightReport } from "../server/preflight/report.mjs";
import { start } from "../server/index.mjs";

const CODES = new Set(["PRIVATE_AUTH_USAGE", "PRIVATE_AUTH_ENVIRONMENT", "PRIVATE_AUTH_CONFIGURATION", "PRIVATE_AUTH_STARTUP"]);
const FIELDS = ["privateDirectory", "privatePathMode"];
const ENV_FIELDS = ["PORT", "JESSIEMESSAGE_DB_HOST", "JESSIEMESSAGE_DB_PORT", "JESSIEMESSAGE_DB_NAME",
  "JESSIEMESSAGE_APPLICATION_DATABASE", "JESSIEMESSAGE_RUNTIME_DB_USER", "JESSIEMESSAGE_RUNTIME_DB_PASSWORD",
  "JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE", "JESSIEMESSAGE_PRIVATE_PATH_MODE", "JESSIEMESSAGE_SITE_ORIGIN", "JESSIEMESSAGE_MFA_KEY",
  ...["AUTH", "ACCESS", "CHAT", "MEDIA", "CRM", "CLIENT_RECOVERY", "BROADCAST", "MAIL_DELIVERY", "NOTIFICATIONS"].map((name) => `JESSIEMESSAGE_ENABLE_${name}`)];
export class PrivateAuthenticationStartupError extends Error {
  constructor(code) {
    const selected = CODES.has(code) ? code : "PRIVATE_AUTH_STARTUP";
    super(selected); this.code = selected;
  }
}
const fail = (code) => { throw new PrivateAuthenticationStartupError(code); };

export function parseArguments(args) {
  if (!Array.isArray(args) || args.length !== 4) fail("PRIVATE_AUTH_USAGE");
  const selected = {}, names = new Map([["--private-directory", "privateDirectory"], ["--private-path-mode", "privatePathMode"]]);
  for (let index = 0; index < args.length; index += 2) {
    const name = names.get(args[index]), value = args[index + 1];
    if (!name || Object.hasOwn(selected, name) || typeof value !== "string" || !value || value.startsWith("--")) fail("PRIVATE_AUTH_USAGE");
    selected[name] = value;
  }
  if (selected.privatePathMode !== "linux-dirfd" || selected.privateDirectory.length > 4096
    || !selected.privateDirectory.startsWith("/") || selected.privateDirectory === "/"
    || resolve(selected.privateDirectory) !== selected.privateDirectory
    || /[\\\x00-\x1f\x7f]/.test(selected.privateDirectory)) fail("PRIVATE_AUTH_USAGE");
  return { privateDirectory: selected.privateDirectory, privatePathMode: selected.privatePathMode };
}

function normalizeOptions(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.getOwnPropertySymbols(options).length
    || Object.getOwnPropertyNames(options).sort().join(",") !== [...FIELDS].sort().join(",")
    || FIELDS.some((name) => !Object.hasOwn(Object.getOwnPropertyDescriptor(options, name) ?? {}, "value"))) fail("PRIVATE_AUTH_USAGE");
  return parseArguments(["--private-directory", options.privateDirectory, "--private-path-mode", options.privatePathMode]);
}

function ownedEnvironment(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length
    || Object.getOwnPropertyNames(value).sort().join(",") !== [...ENV_FIELDS].sort().join(",")) fail("PRIVATE_AUTH_CONFIGURATION");
  const copy = {};
  for (const name of ENV_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") fail("PRIVATE_AUTH_CONFIGURATION");
    copy[name] = descriptor.value;
  }
  return copy;
}

function clearOwnedEnvironment(value) {
  for (const name of ["JESSIEMESSAGE_RUNTIME_DB_PASSWORD", "JESSIEMESSAGE_MFA_KEY"]) {
    const descriptor = value && Object.getOwnPropertyDescriptor(value, name);
    if (descriptor && Object.hasOwn(descriptor, "value") && descriptor.writable) value[name] = "";
  }
}

export async function run(options, { inheritedEnv = process.env, execArgv = process.execArgv,
  loadEnvironment = loadRuntimeAuthenticationEnvironment, inspect = inspectDatabase, startServer = start } = {}) {
  let env, source;
  try {
    const selected = normalizeOptions(options);
    let processOptions;
    try { processOptions = privateAuthenticationProcessOptions(inheritedEnv, execArgv); }
    catch { fail("PRIVATE_AUTH_ENVIRONMENT"); }
    try {
      source = await loadEnvironment(selected.privateDirectory, processOptions);
      env = ownedEnvironment(source);
      const report = inspectPreproductionConfiguration(env, { expectedOrigin: env.JESSIEMESSAGE_SITE_ORIGIN, target: "auth-only" });
      if (!report.valid || report.checks.some((check) => ["fail", "not_checked"].includes(check.status))
        || env.JESSIEMESSAGE_ENABLE_AUTH !== "1" || env.PORT !== processOptions.port
        || env.JESSIEMESSAGE_PRIVATE_PATH_MODE !== selected.privatePathMode) fail("PRIVATE_AUTH_CONFIGURATION");
    } catch { fail("PRIVATE_AUTH_CONFIGURATION"); }
    try {
      const report = makePreflightReport("database", await inspect({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }));
      if (report.status !== "checks_passed" || report.checks.some((check) => check.status !== "pass")
        || report.privilegeObservation.profile !== env.JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE) fail("PRIVATE_AUTH_CONFIGURATION");
    } catch { fail("PRIVATE_AUTH_CONFIGURATION"); }
    try { await startServer(env, { requestOrigin: env.JESSIEMESSAGE_SITE_ORIGIN }); }
    catch { fail("PRIVATE_AUTH_STARTUP"); }
    return { started: true, authOnly: true };
  } catch (error) {
    if (error instanceof PrivateAuthenticationStartupError) throw error;
    fail("PRIVATE_AUTH_STARTUP");
  } finally {
    clearOwnedEnvironment(env);
    if (loadEnvironment === loadRuntimeAuthenticationEnvironment) clearOwnedEnvironment(source);
  }
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  return run(parseArguments(args), dependencies);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    const code = error instanceof PrivateAuthenticationStartupError ? error.code : "PRIVATE_AUTH_STARTUP";
    process.stderr.write(`${code}: Private authentication startup failed.\n`);
    process.exitCode = 1;
  }
}
