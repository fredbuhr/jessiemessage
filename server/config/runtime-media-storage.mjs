import { mediaConfiguration } from "../media/config.mjs";
import { createMediaStorage } from "../media/storage.mjs";
import { createMediaCapacityStore } from "../media/capacity-store.mjs";
import { createRuntimePool } from "../db/runtime.mjs";
import { normalizeImage } from "../media/image.mjs";

/** Exercise the existing native decoder and private storage without storing an
 * image, sending mail or creating listeners. SQL checks only read capacity. */
export async function checkRuntimeMediaStorage(env, { requireInitialized = true, video = false, experience = false, createPool = createRuntimePool,
  makeStorage = createMediaStorage, makeCapacity = createMediaCapacityStore, normalize = normalizeImage } = {}) {
  let config, pool, input, normalized;
  try {
    config = mediaConfiguration(env);
    if (config.enabled !== true || typeof requireInitialized !== "boolean" || typeof video !== "boolean" || typeof experience !== "boolean" || experience && !video) throw new Error();
    const storage = await makeStorage({ root: config.root, key: config.key });
    const rootFingerprint = await storage.fingerprint(), space = await storage.availableSpace();
    if (!Buffer.isBuffer(rootFingerprint) || rootFingerprint.length !== 32 || typeof space?.availableBytes !== "bigint"
      || space.availableBytes < BigInt(config.minimumFreeBytes) + 82n) throw new Error();
    pool = await createPool(env);
    const capacity = makeCapacity({ pool, capacity: { ...config.capacity, rootFingerprint } });
    await capacity.assertSchema(...(video ? [{ video: true, ...(experience ? { experience: true } : {}) }] : []));
    const state = await capacity.status();
    if (state.ready !== requireInitialized) throw new Error();
    const { default: sharp } = await import("sharp");
    input = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#808080" } }).png().toBuffer();
    normalized = await normalize(input);
    if (normalized?.width !== 1 || normalized.height !== 1 || !Buffer.isBuffer(normalized.full)
      || !Buffer.isBuffer(normalized.thumbnail)) throw new Error();
    await storage.assertReady();
    return { ready: state.ready, nativeDecoderVerified: true, availableBytes: space.availableBytes.toString() };
  } catch {
    const error = new Error("Private photo storage is unavailable."); error.code = "RUNTIME_MEDIA_STORAGE"; throw error;
  } finally {
    config?.key.fill(0); input?.fill(0);
    for (const value of Object.values(normalized ?? {})) if (Buffer.isBuffer(value)) value.fill(0);
    try { await pool?.end(); }
    catch { const error = new Error("Private photo storage cleanup failed."); error.code = "RUNTIME_MEDIA_STORAGE"; throw error; }
  }
}
