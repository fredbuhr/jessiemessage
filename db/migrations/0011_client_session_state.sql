CREATE TABLE client_session_state (
  session_id VARBINARY(16) NOT NULL,
  last_seen_at DATETIME(6) NOT NULL,
  credential_version INT UNSIGNED NOT NULL,
  PRIMARY KEY (session_id),
  CONSTRAINT client_session_id_size CHECK (OCTET_LENGTH(session_id) = 16),
  CONSTRAINT client_session_version CHECK (credential_version >= 1),
  CONSTRAINT client_session_parent_fk FOREIGN KEY (session_id)
    REFERENCES sessions (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
