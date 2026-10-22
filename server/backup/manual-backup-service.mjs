import { createCopyCatalog } from "./copy-catalog.mjs";
import { copyDate } from "./copy-state.mjs";
import { createManualBackupRequests, ManualBackupError } from "./manual-backup-files.mjs";

/** Administrative requests only record intent. The existing parent owns the
 * offline capture and restarts the application after recording its result. */
export function createManualBackupService(directory, internal = {}) {
  const clock = internal.clock ?? Date.now;
  const requests = internal.requests ?? createManualBackupRequests({ operationsDirectory: directory, clock });
  const catalog = internal.catalog ?? createCopyCatalog(directory);
  const now = () => { const value = clock(); if (!copyDate(value)) throw new ManualBackupError(); return value; };
  return Object.freeze({
    async summary() {
      const [request, listing] = await Promise.all([requests.status(), catalog.list()]);
      return { version: 1, mode: "manual", checkedAt: now(), request, latestArchive: listing.archives.at(-1) ?? null,
        archiveCount: listing.archives.length, archives: listing.archives, decryptionStatus: "not_checked" };
    },
    async request(value) {
      return { version: 1, mode: "manual", request: await requests.request(value) };
    },
    transfer: (id, consume, options) => catalog.transfer(id, consume, options),
  });
}
