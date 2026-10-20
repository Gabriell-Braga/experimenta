-- Histórico de atividades (auditoria, fase 16.3).
CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id TEXT,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  target_name TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX activities_account_ts_idx ON activities(account_id, created_at);
CREATE INDEX activities_target_idx ON activities(account_id, target_id);
