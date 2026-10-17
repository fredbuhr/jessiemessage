import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArguments as authenticationArguments } from "./start-private-auth.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { clearRuntimeMessagingSecrets, copyRuntimeMessagingEnvironment, loadRuntimeMessagingEnvironment } from "../server/config/runtime-messaging.mjs";
import { copyRuntimeMediaEnvironment, loadRuntimeMediaEnvironment } from "../server/config/runtime-media.mjs";
import { copyRuntimeNotificationsEnvironment, loadRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";
import { checkRuntimeMediaStorage } from "../server/config/runtime-media-storage.mjs";
import { inspectDatabase } from "../server/preflight/database.mjs";
import { makePreflightReport } from "../server/preflight/report.mjs";
import { start } from "../server/index.mjs";

const CODES = new Set(["USAGE", "ENVIRONMENT", "CONFIGURATION", "DATABASE", "SCHEMA", "STARTUP"].map((name) => `PRIVATE_MESSAGING_${name}`));
export class PrivateMessagingStartupError extends Error {
  constructor(code) { const selected = CODES.has(code) ? code : "PRIVATE_MESSAGING_STARTUP"; super(selected); this.code = selected; }
}
const fail = (code) => { throw new PrivateMessagingStartupError(code); };

export function parseArguments(args) {
  try {
    if (!Array.isArray(args) || !["check", "start"].includes(args[0])) fail("PRIVATE_MESSAGING_USAGE");
    let offset = 1, deployment;
    if (args[offset] === "--deployment") {
      if (args[offset + 1] !== "primary-transition") fail("PRIVATE_MESSAGING_USAGE");
      deployment = args[offset + 1]; offset += 2;
    }
    if (args[offset] === "--profile") {
      if (!["photos", "photos-notify"].includes(args[offset + 1]) || deployment && args[offset + 1] !== "photos-notify") fail("PRIVATE_MESSAGING_USAGE");
      return { command: args[0], ...(deployment ? { deployment } : {}), profile: args[offset + 1], ...authenticationArguments(args.slice(offset + 2)) };
    }
    if (deployment) fail("PRIVATE_MESSAGING_USAGE");
    return { command: args[0], ...authenticationArguments(args.slice(offset)) };
  } catch { fail("PRIVATE_MESSAGING_USAGE"); }
}

// Match the configured server's physical schema checks, without creating its
// services, HTTP listener, transport or workers. These adapters issue reads.
export async function checkMessagingSchema(env) {
  let pool;
  try {
    const { createRuntimePool } = await import("../server/db/runtime.mjs");
    const { createAuthStore } = await import("../server/auth/store.mjs");
    const { createAccessStore } = await import("../server/access/store.mjs");
    const { createMailStore } = await import("../server/mail/store.mjs");
    const { createChatStore } = await import("../server/chat/store.mjs");
    const { createMediaStore } = await import("../server/media/store.mjs");
    pool = await createRuntimePool(env);
    const chatStore = createChatStore(pool);
    for (const store of [createAuthStore(pool), createAccessStore(pool), createMailStore(pool), chatStore,
      createMediaStore({ pool, chatStore })]) await store.assertSchema();
    if (env.JESSIEMESSAGE_ENABLE_NOTIFICATIONS === "1") {
      const { createNotificationsStore } = await import("../server/notifications/store.mjs");
      const { loadNotificationsConfig } = await import("../server/notifications/config.mjs");
      const notifications = loadNotificationsConfig(env);
      try { await createNotificationsStore({ pool, chatStore, key: notifications.key }).assertSchema(); }
      finally { notifications.key.fill(0); }
    }
  } catch { fail("PRIVATE_MESSAGING_SCHEMA"); }
  finally { try { await pool?.end(); } catch { fail("PRIVATE_MESSAGING_SCHEMA"); } }
}

export async function run(options, { inheritedEnv = process.env, execArgv = process.execArgv,
  loadEnvironment, inspect = inspectDatabase, checkSchema = checkMessagingSchema,
  startServer = start, checkStorage = checkRuntimeMediaStorage } = {}) {
  let source, env;
  try {
    const names = ["command", "privateDirectory", "privatePathMode", ...(Object.hasOwn(options ?? {}, "profile") ? ["profile"] : []),
      ...(Object.hasOwn(options ?? {}, "deployment") ? ["deployment"] : [])];
    if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.getOwnPropertySymbols(options).length
      || Object.getOwnPropertyNames(options).sort().join(",") !== names.sort().join(",")
      || names.some((name) => !Object.hasOwn(Object.getOwnPropertyDescriptor(options, name) ?? {}, "value"))) fail("PRIVATE_MESSAGING_USAGE");
    const selected = parseArguments([options.command, ...(Object.hasOwn(options, "deployment") ? ["--deployment", options.deployment] : []),
      ...(Object.hasOwn(options, "profile") ? ["--profile", options.profile] : []),
      "--private-directory", options.privateDirectory, "--private-path-mode", options.privatePathMode]);
    const transition = selected.deployment === "primary-transition", originOptions = transition ? { originProfile: "primary" } : {};
    const notifications = selected.profile === "photos-notify", photos = notifications || selected.profile === "photos";
    loadEnvironment ??= notifications ? loadRuntimeNotificationsEnvironment : photos ? loadRuntimeMediaEnvironment : loadRuntimeMessagingEnvironment;
    let processOptions;
    try { processOptions = privateAuthenticationProcessOptions(inheritedEnv, execArgv); }
    catch { fail("PRIVATE_MESSAGING_ENVIRONMENT"); }
    try {
      source = await loadEnvironment(selected.privateDirectory, { ...processOptions, ...originOptions });
      env = (notifications ? copyRuntimeNotificationsEnvironment : photos ? copyRuntimeMediaEnvironment : copyRuntimeMessagingEnvironment)(source, originOptions);
      if (env.PORT !== processOptions.port || env.JESSIEMESSAGE_PRIVATE_PATH_MODE !== selected.privatePathMode) fail("PRIVATE_MESSAGING_CONFIGURATION");
    } catch { fail("PRIVATE_MESSAGING_CONFIGURATION"); }
    try {
      const report = makePreflightReport("database", await inspect({ env, databaseName: env.JESSIEMESSAGE_DB_NAME }));
      if (report.status !== "checks_passed" || report.checks.some((check) => check.status !== "pass")
        || report.privilegeObservation.profile !== env.JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE) fail("PRIVATE_MESSAGING_DATABASE");
    } catch { fail("PRIVATE_MESSAGING_DATABASE"); }
    try {
      await checkSchema(env);
      if (photos) await checkStorage(env);
    } catch { fail("PRIVATE_MESSAGING_SCHEMA"); }
    if (selected.command === "start") {
      try { await startServer(env, { requestOrigin: env.JESSIEMESSAGE_SITE_ORIGIN, ...(transition ? { deviceTransition: true } : {}) }); }
      catch { fail("PRIVATE_MESSAGING_STARTUP"); }
    }
    return { status: selected.command === "start" ? "started" : "checks_passed", profile: notifications ? "messaging-photos-notify" : photos ? "messaging-photos" : "messaging-text",
      ...(transition ? { deployment: "primary-transition" } : {}),
      started: selected.command === "start", smtpDeliveryTested: false, launchApproved: false };
  } catch (error) {
    if (error instanceof PrivateMessagingStartupError) throw error;
    fail("PRIVATE_MESSAGING_STARTUP");
  } finally {
    clearRuntimeMessagingSecrets(env);
    if ([loadRuntimeMessagingEnvironment, loadRuntimeMediaEnvironment, loadRuntimeNotificationsEnvironment].includes(loadEnvironment)) clearRuntimeMessagingSecrets(source);
  }
}

export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  const result = await run(parseArguments(args), dependencies);
  outputStream.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) {
    process.stderr.write(`${error instanceof PrivateMessagingStartupError ? error.code : "PRIVATE_MESSAGING_STARTUP"}: Private messaging startup was not confirmed.\n`);
    process.exitCode = 1;
  }
}
