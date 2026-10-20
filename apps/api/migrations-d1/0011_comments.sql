-- Comentários e menções (fase 16.6).
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  body TEXT NOT NULL,
  mentions TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX comments_target_idx ON comments(account_id, target_id, created_at);
