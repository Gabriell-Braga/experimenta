-- Segurança de acesso (fase 16.5, D-073): TOTP por pessoa (JSON em users.mfa), exigência por conta e
-- sessões de login revogáveis (o JWT carrega o id da sessão).
ALTER TABLE accounts ADD COLUMN require_totp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN mfa TEXT;
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);
