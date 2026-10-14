CREATE TABLE email_verifications (
  id VARBINARY(16) NOT NULL,
  user_id VARBINARY(16) NOT NULL,
  token_hash VARBINARY(32) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  consumed_at DATETIME(6) NULL,
  revoked_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY email_verifications_token_hash (token_hash),
  UNIQUE KEY email_verifications_id_user (id, user_id),
  KEY email_verifications_user (user_id, created_at),
  KEY email_verifications_expiry (expires_at),
  CONSTRAINT email_verification_id_size CHECK (OCTET_LENGTH(id) = 16),
  CONSTRAINT email_verification_user_size CHECK (OCTET_LENGTH(user_id) = 16),
  CONSTRAINT email_verification_token_size CHECK (OCTET_LENGTH(token_hash) = 32),
  CONSTRAINT email_verification_lifetime CHECK (expires_at > created_at),
  CONSTRAINT email_verification_consumption CHECK (
    consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at < expires_at)
  ),
  CONSTRAINT email_verification_revocation CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT email_verification_terminal CHECK (consumed_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT email_verification_user_fk FOREIGN KEY (user_id)
    REFERENCES client_auth_state (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
