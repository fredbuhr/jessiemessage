CREATE TABLE crm_labels (
  id VARBINARY(16) NOT NULL,
  owner_admin_id VARBINARY(16) NOT NULL,
  owner_role VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'admin',
  kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  normalized_name VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY crm_labels_owner_id (owner_admin_id, id),
  UNIQUE KEY crm_labels_owner_name (owner_admin_id, kind, normalized_name),
  KEY crm_labels_owner_page (owner_admin_id, id),
  CONSTRAINT crm_labels_id_size CHECK (OCTET_LENGTH(id) = 16),
  CONSTRAINT crm_labels_owner_size CHECK (OCTET_LENGTH(owner_admin_id) = 16),
  CONSTRAINT crm_labels_owner_role CHECK (owner_role = 'admin'),
  CONSTRAINT crm_labels_kind CHECK (kind IN ('tag', 'group')),
  CONSTRAINT crm_labels_name_length CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 64 AND CHAR_LENGTH(normalized_name) BETWEEN 1 AND 128),
  CONSTRAINT crm_labels_version CHECK (version >= 1),
  CONSTRAINT crm_labels_lifetime CHECK (updated_at >= created_at),
  CONSTRAINT crm_labels_owner_fk FOREIGN KEY (owner_admin_id, owner_role)
    REFERENCES users (id, role) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
