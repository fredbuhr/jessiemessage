CREATE TABLE push_outbox (
  id VARBINARY(16) NOT NULL,
  message_id VARBINARY(16) NOT NULL,
  subscription_id VARBINARY(16) NOT NULL,
  subscription_generation INT UNSIGNED NOT NULL,
  status VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  lease_token VARBINARY(16) NULL,
  lease_until DATETIME(6) NULL,
  finished_at DATETIME(6) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY push_outbox_delivery (message_id, subscription_id),
  KEY push_outbox_ready (status, available_at, id),
  KEY push_outbox_lease (status, lease_until),
  KEY push_outbox_subscription (subscription_id),
  KEY push_outbox_finished (status, finished_at, id),
  CONSTRAINT push_outbox_id_size CHECK (OCTET_LENGTH(id) = 16),
  CONSTRAINT push_outbox_message_size CHECK (OCTET_LENGTH(message_id) = 16),
  CONSTRAINT push_outbox_subscription_size CHECK (OCTET_LENGTH(subscription_id) = 16),
  CONSTRAINT push_outbox_generation CHECK (subscription_generation >= 1),
  CONSTRAINT push_outbox_status CHECK (status IN ('pending', 'sending', 'accepted', 'skipped', 'failed')),
  CONSTRAINT push_outbox_attempts CHECK (attempts <= 6),
  CONSTRAINT push_outbox_dates CHECK (available_at >= created_at AND expires_at > created_at),
  CONSTRAINT push_outbox_lease_pair CHECK (
    (status = 'sending' AND lease_token IS NOT NULL AND OCTET_LENGTH(lease_token) = 16 AND lease_until IS NOT NULL AND lease_until > created_at) OR
    (status <> 'sending' AND lease_token IS NULL AND lease_until IS NULL)
  ),
  CONSTRAINT push_outbox_finished CHECK (
    (status IN ('accepted', 'skipped', 'failed') AND finished_at IS NOT NULL AND finished_at >= created_at) OR
    (status IN ('pending', 'sending') AND finished_at IS NULL)
  ),
  CONSTRAINT push_outbox_message_fk FOREIGN KEY (message_id)
    REFERENCES messages (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT push_outbox_subscription_fk FOREIGN KEY (subscription_id)
    REFERENCES push_subscriptions (id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
