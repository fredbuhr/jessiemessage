import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { withPrivateDirectory, inspectDirectoryIdentities } from "../server/files/private-directory.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { PRIMARY_SITE_ORIGIN, readRuntimeNotificationsBundle, writeRuntimeDatabaseConfiguration,
  writeRuntimeAuthenticationConfiguration, writeRuntimeMessagingConfiguration, writeRuntimeMediaConfiguration,
  writeRuntimeNotificationsConfiguration, validateRuntimeDatabaseConfiguration, validateRuntimeAuthenticationConfiguration,
  validateRuntimeMessagingConfiguration, validateRuntimeMediaConfiguration, validateRuntimeNotificationsConfiguration,
} from "../server/config/runtime-database-file.mjs";

const REPOSITORY = fileURLToPath(new URL("../", import.meta.url));
const PRIMARY = Object.freeze({ originProfile: "primary" });
const FIELDS = ["sourcePrivateDirectory", "destinationPrivateDirectory", "privatePathMode", "originProfile"];
const RECORDS = ["database", "authentication", "messaging", "media", "notifications"];
const SECRET_FIELDS = ["password", "mfaKey", "mailKey", "messageKey", "mediaKey", "notificationKey", "vapidPrivateKey", "smtpUser", "smtpPassword"];
export class PrimaryOriginCandidateError extends Error {
  constructor() { super("Primary origin candidate preparation was not confirmed."); this.code = "PRIMARY_ORIGIN_CANDIDATE"; }
}
const fail = () => { throw new PrimaryOriginCandidateError(); };
const inside = (filename, root) => { const relative = path.relative(root, filename); return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;
function record(value, fields) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length
    || Object.getOwnPropertyNames(value).sort().join(",") !== [...fields].sort().join(",")) fail();
  return Object.fromEntries(fields.map(name => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
    return [name, descriptor.value];
  }));
}
function cleanDirectory(value) {
  return typeof value === "string" && value.length <= 4096 && value.startsWith("/") && value !== "/"
    && path.resolve(value) === value && !/[\\\x00-\x1f\x7f]/.test(value);
}
function options(value) {
  const selected = record(value, FIELDS);
  if (!cleanDirectory(selected.sourcePrivateDirectory) || !cleanDirectory(selected.destinationPrivateDirectory)
    || selected.privatePathMode !== "linux-dirfd" || selected.originProfile !== "primary"
    || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(path.basename(selected.destinationPrivateDirectory))
    || inside(selected.sourcePrivateDirectory, selected.destinationPrivateDirectory)) fail();
  return selected;
}
export function parseArguments(args) {
  if (!Array.isArray(args) || args.length !== 9 || args[0] !== "prepare") fail();
  const names = new Map([["--source-private-directory", FIELDS[0]], ["--destination-private-directory", FIELDS[1]],
    ["--private-path-mode", FIELDS[2]], ["--origin-profile", FIELDS[3]]]), selected = {};
  for (let index = 1; index < args.length; index += 2) {
    const name = names.get(args[index]), value = args[index + 1];
    if (!name || Object.hasOwn(selected, name) || typeof value !== "string" || value.startsWith("--")) fail();
    selected[name] = value;
  }
  return options(selected);
}
function clear(bundle) {
  if (!bundle || typeof bundle !== "object") return;
  for (const name of RECORDS) {
    const value = Object.getOwnPropertyDescriptor(bundle, name)?.value;
    if (!value || typeof value !== "object") continue;
    for (const field of SECRET_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (descriptor?.writable && Object.hasOwn(descriptor, "value")) value[field] = "";
    }
  }
}
function validatePrimaryBundle(value) {
  let selected;
  try {
    const source = record(value, RECORDS);
    selected = {};
    const validators = [validateRuntimeDatabaseConfiguration, validateRuntimeAuthenticationConfiguration,
      validateRuntimeMessagingConfiguration, validateRuntimeMediaConfiguration, validateRuntimeNotificationsConfiguration];
    for (let index = 0; index < RECORDS.length; index++) selected[RECORDS[index]] = validators[index](source[RECORDS[index]], PRIMARY);
    const keys = [selected.authentication.mfaKey, selected.messaging.mailKey, selected.messaging.messageKey,
      selected.media.mediaKey, selected.notifications.notificationKey, selected.notifications.vapidPrivateKey];
    if (new Set(keys).size !== keys.length || RECORDS.slice(1).some(name => selected[name].origin !== PRIMARY_SITE_ORIGIN)) fail();
    return selected;
  } catch { clear(selected); fail(); }
}
async function visibleIdentity(directory, scope) {
  const anchored = await scope.assertReady();
  const visible = (await inspectDirectoryIdentities(directory)).at(-1);
  if (!sameIdentity(anchored, visible) || await realpath(directory) !== await realpath(scope.path)) fail();
  return anchored;
}
async function outsideCheckout(directory) {
  const actual = await realpath(directory), checkout = await realpath(REPOSITORY), publicRoot = await realpath(path.join(REPOSITORY, "public"));
  const protectedIdentities = await Promise.all([checkout, publicRoot].map(async root => (await inspectDirectoryIdentities(root)).at(-1)));
  const identities = await inspectDirectoryIdentities(directory);
  if (inside(actual, checkout) || inside(checkout, actual)
    || identities.some(identity => protectedIdentities.some(protectedIdentity => sameIdentity(identity, protectedIdentity)))) fail();
  return actual;
}

