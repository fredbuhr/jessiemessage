import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArguments as authenticationArguments } from "./start-private-auth.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { readRuntimeMessagingBundle, validateRuntimeMediaConfiguration, runtimeMediaConfigurationExists,
  writeRuntimeMediaConfiguration, readRuntimeMediaConfiguration } from "../server/config/runtime-database-file.mjs";
import { loadRuntimeMediaEnvironment } from "../server/config/runtime-media.mjs";
import { clearRuntimeMessagingSecrets, loadRuntimeMessagingEnvironment } from "../server/config/runtime-messaging.mjs";
import { checkRuntimeMediaStorage } from "../server/config/runtime-media-storage.mjs";
import { createRuntimePool } from "../server/db/runtime.mjs";
import { verifyTextBackupData } from "../server/backup/verify.mjs";

const FIELDS = ["command", "privateDirectory", "privatePathMode", "mediaRoot", "ownerBytes", "totalBytes", "minimumFreeBytes"];
const CODES = new Set(["USAGE", "ENVIRONMENT", "EXISTS", "CONFIGURATION", "STORAGE", "SOURCE", "PUBLICATION"].map(name => `PRIVATE_MEDIA_${name}`));
export class PrivateMediaPreparationError extends Error {
  constructor(code) { const selected = CODES.has(code) ? code : "PRIVATE_MEDIA_CONFIGURATION"; super(selected); this.code = selected; }
}
const fail = code => { throw new PrivateMediaPreparationError(code); };

export function parseArguments(args) {
  if (!Array.isArray(args) || args.length < 7 || args.length > 13 || args.length % 2 !== 1
    || !["check", "prepare"].includes(args[0])) fail("PRIVATE_MEDIA_USAGE");
  const names = new Map([["--private-directory", "privateDirectory"], ["--private-path-mode", "privatePathMode"],
    ["--media-root", "mediaRoot"], ["--account-bytes", "ownerBytes"], ["--total-bytes", "totalBytes"], ["--min-free-bytes", "minimumFreeBytes"]]);
  const selected = { command: args[0] };
  for (let index = 1; index < args.length; index += 2) {
    const name = names.get(args[index]), value = args[index + 1];
    if (!name || Object.hasOwn(selected, name) || typeof value !== "string" || !value || value.startsWith("--")) fail("PRIVATE_MEDIA_USAGE");
    selected[name] = value;
  }
  try { authenticationArguments(["--private-directory", selected.privateDirectory, "--private-path-mode", selected.privatePathMode]); }
  catch { fail("PRIVATE_MEDIA_USAGE"); }
  if (typeof selected.mediaRoot !== "string" || !selected.mediaRoot.startsWith("/") || resolve(selected.mediaRoot) !== selected.mediaRoot
    || /[\\\x00-\x1f\x7f]/.test(selected.mediaRoot)) fail("PRIVATE_MEDIA_USAGE");
  selected.ownerBytes ??= "1073741824"; selected.totalBytes ??= "10737418240"; selected.minimumFreeBytes ??= "536870912";
  for (const name of ["ownerBytes", "totalBytes", "minimumFreeBytes"]) {
    if (!/^(?:0|[1-9][0-9]{0,15})$/.test(selected[name]) || !Number.isSafeInteger(Number(selected[name]))
      || Number(selected[name]) < (name === "minimumFreeBytes" ? 0 : 82) || Number(selected[name]) > 1125899906842624) fail("PRIVATE_MEDIA_USAGE");
  }
  if (Number(selected.ownerBytes) > Number(selected.totalBytes)) fail("PRIVATE_MEDIA_USAGE");
  return Object.fromEntries(FIELDS.map(name => [name, selected[name]]));
}

export async function verifyTextSource(env) {
  let pool, keys;
  try {
    pool = await createRuntimePool(env);
    keys = { totpKey: Buffer.from(env.JESSIEMESSAGE_MFA_KEY, "base64url"), mailKey: Buffer.from(env.JESSIEMESSAGE_MAIL_KEY, "base64url"),
      messageKey: Buffer.from(env.JESSIEMESSAGE_MESSAGE_KEY, "base64url") };
    const report = await verifyTextBackupData({ pool, keys });
    if (!report.complete || !report.healthy) fail("PRIVATE_MEDIA_SOURCE");
  } finally { for (const key of Object.values(keys ?? {})) key.fill(0); await pool?.end(); }
}

