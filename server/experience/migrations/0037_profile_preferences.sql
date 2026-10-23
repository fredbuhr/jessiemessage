CREATE TABLE profile_preferences (
  user_id VARBINARY(16) NOT NULL,
  version INT UNSIGNED NOT NULL,
  selection_encrypted MEDIUMTEXT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id),
  CONSTRAINT profile_preferences_user_size CHECK (OCTET_LENGTH(user_id) = 16),
  CONSTRAINT profile_preferences_version CHECK (version >= 1),
  CONSTRAINT profile_preferences_selection_size CHECK (OCTET_LENGTH(selection_encrypted) >= 1 AND OCTET_LENGTH(selection_encrypted) <= 90000),
  CONSTRAINT profile_preferences_lifetime CHECK (updated_at >= created_at),
  CONSTRAINT profile_preferences_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
