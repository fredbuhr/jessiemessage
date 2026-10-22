// The existing archive bounds photos and videos together, independently of
// persisted storage quotas. A photo allocation may add a second catalogue row
// and publishes two encrypted files; a video allocation uses one of each.
export const BACKUP_MEDIA_MAX_BYTES = 1024 * 1024 * 1024;
export const BACKUP_MEDIA_MAX_FILES = 100000;
export const BACKUP_MEDIA_MAX_OBJECTS = BACKUP_MEDIA_MAX_FILES / 2;
export const BACKUP_MEDIA_MAX_RECORDS = 100000;
