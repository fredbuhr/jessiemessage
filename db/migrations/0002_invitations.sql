CREATE TABLE invitations (
  id VARBINARY(16) NOT NULL,
  token_hash VARBINARY(32) NOT NULL,
  created_by_id VARBINARY(16) NOT NULL,
  created_by_role VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'admin',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expires_at DATETIME(6) NOT NULL,
  access_days SMALLINT UNSIGNED NULL,
  consumed_at DATETIME(6) NULL,
  consumed_by_id VARBINARY(16) NULL,
  consumed_by_role VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'client',
  revoked_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY invitations_token_hash (token_hash),
  KEY invitations_expiry (expires_at),
  CONSTRAINT invitations_id_size CHECK (OCTET_LENGTH(id) = 16),
  CONSTRAINT invitations_token_size CHECK (OCTET_LENGTH(token_hash) = 32),
  CONSTRAINT invitations_issuer_role CHECK (created_by_role = 'admin'),
  CONSTRAINT invitations_consumer_role CHECK (consumed_by_role = 'client'),
  CONSTRAINT invitations_lifetime CHECK (expires_at > created_at),
  CONSTRAINT invitations_access_days CHECK (access_days IS NULL OR access_days BETWEEN 1 AND 3650),
  CONSTRAINT invitations_consumption CHECK (
    (consumed_at IS NULL AND consumed_by_id IS NULL) OR (
      consumed_at IS NOT NULL AND consumed_by_id IS NOT NULL
      AND consumed_at >= created_at AND consumed_at < expires_at
    )
  ),
  CONSTRAINT invitations_revocation CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT invitations_terminal_state CHECK (consumed_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT invitations_issuer FOREIGN KEY (created_by_id, created_by_role)
    REFERENCES users (id, role) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT invitations_consumer FOREIGN KEY (consumed_by_id, consumed_by_role)
    REFERENCES users (id, role) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
