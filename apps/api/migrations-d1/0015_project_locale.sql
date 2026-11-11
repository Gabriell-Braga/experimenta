-- Localização do site (fase 22, D-110): pt-BR, en ou es.
ALTER TABLE projects ADD COLUMN locale TEXT NOT NULL DEFAULT 'pt-BR';
