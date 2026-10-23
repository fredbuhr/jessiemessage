import { lstat } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { loadRuntimeBroadcastEnvironment, BROADCAST_RUNTIME_OPTIONS } from "../config/runtime-broadcast.mjs";
import { loadRuntimeVideoEnvironment } from "../config/runtime-video.mjs";
import { createVideoStorage } from "../video/storage.mjs";
import { createVideoStore } from "../video/store.mjs";
import { createVideoErasureExtension } from "../video/erasure-store.mjs";
import { composeVideoErasureStorage } from "../video/erasure-storage.mjs";
import { createChatStore } from "../chat/store.mjs";
import { loadVideoMigrations } from "../video/migrations.mjs";
import { clearRuntimeMessagingSecrets } from "../config/runtime-messaging.mjs";
import { privateAuthenticationProcessOptions } from "../config/private-auth-environment.mjs";
import { createRuntimePool } from "../db/runtime.mjs";
import { mediaConfiguration } from "../media/config.mjs";
import { createMediaStorage } from "../media/storage.mjs";
import { createMediaCapacityStore } from "../media/capacity-store.mjs";
import { createErasureStore } from "../data/erasure-store.mjs";
import { createErasureJournal, readErasureJournalBatch, erasureJournalBindings } from "../data/erasure-journal.mjs";
import { assertErasureSchema } from "../data/erasure-schema.mjs";
import { failErasure } from "../data/erasure-state.mjs";
import { createLocalClosureOperations } from "../data/closure-operations.mjs";
import { withPrivateDirectory } from "../files/private-directory.mjs";
import { assertNoOperationalRestore, operationalStateHash } from "./operational-checkpoint.mjs";

const fingerprint = (env, key) => createHmac("sha256", key)
  .update(JSON.stringify(Object.fromEntries(Object.keys(env).sort().map(name => [name, env[name]])))).digest("hex");

/** Explicit local owner of the existing eraser. Loading this context never
 * starts producers, writes an intent, changes configuration or contacts a PC.
 * The supervisor supplies the actual child drain and capture exclusion. */
export async function createConfiguredLocalClosures(options, { environment = process.env, signal } = {}, internal = {}) {
  if (options?.video !== undefined && options.video !== true) failErasure("ERASURE_INPUT");
  const candidate = options?.video === true, experience = options?.experience === true;
  if (options?.experience !== undefined && options.experience !== true || experience && !candidate) failErasure("ERASURE_INPUT");
  const load = internal.loadEnvironment ?? (candidate ? loadRuntimeVideoEnvironment : loadRuntimeBroadcastEnvironment);
  const withDirectory = internal.withDirectory ?? withPrivateDirectory;
  let env, key, media, rootFingerprint, videoKey, videoRootFingerprint, videoStorage, pool, closed = false, closing;
  const active = () => { if (closed || signal?.aborted) failErasure("ERASURE_ABORTED"); };
  async function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      try { await pool?.end(); }
      finally { key?.fill(0); media?.key?.fill(0); rootFingerprint?.fill(0); videoKey?.fill(0); videoRootFingerprint?.fill(0); clearRuntimeMessagingSecrets(env); }
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
    if (candidate) {
      videoKey = Buffer.from(env.JESSIEMESSAGE_VIDEO_KEY ?? "", "base64url");
      if (videoKey.length !== 32 || videoKey.toString("base64url") !== env.JESSIEMESSAGE_VIDEO_KEY) failErasure("ERASURE_INPUT");
      videoStorage = await (internal.makeVideoStorage ?? createVideoStorage)({ root: env.JESSIEMESSAGE_VIDEO_ROOT, key: videoKey, pathMode: "linux-dirfd" });
      videoRootFingerprint = await videoStorage.fingerprint();
      const roots = await Promise.all([media.root, env.JESSIEMESSAGE_VIDEO_ROOT].map(root => lstat(root, { bigint: true })));
      if (roots[0].dev === roots[1].dev && roots[0].ino === roots[1].ino) failErasure("ERASURE_BINDING");
      if (!Buffer.isBuffer(videoRootFingerprint) || videoRootFingerprint.length !== 32 || videoRootFingerprint.equals(rootFingerprint)) failErasure("ERASURE_BINDING");
    }
    const original = fingerprint(env, key), capacity = { ...media.capacity, rootFingerprint };
    pool = await (internal.createPool ?? createRuntimePool)(env);
    const broadcastKey = Buffer.from(env.JESSIEMESSAGE_MESSAGE_KEY ?? "", "base64url");
    let store, video;
    if (candidate) {
      const videoCapacity = { ownerBytes: Number(env.JESSIEMESSAGE_VIDEO_OWNER_BYTES), totalBytes: Number(env.JESSIEMESSAGE_VIDEO_TOTAL_BYTES), rootFingerprint: videoRootFingerprint };
      const videoStore = (internal.makeVideoStore ?? createVideoStore)({ pool, chatStore: createChatStore(pool), capacity: videoCapacity, ...(experience ? { experience: true } : {}) });
      video = (internal.makeVideoErasure ?? createVideoErasureExtension)({ videoStore, videoStorage, capacity: videoCapacity, ...(experience ? { experience: true } : {}) });
    }
    try { store = (internal.makeStore ?? createErasureStore)({ pool, database: env.JESSIEMESSAGE_DB_NAME, capacity, broadcastKey, ...(candidate ? { video } : {}), ...(experience ? { experience: true } : {}) }); }
    finally { broadcastKey.fill(0); }
    const capacityStore = (internal.makeCapacity ?? createMediaCapacityStore)({ pool, capacity });
    async function guard() {
      active(); let current;
      try {
        current = await load(options.privateDirectory, parameters);
        const root = await storage.fingerprint();
        if (fingerprint(current, key) !== original || !Buffer.isBuffer(root) || !root.equals(rootFingerprint)) failErasure("ERASURE_CHANGED");
        if (candidate) { const observed = await videoStorage.fingerprint(); try { if (!Buffer.isBuffer(observed) || !observed.equals(videoRootFingerprint)) failErasure("ERASURE_CHANGED"); } finally { observed?.fill(0); } }
        await withDirectory(options.operationsDirectory, assertNoOperationalRestore); active();
      } finally { clearRuntimeMessagingSecrets(current); }
    }
    async function inspectApplicationSchema() {
      await guard(); let connection;
      try {
        connection = await pool.getConnection();
        await (internal.assertSchema ?? assertErasureSchema)(connection, store.binding.database, ...(candidate ? [{ candidateMigrations: experience ? await (await import("../experience/migrations.mjs")).loadExperienceMigrations() : await loadVideoMigrations() }] : []));
        if (candidate) await video.snapshot(connection);
      } finally { await connection?.release(); }
      const value = await capacityStore.status();
      if (value.ready !== true || !Buffer.isBuffer(value.rootFingerprint) || !value.rootFingerprint.equals(rootFingerprint)
        || value.ownerBytes !== capacity.ownerBytes || value.totalBytes !== capacity.totalBytes) failErasure("ERASURE_CAPACITY");
      await guard(); return { verified: true };
    }
    const selectedStorage = candidate ? composeVideoErasureStorage({ storage, videoStorage }) : storage;
    const scopes = erasureJournalBindings(store.binding);
    const operations = (candidate ? createVideoLocalClosureOperations : createLocalClosureOperations)({ store, storage: selectedStorage, inspectApplicationSchema,
      journalFor: clientId => createErasureJournal({ directory: options.operationsDirectory, key, binding: store.binding, clientId }, { withDirectory }),
      batch: page => readErasureJournalBatch({ directory: options.operationsDirectory, key, ...scopes, ...page }, { withDirectory }) });
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
        return { version: candidate ? 2 : 1, type: "local_closure_precheck", status: "passed", scope: "local_application",
          pendingClosures, started: false, erased: false, externalContinuityVerified: false };
      },
    });
  } catch (error) { try { await close(); } catch { failErasure(); } throw error; }
}

