CREATE TABLE media_assets (
  id VARBINARY(16) NOT NULL,
  owner_id VARBINARY(16) NOT NULL,
  owner_role VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  storage_key VARBINARY(32) NOT NULL,
  content_digest VARBINARY(32) NOT NULL,
  active_digest VARBINARY(32) NULL,
  mime VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'image/jpeg',
  width SMALLINT UNSIGNED NOT NULL,
  height SMALLINT UNSIGNED NOT NULL,
  thumbnail_width SMALLINT UNSIGNED NOT NULL,
  thumbnail_height SMALLINT UNSIGNED NOT NULL,
  full_bytes INT UNSIGNED NOT NULL,
  thumbnail_bytes INT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL,
  deleted_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY media_assets_storage (storage_key),
  UNIQUE KEY media_assets_owner_digest (owner_id, active_digest),
  KEY media_assets_owner_page (owner_id, id),
  CONSTRAINT media_assets_id_size CHECK (OCTET_LENGTH(id) = 16),
  CONSTRAINT media_assets_owner_size CHECK (OCTET_LENGTH(owner_id) = 16),
  CONSTRAINT media_assets_storage_size CHECK (OCTET_LENGTH(storage_key) = 32),
  CONSTRAINT media_assets_digest_size CHECK (OCTET_LENGTH(content_digest) = 32),
  CONSTRAINT media_assets_owner_role CHECK (owner_role IN ('admin', 'client')),
  CONSTRAINT media_assets_mime CHECK (mime = 'image/jpeg'),
  CONSTRAINT media_assets_dimensions CHECK (width BETWEEN 1 AND 2048 AND height BETWEEN 1 AND 2048),
  CONSTRAINT media_assets_thumbnail_dimensions CHECK (thumbnail_width BETWEEN 1 AND 480 AND thumbnail_height BETWEEN 1 AND 480 AND thumbnail_width <= width AND thumbnail_height <= height),
  CONSTRAINT media_assets_bytes CHECK (full_bytes BETWEEN 1 AND 10485760 AND thumbnail_bytes BETWEEN 1 AND 524288),
  CONSTRAINT media_assets_active_state CHECK (
    (deleted_at IS NULL AND active_digest IS NOT NULL AND active_digest = content_digest) OR
    (deleted_at IS NOT NULL AND active_digest IS NULL AND deleted_at >= created_at)
  ),
  CONSTRAINT media_assets_owner_fk FOREIGN KEY (owner_id, owner_role)
    REFERENCES users (id, role) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
