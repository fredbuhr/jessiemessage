CREATE TABLE message_video (
  message_id VARBINARY(16) NOT NULL,
  conversation_id VARBINARY(16) NOT NULL,
  video_id VARBINARY(16) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (message_id),
  KEY message_video_message (conversation_id, message_id),
  KEY message_video_asset (video_id, message_id),
  CONSTRAINT message_video_message_size CHECK (OCTET_LENGTH(message_id) = 16),
  CONSTRAINT message_video_conversation_size CHECK (OCTET_LENGTH(conversation_id) = 16),
  CONSTRAINT message_video_asset_size CHECK (OCTET_LENGTH(video_id) = 16),
  CONSTRAINT message_video_message_fk FOREIGN KEY (conversation_id, message_id)
    REFERENCES messages (conversation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT message_video_asset_fk FOREIGN KEY (video_id)
    REFERENCES video_assets (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