/** A video owner authenticates historical v1 receipts but never rewrites them.
 * Pending historical work is an upgrade barrier, not a licence to reinterpret
 * its photo cursor under the two-root eraser. Explicit restoration replays the
 * complete target job under v2 while retaining source bytes in quarantine. */
export function createVideoLocalClosureOperations(options) {
  const { store, batch, clock = Date.now } = options;
  if (!Object.hasOwn(store?.binding ?? {}, "videoRootFingerprint") || typeof batch !== "function") failErasure("ERASURE_INPUT");
  erasureJournalBindings(store.binding);
  async function inspectLegacy(assertReady = async () => {}, verify = false) {
    let afterName = null, count = 0, legacy = 0; const clients = new Set(), receipts = [];
    do {
      await assertReady(); const page = await batch({ afterName, limit: 100 });
      for (const job of page.jobs) {
        if (++count > 10000 || clients.has(job.clientId) || ![1, 2].includes(job.version)) failErasure("ERASURE_CHANGED");
        clients.add(job.clientId);
        if (job.version === 1) {
          if (job.phase !== "completed") failErasure("ERASURE_LEGACY_PENDING");
          if (verify) { await assertReady(); await store.withLease(job.clientId, scope => scope.verifyAbsent(clock())); await assertReady(); }
          receipts.push(job); legacy++;
        }
      }
      if (page.nextCursor !== null && (afterName !== null && page.nextCursor <= afterName || !/^erasure-[a-f0-9]{64}\.json$/.test(page.nextCursor))) failErasure("ERASURE_CHANGED");
      afterName = page.nextCursor;
    } while (afterName !== null);
    await assertReady(); return { count: legacy, sha256: operationalStateHash(receipts) };
  }
  const current = createLocalClosureOperations({ ...options, batch: async page => {
    const result = await batch(page); return { ...result, jobs: result.jobs.filter(job => job.version === 2) };
  } });
  return Object.freeze({
    async hasPending() { await inspectLegacy(); return current.hasPending(); },
    async preflight(ready, settings) { await inspectLegacy(ready); return current.preflight(ready, settings); },
    async verifyStartup(ready, settings) {
      const before = await inspectLegacy(ready, true), result = await current.verifyStartup(ready, settings);
      if ((await inspectLegacy(ready, true)).sha256 !== before.sha256) failErasure("ERASURE_CHANGED");
      return { ...result, completedReceipts: result.completedReceipts + before.count };
    },
    async run(ready, settings) {
      const before = await inspectLegacy(ready, true), result = await current.run(ready, settings);
      if ((await inspectLegacy(ready, true)).sha256 !== before.sha256) failErasure("ERASURE_CHANGED");
      return { ...result, completedReceipts: result.completedReceipts + before.count };
    },
  });
}
