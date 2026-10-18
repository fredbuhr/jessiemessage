CREATE TABLE mail_outbox (
  id VARBINARY(16) NOT NULL,
  verification_id VARBINARY(16) NOT NULL,
  recipient_user_id VARBINARY(16) NOT NULL,
  payload_encrypted VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  created_at DATETIME(6) NOT NULL,
  lease_token VARBINARY(16) NULL,
  lease_until DATETIME(6) NULL,
  sent_at DATETIME(6) NULL,
  last_error VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (id),
  KEY mail_outbox_ready (status, available_at),
  KEY mail_outbox_lease (lease_until),
  KEY mail_outbox_expiry (expires_at),
  KEY mail_outbox_sent (sent_at),
  KEY mail_outbox_verification (verification_id, recipient_user_id),
  CONSTRAINT mail_outbox_id_size CHECK (OCTET_LENGTH(id) = 16),
  CONSTRAINT mail_outbox_verification_size CHECK (OCTET_LENGTH(verification_id) = 16),
  CONSTRAINT mail_outbox_user_size CHECK (OCTET_LENGTH(recipient_user_id) = 16),
  CONSTRAINT mail_outbox_payload CHECK (CHAR_LENGTH(payload_encrypted) BETWEEN 1 AND 1024),
  CONSTRAINT mail_outbox_status CHECK (status IN ('pending', 'sending', 'sent', 'cancelled', 'failed')),
  CONSTRAINT mail_outbox_attempts CHECK (attempts <= 8),
  CONSTRAINT mail_outbox_dates CHECK (expires_at > created_at AND available_at >= created_at),
  CONSTRAINT mail_outbox_lease_pair CHECK (
    (status = 'sending' AND lease_token IS NOT NULL AND OCTET_LENGTH(lease_token) = 16 AND lease_until IS NOT NULL AND lease_until > created_at) OR
    (status <> 'sending' AND lease_token IS NULL AND lease_until IS NULL)
  ),
  CONSTRAINT mail_outbox_sent_date CHECK (
    (status = 'sent' AND sent_at IS NOT NULL AND sent_at >= created_at) OR
    (status <> 'sent' AND sent_at IS NULL)
  ),
  CONSTRAINT mail_outbox_error CHECK (last_error IS NULL OR last_error IN ('MAIL_DELIVERY_FAILED', 'PAYLOAD_INVALID')),
  CONSTRAINT mail_outbox_verification_fk FOREIGN KEY (verification_id, recipient_user_id)
    REFERENCES email_verifications (id, user_id) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
