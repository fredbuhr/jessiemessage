import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArguments as authenticationArguments } from "./start-private-auth.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { clearRuntimeMessagingSecrets, copyRuntimeMessagingEnvironment, loadRuntimeMessagingEnvironment } from "../server/config/runtime-messaging.mjs";
import { copyRuntimeMediaEnvironment, loadRuntimeMediaEnvironment } from "../server/config/runtime-media.mjs";
import { copyRuntimeNotificationsEnvironment, loadRuntimeNotificationsEnvironment } from "../server/config/runtime-notifications-file.mjs";
import { copyRuntimeCrmEnvironment, loadRuntimeCrmEnvironment } from "../server/config/runtime-crm.mjs";
import { copyRuntimeBroadcastEnvironment, loadRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { copyRuntimeVideoEnvironment, loadRuntimeVideoEnvironment } from "../server/config/runtime-video.mjs";
import { checkRuntimeVideoStorage } from "../server/config/runtime-video-storage.mjs";
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
    let offset = 1, deployment, experience;
    if (args[offset] === "--deployment") {
      if (args[offset + 1] !== "primary-transition") fail("PRIVATE_MESSAGING_USAGE");
      deployment = args[offset + 1]; offset += 2;
    }
    if (args[offset] === "--experience") { if (args[offset + 1] !== "1") fail("PRIVATE_MESSAGING_USAGE"); experience = true; offset += 2; }
    if (args[offset] === "--profile") {
      const profile = args[offset + 1];
      if (experience && (profile !== "photos-notify-recovery-crm-broadcast-video" || !deployment) || !["photos", "photos-notify", "photos-notify-recovery", "photos-notify-recovery-crm", "photos-notify-recovery-crm-broadcast", "photos-notify-recovery-crm-broadcast-video"].includes(profile)
        || deployment && !["photos-notify", "photos-notify-recovery", "photos-notify-recovery-crm", "photos-notify-recovery-crm-broadcast", "photos-notify-recovery-crm-broadcast-video"].includes(profile)
        || ["photos-notify-recovery", "photos-notify-recovery-crm", "photos-notify-recovery-crm-broadcast", "photos-notify-recovery-crm-broadcast-video"].includes(profile) && !deployment) fail("PRIVATE_MESSAGING_USAGE");
      return { command: args[0], ...(deployment ? { deployment } : {}), ...(experience ? { experience: true } : {}), profile: args[offset + 1], ...authenticationArguments(args.slice(offset + 2)) };
    }
    if (deployment || experience) fail("PRIVATE_MESSAGING_USAGE");
    return { command: args[0], ...authenticationArguments(args.slice(offset)) };
  } catch { fail("PRIVATE_MESSAGING_USAGE"); }
}

