CREATE TABLE broadcast_preferences (
  user_id VARBINARY(16) NOT NULL,
  enabled TINYINT UNSIGNED NOT NULL DEFAULT 0,
  version BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT broadcast_preferences_user_size CHECK (OCTET_LENGTH(user_id) = 16),
  CONSTRAINT broadcast_preferences_enabled CHECK (enabled IN (0, 1)),
  CONSTRAINT broadcast_preferences_version CHECK (version >= 1),
  CONSTRAINT broadcast_preferences_dates CHECK (updated_at >= created_at),
  CONSTRAINT broadcast_preferences_user_fk FOREIGN KEY (user_id)
    REFERENCES client_auth_state (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
