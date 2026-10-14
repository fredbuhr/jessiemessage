CREATE TABLE chat_events (
  conversation_id VARBINARY(16) NOT NULL,
  event_sequence BIGINT UNSIGNED NOT NULL,
  message_id VARBINARY(16) NOT NULL,
  kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  PRIMARY KEY (conversation_id, event_sequence),
  KEY chat_events_message (conversation_id, message_id),
  CONSTRAINT chat_events_conversation_size CHECK (OCTET_LENGTH(conversation_id) = 16),
  CONSTRAINT chat_events_message_size CHECK (OCTET_LENGTH(message_id) = 16),
  CONSTRAINT chat_events_sequence CHECK (event_sequence >= 1),
  CONSTRAINT chat_events_kind CHECK (kind IN ('message', 'delete')),
  CONSTRAINT chat_events_message_fk FOREIGN KEY (conversation_id, message_id)
    REFERENCES messages (conversation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
