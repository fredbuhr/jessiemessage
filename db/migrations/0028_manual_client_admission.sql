ALTER TABLE users
  DROP CONSTRAINT users_active_client_gates,
  ADD CONSTRAINT users_active_client_gates CHECK (
    role <> 'client' OR status <> 'active' OR (
      email_verified_at IS NOT NULL AND access_approved_at IS NOT NULL
    )
  );
