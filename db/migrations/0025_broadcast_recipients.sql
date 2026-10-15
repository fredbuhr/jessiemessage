CREATE TABLE broadcast_recipients (
  campaign_id VARBINARY(16) NOT NULL,
  conversation_id VARBINARY(16) NOT NULL,
  client_id VARBINARY(16) NOT NULL,
  proposed_message_id VARBINARY(16) NOT NULL,
  client_message_id VARBINARY(16) NOT NULL,
  delivered_message_id VARBINARY(16) NULL,
  state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  reason VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  lease_token VARBINARY(16) NULL,
  lease_until DATETIME(6) NULL,
  delivered_at DATETIME(6) NULL,
  PRIMARY KEY (campaign_id, conversation_id),
  UNIQUE KEY broadcast_recipients_message (proposed_message_id),
  UNIQUE KEY broadcast_recipients_client_message (client_message_id),
  KEY broadcast_recipients_ready (state, available_at, campaign_id),
  KEY broadcast_recipients_lease (state, lease_until),
  KEY broadcast_recipients_client (client_id),
  KEY broadcast_recipients_delivered (conversation_id, delivered_message_id),
  CONSTRAINT broadcast_recipients_campaign_size CHECK (OCTET_LENGTH(campaign_id) = 16),
  CONSTRAINT broadcast_recipients_conversation_size CHECK (OCTET_LENGTH(conversation_id) = 16),
  CONSTRAINT broadcast_recipients_client_size CHECK (OCTET_LENGTH(client_id) = 16),
  CONSTRAINT broadcast_recipients_message_size CHECK (OCTET_LENGTH(proposed_message_id) = 16),
  CONSTRAINT broadcast_recipients_client_message_size CHECK (OCTET_LENGTH(client_message_id) = 16),
  CONSTRAINT broadcast_recipients_state CHECK (state IN ('pending', 'sending', 'delivered', 'skipped', 'cancelled', 'failed')),
  CONSTRAINT broadcast_recipients_attempts CHECK (attempts <= 8),
  CONSTRAINT broadcast_recipients_dates CHECK (available_at >= created_at),
  CONSTRAINT broadcast_recipients_lease_pair CHECK (
    (state = 'sending' AND lease_token IS NOT NULL AND OCTET_LENGTH(lease_token) = 16 AND lease_until IS NOT NULL AND lease_until > created_at) OR
    (state <> 'sending' AND lease_token IS NULL AND lease_until IS NULL)
  ),
  CONSTRAINT broadcast_recipients_delivery CHECK (
    (state = 'delivered' AND delivered_message_id = proposed_message_id AND delivered_message_id IS NOT NULL AND delivered_at IS NOT NULL AND delivered_at >= created_at) OR
    (state <> 'delivered' AND delivered_message_id IS NULL AND delivered_at IS NULL)
  ),
  CONSTRAINT broadcast_recipients_reason CHECK (
    (state IN ('pending', 'sending', 'delivered') AND reason IS NULL) OR
    (state = 'cancelled' AND reason IS NOT NULL AND reason IN ('cancelled', 'administrator_invalid')) OR
    (state = 'failed' AND reason IS NOT NULL AND reason = 'processing_failed') OR
    (state = 'skipped' AND reason IS NOT NULL AND reason IN ('access_inactive', 'opted_out', 'conversation_unavailable', 'media_unavailable', 'repeat_media', 'expired'))
  ),
  CONSTRAINT broadcast_recipients_campaign_fk FOREIGN KEY (campaign_id)
    REFERENCES broadcast_campaigns (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT broadcast_recipients_conversation_fk FOREIGN KEY (conversation_id)
    REFERENCES conversations (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT broadcast_recipients_client_fk FOREIGN KEY (client_id)
    REFERENCES client_auth_state (user_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT broadcast_recipients_delivered_fk FOREIGN KEY (conversation_id, delivered_message_id)
    REFERENCES messages (conversation_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
