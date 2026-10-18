CREATE TABLE crm_profiles (
  admin_id VARBINARY(16) NOT NULL,
  admin_role VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'admin',
  conversation_id VARBINARY(16) NOT NULL,
  nickname VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT '',
  notes_encrypted VARCHAR(44000) CHARACTER SET ascii COLLATE ascii_bin NULL,
  reminder_at DATETIME(6) NULL,
  version INT UNSIGNED NOT NULL,
  notes_revision INT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (admin_id, conversation_id),
  KEY crm_profiles_reminders (admin_id, reminder_at, conversation_id),
  CONSTRAINT crm_profiles_admin_size CHECK (OCTET_LENGTH(admin_id) = 16),
  CONSTRAINT crm_profiles_conversation_size CHECK (OCTET_LENGTH(conversation_id) = 16),
  CONSTRAINT crm_profiles_admin_role CHECK (admin_role = 'admin'),
  CONSTRAINT crm_profiles_notes_length CHECK (notes_encrypted IS NULL OR CHAR_LENGTH(notes_encrypted) BETWEEN 1 AND 44000),
  CONSTRAINT crm_profiles_version CHECK (version >= 1 AND notes_revision >= 1 AND notes_revision <= version),
  CONSTRAINT crm_profiles_lifetime CHECK (updated_at >= created_at),
  CONSTRAINT crm_profiles_admin_fk FOREIGN KEY (admin_id, admin_role)
    REFERENCES users (id, role) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT crm_profiles_conversation_fk FOREIGN KEY (conversation_id)
    REFERENCES conversations (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
