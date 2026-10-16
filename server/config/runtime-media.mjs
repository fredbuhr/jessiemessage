import { readRuntimeMediaBundle } from "./runtime-database-file.mjs";
import { MESSAGING_ENV_FIELDS, copyRuntimeMessagingEnvironment, loadRuntimeMessagingEnvironment,
  clearRuntimeMessagingSecrets } from "./runtime-messaging.mjs";
import { mediaConfiguration } from "../media/config.mjs";

const MEDIA_FIELDS = ["JESSIEMESSAGE_MEDIA_KEY", "JESSIEMESSAGE_MEDIA_ROOT", "JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES",
  "JESSIEMESSAGE_MEDIA_TOTAL_BYTES", "JESSIEMESSAGE_MEDIA_MIN_FREE_BYTES"];
export const MEDIA_ENV_FIELDS = Object.freeze([...MESSAGING_ENV_FIELDS, ...MEDIA_FIELDS]);
export class RuntimeMediaEnvironmentError extends Error {
  constructor() { super("Private photo environment is unavailable."); this.code = "RUNTIME_MEDIA_ENVIRONMENT"; }
}
const fail = () => { throw new RuntimeMediaEnvironmentError(); };
function record(value, fields, optional = []) {
  const names = value && Object.getOwnPropertyNames(value);
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length
    || fields.some(name => !names.includes(name)) || names.some(name => ![...fields, ...optional].includes(name))) fail();
  return Object.fromEntries(names.map((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
    return [name, descriptor.value];
  }));
}

export function copyRuntimeMediaEnvironment(value) {
  let selected, base, configuration;
  try {
    selected = record(value, MEDIA_ENV_FIELDS);
    if (MEDIA_ENV_FIELDS.some((name) => typeof selected[name] !== "string") || selected.JESSIEMESSAGE_ENABLE_MEDIA !== "1") fail();
    base = copyRuntimeMessagingEnvironment({ ...Object.fromEntries(MESSAGING_ENV_FIELDS.map((name) => [name, selected[name]])),
      JESSIEMESSAGE_ENABLE_MEDIA: "0" });
    configuration = mediaConfiguration(selected);
    if (configuration.enabled !== true) fail();
    return { ...base, ...Object.fromEntries(MEDIA_FIELDS.map((name) => [name, selected[name]])), JESSIEMESSAGE_ENABLE_MEDIA: "1" };
  } catch { fail(); }
  finally {
    clearRuntimeMessagingSecrets(base); clearRuntimeMessagingSecrets(selected); configuration?.key.fill(0);
  }
}

export async function loadRuntimeMediaEnvironment(directory, options = {}, dependencies = {}) {
  let source, bundle, base, env, media, readBundle;
  try {
    const selected = record(dependencies, [], ["readBundle"]);
    readBundle = selected.readBundle ?? readRuntimeMediaBundle;
    if (typeof readBundle !== "function") fail();
    // One anchored read supplies both profiles; the text loader retains all of
    // its strict flag, origin, key separation and database validation.
    base = await loadRuntimeMessagingEnvironment(directory, options, {
      readBundle: async () => {
        source = await readBundle(directory);
        bundle = record(source, ["database", "authentication", "messaging", "media"]);
        return { database: bundle.database, authentication: bundle.authentication, messaging: bundle.messaging };
      } });
    const { validateRuntimeMediaConfiguration } = await import("./runtime-database-file.mjs");
    media = validateRuntimeMediaConfiguration(bundle.media);
    if (media.origin !== base.JESSIEMESSAGE_SITE_ORIGIN) fail();
    env = copyRuntimeMediaEnvironment({ ...base, JESSIEMESSAGE_ENABLE_MEDIA: "1", JESSIEMESSAGE_MEDIA_KEY: media.mediaKey,
      JESSIEMESSAGE_MEDIA_ROOT: media.mediaRoot, JESSIEMESSAGE_MEDIA_ACCOUNT_BYTES: media.ownerBytes,
      JESSIEMESSAGE_MEDIA_TOTAL_BYTES: media.totalBytes, JESSIEMESSAGE_MEDIA_MIN_FREE_BYTES: media.minimumFreeBytes });
    return env;
  } catch { clearRuntimeMessagingSecrets(env); fail(); }
  finally {
    clearRuntimeMessagingSecrets(base); clearRuntimeMessagingSecrets(media);
    if (readBundle === readRuntimeMediaBundle && source) {
      for (const name of ["database", "authentication", "messaging", "media"]) clearRuntimeMessagingSecrets(Object.getOwnPropertyDescriptor(source, name)?.value);
    }
  }
}
