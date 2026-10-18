import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArguments as authenticationArguments } from "./start-private-auth.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { readRuntimeAuthenticationBundle, validateRuntimeAuthenticationConfiguration, validateRuntimeDatabaseConfiguration,
  validateRuntimeMessagingConfiguration, runtimeMessagingConfigurationExists, writeRuntimeMessagingConfiguration,
  readRuntimeMessagingConfiguration } from "../server/config/runtime-database-file.mjs";
import { clearRuntimeMessagingSecrets, loadRuntimeMessagingEnvironment } from "../server/config/runtime-messaging.mjs";
import { mailConfiguration } from "../server/mail/config.mjs";

const CODES = new Set(["USAGE", "ENVIRONMENT", "EXISTS", "CONFIG", "INPUT", "OPERATION"].map((name) => `RUNTIME_MESSAGING_PREPARATION_${name}`));
const FIELDS = ["command", "privateDirectory", "privatePathMode", "smtpHost", "smtpPort"];
const CONFIG_FIELDS = ["format", "version", "origin", "mailKey", "messageKey", "smtpHost", "smtpPort", "smtpUser", "smtpPassword"];
export class RuntimeMessagingPreparationError extends Error {
  constructor(code) { const selected = CODES.has(code) ? code : "RUNTIME_MESSAGING_PREPARATION_OPERATION"; super(selected); this.code = selected; }
}
const fail = (code) => { throw new RuntimeMessagingPreparationError(code); };

export function parseArguments(args) {
  try {
    if (!Array.isArray(args) || args.length !== 9 || !["check", "prepare"].includes(args[0])) fail("RUNTIME_MESSAGING_PREPARATION_USAGE");
    const selected = { command: args[0] }, names = new Map([["--private-directory", "privateDirectory"],
      ["--private-path-mode", "privatePathMode"], ["--smtp-host", "smtpHost"], ["--smtp-port", "smtpPort"]]);
    for (let index = 1; index < args.length; index += 2) {
      const name = names.get(args[index]), value = args[index + 1];
      if (!name || Object.hasOwn(selected, name) || typeof value !== "string" || !value || value.startsWith("--")) fail("RUNTIME_MESSAGING_PREPARATION_USAGE");
      selected[name] = value;
    }
    authenticationArguments(["--private-directory", selected.privateDirectory, "--private-path-mode", selected.privatePathMode]);
    // Syntax validation only, before any private file read or personal prompt.
    // These fixed public placeholders are never persisted or sent to SMTP.
    const config = mailConfiguration({ JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1", JESSIEMESSAGE_SITE_ORIGIN: "https://recette.jessiemessage.com",
      JESSIEMESSAGE_MAIL_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", JESSIEMESSAGE_SMTP_HOST: selected.smtpHost,
      JESSIEMESSAGE_SMTP_PORT: selected.smtpPort, JESSIEMESSAGE_SMTP_USER: "metadata-only", JESSIEMESSAGE_SMTP_PASSWORD: "metadata-only" });
    config.key.fill(0);
    return Object.fromEntries(FIELDS.map((name) => [name, selected[name]]));
  } catch { fail("RUNTIME_MESSAGING_PREPARATION_USAGE"); }
}

export async function readSmtpCredentials(stream) {
  if (!stream || stream.isTTY) fail("RUNTIME_MESSAGING_PREPARATION_INPUT");
  const chunks = []; let size = 0, bytes;
  try {
    for await (const chunk of stream) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); chunks.push(value); size += value.length;
      if (size > 8192) fail("RUNTIME_MESSAGING_PREPARATION_INPUT");
    }
    bytes = Buffer.concat(chunks);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const fields = text.split("\n");
    if (fields.length !== 2 || fields.some((value) => !value || /[\x00-\x1f\x7f]/.test(value))) fail("RUNTIME_MESSAGING_PREPARATION_INPUT");
    return { smtpUser: fields[0], smtpPassword: fields[1] };
  } catch { fail("RUNTIME_MESSAGING_PREPARATION_INPUT"); }
  finally { bytes?.fill(0); for (const chunk of chunks) chunk.fill(0); }
}

