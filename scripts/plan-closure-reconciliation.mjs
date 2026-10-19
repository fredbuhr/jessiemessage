import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { withPrivateDirectory } from "../server/files/private-directory.mjs";
import { privateAuthenticationProcessOptions } from "../server/config/private-auth-environment.mjs";
import { loadRuntimeBroadcastEnvironment } from "../server/config/runtime-broadcast.mjs";
import { clearRuntimeMessagingSecrets } from "../server/config/runtime-messaging.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { backupIdentity, assertCloneIdentity } from "../server/backup/manifest.mjs";
import { readCheckpointReceipt } from "../server/backup/checkpoint-receipt.mjs";
import { captureOperationalState, readOperationalCheckpoint, readOperationalQuarantine, operationalStateHash,
  OperationalCheckpointError } from "../server/backup/operational-checkpoint.mjs";
import { createErasureContinuity } from "../server/backup/registry-continuity.mjs";
import { exchangeWitnessRecovery } from "../server/backup/witness-recovery-control.mjs";
import { planClosureReconciliation } from "../server/backup/closure-reconciliation.mjs";
import { parseArguments as parseRestoreArguments } from "./restore-private-operations.mjs";

const FLAGS = new Map([["--private-directory", "privateDirectory"], ["--operations-directory", "operationsDirectory"],
  ["--checkpoint-directory", "checkpointDirectory"], ["--quarantine-private-directory", "quarantineDirectory"],
  ["--database", "database"], ["--media-root", "mediaRoot"], ["--witness-operator-directory", "witnessOperatorDirectory"],
  ["--witness-contract-sha256", "witnessContractSha256"]]);
const FIELDS = ["command", ...FLAGS.values()];
const fail = code => { throw new OperationalCheckpointError(code); };
const inside = (value, root) => { const suffix = relative(root, value); return suffix === "" || suffix !== ".." && !suffix.startsWith(`..${sep}`) && !suffix.startsWith(sep); };

/** Only a read-only check exists. There is deliberately no apply/confirm flag. */
export function parseArguments(args) {
  if (!Array.isArray(args) || args[0] !== "check" || args.length !== 17
    || args.slice(1).some((value, index) => index % 2 === 0 && !FLAGS.has(value))) fail("OPERATIONS_USAGE");
  const selected = parseRestoreArguments(args.map(value => value === "--quarantine-private-directory" ? "--destination-private-directory" : value));
  const { destination, ...rest } = selected;
  return { ...rest, quarantineDirectory: destination };
}

/** Reads existing source configuration, capsule, quarantine and PC authority.
 * It never connects to target SQL, writes files or grants startup authority. */
