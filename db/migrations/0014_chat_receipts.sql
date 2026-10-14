CREATE TABLE chat_receipts (
  conversation_id VARBINARY(16) NOT NULL,
  user_id VARBINARY(16) NOT NULL,
  last_read_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT chat_receipts_conversation_size CHECK (OCTET_LENGTH(conversation_id) = 16),
  CONSTRAINT chat_receipts_user_size CHECK (OCTET_LENGTH(user_id) = 16),
  CONSTRAINT chat_receipts_conversation_fk FOREIGN KEY (conversation_id)
    REFERENCES conversations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chat_receipts_user_fk FOREIGN KEY (user_id)
    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
