-- Agregados diários do painel (fase 20.1, D-096): uma linha por conta e dia (UTC), JSON com os totais do dia.
CREATE TABLE daily_stats (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (account_id, day)
);
