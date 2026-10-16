import { createECDH, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArguments as authenticationArguments } from "./start-private-auth.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { readRuntimeMediaBundle, validateRuntimeNotificationsConfiguration, runtimeNotificationsConfigurationExists,
  writeRuntimeNotificationsConfiguration, readRuntimeNotificationsConfiguration } from "../server/config/runtime-database-file.mjs";
import { loadRuntimeMediaEnvironment } from "../server/config/runtime-media.mjs";
import { loadRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";

const FIELDS = ["command", "privateDirectory", "privatePathMode"];
const CODES = new Set(["USAGE", "ENVIRONMENT", "EXISTS", "CONFIGURATION", "PUBLICATION"].map(name => `PRIVATE_NOTIFICATIONS_${name}`));
export class PrivateNotificationsPreparationError extends Error {
  constructor(code) { const selected = CODES.has(code) ? code : "PRIVATE_NOTIFICATIONS_CONFIGURATION"; super(selected); this.code = selected; }
}
const fail = code => { throw new PrivateNotificationsPreparationError(code); };
export function parseArguments(args) {
  try {
    if (!Array.isArray(args) || !["check", "prepare"].includes(args[0])) fail("PRIVATE_NOTIFICATIONS_USAGE");
    return { command: args[0], ...authenticationArguments(args.slice(1)) };
  } catch { fail("PRIVATE_NOTIFICATIONS_USAGE"); }
}
export function generateNotificationVapidKeys(makeCurve = createECDH) {
  let rawPrivate, privateKey, publicKey;
  try {
    const curve = makeCurve("prime256v1"); curve.generateKeys();
    rawPrivate = curve.getPrivateKey();
    // OpenSSL exports a scalar as its minimal byte representation. VAPID uses
    // exactly 32 octets, including the leading zeroes of a small valid scalar.
    if (!Buffer.isBuffer(rawPrivate) || rawPrivate.length < 1 || rawPrivate.length > 32) throw new Error();
    privateKey = Buffer.alloc(32);
    rawPrivate.copy(privateKey, 32 - rawPrivate.length);
    publicKey = curve.getPublicKey(undefined, "uncompressed");
    if (!Buffer.isBuffer(publicKey) || publicKey.length !== 65) throw new Error();
    return { publicKey, privateKey };
  } catch {
    privateKey?.fill(0); publicKey?.fill(0);
    fail("PRIVATE_NOTIFICATIONS_CONFIGURATION");
  } finally { if (Buffer.isBuffer(rawPrivate)) rawPrivate.fill(0); }
}

// This command only prepares an exclusive private file. It neither applies SQL
// migrations nor starts a listener/worker, and never prints generated keys.
export async function run(value, { inheritedEnv = process.env, execArgv = process.execArgv, readBundle = readRuntimeMediaBundle,
  exists = runtimeNotificationsConfigurationExists, random = randomBytes, generateVapid = generateNotificationVapidKeys,
  writeConfiguration = writeRuntimeNotificationsConfiguration, readConfiguration = readRuntimeNotificationsConfiguration } = {}) {
  let source, base, env, notifications, key, vapid, readBack;
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length
      || Object.getOwnPropertyNames(value).sort().join(",") !== [...FIELDS].sort().join(",")
      || FIELDS.some(name => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, "value"))) fail("PRIVATE_NOTIFICATIONS_USAGE");
    const selected = parseArguments([value.command, "--private-directory", value.privateDirectory, "--private-path-mode", value.privatePathMode]);
    let processOptions;
    try { processOptions = privateAuthenticationProcessOptions(inheritedEnv, execArgv); }
    catch { fail("PRIVATE_NOTIFICATIONS_ENVIRONMENT"); }
    if (await exists(selected.privateDirectory) !== false) fail("PRIVATE_NOTIFICATIONS_EXISTS");
    source = await readBundle(selected.privateDirectory);
    base = await loadRuntimeMediaEnvironment(selected.privateDirectory, processOptions, { readBundle: async () => source });
    if (selected.command === "check") return { status: "ready_for_prepare", profile: "messaging-photos-notify", notificationsConfigSaved: false,
      keysPreserved: true, started: false, migrationPerformed: false };
    key = random(32); vapid = generateVapid();
    if (!Buffer.isBuffer(key) || key.length !== 32 || !Buffer.isBuffer(vapid?.publicKey) || vapid.publicKey.length !== 65
      || !Buffer.isBuffer(vapid?.privateKey) || vapid.privateKey.length !== 32) fail("PRIVATE_NOTIFICATIONS_CONFIGURATION");
    notifications = validateRuntimeNotificationsConfiguration({ version: 1, origin: base.JESSIEMESSAGE_SITE_ORIGIN,
      notificationKey: key.toString("base64url"), vapidPublicKey: vapid.publicKey.toString("base64url"),
      vapidPrivateKey: vapid.privateKey.toString("base64url"), vapidSubject: "mailto:contact@jessiemessage.com" });
    // Check domain separation against all the current private keys before any
    // publication. The old records are reused byte-for-byte.
    env = await loadRuntimeNotificationsEnvironment(selected.privateDirectory, processOptions, { readBundle: async () => ({ ...source, notifications }) });
    const saved = await writeConfiguration(selected.privateDirectory, notifications);
    if (Object.getOwnPropertyDescriptor(saved ?? {}, "saved")?.value !== true) fail("PRIVATE_NOTIFICATIONS_PUBLICATION");
    readBack = validateRuntimeNotificationsConfiguration(await readConfiguration(selected.privateDirectory));
    if (Object.keys(notifications).some(name => notifications[name] !== readBack[name])) fail("PRIVATE_NOTIFICATIONS_PUBLICATION");
    return { status: "prepared", profile: "messaging-photos-notify", notificationsConfigSaved: true,
      keysPreserved: true, started: false, migrationPerformed: false };
  } catch (error) {
    if (error instanceof PrivateNotificationsPreparationError) throw error;
    fail("PRIVATE_NOTIFICATIONS_CONFIGURATION");
  } finally {
    for (const bytes of [key, vapid?.publicKey, vapid?.privateKey]) if (Buffer.isBuffer(bytes)) bytes.fill(0);
    for (const record of [base, env, notifications, readBack]) clearRuntimeMessagingSecrets(record);
    if (readBundle === readRuntimeMediaBundle && source) for (const name of ["database", "authentication", "messaging", "media"]) {
      clearRuntimeMessagingSecrets(Object.getOwnPropertyDescriptor(source, name)?.value);
    }
  }
}

export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  const result = await run(parseArguments(args), dependencies); outputStream.write(`${JSON.stringify(result)}\n`); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    process.stderr.write(`${error instanceof PrivateNotificationsPreparationError ? error.code : "PRIVATE_NOTIFICATIONS_CONFIGURATION"}: Private notification preparation was not confirmed.\n`);
    process.exitCode = 1;
  }
}
