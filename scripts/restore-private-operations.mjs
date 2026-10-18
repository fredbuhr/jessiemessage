import { lstat, mkdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { loadRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { backupIdentity, assertCloneIdentity } from "../server/backup/manifest.mjs";
import { readCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";
import { captureOperationalState, readOperationalCheckpoint, operationalStateHash, planOperationalRestore,
  restoreOperationalQuarantine, OperationalCheckpointError } from "../server/backup/operational-checkpoint.mjs";

const REPOSITORY = resolve(fileURLToPath(new URL("../", import.meta.url)));
const FIELDS = ["command", "privateDirectory", "operationsDirectory", "checkpointDirectory", "destination", "database", "mediaRoot"];
const FLAGS = new Map([["--private-directory", "privateDirectory"], ["--operations-directory", "operationsDirectory"],
  ["--checkpoint-directory", "checkpointDirectory"], ["--destination-private-directory", "destination"],
  ["--database", "database"], ["--media-root", "mediaRoot"], ["--confirm-current-sha256", "currentSha256"]]);
const fail = code => { throw new OperationalCheckpointError(code); };
const inside = (value, root) => { const suffix = relative(root, value); return suffix === "" || suffix !== ".." && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep); };
const path = value => typeof value === "string" && value.startsWith("/") && value !== "/" && resolve(value) === value
  && value.length <= 4096 && !/[\\\x00-\x1f\x7f]/.test(value) && !inside(value, REPOSITORY);
export function parseArguments(args) {
  if (!Array.isArray(args) || !["check", "restore"].includes(args[0]) || args.length !== (args[0] === "check" ? 13 : 15)) fail("OPERATIONS_USAGE");
  const result = { command: args[0] };
  for (let index = 1; index < args.length; index += 2) {
    const name = FLAGS.get(args[index]);
    if (!name || Object.hasOwn(result, name) || typeof args[index + 1] !== "string") fail("OPERATIONS_USAGE");
    result[name] = args[index + 1];
  }
  if (FIELDS.some(name => !Object.hasOwn(result, name)) || !/^[a-zA-Z0-9_]{1,64}$/.test(result.database)
    || ["privateDirectory", "operationsDirectory", "checkpointDirectory", "destination", "mediaRoot"].some(name => !path(result[name]))
    || result.command === "restore" && !/^[a-f0-9]{64}$/.test(result.currentSha256 ?? "")
    || result.command === "check" && Object.hasOwn(result, "currentSha256")) fail("OPERATIONS_USAGE");
  for (const name of ["privateDirectory", "operationsDirectory", "checkpointDirectory", "mediaRoot"])
    if (inside(result.destination, result[name]) || inside(result[name], result.destination)) fail("OPERATIONS_USAGE");
  if (inside(result.operationsDirectory, result.privateDirectory) || inside(result.privateDirectory, result.operationsDirectory)
    || inside(result.operationsDirectory, result.checkpointDirectory)) fail("OPERATIONS_USAGE");
  return result;
}
export async function run(value, { inheritedEnv = process.env, execArgv = process.execArgv, signal,
  scopeOperation = withPrivateDirectory, loadEnvironment = loadRuntimeBroadcastEnvironment, makeStorage = createMediaStorage,
  readReceipt = readCheckpointReceipt, readOperations = readOperationalCheckpoint, capture = captureOperationalState,
  identity = backupIdentity, assertIdentity = assertCloneIdentity } = {}) {
  let env, key, mediaKey;
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(name => ![...FIELDS, "currentSha256"].includes(name)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), "value"))) fail("OPERATIONS_USAGE");
    const selected = parseArguments([value.command, ...[...FLAGS].filter(([_flag, name]) => Object.hasOwn(value, name)).flatMap(([flag, name]) => [flag, value[name]])]);
    const processOptions = privateAuthenticationProcessOptions(inheritedEnv, execArgv);
    const active = () => { if (signal?.aborted) fail("OPERATIONS_ABORTED"); };
    active(); env = await loadEnvironment(selected.privateDirectory, { port: processOptions.port, originProfile: "primary", recovery: true });
    if (selected.database.toLowerCase() === env.JESSIEMESSAGE_DB_NAME.toLowerCase()) fail("OPERATIONS_SOURCE_TARGET");
    if (inside(selected.mediaRoot, env.JESSIEMESSAGE_MEDIA_ROOT) || inside(env.JESSIEMESSAGE_MEDIA_ROOT, selected.mediaRoot)
      || inside(selected.destination, env.JESSIEMESSAGE_MEDIA_ROOT) || inside(env.JESSIEMESSAGE_MEDIA_ROOT, selected.destination)) fail("OPERATIONS_SOURCE_TARGET");
    key = Buffer.from(env.JESSIEMESSAGE_CRM_KEY, "base64url"); mediaKey = Buffer.from(env.JESSIEMESSAGE_MEDIA_KEY, "base64url");
    const source = await makeStorage({ root: env.JESSIEMESSAGE_MEDIA_ROOT, key: mediaKey, pathMode: "linux-dirfd" });
    const target = await makeStorage({ root: selected.mediaRoot, key: mediaKey, pathMode: "linux-dirfd" });
    const sourceIdentity = await identity({ databaseName: env.JESSIEMESSAGE_DB_NAME, rootPath: env.JESSIEMESSAGE_MEDIA_ROOT, storage: source, mediaKey });
    const targetIdentity = await identity({ databaseName: selected.database, rootPath: selected.mediaRoot, storage: target, mediaKey });
    await assertIdentity(sourceIdentity, targetIdentity);
    const binding = { database: env.JESSIEMESSAGE_DB_NAME, rootFingerprint: sourceIdentity.rootFingerprint };
    const targetBinding = { database: selected.database, rootFingerprint: targetIdentity.rootFingerprint };
    return await scopeOperation(selected.operationsDirectory, async currentScope => scopeOperation(selected.checkpointDirectory, async checkpointScope => {
      const receipt = await readReceipt(checkpointScope, { signal });
      if (!Object.hasOwn(receipt, "operations")) fail("OPERATIONS_LEGACY_CHECKPOINT");
      const backup = await readOperations(checkpointScope, receipt, key, { signal });
      if (JSON.stringify(backup.binding) !== JSON.stringify(binding)) fail("OPERATIONS_BINDING_CHANGED");
      const current = await capture(currentScope, { key, binding, signal });
      const plan = planOperationalRestore({ backup, current, targetBinding, key }); active();
      const summary = { status: "operational_restore_precheck_passed", currentSha256: plan.currentSha256,
        files: plan.state.files.length, completedReceipts: plan.completedReceipts, pendingReceipts: plan.pendingReceipts,
        bindingChanged: plan.bindingChanged, externalRegistryContinuityVerified: false, reconciliationRequired: true,
        sqlRestored: false, started: false };
      await scopeOperation(dirname(selected.destination), async parent => {
        await parent.assertReady();
        try { await lstat(parent.file(selected.destination.slice(selected.destination.lastIndexOf("/") + 1))); fail("OPERATIONS_NOT_EMPTY"); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        if (selected.command === "check") return;
        if (selected.currentSha256 !== plan.currentSha256) fail("OPERATIONS_CHANGED");
        // The destination is a disposable quarantine, never a running runtime.
        // All current receipts are rechecked at both publication boundaries.
        const assertCurrent = async expected => {
          active(); if (operationalStateHash(await capture(currentScope, { key, binding, signal })) !== expected) fail("OPERATIONS_CHANGED");
          const actualSource = await identity({ databaseName: env.JESSIEMESSAGE_DB_NAME, rootPath: env.JESSIEMESSAGE_MEDIA_ROOT, storage: source, mediaKey });
          const actualTarget = await identity({ databaseName: selected.database, rootPath: selected.mediaRoot, storage: target, mediaKey });
          if (JSON.stringify(actualSource) !== JSON.stringify(sourceIdentity) || JSON.stringify(actualTarget) !== JSON.stringify(targetIdentity)) fail("OPERATIONS_CHANGED");
          if (JSON.stringify(await readReceipt(checkpointScope, { signal })) !== JSON.stringify(receipt)
            || operationalStateHash(await readOperations(checkpointScope, receipt, key, { signal })) !== operationalStateHash(backup)) fail("OPERATIONS_CHANGED");
        };
        await assertCurrent(plan.currentSha256);
        const name = selected.destination.slice(selected.destination.lastIndexOf("/") + 1);
        await mkdir(parent.file(name), { mode: 0o700 }); await parent.sync(); await parent.assertReady();
        await scopeOperation(selected.destination, scope => restoreOperationalQuarantine(scope, {
          backup, current, targetBinding, key, expectedCurrentSha256: selected.currentSha256, assertCurrent, signal }));
      });
      return selected.command === "check" ? summary : { ...summary, status: "operational_quarantine_restored", restored: true };
    }));
  } catch (error) { if (error instanceof OperationalCheckpointError) throw error; fail("OPERATIONS_UNAVAILABLE"); }
  finally { key?.fill(0); mediaKey?.fill(0); clearRuntimeMessagingSecrets(env); }
}
export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  const result = await run(parseArguments(args), dependencies); outputStream.write(`${JSON.stringify(result)}\n`); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController(), cancel = () => cancellation.abort(); process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  try { await main(process.argv.slice(2), { signal: cancellation.signal }); }
  catch (error) { process.stderr.write(`${error instanceof OperationalCheckpointError ? error.code : "OPERATIONS_UNAVAILABLE"}: Private operational recovery was not confirmed.\n`); process.exitCode = 1; }
  finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
}
