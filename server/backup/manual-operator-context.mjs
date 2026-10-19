import { createHash, createHmac } from "node:crypto";
import { resolve, relative, sep, join } from "node:path";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { createPrivateJsonStore } from "../files/private-json.mjs";
import { privateAuthenticationProcessOptions } from "../config/private-auth-environment.mjs";
import { loadRuntimeBroadcastEnvironment, BROADCAST_RUNTIME_OPTIONS } from "../config/runtime-broadcast.mjs";
import { clearRuntimeMessagingSecrets } from "../config/runtime-messaging.mjs";
import { mediaConfiguration } from "../media/config.mjs";
import { createMediaStorage } from "../media/storage.mjs";
import { captureOperationalState, operationalStateHash } from "./operational-checkpoint.mjs";
import { assertRuntimeSource } from "./recurring-supervisor.mjs";

const FIELDS = ["version", "runtimeDirectory", "runtimeHead", "runtimeTree", "sourcePrivateDirectory", "sourceOperationsDirectory", "checkpointDirectory",
  "targetPrivateDirectory", "targetDatabase", "importUser", "sqlSha256", "registrySha256"];
const PATHS = ["runtimeDirectory", "sourcePrivateDirectory", "sourceOperationsDirectory", "checkpointDirectory", "targetPrivateDirectory"];
const KEYS = { totpKey: "JESSIEMESSAGE_MFA_KEY", mailKey: "JESSIEMESSAGE_MAIL_KEY", messageKey: "JESSIEMESSAGE_MESSAGE_KEY",
  mediaKey: "JESSIEMESSAGE_MEDIA_KEY", crmKey: "JESSIEMESSAGE_CRM_KEY", notificationKey: "JESSIEMESSAGE_NOTIFICATIONS_KEY" };
const HEX = /^[a-f0-9]{64}$/, GIT = /^[a-f0-9]{40}$/;

export class ManualOperatorContextError extends Error {
  constructor(suffix = "UNAVAILABLE") {
    super("Manual operator configuration could not be verified."); this.name = "ManualOperatorContextError";
    this.code = `MANUAL_OPERATOR_CONTEXT_${suffix}`;
  }
}
const fail = suffix => { throw new ManualOperatorContextError(suffix); };
const cleanPath = value => typeof value === "string" && value.length > 1 && value.length <= 4096 && value.startsWith("/")
  && resolve(value) === value && !/[\\\x00-\x1f\x7f]/.test(value);
const inside = (name, root) => { const suffix = relative(root, name); return suffix === "" || suffix !== ".." && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep); };
const overlap = (a, b) => inside(a, b) || inside(b, a);
const jobHash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const configurationHash = (env, key) => createHmac("sha256", key).update("jessiemessage:manual-operator:configuration:v1:\0")
  .update(JSON.stringify(Object.fromEntries(Object.keys(env).sort().map(name => [name, env[name]])))).digest("hex");

function validateJob(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== FIELDS.length
    || FIELDS.some(name => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name) ?? {}, "value"))) fail("INPUT");
  if (value.version !== 1 || PATHS.some(name => !cleanPath(value[name]))
    || ["runtimeHead", "runtimeTree", "targetDatabase", "importUser", "sqlSha256", "registrySha256"].some(name => typeof value[name] !== "string")
    || !GIT.test(value.runtimeHead ?? "") || !GIT.test(value.runtimeTree ?? "")
    || !/^[A-Za-z0-9_]{1,64}$/.test(value.targetDatabase ?? "") || !/^[A-Za-z0-9_]{1,80}$/.test(value.importUser ?? "")
    || !HEX.test(value.sqlSha256 ?? "") || !HEX.test(value.registrySha256 ?? "")) fail("INPUT");
  return { ...value };
}

/** Read an explicitly selected manual job and both existing six-file bundles.
 * This context opens no database, listener or producer and creates no path. */
