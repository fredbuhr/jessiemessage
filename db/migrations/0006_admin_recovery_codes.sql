CREATE TABLE admin_recovery_codes (
  user_id VARBINARY(16) NOT NULL,
  code_hash VARBINARY(32) NOT NULL,
  mfa_version INT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL,
  consumed_at DATETIME(6) NULL,
  PRIMARY KEY (user_id, code_hash),
  CONSTRAINT admin_recovery_user_size CHECK (OCTET_LENGTH(user_id) = 16),
  CONSTRAINT admin_recovery_hash_size CHECK (OCTET_LENGTH(code_hash) = 32),
  CONSTRAINT admin_recovery_version CHECK (mfa_version >= 1),
  CONSTRAINT admin_recovery_lifetime CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CONSTRAINT admin_recovery_user_fk FOREIGN KEY (user_id)
    REFERENCES admin_mfa (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