export async function run(value, { inheritedEnv = process.env, execArgv = process.execArgv, signal,
  scopeOperation = withPrivateDirectory, loadEnvironment = loadRuntimeBroadcastEnvironment, makeStorage = createMediaStorage,
  readReceipt = readCheckpointReceipt, readOperations = readOperationalCheckpoint, capture = captureOperationalState,
  readQuarantine = readOperationalQuarantine, identity = backupIdentity, exchangeRecovery = exchangeWitnessRecovery } = {}) {
  let env, key, mediaKey, continuity;
  try {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== FIELDS.length
      || FIELDS.some(name => !Object.hasOwn(value, name) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), "value"))) fail("OPERATIONS_USAGE");
    const selected = parseArguments([value.command, ...[...FLAGS].flatMap(([flag, name]) => [flag, value[name]])]);
    const options = privateAuthenticationProcessOptions(inheritedEnv, execArgv);
    const active = () => { if (signal?.aborted) fail("OPERATIONS_ABORTED"); };
    active(); env = await loadEnvironment(selected.privateDirectory, { port: options.port, originProfile: "primary", recovery: true });
    if (selected.database.toLowerCase() === env.JESSIEMESSAGE_DB_NAME.toLowerCase()) fail("OPERATIONS_SOURCE_TARGET");
    for (const name of ["mediaRoot", "quarantineDirectory", "witnessOperatorDirectory"])
      if (inside(selected[name], env.JESSIEMESSAGE_MEDIA_ROOT) || inside(env.JESSIEMESSAGE_MEDIA_ROOT, selected[name])) fail("OPERATIONS_SOURCE_TARGET");
    key = Buffer.from(env.JESSIEMESSAGE_CRM_KEY, "base64url"); mediaKey = Buffer.from(env.JESSIEMESSAGE_MEDIA_KEY, "base64url");
    const source = await makeStorage({ root: env.JESSIEMESSAGE_MEDIA_ROOT, key: mediaKey, pathMode: "linux-dirfd" });
    const target = await makeStorage({ root: selected.mediaRoot, key: mediaKey, pathMode: "linux-dirfd" });
    const getSourceIdentity = () => identity({ databaseName: env.JESSIEMESSAGE_DB_NAME, rootPath: env.JESSIEMESSAGE_MEDIA_ROOT, storage: source, mediaKey });
    const getTargetIdentity = () => identity({ databaseName: selected.database, rootPath: selected.mediaRoot, storage: target, mediaKey });
    const sourceIdentity = await getSourceIdentity(), targetIdentity = await getTargetIdentity();
    assertCloneIdentity(sourceIdentity, targetIdentity);
    const sourceBinding = { database: env.JESSIEMESSAGE_DB_NAME, rootFingerprint: sourceIdentity.rootFingerprint };
    const targetBinding = { database: selected.database, rootFingerprint: targetIdentity.rootFingerprint };
    return await scopeOperation(selected.operationsDirectory, currentScope => scopeOperation(selected.checkpointDirectory, checkpointScope =>
      scopeOperation(selected.quarantineDirectory, async quarantineScope => {
        const receipt = await readReceipt(checkpointScope, { signal });
        if (!Object.hasOwn(receipt, "operations")) fail("OPERATIONS_LEGACY_CHECKPOINT");
        const backup = await readOperations(checkpointScope, receipt, key, { signal });
        const local = await capture(currentScope, { key, binding: sourceBinding, signal });
        const quarantine = await readQuarantine(quarantineScope, { key, sourceBinding, targetBinding, signal });
        const receiptSha256 = operationalStateHash(receipt), backupSha256 = operationalStateHash(backup), localSha256 = operationalStateHash(local);
        const assertResources = async () => {
          active();
          if (operationalStateHash(await capture(currentScope, { key, binding: sourceBinding, signal })) !== localSha256
            || operationalStateHash(await readReceipt(checkpointScope, { signal })) !== receiptSha256
            || operationalStateHash(await readOperations(checkpointScope, receipt, key, { signal })) !== backupSha256
            || operationalStateHash(await getSourceIdentity()) !== operationalStateHash(sourceIdentity)
            || operationalStateHash(await getTargetIdentity()) !== operationalStateHash(targetIdentity)) fail("OPERATIONS_CHANGED");
          const current = await readQuarantine(quarantineScope, { key, sourceBinding, targetBinding, signal });
          if (current.markerSha256 !== quarantine.markerSha256 || current.stateSha256 !== quarantine.stateSha256) fail("OPERATIONS_CHANGED");
          active();
        };
        continuity = createErasureContinuity({ key, binding: sourceBinding,
          readCurrent: () => capture(currentScope, { key, binding: sourceBinding, signal }),
          exchange: (request, exchangeOptions) => exchangeRecovery({ directory: `${selected.witnessOperatorDirectory}/control`,
            contractSha256: selected.witnessContractSha256, binding: sourceBinding, request, signal: exchangeOptions.signal }) });
        const result = await planClosureReconciliation({ key, backup, local, quarantine, sourceIdentity, targetIdentity,
          checkpointReceiptSha256: receiptSha256, contextSha256: operationalStateHash(selected), continuity, assertReady: assertResources, signal });
        await assertResources();
        // Client identifiers and encrypted source envelopes stay in memory.
        return { ...result.summary, targetSqlInspected: false, targetMutated: false, quarantineRetained: true };
      })));
  } catch (error) { if (error instanceof OperationalCheckpointError) throw error; fail("OPERATIONS_UNAVAILABLE"); }
  finally { continuity?.close(); key?.fill(0); mediaKey?.fill(0); clearRuntimeMessagingSecrets(env); }
}

export async function main(args = process.argv.slice(2), { outputStream = process.stdout, ...dependencies } = {}) {
  const result = await run(parseArguments(args), dependencies); outputStream.write(`${JSON.stringify(result)}\n`); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController(), cancel = () => cancellation.abort(); process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
  try { await main(process.argv.slice(2), { signal: cancellation.signal }); }
  catch (error) { process.stderr.write(`${error instanceof OperationalCheckpointError ? error.code : "OPERATIONS_UNAVAILABLE"}: Closure reconciliation planning was not confirmed.\n`); process.exitCode = 1; }
  finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
}
