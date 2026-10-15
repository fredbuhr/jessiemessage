import { lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { SITE_CONTACT_EMAIL } from "../server/site.mjs";
import { authConfiguration } from "../server/auth/config.mjs";
import { createAuthStore } from "../server/auth/store.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { inspectPreproductionConfiguration } from "../server/preflight/config.mjs";
import { inspectDatabase } from "../server/preflight/database.mjs";
import { makePreflightReport, preflightExitCode } from "../server/preflight/report.mjs";
import { AdminBootstrapError, main as bootstrapMain, validateInput, validateOutputPath } from "./admin-bootstrap.mjs";
import { readPassword } from "./migration-input.mjs";

const SETUP_BASENAME = "admin-setup.json";
const FLAGS = ["AUTH", "ACCESS", "CHAT", "MEDIA", "CRM", "CLIENT_RECOVERY", "BROADCAST", "MAIL_DELIVERY"];
const FIELDS = ["command", "privateDirectory", "privatePathMode"];
const CODES = new Set(["USAGE", "PASSWORD", "CONFIG", "OUTPUT", "DATABASE", "SCHEMA", "EXISTS", "BOOTSTRAP",
  "UNCERTAIN", "OPERATION", "TIMEOUT"].map((name) => `ADMIN_SETUP_${name}`));
const KNOWN_PRECREATION = new Set(["SETUP_INPUT", "SETUP_CONFIG", "SETUP_FILE", "SETUP_DATABASE"]);

export class AdminSetupInputError extends Error {
  constructor(code) {
    const selected = CODES.has(code) ? code : "ADMIN_SETUP_OPERATION";
    super(selected); this.name = "AdminSetupInputError"; this.code = selected;
  }
}
const fail = (code) => { throw new AdminSetupInputError(code); };

export function parseArguments(args) {
  if (!Array.isArray(args)) fail("ADMIN_SETUP_USAGE");
  const command = args[0] === "check" ? "check" : "initialize";
  const flags = command === "check" ? args.slice(1) : args;
  if (flags.length !== 4) fail("ADMIN_SETUP_USAGE");
  const selected = { command }, names = new Map([["--private-directory", "privateDirectory"], ["--private-path-mode", "privatePathMode"]]);
  for (let index = 0; index < flags.length; index += 2) {
    const name = names.get(flags[index]), value = flags[index + 1];
    if (!name || Object.hasOwn(selected, name) || typeof value !== "string" || !value || value.startsWith("--")) fail("ADMIN_SETUP_USAGE");
    selected[name] = value;
  }
  const directory = selected.privateDirectory;
  if (selected.privatePathMode !== "linux-dirfd" || directory.length > 4096 || !directory.startsWith("/")
    || directory === "/" || resolve(directory) !== directory || directory.includes("\\") || /[\x00-\x1f\x7f]/.test(directory)) {
    fail("ADMIN_SETUP_USAGE");
  }
  return Object.fromEntries(FIELDS.map((name) => [name, selected[name]]));
}

function normalizeOptions(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length
    || Object.getOwnPropertyNames(value).sort().join(",") !== [...FIELDS].sort().join(",")
    || FIELDS.some((name) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, "value"))
    || !["check", "initialize"].includes(value.command)) fail("ADMIN_SETUP_USAGE");
  return parseArguments([...(value.command === "check" ? ["check"] : []), "--private-directory", value.privateDirectory,
    "--private-path-mode", value.privatePathMode]);
}

async function processOptions() {
  const { privateAuthenticationProcessOptions } = await import("../server/config/private-auth-environment.mjs");
  return privateAuthenticationProcessOptions();
}

async function checkedProcessOptions(guard) {
  try {
    const result = await guard();
    if (!result || Object.getOwnPropertySymbols(result).length || Object.getOwnPropertyNames(result).join(",") !== "port") throw new Error();
    const descriptor = Object.getOwnPropertyDescriptor(result, "port");
    if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string"
      || !/^[1-9][0-9]{0,4}$/.test(descriptor.value) || Number(descriptor.value) > 65535) throw new Error();
    return { port: descriptor.value };
  } catch { fail("ADMIN_SETUP_CONFIG"); }
}

async function loadEnvironment(directory, parameters) {
  const { loadRuntimeAuthenticationEnvironment } = await import("../server/config/runtime-authentication.mjs");
  return loadRuntimeAuthenticationEnvironment(directory, parameters);
}

