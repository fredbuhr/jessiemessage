import { CRM_ENV_FIELDS, CRM_RUNTIME_OPTIONS, loadRuntimeCrmEnvironment, copyRuntimeCrmEnvironment } from "./runtime-crm.mjs";
import { clearRuntimeMessagingSecrets } from "./runtime-messaging.mjs";
import { PRIMARY_BROADCAST_CONFIG_CHECK_NAMES, inspectPreproductionConfiguration } from "../preflight/config.mjs";

export const BROADCAST_RUNTIME_OPTIONS = CRM_RUNTIME_OPTIONS;
export class RuntimeBroadcastEnvironmentError extends Error {
  constructor() { super("Private broadcast environment is unavailable."); this.code = "RUNTIME_BROADCAST_ENVIRONMENT"; }
}
const fail = () => { throw new RuntimeBroadcastEnvironmentError(); };

/** Broadcasts reuse the message key with a separate authenticated purpose.
 * Only this selected profile owns the extra flag; earlier loaders stay closed. */
export function copyRuntimeBroadcastEnvironment(value, options = {}) {
  let selected, base, result;
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail();
    const fields = Object.getOwnPropertyDescriptors(value), names = Object.keys(fields);
    if (names.length !== CRM_ENV_FIELDS.length || names.some(name => !CRM_ENV_FIELDS.includes(name)
      || !Object.hasOwn(fields[name], "value"))) fail();
    selected = Object.fromEntries(names.map(name => [name, fields[name].value]));
    if (selected.JESSIEMESSAGE_ENABLE_BROADCAST !== "1") fail();
    base = copyRuntimeCrmEnvironment({ ...selected, JESSIEMESSAGE_ENABLE_BROADCAST: "0" }, options);
    result = { ...base, JESSIEMESSAGE_ENABLE_BROADCAST: "1" };
    const report = inspectPreproductionConfiguration(result, { expectedOrigin: result.JESSIEMESSAGE_SITE_ORIGIN,
      target: "messaging-photos-notify-recovery-crm-broadcast", originProfile: "primary" });
    if (!report.valid || report.checks.length !== PRIMARY_BROADCAST_CONFIG_CHECK_NAMES.length
      || report.checks.some((check, index) => check.name !== PRIMARY_BROADCAST_CONFIG_CHECK_NAMES[index]
        || !["pass", "disabled"].includes(check.status))) fail();
    return result;
  } catch { clearRuntimeMessagingSecrets(result); fail(); }
  finally { clearRuntimeMessagingSecrets(selected); clearRuntimeMessagingSecrets(base); }
}

/** The same six anchored files and keys, with no configuration write, SQL,
 * listener or delivery. Activation exists only in this owned memory copy. */
export async function loadRuntimeBroadcastEnvironment(directory, options = {}, dependencies = {}) {
  let source;
  try {
    source = await loadRuntimeCrmEnvironment(directory, options, dependencies);
    return copyRuntimeBroadcastEnvironment({ ...source, JESSIEMESSAGE_ENABLE_BROADCAST: "1" }, BROADCAST_RUNTIME_OPTIONS);
  } catch { fail(); }
  finally { clearRuntimeMessagingSecrets(source); }
}
