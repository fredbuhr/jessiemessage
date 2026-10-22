import { BACKUP_MEDIA_MAX_BYTES, BACKUP_MEDIA_MAX_FILES } from "../media/backup-limits.mjs";
import { createCheckpointFileInventory } from "./checkpoint-file-inventory.mjs";

export class CheckpointFilesError extends Error {
  constructor(code = "CHECKPOINT_FILES_IO") {
    super("Private checkpoint files could not be verified.");
    this.name = "CheckpointFilesError";
    this.code = code;
  }
}

const operations = createCheckpointFileInventory({ publishedName: /^[a-f0-9]{64}\.(?:full|thumb)\.enc$/,
  maxFiles: BACKUP_MEDIA_MAX_FILES, maxTotalBytes: BACKUP_MEDIA_MAX_BYTES, maxFileBytes: 10 * 1024 * 1024 + 128,
  ErrorType: CheckpointFilesError, errorPrefix: "CHECKPOINT_FILES" });
export const copyCheckpointMedia = operations.copyCheckpointFiles;
export const resumeCheckpointMedia = operations.resumeCheckpointFiles;
export const verifyCheckpointMedia = operations.verifyCheckpointFiles;