async function verifyOutput(directory) {
  try {
    await validateOutputPath(join(directory, SETUP_BASENAME), { pathMode: "linux-dirfd" });
    await withPrivateDirectory(directory, async (scope) => {
      await scope.assertReady();
      try { await lstat(scope.file(SETUP_BASENAME)); }
      catch (error) { if (error.code === "ENOENT") return; throw error; }
      fail("ADMIN_SETUP_OUTPUT");
    });
  } catch { fail("ADMIN_SETUP_OUTPUT"); }
}

function checkedEnvironment(value) {
  let config;
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) throw new Error();
    const env = {};
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") throw new Error();
      env[name] = descriptor.value;
    }
    if (FLAGS.some((name) => env[`JESSIEMESSAGE_ENABLE_${name}`] !== (name === "AUTH" ? "1" : "0"))
      || env.JESSIEMESSAGE_PRIVATE_PATH_MODE !== "linux-dirfd") throw new Error();
    config = authConfiguration(env);
    const report = makePreflightReport("config", inspectPreproductionConfiguration(env, { expectedOrigin: env.JESSIEMESSAGE_SITE_ORIGIN }));
    if (!config.enabled || preflightExitCode(report) !== 0) throw new Error();
    return env;
  } catch { fail("ADMIN_SETUP_CONFIG"); }
  finally { config?.totpKey?.fill(0); }
}

function administratorAbsent(rows) {
  if (!Array.isArray(rows) || Object.getOwnPropertyDescriptor(rows, "length")?.value !== 1) return false;
  const index = Object.getOwnPropertyDescriptor(rows, "0");
  if (!index || !Object.hasOwn(index, "value") || !index.value || typeof index.value !== "object"
    || Object.getOwnPropertySymbols(index.value).length || Object.getOwnPropertyNames(index.value).join(",") !== "administrator_count") return false;
  const descriptor = Object.getOwnPropertyDescriptor(index.value, "administrator_count");
  if (!descriptor || !Object.hasOwn(descriptor, "value")) return false;
  const value = descriptor.value;
  if (typeof value === "bigint") return value === 0n;
  if (typeof value === "number") return value === 0;
  return typeof value === "string" && value === "0";
}

async function verifySchemaAndAbsence(env, createPool, createStore) {
  let pool, failure = null, releaseFailed = false;
  const releases = [];
  try {
    pool = await createPool(env);
    const guardedPool = { async getConnection() {
      const connection = await pool.getConnection();
      return {
        query: (...args) => connection.query(...args),
        release() {
          try {
            const released = Promise.resolve(connection.release());
            released.catch(() => {}); releases.push(released); return released;
          } catch { releaseFailed = true; fail("ADMIN_SETUP_SCHEMA"); }
        },
      };
    } };
    const store = createStore(guardedPool);
    if (typeof store?.assertSchema !== "function" || await store.assertSchema() !== true) fail("ADMIN_SETUP_SCHEMA");
    const connection = await guardedPool.getConnection();
    try {
      const rows = await connection.query({ sql: "SELECT COUNT(*) AS administrator_count FROM users WHERE role = 'admin'", timeout: 2000 });
      if (!administratorAbsent(rows)) fail("ADMIN_SETUP_EXISTS");
    } finally { await connection.release(); }
  } catch (error) { failure = error instanceof AdminSetupInputError ? error : new AdminSetupInputError("ADMIN_SETUP_SCHEMA"); }
  finally {
    const settled = await Promise.allSettled(releases);
    if (releaseFailed || settled.some((item) => item.status !== "fulfilled")) failure = new AdminSetupInputError("ADMIN_SETUP_SCHEMA");
    if (pool) {
      try { await pool.end(); } catch { failure = new AdminSetupInputError("ADMIN_SETUP_SCHEMA"); }
    }
  }
  if (failure) throw failure;
}

