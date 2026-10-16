import { authConfiguration } from "../auth/config.mjs";
import { accessConfiguration } from "../access/config.mjs";
import { chatConfiguration } from "../chat/config.mjs";
import { mediaConfiguration } from "../media/config.mjs";
import { crmConfiguration } from "../crm/config.mjs";
import { clientRecoveryConfiguration } from "../reset/config.mjs";
import { broadcastConfiguration } from "../broadcast/config.mjs";
import { loadNotificationsConfig } from "../notifications/config.mjs";
import { mailConfiguration } from "../mail/config.mjs";
import { runtimeDatabaseOptions } from "../db/runtime.mjs";
import { SITE_DOMAIN, isOfficialOrigin } from "../site.mjs";

export const CONFIG_CHECK_NAMES = Object.freeze([
  "feature_flags", "authentication", "mail", "client_access", "chat", "media", "crm", "client_recovery", "broadcasts", "notifications",
  "key_separation", "runtime_database", "database_tls", "official_subdomain", "auth_only", "port",
]);
export const MESSAGING_CONFIG_CHECK_NAMES = Object.freeze(CONFIG_CHECK_NAMES.map((name) => name === "auth_only" ? "messaging_text" : name));
export const NOTIFICATIONS_CONFIG_CHECK_NAMES = Object.freeze(CONFIG_CHECK_NAMES.map((name) => name === "auth_only" ? "messaging_photos_notify" : name));

const TARGET = "auth-only";
const FLAGS = Object.freeze([
  "JESSIEMESSAGE_ENABLE_AUTH", "JESSIEMESSAGE_ENABLE_MAIL_DELIVERY", "JESSIEMESSAGE_ENABLE_ACCESS", "JESSIEMESSAGE_ENABLE_CHAT",
  "JESSIEMESSAGE_ENABLE_MEDIA", "JESSIEMESSAGE_ENABLE_CRM", "JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY", "JESSIEMESSAGE_ENABLE_BROADCAST", "JESSIEMESSAGE_ENABLE_NOTIFICATIONS",
]);
const DATABASE_FIELDS = Object.freeze([
  "JESSIEMESSAGE_DB_NAME", "JESSIEMESSAGE_APPLICATION_DATABASE", "JESSIEMESSAGE_DB_HOST", "JESSIEMESSAGE_DB_PORT",
  "JESSIEMESSAGE_RUNTIME_DB_USER", "JESSIEMESSAGE_RUNTIME_DB_PASSWORD", "JESSIEMESSAGE_DB_USER",
  "JESSIEMESSAGE_DB_ALLOW_INSECURE_LOCAL", "JESSIEMESSAGE_DB_TLS_CA_PATH",
]);

// Copy data properties without invoking caller-supplied accessors. No input
// value, validator result, error or path becomes part of the returned report.
function dataRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
  const copy = Object.create(null);
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!Object.hasOwn(descriptor, "value")) throw new TypeError();
    copy[name] = descriptor.value;
  }
  return copy;
}

function report(statuses, target = TARGET) {
  const names = target === "messaging-text" ? MESSAGING_CONFIG_CHECK_NAMES
    : target === "messaging-photos-notify" ? NOTIFICATIONS_CONFIG_CHECK_NAMES : CONFIG_CHECK_NAMES;
  return Object.freeze({
    target: ["messaging-text", "messaging-photos-notify"].includes(target) ? target : TARGET,
    valid: names.every((name) => statuses[name] !== "fail"),
    checks: Object.freeze(names.map((name) => Object.freeze({ name, status: statuses[name] }))),
  });
}

