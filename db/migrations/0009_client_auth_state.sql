CREATE TABLE client_auth_state (
  user_id VARBINARY(16) NOT NULL,
  role VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'client',
  credential_version INT UNSIGNED NOT NULL DEFAULT 1,
  age_declared_at DATETIME(6) NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT client_auth_user_size CHECK (OCTET_LENGTH(user_id) = 16),
  CONSTRAINT client_auth_role CHECK (role = 'client'),
  CONSTRAINT client_auth_version CHECK (credential_version >= 1),
  CONSTRAINT client_auth_user_fk FOREIGN KEY (user_id, role)
    REFERENCES users (id, role) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
