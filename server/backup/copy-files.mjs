import { createPrivateJsonStore } from "../files/private-json.mjs";
import { BackupCopyError, failCopy, emptyCopyState, validateCopyState } from "./copy-state.mjs";

const store = createPrivateJsonStore({ name: "backup-copy-state.json", lock: "backup-copy-state.lock", maxBytes: 32768,
  validate: validateCopyState, empty: emptyCopyState, fail: failCopy, isKnownError: error => error instanceof BackupCopyError });
export const readCopyState = store.read;
export const saveCopyState = store.save;