export async function run(options, { inheritedEnv = process.env, execArgv = process.execArgv, inputStream = process.stdin,
  readBundle = readRuntimeAuthenticationBundle, exists = runtimeMessagingConfigurationExists,
  readCredentials = readSmtpCredentials, random = randomBytes, writeConfiguration = writeRuntimeMessagingConfiguration,
  readConfiguration = readRuntimeMessagingConfiguration } = {}) {
  let source, database, authentication, credentials, mailBytes, messageBytes, configuration, loaded, readBack, env;
  try {
    if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.getOwnPropertySymbols(options).length
      || Object.getOwnPropertyNames(options).sort().join(",") !== [...FIELDS].sort().join(",")
      || FIELDS.some((name) => !Object.hasOwn(Object.getOwnPropertyDescriptor(options, name) ?? {}, "value"))) fail("RUNTIME_MESSAGING_PREPARATION_USAGE");
    const selected = parseArguments([options.command, "--private-directory", options.privateDirectory, "--private-path-mode", options.privatePathMode,
      "--smtp-host", options.smtpHost, "--smtp-port", options.smtpPort]);
    let processOptions;
    try { processOptions = privateAuthenticationProcessOptions(inheritedEnv, execArgv); }
    catch { fail("RUNTIME_MESSAGING_PREPARATION_ENVIRONMENT"); }
    try {
      const present = await exists(selected.privateDirectory);
      if (present === true) fail("RUNTIME_MESSAGING_PREPARATION_EXISTS");
      if (present !== false) fail("RUNTIME_MESSAGING_PREPARATION_CONFIG");
      source = await readBundle(selected.privateDirectory);
      const descriptors = source && Object.getOwnPropertyDescriptors(source);
      if (!source || Object.getPrototypeOf(source) !== Object.prototype || Object.getOwnPropertySymbols(source).length
        || Object.getOwnPropertyNames(source).sort().join(",") !== "authentication,database"
        || ["authentication", "database"].some((name) => !Object.hasOwn(descriptors[name] ?? {}, "value"))) fail("RUNTIME_MESSAGING_PREPARATION_CONFIG");
      database = validateRuntimeDatabaseConfiguration(descriptors.database.value);
      authentication = validateRuntimeAuthenticationConfiguration(descriptors.authentication.value);
    } catch (error) {
      if (error instanceof RuntimeMessagingPreparationError) throw error;
      fail("RUNTIME_MESSAGING_PREPARATION_CONFIG");
    }
    if (selected.command === "check") return { status: "ready_for_input", messagingConfigSaved: false, launchApproved: false };
    try {
      credentials = await readCredentials(inputStream);
      if (!credentials || Object.getPrototypeOf(credentials) !== Object.prototype || Object.getOwnPropertySymbols(credentials).length
        || Object.getOwnPropertyNames(credentials).sort().join(",") !== "smtpPassword,smtpUser"
        || ["smtpUser", "smtpPassword"].some((name) => !Object.hasOwn(Object.getOwnPropertyDescriptor(credentials, name) ?? {}, "value"))) fail("RUNTIME_MESSAGING_PREPARATION_INPUT");
    } catch { fail("RUNTIME_MESSAGING_PREPARATION_INPUT"); }
    try {
      mailBytes = random(32); messageBytes = random(32);
      if (![mailBytes, messageBytes].every((value) => Buffer.isBuffer(value) && value.length === 32)) fail("RUNTIME_MESSAGING_PREPARATION_CONFIG");
      configuration = validateRuntimeMessagingConfiguration({ format: "jessiemessage-runtime-messaging", version: 1,
        origin: authentication.origin, mailKey: mailBytes.toString("base64url"), messageKey: messageBytes.toString("base64url"),
        smtpHost: selected.smtpHost, smtpPort: selected.smtpPort, smtpUser: credentials.smtpUser, smtpPassword: credentials.smtpPassword });
      // Validate against the existing MFA and DB as well as the fixed profile;
      // this loader uses only in-memory records and never opens SQL or SMTP.
      env = await loadRuntimeMessagingEnvironment(selected.privateDirectory, processOptions, {
        readBundle: async () => ({ database, authentication, messaging: configuration }) });
      const saved = await writeConfiguration(selected.privateDirectory, configuration);
      if (Object.getOwnPropertyDescriptor(saved ?? {}, "saved")?.value !== true) fail("RUNTIME_MESSAGING_PREPARATION_CONFIG");
      readBack = await readConfiguration(selected.privateDirectory);
      loaded = validateRuntimeMessagingConfiguration(readBack);
      if (CONFIG_FIELDS.some((name) => loaded[name] !== configuration[name])) fail("RUNTIME_MESSAGING_PREPARATION_CONFIG");
    } catch { fail("RUNTIME_MESSAGING_PREPARATION_CONFIG"); }
    return { status: "prepared", messagingConfigSaved: true, launchApproved: false };
  } catch (error) {
    if (error instanceof RuntimeMessagingPreparationError) throw error;
    fail("RUNTIME_MESSAGING_PREPARATION_OPERATION");
  } finally {
    for (const value of [database, authentication, configuration, loaded, env]) clearRuntimeMessagingSecrets(value);
    if (readCredentials === readSmtpCredentials) clearRuntimeMessagingSecrets(credentials);
    if (readConfiguration === readRuntimeMessagingConfiguration) clearRuntimeMessagingSecrets(readBack);
    if (readBundle === readRuntimeAuthenticationBundle && source && typeof source === "object") {
      for (const name of ["database", "authentication"]) clearRuntimeMessagingSecrets(Object.getOwnPropertyDescriptor(source, name)?.value);
    }
    mailBytes?.fill?.(0); messageBytes?.fill?.(0);
  }
}

export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  const result = await run(parseArguments(args), dependencies);
  outputStream.write(`${JSON.stringify(result)}\n`); return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    process.stderr.write(`${error instanceof RuntimeMessagingPreparationError ? error.code : "RUNTIME_MESSAGING_PREPARATION_OPERATION"}: Private messaging preparation was not confirmed.\n`);
    process.exitCode = 1;
  }
}
