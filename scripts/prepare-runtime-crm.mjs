import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parseArguments as authenticationArguments } from "./start-private-auth.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { readRuntimeNotificationsBundle, readRuntimeCrmBundle, validateRuntimeCrmConfiguration, validateRuntimeCrmBundle,
  runtimeCrmConfigurationExists, writeRuntimeCrmConfiguration } from "../server/config/runtime-database-file.mjs";
import { loadRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";

const PRIMARY = Object.freeze({ originProfile: "primary" });
const NAMES = ["database", "authentication", "messaging", "media", "notifications", "crm"];
const CODES = new Set(["USAGE", "ENVIRONMENT", "EXISTS", "CONFIGURATION", "PUBLICATION"].map(name => `PRIVATE_CRM_${name}`));
export class PrivateCrmPreparationError extends Error {
  constructor(code) { const selected = CODES.has(code) ? code : "PRIVATE_CRM_CONFIGURATION"; super(selected); this.code = selected; }
}
const fail = code => { throw new PrivateCrmPreparationError(code); };
function clear(bundle) { for (const name of NAMES) clearRuntimeMessagingSecrets(Object.getOwnPropertyDescriptor(bundle ?? {}, name)?.value); }
export function parseArguments(args) {
  try {
    if (!Array.isArray(args) || !["check", "prepare"].includes(args[0])) fail("PRIVATE_CRM_USAGE");
    return { command: args[0], ...authenticationArguments(args.slice(1)) };
  } catch { fail("PRIVATE_CRM_USAGE"); }
}

// This publishes only a new, unused key file. It does not activate CRM, read
// notes, call SQL/SMTP/Push or rotate any existing key.
export async function run(value, { inheritedEnv = process.env, execArgv = process.execArgv, readBundle = readRuntimeNotificationsBundle,
  exists = runtimeCrmConfigurationExists, random = randomBytes, writeConfiguration = writeRuntimeCrmConfiguration,
  readBack = readRuntimeCrmBundle } = {}) {
  let source, base, candidate, verified, back, crm, key;
  try {
    const fields = ["command", "privateDirectory", "privatePathMode"];
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length
      || Object.getOwnPropertyNames(value).sort().join(",") !== [...fields].sort().join(",")
      || fields.some(name => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, "value"))) fail("PRIVATE_CRM_USAGE");
    const selected = parseArguments([value.command, "--private-directory", value.privateDirectory, "--private-path-mode", value.privatePathMode]);
    let processOptions;
    try { processOptions = privateAuthenticationProcessOptions(inheritedEnv, execArgv); }
    catch { fail("PRIVATE_CRM_ENVIRONMENT"); }
    if ([readBundle, exists, random, writeConfiguration, readBack].some(fn => typeof fn !== "function")) fail("PRIVATE_CRM_CONFIGURATION");
    if (await exists(selected.privateDirectory) !== false) fail("PRIVATE_CRM_EXISTS");
    source = await readBundle(selected.privateDirectory, PRIMARY);
    base = await loadRuntimeNotificationsEnvironment(selected.privateDirectory, { ...processOptions, ...PRIMARY, recovery: true }, { readBundle: async () => source });
    if (selected.command === "check") return { status: "ready_for_prepare", profile: "primary-crm", crmConfigSaved: false,
      keysPreserved: true, started: false, migrationPerformed: false };
    key = random(32);
    if (!Buffer.isBuffer(key) || key.length !== 32) fail("PRIVATE_CRM_CONFIGURATION");
    crm = validateRuntimeCrmConfiguration({ version: 1, origin: base.JESSIEMESSAGE_SITE_ORIGIN, crmKey: key.toString("base64url") }, PRIMARY);
    candidate = validateRuntimeCrmBundle({ ...source, crm }, PRIMARY);
    const saved = await writeConfiguration(selected.privateDirectory, crm, PRIMARY);
    if (Object.getOwnPropertyDescriptor(saved ?? {}, "saved")?.value !== true) fail("PRIVATE_CRM_PUBLICATION");
    back = await readBack(selected.privateDirectory, PRIMARY);
    verified = validateRuntimeCrmBundle(back, PRIMARY);
    if (!isDeepStrictEqual(candidate, verified)) fail("PRIVATE_CRM_PUBLICATION");
    return { status: "prepared", profile: "primary-crm", crmConfigSaved: true,
      keysPreserved: true, started: false, migrationPerformed: false };
  } catch (error) {
    if (error instanceof PrivateCrmPreparationError) throw error;
    fail("PRIVATE_CRM_CONFIGURATION");
  } finally {
    if (Buffer.isBuffer(key)) key.fill(0); clearRuntimeMessagingSecrets(base); clearRuntimeMessagingSecrets(crm); clear(candidate); clear(verified);
    if (readBundle === readRuntimeNotificationsBundle) clear(source);
    if (readBack === readRuntimeCrmBundle) clear(back);
  }
}

export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  const result = await run(parseArguments(args), dependencies); outputStream.write(`${JSON.stringify(result)}\n`); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    process.stderr.write(`${error instanceof PrivateCrmPreparationError ? error.code : "PRIVATE_CRM_CONFIGURATION"}: Private file preparation was not confirmed.\n`);
    process.exitCode = 1;
  }
}
