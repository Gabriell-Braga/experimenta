-- Tipo de campanha / MVT / alocação / audiências (fase 12) e extras da variação.
ALTER TABLE experiments ADD COLUMN options TEXT NOT NULL DEFAULT '{}';
ALTER TABLE variations ADD COLUMN extra TEXT NOT NULL DEFAULT '{}';
