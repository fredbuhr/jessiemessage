CREATE TABLE video_assets (
  id VARBINARY(16) NOT NULL,
  owner_id VARBINARY(16) NOT NULL,
  owner_role VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  storage_key VARBINARY(32) NOT NULL,
  reserve_token_hash VARBINARY(32) NOT NULL,
  content_digest VARBINARY(32) NULL,
  bytes INT UNSIGNED NOT NULL,
  stored_bytes INT UNSIGNED NOT NULL,
  mime VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'video/mp4',
  state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  released_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY video_assets_storage (storage_key),
  KEY video_assets_owner_fk (owner_id, owner_role),
  KEY video_assets_owner_state (owner_id, state, id),
  KEY video_assets_state (state, id),
  CONSTRAINT video_assets_id_size CHECK (OCTET_LENGTH(id) = 16),
  CONSTRAINT video_assets_owner_size CHECK (OCTET_LENGTH(owner_id) = 16),
  CONSTRAINT video_assets_storage_size CHECK (OCTET_LENGTH(storage_key) = 32),
  CONSTRAINT video_assets_reserve_token_size CHECK (OCTET_LENGTH(reserve_token_hash) = 32),
  CONSTRAINT video_assets_digest_size CHECK (content_digest IS NULL OR OCTET_LENGTH(content_digest) = 32),
  CONSTRAINT video_assets_owner_role CHECK (owner_role IN ('admin', 'client')),
  CONSTRAINT video_assets_bytes CHECK (bytes BETWEEN 1 AND 104857600 AND stored_bytes = 48 + bytes + 16 * ((bytes + 262143) DIV 262144)),
  CONSTRAINT video_assets_mime CHECK (mime = 'video/mp4'),
  CONSTRAINT video_assets_lifetime CHECK (updated_at >= created_at),
  CONSTRAINT video_assets_state_rules CHECK (
    (state = 'reserved' AND content_digest IS NULL AND released_at IS NULL) OR
    (state = 'committed' AND content_digest IS NOT NULL AND released_at IS NULL) OR
    (state = 'released' AND released_at IS NOT NULL AND released_at >= created_at AND released_at <= updated_at)
  ),
  CONSTRAINT video_assets_owner_fk FOREIGN KEY (owner_id, owner_role)
    REFERENCES users (id, role) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
