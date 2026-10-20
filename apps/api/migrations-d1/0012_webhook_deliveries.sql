-- Fila de reenvio dos webhooks (fase 19.4, D-092): só entregas que falharam na primeira tentativa.
CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  webhook_id TEXT NOT NULL,
  type TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  next_at INTEGER,
  last_status INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX webhook_deliveries_hook_idx ON webhook_deliveries (account_id, webhook_id, created_at);
CREATE INDEX webhook_deliveries_due_idx ON webhook_deliveries (status, next_at);
