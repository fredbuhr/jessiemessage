CREATE TABLE message_media (
  message_id VARBINARY(16) NOT NULL,
  conversation_id VARBINARY(16) NOT NULL,
  media_id VARBINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (message_id),
  KEY message_media_message (conversation_id, message_id),
  KEY message_media_asset (media_id, message_id),
  CONSTRAINT message_media_message_size CHECK (OCTET_LENGTH(message_id) = 16),
  CONSTRAINT message_media_conversation_size CHECK (OCTET_LENGTH(conversation_id) = 16),
  CONSTRAINT message_media_asset_size CHECK (OCTET_LENGTH(media_id) = 16),
  CONSTRAINT message_media_message_fk FOREIGN KEY (conversation_id, message_id)
    REFERENCES messages (conversation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT message_media_asset_fk FOREIGN KEY (media_id)
    REFERENCES media_assets (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
