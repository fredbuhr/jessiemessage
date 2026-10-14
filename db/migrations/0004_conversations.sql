CREATE TABLE conversations (
  id VARBINARY(16) NOT NULL,
  client_id VARBINARY(16) NOT NULL,
  client_role VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'client',
  admin_id VARBINARY(16) NOT NULL,
  admin_role VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'admin',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  closed_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY conversations_client (client_id),
  KEY conversations_admin (admin_id, created_at),
  CONSTRAINT conversations_id_size CHECK (OCTET_LENGTH(id) = 16),
  CONSTRAINT conversations_client_role CHECK (client_role = 'client'),
  CONSTRAINT conversations_admin_role CHECK (admin_role = 'admin'),
  CONSTRAINT conversations_distinct_people CHECK (client_id <> admin_id),
  CONSTRAINT conversations_lifetime CHECK (closed_at IS NULL OR closed_at >= created_at),
  CONSTRAINT conversations_client_fk FOREIGN KEY (client_id, client_role)
    REFERENCES users (id, role) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT conversations_admin_fk FOREIGN KEY (admin_id, admin_role)
    REFERENCES users (id, role) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
