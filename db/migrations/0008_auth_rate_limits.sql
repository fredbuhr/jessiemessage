CREATE TABLE auth_rate_limits (
  bucket_hash VARBINARY(32) NOT NULL,
  window_started_at DATETIME(6) NOT NULL,
  attempts INT UNSIGNED NOT NULL,
  PRIMARY KEY (bucket_hash),
  KEY auth_rate_limit_window (window_started_at),
  CONSTRAINT auth_rate_limit_hash_size CHECK (OCTET_LENGTH(bucket_hash) = 32),
  CONSTRAINT auth_rate_limit_attempts CHECK (attempts >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
