CREATE TABLE media_storage_state (
  id TINYINT UNSIGNED NOT NULL,
  owner_bytes BIGINT UNSIGNED NOT NULL,
  total_bytes BIGINT UNSIGNED NOT NULL,
  root_fingerprint VARBINARY(32) NOT NULL,
  held_bytes BIGINT UNSIGNED NOT NULL,
  initialized_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT media_storage_state_singleton CHECK (id = 1),
  CONSTRAINT media_storage_state_limits CHECK (owner_bytes BETWEEN 1 AND 9007199254740991 AND total_bytes BETWEEN owner_bytes AND 9007199254740991),
  CONSTRAINT media_storage_state_root_size CHECK (OCTET_LENGTH(root_fingerprint) = 32),
  CONSTRAINT media_storage_state_held CHECK (held_bytes BETWEEN 0 AND 9007199254740991)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
