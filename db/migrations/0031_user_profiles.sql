CREATE TABLE user_profiles (
  user_id VARBINARY(16) NOT NULL,
  avatar_media_id VARBINARY(16) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id),
  KEY user_profiles_avatar (avatar_media_id),
  CONSTRAINT user_profiles_user_size CHECK (OCTET_LENGTH(user_id) = 16),
  CONSTRAINT user_profiles_avatar_size CHECK (avatar_media_id IS NULL OR OCTET_LENGTH(avatar_media_id) = 16),
  CONSTRAINT user_profiles_version CHECK (version >= 1),
  CONSTRAINT user_profiles_lifetime CHECK (updated_at >= created_at),
  CONSTRAINT user_profiles_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT user_profiles_avatar_fk FOREIGN KEY (avatar_media_id)
    REFERENCES media_assets (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
