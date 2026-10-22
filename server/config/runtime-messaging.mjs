import { resolve } from "node:path";
import { validateRuntimeDatabaseConfiguration, validateRuntimeAuthenticationConfiguration, validateRuntimeMessagingConfiguration,
  readRuntimeMessagingBundle, runtimeDatabaseEnvironment } from "./runtime-database-file.mjs";
import { MESSAGING_CONFIG_CHECK_NAMES, PRIMARY_MESSAGING_CONFIG_CHECK_NAMES, inspectPreproductionConfiguration } from "../preflight/config.mjs";

export const MESSAGING_ENV_FIELDS = Object.freeze(["PORT", "JESSIEMESSAGE_DB_HOST", "JESSIEMESSAGE_DB_PORT", "JESSIEMESSAGE_DB_NAME",
  "JESSIEMESSAGE_APPLICATION_DATABASE", "JESSIEMESSAGE_RUNTIME_DB_USER", "JESSIEMESSAGE_RUNTIME_DB_PASSWORD",
  "JESSIEMESSAGE_RUNTIME_PRIVILEGE_PROFILE", "JESSIEMESSAGE_PRIVATE_PATH_MODE", "JESSIEMESSAGE_SITE_ORIGIN", "JESSIEMESSAGE_MFA_KEY",
  "JESSIEMESSAGE_MAIL_KEY", "JESSIEMESSAGE_MESSAGE_KEY", "JESSIEMESSAGE_SMTP_HOST", "JESSIEMESSAGE_SMTP_PORT",
  "JESSIEMESSAGE_SMTP_USER", "JESSIEMESSAGE_SMTP_PASSWORD",
  ...["AUTH", "ACCESS", "CHAT", "MEDIA", "CRM", "CLIENT_RECOVERY", "BROADCAST", "MAIL_DELIVERY", "NOTIFICATIONS"].map((name) => `JESSIEMESSAGE_ENABLE_${name}`)]);

export class RuntimeMessagingEnvironmentError extends Error {
  constructor() { super("Private messaging environment is unavailable."); this.code = "RUNTIME_MESSAGING_ENVIRONMENT"; }
}
const fail = () => { throw new RuntimeMessagingEnvironmentError(); };
const SECRET_FIELDS = ["password", "mfaKey", "mailKey", "messageKey", "mediaKey", "notificationKey", "vapidPrivateKey", "crmKey", "videoKey", "smtpUser", "smtpPassword",
  "JESSIEMESSAGE_RUNTIME_DB_PASSWORD", "JESSIEMESSAGE_MFA_KEY", "JESSIEMESSAGE_MAIL_KEY", "JESSIEMESSAGE_MESSAGE_KEY",
  "JESSIEMESSAGE_MEDIA_KEY", "JESSIEMESSAGE_VIDEO_KEY", "JESSIEMESSAGE_NOTIFICATIONS_KEY", "JESSIEMESSAGE_VAPID_PRIVATE_KEY", "JESSIEMESSAGE_CRM_KEY", "JESSIEMESSAGE_SMTP_USER", "JESSIEMESSAGE_SMTP_PASSWORD"];

export function clearRuntimeMessagingSecrets(value) {
  if (!value || typeof value !== "object") return;
  for (const name of SECRET_FIELDS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (descriptor && Object.hasOwn(descriptor, "value") && descriptor.writable) value[name] = "";
  }
}

function record(value, fields, optional = []) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail();
  const names = Object.getOwnPropertyNames(value);
  if (fields.some((name) => !names.includes(name)) || names.some((name) => ![...fields, ...optional].includes(name))) fail();
  return Object.fromEntries(names.map((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
    return [name, descriptor.value];
  }));
}

export function runtimeOriginProfile(options = {}) {
  const selected = record(options, [], ["originProfile"]);
  const originProfile = selected.originProfile === undefined ? "preproduction" : selected.originProfile;
  if (!["preproduction", "primary"].includes(originProfile)) fail();
  return { originProfile };
}

