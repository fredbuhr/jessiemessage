CREATE TABLE crm_tasks (
  id VARBINARY(16) NOT NULL,
  admin_id VARBINARY(16) NOT NULL,
  admin_role VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'admin',
  conversation_id VARBINARY(16) NOT NULL,
  title_encrypted VARCHAR(4096) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  due_at DATETIME(6) NULL,
  done TINYINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL,
  request_fingerprint VARBINARY(32) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  KEY crm_tasks_due (admin_id, done, due_at, id),
  KEY crm_tasks_conversation (admin_id, conversation_id, id),
  CONSTRAINT crm_tasks_id_size CHECK (OCTET_LENGTH(id) = 16),
  CONSTRAINT crm_tasks_admin_size CHECK (OCTET_LENGTH(admin_id) = 16),
  CONSTRAINT crm_tasks_conversation_size CHECK (OCTET_LENGTH(conversation_id) = 16),
  CONSTRAINT crm_tasks_fingerprint_size CHECK (OCTET_LENGTH(request_fingerprint) = 32),
  CONSTRAINT crm_tasks_admin_role CHECK (admin_role = 'admin'),
  CONSTRAINT crm_tasks_title CHECK (CHAR_LENGTH(title_encrypted) BETWEEN 1 AND 4096),
  CONSTRAINT crm_tasks_done CHECK (done IN (0, 1)),
  CONSTRAINT crm_tasks_version CHECK (version >= 1),
  CONSTRAINT crm_tasks_lifetime CHECK (updated_at >= created_at),
  CONSTRAINT crm_tasks_admin_fk FOREIGN KEY (admin_id, admin_role)
    REFERENCES users (id, role) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT crm_tasks_conversation_fk FOREIGN KEY (conversation_id)
    REFERENCES conversations (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
