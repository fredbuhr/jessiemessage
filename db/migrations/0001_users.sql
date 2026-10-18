CREATE TABLE users (
  id VARBINARY(16) NOT NULL,
  role VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  pseudonym VARCHAR(64) NOT NULL,
  email VARCHAR(254) COLLATE utf8mb4_bin NOT NULL,
  password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  email_verified_at DATETIME(6) NULL,
  age_assured_at DATETIME(6) NULL,
  access_approved_at DATETIME(6) NULL,
  access_expires_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY users_id_role (id, role),
  UNIQUE KEY users_email (email),
  CONSTRAINT users_id_size CHECK (OCTET_LENGTH(id) = 16),
  CONSTRAINT users_role CHECK (role IN ('admin', 'client')),
  CONSTRAINT users_status CHECK (status IN ('pending', 'active', 'suspended', 'revoked', 'deleted')),
  CONSTRAINT users_pseudonym CHECK (CHAR_LENGTH(TRIM(pseudonym)) BETWEEN 1 AND 64),
  CONSTRAINT users_active_client_gates CHECK (
    role <> 'client' OR status <> 'active' OR (
      email_verified_at IS NOT NULL AND age_assured_at IS NOT NULL AND access_approved_at IS NOT NULL
    )
  ),
  CONSTRAINT users_access_lifetime CHECK (
    access_expires_at IS NULL OR (access_approved_at IS NOT NULL AND access_expires_at > access_approved_at)
  )
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
