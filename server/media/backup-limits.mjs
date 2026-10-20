// The existing checkpoint/PC format bounds encrypted media, independently of
// the persisted storage quotas. One allocation can publish two encrypted files.
export const BACKUP_MEDIA_MAX_BYTES = 1024 * 1024 * 1024;
export const BACKUP_MEDIA_MAX_FILES = 100000;
export const BACKUP_MEDIA_MAX_OBJECTS = BACKUP_MEDIA_MAX_FILES / 2;
