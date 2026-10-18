CREATE TABLE auth_session_state (
  session_id VARBINARY(16) NOT NULL,
  last_seen_at DATETIME(6) NOT NULL,
  mfa_verified_at DATETIME(6) NOT NULL,
  mfa_version INT UNSIGNED NOT NULL,
  PRIMARY KEY (session_id),
  CONSTRAINT auth_session_id_size CHECK (OCTET_LENGTH(session_id) = 16),
  CONSTRAINT auth_session_mfa_version CHECK (mfa_version >= 1),
  CONSTRAINT auth_session_seen CHECK (last_seen_at >= mfa_verified_at),
  CONSTRAINT auth_session_parent_fk FOREIGN KEY (session_id)
    REFERENCES sessions (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