export async function run(value, { inheritedEnv = process.env, execArgv = process.execArgv, readBundle = readRuntimeMessagingBundle,
  exists = runtimeMediaConfigurationExists, random = randomBytes, inspectStorage = checkRuntimeMediaStorage,
  list = readdir, verifySource = verifyTextSource, writeConfiguration = writeRuntimeMediaConfiguration,
  readConfiguration = readRuntimeMediaConfiguration } = {}) {
  let source, key, media, env, base, readBack;
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length
      || Object.getOwnPropertyNames(value).sort().join(",") !== [...FIELDS].sort().join(",")
      || FIELDS.some(name => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, "value"))) fail("PRIVATE_MEDIA_USAGE");
    const selected = parseArguments([value.command, "--private-directory", value.privateDirectory, "--private-path-mode", value.privatePathMode,
      "--media-root", value.mediaRoot, "--account-bytes", value.ownerBytes, "--total-bytes", value.totalBytes, "--min-free-bytes", value.minimumFreeBytes]);
    let processOptions;
    try { processOptions = privateAuthenticationProcessOptions(inheritedEnv, execArgv); } catch { fail("PRIVATE_MEDIA_ENVIRONMENT"); }
    if (await exists(selected.privateDirectory) !== false) fail("PRIVATE_MEDIA_EXISTS");
    source = await readBundle(selected.privateDirectory);
    const descriptors = source && Object.getOwnPropertyDescriptors(source);
    if (!source || Object.getPrototypeOf(source) !== Object.prototype || Object.getOwnPropertySymbols(source).length
      || Object.getOwnPropertyNames(source).sort().join(",") !== "authentication,database,messaging"
      || ["database", "authentication", "messaging"].some(name => !Object.hasOwn(descriptors[name] ?? {}, "value"))) fail("PRIVATE_MEDIA_CONFIGURATION");
    base = await loadRuntimeMessagingEnvironment(selected.privateDirectory, processOptions, { readBundle: async () => source });
    key = random(32);
    if (!Buffer.isBuffer(key) || key.length !== 32) fail("PRIVATE_MEDIA_CONFIGURATION");
    media = validateRuntimeMediaConfiguration({ format: "jessiemessage-runtime-media", version: 1, origin: base.JESSIEMESSAGE_SITE_ORIGIN,
      mediaKey: key.toString("base64url"), mediaRoot: selected.mediaRoot, ownerBytes: selected.ownerBytes,
      totalBytes: selected.totalBytes, minimumFreeBytes: selected.minimumFreeBytes });
    env = await loadRuntimeMediaEnvironment(selected.privateDirectory, processOptions, { readBundle: async () => ({ ...source, media }) });
    await verifySource(env);
    await inspectStorage(env, { requireInitialized: false });
    if ((await list(selected.mediaRoot)).length !== 0) fail("PRIVATE_MEDIA_STORAGE");
    if (selected.command === "check") return { status: "ready_for_prepare", mediaConfigSaved: false, keysPreserved: true, started: false };
    const saved = await writeConfiguration(selected.privateDirectory, media);
    if (Object.getOwnPropertyDescriptor(saved ?? {}, "saved")?.value !== true) fail("PRIVATE_MEDIA_PUBLICATION");
    readBack = validateRuntimeMediaConfiguration(await readConfiguration(selected.privateDirectory));
    if (Object.keys(media).some(name => media[name] !== readBack[name])) fail("PRIVATE_MEDIA_PUBLICATION");
    return { status: "prepared", mediaConfigSaved: true, keysPreserved: true, started: false };
  } catch (error) {
    if (error instanceof PrivateMediaPreparationError) throw error;
    fail("PRIVATE_MEDIA_CONFIGURATION");
  } finally {
    key?.fill(0); for (const record of [media, env, base, readBack]) clearRuntimeMessagingSecrets(record);
    if (readBundle === readRuntimeMessagingBundle && source) {
      for (const name of ["database", "authentication", "messaging"]) clearRuntimeMessagingSecrets(Object.getOwnPropertyDescriptor(source, name)?.value);
    }
  }
}

export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  const result = await run(parseArguments(args), dependencies); outputStream.write(`${JSON.stringify(result)}\n`); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); } catch (error) {
    process.stderr.write(`${error instanceof PrivateMediaPreparationError ? error.code : "PRIVATE_MEDIA_CONFIGURATION"}: Private photos preparation was not confirmed.\n`);
    process.exitCode = 1;
  }
}
