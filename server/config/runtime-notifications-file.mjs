import { readRuntimeNotificationsBundle, validateRuntimeNotificationsConfiguration } from "./runtime-database-file.mjs";
import { MEDIA_ENV_FIELDS, copyRuntimeMediaEnvironment, loadRuntimeMediaEnvironment } from "./runtime-media.mjs";
import { clearRuntimeMessagingSecrets, runtimeOriginProfile } from "./runtime-messaging.mjs";
import { loadNotificationsConfig } from "../notifications/config.mjs";
import { NOTIFICATIONS_CONFIG_CHECK_NAMES, PRIMARY_NOTIFICATIONS_CONFIG_CHECK_NAMES, PRIMARY_NOTIFICATIONS_RECOVERY_CONFIG_CHECK_NAMES, inspectPreproductionConfiguration } from "../preflight/config.mjs";

const NOTIFICATION_FIELDS = ["JESSIEMESSAGE_NOTIFICATIONS_KEY", "JESSIEMESSAGE_VAPID_PUBLIC_KEY", "JESSIEMESSAGE_VAPID_PRIVATE_KEY", "JESSIEMESSAGE_VAPID_SUBJECT"];
export const NOTIFICATIONS_ENV_FIELDS = Object.freeze([...MEDIA_ENV_FIELDS, ...NOTIFICATION_FIELDS]);
export class RuntimeNotificationsEnvironmentError extends Error {
  constructor() { super("Private notification environment is unavailable."); this.code = "RUNTIME_NOTIFICATIONS_ENVIRONMENT"; }
}

function profileOptions(value, withPort = false) {
  const parameters = record(value, [], ["originProfile", "recovery", ...(withPort ? ["port"] : [])]);
  const origin = runtimeOriginProfile(Object.hasOwn(parameters, "originProfile") ? { originProfile: parameters.originProfile } : {});
  if (Object.hasOwn(parameters, "recovery") && typeof parameters.recovery !== "boolean"
    || parameters.recovery === true && origin.originProfile !== "primary") fail();
  return { parameters, origin, recovery: parameters.recovery === true };
}
const fail = () => { throw new RuntimeNotificationsEnvironmentError(); };
function record(value, fields, optional = []) {
  const names = value && Object.getOwnPropertyNames(value);
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length
    || fields.some(name => !names.includes(name)) || names.some(name => ![...fields, ...optional].includes(name))) fail();
  return Object.fromEntries(names.map(name => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
    return [name, descriptor.value];
  }));
}

export function copyRuntimeNotificationsEnvironment(value, options = {}) {
  let selected, base, configuration;
  try {
    const { origin: originOptions, recovery } = profileOptions(options);
    selected = record(value, NOTIFICATIONS_ENV_FIELDS);
    const recoveryFlag = selected.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY;
    if (NOTIFICATIONS_ENV_FIELDS.some(name => typeof selected[name] !== "string") || selected.JESSIEMESSAGE_ENABLE_NOTIFICATIONS !== "1"
      || recoveryFlag !== "0" && !(recovery && recoveryFlag === "1")) fail();
    const activeRecovery = recoveryFlag === "1";
    const names = activeRecovery ? PRIMARY_NOTIFICATIONS_RECOVERY_CONFIG_CHECK_NAMES
      : originOptions.originProfile === "primary" ? PRIMARY_NOTIFICATIONS_CONFIG_CHECK_NAMES : NOTIFICATIONS_CONFIG_CHECK_NAMES;
    // Validate the original photo profile with notifications explicitly disabled;
    // its strict field set cannot absorb notification keys or unrelated flags.
    base = copyRuntimeMediaEnvironment({ ...Object.fromEntries(MEDIA_ENV_FIELDS.map(name => [name, selected[name]])),
      JESSIEMESSAGE_ENABLE_NOTIFICATIONS: "0", JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "0" }, originOptions);
    configuration = loadNotificationsConfig(selected);
    if (!configuration.enabled || configuration.vapid.subject !== "mailto:contact@jessiemessage.com") fail();
    const report = inspectPreproductionConfiguration(selected, { expectedOrigin: selected.JESSIEMESSAGE_SITE_ORIGIN,
      target: activeRecovery ? "messaging-photos-notify-recovery" : "messaging-photos-notify", ...originOptions });
    if (!report.valid || report.checks.length !== names.length
      || report.checks.some((check, index) => check.name !== names[index] || !["pass", "disabled"].includes(check.status))) fail();
    // This permission validates existing recovery data for offline operations;
    // it never turns the feature on. Only the explicit startup profile does so.
    return { ...base, ...Object.fromEntries(NOTIFICATION_FIELDS.map(name => [name, selected[name]])),
      JESSIEMESSAGE_ENABLE_NOTIFICATIONS: "1", JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: recoveryFlag };
  } catch { fail(); }
  finally { clearRuntimeMessagingSecrets(selected); clearRuntimeMessagingSecrets(base); configuration?.key.fill(0); }
}

export async function loadRuntimeNotificationsEnvironment(directory, options = {}, dependencies = {}) {
  let source, bundle, base, env, notifications, readBundle;
  try {
    const { parameters, origin: originOptions, recovery } = profileOptions(options, true), selected = record(dependencies, [], ["readBundle"]);
    readBundle = selected.readBundle ?? readRuntimeNotificationsBundle;
    if (typeof readBundle !== "function") fail();
    // Acquire all configuration files through one protected directory anchor.
    base = await loadRuntimeMediaEnvironment(directory, { ...originOptions, ...(Object.hasOwn(parameters, "port") ? { port: parameters.port } : {}) }, { readBundle: async (_directory, forwardedOriginOptions) => {
      source = await readBundle(directory, forwardedOriginOptions);
      bundle = record(source, ["database", "authentication", "messaging", "media", "notifications"]);
      return { database: bundle.database, authentication: bundle.authentication, messaging: bundle.messaging, media: bundle.media };
    } });
    notifications = validateRuntimeNotificationsConfiguration(bundle.notifications, originOptions);
    if (notifications.origin !== base.JESSIEMESSAGE_SITE_ORIGIN) fail();
    env = copyRuntimeNotificationsEnvironment({ ...base, JESSIEMESSAGE_ENABLE_NOTIFICATIONS: "1",
      JESSIEMESSAGE_NOTIFICATIONS_KEY: notifications.notificationKey, JESSIEMESSAGE_VAPID_PUBLIC_KEY: notifications.vapidPublicKey,
      JESSIEMESSAGE_VAPID_PRIVATE_KEY: notifications.vapidPrivateKey, JESSIEMESSAGE_VAPID_SUBJECT: notifications.vapidSubject }, { ...originOptions, recovery });
    return env;
  } catch { clearRuntimeMessagingSecrets(env); fail(); }
  finally {
    clearRuntimeMessagingSecrets(base); clearRuntimeMessagingSecrets(notifications);
    if (readBundle === readRuntimeNotificationsBundle && source) {
      for (const name of ["database", "authentication", "messaging", "media", "notifications"]) clearRuntimeMessagingSecrets(Object.getOwnPropertyDescriptor(source, name)?.value);
    }
  }
}