export async function run(options, password, {
  load = loadEnvironment, checkOutput = verifyOutput, inspect = inspectDatabase,
  createPool = createRuntimePool, createStore = createAuthStore, initialize = bootstrapMain, guard = processOptions,
} = {}) {
  let loaded, env, input, json, bootstrapEntered = false;
  try {
    const selected = normalizeOptions(options);
    const parameters = await checkedProcessOptions(guard);
    if (selected.command === "initialize") {
      try {
        if (typeof password !== "string" || /[\0\r\n]/.test(password)) throw new Error();
        input = validateInput({ email: SITE_CONTACT_EMAIL, pseudonym: "Jess", password });
      } catch { fail("ADMIN_SETUP_PASSWORD"); }
    }
    try { loaded = await load(selected.privateDirectory, parameters); env = checkedEnvironment(loaded); }
    catch { fail("ADMIN_SETUP_CONFIG"); }
    try { await checkOutput(selected.privateDirectory); } catch { fail("ADMIN_SETUP_OUTPUT"); }
    let report;
    try {
      report = makePreflightReport("database", await inspect({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }));
      if (preflightExitCode(report) !== 0 || report.checks.some((check) => check.status !== "pass")
        || report.privilegeObservation.profile !== env.JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE) throw new Error();
    } catch { fail("ADMIN_SETUP_DATABASE"); }
    await verifySchemaAndAbsence(env, createPool, createStore);
    const base = { launchApproved: false, serverStarted: false, databaseChecks: report.checks, authSchemaVerified: true,
      administratorPreviouslyAbsent: true };
    if (selected.command === "check") return { status: "checked", administratorCreated: false, ...base };
    json = Buffer.from(JSON.stringify(input), "utf8");
    let result;
    try {
      bootstrapEntered = true;
      result = await initialize(["--output", join(selected.privateDirectory, SETUP_BASENAME)], env,
        { inputStream: Readable.from([json]), outputStream: { write() {} } });
    } catch (error) {
      // The existing bootstrap removes its output only for confirmed failures.
      // Never touch either private file here, especially after an uncertain
      // COMMIT or a successful commit followed by a failed pool close.
      if (error instanceof AdminBootstrapError && KNOWN_PRECREATION.has(error.code)) fail("ADMIN_SETUP_BOOTSTRAP");
      fail("ADMIN_SETUP_UNCERTAIN");
    }
    if (result?.created !== true || result.mfaEnrollmentPending !== true || result.recoveryCodeCount !== 8) fail("ADMIN_SETUP_UNCERTAIN");
    return { status: "prepared", administratorCreated: true, mfaEnrollmentPending: true, recoveryCodeCount: 8, ...base };
  } catch (error) {
    if (error instanceof AdminSetupInputError) throw error;
    fail(bootstrapEntered ? "ADMIN_SETUP_UNCERTAIN" : "ADMIN_SETUP_OPERATION");
  } finally {
    password = ""; if (input) input.password = ""; json?.fill(0);
    for (const record of [loaded, env]) {
      if (!record || typeof record !== "object") continue;
      for (const name of ["JESSIEMESSAGE_RUNTIME_DB_PASSWORD", "JESSIEMESSAGE_MFA_KEY"]) {
        const descriptor = Object.getOwnPropertyDescriptor(record, name);
        if (descriptor?.writable && Object.hasOwn(descriptor, "value")) record[name] = "";
      }
    }
  }
}

export async function main(args = process.argv.slice(2), { inputStream = process.stdin, outputStream = process.stdout,
  guard = processOptions, ...dependencies } = {}) {
  let password = "", selected, result;
  try {
    selected = parseArguments(args);
    const parameters = await checkedProcessOptions(guard);
    if (selected.command === "initialize") {
      try { password = await readPassword(inputStream); } catch { fail("ADMIN_SETUP_PASSWORD"); }
    }
    result = await run(selected, password, { ...dependencies, guard: () => parameters });
    outputStream.write(`${JSON.stringify(result)}\n`);
    return result;
  } catch (error) {
    if (error instanceof AdminSetupInputError) throw error;
    fail(result?.administratorCreated === true ? "ADMIN_SETUP_UNCERTAIN" : "ADMIN_SETUP_OPERATION");
  } finally { password = ""; }
}

export function failureResult(error) {
  const code = error instanceof AdminSetupInputError ? Object.getOwnPropertyDescriptor(error, "code")?.value : null;
  return { status: "blocked", administratorCreated: null, launchApproved: false, serverStarted: false,
    error: CODES.has(code) ? code : "ADMIN_SETUP_OPERATION" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const deadline = setTimeout(() => {
    // A timeout cannot establish whether a commit was applied. Preserve all
    // private material and require inspection instead of suggesting a retry.
    process.stdout.write(`${JSON.stringify(failureResult(new AdminSetupInputError("ADMIN_SETUP_UNCERTAIN")))}\n`);
    process.exit(1);
  }, 60000);
  try { await main(); }
  catch (error) {
    const result = failureResult(error);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.stderr.write(`${result.error}: Administrator preparation was not confirmed; preserve private setup material.\n`);
    process.exitCode = 1;
  } finally { clearTimeout(deadline); }
}
