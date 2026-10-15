import { CONFIG_CHECK_NAMES } from "./config.mjs";
import { PLATFORM_CHECK_NAMES } from "./platform.mjs";
import { DATABASE_CHECK_NAMES } from "./database.mjs";

const catalogue = Object.freeze({ config: CONFIG_CHECK_NAMES, platform: PLATFORM_CHECK_NAMES, database: DATABASE_CHECK_NAMES });
const statuses = new Set(["pass", "fail", "disabled", "not_checked"]);
const errors = new Set(["PREFLIGHT_USAGE", "PREFLIGHT_OPERATION", "PREFLIGHT_REPORT", "PREFLIGHT_ABORTED", "PREFLIGHT_TIMEOUT"]);
const remaining = Object.freeze(["hosting_account", "database_isolation", "physical_schema_and_constraints", "secret_provenance", "runtime_write_acceptance",
  "media_persistence", "proxy_limits", "shutdown_signals", "mail_receipt", "age_assurance", "retention_restoration", "device_screen_reader"]);

export class PreflightReportError extends Error {
  constructor() { super("The preflight result could not be validated."); this.code = "PREFLIGHT_REPORT"; }
}
const invalid = () => { throw new PreflightReportError(); };
function data(object, key) {
  if (!object || typeof object !== "object") invalid();
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) invalid();
  return descriptor.value;
}
function envelope(command, status, checks) {
  return { format: "jessiemessage-preflight", version: 1, command,
    target: command === "config" ? "auth-only" : null, status,
    launchApproved: false, operatorOfflineVerified: false,
    checks, remainingChecks: [...remaining] };
}

/** Rebuild every field; component objects and their extra properties are never serialized. */
export function makePreflightReport(command, result) {
  if (!Object.hasOwn(catalogue, command)) invalid();
  const names = catalogue[command], received = data(result, "checks"), valid = data(result, "valid");
  if (typeof valid !== "boolean" || !Array.isArray(received) || received.length > names.length) invalid();
  const seen = new Map();
  for (const item of received) {
    const name = data(item, "name"), status = data(item, "status");
    if (!names.includes(name) || !statuses.has(status) || seen.has(name)) invalid();
    seen.set(name, status);
  }
  const checks = names.map((name) => ({ name, status: seen.get(name) ?? "not_checked" }));
  const failed = checks.some((check) => check.status === "fail");
  if (valid === failed) invalid();
  return envelope(command, failed ? "blocked" : checks.some((check) => check.status === "not_checked") ? "incomplete" : "checks_passed", checks);
}

export function preflightFailure(command, code = "PREFLIGHT_OPERATION") {
  return { ...envelope(Object.hasOwn(catalogue, command) ? command : "unavailable", "blocked", []),
    error: errors.has(code) ? code : "PREFLIGHT_OPERATION" };
}

export function preflightExitCode(report) {
  return report.status === "checks_passed" ? 0 : report.status === "incomplete" ? 3 : report.error === "PREFLIGHT_USAGE" ? 2 : 1;
}