// This tool performs local file operations only. It does not start an app,
// connect to SQL/SMTP/Push, modify the source, or make the current launcher
// accept the primary origin. A partial candidate after failure stays private.
export async function run(input, { inheritedEnv = process.env, execArgv = process.execArgv,
  readBack = readRuntimeNotificationsBundle } = {}) {
  let source, candidate, read, validated, sourceReadBack;
  try {
    const selected = options(input);
    privateAuthenticationProcessOptions(inheritedEnv, execArgv);
    if (typeof readBack !== "function") fail();
    const sourceDirectory = selected.sourcePrivateDirectory, destination = selected.destinationPrivateDirectory, parent = path.dirname(destination);
    return await withPrivateDirectory(sourceDirectory, async sourceScope => withPrivateDirectory(parent, async parentScope => {
      const actualSource = await outsideCheckout(sourceDirectory), actualParent = await outsideCheckout(parent);
      const actualDestination = path.join(actualParent, path.basename(destination));
      if (inside(actualSource, actualDestination)) fail();
      await visibleIdentity(sourceDirectory, sourceScope); await visibleIdentity(parent, parentScope);
      // One existing anchored read proves all source records and all six key
      // domains before a destination is created. Its default remains recipe.
      source = await readRuntimeNotificationsBundle(sourceDirectory);
      await visibleIdentity(sourceDirectory, sourceScope); await visibleIdentity(parent, parentScope);
      candidate = validatePrimaryBundle(Object.fromEntries(RECORDS.map(name => [name,
        name === "database" ? { ...source[name] } : { ...source[name], origin: PRIMARY_SITE_ORIGIN }])));
      // mkdir is exclusive. A preexisting directory/file/symlink is never
      // adopted, emptied, replaced or partially overwritten.
      await mkdir(parentScope.file(path.basename(destination)), { mode: 0o700 });
      await parentScope.sync();
      return withPrivateDirectory(destination, async destinationScope => {
        const identity = await destinationScope.assertReady();
        const guard = async () => {
          await visibleIdentity(sourceDirectory, sourceScope); await visibleIdentity(parent, parentScope);
          if (!sameIdentity(identity, await visibleIdentity(destination, destinationScope))) fail();
        };
        const writers = [writeRuntimeDatabaseConfiguration, writeRuntimeAuthenticationConfiguration,
          writeRuntimeMessagingConfiguration, writeRuntimeMediaConfiguration, writeRuntimeNotificationsConfiguration];
        for (let index = 0; index < RECORDS.length; index++) {
          await guard();
          const result = await writers[index](destination, candidate[RECORDS[index]], PRIMARY);
          if (Object.getOwnPropertyDescriptor(result ?? {}, "saved")?.value !== true) fail();
          await guard();
        }
        read = await readBack(destination, PRIMARY);
        validated = validatePrimaryBundle(read);
        if (!isDeepStrictEqual(validated, candidate)) fail();
        sourceReadBack = await readRuntimeNotificationsBundle(sourceDirectory);
        if (!isDeepStrictEqual(sourceReadBack, source)) fail();
        await guard(); await destinationScope.sync();
        return { status: "candidate_prepared", originProfile: "primary", filesSaved: 5, keysPreserved: true,
          started: false, migrationPerformed: false, launchApproved: false };
      });
    }));
  } catch { fail(); }
  finally { clear(source); clear(candidate); clear(validated); clear(read); clear(sourceReadBack); }
}
export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  const result = await run(parseArguments(args), dependencies);
  outputStream.write(`${JSON.stringify(result)}\n`);
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch {
    process.stdout.write(`${JSON.stringify({ status: "blocked", started: false, launchApproved: false, code: "PRIMARY_ORIGIN_CANDIDATE" })}\n`);
    process.stderr.write("PRIMARY_ORIGIN_CANDIDATE: Primary origin candidate preparation was not confirmed.\n");
    process.exitCode = 1;
  }
}
