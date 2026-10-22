import { MAX_VIDEO_BYTES, videoStoredBytes } from "../video/storage.mjs";
import { createCheckpointFileInventory } from "./checkpoint-file-inventory.mjs";

export class VideoCheckpointFilesError extends Error {
  constructor(code = "VIDEO_CHECKPOINT_FILES_IO") {
    super("Private video checkpoint files could not be verified.");
    this.name = "VideoCheckpointFilesError";
    this.code = code;
  }
}

export const VIDEO_CHECKPOINT_MAX_BYTES = 1024 * 1024 * 1024;
export const VIDEO_CHECKPOINT_MAX_FILES = 100000;
const operations = createCheckpointFileInventory({ publishedName: /^[a-f0-9]{64}\.video\.enc$/,
  maxFiles: VIDEO_CHECKPOINT_MAX_FILES, maxTotalBytes: VIDEO_CHECKPOINT_MAX_BYTES, maxFileBytes: videoStoredBytes(MAX_VIDEO_BYTES),
  ErrorType: VideoCheckpointFilesError, errorPrefix: "VIDEO_CHECKPOINT_FILES" });
export const copyCheckpointVideo = operations.copyCheckpointFiles;
export const resumeCheckpointVideo = operations.resumeCheckpointFiles;
export const verifyCheckpointVideo = operations.verifyCheckpointFiles;
