import { relative, sep, isAbsolute } from "node:path";
import { validateRuntimeVideoConfiguration } from "./runtime-database-file.mjs";
import { clearRuntimeMessagingSecrets } from "./runtime-messaging.mjs";
import { inspectDirectoryIdentities } from "../files/private-directory.mjs";
import { createVideoStorage } from "../video/storage.mjs";
import { createVideoStore } from "../video/store.mjs";
import { createChatStore } from "../chat/store.mjs";
import { createRuntimePool } from "../db/runtime.mjs";

const failure = () => { throw Object.assign(new Error("Private video storage is unavailable."), { code: "RUNTIME_VIDEO_STORAGE" }); };
const contains = (a, b) => { const suffix = relative(a, b); return suffix === "" || suffix !== ".." && !suffix.startsWith(".." + sep) && !isAbsolute(suffix); };
export function runtimeVideoConfiguration(env) {
  let record;
  try {
    record = validateRuntimeVideoConfiguration({ format: "jessiemessage-runtime-video", version: 1,
      origin: env.JESSIEMESSAGE_SITE_ORIGIN, videoKey: env.JESSIEMESSAGE_VIDEO_KEY, videoRoot: env.JESSIEMESSAGE_VIDEO_ROOT,
      ownerBytes: env.JESSIEMESSAGE_VIDEO_OWNER_BYTES, totalBytes: env.JESSIEMESSAGE_VIDEO_TOTAL_BYTES,
      minimumFreeBytes: env.JESSIEMESSAGE_VIDEO_MINIMUM_FREE_BYTES }, { originProfile: "primary" });
    if (["JESSIEMESSAGE_MFA_KEY", "JESSIEMESSAGE_MAIL_KEY", "JESSIEMESSAGE_MESSAGE_KEY", "JESSIEMESSAGE_MEDIA_KEY",
      "JESSIEMESSAGE_NOTIFICATIONS_KEY", "JESSIEMESSAGE_VAPID_PRIVATE_KEY", "JESSIEMESSAGE_CRM_KEY"].some(name => env[name] === record.videoKey)
      || typeof env.JESSIEMESSAGE_MEDIA_ROOT !== "string"
      || contains(env.JESSIEMESSAGE_MEDIA_ROOT, record.videoRoot) || contains(record.videoRoot, env.JESSIEMESSAGE_MEDIA_ROOT)) failure();
    return { origin: record.origin, key: Buffer.from(record.videoKey, "base64url"), root: record.videoRoot,
      capacity: { ownerBytes: Number(record.ownerBytes), totalBytes: Number(record.totalBytes) }, minimumFreeBytes: Number(record.minimumFreeBytes) };
  } catch { failure(); }
  finally { clearRuntimeMessagingSecrets(record); }
}

/** Roots must be distinct physical trees, including aliases through another
 * spelling or bind mount. Content-key fingerprints alone cannot prove this. */
export async function assertDistinctVideoRoots(photoRoot, videoRoot, { inspect = inspectDirectoryIdentities } = {}) {
  try {
    const [photos, videos] = await Promise.all([inspect(photoRoot), inspect(videoRoot)]);
    const same = (a, b) => a?.dev === b?.dev && a?.ino === b?.ino;
    if (!photos.length || !videos.length || photos.some(value => same(value, videos.at(-1)))
      || videos.some(value => same(value, photos.at(-1)))) failure();
    return true;
  } catch { failure(); }
}

/** Read capacity and private-root readiness; never initialize storage here. */
export async function checkRuntimeVideoStorage(env, { createPool = createRuntimePool,
  makeStorage = createVideoStorage, makeStore = createVideoStore, inspectRoots = assertDistinctVideoRoots } = {}) {
  let configuration, pool;
  try {
    configuration = runtimeVideoConfiguration(env);
    await inspectRoots(env.JESSIEMESSAGE_MEDIA_ROOT, configuration.root);
    const storage = await makeStorage({ root: configuration.root, key: configuration.key, pathMode: "linux-dirfd" });
    const rootFingerprint = await storage.fingerprint(), space = await storage.availableSpace();
    if (!Buffer.isBuffer(rootFingerprint) || rootFingerprint.length !== 32 || typeof space?.availableBytes !== "bigint"
      || space.availableBytes < BigInt(configuration.minimumFreeBytes) + 65n) failure();
    pool = await createPool(env);
    const store = makeStore({ pool, chatStore: createChatStore(pool), capacity: { ...configuration.capacity, rootFingerprint } });
    await store.assertSchema();
    if ((await store.status()).ready !== true) failure();
    return { ready: true, availableBytes: space.availableBytes.toString() };
  } catch { failure(); }
  finally {
    configuration?.key.fill(0);
    try { await pool?.end(); } catch { failure(); }
  }
}
