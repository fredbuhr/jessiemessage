import { readRuntimeVideoBundle, validateRuntimeVideoBundle, validateRuntimeVideoConfiguration } from "./runtime-database-file.mjs";
import { BROADCAST_RUNTIME_OPTIONS, copyRuntimeBroadcastEnvironment, loadRuntimeBroadcastEnvironment } from "./runtime-broadcast.mjs";
import { CRM_ENV_FIELDS } from "./runtime-crm.mjs";
import { clearRuntimeMessagingSecrets } from "./runtime-messaging.mjs";
import { relative, isAbsolute, sep } from "node:path";

export const VIDEO_RUNTIME_OPTIONS = BROADCAST_RUNTIME_OPTIONS;
const VIDEO_FIELDS = ["JESSIEMESSAGE_VIDEO_KEY", "JESSIEMESSAGE_VIDEO_ROOT", "JESSIEMESSAGE_VIDEO_OWNER_BYTES",
  "JESSIEMESSAGE_VIDEO_TOTAL_BYTES", "JESSIEMESSAGE_VIDEO_MINIMUM_FREE_BYTES"];
export const VIDEO_ENV_FIELDS = Object.freeze([...CRM_ENV_FIELDS, ...VIDEO_FIELDS]);
export class RuntimeVideoEnvironmentError extends Error {
  constructor() { super("Private video environment is unavailable."); this.code = "RUNTIME_VIDEO_ENVIRONMENT"; }
}
const fail = () => { throw new RuntimeVideoEnvironmentError(); };
const names = ["database", "authentication", "messaging", "media", "notifications", "crm", "video"];
const contains = (a, b) => { const value = relative(a, b); return value === "" || value !== ".." && !value.startsWith(".." + sep) && !isAbsolute(value); };
function record(value, required, optional = []) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value), supplied = Object.keys(descriptors);
  if (required.some(name => !supplied.includes(name)) || supplied.some(name => ![...required, ...optional].includes(name)
    || !Object.hasOwn(descriptors[name], "value"))) fail();
  return Object.fromEntries(supplied.map(name => [name, descriptors[name].value]));
}
function options(value, port = false) {
  const selected = record(value, ["originProfile", "recovery"], port ? ["port"] : []);
  if (selected.originProfile !== "primary" || selected.recovery !== true) fail();
  return selected;
}

/** Explicit candidate only. Loading this environment never starts a producer,
 * runs migrations or widens the closed six-record broadcast environment. */
export function copyRuntimeVideoEnvironment(value, parameters = {}) {
  let selected, base, video;
  try {
    options(parameters);
    selected = record(value, VIDEO_ENV_FIELDS);
    if (VIDEO_ENV_FIELDS.some(name => typeof selected[name] !== "string")) fail();
    base = copyRuntimeBroadcastEnvironment(Object.fromEntries(CRM_ENV_FIELDS.map(name => [name, selected[name]])), VIDEO_RUNTIME_OPTIONS);
    video = validateRuntimeVideoConfiguration({ format: "jessiemessage-runtime-video", version: 1,
      origin: base.JESSIEMESSAGE_SITE_ORIGIN, videoKey: selected.JESSIEMESSAGE_VIDEO_KEY, videoRoot: selected.JESSIEMESSAGE_VIDEO_ROOT,
      ownerBytes: selected.JESSIEMESSAGE_VIDEO_OWNER_BYTES, totalBytes: selected.JESSIEMESSAGE_VIDEO_TOTAL_BYTES,
      minimumFreeBytes: selected.JESSIEMESSAGE_VIDEO_MINIMUM_FREE_BYTES }, { originProfile: "primary" });
    if (["JESSIEMESSAGE_MFA_KEY", "JESSIEMESSAGE_MAIL_KEY", "JESSIEMESSAGE_MESSAGE_KEY", "JESSIEMESSAGE_MEDIA_KEY",
      "JESSIEMESSAGE_NOTIFICATIONS_KEY", "JESSIEMESSAGE_VAPID_PRIVATE_KEY", "JESSIEMESSAGE_CRM_KEY"]
      .some(name => base[name] === video.videoKey) || contains(base.JESSIEMESSAGE_MEDIA_ROOT, video.videoRoot)
      || contains(video.videoRoot, base.JESSIEMESSAGE_MEDIA_ROOT)) fail();
    return { ...base, ...Object.fromEntries(VIDEO_FIELDS.map(name => [name, selected[name]])) };
  } catch { fail(); }
  finally { clearRuntimeMessagingSecrets(selected); clearRuntimeMessagingSecrets(base); clearRuntimeMessagingSecrets(video); }
}

export async function loadRuntimeVideoEnvironment(directory, parameters = {}, dependencies = {}) {
  let bundle, source, base, result, readBundle;
  try {
    const selected = options(parameters, true), internal = record(dependencies, [], ["readBundle"]);
    readBundle = internal.readBundle ?? readRuntimeVideoBundle;
    if (typeof readBundle !== "function") fail();
    base = await loadRuntimeBroadcastEnvironment(directory, selected, { readBundle: async (_directory, originOptions) => {
      source = await readBundle(directory, originOptions);
      bundle = validateRuntimeVideoBundle(source, { originProfile: "primary" });
      return Object.fromEntries(names.slice(0, -1).map(name => [name, bundle[name]]));
    } });
    result = copyRuntimeVideoEnvironment({ ...base, JESSIEMESSAGE_VIDEO_KEY: bundle.video.videoKey,
      JESSIEMESSAGE_VIDEO_ROOT: bundle.video.videoRoot, JESSIEMESSAGE_VIDEO_OWNER_BYTES: bundle.video.ownerBytes,
      JESSIEMESSAGE_VIDEO_TOTAL_BYTES: bundle.video.totalBytes,
      JESSIEMESSAGE_VIDEO_MINIMUM_FREE_BYTES: bundle.video.minimumFreeBytes }, VIDEO_RUNTIME_OPTIONS);
    return result;
  } catch { clearRuntimeMessagingSecrets(result); fail(); }
  finally {
    clearRuntimeMessagingSecrets(base);
    for (const name of names) clearRuntimeMessagingSecrets(bundle?.[name]);
    if (readBundle === readRuntimeVideoBundle) for (const name of names) clearRuntimeMessagingSecrets(Object.getOwnPropertyDescriptor(source ?? {}, name)?.value);
  }
}
