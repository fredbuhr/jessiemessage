ALTER TABLE crm_tasks
  ADD COLUMN reply_kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN reply_through BIGINT UNSIGNED NULL,
  ADD COLUMN reply_reopened TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD UNIQUE KEY crm_tasks_reply (admin_id, conversation_id, reply_kind),
  ADD CONSTRAINT crm_tasks_reply_state CHECK ((reply_kind IS NULL AND reply_through IS NULL AND reply_reopened = 0) OR (reply_kind = 'reply' AND reply_through IS NOT NULL AND reply_reopened IN (0, 1)));
