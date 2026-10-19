import { createHmac } from "node:crypto";
import { loadRuntimeBroadcastEnvironment, BROADCAST_RUNTIME_OPTIONS } from "../config/runtime-broadcast.mjs";
import { clearRuntimeMessagingSecrets } from "../config/runtime-messaging.mjs";
import { privateAuthenticationProcessOptions } from "../config/private-auth-environment.mjs";
import { createRuntimePool } from "../db/runtime.mjs";
import { mediaConfiguration } from "../media/config.mjs";
import { createMediaStorage } from "../media/storage.mjs";
import { createMediaCapacityStore } from "../media/capacity-store.mjs";
import { createErasureStore } from "../data/erasure-store.mjs";
import { createErasureJournal, readErasureJournalBatch } from "../data/erasure-journal.mjs";
import { assertErasureSchema } from "../data/erasure-schema.mjs";
import { failErasure } from "../data/erasure-state.mjs";
import { createLocalClosureOperations } from "../data/closure-operations.mjs";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { assertNoOperationalRestore } from "./operational-checkpoint.mjs";

const fingerprint = (env, key) => createHmac("sha256", key)
  .update(JSON.stringify(Object.fromEntries(Object.keys(env).sort().map(name => [name, env[name]])))).digest("hex");

/** Explicit local owner of the existing eraser. Loading this context never
 * starts producers, writes an intent, changes configuration or contacts a PC.
 * The supervisor supplies the actual child drain and capture exclusion. */
export async function createConfiguredLocalClosures(options, { environment = process.env, signal } = {}, internal = {}) {
  const load = internal.loadEnvironment ?? loadRuntimeBroadcastEnvironment;
  const withDirectory = internal.withDirectory ?? withPrivateDirectory;
  let env, key, media, rootFingerprint, pool, closed = false, closing;
  const active = () => { if (closed || signal?.aborted) failErasure("ERASURE_ABORTED"); };
  async function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      try { await pool?.end(); }
      finally { key?.fill(0); media?.key?.fill(0); rootFingerprint?.fill(0); clearRuntimeMessagingSecrets(env); }
    })();
    return closing;
  }
  try {
    active(); const parameters = { ...privateAuthenticationProcessOptions(environment, []), ...BROADCAST_RUNTIME_OPTIONS };
    env = await load(options.privateDirectory, parameters); active();
    key = Buffer.from(env.JESSIEMESSAGE_CRM_KEY ?? "", "base64url");
    if (key.length !== 32 || key.toString("base64url") !== env.JESSIEMESSAGE_CRM_KEY) failErasure("ERASURE_INPUT");
    media = (internal.mediaConfiguration ?? mediaConfiguration)(env);
    if (media.enabled !== true) failErasure("ERASURE_INPUT");
    const storage = await (internal.makeStorage ?? createMediaStorage)({ root: media.root, key: media.key, pathMode: "linux-dirfd" });
    rootFingerprint = await storage.fingerprint();
    if (!Buffer.isBuffer(rootFingerprint) || rootFingerprint.length !== 32) failErasure("ERASURE_BINDING");
    const original = fingerprint(env, key), capacity = { ...media.capacity, rootFingerprint };
    pool = await (internal.createPool ?? createRuntimePool)(env);
    const broadcastKey = Buffer.from(env.JESSIEMESSAGE_MESSAGE_KEY ?? "", "base64url");
    let store;
    try { store = (internal.makeStore ?? createErasureStore)({ pool, database: env.JESSIEMESSAGE_DB_NAME, capacity, broadcastKey }); }
    finally { broadcastKey.fill(0); }
    const capacityStore = (internal.makeCapacity ?? createMediaCapacityStore)({ pool, capacity });
    async function guard() {
      active(); let current;
      try {
        current = await load(options.privateDirectory, parameters);
        const root = await storage.fingerprint();
        if (fingerprint(current, key) !== original || !Buffer.isBuffer(root) || !root.equals(rootFingerprint)) failErasure("ERASURE_CHANGED");
        await withDirectory(options.operationsDirectory, assertNoOperationalRestore); active();
      } finally { clearRuntimeMessagingSecrets(current); }
    }
    async function inspectApplicationSchema() {
      await guard(); let connection;
      try {
        connection = await pool.getConnection();
        await (internal.assertSchema ?? assertErasureSchema)(connection, store.binding.database);
      } finally { await connection?.release(); }
      const value = await capacityStore.status();
      if (value.ready !== true || !Buffer.isBuffer(value.rootFingerprint) || !value.rootFingerprint.equals(rootFingerprint)
        || value.ownerBytes !== capacity.ownerBytes || value.totalBytes !== capacity.totalBytes) failErasure("ERASURE_CAPACITY");
      await guard(); return { verified: true };
    }
    const operations = createLocalClosureOperations({ store, storage, inspectApplicationSchema,
      journalFor: clientId => createErasureJournal({ directory: options.operationsDirectory, key, binding: store.binding, clientId }, { withDirectory }),
      batch: page => readErasureJournalBatch({ directory: options.operationsDirectory, key, binding: store.binding, ...page }, { withDirectory }) });
    const checked = ready => async () => { await guard(); await ready(); await guard(); };
    const owned = Object.freeze({
      async hasPending() { await guard(); const result = await operations.hasPending(); await guard(); return result; },
      preflight: ready => operations.preflight(checked(ready)),
      run: ready => operations.run(checked(ready)),
      verifyStartup: (ready, settings) => operations.verifyStartup(checked(ready), settings),
    });
    await inspectApplicationSchema(); active();
    return Object.freeze({ operations: owned, close,
      async check() {
        await owned.preflight(guard); const pendingClosures = await owned.hasPending();
        return { version: 1, type: "local_closure_precheck", status: "passed", scope: "local_application",
          pendingClosures, started: false, erased: false, externalContinuityVerified: false };
      },
    });
  } catch (error) { try { await close(); } catch { failErasure(); } throw error; }
}
