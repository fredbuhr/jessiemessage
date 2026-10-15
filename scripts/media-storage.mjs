import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mediaConfiguration } from "../server/media/config.mjs";
import { createMediaStorage } from "../server/media/storage.mjs";
import { createMediaInventoryStore } from "../server/media/inventory-store.mjs";
import { inspectMediaInventory } from "../server/media/inventory.mjs";

export class MediaStorageCliError extends Error {
  constructor(code) { super("Private storage inventory could not be completed. Consult the private media storage procedure."); this.name = "MediaStorageCliError"; this.code = code; }
}
const fail = (code) => { throw new MediaStorageCliError(code); };

export function parseArguments(args) {
  if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) fail("MEDIA_STORAGE_USAGE");
  if (args.length === 0 || args.length === 1 && args[0] === "inspect") return { command: "inspect", offline: false };
  if (args.length === 2 && args[0] === "initialize" && args[1] === "--offline") return { command: "initialize", offline: true };
  fail("MEDIA_STORAGE_USAGE");
}

/** --offline is an operator assertion: stop the app and all workers first. */
export async function main(args = process.argv.slice(2), env = process.env, dependencies = {}) {
  const options = parseArguments(args), config = (dependencies.configure ?? mediaConfiguration)(env);
  if (config?.enabled !== true || !config.capacity) fail("MEDIA_STORAGE_CONFIG");
  const makePool = dependencies.createPool ?? (await import("../server/db/runtime.mjs")).createRuntimePool;
  const makeCapacity = dependencies.makeCapacityStore ?? (await import("../server/media/capacity-store.mjs")).createMediaCapacityStore;
  let pool;
  try {
    pool = await makePool(env);
    const storage = await (dependencies.makeStorage ?? createMediaStorage)({ root: config.root, key: config.key });
    const fingerprint = await storage.fingerprint();
    if (!Buffer.isBuffer(fingerprint) || fingerprint.length !== 32) fail("MEDIA_STORAGE_CONFIG");
    const rootFingerprint = Buffer.from(fingerprint), capacity = { ...config.capacity, rootFingerprint };
    const capacityStore = makeCapacity({ pool, capacity });
    const schemaStore = dependencies.makeSchemaStore ? dependencies.makeSchemaStore({ pool, capacity })
      : (await import("../server/media/store.mjs")).createMediaStore({ pool, capacity,
        chatStore: (await import("../server/chat/store.mjs")).createChatStore(pool) });
    if (typeof schemaStore?.assertSchema !== "function") fail("MEDIA_STORAGE_CONFIG");
    await schemaStore.assertSchema();
    const store = (dependencies.makeInventoryStore ?? createMediaInventoryStore)({ pool });
    const report = await (dependencies.inspect ?? inspectMediaInventory)({ store, capacityStore, storage,
      capacity: config.capacity, minimumFreeBytes: config.minimumFreeBytes, signal: dependencies.signal, limits: dependencies.limits });
    if (!report || typeof report.complete !== "boolean" || typeof report.healthy !== "boolean" || typeof report.canInitialize !== "boolean"
      || report.integrity !== "structure_only") fail("MEDIA_STORAGE_INVENTORY");
    let initialized = false;
    if (options.command === "initialize") {
      if (!report.complete || !report.healthy || !report.canInitialize) {
        (dependencies.outputStream ?? process.stdout).write(`${JSON.stringify({ command: options.command, initialized: false, report })}\n`);
        fail("MEDIA_STORAGE_INVENTORY");
      }
      const now = (dependencies.clock ?? Date.now)();
      if (!Number.isSafeInteger(now) || now < 0 || now > 253402300799999) fail("MEDIA_STORAGE_CONFIG");
      const currentFingerprint = await storage.fingerprint();
      if (!Buffer.isBuffer(currentFingerprint) || !currentFingerprint.equals(rootFingerprint)) fail("MEDIA_STORAGE_OPERATION");
      await capacityStore.initialize({ now, offline: true });
      initialized = true;
    }
    const result = { command: options.command, initialized, report };
    (dependencies.outputStream ?? process.stdout).write(`${JSON.stringify(result)}\n`);
    if (!report.complete || !report.healthy) fail("MEDIA_STORAGE_INVENTORY");
    return result;
  } catch (error) {
    if (error instanceof MediaStorageCliError) throw error;
    fail("MEDIA_STORAGE_OPERATION");
  } finally {
    try { await pool?.end(); }
    catch { fail("MEDIA_STORAGE_OPERATION"); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = error instanceof MediaStorageCliError ? error.code : "MEDIA_STORAGE_OPERATION";
    process.stderr.write(`${code}: Private media storage operation failed.\n`);
    process.exitCode = 1;
  });
}
