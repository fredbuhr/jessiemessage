CREATE TABLE media_storage_objects (
  id VARBINARY(16) NOT NULL,
  owner_id VARBINARY(16) NOT NULL,
  owner_role VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  storage_key VARBINARY(32) NOT NULL,
  content_digest VARBINARY(32) NOT NULL,
  full_bytes INT UNSIGNED NOT NULL,
  thumbnail_bytes INT UNSIGNED NOT NULL,
  stored_bytes INT UNSIGNED NOT NULL,
  state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  asset_id VARBINARY(16) NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  released_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY media_storage_objects_key (storage_key),
  UNIQUE KEY media_storage_objects_asset (asset_id),
  KEY media_storage_objects_owner (owner_id, state, id),
  KEY media_storage_objects_state (state, id),
  CONSTRAINT media_storage_objects_id_size CHECK (OCTET_LENGTH(id) = 16),
  CONSTRAINT media_storage_objects_owner_size CHECK (OCTET_LENGTH(owner_id) = 16),
  CONSTRAINT media_storage_objects_key_size CHECK (OCTET_LENGTH(storage_key) = 32),
  CONSTRAINT media_storage_objects_digest_size CHECK (OCTET_LENGTH(content_digest) = 32),
  CONSTRAINT media_storage_objects_role CHECK (owner_role IN ('admin', 'client')),
  CONSTRAINT media_storage_objects_bytes CHECK (full_bytes BETWEEN 1 AND 10485760 AND thumbnail_bytes BETWEEN 1 AND 524288 AND stored_bytes = full_bytes + thumbnail_bytes + 80),
  CONSTRAINT media_storage_objects_asset_id CHECK (asset_id IS NULL OR asset_id = id),
  CONSTRAINT media_storage_objects_lifetime CHECK (updated_at >= created_at),
  CONSTRAINT media_storage_objects_state_rules CHECK (
    (state = 'reserved' AND asset_id IS NULL AND released_at IS NULL) OR
    (state = 'registered' AND asset_id IS NOT NULL AND released_at IS NULL) OR
    (state = 'cleanup_pending' AND released_at IS NULL) OR
    (state = 'released' AND released_at IS NOT NULL AND released_at >= created_at AND released_at <= updated_at)
  ),
  CONSTRAINT media_storage_objects_owner_fk FOREIGN KEY (owner_id, owner_role)
    REFERENCES users (id, role) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT media_storage_objects_asset_fk FOREIGN KEY (asset_id)
    REFERENCES media_assets (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