export function copyRuntimeMessagingEnvironment(value, options = {}) {
  let env;
  try {
    const originOptions = runtimeOriginProfile(options);
    const names = originOptions.originProfile === "primary" ? PRIMARY_MESSAGING_CONFIG_CHECK_NAMES : MESSAGING_CONFIG_CHECK_NAMES;
    env = record(value, MESSAGING_ENV_FIELDS);
    if (MESSAGING_ENV_FIELDS.some((name) => typeof env[name] !== "string")) fail();
    const report = inspectPreproductionConfiguration(env, { expectedOrigin: env.JESSIEMESSAGE_SITE_ORIGIN, target: "messaging-text", ...originOptions });
    if (!report.valid || report.checks.length !== names.length
      || report.checks.some((check, index) => check.name !== names[index] || !["pass", "disabled"].includes(check.status))) fail();
    return env;
  } catch { clearRuntimeMessagingSecrets(env); fail(); }
}

export async function loadRuntimeMessagingEnvironment(privateDirectory, options = {}, dependencies = {}) {
  let source, database, authentication, messaging, env;
  let readBundle;
  try {
    if (typeof privateDirectory !== "string" || !privateDirectory.startsWith("/") || privateDirectory === "/"
      || privateDirectory.length > 4096 || resolve(privateDirectory) !== privateDirectory || /[\\\x00-\x1f\x7f]/.test(privateDirectory)) fail();
    const parameters = record(options, [], ["port", "originProfile"]), selected = record(dependencies, [], ["readBundle"]);
    const originOptions = runtimeOriginProfile(Object.hasOwn(parameters, "originProfile") ? { originProfile: parameters.originProfile } : {});
    const port = parameters.port === undefined ? "3000" : parameters.port;
    if (typeof port !== "string" || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) fail();
    readBundle = selected.readBundle === undefined ? readRuntimeMessagingBundle : selected.readBundle;
    if (typeof readBundle !== "function") fail();
    source = await readBundle(privateDirectory, originOptions);
    const bundle = record(source, ["database", "authentication", "messaging"]);
    database = validateRuntimeDatabaseConfiguration(bundle.database);
    authentication = validateRuntimeAuthenticationConfiguration(bundle.authentication, originOptions);
    messaging = validateRuntimeMessagingConfiguration(bundle.messaging, originOptions);
    if (authentication.origin !== messaging.origin) fail();
    env = copyRuntimeMessagingEnvironment({ ...runtimeDatabaseEnvironment(database), PORT: port,
      JESSIEMESSAGE_SITE_ORIGIN: authentication.origin, JESSIEMESSAGE_MFA_KEY: authentication.mfaKey,
      JESSIEMESSAGE_MAIL_KEY: messaging.mailKey, JESSIEMESSAGE_MESSAGE_KEY: messaging.messageKey,
      JESSIEMESSAGE_SMTP_HOST: messaging.smtpHost, JESSIEMESSAGE_SMTP_PORT: messaging.smtpPort,
      JESSIEMESSAGE_SMTP_USER: messaging.smtpUser, JESSIEMESSAGE_SMTP_PASSWORD: messaging.smtpPassword,
      JESSIEMESSAGE_ENABLE_AUTH: "1", JESSIEMESSAGE_ENABLE_ACCESS: "1",
      JESSIEMESSAGE_ENABLE_CHAT: "1", JESSIEMESSAGE_ENABLE_MAIL_DELIVERY: "1" }, originOptions);
    return env;
  } catch { clearRuntimeMessagingSecrets(env); fail(); }
  finally {
    for (const value of [database, authentication, messaging]) clearRuntimeMessagingSecrets(value);
    if (readBundle === readRuntimeMessagingBundle && source && typeof source === "object") {
      for (const name of ["database", "authentication", "messaging"]) clearRuntimeMessagingSecrets(Object.getOwnPropertyDescriptor(source, name)?.value);
    }
  }
}
