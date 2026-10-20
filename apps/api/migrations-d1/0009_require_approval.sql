-- Aprovação de publicação por conta (fase 16.4, D-072). 0 = quem pode editar publica direto.
ALTER TABLE accounts ADD COLUMN require_approval INTEGER NOT NULL DEFAULT 0;
