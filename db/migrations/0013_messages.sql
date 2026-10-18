CREATE TABLE messages (
  id VARBINARY(16) NOT NULL,
  conversation_id VARBINARY(16) NOT NULL,
  sequence_no BIGINT UNSIGNED NOT NULL,
  sender_id VARBINARY(16) NOT NULL,
  sender_role VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  client_message_id VARBINARY(16) NOT NULL,
  body_encrypted VARCHAR(22000) CHARACTER SET ascii COLLATE ascii_bin NULL,
  body_fingerprint VARBINARY(32) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  deleted_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY messages_conversation_sequence (conversation_id, sequence_no),
  UNIQUE KEY messages_idempotency (conversation_id, sender_id, client_message_id),
  UNIQUE KEY messages_conversation_id (conversation_id, id),
  CONSTRAINT messages_id_size CHECK (OCTET_LENGTH(id) = 16),
  CONSTRAINT messages_conversation_size CHECK (OCTET_LENGTH(conversation_id) = 16),
  CONSTRAINT messages_sender_size CHECK (OCTET_LENGTH(sender_id) = 16),
  CONSTRAINT messages_client_id_size CHECK (OCTET_LENGTH(client_message_id) = 16),
  CONSTRAINT messages_fingerprint_size CHECK (OCTET_LENGTH(body_fingerprint) = 32),
  CONSTRAINT messages_sequence CHECK (sequence_no >= 1),
  CONSTRAINT messages_sender_role CHECK (sender_role IN ('admin', 'client')),
  CONSTRAINT messages_body_state CHECK (
    (deleted_at IS NULL AND body_encrypted IS NOT NULL AND CHAR_LENGTH(body_encrypted) BETWEEN 1 AND 22000) OR
    (deleted_at IS NOT NULL AND body_encrypted IS NULL AND deleted_at >= created_at)
  ),
  CONSTRAINT messages_conversation_fk FOREIGN KEY (conversation_id)
    REFERENCES conversations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT messages_sender_fk FOREIGN KEY (sender_id, sender_role)
    REFERENCES users (id, role) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