// Match the configured server's physical schema checks, without creating its
// services, HTTP listener, transport or workers. These adapters issue reads.
export async function checkMessagingSchema(env, { video = false, experience = false } = {}) {
  if (typeof experience !== "boolean" || experience && !video || typeof video !== "boolean") fail("PRIVATE_MESSAGING_SCHEMA");
  const schemaOptions = video ? { video: true, ...(experience ? { experience: true } : {}) } : {};
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
      createMediaStore({ pool, chatStore })]) await store.assertSchema(schemaOptions);
    if (env.JESSIEMESSAGE_ENABLE_NOTIFICATIONS === "1") {
      const { createNotificationsStore } = await import("../server/notifications/store.mjs");
      const { loadNotificationsConfig } = await import("../server/notifications/config.mjs");
      const notifications = loadNotificationsConfig(env);
      try { await createNotificationsStore({ pool, chatStore, key: notifications.key }).assertSchema(schemaOptions); }
      finally { notifications.key.fill(0); }
    }
    if (env.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY === "1") {
      const { createResetStore } = await import("../server/reset/store.mjs");
      const { createResetMailStore } = await import("../server/reset/mail-store.mjs");
      await createResetStore(pool).assertSchema(schemaOptions);
      await createResetMailStore(pool).assertSchema(schemaOptions);
    }
    if (env.JESSIEMESSAGE_ENABLE_CRM === "1") {
      const { createCrmStore } = await import("../server/crm/store.mjs");
      await createCrmStore({ pool, chatStore }).assertSchema(schemaOptions);
    }
    if (env.JESSIEMESSAGE_ENABLE_BROADCAST === "1") {
      const { assertBroadcastSchema } = await import("../server/broadcast/store.mjs");
      await assertBroadcastSchema(pool, schemaOptions);
    }
    if (experience) {
      const [{ createPreferencesStore }, { createTasksStore }] = await Promise.all([
        import("../server/preferences/store.mjs"), import("../server/tasks/store.mjs")]);
      await createPreferencesStore({ pool, chatStore }).assertSchema();
      const key = Buffer.from(env.JESSIEMESSAGE_CRM_KEY ?? "", "base64url");
      try { await createTasksStore({ pool, chatStore, key, experience }).assertSchema(schemaOptions); }
      finally { key.fill(0); }
    }
    if (video) {
      const [{ assertErasureSchema }, { loadVideoMigrations }] = await Promise.all([import("../server/data/erasure-schema.mjs"), import("../server/video/migrations.mjs")]);
      const connection = await pool.getConnection();
      try { await assertErasureSchema(connection, env.JESSIEMESSAGE_DB_NAME, { candidateMigrations: experience ? await (await import("../server/experience/migrations.mjs")).loadExperienceMigrations() : await loadVideoMigrations() }); }
      finally { connection.release(); }
    }
  } catch { fail("PRIVATE_MESSAGING_SCHEMA"); }
  finally { try { await pool?.end(); } catch { fail("PRIVATE_MESSAGING_SCHEMA"); } }
}

