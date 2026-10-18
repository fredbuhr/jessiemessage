CREATE TABLE admin_mfa (
  user_id VARBINARY(16) NOT NULL,
  role VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'admin',
  secret_encrypted VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  last_totp_step BIGINT NOT NULL DEFAULT -1,
  enabled_at DATETIME(6) NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT admin_mfa_user_size CHECK (OCTET_LENGTH(user_id) = 16),
  CONSTRAINT admin_mfa_role CHECK (role = 'admin'),
  CONSTRAINT admin_mfa_secret CHECK (CHAR_LENGTH(secret_encrypted) BETWEEN 1 AND 512),
  CONSTRAINT admin_mfa_version CHECK (version >= 1),
  CONSTRAINT admin_mfa_step CHECK (last_totp_step >= -1),
  CONSTRAINT admin_mfa_enrollment CHECK (
    (enabled_at IS NULL AND last_totp_step = -1) OR
    (enabled_at IS NOT NULL AND last_totp_step >= 0)
  ),
  CONSTRAINT admin_mfa_user_fk FOREIGN KEY (user_id, role)
    REFERENCES users (id, role) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
