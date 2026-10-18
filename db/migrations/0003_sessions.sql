CREATE TABLE sessions (
  id VARBINARY(16) NOT NULL,
  user_id VARBINARY(16) NOT NULL,
  token_hash VARBINARY(32) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY sessions_token_hash (token_hash),
  KEY sessions_user_expiry (user_id, expires_at),
  KEY sessions_expiry (expires_at),
  CONSTRAINT sessions_id_size CHECK (OCTET_LENGTH(id) = 16),
  CONSTRAINT sessions_token_size CHECK (OCTET_LENGTH(token_hash) = 32),
  CONSTRAINT sessions_lifetime CHECK (expires_at > created_at),
  CONSTRAINT sessions_revocation CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT sessions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
