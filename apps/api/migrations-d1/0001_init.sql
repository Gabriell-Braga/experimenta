-- Schema SQLite para Cloudflare D1 (espelho de src/schema.ts, que é Postgres).
-- Datas em epoch ms (INTEGER); JSON em TEXT. account_id em todas as tabelas de tenant.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner','editor','viewer')),
  can_publish_js INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX users_account_idx ON users(account_id);
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  site_url TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX projects_account_idx ON projects(account_id);
CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  traffic REAL NOT NULL DEFAULT 100,
  segmentation TEXT NOT NULL,
  anti_flicker TEXT NOT NULL,
  editor_url TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX experiments_account_key_uq ON experiments(account_id, key);
CREATE TABLE variations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  weight INTEGER NOT NULL,
  operations TEXT NOT NULL,
  custom_css TEXT NOT NULL DEFAULT '',
  custom_js TEXT NOT NULL DEFAULT '',
  redirect TEXT
);
CREATE INDEX variations_exp_idx ON variations(account_id, experiment_id);
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  position INTEGER NOT NULL,
  definition TEXT NOT NULL
);
CREATE INDEX goals_exp_idx ON goals(account_id, experiment_id);
CREATE TABLE experiment_versions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (experiment_id, version)
);
CREATE INDEX versions_account_idx ON experiment_versions(account_id);
CREATE TABLE publications (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  config TEXT NOT NULL,
  published_by TEXT,
  published_at INTEGER NOT NULL,
  UNIQUE (account_id, version)
);
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  experiment_id TEXT,
  variation_id TEXT,
  -- página normalizada (origin + caminho) calculada na inserção: SQLite não tem regexp_replace.
  page TEXT NOT NULL,
  payload TEXT NOT NULL,
  ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX events_account_type_idx ON events(account_id, type, experiment_id);
CREATE INDEX events_page_idx ON events(account_id, page, type);
CREATE TABLE edit_sessions (
  token TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  app_origin TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