export async function run(options, { inheritedEnv = process.env, execArgv = process.execArgv,
  loadEnvironment, inspect = inspectDatabase, checkSchema = checkMessagingSchema,
  startServer = start, checkStorage = checkRuntimeMediaStorage, checkVideoStorage = checkRuntimeVideoStorage, managedVideo = false } = {}) {
  let source, env;
  try {
    const names = ["command", "privateDirectory", "privatePathMode", ...(Object.hasOwn(options ?? {}, "profile") ? ["profile"] : []),
      ...(Object.hasOwn(options ?? {}, "deployment") ? ["deployment"] : []), ...(Object.hasOwn(options ?? {}, "experience") ? ["experience"] : [])];
    if (!options || Object.getPrototypeOf(options) !== Object.prototype || Object.getOwnPropertySymbols(options).length
      || Object.getOwnPropertyNames(options).sort().join(",") !== names.sort().join(",")
      || names.some((name) => !Object.hasOwn(Object.getOwnPropertyDescriptor(options, name) ?? {}, "value"))
      || Object.hasOwn(options, "experience") && options.experience !== true) fail("PRIVATE_MESSAGING_USAGE");
    const selected = parseArguments([options.command, ...(Object.hasOwn(options, "deployment") ? ["--deployment", options.deployment] : []),
      ...(options.experience === true ? ["--experience", "1"] : []),
      ...(Object.hasOwn(options, "profile") ? ["--profile", options.profile] : []),
      "--private-directory", options.privateDirectory, "--private-path-mode", options.privatePathMode]);
    const transition = selected.deployment === "primary-transition", originOptions = transition ? { originProfile: "primary" } : {};
    const experience = selected.experience === true;
    const video = selected.profile === "photos-notify-recovery-crm-broadcast-video";
    // The two-root closure owner and manual backup parent must own every video
    // producer. Only its fixed IPC child supplies this internal startup seam.
    if (typeof managedVideo !== "boolean" || video && selected.command === "start" && !managedVideo) fail("PRIVATE_MESSAGING_USAGE");
    const broadcast = video || selected.profile === "photos-notify-recovery-crm-broadcast";
    const crm = broadcast || selected.profile === "photos-notify-recovery-crm";
    const recovery = crm || selected.profile === "photos-notify-recovery";
    const notifications = recovery || selected.profile === "photos-notify", photos = notifications || selected.profile === "photos";
    const profileOptions = { ...originOptions, ...(recovery ? { recovery: true } : {}) };
    loadEnvironment ??= video ? loadRuntimeVideoEnvironment : broadcast ? loadRuntimeBroadcastEnvironment : crm ? loadRuntimeCrmEnvironment : notifications ? loadRuntimeNotificationsEnvironment : photos ? loadRuntimeMediaEnvironment : loadRuntimeMessagingEnvironment;
    let processOptions;
    try { processOptions = privateAuthenticationProcessOptions(inheritedEnv, execArgv); }
    catch { fail("PRIVATE_MESSAGING_ENVIRONMENT"); }
    try {
      source = await loadEnvironment(selected.privateDirectory, { ...processOptions, ...profileOptions });
      env = (video ? copyRuntimeVideoEnvironment : broadcast ? copyRuntimeBroadcastEnvironment : crm ? copyRuntimeCrmEnvironment : notifications ? copyRuntimeNotificationsEnvironment : photos ? copyRuntimeMediaEnvironment : copyRuntimeMessagingEnvironment)(source, profileOptions);
      if (recovery && !crm) {
        // The files contain no recovery switch. Activate it only after their
        // unchanged, anchored profile has passed validation, never from env.
        const activated = copyRuntimeNotificationsEnvironment({ ...env, JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "1" }, profileOptions);
        clearRuntimeMessagingSecrets(env); env = activated;
      }
      if (env.PORT !== processOptions.port || env.JESSIEMESSAGE_PRIVATE_PATH_MODE !== selected.privatePathMode) fail("PRIVATE_MESSAGING_CONFIGURATION");
    } catch { fail("PRIVATE_MESSAGING_CONFIGURATION"); }
    try {
      const report = makePreflightReport("database", await inspect({ env, databaseName: env.JESSIEMESSAGE_DB_NAME, ...(video ? { video: true, ...(experience ? { experience: true } : {}) } : {}) }));
      if (report.status !== "checks_passed" || report.checks.some((check) => check.status !== "pass")
        || report.privilegeObservation.profile !== env.JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE) fail("PRIVATE_MESSAGING_DATABASE");
    } catch { fail("PRIVATE_MESSAGING_DATABASE"); }
    try {
      await checkSchema(env, ...(video ? [{ video: true, ...(experience ? { experience: true } : {}) }] : []));
      if (photos) await checkStorage(env, ...(video ? [{ video: true, ...(experience ? { experience: true } : {}) }] : []));
      if (video) await checkVideoStorage(env, ...(experience ? [{ experience: true }] : []));
    } catch { fail("PRIVATE_MESSAGING_SCHEMA"); }
    if (selected.command === "start") {
      try { await startServer(env, { requestOrigin: env.JESSIEMESSAGE_SITE_ORIGIN, ...(transition ? { deviceTransition: true } : {}), ...(recovery ? { recovery: true } : {}), ...(crm ? { crm: true } : {}), ...(broadcast ? { broadcast: true } : {}), ...(video ? { video: true, ...(experience ? { experience: true } : {}) } : {}) }); }
      catch { fail("PRIVATE_MESSAGING_STARTUP"); }
    }
    return { status: selected.command === "start" ? "started" : "checks_passed", profile: video ? "messaging-photos-notify-recovery-crm-broadcast-video" : broadcast ? "messaging-photos-notify-recovery-crm-broadcast" : crm ? "messaging-photos-notify-recovery-crm" : recovery ? "messaging-photos-notify-recovery" : notifications ? "messaging-photos-notify" : photos ? "messaging-photos" : "messaging-text",
      ...(transition ? { deployment: "primary-transition" } : {}),
      started: selected.command === "start", smtpDeliveryTested: false, launchApproved: false };
  } catch (error) {
    if (error instanceof PrivateMessagingStartupError) throw error;
    fail("PRIVATE_MESSAGING_STARTUP");
  } finally {
    clearRuntimeMessagingSecrets(env);
    if ([loadRuntimeMessagingEnvironment, loadRuntimeMediaEnvironment, loadRuntimeNotificationsEnvironment, loadRuntimeCrmEnvironment, loadRuntimeBroadcastEnvironment, loadRuntimeVideoEnvironment].includes(loadEnvironment)) clearRuntimeMessagingSecrets(source);
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