export async function loadManualOperatorContext(operatorDirectory, { environment = process.env, signal } = {}, internal = {}) {
  const withDirectory = internal.withDirectory ?? withPrivateDirectory;
  const load = internal.loadEnvironment ?? loadRuntimeBroadcastEnvironment;
  const makeStorage = internal.makeStorage ?? createMediaStorage;
  const captureRegistry = internal.captureRegistry ?? captureOperationalState;
  const assertSource = internal.assertSource ?? assertRuntimeSource;
  let sourceEnvironment, targetEnvironment, sourceMedia, storage, rootFingerprint, closed = false;
  const keys = {};
  const active = () => { if (closed || signal?.aborted) fail("ABORTED"); };
  function close() {
    if (closed) return;
    closed = true; storage = null;
    for (const key of Object.values(keys)) key.fill(0);
    sourceMedia?.key?.fill(0); rootFingerprint?.fill(0);
    clearRuntimeMessagingSecrets(sourceEnvironment); clearRuntimeMessagingSecrets(targetEnvironment);
  }
  try {
    active(); if (!cleanPath(operatorDirectory)) fail("INPUT");
    const parameters = { ...privateAuthenticationProcessOptions(environment, []), ...BROADCAST_RUNTIME_OPTIONS };
    const jobFile = createPrivateJsonStore({ name: "job.json", lock: "job.lock", maxBytes: 32768,
      validate: validateJob, empty: () => { fail("INPUT"); },
      fail: code => fail(({ input: "INPUT", changed: "CHANGED" })[code] ?? "UNAVAILABLE"),
      isKnownError: error => error instanceof ManualOperatorContextError });
    const readJob = () => jobFile.read(operatorDirectory, { withDirectory });
    const job = Object.freeze(await readJob()), selectedJobSha256 = jobHash(job);
    if (PATHS.some(name => overlap(operatorDirectory, job[name])) || overlap(job.sourcePrivateDirectory, job.targetPrivateDirectory)) fail("INPUT");
    const targetDirectory = join(operatorDirectory, "target"), paths = Object.freeze({ targetDirectory, rootPath: join(targetDirectory, "media"),
      journalDirectory: join(targetDirectory, "operations"), progressDirectory: join(targetDirectory, "progress"), quarantineDirectory: join(targetDirectory, "quarantine") });
    const assertPinnedSource = () => assertSource({ runtimeDirectory: job.runtimeDirectory, runtimeHead: job.runtimeHead, runtimeTree: job.runtimeTree }, { signal });
    await assertPinnedSource(); active();
    sourceEnvironment = await load(job.sourcePrivateDirectory, parameters); active();
    targetEnvironment = await load(job.targetPrivateDirectory, parameters); active();
    if (targetEnvironment.JESSIEMESSAGE_DB_NAME !== job.targetDatabase || typeof sourceEnvironment.JESSIEMESSAGE_DB_NAME !== "string"
      || sourceEnvironment.JESSIEMESSAGE_DB_NAME.toLowerCase() === job.targetDatabase.toLowerCase()
      || targetEnvironment.JESSIEMESSAGE_MEDIA_ROOT !== paths.rootPath || job.importUser === sourceEnvironment.JESSIEMESSAGE_RUNTIME_DB_USER
      || ["JESSIEMESSAGE_DB_HOST", "JESSIEMESSAGE_DB_PORT", "JESSIEMESSAGE_SITE_ORIGIN"].some(name => targetEnvironment[name] !== sourceEnvironment[name])) fail("CONFIGURATION");
    for (const [name, field] of Object.entries(KEYS)) {
      const encoded = sourceEnvironment[field];
      if (typeof encoded !== "string" || targetEnvironment[field] !== encoded) fail("CONFIGURATION");
      keys[name] = Buffer.from(encoded, "base64url");
      if (keys[name].length !== 32 || keys[name].toString("base64url") !== encoded) fail("CONFIGURATION");
    }
    sourceMedia = mediaConfiguration(sourceEnvironment);
    if (sourceMedia.enabled !== true || !cleanPath(sourceMedia.root) || overlap(operatorDirectory, sourceMedia.root)) fail("CONFIGURATION");
    storage = await makeStorage({ root: sourceMedia.root, key: sourceMedia.key, pathMode: "linux-dirfd" });
    let observed;
    try {
      observed = await storage.fingerprint();
      if (!Buffer.isBuffer(observed) || observed.length !== 32) fail("CONFIGURATION");
      rootFingerprint = Buffer.from(observed);
    } finally { observed?.fill(0); }
    const sourceBinding = Object.freeze({ database: sourceEnvironment.JESSIEMESSAGE_DB_NAME, rootFingerprint: rootFingerprint.toString("hex") });
    const sourceHash = configurationHash(sourceEnvironment, keys.crmKey), targetHash = configurationHash(targetEnvironment, keys.crmKey);
    const jobSha256 = jobHash({ job, sourceConfigurationSha256: sourceHash, targetConfigurationSha256: targetHash });
    const readRegistry = () => withDirectory(job.sourceOperationsDirectory, scope => captureRegistry(scope, { key: keys.crmKey, binding: sourceBinding, signal }));
    const recentRegistry = await readRegistry();
    if (operationalStateHash(recentRegistry) !== job.registrySha256) fail("REGISTRY");
    const importSelection = Object.freeze({ command: "check", privateDirectory: job.sourcePrivateDirectory, privatePathMode: "linux-dirfd",
      checkpointDirectory: job.checkpointDirectory, database: job.targetDatabase, confirmation: job.targetDatabase,
      user: job.importUser, profile: "photos-notify-recovery-crm-broadcast", sqlSha256: job.sqlSha256 });
    async function assertReady() {
      let currentSource, currentTarget, fingerprint;
      try {
        active(); if (jobHash(await readJob()) !== selectedJobSha256) fail("CHANGED");
        await assertPinnedSource(); active();
        currentSource = await load(job.sourcePrivateDirectory, parameters); active();
        currentTarget = await load(job.targetPrivateDirectory, parameters); active();
        if (configurationHash(currentSource, keys.crmKey) !== sourceHash || configurationHash(currentTarget, keys.crmKey) !== targetHash) fail("CHANGED");
        fingerprint = await storage.fingerprint();
        if (!Buffer.isBuffer(fingerprint) || !fingerprint.equals(rootFingerprint) || operationalStateHash(await readRegistry()) !== job.registrySha256) fail("CHANGED");
        active();
      } catch (error) {
        if (signal?.aborted || closed) fail("ABORTED");
        if (error instanceof ManualOperatorContextError) throw error;
        fail("UNAVAILABLE");
      } finally { fingerprint?.fill(0); clearRuntimeMessagingSecrets(currentSource); clearRuntimeMessagingSecrets(currentTarget); }
    }
    await assertReady(); active();
    return Object.freeze({ job, jobSha256, paths, sourceEnvironment, targetEnvironment, keys, sourceBinding, recentRegistry, importSelection, assertReady, close });
  } catch (error) {
    close();
    if (signal?.aborted) fail("ABORTED");
    if (error instanceof ManualOperatorContextError) throw error;
    fail("UNAVAILABLE");
  }
}
