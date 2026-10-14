CREATE TABLE crm_memberships (
  admin_id VARBINARY(16) NOT NULL,
  conversation_id VARBINARY(16) NOT NULL,
  label_id VARBINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (admin_id, conversation_id, label_id),
  KEY crm_memberships_label (admin_id, label_id, conversation_id),
  CONSTRAINT crm_memberships_admin_size CHECK (OCTET_LENGTH(admin_id) = 16),
  CONSTRAINT crm_memberships_conversation_size CHECK (OCTET_LENGTH(conversation_id) = 16),
  CONSTRAINT crm_memberships_label_size CHECK (OCTET_LENGTH(label_id) = 16),
  CONSTRAINT crm_memberships_profile_fk FOREIGN KEY (admin_id, conversation_id)
    REFERENCES crm_profiles (admin_id, conversation_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT crm_memberships_label_fk FOREIGN KEY (admin_id, label_id)
    REFERENCES crm_labels (owner_admin_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
