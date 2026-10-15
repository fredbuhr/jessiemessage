import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRuntimeAuthenticationConfiguration, writeRuntimeAuthenticationConfiguration,
  readRuntimeAuthenticationConfiguration, runtimeAuthenticationConfigurationExists } from "../server/config/runtime-database-file.mjs";

const FIELDS = ["privateDirectory", "origin", "privatePathMode"];
const CONFIG_FIELDS = ["format", "version", "origin", "mfaKey"];
const CODES = new Set(["USAGE", "EXISTS", "CONFIG", "OPERATION", "TIMEOUT"].map((name) => `RUNTIME_AUTH_PREPARATION_${name}`));

export class RuntimeAuthenticationPreparationError extends Error {
  constructor(code) {
    const selected = CODES.has(code) ? code : "RUNTIME_AUTH_PREPARATION_OPERATION";
    super(selected); this.name = "RuntimeAuthenticationPreparationError"; this.code = selected;
  }
}
const fail = (code) => { throw new RuntimeAuthenticationPreparationError(code); };

export function parseArguments(args) {
  if (!Array.isArray(args) || args.length !== 6) fail("RUNTIME_AUTH_PREPARATION_USAGE");
  const names = new Map([["--private-directory", "privateDirectory"], ["--origin", "origin"], ["--private-path-mode", "privatePathMode"]]);
  const selected = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = names.get(args[index]), value = args[index + 1];
    if (!name || Object.hasOwn(selected, name) || typeof value !== "string" || !value || value.startsWith("--")) {
      fail("RUNTIME_AUTH_PREPARATION_USAGE");
    }
    selected[name] = value;
  }
  if (selected.privatePathMode !== "linux-dirfd" || selected.privateDirectory.length > 4096
    || !selected.privateDirectory.startsWith("/") || selected.privateDirectory === "/" || selected.privateDirectory.includes("\\")
    || resolve(selected.privateDirectory) !== selected.privateDirectory || /[\x00-\x1f\x7f]/.test(selected.privateDirectory)) {
    fail("RUNTIME_AUTH_PREPARATION_USAGE");
  }
  try {
    // Validate the origin before private file access or random generation.
    // This fixed nonsecret placeholder is never persisted or used by auth.
    validateRuntimeAuthenticationConfiguration({ format: "jessiemessage-runtime-auth", version: 1, origin: selected.origin,
      mfaKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
  } catch { fail("RUNTIME_AUTH_PREPARATION_USAGE"); }
  return Object.fromEntries(FIELDS.map((name) => [name, selected[name]]));
}

function normalizeOptions(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.getOwnPropertySymbols(options).length
    || Object.getOwnPropertyNames(options).sort().join(",") !== [...FIELDS].sort().join(",")
    || FIELDS.some((name) => !Object.hasOwn(Object.getOwnPropertyDescriptor(options, name) ?? {}, "value"))) {
    fail("RUNTIME_AUTH_PREPARATION_USAGE");
  }
  return parseArguments(["--private-directory", options.privateDirectory, "--origin", options.origin, "--private-path-mode", options.privatePathMode]);
}

function clearKey(value) {
  if (!value || typeof value !== "object") return;
  const descriptor = Object.getOwnPropertyDescriptor(value, "mfaKey");
  if (descriptor && Object.hasOwn(descriptor, "value") && descriptor.writable) value.mfaKey = "";
}

export async function run(options, {
  exists = runtimeAuthenticationConfigurationExists, random = randomBytes,
  writeConfiguration = writeRuntimeAuthenticationConfiguration, readConfiguration = readRuntimeAuthenticationConfiguration,
} = {}) {
  let bytes, config, loaded, readBack;
  try {
    const selected = normalizeOptions(options);
    let present;
    try { present = await exists(selected.privateDirectory); }
    catch { fail("RUNTIME_AUTH_PREPARATION_CONFIG"); }
    if (present === true) fail("RUNTIME_AUTH_PREPARATION_EXISTS");
    if (present !== false) fail("RUNTIME_AUTH_PREPARATION_CONFIG");
    try {
      bytes = random(32);
      if (!Buffer.isBuffer(bytes) || bytes.length !== 32) fail("RUNTIME_AUTH_PREPARATION_CONFIG");
      config = validateRuntimeAuthenticationConfiguration({ format: "jessiemessage-runtime-auth", version: 1,
        origin: selected.origin, mfaKey: bytes.toString("base64url") });
      const saved = await writeConfiguration(selected.privateDirectory, config);
      if (Object.getOwnPropertyDescriptor(saved ?? {}, "saved")?.value !== true) fail("RUNTIME_AUTH_PREPARATION_CONFIG");
      readBack = await readConfiguration(selected.privateDirectory);
      loaded = validateRuntimeAuthenticationConfiguration(readBack);
      if (CONFIG_FIELDS.some((name) => loaded[name] !== config[name])) fail("RUNTIME_AUTH_PREPARATION_CONFIG");
    } catch { fail("RUNTIME_AUTH_PREPARATION_CONFIG"); }
    return { status: "prepared", authConfigSaved: true, launchApproved: false };
  } catch (error) {
    if (error instanceof RuntimeAuthenticationPreparationError) throw error;
    fail("RUNTIME_AUTH_PREPARATION_OPERATION");
  } finally {
    if (Buffer.isBuffer(bytes)) bytes.fill(0);
    clearKey(config); clearKey(loaded);
    if (readConfiguration === readRuntimeAuthenticationConfiguration) clearKey(readBack);
  }
}

export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  try {
    const result = await run(parseArguments(args), dependencies);
    outputStream.write(`${JSON.stringify(result)}\n`);
    return result;
  } catch (error) {
    if (error instanceof RuntimeAuthenticationPreparationError) throw error;
    fail("RUNTIME_AUTH_PREPARATION_OPERATION");
  }
}

function failureResult(error) {
  return { status: "blocked", authConfigSaved: null, launchApproved: false,
    error: error instanceof RuntimeAuthenticationPreparationError ? error.code : "RUNTIME_AUTH_PREPARATION_OPERATION" };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const deadline = setTimeout(() => {
    process.stdout.write(`${JSON.stringify(failureResult(new RuntimeAuthenticationPreparationError("RUNTIME_AUTH_PREPARATION_TIMEOUT")))}\n`);
    process.exit(1);
  }, 60000);
  try { await main(); }
  catch (error) {
    const result = failureResult(error);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.stderr.write(`${result.error}: Authentication preparation was not confirmed.\n`);
    process.exitCode = 1;
  } finally { clearTimeout(deadline); }
}
