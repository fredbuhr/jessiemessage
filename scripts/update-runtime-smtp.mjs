import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArguments as authenticationArguments } from "./start-private-auth.mjs";
import { readPassword } from "./migration-input.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { readRuntimeMessagingBundle, replaceRuntimeMessagingSmtpPassword,
  validateRuntimeMessagingConfiguration } from "../server/config/runtime-database-file.mjs";
import { clearRuntimeMessagingSecrets, loadRuntimeMessagingEnvironment } from "../server/config/runtime-messaging.mjs";
import { mailConfiguration } from "../server/mail/config.mjs";
import { createVerificationTransport } from "../server/mail/transport.mjs";

const FIELDS = ["command", "privateDirectory", "privatePathMode"];
const CODES = new Set(["USAGE", "ENVIRONMENT", "INPUT", "CONFIGURATION", "VERIFY", "SAVE"].map((name) => `RUNTIME_SMTP_UPDATE_${name}`));
export class RuntimeSmtpUpdateError extends Error {
  constructor(code) { const selected = CODES.has(code) ? code : "RUNTIME_SMTP_UPDATE_CONFIGURATION"; super(selected); this.code = selected; }
}
const fail = (code) => { throw new RuntimeSmtpUpdateError(code); };

export function parseArguments(args) {
  try {
    if (!Array.isArray(args) || !["check", "update"].includes(args[0])) fail("RUNTIME_SMTP_UPDATE_USAGE");
    return { command: args[0], ...authenticationArguments(args.slice(1)) };
  } catch { fail("RUNTIME_SMTP_UPDATE_USAGE"); }
}

export async function verifySmtp(env) {
  let configuration, transport;
  try {
    configuration = mailConfiguration(env);
    transport = await createVerificationTransport(configuration);
    if (await transport.verify() !== true) fail("RUNTIME_SMTP_UPDATE_VERIFY");
    return true;
  } finally {
    try { await transport?.close(); }
    finally { configuration?.key.fill(0); }
  }
}

export async function run(options, { inheritedEnv = process.env, execArgv = process.execArgv,
  inputStream = process.stdin, readBundle = readRuntimeMessagingBundle, readSecret = readPassword,
  verify = verifySmtp, replacePassword = replaceRuntimeMessagingSmtpPassword } = {}) {
  let source, configuration, replacement, env, password;
  try {
    if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.getOwnPropertySymbols(options).length
      || Object.getOwnPropertyNames(options).sort().join(",") !== [...FIELDS].sort().join(",")
      || FIELDS.some((name) => !Object.hasOwn(Object.getOwnPropertyDescriptor(options, name) ?? {}, "value"))) fail("RUNTIME_SMTP_UPDATE_USAGE");
    const selected = parseArguments([options.command, "--private-directory", options.privateDirectory, "--private-path-mode", options.privatePathMode]);
    let processOptions;
    try { processOptions = privateAuthenticationProcessOptions(inheritedEnv, execArgv); }
    catch { fail("RUNTIME_SMTP_UPDATE_ENVIRONMENT"); }
    try {
      source = await readBundle(selected.privateDirectory);
      configuration = validateRuntimeMessagingConfiguration(source?.messaging);
      env = await loadRuntimeMessagingEnvironment(selected.privateDirectory, processOptions, { readBundle: async () => source });
    } catch { fail("RUNTIME_SMTP_UPDATE_CONFIGURATION"); }
    if (selected.command === "check") return { status: "ready_for_input", keysPreserved: true,
      messagingConfigSaved: false, smtpAuthenticated: false, launchApproved: false };
    try {
      password = await readSecret(inputStream);
      replacement = validateRuntimeMessagingConfiguration({ ...configuration, smtpPassword: password });
    } catch { fail("RUNTIME_SMTP_UPDATE_INPUT"); }
    env.JESSIEMESSAGE_SMTP_PASSWORD = password;
    try { if (await verify(env) !== true) fail("RUNTIME_SMTP_UPDATE_VERIFY"); }
    catch { fail("RUNTIME_SMTP_UPDATE_VERIFY"); }
    try {
      const saved = await replacePassword(selected.privateDirectory, configuration, password);
      if (saved?.saved !== true || saved?.keysPreserved !== true) fail("RUNTIME_SMTP_UPDATE_SAVE");
    } catch { fail("RUNTIME_SMTP_UPDATE_SAVE"); }
    return { status: "updated", keysPreserved: true, messagingConfigSaved: true,
      smtpAuthenticated: true, launchApproved: false };
  } catch (error) {
    if (error instanceof RuntimeSmtpUpdateError) throw error;
    fail("RUNTIME_SMTP_UPDATE_CONFIGURATION");
  } finally {
    for (const value of [configuration, replacement, env]) clearRuntimeMessagingSecrets(value);
    if (readBundle === readRuntimeMessagingBundle && source && typeof source === "object") {
      for (const name of ["database", "authentication", "messaging"]) clearRuntimeMessagingSecrets(source[name]);
    }
    password = "";
  }
}

export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  const result = await run(parseArguments(args), dependencies);
  outputStream.write(`${JSON.stringify(result)}\n`); return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    const code = error instanceof RuntimeSmtpUpdateError ? error.code : "RUNTIME_SMTP_UPDATE_CONFIGURATION";
    process.stderr.write(`${code}: SMTP password update not confirmed; no automatic retry.\n`);
    process.exitCode = 1;
  }
}
