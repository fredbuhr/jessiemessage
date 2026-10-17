import { readRuntimeCrmBundle, validateRuntimeCrmBundle, validateRuntimeCrmConfiguration } from "./runtime-database-file.mjs";
import { NOTIFICATIONS_ENV_FIELDS, copyRuntimeNotificationsEnvironment, loadRuntimeNotificationsEnvironment } from "./runtime-notifications-file.mjs";
import { clearRuntimeMessagingSecrets } from "./runtime-messaging.mjs";
import { PRIMARY_NOTIFICATIONS_RECOVERY_CRM_CONFIG_CHECK_NAMES, inspectPreproductionConfiguration } from "../preflight/config.mjs";

export const CRM_RUNTIME_OPTIONS = Object.freeze({ originProfile: "primary", recovery: true });
export const CRM_ENV_FIELDS = Object.freeze([...NOTIFICATIONS_ENV_FIELDS, "JESSIEMESSAGE_CRM_KEY"]);
export class RuntimeCrmEnvironmentError extends Error {
  constructor() { super("Private CRM environment is unavailable."); this.code = "RUNTIME_CRM_ENVIRONMENT"; }
}
const fail = () => { throw new RuntimeCrmEnvironmentError(); };
function record(value, required, optional = []) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Object.keys(descriptors);
  if (required.some(name => !names.includes(name)) || names.some(name => ![...required, ...optional].includes(name))
    || names.some(name => !Object.hasOwn(descriptors[name], "value"))) fail();
  return Object.fromEntries(names.map(name => [name, descriptors[name].value]));
}
function parameters(value, port = false) {
  const selected = record(value, ["originProfile", "recovery"], port ? ["port"] : []);
  if (selected.originProfile !== "primary" || selected.recovery !== true) fail();
  return selected;
}

/** Only this explicitly selected primary profile owns the two activation flags.
 * Copying it cannot expand the strict field sets of any earlier loader. */
export function copyRuntimeCrmEnvironment(value, options = {}) {
  let selected, base;
  try {
    parameters(options);
    selected = record(value, CRM_ENV_FIELDS);
    if (CRM_ENV_FIELDS.some(name => typeof selected[name] !== "string")
      || selected.JESSIEMESSAGE_ENABLE_CRM !== "1" || selected.JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY !== "1") fail();
    base = copyRuntimeNotificationsEnvironment({ ...Object.fromEntries(NOTIFICATIONS_ENV_FIELDS.map(name => [name, selected[name]])),
      JESSIEMESSAGE_ENABLE_CRM: "0" }, CRM_RUNTIME_OPTIONS);
    const report = inspectPreproductionConfiguration(selected, { expectedOrigin: selected.JESSIEMESSAGE_SITE_ORIGIN,
      target: "messaging-photos-notify-recovery-crm", originProfile: "primary" });
    if (!report.valid || report.checks.length !== PRIMARY_NOTIFICATIONS_RECOVERY_CRM_CONFIG_CHECK_NAMES.length
      || report.checks.some((check, index) => check.name !== PRIMARY_NOTIFICATIONS_RECOVERY_CRM_CONFIG_CHECK_NAMES[index]
        || !["pass", "disabled"].includes(check.status))) fail();
    return { ...base, JESSIEMESSAGE_ENABLE_CRM: "1", JESSIEMESSAGE_CRM_KEY: selected.JESSIEMESSAGE_CRM_KEY };
  } catch { fail(); }
  finally { clearRuntimeMessagingSecrets(selected); clearRuntimeMessagingSecrets(base); }
}

/** Read all six records through one protected anchor. No SQL, network, listener
 * or worker is opened; flags exist only in this profile's owned memory copy. */
export async function loadRuntimeCrmEnvironment(directory, options = {}, dependencies = {}) {
  let source, bundle, base, crm, env, readBundle;
  try {
    const selected = parameters(options, true), supplied = record(dependencies, [], ["readBundle"]);
    readBundle = supplied.readBundle ?? readRuntimeCrmBundle;
    if (typeof readBundle !== "function") fail();
    base = await loadRuntimeNotificationsEnvironment(directory, selected, { readBundle: async (_directory, originOptions) => {
      source = await readBundle(directory, originOptions);
      bundle = validateRuntimeCrmBundle(source, { originProfile: "primary" });
      return Object.fromEntries(["database", "authentication", "messaging", "media", "notifications"].map(name => [name, bundle[name]]));
    } });
    crm = validateRuntimeCrmConfiguration(bundle.crm, { originProfile: "primary" });
    if (crm.origin !== base.JESSIEMESSAGE_SITE_ORIGIN) fail();
    env = copyRuntimeCrmEnvironment({ ...base, JESSIEMESSAGE_ENABLE_CLIENT_RECOVERY: "1", JESSIEMESSAGE_ENABLE_CRM: "1",
      JESSIEMESSAGE_CRM_KEY: crm.crmKey }, CRM_RUNTIME_OPTIONS);
    return env;
  } catch { clearRuntimeMessagingSecrets(env); fail(); }
  finally {
    clearRuntimeMessagingSecrets(base); clearRuntimeMessagingSecrets(crm);
    for (const name of ["database", "authentication", "messaging", "media", "notifications", "crm"])
      clearRuntimeMessagingSecrets(bundle?.[name]);
    if (readBundle === readRuntimeCrmBundle && source) {
      for (const name of ["database", "authentication", "messaging", "media", "notifications", "crm"])
        clearRuntimeMessagingSecrets(Object.getOwnPropertyDescriptor(source, name)?.value);
    }
  }
}