export function inspectPreproductionConfiguration(env = {}, options = {}) {
  const statuses = Object.fromEntries(CONFIG_CHECK_NAMES.map((name) => [name, "not_checked"]));
  let source, parameters;
  try { source = dataRecord(env); parameters = dataRecord(options); }
  catch {
    statuses.feature_flags = "fail";
    statuses.auth_only = "fail";
    return report(statuses);
  }
  // The existing origin validators use URL conversion. A runtime environment
  // supplies strings, so reject other types without invoking their toString.
  if (typeof source.JESSIEMESSAGE_SITE_ORIGIN !== "string") source.JESSIEMESSAGE_SITE_ORIGIN = undefined;
  const target = parameters.target === undefined ? TARGET : parameters.target;
  const validFlags = FLAGS.every((name) => source[name] === undefined || source[name] === "0" || source[name] === "1")
    && Object.keys(source).every((name) => !name.startsWith("JESSIEMESSAGE_ENABLE_") || FLAGS.includes(name));
  statuses.feature_flags = validFlags ? "pass" : "fail";

  const configurations = Object.create(null);
  const validate = (name, validator) => {
    try {
      const configuration = validator();
      if (configuration.enabled !== true && configuration.enabled !== false) throw new TypeError();
      configurations[name] = configuration;
      statuses[name] = configuration.enabled ? "pass" : "disabled";
    } catch { statuses[name] = "fail"; }
  };
  validate("authentication", () => authConfiguration(source));
  validate("mail", () => mailConfiguration(source));
  validate("client_access", () => accessConfiguration(source));
  validate("chat", () => chatConfiguration(source));
  validate("media", () => mediaConfiguration(source));
  validate("crm", () => crmConfiguration(source));
  validate("client_recovery", () => clientRecoveryConfiguration(source));
  validate("broadcasts", () => broadcastConfiguration(source, { crmEnabled: configurations.crm?.enabled === true }));
  validate("notifications", () => loadNotificationsConfig(source));

  // Recovery deliberately shares the mail key and broadcasts the message key.
  // Only independently configured, active keys belong in this comparison.
  const keySources = [["authentication", FLAGS[0], "totpKey"], ["mail", FLAGS[1], "key"],
    ["chat", FLAGS[3], "key"], ["media", FLAGS[4], "key"], ["crm", FLAGS[5], "key"], ["notifications", FLAGS[8], "key"]];
  if (keySources.every(([name, flag]) => source[flag] !== "1" || statuses[name] === "pass")) {
    const keys = keySources.flatMap(([name, , field]) => configurations[name]?.enabled ? [configurations[name][field]] : []);
    statuses.key_separation = keys.length < 2 ? "disabled"
      : keys.every((key, index) => keys.slice(index + 1).every((other) => !key.equals(other))) ? "pass" : "fail";
  }

  try {
    // Runtime environments contain strings. Guard these before the real
    // validator's numeric conversion, without broadening its TLS exceptions.
    if (!DATABASE_FIELDS.every((name) => source[name] === undefined || typeof source[name] === "string")) throw new TypeError();
    const database = runtimeDatabaseOptions(source);
    statuses.runtime_database = "pass";
    statuses.database_tls = database.ssl?.rejectUnauthorized === true && database.ssl?.minVersion === "TLSv1.2" ? "pass" : "fail";
  } catch { statuses.runtime_database = "fail"; }

  try {
    const expected = parameters.expectedOrigin;
    if (typeof expected !== "string") throw new TypeError();
    const url = new URL(expected);
    statuses.official_subdomain = isOfficialOrigin(expected) && url.hostname !== SITE_DOMAIN
      && url.hostname !== `www.${SITE_DOMAIN}` && source.JESSIEMESSAGE_SITE_ORIGIN === expected ? "pass" : "fail";
  } catch { statuses.official_subdomain = "fail"; }
  statuses.auth_only = target === TARGET && validFlags && source.JESSIEMESSAGE_ENABLE_AUTH === "1"
    && FLAGS.slice(1).every((name) => source[name] === undefined || source[name] === "0") ? "pass" : "fail";
  statuses.messaging_text = target === "messaging-text" && validFlags
    && FLAGS.slice(0, 4).every((name) => source[name] === "1")
    && FLAGS.slice(4).every((name) => source[name] === "0") ? "pass" : "fail";
  statuses.messaging_photos_notify = target === "messaging-photos-notify" && validFlags
    && [0, 1, 2, 3, 4, 8].every((index) => source[FLAGS[index]] === "1")
    && [5, 6, 7].every((index) => source[FLAGS[index]] === "0") ? "pass" : "fail";
  const port = source.PORT;
  if (port !== undefined) statuses.port = typeof port === "string" && /^[1-9][0-9]{0,4}$/.test(port) && Number(port) <= 65535 ? "pass" : "fail";
  return report(statuses, target);
}
