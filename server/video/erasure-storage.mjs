import { failErasure } from "../data/erasure-state.mjs";

/** Explicit candidate composition only. The ordinary closure storage remains
 * photo-only. Both physical roots are checked independently by the v2 engine. */
export function composeVideoErasureStorage({ storage, videoStorage } = {}) {
  if ([storage?.fingerprint, storage?.remove, videoStorage?.fingerprint, videoStorage?.remove]
    .some(method => typeof method !== "function")) failErasure("ERASURE_INPUT");
  return Object.freeze({
    fingerprint: () => storage.fingerprint(),
    videoFingerprint: () => videoStorage.fingerprint(),
    async remove({ kind, storageKey } = {}) {
      if (!["photo", "video"].includes(kind) || !Buffer.isBuffer(storageKey) || storageKey.length !== 32)
        failErasure("ERASURE_INPUT");
      if (kind === "video") {
        const removed = await videoStorage.remove({ storageKey });
        if (removed?.removed !== true) failErasure("ERASURE_FILES");
      } else await storage.remove({ storageKey });
      return { removed: true };
    },
  });
}
